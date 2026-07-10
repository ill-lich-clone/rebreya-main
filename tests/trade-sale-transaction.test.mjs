import test from "node:test";
import assert from "node:assert/strict";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import { normalizeTraderState } from "../scripts/data/trader-service.js";
import {
  TRADE_TRANSACTION_STATUS,
  TradeTransactionError
} from "../scripts/features/trading/trade-transaction-model.js";
import { TradeTransactionService } from "../scripts/features/trading/trade-transaction-service.js";
import { TraderStateRepository } from "../scripts/infrastructure/foundry/trader-state-repository.js";

const TRADER_ID = "city-a::shop-a";
const REQUEST = Object.freeze({
  transactionId: "trade_sale_001",
  actorId: "actor-a",
  cityId: "city-a",
  traderKey: "shop-a",
  itemUuid: "Actor.actor-a.Item.owned-sword",
  quantity: 2,
  requestedByUserId: "player-a"
});
const PERSISTED_REQUEST = Object.freeze({
  actorId: REQUEST.actorId,
  cityId: REQUEST.cityId,
  traderKey: REQUEST.traderKey,
  itemKey: "",
  itemUuid: REQUEST.itemUuid,
  quantity: REQUEST.quantity,
  requestedByUserId: REQUEST.requestedByUserId
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createDeferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function buildDescriptor(request = REQUEST) {
  const beforeQuantity = 5;
  const payout = 75 * request.quantity;
  return {
    traderId: TRADER_ID,
    item: {
      itemId: "owned-sword",
      itemUuid: request.itemUuid,
      beforeQuantity,
      afterQuantity: beforeQuantity - request.quantity,
      delta: -request.quantity,
      created: false,
      rawItemData: {
        name: "Sword",
        type: "weapon",
        system: { quantity: beforeQuantity }
      }
    },
    currency: {
      beforeCopper: 200,
      afterCopper: 200 + payout,
      deltaCopper: payout
    },
    result: {
      transactionId: request.transactionId,
      itemUuid: request.itemUuid,
      quantity: request.quantity,
      netPayoutCopper: payout,
      totalCopper: payout
    },
    audit: {
      id: `audit-${request.transactionId}`,
      type: "sale",
      actorName: "Seller",
      traderName: "Sword Shop",
      itemName: "Sword",
      totalCopper: payout
    }
  };
}

function buildState({ tradeLog = [] } = {}) {
  return {
    version: 1,
    order: [TRADER_ID],
    traders: {
      [TRADER_ID]: {
        traderId: TRADER_ID,
        cityId: REQUEST.cityId,
        traderKey: REQUEST.traderKey,
        inventory: [{ itemKey: "gear:existing", name: "Existing", quantity: 7 }]
      }
    },
    tradeLog
  };
}

function buildTransaction({
  request = REQUEST,
  kind = "sale",
  status = TRADE_TRANSACTION_STATUS.APPLYING,
  phase = "item-removed",
  error = null,
  compensation = null,
  createdAt = 100,
  updatedAt = 101
} = {}) {
  const descriptor = buildDescriptor(request);
  return {
    ...descriptor.audit,
    transactionId: request.transactionId,
    traderId: descriptor.traderId,
    legacy: false,
    kind,
    status,
    phase,
    request: clone(request),
    stock: null,
    item: clone(descriptor.item),
    currency: clone(descriptor.currency),
    result: clone(descriptor.result),
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
  const appliedItemTransactions = [];
  const appliedCurrencyTransactions = [];
  const compensatedCurrencyTransactions = [];
  const compensatedItemTransactions = [];
  const receipts = new Map(Object.entries(initialReceipts).map(([transactionId, value]) => [
    transactionId,
    {
      itemRemoved: value.itemRemoved === true,
      currencyApplied: value.currencyApplied === true
    }
  ]));
  const remainingFailures = new Map(Object.entries(failures).map(([name, count]) => [
    name,
    count === true ? 1 : Number(count)
  ]));
  const remainingAfterEffectFailures = new Map(
    Object.entries(afterEffectFailures).map(([name, count]) => [
      name,
      count === true ? 1 : Number(count)
    ])
  );

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
      receipts.set(transactionId, { itemRemoved: false, currencyApplied: false });
    }
    return receipts.get(transactionId);
  }

  const operations = {
    async prepareSale(request, context) {
      counters.prepare += 1;
      trace.push("prepare");
      maybeFail("prepare");
      return clone(descriptorFactory(request, context));
    },
    async applySaleItem(transaction) {
      counters.applyItem += 1;
      trace.push("apply-item");
      appliedItemTransactions.push(clone(transaction));
      maybeFail("apply-item");
      receiptFor(transaction.transactionId).itemRemoved = true;
      maybeFailAfterEffect("apply-item");
    },
    async applySaleCurrency(transaction) {
      counters.applyCurrency += 1;
      trace.push("apply-currency");
      appliedCurrencyTransactions.push(clone(transaction));
      currencyGate?.entered?.resolve();
      if (currencyGate) await currencyGate.promise;
      maybeFail("apply-currency");
      receiptFor(transaction.transactionId).currencyApplied = true;
      maybeFailAfterEffect("apply-currency");
    },
    async readSaleReceipts(transaction) {
      counters.readReceipts += 1;
      trace.push("read-receipts");
      maybeFail("read-receipts");
      return clone(receiptFor(transaction.transactionId));
    },
    async compensateSaleCurrency(transaction) {
      counters.compensateCurrency += 1;
      trace.push("compensate-currency");
      compensatedCurrencyTransactions.push(clone(transaction));
      maybeFail("compensate-currency");
      receiptFor(transaction.transactionId).currencyApplied = false;
      maybeFailAfterEffect("compensate-currency");
    },
    async compensateSaleItem(transaction) {
      counters.compensateItem += 1;
      trace.push("compensate-item");
      compensatedItemTransactions.push(clone(transaction));
      maybeFail("compensate-item");
      receiptFor(transaction.transactionId).itemRemoved = false;
      maybeFailAfterEffect("compensate-item");
    }
  };

  return {
    appliedCurrencyTransactions,
    appliedItemTransactions,
    compensatedCurrencyTransactions,
    compensatedItemTransactions,
    counters,
    operations,
    receiptFor,
    trace
  };
}

function createHarness({
  state = buildState(),
  operationsOptions = {},
  writeFailures = {},
  nowStart = 2_000
} = {}) {
  let storedState = clone(state);
  const writes = [];
  let writeAttempts = 0;
  const pendingWriteFailures = new Map(Object.entries(writeFailures).map(([ordinal, mode]) => [
    Number(ordinal),
    mode
  ]));
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
    get state() {
      return clone(storedState);
    },
    get writeAttempts() {
      return writeAttempts;
    }
  };
}

