export const MAX_STORAGE_DISTANCE_FEET = 5;

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
  const gridSize = Number(canvas?.grid?.size ?? canvas?.dimensions?.size ?? 100);
  return {
    x: Number(document?.x ?? 0) + Number(document?.width ?? 1) * gridSize / 2,
    y: Number(document?.y ?? 0) + Number(document?.height ?? 1) * gridSize / 2
  };
}

export function measureStorageTokenDistance(characterToken, storageToken, { canvas = globalThis.canvas } = {}) {
  const from = storageTokenCenter(characterToken, { canvas });
  const to = storageTokenCenter(storageToken, { canvas });
  if (typeof canvas?.grid?.measurePath === "function") {
    return Number(canvas.grid.measurePath([from, to])?.distance);
  }
  if (typeof canvas?.grid?.measureDistance === "function") {
    return Number(canvas.grid.measureDistance(from, to));
  }
  return Number.POSITIVE_INFINITY;
}

export function isStorageTokenVisible(storageToken, { canvas = globalThis.canvas } = {}) {
  const document = storageTokenDocument(storageToken);
  if (document?.hidden === true) return false;
  const object = storageTokenObject(storageToken, canvas);
  return object ? object.visible !== false : true;
}

export function preflightStorageAccess(storageToken, {
  game = globalThis.game,
  canvas = globalThis.canvas
} = {}) {
  if (game?.user?.isGM === true) {
    return { allowed: true, reason: "ok", characterTokenUuid: "" };
  }
  const characterToken = (canvas?.tokens?.controlled ?? []).find((candidate) => (
    candidate?.actor?.type === "character"
    && candidate.actor.testUserPermission?.(game?.user, "OWNER") === true
  ));
  const characterDocument = storageTokenDocument(characterToken);
  const characterTokenUuid = String(characterDocument?.uuid ?? characterToken?.uuid ?? "").trim();
  if (!characterToken) return { allowed: false, reason: "character", characterTokenUuid };

  const storageDocument = storageTokenDocument(storageToken);
  if (!storageDocument?.parent?.id || storageDocument.parent.id !== characterDocument?.parent?.id) {
    return { allowed: false, reason: "scene", characterTokenUuid };
  }
  if (!isStorageTokenVisible(storageToken, { canvas })) {
    return { allowed: false, reason: "visibility", characterTokenUuid };
  }
  const distance = measureStorageTokenDistance(characterToken, storageToken, { canvas });
  if (!Number.isFinite(distance) || distance > MAX_STORAGE_DISTANCE_FEET) {
    return { allowed: false, reason: "distance", characterTokenUuid };
  }
  return { allowed: true, reason: "ok", characterTokenUuid };
}
