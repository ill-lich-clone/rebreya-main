import { MODULE_ID } from "../constants.js";

const ACTIVE_PERFORMANCE_ACTION = "activePerformance";
const PERFORMER_STATE_FLAG = "performerAutomation.activePerformance";
const PERFORMER_EFFECT_KIND = "activePerformanceDie";
const ROLL_EFFECT_UUID_OPTION = "rebreyaPerformerEffectUuid";

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }

  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }

  if (collection instanceof Set) {
    return Array.from(collection);
  }

  if (typeof collection === "object") {
    return Object.values(collection);
  }

  return [];
}

function getProperty(source, path, fallback = undefined) {
  const value = globalThis.foundry?.utils?.getProperty instanceof Function
    ? foundry.utils.getProperty(source, path)
    : String(path ?? "").split(".").reduce((current, key) => current?.[key], source);
  return value === undefined ? fallback : value;
}

function setProperty(source, path, value) {
  if (globalThis.foundry?.utils?.setProperty instanceof Function) {
    return foundry.utils.setProperty(source, path, value);
  }

  const keys = String(path ?? "").split(".").filter(Boolean);
  let cursor = source;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] ??= {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
  return true;
}

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML instanceof Function
    ? foundry.utils.escapeHTML(value)
    : String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;");
}

function formatFormulaForDisplay(formula) {
  const text = cleanText(formula);
  if (!text) {
    return "";
  }

  return text.replace(/(\d*)d(\d+)/giu, (_match, count, faces) => `${count || "1"}к${faces}`);
}

function isActorDocument(actor) {
  return typeof Actor !== "undefined" && actor instanceof Actor;
}

function readDocumentFlag(document, key) {
  if (typeof document?.getFlag === "function") {
    return document.getFlag(MODULE_ID, key);
  }

  return getProperty(document, `flags.${MODULE_ID}.${key}`, undefined);
}

function actorFlag(actor, key, fallback = undefined) {
  if (typeof actor?.getFlag === "function") {
    const value = actor.getFlag(MODULE_ID, key);
    return value === undefined ? fallback : value;
  }

  return getProperty(actor, `flags.${MODULE_ID}.${key}`, fallback);
}

async function setActorFlag(actor, key, value) {
  if (typeof actor?.setFlag === "function") {
    return actor.setFlag(MODULE_ID, key, value);
  }

  if (typeof actor?.update === "function") {
    return actor.update({ [`flags.${MODULE_ID}.${key}`]: value });
  }

  setProperty(actor, `flags.${MODULE_ID}.${key}`, value);
  return actor;
}

async function unsetActorFlag(actor, key) {
  if (typeof actor?.unsetFlag === "function") {
    return actor.unsetFlag(MODULE_ID, key);
  }

  if (typeof actor?.update === "function") {
    return actor.update({ [`flags.${MODULE_ID}.${key}`]: null });
  }

  setProperty(actor, `flags.${MODULE_ID}.${key}`, undefined);
  return actor;
}

function activityRuntime(activity) {
  return readDocumentFlag(activity, "runtime")
    ?? getProperty(activity, `flags.${MODULE_ID}.runtime`, null);
}

function isActivePerformanceActivity(activity) {
  return cleanText(activityRuntime(activity)?.action) === ACTIVE_PERFORMANCE_ACTION;
}

function resolveActorFromSubject(subject) {
  if (isActorDocument(subject)) {
    return subject;
  }

  return subject?.actor
    ?? subject?.item?.actor
    ?? subject?.parent
    ?? null;
}

function resolveActorFromTarget(target) {
  if (isActorDocument(target)) {
    return target;
  }

  return target?.actor
    ?? target?.document?.actor
    ?? target?.object?.actor
    ?? target?.token?.actor
    ?? null;
}

function resolveTokenFromActor(actor) {
  return actor?.getActiveTokens?.(true, true)?.[0]
    ?? actor?.getActiveTokens?.()[0]
    ?? actor?.token
    ?? null;
}