function findTransaction(harness, transactionId = REQUEST.transactionId) {
  return harness.state.tradeLog.find((row) => row.transactionId === transactionId);
}

function assertTradeError(error, code, transactionId = REQUEST.transactionId) {
  assert.equal(error instanceof TradeTransactionError, true);
  assert.equal(error.code, code);
  assert.equal(error.transactionId, transactionId);
  return true;
}

test("partial sale commits exact trusted deltas after item removal and never changes stock", async () => {
  const harness = createHarness();
  const callerRequest = { ...REQUEST };
  const tradersBefore = clone(harness.state.traders);

  const result = await harness.service.sale(callerRequest, { source: "test" });
  const row = findTransaction(harness);

  assert.deepEqual(result, buildDescriptor().result);
  assert.deepEqual(callerRequest, REQUEST);
  assert.equal(row.kind, "sale");
  assert.equal(row.legacy, false);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMMITTED);
  assert.equal(row.phase, "committed");
  assert.deepEqual(row.request, PERSISTED_REQUEST);
  assert.equal(row.stock, null);
  assert.deepEqual(row.item, buildDescriptor().item);
  assert.deepEqual(row.currency, buildDescriptor().currency);
  assert.deepEqual(row.result, buildDescriptor().result);
  assert.equal(row.actorName, "Seller");
  assert.equal(row.createdAt, 2_000);
  assert.equal(row.updatedAt > row.createdAt, true);
  assert.equal(Number.isInteger(row.committedAt), true);
  assert.deepEqual(harness.state.traders, tradersBefore);
  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith("apply-")),
    ["apply-item", "apply-currency"]
  );
  assert.equal(harness.counters.prepare, 1);
  assert.equal(harness.counters.applyItem, 1);
  assert.equal(harness.counters.applyCurrency, 1);
});

