import { aggregateKey, keyedMutationScheduling } from "../application/socket-command-scheduling.js";

export const ALCHEMY_BOMB_MUTATION_COMMAND = "alchemy-bomb-mutation";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const PLACE_KEYS = Object.freeze([
  "action", "operationId", "actorUuid", "sourceTokenUuid", "sceneUuid", "itemUuid", "activityUuid",
  "productId", "name", "image", "x", "y", "elevation", "radius", "persistent",
  "family", "dc", "durationSeconds"
]);
const CLEANUP_KEYS = Object.freeze([
  "action", "operationId", "actorUuid", "sceneUuid", "tokenUuid", "templateUuid", "regionUuid"
]);
const RESULT_KEYS = Object.freeze([
  "action", "operationId", "actorUuid", "sourceTokenUuid", "sceneUuid", "family", "failedTokenUuids",
  "savedTokenUuids", "effect", "point", "regionUuid"
]);
const registeredGateways = new WeakSet();

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return isPlainRecord(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function safeString(value, { empty = false } = {}) {
  return typeof value === "string"
    && value === value.trim()
    && (empty || value.length > 0)
    && value.length <= 512
    && !FORBIDDEN_KEYS.has(value)
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function uuidParts(value) {
  return safeString(value) ? value.split(".") : null;
}

function exactUuid(value, rootType) {
  const parts = uuidParts(value);
  return Boolean(parts && parts.length === 2 && parts[0] === rootType && parts.every((part) => safeString(part)));
}

function exactChildUuid(value, parentUuid, documentType, { empty = false } = {}) {
  if (empty && value === "") return true;
  const child = uuidParts(value);
  const parent = uuidParts(parentUuid);
  return Boolean(child && parent && child.length === parent.length + 2
    && child.slice(0, parent.length).every((part, index) => part === parent[index])
    && child.at(-2) === documentType && safeString(child.at(-1)));
}

function senderOwnsActor(actor, sender) {
  if (sender?.isGM === true) return true;
  if (!actor || !sender) return false;
  if (typeof actor.testUserPermission === "function") return actor.testUserPermission(sender, "OWNER");
  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[sender.id] ?? 0) >= 3 || Number(ownership.default ?? 0) >= 3;
}

async function resolve(uuid, options) {
  const resolver = options?.fromUuid ?? globalThis.fromUuid;
  if (typeof resolver !== "function") return null;
  const document = await resolver(uuid);
  return document?.uuid === uuid ? document : null;
}

function placePayload(payload) {
  return exactKeys(payload, PLACE_KEYS)
    && payload.action === "place"
    && safeString(payload.operationId)
    && exactUuid(payload.actorUuid, "Actor")
    && exactUuid(payload.sceneUuid, "Scene")
    && exactChildUuid(payload.sourceTokenUuid, payload.sceneUuid, "Token")
    && exactChildUuid(payload.itemUuid, payload.actorUuid, "Item")
    && exactChildUuid(payload.activityUuid, payload.itemUuid, "Activity")
    && safeString(payload.productId)
    && safeString(payload.name)
    && safeString(payload.image)
    && safeString(payload.family)
    && Number.isInteger(payload.dc) && payload.dc > 0 && payload.dc <= 100
    && Number.isFinite(payload.durationSeconds) && payload.durationSeconds >= 0 && payload.durationSeconds <= 86400
    && [payload.x, payload.y, payload.elevation, payload.radius].every(Number.isFinite)
    && payload.radius > 0
    && typeof payload.persistent === "boolean";
}

function cleanupPayload(payload) {
  return exactKeys(payload, CLEANUP_KEYS)
    && payload.action === "cleanup"
    && safeString(payload.operationId)
    && exactUuid(payload.actorUuid, "Actor")
    && exactUuid(payload.sceneUuid, "Scene")
    && exactChildUuid(payload.tokenUuid, payload.sceneUuid, "Token", { empty: true })
    && exactChildUuid(payload.templateUuid, payload.sceneUuid, "MeasuredTemplate", { empty: true })
    && exactChildUuid(payload.regionUuid, payload.sceneUuid, "Region", { empty: true })
    && Boolean(payload.tokenUuid || payload.templateUuid || payload.regionUuid);
}

function resultEffect(family, effect) {
  if (!isPlainRecord(effect)) return false;
  const specs = {
    "alchemical-fire": ["amount", "step"], acid: ["breakage"],
    electrical: ["failureWeakness", "successWeakness"], cryogenic: ["restrained"],
    sticky: ["durationSeconds", "difficultTerrain"], frightening: ["frightened"], stinking: ["nauseated"]
  };
  const keys = specs[family];
  if (!keys || !exactKeys(effect, keys)) return false;
  return Object.entries(effect).every(([key, value]) => key === "difficultTerrain"
    ? typeof value === "boolean"
    : Number.isInteger(value) && value >= 0 && value <= 86400);
}

function resultPayload(payload) {
  return exactKeys(payload, RESULT_KEYS)
    && payload.action === "apply-results"
    && safeString(payload.operationId)
    && exactUuid(payload.actorUuid, "Actor")
    && exactUuid(payload.sceneUuid, "Scene")
    && exactChildUuid(payload.sourceTokenUuid, payload.sceneUuid, "Token")
    && exactChildUuid(payload.regionUuid, payload.sceneUuid, "Region", { empty: true })
    && safeString(payload.family)
    && resultEffect(payload.family, payload.effect)
    && exactKeys(payload.point, ["x", "y"])
    && Number.isFinite(payload.point.x) && Number.isFinite(payload.point.y)
    && [payload.failedTokenUuids, payload.savedTokenUuids].every((values) => Array.isArray(values)
      && values.length <= 256 && new Set(values).size === values.length
      && values.every((uuid) => exactChildUuid(uuid, payload.sceneUuid, "Token")));
}

export function isValidAlchemyBombMutationPayload(payload) {
  return placePayload(payload) || cleanupPayload(payload) || resultPayload(payload);
}

function sourceTokenId(sceneUuid, tokenUuid) {
  return tokenUuid.slice(`${sceneUuid}.Token.`.length);
}

export function registerAlchemyBombSocketCommand(moduleApi, options = {}) {
  const mutationGateway = moduleApi?.privilegedMutationGateway;
  const runtime = moduleApi?.alchemyBombRuntimeService;
  if (typeof mutationGateway?.registerCommand !== "function" || typeof runtime?.handleSocketMutation !== "function") return false;
  if (registeredGateways.has(mutationGateway)) return true;

  mutationGateway.registerCommand(ALCHEMY_BOMB_MUTATION_COMMAND, {
    validate: isValidAlchemyBombMutationPayload,
    authorize: async (payload, { sender } = {}) => senderOwnsActor(await resolve(payload.actorUuid, options), sender),
    scheduling: keyedMutationScheduling((payload) => [
      aggregateKey("actor", payload.actorUuid),
      aggregateKey("scene", payload.sceneUuid),
      aggregateKey("alchemy-bomb", payload.operationId)
    ]),
    execute: async (payload, { sender } = {}) => {
      const actor = await resolve(payload.actorUuid, options);
      if (!senderOwnsActor(actor, sender)) throw new Error("Alchemy bomb mutation is not authorized.");
      const scene = await resolve(payload.sceneUuid, options);
      if (!scene) throw new Error("Alchemy bomb scene is unavailable.");
      if (payload.action === "place" || payload.action === "apply-results") {
        const sourceToken = scene.tokens?.get?.(sourceTokenId(payload.sceneUuid, payload.sourceTokenUuid));
        if (sourceToken?.actor?.uuid !== payload.actorUuid) {
          throw new Error("Alchemy bomb source token does not match the source actor.");
        }
      }
      return runtime.handleSocketMutation(payload, { actor, scene });
    }
  });
  registeredGateways.add(mutationGateway);
  return true;
}
