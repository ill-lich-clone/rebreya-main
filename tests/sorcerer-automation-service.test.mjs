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
  root = `${actor.sorcererClassItem.id}.advancementKnownSpell`
} = {}) {
  const item = makeItemFromData(actor, {
    name: "Spell",
    type: "spell",
    flags: { dnd5e: { advancementRoot: root } },
    system: {
      identifier: id,
      level: baseLevel,
      components: { vocal: true, somatic: true, material: false }
    }
  }, id);
  return {
    actor,
    item,
    type: "spell",
    spellLevel: baseLevel,
    system: item.system
  };
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

test("a synchronous dnd5e pre-use hook defers a Sorcerer cast and resumes it once with a bypass marker", async () => {
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
        deferDnd5ePreUseActivity: () => {
          genericHookCalls += 1;
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
    assert.equal(resumedUses.length, 1);
    assert.equal(resumedUses[0][0][MODULE_ID].sorcererAutomationBypass, true);
    assert.equal(pointsItem(actor).system.uses.spent, 2);
    assert.equal(genericHookCalls, 2);
    assert.equal(attackHookCalls, 1);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("a generic deferred cancellation happens before a Sorcerer prompt or payment", async () => {
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
    assert.equal(prompts, 0);
    assert.equal(resumedUses, 0);
    assert.equal(pointsItem(actor).system.uses.spent, 0);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("a generic deferred resume reaches a paid Sorcerer final cast with both bypass markers", async () => {
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
          if (usageConfig?.[MODULE_ID]?.spellAutomationBypass === true) {
            return true;
          }

          queueMicrotask(() => {
            void activity.use({
              ...usageConfig,
              [MODULE_ID]: {
                ...(usageConfig?.[MODULE_ID] ?? {}),
                spellAutomationBypass: true
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
    assert.equal(resumedUses.length, 2);
    assert.equal(resumedUses[0][0][MODULE_ID].spellAutomationBypass, true);
    assert.equal(resumedUses[0][0][MODULE_ID].sorcererAutomationBypass, undefined);
    assert.equal(resumedUses[1][0][MODULE_ID].spellAutomationBypass, true);
    assert.equal(resumedUses[1][0][MODULE_ID].sorcererAutomationBypass, true);
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
  let resumedUse;
  activity.use = async (...args) => {
    resumedUse = args;
    return { updates: [] };
  };

  assert.equal(service.deferDnd5ePreUseActivity(activity, usageConfig, dialogConfig, messageConfig), false);
  await waitForDeferredActivityUse();

  const [resumedUsageConfig, resumedDialogConfig, resumedMessageConfig] = resumedUse;
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
  let resumedUsageConfig;
  activity.use = async (nextUsageConfig, nextDialogConfig) => {
    resumedUsageConfig = nextUsageConfig;
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
    activity.use = async () => resumedResult;

    assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
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
