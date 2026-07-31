export const SPELL_INSTANCE_MUTATION_COMMAND = "spell-instance-mutation";

const ACTIONS = new Set(["claim-operation", "create", "replace-state", "delete"]);
const FORBIDDEN_OWN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSerializable(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const keys = Object.keys(value);
  if (keys.some((key) => FORBIDDEN_OWN_KEYS.has(key))) return false;
  if (Array.isArray(value)) {
    if (!keys.every((key) => /^(0|[1-9]\d*)$/u.test(key) && Number(key) < value.length)) return false;
  }
  else if (!isPlainObject(value)) {
    return false;
  }
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return "value" in descriptor && isSerializable(descriptor.value, seen);
  });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function validDeclaration(value) {
  return isSerializable(value)
    && exactKeys(value, ["recipe", "version"])
    && nonEmptyString(value.recipe)
    && Number.isInteger(value.version)
    && value.version > 0;
}

function validBase(payload) {
  return ACTIONS.has(payload?.action)
    && nonEmptyString(payload.actorUuid)
    && validDeclaration(payload.declaration)
    && nonNegativeInteger(payload.expectedRevision)
    && nonEmptyString(payload.instanceId)
    && nonEmptyString(payload.operationId);
}

function validClaim(payload) {
  return ACTIONS.has(payload?.action)
    && payload.action === "claim-operation"
    && nonEmptyString(payload.actorUuid)
    && validDeclaration(payload.declaration)
    && nonEmptyString(payload.operationId)
    && exactKeys(payload, ["action", "actorUuid", "declaration", "operationId"]);
}

function uuidParts(value) {
  if (!nonEmptyString(value) || value !== value.trim()) return null;
  const parts = value.split(".");
  return parts.every((part) => nonEmptyString(part) && part === part.trim()) ? parts : null;
}

// Foundry actor roots accepted here: Actor.<id> and the documented synthetic
// token shape Scene.<sceneId>.Token.<tokenId>.Actor.<actorId>.
function parseActorUuid(value) {
  const parts = uuidParts(value);
  if (!parts) return null;
  if (parts.length === 2 && parts[0] === "Actor") return parts;
  if (parts.length === 6 && parts[0] === "Scene" && parts[2] === "Token" && parts[4] === "Actor") {
    return parts;
  }
  return null;
}

function isExactChildUuid(value, parentParts, documentType) {
  const parts = uuidParts(value);
  return Boolean(
    parts
    && parts.length === parentParts.length + 2
    && parts.slice(0, parentParts.length).every((part, index) => part === parentParts[index])
    && parts.at(-2) === documentType
  );
}

function senderOwnsActor(actor, sender) {
  if (sender?.isGM === true) return true;
  if (!actor || !sender) return false;
  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(sender, "OWNER");
  }
  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[sender.id] ?? 0) >= 3 || Number(ownership.default ?? 0) >= 3;
}

async function resolveActor(actorUuid, { fromUuid } = {}) {
  const resolver = fromUuid ?? globalThis.fromUuid;
  if (typeof resolver !== "function") return null;
  const actor = await resolver(actorUuid);
  return actor?.uuid === actorUuid ? actor : null;
}

export function isValidSpellInstanceMutationPayload(payload) {
  if (payload?.action === "claim-operation") {
    return validClaim(payload) && Boolean(parseActorUuid(payload.actorUuid));
  }
  if (!validBase(payload)) return false;
  const actorParts = parseActorUuid(payload.actorUuid);
  if (!actorParts) return false;

  if (payload.action === "create") {
    const itemParts = actorParts && uuidParts(payload.sourceItemUuid);
    return Boolean(payload.expectedRevision === 0
      && exactKeys(payload, [
        "action", "actorUuid", "concentrationEffectUuid", "declaration", "expectedRevision",
        "instanceId", "operationId", "sourceActivityUuid", "sourceItemUuid", "state"
      ])
      && actorParts
      && isExactChildUuid(payload.concentrationEffectUuid, actorParts, "ActiveEffect")
      && isExactChildUuid(payload.sourceItemUuid, actorParts, "Item")
      && itemParts
      && isExactChildUuid(payload.sourceActivityUuid, itemParts, "Activity")
      && isPlainObject(payload.state)
      && isSerializable(payload.state));
  }
  if (payload.action === "replace-state") {
    return exactKeys(payload, [
      "action", "actorUuid", "declaration", "expectedRevision", "instanceId", "operationId", "state"
    ]) && isPlainObject(payload.state) && isSerializable(payload.state);
  }
  return exactKeys(payload, [
    "action", "actorUuid", "declaration", "expectedRevision", "instanceId", "operationId"
  ]);
}

export function registerSpellInstanceSocketCommand(moduleApi, options = {}) {
  const commandBus = moduleApi?.socketCommandBus;
  const runtime = moduleApi?.spellInstanceRuntime;
  if (typeof commandBus?.register !== "function" || typeof runtime?.executeAuthoritativeMutation !== "function") {
    return false;
  }

  commandBus.register(SPELL_INSTANCE_MUTATION_COMMAND, {
    validate: isValidSpellInstanceMutationPayload,
    authorize: async (payload, { sender } = {}) => senderOwnsActor(
      await resolveActor(payload.actorUuid, options),
      sender
    ),
    execute: async (payload, { sender } = {}) => {
      const actor = await resolveActor(payload.actorUuid, options);
      if (!senderOwnsActor(actor, sender)) {
        throw new Error("Spell instance mutation is not authorized.");
      }
      return runtime.executeAuthoritativeMutation(payload, { actor });
    }
  });
  return true;
}
