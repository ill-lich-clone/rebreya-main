import { MODULE_ID } from "../constants.js";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION = "character-class-automation";
const PALADIN_CLASS_IDENTIFIER = "paladin-rework-v01";
const PALADIN_SPELLCASTING_FEATURE_ID = "paladin-spellcasting";
const PALADIN_LAY_ON_HANDS_FEATURE_ID = "paladin-lay-on-hands";
const DIVINE_SMITE_FEATURE_ID = "paladin-divine-smite";
const MAGISTRATE_INEVITABLE_SENTENCE_FEATURE_ID = "magistrate-inevitable-sentence";
const DIVINE_SMITE_DAMAGE_TYPE = "radiant";
const INITIAL_PREPARED_SPELLS_FLAG = "paladinInitialPreparedSpellsSelected";

const DIVINE_SMITE_VARIANTS = [
  { id: "devotion-sacred-divine-smite", name: "Священная божественная кара", minSlotLevel: 1 },
  { id: "devotion-protective-smite", name: "Защитная кара", minSlotLevel: 1 },
  { id: "vengeance-branding-smite", name: "Клеймящая кара", minSlotLevel: 1 },
  { id: "vengeance-halting-smite", name: "Останавливающая кара", minSlotLevel: 1 },
  { id: "glory-pushing-smite", name: "Толкающая кара", minSlotLevel: 1 },
  { id: "glory-toppling-smite", name: "Опрокидывающая кара", minSlotLevel: 1 },
  { id: "oathbreaker-rotten-divine-smite", name: "Гнилая божественная кара", minSlotLevel: 1 },
  { id: "oathbreaker-wrathful-smite", name: "Гневная кара", minSlotLevel: 1 },
  { id: "nirkadu-ranged-divine-smite", name: "Дальнобойная божественная кара", minSlotLevel: 1, allowRanged: true },
  { id: "nirkadu-stealthy-divine-smite", name: "Скрытная божественная кара", minSlotLevel: 1 },
  { id: "arcana-disruptive-smite", name: "Разрушающая кара", minSlotLevel: 1 },
  { id: "arcana-creative-smite", name: "Созидающая кара", minSlotLevel: 1 },
  { id: "magistrate-accusation-smite", name: "Кара обвинения", minSlotLevel: 1 },
  { id: "magistrate-detention-smite", name: "Кара задержания", minSlotLevel: 1 },
  { id: "paladin-heavenly-smite", name: "Небесная кара", minSlotLevel: 3 },
  { id: "paladin-stunning-smite", name: "Оглушающая кара", minSlotLevel: 3 },
  { id: "paladin-sealing-smite", name: "Запечатывающая кара", minSlotLevel: 5 },
  { id: "paladin-banishing-smite", name: "Изгоняющая кара", minSlotLevel: 5 }
];

const DIVINE_SMITE_VARIANT_BY_ID = new Map(DIVINE_SMITE_VARIANTS.map((variant) => [variant.id, variant]));
const MAGISTRATE_SMITE_BY_ID = new Map([
  ["magistrate-accusation-smite", {
    variant: "accusation",
    saveAbility: "cha",
    failedEffects: ["accusationNoAdvantage"]
  }],
  ["magistrate-detention-smite", {
    variant: "detention",
    saveAbility: "wis",
    successEffects: ["detentionSlow"],
    failedEffects: ["detentionSlow", "detentionNoReaction"]
  }]
]);
const MAGISTRATE_EFFECT_LABELS = {
  accusationNoAdvantage: "Кара обвинения: запрет преимущества",
  detentionSlow: "Кара задержания: замедление",
  detentionNoReaction: "Кара задержания: запрет реакций"
};
const MAGISTRATE_EFFECT_ICONS = {
  accusationNoAdvantage: "icons/svg/eye.svg",
  detentionSlow: "icons/svg/clockwork.svg",
  detentionNoReaction: "icons/svg/paralysis.svg"
};
const MOVEMENT_KEYS = ["burrow", "climb", "fly", "swim", "walk"];
const JURISDICTION_EFFECT_LABELS = {
  protectedByLaw: "Под защитой закона",
  supervisedByLaw: "Под надзором закона",
  lawOrphan: "Беспризорник"
};
const JURISDICTION_EFFECT_ICONS = {
  protectedByLaw: "icons/svg/shield.svg",
  supervisedByLaw: "icons/svg/terror.svg",
  lawOrphan: "icons/svg/mystery-man.svg"
};
const JURISDICTION_EFFECT_IDS = new Set(Object.keys(JURISDICTION_EFFECT_LABELS));

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

export { SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION };

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['"\u2019\u2018\u02BC\u02B9\u2032\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
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

  return [];
}

function unique(values) {
  return Array.from(new Set(Array.isArray(values) ? values : []));
}

function getProperty(source, path, fallback = undefined) {
  const value = foundry.utils.getProperty(source, path);
  return value === undefined ? fallback : value;
}

function setProperty(target, path, value) {
  foundry.utils.setProperty(target, path, value);
  return target;
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(cleanText(value));
}

function getDialogButtonForm(button) {
  if (typeof HTMLElement !== "undefined" && button?.form instanceof HTMLElement) {
    return button.form;
  }

  if (typeof HTMLElement !== "undefined" && button instanceof HTMLElement) {
    return button.closest?.("form") ?? null;
  }

  return button?.form ?? null;
}

function isActorDocument(actor) {
  return typeof Actor !== "undefined" && actor instanceof Actor;
}

function itemFlag(item, scope, key) {
  if (typeof item?.getFlag === "function") {
    return item.getFlag(scope, key);
  }

  return getProperty(item, `flags.${scope}.${key}`, undefined);
}

function actorFlag(actor, key) {
  if (typeof actor?.getFlag === "function") {
    return actor.getFlag(MODULE_ID, key);
  }

  return getProperty(actor, `flags.${MODULE_ID}.${key}`, undefined);
}

function getSocketUser(senderId) {
  const safeSenderId = cleanText(senderId);
  if (!safeSenderId) {
    return null;
  }

  return game.users?.get?.(safeSenderId)
    ?? collectionValues(game.users).find((user) => user?.id === safeSenderId)
    ?? null;
}

function activeGmUser() {
  return game.users?.activeGM
    ?? collectionValues(game.users).find((user) => user?.isGM && user?.active)
    ?? null;
}

function isActiveGmClient() {
  if (!game.user?.isGM) {
    return false;
  }

  const activeGm = activeGmUser();
  return !activeGm?.id || activeGm.id === game.user.id;
}

function userOwnsActor(actor, user) {
  if (!actor || !user) {
    return false;
  }

  if (user.isGM) {
    return true;
  }

  if (typeof actor.testUserPermission === "function") {
    try {
      return actor.testUserPermission(user, "OWNER") === true;
    }
    catch (error) {
      return false;
    }
  }

  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[user.id] ?? ownership.default ?? 0) >= 3;
}

async function resolveUuid(uuid) {
  const safeUuid = cleanText(uuid);
  if (!safeUuid) {
    return null;
  }

  if (typeof globalThis.fromUuidSync === "function") {
    try {
      const document = globalThis.fromUuidSync(safeUuid);
      if (document) {
        return document;
      }
    }
    catch (error) {
      // Fall through to async UUID resolution.
    }
  }

  if (typeof globalThis.fromUuid === "function") {
    try {
      return globalThis.fromUuid(safeUuid);
    }
    catch (error) {
      return null;
    }
  }

  return null;
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

function rawFeatureId(featureId) {
  return cleanText(featureId).split("::").pop() ?? "";
}

function itemFeatureId(item) {
  return cleanText(itemFlag(item, MODULE_ID, "featureId"));
}

function effectFlag(effect, path, fallback = undefined) {
  const value = getProperty(effect, `flags.${MODULE_ID}.${path}`, undefined);
  return value === undefined ? fallback : value;
}

function featureIdMatches(item, rawId) {
  const featureId = itemFeatureId(item);
  return featureId === rawId || rawFeatureId(featureId) === rawId;
}

function isPaladinSpellcastingFeature(item) {
  return featureIdMatches(item, PALADIN_SPELLCASTING_FEATURE_ID);
}

function isLayOnHandsFeature(item) {
  return featureIdMatches(item, PALADIN_LAY_ON_HANDS_FEATURE_ID)
    || normalizeText(item?.name) === "наложение рук";
}

function isSovereignJurisdictionFeature(item) {
  return featureIdMatches(item, "magistrate-sovereign-jurisdiction");
}

function hasActorFeature(actor, rawId, normalizedName = "") {
  return collectionValues(actor?.items).some((item) => (
    featureIdMatches(item, rawId)
    || (normalizedName && normalizeText(item?.name) === normalizedName)
  ));
}

function isPaladinClassItem(item) {
  if (item?.type !== "class") {
    return false;
  }

  const text = normalizeText([
    item?.system?.identifier,
    item?.identifier,
    item?.name
  ].filter(Boolean).join(" "));
  return text === PALADIN_CLASS_IDENTIFIER || text.includes("paladin") || text.includes("РїР°Р»Р°РґРёРЅ");
}

function findActorFeature(actor, rawId, normalizedName = "") {
  return collectionValues(actor?.items).find((item) => (
    featureIdMatches(item, rawId)
    || (normalizedName && normalizeText(item?.name) === normalizedName)
  )) ?? null;
}

function resolveActorFromTarget(target) {
  return target?.actor
    ?? target?.document?.actor
    ?? target?.object?.actor
    ?? target?.token?.actor
    ?? null;
}

function targetActorsFromWorkflow(workflow) {
  const targets = [
    ...collectionValues(workflow?.hitTargets),
    ...collectionValues(workflow?.hitTargetsEC)
  ];
  const seen = new Set();
  const actors = [];
  for (const target of targets) {
    const actor = resolveActorFromTarget(target);
    if (!(actor instanceof Actor)) {
      continue;
    }

    const key = cleanText(actor.uuid ?? actor.id ?? actor.name);
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    actors.push(actor);
  }
  return actors;
}

function itemSourceId(item) {
  return cleanText(itemFlag(item, "dnd5e", "sourceId"));
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
    const text = normalizeText(value);
    return text === "long" || text === "lr" || text.includes("продолж");
  });
}

