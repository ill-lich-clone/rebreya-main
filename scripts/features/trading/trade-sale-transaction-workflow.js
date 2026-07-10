import {
  TRADE_TRANSACTION_STATUS,
  TradeTransactionError,
  isValidTradeTransactionId,
  requestsMatch
} from "./trade-transaction-model.js";

const SALE_REQUEST_KEYS = Object.freeze([
  "transactionId",
  "actorId",
  "cityId",
  "traderKey",
  "itemUuid",
  "quantity",
  "requestedByUserId"
]);

const PROTECTED_AUDIT_KEYS = new Set([
  "transactionId",
  "traderId",
  "legacy",
  "kind",
  "status",
  "phase",
  "request",
  "stock",
  "item",
  "currency",
  "result",
  "error",
  "compensation",
  "rollback",
  "createdAt",
  "updatedAt",
  "committedAt",
  "compensatedAt"
]);

const MAX_JOURNAL_RECOVERY_ATTEMPTS = 3;

class JournalCheckpointError extends Error {
  constructor(transactionId, phase, cause) {
    super(`Sale transaction checkpoint ${phase} was not acknowledged`, { cause });
    this.name = "JournalCheckpointError";
    this.transactionId = transactionId;
    this.phase = phase;
  }
}

class CompensationStepError extends Error {
  constructor(phase, cause) {
    super(`Sale transaction compensation failed during ${phase}`, { cause });
    this.name = "CompensationStepError";
    this.phase = phase;
  }
}

function clone(value) {
  if (typeof globalThis.foundry?.utils?.deepClone === "function") {
    return globalThis.foundry.utils.deepClone(value);
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function transactionError(code, message, transactionId, cause = null) {
  return new TradeTransactionError(code, message, { transactionId, cause });
}

function invalidRequest(message, transactionId = "") {
  return transactionError("invalid-request", message, transactionId);
}

export function canonicalizeSaleRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest("Sale request must be an object");
  }

  const keys = Object.keys(value).sort();
  const expectedKeys = [...SALE_REQUEST_KEYS].sort();
  if (keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])) {
    throw invalidRequest("Sale request fields are invalid");
  }
  if (!isValidTradeTransactionId(value.transactionId)) {
    throw invalidRequest("Sale transaction ID is invalid");
  }

  const request = { transactionId: value.transactionId };
  for (const key of [
    "actorId",
    "cityId",
    "traderKey",
    "itemUuid",
    "requestedByUserId"
  ]) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      throw invalidRequest(`Sale ${key} is invalid`, value.transactionId);
    }
    request[key] = value[key].trim();
  }
  if (!Number.isInteger(value.quantity) || value.quantity < 1) {
    throw invalidRequest("Sale quantity must be a positive integer", value.transactionId);
  }
  request.quantity = value.quantity;
  return Object.freeze(request);
}

function persistedRequest(request) {
  return {
    actorId: request.actorId,
    cityId: request.cityId,
    traderKey: request.traderKey,
    itemKey: "",
    itemUuid: request.itemUuid,
    quantity: request.quantity,
    requestedByUserId: request.requestedByUserId
  };
}

function sanitizeAudit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(clone(value)).filter(([key]) => (
    !PROTECTED_AUDIT_KEYS.has(key)
  )));
}

function sanitizeError(error, phase, fallbackCode = "sale-failed") {
  const code = typeof error?.code === "string" && error.code.trim()
    ? error.code.trim()
    : fallbackCode;
  const message = typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : "Sale transaction failed";
  return { code, message, phase: String(phase ?? "unknown") };
}

