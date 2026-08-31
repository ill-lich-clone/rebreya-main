import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import * as corpseStorage from "../scripts/data/corpse-storage-materializer.js";

const { CorpseStorageMaterializer, isDeadNpcStorageTarget } = corpseStorage;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function canonicalDocument({ id, gearId, name, type, system }) {
  const data = {
    _id: id,
    id,
    uuid: `Compendium.world.rebreya-gear.Item.${id}`,
    name,
    type,
    system: clone(system),
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "gear",
        gearId
      }
    }
  };
  return {
    ...data,
    toObject() {
      return clone(data);
    }
  };
}

function createPack(documents) {
  const byId = new Map(documents.map((document) => [document.id, document]));
  return {
    collection: "world.rebreya-gear",
    metadata: { id: "world.rebreya-gear" },
    async getIndex() {
      return documents.map((document) => document.toObject());
    },
    async getDocument(id) {
      return byId.get(id) ?? null;
    }
  };
}

function createInventoryService(pack) {
  return {
    async buildLootgenItemData(row) {
      const document = await pack.getDocument(row.sourceDocumentId);
      const itemData = document.toObject();
      delete itemData._id;
      delete itemData.id;
      delete itemData.uuid;
      itemData.system.quantity = row.quantity;
      itemData.system.equipped = false;
      return itemData;
    }
  };
}

function createMaterializer(documents, { brokenFlag = null } = {}) {
  const pack = createPack(documents);
  return new CorpseStorageMaterializer({
    inventoryService: createInventoryService(pack),
    durabilityService: {
      async getOrBuildBrokenDurability() {
        return clone(brokenFlag);
      }
    },
    getGearPack: () => pack
  });
}

function embeddedItem({ id, name, type, system = {}, flags = {}, stats = {} }) {
  return {
    id,
    _id: id,
    name,
    type,
    system: clone(system),
    flags: clone(flags),
    _stats: clone(stats),
    update() {
      throw new Error("Corpse materialization must not update embedded NPC Items.");
    }
  };
}

function npcToken({ id = "corpse", hp = 0, items = [], actorId = "npc" } = {}) {
  return {
    id,
    uuid: `Scene.scene.Token.${id}`,
    actor: {
      id: actorId,
      uuid: `Actor.${actorId}`,
      type: "npc",
      system: { attributes: { hp: { value: hp } } },
      items
    }
  };
}

test("corpse target contract keeps a complete materialized NPC accessible after HP drift", () => {
  assert.equal(typeof corpseStorage.isCorpseStorageTarget, "function");
  const token = npcToken({ hp: 7 });
  token.flags = {
    [MODULE_ID]: {
      storage: {
        corpseMaterialization: { version: 1, status: "complete" }
      }
    }
  };

  assert.equal(corpseStorage.isCorpseStorageTarget(token), true);
  assert.equal(corpseStorage.isCorpseStorageTarget(npcToken({ hp: 7 })), false);
});

const CHAMPION_GEAR = [
  canonicalDocument({
    id: "greatsword-doc",
    gearId: "dvuruchnyy-mech",
    name: "Двуручный меч",
    type: "weapon",
    system: { type: { value: "martialM", baseItem: "greatsword" }, quantity: 1 }
  }),
  canonicalDocument({
    id: "shortbow-doc",
    gearId: "korotkiy-luk",
    name: "Короткий лук",
    type: "weapon",
    system: { type: { value: "martialR", baseItem: "shortbow" }, quantity: 1 }
  }),
  canonicalDocument({
    id: "plate-doc",
    gearId: "laty",
    name: "Латный доспех",
    type: "equipment",
    system: { type: { value: "heavy", baseItem: "plate" }, quantity: 1, equipped: true }
  }),
  canonicalDocument({
    id: "arrows-doc",
    gearId: "strely-20",
    name: "Стрелы",
    type: "consumable",
    system: { type: { value: "ammo", subtype: "arrow" }, quantity: 20 }
  })
];

