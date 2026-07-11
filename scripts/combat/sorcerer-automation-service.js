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
const COOLDOWN_CARD_FLAG = "sorcererAutomation.virtualSlotCooldown";
const HIGH_LEVEL_CASTS_FLAG = "sorcererAutomation.highLevelCasts";
const PREFLIGHT_FLAG = "sorcererAutomationPreflight";
const FINAL_BYPASS_FLAG = "sorcererAutomationBypass";
const REACTION_CHECK_COMPLETE_FLAG = "reactionCheckComplete";
const METAMAGIC_SOURCE_TYPE = "sorcererMetamagic";
const MAX_EXTENDED_DURATION_SECONDS = 24 * 60 * 60;
const METAMAGIC_UI_TEXT = Object.freeze({
  "careful-spell": { name: "Аккуратное заклинание", detail: "Когда вы накладываете заклинание, которое вынуждает других существ совершить спасбросок, вы можете защитить некоторых из них от магического воздействия. Для этого вы тратите 1 единицу чародейства и выбираете существ в количестве, равном вашему модификатору Харизмы (минимум одно существо). Указанные существа автоматически преуспевают в спасброске от данного заклинания." },
  "distant-spell": { name: "Далёкое заклинание", detail: "При накладывании заклинания, дистанция которого 5 футов и более, вы можете потратить 1 единицу чародейства, чтобы удвоить это расстояние.\nПри накладывании заклинания с дистанцией «касание», вы можете потратить 1 единицу чародейства, чтобы увеличить это расстояние до 30 футов." },
  "heightened-spell": { name: "Непреодолимое заклинание", detail: "Когда вы накладываете заклинание, которое вынуждает существо совершить спасбросок для защиты от его эффектов, вы можете потратить 3 единицы чародейства, чтобы одна из целей заклинания совершила первый спасбросок от этого заклинания с помехой." },
  "subtle-spell": { name: "Неуловимое заклинание", detail: "Во время накладывания заклинания вы можете потратить 1 единицу чародейства, чтоб наложить его без вербальных и соматических компонентов." },
  "extended-spell": { name: "Продлённое заклинание", detail: "При накладывании заклинания с длительностью 1 минута или более, вы можете потратить 1 единицу чародейства, чтобы один раз удвоить это время, вплоть до максимального в 24 часа." },
  "twinned-spell": { name: "Удвоенное заклинание", detail: "Если вы используете заклинание, нацеливаемое только на одно существо или объект и не имеющее дистанцию «на себя», вы можете потратить количество единиц чародейства, равное уровню заклинания (1 для заговоров), чтобы нацелиться им на второе существо или объект-цель в пределах дистанции этого заклинания.\nЧтобы применить этот вариант, заклинание не должно быть способно нацеливаться более чем на одну цель на текущем накладываемом уровне. Например, волшебная стрела [magic missile] и палящий луч [scorching ray] не могут быть усилены этой метамагией, а луч холода [ray of frost] и цветной шарик [chromatic orb] — могут." },
  "empowered-spell": { name: "Усиленное заклинание", detail: "При совершении броска урона от заклинания вы можете потратить 1 единицу чародейства, чтобы перебросить несколько костей урона в количестве не больше вашего модификатора Харизмы (минимум одна). Вы должны использовать новое выпавшее значение.\n\tВы можете использовать этот вариант метамагии, даже если вы уже использовали другой вариант метамагии во время накладывания заклинания." },
  "quickened-spell": { name: "Ускоренное заклинание", detail: "Если вы накладываете заклинание со временем накладывания «1 действие», вы можете потратить 2 единицы чародейства, чтобы наложить это заклинание бонусным действием." },
  "seeking-spell": { name: "Ищущее заклинание", detail: "Если вы совершаете бросок атаки для заклинания и промахиваетесь, вы можете потратить 2 единицы чародейства, чтобы перебросить к20, и должны использовать новый бросок.\n\tВы можете использовать этот вариант метамагии, даже если вы уже использовали другой вариант метамагии во время накладывания заклинания." }
});

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

