import {
  TRADE_TRANSACTION_STATUS,
  TradeTransactionError,
  isValidTradeTransactionId
} from "./trade-transaction-model.js";

const ROLLBACK_OPTION_KEYS = Object.freeze([
  "requestedByUserId",
  "rollbackTransactionId"
]);
const MAX_WRITE_RECOVERY_ATTEMPTS = 3;
const NONTERMINAL_ROLLBACK_STATUSES = new Set([
  TRADE_TRANSACTION_STATUS.PREPARED,
  TRADE_TRANSACTION_STATUS.APPLYING,
  TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED
]);

function clone(value) {
  if (typeof globalThis.foundry?.utils?.deepClone === "function") {
    return globalThis.foundry.utils.deepClone(value);
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function createRollbackError(
  code,
  message,
  { transactionId = "", rollbackTransactionId = "", cause = null } = {}
) {
  const suffix = transactionId || rollbackTransactionId
    ? ` (transaction ${transactionId || "unknown"}, rollback ${rollbackTransactionId || "unknown"})`
    : "";
  return new TradeTransactionError(code, `${message}${suffix}`, {
    transactionId,
    rollbackTransactionId,
    cause
  });
}

function invalidRollbackRequest(message, transactionId = "", rollbackTransactionId = "") {
  return createRollbackError("invalid-request", message, {
    transactionId,
    rollbackTransactionId
  });
}

export function canonicalizeRollbackRequest(transactionId, options) {
  const safeTransactionId = typeof transactionId === "string" ? transactionId.trim() : "";
  if (!isValidTradeTransactionId(safeTransactionId)) {
    throw invalidRollbackRequest("Original transaction ID is invalid", safeTransactionId);
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw invalidRollbackRequest("Rollback options must be an object", safeTransactionId);
  }
  const keys = Object.keys(options).sort();
  if (keys.length !== ROLLBACK_OPTION_KEYS.length
    || keys.some((key, index) => key !== ROLLBACK_OPTION_KEYS[index])) {
    throw invalidRollbackRequest("Rollback option fields are invalid", safeTransactionId);
  }

  const rollbackTransactionId = typeof options.rollbackTransactionId === "string"
    ? options.rollbackTransactionId.trim()
    : "";
  if (!isValidTradeTransactionId(rollbackTransactionId)) {
    throw invalidRollbackRequest(
      "Rollback transaction ID is invalid",
      safeTransactionId,
      rollbackTransactionId
    );
  }
  if (rollbackTransactionId === safeTransactionId) {
    throw invalidRollbackRequest(
      "Rollback transaction ID must differ from the original transaction ID",
      safeTransactionId,
      rollbackTransactionId
    );
  }
  const requestedByUserId = typeof options.requestedByUserId === "string"
    ? options.requestedByUserId.trim()
    : "";
  if (!requestedByUserId) {
    throw invalidRollbackRequest(
      "Rollback requestedByUserId is invalid",
      safeTransactionId,
      rollbackTransactionId
    );
  }
  return Object.freeze({
    transactionId: safeTransactionId,
    rollbackTransactionId,
    requestedByUserId
  });
}

function rollbackMatches(row, request) {
  return row?.rollback?.transactionId === request.rollbackTransactionId
    && row.rollback.requestedByUserId === request.requestedByUserId;
}

function sanitizeRollbackError(error, phase, request) {
  return {
    code: typeof error?.code === "string" && error.code.trim()
      ? error.code.trim()
      : "rollback-failed",
    message: typeof error?.message === "string" && error.message.trim()
      ? error.message.trim()
      : "Trade rollback failed",
    phase,
    transactionId: request.transactionId,
    rollbackTransactionId: request.rollbackTransactionId
  };
}

function isDomainError(error) {
  return error instanceof TradeTransactionError
    && [
      "transaction-conflict",
      "transaction-not-found",
      "transaction-not-rollbackable",
      "transaction-state-unavailable"
    ].includes(error.code);
}

export class TradeRollbackWorkflow {
  #now;
  #operations;
  #repository;

  constructor({ repository, operations, now }) {
    this.#repository = repository;
    this.#operations = operations;
    this.#now = now;
  }

  async execute(request) {
    let row = this.#readTransaction(request);
    if (!row) {
      throw createRollbackError("transaction-not-found", "Trade transaction was not found", request);
    }
    this.#assertEligible(row, request);

    if (row.rollback?.status === TRADE_TRANSACTION_STATUS.COMMITTED) {
      return clone(row.rollback.result);
    }
    if (!row.rollback) {
      row = await this.#start(row, request);
    }
    return this.#resume(row, request);
  }

  #assertEligible(row, request) {
    if (row.legacy === true || !["purchase", "sale"].includes(row.kind)) {
      throw createRollbackError(
        "transaction-not-rollbackable",
        "Legacy or unsupported trade transactions cannot use the durable rollback workflow",
        request
      );
    }
    if (row.rollback) {
      if (!rollbackMatches(row, request)) {
        throw createRollbackError(
          "transaction-conflict",
          "Trade transaction already belongs to a different rollback request",
          request
        );
      }
      if (!NONTERMINAL_ROLLBACK_STATUSES.has(row.rollback.status)
        && row.rollback.status !== TRADE_TRANSACTION_STATUS.COMMITTED) {
        throw createRollbackError(
          "transaction-not-rollbackable",
          "Trade rollback journal has an invalid status",
          request
        );
      }
      if (row.rollback.status !== TRADE_TRANSACTION_STATUS.COMMITTED
        && row.status !== TRADE_TRANSACTION_STATUS.COMMITTED
        && row.status !== TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED) {
        throw createRollbackError(
          "transaction-not-rollbackable",
          "Trade transaction is not in a resumable rollback state",
          request
        );
      }
      return;
    }
    if (row.status === TRADE_TRANSACTION_STATUS.COMPENSATED
      || row.status !== TRADE_TRANSACTION_STATUS.COMMITTED
      || row.rolledBack === true) {
      throw createRollbackError(
        "transaction-not-rollbackable",
        "Trade transaction is not eligible for rollback",
        request
      );
    }
  }

  async #start(candidate, request) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_WRITE_RECOVERY_ATTEMPTS; attempt += 1) {
      try {
        return await this.#repository.mutateTransaction(request.transactionId, (row) => {
          this.#assertEligible(row, request);
          if (row.rollback) return clone(row);
          const timestamp = this.#timestamp();
          row.rollback = {
            transactionId: request.rollbackTransactionId,
            status: TRADE_TRANSACTION_STATUS.PREPARED,
            phase: "prepared",
            requestedByUserId: request.requestedByUserId,
            result: null,
            error: null,
            startedAt: timestamp,
            updatedAt: timestamp,
            completedAt: 0
          };
          row.updatedAt = timestamp;
          return clone(row);
        });
      }
      catch (error) {
        if (isDomainError(error)) throw error;
        lastError = error;
        const durable = this.#readTransaction(request);
        if (durable?.rollback) {
          this.#assertEligible(durable, request);
          return durable;
        }
        if (attempt < MAX_WRITE_RECOVERY_ATTEMPTS) continue;
      }
    }
    throw createRollbackError(
      "transaction-write-failed",
      "Rollback journal was not stored",
      { ...request, cause: lastError }
    );
  }

  async #resume(initialRow, request) {
    let row = initialRow;
    while (true) {
      this.#assertEligible(row, request);
      if (row.rollback.status === TRADE_TRANSACTION_STATUS.COMMITTED) {
        return clone(row.rollback.result);
      }
      const phase = row.rollback.phase;
      try {
        if (row.kind === "purchase") {
          if (phase === "prepared") {
            await this.#operations.compensatePurchaseItem(this.#transactionView(row, request));
            row = await this.#checkpoint(row, request, "item-reversed");
            continue;
          }
          if (phase === "item-reversed") {
            await this.#operations.compensatePurchaseCurrency(this.#transactionView(row, request));
            row = await this.#checkpoint(row, request, "currency-reversed");
            continue;
          }
          if (phase === "currency-reversed") {
            row = await this.#releaseStock(row, request);
            continue;
          }
          if (phase === "stock-released") {
            return this.#finalize(row, request);
          }
        }
        else {
          if (phase === "prepared") {
            await this.#operations.compensateSaleCurrency(this.#transactionView(row, request));
            row = await this.#checkpoint(row, request, "currency-reversed");
            continue;
          }
          if (phase === "currency-reversed") {
            await this.#operations.compensateSaleItem(this.#transactionView(row, request));
            row = await this.#checkpoint(row, request, "item-restored");
            continue;
          }
          if (phase === "item-restored") {
            return this.#finalize(row, request);
          }
        }
        throw createRollbackError(
          "transaction-not-rollbackable",
          `Trade rollback phase ${String(phase ?? "unknown")} is invalid`,
          request
        );
      }
      catch (error) {
        if (error instanceof TradeTransactionError
          && ["transaction-conflict", "transaction-state-unavailable"].includes(error.code)) {
          throw error;
        }
        return this.#markReconciliationRequired(request, phase, error);
      }
    }
  }

  #transactionView(row, request) {
    const view = clone(row);
    view.request = {
      ...view.request,
      requestedByUserId: request.requestedByUserId
    };
    return view;
  }

  async #checkpoint(candidate, request, nextPhase) {
    return this.#mutateWithAckRecovery(request, nextPhase, (row) => {
      if (row.rollback.phase === nextPhase) return;
      if (row.rollback.phase !== candidate.rollback.phase) {
        throw createRollbackError(
          "transaction-conflict",
          "Trade rollback phase changed unexpectedly",
          request
        );
      }
      row.rollback.status = TRADE_TRANSACTION_STATUS.APPLYING;
      row.rollback.phase = nextPhase;
      row.rollback.error = null;
      row.rollback.updatedAt = this.#timestamp();
      row.updatedAt = row.rollback.updatedAt;
    });
  }

  async #releaseStock(candidate, request) {
    return this.#mutateWithAckRecovery(request, "stock-released", (row, state) => {
      if (row.rollback.phase === "stock-released") return;
      if (row.rollback.phase !== candidate.rollback.phase
        || row.rollback.phase !== "currency-reversed") {
        throw createRollbackError(
          "transaction-conflict",
          "Purchase rollback is not ready to release stock",
          request
        );
      }
      const traderId = String(
        row.traderId ?? `${row.request?.cityId ?? ""}::${row.request?.traderKey ?? ""}`
      ).trim();
      const inventory = state.traders?.[traderId]?.inventory;
      const stock = Array.isArray(inventory)
        ? inventory.find((entry) => entry?.itemKey === row.stock?.itemKey)
        : null;
      const release = -Number(row.stock?.delta);
      if (!stock || !Number.isInteger(stock.quantity)
        || !Number.isInteger(release) || release < 1) {
        throw createRollbackError(
          "stock-release-unavailable",
          "Reserved trader stock could not be released",
          request
        );
      }
      stock.quantity += release;
      row.rollback.status = TRADE_TRANSACTION_STATUS.APPLYING;
      row.rollback.phase = "stock-released";
      row.rollback.error = null;
      row.rollback.updatedAt = this.#timestamp();
      row.updatedAt = row.rollback.updatedAt;
    });
  }

  async #finalize(candidate, request) {
    const completed = await this.#mutateWithAckRecovery(request, "committed", (row) => {
      if (row.rollback.status === TRADE_TRANSACTION_STATUS.COMMITTED) return;
      if (row.rollback.phase !== candidate.rollback.phase) {
        throw createRollbackError(
          "transaction-conflict",
          "Trade rollback finalization phase changed unexpectedly",
          request
        );
      }
      const timestamp = this.#timestamp();
      const result = {
        transactionId: row.transactionId,
        rollbackTransactionId: request.rollbackTransactionId,
        kind: row.kind,
        type: row.type ?? row.kind,
        rolledBack: true,
        actorId: row.request?.actorId ?? row.actorId ?? "",
        actorName: row.actorName ?? "",
        traderId: row.traderId ?? "",
        traderName: row.traderName ?? "",
        itemId: row.item?.itemId ?? row.itemId ?? "",
        itemUuid: row.item?.itemUuid ?? row.itemUuid ?? "",
        itemName: row.itemName ?? row.result?.itemName ?? "",
        startedAt: row.rollback.startedAt,
        completedAt: timestamp,
        rolledBackAt: timestamp
      };
      row.status = TRADE_TRANSACTION_STATUS.COMMITTED;
      row.phase = "committed";
      row.error = null;
      row.rolledBack = true;
      row.rolledBackAt = timestamp;
      row.rolledBackByUserId = request.requestedByUserId;
      row.rollback.status = TRADE_TRANSACTION_STATUS.COMMITTED;
      row.rollback.phase = "committed";
      row.rollback.result = clone(result);
      row.rollback.error = null;
      row.rollback.updatedAt = timestamp;
      row.rollback.completedAt = timestamp;
      row.updatedAt = timestamp;
    });
    return clone(completed.rollback.result);
  }

  async #mutateWithAckRecovery(request, expectedPhase, mutator) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_WRITE_RECOVERY_ATTEMPTS; attempt += 1) {
      try {
        return await this.#repository.mutateTransaction(request.transactionId, (row, state) => {
          this.#assertEligible(row, request);
          mutator(row, state);
          return clone(row);
        });
      }
      catch (error) {
        if (isDomainError(error)) throw error;
        lastError = error;
        const durable = this.#readTransaction(request);
        if (durable) {
          this.#assertEligible(durable, request);
          if (expectedPhase === "committed"
            ? durable.rollback.status === TRADE_TRANSACTION_STATUS.COMMITTED
            : durable.rollback.phase === expectedPhase) {
            return durable;
          }
        }
        if (attempt < MAX_WRITE_RECOVERY_ATTEMPTS) continue;
      }
    }
    throw createRollbackError(
      "transaction-write-failed",
      `Rollback checkpoint ${expectedPhase} was not stored`,
      { ...request, cause: lastError }
    );
  }

  async #markReconciliationRequired(request, phase, failure) {
    let lastError = failure;
    for (let attempt = 0; attempt <= MAX_WRITE_RECOVERY_ATTEMPTS; attempt += 1) {
      try {
        const outcome = await this.#repository.mutateTransaction(request.transactionId, (row) => {
          this.#assertEligible(row, request);
          if (row.rollback.status === TRADE_TRANSACTION_STATUS.COMMITTED) {
            return { committed: true, result: clone(row.rollback.result) };
          }
          row.status = TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED;
          row.rollback.status = TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED;
          row.rollback.error = sanitizeRollbackError(failure, phase, request);
          row.rollback.updatedAt = this.#timestamp();
          row.updatedAt = row.rollback.updatedAt;
          return { committed: false };
        });
        if (outcome?.committed) return clone(outcome.result);
        throw createRollbackError(
          "reconciliation-required",
          "Trade rollback requires reconciliation",
          { ...request, cause: failure }
        );
      }
      catch (error) {
        if (error instanceof TradeTransactionError
          && ["reconciliation-required", "transaction-conflict", "transaction-state-unavailable"]
            .includes(error.code)) {
          throw error;
        }
        lastError = error;
        const durable = this.#readTransaction(request);
        if (durable) {
          this.#assertEligible(durable, request);
          if (durable.rollback.status === TRADE_TRANSACTION_STATUS.COMMITTED) {
            return clone(durable.rollback.result);
          }
          if (durable.rollback.status === TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED) {
            throw createRollbackError(
              "reconciliation-required",
              "Trade rollback requires reconciliation",
              { ...request, cause: failure }
            );
          }
        }
        if (attempt < MAX_WRITE_RECOVERY_ATTEMPTS) continue;
      }
    }
    throw createRollbackError(
      "transaction-write-failed",
      "Rollback reconciliation state was not stored",
      { ...request, cause: lastError }
    );
  }

  #readTransaction(request) {
    try {
      return this.#repository.findTransaction(request.transactionId);
    }
    catch (cause) {
      throw createRollbackError(
        "transaction-state-unavailable",
        "Trade rollback state could not be read",
        { ...request, cause }
      );
    }
  }

  #timestamp() {
    return Number(this.#now());
  }
}
