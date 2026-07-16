import { MODULE_ID } from "../constants.js";
import {
  captureInventoryTransferIdentity,
  inventoryTransferIdentityMatches,
  SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT
} from "../data/inventory-service.js";

const PARTY_INVENTORY_TRANSFER_FLAG = "partyInventoryTransfer";
const DEFAULT_REFRESH_DEBOUNCE_MS = 0;
const TRANSFER_TTL_MS = 30_000;
const SOCKET_CHANNEL = `module.${MODULE_ID}`;

let hookRegistered = false;
let pendingTransfer = null;
let pendingTransferTimeout = null;
let refreshTimeout = null;
const pendingAcceptedTransfers = new Map();
const registeredSockets = new WeakSet();
let transferSequence = 0;

function cleanId(value) {
  return String(value ?? "").trim();
}

function isCurrentUserHook(userId) {
  const currentUserId = cleanId(globalThis.game?.user?.id);
  const hookUserId = cleanId(userId);
  return !hookUserId || !currentUserId || hookUserId === currentUserId;
}

function isCharacterItem(item) {
  const actor = item?.parent ?? item?.actor ?? null;
  return actor?.type === "character";
}

function itemUuidOf(item) {
  return cleanId(item?.uuid ?? item?.document?.uuid);
}

function itemQuantityOf(item) {
  const value = Number(item?.system?.quantity ?? item?.toObject?.()?.system?.quantity);
  return Number.isFinite(value) ? Math.max(0, Math.round((value + Number.EPSILON) * 100) / 100) : 0;
}

function quantitiesMatch(left, right) {
  return Math.abs(Number(left) - Number(right)) <= 1e-9;
}

function transferFlagOf(item) {
  return item?.flags?.[MODULE_ID]?.[PARTY_INVENTORY_TRANSFER_FLAG]
    ?? item?.getFlag?.(MODULE_ID, PARTY_INVENTORY_TRANSFER_FLAG)
    ?? null;
}

function hasActiveGm() {
  const activeGm = globalThis.game?.users?.activeGM ?? null;
  return Boolean(activeGm?.id) && activeGm.active !== false;
}

function createTransferId() {
  const randomId = cleanId(globalThis.crypto?.randomUUID?.());
  if (randomId) {
    return `party-transfer:${randomId}`;
  }
  transferSequence += 1;
  return `party-transfer:${Date.now().toString(36)}:${transferSequence.toString(36)}`;
}

async function initializeDurabilityItem(item, moduleApi) {
  if (typeof moduleApi?.initializeItem === "function") {
    await moduleApi.initializeItem(item);
    return true;
  }
  if (typeof moduleApi?.durabilityService?.initializeItem === "function") {
    await moduleApi.durabilityService.initializeItem(item);
    return true;
  }
  return false;
}

async function resolveUuid(uuid) {
  if (typeof globalThis.fromUuid !== "function") {
    return undefined;
  }
  return globalThis.fromUuid(uuid);
}

function rememberAcceptedTransfer(item, result, moduleApi, transfer) {
  const transferId = cleanId(result?.transferId);
  const targetItemUuid = cleanId(result?.targetItemUuid) || itemUuidOf(item);
  const sourceItemUuid = cleanId(result?.sourceItemUuid);
  const targetReceipt = transfer?.targetReceipt ?? null;
  if (transferId !== cleanId(transfer?.transferId)
    || sourceItemUuid !== cleanId(transfer?.sourceItemUuid)
    || !targetItemUuid
    || cleanId(targetReceipt?.targetItemUuid) !== targetItemUuid
    || typeof targetReceipt?.created !== "boolean"
    || (result?.targetReceipt
      && JSON.stringify(result.targetReceipt) !== JSON.stringify(targetReceipt))) {
    return null;
  }
  const pending = {
    item,
    moduleApi,
    transferId,
    sourceItemUuid,
    targetItemUuid,
    targetReceipt: structuredClone(targetReceipt),
    userId: cleanId(globalThis.game?.user?.id),
    approved: false
  };
  pendingAcceptedTransfers.set(transferId, pending);
  return pending;
}

async function completeAcceptedTransfer(pending) {
  if (!pending || pendingAcceptedTransfers.get(pending.transferId) !== pending) {
    return false;
  }
  pendingAcceptedTransfers.delete(pending.transferId);
  try {
    await initializeDurabilityItem(pending.item, pending.moduleApi);
    return true;
  }
  catch (error) {
    pendingAcceptedTransfers.set(pending.transferId, pending);
    throw error;
  }
}

