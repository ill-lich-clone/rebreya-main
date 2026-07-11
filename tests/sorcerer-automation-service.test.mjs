import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {
  utils: {
    getProperty: (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object),
    setProperty: (object, path, value) => {
      const keys = String(path ?? "").split(".").filter(Boolean);
      let target = object;
      while (keys.length > 1) {
        const key = keys.shift();
        target[key] ??= {};
        target = target[key];
      }
      target[keys[0]] = value;
      return true;
    },
    deepClone: (value) => JSON.parse(JSON.stringify(value))
  }
};

globalThis.game ??= {
  user: { id: "user", isGM: true },
  combat: { round: 1 }
};

const { SorcererAutomationService } = await import("../scripts/combat/sorcerer-automation-service.js");

const MODULE_ID = "rebreya-main";
const SORCERER_ROOT = "sorcerer-rework-v011";

class TestActor {
  constructor({ level = 1, pointsSpent = 0, includePoints = false } = {}) {
    this.id = "sorcerer";
    this.uuid = "Actor.sorcerer";
    this.system = {
      scale: {
        [SORCERER_ROOT]: {
          "sorcery-points": [4, 8, 17, 21, 32, 38, 45, 52, 66, 74, 84, 85, 96, 97, 109, 110, 124, 132, 142, 153][level - 1],
          "maximum-spell-level": Math.ceil(level / 2)
        }
      },
      classes: {
        [SORCERER_ROOT]: { levels: level }
      },
      attributes: { exhaustion: 0 }
    };
    this.flags = {};
    this.items = { contents: [] };
    this.sorcererClassItem = makeItemFromData(this, {
      name: "Sorcerer",
      type: "class",
      system: { identifier: SORCERER_ROOT }
    }, "classSorcererItem");
    this.wizardClassItem = makeItemFromData(this, {
      name: "Wizard",
      type: "class",
      system: { identifier: "wizard" }
    }, "classWizardItem");
    this.items.contents.push(this.sorcererClassItem, this.wizardClassItem);
    this.updates = [];
    this.createdItems = [];
    if (includePoints) {
      this.items.contents.push(makePointsItem(this, { spent: pointsSpent }));
    }
  }

  async createEmbeddedDocuments(type, rows) {
    assert.equal(type, "Item");
    this.createdItems.push(rows);
    const documents = rows.map((row, index) => makeItemFromData(this, row, `points-${index + 1}`));
    this.items.contents.push(...documents);
    return documents;
  }

  async update(patch) {
    this.updates.push(patch);
    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(this, path, value);
    }
    return this;
  }

  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }

  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = value;
    return value;
  }
}

function makeItemFromData(actor, data, id) {
  const item = {
    id,
    _id: id,
    uuid: `Actor.sorcerer.Item.${id}`,
    actor,
    name: data.name,
    type: data.type,
    flags: structuredClone(data.flags ?? {}),
    system: structuredClone(data.system ?? {}),
    updates: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(patch) {
      this.updates.push(patch);
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
  return item;
}

function makePointsItem(actor, { spent = 0 } = {}) {
  return makeItemFromData(actor, {
    name: "Sorcery Points",
    type: "feat",
    flags: { [MODULE_ID]: { featureId: "sorcerer-sorcery-points" } },
    system: {
      identifier: "sorcerer-sorcery-points",
      uses: { spent, max: 0, recovery: [] }
    }
  }, "sorcery-points");
}

function makeSorcererSpell(actor, {
  id = "chromatic-orb",
  baseLevel = 1,
  root = `${actor.sorcererClassItem.id}.advancementKnownSpell`,
  system = {},
  activity = {}
} = {}) {
  const item = makeItemFromData(actor, {
    name: "Spell",
    type: "spell",
    flags: { dnd5e: { advancementRoot: root } },
    system: {
      identifier: id,
      level: baseLevel,
      components: { vocal: true, somatic: true, material: false },
      ...system
    }
  }, id);
  return {
    actor,
    item,
    type: "spell",
    spellLevel: baseLevel,
    system: item.system,
    ...activity
  };
}

function addMetamagic(actor, metamagicId, cost, stacking = "base") {
  const item = makeItemFromData(actor, {
    name: metamagicId,
    type: "feat",
    flags: { [MODULE_ID]: { sourceType: "sorcererMetamagic", metamagicId, cost, stacking } },
    system: { identifier: metamagicId }
  }, metamagicId);
  actor.items.contents.push(item);
  return item;
}

function metamagicActor(level = 3) {
  const actor = levelActor(level, { includePoints: true });
  actor.system.abilities = { cha: { mod: 3 } };
  for (const [id, cost, stacking] of [
    ["careful-spell", 1, "base"],
    ["distant-spell", 1, "base"],
    ["heightened-spell", 3, "base"],
    ["subtle-spell", 1, "base"],
    ["extended-spell", 1, "base"],
    ["twinned-spell", "spellLevel", "base"],
    ["empowered-spell", 1, "additive"],
    ["quickened-spell", 2, "base"],
    ["seeking-spell", 2, "additive"]
  ]) addMetamagic(actor, id, cost, stacking);
  return actor;
}

function pointsItem(actor) {
  return actor.items.contents.find((item) => item.getFlag(MODULE_ID, "featureId") === "sorcerer-sorcery-points");
}

function levelActor(level, options = {}) {
  return new TestActor({ level, ...options });
}

function consumeDnd5eSpellSlot(actor, usageConfig) {
  if (!((usageConfig.consume === true) || usageConfig.consume?.spellSlot)) {
    return;
  }

  const slot = actor.system.spells?.[usageConfig.spell?.slot];
  if (slot?.value) {
    slot.value = Math.max(0, slot.value - 1);
  }
}

async function waitForDeferredActivityUse() {
  await new Promise((resolve) => setImmediate(resolve));
}

function completeReactionCheck(usageConfig) {
  return {
    ...usageConfig,
    flags: {
      ...(usageConfig?.flags ?? {}),
      [MODULE_ID]: {
        ...(usageConfig?.flags?.[MODULE_ID] ?? {}),
        reactionCheckComplete: true
      }
    }
  };
}

test("Sorcery Points synchronize to the level-three scale and recover on long rest", async () => {
  const actor = levelActor(3, { pointsSpent: 9, includePoints: true });
  const service = new SorcererAutomationService({});

  await service.syncSorceryPoints(actor);
  const points = pointsItem(actor);

  assert.equal(points.system.uses.max, 17);
  assert.deepEqual(points.system.uses.recovery, [{ period: "lr", type: "recoverAll", formula: "" }]);
  await service.handleRestCompleted(actor, { longRest: true });
  assert.equal(points.system.uses.spent, 0);
});

test("Careful Spell makes selected legal targets automatically pass a save", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["careful-spell"], targetUuids: ["Token.ally-a", "Token.ally-b"] }
  };
  const spell = makeSorcererSpell(actor, { system: { save: { ability: "dex" } } });

  assert.equal(await service.applyDnd5ePreUseActivity(spell, usageConfig, {}, {}), true);
  assert.deepEqual(usageConfig.spellCast.modifiers.careful.targets, ["Token.ally-a", "Token.ally-b"]);
  assert.equal(pointsItem(actor).system.uses.spent, 3);
});