test("full-item sale commits the zero after-quantity descriptor", async () => {
  const request = { ...REQUEST, transactionId: "trade_sale_full_001", quantity: 5 };
  const harness = createHarness();

  const result = await harness.service.sale(request);
  const row = findTransaction(harness, request.transactionId);

  assert.equal(result.quantity, 5);
  assert.equal(row.item.beforeQuantity, 5);
  assert.equal(row.item.afterQuantity, 0);
  assert.equal(row.item.delta, -5);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMMITTED);
  assert.equal(harness.counters.applyItem, 1);
  assert.equal(harness.counters.applyCurrency, 1);
});

test("sale request is exact, normalized, and rejects client-computed fields before all I/O", async () => {
  for (const [field, value] of [
    ["previewPrice", 999],
    ["payout", 999],
    ["rawItemData", { name: "forged" }],
    ["itemKey", "gear:forged"]
  ]) {
    const harness = createHarness();
    await assert.rejects(
      harness.service.sale({ ...REQUEST, [field]: value }),
      (error) => assertTradeError(error, "invalid-request", "")
    );
    assert.equal(harness.writeAttempts, 0, field);
    assert.deepEqual(harness.counters, {
      prepare: 0,
      applyItem: 0,
      applyCurrency: 0,
      readReceipts: 0,
      compensateCurrency: 0,
      compensateItem: 0
    }, field);
  }

  const normalizedRequest = {
    ...REQUEST,
    transactionId: "trade_sale_trimmed",
    actorId: " actor-a ",
    cityId: " city-a ",
    traderKey: " shop-a ",
    itemUuid: " Actor.actor-a.Item.owned-sword ",
    requestedByUserId: " player-a "
  };
  const original = clone(normalizedRequest);
  const harness = createHarness();
  await harness.service.sale(normalizedRequest);
  assert.deepEqual(normalizedRequest, original);
  assert.deepEqual(findTransaction(harness, "trade_sale_trimmed").request, PERSISTED_REQUEST);
});

test("item mutation failure never pays and finishes compensated", async () => {
  const harness = createHarness({
    operationsOptions: { failures: { "apply-item": 1 } }
  });

  await assert.rejects(
    harness.service.sale({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-compensated")
  );

  const row = findTransaction(harness);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMPENSATED);
  assert.equal(row.phase, "compensated");
  assert.equal(row.error.code, "apply-item-failed");
  assert.equal(row.error.phase, "prepared");
  assert.equal(row.compensation.phase, "compensated");
  assert.equal(harness.counters.applyCurrency, 0);
  assert.equal(harness.counters.compensateCurrency, 0);
  assert.equal(harness.counters.compensateItem, 0);
});

test("payout failure before effect restores the exact item and finishes compensated", async () => {
  const harness = createHarness({
    operationsOptions: { failures: { "apply-currency": 1 } }
  });

  await assert.rejects(
    harness.service.sale({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-compensated")
  );

  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith("apply-") || entry.startsWith("compensate-")),
    ["apply-item", "apply-currency", "compensate-item"]
  );
  assert.equal(harness.counters.compensateCurrency, 0);
  assert.equal(harness.counters.compensateItem, 1);
  assert.deepEqual(harness.compensatedItemTransactions[0].item, buildDescriptor().item);
  assert.deepEqual(harness.receiptFor(REQUEST.transactionId), {
    itemRemoved: false,
    currencyApplied: false
  });
  assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMPENSATED);
});

