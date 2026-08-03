import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { buildStorageContainerRow } from "../scripts/data/storage-container-snapshot.js";
import {
  StorageContainerItemService,
  buildStorageContainerSnapshotFromToken
} from "../scripts/data/storage-container-item-service.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function createActor() {
  let sequence = 0;
  const contents = [];
  const actor = {
    id: "hero",
    uuid: "Actor.hero",
    type: "character",
    items: {
      contents,
      get(id) { return contents.find((item) => item.id === id) ?? null; },
      [Symbol.iterator]() { return contents[Symbol.iterator](); }
    },
    async createEmbeddedDocuments(_type, documents) {
      return documents.map((source) => {
        const data = clone(source);
        const item = {
          ...data,
          id: data._id || `item-${++sequence}`,
          parent: actor,
          documentName: "Item",
          get uuid() { return `${actor.uuid}.Item.${this.id}`; },
          getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
          toObject() {
            const { parent: _parent, getFlag: _getFlag, toObject: _toObject, update: _update, ...plain } = this;
            return clone(plain);
          },
          async update(patch) {
            for (const [path, value] of Object.entries(patch)) {
              const parts = path.split(".");
              let cursor = this;
              for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
              cursor[parts.at(-1)] = clone(value);
            }
          }
        };
        contents.push(item);
        return item;
      });
    },
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) {
        const index = contents.findIndex((item) => item.id === id);
        if (index >= 0) contents.splice(index, 1);
      }
      return ids;
    }
  };
  return actor;
}

function bagSnapshot() {
  const pouch = {
    containerId: "pouch-1",
    storageKind: "bag",
    name: "Кошель",
    img: "icons/pouch.webp",
    state: {
      baseName: "Кошель",
      state: "opened",
      manualRows: [{
        rowId: "gem-row",
        name: "Самоцвет",
        img: "icons/gem.webp",
        quantity: 2,
        itemData: { name: "Самоцвет", type: "loot", img: "icons/gem.webp", system: { quantity: 2 } }
      }],
      generatedRows: [],
      claimedRowIds: [],
      manualCoins: {},
      generatedCoins: {},
      coinsClaimed: false
    }
  };
  return {
    containerId: "bag-1",
    storageKind: "bag",
    name: "Сумка хранения",
    img: "icons/bag.webp",
    state: {
      baseName: "Сумка хранения",
      state: "opened",
      manualRows: [
        {
          rowId: "rope-row",
          name: "Верёвка",
          img: "icons/rope.webp",
          quantity: 3,
          itemData: { name: "Верёвка", type: "loot", img: "icons/rope.webp", system: { quantity: 3 } }
        },
        buildStorageContainerRow(pouch, { rowId: "pouch-row" })
      ],
      generatedRows: [],
      claimedRowIds: [],
      manualCoins: {},
      generatedCoins: {},
      coinsClaimed: false
    },
    presentation: { actorId: "storage-actor" }
  };
}

test("portable storage materializes as native dnd5e container hierarchy and captures live quantities", async () => {
  const actor = createActor();
  const service = new StorageContainerItemService();
  const root = await service.materializeToActorOnce(actor, bagSnapshot(), "grant-1");

  assert.equal(root.type, "container");
  assert.equal(root.system.quantity, 1);
  assert.equal(actor.items.contents.length, 4);
  const rope = actor.items.contents.find((item) => item.name === "Верёвка");
  const pouch = actor.items.contents.find((item) => item.name === "Кошель");
  const gem = actor.items.contents.find((item) => item.name === "Самоцвет");
  assert.equal(rope.system.container, root.id);
  assert.equal(pouch.type, "container");
  assert.equal(pouch.system.container, root.id);
  assert.equal(gem.system.container, pouch.id);

  await rope.update({ "system.quantity": 1 });
  const captured = await service.captureFromItem(root);
  assert.equal(captured.state.manualRows.find((row) => row.name === "Верёвка").quantity, 1);
  assert.equal(captured.state.manualRows.find((row) => row.name === "Кошель").container.state.manualRows[0].quantity, 2);

  const repeated = await service.materializeToActorOnce(actor, bagSnapshot(), "grant-1");
  assert.equal(repeated.id, root.id);
  assert.equal(actor.items.contents.length, 4);
});

