import test from "node:test";
import assert from "node:assert/strict";

import {
  TRADE_TRANSACTION_STATUS,
  TERMINAL_TRADE_STATUSES,
  TradeTransactionError,
  createTradeTransactionId,
  isValidTradeTransactionId,
  normalizeTradeTransaction,
  requestsMatch,
  retainTradeLog
} from "../scripts/features/trading/trade-transaction-model.js";

test("trade transaction statuses expose the durable state machine values", () => {
  assert.deepEqual(TRADE_TRANSACTION_STATUS, {
    PREPARED: "prepared",
    APPLYING: "applying",
    COMMITTED: "committed",
    COMPENSATING: "compensating",
    COMPENSATED: "compensated",
    RECONCILIATION_REQUIRED: "reconciliation-required"
  });
  assert.equal(Object.isFrozen(TRADE_TRANSACTION_STATUS), true);
  assert.deepEqual([...TERMINAL_TRADE_STATUSES], ["committed", "compensated"]);
});

test("TradeTransactionError carries its code, transaction id, and cause", () => {
  const cause = new Error("write failed");
  const error = new TradeTransactionError("commit-failed", "Could not commit", {
    transactionId: "trade_12345678",
    cause
  });

  assert.equal(error.name, "TradeTransactionError");
  assert.equal(error.message, "Could not commit");
  assert.equal(error.code, "commit-failed");
  assert.equal(error.transactionId, "trade_12345678");
  assert.equal(error.cause, cause);
});

test("trade transaction ids are sanitized, bounded, and valid", () => {
  const transactionId = createTradeTransactionId("sale bad/prefix");

  assert.match(transactionId, /^sale_bad_prefix_/u);
  assert.equal(isValidTradeTransactionId(transactionId), true);
  assert.equal(transactionId.length <= 128, true);
  assert.equal(isValidTradeTransactionId("short"), false);
  assert.equal(isValidTradeTransactionId("invalid id with spaces"), false);
  assert.equal(isValidTradeTransactionId(null), false);
});

test("trade transaction ids reject reserved object property names", () => {
  for (const transactionId of ["__proto__", "prototype", "constructor", "CONSTRUCTOR"]) {
    assert.equal(isValidTradeTransactionId(transactionId), false, transactionId);
  }
});

test("trade transaction ids preserve entropy after an oversized prefix", () => {
  const oversizedPrefix = "x".repeat(256);

  const first = createTradeTransactionId(oversizedPrefix);
  const second = createTradeTransactionId(oversizedPrefix);

  assert.notEqual(first, second);
  assert.match(first, /_\d+_[A-Za-z0-9]+$/u);
  assert.match(second, /_\d+_[A-Za-z0-9]+$/u);
  assert.equal(isValidTradeTransactionId(first), true);
  assert.equal(isValidTradeTransactionId(second), true);
  assert.equal(first.length <= 128, true);
  assert.equal(second.length <= 128, true);
});

test("requestsMatch compares only normalized request identity fields", () => {
  assert.equal(requestsMatch(
    { actorId: " a ", itemKey: "i", quantity: "1", ignored: "left" },
    { quantity: 1, itemKey: "i", actorId: "a", ignored: "right" }
  ), true);
  assert.equal(requestsMatch(
    { actorId: "a", itemKey: "i", quantity: 1 },
    { actorId: "a", itemKey: "different", quantity: 1 }
  ), false);
});

test("requestsMatch rejects invalid quantities even when their coerced values match", () => {
  for (const [leftQuantity, rightQuantity] of [
    [1.9, 1],
    [-1, 0],
    [-1, -1],
    [0, 0],
    ["not-a-number", "not-a-number"]
  ]) {
    assert.equal(requestsMatch(
      { actorId: "a", itemKey: "i", quantity: leftQuantity },
      { actorId: "a", itemKey: "i", quantity: rightQuantity }
    ), false, `${leftQuantity} must not match ${rightQuantity}`);
  }
});

