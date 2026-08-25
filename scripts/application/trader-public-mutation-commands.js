export const TRADER_AUDIT_RECORD_COMMAND = "trader.audit.record";
export const TRADER_METADATA_UPDATE_COMMAND = "trader.metadata.update";

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

export function isValidTraderAuditRecordPayload(payload) {
  return hasExactKeys(payload, ["operation"])
    && isPlainObject(payload.operation)
    && isNonEmptyString(payload.operation.actorId)
    && isSafeSerializable(payload);
}

export function isValidTraderMetadataUpdatePayload(payload) {
  if (
    !hasExactKeys(payload, ["cityId", "patch", "traderKey"])
    || !isNonEmptyString(payload.cityId)
    || !isNonEmptyString(payload.traderKey)
    || !isPlainObject(payload.patch)
    || !isSafeSerializable(payload)
  ) return false;

  const patchKeys = Object.keys(payload.patch);
  return patchKeys.length > 0
    && patchKeys.every((key) => key === "portrait" || key === "description")
    && patchKeys.every((key) => typeof payload.patch[key] === "string");
}
