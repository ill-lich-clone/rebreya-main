import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  MAX_STORAGE_CONTAINER_DEPTH,
  buildStorageContainerRow,
  buildStorageContainerSnapshot,
  collectStorageContainerIds,
  createPortableStorageContainerItemData,
  isPortableStorageContainerItem,
  isStorageContainerRow,
  isStorageJournalRow,
  readPortableStorageContainerSnapshot,
  rekeyStorageContainerSnapshot,
  resolveStorageContainerPath,
  updateStorageContainerPath
} from "../scripts/data/storage-container-snapshot.js";

function snapshot(containerId, name, rows = []) {
  return {
    containerId,
    storageKind: "bag",
    name,
    img: `icons/${containerId}.webp`,
    state: {
      version: 1,
      baseName: name,
      state: "opened",
      manualRows: rows,
      generatedRows: [],
      claimedRowIds: [],
      manualCoins: {},
      generatedCoins: {},
      coinsClaimed: false
    }
  };
}

test("container rows are unique quantity-one rows and ordinary rows remain stackable items", () => {
  const nested = snapshot("bag-1", "Сумка хранения");
  const row = buildStorageContainerRow(nested, { rowId: "row-bag" });
  const root = buildStorageContainerSnapshot(snapshot("chest-1", "Сундук", [
    {
      rowId: "rope",
      stackKey: "rope",
      name: "Верёвка",
      quantity: 3,
      itemData: { type: "loot", system: { quantity: 3 } }
    },
    row
  ]));

  assert.equal(root.state.manualRows[0].rowKind, "item");
  assert.equal(root.state.manualRows[0].quantity, 3);
  assert.equal(root.state.manualRows[1].rowKind, "container");
  assert.equal(root.state.manualRows[1].quantity, 1);
  assert.equal(root.state.manualRows[1].stackKey, "");
  assert.equal(root.state.manualRows[1].itemData.system.quantity, 1);
  assert.equal(isStorageContainerRow(root.state.manualRows[1]), true);
  assert.equal(isStorageContainerRow(root.state.manualRows[0]), false);
  assert.deepEqual([...collectStorageContainerIds(root)].sort(), ["bag-1", "chest-1"]);
});

test("journal reference rows stay canonical across root, nested, portable, and rekeyed snapshots", () => {
  const journal = {
    rowKind: "journal",
    rowId: "journal-row",
    sourceId: "JournalEntry.secret-notes",
    sourceType: "journal",
    name: "Полевые заметки",
    img: "icons/book.webp",
    quantity: 99,
    itemData: { type: "loot" }
  };
  const root = buildStorageContainerSnapshot(snapshot("root", "Сундук", [
    journal,
    buildStorageContainerRow(snapshot("nested", "Сумка", [
      { ...journal, rowId: "nested-journal-row" }
    ]), { rowId: "nested-row" })
  ]));
  const expected = {
    rowKind: "journal",
    rowId: "journal-row",
    stackKey: "",
    sourceId: "JournalEntry.secret-notes",
    sourceType: "journal",
    name: "Полевые заметки",
    img: "icons/book.webp",
    quantity: 1
  };

  assert.deepEqual(root.state.manualRows[0], expected);
  assert.equal(isStorageJournalRow(root.state.manualRows[0]), true);
  assert.equal("itemData" in root.state.manualRows[0], false);
  assert.deepEqual(root.state.manualRows[1].container.state.manualRows[0], {
    ...expected,
    rowId: "nested-journal-row"
  });
  assert.equal(readPortableStorageContainerSnapshot(
    createPortableStorageContainerItemData(root)
  ).state.manualRows[0].sourceId, "JournalEntry.secret-notes");
  assert.equal(rekeyStorageContainerSnapshot(root).state.manualRows[0].sourceId, "JournalEntry.secret-notes");
  assert.throws(
    () => buildStorageContainerSnapshot(snapshot("invalid", "Сундук", [{
      rowKind: "journal",
      rowId: "missing-source"
    }])),
    TypeError
  );
});

test("Journal read markers survive root, nested, portable, and rekeyed snapshot paths", () => {
  const journal = {
    rowKind: "journal",
    rowId: "root-notes",
    sourceId: "JournalEntry.root-notes",
    sourceType: "journal",
    name: "Корневая записка",
    quantity: 1
  };
  const nested = snapshot("nested-read", "Сумка", [{ ...journal, rowId: "nested-notes" }]);
  nested.state.readJournalRowIds = [" nested-notes ", "missing", "nested-notes"];
  const input = snapshot("root-read", "Сундук", [
    journal,
    buildStorageContainerRow(nested, { rowId: "bag-row" })
  ]);
  input.state.readJournalRowIds = [" root-notes ", "missing", "root-notes"];

  const root = buildStorageContainerSnapshot(input);
  const portable = readPortableStorageContainerSnapshot(createPortableStorageContainerItemData(root));
  let sequence = 0;
  const rekeyed = rekeyStorageContainerSnapshot(root, {
    createId: (prefix) => `${prefix}-copy-${sequence += 1}`
  });

  assert.deepEqual(root.state.readJournalRowIds, ["root-notes"]);
  assert.deepEqual(resolveStorageContainerPath(root, ["bag-row"]).state.readJournalRowIds, ["nested-notes"]);
  assert.deepEqual(portable.state.readJournalRowIds, ["root-notes"]);
  assert.deepEqual(resolveStorageContainerPath(portable, ["bag-row"]).state.readJournalRowIds, ["nested-notes"]);
  assert.deepEqual(rekeyed.state.readJournalRowIds, ["root-notes"]);
  assert.deepEqual(resolveStorageContainerPath(rekeyed, ["bag-row"]).state.readJournalRowIds, ["nested-notes"]);
});

