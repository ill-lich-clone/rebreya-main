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

function buildCreatedDescriptor(request = REQUEST, {
  itemId = "",
  itemUuid = ""
} = {}) {
  const descriptor = buildDescriptor(request);
  descriptor.item = {
    ...descriptor.item,
    itemId,
    itemUuid,
    beforeQuantity: 0,
    afterQuantity: 1,
    delta: 1,
    created: true
  };
  return descriptor;
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
  afterEffectFailures = {},
  initialReceipts = {},
  createdItemIdentity = {
    itemId: "created-item-sword",
    itemUuid: "Actor.actor-a.Item.created-item-sword"
  },
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
  const currencyTransactions = [];
  const compensatedCurrencyTransactions = [];
  const compensatedItemTransactions = [];
  const receipts = new Map(Object.entries(initialReceipts).map(([transactionId, value]) => [
    transactionId,
    {
      itemApplied: value.itemApplied === true,
      currencyApplied: value.currencyApplied === true,
      itemId: String(value.itemId ?? ""),
      itemUuid: String(value.itemUuid ?? "")
    }
  ]));
  const remainingFailures = new Map(Object.entries(failures).map(([name, count]) => [
    name,
    count === true ? 1 : Number(count)
  ]));
  const remainingAfterEffectFailures = new Map(Object.entries(afterEffectFailures).map(([name, count]) => [
    name,
    count === true ? 1 : Number(count)
  ]));

  function maybeFailFrom(source, name) {
    const remaining = source.get(name) ?? 0;
    if (remaining < 1) return;
    source.set(name, remaining - 1);
    throw new TradeTransactionError(`${name}-failed`, `${name} failed`);
  }

  const maybeFail = (name) => maybeFailFrom(remainingFailures, name);
  const maybeFailAfterEffect = (name) => maybeFailFrom(remainingAfterEffectFailures, name);

  function receiptFor(transactionId) {
    if (!receipts.has(transactionId)) {
      receipts.set(transactionId, {
        itemApplied: false,
        currencyApplied: false,
        itemId: "",
        itemUuid: ""
      });
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
      const receipt = receiptFor(transaction.transactionId);
      receipt.itemApplied = true;
      if (transaction.item.created === true) {
        receipt.itemId = createdItemIdentity.itemId;
        receipt.itemUuid = createdItemIdentity.itemUuid;
      }
      maybeFailAfterEffect("apply-item");
    },
    async applyPurchaseCurrency(transaction) {
      counters.applyCurrency += 1;
      trace.push("apply-currency");
      currencyTransactions.push(clone(transaction));
      if (currencyGate) await currencyGate.promise;
      maybeFail("apply-currency");
      receiptFor(transaction.transactionId).currencyApplied = true;
      maybeFailAfterEffect("apply-currency");
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
      compensatedCurrencyTransactions.push(clone(transaction));
      maybeFail("compensate-currency");
      receiptFor(transaction.transactionId).currencyApplied = false;
      maybeFailAfterEffect("compensate-currency");
    },
    async compensatePurchaseItem(transaction) {
      counters.compensateItem += 1;
      trace.push("compensate-item");
      compensatedItemTransactions.push(clone(transaction));
      maybeFail("compensate-item");
      receiptFor(transaction.transactionId).itemApplied = false;
      maybeFailAfterEffect("compensate-item");
    }
  };

  return {
    compensatedCurrencyTransactions,
    compensatedItemTransactions,
    counters,
    currencyTransactions,
    operations,
    receiptFor,
    trace
  };
}

