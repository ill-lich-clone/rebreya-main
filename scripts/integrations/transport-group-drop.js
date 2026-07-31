import { MODULE_ID, TRANSPORT_COMPENDIUM_ID } from "../constants.js";
import { isManagedPartyGroup } from "../data/group-context-service.js";

const registeredHookObjects = new WeakSet();
const TRANSPORT_UUID_PATTERN = new RegExp(
  `^Compendium\\.${TRANSPORT_COMPENDIUM_ID.replaceAll(".", "\\.")}\\.Actor\\.lchtransport\\d{4}$`,
  "u"
);

export function isTransportCompendiumActorDrop(data) {
  return data?.type === "Actor"
    && TRANSPORT_UUID_PATTERN.test(String(data?.uuid ?? "").trim());
}

export function findManagedGroupTokenAtPoint(canvas, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const placeables = Array.isArray(canvas?.tokens?.placeables)
    ? canvas.tokens.placeables
    : [];
  for (let index = placeables.length - 1; index >= 0; index -= 1) {
    const token = placeables[index];
    if (
      isManagedPartyGroup(token?.actor)
      && token?.bounds?.contains?.(x, y) === true
    ) {
      return token;
    }
  }
  return null;
}

export function handleTransportGroupDrop(canvas, data, moduleApi) {
  if (!isTransportCompendiumActorDrop(data)) return true;
  const x = Number(data?.x);
  const y = Number(data?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  const token = findManagedGroupTokenAtPoint(canvas, x, y);
  if (!token || typeof moduleApi?.importTransportIntoGroup !== "function") return true;

  void moduleApi.importTransportIntoGroup({
    groupActorId: token.actor.id,
    sourceActorUuid: String(data.uuid).trim()
  }).catch((error) => {
    console.error(`${MODULE_ID} | Failed to import dropped transport.`, error);
    globalThis.ui?.notifications?.error?.(
      error?.message || "Не удалось добавить транспорт в группу."
    );
  });
  return false;
}

export function registerTransportGroupDropHooks(
  moduleApi,
  {
    Hooks = globalThis.Hooks,
    canvasProvider = () => globalThis.canvas
  } = {}
) {
  if (!Hooks || (typeof Hooks !== "object" && typeof Hooks !== "function")) return false;
  if (typeof Hooks.on !== "function" || registeredHookObjects.has(Hooks)) return false;
  registeredHookObjects.add(Hooks);
  Hooks.on("dropCanvasData", (hookCanvas, data) => (
    handleTransportGroupDrop(hookCanvas ?? canvasProvider(), data, moduleApi)
  ));
  return true;
}
