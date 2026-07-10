import test from "node:test";
import assert from "node:assert/strict";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import { normalizeTraderState } from "../scripts/data/trader-service.js";
import {
  TRADE_TRANSACTION_STATUS,
  TradeTransactionError
} from "../scripts/features/trading/trade-transaction-model.js";
import {
  TradeTransactionService
} from "../scripts/features/trading/trade-transaction-service.js";
import {
  TraderStateRepository
} from "../scripts/infrastructure/foundry/trader-state-repository.js";

const TRADER_ID = "city-a::shop-a";
const REQUEST = Object.freeze({
  transactionId: "trade_purchase_001",
  actorId: "actor-a",
  cityId: "city-a",
  traderKey: "shop-a",
  itemKey: "gear:sword",
  quantity: 1,
  requestedByUserId: "player-a"
});
const PERSISTED_REQUEST = Object.freeze({
  actorId: REQUEST.actorId,
  cityId: REQUEST.cityId,
  traderKey: REQUEST.traderKey,
  itemKey: REQUEST.itemKey,
  itemUuid: "",
  quantity: REQUEST.quantity,
  requestedByUserId: REQUEST.requestedByUserId
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

function buildDescriptor(request = REQUEST) {
  return {
    traderId: TRADER_ID,
    stock: { itemKey: request.itemKey },
    item: {
      itemId: "actor-item-sword",
      itemUuid: "Actor.actor-a.Item.actor-item-sword",
      beforeQuantity: 2,
      afterQuantity: 3,
      delta: 1,
      created: false,
      rawItemData: {
        name: "Sword",
        type: "weapon",
        system: { quantity: 1 }
      }
    },
    currency: {
      beforeCopper: 500,
      afterCopper: 400,
      deltaCopper: -100
    },
    result: {
      transactionId: request.transactionId,
      itemKey: request.itemKey,
      quantity: request.quantity,
      totalPriceCopper: 100
    },
    audit: {
      id: `audit-${request.transactionId}`,
      type: "purchase",
      actorName: "Buyer",
      traderName: "Sword Shop",
      itemName: "Sword",
      totalPriceCopper: 100
    }
  };
}

function buildState({ stockQuantity = 1, tradeLog = [] } = {}) {
  return {
    version: 1,
    order: [TRADER_ID],
    traders: {
      [TRADER_ID]: {
        traderId: TRADER_ID,
        cityId: REQUEST.cityId,
        traderKey: REQUEST.traderKey,
        inventory: [{
          itemKey: REQUEST.itemKey,
          name: "Sword",
          quantity: stockQuantity
        }]
      }
    },
    tradeLog
  };
}

function buildTransaction({
  transactionId = REQUEST.transactionId,
  request = REQUEST,
  status = TRADE_TRANSACTION_STATUS.APPLYING,
  phase = "item-applied",
  result = buildDescriptor(request).result,
  error = null,
  compensation = null,
  createdAt = 100,
  updatedAt = 101
} = {}) {
  const descriptor = buildDescriptor(request);
  return {
    ...descriptor.audit,
    transactionId,
    legacy: false,
    kind: "purchase",
    status,
    phase,
    request: clone(request),
    stock: {
      itemKey: request.itemKey,
      before: 1,
      after: 0,
      delta: -request.quantity
    },
    item: clone(descriptor.item),
    currency: clone(descriptor.currency),
    result: clone(result),
    error: clone(error),
    compensation: clone(compensation),
    rollback: null,
    createdAt,
    updatedAt
  };
}

function createOperations({
  descriptorFactory = buildDescriptor,
  failures = {},
  initialReceipts = {},
  currencyGate = null
} = {}) {
  const counters = {
    prepare: 0,
    applyItem: 0,
    applyCurrency: 0,
    readReceipts: 0,
    compensateCurrency: 0,
    compensateItem: 0
  };
  const trace = [];
  const receipts = new Map(Object.entries(initialReceipts).map(([transactionId, value]) => [
    transactionId,
    { itemApplied: value.itemApplied === true, currencyApplied: value.currencyApplied === true }
  ]));
  const remainingFailures = new Map(Object.entries(failures).map(([name, count]) => [
    name,
    count === true ? 1 : Number(count)
  ]));

  function maybeFail(name) {
    const remaining = remainingFailures.get(name) ?? 0;
    if (remaining < 1) return;
    remainingFailures.set(name, remaining - 1);
    throw new TradeTransactionError(`${name}-failed`, `${name} failed`);
  }

  function receiptFor(transactionId) {
    if (!receipts.has(transactionId)) {
      receipts.set(transactionId, { itemApplied: false, currencyApplied: false });
    }
    return receipts.get(transactionId);
  }

  const operations = {
    async preparePurchase(request, context) {
      counters.prepare += 1;
      trace.push("prepare");
      maybeFail("prepare");
      const descriptor = descriptorFactory(request, context);
      return clone(descriptor);
    },
    async applyPurchaseItem(transaction) {
      counters.applyItem += 1;
      trace.push("apply-item");
      maybeFail("apply-item");
      receiptFor(transaction.transactionId).itemApplied = true;
    },
    async applyPurchaseCurrency(transaction) {
      counters.applyCurrency += 1;
      trace.push("apply-currency");
      if (currencyGate) await currencyGate.promise;
      maybeFail("apply-currency");
      receiptFor(transaction.transactionId).currencyApplied = true;
    },
    async readPurchaseReceipts(transaction) {
      counters.readReceipts += 1;
      trace.push("read-receipts");
      maybeFail("read-receipts");
      return clone(receiptFor(transaction.transactionId));
    },
    async compensatePurchaseCurrency(transaction) {
      counters.compensateCurrency += 1;
      trace.push("compensate-currency");
      maybeFail("compensate-currency");
      receiptFor(transaction.transactionId).currencyApplied = false;
    },
    async compensatePurchaseItem(transaction) {
      counters.compensateItem += 1;
      trace.push("compensate-item");
      maybeFail("compensate-item");
      receiptFor(transaction.transactionId).itemApplied = false;
    }
  };

  return {
    counters,
    operations,
    receiptFor,
    trace
  };
}

function createHarness({
  state = buildState(),
  operationsOptions = {},
  nowStart = 1_000
} = {}) {
  let storedState = clone(state);
  const writes = [];
  const game = {
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        assert.equal(key, SETTINGS_KEYS.TRADER_STATE);
        return storedState;
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        assert.equal(key, SETTINGS_KEYS.TRADER_STATE);
        storedState = clone(value);
        writes.push(clone(value));
        return value;
      }
    }
  };
  const repository = new TraderStateRepository({
    coordinator: new WorldMutationCoordinator(),
    gameProvider: () => game,
    normalizeState: normalizeTraderState
  });
  const fake = createOperations(operationsOptions);
  let currentTime = nowStart;
  const service = new TradeTransactionService({
    repository,
    operations: fake.operations,
    now: () => currentTime++
  });

  return {
    ...fake,
    repository,
    service,
    writes,
    get state() {
      return clone(storedState);
    }
  };
}