function createHarness({
  state = buildState(),
  operationsOptions = {},
  readFailures = {},
  writeFailures = {},
  nowStart = 1_000
} = {}) {
  let storedState = clone(state);
  const writes = [];
  let readAttempts = 0;
  let writeAttempts = 0;
  const pendingReadFailures = new Map(Object.entries(readFailures).map(([ordinal, count]) => [
    Number(ordinal),
    count === true ? 1 : Number(count)
  ]));
  const pendingWriteFailures = new Map(Object.entries(writeFailures).map(([ordinal, mode]) => [
    Number(ordinal),
    mode
  ]));
  const game = {
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        assert.equal(key, SETTINGS_KEYS.TRADER_STATE);
        readAttempts += 1;
        const remaining = pendingReadFailures.get(readAttempts) ?? 0;
        if (remaining > 0) {
          pendingReadFailures.set(readAttempts, remaining - 1);
          throw new Error(`settings read ${readAttempts} failed`);
        }
        return storedState;
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        assert.equal(key, SETTINGS_KEYS.TRADER_STATE);
        writeAttempts += 1;
        const failureMode = pendingWriteFailures.get(writeAttempts);
        pendingWriteFailures.delete(writeAttempts);
        if (failureMode === "before-store") {
          throw new Error(`settings write ${writeAttempts} rejected before store`);
        }
        storedState = clone(value);
        writes.push(clone(value));
        if (failureMode === "after-store") {
          throw new Error(`settings write ${writeAttempts} rejected after store`);
        }
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
    get writeAttempts() {
      return writeAttempts;
    },
    get readAttempts() {
      return readAttempts;
    },
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
    readReceipts: 3,
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

test("reserved transaction ids are rejected before purchase preparation or persistence", async () => {
  const calls = { find: 0, mutate: 0, prepare: 0 };
  const service = new TradeTransactionService({
    repository: {
      findTransaction() {
        calls.find += 1;
        throw new Error("repository must not be read");
      },
      mutate() {
        calls.mutate += 1;
        throw new Error("repository must not be mutated");
      }
    },
    operations: {
      preparePurchase() {
        calls.prepare += 1;
        throw new Error("purchase must not be prepared");
      }
    }
  });

  await assert.rejects(
    service.purchase({ ...REQUEST, transactionId: "__proto__" }),
    (error) => {
      assert.equal(error instanceof TradeTransactionError, true);
      assert.equal(error.code, "invalid-request");
      return true;
    }
  );
  assert.deepEqual(calls, { find: 0, mutate: 0, prepare: 0 });
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
  assert.equal(harness.counters.readReceipts, 1);

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

test("reservation write ambiguity is recovered after store and remains typed before store", async () => {
  for (const mode of ["before-store", "after-store"]) {
    const harness = createHarness({ writeFailures: { 1: mode } });

    if (mode === "before-store") {
      await assert.rejects(
        harness.service.purchase({ ...REQUEST }),
        (error) => assertTradeError(error, "transaction-write-failed")
      );
      assert.equal(findTransaction(harness), undefined);
      assert.equal(stockQuantity(harness), 1);
      assert.equal(harness.counters.applyItem, 0);
      assert.equal(harness.counters.applyCurrency, 0);

      const retried = await harness.service.purchase({ ...REQUEST });
      assert.deepEqual(retried, buildDescriptor().result);
      assert.equal(harness.counters.prepare, 2, "same-ID lock must be removed after rejection");
    }
    else {
      const result = await harness.service.purchase({ ...REQUEST });
      assert.deepEqual(result, buildDescriptor().result);
      assert.equal(harness.counters.prepare, 1);
    }

    assert.equal(stockQuantity(harness), 0);
    assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMMITTED);
    assert.equal(harness.counters.applyItem, 1);
    assert.equal(harness.counters.applyCurrency, 1);
    assert.equal(harness.counters.compensateItem, 0);
    assert.equal(harness.counters.compensateCurrency, 0);
  }
});

test("application checkpoint write ambiguity resumes without compensating durable effects", async () => {
  const checkpoints = [
    { name: "item-applied", ordinal: 2 },
    { name: "currency-applied", ordinal: 3 },
    { name: "committed", ordinal: 4 }
  ];

  for (const checkpoint of checkpoints) {
    for (const mode of ["before-store", "after-store"]) {
      const harness = createHarness({ writeFailures: { [checkpoint.ordinal]: mode } });

      const result = await harness.service.purchase({ ...REQUEST });

      assert.deepEqual(result, buildDescriptor().result, `${checkpoint.name} ${mode}`);
      assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMMITTED);
      assert.equal(findTransaction(harness).phase, "committed");
      assert.equal(stockQuantity(harness), 0);
      assert.equal(harness.counters.applyItem, 1);
      assert.equal(harness.counters.applyCurrency, 1);
      assert.equal(harness.counters.compensateCurrency, 0);
      assert.equal(harness.counters.compensateItem, 0);
    }
  }
});

test("an ambiguous currency side effect compensates currency then item then stock", async () => {
  const harness = createHarness({
    operationsOptions: {
      afterEffectFailures: { "apply-currency": 1 }
    }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-compensated")
  );

  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith("apply-") || entry.startsWith("compensate-")),
    ["apply-item", "apply-currency", "compensate-currency", "compensate-item"]
  );
  assert.equal(harness.counters.compensateCurrency, 1);
  assert.equal(harness.counters.compensateItem, 1);
  assert.deepEqual(harness.receiptFor(REQUEST.transactionId), {
    itemApplied: false,
    currencyApplied: false,
    itemId: "",
    itemUuid: ""
  });
  assert.equal(stockQuantity(harness), 1);
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMPENSATED);
});