test("payout success followed by throw reverses currency before restoring item", async () => {
  const harness = createHarness({
    operationsOptions: { afterEffectFailures: { "apply-currency": 1 } }
  });

  await assert.rejects(
    harness.service.sale({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-compensated")
  );

  assert.deepEqual(
    harness.trace.filter((entry) => entry.startsWith("apply-") || entry.startsWith("compensate-")),
    ["apply-item", "apply-currency", "compensate-currency", "compensate-item"]
  );
  assert.equal(harness.counters.compensateCurrency, 1);
  assert.equal(harness.counters.compensateItem, 1);
  assert.deepEqual(harness.receiptFor(REQUEST.transactionId), {
    itemRemoved: false,
    currencyApplied: false
  });
});

test("compensation failure preserves evidence and requires reconciliation", async () => {
  const harness = createHarness({
    operationsOptions: {
      failures: { "apply-currency": 1, "compensate-item": 1 }
    }
  });

  await assert.rejects(
    harness.service.sale({ ...REQUEST }),
    (error) => assertTradeError(error, "reconciliation-required")
  );

  const row = findTransaction(harness);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
  assert.equal(row.error.code, "apply-currency-failed");
  assert.equal(row.error.phase, "item-removed");
  assert.equal(row.compensation.error.code, "compensate-item-failed");
  assert.equal(row.compensation.error.phase, "compensating-item");
  assert.deepEqual(harness.receiptFor(REQUEST.transactionId), {
    itemRemoved: true,
    currencyApplied: false
  });
});

test("committed duplicate returns detached stored result without preparing or mutating", async () => {
  const harness = createHarness();
  const first = await harness.service.sale({ ...REQUEST });
  const counters = clone(harness.counters);
  first.quantity = 999;

  const duplicate = await harness.service.sale({ ...REQUEST });
  assert.deepEqual(duplicate, buildDescriptor().result);
  duplicate.netPayoutCopper = 0;
  assert.deepEqual(findTransaction(harness).result, buildDescriptor().result);
  assert.deepEqual(harness.counters, counters);
});

test("sale duplicates conflict across quantity, actor, item UUID, and persisted purchase kind", async () => {
  const harness = createHarness();
  await harness.service.sale({ ...REQUEST });
  const counters = clone(harness.counters);

  for (const request of [
    { ...REQUEST, quantity: 1 },
    { ...REQUEST, actorId: "actor-b" },
    { ...REQUEST, itemUuid: "Actor.actor-a.Item.other" }
  ]) {
    await assert.rejects(
      harness.service.sale(request),
      (error) => assertTradeError(error, "transaction-conflict")
    );
  }
  assert.deepEqual(harness.counters, counters);

  const purchaseRow = buildTransaction({ kind: "purchase" });
  purchaseRow.request.itemKey = "gear:sword";
  purchaseRow.request.itemUuid = "";
  const purchaseConflict = createHarness({ state: buildState({ tradeLog: [purchaseRow] }) });
  await assert.rejects(
    purchaseConflict.service.sale({ ...REQUEST }),
    (error) => assertTradeError(error, "transaction-conflict")
  );
  assert.equal(purchaseConflict.counters.prepare, 0);
});

test("same-ID sale lock coalesces duplicates, conflicts across kinds, and cleans after rejection", async () => {
  const gate = createDeferred();
  const entered = createDeferred();
  const harness = createHarness({
    operationsOptions: { currencyGate: { promise: gate.promise, entered } }
  });

  const first = harness.service.sale({ ...REQUEST });
  const duplicate = harness.service.sale({ ...REQUEST });
  await entered.promise;
  await assert.rejects(
    harness.service.purchase({
      transactionId: REQUEST.transactionId,
      actorId: REQUEST.actorId,
      cityId: REQUEST.cityId,
      traderKey: REQUEST.traderKey,
      itemKey: "gear:sword",
      quantity: REQUEST.quantity,
      requestedByUserId: REQUEST.requestedByUserId
    }),
    (error) => assertTradeError(error, "transaction-conflict")
  );
  gate.resolve();
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
  assert.deepEqual(firstResult, duplicateResult);
  assert.equal(harness.counters.prepare, 1);
  assert.equal(harness.counters.applyItem, 1);
  assert.equal(harness.counters.applyCurrency, 1);

  const rejectionHarness = createHarness({
    operationsOptions: { failures: { prepare: 1 } }
  });
  await assert.rejects(
    rejectionHarness.service.sale({ ...REQUEST }),
    (error) => assertTradeError(error, "prepare-failed")
  );
  assert.deepEqual(
    await rejectionHarness.service.sale({ ...REQUEST }),
    buildDescriptor().result
  );
  assert.equal(rejectionHarness.counters.prepare, 2);
  assert.equal(rejectionHarness.counters.applyItem, 1);
});

test("recoverable sale receipt combinations resume without duplicate side effects", async () => {
  const scenarios = [
    { phase: "prepared", status: TRADE_TRANSACTION_STATUS.PREPARED, receipts: [true, false], item: 0, currency: 1 },
    { phase: "prepared", status: TRADE_TRANSACTION_STATUS.PREPARED, receipts: [true, true], item: 0, currency: 0 },
    { phase: "item-removed", status: TRADE_TRANSACTION_STATUS.APPLYING, receipts: [true, false], item: 0, currency: 1 },
    { phase: "item-removed", status: TRADE_TRANSACTION_STATUS.APPLYING, receipts: [true, true], item: 0, currency: 0 },
    { phase: "currency-applied", status: TRADE_TRANSACTION_STATUS.APPLYING, receipts: [true, true], item: 0, currency: 0 }
  ];

  for (const scenario of scenarios) {
    const row = buildTransaction({ status: scenario.status, phase: scenario.phase });
    const harness = createHarness({
      state: buildState({ tradeLog: [row] }),
      operationsOptions: {
        initialReceipts: {
          [REQUEST.transactionId]: {
            itemRemoved: scenario.receipts[0],
            currencyApplied: scenario.receipts[1]
          }
        }
      }
    });

    assert.deepEqual(await harness.service.sale({ ...REQUEST }), buildDescriptor().result);
    assert.equal(harness.counters.prepare, 0, scenario.phase);
    assert.equal(harness.counters.applyItem, scenario.item, scenario.phase);
    assert.equal(harness.counters.applyCurrency, scenario.currency, scenario.phase);
    assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMMITTED);
  }
});

test("impossible sale receipt combinations reconcile without document mutation", async () => {
  const scenarios = [
    ["prepared", TRADE_TRANSACTION_STATUS.PREPARED, false, true],
    ["item-removed", TRADE_TRANSACTION_STATUS.APPLYING, false, false],
    ["item-removed", TRADE_TRANSACTION_STATUS.APPLYING, false, true],
    ["currency-applied", TRADE_TRANSACTION_STATUS.APPLYING, false, false],
    ["currency-applied", TRADE_TRANSACTION_STATUS.APPLYING, true, false],
    ["currency-applied", TRADE_TRANSACTION_STATUS.APPLYING, false, true]
  ];

  for (const [phase, status, itemRemoved, currencyApplied] of scenarios) {
    const harness = createHarness({
      state: buildState({ tradeLog: [buildTransaction({ status, phase })] }),
      operationsOptions: {
        initialReceipts: {
          [REQUEST.transactionId]: { itemRemoved, currencyApplied }
        }
      }
    });

    await assert.rejects(
      harness.service.sale({ ...REQUEST }),
      (error) => assertTradeError(error, "reconciliation-required")
    );
    assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
    assert.equal(findTransaction(harness).error.code, "recovery-receipt-missing");
    assert.equal(harness.counters.applyItem, 0, phase);
    assert.equal(harness.counters.applyCurrency, 0, phase);
    assert.equal(harness.counters.compensateItem, 0, phase);
    assert.equal(harness.counters.compensateCurrency, 0, phase);
  }
});

test("prepared and application checkpoint ambiguity recovers without repeated sale effects", async () => {
  for (const mode of ["before-store", "after-store"]) {
    const prepared = createHarness({ writeFailures: { 1: mode } });
    if (mode === "before-store") {
      await assert.rejects(
        prepared.service.sale({ ...REQUEST }),
        (error) => assertTradeError(error, "transaction-write-failed")
      );
      assert.equal(prepared.state.tradeLog.length, 0);
      assert.equal(prepared.counters.applyItem, 0);
      assert.equal(prepared.counters.applyCurrency, 0);
    }
    else {
      assert.deepEqual(await prepared.service.sale({ ...REQUEST }), buildDescriptor().result);
      assert.equal(prepared.counters.applyItem, 1);
      assert.equal(prepared.counters.applyCurrency, 1);
    }
  }

  for (const [name, ordinal] of [["item", 2], ["currency", 3], ["commit", 4]]) {
    for (const mode of ["before-store", "after-store"]) {
      const harness = createHarness({ writeFailures: { [ordinal]: mode } });
      assert.deepEqual(await harness.service.sale({ ...REQUEST }), buildDescriptor().result);
      assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMMITTED, `${name} ${mode}`);
      assert.equal(harness.counters.applyItem, 1, `${name} ${mode}`);
      assert.equal(harness.counters.applyCurrency, 1, `${name} ${mode}`);
      assert.deepEqual(harness.receiptFor(REQUEST.transactionId), {
        itemRemoved: true,
        currencyApplied: true
      });
    }
  }
});

