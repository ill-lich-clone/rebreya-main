import { MODULE_ID } from "../constants.js";

const PARTY_INVENTORY_TRANSFER_FLAG = "partyInventoryTransfer";
const DEFAULT_REFRESH_DEBOUNCE_MS = 0;
const TRANSFER_TTL_MS = 30_000;

let hookRegistered = false;
let pendingTransfer = null;
let pendingTransferTimeout = null;
let refreshTimeout = null;

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

function clearPendingTransfer() {
  pendingTransfer = null;
  if (pendingTransferTimeout) {
    globalThis.clearTimeout?.(pendingTransferTimeout);
    pendingTransferTimeout = null;
  }
}

export function buildPartyInventoryItemDragData(sourceItemUuid) {
  const safeSourceItemUuid = cleanId(sourceItemUuid);
  pendingTransfer = {
    sourceItemUuid: safeSourceItemUuid,
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
          sourceItemUuid: safeSourceItemUuid
        }
      }
    }
  };
}

function getPendingTransfer(item) {
  const sourceItemUuid = cleanId(
    pendingTransfer?.sourceItemUuid
    ?? item?.flags?.[MODULE_ID]?.[PARTY_INVENTORY_TRANSFER_FLAG]?.sourceItemUuid
    ?? item?.getFlag?.(MODULE_ID, PARTY_INVENTORY_TRANSFER_FLAG)?.sourceItemUuid
  );
  if (!sourceItemUuid) {
    return null;
  }

  if (pendingTransfer && pendingTransfer.expiresAt < Date.now()) {
    clearPendingTransfer();
    return null;
  }

  return {
    sourceItemUuid
  };
}

export async function handleAcceptedPartyInventoryItem(item, _options = {}, userId = "", moduleApi = globalThis.game?.rebreyaMain) {
  if (!isCurrentUserHook(userId) || !isCharacterItem(item)) {
    return false;
  }

  const transfer = getPendingTransfer(item);
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
  const onItemChange = async (item, options = {}, userId = "") => {
    const handledTransfer = await handleAcceptedPartyInventoryItem(item, options, userId, moduleApi);
    if (!handledTransfer && isInventoryRelevantItem(item)) {
      await scheduleInventoryRefresh(moduleApi, debounceMs);
    }
  };
  const onActorChange = async (actor) => {
    if (isInventoryRelevantActor(actor)) {
      await scheduleInventoryRefresh(moduleApi, debounceMs);
    }
  };

  Hooks.on("createItem", (item, options, userId) => {
    onItemChange(item, options, userId).catch((error) => {
      console.error(`${MODULE_ID} | Failed to process created inventory item.`, error);
    });
  });
  Hooks.on("updateItem", (item, changes, options, userId) => {
    onItemChange(item, options, userId).catch((error) => {
      console.error(`${MODULE_ID} | Failed to process updated inventory item.`, error);
    });
  });
  Hooks.on("deleteItem", (item) => {
    onActorChange(item?.parent ?? item?.actor ?? null).catch((error) => {
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