test("compensation checkpoint write ambiguity resumes from receipts without repeating effects", async () => {
  const checkpoints = [
    { name: "currency-compensated", ordinal: 4 },
    { name: "item-compensated", ordinal: 5 },
    { name: "stock-released", ordinal: 6 }
  ];

  for (const checkpoint of checkpoints) {
    for (const mode of ["before-store", "after-store"]) {
      const harness = createHarness({
        operationsOptions: {
          afterEffectFailures: { "apply-currency": 1 }
        },
        writeFailures: { [checkpoint.ordinal]: mode }
      });

      await assert.rejects(
        harness.service.purchase({ ...REQUEST }),
        (error) => assertTradeError(error, "transaction-compensated")
      );

      assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMPENSATED);
      assert.equal(stockQuantity(harness), 1, `${checkpoint.name} ${mode}`);
      assert.equal(harness.counters.compensateCurrency, 1);
      assert.equal(harness.counters.compensateItem, 1);
      assert.deepEqual(harness.receiptFor(REQUEST.transactionId), {
        itemApplied: false,
        currencyApplied: false,
        itemId: "",
        itemUuid: ""
      });
    }
  }
});

test("purchase descriptors are validated completely before stock reservation", async () => {
  const invalidDescriptors = [
    ["item id", (descriptor) => { descriptor.item.itemId = ""; }],
    ["item uuid", (descriptor) => { descriptor.item.itemUuid = " "; }],
    ["item before integer", (descriptor) => { descriptor.item.beforeQuantity = 1.5; }],
    ["item after nonnegative", (descriptor) => { descriptor.item.afterQuantity = -1; }],
    ["item positive delta", (descriptor) => { descriptor.item.delta = 0; }],
    ["item delta equation", (descriptor) => { descriptor.item.afterQuantity = 4; }],
    ["item created boolean", (descriptor) => { descriptor.item.created = "false"; }],
    ["item raw data", (descriptor) => { descriptor.item.rawItemData = null; }],
    ["currency before integer", (descriptor) => { descriptor.currency.beforeCopper = 500.5; }],
    ["currency after nonnegative", (descriptor) => { descriptor.currency.afterCopper = -1; }],
    ["currency negative purchase delta", (descriptor) => {
      descriptor.currency.afterCopper = 500;
      descriptor.currency.deltaCopper = 0;
      descriptor.result.totalPriceCopper = 0;
    }],
    ["currency delta equation", (descriptor) => { descriptor.currency.afterCopper = 399; }],
    ["result transaction id", (descriptor) => { descriptor.result.transactionId = "trade_purchase_other"; }],
    ["result total", (descriptor) => { descriptor.result.totalPriceCopper = 99; }]
  ];

  for (const [name, mutateDescriptor] of invalidDescriptors) {
    const harness = createHarness({
      operationsOptions: {
        descriptorFactory(request) {
          const descriptor = buildDescriptor(request);
          mutateDescriptor(descriptor);
          return descriptor;
        }
      }
    });

    await assert.rejects(
      harness.service.purchase({ ...REQUEST }),
      (error) => {
        assertTradeError(error, "invalid-purchase-descriptor");
        return true;
      },
      name
    );
    assert.equal(stockQuantity(harness), 1, name);
    assert.equal(harness.state.tradeLog.length, 0, name);
    assert.equal(harness.counters.applyItem, 0, name);
    assert.equal(harness.counters.applyCurrency, 0, name);
  }
});

