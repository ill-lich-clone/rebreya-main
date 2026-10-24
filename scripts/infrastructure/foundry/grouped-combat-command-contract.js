import { keyedMutationScheduling } from "../../application/socket-command-scheduling.js?v=1.5.3";
const text = (value, maximum = 128) => typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.trim();
const exact = (value, keys) => value && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
export function isValidGroupedCombatStartPayload(value) {
  return Boolean(exact(value, ["sceneId", "tokenUuids", "operationId"]) && text(value.sceneId) && text(value.operationId) && Array.isArray(value.tokenUuids)
    && value.tokenUuids.length > 0 && new Set(value.tokenUuids).size === value.tokenUuids.length
    && value.tokenUuids.every(uuid => text(uuid, 512) && /^Scene\.[^.]+\.Token\.[^.]+$/u.test(uuid) && uuid.split(".")[1] === value.sceneId));
}
export function isValidGroupedCombatTransitionPayload(value) {
  return Boolean(exact(value, ["combatId", "expectedRevision", "targetRound", "targetGroupId", "operationId"]) && text(value.combatId) && text(value.operationId)
    && text(value.targetGroupId) && integer(value.expectedRevision) && integer(value.targetRound));
}
export function isValidGroupedCombatResolvePayload(value) {
  return Boolean(exact(value, ["combatId", "expectedRevision", "stepKey", "resolution", "operationId"]) && text(value.combatId) && text(value.operationId)
    && text(value.stepKey, 2048) && integer(value.expectedRevision) && ["completed", "retry"].includes(value.resolution));
}
export function registerGroupedCombatCommands(moduleApi) {
  const service = moduleApi.groupedCombatService;
  for (const [name, validate, method, gmOnly] of [
    ["start", isValidGroupedCombatStartPayload, "start", true], ["transition", isValidGroupedCombatTransitionPayload, "transition", false],
    ["resolve", isValidGroupedCombatResolvePayload, "resolveUncertainStep", true]
  ]) moduleApi.socketCommandBus.register(`combat.grouped.${name}`, {
    validate, authorize: (_payload, { sender }) => Boolean(sender && (!gmOnly || sender.isGM)),
    scheduling: keyedMutationScheduling(payload => [`grouped-ingress:${payload.combatId ?? payload.sceneId}`]),
    execute: (payload, { sender }) => service[method](payload, { sender })
  });
}
