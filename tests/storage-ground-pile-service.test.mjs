import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { StorageGroundPileService } from "../scripts/data/storage-ground-pile-service.js";
import { readStorageState } from "../scripts/data/storage-service.js";

function applyPatch(target, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let cursor = target;
    for (const part of parts.slice(0, -1)) cursor = (cursor[part] ??= {});
    cursor[parts.at(-1)] = structuredClone(value);
  }
}

function createHarness() {
  const pileActor = {
    id: "pile-actor",
    flags: {
      [MODULE_ID]: {
        builtinStoragePreset: { id: "ground-pile" },
        storage: { enabled: true }
      }
    },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    prototypeToken: { name: "Куча предметов", width: 1, height: 1, texture: { src: "mixed.png" } }
  };
  const tokens = [];
  const scene = {
    id: "scene",
    grid: { size: 100, distance: 5 },
    tokens: { contents: tokens },
    async createEmbeddedDocuments(type, rows) {
      assert.equal(type, "Token");
      return rows.map((data, index) => {
        const token = {
          ...structuredClone(data),
          id: `pile-${tokens.length + index + 1}`,
          uuid: `Scene.scene.Token.pile-${tokens.length + index + 1}`,
          parent: scene,
          actor: pileActor,
          getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
          async update(patch) { applyPatch(this, patch); return this; },
          async delete() { tokens.splice(tokens.indexOf(this), 1); this.deleted = true; }
        };
        tokens.push(token);
        return token;
      });
    }
  };
  const game = {
    actors: { contents: [pileActor] },
    scenes: { get: (id) => id === scene.id ? scene : null, contents: [scene] },
    user: { id: "gm", isGM: true }
  };
  let nextId = 0;
  const service = new StorageGroundPileService({
    gameProvider: () => game,
    isActiveGm: () => true,
    idFactory: () => `pile-row-${++nextId}`
  });
  return { service, scene, tokens, pileActor };
}

const sword = {
  rowId: "source-sword",
  sourceType: "gear",
  sourceId: "sword",
  name: "Меч",
  img: "icons/sword.webp",
  typeLabel: "Оружие",
  quantity: 5,
  itemData: { name: "Меч", system: { quantity: 5 } }
};

const axe = {
  ...structuredClone(sword),
  rowId: "source-axe",
  sourceId: "axe",
  name: "Топор",
  img: "icons/axe.webp",
  quantity: 1,
  itemData: { name: "Топор", system: { quantity: 1 } }
};

test("canvas transfer creates an unlinked independent ground pile token", async () => {
  const { service, tokens } = createHarness();
  const result = await service.transferToScene({
    row: sword,
    quantity: 2,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "create-1"
  });

  assert.equal(result.created, true);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].actorLink, false);
  assert.equal(tokens[0].width, 0.5);
  assert.equal(tokens[0].height, 0.5);
  assert.equal(tokens[0].x, 275);
  assert.equal(tokens[0].y, 375);
  assert.equal(tokens[0].name, "Меч (2)");
  assert.equal(tokens[0].texture.src, "icons/sword.webp");
  assert.equal(tokens[0].flags[MODULE_ID].groundPile.enabled, true);
  assert.equal(readStorageState(tokens[0]).manualRows[0].quantity, 2);
  assert.equal(readStorageState(tokens[0]).state, "opened");
});

test("a player who drops an item owns the created synthetic pile actor", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({
    row: sword,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "player-drop",
    ownerUserId: "player-1"
  });

  assert.equal(tokens[0].delta.ownership["player-1"], 3);
});