test("application phases reject every impossible receipt combination", async () => {
  const scenarios = [
    { phase: "stock-reserved", receipts: { itemApplied: false, currencyApplied: true } },
    { phase: "item-applied", receipts: { itemApplied: false, currencyApplied: false } },
    { phase: "item-applied", receipts: { itemApplied: false, currencyApplied: true } },
    { phase: "currency-applied", receipts: { itemApplied: false, currencyApplied: false } },
    { phase: "currency-applied", receipts: { itemApplied: false, currencyApplied: true } },
    { phase: "currency-applied", receipts: { itemApplied: true, currencyApplied: false } }
  ];

  for (const scenario of scenarios) {
    const row = buildTransaction({
      status: scenario.phase === "stock-reserved"
        ? TRADE_TRANSACTION_STATUS.PREPARED
        : TRADE_TRANSACTION_STATUS.APPLYING,
      phase: scenario.phase
    });
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
    assert.equal(harness.counters.applyItem, 0);
    assert.equal(harness.counters.applyCurrency, 0);
  }
});

test("application phases accept every recoverable receipt combination", async () => {
  const scenarios = [
    { phase: "stock-reserved", receipts: { itemApplied: true, currencyApplied: true } },
    { phase: "item-applied", receipts: { itemApplied: true, currencyApplied: true } }
  ];

  for (const scenario of scenarios) {
    const row = buildTransaction({
      status: scenario.phase === "stock-reserved"
        ? TRADE_TRANSACTION_STATUS.PREPARED
        : TRADE_TRANSACTION_STATUS.APPLYING,
      phase: scenario.phase
    });
    const harness = createHarness({
      state: buildState({ stockQuantity: 0, tradeLog: [row] }),
      operationsOptions: {
        initialReceipts: { [REQUEST.transactionId]: scenario.receipts }
      }
    });

    assert.deepEqual(await harness.service.purchase({ ...REQUEST }), buildDescriptor().result);
    assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMMITTED);
    assert.equal(harness.counters.applyItem, 0);
    assert.equal(harness.counters.applyCurrency, 0);
  }
});

test("compensation phases reject contradictory receipts without document mutation", async () => {
  const scenarios = [
    { phase: "compensating", receipts: { itemApplied: false, currencyApplied: true }, stock: 0 },
    { phase: "currency-compensated", receipts: { itemApplied: false, currencyApplied: true }, stock: 0 },
    { phase: "currency-compensated", receipts: { itemApplied: true, currencyApplied: true }, stock: 0 },
    { phase: "item-compensated", receipts: { itemApplied: true, currencyApplied: false }, stock: 0 },
    { phase: "item-compensated", receipts: { itemApplied: false, currencyApplied: true }, stock: 0 },
    { phase: "item-compensated", receipts: { itemApplied: true, currencyApplied: true }, stock: 0 },
    { phase: "stock-released", receipts: { itemApplied: true, currencyApplied: false }, stock: 1 },
    { phase: "stock-released", receipts: { itemApplied: false, currencyApplied: true }, stock: 1 },
    { phase: "stock-released", receipts: { itemApplied: true, currencyApplied: true }, stock: 1 }
  ];

  for (const scenario of scenarios) {
    const row = buildTransaction({
      status: TRADE_TRANSACTION_STATUS.COMPENSATING,
      phase: scenario.phase,
      error: { code: "apply-currency-failed", message: "currency failed", phase: "item-applied" },
      compensation: { phase: scenario.phase, attempts: 1, error: null }
    });
    const harness = createHarness({
      state: buildState({ stockQuantity: scenario.stock, tradeLog: [row] }),
      operationsOptions: {
        initialReceipts: { [REQUEST.transactionId]: scenario.receipts }
      }
    });

    await assert.rejects(
      harness.service.purchase({ ...REQUEST }),
      (error) => assertTradeError(error, "reconciliation-required")
    );
    assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
    assert.equal(harness.counters.compensateCurrency, 0);
    assert.equal(harness.counters.compensateItem, 0);
    assert.equal(stockQuantity(harness), scenario.stock);
  }
});

