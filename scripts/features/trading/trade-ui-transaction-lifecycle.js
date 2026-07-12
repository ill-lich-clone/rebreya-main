import {
  createTradeTransactionId,
  isValidTradeTransactionId
} from "./trade-transaction-model.js";

const DEFINITIVE_FAILURE_CODES = new Set([
  "transaction-conflict",
  "transaction-compensated",
  "invalid-request",
  "invalid-payload",
  "unauthorized",
  "transaction-not-found",
  "transaction-not-rollbackable"
]);

function semanticPart(value) {
  return String(value ?? "").trim();
}

export function purchaseSemanticKey({ actorId, cityId, traderKey, itemKey, quantity }) {
  return JSON.stringify(["purchase", actorId, cityId, traderKey, itemKey, quantity].map(semanticPart));
}

export function saleSemanticKey({ actorId, cityId, traderKey, itemUuid, quantity }) {
  return JSON.stringify(["sale", actorId, cityId, traderKey, itemUuid, quantity].map(semanticPart));
}

export function rollbackSemanticKey(entryId) {
  return JSON.stringify(["rollback", entryId].map(semanticPart));
}

export function rollbackResumeIdentity(record) {
  const rollback = record?.rollback;
  if (rollback == null) return { kind: "new", transactionId: "" };
  const transactionId = String(rollback?.transactionId ?? "").trim();
  const resumable = ["prepared", "applying", "reconciliation-required"].includes(
    String(rollback?.status ?? "").trim()
  );
  return resumable && isValidTradeTransactionId(transactionId)
    ? { kind: "resume", transactionId }
    : { kind: "unavailable", transactionId: "" };
}

export function isFrozenSaleBasketEntry(entry) {
  return entry?.frozenQuantity != null;
}

export function hasFrozenSaleBasketEntries(basket) {
  return Array.from(basket?.values?.() ?? []).some(isFrozenSaleBasketEntry);
}

export function tradeErrorCorrelation(error, transactionId) {
  const correlatedId = String(
    error?.rollbackTransactionId ?? error?.transactionId ?? transactionId ?? ""
  ).trim();
  return correlatedId ? `${error?.message ?? "Trade operation failed"} [ID: ${correlatedId}]` : String(error?.message ?? "Trade operation failed");
}

export class PendingTradeTransactions {
  #idFactory;
  #pending = new Map();

  constructor({ idFactory = createTradeTransactionId } = {}) {
    this.#idFactory = idFactory;
  }

  acquire(prefix, semanticKey) {
    const key = semanticPart(semanticKey);
    if (!key) throw new TypeError("Trade semantic key is required");
    const existing = this.#pending.get(key);
    if (existing) return existing;
    const transactionId = this.#idFactory(prefix);
    this.#pending.set(key, transactionId);
    return transactionId;
  }

  adopt(semanticKey, transactionId) {
    const key = semanticPart(semanticKey);
    const id = String(transactionId ?? "").trim();
    if (!key || !isValidTradeTransactionId(id)) return false;
    this.#pending.set(key, id);
    return true;
  }

  resolve(semanticKey) {
    this.#pending.delete(semanticPart(semanticKey));
  }

  reject(semanticKey, error) {
    if (DEFINITIVE_FAILURE_CODES.has(String(error?.code ?? ""))) {
      this.resolve(semanticKey);
    }
  }
}

export async function commitSaleBasket(basket, dispatch, {
  idFactory = createTradeTransactionId,
  onDispatched = () => undefined,
  onSettledEntry = () => undefined
} = {}) {
  for (const [itemUuid, entry] of Array.from(basket.entries())) {
    if (basket.get(itemUuid) !== entry) continue;
    entry.transactionId ??= idFactory("sale");
    entry.frozenQuantity ??= entry.quantity;
    await onDispatched(entry);
    if (basket.get(itemUuid) !== entry) continue;
    try {
      await dispatch(entry);
      if (basket.get(itemUuid) === entry) {
        basket.delete(itemUuid);
        await onSettledEntry(entry, { committed: true });
      }
    }
    catch (error) {
      if (DEFINITIVE_FAILURE_CODES.has(String(error?.code ?? ""))
        && basket.get(itemUuid) === entry) {
        basket.delete(itemUuid);
        await onSettledEntry(entry, {
          committed: false,
          terminal: true,
          code: String(error?.code ?? "")
        });
      }
      throw error;
    }
  }
}
