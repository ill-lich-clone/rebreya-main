import { WorldMutationCoordinator } from "../../application/world-mutation-coordinator.js";
import {
  EXCLUSIVE_MUTATION_SCHEDULING,
  normalizeSocketScheduling,
  resolveSocketScheduling
} from "../../application/socket-command-scheduling.js";
import { MODULE_ID } from "../../constants.js";
import { getActiveGm, isActiveGmClient } from "./active-gm.js";
import { NOOP_SOCKET_COMMAND_TRACE } from "./socket-command-trace.js";

export const SOCKET_CHANNEL = `module.${MODULE_ID}`;
export const COMMAND_REQUEST_TYPE = "rebreya.command";
export const COMMAND_ACCEPTED_TYPE = "rebreya.command.accepted";
export const COMMAND_RESULT_TYPE = "rebreya.command.result";
export const MAX_SOCKET_ENVELOPE_BYTES = 65536;
export const REQUEST_TIMEOUT_MS = 10000;
export const COMPLETION_TIMEOUT_MS = 60000;

const textEncoder = new TextEncoder();

export class SocketCommandError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "SocketCommandError";
    this.code = code;
    const detached = normalizeErrorDetails(details);
    if (detached) {
      this.details = detached;
      const reserved = new Set([
        "name", "message", "code", "stack", "cause", "details", "__proto__", "prototype", "constructor"
      ]);
      for (const [key, value] of Object.entries(detached)) {
        if (!reserved.has(key)) this[key] = value;
      }
    }
  }
}

function defaultIdFactory() {
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `command-${Date.now()}-${randomPart}`;
}

