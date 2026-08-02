import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  CHEST_OBJECT_DURABILITY,
  NativeObjectDurabilityService,
  ensureStorageObjectDurability,
  readStorageObjectDurability
} from "../scripts/data/native-object-durability-service.js";
import { StorageService, buildStorageTokenState, readStorageState } from "../scripts/data/storage-service.js";

function applyPatch(target, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let cursor = target;
    for (const part of parts.slice(0, -1)) cursor = (cursor[part] ??= {});
    cursor[parts.at(-1)] = structuredClone(value);
  }
}

function durability(hp = 10) {
  return {
    version: 1,
    eligible: true,
    state: "intact",
    breakStage: 0,
    materialProfile: "steel",
    construction: "sturdy",
    size: "small",
    hp: { value: hp, max: 10 },
    ac: 17,
    damageThreshold: 0
  };
}

function createToken({ id = "chest", groundPile = false, rows = [], objectDurability = null } = {}) {
  const token = {
    id,
    uuid: `Scene.scene.Token.${id}`,
    name: groundPile ? "Куча предметов" : "Сундук",
    parent: { id: "scene" },
    flags: {
      [MODULE_ID]: {
        storage: buildStorageTokenState({
          baseName: groundPile ? "Куча предметов" : "Сундук",
          state: groundPile ? "opened" : "unopened",
          manualRows: rows
        }),
        ...(groundPile ? { groundPile: { enabled: true } } : {}),
        ...(objectDurability ? { objectDurability: structuredClone(objectDurability) } : {})
      }
    },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async update(patch) { applyPatch(this, patch); return this; }
  };
  token.actor = {
    id: `${id}-actor`,
    token: { document: token },
    system: { attributes: { hp: { value: 0, max: 0, dt: 0 }, ac: { calc: "flat", flat: 0 } } }
  };
  return token;
}

function createService({ storageService = new StorageService(), groundPileService = null } = {}) {
  const itemDamageCalls = [];
  const itemBreakCalls = [];
  const itemDestroyCalls = [];
  const refreshCalls = [];
  const durabilityService = {
    async damageItem(item, options) {
      itemDamageCalls.push([item, structuredClone(options)]);
      return { outcome: "damaged", nextFlag: durability(7), appliedDamage: 3 };
    },
    async breakItem(item, options) {
      itemBreakCalls.push([item, structuredClone(options)]);
      return { outcome: "broken" };
    },
    async destroyItem(item, options) {
      itemDestroyCalls.push([item, structuredClone(options)]);
      return { outcome: "destroyed" };
    }
  };
  const piles = groundPileService ?? {
    async refreshAfterStorageMutation(token, state) {
      refreshCalls.push([token, structuredClone(state)]);
      return { deleted: state.state === "empty", state };
    }
  };
  const service = new NativeObjectDurabilityService({
    durabilityService,
    storageService,
    groundPileService: piles,
    isActiveGm: () => true,
    resolveUuid: async () => null
  });
  return { service, itemDamageCalls, itemBreakCalls, itemDestroyCalls, refreshCalls };
}

test("a chest owns AC 15 and HP 18 independently from its rows", async () => {
  const chest = createToken({ rows: [{ rowId: "sword", itemData: { flags: { [MODULE_ID]: { durability: durability(2) } } } }] });

  const initialized = await ensureStorageObjectDurability(chest, { isActiveGm: () => true });

  assert.deepEqual(initialized, CHEST_OBJECT_DURABILITY);
  assert.deepEqual(readStorageObjectDurability(chest).hp, { value: 18, max: 18 });
  assert.equal(readStorageObjectDurability(chest).ac, 15);
  assert.deepEqual(chest.delta.system.attributes.hp, { value: 18, max: 18, dt: 0 });
  assert.deepEqual(chest.delta.system.attributes.ac, { calc: "flat", flat: 15 });
  assert.equal(chest.bar1.attribute, "attributes.hp");
});

test("chest initialization preserves existing damage while repairing projection", async () => {
  const existing = { ...structuredClone(CHEST_OBJECT_DURABILITY), hp: { value: 7, max: 18 } };
  const chest = createToken({ objectDurability: existing });

  await ensureStorageObjectDurability(chest, { isActiveGm: () => true });

  assert.equal(readStorageObjectDurability(chest).hp.value, 7);
  assert.equal(chest.delta.system.attributes.hp.value, 7);
});

test("one ground-pile row receives damage through stored item durability", async () => {
  const row = {
    rowId: "sword",
    name: "Меч",
    quantity: 1,
    itemData: { name: "Меч", flags: { [MODULE_ID]: { durability: durability(10) } }, system: { quantity: 1 } }
  };
  const pile = createToken({ id: "pile", groundPile: true, rows: [row] });
  const { service, refreshCalls } = createService();

  const result = await service.damage(pile, { amount: 4, damageType: "slashing" });

  assert.equal(result.outcome, "damaged");
  assert.equal(readStorageState(pile).manualRows[0].itemData.flags[MODULE_ID].durability.hp.value, 6);
  assert.equal(refreshCalls.length, 1);
});

