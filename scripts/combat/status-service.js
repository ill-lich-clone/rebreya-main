import { MODULE_ID } from "../constants.js";
import {
  LEGACY_REBREYA_FRIGHTENED_STATUS_ID,
  REBREYA_DISCREET_STATUS_ID,
  REBREYA_FRIGHTENED_STATUS_ID,
  REBREYA_STATUS_DEFINITIONS,
  buildRebreyaStatusConfig,
  getRebreyaStatusDefinition,
  normalizeRebreyaStatusId
} from "./status-definitions.js?v=1.4.95-surrounded-ac";

const STATUS_ID_FLAG = "statusId";
const STATUS_VALUE_FLAG = "statusValue";
const STATUS_META_FLAG = "statusMeta";
const DEFAULT_DURATION_ROUNDS = 0;
const DAE_MODULE_ID = "dae";
const LEGACY_BLOODIED_STATUS_ID = "rebreya-bloodied";
const LEGACY_RESTRAINED_STATUS_ID = "rebreya-restrained";
const FRIGHTENED_STATUS_ID = REBREYA_FRIGHTENED_STATUS_ID;
const STATUS_COUNTER_MODULE_ID = "statuscounter";
const DAE_SPECIAL_DURATION_TURN_START_SOURCE = "turnStartSource";
const DAE_SPECIAL_DURATION_TURN_END_SOURCE = "turnEndSource";
const DISCREET_MOVEMENT_KEYS = Object.freeze(["walk", "burrow", "climb", "fly", "swim"]);
const FRIGHTENED_ATTACK_BONUS_KEYS = Object.freeze([
  "system.bonuses.abilities.check",
  "system.bonuses.mwak.attack",
  "system.bonuses.rwak.attack",
  "system.bonuses.msak.attack",
  "system.bonuses.rsak.attack"
]);
const FRIGHTENED_ATTACK_BONUS_KEY_SET = new Set(FRIGHTENED_ATTACK_BONUS_KEYS);
const FRIGHTENED_PRESERVED_CHANGE_KEYS = new Set([
  "flags.midi-qol.OverTime"
]);

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toInteger(value, fallback = 0) {
  return Math.floor(toNumber(value, fallback));
}

function cloneData(value) {
  if (value === undefined) {
    return undefined;
  }

  if (globalThis.foundry?.utils?.deepClone) {
    return foundry.utils.deepClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function getProperty(source, path, fallback = undefined) {
  const value = globalThis.foundry?.utils?.getProperty
    ? foundry.utils.getProperty(source, path)
    : String(path ?? "").split(".").reduce((current, part) => current?.[part], source);
  return value === undefined ? fallback : value;
}

function buildEffectStatusesSet(statusId) {
  return new Set([String(statusId ?? "").trim()].filter(Boolean));
}

function stripTrailingStatusValue(value) {
  return String(value ?? "")
    .replace(/\s+\d+(?!.*\d)/u, "")
    .trim();
}

function extractEffectStatuses(effect) {
  const statuses = effect?.statuses;
  if (statuses instanceof Set) {
    return [...statuses].map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }

  if (Array.isArray(statuses)) {
    return statuses.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }

  const fallback = String(
    effect?.getFlag?.("core", "statusId")
    ?? effect?.getFlag?.(MODULE_ID, STATUS_ID_FLAG)
    ?? ""
  ).trim();
  return fallback ? [fallback] : [];
}

function getActorHpSnapshot(actor) {
  const current = toNumber(foundry.utils.getProperty(actor, "system.attributes.hp.value"), NaN);
  const max = toNumber(foundry.utils.getProperty(actor, "system.attributes.hp.max"), NaN);
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) {
    return null;
  }

  return {
    current,
    max
  };
}

function isKnownStatusConfig(statusId) {
  const safeStatusId = String(statusId ?? "").trim();
  if (!safeStatusId) {
    return false;
  }

  return Array.isArray(CONFIG?.statusEffects) && CONFIG.statusEffects.some((row) => {
    const rowId = String(row?.id ?? row?._id ?? "").trim();
    return rowId === safeStatusId;
  });
}

function canUseNativeStatusToggle(actor, statusId) {
  const safeStatusId = String(statusId ?? "").trim();
  return Boolean(
    safeStatusId
    && !safeStatusId.startsWith("rebreya-")
    && isKnownStatusConfig(safeStatusId)
    && typeof actor?.toggleStatusEffect === "function"
  );
}

function shouldRegisterDnd5eStatusEffect(statusId) {
  return String(statusId ?? "").trim().startsWith("rebreya-");
}

function normalizeStatusList(value) {
  const rawStatuses = value instanceof Set
    ? [...value]
    : Array.isArray(value)
      ? value
      : [];
  const seen = new Set();
  const statuses = [];
  for (const entry of rawStatuses) {
    const statusId = String(entry ?? "").trim();
    if (!statusId || seen.has(statusId)) {
      continue;
    }

    seen.add(statusId);
    statuses.push(statusId);
  }

  return statuses;
}

function ensureSelfReferentialStatusConfig(statusConfig, statusId) {
  const safeStatusId = String(statusId ?? "").trim();
  if (!statusConfig || !safeStatusId) {
    return false;
  }

  const statuses = normalizeStatusList(statusConfig.statuses);
  if (statuses.includes(safeStatusId)) {
    return false;
  }

  statusConfig.statuses = [...statuses, safeStatusId];
  return true;
}

function getManagedNativeStatusIds() {
  return REBREYA_STATUS_DEFINITIONS
    .filter((row) => !row.foundryId && !shouldRegisterDnd5eStatusEffect(row.id))
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);
}

function resolveActiveEffectDuration(durationRounds = DEFAULT_DURATION_ROUNDS) {
  const safeRounds = Math.max(0, Math.floor(toNumber(durationRounds, DEFAULT_DURATION_ROUNDS)));
  if (safeRounds <= 0) {
    return {};
  }

  const combatRound = toNumber(game.combat?.round, 0);
  const combatTurn = toNumber(game.combat?.turn, 0);
  return {
    rounds: safeRounds,
    startRound: combatRound,
    startTurn: combatTurn
  };
}

function buildCombatTurnDuration(rounds = 1) {
  const safeRounds = Math.max(1, Math.floor(toNumber(rounds, 1)));
  return {
    startTime: null,
    seconds: null,
    combat: null,
    rounds: safeRounds,
    turns: null,
    startRound: globalThis.game?.combat?.round ?? null,
    startTurn: globalThis.game?.combat?.turn ?? null
  };
}

function getDialogRoot(html) {
  if (!html) {
    return null;
  }

  if (html instanceof HTMLElement) {
    return html;
  }

  if (html[0] instanceof HTMLElement) {
    return html[0];
  }

  return null;
}

function normalizeStatusValue(value, fallback = 1) {
  const numericValue = toInteger(value, fallback);
  if (!Number.isFinite(numericValue)) {
    return Math.max(1, fallback);
  }

  return Math.max(1, numericValue);
}

function getActorProficiencyBonus(actor) {
  const rawValue = getProperty(actor, "system.attributes.prof");
  if (rawValue && typeof rawValue === "object") {
    const objectValue = Number(rawValue.flat ?? rawValue.value ?? rawValue.total ?? 0);
    return Number.isFinite(objectValue) && objectValue > 0 ? objectValue : 0;
  }

  const numericValue = Number(rawValue ?? 0);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
}

function resolveNumericStatusValue(value, { actor = null, sourceActor = null } = {}) {
  if (Number.isFinite(Number(value))) {
    return Number(value);
  }

  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return NaN;
  }

  const proficiency = getActorProficiencyBonus(sourceActor) || getActorProficiencyBonus(actor);
  const resolvedValue = rawValue
    .replace(/@prof\b/giu, String(proficiency))
    .replace(/@attributes\.prof\b/giu, String(proficiency));

  return Number.isFinite(Number(resolvedValue)) ? Number(resolvedValue) : NaN;
}

function fallbackFrightenedValue({ actor = null, sourceActor = null } = {}) {
  const proficiency = getActorProficiencyBonus(sourceActor) || getActorProficiencyBonus(actor);
  return Math.max(2, Math.floor(proficiency / 2));
}

function normalizeFrightenedValue(value, context = {}) {
  const numericValue = resolveNumericStatusValue(value, context);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return Math.max(1, Math.floor(numericValue));
  }

  return fallbackFrightenedValue(context);
}

function activeEffectAddMode() {
  return globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
}

function statusLabel(statusId) {
  return getRebreyaStatusDefinition(statusId)?.label ?? statusId;
}