test("currency and item compensation checkpoint ambiguity never repeats reversal effects", async () => {
  for (const [name, ordinal] of [["currency-compensated", 4], ["item-compensated", 5]]) {
    for (const mode of ["before-store", "after-store"]) {
      const harness = createHarness({
        operationsOptions: { afterEffectFailures: { "apply-currency": 1 } },
        writeFailures: { [ordinal]: mode }
      });

      await assert.rejects(
        harness.service.sale({ ...REQUEST }),
        (error) => assertTradeError(error, "transaction-compensated")
      );
      assert.equal(findTransaction(harness).status, TRADE_TRANSACTION_STATUS.COMPENSATED, `${name} ${mode}`);
      assert.equal(harness.counters.compensateCurrency, 1, `${name} ${mode}`);
      assert.equal(harness.counters.compensateItem, 1, `${name} ${mode}`);
      assert.deepEqual(harness.receiptFor(REQUEST.transactionId), {
        itemRemoved: false,
        currencyApplied: false
      });
    }
  }
});

test("sale compensation phases accept only their documented receipt matrices", async () => {
  const allowed = [
    ["compensating", false, false, 0, 0],
    ["compensating", true, false, 0, 1],
    ["compensating", true, true, 1, 1],
    ["currency-compensated", false, false, 0, 0],
    ["currency-compensated", true, false, 0, 1],
    ["item-compensated", false, false, 0, 0]
  ];
  for (const [phase, itemRemoved, currencyApplied, currencyCalls, itemCalls] of allowed) {
    const row = buildTransaction({
      status: TRADE_TRANSACTION_STATUS.COMPENSATING,
      phase,
      error: { code: "sale-failed", message: "sale failed", phase: "prepared" },
      compensation: { phase, attempts: 1, error: null }
    });
    const harness = createHarness({
      state: buildState({ tradeLog: [row] }),
      operationsOptions: {
        initialReceipts: { [REQUEST.transactionId]: { itemRemoved, currencyApplied } }
      }
    });

    await assert.rejects(
      harness.service.sale({ ...REQUEST }),
      (error) => assertTradeError(error, "transaction-compensated")
    );
    assert.equal(harness.counters.compensateCurrency, currencyCalls, phase);
    assert.equal(harness.counters.compensateItem, itemCalls, phase);
  }

  const invalid = [
    ["compensating", false, true],
    ["currency-compensated", false, true],
    ["currency-compensated", true, true],
    ["item-compensated", true, false],
    ["item-compensated", false, true],
    ["item-compensated", true, true]
  ];
  for (const [phase, itemRemoved, currencyApplied] of invalid) {
    const row = buildTransaction({
      status: TRADE_TRANSACTION_STATUS.COMPENSATING,
      phase,
      error: { code: "sale-failed", message: "sale failed", phase: "prepared" },
      compensation: { phase, attempts: 1, error: null }
    });
    const harness = createHarness({
      state: buildState({ tradeLog: [row] }),
      operationsOptions: {
        initialReceipts: { [REQUEST.transactionId]: { itemRemoved, currencyApplied } }
      }
    });

    await assert.rejects(
      harness.service.sale({ ...REQUEST }),
      (error) => assertTradeError(error, "reconciliation-required")
    );
    assert.equal(harness.counters.compensateCurrency, 0, phase);
    assert.equal(harness.counters.compensateItem, 0, phase);
  }
});