function findTransaction(harness, transactionId = REQUEST.transactionId) {
  return harness.state.tradeLog.find((row) => row.transactionId === transactionId);
}

function stockQuantity(harness) {
  return harness.state.traders[TRADER_ID].inventory[0].quantity;
}

function assertTradeError(error, code, transactionId = REQUEST.transactionId) {
  assert.equal(error instanceof TradeTransactionError, true);
  assert.equal(error.code, code);
  assert.equal(error.transactionId, transactionId);
  return true;
}

test("purchase reserves stock and commits the trusted descriptor outcome", async () => {
  const harness = createHarness();
  const callerRequest = { ...REQUEST };

  const result = await harness.service.purchase(callerRequest);
  const row = findTransaction(harness);

  assert.deepEqual(result, buildDescriptor().result);
  assert.deepEqual(callerRequest, REQUEST);
  assert.equal(stockQuantity(harness), 0);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMMITTED);
  assert.equal(row.phase, "committed");
  assert.deepEqual(row.request, PERSISTED_REQUEST);
  assert.deepEqual(row.stock, {
    itemKey: REQUEST.itemKey,
    before: 1,
    after: 0,
    delta: -1
  });
  assert.deepEqual(row.item, buildDescriptor().item);
  assert.deepEqual(row.currency, buildDescriptor().currency);
  assert.deepEqual(row.result, buildDescriptor().result);
  assert.equal(row.actorName, "Buyer");
  assert.equal(row.createdAt, 1_000);
  assert.equal(row.updatedAt > row.createdAt, true);
  assert.equal(Number.isInteger(row.committedAt), true);
  assert.deepEqual(harness.counters, {
    prepare: 1,
    applyItem: 1,
    applyCurrency: 1,
    readReceipts: 2,
    compensateCurrency: 0,
    compensateItem: 0
  });
});

