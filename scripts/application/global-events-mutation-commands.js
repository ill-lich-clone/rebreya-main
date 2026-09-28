export const GLOBAL_EVENTS_CREATE_COMMAND = "global-events.create";
export const GLOBAL_EVENTS_UPDATE_COMMAND = "global-events.update";
export const GLOBAL_EVENTS_DELETE_COMMAND = "global-events.delete";
export const GLOBAL_EVENTS_DUPLICATE_COMMAND = "global-events.duplicate";
export const GLOBAL_EVENTS_IMPORT_DEFAULTS_COMMAND = "global-events.import-defaults";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeSerializable(value) {
  if (value == null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isSafeSerializable);
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => (
    !DANGEROUS_KEYS.has(key) && isSafeSerializable(value[key])
  ));
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return actualKeys.length === sortedExpected.length
    && actualKeys.every((key, index) => key === sortedExpected[index]);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidGlobalEventsCreatePayload(payload) {
  return hasExactKeys(payload, ["data"])
    && isPlainObject(payload.data)
    && isSafeSerializable(payload.data);
}

export function isValidGlobalEventsUpdatePayload(payload) {
  return hasExactKeys(payload, ["eventId", "patch"])
    && isNonEmptyString(payload.eventId)
    && isPlainObject(payload.patch)
    && isSafeSerializable(payload.patch);
}

export function isValidGlobalEventsDeletePayload(payload) {
  return hasExactKeys(payload, ["eventId"])
    && isNonEmptyString(payload.eventId);
}

export function isValidGlobalEventsDuplicatePayload(payload) {
  return hasExactKeys(payload, ["eventId"])
    && isNonEmptyString(payload.eventId);
}

export function isValidGlobalEventsImportDefaultsPayload(payload) {
  return hasExactKeys(payload, []);
}