test("Distant Spell doubles ranged spells and changes touch to thirty feet", async () => {
  const rangedActor = metamagicActor();
  const touchActor = metamagicActor();
  const rangedUsage = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["distant-spell"] } };
  const touchUsage = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["distant-spell"] } };
  const rangedService = new SorcererAutomationService({});
  const touchService = new SorcererAutomationService({});
  await rangedService.syncSorceryPoints(rangedActor);
  await touchService.syncSorceryPoints(touchActor);

  assert.equal(await rangedService.applyDnd5ePreUseActivity(
    makeSorcererSpell(rangedActor, { system: { range: { value: 60, units: "ft" } } }), rangedUsage, {}, {}
  ), true);
  assert.deepEqual(rangedUsage.spellCast.range, { value: 120, units: "ft" });
  assert.equal(await touchService.applyDnd5ePreUseActivity(
    makeSorcererSpell(touchActor, { system: { range: { value: null, units: "touch" } } }), touchUsage, {}, {}
  ), true);
  assert.deepEqual(touchUsage.spellCast.range, { value: 30, units: "ft" });
});

test("Heightened Spell gives one target disadvantage on its first spell save", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["heightened-spell"], targetUuids: ["Token.enemy"] }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { system: { save: { ability: "wis" } } }), usageConfig, {}, {}
  ), true);
  assert.equal(usageConfig.spellCast.modifiers.heightened.targetUuid, "Token.enemy");
  assert.equal(usageConfig.spellCast.modifiers.heightened.firstSaveDisadvantage, true);
  assert.equal(pointsItem(actor).system.uses.spent, 5);
});

test("Subtle Spell removes V and S from the shared cast context", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["subtle-spell"] } };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, {
    system: { components: { vocal: true, somatic: true, material: true } }
  }), usageConfig, {}, {}), true);
  assert.deepEqual(usageConfig.spellCast.components, { verbal: false, somatic: false, material: true });
  assert.deepEqual(usageConfig.flags[MODULE_ID].spellCast.components, { verbal: false, somatic: false, material: true });
});

test("Extended Spell doubles a legal duration without exceeding twenty-four hours", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["extended-spell"] } };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, {
    system: { duration: { value: 15, units: "hour" } }
  }), usageConfig, {}, {}), true);
  assert.deepEqual(usageConfig.spellCast.duration, { value: 24, units: "hour" });
});

test("Twinned Spell adds exactly one valid second target at the selected spell level cost", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererVirtualSpellLevel: 2,
    targets: ["Token.first"],
    sorcererMetamagic: { ids: ["twinned-spell"], secondTargetUuid: "Token.second" }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, {
    baseLevel: 1,
    system: { range: { value: 60, units: "ft" }, target: { affects: { count: "1" } } }
  }), usageConfig, {}, {}), true);
  assert.deepEqual(usageConfig.targets, ["Token.first", "Token.second"]);
  assert.equal(usageConfig.spellCast.modifiers.twinned.secondTargetUuid, "Token.second");
  assert.equal(pointsItem(actor).system.uses.spent, 5);
});

test("Empowered Spell rerolls selected damage dice up to the Charisma modifier", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  let rerolled = [];
  const usageConfig = {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: {
      ids: ["empowered-spell"],
      damageDice: ["0:0", "0:2"],
      rerollDamage: async (indices) => { rerolled = indices; }
    }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, {
    system: { damage: { parts: [["3d6", "fire"]] } }
  }), usageConfig, {}, {}), true);
  assert.deepEqual(rerolled, [
    { id: "0:0", label: "3d6 #1", partIndex: 0, dieIndex: 0 },
    { id: "0:2", label: "3d6 #3", partIndex: 0, dieIndex: 2 }
  ]);
  assert.deepEqual(usageConfig.spellCast.modifiers.empowered.damageDice, [
    { id: "0:0", label: "3d6 #1", partIndex: 0, dieIndex: 0 },
    { id: "0:2", label: "3d6 #3", partIndex: 0, dieIndex: 2 }
  ]);
});

test("Quickened Spell changes this cast from an action to a bonus action", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["quickened-spell"] } };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, {
    system: { activation: { type: "action", value: 1 } }
  }), usageConfig, {}, {}), true);
  assert.deepEqual(usageConfig.activation, { type: "bonus", value: 1 });
  assert.deepEqual(usageConfig.spellCast.activation, { type: "bonus", value: 1 });
});

test("Seeking Spell pays only after a missed spell attack through its real activity roll method", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({ chooseSeekingReroll: async () => true });
  await service.syncSorceryPoints(actor);
  const usageConfig = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["seeking-spell"] } };
  let rerolls = 0;
  const roll = { total: 4, isFailure: true };
  const spell = makeSorcererSpell(actor, { system: { attack: { type: "spell" } } });
  spell.rollAttack = async () => {
    rerolls += 1;
    return [{ total: 18 }];
  };

  assert.equal(await service.applyDnd5ePreUseActivity(spell, usageConfig, {}, {}), true);
  assert.equal(pointsItem(actor).system.uses.spent, 2);
  assert.equal(await service.applyDnd5ePostAttackRoll([roll], {
    subject: spell,
    ammoUpdate: null
  }), true);
  assert.equal(rerolls, 1);
  assert.equal(pointsItem(actor).system.uses.spent, 4);
});

