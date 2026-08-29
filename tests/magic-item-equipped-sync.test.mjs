import test from "node:test";
import assert from "node:assert/strict";

const MODULE_ID = "rebreya-main";
const embeddedSync = await import("../scripts/data/magic-item-embedded-sync.js");

function moduleFlags(overrides = {}) {
  return { [MODULE_ID]: { ...overrides } };
}

function managedEffect({ id = "managed-effect-01", value = "+1", managed = true } = {}) {
  return {
    _id: id,
    name: "Managed bonus",
    changes: [{ key: "system.bonuses.abilities.save", mode: 2, value, priority: 20 }],
    flags: managed ? moduleFlags({ magicItemAutomation: true }) : {}
  };
}

function managedActivity({ id = "managed-activity", cost = "1", spent = 0, managed = true } = {}) {
  return {
    _id: id,
    type: "cast",
    name: "Hellish Rebuke",
    spell: { uuid: "Compendium.dnd5e.spells24.Item.phbsplHellishReb" },
    consumption: {
      targets: [{ type: "itemUses", target: "", value: cost }]
    },
    uses: { spent, max: "", recovery: [] },
    flags: managed ? moduleFlags({ magicItemAutomation: true }) : {}
  };
}

function makeIndex() {
  return embeddedSync.buildMagicItemIdentityIndex([
    { id: "ночные-очки", name: "Ночные очки" },
    { id: "механистический-амулет", name: "Механистический амулет" },
    { id: "уроборос", name: "Уроборос" },
    { id: "живые-перчатки", name: "Живые перчатки" },
    { id: "оружие-1", name: "Оружие +1" },
    { id: "доспех-1", name: "Доспех +1" }
  ], [
    {
      uuid: "Compendium.world.rebreya-magic-items.Item.nightGoggles0001",
      name: "Ночные очки",
      flags: moduleFlags({ magicItemId: "ночные-очки" })
    }
  ]);
}

test("embedded identity resolves exact evidence and defers the excluded world cards", () => {
  const index = makeIndex();

  assert.deepEqual(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Goggles of Night",
    flags: {},
    _stats: {}
  }, index), {
    status: "resolved",
    magicItemId: "ночные-очки",
    reason: "registered-alias",
    identityPatch: {}
  });

  assert.deepEqual(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Ночные очки",
    flags: {},
    _stats: { compendiumSource: "Compendium.world.rebreya-magic-items.Item.nightGoggles0001" }
  }, index).magicItemId, "ночные-очки");

  for (const name of [
    "Особый Кинжал телепортации",
    "Зелье заживления ран",
    "Зелье лечения 1-го уровня"
  ]) {
    assert.deepEqual(embeddedSync.resolveEmbeddedMagicItemIdentity({
      name,
      flags: moduleFlags({ magicItemId: "механистический-амулет" })
    }, index), {
      status: "deferred",
      reason: "deferred-current-iteration"
    });
  }

  assert.equal(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Механистический амулет",
    flags: moduleFlags({ magicItemId: "ночные-очки" })
  }, index).status, "unresolved");

  assert.deepEqual(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Кольцо характеристики +1 (Сила)",
    flags: moduleFlags({
      magicItemId: "механистический-амулет",
      sourceType: "magicItem"
    })
  }, index), {
    status: "resolved",
    magicItemId: "уроборос",
    reason: "cassidy-strength-ring-migration",
    choice: { ability: "str" },
    identityPatch: { magicItemId: "уроборос", sourceType: "magicItem" }
  });

  assert.equal(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Совсем другой амулет",
    flags: moduleFlags({ magicItemId: "механистический-амулет" })
  }, index).status, "unresolved");
});

test("embedded identity handles explicit choices, native external items, and exact generic bonuses", () => {
  const index = makeIndex();

  assert.equal(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Уроборос (Ловкость)",
    flags: moduleFlags({ magicItemId: "уроборос" })
  }, index).choice.ability, "dex");
  assert.equal(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Уроборос",
    flags: moduleFlags({ magicItemId: "уроборос" })
  }, index).status, "unresolved-choice");

  assert.deepEqual(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Плащ защиты",
    flags: {},
    _stats: { compendiumSource: "Compendium.dnd5e.items.Item.cloakProtection" }
  }, index), {
    status: "native",
    reason: "native-external"
  });

  assert.equal(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Боевой топор +1",
    type: "weapon",
    system: { magicalBonus: 1 },
    flags: {}
  }, index).magicItemId, "оружие-1");
  assert.equal(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Латы +1",
    type: "equipment",
    system: { armor: { magicalBonus: 1 } },
    flags: {}
  }, index).magicItemId, "доспех-1");
  assert.equal(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Боевой топор +1",
    type: "weapon",
    system: { magicalBonus: 2 },
    flags: {}
  }, index).status, "unresolved");
});

