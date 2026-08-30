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

test("embedded identity trusts a known stable id after the Rebreya magic equipment template renames the item", () => {
  const index = makeIndex();

  assert.deepEqual(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Ночные очки (Очки)",
    type: "equipment",
    flags: moduleFlags({
      sourceType: "magicItem",
      magicItemId: "ночные-очки",
      magicEquipmentTemplate: true,
      magicEquipmentGearId: "очки"
    })
  }, index), {
    status: "resolved",
    magicItemId: "ночные-очки",
    reason: "trusted-template-stable-id",
    identityPatch: {}
  });

  assert.equal(embeddedSync.resolveEmbeddedMagicItemIdentity({
    name: "Совсем другой амулет",
    flags: moduleFlags({ magicItemId: "ночные-очки" })
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

test("embedded merge lets manual effect keys override managed automation and becomes a no-op", () => {
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
  const manualOverride = embeddedSync.buildEmbeddedMagicItemPatch(conflictItem, projection, resolution);
  assert.equal(manualOverride.status, "updated");
  assert.deepEqual(manualOverride.update.effects, conflictItem.effects);
});

test("embedded merge removes a managed duplicate while retaining uncovered managed changes", () => {
  const manualStrength = {
    _id: "manual-strength",
    name: "Пояс силы холмового великана",
    changes: [{
      key: "system.abilities.str.value",
      mode: 2,
      value: "+3",
      priority: null
    }],
    flags: {}
  };
  const projectedBelt = {
    _id: "managed-belt",
    name: "Пояс силы холмового великана: Сила холмового великана",
    changes: [
      { key: "system.abilities.str.value", mode: 2, value: "+3", priority: 20 },
      { key: "system.abilities.str.max", mode: 4, value: "21", priority: 20 }
    ],
    flags: moduleFlags({ magicItemAutomation: true })
  };
  const item = {
    _id: "owned-belt",
    name: "Пояс силы холмового великана",
    system: { activities: {}, uses: null },
    effects: [structuredClone(projectedBelt), manualStrength],
    flags: moduleFlags({ magicItemId: "пояс-силы-холмового-великана" })
  };

  const patch = embeddedSync.buildEmbeddedMagicItemPatch(item, {
    magicItemId: "пояс-силы-холмового-великана",
    signature: "belt-signature",
    automationDefinition: { version: 1, kind: "passive" },
    effects: [projectedBelt],
    activities: {},
    uses: null
  }, {
    status: "resolved",
    magicItemId: "пояс-силы-холмового-великана",
    reason: "stable-id",
    identityPatch: {}
  });

  assert.equal(patch.status, "updated");
  assert.equal(patch.update.effects.length, 2);
  assert.deepEqual(patch.update.effects[0], manualStrength);
  assert.deepEqual(patch.update.effects[1].changes, [{
    key: "system.abilities.str.max",
    mode: 4,
    value: "21",
    priority: 20
  }]);

  const applied = structuredClone(item);
  applied.effects = patch.update.effects;
  applied.system = { ...applied.system, ...patch.update.system };
  applied.flags = patch.update.flags;
  assert.deepEqual(embeddedSync.buildEmbeddedMagicItemPatch(applied, {
    magicItemId: "пояс-силы-холмового-великана",
    signature: "belt-signature",
    automationDefinition: { version: 1, kind: "passive" },
    effects: [projectedBelt],
    activities: {},
    uses: null
  }, {
    status: "resolved",
    magicItemId: "пояс-силы-холмового-великана",
    reason: "stable-id",
    identityPatch: {}
  }), { status: "unchanged" });
});

test("embedded merge migrates equivalent legacy spell activities and preserves spent uses", () => {
  const legacyActivity = managedActivity({
    id: "legacy-activity",
    spent: 1,
    managed: false
  });
  legacyActivity.consumption.targets[0].scaling = {};
  const projectedActivity = managedActivity({
    id: "managed-activity",
    spent: 0,
    managed: true
  });
  const item = {
    _id: "owned-instrument",
    name: "Лира Кли",
    effects: [],
    system: {
      activities: { "legacy-activity": legacyActivity },
      uses: null
    },
    flags: moduleFlags({ magicItemId: "лира-кли" })
  };

  const patch = embeddedSync.buildEmbeddedMagicItemPatch(item, {
    magicItemId: "лира-кли",
    signature: "instrument-signature",
    automationDefinition: null,
    effects: [],
    activities: { "managed-activity": projectedActivity },
    uses: null
  }, {
    status: "resolved",
    magicItemId: "лира-кли",
    reason: "stable-id",
    identityPatch: {}
  });

  assert.equal(patch.status, "updated");
  assert.equal(Object.hasOwn(patch.update.system.activities, "legacy-activity"), false);
  assert.equal(patch.update.system.activities["managed-activity"].uses.spent, 1);
  assert.equal(
    patch.update.system.activities["managed-activity"].flags[MODULE_ID].magicItemAutomation,
    true
  );

  const applied = structuredClone(item);
  applied.system = { ...applied.system, ...patch.update.system };
  applied.flags = patch.update.flags;
  assert.deepEqual(embeddedSync.buildEmbeddedMagicItemPatch(applied, {
    magicItemId: "лира-кли",
    signature: "instrument-signature",
    automationDefinition: null,
    effects: [],
    activities: { "managed-activity": projectedActivity },
    uses: null
  }, {
    status: "resolved",
    magicItemId: "лира-кли",
    reason: "stable-id",
    identityPatch: {}
  }), { status: "unchanged" });
});

test("embedded merge recognizes current Foundry effect and activity collections as already applied", () => {
  const effectSource = managedEffect();
  const activitySource = managedActivity();
  const asFoundryCollection = (sources) => {
    const documents = sources.map((source) => ({
      ...structuredClone(source),
      id: source._id,
      toObject: () => structuredClone(source)
    }));
    const collection = {};
    Object.defineProperty(collection, "contents", { enumerable: false, value: documents });
    Object.defineProperty(collection, "values", {
      enumerable: false,
      value: () => documents.values()
    });
    return collection;
  };
  const projection = {
    magicItemId: "печатка-гильдии-ракдоса",
    signature: "live-signature",
    automationDefinition: { version: 1, kind: "activities" },
    effects: [effectSource],
    activities: { "managed-activity": activitySource },
    uses: { spent: 0, max: "3", recovery: [] }
  };
  const item = {
    _id: "live-owned-item",
    name: "Печатка гильдии Ракдоса",
    effects: asFoundryCollection([effectSource]),
    system: {
      activities: asFoundryCollection([activitySource]),
      uses: { spent: 0, max: "3", recovery: [] }
    },
    flags: moduleFlags({
      sourceType: "magicItem",
      magicItemId: "печатка-гильдии-ракдоса",
      signature: "live-signature",
      magicItemAutomation: { version: 1, kind: "activities" }
    }),
    toObject: () => ({
      _id: "live-owned-item",
      name: "Печатка гильдии Ракдоса",
      effects: [structuredClone(effectSource)],
      system: {
        activities: { "managed-activity": structuredClone(activitySource) },
        uses: { spent: 0, max: "3", recovery: [] }
      },
      flags: moduleFlags({
        sourceType: "magicItem",
        magicItemId: "печатка-гильдии-ракдоса",
        signature: "live-signature",
        magicItemAutomation: { version: 1, kind: "activities" }
      })
    })
  };

  assert.deepEqual(embeddedSync.buildEmbeddedMagicItemPatch(item, projection, {
    status: "resolved",
    magicItemId: "печатка-гильдии-ракдоса",
    reason: "stable-id",
    identityPatch: {}
  }), { status: "unchanged" });
});

test("embedded merge omits midi-qol's transient empty on-use macro list", () => {
  const effectSource = managedEffect();
  const projection = {
    magicItemId: "щит-3",
    signature: "new-signature",
    automationDefinition: { version: 1, kind: "passive" },
    effects: [effectSource],
    activities: {},
    uses: null
  };
  const item = {
    _id: "live-shield-item",
    name: "Щит +3",
    effects: [effectSource],
    system: { activities: {}, uses: null },
    flags: {
      ...moduleFlags({
        sourceType: "magicItem",
        magicItemId: "щит-3",
        signature: "old-signature",
        magicItemAutomation: { version: 1, kind: "passive" }
      }),
      "midi-qol": {
        onUseMacroParts: {
          items: []
        },
        otherRuntimeFlag: true
      }
    }
  };

  const patch = embeddedSync.buildEmbeddedMagicItemPatch(item, projection, {
    status: "resolved",
    magicItemId: "щит-3",
    reason: "stable-id",
    identityPatch: {}
  });

  assert.equal(patch.status, "updated");
  assert.equal(Object.hasOwn(patch.update.flags["midi-qol"].onUseMacroParts, "items"), false);
  assert.equal(patch.update.flags["midi-qol"].otherRuntimeFlag, true);

  const liveAfterFoundryUpdate = {
    ...structuredClone(item),
    flags: {
      ...structuredClone(patch.update.flags),
      "midi-qol": {
        ...structuredClone(patch.update.flags["midi-qol"]),
        onUseMacroParts: { items: [] }
      }
    }
  };
  assert.deepEqual(embeddedSync.buildEmbeddedMagicItemPatch(liveAfterFoundryUpdate, projection, {
    status: "resolved",
    magicItemId: "щит-3",
    reason: "stable-id",
    identityPatch: {}
  }), { status: "unchanged" });
});

test("embedded merge compares canonical item source instead of live system model defaults", () => {
  const source = {
    _id: "live-shield-source",
    name: "Щит +3",
    effects: [],
    system: {
      activities: {},
      uses: { spent: 0, max: "", recovery: [] }
    },
    flags: moduleFlags({
      sourceType: "magicItem",
      magicItemId: "щит-3",
      signature: "shield-signature",
      magicItemAutomation: { version: 1, kind: "passive" }
    })
  };
  const item = {
    ...structuredClone(source),
    system: {
      ...structuredClone(source.system),
      uses: {
        ...structuredClone(source.system.uses),
        schemaDefault: "live-model-only"
      }
    },
    toObject: () => structuredClone(source)
  };

  assert.deepEqual(embeddedSync.buildEmbeddedMagicItemPatch(item, {
    magicItemId: "щит-3",
    signature: "shield-signature",
    automationDefinition: { version: 1, kind: "passive" },
    effects: [],
    activities: {},
    uses: { spent: 0, max: "", recovery: [] }
  }, {
    status: "resolved",
    magicItemId: "щит-3",
    reason: "stable-id",
    identityPatch: {}
  }), { status: "unchanged" });
});

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => structuredClone(value),
    escapeHTML: (value) => String(value ?? ""),
    getProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object)
  }
};
globalThis.CONST ??= { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };

