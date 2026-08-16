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

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function createHarness({ activeGm = true, beforeCreate, beforeUpdate } = {}) {
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
      await beforeCreate?.();
      return rows.map((data, index) => {
        const token = {
          ...structuredClone(data),
          id: `pile-${tokens.length + index + 1}`,
          uuid: `Scene.scene.Token.pile-${tokens.length + index + 1}`,
          parent: scene,
          actor: pileActor,
          getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
          async update(patch) { await beforeUpdate?.(); applyPatch(this, patch); return this; },
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
    isActiveGm: () => activeGm,
    idFactory: () => `pile-row-${++nextId}`
  });
  return { service, scene, tokens, pileActor, game };
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

const treasure = {
  ...structuredClone(sword),
  rowId: "source-ruby",
  sourceId: "ruby",
  name: "Рубин",
  img: "icons/ruby.webp",
  typeLabel: "Сокровища",
  quantity: 1,
  itemData: { name: "Рубин", system: { quantity: 1 } }
};

const platinumCoinItemRow = {
  rowId: "legacy-platinum-coin",
  sourceType: "gear",
  sourceId: "Compendium.world.rebreya-gear.Item.platinum",
  name: "Платиновая монета",
  img: "icons/commodities/currency/coins-assorted-mix-platinum.webp",
  typeLabel: "Сокровища",
  quantity: 1,
  itemData: {
    name: "Платиновая монета",
    type: "loot",
    img: "icons/commodities/currency/coins-assorted-mix-platinum.webp",
    system: { quantity: 1, type: { value: "treasure" } },
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        storageCoinTemplate: { version: 1, denomination: "pp" }
      }
    }
  }
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
  assert.equal(tokens[0].flags[MODULE_ID].groundPile.coinPile, false);
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

test("coin transfer creates and merges a pure manual-coin pile idempotently", async () => {
  const { service, tokens } = createHarness();
  const request = {
    coins: { gp: 5 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "coin-drop-one"
  };

  const created = await service.transferCoinsToScene(request);
  assert.equal(created.created, true);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "Золотая монета");
  assert.match(tokens[0].texture.src, /coins-plain-gold\.webp$/u);
  assert.equal(tokens[0].flags[MODULE_ID].groundPile.coinPile, true);
  assert.equal(readStorageState(tokens[0]).manualRows.length, 0);
  assert.deepEqual(readStorageState(tokens[0]).manualCoins, { pp: 0, gp: 5, sp: 0, cp: 0 });
  assert.deepEqual(readStorageState(tokens[0]).generatedCoins, { pp: 0, gp: 0, sp: 0, cp: 0 });

  const processed = service.findProcessedMutationAtPoint(request);
  assert.equal(processed.duplicate, true);
  assert.equal(processed.token, tokens[0]);
  assert.equal(service.findProcessedMutationAtPoint({ ...request, sceneId: "other" }), null);
  assert.equal(service.findProcessedMutationAtPoint({ ...request, x: 900, y: 900 }), null);
  assert.equal(service.findProcessedMutationAtPoint({ ...request, mutationId: "not-processed" }), null);

  const duplicate = await service.transferCoinsToScene(request);
  assert.equal(duplicate.duplicate, true);
  assert.equal(readStorageState(tokens[0]).manualCoins.gp, 5);

  const merged = await service.transferCoinsToScene({
    ...request,
    coins: { sp: 3 },
    mutationId: "coin-drop-two"
  });
  assert.equal(merged.merged, true);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "Куча монет");
  assert.equal(tokens[0].texture.src, `modules/${MODULE_ID}/assets/storage/piles/coins.png`);
  assert.deepEqual(readStorageState(tokens[0]).manualCoins, { pp: 0, gp: 5, sp: 3, cp: 0 });
});

