import { aggregateKey, keyedMutationScheduling } from "../application/socket-command-scheduling.js?v=1.5.3";

export const ALCHEMY_REAGENT_COMMAND = "alchemy-reagent.apply";
export const ALCHEMY_REAGENT_RESERVE_COMMAND = "alchemy-reagent.reserve";
export const ALCHEMY_REAGENT_CANCEL_COMMAND = "alchemy-reagent.cancel";
const registered = new WeakSet();

const RESERVATION_KEYS = ["operationId", "sourceActorUuid", "sourceItemId", "targetActorUuid", "targetTokenUuid",
  "productId", "durationSeconds", "reagentLevel"];
const ID_PATTERN = /^[a-zA-Z0-9]{1,64}$/u;
const ACTOR_UUID_PATTERN = /^(?:Actor\.[a-zA-Z0-9]+|Scene\.[a-zA-Z0-9]+\.Token\.[a-zA-Z0-9]+\.Actor\.[a-zA-Z0-9]+)$/u;
const safeId = (value) => typeof value === "string" && ID_PATTERN.test(value)
  && value !== "constructor" && value !== "prototype";

function validReservation(payload) {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload)
    && Object.keys(payload).length === RESERVATION_KEYS.length && Object.keys(payload).every((key) => RESERVATION_KEYS.includes(key))
    && safeId(payload.operationId) && safeId(payload.sourceItemId)
    && ACTOR_UUID_PATTERN.test(payload.sourceActorUuid) && ACTOR_UUID_PATTERN.test(payload.targetActorUuid)
    && /^Scene\.[a-zA-Z0-9]+\.Token\.[a-zA-Z0-9]+$/u.test(payload.targetTokenUuid)
    && /^alchemy-\d{1,3}$/u.test(payload.productId)
    && Number.isInteger(payload.durationSeconds) && payload.durationSeconds > 0 && payload.durationSeconds <= 86400
    && Number.isInteger(payload.reagentLevel) && payload.reagentLevel >= 0 && payload.reagentLevel <= 1000);
}

export function registerAlchemyReagentSocketCommand(gateway, service, { fromUuid = globalThis.fromUuid } = {}) {
  if (!gateway?.registerCommand || !service?.applyRecordedUse || typeof fromUuid !== "function") return false;
  if (registered.has(gateway)) return true;
  const resolve = async (payload) => {
    const message = await fromUuid(payload.messageUuid);
    return message?.uuid === payload.messageUuid ? message : null;
  };
  gateway.registerCommand(ALCHEMY_REAGENT_RESERVE_COMMAND, {
    validate: validReservation,
    authorize: (payload, { sender }) => service.authorizeReservation(payload, sender),
    scheduling: keyedMutationScheduling((payload) => [aggregateKey("actor", payload.sourceActorUuid)]),
    execute: (payload, { sender }) => service.reserveUse(payload, { sender })
  });
  gateway.registerCommand(ALCHEMY_REAGENT_CANCEL_COMMAND, {
    validate: (payload) => Boolean(payload && typeof payload === "object" && !Array.isArray(payload)
      && Object.keys(payload).length === 1 && safeId(payload.operationId)),
    authorize: (payload, { sender }) => service.canCancelReservation(payload.operationId, sender),
    scheduling: keyedMutationScheduling((payload) => [aggregateKey("alchemy-reservation", payload.operationId)]),
    execute: (payload, { sender }) => service.cancelReservation(payload.operationId, { sender })
  });
  gateway.registerCommand(ALCHEMY_REAGENT_COMMAND, {
    validate: (payload) => Boolean(payload && typeof payload === "object" && !Array.isArray(payload)
      && Object.keys(payload).length === 1 && /^ChatMessage\.[a-zA-Z0-9]{1,64}$/u.test(payload.messageUuid)),
    authorize: async (payload, { sender }) => service.authorizeRecordedUse(await resolve(payload), sender),
    scheduling: keyedMutationScheduling((payload) => [aggregateKey("alchemy-reagent", payload.messageUuid)]),
    execute: async (payload, { sender }) => service.applyRecordedUse(await resolve(payload), { sender })
  });
  registered.add(gateway);
  return true;
}
