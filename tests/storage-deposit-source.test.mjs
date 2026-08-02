import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { StorageService, readStorageState } from "../scripts/data/storage-service.js";
import {
  parseStorageDepositDragData,
  resolveStorageDepositSource
} from "../scripts/data/storage-deposit-source.js";
import { STORAGE_DRAG_TYPE } from "../scripts/ui/storage-transfer-ui.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function applyPatch(target, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let cursor = target;
    for (const part of parts.slice(0, -1)) {
      cursor[part] ??= {};
      cursor = cursor[part];
    }
    cursor[parts.at(-1)] = clone(value);
  }
}

function createEmbeddedItem({ quantity = 5, sourceId = "Compendium.dnd5e.items.arrow" } = {}) {
  const created = [];
  const actor = {
    uuid: "Actor.hero",
    documentName: "Actor",
    testUserPermission: (user, level) => user?.id === "owner" && level === "OWNER",
    async createEmbeddedDocuments(type, rows, options) {
      created.push({ type, rows: clone(rows), options: clone(options) });
      return rows;
    }
  };
  const item = {
    id: "arrow",
    uuid: "Actor.hero.Item.arrow",
    documentName: "Item",
    parent: actor,
    name: "Стрела",
    type: "consumable",
    img: "arrow.webp",
    flags: { core: { sourceId } },
    system: { quantity },
    deleted: false,
    updates: [],
    toObject() {
      return {
        _id: this.id,
        name: this.name,
        type: this.type,
        img: this.img,
        flags: clone(this.flags),
        system: clone(this.system)
      };
    },
    async update(patch) {
      this.updates.push(clone(patch));
      applyPatch(this, patch);
      return this;
    },
    async delete() {
      this.deleted = true;
      return this;
    }
  };
  return { actor, item, created };
}

function createStorageToken() {
  const actor = {
    type: "npc",
    flags: { [MODULE_ID]: { storage: { enabled: true } } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
  return {
    id: "pile",
    uuid: "Scene.scene.Token.pile",
    name: "Куча предметов",
    actor,
    flags: {},
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async update(patch) { applyPatch(this, patch); return this; }
  };
}

test("deposit drag parser accepts Foundry Items and Rebreya storage rows only", () => {
  assert.deepEqual(parseStorageDepositDragData({
    type: "Item",
    uuid: "Actor.hero.Item.sword"
  }), {
    kind: "item",
    itemUuid: "Actor.hero.Item.sword"
  });
  assert.deepEqual(parseStorageDepositDragData(JSON.stringify({
    type: STORAGE_DRAG_TYPE,
    tokenUuid: "Scene.scene.Token.pile",
    rowId: "row-1",
    quantity: 4
  })), {
    kind: "storage-row",
    tokenUuid: "Scene.scene.Token.pile",
    rowId: "row-1",
    quantity: 4
  });
  assert.equal(parseStorageDepositDragData({ type: "Actor", uuid: "Actor.hero" }), null);
  assert.equal(parseStorageDepositDragData({ type: "Item", uuid: "" }), null);
  assert.deepEqual(parseStorageDepositDragData({
    kind: "item",
    itemUuid: "Actor.hero.Item.sword"
  }), {
    kind: "item",
    itemUuid: "Actor.hero.Item.sword"
  });
});

test("embedded actor item deposits move partial quantities and authorize only owners", async () => {
  const { item } = createEmbeddedItem({ quantity: 5 });
  const source = await resolveStorageDepositSource({
    kind: "item",
    itemUuid: item.uuid
  }, { fromUuid: async () => item, createRowId: () => "deposit-arrow" });

  assert.equal(source.mode, "move");
  assert.equal(source.available, 5);
  assert.equal(source.row.rowId, "deposit-arrow");
  assert.equal(source.row.stackKey, "Compendium.dnd5e.items.arrow");
  assert.equal(source.row.itemData.system.quantity, 5);
  assert.equal(source.canUserMove({ id: "owner" }), true);
  assert.equal(source.canUserMove({ id: "stranger" }), false);

  const receipt = await source.consume(2);
  assert.equal(item.system.quantity, 3);
  assert.equal(item.deleted, false);
  await source.restore(receipt);
  assert.equal(item.system.quantity, 5);
});

test("moving a full embedded stack deletes it and restore recreates the exact item", async () => {
  const { item, created } = createEmbeddedItem({ quantity: 2 });
  const source = await resolveStorageDepositSource({
    kind: "item",
    itemUuid: item.uuid
  }, { fromUuid: async () => item, createRowId: () => "deposit-full" });

  const receipt = await source.consume(2);
  assert.equal(item.deleted, true);
  await source.restore(receipt);

  assert.equal(created.length, 1);
  assert.equal(created[0].type, "Item");
  assert.equal(created[0].rows[0]._id, "arrow");
  assert.equal(created[0].rows[0].system.quantity, 2);
  assert.deepEqual(created[0].options, { keepId: true });
});

test("world and compendium item deposits copy without mutating their source", async () => {
  for (const item of [
    {
      uuid: "Item.world-sword",
      documentName: "Item",
      parent: null,
      name: "Меч",
      type: "weapon",
      img: "sword.webp",
      flags: {},
      system: { quantity: 3 },
      toObject() { return { name: this.name, type: this.type, img: this.img, system: clone(this.system) }; }
    },
    {
      uuid: "Compendium.dnd5e.items.Item.sword",
      documentName: "Item",
      parent: null,
      pack: "dnd5e.items",
      name: "Меч",
      type: "weapon",
      img: "sword.webp",
      flags: {},
      system: { quantity: 1 },
      toObject() { return { name: this.name, type: this.type, img: this.img, system: clone(this.system) }; }
    }
  ]) {
    const source = await resolveStorageDepositSource({ kind: "item", itemUuid: item.uuid }, {
      fromUuid: async () => item,
      createRowId: () => "copy-row"
    });
    assert.equal(source.mode, "copy");
    assert.equal(source.canUserMove({ id: "anyone" }), true);
    const receipt = await source.consume(1);
    assert.deepEqual(receipt, { kind: "copy" });
    await source.restore(receipt);
    assert.equal(item.system.quantity >= 1, true);
  }
});

test("storage-row deposits consume and restore a ground pile quantity", async () => {
  const storageService = new StorageService();
  const token = createStorageToken();
  await storageService.configure(token, {
    state: "opened",
    manualRows: [{
      rowId: "row-1",
      stackKey: "same-item",
      name: "Деталь",
      quantity: 4,
      itemData: { name: "Деталь", type: "loot", system: { quantity: 4 } }
    }]
  });
  const source = await resolveStorageDepositSource({
    kind: "storage-row",
    tokenUuid: token.uuid,
    rowId: "row-1",
    quantity: 4
  }, {
    resolveToken: async () => token,
    storageService,
    createRowId: () => "unused"
  });

  assert.equal(source.mode, "move");
  assert.equal(source.available, 4);
  assert.equal(source.storageToken, token);
  const receipt = await source.consume(3);
  assert.equal(readStorageState(token).manualRows[0].quantity, 1);
  await source.restore(receipt);
  assert.equal(readStorageState(token).manualRows[0].quantity, 4);
  assert.equal(readStorageState(token).state, "opened");
});
