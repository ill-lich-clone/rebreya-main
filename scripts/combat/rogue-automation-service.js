import { MODULE_ID } from "../constants.js";

const ROGUE_CLASS_IDENTIFIER = "rogue-rework-v00";
const SNEAK_ATTACK_FEATURE_ID = "rogue-sneak-attack";
const CUNNING_STRIKE_SOURCE_TYPE = "rogueCunningStrike";
const EFFECT_MODE_CUSTOM = globalThis.CONST?.ACTIVE_EFFECT_MODES?.CUSTOM ?? 0;
const EFFECT_MODE_ADD = globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
const MOVEMENT_SPEED_KEYS = Object.freeze([
  "system.attributes.movement.walk",
  "system.attributes.movement.burrow",
  "system.attributes.movement.climb",
  "system.attributes.movement.fly",
  "system.attributes.movement.swim"
]);
const CUNNING_STRIKE_TEXT = Object.freeze({
  manualNote: "\u042d\u0442\u043e\u0442 \u0432\u0430\u0440\u0438\u0430\u043d\u0442 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0440\u0443\u0447\u043d\u043e\u0439 \u043e\u0442\u0440\u0430\u0431\u043e\u0442\u043a\u0438.",
  manualSaveNote: "\u0421\u043f\u0430\u0441\u0431\u0440\u043e\u0441\u043e\u043a \u0446\u0435\u043b\u0438 \u043d\u0443\u0436\u043d\u043e \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0432\u0440\u0443\u0447\u043d\u0443\u044e.",
  saveSuccessNote: "\u0421\u043f\u0430\u0441\u0431\u0440\u043e\u0441\u043e\u043a \u0443\u0441\u043f\u0435\u0448\u0435\u043d: \u044d\u0444\u0444\u0435\u043a\u0442 \u043d\u0435 \u043f\u0440\u0438\u043c\u0435\u043d\u0435\u043d.",
  cardOnlyNote: "\u0412\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u0432\u0430\u0440\u0438\u0430\u043d\u0442 \u0437\u0430\u043f\u0438\u0441\u0430\u043d \u0432 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0443 \u0430\u0442\u0430\u043a\u0438.",
  cunningStrike: "\u0425\u0438\u0442\u0440\u044b\u0439 \u0443\u0434\u0430\u0440",
  save: "\u0421\u043f\u0430\u0441\u0431\u0440\u043e\u0441\u043e\u043a",
  dc: "\u0421\u043b",
  success: "\u0443\u0441\u043f\u0435\u0445",
  failure: "\u043f\u0440\u043e\u0432\u0430\u043b",
  unchecked: "\u043d\u0435 \u043f\u0440\u043e\u0432\u0435\u0440\u0435\u043d",
  effect: "\u042d\u0444\u0444\u0435\u043a\u0442",
  note: "\u0417\u0430\u043c\u0435\u0442\u043a\u0430",
  die: "\u043a6",
  speed: "\u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c",
  feet: "\u0444\u0442.",
  nextAttackDisadvantage: "\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0430\u044f \u0430\u0442\u0430\u043a\u0430 \u0441 \u043f\u043e\u043c\u0435\u0445\u043e\u0439"
});
const CUNNING_STRIKE_AUTOMATION = Object.freeze({
  "rogue-cunning-strike-hamstring": {
    effect: {
      kind: "speedPenalty",
      amount: -10,
      durationRounds: 1,
      expires: "sourceTurnStart"
    }
  },
  "rogue-cunning-strike-open-position": {
    status: {
      id: "rebreya-open-position",
      durationRounds: 1,
      expires: "sourceTurnStart"
    }
  },
  "rogue-cunning-strike-disrupt-aim": {
    effect: {
      kind: "nextAttackDisadvantage",
      durationRounds: 1,
      specialDuration: ["1Attack", "turnStartSource", "combatEnd"]
    }
  },
  "rogue-cunning-strike-trip": {
    saveAbility: "dex",
    failureStatus: {
      id: "prone",
      durationRounds: 1,
      expires: "targetTurnEnd"
    }
  },
  "rogue-cunning-strike-stun": {
    saveAbility: "con",
    failureStatus: {
      id: "rebreya-entangled-mind",
      durationRounds: 1,
      expires: "targetTurnEnd"
    }
  },
  "rogue-cunning-strike-break-tempo": {
    saveAbility: "con",
    successStatus: {
      id: "rebreya-frostbitten",
      value: 1,
      durationRounds: 1,
      expires: "targetTurnEnd"
    },
    failureStatus: {
      id: "rebreya-frostbitten",
      value: 2,
      durationRounds: 1,
      expires: "targetTurnEnd"
    }
  },
  "rogue-cunning-strike-blind": {
    saveAbility: "dex",
    failureStatus: {
      id: "blinded",
      durationRounds: 1,
      expires: "targetTurnEnd"
    }
  }
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

function speakerForActor(actor) {
  if (typeof globalThis.ChatMessage?.getSpeaker === "function") {
    return globalThis.ChatMessage.getSpeaker({ actor });
  }

  return {
    actor: cleanText(actor?.id),
    alias: cleanText(actor?.name)
  };
}

function plainText(value) {
  return cleanText(String(value ?? "")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/\s+/gu, " "));
}

function itemFlag(item, scope, key) {
  if (typeof item?.getFlag === "function") {
    return item.getFlag(scope, key);
  }

  return getProperty(item, `flags.${scope}.${key}`, undefined);
}

function rawFeatureId(featureId) {
  return cleanText(featureId).split("::").pop() ?? "";
}

function itemFeatureId(item) {
  return cleanText(itemFlag(item, MODULE_ID, "featureId"));
}

function featureIdMatches(item, rawId) {
  const featureId = itemFeatureId(item);
  return featureId === rawId || rawFeatureId(featureId) === rawId;
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

function isWeaponAttackWorkflow(workflow) {
  const activity = workflow?.activity;
  const item = activity?.item ?? workflow?.item;
  if (item?.type !== "weapon") {
    return false;
  }

  const activityType = cleanText(activity?.type);
  return !activityType || activityType === "attack";
}

function defaultDamageTypeFromWorkflow(workflow) {
  const detail = Array.isArray(workflow?.damageDetail) ? workflow.damageDetail : [];
  const detailedType = detail.map((row) => cleanText(row?.type)).find(Boolean);
  if (detailedType) {
    return detailedType;
  }

  const item = workflow?.activity?.item ?? workflow?.item;
  const itemType = cleanText(item?.system?.damage?.base?.types?.[0]);
  if (itemType) {
    return itemType;
  }

  return cleanText(workflow?.defaultDamageType);
}

function rogueClassLevel(actor) {
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
      if (text !== ROGUE_CLASS_IDENTIFIER && !text.includes("rogue") && !text.includes("плут")) {
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
    if (text !== ROGUE_CLASS_IDENTIFIER && !text.includes("rogue") && !text.includes("плут")) {
      continue;
    }

    const levels = toNumber(item?.system?.levels ?? item?.system?.level ?? item?.system?.advancement?.level, 0);
    if (levels > 0) {
      return Math.floor(levels);
    }
  }

  return 0;
}

function sneakAttackDiceCount(actor) {
  const scale = getProperty(actor, `system.scale.${ROGUE_CLASS_IDENTIFIER}.sneak-attack`, null);
  const number = Math.floor(toNumber(scale?.number, 0));
  const faces = Math.floor(toNumber(scale?.faces, 0));
  if (number > 0 && faces === 6) {
    return number;
  }

  const stringMatch = cleanText(scale?.value ?? scale).match(/^(\d+)d6$/iu);
  if (stringMatch) {
    return Math.max(1, Math.floor(toNumber(stringMatch[1], 1)));
  }

  const rogueLevel = Math.max(1, rogueClassLevel(actor));
  return Math.min(10, Math.max(1, Math.ceil(rogueLevel / 2)));
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
    "sneak-attack"
  ].join(":");
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

function escapeHtml(value) {
  return foundry.utils.escapeHTML(cleanText(value));
}

function selectedCunningStrikeId(choice) {
  return cleanText(
    choice?.cunningStrikeId
    ?? choice?.cunningStrikeFeatureId
    ?? choice?.variantId
    ?? choice?.cunningStrike
  );
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

export class RogueAutomationService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this._sneakAttackTurnUses = new Set();
    this._options = options;
  }

  async initialize() {
    return true;
  }

  async applyMidiPreDamageRoll(workflow, activity, config = {}, _dialog = null, message = null) {
    if (workflow && activity && !workflow.activity) {
      workflow.activity = activity;
    }

    const actor = workflow?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const sneakAttackFeature = this.#findSneakAttack(actor);
    if ((!sneakAttackFeature && !this.#hasRogueSneakAttack(actor)) || !isWeaponAttackWorkflow(workflow)) {
      return true;
    }

    const targets = targetActorsFromWorkflow(workflow);
    if (!targets.length) {
      return true;
    }

    const turnKey = combatTurnKey(actor, workflow);
    if (turnKey && this._sneakAttackTurnUses.has(turnKey)) {
      return true;
    }

    const diceCount = sneakAttackDiceCount(actor);
    const damageType = defaultDamageTypeFromWorkflow(workflow);
    const weapon = workflow?.activity?.item ?? workflow?.item ?? null;
    const details = {
      formula: damageDiceFormula(diceCount, 6),
      diceCount,
      damageType,
      weapon: {
        uuid: cleanText(weapon?.uuid),
        id: cleanText(weapon?.id),
        name: cleanText(weapon?.name, "Оружие"),
        actionType: cleanText(workflow?.activity?.actionType ?? weapon?.system?.actionType)
      },
      targets: targets.map((target) => ({
        uuid: cleanText(target.uuid ?? target.id),
        name: cleanText(target.name, "Цель")
      })),
      cunningStrikes: this.#cunningStrikeOptions(actor, diceCount)
    };
    const choice = await this.#promptSneakAttack(actor, details);
    if (!choice) {
      return true;
    }

    const chosenTarget = this.#chosenTarget(targets, choice) ?? targets[0];
    if (!(chosenTarget instanceof Actor)) {
      return true;
    }

    const selectedStrike = this.#chosenCunningStrike(details.cunningStrikes, choice);
    const remainingDice = Math.max(0, diceCount - Math.floor(toNumber(selectedStrike?.cost, 0)));
    const label = this.#sneakAttackLabel(selectedStrike);
    if (remainingDice > 0) {
      if (!appendDamageRollConfig(config, workflow, actor, damageDiceFormula(remainingDice, 6), damageType, label)) {
        return true;
      }
    }

    if (selectedStrike) {
      let outcome = null;
      try {
        outcome = await this.#applyCunningStrikeAutomation(actor, chosenTarget, selectedStrike);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply rogue Cunning Strike automation.`, error);
        outcome = {
          notes: ["Не удалось применить автоматизацию Хитрого удара."]
        };
      }
      this.#recordCunningStrikeOnWorkflow(workflow, selectedStrike, outcome);
      try {
        await this.#postCunningStrikeCardInfo(workflow, message, selectedStrike, outcome);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to append rogue Cunning Strike card info.`, error);
      }
    }

    if (turnKey) {
      this._sneakAttackTurnUses.add(turnKey);
    }
    return true;
  }

  async applyMidiRollComplete() {
    return true;
  }

  #findSneakAttack(actor) {
    return findActorFeature(actor, SNEAK_ATTACK_FEATURE_ID, "скрытая атака");
  }

  #hasRogueSneakAttack(actor) {
    if (rogueClassLevel(actor) > 0) {
      return true;
    }

    return getProperty(actor, `system.scale.${ROGUE_CLASS_IDENTIFIER}.sneak-attack`, null) !== null;
  }

  #cunningStrikeOptions(actor, diceCount) {
    const options = [];
    const seen = new Set();
    for (const item of collectionValues(actor?.items)) {
      const sourceType = cleanText(itemFlag(item, MODULE_ID, "sourceType"));
      if (sourceType !== CUNNING_STRIKE_SOURCE_TYPE) {
        continue;
      }

      const id = rawFeatureId(itemFeatureId(item)) || cleanText(item?.id);
      const cost = Math.max(0, Math.floor(toNumber(itemFlag(item, MODULE_ID, "cunningStrikeCost"), 0)));
      if (!id || cost > diceCount || seen.has(id)) {
        continue;
      }

      seen.add(id);
      options.push({
        id,
        name: cleanText(item?.name, "Хитрый удар"),
        cost,
        itemUuid: cleanText(item?.uuid),
        description: cleanText(item?.system?.description?.value ?? item?.system?.description?.chat)
      });
    }
    return options;
  }

  #chosenTarget(targets, choice) {
    const targetUuid = cleanText(choice?.targetUuid);
    if (!targetUuid) {
      return targets[0] ?? null;
    }

    return targets.find((target) => cleanText(target?.uuid ?? target?.id) === targetUuid) ?? null;
  }

  #chosenCunningStrike(options, choice) {
    const id = selectedCunningStrikeId(choice);
    if (!id) {
      return null;
    }

    return options.find((option) => option.id === id) ?? null;
  }

  #sneakAttackLabel(selectedStrike) {
    const suffix = selectedStrike?.name ? `: ${selectedStrike.name}` : "";
    return `Скрытая атака${suffix}`;
  }

  async #applyCunningStrikeAutomation(sourceActor, target, selectedStrike) {
    const automation = CUNNING_STRIKE_AUTOMATION[selectedStrike?.id] ?? null;
    const outcome = {
      id: cleanText(selectedStrike?.id),
      name: cleanText(selectedStrike?.name),
      cost: Math.max(0, Math.floor(toNumber(selectedStrike?.cost, 0))),
      description: plainText(selectedStrike?.description),
      applied: [],
      notes: []
    };

    if (!automation) {
      outcome.notes.push(CUNNING_STRIKE_TEXT.manualNote);
      return outcome;
    }

    let save = null;
    if (automation.saveAbility) {
      save = await this.#rollCunningStrikeSave(target, automation.saveAbility, sourceActor, selectedStrike);
      outcome.save = save;
      if (save.success === null) {
        outcome.notes.push(CUNNING_STRIKE_TEXT.manualSaveNote);
        return outcome;
      }
    }

    if (automation.effect && !automation.saveAbility) {
      const label = await this.#applyCunningStrikeEffect(target, automation.effect, sourceActor, selectedStrike);
      if (label) {
        outcome.applied.push(label);
      }
    }

    if (automation.status && !automation.saveAbility) {
      const label = await this.#applyCunningStrikeStatus(target, automation.status, sourceActor, selectedStrike);
      if (label) {
        outcome.applied.push(label);
      }
    }

    if (save?.success === false && automation.failureStatus) {
      const label = await this.#applyCunningStrikeStatus(target, automation.failureStatus, sourceActor, selectedStrike);
      if (label) {
        outcome.applied.push(label);
      }
    }

    if (save?.success === true && automation.successStatus) {
      const label = await this.#applyCunningStrikeStatus(target, automation.successStatus, sourceActor, selectedStrike);
      if (label) {
        outcome.applied.push(label);
      }
    }

    if (save?.success === true && !automation.successStatus) {
      outcome.notes.push(CUNNING_STRIKE_TEXT.saveSuccessNote);
    }

    if (!outcome.applied.length && !outcome.notes.length) {
      outcome.notes.push(CUNNING_STRIKE_TEXT.cardOnlyNote);
    }

    return outcome;
  }

  #cunningStrikeSaveDc(actor) {
    const proficiency = toNumber(getProperty(actor, "system.attributes.prof", 2), 2);
    const dexterity = toNumber(getProperty(actor, "system.abilities.dex.mod", 0), 0);
    return 8 + proficiency + dexterity;
  }

  async #rollCunningStrikeSave(target, ability, sourceActor, selectedStrike) {
    const abilityKey = cleanText(ability, "dex").toLowerCase();
    const dc = this.#cunningStrikeSaveDc(sourceActor);
    if (typeof target?.rollSavingThrow !== "function") {
      return {
        ability: abilityKey,
        dc,
        total: null,
        success: null
      };
    }

    const rolls = await target.rollSavingThrow({
      ability: abilityKey,
      target: dc
    }, {}, {
      data: {
        speaker: speakerForActor(target),
        flavor: `${cleanText(selectedStrike?.name, CUNNING_STRIKE_TEXT.cunningStrike)}: ${CUNNING_STRIKE_TEXT.save.toLowerCase()} ${abilityKey.toUpperCase()} ${CUNNING_STRIKE_TEXT.dc} ${dc}`
      }
    });
    const roll = Array.isArray(rolls) ? rolls[0] : rolls;
    const total = Number(roll?.total);
    return {
      ability: abilityKey,
      dc,
      total: Number.isFinite(total) ? total : null,
      success: Number.isFinite(total) ? total >= dc : null
    };
  }

  async #applyCunningStrikeEffect(target, effect, sourceActor, selectedStrike) {
    const effectData = this.#cunningStrikeEffectData(effect, sourceActor, selectedStrike);
    if (!effectData) {
      return "";
    }

    const applied = await this.#createActorEffect(target, effectData);
    return applied ? this.#cunningStrikeEffectLabel(effect) : "";
  }

  #cunningStrikeEffectData(effect = {}, sourceActor, selectedStrike) {
    const specialDuration = this.#cunningStrikeSpecialDuration(effect);
    const base = {
      name: `${CUNNING_STRIKE_TEXT.cunningStrike}: ${cleanText(selectedStrike?.name, cleanText(effect.kind, "effect"))}`,
      type: "base",
      img: "icons/svg/target.svg",
      system: {},
      changes: [],
      disabled: false,
      duration: this.#cunningStrikeDuration(effect),
      origin: cleanText(sourceActor?.uuid) || null,
      transfer: false,
      statuses: [],
      flags: {
        ...(specialDuration.length ? {
          dae: {
            specialDuration
          }
        } : {}),
        [MODULE_ID]: {
          managed: true,
          rogueAutomation: {
            kind: "cunningStrikeEffect",
            strikeId: cleanText(selectedStrike?.id),
            sourceActorUuid: cleanText(sourceActor?.uuid),
            expires: cleanText(effect.expires)
          }
        }
      }
    };

    if (effect.kind === "speedPenalty") {
      const amount = Math.floor(toNumber(effect.amount, -10));
      return {
        ...base,
        img: "icons/svg/daze.svg",
        changes: MOVEMENT_SPEED_KEYS.map((key) => ({
          key,
          mode: EFFECT_MODE_ADD,
          value: String(amount),
          priority: 20
        }))
      };
    }

    if (effect.kind === "nextAttackDisadvantage") {
      return {
        ...base,
        img: "icons/svg/downgrade.svg",
        changes: [{
          key: "flags.midi-qol.disadvantage.attack.all",
          mode: EFFECT_MODE_CUSTOM,
          value: "1",
          priority: 20
        }]
      };
    }

    return null;
  }

  #cunningStrikeEffectLabel(effect = {}) {
    if (effect.kind === "speedPenalty") {
      return `${CUNNING_STRIKE_TEXT.speed} ${Math.floor(toNumber(effect.amount, -10))} ${CUNNING_STRIKE_TEXT.feet}`;
    }

    if (effect.kind === "nextAttackDisadvantage") {
      return CUNNING_STRIKE_TEXT.nextAttackDisadvantage;
    }

    return cleanText(effect.kind);
  }

  async #applyCunningStrikeStatus(target, status, sourceActor, selectedStrike) {
    const applied = await this.#setCunningStrikeStatus(target, status, sourceActor, selectedStrike);
    return applied ? this.#cunningStrikeStatusLabel(status) : "";
  }

  async #setCunningStrikeStatus(actor, status = {}, sourceActor, selectedStrike) {
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
      await this.#patchCunningStrikeStatusEffect(effect, status, sourceActor, selectedStrike);
      return true;
    }

    const specialDuration = this.#cunningStrikeSpecialDuration(status);
    return this.#createActorEffect(actor, {
      name: statusId,
      type: "base",
      img: "icons/svg/aura.svg",
      system: {},
      changes: [],
      disabled: false,
      duration: this.#cunningStrikeDuration(status),
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
          rogueAutomation: {
            kind: "cunningStrikeStatus",
            strikeId: cleanText(selectedStrike?.id),
            sourceActorUuid: cleanText(sourceActor?.uuid),
            expires: cleanText(status.expires)
          }
        }
      }
    });
  }

  #cunningStrikeStatusLabel(status = {}) {
    const value = Object.hasOwn(status, "value") ? ` ${status.value}` : "";
    return `${cleanText(status.id)}${value}`;
  }

  #cunningStrikeSpecialDuration(entry = {}) {
    if (Array.isArray(entry.specialDuration)) {
      return entry.specialDuration.map((value) => cleanText(value)).filter(Boolean);
    }

    const expires = cleanText(entry.expires);
    if (expires === "sourceTurnEnd" || expires === "sourceNextTurnEnd") {
      return ["turnEndSource", "combatEnd"];
    }

    if (expires === "sourceTurnStart" || expires === "sourceNextTurnStart") {
      return ["turnStartSource", "combatEnd"];
    }

    if (expires === "targetTurnEnd" || expires === "targetNextTurnEnd") {
      return ["turnEnd", "combatEnd"];
    }

    if (expires === "targetTurnStart" || expires === "targetNextTurnStart") {
      return ["turnStart", "combatEnd"];
    }

    return [];
  }

  #cunningStrikeDuration(entry = {}) {
    return {
      startTime: null,
      seconds: null,
      combat: null,
      rounds: Math.max(0, Math.floor(toNumber(entry.durationRounds, 0))),
      turns: null,
      startRound: globalThis.game?.combat?.round ?? null,
      startTurn: globalThis.game?.combat?.turn ?? null
    };
  }

  async #patchCunningStrikeStatusEffect(effect, status = {}, sourceActor, selectedStrike) {
    if (!effect || typeof effect.update !== "function") {
      return false;
    }

    const specialDuration = this.#cunningStrikeSpecialDuration(status);
    const patch = {
      duration: this.#cunningStrikeDuration(status),
      origin: cleanText(sourceActor?.uuid) || null,
      [`flags.${MODULE_ID}.managed`]: true,
      [`flags.${MODULE_ID}.rogueAutomation.kind`]: "cunningStrikeStatus",
      [`flags.${MODULE_ID}.rogueAutomation.strikeId`]: cleanText(selectedStrike?.id),
      [`flags.${MODULE_ID}.rogueAutomation.sourceActorUuid`]: cleanText(sourceActor?.uuid),
      [`flags.${MODULE_ID}.rogueAutomation.expires`]: cleanText(status.expires)
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

  #recordCunningStrikeOnWorkflow(workflow, selectedStrike, outcome) {
    if (!workflow) {
      return false;
    }

    workflow.rebreyaCunningStrike = {
      id: cleanText(selectedStrike?.id),
      name: cleanText(selectedStrike?.name),
      cost: Math.max(0, Math.floor(toNumber(selectedStrike?.cost, 0))),
      description: plainText(selectedStrike?.description),
      outcome: foundry.utils.deepClone(outcome ?? {})
    };
    return true;
  }

  async #resolveCunningStrikeCardMessage(workflow, message) {
    if (message && typeof message.update === "function") {
      return message;
    }

    const uuid = cleanText(
      workflow?.itemCardUuid
      ?? workflow?.itemCard?.uuid
      ?? workflow?.chatCardUuid
      ?? message?.workflow?.itemCardUuid
      ?? message?.workflow?.itemCard?.uuid
    );
    if (uuid && typeof globalThis.fromUuid === "function") {
      const cardMessage = await globalThis.fromUuid(uuid);
      if (cardMessage && typeof cardMessage.update === "function") {
        return cardMessage;
      }
    }

    const id = cleanText(workflow?.itemCardId ?? workflow?.id ?? message?.workflow?.itemCardId ?? message?.workflow?.id);
    const cardMessage = id ? globalThis.game?.messages?.get?.(id) : null;
    return cardMessage && typeof cardMessage.update === "function" ? cardMessage : null;
  }

  async #postCunningStrikeCardInfo(workflow, message, selectedStrike, outcome) {
    const cardMessage = await this.#resolveCunningStrikeCardMessage(workflow, message);
    if (!cardMessage) {
      return false;
    }

    const strikeId = cleanText(selectedStrike?.id);
    if (!strikeId) {
      return false;
    }

    const currentContent = String(cardMessage.content ?? "");
    const marker = `data-rebreya-cunning-strike="${escapeHtml(strikeId)}"`;
    if (currentContent.includes(marker)) {
      return false;
    }

    await cardMessage.update({
      content: `${currentContent}${this.#cunningStrikeCardBlock(selectedStrike, outcome)}`
    });
    return true;
  }

  #cunningStrikeCardBlock(selectedStrike, outcome = {}) {
    const description = plainText(selectedStrike?.description);
    const applied = Array.isArray(outcome?.applied) ? outcome.applied.map((entry) => cleanText(entry)).filter(Boolean) : [];
    const notes = Array.isArray(outcome?.notes) ? outcome.notes.map((entry) => cleanText(entry)).filter(Boolean) : [];
    const save = outcome?.save ?? null;
    const saveText = save
      ? `<div><strong>${CUNNING_STRIKE_TEXT.save}:</strong> ${escapeHtml(String(save.ability ?? "").toUpperCase())} ${CUNNING_STRIKE_TEXT.dc} ${escapeHtml(save.dc)}${save.total !== null && save.total !== undefined ? `, ${escapeHtml(save.total)}` : ""} (${save.success === true ? CUNNING_STRIKE_TEXT.success : save.success === false ? CUNNING_STRIKE_TEXT.failure : CUNNING_STRIKE_TEXT.unchecked})</div>`
      : "";
    return `
      <section class="rebreya-cunning-strike" data-rebreya-cunning-strike="${escapeHtml(selectedStrike?.id)}" style="margin-top: 0.5rem;">
        <hr>
        <div><strong>${CUNNING_STRIKE_TEXT.cunningStrike}:</strong> ${escapeHtml(selectedStrike?.name)} (-${escapeHtml(selectedStrike?.cost)}${CUNNING_STRIKE_TEXT.die})</div>
        ${description ? `<div>${escapeHtml(description)}</div>` : ""}
        ${saveText}
        ${applied.length ? `<div><strong>${CUNNING_STRIKE_TEXT.effect}:</strong> ${escapeHtml(applied.join(", "))}</div>` : ""}
        ${notes.length ? `<div><strong>${CUNNING_STRIKE_TEXT.note}:</strong> ${escapeHtml(notes.join(" "))}</div>` : ""}
      </section>
    `;
  }

  async #promptSneakAttack(actor, details) {
    if (typeof this._options.promptSneakAttack === "function") {
      const choice = await this._options.promptSneakAttack(actor, details);
      return choice ? { ...choice, actor } : null;
    }

    if (!this.#canPrompt(actor)) {
      return null;
    }

    const targetOptions = details.targets.map((target) => (
      `<option value="${escapeHtml(target.uuid)}">${escapeHtml(target.name)}</option>`
    )).join("");
    const strikeOptions = [
      `<option value="">Без Хитрого удара</option>`,
      ...details.cunningStrikes.map((strike) => (
        `<option value="${escapeHtml(strike.id)}">${escapeHtml(strike.name)} (-${escapeHtml(strike.cost)}к6)</option>`
      ))
    ].join("");

    const content = `
      <form>
        <p>Попадание оружием: <strong>${escapeHtml(details.weapon.name)}</strong>. Использовать Скрытую атаку?</p>
        <p>Урон: ${escapeHtml(details.formula)} ${details.damageType ? `(${escapeHtml(details.damageType)})` : ""}</p>
        ${details.targets.length > 1 ? `
          <div class="form-group">
            <label>Цель</label>
            <select name="targetUuid" data-sneak-attack-target>${targetOptions}</select>
          </div>
        ` : ""}
        <div class="form-group">
          <label>Хитрый удар</label>
          <select name="cunningStrikeId" data-sneak-attack-cunning-strike>${strikeOptions}</select>
        </div>
      </form>
    `;

    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof DialogV2?.input !== "function") {
      return null;
    }

    const choice = await DialogV2.input({
      window: { title: "Скрытая атака" },
      content,
      ok: {
        label: "Скрытая атака",
        callback: (_event, button) => {
          const root = getDialogButtonForm(button);
          const targetUuid = cleanText(root?.querySelector?.("[data-sneak-attack-target]")?.value);
          const cunningStrikeId = cleanText(root?.querySelector?.("[data-sneak-attack-cunning-strike]")?.value);
          return { targetUuid, cunningStrikeId, actor };
        }
      },
      rejectClose: false,
      modal: true
    });
    return choice ? { ...choice, actor } : null;
  }

  #canPrompt(actor) {
    return Boolean(game.user?.isGM || actor?.isOwner);
  }
}
