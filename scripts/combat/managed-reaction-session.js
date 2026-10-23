import { MODULE_ID } from "../constants.js";
import { getActiveGm } from "../infrastructure/foundry/active-gm.js";

const EVENT = `${MODULE_ID}.reaction.managed`;
const RESULT = `${EVENT}Result`;
const NONE = Object.freeze({ name: "None" });
const LIMIT = 128;
const TTL = 60_000;
const TIMEOUT = 10_000;

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
    const timeout = new Promise(resolve => {
      timeoutId = this.timer(() => {
        if (committed) return;
        controller.abort("timeout");
        resolve({ ...NONE });
      }, Math.max(0, permission.expiresAt - this.now()));
    });
    const commit = (choice = {}) => {
      if (controller.signal.aborted) return Promise.resolve(false);
      if (committed) return Promise.resolve(true);
      return committing ??= this.rpc("commit", { sessionId, activityUuid: choice.activityUuid }).then(answer => {
        if (!answer?.allowed || controller.signal.aborted) return false;
        committed = true;
        this.clear(timeoutId);
        return true;
      });
    };
    try {
      result = await Promise.race([
        Promise.resolve().then(() => execute({ signal: controller.signal, commit, sessionId })),
        timeout
      ]);
      if (!committed && result?.uuid) result = { ...NONE };
      return result ?? { ...NONE };
    }
    finally {
      this.clear(timeoutId);
      // This also closes a native window whose handler rejected before its close callback.
      controller.abort("finished");
      await this.rpc("finish", { sessionId, result: result ?? NONE });
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
      for (const uuid of request.candidate?.activityUuids ?? []) {
        const activity = await (this.options.documentResolver ?? globalThis.fromUuid)?.(uuid);
        if (activity?.actor?.uuid !== actor.uuid || !String(activity.activation?.type ?? "").startsWith("reaction")) return { allowed: false };
        costs[uuid] = Number(activity.activation?.value ?? 1) > 0 ? 1 : 0;
      }
      const requiredUses = Object.values(costs).includes(0) ? 0 : 1;
      const ledger = this.queue.moduleApi?.combatAttackService;
      if (requiredUses > 0 && ledger?.canUseReaction?.(actor)?.canUse === false) return { allowed: false };
      const key = `${request.triggerId}:${actor.uuid}`;
      if (this.entries.has(data.sessionId) || [...this.entries.values()].some(entry => entry.key === key)) return { allowed: false };
      const entry = { key, actor, senderId, state: "choosing", expiresAt: this.now() + TIMEOUT,
        costs, requiredUses, remaining: ledger?.getReactionState?.(actor)?.usesRemaining, midiCount: reactionCount(actor) };
      this.entries.set(data.sessionId, entry);
      entry.message = await this.queue._beginReactionMessage({ ...request, managed: {
        sessionId: data.sessionId, ownerUserId: senderId, key, costs, requiredUses,
        remaining: entry.remaining, midiCount: entry.midiCount
      } });
      entry.timer = this.timer(() => {
        if (entry.state !== "choosing") return;
        entry.state = "declined"; entry.expiresAt = this.now() + TTL;
        void this.queue._finishReactionMessage(entry.message, false);
      }, Math.max(0, entry.expiresAt - this.now()));
      return { allowed: true, expiresAt: entry.expiresAt };
    }
    const entry = this.entries.get(data.sessionId) ?? await this.restore(data.sessionId);
    if (!entry || entry.senderId !== senderId) return { allowed: false };
    if (op === "commit") {
      if (!user.isGM && entry.actor.testUserPermission?.(user, "OWNER") !== true) return { allowed: false };
      if (entry.state === "applying") return { allowed: true };
      if (data.activityUuid && !Object.hasOwn(entry.costs, data.activityUuid)) return { allowed: false };
      const requiredUses = data.activityUuid ? entry.costs[data.activityUuid] : 1;
      const available = requiredUses === 0 || this.queue.moduleApi?.combatAttackService?.canUseReaction?.(entry.actor, requiredUses + this.reservedUses(entry.actor.uuid))?.canUse !== false;
      if (entry.state !== "choosing" || entry.expiresAt <= this.now() || !available) return { allowed: false };
      entry.requiredUses = requiredUses;
      entry.state = "applying"; entry.expiresAt = Infinity; this.clear(entry.timer);
      const choice = entry.message?.flags?.[MODULE_ID]?.reactionChoice ?? {};
      try { await entry.message?.update({ flags: { [MODULE_ID]: { reactionChoice: {
        ...choice, state: "applying", managed: { ...choice.managed, requiredUses }
      } } } }); }
      catch (error) { this.options.logger?.warn?.("Reaction chat commit failed", error); }
      return { allowed: true };
    }
    if (op === "finish") {
      if (entry.state === "finished" || entry.state === "declined") return { allowed: true };
      this.clear(entry.timer);
      const result = data.result;
      const applied = entry.state === "applying" && !!result?.uuid && result.name !== "None" && result.name !== "Filter";
      entry.state = "finished"; entry.expiresAt = this.now() + TTL;
      const ledger = this.queue.moduleApi?.combatAttackService;
      if (applied && entry.requiredUses > 0 && reactionCount(entry.actor) > entry.midiCount) {
        try { await ledger?.consumeReaction?.(entry.actor, { reactionType: "midi-native", triggerId: entry.key, idempotencyKey: `midi-native:${entry.key}` }); }
        catch (error) { this.options.logger?.error?.("Native reaction ledger synchronization failed", error); }
      }
      await this.queue._finishReactionMessage(entry.message, applied);
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
    const entry = { actor, message, senderId: managed.ownerUserId, key: managed.key,
      costs: managed.costs ?? {}, requiredUses: managed.requiredUses ?? 1,
      remaining: managed.remaining, midiCount: managed.midiCount,
      state: choice.state, expiresAt: choice.state === "applying" ? Infinity : choice.expiresAt };
    if (this.entries.has(sessionId)) return this.entries.get(sessionId);
    this.entries.set(sessionId, entry);
    return entry;
  }

  async reconcile() {
    const users = values(this.game()?.users);
    for (const message of values(this.game()?.messages)) {
      const choice = message.flags?.[MODULE_ID]?.reactionChoice;
      const managed = choice?.managed;
      if (!managed || choice.state !== "applying" || users.some(user => user.id === managed.ownerUserId && user.active)) continue;
      const entry = this.entries.get(managed.sessionId);
      if (entry) { entry.state = "declined"; entry.expiresAt = this.now() + TTL; this.clear(entry.timer); }
      await this.queue._finishReactionMessage(message, false);
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
