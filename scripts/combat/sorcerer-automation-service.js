import { MODULE_ID } from "../constants.js";

const SORCERER_ADVANCEMENT_ROOT = "sorcerer-rework-v011";
const SORCERY_POINTS_FEATURE_ID = "sorcerer-sorcery-points";
const SORCERY_POINTS_SCALE_ID = "sorcery-points";
const MAXIMUM_SPELL_LEVEL_SCALE_ID = "maximum-spell-level";
const VIRTUAL_SLOT_COSTS = Object.freeze({
  1: 2,
  2: 3,
  3: 5,
  4: 6,
  5: 7,
  6: 9,
  7: 10,
  8: 11,
  9: 13
});
const SORCERY_POINTS_RECOVERY = Object.freeze([{
  period: "lr",
  type: "recoverAll",
  formula: ""
}]);
const COOLDOWNS_FLAG = "sorcererAutomation.virtualSlotCooldowns";
const HIGH_LEVEL_CASTS_FLAG = "sorcererAutomation.highLevelCasts";
const PREFLIGHT_FLAG = "sorcererAutomationPreflight";
const FINAL_BYPASS_FLAG = "sorcererAutomationBypass";
const REACTION_CHECK_COMPLETE_FLAG = "reactionCheckComplete";
const METAMAGIC_SOURCE_TYPE = "sorcererMetamagic";
const MAX_EXTENDED_DURATION_SECONDS = 24 * 60 * 60;

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toInteger(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
}

function getProperty(source, path, fallback = undefined) {
  const value = globalThis.foundry?.utils?.getProperty instanceof Function
    ? globalThis.foundry.utils.getProperty(source, path)
    : String(path ?? "").split(".").reduce((current, key) => current?.[key], source);
  return value === undefined ? fallback : value;
}

function setProperty(target, path, value) {
  if (globalThis.foundry?.utils?.setProperty instanceof Function) {
    globalThis.foundry.utils.setProperty(target, path, value);
    return target;
  }

  const keys = String(path ?? "").split(".").filter(Boolean);
  let cursor = target;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] ??= {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
  return target;
}

function deepClone(value) {
  if (globalThis.foundry?.utils?.deepClone instanceof Function) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return JSON.parse(JSON.stringify(value));
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

  return [];
}

function documentFlag(document, scope, key) {
  if (typeof document?.getFlag === "function") {
    try {
      const value = document.getFlag(scope, key);
      if (value !== undefined) {
        return value;
      }
    }
    catch (_error) {
      // Fall through to source flags for plain documents and malformed hooks.
    }
  }

  return getProperty(document, `flags.${scope}.${key}`, undefined);
}

function rawFeatureId(item) {
  return cleanText(documentFlag(item, MODULE_ID, "featureId"))
    .split("::")
    .at(-1) ?? "";
}

function isCurrentUserHook(userId) {
  return !userId || !globalThis.game?.user?.id || userId === globalThis.game.user.id;
}

function actorFrom(subject) {
  return subject?.actor ?? subject?.item?.actor ?? subject?.item?.parent ?? null;
}

function classIdentifier(item) {
  return cleanText(
    item?.system?.identifier
    ?? documentFlag(item, MODULE_ID, "classIdentifier")
  );
}

function isSorcererClassItem(item) {
  return item?.type === "class" && classIdentifier(item) === SORCERER_ADVANCEMENT_ROOT;
}

function isSorcererSpellActivity(activity) {
  const item = activity?.item;
  if (item?.type !== "spell" && activity?.type !== "spell") {
    return false;
  }

  const advancementRoot = cleanText(documentFlag(item, "dnd5e", "advancementRoot"));
  const [classItemId, advancementId] = advancementRoot.split(".", 2);
  if (!classItemId || !advancementId) {
    return false;
  }

  const classItem = collectionValues(actorFrom(activity)?.items)
    .find((entry) => cleanText(entry?.id ?? entry?._id) === classItemId);
  return classItem?.type === "class"
    && cleanText(classItem?.system?.identifier) === SORCERER_ADVANCEMENT_ROOT;
}

function scaleValue(actor, scaleId) {
  const rawValue = getProperty(actor, `system.scale.${SORCERER_ADVANCEMENT_ROOT}.${scaleId}`, 0);
  return Math.max(0, toInteger(rawValue?.value ?? rawValue, 0));
}

function isSorceryPointsItem(item) {
  return rawFeatureId(item) === SORCERY_POINTS_FEATURE_ID
    || cleanText(item?.system?.identifier) === SORCERY_POINTS_FEATURE_ID;
}

function pointsFeature(actor) {
  return collectionValues(actor?.items).find(isSorceryPointsItem) ?? null;
}

function spellBaseLevel(activity) {
  const item = activity?.item;
  return Math.max(0, toInteger(
    activity?.spellLevel
    ?? activity?.system?.level
    ?? item?.system?.level?.value
    ?? item?.system?.level,
    0
  ));
}

