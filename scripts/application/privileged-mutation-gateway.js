export const PRIVILEGED_WORLD_QUEUE_KEY = "world";

const INVALID_PAYLOAD_MESSAGE = "Privileged mutation payload is invalid";
const SAFE_PRE_WRITE_AUTHORITY_FAILURE = Symbol("safePreWriteAuthorityFailure");
const UNAUTHORIZED_MESSAGE = "Privileged mutation is not authorized";

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cloneSerializable(value) {
  try {
    if (typeof globalThis.structuredClone === "function") {
      return globalThis.structuredClone(value);
    }
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      throw new TypeError("Payload is not serializable");
    }
    return JSON.parse(serialized);
  }
  catch {
    throw new PrivilegedMutationError(
      "invalid-payload",
      "Privileged mutation payload must be serializable"
    );
  }
}

function errorDetails(error, fallbackCode, fallbackMessage) {
  return {
    code: cleanString(error?.code) || fallbackCode,
    message: cleanString(error?.message) || fallbackMessage
  };
}

function isSocketRequestTimeout(error) {
  return error?.name === "SocketCommandError" && error?.code === "request-timeout";
}

function markSafePreWriteAuthorityFailure(error) {
  if (error?.name === "PrivilegedMutationError" && error?.code === "active-gm-changed") {
    Object.defineProperty(error, SAFE_PRE_WRITE_AUTHORITY_FAILURE, { value: true });
  }
  return error;
}

export class PrivilegedMutationError extends Error {
  constructor(code, message, { command = "", operationId = "" } = {}) {
    super(message);
    this.name = "PrivilegedMutationError";
    this.code = code;
    this.command = command;
    this.operationId = operationId;
  }
}

export class PrivilegedMutationGateway {
  #commandBus;
  #coordinator;
  #definitions = new Map();
  #gameProvider;
  #getActiveGm;
  #isActiveGmClient;
  #maxTimeoutRetries;
  #operationIdFactory;

  constructor({
    commandBus,
    coordinator,
    gameProvider,
    getActiveGm,
    isActiveGmClient,
    operationIdFactory,
    maxTimeoutRetries = 1
  }) {
    if (typeof commandBus?.register !== "function" || typeof commandBus?.request !== "function") {
      throw new TypeError("commandBus must provide register and request methods");
    }
    if (typeof coordinator?.run !== "function" || typeof coordinator?.runIdempotent !== "function") {
      throw new TypeError("coordinator must provide run and runIdempotent methods");
    }
    for (const [name, dependency] of Object.entries({
      gameProvider,
      getActiveGm,
      isActiveGmClient,
      operationIdFactory
    })) {
      if (typeof dependency !== "function") {
        throw new TypeError(`${name} must be a function`);
      }
    }
    if (!Number.isInteger(maxTimeoutRetries) || maxTimeoutRetries < 0 || maxTimeoutRetries > 1) {
      throw new TypeError("maxTimeoutRetries must be zero or one");
    }

    this.#commandBus = commandBus;
    this.#coordinator = coordinator;
    this.#gameProvider = gameProvider;
    this.#getActiveGm = getActiveGm;
    this.#isActiveGmClient = isActiveGmClient;
    this.#maxTimeoutRetries = maxTimeoutRetries;
    this.#operationIdFactory = operationIdFactory;
  }

