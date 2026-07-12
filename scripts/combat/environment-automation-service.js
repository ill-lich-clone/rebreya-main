import { MODULE_ID } from "../constants.js";

export const REBREYA_SURROUNDED_STATUS_ID = "rebreya-surrounded";
export const REBREYA_OPEN_POSITION_STATUS_ID = "rebreya-open-position";

const ENVIRONMENT_STATUS_SOURCE = "rebreya-environment";
const ENVIRONMENT_STATUS_VERSION = "surrounded-ac-1";
const MIN_SURROUNDING_ANGLE = 150 * Math.PI / 180;
const DEFAULT_GRID_SIZE = 100;
const DEFAULT_REACH_CELLS = 1;

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection.filter(Boolean);
  }

  if (collection instanceof Set) {
    return Array.from(collection).filter(Boolean);
  }

  if (typeof collection.values === "function") {
    return Array.from(collection.values()).filter(Boolean);
  }

  return [collection].filter(Boolean);
}

function getDocument(token) {
  return token?.document ?? token ?? {};
}

function getTokenDisposition(token) {
  return toFiniteNumber(getDocument(token).disposition ?? token?.disposition, 0);
}

function getTokenSizeCells(token, key) {
  return Math.max(1, toFiniteNumber(getDocument(token)?.[key] ?? token?.[key], 1));
}

function getGridSize(canvasLike, explicitGridSize) {
  return Math.max(
    1,
    toFiniteNumber(
      explicitGridSize
        ?? canvasLike?.grid?.size
        ?? canvasLike?.grid?.sizeX
        ?? canvasLike?.dimensions?.size,
      DEFAULT_GRID_SIZE
    )
  );
}

function getTokenBounds(token, gridSize) {
  const x = toFiniteNumber(token?.x ?? getDocument(token).x, 0);
  const y = toFiniteNumber(token?.y ?? getDocument(token).y, 0);
  const width = getTokenSizeCells(token, "width") * gridSize;
  const height = getTokenSizeCells(token, "height") * gridSize;
  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height
  };
}

function getTokenCenter(token, gridSize) {
  const center = token?.center ?? getDocument(token).center;
  const x = toFiniteNumber(center?.x, NaN);
  const y = toFiniteNumber(center?.y, NaN);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y };
  }

  const bounds = getTokenBounds(token, gridSize);
  return {
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2
  };
}

function tokenHasReachWeapon(token) {
  const items = collectionValues(token?.actor?.items?.contents ?? token?.actor?.items);
  return items.some((item) => {
    const properties = item?.system?.properties;
    if (properties instanceof Set) {
      return properties.has("rch");
    }

    if (Array.isArray(properties)) {
      return properties.includes("rch");
    }

    return properties?.rch === true || item?.system?.equipped === true && item?.system?.range?.reach > 5;
  });
}

function getThreatReachCells(token) {
  return tokenHasReachWeapon(token) ? 2 : DEFAULT_REACH_CELLS;
}

function actorHasStatus(actor, statusId) {
  const effects = collectionValues(actor?.effects);
  return effects.some((effect) => {
    const statuses = effect?.statuses;
    if (statuses instanceof Set) {
      return statuses.has(statusId);
    }

    if (Array.isArray(statuses)) {
      return statuses.includes(statusId);
    }

    return effect?.statusId === statusId || effect?.flags?.core?.statusId === statusId;
  });
}

function isTokenIncapacitated(token) {
  const actor = token?.actor;
  if (!actor) {
    return true;
  }

  const hp = toFiniteNumber(actor?.system?.attributes?.hp?.value, NaN);
  if (Number.isFinite(hp) && hp <= 0) {
    return true;
  }

  return ["dead", "incapacitated", "unconscious"].some((statusId) => actorHasStatus(actor, statusId));
}

function areTokensHostile(sourceToken, targetToken) {
  const sourceDisposition = getTokenDisposition(sourceToken);
  const targetDisposition = getTokenDisposition(targetToken);
  return Boolean(sourceDisposition)
    && Boolean(targetDisposition)
    && sourceDisposition !== targetDisposition;
}

function isTokenWithinThreatRange(sourceToken, targetToken, gridSize) {
  const source = getTokenBounds(sourceToken, gridSize);
  const target = getTokenBounds(targetToken, gridSize);
  const gapX = Math.max(0, source.left - target.right, target.left - source.right);
  const gapY = Math.max(0, source.top - target.bottom, target.top - source.bottom);
  const maxGap = (getThreatReachCells(sourceToken) - 1) * gridSize;
  return gapX <= maxGap && gapY <= maxGap;
}

