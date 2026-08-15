import { MODULE_ID } from "../constants.js";

export const STORAGE_CONTAINER_FLAG = "storageContainer";
export const STORAGE_CONTAINER_SNAPSHOT_VERSION = 1;
export const MAX_STORAGE_CONTAINER_DEPTH = 8;

const STORAGE_KINDS = new Set(["chest", "bag", "pile"]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function positiveQuantity(value, fallback = 1) {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity >= 1 ? quantity : fallback;
}

function createStableId(prefix = "container") {
  const random = globalThis.foundry?.utils?.randomID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function stateRows(state) {
  return [
    ...(Array.isArray(state?.manualRows) ? state.manualRows : []),
    ...(Array.isArray(state?.generatedRows) ? state.generatedRows : [])
  ];
}

function visibleContainerRow(snapshot, rowId) {
  const id = clean(rowId);
  const claimed = new Set((Array.isArray(snapshot?.state?.claimedRowIds) ? snapshot.state.claimedRowIds : []).map(clean));
  return stateRows(snapshot?.state).find((row) => (
    clean(row?.rowId) === id
    && !claimed.has(id)
    && isStorageContainerRow(row)
  )) ?? null;
}

function normalizeItemRow(row, createId) {
  const normalized = clone(row) ?? {};
  const quantity = positiveQuantity(normalized.quantity ?? normalized.itemData?.system?.quantity, 1);
  normalized.rowKind = "item";
  normalized.rowId = clean(normalized.rowId) || createId("row");
  normalized.quantity = quantity;
  normalized.itemData ??= {};
  normalized.itemData.system ??= {};
  normalized.itemData.system.quantity = quantity;
  return normalized;
}

function normalizeJournalRow(row, createId) {
  const sourceId = clean(row?.sourceId);
  if (!sourceId) throw new TypeError("Journal reference row requires sourceId.");
  return {
    rowKind: "journal",
    rowId: clean(row?.rowId) || createId("journal"),
    stackKey: "",
    sourceId,
    sourceType: "journal",
    name: clean(row?.name) || "Журнал",
    img: clean(row?.img),
    quantity: 1
  };
}

function normalizeContainerRow(row, context) {
  const nested = normalizeSnapshot(row?.container, {
    ...context,
    depth: context.depth + 1
  });
  const rowId = clean(row?.rowId) || context.createId("row");
  return {
    rowKind: "container",
    rowId,
    stackKey: "",
    sourceId: clean(row?.sourceId) || `storage-container:${nested.containerId}`,
    sourceType: "container",
    name: nested.name,
    img: nested.img,
    quantity: 1,
    itemData: {
      ...(clone(row?.itemData) ?? {}),
      name: nested.name,
      type: "container",
      img: nested.img,
      system: {
        ...(clone(row?.itemData?.system) ?? {}),
        quantity: 1
      }
    },
    container: nested
  };
}

function normalizeRows(rows, context) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => {
      if (isStorageJournalRow(row)) return normalizeJournalRow(row, context.createId);
      return isStorageContainerRow(row)
        ? normalizeContainerRow(row, context)
        : normalizeItemRow(row, context.createId);
    });
}

function normalizeSnapshot(input, context) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Снимок контейнера должен быть объектом.");
  }
  if (context.depth > MAX_STORAGE_CONTAINER_DEPTH) {
    throw new Error(`Превышена максимальная глубина вложения контейнеров: ${MAX_STORAGE_CONTAINER_DEPTH}.`);
  }

  const containerId = clean(input.containerId) || context.createId("container");
  if (context.seenIds.has(containerId)) {
    throw new Error("Обнаружен цикл или повтор идентификатора вложенного контейнера.");
  }
  context.seenIds.add(containerId);

  const name = clean(input.name ?? input.state?.baseName) || "Хранилище";
  const storageKind = STORAGE_KINDS.has(clean(input.storageKind)) ? clean(input.storageKind) : "chest";
  const sourceState = input.state && typeof input.state === "object" && !Array.isArray(input.state)
    ? input.state
    : {};
  const state = {
    ...(clone(sourceState) ?? {}),
    baseName: clean(sourceState.baseName) || name,
    manualRows: normalizeRows(sourceState.manualRows, context),
    generatedRows: normalizeRows(sourceState.generatedRows, context),
    claimedRowIds: Array.from(new Set((Array.isArray(sourceState.claimedRowIds) ? sourceState.claimedRowIds : [])
      .map(clean)
      .filter(Boolean)))
  };

  return {
    version: STORAGE_CONTAINER_SNAPSHOT_VERSION,
    containerId,
    storageKind,
    name,
    img: clean(input.img),
    state,
    presentation: clone(input.presentation) ?? {}
  };
}

export function isStorageContainerRow(row) {
  return row?.rowKind === "container"
    || Boolean(row?.container && typeof row.container === "object" && !Array.isArray(row.container));
}

export function isStorageJournalRow(row) {
  return row?.rowKind === "journal" || clean(row?.sourceType) === "journal";
}

export function buildStorageContainerSnapshot(input = {}, { createId = createStableId } = {}) {
  if (typeof createId !== "function") throw new TypeError("createId должен быть функцией.");
  return normalizeSnapshot(input, {
    depth: 0,
    seenIds: new Set(),
    createId
  });
}