async function settleAcceptedTransfer(pending, { sourceDeleted = false } = {}) {
  if (!pending || pendingAcceptedTransfers.get(pending.transferId) !== pending) {
    return false;
  }
  if (sourceDeleted) {
    return completeAcceptedTransfer(pending);
  }
  const sourceItem = await resolveUuid(pending.sourceItemUuid);
  if (sourceItem === null) {
    return completeAcceptedTransfer(pending);
  }
  return false;
}

async function rollbackAcceptedTransfer(pending) {
  if (!pending || pendingAcceptedTransfers.get(pending.transferId) !== pending) {
    return false;
  }
  const sourceItem = await resolveUuid(pending.sourceItemUuid);
  if (sourceItem === null) {
    return completeAcceptedTransfer(pending);
  }
  if (sourceItem === undefined) {
    return false;
  }
  const receipt = pending.targetReceipt;
  const currentQuantity = itemQuantityOf(pending.item);
  pendingAcceptedTransfers.delete(pending.transferId);
  try {
    if (receipt.created === true) {
      if (!quantitiesMatch(currentQuantity, receipt.afterQuantity) || typeof pending.item?.delete !== "function") {
        pendingAcceptedTransfers.set(pending.transferId, pending);
        return false;
      }
      await pending.item.delete();
    }
    else {
      if (quantitiesMatch(currentQuantity, receipt.beforeQuantity)) {
        return true;
      }
      if (!quantitiesMatch(currentQuantity, receipt.afterQuantity) || typeof pending.item?.update !== "function") {
        pendingAcceptedTransfers.set(pending.transferId, pending);
        return false;
      }
      await pending.item.update({ "system.quantity": receipt.beforeQuantity });
    }
    return true;
  }
  catch (error) {
    if ((receipt.created === true && await resolveUuid(pending.targetItemUuid) === null)
      || (receipt.created === false && quantitiesMatch(itemQuantityOf(pending.item), receipt.beforeQuantity))) {
      return true;
    }
    pendingAcceptedTransfers.set(pending.transferId, pending);
    throw error;
  }
}

function pendingForSocketResult(message) {
  const transferId = cleanId(message?.transferId);
  const sourceItemUuid = cleanId(message?.sourceItemUuid);
  const targetItemUuid = cleanId(message?.targetItemUuid);
  if (!transferId || !sourceItemUuid || !targetItemUuid) {
    return null;
  }
  const pending = pendingAcceptedTransfers.get(transferId) ?? null;
  const currentUserId = cleanId(globalThis.game?.user?.id);
  if (!pending
    || pending.sourceItemUuid !== sourceItemUuid
    || pending.targetItemUuid !== targetItemUuid
    || (currentUserId && pending.userId !== currentUserId)) {
    return null;
  }
  return pending;
}

async function handleSourceDepletionResult(message) {
  if (message?.type !== SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT) {
    return false;
  }
  const currentUserId = cleanId(globalThis.game?.user?.id);
  if (cleanId(message?.forUserId) !== currentUserId) {
    return false;
  }
  const pending = pendingForSocketResult(message);
  if (!pending) {
    return false;
  }
  if (message.ok === true) {
    pending.approved = true;
    return settleAcceptedTransfer(pending);
  }
  return rollbackAcceptedTransfer(pending);
}

function registerSourceDepletionSocket() {
  const socket = globalThis.game?.socket;
  if (!socket || typeof socket.on !== "function" || registeredSockets.has(socket)) {
    return false;
  }
  registeredSockets.add(socket);
  socket.on(SOCKET_CHANNEL, (message) => {
    handleSourceDepletionResult(message).catch((error) => {
      console.error(`${MODULE_ID} | Failed to settle party inventory transfer.`, error);
    });
  });
  return true;
}

function clearPendingTransfer() {
  pendingTransfer = null;
  if (pendingTransferTimeout) {
    globalThis.clearTimeout?.(pendingTransferTimeout);
    pendingTransferTimeout = null;
  }
}