test("a created purchase persists receipt item identity before debiting currency", async () => {
  const harness = createHarness({
    operationsOptions: {
      descriptorFactory: (request) => buildCreatedDescriptor(request)
    }
  });

  const result = await harness.service.purchase({ ...REQUEST });
  const row = findTransaction(harness);

  assert.deepEqual(result, buildDescriptor().result);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMMITTED);
  assert.equal(row.item.created, true);
  assert.equal(row.item.itemId, "created-item-sword");
  assert.equal(row.item.itemUuid, "Actor.actor-a.Item.created-item-sword");
  assert.equal(harness.counters.applyItem, 1);
  assert.equal(harness.counters.applyCurrency, 1);
  assert.equal(harness.currencyTransactions[0].item.itemId, "created-item-sword");
  assert.equal(
    harness.currencyTransactions[0].item.itemUuid,
    "Actor.actor-a.Item.created-item-sword"
  );
  assert.equal(stockQuantity(harness), 0);
});

test("a created receipt at stock-reserved repairs identity without applying the item twice", async () => {
  const row = buildTransaction({
    status: TRADE_TRANSACTION_STATUS.PREPARED,
    phase: "stock-reserved"
  });
  row.item = buildCreatedDescriptor().item;
  const harness = createHarness({
    state: buildState({ stockQuantity: 0, tradeLog: [row] }),
    operationsOptions: {
      initialReceipts: {
        [REQUEST.transactionId]: {
          itemApplied: true,
          currencyApplied: false,
          itemId: "created-recovered",
          itemUuid: "Actor.actor-a.Item.created-recovered"
        }
      }
    }
  });

  await harness.service.purchase({ ...REQUEST });

  assert.equal(harness.counters.applyItem, 0);
  assert.equal(harness.counters.applyCurrency, 1);
  assert.equal(findTransaction(harness).item.itemId, "created-recovered");
  assert.equal(findTransaction(harness).item.itemUuid, "Actor.actor-a.Item.created-recovered");
  assert.equal(harness.currencyTransactions[0].item.itemId, "created-recovered");
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMMITTED);
  assert.equal(stockQuantity(harness), 0);
});

test("a persisted created item-applied row is repaired from receipts before currency", async () => {
  const row = buildTransaction({ phase: "item-applied" });
  row.item = buildCreatedDescriptor().item;
  const harness = createHarness({
    state: buildState({ stockQuantity: 0, tradeLog: [row] }),
    operationsOptions: {
      initialReceipts: {
        [REQUEST.transactionId]: {
          itemApplied: true,
          currencyApplied: false,
          itemId: "created-checkpoint-repair",
          itemUuid: "Actor.actor-a.Item.created-checkpoint-repair"
        }
      }
    }
  });

  await harness.service.purchase({ ...REQUEST });

  assert.equal(harness.counters.applyItem, 0);
  assert.equal(harness.counters.applyCurrency, 1);
  assert.equal(harness.currencyTransactions[0].item.itemId, "created-checkpoint-repair");
  assert.equal(
    harness.currencyTransactions[0].item.itemUuid,
    "Actor.actor-a.Item.created-checkpoint-repair"
  );
  assert.equal(findTransaction(harness).item.itemId, "created-checkpoint-repair");
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMMITTED);
});

test("a created item-applied receipt without identity reconciles before currency", async () => {
  const row = buildTransaction({ phase: "item-applied" });
  row.item = buildCreatedDescriptor().item;
  const harness = createHarness({
    state: buildState({ stockQuantity: 0, tradeLog: [row] }),
    operationsOptions: {
      initialReceipts: {
        [REQUEST.transactionId]: {
          itemApplied: true,
          currencyApplied: false,
          itemId: "",
          itemUuid: ""
        }
      }
    }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "reconciliation-required")
  );

  assert.equal(harness.counters.applyItem, 0);
  assert.equal(harness.counters.applyCurrency, 0);
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
  assert.equal(findTransaction(harness).error.code, "recovery-item-identity-missing");
  assert.equal(stockQuantity(harness), 0);
});

