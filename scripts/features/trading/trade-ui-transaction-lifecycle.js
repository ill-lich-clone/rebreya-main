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
  "transaction-not-rollbackable",
  "sale-preparation-failed",
  "invalid-sale-descriptor",
  "purchase-preparation-failed",
  "invalid-purchase-descriptor",
  "stock-unavailable"
]);
const PENDING_STORAGE_VERSION = 1;
const PENDING_STORAGE_LIMIT = 128;
const MAX_SEMANTIC_KEY_LENGTH = 4096;

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

export function createTradePendingStorageKey({ moduleId, worldId, userId, surface }) {
  const parts = [moduleId, worldId, userId, surface].map(semanticPart);
  if (parts.some((part) => !part)) throw new TypeError("Pending trade storage scope is incomplete");
  return `${parts[0]}.trade-pending.v1.${parts.slice(1).map(encodeURIComponent).join(".")}`;
}

export function createTradePendingStorageOptions({ moduleId, surface, game = globalThis.game } = {}) {
  let storage = null;
  try {
    storage = globalThis.localStorage ?? null;
  }
  catch {
    storage = null;
  }
  return {
    storage,
    storageKey: createTradePendingStorageKey({
      moduleId,
      worldId: game?.world?.id ?? game?.worldId ?? "unknown-world",
      userId: game?.user?.id ?? "unknown-user",
      surface
    })
  };
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

export function summarizeCommittedSaleEntries(entries = []) {
  return entries.reduce((summary, committed) => {
    const entry = committed?.entry ?? committed;
    const result = committed?.result;
    const quantity = Number(entry?.frozenQuantity);
    const serverQuantity = Number(result?.sellQuantity);
    const serverPayout = Number(result?.netPayoutCopper);
    const unitPayout = Number(entry?.preview?.netPayoutCopper);
    const validServerResult = Number.isInteger(serverQuantity)
      && serverQuantity > 0
      && Number.isInteger(serverPayout)
      && serverPayout >= 0;
    const validFallback = Number.isFinite(unitPayout) && unitPayout >= 0;
    if (!Number.isInteger(quantity) || quantity < 1 || (!validServerResult && !validFallback)) {
      return summary;
    }
    summary.count += 1;
    summary.netCopper += validServerResult
      ? serverPayout
      : Math.round(unitPayout) * quantity;
    return summary;
  }, { count: 0, netCopper: 0 });
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
  #now;
  #storage;
  #storageDisabled = false;
  #storageKey;

  constructor({
    idFactory = createTradeTransactionId,
    now = () => Date.now(),
    storage = null,
    storageKey = ""
  } = {}) {
    this.#idFactory = idFactory;
    this.#now = now;
    this.#storage = storage;
    this.#storageKey = String(storageKey ?? "").trim();
  }

  acquire(prefix, semanticKey) {
    const key = semanticPart(semanticKey);
    if (!key || key.length > MAX_SEMANTIC_KEY_LENGTH) throw new TypeError("Trade semantic key is required");
    this.#load();
    const existing = this.#pending.get(key);
    if (existing) return existing.transactionId;
    const transactionId = String(this.#idFactory(prefix) ?? "").trim();
    if (!isValidTradeTransactionId(transactionId)) {
      throw new TypeError("Trade transaction ID factory returned an invalid ID");
    }
    this.#pending.set(key, { transactionId, updatedAt: this.#timestamp() });
    this.#persist();
    return transactionId;
  }

  adopt(semanticKey, transactionId) {
    const key = semanticPart(semanticKey);
    const id = String(transactionId ?? "").trim();
    if (!key || key.length > MAX_SEMANTIC_KEY_LENGTH || !isValidTradeTransactionId(id)) return false;
    this.#load();
    this.#pending.set(key, { transactionId: id, updatedAt: this.#timestamp() });
    this.#persist();
    return true;
  }

  resolve(semanticKey) {
    this.#load();
    this.#pending.delete(semanticPart(semanticKey));
    this.#persist();
  }

  reject(semanticKey, error) {
    if (DEFINITIVE_FAILURE_CODES.has(String(error?.code ?? ""))) {
      this.resolve(semanticKey);
    }
  }

  #load() {
    if (this.#storageDisabled || !this.#storageKey || typeof this.#storage?.getItem !== "function") return;
    let raw;
    try {
      raw = this.#storage.getItem(this.#storageKey);
    }
    catch {
      this.#storageDisabled = true;
      return;
    }
    if (raw == null) {
      this.#pending.clear();
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.version !== PENDING_STORAGE_VERSION || !Array.isArray(parsed.entries)) return;
      const entries = parsed.entries
        .filter((entry) => (
          entry
          && typeof entry.semanticKey === "string"
          && entry.semanticKey.length > 0
          && entry.semanticKey.length <= MAX_SEMANTIC_KEY_LENGTH
          && isValidTradeTransactionId(entry.transactionId)
          && Number.isFinite(Number(entry.updatedAt))
        ))
        .sort((left, right) => Number(left.updatedAt) - Number(right.updatedAt))
        .slice(-PENDING_STORAGE_LIMIT);
      this.#pending = new Map(entries.map((entry) => [entry.semanticKey, {
        transactionId: entry.transactionId,
        updatedAt: Number(entry.updatedAt)
      }]));
    }
    catch {
      // Corrupt storage is ignored; the in-memory state remains authoritative.
    }
  }

  #persist() {
    const entries = Array.from(this.#pending, ([semanticKey, value]) => ({
      semanticKey,
      transactionId: value.transactionId,
      updatedAt: value.updatedAt
    })).sort((left, right) => left.updatedAt - right.updatedAt).slice(-PENDING_STORAGE_LIMIT);
    this.#pending = new Map(entries.map((entry) => [entry.semanticKey, {
      transactionId: entry.transactionId,
      updatedAt: entry.updatedAt
    }]));
    if (this.#storageDisabled || !this.#storageKey || typeof this.#storage?.setItem !== "function") return;
    try {
      this.#storage.setItem(this.#storageKey, JSON.stringify({
        version: PENDING_STORAGE_VERSION,
        entries
      }));
    }
    catch {
      this.#storageDisabled = true;
    }
  }

  #timestamp() {
    const value = Number(this.#now());
    return Number.isFinite(value) ? value : Date.now();
  }
}

export async function commitSaleBasket(basket, dispatch, {
  idFactory = createTradeTransactionId,
  prepareEntry = () => undefined,
  onDispatched = () => undefined,
  onSettledEntry = () => undefined
} = {}) {
  const committedEntries = [];
  for (const [itemUuid, entry] of Array.from(basket.entries())) {
    if (basket.get(itemUuid) !== entry) continue;
    await prepareEntry(entry);
    if (basket.get(itemUuid) !== entry) continue;
    entry.transactionId ??= idFactory("sale");
    entry.frozenQuantity ??= entry.quantity;
    await onDispatched(entry);
    if (basket.get(itemUuid) !== entry) continue;
    try {
      const result = await dispatch(entry);
      if (basket.get(itemUuid) === entry) {
        basket.delete(itemUuid);
        committedEntries.push({ entry, result });
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
  return { committedEntries };
}