function normalizeDescriptor(value, request) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw transactionError(
      "invalid-sale-descriptor",
      "Sale preparation did not return a descriptor",
      request.transactionId
    );
  }

  const traderId = typeof value.traderId === "string" ? value.traderId.trim() : "";
  const item = value.item;
  const currency = value.currency;
  const result = value.result;
  const hasItem = item && typeof item === "object" && !Array.isArray(item);
  const hasCurrency = currency && typeof currency === "object" && !Array.isArray(currency);
  const hasResult = result && typeof result === "object" && !Array.isArray(result);
  if (!traderId || !hasItem || !hasCurrency || !hasResult) {
    throw transactionError(
      "invalid-sale-descriptor",
      "Sale preparation returned an invalid descriptor",
      request.transactionId
    );
  }

  const itemId = typeof item.itemId === "string" ? item.itemId.trim() : "";
  const itemUuid = typeof item.itemUuid === "string" ? item.itemUuid.trim() : "";
  const validItem = Boolean(itemId)
    && itemUuid === request.itemUuid
    && Number.isInteger(item.beforeQuantity)
    && item.beforeQuantity >= 0
    && Number.isInteger(item.afterQuantity)
    && item.afterQuantity >= 0
    && Number.isInteger(item.delta)
    && item.delta < 0
    && item.afterQuantity - item.beforeQuantity === item.delta
    && -item.delta === request.quantity
    && item.created === false
    && item.rawItemData
    && typeof item.rawItemData === "object"
    && !Array.isArray(item.rawItemData);
  const validCurrency = Number.isInteger(currency.beforeCopper)
    && currency.beforeCopper >= 0
    && Number.isInteger(currency.afterCopper)
    && currency.afterCopper >= 0
    && Number.isInteger(currency.deltaCopper)
    && currency.deltaCopper >= 0
    && currency.afterCopper - currency.beforeCopper === currency.deltaCopper;
  const validResultTransaction = !Object.hasOwn(result, "transactionId")
    || result.transactionId === request.transactionId;
  const validResultPayout = !Object.hasOwn(result, "netPayoutCopper")
    || result.netPayoutCopper === currency.deltaCopper;
  const validResultTotal = !Object.hasOwn(result, "totalCopper")
    || result.totalCopper === currency.deltaCopper;
  if (!validItem || !validCurrency || !validResultTransaction
    || !validResultPayout || !validResultTotal) {
    throw transactionError(
      "invalid-sale-descriptor",
      "Sale preparation returned invalid item, currency, or result deltas",
      request.transactionId
    );
  }

  return {
    traderId,
    item: { ...clone(item), itemId, itemUuid },
    currency: clone(currency),
    result: clone(result),
    audit: sanitizeAudit(value.audit)
  };
}

function assertSaleTransaction(transaction, request) {
  if (transaction?.kind !== "sale" || !requestsMatch(transaction?.request, request)) {
    throw transactionError(
      "transaction-conflict",
      "Trade transaction ID belongs to a different request",
      request.transactionId
    );
  }
}

function terminalResult(transaction) {
  if (transaction.status === TRADE_TRANSACTION_STATUS.COMMITTED) {
    return clone(transaction.result);
  }
  if (transaction.status === TRADE_TRANSACTION_STATUS.COMPENSATED) {
    throw transactionError(
      "transaction-compensated",
      "Sale transaction was compensated",
      transaction.transactionId
    );
  }
  if (transaction.status === TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED) {
    throw transactionError(
      "reconciliation-required",
      "Sale transaction requires reconciliation",
      transaction.transactionId
    );
  }
  return null;
}

export class TradeSaleTransactionWorkflow {
  #now;
  #operations;
  #repository;

  constructor({ repository, operations, now }) {
    this.#repository = repository;
    this.#operations = operations;
    this.#now = now;
  }

  async execute(request, context = {}) {
    const persisted = this.#repository.findTransaction(request.transactionId);
    if (persisted) {
      assertSaleTransaction(persisted, request);
      const result = terminalResult(persisted);
      if (persisted.status === TRADE_TRANSACTION_STATUS.COMMITTED) return result;
      if (persisted.status === TRADE_TRANSACTION_STATUS.COMPENSATING) {
        return this.#resumeCompensation(request.transactionId, { incrementAttempt: true });
      }
      return this.#resumeApplication(request.transactionId);
    }

    let descriptor;
    try {
      descriptor = normalizeDescriptor(
        await this.#operations.prepareSale(clone(request), context),
        request
      );
    }
    catch (error) {
      if (error instanceof TradeTransactionError && error.transactionId) throw error;
      throw transactionError(
        error?.code ?? "sale-preparation-failed",
        error?.message ?? "Sale preparation failed",
        request.transactionId,
        error
      );
    }

    try {
      await this.#repository.mutate((state) => {
        const duplicate = state.tradeLog.find((row) => row.transactionId === request.transactionId);
        if (duplicate) {
          assertSaleTransaction(duplicate, request);
          return;
        }

        const timestamp = this.#timestamp();
        state.tradeLog.push({
          ...descriptor.audit,
          transactionId: request.transactionId,
          traderId: descriptor.traderId,
          legacy: false,
          kind: "sale",
          status: TRADE_TRANSACTION_STATUS.PREPARED,
          phase: "prepared",
          request: persistedRequest(request),
          stock: null,
          item: clone(descriptor.item),
          currency: clone(descriptor.currency),
          result: clone(descriptor.result),
          error: null,
          compensation: null,
          rollback: null,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      });
    }
    catch (error) {
      if (error instanceof TradeTransactionError && error.code === "transaction-conflict") {
        throw error;
      }

      let durable = null;
      try {
        durable = this.#repository.findTransaction(request.transactionId);
      }
      catch (readError) {
        throw transactionError(
          "transaction-write-failed",
          "Sale transaction preparation could not be verified",
          request.transactionId,
          readError
        );
      }
      if (!durable) {
        throw transactionError(
          "transaction-write-failed",
          "Sale transaction preparation was not stored",
          request.transactionId,
          error
        );
      }

      assertSaleTransaction(durable, request);
      const terminal = terminalResult(durable);
      if (durable.status === TRADE_TRANSACTION_STATUS.COMMITTED) return terminal;
      if (durable.status === TRADE_TRANSACTION_STATUS.COMPENSATING) {
        return this.#resumeCompensation(request.transactionId, { incrementAttempt: true });
      }
    }

    return this.#resumeApplication(request.transactionId);
  }

