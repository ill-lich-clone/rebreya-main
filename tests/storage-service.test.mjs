import test from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_UPDATED_HOOK,
  STORAGE_COIN_DENOMINATIONS,
  StorageService,
  buildStorageTokenState,
  deriveStorageDisplayName,
  isStorageActor,
  readStorageCoinDenomination,
  readStorageState,
  readStorageStateAtPath
} from "../scripts/data/storage-service.js";
import { buildStorageContainerRow } from "../scripts/data/storage-container-snapshot.js";

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

function makeDeadNpcStorageToken(id, actorId = "dead-npc") {
  const token = createStorageToken(id, "Павшее существо");
  token.uuid = `Scene.scene.Token.${id}`;
  token.actor = {
    id: actorId,
    uuid: `Actor.${actorId}`,
    type: "npc",
    system: { attributes: { hp: { value: 0 } } }
  };
  return token;
}

function corpseResult(actorId, rows = []) {
  return {
    rows,
    coins: {},
    corpseMaterialization: {
      version: 1,
      status: "complete",
      sourceActorUuid: `Actor.${actorId}`,
      sourceActorId: actorId
    }
  };
}

test("storage owns coin denominations and reads only the exact managed flag", () => {
  assert.deepEqual(STORAGE_COIN_DENOMINATIONS, ["pp", "gp", "sp", "cp"]);
  assert.equal(readStorageCoinDenomination({
    flags: { "rebreya-main": { storageCoinTemplate: { version: 1, denomination: "gp" } } }
  }), "gp");
  assert.equal(readStorageCoinDenomination({
    flags: { "rebreya-main": { storageCoinTemplate: { version: 1, denomination: "ep" } } }
  }), null);
  assert.equal(readStorageCoinDenomination({
    flags: { "rebreya-main": { storageCoinTemplate: { version: 2, denomination: "gp" } } }
  }), null);
  assert.equal(readStorageCoinDenomination({
    flags: { "rebreya-main": { storageCoinTemplate: { denomination: "gp" } } }
  }), null);
  assert.equal(readStorageCoinDenomination({ name: "Золотая монета" }), null);
});

test("storage snapshots replace the removed goggles icon in row and persisted item data", () => {
  const state = buildStorageTokenState({
    state: "opened",
    generatedRows: [{
      rowId: "night-goggles",
      name: "Ночные очки",
      img: "icons/equipment/eyes/goggles-of-night.webp",
      itemData: {
        name: "Ночные очки",
        img: "goggles-of-night.webp",
        system: { quantity: 1 }
      }
    }]
  });

  const expected = "modules/rebreya-main/templates/icons/Magic%20Items/%D0%9D%D0%BE%D1%87%D0%BD%D1%8B%D0%B5%20%D0%BE%D1%87%D0%BA%D0%B8.webp";
  assert.equal(state.generatedRows[0].img, expected);
  assert.equal(state.generatedRows[0].itemData.img, expected);
});

test("storage keeps only unique read markers for canonical Journal rows", () => {
  const state = buildStorageTokenState({
    state: "opened",
    manualRows: [{
      rowKind: "journal",
      rowId: "notes",
      sourceId: "JournalEntry.notes",
      sourceType: "journal",
      name: "Записка",
      quantity: 1
    }, {
      rowKind: "item",
      rowId: "key",
      name: "Ключ",
      quantity: 1
    }],
    readJournalRowIds: [" notes ", "missing", "key", "notes"]
  });

  assert.deepEqual(state.readJournalRowIds, ["notes"]);
});

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

test("corpse first-open atomically stores a complete marker and stays empty without lootgen", async () => {
  let materializations = 0;
  let generations = 0;
  const service = new StorageService({
    materializeFirstOpen: async () => {
      materializations += 1;
      return corpseResult("troll");
    },
    generate: async () => {
      generations += 1;
      return { rows: [{ rowId: "must-not-exist" }], coins: {} };
    }
  });
  const token = makeDeadNpcStorageToken("troll-token", "troll");

  const [first, duplicate] = await Promise.all([service.open(token), service.open(token)]);

  assert.equal(first.generatedNow, true);
  assert.equal(duplicate.generatedNow, true);
  assert.equal(materializations, 1);
  assert.equal(generations, 0);
  assert.equal(readStorageState(token).state, "empty");
  assert.deepEqual(readStorageState(token).generatedRows, []);
  assert.deepEqual(readStorageState(token).corpseMaterialization, {
    version: 1,
    status: "complete",
    sourceActorUuid: "Actor.troll",
    sourceActorId: "troll"
  });

  const reopenedByNewActiveGm = await new StorageService({
    materializeFirstOpen: async () => {
      materializations += 1;
      return corpseResult("troll", [{ rowId: "duplicate" }]);
    }
  }).open(token);

  assert.equal(reopenedByNewActiveGm.generatedNow, false);
  assert.equal(materializations, 1);
  assert.deepEqual(reopenedByNewActiveGm.rows, []);
});