function canThreatenTarget(sourceToken, targetToken, gridSize) {
  if (!sourceToken || !targetToken || sourceToken === targetToken) {
    return false;
  }

  if (getDocument(sourceToken).uuid && getDocument(sourceToken).uuid === getDocument(targetToken).uuid) {
    return false;
  }

  return areTokensHostile(sourceToken, targetToken)
    && !isTokenIncapacitated(sourceToken)
    && isTokenWithinThreatRange(sourceToken, targetToken, gridSize);
}

function getAngleBetweenFlankers(firstToken, secondToken, targetToken, gridSize) {
  const targetCenter = getTokenCenter(targetToken, gridSize);
  const firstCenter = getTokenCenter(firstToken, gridSize);
  const secondCenter = getTokenCenter(secondToken, gridSize);
  const firstAngle = Math.atan2(firstCenter.y - targetCenter.y, firstCenter.x - targetCenter.x);
  const secondAngle = Math.atan2(secondCenter.y - targetCenter.y, secondCenter.x - targetCenter.x);
  const rawDiff = Math.abs(firstAngle - secondAngle);
  return rawDiff > Math.PI ? (2 * Math.PI) - rawDiff : rawDiff;
}

function isSurroundingPair(firstToken, secondToken, targetToken, gridSize) {
  return getAngleBetweenFlankers(firstToken, secondToken, targetToken, gridSize) >= MIN_SURROUNDING_ANGLE;
}

export function computeRebreyaSurrounding({
  attackerToken = null,
  targetToken = null,
  tokens = [],
  canvasLike = null,
  gridSize = null
} = {}) {
  if (!targetToken?.actor || isTokenIncapacitated(targetToken)) {
    return { surrounded: false, flankers: [] };
  }

  const safeGridSize = getGridSize(canvasLike, gridSize);
  const placeables = collectionValues(tokens);
  const candidateTokens = placeables.filter((token) => canThreatenTarget(token, targetToken, safeGridSize));
  const attackerCanThreaten = attackerToken && canThreatenTarget(attackerToken, targetToken, safeGridSize);
  if (attackerCanThreaten && !candidateTokens.includes(attackerToken)) {
    candidateTokens.unshift(attackerToken);
  }

  for (let firstIndex = 0; firstIndex < candidateTokens.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < candidateTokens.length; secondIndex += 1) {
      const firstToken = candidateTokens[firstIndex];
      const secondToken = candidateTokens[secondIndex];
      if (isSurroundingPair(firstToken, secondToken, targetToken, safeGridSize)) {
        return { surrounded: true, flankers: [firstToken, secondToken] };
      }
    }
  }

  return { surrounded: false, flankers: [] };
}

function resolveTokenObject(value) {
  return value?.object ?? value?.token ?? value ?? null;
}

function actorUuid(actor) {
  return String(actor?.uuid ?? "").trim();
}

function buildEnvironmentStatusMeta(sourceActor) {
  return {
    source: ENVIRONMENT_STATUS_SOURCE,
    sourceActorUuid: actorUuid(sourceActor),
    version: ENVIRONMENT_STATUS_VERSION
  };
}

function tokenMatchesActor(token, actor) {
  const uuid = actorUuid(actor);
  return Boolean(uuid) && actorUuid(token?.actor) === uuid;
}

function resolveActorToken(actor, canvasLike) {
  const activeToken = actor?.getActiveTokens?.(false, true)?.[0] ?? actor?.getActiveTokens?.()?.[0] ?? null;
  if (activeToken) {
    return activeToken;
  }

  return collectionValues(canvasLike?.tokens?.placeables).find((token) => tokenMatchesActor(token, actor)) ?? null;
}

function resolveActivityToken(activity, canvasLike) {
  return resolveTokenObject(activity?.token)
    ?? resolveTokenObject(activity?.workflow?.token)
    ?? resolveActorToken(activity?.actor ?? activity?.item?.actor, canvasLike)
    ?? collectionValues(canvasLike?.tokens?.controlled)[0]
    ?? collectionValues(globalThis.canvas?.tokens?.controlled)[0]
    ?? null;
}

function resolveTargetTokens(config = {}, workflow = null) {
  const explicitTargets = collectionValues(config?.targets)
    .concat(collectionValues(workflow?.targets))
    .concat(collectionValues(workflow?.hitTargets));
  if (explicitTargets.length) {
    return explicitTargets.map(resolveTokenObject).filter(Boolean);
  }

  return collectionValues(globalThis.game?.user?.targets).map(resolveTokenObject).filter(Boolean);
}