function paladinClassLevel(actor) {
  const classes = actor?.system?.classes;
  if (classes && typeof classes === "object") {
    for (const [key, entry] of Object.entries(classes)) {
      const text = normalizeText([
        key,
        entry?.identifier,
        entry?.name,
        entry?.label,
        entry?.system?.identifier
      ].filter(Boolean).join(" "));
      if (text !== PALADIN_CLASS_IDENTIFIER && !text.includes("paladin") && !text.includes("паладин")) {
        continue;
      }

      const levels = toNumber(entry?.levels ?? entry?.level ?? entry?.value, 0);
      if (levels > 0) {
        return Math.floor(levels);
      }
    }
  }

  for (const item of collectionValues(actor?.items)) {
    if (item?.type !== "class") {
      continue;
    }

    const text = normalizeText([
      item?.system?.identifier,
      item?.identifier,
      item?.name
    ].filter(Boolean).join(" "));
    if (text !== PALADIN_CLASS_IDENTIFIER && !text.includes("paladin") && !text.includes("паладин")) {
      continue;
    }

    const levels = toNumber(item?.system?.levels ?? item?.system?.level ?? item?.system?.advancement?.level, 0);
    if (levels > 0) {
      return Math.floor(levels);
    }
  }

  return 0;
}

function paladinPreparedSpellCount(actor, paladinLevel) {
  const charismaModifier = Math.floor(toNumber(actor?.system?.abilities?.cha?.mod, 0));
  return Math.max(1, charismaModifier + Math.floor(paladinLevel / 2));
}

function paladinInitialPreparedSpellCount(actor) {
  const charismaModifier = Math.floor(toNumber(actor?.system?.abilities?.cha?.mod, 0));
  return Math.max(1, 2 + charismaModifier);
}

function paladinMaxSpellLevel(paladinLevel) {
  if (paladinLevel < 2) {
    return 0;
  }

  return Math.min(5, Math.floor((paladinLevel - 1) / 4) + 1);
}

function isPaladinPreparedSpellItem(item) {
  if (item?.type !== "spell") {
    return false;
  }

  if (itemFlag(item, MODULE_ID, "paladinDogmaSpell")) {
    return false;
  }

  if (itemFlag(item, MODULE_ID, "paladinPreparedSpell") === true) {
    return true;
  }

  return cleanText(item?.system?.sourceClass) === PALADIN_CLASS_IDENTIFIER
    && cleanText(item?.system?.method, "spell") === "spell";
}

function spellMatchKeys(spell) {
  return {
    uuid: cleanText(spell?.uuid),
    sourceId: itemSourceId(spell),
    identifier: cleanText(spell?.system?.identifier),
    name: normalizeText(spell?.name)
  };
}

function actorSpellMatchesSelection(item, selected) {
  const keys = spellMatchKeys(item);
  return Boolean(
    (keys.sourceId && selected.uuids.has(keys.sourceId))
    || (keys.uuid && selected.uuids.has(keys.uuid))
    || (keys.identifier && selected.identifiers.has(keys.identifier))
    || (keys.name && selected.names.has(keys.name))
  );
}

function selectedUuidForActorSpell(item, selected) {
  const keys = spellMatchKeys(item);
  if (keys.sourceId && selected.uuids.has(keys.sourceId)) {
    return keys.sourceId;
  }
  if (keys.uuid && selected.uuids.has(keys.uuid)) {
    return keys.uuid;
  }
  if (keys.identifier && selected.uuidByIdentifier.has(keys.identifier)) {
    return selected.uuidByIdentifier.get(keys.identifier);
  }
  if (keys.name && selected.uuidByName.has(keys.name)) {
    return selected.uuidByName.get(keys.name);
  }
  return "";
}

function createSpellData(spellDocument) {
  const data = typeof spellDocument?.toObject === "function"
    ? spellDocument.toObject()
    : foundry.utils.deepClone(spellDocument);
  delete data._id;
  data.type = "spell";
  setProperty(data, "system.sourceClass", PALADIN_CLASS_IDENTIFIER);
  setProperty(data, "system.method", "spell");
  setProperty(data, "system.prepared", 1);
  setProperty(data, `flags.${MODULE_ID}.paladinPreparedSpell`, true);
  if (spellDocument?.uuid) {
    setProperty(data, "flags.dnd5e.sourceId", spellDocument.uuid);
  }
  return data;
}

function actorHpValue(actor) {
  return Math.max(0, Math.floor(toNumber(actor?.system?.attributes?.hp?.value, 0)));
}

function actorHpMax(actor) {
  return Math.max(0, Math.floor(toNumber(actor?.system?.attributes?.hp?.max, 0)));
}

function clampInteger(value, min, max) {
  const numericValue = Math.floor(toNumber(value, min));
  return Math.min(Math.max(numericValue, min), max);
}

function speakerForActor(actor) {
  if (typeof globalThis.ChatMessage?.getSpeaker === "function") {
    return globalThis.ChatMessage.getSpeaker({ actor });
  }

  return {
    actor: actor?.id,
    alias: actor?.name
  };
}

function isWeaponAttackWorkflow(workflow) {
  const activity = workflow?.activity;
  const item = activity?.item ?? workflow?.item;
  if (item?.type !== "weapon") {
    return false;
  }

  const activityType = cleanText(activity?.type);
  return !activityType || activityType === "attack";
}

function isMeleeWeaponAttackWorkflow(workflow) {
  const activity = workflow?.activity;
  const item = activity?.item ?? workflow?.item;
  const actionType = cleanText(activity?.actionType ?? item?.system?.actionType).toLowerCase();
  if (actionType === "mwak") {
    return true;
  }

  const attackType = cleanText(activity?.attack?.type?.value ?? item?.system?.attack?.type?.value).toLowerCase();
  return attackType === "melee";
}

function isRangedWeaponAttackWorkflow(workflow) {
  const activity = workflow?.activity;
  const item = activity?.item ?? workflow?.item;
  const actionType = cleanText(activity?.actionType ?? item?.system?.actionType).toLowerCase();
  if (actionType === "rwak") {
    return true;
  }

  const attackType = cleanText(activity?.attack?.type?.value ?? item?.system?.attack?.type?.value).toLowerCase();
  return attackType === "ranged";
}

function availableSpellSlots(actor) {
  const slots = [];
  for (let level = 1; level <= 9; level += 1) {
    const slot = actor?.system?.spells?.[`spell${level}`];
    const value = Math.floor(toNumber(slot?.value, 0));
    const max = Math.floor(toNumber(slot?.max, 0));
    if (value <= 0 || max <= 0) {
      continue;
    }

    slots.push({
      level,
      value,
      max
    });
  }
  return slots;
}

function divineSmiteDamageDice(slotLevel) {
  return Math.min(5, Math.max(2, Math.floor(toNumber(slotLevel, 1)) + 1));
}

function combatTurnKey(actor, workflow) {
  const combat = workflow?.combat ?? game?.combat ?? null;
  if (!cleanText(combat?.id)) {
    return "";
  }

  return [
    cleanText(combat?.id),
    Math.floor(toNumber(combat?.round, 0)),
    Math.floor(toNumber(combat?.turn, 0)),
    cleanText(actor?.uuid ?? actor?.id ?? actor?.name, "actor"),
    "divine-smite"
  ].join(":");
}

function actorAutomationKey(actor, fallback = "actor") {
  return cleanText(actor?.uuid ?? actor?.id ?? actor?.name, fallback);
}

function activeEffectAddMode() {
  return globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
}

function actorFromItem(item) {
  return item?.parent ?? item?.actor ?? item?.document?.parent ?? null;
}

function itemBelongsToActor(item, actor) {
  if (!item || !actor) {
    return false;
  }

  if (item.actor === actor || item.parent === actor) {
    return true;
  }

  const itemKey = cleanText(item.uuid ?? item.id);
  return Boolean(itemKey) && collectionValues(actor.items).some((actorItem) => (
    cleanText(actorItem?.uuid ?? actorItem?.id) === itemKey
  ));
}

function isCurrentUserHook(userId) {
  const hookUserId = cleanText(userId);
  const currentUserId = cleanText(game?.user?.id);
  return !hookUserId || !currentUserId || hookUserId === currentUserId;
}