function spellIdentifier(activity) {
  const item = activity?.item;
  return cleanText(
    item?.system?.identifier
    ?? item?.identifier
    ?? item?.id
    ?? item?._id
    ?? item?.uuid,
    "spell"
  );
}

function spellComponents(activity) {
  return deepClone(activity?.components ?? activity?.system?.components ?? activity?.item?.system?.components ?? {});
}

function sharedSpellComponents(activity, overrides = {}) {
  const components = spellComponents(activity);
  return {
    verbal: overrides.verbal ?? (components.verbal === true || components.vocal === true || components.v === true),
    somatic: overrides.somatic ?? (components.somatic === true || components.s === true),
    material: overrides.material ?? (components.material === true || components.m === true)
  };
}

function spellRange(activity) {
  const range = activity?.range ?? activity?.system?.range ?? activity?.item?.system?.range ?? {};
  return {
    value: Math.max(0, toInteger(range?.value ?? range, 0)),
    units: cleanText(range?.units, "ft").toLowerCase()
  };
}

function spellDuration(activity) {
  const duration = activity?.duration ?? activity?.system?.duration ?? activity?.item?.system?.duration ?? {};
  return {
    value: Math.max(0, toInteger(duration?.value ?? duration, 0)),
    units: cleanText(duration?.units, "inst").toLowerCase()
  };
}

function durationSeconds({ value, units }) {
  const multipliers = {
    round: 6,
    rounds: 6,
    turn: 6,
    turns: 6,
    minute: 60,
    minutes: 60,
    hour: 3600,
    hours: 3600,
    day: 86400,
    days: 86400
  };
  return value * (multipliers[units] ?? 0);
}

function durationFromSeconds(seconds, preferredUnits) {
  const normalizedSeconds = Math.min(MAX_EXTENDED_DURATION_SECONDS, Math.max(0, seconds));
  const multipliers = {
    round: 6,
    rounds: 6,
    turn: 6,
    turns: 6,
    minute: 60,
    minutes: 60,
    hour: 3600,
    hours: 3600,
    day: 86400,
    days: 86400
  };
  const multiplier = multipliers[preferredUnits] ?? 0;
  if (multiplier && normalizedSeconds % multiplier === 0) {
    return { value: normalizedSeconds / multiplier, units: preferredUnits };
  }
  if (normalizedSeconds % 3600 === 0) {
    return { value: normalizedSeconds / 3600, units: "hour" };
  }
  return { value: normalizedSeconds / 60, units: "minute" };
}

function spellHasSave(activity) {
  const save = activity?.save ?? activity?.system?.save ?? activity?.item?.system?.save ?? {};
  return Boolean(cleanText(save?.ability ?? save?.abilityId ?? save?.type));
}

function spellTargetCount(activity) {
  const target = activity?.target ?? activity?.system?.target ?? activity?.item?.system?.target ?? {};
  return Math.max(0, toInteger(target?.affects?.count ?? target?.count ?? target?.value, 0));
}

function spellActivation(activity) {
  const activation = activity?.activation ?? activity?.system?.activation ?? activity?.item?.system?.activation ?? {};
  return {
    type: cleanText(activation?.type).toLowerCase(),
    value: Math.max(0, toInteger(activation?.value, 1))
  };
}

function spellHasDamage(activity) {
  const damage = activity?.damage ?? activity?.system?.damage ?? activity?.item?.system?.damage ?? {};
  return Array.isArray(damage?.parts) && damage.parts.length > 0;
}

function spellHasAttack(activity) {
  const attack = activity?.attack ?? activity?.system?.attack ?? activity?.item?.system?.attack ?? null;
  return Boolean(attack && typeof attack === "object");
}

function charismaModifier(actor) {
  return Math.max(1, toInteger(actor?.system?.abilities?.cha?.mod ?? actor?.system?.abilities?.cha?.modifier, 1));
}

function metamagicOptions(actor) {
  return collectionValues(actor?.items)
    .filter((item) => cleanText(documentFlag(item, MODULE_ID, "sourceType")) === METAMAGIC_SOURCE_TYPE)
    .map((item) => ({
      id: cleanText(documentFlag(item, MODULE_ID, "metamagicId") ?? item?.system?.identifier),
      label: cleanText(item?.name, documentFlag(item, MODULE_ID, "metamagicId") ?? item?.system?.identifier),
      cost: documentFlag(item, MODULE_ID, "cost"),
      stacking: cleanText(documentFlag(item, MODULE_ID, "stacking"), "base").toLowerCase(),
      item
    }))
    .filter((option) => option.id);
}

function selectedTargetUuids(value) {
  const targets = Array.isArray(value) ? value : value ? collectionValues(value) : [];
  return targets.map((target) => cleanText(target?.uuid ?? target?.id ?? target)).filter(Boolean);
}

function isLongRest(result = {}, config = {}) {
  if (result?.longRest === true || config?.longRest === true) {
    return true;
  }

  return [result?.type, result?.restType, config?.type, config?.restType]
    .map((value) => cleanText(value).toLowerCase())
    .includes("long");
}