test("a multi-row ground pile has no aggregate durability target", async () => {
  const row = (rowId) => ({ rowId, itemData: { flags: { [MODULE_ID]: { durability: durability() } } } });
  const pile = createToken({ groundPile: true, rows: [row("one"), row("two")] });
  const { service } = createService();

  assert.equal(await service.resolve(pile), null);
  assert.equal((await service.damage(pile, { amount: 5, damageType: "force" })).outcome, "ignored");
});

test("ordinary Item documents delegate to the journaled durability service", async () => {
  const item = {
    documentName: "Item",
    id: "sword",
    uuid: "Actor.hero.Item.sword",
    flags: { [MODULE_ID]: { durability: durability() } }
  };
  const { service, itemDamageCalls, itemBreakCalls, itemDestroyCalls } = createService();

  assert.equal((await service.damage(item, { amount: 3, damageType: "force" })).outcome, "damaged");
  assert.equal((await service.resolveDepletion(item, "broken")).outcome, "broken");
  assert.equal((await service.resolveDepletion(item, "destroyed", { mutationId: "destroy-sword" })).outcome, "destroyed");
  assert.deepEqual(itemDamageCalls, [[item, { amount: 3, damageType: "force" }]]);
  assert.equal(itemBreakCalls.length, 1);
  assert.equal(itemDestroyCalls[0][1].mutationId, "destroy-sword");
});

test("destroying a single ground item deletes the row and refreshes the empty pile", async () => {
  const row = { rowId: "last", itemData: { flags: { [MODULE_ID]: { durability: durability(0) } } } };
  const pile = createToken({ groundPile: true, rows: [row] });
  const { service, refreshCalls } = createService();

  const result = await service.resolveDepletion(pile, "destroyed");

  assert.equal(result.outcome, "destroyed");
  assert.equal(readStorageState(pile).state, "empty");
  assert.equal(refreshCalls.at(-1)[1].state, "empty");
});

test("destroying an unopened chest generates once, spills one snapshot, then deletes it", async () => {
  let generateCalls = 0;
  const storageService = new StorageService({
    generate: async () => {
      generateCalls += 1;
      return {
        rows: [
          { rowId: "one", name: "Меч", quantity: 1, itemData: { system: { quantity: 1 } } },
          { rowId: "two", name: "Щит", quantity: 1, itemData: { system: { quantity: 1 } } },
          { rowId: "three", name: "Факел", quantity: 2, itemData: { system: { quantity: 2 } } }
        ],
        coins: { gp: 4, sp: 2 }
      };
    }
  });
  const snapshots = [];
  const groundPileService = {
    async transferSnapshotToScene(request) {
      snapshots.push(structuredClone(request));
      return { token: { uuid: "Scene.scene.Token.pile" } };
    }
  };
  const chest = createToken({ objectDurability: { ...structuredClone(CHEST_OBJECT_DURABILITY), hp: { value: 0, max: 18 } } });
  Object.assign(chest, { x: 200, y: 300, width: 1, height: 1 });
  chest.parent = { id: "scene", grid: { size: 100 } };
  chest.delete = async () => { chest.deleted = true; };
  const { service } = createService({ storageService, groundPileService });

  const result = await service.destroyChest(chest, { mutationId: "destroy-chest-1" });

  assert.equal(generateCalls, 1);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].rows.length, 3);
  assert.deepEqual(snapshots[0].coins, { pp: 0, gp: 4, sp: 2, cp: 0 });
  assert.equal(snapshots[0].x, 250);
  assert.equal(snapshots[0].y, 350);
  assert.equal(chest.deleted, true);
  assert.deepEqual(result, { outcome: "destroyed", pileUuid: "Scene.scene.Token.pile" });
});

test("retry after pile creation reuses the stable mutation and deletes without duplication", async () => {
  const seenMutations = new Set();
  const createdPiles = [];
  const groundPileService = {
    async transferSnapshotToScene(request) {
      if (!seenMutations.has(request.mutationId)) createdPiles.push(request.mutationId);
      seenMutations.add(request.mutationId);
      return { token: { uuid: "Scene.scene.Token.pile" }, duplicate: createdPiles.length === 1 };
    }
  };
  const storageService = new StorageService({
    generate: async () => ({ rows: [{ rowId: "one", name: "Меч", quantity: 1 }], coins: {} })
  });
  const chest = createToken();
  Object.assign(chest, { x: 0, y: 0, width: 1, height: 1 });
  chest.parent = { id: "scene", grid: { size: 100 } };
  let deleteCalls = 0;
  chest.delete = async () => {
    deleteCalls += 1;
    if (deleteCalls === 1) throw new Error("delete failed");
    chest.deleted = true;
  };
  const { service } = createService({ storageService, groundPileService });

  await assert.rejects(service.destroyChest(chest, { mutationId: "destroy-chest-2" }), /delete failed/u);
  await service.destroyChest(chest, { mutationId: "destroy-chest-2" });

  assert.deepEqual(createdPiles, ["destroy-chest-2"]);
  assert.equal(chest.deleted, true);
});