test("portable storage creates its complete item tree in one actor batch", async () => {
  const actor = createActor();
  const originalCreate = actor.createEmbeddedDocuments.bind(actor);
  const calls = [];
  actor.createEmbeddedDocuments = async (type, documents, options) => {
    calls.push({ type, documents: clone(documents), options: clone(options) });
    return originalCreate(type, documents, options);
  };

  const root = await new StorageContainerItemService().materializeToActorOnce(
    actor,
    bagSnapshot(),
    "single-batch"
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "Item");
  assert.equal(calls[0].documents.length, 4);
  assert.equal(calls[0].options.keepId, true);
  assert.equal(actor.items.contents.length, 4);
  assert.equal(actor.items.contents.find((item) => item.name === "Верёвка").system.container, root.id);
});

test("removing and restoring a portable container moves its entire item tree", async () => {
  const actor = createActor();
  const service = new StorageContainerItemService();
  const root = await service.materializeToActorOnce(actor, bagSnapshot(), "grant-remove");

  const receipt = await service.removeItemTree(root);
  assert.equal(actor.items.contents.length, 0);
  assert.equal(receipt.snapshot.containerId, "bag-1");

  const restored = await service.restoreItemTree(receipt);
  assert.equal(restored.type, "container");
  assert.equal(actor.items.contents.length, 4);
});

test("an ordinary native dnd5e container is captured with all of its live contents", async () => {
  const actor = createActor();
  const [bag] = await actor.createEmbeddedDocuments("Item", [{
    name: "Походный рюкзак",
    type: "container",
    img: "icons/backpack.webp",
    system: {
      quantity: 1,
      container: null,
      type: { value: "backpack" },
      currency: { gp: 3 }
    },
    flags: {}
  }]);
  await actor.createEmbeddedDocuments("Item", [{
    name: "Факел",
    type: "consumable",
    img: "icons/torch.webp",
    system: { quantity: 4, container: bag.id },
    flags: {}
  }]);

  const snapshot = await new StorageContainerItemService().captureFromItem(bag);

  assert.equal(snapshot.storageKind, "bag");
  assert.equal(snapshot.name, "Походный рюкзак");
  assert.equal(snapshot.state.manualRows.length, 1);
  assert.equal(snapshot.state.manualRows[0].name, "Факел");
  assert.equal(snapshot.state.manualRows[0].quantity, 4);
  assert.equal(snapshot.state.manualCoins.gp, 3);
});

test("scene storage snapshots preserve actor and token presentation", () => {
  const token = {
    id: "chest",
    uuid: "Scene.scene.Token.chest",
    name: "Сундук",
    actor: { id: "storage-actor" },
    texture: { src: "modules/rebreya-main/assets/chests/open.webp", scaleX: 1.2, scaleY: 1.2 },
    width: 1,
    height: 1,
    disposition: 0,
    flags: {
      [MODULE_ID]: {
        storage: {
          containerId: "chest-1",
          storageKind: "chest",
          baseName: "Сундук",
          state: "opened",
          manualRows: [],
          generatedRows: []
        }
      }
    },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };

  const snapshot = buildStorageContainerSnapshotFromToken(token);
  assert.equal(snapshot.containerId, "chest-1");
  assert.equal(snapshot.presentation.actorId, "storage-actor");
  assert.equal(snapshot.presentation.tokenData.texture.scaleX, 1.2);
  assert.equal(snapshot.img, token.texture.src);
});