  registerCommand(command, { validate, authorize, execute } = {}) {
    const normalizedCommand = cleanString(command);
    if (!normalizedCommand) {
      throw new TypeError("command must be a non-empty string");
    }
    if (this.#definitions.has(normalizedCommand)) {
      throw new TypeError(`command is already registered: ${normalizedCommand}`);
    }
    for (const [name, handler] of Object.entries({ validate, authorize, execute })) {
      if (typeof handler !== "function") {
        throw new TypeError(`${name} must be a function`);
      }
    }

    const definition = Object.freeze({ validate, authorize, execute });
    this.#definitions.set(normalizedCommand, definition);
    this.#commandBus.register(normalizedCommand, {
      validate,
      authorize,
      execute: (payload, context) => this.#executeRegistered(
        normalizedCommand,
        payload,
        {
          operationId: context.requestId,
          sender: context.sender,
          source: "typed-command"
        }
      )
    });
    return this;
  }

  async mutate(command, payload, { operationId = "" } = {}) {
    const normalizedCommand = cleanString(command);
    const definition = this.#definitions.get(normalizedCommand);
    if (!definition) {
      throw new PrivilegedMutationError(
        "unknown-command",
        `Unknown privileged mutation command: ${normalizedCommand || command}`,
        { command: normalizedCommand }
      );
    }

    const clonedPayload = cloneSerializable(payload);
    const normalizedOperationId = cleanString(operationId)
      || cleanString(this.#operationIdFactory());
    const game = this.#gameProvider();
    const sender = game?.user;
    if (!normalizedOperationId || !cleanString(sender?.id)) {
      throw new PrivilegedMutationError(
        "invalid-request",
        "Privileged mutation operation id and sender id are required",
        { command: normalizedCommand, operationId: normalizedOperationId }
      );
    }

    await this.#validate(definition, clonedPayload, Object.freeze({
      command: normalizedCommand,
      game,
      operationId: normalizedOperationId,
      requestId: normalizedOperationId,
      sender
    }), normalizedCommand, normalizedOperationId);

    if (!this.#isActiveGmClient(game)) {
      const initialActiveGmId = cleanString(this.#getActiveGm(game)?.id);
      return this.#requestWithRetry(
        normalizedCommand,
        clonedPayload,
        normalizedOperationId,
        initialActiveGmId
      );
    }

    const idempotencyKey = `${sender.id}\u0000${normalizedCommand}\u0000${normalizedOperationId}`;
    return this.#coordinator.runIdempotent(
      PRIVILEGED_WORLD_QUEUE_KEY,
      idempotencyKey,
      () => this.#executeRegistered(normalizedCommand, clonedPayload, {
        operationId: normalizedOperationId,
        sender,
        source: "direct-active-gm",
        validateAndAuthorize: true
      })
    );
  }

  commit(queueKey, operation) {
    const normalizedQueueKey = cleanString(queueKey);
    if (!normalizedQueueKey || normalizedQueueKey === PRIVILEGED_WORLD_QUEUE_KEY) {
      throw new TypeError("commit requires a non-world inner queue key");
    }
    if (typeof operation !== "function") {
      throw new TypeError("operation must be a function");
    }

    const rawAssertActiveGm = this.#createActiveGmGuard();
    try {
      rawAssertActiveGm();
    }
    catch (error) {
      throw markSafePreWriteAuthorityFailure(error);
    }
    let successfulOperationGuards = 0;
    const assertActiveGm = () => {
      try {
        rawAssertActiveGm();
      }
      catch (error) {
        if (successfulOperationGuards > 0) {
          throw this.#ambiguousOutcome("", "");
        }
        throw markSafePreWriteAuthorityFailure(error);
      }
      successfulOperationGuards += 1;
    };
    const context = Object.freeze({ assertActiveGm });
    return this.#coordinator.run(normalizedQueueKey, async () => {
      try {
        rawAssertActiveGm();
      }
      catch (error) {
        throw markSafePreWriteAuthorityFailure(error);
      }
      const result = await operation(context);
      try {
        rawAssertActiveGm();
      }
      catch {
        throw this.#ambiguousOutcome("", "");
      }
      return result;
    });
  }

  async #requestWithRetry(command, payload, operationId, initialActiveGmId) {
    for (let retryCount = 0; ; retryCount += 1) {
      try {
        return await this.#commandBus.request(command, payload, { requestId: operationId });
      }
      catch (error) {
        if (error?.code === "ambiguous-outcome") {
          throw this.#ambiguousOutcome(command, operationId);
        }
        if (!isSocketRequestTimeout(error)) {
          throw error;
        }
        const currentActiveGmId = cleanString(this.#getActiveGm(this.#gameProvider())?.id);
        if (
          retryCount >= this.#maxTimeoutRetries
          || currentActiveGmId !== initialActiveGmId
        ) {
          throw this.#ambiguousOutcome(command, operationId);
        }
      }
    }
  }

  async #executeRegistered(command, payload, {
    operationId,
    sender,
    source,
    validateAndAuthorize = false
  }) {
    const definition = this.#definitions.get(command);
    const assertActiveGm = this.#createActiveGmGuard();
    const context = Object.freeze({
      command,
      operationId,
      requestId: operationId,
      sender,
      source,
      assertActiveGm
    });

    if (validateAndAuthorize) {
      await this.#validate(definition, payload, context, command, operationId);
      await this.#authorize(definition, payload, context, command, operationId);
    }

    assertActiveGm();
    let result;
    try {
      result = await definition.execute(payload, context);
    }
    catch (error) {
      if (error?.[SAFE_PRE_WRITE_AUTHORITY_FAILURE] === true) {
        throw new PrivilegedMutationError(error.code, error.message, { command, operationId });
      }
      if (error?.name === "PrivilegedMutationError" && error?.code === "active-gm-changed") {
        throw this.#ambiguousOutcome(command, operationId);
      }
      if (error?.name === "PrivilegedMutationError" && error?.code === "ambiguous-outcome") {
        throw this.#ambiguousOutcome(command, operationId);
      }
      throw error;
    }
    try {
      assertActiveGm();
    }
    catch {
      throw this.#ambiguousOutcome(command, operationId);
    }
    return result;
  }

  #createActiveGmGuard() {
    const initialGame = this.#gameProvider();
    const expectedActiveGmId = cleanString(this.#getActiveGm(initialGame)?.id);
    return () => {
      const game = this.#gameProvider();
      const activeGmId = cleanString(this.#getActiveGm(game)?.id);
      if (
        !expectedActiveGmId
        || activeGmId !== expectedActiveGmId
        || !this.#isActiveGmClient(game)
      ) {
        throw new PrivilegedMutationError(
          "active-gm-changed",
          "Elected active GM changed during privileged mutation"
        );
      }
    };
  }

  async #validate(definition, payload, context, command, operationId) {
    try {
      if (await definition.validate(payload, context)) {
        return;
      }
    }
    catch (error) {
      const details = errorDetails(error, "invalid-payload", INVALID_PAYLOAD_MESSAGE);
      throw new PrivilegedMutationError(details.code, details.message, { command, operationId });
    }
    throw new PrivilegedMutationError(
      "invalid-payload",
      INVALID_PAYLOAD_MESSAGE,
      { command, operationId }
    );
  }

  async #authorize(definition, payload, context, command, operationId) {
    try {
      if (await definition.authorize(payload, context)) {
        return;
      }
    }
    catch (error) {
      const details = errorDetails(error, "unauthorized", UNAUTHORIZED_MESSAGE);
      throw new PrivilegedMutationError(details.code, details.message, { command, operationId });
    }
    throw new PrivilegedMutationError(
      "unauthorized",
      UNAUTHORIZED_MESSAGE,
      { command, operationId }
    );
  }

  #ambiguousOutcome(command, operationId) {
    return new PrivilegedMutationError(
      "ambiguous-outcome",
      "Privileged mutation outcome is ambiguous; refresh authoritative state before trying again.",
      { command, operationId }
    );
  }
}