const { MagicItemsCompendiumService } = await import("../scripts/data/magic-items-compendium.js");

function makePackDocument({ id, name, magicItemId, effectValue = "+1" }) {
  const source = {
    _id: id,
    name,
    uuid: `Compendium.world.rebreya-magic-items.Item.${id}`,
    system: { activities: {}, uses: null },
    effects: [managedEffect({ value: effectValue })],
    flags: moduleFlags({
      managed: true,
      sourceType: "magicItem",
      magicItemId,
      signature: `signature-${magicItemId}`,
      magicItemAutomation: { version: 1, kind: "passive" }
    })
  };
  return { ...source, toObject: () => structuredClone(source) };
}

function makeOwnedItem({ id, name, magicItemId, equipped = true, attuned = false }) {
  return {
    _id: id,
    id,
    name,
    type: "equipment",
    system: { equipped, attuned, activities: {}, uses: null },
    effects: [],
    flags: moduleFlags({ magicItemId })
  };
}

function applyEmbeddedUpdates(actor, updates) {
  for (const update of updates) {
    const item = actor.items.contents.find((entry) => entry.id === update._id);
    item.system = { ...item.system, ...structuredClone(update.system) };
    item.effects = structuredClone(update.effects);
    item.flags = structuredClone(update.flags);
  }
}