export class EnvironmentAutomationService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this._options = options;
  }

  get statusService() {
    return this.moduleApi?.combatStatusService ?? null;
  }

  #getCombatStatus(actor, statusId) {
    if (typeof this.moduleApi?.getCombatStatus === "function") {
      return this.moduleApi.getCombatStatus(actor, statusId);
    }

    return typeof this.statusService?.getStatus === "function"
      ? this.statusService.getStatus(actor, statusId)
      : null;
  }

  async #setCombatStatus(actor, statusId, options) {
    if (typeof this.moduleApi?.setCombatStatus === "function") {
      return this.moduleApi.setCombatStatus(actor, statusId, options);
    }

    return this.statusService?.setStatus?.(actor, statusId, options) ?? false;
  }

  async #clearCombatStatus(actor, statusId) {
    if (typeof this.moduleApi?.clearCombatStatus === "function") {
      return this.moduleApi.clearCombatStatus(actor, statusId);
    }

    if (typeof this.statusService?.clearStatus === "function") {
      return this.statusService.clearStatus(actor, statusId);
    }

    return this.statusService?.setStatus?.(actor, statusId, { active: false }) ?? false;
  }

  getCanvas() {
    if (typeof this._options.getCanvas === "function") {
      return this._options.getCanvas();
    }

    return globalThis.canvas ?? null;
  }

  async #setEnvironmentStatus(actor, statusId, active, sourceActor = null) {
    if (
      typeof this.moduleApi?.setCombatStatus !== "function"
      && typeof this.statusService?.setStatus !== "function"
    ) {
      return false;
    }

    const current = this.#getCombatStatus(actor, statusId);
    const currentIsEnvironment = current?.meta?.source === ENVIRONMENT_STATUS_SOURCE;
    const nextMeta = buildEnvironmentStatusMeta(sourceActor);

    if (!active) {
      if (!current?.active || !currentIsEnvironment) {
        return false;
      }

      return this.#clearCombatStatus(actor, statusId);
    }

    if (current?.active && !currentIsEnvironment) {
      return true;
    }

    if (
      current?.active
      && currentIsEnvironment
      && current?.meta?.sourceActorUuid === nextMeta.sourceActorUuid
      && current?.meta?.version === nextMeta.version
    ) {
      return true;
    }

    return this.#setCombatStatus(actor, statusId, {
      active: true,
      durationRounds: 1,
      sourceActor,
      meta: nextMeta
    });
  }

  async updateTargetEnvironment(attackerToken, targetToken) {
    const targetActor = targetToken?.actor;
    if (!targetActor) {
      return false;
    }

    const canvasLike = this.getCanvas();
    const result = computeRebreyaSurrounding({
      attackerToken,
      targetToken,
      canvasLike,
      tokens: collectionValues(canvasLike?.tokens?.placeables)
    });

    await this.#setEnvironmentStatus(
      targetActor,
      REBREYA_SURROUNDED_STATUS_ID,
      result.surrounded,
      attackerToken?.actor ?? null
    );
    await this.#setEnvironmentStatus(
      targetActor,
      REBREYA_OPEN_POSITION_STATUS_ID,
      result.surrounded,
      attackerToken?.actor ?? null
    );

    return result.surrounded;
  }

  async updateCurrentTargetEnvironment() {
    const canvasLike = this.getCanvas();
    const attackerToken = collectionValues(canvasLike?.tokens?.controlled)[0] ?? null;
    const targets = resolveTargetTokens({}, null);
    const results = [];
    for (const targetToken of targets) {
      results.push(await this.updateTargetEnvironment(attackerToken, targetToken));
    }
    return results.some(Boolean);
  }

  async applyDnd5eAttackRollConfig(config = {}) {
    const canvasLike = this.getCanvas();
    const attackerToken = resolveActivityToken(config?.subject, canvasLike);
    const targets = resolveTargetTokens(config, null);
    const results = [];
    for (const targetToken of targets) {
      results.push(await this.updateTargetEnvironment(attackerToken, targetToken));
    }
    return results.some(Boolean);
  }

  async applyMidiPreAttackRoll(workflow = {}) {
    const canvasLike = this.getCanvas();
    const attackerToken = resolveTokenObject(workflow?.token)
      ?? resolveActorToken(workflow?.actor, canvasLike)
      ?? collectionValues(canvasLike?.tokens?.controlled)[0]
      ?? null;
    const targets = resolveTargetTokens({}, workflow);
    const results = [];
    for (const targetToken of targets) {
      results.push(await this.updateTargetEnvironment(attackerToken, targetToken));
    }
    return results.some(Boolean);
  }
}

export function logEnvironmentAutomationError(error) {
  console.error(`${MODULE_ID} | Failed to apply Rebreya environment automation.`, error);
}
