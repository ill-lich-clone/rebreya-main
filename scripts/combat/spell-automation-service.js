import { MODULE_ID } from "../constants.js";
import { buildCounterspellActivity } from "../data/counterspell-activity.js";

const COUNTERSPELL_KIND = "counterspell";
const SPELL_SHATTER_KIND = "spell-shatter";
const COUNTERSPELL_RANGE_FEET = 60;
const COUNTERSPELL_REACTION_TYPE = "counterspell";
const SPELL_SHATTER_REACTION_TYPE = "spell-shatter";
const SPELL_REACTION_TRIGGER_KIND = "spell-reaction";
const SPELL_REACTION_CAPABILITY_KIND = "spell-reaction";
const SPELL_REACTION_PROVIDER_ID = "spell-automation";
const SPELL_SHATTER_COST = 5;
const SPELL_SHATTER_REFUND = 2;

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function getProperty(source, path, fallback = undefined) {
  const value = globalThis.foundry?.utils?.getProperty instanceof Function
    ? globalThis.foundry.utils.getProperty(source, path)
    : String(path ?? "").split(".").reduce((current, key) => current?.[key], source);
  return value === undefined ? fallback : value;
}

function readDocumentFlag(document, key) {
  if (typeof document?.getFlag === "function") {
    return document.getFlag(MODULE_ID, key);
  }

  return getProperty(document, `flags.${MODULE_ID}.${key}`);
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

  if (collection instanceof Set) {
    return Array.from(collection);
  }

  if (typeof collection === "object") {
    return Object.values(collection);
  }

  return [];
}

function documentUuid(document) {
  return cleanText(document?.uuid ?? document?.document?.uuid);
}

function documentId(document) {
  return cleanText(document?.id ?? document?._id ?? documentUuid(document));
}

function actorFrom(subject) {
  return subject?.actor ?? subject?.item?.actor ?? subject?.item?.parent ?? null;
}

function tokenFrom(subject) {
  return subject?.token
    ?? subject?.tokenDocument?.object
    ?? subject?.document?.object
    ?? null;
}

function firstActiveToken(actor) {
  if (typeof actor?.getActiveTokens === "function") {
    const tokens = actor.getActiveTokens(false);
    if (Array.isArray(tokens) && tokens.length) {
      return tokens[0];
    }
  }

  return tokenFrom(actor);
}

function tokenCenter(token) {
  const placeable = token?.object ?? token?.document?.object ?? token;
  if (placeable?.center) {
    return placeable.center;
  }

  if (typeof token?.getCenterPoint === "function") {
    return token.getCenterPoint();
  }

  if (typeof placeable?.getCenterPoint === "function") {
    return placeable.getCenterPoint();
  }

  return null;
}

function propertyHas(value, key) {
  if (value instanceof Set) {
    return value.has(key);
  }

  if (Array.isArray(value)) {
    return value.includes(key);
  }

  if (typeof value?.has === "function") {
    return value.has(key);
  }

  if (value && typeof value === "object") {
    return value[key] === true || Object.values(value).includes(key);
  }

  return false;
}

function resolveComponents(activity, item) {
  const source = activity?.system ?? item?.system ?? {};
  const components = source.components ?? item?.system?.components ?? {};
  const properties = source.properties ?? item?.system?.properties;
  const values = source.properties?.value ?? item?.system?.properties?.value;
  return {
    verbal: Boolean(
      components?.verbal
      || components?.vocal
      || components?.v
      || propertyHas(properties, "vocal")
      || propertyHas(values, "vocal")
    ),
    somatic: Boolean(
      components?.somatic
      || components?.s
      || propertyHas(properties, "somatic")
      || propertyHas(values, "somatic")
    )
  };
}

function sharedSpellCastComponents(usageConfig = {}) {
  const components = usageConfig?.flags?.[MODULE_ID]?.castContext?.components;
  if (!components || typeof components !== "object") {
    return null;
  }

  return {
    verbal: components.verbal === true || components.vocal === true || components.v === true,
    somatic: components.somatic === true || components.s === true
  };
}

function reactionCheckComplete(usageConfig = {}) {
  return usageConfig?.flags?.[MODULE_ID]?.reactionCheckComplete === true;
}

function markReactionCheckComplete(usageConfig = {}) {
  usageConfig.flags ??= {};
  usageConfig.flags[MODULE_ID] ??= {};
  usageConfig.flags[MODULE_ID].reactionCheckComplete = true;
  return usageConfig;
}

function hasVisibleComponents(cast) {
  return cast?.visible !== false && Boolean(cast?.components?.verbal || cast?.components?.somatic);
}

function convertToFeet(value, units) {
  const distance = Math.max(0, toNumber(value, 0));
  switch (cleanText(units).toLowerCase()) {
    case "m":
    case "meter":
    case "meters":
      return distance / 0.3048;
    case "km":
      return distance * 3280.84;
    case "mi":
      return distance * 5280;
    default:
      return distance;
  }
}

function resolveRangeFeet(activity, item) {
  const range = activity?.range ?? activity?.system?.range ?? item?.system?.range ?? {};
  return convertToFeet(range?.value ?? range, range?.units ?? "ft");
}