function changedPathExists(changed, path) {
  if (!changed || typeof changed !== "object") {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(changed, path)) {
    return true;
  }

  return getProperty(changed, path, undefined) !== undefined;
}

function actorPaladinLevelChanged(changed) {
  return changedPathExists(changed, `system.classes.${PALADIN_CLASS_IDENTIFIER}.levels`)
    || changedPathExists(changed, `system.classes.${PALADIN_CLASS_IDENTIFIER}.level`)
    || changedPathExists(changed, "system.classes");
}

function classItemLevelChanged(changed) {
  return changedPathExists(changed, "system.levels")
    || changedPathExists(changed, "system.level")
    || changedPathExists(changed, "system.advancement.level");
}

function actorItemByIdOrUuid(actor, itemId, itemUuid) {
  const safeItemId = cleanText(itemId);
  const safeItemUuid = cleanText(itemUuid);
  if (safeItemId && typeof actor?.items?.get === "function") {
    const item = actor.items.get(safeItemId);
    if (item) {
      return item;
    }
  }

  return collectionValues(actor?.items).find((item) => (
    (safeItemId && cleanText(item?.id) === safeItemId)
    || (safeItemUuid && cleanText(item?.uuid) === safeItemUuid)
  )) ?? null;
}

function effectIsEnabled(effect) {
  return effect?.disabled !== true;
}

function selectedVariantIdsFromChoice(choice) {
  if (Array.isArray(choice?.variantIds)) {
    return choice.variantIds.map((entry) => cleanText(entry)).filter(Boolean);
  }

  const single = cleanText(choice?.variantId);
  return single ? [single] : [];
}

function damageDiceFormula(diceCount, faces) {
  const dice = Math.max(0, Math.floor(toNumber(diceCount, 0)));
  return `${dice}d${Math.max(1, Math.floor(toNumber(faces, 1)))}`;
}

function damagePropertiesFromWorkflow(workflow) {
  const item = workflow?.activity?.item ?? workflow?.item ?? null;
  const properties = collectionValues(item?.system?.properties)
    .map((property) => cleanText(property))
    .filter(Boolean);
  const propertyConfig = globalThis.CONFIG?.DND5E?.itemProperties ?? {};
  return properties.filter((property) => propertyConfig[property]?.isPhysical !== false);
}

function appendDamageRollConfig(config, workflow, actor, formula, damageType, flavor) {
  const safeFormula = cleanText(formula);
  if (!safeFormula) {
    return false;
  }

  const safeDamageType = cleanText(damageType);
  config.rolls ??= [];
  config.rolls.push({
    data: actor?.getRollData?.() ?? {},
    parts: [safeFormula],
    options: {
      type: safeDamageType,
      types: safeDamageType ? [safeDamageType] : [],
      properties: damagePropertiesFromWorkflow(workflow),
      flavor: cleanText(flavor, safeDamageType)
    }
  });
  return true;
}

