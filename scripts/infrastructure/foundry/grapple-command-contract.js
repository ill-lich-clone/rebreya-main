export const GRAPPLE_TOGGLE_COMMAND = "combat.grapple.toggle";
export const GRAPPLE_PLACE_COMMAND = "combat.grapple.place";
export const GRAPPLE_DRAG_COMMAND = "combat.grapple.drag";
export const GRAPPLE_RELEASE_AND_MOVE_COMMAND = "combat.grapple.release-and-move";

const MAX_TOKEN_UUID_LENGTH = 512;
const MAX_IDENTIFIER_LENGTH = 128;

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function boundedTrimmedString(value, maximum = MAX_IDENTIFIER_LENGTH) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && value === value.trim();
}

function tokenUuid(value) {
  return boundedTrimmedString(value, MAX_TOKEN_UUID_LENGTH)
    && /^Scene\.[^.]+\.Token\.[^.]+$/u.test(value);
}

function finiteCoordinates(payload) {
  return Number.isFinite(payload.x) && Number.isFinite(payload.y);
}

export function isValidGrappleTogglePayload(payload) {
  return exactKeys(payload, ["sourceTokenUuid", "targetTokenUuid", "operationId"])
    && tokenUuid(payload.sourceTokenUuid)
    && tokenUuid(payload.targetTokenUuid)
    && boundedTrimmedString(payload.operationId);
}

export function isValidGrapplePlacePayload(payload) {
  return exactKeys(payload, ["sourceTokenUuid", "targetTokenUuid", "x", "y", "operationId"])
    && tokenUuid(payload.sourceTokenUuid)
    && tokenUuid(payload.targetTokenUuid)
    && finiteCoordinates(payload)
    && boundedTrimmedString(payload.operationId);
}

export function isValidGrappleDragPayload(payload) {
  return exactKeys(payload, ["sourceTokenUuid", "x", "y", "operationId", "requesterUserId"])
    && tokenUuid(payload.sourceTokenUuid)
    && finiteCoordinates(payload)
    && boundedTrimmedString(payload.operationId)
    && boundedTrimmedString(payload.requesterUserId);
}

export function isValidGrappleReleaseAndMovePayload(payload) {
  return exactKeys(payload, ["targetTokenUuid", "linkId", "x", "y", "operationId", "requesterUserId"])
    && tokenUuid(payload.targetTokenUuid)
    && boundedTrimmedString(payload.linkId)
    && finiteCoordinates(payload)
    && boundedTrimmedString(payload.operationId)
    && boundedTrimmedString(payload.requesterUserId);
}