test("two concurrent purchase IDs serialize the final stock reservation", async () => {
  const harness = createHarness();
  const firstRequest = { ...REQUEST, transactionId: "trade_purchase_final_a" };
  const secondRequest = { ...REQUEST, transactionId: "trade_purchase_final_b" };

  const outcomes = await Promise.allSettled([
    harness.service.purchase(firstRequest),
    harness.service.purchase(secondRequest)
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assertTradeError(rejected.reason, "stock-unavailable", rejected.reason.transactionId);
  assert.equal(
    [firstRequest.transactionId, secondRequest.transactionId].includes(rejected.reason.transactionId),
    true
  );
  assert.equal(stockQuantity(harness), 0);
  assert.equal(harness.state.traders[TRADER_ID].inventory[0].quantity >= 0, true);
  assert.equal(harness.state.tradeLog.length, 1);
  assert.equal(harness.counters.applyItem, 1);
  assert.equal(harness.counters.applyCurrency, 1);
});

test("a committed duplicate returns a detached stored result without operation calls", async () => {
  const harness = createHarness();
  const firstResult = await harness.service.purchase({ ...REQUEST });
  const countersAfterCommit = clone(harness.counters);
  firstResult.quantity = 999;

  const duplicateResult = await harness.service.purchase({ ...REQUEST });

  assert.deepEqual(duplicateResult, buildDescriptor().result);
  duplicateResult.totalPriceCopper = 0;
  assert.deepEqual(findTransaction(harness).result, buildDescriptor().result);
  assert.deepEqual(harness.counters, countersAfterCommit);
});

test("a duplicate ID with changed immutable identity is rejected before operation calls", async () => {
  const harness = createHarness({ state: buildState({ stockQuantity: 3 }) });
  await harness.service.purchase({ ...REQUEST });
  const countersAfterCommit = clone(harness.counters);

  await assert.rejects(
    harness.service.purchase({ ...REQUEST, quantity: 2 }),
    (error) => assertTradeError(error, "transaction-conflict")
  );
  await assert.rejects(
    harness.service.purchase({ ...REQUEST, actorId: "actor-b" }),
    (error) => assertTradeError(error, "transaction-conflict")
  );
  assert.deepEqual(harness.counters, countersAfterCommit);
  assert.equal(stockQuantity(harness), 2);
});

test("an item application failure restores stock and finishes compensated", async () => {
  const harness = createHarness({
    operationsOptions: { failures: { "apply-item": 1 } }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-compensated")
  );

  const row = findTransaction(harness);
  assert.equal(stockQuantity(harness), 1);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMPENSATED);
  assert.equal(row.phase, "compensated");
  assert.equal(row.error.code, "apply-item-failed");
  assert.equal(row.error.phase, "stock-reserved");
  assert.equal(row.compensation.phase, "compensated");
  assert.equal(harness.counters.compensateItem, 0);
  assert.equal(harness.counters.compensateCurrency, 0);
});

test("a currency failure compensates the item before releasing stock", async () => {
  const harness = createHarness({
    operationsOptions: { failures: { "apply-currency": 1 } }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-compensated")
  );

  assert.equal(stockQuantity(harness), 1);
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMPENSATED);
  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith("apply-") || entry.startsWith("compensate-")),
    ["apply-item", "apply-currency", "compensate-item"]
  );
  assert.equal(harness.receiptFor(REQUEST.transactionId).itemApplied, false);
  assert.equal(harness.counters.compensateCurrency, 0);
});

