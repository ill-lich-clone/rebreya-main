import {
  TRADE_TRANSACTION_STATUS,
  TradeTransactionError,
  isValidTradeTransactionId,
  requestsMatch
} from "./trade-transaction-model.js";

const PURCHASE_REQUEST_KEYS = Object.freeze([
  "transactionId",
  "actorId",
  "cityId",
  "traderKey",
  "itemKey",
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
    super(`Trade transaction checkpoint ${phase} was not acknowledged`, { cause });
    this.name = "JournalCheckpointError";
    this.transactionId = transactionId;
    this.phase = phase;
  }
}

class CompensationStepError extends Error {
  constructor(phase, cause) {
    super(`Trade transaction compensation failed during ${phase}`, { cause });
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

function invalidRequest(message, transactionId = "") {
  return new TradeTransactionError("invalid-request", message, { transactionId });
}

function canonicalizePurchaseRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest("Purchase request must be an object");
  }

  const keys = Object.keys(value).sort();
  const expectedKeys = [...PURCHASE_REQUEST_KEYS].sort();
  if (keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])) {
    throw invalidRequest("Purchase request fields are invalid");
  }

  if (!isValidTradeTransactionId(value.transactionId)) {
    throw invalidRequest("Purchase transaction ID is invalid");
  }

  const request = { transactionId: value.transactionId };
  for (const key of PURCHASE_REQUEST_KEYS.slice(1, -2)) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      throw invalidRequest(`Purchase ${key} is invalid`, value.transactionId);
    }
    request[key] = value[key].trim();
  }

  if (!Number.isInteger(value.quantity) || value.quantity < 1) {
    throw invalidRequest("Purchase quantity must be a positive integer", value.transactionId);
  }
  request.quantity = value.quantity;

  if (typeof value.requestedByUserId !== "string" || !value.requestedByUserId.trim()) {
    throw invalidRequest("Purchase requestedByUserId is invalid", value.transactionId);
  }
  request.requestedByUserId = value.requestedByUserId.trim();
  return Object.freeze(request);
}

function sanitizeAudit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(clone(value)).filter(([key]) => (
    !PROTECTED_AUDIT_KEYS.has(key)
  )));
}

function sanitizeError(error, phase, fallbackCode = "purchase-failed") {
  const code = typeof error?.code === "string" && error.code.trim()
    ? error.code.trim()
    : fallbackCode;
  const message = typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : "Purchase transaction failed";
  return { code, message, phase: String(phase ?? "unknown") };
}

function transactionError(code, message, transactionId, cause = null) {
  return new TradeTransactionError(code, message, { transactionId, cause });
}

/**
 * Validates the trusted server-side purchase descriptor returned by
 * `operations.preparePurchase(request, context)`.
 *
 * The descriptor contract is:
 * `{ traderId, stock: { itemKey }, item: { itemId, itemUuid, beforeQuantity,
 * afterQuantity, delta, created, rawItemData }, currency: { beforeCopper,
 * afterCopper, deltaCopper }, result, audit }`.
 */
