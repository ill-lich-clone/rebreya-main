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
  root = SORCERER_ROOT
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
  assert.equal(usageConfig.consumeSpellSlot, false);
  assert.deepEqual(usageConfig.spellCast, {
    spellLevel: 1,
    components: { vocal: true, somatic: true, material: false },
    payment: { resource: "sorcery-points", cost: 2 },
    modifiers: { cooldownOverride: false, exhaustion: 0, highLevelOverride: false }
  });
});

test("only Sorcerer-root spell advancements use virtual slots", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = { consumeSpellSlot: true };

  const result = await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { root: "wizard-rework" }),
    usageConfig,
    {},
    {}
  );

  assert.equal(result, true);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.equal(usageConfig.consumeSpellSlot, true);
  assert.equal(usageConfig.spellCast, undefined);
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