test("Metamagic rejects incompatible stacking and unmet preconditions before payment", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["subtle-spell", "distant-spell"] }
  }, {}, {}), false);
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["heightened-spell"], targetUuids: ["Token.enemy"] }
  }, {}, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
});

test("Sorcerer casting spends points but preserves native slots", async () => {
  const actor = levelActor(1, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {};

  const result = await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), usageConfig, {}, {});

  assert.equal(result, true);
  assert.equal(pointsItem(actor).system.uses.spent, 2);
  assert.equal(usageConfig.consume.spellSlot, false);
  assert.deepEqual(usageConfig.spellCast, {
    spellLevel: 1,
    components: { vocal: true, somatic: true, material: false },
    payment: { resource: "sorcery-points", cost: 2 },
    modifiers: { cooldownOverride: false, exhaustion: 0, highLevelOverride: false }
  });
});

test("only a Sorcerer class advancement root uses virtual slots on a multiclass actor", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const sorcererUsageConfig = {};
  const usageConfig = { consumeSpellSlot: true };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor),
    sorcererUsageConfig,
    {},
    {}
  ), true);
  assert.equal(pointsItem(actor).system.uses.spent, 2);

  const result = await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { root: `${actor.wizardClassItem.id}.advancementKnownSpell` }),
    usageConfig,
    {},
    {}
  );

  assert.equal(result, true);
  assert.equal(pointsItem(actor).system.uses.spent, 2);
  assert.equal(usageConfig.consumeSpellSlot, true);
  assert.equal(usageConfig.spellCast, undefined);
});

test("a virtual level-three cast uses D&D5e slot, scaling, and consume fields without consuming a native slot", async () => {
  const actor = levelActor(5, { includePoints: true });
  actor.system.spells = {
    spell3: { level: 3, value: 1, max: 1 }
  };
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = { sorcererVirtualSpellLevel: 3 };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), usageConfig, {}, {}), true);
  assert.equal(usageConfig.consume.spellSlot, false);
  assert.equal(usageConfig.spell.slot, "spell3");
  assert.equal(usageConfig.scaling, 2);
  assert.equal(usageConfig.consumeSpellSlot, undefined);

  consumeDnd5eSpellSlot(actor, usageConfig);
  assert.equal(actor.system.spells.spell3.value, 1);
  assert.deepEqual(usageConfig.spellCast, {
    spellLevel: 3,
    components: { vocal: true, somatic: true, material: false },
    payment: { resource: "sorcery-points", cost: 5 },
    modifiers: { cooldownOverride: false, exhaustion: 0, highLevelOverride: false }
  });
});

