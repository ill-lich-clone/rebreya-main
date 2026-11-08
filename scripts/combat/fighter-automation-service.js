import { CLASS_FEATURES_COMPENDIUM_NAME, CLASSES_COMPENDIUM_NAME, GEAR_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { isWhirlwindActivity, markDamageRollTarget, markWhirlwindDamageRolls, whirlwindEffectTargets } from "./whirlwind-attack.js?v=1.5.70";
import {
  getClassStartingEquipmentConfig,
  getClassStartingEquipmentConfigBySourceType,
  getClassStartingEquipmentPackage,
  isClassStartingEquipmentPackageSourceType
} from "../data/class-starting-equipment.js";
import { fighterSecondWindUsesMax, getFighterManeuverAutomation } from "../data/fighter-automation.js?v=1.5.70";
import { FIGHTER_MANEUVER_COMMAND, SECOND_WIND_COMMAND, classCombatCardOwned, reserveClassCombatOperation, resolveClassCombatHit } from "../infrastructure/foundry/class-combat-command.js?v=1.5.70";
import { getActiveGm } from "../infrastructure/foundry/active-gm.js";

const LAST_ATTACK_MAX_AGE_MS = 120000;
const SUBSEQUENT_ATTACK_MANEUVERS = new Set(["атака с финтом", "быстрый бросок", "готовность", "ответный удар", "удар командующего", "широкая атака"]);
const BLOODIED_STATUS_IDS = new Set(["bloodied", "rebreya-bloodied"]);
const FIGHTER_CLASS_IDENTIFIER = "fighter-rework-v028";
const REBREYA_CLASS_IDENTIFIERS = new Set([
  "barbarian-rework-v012",
  FIGHTER_CLASS_IDENTIFIER,
  "paladin-rework-v01",
  "rogue-rework-v00"
]);
const FIGHTER_DOMINANCE_FEATURE_ID = "fighter-dominance";
const FIGHTER_STARTING_EQUIPMENT_PROMPT_FLAG = "startingEquipmentPrompted";
const REBREYA_CLASSES_PACK_ID = `world.${CLASSES_COMPENDIUM_NAME}`;
const FIGHTER_GEAR_PACK_ID = `world.${GEAR_COMPENDIUM_NAME}`;
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

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function documentReferenceIdentifiers(value) {
  const addIdentifier = (identifiers, candidate) => {
    const text = cleanText(candidate);
    if (!text || identifiers.includes(text)) {
      return;
    }

    identifiers.push(text);
    const uuidItemId = text.match(/(?:^|\.)Item\.([^.]+)$/u)?.[1];
    if (uuidItemId && !identifiers.includes(uuidItemId)) {
      identifiers.push(uuidItemId);
    }
  };

  const identifiers = [];
  if (value === null || value === undefined) {
    return identifiers;
  }

  if (typeof value !== "object") {
    addIdentifier(identifiers, value);
    return identifiers;
  }

  addIdentifier(identifiers, value.id);
  addIdentifier(identifiers, value._id);
  addIdentifier(identifiers, value.uuid);
  addIdentifier(identifiers, value.document?.id);
  addIdentifier(identifiers, value.document?._id);
  addIdentifier(identifiers, value.document?.uuid);

  return identifiers;
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

function repairUpdateOptions() {
  return { render: false };
}

function documentId(document) {
  return cleanText(document?.id ?? document?._id);
}

function applyLocalDocumentPatch(document, patch) {
  for (const [path, value] of Object.entries(patch)) {
    foundry.utils.setProperty(document, path, value);
  }
}

async function updateRepairItem(item, patch, options = {}) {
  if (!item || !patch || !Object.keys(patch).length) {
    return false;
  }

  const itemId = documentId(item);
  const actor = item?.parent instanceof Actor
    ? item.parent
    : (item?.actor instanceof Actor ? item.actor : null);
  if (itemId && typeof actor?.updateEmbeddedDocuments === "function") {
    await actor.updateEmbeddedDocuments("Item", [{ _id: itemId, ...patch }], options);
    return true;
  }

  if (typeof item.update === "function") {
    await item.update(patch, options);
    return true;
  }

  applyLocalDocumentPatch(item, patch);
  return true;
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

function advancementDataArray(value) {
  return collectionValues(value)
    .map((entry) => {
      if (typeof entry?.toObject === "function") {
        return entry.toObject();
      }

      if (typeof entry?.toJSON === "function") {
        return entry.toJSON();
      }

      return entry;
    })
    .filter(Boolean);
}

function advancementId(advancement) {
  return cleanText(advancement?._id ?? advancement?.id);
}

function mergeClassAdvancementData(currentAdvancements, sourceAdvancements) {
  const currentById = new Map(
    advancementDataArray(currentAdvancements)
      .map((advancement) => [advancementId(advancement), advancement])
      .filter(([id]) => id)
  );

  return advancementDataArray(sourceAdvancements)
    .map((sourceAdvancement) => {
      const nextAdvancement = foundry.utils.deepClone(sourceAdvancement);
      const currentAdvancement = currentById.get(advancementId(sourceAdvancement));
      if (currentAdvancement && Object.hasOwn(currentAdvancement, "value")) {
        nextAdvancement.value = foundry.utils.deepClone(currentAdvancement.value ?? {});
      }
      return nextAdvancement;
    });
}

function createDocumentId() {
  if (typeof foundry?.utils?.randomID === "function") {
    return foundry.utils.randomID();
  }

  if (typeof globalThis.randomID === "function") {
    return globalThis.randomID();
  }

  return Math.random().toString(36).slice(2, 18).padEnd(16, "0").slice(0, 16);
}

function resolveActorFromTarget(target) {
  return target?.actor
    ?? target?.document?.actor
    ?? target?.object?.actor
    ?? target?.token?.actor
    ?? null;
}

function attackHitTargets(workflow) {
  return whirlwindEffectTargets(workflow)
    ?? [...collectionValues(workflow?.hitTargets), ...collectionValues(workflow?.hitTargetsEC)];
}

function isWeaponWorkflow(workflow) {
  const item = workflow?.item ?? workflow?.activity?.item;
  if (workflow?.activity && workflow.activity.type !== "attack" && !isWhirlwindActivity(workflow.activity)) return false;
  if (!workflow?.attackRoll || workflow.attackRoll._evaluated === false) return false;
  return item?.type === "weapon" || /(?:^|-)unarmed-strike$/u.test(cleanText(item?.system?.identifier));
}

function defaultDamageTypeFromWorkflow(workflow) {
  const detail = Array.isArray(workflow?.damageDetail) ? workflow.damageDetail : [];
  const detailedType = detail.map((row) => cleanText(row?.type)).find(Boolean);
  if (detailedType) {
    return detailedType;
  }

  const itemType = cleanText(collectionValues(workflow?.item?.system?.damage?.base?.types)[0]);
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

function isSuperiorTechnique(item) {
  return rawFeatureId(itemFeatureId(item)) === "superior-technique"
    || ["боевой стиль превосходная техника", "превосходная техника"].includes(normalizeText(item?.name));
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

  if (!isFighterManeuverActivityDocument(activity)) {
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
    this._maneuverUses = new WeakSet();
    this._pendingManeuvers = new Map();
    this._usedAttackWorkflows = new WeakSet();
    this._seenAttackWorkflows = new WeakSet();
    this._ironWillTurnPrompts = new Set();
    this._ironWillNextSavePending = new Set();
    this._secondWindPending = new Set();
    this._classAdvancementSourcesPromise = null;
    this._repairActorPromises = new Map();
    this._options = options;
  }

  async initialize() {
    return true;
  }

  async handleCreatedItem(item, _options = {}, userId = "") {
    if (userId && game.user?.id && userId !== game.user.id) {
      return true;
    }

    if (this.#isFighterStartingEquipmentPackageItem(item)) {
      return this.#expandStartingEquipmentPackageItem(item);
    }

    if (isSuperiorTechnique(item) || featureIdMatches(item, FIGHTER_DOMINANCE_FEATURE_ID)) {
      return this.handleDominanceItemChange(item, userId);
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

    if (this.#hasNativeStartingEquipmentChoices(item)) {
      return true;
    }

    const selection = await this.#promptFighterStartingEquipment(actor, item);
    if (!selection) {
      return true;
    }

    const itemData = await this.#buildStartingEquipmentItemData(selection);
    if (itemData.length && typeof actor.createEmbeddedDocuments === "function") {
      await actor.createEmbeddedDocuments("Item", itemData, { keepId: true, renderSheet: false });
    }
    await this.#applyStartingEquipmentCurrency(actor, selection);

    if (typeof item.setFlag === "function") {
      await item.setFlag(MODULE_ID, FIGHTER_STARTING_EQUIPMENT_PROMPT_FLAG, true);
    }

    return true;
  }

  async handleDominanceItemChange(item, userId = "") {
    if (!isSuperiorTechnique(item) && !featureIdMatches(item, FIGHTER_DOMINANCE_FEATURE_ID)) return false;
    if (userId && game.user?.id && userId !== game.user.id) return false;
    const actor = item?.actor ?? item?.parent;
    if (!(actor instanceof Actor) || !this.#canPrompt(actor)) return false;
    return this.#repairDominancePool(actor);
  }

  applyMidiRollComplete(workflow) {
    const actor = workflow?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    if (this.#isFighterManeuverWorkflow(workflow) || !isWeaponWorkflow(workflow)) {
      return true;
    }
    if (this._seenAttackWorkflows.has(workflow)) return true;
    this._seenAttackWorkflows.add(workflow);

    const targets = workflow.isFumble === true ? [] : attackHitTargets(workflow)
      .filter(target => resolveActorFromTarget(target) instanceof Actor);
    const actorKey = this.#actorKey(actor);
    const pending = this._pendingManeuvers.get(actorKey);
    if (!targets.length && pending?.selected
      && collectionValues(workflow.targets).some(entry => this.#sameManeuverTarget(entry, pending.selected))) {
      this._pendingManeuvers.delete(actorKey);
    }
    if (!targets.length) {
      this._lastAttacks.delete(actorKey);
      return true;
    }

    this._lastAttacks.set(actorKey, {
      targets,
      workflow,
      damageType: defaultDamageTypeFromWorkflow(workflow),
      sourceItemUuid: workflow?.item?.uuid,
      timestamp: Date.now()
    });
    if (this._lastAttacks.size > 256) this._lastAttacks.delete(this._lastAttacks.keys().next().value);
    return true;
  }

  async applyDnd5ePostUseActivity(activity, usageConfig, results) {
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
      const receipt = results?.message ?? results;
      if (receipt && typeof receipt === "object") {
        if (this._maneuverUses.has(receipt)) return true;
        this._maneuverUses.add(receipt);
      }
      await this.#applyManeuver(actor, activity, fighterAutomation, results, usageConfig);
    }

    return true;
  }

  prepareDnd5eManeuverUse(activity, usageConfig = {}) {
    const automation = fighterManeuverAutomationFromActivity(activity);
    if (automation.kind !== "maneuver") return true;
    if (automation.key === "точная атака") {
      globalThis.ui?.notifications?.warn("Точная атака: выберите кость доминирования при броске атаки оружием.");
      return false;
    }
    const actor = activity.actor ?? activity.item?.actor;
    const selected = this.#selectedManeuverTarget(actor, {}, usageConfig);
    const attack = this.#lastAttack(actor);
    const pending = SUBSEQUENT_ATTACK_MANEUVERS.has(automation.key);
    if (pending && !selected && ["атака с финтом", "удар командующего"].includes(automation.key)) {
      globalThis.ui?.notifications?.warn("Воинский приём: выберите цель.");
      return false;
    }
    if (!automation.extraDamage || pending) return true;
    if (this.#resolveManeuverTarget(actor, selected, attack, automation) && !this.#attackUsedForManeuver(attack?.workflow)) return true;
    globalThis.ui?.notifications?.warn("Воинский приём: требуется подходящее попадание без другого приёма.");
    return false;
  }

  async handleCombatTurnChange(combat, updateData = {}) {
    const activeGm = getActiveGm(game);
    if (activeGm && activeGm.id !== game.user?.id) return true;
    const actor = this.#resolveCombatTurnActor(combat, updateData);
    if (!(actor instanceof Actor) || !this.#canPrompt(actor)) {
      return true;
    }

    if (!this.#hasIronWill(actor) || actorHpValue(actor) <= 0) {
      return true;
    }

    if (!isBloodied(actor) && !isExactlyHalfHp(actor)) {
      return true;
    }

    const turnKey = `${combat?.id ?? ""}:${updateData?.round ?? combat?.round ?? 0}:${updateData?.turn ?? combat?.turn ?? 0}:${this.#actorKey(actor)}`;
    if (this._ironWillTurnPrompts.has(turnKey)) {
      return true;
    }
    this._ironWillTurnPrompts.add(turnKey);
    if (this._ironWillTurnPrompts.size > 256) {
      this._ironWillTurnPrompts.delete(this._ironWillTurnPrompts.values().next().value);
    }

    const secondWind = this.#findSecondWind(actor);
    if (!secondWind) {
      return true;
    }

    const owners = collectionValues(game.users)
      .filter(user => user.active && !user.isGM && actor.testUserPermission?.(user, "OWNER"))
      .map(user => user.id).sort();
    if (owners.length && activeGm && this.moduleApi?.reactionQueueService?.promptDecision
      && typeof this._options.confirmIronWillSecondWind !== "function") {
      await this.#useSecondWind(actor, secondWind, { ownerUserIds: owners }, combat);
      return true;
    }

    const confirmed = await this.#confirmIronWillSecondWind(actor);
    if (confirmed) {
      await this.#useSecondWind(actor, secondWind, {
        kind: "secondWind",
        die: "d6",
        maxDiceAbility: "con",
        minDice: 1
      }, combat);
    }

    return true;
  }

  async handleCombatTurnEnd(combat, previous = {}) {
    const activeGm = getActiveGm(game);
    if (activeGm && activeGm.id !== game.user?.id) return true;
    const actor = this.#resolveCombatTurnActor(combat, previous);
    if (!(actor instanceof Actor) || !this.#canPrompt(actor)) return true;
    const effect = this.#findIronWillNextSaveEffect(actor);
    const automation = readDocumentFlag(effect, "fighterAutomation");
    if (!automation || !Object.hasOwn(automation, "createdTurn")) return true;
    const turn = this.#combatTurnKey({ id: combat.id, round: previous.round, turn: previous.turn });
    if (automation.createdTurn !== turn) await this.#consumeIronWillNextSave(actor);
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

    const repairKey = this.#actorKey(actor) || actor;
    const currentRepair = this._repairActorPromises.get(repairKey);
    if (currentRepair) {
      return currentRepair;
    }

    const repairPromise = this.#repairActorNow(actor);
    this._repairActorPromises.set(repairKey, repairPromise);
    try {
      return await repairPromise;
    }
    finally {
      if (this._repairActorPromises.get(repairKey) === repairPromise) {
        this._repairActorPromises.delete(repairKey);
      }
    }
  }

  async #repairActorNow(actor) {
    await this.#repairClassAdvancementLinks(actor);

    const secondWind = this.#findSecondWind(actor);
    if (secondWind) {
      await this.#ensureSecondWindResource(actor, secondWind, { render: false });
    }

    await this.#repairDominancePool(actor);
    await this.#repairManeuverSections(actor);
    await this.#repairStartingEquipmentContainerLinks(actor);
    return true;
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!(actor instanceof Actor) || !this.#isLongRest(result, config)) {
      return true;
    }

    await this.restoreAfterLongRest(actor);
    await this.#handleMultiattackRestChoice(actor);
    return true;
  }

  async restoreAfterLongRest(actor) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    await this.repairActor(actor);

    const secondWind = this.#findSecondWind(actor);
    if (secondWind && secondWind.system?.uses?.spent) {
      await this.#ensureSecondWindResource(actor, secondWind, { restore: true });
    }

    return true;
  }

  async chooseFighterMultiattackAfterLongRest(actor, execution = {}) {
    if (!(actor instanceof Actor) || !this.#canPrompt(actor)) {
      return { status: "skipped" };
    }
    const changed = await this.#handleMultiattackRestChoice(
      actor,
      execution.progress
    );
    return { status: changed ? "completed" : "skipped" };
  }

  registerLongRestSteps(pipeline) {
    if (typeof pipeline?.registerStep !== "function") return false;
    pipeline.registerStep({
      id: "fighter.restore",
      label: "Восстановление Воина",
      order: 130,
      interactive: false,
      isEligible: ({ actor }) => Boolean(actor),
      run: async ({ actor }) => {
        const restored = await this.restoreAfterLongRest(actor);
        return { status: restored ? "completed" : "skipped" };
      }
    });
    pipeline.registerStep({
      id: "fighter.multiattack",
      label: "Воинская мультиатака",
      order: 210,
      interactive: true,
      isEligible: ({ actor }) => (
        Boolean(actor)
        && this.#canPrompt(actor)
        && (
          this.#fighterMultiattackItems(actor).length > 0
          || this.#fighterLevel(actor) >= 2
        )
      ),
      run: ({ actor, progress }) => (
        this.chooseFighterMultiattackAfterLongRest(actor, { progress })
      )
    });
    return true;
  }

  async #applyManeuver(actor, activity, fighterAutomation = {}, results = {}, usageConfig = {}) {
    const key = fighterAutomation.key ?? normalizeText(activity?.item?.name ?? activity?.name);
    if (key === "точная атака") return false;
    const lastAttack = this.#lastAttack(actor);
    const selected = this.#selectedManeuverTarget(actor, results, usageConfig);
    const target = this.#resolveManeuverTarget(actor, selected, lastAttack, fighterAutomation);
    const hasDamage = Boolean(fighterAutomation?.extraDamage?.formula);
    if (!target && hasDamage && !SUBSEQUENT_ATTACK_MANEUVERS.has(key)) return false;
    if (target && lastAttack && this.#attackUsedForManeuver(lastAttack.workflow)) return false;

    if ((await this.#consumeDominanceDieIfNeeded(actor, activity, results)) === false) {
      return false;
    }

    if (!target && hasDamage) {
      const ally = key === "удар командующего" ? resolveActorFromTarget(selected) : null;
      if (key === "удар командующего" && !ally) return false;
      const timestamp = Date.now();
      const turn = this.#combatTurnKey(game.combat);
      if (ally) {
        await actor.update({ [`flags.${MODULE_ID}.fighterCommanderOrder`]: {
          id: results?.message?.id ?? createDocumentId(), allyActorUuid: ally.uuid,
          allyTokenUuid: selected.document?.uuid ?? selected.uuid ?? "", timestamp, turn
        } });
      }
      else {
        this._pendingManeuvers.set(this.#actorKey(actor), {
          key, actor, selected, formula: fighterAutomation.extraDamage.formula, timestamp, turn
        });
        if (this._pendingManeuvers.size > 128) this._pendingManeuvers.delete(this._pendingManeuvers.keys().next().value);
      }
      await this.#postManeuverChat(actor, activity, fighterAutomation, resolveActorFromTarget(selected));
      return true;
    }

    if (target && lastAttack) this._usedAttackWorkflows.add(lastAttack.workflow);
    if (target && !game.user?.isGM && target.isOwner === false) {
      const hit = lastAttack?.targets.find(entry => this.#isSameActor(resolveActorFromTarget(entry), target)
        && (!selected || this.#sameManeuverTarget(entry, selected)));
      const targetTokenUuid = hit?.document?.uuid ?? hit?.uuid;
      const attackId = lastAttack?.workflow?.chatCard?.id ?? lastAttack?.workflow?.itemCardId;
      const maneuverId = results?.message?.id;
      if (!attackId || !maneuverId || !targetTokenUuid || !this.moduleApi?.socketCommandBus?.request) {
        globalThis.ui?.notifications?.warn("Воинский приём: мастер должен подтвердить попадание по карточке атаки.");
        return false;
      }
      const disadvantage = Boolean(fighterAutomation.saveAbility && this.#hasIronWillNextSave(actor)
        && await this.#confirmIronWillDisadvantage(actor, target));
      await this.moduleApi.socketCommandBus.request(FIGHTER_MANEUVER_COMMAND, {
        attackId, maneuverId, targetTokenUuid, disadvantage
      });
    }
    else if (target) {
      await this.#applyConfirmedManeuver(actor, target, activity, fighterAutomation, lastAttack?.damageType);
    }
    await this.#postManeuverChat(actor, activity, fighterAutomation, target);
    return true;
  }

  async applyRemoteManeuver(payload, { sender } = {}) {
    const hit = await resolveClassCombatHit(payload, { sender });
    const message = game.messages?.get?.(payload.maneuverId);
    const item = message?.getAssociatedItem?.();
    if (!hit || !classCombatCardOwned(message, sender) || item?.actor?.uuid !== hit.actor.uuid || !isFighterManeuverItem(item)) {
      throw new Error("Воинский приём: карточка применения или цель не подтверждена.");
    }
    const resource = this.#findDominanceItem(hit.actor);
    const automation = getFighterManeuverAutomation(item.name, FIGHTER_CLASS_IDENTIFIER);
    if (!resource || !this.#messageHasConsumedItemUse({ message }, documentId(resource))
      || (!automation.extraDamage && !automation.status) || SUBSEQUENT_ATTACK_MANEUVERS.has(automation.key)) {
      throw new Error("Воинский приём: расход или вид приёма не подтверждён.");
    }
    const { receipt } = await reserveClassCombatOperation("fighter", hit, item, message.id);
    if (!receipt) return { applied: false };
    const type = defaultDamageTypeFromWorkflow({ item: hit.item });
    await this.#applyConfirmedManeuver(hit.actor, hit.target, { item }, automation, type, payload.disadvantage);
    return { applied: true };
  }

  async applyRemoteSecondWind(payload, { sender } = {}) {
    const actor = await globalThis.fromUuid?.(payload.actorUuid);
    if (!(actor instanceof Actor) || !sender || !actor.testUserPermission?.(sender, "OWNER")
      || payload.turn !== this.#combatTurnKey(game.combat)) return { applied: false };
    const item = this.#findSecondWind(actor);
    if (!item) return { applied: false };
    const applied = await this.#useSecondWind(actor, item, { diceCount: payload.diceCount });
    return { applied: applied === true };
  }

  async #applyConfirmedManeuver(actor, target, activity, fighterAutomation, damageType, requestedDisadvantage) {
    const item = activity?.item;
    const hasDamage = Boolean(fighterAutomation.extraDamage?.formula);
    if (target && hasDamage) {
      await this.#applyDamage(target, fighterAutomation.extraDamage.formula, cleanText(damageType), {
        sourceActor: actor,
        sourceItemUuid: item?.uuid,
        label: item?.name ?? activity?.name ?? "Воинский приём"
      });
    }

    let saveSucceeded = false;
    if (target && fighterAutomation?.saveAbility) {
      const disadvantage = this.#hasIronWillNextSave(actor)
        && (requestedDisadvantage ?? await this.#confirmIronWillDisadvantage(actor, target));
      saveSucceeded = await this.#rollManeuverSave(target, fighterAutomation.saveAbility, actor, item ?? activity, disadvantage);
      if (disadvantage && saveSucceeded !== null) await this.#consumeIronWillNextSave(actor);
    }

    if (target && fighterAutomation?.status?.id && saveSucceeded === false) {
      await this.#setStatus(target, fighterAutomation.status, actor);
    }

  }

  async applyMidiManeuverDamage(workflow) {
    if (!isWeaponWorkflow(workflow) || this.#attackUsedForManeuver(workflow)) return true;
    const key = this.#actorKey(workflow?.actor);
    const pending = this._pendingManeuvers.get(key) ?? this.#commanderOrder(workflow);
    if (!pending) return true;
    if (Date.now() - pending.timestamp > LAST_ATTACK_MAX_AGE_MS || pending.turn !== this.#combatTurnKey(game.combat)) {
      this._pendingManeuvers.delete(key);
      return true;
    }
    if (pending.key === "широкая атака" && !isWhirlwindActivity(workflow.activity)) return true;
    if (pending.key === "быстрый бросок"
      && !collectionValues(workflow.item?.system?.properties).includes("thr")) return true;
    const hits = attackHitTargets(workflow);
    const target = pending.selected ? hits.find(hit => this.#sameManeuverTarget(hit, pending.selected)) : hits[0];
    if (!target || typeof workflow.setBonusDamageRolls !== "function") return true;
    this._pendingManeuvers.delete(key);
    const DamageRoll = globalThis.CONFIG?.Dice?.DamageRoll ?? globalThis.Roll;
    const type = defaultDamageTypeFromWorkflow(workflow);
    const options = { type, types: type ? [type] : [] };
    const roll = this._options.createManeuverDamageRoll?.(pending.formula, pending.actor, options)
      ?? new DamageRoll(pending.formula, pending.actor.getRollData?.() ?? {}, options);
    await roll.evaluate();
    const tokenUuid = target?.document?.uuid ?? target?.uuid;
    if (isWhirlwindActivity(workflow.activity)) markWhirlwindDamageRolls({ rolls: [roll] }, tokenUuid);
    else if (hits.length > 1 && tokenUuid) markDamageRollTarget(roll, tokenUuid);
    if (pending.id) {
      const uses = collectionValues(readDocumentFlag(workflow.actor, "fighterCommanderUses"));
      if (uses.includes(pending.id)) return true;
      await workflow.actor.update({ [`flags.${MODULE_ID}.fighterCommanderUses`]: [...uses.slice(-23), pending.id] });
    }
    await workflow.setBonusDamageRolls([...(workflow.bonusDamageRolls ?? []), roll]);
    this._usedAttackWorkflows.add(workflow);
    return true;
  }

  #commanderOrder(workflow) {
    const attacker = workflow.actor;
    const token = workflow.token?.document ?? workflow.token;
    const uses = collectionValues(readDocumentFlag(attacker, "fighterCommanderUses"));
    for (const candidate of collectionValues(token?.parent?.tokens ?? globalThis.canvas?.scene?.tokens)) {
      const actor = resolveActorFromTarget(candidate);
      const order = readDocumentFlag(actor, "fighterCommanderOrder");
      if (!order?.id || uses.includes(order.id) || order.allyActorUuid !== attacker?.uuid
        || (order.allyTokenUuid && order.allyTokenUuid !== token?.uuid)
        || order.turn !== this.#combatTurnKey(game.combat)
        || Date.now() - order.timestamp > LAST_ATTACK_MAX_AGE_MS) continue;
      const formula = getFighterManeuverAutomation("Удар командующего", FIGHTER_CLASS_IDENTIFIER).extraDamage.formula;
      return { ...order, actor, formula };
    }
    return null;
  }

  #attackUsedForManeuver(workflow) {
    return Boolean(workflow && (this._usedAttackWorkflows.has(workflow)
      || workflow.rebreyaAttackRollBoosts?.some(boost => boost.id === "fighter-precise-attack")));
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

  #selectedManeuverTarget(actor, results, usageConfig) {
    const descriptors = results.message?.system?.targets ?? getProperty(results, "message.flags.dnd5e.use.targets") ?? [];
    const saved = collectionValues(descriptors).map(descriptor => {
      const token = globalThis.fromUuidSync?.(descriptor.token ?? descriptor.uuid);
      const tokenActor = resolveActorFromTarget(token);
      if (tokenActor && (!descriptor.actor || descriptor.actor === tokenActor.uuid)) return token;
      const targetActor = typeof descriptor.actor === "string" ? globalThis.fromUuidSync?.(descriptor.actor) : null;
      return targetActor ? { actor: targetActor } : descriptor;
    });
    const selected = saved.length ? saved : usageConfig.targets != null
      ? collectionValues(usageConfig.targets) : collectionValues(game.user?.targets);
    return selected
      .find(entry => resolveActorFromTarget(entry) instanceof Actor && !this.#isSameActor(resolveActorFromTarget(entry), actor)) ?? null;
  }

  #sameManeuverTarget(left, right) {
    const leftUuid = left?.document?.uuid ?? left?.uuid;
    const rightUuid = right?.document?.uuid ?? right?.uuid;
    return leftUuid && rightUuid ? leftUuid === rightUuid
      : this.#isSameActor(resolveActorFromTarget(left), resolveActorFromTarget(right));
  }

  #resolveManeuverTarget(actor, selected, lastAttack, automation) {
    const key = automation.key;
    if (["атака с финтом", "быстрый бросок", "готовность", "удар командующего"].includes(key)) return null;
    if (key === "широкая атака" && !isWhirlwindActivity(lastAttack?.workflow?.activity)) return null;
    const hits = lastAttack?.targets ?? [];
    const hit = selected ? hits.find(entry => this.#sameManeuverTarget(entry, selected)) : hits[0];
    if (hit && !this.#isSameActor(resolveActorFromTarget(hit), actor)) return resolveActorFromTarget(hit);
    return automation.extraDamage?.formula ? null : resolveActorFromTarget(selected);
  }

  #combatTurnKey(combat) {
    return combat && combat.started !== false ? `${combat.id ?? ""}:${combat.round}:${combat.turn}` : "";
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
    const consumedSources = results?.message?.system?.deltas ? [results.message.system.deltas] : [
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

  async #repairDominancePool(actor) {
    const item = this.#findDominanceItem(actor);
    if (!item) return false;
    const maximum = cleanText(item?._source?.system?.uses?.max ?? item.system?.uses?.max);
    const base = cleanText(readDocumentFlag(item, "dominanceStyleBaseMax"));
    const enhanced = Boolean(base && maximum === `(${base}) + 1`);
    const hasStyle = collectionValues(actor.items).some(isSuperiorTechnique);
    if (hasStyle && maximum && !enhanced) {
      return updateRepairItem(item, {
        "system.uses.max": `(${maximum}) + 1`,
        [`flags.${MODULE_ID}.dominanceStyleBaseMax`]: maximum
      }, repairUpdateOptions());
    }
    if (!hasStyle && enhanced) {
      return updateRepairItem(item, { "system.uses.max": base }, repairUpdateOptions());
    }
    return false;
  }

  #fighterManeuverSaveDc(actor) {
    const proficiency = toNumber(getProperty(actor, "system.attributes.prof", 2), 2);
    const strength = toNumber(getProperty(actor, "system.abilities.str.mod", 0), 0);
    const dexterity = toNumber(getProperty(actor, "system.abilities.dex.mod", 0), 0);
    return 8 + proficiency + Math.max(strength, dexterity);
  }

  async #rollManeuverSave(target, ability, sourceActor, sourceDocument, disadvantage = false) {
    if (typeof target?.rollSavingThrow !== "function") {
      return null;
    }

    const abilityKey = cleanText(ability, "wis").toLowerCase();
    const dc = this.#fighterManeuverSaveDc(sourceActor);
    const rolls = await target.rollSavingThrow({
      ability: abilityKey,
      target: dc,
      ...(disadvantage ? { disadvantage: true } : {})
    }, {}, {
      data: {
        speaker: speakerForActor(target),
        flavor: `${cleanText(sourceDocument?.name, "Воинский приём")}: спасбросок ${abilityKey.toUpperCase()} Сл ${dc}`
      }
    });
    const roll = Array.isArray(rolls) ? rolls[0] : rolls;
    const total = Number(roll?.total);
    return roll?.total != null && Number.isFinite(total) ? total >= dc : null;
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

  async #handleMultiattackRestChoice(actor, progress = null) {
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
    const selectedId = cleanText(await this.#promptFighterMultiattackChoice(
      actor,
      choices,
      progress
    ));
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

    if (!selectedKept) {
      const itemData = await this.#loadMultiattackFeatureData(selected.featureId);
      if (!itemData || typeof actor.createEmbeddedDocuments !== "function") return false;
      const created = await actor.createEmbeddedDocuments("Item", [itemData]);
      if (!created?.length) return false;
    }

    if (deleteIds.length && typeof actor.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("Item", deleteIds.filter(Boolean));
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

  async #useSecondWind(actor, item, automation = {}, combat = game.combat) {
    const actorKey = this.#actorKey(actor);
    const turnKey = this.#combatTurnKey(combat);
    if (this._secondWindPending.has(actorKey)
      || (turnKey && readDocumentFlag(actor, "secondWindTurn") === turnKey)) return false;
    this._secondWindPending.add(actorKey);
    try {
      return await this.#resolveSecondWind(actor, item, automation, turnKey, combat);
    }
    finally {
      this._secondWindPending.delete(actorKey);
    }
  }

  async #resolveSecondWind(actor, item, automation, turnKey, combat) {
    const secondWind = item ?? this.#findSecondWind(actor);
    if (!secondWind) {
      globalThis.ui?.notifications?.warn("Второе дыхание: предмет не найден у актёра.");
      return false;
    }

    const maxUses = await this.#ensureSecondWindResource(actor, secondWind);
    const spent = Math.max(0, Math.floor(toNumber(secondWind.system?.uses?.spent, 0)));
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
    const diceCount = automation.diceCount ?? await this.#promptSecondWindDice(actor, {
      min: minDice,
      max: maxDice,
      remaining,
      die,
      ...(automation.ownerUserIds ? { ownerUserIds: automation.ownerUserIds } : {})
    });
    if (!diceCount) {
      return false;
    }

    const safeDiceCount = clampInteger(diceCount, minDice, maxDice);
    const gm = getActiveGm(game);
    if (gm && gm.id !== game.user?.id && this.moduleApi?.socketCommandBus?.request) {
      const result = await this.moduleApi.socketCommandBus.request(SECOND_WIND_COMMAND, {
        actorUuid: actor.uuid, diceCount: safeDiceCount, turn: turnKey
      });
      return result?.applied === true;
    }
    const roll = this.#createRoll(`${safeDiceCount}${die}`, actor);
    await roll.evaluate();
    if (turnKey && (readDocumentFlag(actor, "secondWindTurn") === turnKey
      || `${combat.id ?? ""}:${combat.round}:${combat.turn}` !== turnKey)) return false;
    const liveSpent = Math.max(0, Math.floor(toNumber(secondWind.system?.uses?.spent, 0)));
    if (liveSpent + safeDiceCount > maxUses) return false;
    const healed = Math.max(0, toNumber(roll.total, 0));
    const previousHp = actorHpValue(actor);
    const nextHp = Math.min(actorHpMax(actor), previousHp + healed);

    await updateRepairItem(secondWind, { "system.uses.spent": liveSpent + safeDiceCount });
    try {
      await actor.update({
        "system.attributes.hp.value": nextHp,
        ...(turnKey ? { [`flags.${MODULE_ID}.secondWindTurn`]: turnKey } : {})
      });
    }
    catch (error) {
      await updateRepairItem(secondWind, { "system.uses.spent": liveSpent });
      throw error;
    }
    await roll.toMessage?.({
      speaker: speakerForActor(actor),
      flavor: `Второе дыхание: ${safeDiceCount}${die}`
    });
    if (nextHp > previousHp) await this.#applyIronWillAfterHealing(actor);
    return true;
  }

  async #ensureSecondWindResource(actor, item, { restore = false, render = true } = {}) {
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
    const sourceMaximum = item?._source?.system?.uses?.max ?? uses.max;
    if (sourceMaximum !== fighterSecondWindUsesMax(FIGHTER_CLASS_IDENTIFIER)
      && String(uses.max ?? "") !== String(maxUses)) {
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
      await updateRepairItem(item, patch, render === false ? repairUpdateOptions() : {});
    }

    return maxUses;
  }

  async #repairClassAdvancementLinks(actor) {
    const classItems = collectionValues(actor?.items)
      .filter((item) => item?.type === "class")
      .map((item) => [item, this.#classIdentifier(item)])
      .filter(([, classIdentifier]) => REBREYA_CLASS_IDENTIFIERS.has(classIdentifier));
    if (!classItems.length) {
      return false;
    }

    const sourceAdvancementByClass = await this.#classAdvancementSources();
    if (!sourceAdvancementByClass.size) {
      return false;
    }

    let changed = false;
    for (const [item, classIdentifier] of classItems) {
      const sourceAdvancement = sourceAdvancementByClass.get(classIdentifier);
      if (!sourceAdvancement?.length) {
        continue;
      }

      const mergedAdvancement = mergeClassAdvancementData(item.system?.advancement, sourceAdvancement);
      if (
        !mergedAdvancement.length
        || JSON.stringify(advancementDataArray(item.system?.advancement)) === JSON.stringify(mergedAdvancement)
      ) {
        continue;
      }

      const patch = { "system.advancement": mergedAdvancement };
      await updateRepairItem(item, patch, repairUpdateOptions());
      changed = true;
    }

    return changed;
  }

  async #classAdvancementSources() {
    if (typeof this._options.resolveClassAdvancementSources === "function") {
      return this._options.resolveClassAdvancementSources();
    }

    this._classAdvancementSourcesPromise ??= this.#loadClassAdvancementSources();
    const sources = await this._classAdvancementSourcesPromise;
    if (!sources.size) {
      this._classAdvancementSourcesPromise = null;
    }
    return sources;
  }

  async #loadClassAdvancementSources() {
    const pack = game.packs?.get?.(REBREYA_CLASSES_PACK_ID) ?? null;
    if (!pack || typeof pack.getDocuments !== "function") {
      return new Map();
    }

    const documents = await pack.getDocuments();
    const advancementByClass = new Map();
    for (const document of collectionValues(documents)) {
      const classIdentifier = this.#classIdentifier(document);
      if (!REBREYA_CLASS_IDENTIFIERS.has(classIdentifier)) {
        continue;
      }

      const advancement = advancementDataArray(document.system?.advancement);
      if (advancement.length) {
        advancementByClass.set(classIdentifier, foundry.utils.deepClone(advancement));
      }
    }

    return advancementByClass;
  }

  #classIdentifier(item) {
    return cleanText(
      readDocumentFlag(item, "classIdentifier")
      ?? item?.system?.identifier
      ?? item?.identifier
    );
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

      await updateRepairItem(item, patch, repairUpdateOptions());
    }
  }

  async #repairStartingEquipmentContainerLinks(actor) {
    const items = collectionValues(actor?.items);
    if (!items.length) {
      return true;
    }

    const itemById = new Map(items.map((item) => [cleanText(item?.id), item]).filter(([id]) => id));
    const containerByGearId = new Map();
    for (const item of items) {
      if (item?.type !== "container") {
        continue;
      }

      const gearId = cleanText(readDocumentFlag(item, "gearId"));
      if (gearId && !containerByGearId.has(gearId)) {
        containerByGearId.set(gearId, item);
      }
    }

    for (const item of items) {
      const containerGearId = cleanText(readDocumentFlag(item, "containerGearId"));
      const containerContentGearId = cleanText(readDocumentFlag(item, "containerContentGearId"));
      if (!containerGearId || !containerContentGearId) {
        continue;
      }

      const currentContainerIds = documentReferenceIdentifiers(getProperty(item, "system.container"));
      if (!currentContainerIds.length) {
        continue;
      }

      if (currentContainerIds.some((currentContainerId) => itemById.has(currentContainerId))) {
        continue;
      }

      const containerId = cleanText(containerByGearId.get(containerGearId)?.id);
      if (!containerId || currentContainerIds.includes(containerId)) {
        continue;
      }

      const patch = { "system.container": containerId };
      await updateRepairItem(item, patch, repairUpdateOptions());
    }

    return true;
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
    if (effect?.active === false || effect?.disabled === true || effect?.duration?.expired === true || effect?.transfer === true) {
      return false;
    }
    if (readDocumentFlag(effect, "fighterAutomation")?.kind === "ironWillNextSave") {
      return true;
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

  async #confirmIronWillDisadvantage(actor, target) {
    if (typeof this._options.confirmIronWillDisadvantage === "function") {
      return this._options.confirmIronWillDisadvantage(actor, target);
    }
    if (!this.#canPrompt(actor)) return false;
    const DialogV2 = foundry.applications?.api?.DialogV2;
    return await DialogV2?.confirm?.({
      window: { title: "Железная воля" },
      content: `<p>Дать помеху на спасбросок цели «${escapeHtml(target.name)}»?</p>`
    }) === true;
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
          specialDuration: ["combatEnd"]
        },
        [MODULE_ID]: {
          managed: true,
          fighterAutomation: {
            kind: "ironWillNextSave",
            createdTurn: this.#combatTurnKey(game.combat)
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

  #isFighterStartingEquipmentPackageItem(item) {
    return isClassStartingEquipmentPackageSourceType(readDocumentFlag(item, "sourceType"))
      && !!cleanText(readDocumentFlag(item, "startingEquipmentPackageId"));
  }

  #hasNativeStartingEquipmentChoices(item) {
    return (Array.isArray(item?.system?.advancement) ? item.system.advancement : []).some((advancement) => {
      if (advancement?.type !== "ItemChoice") {
        return false;
      }

      const configuration = advancement.configuration ?? {};
      return configuration.type === null
        && Array.isArray(configuration.pool)
        && configuration.pool.length > 0;
    });
  }

  #startingEquipmentPromptChoices() {
    return {
      packages: getClassStartingEquipmentConfig(FIGHTER_CLASS_IDENTIFIER)?.getChoices() ?? []
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
      const options = choices.packages
        .map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`)
        .join("");

      const dialog = new Dialog({
        title: "Стартовое снаряжение воина",
        content: `
          <form>
            <div class="form-group">
              <label>Выберите вариант</label>
              <select data-fighter-starting-package>${options}</select>
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
                package: cleanText(root?.querySelector("[data-fighter-starting-package]")?.value)
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
      const uuid = entry.uuid || await this.#resolveStartingEquipmentGearUuid(entry.gearId);
      const data = await this.#resolveStartingEquipmentItemData(uuid, entry.quantity, selection);
      if (Array.isArray(data)) {
        itemData.push(...data);
      }
      else if (data) {
        itemData.push(data);
      }
    }

    return itemData;
  }

  async #expandStartingEquipmentPackageItem(item) {
    const actor = item?.actor ?? item?.parent ?? null;
    if (!(actor instanceof Actor) || !this.#canPrompt(actor)) {
      return true;
    }

    const packageId = cleanText(readDocumentFlag(item, "startingEquipmentPackageId"));
    const selection = {
      package: packageId,
      sourceType: cleanText(readDocumentFlag(item, "sourceType"))
    };
    const itemData = await this.#buildStartingEquipmentItemData(selection);
    if (itemData.length && typeof actor.createEmbeddedDocuments === "function") {
      await actor.createEmbeddedDocuments("Item", itemData, { keepId: true, renderSheet: false });
    }
    await this.#applyStartingEquipmentCurrency(actor, selection);

    if (typeof actor.deleteEmbeddedDocuments === "function" && item.id) {
      await actor.deleteEmbeddedDocuments("Item", [item.id], { renderSheet: false });
    }
    return true;
  }

  async #applyStartingEquipmentCurrency(actor, selection = {}) {
    const equipmentPackage = getClassStartingEquipmentPackage(
      selection.sourceType ?? getClassStartingEquipmentConfig(FIGHTER_CLASS_IDENTIFIER)?.sourceType,
      selection.package ?? selection.packageId ?? selection.id
    );
    const gp = Math.floor(toNumber(equipmentPackage?.currency?.gp, 0));
    if (!gp || typeof actor?.update !== "function") {
      return true;
    }

    const currentGp = toNumber(foundry.utils.getProperty(actor, "system.currency.gp"), 0);
    await actor.update({
      "system.currency.gp": currentGp + gp
    });
    return true;
  }

  #startingEquipmentEntries(selection = {}) {
    const equipmentPackage = getClassStartingEquipmentPackage(
      selection.sourceType ?? getClassStartingEquipmentConfig(FIGHTER_CLASS_IDENTIFIER)?.sourceType,
      selection.package ?? selection.packageId ?? selection.id
    );
    if (!equipmentPackage) {
      return [];
    }

    return equipmentPackage.items.map((entry) => ({
      gearId: cleanText(entry.gearId),
      uuid: cleanText(entry.uuid),
      quantity: Math.max(1, Math.floor(toNumber(entry.quantity, 1)))
    }));
  }

  async #resolveStartingEquipmentGearUuid(gearId) {
    const id = cleanText(gearId);
    if (!id) {
      return "";
    }

    if (typeof this._options.resolveStartingEquipmentGearUuid === "function") {
      return cleanText(await this._options.resolveStartingEquipmentGearUuid(id));
    }

    const pack = game.packs.get(FIGHTER_GEAR_PACK_ID);
    if (!pack) {
      return "";
    }

    const index = await pack.getIndex({
      fields: [`flags.${MODULE_ID}.gearId`]
    });
    const entry = Array.from(index ?? []).find((row) => (
      cleanText(foundry.utils.getProperty(row, `flags.${MODULE_ID}.gearId`)) === id
    ));
    const documentId = cleanText(entry?._id ?? entry?.id);
    return cleanText(entry?.uuid) || (documentId ? `Compendium.${pack.collection}.Item.${documentId}` : "");
  }

  #startingEquipmentItemContext(selection = {}) {
    const packageSourceType = cleanText(selection.sourceType)
      || getClassStartingEquipmentConfig(FIGHTER_CLASS_IDENTIFIER)?.sourceType
      || "";
    const config = getClassStartingEquipmentConfigBySourceType(packageSourceType);
    return {
      classIdentifier: config?.classIdentifier ?? FIGHTER_CLASS_IDENTIFIER,
      sourceType: packageSourceType.endsWith("Package")
        ? packageSourceType.slice(0, -"Package".length)
        : "fighterStartingEquipment"
    };
  }

  async #resolveStartingEquipmentItemData(uuid, quantity = 1, selection = {}) {
    const source = typeof this._options.resolveStartingEquipmentItem === "function"
      ? await this._options.resolveStartingEquipmentItem(uuid)
      : await globalThis.fromUuid?.(uuid);
    if (!source) {
      return null;
    }

    const contents = source.type === "container"
      ? await this.#resolveStartingEquipmentContainerContents(source)
      : [];
    const context = this.#startingEquipmentItemContext(selection);
    const data = this.#sourceToStartingEquipmentData(source, uuid, quantity, "", context);
    if (!contents.length) {
      return data;
    }

    data._id = createDocumentId();
    const contentData = contents
      .map((contentSource) => this.#sourceToStartingEquipmentData(
        contentSource,
        cleanText(contentSource?.uuid) || cleanText(foundry.utils.getProperty(contentSource, "flags.dnd5e.sourceId")),
        foundry.utils.getProperty(contentSource, "system.quantity") ?? 1,
        data._id,
        context
      ))
      .filter(Boolean);

    return [data, ...contentData];
  }

  async #resolveStartingEquipmentContainerContents(source) {
    try {
      return collectionValues(await source?.system?.contents);
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to read fighter starting equipment container contents.`, error);
      return [];
    }
  }

  #sourceToStartingEquipmentData(source, uuid, quantity = 1, containerId = "", context = {}) {
    if (!source) {
      return null;
    }

    const data = typeof source.toObject === "function"
      ? source.toObject()
      : foundry.utils.deepClone(source);
    delete data._id;
    delete data.id;
    if (data.system && typeof data.system === "object") {
      delete data.system.contents;
    }
    data.flags ??= {};
    foundry.utils.setProperty(data, "flags.dnd5e.sourceId", uuid);
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.sourceType`, cleanText(context.sourceType) || "fighterStartingEquipment");
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.classIdentifier`, cleanText(context.classIdentifier) || FIGHTER_CLASS_IDENTIFIER);
    foundry.utils.setProperty(data, "system.quantity", Math.max(1, Math.floor(toNumber(quantity, 1))));
    if (containerId) {
      foundry.utils.setProperty(data, "system.container", containerId);
    }
    return data;
  }

  async #promptSecondWindDice(actor, context) {
    if (typeof this._options.promptSecondWindDice === "function") {
      return this._options.promptSecondWindDice(actor, context);
    }

    if (context.ownerUserIds?.length) {
      const options = [];
      for (let value = context.min; value <= context.max; value += 1) {
        options.push({ value: String(value), label: `${value}${context.die}` });
      }
      const choice = await this.moduleApi.reactionQueueService.promptDecision({
        candidate: { actorUuid: actor.uuid, ownerUserIds: context.ownerUserIds },
        prompt: {
          title: "Железная воля",
          body: "Использовать «Второе дыхание» в начале хода?",
          acceptLabel: "Исцелиться",
          declineLabel: "Пропустить",
          fields: [{ name: "diceCount", type: "select", label: "Кости лечения", options }]
        }
      });
      return choice?.accepted ? Number(choice.diceCount) : null;
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

  async #promptFighterMultiattackChoice(actor, choices, progress = null) {
    if (typeof this._options.promptFighterMultiattackChoice === "function") {
      return this._options.promptFighterMultiattackChoice(actor, choices, {
        progress
      });
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

      const title = progress?.title?.("Воинская мультиатака")
        ?? "Воинская мультиатака";
      const progressHeader = progress?.header?.("Воинская мультиатака") ?? "";
      const dialog = new Dialog({
        title,
        content: `
          ${progressHeader}
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