test("a compensation failure preserves evidence and requires reconciliation", async () => {
  const harness = createHarness({
    operationsOptions: {
      failures: {
        "apply-currency": 1,
        "compensate-item": 1
      }
    }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "reconciliation-required")
  );

  const row = findTransaction(harness);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
  assert.equal(row.error.code, "apply-currency-failed");
  assert.equal(row.compensation.error.code, "compensate-item-failed");
  assert.equal(row.compensation.error.phase, "compensating-item");
  assert.equal(stockQuantity(harness), 0);
  assert.equal(harness.receiptFor(REQUEST.transactionId).itemApplied, true);
});

test("a persisted item-applied transaction resumes without applying the item again", async () => {
  const row = buildTransaction();
  const harness = createHarness({
    state: buildState({ stockQuantity: 0, tradeLog: [row] }),
    operationsOptions: {
      initialReceipts: {
        [REQUEST.transactionId]: { itemApplied: true, currencyApplied: false }
      }
    }
  });

  const result = await harness.service.purchase({ ...REQUEST });

  assert.deepEqual(result, buildDescriptor().result);
  assert.equal(harness.counters.prepare, 0);
  assert.equal(harness.counters.applyItem, 0);
  assert.equal(harness.counters.applyCurrency, 1);
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMMITTED);
});

test("an item receipt repairs a stock-reserved checkpoint without duplicating the item", async () => {
  const row = buildTransaction({
    status: TRADE_TRANSACTION_STATUS.PREPARED,
    phase: "stock-reserved"
  });
  const harness = createHarness({
    state: buildState({ stockQuantity: 0, tradeLog: [row] }),
    operationsOptions: {
      initialReceipts: {
        [REQUEST.transactionId]: { itemApplied: true, currencyApplied: false }
      }
    }
  });

  await harness.service.purchase({ ...REQUEST });

  assert.equal(harness.counters.prepare, 0);
  assert.equal(harness.counters.applyItem, 0);
  assert.equal(harness.counters.applyCurrency, 1);
  assert.equal(findTransaction(harness).phase, "committed");
});

test("terminal compensated and reconciliation duplicates never touch operation ports", async () => {
  const compensatedRow = buildTransaction({
    status: TRADE_TRANSACTION_STATUS.COMPENSATED,
    phase: "compensated",
    error: { code: "apply-item-failed", message: "apply-item failed", phase: "stock-reserved" },
    compensation: { phase: "compensated", attempts: 1, error: null }
  });
  const compensated = createHarness({
    state: buildState({ tradeLog: [compensatedRow] })
  });

  await assert.rejects(
    compensated.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-compensated")
  );
  assert.deepEqual(compensated.counters, {
    prepare: 0,
    applyItem: 0,
    applyCurrency: 0,
    readReceipts: 0,
    compensateCurrency: 0,
    compensateItem: 0
  });

  const reconciliationRow = buildTransaction({
    transactionId: "trade_purchase_reconcile",
    request: { ...REQUEST, transactionId: "trade_purchase_reconcile" },
    status: TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED,
    phase: "compensating-item-failed",
    error: { code: "apply-currency-failed", message: "currency failed", phase: "item-applied" },
    compensation: {
      phase: "compensating-item-failed",
      attempts: 1,
      error: { code: "compensate-item-failed", message: "item restore failed", phase: "compensating-item" }
    }
  });
  const reconciliation = createHarness({
    state: buildState({ tradeLog: [reconciliationRow] })
  });
  const reconcileRequest = { ...REQUEST, transactionId: "trade_purchase_reconcile" };

  await assert.rejects(
    reconciliation.service.purchase(reconcileRequest),
    (error) => assertTradeError(error, "reconciliation-required", reconcileRequest.transactionId)
  );
  assert.equal(reconciliation.counters.prepare, 0);
  assert.equal(reconciliation.counters.readReceipts, 0);
});