test("a synchronous dnd5e pre-use hook completes Sorcerer preflight before one paid final cast", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  const actor = levelActor(1, { includePoints: true });
  let prompts = 0;
  let genericHookCalls = 0;
  let attackHookCalls = 0;
  const resumedUses = [];

  globalThis.Hooks = {
    on: (name, callback) => {
      const callbacks = handlers.get(name) ?? [];
      callbacks.push(callback);
      handlers.set(name, callbacks);
    }
  };
  globalThis.game = { user: { id: "user", isGM: true }, combat: { round: 1 } };

  try {
    const { registerCombatHooks } = await import("../scripts/combat/hooks.js");
    const service = new SorcererAutomationService({
      chooseVirtualSpellLevel: async () => {
        prompts += 1;
        return { accepted: true, spellLevel: 1 };
      }
    });
    await service.syncSorceryPoints(actor);
    const moduleApi = {
      sorcererAutomationService: service,
      spellAutomationService: {
        deferDnd5ePreUseActivity: (_activity, usageConfig) => {
          genericHookCalls += 1;
          usageConfig.flags ??= {};
          usageConfig.flags[MODULE_ID] ??= {};
          usageConfig.flags[MODULE_ID].reactionCheckComplete = true;
          return true;
        }
      },
      combatAttackService: {
        applyDnd5ePreUseActivity: () => {
          attackHookCalls += 1;
          return true;
        }
      }
    };
    registerCombatHooks(moduleApi);
    const preUse = handlers.get("dnd5e.preUseActivity")?.[0];
    const activity = makeSorcererSpell(actor);
    activity.use = async (...args) => {
      resumedUses.push(args);
      return preUse(activity, ...args) === true ? { updates: [] } : undefined;
    };

    const firstResult = preUse(activity, {}, {}, {});
    assert.equal(firstResult, false);
    assert.equal(typeof firstResult, "boolean");
    await waitForDeferredActivityUse();

    assert.equal(prompts, 1);
    assert.equal(resumedUses.length, 2);
    assert.equal(resumedUses[0][0][MODULE_ID].sorcererAutomationPreflight.accepted, true);
    assert.equal(resumedUses[1][0][MODULE_ID].sorcererAutomationBypass, true);
    assert.equal(pointsItem(actor).system.uses.spent, 2);
    assert.equal(genericHookCalls, 2);
    assert.equal(attackHookCalls, 1);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("a generic deferred cancellation happens after Sorcerer preflight but before payment", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  const actor = levelActor(1, { includePoints: true });
  let prompts = 0;
  let genericHookCalls = 0;
  let resumedUses = 0;

  globalThis.Hooks = {
    on: (name, callback) => {
      const callbacks = handlers.get(name) ?? [];
      callbacks.push(callback);
      handlers.set(name, callbacks);
    }
  };
  globalThis.game = { user: { id: "user", isGM: true }, combat: { round: 1 } };

  try {
    const { registerCombatHooks } = await import("../scripts/combat/hooks.js");
    const service = new SorcererAutomationService({
      chooseVirtualSpellLevel: async () => {
        prompts += 1;
        return { accepted: true, spellLevel: 1 };
      }
    });
    await service.syncSorceryPoints(actor);
    registerCombatHooks({
      sorcererAutomationService: service,
      spellAutomationService: {
        deferDnd5ePreUseActivity: () => {
          genericHookCalls += 1;
          return false;
        }
      },
      combatAttackService: { applyDnd5ePreUseActivity: () => true }
    });
    const preUse = handlers.get("dnd5e.preUseActivity")?.[0];
    const activity = makeSorcererSpell(actor);
    activity.use = async (...args) => {
      resumedUses += 1;
      return preUse(activity, ...args) === true ? { updates: [] } : undefined;
    };

    assert.equal(preUse(activity, {}, {}, {}), false);
    await waitForDeferredActivityUse();

    assert.equal(genericHookCalls, 1);
    assert.equal(prompts, 1);
    assert.equal(resumedUses, 1);
    assert.equal(pointsItem(actor).system.uses.spent, 0);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("a generic deferred resume reaches one paid Sorcerer final cast after neutral preflight", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  const actor = levelActor(5, { includePoints: true });
  const resumedUses = [];
  let prompts = 0;
  let genericHookCalls = 0;
  let attackHookCalls = 0;

  globalThis.Hooks = {
    on: (name, callback) => {
      const callbacks = handlers.get(name) ?? [];
      callbacks.push(callback);
      handlers.set(name, callbacks);
    }
  };
  globalThis.game = { user: { id: "user", isGM: true }, combat: { round: 1 } };

  try {
    const { registerCombatHooks } = await import("../scripts/combat/hooks.js");
    const service = new SorcererAutomationService({
      chooseVirtualSpellLevel: async () => {
        prompts += 1;
        return { accepted: true, spellLevel: 3, exhaustionOverride: true };
      }
    });
    await service.syncSorceryPoints(actor);
    await actor.setFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns", {
      "chromatic-orb:3": { expiresAtRound: 2 }
    });
    registerCombatHooks({
      sorcererAutomationService: service,
      spellAutomationService: {
        deferDnd5ePreUseActivity: (activity, usageConfig, dialogConfig, messageConfig) => {
          genericHookCalls += 1;
          if (usageConfig?.flags?.[MODULE_ID]?.reactionCheckComplete === true) {
            return true;
          }

          queueMicrotask(() => {
            void activity.use({
              ...usageConfig,
              [MODULE_ID]: {
                ...(usageConfig?.[MODULE_ID] ?? {}),
                spellAutomationBypass: true
              },
              flags: {
                ...(usageConfig?.flags ?? {}),
                [MODULE_ID]: {
                  ...(usageConfig?.flags?.[MODULE_ID] ?? {}),
                  reactionCheckComplete: true
                }
              }
            }, dialogConfig, messageConfig);
          });
          return false;
        }
      },
      combatAttackService: {
        applyDnd5ePreUseActivity: () => {
          attackHookCalls += 1;
          return true;
        }
      }
    });
    const preUse = handlers.get("dnd5e.preUseActivity")?.[0];
    const activity = makeSorcererSpell(actor, { baseLevel: 3 });
    activity.use = async (...args) => {
      resumedUses.push(args);
      return preUse(activity, ...args) === true ? { updates: [] } : undefined;
    };

    assert.equal(preUse(activity, {}, {}, {}), false);
    await waitForDeferredActivityUse();

    assert.equal(genericHookCalls, 3);
    assert.equal(prompts, 1);
    assert.equal(resumedUses.length, 3);
    assert.equal(resumedUses[0][0][MODULE_ID].sorcererAutomationPreflight.accepted, true);
    assert.equal(resumedUses[0][0][MODULE_ID].spellAutomationBypass, undefined);
    assert.equal(resumedUses[1][0][MODULE_ID].spellAutomationBypass, true);
    assert.equal(resumedUses[1][0].flags[MODULE_ID].reactionCheckComplete, true);
    assert.equal(resumedUses[2][0][MODULE_ID].sorcererAutomationBypass, true);
    assert.equal(pointsItem(actor).system.uses.spent, 5);
    assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
      "chromatic-orb:3": { expiresAtRound: 4 }
    });
    assert.equal(actor.system.attributes.exhaustion, 1);
    assert.equal(attackHookCalls, 1);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("a deferred virtual cast locks the resumed dialog and virtual-cast usage configuration", async () => {
  const actor = levelActor(5, { includePoints: true });
  actor.system.spells = {
    spell3: { level: 3, value: 1, max: 1 }
  };
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 3 })
  });
  await service.syncSorceryPoints(actor);
  const usageConfig = {};
  const dialogConfig = { configure: true, width: 480 };
  const messageConfig = { create: false };
  const activity = makeSorcererSpell(actor);
  const resumedUses = [];
  activity.use = async (...args) => {
    resumedUses.push(args);
    return { updates: [] };
  };

  assert.equal(service.deferDnd5ePreUseActivity(activity, usageConfig, dialogConfig, messageConfig), false);
  await waitForDeferredActivityUse();

  const [preflightUsageConfig, preflightDialogConfig, preflightMessageConfig] = resumedUses[0];
  assert.equal(preflightUsageConfig[MODULE_ID].sorcererAutomationPreflight.accepted, true);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.equal(service.finalizeDnd5ePreUseActivity(
    activity,
    completeReactionCheck(preflightUsageConfig),
    preflightDialogConfig,
    preflightMessageConfig
  ), false);
  await waitForDeferredActivityUse();

  const [resumedUsageConfig, resumedDialogConfig, resumedMessageConfig] = resumedUses[1];
  assert.notStrictEqual(resumedDialogConfig, dialogConfig);
  assert.deepEqual(dialogConfig, { configure: true, width: 480 });
  assert.deepEqual(resumedDialogConfig, { configure: false, width: 480 });
  assert.strictEqual(resumedMessageConfig, messageConfig);
  assert.equal(resumedUsageConfig.spell.slot, "spell3");
  assert.equal(resumedUsageConfig.scaling, 2);
  assert.equal(resumedUsageConfig.consume.spellSlot, false);
  assert.deepEqual(resumedUsageConfig.spellCast.payment, { resource: "sorcery-points", cost: 5 });
  assert.equal(resumedUsageConfig[MODULE_ID].sorcererAutomationBypass, true);
  assert.equal(pointsItem(actor).system.uses.spent, 5);
  assert.equal(actor.system.spells.spell3.value, 1);
});

