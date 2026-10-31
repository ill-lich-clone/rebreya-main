import { keyedMutationScheduling } from "../../application/socket-command-scheduling.js?v=1.5.3";

export const BARDIC_INSPIRATION_GRANT_COMMAND = "bardic.inspiration.grant";
const id = "[A-Za-z0-9_-]{1,64}";
const actor = `(?:Actor\\.${id}|Scene\\.${id}\\.Token\\.${id}\\.Actor\\.${id})`;
const actorUuid = new RegExp(`^${actor}$`);
const itemUuid = new RegExp(`^${actor}\\.Item\\.${id}$`);
const tokenUuid = new RegExp(`^Scene\\.${id}\\.Token\\.${id}$`);
const keys = ["operationId", "sourceItemUuid", "activityId", "targetActorUuid", "sourceTokenUuid", "targetTokenUuid"];

export function isValidBardicInspirationGrant(payload) {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload)
    && Object.keys(payload).length === keys.length && keys.every(key => Object.hasOwn(payload, key) && typeof payload[key] === "string")
    && /^[A-Za-z0-9_-]{1,128}$/.test(payload.operationId)
    && /^[A-Za-z0-9_-]{1,64}$/.test(payload.activityId)
    && itemUuid.test(payload.sourceItemUuid) && actorUuid.test(payload.targetActorUuid)
    && (!payload.sourceTokenUuid || tokenUuid.test(payload.sourceTokenUuid))
    && (!payload.targetTokenUuid || tokenUuid.test(payload.targetTokenUuid)));
}

export function registerBardicInspirationCommand(commandBus, service) {
  commandBus.register(BARDIC_INSPIRATION_GRANT_COMMAND, {
    validate: isValidBardicInspirationGrant,
    authorize: (payload, context) => service.canGrantInspiration(payload, context),
    scheduling: keyedMutationScheduling(payload => [
      `document:${payload.sourceItemUuid}`, `document:${payload.targetActorUuid}`,
      `document:ChatMessage.${payload.operationId}`,
      ...[payload.sourceTokenUuid, payload.targetTokenUuid].filter(Boolean).map(uuid => `document:${uuid}`)
    ]),
    execute: (payload, context) => service.grantInspiration(payload, context)
  });
}