function normalizeDescriptor(value, request) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw transactionError(
      "invalid-purchase-descriptor",
      "Purchase preparation did not return a descriptor",
      request.transactionId
    );
  }

  const traderId = typeof value.traderId === "string" ? value.traderId.trim() : "";
  const stockItemKey = typeof value.stock?.itemKey === "string"
    ? value.stock.itemKey.trim()
    : "";
  const hasItem = value.item && typeof value.item === "object" && !Array.isArray(value.item);
  const hasCurrency = value.currency
    && typeof value.currency === "object"
    && !Array.isArray(value.currency);
  const hasResult = value.result && typeof value.result === "object" && !Array.isArray(value.result);
  if (!traderId || stockItemKey !== request.itemKey || !hasItem || !hasCurrency || !hasResult) {
    throw transactionError(
      "invalid-purchase-descriptor",
      "Purchase preparation returned an invalid descriptor",
      request.transactionId
    );
  }

  const item = value.item;
  const currency = value.currency;
  const validItem = typeof item.itemId === "string"
    && Boolean(item.itemId.trim())
    && typeof item.itemUuid === "string"
    && Boolean(item.itemUuid.trim())
    && Number.isInteger(item.beforeQuantity)
    && item.beforeQuantity >= 0
    && Number.isInteger(item.afterQuantity)
    && item.afterQuantity >= 0
    && Number.isInteger(item.delta)
    && item.delta > 0
    && item.afterQuantity - item.beforeQuantity === item.delta
    && typeof item.created === "boolean"
    && item.rawItemData
    && typeof item.rawItemData === "object"
    && !Array.isArray(item.rawItemData);
  const validCurrency = Number.isInteger(currency.beforeCopper)
    && currency.beforeCopper >= 0
    && Number.isInteger(currency.afterCopper)
    && currency.afterCopper >= 0
    && Number.isInteger(currency.deltaCopper)
    && currency.deltaCopper < 0
    && currency.afterCopper - currency.beforeCopper === currency.deltaCopper;
  const validResultTransaction = !Object.hasOwn(value.result, "transactionId")
    || value.result.transactionId === request.transactionId;
  const validResultTotal = !Object.hasOwn(value.result, "totalPriceCopper")
    || value.result.totalPriceCopper === -currency.deltaCopper;
  if (!validItem || !validCurrency || !validResultTransaction || !validResultTotal) {
    throw transactionError(
      "invalid-purchase-descriptor",
      "Purchase preparation returned invalid item, currency, or result deltas",
      request.transactionId
    );
  }

  return {
    traderId,
    stock: { itemKey: stockItemKey },
    item: clone(value.item),
    currency: clone(value.currency),
    result: clone(value.result),
    audit: sanitizeAudit(value.audit)
  };
}

function assertMatchingRequest(transaction, request) {
  if (!requestsMatch(transaction?.request, request)) {
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
      "Trade transaction was compensated",
      transaction.transactionId
    );
  }
  if (transaction.status === TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED) {
    throw transactionError(
      "reconciliation-required",
      "Trade transaction requires reconciliation",
      transaction.transactionId
    );
  }
  return null;
}

export class TradeTransactionService {
  #inFlight = new Map();
  #now;
  #operations;
  #repository;

  constructor({ repository, operations, now = () => Date.now() }) {
    this.#repository = repository;
    this.#operations = operations;
    this.#now = now;
  }

  async purchase(request, context = {}) {
    const canonicalRequest = canonicalizePurchaseRequest(request);
    const transactionId = canonicalRequest.transactionId;
    const active = this.#inFlight.get(transactionId);
    if (active) {
      if (!requestsMatch(active.request, canonicalRequest)) {
        throw transactionError(
          "transaction-conflict",
          "Trade transaction ID belongs to a different request",
          transactionId
        );
      }
      return clone(await active.promise);
    }

    const promise = this.#executePurchase(canonicalRequest, context);
    this.#inFlight.set(transactionId, { request: canonicalRequest, promise });
    try {
      return clone(await promise);
    }
    finally {
      if (this.#inFlight.get(transactionId)?.promise === promise) {
        this.#inFlight.delete(transactionId);
      }
    }
  }