test("a deferred virtual cast cannot open an editable dialog that overwrites its selected slot", async () => {
  const actor = levelActor(5, { includePoints: true });
  actor.system.spells = {
    spell1: { level: 1, value: 1, max: 1 },
    spell3: { level: 3, value: 1, max: 1 }
  };
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 3 })
  });
  await service.syncSorceryPoints(actor);
  const activity = makeSorcererSpell(actor);
  let editableDialogs = 0;
  const resumedUsageConfigs = [];
  activity.use = async (nextUsageConfig, nextDialogConfig) => {
    resumedUsageConfigs.push(nextUsageConfig);
    if (nextDialogConfig.configure !== false) {
      editableDialogs += 1;
      nextUsageConfig.spell = { slot: "spell1" };
      nextUsageConfig.scaling = 0;
      nextUsageConfig.consume = { spellSlot: true };
    }
    consumeDnd5eSpellSlot(actor, nextUsageConfig);
    return { updates: [] };
  };

  assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
  await waitForDeferredActivityUse();

  assert.equal(service.finalizeDnd5ePreUseActivity(
    activity,
    completeReactionCheck(resumedUsageConfigs[0]),
    { configure: false },
    {}
  ), false);
  await waitForDeferredActivityUse();
  const resumedUsageConfig = resumedUsageConfigs[1];

  assert.equal(editableDialogs, 0);
  assert.equal(resumedUsageConfig.spell.slot, "spell3");
  assert.equal(resumedUsageConfig.scaling, 2);
  assert.equal(resumedUsageConfig.consume.spellSlot, false);
  assert.equal(pointsItem(actor).system.uses.spent, 5);
  assert.equal(actor.system.spells.spell1.value, 1);
  assert.equal(actor.system.spells.spell3.value, 1);
});

test("a deferred virtual cast rolls back its payment when resumed D&D5e usage is cancelled or fails", async () => {
  for (const resumedResult of [undefined, false]) {
    const actor = levelActor(5, { includePoints: true });
    const service = new SorcererAutomationService({
      chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 3 })
    });
    await service.syncSorceryPoints(actor);
    const activity = makeSorcererSpell(actor, { baseLevel: 3 });
    let preflightUsageConfig;
    let calls = 0;
    activity.use = async (nextUsageConfig) => {
      calls += 1;
      if (calls === 1) {
        preflightUsageConfig = nextUsageConfig;
        return { updates: [] };
      }
      return resumedResult;
    };

    assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
    await waitForDeferredActivityUse();
    assert.equal(service.finalizeDnd5ePreUseActivity(
      activity,
      completeReactionCheck(preflightUsageConfig),
      { configure: false },
      {}
    ), false);
    await waitForDeferredActivityUse();

    assert.equal(pointsItem(actor).system.uses.spent, 0);
    assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {});
    assert.equal(actor.system.attributes.exhaustion, 0);
  }
});

test("virtual spell level selection uses the exact Sorcery Point table", async () => {
  const actor = levelActor(17, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);

  for (const [level, cost] of [[1, 2], [2, 3], [3, 5], [4, 6], [5, 7], [6, 9], [7, 10], [8, 11], [9, 13]]) {
    const usageConfig = { sorcererVirtualSpellLevel: level };
    const before = pointsItem(actor).system.uses.spent;
    const result = await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: `spell-${level}` }), usageConfig, {}, {});
    assert.equal(result, true);
    assert.equal(pointsItem(actor).system.uses.spent, before + cost);
    assert.equal(usageConfig.spellCast.spellLevel, level);
    assert.equal(usageConfig.spellCast.payment.cost, cost);
  }
});

test("virtual-slot prompt shows each legal level with its exact Sorcery Point cost", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const originalDialog = globalThis.DialogV2;
  let dialog;
  globalThis.DialogV2 = {
    wait: async (config) => {
      dialog = config;
      return { accepted: true, spellLevel: 2 };
    }
  };

  try {
    assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), {}, {}, {}), true);
    assert.match(dialog.content, /1.*2/u);
    assert.match(dialog.content, /2.*3/u);
    assert.match(dialog.content, /rebreya-sorcerer-choice-row/u);
    assert.match(dialog.content, /data-sorcerer-total/u);
    assert.equal(pointsItem(actor).system.uses.spent, 3);
  }
  finally {
    globalThis.DialogV2 = originalDialog;
  }
});

test("cancelled, invalid, and unaffordable virtual casts do not mutate resources", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: false })
  });
  await service.syncSorceryPoints(actor);

  const cancelledDialogConfig = {};
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), {}, cancelledDialogConfig, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.deepEqual(cancelledDialogConfig, {});

  const invalidUsage = { sorcererVirtualSpellLevel: 3 };
  assert.equal(await new SorcererAutomationService({}).applyDnd5ePreUseActivity(makeSorcererSpell(actor), invalidUsage, {}, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.equal(invalidUsage.spellCast, undefined);

  pointsItem(actor).system.uses.spent = 16;
  const unaffordableUsage = { sorcererVirtualSpellLevel: 2 };
  assert.equal(await new SorcererAutomationService({}).applyDnd5ePreUseActivity(makeSorcererSpell(actor), unaffordableUsage, {}, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 16);
  assert.equal(unaffordableUsage.spellCast, undefined);
});

test("low-level repeat casts require an exhaustion override until their cooldown expires", async () => {
  const actor = levelActor(5, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  globalThis.game.combat = { round: 10 };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), {}, {}, {}), true);
  const blockedUsage = {};
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), blockedUsage, {}, {}), false);
  assert.equal(blockedUsage.spellCast, undefined);

  const overrideUsage = { sorcererExhaustionOverride: true };
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), overrideUsage, {}, {}), true);
  assert.equal(actor.system.attributes.exhaustion, 1);
  assert.equal(overrideUsage.spellCast.modifiers.cooldownOverride, true);
  assert.equal(overrideUsage.spellCast.modifiers.exhaustion, 1);

  globalThis.game.combat = { round: 13 };
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), {}, {}, {}), true);
});

test("high-level virtual slots are limited once per level until long rest unless overridden", async () => {
  const actor = levelActor(13, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "disintegrate", baseLevel: 6 }), {}, {}, {}), true);
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "other-six", baseLevel: 6 }), {}, {}, {}), false);
  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "other-six", baseLevel: 6 }),
    { sorcererExhaustionOverride: true },
    {},
    {}
  ), true);
  assert.equal(actor.system.attributes.exhaustion, 1);

  await service.handleRestCompleted(actor, { longRest: true });
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "after-rest", baseLevel: 6 }), {}, {}, {}), true);
});

