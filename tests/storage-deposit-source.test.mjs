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
  assert.deepEqual(parseStorageDepositDragData({
    type: "Token",
    uuid: "Scene.scene.Token.chest"
  }), {
    kind: "storage-token",
    tokenUuid: "Scene.scene.Token.chest"
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

test("portable dnd5e container Items move with their complete recursive snapshot", async () => {
  const item = {
    id: "bag",
    uuid: "Actor.hero.Item.bag",
    documentName: "Item",
    parent: {
      documentName: "Actor",
      testUserPermission: () => true
    },
    type: "container",
    name: "Сумка хранения",
    img: "bag.webp",
    system: { quantity: 1 },
    flags: {
      [MODULE_ID]: {
        storageContainer: {
          containerId: "bag-1",
          storageKind: "bag",
          name: "Сумка хранения",
          state: { baseName: "Сумка хранения", state: "opened", manualRows: [], generatedRows: [] }
        }
      }
    },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
  const calls = [];
  const containerItemService = {
    async captureFromItem(actual) {
      calls.push(["capture", actual]);
      return clone(item.flags[MODULE_ID].storageContainer);
    },
    async removeItemTree(actual) {
      calls.push(["remove", actual]);
      return { actor: actual.parent, snapshot: clone(item.flags[MODULE_ID].storageContainer) };
    },
    async restoreItemTree(receipt) {
      calls.push(["restore", receipt]);
      return true;
    }
  };
  const source = await resolveStorageDepositSource({ kind: "item", itemUuid: item.uuid }, {
    fromUuid: async () => item,
    containerItemService,
    createRowId: () => "bag-row"
  });

  assert.equal(source.kind, "storage-item");
  assert.equal(source.available, 1);
  assert.equal(source.row.rowKind, "container");
  assert.equal(source.row.container.containerId, "bag-1");
  const receipt = await source.consume(1);
  await source.restore(receipt);
  assert.deepEqual(calls.map(([kind]) => kind), ["capture", "remove", "restore"]);
});

test("ordinary native dnd5e containers use the recursive container transfer path", async () => {
  const item = {
    id: "native-bag",
    uuid: "Actor.9R0Mkbw9h40prpZL.Item.native-bag",
    documentName: "Item",
    parent: { documentName: "Actor", testUserPermission: () => true },
    type: "container",
    name: "Рюкзак",
    img: "backpack.webp",
    system: { quantity: 1, type: { value: "backpack" } },
    flags: {}
  };
  const calls = [];
  const containerItemService = {
    async captureFromItem(actual) {
      calls.push(["capture", actual]);
      return {
        containerId: "native-bag",
        storageKind: "bag",
        name: "Рюкзак",
        state: { baseName: "Рюкзак", state: "opened", manualRows: [], generatedRows: [] }
      };
    },
    async removeItemTree(actual) {
      calls.push(["remove", actual]);
      return { actor: actual.parent };
    },
    async restoreItemTree(receipt) {
      calls.push(["restore", receipt]);
    }
  };

  const source = await resolveStorageDepositSource({ kind: "item", itemUuid: item.uuid }, {
    fromUuid: async () => item,
    containerItemService,
    createRowId: () => "native-bag-row"
  });

  assert.equal(source.kind, "storage-item");
  assert.equal(source.row.rowKind, "container");
  assert.equal(source.row.container.containerId, "native-bag");
  const receipt = await source.consume(1);
  await source.restore(receipt);
  assert.deepEqual(calls.map(([kind]) => kind), ["capture", "remove", "restore"]);
});

test("separate copies of the same native container receive unique identities and never stack", async () => {
  const item = {
    id: "native-bag-template",
    uuid: "Compendium.dnd5e.items.Item.native-bag-template",
    documentName: "Item",
    parent: { documentName: "CompendiumCollection" },
    type: "container",
    name: "Сумка хранения",
    img: "bag.webp",
    system: { quantity: 1, type: { value: "bag" } },
    flags: {}
  };
  const templateSnapshot = {
    containerId: "native-template-container",
    storageKind: "bag",
    name: "Сумка хранения",
    state: {
      baseName: "Сумка хранения",
      state: "opened",
      manualRows: [],
      generatedRows: []
    }
  };
  const dependencies = {
    fromUuid: async () => item,
    containerItemService: {
      async captureFromItem() {
        return clone(templateSnapshot);
      }
    }
  };

  const first = await resolveStorageDepositSource({ kind: "item", itemUuid: item.uuid }, dependencies);
  const second = await resolveStorageDepositSource({ kind: "item", itemUuid: item.uuid }, dependencies);

  assert.equal(first.mode, "copy");
  assert.equal(second.mode, "copy");
  assert.notEqual(first.row.container.containerId, templateSnapshot.containerId);
  assert.notEqual(second.row.container.containerId, templateSnapshot.containerId);
  assert.notEqual(first.row.container.containerId, second.row.container.containerId);

  const target = createStorageToken();
  const storageService = new StorageService();
  await storageService.configure(target, {
    containerId: "target-chest",
    storageKind: "chest",
    state: "opened"
  });
  await storageService.depositRow(target, first.row, { quantity: 1 });
  await storageService.depositRow(target, second.row, { quantity: 1 });

  const rows = readStorageState(target).manualRows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.rowKind), ["container", "container"]);
  assert.deepEqual(rows.map((row) => row.quantity), [1, 1]);
});

test("whole storage token sources delete after deposit and can restore the original token", async () => {
  const token = createStorageToken();
  token.actor.id = "storage-actor";
  token.parent = {
    id: "scene",
    created: [],
    async createEmbeddedDocuments(type, documents) {
      this.created.push({ type, documents: clone(documents) });
      return documents;
    }
  };
  token.texture = { src: "chest.webp" };
  token.toObject = () => ({
    _id: token.id,
    name: token.name,
    actorId: token.actor.id,
    texture: clone(token.texture),
    flags: clone(token.flags)
  });
  token.delete = async () => { token.deleted = true; };
  await new StorageService().configure(token, { state: "opened", containerId: "token-container" });

  const source = await resolveStorageDepositSource({ kind: "storage-token", tokenUuid: token.uuid }, {
    resolveToken: async () => token,
    createRowId: () => "token-row"
  });
  assert.equal(source.kind, "storage-token");
  assert.equal(source.row.rowKind, "container");
  assert.equal(source.row.container.containerId, "token-container");
  const receipt = await source.consume(1);
  assert.equal(token.deleted, true);
  await source.restore(receipt);
  assert.equal(token.parent.created.length, 1);
  assert.equal(token.parent.created[0].type, "Token");
  assert.equal(token.parent.created[0].documents[0]._id, token.id);
});

test("a single ordinary ground item is transferred as an item instead of a nested container", async () => {
  const token = createStorageToken();
  token.parent = {
    created: [],
    async createEmbeddedDocuments(type, documents) {
      this.created.push({ type, documents: clone(documents) });
      return documents;
    }
  };
  token.toObject = () => ({ _id: token.id, name: token.name, flags: clone(token.flags) });
  token.delete = async () => { token.deleted = true; };
  const storageService = new StorageService();
  await storageService.configure(token, {
    storageKind: "pile",
    state: "opened",
    containerId: "ground-gold",
    manualRows: [{
      rowId: "gold-row",
      name: "Золото",
      quantity: 2,
      itemData: { name: "Золото", type: "loot", system: { quantity: 2 } }
    }]
  });

  const source = await resolveStorageDepositSource({ kind: "storage-token", tokenUuid: token.uuid }, {
    resolveToken: async () => token,
    storageService,
    createRowId: () => "moved-gold"
  });

  assert.equal(source.kind, "storage-token");
  assert.equal(source.row.rowKind, "item");
  assert.equal(source.row.name, "Золото");
  assert.equal(source.available, 2);

  const partial = await source.consume(1);
  assert.equal(token.deleted, undefined);
  assert.equal(readStorageState(token).manualRows[0].quantity, 1);
  await source.restore(partial);
  assert.equal(readStorageState(token).manualRows[0].quantity, 2);

  const complete = await source.consume(2);
  assert.equal(token.deleted, true);
  await source.restore(complete);
  assert.equal(token.parent.created.length, 1);
});

test("a marked ground pile with a stale chest kind still transfers its single ordinary item directly", async () => {
  const token = createStorageToken();
  token.flags[MODULE_ID] = { groundPile: { enabled: true } };
  token.actor.flags[MODULE_ID].builtinStoragePreset = { id: "ground-pile" };
  const storageService = new StorageService();
  await storageService.configure(token, {
    storageKind: "chest",
    state: "opened",
    containerId: "legacy-ground-item",
    manualRows: [{
      rowId: "fuel-row",
      name: "Топливный бак (1)",
      quantity: 3,
      itemData: {
        name: "Топливный бак (1)",
        type: "consumable",
        system: { quantity: 3 }
      }
    }]
  });

  const source = await resolveStorageDepositSource({ kind: "storage-token", tokenUuid: token.uuid }, {
    resolveToken: async () => token,
    storageService,
    createRowId: () => "moved-fuel"
  });

  assert.equal(source.row.rowKind, "item");
  assert.equal(source.row.name, "Топливный бак (1)");
  assert.equal(source.available, 3);
});