  async #resumeApplication(transactionId) {
    let recoveryAttempts = 0;
    while (true) {
      try {
        const transaction = this.#requireTransaction(transactionId);
        const terminal = terminalResult(transaction);
        if (transaction.status === TRADE_TRANSACTION_STATUS.COMMITTED) return terminal;
        if (transaction.status === TRADE_TRANSACTION_STATUS.COMPENSATING) {
          return this.#resumeCompensation(transactionId, { incrementAttempt: true });
        }

        if (transaction.phase === "prepared") {
          let receipts = await this.#readReceipts(transaction);
          if (!this.#applicationReceiptsMatchPhase("prepared", receipts)) {
            return this.#failInconsistentRecovery(transaction, "prepared");
          }
          if (!receipts.itemRemoved) {
            await this.#operations.applySaleItem(clone(transaction));
            receipts = await this.#readReceipts(transaction);
            if (!receipts.itemRemoved
              || !this.#applicationReceiptsMatchPhase("prepared", receipts)) {
              return this.#failInconsistentRecovery(transaction, "prepared");
            }
          }
          await this.#checkpoint(transactionId, (row) => {
            row.status = TRADE_TRANSACTION_STATUS.APPLYING;
            row.phase = "item-removed";
          }, {
            status: TRADE_TRANSACTION_STATUS.APPLYING,
            phase: "item-removed"
          });
          recoveryAttempts = 0;
          continue;
        }