function statusIcon(statusId) {
  return getRebreyaStatusDefinition(statusId)?.icon ?? "icons/svg/aura.svg";
}

function statusSupportsValue(statusId) {
  return getRebreyaStatusDefinition(statusId)?.supportsValue === true;
}

function configStatusLabel(statusId) {
  const safeStatusId = String(statusId ?? "").trim();
  if (!safeStatusId || !Array.isArray(CONFIG?.statusEffects)) {
    return "";
  }

  const row = CONFIG.statusEffects.find((entry) => {
    const entryId = String(entry?.id ?? entry?._id ?? "").trim();
    return entryId === safeStatusId;
  });

  return String(row?.name ?? row?.label ?? "").trim();
}

function timedStatusDurationLabel(durationMode) {
  if (durationMode === DAE_SPECIAL_DURATION_TURN_START_SOURCE) {
    return "До начала следующего хода";
  }

  if (durationMode === DAE_SPECIAL_DURATION_TURN_END_SOURCE) {
    return "До конца следующего хода";
  }

  return "";
}

function discreetStatusName(value) {
  return `${statusLabel(REBREYA_DISCREET_STATUS_ID)} ${normalizeStatusValue(value, 1)}`;
}

function plainDiscreetStatusName() {
  return statusLabel(REBREYA_DISCREET_STATUS_ID);
}

function frightenedStatusName(value, context = {}) {
  return `${statusLabel(FRIGHTENED_STATUS_ID)} ${normalizeFrightenedValue(value, context)}`;
}

function genericStatusName(statusId, value) {
  if (statusSupportsValue(statusId) && Number.isFinite(Number(value)) && Number(value) > 0) {
    return `${statusLabel(statusId)} ${normalizeStatusValue(value, 1)}`;
  }

  return statusLabel(statusId);
}

function isUnvaluedDiscreetValue(value) {
  return value === null;
}

export function buildDiscreetSpeedChanges(value) {
  const penalty = normalizeStatusValue(value, 1);
  const signedPenalty = String(-penalty);
  const mode = activeEffectAddMode();
  const priority = 20;

  return DISCREET_MOVEMENT_KEYS.map((movementKey) => ({
    key: `system.attributes.movement.${movementKey}`,
    mode,
    value: signedPenalty,
    priority
  }));
}

function getActorMovementValue(actor, movementKey) {
  const sourceValue = getProperty(actor, `_source.system.attributes.movement.${movementKey}`);
  const preparedValue = getProperty(actor, `system.attributes.movement.${movementKey}`);
  const numericValue = Number(sourceValue ?? preparedValue ?? 0);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
}

function buildDiscreetHalfSpeedChanges(actor) {
  const mode = activeEffectAddMode();
  const priority = 20;
  return DISCREET_MOVEMENT_KEYS
    .map((movementKey) => {
      const penalty = getActorMovementValue(actor, movementKey) / 2;
      return penalty > 0 ? {
        key: `system.attributes.movement.${movementKey}`,
        mode,
        value: String(-penalty),
        priority
      } : null;
    })
    .filter(Boolean);
}

function getDiscreetHalfSpeedStrength(actor) {
  return Math.max(...DISCREET_MOVEMENT_KEYS.map((movementKey) => getActorMovementValue(actor, movementKey) / 2), 0);
}

export function buildDiscreetStatusEffectData(value, { durationRounds = DEFAULT_DURATION_ROUNDS, meta = {} } = {}) {
  const hasValue = !isUnvaluedDiscreetValue(value);
  const statusValue = hasValue ? normalizeStatusValue(value, 1) : null;

  return {
    name: hasValue ? discreetStatusName(statusValue) : plainDiscreetStatusName(),
    img: statusIcon(REBREYA_DISCREET_STATUS_ID),
    icon: statusIcon(REBREYA_DISCREET_STATUS_ID),
    statuses: buildEffectStatusesSet(REBREYA_DISCREET_STATUS_ID),
    disabled: false,
    transfer: false,
    changes: hasValue ? buildDiscreetSpeedChanges(statusValue) : [],
    duration: resolveActiveEffectDuration(durationRounds),
    flags: {
      core: {
        statusId: REBREYA_DISCREET_STATUS_ID
      },
      [MODULE_ID]: {
        [STATUS_ID_FLAG]: REBREYA_DISCREET_STATUS_ID,
        [STATUS_VALUE_FLAG]: statusValue,
        [STATUS_META_FLAG]: cloneData(meta ?? {})
      },
      [STATUS_COUNTER_MODULE_ID]: {
        ...(hasValue ? { value: statusValue } : {}),
        visible: hasValue,
        config: {
          multiplyEffect: false
        }
      }
    }
  };
}

function buildFrightenedChanges(value, context = {}) {
  const penalty = normalizeFrightenedValue(value, context);
  const signedPenalty = String(-penalty);
  const mode = activeEffectAddMode();
  const priority = 20;
  return FRIGHTENED_ATTACK_BONUS_KEYS.map((key) => ({
    key,
    mode,
    value: signedPenalty,
    priority
  }));
}

function getEffectChanges(effect) {
  return Array.isArray(effect?.changes) ? effect.changes : [];
}

function cloneEffectChange(change) {
  return cloneData(change);
}

function preserveFrightenedPassthroughChanges(effect) {
  return getEffectChanges(effect)
    .filter((change) => FRIGHTENED_PRESERVED_CHANGE_KEYS.has(String(change?.key ?? "")))
    .filter((change) => !FRIGHTENED_ATTACK_BONUS_KEY_SET.has(String(change?.key ?? "")))
    .map(cloneEffectChange)
    .filter(Boolean);
}

function buildSyncedFrightenedChanges(effect, value, { isStrongest = false } = {}) {
  return [
    ...preserveFrightenedPassthroughChanges(effect),
    ...(isStrongest ? buildFrightenedChanges(value) : [])
  ];
}

function buildSyncedFrightenedStatuses(effect, { isStrongest = true } = {}) {
  void effect;
  return isStrongest ? [FRIGHTENED_STATUS_ID] : [];
}

export function buildFrightenedStatusEffectData(
  value,
  { durationRounds = DEFAULT_DURATION_ROUNDS, meta = {}, actor = null, sourceActor = null } = {}
) {
  const statusValue = normalizeFrightenedValue(value, { actor, sourceActor });

  return {
    name: frightenedStatusName(statusValue),
    img: statusIcon(FRIGHTENED_STATUS_ID),
    icon: statusIcon(FRIGHTENED_STATUS_ID),
    statuses: buildEffectStatusesSet(FRIGHTENED_STATUS_ID),
    disabled: false,
    transfer: false,
    changes: buildFrightenedChanges(statusValue),
    duration: resolveActiveEffectDuration(durationRounds),
    flags: {
      core: {
        statusId: FRIGHTENED_STATUS_ID
      },
      [MODULE_ID]: {
        [STATUS_ID_FLAG]: FRIGHTENED_STATUS_ID,
        [STATUS_VALUE_FLAG]: statusValue,
        [STATUS_META_FLAG]: cloneData(meta ?? {})
      },
      [STATUS_COUNTER_MODULE_ID]: {
        value: statusValue,
        visible: true,
        config: {
          multiplyEffect: false
        }
      }
    }
  };
}

function getEffectDocumentId(effect) {
  return String(effect?.id ?? effect?._id ?? "").trim();
}

function staticDnd5eStatusEffectId(statusId) {
  const id = `dnd5e${String(statusId ?? "").trim()}`;
  return id.length >= 16 ? id.slice(0, 16) : id.padEnd(16, "0");
}

function buildEffectIdSet(effectIds = []) {
  return new Set((Array.isArray(effectIds) ? effectIds : [effectIds])
    .map((id) => String(id ?? "").trim())
    .filter(Boolean));
}

function getEffectStatusValue(effect, scope, key) {
  try {
    const flagValue = effect?.getFlag?.(scope, key);
    if (flagValue !== undefined) {
      return flagValue;
    }
  }
  catch (_error) {
    // Fall through to direct object reads for source data and tests.
  }

  return getProperty(effect, `flags.${scope}.${key}`);
}

