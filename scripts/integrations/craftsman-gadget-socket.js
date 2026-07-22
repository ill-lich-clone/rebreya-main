import { CRAFTSMAN_GADGET_IDS } from "../data/craftsman-gadget-definitions.js";

export const CRAFTSMAN_GADGET_MUTATION_COMMAND = "craftsman.gadget.mutate";

const GADGET_IDS = new Set(Object.values(CRAFTSMAN_GADGET_IDS));
const OPERATIONS = new Set(["activate", "action"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringValue(value) {
  return typeof value === "string";
}

function isUsePayload(payload) {
  return Boolean(
    payload?.kind === "use"
    && nonEmptyString(payload.actorUuid)
    && nonEmptyString(payload.itemId)
    && GADGET_IDS.has(payload.gadgetId)
    && OPERATIONS.has(payload.operation)
    && nonEmptyString(payload.expectedInstanceId)
    && stringValue(payload.expectedActiveInstanceId)
    && stringValue(payload.expectedRestGeneration)
    && Array.isArray(payload.templateUuids)
    && payload.templateUuids.length <= 4
    && payload.templateUuids.every(nonEmptyString)
  );
}

export function isValidCraftsmanGadgetMutationPayload(payload) {
  return isUsePayload(payload);
}

async function resolveActor(actorUuid, options = {}) {
  const resolver = options.fromUuid ?? globalThis.fromUuid;
  if (typeof resolver === "function") {
    const document = await resolver(actorUuid);
    if (document) return document;
  }
  const actorId = String(actorUuid).split(".").at(-1);
  return options.game?.actors?.get?.(actorId)
    ?? globalThis.game?.actors?.get?.(actorId)
    ?? null;
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

export function registerCraftsmanGadgetSocketCommand(moduleApi, options = {}) {
  const commandBus = moduleApi?.socketCommandBus;
  const service = moduleApi?.craftsmanGadgetService;
  if (typeof commandBus?.register !== "function" || typeof service?.executeAuthoritativeMutation !== "function") {
    return false;
  }

  commandBus.register(CRAFTSMAN_GADGET_MUTATION_COMMAND, {
    validate: isValidCraftsmanGadgetMutationPayload,
    authorize: async (payload, { sender } = {}) => senderOwnsActor(
      await resolveActor(payload.actorUuid, options),
      sender
    ),
    execute: (payload) => service.executeAuthoritativeMutation(payload)
  });
  return true;
}