test("owned sync guards the GM boundary and aborts before actors when compendium sync fails", async () => {
  const writes = [];
  const gameFixture = {
    system: { id: "dnd5e" },
    actors: { contents: [{ updateEmbeddedDocuments: (...args) => writes.push(args) }] },
    packs: new Map()
  };
  const service = new MagicItemsCompendiumService({
    gameProvider: () => gameFixture,
    consoleProvider: () => ({ table() {} }),
    isActiveGm: () => false
  });

  assert.deepEqual(await service.syncEquippedMagicItems(), {
    dryRun: false,
    actorsScanned: 0,
    itemsScanned: 0,
    updated: [],
    unchanged: [],
    unresolved: [],
    unresolvedChoices: [],
    skipped: [],
    errors: [{ actorId: "", actorName: "", itemId: "", itemName: "", reason: "not-active-gm" }]
  });
  assert.equal(writes.length, 0);

  service.isActiveGm = () => true;
  service.sync = async () => {
    throw new Error("compendium unavailable");
  };
  await assert.rejects(service.syncEquippedMagicItems(), /compendium unavailable/u);
  assert.equal(writes.length, 0);
});

test("owned sync updates recognized magic items that are only stored in character inventory", async () => {
  const packDocument = makePackDocument({
    id: "night-goggles",
    name: "Ночные очки",
    magicItemId: "ночные-очки"
  });
  const pack = { getDocuments: async () => [packDocument] };
  const storedItem = makeOwnedItem({
    id: "stored-night-goggles",
    name: "Ночные очки",
    magicItemId: "ночные-очки",
    equipped: false,
    attuned: false
  });
  const actor = {
    id: "character-with-stored-item",
    name: "Герой",
    type: "character",
    items: { contents: [storedItem] },
    writes: [],
    async updateEmbeddedDocuments(type, updates) {
      this.writes.push({ type, updates: structuredClone(updates) });
    }
  };
  const gameFixture = {
    system: { id: "dnd5e" },
    actors: { contents: [actor] },
    packs: new Map([["world.rebreya-magic-items", pack]])
  };
  const service = new MagicItemsCompendiumService({
    gameProvider: () => gameFixture,
    consoleProvider: () => ({ table() {} }),
    isActiveGm: () => true
  });
  service.sync = async () => pack;

  const report = await service.syncEquippedMagicItems();

  assert.equal(report.updated.some((row) => row.itemId === storedItem.id), true);
  assert.equal(actor.writes.length, 1);
  assert.deepEqual(actor.writes[0].updates.map((update) => update._id), [storedItem.id]);
});