test("sale descriptor invariants are validated before journaling", async () => {
  const invalidDescriptors = [
    ["descriptor object", () => null],
    ["trader id", (descriptor) => { descriptor.traderId = ""; }],
    ["item object", (descriptor) => { descriptor.item = []; }],
    ["item id", (descriptor) => { descriptor.item.itemId = " "; }],
    ["canonical item uuid", (descriptor) => { descriptor.item.itemUuid = "Actor.actor-a.Item.other"; }],
    ["item before integer", (descriptor) => { descriptor.item.beforeQuantity = 5.5; }],
    ["item before nonnegative", (descriptor) => { descriptor.item.beforeQuantity = -1; }],
    ["item after integer", (descriptor) => { descriptor.item.afterQuantity = 2.5; }],
    ["item after nonnegative", (descriptor) => { descriptor.item.afterQuantity = -1; }],
    ["item negative delta", (descriptor) => { descriptor.item.delta = 0; }],
    ["item delta equation", (descriptor) => { descriptor.item.afterQuantity = 4; }],
    ["item request quantity", (descriptor) => {
      descriptor.item.beforeQuantity = 6;
      descriptor.item.afterQuantity = 3;
      descriptor.item.delta = -3;
    }],
    ["item created false", (descriptor) => { descriptor.item.created = true; }],
    ["item raw object", (descriptor) => { descriptor.item.rawItemData = []; }],
    ["currency object", (descriptor) => { descriptor.currency = null; }],
    ["currency before integer", (descriptor) => { descriptor.currency.beforeCopper = 1.5; }],
    ["currency before nonnegative", (descriptor) => { descriptor.currency.beforeCopper = -1; }],
    ["currency after integer", (descriptor) => { descriptor.currency.afterCopper = 1.5; }],
    ["currency after nonnegative", (descriptor) => { descriptor.currency.afterCopper = -1; }],
    ["currency nonnegative delta", (descriptor) => { descriptor.currency.deltaCopper = -1; }],
    ["currency delta equation", (descriptor) => { descriptor.currency.afterCopper += 1; }],
    ["result object", (descriptor) => { descriptor.result = []; }],
    ["result transaction", (descriptor) => { descriptor.result.transactionId = "trade_sale_other"; }],
    ["result payout", (descriptor) => { descriptor.result.netPayoutCopper += 1; }],
    ["result total", (descriptor) => { descriptor.result.totalCopper += 1; }]
  ];

  for (const [name, mutation] of invalidDescriptors) {
    const harness = createHarness({
      operationsOptions: {
        descriptorFactory(request) {
          const descriptor = buildDescriptor(request);
          const result = mutation(descriptor);
          return result === undefined ? descriptor : result;
        }
      }
    });

    await assert.rejects(
      harness.service.sale({ ...REQUEST }),
      (error) => assertTradeError(error, "invalid-sale-descriptor"),
      name
    );
    assert.equal(harness.state.tradeLog.length, 0, name);
    assert.equal(harness.writeAttempts, 0, name);
    assert.equal(harness.counters.applyItem, 0, name);
    assert.equal(harness.counters.applyCurrency, 0, name);
  }
});