test("concurrent same-ID calls share one reservation and one document application", async () => {
  const harness = createHarness();

  const [first, second] = await Promise.all([
    harness.service.purchase({ ...REQUEST }),
    harness.service.purchase({ ...REQUEST })
  ]);

  assert.deepEqual(first, buildDescriptor().result);
  assert.deepEqual(second, buildDescriptor().result);
  assert.equal(stockQuantity(harness), 0);
  assert.equal(harness.state.tradeLog.length, 1);
  assert.equal(harness.counters.prepare, 1);
  assert.equal(harness.counters.applyItem, 1);
  assert.equal(harness.counters.applyCurrency, 1);
});

test("invalid purchase requests fail before repository and operation access", async () => {
  const calls = { find: 0, mutate: 0, operation: 0 };
  const repository = {
    findTransaction() {
      calls.find += 1;
      throw new Error("repository must not be read");
    },
    mutate() {
      calls.mutate += 1;
      throw new Error("repository must not be mutated");
    }
  };
  const operations = Object.fromEntries([
    "preparePurchase",
    "applyPurchaseItem",
    "applyPurchaseCurrency",
    "readPurchaseReceipts",
    "compensatePurchaseCurrency",
    "compensatePurchaseItem"
  ].map((name) => [name, () => {
    calls.operation += 1;
    throw new Error(`${name} must not be called`);
  }]));
  const service = new TradeTransactionService({ repository, operations });
  const invalidRequests = [
    { ...REQUEST, transactionId: "bad id" },
    { ...REQUEST, actorId: " " },
    { ...REQUEST, cityId: null },
    { ...REQUEST, traderKey: "" },
    { ...REQUEST, itemKey: [] },
    { ...REQUEST, requestedByUserId: "\t" },
    { ...REQUEST, quantity: 0 },
    { ...REQUEST, quantity: 1.5 },
    { ...REQUEST, quantity: "1" },
    { ...REQUEST, totalPriceCopper: 100 }
  ];

  for (const invalidRequest of invalidRequests) {
    await assert.rejects(
      service.purchase(invalidRequest),
      (error) => {
        assert.equal(error instanceof TradeTransactionError, true);
        assert.equal(error.code, "invalid-request");
        return true;
      }
    );
  }
  assert.deepEqual(calls, { find: 0, mutate: 0, operation: 0 });
});

test("trusted audit fields cannot overwrite protected transaction fields", async () => {
  const protectedKeys = [
    "transactionId",
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
  ];
  const harness = createHarness({
    operationsOptions: {
      descriptorFactory(request) {
        const descriptor = buildDescriptor(request);
        descriptor.audit = {
          ...descriptor.audit,
          ...Object.fromEntries(protectedKeys.map((key) => [key, "malicious-overwrite"])),
          trustedLabel: "preserved"
        };
        return descriptor;
      }
    }
  });

  await harness.service.purchase({ ...REQUEST });
  const row = findTransaction(harness);

  assert.equal(row.transactionId, REQUEST.transactionId);
  assert.equal(row.legacy, false);
  assert.equal(row.kind, "purchase");
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMMITTED);
  assert.equal(row.phase, "committed");
  assert.deepEqual(row.request, PERSISTED_REQUEST);
  assert.deepEqual(row.stock, { itemKey: REQUEST.itemKey, before: 1, after: 0, delta: -1 });
  assert.deepEqual(row.item, buildDescriptor().item);
  assert.deepEqual(row.currency, buildDescriptor().currency);
  assert.deepEqual(row.result, buildDescriptor().result);
  assert.equal(row.error, null);
  assert.equal(row.compensation, null);
  assert.equal(row.rollback, null);
  assert.equal(Number.isInteger(row.createdAt), true);
  assert.equal(Number.isInteger(row.updatedAt), true);
  assert.equal(Number.isInteger(row.committedAt), true);
  assert.equal(row.compensatedAt, undefined);
  assert.equal(row.trustedLabel, "preserved");
});