test("pending bulk claim bindings survive portable and rekeyed container snapshots", () => {
  const input = snapshot("bulk-bound", "Сумка");
  input.state.bulkClaimMutations = [{
    mutationKey: "storage:root:all:self:bulk-bound",
    fingerprint: "request-fingerprint",
    status: "pending"
  }];

  const root = buildStorageContainerSnapshot(input);
  const portable = readPortableStorageContainerSnapshot(createPortableStorageContainerItemData(root));
  const rekeyed = rekeyStorageContainerSnapshot(root, { createId: () => "bulk-bound-copy" });

  assert.deepEqual(portable.state.bulkClaimMutations, root.state.bulkClaimMutations);
  assert.deepEqual(rekeyed.state.bulkClaimMutations, root.state.bulkClaimMutations);
});

test("container snapshots reject duplicate ancestors and nesting deeper than eight levels", () => {
  const duplicateAncestor = snapshot("root", "Root", [
    buildStorageContainerRow(snapshot("root", "Duplicate"), { rowId: "duplicate" })
  ]);
  assert.throws(
    () => buildStorageContainerSnapshot(duplicateAncestor),
    /цикл|повтор/i
  );

  let current = snapshot(`depth-${MAX_STORAGE_CONTAINER_DEPTH + 1}`, "Too deep");
  for (let depth = MAX_STORAGE_CONTAINER_DEPTH; depth >= 0; depth -= 1) {
    current = snapshot(`depth-${depth}`, `Depth ${depth}`, [
      buildStorageContainerRow(current, { rowId: `row-${depth}` })
    ]);
  }
  assert.throws(
    () => buildStorageContainerSnapshot(current),
    /глубин/i
  );
});

test("rekeying a copied container assigns fresh identities to the full nested tree", () => {
  const original = buildStorageContainerSnapshot(snapshot("bag-template", "Сумка хранения", [
    buildStorageContainerRow(snapshot("backpack-template", "Рюкзак", [{
      rowId: "rope-row",
      name: "Верёвка",
      quantity: 2,
      itemData: { type: "loot", system: { quantity: 2 } }
    }]), { rowId: "backpack-row" })
  ]));
  const ids = ["bag-copy", "backpack-copy"];

  const copied = rekeyStorageContainerSnapshot(original, {
    createId: () => ids.shift()
  });

  const nested = copied.state.manualRows[0];
  assert.equal(copied.containerId, "bag-copy");
  assert.equal(copied.state.containerId, "bag-copy");
  assert.equal(nested.container.containerId, "backpack-copy");
  assert.equal(nested.container.state.containerId, "backpack-copy");
  assert.equal(nested.sourceId, "storage-container:backpack-copy");
  assert.equal(nested.container.state.manualRows[0].name, "Верёвка");
  assert.equal(original.containerId, "bag-template");
  assert.equal(original.state.manualRows[0].container.containerId, "backpack-template");
});

test("nested paths resolve and update immutably", () => {
  const pouch = snapshot("pouch", "Кошель", [{
    rowId: "coin",
    name: "Жетон",
    quantity: 1,
    itemData: { type: "loot", system: { quantity: 1 } }
  }]);
  const bag = snapshot("bag", "Сумка", [
    buildStorageContainerRow(pouch, { rowId: "pouch-row" })
  ]);
  const root = buildStorageContainerSnapshot(snapshot("root", "Сундук", [
    buildStorageContainerRow(bag, { rowId: "bag-row" })
  ]));

  assert.equal(resolveStorageContainerPath(root, ["bag-row", "pouch-row"]).name, "Кошель");
  assert.equal(resolveStorageContainerPath(root, ["missing"]), null);

  const updated = updateStorageContainerPath(root, ["bag-row", "pouch-row"], (current) => ({
    ...current,
    name: "Новый кошель",
    state: { ...current.state, baseName: "Новый кошель" }
  }));
  assert.equal(resolveStorageContainerPath(updated, ["bag-row", "pouch-row"]).name, "Новый кошель");
  assert.equal(resolveStorageContainerPath(root, ["bag-row", "pouch-row"]).name, "Кошель");
});

test("portable storage uses a standard dnd5e container Item and preserves its recursive snapshot", () => {
  const root = buildStorageContainerSnapshot(snapshot("bag", "Сумка хранения"));
  const data = createPortableStorageContainerItemData(root, {
    parentContainerId: "outer-container",
    capacityWeight: 500,
    capacityVolume: 64,
    weight: 15,
    weightlessContents: true
  });

  assert.equal(data.type, "container");
  assert.equal(data.system.quantity, 1);
  assert.equal(data.system.container, "outer-container");
  assert.deepEqual(data.system.weight, { value: 15, units: "lb" });
  assert.equal(data.system.capacity.weight.value, 500);
  assert.equal(data.system.capacity.volume.value, 64);
  assert.deepEqual(data.system.properties, ["weightlessContents"]);
  assert.equal(data.flags[MODULE_ID].storageContainer.containerId, "bag");
  assert.equal(isPortableStorageContainerItem(data), true);
  assert.deepEqual(readPortableStorageContainerSnapshot(data), root);
});
