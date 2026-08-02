import test from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_UPDATED_HOOK,
  StorageService,
  deriveStorageDisplayName,
  isStorageActor,
  readStorageState
} from "../scripts/data/storage-service.js";

function createStorageToken(id, name = "Сундук") {
  const flags = {};
  return {
    id,
    name,
    flags,
    getFlag(scope, key) {
      return flags[scope]?.[key];
    },
    async update(patch) {
      for (const [path, value] of Object.entries(patch)) {
        const parts = path.split(".");
        let cursor = this;
        for (const part of parts.slice(0, -1)) {
          cursor[part] ??= {};
          cursor = cursor[part];
        }
        cursor[parts.at(-1)] = structuredClone(value);
      }
      return this;
    }
  };
}

test("two storage tokens using one actor keep independent template snapshots", async () => {
  const service = new StorageService();
  const first = createStorageToken("first");
  const second = createStorageToken("second");

  await service.configure(first, {
    baseName: "Сундук",
    template: { name: "Простой", form: { itemCount: 1 } }
  });

  assert.equal(readStorageState(first).template.name, "Простой");
  assert.equal(readStorageState(first).template.form.itemCount, 1);
  assert.equal(readStorageState(second).template, null);
});

test("opening once merges manual rows and a generated result", async () => {
  let generationCount = 0;
  const service = new StorageService({
    generate: async () => {
      generationCount += 1;
      return {
        rows: [{ rowId: "generated" }],
        coins: { gp: 2 }
      };
    }
  });
  const token = createStorageToken("chest");

  await service.configure(token, { manualRows: [{ rowId: "manual" }] });
  const first = await service.open(token, {});
  const second = await service.open(token, {});

  assert.deepEqual(first.rows.map((row) => row.rowId), ["manual", "generated"]);
  assert.equal(first.coins.gp, 2);
  assert.equal(first.generatedNow, true);
  assert.equal(second.generatedNow, false);
  assert.equal(generationCount, 1);
});

test("storage actor marker and empty display name use Rebreya-owned flags", () => {
  assert.equal(isStorageActor({
    flags: {
      "rebreya-main": {
        storage: { enabled: true }
      }
    }
  }), true);
  assert.equal(deriveStorageDisplayName({ baseName: "Бочка", state: "empty" }), "Бочка (пусто)");
});

test("opening, final claim, and reset select the matching storage texture", async () => {
  const textures = {
    unopened: "closed.webp",
    opened: "open.webp",
    empty: "empty.webp"
  };
  const service = new StorageService({
    generate: async () => ({ rows: [{ rowId: "generated" }], coins: {} })
  });
  const token = createStorageToken("visual-chest");

  await service.configure(token, { textures, displayMode: "unopened" });
  assert.equal(token.texture.src, "closed.webp");

  await service.open(token);
  assert.equal(readStorageState(token).state, "opened");
  assert.equal(readStorageState(token).displayMode, "opened");
  assert.equal(token.texture.src, "open.webp");

  await service.claim(token, { kind: "row", rowId: "generated" });
  assert.equal(readStorageState(token).state, "empty");
  assert.equal(readStorageState(token).displayMode, "empty");
  assert.equal(token.texture.src, "empty.webp");
  assert.equal(token.name, "Сундук (пусто)");

  await service.configure(token, {
    generatedRows: [],
    generatedCoins: {},
    claimedRowIds: [],
    coinsClaimed: false,
    state: "unopened",
    displayMode: "unopened"
  });
  assert.equal(readStorageState(token).state, "unopened");
  assert.equal(readStorageState(token).displayMode, "unopened");
  assert.equal(token.texture.src, "closed.webp");
  assert.equal(token.name, "Сундук");
});

test("a partial claim preserves a GM's manual texture without changing loot state", async () => {
  const service = new StorageService({
    generate: async () => ({
      rows: [{ rowId: "first" }, { rowId: "second" }],
      coins: {}
    })
  });
  const token = createStorageToken("manual-visual");
  await service.configure(token, {
    textures: { unopened: "closed.webp", opened: "open.webp", empty: "empty.webp" }
  });
  await service.open(token);

  const manuallyClosed = await service.setTextureMode(token, "unopened");
  assert.equal(manuallyClosed.state, "opened");
  assert.equal(manuallyClosed.displayMode, "unopened");
  assert.equal(token.texture.src, "closed.webp");

  await service.claim(token, { kind: "row", rowId: "first" });
  const current = readStorageState(token);
  assert.equal(current.state, "opened");
  assert.equal(current.displayMode, "unopened");
  assert.deepEqual(current.claimedRowIds, ["first"]);
  assert.equal(token.texture.src, "closed.webp");
});

