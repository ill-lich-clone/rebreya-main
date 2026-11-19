import { MODULE_ID } from "../constants.js";
import { getActiveGm } from "../infrastructure/foundry/active-gm.js";

const EVENT = `${MODULE_ID}.reaction.managed`;
const RESULT = `${EVENT}Result`;
const NONE = Object.freeze({ name: "None" });
const LIMIT = 128;
const TTL = 60_000;
const TIMEOUT = 10_000;
const APPLICATION_TIMEOUT = 120_000;

function values(collection) { return Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []); }
function reactionCount(actor) {
  const actions = actor?.flags?.["midi-qol"]?.actions;
  return Number(actions?.reactionsUsed ?? (actions?.reaction ? 1 : 0));
}

// Owned by ReactionQueueService. Native callbacks stay on the actor owner's client;
// only the active GM grants a time-bounded permission to start their application.
export class ManagedReactionSessions {
  constructor(queue) {
    this.queue = queue;
    this.entries = new Map();
    this.pending = new Map();
    this.runs = new Map();
  }

  get options() { return this.queue._options; }
  game() { return this.options.gameProvider?.() ?? globalThis.game; }
  now() { return this.options.now?.() ?? Date.now(); }
  timer(fn, ms) { return (this.options.setTimeoutFn ?? globalThis.setTimeout)(fn, ms); }
  clear(id) { (this.options.clearTimeoutFn ?? globalThis.clearTimeout)(id); }
  id() { return this.options.idFactory?.() ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

  resolve(request, execute) {
    const key = `${request.kind}:${request.triggerId}:${request.candidate?.actorUuid}`;
    this.prune();
    if (this.runs.has(key)) return this.runs.get(key).promise;
    if (this.runs.size >= LIMIT) return Promise.resolve({ ...NONE });
    const entry = { expiresAt: Infinity, promise: null };
    entry.promise = this.run(request, execute).finally(() => { entry.expiresAt = this.now() + TTL; });
    this.runs.set(key, entry);
    return entry.promise;
  }

  async run(request, execute) {
    const sessionId = this.id();
    const permission = await this.rpc("begin", { request, sessionId });
    if (!permission?.allowed) return { ...NONE };
    const controller = new AbortController();
    let committed = false;
    let committing;
    let result;
    let timeoutId;
    let reason = "declined";
    let resolveTimeout;
    const timeout = new Promise(resolve => { resolveTimeout = resolve; });
    const choiceDeadline = this.now() + permission.remainingMs;
    const setDeadline = (deadline, expiredReason) => {
      this.clear(timeoutId);
      timeoutId = this.timer(() => {
        reason = expiredReason;
        controller.abort(expiredReason);
        resolveTimeout({ ...NONE });
      }, Math.max(0, deadline - this.now()));
    };
    setDeadline(choiceDeadline, "timeout");
    const commit = (choice = {}) => {
      if (controller.signal.aborted) return Promise.resolve(false);
      if (committed) return Promise.resolve(true);
      if (committing) return committing;
      if (this.now() >= choiceDeadline) return Promise.resolve(false);
      // After the click, the GM validates its own deadline and persists the reservation.
      setDeadline(this.now() + TIMEOUT, "error");
      committing = this.rpc("commit", { sessionId, activityUuid: choice.activityUuid }).then(answer => {
        if (!answer?.allowed || controller.signal.aborted) {
          if (!controller.signal.aborted) reason = "error";
          return false;
        }
        committed = true;
        setDeadline(this.now() + answer.remainingMs, "indeterminate");
        return true;
      });
      return committing;
    };
    try {
      result = await Promise.race([
        Promise.resolve().then(() => execute({ signal: controller.signal, commit, sessionId, choiceDeadline,
          activityUuids: permission.activityUuids, reportClose: () => { if (!committing && reason === "declined") reason = "closed"; } })),
        timeout
      ]);
      if (!committed && result?.uuid) {
        reason = "error";
        result = { ...NONE };
      } else if (committed && !result?.uuid && reason === "declined") reason = "unapplied";
      return result ?? { ...NONE };
    }
    catch (error) {
      reason = "error";
      throw error;
    }
    finally {
      this.clear(timeoutId);
      // This also closes a native window whose handler rejected before its close callback.
      controller.abort("finished");
      const finish = this.rpc("finish", { sessionId, result: result ?? NONE, reason }).catch(error => {
        (this.options.logger ?? console).warn("Native reaction finalization failed", error);
      });
      if (!(committed && result?.uuid)) await finish;
    }
  }

  async rpc(op, payload) {
    const game = this.game();
    const senderId = game?.user?.id;
    const forUserId = getActiveGm(game)?.id;
    if (!senderId || !forUserId) return null;
    if (this.queue._isCoordinator()) return this.command(op, payload, senderId);
    if (!game?.socket?.emit || this.pending.size >= LIMIT) return null;
    const requestId = this.id();
    return new Promise(resolve => {
      const timer = this.timer(() => { this.pending.delete(requestId); resolve(null); }, TIMEOUT);
      this.pending.set(requestId, { resolve, timer, forUserId });
      try { game.socket.emit(`module.${MODULE_ID}`, { type: EVENT, op, ...payload, requestId, senderId, forUserId }); }
      catch { this.clear(timer); this.pending.delete(requestId); resolve(null); }
    });
  }

  async handle(message, senderId) {
    if (message?.type !== EVENT && message?.type !== RESULT) return false;
    const game = this.game();
    if (message.senderId !== senderId || message.forUserId !== game?.user?.id) return true;
    if (message.type === RESULT) {
      const pending = this.pending.get(message.requestId);
      if (!pending || pending.forUserId !== senderId || senderId !== getActiveGm(game)?.id) return true;
      this.pending.delete(message.requestId); this.clear(pending.timer);
      pending.resolve(message.result);
    }
    else if (this.queue._isCoordinator()) {
      const result = await this.command(message.op, message, senderId);
      game.socket?.emit?.(`module.${MODULE_ID}`, { type: RESULT, senderId: game.user.id, forUserId: senderId, requestId: message.requestId, result });
    }
    return true;
  }

  async command(op, data, senderId) {
    this.prune();
    const game = this.game();
    const user = values(game?.users).find(user => user.id === senderId);
    if (!user?.active || typeof data.sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.sessionId)) return { allowed: false };
    if (op === "begin") {
      if (this.entries.has(data.sessionId)) return { allowed: false };
      const { request } = data;
      if (request?.kind !== "midi-native" || !request.triggerId || this.entries.size >= LIMIT) return { allowed: false };
      const reference = request.candidate?.tokenUuid || request.candidate?.actorUuid;
      const resolved = await (this.options.actorResolver ?? globalThis.fromUuid)?.(reference);
      const actor = resolved?.actor ?? resolved;
      if (!actor || actor.uuid !== request.candidate?.actorUuid
        || (!user.isGM && actor.testUserPermission?.(user, "OWNER") !== true)) return { allowed: false };
      const costs = {};
      const requested = request.candidate?.activityUuids;
      if (requested !== undefined && !Array.isArray(requested)) return { allowed: false };
      for (const uuid of new Set(requested ?? [])) {
        if (typeof uuid !== "string" || !uuid || ["__proto__", "constructor", "prototype"].includes(uuid)) continue;
        let activity;
        try { activity = await (this.options.documentResolver ?? globalThis.fromUuid)?.(uuid); }
        catch { continue; }
        const type = activity?.effectiveActivationType ?? activity?.activation?.type;
        if (activity?.actor?.uuid !== actor.uuid || !String(type ?? "").startsWith("reaction")) continue;
        costs[uuid] = Number(activity.activation?.value ?? activity.activation?.cost ?? 1) > 0 ? 1 : 0;
      }
      const activityUuids = Object.keys(costs);
      const optionalAc = request.triggerType === "reactionattacked"
        && Object.values(actor.flags?.["midi-qol"]?.optional ?? {}).some(flag => flag?.ac !== undefined);
      if (requested !== undefined && !activityUuids.length && !optionalAc) return { allowed: false };
      const requiredUses = Object.values(costs).includes(0) ? 0 : 1;
      const ledger = this.queue.moduleApi?.combatAttackService;
      if (requiredUses > 0 && ledger?.canUseReaction?.(actor)?.canUse === false) return { allowed: false };
      const key = `${request.triggerId}:${actor.uuid}`;
      if (this.entries.has(data.sessionId) || [...this.entries.values()].some(entry => entry.key === key)) return { allowed: false };
      const entry = { key, actor, senderId, state: "choosing", expiresAt: this.now() + TIMEOUT,
        costs, requiredUses, remaining: ledger?.getReactionState?.(actor)?.usesRemaining, midiCount: reactionCount(actor) };
      this.entries.set(data.sessionId, entry);
      entry.messageReady = this.queue._beginReactionMessage({ ...request, candidate: { ...request.candidate, actor }, expiresAt: entry.expiresAt, managed: {
        // Foundry expands dotted UUID keys in ChatMessage flags in place.
        sessionId: data.sessionId, ownerUserId: senderId, key, costs: { ...costs }, requiredUses,
        remaining: entry.remaining, midiCount: entry.midiCount
      } }).then(message => { entry.message = message; return message; });
      this.watch(entry, "choosing", "timeout");
      return { allowed: true, remainingMs: Math.max(0, entry.expiresAt - this.now()), activityUuids };
    }
    const entry = this.entries.get(data.sessionId) ?? await this.restore(data.sessionId);
    if (!entry || entry.senderId !== senderId) return { allowed: false };
    if (op === "commit") {
      if (!user.isGM && entry.actor.testUserPermission?.(user, "OWNER") !== true) return { allowed: false };
      if (entry.state === "applying") {
        if (entry.activityUuid !== data.activityUuid) return { allowed: false };
        return entry.commitPromise ?? { allowed: entry.expiresAt > this.now(), remainingMs: Math.max(0, entry.expiresAt - this.now()) };
      }
      if (data.activityUuid && !Object.hasOwn(entry.costs, data.activityUuid)) return { allowed: false };
      const requiredUses = data.activityUuid ? entry.costs[data.activityUuid] : 1;
      const available = requiredUses === 0 || this.queue.moduleApi?.combatAttackService?.canUseReaction?.(entry.actor, requiredUses + this.reservedUses(entry.actor.uuid))?.canUse !== false;
      if (entry.state !== "choosing" || entry.expiresAt <= this.now() || !available) return { allowed: false };
      entry.requiredUses = requiredUses;
      entry.activityUuid = data.activityUuid;
      entry.state = "applying";
      entry.expiresAt = this.now() + APPLICATION_TIMEOUT;
      this.watch(entry, "applying", "indeterminate");
      entry.commitPromise = (async () => {
        const message = entry.messageReady ? await entry.messageReady : entry.message;
        if (entry.state !== "applying") return { allowed: false };
        const choice = message?.flags?.[MODULE_ID]?.reactionChoice ?? {};
        try { await message?.update({ flags: { [MODULE_ID]: { reactionChoice: {
          ...choice, state: "applying", expiresAt: entry.expiresAt,
          managed: { ...choice.managed, requiredUses, activityUuid: entry.activityUuid ?? null, applicationDeadline: true }
        } } } }); }
        catch (error) { this.options.logger?.warn?.("Reaction chat commit failed", error); }
        if (entry.state !== "applying") {
          await this.queue._finishReactionMessage(entry.message, false, entry.reason);
          return { allowed: false };
        }
        return { allowed: true, remainingMs: Math.max(0, entry.expiresAt - this.now()) };
      })();
      return entry.commitPromise;
    }
    if (op === "finish") {
      if (entry.state === "finished" || entry.state === "declined") return { allowed: true };
      this.clear(entry.timer);
      const result = data.result;
      const applied = entry.state === "applying" && !!result?.uuid && result.name !== "None" && result.name !== "Filter";
      entry.state = "finished"; entry.expiresAt = this.now() + TTL;
      entry.reason = data.reason;
      const ledger = this.queue.moduleApi?.combatAttackService;
      if (applied && entry.requiredUses > 0 && reactionCount(entry.actor) > entry.midiCount) {
        try { await ledger?.consumeReaction?.(entry.actor, { reactionType: "midi-native", triggerId: entry.key, idempotencyKey: `midi-native:${entry.key}` }); }
        catch (error) { this.options.logger?.error?.("Native reaction ledger synchronization failed", error); }
      }
      await this.queue._finishReactionMessage(entry.messageReady ? await entry.messageReady : entry.message, applied, data.reason);
      return { allowed: true };
    }
    return { allowed: false };
  }