test("owned sync trusts Foundry's empty document diff and avoids an empty actor write", async () => {
  const packDocument = makePackDocument({
    id: "night-goggles",
    name: "Ночные очки",
    magicItemId: "ночные-очки"
  });
  const pack = { getDocuments: async () => [packDocument] };
  const storedSource = makeOwnedItem({
    id: "already-current-goggles",
    name: "Ночные очки",
    magicItemId: "ночные-очки",
    equipped: false,
    attuned: false
  });
  const storedItem = {
    ...storedSource,
    toObject: () => structuredClone(storedSource)
  };
  const actor = {
    id: "character-with-current-item",
    name: "Герой",
    type: "character",
    items: { contents: [storedItem] },
    writes: [],
    async updateEmbeddedDocuments(type, updates) {
      this.writes.push({ type, updates: structuredClone(updates) });
    }
  };
  const gameFixture = {
    system: { id: "dnd5e" },
    actors: { contents: [actor] },
    packs: new Map([["world.rebreya-magic-items", pack]])
  };
  const service = new MagicItemsCompendiumService({
    gameProvider: () => gameFixture,
    consoleProvider: () => ({ table() {} }),
    diffObject: () => ({}),
    isActiveGm: () => true
  });
  service.sync = async () => pack;

  const report = await service.syncEquippedMagicItems();

  assert.equal(report.updated.length, 0);
  assert.equal(report.unchanged.some((row) => row.itemId === storedItem.id), true);
  assert.equal(actor.writes.length, 0);
});