function isTruthyFlagValue(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function isDaeAutoCreatedStaticStatusEffect(effect, statusId) {
  return isTruthyFlagValue(getEffectStatusValue(effect, DAE_MODULE_ID, "autoCreated"))
    && getEffectDocumentId(effect) === staticDnd5eStatusEffectId(statusId);
}

function suppressDaeStaticStatusEffectAnimation(effect, options, statusId) {
  if (!isDaeAutoCreatedStaticStatusEffect(effect, statusId)) {
    return false;
  }

  if (options && typeof options === "object") {
    options.animate = false;
  }

  return false;
}

function readPatchedEffectValue(effect, key) {
  if (!key.includes(".")) {
    return effect?.[key];
  }

  return getProperty(effect, key);
}

function normalizeComparableEffectValue(value) {
  if (value instanceof Set) {
    return [...value].map((entry) => normalizeComparableEffectValue(entry));
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparableEffectValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = normalizeComparableEffectValue(value[key]);
        return result;
      }, {});
  }

  return value;
}

function areEquivalentPatchedEffectValues(current, next) {
  if ((current === null || current === undefined) && (next === null || next === undefined)) {
    return true;
  }

  return JSON.stringify(normalizeComparableEffectValue(current))
    === JSON.stringify(normalizeComparableEffectValue(next));
}

function filterMeaningfulEffectUpdates(effects = [], updates = []) {
  const effectById = new Map((Array.isArray(effects) ? effects : [])
    .map((effect) => [getEffectDocumentId(effect), effect]));

  return (Array.isArray(updates) ? updates : []).filter((update) => {
    const effect = effectById.get(String(update?._id ?? "").trim());
    if (!effect) {
      return true;
    }

    return Object.entries(update).some(([key, value]) => {
      if (key === "_id") {
        return false;
      }

      return !areEquivalentPatchedEffectValues(readPatchedEffectValue(effect, key), value);
    });
  });
}

function resolveManagedStatusIdFromEffect(effect, fallback = "") {
  const candidates = [
    ...extractEffectStatuses(effect),
    getEffectStatusValue(effect, "core", "statusId"),
    getEffectStatusValue(effect, MODULE_ID, STATUS_ID_FLAG),
    stripTrailingStatusValue(effect?.name),
    effect?.name
  ];

  for (const candidate of candidates) {
    const resolvedId = normalizeRebreyaStatusId(candidate, "");
    if (resolvedId) {
      return resolvedId;
    }
  }

  return fallback;
}

function hasDiscreetStatusId(effect) {
  return resolveManagedStatusIdFromEffect(effect, "") === REBREYA_DISCREET_STATUS_ID;
}

function parseDiscreetValueFromName(name) {
  const match = String(name ?? "").match(/(\d+)(?!.*\d)/u);
  return match ? normalizeStatusValue(match[1], 1) : null;
}

function readDiscreetStatusAmount(effect) {
  const counterValue = getEffectStatusValue(effect, STATUS_COUNTER_MODULE_ID, "value");
  if (Number.isFinite(Number(counterValue)) && Number(counterValue) > 0) {
    return {
      hasValue: true,
      value: normalizeStatusValue(counterValue, 1)
    };
  }

  const moduleValue = getEffectStatusValue(effect, MODULE_ID, STATUS_VALUE_FLAG);
  if (Number.isFinite(Number(moduleValue)) && Number(moduleValue) > 0) {
    return {
      hasValue: true,
      value: normalizeStatusValue(moduleValue, 1)
    };
  }

  const nameValue = parseDiscreetValueFromName(effect?.name);
  return nameValue === null
    ? { hasValue: false, value: null }
    : { hasValue: true, value: nameValue };
}

function readDiscreetStatusValue(effect) {
  return readDiscreetStatusAmount(effect).value ?? 0;
}

function hasFrightenedStatusId(effect) {
  if (isDaeAutoCreatedStaticStatusEffect(effect, FRIGHTENED_STATUS_ID)) {
    return false;
  }

  return resolveManagedStatusIdFromEffect(effect, "") === FRIGHTENED_STATUS_ID;
}

function parseFrightenedValueFromName(name) {
  const match = String(name ?? "").match(/(\d+)(?!.*\d)/u);
  return match ? normalizeFrightenedValue(match[1]) : null;
}

function parseGenericStatusValueFromName(name) {
  const match = String(name ?? "").match(/(\d+)(?!.*\d)/u);
  return match ? normalizeStatusValue(match[1], 1) : null;
}

function readFrightenedStatusValue(effect, context = {}) {
  const counterValue = getEffectStatusValue(effect, STATUS_COUNTER_MODULE_ID, "value");
  if (Number.isFinite(Number(counterValue)) && Number(counterValue) > 0) {
    return normalizeFrightenedValue(counterValue, context);
  }

  const moduleValue = getEffectStatusValue(effect, MODULE_ID, STATUS_VALUE_FLAG);
  if (Number.isFinite(Number(moduleValue)) && Number(moduleValue) > 0) {
    return normalizeFrightenedValue(moduleValue, context);
  }

  const nameValue = parseFrightenedValueFromName(effect?.name);
  return nameValue ?? normalizeFrightenedValue(moduleValue, context);
}

function readManagedStatusValue(effect, statusId, context = {}) {
  if (statusId === REBREYA_DISCREET_STATUS_ID) {
    return readDiscreetStatusAmount(effect).value;
  }

  if (statusId === FRIGHTENED_STATUS_ID) {
    return readFrightenedStatusValue(effect, context);
  }

  if (!statusSupportsValue(statusId)) {
    return null;
  }

  const counterValue = getEffectStatusValue(effect, STATUS_COUNTER_MODULE_ID, "value");
  if (Number.isFinite(Number(counterValue)) && Number(counterValue) > 0) {
    return normalizeStatusValue(counterValue, 1);
  }

  const moduleValue = getEffectStatusValue(effect, MODULE_ID, STATUS_VALUE_FLAG);
  if (Number.isFinite(Number(moduleValue)) && Number(moduleValue) > 0) {
    return normalizeStatusValue(moduleValue, 1);
  }

  return parseGenericStatusValueFromName(effect?.name);
}

function buildCanonicalManagedStatusChanges(effect, statusId, value, { actor = null, isStrongest = true } = {}) {
  if (statusId === FRIGHTENED_STATUS_ID) {
    return buildSyncedFrightenedChanges(effect, value, { isStrongest });
  }

  if (statusId === REBREYA_DISCREET_STATUS_ID) {
    if (!isStrongest) {
      return [];
    }

    return value === null
      ? buildDiscreetHalfSpeedChanges(actor)
      : buildDiscreetSpeedChanges(value);
  }

  return buildDynamicStatusChanges(statusId, value) ?? [];
}

function buildCanonicalManagedStatusName(statusId, value, context = {}) {
  if (statusId === FRIGHTENED_STATUS_ID) {
    return frightenedStatusName(value, context);
  }

  if (statusId === REBREYA_DISCREET_STATUS_ID) {
    return value === null ? plainDiscreetStatusName() : discreetStatusName(value);
  }

  return genericStatusName(statusId, value);
}

function buildCanonicalManagedStatusUpdate(effect, statusId, { actor = null, sourceActor = null, isStrongest = true } = {}) {
  const effectId = getEffectDocumentId(effect);
  if (!effectId) {
    return null;
  }

  const isActiveFrightenedStatus = statusId !== FRIGHTENED_STATUS_ID || isStrongest;
  const value = readManagedStatusValue(effect, statusId, { actor, sourceActor });
  const patch = {
    _id: effectId,
    name: buildCanonicalManagedStatusName(statusId, value, { actor, sourceActor }),
    img: statusIcon(statusId),
    icon: statusIcon(statusId),
    statuses: statusId === FRIGHTENED_STATUS_ID
      ? buildSyncedFrightenedStatuses(effect, { isStrongest })
      : [statusId],
    changes: buildCanonicalManagedStatusChanges(effect, statusId, value, { actor, isStrongest }),
    "flags.core.statusId": isActiveFrightenedStatus ? statusId : null,
    [`flags.${MODULE_ID}.${STATUS_ID_FLAG}`]: statusId
  };

  if (statusId === FRIGHTENED_STATUS_ID && (effect?.disabled === true || !isStrongest)) {
    patch.disabled = !isStrongest;
  }

  const meta = getEffectStatusValue(effect, MODULE_ID, STATUS_META_FLAG);
  if (meta !== undefined) {
    patch[`flags.${MODULE_ID}.${STATUS_META_FLAG}`] = cloneData(meta ?? {});
  }

  if (statusSupportsValue(statusId)) {
    patch[`flags.${MODULE_ID}.${STATUS_VALUE_FLAG}`] = value ?? null;
    if (value !== null && value !== undefined && isActiveFrightenedStatus) {
      patch[`flags.${STATUS_COUNTER_MODULE_ID}.value`] = value;
      patch[`flags.${STATUS_COUNTER_MODULE_ID}.visible`] = true;
    }
    else {
      patch[`flags.${STATUS_COUNTER_MODULE_ID}.visible`] = false;
    }
  }

  return patch;
}

