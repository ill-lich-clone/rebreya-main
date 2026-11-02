const SIZE_ORDER = ["tiny", "sm", "med", "lg", "huge", "grg"];
const FEET_PER_UNIT = { ft: 1, m: 10 / 3, km: 10000 / 3, mi: 5280 };

function pointsTowardsTarget(end, direction, target, size, halfX, halfY) {
  const origin = [end.x + halfX, end.y + halfY], vector = [direction.x, direction.y];
  const low = [target.x - halfX, target.y - halfY];
  const high = [target.x + Number(target.width ?? 1) * size + halfX, target.y + Number(target.height ?? 1) * size + halfY];
  let enter = 0, exit = Infinity;
  for (let axis = 0; axis < 2; axis++) {
    if (!vector[axis]) { if (origin[axis] < low[axis] || origin[axis] > high[axis]) return false; continue; }
    const a = (low[axis] - origin[axis]) / vector[axis], b = (high[axis] - origin[axis]) / vector[axis];
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  return exit >= enter && exit > 0;
}

export function mountedDamage(rider, target) {
  const uuid = rider?.flags?.["rebreya-main"]?.mountedOn;
  const scene = rider?.parent;
  if (typeof uuid !== "string" || !scene || target?.parent !== scene) return 0;
  const mount = scene.tokens?.get?.(uuid.split(".").at(-1));
  if (!mount?.actor || mount.uuid !== uuid || mount.parent !== scene || mount.uuid === rider.uuid) return 0;
  const mountSize = SIZE_ORDER.indexOf(mount.actor.system?.traits?.size);
  const targetSize = SIZE_ORDER.indexOf(target.actor?.system?.traits?.size);
  return mountSize >= 0 && targetSize >= 0 && targetSize < mountSize ? 2 : 0;
}

export function chargeMovement(token, target, { history = token?.movementHistory } = {}) {
  const points = history;
  if (!Array.isArray(points) || points.length < 2 || !token.parent?.grid || typeof token.measureMovementPath !== "function") return null;
  if (target?.parent && target.parent !== token.parent) return false;
  const end = points.at(-1);
  if (![end.x, end.y, token.x, token.y, target?.x, target?.y].every(Number.isFinite)
    || end.x !== token.x || end.y !== token.y) return null;
  let start = end, direction = null;
  for (let index = points.length - 1; index > 0; index--) {
    const next = points[index], prev = points[index - 1];
    if (!Number.isFinite(prev.x) || !Number.isFinite(prev.y) || next.action === "displace"
      || next.action === "teleport" || globalThis.CONFIG?.Token?.movement?.actions?.[next.action]?.teleport
      || Number(next.elevation ?? 0) !== Number(prev.elevation ?? 0)) break;
    const dx = next.x - prev.x, dy = next.y - prev.y;
    if (!dx && !dy) continue;
    if (direction && (Math.abs(dx * direction.y - dy * direction.x) > 1e-6 || dx * direction.x + dy * direction.y <= 0)) break;
    direction ??= { x: dx, y: dy };
    start = prev;
  }
  if (!direction || start === end) return false;
  const size = Number(token.parent.grid.size), targetX = target.x + Number(target.width ?? 1) * size / 2;
  const targetY = target.y + Number(target.height ?? 1) * size / 2;
  const halfX = Number(token.width ?? 1) * size / 2, halfY = Number(token.height ?? 1) * size / 2;
  if (!(size > 0) || Math.hypot(targetX - end.x - halfX, targetY - end.y - halfY)
    >= Math.hypot(targetX - start.x - halfX, targetY - start.y - halfY)
    || !pointsTowardsTarget(end, direction, target, size, halfX, halfY)) return false;
  const units = token.parent.grid.units ?? "ft";
  const conversion = globalThis.CONFIG?.DND5E?.movementUnits?.[units]?.conversion ?? FEET_PER_UNIT[units];
  if (!(conversion > 0)) return null;
  try {
    const distance = Number(token.measureMovementPath([start, end])?.distance);
    return Number.isFinite(distance) ? distance * conversion >= 10 : null;
  } catch { return null; }
}
