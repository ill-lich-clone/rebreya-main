export const INVENTORY_FOLDER_STATE_VERSION = 1;
export const MAX_INVENTORY_FOLDER_DEPTH = 5;
export const MAX_INVENTORY_FOLDER_NAME_LENGTH = 80;

export class InventoryFolderStateError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "InventoryFolderStateError";
    this.code = code;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNullableId(value) {
  if (value == null || value === "") return null;
  const id = cleanId(value);
  return id || null;
}

function cleanName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cloneNormalizedState(state) {
  return {
    version: INVENTORY_FOLDER_STATE_VERSION,
    folders: state.folders.map((folder) => ({ ...folder })),
    itemFolderIds: { ...state.itemFolderIds }
  };
}

function normalizeReducerState(rawState) {
  const itemIds = isObject(rawState?.itemFolderIds)
    ? Object.keys(rawState.itemFolderIds)
    : [];
  return normalizeInventoryFolderState(rawState, { itemIds });
}

function folderMapFor(state) {
  return new Map(state.folders.map((folder) => [folder.id, folder]));
}

function requireFolderId(value) {
  const folderId = cleanId(value);
  if (!folderId) {
    throw new InventoryFolderStateError("invalid-folder-id", "Folder ID must be a non-empty string.");
  }
  return folderId;
}

function requireFolderName(value) {
  const name = cleanName(value);
  if (!name) {
    throw new InventoryFolderStateError("invalid-folder-name", "Folder name must not be empty.");
  }
  if (name.length > MAX_INVENTORY_FOLDER_NAME_LENGTH) {
    throw new InventoryFolderStateError(
      "folder-name-too-long",
      `Folder name must not exceed ${MAX_INVENTORY_FOLDER_NAME_LENGTH} characters.`
    );
  }
  return name;
}

function requireParentId(value, foldersById) {
  const parentId = cleanNullableId(value);
  if (parentId !== null && !foldersById.has(parentId)) {
    throw new InventoryFolderStateError("parent-folder-not-found", "Parent folder was not found.");
  }
  return parentId;
}

function getFolderDepth(folderId, foldersById) {
  let depth = 0;
  let currentId = folderId;
  const visited = new Set();
  while (currentId !== null) {
    if (visited.has(currentId)) {
      throw new InventoryFolderStateError("folder-cycle", "Folder hierarchy contains a cycle.");
    }
    visited.add(currentId);
    const folder = foldersById.get(currentId);
    if (!folder) break;
    depth += 1;
    currentId = folder.parentId;
  }
  return depth;
}

function getSubtreeHeight(folderId, folders) {
  const childIdsByParent = new Map();
  for (const folder of folders) {
    const children = childIdsByParent.get(folder.parentId) ?? [];
    children.push(folder.id);
    childIdsByParent.set(folder.parentId, children);
  }

  const heightFrom = (id) => {
    const children = childIdsByParent.get(id) ?? [];
    let childHeight = 0;
    for (const childId of children) {
      childHeight = Math.max(childHeight, heightFrom(childId));
    }
    return 1 + childHeight;
  };

  return heightFrom(folderId);
}

function cloneItemRow(item, itemId, folderId) {
  return {
    ...item,
    kind: "item",
    itemId,
    folderId
  };
}

function itemIdOf(item) {
  return cleanId(item?.itemId ?? item?.id);
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/\s+/gu, " ");
}

function itemMatchesType(item, typeFilter) {
  if (!typeFilter || typeFilter === "all") return true;
  return [item?.type, item?.itemType, item?.inventoryType, item?.category]
    .some((value) => String(value ?? "") === typeFilter);
}

export function createEmptyInventoryFolderState() {
  return {
    version: INVENTORY_FOLDER_STATE_VERSION,
    folders: [],
    itemFolderIds: {}
  };
}

