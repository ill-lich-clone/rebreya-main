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

  return cleanText(documentFlag(item, "dnd5e", "advancementRoot")) === SORCERER_ADVANCEMENT_ROOT;
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
      `<option value="${spellLevel}"${spellLevel === baseLevel ? " selected" : ""}>${spellLevel} (${cost})</option>`
    )).join("");
    const result = await globalThis.DialogV2.wait({
      window: { title: "Единицы чародейства" },
      content: `<p>Выберите уровень виртуальной ячейки и её стоимость в единицах чародейства.</p><label>Уровень <select name="spellLevel">${options}</select></label><label><input type="checkbox" name="exhaustionOverride"> Игнорировать ограничение ценой истощения</label>`,
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

  async applyDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, _messageConfig = {}) {
    if (!isSorcererSpellActivity(activity)) {
      return true;
    }

    const actor = actorFrom(activity);
    const baseLevel = spellBaseLevel(activity);
    const maxLevel = scaleValue(actor, MAXIMUM_SPELL_LEVEL_SCALE_ID);
    if (!actor || baseLevel < 1 || maxLevel < baseLevel) {
      return false;
    }

    const choices = Object.entries(VIRTUAL_SLOT_COSTS)
      .map(([level, cost]) => ({ spellLevel: Number(level), cost }))
      .filter(({ spellLevel }) => spellLevel >= baseLevel && spellLevel <= maxLevel);
    if (!choices.length) {
      return false;
    }
    const selected = await this.#chooseVirtualSpellLevel({
      actor,
      activity,
      choices,
      usageConfig,
      dialogConfig,
      baseLevel
    });
    if (!selected.accepted) {
      return false;
    }

    const choice = choices.find(({ spellLevel }) => spellLevel === selected.spellLevel);
    if (!choice) {
      return false;
    }

    const override = selected.exhaustionOverride || explicitExhaustionOverride(usageConfig, dialogConfig);
    const cooldowns = actorFlag(actor, COOLDOWNS_FLAG);
    const highLevelCasts = actorFlag(actor, HIGH_LEVEL_CASTS_FLAG);
    const key = cooldownKey(activity, choice.spellLevel);
    const activeCooldown = choice.spellLevel <= 5
      && toInteger(cooldowns[key]?.expiresAtRound, 0) > currentRound();
    const highLevelRepeat = choice.spellLevel >= 6 && highLevelCasts[String(choice.spellLevel)] === true;
    if ((activeCooldown || highLevelRepeat) && !override) {
      return false;
    }

    const points = pointsFeature(actor);
    if (!points) {
      return false;
    }

    const uses = points.system?.uses ?? {};
    const spent = Math.max(0, toInteger(uses.spent, 0));
    const max = Math.max(0, toInteger(uses.max, 0));
    if (max - spent < choice.cost) {
      return false;
    }

    await updateDocument(points, { "system.uses.spent": spent + choice.cost });
    if (choice.spellLevel <= 5) {
      cooldowns[key] = { expiresAtRound: currentRound() + choice.spellLevel };
      await setActorFlag(actor, COOLDOWNS_FLAG, cooldowns);
    }
    if (choice.spellLevel >= 6) {
      highLevelCasts[String(choice.spellLevel)] = true;
      await setActorFlag(actor, HIGH_LEVEL_CASTS_FLAG, highLevelCasts);
    }

    const exhaustion = override ? 1 : 0;
    if (exhaustion) {
      await updateDocument(actor, { "system.attributes.exhaustion": exhaustionLevel(actor) + exhaustion });
    }

    usageConfig.consumeSpellSlot = false;
    usageConfig.spellCast = {
      spellLevel: choice.spellLevel,
      components: spellComponents(activity),
      payment: {
        resource: "sorcery-points",
        cost: choice.cost
      },
      modifiers: {
        cooldownOverride: activeCooldown && override,
        exhaustion,
        highLevelOverride: highLevelRepeat && override
      }
    };
    return true;
  }
}