  async #executePurchase(request, context) {
    const persisted = this.#repository.findTransaction(request.transactionId);
    if (persisted) {
      assertMatchingRequest(persisted, request);
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
        await this.#operations.preparePurchase(clone(request), context),
        request
      );
    }
    catch (error) {
      if (error instanceof TradeTransactionError && error.transactionId) throw error;
      throw transactionError(
        error?.code ?? "purchase-preparation-failed",
        error?.message ?? "Purchase preparation failed",
        request.transactionId,
        error
      );
    }

    try {
      await this.#repository.mutate((state) => {
        const duplicate = state.tradeLog.find((row) => row.transactionId === request.transactionId);
        if (duplicate) {
          assertMatchingRequest(duplicate, request);
          return;
        }

        const trader = state.traders?.[descriptor.traderId];
        const inventory = Array.isArray(trader?.inventory) ? trader.inventory : [];
        const stock = inventory.find((entry) => (
          entry?.itemKey === descriptor.stock.itemKey
          && entry.itemKey === request.itemKey
        ));
        const before = stock?.quantity;
        if (!Number.isInteger(before) || before < request.quantity) {
          throw transactionError(
            "stock-unavailable",
            "Trader stock is unavailable",
            request.transactionId
          );
        }

        const after = before - request.quantity;
        if (after < 0) {
          throw transactionError(
            "stock-unavailable",
            "Trader stock is unavailable",
            request.transactionId
          );
        }
        stock.quantity = after;
        const timestamp = this.#timestamp();
        state.tradeLog.push({
          ...descriptor.audit,
          transactionId: request.transactionId,
          traderId: descriptor.traderId,
          legacy: false,
          kind: "purchase",
          status: TRADE_TRANSACTION_STATUS.PREPARED,
          phase: "stock-reserved",
          request: clone(request),
          stock: {
            itemKey: request.itemKey,
            before,
            after,
            delta: -request.quantity
          },
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
      if (error instanceof TradeTransactionError
        && ["stock-unavailable", "transaction-conflict"].includes(error.code)) {
        throw error;
      }

      let durable = null;
      try {
        durable = this.#repository.findTransaction(request.transactionId);
      }
      catch (readError) {
        throw transactionError(
          "transaction-write-failed",
          "Trade transaction reservation could not be verified",
          request.transactionId,
          readError
        );
      }
      if (!durable) {
        throw transactionError(
          "transaction-write-failed",
          "Trade transaction reservation was not stored",
          request.transactionId,
          error
        );
      }

      assertMatchingRequest(durable, request);
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

        if (transaction.phase === "stock-reserved") {
          const receipts = await this.#readReceipts(transaction);
          if (!receipts.itemApplied && receipts.currencyApplied) {
            return await this.#failInconsistentRecovery(transaction, "stock-reserved");
          }
          if (!receipts.itemApplied) {
            await this.#operations.applyPurchaseItem(clone(transaction));
          }
          await this.#checkpoint(transactionId, (row) => {
            row.status = TRADE_TRANSACTION_STATUS.APPLYING;
            row.phase = "item-applied";
          }, {
            status: TRADE_TRANSACTION_STATUS.APPLYING,
            phase: "item-applied"
          });
          recoveryAttempts = 0;
          continue;
        }

        if (transaction.phase === "item-applied") {
          const receipts = await this.#readReceipts(transaction);
          if (!receipts.itemApplied) {
            return await this.#failInconsistentRecovery(transaction, "item-applied");
          }
          if (!receipts.currencyApplied) {
            await this.#operations.applyPurchaseCurrency(clone(transaction));
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
          if (!receipts.itemApplied || !receipts.currencyApplied) {
            return await this.#failInconsistentRecovery(transaction, "currency-applied");
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

        return await this.#failInconsistentRecovery(transaction, transaction.phase);
      }
      catch (error) {
        if (error instanceof TradeTransactionError
          && [
            "transaction-compensated",
            "reconciliation-required",
            "transaction-conflict"
          ].includes(error.code)) {
          throw error;
        }
        if (error instanceof JournalCheckpointError) {
          recoveryAttempts += 1;
          if (recoveryAttempts <= MAX_JOURNAL_RECOVERY_ATTEMPTS) continue;
          const exhausted = transactionError(
            "transaction-write-failed",
            "Trade transaction checkpoint recovery was exhausted",
            transactionId,
            error
          );
          return this.#compensateFailure(transactionId, exhausted);
        }
        return this.#compensateFailure(transactionId, error);
      }
    }
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
      catch (compensationStartError) {
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
          compensationStartError,
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
        if (transaction.status === TRADE_TRANSACTION_STATUS.COMPENSATED) return terminal;
        if (transaction.status !== TRADE_TRANSACTION_STATUS.COMPENSATING) {
          throw new CompensationStepError(
            "validating-compensation-status",
            transactionError(
              "recovery-receipt-missing",
              "Trade transaction is not in a compensating state",
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
              "Compensation phase contradicts retained document receipts",
              transactionId
            )
          );
        }

        if (transaction.phase === "compensating") {
          if (receipts.currencyApplied) {
            try {
              await this.#operations.compensatePurchaseCurrency(clone(transaction));
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
          if (receipts.itemApplied) {
            try {
              await this.#operations.compensatePurchaseItem(clone(transaction));
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
          await this.#releaseStock(transactionId);
          recoveryAttempts = 0;
          continue;
        }

        if (transaction.phase === "stock-released") {
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
            "Trade transaction was compensated",
            transactionId
          );
        }
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
    if (phase === "compensating") {
      return receipts.itemApplied || !receipts.currencyApplied;
    }
    if (phase === "currency-compensated") {
      return !receipts.currencyApplied;
    }
    if (phase === "item-compensated" || phase === "stock-released") {
      return !receipts.itemApplied && !receipts.currencyApplied;
    }
    return false;
  }

  async #releaseStock(transactionId) {
    try {
      await this.#repository.mutate((state) => {
        const row = state.tradeLog.find((entry) => entry.transactionId === transactionId);
        if (!row) {
          throw transactionError(
            "transaction-not-found",
            "Trade transaction was not found",
            transactionId
          );
        }
        if (row.phase === "stock-released" || row.compensation?.phase === "stock-released") {
          return;
        }
        if (row.status !== TRADE_TRANSACTION_STATUS.COMPENSATING
          || row.phase !== "item-compensated") {
          throw transactionError(
            "recovery-receipt-missing",
            "Trade transaction is not ready to release stock",
            transactionId
          );
        }

        const traderId = String(
          row.traderId ?? `${row.request?.cityId ?? ""}::${row.request?.traderKey ?? ""}`
        ).trim();
        const trader = state.traders?.[traderId];
        const stock = Array.isArray(trader?.inventory)
          ? trader.inventory.find((entry) => entry?.itemKey === row.stock?.itemKey)
          : null;
        const release = -Number(row.stock?.delta);
        if (!stock || !Number.isInteger(stock.quantity)
          || !Number.isInteger(release) || release < 1) {
          throw transactionError(
            "stock-release-unavailable",
            "Reserved trader stock could not be released",
            transactionId
          );
        }

        stock.quantity += release;
        row.status = TRADE_TRANSACTION_STATUS.COMPENSATING;
        row.phase = "stock-released";
        row.compensation ??= { attempts: 1, error: null };
        row.compensation.phase = "stock-released";
        row.updatedAt = this.#timestamp();
      });
    }
    catch (error) {
      if (error instanceof TradeTransactionError) {
        throw new CompensationStepError("releasing-stock", error);
      }
      let durable = null;
      try {
        durable = this.#repository.findTransaction(transactionId);
      }
      catch (_readError) {
        durable = null;
      }
      if (durable?.status === TRADE_TRANSACTION_STATUS.COMPENSATING
        && durable.phase === "stock-released") {
        return durable;
      }
      throw new JournalCheckpointError(transactionId, "stock-released", error);
    }
    return this.#requireTransaction(transactionId);
  }

  async #failInconsistentRecovery(transaction, phase) {
    const error = transactionError(
      "recovery-receipt-missing",
      "Persisted purchase phase is missing a required document receipt",
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
        "Trade transaction requires reconciliation",
        transaction.transactionId,
        cause
      );
    }
    throw transactionError(
      "reconciliation-required",
      "Trade transaction requires reconciliation",
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
          "Trade transaction was compensated",
          transactionId,
          cause
        );
      }
      throw transactionError(
        "reconciliation-required",
        "Trade transaction requires reconciliation",
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
        "Trade transaction was compensated",
        transactionId
      );
    }
    throw transactionError(
      "reconciliation-required",
      "Trade transaction requires reconciliation",
      transactionId,
      compensationError
    );
  }

  async #readReceipts(transaction) {
    const value = await this.#operations.readPurchaseReceipts(clone(transaction));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw transactionError(
        "purchase-receipts-invalid",
        "Purchase receipts are invalid",
        transaction.transactionId
      );
    }
    return {
      itemApplied: value.itemApplied === true,
      currencyApplied: value.currencyApplied === true
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
        "Trade transaction was not found",
        transactionId
      );
    }
    return transaction;
  }

  #timestamp() {
    return Number(this.#now());
  }
}
