export const TRADE_TRANSACTION_STATUS = Object.freeze({
  PREPARED: "prepared",
  APPLYING: "applying",
  COMMITTED: "committed",
  COMPENSATING: "compensating",
  COMPENSATED: "compensated",
  RECONCILIATION_REQUIRED: "reconciliation-required"
});

export const TERMINAL_TRADE_STATUSES = new Set(["committed", "compensated"]);

const REQUEST_KEYS = Object.freeze([
  "actorId",
  "cityId",
  "traderKey",
  "itemKey",
  "itemUuid",
  "quantity",
  "requestedByUserId"
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

export class TradeTransactionError extends Error {
  constructor(code, message, { transactionId = "", cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "TradeTransactionError";
    this.code = code;
    this.transactionId = transactionId;
  }
}

export function isValidTradeTransactionId(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9_-]{8,128}$/u.test(value);
}

export function createTradeTransactionId(prefix = "trade") {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "")
    ?? Math.random().toString(36).slice(2, 18);
  return `${String(prefix).replace(/[^A-Za-z0-9_-]/gu, "_")}_${Date.now()}_${random}`.slice(0, 128);
}

export function requestsMatch(left = {}, right = {}) {
  return REQUEST_KEYS.every((key) => (
    key === "quantity"
      ? Math.max(0, Math.floor(Number(left[key]) || 0)) === Math.max(0, Math.floor(Number(right[key]) || 0))
      : String(left[key] ?? "").trim() === String(right[key] ?? "").trim()
  ));
}

export function normalizeTradeTransaction(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacy = source.legacy === true
    || (!Object.hasOwn(source, "transactionId") && !Object.hasOwn(source, "status"));
  const transactionId = String(source.transactionId ?? source.id ?? "").trim();
  const requestedStatus = String(source.status ?? "").trim();
  const status = Object.values(TRADE_TRANSACTION_STATUS).includes(requestedStatus)
    ? requestedStatus
    : TRADE_TRANSACTION_STATUS.COMMITTED;

  return {
    ...clone(source),
    transactionId,
    legacy,
    kind: source.kind === "sale" || source.type === "sale" ? "sale" : "purchase",
    status,
    phase: String(source.phase ?? (status === "committed" ? "committed" : "prepared")),
    request: Object.fromEntries(REQUEST_KEYS.map((key) => [
      key,
      key === "quantity"
        ? Math.max(1, Math.floor(Number(source.request?.[key] ?? source[key]) || 1))
        : String(source.request?.[key] ?? source[key] ?? "").trim()
    ])),
    result: source.result && typeof source.result === "object" ? clone(source.result) : null,
    error: source.error && typeof source.error === "object" ? clone(source.error) : null,
    compensation: source.compensation && typeof source.compensation === "object"
      ? clone(source.compensation)
      : null,
    rollback: source.rollback && typeof source.rollback === "object" ? clone(source.rollback) : null
  };
}

export function retainTradeLog(rows = [], { terminalLimit = 20 } = {}) {
  const normalized = rows.map((row) => normalizeTradeTransaction(row));
  const nonterminal = normalized.filter((row) => !TERMINAL_TRADE_STATUSES.has(row.status));
  const terminal = normalized
    .filter((row) => TERMINAL_TRADE_STATUSES.has(row.status))
    .sort((left, right) => (
      Number(right.updatedAt ?? right.createdAt ?? 0) - Number(left.updatedAt ?? left.createdAt ?? 0)
    ))
    .slice(0, terminalLimit);

  return [...nonterminal, ...terminal];
}
