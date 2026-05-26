import { CLASS_FEATURES_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { getFighterManeuverAutomation } from "../data/fighter-automation.js";

const EFFECT_MODE_OVERRIDE = 5;
const LAST_ATTACK_MAX_AGE_MS = 120000;
const BLOODIED_STATUS_IDS = new Set(["bloodied", "rebreya-bloodied"]);
const FIGHTER_CLASS_IDENTIFIER = "fighter-rework-v028";
const FIGHTER_DOMINANCE_FEATURE_ID = "fighter-dominance";
const FIGHTER_STARTING_EQUIPMENT_PROMPT_FLAG = "startingEquipmentPrompted";
const SECOND_WIND_USES_RECOVERY = Object.freeze([{
  period: "lr",
  type: "recoverAll",
  formula: ""
}]);
const IRON_WILL_NEXT_SAVE_EFFECT_NAME = "Железная воля: следующий приём";
const FIGHTER_MANEUVER_SECTION_LABEL = "Воинские приёмы";
const FIGHTER_MANEUVER_SUBTYPE = "fighterManeuver";
const FIGHTER_MULTIATTACK_CHOICES = Object.freeze([{
  featureId: "fighter-multiattack-action-surge",
  name: "Воинская мультиатака: Всплеск действий"
}, {
  featureId: "fighter-multiattack-horde-breaker",
  name: "Воинская мультиатака: Разрушитель орд"
}, {
  featureId: "fighter-multiattack-stalwart-defender",
  name: "Воинская мультиатака: Стойкий защитник"
}]);

const FIGHTER_STARTING_EQUIPMENT_UUIDS = Object.freeze({
  arrows: "Compendium.dnd5e.equipment24.Item.phbamoArrows0000",
  bolts: "Compendium.dnd5e.equipment24.Item.phbamoBolts00000",
  breastplate: "Compendium.dnd5e.equipment24.Item.phbarmBreastplat",
  bullets: "Compendium.dnd5e.equipment24.Item.phbamoBulletsFir",
  chainmail: "Compendium.dnd5e.equipment24.Item.phbarmChainMail0",
  dungeoneerPack: "Compendium.dnd5e.equipment24.Item.phbagDungeoneers",
  explorerPack: "Compendium.dnd5e.equipment24.Item.phbagExplorersPa",
  handaxe: "Compendium.dnd5e.equipment24.Item.phbwepHandaxe000",
  leather: "Compendium.dnd5e.equipment24.Item.phbarmLeatherArm",
  lightCrossbow: "Compendium.dnd5e.equipment24.Item.phbwepLightCross",
  longbow: "Compendium.dnd5e.equipment24.Item.phbwepLongbow000",
  musket: "Compendium.dnd5e.equipment24.Item.phbwepMusket0000",
  shield: "Compendium.dnd5e.equipment24.Item.phbarmShield0000"
});
const FIGHTER_MARTIAL_WEAPON_CHOICES = Object.freeze([
  { id: "battleaxe", label: "Боевой топор", uuid: "Compendium.dnd5e.equipment24.Item.phbwepBattleaxe0" },
  { id: "flail", label: "Цеп", uuid: "Compendium.dnd5e.equipment24.Item.phbwepFlail00000" },
  { id: "glaive", label: "Глефа", uuid: "Compendium.dnd5e.equipment24.Item.phbwepGlaive0000" },
  { id: "greataxe", label: "Секира", uuid: "Compendium.dnd5e.equipment24.Item.phbwepGreataxe00" },
  { id: "greatsword", label: "Двуручный меч", uuid: "Compendium.dnd5e.equipment24.Item.phbwepGreatsword" },
  { id: "halberd", label: "Алебарда", uuid: "Compendium.dnd5e.equipment24.Item.phbwepHalberd000" },
  { id: "lance", label: "Пика кавалериста", uuid: "Compendium.dnd5e.equipment24.Item.phbwepLance00000" },
  { id: "longbow", label: "Длинный лук", uuid: FIGHTER_STARTING_EQUIPMENT_UUIDS.longbow },
  { id: "longsword", label: "Длинный меч", uuid: "Compendium.dnd5e.equipment24.Item.phbwepLongsword0" },
  { id: "maul", label: "Молот", uuid: "Compendium.dnd5e.equipment24.Item.phbwepMaul000000" },
  { id: "morningstar", label: "Моргенштерн", uuid: "Compendium.dnd5e.equipment24.Item.phbwepMorningsta" },
  { id: "pike", label: "Пика", uuid: "Compendium.dnd5e.equipment24.Item.phbwepPike000000" },
  { id: "rapier", label: "Рапира", uuid: "Compendium.dnd5e.equipment24.Item.phbwepRapier0000" },
  { id: "scimitar", label: "Скимитар", uuid: "Compendium.dnd5e.equipment24.Item.phbwepScimitar00" },
  { id: "shortsword", label: "Короткий меч", uuid: "Compendium.dnd5e.equipment24.Item.phbwepShortsword" },
  { id: "trident", label: "Трезубец", uuid: "Compendium.dnd5e.equipment24.Item.phbwepTrident000" },
  { id: "warpick", label: "Клевец", uuid: "Compendium.dnd5e.equipment24.Item.phbwepWarPick000" },
  { id: "warhammer", label: "Боевой молот", uuid: "Compendium.dnd5e.equipment24.Item.phbwepWarhammer0" },
  { id: "whip", label: "Кнут", uuid: "Compendium.dnd5e.equipment24.Item.phbwepWhip000000" }
]);
const FIGHTER_STARTING_EQUIPMENT_CHOICES = Object.freeze({
  armor: Object.freeze([
    { id: "chainmail", label: "Кольчуга" },
    { id: "leather", label: "Кожаный доспех" },
    { id: "vest-bow", label: "Многослойный бронежилет, длинный лук и 20 стрел" }
  ]),
  main: Object.freeze([
    { id: "martial-shield", label: "Воинское оружие и щит" },
    { id: "two-martial", label: "Два воинских оружия" },
    { id: "firearm", label: "Примитивное длинноствольное огнестрельное оружие и 20 боеприпасов" }
  ]),
  sidearm: Object.freeze([
    { id: "crossbow", label: "Лёгкий арбалет и 20 болтов" },
    { id: "handaxes", label: "Два ручных топора" }
  ]),
  pack: Object.freeze([
    { id: "dungeoneer", label: "Набор исследователя подземелий" },
    { id: "explorer", label: "Набор путешественника" }
  ]),
  martialWeapons: FIGHTER_MARTIAL_WEAPON_CHOICES
});

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

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

function clampInteger(value, min, max) {
  const numeric = Math.floor(toNumber(value, min));
  return Math.max(min, Math.min(max, numeric));
}

function getProperty(source, path, fallback = undefined) {
  const value = foundry.utils.getProperty(source, path);
  return value === undefined ? fallback : value;
}

function readDocumentFlag(document, key) {
  if (typeof document?.getFlag === "function") {
    return document.getFlag(MODULE_ID, key);
  }

  return getProperty(document, `flags.${MODULE_ID}.${key}`, undefined);
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

function resolveActorFromTarget(target) {
  return target?.actor
    ?? target?.document?.actor
    ?? target?.object?.actor
    ?? target?.token?.actor
    ?? null;
}

function targetActorsFromWorkflow(workflow) {
  return collectionValues(workflow?.hitTargets ?? workflow?.targets)
    .map(resolveActorFromTarget)
    .filter((actor) => actor instanceof Actor);
}

function defaultDamageTypeFromWorkflow(workflow) {
  const detail = Array.isArray(workflow?.damageDetail) ? workflow.damageDetail : [];
  const detailedType = detail.map((row) => cleanText(row?.type)).find(Boolean);
  if (detailedType) {
    return detailedType;
  }

  const itemType = cleanText(workflow?.item?.system?.damage?.base?.types?.[0]);
  if (itemType) {
    return itemType;
  }

  return cleanText(workflow?.defaultDamageType);
}

function speakerForActor(actor) {
  return ChatMessage.getSpeaker({ actor });
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(cleanText(value));
}

function itemFeatureId(item) {
  return cleanText(readDocumentFlag(item, "featureId"));
}

function rawFeatureId(featureId) {
  return cleanText(featureId).split("::").pop() ?? "";
}

function featureIdMatches(item, rawId) {
  const featureId = itemFeatureId(item);
  return featureId === rawId || featureId.endsWith(`::class::${rawId}`);
}

function multiattackChoiceFromItem(item) {
  const rawId = rawFeatureId(itemFeatureId(item));
  return FIGHTER_MULTIATTACK_CHOICES.find((choice) => (
    choice.featureId === rawId || normalizeText(choice.name) === normalizeText(item?.name)
  )) ?? null;
}

function isSecondWindRecovery(recovery) {
  return Array.isArray(recovery)
    && recovery.some((entry) => cleanText(entry?.period) === "lr" && cleanText(entry?.type) === "recoverAll");
}

function isFighterManeuverItem(item) {
  const sourceType = cleanText(readDocumentFlag(item, "sourceType"));
  if (sourceType === "fighterManeuver") {
    return true;
  }

  if (cleanText(getProperty(item, "system.type.subtype")) === FIGHTER_MANEUVER_SUBTYPE) {
    return true;
  }

  const identifier = cleanText(getProperty(item, "system.identifier")).toLowerCase();
  if (identifier.includes("fighter-rework-v028") && identifier.includes("maneuver")) {
    return true;
  }

  if (
    normalizeText(readDocumentFlag(item, "section")) === normalizeText(FIGHTER_MANEUVER_SECTION_LABEL)
    || normalizeText(getProperty(item, "flags.teyvankal.section")) === normalizeText(FIGHTER_MANEUVER_SECTION_LABEL)
  ) {
    return true;
  }

  const featureId = itemFeatureId(item);
  if (featureId.includes("::fighterManeuver::")) {
    return true;
  }

  return readDocumentFlag(item, "automation")?.type === "fighterManeuver";
}

function isFighterManeuverActivityDocument(document) {
  return cleanText(readDocumentFlag(document, "automation")) === "fighter-dominance-maneuver"
    || readDocumentFlag(document, "fighterAutomation")?.kind === "maneuver"
    || isFighterManeuverItem(document)
    || isFighterManeuverItem(document?.item);
}

function fighterManeuverAutomationFromActivity(activity) {
  const directAutomation = readDocumentFlag(activity, "fighterAutomation")
    ?? readDocumentFlag(activity?.item, "fighterAutomation");
  if (directAutomation?.kind === "maneuver") {
    return directAutomation;
  }

  if (!isFighterManeuverItem(activity?.item)) {
    return {};
  }

  const classIdentifier = cleanText(
    readDocumentFlag(activity?.item, "classIdentifier")
    ?? readDocumentFlag(activity, "classIdentifier"),
    "fighter-rework-v028"
  );
  return getFighterManeuverAutomation(activity?.item?.name ?? activity?.name, classIdentifier);
}

function effectStatuses(effect) {
  const statuses = effect?.statuses;
  if (statuses instanceof Set) {
    return Array.from(statuses).map((entry) => cleanText(entry)).filter(Boolean);
  }

  if (Array.isArray(statuses)) {
    return statuses.map((entry) => cleanText(entry)).filter(Boolean);
  }

  const coreStatus = cleanText(effect?.getFlag?.("core", "statusId") ?? getProperty(effect, "flags.core.statusId"));
  return coreStatus ? [coreStatus] : [];
}

function hasBloodiedStatus(actor) {
  return collectionValues(actor?.effects).some((effect) => (
    effectStatuses(effect).some((statusId) => BLOODIED_STATUS_IDS.has(statusId))
  ));
}

function isBloodied(actor) {
  const max = actorHpMax(actor);
  if (max > 0) {
    return actorHpValue(actor) * 2 < max;
  }

  return hasBloodiedStatus(actor);
}

function isExactlyHalfHp(actor) {
  const hp = actor?.system?.attributes?.hp;
  const max = toNumber(hp?.max, 0);
  if (max <= 0) {
    return false;
  }

  return toNumber(hp?.value, 0) * 2 === max;
}

function actorHpValue(actor) {
  return toNumber(actor?.system?.attributes?.hp?.value, 0);
}

function actorHpMax(actor) {
  return toNumber(actor?.system?.attributes?.hp?.max, 0);
}

function hasActorFeature(actor, rawId, normalizedName) {
  return collectionValues(actor?.items).some((item) => (
    featureIdMatches(item, rawId) || normalizeText(item?.name) === normalizedName
  ));
}

function findActorFeature(actor, rawId, normalizedName) {
  return collectionValues(actor?.items).find((item) => (
    featureIdMatches(item, rawId) || normalizeText(item?.name) === normalizedName
  )) ?? null;
}

export class FighterAutomationService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this._lastAttacks = new Map();
    this._ironWillTurnPrompts = new Set();
    this._ironWillNextSavePending = new Set();
    this._options = options;
  }

  async initialize() {
    return true;
  }

  async handleCreatedItem(item, _options = {}, userId = "") {
    if (userId && game.user?.id && userId !== game.user.id) {
      return true;
    }

    if (!this.#isFighterClassItem(item)) {
      return true;
    }

    const actor = item.actor ?? item.parent ?? null;
    if (!(actor instanceof Actor) || !this.#canPrompt(actor)) {
      return true;
    }

    if (readDocumentFlag(item, FIGHTER_STARTING_EQUIPMENT_PROMPT_FLAG)) {
      return true;
    }

    const selection = await this.#promptFighterStartingEquipment(actor, item);
    if (!selection) {
      return true;
    }

    const itemData = await this.#buildStartingEquipmentItemData(selection);
    if (itemData.length && typeof actor.createEmbeddedDocuments === "function") {
      await actor.createEmbeddedDocuments("Item", itemData, { renderSheet: false });
    }

    if (typeof item.setFlag === "function") {
      await item.setFlag(MODULE_ID, FIGHTER_STARTING_EQUIPMENT_PROMPT_FLAG, true);
    }

    return true;
  }

  applyMidiRollComplete(workflow) {
    const actor = workflow?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    if (this.#isFighterManeuverWorkflow(workflow)) {
      return true;
    }

    const targets = targetActorsFromWorkflow(workflow);
    if (!targets.length) {
      return true;
    }

    this._lastAttacks.set(this.#actorKey(actor), {
      targets,
      damageType: defaultDamageTypeFromWorkflow(workflow),
      sourceItemUuid: workflow?.item?.uuid,
      timestamp: Date.now()
    });
    return true;
  }

  async applyDnd5ePostUseActivity(activity, usageConfig, results) {
    void usageConfig;
    void results;

    const actor = activity?.actor ?? activity?.item?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const automation = cleanText(readDocumentFlag(activity, "automation"));
    const fighterAutomation = fighterManeuverAutomationFromActivity(activity);

    if (automation === "fighter-second-wind" || fighterAutomation?.kind === "secondWind") {
      await this.#useSecondWind(actor, activity?.item, fighterAutomation);
      return true;
    }

    if (automation === "fighter-dominance-maneuver" || fighterAutomation?.kind === "maneuver") {
      await this.#applyManeuver(actor, activity, fighterAutomation, results);
    }

    return true;
  }

  async handleCombatTurnChange(combat, updateData = {}) {
    const actor = this.#resolveCombatTurnActor(combat, updateData);
    if (!(actor instanceof Actor)) {
      return true;
    }

    if (!this.#hasIronWill(actor) || actorHpValue(actor) <= 0) {
      return true;
    }

    if (!isBloodied(actor) && !isExactlyHalfHp(actor)) {
      return true;
    }

    const turnKey = `${updateData?.round ?? combat?.round ?? 0}:${updateData?.turn ?? combat?.turn ?? 0}:${this.#actorKey(actor)}:iron-will`;
    if (this._ironWillTurnPrompts.has(turnKey)) {
      return true;
    }
    this._ironWillTurnPrompts.add(turnKey);

    const secondWind = this.#findSecondWind(actor);
    if (!secondWind) {
      return true;
    }

    const confirmed = await this.#confirmIronWillSecondWind(actor);
    if (confirmed) {
      await this.#useSecondWind(actor, secondWind, {
        kind: "secondWind",
        die: "d6",
        maxDiceAbility: "con",
        minDice: 1
      });
    }

    return true;
  }

  #resolveCombatTurnActor(combat, updateData = {}) {
    const directActor = updateData?.combatant?.actor ?? null;
    if (directActor instanceof Actor) {
      return directActor;
    }

    const combatantId = cleanText(updateData?.combatantId);
    if (combatantId) {
      const combatant = combat?.combatants?.get?.(combatantId)
        ?? collectionValues(combat?.combatants).find((entry) => cleanText(entry?.id) === combatantId)
        ?? null;
      if (combatant?.actor instanceof Actor) {
        return combatant.actor;
      }
    }

    const turn = Number(updateData?.turn);
    if (Number.isInteger(turn)) {
      const combatant = collectionValues(combat?.turns)[turn] ?? null;
      if (combatant?.actor instanceof Actor) {
        return combatant.actor;
      }
    }

    return combat?.combatant?.actor ?? null;
  }

  async applyDnd5eApplyDamage(actor, amount, options = {}) {
    void options;
    if (!(actor instanceof Actor) || toNumber(amount, 0) >= 0) {
      return true;
    }

    await this.#applyIronWillAfterHealing(actor);
    return true;
  }

  async repairActor(actor) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    const secondWind = this.#findSecondWind(actor);
    if (secondWind) {
      await this.#ensureSecondWindResource(actor, secondWind);
    }

    await this.#repairManeuverSections(actor);
    return true;
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!(actor instanceof Actor) || !this.#isLongRest(result, config)) {
      return true;
    }

    await this.repairActor(actor);

    const secondWind = this.#findSecondWind(actor);
    if (secondWind && secondWind.system?.uses?.spent) {
      await this.#ensureSecondWindResource(actor, secondWind, { restore: true });
    }

    await this.#handleMultiattackRestChoice(actor);
    return true;
  }

  async #applyManeuver(actor, activity, fighterAutomation = {}, results = {}) {
    if ((await this.#consumeDominanceDieIfNeeded(actor, activity, results)) === false) {
      return false;
    }

    const lastAttack = this.#lastAttack(actor);
    const target = this.#resolveManeuverTarget(lastAttack, actor);
    const item = activity?.item;

    if (target && fighterAutomation?.extraDamage?.formula) {
      await this.#applyDamage(target, fighterAutomation.extraDamage.formula, cleanText(lastAttack?.damageType), {
        sourceActor: actor,
        sourceItemUuid: item?.uuid,
        label: item?.name ?? activity?.name ?? "Воинский приём"
      });
    }

    let saveSucceeded = false;
    if (target && fighterAutomation?.saveAbility) {
      if (this.#hasIronWillNextSave(actor)) {
        await this.#applySaveDisadvantageEffect(target, fighterAutomation.saveAbility, actor);
        await this.#consumeIronWillNextSave(actor);
      }

      saveSucceeded = await this.#rollManeuverSave(target, fighterAutomation.saveAbility, actor, item ?? activity) === true;
    }

    if (target && fighterAutomation?.status?.id && !saveSucceeded) {
      await this.#setStatus(target, fighterAutomation.status, actor);
    }

    await this.#postManeuverChat(actor, activity, fighterAutomation, target);
  }

  #lastAttack(actor) {
    const entry = this._lastAttacks.get(this.#actorKey(actor));
    if (!entry) {
      return null;
    }

    if ((Date.now() - toNumber(entry.timestamp, 0)) > LAST_ATTACK_MAX_AGE_MS) {
      this._lastAttacks.delete(this.#actorKey(actor));
      return null;
    }

    return entry;
  }

  #resolveManeuverTarget(lastAttack, sourceActor = null) {
    const selectedTarget = collectionValues(game.user?.targets)
      .map(resolveActorFromTarget)
      .find((actor) => actor instanceof Actor && !this.#isSameActor(actor, sourceActor)) ?? null;
    if (selectedTarget) {
      return selectedTarget;
    }

    const storedTarget = lastAttack?.targets?.find((target) => target instanceof Actor && !this.#isSameActor(target, sourceActor));
    if (storedTarget) {
      return storedTarget;
    }

    return null;
  }

  #isFighterManeuverWorkflow(workflow) {
    return isFighterManeuverActivityDocument(workflow?.activity)
      || isFighterManeuverActivityDocument(workflow?.item)
      || isFighterManeuverItem(workflow?.item);
  }

  async #consumeDominanceDieIfNeeded(actor, activity, results = {}) {
    if (!isFighterManeuverActivityDocument(activity)) {
      return true;
    }

    const dominanceItem = this.#findDominanceItem(actor);
    if (!dominanceItem) {
      return true;
    }

    if (this.#didNativeConsumeItemUse(results, dominanceItem)) {
      return true;
    }

    const maxUses = await this.#resolveUsesMax(dominanceItem.system?.uses?.max, actor);
    if (maxUses <= 0) {
      return true;
    }

    const spent = Math.max(0, Math.floor(toNumber(dominanceItem.system?.uses?.spent, 0)));
    if (spent >= maxUses) {
      globalThis.ui?.notifications?.warn("Стиль доминирования: не осталось костей доминирования.");
      return false;
    }

    if (typeof dominanceItem.update === "function") {
      await dominanceItem.update({ "system.uses.spent": spent + 1 });
    }
    else {
      foundry.utils.setProperty(dominanceItem, "system.uses.spent", spent + 1);
    }
    return true;
  }

  #didNativeConsumeItemUse(results, item) {
    const itemId = cleanText(item?.id ?? item?._id);
    if (!itemId) {
      return false;
    }

    if (collectionValues(results?.updates?.item).some((update) => (
      cleanText(update?._id ?? update?.id) === itemId
      && update !== null
      && typeof update === "object"
      && Object.hasOwn(update, "system.uses.spent")
    ))) {
      return true;
    }

    return this.#messageHasConsumedItemUse(results, itemId);
  }

  #messageHasConsumedItemUse(results, itemId) {
    const consumedSources = [
      getProperty(results, "message.flags.dnd5e.use.consumed"),
      getProperty(results, "message.data.flags.dnd5e.use.consumed"),
      getProperty(results, "message._source.flags.dnd5e.use.consumed"),
      typeof results?.message?.getFlag === "function"
        ? results.message.getFlag("dnd5e", "use.consumed")
        : null
    ];

    for (const consumed of consumedSources) {
      const itemDeltas = consumed?.item;
      if (!itemDeltas) {
        continue;
      }

      const deltas = itemDeltas instanceof Map
        ? itemDeltas.get(itemId)
        : (Array.isArray(itemDeltas)
          ? itemDeltas.find((entry) => cleanText(entry?._id ?? entry?.id) === itemId)?.changes
          : itemDeltas[itemId]);
      const rows = Array.isArray(deltas)
        ? deltas
        : (deltas && typeof deltas === "object" ? Object.values(deltas) : []);

      if (rows.some((row) => (
        cleanText(row?.keyPath) === "system.uses.spent"
        && toNumber(row?.delta, 0) > 0
      ))) {
        return true;
      }
    }

    return false;
  }

  #findDominanceItem(actor) {
    return collectionValues(actor?.items).find((item) => {
      if (featureIdMatches(item, FIGHTER_DOMINANCE_FEATURE_ID)) {
        return true;
      }

      const identifier = cleanText(item?.system?.identifier);
      if (identifier === FIGHTER_DOMINANCE_FEATURE_ID || identifier.endsWith(`-${FIGHTER_DOMINANCE_FEATURE_ID}`)) {
        return true;
      }

      return normalizeText(item?.name) === "стиль доминирования";
    }) ?? null;
  }

  #fighterManeuverSaveDc(actor) {
    const proficiency = toNumber(getProperty(actor, "system.attributes.prof", 2), 2);
    const strength = toNumber(getProperty(actor, "system.abilities.str.mod", 0), 0);
    const dexterity = toNumber(getProperty(actor, "system.abilities.dex.mod", 0), 0);
    return 8 + proficiency + Math.max(strength, dexterity);
  }

  async #rollManeuverSave(target, ability, sourceActor, sourceDocument) {
    if (typeof target?.rollSavingThrow !== "function") {
      return null;
    }

    const abilityKey = cleanText(ability, "wis").toLowerCase();
    const dc = this.#fighterManeuverSaveDc(sourceActor);
    const rolls = await target.rollSavingThrow({
      ability: abilityKey,
      target: dc
    }, {}, {
      data: {
        speaker: speakerForActor(target),
        flavor: `${cleanText(sourceDocument?.name, "Воинский приём")}: спасбросок ${abilityKey.toUpperCase()} Сл ${dc}`
      }
    });
    const roll = Array.isArray(rolls) ? rolls[0] : rolls;
    const total = Number(roll?.total);
    return Number.isFinite(total) ? total >= dc : null;
  }

  #isLongRest(result = {}, config = {}) {
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

  async #handleMultiattackRestChoice(actor) {
    const multiattackItems = this.#fighterMultiattackItems(actor);
    if (!multiattackItems.length && this.#fighterLevel(actor) < 2) {
      return false;
    }

    const choices = FIGHTER_MULTIATTACK_CHOICES.map((choice) => {
      const ownedItem = multiattackItems.find((item) => multiattackChoiceFromItem(item)?.featureId === choice.featureId) ?? null;
      return {
        ...choice,
        owned: Boolean(ownedItem),
        itemId: ownedItem?.id ?? ownedItem?._id ?? ""
      };
    });
    const selectedId = cleanText(await this.#promptFighterMultiattackChoice(actor, choices));
    const selected = choices.find((choice) => choice.featureId === selectedId || choice.itemId === selectedId) ?? null;
    if (!selected) {
      return false;
    }

    let selectedKept = false;
    const deleteIds = [];
    for (const item of multiattackItems) {
      const itemChoice = multiattackChoiceFromItem(item);
      if (itemChoice?.featureId !== selected.featureId) {
        deleteIds.push(item.id ?? item._id);
        continue;
      }

      if (selectedKept) {
        deleteIds.push(item.id ?? item._id);
        continue;
      }

      selectedKept = true;
    }

    if (deleteIds.length && typeof actor.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("Item", deleteIds.filter(Boolean));
    }

    if (!selectedKept) {
      const itemData = await this.#loadMultiattackFeatureData(selected.featureId);
      if (itemData && typeof actor.createEmbeddedDocuments === "function") {
        await actor.createEmbeddedDocuments("Item", [itemData]);
      }
    }

    return true;
  }

  #fighterMultiattackItems(actor) {
    return collectionValues(actor?.items).filter((item) => Boolean(multiattackChoiceFromItem(item)));
  }

  async #loadMultiattackFeatureData(featureId) {
    const rawId = rawFeatureId(featureId);
    const pack = game.packs?.get?.(`world.${CLASS_FEATURES_COMPENDIUM_NAME}`);
    if (!pack || typeof pack.getDocuments !== "function") {
      return null;
    }

    let documents = [];
    try {
      documents = await pack.getDocuments();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to read fighter multiattack features from compendium.`, error);
      return null;
    }

    const document = documents.find((entry) => rawFeatureId(itemFeatureId(entry)) === rawId
      || normalizeText(entry?.name) === normalizeText(FIGHTER_MULTIATTACK_CHOICES.find((choice) => choice.featureId === rawId)?.name));
    if (!document) {
      return null;
    }

    const data = typeof document.toObject === "function"
      ? document.toObject()
      : foundry.utils.deepClone(document);
    delete data._id;
    delete data.folder;
    return data;
  }

  async #useSecondWind(actor, item, automation = {}) {
    const secondWind = item ?? this.#findSecondWind(actor);
    if (!secondWind) {
      globalThis.ui?.notifications?.warn("Второе дыхание: предмет не найден у актёра.");
      return false;
    }

    const uses = secondWind.system?.uses ?? {};
    const maxUses = await this.#ensureSecondWindResource(actor, secondWind);
    const spent = Math.max(0, Math.floor(toNumber(uses.spent, 0)));
    const remaining = Math.max(0, maxUses - spent);
    if (remaining <= 0) {
      globalThis.ui?.notifications?.warn("Второе дыхание: не осталось костей лечения.");
      return false;
    }

    const die = cleanText(automation?.die, "d6");
    const minDice = Math.max(1, Math.floor(toNumber(automation?.minDice, 1)));
    const ability = cleanText(automation?.maxDiceAbility, "con");
    const abilityLimit = Math.max(minDice, Math.floor(toNumber(actor?.system?.abilities?.[ability]?.mod, minDice)));
    const maxDice = Math.max(minDice, Math.min(remaining, abilityLimit));
    const diceCount = await this.#promptSecondWindDice(actor, {
      min: minDice,
      max: maxDice,
      remaining,
      die
    });
    if (!diceCount) {
      return false;
    }

    const safeDiceCount = clampInteger(diceCount, minDice, maxDice);
    const roll = this.#createRoll(`${safeDiceCount}${die}`, actor);
    await roll.evaluate();
    const healed = Math.max(0, toNumber(roll.total, 0));
    const nextHp = Math.min(actorHpMax(actor), actorHpValue(actor) + healed);

    await actor.update({ "system.attributes.hp.value": nextHp });
    await secondWind.update?.({ "system.uses.spent": spent + safeDiceCount });
    await roll.toMessage?.({
      speaker: speakerForActor(actor),
      flavor: `Второе дыхание: ${safeDiceCount}${die}`
    });
    await this.#applyIronWillAfterHealing(actor);
    return true;
  }

  async #ensureSecondWindResource(actor, item, { restore = false } = {}) {
    const uses = item?.system?.uses ?? {};
    const fighterLevel = this.#fighterLevel(actor);
    const resolvedMax = fighterLevel > 0
      ? fighterLevel
      : await this.#resolveUsesMax(uses.max, actor);
    const maxUses = Math.max(0, Math.floor(resolvedMax));
    if (maxUses <= 0) {
      return 0;
    }

    const patch = {};
    if (String(uses.max ?? "") !== String(maxUses)) {
      patch["system.uses.max"] = maxUses;
    }
    if (!isSecondWindRecovery(uses.recovery)) {
      patch["system.uses.recovery"] = foundry.utils.deepClone(SECOND_WIND_USES_RECOVERY);
    }

    const spent = Math.max(0, Math.floor(toNumber(uses.spent, 0)));
    if (restore && spent !== 0) {
      patch["system.uses.spent"] = 0;
    }
    else if (!restore && spent > maxUses) {
      patch["system.uses.spent"] = maxUses;
    }

    if (Object.keys(patch).length) {
      if (typeof item.update === "function") {
        await item.update(patch);
      }
      else {
        for (const [path, value] of Object.entries(patch)) {
          foundry.utils.setProperty(item, path, value);
        }
      }
    }

    return maxUses;
  }

  async #repairManeuverSections(actor) {
    for (const item of collectionValues(actor?.items)) {
      if (!isFighterManeuverItem(item)) {
        continue;
      }

      const patch = {};
      if (getProperty(item, "system.type.value") !== "feat") {
        patch["system.type.value"] = "feat";
      }
      if (getProperty(item, "system.type.subtype") !== FIGHTER_MANEUVER_SUBTYPE) {
        patch["system.type.subtype"] = FIGHTER_MANEUVER_SUBTYPE;
      }
      if (getProperty(item, `flags.${MODULE_ID}.section`) !== FIGHTER_MANEUVER_SECTION_LABEL) {
        patch[`flags.${MODULE_ID}.section`] = FIGHTER_MANEUVER_SECTION_LABEL;
      }
      if (getProperty(item, "flags.teyvankal.section") !== FIGHTER_MANEUVER_SECTION_LABEL) {
        patch["flags.teyvankal.section"] = FIGHTER_MANEUVER_SECTION_LABEL;
      }
      if (Object.hasOwn(getProperty(item, "flags.teyvankal", {}), "subsection") === false) {
        patch["flags.teyvankal.subsection"] = null;
      }

      if (!Object.keys(patch).length) {
        continue;
      }

      if (typeof item.update === "function") {
        await item.update(patch);
      }
      else {
        for (const [path, value] of Object.entries(patch)) {
          foundry.utils.setProperty(item, path, value);
        }
      }
    }
  }

  async #resolveUsesMax(value, actor) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.floor(numeric));
    }

    const formula = cleanText(value);
    if (!formula) {
      return 0;
    }

    const roll = this.#createRoll(formula, actor);
    await roll.evaluate();
    return Math.max(0, Math.floor(toNumber(roll.total, 0)));
  }

  #fighterLevel(actor) {
    const classes = actor?.system?.classes;
    if (classes && typeof classes === "object") {
      for (const [key, entry] of Object.entries(classes)) {
        if (!this.#isFighterClassKey(key, entry)) {
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

      if (!this.#isFighterClassKey(item?.system?.identifier ?? item?.identifier, item)) {
        continue;
      }

      const levels = toNumber(item?.system?.levels ?? item?.system?.level ?? item?.system?.advancement?.level, 0);
      if (levels > 0) {
        return Math.floor(levels);
      }
    }

    return 0;
  }

  #isFighterClassKey(key, entry = {}) {
    const text = normalizeText([
      key,
      entry?.identifier,
      entry?.name,
      entry?.label,
      entry?.system?.identifier
    ].filter(Boolean).join(" "));
    return text.includes("fighter")
      || text.includes("fighter rework v028")
      || text === "воин"
      || text.includes("воин реворк");
  }

  async #applyIronWillAfterHealing(actor) {
    if (!this.#hasIronWill(actor) || actorHpValue(actor) <= 0) {
      return false;
    }

    if (isBloodied(actor) && !isExactlyHalfHp(actor)) {
      return false;
    }

    if (this.#hasIronWillNextSave(actor)) {
      return true;
    }

    const effectKey = `${this.#actorKey(actor)}:iron-will-next-save`;
    if (this._ironWillNextSavePending.has(effectKey)) {
      return true;
    }

    this._ironWillNextSavePending.add(effectKey);
    try {
      if (this.#hasIronWillNextSave(actor)) {
        return true;
      }

      return await this.#createActorEffect(actor, this.#ironWillNextSaveEffectData(actor));
    }
    finally {
      this._ironWillNextSavePending.delete(effectKey);
    }
  }

  #hasIronWill(actor) {
    return hasActorFeature(actor, "iron-will", "железная воля");
  }

  #findSecondWind(actor) {
    return findActorFeature(actor, "second-wind", "второе дыхание");
  }

  #hasIronWillNextSave(actor) {
    return collectionValues(actor?.effects).some((effect) => (
      this.#isIronWillNextSaveEffect(effect, actor)
    ));
  }

  #findIronWillNextSaveEffect(actor) {
    return collectionValues(actor?.effects).find((effect) => (
      this.#isIronWillNextSaveEffect(effect, actor)
    )) ?? null;
  }

  #isIronWillNextSaveEffect(effect, actor) {
    if (readDocumentFlag(effect, "fighterAutomation")?.kind === "ironWillNextSave") {
      return true;
    }

    if (effect?.disabled === true || effect?.transfer === true) {
      return false;
    }

    if (normalizeText(effect?.name) !== normalizeText(IRON_WILL_NEXT_SAVE_EFFECT_NAME)) {
      return false;
    }

    const origin = cleanText(effect?.origin);
    return !origin || !actor?.uuid || origin === actor.uuid;
  }

  async #consumeIronWillNextSave(actor) {
    const effect = this.#findIronWillNextSaveEffect(actor);
    if (typeof effect?.delete === "function") {
      await effect.delete();
    }
    return Boolean(effect);
  }

  async #applySaveDisadvantageEffect(target, ability, sourceActor) {
    const abilityKey = cleanText(ability, "wis");
    return this.#createActorEffect(target, {
      name: "Железная воля: помеха спасброску",
      type: "base",
      img: "icons/svg/downgrade.svg",
      system: {},
      changes: [{
        key: `flags.midi-qol.disadvantage.ability.save.${abilityKey}`,
        mode: EFFECT_MODE_OVERRIDE,
        value: "1",
        priority: 20
      }],
      disabled: false,
      duration: {
        startTime: null,
        seconds: null,
        combat: null,
        rounds: 1,
        turns: null,
        startRound: null,
        startTurn: null
      },
      description: `<p>Первый спасбросок против воинского приёма ${escapeHtml(sourceActor?.name)} совершается с помехой.</p>`,
      origin: sourceActor?.uuid ?? null,
      transfer: false,
      statuses: [],
      flags: {
        dae: {
          specialDuration: ["isSave", "combatEnd"]
        },
        [MODULE_ID]: {
          managed: true,
          fighterAutomation: {
            kind: "ironWillSaveDisadvantage",
            sourceActorUuid: sourceActor?.uuid ?? "",
            ability: abilityKey
          }
        }
      }
    });
  }

  #ironWillNextSaveEffectData(actor) {
    return {
      name: IRON_WILL_NEXT_SAVE_EFFECT_NAME,
      type: "base",
      img: "icons/svg/aura.svg",
      system: {},
      changes: [],
      disabled: false,
      duration: {
        startTime: null,
        seconds: null,
        combat: null,
        rounds: null,
        turns: null,
        startRound: null,
        startTurn: null
      },
      description: "<p>Следующий воинский приём со спасброском может дать одной цели помеху на первый спасбросок.</p>",
      origin: actor?.uuid ?? null,
      transfer: false,
      statuses: [],
      flags: {
        dae: {
          specialDuration: ["turnEndSource", "combatEnd"]
        },
        [MODULE_ID]: {
          managed: true,
          fighterAutomation: {
            kind: "ironWillNextSave"
          }
        }
      }
    };
  }

  async #applyDamage(actor, formula, damageType = "", options = {}) {
    const roll = this.#createRoll(formula, options.sourceActor ?? actor);
    await roll.evaluate();
    await actor.applyDamage([{
      value: Math.max(0, toNumber(roll.total, 0)),
      type: cleanText(damageType)
    }], {
      sourceActorUuid: options.sourceActor?.uuid,
      sourceItemUuid: options.sourceItemUuid
    });
    await roll.toMessage?.({
      speaker: speakerForActor(options.sourceActor ?? actor),
      flavor: cleanText(options.label, "Воинский приём")
    });
    return true;
  }

  async #setStatus(actor, status = {}, sourceActor) {
    const statusId = cleanText(status.id);
    if (!statusId) {
      return false;
    }

    if (typeof this.moduleApi?.combatStatusService?.setStatus === "function") {
      const effect = await this.moduleApi.combatStatusService.setStatus(actor, statusId, {
        active: true,
        ...(Object.hasOwn(status, "value") ? { value: status.value } : {}),
        durationRounds: Math.max(0, Math.floor(toNumber(status.durationRounds, 0))),
        sourceActor
      });
      await this.#patchManeuverStatusEffect(effect, status, sourceActor);
      return true;
    }

    const specialDuration = this.#maneuverStatusSpecialDuration(status);
    const duration = this.#maneuverStatusDuration(status);
    return this.#createActorEffect(actor, {
      name: statusId,
      type: "base",
      img: "icons/svg/aura.svg",
      system: {},
      changes: [],
      disabled: false,
      duration,
      origin: cleanText(sourceActor?.uuid) || null,
      transfer: false,
      statuses: [statusId],
      flags: {
        core: {
          statusId
        },
        ...(specialDuration.length ? {
          dae: {
            specialDuration
          }
        } : {}),
        [MODULE_ID]: {
          managed: true,
          fighterAutomation: {
            kind: "maneuverStatus",
            sourceActorUuid: cleanText(sourceActor?.uuid),
            expires: cleanText(status.expires)
          }
        }
      }
    });
  }

  #maneuverStatusSpecialDuration(status = {}) {
    const expires = cleanText(status.expires);
    if (expires === "sourceTurnEnd" || expires === "sourceNextTurnEnd") {
      return ["turnEndSource", "combatEnd"];
    }

    if (expires === "sourceTurnStart" || expires === "sourceNextTurnStart") {
      return ["turnStartSource", "combatEnd"];
    }

    if (Array.isArray(status.specialDuration)) {
      return status.specialDuration.map((entry) => cleanText(entry)).filter(Boolean);
    }

    return [];
  }

  #maneuverStatusDuration(status = {}) {
    const rounds = Math.max(0, Math.floor(toNumber(status.durationRounds, 0)));
    return {
      startTime: null,
      seconds: null,
      combat: null,
      rounds,
      turns: null,
      startRound: globalThis.game?.combat?.round ?? null,
      startTurn: globalThis.game?.combat?.turn ?? null
    };
  }

  async #patchManeuverStatusEffect(effect, status = {}, sourceActor) {
    if (!effect || typeof effect.update !== "function") {
      return false;
    }

    const specialDuration = this.#maneuverStatusSpecialDuration(status);
    const patch = {
      duration: this.#maneuverStatusDuration(status),
      origin: cleanText(sourceActor?.uuid) || null,
      [`flags.${MODULE_ID}.managed`]: true,
      [`flags.${MODULE_ID}.fighterAutomation.kind`]: "maneuverStatus",
      [`flags.${MODULE_ID}.fighterAutomation.sourceActorUuid`]: cleanText(sourceActor?.uuid),
      [`flags.${MODULE_ID}.fighterAutomation.expires`]: cleanText(status.expires)
    };

    if (specialDuration.length) {
      patch["flags.dae.specialDuration"] = specialDuration;
    }

    await effect.update(patch);
    return true;
  }

  async #createActorEffect(actor, effectData) {
    if (!(actor instanceof Actor) || typeof actor.createEmbeddedDocuments !== "function") {
      return false;
    }

    const data = foundry.utils.deepClone(effectData);
    delete data._id;
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    return true;
  }

  async #postManeuverChat(actor, activity, fighterAutomation, target) {
    if (!globalThis.ChatMessage?.create) {
      return false;
    }

    const itemName = cleanText(activity?.item?.name, activity?.name ?? "Воинский приём");
    const damageText = fighterAutomation?.extraDamage?.formula
      ? `<p><strong>Урон приёма:</strong> ${escapeHtml(fighterAutomation.extraDamage.formula)}${target ? ` по ${escapeHtml(target.name)}` : ""}.</p>`
      : "";
    const statusText = fighterAutomation?.status?.id
      ? `<p><strong>Состояние:</strong> ${escapeHtml(fighterAutomation.status.id)}${target ? ` на ${escapeHtml(target.name)}` : ""}.</p>`
      : "";
    const saveText = fighterAutomation?.saveAbility
      ? `<p><strong>Спасбросок:</strong> ${escapeHtml(fighterAutomation.saveAbility)}${this.#hasIronWillNextSave(actor) ? " с возможной помехой от Железной воли" : ""}.</p>`
      : "";

    if (!damageText && !statusText && !saveText) {
      return false;
    }

    await ChatMessage.create({
      speaker: speakerForActor(actor),
      flavor: itemName,
      content: `${damageText}${statusText}${saveText}`
    });
    return true;
  }

  #createRoll(formula, actor) {
    if (typeof this._options.rollFactory === "function") {
      return this._options.rollFactory(formula, actor);
    }

    return new Roll(cleanText(formula) || "0", actor?.getRollData?.() ?? {});
  }

  #isFighterClassItem(item) {
    if (item?.type !== "class") {
      return false;
    }

    const classIdentifier = cleanText(
      readDocumentFlag(item, "classIdentifier") ?? item?.system?.identifier
    );
    return classIdentifier === FIGHTER_CLASS_IDENTIFIER;
  }

  #startingEquipmentPromptChoices() {
    return {
      armor: Array.from(FIGHTER_STARTING_EQUIPMENT_CHOICES.armor),
      main: Array.from(FIGHTER_STARTING_EQUIPMENT_CHOICES.main),
      sidearm: Array.from(FIGHTER_STARTING_EQUIPMENT_CHOICES.sidearm),
      pack: Array.from(FIGHTER_STARTING_EQUIPMENT_CHOICES.pack),
      martialWeapons: Array.from(FIGHTER_STARTING_EQUIPMENT_CHOICES.martialWeapons)
    };
  }

  async #promptFighterStartingEquipment(actor, item) {
    const choices = this.#startingEquipmentPromptChoices();
    if (typeof this._options.promptFighterStartingEquipment === "function") {
      return this._options.promptFighterStartingEquipment(actor, item, choices);
    }

    if (!this.#canPrompt(actor) || typeof Dialog !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const selectOptions = (entries, selectedId = "") => entries
        .map((entry) => {
          const selected = entry.id === selectedId ? " selected" : "";
          return `<option value="${escapeHtml(entry.id)}"${selected}>${escapeHtml(entry.label)}</option>`;
        })
        .join("");

      const dialog = new Dialog({
        title: "Стартовое снаряжение воина",
        content: `
          <form>
            <div class="form-group">
              <label>Доспехи</label>
              <select data-fighter-starting-armor>${selectOptions(choices.armor)}</select>
            </div>
            <div class="form-group">
              <label>Основное оружие</label>
              <select data-fighter-starting-main>${selectOptions(choices.main)}</select>
            </div>
            <div class="form-group">
              <label>Воинское оружие 1</label>
              <select data-fighter-starting-martial-one>${selectOptions(choices.martialWeapons, "longsword")}</select>
            </div>
            <div class="form-group">
              <label>Воинское оружие 2</label>
              <select data-fighter-starting-martial-two>${selectOptions(choices.martialWeapons, "longsword")}</select>
            </div>
            <div class="form-group">
              <label>Дополнительное оружие</label>
              <select data-fighter-starting-sidearm>${selectOptions(choices.sidearm)}</select>
            </div>
            <div class="form-group">
              <label>Набор</label>
              <select data-fighter-starting-pack>${selectOptions(choices.pack)}</select>
            </div>
          </form>
        `,
        buttons: {
          confirm: {
            label: "Выдать",
            callback: (html) => {
              const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0];
              settled = true;
              resolve({
                armor: cleanText(root?.querySelector("[data-fighter-starting-armor]")?.value),
                main: cleanText(root?.querySelector("[data-fighter-starting-main]")?.value),
                martialWeapon: cleanText(root?.querySelector("[data-fighter-starting-martial-one]")?.value),
                martialWeapon2: cleanText(root?.querySelector("[data-fighter-starting-martial-two]")?.value),
                sidearm: cleanText(root?.querySelector("[data-fighter-starting-sidearm]")?.value),
                pack: cleanText(root?.querySelector("[data-fighter-starting-pack]")?.value)
              });
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

  async #buildStartingEquipmentItemData(selection) {
    const itemData = [];
    for (const entry of this.#startingEquipmentEntries(selection)) {
      const data = await this.#resolveStartingEquipmentItemData(entry.uuid, entry.quantity);
      if (data) {
        itemData.push(data);
      }
    }

    return itemData;
  }

  #startingEquipmentEntries(selection = {}) {
    const entriesByUuid = new Map();
    const add = (uuid, quantity = 1) => {
      if (!uuid) {
        return;
      }

      const current = entriesByUuid.get(uuid);
      entriesByUuid.set(uuid, {
        uuid,
        quantity: toNumber(current?.quantity, 0) + Math.max(1, Math.floor(toNumber(quantity, 1)))
      });
    };

    switch (cleanText(selection.armor, "chainmail")) {
      case "leather":
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.leather);
        break;
      case "vest-bow":
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.breastplate);
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.longbow);
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.arrows, 20);
        break;
      case "chainmail":
      default:
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.chainmail);
        break;
    }

    switch (cleanText(selection.main, "martial-shield")) {
      case "two-martial":
        add(this.#martialWeaponUuid(selection.martialWeapon));
        add(this.#martialWeaponUuid(selection.martialWeapon2));
        break;
      case "firearm":
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.musket);
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.bullets, 20);
        break;
      case "martial-shield":
      default:
        add(this.#martialWeaponUuid(selection.martialWeapon));
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.shield);
        break;
    }

    switch (cleanText(selection.sidearm, "crossbow")) {
      case "handaxes":
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.handaxe, 2);
        break;
      case "crossbow":
      default:
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.lightCrossbow);
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.bolts, 20);
        break;
    }

    switch (cleanText(selection.pack, "dungeoneer")) {
      case "explorer":
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.explorerPack);
        break;
      case "dungeoneer":
      default:
        add(FIGHTER_STARTING_EQUIPMENT_UUIDS.dungeoneerPack);
        break;
    }

    return Array.from(entriesByUuid.values());
  }

  #martialWeaponUuid(value) {
    const id = cleanText(value, "longsword");
    return FIGHTER_MARTIAL_WEAPON_CHOICES.find((choice) => choice.id === id)?.uuid
      ?? FIGHTER_MARTIAL_WEAPON_CHOICES.find((choice) => choice.id === "longsword")?.uuid;
  }

  async #resolveStartingEquipmentItemData(uuid, quantity = 1) {
    const source = typeof this._options.resolveStartingEquipmentItem === "function"
      ? await this._options.resolveStartingEquipmentItem(uuid)
      : await globalThis.fromUuid?.(uuid);
    if (!source) {
      return null;
    }

    const data = typeof source.toObject === "function"
      ? source.toObject()
      : foundry.utils.deepClone(source);
    delete data._id;
    delete data.id;
    data.flags ??= {};
    foundry.utils.setProperty(data, "flags.dnd5e.sourceId", uuid);
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.sourceType`, "fighterStartingEquipment");
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.classIdentifier`, FIGHTER_CLASS_IDENTIFIER);
    foundry.utils.setProperty(data, "system.quantity", Math.max(1, Math.floor(toNumber(quantity, 1))));
    return data;
  }

  async #promptSecondWindDice(actor, context) {
    if (typeof this._options.promptSecondWindDice === "function") {
      return this._options.promptSecondWindDice(actor, context);
    }

    if (!this.#canPrompt(actor) || typeof Dialog !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const options = [];
      for (let value = context.min; value <= context.max; value += 1) {
        options.push(`<option value="${value}">${value}${escapeHtml(context.die)}</option>`);
      }

      const dialog = new Dialog({
        title: "Второе дыхание",
        content: `
          <form>
            <div class="form-group">
              <label>Костей лечения: ${context.remaining}</label>
              <select data-second-wind-dice>${options.join("")}</select>
            </div>
          </form>
        `,
        buttons: {
          confirm: {
            label: "Исцелиться",
            callback: (html) => {
              const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0];
              settled = true;
              resolve(Number(root?.querySelector("[data-second-wind-dice]")?.value ?? context.min));
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

  async #promptFighterMultiattackChoice(actor, choices) {
    if (typeof this._options.promptFighterMultiattackChoice === "function") {
      return this._options.promptFighterMultiattackChoice(actor, choices);
    }

    if (!this.#canPrompt(actor) || typeof Dialog !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const options = choices.map((choice) => {
        const suffix = choice.owned ? " (есть)" : " (добавить)";
        return `<option value="${escapeHtml(choice.featureId)}">${escapeHtml(choice.name)}${suffix}</option>`;
      });

      const dialog = new Dialog({
        title: "Воинская мультиатака",
        content: `
          <form>
            <div class="form-group">
              <label>Оставить вариант до следующего продолжительного отдыха</label>
              <select data-fighter-multiattack-choice>${options.join("")}</select>
            </div>
          </form>
        `,
        buttons: {
          confirm: {
            label: "Оставить",
            callback: (html) => {
              const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0];
              settled = true;
              resolve(cleanText(root?.querySelector("[data-fighter-multiattack-choice]")?.value));
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

  async #confirmIronWillSecondWind(actor) {
    if (typeof this._options.confirmIronWillSecondWind === "function") {
      return this._options.confirmIronWillSecondWind(actor);
    }

    if (!this.#canPrompt(actor)) {
      return false;
    }

    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (typeof DialogV2?.confirm === "function") {
      return DialogV2.confirm({
        window: {
          title: "Железная воля"
        },
        content: "<p>Вы окровавлены. Использовать Второе дыхание в начале хода?</p>"
      });
    }

    if (typeof globalThis.Dialog?.confirm === "function") {
      return globalThis.Dialog.confirm({
        title: "Железная воля",
        content: "<p>Вы окровавлены. Использовать Второе дыхание в начале хода?</p>",
        yes: () => true,
        no: () => false,
        defaultYes: false
      });
    }

    return false;
  }

  #canPrompt(actor) {
    return Boolean(game.user?.isGM || actor?.isOwner);
  }

  #actorKey(actor) {
    return cleanText(actor?.uuid, actor?.id ?? "");
  }

  #isSameActor(left, right) {
    if (!left || !right) {
      return false;
    }

    if (left === right) {
      return true;
    }

    const leftKey = this.#actorKey(left);
    const rightKey = this.#actorKey(right);
    if (leftKey && rightKey && leftKey === rightKey) {
      return true;
    }

    const leftId = cleanText(left?.id ?? left?._id);
    const rightId = cleanText(right?.id ?? right?._id);
    return Boolean(leftId && rightId && leftId === rightId);
  }
}
