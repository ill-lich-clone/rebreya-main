import { canonicalizePurchaseBasketRequest } from "../../application/purchase-basket-command.js";

function clone(value) {
  if (value == null) return value;
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function sanitizedError(error, fallbackCode) {
  return {
    code: typeof error?.code === "string" && error.code.trim() ? error.code.trim() : fallbackCode,
    message: typeof error?.message === "string" && error.message.trim()
      ? error.message.trim()
      : "Purchase basket operation failed"
  };
}

export class PurchaseBasketError extends Error {
  constructor(code, message, { transactionId = "", cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PurchaseBasketError";
    this.code = code;
    this.transactionId = transactionId;
  }
}

function basketError(code, message, transactionId, cause = null) {
  return new PurchaseBasketError(code, message, { transactionId, cause });
}

function validatePort(port, methods, label) {
  if (!port || methods.some((method) => typeof port[method] !== "function")) {
    throw new TypeError(`${label} must implement ${methods.join(", ")}`);
  }
}

export class PurchaseBasketService {
  #actorTails = new Map();
  #inFlight = new Map();
  #journal;
  #operations;

  constructor({ journal, operations } = {}) {
    validatePort(journal, ["find", "start", "checkpoint", "finish"], "journal");
    validatePort(operations, ["prepare", "readReceipts", "applyItems", "applyCurrency", "compensateItems"], "operations");
    this.#journal = journal;
    this.#operations = operations;
  }

  async commit(payload, { requestedByUserId = "" } = {}) {
    let request;
    try {
      request = canonicalizePurchaseBasketRequest(payload, requestedByUserId);
    }
    catch (error) {
      throw basketError(
        error?.code ?? "invalid-request",
        error?.message ?? "Purchase basket request is invalid",
        error?.transactionId ?? String(payload?.transactionId ?? ""),
        error
      );
    }

    const active = this.#inFlight.get(request.transactionId);
    if (active) {
      if (active.fingerprint !== request.fingerprint) {
        throw basketError("transaction-conflict", "Transaction ID belongs to another basket", request.transactionId);
      }
      return clone(await active.promise);
    }

    const promise = this.#runForActor(request.actorId, () => this.#execute(request));
    this.#inFlight.set(request.transactionId, { fingerprint: request.fingerprint, promise });
    try {
      return clone(await promise);
    }
    finally {
      if (this.#inFlight.get(request.transactionId)?.promise === promise) {
        this.#inFlight.delete(request.transactionId);
      }
    }
  }

  async #runForActor(actorId, operation) {
    const previous = this.#actorTails.get(actorId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.#actorTails.set(actorId, current);
    try {
      return await current;
    }
    finally {
      if (this.#actorTails.get(actorId) === current) this.#actorTails.delete(actorId);
    }
  }

  async #execute(request) {
    let record = await this.#journal.find(request.transactionId);
    if (record) {
      if (record.fingerprint !== request.fingerprint) {
        throw basketError("transaction-conflict", "Transaction ID belongs to another basket", request.transactionId);
      }
      if (record.terminal === true) return this.#terminalOutcome(record);
      return this.#resume(record);
    }

    let descriptor;
    try {
      descriptor = clone(await this.#operations.prepare(clone(request)));
    }
    catch (error) {
      throw basketError(error?.code ?? "purchase-preparation-failed", error?.message ?? "Purchase preparation failed", request.transactionId, error);
    }

    record = await this.#journal.start({
      id: request.transactionId,
      kind: "purchase-basket",
      fingerprint: request.fingerprint,
      request: clone(request),
      descriptor,
      phase: "prepared"
    });
    if (record.fingerprint !== request.fingerprint) {
      throw basketError("transaction-conflict", "Transaction ID belongs to another basket", request.transactionId);
    }
    return this.#resume(record);
  }

  async #resume(initialRecord) {
    let record = clone(initialRecord);
    for (let step = 0; step < 12; step += 1) {
      if (record.terminal === true) return this.#terminalOutcome(record);

      if (record.phase === "prepared") {
        record = await this.#resumePrepared(record);
        continue;
      }
      if (record.phase === "items-applied") {
        record = await this.#resumeItemsApplied(record);
        continue;
      }
      if (record.phase === "currency-applied") {
        return this.#commitApplied(record);
      }
      if (record.phase === "compensating") {
        return this.#finishCompensation(record, record.error ?? { code: "purchase-failed", message: "Purchase failed" });
      }
      if (["committed", "compensated", "reconciliation-required"].includes(record.phase)) {
        record = await this.#journal.finish(record.id, record.result ?? this.#phaseResult(record));
        return this.#terminalOutcome(record);
      }
      return this.#reconciliation(record, { code: "invalid-phase", message: `Unknown purchase phase: ${String(record.phase)}` });
    }
    return this.#reconciliation(record, { code: "resume-limit", message: "Purchase recovery exceeded its phase limit" });
  }

  #itemsComplete(record, receipts) {
    const expected = record.descriptor?.items?.length ?? 0;
    return expected > 0
      && Array.isArray(receipts?.itemUuids)
      && receipts.itemUuids.length === expected
      && receipts.itemUuids.every((uuid) => typeof uuid === "string" && uuid.trim());
  }

  async #resumePrepared(record) {
    let receipts = await this.#operations.readReceipts(clone(record));
    if (!this.#itemsComplete(record, receipts)) {
      if (Array.isArray(receipts?.itemUuids) && receipts.itemUuids.length > 0) {
        return this.#beginCompensation(record, { code: "partial-item-application", message: "Purchase Item batch is incomplete" });
      }
      try {
        await this.#operations.applyItems(clone(record));
      }
      catch (error) {
        receipts = await this.#operations.readReceipts(clone(record));
        if (!this.#itemsComplete(record, receipts)) {
          return this.#beginCompensation(record, sanitizedError(error, "item-create-failed"));
        }
      }
      receipts = await this.#operations.readReceipts(clone(record));
    }
    if (!this.#itemsComplete(record, receipts)) {
      return this.#reconciliation(record, { code: "item-receipt-invalid", message: "Applied Item batch receipt is incomplete" });
    }
    return this.#journal.checkpoint(record.id, "prepared", "items-applied", {
      itemUuids: clone(receipts.itemUuids)
    });
  }

  async #resumeItemsApplied(record) {
    let receipts = await this.#operations.readReceipts(clone(record));
    if (!this.#itemsComplete(record, receipts)) {
      return this.#reconciliation(record, { code: "item-receipt-invalid", message: "Purchase Item receipt no longer matches" });
    }
    if (receipts.currency === "after") {
      return this.#journal.checkpoint(record.id, "items-applied", "currency-applied", {
        itemUuids: clone(receipts.itemUuids)
      });
    }
    if (receipts.currency !== "before") {
      return this.#reconciliation(record, { code: "currency-state-ambiguous", message: "Actor wallet matches neither purchase checkpoint" });
    }

    let failure = null;
    try {
      await this.#operations.applyCurrency(clone(record));
    }
    catch (error) {
      failure = sanitizedError(error, "currency-update-failed");
    }
    receipts = await this.#operations.readReceipts(clone(record));
    if (receipts.currency === "after" && this.#itemsComplete(record, receipts)) {
      return this.#journal.checkpoint(record.id, "items-applied", "currency-applied", {
        itemUuids: clone(receipts.itemUuids)
      });
    }
    if (receipts.currency === "before") {
      return this.#beginCompensation(record, failure ?? {
        code: "currency-update-unconfirmed",
        message: "Currency update did not reach the expected balance"
      });
    }
    return this.#reconciliation(record, failure ?? {
      code: "currency-state-ambiguous",
      message: "Actor wallet matches neither purchase checkpoint"
    });
  }

  async #commitApplied(record) {
    const receipts = await this.#operations.readReceipts(clone(record));
    if (!this.#itemsComplete(record, receipts) || receipts.currency !== "after") {
      return this.#reconciliation(record, { code: "commit-receipt-invalid", message: "Committed purchase receipts are inconsistent" });
    }
    const result = {
      status: "committed",
      transactionId: record.id,
      actorId: record.request.actorId,
      createdItemUuids: clone(receipts.itemUuids),
      totalPriceCopper: record.descriptor.totalPriceCopper
    };
    const committed = await this.#journal.checkpoint(record.id, "currency-applied", "committed", { result });
    return this.#journal.finish(record.id, result).then((terminal) => this.#terminalOutcome(terminal));
  }

  async #beginCompensation(record, error) {
    const compensating = await this.#journal.checkpoint(record.id, record.phase, "compensating", {
      error: clone(error)
    });
    return this.#finishCompensation(compensating, error);
  }

  async #finishCompensation(record, error) {
    try {
      await this.#operations.compensateItems(clone(record));
    }
    catch (compensationError) {
      return this.#reconciliation(record, {
        code: "compensation-failed",
        message: compensationError?.message ?? "Purchase Item compensation failed",
        cause: clone(error)
      });
    }
    const receipts = await this.#operations.readReceipts(clone(record));
    if (Array.isArray(receipts?.itemUuids) && receipts.itemUuids.length > 0) {
      return this.#reconciliation(record, { code: "compensation-incomplete", message: "Purchase Items remain after compensation" });
    }
    const result = {
      status: "compensated",
      transactionId: record.id,
      actorId: record.request.actorId,
      error: clone(error)
    };
    const compensated = await this.#journal.checkpoint(record.id, "compensating", "compensated", { result });
    const terminal = await this.#journal.finish(record.id, result);
    return this.#terminalOutcome(terminal ?? compensated);
  }

  async #reconciliation(record, error) {
    if (record.phase !== "reconciliation-required") {
      record = await this.#journal.checkpoint(record.id, record.phase, "reconciliation-required", {
        error: clone(error)
      });
    }
    const result = {
      status: "reconciliation-required",
      transactionId: record.id,
      actorId: record.request.actorId,
      error: clone(error)
    };
    const terminal = await this.#journal.finish(record.id, result);
    return this.#terminalOutcome(terminal);
  }

  #phaseResult(record) {
    return {
      status: record.phase,
      transactionId: record.id,
      actorId: record.request?.actorId ?? "",
      error: clone(record.error ?? null)
    };
  }

  #terminalOutcome(record) {
    const result = clone(record.result ?? this.#phaseResult(record));
    if (record.phase === "committed" || result.status === "committed") return result;
    const code = result.status === "compensated" ? "transaction-compensated" : "reconciliation-required";
    throw basketError(code, result.error?.message ?? "Purchase basket did not commit", record.id);
  }
}