test("an item-applied receipt with conflicting identity reconciles before currency", async () => {
  const scenarios = [
    buildTransaction({ phase: "item-applied" }),
    (() => {
      const row = buildTransaction({ phase: "item-applied" });
      row.item = buildCreatedDescriptor(REQUEST, {
        itemId: "created-original",
        itemUuid: "Actor.actor-a.Item.created-original"
      }).item;
      return row;
    })()
  ];

  for (const row of scenarios) {
    const harness = createHarness({
      state: buildState({ stockQuantity: 0, tradeLog: [row] }),
      operationsOptions: {
        initialReceipts: {
          [REQUEST.transactionId]: {
            itemApplied: true,
            currencyApplied: false,
            itemId: "conflicting-item",
            itemUuid: "Actor.actor-a.Item.conflicting-item"
          }
        }
      }
    });

    await assert.rejects(
      harness.service.purchase({ ...REQUEST }),
      (error) => assertTradeError(error, "reconciliation-required")
    );
    assert.equal(harness.counters.applyItem, 0);
    assert.equal(harness.counters.applyCurrency, 0);
    assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
    assert.equal(findTransaction(harness).error.code, "recovery-item-identity-conflict");
  }
});

test("created descriptors reject only one preallocated identity field", async () => {
  for (const descriptor of [
    buildCreatedDescriptor(REQUEST, { itemId: "only-id", itemUuid: "" }),
    buildCreatedDescriptor(REQUEST, { itemId: "", itemUuid: "only-uuid" })
  ]) {
    const harness = createHarness({
      operationsOptions: { descriptorFactory: () => descriptor }
    });

    await assert.rejects(
      harness.service.purchase({ ...REQUEST }),
      (error) => assertTradeError(error, "invalid-purchase-descriptor")
    );
    assert.equal(stockQuantity(harness), 1);
    assert.equal(harness.state.tradeLog.length, 0);
    assert.equal(harness.counters.applyItem, 0);
  }
});

test("existing-item descriptors still require both prepared identity fields", async () => {
  const harness = createHarness({
    operationsOptions: {
      descriptorFactory(request) {
        const descriptor = buildDescriptor(request);
        descriptor.item.itemId = "";
        descriptor.item.itemUuid = "";
        return descriptor;
      }
    }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "invalid-purchase-descriptor")
  );
  assert.equal(stockQuantity(harness), 1);
  assert.equal(harness.state.tradeLog.length, 0);
  assert.equal(harness.counters.applyItem, 0);
  assert.equal(harness.counters.applyCurrency, 0);
});

test("created item identity survives compensation after its receipt clears", async () => {
  const harness = createHarness({
    operationsOptions: {
      descriptorFactory: (request) => buildCreatedDescriptor(request),
      failures: { "apply-currency": 1 }
    }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-compensated")
  );

  const row = findTransaction(harness);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMPENSATED);
  assert.equal(row.item.itemId, "created-item-sword");
  assert.equal(row.item.itemUuid, "Actor.actor-a.Item.created-item-sword");
  assert.equal(harness.receiptFor(REQUEST.transactionId).itemApplied, false);
  assert.equal(harness.receiptFor(REQUEST.transactionId).itemId, "created-item-sword");
  assert.equal(
    harness.receiptFor(REQUEST.transactionId).itemUuid,
    "Actor.actor-a.Item.created-item-sword"
  );
  assert.equal(stockQuantity(harness), 1);
});