test("class item creation and level updates synchronize the owned Sorcery Points resource", async () => {
  const actor = levelActor(3);
  const service = new SorcererAutomationService({});
  const classItem = {
    type: "class",
    actor,
    system: { identifier: SORCERER_ROOT, levels: 3 },
    flags: { [MODULE_ID]: { classIdentifier: SORCERER_ROOT } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };

  await service.handleCreatedItem(classItem, {}, "user");
  assert.equal(pointsItem(actor).system.uses.max, 17);
  actor.system.scale[SORCERER_ROOT]["sorcery-points"] = 21;
  await service.handleUpdatedItem(classItem, { system: { levels: 4 } }, {}, "user");
  assert.equal(pointsItem(actor).system.uses.max, 21);
});

function makeDnd5eActivityClone(activity) {
  for (const key of ["activation", "components", "duration", "range", "target", "damage", "attack"]) {
    if (activity.system?.[key] !== undefined) {
      activity[key] = structuredClone(activity.system[key]);
    }
  }
  activity.updateSource = (patch) => {
    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(activity, path, structuredClone(value));
    }
    return activity;
  };
  return activity;
}

test("RED: resolved DialogV2 metamagic selection is persisted for the final virtual cast", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousDialog = globalThis.DialogV2;
  const responses = [
    { accepted: true, spellLevel: 1 },
    { accepted: true, ids: ["subtle-spell"] }
  ];
  globalThis.DialogV2 = { wait: async () => responses.shift() };
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor));
  const resumed = [];
  activity.use = async (usageConfig) => {
    resumed.push(usageConfig);
    return { updates: [] };
  };

  try {
    assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
    await waitForDeferredActivityUse();
    assert.deepEqual(
      resumed[0][MODULE_ID].sorcererAutomationPreflight.metamagic.ids,
      ["subtle-spell"]
    );
  }
  finally {
    globalThis.DialogV2 = previousDialog;
  }
});

test("RED: metamagic DialogV2 includes compact target and damage-die controls", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousDialog = globalThis.DialogV2;
  const dialogs = [];
  globalThis.DialogV2 = {
    wait: async (config) => {
      dialogs.push(config);
      return dialogs.length === 1
        ? { accepted: true, spellLevel: 1 }
        : { accepted: true, ids: [] };
    }
  };
  try {
    await service.applyDnd5ePreUseActivity(makeDnd5eActivityClone(makeSorcererSpell(actor, {
      system: {
        save: { ability: "dex" },
        target: { affects: { count: 1 } },
        range: { value: 60, units: "ft" },
        damage: { parts: [{ _id: "fire", formula: "2d6" }] }
      }
    })), {}, {}, {});
    const content = dialogs[1].content;
    for (const control of ["carefulTargets", "heightenedTarget", "twinnedTarget", "damageDice"]) {
      assert.match(content, new RegExp(`name=\"${control}\"`, "u"));
    }
    assert.match(content, /rebreya-sorcerer-choice-row/u);
  }
  finally {
    globalThis.DialogV2 = previousDialog;
  }
});

test("RED: final dnd5e clone consumes actual Distant, Quickened, Extended, and Subtle activity fields", async () => {
  const cases = [
    {
      id: "distant-spell",
      system: { range: { value: 60, units: "ft" } },
      actual: (activity) => assert.deepEqual(activity.range, { value: 120, units: "ft" })
    },
    {
      id: "quickened-spell",
      system: { activation: { type: "action", value: 1 } },
      actual: (activity) => assert.deepEqual(activity.activation, { type: "bonus", value: 1 })
    },
    {
      id: "extended-spell",
      system: { duration: { value: 15, units: "hour" } },
      actual: (activity) => assert.deepEqual(activity.duration, { value: 24, units: "hour" })
    },
    {
      id: "subtle-spell",
      system: { components: { vocal: true, somatic: true, material: true } },
      actual: (activity) => assert.deepEqual(activity.components, { vocal: false, somatic: false, material: true })
    }
  ];

  for (const entry of cases) {
    const actor = metamagicActor();
    const service = new SorcererAutomationService({});
    await service.syncSorceryPoints(actor);
    const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: entry.system }));
    assert.equal(await service.applyDnd5ePreUseActivity(activity, {
      sorcererVirtualSpellLevel: 1,
      sorcererMetamagic: { ids: [entry.id] }
    }, {}, {}), true);
    entry.actual(activity);
  }
});

test("RED: hooks use the installed dnd5e save, damage, and attack hook contracts", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  globalThis.Hooks = {
    on: (name, callback) => handlers.set(name, callback)
  };
  globalThis.game = { user: { id: "user", isGM: true }, combat: { round: 1 } };
  try {
    const { registerCombatHooks } = await import("../scripts/combat/hooks.js");
    registerCombatHooks({ sorcererAutomationService: new SorcererAutomationService({}) });
    assert.equal(typeof handlers.get("dnd5e.preRollSavingThrow"), "function");
    assert.equal(typeof handlers.get("dnd5e.preRollDamage"), "function");
    assert.equal(typeof handlers.get("dnd5e.rollAttack"), "function");
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RED: Seeking uses a pre-use pending record with the real rollAttack context shape", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({ chooseSeekingReroll: async () => true });
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { attack: { type: "spell" } } }));
  activity.rollAttack = async () => [{ total: 18 }];
  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["seeking-spell"] }
  }, {}, {}), true);
  const missedRoll = { isFailure: true, total: 4 };
  assert.equal(await service.applyDnd5ePostAttackRoll([missedRoll], {
    subject: activity,
    ammoUpdate: null
  }), true);
  assert.equal(pointsItem(actor).system.uses.spent, 4);
});

