import { MODULE_ID } from "../constants.js";
import { isStorageContainerRow, isStorageJournalRow } from "./storage-container-snapshot.js?v=1.4.317";

function stackState(row) {
  if (!row || isStorageContainerRow(row) || isStorageJournalRow(row) || row.stackable === false) return null;
  const flags = row.itemData?.flags?.[MODULE_ID];
  if (row.composition?.upgrades?.length || row.descriptor?.upgrades?.length
    || flags?.runtimeItemGraph?.nodes?.length > 1) return null;
  const state = JSON.parse(JSON.stringify(row));
  for (const key of ["rowId", "rowIndex", "itemId", "itemUuid", "quantity", "totalValue", "stackKey", "sourceId", "sourceType", "sourceDocumentId"]) delete state[key];
  for (const metadata of [state.descriptor, state.composition]) {
    if (!metadata) continue;
    delete metadata.instanceKey;
    delete metadata.quantity;
  }
  if (state.itemData) {
    for (const key of ["_id", "id", "uuid", "_stats", "folder", "sort", "ownership", "pack"]) delete state.itemData[key];
    state.itemData.system ??= {};
    delete state.itemData.system.quantity;
    delete state.itemData.system.container;
    if (state.itemData.flags?.[MODULE_ID]) delete state.itemData.flags[MODULE_ID].lootgenChat;
  }
  return state;
}

function equalState(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && equalState(left[key], right[key]));
}

/** Source identity is checked by the owner; only equivalent physical rows may share a stack. */
export function storageRowsCanStack(left, right) {
  const leftState = stackState(left);
  const rightState = stackState(right);
  return leftState !== null && rightState !== null && equalState(leftState, rightState);
}
