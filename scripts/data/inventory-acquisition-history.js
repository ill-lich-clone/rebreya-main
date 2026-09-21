const MODULE_ID = "rebreya-main";
const ENTRY_METHODS = new Set(["lootgen", "storage", "transfer", "manual", "dismantle", "other"]);

export const INVENTORY_ACQUISITION_HISTORY_FLAG = "inventoryAcquisitionHistory";
export const INVENTORY_ACQUISITION_HISTORY_VERSION = 1;
export const MAX_INVENTORY_ACQUISITION_ENTRIES = 10;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeInventoryAcquisitionEntry(raw) {
  if (!isObject(raw)) return null;
  const recordedAt = Number(raw.recordedAt);
  const worldTime = raw.worldTime === null ? null : Number(raw.worldTime);
  const quantity = Number(raw.quantity);
  if (!Number.isFinite(recordedAt) || recordedAt < 0) return null;
  if (worldTime !== null && !Number.isFinite(worldTime)) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const method = ENTRY_METHODS.has(raw.method) ? raw.method : "other";
  return {
    recordedAt,
    worldTime,
    quantity,
    method,
    sceneId: boundedText(raw.sceneId, 160),
    sceneName: boundedText(raw.sceneName, 160),
    sourceType: boundedText(raw.sourceType, 160),
    sourceId: boundedText(raw.sourceId, 160),
    sourceName: boundedText(raw.sourceName, 160),
    detail: boundedText(raw.detail, 500)
  };
}

export function normalizeInventoryAcquisitionHistory(raw) {
  if (!isObject(raw) || raw.version !== INVENTORY_ACQUISITION_HISTORY_VERSION) {
    return { version: INVENTORY_ACQUISITION_HISTORY_VERSION, entries: [] };
  }
  const entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((value, index) => ({ value: normalizeInventoryAcquisitionEntry(value), index }))
    .filter(({ value }) => value !== null)
    .sort((left, right) => right.value.recordedAt - left.value.recordedAt || left.index - right.index)
    .slice(0, MAX_INVENTORY_ACQUISITION_ENTRIES)
    .map(({ value }) => value);
  return { version: INVENTORY_ACQUISITION_HISTORY_VERSION, entries };
}

export function readInventoryAcquisitionHistory(itemData) {
  return normalizeInventoryAcquisitionHistory(
    itemData?.flags?.[MODULE_ID]?.[INVENTORY_ACQUISITION_HISTORY_FLAG]
  );
}

export function appendInventoryAcquisitionEntry(rawHistory, entry) {
  const history = normalizeInventoryAcquisitionHistory(rawHistory);
  const normalizedEntry = normalizeInventoryAcquisitionEntry(entry);
  return normalizeInventoryAcquisitionHistory({
    version: INVENTORY_ACQUISITION_HISTORY_VERSION,
    entries: normalizedEntry ? [...history.entries, normalizedEntry] : history.entries
  });
}

export function writeInventoryAcquisitionHistory(itemData, history) {
  const cloned = structuredClone(isObject(itemData) ? itemData : {});
  const flags = isObject(cloned.flags) ? cloned.flags : {};
  const moduleFlags = isObject(flags[MODULE_ID]) ? flags[MODULE_ID] : {};
  cloned.flags = {
    ...flags,
    [MODULE_ID]: {
      ...moduleFlags,
      [INVENTORY_ACQUISITION_HISTORY_FLAG]: normalizeInventoryAcquisitionHistory(history)
    }
  };
  return cloned;
}