test("real save-roll config consumes Careful success and one Heightened disadvantage from a usage message", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  const message = {
    id: "usage-message",
    getFlag: (_scope, key) => key === "saveOverrides"
      ? {
        carefulTargetUuids: ["Actor.ally"],
        heightenedTargetUuid: "Actor.enemy",
        heightenedUsed: false
      }
      : undefined
  };
  service.handleDnd5ePostCreateUsageMessage(null, message);
  const eventFor = () => ({ target: { closest: () => ({ dataset: { messageId: "usage-message" } }) } });

  const carefulConfig = { subject: { uuid: "Actor.ally" }, event: eventFor(), rolls: [{ options: { target: 17 } }] };
  assert.equal(service.applyDnd5ePreRollSavingThrow(carefulConfig), true);
  assert.equal(carefulConfig.target, 0);
  assert.equal(carefulConfig.rolls[0].options.target, 0);

  const heightenedConfig = { subject: { uuid: "Actor.enemy" }, event: eventFor(), rolls: [{ options: {} }] };
  assert.equal(service.applyDnd5ePreRollSavingThrow(heightenedConfig), true);
  assert.equal(heightenedConfig.disadvantage, true);
  assert.equal(heightenedConfig.rolls[0].options.disadvantage, true);
  const secondSave = { subject: { uuid: "Actor.enemy" }, event: eventFor(), rolls: [{ options: {} }] };
  service.applyDnd5ePreRollSavingThrow(secondSave);
  assert.equal(secondSave.disadvantage, undefined);
});

test("Twinned validates document ids and applies exactly the two native target ids before payment", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousFromUuid = globalThis.fromUuid;
  const previousGame = globalThis.game;
  const docs = new Map([
    ["Token.first", { id: "first", actor: { uuid: "Actor.first" } }],
    ["Token.second", { id: "second", actor: { uuid: "Actor.second" } }]
  ]);
  const targetSets = [];
  globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
  globalThis.game = {
    ...previousGame,
    user: {
      ...(previousGame?.user ?? {}),
      updateTokenTargets: async (ids) => targetSets.push(Array.from(ids).sort())
    }
  };
  try {
    const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
      baseLevel: 1,
      system: { range: { value: 60, units: "ft" }, target: { affects: { count: 1 } } }
    }));
    assert.equal(await service.applyDnd5ePreUseActivity(activity, {
      sorcererVirtualSpellLevel: 1,
      sorcererMetamagic: {
        ids: ["twinned-spell"],
        targets: ["Token.first"],
        secondTargetUuid: "Token.second"
      }
    }, {}, {}), true);
    assert.deepEqual(targetSets, [["first", "second"]]);
    assert.equal(pointsItem(actor).system.uses.spent, 3);
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
    globalThis.game = previousGame;
  }
});

test("Empowered rerolls only selected real Die results and updates the real damage message", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "fire", formula: "1d6" }] } }
  }));
  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["empowered-spell"], damageDice: ["fire:0"] }
  }, {}, {}), true);
  let rerolls = 0;
  let messageUpdate;
  const term = {
    results: [{ result: 1, active: true }],
    async roll(options) {
      rerolls += 1;
      assert.deepEqual(options, { reroll: true });
      this.results.push({ result: 6, active: true });
    }
  };
  const roll = {
    terms: [term],
    _evaluateTotal: () => 6,
    toJSON: () => ({ formula: "1d6", total: 6 }),
    parent: { update: async (patch) => { messageUpdate = patch; } }
  };
  assert.equal(await service.applyDnd5ePostDamageRoll([roll], { subject: activity }), true);
  assert.equal(rerolls, 1);
  assert.equal(term.results[0].rerolled, true);
  assert.equal(term.results[0].active, false);
  assert.deepEqual(messageUpdate, { rolls: [{ formula: "1d6", total: 6 }] });
});

test("Empowered follows the originating dnd5e usage-message record when the damage activity is reloaded", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  const message = {
    id: "usage-card",
    getFlag: (_scope, key) => key === "damageReroll" ? { selectedDamageDice: ["fire:0"] } : undefined
  };
  service.handleDnd5ePostCreateUsageMessage(null, message);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "fire", formula: "1d6" }] } }
  }));
  let rerolls = 0;
  const term = {
    results: [{ result: 1, active: true }],
    async roll() { rerolls += 1; this.results.push({ result: 5, active: true }); }
  };
  const roll = {
    terms: [term],
    _evaluateTotal: () => 5,
    toJSON: () => ({}),
    parent: { flags: { dnd5e: { originatingMessage: "usage-card" } }, update: async () => {} }
  };
  await service.applyDnd5ePostDamageRoll([roll], { subject: activity });
  assert.equal(rerolls, 1);
});

test("forged target and damage-die ids fail before any Sorcery Point payment", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousFromUuid = globalThis.fromUuid;
  globalThis.fromUuid = async () => null;
  try {
    const careful = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { save: { ability: "dex" } } }));
    assert.equal(await service.applyDnd5ePreUseActivity(careful, {
      sorcererVirtualSpellLevel: 1,
      sorcererMetamagic: { ids: ["careful-spell"], targetUuids: ["Token.forged"] }
    }, {}, {}), false);
    const empowered = makeDnd5eActivityClone(makeSorcererSpell(actor, {
      system: { damage: { parts: [{ _id: "fire", formula: "1d6" }] } }
    }));
    assert.equal(await service.applyDnd5ePreUseActivity(empowered, {
      sorcererVirtualSpellLevel: 1,
      sorcererMetamagic: { ids: ["empowered-spell"], damageDice: ["fire:99"] }
    }, {}, {}), false);
    assert.equal(pointsItem(actor).system.uses.spent, 0);
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
  }
});

test("RED: numeric forged Empowered die ids fail before payment", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "fire", formula: "1d6" }] } }
  }));
  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["empowered-spell"], damageDice: ["999"] }
  }, {}, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
});

test("RED: save overrides rehydrate from the persisted usage message on a target-owner client", () => {
  const previousGame = globalThis.game;
  const service = new SorcererAutomationService({});
  const message = {
    getFlag: (_scope, key) => key === "saveOverrides"
      ? { carefulTargetUuids: ["Actor.ally"], heightenedTargetUuid: null, heightenedUsed: false }
      : undefined
  };
  globalThis.game = { ...previousGame, messages: { get: (id) => id === "remote-usage" ? message : null } };
  try {
    const config = {
      subject: { uuid: "Actor.ally" },
      event: { target: { closest: () => ({ dataset: { messageId: "remote-usage" } }) } },
      rolls: [{ options: { target: 14 } }]
    };
    service.applyDnd5ePreRollSavingThrow(config);
    assert.equal(config.rolls[0].options.target, 0);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("RED: Subtle removes native dnd5e vocal and somatic item properties on the temporary clone", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { properties: new Set(["vocal", "somatic", "material"]) }
  }));
  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["subtle-spell"] }
  }, {}, {}), true);
  assert.deepEqual(Array.from(activity.item.system.properties).sort(), ["material"]);
});