export class PaladinAutomationService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this._smiteTurnUses = new Set();
    this._smiteWorkflowUses = new WeakSet();
    this._smiteWorkflowKeys = new Set();
    this._initialPreparedSpellActors = new Set();
    this._options = options;
  }

  async initialize() {
    return true;
  }

  registerLongRestSteps(pipeline) {
    if (typeof pipeline?.registerStep !== "function") return false;
    pipeline.registerStep({
      id: "paladin.prepared-spells",
      label: "Заклинания паладина",
      order: 220,
      interactive: true,
      isEligible: ({ actor }) => (
        isActorDocument(actor)
        && paladinMaxSpellLevel(paladinClassLevel(actor)) > 0
        && this.#canPrompt(actor)
      ),
      run: ({ actor, progress }) => (
        this.choosePaladinSpellsAfterLongRest(actor, { progress })
      )
    });
    return true;
  }

  async applyMidiPreDamageRoll(workflow, activity, config = {}) {
    if (workflow && activity && !workflow.activity) {
      workflow.activity = activity;
    }

    const actor = workflow?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const smiteFeature = this.#findDivineSmite(actor);
    if (!smiteFeature || !isWeaponAttackWorkflow(workflow)) {
      return true;
    }

    const allVariants = this.#divineSmiteVariants(actor);
    const canSmiteAtRange = allVariants.some((variant) => variant.allowRanged === true);
    const isMelee = isMeleeWeaponAttackWorkflow(workflow);
    if (!isMelee && !(canSmiteAtRange && isRangedWeaponAttackWorkflow(workflow))) {
      return true;
    }

    const targets = targetActorsFromWorkflow(workflow);
    if (!targets.length) {
      return true;
    }
    if (this.#hasWorkflowSmiteUse(workflow)) {
      return true;
    }

    const slots = availableSpellSlots(actor);
    if (!slots.length) {
      return true;
    }
    const variants = allVariants.filter((variant) => (
      slots.some((slot) => slot.level >= Math.floor(toNumber(variant.minSlotLevel, 1)))
    ));

    const turnKey = combatTurnKey(actor, workflow);
    const actorIgnoresTurnLimit = this.#canIgnoreDivineSmiteTurnLimit(actor);
    const canReachInevitableTarget = targets.some((target) => this.#canUseInevitableSentence(actor, target));
    if (turnKey && !actorIgnoresTurnLimit && !canReachInevitableTarget && this._smiteTurnUses.has(turnKey)) {
      return true;
    }

    const details = {
      slots,
      variants,
      targets: targets.map((target) => ({
        uuid: cleanText(target.uuid ?? target.id),
        name: cleanText(target.name, "Цель")
      })),
      oncePerTurn: !actorIgnoresTurnLimit && !canReachInevitableTarget,
      damageType: DIVINE_SMITE_DAMAGE_TYPE
    };
    const choice = await this.#promptDivineSmite(actor, details);
    if (!choice) {
      return true;
    }

    const slotLevel = Math.floor(toNumber(choice.slotLevel, 0));
    const selectedSlot = slots.find((slot) => slot.level === slotLevel);
    if (!selectedSlot) {
      return true;
    }

    const chosenTarget = this.#chosenSmiteTarget(targets, choice) ?? targets[0];
    if (!(chosenTarget instanceof Actor)) {
      return true;
    }
    const ignoresTurnLimit = actorIgnoresTurnLimit || this.#canUseInevitableSentence(actor, chosenTarget);
    if (turnKey && !ignoresTurnLimit && this._smiteTurnUses.has(turnKey)) {
      return true;
    }

    const selectedVariantIds = this.#validatedSmiteVariantIds(choice, variants, selectedSlot.level);
    const selectedVariants = selectedVariantIds
      .map((id) => variants.find((variant) => variant.id === id))
      .filter(Boolean);
    const latestSlot = actor?.system?.spells?.[`spell${selectedSlot.level}`];
    const latestValue = Math.floor(toNumber(latestSlot?.value, 0));
    if (latestValue <= 0) {
      return true;
    }

    const formula = damageDiceFormula(divineSmiteDamageDice(selectedSlot.level), 8);
    if (!appendDamageRollConfig(config, workflow, actor, formula, DIVINE_SMITE_DAMAGE_TYPE, this.#divineSmiteLabel(selectedSlot.level, selectedVariants))) {
      return true;
    }
    await actor.update?.({ [`system.spells.spell${selectedSlot.level}.value`]: latestValue - 1 });
    this.#markWorkflowSmiteUse(workflow);
    if (turnKey && !ignoresTurnLimit) {
      this._smiteTurnUses.add(turnKey);
    }
    await this.#applyMagistrateSmiteVariants(actor, chosenTarget, selectedVariants, {
      workflow,
      slotLevel: selectedSlot.level
    });

    return true;
  }

  async applyMidiRollComplete() {
    return true;
  }

  async applyDnd5ePostUseActivity(activity, usageConfig, results) {
    void usageConfig;
    void results;

    const actor = activity?.actor ?? activity?.item?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const automation = cleanText(itemFlag(activity, MODULE_ID, "automation"));
    if (automation === "paladin-lay-on-hands") {
      await this.#useLayOnHands(actor, activity?.item);
    }
    if (automation === "paladin-magistrate-jurisdiction") {
      await this.#useSovereignJurisdiction(actor, activity?.item);
    }

    return true;
  }

  applyDnd5ePreRollD20Test(rollConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const actor = this.#actorFromRollContext(rollConfig, dialogConfig, messageConfig);
    if (!(actor instanceof Actor) || !this.#hasMagistrateEffect(actor, "accusationNoAdvantage")) {
      return true;
    }

    this.#stripD20Advantage(rollConfig);
    this.#stripD20Advantage(dialogConfig);
    for (const roll of collectionValues(rollConfig?.rolls)) {
      this.#stripD20Advantage(roll);
      this.#stripD20Advantage(roll?.options);
    }
    return true;
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!isActorDocument(actor) || !isLongRest(result, config)) {
      return true;
    }

    await this.choosePaladinSpellsAfterLongRest(actor);
    return true;
  }

  async choosePaladinSpellsAfterLongRest(actor, execution = {}) {
    const paladinLevel = paladinClassLevel(actor);
    const maxSpellLevel = paladinMaxSpellLevel(paladinLevel);
    if (maxSpellLevel <= 0 || !this.#canPrompt(actor)) {
      return { status: "skipped" };
    }

    const details = {
      paladinLevel,
      preparedCount: paladinPreparedSpellCount(actor, paladinLevel),
      maxSpellLevel
    };
    const confirmed = await this.#confirmPreparedSpellChange(
      actor,
      details,
      execution.progress
    );
    if (!confirmed) {
      return { status: "skipped" };
    }

    const selectedUuids = await this.#selectPreparedSpellUuids(
      actor,
      details,
      execution.progress
    );
    if (!selectedUuids) {
      return { status: "skipped" };
    }

    await this.#applyPreparedSpellSelection(actor, selectedUuids);
    return { status: "completed" };
  }

  async handleCombatTurnChange(combat, updateData = {}) {
    const actor = this.#resolveCombatTurnActor(combat, updateData);
    if (!(actor instanceof Actor)) {
      return true;
    }

    await this.#deleteSourceNextTurnMagistrateEffects(actor, combat);
    return true;
  }

  async handleCreatedItem(item, options = {}, userId = "") {
    void options;
    if (!isCurrentUserHook(userId) || !isPaladinSpellcastingFeature(item)) {
      return true;
    }

    return this.#promptInitialPreparedSpells(actorFromItem(item), { spellcastingFeature: item });
  }

  async handleUpdatedItem(item, changed = {}, options = {}, userId = "") {
    void options;
    if (!isCurrentUserHook(userId) || !isPaladinClassItem(item) || !classItemLevelChanged(changed)) {
      return true;
    }

    return this.#promptInitialPreparedSpells(actorFromItem(item));
  }

  async handleActorUpdated(actor, changed = {}, options = {}, userId = "") {
    void options;
    if (!isCurrentUserHook(userId) || !actorPaladinLevelChanged(changed)) {
      return true;
    }

    return this.#promptInitialPreparedSpells(actor);
  }

  async handleSocketMessage(payload = {}, { senderId = "" } = {}) {
    if (!isActiveGmClient()) {
      return false;
    }

    const sender = getSocketUser(senderId);
    if (!sender) {
      return false;
    }

    const action = cleanText(payload.action);
    if (action === "paladin.layOnHands") {
      return this.#handleLayOnHandsSocketRequest(payload, { sender });
    }
    if (action === "paladin.sovereignJurisdiction") {
      return this.#handleSovereignJurisdictionSocketRequest(payload, { sender });
    }
    if (action === "paladin.magistrateSmite") {
      return this.#handleMagistrateSmiteSocketRequest(payload, { sender });
    }

    return false;
  }

  #canPrompt(actor) {
    return Boolean(game.user?.isGM || actor?.isOwner);
  }

  #canUpdate(document) {
    return Boolean(game.user?.isGM || document?.isOwner || document?.actor?.isOwner || document?.parent?.isOwner);
  }

  #workflowSmiteKey(workflow) {
    return cleanText(workflow?.id ?? workflow?.uuid);
  }

  #hasWorkflowSmiteUse(workflow) {
    if (!workflow || typeof workflow !== "object") {
      return false;
    }

    const key = this.#workflowSmiteKey(workflow);
    return (key && this._smiteWorkflowKeys.has(key)) || this._smiteWorkflowUses.has(workflow);
  }

  #markWorkflowSmiteUse(workflow) {
    if (!workflow || typeof workflow !== "object") {
      return;
    }

    const key = this.#workflowSmiteKey(workflow);
    if (key) {
      this._smiteWorkflowKeys.add(key);
    }
    this._smiteWorkflowUses.add(workflow);
  }

  #actorFromRollContext(rollConfig = {}, dialogConfig = {}, messageConfig = {}) {
    return rollConfig?.actor
      ?? rollConfig?.subject?.actor
      ?? rollConfig?.subject
      ?? dialogConfig?.actor
      ?? dialogConfig?.subject?.actor
      ?? messageConfig?.actor
      ?? messageConfig?.subject?.actor
      ?? null;
  }

  #hasMagistrateEffect(actor, effectId) {
    return collectionValues(actor?.effects).some((effect) => (
      effectIsEnabled(effect)
      && effectFlag(effect, "paladinAutomation.kind") === "magistrateEffect"
      && effectFlag(effect, "paladinAutomation.effect") === effectId
    ));
  }

  #hasMagistrateEffectFromSource(actor, effectId, sourceActor) {
    const sourceUuid = cleanText(sourceActor?.uuid);
    return collectionValues(actor?.effects).some((effect) => (
      effectIsEnabled(effect)
      && effectFlag(effect, "paladinAutomation.kind") === "magistrateEffect"
      && effectFlag(effect, "paladinAutomation.effect") === effectId
      && cleanText(effectFlag(effect, "paladinAutomation.sourceActorUuid")) === sourceUuid
    ));
  }

  #canUseInevitableSentence(sourceActor, target) {
    return hasActorFeature(sourceActor, MAGISTRATE_INEVITABLE_SENTENCE_FEATURE_ID)
      && this.#hasMagistrateEffectFromSource(target, "supervisedByLaw", sourceActor);
  }

  #stripD20Advantage(target) {
    if (!target || typeof target !== "object") {
      return;
    }

    if (Object.hasOwn(target, "advantage")) {
      target.advantage = false;
    }
    if (Object.hasOwn(target, "heroicAdvantage")) {
      target.heroicAdvantage = false;
    }
    if (Object.hasOwn(target, "advantageMode")) {
      target.advantageMode = typeof target.advantageMode === "string" ? "normal" : 0;
    }
    if (target.options && typeof target.options === "object") {
      this.#stripD20Advantage(target.options);
    }
    if (target.workflowOptions && typeof target.workflowOptions === "object") {
      this.#stripD20Advantage(target.workflowOptions);
    }
  }

  #resolveCombatTurnActor(combat, updateData = {}) {
    const current = updateData?.current ?? updateData;
    const actor = current?.actor ?? current?.combatant?.actor ?? null;
    if (actor instanceof Actor) {
      return actor;
    }

    const combatantId = cleanText(current?.combatantId ?? current?.id);
    if (combatantId) {
      const combatant = combat?.combatants?.get?.(combatantId)
        ?? collectionValues(combat?.combatants).find((entry) => cleanText(entry?.id) === combatantId);
      if (combatant?.actor instanceof Actor) {
        return combatant.actor;
      }
    }

    const turn = Math.floor(toNumber(current?.turn ?? combat?.turn, -1));
    const combatants = collectionValues(combat?.combatants);
    const indexed = turn >= 0 ? combatants[turn] : null;
    return indexed?.actor instanceof Actor ? indexed.actor : null;
  }

  async #deleteSourceNextTurnMagistrateEffects(sourceActor, combat = null) {
    const sourceUuid = cleanText(sourceActor?.uuid);
    if (!sourceUuid) {
      return;
    }

    const actors = new Set();
    for (const combatant of collectionValues(combat?.combatants)) {
      if (combatant?.actor instanceof Actor) {
        actors.add(combatant.actor);
      }
    }
    for (const actor of collectionValues(game.actors)) {
      if (actor instanceof Actor) {
        actors.add(actor);
      }
    }

    for (const actor of actors) {
      for (const effect of collectionValues(actor?.effects)) {
        if (
          effectFlag(effect, "paladinAutomation.kind") !== "magistrateEffect"
          || effectFlag(effect, "paladinAutomation.duration") !== "sourceNextTurn"
          || cleanText(effectFlag(effect, "paladinAutomation.sourceActorUuid")) !== sourceUuid
          || typeof effect?.delete !== "function"
        ) {
          continue;
        }

        await effect.delete();
      }
    }
  }

  #magistrateSocketSlotLooksSpent(actor, slotLevel) {
    const safeSlotLevel = Math.floor(toNumber(slotLevel, 0));
    if (safeSlotLevel < 1 || safeSlotLevel > 9) {
      return false;
    }

    const slot = actor?.system?.spells?.[`spell${safeSlotLevel}`];
    const max = Math.floor(toNumber(slot?.max, 0));
    const value = Math.floor(toNumber(slot?.value, max));
    return max > 0 && value < max;
  }

  #magistrateSocketWorkflowMatches(payload = {}, actor, target) {
    const workflowId = cleanText(payload.workflowId);
    if (!workflowId) {
      return false;
    }

    const workflow = this._options.resolveMidiWorkflow?.(workflowId)
      ?? globalThis.MidiQOL?.Workflow?.getWorkflow?.(workflowId)
      ?? globalThis.MidiQOL?.Workflow?.workflows?.get?.(workflowId)
      ?? null;
    if (!workflow) {
      return false;
    }

    const workflowActor = workflow.actor ?? workflow.activity?.actor ?? workflow.item?.actor ?? null;
    const actorMatches = workflowActor === actor
      || cleanText(workflowActor?.uuid) === cleanText(actor?.uuid)
      || cleanText(workflowActor?.id) === cleanText(actor?.id);
    if (!actorMatches) {
      return false;
    }

    const itemUuid = cleanText(payload.workflowItemUuid);
    const workflowItemUuid = cleanText(workflow.item?.uuid ?? workflow.activity?.item?.uuid);
    if (itemUuid && workflowItemUuid && itemUuid !== workflowItemUuid) {
      return false;
    }

    return targetActorsFromWorkflow(workflow).some((candidate) => (
      candidate === target
      || cleanText(candidate?.uuid) === cleanText(target?.uuid)
      || cleanText(candidate?.id) === cleanText(target?.id)
    ));
  }

  async #promptInitialPreparedSpells(actor, { spellcastingFeature = null } = {}) {
    if (!isActorDocument(actor) || !this.#canPrompt(actor)) {
      return true;
    }

    if (actorFlag(actor, INITIAL_PREPARED_SPELLS_FLAG) === true) {
      return true;
    }

    const hasSpellcasting = isPaladinSpellcastingFeature(spellcastingFeature)
      || hasActorFeature(actor, PALADIN_SPELLCASTING_FEATURE_ID);
    if (!hasSpellcasting) {
      return true;
    }

    const paladinLevel = paladinClassLevel(actor);
    const maxSpellLevel = paladinMaxSpellLevel(paladinLevel);
    if (paladinLevel < 2 || maxSpellLevel <= 0) {
      return true;
    }

    const actorKey = actorAutomationKey(actor, "initial-prepared-spells");
    if (this._initialPreparedSpellActors.has(actorKey)) {
      return true;
    }

    this._initialPreparedSpellActors.add(actorKey);
    try {
      if (collectionValues(actor.items).some((item) => isPaladinPreparedSpellItem(item))) {
        await this.#markInitialPreparedSpellsSelected(actor);
        return true;
      }

      const details = {
        paladinLevel,
        preparedCount: paladinInitialPreparedSpellCount(actor),
        maxSpellLevel,
        initialSelection: true
      };
      const selectedUuids = await this.#selectPreparedSpellUuids(actor, details);
      if (!selectedUuids) {
        return true;
      }

      await this.#applyPreparedSpellSelection(actor, selectedUuids);
      await this.#markInitialPreparedSpellsSelected(actor);
      return true;
    }
    finally {
      this._initialPreparedSpellActors.delete(actorKey);
    }
  }

  async #markInitialPreparedSpellsSelected(actor) {
    if (actorFlag(actor, INITIAL_PREPARED_SPELLS_FLAG) === true) {
      return actor;
    }

    return setActorFlag(actor, INITIAL_PREPARED_SPELLS_FLAG, true);
  }

  #findDivineSmite(actor) {
    return findActorFeature(actor, DIVINE_SMITE_FEATURE_ID, "божественная кара");
  }

  #divineSmiteVariants(actor) {
    const variants = [];
    const seen = new Set();
    for (const item of collectionValues(actor?.items)) {
      const rawId = rawFeatureId(itemFeatureId(item));
      const variant = DIVINE_SMITE_VARIANT_BY_ID.get(rawId)
        ?? DIVINE_SMITE_VARIANTS.find((entry) => normalizeText(entry.name) === normalizeText(item?.name))
        ?? null;
      if (!variant || seen.has(variant.id)) {
        continue;
      }

      seen.add(variant.id);
      variants.push({
        ...variant,
        itemUuid: cleanText(item?.uuid),
        description: cleanText(item?.system?.description?.value ?? item?.system?.description?.chat)
      });
    }
    return variants;
  }

  #canIgnoreDivineSmiteTurnLimit(actor) {
    for (const effect of collectionValues(actor?.effects)) {
      if (!effectIsEnabled(effect)) {
        continue;
      }

      const ignoreTurnLimit = effectFlag(effect, "paladinAutomation.divineSmiteIgnoreTurnLimit");
      const ignoreTurnLimitText = cleanText(ignoreTurnLimit).toLowerCase();
      if (ignoreTurnLimit === true || ignoreTurnLimitText === "true" || toNumber(ignoreTurnLimit, 0) === 1) {
        return true;
      }

      if (normalizeText(effect?.name) === "святой нимб") {
        return true;
      }
    }

    return false;
  }

  #canUseMultipleSmiteVariants(actor) {
    for (const effect of collectionValues(actor?.effects)) {
      if (!effectIsEnabled(effect)) {
        continue;
      }

      if (toNumber(effectFlag(effect, "paladinAutomation.divineSmiteVariantLimit"), 0) >= 2) {
        return true;
      }

      if (normalizeText(effect?.name) === "мстящий ангел") {
        return true;
      }
    }

    return false;
  }

  #validatedSmiteVariantIds(choice, variants, slotLevel) {
    const allowed = new Map(variants.map((variant) => [variant.id, variant]));
    const maximum = this.#canUseMultipleSmiteVariants(choice?.actor) ? 2 : 1;
    return selectedVariantIdsFromChoice(choice)
      .filter((id) => {
        const variant = allowed.get(id);
        return variant && Math.floor(toNumber(variant.minSlotLevel, 1)) <= slotLevel;
      })
      .slice(0, maximum);
  }

  #chosenSmiteTarget(targets, choice) {
    const targetUuid = cleanText(choice?.targetUuid);
    if (!targetUuid) {
      return targets[0] ?? null;
    }

    return targets.find((target) => cleanText(target?.uuid ?? target?.id) === targetUuid) ?? null;
  }

  #divineSmiteLabel(slotLevel, selectedVariants) {
    const variantNames = selectedVariants.map((variant) => variant.name).filter(Boolean);
    const suffix = variantNames.length ? `: ${variantNames.join(", ")}` : "";
    return `Божественная кара (${slotLevel} ур.)${suffix}`;
  }

  async #applyMagistrateSmiteVariants(sourceActor, target, selectedVariants, context = {}) {
    const magistrateVariants = selectedVariants
      .map((variant) => ({
        variant,
        automation: MAGISTRATE_SMITE_BY_ID.get(variant.id)
      }))
      .filter((entry) => entry.automation);
    if (!magistrateVariants.length) {
      return true;
    }

    if (!this.#canUpdate(target)) {
      return this.#emitMagistrateSmiteAsGM(sourceActor, target, magistrateVariants.map((entry) => entry.variant), context);
    }

    for (const { variant, automation } of magistrateVariants) {
      if (!automation) {
        continue;
      }

      const save = await this.#resolvePaladinSave(target, {
        sourceActor,
        ability: automation.saveAbility,
        disadvantage: this.#canUseInevitableSentence(sourceActor, target),
        flavor: variant.name
      });
      const effectIds = save.success === true
        ? automation.successEffects ?? []
        : automation.failedEffects ?? [];
      for (const effect of effectIds) {
        await this.#applyMagistrateEffect(target, {
          sourceActor,
          variant,
          automation,
          effect,
          save
        });
      }
    }
  }

  async #resolvePaladinSave(target, { sourceActor, ability, disadvantage = false, flavor = "" } = {}) {
    const dc = this.#paladinSaveDc(sourceActor);
    if (typeof this._options.rollPaladinSave === "function") {
      const result = await this._options.rollPaladinSave(target, {
        sourceActor,
        ability,
        dc,
        disadvantage,
        flavor
      });
      const total = Math.floor(toNumber(result?.total, 0));
      const resultDc = Math.floor(toNumber(result?.dc, dc));
      return {
        success: typeof result?.success === "boolean" ? result.success : total >= resultDc,
        total,
        dc: resultDc
      };
    }

    if (typeof target?.rollAbilitySave !== "function") {
      return { success: true, total: 0, dc };
    }

    const result = await target.rollAbilitySave(ability, {
      dc,
      disadvantage,
      flavor,
      chatMessage: true,
      fastForward: true
    });
    const total = Math.floor(toNumber(result?.total, 0));
    return { success: total >= dc, total, dc };
  }

  #paladinSaveDc(actor) {
    const explicitDc = Math.floor(toNumber(
      actor?.system?.attributes?.spelldc
        ?? actor?.system?.attributes?.spell?.dc
        ?? actor?.system?.attributes?.spellcasting?.dc,
      0
    ));
    if (explicitDc > 0) {
      return explicitDc;
    }

    const proficiency = Math.floor(toNumber(
      actor?.system?.attributes?.prof
        ?? actor?.getRollData?.()?.prof,
      0
    ));
    const level = paladinClassLevel(actor);
    const fallbackProficiency = level > 0 ? 2 + Math.floor((level - 1) / 4) : 2;
    const charisma = Math.floor(toNumber(actor?.system?.abilities?.cha?.mod, 0));
    return 8 + (proficiency > 0 ? proficiency : fallbackProficiency) + charisma;
  }

  async #applyMagistrateEffect(target, { sourceActor, variant, automation, effect, save }) {
    const data = this.#magistrateEffectData(target, {
      sourceActor,
      variant,
      automation,
      effect,
      save
    });
    if (!data) {
      return false;
    }

    if (this.#canUpdate(target) && typeof target.createEmbeddedDocuments === "function") {
      await target.createEmbeddedDocuments("ActiveEffect", [data]);
      return true;
    }

    return false;
  }

  #magistrateEffectData(target, { sourceActor, variant, automation, effect, save }) {
    const name = MAGISTRATE_EFFECT_LABELS[effect] ?? cleanText(variant?.name, "Кара магистрата");
    const changes = effect === "detentionSlow"
      ? MOVEMENT_KEYS.map((movement) => ({
        key: `system.attributes.movement.${movement}`,
        mode: activeEffectAddMode(),
        value: "-10",
        priority: 20
      }))
      : [];

    return {
      name,
      type: "base",
      img: MAGISTRATE_EFFECT_ICONS[effect] ?? "icons/svg/aura.svg",
      system: {},
      changes,
      disabled: false,
      origin: cleanText(sourceActor?.uuid) || null,
      transfer: false,
      duration: {
        startTime: globalThis.game?.time?.worldTime ?? null,
        seconds: null,
        rounds: null,
        turns: null,
        startRound: globalThis.game?.combat?.round ?? null,
        startTurn: globalThis.game?.combat?.turn ?? null,
        combat: globalThis.game?.combat?.id ?? null
      },
      description: `<p>${escapeHtml(target?.name)} под действием варианта ${escapeHtml(variant?.name)}.</p>`,
      flags: {
        dae: {
          specialDuration: ["turnStartSource", "combatEnd"]
        },
        [MODULE_ID]: {
          paladinAutomation: {
            kind: "magistrateEffect",
            effect,
            variant: automation.variant,
            variantId: variant.id,
            sourceActorUuid: cleanText(sourceActor?.uuid),
            sourceActorId: cleanText(sourceActor?.id),
            targetActorUuid: cleanText(target?.uuid),
            saveAbility: automation.saveAbility,
            saveTotal: Math.floor(toNumber(save?.total, 0)),
            saveDc: Math.floor(toNumber(save?.dc, 0)),
            duration: "sourceNextTurn"
          }
        }
      }
    };
  }

  async #emitMagistrateSmiteAsGM(sourceActor, target, variants, context = {}) {
    if (typeof game.socket?.emit !== "function") {
      globalThis.ui?.notifications?.warn("Кара магистрата: нет доступа к GM socket, эффект не применён.");
      return false;
    }

    const workflowId = cleanText(context.workflow?.id);
    if (!workflowId) {
      globalThis.ui?.notifications?.warn("Кара магистрата: не найден workflow атаки, эффект через GM socket не применён.");
      return false;
    }

    game.socket.emit(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION,
      payload: {
        action: "paladin.magistrateSmite",
        sourceActorUuid: cleanText(sourceActor?.uuid),
        targetActorUuid: cleanText(target?.uuid),
        slotLevel: Math.max(1, Math.floor(toNumber(context.slotLevel, 1))),
        variantIds: variants.map((variant) => cleanText(variant.id)).filter(Boolean),
        workflowId,
        workflowItemUuid: cleanText(context.workflow?.item?.uuid ?? context.workflow?.activity?.item?.uuid)
      },
      senderId: game.user?.id ?? ""
    });
    return true;
  }

  async #promptDivineSmite(actor, details) {
    if (typeof this._options.promptDivineSmite === "function") {
      const choice = await this._options.promptDivineSmite(actor, details);
      return choice ? { ...choice, actor } : null;
    }

    if (!this.#canPrompt(actor)) {
      return null;
    }

    const slotOptions = details.slots.map((slot) => (
      `<option value="${escapeHtml(slot.level)}">${escapeHtml(slot.level)} ур. (${escapeHtml(slot.value)} / ${escapeHtml(slot.max)})</option>`
    )).join("");
    const targetOptions = details.targets.map((target) => (
      `<option value="${escapeHtml(target.uuid)}">${escapeHtml(target.name)}</option>`
    )).join("");
    const variantInputs = details.variants.length
      ? details.variants.map((variant) => `
        <label class="checkbox">
          <input type="checkbox" value="${escapeHtml(variant.id)}" data-smite-variant>
          ${escapeHtml(variant.name)}${variant.minSlotLevel > 1 ? ` (${escapeHtml(variant.minSlotLevel)}+ ур.)` : ""}
        </label>
      `).join("")
      : "<p>Нет дополнительных вариантов кары.</p>";

    const content = `
      <form>
        <p>Попадание оружием. Потратить ячейку заклинаний на Божественную кару?</p>
        <div class="form-group">
          <label>Ячейка</label>
          <select name="slotLevel" data-smite-slot>${slotOptions}</select>
        </div>
        ${details.targets.length > 1 ? `
          <div class="form-group">
            <label>Цель</label>
            <select name="targetUuid" data-smite-target>${targetOptions}</select>
          </div>
        ` : ""}
        <fieldset>
          <legend>Вариант кары</legend>
          ${variantInputs}
        </fieldset>
      </form>
    `;

    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof DialogV2?.input !== "function") {
      return null;
    }

    const choice = await DialogV2.input({
      window: { title: "Божественная кара" },
      content,
      ok: {
        label: "Кара",
        callback: (_event, button) => {
          const root = getDialogButtonForm(button);
          const slotLevel = Number(root?.querySelector?.("[data-smite-slot]")?.value ?? 0);
          const targetUuid = cleanText(root?.querySelector?.("[data-smite-target]")?.value);
          const variantIds = Array.from(root?.querySelectorAll?.("[data-smite-variant]:checked") ?? [])
            .map((input) => cleanText(input.value))
            .filter(Boolean);
          return { slotLevel, targetUuid, variantIds, actor };
        }
      },
      rejectClose: false,
      modal: true
    });
    return choice ? { ...choice, actor } : null;
  }

  async #useLayOnHands(actor, item) {
    const layOnHands = item ?? this.#findLayOnHands(actor);
    if (!layOnHands) {
      globalThis.ui?.notifications?.warn("Наложение рук: предмет не найден у актёра.");
      return false;
    }

    const target = this.#selectedTargetActor();
    if (!target) {
      return false;
    }

    const targetCurrentHp = actorHpValue(target);
    const targetMaxHp = actorHpMax(target);
    const missingHp = Math.max(0, targetMaxHp - targetCurrentHp);
    if (missingHp <= 0) {
      globalThis.ui?.notifications?.warn("Наложение рук: выбранная цель уже полностью здорова.");
      return false;
    }

    const uses = layOnHands.system?.uses ?? {};
    const maxUses = this.#layOnHandsMaxUses(actor, layOnHands);
    const spent = Math.max(0, Math.floor(toNumber(uses.spent, 0)));
    const remaining = Math.max(0, maxUses - spent);
    if (remaining <= 0) {
      globalThis.ui?.notifications?.warn("Наложение рук: запас целительной силы исчерпан.");
      return false;
    }

    const maxSpend = Math.min(remaining, missingHp);
    const amount = await this.#promptLayOnHandsPoints(actor, layOnHands, {
      remaining,
      max: maxSpend
    });
    if (!amount) {
      return false;
    }

    const healing = clampInteger(amount, 1, maxSpend);
    if (!this.#canUpdate(target) || !this.#canUpdate(layOnHands)) {
      return this.#emitLayOnHandsAsGM(actor, layOnHands, target, healing);
    }

    return this.#applyLayOnHandsHealing(actor, layOnHands, target, healing, spent);
  }

  async #useSovereignJurisdiction(actor, item) {
    const jurisdiction = item ?? findActorFeature(actor, "magistrate-sovereign-jurisdiction");
    if (!jurisdiction) {
      globalThis.ui?.notifications?.warn("Державная юрисдикция: предмет умения не найден.");
      return false;
    }

    const targetEntry = this.#selectedTargetEntry("Державная юрисдикция");
    if (!targetEntry) {
      return false;
    }

    if (!this.#canUpdate(targetEntry.actor) || typeof targetEntry.actor?.createEmbeddedDocuments !== "function") {
      return this.#emitSovereignJurisdictionAsGM(actor, jurisdiction, targetEntry);
    }

    return this.#applySovereignJurisdiction(actor, jurisdiction, targetEntry);
  }

  async #applySovereignJurisdiction(actor, jurisdiction, targetEntry) {
    const target = targetEntry?.actor;
    if (!(target instanceof Actor)) {
      return false;
    }
    if (target === actor || cleanText(target?.uuid) === cleanText(actor?.uuid)) {
      globalThis.ui?.notifications?.warn("Державная юрисдикция: выберите существо, отличное от себя.");
      return false;
    }
    if (!this.#canUpdate(target) || typeof target.createEmbeddedDocuments !== "function") {
      globalThis.ui?.notifications?.warn("Державная юрисдикция: цель нельзя обновить с этого клиента.");
      return false;
    }

    await this.#deleteSovereignJurisdictionEffects(actor, [target]);
    const effect = this.#jurisdictionEffectForTarget(targetEntry);
    if (effect === "protectedByLaw") {
      await this.#applyJurisdictionTemporaryHp(actor, target);
    }

    return this.#applyJurisdictionEffect(target, {
      sourceActor: actor,
      item: jurisdiction,
      effect
    });
  }

  async #emitSovereignJurisdictionAsGM(actor, jurisdiction, targetEntry) {
    if (typeof game.socket?.emit !== "function") {
      globalThis.ui?.notifications?.warn("Державная юрисдикция: нет доступа к GM socket, статус не применён.");
      return false;
    }

    const target = targetEntry?.actor;
    const tokenUuid = cleanText(targetEntry?.token?.uuid);
    if (!(target instanceof Actor) || !tokenUuid) {
      globalThis.ui?.notifications?.warn("Державная юрисдикция: не найден токен цели для GM socket.");
      return false;
    }

    game.socket.emit(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION,
      payload: {
        action: "paladin.sovereignJurisdiction",
        sourceActorUuid: cleanText(actor?.uuid),
        sourceItemId: cleanText(jurisdiction?.id),
        sourceItemUuid: cleanText(jurisdiction?.uuid),
        targetActorUuid: cleanText(target?.uuid),
        targetTokenUuid: tokenUuid
      },
      senderId: game.user?.id ?? ""
    });
    return true;
  }

  async #applyJurisdictionTemporaryHp(sourceActor, target) {
    if (typeof target?.update !== "function") {
      return false;
    }

    const charisma = Math.max(0, Math.floor(toNumber(sourceActor?.system?.abilities?.cha?.mod, 0)));
    if (charisma <= 0) {
      return false;
    }

    const currentTemp = Math.max(0, Math.floor(toNumber(target?.system?.attributes?.hp?.temp, 0)));
    const nextTemp = Math.max(currentTemp, charisma);
    if (nextTemp === currentTemp) {
      return true;
    }

    await target.update({ "system.attributes.hp.temp": nextTemp });
    return true;
  }

  async #deleteSovereignJurisdictionEffects(sourceActor, seedActors = []) {
    const sourceUuid = cleanText(sourceActor?.uuid);
    if (!sourceUuid) {
      return;
    }

    const actors = new Set();
    for (const actor of collectionValues(seedActors)) {
      if (actor instanceof Actor) {
        actors.add(actor);
      }
    }
    for (const actor of collectionValues(game.actors)) {
      if (actor instanceof Actor) {
        actors.add(actor);
      }
    }
    for (const actor of this.#activeSceneTokenActors()) {
      actors.add(actor);
    }

    for (const actor of actors) {
      for (const effect of collectionValues(actor?.effects)) {
        if (
          effectFlag(effect, "paladinAutomation.kind") !== "magistrateEffect"
          || !JURISDICTION_EFFECT_IDS.has(effectFlag(effect, "paladinAutomation.effect"))
          || cleanText(effectFlag(effect, "paladinAutomation.sourceActorUuid")) !== sourceUuid
          || typeof effect?.delete !== "function"
        ) {
          continue;
        }

        await effect.delete();
      }
    }
  }

  #activeSceneTokenActors() {
    const actors = new Set();
    const scenes = new Set();
    if (game.scenes?.active) {
      scenes.add(game.scenes.active);
    }
    if (globalThis.canvas?.scene) {
      scenes.add(globalThis.canvas.scene);
    }
    for (const scene of collectionValues(game.scenes)) {
      scenes.add(scene);
    }

    for (const scene of scenes) {
      for (const token of collectionValues(scene?.tokens)) {
        const actor = token?.actor ?? token?.document?.actor ?? token?.object?.actor ?? null;
        if (actor instanceof Actor) {
          actors.add(actor);
        }
      }
    }
    for (const token of collectionValues(globalThis.canvas?.tokens?.placeables)) {
      const actor = token?.actor ?? token?.document?.actor ?? null;
      if (actor instanceof Actor) {
        actors.add(actor);
      }
    }

    return actors;
  }

  #jurisdictionEffectForTarget(targetEntry) {
    const disposition = Math.floor(toNumber(targetEntry?.token?.disposition, 0));
    if (disposition < 0) {
      return "supervisedByLaw";
    }
    if (disposition > 0) {
      return "protectedByLaw";
    }
    return "lawOrphan";
  }

  async #applyJurisdictionEffect(target, { sourceActor, item, effect }) {
    const data = this.#jurisdictionEffectData(target, {
      sourceActor,
      item,
      effect
    });
    if (!data) {
      return false;
    }

    await target.createEmbeddedDocuments("ActiveEffect", [data]);
    return true;
  }

  #jurisdictionEffectData(target, { sourceActor, item, effect }) {
    if (!JURISDICTION_EFFECT_IDS.has(effect)) {
      return null;
    }

    return {
      name: JURISDICTION_EFFECT_LABELS[effect] ?? cleanText(item?.name, "Державная юрисдикция"),
      type: "base",
      img: JURISDICTION_EFFECT_ICONS[effect] ?? "icons/svg/aura.svg",
      system: {},
      changes: this.#jurisdictionEffectChanges(effect),
      disabled: false,
      origin: cleanText(sourceActor?.uuid) || null,
      transfer: false,
      duration: {
        startTime: globalThis.game?.time?.worldTime ?? null,
        seconds: 60,
        rounds: 10,
        turns: null,
        startRound: globalThis.game?.combat?.round ?? null,
        startTurn: globalThis.game?.combat?.turn ?? null,
        combat: globalThis.game?.combat?.id ?? null
      },
      description: `<p>${escapeHtml(target?.name)} находится под действием ${escapeHtml(cleanText(item?.name, "Державная юрисдикция"))}.</p>`,
      flags: {
        dae: {
          specialDuration: ["combatEnd"]
        },
        [MODULE_ID]: {
          paladinAutomation: {
            kind: "magistrateEffect",
            effect,
            sourceActorUuid: cleanText(sourceActor?.uuid),
            sourceActorId: cleanText(sourceActor?.id),
            sourceItemUuid: cleanText(item?.uuid),
            targetActorUuid: cleanText(target?.uuid),
            duration: "oneMinute"
          }
        }
      }
    };
  }

  #jurisdictionEffectChanges(effect) {
    if (effect !== "supervisedByLaw") {
      return [];
    }

    return [
      {
        key: "system.attributes.ac.bonus",
        mode: activeEffectAddMode(),
        value: "-2",
        priority: 20
      },
      {
        key: "system.abilities.dex.bonuses.save",
        mode: activeEffectAddMode(),
        value: "-2",
        priority: 20
      }
    ];
  }

  async #handleSovereignJurisdictionSocketRequest(payload = {}, { sender = null } = {}) {
    const actor = await resolveUuid(payload.sourceActorUuid);
    const target = await resolveUuid(payload.targetActorUuid);
    if (!(actor instanceof Actor) || !(target instanceof Actor) || !userOwnsActor(actor, sender)) {
      return false;
    }

    const jurisdiction = actorItemByIdOrUuid(actor, payload.sourceItemId, payload.sourceItemUuid)
      ?? await resolveUuid(payload.sourceItemUuid);
    if (!isSovereignJurisdictionFeature(jurisdiction) || !itemBelongsToActor(jurisdiction, actor)) {
      return false;
    }

    const token = await resolveUuid(payload.targetTokenUuid);
    if (!this.#tokenMatchesActor(token, target)) {
      return false;
    }

    return this.#applySovereignJurisdiction(actor, jurisdiction, {
      actor: target,
      token
    });
  }

  #tokenMatchesActor(token, actor) {
    const tokenActor = token?.actor ?? token?.document?.actor ?? token?.object?.actor ?? null;
    return tokenActor instanceof Actor
      && (
        tokenActor === actor
        || cleanText(tokenActor.uuid) === cleanText(actor?.uuid)
        || cleanText(tokenActor.id) === cleanText(actor?.id)
      );
  }

  async #handleLayOnHandsSocketRequest(payload = {}, { sender = null } = {}) {
    const actor = await resolveUuid(payload.sourceActorUuid);
    const target = await resolveUuid(payload.targetActorUuid);
    if (!(actor instanceof Actor) || !(target instanceof Actor) || !userOwnsActor(actor, sender)) {
      return false;
    }

    const layOnHands = actorItemByIdOrUuid(actor, payload.sourceItemId, payload.sourceItemUuid)
      ?? await resolveUuid(payload.sourceItemUuid);
    if (!isLayOnHandsFeature(layOnHands) || !itemBelongsToActor(layOnHands, actor)) {
      return false;
    }

    const targetCurrentHp = actorHpValue(target);
    const targetMaxHp = actorHpMax(target);
    const missingHp = Math.max(0, targetMaxHp - targetCurrentHp);
    const uses = layOnHands.system?.uses ?? {};
    const maxUses = this.#layOnHandsMaxUses(actor, layOnHands);
    const spent = Math.max(0, Math.floor(toNumber(uses.spent, 0)));
    const remaining = Math.max(0, maxUses - spent);
    const healing = Math.min(
      Math.max(0, Math.floor(toNumber(payload.amount, 0))),
      missingHp,
      remaining
    );
    if (healing <= 0) {
      return false;
    }

    return this.#applyLayOnHandsHealing(actor, layOnHands, target, healing, spent);
  }

  async #handleMagistrateSmiteSocketRequest(payload = {}, { sender = null } = {}) {
    const actor = await resolveUuid(payload.sourceActorUuid);
    const target = await resolveUuid(payload.targetActorUuid);
    if (!(actor instanceof Actor) || !(target instanceof Actor) || !userOwnsActor(actor, sender)) {
      return false;
    }

    if (!this.#findDivineSmite(actor)) {
      return false;
    }

    const slotLevel = Math.floor(toNumber(payload.slotLevel, 0));
    if (!this.#magistrateSocketSlotLooksSpent(actor, slotLevel)) {
      return false;
    }

    if (!this.#magistrateSocketWorkflowMatches(payload, actor, target)) {
      return false;
    }

    const allowedVariants = new Map(this.#divineSmiteVariants(actor)
      .filter((variant) => (
        MAGISTRATE_SMITE_BY_ID.has(variant.id)
        && Math.floor(toNumber(variant.minSlotLevel, 1)) <= slotLevel
      ))
      .map((variant) => [variant.id, variant]));
    const variants = unique((Array.isArray(payload.variantIds) ? payload.variantIds : [])
      .map((id) => cleanText(id)))
      .map((id) => allowedVariants.get(id))
      .filter(Boolean);
    if (!variants.length) {
      return false;
    }

    return this.#applyMagistrateSmiteVariants(actor, target, variants, { slotLevel });
  }

  async #applyLayOnHandsHealing(actor, layOnHands, target, healing, spent) {
    const targetCurrentHp = actorHpValue(target);
    const targetMaxHp = actorHpMax(target);
    const nextHp = Math.min(targetMaxHp, targetCurrentHp + Math.max(0, Math.floor(toNumber(healing, 0))));
    const appliedHealing = Math.max(0, nextHp - targetCurrentHp);
    if (appliedHealing <= 0) {
      return false;
    }

    await target.update?.({ "system.attributes.hp.value": nextHp });
    await layOnHands.update?.({ "system.uses.spent": spent + appliedHealing });
    await globalThis.ChatMessage?.create?.({
      speaker: speakerForActor(actor),
      flavor: `Наложение рук: ${appliedHealing} хитов для ${target.name ?? "цели"}.`
    });
    return true;
  }

  async #emitLayOnHandsAsGM(actor, layOnHands, target, healing) {
    if (typeof game.socket?.emit !== "function") {
      globalThis.ui?.notifications?.warn("Наложение рук: нет доступа к GM socket, исцеление не применено.");
      return false;
    }

    game.socket.emit(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION,
      payload: {
        action: "paladin.layOnHands",
        sourceActorUuid: cleanText(actor?.uuid),
        sourceItemId: cleanText(layOnHands?.id),
        sourceItemUuid: cleanText(layOnHands?.uuid),
        targetActorUuid: cleanText(target?.uuid),
        amount: Math.max(0, Math.floor(toNumber(healing, 0)))
      },
      senderId: game.user?.id ?? ""
    });
    return true;
  }

  #findLayOnHands(actor) {
    return collectionValues(actor?.items).find((item) => {
      if (item?.type !== "feat") {
        return false;
      }

      const featureId = cleanText(itemFlag(item, MODULE_ID, "featureId"));
      return featureId.endsWith("::paladin-lay-on-hands")
        || normalizeText(item?.name) === "наложение рук";
    }) ?? null;
  }

  #layOnHandsMaxUses(actor, item) {
    const rawMax = item?.system?.uses?.max;
    const numericMax = Math.floor(toNumber(rawMax, 0));
    if (numericMax > 0) {
      return numericMax;
    }

    return Math.max(0, paladinClassLevel(actor) * 5);
  }

  #selectedTargetEntry(label = "Цель") {
    const targets = Array.from(game.user?.targets ?? []);
    const entries = targets
      .map((target) => ({
        actor: target?.actor ?? target?.document?.actor ?? target?.object?.actor ?? target?.token?.actor ?? null,
        token: target?.document ?? target?.object?.document ?? target?.token?.document ?? target
      }))
      .filter((entry) => entry.actor instanceof Actor);
    if (entries.length !== 1) {
      globalThis.ui?.notifications?.warn(`${label}: выберите ровно одну цель.`);
      return null;
    }

    return entries[0];
  }

  #selectedTargetActor() {
    return this.#selectedTargetEntry("Наложение рук")?.actor ?? null;
  }

  async #promptLayOnHandsPoints(actor, item, details) {
    if (typeof this._options.promptLayOnHandsPoints === "function") {
      return this._options.promptLayOnHandsPoints(actor, item, details);
    }

    if (!this.#canPrompt(actor) || typeof Dialog !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const dialog = new Dialog({
        title: "Наложение рук",
        content: `
          <form>
            <p>Осталось в запасе: ${escapeHtml(details.remaining)}. Можно потратить до ${escapeHtml(details.max)}.</p>
            <div class="form-group">
              <label>Сколько хитов восстановить?</label>
              <input type="number" min="1" max="${escapeHtml(details.max)}" value="${escapeHtml(details.max)}" data-lay-on-hands-points>
            </div>
          </form>
        `,
        buttons: {
          confirm: {
            label: "Вылечить",
            callback: (html) => {
              const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0];
              const rawValue = root?.querySelector("[data-lay-on-hands-points]")?.value;
              settled = true;
              resolve(clampInteger(rawValue, 1, details.max));
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
        close: () => {
          if (!settled) {
            resolve(null);
          }
        }
      });
      dialog.render(true);
    });
  }

  async #confirmPreparedSpellChange(actor, details, progress = null) {
    if (typeof this._options.confirmPreparedSpellChange === "function") {
      return this._options.confirmPreparedSpellChange(actor, details, {
        progress
      });
    }

    const progressHeader = progress?.header?.("Заклинания паладина") ?? "";
    const content = progressHeader + [
      `Вы завершили продолжительный отдых. Изменить подготовленные заклинания паладина?`,
      `Можно подготовить ${details.preparedCount} закл. до ${details.maxSpellLevel}-го уровня.`
    ].map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (typeof DialogV2?.confirm === "function") {
      return DialogV2.confirm({
        window: {
          title: progress?.title?.("Заклинания паладина")
            ?? "Заклинания паладина"
        },
        content
      });
    }

    if (typeof globalThis.Dialog?.confirm === "function") {
      return globalThis.Dialog.confirm({
        title: progress?.title?.("Заклинания паладина")
          ?? "Заклинания паладина",
        content,
        yes: () => true,
        no: () => false,
        defaultYes: false
      });
    }

    return false;
  }

  async #selectPreparedSpellUuids(actor, details, progress = null) {
    if (typeof this._options.selectPreparedSpellUuids === "function") {
      return this._options.selectPreparedSpellUuids(actor, details, {
        progress
      });
    }

    const CompendiumBrowser = globalThis.dnd5e?.applications?.CompendiumBrowser ?? null;
    if (typeof CompendiumBrowser?.select !== "function") {
      ui.notifications?.warn("Rebreya: библиотека заклинаний dnd5e недоступна, выбор заклинаний паладина не открыт.");
      return null;
    }

    const result = await CompendiumBrowser.select({
      tab: "spells",
      filters: {
        locked: {
          documentClass: "Item",
          types: new Set(["spell"]),
          additional: {
            level: {
              min: 0,
              max: details.maxSpellLevel
            },
            spelllist: {
              "class:paladin": 1
            }
          }
        }
      },
      selection: {
        min: 1,
        max: details.preparedCount
      }
    });
    return result ? Array.from(result) : null;
  }

  async #fromUuid(uuid) {
    if (typeof this._options.fromUuid === "function") {
      return this._options.fromUuid(uuid);
    }

    return globalThis.fromUuid?.(uuid) ?? null;
  }

  async #applyPreparedSpellSelection(actor, selectedUuids) {
    const selectedDocuments = (await Promise.all(
      Array.from(selectedUuids ?? []).map((uuid) => this.#fromUuid(uuid))
    )).filter((document) => document?.type === "spell");
    const selected = {
      uuids: new Set(selectedDocuments.map((spell) => cleanText(spell.uuid)).filter(Boolean)),
      identifiers: new Set(selectedDocuments.map((spell) => cleanText(spell.system?.identifier)).filter(Boolean)),
      names: new Set(selectedDocuments.map((spell) => normalizeText(spell.name)).filter(Boolean)),
      uuidByIdentifier: new Map(selectedDocuments
        .map((spell) => [cleanText(spell.system?.identifier), cleanText(spell.uuid)])
        .filter(([identifier, uuid]) => identifier && uuid)),
      uuidByName: new Map(selectedDocuments
        .map((spell) => [normalizeText(spell.name), cleanText(spell.uuid)])
        .filter(([name, uuid]) => name && uuid))
    };
    const matchedUuids = new Set();

    for (const item of collectionValues(actor?.items)) {
      if (item?.type !== "spell") {
        continue;
      }

      const shouldPrepare = actorSpellMatchesSelection(item, selected);
      if (shouldPrepare) {
        const matchedUuid = selectedUuidForActorSpell(item, selected);
        if (matchedUuid) {
          matchedUuids.add(matchedUuid);
        }
        const patch = {};
        if (cleanText(item?.system?.sourceClass) !== PALADIN_CLASS_IDENTIFIER) {
          patch["system.sourceClass"] = PALADIN_CLASS_IDENTIFIER;
        }
        if (cleanText(item?.system?.method, "spell") !== "spell") {
          patch["system.method"] = "spell";
        }
        if (toNumber(item?.system?.prepared, 0) !== 1) {
          patch["system.prepared"] = 1;
        }
        if (itemFlag(item, MODULE_ID, "paladinPreparedSpell") !== true) {
          patch[`flags.${MODULE_ID}.paladinPreparedSpell`] = true;
        }
        if (Object.keys(patch).length && typeof item.update === "function") {
          await item.update(patch);
        }
        continue;
      }

      if (isPaladinPreparedSpellItem(item) && toNumber(item?.system?.prepared, 0) !== 0 && typeof item.update === "function") {
        await item.update({ "system.prepared": 0 });
      }
    }

    const itemData = selectedDocuments
      .filter((spell) => !matchedUuids.has(cleanText(spell.uuid)))
      .map((spell) => createSpellData(spell));
    if (itemData.length && typeof actor?.createEmbeddedDocuments === "function") {
      await actor.createEmbeddedDocuments("Item", itemData);
    }
  }
}