function resolveTokenFromTarget(target) {
  if (!target) {
    return null;
  }

  return target.object
    ?? target.document?.object
    ?? target.token
    ?? (target.actor || target.document?.actor ? target : null)
    ?? resolveTokenFromActor(resolveActorFromTarget(target));
}

function tokenDisposition(token) {
  return token?.document?.disposition ?? token?.disposition ?? 0;
}

function isHostileTarget(sourceActor, targetToken) {
  const sourceToken = resolveTokenFromActor(sourceActor);
  const sourceDisposition = tokenDisposition(sourceToken);
  const targetDisposition = tokenDisposition(targetToken);
  if (!sourceDisposition || !targetDisposition) {
    return false;
  }

  return sourceDisposition !== targetDisposition;
}

function speakerForActor(actor) {
  return globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? { actor: actor?.id, alias: actor?.name };
}

function isLongRest(result = {}, config = {}) {
  if (result?.longRest === true || config?.longRest === true) {
    return true;
  }

  return [
    result?.type,
    result?.restType,
    result?.period,
    config?.type,
    config?.restType,
    config?.period
  ].some((value) => {
    const text = cleanText(value).toLowerCase();
    return text === "long" || text === "lr" || text.includes("продолж");
  });
}

function firstRollTotal(rolls) {
  const candidates = [
    ...collectionValues(rolls),
    ...collectionValues(rolls?.rolls),
    rolls?.roll,
    rolls?.check,
    rolls?.d20Test
  ].filter(Boolean);

  for (const roll of candidates) {
    const total = toNumber(roll?.total, NaN);
    if (Number.isFinite(total)) {
      return total;
    }
  }

  return NaN;
}

export class PerformerAutomationService {
  constructor(moduleApi = {}, options = {}) {
    this.moduleApi = moduleApi;
    this._options = options;
  }

  async initialize() {
    return true;
  }

  applyDnd5ePreUseActivity(activity) {
    const actor = activity?.actor ?? activity?.item?.actor;
    if (!isActivePerformanceActivity(activity) || !isActorDocument(actor)) {
      return true;
    }

    if (!this.#isActivePerformanceBlocked(actor)) {
      return true;
    }

    globalThis.ui?.notifications?.warn("Исполнитель: Активное выступление недоступно до продолжительного отдыха после двух провалов подряд.");
    return false;
  }

