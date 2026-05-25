import { CLASS_FEATURES_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";

const EFFECT_MODE_OVERRIDE = 5;
const LAST_ATTACK_MAX_AGE_MS = 120000;
const BLOODIED_STATUS_IDS = new Set(["bloodied", "rebreya-bloodied"]);
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

  const featureId = itemFeatureId(item);
  if (featureId.includes("::fighterManeuver::")) {
    return true;
  }

  return readDocumentFlag(item, "automation")?.type === "fighterManeuver";
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

  applyMidiRollComplete(workflow) {
    const actor = workflow?.actor;
    if (!(actor instanceof Actor)) {
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
    const fighterAutomation = readDocumentFlag(activity, "fighterAutomation") ?? {};

    if (automation === "fighter-second-wind" || fighterAutomation?.kind === "secondWind") {
      await this.#useSecondWind(actor, activity?.item, fighterAutomation);
      return true;
    }

    if (automation === "fighter-dominance-maneuver" || fighterAutomation?.kind === "maneuver") {
      await this.#applyManeuver(actor, activity, fighterAutomation);
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

  async #applyManeuver(actor, activity, fighterAutomation = {}) {
    const lastAttack = this.#lastAttack(actor);
    const target = this.#resolveManeuverTarget(lastAttack);
    const item = activity?.item;

    if (target && fighterAutomation?.extraDamage?.formula) {
      await this.#applyDamage(target, fighterAutomation.extraDamage.formula, cleanText(lastAttack?.damageType), {
        sourceActor: actor,
        sourceItemUuid: item?.uuid,
        label: item?.name ?? activity?.name ?? "Воинский приём"
      });
    }

    if (target && fighterAutomation?.saveAbility && this.#hasIronWillNextSave(actor)) {
      await this.#applySaveDisadvantageEffect(target, fighterAutomation.saveAbility, actor);
      await this.#consumeIronWillNextSave(actor);
    }

    if (target && fighterAutomation?.status?.id) {
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

  #resolveManeuverTarget(lastAttack) {
    const storedTarget = lastAttack?.targets?.find((target) => target instanceof Actor);
    if (storedTarget) {
      return storedTarget;
    }

    return collectionValues(game.user?.targets)
      .map(resolveActorFromTarget)
      .find((actor) => actor instanceof Actor) ?? null;
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
      await this.moduleApi.combatStatusService.setStatus(actor, statusId, {
        active: true,
        ...(Object.hasOwn(status, "value") ? { value: status.value } : {}),
        durationRounds: Math.max(0, Math.floor(toNumber(status.durationRounds, 0))),
        sourceActor
      });
      return true;
    }

    return this.#createActorEffect(actor, {
      name: statusId,
      type: "base",
      img: "icons/svg/aura.svg",
      system: {},
      changes: [],
      disabled: false,
      duration: {
        rounds: Math.max(0, Math.floor(toNumber(status.durationRounds, 0)))
      },
      transfer: false,
      statuses: [statusId],
      flags: {
        core: {
          statusId
        },
        [MODULE_ID]: {
          managed: true,
          fighterAutomation: {
            kind: "maneuverStatus"
          }
        }
      }
    });
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
}