export function normalizeInventoryFolderState(rawState, { itemIds = [] } = {}) {
  if (!isObject(rawState)) return createEmptyInventoryFolderState();

  const folders = [];
  const foldersById = new Map();
  const rawFolders = Array.isArray(rawState.folders) ? rawState.folders : [];

  for (const rawFolder of rawFolders) {
    if (!isObject(rawFolder)) continue;
    const id = cleanId(rawFolder.id);
    const name = cleanName(rawFolder.name);
    if (!id || !name || foldersById.has(id)) continue;
    const folder = {
      id,
      name,
      parentId: cleanNullableId(rawFolder.parentId)
    };
    folders.push(folder);
    foldersById.set(id, folder);
  }

  for (const folder of folders) {
    if (folder.parentId === folder.id || (folder.parentId !== null && !foldersById.has(folder.parentId))) {
      folder.parentId = null;
    }
  }

  for (const start of folders) {
    const path = [];
    const positions = new Map();
    let currentId = start.id;
    while (currentId !== null) {
      if (positions.has(currentId)) {
        for (const cycleId of path.slice(positions.get(currentId))) {
          foldersById.get(cycleId).parentId = null;
        }
        break;
      }
      positions.set(currentId, path.length);
      path.push(currentId);
      currentId = foldersById.get(currentId)?.parentId ?? null;
    }
  }

  let repairedDepth = true;
  while (repairedDepth) {
    repairedDepth = false;
    for (const folder of folders) {
      const leafToRoot = [];
      let current = folder;
      while (current) {
        leafToRoot.push(current);
        current = current.parentId === null ? null : foldersById.get(current.parentId);
      }
      const rootToLeaf = leafToRoot.reverse();
      if (rootToLeaf.length > MAX_INVENTORY_FOLDER_DEPTH) {
        rootToLeaf[MAX_INVENTORY_FOLDER_DEPTH].parentId = null;
        repairedDepth = true;
        break;
      }
    }
  }

  const validItemIds = new Set(
    Array.isArray(itemIds)
      ? itemIds.map(cleanId).filter(Boolean)
      : []
  );
  const itemFolderIds = {};
  const rawMembership = isObject(rawState.itemFolderIds) ? rawState.itemFolderIds : {};
  for (const [rawItemId, rawFolderId] of Object.entries(rawMembership)) {
    const itemId = cleanId(rawItemId);
    const folderId = cleanId(rawFolderId);
    if (validItemIds.has(itemId) && foldersById.has(folderId)) {
      itemFolderIds[itemId] = folderId;
    }
  }

  return {
    version: INVENTORY_FOLDER_STATE_VERSION,
    folders: folders.map((folder) => ({ ...folder })),
    itemFolderIds
  };
}

export function normalizeExpandedFolderIds(rawIds, { folderIds = [] } = {}) {
  if (!Array.isArray(rawIds)) return [];
  const validFolderIds = new Set(
    Array.isArray(folderIds)
      ? folderIds.map(cleanId).filter(Boolean)
      : []
  );
  const seen = new Set();
  const normalized = [];
  for (const rawId of rawIds) {
    const folderId = cleanId(rawId);
    if (!folderId || !validFolderIds.has(folderId) || seen.has(folderId)) continue;
    seen.add(folderId);
    normalized.push(folderId);
  }
  return normalized;
}

export function createInventoryFolder(rawState, { folderId, name, parentId = null }) {
  const state = normalizeReducerState(rawState);
  const id = requireFolderId(folderId);
  const normalizedName = requireFolderName(name);
  const foldersById = folderMapFor(state);
  const normalizedParentId = requireParentId(parentId, foldersById);
  const existing = foldersById.get(id);

  if (existing) {
    if (existing.name === normalizedName && existing.parentId === normalizedParentId) {
      return cloneNormalizedState(state);
    }
    throw new InventoryFolderStateError("folder-id-conflict", "Folder ID is already used by different data.");
  }

  const depth = normalizedParentId === null
    ? 1
    : getFolderDepth(normalizedParentId, foldersById) + 1;
  if (depth > MAX_INVENTORY_FOLDER_DEPTH) {
    throw new InventoryFolderStateError("folder-depth-exceeded", "Folder depth exceeds the supported maximum.");
  }

  return {
    version: INVENTORY_FOLDER_STATE_VERSION,
    folders: [...state.folders.map((folder) => ({ ...folder })), {
      id,
      name: normalizedName,
      parentId: normalizedParentId
    }],
    itemFolderIds: { ...state.itemFolderIds }
  };
}

