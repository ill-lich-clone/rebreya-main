import { keyedMutationScheduling } from "../../application/socket-command-scheduling.js?v=1.5.3";

export const BARDIC_INSPIRATION_GRANT_COMMAND = "bardic.inspiration.grant";
export const BLADE_FLOURISH_COMMAND = "bardic.blade-flourish";
export const BLADE_FLOURISH_SPEED_COMMAND = "bardic.blade-flourish-speed";
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

export function isValidBladeFlourishRequest(payload) {
  const expected = ["phase", "operationId", "sourceItemUuid", "featureItemUuid", "weaponItemUuid", "sourceTokenUuid", "targetTokenUuid", "secondaryTokenUuid", "combatId", "round", "turn", "mode", "damageType", "useMaster", "actionConfirmed"];
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload)
    && Object.keys(payload).length === expected.length && expected.every(key => Object.hasOwn(payload, key))
    && ["reserve", "commit", "cancel"].includes(payload.phase)
    && typeof payload.operationId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(payload.operationId)
    && typeof payload.sourceItemUuid === "string" && itemUuid.test(payload.sourceItemUuid)
    && typeof payload.featureItemUuid === "string" && itemUuid.test(payload.featureItemUuid)
    && typeof payload.weaponItemUuid === "string" && itemUuid.test(payload.weaponItemUuid)
    && payload.sourceItemUuid.split(".Item.")[0] === payload.featureItemUuid.split(".Item.")[0]
    && payload.sourceItemUuid.split(".Item.")[0] === payload.weaponItemUuid.split(".Item.")[0]
    && typeof payload.sourceTokenUuid === "string" && tokenUuid.test(payload.sourceTokenUuid)
    && typeof payload.targetTokenUuid === "string" && tokenUuid.test(payload.targetTokenUuid)
    && payload.secondaryTokenUuid === ""
    && typeof payload.combatId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(payload.combatId)
    && Number.isSafeInteger(payload.round) && payload.round >= 0
    && Number.isSafeInteger(payload.turn) && payload.turn >= 0
    && ["defensive", "mobile", "slashing"].includes(payload.mode)
    && typeof payload.damageType === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(payload.damageType)
    && typeof payload.useMaster === "boolean" && payload.actionConfirmed === true);
}

export function isValidBladeFlourishSpeedRequest(payload) {
  const expected = ["operationId", "featureItemUuid", "weaponItemUuid", "sourceTokenUuid", "combatId", "round", "turn", "actionConfirmed"];
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload)
    && Object.keys(payload).length === expected.length && expected.every(key => Object.hasOwn(payload, key))
    && typeof payload.operationId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(payload.operationId)
    && typeof payload.featureItemUuid === "string" && itemUuid.test(payload.featureItemUuid)
    && typeof payload.weaponItemUuid === "string" && itemUuid.test(payload.weaponItemUuid)
    && payload.featureItemUuid.split(".Item.")[0] === payload.weaponItemUuid.split(".Item.")[0]
    && typeof payload.sourceTokenUuid === "string" && tokenUuid.test(payload.sourceTokenUuid)
    && typeof payload.combatId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(payload.combatId)
    && Number.isSafeInteger(payload.round) && payload.round >= 0 && Number.isSafeInteger(payload.turn) && payload.turn >= 0
    && payload.actionConfirmed === true);
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

export function registerBladeFlourishCommand(commandBus, service) {
  commandBus.register(BLADE_FLOURISH_COMMAND, {
    validate: isValidBladeFlourishRequest,
    authorize: (payload, context) => service.canUseBladeFlourish(payload, context),
    scheduling: keyedMutationScheduling(payload => [
      `document:${payload.sourceItemUuid}`, `document:${payload.featureItemUuid}`,
      ...[payload.sourceTokenUuid, payload.targetTokenUuid, payload.secondaryTokenUuid].filter(Boolean).map(uuid => `document:${uuid}`)
    ]),
    execute: (payload, context) => {
      const { phase, ...request } = payload;
      const method = { reserve: "reserveBladeFlourish", commit: "commitBladeFlourish", cancel: "cancelBladeFlourish" }[phase];
      return service[method](request, context);
    }
  });
}

export function registerBladeFlourishSpeedCommand(commandBus, service) {
  commandBus.register(BLADE_FLOURISH_SPEED_COMMAND, {
    validate: isValidBladeFlourishSpeedRequest,
    authorize: (payload, context) => service.canGrantBladeFlourishSpeed(payload, context),
    scheduling: keyedMutationScheduling(payload => [`document:${payload.featureItemUuid}`, `document:${payload.weaponItemUuid}`]),
    execute: (payload, context) => service.grantBladeFlourishSpeed(payload, context)
  });
}
