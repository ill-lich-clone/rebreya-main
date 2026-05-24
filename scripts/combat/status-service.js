import { MODULE_ID } from "../constants.js";
import {
  REBREYA_DISCREET_STATUS_ID,
  REBREYA_STATUS_DEFINITIONS,
  buildRebreyaStatusConfig,
  getRebreyaStatusDefinition,
  normalizeRebreyaStatusId
} from "./status-definitions.js";

const STATUS_ID_FLAG = "statusId";
const STATUS_VALUE_FLAG = "statusValue";
const STATUS_META_FLAG = "statusMeta";
const DEFAULT_DURATION_ROUNDS = 0;
const LEGACY_BLOODIED_STATUS_ID = "rebreya-bloodied";
const LEGACY_RESTRAINED_STATUS_ID = "rebreya-restrained";
const FRIGHTENED_STATUS_ID = "rebreya-frightened";
const STATUS_COUNTER_MODULE_ID = "statuscounter";
const DISCREET_MOVEMENT_KEYS = Object.freeze(["walk", "burrow", "climb", "fly", "swim"]);
const FRIGHTENED_ATTACK_BONUS_KEYS = Object.freeze([
  "system.bonuses.mwak.attack",
  "system.bonuses.rwak.attack",
  "system.bonuses.msak.attack",
  "system.bonuses.rsak.attack"
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

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function buildEffectStatusesSet(statusId) {
  return new Set([String(statusId ?? "").trim()].filter(Boolean));
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

function discreetStatusName(value) {
  return `${statusLabel(REBREYA_DISCREET_STATUS_ID)} ${normalizeStatusValue(value, 1)}`;
}

function plainDiscreetStatusName() {
  return statusLabel(REBREYA_DISCREET_STATUS_ID);
}

function frightenedStatusName(value, context = {}) {
  return `${statusLabel(FRIGHTENED_STATUS_ID)} ${normalizeFrightenedValue(value, context)}`;
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

function hasDiscreetStatusId(effect) {
  const statusIds = extractEffectStatuses(effect);
  if (statusIds.includes(REBREYA_DISCREET_STATUS_ID) || statusIds.includes(LEGACY_RESTRAINED_STATUS_ID)) {
    return true;
  }

  const moduleStatusId = String(getEffectStatusValue(effect, MODULE_ID, STATUS_ID_FLAG) ?? "").trim();
  const coreStatusId = String(getEffectStatusValue(effect, "core", "statusId") ?? "").trim();
  return moduleStatusId === REBREYA_DISCREET_STATUS_ID
    || moduleStatusId === LEGACY_RESTRAINED_STATUS_ID
    || coreStatusId === REBREYA_DISCREET_STATUS_ID
    || coreStatusId === LEGACY_RESTRAINED_STATUS_ID;
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
  const statusIds = extractEffectStatuses(effect);
  if (statusIds.includes(FRIGHTENED_STATUS_ID)) {
    return true;
  }

  const moduleStatusId = String(getEffectStatusValue(effect, MODULE_ID, STATUS_ID_FLAG) ?? "").trim();
  const coreStatusId = String(getEffectStatusValue(effect, "core", "statusId") ?? "").trim();
  return moduleStatusId === FRIGHTENED_STATUS_ID || coreStatusId === FRIGHTENED_STATUS_ID;
}

function parseFrightenedValueFromName(name) {
  const match = String(name ?? "").match(/(\d+)(?!.*\d)/u);
  return match ? normalizeFrightenedValue(match[1]) : null;
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

export function buildFrightenedStatusSyncUpdates(effects = [], {
  actor = null,
  sourceActor = null,
  sourceActorByEffectId = new Map()
} = {}) {
  const sourceActorLookup = sourceActorByEffectId instanceof Map ? sourceActorByEffectId : new Map();
  const rows = (Array.isArray(effects) ? effects : [])
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
    .filter((row) => row.id && row.value > 0);

  if (!rows.length) {
    return [];
  }

  const strongest = rows.reduce((best, row) => {
    if (!best || row.value > best.value) {
      return row;
    }

    return best;
  }, null);

  return rows.map((row) => ({
    _id: row.id,
    name: frightenedStatusName(row.value),
    img: statusIcon(FRIGHTENED_STATUS_ID),
    icon: statusIcon(FRIGHTENED_STATUS_ID),
    statuses: [FRIGHTENED_STATUS_ID],
    changes: row.id === strongest.id ? buildFrightenedChanges(row.value) : [],
    "flags.core.statusId": FRIGHTENED_STATUS_ID,
    [`flags.${MODULE_ID}.${STATUS_ID_FLAG}`]: FRIGHTENED_STATUS_ID,
    [`flags.${MODULE_ID}.${STATUS_VALUE_FLAG}`]: row.value,
    [`flags.${STATUS_COUNTER_MODULE_ID}.value`]: row.value,
    [`flags.${STATUS_COUNTER_MODULE_ID}.visible`]: true
  }));
}

export function buildDiscreetStatusSyncUpdates(effects = [], { actor = null } = {}) {
  const rows = (Array.isArray(effects) ? effects : [])
    .filter(hasDiscreetStatusId)
    .map((effect, index) => ({
      effect,
      index,
      id: getEffectDocumentId(effect),
      amount: readDiscreetStatusAmount(effect)
    }))
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

  return rows.map((row) => {
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

function buildDynamicStatusChanges(statusId, value) {
  if (statusId === FRIGHTENED_STATUS_ID) {
    return buildFrightenedChanges(value);
  }

  return null;
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

    if (dnd5eStatusEffects && !Object.hasOwn(dnd5eStatusEffects, row.id)) {
      dnd5eStatusEffects[row.id] = {
        name: statusConfig.name,
        img: statusConfig.img,
        icon: statusConfig.icon,
        flags: statusConfig.flags
      };
    }

    if (coreStatusEffects && !knownIds.has(row.id)) {
      coreStatusEffects.push(statusConfig);
      knownIds.add(row.id);
    }
  }
}

export class CombatStatusService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
    this._internalActorUpdates = new Set();
    this._discreetSyncActorIds = new Set();
    this._frightenedSyncActorIds = new Set();
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

  #readStatusControlFromEvent(event) {
    const target = event?.target;
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    return target.closest?.(".effect-control[data-status-id]") ?? null;
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

  async #handleTokenHudStatusInteraction(event, app) {
    const control = this.#readStatusControlFromEvent(event);
    if (!(control instanceof HTMLElement)) {
      return;
    }

    const rawStatusId = String(control.dataset.statusId ?? "").trim();
    const statusId = this.#resolveStatusId(rawStatusId);
    const definition = getRebreyaStatusDefinition(statusId);
    if (!definition?.supportsValue) {
      return;
    }

    const actor = this.#resolveHudActor(app);
    if (!(actor instanceof Actor)) {
      return;
    }

    const currentStatus = this.getStatus(actor, statusId);
    if (statusId === REBREYA_DISCREET_STATUS_ID) {
      if (event.type !== "click" || event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

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

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    if (currentStatus?.active) {
      await this.clearStatus(actor, statusId);
      return;
    }

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

    return actor.effects.contents.find((effect) => {
      const statusIds = extractEffectStatuses(effect);
      if (statusIds.includes(statusId)) {
        return true;
      }

      const fallbackStatusId = String(effect.getFlag(MODULE_ID, STATUS_ID_FLAG) ?? "").trim();
      return fallbackStatusId === statusId;
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
    if (Object.hasOwn(options, "value")) {
      const statusValue = statusId === FRIGHTENED_STATUS_ID
        ? normalizeFrightenedValue(options.value, {
          actor: options.actor ?? null,
          sourceActor: options.sourceActor ?? null
        })
        : options.value;
      patch[`flags.${MODULE_ID}.${STATUS_VALUE_FLAG}`] = statusValue;
      const dynamicChanges = buildDynamicStatusChanges(statusId, statusValue);
      if (Array.isArray(dynamicChanges)) {
        patch.changes = dynamicChanges;
      }
      if (statusId === FRIGHTENED_STATUS_ID) {
        patch.name = frightenedStatusName(statusValue);
        patch.img = statusIcon(FRIGHTENED_STATUS_ID);
        patch.icon = statusIcon(FRIGHTENED_STATUS_ID);
        patch.statuses = [FRIGHTENED_STATUS_ID];
        patch["flags.core.statusId"] = FRIGHTENED_STATUS_ID;
        patch[`flags.${STATUS_COUNTER_MODULE_ID}.value`] = statusValue;
        patch[`flags.${STATUS_COUNTER_MODULE_ID}.visible`] = true;
      }
    }
    if (Object.hasOwn(options, "meta")) {
      patch[`flags.${MODULE_ID}.${STATUS_META_FLAG}`] = foundry.utils.deepClone(options.meta ?? {});
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

      if (isKnownStatusConfig(statusId) && typeof actor.toggleStatusEffect === "function") {
        await actor.toggleStatusEffect(statusId, { active: false, overlay });
      }
      else {
        await current.delete();
      }

      return true;
    }

    let effect = current;
    if (!effect) {
      if (isKnownStatusConfig(statusId) && typeof actor.toggleStatusEffect === "function") {
        const result = await actor.toggleStatusEffect(statusId, { active: true, overlay });
        if (result instanceof ActiveEffect) {
          effect = result;
        }
        else {
          effect = this.#findStatusEffect(actor, statusId);
        }
      }

      if (!effect) {
        const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [
          this.#buildFallbackEffectData(statusId, {
            durationRounds,
            value: Object.hasOwn(statusOptions, "value") ? statusOptions.value : null,
            meta: statusOptions.meta ?? {},
            actor,
            sourceActor: statusOptions.sourceActor ?? null
          })
        ]);
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
    const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [
      buildDiscreetStatusEffectData(value, {
        durationRounds,
        meta
      })
    ]);

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

  async #syncDiscreetStatusEffects(actor) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    if (this._discreetSyncActorIds.has(actor.id)) {
      return false;
    }

    const effects = this.#getDiscreetStatusEffects(actor);
    const updates = buildDiscreetStatusSyncUpdates(effects, { actor });
    if (!updates.length) {
      return false;
    }

    this._discreetSyncActorIds.add(actor.id);
    try {
      if (typeof actor.updateEmbeddedDocuments === "function") {
        await actor.updateEmbeddedDocuments("ActiveEffect", updates);
      }
      else {
        for (const update of updates) {
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

  async #syncFrightenedStatusEffects(actor, { sourceActor = null } = {}) {
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
      sourceActorByEffectId
    });
    if (!updates.length) {
      return false;
    }

    this._frightenedSyncActorIds.add(actor.id);
    try {
      if (typeof actor.updateEmbeddedDocuments === "function") {
        await actor.updateEmbeddedDocuments("ActiveEffect", updates);
      }
      else {
        for (const update of updates) {
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

  async handleActiveEffectUpdate(effect) {
    const didSyncDiscreet = hasDiscreetStatusId(effect)
      ? await this.#syncDiscreetStatusEffects(effect.parent)
      : false;
    const didSyncFrightened = hasFrightenedStatusId(effect)
      ? await this.#syncFrightenedStatusEffects(effect.parent)
      : false;

    return didSyncDiscreet || didSyncFrightened;
  }

  async handleActiveEffectCreated(effect) {
    const didSyncDiscreet = hasDiscreetStatusId(effect)
      ? await this.#syncDiscreetStatusEffects(effect.parent)
      : false;
    const didSyncFrightened = hasFrightenedStatusId(effect)
      ? await this.#syncFrightenedStatusEffects(effect.parent)
      : false;

    return didSyncDiscreet || didSyncFrightened;
  }

  async handleActiveEffectDeleted(effect) {
    const didSyncDiscreet = hasDiscreetStatusId(effect)
      ? await this.#syncDiscreetStatusEffects(effect.parent)
      : false;
    const didSyncFrightened = hasFrightenedStatusId(effect)
      ? await this.#syncFrightenedStatusEffects(effect.parent)
      : false;

    return didSyncDiscreet || didSyncFrightened;
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
