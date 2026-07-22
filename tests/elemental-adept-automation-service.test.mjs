import assert from "node:assert/strict";
import test from "node:test";

const {
  ElementalAdeptAutomationService,
  ELEMENTAL_ADEPT_CHOICES,
  getAvailableElementalAdeptChoices,
  getConfiguredElementalAdeptTypes,
  isElementalAdeptItem,
  promptElementalAdeptChoice,
} = await import("../scripts/combat/elemental-adept-automation-service.js");
const { registerCombatHooks } = await import("../scripts/combat/hooks.js");

function makeFeat({
  id = "elemental-adept",
  type = "feat",
  identifier = "stihiynyy-adept",
  configuredType = "",
} = {}) {
  return {
    id,
    type,
    system: { identifier },
    flags: {
      "rebreya-main": {
        elementalAdept: configuredType,
      },
    },
  };
}

function makeCharacter(items = []) {
  const actor = { id: "character-1", type: "character", items, isOwner: true };
  for (const item of items) {
    item.parent = actor;
  }
  return actor;
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function makeMutableFeat(options = {}) {
  const item = makeFeat(options);
  item.name = options.name ?? "Стихийный адепт";
  item.system.type = { subtype: options.subtype ?? "" };
  item.updates = [];
  item.deleted = false;
  item.update = async (data, updateOptions) => {
    item.updates.push({ data, options: updateOptions });
    for (const [path, value] of Object.entries(data)) {
      if (path.includes(".")) {
        setPath(item, path, value);
      }
      else if (value && typeof value === "object" && !Array.isArray(value)) {
        item[path] = structuredClone(value);
      }
      else {
        item[path] = value;
      }
    }
    return item;
  };
  item.delete = async (deleteOptions) => {
    item.deleted = deleteOptions;
    return item;
  };
  return item;
}

function setCurrentUser({ id = "player-1", isGM = false, users = [] } = {}) {
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
  globalThis.game = { user: { id, isGM }, users };
}

function makeConfiguredCharacter(damageType = "fire") {
  const adept = makeFeat({ configuredType: damageType });
  return makeCharacter([adept]);
}

function makeDamageRoll({
  type = "fire",
  types = [],
  terms = [],
  parent = null,
  total = 0,
} = {}) {
  return {
    options: { type, types },
    terms,
    parent,
    _total: total,
    evaluations: 0,
    _evaluateTotal() {
      this.evaluations += 1;
      return 42;
    },
    toJSON() {
      return { total: this._total, type: this.options.type };
    },
  };
}

function spellActivity(actor, itemType = "spell") {
  return { item: { type: itemType, parent: actor } };
}

test("recognizes only owned Elemental Adept feat items", () => {
  const elementalAdept = makeFeat();
  makeCharacter([elementalAdept]);

  assert.equal(isElementalAdeptItem(elementalAdept), true);
  assert.equal(isElementalAdeptItem(makeFeat({ type: "spell" })), false);
  assert.equal(isElementalAdeptItem(makeFeat({ identifier: "other-feat" })), false);
  assert.equal(isElementalAdeptItem(makeFeat({ identifier: "stihiynyy-adept", type: "feat" })), false);
});

test("exports the five supported elemental damage choices", () => {
  assert.deepEqual(
    ELEMENTAL_ADEPT_CHOICES.map((choice) => choice.value),
    ["acid", "cold", "fire", "lightning", "thunder"],
  );
});

test("excludes sibling configured types while retaining the current item's own type during repair", () => {
  const current = makeFeat({ id: "current", configuredType: "fire" });
  const sibling = makeFeat({ id: "sibling", configuredType: "cold" });
  const actor = makeCharacter([current, sibling]);

  assert.deepEqual(getConfiguredElementalAdeptTypes(actor, { excludeItem: current }), ["cold"]);
  assert.deepEqual(
    getAvailableElementalAdeptChoices(actor, current).map((choice) => choice.value),
    ["acid", "fire", "lightning", "thunder"],
  );
});

test("ignores non-character and compendium Elemental Adept items", () => {
  const npcItem = makeFeat({ id: "npc" });
  npcItem.parent = { type: "npc", items: [npcItem] };
  const compendiumItem = makeFeat({ id: "compendium" });
  compendiumItem.pack = "world.rebreya-feats";

  assert.equal(isElementalAdeptItem(npcItem), false);
  assert.equal(isElementalAdeptItem(compendiumItem), false);
});

test("classifies the first owned copy as general before prompting", async () => {
  setCurrentUser();
  const item = makeMutableFeat();
  makeCharacter([item]);
  const service = new ElementalAdeptAutomationService(null, {
    prompt: async ({ item: prompted }) => {
      assert.equal(prompted.system.type.subtype, "general");
      return "fire";
    },
  });

  assert.equal(await service.handleCreatedItem(item, {}, "player-1"), true);
  assert.equal(item.updates[0].data["system.type.subtype"], "general");
});

test("classifies later copies as minor even when the first copy is unresolved", async () => {
  setCurrentUser();
  const first = makeMutableFeat({ id: "first", subtype: "general" });
  const later = makeMutableFeat({ id: "later" });
  makeCharacter([first, later]);
  const service = new ElementalAdeptAutomationService(null, { prompt: async () => null });

  assert.equal(await service.handleCreatedItem(later, {}, "player-1"), false);
  assert.equal(later.updates[0].data["system.type.subtype"], "minor");
});

test("selection updates the same item while preserving its Elemental Adept identity", async () => {
  setCurrentUser();
  const item = makeMutableFeat();
  makeCharacter([item]);
  const service = new ElementalAdeptAutomationService(null, { prompt: async () => "fire" });

  assert.equal(await service.handleCreatedItem(item, {}, "player-1"), true);
  assert.equal(item.system.identifier, "stihiynyy-adept");
  assert.equal(item.flags["rebreya-main"].elementalAdept, "fire");
  assert.match(item.name, /Огонь/u);
  assert.equal(item.deleted, false);
});

test("cancellation retains classification and leaves the item unresolved", async () => {
  setCurrentUser();
  const item = makeMutableFeat();
  makeCharacter([item]);
  const service = new ElementalAdeptAutomationService(null, { prompt: async () => null });

  assert.equal(await service.handleCreatedItem(item, {}, "player-1"), false);
  assert.equal(item.system.type.subtype, "general");
  assert.equal(item.flags["rebreya-main"].elementalAdept, "");
});

test("sheet repair prompts unresolved copies and skips configured copies", async () => {
  setCurrentUser();
  const unresolved = makeMutableFeat({ id: "unresolved" });
  const configured = makeMutableFeat({ id: "configured", configuredType: "cold" });
  const actor = makeCharacter([unresolved, configured]);
  const prompted = [];
  const service = new ElementalAdeptAutomationService(null, {
    prompt: async ({ item }) => {
      prompted.push(item.id);
      return "fire";
    },
  });

  assert.equal(await service.repairActor(actor), true);
  assert.deepEqual(prompted, ["unresolved"]);
  assert.equal(unresolved.flags["rebreya-main"].elementalAdept, "fire");
});

test("deletes an unresolved sixth copy after every elemental type is owned", async () => {
  setCurrentUser();
  const owned = ELEMENTAL_ADEPT_CHOICES.map((choice) => makeMutableFeat({
    id: choice.value,
    configuredType: choice.value,
  }));
  const sixth = makeMutableFeat({ id: "sixth" });
  makeCharacter([...owned, sixth]);
  const service = new ElementalAdeptAutomationService(null, { prompt: async () => assert.fail("must not prompt") });

  assert.equal(await service.handleCreatedItem(sixth, {}, "player-1"), true);
  assert.notEqual(sixth.deleted, false);
});

test("rejects a concurrently unavailable selection and refreshes the prompt choices", async () => {
  setCurrentUser();
  const item = makeMutableFeat();
  const sibling = makeMutableFeat({ id: "sibling" });
  makeCharacter([item, sibling]);
  const offered = [];
  const service = new ElementalAdeptAutomationService(null, {
    prompt: async ({ options }) => {
      offered.push(options.map((choice) => choice.value));
      if (offered.length === 1) {
        sibling.flags["rebreya-main"].elementalAdept = "fire";
        return "fire";
      }
      return "cold";
    },
  });

  assert.equal(await service.handleCreatedItem(item, {}, "player-1"), true);
  assert.deepEqual(offered[1], ["acid", "cold", "lightning", "thunder"]);
  assert.equal(item.flags["rebreya-main"].elementalAdept, "cold");
});

test("an active player owner takes precedence over a GM prompt and recursive updates are ignored", async () => {
  const item = makeMutableFeat();
  const actor = makeCharacter([item]);
  actor.ownership = { "player-1": 3 };
  setCurrentUser({ id: "gm-1", isGM: true, users: [{ id: "player-1", active: true, isGM: false }] });
  const service = new ElementalAdeptAutomationService(null, { prompt: async () => assert.fail("GM must not prompt") });

  assert.equal(await service.handleCreatedItem(item, {}, "gm-1"), false);
  setCurrentUser({ id: "player-1", users: [{ id: "player-1", active: true, isGM: false }] });
  assert.equal(await service.handleCreatedItem(item, { "rebreya-main": { skipElementalAdeptAutomation: true } }, "player-1"), false);
});

test("sheet repair never deletes an existing unresolved copy when every type is already owned", async () => {
  setCurrentUser();
  const owned = ELEMENTAL_ADEPT_CHOICES.map((choice) => makeMutableFeat({
    id: choice.value,
    configuredType: choice.value,
  }));
  const unresolved = makeMutableFeat({ id: "cancelled", subtype: "minor" });
  const actor = makeCharacter([...owned, unresolved]);
  const service = new ElementalAdeptAutomationService(null, { prompt: async () => assert.fail("repair must not prompt") });

  assert.equal(await service.repairActor(actor), false);
  assert.equal(unresolved.deleted, false);
  assert.equal(unresolved.system.type.subtype, "minor");
});

test("sheet repair uses a capacity warning instead of a failed-deletion warning", async () => {
  setCurrentUser();
  const previousUi = globalThis.ui;
  const warnings = [];
  globalThis.ui = { notifications: { warn: (message) => warnings.push(message) } };
  try {
    const owned = ELEMENTAL_ADEPT_CHOICES.map((choice) => makeMutableFeat({
      id: choice.value,
      configuredType: choice.value,
    }));
    const unresolved = makeMutableFeat({ id: "cancelled", subtype: "minor" });
    const actor = makeCharacter([...owned, unresolved]);
    const service = new ElementalAdeptAutomationService(null, { prompt: async () => assert.fail("repair must not prompt") });

    assert.equal(await service.repairActor(actor), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /нет доступных типов урона/iu);
    assert.doesNotMatch(warnings[0], /удалить/u);
  }
  finally {
    globalThis.ui = previousUi;
  }
});

test("ordinary updates preserve an already configured acquisition subtype", async () => {
  setCurrentUser();
  const original = makeMutableFeat({ id: "original", subtype: "general", configuredType: "fire" });
  const later = makeMutableFeat({ id: "later", subtype: "minor", configuredType: "cold" });
  makeCharacter([original, later]);
  const service = new ElementalAdeptAutomationService(null, { prompt: async () => assert.fail("configured Item must not prompt") });

  assert.equal(await service.handleUpdatedItem(original, { name: "unchanged" }, {}, "player-1"), false);
  assert.equal(original.system.type.subtype, "general");
  assert.equal(original.updates.length, 0);
});

test("ordinary updates do not recompute an already classified unresolved subtype", async () => {
  setCurrentUser();
  const original = makeMutableFeat({ id: "original", subtype: "general" });
  const later = makeMutableFeat({ id: "later", subtype: "minor" });
  makeCharacter([original, later]);
  const service = new ElementalAdeptAutomationService(null, { prompt: async () => null });

  assert.equal(await service.handleUpdatedItem(original, { name: "unchanged" }, {}, "player-1"), false);
  assert.equal(original.system.type.subtype, "general");
  assert.equal(original.updates.length, 0);
});

test("default Elemental Adept prompt cancels safely when Dialog is unavailable", async () => {
  const previousDialog = globalThis.Dialog;
  globalThis.Dialog = undefined;
  try {
    assert.equal(await promptElementalAdeptChoice({ choices: ELEMENTAL_ADEPT_CHOICES }), null);
  }
  finally {
    globalThis.Dialog = previousDialog;
  }
});

test("concurrent configuration calls serialize by actor and duplicate an Item only prompts once", async () => {
  setCurrentUser();
  const first = makeMutableFeat({ id: "first" });
  const second = makeMutableFeat({ id: "second" });
  makeCharacter([first, second]);
  const prompts = [];
  let activePrompts = 0;
  const service = new ElementalAdeptAutomationService(null, {
    prompt: async ({ item }) => {
      prompts.push(item.id);
      activePrompts += 1;
      assert.equal(activePrompts, 1, "prompts for one actor must not overlap");
      await Promise.resolve();
      activePrompts -= 1;
      return item.id === "first" ? "fire" : "cold";
    },
  });

  const [firstResult, secondResult, duplicateResult] = await Promise.all([
    service.handleCreatedItem(first, {}, "player-1"),
    service.handleCreatedItem(second, {}, "player-1"),
    service.handleCreatedItem(first, {}, "player-1"),
  ]);

  assert.deepEqual([firstResult, secondResult, duplicateResult], [true, true, false]);
  assert.deepEqual(prompts, ["first", "second"]);
  assert.equal(first.system.type.subtype, "general");
  assert.equal(second.system.type.subtype, "minor");
  assert.equal(first.flags["rebreya-main"].elementalAdept, "fire");
  assert.equal(second.flags["rebreya-main"].elementalAdept, "cold");
});

test("an existing classified minor copy makes a later acquisition minor without a general copy", async () => {
  setCurrentUser();
  const existingMinor = makeMutableFeat({ id: "existing-minor", subtype: "minor" });
  const acquired = makeMutableFeat({ id: "acquired" });
  makeCharacter([existingMinor, acquired]);
  const service = new ElementalAdeptAutomationService(null, { prompt: async () => null });

  assert.equal(await service.handleCreatedItem(acquired, {}, "player-1"), false);
  assert.equal(acquired.system.type.subtype, "minor");
});

test("Elemental Adept raises only active 1s and 2s in nested completed spell damage dice", async () => {
  const actor = makeConfiguredCharacter("fire");
  const direct = {
    class: "Die",
    faces: 6,
    results: [
      { result: 1, active: true },
      { result: 2, active: true },
      { result: 3, active: true },
      { result: 1, active: false },
      { result: 1, active: true, rerolled: true },
      { result: 2, active: true, discarded: true },
    ],
  };
  const nested = { class: "Die", faces: 6, results: [{ result: 2, active: true }] };
  const roll = makeDamageRoll({ terms: [direct, { dice: [nested] }] });
  const service = new ElementalAdeptAutomationService();

  assert.equal(await service.applyDnd5ePostDamageRoll([roll], { subject: spellActivity(actor) }), true);
  assert.deepEqual(direct.results.map(({ result }) => result), [3, 3, 3, 1, 1, 2]);
  assert.equal(nested.results[0].result, 3);
  assert.equal(roll._total, 42);
  assert.equal(roll.evaluations, 1);
});

test("Elemental Adept adjusts only matching spell damage rolls, including spell-tagged non-spell sources", async () => {
  const actor = makeConfiguredCharacter("fire");
  const service = new ElementalAdeptAutomationService();
  const fire = makeDamageRoll({ type: "fire", terms: [{ class: "Die", faces: 6, results: [{ result: 1, active: true }] }] });
  const radiant = makeDamageRoll({ type: "radiant", terms: [{ class: "Die", faces: 6, results: [{ result: 1, active: true }] }] });
  const tagged = makeDamageRoll({ types: ["fire"], terms: [{ class: "Die", faces: 6, results: [{ result: 2, active: true }] }] });
  const noAdept = makeDamageRoll({ terms: [{ results: [{ result: 1, active: true }] }] });
  const mundane = makeDamageRoll({ terms: [{ results: [{ result: 1, active: true }] }] });

  assert.equal(await service.applyDnd5ePostDamageRoll([fire, radiant], { subject: spellActivity(actor) }), true);
  assert.equal(fire.terms[0].results[0].result, 3);
  assert.equal(radiant.terms[0].results[0].result, 1);

  const spellTaggedActivity = {
    item: { type: "feat", parent: actor },
    system: { properties: new Set(["spell"]) },
  };
  assert.equal(await service.applyDnd5ePostDamageRoll([tagged], { subject: spellTaggedActivity }), true);
  assert.equal(tagged.terms[0].results[0].result, 3);

  assert.equal(await service.applyDnd5ePostDamageRoll([noAdept], { subject: spellActivity(makeCharacter()) }), false);
  assert.equal(await service.applyDnd5ePostDamageRoll([mundane], { subject: spellActivity(actor, "weapon") }), false);
  assert.equal(noAdept.terms[0].results[0].result, 1);
  assert.equal(mundane.terms[0].results[0].result, 1);
});

test("Elemental Adept ignores PoolTerm aggregate results and refreshes nested damage rolls bottom-up", async () => {
  const actor = makeConfiguredCharacter("fire");
  const evaluations = [];
  const die = { class: "Die", faces: 6, results: [{ result: 1, active: true }] };
  const nestedRoll = makeDamageRoll({ terms: [die] });
  nestedRoll._evaluateTotal = () => {
    evaluations.push("nested");
    return 3;
  };
  const pool = {
    class: "PoolTerm",
    results: [{ result: 1, active: true }],
  };
  const parenthetical = { class: "ParentheticalTerm", roll: nestedRoll };
  const roll = makeDamageRoll({ terms: [pool, parenthetical] });
  roll._evaluateTotal = () => {
    evaluations.push("outer");
    return nestedRoll._total;
  };
  const service = new ElementalAdeptAutomationService();

  assert.equal(await service.applyDnd5ePostDamageRoll([roll], { subject: spellActivity(actor) }), true);
  assert.equal(die.results[0].result, 3);
  assert.equal(pool.results[0].result, 1);
  assert.deepEqual(evaluations, ["nested", "outer"]);
  assert.equal(nestedRoll._total, 3);
  assert.equal(roll._total, 3);
});

test("Elemental Adept preserves full multi-roll messages while serializing concurrent updates", async () => {
  const fireActor = makeConfiguredCharacter("fire");
  const lightningActor = makeConfiguredCharacter("lightning");
  const updates = [];
  let activeUpdates = 0;
  let maximumActiveUpdates = 0;
  const message = {
    rolls: [],
    async update(patch) {
      activeUpdates += 1;
      maximumActiveUpdates = Math.max(maximumActiveUpdates, activeUpdates);
      updates.push(patch);
      await Promise.resolve();
      activeUpdates -= 1;
    },
  };
  const first = makeDamageRoll({ parent: message, terms: [{ results: [{ result: 1, active: true }] }] });
  first.terms[0].class = "Die";
  first.terms[0].faces = 6;
  const second = makeDamageRoll({ parent: message, terms: [{ class: "Die", faces: 6, results: [{ result: 2, active: true }] }] });
  const lightning = makeDamageRoll({ type: "lightning", parent: message, terms: [{ class: "Die", faces: 6, results: [{ result: 1, active: true }] }] });
  const radiant = makeDamageRoll({ type: "radiant", parent: message, total: 9, terms: [{ class: "Die", faces: 6, results: [{ result: 1, active: true }] }] });
  for (const roll of [first, second]) {
    roll.formula = "1d6";
  }
  const firstCopy = makeDamageRoll({ total: 1, terms: [{ class: "Die", faces: 6, results: [{ result: 1, active: true }] }] });
  const secondCopy = makeDamageRoll({ total: 2, terms: [{ class: "Die", faces: 6, results: [{ result: 2, active: true }] }] });
  const lightningCopy = makeDamageRoll({ type: "lightning", total: 1, terms: [{ class: "Die", faces: 6, results: [{ result: 1, active: true }] }] });
  const radiantCopy = makeDamageRoll({ type: "radiant", total: 9, terms: [{ class: "Die", faces: 6, results: [{ result: 1, active: true }] }] });
  for (const roll of [firstCopy, secondCopy]) {
    roll.formula = "1d6";
  }
  message.rolls = [firstCopy, secondCopy, lightningCopy, radiantCopy];
  const service = new ElementalAdeptAutomationService();
  const safeRolls = [first, second, lightning, radiant];

  await Promise.all([
    service.applyDnd5ePostDamageRoll(safeRolls, { subject: spellActivity(fireActor) }),
    service.applyDnd5ePostDamageRoll(safeRolls, { subject: spellActivity(lightningActor) }),
  ]);
  assert.equal(maximumActiveUpdates, 1);
  assert.deepEqual(updates, [
    { rolls: [{ total: 42, type: "fire" }, { total: 42, type: "fire" }, { total: 42, type: "lightning" }, { total: 9, type: "radiant" }] },
    { rolls: [{ total: 42, type: "fire" }, { total: 42, type: "fire" }, { total: 42, type: "lightning" }, { total: 9, type: "radiant" }] },
  ]);
  assert.equal(firstCopy.terms[0].results[0].result, 1, "message roll copies remain stale until their serialized replacement is applied");
  assert.equal(secondCopy.terms[0].results[0].result, 2, "duplicate same-type/formula copies must be replaced by their hook-array positions");
  assert.equal(radiantCopy.terms[0].results[0].result, 1);
  assert.equal(lightningCopy.terms[0].results[0].result, 1, "concurrent hook copies must also be merged into the final patch");
  assert.equal(updates.every((update) => update.rolls.length === 4), true);

  assert.equal(await service.applyDnd5ePostDamageRoll(safeRolls, { subject: spellActivity(fireActor) }), false);
  assert.equal(updates.length, 2);
});

test("Elemental Adept Midi damage bypass merges selected spell types into resistance and absorption only", async () => {
  const actor = makeCharacter([
    makeFeat({ id: "fire", configuredType: "fire" }),
    makeFeat({ id: "cold", configuredType: "cold" }),
  ]);
  const existingResistance = new Set(["acid"]);
  const existingAbsorption = new Set(["lightning"]);
  const options = {
    ignore: {
      resistance: existingResistance,
      absorption: existingAbsorption,
      immunity: new Set(["thunder"]),
      vulnerability: false,
      modification: new Set(["fire"]),
      threshold: true,
    },
    save: { multiplier: 0.5 },
  };
  const untouched = structuredClone({
    immunity: Array.from(options.ignore.immunity),
    vulnerability: options.ignore.vulnerability,
    modification: Array.from(options.ignore.modification),
    threshold: options.ignore.threshold,
    save: options.save,
  });
  const service = new ElementalAdeptAutomationService();

  assert.equal(await service.applyMidiPreCalculateDamage(actor, [{
    types: new Set(["fire", "cold", "radiant"]),
    spell: true,
  }], options), true);
  assert.equal(options.ignore.resistance, existingResistance);
  assert.equal(options.ignore.absorption, existingAbsorption);
  assert.deepEqual(Array.from(options.ignore.resistance).sort(), ["acid", "cold", "fire"]);
  assert.deepEqual(Array.from(options.ignore.absorption).sort(), ["cold", "fire", "lightning"]);
  assert.deepEqual({
    immunity: Array.from(options.ignore.immunity),
    vulnerability: options.ignore.vulnerability,
    modification: Array.from(options.ignore.modification),
    threshold: options.ignore.threshold,
    save: options.save,
  }, untouched);
});

test("Elemental Adept Midi bypass resolves its source actor by UUID and skips unmatched or mundane damage", async () => {
  const source = makeConfiguredCharacter("fire");
  source.uuid = "Actor.elemental-source";
  const options = { midi: { sourceActorUuid: source.uuid }, ignore: {} };
  const resolved = [];
  const service = new ElementalAdeptAutomationService(null, {
    fromUuidSync: (uuid) => {
      resolved.push(uuid);
      return uuid === source.uuid ? source : null;
    },
  });

  assert.equal(await service.applyMidiPreCalculateDamage(null, [
    { types: new Set(["fire"]), spell: false },
    { types: new Set(["radiant"]), spell: true },
  ], options), false);
  assert.deepEqual(resolved, [source.uuid]);
  assert.deepEqual(options.ignore, {});

  assert.equal(await service.applyMidiPreCalculateDamage(null, [{
    types: new Set(["fire"]),
    spell: { type: "spell" },
  }], options), true);
  assert.deepEqual(Array.from(options.ignore.resistance), ["fire"]);
  assert.deepEqual(Array.from(options.ignore.absorption), ["fire"]);
});

test("Elemental Adept tolerates absent and boolean ignore settings without changing immunity", async () => {
  const actor = makeConfiguredCharacter("fire");
  const service = new ElementalAdeptAutomationService();
  const absent = {};
  const booleanEntries = { ignore: { resistance: false, absorption: true, immunity: true } };
  const damage = [{ type: "fire", spell: true }];

  assert.equal(await service.applyMidiPreCalculateDamage(actor, damage, absent), true);
  assert.deepEqual(Array.from(absent.ignore.resistance), ["fire"]);
  assert.deepEqual(Array.from(absent.ignore.absorption), ["fire"]);
  assert.equal(await service.applyMidiPreCalculateDamage(actor, damage, booleanEntries), true);
  assert.deepEqual(Array.from(booleanEntries.ignore.resistance), ["fire"]);
  assert.equal(booleanEntries.ignore.absorption, true);
  assert.equal(booleanEntries.ignore.immunity, true);
});

test("Elemental Adept native fallback bypasses only resistance and fails open on ambiguous source attribution", async () => {
  const actor = makeConfiguredCharacter("fire");
  const service = new ElementalAdeptAutomationService();
  const options = { ignore: { absorption: new Set(["cold"]) } };

  assert.equal(await service.applyDnd5ePreCalculateDamage(actor, [{ types: new Set(["fire"]), spell: true }], options), true);
  assert.deepEqual(Array.from(options.ignore.resistance), ["fire"]);
  assert.deepEqual(Array.from(options.ignore.absorption), ["cold"]);

  const ambiguous = { sourceActorUuid: "Actor.unknown", ignore: {} };
  assert.equal(await service.applyDnd5ePreCalculateDamage(actor, [{ type: "fire", spell: true }], ambiguous), false);
  assert.deepEqual(ambiguous.ignore, {});
});

test("Elemental Adept fails open when positional and direct source actors conflict without a UUID", async () => {
  const positionalActor = makeConfiguredCharacter("fire");
  positionalActor.uuid = "Actor.positional";
  const directSource = makeConfiguredCharacter("fire");
  directSource.uuid = "Actor.direct";
  const options = { sourceActor: directSource, ignore: {} };
  const service = new ElementalAdeptAutomationService();

  assert.equal(await service.applyDnd5ePreCalculateDamage(
    positionalActor,
    [{ type: "fire", spell: true }],
    options,
  ), false);
  assert.deepEqual(options.ignore, {});
});

test("Elemental Adept native fallback fails open when direct source actors conflict", async () => {
  const sourceActor = makeConfiguredCharacter("fire");
  sourceActor.uuid = "Actor.source";
  const midiSourceActor = makeConfiguredCharacter("fire");
  midiSourceActor.uuid = "Actor.midi-source";
  const options = { sourceActor, midi: { sourceActor: midiSourceActor }, ignore: {} };
  const service = new ElementalAdeptAutomationService();

  assert.equal(await service.applyDnd5ePreCalculateDamage(
    sourceActor,
    [{ type: "fire", spell: true }],
    options,
  ), false);
  assert.deepEqual(options.ignore, {});
});

test("Elemental Adept Midi bypass fails open when a UUID resolves against conflicting direct sources", async () => {
  const sourceActor = makeConfiguredCharacter("fire");
  sourceActor.uuid = "Actor.source";
  const midiSourceActor = makeConfiguredCharacter("fire");
  midiSourceActor.uuid = "Actor.midi-source";
  const options = {
    sourceActor,
    midi: { sourceActor: midiSourceActor, sourceActorUuid: sourceActor.uuid },
    ignore: {},
  };
  const service = new ElementalAdeptAutomationService(null, {
    fromUuidSync: (uuid) => uuid === sourceActor.uuid ? sourceActor : null,
  });

  assert.equal(await service.applyMidiPreCalculateDamage(
    sourceActor,
    [{ type: "fire", spell: true }],
    options,
  ), false);
  assert.deepEqual(options.ignore, {});
});

test("Elemental Adept accepts an unambiguous direct source actor", async () => {
  const sourceActor = makeConfiguredCharacter("fire");
  const options = { sourceActor, ignore: {} };
  const service = new ElementalAdeptAutomationService();

  assert.equal(await service.applyDnd5ePreCalculateDamage(
    null,
    [{ type: "fire", spell: true }],
    options,
  ), true);
  assert.deepEqual(Array.from(options.ignore.resistance), ["fire"]);
});

test("Elemental Adept native fallback does not double-handle options processed by Midi", async () => {
  const actor = makeConfiguredCharacter("fire");
  const options = { ignore: {} };
  const damage = [{ types: new Set(["fire"]), spell: true }];
  const service = new ElementalAdeptAutomationService();

  assert.equal(await service.applyMidiPreCalculateDamage(actor, damage, options), true);
  assert.equal(await service.applyDnd5ePreCalculateDamage(actor, damage, options), false);
  assert.deepEqual(Array.from(options.ignore.resistance), ["fire"]);
  assert.deepEqual(Array.from(options.ignore.absorption), ["fire"]);
});

test("combat hooks register Elemental Adept once and await it after Sorcerer damage handling", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  const calls = [];
  globalThis.Hooks = {
    on(name, callback) {
      handlers.set(name, [...(handlers.get(name) ?? []), callback]);
    }
  };
  globalThis.game = { user: { id: "user", isGM: true } };

  try {
    const moduleApi = {
      elementalAdeptAutomationService: {
        async handleCreatedItem(...args) { calls.push(["create", ...args]); },
        async repairActor(actor) { calls.push(["repair", actor]); },
        async applyMidiPreCalculateDamage(...args) { calls.push(["midi", ...args]); },
        async applyDnd5ePreCalculateDamage(...args) { calls.push(["native", ...args]); },
        async applyDnd5ePostDamageRoll() { calls.push("elemental"); }
      }
    };

    registerCombatHooks(moduleApi);
    registerCombatHooks(moduleApi);

    for (const hookName of [
      "createItem",
      "updateItem",
      "renderActorSheet",
      "renderActorSheet5eCharacter2",
      "renderActorSheet5eCharacter",
      "renderCharacterActorSheet",
      "midi-qol.dnd5ePreCalculateDamage",
      "dnd5e.preCalculateDamage",
      "dnd5e.rollDamage"
    ]) {
      assert.equal(handlers.get(hookName)?.length, 1, `${hookName} should have one handler`);
    }

    const item = {};
    handlers.get("createItem")[0](item, { source: "test" }, "user");
    await Promise.resolve();
    assert.deepEqual(calls.at(-1), ["create", item, { source: "test" }, "user"]);

    const actor = {};
    handlers.get("renderActorSheet")[0]({ actor });
    await handlers.get("midi-qol.dnd5ePreCalculateDamage")[0](actor, ["damage"], { midi: true });
    await handlers.get("dnd5e.preCalculateDamage")[0](actor, ["damage"], { native: true });
    assert.deepEqual(calls.slice(-3), [
      ["repair", actor],
      ["midi", actor, ["damage"], { midi: true }],
      ["native", actor, ["damage"], { native: true }]
    ]);

    handlers.clear();
    delete globalThis.game["rebreya-main.combatHooksRegistered"];
    moduleApi.sorcererAutomationService = {
      async applyDnd5ePostDamageRoll() {
        calls.push("sorcerer:start");
        await Promise.resolve();
        calls.push("sorcerer:finish");
      }
    };
    registerCombatHooks(moduleApi);

    const promise = handlers.get("dnd5e.rollDamage")[0]([], {});
    assert.equal(typeof promise?.then, "function");
    assert.equal(await promise, true);
    assert.deepEqual(calls.slice(-3), ["sorcerer:start", "sorcerer:finish", "elemental"]);

    moduleApi.sorcererAutomationService.applyDnd5ePostDamageRoll = async () => {
      calls.push("sorcerer:failed");
      throw new Error("expected Sorcerer failure");
    };
    const previousConsoleError = console.error;
    console.error = () => {};
    try {
      assert.equal(await handlers.get("dnd5e.rollDamage")[0]([], {}), true);
      assert.deepEqual(calls.slice(-2), ["sorcerer:failed", "elemental"]);
    }
    finally {
      console.error = previousConsoleError;
    }

    moduleApi.elementalAdeptAutomationService.applyDnd5ePostDamageRoll = async () => {
      calls.push("elemental:failed");
      throw new Error("expected Elemental Adept failure");
    };
    const previousElementalConsoleError = console.error;
    console.error = () => {};
    try {
      assert.equal(await handlers.get("dnd5e.rollDamage")[0]([], {}), true);
      assert.equal(calls.at(-1), "elemental:failed");
    }
    finally {
      console.error = previousElementalConsoleError;
    }
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("shared damage hook applies Elemental Adept after Sorcerer rerolls and persists the final roll", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  const actor = makeConfiguredCharacter("fire");
  const die = { class: "Die", faces: 6, results: [{ result: 1, active: true }] };
  const updates = [];
  const message = {
    rolls: [],
    async update(patch) { updates.push(patch); }
  };
  const roll = makeDamageRoll({ parent: message, terms: [die] });
  message.rolls = [roll];
  globalThis.Hooks = {
    on(name, callback) {
      handlers.set(name, [...(handlers.get(name) ?? []), callback]);
    }
  };
  globalThis.game = { user: { id: "user", isGM: true } };

  try {
    registerCombatHooks({
      sorcererAutomationService: {
        async applyDnd5ePostDamageRoll() {
          await Promise.resolve();
          die.results[0].result = 2;
        }
      },
      elementalAdeptAutomationService: new ElementalAdeptAutomationService()
    });

    assert.equal(await handlers.get("dnd5e.rollDamage")[0]([roll], { subject: spellActivity(actor) }), true);
    assert.equal(die.results[0].result, 3);
    assert.deepEqual(updates, [{ rolls: [{ total: 42, type: "fire" }] }]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("pre-calculate damage hooks synchronously mutate matching source options", () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  const source = makeConfiguredCharacter("fire");
  source.uuid = "Actor.elemental-source";
  globalThis.Hooks = {
    on(name, callback) {
      handlers.set(name, [...(handlers.get(name) ?? []), callback]);
    }
  };
  globalThis.game = { user: { id: "user", isGM: true } };

  try {
    registerCombatHooks({
      elementalAdeptAutomationService: new ElementalAdeptAutomationService(null, {
        fromUuidSync: (uuid) => uuid === source.uuid ? source : null,
        fromUuid: async () => {
          throw new Error("the asynchronous resolver must not be used");
        }
      })
    });

    const midiOptions = { midi: { sourceActorUuid: source.uuid }, ignore: {} };
    assert.equal(
      handlers.get("midi-qol.dnd5ePreCalculateDamage")[0](null, [{ type: "fire", spell: true }], midiOptions),
      true
    );
    assert.deepEqual(Array.from(midiOptions.ignore.resistance), ["fire"]);
    assert.deepEqual(Array.from(midiOptions.ignore.absorption), ["fire"]);

    const nativeOptions = { ignore: {} };
    assert.equal(
      handlers.get("dnd5e.preCalculateDamage")[0](source, [{ type: "fire", spell: true }], nativeOptions),
      true
    );
    assert.deepEqual(Array.from(nativeOptions.ignore.resistance), ["fire"]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("Elemental Adept ignores asynchronous UUID resolvers without scheduling a later bypass", async () => {
  const source = makeConfiguredCharacter("fire");
  source.uuid = "Actor.elemental-source";
  const options = { midi: { sourceActorUuid: source.uuid }, ignore: {} };
  const service = new ElementalAdeptAutomationService(null, {
    fromUuid: async () => source
  });

  assert.equal(service.applyMidiPreCalculateDamage(null, [{ type: "fire", spell: true }], options), false);
  assert.deepEqual(options.ignore, {});
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(options.ignore, {});
});