export function renameInventoryFolder(rawState, { folderId, name }) {
  const state = normalizeReducerState(rawState);
  const id = requireFolderId(folderId);
  const normalizedName = requireFolderName(name);
  if (!state.folders.some((folder) => folder.id === id)) {
    throw new InventoryFolderStateError("folder-not-found", "Folder was not found.");
  }
  return {
    version: INVENTORY_FOLDER_STATE_VERSION,
    folders: state.folders.map((folder) => folder.id === id
      ? { ...folder, name: normalizedName }
      : { ...folder }),
    itemFolderIds: { ...state.itemFolderIds }
  };
}

export function moveInventoryFolder(rawState, { folderId, parentId = null }) {
  const state = normalizeReducerState(rawState);
  const id = requireFolderId(folderId);
  const foldersById = folderMapFor(state);
  const folder = foldersById.get(id);
  if (!folder) {
    throw new InventoryFolderStateError("folder-not-found", "Folder was not found.");
  }
  const normalizedParentId = requireParentId(parentId, foldersById);
  if (normalizedParentId === id) {
    throw new InventoryFolderStateError("folder-cycle", "A folder cannot contain itself.");
  }

  let ancestorId = normalizedParentId;
  while (ancestorId !== null) {
    if (ancestorId === id) {
      throw new InventoryFolderStateError("folder-cycle", "A folder cannot move inside its descendant.");
    }
    ancestorId = foldersById.get(ancestorId)?.parentId ?? null;
  }

  if (folder.parentId === normalizedParentId) return cloneNormalizedState(state);

  const parentDepth = normalizedParentId === null ? 0 : getFolderDepth(normalizedParentId, foldersById);
  const resultingDeepestDepth = parentDepth + getSubtreeHeight(id, state.folders);
  if (resultingDeepestDepth > MAX_INVENTORY_FOLDER_DEPTH) {
    throw new InventoryFolderStateError("folder-depth-exceeded", "Moved subtree would exceed the supported depth.");
  }

  return {
    version: INVENTORY_FOLDER_STATE_VERSION,
    folders: state.folders.map((entry) => entry.id === id
      ? { ...entry, parentId: normalizedParentId }
      : { ...entry }),
    itemFolderIds: { ...state.itemFolderIds }
  };
}

export function deleteInventoryFolder(rawState, { folderId }) {
  const state = normalizeReducerState(rawState);
  const id = requireFolderId(folderId);
  const deleted = state.folders.find((folder) => folder.id === id);
  if (!deleted) return cloneNormalizedState(state);

  const folders = state.folders
    .filter((folder) => folder.id !== id)
    .map((folder) => folder.parentId === id
      ? { ...folder, parentId: deleted.parentId }
      : { ...folder });
  const itemFolderIds = {};
  for (const [itemId, assignedFolderId] of Object.entries(state.itemFolderIds)) {
    if (assignedFolderId !== id) {
      itemFolderIds[itemId] = assignedFolderId;
    } else if (deleted.parentId !== null) {
      itemFolderIds[itemId] = deleted.parentId;
    }
  }

  return {
    version: INVENTORY_FOLDER_STATE_VERSION,
    folders,
    itemFolderIds
  };
}

export function moveInventoryItemToFolder(rawState, { itemId, folderId = null }) {
  const state = normalizeReducerState(rawState);
  const id = cleanId(itemId);
  if (!id) {
    throw new InventoryFolderStateError("item-not-found", "Item was not found.");
  }
  const normalizedFolderId = cleanNullableId(folderId);
  if (normalizedFolderId !== null && !state.folders.some((folder) => folder.id === normalizedFolderId)) {
    throw new InventoryFolderStateError("folder-not-found", "Folder was not found.");
  }

  const itemFolderIds = { ...state.itemFolderIds };
  if (normalizedFolderId === null) delete itemFolderIds[id];
  else itemFolderIds[id] = normalizedFolderId;
  return {
    version: INVENTORY_FOLDER_STATE_VERSION,
    folders: state.folders.map((folder) => ({ ...folder })),
    itemFolderIds
  };
}