        if (transaction.phase === "item-removed") {
          const receipts = await this.#readReceipts(transaction);
          if (!this.#applicationReceiptsMatchPhase("item-removed", receipts)) {
            return this.#failInconsistentRecovery(transaction, "item-removed");
          }
          if (!receipts.currencyApplied) {
            await this.#operations.applySaleCurrency(clone(transaction));
          }
          await this.#checkpoint(transactionId, (row) => {
            row.status = TRADE_TRANSACTION_STATUS.APPLYING;
            row.phase = "currency-applied";
          }, {
            status: TRADE_TRANSACTION_STATUS.APPLYING,
            phase: "currency-applied"
          });
          recoveryAttempts = 0;
          continue;
        }

        if (transaction.phase === "currency-applied") {
          const receipts = await this.#readReceipts(transaction);
          if (!this.#applicationReceiptsMatchPhase("currency-applied", receipts)) {
            return this.#failInconsistentRecovery(transaction, "currency-applied");
          }
          const committed = await this.#checkpoint(transactionId, (row) => {
            row.status = TRADE_TRANSACTION_STATUS.COMMITTED;
            row.phase = "committed";
            row.committedAt = this.#timestamp();
          }, {
            status: TRADE_TRANSACTION_STATUS.COMMITTED,
            phase: "committed"
          });
          return clone(committed.result);
        }

        return this.#failInconsistentRecovery(transaction, transaction.phase);
      }
      catch (error) {
        if (error instanceof TradeTransactionError
          && ["transaction-compensated", "reconciliation-required", "transaction-conflict"]
            .includes(error.code)) {
          throw error;
        }
        if (error instanceof JournalCheckpointError) {
          recoveryAttempts += 1;
          if (recoveryAttempts <= MAX_JOURNAL_RECOVERY_ATTEMPTS) continue;
          const exhausted = transactionError(
            "transaction-write-failed",
            "Sale transaction checkpoint recovery was exhausted",
            transactionId,
            error
          );
          return this.#compensateFailure(transactionId, exhausted);
        }
        return this.#compensateFailure(transactionId, error);
      }
    }
  }

  #applicationReceiptsMatchPhase(phase, receipts) {
    if (phase === "prepared") return receipts.itemRemoved || !receipts.currencyApplied;
    if (phase === "item-removed") return receipts.itemRemoved;
    if (phase === "currency-applied") {
      return receipts.itemRemoved && receipts.currencyApplied;
    }
    return false;
  }

  async #compensateFailure(transactionId, failure) {
    let recoveryAttempts = 0;
    while (true) {
      const transaction = this.#requireTransaction(transactionId);
      const terminal = terminalResult(transaction);
      if (transaction.status === TRADE_TRANSACTION_STATUS.COMMITTED) return terminal;
      if (transaction.status === TRADE_TRANSACTION_STATUS.COMPENSATING) {
        return this.#resumeCompensation(transactionId);
      }

      const failurePhase = transaction.phase;
      try {
        const outcome = await this.#repository.mutateTransaction(transactionId, (row) => {
          if (row.status === TRADE_TRANSACTION_STATUS.COMMITTED) {
            return { committed: true, result: clone(row.result) };
          }
          if (row.status === TRADE_TRANSACTION_STATUS.COMPENSATING) {
            return { compensating: true };
          }
          row.status = TRADE_TRANSACTION_STATUS.COMPENSATING;
          row.phase = "compensating";
          row.error ??= sanitizeError(failure, failurePhase);
          row.compensation = {
            phase: "pending",
            attempts: Math.max(0, Number(row.compensation?.attempts) || 0) + 1,
            error: null
          };
          row.updatedAt = this.#timestamp();
          return { compensating: true };
        });
        if (outcome?.committed) return clone(outcome.result);
        return this.#resumeCompensation(transactionId);
      }
      catch (startError) {
        let durable = null;
        try {
          durable = this.#repository.findTransaction(transactionId);
        }
        catch (_readError) {
          durable = null;
        }
        if (durable) {
          const durableTerminal = terminalResult(durable);
          if (durable.status === TRADE_TRANSACTION_STATUS.COMMITTED) return durableTerminal;
          if (durable.status === TRADE_TRANSACTION_STATUS.COMPENSATING) {
            return this.#resumeCompensation(transactionId);
          }
        }

        recoveryAttempts += 1;
        if (recoveryAttempts <= MAX_JOURNAL_RECOVERY_ATTEMPTS) continue;
        return this.#markReconciliationRequired(
          transactionId,
          failure,
          startError,
          "compensation-start"
        );
      }
    }
  }

  async #resumeCompensation(transactionId, { incrementAttempt = false } = {}) {
    if (incrementAttempt) {
      const transaction = this.#requireTransaction(transactionId);
      const expectedAttempts = Math.max(0, Number(transaction.compensation?.attempts) || 0) + 1;
      let attemptRecoveries = 0;
      while (true) {
        try {
          await this.#checkpoint(transactionId, (row) => {
            row.compensation ??= { phase: "pending", attempts: 0, error: null };
            row.compensation.attempts = expectedAttempts;
          }, {
            status: transaction.status,
            phase: transaction.phase,
            matches: (row) => Number(row.compensation?.attempts) >= expectedAttempts
          });
          break;
        }
        catch (error) {
          if (!(error instanceof JournalCheckpointError)) throw error;
          attemptRecoveries += 1;
          if (attemptRecoveries > MAX_JOURNAL_RECOVERY_ATTEMPTS) {
            return this.#markReconciliationRequired(
              transactionId,
              transaction.error ?? error,
              error,
              "compensation-attempt"
            );
          }
        }
      }
    }

    let recoveryAttempts = 0;
    while (true) {
      try {
        const transaction = this.#requireTransaction(transactionId);
        const terminal = terminalResult(transaction);
        if (transaction.status === TRADE_TRANSACTION_STATUS.COMMITTED) return terminal;
        if (transaction.status !== TRADE_TRANSACTION_STATUS.COMPENSATING) {
          throw new CompensationStepError(
            "validating-compensation-status",
            transactionError(
              "recovery-receipt-missing",
              "Sale transaction is not in a compensating state",
              transactionId
            )
          );
        }

        let receipts;
        try {
          receipts = await this.#readReceipts(transaction);
        }
        catch (error) {
          throw new CompensationStepError("reading-compensation-receipts", error);
        }
        if (!this.#compensationReceiptsMatchPhase(transaction.phase, receipts)) {
          throw new CompensationStepError(
            "validating-compensation-receipts",
            transactionError(
              "recovery-receipt-missing",
              "Sale compensation phase contradicts retained document receipts",
              transactionId
            )
          );
        }

        if (transaction.phase === "compensating") {
          if (receipts.currencyApplied) {
            try {
              await this.#operations.compensateSaleCurrency(clone(transaction));
            }
            catch (error) {
              throw new CompensationStepError("compensating-currency", error);
            }
          }
          await this.#checkpoint(transactionId, (row) => {
            row.status = TRADE_TRANSACTION_STATUS.COMPENSATING;
            row.phase = "currency-compensated";
            row.compensation ??= { attempts: 1, error: null };
            row.compensation.phase = "currency-compensated";
          }, {
            status: TRADE_TRANSACTION_STATUS.COMPENSATING,
            phase: "currency-compensated"
          });
          recoveryAttempts = 0;
          continue;
        }

        if (transaction.phase === "currency-compensated") {
          if (receipts.itemRemoved) {
            try {
              await this.#operations.compensateSaleItem(clone(transaction));
            }
            catch (error) {
              throw new CompensationStepError("compensating-item", error);
            }
          }
          await this.#checkpoint(transactionId, (row) => {
            row.status = TRADE_TRANSACTION_STATUS.COMPENSATING;
            row.phase = "item-compensated";
            row.compensation ??= { attempts: 1, error: null };
            row.compensation.phase = "item-compensated";
          }, {
            status: TRADE_TRANSACTION_STATUS.COMPENSATING,
            phase: "item-compensated"
          });
          recoveryAttempts = 0;
          continue;
        }

        if (transaction.phase === "item-compensated") {
          await this.#checkpoint(transactionId, (row) => {
            row.status = TRADE_TRANSACTION_STATUS.COMPENSATED;
            row.phase = "compensated";
            row.compensation ??= { attempts: 1, error: null };
            row.compensation.phase = "compensated";
            row.compensatedAt = this.#timestamp();
          }, {
            status: TRADE_TRANSACTION_STATUS.COMPENSATED,
            phase: "compensated"
          });
          throw transactionError(
            "transaction-compensated",
            "Sale transaction was compensated",
            transactionId
          );
        }

        throw new CompensationStepError(
          "validating-compensation-phase",
          transactionError(
            "recovery-receipt-missing",
            "Sale compensation phase is invalid",
            transactionId
          )
        );
      }
      catch (error) {
        if (error instanceof TradeTransactionError
          && ["transaction-compensated", "reconciliation-required"].includes(error.code)) {
          throw error;
        }
        if (error instanceof JournalCheckpointError) {
          recoveryAttempts += 1;
          if (recoveryAttempts <= MAX_JOURNAL_RECOVERY_ATTEMPTS) continue;
        }

        let transaction = null;
        try {
          transaction = this.#repository.findTransaction(transactionId);
        }
        catch (_readError) {
          transaction = null;
        }
        if (transaction?.status === TRADE_TRANSACTION_STATUS.COMMITTED) {
          return clone(transaction.result);
        }
        const originalError = transaction?.error ?? error;
        const compensationError = error instanceof CompensationStepError ? error.cause : error;
        const phase = error instanceof CompensationStepError
          ? error.phase
          : "compensation-checkpoint";
        return this.#markReconciliationRequired(
          transactionId,
          originalError,
          compensationError,
          phase
        );
      }
    }
  }

  #compensationReceiptsMatchPhase(phase, receipts) {
    if (phase === "compensating") return receipts.itemRemoved || !receipts.currencyApplied;
    if (phase === "currency-compensated") return !receipts.currencyApplied;
    if (phase === "item-compensated") {
      return !receipts.itemRemoved && !receipts.currencyApplied;
    }
    return false;
  }

  async #failInconsistentRecovery(transaction, phase) {
    const error = transactionError(
      "recovery-receipt-missing",
      "Persisted sale phase contradicts required document receipts",
      transaction.transactionId
    );
    try {
      await this.#repository.mutateTransaction(transaction.transactionId, (row) => {
        row.status = TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED;
        row.phase = "reconciliation-required";
        row.error = sanitizeError(error, phase, "recovery-receipt-missing");
        row.updatedAt = this.#timestamp();
      });
    }
    catch (cause) {
      throw transactionError(
        "reconciliation-required",
        "Sale transaction requires reconciliation",
        transaction.transactionId,
        cause
      );
    }
    throw transactionError(
      "reconciliation-required",
      "Sale transaction requires reconciliation",
      transaction.transactionId,
      error
    );
  }

  async #markReconciliationRequired(transactionId, originalError, compensationError, phase) {
    let outcome = null;
    try {
      outcome = await this.#repository.mutateTransaction(transactionId, (row) => {
        if (row.status === TRADE_TRANSACTION_STATUS.COMMITTED) {
          return { status: row.status, result: clone(row.result) };
        }
        if (row.status === TRADE_TRANSACTION_STATUS.COMPENSATED
          || row.status === TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED) {
          return { status: row.status };
        }
        const originalPhase = row.error?.phase ?? row.phase;
        row.status = TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED;
        row.phase = `${phase}-failed`;
        row.error ??= sanitizeError(originalError, originalPhase);
        row.compensation ??= { attempts: 1 };
        row.compensation.phase = `${phase}-failed`;
        row.compensation.error = sanitizeError(
          compensationError,
          phase,
          "compensation-failed"
        );
        row.updatedAt = this.#timestamp();
        return { status: row.status };
      });
    }
    catch (cause) {
      let durable = null;
      try {
        durable = this.#repository.findTransaction(transactionId);
      }
      catch (_readError) {
        durable = null;
      }
      if (durable?.status === TRADE_TRANSACTION_STATUS.COMMITTED) {
        return clone(durable.result);
      }
      if (durable?.status === TRADE_TRANSACTION_STATUS.COMPENSATED) {
        throw transactionError(
          "transaction-compensated",
          "Sale transaction was compensated",
          transactionId,
          cause
        );
      }
      throw transactionError(
        "reconciliation-required",
        "Sale transaction requires reconciliation",
        transactionId,
        cause
      );
    }
    if (outcome?.status === TRADE_TRANSACTION_STATUS.COMMITTED) {
      return clone(outcome.result);
    }
    if (outcome?.status === TRADE_TRANSACTION_STATUS.COMPENSATED) {
      throw transactionError(
        "transaction-compensated",
        "Sale transaction was compensated",
        transactionId
      );
    }
    throw transactionError(
      "reconciliation-required",
      "Sale transaction requires reconciliation",
      transactionId,
      compensationError
    );
  }

  async #readReceipts(transaction) {
    const value = await this.#operations.readSaleReceipts(clone(transaction));
    if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.itemRemoved !== "boolean"
      || typeof value.currencyApplied !== "boolean") {
      throw transactionError(
        "sale-receipts-invalid",
        "Sale receipts are invalid",
        transaction.transactionId
      );
    }
    return {
      itemRemoved: value.itemRemoved,
      currencyApplied: value.currencyApplied
    };
  }

  async #checkpoint(transactionId, mutator, { status, phase, matches = null } = {}) {
    const expected = typeof matches === "function"
      ? matches
      : (row) => row?.status === status && row?.phase === phase;
    try {
      return await this.#repository.mutateTransaction(transactionId, (row, state) => {
        mutator(row, state);
        row.updatedAt = this.#timestamp();
        return clone(row);
      });
    }
    catch (error) {
      let durable = null;
      try {
        durable = this.#repository.findTransaction(transactionId);
      }
      catch (_readError) {
        durable = null;
      }
      if (durable && expected(durable)) return durable;
      throw new JournalCheckpointError(transactionId, phase ?? "unknown", error);
    }
  }

  #requireTransaction(transactionId) {
    const transaction = this.#repository.findTransaction(transactionId);
    if (!transaction) {
      throw transactionError(
        "transaction-not-found",
        "Sale transaction was not found",
        transactionId
      );
    }
    return transaction;
  }

  #timestamp() {
    return Number(this.#now());
  }
}
