export const MAX_STORAGE_DISTANCE_FEET = 10;
export const STORAGE_ACCESS_DISTANCE_ERROR_CODE = "storage-access-distance";

export function storageTokenDocument(token) {
  return token?.document ?? token ?? null;
}

function storageTokenObject(token, canvas) {
  const document = storageTokenDocument(token);
  return document?.object
    ?? (token?.center ? token : null)
    ?? canvas?.tokens?.get?.(document?.id)
    ?? null;
}

export function storageTokenCenter(token, { canvas = globalThis.canvas } = {}) {
  const document = storageTokenDocument(token);
  const object = storageTokenObject(token, canvas);
  if (object?.center && Number.isFinite(Number(object.center.x)) && Number.isFinite(Number(object.center.y))) {
    return { x: Number(object.center.x), y: Number(object.center.y) };
  }
  const gridSize = Number(document?.parent?.grid?.size ?? canvas?.grid?.size ?? canvas?.dimensions?.size ?? 100);
  return {
    x: Number(document?.x ?? 0) + Number(document?.width ?? 1) * gridSize / 2,
    y: Number(document?.y ?? 0) + Number(document?.height ?? 1) * gridSize / 2
  };
}

function storageTokenFootprintCenters(token, { canvas = globalThis.canvas } = {}) {
  const document = storageTokenDocument(token);
  const gridSize = Number(document?.parent?.grid?.size ?? canvas?.grid?.size ?? canvas?.dimensions?.size ?? 100);
  const width = Number(document?.width ?? 1);
  const height = Number(document?.height ?? 1);
  if (!Number.isFinite(gridSize) || gridSize <= 0
    || !Number.isFinite(width) || width <= 0
    || !Number.isFinite(height) || height <= 0) {
    return [storageTokenCenter(token, { canvas })];
  }
  const left = Number(document?.x ?? 0);
  const top = Number(document?.y ?? 0);
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return [storageTokenCenter(token, { canvas })];
  }
  const firstColumn = Math.floor(left / gridSize);
  const lastColumn = Math.ceil((left + width * gridSize) / gridSize - 1e-9) - 1;
  const firstRow = Math.floor(top / gridSize);
  const lastRow = Math.ceil((top + height * gridSize) / gridSize - 1e-9) - 1;
  const centers = [];
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      centers.push({
        x: (column + 0.5) * gridSize,
        y: (row + 0.5) * gridSize
      });
    }
  }
  return centers;
}

function measureGridDistance(from, to, canvas) {
  if (typeof canvas?.grid?.measurePath === "function") {
    return Number(canvas.grid.measurePath([from, to])?.distance);
  }
  if (typeof canvas?.grid?.measureDistance === "function") {
    return Number(canvas.grid.measureDistance(from, to));
  }
  return Number.POSITIVE_INFINITY;
}

function measureSquareGridSteps(from, to, sceneGrid) {
  const squareType = globalThis.CONST?.GRID_TYPES?.SQUARE ?? 1;
  const gridSize = Number(sceneGrid?.size);
  const gridDistance = Number(sceneGrid?.distance);
  if (Number(sceneGrid?.type) !== squareType
    || !Number.isFinite(gridSize) || gridSize <= 0
    || !Number.isFinite(gridDistance) || gridDistance <= 0) return null;
  const columnSteps = Math.abs(Math.floor(from.x / gridSize) - Math.floor(to.x / gridSize));
  const rowSteps = Math.abs(Math.floor(from.y / gridSize) - Math.floor(to.y / gridSize));
  return Math.max(columnSteps, rowSteps) * gridDistance;
}

export function measureStorageTokenDistance(characterToken, storageToken, { canvas = globalThis.canvas } = {}) {
  const sceneGrid = storageTokenDocument(characterToken)?.parent?.grid
    ?? storageTokenDocument(storageToken)?.parent?.grid
    ?? canvas?.scene?.grid;
  const distances = storageTokenFootprintCenters(characterToken, { canvas }).flatMap((from) => (
    storageTokenFootprintCenters(storageToken, { canvas }).map((to) => (
      measureSquareGridSteps(from, to, sceneGrid) ?? measureGridDistance(from, to, canvas)
    ))
  ));
  return Math.min(...distances.filter(Number.isFinite), Number.POSITIVE_INFINITY);
}

export function measureStoragePointDistance(characterToken, point, { canvas = globalThis.canvas } = {}) {
  const to = { x: Number(point?.x), y: Number(point?.y) };
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return Number.POSITIVE_INFINITY;
  const sceneGrid = storageTokenDocument(characterToken)?.parent?.grid ?? canvas?.scene?.grid;
  const distances = storageTokenFootprintCenters(characterToken, { canvas })
    .map((from) => measureSquareGridSteps(from, to, sceneGrid) ?? measureGridDistance(from, to, canvas));
  return Math.min(...distances.filter(Number.isFinite), Number.POSITIVE_INFINITY);
}

export function isStorageTokenVisible(storageToken) {
  const document = storageTokenDocument(storageToken);
  return document?.hidden !== true;
}

export function preflightStorageAccess(storageToken, {
  game = globalThis.game,
  canvas = globalThis.canvas
} = {}) {
  if (game?.user?.isGM === true) {
    return { allowed: true, reason: "ok", characterTokenUuid: "" };
  }
  const controlled = new Set(canvas?.tokens?.controlled ?? []);
  const tokens = [...new Set([
    ...(canvas?.tokens?.placeables ?? []),
    ...(canvas?.tokens?.controlled ?? [])
  ])];
  const ownedCharacters = tokens.filter((candidate) => (
    candidate?.actor?.type === "character"
    && candidate.actor.testUserPermission?.(game?.user, "OWNER") === true
  ));
  const storageDocument = storageTokenDocument(storageToken);
  if (!ownedCharacters.length) return { allowed: false, reason: "character", characterTokenUuid: "" };
  const sameScene = ownedCharacters.filter((candidate) => (
    storageDocument?.parent?.id
    && storageTokenDocument(candidate)?.parent?.id === storageDocument.parent.id
  ));
  if (!sameScene.length) return { allowed: false, reason: "scene", characterTokenUuid: "" };
  if (!isStorageTokenVisible(storageToken, { canvas })) {
    return { allowed: false, reason: "visibility", characterTokenUuid: "" };
  }
  const ranked = sameScene
    .filter((candidate) => isStorageTokenVisible(candidate, { canvas }))
    .map((candidate) => ({
      token: candidate,
      distance: measureStorageTokenDistance(candidate, storageToken, { canvas }),
      controlled: controlled.has(candidate),
      id: String(storageTokenDocument(candidate)?.id ?? candidate?.id ?? "")
    }))
    .sort((left, right) => (
      left.distance - right.distance
      || Number(right.controlled) - Number(left.controlled)
      || left.id.localeCompare(right.id)
    ));
  const nearest = ranked[0];
  if (!nearest) return { allowed: false, reason: "character", characterTokenUuid: "" };
  const characterDocument = storageTokenDocument(nearest.token);
  const characterTokenUuid = String(characterDocument?.uuid ?? nearest.token?.uuid ?? "").trim();
  const distance = nearest.distance;
  if (!Number.isFinite(distance) || distance > MAX_STORAGE_DISTANCE_FEET) {
    return { allowed: false, reason: "distance", characterTokenUuid };
  }
  return { allowed: true, reason: "ok", characterTokenUuid };
}
