import { MODULE_ID } from "../constants.js";

const COUNTERSPELL_KIND = "counterspell";
const COUNTERSPELL_RANGE_FEET = 60;
const COUNTERSPELL_REACTION_TYPE = "counterspell";
const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const COUNTERSPELL_REQUEST_EVENT = `${MODULE_ID}.spellAutomation.counterspellRequest`;
const COUNTERSPELL_RESULT_EVENT = `${MODULE_ID}.spellAutomation.counterspellResult`;
const COUNTERSPELL_REQUEST_TIMEOUT_MS = 30000;

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

function counterspellAutomation(item) {
  const automation = readDocumentFlag(item, "spellAutomation");
  return automation && typeof automation === "object" && cleanText(automation.kind).toLowerCase() === COUNTERSPELL_KIND;
}

function itemActivities(item) {
  return collectionValues(item?.system?.activities);
}

function counterspellActivity(item) {
  return itemActivities(item).find((activity) => activity?.item === item || activity?.parent === item) ?? itemActivities(item)[0] ?? null;
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
    this._pendingCounterspellRequests = new Map();
  }

  async initialize() {
    return true;
  }

  async handleSocketMessage(message, senderId = "") {
    if (message?.type === COUNTERSPELL_RESULT_EVENT) {
      this.#handleCounterspellResult(message, senderId);
      return true;
    }

    if (message?.type === COUNTERSPELL_REQUEST_EVENT) {
      await this.#handleCounterspellRequest(message, senderId);
      return true;
    }

    return false;
  }

  async applyDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    void dialogConfig;
    void messageConfig;
    if (!activity || this.#isAutomatedChildUsage(usageConfig) || counterspellAutomation(activity?.item)) {
      return true;
    }

    const cast = this.#castFromActivity(activity, usageConfig);
    const result = await this.resolveCast(cast);
    if (activity && typeof activity === "object") {
      this._pendingActivityResults.set(activity, result);
    }
    return !result.cancelled;
  }

  deferDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if (!activity || this.#isAutomatedChildUsage(usageConfig) || counterspellAutomation(activity?.item)) {
      return true;
    }

    const cast = this.#castFromActivity(activity, usageConfig);
    if (!hasVisibleComponents(cast) || !this.#hasPotentialCounterspell(cast)) {
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
    await this.#resolveNode(root);
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
      components: resolveComponents(activity, item),
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
    return {
      id: cleanText(cast.id) || `cast:${Date.now()}:${++this._attemptSequence}`,
      parentId: cleanText(cast.parentId) || null,
      actorUuid: cleanText(cast.actorUuid) || documentUuid(actor),
      activityUuid: cleanText(cast.activityUuid) || documentUuid(activity),
      spellUuid: cleanText(cast.spellUuid) || documentUuid(item),
      spellLevel: Math.max(0, Math.floor(toNumber(cast.spellLevel, resolveSpellLevel(activity, item)))),
      rangeFeet: Math.max(0, toNumber(cast.rangeFeet, resolveRangeFeet(activity, item))),
      components: {
        verbal: cast.components?.verbal === true || cast.components?.vocal === true || resolveComponents(activity, item).verbal,
        somatic: cast.components?.somatic === true || resolveComponents(activity, item).somatic
      },
      visible: cast.visible !== false,
      targetUuids: Array.isArray(cast.targetUuids) ? cast.targetUuids.filter(Boolean) : [],
      cancelled: cast.cancelled === true,
      modifiers: cast.modifiers && typeof cast.modifiers === "object" ? cast.modifiers : {},
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
        spellAutomationBypass: true
      }
    };
  }

  #hasPotentialCounterspell(cast) {
    if (typeof this._options.getCounterspellCandidates === "function") {
      return true;
    }

    return this.#discoverCounterspellCandidates(cast)
      .some((candidate) => this.#canReact(candidate, cast));
  }

  async #resolveNode(parent) {
    if (!hasVisibleComponents(parent)) {
      return;
    }

    const candidates = await this.#counterspellCandidates(parent);
    for (const candidate of candidates) {
      if (!this.#canReact(candidate, parent)) {
        continue;
      }

      const remoteOwnerId = this.#remoteOwnerUserId(candidate.actor);
      if (remoteOwnerId) {
        const remote = await this.#requestRemoteCounterspell(candidate, parent, remoteOwnerId);
        if (remote?.accepted !== true) {
          continue;
        }

        const attempt = this.#makeCounterspellAttempt(candidate, parent, remote.spellLevel);
        attempt.reaction = remote.reaction ?? { consumed: false };
        attempt.paid = remote.paid === true;
        if (attempt.reaction.consumed !== true || !attempt.paid) {
          continue;
        }

        parent.children.push(attempt);
        await this.#resolveCounterspellAttempt(attempt, parent, remote);
        return;
      }

      const fallbackLevel = this.#candidateSpellLevel(candidate);
      const choice = normalizeChoice(await this.promptCounterspell(candidate, parent), fallbackLevel);
      if (!choice.accepted || choice.spellLevel < 1) {
        continue;
      }

      const attempt = this.#makeCounterspellAttempt(candidate, parent, choice.spellLevel);
      const paid = await this.#paySpell(candidate, attempt, parent);
      attempt.paid = paid === true;
      if (!attempt.paid) {
        continue;
      }

      const reaction = await this.#consumeReaction(candidate);
      attempt.reaction = reaction;
      if (reaction?.consumed !== true) {
        continue;
      }

      parent.children.push(attempt);
      await this.#resolveCounterspellAttempt(attempt, parent);
      return;
    }
  }

  async #resolveCounterspellAttempt(attempt, parent, resolved = null) {
    if (resolved && typeof resolved === "object") {
      attempt.success = resolved.success === true;
      attempt.dc = resolved.dc ?? null;
      attempt.rollTotal = resolved.rollTotal ?? null;
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

    await this.#resolveNode(attempt);
  }

  #makeCounterspellAttempt(candidate, parent, spellLevel) {
    const item = candidate.item ?? candidate.source ?? null;
    const activity = candidate.activity ?? counterspellActivity(item);
    const actor = candidate.actor ?? actorFrom(item);
    const detectedComponents = candidate.components ?? resolveComponents(activity, item);
    const components = detectedComponents?.verbal || detectedComponents?.somatic
      ? detectedComponents
      : { verbal: true, somatic: true };
    return this.#normalizeCast({
      id: `${parent.id}:counterspell:${cleanText(candidate.id ?? documentUuid(actor) ?? "reactor")}:${++this._attemptSequence}`,
      parentId: parent.id,
      actorUuid: cleanText(candidate.actorUuid) || documentUuid(actor),
      activityUuid: documentUuid(activity),
      spellUuid: documentUuid(item),
      spellLevel,
      rangeFeet: resolveRangeFeet(activity, item),
      components,
      visible: candidate.visible !== false,
      targetUuids: [parent.actorUuid].filter(Boolean),
      cancelled: false,
      modifiers: {},
      actor,
      item,
      activity,
      sourceToken: candidate.token ?? firstActiveToken(actor)
    });
  }

  async #counterspellCandidates(cast) {
    const provided = typeof this._options.getCounterspellCandidates === "function"
      ? await this._options.getCounterspellCandidates(cast)
      : this.#discoverCounterspellCandidates(cast);
    return collectionValues(provided)
      .filter((candidate) => counterspellAutomation(candidate?.item ?? candidate?.source))
      .sort((left, right) => this.#candidateOrder(left) - this.#candidateOrder(right)
        || cleanText(left?.actor?.id ?? left?.id).localeCompare(cleanText(right?.actor?.id ?? right?.id)));
  }

  #discoverCounterspellCandidates(cast) {
    const actors = collectionValues(globalThis.game?.actors);
    return actors.flatMap((actor) => collectionValues(actor?.items)
      .filter((item) => counterspellAutomation(item))
      .map((item) => ({
        id: actor?.id,
        actor,
        actorUuid: documentUuid(actor),
        item,
        activity: counterspellActivity(item),
        token: firstActiveToken(actor),
        combatOrder: this.#combatOrder(actor)
      }))
    ).filter((candidate) => cleanText(candidate.actorUuid) !== cleanText(cast.actorUuid));
  }

  #candidateOrder(candidate) {
    const explicit = toNumber(candidate?.combatOrder, NaN);
    if (Number.isFinite(explicit)) {
      return explicit;
    }

    return this.#combatOrder(candidate?.actor);
  }

  #combatOrder(actor) {
    const combatants = collectionValues(globalThis.game?.combat?.combatants);
    const index = combatants.findIndex((combatant) => combatant?.actor === actor || combatant?.actorId === actor?.id);
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
  }

  #canReact(candidate, cast) {
    const actor = candidate?.actor ?? null;
    if (!actor) {
      return false;
    }

    if (cleanText(documentUuid(actor)) && cleanText(documentUuid(actor)) === cleanText(cast.actorUuid)) {
      return false;
    }

    if (this.#remoteOwnerUserId(actor)) {
      return hasVisibleComponents(cast);
    }

    if (!this.#currentUserOwnsActor(actor)) {
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

  #isRemoteCandidateEligible(candidate, cast) {
    if (!hasVisibleComponents(cast) || !this.#isVisible(candidate, cast)) {
      return false;
    }

    if (!tokenCenter(cast?.sourceToken)) {
      return false;
    }

    return this.#isWithinCounterspellRange(candidate, cast);
  }

  #currentUserOwnsActor(actor) {
    const user = globalThis.game?.user;
    if (!actor || !user) {
      return false;
    }

    if (actor.isOwner === true) {
      return true;
    }

    return this.#actorOwnedByUser(actor, user);
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

  #remoteOwnerUserId(actor) {
    const currentUser = globalThis.game?.user;
    const users = collectionValues(globalThis.game?.users)
      .filter((user) => user?.active !== false && this.#actorOwnedByUser(actor, user))
      .sort((left, right) => Number(left?.isGM === true) - Number(right?.isGM === true)
        || cleanText(left?.id).localeCompare(cleanText(right?.id)));
    if (currentUser?.isGM === true) {
      const playerOwner = users.find((user) => user?.isGM !== true && cleanText(user?.id) !== cleanText(currentUser.id));
      if (playerOwner) {
        return cleanText(playerOwner.id);
      }
    }

    if (this.#currentUserOwnsActor(actor)) {
      return "";
    }
    return cleanText(users[0]?.id);
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

  async #requestRemoteCounterspell(candidate, parent, forUserId) {
    const game = globalThis.game;
    const senderId = cleanText(game?.user?.id);
    const actorId = documentId(candidate?.actor);
    const itemId = documentId(candidate?.item);
    if (!senderId || !forUserId || !actorId || !itemId || typeof game?.socket?.emit !== "function") {
      return { accepted: false };
    }

    const requestId = `${senderId}:counterspell:${Date.now()}:${++this._attemptSequence}`;
    return new Promise((resolve) => {
      const entry = {
        actorId,
        itemId,
        forUserId,
        resolve,
        timeoutId: null
      };
      entry.timeoutId = globalThis.setTimeout(() => {
        if (this._pendingCounterspellRequests.get(requestId) === entry) {
          this._pendingCounterspellRequests.delete(requestId);
          resolve({ accepted: false, reason: "timeout" });
        }
      }, COUNTERSPELL_REQUEST_TIMEOUT_MS);
      this._pendingCounterspellRequests.set(requestId, entry);

      try {
        game.socket.emit(SOCKET_CHANNEL, {
          type: COUNTERSPELL_REQUEST_EVENT,
          requestId,
          senderId,
          forUserId,
          actorId,
          itemId,
          cast: this.#serializeCast(parent)
        });
      }
      catch (_error) {
        this._pendingCounterspellRequests.delete(requestId);
        globalThis.clearTimeout(entry.timeoutId);
        resolve({ accepted: false, reason: "socketUnavailable" });
      }
    });
  }

  #handleCounterspellResult(message, senderId) {
    const currentUserId = cleanText(globalThis.game?.user?.id);
    const requestId = cleanText(message?.requestId);
    const entry = this._pendingCounterspellRequests.get(requestId);
    if (!entry || cleanText(message?.forUserId) !== currentUserId) {
      return;
    }

    const matchesSource = cleanText(senderId) === entry.forUserId
      && cleanText(message?.actorId) === entry.actorId
      && cleanText(message?.itemId) === entry.itemId;
    if (!matchesSource) {
      return;
    }

    this._pendingCounterspellRequests.delete(requestId);
    globalThis.clearTimeout(entry.timeoutId);
    entry.resolve(message?.result && typeof message.result === "object"
      ? message.result
      : { accepted: false, reason: "invalidResult" });
  }

  async #handleCounterspellRequest(message, senderId) {
    const currentUser = globalThis.game?.user;
    if (!currentUser || cleanText(message?.forUserId) !== cleanText(currentUser.id)) {
      return;
    }

    const actor = globalThis.game?.actors?.get?.(cleanText(message?.actorId)) ?? null;
    const item = actor?.items?.get?.(cleanText(message?.itemId))
      ?? collectionValues(actor?.items).find((entry) => documentId(entry) === cleanText(message?.itemId))
      ?? null;
    const parent = this.#normalizeCast(message?.cast ?? {});
    parent.sourceToken = this.#resolveSerializedSourceToken(message?.cast?.sourceToken);
    const candidate = actor && item && counterspellAutomation(item)
      ? {
        id: actor.id,
        actor,
        actorUuid: documentUuid(actor),
        item,
        activity: counterspellActivity(item),
        token: firstActiveToken(actor),
        visible: true
      }
      : null;
    let result = { accepted: false, reason: "notAvailable" };

    try {
      if (!candidate || !this.#actorOwnedByUser(actor, currentUser)) {
        throw new Error("Counterspell source is not owned by the requested user.");
      }

      if (!this.#isRemoteCandidateEligible(candidate, parent)) {
        result = { accepted: false, reason: "notEligible" };
      }
      else if (this.moduleApi?.combatAttackService?.canUseReaction?.(actor, 1)?.canUse !== true) {
        result = { accepted: false, reason: "noReaction" };
      }
      else {
        const choice = normalizeChoice(await this.promptCounterspell(candidate, parent), this.#candidateSpellLevel(candidate));
        if (!choice.accepted || choice.spellLevel < 1) {
          result = { accepted: false, reason: "declined" };
        }
        else {
          const attempt = this.#makeCounterspellAttempt(candidate, parent, choice.spellLevel);
          const paid = await this.#paySpell(candidate, attempt, parent);
          const reaction = paid === true
            ? await this.#consumeReaction(candidate)
            : { consumed: false, reason: "paymentFailed" };
          if (reaction?.consumed !== true || paid !== true) {
            result = { accepted: false, reaction, paid: paid === true, reason: "paymentFailed" };
          }
          else if (attempt.spellLevel >= parent.spellLevel) {
            result = {
              accepted: true,
              spellLevel: attempt.spellLevel,
              reaction,
              paid: true,
              success: true,
              dc: null,
              rollTotal: null
            };
          }
          else {
            const dc = 10 + parent.spellLevel;
            const rollTotal = await this.#rollAbilityCheck(attempt, dc, parent);
            result = {
              accepted: true,
              spellLevel: attempt.spellLevel,
              reaction,
              paid: true,
              success: Number.isFinite(rollTotal) && rollTotal >= dc,
              dc,
              rollTotal
            };
          }
        }
      }
    }
    catch (error) {
      result = { accepted: false, reason: cleanText(error?.message, "error") };
    }

    this.#emitCounterspellResult(message, result, senderId);
  }

  #emitCounterspellResult(request, result, senderId) {
    const game = globalThis.game;
    if (typeof game?.socket?.emit !== "function") {
      return;
    }

    game.socket.emit(SOCKET_CHANNEL, {
      type: COUNTERSPELL_RESULT_EVENT,
      requestId: cleanText(request?.requestId),
      forUserId: cleanText(senderId),
      senderId: cleanText(game?.user?.id),
      actorId: cleanText(request?.actorId),
      itemId: cleanText(request?.itemId),
      result
    });
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

  async #consumeReaction(candidate) {
    return this.moduleApi?.combatAttackService?.consumeReaction?.(candidate.actor, {
      reactionType: COUNTERSPELL_REACTION_TYPE
    }) ?? { consumed: false, reason: "reactionLedgerUnavailable" };
  }

  async #paySpell(candidate, attempt, parent) {
    if (typeof this._options.paySpell === "function") {
      return (await this._options.paySpell(candidate, parent, attempt)) !== false;
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

  async promptCounterspell(candidate, cast) {
    if (typeof this._options.promptCounterspell === "function") {
      return this._options.promptCounterspell(candidate, cast);
    }

    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof DialogV2?.wait !== "function") {
      return false;
    }

    const selectedLevel = this.#candidateSpellLevel(candidate);
    const availableLevels = this.#availableSpellLevels(candidate);
    if (!availableLevels.length) {
      return false;
    }
    const options = availableLevels.map((level) => (
      `<option value="${level}"${level === selectedLevel ? " selected" : ""}>Level ${level}</option>`
    )).join("");
    return DialogV2.wait({
      window: { title: "Counterspell" },
      content: `<p>Use Counterspell against a level ${cast.spellLevel} spell?</p><label>Slot <select name="spellLevel">${options}</select></label>`,
      buttons: [
        {
          action: "counter",
          label: "Counterspell",
          default: true,
          callback: (_event, button) => ({
            accepted: true,
            spellLevel: Math.max(1, Math.floor(toNumber(
              button?.form?.elements?.spellLevel?.value,
              selectedLevel
            )))
          })
        },
        {
          action: "decline",
          label: "Decline",
          callback: () => ({ accepted: false })
        }
      ],
      rejectClose: false,
      modal: true
    });
  }

  #isAutomatedChildUsage(usageConfig) {
    return usageConfig?.[MODULE_ID]?.spellAutomationChild === true
      || usageConfig?.[MODULE_ID]?.spellAutomationBypass === true;
  }
}