test("normalizeTradeTransaction upgrades and preserves legacy audit rows", () => {
  const rollback = { restored: true };
  const legacy = normalizeTradeTransaction({
    id: "legacy-1",
    type: "purchase",
    actorId: " actor-1 ",
    quantity: "2.8",
    totalCopper: 125,
    label: "Old purchase",
    rollback
  });

  assert.equal(legacy.status, "committed");
  assert.equal(legacy.transactionId, "legacy-1");
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.kind, "purchase");
  assert.equal(legacy.phase, "committed");
  assert.equal(legacy.request.actorId, "actor-1");
  assert.equal(legacy.request.quantity, 2);
  assert.equal(legacy.totalCopper, 125);
  assert.equal(legacy.label, "Old purchase");
  assert.deepEqual(legacy.rollback, { restored: true });
  assert.notEqual(legacy.rollback, rollback);

  const normalizedAgain = normalizeTradeTransaction(legacy);
  assert.equal(normalizedAgain.legacy, true);
  assert.equal(normalizedAgain.transactionId, "legacy-1");
  assert.equal(normalizedAgain.status, "committed");
});

test("normalizeTradeTransaction sends malformed modern rows to reconciliation", () => {
  const fixtures = [
    {
      name: "missing status",
      source: {
        transactionId: "modern_missing_status",
        kind: "purchase",
        request: { quantity: 1 }
      }
    },
    {
      name: "invalid status",
      source: {
        transactionId: "modern_invalid_status",
        status: "done",
        request: { quantity: 1 }
      }
    },
    {
      name: "missing explicit transaction id",
      source: {
        id: "partial_modern_0001",
        type: "purchase",
        status: "committed",
        request: { quantity: 1 }
      }
    },
    {
      name: "modern phase on an audit-shaped row",
      source: {
        id: "partial_modern_0002",
        type: "sale",
        phase: "item-applied",
        request: { quantity: 1 }
      }
    },
    {
      name: "invalid legacy audit type",
      source: {
        id: "ambiguous_legacy_01",
        type: "refund",
        quantity: 1
      }
    }
  ];

  for (const { name, source } of fixtures) {
    const normalized = normalizeTradeTransaction(source);
    assert.equal(normalized.legacy, false, name);
    assert.equal(
      normalized.status,
      TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED,
      name
    );
  }
});

test("normalizeTradeTransaction canonicalizes modern rows and clones nested data", () => {
  const source = {
    transactionId: " tx-modern ",
    status: "applying",
    type: "purchase",
    kind: "sale",
    phase: 42,
    request: {
      actorId: " actor-2 ",
      cityId: " city-1 ",
      traderKey: " trader-1 ",
      itemKey: " item-1 ",
      itemUuid: " Item.1 ",
      quantity: 0,
      requestedByUserId: " user-1 "
    },
    result: { amount: 10 },
    error: { code: "temporary" },
    compensation: { attempted: false },
    rollback: { available: true }
  };

  const normalized = normalizeTradeTransaction(source);

  assert.equal(normalized.transactionId, "tx-modern");
  assert.equal(normalized.legacy, false);
  assert.equal(normalized.kind, "sale");
  assert.equal(normalized.status, "applying");
  assert.equal(normalized.phase, "42");
  assert.deepEqual(normalized.request, {
    actorId: "actor-2",
    cityId: "city-1",
    traderKey: "trader-1",
    itemKey: "item-1",
    itemUuid: "Item.1",
    quantity: 1,
    requestedByUserId: "user-1"
  });
  assert.deepEqual(normalized.result, { amount: 10 });
  assert.deepEqual(normalized.error, { code: "temporary" });
  assert.deepEqual(normalized.compensation, { attempted: false });
  assert.deepEqual(normalized.rollback, { available: true });
  assert.notEqual(normalized.result, source.result);
  assert.notEqual(normalized.error, source.error);
  assert.notEqual(normalized.compensation, source.compensation);
  assert.notEqual(normalized.rollback, source.rollback);
});

test("normalizeTradeTransaction uses the JSON clone fallback when Foundry and structuredClone are unavailable", () => {
  const previousFoundry = globalThis.foundry;
  const previousStructuredClone = globalThis.structuredClone;
  globalThis.foundry = undefined;
  globalThis.structuredClone = undefined;

  try {
    const source = { id: "legacy-json", result: { ok: true } };
    const normalized = normalizeTradeTransaction(source);
    assert.deepEqual(normalized.result, { ok: true });
    assert.notEqual(normalized.result, source.result);
  }
  finally {
    globalThis.foundry = previousFoundry;
    globalThis.structuredClone = previousStructuredClone;
  }
});