test("quantity claims decrement a row before claiming its final units", async () => {
  const service = new StorageService({
    generate: async () => ({
      rows: [{
        rowId: "stack",
        name: "Arrows",
        quantity: 5,
        itemData: { system: { quantity: 5 } }
      }],
      coins: {}
    })
  });
  const token = createStorageToken("quantity-claim");
  await service.open(token);

  const first = await service.claim(token, {
    kind: "row",
    rowId: "stack",
    quantity: 2
  });

  assert.equal(first.changed, true);
  assert.equal(first.quantity, 2);
  assert.equal(first.row.quantity, 2);
  assert.equal(first.row.itemData.system.quantity, 2);
  assert.equal(readStorageState(token).generatedRows[0].quantity, 3);
  assert.equal(readStorageState(token).generatedRows[0].itemData.system.quantity, 3);
  assert.deepEqual(readStorageState(token).claimedRowIds, []);
  assert.equal(readStorageState(token).state, "opened");

  const final = await service.claim(token, {
    kind: "row",
    rowId: "stack",
    quantity: 3
  });

  assert.equal(final.quantity, 3);
  assert.deepEqual(readStorageState(token).claimedRowIds, ["stack"]);
  assert.equal(readStorageState(token).state, "empty");
});

test("quantity claims reject invalid or excessive amounts without changing storage", async () => {
  const service = new StorageService({
    generate: async () => ({
      rows: [{ rowId: "stack", quantity: 3, itemData: { system: { quantity: 3 } } }],
      coins: {}
    })
  });
  const token = createStorageToken("invalid-quantity-claim");
  await service.open(token);

  await assert.rejects(
    service.claim(token, { kind: "row", rowId: "stack", quantity: 0 }),
    /Количество/u
  );
  await assert.rejects(
    service.claim(token, { kind: "row", rowId: "stack", quantity: 4 }),
    /Количество/u
  );

  assert.equal(readStorageState(token).generatedRows[0].quantity, 3);
  assert.deepEqual(readStorageState(token).claimedRowIds, []);
});

test("manual texture selection rejects unknown modes and incomplete texture sets", async () => {
  const service = new StorageService();
  const complete = createStorageToken("complete");
  await service.configure(complete, {
    textures: { unopened: "closed.webp", opened: "open.webp", empty: "empty.webp" }
  });
  await assert.rejects(service.setTextureMode(complete, "broken"), /режим/u);

  const incomplete = createStorageToken("incomplete");
  await service.configure(incomplete, {
    textures: { unopened: "closed.webp", opened: "open.webp" }
  });
  await assert.rejects(service.setTextureMode(incomplete, "opened"), /текстур/u);
});

test("legacy storage tokens without textures keep their previous no-texture behavior", async () => {
  const service = new StorageService({
    generate: async () => ({ rows: [{ rowId: "legacy" }], coins: {} })
  });
  const token = createStorageToken("legacy");

  await service.open(token);

  assert.equal(readStorageState(token).state, "opened");
  assert.equal(readStorageState(token).textures, null);
  assert.equal(token.texture, undefined);
});

test("simultaneous first opens invoke the generated callback once after opening", async () => {
  const opened = [];
  const service = new StorageService({
    generate: async () => ({ rows: [{ rowId: "once" }], coins: {} }),
    onGeneratedOpen: async ({ state }) => opened.push(state.state)
  });
  const token = createStorageToken("single-flight");

  await Promise.all([service.open(token), service.open(token)]);

  assert.deepEqual(opened, ["opened"]);
});

test("generated callback failure does not roll back opened storage", async () => {
  const warnings = [];
  const service = new StorageService({
    onGeneratedOpen: async () => { throw new Error("audio failed"); },
    logger: { warn(_message, error) { warnings.push(error.message); } }
  });
  const token = createStorageToken("nonfatal-callback");

  await service.open(token);

  assert.equal(readStorageState(token).state, "opened");
  assert.deepEqual(warnings, ["audio failed"]);
});

test("GM quantity editing updates generated row and embedded item quantity", async () => {
  const service = new StorageService({ generate: async () => ({ rows: [{ rowId: "row", quantity: 1, itemData: { system: { quantity: 1 } } }], coins: {} }) });
  const token = createStorageToken("editable");
  await service.open(token);

  const next = await service.updateRowQuantity(token, "row", 4);

  assert.equal(next.generatedRows[0].quantity, 4);
  assert.equal(next.generatedRows[0].itemData.system.quantity, 4);
});

