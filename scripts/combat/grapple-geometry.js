function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
  return number;
}

function positive(value, name) {
  const number = finite(value, name);
  if (number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}

function tokenDocument(token) {
  return token?.document ?? token;
}

function normalizedGrid(grid) {
  return {
    size: positive(grid?.size, "grid.size"),
    distance: positive(grid?.distance, "grid.distance")
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function tokenFootprint(token, position = null) {
  const document = tokenDocument(token);
  return {
    x: finite(position?.x ?? document?.x, "token.x"),
    y: finite(position?.y ?? document?.y, "token.y"),
    width: positive(document?.width, "token.width"),
    height: positive(document?.height, "token.height")
  };
}

export function grapplePlacementDistanceFeet(sourceToken, targetToken, position, grid) {
  const normalized = normalizedGrid(grid);
  const source = tokenFootprint(sourceToken);
  const target = tokenFootprint(targetToken, position);
  const sourceCenter = {
    x: source.x + ((source.width * normalized.size) / 2),
    y: source.y + ((source.height * normalized.size) / 2)
  };
  const targetRect = {
    left: target.x,
    top: target.y,
    right: target.x + (target.width * normalized.size),
    bottom: target.y + (target.height * normalized.size)
  };
  const nearest = {
    x: clamp(sourceCenter.x, targetRect.left, targetRect.right),
    y: clamp(sourceCenter.y, targetRect.top, targetRect.bottom)
  };
  const pixelDistance = Math.hypot(nearest.x - sourceCenter.x, nearest.y - sourceCenter.y);
  return (pixelDistance / normalized.size) * normalized.distance;
}

function isInsideScene(target, grid, sceneRect) {
  if (!sceneRect) return true;
  const left = finite(sceneRect.x ?? 0, "sceneRect.x");
  const top = finite(sceneRect.y ?? 0, "sceneRect.y");
  const width = positive(sceneRect.width, "sceneRect.width");
  const height = positive(sceneRect.height, "sceneRect.height");
  const right = target.x + (target.width * grid.size);
  const bottom = target.y + (target.height * grid.size);
  return target.x >= left && target.y >= top && right <= left + width && bottom <= top + height;
}

export function validateGrapplePlacement({
  sourceToken,
  targetToken,
  position,
  grid,
  reachFeet,
  sceneRect = null,
  checkCollision = null
} = {}) {
  const normalized = normalizedGrid(grid);
  const target = tokenFootprint(targetToken, position);
  const result = { valid: true, reason: null, x: target.x, y: target.y };
  const reach = Math.max(0, finite(reachFeet, "reachFeet"));
  if (grapplePlacementDistanceFeet(sourceToken, targetToken, target, normalized) > reach + 1e-9) {
    return { ...result, valid: false, reason: "outside-reach" };
  }
  if (!isInsideScene(target, normalized, sceneRect)) {
    return { ...result, valid: false, reason: "outside-scene" };
  }
  if (typeof checkCollision === "function") {
    const source = tokenFootprint(sourceToken);
    const sourcePoint = {
      x: source.x + ((source.width * normalized.size) / 2),
      y: source.y + ((source.height * normalized.size) / 2)
    };
    const targetPoint = {
      x: target.x + ((target.width * normalized.size) / 2),
      y: target.y + ((target.height * normalized.size) / 2)
    };
    if (checkCollision({ sourceToken, targetToken, position: target, sourcePoint, targetPoint })) {
      return { ...result, valid: false, reason: "wall-collision" };
    }
  }
  return result;
}