export function buildInventoryFolderTree({ state, items = [], compareItems } = {}) {
  const itemRows = Array.isArray(items) ? items.filter((item) => itemIdOf(item)) : [];
  const normalizedState = normalizeInventoryFolderState(state, {
    itemIds: itemRows.map(itemIdOf)
  });
  const root = {
    kind: "root",
    folderId: null,
    folders: [],
    items: [],
    recursiveItemCount: 0
  };
  const foldersById = new Map();
  const itemsById = new Map();

  for (const folder of normalizedState.folders) {
    foldersById.set(folder.id, {
      kind: "folder",
      id: folder.id,
      folderId: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      folders: [],
      items: [],
      recursiveItemCount: 0
    });
  }
  for (const folder of normalizedState.folders) {
    const node = foldersById.get(folder.id);
    const parent = folder.parentId === null ? root : foldersById.get(folder.parentId);
    parent.folders.push(node);
  }
  for (const item of itemRows) {
    const itemId = itemIdOf(item);
    const folderId = normalizedState.itemFolderIds[itemId] ?? null;
    const node = cloneItemRow(item, itemId, folderId);
    itemsById.set(itemId, node);
    const parent = folderId === null ? root : foldersById.get(folderId);
    parent.items.push(node);
  }

  const compareFolders = (left, right) => left.name.localeCompare(right.name, "ru");
  const compareItemRows = typeof compareItems === "function"
    ? compareItems
    : (left, right) => String(left.name ?? "").localeCompare(String(right.name ?? ""), "ru");
  const sortAndCount = (node, depth = 0) => {
    node.treeDepth = depth;
    node.folders.sort(compareFolders);
    node.items.sort(compareItemRows);
    let count = node.items.length;
    for (const child of node.folders) count += sortAndCount(child, depth + 1);
    node.recursiveItemCount = count;
    return count;
  };
  sortAndCount(root);

  return { root, foldersById, itemsById, state: normalizedState };
}

export function buildInventoryFolderSearchIndex(tree, { itemText } = {}) {
  const folderEntries = new Map();
  const itemEntries = new Map();
  const getItemText = typeof itemText === "function"
    ? itemText
    : (item) => item?.name ?? "";

  const visit = (node, ancestorIds, breadcrumb) => {
    for (const folder of node.folders) {
      folderEntries.set(folder.folderId, {
        text: normalizeSearchText(folder.name),
        ancestorIds: [...ancestorIds],
        breadcrumb: [...breadcrumb]
      });
      visit(folder, [...ancestorIds, folder.folderId], [...breadcrumb, folder.name]);
    }
    for (const item of node.items) {
      itemEntries.set(item.itemId, {
        text: normalizeSearchText(getItemText(item)),
        ancestorIds: [...ancestorIds],
        breadcrumb: [...breadcrumb]
      });
    }
  };
  visit(tree.root, [], []);
  return { folderEntries, itemEntries };
}

