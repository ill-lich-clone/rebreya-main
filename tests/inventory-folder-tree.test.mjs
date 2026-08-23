import test from "node:test";
import assert from "node:assert/strict";

import {
  INVENTORY_FOLDER_STATE_VERSION,
  MAX_INVENTORY_FOLDER_DEPTH,
  MAX_INVENTORY_FOLDER_NAME_LENGTH,
  InventoryFolderStateError,
  buildInventoryFolderSearchIndex,
  buildInventoryFolderTree,
  createEmptyInventoryFolderState,
  createInventoryFolder,
  deleteInventoryFolder,
  moveInventoryFolder,
  moveInventoryItemToFolder,
  normalizeExpandedFolderIds,
  normalizeInventoryFolderState,
  projectInventoryFolderRows,
  renameInventoryFolder
} from "../scripts/data/inventory-folder-tree.js";

function assertFolderError(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof InventoryFolderStateError);
    assert.equal(error.code, code);
    return true;
  });
}

function makeState(folders, itemFolderIds = {}) {
  return { version: 1, folders, itemFolderIds };
}

test("folder state constants and empty state expose the versioned contract", () => {
  assert.equal(INVENTORY_FOLDER_STATE_VERSION, 1);
  assert.equal(MAX_INVENTORY_FOLDER_DEPTH, 5);
  assert.equal(MAX_INVENTORY_FOLDER_NAME_LENGTH, 80);
  assert.deepEqual(createEmptyInventoryFolderState(), {
    version: 1,
    folders: [],
    itemFolderIds: {}
  });
});