export function buildPartyInventoryItemDragData(sourceItemUuid, sourceItem = globalThis.fromUuidSync?.(sourceItemUuid)) {
  const safeSourceItemUuid = cleanId(sourceItemUuid);
  const expectedIdentity = captureInventoryTransferIdentity(sourceItem);
  const expectedQuantity = itemQuantityOf(sourceItem);
  if (!hasActiveGm()) {
    throw new Error("Party inventory transfer requires an active GM.");
  }
  if (!safeSourceItemUuid || !expectedIdentity || expectedQuantity <= 0) {
    throw new Error("Party inventory drag requires a captured source identity and quantity.");
  }
  const transferId = createTransferId();
  pendingTransfer = {
    transferId,
    sourceItemUuid: safeSourceItemUuid,
    expectedIdentity,
    expectedQuantity,
    userId: cleanId(globalThis.game?.user?.id),
    expiresAt: Date.now() + TRANSFER_TTL_MS
  };
  if (pendingTransferTimeout) {
    globalThis.clearTimeout?.(pendingTransferTimeout);
  }
  pendingTransferTimeout = globalThis.setTimeout?.(clearPendingTransfer, TRANSFER_TTL_MS) ?? null;

  return {
    type: "Item",
    uuid: safeSourceItemUuid,
    flags: {
      [MODULE_ID]: {
        [PARTY_INVENTORY_TRANSFER_FLAG]: {
          sourceItemUuid: safeSourceItemUuid,
          transferId,
          expectedIdentity: structuredClone(expectedIdentity),
          expectedQuantity
        }
      }
    }
  };
}

function getPendingTransfer(item, event = {}) {
  const itemTransfer = transferFlagOf(event?.changes) ?? transferFlagOf(item);
  const candidate = pendingTransfer;
  const transferId = cleanId(candidate?.transferId);
  const sourceItemUuid = cleanId(candidate?.sourceItemUuid);
  const expectedIdentity = candidate?.expectedIdentity ?? null;
  const expectedQuantity = Number(candidate?.expectedQuantity);
  if (!transferId
    || !sourceItemUuid
    || !expectedIdentity
    || !Number.isFinite(expectedQuantity)
    || expectedQuantity <= 0) {
    return null;
  }

  if (pendingTransfer && pendingTransfer.expiresAt < Date.now()) {
    clearPendingTransfer();
    return null;
  }
  const currentUserId = cleanId(globalThis.game?.user?.id);
  if (currentUserId && cleanId(candidate?.userId) !== currentUserId) {
    return null;
  }

  if (itemTransfer && (cleanId(itemTransfer.transferId) !== transferId
    || cleanId(itemTransfer.sourceItemUuid) !== sourceItemUuid)) {
    return null;
  }
  const targetItemUuid = itemUuidOf(item);
  if (!targetItemUuid || !inventoryTransferIdentityMatches(item, expectedIdentity)) {
    return null;
  }

  const afterQuantity = itemQuantityOf(item);
  const created = event?.eventType !== "updateItem";
  const changedQuantity = event?.changes?.["system.quantity"]
    ?? event?.changes?.system?.quantity;
  if (created) {
    if (!quantitiesMatch(afterQuantity, expectedQuantity)) {
      return null;
    }
  }
  else if (changedQuantity === undefined
    || !quantitiesMatch(changedQuantity, afterQuantity)
    || afterQuantity <= expectedQuantity) {
    return null;
  }

  const beforeQuantity = created ? 0 : Math.round((afterQuantity - expectedQuantity + Number.EPSILON) * 100) / 100;

  return {
    transferId,
    sourceItemUuid,
    targetItemUuid,
    expectedIdentity: structuredClone(expectedIdentity),
    expectedQuantity,
    targetReceipt: {
      targetItemUuid,
      created,
      beforeQuantity,
      afterQuantity,
      delta: expectedQuantity
    }
  };
}

export async function handleAcceptedPartyInventoryItem(item, _options = {}, userId = "", moduleApi = globalThis.game?.rebreyaMain) {
  if (!isCurrentUserHook(userId) || !isCharacterItem(item)) {
    return false;
  }

  const transfer = getPendingTransfer(item, _options);
  if (!transfer) {
    return false;
  }

  clearPendingTransfer();
  const operation = () => moduleApi?.inventoryService?.handleAcceptedPartyInventoryItem?.(item, transfer);
  const result = typeof moduleApi?.runInventoryMutation === "function"
    ? await moduleApi.runInventoryMutation(operation)
    : await operation();
  if (result?.handled) {
    if (typeof moduleApi?.runInventoryMutation !== "function") {
      await moduleApi?.refreshInventoryViews?.();
    }
    if (result.requested === true) {
      const pending = rememberAcceptedTransfer(item, result, moduleApi, transfer);
      await settleAcceptedTransfer(pending);
    }
    else {
      await initializeDurabilityItem(item, moduleApi);
    }
    return true;
  }

  return false;
}

