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

const CORE_MODERN_TRANSACTION_KEYS = Object.freeze([
  "transactionId",
  "status",
  "phase",
  "kind",
  "request",
  "result",
  "error",
  "compensation"
]);

const RECOVERY_ONLY_TRANSACTION_KEYS = Object.freeze([
  "stock",
  "item",
  "currency",
  "updatedAt",
  "committedAt",
  "compensatedAt"
]);

const RESERVED_TRANSACTION_IDS = new Set([
  "__proto__",
  "prototype",
  "constructor"
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
  constructor(code, message, {
    transactionId = "",
    rollbackTransactionId = "",
    cause = null
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "TradeTransactionError";
    this.code = code;
    this.transactionId = transactionId;
    this.rollbackTransactionId = rollbackTransactionId;
  }
}

export function isValidTradeTransactionId(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9_-]{8,128}$/u.test(value)
    && !RESERVED_TRANSACTION_IDS.has(value.toLowerCase());
}

export function createTradeTransactionId(prefix = "trade") {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "")
    ?? Math.random().toString(36).slice(2, 18);
  const suffix = `${Date.now()}_${random}`;
  const maxPrefixLength = Math.max(0, 128 - suffix.length - 1);
  const normalizedPrefix = String(prefix)
    .replace(/[^A-Za-z0-9_-]/gu, "_")
    .slice(0, maxPrefixLength);
  return `${normalizedPrefix}_${suffix}`;
}

function normalizeRequestQuantity(value) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}

export function requestsMatch(left = {}, right = {}) {
  const leftQuantity = normalizeRequestQuantity(left.quantity);
  const rightQuantity = normalizeRequestQuantity(right.quantity);
  if (leftQuantity == null || rightQuantity == null) {
    return false;
  }

  return REQUEST_KEYS.every((key) => (
    key === "quantity"
      ? leftQuantity === rightQuantity
      : String(left[key] ?? "").trim() === String(right[key] ?? "").trim()
  ));
}

export function normalizeTradeTransaction(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacyId = String(source.id ?? "").trim();
  const legacyType = String(source.type ?? "").trim();
  const hasLegacyAuditShape = Boolean(legacyId)
    && (legacyType === "purchase" || legacyType === "sale");
  const hasCoreModernMarkers = CORE_MODERN_TRANSACTION_KEYS.some((key) => Object.hasOwn(source, key));
  const hasRecoveryFields = RECOVERY_ONLY_TRANSACTION_KEYS.some((key) => Object.hasOwn(source, key));
  const legacy = hasLegacyAuditShape
    && source.legacy !== false
    && !hasRecoveryFields
    && (source.legacy === true || !hasCoreModernMarkers);
  const transactionId = String(source.transactionId ?? source.id ?? "").trim();
  const requestedStatus = String(source.status ?? "").trim();
  const hasValidModernShape = Object.hasOwn(source, "transactionId")
    && isValidTradeTransactionId(transactionId)
    && Object.hasOwn(source, "status")
    && Object.values(TRADE_TRANSACTION_STATUS).includes(requestedStatus);
  const status = legacy
    ? TRADE_TRANSACTION_STATUS.COMMITTED
    : (hasValidModernShape
      ? requestedStatus
      : TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);

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
  const hasNonterminalRollback = (row) => row.rollback
    && typeof row.rollback === "object"
    && !TERMINAL_TRADE_STATUSES.has(String(row.rollback.status ?? ""));
  const nonterminal = normalized.filter((row) => (
    !TERMINAL_TRADE_STATUSES.has(row.status) || hasNonterminalRollback(row)
  ));
  const terminal = normalized
    .filter((row) => TERMINAL_TRADE_STATUSES.has(row.status) && !hasNonterminalRollback(row))
    .sort((left, right) => (
      Number(right.updatedAt ?? right.createdAt ?? 0) - Number(left.updatedAt ?? left.createdAt ?? 0)
    ))
    .slice(0, terminalLimit);

  return [...nonterminal, ...terminal];
}
