import { MODULE_ID } from "../constants.js";
import { whirlwindEffectTargets, isWhirlwindActivity, markWhirlwindDamageRolls, markDamageRollTarget } from "./whirlwind-attack.js?v=1.5.70";
import { getCreatureTokenFootprint } from "../data/equipment-size-rules.js?v=1.4.393";
import { isRuneKnightEffectActive } from "../data/rune-knight-automation.js?v=1.5.70";
import { isCombatActorActive } from "./turn-group-rules.js?v=1.5.66";
import { FIRE_RUNE_COMMAND, reserveClassCombatOperation, resolveClassCombatHit } from "../infrastructure/foundry/class-combat-command.js?v=1.5.70";
import { getActiveGm } from "../infrastructure/foundry/active-gm.js";
import { cardHitEvidence, usageCardData } from "../integrations/midi-usage-card.js";

const FIGHTER_CLASS_IDENTIFIER = "fighter-rework-v028";
const EFFECT_MODE_ADD = 2;
const EFFECT_MODE_CUSTOM = 0;
const EFFECT_MODE_OVERRIDE = 5;
const STONE_REACTION_KIND = "rune-stone";
const STONE_PROVIDER_ID = "rune-knight-stone";
const STONE_RANGE_FEET = 30;
const CLOUD_REACTION_KIND = "rune-cloud";
const CLOUD_PROVIDER_ID = "rune-knight-cloud";
const CLOUD_RANGE_FEET = 30;
const RUNIC_SHIELD_REACTION_KIND = "runic-shield";
const RUNIC_SHIELD_PROVIDER_ID = "rune-knight-runic-shield";
const RUNIC_SHIELD_RANGE_FEET = 60;
const STORM_REACTION_KIND = "rune-storm";
const STORM_PROVIDER_ID = "rune-knight-storm";
const STORM_RANGE_FEET = 60;
const STORM_ROLL_TYPES = new Set(["attack", "save", "check"]);
const FIGHTER_DOMINANCE_IDENTIFIER = "fighter-dominance";
const GIANT_MIGHT_FORM_AUTOMATION = "giant-might-form";
const GIANT_MIGHT_DAMAGE_FORMULA = "1d6";
const SIZE_ORDER = Object.freeze(["tiny", "sm", "med", "lg", "huge", "grg"]);
const MAX_WORKFLOW_STATES = 128;
const MOVEMENT_PATHS = Object.freeze([
  "walk",
  "fly",
  "swim",
  "climb",
  "burrow"
]);
const RUNE_IDS = new Set(["stone", "frost", "cloud", "fire", "hill", "storm"]);
const SELF_ACTIVATION_IDS = new Set(["frost", "hill", "storm"]);
const RUNE_RECOVERY = Object.freeze([
  Object.freeze({ period: "sr", type: "recoverAll", formula: "" }),
  Object.freeze({ period: "lr", type: "recoverAll", formula: "" })
]);
const LONG_REST_RECOVERY = Object.freeze([
  Object.freeze({ period: "lr", type: "recoverAll", formula: "" })
]);
const MIGRATION_AUTOMATION_BY_NAME = new Map([
  ["каменная руна", "stone"],
  ["ледяная руна", "frost"],
  ["облачная руна", "cloud"],
  ["огненная руна", "fire"],
  ["холмовая руна", "hill"],
  ["штормовая руна", "storm"],
  ["мощь великана", "giant-might"],
  ["рунический щит", "runic-shield"],
  ["великанский рост", "great-stature"],
  ["великий рост", "great-stature"],
  ["мастер рун", "master-of-runes"],
  ["рунический исполин", "runic-juggernaut"],
  ["рунический джаггернаут", "runic-juggernaut"]
]);

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function escapeHtml(value) {
  return cleanText(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function numberValue(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

function getProperty(source, path) {
  if (typeof globalThis.foundry?.utils?.getProperty === "function") {
    return globalThis.foundry.utils.getProperty(source, path);
  }
  return String(path ?? "").split(".").reduce((value, key) => value?.[key], source);
}

function setProperty(source, path, value) {
  if (typeof globalThis.foundry?.utils?.setProperty === "function") {
    globalThis.foundry.utils.setProperty(source, path, value);
    return;
  }

  const keys = String(path ?? "").split(".");
  const finalKey = keys.pop();
  let target = source;
  for (const key of keys) {
    target[key] ??= {};
    target = target[key];
  }
  target[finalKey] = value;
}

function clone(value) {
  if (typeof globalThis.foundry?.utils?.deepClone === "function") {
    return globalThis.foundry.utils.deepClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function isActorDocument(actor) {
  return Boolean(actor && typeof actor === "object" && (actor.uuid || actor.id || actor._id));
}

function actorFromEmbeddedDocument(document) {
  const parent = document?.actor ?? document?.parent ?? null;
  if (!parent || parent === document) return null;
  if (isActorDocument(parent)) return parent;
  return isActorDocument(parent?.actor) ? parent.actor : null;
}

function actorKey(actor) {
  return cleanText(actor?.uuid ?? actor?.id ?? actor?._id);
}

function documentId(document) {
  return cleanText(document?.id ?? document?._id);
}

function documentUuid(document) {
  return cleanText(document?.uuid ?? document?.document?.uuid);
}

function tokenActor(token) {
  return token?.actor ?? token?.document?.actor ?? null;
}

function tokensHaveOpposingDisposition(leftToken, rightToken) {
  const left = Math.sign(numberValue(leftToken?.document?.disposition ?? leftToken?.disposition, 0));
  const right = Math.sign(numberValue(rightToken?.document?.disposition ?? rightToken?.disposition, 0));
  return left !== 0 && right !== 0 && left !== right;
}

function tokenCenter(token) {
  const target = token?.object ?? token;
  if (target?.center && Number.isFinite(Number(target.center.x)) && Number.isFinite(Number(target.center.y))) {
    return target.center;
  }
  if (Number.isFinite(Number(target?.x)) && Number.isFinite(Number(target?.y))) {
    return { x: Number(target.x), y: Number(target.y) };
  }
  return null;
}

function firstActivityId(item) {
  return documentId(collectionValues(item?.system?.activities)[0]);
}

function workflowHitTargets(workflow) {
  return [...new Set([...collectionValues(workflow?.hitTargets), ...collectionValues(workflow?.hitTargetsEC)])];
}

function hitTargetFields(tokens) {
  return tokens.length > 1 ? [{
    name: "targetTokenUuid",
    type: "select",
    label: "Цель",
    options: tokens.map(token => ({ value: documentUuid(token), label: tokenActor(token)?.name || documentUuid(token) }))
  }] : [];
}

function ownerUserIds(actor) {
  return collectionValues(globalThis.game?.users)
    .filter((user) => {
      if (!user?.id || user?.active === false) return false;
      if (typeof actor?.testUserPermission === "function") {
        return actor.testUserPermission(user, "OWNER") === true;
      }
      const ownership = actor?.ownership ?? actor?._source?.ownership ?? {};
      return Number(ownership[user.id] ?? ownership.default ?? 0) >= 3;
    })
    .map((user) => cleanText(user.id));
}

function automationId(document) {
  const flagged = cleanText(getProperty(document, `flags.${MODULE_ID}.runeKnightAutomation.id`));
  return flagged || MIGRATION_AUTOMATION_BY_NAME.get(normalizeText(document?.name)) || "";
}

function contextActor(...contexts) {
  for (const context of contexts) {
    const actor = context?.actor
      ?? context?.subject
      ?? context?.item?.actor
      ?? context?.activity?.actor
      ?? context?.data?.actor
      ?? null;
    if (isActorDocument(actor)) return actor;
  }
  return null;
}

function contextToken(...contexts) {
  for (const context of contexts) {
    const token = context?.token
      ?? context?.tokenDocument
      ?? context?.subject?.token
      ?? context?.data?.token
      ?? null;
    if (token) return token?.object ?? token;
  }
  return null;
}

function contextIsPoison(...contexts) {
  for (const context of contexts) {
    if (context?.isPoison === true || context?.options?.isPoison === true) return true;
    const values = [
      context?.damageType,
      context?.type,
      context?.options?.damageType,
      context?.options?.type,
      context?.options?.sourceType
    ];
    if (values.some(value => ["poison", "poisoned", "яд", "отравление"].includes(cleanText(value).toLowerCase()))) return true;
    const activity = context?.activity ?? context?.subject;
    if (collectionValues(activity?.damage?.parts).some(part => collectionValues(part.types).includes("poison"))) return true;
    if (collectionValues(activity?.effects).some(link => {
      const effect = activity.item?.effects?.get?.(link.id ?? link._id);
      return statusIds(effect).has("poisoned");
    })) return true;
  }
  return false;
}

function statusIds(document) {
  const ids = new Set();
  const statuses = document?.statuses;
  if (statuses instanceof Set || Array.isArray(statuses)) {
    for (const status of statuses) ids.add(normalizeText(status));
  }
  const coreStatus = cleanText(getProperty(document, "flags.core.statusId"));
  if (coreStatus) ids.add(normalizeText(coreStatus));
  return ids;
}

function actorIsIncapacitated(actor) {
  if (statusIds(actor).has("incapacitated")) return true;
  return collectionValues(actor?.effects).some((effect) => (
    isRuneKnightEffectActive(effect) && statusIds(effect).has("incapacitated")
  ));
}

function classIdentifier(item) {
  return cleanText(
    getProperty(item, "system.identifier")
      ?? getProperty(item, `flags.${MODULE_ID}.classIdentifier`)
  );
}

function fighterLevel(actor) {
  const fighter = collectionValues(actor?.items).find((item) => (
    item?.type === "class" && classIdentifier(item) === FIGHTER_CLASS_IDENTIFIER
  ));
  return Math.max(0, Math.floor(numberValue(fighter?.system?.levels, 0)));
}

function proficiencyBonus(actor) {
  return Math.max(0, Math.floor(numberValue(actor?.system?.attributes?.prof, 0)));
}

function recoveryMatches(current, expected) {
  const normalized = (Array.isArray(current) ? current : []).map(({ period, type, formula }) => ({
    period: cleanText(period),
    type: cleanText(type),
    formula: cleanText(formula)
  }));
  return JSON.stringify(normalized) === JSON.stringify(expected);
}

function mergeRepairOptions(current = {}, incoming = {}) {
  return {
    restoreRunes: current.restoreRunes === true || incoming.restoreRunes === true,
    restoreLongRest: current.restoreLongRest === true || incoming.restoreLongRest === true
  };
}

function restType(result = {}, config = {}) {
  if (result?.longRest === true || config?.longRest === true) return "long";
  if (result?.shortRest === true || config?.shortRest === true) return "short";

  const values = [
    result?.type,
    result?.restType,
    result?.period,
    config?.type,
    config?.restType,
    config?.period
  ].map(normalizeText);
  if (values.some((value) => value === "long" || value === "lr" || value.includes("продолж"))) {
    return "long";
  }
  if (values.some((value) => value === "short" || value === "sr" || value.includes("корот"))) {
    return "short";
  }
  return "";
}

async function updateItem(item, patch) {
  if (!item || !Object.keys(patch).length) return false;
  if (typeof item.update === "function") {
    await item.update(patch, { render: false });
  }
  else {
    const actor = actorFromEmbeddedDocument(item);
    const id = documentId(item);
    if (id && typeof actor?.updateEmbeddedDocuments === "function") {
      await actor.updateEmbeddedDocuments("Item", [{ _id: id, ...patch }], { render: false });
    }
  }
  for (const [path, value] of Object.entries(patch)) setProperty(item, path, clone(value));
  return true;
}

export class RuneKnightAutomationService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this.options = options;
    this._repairActorPromises = new Map();
    this._pendingRepairOptions = new Map();
    this._stoneTriggers = new Map();
    this._fireWorkflowStates = new Map();
    this._fireWorkflowPromises = new Map();
    this._fireTurnKeys = new Set();
    this._hitReactionTriggers = new Map();
    this._remoteHitTriggers = new WeakMap();
    this._stormRollTriggers = new Map();
    this._stormRollResults = new WeakMap();
    this._stormRollSequence = 0;
    this._giantMightDamageKeys = new Set();
    this._giantMightDamageWorkflows = new WeakMap();
    this._giantMightRestorations = new WeakMap();
    this._itemUsePayments = new WeakSet();
  }

  async initialize() {
    const capabilityIndex = this.moduleApi?.reactionCapabilityIndex;
    if (typeof capabilityIndex?.registerProvider === "function") {
      capabilityIndex.registerProvider(
        STONE_REACTION_KIND,
        ({ actor, token }) => this.#stoneCapabilitiesForActor(actor, token),
        { providerId: STONE_PROVIDER_ID }
      );
      capabilityIndex.registerProvider(
        CLOUD_REACTION_KIND,
        ({ actor, token }) => this.#hitReactionCapabilitiesForActor(actor, token, "cloud"),
        { providerId: CLOUD_PROVIDER_ID }
      );
      capabilityIndex.registerProvider(
        RUNIC_SHIELD_REACTION_KIND,
        ({ actor, token }) => this.#hitReactionCapabilitiesForActor(actor, token, "runic-shield"),
        { providerId: RUNIC_SHIELD_PROVIDER_ID }
      );
      capabilityIndex.registerProvider(
        STORM_REACTION_KIND,
        ({ actor, token }) => this.#stormCapabilitiesForActor(actor, token),
        { providerId: STORM_PROVIDER_ID }
      );
    }
    const queue = this.moduleApi?.reactionQueueService;
    if (typeof queue?.registerType === "function") {
      queue.registerType(STONE_REACTION_KIND, this.#stoneReactionProvider());
      queue.registerType(CLOUD_REACTION_KIND, this.#cloudReactionProvider());
      queue.registerType(RUNIC_SHIELD_REACTION_KIND, this.#runicShieldReactionProvider());
      queue.registerType(STORM_REACTION_KIND, this.#stormReactionProvider());
    }
    return true;
  }

  registerLongRestSteps(pipeline) {
    if (typeof pipeline?.registerStep !== "function") return false;
    pipeline.registerStep({
      id: "rune-knight.restore",
      label: "Восстановление Рунного рыцаря",
      order: 110,
      interactive: false,
      isEligible: ({ actor }) => isActorDocument(actor),
      run: async ({ actor, result, config }) => {
        await this.handleRestCompleted(actor, result, config);
        return { status: "completed" };
      }
    });
    return true;
  }

  repairActor(actor, options = {}) {
    if (!isActorDocument(actor)) {
      return Promise.resolve(false);
    }

    const key = actorKey(actor) || actor;
    this._pendingRepairOptions.set(
      key,
      mergeRepairOptions(this._pendingRepairOptions.get(key), options)
    );
    const current = this._repairActorPromises.get(key);
    if (current) return current;

    const repairPromise = this.#drainActorRepairs(actor, key);
    this._repairActorPromises.set(key, repairPromise);
    return repairPromise;
  }

  async #drainActorRepairs(actor, key) {
    try {
      await Promise.resolve();
      let repaired = false;
      while (this._pendingRepairOptions.has(key)) {
        const options = this._pendingRepairOptions.get(key) ?? {};
        this._pendingRepairOptions.delete(key);
        repaired = (await this.#repairActorNow(actor, options)) || repaired;
      }
      return repaired;
    }
    finally {
      this._pendingRepairOptions.delete(key);
      this._repairActorPromises.delete(key);
    }
  }

  async #repairActorNow(actor, { restoreRunes = false, restoreLongRest = false } = {}) {
    const items = collectionValues(actor?.items);
    const level = fighterLevel(actor);
    const hasMasterOfRunes = level >= 15 && items.some((item) => automationId(item) === "master-of-runes");
    const runeMaximum = hasMasterOfRunes ? 2 : 1;
    const pb = proficiencyBonus(actor);
    let changed = await this.#ensureGreatStature(actor, items, level);

    for (const item of items) {
      const id = automationId(item);
      if (RUNE_IDS.has(id)) {
        changed = (await this.#synchronizeUses(item, runeMaximum, RUNE_RECOVERY, restoreRunes)) || changed;
      }
      else if (id === "giant-might" || id === "runic-shield") {
        changed = (await this.#synchronizeUses(item, pb, LONG_REST_RECOVERY, restoreLongRest)) || changed;
      }
    }

    return changed;
  }

  async #synchronizeUses(item, maximum, recovery, restore) {
    const safeMaximum = Math.max(0, Math.floor(numberValue(maximum, 0)));
    const uses = item?.system?.uses ?? {};
    const spent = Math.max(0, Math.floor(numberValue(uses.spent, 0)));
    const patch = {};
    if (numberValue(uses.max, -1) !== safeMaximum) {
      patch["system.uses.max"] = safeMaximum;
    }
    if (!recoveryMatches(uses.recovery, recovery)) {
      patch["system.uses.recovery"] = clone(recovery);
    }
    const nextSpent = restore ? 0 : Math.min(spent, safeMaximum);
    if (spent !== nextSpent) {
      patch["system.uses.spent"] = nextSpent;
    }
    return updateItem(item, patch);
  }

  async #ensureGreatStature(actor, items, level) {
    if (level < 10 || !items.some((item) => automationId(item) === "great-stature")) return false;
    const flagPath = `flags.${MODULE_ID}.runeKnight.heightIncreaseInches`;
    const current = numberValue(getProperty(actor, flagPath), Number.NaN);
    if (Number.isFinite(current) && current > 0) return false;

    const roll = await this.#rollFormula("3d4", actor, "Великанский рост");
    const inches = Math.min(12, Math.max(3, Math.floor(numberValue(roll?.total, 3))));
    await this.#updateDocument(actor, { [flagPath]: inches });
    const chatData = {
      speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? { actor: actorKey(actor) },
      content: `<p><strong>Великанский рост:</strong> ${escapeHtml(actor?.name || "Рунный рыцарь")} становится выше на ${inches} дюйм.</p>`,
      flags: {
        [MODULE_ID]: {
          runeKnight: { greatStature: true, heightIncreaseInches: inches }
        }
      }
    };
    try {
      if (typeof this.options.createChatMessage === "function") {
        await this.options.createChatMessage(chatData);
      }
      else {
        await globalThis.ChatMessage?.create?.(chatData);
      }
    }
    catch (error) {
      this.options.logger?.error?.("Great Stature chat message failed", { error, actorUuid: actorKey(actor) });
    }
    return true;
  }

  async #rollFormula(formula, actor, flavor) {
    if (typeof this.options.rollFormula === "function") {
      return this.options.rollFormula(formula, actor, flavor);
    }
    const RollClass = globalThis.Roll;
    if (typeof RollClass !== "function") throw new Error("Roll class is unavailable");
    const roll = new RollClass(formula, actor?.getRollData?.() ?? {}, { flavor });
    if (typeof roll.evaluate === "function" && !roll._evaluated) await roll.evaluate();
    return roll;
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    const type = restType(result, config);
    if (!type) return true;
    await this.repairActor(actor, {
      restoreRunes: true,
      restoreLongRest: type === "long"
    });
    return true;
  }

  async handleEmbeddedItemChange(item) {
    const actor = actorFromEmbeddedDocument(item);
    if (!actor) return true;

    const id = automationId(item);
    if (RUNE_IDS.has(id) && !this.#actorStillOwnsItem(actor, item)) {
      await this.#removeDeletedRuneEffects(actor, item);
    }
    await this.repairActor(actor);
    return true;
  }

  async #removeDeletedRuneEffects(actor, item) {
    const game = globalThis.game;
    const targets = new Set([actor, ...collectionValues(game?.actors)]);
    for (const scene of collectionValues(game?.scenes)) {
      for (const token of collectionValues(scene.tokens)) {
        if (token.actor && token.actorLink === false) targets.add(token.actor);
      }
    }
    for (const target of targets) {
      if (game?.user?.isGM || target.isOwner !== false) await this.#deleteSourceEffects(target, documentUuid(item));
    }
  }

  async handleEmbeddedEffectChange(effect) {
    const actor = actorFromEmbeddedDocument(effect);
    if (!actor) return true;
    if (effect.duration?.expired === true
      && getProperty(effect, `flags.${MODULE_ID}.runeKnight.automation`) === GIANT_MIGHT_FORM_AUTOMATION) {
      await this.#finishGiantMightForm(actor, effect);
    }
    if (isRuneKnightEffectActive(effect) && statusIds(effect).has("incapacitated")) {
      for (const state of collectionValues(actor.effects)) {
        if (isRuneKnightEffectActive(state) && getProperty(state, `flags.${MODULE_ID}.runeKnight.propheticState`) === true) {
          await this.#deleteActorEffect(actor, state);
        }
      }
    }
    await this.repairActor(actor);
    return true;
  }

  async handleEmbeddedEffectDeletion(effect) {
    const actor = actorFromEmbeddedDocument(effect);
    if (actor && cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.automation`)) === GIANT_MIGHT_FORM_AUTOMATION) {
      await this.#finishGiantMightForm(actor, effect);
    }
    if (actor) await this.repairActor(actor);
    return true;
  }

  async applyDnd5ePostUseActivity(activity, usageConfig = {}, results = {}) {
    void results;
    const id = automationId(activity);
    if (id === "giant-might") {
      const actor = contextActor(activity, activity?.item, usageConfig);
      const item = activity?.item;
      const token = contextToken(usageConfig, activity)
        ?? this.options.tokenForActor?.(actor)
        ?? actor?.getActiveTokens?.(true, true)?.[0]
        ?? null;
      if (!actor || !item) return false;
      return this.#activateGiantMight(actor, item, token);
    }
    if (!SELF_ACTIVATION_IDS.has(id)) return true;

    const actor = contextActor(activity, activity?.item);
    const item = activity?.item;
    if (!actor || !item || this.#hasRuntimeEffect(actor, item, id)) return true;

    const rollback = await this.#consumeItemUse(item);
    if (!rollback) return false;
    try {
      const created = await this.#createRuneActivationEffect(actor, item, id);
      if (!created) {
        await rollback();
        return false;
      }
      return true;
    }
    catch (error) {
      await rollback();
      throw error;
    }
  }

  applyDnd5ePreRollToolCheck(rollConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const actor = contextActor(rollConfig, dialogConfig, messageConfig);
    if (!actor || !this.#actorHasFeature(actor, "fire") || rollConfig._rebreyaRuneToolExpertise
      || getProperty(actor, "flags.dnd5e.toolExpertise")) {
      return true;
    }

    const proficiency = rollConfig.proficiency
      ?? actor?.system?.tools?.[rollConfig.tool]?.prof
      ?? rollConfig.tool?.system?.proficient
      ?? rollConfig.item?.system?.proficient
      ?? 0;
    const multiplier = typeof proficiency === "object"
      ? numberValue(
        proficiency.multiplier
          ?? proficiency.value
          ?? (proficiency.hasProficiency === true ? 1 : 0),
        0
      )
      : numberValue(proficiency, 0);
    if (multiplier !== 1) return true;

    const currentBonus = cleanText(rollConfig.bonus);
    if (!/(?:^|\W)@prof(?:$|\W)/u.test(currentBonus)) {
      rollConfig.bonus = currentBonus ? `${currentBonus} + @prof` : "@prof";
    }
    if (typeof rollConfig.proficiency === "object" && rollConfig.proficiency) {
      rollConfig.proficiency.multiplier = Math.max(2, multiplier);
    }
    else if (Object.hasOwn(rollConfig, "proficiency")) {
      rollConfig.proficiency = Math.max(2, multiplier);
    }
    rollConfig._rebreyaRuneToolExpertise = true;
    return true;
  }

  applyDnd5ePreRollSavingThrow(rollConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const actor = contextActor(rollConfig, dialogConfig, messageConfig);
    if (!actor || !this.#actorHasFeature(actor, "hill") || !contextIsPoison(rollConfig, dialogConfig, messageConfig)) {
      return true;
    }
    rollConfig.advantage = true;
    if (dialogConfig && typeof dialogConfig === "object") dialogConfig.advantage = true;
    return true;
  }

  prepareActiveEffectCreate(effect) {
    const actor = actorFromEmbeddedDocument(effect);
    if (!actor || !this.#actorHasFeature(actor, "storm") || actorIsIncapacitated(actor)) return true;
    return statusIds(effect).has("surprised") ? false : true;
  }

  async applyMidiStormPreRoll(rollContext = {}, rollType = "attack", options = {}) {
    const normalizedType = cleanText(rollType).toLowerCase();
    if (!STORM_ROLL_TYPES.has(normalizedType) || !rollContext || typeof rollContext !== "object") {
      return true;
    }
    const capabilityIndex = this.moduleApi?.reactionCapabilityIndex;
    const queue = this.moduleApi?.reactionQueueService;
    if (
      typeof capabilityIndex?.has !== "function"
      || !capabilityIndex.has(STORM_REACTION_KIND)
      || typeof queue?.resolve !== "function"
    ) return true;

    const cached = this._stormRollResults.get(rollContext);
    if (cached) return cached;
    const workflow = options.workflow ?? rollContext.workflow ?? rollContext;
    const targetActor = options.actor ?? contextActor(rollContext, options, workflow);
    const targetToken = options.token ?? contextToken(rollContext, options, workflow);
    if (!isActorDocument(targetActor) || !targetToken || this.#stormRollFinished(rollContext, normalizedType)) {
      return true;
    }

    const workflowId = cleanText(documentUuid(workflow) || documentId(workflow));
    const targetActorUuid = documentUuid(targetActor) || actorKey(targetActor);
    const triggerId = `${workflowId || `native-${++this._stormRollSequence}`}:${documentUuid(targetToken) || targetActorUuid}:${normalizedType}:storm-rune`;
    const trigger = {
      kind: STORM_REACTION_KIND,
      rollType: normalizedType,
      rollContext,
      workflow,
      targetActor,
      targetToken,
      active: true,
      finished: false
    };
    this.#rememberWorkflowState(this._stormRollTriggers, triggerId, trigger);
    const context = {
      triggerId,
      workflowId,
      rollType: normalizedType,
      targetActorUuid,
      targetTokenUuid: documentUuid(targetToken),
      triggerActive: true,
      rollFinished: false
    };

    let result;
    try {
      result = await queue.resolve({ triggerId, kind: STORM_REACTION_KIND, context });
    }
    finally {
      this._stormRollTriggers.delete(triggerId);
    }
    const accepted = collectionValues(result?.accepted)[0];
    const mode = this.#stormMode(accepted?.effect?.mode ?? accepted?.choice?.mode);
    if (mode && options.workflow && rollContext !== workflow) {
      this.#addMidiSaveMode(rollContext, mode, "rebreya-storm-rune", "Штормовая руна");
    }
    else if (mode) this.#setStormRollMode(rollContext, mode);
    this._stormRollResults.set(rollContext, result);
    return result;
  }

  applyMidiTargetSave(target, workflow, saveDetails) {
    if (!saveDetails) return true;
    const actor = tokenActor(target);
    const type = !saveDetails.rollType || saveDetails.rollType === "save" ? "save" : "check";
    if (type === "save" && this.#actorHasFeature(actor, "hill") && contextIsPoison(
      saveDetails, { activity: workflow?.saveActivity ?? workflow?.activity }
    )) {
      this.#addMidiSaveMode(saveDetails, "advantage", "rebreya-hill-rune", "Холмовая руна");
    }
    return this.applyMidiStormPreRoll(saveDetails, type, { actor, token: target, workflow });
  }

  #addMidiSaveMode(details, mode, source, label) {
    const choices = Object.values(details.advantageByChoice ?? {});
    const trackers = new Set([details.modifierTracker, ...choices.map(choice => choice.tracker)].filter(Boolean));
    for (const tracker of trackers) tracker[mode]?.add?.(source, label);
    details[mode] = true;
    for (const choice of choices) {
      if (!choice.tracker) continue;
      choice.hasAdvantage = choice.tracker.hasAdvantage;
      choice.hasDisadvantage = choice.tracker.hasDisadvantage;
    }
  }

  applyDnd5eStormRollMode(rollConfig = {}, dialogConfig = {}, messageConfig = {}, rollType = "check") {
    if (!STORM_ROLL_TYPES.has(cleanText(rollType).toLowerCase())) return true;
    if (rollConfig?._rebreyaStormRuneApplied === true) return true;
    const mode = this.#stormMode(
      rollConfig?._rebreyaStormRuneMode
        ?? dialogConfig?._rebreyaStormRuneMode
        ?? messageConfig?._rebreyaStormRuneMode
        ?? getProperty(rollConfig, `flags.${MODULE_ID}.stormRuneMode`)
        ?? getProperty(dialogConfig, `flags.${MODULE_ID}.stormRuneMode`)
        ?? getProperty(messageConfig, `flags.${MODULE_ID}.stormRuneMode`)
    );
    if (!mode) return true;
    this.#setStormRollMode(rollConfig, mode);
    if (dialogConfig && typeof dialogConfig === "object") this.#setStormRollMode(dialogConfig, mode);
    rollConfig._rebreyaStormRuneApplied = true;
    return true;
  }

  applyDnd5eGiantMightDamage(rollConfig = {}, dialogConfig = {}, messageConfig = {}) {
    void dialogConfig;
    void messageConfig;
    if (rollConfig?._rebreyaGiantMightDamageApplied === true || rollConfig?.workflow) return true;
    const activity = rollConfig?.subject ?? rollConfig?.activity ?? null;
    const item = activity?.item ?? rollConfig?.item ?? null;
    const actor = activity?.actor ?? item?.actor ?? rollConfig?.actor ?? null;
    if (!isActorDocument(actor) || !this.#giantMightFormEffect(actor) || !this.#isWeaponOrUnarmed(item)) {
      return true;
    }
    const damageKey = this.#giantMightDamageKey(rollConfig, actor);
    if (!damageKey || this._giantMightDamageKeys.has(damageKey)) return true;
    if ((rollConfig.rolls ?? []).some((roll) => (
      cleanText(roll?.options?.[MODULE_ID]?.damageSource) === "giant-might"
    ))) return true;

    const damageType = cleanText(collectionValues(item?.system?.damage?.base?.types)[0]);
    rollConfig.rolls ??= [];
    rollConfig.rolls.push({
      data: actor?.getRollData?.() ?? {},
      parts: [this.#giantMightDamageFormula(actor)],
      options: {
        type: damageType,
        types: damageType ? [damageType] : [],
        flavor: "Мощь великана",
        [MODULE_ID]: { damageSource: "giant-might", damageKey }
      }
    });
    rollConfig._rebreyaGiantMightDamageApplied = true;
    return true;
  }

  commitDnd5eGiantMightDamage(rolls) {
    for (const roll of rolls ?? []) {
      const marker = roll?.options?.[MODULE_ID];
      if (marker?.damageSource === "giant-might" && marker.damageKey) this.#claimGiantMightDamage(marker.damageKey);
    }
  }

  async handleGroupedCombatPhase(combat, phase) {
    const empty = { actor: null, token: null };
    for (const member of collectionValues(combat?.combatants).filter(c => phase.memberIds.includes(c.id))) {
      const previous = { round: phase.round, turn: combat.turn, combatant: phase.kind === "turn-end" ? member : empty };
      const current = { round: phase.round, turn: combat.turn, combatant: phase.kind === "turn-start" ? member : empty };
      await this.handleCombatTurnChange(combat, { ...current, current, previous }, { direction: 1, current, previous });
    }
  }

  async handleCombatTurnChange(combat, updateData = {}, updateOptions = {}) {
    const ended = this.#endedTurnCombatant(combat, updateData, updateOptions);
    const targetActor = ended?.actor ?? tokenActor(ended?.token);
    const targetToken = ended?.token ?? ended?.tokenDocument ?? null;
    const current = this.#currentTurnCombatant(combat, updateData, updateOptions);
    const currentActor = current?.actor ?? tokenActor(current?.token);

    if (!this.#midiIsActive()) {
      if (isActorDocument(targetActor)) {
        await this.#resolveFireRepeatSave(targetActor, this.#turnEventKey(combat, updateData, updateOptions, targetActor, "fire-end"));
      }
      if (isActorDocument(currentActor)) {
        await this.#applyFireStartTurnDamage(currentActor, this.#turnEventKey(combat, updateData, updateOptions, currentActor, "fire-start"));
      }
    }

    if (!isActorDocument(targetActor)) return true;

    await this.#resolveStoneRepeatSave(targetActor);

    const capabilityIndex = this.moduleApi?.reactionCapabilityIndex;
    if (typeof capabilityIndex?.has !== "function" || !capabilityIndex.has(STONE_REACTION_KIND)) {
      return true;
    }
    const queue = this.moduleApi?.reactionQueueService;
    if (typeof queue?.resolve !== "function") return true;

    const round = Math.max(0, Math.floor(numberValue(
      updateData?.previous?.round ?? updateOptions?.previous?.round ?? combat?.round,
      0
    )));
    const turn = Math.max(-1, Math.floor(numberValue(
      updateData?.previous?.turn ?? updateOptions?.previous?.turn ?? combat?.turn,
      -1
    )));
    const combatId = cleanText(combat?.uuid ?? combat?.id ?? combat?._id ?? "combat");
    const targetActorUuid = documentUuid(targetActor) || actorKey(targetActor);
    const targetTokenUuid = documentUuid(targetToken);
    const triggerId = `${combatId}:${round}:${turn}:${targetTokenUuid || targetActorUuid}:stone-end-turn`;
    this._stoneTriggers.set(triggerId, { targetActor, targetToken, active: true });
    try {
      return await queue.resolve({
        triggerId,
        kind: STONE_REACTION_KIND,
        context: {
          triggerId,
          combatId,
          round,
          turn,
          targetActorUuid,
          targetTokenUuid,
          triggerActive: true
        }
      });
    }
    finally {
      this._stoneTriggers.delete(triggerId);
    }
  }

  #stoneCapabilitiesForActor(actor, token) {
    if (!isActorDocument(actor) || actorIsIncapacitated(actor)) return [];
    const item = collectionValues(actor?.items).find((entry) => (
      automationId(entry) === "stone" && this.#itemHasUse(entry)
    ));
    if (!item) return [];
    return [{
      actorUuid: documentUuid(actor) || actorKey(actor),
      tokenUuid: documentUuid(token),
      itemUuid: documentUuid(item),
      activityId: firstActivityId(item),
      ownerUserIds: ownerUserIds(actor)
    }];
  }

  applyMidiHitsChecked(workflow) {
    const key = this.#workflowKey(workflow);
    if (!key || this._fireWorkflowStates.has(key)) return Promise.resolve(true);
    const current = this._fireWorkflowPromises.get(key);
    if (current) return current;

    const operation = this.#applyMidiHitPipeline(workflow, key).finally(() => {
      if (this._fireWorkflowPromises.get(key) === operation) {
        this._fireWorkflowPromises.delete(key);
      }
    });
    this._fireWorkflowPromises.set(key, operation);
    return operation;
  }

  async #applyMidiHitPipeline(workflow, key) {
    await this.#resolveCloudReaction(workflow, key);
    await this.#resolveRunicShieldReaction(workflow, key);
    return this.#prepareFireRune(workflow, key);
  }

  #stormCapabilitiesForActor(actor, token) {
    if (!isActorDocument(actor) || actorIsIncapacitated(actor)) return [];
    const item = collectionValues(actor?.items).find((entry) => automationId(entry) === "storm");
    if (!item || !this.#hasPropheticState(actor, item)) return [];
    return [{
      actor,
      actorUuid: documentUuid(actor) || actorKey(actor),
      token,
      tokenUuid: documentUuid(token),
      item,
      itemUuid: documentUuid(item),
      activityId: firstActivityId(item),
      ownerUserIds: ownerUserIds(actor)
    }];
  }

  #hasPropheticState(actor, item) {
    const sourceItemUuid = documentUuid(item);
    return collectionValues(actor?.effects).some((effect) => {
      if (!isRuneKnightEffectActive(effect)) return false;
      if (getProperty(effect, `flags.${MODULE_ID}.runeKnight.propheticState`) !== true) return false;
      const effectSource = cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.sourceItemUuid`));
      return !effectSource || !sourceItemUuid || effectSource === sourceItemUuid;
    });
  }

  #stormReactionProvider() {
    return {
      listCandidates: (_context, capabilityIndex) => capabilityIndex?.list?.(STORM_REACTION_KIND) ?? [],
      isTriggerValid: (context) => {
        const trigger = this.#stormTrigger(context);
        return trigger?.active !== false && trigger?.finished !== true
          && !this.#stormRollFinished(trigger?.rollContext ?? trigger?.workflow, trigger?.rollType);
      },
      revalidateCandidate: (candidate, context) => this.#canUseStormReaction(
        this.#normalizeHitReactionCandidate(candidate, "storm"),
        this.#stormTrigger(context)
      ),
      buildPrompt: (_candidate, context) => ({
        title: "Штормовая руна",
        body: `Изменить ${this.#stormRollLabel(this.#stormTrigger(context)?.rollType)} существа ${cleanText(
          this.#stormTrigger(context)?.targetActor?.name,
          "в пределах 60 футов"
        )}?`,
        acceptLabel: "Изменить бросок",
        declineLabel: "Пропустить",
        fields: [{
          name: "mode",
          type: "select",
          label: "Режим",
          options: [
            { value: "advantage", label: "Преимущество" },
            { value: "disadvantage", label: "Помеха" }
          ]
        }]
      }),
      pay: () => ({ paid: true }),
      apply: (_candidate, choice, context, transaction) => this.#applyStormReaction(
        choice,
        this.#stormTrigger(context),
        transaction
      ),
      rollback: (_candidate, transaction) => this.#rollbackStormReaction(transaction),
      serializeEffect: (effect) => ({
        applied: effect?.applied === true,
        mode: this.#stormMode(effect?.mode)
      })
    };
  }

  #stormTrigger(context = {}) {
    const triggerId = cleanText(context?.triggerId);
    const local = this._stormRollTriggers.get(triggerId);
    if (local) return local;
    const workflow = globalThis.MidiQOL?.Workflow?.getWorkflow?.(context.workflowId) ?? null;
    const targetToken = globalThis.fromUuidSync?.(context.targetTokenUuid) ?? null;
    const targetActor = globalThis.fromUuidSync?.(context.targetActorUuid) ?? tokenActor(targetToken);
    return {
      kind: STORM_REACTION_KIND,
      rollType: cleanText(context.rollType, "check"),
      rollContext: workflow,
      workflow,
      targetActor,
      targetToken,
      active: context.triggerActive !== false,
      finished: context.rollFinished === true
    };
  }

  async #canUseStormReaction(candidate, trigger) {
    const actor = candidate?.actor;
    const item = candidate?.item;
    if (
      !isActorDocument(actor)
      || !item
      || automationId(item) !== "storm"
      || !this.#hasPropheticState(actor, item)
      || actorIsIncapacitated(actor)
      || !isActorDocument(trigger?.targetActor)
      || !trigger?.targetToken
      || trigger?.active === false
      || trigger?.finished === true
    ) return false;
    const reactionState = this.moduleApi?.combatAttackService?.canUseReaction?.(actor, 1);
    if (reactionState && reactionState.canUse === false) return false;
    const affectsSelf = actorKey(actor) === actorKey(trigger.targetActor);
    if (!affectsSelf && !this.#isVisible(candidate, trigger)) return false;
    return this.#distanceFeet(candidate.token, trigger.targetToken) <= STORM_RANGE_FEET;
  }

  #applyStormReaction(choice, trigger, transaction) {
    const mode = this.#stormMode(choice?.mode);
    if (!mode || !trigger || trigger.active === false || trigger.finished === true) {
      return { applied: false };
    }
    const effect = { applied: false, trigger, mode };
    if (transaction) transaction.effect = effect;
    trigger.active = false;
    effect.applied = true;
    return effect;
  }

  #rollbackStormReaction(transaction) {
    if (transaction?.effect?.trigger) transaction.effect.trigger.active = true;
    return true;
  }

  #stormMode(value) {
    const mode = cleanText(value).toLowerCase();
    return mode === "advantage" || mode === "disadvantage" ? mode : "";
  }

  #stormRollLabel(rollType) {
    if (rollType === "attack") return "бросок атаки";
    if (rollType === "save") return "спасбросок";
    return "проверку характеристики";
  }

  #setStormRollMode(rollContext, mode) {
    if (!rollContext || typeof rollContext !== "object" || !this.#stormMode(mode)) return false;
    rollContext[mode] = true;
    if (!rollContext.options || typeof rollContext.options !== "object") rollContext.options = {};
    rollContext.options[mode] = true;
    if (!rollContext.workflowOptions || typeof rollContext.workflowOptions !== "object") {
      rollContext.workflowOptions = {};
    }
    rollContext.workflowOptions[mode] = true;
    rollContext._rebreyaStormRuneMode = mode;
    rollContext._rebreyaStormRuneApplied = true;
    return true;
  }

  #stormRollFinished(rollContext, rollType) {
    if (!rollContext || typeof rollContext !== "object") return false;
    if (
      rollContext._rebreyaStormRuneFinalized === true
      || rollContext.finished === true
      || rollContext.completed === true
      || rollContext.aborted === true
    ) return true;
    if (rollType === "attack") {
      return Boolean(rollContext.attackRoll && numberValue(rollContext.attackRollCount, 0) > 0);
    }
    return Boolean(rollContext.roll ?? rollContext.result ?? rollContext.rollResult);
  }

  #hitReactionCapabilitiesForActor(actor, token, id) {
    if (!isActorDocument(actor) || actorIsIncapacitated(actor)) return [];
    const item = collectionValues(actor?.items).find((entry) => (
      automationId(entry) === id && this.#itemHasUse(entry)
    ));
    if (!item) return [];
    return [{
      actorUuid: documentUuid(actor) || actorKey(actor),
      tokenUuid: documentUuid(token),
      itemUuid: documentUuid(item),
      activityId: firstActivityId(item),
      ownerUserIds: ownerUserIds(actor)
    }];
  }

  #resolveCloudReaction(workflow, key) {
    return this.#resolveHitReaction(workflow, key, CLOUD_REACTION_KIND);
  }

  #resolveRunicShieldReaction(workflow, key) {
    return this.#resolveHitReaction(workflow, key, RUNIC_SHIELD_REACTION_KIND);
  }

  async #resolveHitReaction(workflow, key, kind) {
    const capabilityIndex = this.moduleApi?.reactionCapabilityIndex;
    const queue = this.moduleApi?.reactionQueueService;
    if (!capabilityIndex?.has?.(kind) || typeof queue?.resolve !== "function") return true;
    const game = globalThis.game;
    const activeGm = getActiveGm(game);
    if (activeGm && activeGm.id !== game?.user?.id) {
      await workflow.displayHits?.(workflow.whisperAttackCard);
    }
    for (const targetToken of workflowHitTargets(workflow)) {
      const targetTokenUuid = documentUuid(targetToken);
      const triggerId = `${key}:${kind}:${targetTokenUuid}`;
      const attackerToken = workflow?.token ?? workflow?.tokenDocument ?? null;
      const trigger = { kind, workflow, targetToken, targetActor: tokenActor(targetToken), attackerToken, active: true };
      this.#rememberWorkflowState(this._hitReactionTriggers, triggerId, trigger);
      try {
        const result = await queue.resolve({
          triggerId, kind,
          context: {
            triggerId, workflowId: key, targetTokenUuid, attackerTokenUuid: documentUuid(attackerToken),
            attackId: workflow.chatCard?.id ?? workflow.itemCardId, triggerActive: true
          }
        });
        const accepted = result?.accepted?.[0];
        if (accepted?.effect?.onOrigin === true) {
          if (kind === CLOUD_REACTION_KIND) {
            trigger.redirectedToken = globalThis.fromUuidSync?.(accepted.effect.redirectedTokenUuid);
            if (trigger.redirectedToken) await this.#applyCloudReaction({}, {}, trigger);
          }
          else await this.#applyRunicShieldReaction(null, trigger);
        }
        if (accepted) return result;
      }
      finally {
        this._hitReactionTriggers.delete(triggerId);
      }
    }
    return true;
  }

  #cloudReactionProvider() {
    return {
      listCandidates: (_context, capabilityIndex) => capabilityIndex?.list?.(CLOUD_REACTION_KIND) ?? [],
      isTriggerValid: (context) => this.#hitReactionTrigger(context, CLOUD_REACTION_KIND)?.active !== false,
      revalidateCandidate: (candidate, context) => this.#canUseHitReaction(
        this.#normalizeHitReactionCandidate(candidate, "cloud"),
        this.#hitReactionTrigger(context, CLOUD_REACTION_KIND),
        CLOUD_RANGE_FEET,
        true,
        true
      ),
      buildPrompt: (candidate, context) => this.#cloudReactionPrompt(
        this.#normalizeHitReactionCandidate(candidate, "cloud"),
        this.#hitReactionTrigger(context, CLOUD_REACTION_KIND)
      ),
      pay: (candidate) => this.#payHitReaction(this.#normalizeHitReactionCandidate(candidate, "cloud")),
      apply: (candidate, choice, context, transaction) => this.#applyCloudReaction(
        this.#normalizeHitReactionCandidate(candidate, "cloud"),
        choice,
        this.#hitReactionTrigger(context, CLOUD_REACTION_KIND),
        transaction
      ),
      rollback: (_candidate, transaction) => this.#rollbackHitReaction(transaction),
      serializeEffect: (effect) => ({
        applied: effect?.applied === true,
        onOrigin: effect?.onOrigin === true,
        redirectedTokenUuid: documentUuid(effect?.redirectedToken)
      })
    };
  }

  #runicShieldReactionProvider() {
    return {
      listCandidates: (_context, capabilityIndex) => capabilityIndex?.list?.(RUNIC_SHIELD_REACTION_KIND) ?? [],
      isTriggerValid: (context) => {
        const trigger = this.#hitReactionTrigger(context, RUNIC_SHIELD_REACTION_KIND);
        return trigger?.active !== false
          && (trigger.onOrigin === true || this.#workflowHasHitTarget(trigger?.workflow, trigger?.targetToken));
      },
      revalidateCandidate: (candidate, context) => this.#canUseHitReaction(
        this.#normalizeHitReactionCandidate(candidate, "runic-shield"),
        this.#hitReactionTrigger(context, RUNIC_SHIELD_REACTION_KIND),
        RUNIC_SHIELD_RANGE_FEET,
        false
      ),
      buildPrompt: (_candidate, context) => ({
        title: "Рунический щит",
        body: `Заставить атакующего перебросить попадание по ${cleanText(
          this.#hitReactionTrigger(context, RUNIC_SHIELD_REACTION_KIND)?.targetActor?.name,
          "цели"
        )}?`,
        acceptLabel: "Перебросить атаку",
        declineLabel: "Пропустить"
      }),
      pay: (candidate) => this.#payHitReaction(this.#normalizeHitReactionCandidate(candidate, "runic-shield")),
      apply: (candidate, _choice, context, transaction) => this.#applyRunicShieldReaction(
        this.#normalizeHitReactionCandidate(candidate, "runic-shield"),
        this.#hitReactionTrigger(context, RUNIC_SHIELD_REACTION_KIND),
        transaction
      ),
      rollback: (_candidate, transaction) => this.#rollbackHitReaction(transaction),
      serializeEffect: (effect) => ({
        applied: effect?.applied === true,
        onOrigin: effect?.onOrigin === true,
        attackTotal: numberValue(effect?.newRoll?.total, 0)
      })
    };
  }

  #normalizeHitReactionCandidate(candidate = {}, expectedId) {
    const item = candidate.item ?? globalThis.fromUuidSync?.(candidate.itemUuid) ?? null;
    const actor = candidate.actor
      ?? actorFromEmbeddedDocument(item)
      ?? globalThis.fromUuidSync?.(candidate.actorUuid)
      ?? null;
    const resolvedItem = item ?? collectionValues(actor?.items).find((entry) => (
      documentUuid(entry) === cleanText(candidate.itemUuid) || automationId(entry) === expectedId
    ));
    const token = candidate.token ?? globalThis.fromUuidSync?.(candidate.tokenUuid) ?? null;
    return {
      ...candidate,
      id: cleanText(candidate.id, actorKey(actor)),
      actor,
      actorUuid: cleanText(candidate.actorUuid, documentUuid(actor) || actorKey(actor)),
      token,
      tokenUuid: cleanText(candidate.tokenUuid, documentUuid(token)),
      item: resolvedItem,
      itemUuid: cleanText(candidate.itemUuid, documentUuid(resolvedItem))
    };
  }

  #hitReactionTrigger(context = {}, kind) {
    const cached = this._remoteHitTriggers.get(context);
    if (cached?.kind === kind) return cached;
    const triggerId = cleanText(context.triggerId);
    const local = !context._reactionTransportSender && this._hitReactionTriggers.get(triggerId);
    if (local) return local;

    const workflow = !context._reactionTransportSender && (globalThis.MidiQOL?.Workflow?.getWorkflow?.(context.workflowId)
      ?? globalThis.MidiQOL?.Workflow?.getWorkflow?.(triggerId)
      ?? null);
    const targetToken = globalThis.fromUuidSync?.(context.targetTokenUuid) ?? null;
    const attackerToken = globalThis.fromUuidSync?.(context.attackerTokenUuid) ?? workflow?.token ?? null;
    const game = globalThis.game;
    const sender = game?.users?.get?.(context._reactionTransportSender);
    const card = game?.messages?.get?.(context.attackId);
    const validRemote = Boolean(sender && tokenActor(attackerToken)?.testUserPermission?.(sender, "OWNER")
      && (card?.author?.id ?? card?.user?.id ?? card?.user) === sender.id
      && card.speaker?.scene === (attackerToken?.parent ?? attackerToken?.document?.parent)?.id
      && card.speaker?.token === documentId(attackerToken?.document ?? attackerToken)
      && (targetToken?.parent ?? targetToken?.document?.parent) === (attackerToken?.parent ?? attackerToken?.document?.parent)
      && usageCardData(card) && cardHitEvidence(card, context.targetTokenUuid));
    const trigger = {
      kind,
      workflow,
      targetToken,
      targetActor: tokenActor(targetToken),
      attackerToken,
      onOrigin: validRemote,
      active: context.triggerActive !== false && (!context._reactionTransportSender || validRemote)
    };
    this._remoteHitTriggers.set(context, trigger);
    return trigger;
  }

  async #canUseHitReaction(
    candidate,
    trigger,
    rangeFeet,
    requireRedirectTarget,
    requireHostileAttacker = false
  ) {
    const actor = candidate?.actor;
    const item = candidate?.item;
    if (
      !isActorDocument(actor)
      || !item
      || !this.#itemHasUse(item)
      || actorIsIncapacitated(actor)
      || !isActorDocument(trigger?.targetActor)
      || trigger?.active === false
    ) return false;
    const reactionState = this.moduleApi?.combatAttackService?.canUseReaction?.(actor, 1);
    if (reactionState && reactionState.canUse === false) return false;
    if (requireHostileAttacker && !tokensHaveOpposingDisposition(candidate.token, trigger.attackerToken)) {
      return false;
    }
    if (!this.#isVisible(candidate, trigger)) return false;
    if (this.#distanceFeet(candidate.token, trigger.targetToken) > rangeFeet) return false;
    return !requireRedirectTarget || this.#cloudRedirectTargets(candidate, trigger).length > 0;
  }

  #cloudReactionPrompt(candidate, trigger) {
    const options = this.#cloudRedirectTargets(candidate, trigger).map((token) => ({
      value: documentUuid(token),
      label: cleanText(token?.name ?? tokenActor(token)?.name, documentUuid(token))
    }));
    return {
      title: "Облачная руна",
      body: `Перенаправить атаку, попавшую по ${cleanText(trigger?.targetActor?.name, "цели")}?`,
      acceptLabel: "Перенаправить",
      declineLabel: "Пропустить",
      fields: [{
        name: "targetTokenUuid",
        type: "select",
        label: "Новая цель",
        options
      }]
    };
  }

  #cloudRedirectTargets(candidate, trigger) {
    const tokens = typeof this.options.sceneTokens === "function"
      ? collectionValues(this.options.sceneTokens(candidate, trigger))
      : collectionValues(globalThis.canvas?.scene?.tokens).map((token) => token?.object ?? token);
    return tokens.filter((token) => (
      isActorDocument(tokenActor(token))
      && !this.#sameToken(token, trigger?.attackerToken)
      && !this.#sameToken(token, trigger?.targetToken)
      && this.#distanceFeet(candidate?.token, token) <= CLOUD_RANGE_FEET
    ));
  }

  async #payHitReaction(candidate) {
    const rollback = await this.#consumeItemUse(candidate?.item);
    return rollback ? { paid: true, rollback } : { paid: false };
  }

  async #applyCloudReaction(_candidate, choice, trigger, transaction) {
    const workflow = trigger?.workflow;
    const originalTarget = trigger?.targetToken;
    const redirectedToken = trigger?.redirectedToken ?? this.#cloudRedirectTargets(_candidate, trigger).find((token) => (
      documentUuid(token) === cleanText(choice?.targetTokenUuid)
    ));
    if (trigger?.onOrigin && redirectedToken) {
      trigger.active = false;
      return { applied: true, onOrigin: true, redirectedToken };
    }
    if (!workflow || !originalTarget || !redirectedToken) return { applied: false };

    const snapshot = this.#workflowSnapshot(workflow);
    const effect = { applied: false, workflow, trigger, snapshot, redirectedToken };
    if (transaction) transaction.effect = effect;
    const hit = this.#attackHitsToken(workflow.attackRoll, redirectedToken);
    workflow.targets = this.#replaceToken(workflow.targets, originalTarget, redirectedToken, true);
    workflow.hitTargets = this.#replaceToken(workflow.hitTargets, originalTarget, redirectedToken, hit);
    workflow.hitTargetsEC = this.#replaceToken(workflow.hitTargetsEC, originalTarget, redirectedToken, false);
    if (typeof workflow.checkHits === "function") await this.#recalculateWorkflowHits(workflow);
    this.#removeDamageRecipient(workflow, originalTarget);
    trigger.active = false;
    effect.applied = true;
    return effect;
  }

  async #applyRunicShieldReaction(_candidate, trigger, transaction) {
    if (trigger?.onOrigin) {
      trigger.active = false;
      return { applied: true, onOrigin: true };
    }
    const workflow = trigger?.workflow;
    const attackRoll = workflow?.attackRoll;
    if (!workflow || !attackRoll) return { applied: false };
    const snapshot = this.#workflowSnapshot(workflow);
    const effect = { applied: false, workflow, trigger, snapshot, newRoll: null };
    if (transaction) transaction.effect = effect;
    const newRoll = await this.#rerollAttackD20(attackRoll);
    if (!newRoll) return { applied: false };
    if (typeof workflow.setAttackRoll === "function") await workflow.setAttackRoll(newRoll);
    else workflow.attackRoll = newRoll;
    await workflow.processAttackRoll?.();
    await this.#recalculateWorkflowHits(workflow);
    await workflow.displayAttackRoll?.();
    effect.applied = true;
    effect.newRoll = newRoll;
    return effect;
  }

  async #rerollAttackD20(roll) {
    if (!Array.isArray(roll.terms)) return roll.reroll?.();
    const index = roll.terms.findIndex(term => term.faces === 20);
    if (index < 0 || typeof roll.constructor.fromTerms !== "function") return null;
    const original = roll.terms[index];
    const die = new original.constructor({ number: 1, faces: 20, options: { ...original.options } });
    const terms = [...roll.terms];
    terms[index] = await die.evaluate();
    return roll.constructor.fromTerms(terms, { ...roll.options });
  }

  async #rollbackHitReaction(transaction) {
    const effect = transaction?.effect;
    if (effect?.workflow && effect?.snapshot) {
      await this.#restoreWorkflowSnapshot(effect.workflow, effect.snapshot);
      if (effect.trigger) effect.trigger.active = true;
    }
    await transaction?.payment?.rollback?.();
  }

  #workflowSnapshot(workflow) {
    return {
      attackRoll: workflow?.attackRoll,
      targets: new Set(collectionValues(workflow?.targets)),
      hitTargets: new Set(collectionValues(workflow?.hitTargets)),
      hitTargetsEC: new Set(collectionValues(workflow?.hitTargetsEC)),
      hitDisplayData: workflow?.hitDisplayData,
      damageList: Array.isArray(workflow?.damageList) ? [...workflow.damageList] : null,
      damageRecipients: workflow?.damageRecipients
        ? [...collectionValues(workflow.damageRecipients)]
        : null,
      damageRecipientsWasSet: workflow?.damageRecipients instanceof Set
    };
  }

  async #restoreWorkflowSnapshot(workflow, snapshot) {
    if (snapshot.attackRoll && workflow.attackRoll !== snapshot.attackRoll) {
      if (typeof workflow.setAttackRoll === "function") await workflow.setAttackRoll(snapshot.attackRoll);
      else workflow.attackRoll = snapshot.attackRoll;
      await workflow.processAttackRoll?.();
      await workflow.displayAttackRoll?.();
    }
    workflow.targets = new Set(snapshot.targets);
    workflow.hitTargets = new Set(snapshot.hitTargets);
    workflow.hitTargetsEC = new Set(snapshot.hitTargetsEC);
    if (snapshot.hitDisplayData) workflow.hitDisplayData = snapshot.hitDisplayData;
    if (snapshot.damageList) workflow.damageList = [...snapshot.damageList];
    if (snapshot.damageRecipients) {
      workflow.damageRecipients = snapshot.damageRecipientsWasSet
        ? new Set(snapshot.damageRecipients)
        : [...snapshot.damageRecipients];
    }
  }

  #replaceToken(collection, oldToken, newToken, includeNew) {
    const next = new Set(collectionValues(collection).filter((token) => !this.#sameToken(token, oldToken)));
    if (includeNew) next.add(newToken);
    return next;
  }

  #sameToken(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    const leftUuid = documentUuid(left);
    const rightUuid = documentUuid(right);
    if (leftUuid && rightUuid) return leftUuid === rightUuid;
    return documentId(left) && documentId(left) === documentId(right);
  }

  #attackHitsToken(attackRoll, token) {
    if (!attackRoll || attackRoll.isFumble === true) return false;
    if (attackRoll.isCritical === true) return true;
    const ac = numberValue(tokenActor(token)?.system?.attributes?.ac?.value, Number.POSITIVE_INFINITY);
    return numberValue(attackRoll.total, Number.NEGATIVE_INFINITY) >= ac;
  }

  #workflowHasHitTarget(workflow, targetToken) {
    return workflowHitTargets(workflow).some((token) => this.#sameToken(token, targetToken));
  }

  async #recalculateWorkflowHits(workflow) {
    if (typeof workflow.checkHits === "function" && workflow.workflowOptions) {
      const options = workflow.workflowOptions;
      const previous = options.noProvokeReaction;
      options.noProvokeReaction = true;
      try {
        await workflow.checkHits();
      }
      finally {
        if (previous === undefined) delete options.noProvokeReaction;
        else options.noProvokeReaction = previous;
      }
    }
    else {
      workflow.hitTargets = new Set(collectionValues(workflow.targets).filter(token => this.#attackHitsToken(workflow.attackRoll, token)));
      workflow.hitTargetsEC = new Set();
    }
    const hitUuids = new Set(workflowHitTargets(workflow).map(documentUuid).filter(Boolean));
    if (Array.isArray(workflow.damageList)) {
      workflow.damageList = workflow.damageList.filter((row) => {
        const tokenUuid = cleanText(row?.tokenUuid ?? row?.token?.uuid);
        return !tokenUuid || hitUuids.has(tokenUuid);
      });
    }
  }

  #removeDamageRecipient(workflow, token) {
    const tokenUuid = documentUuid(token);
    const actorUuid = documentUuid(tokenActor(token)) || actorKey(tokenActor(token));
    for (const key of ["damageList", "damageRecipients"]) {
      const current = workflow?.[key];
      if (!current) continue;
      const filtered = collectionValues(current).filter((row) => {
        const rowToken = row?.token ?? row;
        const rowActor = row?.actor ?? tokenActor(rowToken);
        return cleanText(row?.tokenUuid ?? documentUuid(rowToken)) !== tokenUuid
          && cleanText(row?.actorUuid ?? documentUuid(rowActor) ?? actorKey(rowActor)) !== actorUuid;
      });
      workflow[key] = current instanceof Set ? new Set(filtered) : filtered;
    }
  }

  async #prepareFireRune(workflow, key) {
    const actor = workflow?.actor ?? workflow?.activity?.actor ?? null;
    const sourceItem = workflow?.item ?? workflow?.activity?.item ?? null;
    const hitTargets = whirlwindEffectTargets(workflow) ?? workflowHitTargets(workflow);
    if (
      !isActorDocument(actor)
      || sourceItem?.type !== "weapon"
      || !hitTargets.length
      || !this.#actorHasFeature(actor, "fire")
    ) {
      return true;
    }

    const runeItem = collectionValues(actor?.items).find((item) => automationId(item) === "fire");
    if (!runeItem || !this.#itemHasUse(runeItem)) return true;
    if (!isActorDocument(tokenActor(hitTargets[0]))) return true;

    const queue = this.moduleApi?.reactionQueueService;
    if (typeof queue?.promptDecision !== "function") return true;
    const choice = await queue.promptDecision({
      candidate: {
        actorUuid: documentUuid(actor) || actorKey(actor),
        tokenUuid: documentUuid(workflow?.token),
        itemUuid: documentUuid(runeItem),
        ownerUserIds: ownerUserIds(actor)
      },
      prompt: {
        title: "Огненная руна",
        body: "Пробудить Огненную руну при попадании?",
        acceptLabel: "Призвать кандалы",
        declineLabel: "Пропустить",
        fields: hitTargetFields(hitTargets)
      }
    });
    if (choice?.accepted !== true) return true;
    const targetToken = choice.targetTokenUuid
      ? hitTargets.find(token => documentUuid(token) === choice.targetTokenUuid) : hitTargets[0];
    const targetActor = tokenActor(targetToken);
    if (!isActorDocument(targetActor) || !this.#workflowHasHitTarget(workflow, targetToken)) return true;

    const remote = globalThis.game?.user?.isGM !== true && targetActor.isOwner === false;
    const rollback = remote ? null : await this.#consumeItemUse(runeItem);
    if (!remote && !rollback) return false;
    this.#rememberWorkflowState(this._fireWorkflowStates, key, {
      key,
      actor,
      runeItem,
      targetActor,
      targetToken,
      addressed: hitTargets.length > 1,
      remote,
      rollback,
      applied: false,
      effect: null,
      processing: null
    });
    return true;
  }

  async applyMidiPreDamageRollComplete(workflow) {
    const key = this.#workflowKey(workflow);
    const state = this._fireWorkflowStates.get(key);
    if (state && state.applied !== true) {
      if (!state.processing) {
        const operation = this.#applyPendingFireRune(workflow, state).finally(() => {
          if (state.processing === operation) state.processing = null;
        });
        state.processing = operation;
      }
      await state.processing;
    }
    await this.#applyGiantMightDamageOnce(workflow);
    return true;
  }

  #applyGiantMightDamageOnce(workflow) {
    if (!workflow || typeof workflow !== "object") return Promise.resolve(true);
    const current = this._giantMightDamageWorkflows.get(workflow);
    if (current) return current;
    const operation = this.#applyGiantMightDamage(workflow).catch((error) => {
      this.options.logger?.error?.("Giant's Might damage failed", {
        error,
        workflowId: this.#workflowKey(workflow)
      });
      return false;
    });
    this._giantMightDamageWorkflows.set(workflow, operation);
    return operation;
  }

  async #applyGiantMightDamage(workflow) {
    const actor = workflow?.actor ?? workflow?.activity?.actor ?? null;
    const item = workflow?.item ?? workflow?.activity?.item ?? null;
    const targets = whirlwindEffectTargets(workflow) ?? workflowHitTargets(workflow);
    if (
      !isActorDocument(actor)
      || !this.#giantMightFormEffect(actor)
      || !this.#isWeaponOrUnarmed(item)
      || !targets.length
    ) return true;
    const damageKey = this.#giantMightDamageKey(workflow, actor);
    if (!damageKey || this._giantMightDamageKeys.has(damageKey)) return true;
    const queue = this.moduleApi?.reactionQueueService;
    if (typeof queue?.promptDecision !== "function") return true;
    const choice = await queue.promptDecision({
      candidate: { actorUuid: actorKey(actor), tokenUuid: documentUuid(workflow.token), ownerUserIds: ownerUserIds(actor) },
      prompt: {
        title: "Мощь великана: дополнительный урон",
        body: "Добавить урон «Мощи великана» к этому попаданию?",
        acceptLabel: "Добавить урон",
        declineLabel: "Пропустить",
        fields: hitTargetFields(targets)
      }
    });
    if (choice?.accepted !== true || damageKey !== this.#giantMightDamageKey(workflow, actor)
      || !this.#giantMightFormEffect(actor) || this._giantMightDamageKeys.has(damageKey)) {
      return true;
    }
    const target = choice.targetTokenUuid
      ? targets.find(token => documentUuid(token) === choice.targetTokenUuid) : targets[0];
    if (!target || !this.#workflowHasHitTarget(workflow, target)) return true;
    this.#claimGiantMightDamage(damageKey);

    const previousRolls = [...(workflow?.bonusDamageRolls ?? [])];
    try {
      const damageType = this.#workflowDamageType(workflow);
      const roll = await this.#createDamageRoll(
        this.#giantMightDamageFormula(actor),
        damageType,
        actor,
        "Мощь великана"
      );
      if (isWhirlwindActivity(workflow.activity)) markWhirlwindDamageRolls({ rolls: [roll] }, workflow.rebreyaWhirlwind?.selectedTargetUuid ?? null);
      else if (targets.length > 1) markDamageRollTarget(roll, documentUuid(target));
      const nextRolls = [...previousRolls, roll];
      if (typeof workflow?.setBonusDamageRolls === "function") {
        await workflow.setBonusDamageRolls(nextRolls);
      }
      else {
        workflow.bonusDamageRolls = nextRolls;
      }
      return true;
    }
    catch (error) {
      this._giantMightDamageKeys.delete(damageKey);
      if (typeof workflow?.setBonusDamageRolls === "function") {
        await workflow.setBonusDamageRolls(previousRolls);
      }
      else if (workflow) {
        workflow.bonusDamageRolls = previousRolls;
      }
      throw error;
    }
  }

  #giantMightDamageKey(workflow, actor) {
    const combat = globalThis.game?.combat;
    if (combat) {
      const token = workflow?.token ?? workflow?.tokenDocument ?? workflow?.subject?.token ?? actor?.token;
      if (!isCombatActorActive(combat, token ?? actor)) return "";
      return [
        cleanText(combat.uuid ?? combat.id ?? combat._id),
        numberValue(combat.round, 0),
        numberValue(combat.turn, -1),
        actorKey(actor),
        "giant-might-damage"
      ].join(":");
    }
    return `${this.#workflowKey(workflow)}:${actorKey(actor)}:giant-might-damage`;
  }

  #claimGiantMightDamage(key) {
    this._giantMightDamageKeys.add(key);
    if (this._giantMightDamageKeys.size > 256) {
      this._giantMightDamageKeys.delete(this._giantMightDamageKeys.values().next().value);
    }
  }

  #isWeaponOrUnarmed(item) {
    if (!item) return false;
    if (item.type === "weapon") return true;
    const identifier = cleanText(item?.system?.identifier).toLowerCase();
    const actionType = cleanText(item?.system?.actionType ?? item?.system?.type?.value).toLowerCase();
    return identifier === "unarmed-strike"
      || identifier.endsWith("-unarmed-strike")
      || (["mwak", "rwak"].includes(actionType) && /(?:unarmed|безоруж)/iu.test(cleanText(item?.name)));
  }

  #giantMightDamageFormula(actor) {
    if (this.#actorHasFeature(actor, "runic-juggernaut")) return "1d10";
    if (this.#actorHasFeature(actor, "great-stature")) return "1d8";
    return GIANT_MIGHT_DAMAGE_FORMULA;
  }

  #workflowDamageType(workflow) {
    const values = [
      workflow?.defaultDamageType,
      workflow?.damageType,
      collectionValues(workflow?.damageDetail)[0]?.type,
      collectionValues(workflow?.item?.system?.damage?.base?.types)[0]
    ];
    return cleanText(values.find((value) => cleanText(value)));
  }

  async #applyPendingFireRune(workflow, state) {
    const previousRolls = [...(workflow?.bonusDamageRolls ?? [])];
    try {
      const roll = await this.#createDamageRoll("2d6", "fire", state.actor, "Огненная руна");
      if (isWhirlwindActivity(workflow.activity)) markWhirlwindDamageRolls({ rolls: [roll] }, workflow.rebreyaWhirlwind?.selectedTargetUuid ?? null);
      else if (state.addressed) markDamageRollTarget(roll, documentUuid(state.targetToken));
      const nextRolls = [...previousRolls, roll];
      if (typeof workflow?.setBonusDamageRolls === "function") {
        await workflow.setBonusDamageRolls(nextRolls);
      }
      else {
        workflow.bonusDamageRolls = nextRolls;
      }

      if (state.remote) {
        const attackId = workflow.chatCard?.id ?? workflow.itemCardId;
        const result = attackId && await this.moduleApi?.socketCommandBus?.request?.(FIRE_RUNE_COMMAND, {
          attackId, targetTokenUuid: documentUuid(state.targetToken), itemUuid: documentUuid(state.runeItem)
        });
        if (result?.applied !== true) throw new Error("Fire Rune hit was not authorized");
      }
      else await this.#resolveFireShackles(state);
      state.applied = true;
      state.rollback = null;
      return true;
    }
    catch (error) {
      if (state.effect) await this.#deleteActorEffect(state.targetActor, state.effect);
      if (typeof workflow?.setBonusDamageRolls === "function") {
        await workflow.setBonusDamageRolls(previousRolls);
      }
      else if (workflow) {
        workflow.bonusDamageRolls = previousRolls;
      }
      await state.rollback?.();
      this._fireWorkflowStates.delete(state.key);
      this.options.logger?.error?.("Fire Rune workflow failed", { error, workflowId: state.key });
      return false;
    }
  }

  async applyRemoteFireRune(payload, { sender } = {}) {
    const hit = await resolveClassCombatHit(payload, { sender });
    const runeItem = globalThis.fromUuidSync?.(payload.itemUuid) ?? await globalThis.fromUuid?.(payload.itemUuid);
    if (!hit || hit.item.type !== "weapon" || automationId(runeItem) !== "fire"
      || !this.#actorStillOwnsItem(hit.actor, runeItem)) throw new Error("Огненная руна: источник или попадание не подтверждены.");
    const { receipt, existing } = await reserveClassCombatOperation("fire", hit, runeItem);
    if (existing) {
      const marker = getProperty(existing, `flags.${MODULE_ID}.classCombatReceipt`);
      return { applied: marker?.applied === true && marker.target === payload.targetTokenUuid };
    }
    if (!receipt) return { applied: false };
    const rollback = await this.#consumeItemUse(runeItem);
    if (!rollback) return { applied: false };
    const state = { actor: hit.actor, targetActor: hit.target, targetToken: hit.token, runeItem };
    try {
      await this.#resolveFireShackles(state);
      await receipt.update({ [`flags.${MODULE_ID}.classCombatReceipt.applied`]: true });
      return { applied: true };
    }
    catch (error) {
      if (state.effect) await this.#deleteActorEffect(hit.target, state.effect);
      await rollback();
      throw error;
    }
  }

  async #resolveFireShackles(state) {
    const dc = 8 + proficiencyBonus(state.actor) + Math.floor(numberValue(state.actor?.system?.abilities?.con?.mod, 0));
    const saved = await this.#rollSave(state.targetActor, "str", dc, "Огненная руна");
    if (saved == null) throw new Error("Fire Rune saving throw was canceled");
    if (saved || collectionValues(state.targetActor.system?.traits?.ci?.value).includes("restrained")) return;
    state.effect = await this.#createFireShackles(state.targetActor, state, dc);
    if (!state.effect) throw new Error("Fire Rune shackles could not be created");
  }

  async applyMidiRollComplete(workflow) {
    const key = this.#workflowKey(workflow);
    if (key) {
      const state = this._fireWorkflowStates.get(key);
      if (state && state.applied !== true) {
        await state.rollback?.();
      }
      this._fireWorkflowStates.delete(key);
      this._fireWorkflowPromises.delete(key);
    }
    return true;
  }

  async #createDamageRoll(formula, damageType, actor, flavor) {
    if (typeof this.options.createDamageRoll === "function") {
      return this.options.createDamageRoll(formula, damageType, actor, flavor);
    }
    const RollClass = globalThis.CONFIG?.Dice?.DamageRoll ?? globalThis.Roll;
    if (typeof RollClass !== "function") throw new Error("Damage roll class is unavailable");
    const typedFormula = damageType ? `${formula}[${damageType}]` : formula;
    const roll = new RollClass(typedFormula, actor?.getRollData?.() ?? {}, {
      type: damageType,
      flavor
    });
    if (typeof roll.evaluate === "function" && !roll._evaluated) await roll.evaluate();
    return roll;
  }

  async #createFireShackles(targetActor, state, dc) {
    if (typeof targetActor?.createEmbeddedDocuments !== "function") return null;
    const effectData = {
      name: "Огненная руна: огненные кандалы",
      type: "base",
      img: cleanText(state.runeItem?.img, "icons/svg/net.svg"),
      origin: documentUuid(state.runeItem),
      disabled: false,
      transfer: false,
      duration: {
        seconds: 60,
        rounds: 10,
        turns: null,
        startRound: null,
        startTurn: null,
        combat: null,
        startTime: globalThis.game?.time?.worldTime ?? null
      },
      statuses: ["restrained"],
      changes: [{
        key: "flags.midi-qol.OverTime",
        mode: EFFECT_MODE_CUSTOM,
        value: "turn=start,damageRoll=2d6,damageType=fire,label=Огненная руна",
        priority: 20
      }, {
        key: "flags.midi-qol.OverTime",
        mode: EFFECT_MODE_CUSTOM,
        value: `turn=end,saveAbility=str,saveDC=${dc},label=Огненная руна`,
        priority: 20
      }],
      flags: {
        dae: { stackable: "noneName" },
        [MODULE_ID]: {
          managed: true,
          runeKnight: {
            id: "fire",
            automation: "fire-shackles",
            sourceActorUuid: documentUuid(state.actor) || actorKey(state.actor),
            sourceItemUuid: documentUuid(state.runeItem),
            saveDC: dc
          }
        }
      },
      description: "Цель опутана; получает 2d6 урона огнём в начале хода и повторяет спасбросок Силы в конце хода."
    };
    const created = await targetActor.createEmbeddedDocuments("ActiveEffect", [effectData], { render: false });
    return Array.isArray(created) ? created[0] ?? null : created ?? null;
  }

  async #resolveFireRepeatSave(actor, eventKey) {
    const effects = this.#fireShackleEffects(actor);
    if (!effects.length || !this.#claimTurnEvent(eventKey)) return false;
    let removed = false;
    for (const effect of effects) {
      const dc = Math.max(1, Math.floor(numberValue(
        getProperty(effect, `flags.${MODULE_ID}.runeKnight.saveDC`),
        8
      )));
      if (await this.#rollSave(actor, "str", dc)) {
        removed = (await this.#deleteActorEffect(actor, effect)) || removed;
      }
    }
    return removed;
  }

  async #applyFireStartTurnDamage(actor, eventKey) {
    if (!this.#fireShackleEffects(actor).length || !this.#claimTurnEvent(eventKey)) return false;
    if (typeof this.options.applyDamage === "function") {
      return this.options.applyDamage(actor, "2d6", "fire", { label: "Огненная руна" });
    }
    if (typeof actor?.applyDamage !== "function") return false;
    const roll = await this.#createDamageRoll("2d6", "fire", actor, "Огненная руна");
    await actor.applyDamage([{ value: Math.max(0, numberValue(roll?.total, 0)), type: "fire" }], {
      flavor: "Огненная руна"
    });
    return true;
  }

  #fireShackleEffects(actor) {
    return collectionValues(actor?.effects).filter((effect) => (
      isRuneKnightEffectActive(effect)
      && cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.automation`)) === "fire-shackles"
    ));
  }

  #midiIsActive() {
    return globalThis.game?.modules?.get?.("midi-qol")?.active === true;
  }

  #turnEventKey(combat, updateData, updateOptions, actor, suffix) {
    const current = updateData?.current ?? updateOptions?.current ?? {};
    const previous = updateData?.previous ?? updateOptions?.previous ?? {};
    const turn = suffix.endsWith("start")
      ? current.turn ?? combat?.turn
      : previous.turn ?? combat?.turn;
    return [
      cleanText(combat?.uuid ?? combat?.id ?? combat?._id),
      current.round ?? previous.round ?? combat?.round ?? 0,
      turn ?? -1,
      actorKey(actor),
      suffix
    ].join(":");
  }

  #claimTurnEvent(key) {
    const normalized = cleanText(key);
    if (!normalized || this._fireTurnKeys.has(normalized)) return false;
    this._fireTurnKeys.add(normalized);
    while (this._fireTurnKeys.size > 256) {
      this._fireTurnKeys.delete(this._fireTurnKeys.values().next().value);
    }
    return true;
  }

  #currentTurnCombatant(combat, updateData = {}, updateOptions = {}) {
    const direct = updateData?.current?.combatant
      ?? updateOptions?.current?.combatant
      ?? updateData?.combatant
      ?? updateOptions?.combatant
      ?? combat?.combatant
      ?? null;
    if (direct) return direct;
    const turn = numberValue(
      updateData?.current?.turn ?? updateOptions?.current?.turn ?? combat?.turn,
      Number.NaN
    );
    return Number.isInteger(turn) ? collectionValues(combat?.turns)[turn] ?? null : null;
  }

  #workflowKey(workflow) {
    if (!workflow || typeof workflow !== "object") return "";
    if (!workflow._rebreyaRuneKnightWorkflowId) {
      workflow._rebreyaRuneKnightWorkflowId = cleanText(
        workflow.id ?? workflow.uuid ?? workflow.workflowId,
        `workflow-${Math.random().toString(36).slice(2, 12)}`
      );
    }
    return cleanText(workflow._rebreyaRuneKnightWorkflowId);
  }

  #rememberWorkflowState(map, key, state) {
    map.delete(key);
    map.set(key, state);
    while (map.size > MAX_WORKFLOW_STATES) {
      map.delete(map.keys().next().value);
    }
  }

  #stoneReactionProvider() {
    return {
      listCandidates: (_context, capabilityIndex) => capabilityIndex?.list?.(STONE_REACTION_KIND) ?? [],
      isTriggerValid: (context) => this.#stoneTrigger(context)?.active !== false,
      revalidateCandidate: (candidate, context) => this.#canUseStoneReaction(
        this.#normalizeStoneCandidate(candidate),
        this.#stoneTrigger(context)
      ),
      buildPrompt: (candidate, context) => {
        const normalized = this.#normalizeStoneCandidate(candidate);
        const trigger = this.#stoneTrigger(context);
        return {
          title: "Каменная руна",
          body: `Пробудить Каменную руну против ${cleanText(trigger?.targetActor?.name, "завершившего ход существа")}?`,
          acceptLabel: "Пробудить руну",
          declineLabel: "Пропустить"
        };
      },
      pay: (candidate) => this.#payStoneReaction(this.#normalizeStoneCandidate(candidate)),
      apply: (candidate, _choice, context) => this.#applyStoneReaction(
        this.#normalizeStoneCandidate(candidate),
        this.#stoneTrigger(context)
      ),
      rollback: (candidate, transaction) => this.#rollbackStoneReaction(
        this.#normalizeStoneCandidate(candidate),
        transaction
      ),
      serializeEffect: (effect) => ({
        applied: effect?.applied === true,
        saved: effect?.saved === true,
        effectUuid: cleanText(effect?.effectUuid)
      })
    };
  }

  #normalizeStoneCandidate(candidate = {}) {
    const item = candidate.item
      ?? globalThis.fromUuidSync?.(candidate.itemUuid)
      ?? null;
    const actor = candidate.actor
      ?? actorFromEmbeddedDocument(item)
      ?? globalThis.fromUuidSync?.(candidate.actorUuid)
      ?? null;
    const resolvedItem = item ?? collectionValues(actor?.items).find((entry) => (
      documentUuid(entry) === cleanText(candidate.itemUuid)
    ));
    const token = candidate.token
      ?? globalThis.fromUuidSync?.(candidate.tokenUuid)
      ?? null;
    return {
      ...candidate,
      id: cleanText(candidate.id, actorKey(actor)),
      actor,
      actorUuid: cleanText(candidate.actorUuid, documentUuid(actor) || actorKey(actor)),
      token,
      tokenUuid: cleanText(candidate.tokenUuid, documentUuid(token)),
      item: resolvedItem,
      itemUuid: cleanText(candidate.itemUuid, documentUuid(resolvedItem)),
      reactionType: STONE_REACTION_KIND
    };
  }

  #stoneTrigger(context = {}) {
    const triggerId = cleanText(context?.triggerId);
    const local = this._stoneTriggers.get(triggerId);
    if (local) return local;
    const targetActor = globalThis.fromUuidSync?.(context?.targetActorUuid) ?? null;
    const targetToken = globalThis.fromUuidSync?.(context?.targetTokenUuid) ?? null;
    return {
      targetActor: targetActor ?? tokenActor(targetToken),
      targetToken,
      active: context?.triggerActive !== false
    };
  }

  async #canUseStoneReaction(candidate, trigger) {
    const actor = candidate?.actor;
    const item = candidate?.item;
    if (!isActorDocument(actor) || !item || automationId(item) !== "stone" || !this.#itemHasUse(item)) {
      return false;
    }
    if (actorIsIncapacitated(actor) || !isActorDocument(trigger?.targetActor)) return false;
    const reactionState = this.moduleApi?.combatAttackService?.canUseReaction?.(actor, 1);
    if (reactionState && reactionState.canUse === false) return false;
    if (!this.#isVisible(candidate, trigger)) return false;
    return this.#distanceFeet(candidate?.token, trigger?.targetToken) <= STONE_RANGE_FEET;
  }

  #itemHasUse(item) {
    const uses = item?.system?.uses ?? {};
    return Math.max(0, Math.floor(numberValue(uses.spent, 0)))
      < this.#itemUseMaximum(item);
  }

  #itemUseMaximum(item) {
    const rawMaximum = item?.system?.uses?.max;
    if (Number.isFinite(Number(rawMaximum))) {
      return Math.max(0, Math.floor(Number(rawMaximum)));
    }
    const actor = actorFromEmbeddedDocument(item);
    const rollData = actor?.getRollData?.() ?? actor?.system ?? {};
    const formula = cleanText(rawMaximum);
    if (!formula) return 0;
    const scalePath = formula.startsWith("@") ? formula.slice(1) : formula;
    const direct = getProperty(rollData, scalePath);
    const directValue = numberValue(direct?.value ?? direct, Number.NaN);
    if (Number.isFinite(directValue)) return Math.max(0, Math.floor(directValue));
    const replaced = globalThis.Roll?.replaceFormulaData?.(formula, rollData, {
      missing: "0",
      warn: false
    });
    return Math.max(0, Math.floor(numberValue(replaced, 0)));
  }

  #isVisible(candidate, trigger) {
    if (typeof this.options.isVisible === "function") {
      return this.options.isVisible(candidate, trigger) === true;
    }
    if (typeof globalThis.MidiQOL?.canSee === "function") {
      const observer = candidate?.token?.object ?? candidate?.token;
      const target = trigger?.targetToken?.object ?? trigger?.targetToken;
      return Boolean(observer && target && globalThis.MidiQOL.canSee(observer, target));
    }
    return candidate?.token?.visible !== false
      && candidate?.token?.isVisible !== false
      && trigger?.targetToken?.visible !== false
      && trigger?.targetToken?.isVisible !== false;
  }

  #distanceFeet(leftToken, rightToken) {
    if (typeof this.options.distanceFeet === "function") {
      return numberValue(this.options.distanceFeet(leftToken, rightToken), Number.POSITIVE_INFINITY);
    }
    const left = tokenCenter(leftToken);
    const right = tokenCenter(rightToken);
    if (!left || !right) return Number.POSITIVE_INFINITY;
    const grid = globalThis.canvas?.grid;
    if (typeof grid?.measurePath === "function") {
      const measured = grid.measurePath([left, right]);
      return numberValue(measured?.distance, Number.POSITIVE_INFINITY);
    }
    if (typeof grid?.measureDistance === "function") {
      return numberValue(grid.measureDistance(left, right), Number.POSITIVE_INFINITY);
    }
    return Number.POSITIVE_INFINITY;
  }

  async #payStoneReaction(candidate) {
    const rollback = await this.#consumeItemUse(candidate?.item);
    return rollback ? { paid: true, rollback } : { paid: false };
  }

  async #applyStoneReaction(candidate, trigger) {
    const targetActor = trigger?.targetActor;
    if (!isActorDocument(targetActor)) return { applied: false };
    const dc = 8
      + proficiencyBonus(candidate?.actor)
      + Math.floor(numberValue(candidate?.actor?.system?.abilities?.con?.mod, 0));
    const saved = await this.#rollSave(targetActor, "wis", dc);
    if (saved == null) return { applied: false };
    if (saved === true || collectionValues(targetActor.system?.traits?.ci?.value).includes("charmed")) {
      return { applied: true, saved: saved === true, effectUuid: "" };
    }

    const effect = await this.#createStoneStupor(targetActor, candidate, dc);
    if (!effect) return { applied: false };
    return {
      applied: true,
      saved: false,
      effect,
      effectUuid: documentUuid(effect),
      effectId: documentId(effect),
      targetActor
    };
  }

  async #rollbackStoneReaction(_candidate, transaction) {
    const effect = transaction?.effect;
    if (effect?.effect && effect?.targetActor) {
      await this.#deleteActorEffect(effect.targetActor, effect.effect);
    }
    await transaction?.payment?.rollback?.();
  }

  async #createStoneStupor(targetActor, candidate, dc) {
    if (typeof targetActor?.createEmbeddedDocuments !== "function") return null;
    const movementChanges = MOVEMENT_PATHS.map((movement) => ({
      key: `system.attributes.movement.${movement}`,
      mode: EFFECT_MODE_OVERRIDE,
      value: "0",
      priority: 30
    }));
    const effectData = {
      name: "Каменная руна: магический ступор",
      type: "base",
      img: cleanText(candidate?.item?.img, "icons/svg/daze.svg"),
      origin: documentUuid(candidate?.item),
      disabled: false,
      transfer: false,
      duration: {
        seconds: 60,
        rounds: 10,
        turns: null,
        startRound: null,
        startTurn: null,
        combat: null,
        startTime: globalThis.game?.time?.worldTime ?? null
      },
      statuses: ["charmed", "incapacitated"],
      changes: [
        ...movementChanges,
        {
          key: "flags.midi-qol.OverTime",
          mode: EFFECT_MODE_CUSTOM,
          value: `turn=end,saveAbility=wis,saveDC=${dc},label=Каменная руна`,
          priority: 20
        }
      ],
      flags: {
        dae: { stackable: "noneName" },
        [MODULE_ID]: {
          managed: true,
          runeKnight: {
            id: "stone",
            automation: "stone-stupor",
            sourceActorUuid: documentUuid(candidate?.actor) || actorKey(candidate?.actor),
            sourceItemUuid: documentUuid(candidate?.item),
            saveDC: dc
          }
        }
      },
      description: "Скорость равна 0; цель очарована и недееспособна. Спасбросок Мудрости повторяется в конце каждого хода."
    };
    const created = await targetActor.createEmbeddedDocuments("ActiveEffect", [effectData], { render: false });
    return Array.isArray(created) ? created[0] ?? null : created ?? null;
  }

  async #resolveStoneRepeatSave(actor) {
    if (globalThis.game?.modules?.get?.("midi-qol")?.active === true) return false;
    const effects = collectionValues(actor?.effects).filter((effect) => (
      isRuneKnightEffectActive(effect)
      && cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.automation`)) === "stone-stupor"
    ));
    let removed = false;
    for (const effect of effects) {
      const dc = Math.max(1, Math.floor(numberValue(
        getProperty(effect, `flags.${MODULE_ID}.runeKnight.saveDC`),
        8
      )));
      if (await this.#rollSave(actor, "wis", dc)) {
        removed = (await this.#deleteActorEffect(actor, effect)) || removed;
      }
    }
    return removed;
  }

  async #rollSave(actor, ability, dc, label = "Каменная руна") {
    if (typeof this.options.rollSave === "function") {
      return this.options.rollSave(actor, ability, dc);
    }
    if (typeof actor?.rollSavingThrow !== "function") return null;
    const rolls = await actor.rollSavingThrow({ ability, target: dc }, { configure: false }, {
      data: { flavor: `${label}: спасбросок ${ability.toUpperCase()} Сл ${dc}` }
    });
    const roll = Array.isArray(rolls) ? rolls[0] : rolls;
    return roll?.total != null && Number.isFinite(Number(roll.total)) ? Number(roll.total) >= dc : null;
  }

  async #deleteActorEffect(actor, effect) {
    const id = documentId(effect);
    if (id && typeof actor?.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("ActiveEffect", [id], { render: false });
      return true;
    }
    if (typeof effect?.delete === "function") {
      await effect.delete({ render: false });
      return true;
    }
    return false;
  }

  #endedTurnCombatant(combat, updateData = {}, updateOptions = {}) {
    const direct = updateData?.previous?.combatant
      ?? updateOptions?.previous?.combatant
      ?? updateData?.previousCombatant
      ?? updateOptions?.previousCombatant
      ?? updateData?.endedCombatant
      ?? updateOptions?.endedCombatant
      ?? combat?.previous?.combatant
      ?? null;
    if (direct) return direct;

    const previousTurn = numberValue(
      updateData?.previous?.turn
        ?? updateOptions?.previous?.turn
        ?? combat?.previous?.turn,
      Number.NaN
    );
    if (Number.isInteger(previousTurn)) {
      return collectionValues(combat?.turns)[previousTurn] ?? null;
    }
    return null;
  }

  #actorHasFeature(actor, id) {
    return collectionValues(actor?.items).some(item => automationId(item) === id);
  }

  async #activateGiantMight(actor, item, token) {
    if (this.#giantMightFormEffect(actor)) return true;
    const payment = await this.#payGiantMight(actor, item, token);
    if (!payment) return false;

    let effect = null;
    try {
      const resizeService = this.moduleApi?.equipmentSizeService;
      const preview = token && resizeService?.getCreatureResizePreview(token);
      const selection = await this.#chooseGiantMightSize(actor, item, token);
      const form = await this.#giantMightFormPlan(actor, token, selection.size);
      const weaponIds = form.grew && resizeService
        ? await resizeService.chooseHeldWeaponResize(actor, token, form.appliedActorSize, { choice: selection.weaponChoice, preview }) : [];
      if (form.grew && resizeService) {
        const gridSize = Math.max(1, numberValue(globalThis.canvas?.dimensions?.size ?? globalThis.canvas?.grid?.size, 1));
        form.grew = await this.#canGrowGiantToken(token?.document ?? token, form.appliedToken, form.originalToken, gridSize);
        if (!form.grew) form.reachBonus = 0;
      }
      effect = await this.#createGiantMightFormEffect(actor, item, form);
      if (!effect) throw new Error("Giant's Might form could not be created");
      effect._rebreyaGiantMightToken = token?.document ?? token ?? null;
      if (form.grew) await this.#applyGiantMightGrowth(actor, token, form, { weaponIds, expected: preview?.expected });
      return true;
    }
    catch (error) {
      try {
        if (effect) {
          try { await this.#restoreGiantMightForm(actor, effect, { offerWeapons: false }); }
          finally { await this.#deleteActorEffect(actor, effect); }
        }
      }
      catch (restoreError) { error.message += ` Восстановление формы: ${restoreError.message}`; }
      finally { await payment.rollback?.(); }
      throw error;
    }
  }

  async #payGiantMight(actor, item, token) {
    if (this.#itemHasUse(item)) {
      const rollback = await this.#consumeItemUse(item);
      return rollback ? { item, resource: "giant-might", rollback } : null;
    }

    const dominanceItem = this.#findDominanceItem(actor);
    if (!dominanceItem || !this.#itemHasUse(dominanceItem)) return null;
    const queue = this.moduleApi?.reactionQueueService;
    if (typeof queue?.promptDecision !== "function") return null;
    const choice = await queue.promptDecision({
      candidate: {
        actorUuid: documentUuid(actor) || actorKey(actor),
        tokenUuid: documentUuid(token),
        itemUuid: documentUuid(dominanceItem),
        ownerUserIds: ownerUserIds(actor)
      },
      prompt: {
        title: "Мощь великана",
        body: "Применения Мощи великана закончились. Потратить одну кость доминирования?",
        acceptLabel: "Потратить кость",
        declineLabel: "Отмена"
      }
    });
    if (choice?.accepted !== true) return null;
    const rollback = await this.#consumeItemUse(dominanceItem);
    return rollback ? { item: dominanceItem, resource: "dominance", rollback } : null;
  }

  #findDominanceItem(actor) {
    return collectionValues(actor?.items).find((item) => {
      const identifier = cleanText(item?.system?.identifier);
      if (identifier === FIGHTER_DOMINANCE_IDENTIFIER || identifier.endsWith(`-${FIGHTER_DOMINANCE_IDENTIFIER}`)) {
        return true;
      }
      return normalizeText(item?.name) === "стиль доминирования";
    }) ?? null;
  }

  async #chooseGiantMightSize(actor, item, token) {
    if (!this.#actorHasFeature(actor, "runic-juggernaut")) return { size: "" };
    const queue = this.moduleApi?.reactionQueueService;
    if (typeof queue?.promptDecision !== "function") return { size: "" };
    const resizeService = this.moduleApi?.equipmentSizeService;
    const hasWeapons = Boolean(resizeService?.getHeldWeapons(actor)?.length);
    const promptOwnerIds = resizeService?.getResizePromptOwnerIds(actor) ?? ownerUserIds(actor);
    const choice = await queue.promptDecision({
      candidate: {
        actorUuid: documentUuid(actor) || actorKey(actor),
        tokenUuid: documentUuid(token),
        itemUuid: documentUuid(item),
        ownerUserIds: promptOwnerIds
      },
      prompt: {
        title: "Рунический исполин",
        body: "Увеличить размер формы сразу до Огромного, если для неё достаточно места?",
        acceptLabel: "Стать Огромным",
        declineLabel: "Обычный рост",
        fields: [{
          name: "size",
          type: "select",
          label: "Размер формы",
          options: [{ value: "huge", label: "Огромный" }]
        }, ...(hasWeapons ? [{ name: "resizeWeapons", type: "select", label: "Оружие в руках",
          options: [{ value: "yes", label: "Изменить вместе с существом" }, { value: "no", label: "Оставить размер оружия" }] }] : [])]
      }
    });
    return { size: choice?.accepted === true && cleanText(choice?.size, "huge") === "huge" ? "huge" : "",
      weaponChoice: hasWeapons && choice?.accepted === true ? { ...choice, resizeResponderUserId: promptOwnerIds[0] } : undefined };
  }

  async #giantMightFormPlan(actor, token, targetSize = "") {
    const tokenDocument = token?.document ?? token ?? null;
    const originalActorSize = cleanText(actor?.system?.traits?.size, "med").toLowerCase();
    const sizeIndex = Math.max(0, SIZE_ORDER.indexOf(originalActorSize));
    const ordinarySizeIndex = Math.min(sizeIndex + 1, SIZE_ORDER.length - 1);
    const requestedSizeIndex = SIZE_ORDER.indexOf(cleanText(targetSize).toLowerCase());
    const appliedActorSize = SIZE_ORDER[Math.max(
      ordinarySizeIndex,
      requestedSizeIndex >= 0 ? requestedSizeIndex : ordinarySizeIndex
    )];
    const originalToken = tokenDocument ? {
      x: numberValue(tokenDocument.x, 0),
      y: numberValue(tokenDocument.y, 0),
      width: numberValue(tokenDocument.width, 1),
      height: numberValue(tokenDocument.height, 1)
    } : null;
    const footprint = getCreatureTokenFootprint(appliedActorSize).width;
    const gridSize = Math.max(1, numberValue(
      globalThis.canvas?.dimensions?.size ?? globalThis.canvas?.grid?.size,
      1
    ));
    const appliedToken = originalToken ? {
      x: originalToken.x - ((footprint - originalToken.width) * gridSize / 2),
      y: originalToken.y - ((footprint - originalToken.height) * gridSize / 2),
      width: footprint,
      height: footprint
    } : null;
    const canGrow = Boolean(tokenDocument && appliedActorSize !== originalActorSize)
      && await this.#canGrowGiantToken(tokenDocument, appliedToken, originalToken, gridSize);
    const reachBonus = this.#actorHasFeature(actor, "runic-juggernaut")
      && appliedActorSize === "huge" && (canGrow || originalActorSize === "huge") ? 5 : 0;
    return {
      grew: canGrow,
      reachBonus,
      tokenUuid: documentUuid(tokenDocument),
      originalActorSize,
      appliedActorSize,
      originalToken,
      appliedToken
    };
  }

  async #canGrowGiantToken(token, applied, original, gridSize) {
    if (!token || !applied || !original) return false;
    if (typeof this.options.canGrowToken === "function") {
      return await this.options.canGrowToken(token, applied, original) === true;
    }
    const sceneRect = globalThis.canvas?.dimensions?.sceneRect;
    if (sceneRect && (
      applied.x < sceneRect.x
      || applied.y < sceneRect.y
      || applied.x + (applied.width * gridSize) > sceneRect.x + sceneRect.width
      || applied.y + (applied.height * gridSize) > sceneRect.y + sceneRect.height
    )) return false;

    const overlaps = collectionValues(globalThis.canvas?.scene?.tokens).some((other) => {
      const otherDocument = other?.document ?? other;
      if (this.#sameToken(token, otherDocument)) return false;
      const left = numberValue(otherDocument?.x, Number.NaN);
      const top = numberValue(otherDocument?.y, Number.NaN);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return false;
      const right = left + (Math.max(0, numberValue(otherDocument?.width, 1)) * gridSize);
      const bottom = top + (Math.max(0, numberValue(otherDocument?.height, 1)) * gridSize);
      const appliedRight = applied.x + (applied.width * gridSize);
      const appliedBottom = applied.y + (applied.height * gridSize);
      return applied.x < right && appliedRight > left && applied.y < bottom && appliedBottom > top;
    });
    if (overlaps) return false;

    const tokenObject = token?.object ?? token;
    if (typeof tokenObject?.checkCollision === "function") {
      const origin = tokenObject.center ?? {
        x: original.x + (original.width * gridSize / 2),
        y: original.y + (original.height * gridSize / 2)
      };
      const inset = Math.max(1, gridSize * 0.05);
      const corners = [
        { x: applied.x + inset, y: applied.y + inset },
        { x: applied.x + (applied.width * gridSize) - inset, y: applied.y + inset },
        { x: applied.x + inset, y: applied.y + (applied.height * gridSize) - inset },
        {
          x: applied.x + (applied.width * gridSize) - inset,
          y: applied.y + (applied.height * gridSize) - inset
        }
      ];
      if (corners.some((destination) => tokenObject.checkCollision(destination, {
        origin,
        type: "move",
        mode: "any"
      }) === true)) return false;
    }
    return true;
  }

  async #createGiantMightFormEffect(actor, item, form) {
    if (typeof actor?.createEmbeddedDocuments !== "function") return null;
    const nativeRollMode = Number(globalThis.game?.system?.version?.split(".")[0]) >= 6;
    const effectData = {
      name: "Мощь великана",
      type: "base",
      img: cleanText(item?.img, "icons/magic/control/buff-strength-muscle-damage-orange.webp"),
      origin: documentUuid(item),
      disabled: false,
      transfer: false,
      duration: {
        seconds: 60,
        rounds: null,
        turns: null,
        startRound: null,
        startTurn: null,
        combat: null,
        startTime: globalThis.game?.time?.worldTime ?? null
      },
      statuses: [],
      changes: nativeRollMode ? [
        { key: "system.abilities.str.check.roll.mode", mode: EFFECT_MODE_ADD, value: "1", priority: 20 },
        { key: "system.abilities.str.save.roll.mode", mode: EFFECT_MODE_ADD, value: "1", priority: 20 }
      ] : [
        { key: "flags.midi-qol.advantage.ability.check.str", mode: EFFECT_MODE_CUSTOM, value: "1", priority: 20 },
        { key: "flags.midi-qol.advantage.ability.save.str", mode: EFFECT_MODE_CUSTOM, value: "1", priority: 20 }
      ],
      flags: {
        dae: { stackable: "noneName" },
        [MODULE_ID]: {
          managed: true,
          runeKnight: {
            id: "giant-might",
            automation: GIANT_MIGHT_FORM_AUTOMATION,
            sourceItemUuid: documentUuid(item),
            reachBonus: numberValue(form?.reachBonus, 0),
            form: clone(form)
          }
        }
      },
      description: "Преимущество на проверки и спасброски Силы; дополнительный урон один раз за ход."
    };
    const created = await actor.createEmbeddedDocuments("ActiveEffect", [effectData], { render: false });
    return Array.isArray(created) ? created[0] ?? null : created ?? null;
  }

  async #applyGiantMightGrowth(actor, token, form, { weaponIds = [], expected } = {}) {
    if (this.moduleApi?.equipmentSizeService) {
      return this.moduleApi.equipmentSizeService.applyPreparedCreatureResize({ actor, token: token?.document ?? token,
        size: form.appliedActorSize, tokenPatch: form.appliedToken, weaponIds, expected });
    }
    await this.#updateDocument(actor, { "system.traits.size": form.appliedActorSize });
    await this.#updateDocument(token?.document ?? token, form.appliedToken);
  }

  #finishGiantMightForm(actor, effect) {
    const current = this._giantMightRestorations.get(effect);
    if (current) return current;
    const restoration = this.#restoreGiantMightForm(actor, effect).catch((error) => {
      this._giantMightRestorations.delete(effect);
      throw error;
    });
    this._giantMightRestorations.set(effect, restoration);
    return restoration;
  }

  async #restoreGiantMightForm(actor, effect, { offerWeapons = true } = {}) {
    const form = getProperty(effect, `flags.${MODULE_ID}.runeKnight.form`);
    if (!form?.grew) return false;
    let restored = false;
    const changeActorSize = cleanText(actor?.system?.traits?.size) === cleanText(form.appliedActorSize);
    const resizeService = this.moduleApi?.equipmentSizeService;
    if (changeActorSize && !resizeService) {
      restored = (await this.#updateDocument(actor, { "system.traits.size": form.originalActorSize })) || restored;
    }
    const token = effect?._rebreyaGiantMightToken
      ?? globalThis.fromUuidSync?.(form.tokenUuid)
      ?? null;
    const tokenDocument = token?.document ?? token;
    const patch = {};
    if (tokenDocument && form.originalToken && form.appliedToken) {
      for (const key of ["x", "y", "width", "height"]) {
        if (numberValue(tokenDocument[key], Number.NaN) === numberValue(form.appliedToken[key], Number.NaN)) {
          patch[key] = form.originalToken[key];
        }
      }
      if (!resizeService) restored = (await this.#updateDocument(tokenDocument, patch)) || restored;
    }
    if (resizeService) {
      const preview = tokenDocument && resizeService.getCreatureResizePreview(tokenDocument);
      const weaponIds = changeActorSize && offerWeapons && tokenDocument
        ? await resizeService.chooseHeldWeaponResize(actor, tokenDocument, form.originalActorSize, { preview }) : [];
      const result = await resizeService.applyPreparedCreatureResize({ actor, token: tokenDocument, size: form.originalActorSize,
        tokenPatch: patch, changeActorSize, weaponIds, expected: preview?.expected });
      restored = result.changed || restored;
    }
    return restored;
  }

  async #updateDocument(document, patch = {}) {
    if (!document || !Object.keys(patch).length) return false;
    if (typeof document.update === "function") {
      await document.update(patch, { render: false });
    }
    for (const [path, value] of Object.entries(patch)) setProperty(document, path, clone(value));
    return true;
  }

  #giantMightFormEffect(actor) {
    return collectionValues(actor?.effects).find((effect) => (
      isRuneKnightEffectActive(effect)
      && cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.automation`)) === GIANT_MIGHT_FORM_AUTOMATION
    )) ?? null;
  }

  #hasRuntimeEffect(actor, item, id) {
    const sourceItemUuid = cleanText(item?.uuid);
    return collectionValues(actor?.effects).some((effect) => (
      isRuneKnightEffectActive(effect)
      && cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.id`)) === id
        && cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.sourceItemUuid`)) === sourceItemUuid
    ));
  }

  async #consumeItemUse(item) {
    if (!item || this._itemUsePayments.has(item)) return null;
    const uses = item?.system?.uses ?? {};
    const spent = Math.max(0, Math.floor(numberValue(uses.spent, 0)));
    const maximum = this.#itemUseMaximum(item);
    if (spent >= maximum) return null;
    this._itemUsePayments.add(item);
    try {
      await updateItem(item, { "system.uses.spent": spent + 1 });
    }
    finally {
      this._itemUsePayments.delete(item);
    }
    let refunded = false;
    return async () => {
      if (refunded) return false;
      refunded = true;
      const current = Math.max(0, Math.floor(numberValue(item.system?.uses?.spent, 0)));
      if (!current) return false;
      return updateItem(item, { "system.uses.spent": current - 1 });
    };
  }

  async #createRuneActivationEffect(actor, item, id) {
    if (typeof actor?.createEmbeddedDocuments !== "function") return false;
    const configurations = {
      frost: {
        name: "Ледяная руна: стойкость",
        seconds: 600,
        changes: [
          "system.abilities.str.bonuses.check",
          "system.abilities.str.bonuses.save",
          "system.abilities.con.bonuses.check",
          "system.abilities.con.bonuses.save"
        ].map((key) => ({ key, mode: EFFECT_MODE_ADD, value: "+2", priority: 20 }))
      },
      hill: {
        name: "Холмовая руна: стойкость великана",
        seconds: 60,
        changes: ["bludgeoning", "piercing", "slashing"].map((value) => ({
          key: "system.traits.dr.value",
          mode: EFFECT_MODE_ADD,
          value,
          priority: 20
        }))
      },
      storm: {
        name: "Штормовая руна: пророческое состояние",
        seconds: 60,
        changes: []
      }
    };
    const configuration = configurations[id];
    if (!configuration) return false;
    const effect = {
      name: configuration.name,
      type: "base",
      img: cleanText(item?.img, "icons/svg/aura.svg"),
      origin: cleanText(item?.uuid),
      disabled: false,
      transfer: false,
      duration: {
        seconds: configuration.seconds,
        rounds: null,
        turns: null,
        startRound: null,
        startTurn: null,
        combat: null,
        startTime: globalThis.game?.time?.worldTime ?? null
      },
      statuses: [],
      changes: configuration.changes,
      flags: {
        dae: { stackable: "noneName" },
        [MODULE_ID]: {
          managed: true,
          runeKnight: {
            id,
            sourceItemUuid: cleanText(item?.uuid),
            propheticState: id === "storm"
          }
        }
      },
      description: cleanText(item?.system?.description?.value)
    };
    const created = await actor.createEmbeddedDocuments("ActiveEffect", [effect], { render: false });
    return Array.isArray(created) ? created.length > 0 : created !== false;
  }

  #actorStillOwnsItem(actor, sourceItem) {
    const sourceUuid = cleanText(sourceItem?.uuid);
    const sourceId = documentId(sourceItem);
    return collectionValues(actor?.items).some((item) => (
      item === sourceItem
        || (sourceUuid && cleanText(item?.uuid) === sourceUuid)
        || (sourceId && documentId(item) === sourceId)
    ));
  }

  async #deleteSourceEffects(actor, sourceItemUuid) {
    if (!sourceItemUuid) return false;
    const effects = collectionValues(actor?.effects).filter((effect) => (
      cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.sourceItemUuid`)) === sourceItemUuid
    ));
    if (!effects.length) return false;

    const ids = effects.map(documentId).filter(Boolean);
    if (ids.length && typeof actor.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
      return true;
    }
    await Promise.all(effects.map((effect) => effect?.delete?.({ render: false })));
    return true;
  }
}