  async applyDnd5ePostUseActivity(activity, usageConfig = {}, results = {}) {
    void results;

    const actor = activity?.actor ?? activity?.item?.actor;
    if (!isActivePerformanceActivity(activity) || !isActorDocument(actor)) {
      return true;
    }

    if (this.#isActivePerformanceBlocked(actor)) {
      return true;
    }

    const runtime = activityRuntime(activity) ?? {};
    const target = this.#selectedTarget(usageConfig, actor);
    if (!target?.actor) {
      globalThis.ui?.notifications?.warn("Исполнитель: выберите цель для Активного выступления.");
      return true;
    }

    const dc = Math.max(1, Math.floor(toNumber(runtime.dc, 20)));
    const checkRolls = await this.#rollPerformanceCheck(actor, activity, runtime, dc);
    const total = firstRollTotal(checkRolls);
    if (!Number.isFinite(total)) {
      globalThis.ui?.notifications?.warn("Исполнитель: не удалось определить результат проверки Выступления.");
      return true;
    }

    const success = total >= dc;
    const formula = cleanText(success ? runtime.successFormula : runtime.failureFormula, success ? "1d5" : "1d3");
    const mode = isHostileTarget(actor, target.token) ? "subtract" : "add";

    await this.#updateActivePerformanceState(actor, success);
    await this.#applyPerformanceDie(target.actor, {
      sourceActor: actor,
      sourceItem: activity?.item,
      formula,
      mode,
      seconds: Math.max(1, Math.floor(toNumber(runtime.durationSeconds, 60)))
    });
    await this.#postActivePerformanceMessage(actor, target.actor, {
      success,
      total,
      dc,
      formula,
      mode
    });
    return true;
  }

  applyDnd5ePreRollD20Test(config = {}, _dialogConfig = {}, messageConfig = {}) {
    const actor = resolveActorFromSubject(config.subject);
    if (!isActorDocument(actor)) {
      return true;
    }

    const effect = this.#findPerformerDieEffect(actor);
    const automation = this.#effectAutomation(effect);
    const formula = cleanText(automation?.formula);
    if (!effect || !formula) {
      return true;
    }

    const mode = cleanText(automation.mode, "add");
    const signedFormula = mode === "subtract" ? `-${formula}` : formula;
    for (const rollConfig of config.rolls ?? []) {
      rollConfig.parts ??= [];
      rollConfig.options ??= {};
      if (rollConfig.options[ROLL_EFFECT_UUID_OPTION]) {
        continue;
      }

      rollConfig.parts.push(signedFormula);
      rollConfig.options[ROLL_EFFECT_UUID_OPTION] = cleanText(effect.uuid ?? effect.id);
    }

    const sign = mode === "subtract" ? "-" : "+";
    const note = `Активное выступление: ${sign}${formatFormulaForDisplay(formula)}`;
    messageConfig.data ??= {};
    messageConfig.data.flavor = [messageConfig.data.flavor, note].filter(Boolean).join("<br>");
    return true;
  }

  async applyDnd5eD20Roll(rolls, context = {}, _kind = "") {
    const actor = resolveActorFromSubject(context?.subject ?? context?.actor);
    if (!isActorDocument(actor)) {
      return true;
    }

    const effectUuids = new Set(collectionValues(rolls)
      .map((roll) => cleanText(roll?.options?.[ROLL_EFFECT_UUID_OPTION]))
      .filter(Boolean));
    if (!effectUuids.size) {
      return true;
    }

    for (const effect of collectionValues(actor.effects)) {
      const effectUuid = cleanText(effect?.uuid ?? effect?.id);
      if (effectUuids.has(effectUuid) && typeof effect?.delete === "function") {
        await effect.delete();
      }
    }
    return true;
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!isActorDocument(actor) || !isLongRest(result, config)) {
      return true;
    }

    await unsetActorFlag(actor, PERFORMER_STATE_FLAG);
    return true;
  }

  #selectedTarget(usageConfig, sourceActor) {
    const targets = [
      ...collectionValues(usageConfig?.targets),
      ...collectionValues(globalThis.game?.user?.targets)
    ];
    for (const entry of targets) {
      const actor = resolveActorFromTarget(entry);
      if (!isActorDocument(actor)) {
        continue;
      }

      return {
        actor,
        token: resolveTokenFromTarget(entry) ?? resolveTokenFromActor(actor)
      };
    }

    return sourceActor ? null : null;
  }

  async #rollPerformanceCheck(actor, activity, runtime, dc) {
    const skill = cleanText(runtime.skill, "prf");
    const ability = cleanText(runtime.ability, "cha");
    if (typeof this._options.rollSkill === "function") {
      return this._options.rollSkill(actor, { skill, ability, target: dc }, activity);
    }

    if (typeof actor.rollSkill === "function") {
      return actor.rollSkill({
        skill,
        ability,
        target: dc
      }, {}, {
        data: {
          flavor: `Активное выступление: Харизма (Выступление) Сл ${dc}`,
          speaker: speakerForActor(actor)
        }
      });
    }

    return [];
  }

  async #updateActivePerformanceState(actor, success) {
    const current = actorFlag(actor, PERFORMER_STATE_FLAG, {}) ?? {};
    const failures = success ? 0 : Math.max(0, Math.floor(toNumber(current.failures, 0))) + 1;
    await setActorFlag(actor, PERFORMER_STATE_FLAG, {
      failures,
      blocked: failures >= 2
    });
  }

  #isActivePerformanceBlocked(actor) {
    return actorFlag(actor, `${PERFORMER_STATE_FLAG}.blocked`) === true;
  }

  async #applyPerformanceDie(targetActor, { sourceActor, sourceItem, formula, mode, seconds }) {
    await this.#deleteExistingPerformanceDice(targetActor);
    const data = this.#performanceDieEffectData(targetActor, {
      sourceActor,
      sourceItem,
      formula,
      mode,
      seconds
    });

    if (typeof targetActor.createEmbeddedDocuments === "function") {
      return targetActor.createEmbeddedDocuments("ActiveEffect", [data]);
    }

    return [];
  }

  async #deleteExistingPerformanceDice(actor) {
    for (const effect of collectionValues(actor?.effects)) {
      if (this.#effectAutomation(effect)?.kind === PERFORMER_EFFECT_KIND && typeof effect?.delete === "function") {
        await effect.delete();
      }
    }
  }

  #performanceDieEffectData(targetActor, { sourceActor, sourceItem, formula, mode, seconds }) {
    const displayFormula = formatFormulaForDisplay(formula);
    const isPenalty = mode === "subtract";
    return {
      name: `Активное выступление: ${isPenalty ? "-" : "+"}${displayFormula}`,
      type: "base",
      img: cleanText(sourceItem?.img, "icons/svg/music.svg"),
      system: {},
      changes: [],
      disabled: false,
      duration: {
        startTime: globalThis.game?.time?.worldTime ?? null,
        seconds,
        rounds: null,
        turns: null,
        startRound: null,
        startTurn: null,
        combat: null
      },
      description: `<p>${escapeHtml(targetActor?.name)} ${isPenalty ? "вычитает" : "добавляет"} ${escapeHtml(displayFormula)} к первому d20-тесту.</p>`,
      origin: cleanText(sourceItem?.uuid ?? sourceActor?.uuid),
      transfer: false,
      statuses: [],
      flags: {
        [MODULE_ID]: {
          managed: true,
          performerAutomation: {
            kind: PERFORMER_EFFECT_KIND,
            formula,
            displayFormula,
            mode: isPenalty ? "subtract" : "add",
            sourceActorUuid: cleanText(sourceActor?.uuid),
            sourceItemUuid: cleanText(sourceItem?.uuid)
          }
        }
      }
    };
  }

  #findPerformerDieEffect(actor) {
    return collectionValues(actor?.effects).find((effect) => (
      effect?.disabled !== true
      && effect?.transfer !== true
      && this.#effectAutomation(effect)?.kind === PERFORMER_EFFECT_KIND
    )) ?? null;
  }

  #effectAutomation(effect) {
    return readDocumentFlag(effect, "performerAutomation")
      ?? getProperty(effect, `flags.${MODULE_ID}.performerAutomation`, null);
  }

  async #postActivePerformanceMessage(actor, targetActor, { success, total, dc, formula, mode }) {
    if (typeof globalThis.ChatMessage?.create !== "function") {
      return false;
    }

    const sign = mode === "subtract" ? "-" : "+";
    const result = success ? "успех" : "провал";
    await ChatMessage.create({
      speaker: speakerForActor(actor),
      content: `<p><strong>Активное выступление</strong>: ${escapeHtml(result)} (${escapeHtml(total)}/${escapeHtml(dc)}). ${escapeHtml(targetActor?.name)} получает ${escapeHtml(sign)}${escapeHtml(formatFormulaForDisplay(formula))} к первому d20-тесту.</p>`,
      flags: {
        [MODULE_ID]: {
          performerAutomation: {
            action: ACTIVE_PERFORMANCE_ACTION,
            targetActorUuid: cleanText(targetActor?.uuid),
            formula,
            mode
          }
        }
      }
    });
    return true;
  }
}
