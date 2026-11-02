import { keyedMutationScheduling } from "../../application/socket-command-scheduling.js?v=1.5.3";

export const MOUNTED_TOGGLE_COMMAND = "combat.mounted.toggle";
export const MOUNTED_CHARGE_DAMAGE_COMMAND = "combat.mounted-charge.damage";
const tokenUuid = /^Scene\.[A-Za-z0-9_-]{1,64}\.Token\.[A-Za-z0-9_-]{1,64}$/u;
export function isValidMountedToggle(payload) {
  const keys = ["operationId", "riderTokenUuid", "mountTokenUuid", "action"];
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload)
    && Object.keys(payload).length === keys.length && keys.every(key => Object.hasOwn(payload, key))
    && typeof payload.operationId === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(payload.operationId)
    && typeof payload.riderTokenUuid === "string" && tokenUuid.test(payload.riderTokenUuid)
    && typeof payload.mountTokenUuid === "string" && tokenUuid.test(payload.mountTokenUuid)
    && payload.riderTokenUuid !== payload.mountTokenUuid && ["mount", "dismount"].includes(payload.action));
}
export function registerMountedToggleCommand(commandBus, service) {
  commandBus.register(MOUNTED_TOGGLE_COMMAND, {
    validate: isValidMountedToggle,
    authorize: (payload, context) => service.canToggleMounted(payload, context),
    scheduling: keyedMutationScheduling(payload => [`document:${payload.riderTokenUuid}`, `document:${payload.mountTokenUuid}`]),
    execute: (payload, context) => service.toggleMounted(payload, context)
  });
}

export function isValidMountedChargeDamage(payload) {
  const keys = ["operationId", "riderTokenUuid", "targetTokenUuid", "weaponItemUuid", "combatId", "round", "turn"];
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload)
    && Object.keys(payload).length === keys.length && keys.every(key => Object.hasOwn(payload, key))
    && typeof payload.operationId === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(payload.operationId)
    && typeof payload.riderTokenUuid === "string" && tokenUuid.test(payload.riderTokenUuid)
    && typeof payload.targetTokenUuid === "string" && tokenUuid.test(payload.targetTokenUuid)
    && payload.riderTokenUuid !== payload.targetTokenUuid
    && typeof payload.weaponItemUuid === "string" && /^(?:Actor\.[A-Za-z0-9_-]{1,64}|Scene\.[A-Za-z0-9_-]{1,64}\.Token\.[A-Za-z0-9_-]{1,64}\.Actor\.[A-Za-z0-9_-]{1,64})\.Item\.[A-Za-z0-9_-]{1,64}$/u.test(payload.weaponItemUuid)
    && typeof payload.combatId === "string" && /^(?:[A-Za-z0-9_-]{1,64})?$/u.test(payload.combatId)
    && Number.isSafeInteger(payload.round) && payload.round >= 0 && Number.isSafeInteger(payload.turn) && payload.turn >= 0);
}

export function registerMountedChargeDamageCommand(commandBus, service) {
  commandBus.register(MOUNTED_CHARGE_DAMAGE_COMMAND, {
    validate: isValidMountedChargeDamage,
    authorize: (payload, context) => service.canReserveMountedChargeDamage(payload, context),
    scheduling: keyedMutationScheduling(payload => [`document:${payload.riderTokenUuid}`, `document:${payload.targetTokenUuid}`, `document:${payload.weaponItemUuid}`]),
    execute: (payload, context) => service.reserveMountedChargeDamage(payload, context)
  });
}
