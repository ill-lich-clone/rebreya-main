import { MODULE_ID } from "../constants.js";
import {
  parseStorageDragData,
  promptStorageTransferQuantity
} from "../ui/storage-transfer-ui.js";

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
    { quantity, target: { actorUuid: clean(actor.uuid) } }
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
    { quantity, target: { sceneId, x, y } }
  );
  return { handled: true, cancelled: false, quantity, result };
}

export function handleStorageActorSheetDrop(actor, data, moduleApi, options = {}) {
  if (!parseStorageDragData(data)) return true;
  void transferStorageDropToCharacter(actor, data, moduleApi, options).catch(notifyDropError);
  return false;
}

export function handleStorageCanvasDrop(canvas, data, moduleApi, options = {}) {
  if (!parseStorageDragData(data)) return true;
  void transferStorageDropToCanvas(canvas, data, moduleApi, options).catch(notifyDropError);
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