test("corpse claims preserve the marker and never restore partially or fully claimed loot", async () => {
  let materializations = 0;
  const materializeFirstOpen = async () => {
    materializations += 1;
    return corpseResult("champion", [{
      rowId: "corpse-v1:arrows:strely-20",
      stackKey: "gear:strely-20",
      sourceType: "gear",
      sourceId: "strely-20",
      quantity: 20,
      itemData: { system: { quantity: 20 } }
    }]);
  };
  const token = makeDeadNpcStorageToken("champion-token", "champion");
  const service = new StorageService({ materializeFirstOpen });

  await service.open(token);
  await service.claim(token, { kind: "row", rowId: "corpse-v1:arrows:strely-20", quantity: 7 });
  await new StorageService({ materializeFirstOpen }).open(token);

  assert.equal(readStorageState(token).generatedRows[0].quantity, 13);
  assert.equal(readStorageState(token).generatedRows[0].itemData.system.quantity, 13);
  assert.equal(readStorageState(token).corpseMaterialization.status, "complete");
  assert.equal(materializations, 1);

  await service.claim(token, { kind: "row", rowId: "corpse-v1:arrows:strely-20", quantity: 13 });
  await new StorageService({ materializeFirstOpen }).open(token);

  assert.equal(readStorageState(token).state, "empty");
  assert.deepEqual(readStorageState(token).claimedRowIds, ["corpse-v1:arrows:strely-20"]);
  assert.equal(readStorageState(token).corpseMaterialization.status, "complete");
  assert.equal(materializations, 1);
});

test("two dead tokens sharing one Actor keep independent corpse materialization state", async () => {
  let materializations = 0;
  const service = new StorageService({
    materializeFirstOpen: async ({ token }) => {
      materializations += 1;
      return corpseResult("shared", [{
        rowId: `corpse-v1:${token.id}:sword`,
        sourceType: "gear",
        sourceId: "sword",
        quantity: 1,
        itemData: { system: { quantity: 1 } }
      }]);
    }
  });
  const first = makeDeadNpcStorageToken("first-corpse", "shared");
  const second = makeDeadNpcStorageToken("second-corpse", "shared");

  await Promise.all([service.open(first), service.open(second)]);
  await service.claim(first, { kind: "row", rowId: "corpse-v1:first-corpse:sword" });

  assert.equal(materializations, 2);
  assert.equal(readStorageState(first).state, "empty");
  assert.equal(readStorageState(second).state, "opened");
  assert.deepEqual(readStorageState(second).claimedRowIds, []);
  assert.equal(readStorageState(first).corpseMaterialization.sourceActorId, "shared");
  assert.equal(readStorageState(second).corpseMaterialization.sourceActorId, "shared");
});

