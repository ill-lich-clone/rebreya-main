import { createTradeTransactionId } from "./trade-transaction-model.js";

const DEFINITIVE_FAILURE_CODES = new Set(["transaction-compensated"]);

function semanticPart(value) {
  return String(value ?? "").trim();
}

export function purchaseSemanticKey({ actorId, cityId, traderKey, itemKey, quantity }) {
  return ["purchase", actorId, cityId, traderKey, itemKey, quantity]
    .map(semanticPart)
    .join("|");
}

export function saleSemanticKey({ actorId, cityId, traderKey, itemUuid, quantity }) {
  return ["sale", actorId, cityId, traderKey, itemUuid, quantity]
    .map(semanticPart)
    .join("|");
}

export function rollbackSemanticKey(entryId) {
  return ["rollback", entryId].map(semanticPart).join("|");
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
  onSettledEntry = () => undefined
} = {}) {
  for (const [itemUuid, entry] of Array.from(basket.entries())) {
    entry.transactionId ??= idFactory("sale");
    entry.frozenQuantity ??= entry.quantity;
    try {
      await dispatch(entry);
      basket.delete(itemUuid);
      await onSettledEntry(entry, { committed: true });
    }
    catch (error) {
      if (DEFINITIVE_FAILURE_CODES.has(String(error?.code ?? ""))) {
        basket.delete(itemUuid);
        await onSettledEntry(entry, { committed: false, compensated: true });
      }
      throw error;
    }
  }
}