test("compensation checkpoints created identity before a failing currency reversal", async () => {
  const row = buildTransaction({
    status: TRADE_TRANSACTION_STATUS.COMPENSATING,
    phase: "compensating",
    error: { code: "apply-currency-failed", message: "currency failed", phase: "item-applied" },
    compensation: { phase: "pending", attempts: 1, error: null }
  });
  row.item = buildCreatedDescriptor().item;
  const harness = createHarness({
    state: buildState({ stockQuantity: 0, tradeLog: [row] }),
    operationsOptions: {
      failures: { "compensate-currency": 1 },
      initialReceipts: {
        [REQUEST.transactionId]: {
          itemApplied: true,
          currencyApplied: true,
          itemId: "created-before-compensation",
          itemUuid: "Actor.actor-a.Item.created-before-compensation"
        }
      }
    }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "reconciliation-required")
  );

  const durable = findTransaction(harness);
  assert.equal(durable.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
  assert.equal(durable.item.itemId, "created-before-compensation");
  assert.equal(durable.item.itemUuid, "Actor.actor-a.Item.created-before-compensation");
  assert.equal(harness.compensatedCurrencyTransactions.length, 1);
  assert.equal(
    harness.compensatedCurrencyTransactions[0].item.itemId,
    "created-before-compensation"
  );
  assert.equal(harness.counters.compensateItem, 0);
  assert.deepEqual(harness.receiptFor(REQUEST.transactionId), {
    itemApplied: true,
    currencyApplied: true,
    itemId: "created-before-compensation",
    itemUuid: "Actor.actor-a.Item.created-before-compensation"
  });
  assert.equal(stockQuantity(harness), 0);
});

test("an ambiguous created item application compensates with its persisted receipt identity", async () => {
  const harness = createHarness({
    operationsOptions: {
      descriptorFactory: (request) => buildCreatedDescriptor(request),
      afterEffectFailures: { "apply-item": 1 }
    }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-compensated")
  );

  const row = findTransaction(harness);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMPENSATED);
  assert.equal(row.item.itemId, "created-item-sword");
  assert.equal(row.item.itemUuid, "Actor.actor-a.Item.created-item-sword");
  assert.equal(harness.counters.compensateCurrency, 0);
  assert.equal(harness.counters.compensateItem, 1);
  assert.equal(harness.compensatedItemTransactions[0].item.itemId, "created-item-sword");
  assert.equal(
    harness.compensatedItemTransactions[0].item.itemUuid,
    "Actor.actor-a.Item.created-item-sword"
  );
  assert.equal(harness.receiptFor(REQUEST.transactionId).itemApplied, false);
  assert.equal(harness.receiptFor(REQUEST.transactionId).itemId, "created-item-sword");
  assert.equal(stockQuantity(harness), 1);
});

test("direct purchase reconciliation persists through before-store and lost-ACK writes", async () => {
  for (const mode of ["before-store", "after-store"]) {
    const row = buildTransaction({
      status: TRADE_TRANSACTION_STATUS.APPLYING,
      phase: "item-applied"
    });
    const harness = createHarness({
      state: buildState({ stockQuantity: 0, tradeLog: [row] }),
      writeFailures: { 1: mode }
    });

    await assert.rejects(
      harness.service.purchase({ ...REQUEST }),
      (error) => assertTradeError(error, "reconciliation-required")
    );
    const durable = findTransaction(harness);
    assert.equal(durable.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED, mode);
    assert.equal(durable.error.code, "recovery-receipt-missing", mode);
    const stableEvidence = clone({ error: durable.error, compensation: durable.compensation });
    const counters = clone(harness.counters);

    await assert.rejects(
      harness.service.purchase({ ...REQUEST }),
      (error) => assertTradeError(error, "reconciliation-required")
    );
    assert.deepEqual(
      { error: findTransaction(harness).error, compensation: findTransaction(harness).compensation },
      stableEvidence,
      mode
    );
    assert.deepEqual(harness.counters, counters, mode);
  }
});

test("persistent direct purchase reconciliation loss stays nonterminal with a write error", async () => {
  const row = buildTransaction({
    status: TRADE_TRANSACTION_STATUS.APPLYING,
    phase: "item-applied"
  });
  const harness = createHarness({
    state: buildState({ stockQuantity: 0, tradeLog: [row] }),
    writeFailures: {
      1: "before-store",
      2: "before-store",
      3: "before-store",
      4: "before-store"
    }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-write-failed")
  );
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.APPLYING);
  assert.equal(findTransaction(harness).phase, "item-applied");
  assert.equal(harness.counters.applyItem, 0);
  assert.equal(harness.counters.applyCurrency, 0);
  assert.equal(harness.counters.compensateItem, 0);
  assert.equal(harness.counters.compensateCurrency, 0);

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "reconciliation-required")
  );
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
});

