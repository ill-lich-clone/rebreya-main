export const ECONOMY_CITY_PRESENTATION_UPDATE_COMMAND = "economy.city-presentation.update";
export const ECONOMY_CONNECTION_SET_ACTIVE_COMMAND = "economy.connection.set-active";
export const ECONOMY_REFERENCE_UPDATE_DESCRIPTION_COMMAND = "economy.reference.update-description";
export const ECONOMY_TRADE_ROUTE_UPDATE_METADATA_COMMAND = "economy.trade-route.update-metadata";
export const ECONOMY_STATE_POLICY_UPDATE_COMMAND = "economy.state-policy.update";
export const ECONOMY_WORLD_DATA_RESET_COMMAND = "economy.world-data.reset";

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

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function isValidEconomyCityPresentationUpdatePayload(payload) {
  if (
    !hasExactKeys(payload, ["cityId", "patch"])
    || !isNonEmptyString(payload.cityId)
    || !isPlainObject(payload.patch)
    || !isSafeSerializable(payload)
  ) return false;
  const keys = Object.keys(payload.patch);
  return keys.length > 0 && keys.every((key) => key === "description" || key === "image")
    && keys.every((key) => payload.patch[key] === null || typeof payload.patch[key] === "string");
}
export function isValidEconomyConnectionSetActivePayload(payload) {
  return hasExactKeys(payload, ["connectionId", "isActive"])
    && isNonEmptyString(payload.connectionId)
    && typeof payload.isActive === "boolean"
    && isSafeSerializable(payload);
}
export function isValidEconomyReferenceUpdateDescriptionPayload(payload) {
  return hasExactKeys(payload, ["description", "entryId", "entryType"])
    && isNonEmptyString(payload.entryType)
    && isNonEmptyString(payload.entryId)
    && typeof payload.description === "string"
    && isSafeSerializable(payload);
}
export function isValidEconomyTradeRouteUpdateMetadataPayload(payload) {
  if (
    !hasExactKeys(payload, ["connectionId", "patch"])
    || !isNonEmptyString(payload.connectionId)
    || !isPlainObject(payload.patch)
    || !isSafeSerializable(payload)
  ) return false;
  const keys = Object.keys(payload.patch);
  return keys.length > 0 && keys.every((key) => key === "description" || key === "additionalPricePercent")
    && (!Object.hasOwn(payload.patch, "description") || typeof payload.patch.description === "string")
    && (!Object.hasOwn(payload.patch, "additionalPricePercent") || isFiniteNumber(payload.patch.additionalPricePercent));
}
export function isValidEconomyStatePolicyUpdatePayload(payload) {
  if (
    !hasExactKeys(payload, ["patch", "stateId"])
    || !isNonEmptyString(payload.stateId)
    || !isPlainObject(payload.patch)
    || !isSafeSerializable(payload)
  ) return false;
  const keys = Object.keys(payload.patch);
  return keys.length > 0 && keys.every((key) => ["taxPercent", "generalDutyPercent", "bilateralDuties"].includes(key))
    && (!Object.hasOwn(payload.patch, "taxPercent") || isFiniteNumber(payload.patch.taxPercent))
    && (!Object.hasOwn(payload.patch, "generalDutyPercent") || isFiniteNumber(payload.patch.generalDutyPercent))
    && (!Object.hasOwn(payload.patch, "bilateralDuties") || (
      isPlainObject(payload.patch.bilateralDuties)
      && Object.values(payload.patch.bilateralDuties).every(isFiniteNumber)
    ));
}
export function isValidEconomyWorldDataResetPayload(payload) {
  return hasExactKeys(payload, []) && isSafeSerializable(payload);
}
