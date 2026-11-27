export function sandTokenBounds(token, grid) {
  if (grid?.type !== 1 || Number(grid.distance) !== 5 || !grid.size || !token?.width || !token?.height) return null;
  const units = grid.units?.trim();
  if (units && !/^(?:ft\.?|feet|foot|фут(?:ов|а|\.)?|фт\.?|['′])$/iu.test(units)) return null;
  const size = grid.size;
  return {
    top: Math.floor(token.y / size), bottom: Math.ceil((token.y + token.height * size) / size) - 1,
    left: Math.floor(token.x / size), right: Math.ceil((token.x + token.width * size) / size) - 1
  };
}

export function sandTokenContainsCell(token, grid, row, col) {
  const bounds = sandTokenBounds(token, grid);
  return Boolean(bounds && row >= bounds.top && row <= bounds.bottom && col >= bounds.left && col <= bounds.right);
}

export function sandPlacementCells(token, grid = token.parent?.grid) {
  const bounds = sandTokenBounds(token, grid);
  const dimensions = token.parent?.dimensions;
  if (!bounds || !dimensions) return [];
  const { size } = grid;
  const { sceneX, sceneY, sceneWidth, sceneHeight } = dimensions;
  const cells = [];
  for (let row = bounds.top - 1; row <= bounds.bottom + 1; row += 1) {
    if (row * size < sceneY || (row + 1) * size > sceneY + sceneHeight) continue;
    for (let col = bounds.left - 1; col <= bounds.right + 1; col += 1) {
      if (col * size < sceneX || (col + 1) * size > sceneX + sceneWidth) continue;
      cells.push({ row, col, underToken: row >= bounds.top && row <= bounds.bottom && col >= bounds.left && col <= bounds.right });
    }
  }
  return cells;
}

export function sandDestinationIsFree(token, grid = token.parent?.grid) {
  const width = token.width * grid.size;
  const height = token.height * grid.size;
  for (const other of token.parent.tokens.values()) {
    if (other.id === token.id || (Number(other.elevation) || 0) !== (Number(token.elevation) || 0)) continue;
    if (token.x < other.x + other.width * grid.size && token.x + width > other.x
      && token.y < other.y + other.height * grid.size && token.y + height > other.y) return false;
  }
  return true;
}

export function completedSandMovementDistance(movement, grid, actions = globalThis.CONFIG?.Token?.movement?.actions) {
  const { passed, origin } = movement;
  if (!(passed?.distance > 0 && passed.cost > 0 && passed.waypoints?.length)) return 0;
  let previous = origin;
  let eligibleDistance = 0;
  let allEligible = true;
  for (const waypoint of passed.waypoints) {
    const config = actions?.[waypoint.action];
    const voluntary = !["displace", "teleport"].includes(waypoint.action) && !config?.teleport && config?.measure !== false
      && waypoint.cost > 0;
    if (voluntary && previous && (previous.x !== waypoint.x || previous.y !== waypoint.y)) {
      eligibleDistance += grid.measurePath?.([previous, waypoint])?.distance
        ?? Math.max(Math.abs(previous.x - waypoint.x), Math.abs(previous.y - waypoint.y)) / grid.size * grid.distance;
    } else {
      allEligible = false;
    }
    previous = waypoint;
  }
  return allEligible ? passed.distance : Math.min(passed.distance, eligibleDistance);
}

export function recordedSandMovement(token, grid = token.parent?.grid) {
  const history = token.movementHistory;
  if (!Array.isArray(history) || history.length < 2 || !sandTokenBounds(token, grid)) return null;
  const destination = history.at(-1);
  const id = destination.movementId;
  if (!id || !destination.userId || !destination.checkpoint || destination.x !== token.x || destination.y !== token.y
    || (token.level != null && destination.level != null && destination.level !== token.level)) return null;
  const native = token.movement?.id === id ? token.movement : null;
  if (native && native.state !== "completed") return null;
  let first = history.length - 1;
  while (first > 0 && history[first - 1].movementId === id) first--;
  const previous = history[first - 1] ?? native?.origin;
  const origin = previous ?? history[0];
  const waypoints = history.slice(previous ? first : 1);
  const points = [origin, ...waypoints];
  const distance = grid.measurePath?.(points)?.distance ?? waypoints.reduce((sum, point, index) => {
    const prior = points[index];
    return sum + Math.max(Math.abs(point.x - prior.x), Math.abs(point.y - prior.y)) / grid.size * grid.distance;
  }, 0);
  const cost = waypoints.reduce((sum, point) => sum + (Number(point.cost) || 0), 0);
  return { id, userId: destination.userId, origin, destination, passed: { cost, distance, waypoints }, finished: true };
}
