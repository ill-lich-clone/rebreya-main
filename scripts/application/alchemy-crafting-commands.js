import { EXCLUSIVE_MUTATION_SCHEDULING } from "./socket-command-scheduling.js?v=1.5.3";

const id = (value) => typeof value === "string" && /^[\w:-]{1,128}$/u.test(value)
  && !["__proto__", "constructor", "prototype"].includes(value);
const own = (value, keys, required = keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).every((key) => keys.includes(key)) && required.every((key) => Object.hasOwn(value, key));
const index = (value) => Number.isSafeInteger(value) && value >= 0;
const scope = (value) => id(value.groupId) && id(value.actorId) && id(value.operationId);

function validSelection(selection) {
  const keys = ["items", "optionIndex", "ability", "catalystIndex", "manualWeeks", "manualGoldGp"];
  return own(selection, keys, ["items", "optionIndex"])
    && index(selection.optionIndex)
    && (selection.catalystIndex === undefined || index(selection.catalystIndex))
    && (selection.ability === undefined || ["int", "wis"].includes(selection.ability))
    && (selection.manualWeeks === undefined || Number.isSafeInteger(selection.manualWeeks) && selection.manualWeeks > 0)
    && (selection.manualGoldGp === undefined || Number.isFinite(selection.manualGoldGp) && selection.manualGoldGp >= 0)
    && Array.isArray(selection.items) && selection.items.length <= 100
    && selection.items.every((row) => own(row, ["actorId", "itemId", "quantity", "role"])
      && id(row.actorId) && id(row.itemId) && Number.isFinite(row.quantity) && row.quantity > 0
      && ["base", "aspect", "component", "catalyst"].includes(row.role));
}

export function isValidAlchemyCraftIntent(value) {
  return own(value, ["groupId", "actorId", "operationId", "productId", "selection"])
    && scope(value) && /^alchemy-\d{1,3}$/u.test(value.productId) && validSelection(value.selection);
}

const fieldScope = ["groupId", "actorId", "operationId"];
const actions = {
  prepareField: isValidAlchemyCraftIntent,
  submitLaboratory: isValidAlchemyCraftIntent,
  cancelField: (value) => own(value, fieldScope) && scope(value),
  completeField: (value) => own(value, [...fieldScope, "restMessageUuid"]) && scope(value)
    && /^ChatMessage\.[A-Za-z0-9]{1,64}$/u.test(value.restMessageUuid)
};

export const alchemyCraftCommand = (action) => `alchemy-craft.${action}`;

export function registerAlchemyCraftingCommands(gateway, service) {
  for (const [action, validate] of Object.entries(actions)) {
    gateway.registerCommand(alchemyCraftCommand(action), {
      validate,
      authorize: (payload, { sender }) => service.authorize(payload, sender),
      scheduling: EXCLUSIVE_MUTATION_SCHEDULING,
      execute: (payload, execution) => service[action](payload, execution)
    });
  }
}
