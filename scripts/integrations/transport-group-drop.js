import { MODULE_ID, TRANSPORT_COMPENDIUM_ID } from "../constants.js";
import { isManagedPartyGroup } from "../data/group-context-service.js";

const registeredHookObjects = new WeakSet();
const TRANSPORT_UUID_PATTERN = new RegExp(
  `^Compendium\\.${TRANSPORT_COMPENDIUM_ID.replaceAll(".", "\\.")}\\.Actor\\.lchtransport\\d{4}$`,
  "u"
);
const WORLD_ACTOR_UUID_PATTERN = /^Actor\.([A-Za-z0-9_-]{1,128})$/u;

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function actorFlag(actor, key) {
  return actor?.getFlag?.(MODULE_ID, key)
    ?? actor?.flags?.[MODULE_ID]?.[key]
    ?? actor?.toObject?.()?.flags?.[MODULE_ID]?.[key];
}

function actorCompendiumSource(actor) {
  return cleanString(
    actor?._stats?.compendiumSource
    ?? actor?.toObject?.()?._stats?.compendiumSource
  );
}

function defaultResolveWorldActor(uuid) {
  const match = WORLD_ACTOR_UUID_PATTERN.exec(uuid);
  if (!match) return null;
  try {
    return globalThis.fromUuidSync?.(uuid)
      ?? globalThis.game?.actors?.get?.(match[1])
      ?? null;
  }
  catch (_error) {
    return null;
  }
}

function isManagedWorldTransportActor(actor, expectedUuid) {
  const transport = actorFlag(actor, "transport") ?? {};
  const sourceId = cleanString(actorFlag(actor, "sourceId"));
  const nestedSourceId = cleanString(transport.sourceId);
  return actor?.type === "vehicle"
    && !actor?.pack
    && cleanString(actor?.uuid) === expectedUuid
    && actorFlag(actor, "managed") === true
    && transport.instance !== true
    && Boolean(sourceId)
    && sourceId === nestedSourceId
    && TRANSPORT_UUID_PATTERN.test(actorCompendiumSource(actor));
}

export function isTransportCompendiumActorDrop(
  data,
  { resolveWorldActor = defaultResolveWorldActor } = {}
) {
  if (data?.type !== "Actor") return false;
  const uuid = cleanString(data?.uuid);
  if (TRANSPORT_UUID_PATTERN.test(uuid)) return true;
  if (!WORLD_ACTOR_UUID_PATTERN.test(uuid) || typeof resolveWorldActor !== "function") {
    return false;
  }
  return isManagedWorldTransportActor(resolveWorldActor(uuid), uuid);
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

export function handleTransportGroupDrop(canvas, data, moduleApi, options = {}) {
  if (!isTransportCompendiumActorDrop(data, options)) return true;
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