test("corpse first-open rechecks HP before its atomic write and leaves no marker after healing", async () => {
  const token = makeDeadNpcStorageToken("healed-before-write", "healed");
  const service = new StorageService({
    materializeFirstOpen: async () => {
      token.actor.system.attributes.hp.value = 1;
      return corpseResult("healed", [{ rowId: "must-not-persist" }]);
    }
  });

  await assert.rejects(service.open(token), /no longer eligible/u);

  assert.equal(readStorageState(token).state, "unopened");
  assert.deepEqual(readStorageState(token).generatedRows, []);
  assert.equal(readStorageState(token).corpseMaterialization, null);
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

test("Journal reference rows cannot be claimed or quantity-edited", async () => {
  const service = new StorageService();
  const token = createStorageToken("journal-guards");
  await service.configure(token, {
    state: "opened",
    manualRows: [{
      rowKind: "journal",
      rowId: "journal-row",
      stackKey: "",
      sourceId: "JournalEntry.notes",
      sourceType: "journal",
      name: "Полевые заметки",
      img: "icons/book.webp",
      quantity: 1
    }]
  });

  await assert.rejects(
    service.claim(token, { kind: "row", rowId: "journal-row", quantity: 1 }),
    /журнал.*нельзя забрать/iu
  );
  await assert.rejects(
    service.updateRowQuantity(token, "journal-row", 2),
    /журнал/iu
  );
  assert.deepEqual(readStorageState(token).claimedRowIds, []);
  assert.equal(readStorageState(token).manualRows[0].quantity, 1);
  assert.equal("itemData" in readStorageState(token).manualRows[0], false);
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

test("Journal deposits store one non-stackable reference and remain GM-deletable", async () => {
  const service = new StorageService();
  const token = createStorageToken("journal-deposit");
  const row = {
    rowKind: "journal",
    rowId: "journal-row",
    stackKey: "must-not-stack",
    sourceId: "JournalEntry.notes",
    sourceType: "journal",
    name: "Полевые заметки",
    img: "icons/book.webp",
    quantity: 1
  };
  await service.configure(token, { state: "empty", displayMode: "empty" });

  await assert.rejects(
    service.depositRow(token, row, { quantity: 2 }),
    /журнал.*целиком|количеств/iu
  );
  assert.deepEqual(readStorageState(token).manualRows, []);

  const result = await service.depositRow(token, row, { quantity: 1 });
  assert.equal(result.quantity, 1);
  assert.equal(result.merged, false);
  assert.deepEqual(readStorageState(token).manualRows, [{
    rowKind: "journal",
    rowId: "journal-row",
    stackKey: "",
    sourceId: "JournalEntry.notes",
    sourceType: "journal",
    name: "Полевые заметки",
    img: "icons/book.webp",
    quantity: 1
  }]);

  const deleted = await service.deleteRow(token, "journal-row");
  assert.deepEqual(deleted.manualRows, []);
  assert.equal(deleted.state, "empty");
});

test("nested storage paths deposit and claim without replacing the root container", async () => {
  const service = new StorageService();
  const token = createStorageToken("nested-root", "Сундук");
  const bagRow = buildStorageContainerRow({
    containerId: "bag-1",
    storageKind: "bag",
    name: "Сумка хранения",
    img: "icons/bag.webp",
    state: {
      baseName: "Сумка хранения",
      state: "opened",
      manualRows: [],
      generatedRows: [],
      claimedRowIds: [],
      manualCoins: {},
      generatedCoins: {},
      coinsClaimed: false
    }
  }, { rowId: "bag-row" });

  await service.configure(token, {
    state: "opened",
    manualRows: [bagRow]
  });
  await service.depositRow(token, {
    rowId: "gem-row",
    stackKey: "gem",
    name: "Самоцвет",
    quantity: 2,
    itemData: { type: "loot", system: { quantity: 2 } }
  }, { quantity: 2, path: ["bag-row"] });

  const nestedBeforeClaim = readStorageStateAtPath(token, ["bag-row"]);
  assert.equal(nestedBeforeClaim.manualRows[0].name, "Самоцвет");
  assert.equal(nestedBeforeClaim.manualRows[0].quantity, 2);
  assert.deepEqual(readStorageState(token).manualRows.map((row) => row.rowId), ["bag-row"]);

  const claim = await service.claim(token, {
    kind: "row",
    rowId: "gem-row",
    quantity: 1,
    path: ["bag-row"]
  });
  assert.equal(claim.row.quantity, 1);
  assert.equal(readStorageStateAtPath(token, ["bag-row"]).manualRows[0].quantity, 1);
  assert.equal(readStorageState(token).state, "opened");
});

test("markJournalRead persists a shared marker inside the selected nested container", async () => {
  const service = new StorageService();
  const token = createStorageToken("journal-root", "Сундук");
  const journal = {
    rowKind: "journal",
    rowId: "nested-notes",
    stackKey: "",
    sourceId: "JournalEntry.nested-notes",
    sourceType: "journal",
    name: "Записка",
    quantity: 1
  };
  const bagRow = buildStorageContainerRow({
    containerId: "journal-bag",
    storageKind: "bag",
    name: "Сумка",
    state: { state: "opened", manualRows: [journal], generatedRows: [] }
  }, { rowId: "bag-row" });
  await service.configure(token, { state: "opened", manualRows: [bagRow] });

  const first = await service.markJournalRead(token, "nested-notes", { path: ["bag-row"] });
  const retry = await service.markJournalRead(token, "nested-notes", { path: ["bag-row"] });

  assert.equal(first.changed, true);
  assert.equal(retry.changed, false);
  assert.deepEqual(readStorageStateAtPath(token, ["bag-row"]).readJournalRowIds, ["nested-notes"]);
  assert.deepEqual(readStorageState(token).readJournalRowIds, []);
});

test("bulk claim bindings are durable per nested scope and pending storage is bounded", async () => {
  const service = new StorageService({ generate: async () => ({ rows: [], coins: {} }) });
  const token = createStorageToken("bulk-bindings-root", "Сундук");
  const bag = buildStorageContainerRow({
    containerId: "bulk-bindings-bag",
    storageKind: "bag",
    name: "Сумка",
    state: { state: "opened", manualRows: [], generatedRows: [] }
  }, { rowId: "bag-row" });
  await service.configure(token, { state: "opened", manualRows: [bag] });

  const first = await service.bindBulkClaimMutation(token, "bulk-key", "fingerprint-a", { path: ["bag-row"] });
  assert.equal(first.changed, true);
  await assert.rejects(
    service.bindBulkClaimMutation(token, "bulk-key", "fingerprint-b", { path: ["bag-row"] }),
    /mutationId|параметр/iu
  );
  const complete = await service.completeBulkClaimMutation(token, "bulk-key", "fingerprint-a", {
    path: ["bag-row"]
  });
  assert.equal(complete.changed, true);
  assert.equal(
    readStorageStateAtPath(token, ["bag-row"]).bulkClaimMutations[0].status,
    "complete"
  );

  for (let index = 0; index < 100; index += 1) {
    await service.bindBulkClaimMutation(token, `pending-${index}`, `fingerprint-${index}`, {
      path: ["bag-row"]
    });
  }
  await assert.rejects(
    service.bindBulkClaimMutation(token, "pending-overflow", "fingerprint-overflow", { path: ["bag-row"] }),
    /слишком много/iu
  );
  const nested = readStorageStateAtPath(token, ["bag-row"]);
  assert.equal(nested.bulkClaimMutations.filter(({ status }) => status === "pending").length, 100);
  assert.equal(nested.bulkClaimMutations.filter(({ status }) => status === "complete").length, 1);
  assert.deepEqual(readStorageState(token).bulkClaimMutations, []);
});

test("storage state keeps at most one hundred completed bulk claim bindings", () => {
  const state = buildStorageTokenState({
    bulkClaimMutations: Array.from({ length: 125 }, (_, index) => ({
      mutationKey: `complete-${index}`,
      fingerprint: `fingerprint-${index}`,
      status: "complete"
    }))
  });

  assert.equal(state.bulkClaimMutations.length, 100);
  assert.equal(state.bulkClaimMutations[0].mutationKey, "complete-25");
  assert.equal(state.bulkClaimMutations.at(-1).mutationKey, "complete-124");
});

test("completing a bulk claim retains its receipt while evicting the oldest terminal binding", async () => {
  const service = new StorageService({ generate: async () => ({ rows: [], coins: {} }) });
  const token = createStorageToken("bulk-complete-rollover", "Сундук");
  await service.configure(token, {
    state: "opened",
    bulkClaimMutations: [
      { mutationKey: "current", fingerprint: "current-fingerprint", status: "pending" },
      ...Array.from({ length: 100 }, (_, index) => ({
        mutationKey: `complete-${index}`,
        fingerprint: `fingerprint-${index}`,
        status: "complete"
      }))
    ]
  });

  await service.completeBulkClaimMutation(token, "current", "current-fingerprint");

  const bindings = readStorageState(token).bulkClaimMutations;
  assert.equal(bindings.length, 100);
  assert.equal(bindings.some(({ mutationKey }) => mutationKey === "current"), true);
  assert.equal(bindings.some(({ mutationKey }) => mutationKey === "complete-0"), false);
});

test("corpse materialization is root-only and nested containers keep their normal first-open lifecycle", async () => {
  let materializations = 0;
  let generations = 0;
  const service = new StorageService({
    materializeFirstOpen: async () => {
      materializations += 1;
      return corpseResult("dead-with-bag", [{ rowId: "corpse-copy" }]);
    },
    generate: async () => {
      generations += 1;
      return { rows: [{ rowId: "nested-generated" }], coins: {} };
    }
  });
  const token = makeDeadNpcStorageToken("dead-with-bag-token", "dead-with-bag");
  const bagRow = buildStorageContainerRow({
    containerId: "corpse-bag",
    storageKind: "bag",
    name: "Сумка",
    state: {
      baseName: "Сумка",
      state: "unopened",
      manualRows: [],
      generatedRows: []
    }
  }, { rowId: "bag-row" });
  await service.configure(token, { state: "opened", manualRows: [bagRow] });

  await service.open(token, { path: ["bag-row"] });

  assert.equal(materializations, 0);
  assert.equal(generations, 1);
  assert.deepEqual(
    readStorageStateAtPath(token, ["bag-row"]).generatedRows.map((row) => row.rowId),
    ["nested-generated"]
  );
  assert.equal(readStorageStateAtPath(token, ["bag-row"]).corpseMaterialization, null);
});

test("nested storage rejects self and ancestor container cycles", async () => {
  const service = new StorageService();
  const token = createStorageToken("cycle-root", "Сундук");
  await service.configure(token, {
    containerId: "root-container",
    state: "opened"
  });

  const selfRow = buildStorageContainerRow({
    containerId: "root-container",
    storageKind: "chest",
    name: "Тот же сундук",
    state: { baseName: "Тот же сундук", state: "opened", manualRows: [], generatedRows: [] }
  }, { rowId: "self-row" });

  await assert.rejects(
    service.depositRow(token, selfRow, { quantity: 1 }),
    /цикл|самого себя|повтор/i
  );
  assert.deepEqual(readStorageState(token).manualRows, []);
});
