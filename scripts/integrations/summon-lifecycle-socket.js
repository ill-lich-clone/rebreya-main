export const SUMMON_LIFECYCLE_MUTATION_COMMAND = "summon-lifecycle-mutation";

const ACTIONS = new Set(["ensure-link", "delete-operation-tokens"]);
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const registeredBuses = new WeakSet();

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeString(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim() && !FORBIDDEN_KEYS.has(value);
}

function exactKeys(value, keys) {
  return isPlainRecord(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function uuidParts(value) { return isSafeString(value) ? value.split(".") : null; }
function actorUuid(value) {
  const parts = uuidParts(value);
  return Boolean(parts && ((parts.length === 2 && parts[0] === "Actor") || (parts.length === 6 && parts[0] === "Scene" && parts[2] === "Token" && parts[4] === "Actor")) && parts.every(isSafeString));
}
function sceneUuid(value) {
  const parts = uuidParts(value);
  return Boolean(parts && parts.length === 2 && parts[0] === "Scene" && parts.every(isSafeString));
}
function isExactChildUuid(value, parentUuid, documentType) {
  const child = uuidParts(value);
  const parent = uuidParts(parentUuid);
  return Boolean(child && parent && child.length === parent.length + 2
    && child.slice(0, parent.length).every((part, index) => part === parent[index])
    && child.at(-2) === documentType && isSafeString(child.at(-1)));
}
function validDeclaration(value) { return exactKeys(value, ["recipe", "version"]) && isSafeString(value.recipe) && Number.isInteger(value.version) && value.version > 0; }
function validLink(value, payload) {
  const fields = ["runtime", "recipe", "version", "operationId", "sourceActorUuid", "sourceTokenUuid", "sourceItemUuid", "sourceActivityUuid", "controllingEffectUuid"];
  if (!(exactKeys(value, fields) && value.runtime === "summon" && isSafeString(value.recipe) && Number.isInteger(value.version) && value.version > 0
    && isSafeString(value.operationId) && actorUuid(value.sourceActorUuid) && isSafeString(value.sourceTokenUuid) && isSafeString(value.sourceItemUuid)
    && isSafeString(value.sourceActivityUuid) && (value.controllingEffectUuid === null || isSafeString(value.controllingEffectUuid))
    && value.recipe === payload.declaration.recipe && value.version === payload.declaration.version && value.operationId === payload.operationId && value.sourceActorUuid === payload.actorUuid)) return false;
  return isExactChildUuid(value.sourceItemUuid, value.sourceActorUuid, "Item")
    && isExactChildUuid(value.sourceActivityUuid, value.sourceItemUuid, "Activity")
    && isExactChildUuid(value.sourceTokenUuid, payload.sceneUuid, "Token");
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

function sourceTokenId(sceneUuidValue, tokenUuid) {
  const prefix = `${sceneUuidValue}.Token.`;
  return tokenUuid.startsWith(prefix) ? tokenUuid.slice(prefix.length) : null;
}

export function isValidSummonLifecycleMutationPayload(payload) {
  const keys = ["action", "actorUuid", "sceneUuid", "tokenIds", "declaration", "operationId", "link"];
  return exactKeys(payload, keys) && ACTIONS.has(payload.action) && actorUuid(payload.actorUuid) && sceneUuid(payload.sceneUuid)
    && Array.isArray(payload.tokenIds) && payload.tokenIds.length > 0 && payload.tokenIds.every(isSafeString) && new Set(payload.tokenIds).size === payload.tokenIds.length
    && validDeclaration(payload.declaration) && isSafeString(payload.operationId) && validLink(payload.link, payload);
}

export function registerSummonLifecycleSocketCommand(moduleApi, options = {}) {
  const commandBus = moduleApi?.socketCommandBus;
  const runtime = moduleApi?.summonLifecycleRuntime;
  if (typeof commandBus?.register !== "function" || typeof runtime?.handleSocketMutation !== "function") return false;
  if (registeredBuses.has(commandBus)) return true;
  commandBus.register(SUMMON_LIFECYCLE_MUTATION_COMMAND, {
    validate: isValidSummonLifecycleMutationPayload,
    authorize: async (payload, { sender } = {}) => senderOwnsActor(await resolve(payload.actorUuid, options), sender),
    execute: async (payload, { sender } = {}) => {
      const actor = await resolve(payload.actorUuid, options);
      if (!senderOwnsActor(actor, sender)) throw new Error("Summon lifecycle mutation is not authorized.");
      const scene = await resolve(payload.sceneUuid, options);
      if (!scene) throw new Error("Summon lifecycle scene is unavailable.");
      const sourceToken = scene.tokens?.get?.(sourceTokenId(payload.sceneUuid, payload.link.sourceTokenUuid));
      if (sourceToken?.actor?.uuid !== payload.actorUuid) throw new Error("Summon lifecycle source token does not match the source actor.");
      return runtime.handleSocketMutation(payload, { actor, scene });
    }
  });
  registeredBuses.add(commandBus);
  return true;
}