test("resuming after a checkpointed stock release never releases stock twice", async () => {
  const row = buildTransaction({
    status: TRADE_TRANSACTION_STATUS.COMPENSATING,
    phase: "stock-released",
    error: { code: "apply-currency-failed", message: "currency failed", phase: "item-applied" },
    compensation: { phase: "stock-released", attempts: 1, error: null }
  });
  const harness = createHarness({
    state: buildState({ stockQuantity: 1, tradeLog: [row] }),
    operationsOptions: {
      initialReceipts: {
        [REQUEST.transactionId]: { itemApplied: false, currencyApplied: false }
      }
    }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-compensated")
  );
  assert.equal(stockQuantity(harness), 1);
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMPENSATED);

  const countersAfterResume = clone(harness.counters);
  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-compensated")
  );
  assert.equal(stockQuantity(harness), 1);
  assert.deepEqual(harness.counters, countersAfterResume);
});

test("a persisted currency-applied row commits its original result without preparation", async () => {
  const originalResult = {
    transactionId: REQUEST.transactionId,
    itemKey: REQUEST.itemKey,
    quantity: 1,
    totalPriceCopper: 137,
    originalLabel: "price-at-reservation"
  };
  const row = buildTransaction({ phase: "currency-applied", result: originalResult });
  const harness = createHarness({
    state: buildState({ stockQuantity: 0, tradeLog: [row] }),
    operationsOptions: {
      descriptorFactory() {
        throw new Error("persisted transaction must not be prepared again");
      },
      initialReceipts: {
        [REQUEST.transactionId]: { itemApplied: true, currencyApplied: true }
      }
    }
  });

  const result = await harness.service.purchase({ ...REQUEST });

  assert.deepEqual(result, originalResult);
  assert.equal(harness.counters.prepare, 0);
  assert.equal(harness.counters.applyItem, 0);
  assert.equal(harness.counters.applyCurrency, 0);
  assert.deepEqual(findTransaction(harness).result, originalResult);
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMMITTED);
});

test("persisted checkpoints with missing required receipts fail closed for reconciliation", async () => {
  const scenarios = [
    {
      phase: "item-applied",
      receipts: { itemApplied: false, currencyApplied: false }
    },
    {
      phase: "currency-applied",
      receipts: { itemApplied: true, currencyApplied: false }
    }
  ];

  for (const scenario of scenarios) {
    const row = buildTransaction({ phase: scenario.phase });
    const harness = createHarness({
      state: buildState({ stockQuantity: 0, tradeLog: [row] }),
      operationsOptions: {
        initialReceipts: { [REQUEST.transactionId]: scenario.receipts }
      }
    });

    await assert.rejects(
      harness.service.purchase({ ...REQUEST }),
      (error) => assertTradeError(error, "reconciliation-required")
    );

    assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
    assert.equal(findTransaction(harness).error.code, "recovery-receipt-missing");
    assert.equal(findTransaction(harness).error.phase, scenario.phase);
    assert.equal(harness.counters.prepare, 0);
    assert.equal(harness.counters.applyItem, 0);
    assert.equal(harness.counters.applyCurrency, 0);
  }
});

test("a nonterminal persisted result is not returned before the commit checkpoint", async () => {
  const currencyGate = createDeferred();
  const row = buildTransaction();
  const harness = createHarness({
    state: buildState({ stockQuantity: 0, tradeLog: [row] }),
    operationsOptions: {
      currencyGate,
      initialReceipts: {
        [REQUEST.transactionId]: { itemApplied: true, currencyApplied: false }
      }
    }
  });
  let settled = false;
  const pending = harness.service.purchase({ ...REQUEST }).finally(() => {
    settled = true;
  });

  await flushTasks();
  assert.equal(settled, false);
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.APPLYING);
  assert.deepEqual(findTransaction(harness).result, buildDescriptor().result);

  currencyGate.resolve();
  assert.deepEqual(await pending, buildDescriptor().result);
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMMITTED);
});