test("dead NPC predicate is token-scoped, finite, and excludes marked storage and living actors", () => {
  assert.equal(isDeadNpcStorageTarget(npcToken({ hp: 0 })), true);
  assert.equal(isDeadNpcStorageTarget(npcToken({ hp: -3 })), true);
  assert.equal(isDeadNpcStorageTarget(npcToken({ hp: 1 })), false);
  assert.equal(isDeadNpcStorageTarget(npcToken({ hp: Number.NaN })), false);
  assert.equal(isDeadNpcStorageTarget(npcToken({ hp: null })), false);
  assert.equal(isDeadNpcStorageTarget(npcToken({ hp: "" })), false);
  assert.equal(isDeadNpcStorageTarget(npcToken({ hp: "0" })), false);
  assert.equal(isDeadNpcStorageTarget({ actor: { type: "character", system: { attributes: { hp: { value: 0 } } } } }), false);
  assert.equal(isDeadNpcStorageTarget({
    ...npcToken({ hp: 0 }),
    actor: {
      ...npcToken({ hp: 0 }).actor,
      flags: { [MODULE_ID]: { storage: { enabled: true } } }
    }
  }), false);
  assert.equal(isDeadNpcStorageTarget({
    actor: {
      type: "npc",
      system: { attributes: { hp: { value: 0 } } },
      getFlag(scope, key) {
        return scope === MODULE_ID && key === "storage" ? { enabled: true } : undefined;
      }
    }
  }), false);
});

test("Troll natural attacks and traits produce a completed empty corpse materialization", async () => {
  const materializer = createMaterializer(CHAMPION_GEAR);
  const token = npcToken({
    actorId: "troll",
    items: [
      embeddedItem({ id: "bite", name: "Укус", type: "weapon", system: { type: { value: "natural" }, quantity: 1 }, flags: { srd5e: { hash: "bite" } } }),
      embeddedItem({ id: "claw", name: "Коготь", type: "weapon", system: { type: { value: "natural" }, quantity: 1 }, flags: { srd5e: { hash: "claw" } } }),
      embeddedItem({ id: "keen-smell", name: "Острый нюх", type: "feat" })
    ]
  });

  const result = await materializer.materialize(token);

  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.coins, {});
  assert.deepEqual(result.corpseMaterialization, {
    version: 1,
    status: "complete",
    sourceActorUuid: "Actor.troll",
    sourceActorId: "troll"
  });
});

test("Champion materializes exactly four canonical gear rows with embedded quantities and broken armor", async () => {
  const brokenFlag = {
    eligible: true,
    state: "broken",
    breakStage: 1,
    hp: { value: 0, max: 30 },
    updatedAt: "2026-08-21T00:00:00.000Z"
  };
  const materializer = createMaterializer(CHAMPION_GEAR, { brokenFlag });
  const token = npcToken({
    actorId: "champion",
    items: [
      embeddedItem({ id: "multiattack", name: "Мультиатака", type: "feat" }),
      embeddedItem({ id: "greatsword", name: "Двуручный меч", type: "weapon", system: { type: { value: "natural" }, quantity: 1 }, flags: { srd5e: { hash: "greatsword" } } }),
      embeddedItem({ id: "shortbow", name: "Короткий лук", type: "weapon", system: { type: { value: "natural" }, quantity: 1 }, stats: { compendiumSource: "Actor.monster.Item.shortbow" } }),
      embeddedItem({ id: "plate", name: "Латы", type: "equipment", system: { type: { value: "heavy", baseItem: "plate" }, quantity: 1, equipped: true } }),
      embeddedItem({ id: "arrows", name: "Стрелы", type: "consumable", system: { type: { value: "ammo", subtype: "arrow" }, quantity: 20 } })
    ]
  });

  const result = await materializer.materialize(token);

  assert.deepEqual(result.rows.map((row) => row.sourceId), [
    "dvuruchnyy-mech",
    "korotkiy-luk",
    "laty",
    "strely-20"
  ]);
  assert.deepEqual(result.rows.map((row) => row.rowId), [
    "corpse-v1:greatsword:dvuruchnyy-mech",
    "corpse-v1:shortbow:korotkiy-luk",
    "corpse-v1:plate:laty",
    "corpse-v1:arrows:strely-20"
  ]);
  assert.equal(result.rows.length, 4);
  assert.equal(result.rows[3].quantity, 20);
  assert.equal(result.rows[3].itemData.system.quantity, 20);
  assert.equal(result.rows[2].name, "Латный доспех (сломан)");
  assert.equal(result.rows[2].itemData.name, "Латный доспех (сломан)");
  assert.deepEqual(result.rows[2].itemData.flags[MODULE_ID].durability, brokenFlag);
  assert.equal(token.actor.items[3].system.equipped, true);
});

