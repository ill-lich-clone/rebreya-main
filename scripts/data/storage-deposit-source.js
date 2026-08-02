import { isStorageActor, readStorageState, readStorageStateAtPath } from "./storage-service.js";
import {
  buildStorageContainerRow,
  isPortableStorageContainerItem
} from "./storage-container-snapshot.js";
import { buildStorageContainerSnapshotFromToken } from "./storage-container-item-service.js";
import { parseStorageDragData } from "../ui/storage-transfer-ui.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function positiveQuantity(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : fallback;
}

function requireQuantity(value, maximum = Number.POSITIVE_INFINITY) {
  const quantity = positiveQuantity(value);
  if (!quantity || quantity > maximum) {
    throw new Error(`Количество должно быть целым числом от 1 до ${maximum}.`);
  }
  return quantity;
}

function parsedObject(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  }
  catch (_error) {
    return null;
  }
}

function createDepositRowId() {
  const random = globalThis.foundry?.utils?.randomID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `deposit-${random}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function itemData(item) {
  const data = clone(item?.toObject?.() ?? item) ?? {};
  data.system ??= {};
  return data;
}

function canonicalOrigin(item) {
  return clean(
    item?.flags?.core?.sourceId
    ?? item?.flags?.dnd5e?.sourceId
    ?? item?.getFlag?.("core", "sourceId")
  );
}

function canonicalItemStackKey(item) {
  const origin = canonicalOrigin(item);
  if (origin) return origin;
  const data = itemData(item);
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  data.system.quantity = 1;
  return JSON.stringify(stableValue({
    name: clean(data.name ?? item?.name),
    type: clean(data.type ?? item?.type),
    img: clean(data.img ?? item?.img),
    system: data.system,
    flags: data.flags ?? {}
  }));
}

function isItemDocument(document) {
  return document?.documentName === "Item"
    || document?.constructor?.metadata?.name === "Item";
}

function isEmbeddedActorItem(item) {
  return item?.parent?.documentName === "Actor"
    || item?.parent?.constructor?.metadata?.name === "Actor";
}

function itemQuantity(item) {
  return positiveQuantity(item?.system?.quantity, 1);
}

function buildItemRow(item, available, createRowId) {
  const data = itemData(item);
  data.system.quantity = available;
  const origin = canonicalOrigin(item);
  return {
    rowId: clean(createRowId?.()) || createDepositRowId(),
    stackKey: canonicalItemStackKey(item),
    sourceId: origin || clean(item?.uuid),
    sourceType: clean(item?.type),
    name: clean(item?.name ?? data.name) || "Предмет",
    img: clean(item?.img ?? data.img),
    quantity: available,
    itemData: data
  };
}

function storageRows(state) {
  return [
    ...(Array.isArray(state?.manualRows) ? state.manualRows : []),
    ...(Array.isArray(state?.generatedRows) ? state.generatedRows : [])
  ];
}

export function parseStorageDepositDragData(value) {
  const canonical = parsedObject(value);
  if (canonical?.kind === "item" && clean(canonical.itemUuid)) {
    return { kind: "item", itemUuid: clean(canonical.itemUuid) };
  }
  if (canonical?.kind === "storage-row"
    && clean(canonical.tokenUuid)
    && clean(canonical.rowId)
    && positiveQuantity(canonical.quantity)) {
    return {
      kind: "storage-row",
      tokenUuid: clean(canonical.tokenUuid),
      rowId: clean(canonical.rowId),
      quantity: positiveQuantity(canonical.quantity),
      ...(Array.isArray(canonical.path) ? { path: canonical.path.map(clean).filter(Boolean).slice(0, 8) } : {})
    };
  }
  if (canonical?.kind === "storage-token" && clean(canonical.tokenUuid)) {
    return { kind: "storage-token", tokenUuid: clean(canonical.tokenUuid) };
  }
  const storage = parseStorageDragData(value);
  if (storage) {
    return {
      kind: "storage-row",
      tokenUuid: storage.tokenUuid,
      rowId: storage.rowId,
      quantity: storage.quantity,
      ...(storage.path?.length ? { path: storage.path } : {})
    };
  }

  const payload = canonical;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (clean(payload.type) === "Token") {
    const tokenUuid = clean(payload.uuid ?? payload.tokenUuid);
    return tokenUuid ? { kind: "storage-token", tokenUuid } : null;
  }
  if (!["Item", "ItemUUID"].includes(clean(payload.type))) return null;
  const itemUuid = clean(payload.uuid);
  return itemUuid ? { kind: "item", itemUuid } : null;
}

async function resolveItemSource(sourceRef, { fromUuid, createRowId, containerItemService = null }) {
  if (typeof fromUuid !== "function") throw new TypeError("Для предмета требуется разрешение UUID.");
  const item = await fromUuid(sourceRef.itemUuid);
  if (!isItemDocument(item)) throw new Error("Перетаскиваемый предмет не найден.");

  const available = itemQuantity(item);
  const embedded = isEmbeddedActorItem(item);
  const parent = embedded ? item.parent : null;
  if (isPortableStorageContainerItem(item)) {
    if (!containerItemService || typeof containerItemService.captureFromItem !== "function") {
      throw new Error("Сервис переносимых контейнеров Rebreya недоступен.");
    }
    const snapshot = await containerItemService.captureFromItem(item);
    const row = buildStorageContainerRow(snapshot, {
      rowId: clean(createRowId?.()) || createDepositRowId()
    });
    return {
      kind: "storage-item",
      mode: embedded ? "move" : "copy",
      available: 1,
      row,
      sourceKey: clean(item.uuid),
      item,
      sourceActor: parent,
      canUserMove(user) {
        if (!embedded || user?.isGM === true) return true;
        if (typeof parent?.testUserPermission === "function") {
          return parent.testUserPermission(user, "OWNER") === true;
        }
        return item?.isOwner === true || parent?.isOwner === true;
      },
      async consume(requestedQuantity) {
        requireQuantity(requestedQuantity, 1);
        if (!embedded) return { kind: "copy" };
        const receipt = await containerItemService.removeItemTree(item);
        return { kind: "storage-item", receipt };
      },
      async restore(receipt) {
        if (!receipt || receipt.kind === "copy") return false;
        if (receipt.kind !== "storage-item") return false;
        await containerItemService.restoreItemTree(receipt.receipt);
        return true;
      }
    };
  }
  const row = buildItemRow(item, available, createRowId);

  return {
    kind: "item",
    mode: embedded ? "move" : "copy",
    available,
    row,
    sourceKey: clean(item.uuid),
    item,
    sourceActor: parent,
    canUserMove(user) {
      if (!embedded || user?.isGM === true) return true;
      if (typeof parent?.testUserPermission === "function") {
        return parent.testUserPermission(user, "OWNER") === true;
      }
      return item?.isOwner === true || parent?.isOwner === true;
    },
    async consume(requestedQuantity) {
      const quantity = requireQuantity(requestedQuantity, itemQuantity(item));
      if (!embedded) return { kind: "copy" };
      const beforeQuantity = itemQuantity(item);
      const snapshot = itemData(item);
      if (quantity < beforeQuantity) {
        await item.update({ "system.quantity": beforeQuantity - quantity });
        return {
          kind: "item-update",
          itemUuid: clean(item.uuid),
          beforeQuantity,
          item,
          parent
        };
      }
      await item.delete();
      return {
        kind: "item-delete",
        itemUuid: clean(item.uuid),
        beforeQuantity,
        snapshot,
        item,
        parent
      };
    },
    async restore(receipt) {
      if (!receipt || receipt.kind === "copy") return false;
      if (receipt.kind === "item-update") {
        await receipt.item.update({ "system.quantity": receipt.beforeQuantity });
        return true;
      }
      if (receipt.kind === "item-delete") {
        if (typeof receipt.parent?.createEmbeddedDocuments !== "function") {
          throw new Error("Не удалось восстановить исходный предмет после ошибки переноса.");
        }
        await receipt.parent.createEmbeddedDocuments("Item", [receipt.snapshot], { keepId: true });
        return true;
      }
      return false;
    }
  };
}

async function resolveStorageRowSource(sourceRef, {
  resolveToken,
  storageService,
  createRowId
}) {
  if (typeof resolveToken !== "function" || !storageService) {
    throw new TypeError("Для строки хранилища требуются token resolver и StorageService.");
  }
  const token = await resolveToken(sourceRef.tokenUuid);
  if (!token) throw new Error("Исходное хранилище не найдено.");
  const path = Array.isArray(sourceRef.path) ? sourceRef.path.map(clean).filter(Boolean).slice(0, 8) : [];
  const state = readStorageStateAtPath(token, path);
  const rowId = clean(sourceRef.rowId);
  const row = storageRows(state).find((entry) => clean(entry?.rowId) === rowId) ?? null;
  if (!row || state.claimedRowIds.includes(rowId)) {
    throw new Error("Предмет исходного хранилища уже недоступен.");
  }
  const available = positiveQuantity(row.quantity ?? row.itemData?.system?.quantity, 1);
  const depositRow = clone(row);
  depositRow.rowId = clean(createRowId?.()) || createDepositRowId();
  depositRow.stackKey = clean(row.stackKey ?? row.sourceId) || JSON.stringify(stableValue({
    name: clean(row.name),
    type: clean(row.itemData?.type ?? row.sourceType),
    img: clean(row.img),
    system: { ...(clone(row.itemData?.system) ?? {}), quantity: 1 },
    flags: clone(row.itemData?.flags) ?? {}
  }));
  depositRow.quantity = available;
  depositRow.itemData ??= {};
  depositRow.itemData.system ??= {};
  depositRow.itemData.system.quantity = available;

  return {
    kind: "storage-row",
    mode: "move",
    available,
    row: depositRow,
    sourceKey: `${clean(sourceRef.tokenUuid)}:${rowId}`,
    storageToken: token,
    canUserMove() { return true; },
    async consume(requestedQuantity) {
      const quantity = requireQuantity(requestedQuantity, available);
      const beforeState = readStorageStateAtPath(token, path);
      const result = await storageService.claim(token, {
        kind: "row",
        rowId,
        quantity,
        path
      });
      if (!result.changed) throw new Error("Предмет исходного хранилища уже недоступен.");
      return { kind: "storage-row", beforeState, state: result.state, token };
    },
    async restore(receipt) {
      if (receipt?.kind !== "storage-row") return false;
      await storageService.configure(token, receipt.beforeState, { path });
      return true;
    }
  };
}

async function resolveStorageTokenSource(sourceRef, { resolveToken, createRowId }) {
  if (typeof resolveToken !== "function") {
    throw new TypeError("Для токена-контейнера требуется token resolver.");
  }
  const token = await resolveToken(sourceRef.tokenUuid);
  const document = token?.document ?? token;
  if (!document || !isStorageActor(document.actor)) {
    throw new Error("Перетаскиваемый токен не является хранилищем Rebreya.");
  }
  const snapshot = buildStorageContainerSnapshotFromToken(document);
  const row = buildStorageContainerRow(snapshot, {
    rowId: clean(createRowId?.()) || createDepositRowId()
  });
  const parent = document.parent ?? document.scene ?? null;
  const tokenData = clone(document.toObject?.() ?? document) ?? {};

  return {
    kind: "storage-token",
    mode: "move",
    available: 1,
    row,
    sourceKey: clean(document.uuid ?? sourceRef.tokenUuid),
    storageToken: document,
    canUserMove(user) {
      if (user?.isGM === true) return true;
      if (typeof document.testUserPermission === "function") {
        return document.testUserPermission(user, "OWNER") === true;
      }
      if (typeof document.actor?.testUserPermission === "function") {
        return document.actor.testUserPermission(user, "OWNER") === true;
      }
      return document.isOwner === true || document.actor?.isOwner === true;
    },
    async consume(requestedQuantity) {
      requireQuantity(requestedQuantity, 1);
      if (typeof document.delete === "function") {
        await document.delete();
      }
      else if (typeof parent?.deleteEmbeddedDocuments === "function" && clean(document.id)) {
        await parent.deleteEmbeddedDocuments("Token", [clean(document.id)]);
      }
      else {
        throw new TypeError("Сцена не поддерживает удаление токена-контейнера.");
      }
      return { kind: "storage-token", parent, tokenData };
    },
    async restore(receipt) {
      if (receipt?.kind !== "storage-token" || typeof receipt.parent?.createEmbeddedDocuments !== "function") {
        return false;
      }
      await receipt.parent.createEmbeddedDocuments("Token", [receipt.tokenData], { keepId: true });
      return true;
    }
  };
}

export async function resolveStorageDepositSource(sourceRef, dependencies = {}) {
  if (!sourceRef || typeof sourceRef !== "object" || Array.isArray(sourceRef)) {
    throw new TypeError("Не указан источник предмета для хранилища.");
  }
  if (sourceRef.kind === "item") {
    return resolveItemSource(sourceRef, dependencies);
  }
  if (sourceRef.kind === "storage-row") {
    return resolveStorageRowSource(sourceRef, dependencies);
  }
  if (sourceRef.kind === "storage-token") {
    return resolveStorageTokenSource(sourceRef, dependencies);
  }
  throw new Error("Неподдерживаемый источник предмета для хранилища.");
}