test("purchase compensation-failure reconciliation persists before-store and after-store evidence", async () => {
  for (const mode of ["before-store", "after-store"]) {
    const harness = createHarness({
      operationsOptions: {
        failures: { "apply-currency": 1, "compensate-item": 1 }
      },
      writeFailures: { 5: mode }
    });

    await assert.rejects(
      harness.service.purchase({ ...REQUEST }),
      (error) => assertTradeError(error, "reconciliation-required")
    );
    const durable = findTransaction(harness);
    assert.equal(durable.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED, mode);
    assert.equal(durable.error.code, "apply-currency-failed", mode);
    assert.equal(durable.compensation.error.code, "compensate-item-failed", mode);
    const stableEvidence = clone({ error: durable.error, compensation: durable.compensation });
    const counters = clone(harness.counters);

    await assert.rejects(
      harness.service.purchase({ ...REQUEST }),
      (error) => assertTradeError(error, "reconciliation-required")
    );
    assert.deepEqual(
      { error: findTransaction(harness).error, compensation: findTransaction(harness).compensation },
      stableEvidence,
      mode
    );
    assert.deepEqual(harness.counters, counters, mode);
  }
});

test("persistent purchase compensation reconciliation loss returns a typed nonterminal write error", async () => {
  const harness = createHarness({
    operationsOptions: {
      failures: { "apply-currency": 1, "compensate-item": 1 }
    },
    writeFailures: {
      5: "before-store",
      6: "before-store",
      7: "before-store",
      8: "before-store"
    }
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-write-failed")
  );
  const durable = findTransaction(harness);
  assert.equal(durable.status, TRADE_TRANSACTION_STATUS.COMPENSATING);
  assert.equal(durable.phase, "currency-compensated");
  assert.notEqual(durable.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
  assert.equal(durable.error.code, "apply-currency-failed");
});

test("purchase repository read errors are ID-bearing and a reservation resumes safely", async () => {
  const initialRead = createHarness({ readFailures: { 1: true } });
  await assert.rejects(
    initialRead.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-state-unavailable")
  );
  assert.equal(initialRead.state.tradeLog.length, 0);
  assert.equal(initialRead.counters.prepare, 0);

  const afterReservation = createHarness({ readFailures: { 3: true } });
  await assert.rejects(
    afterReservation.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-state-unavailable")
  );
  assert.equal(findTransaction(afterReservation).status, TRADE_TRANSACTION_STATUS.PREPARED);
  assert.equal(findTransaction(afterReservation).phase, "stock-reserved");
  assert.equal(stockQuantity(afterReservation), 0);
  assert.equal(afterReservation.counters.applyItem, 0);
  assert.equal(afterReservation.counters.applyCurrency, 0);

  assert.deepEqual(
    await afterReservation.service.purchase({ ...REQUEST }),
    buildDescriptor().result
  );
  assert.equal(afterReservation.counters.applyItem, 1);
  assert.equal(afterReservation.counters.applyCurrency, 1);
  assert.equal(findTransaction(afterReservation).status, TRADE_TRANSACTION_STATUS.COMMITTED);
});

test("purchase never returns a committed candidate from an impossible terminal phase", async () => {
  const row = buildTransaction({
    status: TRADE_TRANSACTION_STATUS.COMMITTED,
    phase: "currency-applied"
  });
  const harness = createHarness({
    state: buildState({ stockQuantity: 0, tradeLog: [row] })
  });

  await assert.rejects(
    harness.service.purchase({ ...REQUEST }),
    (error) => assertTradeError(error, "reconciliation-required")
  );
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
  assert.equal(harness.counters.applyItem, 0);
  assert.equal(harness.counters.applyCurrency, 0);
  assert.equal(harness.counters.compensateItem, 0);
  assert.equal(harness.counters.compensateCurrency, 0);
});