test("deleting the final generated row empties storage", async () => {
  const service = new StorageService({ generate: async () => ({ rows: [{ rowId: "row" }], coins: {} }) });
  const token = createStorageToken("deletable");
  await service.open(token);

  const next = await service.deleteRow(token, "row");

  assert.equal(next.state, "empty");
  assert.equal(next.displayMode, "empty");
  assert.equal(token.name, "Сундук (пусто)");
});

test("row durability updates only the selected item data and emits storageUpdated", async () => {
  const previousHooks = globalThis.Hooks;
  const calls = [];
  globalThis.Hooks = { callAll: (...args) => calls.push(args) };
  try {
    const service = new StorageService({
      generate: async () => ({
        rows: [
          { rowId: "first", itemData: { flags: { ["rebreya-main"]: { durability: { hp: { value: 5, max: 5 } } } } } },
          { rowId: "second", itemData: { flags: {} } }
        ],
        coins: {}
      })
    });
    const token = createStorageToken("durable-row");
    token.uuid = "Scene.scene.Token.durable-row";
    await service.open(token);
    calls.length = 0;

    const next = await service.updateRowDurability(token, "first", {
      state: "intact",
      hp: { value: 2, max: 5 }
    });

    assert.deepEqual(next.generatedRows[0].itemData.flags["rebreya-main"].durability.hp, { value: 2, max: 5 });
    assert.deepEqual(next.generatedRows[1].itemData.flags, {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], STORAGE_UPDATED_HOOK);
    assert.equal(calls[0][1], token);
  }
  finally {
    globalThis.Hooks = previousHooks;
  }
});

test("depositing into empty storage reopens the same token with its opened texture", async () => {
  const service = new StorageService();
  const token = createStorageToken("deposit-empty");
  token.uuid = "Scene.scene.Token.deposit-empty";
  await service.configure(token, {
    baseName: "Сундук",
    state: "empty",
    displayMode: "empty",
    textures: {
      unopened: "closed.webp",
      opened: "open.webp",
      empty: "empty.webp"
    }
  });

  const result = await service.depositRow(token, {
    rowId: "deposit-new",
    stackKey: "Compendium.dnd5e.items.sword",
    sourceId: "Compendium.dnd5e.items.sword",
    name: "Меч",
    quantity: 2,
    itemData: { name: "Меч", type: "weapon", system: { quantity: 2 } }
  }, { quantity: 2 });

  assert.equal(result.changed, true);
  assert.equal(result.merged, false);
  assert.equal(result.rowId, "deposit-new");
  assert.equal(result.quantity, 2);
  assert.equal(readStorageState(token).state, "opened");
  assert.equal(readStorageState(token).displayMode, "opened");
  assert.equal(readStorageState(token).manualRows[0].quantity, 2);
  assert.equal(readStorageState(token).manualRows[0].itemData.system.quantity, 2);
  assert.equal(token.texture.src, "open.webp");
  assert.equal(token.name, "Сундук");
});

test("depositing an equivalent item merges its stack and leaves claimed rows untouched", async () => {
  const service = new StorageService();
  const token = createStorageToken("deposit-merge");
  await service.configure(token, {
    state: "opened",
    manualRows: [
      {
        rowId: "claimed-stack",
        stackKey: "same-item",
        name: "Стрела",
        quantity: 9,
        itemData: { name: "Стрела", system: { quantity: 9 } }
      },
      {
        rowId: "active-stack",
        stackKey: "same-item",
        name: "Стрела",
        quantity: 3,
        itemData: { name: "Стрела", system: { quantity: 3 } }
      }
    ],
    claimedRowIds: ["claimed-stack"]
  });

  const result = await service.depositRow(token, {
    rowId: "incoming-stack",
    stackKey: "same-item",
    name: "Стрела",
    quantity: 2,
    itemData: { name: "Стрела", system: { quantity: 2 } }
  }, { quantity: 2 });

  const state = readStorageState(token);
  assert.equal(result.merged, true);
  assert.equal(result.rowId, "active-stack");
  assert.equal(state.manualRows.length, 2);
  assert.equal(state.manualRows[0].quantity, 9);
  assert.equal(state.manualRows[1].quantity, 5);
  assert.equal(state.manualRows[1].itemData.system.quantity, 5);
});

test("storage deposits reject invalid quantities without changing state", async () => {
  const service = new StorageService();
  const token = createStorageToken("deposit-invalid");
  await service.configure(token, { state: "empty", displayMode: "empty" });

  await assert.rejects(
    service.depositRow(token, {
      rowId: "bad",
      stackKey: "bad",
      name: "Ошибка",
      itemData: { system: { quantity: 1 } }
    }, { quantity: 0 }),
    /Количество/u
  );

  assert.equal(readStorageState(token).state, "empty");
  assert.deepEqual(readStorageState(token).manualRows, []);
});
