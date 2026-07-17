import { MODULE_ID } from "../constants.js";
import { getActiveGm, isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export const REACTION_PROMPT_TIMEOUT_MS = 10_000;
export const REACTION_RESULT_TTL_MS = 60_000;
export const MAX_COMPLETED_REACTION_RESULTS = 256;
export const REACTION_SOCKET_CHANNEL = `module.${MODULE_ID}`;
export const REACTION_TRIGGER_EVENT = `${MODULE_ID}.reaction.trigger`;
export const REACTION_TRIGGER_RESULT_EVENT = `${MODULE_ID}.reaction.triggerResult`;
export const REACTION_PROMPT_EVENT = `${MODULE_ID}.reaction.prompt`;
export const REACTION_PROMPT_RESULT_EVENT = `${MODULE_ID}.reaction.promptResult`;
export const REACTION_TRIGGER_REQUEST_TIMEOUT_MS = 15 * 60_000;
export const MAX_PENDING_REACTION_REQUESTS = 128;

function cleanString(value) {
  return String(value ?? "").trim();
}

function collectionValues(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.contents)) {
    return value.contents;
  }
  if (typeof value?.values === "function") {
    return Array.from(value.values());
  }
  return [];
}

function defaultIdFactory() {
  return globalThis.crypto?.randomUUID?.()
    ?? `reaction-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function findUser(game, userId) {
  const normalizedId = cleanString(userId);
  if (!normalizedId) {
    return null;
  }
  return collectionValues(game?.users)
    .find((user) => cleanString(user?.id) === normalizedId)
    ?? (cleanString(game?.user?.id) === normalizedId ? game.user : null);
}

function escapeHtml(value) {
  const text = String(value ?? "");
  if (typeof globalThis.foundry?.utils?.escapeHTML === "function") {
    return globalThis.foundry.utils.escapeHTML(text);
  }
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function promptContent(prompt) {
  const fields = collectionValues(prompt?.fields).map((field) => {
    const name = cleanString(field?.name);
    const label = escapeHtml(field?.label ?? name);
    if (!name || field?.type !== "select") {
      return "";
    }
    const options = collectionValues(field?.options).map((option) => (
      `<option value="${escapeHtml(option?.value)}">${escapeHtml(option?.label ?? option?.value)}</option>`
    )).join("");
    return `<label>${label}<select name="${escapeHtml(name)}">${options}</select></label>`;
  }).join("");
  return `<p>${escapeHtml(prompt?.body)}</p>${fields}`;
}

function acceptedChoice(prompt, button) {
  const choice = { accepted: true };
  for (const field of collectionValues(prompt?.fields)) {
    const name = cleanString(field?.name);
    if (!name) {
      continue;
    }
    const rawValue = button?.form?.elements?.[name]?.value;
    const matchingOption = collectionValues(field?.options)
      .find((option) => String(option?.value) === String(rawValue));
    choice[name] = matchingOption ? matchingOption.value : rawValue;
  }
  return choice;
}

function serializableCopy(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  }
  catch {
    return fallback;
  }
}

function publicReactionResult(result = {}) {
  return {
    triggerId: cleanString(result.triggerId),
    kind: cleanString(result.kind),
    status: cleanString(result.status),
    accepted: collectionValues(result.accepted).map((entry) => ({
      candidate: {
        actorUuid: cleanString(entry?.candidate?.actorUuid),
        tokenUuid: cleanString(entry?.candidate?.tokenUuid),
        itemUuid: cleanString(entry?.candidate?.itemUuid),
        activityId: cleanString(entry?.candidate?.activityId)
      },
      choice: serializableCopy(entry?.choice, { accepted: true })
    }))
  };
}

function turnCandidateIndex(candidate, turns) {
  const actorUuid = cleanString(candidate?.actorUuid);
  const tokenUuid = cleanString(candidate?.tokenUuid);
  const index = turns.findIndex((turn) => (
    (tokenUuid && cleanString(turn?.token?.uuid ?? turn?.tokenUuid) === tokenUuid)
    || (actorUuid && cleanString(turn?.actor?.uuid ?? turn?.actorUuid) === actorUuid)
  ));
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function orderInCombat(candidates, combat) {
  const turns = collectionValues(combat?.turns);
  if (combat?.started !== true || !turns.length) {
    return null;
  }
  return candidates
    .map((candidate, inputIndex) => ({ candidate, inputIndex }))
    .sort((left, right) => (
      turnCandidateIndex(left.candidate, turns) - turnCandidateIndex(right.candidate, turns)
      || left.inputIndex - right.inputIndex
    ))
    .map((entry) => entry.candidate);
}

function shuffled(candidates, random) {
  const ordered = [...candidates];
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]];
  }
  return ordered;
}

export class ReactionQueueService {
  constructor(moduleApi = {}, options = {}) {
    this.moduleApi = moduleApi;
    this._options = options;
    this._providers = new Map();
    this._inFlight = new Map();
    this._completed = new Map();
    this._pendingPromptRequests = new Map();
    this._pendingTriggerRequests = new Map();
  }

  async initialize() {
    return this;
  }

  registerType(kind, provider) {
    const normalizedKind = cleanString(kind);
    if (!normalizedKind || !provider || typeof provider !== "object") {
      throw new TypeError("Reaction type requires a kind and provider");
    }
    this._providers.set(normalizedKind, provider);
    return this;
  }

  resolve(request = {}) {
    const triggerId = cleanString(request.triggerId);
    const kind = cleanString(request.kind);
    if (!triggerId || !kind) {
      return this._resolve(request);
    }

    const key = `${kind}\u0000${triggerId}`;
    const now = this._options.now?.() ?? Date.now();
    this._pruneCompleted(now);
    const completed = this._completed.get(key);
    if (completed?.expiresAt > now) {
      return Promise.resolve(completed.result);
    }
    const existing = this._inFlight.get(key);
    if (existing) {
      return existing;
    }

    const operation = this._isCoordinator()
      ? this._resolve(request)
      : this._requestRemoteTrigger(request);
    const pending = operation.then((result) => {
      this._rememberCompleted(key, result);
      return result;
    }).finally(() => {
      if (this._inFlight.get(key) === pending) {
        this._inFlight.delete(key);
      }
    });
    this._inFlight.set(key, pending);
    return pending;
  }

  _rememberCompleted(key, result) {
    const now = this._options.now?.() ?? Date.now();
    this._completed.delete(key);
    this._completed.set(key, {
      expiresAt: now + REACTION_RESULT_TTL_MS,
      result
    });
    while (this._completed.size > MAX_COMPLETED_REACTION_RESULTS) {
      this._completed.delete(this._completed.keys().next().value);
    }
  }

  _pruneCompleted(now) {
    for (const [key, entry] of this._completed) {
      if (entry.expiresAt <= now) {
        this._completed.delete(key);
      }
    }
  }

  async _resolve(request = {}) {
    const triggerId = cleanString(request.triggerId);
    const kind = cleanString(request.kind);
    const provider = this._providers.get(kind);
    if (!triggerId || !provider) {
      return { triggerId, kind, status: "invalid", accepted: [] };
    }

    const context = request.context ?? {};
    const discovered = collectionValues(await provider.listCandidates?.(
      context,
      this._options.capabilityIndex
    ));
    const combat = this._options.combatProvider?.() ?? globalThis.game?.combat ?? null;
    const candidates = orderInCombat(discovered, combat)
      ?? shuffled(discovered, this._options.random ?? Math.random);
    const accepted = [];

    for (const candidate of candidates) {
      if (await provider.isTriggerValid?.(context) === false) {
        return { triggerId, kind, status: "invalidated", accepted };
      }
      if (await provider.revalidateCandidate?.(candidate, context) === false) {
        continue;
      }
      const prompt = await provider.buildPrompt?.(candidate, context) ?? {};
      const choice = await this._promptWithTimeout({
        candidate,
        context,
        kind,
        prompt,
        triggerId
      });
      if (choice?.accepted === true) {
        const transaction = await this._executeAccepted({
          candidate,
          choice,
          context,
          kind,
          provider,
          triggerId
        });
        if (transaction.accepted !== true) {
          continue;
        }
        accepted.push({ candidate, choice, transaction });
        if (await provider.isTriggerValid?.(context) === false) {
          return { triggerId, kind, status: "invalidated", accepted };
        }
      }
    }

    return { triggerId, kind, status: "completed", accepted };
  }

  async _promptWithTimeout(promptContext) {
    const setTimeoutFn = this._options.setTimeoutFn
      ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    const clearTimeoutFn = this._options.clearTimeoutFn
      ?? ((timeoutId) => globalThis.clearTimeout(timeoutId));
    const controller = new AbortController();
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeoutFn(() => {
        controller.abort("timeout");
        resolve({ accepted: false, reason: "timeout" });
      }, REACTION_PROMPT_TIMEOUT_MS);
    });
    const promptHandler = typeof this._options.promptCandidate === "function"
      ? this._options.promptCandidate
      : (context) => this.promptDecision(context);
    const prompt = Promise.resolve(promptHandler({
      ...promptContext,
      signal: controller.signal
    }));

    try {
      return await Promise.race([prompt, timeout])
        ?? { accepted: false, reason: "closed" };
    }
    finally {
      clearTimeoutFn(timeoutId);
    }
  }

  async promptDecision({ candidate = {}, prompt = {}, signal, forUserId = "" } = {}) {
    const game = this._options.gameProvider?.() ?? globalThis.game;
    const currentUserId = cleanString(game?.user?.id);
    const promptUserId = cleanString(forUserId) || this._promptUserId(candidate, game);
    if (!currentUserId || !promptUserId) {
      return { accepted: false, reason: "noPromptUser" };
    }
    if (promptUserId === currentUserId) {
      return this._renderPrompt(prompt, signal);
    }
    return this._requestRemotePrompt({
      candidate,
      forUserId: promptUserId,
      prompt,
      signal
    });
  }

  async handleSocketMessage(message, transportSenderId = "") {
    if (message?.type === REACTION_TRIGGER_EVENT) {
      await this._handleTriggerRequest(message, transportSenderId);
      return true;
    }
    if (message?.type === REACTION_TRIGGER_RESULT_EVENT) {
      this._handleTriggerResult(message, transportSenderId);
      return true;
    }
    if (message?.type === REACTION_PROMPT_EVENT) {
      await this._handlePromptRequest(message, transportSenderId);
      return true;
    }
    if (message?.type === REACTION_PROMPT_RESULT_EVENT) {
      this._handlePromptResult(message, transportSenderId);
      return true;
    }
    return false;
  }

  _isCoordinator() {
    if (typeof this._options.isCoordinator === "function") {
      return this._options.isCoordinator() === true;
    }
    const game = this._options.gameProvider?.() ?? globalThis.game;
    return isActiveGmClient(game);
  }

  _requestRemoteTrigger(request) {
    const game = this._options.gameProvider?.() ?? globalThis.game;
    const senderId = cleanString(game?.user?.id);
    const forUserId = cleanString(getActiveGm(game)?.id);
    const requestId = cleanString((this._options.idFactory ?? defaultIdFactory)());
    if (
      !senderId
      || !forUserId
      || !requestId
      || this._pendingTriggerRequests.size >= MAX_PENDING_REACTION_REQUESTS
      || typeof game?.socket?.emit !== "function"
    ) {
      return Promise.resolve({
        triggerId: cleanString(request?.triggerId),
        kind: cleanString(request?.kind),
        status: "unavailable",
        accepted: []
      });
    }

    const setTimeoutFn = this._options.setTimeoutFn
      ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    return new Promise((resolve) => {
      const entry = { forUserId, resolve, timeoutId: null };
      entry.timeoutId = setTimeoutFn(() => {
        if (this._pendingTriggerRequests.get(requestId) === entry) {
          this._pendingTriggerRequests.delete(requestId);
          resolve({
            triggerId: cleanString(request?.triggerId),
            kind: cleanString(request?.kind),
            status: "coordinatorTimeout",
            accepted: []
          });
        }
      }, this._options.triggerRequestTimeoutMs ?? REACTION_TRIGGER_REQUEST_TIMEOUT_MS);
      this._pendingTriggerRequests.set(requestId, entry);
      try {
        game.socket.emit(REACTION_SOCKET_CHANNEL, {
          type: REACTION_TRIGGER_EVENT,
          requestId,
          senderId,
          forUserId,
          triggerId: cleanString(request?.triggerId),
          kind: cleanString(request?.kind),
          workflowId: cleanString(request?.workflowId),
          context: serializableCopy(request?.context ?? {}, {})
        });
      }
      catch {
        this._pendingTriggerRequests.delete(requestId);
        (this._options.clearTimeoutFn ?? globalThis.clearTimeout)(entry.timeoutId);
        resolve({
          triggerId: cleanString(request?.triggerId),
          kind: cleanString(request?.kind),
          status: "socketUnavailable",
          accepted: []
        });
      }
    });
  }

  async _handleTriggerRequest(message, transportSenderId) {
    const game = this._options.gameProvider?.() ?? globalThis.game;
    const currentUserId = cleanString(game?.user?.id);
    const senderId = cleanString(message?.senderId);
    if (
      !this._isCoordinator()
      || cleanString(message?.forUserId) !== currentUserId
      || cleanString(transportSenderId) !== senderId
      || !findUser(game, senderId)
    ) {
      return;
    }

    const result = await this.resolve({
      triggerId: cleanString(message?.triggerId),
      kind: cleanString(message?.kind),
      workflowId: cleanString(message?.workflowId),
      context: message?.context ?? {}
    });
    game?.socket?.emit?.(REACTION_SOCKET_CHANNEL, {
      type: REACTION_TRIGGER_RESULT_EVENT,
      requestId: cleanString(message?.requestId),
      senderId: currentUserId,
      forUserId: senderId,
      result: publicReactionResult(result)
    });
  }

  _handleTriggerResult(message, transportSenderId) {
    const game = this._options.gameProvider?.() ?? globalThis.game;
    const currentUserId = cleanString(game?.user?.id);
    const activeGmId = cleanString(getActiveGm(game)?.id);
    const requestId = cleanString(message?.requestId);
    const entry = this._pendingTriggerRequests.get(requestId);
    const senderId = cleanString(message?.senderId);
    if (
      !entry
      || cleanString(message?.forUserId) !== currentUserId
      || cleanString(transportSenderId) !== senderId
      || senderId !== activeGmId
      || entry.forUserId !== senderId
    ) {
      return;
    }

    this._pendingTriggerRequests.delete(requestId);
    (this._options.clearTimeoutFn ?? globalThis.clearTimeout)(entry.timeoutId);
    entry.resolve(message.result ?? {
      triggerId: "",
      kind: "",
      status: "invalidResult",
      accepted: []
    });
  }

  _promptUserId(candidate, game) {
    for (const ownerUserId of collectionValues(candidate?.ownerUserIds)) {
      const user = findUser(game, ownerUserId);
      if (user?.active === true) {
        return cleanString(user.id);
      }
    }
    return cleanString(getActiveGm(game)?.id);
  }

  _requestRemotePrompt({ candidate, forUserId, prompt, signal }) {
    const game = this._options.gameProvider?.() ?? globalThis.game;
    const senderId = cleanString(game?.user?.id);
    const requestId = cleanString((this._options.idFactory ?? defaultIdFactory)());
    const maxPendingRequests = this._options.maxPendingRequests
      ?? MAX_PENDING_REACTION_REQUESTS;
    if (this._pendingPromptRequests.size >= maxPendingRequests) {
      return Promise.resolve({ accepted: false, reason: "queueFull" });
    }
    if (!senderId || !forUserId || !requestId || typeof game?.socket?.emit !== "function") {
      return Promise.resolve({ accepted: false, reason: "socketUnavailable" });
    }

    return new Promise((resolve) => {
      const entry = { forUserId, resolve, signal, abortHandler: null };
      entry.abortHandler = () => {
        if (this._pendingPromptRequests.get(requestId) === entry) {
          this._pendingPromptRequests.delete(requestId);
          resolve({ accepted: false, reason: "timeout" });
        }
      };
      signal?.addEventListener?.("abort", entry.abortHandler, { once: true });
      this._pendingPromptRequests.set(requestId, entry);

      try {
        game.socket.emit(REACTION_SOCKET_CHANNEL, {
          type: REACTION_PROMPT_EVENT,
          requestId,
          senderId,
          forUserId,
          candidate: {
            actorUuid: cleanString(candidate?.actorUuid),
            tokenUuid: cleanString(candidate?.tokenUuid),
            itemUuid: cleanString(candidate?.itemUuid),
            activityId: cleanString(candidate?.activityId)
          },
          prompt
        });
      }
      catch {
        this._pendingPromptRequests.delete(requestId);
        signal?.removeEventListener?.("abort", entry.abortHandler);
        resolve({ accepted: false, reason: "socketUnavailable" });
      }
    });
  }

  async _handlePromptRequest(message, transportSenderId) {
    const game = this._options.gameProvider?.() ?? globalThis.game;
    const currentUserId = cleanString(game?.user?.id);
    const activeGmId = cleanString(getActiveGm(game)?.id);
    const senderId = cleanString(message?.senderId);
    if (
      cleanString(message?.forUserId) !== currentUserId
      || cleanString(transportSenderId) !== senderId
      || senderId !== activeGmId
    ) {
      return;
    }

    const choice = await this._renderPromptWithTimeout(message.prompt)
      ?? { accepted: false, reason: "closed" };
    game?.socket?.emit?.(REACTION_SOCKET_CHANNEL, {
      type: REACTION_PROMPT_RESULT_EVENT,
      requestId: cleanString(message?.requestId),
      senderId: currentUserId,
      forUserId: senderId,
      choice
    });
  }

  _handlePromptResult(message, transportSenderId) {
    const game = this._options.gameProvider?.() ?? globalThis.game;
    if (!isActiveGmClient(game)) {
      return;
    }
    const requestId = cleanString(message?.requestId);
    const entry = this._pendingPromptRequests.get(requestId);
    const senderId = cleanString(message?.senderId);
    if (
      !entry
      || cleanString(message?.forUserId) !== cleanString(game?.user?.id)
      || cleanString(transportSenderId) !== senderId
      || entry.forUserId !== senderId
    ) {
      return;
    }

    this._pendingPromptRequests.delete(requestId);
    entry.signal?.removeEventListener?.("abort", entry.abortHandler);
    entry.resolve(message.choice ?? { accepted: false, reason: "closed" });
  }

  async _renderPromptWithTimeout(prompt) {
    const setTimeoutFn = this._options.setTimeoutFn
      ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    const clearTimeoutFn = this._options.clearTimeoutFn
      ?? ((timeoutId) => globalThis.clearTimeout(timeoutId));
    const controller = new AbortController();
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeoutFn(() => {
        controller.abort("timeout");
        resolve({ accepted: false, reason: "timeout" });
      }, REACTION_PROMPT_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        Promise.resolve(this._renderPrompt(prompt, controller.signal)),
        timeout
      ]);
    }
    finally {
      clearTimeoutFn(timeoutId);
    }
  }

  async _renderPrompt(prompt, signal) {
    if (typeof this._options.promptRenderer === "function") {
      return this._options.promptRenderer(prompt, { signal });
    }
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof DialogV2 !== "function") {
      return { accepted: false, reason: "promptRendererUnavailable" };
    }

    return new Promise((resolve) => {
      let settled = false;
      let dialog;
      const finish = (choice) => {
        if (settled) {
          return;
        }
        settled = true;
        signal?.removeEventListener?.("abort", abortHandler);
        resolve(choice);
      };
      const abortHandler = () => {
        finish({ accepted: false, reason: cleanString(signal?.reason) || "timeout" });
        Promise.resolve(dialog?.close?.({ force: true })).catch(() => undefined);
      };
      dialog = new DialogV2({
        window: { title: cleanString(prompt?.title) || "Reaction" },
        content: promptContent(prompt),
        buttons: [
          {
            action: "accept",
            label: cleanString(prompt?.acceptLabel) || "Использовать реакцию",
            default: true,
            callback: (_event, button) => finish(acceptedChoice(prompt, button))
          },
          {
            action: "decline",
            label: cleanString(prompt?.declineLabel) || "Пропустить",
            callback: () => finish({ accepted: false, reason: "declined" })
          }
        ],
        close: () => finish({ accepted: false, reason: "closed" })
      });
      signal?.addEventListener?.("abort", abortHandler, { once: true });
      if (signal?.aborted) {
        abortHandler();
        return;
      }
      dialog.render?.({ force: true });
    });
  }

  async _executeAccepted({ candidate, choice, context, kind, provider, triggerId }) {
    const transaction = { payment: null, effect: null, reaction: null };
    try {
      transaction.payment = typeof provider.pay === "function"
        ? await provider.pay(candidate, choice, context)
        : { paid: true };
      if (transaction.payment === false || transaction.payment?.paid === false) {
        return { accepted: false, reason: "paymentFailed", ...transaction };
      }

      transaction.effect = typeof provider.apply === "function"
        ? await provider.apply(candidate, choice, context)
        : { applied: true };
      if (transaction.effect === false || transaction.effect?.applied === false) {
        await this._rollback(provider, candidate, transaction, context);
        return { accepted: false, reason: "applicationFailed", ...transaction };
      }

      if (provider.consumesReaction !== false && candidate?.consumesReaction !== false) {
        const actor = candidate?.actor
          ?? await this._options.actorResolver?.(candidate?.actorUuid)
          ?? null;
        const consumeReaction = this.moduleApi?.combatAttackService?.consumeReaction;
        transaction.reaction = typeof consumeReaction === "function"
          ? await consumeReaction.call(this.moduleApi.combatAttackService, actor, {
            reactionType: cleanString(candidate?.reactionType ?? provider.reactionType ?? kind),
            triggerId
          })
          : { consumed: false, reason: "reactionLedgerUnavailable" };
        if (transaction.reaction?.consumed !== true) {
          await this._rollback(provider, candidate, transaction, context);
          return { accepted: false, reason: "reactionFailed", ...transaction };
        }
      }

      return { accepted: true, ...transaction };
    }
    catch (error) {
      this._logProviderError(error, { candidate, context, kind, triggerId });
      await this._rollback(provider, candidate, { ...transaction, error }, context);
      return { accepted: false, reason: "providerError", error, ...transaction };
    }
  }

  async _rollback(provider, candidate, transaction, context) {
    if (typeof provider.rollback !== "function") {
      return;
    }
    try {
      await provider.rollback(candidate, transaction, context);
    }
    catch (error) {
      this._logProviderError(error, { candidate, context, phase: "rollback" });
    }
  }

  _logProviderError(error, details) {
    this._options.logger?.error?.("Reaction provider failed", {
      ...details,
      error
    });
  }

  destroy() {
    for (const [requestId, entry] of this._pendingPromptRequests) {
      this._pendingPromptRequests.delete(requestId);
      entry.signal?.removeEventListener?.("abort", entry.abortHandler);
      entry.resolve({ accepted: false, reason: "destroyed" });
    }
    const clearTimeoutFn = this._options.clearTimeoutFn
      ?? ((timeoutId) => globalThis.clearTimeout(timeoutId));
    for (const [requestId, entry] of this._pendingTriggerRequests) {
      this._pendingTriggerRequests.delete(requestId);
      clearTimeoutFn(entry.timeoutId);
      entry.resolve({
        triggerId: "",
        kind: "",
        status: "destroyed",
        accepted: []
      });
    }
    this._completed.clear();
    this._providers.clear();
  }
}