test("coin merge rejects unsafe cumulative balances for every denomination without changing the pile", async () => {
  for (const denomination of ["pp", "gp", "sp", "cp"]) {
    const { service, tokens } = createHarness();
    await service.transferCoinsToScene({
      coins: { [denomination]: Number.MAX_SAFE_INTEGER },
      sceneId: "scene",
      x: 300,
      y: 400,
      mutationId: `coin-safe-limit-${denomination}`
    });
    const before = structuredClone({
      name: tokens[0].name,
      texture: tokens[0].texture,
      flags: tokens[0].flags,
      delta: tokens[0].delta
    });

    await assert.rejects(service.transferCoinsToScene({
      coins: { [denomination]: 1 },
      sceneId: "scene",
      x: 300,
      y: 400,
      mutationId: `coin-overflow-${denomination}`
    }), /безопасным целым/u);

    assert.deepEqual({
      name: tokens[0].name,
      texture: tokens[0].texture,
      flags: tokens[0].flags,
      delta: tokens[0].delta
    }, before);
    assert.equal(readStorageState(tokens[0]).manualCoins[denomination], Number.MAX_SAFE_INTEGER);
  }
});

test("coin merge accepts the exact largest safe cumulative balance", async () => {
  const { service, tokens } = createHarness();
  await service.transferCoinsToScene({
    coins: { gp: Number.MAX_SAFE_INTEGER - 1 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "coin-below-limit"
  });

  const merged = await service.transferCoinsToScene({
    coins: { gp: 1 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "coin-at-limit"
  });

  assert.equal(merged.merged, true);
  assert.equal(readStorageState(tokens[0]).manualCoins.gp, Number.MAX_SAFE_INTEGER);
});

test("concurrent same-ID coin creation creates and adds exactly once", async () => {
  const createEntered = deferred();
  const releaseCreate = deferred();
  const { service, tokens } = createHarness({
    beforeCreate: async () => {
      createEntered.resolve();
      await releaseCreate.promise;
    }
  });
  const request = {
    coins: { gp: 5 }, sceneId: "scene", x: 300, y: 400, mutationId: "parallel-create"
  };

  const first = service.transferCoinsToScene(request);
  await createEntered.promise;
  const second = service.transferCoinsToScene(request);
  releaseCreate.resolve();
  const results = await Promise.all([first, second]);

  assert.equal(tokens.length, 1);
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  assert.deepEqual(readStorageState(tokens[0]).manualCoins, { pp: 0, gp: 5, sp: 0, cp: 0 });
});

test("concurrent same-ID merge adds exactly once", async () => {
  const updateEntered = deferred();
  const releaseUpdate = deferred();
  const { service, tokens } = createHarness({
    beforeUpdate: async () => {
      updateEntered.resolve();
      await releaseUpdate.promise;
    }
  });
  await service.transferCoinsToScene({
    coins: { gp: 1 }, sceneId: "scene", x: 300, y: 400, mutationId: "parallel-base"
  });
  const request = {
    coins: { sp: 2 }, sceneId: "scene", x: 300, y: 400, mutationId: "parallel-same-merge"
  };

  const first = service.transferCoinsToScene(request);
  await updateEntered.promise;
  const second = service.transferCoinsToScene(request);
  releaseUpdate.resolve();
  const results = await Promise.all([first, second]);

  assert.equal(results.filter((result) => result.merged).length, 1);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  assert.deepEqual(readStorageState(tokens[0]).manualCoins, { pp: 0, gp: 1, sp: 2, cp: 0 });
});

test("concurrent distinct merges both survive on the contained pile", async () => {
  const updateEntered = deferred();
  const releaseUpdate = deferred();
  const { service, tokens } = createHarness({
    beforeUpdate: async () => {
      updateEntered.resolve();
      await releaseUpdate.promise;
    }
  });
  await service.transferCoinsToScene({
    coins: { gp: 1 }, sceneId: "scene", x: 300, y: 400, mutationId: "distinct-base"
  });

  const first = service.transferCoinsToScene({
    coins: { sp: 2 }, sceneId: "scene", x: 300, y: 400, mutationId: "distinct-sp"
  });
  await updateEntered.promise;
  const second = service.transferCoinsToScene({
    coins: { cp: 3 }, sceneId: "scene", x: 320, y: 420, mutationId: "distinct-cp"
  });
  releaseUpdate.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(readStorageState(tokens[0]).manualCoins, { pp: 0, gp: 1, sp: 2, cp: 3 });
  assert.deepEqual(tokens[0].flags[MODULE_ID].groundPile.mutationIds, [
    "distinct-base", "distinct-sp", "distinct-cp"
  ]);
});

test("coin mutation lookup requires the active GM and coin transfer rejects an empty map", async () => {
  const { service } = createHarness({ activeGm: false });
  const request = { coins: {}, sceneId: "scene", x: 300, y: 400, mutationId: "empty-coins" };

  assert.throws(() => service.findProcessedMutationAtPoint(request), /активный мастер/u);
  await assert.rejects(() => service.transferCoinsToScene(request), /хотя бы одну монету/u);
});

test("a claimed pure coin pile reopens with only incoming coins", async () => {
  const { service, tokens } = createHarness();
  await service.transferCoinsToScene({
    coins: { gp: 5 }, sceneId: "scene", x: 300, y: 400, mutationId: "coin-create"
  });
  const token = tokens[0];
  const claimed = { ...readStorageState(token), coinsClaimed: true, state: "empty", displayMode: "empty" };

  const emptyResult = await service.refreshAfterStorageMutation(token, claimed);
  assert.equal(emptyResult.deleted, false);
  assert.equal(tokens.length, 1);
  assert.equal(token.name, "Куча монет (пусто)");
  assert.equal(token.texture.src, `modules/${MODULE_ID}/assets/storage/piles/coins.png`);
  assert.equal(token.flags[MODULE_ID].groundPile.coinPile, true);
  assert.equal(readStorageState(token).state, "empty");
  assert.equal(readStorageState(token).displayMode, "empty");

  await service.transferCoinsToScene({
    coins: { gp: 2 }, sceneId: "scene", x: 300, y: 400, mutationId: "coin-reopen-single"
  });
  let reopened = readStorageState(token);
  assert.equal(token.name, "Золотая монета");
  assert.equal(reopened.state, "opened");
  assert.equal(reopened.displayMode, "opened");
  assert.equal(reopened.coinsClaimed, false);
  assert.deepEqual(reopened.manualCoins, { pp: 0, gp: 2, sp: 0, cp: 0 });

  await service.refreshAfterStorageMutation(token, {
    ...reopened,
    generatedCoins: { pp: 0, gp: 0, sp: 0, cp: 4 },
    coinsClaimed: true,
    state: "empty",
    displayMode: "empty"
  });
  await service.transferCoinsToScene({
    coins: { sp: 3 }, sceneId: "scene", x: 300, y: 400, mutationId: "coin-reopen-after-generated"
  });
  reopened = readStorageState(token);
  assert.equal(token.name, "Серебряная монета");
  assert.equal(reopened.state, "opened");
  assert.equal(reopened.coinsClaimed, false);
  assert.deepEqual(reopened.manualCoins, { pp: 0, gp: 0, sp: 3, cp: 0 });
  assert.deepEqual(reopened.generatedCoins, { pp: 0, gp: 0, sp: 0, cp: 0 });
});

test("treasure rows with coins stay treasure piles and still delete when emptied", async () => {
  const { service, tokens } = createHarness();
  await service.transferSnapshotToScene({
    rows: [treasure],
    coins: {},
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "treasure-create"
  });
  await service.transferCoinsToScene({
    coins: { gp: 4 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "treasure-coins"
  });
  const token = tokens[0];
  const state = readStorageState(token);
  assert.equal(token.name, "Куча сокровищ");
  assert.match(token.texture.src, /treasure\.png$/u);
  assert.equal(token.flags[MODULE_ID].groundPile.coinPile, false);
  assert.deepEqual(state.manualCoins, { pp: 0, gp: 4, sp: 0, cp: 0 });

  await service.refreshAfterStorageMutation(token, {
    ...state,
    claimedRowIds: [state.manualRows[0].rowId],
    coinsClaimed: true,
    state: "empty",
    displayMode: "empty"
  });
  assert.equal(token.deleted, true);
  assert.equal(tokens.length, 0);
});

test("snapshot transfer passes coins into treasure presentation", async () => {
  const { service, tokens } = createHarness();
  await service.transferSnapshotToScene({
    rows: [treasure],
    coins: { sp: 2 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "treasure-snapshot"
  });

  assert.equal(tokens[0].name, "Куча сокровищ");
  assert.match(tokens[0].texture.src, /treasure\.png$/u);
  assert.equal(tokens[0].flags[MODULE_ID].groundPile.coinPile, false);
});

test("snapshot transfer converts managed coin rows into manualCoins before creating the pile", async () => {
  const { service, tokens } = createHarness();
  await service.transferSnapshotToScene({
    rows: [platinumCoinItemRow],
    coins: { gp: 100 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "coin-row-snapshot"
  });

  const state = readStorageState(tokens[0]);
  assert.deepEqual(state.manualRows, []);
  assert.deepEqual(state.manualCoins, { pp: 1, gp: 100, sp: 0, cp: 0 });
  assert.equal(tokens[0].name, "Куча монет");
  assert.equal(tokens[0].width, 0.5);
  assert.equal(tokens[0].height, 0.5);
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

test("pure coin piles use the tiny ground-item token size", async () => {
  const { service, tokens } = createHarness();

  await service.transferCoinsToScene({
    coins: { gp: 100 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "tiny-gold-pile"
  });

  assert.equal(tokens[0].width, 0.5);
  assert.equal(tokens[0].height, 0.5);
  assert.equal(tokens[0].x, 275);
  assert.equal(tokens[0].y, 375);
});

test("a managed Coin Item dropped onto existing gold becomes manual platinum currency, never an Item row", async () => {
  const { service, tokens } = createHarness();
  await service.transferCoinsToScene({
    coins: { gp: 100 },
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "existing-gold"
  });

  await service.transferToScene({
    row: platinumCoinItemRow,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "platinum-item-on-gold"
  });

  const state = readStorageState(tokens[0]);
  assert.deepEqual(state.manualRows, []);
  assert.deepEqual(state.manualCoins, { pp: 1, gp: 100, sp: 0, cp: 0 });
  assert.equal(tokens[0].name, "Куча монет");
  assert.equal(tokens[0].texture.src, `modules/${MODULE_ID}/assets/storage/piles/coins.png`);
  assert.equal(tokens[0].width, 0.5);
  assert.equal(tokens[0].height, 0.5);
});

test("active GM idempotently migrates legacy Coin Item rows into manualCoins and repairs presentation and size", async () => {
  const { service, tokens } = createHarness();
  await service.transferToScene({
    row: sword,
    quantity: 1,
    sceneId: "scene",
    x: 300,
    y: 400,
    mutationId: "legacy-pile-seed"
  });
  const token = tokens[0];
  const legacyState = readStorageState(token);
  legacyState.manualRows = [structuredClone(platinumCoinItemRow)];
  legacyState.manualCoins = { pp: 0, gp: 100, sp: 0, cp: 0 };
  token.flags[MODULE_ID].storage = legacyState;
  token.width = 1;
  token.height = 1;
  token.x = 250;
  token.y = 350;

  const first = await service.repairLegacyCoinRows();
  const second = await service.repairLegacyCoinRows();

  assert.deepEqual(first, { repairedTokens: 1, convertedRows: 1 });
  assert.deepEqual(second, { repairedTokens: 0, convertedRows: 0 });
  const repaired = readStorageState(token);
  assert.deepEqual(repaired.manualRows, []);
  assert.deepEqual(repaired.manualCoins, { pp: 1, gp: 100, sp: 0, cp: 0 });
  assert.equal(token.name, "Куча монет");
  assert.equal(token.texture.src, `modules/${MODULE_ID}/assets/storage/piles/coins.png`);
  assert.equal(token.width, 0.5);
  assert.equal(token.height, 0.5);
  assert.equal(token.x, 275);
  assert.equal(token.y, 375);
});