function currentRound() {
  return Math.max(0, toInteger(globalThis.game?.combat?.round, 0));
}

function exhaustionLevel(actor) {
  const value = actor?.system?.attributes?.exhaustion;
  return Math.max(0, toInteger(value?.value ?? value, 0));
}

function normalizeSelection(value, fallbackLevel) {
  if (value === false || value === null) {
    return { accepted: false, spellLevel: fallbackLevel, exhaustionOverride: false };
  }

  if (typeof value === "number") {
    return { accepted: true, spellLevel: toInteger(value, fallbackLevel), exhaustionOverride: false };
  }

  if (value && typeof value === "object") {
    return {
      accepted: value.accepted !== false && value.confirmed !== false,
      spellLevel: toInteger(value.spellLevel ?? value.level, fallbackLevel),
      exhaustionOverride: value.exhaustionOverride === true || value.override === true
    };
  }

  return { accepted: true, spellLevel: fallbackLevel, exhaustionOverride: false };
}

function explicitSelection(usageConfig, dialogConfig, fallbackLevel) {
  const selected = usageConfig?.sorcererVirtualSpellLevel
    ?? dialogConfig?.sorcererVirtualSpellLevel
    ?? usageConfig?.spellCast?.spellLevel
    ?? fallbackLevel;
  return normalizeSelection(selected, fallbackLevel);
}

function hasExplicitSelection(usageConfig, dialogConfig) {
  return Object.hasOwn(usageConfig ?? {}, "sorcererVirtualSpellLevel")
    || Object.hasOwn(dialogConfig ?? {}, "sorcererVirtualSpellLevel")
    || getProperty(usageConfig, "spellCast.spellLevel", undefined) !== undefined;
}

function explicitExhaustionOverride(usageConfig, dialogConfig) {
  return usageConfig?.sorcererExhaustionOverride === true
    || dialogConfig?.sorcererExhaustionOverride === true
    || usageConfig?.spellCast?.modifiers?.exhaustionOverride === true;
}

function cooldownKey(activity, virtualLevel) {
  return `${spellIdentifier(activity)}:${virtualLevel}`;
}

function actorFlag(actor, key, fallback = {}) {
  const value = typeof actor?.getFlag === "function"
    ? actor.getFlag(MODULE_ID, key)
    : getProperty(actor, `flags.${MODULE_ID}.${key}`, undefined);
  return value && typeof value === "object" ? deepClone(value) : fallback;
}

async function setActorFlag(actor, key, value) {
  if (typeof actor?.setFlag === "function") {
    await actor.setFlag(MODULE_ID, key, value);
    return;
  }

  if (typeof actor?.update === "function") {
    await actor.update({ [`flags.${MODULE_ID}.${key}`]: value });
    return;
  }

  setProperty(actor, `flags.${MODULE_ID}.${key}`, value);
}

async function updateDocument(document, patch) {
  if (!Object.keys(patch).length) {
    return document;
  }

  if (typeof document?.update === "function") {
    return document.update(patch);
  }

  for (const [path, value] of Object.entries(patch)) {
    setProperty(document, path, value);
  }
  return document;
}

function resourceData(max) {
  return {
    name: "Единицы чародейства",
    type: "feat",
    system: {
      identifier: SORCERY_POINTS_FEATURE_ID,
      uses: {
        spent: 0,
        max,
        recovery: deepClone(SORCERY_POINTS_RECOVERY)
      }
    },
    flags: {
      [MODULE_ID]: {
        featureId: SORCERY_POINTS_FEATURE_ID
      }
    }
  };
}

export class SorcererAutomationService {
  constructor(moduleApi = {}, options = {}) {
    this.moduleApi = moduleApi;
    this._options = Object.keys(options).length
      ? options
      : moduleApi?.chooseVirtualSpellLevel instanceof Function
        ? moduleApi
        : {};
    this._deferredActivities = new WeakSet();
    this._finalizingActivities = new WeakSet();
  }

  async initialize() {
    return true;
  }

  async #chooseVirtualSpellLevel({ actor, activity, choices, usageConfig, dialogConfig, baseLevel }) {
    void actor;
    void activity;
    if (this._options.chooseVirtualSpellLevel instanceof Function) {
      return normalizeSelection(
        await this._options.chooseVirtualSpellLevel({ actor, activity, choices: deepClone(choices) }),
        baseLevel
      );
    }

    if (hasExplicitSelection(usageConfig, dialogConfig)) {
      return explicitSelection(usageConfig, dialogConfig, baseLevel);
    }

    if (typeof globalThis.DialogV2?.wait !== "function") {
      return explicitSelection(usageConfig, dialogConfig, baseLevel);
    }