test("retainTradeLog keeps all nonterminal rows and the newest twenty terminal rows", () => {
  const terminalRows = Array.from({ length: 23 }, (_value, index) => ({
    transactionId: `terminal_${String(index).padStart(8, "0")}`,
    status: index % 2 === 0 ? "committed" : "compensated",
    updatedAt: index + 1,
    request: { quantity: 1 }
  }));
  const nonterminalRows = [
    {
      transactionId: "prepared_00000001",
      status: "prepared",
      updatedAt: 1,
      request: { quantity: 1 }
    },
    {
      transactionId: "reconcile_000001",
      status: "reconciliation-required",
      updatedAt: 2,
      request: { quantity: 1 }
    }
  ];

  const retained = retainTradeLog([...terminalRows, ...nonterminalRows]);

  assert.equal(retained.length, 22);
  assert.deepEqual(
    retained.slice(0, 2).map((row) => row.transactionId),
    ["prepared_00000001", "reconcile_000001"]
  );
  assert.deepEqual(
    retained.slice(2).map((row) => row.updatedAt),
    Array.from({ length: 20 }, (_value, index) => 23 - index)
  );
  assert.equal(retained.some((row) => row.transactionId === "terminal_00000000"), false);
  assert.equal(retained.every((row) => Object.hasOwn(row, "request")), true);
});

test("retainTradeLog never prunes malformed modern rows behind newer terminals", () => {
  const malformedRows = [
    {
      transactionId: "malformed_status_001",
      status: "unknown",
      updatedAt: 1,
      request: { quantity: 1 }
    },
    {
      id: "partial_modern_0003",
      type: "purchase",
      status: "committed",
      updatedAt: 2,
      request: { quantity: 1 }
    }
  ];
  const terminalRows = Array.from({ length: 23 }, (_value, index) => ({
    transactionId: `new_terminal_${String(index).padStart(8, "0")}`,
    status: "committed",
    updatedAt: 100 + index,
    request: { quantity: 1 }
  }));

  const retained = retainTradeLog([...malformedRows, ...terminalRows]);

  assert.equal(retained.length, 22);
  assert.deepEqual(
    retained.slice(0, 2).map((row) => [row.transactionId, row.status]),
    [
      ["malformed_status_001", "reconciliation-required"],
      ["partial_modern_0003", "reconciliation-required"]
    ]
  );
  assert.equal(
    retained.filter((row) => TERMINAL_TRADE_STATUSES.has(row.status)).length,
    20
  );
});

test("retainTradeLog keeps recovery-shaped and explicitly nonlegacy audit rows nonterminal", () => {
  const malformedRows = [
    {
      id: "partial_stock_0001",
      type: "purchase",
      legacy: true,
      stock: { before: 1, after: 0 }
    },
    {
      id: "partial_item_00001",
      type: "purchase",
      legacy: true,
      item: { beforeQuantity: 0, afterQuantity: 1 }
    },
    {
      id: "partial_currency_1",
      type: "sale",
      legacy: true,
      currency: { beforeCopper: 0, afterCopper: 10 }
    },
    {
      id: "partial_committed_1",
      type: "purchase",
      legacy: true,
      committedAt: 4
    },
    {
      id: "partial_compensated_1",
      type: "sale",
      legacy: true,
      compensatedAt: 5
    },
    {
      id: "partial_updated_0001",
      type: "purchase",
      legacy: true,
      updatedAt: 6
    },
    {
      id: "explicit_nonlegacy_1",
      type: "purchase",
      legacy: false
    }
  ];
  const terminalRows = Array.from({ length: 20 }, (_value, index) => ({
    transactionId: `latest_terminal_${String(index).padStart(8, "0")}`,
    status: "committed",
    updatedAt: 100 + index,
    request: { quantity: 1 }
  }));

  const retained = retainTradeLog([...malformedRows, ...terminalRows]);

  assert.equal(retained.length, malformedRows.length + terminalRows.length);
  assert.deepEqual(
    retained.slice(0, malformedRows.length).map((row) => ({
      legacy: row.legacy,
      status: row.status,
      transactionId: row.transactionId
    })),
    malformedRows.map((row) => ({
      legacy: false,
      status: "reconciliation-required",
      transactionId: row.id
    }))
  );
  assert.equal(
    retained.filter((row) => TERMINAL_TRADE_STATUSES.has(row.status)).length,
    20
  );
});