function updateSource(document, patch) {
  if (!document || !patch || !Object.keys(patch).length) {
    return document;
  }

  if (typeof document.updateSource === "function") {
    document.updateSource(patch);
    return document;
  }

  for (const [path, value] of Object.entries(patch)) {
    setProperty(document, path, value instanceof Set ? new Set(value) : deepClone(value));
  }
  return document;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dialogV2() {
  return globalThis.foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2 ?? null;
}

function formValues(form, name) {
  const elements = form?.elements?.[name];
  if (!elements) {
    return [];
  }

  if (elements?.tagName === "SELECT" && elements.multiple) {
    return Array.from(elements.selectedOptions ?? [])
      .map((option) => cleanText(option?.value))
      .filter(Boolean);
  }
  const inputs = typeof elements.length === "number" && !elements.tagName
    ? Array.from(elements)
    : [elements];
  return inputs
    .filter((input) => input?.checked !== false && input?.selected !== false)
    .map((input) => cleanText(input?.value))
    .filter(Boolean);
}

function tokenUuid(target) {
  return cleanText(target?.document?.uuid ?? target?.uuid ?? target?.actor?.uuid ?? target);
}

function targetLabel(target) {
  return cleanText(target?.name ?? target?.document?.name ?? target?.actor?.name ?? tokenUuid(target), "Target");
}

function availableTargets({ selectedOnly = false } = {}) {
  const selected = collectionValues(globalThis.game?.user?.targets);
  const candidates = selectedOnly
    ? selected
    : [...selected, ...collectionValues(globalThis.canvas?.tokens?.placeables)];
  const seen = new Set();
  return candidates.reduce((targets, target) => {
    const uuid = tokenUuid(target);
    if (!uuid || seen.has(uuid) || !(target?.actor ?? target?.document?.actor ?? target?.type === "Actor")) {
      return targets;
    }
    seen.add(uuid);
    targets.push({ uuid, label: targetLabel(target) });
    return targets;
  }, []);
}

function damageDieChoices(activity) {
  const parts = activity?.damage?.parts ?? activity?.system?.damage?.parts ?? activity?.item?.system?.damage?.parts ?? [];
  return Array.from(parts ?? []).flatMap((part, partIndex) => {
    const formula = cleanText(part?.formula ?? part?.[0]);
    const partId = cleanText(part?._id ?? part?.id, String(partIndex));
    let dieIndex = 0;
    return Array.from(formula.matchAll(/(\d*)d\d+/giu)).flatMap((match) => {
      const count = Math.max(1, toInteger(match[1] || 1, 1));
      return Array.from({ length: count }, () => ({
        id: `${partId}:${dieIndex}`,
        label: `${formula || "damage"} #${dieIndex + 1}`,
        partIndex,
        dieIndex: dieIndex++
      }));
    });
  });
}

function normalizedDamageDice(activity, values) {
  const valid = new Map(damageDieChoices(activity).map((choice) => [choice.id, choice]));
  const ids = Array.from(new Set((values ?? []).map((value) => cleanText(value)).filter(Boolean)));
  if (!ids.length || ids.some((id) => !valid.has(id))) {
    return null;
  }
  return ids.map((id) => valid.get(id));
}

function notifyWarning(message) {
  globalThis.ui?.notifications?.warn?.(message);
}

async function documentFromUuid(uuid) {
  if (typeof globalThis.fromUuid === "function") {
    return globalThis.fromUuid(uuid);
  }
  if (typeof globalThis.fromUuidSync === "function") {
    return globalThis.fromUuidSync(uuid);
  }
  return null;
}

function targetActor(document) {
  return document?.actor ?? document?.document?.actor ?? (document?.type === "Actor" ? document : null);
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

function hasOwnerTurnCooldown(record) {
  return Boolean(record && typeof record === "object"
    && Object.hasOwn(record, "remaining")
    && Number.isFinite(Number(record.remaining)));
}

function cooldownRemaining(record) {
  return Math.max(0, toInteger(record?.remaining, 0));
}

function cooldownIsActive(record) {
  if (hasOwnerTurnCooldown(record)) {
    return cooldownRemaining(record) > 0;
  }
  return toInteger(record?.expiresAtRound, 0) > currentRound();
}

function cooldownCardMetadata(actor, cooldownKey, remaining) {
  const actorUuid = cleanText(actor?.uuid);
  const actorId = cleanText(actor?.id ?? actor?._id);
  const key = cleanText(cooldownKey);
  if (!key || (!actorUuid && !actorId)) {
    return null;
  }
  return { actorUuid, actorId, cooldownKey: key, remaining: Math.max(0, toInteger(remaining, 0)) };
}

function cooldownCardFlag(message) {
  let value;
  if (typeof message?.getFlag === "function") {
    value = message.getFlag(MODULE_ID, COOLDOWN_CARD_FLAG);
  }
  value ??= message?.flags?.[MODULE_ID]?.[COOLDOWN_CARD_FLAG]
    ?? getProperty(message, `flags.${MODULE_ID}.${COOLDOWN_CARD_FLAG}`, undefined);
  if (!value || typeof value !== "object") {
    return null;
  }

  const cooldownKey = cleanText(value.cooldownKey);
  const actorUuid = cleanText(value.actorUuid);
  const actorId = cleanText(value.actorId);
  if (!cooldownKey || (!actorUuid && !actorId)) {
    return null;
  }
  return { actorUuid, actorId, cooldownKey, remaining: Math.max(0, toInteger(value.remaining, 0)) };
}

function isCooldownCardForActor(metadata, actor, cooldownKey) {
  if (!metadata || cleanText(metadata.cooldownKey) !== cleanText(cooldownKey)) {
    return false;
  }
  const actorUuid = cleanText(actor?.uuid);
  const actorId = cleanText(actor?.id ?? actor?._id);
  return Boolean((actorUuid && actorUuid === cleanText(metadata.actorUuid))
    || (actorId && actorId === cleanText(metadata.actorId)));
}

function cooldownCardFooter(remaining) {
  const text = Math.max(0, toInteger(remaining, 0)) > 0
    ? `Перезарядка: ${Math.max(0, toInteger(remaining, 0))} раундов`
    : "Перезарядка: готово";
  return `<li class="rebreya-sorcerer-cooldown" data-rebreya-sorcerer-cooldown="true">${text}</li>`;
}

function withCooldownCardFooter(content, remaining) {
  const safeContent = String(content ?? "");
  const footer = cooldownCardFooter(remaining);
  const existing = /<li\b[^>]*\bdata-rebreya-sorcerer-cooldown(?:=["'][^"']*["'])?[^>]*>[\s\S]*?<\/li>/iu;
  if (existing.test(safeContent)) {
    return safeContent.replace(existing, footer);
  }

  const cardFooter = /<ul\b[^>]*class=["'][^"']*\bcard-footer\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/iu;
  const existingFooter = safeContent.match(cardFooter)?.[0];
  if (existingFooter) {
    return safeContent.replace(existingFooter, existingFooter.replace(/<\/ul>\s*$/iu, `${footer}</ul>`));
  }

  const newFooter = `<ul class="card-footer pills unlist">${footer}</ul>`;
  if (/<\/div>\s*$/iu.test(safeContent)) {
    return safeContent.replace(/<\/div>\s*$/iu, `${newFooter}</div>`);
  }
  return `${safeContent}${safeContent ? "\n" : ""}${newFooter}`;
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
      : moduleApi ?? {};
    this._deferredActivities = new WeakSet();
    this._finalizingActivities = new WeakSet();
    this._pendingSeekingAttacks = new WeakMap();
    this._pendingEmpoweredDamage = new WeakMap();
    this._saveOverridesByMessage = new Map();
    this._metamagicRecordsByMessage = new Map();
    this._paymentLocks = new WeakMap();
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

    const DialogV2 = dialogV2();
    if (typeof DialogV2?.wait !== "function") {
      return explicitSelection(usageConfig, dialogConfig, baseLevel);
    }

    const options = choices.map(({ spellLevel, cost }) => (
      `<option value="${spellLevel}" data-sorcerer-cost="${cost}"${spellLevel === baseLevel ? " selected" : ""}>${spellLevel} (${cost})</option>`
    )).join("");
    const result = await DialogV2.wait({
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

    const DialogV2 = dialogV2();
    if (typeof DialogV2?.wait !== "function" || !options.length) {
      return { accepted: true, ids: [] };
    }

    const virtualCost = VIRTUAL_SLOT_COSTS[spellLevel] ?? 0;
    const checkboxes = options.map(({ id, label, cost }) => {
      const text = METAMAGIC_UI_TEXT[id] ?? { name: label, detail: "" };
      const actualCost = cost === "spellLevel" ? spellLevel : cost;
      return `<label class="rebreya-sorcerer-option"><input type="checkbox" name="metamagic" value="${id}" data-cost="${actualCost}"><span><strong>${escapeHtml(text.name)}</strong><span class="rebreya-sorcerer-option__details">${escapeHtml(text.detail)}</span></span><span class="rebreya-sorcerer-option__cost">${actualCost} ед.</span></label>`;
    }).join("");
    const selectedTargets = availableTargets({ selectedOnly: true });
    const targetOptions = selectedTargets.map(({ uuid, label }) => (
      `<option value="${escapeHtml(uuid)}">${escapeHtml(label)}</option>`
    )).join("");
    const dieOptions = damageDieChoices(activity).map(({ id, label }) => (
      `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`
    )).join("");
    const result = await DialogV2.wait({
      window: { title: "Метамагия" },
      content: `<div class="rebreya-sorcerer-choice-row">${checkboxes}<label data-metamagic-fields="careful-spell" hidden>Аккуратное: существа, автоматически преуспевающие в спасброске<select name="carefulTargets" multiple>${targetOptions}</select></label><label data-metamagic-fields="heightened-spell" hidden>Непреодолимое: цель с помехой к первому спасброску<select name="heightenedTarget">${targetOptions}</select></label><p data-metamagic-fields="twinned-spell" hidden>Удвоенное: выберите две подходящие цели обычным инструментом выбора целей Foundry.</p><label data-metamagic-fields="empowered-spell" hidden>Усиленное: кубы для переброса<select name="damageDice" multiple>${dieOptions}</select></label><output>Итого: <strong data-sorcerer-total>${virtualCost}</strong> ед. чародейства</output></div>`,
      buttons: [{
        action: "confirm",
        label: "Применить",
        default: true,
        callback: (_event, button) => {
          const carefulTargets = formValues(button?.form, "carefulTargets");
          const heightenedTarget = formValues(button?.form, "heightenedTarget").at(0) ?? "";
          return {
            accepted: true,
            ids: formValues(button?.form, "metamagic"),
            targetUuids: carefulTargets.length ? carefulTargets : [heightenedTarget].filter(Boolean),
            currentTargets: selectedTargets.map(({ uuid }) => uuid),
            secondTargetUuid: "",
            damageDice: formValues(button?.form, "damageDice")
          };
        }
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
    const requestedDamageDice = Array.from(new Set((request.damageDice ?? []).map((id) => cleanText(id)).filter(Boolean)));
    const selectedDamageDice = ids.includes("empowered-spell")
      ? normalizedDamageDice(activity, requestedDamageDice)
      : [];
    let secondTargetUuid = cleanText(request.secondTargetUuid);
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
        // Normal UI uses Foundry's native token targeting: two selected targets.
        // The explicit second-target form remains only for programmatic callers.
        if (!secondTargetUuid && currentTargets.length === 2) {
          secondTargetUuid = currentTargets[1];
        }
        const nativeTargeting = currentTargets.length === 2 && currentTargets.includes(secondTargetUuid);
        if (spellTargetCount(activity) !== 1 || range.units === "self" || !secondTargetUuid
          || (!nativeTargeting && (currentTargets.length !== 1 || currentTargets.includes(secondTargetUuid)))) {
          return null;
        }
      }
      if (id === "empowered-spell" && (!spellHasDamage(activity) || !selectedDamageDice || selectedDamageDice.length < 1 || selectedDamageDice.length > charismaModifier(actor))) {
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

  #applyMetamagicConfig(activity, usageConfig, plan, messageConfig = {}) {
    const meta = plan.metamagic ?? {};
    const modifiers = {};
    const updates = {};
    let components = spellComponents(activity);
    for (const id of meta.ids) {
      if (id === "careful-spell") {
        modifiers.careful = { targets: meta.targetUuids };
      }
      else if (id === "distant-spell") {
        const range = spellRange(activity);
        plan.range ??= range.units === "touch"
          ? { value: 30, units: "ft" }
          : { value: range.value * 2, units: range.units };
        updates["range.value"] = plan.range.value;
        updates["range.units"] = plan.range.units;
        modifiers.distant = true;
      }
      else if (id === "heightened-spell") {
        modifiers.heightened = { targetUuid: meta.targetUuids[0], firstSaveDisadvantage: true };
      }
      else if (id === "subtle-spell") {
        components = sharedSpellComponents(activity, { verbal: false, somatic: false });
        const source = spellComponents(activity);
        if (Object.hasOwn(source, "vocal")) updates["components.vocal"] = false;
        else updates["components.verbal"] = false;
        if (Object.hasOwn(source, "somatic")) updates["components.somatic"] = false;
        else updates["components.s"] = false;
        const properties = activity?.item?.system?.properties;
        if (properties instanceof Set) {
          const adjusted = new Set(properties);
          adjusted.delete("vocal");
          adjusted.delete("somatic");
          updateSource(activity.item, { "system.properties": adjusted });
        }
        else if (Array.isArray(properties)) {
          updateSource(activity.item, { "system.properties": properties.filter((property) => property !== "vocal" && property !== "somatic") });
        }
        modifiers.subtle = true;
      }
      else if (id === "extended-spell") {
        const duration = spellDuration(activity);
        plan.duration ??= durationFromSeconds(durationSeconds(duration) * 2, duration.units);
        updates["duration.value"] = plan.duration.value;
        updates["duration.units"] = plan.duration.units;
        const seconds = Math.min(MAX_EXTENDED_DURATION_SECONDS, Math.max(0, durationSeconds(duration) * 2));
        for (const effect of collectionValues(activity?.item?.effects)) {
          if (getProperty(effect, "flags.dnd5e.concentration", false) === true) continue;
          updateSource(effect, { "duration.seconds": seconds });
        }
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
        plan.activation ??= { type: "bonus", value: 1 };
        usageConfig.activation = deepClone(plan.activation);
        updates["activation.type"] = "bonus";
        updates["activation.value"] = 1;
        modifiers.quickened = true;
      }
      else if (id === "seeking-spell") {
        const option = meta.options?.find((entry) => entry.id === id) ?? { cost: meta.seekingCost ?? 2 };
        modifiers.seeking = { pending: true, cost: this.#metamagicCost(option, plan.choice.spellLevel) };
      }
    }
    updateSource(activity, updates);

    usageConfig.flags ??= {};
    usageConfig.flags[MODULE_ID] ??= {};
    usageConfig.flags[MODULE_ID].castContext = {
      components: deepClone(components),
      targetUuids: meta.ids?.includes("twinned-spell")
        ? [...meta.currentTargets, meta.secondTargetUuid]
        : undefined
    };
    if (meta.ids?.some((id) => id === "careful-spell" || id === "heightened-spell")) {
      messageConfig.data ??= {};
      messageConfig.data.flags ??= {};
      messageConfig.data.flags[MODULE_ID] ??= {};
      messageConfig.data.flags[MODULE_ID].saveOverrides = {
        carefulTargetUuids: meta.ids.includes("careful-spell") ? [...meta.targetUuids] : [],
        heightenedTargetUuid: meta.ids.includes("heightened-spell") ? meta.targetUuids[0] : null,
        heightenedUsed: false
      };
    }
    if (meta.ids?.includes("empowered-spell")) {
      messageConfig.data ??= {};
      messageConfig.data.flags ??= {};
      messageConfig.data.flags[MODULE_ID] ??= {};
      messageConfig.data.flags[MODULE_ID].damageReroll = {
        selectedDamageDice: meta.selectedDamageDice.map((die) => die?.id ?? die)
      };
    }
    if (meta.ids?.includes("seeking-spell")) {
      messageConfig.data ??= {};
      messageConfig.data.flags ??= {};
      messageConfig.data.flags[MODULE_ID] ??= {};
      messageConfig.data.flags[MODULE_ID].attackReroll = {
        cost: modifiers.seeking.cost
      };
    }
    if (meta.ids?.includes("seeking-spell") && spellHasAttack(activity)) {
      this._pendingSeekingAttacks.set(activity, {
        actor: plan.actor,
        activity,
        cost: modifiers.seeking.cost,
        used: false,
        charged: false
      });
    }
    if (meta.ids?.includes("empowered-spell")) {
      this._pendingEmpoweredDamage.set(activity, {
        actor: plan.actor,
        selectedDamageDice: deepClone(meta.selectedDamageDice),
        used: false
      });
    }
    return { components, modifiers, updates };
  }

  #applyCooldownCardConfig(messageConfig = {}, metadata = null) {
    if (!metadata) {
      return;
    }
    messageConfig.data ??= {};
    messageConfig.data.flags ??= {};
    messageConfig.data.flags[MODULE_ID] ??= {};
    messageConfig.data.flags[MODULE_ID][COOLDOWN_CARD_FLAG] = deepClone(metadata);
  }

  #persistResolvedPlan(usageConfig, plan) {
    usageConfig[MODULE_ID] ??= {};
    usageConfig[MODULE_ID][PREFLIGHT_FLAG] = {
      accepted: true,
      spellLevel: plan.choice.spellLevel,
      exhaustionOverride: plan.override,
      metamagic: {
        ids: [...plan.metamagic.ids],
        targetUuids: [...plan.metamagic.targetUuids],
        currentTargets: [...plan.metamagic.currentTargets],
        secondTargetUuid: plan.metamagic.secondTargetUuid,
        damageDice: plan.metamagic.selectedDamageDice.map((die) => die?.id ?? die),
        seekingCost: this.#metamagicCost(
          plan.metamagic.options.find((option) => option.id === "seeking-spell"),
          plan.choice.spellLevel
        )
      },
      range: plan.range ? deepClone(plan.range) : null,
      duration: plan.duration ? deepClone(plan.duration) : null,
      activation: plan.activation ? deepClone(plan.activation) : null
    };
    return usageConfig[MODULE_ID][PREFLIGHT_FLAG];
  }

  #preflightPlan(activity, usageConfig = {}) {
    const stored = usageConfig?.[MODULE_ID]?.[PREFLIGHT_FLAG];
    if (!stored?.accepted) {
      return null;
    }
    const actor = actorFrom(activity);
    const metamagic = this.#validateMetamagic(activity, actor, toInteger(stored.spellLevel, spellBaseLevel(activity)), stored.metamagic);
    if (!metamagic) {
      return null;
    }
    return {
      actor,
      choice: { spellLevel: toInteger(stored.spellLevel, spellBaseLevel(activity)) },
      metamagic,
      override: stored.exhaustionOverride === true,
      range: stored.range ? deepClone(stored.range) : null,
      duration: stored.duration ? deepClone(stored.duration) : null,
      activation: stored.activation ? deepClone(stored.activation) : null
    };
  }

  async #validateSelectedDocuments(plan) {
    const meta = plan.metamagic;
    if (typeof globalThis.fromUuid !== "function" && typeof globalThis.fromUuidSync !== "function") {
      return true;
    }
    const resolveCreature = async (uuid) => {
      const document = await documentFromUuid(uuid);
      const actor = targetActor(document);
      return actor?.uuid ? { document, actor } : null;
    };
    if (meta.ids.some((id) => id === "careful-spell" || id === "heightened-spell")) {
      const targets = await Promise.all(meta.targetUuids.map(resolveCreature));
      if (targets.some((target) => !target)) {
        return false;
      }
      meta.targetUuids = targets.map(({ actor }) => actor.uuid);
    }
    if (meta.ids.includes("twinned-spell")) {
      const [first, second] = await Promise.all([
        resolveCreature(meta.currentTargets[0]),
        resolveCreature(meta.secondTargetUuid)
      ]);
      const currentScene = globalThis.canvas?.scene;
      const placeableIds = new Set(collectionValues(globalThis.canvas?.tokens?.placeables)
        .map((token) => cleanText(token?.document?.id ?? token?.id)));
      const isCurrentSceneToken = ({ document }) => {
        if (document?.documentName !== "Token" && currentScene) return false;
        // Canvas is always available in Foundry. The no-canvas fallback retains
        // compatibility with plain unit-document fixtures only.
        if (!currentScene) return Boolean(document?.actor && cleanText(document?.id ?? document?._id));
        return (document.parent === currentScene || document.parent?.id === currentScene?.id)
          && placeableIds.has(cleanText(document.id ?? document._id));
      };
      if (!first || !second || first.actor.uuid === second.actor.uuid
        || !isCurrentSceneToken(first) || !isCurrentSceneToken(second)) {
        return false;
      }
      const firstId = cleanText(first.document?.id ?? first.document?._id);
      const secondId = cleanText(second.document?.id ?? second.document?._id);
      if (!firstId || !secondId) {
        return false;
      }
      meta.targetIds = [firstId, secondId];
    }
    return true;
  }

  async #applyTwinnedTargets(plan) {
    if (!plan.metamagic.ids.includes("twinned-spell")) {
      return null;
    }
    const updateTargets = globalThis.game?.user?.updateTokenTargets;
    if (typeof updateTargets !== "function") {
      return (typeof globalThis.fromUuid !== "function" && typeof globalThis.fromUuidSync !== "function") ? null : false;
    }
    const previousTargetIds = collectionValues(globalThis.game?.user?.targets)
      .map((target) => cleanText(target?.id ?? target?.document?.id))
      .filter(Boolean);
    await updateTargets.call(globalThis.game.user, new Set(plan.metamagic.targetIds ?? []));
    return { previousTargetIds };
  }

  async #restoreTwinnedTargets(snapshot) {
    if (!snapshot || typeof globalThis.game?.user?.updateTokenTargets !== "function") {
      return;
    }
    await globalThis.game.user.updateTokenTargets(new Set(snapshot.previousTargetIds ?? []));
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
      targets: stored
        ? request?.targets
        : request?.targets ?? usageConfig?.targets ?? globalThis.game?.user?.targets
    });
    if (!metamagic) {
      return null;
    }

    const override = selected.exhaustionOverride || explicitExhaustionOverride(usageConfig, dialogConfig);
    const cooldowns = actorFlag(actor, COOLDOWNS_FLAG);
    const highLevelCasts = actorFlag(actor, HIGH_LEVEL_CASTS_FLAG);
    const key = cooldownKey(activity, choice.spellLevel);
    const activeCooldown = choice.spellLevel <= 5 && cooldownIsActive(cooldowns[key]);
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

    const plan = {
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
    plan.range = stored?.range ? deepClone(stored.range) : null;
    plan.duration = stored?.duration ? deepClone(stored.duration) : null;
    plan.activation = stored?.activation ? deepClone(stored.activation) : null;
    this.#resolvePlannedActivityChanges(activity, plan);
    if (!(await this.#validateSelectedDocuments(plan))) {
      notifyWarning("Selected metamagic targets are no longer valid.");
      return null;
    }

    return plan;
  }

  #resolvePlannedActivityChanges(activity, plan) {
    const ids = plan.metamagic?.ids ?? [];
    if (ids.includes("distant-spell") && !plan.range) {
      const range = spellRange(activity);
      plan.range = range.units === "touch"
        ? { value: 30, units: "ft" }
        : { value: range.value * 2, units: range.units };
    }
    if (ids.includes("extended-spell") && !plan.duration) {
      const duration = spellDuration(activity);
      plan.duration = durationFromSeconds(durationSeconds(duration) * 2, duration.units);
    }
    if (ids.includes("quickened-spell") && !plan.activation) {
      plan.activation = { type: "bonus", value: 1 };
    }
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

  async handleCombatTurnChange(combat, updateData = {}) {
    const actor = this.#resolveCombatTurnActor(combat, updateData);
    if (!actor) {
      return true;
    }

    const cooldowns = actorFlag(actor, COOLDOWNS_FLAG);
    const changedCooldowns = [];
    for (const [key, record] of Object.entries(cooldowns)) {
      if (!hasOwnerTurnCooldown(record)) {
        continue;
      }
      const remaining = cooldownRemaining(record);
      if (remaining <= 0) {
        continue;
      }
      const nextRemaining = remaining - 1;
      cooldowns[key] = { ...record, remaining: nextRemaining };
      changedCooldowns.push({ key, remaining: nextRemaining });
    }
    if (!changedCooldowns.length) {
      return true;
    }

    await setActorFlag(actor, COOLDOWNS_FLAG, cooldowns);
    await Promise.all(changedCooldowns.map(({ key, remaining }) => (
      this.#updateCooldownCards(actor, key, remaining)
    )));
    return true;
  }

  #resolveCombatTurnActor(combat, updateData = {}) {
    const directActor = updateData?.combatant?.actor;
    if (directActor) {
      return directActor;
    }

    const combatantId = cleanText(updateData?.combatantId);
    if (combatantId) {
      const combatant = combat?.combatants?.get?.(combatantId)
        ?? collectionValues(combat?.combatants).find((entry) => cleanText(entry?.id) === combatantId);
      if (combatant?.actor) {
        return combatant.actor;
      }
    }

    const turn = Number(updateData?.turn);
    if (Number.isInteger(turn)) {
      const combatant = collectionValues(combat?.turns)[turn];
      if (combatant?.actor) {
        return combatant.actor;
      }
    }
    return combat?.combatant?.actor ?? null;
  }

  async #updateCooldownCards(actor, cooldownKey, remaining) {
    const updates = collectionValues(globalThis.game?.messages)
      .map((message) => ({ message, metadata: cooldownCardFlag(message) }))
      .filter(({ metadata }) => isCooldownCardForActor(metadata, actor, cooldownKey))
      .map(({ message, metadata }) => updateDocument(message, {
        content: withCooldownCardFooter(message?.content, remaining),
        [`flags.${MODULE_ID}.${COOLDOWN_CARD_FLAG}`]: {
          ...metadata,
          remaining: Math.max(0, toInteger(remaining, 0))
        }
      }));
    const results = await Promise.allSettled(updates);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(`${MODULE_ID} | Failed to update Sorcerer cooldown chat card.`, result.reason);
      }
    }
  }

  deferDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if (!isSorcererSpellActivity(activity)) {
      return true;
    }

    if (usageConfig?.[MODULE_ID]?.[PREFLIGHT_FLAG]) {
      const preflightPlan = this.#preflightPlan(activity, usageConfig);
      if (!preflightPlan) {
        notifyWarning("The stored Sorcerer spell plan is no longer valid.");
        return false;
      }
      this.#applyMetamagicConfig(activity, usageConfig, preflightPlan, messageConfig);
      return true;
    }

    if (this.#isFinalDnd5eUse(usageConfig)) {
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

  async applyDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if (this.#isFinalDnd5eUse(usageConfig) || !isSorcererSpellActivity(activity)) {
      return true;
    }

    const result = await this.#applyVirtualSlotPayment(activity, usageConfig, dialogConfig, messageConfig);
    return result !== null;
  }

  async applyDnd5ePostAttackRoll(rolls = [], context = {}) {
    const activity = context?.subject ?? context?.activity ?? null;
    const safeRolls = Array.isArray(rolls) ? rolls : [rolls].filter(Boolean);
    let pending = activity ? this._pendingSeekingAttacks.get(activity) : null;
    if (!pending) {
      const record = this.#rollUsageRecord(safeRolls)?.attackReroll;
      if (record && activity) {
        pending = {
          actor: actorFrom(activity),
          activity,
          cost: Math.max(1, toInteger(record.cost, 2)),
          used: false,
          charged: false
        };
        this._pendingSeekingAttacks.set(activity, pending);
      }
    }
    if (!pending || pending.used || !isSorcererSpellActivity(activity)) {
      return true;
    }

    if (!safeRolls.some((roll) => roll?.isFailure === true)) {
      return true;
    }

    const points = pointsFeature(pending.actor);
    const cost = Math.max(1, toInteger(pending.cost, 2));
    const spent = Math.max(0, toInteger(points?.system?.uses?.spent, 0));
    const max = Math.max(0, toInteger(points?.system?.uses?.max, 0));
    if (!points || max - spent < cost) {
      return true;
    }

    if (!(await this.#chooseSeekingReroll(activity, safeRolls))) {
      return true;
    }

    pending.used = true;
    try {
      await updateDocument(points, { "system.uses.spent": spent + cost });
      pending.charged = true;
      const usageMessageId = this.#rollUsageMessageId(safeRolls);
      const rerolled = await activity.rollAttack({}, {}, usageMessageId
        ? { data: { "flags.dnd5e.originatingMessage": usageMessageId } }
        : {});
      if (!rerolled) {
        await updateDocument(points, { "system.uses.spent": spent });
        pending.charged = false;
        pending.used = false;
      }
    }
    catch (error) {
      if (pending.charged) {
        await updateDocument(points, { "system.uses.spent": spent });
      }
      pending.charged = false;
      pending.used = false;
      console.error(`${MODULE_ID} | Failed to reroll a missed Seeking Spell attack.`, error);
    }
    return true;
  }

  async #chooseSeekingReroll(activity, rolls) {
    if (this._options.chooseSeekingReroll instanceof Function) {
      return (await this._options.chooseSeekingReroll({ activity, rolls })) === true;
    }
    const DialogV2 = dialogV2();
    if (typeof DialogV2?.wait !== "function") {
      return false;
    }
    const result = await DialogV2.wait({
      window: { title: "Seeking Spell" },
      content: "<p>Spend 2 Sorcery Points to reroll this missed spell attack?</p>",
      buttons: [
        { action: "reroll", label: "Reroll", default: true, callback: () => true },
        { action: "cancel", label: "Cancel", callback: () => false }
      ]
    });
    return result === true;
  }

  handleDnd5ePostCreateUsageMessage(_activity, message) {
    const overrides = typeof message?.getFlag === "function"
      ? message.getFlag(MODULE_ID, "saveOverrides")
      : getProperty(message, `flags.${MODULE_ID}.saveOverrides`, null);
    const id = cleanText(message?.id ?? message?._id);
    if (id && overrides && typeof overrides === "object") {
      this._saveOverridesByMessage.set(id, deepClone(overrides));
    }
    if (id) {
      const record = typeof message?.getFlag === "function"
        ? {
          damageReroll: message.getFlag(MODULE_ID, "damageReroll"),
          attackReroll: message.getFlag(MODULE_ID, "attackReroll")
        }
        : getProperty(message, `flags.${MODULE_ID}`, {});
      if (record?.damageReroll || record?.attackReroll) {
        this._metamagicRecordsByMessage.set(id, deepClone(record));
      }
    }
    const cooldown = cooldownCardFlag(message);
    if (cooldown) {
      updateDocument(message, {
        content: withCooldownCardFooter(message?.content, cooldown.remaining),
        [`flags.${MODULE_ID}.${COOLDOWN_CARD_FLAG}`]: cooldown
      }).catch((error) => {
        console.error(`${MODULE_ID} | Failed to create Sorcerer cooldown chat card.`, error);
      });
    }
    return true;
  }

  #rollUsageMessageId(rolls = []) {
    const parent = (Array.isArray(rolls) ? rolls : [rolls])[0]?.parent ?? null;
    return cleanText(
      parent?.flags?.dnd5e?.originatingMessage
      ?? getProperty(parent, "flags.dnd5e.originatingMessage", undefined)
      ?? parent?.getFlag?.("dnd5e", "originatingMessage")
    );
  }

  #rollUsageRecord(rolls = []) {
    const usageMessageId = this.#rollUsageMessageId(rolls);
    if (!usageMessageId) {
      return null;
    }
    const cached = this._metamagicRecordsByMessage.get(usageMessageId);
    if (cached) {
      return cached;
    }
    const message = globalThis.game?.messages?.get?.(usageMessageId);
    const record = typeof message?.getFlag === "function"
      ? {
        damageReroll: message.getFlag(MODULE_ID, "damageReroll"),
        attackReroll: message.getFlag(MODULE_ID, "attackReroll")
      }
      : getProperty(message, `flags.${MODULE_ID}`, null);
    if (record?.damageReroll || record?.attackReroll) {
      this._metamagicRecordsByMessage.set(usageMessageId, deepClone(record));
      return record;
    }
    return null;
  }

  applyDnd5ePreRollSavingThrow(rollConfig = {}) {
    const messageId = cleanText(rollConfig?.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId);
    let overrides = this._saveOverridesByMessage.get(messageId);
    if (!overrides && messageId) {
      const message = globalThis.game?.messages?.get?.(messageId);
      const persisted = typeof message?.getFlag === "function"
        ? message.getFlag(MODULE_ID, "saveOverrides")
        : getProperty(message, `flags.${MODULE_ID}.saveOverrides`, null);
      if (persisted && typeof persisted === "object") {
        overrides = deepClone(persisted);
        this._saveOverridesByMessage.set(messageId, overrides);
      }
    }
    const actorUuid = cleanText(rollConfig?.subject?.uuid);
    if (!overrides || !actorUuid) {
      return true;
    }

    const targetMatches = (uuid) => cleanText(uuid) === actorUuid;
    if ((overrides.carefulTargetUuids ?? []).some(targetMatches)) {
      rollConfig.target = 0;
      for (const roll of rollConfig.rolls ?? []) {
        roll.options ??= {};
        roll.options.target = 0;
      }
    }
    if (!overrides.heightenedUsed && targetMatches(overrides.heightenedTargetUuid)) {
      rollConfig.disadvantage = true;
      for (const roll of rollConfig.rolls ?? []) {
        roll.options ??= {};
        roll.options.disadvantage = true;
      }
      overrides.heightenedUsed = true;
      this._saveOverridesByMessage.set(messageId, overrides);
    }
    return true;
  }

  applyDnd5ePreRollDamage(_rollConfig = {}, _dialogConfig = {}, _messageConfig = {}) {
    return true;
  }

  async applyDnd5ePostDamageRoll(rolls = [], context = {}) {
    const activity = context?.subject ?? null;
    const safeRolls = Array.isArray(rolls) ? rolls : [rolls].filter(Boolean);
    let pending = activity ? this._pendingEmpoweredDamage.get(activity) : null;
    if (!pending) {
      const record = this.#rollUsageRecord(safeRolls)?.damageReroll;
      const selectedDamageDice = record && activity
        ? normalizedDamageDice(activity, record.selectedDamageDice)
        : null;
      if (selectedDamageDice?.length) {
        pending = { actor: actorFrom(activity), selectedDamageDice, used: false };
        this._pendingEmpoweredDamage.set(activity, pending);
      }
    }
    if (!pending || pending.used) {
      return true;
    }
    const selections = pending.selectedDamageDice.filter((choice) => choice && typeof choice === "object");
    if (!selections.length) {
      return true;
    }

    const diceFor = (roll) => {
      const dice = [];
      const collect = (terms = []) => {
        for (const term of terms) {
          if (Array.isArray(term?.results)) dice.push(term);
          if (Array.isArray(term?.dice)) collect(term.dice);
        }
      };
      collect(roll?.terms ?? []);
      return dice;
    };
    let rerolled = false;
    for (const selection of selections) {
      const roll = safeRolls[selection.partIndex];
      const die = diceFor(roll).flatMap((term) => term.results.map((result, index) => ({ term, result, index })))[selection.dieIndex];
      if (!die?.result?.active || typeof die.term.roll !== "function") {
        continue;
      }
      die.result.active = false;
      die.result.rerolled = true;
      await die.term.roll({ reroll: true });
      if (typeof roll?._evaluateTotal === "function") {
        roll._total = roll._evaluateTotal();
      }
      rerolled = true;
    }
    if (rerolled) {
      pending.used = true;
      const message = safeRolls.find((roll) => roll?.parent)?.parent;
      if (typeof message?.update === "function") {
        await message.update({ rolls: safeRolls.map((roll) => roll.toJSON?.() ?? roll) });
      }
    }
    return true;
  }

  async #applyVirtualSlotPayment(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const actor = actorFrom(activity);
    return this.#withActorPaymentLock(actor, () => this.#applyVirtualSlotPaymentLocked(
      activity,
      usageConfig,
      dialogConfig,
      messageConfig
    ));
  }

  async #withActorPaymentLock(actor, operation) {
    if (!actor || typeof actor !== "object") {
      return operation();
    }
    const previous = this._paymentLocks.get(actor) ?? Promise.resolve();
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    this._paymentLocks.set(actor, previous.catch(() => undefined).then(() => next));
    await previous.catch(() => undefined);
    try {
      return await operation();
    }
    finally {
      release();
    }
  }

  async #applyVirtualSlotPaymentLocked(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if (!isSorcererSpellActivity(activity)) {
      return null;
    }

    const plan = await this.#prepareCastPlan(activity, usageConfig, dialogConfig);
    if (!plan) {
      return null;
    }
    const twinnedTargetSnapshot = await this.#applyTwinnedTargets(plan);
    if (twinnedTargetSnapshot === false) {
      notifyWarning("The selected Twinned Spell target could not be applied.");
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
    const cooldownCard = choice.spellLevel <= 5 && !(activeCooldown && override)
      ? cooldownCardMetadata(actor, key, choice.spellLevel)
      : null;
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
      twinnedTargetSnapshot,
      rolledBack: false
    };

    this.#persistResolvedPlan(usageConfig, plan);
    const metamagicConfig = this.#applyMetamagicConfig(activity, usageConfig, plan, messageConfig);
    try {
      await updateDocument(points, { "system.uses.spent": spent + totalCost });
      state.pointsChanged = true;
      if (choice.spellLevel <= 5) {
        cooldowns[key] = { remaining: choice.spellLevel };
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

    this.#applyCooldownCardConfig(messageConfig, cooldownCard);

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
          ...(usageConfig?.[MODULE_ID] ?? {})
        }
      };
      this.#persistResolvedPlan(preflightUsageConfig, plan);
      const metamagicConfig = this.#applyMetamagicConfig(activity, preflightUsageConfig, plan, messageConfig);
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
    try {
      if (typeof activity?.use !== "function") {
        return;
      }
      await this.#withActorPaymentLock(actorFrom(activity), async () => {
        const payment = await this.#applyVirtualSlotPaymentLocked(activity, usageConfig, dialogConfig);
        if (!payment) {
          return;
        }
        try {
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
          await this.#rollbackVirtualSlotPayment(payment);
          throw error;
        }
      });
    }
    catch (error) {
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
    if (state.twinnedTargetSnapshot) {
      updates.push(this.#restoreTwinnedTargets(state.twinnedTargetSnapshot));
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
