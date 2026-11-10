import { EXCLUSIVE_MUTATION_SCHEDULING } from "./socket-command-scheduling.js?v=1.5.3";

export const ALCHEMY_EXTRACTION_COMMAND = "alchemy-extraction.extract";
const id = (value) => typeof value === "string" && /^[\w:-]{1,128}$/u.test(value)
  && !["__proto__", "prototype", "constructor"].includes(value);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function isValidAlchemyExtractionIntent(value) {
  return Boolean(exact(value, ["groupId", "actorId", "operationId", "ingredients"])
    && id(value.groupId) && id(value.actorId) && id(value.operationId)
    && Array.isArray(value.ingredients) && value.ingredients.length > 0 && value.ingredients.length <= 100
    && value.ingredients.every((row) => exact(row, ["actorId", "itemId", "quantity"])
      && id(row.actorId) && id(row.itemId) && Number.isSafeInteger(row.quantity) && row.quantity > 0));
}

export function registerAlchemyExtractionCommands(gateway, service) {
  gateway.registerCommand(ALCHEMY_EXTRACTION_COMMAND, {
    validate: isValidAlchemyExtractionIntent,
    authorize: (intent, { sender }) => service.craftingService.authorize(intent, sender),
    scheduling: EXCLUSIVE_MUTATION_SCHEDULING,
    execute: (intent, execution) => service.extract(intent, execution)
  });
}
