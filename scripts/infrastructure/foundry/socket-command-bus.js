import { WorldMutationCoordinator } from "../../application/world-mutation-coordinator.js";
import { MODULE_ID } from "../../constants.js";
import { isActiveGmClient } from "./active-gm.js";

export const SOCKET_CHANNEL = `module.${MODULE_ID}`;
export const COMMAND_REQUEST_TYPE = "rebreya.command";
export const COMMAND_RESULT_TYPE = "rebreya.command.result";
export const MAX_SOCKET_ENVELOPE_BYTES = 65536;
export const REQUEST_TIMEOUT_MS = 10000;

const DEFAULT_MUTATION_KEY = "world";
const textEncoder = new TextEncoder();

export class SocketCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SocketCommandError";
    this.code = code;
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
  );
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
    return { code: error.code, message: error.message };
  }
  const code = nonEmptyString(error?.code) ? error.code : fallbackCode;
  const message = nonEmptyString(error?.message) ? error.message : fallbackMessage;
  return { code, message };
}

function errorOutcome(code, message) {
  return { ok: false, error: { code, message } };
}

export class SocketCommandBus {
  #clearTimeout;
  #coordinator;
  #gameProvider;
  #handlers = new Map();
  #idFactory;
  #maxEnvelopeBytes;
  #mutationKey;
  #pending = new Map();
  #requestTimeoutMs;
  #setTimeout;
  #socketChannel;

  constructor({
    gameProvider = () => globalThis.game,
    coordinator = new WorldMutationCoordinator(),
    setTimeoutFn = (...args) => globalThis.setTimeout(...args),
    clearTimeoutFn = (timeoutId) => globalThis.clearTimeout(timeoutId),
    idFactory = defaultIdFactory,
    maxEnvelopeBytes = MAX_SOCKET_ENVELOPE_BYTES,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    mutationKey = DEFAULT_MUTATION_KEY,
    socketChannel = SOCKET_CHANNEL
  } = {}) {
    this.#gameProvider = gameProvider;
    this.#coordinator = coordinator;
    this.#setTimeout = setTimeoutFn;
    this.#clearTimeout = clearTimeoutFn;
    this.#idFactory = idFactory;
    this.#maxEnvelopeBytes = maxEnvelopeBytes;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#mutationKey = mutationKey;
    this.#socketChannel = socketChannel;
  }

  register(command, { validate, authorize, execute } = {}) {
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

    this.#handlers.set(command, {
      validate: validate ?? (() => true),
      authorize: authorize ?? (() => true),
      execute
    });
    return this;
  }

  request(command, payload) {
    const game = this.#gameProvider();
    const senderId = String(game?.user?.id ?? "").trim();
    const requestId = String(this.#idFactory() ?? "").trim();
    if (!nonEmptyString(command) || !senderId || !requestId) {
      return Promise.reject(new SocketCommandError(
        "invalid-request",
        "Socket command, request id, and sender id are required"
      ));
    }

    const envelope = {
      type: COMMAND_REQUEST_TYPE,
      command,
      requestId,
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

    const pendingKey = this.#pendingKey(requestId, command, senderId);
    if (this.#pending.has(pendingKey)) {
      return Promise.reject(new SocketCommandError(
        "duplicate-request",
        "A matching socket command request is already pending"
      ));
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timeoutId: undefined };
      entry.timeoutId = this.#setTimeout(() => {
        if (this.#pending.get(pendingKey) === entry) {
          this.#pending.delete(pendingKey);
          reject(new SocketCommandError(
            "request-timeout",
            `Socket command timed out after ${this.#requestTimeoutMs} ms`
          ));
        }
      }, this.#requestTimeoutMs);
      this.#pending.set(pendingKey, entry);

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

  handleMessage(message) {
    if (message?.type === COMMAND_RESULT_TYPE) {
      this.#handleResult(message);
      return true;
    }
    if (message?.type !== COMMAND_REQUEST_TYPE) {
      return false;
    }

    this.#handleRequest(message).catch(() => undefined);
    return true;
  }

  async #handleRequest(message) {
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
    const idempotencyId = `${message.senderId}\u0000${message.command}\u0000${message.requestId}`;
    const outcome = await this.#coordinator.runIdempotent(
      this.#mutationKey,
      idempotencyId,
      async () => {
        try {
          if (!await definition.validate(message.payload, context)) {
            return errorOutcome("invalid-payload", "Socket command payload is invalid");
          }
        }
        catch (error) {
          return {
            ok: false,
            error: normalizeError(error, "invalid-payload", "Socket command payload is invalid")
          };
        }

        try {
          if (!await definition.authorize(message.payload, context)) {
            return errorOutcome("unauthorized", "Socket command is not authorized");
          }
        }
        catch (error) {
          return {
            ok: false,
            error: normalizeError(error, "unauthorized", "Socket command is not authorized")
          };
        }

        try {
          return { ok: true, data: await definition.execute(message.payload, context) };
        }
        catch (error) {
          return {
            ok: false,
            error: normalizeError(error, "command-failed", "Socket command failed")
          };
        }
      }
    );
    this.#emitOutcome(correlation, outcome, game);
  }

  #handleResult(message) {
    const size = serializedSize(message);
    if (size == null || size > this.#maxEnvelopeBytes) {
      return;
    }
    if (
      !nonEmptyString(message?.command)
      || !nonEmptyString(message?.requestId)
      || !nonEmptyString(message?.forUserId)
      || typeof message?.ok !== "boolean"
      || (message.ok === false && !isValidResultError(message.error))
    ) {
      return;
    }

    const currentUserId = String(this.#gameProvider()?.user?.id ?? "");
    if (message.forUserId !== currentUserId) {
      return;
    }
    const pendingKey = this.#pendingKey(message.requestId, message.command, message.forUserId);
    const pending = this.#pending.get(pendingKey);
    if (!pending) {
      return;
    }

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
    pending.reject(new SocketCommandError(error.code, error.message));
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