export function projectInventoryFolderRows({
  tree,
  searchIndex,
  rootFolderId = null,
  expandedFolderIds = [],
  search = "",
  typeFilter = "all"
} = {}) {
  const normalizedRootFolderId = cleanNullableId(rootFolderId);
  const rootFolder = normalizedRootFolderId === null
    ? null
    : tree?.foldersById?.get(normalizedRootFolderId) ?? null;
  if (normalizedRootFolderId !== null && !rootFolder) {
    return {
      rows: [],
      visibleItemCount: 0,
      rootFolder: null,
      rootFolderMissing: true
    };
  }

  const scope = rootFolder ?? tree?.root;
  if (!scope) {
    return {
      rows: [],
      visibleItemCount: 0,
      rootFolder,
      rootFolderMissing: false
    };
  }

  const expanded = new Set(normalizeExpandedFolderIds(expandedFolderIds, {
    folderIds: [...tree.foldersById.keys()]
  }));
  const query = normalizeSearchText(search);
  const criteriaActive = Boolean(query) || (typeFilter && typeFilter !== "all");
  const folderEntries = searchIndex?.folderEntries ?? new Map();
  const itemEntries = searchIndex?.itemEntries ?? new Map();
  const includedFolderIds = new Set();
  const includedItemIds = new Set();

  const isFolderInScope = (folderId) => {
    if (normalizedRootFolderId === null) return true;
    let currentId = folderId;
    while (currentId !== null) {
      if (currentId === normalizedRootFolderId) return true;
      currentId = tree.foldersById.get(currentId)?.parentId ?? null;
    }
    return false;
  };
  const addFolderPath = (folderId) => {
    let currentId = folderId;
    while (currentId !== null && currentId !== normalizedRootFolderId) {
      if (!isFolderInScope(currentId)) break;
      includedFolderIds.add(currentId);
      currentId = tree.foldersById.get(currentId)?.parentId ?? null;
    }
  };

  if (criteriaActive) {
    for (const [folderId, entry] of folderEntries) {
      if (query && isFolderInScope(folderId) && entry.text.includes(query)) addFolderPath(folderId);
    }
    for (const [itemId, item] of tree.itemsById) {
      const folderId = item.folderId;
      const insideScope = normalizedRootFolderId === null
        || folderId === normalizedRootFolderId
        || (folderId !== null && isFolderInScope(folderId));
      if (!insideScope || !itemMatchesType(item, typeFilter)) continue;
      const entry = itemEntries.get(itemId);
      if (query && !entry?.text.includes(query)) continue;
      includedItemIds.add(itemId);
      if (folderId !== null) addFolderPath(folderId);
    }
  }

  const rows = [];
  let visibleItemCount = 0;
  const popoutItemDepthOffset = rootFolder ? 1 : 0;

  const visit = (node, folderDepth) => {
    for (const folder of node.folders) {
      if (criteriaActive && !includedFolderIds.has(folder.folderId)) continue;
      const hasIncludedChildren = criteriaActive && (
        folder.folders.some((child) => includedFolderIds.has(child.folderId))
        || folder.items.some((item) => includedItemIds.has(item.itemId))
      );
      const persistedExpanded = expanded.has(folder.folderId);
      const searchExpanded = hasIncludedChildren && !persistedExpanded;
      const isExpanded = criteriaActive ? hasIncludedChildren || persistedExpanded : persistedExpanded;
      const entry = folderEntries.get(folder.folderId);
      rows.push({
        key: `folder:${folder.folderId}`,
        kind: "folder",
        folderId: folder.folderId,
        name: folder.name,
        parentId: folder.parentId,
        depth: folderDepth,
        recursiveItemCount: folder.recursiveItemCount,
        expanded: isExpanded,
        searchExpanded,
        breadcrumb: [...(entry?.breadcrumb ?? [])],
        canCreateChild: folder.treeDepth < MAX_INVENTORY_FOLDER_DEPTH
      });
      if (isExpanded) visit(folder, folderDepth + 1);
    }
    for (const item of node.items) {
      if (criteriaActive && !includedItemIds.has(item.itemId)) continue;
      const entry = itemEntries.get(item.itemId);
      rows.push({
        ...item,
        key: `item:${item.itemId}`,
        kind: "item",
        itemId: item.itemId,
        folderId: item.folderId,
        depth: node.kind === "root" ? popoutItemDepthOffset : folderDepth - 1 + popoutItemDepthOffset,
        breadcrumb: [...(entry?.breadcrumb ?? [])]
      });
      visibleItemCount += 1;
    }
  };
  visit(scope, 1);

  return {
    rows,
    visibleItemCount,
    rootFolder,
    rootFolderMissing: false
  };
}