test("matching is fail-closed except stable gear identity, canonical UUID, and evidenced ordinary weapon fallback", async () => {
  const duplicatePlate = canonicalDocument({
    id: "duplicate-plate",
    gearId: "duplicate-laty",
    name: "Другие латы",
    type: "equipment",
    system: { type: { value: "heavy", baseItem: "plate" }, quantity: 1 }
  });
  const materializer = createMaterializer([...CHAMPION_GEAR, duplicatePlate], {
    brokenFlag: { eligible: true, state: "broken", breakStage: 1, hp: { value: 0, max: 10 } }
  });
  const token = npcToken({
    items: [
      embeddedItem({
        id: "stable-flags",
        name: "Неважное имя",
        type: "weapon",
        system: { type: { value: "natural" }, quantity: 2 },
        flags: { [MODULE_ID]: { sourceType: "gear", gearId: "dvuruchnyy-mech", sourceId: "dvuruchnyy-mech" } }
      }),
      embeddedItem({
        id: "stable-uuid",
        name: "Неважное имя 2",
        type: "consumable",
        system: { type: { value: "ammo" }, quantity: 7 },
        flags: { core: { sourceId: "Compendium.world.rebreya-gear.Item.arrows-doc" } }
      }),
      embeddedItem({ id: "name-only", name: "Двуручный меч", type: "weapon", system: { type: { value: "natural" } } }),
      embeddedItem({ id: "unknown", name: "Реликвия", type: "equipment", system: { type: { value: "trinket", baseItem: "unknown" } } }),
      embeddedItem({ id: "ambiguous", name: "Латы", type: "equipment", system: { type: { value: "heavy", baseItem: "plate" } } }),
      embeddedItem({
        id: "natural-base-spoof",
        name: "Укус",
        type: "weapon",
        system: { type: { value: "natural", baseItem: "greatsword" } },
        flags: { srd5e: { hash: "natural-spoof" } }
      }),
      embeddedItem({
        id: "conflicting-uuids",
        name: "Неоднозначный источник",
        type: "weapon",
        system: { type: { value: "martialM", baseItem: "greatsword" } },
        flags: {
          core: { sourceId: "Compendium.world.rebreya-gear.Item.greatsword-doc" },
          dnd5e: { sourceId: "Compendium.world.rebreya-gear.Item.shortbow-doc" }
        }
      }),
      embeddedItem({
        id: "conflict",
        name: "Двуручный меч",
        type: "weapon",
        system: { type: { value: "natural" } },
        flags: { [MODULE_ID]: { sourceType: "gear", gearId: "dvuruchnyy-mech", sourceId: "korotkiy-luk" }, srd5e: { hash: "conflict" } }
      }),
      embeddedItem({ id: "spell", name: "Двуручный меч", type: "spell", flags: { srd5e: { hash: "spell" } } })
    ]
  });

  const result = await materializer.materialize(token);

  assert.deepEqual(result.rows.map((row) => [row.rowId, row.sourceId, row.quantity]), [
    ["corpse-v1:stable-flags:dvuruchnyy-mech", "dvuruchnyy-mech", 2],
    ["corpse-v1:stable-uuid:strely-20", "strely-20", 7]
  ]);
});