  async restore(sessionId) {
    const message = values(this.game()?.messages).find(message => message.author?.isGM === true
      && message.flags?.[MODULE_ID]?.reactionChoice?.managed?.sessionId === sessionId);
    const choice = message?.flags?.[MODULE_ID]?.reactionChoice;
    if (!choice || !["choosing", "applying"].includes(choice.state) || this.entries.size >= LIMIT) return null;
    const resolved = await (this.options.actorResolver ?? globalThis.fromUuid)?.(choice.candidateActorUuid);
    const actor = resolved?.actor ?? resolved;
    if (!actor || actor.uuid !== choice.candidateActorUuid) return null;
    const managed = choice.managed;
    const storedCosts = managed.costs ?? {};
    const entry = { actor, message, senderId: managed.ownerUserId, key: managed.key,
      costs: globalThis.foundry?.utils?.flattenObject?.(storedCosts) ?? storedCosts, requiredUses: managed.requiredUses ?? 1,
      activityUuid: managed.activityUuid ?? undefined,
      remaining: managed.remaining, midiCount: managed.midiCount,
      state: choice.state, expiresAt: this.messageDeadline(choice) };
    if (this.entries.has(sessionId)) return this.entries.get(sessionId);
    this.entries.set(sessionId, entry);
    this.watch(entry, entry.state, entry.state === "applying" ? "indeterminate" : "timeout");
    return entry;
  }