    const options = choices.map(({ spellLevel, cost }) => (
      `<option value="${spellLevel}" data-sorcerer-cost="${cost}"${spellLevel === baseLevel ? " selected" : ""}>${spellLevel} (${cost})</option>`
    )).join("");
    const result = await globalThis.DialogV2.wait({
      window: { title: "Единицы чародейства" },
      content: `<p>Выберите уровень виртуальной ячейки и её стоимость в единицах чародейства.</p><div class="rebreya-sorcerer-choice-row"><label>Уровень <select name="spellLevel" onchange="this.closest('.rebreya-sorcerer-choice-row').querySelector('[data-sorcerer-total]').textContent=this.selectedOptions[0].dataset.sorcererCost">${options}</select></label><label><input type="checkbox" name="exhaustionOverride"> Игнорировать ограничение ценой истощения</label><output data-sorcerer-total>${VIRTUAL_SLOT_COSTS[baseLevel]}</output></div>`,
      buttons: [{
        action: "cast",
        label: "Сотворить",
        default: true,
        callback: (_event, button) => ({
          accepted: true,
          spellLevel: toInteger(button?.form?.elements?.spellLevel?.value, baseLevel),
          exhaustionOverride: button?.form?.elements?.exhaustionOverride?.checked === true
        })
      }, {
        action: "cancel",
        label: "Отмена"
      }]
    });
    return normalizeSelection(result, baseLevel);
  }

  #metamagicRequest(usageConfig = {}, dialogConfig = {}) {
    const value = usageConfig?.sorcererMetamagic ?? dialogConfig?.sorcererMetamagic ?? {};
    if (Array.isArray(value)) {
      return { ids: value };
    }
    if (typeof value === "string") {
      return { ids: [value] };
    }
    return value && typeof value === "object" ? value : {};
  }

  async #chooseMetamagic({ actor, activity, spellLevel, usageConfig, dialogConfig }) {
    const configured = this.#metamagicRequest(usageConfig, dialogConfig);
    if (Array.isArray(configured.ids) && configured.ids.length) {
      return { accepted: true, ...configured, ids: configured.ids.map((id) => cleanText(id)).filter(Boolean) };
    }

    const options = metamagicOptions(actor);
    if (this._options.chooseMetamagic instanceof Function) {
      const result = await this._options.chooseMetamagic({
        actor,
        activity,
        spellLevel,
        options: deepClone(options.map(({ id, cost, stacking }) => ({ id, cost, stacking })))
      });
      if (result === false || result?.accepted === false || result?.confirmed === false) {
        return { accepted: false, ids: [] };
      }
      const choice = Array.isArray(result) ? { ids: result } : (result ?? {});
      return { accepted: true, ...choice, ids: (choice.ids ?? []).map((id) => cleanText(id)).filter(Boolean) };
    }

    if (typeof globalThis.DialogV2?.wait !== "function" || !options.length) {
      return { accepted: true, ids: [] };
    }

    const virtualCost = VIRTUAL_SLOT_COSTS[spellLevel] ?? 0;
    const updateTotal = "const row=this.closest('.rebreya-sorcerer-choice-row');row.querySelector('[data-sorcerer-total]').textContent=Array.from(row.querySelectorAll('input[name=metamagic]:checked')).reduce((total,input)=>total+Number(input.dataset.cost)," + virtualCost + ")";
    const checkboxes = options.map(({ id, label, cost }) => (
      `<label><input type="checkbox" name="metamagic" value="${id}" data-cost="${cost === "spellLevel" ? spellLevel : cost}" onchange="${updateTotal}"> ${label} (${cost === "spellLevel" ? spellLevel : cost})</label>`
    )).join("");
    const result = await globalThis.DialogV2.wait({
      window: { title: "Метамагия" },
      content: `<div class="rebreya-sorcerer-choice-row">${checkboxes}<output data-sorcerer-total>${virtualCost}</output></div>`,
      buttons: [{
        action: "confirm",
        label: "Применить",
        default: true,
        callback: (_event, button) => ({
          accepted: true,
          ids: Array.from(button?.form?.elements?.metamagic ?? [])
            .filter((input) => input.checked)
            .map((input) => input.value)
        })
      }, { action: "cancel", label: "Отмена" }]
    });
    if (!result || result.accepted === false) {
      return { accepted: false, ids: [] };
    }
    return { ...result, ids: (result.ids ?? []).map((id) => cleanText(id)).filter(Boolean) };
  }

  #metamagicCost(option, spellLevel) {
    return option?.cost === "spellLevel"
      ? Math.max(1, spellLevel)
      : Math.max(1, toInteger(option?.cost, 1));
  }

  #validateMetamagic(activity, actor, spellLevel, request = {}) {
    const ids = Array.from(new Set((request?.ids ?? []).map((id) => cleanText(id)).filter(Boolean)));
    const ownedById = new Map(metamagicOptions(actor).map((option) => [option.id, option]));
    const options = ids.map((id) => ownedById.get(id));
    if (options.some((option) => !option)) {
      return null;
    }

    const additive = options.filter((option) => option.stacking === "additive");
    const base = options.filter((option) => option.stacking !== "additive");
    if (base.length > 1 || additive.length > 1 || options.length > 2 || (options.length === 2 && (base.length !== 1 || additive.length !== 1))) {
      return null;
    }

    const targetUuids = selectedTargetUuids(request.targetUuids);
    const currentTargets = selectedTargetUuids(request.targets ?? request.currentTargets);
    const selectedDamageDice = Array.from(new Set((request.damageDice ?? []).map((index) => toInteger(index, -1)).filter((index) => index >= 0)));
    const secondTargetUuid = cleanText(request.secondTargetUuid);
    for (const id of ids) {
      if (id === "careful-spell" && (!spellHasSave(activity) || targetUuids.length < 1 || targetUuids.length > charismaModifier(actor))) {
        return null;
      }
      if (id === "distant-spell") {
        const range = spellRange(activity);
        if (range.units !== "touch" && range.value < 5) return null;
      }
      if (id === "heightened-spell" && (!spellHasSave(activity) || targetUuids.length !== 1)) {
        return null;
      }
      if (id === "extended-spell" && durationSeconds(spellDuration(activity)) < 60) {
        return null;
      }
      if (id === "twinned-spell") {
        const range = spellRange(activity);
        if (spellTargetCount(activity) !== 1 || range.units === "self" || !secondTargetUuid || currentTargets.length !== 1 || currentTargets.includes(secondTargetUuid)) {
          return null;
        }
      }
      if (id === "empowered-spell" && (!spellHasDamage(activity) || selectedDamageDice.length < 1 || selectedDamageDice.length > charismaModifier(actor))) {
        return null;
      }
      if (id === "quickened-spell" && spellActivation(activity).type !== "action") {
        return null;
      }
      if (id === "seeking-spell" && !spellHasAttack(activity)) {
        return null;
      }
    }

    return {
      ids,
      options,
      cost: options
        .filter((option) => option.id !== "seeking-spell")
        .reduce((total, option) => total + this.#metamagicCost(option, spellLevel), 0),
      targetUuids,
      currentTargets,
      secondTargetUuid,
      selectedDamageDice,
      rerollDamage: request.rerollDamage instanceof Function ? request.rerollDamage : null
    };
  }

  #applyMetamagicConfig(activity, usageConfig, plan) {
    const meta = plan.metamagic;
    const modifiers = {};
    let components = spellComponents(activity);
    for (const id of meta.ids) {
      if (id === "careful-spell") {
        modifiers.careful = { targets: meta.targetUuids };
      }
      else if (id === "distant-spell") {
        const range = spellRange(activity);
        plan.range = range.units === "touch"
          ? { value: 30, units: "ft" }
          : { value: range.value * 2, units: range.units };
        modifiers.distant = true;
      }
      else if (id === "heightened-spell") {
        modifiers.heightened = { targetUuid: meta.targetUuids[0], firstSaveDisadvantage: true };
      }
      else if (id === "subtle-spell") {
        components = sharedSpellComponents(activity, { verbal: false, somatic: false });
        modifiers.subtle = true;
      }
      else if (id === "extended-spell") {
        const duration = spellDuration(activity);
        plan.duration = durationFromSeconds(durationSeconds(duration) * 2, duration.units);
        modifiers.extended = true;
      }
      else if (id === "twinned-spell") {
        usageConfig.targets = [...meta.currentTargets, meta.secondTargetUuid];
        modifiers.twinned = { secondTargetUuid: meta.secondTargetUuid };
      }
      else if (id === "empowered-spell") {
        modifiers.empowered = { damageDice: meta.selectedDamageDice };
      }
      else if (id === "quickened-spell") {
        plan.activation = { type: "bonus", value: 1 };
        usageConfig.activation = deepClone(plan.activation);
        modifiers.quickened = true;
      }
      else if (id === "seeking-spell") {
        modifiers.seeking = { pending: true, cost: this.#metamagicCost(meta.options.find((option) => option.id === id), plan.choice.spellLevel) };
      }
    }
    return { components, modifiers };
  }

  async #prepareCastPlan(activity, usageConfig = {}, dialogConfig = {}) {
    const actor = actorFrom(activity);
    const baseLevel = spellBaseLevel(activity);
    const maxLevel = scaleValue(actor, MAXIMUM_SPELL_LEVEL_SCALE_ID);
    if (!actor || baseLevel < 1 || maxLevel < baseLevel) {
      return null;
    }
    const choices = Object.entries(VIRTUAL_SLOT_COSTS)
      .map(([level, cost]) => ({ spellLevel: Number(level), cost }))
      .filter(({ spellLevel }) => spellLevel >= baseLevel && spellLevel <= maxLevel);
    const stored = usageConfig?.[MODULE_ID]?.[PREFLIGHT_FLAG];
    const selected = stored
      ? normalizeSelection(stored, baseLevel)
      : await this.#chooseVirtualSpellLevel({ actor, activity, choices, usageConfig, dialogConfig, baseLevel });
    if (!selected.accepted) {
      return null;
    }
    const choice = choices.find(({ spellLevel }) => spellLevel === selected.spellLevel);
    if (!choice) {
      return null;
    }

    const request = stored?.metamagic ?? await this.#chooseMetamagic({
      actor,
      activity,
      spellLevel: choice.spellLevel,
      usageConfig,
      dialogConfig
    });
    if (request?.accepted === false) {
      return null;
    }
    const metamagic = this.#validateMetamagic(activity, actor, choice.spellLevel, {
      ...(request ?? {}),
      targets: request?.targets ?? usageConfig?.targets ?? globalThis.game?.user?.targets
    });
    if (!metamagic) {
      return null;
    }

    const override = selected.exhaustionOverride || explicitExhaustionOverride(usageConfig, dialogConfig);
    const cooldowns = actorFlag(actor, COOLDOWNS_FLAG);
    const highLevelCasts = actorFlag(actor, HIGH_LEVEL_CASTS_FLAG);
    const key = cooldownKey(activity, choice.spellLevel);
    const activeCooldown = choice.spellLevel <= 5 && toInteger(cooldowns[key]?.expiresAtRound, 0) > currentRound();
    const highLevelRepeat = choice.spellLevel >= 6 && highLevelCasts[String(choice.spellLevel)] === true;
    if ((activeCooldown || highLevelRepeat) && !override) {
      return null;
    }
    const points = pointsFeature(actor);
    const spent = Math.max(0, toInteger(points?.system?.uses?.spent, 0));
    const max = Math.max(0, toInteger(points?.system?.uses?.max, 0));
    const totalCost = choice.cost + metamagic.cost;
    if (!points || max - spent < totalCost) {
      return null;
    }

    return {
      actor,
      baseLevel,
      choice,
      metamagic,
      totalCost,
      override,
      cooldowns,
      highLevelCasts,
      key,
      activeCooldown,
      highLevelRepeat
    };
  }

  async handleCreatedItem(item, _options = {}, userId = "") {
    if (!isCurrentUserHook(userId) || (!isSorcererClassItem(item) && !isSorceryPointsItem(item))) {
      return true;
    }

    await this.syncSorceryPoints(actorFrom(item));
    return true;
  }

  async handleUpdatedItem(item, changed = {}, _options = {}, userId = "") {
    if (!isCurrentUserHook(userId) || !isSorcererClassItem(item)) {
      return true;
    }

    const levelChanged = getProperty(changed, "system.levels", undefined) !== undefined
      || getProperty(changed, "system.level", undefined) !== undefined
      || getProperty(changed, "levels", undefined) !== undefined;
    if (levelChanged) {
      await this.syncSorceryPoints(actorFrom(item));
    }
    return true;
  }

  async syncSorceryPoints(actor) {
    const max = scaleValue(actor, SORCERY_POINTS_SCALE_ID);
    if (!actor || max <= 0) {
      return null;
    }

    let points = pointsFeature(actor);
    if (!points && typeof actor.createEmbeddedDocuments === "function") {
      const created = await actor.createEmbeddedDocuments("Item", [resourceData(max)], { renderSheet: false });
      points = pointsFeature(actor) ?? collectionValues(created).find(isSorceryPointsItem) ?? null;
    }

    if (!points) {
      return null;
    }

    const uses = points.system?.uses ?? {};
    const spent = Math.max(0, toInteger(uses.spent, 0));
    const patch = {};
    if (toInteger(uses.max, -1) !== max) {
      patch["system.uses.max"] = max;
    }
    if (JSON.stringify(uses.recovery ?? []) !== JSON.stringify(SORCERY_POINTS_RECOVERY)) {
      patch["system.uses.recovery"] = deepClone(SORCERY_POINTS_RECOVERY);
    }
    if (spent > max) {
      patch["system.uses.spent"] = max;
    }
    await updateDocument(points, patch);
    return points;
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!isLongRest(result, config)) {
      return true;
    }

    const points = await this.syncSorceryPoints(actor) ?? pointsFeature(actor);
    if (points && Math.max(0, toInteger(points?.system?.uses?.spent, 0)) > 0) {
      await updateDocument(points, { "system.uses.spent": 0 });
    }
    await setActorFlag(actor, COOLDOWNS_FLAG, {});
    await setActorFlag(actor, HIGH_LEVEL_CASTS_FLAG, {});
    return true;
  }

  deferDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if (this.#isFinalDnd5eUse(usageConfig) || !isSorcererSpellActivity(activity)) {
      return true;
    }

    if (usageConfig?.[MODULE_ID]?.[PREFLIGHT_FLAG]) {
      return true;
    }

    if (this._deferredActivities.has(activity)) {
      return false;
    }

    this._deferredActivities.add(activity);
    void this.#resolvePreflightDnd5eUse(activity, usageConfig, dialogConfig, messageConfig);
    return false;
  }

  finalizeDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if (
      this.#isFinalDnd5eUse(usageConfig)
      || !isSorcererSpellActivity(activity)
      || usageConfig?.[MODULE_ID]?.[PREFLIGHT_FLAG] === undefined
      || usageConfig?.flags?.[MODULE_ID]?.[REACTION_CHECK_COMPLETE_FLAG] !== true
    ) {
      return true;
    }
    if (this._finalizingActivities.has(activity)) {
      return false;
    }

    this._finalizingActivities.add(activity);
    void this.#resolveFinalDnd5eUse(activity, usageConfig, dialogConfig, messageConfig);
    return false;
  }

  async applyDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, _messageConfig = {}) {
    if (this.#isFinalDnd5eUse(usageConfig) || !isSorcererSpellActivity(activity)) {
      return true;
    }

    return (await this.#applyVirtualSlotPayment(activity, usageConfig, dialogConfig)) !== null;
  }

  async applyDnd5ePostAttackRoll(rolls = [], context = {}) {
    const usageConfig = context?.usageConfig ?? context?.config ?? {};
    const seeking = usageConfig?.spellCast?.modifiers?.seeking;
    const activity = context?.activity ?? context?.subject ?? null;
    if (!seeking?.pending || !isSorcererSpellActivity(activity)) {
      return true;
    }

    const safeRolls = Array.isArray(rolls) ? rolls : [rolls].filter(Boolean);
    const targetAc = Math.max(0, toInteger(context?.targetAc ?? context?.ac, 0));
    const hit = context?.isHit === true || (targetAc > 0 && safeRolls.some((roll) => toInteger(roll?.total, 0) >= targetAc));
    if (hit) {
      return true;
    }

    const actor = actorFrom(activity);
    const points = pointsFeature(actor);
    const cost = Math.max(1, toInteger(seeking.cost, 2));
    const spent = Math.max(0, toInteger(points?.system?.uses?.spent, 0));
    const max = Math.max(0, toInteger(points?.system?.uses?.max, 0));
    if (!points || max - spent < cost) {
      return true;
    }

    const roll = safeRolls.find((entry) => entry?.reroll instanceof Function);
    if (!roll) {
      return true;
    }
    await updateDocument(points, { "system.uses.spent": spent + cost });
    const rerolled = await roll.reroll();
    context.rerolled = rerolled;
    seeking.pending = false;
    seeking.used = true;
    if (usageConfig?.flags?.[MODULE_ID]?.spellCast?.modifiers?.seeking) {
      usageConfig.flags[MODULE_ID].spellCast.modifiers.seeking = deepClone(seeking);
    }
    return true;
  }

  async #applyVirtualSlotPayment(activity, usageConfig = {}, dialogConfig = {}) {
    if (!isSorcererSpellActivity(activity)) {
      return null;
    }

    const plan = await this.#prepareCastPlan(activity, usageConfig, dialogConfig);
    if (!plan) {
      return null;
    }

    const {
      actor,
      baseLevel,
      choice,
      metamagic,
      totalCost,
      override,
      cooldowns,
      highLevelCasts,
      key,
      activeCooldown,
      highLevelRepeat
    } = plan;
    const points = pointsFeature(actor);
    const uses = points?.system?.uses ?? {};
    const spent = Math.max(0, toInteger(uses.spent, 0));

    const exhaustion = override ? 1 : 0;
    const state = {
      actor,
      points,
      spent,
      cooldowns: deepClone(cooldowns),
      highLevelCasts: deepClone(highLevelCasts),
      exhaustion: exhaustionLevel(actor),
      pointsChanged: false,
      cooldownsChanged: false,
      highLevelCastsChanged: false,
      exhaustionChanged: false,
      rolledBack: false
    };

    const metamagicConfig = this.#applyMetamagicConfig(activity, usageConfig, plan);
    try {
      await updateDocument(points, { "system.uses.spent": spent + totalCost });
      state.pointsChanged = true;
      if (choice.spellLevel <= 5) {
        cooldowns[key] = { expiresAtRound: currentRound() + choice.spellLevel };
        await setActorFlag(actor, COOLDOWNS_FLAG, cooldowns);
        state.cooldownsChanged = true;
      }
      if (choice.spellLevel >= 6) {
        highLevelCasts[String(choice.spellLevel)] = true;
        await setActorFlag(actor, HIGH_LEVEL_CASTS_FLAG, highLevelCasts);
        state.highLevelCastsChanged = true;
      }
      if (exhaustion) {
        await updateDocument(actor, { "system.attributes.exhaustion": state.exhaustion + exhaustion });
        state.exhaustionChanged = true;
      }
      if (metamagic.ids.includes("empowered-spell") && metamagic.rerollDamage) {
        await metamagic.rerollDamage(metamagic.selectedDamageDice);
      }
    }
    catch (error) {
      await this.#rollbackVirtualSlotPayment(state);
      throw error;
    }

    const consume = usageConfig.consume && typeof usageConfig.consume === "object"
      ? usageConfig.consume
      : (usageConfig.consume = {});
    consume.spellSlot = false;
    usageConfig.spell ??= {};
    usageConfig.spell.slot = `spell${choice.spellLevel}`;
    usageConfig.scaling = Math.max(0, choice.spellLevel - baseLevel);
    usageConfig.spellCast = {
      spellLevel: choice.spellLevel,
      components: metamagicConfig.components,
      payment: {
        resource: "sorcery-points",
        cost: totalCost
      },
      modifiers: {
        cooldownOverride: activeCooldown && override,
        exhaustion,
        highLevelOverride: highLevelRepeat && override,
        ...metamagicConfig.modifiers
      }
    };
    if (plan.range) {
      usageConfig.spellCast.range = deepClone(plan.range);
    }
    if (plan.duration) {
      usageConfig.spellCast.duration = deepClone(plan.duration);
    }
    if (plan.activation) {
      usageConfig.spellCast.activation = deepClone(plan.activation);
    }
    if (metamagic.ids.length) {
      usageConfig.flags ??= {};
      usageConfig.flags[MODULE_ID] ??= {};
      usageConfig.flags[MODULE_ID].spellCast = deepClone(usageConfig.spellCast);
    }
    return state;
  }

  async #resolvePreflightDnd5eUse(activity, usageConfig, dialogConfig, messageConfig) {
    try {
      if (typeof activity?.use !== "function") {
        return;
      }

      const plan = await this.#prepareCastPlan(activity, usageConfig, dialogConfig);
      if (!plan) {
        return;
      }
      const preflightUsageConfig = {
        ...usageConfig,
        [MODULE_ID]: {
          ...(usageConfig?.[MODULE_ID] ?? {}),
          [PREFLIGHT_FLAG]: {
            accepted: true,
            spellLevel: plan.choice.spellLevel,
            exhaustionOverride: plan.override,
            metamagic: this.#metamagicRequest(usageConfig, dialogConfig)
          }
        }
      };
      const metamagicConfig = this.#applyMetamagicConfig(activity, preflightUsageConfig, plan);
      preflightUsageConfig.spellCast = {
        spellLevel: plan.choice.spellLevel,
        components: metamagicConfig.components,
        payment: { resource: "sorcery-points", cost: plan.totalCost },
        modifiers: metamagicConfig.modifiers
      };
      if (plan.range) preflightUsageConfig.spellCast.range = deepClone(plan.range);
      if (plan.duration) preflightUsageConfig.spellCast.duration = deepClone(plan.duration);
      if (plan.activation) preflightUsageConfig.spellCast.activation = deepClone(plan.activation);
      preflightUsageConfig.flags ??= {};
      preflightUsageConfig.flags[MODULE_ID] ??= {};
      preflightUsageConfig.flags[MODULE_ID].spellCast = deepClone(preflightUsageConfig.spellCast);
      await activity.use(
        preflightUsageConfig,
        this.#resumeDialogConfig(dialogConfig),
        messageConfig
      );
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to resume Sorcerer spell preflight.`, error);
    }
    finally {
      this._deferredActivities.delete(activity);
    }
  }

  async #resolveFinalDnd5eUse(activity, usageConfig, dialogConfig, messageConfig) {
    let payment = null;
    try {
      if (typeof activity?.use !== "function") {
        return;
      }
      payment = await this.#applyVirtualSlotPayment(activity, usageConfig, dialogConfig);
      if (!payment) {
        return;
      }
      const result = await activity.use(
        this.#resumeUsageConfig(usageConfig),
        this.#resumeDialogConfig(dialogConfig),
        messageConfig
      );
      if (!result) {
        await this.#rollbackVirtualSlotPayment(payment);
      }
    }
    catch (error) {
      if (payment) {
        await this.#rollbackVirtualSlotPayment(payment);
      }
      console.error(`${MODULE_ID} | Failed to resume paid Sorcerer spell use.`, error);
    }
    finally {
      this._finalizingActivities.delete(activity);
    }
  }

  async #rollbackVirtualSlotPayment(state) {
    if (!state || state.rolledBack) {
      return;
    }
    state.rolledBack = true;

    const updates = [];
    if (state.pointsChanged) {
      updates.push(updateDocument(state.points, { "system.uses.spent": state.spent }));
    }
    if (state.cooldownsChanged) {
      updates.push(setActorFlag(state.actor, COOLDOWNS_FLAG, state.cooldowns));
    }
    if (state.highLevelCastsChanged) {
      updates.push(setActorFlag(state.actor, HIGH_LEVEL_CASTS_FLAG, state.highLevelCasts));
    }
    if (state.exhaustionChanged) {
      updates.push(updateDocument(state.actor, { "system.attributes.exhaustion": state.exhaustion }));
    }

    const results = await Promise.allSettled(updates);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(`${MODULE_ID} | Failed to roll back Sorcerer virtual-slot payment.`, result.reason);
      }
    }
  }

  #resumeUsageConfig(usageConfig = {}) {
    return {
      ...usageConfig,
      [MODULE_ID]: {
        ...(usageConfig?.[MODULE_ID] ?? {}),
        [FINAL_BYPASS_FLAG]: true
      }
    };
  }

  #resumeDialogConfig(dialogConfig = {}) {
    return {
      ...dialogConfig,
      configure: false
    };
  }

  #isFinalDnd5eUse(usageConfig) {
    return usageConfig?.[MODULE_ID]?.[FINAL_BYPASS_FLAG] === true;
  }
}
