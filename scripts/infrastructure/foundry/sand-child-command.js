import { aggregateKey, keyedMutationScheduling } from "../../application/socket-command-scheduling.js?v=1.5.3";

const tokenUuid = value => typeof value === "string" && /^Scene\.[\w-]{1,64}\.Token\.[\w-]{1,64}$/u.test(value);
const itemUuid = value => typeof value === "string" && /^(?:Actor\.[\w-]{1,64}|Scene\.[\w-]{1,64}\.Token\.[\w-]{1,64}\.Actor\.[\w-]{1,64})\.Item\.[\w-]{1,64}$/u.test(value);
const identifier = value => typeof value === "string" && /^[\w-]{1,96}$/u.test(value);
const cell = value => Number.isSafeInteger(value) && Math.abs(value) <= 100000;

export function registerSandChildCommands(gateway, service) {
  const operations = {
    activate: { itemUuid, messageId: identifier, method: "activate" },
    end: { effectId: identifier, method: "endManifestation" },
    place: { movementId: identifier, row: cell, col: cell, method: "placeSand" },
    placeManual: { effectId: identifier, row: cell, col: cell, method: "placeManualSand" },
    absorb: { tileId: identifier, method: "absorbSand" }
  };
  for (const [operation, { method, ...fields }] of Object.entries(operations)) {
    const shape = Object.entries({ tokenUuid, ...fields });
    gateway.registerCommand(`combat.sandChild.${operation}`, {
      validate: payload => Boolean(payload && typeof payload === "object" && Object.keys(payload).length === shape.length
        && shape.every(([key, validator]) => Object.hasOwn(payload, key) && validator(payload[key]))),
      authorize: (payload, { sender }) => (operation !== "placeManual" || sender?.isGM === true)
        && service.canControl(payload.tokenUuid, sender),
      scheduling: keyedMutationScheduling(payload => [aggregateKey("sand-child-scene", payload.tokenUuid.split(".")[1])]),
      execute: (payload, context) => service[method](payload, context)
    });
  }
}