test("zero-payout sale is valid and audit data cannot overwrite transaction fields", async () => {
  const harness = createHarness({
    operationsOptions: {
      descriptorFactory(request) {
        const descriptor = buildDescriptor(request);
        descriptor.currency.afterCopper = descriptor.currency.beforeCopper;
        descriptor.currency.deltaCopper = 0;
        descriptor.result.netPayoutCopper = 0;
        descriptor.result.totalCopper = 0;
        Object.assign(descriptor.audit, {
          transactionId: "forged",
          kind: "purchase",
          status: "committed",
          phase: "forged",
          request: { actorId: "forged" },
          stock: { itemKey: "forged" },
          item: { itemId: "forged" },
          currency: { deltaCopper: 999 },
          result: { forged: true },
          createdAt: -1,
          committedAt: -1
        });
        return descriptor;
      }
    }
  });

  await harness.service.sale({ ...REQUEST });
  const row = findTransaction(harness);
  assert.equal(row.transactionId, REQUEST.transactionId);
  assert.equal(row.kind, "sale");
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMMITTED);
  assert.equal(row.phase, "committed");
  assert.deepEqual(row.request, PERSISTED_REQUEST);
  assert.equal(row.stock, null);
  assert.equal(row.currency.deltaCopper, 0);
  assert.equal(row.result.netPayoutCopper, 0);
  assert.equal(row.createdAt, 2_000);
  assert.notEqual(row.committedAt, -1);
});

test("terminal compensated and reconciliation duplicates call no sale ports", async () => {
  for (const status of [
    TRADE_TRANSACTION_STATUS.COMPENSATED,
    TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED
  ]) {
    const phase = status;
    const row = buildTransaction({
      status,
      phase,
      error: { code: "sale-failed", message: "failed", phase: "prepared" },
      compensation: status === TRADE_TRANSACTION_STATUS.COMPENSATED
        ? { phase, attempts: 1, error: null }
        : { phase: "compensating-item-failed", attempts: 1, error: { code: "restore-failed" } }
    });
    const harness = createHarness({ state: buildState({ tradeLog: [row] }) });
    await assert.rejects(
      harness.service.sale({ ...REQUEST }),
      (error) => assertTradeError(error, status === TRADE_TRANSACTION_STATUS.COMPENSATED
        ? "transaction-compensated"
        : "reconciliation-required")
    );
    assert.deepEqual(harness.counters, {
      prepare: 0,
      applyItem: 0,
      applyCurrency: 0,
      readReceipts: 0,
      compensateCurrency: 0,
      compensateItem: 0
    });
  }
});