test("compendium projection detaches only managed automation documents", () => {
  const customEffect = managedEffect({ id: "custom-effect", managed: false });
  const customActivity = managedActivity({ id: "custom-activity", managed: false });
  const source = {
    effects: [managedEffect(), customEffect],
    system: {
      activities: {
        "managed-activity": managedActivity(),
        "custom-activity": customActivity
      },
      uses: { spent: 0, max: "3", recovery: [] }
    },
    flags: moduleFlags({
      magicItemId: "печатка-гильдии-ракдоса",
      signature: "signature-1",
      magicItemAutomation: { version: 1, kind: "activities" }
    })
  };
  const packItem = { toObject: () => source };

  const projection = embeddedSync.buildMagicItemAutomationProjection(packItem);

  assert.deepEqual(projection, {
    magicItemId: "печатка-гильдии-ракдоса",
    signature: "signature-1",
    automationDefinition: { version: 1, kind: "activities" },
    effects: [managedEffect()],
    activities: { "managed-activity": managedActivity() },
    uses: { spent: 0, max: "3", recovery: [] }
  });
  source.effects[0].changes[0].value = "+9";
  assert.equal(projection.effects[0].changes[0].value, "+1");
});

test("embedded merge replaces only managed automation and preserves runtime state", () => {
  const customEffect = managedEffect({ id: "custom-effect-001", value: "+3", managed: false });
  customEffect.changes[0].key = "system.skills.arc.bonuses.check";
  const customActivity = {
    _id: "custom-activity1",
    type: "utility",
    name: "Custom action",
    consumption: { targets: [] },
    flags: {}
  };
  const item = {
    _id: "owned-item-0001",
    name: "Печатка гильдии Ракдоса",
    img: "custom.webp",
    system: {
      quantity: 2,
      equipped: true,
      attuned: true,
      uses: { spent: 2, max: "2", recovery: [] },
      activities: {
        "managed-activity": managedActivity({ spent: 1 }),
        "custom-activity1": customActivity
      },
      container: "belt-container",
      durability: { value: 7 }
    },
    effects: [managedEffect({ value: "+9" }), customEffect],
    flags: moduleFlags({
      magicItemId: "печатка-гильдии-ракдоса",
      heldHands: ["left"],
      upgrades: { rank: 2 },
      customFlag: true
    })
  };
  const projection = {
    magicItemId: "печатка-гильдии-ракдоса",
    signature: "canonical-signature",
    automationDefinition: { version: 1, kind: "activities" },
    effects: [managedEffect({ value: "+1" })],
    activities: { "managed-activity": managedActivity({ spent: 0 }) },
    uses: {
      spent: 0,
      max: "3",
      recovery: [{ period: "dawn", type: "formula", formula: "1d3" }]
    }
  };
  const resolution = {
    status: "resolved",
    magicItemId: "печатка-гильдии-ракдоса",
    reason: "stable-id",
    identityPatch: {}
  };

  const result = embeddedSync.buildEmbeddedMagicItemPatch(item, projection, resolution);

  assert.equal(result.status, "updated");
  assert.equal(result.update._id, item._id);
  assert.equal(Object.hasOwn(result.update, "name"), false);
  assert.equal(Object.hasOwn(result.update, "img"), false);
  assert.equal(Object.hasOwn(result.update.system, "quantity"), false);
  assert.equal(Object.hasOwn(result.update.system, "equipped"), false);
  assert.equal(result.update.system.uses.spent, 2);
  assert.equal(result.update.system.uses.max, "3");
  assert.equal(result.update.system.activities["managed-activity"].uses.spent, 1);
  assert.deepEqual(result.update.system.activities["custom-activity1"], customActivity);
  assert.deepEqual(result.update.effects.find((effect) => effect._id === customEffect._id), customEffect);
  assert.equal(result.update.effects.filter((effect) => effect._id === "managed-effect-01").length, 1);
  assert.deepEqual(result.update.flags[MODULE_ID].heldHands, ["left"]);
  assert.deepEqual(result.update.flags[MODULE_ID].upgrades, { rank: 2 });
  assert.equal(result.update.flags[MODULE_ID].customFlag, true);
  assert.equal(result.update.flags[MODULE_ID].signature, "canonical-signature");
});

test("embedded merge suppresses equivalent custom automation, refuses conflicts, and becomes a no-op", () => {
  const equivalentEffect = managedEffect({ id: "custom-equivalent", managed: false });
  const baseItem = {
    _id: "owned-item-0002",
    name: "Камень удачи",
    system: { activities: {}, uses: null },
    effects: [equivalentEffect],
    flags: moduleFlags({ magicItemId: "камень-удачи" })
  };
  const projection = {
    magicItemId: "камень-удачи",
    signature: "sig-1",
    automationDefinition: { version: 1, kind: "passive" },
    effects: [managedEffect()],
    activities: {},
    uses: null
  };
  const resolution = {
    status: "resolved",
    magicItemId: "камень-удачи",
    reason: "stable-id",
    identityPatch: {}
  };

  const equivalent = embeddedSync.buildEmbeddedMagicItemPatch(baseItem, projection, resolution);
  assert.equal(equivalent.status, "updated");
  assert.deepEqual(equivalent.update.effects, [equivalentEffect]);

  const applied = structuredClone(baseItem);
  applied.effects = equivalent.update.effects;
  applied.system = { ...applied.system, ...equivalent.update.system };
  applied.flags = equivalent.update.flags;
  assert.deepEqual(embeddedSync.buildEmbeddedMagicItemPatch(applied, projection, resolution), {
    status: "unchanged"
  });

  const conflictItem = structuredClone(baseItem);
  conflictItem.effects[0].changes[0].value = "+2";
  assert.deepEqual(embeddedSync.buildEmbeddedMagicItemPatch(conflictItem, projection, resolution), {
    status: "unresolved",
    reason: "automation-conflict"
  });
});