test("dropping on a pile stacks identical items and appends different items", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({ row: sword, quantity: 2, sceneId: "scene", x: 300, y: 400, mutationId: "one" });
  await service.transferToScene({ row: sword, quantity: 3, sceneId: "scene", x: 320, y: 420, mutationId: "two" });

  assert.equal(tokens.length, 1);
  assert.equal(readStorageState(tokens[0]).manualRows.length, 1);
  assert.equal(readStorageState(tokens[0]).manualRows[0].quantity, 5);
  assert.equal(tokens[0].name, "Меч (5)");

  await service.transferToScene({
    row: { ...sword, sourceId: "axe", name: "Топор", img: "icons/axe.webp" },
    quantity: 1,
    sceneId: "scene",
    x: 320,
    y: 420,
    mutationId: "three"
  });
  assert.equal(readStorageState(tokens[0]).manualRows.length, 2);
  assert.equal(tokens[0].name, "Куча оружия");
  assert.match(tokens[0].texture.src, /weapons\.png$/u);
});

test("nearby drops outside pile bounds create another token and duplicate mutations do nothing", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({ row: sword, quantity: 1, sceneId: "scene", x: 300, y: 400, mutationId: "one" });
  await service.transferToScene({ row: sword, quantity: 1, sceneId: "scene", x: 340, y: 400, mutationId: "two" });
  assert.equal(tokens.length, 2);

  const duplicate = await service.transferToScene({
    row: sword,
    quantity: 1,
    sceneId: "scene",
    x: 310,
    y: 410,
    mutationId: "one"
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(readStorageState(tokens[0]).manualRows[0].quantity, 1);
});

test("empty ground pile cleanup deletes its token while nonempty piles refresh", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({ row: sword, quantity: 2, sceneId: "scene", x: 300, y: 400, mutationId: "one" });
  const token = tokens[0];
  const state = readStorageState(token);
  state.manualRows[0].quantity = 1;
  state.manualRows[0].itemData.system.quantity = 1;
  await service.refreshAfterStorageMutation(token, state);
  assert.equal(token.name, "Меч");

  await service.refreshAfterStorageMutation(token, { ...state, state: "empty", claimedRowIds: [state.manualRows[0].rowId] });
  assert.equal(token.deleted, true);
  assert.equal(tokens.length, 0);
});

test("a complete snapshot creates one pile with every row and coin", async () => {
  const { service, tokens } = createHarness();

  const result = await service.transferSnapshotToScene({
    rows: [sword, axe],
    coins: { gp: 4, sp: 2 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "snapshot-one"
  });

  assert.equal(result.created, true);
  assert.equal(tokens.length, 1);
  const state = readStorageState(tokens[0]);
  assert.equal(state.manualRows.length, 2);
  assert.deepEqual(state.manualRows.map((row) => row.quantity), [5, 1]);
  assert.deepEqual(state.manualCoins, { pp: 0, gp: 4, sp: 2, cp: 0 });
  assert.equal(tokens[0].width, 1);
  assert.equal(tokens[0].height, 1);
});

test("a single container snapshot keeps the preset token size", async () => {
  const { service, tokens } = createHarness();
  await service.transferSnapshotToScene({
    rows: [{
      ...sword,
      rowKind: "container",
      container: { containerId: "bag-1", rows: [], coins: {} }
    }],
    coins: {},
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "container-one"
  });

  assert.equal(tokens[0].width, 1);
  assert.equal(tokens[0].height, 1);
  assert.equal(tokens[0].x, 250);
  assert.equal(tokens[0].y, 350);
});

test("snapshot retries are idempotent while new snapshots stack rows and add coins", async () => {
  const { service, tokens } = createHarness();
  const request = {
    rows: [sword],
    coins: { gp: 2 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "snapshot-one"
  };
  await service.transferSnapshotToScene(request);
  const duplicate = await service.transferSnapshotToScene(request);
  assert.equal(duplicate.duplicate, true);

  await service.transferSnapshotToScene({
    ...request,
    coins: { gp: 3, cp: 7 },
    mutationId: "snapshot-two"
  });

  assert.equal(tokens.length, 1);
  const state = readStorageState(tokens[0]);
  assert.equal(state.manualRows.length, 1);
  assert.equal(state.manualRows[0].quantity, 10);
  assert.deepEqual(state.manualCoins, { pp: 0, gp: 5, sp: 0, cp: 7 });
});
