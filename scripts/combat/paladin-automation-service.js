import { MODULE_ID } from "../constants.js";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION = "character-class-automation";
const PALADIN_CLASS_IDENTIFIER = "paladin-rework-v01";
const PALADIN_SPELLCASTING_FEATURE_ID = "paladin-spellcasting";
const PALADIN_LAY_ON_HANDS_FEATURE_ID = "paladin-lay-on-hands";
const DIVINE_SMITE_FEATURE_ID = "paladin-divine-smite";
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
    this._initialPreparedSpellActors = new Set();
    this._options = options;
  }

  async initialize() {
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

    const slots = availableSpellSlots(actor);
    if (!slots.length) {
      return true;
    }
    const variants = allVariants.filter((variant) => (
      slots.some((slot) => slot.level >= Math.floor(toNumber(variant.minSlotLevel, 1)))
    ));

    const turnKey = combatTurnKey(actor, workflow);
    const ignoresTurnLimit = this.#canIgnoreDivineSmiteTurnLimit(actor);
    if (turnKey && !ignoresTurnLimit && this._smiteTurnUses.has(turnKey)) {
      return true;
    }

    const details = {
      slots,
      variants,
      targets: targets.map((target) => ({
        uuid: cleanText(target.uuid ?? target.id),
        name: cleanText(target.name, "Цель")
      })),
      oncePerTurn: !ignoresTurnLimit,
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
    if (turnKey && !ignoresTurnLimit) {
      this._smiteTurnUses.add(turnKey);
    }

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

    return true;
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!isActorDocument(actor) || !isLongRest(result, config)) {
      return true;
    }

    const paladinLevel = paladinClassLevel(actor);
    const maxSpellLevel = paladinMaxSpellLevel(paladinLevel);
    if (maxSpellLevel <= 0 || !this.#canPrompt(actor)) {
      return true;
    }

    const details = {
      paladinLevel,
      preparedCount: paladinPreparedSpellCount(actor, paladinLevel),
      maxSpellLevel
    };
    const confirmed = await this.#confirmPreparedSpellChange(actor, details);
    if (!confirmed) {
      return true;
    }

    const selectedUuids = await this.#selectPreparedSpellUuids(actor, details);
    if (!selectedUuids) {
      return true;
    }

    await this.#applyPreparedSpellSelection(actor, selectedUuids);
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

    return false;
  }

  #canPrompt(actor) {
    return Boolean(game.user?.isGM || actor?.isOwner);
  }

  #canUpdate(document) {
    return Boolean(game.user?.isGM || document?.isOwner || document?.actor?.isOwner || document?.parent?.isOwner);
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

  #selectedTargetActor() {
    const targets = Array.from(game.user?.targets ?? []);
    const targetActors = targets
      .map((target) => target?.actor ?? target?.document?.actor ?? null)
      .filter((actor) => actor instanceof Actor);
    if (targetActors.length !== 1) {
      globalThis.ui?.notifications?.warn("Наложение рук: выберите ровно одну цель.");
      return null;
    }

    return targetActors[0];
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

  async #confirmPreparedSpellChange(actor, details) {
    if (typeof this._options.confirmPreparedSpellChange === "function") {
      return this._options.confirmPreparedSpellChange(actor, details);
    }

    const content = [
      `Вы завершили продолжительный отдых. Изменить подготовленные заклинания паладина?`,
      `Можно подготовить ${details.preparedCount} закл. до ${details.maxSpellLevel}-го уровня.`
    ].map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (typeof DialogV2?.confirm === "function") {
      return DialogV2.confirm({
        window: { title: "Заклинания паладина" },
        content
      });
    }

    if (typeof globalThis.Dialog?.confirm === "function") {
      return globalThis.Dialog.confirm({
        title: "Заклинания паладина",
        content,
        yes: () => true,
        no: () => false,
        defaultYes: false
      });
    }

    return false;
  }

  async #selectPreparedSpellUuids(actor, details) {
    if (typeof this._options.selectPreparedSpellUuids === "function") {
      return this._options.selectPreparedSpellUuids(actor, details);
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