test("normalizeInventoryFolderState repairs corrupt parents, cycles, depth and membership", () => {
  const normalized = normalizeInventoryFolderState({
    version: 99,
    folders: [
      { id: "a", name: " A ", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
      { id: "a", name: "duplicate", parentId: null },
      { id: "self", name: "Self", parentId: "self" },
      { id: "missing", name: "Missing", parentId: "absent" },
      { id: "", name: "invalid", parentId: null },
      { id: "blank", name: "   ", parentId: null }
    ],
    itemFolderIds: {
      live: "a",
      staleItem: "a",
      unknownFolder: "absent"
    }
  }, { itemIds: ["live", "unknownFolder"] });

  assert.deepEqual(normalized, {
    version: 1,
    folders: [
      { id: "a", name: "A", parentId: null },
      { id: "b", name: "B", parentId: null },
      { id: "self", name: "Self", parentId: null },
      { id: "missing", name: "Missing", parentId: null }
    ],
    itemFolderIds: { live: "a" }
  });
});

test("normalizeInventoryFolderState handles empty input, duplicate names and first valid IDs", () => {
  for (const rawState of [null, undefined, [], "broken", 42]) {
    assert.deepEqual(normalizeInventoryFolderState(rawState), createEmptyInventoryFolderState());
  }

  assert.deepEqual(normalizeInventoryFolderState({
    folders: [
      { id: " one ", name: " Same ", parentId: "" },
      { id: "two", name: "Same", parentId: null },
      { id: "one", name: "Ignored", parentId: "two" }
    ]
  }), makeState([
    { id: "one", name: "Same", parentId: null },
    { id: "two", name: "Same", parentId: null }
  ]));
});

test("normalizeInventoryFolderState promotes the first sixth-level node and keeps its subtree", () => {
  const folders = Array.from({ length: 7 }, (_, index) => ({
    id: `f${index + 1}`,
    name: `F${index + 1}`,
    parentId: index === 0 ? null : `f${index}`
  }));

  assert.deepEqual(normalizeInventoryFolderState({ folders }).folders, [
    ...folders.slice(0, 5),
    { ...folders[5], parentId: null },
    folders[6]
  ]);
});

test("normalizeExpandedFolderIds removes duplicates and missing IDs", () => {
  assert.deepEqual(
    normalizeExpandedFolderIds(["a", "missing", "a", " b ", null], { folderIds: ["a", "b"] }),
    ["a", "b"]
  );
  assert.deepEqual(normalizeExpandedFolderIds("a", { folderIds: ["a"] }), []);
});

test("createInventoryFolder trims names, permits duplicate names and is idempotent", () => {
  let state = createEmptyInventoryFolderState();
  state = createInventoryFolder(state, { folderId: "a", name: " Same " });
  state = createInventoryFolder(state, { folderId: "b", name: "Same" });
  const replay = createInventoryFolder(state, { folderId: "a", name: "Same", parentId: null });

  assert.deepEqual(state.folders, [
    { id: "a", name: "Same", parentId: null },
    { id: "b", name: "Same", parentId: null }
  ]);
  assert.deepEqual(replay, state);
  assert.notStrictEqual(replay, state);
  assertFolderError(
    () => createInventoryFolder(state, { folderId: "a", name: "Different" }),
    "folder-id-conflict"
  );
  assertFolderError(() => createInventoryFolder(state, { folderId: "", name: "A" }), "invalid-folder-id");
  assertFolderError(() => createInventoryFolder(state, { folderId: "c", name: "   " }), "invalid-folder-name");
  assertFolderError(
    () => createInventoryFolder(state, { folderId: "c", name: "x".repeat(81) }),
    "folder-name-too-long"
  );
});

test("create and move validate depth of the deepest descendant", () => {
  let state = createEmptyInventoryFolderState();
  for (let depth = 1; depth <= 5; depth += 1) {
    state = createInventoryFolder(state, {
      folderId: `a${depth}`,
      name: `A${depth}`,
      parentId: depth === 1 ? null : `a${depth - 1}`
    });
  }
  assertFolderError(
    () => createInventoryFolder(state, { folderId: "a6", name: "A6", parentId: "a5" }),
    "folder-depth-exceeded"
  );

  const movable = makeState([
    { id: "target", name: "Target", parentId: null },
    { id: "target-child", name: "Target child", parentId: "target" },
    { id: "target-deep", name: "Target deep", parentId: "target-child" },
    { id: "branch", name: "Branch", parentId: null },
    { id: "branch-child", name: "Branch child", parentId: "branch" },
    { id: "branch-leaf", name: "Branch leaf", parentId: "branch-child" }
  ]);
  assertFolderError(
    () => moveInventoryFolder(movable, { folderId: "branch", parentId: "target-deep" }),
    "folder-depth-exceeded"
  );
});

test("rename and move preserve identity, descendants and memberships", () => {
  const state = makeState([
    { id: "a", name: "A", parentId: null },
    { id: "b", name: "B", parentId: "a" },
    { id: "c", name: "C", parentId: null }
  ], { item: "b" });

  const renamed = renameInventoryFolder(state, { folderId: "a", name: " Renamed " });
  assert.deepEqual(renamed, makeState([
    { id: "a", name: "Renamed", parentId: null },
    { id: "b", name: "B", parentId: "a" },
    { id: "c", name: "C", parentId: null }
  ], { item: "b" }));

  const moved = moveInventoryFolder(renamed, { folderId: "b", parentId: "c" });
  assert.equal(moved.folders.find((folder) => folder.id === "b").parentId, "c");
  assert.deepEqual(moved.itemFolderIds, { item: "b" });
  assert.deepEqual(moveInventoryFolder(moved, { folderId: "b", parentId: "c" }), moved);
  assertFolderError(() => moveInventoryFolder(state, { folderId: "a", parentId: "a" }), "folder-cycle");
  assertFolderError(() => moveInventoryFolder(state, { folderId: "a", parentId: "b" }), "folder-cycle");
  assertFolderError(() => moveInventoryFolder(state, { folderId: "a", parentId: "missing" }), "parent-folder-not-found");
});

test("deleteInventoryFolder promotes direct contents without flattening deeper descendants", () => {
  const state = {
    version: 1,
    folders: [
      { id: "parent", name: "Parent", parentId: null },
      { id: "deleted", name: "Deleted", parentId: "parent" },
      { id: "child", name: "Child", parentId: "deleted" },
      { id: "grandchild", name: "Grandchild", parentId: "child" }
    ],
    itemFolderIds: { itemA: "deleted", itemB: "grandchild" }
  };

  assert.deepEqual(deleteInventoryFolder(state, { folderId: "deleted" }), {
    version: 1,
    folders: [
      { id: "parent", name: "Parent", parentId: null },
      { id: "child", name: "Child", parentId: "parent" },
      { id: "grandchild", name: "Grandchild", parentId: "child" }
    ],
    itemFolderIds: { itemA: "parent", itemB: "grandchild" }
  });

  const rootDeleted = deleteInventoryFolder(makeState([
    { id: "root", name: "Root", parentId: null },
    { id: "child", name: "Child", parentId: "root" }
  ], { item: "root" }), { folderId: "root" });
  assert.deepEqual(rootDeleted, makeState([{ id: "child", name: "Child", parentId: null }]));
  assert.deepEqual(deleteInventoryFolder(state, { folderId: "absent" }), state);
});

test("moveInventoryItemToFolder changes only membership and root removes the key", () => {
  const state = makeState([{ id: "folder", name: "Folder", parentId: null }], { other: "folder" });
  const assigned = moveInventoryItemToFolder(state, { itemId: "stack", folderId: "folder" });
  assert.deepEqual(assigned.itemFolderIds, { other: "folder", stack: "folder" });
  assert.deepEqual(moveInventoryItemToFolder(assigned, { itemId: "stack", folderId: null }).itemFolderIds, {
    other: "folder"
  });
  assertFolderError(
    () => moveInventoryItemToFolder(state, { itemId: "stack", folderId: "missing" }),
    "folder-not-found"
  );
});

function buildProjectionFixture() {
  const state = makeState([
    { id: "b", name: "Броня", parentId: null },
    { id: "a", name: "Арсенал", parentId: null },
    { id: "melee", name: "Ближний бой", parentId: "a" },
    { id: "empty", name: "Пустая", parentId: "a" },
    { id: "same-1", name: "Одинаково", parentId: null },
    { id: "same-2", name: "Одинаково", parentId: null }
  ], {
    sword: "melee",
    armor: "b"
  });
  const items = [
    { itemId: "torch", name: "Факел", type: "loot", quantity: 8 },
    { itemId: "sword", name: "Меч", type: "weapon", quantity: 20 },
    { itemId: "armor", name: "Доспех", type: "equipment", quantity: 1 }
  ];
  const tree = buildInventoryFolderTree({
    state,
    items,
    compareItems: (left, right) => right.name.localeCompare(left.name, "ru")
  });
  const searchIndex = buildInventoryFolderSearchIndex(tree, {
    itemText: (item) => `${item.name} ${item.type}`
  });
  return { tree, searchIndex };
}

test("buildInventoryFolderTree sorts folders before delegated Items and counts documents recursively", () => {
  const { tree } = buildProjectionFixture();
  assert.deepEqual(tree.root.folders.map((folder) => folder.name), ["Арсенал", "Броня", "Одинаково", "Одинаково"]);
  assert.deepEqual(tree.root.items.map((item) => item.name), ["Факел"]);
  assert.equal(tree.foldersById.get("a").recursiveItemCount, 1);
  assert.equal(tree.foldersById.get("melee").recursiveItemCount, 1);
  assert.equal(tree.foldersById.get("b").recursiveItemCount, 1);
});

test("projectInventoryFolderRows respects expansion and exposes folders before Items", () => {
  const { tree, searchIndex } = buildProjectionFixture();
  const projection = projectInventoryFolderRows({
    tree,
    searchIndex,
    expandedFolderIds: ["a", "melee"]
  });

  assert.deepEqual(projection.rows.map((row) => row.key), [
    "folder:a",
    "folder:melee",
    "item:sword",
    "folder:empty",
    "folder:b",
    "folder:same-1",
    "folder:same-2",
    "item:torch"
  ]);
  assert.equal(projection.rows.find((row) => row.key === "item:sword").depth, 2);
  assert.equal(projection.rows.find((row) => row.key === "folder:a").recursiveItemCount, 1);
  assert.equal(projection.visibleItemCount, 2);
  assert.equal(projection.rootFolder, null);
  assert.equal(projection.rootFolderMissing, false);
});

test("search reveals only matching paths and never mutates stored expansion", () => {
  const { tree, searchIndex } = buildProjectionFixture();
  const expandedFolderIds = [];
  const itemMatch = projectInventoryFolderRows({ tree, searchIndex, expandedFolderIds, search: "меч" });
  assert.deepEqual(itemMatch.rows.map((row) => row.key), ["folder:a", "folder:melee", "item:sword"]);
  assert.deepEqual(itemMatch.rows.find((row) => row.key === "item:sword").breadcrumb, ["Арсенал", "Ближний бой"]);
  assert.equal(itemMatch.rows.find((row) => row.key === "folder:a").searchExpanded, true);
  assert.deepEqual(expandedFolderIds, []);

  const folderMatch = projectInventoryFolderRows({ tree, searchIndex, search: "арсенал" });
  assert.deepEqual(folderMatch.rows.map((row) => row.key), ["folder:a"]);
  assert.deepEqual(folderMatch.rows[0].breadcrumb, []);
});

test("type filtering keeps only folders leading to visible Items", () => {
  const { tree, searchIndex } = buildProjectionFixture();
  const projection = projectInventoryFolderRows({ tree, searchIndex, typeFilter: "equipment" });
  assert.deepEqual(projection.rows.map((row) => row.key), ["folder:b", "item:armor"]);
  assert.equal(projection.visibleItemCount, 1);
});

test("popout projection stays inside its subtree and handles a missing root", () => {
  const { tree, searchIndex } = buildProjectionFixture();
  const projection = projectInventoryFolderRows({
    tree,
    searchIndex,
    rootFolderId: "a",
    expandedFolderIds: ["melee"],
    search: "меч"
  });
  assert.deepEqual(projection.rows.map((row) => row.key), ["folder:melee", "item:sword"]);
  assert.equal(projection.rows[0].depth, 1);
  assert.equal(projection.rows[1].depth, 2);
  assert.equal(projection.rootFolder.folderId, "a");

  assert.deepEqual(projectInventoryFolderRows({ tree, searchIndex, rootFolderId: "gone" }), {
    rows: [],
    visibleItemCount: 0,
    rootFolder: null,
    rootFolderMissing: true
  });
});

test("popout child creation uses absolute tree depth instead of relative row depth", () => {
  const folders = Array.from({ length: 5 }, (_, index) => ({
    id: `f${index + 1}`,
    name: `F${index + 1}`,
    parentId: index === 0 ? null : `f${index}`
  }));
  const tree = buildInventoryFolderTree({ state: makeState(folders), items: [] });
  const searchIndex = buildInventoryFolderSearchIndex(tree, {});
  const projection = projectInventoryFolderRows({
    tree,
    searchIndex,
    rootFolderId: "f4",
    expandedFolderIds: []
  });

  assert.equal(projection.rows[0].folderId, "f5");
  assert.equal(projection.rows[0].depth, 1);
  assert.equal(projection.rows[0].canCreateChild, false);
});