  messageDeadline(choice) {
    // Older applying messages still carry the deadline of the original choice.
    return choice.state === "applying" && choice.managed?.applicationDeadline !== true
      ? Number(choice.expiresAt) + APPLICATION_TIMEOUT
      : Number(choice.expiresAt);
  }

  watch(entry, state, reason) {
    this.clear(entry.timer);
    entry.timer = this.timer(() => {
      if (entry.state === state && this.queue._isCoordinator()) void this.expireEntry(entry, reason);
    }, Math.max(0, entry.expiresAt - this.now()));
  }

  async expireEntry(entry, reason) {
    entry.state = "declined";
    entry.expiresAt = this.now() + TTL;
    entry.reason = reason;
    this.clear(entry.timer);
    await this.queue._finishReactionMessage(entry.messageReady ? await entry.messageReady : entry.message, false, reason);
  }

  async reconcile() {
    const activeIds = new Set(values(this.game()?.users).filter(user => user.active).map(user => user.id));
    const now = this.now();
    for (const message of values(this.game()?.messages)) {
      const choice = message.flags?.[MODULE_ID]?.reactionChoice;
      const managed = choice?.managed;
      if (!choice || !["choosing", "applying"].includes(choice.state)) continue;
      if (choice.state === "applying" && !managed) continue;
      const entry = managed && this.entries.get(managed.sessionId);
      const state = entry?.state ?? choice.state;
      if (!["choosing", "applying"].includes(state)) continue;
      const disconnected = managed && !activeIds.has(managed.ownerUserId);
      const expired = (entry?.expiresAt ?? this.messageDeadline(choice)) <= now;
      if (!disconnected && !expired) continue;
      const reason = disconnected ? "disconnected" : state === "applying" ? "indeterminate" : "timeout";
      if (entry) await this.expireEntry(entry, reason);
      else await this.queue._finishReactionMessage(message, false, reason);
    }
  }

  isActorReserved(actorUuid) {
    return this.reservedUses(actorUuid) > 0;
  }

  reservedUses(actorUuid) {
    return [...this.entries.values()].reduce((total, entry) => total
      + (entry.state === "applying" && entry.actor.uuid === actorUuid ? entry.requiredUses : 0), 0);
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now && ["finished", "declined"].includes(entry.state)) this.entries.delete(key);
    for (const [key, entry] of this.runs) if (entry.expiresAt <= now) this.runs.delete(key);
  }

  destroy() {
    for (const entry of this.pending.values()) { this.clear(entry.timer); entry.resolve(null); }
    for (const entry of this.entries.values()) this.clear(entry.timer);
    this.pending.clear(); this.entries.clear(); this.runs.clear();
  }
}