export function buildFrightenedStatusSyncUpdates(effects = [], {
  actor = null,
  sourceActor = null,
  sourceActorByEffectId = new Map(),
  excludeEffectIds = [],
  skipUpdateEffectIds = []
} = {}) {
  const sourceActorLookup = sourceActorByEffectId instanceof Map ? sourceActorByEffectId : new Map();
  const excludedIds = buildEffectIdSet(excludeEffectIds);
  const skippedUpdateIds = buildEffectIdSet(skipUpdateEffectIds);
  const allRows = (Array.isArray(effects) ? effects : [])
    .filter(hasFrightenedStatusId)
    .map((effect, index) => {
      const id = getEffectDocumentId(effect);
      const rowSourceActor = sourceActorLookup.get(id) ?? sourceActor;
      const value = readFrightenedStatusValue(effect, { actor, sourceActor: rowSourceActor });
      return {
        effect,
        index,
        id,
        value
      };
    })
    .filter((row) => !excludedIds.has(row.id))
    .filter((row) => row.id);
  const rows = allRows
    .filter((row) => row.value > 0);

  if (!rows.length) {
    return [];
  }

  const strongest = rows.reduce((best, row) => {
    if (!best || row.value > best.value) {
      return row;
    }

    return best;
  }, null);

  return rows
    .filter((row) => !skippedUpdateIds.has(row.id))
    .map((row) => {
      const isStrongest = row.id === strongest.id;
      const update = {
        _id: row.id,
        name: frightenedStatusName(row.value),
        img: statusIcon(FRIGHTENED_STATUS_ID),
        icon: statusIcon(FRIGHTENED_STATUS_ID),
        statuses: buildSyncedFrightenedStatuses(row.effect, { isStrongest }),
        changes: buildSyncedFrightenedChanges(row.effect, row.value, { isStrongest }),
        "flags.core.statusId": isStrongest ? FRIGHTENED_STATUS_ID : null,
        [`flags.${MODULE_ID}.${STATUS_ID_FLAG}`]: FRIGHTENED_STATUS_ID,
        [`flags.${MODULE_ID}.${STATUS_VALUE_FLAG}`]: row.value,
        [`flags.${STATUS_COUNTER_MODULE_ID}.visible`]: isStrongest
      };

      if (row.effect?.disabled === true || !isStrongest) {
        update.disabled = !isStrongest;
      }

      if (isStrongest) {
        update[`flags.${STATUS_COUNTER_MODULE_ID}.value`] = row.value;
      }

      return update;
    });
}

export function buildDiscreetStatusSyncUpdates(effects = [], {
  actor = null,
  excludeEffectIds = [],
  skipUpdateEffectIds = []
} = {}) {
  const excludedIds = buildEffectIdSet(excludeEffectIds);
  const skippedUpdateIds = buildEffectIdSet(skipUpdateEffectIds);
  const rows = (Array.isArray(effects) ? effects : [])
    .filter(hasDiscreetStatusId)
    .map((effect, index) => ({
      effect,
      index,
      id: getEffectDocumentId(effect),
      amount: readDiscreetStatusAmount(effect)
    }))
    .filter((row) => !excludedIds.has(row.id))
    .map((row) => ({
      ...row,
      strength: row.amount.hasValue ? row.amount.value : getDiscreetHalfSpeedStrength(actor)
    }))
    .filter((row) => row.id && row.strength > 0);

  if (!rows.length) {
    return [];
  }

  const strongest = rows.reduce((best, row) => {
    if (!best || row.strength > best.strength) {
      return row;
    }

    return best;
  }, null);

  return rows
    .filter((row) => !skippedUpdateIds.has(row.id))
    .map((row) => {
      const hasValue = row.amount.hasValue;
      return {
        _id: row.id,
        name: hasValue ? discreetStatusName(row.amount.value) : plainDiscreetStatusName(),
        img: statusIcon(REBREYA_DISCREET_STATUS_ID),
        icon: statusIcon(REBREYA_DISCREET_STATUS_ID),
        statuses: [REBREYA_DISCREET_STATUS_ID],
        changes: row.id === strongest.id
          ? (hasValue ? buildDiscreetSpeedChanges(row.amount.value) : buildDiscreetHalfSpeedChanges(actor))
          : [],
        "flags.core.statusId": REBREYA_DISCREET_STATUS_ID,
        [`flags.${MODULE_ID}.${STATUS_ID_FLAG}`]: REBREYA_DISCREET_STATUS_ID,
        [`flags.${MODULE_ID}.${STATUS_VALUE_FLAG}`]: hasValue ? row.amount.value : null,
        ...(hasValue ? {
          [`flags.${STATUS_COUNTER_MODULE_ID}.value`]: row.amount.value,
          [`flags.${STATUS_COUNTER_MODULE_ID}.visible`]: true
        } : {
          [`flags.${STATUS_COUNTER_MODULE_ID}.visible`]: false
        })
      };
    });
}

function buildStaticStatusChanges(statusId) {
  const changes = getRebreyaStatusDefinition(statusId)?.changes;
  return Array.isArray(changes)
    ? changes.map(cloneData).filter(Boolean)
    : null;
}

function buildDynamicStatusChanges(statusId, value) {
  if (statusId === FRIGHTENED_STATUS_ID) {
    return buildFrightenedChanges(value);
  }

  return buildStaticStatusChanges(statusId);
}

export function registerCombatStatusConfig() {
  const coreStatusEffects = Array.isArray(CONFIG?.statusEffects) ? CONFIG.statusEffects : null;
  const dnd5eStatusEffects =
    CONFIG?.DND5E?.statusEffects && typeof CONFIG.DND5E.statusEffects === "object"
      ? CONFIG.DND5E.statusEffects
      : null;

  if (!coreStatusEffects && !dnd5eStatusEffects) {
    return;
  }

  for (const statusId of getManagedNativeStatusIds()) {
    const coreStatusEffect = coreStatusEffects?.find((row) => String(row?.id ?? row?._id ?? "").trim() === statusId);
    if (coreStatusEffect) {
      // DAE treats self-referential status configs as already canonical and skips auto-creating a second static effect.
      ensureSelfReferentialStatusConfig(coreStatusEffect, statusId);
    }

    const dnd5eStatusEffect = dnd5eStatusEffects?.[statusId];
    if (dnd5eStatusEffect) {
      ensureSelfReferentialStatusConfig(dnd5eStatusEffect, statusId);
    }
  }

  const knownIds = new Set(
    (coreStatusEffects ?? [])
      .map((row) => String(row?.id ?? row?._id ?? "").trim())
      .filter(Boolean)
  );

  for (const row of REBREYA_STATUS_DEFINITIONS) {
    const statusConfig = buildRebreyaStatusConfig(row.id);
    if (!statusConfig) {
      continue;
    }

    if (
      dnd5eStatusEffects
      && shouldRegisterDnd5eStatusEffect(row.id)
      && !Object.hasOwn(dnd5eStatusEffects, statusConfig.id)
    ) {
      dnd5eStatusEffects[statusConfig.id] = {
        name: statusConfig.name,
        img: statusConfig.img,
        icon: statusConfig.icon,
        statuses: statusConfig.statuses,
        flags: statusConfig.flags
      };
    }

    if (coreStatusEffects && !knownIds.has(statusConfig.id)) {
      coreStatusEffects.push(statusConfig);
      knownIds.add(statusConfig.id);
    }
  }
}

