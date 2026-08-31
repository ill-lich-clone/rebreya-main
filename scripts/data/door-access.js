import {
  measureStorageGridDistance,
  storageTokenDocument,
  storageTokenFootprintCenters
} from "./storage-access.js";

export const MAX_DOOR_DISTANCE_FEET = 10;

function finitePoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function wallDocument(wall) {
  return wall?.document ?? wall ?? null;
}

function wallEndpoints(wall) {
  const coordinates = wallDocument(wall)?.c;
  if (!Array.isArray(coordinates) || coordinates.length < 4) return null;
  const [x1, y1, x2, y2] = coordinates.map(Number);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
}

export function nearestPointOnSegment(point, start, end) {
  const source = finitePoint(point);
  const first = finitePoint(start);
  const second = finitePoint(end);
  if (!source || !first || !second) return { x: Number.NaN, y: Number.NaN };
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const lengthSquared = dx * dx + dy * dy;
  const scalar = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((source.x - first.x) * dx + (source.y - first.y) * dy) / lengthSquared));
  return { x: first.x + scalar * dx, y: first.y + scalar * dy };
}

export function measureDoorDistanceFeet(characterToken, wall, { canvas = globalThis.canvas } = {}) {
  const endpoints = wallEndpoints(wall);
  if (!endpoints) return Number.POSITIVE_INFINITY;
  const characterDocument = storageTokenDocument(characterToken);
  const sceneGrid = characterDocument?.parent?.grid
    ?? wallDocument(wall)?.parent?.grid
    ?? canvas?.scene?.grid;
  const distances = storageTokenFootprintCenters(characterToken, { canvas }).map((point) => {
    const nearest = nearestPointOnSegment(point, endpoints[0], endpoints[1]);
    return measureStorageGridDistance(point, nearest, { sceneGrid, canvas });
  });
  return Math.min(...distances.filter(Number.isFinite), Number.POSITIVE_INFINITY);
}

function isSecretDoor(wall) {
  const secret = globalThis.CONST?.WALL_DOOR_TYPES?.SECRET ?? 2;
  return Number(wallDocument(wall)?.door) === Number(secret);
}

function isDoor(wall) {
  const none = globalThis.CONST?.WALL_DOOR_TYPES?.NONE ?? 0;
  const document = wallDocument(wall);
  return document?.documentName === "Wall" && Number(document?.door) !== Number(none);
}

export function preflightDoorAccess(wall, {
  game = globalThis.game,
  canvas = globalThis.canvas
} = {}) {
  const document = wallDocument(wall);
  if (!isDoor(document)) {
    return { allowed: false, reason: "door", characterTokenUuid: "", distance: Number.POSITIVE_INFINITY };
  }
  if (game?.user?.isGM !== true && isSecretDoor(document)) {
    return { allowed: false, reason: "secret", characterTokenUuid: "", distance: Number.POSITIVE_INFINITY };
  }
  const controlled = Array.from(canvas?.tokens?.controlled ?? []);
  const ownedCharacters = controlled.filter((candidate) => (
    candidate?.actor?.type === "character"
    && candidate.actor.testUserPermission?.(game?.user, "OWNER") === true
  ));
  if (!ownedCharacters.length) {
    return { allowed: false, reason: "character", characterTokenUuid: "", distance: Number.POSITIVE_INFINITY };
  }
  const sameScene = ownedCharacters.filter((candidate) => (
    document?.parent?.id
    && storageTokenDocument(candidate)?.parent?.id === document.parent.id
  ));
  if (!sameScene.length) {
    return { allowed: false, reason: "scene", characterTokenUuid: "", distance: Number.POSITIVE_INFINITY };
  }
  const visible = sameScene.filter((candidate) => storageTokenDocument(candidate)?.hidden !== true);
  if (!visible.length) {
    return { allowed: false, reason: "character", characterTokenUuid: "", distance: Number.POSITIVE_INFINITY };
  }
  const ranked = visible.map((candidate) => ({
    token: candidate,
    distance: measureDoorDistanceFeet(candidate, document, { canvas }),
    id: String(storageTokenDocument(candidate)?.id ?? candidate?.id ?? "")
  })).sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id));
  const nearest = ranked[0];
  const tokenDocument = storageTokenDocument(nearest?.token);
  const characterTokenUuid = String(tokenDocument?.uuid ?? nearest?.token?.uuid ?? "").trim();
  const distance = nearest?.distance ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(distance) || distance > MAX_DOOR_DISTANCE_FEET) {
    return { allowed: false, reason: "distance", characterTokenUuid, distance };
  }
  return { allowed: true, reason: "ok", characterTokenUuid, distance };
}
