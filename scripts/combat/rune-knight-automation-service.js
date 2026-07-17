import { MODULE_ID } from "../constants.js";

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
  ["мастер рун", "master-of-runes"]
]);

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
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

function contextIsPoison(...contexts) {
  for (const context of contexts) {
    if (context?.isPoison === true || context?.options?.isPoison === true) return true;
    const values = [
      context?.damageType,
      context?.type,
      context?.options?.damageType,
      context?.options?.type,
      context?.options?.sourceType,
      context?.flavor,
      context?.data?.flavor
    ];
    if (values.some((value) => /(?:^|\W)(?:poison|яд)(?:$|\W)/iu.test(cleanText(value)))) return true;
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
  return collectionValues(actor?.effects).some((effect) => statusIds(effect).has("incapacitated"));
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
    this._actorFeatureCache = new Map();
    this._stoneTriggers = new Map();
    this._fireWorkflowStates = new Map();
    this._fireWorkflowPromises = new Map();
    this._fireTurnKeys = new Set();
    this._hitReactionTriggers = new Map();
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
    }
    const queue = this.moduleApi?.reactionQueueService;
    if (typeof queue?.registerType === "function") {
      queue.registerType(STONE_REACTION_KIND, this.#stoneReactionProvider());
      queue.registerType(CLOUD_REACTION_KIND, this.#cloudReactionProvider());
      queue.registerType(RUNIC_SHIELD_REACTION_KIND, this.#runicShieldReactionProvider());
    }
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
    this.#cacheActorFeatures(actor, items);
    const level = fighterLevel(actor);
    const hasMasterOfRunes = level >= 15 && items.some((item) => automationId(item) === "master-of-runes");
    const runeMaximum = hasMasterOfRunes ? 2 : 1;
    const pb = proficiencyBonus(actor);
    let changed = false;

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
    this._actorFeatureCache.delete(actorKey(actor));
    if (RUNE_IDS.has(id) && !this.#actorStillOwnsItem(actor, item)) {
      await this.#deleteSourceEffects(actor, cleanText(item?.uuid));
    }
    await this.repairActor(actor);
    return true;
  }

  async handleEmbeddedEffectChange(effect) {
    const actor = actorFromEmbeddedDocument(effect);
    if (actor) await this.repairActor(actor);
    return true;
  }

  async applyDnd5ePostUseActivity(activity, usageConfig = {}, results = {}) {
    void usageConfig;
    void results;
    const id = automationId(activity);
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
    if (!actor || !this.#actorHasFeature(actor, "fire") || rollConfig._rebreyaRuneToolExpertise) {
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
    if (multiplier <= 0) return true;

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

  async #resolveCloudReaction(workflow, key) {
    const capabilityIndex = this.moduleApi?.reactionCapabilityIndex;
    const queue = this.moduleApi?.reactionQueueService;
    if (
      typeof capabilityIndex?.has !== "function"
      || !capabilityIndex.has(CLOUD_REACTION_KIND)
      || typeof queue?.resolve !== "function"
    ) return true;
    const originalTarget = collectionValues(workflow?.hitTargets)[0];
    if (!originalTarget) return true;

    const triggerId = `${key}:cloud-rune-hit`;
    const trigger = {
      kind: CLOUD_REACTION_KIND,
      workflow,
      targetToken: originalTarget,
      targetActor: tokenActor(originalTarget),
      attackerToken: workflow?.token ?? workflow?.tokenDocument ?? null,
      active: true
    };
    this.#rememberWorkflowState(this._hitReactionTriggers, triggerId, trigger);
    const context = {
      triggerId,
      workflowId: key,
      targetTokenUuid: documentUuid(originalTarget),
      attackerTokenUuid: documentUuid(trigger.attackerToken),
      triggerActive: true
    };
    try {
      return await queue.resolve({ triggerId, kind: CLOUD_REACTION_KIND, context });
    }
    finally {
      this._hitReactionTriggers.delete(triggerId);
    }
  }

  async #resolveRunicShieldReaction(workflow, key) {
    const capabilityIndex = this.moduleApi?.reactionCapabilityIndex;
    const queue = this.moduleApi?.reactionQueueService;
    if (
      typeof capabilityIndex?.has !== "function"
      || !capabilityIndex.has(RUNIC_SHIELD_REACTION_KIND)
      || typeof queue?.resolve !== "function"
    ) return true;
    const hitTarget = collectionValues(workflow?.hitTargets)[0];
    if (!hitTarget) return true;

    const triggerId = `${key}:runic-shield-hit`;
    const trigger = {
      kind: RUNIC_SHIELD_REACTION_KIND,
      workflow,
      targetToken: hitTarget,
      targetActor: tokenActor(hitTarget),
      attackerToken: workflow?.token ?? workflow?.tokenDocument ?? null,
      active: true
    };
    this.#rememberWorkflowState(this._hitReactionTriggers, triggerId, trigger);
    const context = {
      triggerId,
      workflowId: key,
      targetTokenUuid: documentUuid(hitTarget),
      attackerTokenUuid: documentUuid(trigger.attackerToken),
      triggerActive: true
    };
    try {
      return await queue.resolve({ triggerId, kind: RUNIC_SHIELD_REACTION_KIND, context });
    }
    finally {
      this._hitReactionTriggers.delete(triggerId);
    }
  }

  #cloudReactionProvider() {
    return {
      listCandidates: (_context, capabilityIndex) => capabilityIndex?.list?.(CLOUD_REACTION_KIND) ?? [],
      isTriggerValid: (context) => this.#hitReactionTrigger(context, CLOUD_REACTION_KIND)?.active !== false,
      revalidateCandidate: (candidate, context) => this.#canUseHitReaction(
        this.#normalizeHitReactionCandidate(candidate, "cloud"),
        this.#hitReactionTrigger(context, CLOUD_REACTION_KIND),
        CLOUD_RANGE_FEET,
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
        redirectedTokenUuid: documentUuid(effect?.redirectedToken)
      })
    };
  }

  #runicShieldReactionProvider() {
    return {
      listCandidates: (_context, capabilityIndex) => capabilityIndex?.list?.(RUNIC_SHIELD_REACTION_KIND) ?? [],
      isTriggerValid: (context) => {
        const trigger = this.#hitReactionTrigger(context, RUNIC_SHIELD_REACTION_KIND);
        return trigger?.active !== false && this.#workflowHasHitTarget(trigger?.workflow, trigger?.targetToken);
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
    if (context._runeKnightHitTrigger?.kind === kind) return context._runeKnightHitTrigger;
    const triggerId = cleanText(context.triggerId);
    const local = this._hitReactionTriggers.get(triggerId);
    if (local) {
      context._runeKnightHitTrigger = local;
      return local;
    }

    const workflow = globalThis.MidiQOL?.Workflow?.getWorkflow?.(context.workflowId)
      ?? globalThis.MidiQOL?.Workflow?.getWorkflow?.(triggerId)
      ?? null;
    const targetToken = globalThis.fromUuidSync?.(context.targetTokenUuid) ?? null;
    const trigger = {
      kind,
      workflow,
      targetToken,
      targetActor: tokenActor(targetToken),
      attackerToken: globalThis.fromUuidSync?.(context.attackerTokenUuid) ?? workflow?.token ?? null,
      active: context.triggerActive !== false
    };
    context._runeKnightHitTrigger = trigger;
    return trigger;
  }

  async #canUseHitReaction(candidate, trigger, rangeFeet, requireRedirectTarget) {
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
    const redirectedToken = this.#cloudRedirectTargets(_candidate, trigger).find((token) => (
      documentUuid(token) === cleanText(choice?.targetTokenUuid)
    ));
    if (!workflow || !originalTarget || !redirectedToken) return { applied: false };

    const snapshot = this.#workflowSnapshot(workflow);
    const effect = { applied: false, workflow, trigger, snapshot, redirectedToken };
    if (transaction) transaction.effect = effect;
    const hit = this.#attackHitsToken(workflow.attackRoll, redirectedToken);
    workflow.targets = this.#replaceToken(workflow.targets, originalTarget, redirectedToken, true);
    workflow.hitTargets = this.#replaceToken(workflow.hitTargets, originalTarget, redirectedToken, hit);
    workflow.hitTargetsEC = this.#replaceToken(workflow.hitTargetsEC, originalTarget, redirectedToken, false);
    this.#removeDamageRecipient(workflow, originalTarget);
    trigger.active = false;
    effect.applied = true;
    return effect;
  }

  async #applyRunicShieldReaction(_candidate, trigger, transaction) {
    const workflow = trigger?.workflow;
    const attackRoll = workflow?.attackRoll;
    if (!workflow || typeof attackRoll?.reroll !== "function") return { applied: false };
    const snapshot = this.#workflowSnapshot(workflow);
    const effect = { applied: false, workflow, trigger, snapshot, newRoll: null };
    if (transaction) transaction.effect = effect;
    const newRoll = await attackRoll.reroll();
    if (!newRoll) return { applied: false };
    if (typeof workflow.setAttackRoll === "function") await workflow.setAttackRoll(newRoll);
    else workflow.attackRoll = newRoll;
    this.#recalculateWorkflowHits(workflow);
    effect.applied = true;
    effect.newRoll = newRoll;
    return effect;
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
    }
    workflow.targets = new Set(snapshot.targets);
    workflow.hitTargets = new Set(snapshot.hitTargets);
    workflow.hitTargetsEC = new Set(snapshot.hitTargetsEC);
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
    return collectionValues(workflow?.hitTargets).some((token) => this.#sameToken(token, targetToken));
  }

  #recalculateWorkflowHits(workflow) {
    const targets = collectionValues(workflow?.targets);
    const hits = targets.filter((token) => this.#attackHitsToken(workflow.attackRoll, token));
    workflow.hitTargets = new Set(hits);
    workflow.hitTargetsEC = new Set();
    const hitUuids = new Set(hits.map(documentUuid).filter(Boolean));
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
    const hitTargets = collectionValues(workflow?.hitTargets ?? workflow?.hitTargetsEC);
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
    const targetToken = hitTargets[0];
    const targetActor = tokenActor(targetToken);
    if (!isActorDocument(targetActor)) return true;

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
        body: `Пробудить Огненную руну при попадании по ${cleanText(targetActor?.name, "цели")}?`,
        acceptLabel: "Призвать кандалы",
        declineLabel: "Пропустить"
      }
    });
    if (choice?.accepted !== true) return true;

    const rollback = await this.#consumeItemUse(runeItem);
    if (!rollback) return false;
    this.#rememberWorkflowState(this._fireWorkflowStates, key, {
      key,
      actor,
      runeItem,
      targetActor,
      targetToken,
      rollback,
      applied: false,
      effect: null,
      processing: null
    });
    return true;
  }

  applyMidiPreDamageRollComplete(workflow) {
    const key = this.#workflowKey(workflow);
    const state = this._fireWorkflowStates.get(key);
    if (!state || state.applied === true) return Promise.resolve(true);
    if (state.processing) return state.processing;
    const operation = this.#applyPendingFireRune(workflow, state).finally(() => {
      if (state.processing === operation) state.processing = null;
    });
    state.processing = operation;
    return operation;
  }

  async #applyPendingFireRune(workflow, state) {
    const previousRolls = [...(workflow?.bonusDamageRolls ?? [])];
    try {
      const roll = await this.#createDamageRoll("2d6", "fire", state.actor, "Огненная руна");
      const nextRolls = [...previousRolls, roll];
      if (typeof workflow?.setBonusDamageRolls === "function") {
        await workflow.setBonusDamageRolls(nextRolls);
      }
      else {
        workflow.bonusDamageRolls = nextRolls;
      }

      const dc = 8
        + proficiencyBonus(state.actor)
        + Math.floor(numberValue(state.actor?.system?.abilities?.con?.mod, 0));
      const saved = await this.#rollSave(state.targetActor, "str", dc);
      if (!saved) {
        state.effect = await this.#createFireShackles(state.targetActor, state, dc);
        if (!state.effect) throw new Error("Fire Rune shackles could not be created");
      }
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
    const roll = new RollClass(`${formula}[${damageType}]`, actor?.getRollData?.() ?? {}, {
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
      cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.automation`)) === "fire-shackles"
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
      < Math.max(0, Math.floor(numberValue(uses.max, 0)));
  }

  #isVisible(candidate, trigger) {
    if (typeof this.options.isVisible === "function") {
      return this.options.isVisible(candidate, trigger) === true;
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
    if (saved === true) return { applied: true, saved: true, effectUuid: "" };

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
      cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.automation`)) === "stone-stupor"
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

  async #rollSave(actor, ability, dc) {
    if (typeof this.options.rollSave === "function") {
      return this.options.rollSave(actor, ability, dc);
    }
    if (typeof actor?.rollSavingThrow !== "function") return false;
    const rolls = await actor.rollSavingThrow({ ability, target: dc }, { configure: false }, {
      data: { flavor: `Каменная руна: спасбросок ${ability.toUpperCase()} Сл ${dc}` }
    });
    const roll = Array.isArray(rolls) ? rolls[0] : rolls;
    return Number.isFinite(Number(roll?.total)) ? Number(roll.total) >= dc : false;
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

  #cacheActorFeatures(actor, items = collectionValues(actor?.items)) {
    const ids = new Set(items.map(automationId).filter(Boolean));
    this._actorFeatureCache.set(actorKey(actor), ids);
    return ids;
  }

  #actorHasFeature(actor, id) {
    const key = actorKey(actor);
    const cached = this._actorFeatureCache.get(key) ?? this.#cacheActorFeatures(actor);
    return cached.has(id);
  }

  #hasRuntimeEffect(actor, item, id) {
    const sourceItemUuid = cleanText(item?.uuid);
    return collectionValues(actor?.effects).some((effect) => (
      cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.id`)) === id
        && cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.sourceItemUuid`)) === sourceItemUuid
    ));
  }

  async #consumeItemUse(item) {
    const uses = item?.system?.uses ?? {};
    const spent = Math.max(0, Math.floor(numberValue(uses.spent, 0)));
    const maximum = Math.max(0, Math.floor(numberValue(uses.max, 0)));
    if (spent >= maximum) return null;
    await updateItem(item, { "system.uses.spent": spent + 1 });
    return async () => updateItem(item, { "system.uses.spent": spent });
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