function serializedSize(envelope) {
  try {
    const serialized = JSON.stringify(envelope);
    return typeof serialized === "string"
      ? textEncoder.encode(serialized).byteLength
      : null;
  }
  catch {
    return null;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidResultError(error) {
  return Boolean(
    isPlainObject(error)
    && nonEmptyString(error.code)
    && nonEmptyString(error.message)
    && (error.details === undefined || isPlainObject(error.details))
  );
}

function normalizeErrorDetails(value) {
  if (!isPlainObject(value)) return null;
  try {
    const detached = JSON.parse(JSON.stringify(value));
    return isPlainObject(detached) ? detached : null;
  }
  catch {
    return null;
  }
}

function requestCorrelation(message) {
  if (
    !nonEmptyString(message?.command)
    || !nonEmptyString(message?.requestId)
    || !nonEmptyString(message?.senderId)
  ) {
    return null;
  }
  return {
    command: message.command,
    requestId: message.requestId,
    senderId: message.senderId
  };
}

function isValidRequestEnvelope(message) {
  return Boolean(
    requestCorrelation(message)
    && Object.prototype.hasOwnProperty.call(message, "payload")
  );
}

function findUser(game, userId) {
  const normalizedId = String(userId);
  const direct = game?.users?.get?.(normalizedId);
  if (direct) {
    return direct;
  }

  const users = Array.isArray(game?.users?.contents)
    ? game.users.contents
    : (Array.isArray(game?.users) ? game.users : []);
  return users.find((user) => String(user?.id) === normalizedId)
    ?? (String(game?.user?.id) === normalizedId ? game.user : null);
}

function normalizeError(error, fallbackCode, fallbackMessage) {
  if (error instanceof SocketCommandError) {
    const details = normalizeErrorDetails(error.details);
    return { code: error.code, message: error.message, ...(details ? { details } : {}) };
  }
  const code = nonEmptyString(error?.code) ? error.code : fallbackCode;
  const message = nonEmptyString(error?.message) ? error.message : fallbackMessage;
  const details = normalizeErrorDetails(error?.details);
  return { code, message, ...(details ? { details } : {}) };
}

function errorOutcome(code, message) {
  return { ok: false, error: { code, message } };
}

export class SocketCommandBus {
  #clearTimeout;
  #completionTimeoutMs;
  #coordinator;
  #gameProvider;
  #handlers = new Map();
  #idFactory;
  #maxEnvelopeBytes;
  #now;
  #pending = new Map();
  #requireExplicitScheduling;
  #requestTimeoutMs;
  #setTimeout;
  #socketChannel;
  #trace;

  constructor({
    gameProvider = () => globalThis.game,
    coordinator = new WorldMutationCoordinator(),
    setTimeoutFn = (...args) => globalThis.setTimeout(...args),
    clearTimeoutFn = (timeoutId) => globalThis.clearTimeout(timeoutId),
    idFactory = defaultIdFactory,
    maxEnvelopeBytes = MAX_SOCKET_ENVELOPE_BYTES,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    completionTimeoutMs = COMPLETION_TIMEOUT_MS,
    requireExplicitScheduling = false,
    socketChannel = SOCKET_CHANNEL,
    trace = NOOP_SOCKET_COMMAND_TRACE,
    now = () => globalThis.performance?.now?.() ?? Date.now()
  } = {}) {
    this.#gameProvider = gameProvider;
    this.#coordinator = coordinator;
    this.#setTimeout = setTimeoutFn;
    this.#clearTimeout = clearTimeoutFn;
    this.#idFactory = idFactory;
    this.#maxEnvelopeBytes = maxEnvelopeBytes;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#completionTimeoutMs = completionTimeoutMs;
    this.#requireExplicitScheduling = requireExplicitScheduling === true;
    this.#socketChannel = socketChannel;
    this.#trace = typeof trace === "function" ? trace : NOOP_SOCKET_COMMAND_TRACE;
    this.#now = typeof now === "function" ? now : (() => Date.now());
  }

  register(command, { validate, authorize, execute, scheduling } = {}) {
    if (!nonEmptyString(command)) {
      throw new TypeError("command must be a non-empty string");
    }
    if (typeof execute !== "function") {
      throw new TypeError("execute must be a function");
    }
    if (validate != null && typeof validate !== "function") {
      throw new TypeError("validate must be a function");
    }
    if (authorize != null && typeof authorize !== "function") {
      throw new TypeError("authorize must be a function");
    }

    const normalizedScheduling = normalizeSocketScheduling(scheduling, {
      allowImplicitExclusive: !this.#requireExplicitScheduling,
      command
    });
    this.#handlers.set(command, Object.freeze({
      validate: validate ?? (() => true),
      authorize: authorize ?? (() => true),
      execute,
      scheduling: normalizedScheduling
    }));
    return this;
  }

  request(command, payload, { requestId = "" } = {}) {
    const game = this.#gameProvider();
    const senderId = String(game?.user?.id ?? "").trim();
    if (typeof requestId !== "string") {
      return Promise.reject(new SocketCommandError(
        "invalid-request",
        "Explicit socket request id must be a string"
      ));
    }
    const normalizedRequestId = requestId.trim()
      || String(this.#idFactory() ?? "").trim();
    if (!nonEmptyString(command) || !senderId || !normalizedRequestId) {
      return Promise.reject(new SocketCommandError(
        "invalid-request",
        "Socket command, request id, and sender id are required"
      ));
    }

    const envelope = {
      type: COMMAND_REQUEST_TYPE,
      command,
      requestId: normalizedRequestId,
      senderId,
      payload
    };
    const size = serializedSize(envelope);
    if (size == null) {
      return Promise.reject(new SocketCommandError(
        "invalid-envelope",
        "Socket envelope must be serializable"
      ));
    }
    if (size > this.#maxEnvelopeBytes) {
      return Promise.reject(new SocketCommandError(
        "envelope-too-large",
        `Socket envelope exceeds ${this.#maxEnvelopeBytes} bytes`
      ));
    }
    if (typeof game?.socket?.emit !== "function") {
      return Promise.reject(new SocketCommandError(
        "socket-unavailable",
        "Foundry socket is unavailable"
      ));
    }
    const expectedActiveGmId = String(getActiveGm(game)?.id ?? "").trim();
    if (!expectedActiveGmId) {
      return Promise.reject(new SocketCommandError(
        "active-gm-unavailable",
        "No active GM is available for the socket command"
      ));
    }

    const pendingKey = this.#pendingKey(normalizedRequestId, command, senderId);
    if (this.#pending.has(pendingKey)) {
      return Promise.reject(new SocketCommandError(
        "duplicate-request",
        "A matching socket command request is already pending"
      ));
    }
    return new Promise((resolve, reject) => {
      const entry = {
        command,
        expectedActiveGmId,
        forUserId: senderId,
        phase: "acceptance",
        reject,
        requestId: normalizedRequestId,
        resolve,
        timeoutId: undefined
      };
      this.#pending.set(pendingKey, entry);
      this.#armPendingTimeout(pendingKey, entry, {
        code: "request-timeout",
        message: `Socket command timed out after ${this.#requestTimeoutMs} ms before acceptance`,
        milliseconds: this.#requestTimeoutMs
      });

      try {
        game.socket.emit(this.#socketChannel, envelope);
      }
      catch (error) {
        this.#pending.delete(pendingKey);
        this.#clearTimeout(entry.timeoutId);
        reject(error);
      }
    });
  }

  handleMessage(message, { transportSenderId = "" } = {}) {
    const normalizedTransportSenderId = String(transportSenderId ?? "").trim();
    if (message?.type === COMMAND_ACCEPTED_TYPE) {
      this.#handleAccepted(message, normalizedTransportSenderId);
      return true;
    }
    if (message?.type === COMMAND_RESULT_TYPE) {
      this.#handleResult(message, normalizedTransportSenderId);
      return true;
    }
    if (message?.type !== COMMAND_REQUEST_TYPE) {
      return false;
    }

    this.#handleRequest(message, normalizedTransportSenderId).catch(() => undefined);
    return true;
  }

  async #handleRequest(message, transportSenderId = "") {
    const game = this.#gameProvider();
    if (!isActiveGmClient(game)) {
      return;
    }

    const correlation = requestCorrelation(message);
    const size = serializedSize(message);
    if (size == null) {
      if (correlation) {
        this.#emitOutcome(correlation, errorOutcome(
          "invalid-envelope",
          "Socket envelope must be serializable"
        ), game);
      }
      return;
    }
    if (size > this.#maxEnvelopeBytes) {
      if (correlation) {
        this.#emitOutcome(correlation, errorOutcome(
          "envelope-too-large",
          `Socket envelope exceeds ${this.#maxEnvelopeBytes} bytes`
        ), game);
      }
      return;
    }
    if (!isValidRequestEnvelope(message)) {
      if (correlation) {
        this.#emitOutcome(correlation, errorOutcome(
          "invalid-envelope",
          "Invalid socket command envelope"
        ), game);
      }
      return;
    }
    if (transportSenderId && transportSenderId !== message.senderId) {
      this.#emitOutcome(correlation, errorOutcome(
        "sender-mismatch",
        "Socket command sender does not match the authenticated transport sender"
      ), game);
      return;
    }

    const definition = this.#handlers.get(message.command);
    if (!definition) {
      this.#emitOutcome(correlation, errorOutcome(
        "unknown-command",
        `Unknown socket command: ${message.command}`
      ), game);
      return;
    }

    const sender = findUser(game, message.senderId);
    if (!sender) {
      this.#emitOutcome(correlation, errorOutcome(
        "unknown-sender",
        "Socket command sender is not a current Foundry user"
      ), game);
      return;
    }

    const context = {
      game,
      sender,
      request: message,
      command: message.command,
      requestId: message.requestId
    };
    const trace = (phase, details = {}) => this.#recordTrace({
      phase,
      command: message.command,
      requestId: message.requestId,
      senderId: message.senderId,
      at: this.#now(),
      ...details
    });
    trace("received");
    let validated = false;
    try {
      validated = await definition.validate(message.payload, context) === true;
    }
    catch (error) {
      const outcome = {
        ok: false,
        error: normalizeError(error, "invalid-payload", "Socket command payload is invalid")
      };
      this.#emitOutcome(correlation, outcome, game);
      trace("response");
      trace("completed", { outcome: "failed", mode: "unresolved", keys: [] });
      return;
    }
    if (!validated) {
      const outcome = errorOutcome("invalid-payload", "Socket command payload is invalid");
      this.#emitOutcome(correlation, outcome, game);
      trace("response");
      trace("completed", { outcome: "failed", mode: "unresolved", keys: [] });
      return;
    }
    trace("validated");

    let scheduling;
    try {
      scheduling = resolveSocketScheduling(definition.scheduling, message.payload, context);
    }
    catch (error) {
      const outcome = {
        ok: false,
        error: normalizeError(error, "invalid-scheduling", "Socket command scheduling is invalid")
      };
      this.#emitOutcome(correlation, outcome, game);
      trace("response");
      trace("completed", { outcome: "failed", mode: "unresolved", keys: [] });
      return;
    }

    const executeAuthorized = async () => {
      trace("queue-start", { mode: scheduling.mode, keys: scheduling.keys });
      const currentGame = this.#gameProvider();
      if (!isActiveGmClient(currentGame)) {
        return errorOutcome("active-gm-changed", "Active GM changed before socket command execution");
      }
      const currentSender = findUser(currentGame, message.senderId);
      if (!currentSender) {
        return errorOutcome("unknown-sender", "Socket command sender is not a current Foundry user");
      }
      const executionContext = Object.freeze({
        ...context,
        game: currentGame,
        sender: currentSender,
        alreadyScheduled: scheduling.mode !== "query"
      });

      try {
        if (!await definition.authorize(message.payload, executionContext)) {
          return errorOutcome("unauthorized", "Socket command is not authorized");
        }
        trace("authorized", { mode: scheduling.mode, keys: scheduling.keys });
      }
      catch (error) {
        return {
          ok: false,
          error: normalizeError(error, "unauthorized", "Socket command is not authorized")
        };
      }

      try {
        const data = await definition.execute(message.payload, executionContext);
        trace("execute-end", { mode: scheduling.mode, keys: scheduling.keys });
        return { ok: true, data };
      }
      catch (error) {
        trace("execute-end", { mode: scheduling.mode, keys: scheduling.keys });
        return {
          ok: false,
          error: normalizeError(error, "command-failed", "Socket command failed")
        };
      }
    };

    let outcomePromise;
    if (scheduling.mode === "query") {
      if (this.#emitAccepted(correlation, game)) trace("accepted", {
        mode: scheduling.mode,
        keys: scheduling.keys
      });
      outcomePromise = Promise.resolve().then(executeAuthorized);
    }
    else {
      const idempotencyId = `${message.senderId}\u0000${message.command}\u0000${message.requestId}`;
      outcomePromise = this.#coordinator.runIdempotentScoped({
        keys: scheduling.keys,
        exclusive: scheduling.exclusive,
        requestId: idempotencyId
      }, executeAuthorized);
      if (this.#emitAccepted(correlation, game)) trace("accepted", {
        mode: scheduling.mode,
        keys: scheduling.keys
      });
    }

    const outcome = await outcomePromise;
    this.#emitOutcome(correlation, outcome, game);
    trace("response", { mode: scheduling.mode, keys: scheduling.keys });
    trace("completed", {
      outcome: outcome.ok ? "ok" : "failed",
      mode: scheduling.mode,
      keys: scheduling.keys
    });
  }

  #recordTrace(event) {
    try {
      this.#trace(event);
    }
    catch {
      // Diagnostics must never change command behavior.
    }
  }

  #emitAccepted(correlation, game) {
    if (typeof game?.socket?.emit !== "function") return false;
    const accepted = {
      type: COMMAND_ACCEPTED_TYPE,
      command: correlation.command,
      requestId: correlation.requestId,
      forUserId: correlation.senderId,
      senderId: String(game?.user?.id ?? "")
    };
    const size = serializedSize(accepted);
    if (size == null || size > this.#maxEnvelopeBytes) return false;
    game.socket.emit(this.#socketChannel, accepted);
    return true;
  }

  #armPendingTimeout(pendingKey, entry, { code, message, milliseconds }) {
    entry.timeoutId = this.#setTimeout(() => {
      if (this.#pending.get(pendingKey) !== entry) return;
      this.#pending.delete(pendingKey);
      entry.reject(new SocketCommandError(code, message));
    }, milliseconds);
  }

  #handleAccepted(message, transportSenderId) {
    const correlated = this.#correlatedPending(message, transportSenderId, {
      requireOutcome: false
    });
    if (!correlated || correlated.pending.phase !== "acceptance") return;

    this.#clearTimeout(correlated.pending.timeoutId);
    correlated.pending.phase = "completion";
    this.#armPendingTimeout(correlated.pendingKey, correlated.pending, {
      code: "operation-timeout",
      message: `Socket command did not complete after ${this.#completionTimeoutMs} ms`,
      milliseconds: this.#completionTimeoutMs
    });
  }

  #handleResult(message, transportSenderId) {
    const correlated = this.#correlatedPending(message, transportSenderId, {
      requireOutcome: true
    });
    if (!correlated) return;

    const { pendingKey, pending } = correlated;
    this.#pending.delete(pendingKey);
    this.#clearTimeout(pending.timeoutId);
    if (message.ok) {
      pending.resolve(message.data);
      return;
    }

    const error = normalizeError(
      message.error,
      "command-failed",
      "Socket command failed"
    );
    pending.reject(new SocketCommandError(error.code, error.message, error.details ?? null));
  }

  #correlatedPending(message, transportSenderId, { requireOutcome }) {
    const size = serializedSize(message);
    if (size == null || size > this.#maxEnvelopeBytes) {
      return null;
    }
    if (
      !nonEmptyString(message?.command)
      || !nonEmptyString(message?.requestId)
      || !nonEmptyString(message?.forUserId)
      || !nonEmptyString(message?.senderId)
      || !nonEmptyString(transportSenderId)
      || message.senderId !== transportSenderId
      || (requireOutcome && typeof message?.ok !== "boolean")
      || (requireOutcome && message.ok === false && !isValidResultError(message.error))
    ) {
      return null;
    }

    const currentUserId = String(this.#gameProvider()?.user?.id ?? "");
    if (message.forUserId !== currentUserId) {
      return null;
    }
    const pendingKey = this.#pendingKey(message.requestId, message.command, message.forUserId);
    const pending = this.#pending.get(pendingKey);
    if (!pending || pending.expectedActiveGmId !== message.senderId) return null;
    return { pendingKey, pending };
  }

  #emitOutcome(correlation, outcome, game) {
    if (typeof game?.socket?.emit !== "function") {
      return;
    }

    let result = {
      type: COMMAND_RESULT_TYPE,
      command: correlation.command,
      requestId: correlation.requestId,
      forUserId: correlation.senderId,
      senderId: String(game?.user?.id ?? ""),
      ok: outcome.ok
    };
    if (outcome.ok) {
      result.data = outcome.data;
    }
    else {
      result.error = outcome.error;
    }

    const size = serializedSize(result);
    if (size == null || size > this.#maxEnvelopeBytes) {
      result = {
        type: COMMAND_RESULT_TYPE,
        command: correlation.command,
        requestId: correlation.requestId,
        forUserId: correlation.senderId,
        senderId: String(game?.user?.id ?? ""),
        ok: false,
        error: {
          code: "result-too-large",
          message: `Socket result exceeds ${this.#maxEnvelopeBytes} bytes`
        }
      };
      const fallbackSize = serializedSize(result);
      if (fallbackSize == null || fallbackSize > this.#maxEnvelopeBytes) {
        return;
      }
    }
    game.socket.emit(this.#socketChannel, result);
  }

  #pendingKey(requestId, command, userId) {
    return `${userId}\u0000${command}\u0000${requestId}`;
  }
}