export class CombatStatusService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
    this._internalActorUpdates = new Set();
    this._discreetSyncActorIds = new Set();
    this._frightenedSyncActorIds = new Set();
    this._managedEffectCanonicalizationIds = new Set();
    this._pendingManagedStatusCreates = new Set();
    this._turnLocks = new Set();
  }

  async initialize() {
    return this.syncBloodiedForAllActors();
  }

  getStatusDefinitions() {
    return REBREYA_STATUS_DEFINITIONS.map((row) => ({ ...row }));
  }

  normalizeStatusId(value, fallback = "") {
    return normalizeRebreyaStatusId(value, fallback);
  }

  getStatusDefinition(statusInput) {
    const statusId = this.#resolveStatusId(statusInput);
    if (!statusId) {
      return null;
    }

    return getRebreyaStatusDefinition(statusId);
  }

  #buildManagedEffectLockKey(effect) {
    return getEffectDocumentId(effect);
  }

  #isManagedEffectCanonicalizationInProgress(effect) {
    const lockKey = this.#buildManagedEffectLockKey(effect);
    return Boolean(lockKey) && this._managedEffectCanonicalizationIds.has(lockKey);
  }

  async #withManagedEffectCanonicalizationLock(effect, task) {
    const lockKey = this.#buildManagedEffectLockKey(effect);
    if (!lockKey) {
      return task();
    }

    this._managedEffectCanonicalizationIds.add(lockKey);
    try {
      return await task();
    }
    finally {
      this._managedEffectCanonicalizationIds.delete(lockKey);
    }
  }

  #buildPendingStatusCreateKey(actor, statusId) {
    const actorId = String(actor?.id ?? "").trim();
    const safeStatusId = String(statusId ?? "").trim();
    return actorId && safeStatusId ? `${actorId}:${safeStatusId}` : "";
  }

  #isPendingManagedStatusCreate(actor, statusId) {
    const key = this.#buildPendingStatusCreateKey(actor, statusId);
    return Boolean(key) && this._pendingManagedStatusCreates.has(key);
  }

  async #withPendingManagedStatusCreate(actor, statusId, task) {
    const key = this.#buildPendingStatusCreateKey(actor, statusId);
    if (!key) {
      return task();
    }

    this._pendingManagedStatusCreates.add(key);
    try {
      return await task();
    }
    finally {
      this._pendingManagedStatusCreates.delete(key);
    }
  }

  async bindTokenHud(app, html) {
    const root = getDialogRoot(html);
    if (!(root instanceof HTMLElement)) {
      return;
    }

    if (root.dataset.rebreyaStatusHudBound === "1") {
      return;
    }
    root.dataset.rebreyaStatusHudBound = "1";

    const handler = (event) => {
      this.#handleTokenHudStatusInteraction(event, app).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle token HUD status interaction.`, error);
      });
    };

    root.addEventListener("click", handler, true);
    root.addEventListener("contextmenu", handler, true);
  }

  #resolveActor(actorOrId) {
    if (actorOrId instanceof Actor) {
      return actorOrId;
    }

    if (typeof actorOrId === "string") {
      return game.actors?.get?.(actorOrId) ?? null;
    }

    return null;
  }

  #resolveStatusId(statusInput) {
    const normalized = normalizeRebreyaStatusId(statusInput, "");
    if (normalized) {
      return normalized;
    }

    return String(statusInput ?? "").trim();
  }

  #resolveHudActor(app) {
    if (app?.object?.actor instanceof Actor) {
      return app.object.actor;
    }

    if (canvas?.hud?.token?.object?.actor instanceof Actor) {
      return canvas.hud.token.object.actor;
    }

    return null;
  }

  #resolveHudDurationSourceActor(actor) {
    const targets = Array.from(globalThis.game?.user?.targets ?? []);
    if (targets.length === 1) {
      const targetActor = targets[0]?.actor
        ?? targets[0]?.document?.actor
        ?? targets[0]?.object?.actor
        ?? null;
      if (targetActor instanceof Actor) {
        return targetActor;
      }
    }

    return actor instanceof Actor ? actor : null;
  }

  #readStatusControlFromEvent(event) {
    const target = event?.target;
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    return target.closest?.(".effect-control[data-status-id]") ?? null;
  }

  #stopHudEvent(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
  }

  #statusDisplayName(statusId, effect = null) {
    return stripTrailingStatusValue(effect?.name)
      || configStatusLabel(statusId)
      || statusLabel(statusId)
      || String(statusId ?? "").trim()
      || "Состояние";
  }

  async #promptStatusValue(definition, currentValue = 1) {
    return new Promise((resolve) => {
      let settled = false;
      const allowUnvalued = definition?.id === REBREYA_DISCREET_STATUS_ID;
      const buttons = {
        confirm: {
          label: "Применить",
          callback: (html) => {
            const root = getDialogRoot(html);
            const input = root?.querySelector("[data-field='status-value']");
            const rawValue = String(input?.value ?? "").trim();
            settled = true;
            resolve(allowUnvalued && !rawValue ? null : normalizeStatusValue(rawValue, 1));
          }
        },
        ...(allowUnvalued ? {
          unvalued: {
            label: "Без значения",
            callback: () => {
              settled = true;
              resolve(null);
            }
          }
        } : {}),
        cancel: {
          label: "Отмена",
          callback: () => {
            settled = true;
            resolve(undefined);
          }
        }
      };

      const dialog = new Dialog({
        title: definition?.label ? `${definition.label}: значение` : "Введите значение состояния",
        content: `
          <form class="rm-purchase-dialog">
            <div class="rm-field">
              <label for="rm-status-value">Значение</label>
              <input
                id="rm-status-value"
                type="number"
                min="1"
                step="1"
                value="${foundry.utils.escapeHTML(String(normalizeStatusValue(currentValue, 1)))}"
                placeholder="${allowUnvalued ? "Без значения" : ""}"
                data-field="status-value"
              >
            </div>
          </form>
        `,
        buttons,
        default: "confirm",
        render: (html) => {
          const root = getDialogRoot(html);
          const input = root?.querySelector("[data-field='status-value']");
          if (input instanceof HTMLInputElement) {
            input.focus();
            input.select();
          }
        },
        close: () => {
          if (!settled) {
            resolve(undefined);
          }
        }
      }, {
        classes: ["rebreya-main", "rebreya-trader-dialog"]
      });

      dialog.render(true);
    });
  }

  async #promptStatusDuration(statusName, sourceActor) {
    return new Promise((resolve) => {
      let settled = false;
      const referenceLabel = String(sourceActor?.name ?? "").trim() || "носителя состояния";
      const dialog = new Dialog({
        title: `${statusName}: длительность`,
        content: `
          <form class="rm-purchase-dialog">
            <p>Точка отсчёта: <strong>${foundry.utils.escapeHTML(referenceLabel)}</strong></p>
            <p>Выберите, когда снять состояние.</p>
          </form>
        `,
        buttons: {
          turnStart: {
            label: "До начала следующего хода",
            callback: () => {
              settled = true;
              resolve(DAE_SPECIAL_DURATION_TURN_START_SOURCE);
            }
          },
          turnEnd: {
            label: "До конца следующего хода",
            callback: () => {
              settled = true;
              resolve(DAE_SPECIAL_DURATION_TURN_END_SOURCE);
            }
          },
          cancel: {
            label: "Отмена",
            callback: () => {
              settled = true;
              resolve(undefined);
            }
          }
        },
        default: "turnStart",
        close: () => {
          if (!settled) {
            resolve(undefined);
          }
        }
      }, {
        classes: ["rebreya-main", "rebreya-trader-dialog", "rm-status-duration-dialog"],
        width: 560
      });

      dialog.render(true);
    });
  }

  async #applyTimedHudStatusEffect(effect, sourceActor, durationMode) {
    if (!effect || typeof effect.update !== "function") {
      return false;
    }

    const sourceActorId = String(sourceActor?.id ?? "").trim();
    const sourceActorUuid = String(sourceActor?.uuid ?? "").trim();
    if (!sourceActorId || !sourceActorUuid) {
      return false;
    }

    const meta = cloneData(getEffectStatusValue(effect, MODULE_ID, STATUS_META_FLAG) ?? {});
    meta.sourceActorId = sourceActorId;
    meta.sourceActorUuid = sourceActorUuid;
    meta.sourceActorName = String(sourceActor?.name ?? "").trim();
    meta.durationMode = String(durationMode ?? "").trim();
    meta.durationLabel = timedStatusDurationLabel(durationMode);

    await effect.update({
      origin: sourceActorUuid,
      duration: buildCombatTurnDuration(1),
      [`flags.${MODULE_ID}.${STATUS_META_FLAG}`]: meta,
      "flags.dae.specialDuration": [durationMode, "combatEnd"]
    });

    return true;
  }

  async #handleTokenHudStatusInteraction(event, app) {
    const control = this.#readStatusControlFromEvent(event);
    if (!(control instanceof HTMLElement)) {
      return;
    }

    const rawStatusId = String(control.dataset.statusId ?? "").trim();
    const statusId = this.#resolveStatusId(rawStatusId);
    const definition = getRebreyaStatusDefinition(statusId);
    const actor = this.#resolveHudActor(app);
    if (!(actor instanceof Actor)) {
      return;
    }

    const currentEffect = this.#findStatusEffect(actor, statusId);
    const currentStatus = this.getStatus(actor, statusId);
    if (event.type === "click" && event.button === 0 && event.ctrlKey === true) {
      if (!globalThis.game?.combat) {
        ui.notifications?.warn?.("Боевые длительности доступны только в активном бою.");
        return;
      }

      this.#stopHudEvent(event);

      let nextValue = currentStatus?.value ?? 1;
      if (statusSupportsValue(statusId)) {
        nextValue = await this.#promptStatusValue(
          definition ?? {
            id: statusId,
            label: this.#statusDisplayName(statusId, currentEffect),
            supportsValue: true
          },
          currentStatus?.value ?? 1
        );
        if (nextValue === undefined) {
          return;
        }
      }

      const sourceActor = this.#resolveHudDurationSourceActor(actor);
      const durationMode = await this.#promptStatusDuration(
        this.#statusDisplayName(statusId, currentEffect),
        sourceActor
      );
      if (!durationMode) {
        return;
      }

      let effect = currentEffect;
      if (!effect || statusSupportsValue(statusId)) {
        const statusOptions = {
          active: true,
          ...(statusSupportsValue(statusId) ? { value: nextValue } : {}),
          ...(sourceActor instanceof Actor ? { sourceActor } : {})
        };
        const result = await this.setStatus(actor, statusId, statusOptions);
        effect = result instanceof ActiveEffect ? result : this.#findStatusEffect(actor, statusId);
      }

      if (!effect || !(sourceActor instanceof Actor)) {
        return;
      }

      await this.#applyTimedHudStatusEffect(effect, sourceActor, durationMode);
      return;
    }

    if (!definition?.supportsValue) {
      return;
    }

    if (statusId === REBREYA_DISCREET_STATUS_ID) {
      if (event.type !== "click" || event.button !== 0) {
        return;
      }

      this.#stopHudEvent(event);

      const nextValue = await this.#promptStatusValue(definition, currentStatus?.value ?? 1);
      if (nextValue === undefined) {
        return;
      }

      await this.setStatus(actor, statusId, {
        active: true,
        value: nextValue
      });
      return;
    }

    if (event.type === "contextmenu") {
      this.#stopHudEvent(event);

      if (currentStatus?.active) {
        await this.clearStatus(actor, statusId);
      }
      return;
    }

    if (event.type !== "click" || event.button !== 0) {
      return;
    }

    this.#stopHudEvent(event);

    const nextValue = await this.#promptStatusValue(definition, currentStatus?.value ?? 1);
    if (nextValue === undefined) {
      return;
    }

    await this.setStatus(actor, statusId, {
      active: true,
      value: nextValue
    });
  }

  #findStatusEffect(actor, statusId) {
    if (!(actor instanceof Actor) || !statusId) {
      return null;
    }

    if (statusId === REBREYA_DISCREET_STATUS_ID) {
      return this.#getDiscreetStatusEffects(actor)
        .sort((left, right) => readDiscreetStatusValue(right) - readDiscreetStatusValue(left))[0] ?? null;
    }

    if (statusId === FRIGHTENED_STATUS_ID) {
      return this.#getFrightenedStatusEffects(actor)
        .sort((left, right) => readFrightenedStatusValue(right, { actor }) - readFrightenedStatusValue(left, { actor }))[0]
        ?? null;
    }

    return actor.effects.contents.find((effect) => {
      const managedStatusId = resolveManagedStatusIdFromEffect(effect, "");
      if (managedStatusId === statusId) {
        return true;
      }

      if (extractEffectStatuses(effect).includes(statusId)) {
        return true;
      }

      return String(getEffectStatusValue(effect, "core", "statusId") ?? "").trim() === statusId;
    }) ?? null;
  }

  #buildFallbackEffectData(statusId, options = {}) {
    if (statusId === REBREYA_DISCREET_STATUS_ID) {
      return buildDiscreetStatusEffectData(options.value, {
        durationRounds: options.durationRounds,
        meta: options.meta ?? {}
      });
    }

    if (statusId === FRIGHTENED_STATUS_ID) {
      return buildFrightenedStatusEffectData(options.value, {
        durationRounds: options.durationRounds,
        meta: options.meta ?? {},
        actor: options.actor ?? null,
        sourceActor: options.sourceActor ?? null
      });
    }

    const definition = getRebreyaStatusDefinition(statusId);
    const statusLabel = definition?.label ?? statusId;
    const statusIcon = definition?.icon ?? "icons/svg/aura.svg";
    const dynamicChanges = buildDynamicStatusChanges(statusId, options.value);
    return {
      name: statusLabel,
      img: statusIcon,
      icon: statusIcon,
      statuses: buildEffectStatusesSet(statusId),
      disabled: false,
      transfer: false,
      changes: Array.isArray(dynamicChanges) ? dynamicChanges : [],
      duration: resolveActiveEffectDuration(options.durationRounds),
      flags: {
        core: {
          statusId
        },
        [MODULE_ID]: {
          [STATUS_ID_FLAG]: statusId,
          [STATUS_VALUE_FLAG]: options.value ?? null,
          [STATUS_META_FLAG]: foundry.utils.deepClone(options.meta ?? {})
        }
      }
    };
  }

  async #storeStatusMetadata(effect, statusId, options = {}) {
    if (!effect) {
      return;
    }

    const patch = {
      [`flags.${MODULE_ID}.${STATUS_ID_FLAG}`]: statusId
    };
    let statusValue = options.value;
    if (Object.hasOwn(options, "value")) {
      statusValue = statusId === FRIGHTENED_STATUS_ID
        ? normalizeFrightenedValue(options.value, {
          actor: options.actor ?? null,
          sourceActor: options.sourceActor ?? null
        })
        : (statusSupportsValue(statusId) ? normalizeStatusValue(options.value, 1) : options.value);
      patch[`flags.${MODULE_ID}.${STATUS_VALUE_FLAG}`] = statusValue;
      if (statusSupportsValue(statusId)) {
        patch.name = buildCanonicalManagedStatusName(statusId, statusValue, {
          actor: options.actor ?? null,
          sourceActor: options.sourceActor ?? null
        });
        patch.img = statusIcon(statusId);
        patch.icon = statusIcon(statusId);
        patch.statuses = [statusId];
        patch["flags.core.statusId"] = statusId;
        patch[`flags.${STATUS_COUNTER_MODULE_ID}.value`] = statusValue;
        patch[`flags.${STATUS_COUNTER_MODULE_ID}.visible`] = true;
      }
    }
    if (Object.hasOwn(options, "value") || !statusSupportsValue(statusId)) {
      const dynamicChanges = buildDynamicStatusChanges(statusId, statusValue);
      if (Array.isArray(dynamicChanges)) {
        patch.changes = dynamicChanges;
      }
    }
    if (Object.hasOwn(options, "meta")) {
      patch[`flags.${MODULE_ID}.${STATUS_META_FLAG}`] = cloneData(options.meta ?? {});
    }

    await effect.update(patch);
  }

  async setStatus(actorOrId, statusInput, options = {}) {
    const actor = this.#resolveActor(actorOrId);
    if (!(actor instanceof Actor)) {
      throw new Error("Не удалось определить актёра для изменения состояния.");
    }

    const statusId = this.#resolveStatusId(statusInput);
    if (!statusId) {
      throw new Error("Не указан идентификатор состояния.");
    }

    const active = options.active !== false;
    const statusOptions = active && statusId === FRIGHTENED_STATUS_ID
      ? {
        ...options,
        value: normalizeFrightenedValue(Object.hasOwn(options, "value") ? options.value : null, {
          actor,
          sourceActor: options.sourceActor ?? null
        })
      }
      : options;
    const overlay = statusOptions.overlay === true;
    const durationRounds = toNumber(statusOptions.durationRounds, DEFAULT_DURATION_ROUNDS);
    if (statusId === REBREYA_DISCREET_STATUS_ID) {
      if (!active) {
        return this.#clearDiscreetStatuses(actor);
      }

      return this.#createDiscreetStatus(actor, {
        value: statusOptions.value,
        durationRounds,
        meta: statusOptions.meta ?? {}
      });
    }

    const current = this.#findStatusEffect(actor, statusId);

    if (!active) {
      if (!current) {
        return false;
      }

      const currentStatusIds = extractEffectStatuses(current);
      const currentIsLegacyFrightened = statusId === FRIGHTENED_STATUS_ID
        && currentStatusIds.includes(LEGACY_REBREYA_FRIGHTENED_STATUS_ID)
        && !currentStatusIds.includes(FRIGHTENED_STATUS_ID);
      if (!currentIsLegacyFrightened && canUseNativeStatusToggle(actor, statusId)) {
        await actor.toggleStatusEffect(statusId, { active: false, overlay });
      }
      else {
        await current.delete();
      }

      return true;
    }

    let effect = current;
    if (!effect) {
      if (canUseNativeStatusToggle(actor, statusId)) {
        const result = await this.#withPendingManagedStatusCreate(
          actor,
          statusId,
          () => actor.toggleStatusEffect(statusId, { active: true, overlay })
        );
        if (result instanceof ActiveEffect) {
          effect = result;
        }
        else {
          effect = this.#findStatusEffect(actor, statusId);
        }
      }

      if (!effect) {
        const [created] = await this.#withPendingManagedStatusCreate(actor, statusId, () => actor.createEmbeddedDocuments("ActiveEffect", [
          this.#buildFallbackEffectData(statusId, {
            durationRounds,
            value: Object.hasOwn(statusOptions, "value") ? statusOptions.value : null,
            meta: statusOptions.meta ?? {},
            actor,
            sourceActor: statusOptions.sourceActor ?? null
          })
        ]));
        effect = created ?? null;
      }
    }

    if (effect && (Object.hasOwn(statusOptions, "value") || Object.hasOwn(statusOptions, "meta"))) {
      await this.#storeStatusMetadata(effect, statusId, {
        value: statusOptions.value,
        meta: statusOptions.meta,
        actor,
        sourceActor: statusOptions.sourceActor ?? null
      });
    }

    if (effect && statusId === FRIGHTENED_STATUS_ID) {
      await this.#syncFrightenedStatusEffects(actor, {
        sourceActor: statusOptions.sourceActor ?? null
      });
    }

    return effect ?? true;
  }

  async clearStatus(actorOrId, statusInput, options = {}) {
    return this.setStatus(actorOrId, statusInput, {
      ...options,
      active: false
    });
  }

  getStatus(actorOrId, statusInput) {
    const actor = this.#resolveActor(actorOrId);
    if (!(actor instanceof Actor)) {
      return null;
    }

    const statusId = this.#resolveStatusId(statusInput);
    if (!statusId) {
      return null;
    }

    const effect = this.#findStatusEffect(actor, statusId);
    const value = statusId === REBREYA_DISCREET_STATUS_ID && effect
      ? readDiscreetStatusValue(effect)
      : (statusId === FRIGHTENED_STATUS_ID && effect
        ? readFrightenedStatusValue(effect, { actor })
        : effect?.getFlag(MODULE_ID, STATUS_VALUE_FLAG) ?? null);
    const meta = effect?.getFlag(MODULE_ID, STATUS_META_FLAG) ?? {};

    return {
      actorId: actor.id,
      statusId,
      active: Boolean(effect),
      value,
      meta: foundry.utils.deepClone(meta ?? {}),
      effectId: effect?.id ?? null
    };
  }

  async setStatusValue(actorOrId, statusInput, value, meta = undefined) {
    const actor = this.#resolveActor(actorOrId);
    if (!(actor instanceof Actor)) {
      throw new Error("Не удалось определить актёра для изменения значения состояния.");
    }

    const statusId = this.#resolveStatusId(statusInput);
    if (!statusId) {
      throw new Error("Не указан идентификатор состояния.");
    }

    const statusValue = statusId === FRIGHTENED_STATUS_ID
      ? normalizeFrightenedValue(value, { actor })
      : value;
    const effect = this.#findStatusEffect(actor, statusId);
    if (!effect) {
      return this.setStatus(actor, statusId, {
        active: true,
        value: statusValue,
        meta
      });
    }

    await this.#storeStatusMetadata(effect, statusId, {
      value: statusValue,
      meta,
      actor
    });
    if (statusId === REBREYA_DISCREET_STATUS_ID) {
      await this.#syncDiscreetStatusEffects(actor);
    }
    if (statusId === FRIGHTENED_STATUS_ID) {
      await this.#syncFrightenedStatusEffects(actor);
    }
    return effect;
  }

  #getDiscreetStatusEffects(actor) {
    if (!(actor instanceof Actor)) {
      return [];
    }

    return (actor.effects?.contents ?? []).filter(hasDiscreetStatusId);
  }

  #getFrightenedStatusEffects(actor) {
    if (!(actor instanceof Actor)) {
      return [];
    }

    return (actor.effects?.contents ?? []).filter(hasFrightenedStatusId);
  }

  async #resolveEffectSourceActor(effect) {
    const meta = getEffectStatusValue(effect, MODULE_ID, STATUS_META_FLAG);
    const sourceActorId = String(meta?.sourceActorId ?? "").trim();
    if (sourceActorId) {
      const sourceActor = game.actors?.get?.(sourceActorId) ?? null;
      if (sourceActor instanceof Actor) {
        return sourceActor;
      }
    }

    const origin = String(effect?.origin ?? getProperty(effect, "origin", "") ?? "").trim();
    if (!origin || typeof fromUuid !== "function") {
      return null;
    }

    try {
      const document = await fromUuid(origin);
      if (document instanceof Actor) {
        return document;
      }
      if (document?.actor instanceof Actor) {
        return document.actor;
      }
      if (document?.parent instanceof Actor) {
        return document.parent;
      }
      if (document?.parent?.actor instanceof Actor) {
        return document.parent.actor;
      }
    }
    catch (_error) {
      return null;
    }

    return null;
  }

  async #buildFrightenedSourceActorMap(effects) {
    const sourceActorByEffectId = new Map();
    for (const effect of effects) {
      const id = getEffectDocumentId(effect);
      if (!id) {
        continue;
      }

      const sourceActor = await this.#resolveEffectSourceActor(effect);
      if (sourceActor instanceof Actor) {
        sourceActorByEffectId.set(id, sourceActor);
      }
    }

    return sourceActorByEffectId;
  }

  async #createDiscreetStatus(actor, { value = 1, durationRounds = DEFAULT_DURATION_ROUNDS, meta = {} } = {}) {
    const [created] = await this.#withPendingManagedStatusCreate(actor, REBREYA_DISCREET_STATUS_ID, () => actor.createEmbeddedDocuments("ActiveEffect", [
      buildDiscreetStatusEffectData(value, {
        durationRounds,
        meta
      })
    ]));

    await this.#syncDiscreetStatusEffects(actor);
    return created ?? true;
  }

  async #clearDiscreetStatuses(actor) {
    const effects = this.#getDiscreetStatusEffects(actor);
    if (!effects.length) {
      return false;
    }

    const effectIds = effects.map((effect) => effect.id ?? effect._id).filter(Boolean);
    if (typeof actor.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("ActiveEffect", effectIds);
    }
    else {
      for (const effect of effects) {
        await effect.delete?.();
      }
    }

    return true;
  }

  async #syncDiscreetStatusEffects(actor, { excludeEffectIds = [], skipUpdateEffectIds = [] } = {}) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    if (this._discreetSyncActorIds.has(actor.id)) {
      return false;
    }

    const effects = this.#getDiscreetStatusEffects(actor);
    const updates = buildDiscreetStatusSyncUpdates(effects, { actor, excludeEffectIds, skipUpdateEffectIds });
    const meaningfulUpdates = filterMeaningfulEffectUpdates(effects, updates);
    if (!meaningfulUpdates.length) {
      return false;
    }

    this._discreetSyncActorIds.add(actor.id);
    try {
      if (typeof actor.updateEmbeddedDocuments === "function") {
        await actor.updateEmbeddedDocuments("ActiveEffect", meaningfulUpdates);
      }
      else {
        for (const update of meaningfulUpdates) {
          const effect = effects.find((candidate) => getEffectDocumentId(candidate) === update._id);
          await effect?.update?.(update);
        }
      }

      return true;
    }
    finally {
      this._discreetSyncActorIds.delete(actor.id);
    }
  }

  async #syncFrightenedStatusEffects(actor, { sourceActor = null, excludeEffectIds = [], skipUpdateEffectIds = [] } = {}) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    if (this._frightenedSyncActorIds.has(actor.id)) {
      return false;
    }

    const effects = this.#getFrightenedStatusEffects(actor);
    const sourceActorByEffectId = await this.#buildFrightenedSourceActorMap(effects);
    const updates = buildFrightenedStatusSyncUpdates(effects, {
      actor,
      sourceActor,
      sourceActorByEffectId,
      excludeEffectIds,
      skipUpdateEffectIds
    });
    const meaningfulUpdates = filterMeaningfulEffectUpdates(effects, updates);
    if (!meaningfulUpdates.length) {
      return false;
    }

    const effectById = new Map(effects.map((effect) => [getEffectDocumentId(effect), effect]));
    const databaseUpdates = [];

    for (const update of meaningfulUpdates) {
      const effect = effectById.get(String(update?._id ?? "").trim());
      if (effect) {
        databaseUpdates.push(update);
      }
    }

    if (!databaseUpdates.length) {
      return false;
    }

    this._frightenedSyncActorIds.add(actor.id);
    try {
      if (typeof actor.updateEmbeddedDocuments === "function") {
        await actor.updateEmbeddedDocuments("ActiveEffect", databaseUpdates);
      }
      else {
        for (const update of databaseUpdates) {
          const effect = effects.find((candidate) => getEffectDocumentId(candidate) === update._id);
          await effect?.update?.(update);
        }
      }

      return true;
    }
    finally {
      this._frightenedSyncActorIds.delete(actor.id);
    }
  }

  async #canonicalizeManagedStatusEffect(effect, statusId) {
    if (!(effect?.parent instanceof Actor) || !statusId) {
      return false;
    }

    const update = buildCanonicalManagedStatusUpdate(effect, statusId, {
      actor: effect.parent
    });
    if (!update) {
      return false;
    }

    return this.#withManagedEffectCanonicalizationLock(effect, async () => {
      const [meaningfulUpdate] = filterMeaningfulEffectUpdates([effect], [update]);
      if (!meaningfulUpdate) {
        return false;
      }

      if (typeof effect.parent.updateEmbeddedDocuments === "function") {
        await effect.parent.updateEmbeddedDocuments("ActiveEffect", [meaningfulUpdate]);
      }
      else {
        await effect.update?.(meaningfulUpdate);
      }
      return true;
    });
  }

  async handleActiveEffectUpdate(effect) {
    if (this.#isManagedEffectCanonicalizationInProgress(effect)) {
      return false;
    }

    if (isDaeAutoCreatedStaticStatusEffect(effect, FRIGHTENED_STATUS_ID)) {
      return false;
    }

    const managedStatusId = resolveManagedStatusIdFromEffect(effect, "");
    if (!managedStatusId) {
      return false;
    }

    if (managedStatusId === REBREYA_DISCREET_STATUS_ID) {
      return this.#syncDiscreetStatusEffects(effect.parent);
    }

    if (managedStatusId === FRIGHTENED_STATUS_ID) {
      return this.#syncFrightenedStatusEffects(effect.parent);
    }

    return this.#canonicalizeManagedStatusEffect(effect, managedStatusId);
  }

  prepareActiveEffectCreate(effect, options = {}) {
    return suppressDaeStaticStatusEffectAnimation(effect, options, FRIGHTENED_STATUS_ID);
  }

  prepareActiveEffectDelete(effect, options = {}) {
    return suppressDaeStaticStatusEffectAnimation(effect, options, FRIGHTENED_STATUS_ID);
  }

  async handleActiveEffectCreated(effect) {
    if (isDaeAutoCreatedStaticStatusEffect(effect, FRIGHTENED_STATUS_ID)) {
      return false;
    }

    const createdEffectId = getEffectDocumentId(effect);
    const managedStatusId = resolveManagedStatusIdFromEffect(effect, "");
    if (!managedStatusId) {
      return false;
    }

    const shouldSkipCreatedEffect = this.#isPendingManagedStatusCreate(effect.parent, managedStatusId);
    if (managedStatusId === REBREYA_DISCREET_STATUS_ID) {
      return this.#syncDiscreetStatusEffects(effect.parent, shouldSkipCreatedEffect ? { skipUpdateEffectIds: [createdEffectId] } : {});
    }

    if (managedStatusId === FRIGHTENED_STATUS_ID) {
      return this.#syncFrightenedStatusEffects(effect.parent, shouldSkipCreatedEffect ? { skipUpdateEffectIds: [createdEffectId] } : {});
    }

    if (shouldSkipCreatedEffect) {
      return false;
    }

    return this.#canonicalizeManagedStatusEffect(effect, managedStatusId);
  }

  async handleActiveEffectDeleted(effect) {
    if (isDaeAutoCreatedStaticStatusEffect(effect, FRIGHTENED_STATUS_ID)) {
      return false;
    }

    const deletedEffectId = getEffectDocumentId(effect);
    const managedStatusId = resolveManagedStatusIdFromEffect(effect, "");
    if (managedStatusId === REBREYA_DISCREET_STATUS_ID) {
      return this.#syncDiscreetStatusEffects(effect.parent, { excludeEffectIds: [deletedEffectId] });
    }

    if (managedStatusId === FRIGHTENED_STATUS_ID) {
      return this.#syncFrightenedStatusEffects(effect.parent, { excludeEffectIds: [deletedEffectId] });
    }

    return false;
  }

  async applyDecayingDamage(actorOrId, amount, options = {}) {
    const safeAmount = Math.max(0, Math.floor(toNumber(amount, 0)));
    if (safeAmount <= 0) {
      return this.clearStatus(actorOrId, "decayingDamage");
    }

    const step = Math.max(0, Math.floor(toNumber(options.step, 0)));
    const meta = {
      step: step > 0 ? step : safeAmount,
      damageType: String(options.damageType ?? "").trim(),
      sourceActorId: String(options.sourceActorId ?? "").trim()
    };
    return this.setStatus(actorOrId, "decayingDamage", {
      active: true,
      value: safeAmount,
      meta
    });
  }

  async #withActorUpdateLock(actor, task) {
    if (!(actor instanceof Actor)) {
      return task();
    }

    this._internalActorUpdates.add(actor.id);
    try {
      return await task();
    }
    finally {
      this._internalActorUpdates.delete(actor.id);
    }
  }

  async syncBloodiedForActor(actor, { forceRemove = false } = {}) {
    void forceRemove;
    if (!(actor instanceof Actor)) {
      return false;
    }

    const current = this.#findStatusEffect(actor, LEGACY_BLOODIED_STATUS_ID);
    if (!current) {
      return false;
    }

    if (isKnownStatusConfig(LEGACY_BLOODIED_STATUS_ID) && typeof actor.toggleStatusEffect === "function") {
      await actor.toggleStatusEffect(LEGACY_BLOODIED_STATUS_ID, { active: false });
      return true;
    }

    await current.delete();
    return true;
  }

  async syncBloodiedForAllActors() {
    if (!game.user?.isGM) {
      return {
        scanned: 0,
        changed: 0
      };
    }

    const actors = game.actors?.contents ?? [];
    let changed = 0;
    for (const actor of actors) {
      const didChange = await this.syncBloodiedForActor(actor, { forceRemove: true });
      if (didChange) {
        changed += 1;
      }
    }

    return {
      scanned: actors.length,
      changed
    };
  }

  async handleActorHpUpdate(actor, changed = {}) {
    void actor;
    void changed;
    return false;
  }

  async tickDecayingDamage(actorOrId) {
    const actor = this.#resolveActor(actorOrId);
    if (!(actor instanceof Actor)) {
      return null;
    }

    const status = this.getStatus(actor, "decayingDamage");
    if (!status?.active) {
      return null;
    }

    const hp = getActorHpSnapshot(actor);
    const currentValue = Math.max(0, Math.floor(toNumber(status.value, 0)));
    if (!hp || currentValue <= 0) {
      await this.clearStatus(actor, "decayingDamage");
      return {
        actorId: actor.id,
        appliedDamage: 0,
        remaining: 0
      };
    }

    const nextHp = Math.max(0, hp.current - currentValue);
    await this.#withActorUpdateLock(actor, async () => {
      await actor.update({
        "system.attributes.hp.value": nextHp
      });
    });

    const configuredStep = Math.max(1, Math.floor(toNumber(status.meta?.step, currentValue)));
    const remaining = Math.max(0, currentValue - configuredStep);
    if (remaining <= 0) {
      await this.clearStatus(actor, "decayingDamage");
    }
    else {
      await this.setStatusValue(actor, "decayingDamage", remaining, {
        ...(status.meta ?? {}),
        step: configuredStep
      });
    }

    return {
      actorId: actor.id,
      appliedDamage: currentValue,
      remaining
    };
  }

  async handleCombatTurnChange(combat, updateData = {}) {
    if (!game.user?.isGM) {
      return null;
    }

    if (!(combat instanceof Combat)) {
      return null;
    }

    const hasTurnChange = Object.hasOwn(updateData, "round") || Object.hasOwn(updateData, "turn");
    if (!hasTurnChange) {
      return null;
    }

    const combatKey = combat.id;
    if (this._turnLocks.has(combatKey)) {
      return null;
    }

    this._turnLocks.add(combatKey);
    try {
      const currentActor = combat.combatant?.actor ?? null;
      if (!(currentActor instanceof Actor)) {
        return null;
      }

      return this.tickDecayingDamage(currentActor);
    }
    finally {
      this._turnLocks.delete(combatKey);
    }
  }
}
