export const DOWNTIME_WEEKS_GRANT_COMMAND = "downtime.weeks.grant";
export const DOWNTIME_WEEKS_REVOKE_COMMAND = "downtime.weeks.revoke";
export const DOWNTIME_HISTORY_CLEAR_COMMAND = "downtime.history.clear";
export const DOWNTIME_REQUEST_CREATE_COMMAND = "downtime.request.create";
export const DOWNTIME_REQUEST_UPDATE_COMMAND = "downtime.request.update";
export const DOWNTIME_REQUEST_SET_STATUS_COMMAND = "downtime.request.set-status";
export const DOWNTIME_REQUEST_SET_CHECKS_COMMAND = "downtime.request.set-checks";
export const DOWNTIME_REQUEST_RECORD_CHECK_COMMAND = "downtime.request.record-check";
export const DOWNTIME_PROJECT_CONTINUE_COMMAND = "downtime.project.continue";
export const DOWNTIME_PROJECT_CLOSE_COMMAND = "downtime.project.close";

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
  return isPlainObject(value) && Object.keys(value).every((key) => (
    !DANGEROUS_KEYS.has(key) && isSafeSerializable(value[key])
  ));
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isString(value) {
  return typeof value === "string";
}

function isId(value) {
  return isString(value) && value.trim().length > 0 && value === value.trim();
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isString);
}

function isRequestPayload(payload, keys) {
  return hasExactKeys(payload, keys)
    && isId(payload.groupId)
    && isId(payload.actorId)
    && isId(payload.actionId)
    && isString(payload.title)
    && isString(payload.description)
    && Number.isFinite(payload.weeks)
    && payload.weeks > 0
    && (payload.craftProject === null || isPlainObject(payload.craftProject))
    && Array.isArray(payload.targetActionSelections)
    && isSafeSerializable(payload);
}

export function isValidDowntimeWeeksGrantPayload(payload) {
  return hasExactKeys(payload, ["groupId", "actorIds", "weeks", "reason", "fromIsoDate"])
    && isId(payload.groupId) && isStringArray(payload.actorIds)
    && Number.isFinite(payload.weeks) && payload.weeks > 0
    && isString(payload.reason) && isString(payload.fromIsoDate) && isSafeSerializable(payload);
}

export function isValidDowntimeWeeksRevokePayload(payload) {
  return hasExactKeys(payload, ["groupId", "actorIds", "weeks", "reason"])
    && isId(payload.groupId) && isStringArray(payload.actorIds)
    && Number.isFinite(payload.weeks) && payload.weeks > 0
    && isString(payload.reason) && isSafeSerializable(payload);
}

export function isValidDowntimeHistoryClearPayload(payload) {
  return hasExactKeys(payload, ["groupId"]) && isId(payload.groupId);
}

export function isValidDowntimeRequestCreatePayload(payload) {
  return isRequestPayload(payload, ["groupId", "actorId", "actionId", "title", "description", "weeks", "craftProject", "targetActionSelections"]);
}

export function isValidDowntimeRequestUpdatePayload(payload) {
  return isRequestPayload(payload, ["groupId", "actorId", "requestId", "actionId", "title", "description", "weeks", "craftProject", "targetActionSelections"])
    && isId(payload.requestId);
}

export function isValidDowntimeRequestSetStatusPayload(payload) {
  return hasExactKeys(payload, ["groupId", "requestId", "status", "result"])
    && isId(payload.groupId) && isId(payload.requestId) && isId(payload.status)
    && isSafeSerializable(payload.result);
}

export function isValidDowntimeRequestSetChecksPayload(payload) {
  return hasExactKeys(payload, ["groupId", "requestId", "checks"])
    && isId(payload.groupId) && isId(payload.requestId) && Array.isArray(payload.checks)
    && isSafeSerializable(payload);
}

function isActorRequestPayload(payload, keys) {
  return hasExactKeys(payload, keys)
    && isId(payload.groupId) && isId(payload.actorId) && isId(payload.requestId)
    && isSafeSerializable(payload);
}

export function isValidDowntimeRequestRecordCheckPayload(payload) {
  return isActorRequestPayload(payload, ["groupId", "actorId", "requestId", "checkId", "result"])
    && isId(payload.checkId);
}

export function isValidDowntimeProjectContinuePayload(payload) {
  return isActorRequestPayload(payload, ["groupId", "actorId", "requestId", "checkId", "result"])
    && isId(payload.checkId);
}

export function isValidDowntimeProjectClosePayload(payload) {
  return isActorRequestPayload(payload, ["groupId", "actorId", "requestId"]);
}