export function rekeyStorageContainerSnapshot(input = {}, { createId = createStableId } = {}) {
  if (typeof createId !== "function") throw new TypeError("createId должен быть функцией.");
  const snapshot = buildStorageContainerSnapshot(input);
  const visit = (current) => {
    const containerId = clean(createId("container")) || createStableId("container");
    current.containerId = containerId;
    current.state.containerId = containerId;
    for (const row of stateRows(current.state)) {
      if (!isStorageContainerRow(row)) continue;
      visit(row.container);
      row.sourceId = `storage-container:${row.container.containerId}`;
    }
  };
  visit(snapshot);
  return snapshot;
}

export function buildStorageContainerRow(snapshot, { rowId = "", createId = createStableId } = {}) {
  const normalized = buildStorageContainerSnapshot(snapshot, { createId });
  return {
    rowKind: "container",
    rowId: clean(rowId) || createId("row"),
    stackKey: "",
    sourceId: `storage-container:${normalized.containerId}`,
    sourceType: "container",
    name: normalized.name,
    img: normalized.img,
    quantity: 1,
    itemData: {
      name: normalized.name,
      type: "container",
      img: normalized.img,
      system: { quantity: 1 }
    },
    container: normalized
  };
}

export function collectStorageContainerIds(snapshot) {
  const normalized = buildStorageContainerSnapshot(snapshot);
  const ids = new Set();
  const visit = (current) => {
    ids.add(current.containerId);
    for (const row of stateRows(current.state)) {
      if (isStorageContainerRow(row)) visit(row.container);
    }
  };
  visit(normalized);
  return ids;
}

export function resolveStorageContainerPath(snapshot, path = []) {
  let current;
  try {
    current = buildStorageContainerSnapshot(snapshot);
  }
  catch (_error) {
    return null;
  }
  for (const rowId of Array.isArray(path) ? path : []) {
    const row = visibleContainerRow(current, rowId);
    if (!row) return null;
    current = row.container;
  }
  return clone(current);
}

export function updateStorageContainerPath(snapshot, path = [], updater) {
  if (typeof updater !== "function") throw new TypeError("updater должен быть функцией.");
  const normalized = buildStorageContainerSnapshot(snapshot);
  const rowPath = Array.isArray(path) ? path.map(clean).filter(Boolean) : [];

  const updateAt = (current, index) => {
    if (index >= rowPath.length) {
      return updater(clone(current));
    }
    const rowId = rowPath[index];
    let found = false;
    const updateRows = (rows) => rows.map((row) => {
      if (clean(row?.rowId) !== rowId || !isStorageContainerRow(row)) return row;
      found = true;
      return {
        ...row,
        container: updateAt(row.container, index + 1)
      };
    });
    if (!visibleContainerRow(current, rowId)) {
      throw new Error("Вложенный контейнер по указанному пути не найден.");
    }
    const updated = {
      ...current,
      state: {
        ...current.state,
        manualRows: updateRows(current.state.manualRows),
        generatedRows: found ? current.state.generatedRows : updateRows(current.state.generatedRows)
      }
    };
    if (!found) throw new Error("Вложенный контейнер по указанному пути не найден.");
    return updated;
  };

  return buildStorageContainerSnapshot(updateAt(normalized, 0));
}

function portableFlag(item) {
  if (typeof item?.getFlag === "function") return item.getFlag(MODULE_ID, STORAGE_CONTAINER_FLAG);
  return item?.flags?.[MODULE_ID]?.[STORAGE_CONTAINER_FLAG];
}

export function readPortableStorageContainerSnapshot(item) {
  const value = portableFlag(item);
  if (!value) return null;
  try {
    return buildStorageContainerSnapshot(value);
  }
  catch (_error) {
    return null;
  }
}

export function isPortableStorageContainerItem(item) {
  return clean(item?.type) === "container" && readPortableStorageContainerSnapshot(item) !== null;
}

export function createPortableStorageContainerItemData(snapshot, {
  parentContainerId = null,
  capacityCount = 0,
  capacityVolume = 0,
  capacityWeight = 0,
  weight = 0,
  weightlessContents = false
} = {}) {
  const normalized = buildStorageContainerSnapshot(snapshot);
  const containerType = normalized.storageKind === "bag"
    ? "backpack"
    : normalized.storageKind === "pile" ? "sack" : "chest";
  return {
    name: normalized.name,
    type: "container",
    img: normalized.img,
    system: {
      quantity: 1,
      container: clean(parentContainerId) || null,
      type: { value: containerType },
      weight: { value: Math.max(0, Number(weight) || 0), units: "lb" },
      capacity: {
        count: Math.max(0, Math.trunc(Number(capacityCount) || 0)),
        volume: { value: Math.max(0, Number(capacityVolume) || 0), units: "ft3" },
        weight: { value: Math.max(0, Number(capacityWeight) || 0), units: "lb" }
      },
      properties: weightlessContents === true ? ["weightlessContents"] : []
    },
    flags: {
      [MODULE_ID]: {
        [STORAGE_CONTAINER_FLAG]: normalized
      }
    }
  };
}
