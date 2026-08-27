import { MODULE_ID } from "../constants.js";
import {
  parseStorageDragData,
  promptStorageCoinQuantity,
  promptStorageTransferQuantity
} from "../ui/storage-transfer-ui.js";
import { isPortableStorageContainerItem } from "../data/storage-container-snapshot.js";

const registeredHookObjects = new WeakSet();

function clean(value) {
  return String(value ?? "").trim();
}

function createMutationId() {
  const random = globalThis.foundry?.utils?.randomID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `storage-drop-${random}`;
}

function notifyDropError(error) {
  console.error(`${MODULE_ID} | Storage transfer drop failed.`, error);
  globalThis.ui?.notifications?.error?.(
    error?.message || "Не удалось перенести предмет из хранилища."
  );
}

function characterTokenAtCanvasPoint(canvas, x, y) {
  const gridSize = Math.max(1, Number(canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100);
  return [...(canvas?.tokens?.placeables ?? [])].reverse().find((token) => {
    if (token?.visible === false || token?.actor?.type !== "character" || !clean(token.actor.uuid)) return false;
    if (typeof token?.bounds?.contains === "function") return token.bounds.contains(x, y);
    const document = token?.document ?? token;
    const left = Number(document?.x);
    const top = Number(document?.y);
    const width = Math.max(1, Number(document?.width ?? 1)) * gridSize;
    const height = Math.max(1, Number(document?.height ?? 1)) * gridSize;
    return Number.isFinite(left) && Number.isFinite(top)
      && x >= left && x <= left + width
      && y >= top && y <= top + height;
  }) ?? null;
}

export async function transferStorageDropToCharacter(actor, data, moduleApi, { prompt } = {}) {
  const payload = parseStorageDragData(data);
  if (!payload) return { handled: false };
  if (actor?.type !== "character" || !clean(actor?.uuid)) {
    throw new Error("Предмет из хранилища можно перенести только персонажу.");
  }
  if (typeof moduleApi?.claimStorageRow !== "function") {
    throw new Error("API хранилища Rebreya недоступен.");
  }
  const quantity = await promptStorageTransferQuantity(payload.quantity, { prompt });
  if (quantity === null) return { handled: true, cancelled: true };
  const result = await moduleApi.claimStorageRow(
    payload.tokenUuid,
    payload.rowId,
    "character",
    createMutationId(),
    {
      quantity,
      target: { actorUuid: clean(actor.uuid) },
      ...(payload.path?.length ? { path: payload.path } : {})
    }
  );
  return { handled: true, cancelled: false, quantity, result };
}

export async function transferStorageDropToCanvas(canvas, data, moduleApi, { prompt } = {}) {
  const payload = parseStorageDragData(data);
  if (!payload) return { handled: false };
  const sceneId = clean(canvas?.scene?.id ?? data?.sceneId);
  const x = Number(data?.x);
  const y = Number(data?.y);
  if (!sceneId || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Не удалось определить место для предмета на сцене.");
  }
  const characterToken = characterTokenAtCanvasPoint(canvas, x, y);
  if (characterToken) {
    return transferStorageDropToCharacter(characterToken.actor, payload, moduleApi, { prompt });
  }
  if (typeof moduleApi?.claimStorageRow !== "function") {
    throw new Error("API хранилища Rebreya недоступен.");
  }
  const quantity = await promptStorageTransferQuantity(payload.quantity, { prompt });
  if (quantity === null) return { handled: true, cancelled: true };
  const result = await moduleApi.claimStorageRow(
    payload.tokenUuid,
    payload.rowId,
    "scene",
    createMutationId(),
    {
      quantity,
      target: { sceneId, x, y },
      ...(payload.path?.length ? { path: payload.path } : {})
    }
  );
  return { handled: true, cancelled: false, quantity, result };
}

export async function transferPortableStorageItemDropToCanvas(
  canvas,
  data,
  moduleApi,
  { resolveUuid = (uuid) => globalThis.fromUuid?.(uuid) } = {}
) {
  const itemUuid = clean(data?.uuid);
  if (!itemUuid || !["Item", "ItemUUID"].includes(clean(data?.type))) return { handled: false };
  const item = await resolveUuid(itemUuid);
  if (!isPortableStorageContainerItem(item)) return { handled: false };
  if (typeof moduleApi?.dropPortableStorageItemToScene !== "function") {
    throw new Error("API переносимых контейнеров Rebreya недоступен.");
  }
  const sceneId = clean(canvas?.scene?.id ?? data?.sceneId);
  const x = Number(data?.x);
  const y = Number(data?.y);
  if (!sceneId || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Не удалось определить место для контейнера на сцене.");
  }
  const result = await moduleApi.dropPortableStorageItemToScene(itemUuid, { sceneId, x, y });
  return { handled: true, result };
}

export async function transferFoundryItemDropToCanvas(
  canvas,
  data,
  moduleApi,
  { prompt } = {}
) {
  const itemUuid = clean(data?.uuid);
  if (!itemUuid || !["Item", "ItemUUID"].includes(clean(data?.type))) return { handled: false };
  if (typeof moduleApi?.inspectStorageDepositSource !== "function"
    || typeof moduleApi?.dropStorageItemToScene !== "function") {
    throw new Error("API переноса предметов Rebreya на сцену недоступен.");
  }
  const sceneId = clean(canvas?.scene?.id ?? data?.sceneId);
  const x = Number(data?.x);
  const y = Number(data?.y);
  if (!sceneId || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Не удалось определить место для предмета на сцене.");
  }
  const inspected = await moduleApi.inspectStorageDepositSource({ kind: "item", itemUuid });
  if (inspected.kind === "coin-template") {
    if (typeof moduleApi?.dropStorageCoinsToScene !== "function") {
      throw new Error("API переноса монет Rebreya на сцену недоступен.");
    }
    const quantity = await promptStorageCoinQuantity(inspected.available, { prompt });
    if (quantity === null) return { handled: true, cancelled: true };
    const result = await moduleApi.dropStorageCoinsToScene(itemUuid, inspected.denomination, {
      sceneId,
      x,
      y,
      quantity
    });
    return { handled: true, cancelled: false, quantity, result };
  }
  const quantity = await promptStorageTransferQuantity(inspected.available, { prompt });
  if (quantity === null) return { handled: true, cancelled: true };
  const result = await moduleApi.dropStorageItemToScene(itemUuid, { sceneId, x, y, quantity });
  return { handled: true, cancelled: false, quantity, result };
}

export async function transferFoundryJournalDropToCanvas(canvas, data, moduleApi) {
  const sourceUuid = clean(data?.uuid);
  const documentName = clean(data?.type);
  if (!["JournalEntry", "JournalEntryPage"].includes(documentName) || !sourceUuid) return { handled: false };
  if (typeof moduleApi?.dropStorageJournalToScene !== "function") {
    throw new Error("API переноса записей журнала Rebreya на сцену недоступен.");
  }
  const sceneId = clean(canvas?.scene?.id ?? data?.sceneId);
  const x = Number(data?.x);
  const y = Number(data?.y);
  if (!sceneId || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Не удалось определить место для записи журнала на сцене.");
  }
  const result = await moduleApi.dropStorageJournalToScene(sourceUuid, { documentName, sceneId, x, y });
  return { handled: true, result };
}

export function handleStorageActorSheetDrop(actor, data, moduleApi, options = {}) {
  if (!parseStorageDragData(data)) return true;
  void transferStorageDropToCharacter(actor, data, moduleApi, options).catch(notifyDropError);
  return false;
}

export function handleStorageCanvasDrop(canvas, data, moduleApi, options = {}) {
  if (parseStorageDragData(data)) {
    void transferStorageDropToCanvas(canvas, data, moduleApi, options).catch(notifyDropError);
    return false;
  }
  if (["JournalEntry", "JournalEntryPage"].includes(clean(data?.type)) && clean(data?.uuid)) {
    if (canvas?.activeLayer === canvas?.notes) return true;
    void transferFoundryJournalDropToCanvas(canvas, data, moduleApi).catch(notifyDropError);
    return false;
  }
  if (!["Item", "ItemUUID"].includes(clean(data?.type)) || !clean(data?.uuid)) return true;
  void transferFoundryItemDropToCanvas(canvas, data, moduleApi, options).catch(notifyDropError);
  return false;
}

export function registerStorageTransferDropHooks(
  moduleApi,
  { Hooks = globalThis.Hooks, canvasProvider = () => globalThis.canvas } = {}
) {
  if (!Hooks || typeof Hooks.on !== "function" || registeredHookObjects.has(Hooks)) return false;
  registeredHookObjects.add(Hooks);
  Hooks.on("dropActorSheetData", (actor, _sheet, data) => (
    handleStorageActorSheetDrop(actor, data, moduleApi)
  ));
  Hooks.on("dropCanvasData", (hookCanvas, data) => (
    handleStorageCanvasDrop(hookCanvas ?? canvasProvider(), data, moduleApi)
  ));
  return true;
}