test("portable container restores to a scene token once with the same storage state", async () => {
  const created = [];
  const scene = {
    id: "scene",
    tokens: { contents: [] },
    async createEmbeddedDocuments(type, documents) {
      created.push({ type, documents: clone(documents) });
      const token = {
        ...clone(documents[0]),
        id: "restored-token",
        getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
      };
      this.tokens.contents.push(token);
      return [token];
    }
  };
  const actor = {
    id: "storage-actor",
    async getTokenDocument() {
      return {
        toObject: () => ({ actorId: this.id, texture: { src: "prototype.webp" }, width: 1, height: 1 })
      };
    }
  };
  const service = new StorageContainerItemService({
    resolveScene: (id) => id === scene.id ? scene : null,
    resolveActor: (id) => id === actor.id ? actor : null
  });

  const first = await service.restoreSnapshotToScene(bagSnapshot(), {
    sceneId: scene.id,
    x: 100,
    y: 200,
    mutationId: "scene-restore"
  });
  const second = await service.restoreSnapshotToScene(bagSnapshot(), {
    sceneId: scene.id,
    x: 999,
    y: 999,
    mutationId: "scene-restore"
  });

  assert.equal(first.id, second.id);
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "Token");
  assert.equal(created[0].documents[0].x, 100);
  assert.equal(created[0].documents[0].y, 200);
  assert.equal(created[0].documents[0].flags[MODULE_ID].storage.containerId, "bag-1");
  assert.equal(created[0].documents[0].flags[MODULE_ID].storageContainerMutation.id, "scene-restore");
});

test("a native container without a stored actor uses the Rebreya fallback storage actor on scene restore", async () => {
  const created = [];
  const scene = {
    id: "scene",
    tokens: { contents: [] },
    async createEmbeddedDocuments(_type, documents) {
      created.push(clone(documents[0]));
      return [{ ...clone(documents[0]), id: "bag-token" }];
    }
  };
  const fallbackActor = {
    id: "ground-storage",
    async getTokenDocument() {
      return { toObject: () => ({ actorId: this.id, width: 1, height: 1, texture: { src: "fallback.webp" } }) };
    }
  };
  const service = new StorageContainerItemService({
    resolveScene: () => scene,
    resolveActor: () => null,
    resolveFallbackActor: () => fallbackActor
  });
  const snapshot = bagSnapshot();
  snapshot.presentation = { itemSystem: { type: { value: "backpack" } } };

  await service.restoreSnapshotToScene(snapshot, {
    sceneId: "scene",
    x: 100,
    y: 200,
    mutationId: "native-bag-scene"
  });

  assert.equal(created[0].actorId, fallbackActor.id);
  assert.equal(created[0].name, snapshot.name);
  assert.equal(created[0].texture.src, snapshot.img);
});

test("a restored bag does not inherit the fallback ground-pile marker", async () => {
  const created = [];
  const scene = {
    id: "scene",
    tokens: { contents: [] },
    async createEmbeddedDocuments(_type, documents) {
      created.push(clone(documents[0]));
      return [{ ...clone(documents[0]), id: "bag-token" }];
    }
  };
  const fallbackActor = {
    id: "ground-storage",
    async getTokenDocument() {
      return {
        toObject: () => ({
          actorId: this.id,
          width: 1,
          height: 1,
          flags: { [MODULE_ID]: { groundPile: { enabled: true } } }
        })
      };
    }
  };
  const service = new StorageContainerItemService({
    resolveScene: () => scene,
    resolveActor: () => null,
    resolveFallbackActor: () => fallbackActor
  });

  await service.restoreSnapshotToScene(bagSnapshot(), {
    sceneId: "scene",
    x: 100,
    y: 200,
    mutationId: "bag-with-fallback-prototype"
  });

  assert.equal(created[0].flags[MODULE_ID].storage.storageKind, "bag");
  assert.equal(created[0].flags[MODULE_ID].groundPile, undefined);
});
