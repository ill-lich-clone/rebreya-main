import { MODULE_ID } from "../constants.js";
import {
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
const FRIGHTENED_STATUS_ID = "rebreya-frightened";

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toInteger(value, fallback = 0) {
  return Math.floor(toNumber(value, fallback));
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

function buildFrightenedChanges(value) {
  const penalty = normalizeStatusValue(value, 1);
  const signedPenalty = String(-penalty);
  const mode = CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
  const priority = 20;
  return [
    {
      key: "system.bonuses.mwak.attack",
      mode,
      value: signedPenalty,
      priority
    },
    {
      key: "system.bonuses.rwak.attack",
      mode,
      value: signedPenalty,
      priority
    },
    {
      key: "system.bonuses.msak.attack",
      mode,
      value: signedPenalty,
      priority
    },
    {
      key: "system.bonuses.rsak.attack",
      mode,
      value: signedPenalty,
      priority
    },
    {
      key: "system.bonuses.abilities.check",
      mode,
      value: signedPenalty,
      priority
    }
  ];
}

function buildDynamicStatusChanges(statusId, value) {
  if (statusId === FRIGHTENED_STATUS_ID) {
    return buildFrightenedChanges(value);
  }

  return null;
}

export function registerCombatStatusConfig() {
  if (!Array.isArray(CONFIG?.statusEffects)) {
    return;
  }

  const knownIds = new Set(
    CONFIG.statusEffects
      .map((row) => String(row?.id ?? row?._id ?? "").trim())
      .filter(Boolean)
  );

  for (const row of REBREYA_STATUS_DEFINITIONS) {
    if (knownIds.has(row.id)) {
      continue;
    }

    const statusConfig = buildRebreyaStatusConfig(row.id);
    if (!statusConfig) {
      continue;
    }

    CONFIG.statusEffects.push(statusConfig);
    knownIds.add(row.id);
  }
}

export class CombatStatusService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
    this._internalActorUpdates = new Set();
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
                data-field="status-value"
              >
            </div>
          </form>
        `,
        buttons: {
          confirm: {
            label: "Применить",
            callback: (html) => {
              const root = getDialogRoot(html);
              const input = root?.querySelector("[data-field='status-value']");
              settled = true;
              resolve(normalizeStatusValue(input?.value, 1));
            }
          },
          cancel: {
            label: "Отмена",
            callback: () => {
              settled = true;
              resolve(null);
            }
          }
        },
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
            resolve(null);
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

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    const currentStatus = this.getStatus(actor, statusId);
    if (currentStatus?.active) {
      await this.clearStatus(actor, statusId);
      return;
    }

    const nextValue = await this.#promptStatusValue(definition, currentStatus?.value ?? 1);
    if (nextValue === null) {
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
      patch[`flags.${MODULE_ID}.${STATUS_VALUE_FLAG}`] = options.value;
      const dynamicChanges = buildDynamicStatusChanges(statusId, options.value);
      if (Array.isArray(dynamicChanges)) {
        patch.changes = dynamicChanges;
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
    const overlay = options.overlay === true;
    const durationRounds = toNumber(options.durationRounds, DEFAULT_DURATION_ROUNDS);
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
            value: Object.hasOwn(options, "value") ? options.value : null,
            meta: options.meta ?? {}
          })
        ]);
        effect = created ?? null;
      }
    }

    if (effect && (Object.hasOwn(options, "value") || Object.hasOwn(options, "meta"))) {
      await this.#storeStatusMetadata(effect, statusId, {
        value: options.value,
        meta: options.meta
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
    const value = effect?.getFlag(MODULE_ID, STATUS_VALUE_FLAG) ?? null;
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

    const effect = this.#findStatusEffect(actor, statusId);
    if (!effect) {
      return this.setStatus(actor, statusId, {
        active: true,
        value,
        meta
      });
    }

    await this.#storeStatusMetadata(effect, statusId, {
      value,
      meta
    });
    return effect;
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