test("owned sync plans detached rows, batches once per character, continues after actor errors, and is idempotent", async () => {
  const events = [];
  const tables = [];
  const packDocuments = [
    makePackDocument({ id: "night-goggles", name: "Ночные очки", magicItemId: "ночные-очки" }),
    makePackDocument({ id: "luck-stone", name: "Камень удачи", magicItemId: "камень-удачи" })
  ];
  const pack = {
    getDocuments: async () => {
      events.push("pack");
      return packDocuments;
    }
  };
  const failedActor = {
    id: "actor-failed",
    name: "Первый герой",
    type: "character",
    items: { contents: [makeOwnedItem({ id: "night-owned", name: "Goggles of Night", magicItemId: "ночные-очки" })] },
    updateEmbeddedDocuments: async () => {
      events.push("failed-write");
      throw new Error("actor locked");
    }
  };
  const successfulActor = {
    id: "actor-success",
    name: "Второй герой",
    type: "character",
    items: { contents: [
      makeOwnedItem({ id: "luck-owned", name: "Камень удачи", magicItemId: "камень-удачи", equipped: false, attuned: true }),
      makeOwnedItem({ id: "deferred-owned", name: "Особый Кинжал телепортации", magicItemId: "особый-кинжал", equipped: true }),
      makeOwnedItem({ id: "inactive-owned", name: "Ночные очки", magicItemId: "ночные-очки", equipped: false, attuned: false })
    ] },
    writes: [],
    async updateEmbeddedDocuments(type, updates) {
      events.push("success-write");
      this.writes.push({ type, updates: structuredClone(updates) });
      applyEmbeddedUpdates(this, updates);
    }
  };
  const npc = { id: "npc-1", name: "NPC", type: "npc", items: { contents: [] } };
  const gameFixture = {
    system: { id: "dnd5e" },
    actors: { contents: [failedActor, npc, successfulActor] },
    packs: new Map([["world.rebreya-magic-items", pack]])
  };
  const service = new MagicItemsCompendiumService({
    gameProvider: () => gameFixture,
    consoleProvider: () => ({ table: (rows) => tables.push(structuredClone(rows)) }),
    isActiveGm: () => true
  });
  service.sync = async () => {
    events.push("sync");
    return pack;
  };

  const preview = await service.syncEquippedMagicItems({ dryRun: true });
  assert.deepEqual(Object.keys(preview), [
    "dryRun", "actorsScanned", "itemsScanned", "updated", "unchanged",
    "unresolved", "unresolvedChoices", "skipped", "errors"
  ]);
  assert.equal(preview.actorsScanned, 2);
  assert.equal(preview.itemsScanned, 4);
  assert.equal(preview.updated.length, 3);
  assert.equal(preview.skipped.some((row) => row.itemId === "deferred-owned" && row.reason === "deferred-current-iteration"), true);
  assert.equal(preview.updated.some((row) => row.itemId === "inactive-owned"), true);
  assert.equal(successfulActor.writes.length, 0);
  assert.deepEqual(events.slice(0, 2), ["sync", "pack"]);

  events.length = 0;
  const applied = await service.syncEquippedMagicItems();
  assert.equal(applied.updated.length, 2);
  assert.equal(applied.errors.some((row) => row.actorId === "actor-failed" && row.reason === "actor-update-failed"), true);
  assert.equal(successfulActor.writes.length, 1);
  assert.equal(successfulActor.writes[0].type, "Item");
  assert.deepEqual(successfulActor.writes[0].updates.map((update) => update._id), ["luck-owned", "inactive-owned"]);
  assert.equal(successfulActor.writes[0].updates.some((update) => update._id === "deferred-owned"), false);
  assert.equal(tables.length >= 2, true);
  assert.equal(tables.at(-1).every((row) => Object.hasOwn(row, "reason")), true);

  const repeated = await service.syncEquippedMagicItems();
  assert.equal(repeated.updated.length, 0);
  assert.equal(repeated.unchanged.some((row) => row.itemId === "luck-owned"), true);
  assert.equal(repeated.unchanged.some((row) => row.itemId === "inactive-owned"), true);
  assert.equal(successfulActor.writes.length, 1);
});
