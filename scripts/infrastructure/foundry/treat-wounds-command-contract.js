const exact = (p, keys) => p && typeof p === "object" && !Array.isArray(p)
  && [Object.prototype, null].includes(Object.getPrototypeOf(p)) && Object.keys(p).length === keys.length && keys.every(k => Object.hasOwn(p, k));
const id = value => typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value && /^[\w:-]+$/u.test(value);
const token = value => typeof value === "string" && /^Scene\.[A-Za-z0-9]{16}\.Token\.[A-Za-z0-9]{16}$/u.test(value);
const item = value => typeof value === "string" && /^(?:Scene\.[A-Za-z0-9]{16}\.Token\.[A-Za-z0-9]{16}\.)?Actor\.[A-Za-z0-9]{16}\.Item\.[A-Za-z0-9]{16}$/u.test(value);
export const TREAT_WOUNDS_ACTIONS = ["preview", "start", "continue", "resume"];
export function isValidTreatWoundsPayload(action, p) {
  if (action === "preview") return exact(p, ["sourceTokenUuid", "targetTokenUuid"]) && token(p.sourceTokenUuid) && token(p.targetTokenUuid);
  if (!id(p?.operationId)) return false;
  if (["continue", "resume"].includes(action)) return exact(p, ["operationId"]);
  const keys = ["operationId", "sourceTokenUuid", "targetTokenUuid", "kitItemUuid", "groupActorId", "tierDc", "customDc"];
  const hasFlag = Object.hasOwn(p, "ignoreMissingKit");
  return action === "start" && exact(p, hasFlag ? [...keys, "ignoreMissingKit"] : keys)
    && (!hasFlag || typeof p.ignoreMissingKit === "boolean")
    && token(p.sourceTokenUuid) && token(p.targetTokenUuid)
    && (item(p.kitItemUuid) || (p.ignoreMissingKit === true && p.kitItemUuid === "" && p.groupActorId === ""))
    && (p.groupActorId === "" || /^[A-Za-z0-9]{16}$/u.test(p.groupActorId))
    && [10, 15, 20, 25].includes(p.tierDc) && (p.customDc === null || (Number.isInteger(p.customDc) && p.customDc >= 1 && p.customDc <= 99));
}
export function authorizeTreatWoundsSender(action, payload, { sender, game = globalThis.game } = {}) {
  return Boolean(sender?.id && game?.users?.get(sender.id) === sender
    && (action !== "start" || payload.customDc === null || sender.isGM === true));
}