test("RED: Seeking reroll retains dnd5e's originating usage-message reference", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({ chooseSeekingReroll: async () => true });
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { attack: { type: "spell" } } }));
  let messageConfig;
  activity.rollAttack = async (_config, _dialog, message) => { messageConfig = message; return [{ total: 18 }]; };
  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["seeking-spell"] }
  }, {}, {}), true);
  await service.applyDnd5ePostAttackRoll([{ isFailure: true, parent: { flags: { dnd5e: { originatingMessage: "usage-card" } } } }], {
    subject: activity,
    ammoUpdate: null
  });
  assert.equal(messageConfig.data["flags.dnd5e.originatingMessage"], "usage-card");
});

test("RED: simultaneous virtual casts serialize Sorcery Point payment for one actor", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const first = makeDnd5eActivityClone(makeSorcererSpell(actor, { id: "first" }));
  const second = makeDnd5eActivityClone(makeSorcererSpell(actor, { id: "second" }));
  const results = await Promise.all([
    service.applyDnd5ePreUseActivity(first, {}, {}, {}),
    service.applyDnd5ePreUseActivity(second, {}, {}, {})
  ]);
  assert.deepEqual(results, [true, true]);
  assert.equal(pointsItem(actor).system.uses.spent, 4);
});

test("RED: a canceled final cast holds its actor payment lock through rollback", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 1 })
  });
  await service.syncSorceryPoints(actor);
  let releaseFirstFinal;
  const firstFinal = new Promise((resolve) => { releaseFirstFinal = resolve; });
  let firstFinalStarted;
  const firstStarted = new Promise((resolve) => { firstFinalStarted = resolve; });
  let secondFinalStarted;
  const secondStarted = new Promise((resolve) => { secondFinalStarted = resolve; });
  const makeDeferredActivity = (id, finalUse) => {
    const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, { id }));
    let calls = 0;
    let preflight;
    activity.use = async (usageConfig) => {
      calls += 1;
      if (calls === 1) {
        preflight = usageConfig;
        return { updates: [] };
      }
      return finalUse();
    };
    return { activity, preflight: () => preflight };
  };
  const first = makeDeferredActivity("first-final", async () => {
    firstFinalStarted();
    return firstFinal;
  });
  const second = makeDeferredActivity("second-final", async () => {
    secondFinalStarted();
    return { updates: [] };
  });

  assert.equal(service.deferDnd5ePreUseActivity(first.activity, {}, {}, {}), false);
  assert.equal(service.deferDnd5ePreUseActivity(second.activity, {}, {}, {}), false);
  await waitForDeferredActivityUse();
  assert.equal(service.finalizeDnd5ePreUseActivity(first.activity, completeReactionCheck(first.preflight()), {}, {}), false);
  await firstStarted;
  assert.equal(pointsItem(actor).system.uses.spent, 2);
  assert.equal(service.finalizeDnd5ePreUseActivity(second.activity, completeReactionCheck(second.preflight()), {}, {}), false);
  await waitForDeferredActivityUse();
  assert.equal(pointsItem(actor).system.uses.spent, 2);

  releaseFirstFinal(undefined);
  await secondStarted;
  await waitForDeferredActivityUse();
  assert.equal(pointsItem(actor).system.uses.spent, 2);
});

test("deferred Distant plan keeps one resolved range across every temporary activity clone", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 1 }),
    chooseMetamagic: async () => ({ accepted: true, ids: ["distant-spell"] })
  });
  await service.syncSorceryPoints(actor);
  const initial = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { range: { value: 60, units: "ft" } } }));
  const resumed = [];
  initial.use = async (usageConfig) => { resumed.push(usageConfig); return { updates: [] }; };
  assert.equal(service.deferDnd5ePreUseActivity(initial, {}, {}, {}), false);
  await waitForDeferredActivityUse();
  const preflight = resumed[0];
  const firstClone = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { range: { value: 60, units: "ft" } } }));
  const secondClone = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { range: { value: 120, units: "ft" } } }));
  assert.equal(service.deferDnd5ePreUseActivity(firstClone, preflight, {}, {}), true);
  assert.equal(service.deferDnd5ePreUseActivity(secondClone, preflight, {}, {}), true);
  assert.deepEqual(firstClone.range, { value: 120, units: "ft" });
  assert.deepEqual(secondClone.range, { value: 120, units: "ft" });
});

test("failed final Twinned cast restores the prior native target selection with its Sorcery Points", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 1 }),
    chooseMetamagic: async () => ({
      accepted: true,
      ids: ["twinned-spell"],
      targets: ["Token.first"],
      secondTargetUuid: "Token.second"
    })
  });
  await service.syncSorceryPoints(actor);
  const previousFromUuid = globalThis.fromUuid;
  const previousGame = globalThis.game;
  const targetSets = [];
  globalThis.fromUuid = async (uuid) => ({
    id: uuid === "Token.first" ? "first" : "second",
    actor: { uuid: uuid === "Token.first" ? "Actor.first" : "Actor.second" }
  });
  globalThis.game = {
    ...previousGame,
    user: {
      ...(previousGame?.user ?? {}),
      targets: new Set([{ id: "original" }]),
      updateTokenTargets: async (ids) => targetSets.push(Array.from(ids).sort())
    }
  };
  try {
    const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
      system: { range: { value: 60, units: "ft" }, target: { affects: { count: 1 } } }
    }));
    let preflight;
    let calls = 0;
    activity.use = async (usageConfig) => {
      calls += 1;
      if (calls === 1) {
        preflight = usageConfig;
        return { updates: [] };
      }
      return undefined;
    };
    assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
    await waitForDeferredActivityUse();
    assert.equal(service.finalizeDnd5ePreUseActivity(activity, completeReactionCheck(preflight), {}, {}), false);
    await waitForDeferredActivityUse();
    assert.deepEqual(targetSets, [["first", "second"], ["original"]]);
    assert.equal(pointsItem(actor).system.uses.spent, 0);
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
    globalThis.game = previousGame;
  }
});