function resolveSpellLevel(activity, item, fallback = 0) {
  return Math.max(0, Math.floor(toNumber(
    activity?.spellLevel
    ?? activity?.system?.level
    ?? item?.system?.level
    ?? item?.system?.level?.value,
    fallback
  )));
}

function collectTargetUuids(targets) {
  return collectionValues(targets)
    .map((target) => documentUuid(target) || documentUuid(target?.actor) || documentId(target))
    .filter(Boolean);
}

function spellReactionKind(item) {
  const automation = readDocumentFlag(item, "spellAutomation");
  const kind = cleanText(automation?.kind).toLowerCase();
  return kind === COUNTERSPELL_KIND || kind === SPELL_SHATTER_KIND ? kind : "";
}

function counterspellAutomation(item) {
  return Boolean(spellReactionKind(item));
}

function spellReactionType(kind) {
  return kind === SPELL_SHATTER_KIND ? SPELL_SHATTER_REACTION_TYPE : COUNTERSPELL_REACTION_TYPE;
}

function itemActivities(item) {
  return collectionValues(item?.system?.activities);
}

function counterspellActivity(item) {
  return itemActivities(item).find((activity) => activity?.item === item || activity?.parent === item) ?? itemActivities(item)[0] ?? null;
}

function counterspellRepairPatch(item) {
  if (spellReactionKind(item) !== COUNTERSPELL_KIND) {
    return null;
  }

  const activities = item?.system?.activities && typeof item.system.activities === "object"
    ? item.system.activities
    : {};
  const activityValues = collectionValues(activities);
  const current = activityValues[0];
  const riderActivity = item?.flags?.dnd5e?.riders?.activity;
  const hasRiderActivities = Array.isArray(riderActivity) ? riderActivity.length > 0 : riderActivity != null;
  const needsRepair = activityValues.length !== 1
    || current?.type !== "utility"
    || current?.check !== undefined
    || current?.save !== undefined
    || current?.attack !== undefined
    || current?.damage !== undefined
    || hasRiderActivities;

  if (!needsRepair) {
    return null;
  }

  return {
    "system.activities": {
      counterspell: buildCounterspellActivity(item?.system ?? {})
    },
    "flags.dnd5e.riders.activity": []
  };
}

function normalizeChoice(choice, fallbackLevel) {
  if (choice === true) {
    return { accepted: true, spellLevel: fallbackLevel };
  }

  if (typeof choice === "number") {
    return { accepted: true, spellLevel: choice };
  }

  if (!choice || choice.accepted === false || choice.confirmed === false) {
    return { accepted: false, spellLevel: fallbackLevel };
  }

  return {
    accepted: true,
    spellLevel: Math.max(0, Math.floor(toNumber(choice.spellLevel ?? choice.level, fallbackLevel)))
  };
}

function abilityKey(actor, item) {
  return cleanText(
    item?.system?.ability
    ?? item?.system?.ability?.value
    ?? actor?.system?.attributes?.spellcasting
    ?? actor?.system?.details?.spellcasting
    ?? "int",
    "int"
  );
}

/**
 * Resolves generic spell-reaction trees. Counterspell sources are found only
 * through the module's spellAutomation flag; class services are deliberately
 * not involved here.
 */
export class SpellAutomationService {
  constructor(moduleApi = {}, options = {}) {
    this.moduleApi = moduleApi;
    this._options = options;
    this._pendingActivityResults = new WeakMap();
    this._attemptSequence = 0;
    this._castSequence = 0;
    this._reactionCasts = new Map();
  }

  async initialize() {
    const capabilityIndex = this.moduleApi?.reactionCapabilityIndex;
    if (typeof capabilityIndex?.registerProvider === "function") {
      capabilityIndex.registerProvider(
        SPELL_REACTION_CAPABILITY_KIND,
        ({ actor, token }) => this.#capabilitiesForActor(actor, token),
        { providerId: SPELL_REACTION_PROVIDER_ID }
      );
    }
    const reactionQueueService = this.moduleApi?.reactionQueueService;
    if (typeof reactionQueueService?.registerType === "function") {
      reactionQueueService.registerType(SPELL_REACTION_TRIGGER_KIND, this.#reactionProvider());
    }
    return Boolean(reactionQueueService);
  }

  async repairCounterspellItems(document) {
    const items = document?.type === "spell"
      ? [document]
      : collectionValues(document?.items);
    let repaired = false;

    for (const item of items) {
      const canUpdate = typeof item?.canUser === "function"
        ? item.canUser("UPDATE")
        : true;
      if (!canUpdate) {
        continue;
      }

      const patch = counterspellRepairPatch(item);
      if (!patch || typeof item?.update !== "function") {
        continue;
      }

      await item.update(patch, { render: false, rebreyaRepair: true });
      repaired = true;
    }

    return repaired;
  }

  async applyDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    void dialogConfig;
    void messageConfig;
    if (!activity || this.#isAutomatedChildUsage(usageConfig) || counterspellAutomation(activity?.item)) {
      return true;
    }

    if (reactionCheckComplete(usageConfig)) {
      return true;
    }

    const cast = this.#castFromActivity(activity, usageConfig);
    const result = await this.resolveCast(cast);
    if (activity && typeof activity === "object") {
      this._pendingActivityResults.set(activity, result);
    }
    if (!result.cancelled) {
      markReactionCheckComplete(usageConfig);
    }
    return !result.cancelled;
  }

  deferDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if (!activity || this.#isAutomatedChildUsage(usageConfig) || counterspellAutomation(activity?.item) || reactionCheckComplete(usageConfig)) {
      return true;
    }

    const cast = this.#castFromActivity(activity, usageConfig);
    if (!hasVisibleComponents(cast) || !this.#hasPotentialCounterspell(cast)) {
      markReactionCheckComplete(usageConfig);
      return true;
    }

    void this.#resolveDeferredDnd5eUse(activity, cast, usageConfig, dialogConfig, messageConfig);
    return false;
  }

  async applyMidiWorkflow(workflow) {
    if (
      !workflow
      || this.#isAutomatedChildUsage(workflow?.options ?? workflow?.config ?? workflow?.workflowOptions)
      || counterspellAutomation(workflow?.item ?? workflow?.activity?.item)
    ) {
      return true;
    }

    const activity = workflow.activity ?? null;
    const pending = activity && this._pendingActivityResults.get(activity);
    if (pending) {
      this._pendingActivityResults.delete(activity);
      return !pending.cancelled;
    }

    const cast = this.#castFromWorkflow(workflow);
    const result = await this.resolveCast(cast);
    return !result.cancelled;
  }

  async resolveCast(castContext = {}) {
    this._attemptSequence = 0;
    const root = this.#normalizeCast(castContext);
    const resolutionId = `${root.id}:spell-reaction:${Date.now()}:${++this._castSequence}`;
    await this.#resolveNode(root, resolutionId);
    this.#finalizeCancellation(root);
    const chain = [];
    this.#collectChain(root, chain);
    return {
      ...root,
      cancelled: root.cancelled === true,
      chain
    };
  }

  #castFromActivity(activity, usageConfig) {
    const actor = actorFrom(activity);
    const item = activity?.item ?? null;
    const sourceToken = tokenFrom(activity) ?? firstActiveToken(actor);
    return {
      id: documentUuid(activity) || documentId(activity) || `activity:${Date.now()}`,
      parentId: null,
      actorUuid: documentUuid(actor),
      activityUuid: documentUuid(activity),
      spellUuid: documentUuid(item),
      spellLevel: resolveSpellLevel(activity, item),
      rangeFeet: resolveRangeFeet(activity, item),
      components: sharedSpellCastComponents(usageConfig) ?? resolveComponents(activity, item),
      visible: sourceToken?.visible !== false && sourceToken?.isVisible !== false,
      targetUuids: collectTargetUuids(usageConfig?.targets ?? globalThis.game?.user?.targets),
      cancelled: false,
      modifiers: usageConfig?.modifiers ?? {},
      actor,
      item,
      activity,
      sourceToken
    };
  }

  #castFromWorkflow(workflow) {
    const activity = workflow?.activity ?? null;
    const actor = workflow?.actor ?? actorFrom(activity) ?? workflow?.item?.actor ?? null;
    const item = workflow?.item ?? activity?.item ?? null;
    const sourceToken = workflow?.token ?? tokenFrom(activity) ?? firstActiveToken(actor);
    return {
      id: cleanText(workflow?.uuid ?? workflow?.id) || documentUuid(activity) || `workflow:${Date.now()}`,
      parentId: null,
      actorUuid: documentUuid(actor),
      activityUuid: documentUuid(activity),
      spellUuid: documentUuid(item),
      spellLevel: resolveSpellLevel(activity, item),
      rangeFeet: resolveRangeFeet(activity, item),
      components: resolveComponents(activity, item),
      visible: sourceToken?.visible !== false && sourceToken?.isVisible !== false,
      targetUuids: collectTargetUuids(workflow?.targets ?? globalThis.game?.user?.targets),
      cancelled: false,
      modifiers: workflow?.options?.modifiers ?? {},
      actor,
      item,
      activity,
      sourceToken
    };
  }

  #normalizeCast(cast = {}) {
    const actor = cast.actor ?? null;
    const item = cast.item ?? null;
    const activity = cast.activity ?? null;
    const resolvedComponents = resolveComponents(activity, item);
    const suppliedComponents = cast.components && typeof cast.components === "object" ? cast.components : null;
    const hasSuppliedVerbal = suppliedComponents && (Object.hasOwn(suppliedComponents, "verbal") || Object.hasOwn(suppliedComponents, "vocal") || Object.hasOwn(suppliedComponents, "v"));
    const hasSuppliedSomatic = suppliedComponents && (Object.hasOwn(suppliedComponents, "somatic") || Object.hasOwn(suppliedComponents, "s"));
    return {
      id: cleanText(cast.id) || `cast:${Date.now()}:${++this._attemptSequence}`,
      parentId: cleanText(cast.parentId) || null,
      actorUuid: cleanText(cast.actorUuid) || documentUuid(actor),
      activityUuid: cleanText(cast.activityUuid) || documentUuid(activity),
      spellUuid: cleanText(cast.spellUuid) || documentUuid(item),
      spellLevel: Math.max(0, Math.floor(toNumber(cast.spellLevel, resolveSpellLevel(activity, item)))),
      rangeFeet: Math.max(0, toNumber(cast.rangeFeet, resolveRangeFeet(activity, item))),
      components: {
        verbal: hasSuppliedVerbal
          ? (suppliedComponents.verbal === true || suppliedComponents.vocal === true || suppliedComponents.v === true)
          : resolvedComponents.verbal,
        somatic: hasSuppliedSomatic
          ? (suppliedComponents.somatic === true || suppliedComponents.s === true)
          : resolvedComponents.somatic
      },
      visible: cast.visible !== false,
      targetUuids: Array.isArray(cast.targetUuids) ? cast.targetUuids.filter(Boolean) : [],
      cancelled: cast.cancelled === true,
      modifiers: cast.modifiers && typeof cast.modifiers === "object" ? cast.modifiers : {},
      kind: cleanText(cast.kind).toLowerCase(),
      actor,
      item,
      activity,
      sourceToken: cast.sourceToken ?? null,
      children: []
    };
  }

  async #resolveDeferredDnd5eUse(activity, cast, usageConfig, dialogConfig, messageConfig) {
    let cancelled = false;
    try {
      const result = await this.resolveCast(cast);
      cancelled = result.cancelled === true;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to resolve deferred spell reaction.`, error);
    }

    if (cancelled || typeof activity?.use !== "function") {
      return;
    }

    try {
      await activity.use(this.#resumeUsageConfig(usageConfig), dialogConfig, messageConfig);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to resume deferred spell use.`, error);
    }
  }

  #resumeUsageConfig(usageConfig = {}) {
    return {
      ...usageConfig,
      [MODULE_ID]: {
        ...(usageConfig?.[MODULE_ID] ?? {}),
        spellAutomationBypass: true,
        spellAutomationResume: true
      },
      flags: {
        ...(usageConfig?.flags ?? {}),
        [MODULE_ID]: {
          ...(usageConfig?.flags?.[MODULE_ID] ?? {}),
          reactionCheckComplete: true
        }
      }
    };
  }

  #hasPotentialCounterspell(cast) {
    if (typeof this._options.getCounterspellCandidates === "function") {
      return true;
    }

    void cast;
    return this.moduleApi?.reactionCapabilityIndex?.has?.(SPELL_REACTION_CAPABILITY_KIND) === true;
  }

  async #resolveNode(parent, resolutionId) {
    const queue = this.moduleApi?.reactionQueueService;
    if (!hasVisibleComponents(parent) || typeof queue?.resolve !== "function") {
      return;
    }

    const triggerId = `${resolutionId}:${parent.id}`;
    const context = {
      triggerId,
      resolutionId,
      cast: this.#serializeCast(parent)
    };
    this._reactionCasts.set(triggerId, parent);
    try {
      const result = await queue.resolve({
        triggerId,
        kind: SPELL_REACTION_TRIGGER_KIND,
        workflowId: resolutionId,
        context
      });
      this.#mergeReactionResult(parent, result);
    }
    finally {
      this._reactionCasts.delete(triggerId);
    }
  }

  async #resolveCounterspellAttempt(attempt, parent, resolutionId) {
    if (attempt.kind === SPELL_SHATTER_KIND) {
      attempt.dc = 10 + parent.spellLevel;
      attempt.rollTotal = await this.#rollSpellShatterCheck(parent, attempt.dc, attempt);
      attempt.success = Number.isFinite(attempt.rollTotal) && attempt.rollTotal < attempt.dc;
      if (attempt.success) {
        attempt.refunded = await this.#restoreSpellShatterRefund(attempt);
      }
    }
    else if (attempt.spellLevel >= parent.spellLevel) {
      attempt.success = true;
      attempt.dc = null;
      attempt.rollTotal = null;
    }
    else {
      attempt.dc = 10 + parent.spellLevel;
      attempt.rollTotal = await this.#rollAbilityCheck(attempt, attempt.dc, parent);
      attempt.success = Number.isFinite(attempt.rollTotal) && attempt.rollTotal >= attempt.dc;
    }

    await this.#resolveNode(attempt, resolutionId);
    this.#finalizeCancellation(attempt);
  }

  #makeCounterspellAttempt(candidate, parent, spellLevel) {
    const item = candidate.item ?? candidate.source ?? null;
    const activity = candidate.activity ?? counterspellActivity(item);
    const actor = candidate.actor ?? actorFrom(item);
    const kind = spellReactionKind(item) || COUNTERSPELL_KIND;
    const detectedComponents = candidate.components ?? resolveComponents(activity, item);
    const components = detectedComponents?.verbal || detectedComponents?.somatic
      ? detectedComponents
      : { verbal: true, somatic: true };
    return this.#normalizeCast({
      id: `${parent.id}:${kind}:${cleanText(candidate.id ?? documentUuid(actor) ?? "reactor")}:${++this._attemptSequence}`,
      parentId: parent.id,
      actorUuid: cleanText(candidate.actorUuid) || documentUuid(actor),
      activityUuid: documentUuid(activity),
      spellUuid: documentUuid(item),
      spellLevel: kind === SPELL_SHATTER_KIND ? Math.max(1, toNumber(spellLevel, 1)) : spellLevel,
      rangeFeet: resolveRangeFeet(activity, item),
      components,
      visible: candidate.visible !== false,
      targetUuids: [parent.actorUuid].filter(Boolean),
      cancelled: false,
      modifiers: {},
      kind,
      actor,
      item,
      activity,
      sourceToken: candidate.token ?? firstActiveToken(actor)
    });
  }

  async #counterspellCandidates(cast, capabilityIndex = this.moduleApi?.reactionCapabilityIndex) {
    const provided = typeof this._options.getCounterspellCandidates === "function"
      ? await this._options.getCounterspellCandidates(cast)
      : this.#discoverCounterspellCandidates(capabilityIndex);
    return collectionValues(provided)
      .map((candidate) => this.#normalizeReactionCandidate(candidate))
      .filter((candidate) => counterspellAutomation(candidate?.item ?? candidate?.source));
  }

  #discoverCounterspellCandidates(capabilityIndex) {
    return collectionValues(capabilityIndex?.list?.(SPELL_REACTION_CAPABILITY_KIND));
  }

  #canReact(candidate, cast) {
    const actor = candidate?.actor ?? null;
    if (!actor) {
      return false;
    }

    if (cleanText(documentUuid(actor)) && cleanText(documentUuid(actor)) === cleanText(cast.actorUuid)) {
      return false;
    }

    if (candidate?.visible === false || cast.visible === false || !this.#isVisible(candidate, cast)) {
      return false;
    }

    if (!this.#isWithinCounterspellRange(candidate, cast)) {
      return false;
    }

    return this.moduleApi?.combatAttackService?.canUseReaction?.(actor, 1)?.canUse === true;
  }

  #isWithinCounterspellRange(candidate, cast) {
    const distance = this.#distanceFeet(candidate, cast);
    return Number.isFinite(distance) && distance <= COUNTERSPELL_RANGE_FEET;
  }

  #actorOwnedByUser(actor, user) {
    if (!actor || !user) {
      return false;
    }

    if (user.isGM === true) {
      return true;
    }

    if (typeof actor.testUserPermission === "function") {
      return actor.testUserPermission(user, "OWNER") === true;
    }

    const ownership = actor.ownership ?? actor._source?.ownership ?? {};
    return Number(ownership[user.id] ?? 0) >= 3 || Number(ownership.default ?? 0) >= 3;
  }

  #reactionProvider() {
    return {
      listCandidates: async (context, capabilityIndex) => {
        const cast = this.#reactionCast(context);
        const candidates = await this.#counterspellCandidates(cast, capabilityIndex);
        return candidates.filter((candidate) => this.#canReact(candidate, cast));
      },
      isTriggerValid: (context) => {
        const cast = this.#reactionCast(context);
        return hasVisibleComponents(cast) && cast.cancelled !== true;
      },
      revalidateCandidate: (candidate, context) => this.#canReact(
        this.#normalizeReactionCandidate(candidate),
        this.#reactionCast(context)
      ),
      buildPrompt: (candidate, context) => this.#buildReactionPrompt(
        this.#normalizeReactionCandidate(candidate),
        this.#reactionCast(context)
      ),
      pay: (candidate, choice, context) => this.#payReaction(
        this.#normalizeReactionCandidate(candidate),
        choice,
        this.#reactionCast(context)
      ),
      apply: (candidate, choice, context, transaction) => this.#applyReaction(
        this.#normalizeReactionCandidate(candidate),
        choice,
        context,
        transaction
      ),
      rollback: (candidate, transaction, context) => this.#rollbackReaction(
        this.#normalizeReactionCandidate(candidate),
        transaction,
        context
      ),
      serializeEffect: (effect) => effect
    };
  }

  #reactionCast(context = {}) {
    const triggerId = cleanText(context?.triggerId);
    const active = this._reactionCasts.get(triggerId) ?? context._resolvedCast;
    if (active) {
      return active;
    }

    const cast = this.#normalizeCast(context?.cast ?? {});
    cast.sourceToken = this.#resolveSerializedSourceToken(context?.cast?.sourceToken);
    context._resolvedCast = cast;
    return cast;
  }

  #capabilitiesForActor(actor, token) {
    if (!actor) {
      return [];
    }

    return collectionValues(actor.items)
      .filter((item) => counterspellAutomation(item))
      .map((item) => {
        const activity = counterspellActivity(item);
        return {
          actorUuid: documentUuid(actor),
          tokenUuid: documentUuid(token) || documentUuid(token?.document),
          itemUuid: documentUuid(item),
          activityId: documentId(activity),
          ownerUserIds: this.#ownerUserIds(actor)
        };
      });
  }

  #ownerUserIds(actor) {
    return collectionValues(globalThis.game?.users)
      .filter((user) => user?.active !== false && this.#actorOwnedByUser(actor, user))
      .sort((left, right) => Number(left?.isGM === true) - Number(right?.isGM === true)
        || cleanText(left?.id).localeCompare(cleanText(right?.id)))
      .map((user) => cleanText(user?.id))
      .filter(Boolean);
  }

  #normalizeReactionCandidate(candidate = {}) {
    const actorUuid = cleanText(candidate.actorUuid);
    const itemUuid = cleanText(candidate.itemUuid);
    const tokenUuid = cleanText(candidate.tokenUuid);
    const resolvedItem = candidate.item
      ?? candidate.source
      ?? globalThis.fromUuidSync?.(itemUuid)
      ?? null;
    const actor = candidate.actor
      ?? actorFrom(resolvedItem)
      ?? globalThis.fromUuidSync?.(actorUuid)
      ?? null;
    const item = resolvedItem
      ?? collectionValues(actor?.items).find((entry) => documentUuid(entry) === itemUuid)
      ?? null;
    const token = candidate.token
      ?? globalThis.fromUuidSync?.(tokenUuid)
      ?? firstActiveToken(actor);
    const activityId = cleanText(candidate.activityId);
    const activity = candidate.activity
      ?? itemActivities(item).find((entry) => documentId(entry) === activityId)
      ?? counterspellActivity(item);
    const kind = spellReactionKind(item);
    return {
      ...candidate,
      id: cleanText(candidate.id, documentId(actor)),
      actor,
      actorUuid: actorUuid || documentUuid(actor),
      token,
      tokenUuid: tokenUuid || documentUuid(token) || documentUuid(token?.document),
      item,
      itemUuid: itemUuid || documentUuid(item),
      activity,
      activityId: activityId || documentId(activity),
      ownerUserIds: collectionValues(candidate.ownerUserIds).length
        ? collectionValues(candidate.ownerUserIds)
        : this.#ownerUserIds(actor),
      reactionType: spellReactionType(kind)
    };
  }

  #buildReactionPrompt(candidate, cast) {
    if (spellReactionKind(candidate?.item ?? candidate?.source) === SPELL_SHATTER_KIND) {
      return {
        title: "Раскол заклинания",
        body: `Использовать Раскол заклинания против заклинания ${cast.spellLevel}-го уровня за ${SPELL_SHATTER_COST} единиц чародейства?`,
        acceptLabel: "Расколоть",
        declineLabel: "Пропустить"
      };
    }

    const availableLevels = this.#availableSpellLevels(candidate);
    return {
      title: "Контрзаклинание",
      body: `Использовать Контрзаклинание против заклинания ${cast.spellLevel}-го уровня?`,
      acceptLabel: "Контрзаклинание",
      declineLabel: "Пропустить",
      fields: [{
        name: "spellLevel",
        type: "select",
        label: "Уровень ячейки",
        options: availableLevels.map((level) => ({ value: level, label: String(level) }))
      }]
    };
  }

  async #payReaction(candidate, choice, parent) {
    const normalized = normalizeChoice(choice, this.#candidateSpellLevel(candidate));
    if (!normalized.accepted || normalized.spellLevel < 1) {
      return { paid: false };
    }

    const attempt = this.#makeCounterspellAttempt(candidate, parent, normalized.spellLevel);
    const slotSnapshot = this.#slotPaymentSnapshot(candidate, attempt);
    const paid = await this.#paySpell(candidate, attempt, parent);
    attempt.paid = paid === true;
    let rollback = null;
    if (attempt.paid && attempt.kind === SPELL_SHATTER_KIND) {
      rollback = () => this.moduleApi?.sorcererAutomationService?.restoreSorceryPoints?.(
        attempt.actor,
        SPELL_SHATTER_COST
      );
    }
    else if (attempt.paid && typeof this._options.refundSpell === "function") {
      rollback = () => this._options.refundSpell(candidate, parent, attempt);
    }
    else if (attempt.paid && slotSnapshot) {
      rollback = () => slotSnapshot.actor.update?.({
        [`system.spells.${slotSnapshot.slotKey}.value`]: slotSnapshot.value
      });
    }
    return { paid: attempt.paid, attempt, rollback };
  }

  async #applyReaction(_candidate, _choice, context, transaction) {
    const parent = this.#reactionCast(context);
    const attempt = transaction?.payment?.attempt;
    if (!attempt) {
      return { applied: false };
    }

    if (!parent.children.some((child) => child.id === attempt.id)) {
      parent.children.push(attempt);
    }
    await this.#resolveCounterspellAttempt(attempt, parent, cleanText(context?.resolutionId, parent.id));
    parent.cancelled = parent.children.some((child) => child.success === true && child.cancelled !== true);
    return {
      applied: true,
      attempt: this.#serializeResolvedCast(attempt)
    };
  }

  async #rollbackReaction(_candidate, transaction, context) {
    const parent = this.#reactionCast(context);
    const attempt = transaction?.payment?.attempt;
    if (attempt) {
      parent.children = parent.children.filter((child) => child.id !== attempt.id);
      this.#finalizeCancellation(parent);
      if (attempt.refunded === true) {
        await this.moduleApi?.sorcererAutomationService?.spendSorceryPoints?.(
          attempt.actor,
          SPELL_SHATTER_REFUND
        );
        attempt.refunded = false;
      }
    }
    await transaction?.payment?.rollback?.();
  }

  #slotPaymentSnapshot(candidate, attempt) {
    if (
      typeof this._options.paySpell === "function"
      || attempt.kind === SPELL_SHATTER_KIND
      || spellReactionKind(candidate?.item ?? candidate?.source) === SPELL_SHATTER_KIND
    ) {
      return null;
    }

    const activity = attempt.activity ?? candidate.activity ?? counterspellActivity(attempt.item ?? candidate.item);
    const item = attempt.item ?? candidate.item;
    const baseLevel = resolveSpellLevel(activity, item, attempt.spellLevel);
    const slotLevel = Math.max(baseLevel, attempt.spellLevel);
    const slotKey = `spell${slotLevel}`;
    const value = Number(attempt.actor?.system?.spells?.[slotKey]?.value);
    if (!attempt.actor || !Number.isFinite(value)) {
      return null;
    }
    return { actor: attempt.actor, slotKey, value };
  }

  #mergeReactionResult(parent, result) {
    for (const accepted of collectionValues(result?.accepted)) {
      const serializedAttempt = accepted?.effect?.attempt
        ?? accepted?.transaction?.effect?.attempt;
      const attemptId = cleanText(serializedAttempt?.id);
      const localAttempt = parent.children.find((child) => cleanText(child.id) === attemptId);
      if (localAttempt) {
        localAttempt.reaction = accepted?.transaction?.reaction ?? localAttempt.reaction;
        continue;
      }
      if (serializedAttempt) {
        parent.children.push(this.#deserializeResolvedCast(serializedAttempt));
      }
    }
    this.#finalizeCancellation(parent);
  }

  #isVisible(candidate, cast) {
    if (typeof this._options.isVisible === "function") {
      return this._options.isVisible(candidate, cast) === true;
    }

    const candidateToken = candidate?.token ?? firstActiveToken(candidate?.actor);
    const sourceToken = cast?.sourceToken ?? null;
    return candidate?.visible !== false
      && candidateToken?.visible !== false
      && candidateToken?.isVisible !== false
      && sourceToken?.visible !== false
      && sourceToken?.isVisible !== false;
  }

  #distanceFeet(candidate, cast) {
    if (Number.isFinite(Number(candidate?.distanceFeet))) {
      return Math.max(0, Number(candidate.distanceFeet));
    }

    if (Number.isFinite(Number(candidate?.rangeFeet))) {
      return Math.max(0, Number(candidate.rangeFeet));
    }

    if (typeof this._options.distanceFeet === "function") {
      return toNumber(this._options.distanceFeet(candidate, cast), Number.POSITIVE_INFINITY);
    }

    const candidateToken = candidate?.token ?? firstActiveToken(candidate?.actor);
    const sourceToken = cast?.sourceToken ?? null;
    const candidateCenter = tokenCenter(candidateToken);
    const sourceCenter = tokenCenter(sourceToken);
    if (!candidateCenter || !sourceCenter) {
      return Number.POSITIVE_INFINITY;
    }

    const grid = globalThis.canvas?.grid;
    if (typeof grid?.measurePath === "function") {
      const measured = grid.measurePath([candidateCenter, sourceCenter]);
      return convertToFeet(measured?.distance, globalThis.canvas?.scene?.grid?.units ?? "ft");
    }

    return Number.POSITIVE_INFINITY;
  }

  #candidateSpellLevel(candidate) {
    if (spellReactionKind(candidate?.item ?? candidate?.source) === SPELL_SHATTER_KIND) {
      return Math.max(1, Math.floor(toNumber(candidate?.spellLevel ?? candidate?.selectedLevel, 1)));
    }

    return Math.max(0, Math.floor(toNumber(
      candidate?.spellLevel
      ?? candidate?.selectedLevel
      ?? resolveSpellLevel(candidate?.activity, candidate?.item),
      0
    )));
  }

  #availableSpellLevels(candidate) {
    const baseLevel = this.#candidateSpellLevel(candidate);
    const actor = candidate?.actor;
    const levels = new Set();
    let hasKnownSlot = false;
    for (const [slotKey, slot] of Object.entries(actor?.system?.spells ?? {})) {
      const match = slotKey.match(/^spell(\d+)$/u);
      const level = Math.max(0, Math.floor(toNumber(slot?.level ?? match?.[1], 0)));
      const uses = toNumber(slot?.value ?? slot?.uses?.value, 0);
      if (level >= baseLevel && level > 0) {
        hasKnownSlot = true;
        if (uses > 0) {
          levels.add(level);
        }
      }
    }

    if (!hasKnownSlot && baseLevel > 0) {
      levels.add(baseLevel);
    }
    return Array.from(levels).sort((left, right) => left - right);
  }

  #serializeCast(cast) {
    return {
      id: cleanText(cast?.id),
      parentId: cleanText(cast?.parentId) || null,
      actorUuid: cleanText(cast?.actorUuid),
      activityUuid: cleanText(cast?.activityUuid),
      spellUuid: cleanText(cast?.spellUuid),
      spellLevel: Math.max(0, Math.floor(toNumber(cast?.spellLevel, 0))),
      rangeFeet: Math.max(0, toNumber(cast?.rangeFeet, 0)),
      components: {
        verbal: cast?.components?.verbal === true,
        somatic: cast?.components?.somatic === true
      },
      visible: cast?.visible !== false,
      targetUuids: Array.isArray(cast?.targetUuids) ? cast.targetUuids.filter(Boolean) : [],
      cancelled: cast?.cancelled === true,
      modifiers: cast?.modifiers && typeof cast.modifiers === "object" ? cast.modifiers : {},
      sourceToken: this.#serializeSourceToken(cast?.sourceToken)
    };
  }

  #serializeResolvedCast(cast) {
    return {
      ...this.#serializeCast(cast),
      kind: cleanText(cast?.kind),
      paid: cast?.paid === true,
      success: cast?.success === true,
      dc: Number.isFinite(Number(cast?.dc)) ? Number(cast.dc) : null,
      rollTotal: Number.isFinite(Number(cast?.rollTotal)) ? Number(cast.rollTotal) : null,
      refunded: cast?.refunded === true,
      children: collectionValues(cast?.children).map((child) => this.#serializeResolvedCast(child))
    };
  }

  #deserializeResolvedCast(serialized = {}) {
    const cast = this.#normalizeCast(serialized);
    cast.kind = cleanText(serialized.kind);
    cast.paid = serialized.paid === true;
    cast.success = serialized.success === true;
    cast.dc = Number.isFinite(Number(serialized.dc)) ? Number(serialized.dc) : null;
    cast.rollTotal = Number.isFinite(Number(serialized.rollTotal)) ? Number(serialized.rollTotal) : null;
    cast.refunded = serialized.refunded === true;
    cast.sourceToken = this.#resolveSerializedSourceToken(serialized.sourceToken);
    cast.children = collectionValues(serialized.children)
      .map((child) => this.#deserializeResolvedCast(child));
    return cast;
  }

  #serializeSourceToken(token) {
    if (!token) {
      return null;
    }

    const center = tokenCenter(token);
    if (!center) {
      return null;
    }

    return {
      uuid: documentUuid(token) || documentUuid(token?.document),
      center: { x: toNumber(center.x, 0), y: toNumber(center.y, 0) },
      visible: token?.visible !== false && token?.isVisible !== false
    };
  }

  #resolveSerializedSourceToken(sourceToken) {
    if (!sourceToken || typeof sourceToken !== "object") {
      return null;
    }

    const sourceUuid = cleanText(sourceToken.uuid);
    const matchingToken = collectionValues(globalThis.canvas?.tokens?.placeables)
      .find((token) => documentUuid(token) === sourceUuid || documentUuid(token?.document) === sourceUuid);
    return matchingToken ?? sourceToken;
  }

  async #paySpell(candidate, attempt, parent) {
    if (typeof this._options.paySpell === "function") {
      return (await this._options.paySpell(candidate, parent, attempt)) !== false;
    }

    if (attempt.kind === SPELL_SHATTER_KIND || spellReactionKind(candidate?.item ?? candidate?.source) === SPELL_SHATTER_KIND) {
      return (await this.moduleApi?.sorcererAutomationService?.spendSorceryPoints?.(
        candidate.actor,
        SPELL_SHATTER_COST
      )) === true;
    }

    const activity = attempt.activity ?? candidate.activity ?? counterspellActivity(attempt.item ?? candidate.item);
    const item = attempt.item ?? candidate.item;
    const baseLevel = resolveSpellLevel(activity, item, attempt.spellLevel);
    const slotLevel = Math.max(baseLevel, attempt.spellLevel);
    const usageConfig = {
      spell: {
        slot: `spell${slotLevel}`
      },
      scaling: Math.max(0, slotLevel - baseLevel),
      [MODULE_ID]: {
        spellAutomationChild: true,
        parentCastId: parent.id
      }
    };
    const dialogConfig = { configure: false };
    if (typeof activity?.use === "function") {
      return Boolean(await activity.use(usageConfig, dialogConfig));
    }

    if (typeof item?.use === "function") {
      return Boolean(await item.use(usageConfig, dialogConfig));
    }

    return false;
  }

  async #rollAbilityCheck(attempt, dc, parent) {
    if (typeof this._options.rollAbilityCheck === "function") {
      return toNumber(await this._options.rollAbilityCheck(attempt, dc, parent), NaN);
    }

    const actor = attempt.actor;
    const ability = abilityKey(actor, attempt.item);
    if (typeof actor?.rollAbilityTest === "function") {
      const roll = await actor.rollAbilityTest(ability, { fastForward: true, targetValue: dc });
      return toNumber(roll?.total ?? roll, NaN);
    }

    return Number.NaN;
  }

  async #rollSpellShatterCheck(parent, dc, attempt) {
    if (typeof this._options.rollSpellShatterCheck === "function") {
      return toNumber(await this._options.rollSpellShatterCheck(parent, dc, attempt), NaN);
    }

    if (typeof this._options.rollAbilityCheck === "function") {
      return toNumber(await this._options.rollAbilityCheck(attempt, dc, parent), NaN);
    }

    const actor = parent.actor;
    const ability = abilityKey(actor, parent.item);
    if (typeof actor?.rollAbilityTest === "function") {
      const roll = await actor.rollAbilityTest(ability, { fastForward: true, targetValue: dc });
      return toNumber(roll?.total ?? roll, NaN);
    }

    return Number.NaN;
  }

  async #restoreSpellShatterRefund(attempt) {
    return (await this.moduleApi?.sorcererAutomationService?.restoreSorceryPoints?.(
      attempt.actor,
      SPELL_SHATTER_REFUND
    )) === true;
  }

  #finalizeCancellation(node) {
    for (const child of node.children) {
      this.#finalizeCancellation(child);
    }

    node.cancelled = node.children.some((child) => child.success === true && child.cancelled !== true);
    return node.cancelled;
  }

  #collectChain(node, chain) {
    chain.push(node);
    for (const child of node.children) {
      this.#collectChain(child, chain);
    }
  }

  #isAutomatedChildUsage(usageConfig) {
    return usageConfig?.[MODULE_ID]?.spellAutomationChild === true
      || usageConfig?.[MODULE_ID]?.spellAutomationBypass === true;
  }
}
