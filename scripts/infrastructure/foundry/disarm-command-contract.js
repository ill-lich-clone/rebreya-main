const id = value => typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value;
const token = value => typeof value === "string" && /^Scene\.[A-Za-z0-9]{16}\.Token\.[A-Za-z0-9]{16}$/u.test(value);
const item = value => typeof value === "string" && /^(?:Scene\.[A-Za-z0-9]{16}\.Token\.[A-Za-z0-9]{16}\.)?Actor\.[A-Za-z0-9]{16}\.Item\.[A-Za-z0-9]{16}$/u.test(value);
const exact = (p, keys) => p && typeof p === "object" && !Array.isArray(p)
  && [Object.prototype, null].includes(Object.getPrototypeOf(p)) && Object.keys(p).length === keys.length && keys.every(k => Object.hasOwn(p, k));
export const DISARM_ACTIONS = ["preview", "start", "resolve-save", "set-baseline", "reassign-responder", "resume", "cancel"];
export function isValidDisarmPayload(action, payload) {
  if (action === "preview") return exact(payload, ["sourceTokenUuid", "targetTokenUuid"]) && token(payload.sourceTokenUuid) && token(payload.targetTokenUuid);
  if (!id(payload?.operationId)) return false;
  if (action === "start") return exact(payload, ["operationId", "sourceTokenUuid", "targetTokenUuid", "weaponItemUuid", "targetItemUuid", "weaponMode"])
    && token(payload.sourceTokenUuid) && token(payload.targetTokenUuid) && item(payload.weaponItemUuid) && item(payload.targetItemUuid) && ["melee", "ranged", "thrown"].includes(payload.weaponMode);
  if (action === "resolve-save") return exact(payload, ["operationId", "saveAbility"]) && ["str", "dex"].includes(payload.saveAbility);
  if (action === "reassign-responder") return exact(payload, ["operationId", "expectedResponderRevision", "responderUserId", "reason"])
    && Number.isSafeInteger(payload.expectedResponderRevision) && payload.expectedResponderRevision >= 0 && id(payload.responderUserId)
    && typeof payload.reason === "string" && payload.reason.trim().length > 0 && payload.reason.length <= 240;
  if (action === "set-baseline") return exact(payload, ["operationId", "abilityScore", "proficiencyContribution", "reason"])
    && Number.isInteger(payload.abilityScore) && payload.abilityScore >= 1 && payload.abilityScore <= 99
    && Number.isInteger(payload.proficiencyContribution) && payload.proficiencyContribution >= 0 && payload.proficiencyContribution <= 30
    && typeof payload.reason === "string" && payload.reason.trim().length > 0 && payload.reason.length <= 240;
  return ["resume", "cancel"].includes(action) && exact(payload, ["operationId"]);
}
export function authorizeDisarmSender(action, { sender, game = globalThis.game } = {}) {
  return Boolean(sender?.id && game?.users?.get(sender.id) === sender && (!["set-baseline", "reassign-responder"].includes(action) || sender.isGM === true));
}