function isInventoryRelevantItem(item) {
  const actor = item?.parent ?? item?.actor ?? null;
  return actor?.type === "character" || actor?.type === "group";
}

function isInventoryRelevantActor(actor) {
  return actor?.type === "character" || actor?.type === "group";
}

async function refreshInventoryViews(moduleApi) {
  if (typeof moduleApi?.refreshInventoryViews === "function") {
    await moduleApi.refreshInventoryViews();
    return;
  }

  if (moduleApi?.inventoryApp?.rendered) {
    await moduleApi.inventoryApp.render({ force: true, preserveScroll: true });
  }
}

function scheduleInventoryRefresh(moduleApi, debounceMs = DEFAULT_REFRESH_DEBOUNCE_MS) {
  if (!moduleApi) {
    return Promise.resolve(false);
  }

  if (debounceMs <= 0) {
    return refreshInventoryViews(moduleApi).then(() => true);
  }

  if (refreshTimeout) {
    globalThis.clearTimeout?.(refreshTimeout);
  }
  refreshTimeout = globalThis.setTimeout?.(() => {
    refreshTimeout = null;
    refreshInventoryViews(moduleApi).catch((error) => {
      console.error(`${MODULE_ID} | Failed to refresh inventory views after document update.`, error);
    });
  }, debounceMs) ?? null;
  return Promise.resolve(true);
}

export function registerInventorySyncHooks(moduleApi, { Hooks = globalThis.Hooks, debounceMs = DEFAULT_REFRESH_DEBOUNCE_MS, force = false } = {}) {
  if ((!force && hookRegistered) || typeof Hooks?.on !== "function") {
    return false;
  }

  hookRegistered = true;
  registerSourceDepletionSocket();
  const onItemChange = async (item, changes = {}, options = {}, userId = "") => {
    const handledTransfer = await handleAcceptedPartyInventoryItem(item, {
      eventType: "updateItem",
      changes,
      options
    }, userId, moduleApi);
    if (!handledTransfer && isInventoryRelevantItem(item)) {
      await scheduleInventoryRefresh(moduleApi, debounceMs);
    }
  };
  const onItemCreate = async (item, options = {}, userId = "") => {
    const handledTransfer = await handleAcceptedPartyInventoryItem(item, {
      eventType: "createItem",
      options
    }, userId, moduleApi);
    if (!handledTransfer && isCurrentUserHook(userId) && item?.parent?.type) {
      await initializeDurabilityItem(item, moduleApi);
    }
    if (!handledTransfer && isInventoryRelevantItem(item)) {
      await scheduleInventoryRefresh(moduleApi, debounceMs);
    }
    return handledTransfer;
  };
  const onActorChange = async (actor) => {
    if (isInventoryRelevantActor(actor)) {
      await scheduleInventoryRefresh(moduleApi, debounceMs);
    }
  };

  Hooks.on("createItem", (item, options, userId) => {
    onItemCreate(item, options, userId).catch((error) => {
      console.error(`${MODULE_ID} | Failed to process created inventory item.`, error);
    });
  });
  Hooks.on("updateItem", (item, changes, options, userId) => {
    onItemChange(item, changes, options, userId).catch((error) => {
      console.error(`${MODULE_ID} | Failed to process updated inventory item.`, error);
    });
  });
  Hooks.on("deleteItem", (item) => {
    const deletedItemUuid = itemUuidOf(item);
    const matching = [...pendingAcceptedTransfers.values()].filter(
      (entry) => entry.sourceItemUuid === deletedItemUuid
    );
    const pending = matching.length === 1
      ? matching
      : matching.filter((entry) => entry.approved === true);
    Promise.all(pending.map((entry) => settleAcceptedTransfer(entry, { sourceDeleted: true })))
      .then(() => onActorChange(item?.parent ?? item?.actor ?? null))
      .catch((error) => {
        console.error(`${MODULE_ID} | Failed to refresh inventory after item deletion.`, error);
      });
  });
  Hooks.on("updateActor", (actor) => {
    onActorChange(actor).catch((error) => {
      console.error(`${MODULE_ID} | Failed to refresh inventory after actor update.`, error);
    });
  });

  return true;
}
