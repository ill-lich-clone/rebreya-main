export const SPELL_INSTANCE_MUTATION_COMMAND = "spell-instance-mutation";

const ACTIONS = new Set(["create", "replace-state", "delete"]);

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
  const values = Array.isArray(value) ? value : isPlainObject(value) ? Object.values(value) : null;
  return values !== null && values.every((entry) => isSerializable(entry, seen));
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
  return exactKeys(value, ["recipe", "version"])
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

function isActorDocumentUuid(value, actorUuid, documentType) {
  return nonEmptyString(value) && value.startsWith(`${actorUuid}.${documentType}.`);
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
  if (!validBase(payload)) return false;

  if (payload.action === "create") {
    return payload.expectedRevision === 0
      && exactKeys(payload, [
        "action", "actorUuid", "concentrationEffectUuid", "declaration", "expectedRevision",
        "instanceId", "operationId", "sourceActivityUuid", "sourceItemUuid", "state"
      ])
      && isActorDocumentUuid(payload.concentrationEffectUuid, payload.actorUuid, "ActiveEffect")
      && isActorDocumentUuid(payload.sourceItemUuid, payload.actorUuid, "Item")
      && payload.sourceActivityUuid.startsWith(`${payload.sourceItemUuid}.Activity.`)
      && isPlainObject(payload.state)
      && isSerializable(payload.state);
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
