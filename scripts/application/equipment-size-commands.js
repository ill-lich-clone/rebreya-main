import { isEquipmentSize } from "../data/equipment-size-rules.js?v=1.4.393";
import { aggregateKey, keyedMutationScheduling } from "./socket-command-scheduling.js?v=1.5.3";

const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = value => typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
export function isValidCreatureResizePayload(p) {
  return Boolean(exact(p, ["actorUuid", "tokenUuid", "size", "weaponIds", "expected"])
    && text(p.actorUuid) && text(p.tokenUuid) && isEquipmentSize(p.size)
    && Array.isArray(p.weaponIds) && p.weaponIds.length <= 64 && p.weaponIds.every(text) && new Set(p.weaponIds).size === p.weaponIds.length
    && exact(p.expected, ["actorSize", "token", "weapons"]) && isEquipmentSize(p.expected.actorSize)
    && exact(p.expected.token, ["x", "y", "width", "height"]) && Object.values(p.expected.token).every(Number.isFinite)
    && p.expected.token.width > 0 && p.expected.token.height > 0
    && Array.isArray(p.expected.weapons) && p.expected.weapons.length <= 64
    && new Set(p.expected.weapons.map(row => row?.id)).size === p.expected.weapons.length
    && p.expected.weapons.every(row => exact(row, ["id", "signature"]) && text(row.id) && /^[a-f0-9]{64}$/u.test(row.signature))
    && p.weaponIds.every(id => p.expected.weapons.some(row => row.id === id)));
}

export function registerEquipmentSizeCommands(moduleApi, bus) {
  bus.register("equipment.resize-creature", {
    validate: isValidCreatureResizePayload,
    authorize: (payload, { sender }) => moduleApi.equipmentSizeService.authorizeCreatureResize(payload, sender),
    scheduling: keyedMutationScheduling(payload => [aggregateKey("actor", payload.actorUuid)]),
    execute: async (payload, { sender, assertActiveGm }) => {
      await assertActiveGm();
      return moduleApi.equipmentSizeService.resizeCreature(payload, { senderUserId: sender.id, assertAuthority: assertActiveGm });
    }
  });
}
