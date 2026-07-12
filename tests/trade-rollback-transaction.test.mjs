import test from "node:test";
import assert from "node:assert/strict";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import {
  TraderService,
  normalizeTraderState
} from "../scripts/data/trader-service.js";
import {
  TRADE_TRANSACTION_STATUS,
  TradeTransactionError
} from "../scripts/features/trading/trade-transaction-model.js";
import { TradeTransactionService } from "../scripts/features/trading/trade-transaction-service.js";
import { TraderStateRepository } from "../scripts/infrastructure/foundry/trader-state-repository.js";

const ORIGINAL_ID = "trade_purchase_rollback_01";
const ROLLBACK_ID = "rollback_purchase_0001";
const OTHER_ROLLBACK_ID = "rollback_purchase_0002";
const TRADER_ID = "city-a::shop-a";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function committedPurchase(overrides = {}) {
  return {
    id: "audit-purchase-1",
    type: "purchase",
    transactionId: ORIGINAL_ID,
    traderId: TRADER_ID,
    legacy: false,
    kind: "purchase",
    status: TRADE_TRANSACTION_STATUS.COMMITTED,
    phase: "committed",
    request: {
      actorId: "actor-a",
      cityId: "city-a",
      traderKey: "shop-a",
      itemKey: "gear:arrows",
      itemUuid: "",
      quantity: 1,
      requestedByUserId: "buyer-a"
    },
    stock: { itemKey: "gear:arrows", before: 4, after: 3, delta: -1 },
    item: {
      itemId: "arrows",
      itemUuid: "Actor.actor-a.Item.arrows",
      beforeQuantity: 7,
      afterQuantity: 27,
      delta: 20,
      created: false,
      rawItemData: { name: "Arrows", type: "consumable", system: { quantity: 20 } }
    },
    currency: { beforeCopper: 500, afterCopper: 400, deltaCopper: -100 },
    result: { transactionId: ORIGINAL_ID, itemName: "Arrows", totalPriceCopper: 100 },
    error: null,
    compensation: null,
    rollback: null,
    createdAt: 100,
    updatedAt: 101,
    committedAt: 101,
    ...clone(overrides)
  };
}

function committedSale(overrides = {}) {
  const transactionId = "trade_sale_rollback_0001";
  return {
    id: "audit-sale-1",
    type: "sale",
    transactionId,
    traderId: TRADER_ID,
    legacy: false,
    kind: "sale",
    status: TRADE_TRANSACTION_STATUS.COMMITTED,
    phase: "committed",
    request: {
      actorId: "actor-a",
      cityId: "city-a",
      traderKey: "shop-a",
      itemKey: "",
      itemUuid: "Actor.actor-a.Item.sword",
      quantity: 2,
      requestedByUserId: "seller-a"
    },
    stock: null,
    item: {
      itemId: "sword",
      itemUuid: "Actor.actor-a.Item.sword",
      beforeQuantity: 2,
      afterQuantity: 0,
      delta: -2,
      created: false,
      rawItemData: { name: "Sword", type: "weapon", system: { quantity: 2 } }
    },
    currency: { beforeCopper: 200, afterCopper: 350, deltaCopper: 150 },
    result: { transactionId, itemName: "Sword", netPayoutCopper: 150 },
    error: null,
    compensation: null,
    rollback: null,
    createdAt: 200,
    updatedAt: 201,
    committedAt: 201,
    ...clone(overrides)
  };
}

function buildState({ row = committedPurchase(), stockQuantity = 3 } = {}) {
  return {
    version: 1,
    order: [TRADER_ID],
    traders: {
      [TRADER_ID]: {
        traderId: TRADER_ID,
        cityId: "city-a",
        traderKey: "shop-a",
        inventory: [{ itemKey: "gear:arrows", quantity: stockQuantity }]
      }
    },
    tradeLog: [row]
  };
}

function createOperations({
  row,
  failures = {},
  afterEffectFailures = {},
  gate = null
} = {}) {
  const transaction = row ?? committedPurchase();
  const economic = {
    itemQuantity: transaction.kind === "purchase" ? transaction.item?.afterQuantity ?? 0 : 0,
    currencyCopper: transaction.currency?.afterCopper ?? 0,
    purchaseItemApplied: transaction.kind === "purchase",
    purchaseCurrencyApplied: transaction.kind === "purchase",
    saleItemRemoved: transaction.kind === "sale",
    saleCurrencyApplied: transaction.kind === "sale",
    restoredRawItemData: null
  };
  const counters = {
    purchaseItem: 0,
    purchaseCurrency: 0,
    saleCurrency: 0,
    saleItem: 0
  };
  const trace = [];
  const seenTransactions = [];
  const remainingFailures = new Map(Object.entries(failures));
  const remainingAfterEffectFailures = new Map(Object.entries(afterEffectFailures));

  function maybeFail(source, name) {
    const remaining = Number(source.get(name) ?? 0);
    if (remaining < 1) return;
    source.set(name, remaining - 1);
    throw new Error(`${name} failed`);
  }

  function record(name, candidate) {
    counters[name] += 1;
    trace.push(name);
    seenTransactions.push(clone(candidate));
    maybeFail(remainingFailures, name);
  }

  return {
    counters,
    economic,
    seenTransactions,
    trace,
    operations: {
      async compensatePurchaseItem(candidate) {
        record("purchaseItem", candidate);
        if (gate) await gate.promise;
        if (economic.purchaseItemApplied) {
          economic.itemQuantity -= candidate.item.delta;
          economic.purchaseItemApplied = false;
        }
        maybeFail(remainingAfterEffectFailures, "purchaseItem");
      },
      async compensatePurchaseCurrency(candidate) {
        record("purchaseCurrency", candidate);
        if (economic.purchaseCurrencyApplied) {
          economic.currencyCopper -= candidate.currency.deltaCopper;
          economic.purchaseCurrencyApplied = false;
        }
        maybeFail(remainingAfterEffectFailures, "purchaseCurrency");
      },
      async compensateSaleCurrency(candidate) {
        record("saleCurrency", candidate);
        if (economic.saleCurrencyApplied) {
          economic.currencyCopper -= candidate.currency.deltaCopper;
          economic.saleCurrencyApplied = false;
        }
        maybeFail(remainingAfterEffectFailures, "saleCurrency");
      },
      async compensateSaleItem(candidate) {
        record("saleItem", candidate);
        if (economic.saleItemRemoved) {
          economic.itemQuantity -= candidate.item.delta;
          economic.saleItemRemoved = false;
          economic.restoredRawItemData = clone(candidate.item.rawItemData);
        }
        maybeFail(remainingAfterEffectFailures, "saleItem");
      }
    }
  };
}

function createHarness({
  row = committedPurchase(),
  stockQuantity = 3,
  operationsOptions = {},
  writeFailures = {},
  nowStart = 1_000
} = {}) {
  let storedState = buildState({ row, stockQuantity });
  let writeAttempts = 0;
  const pendingWriteFailures = new Map(
    Object.entries(writeFailures).map(([ordinal, mode]) => [Number(ordinal), mode])
  );
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
        const mode = pendingWriteFailures.get(writeAttempts);
        pendingWriteFailures.delete(writeAttempts);
        if (mode === "before-store") throw new Error(`write ${writeAttempts} before store`);
        storedState = clone(value);
        if (mode === "after-store") throw new Error(`write ${writeAttempts} after store`);
        return value;
      }
    }
  };
  const repository = new TraderStateRepository({
    coordinator: new WorldMutationCoordinator(),
    gameProvider: () => game,
    normalizeState: normalizeTraderState
  });
  const fake = createOperations({ row, ...operationsOptions });
  let now = nowStart;
  const service = new TradeTransactionService({
    repository,
    operations: fake.operations,
    now: () => now++
  });
  return {
    ...fake,
    repository,
    service,
    get state() { return clone(storedState); },
    get writeAttempts() { return writeAttempts; }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function rollbackOptions(overrides = {}) {
  return {
    rollbackTransactionId: ROLLBACK_ID,
    requestedByUserId: "gm-a",
    ...overrides
  };
}

function findRow(harness, transactionId = ORIGINAL_ID) {
  return harness.state.tradeLog.find((row) => row.transactionId === transactionId);
}

function assertRollbackError(error, code, {
  transactionId = ORIGINAL_ID,
  rollbackTransactionId = ROLLBACK_ID
} = {}) {
  assert.equal(error instanceof TradeTransactionError, true);
  assert.equal(error.code, code);
  assert.equal(error.transactionId, transactionId);
  assert.equal(error.rollbackTransactionId, rollbackTransactionId);
  assert.match(error.message, new RegExp(transactionId));
  assert.match(error.message, new RegExp(rollbackTransactionId));
  return true;
}

test("purchase rollback removes the exact twenty-arrow Actor delta, refunds one pack, and releases one stock", async () => {
  const harness = createHarness();

  const result = await harness.service.rollback(ORIGINAL_ID, rollbackOptions());

  assert.equal(harness.economic.itemQuantity, 7);
  assert.equal(harness.economic.currencyCopper, 500);
  assert.equal(harness.state.traders[TRADER_ID].inventory[0].quantity, 4);
  assert.deepEqual(harness.trace, ["purchaseItem", "purchaseCurrency"]);
  assert.equal(result.transactionId, ORIGINAL_ID);
  assert.equal(result.rollbackTransactionId, ROLLBACK_ID);
  assert.equal(result.kind, "purchase");
  assert.equal(result.rolledBack, true);
  const row = findRow(harness);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMMITTED);
  assert.equal(row.rolledBack, true);
  assert.equal(row.rollback.status, TRADE_TRANSACTION_STATUS.COMMITTED);
  assert.equal(row.rollback.phase, "committed");
  assert.notEqual(result, row.rollback.result);
});

test("purchase rollback removes only the committed delta from a later merged stack", async () => {
  const row = committedPurchase({
    item: { ...committedPurchase().item, beforeQuantity: 5, afterQuantity: 25, delta: 20 }
  });
  const harness = createHarness({ row });
  harness.economic.itemQuantity = 45;

  await harness.service.rollback(ORIGINAL_ID, rollbackOptions());

  assert.equal(harness.economic.itemQuantity, 25);
});

test("sale rollback debits the exact payout before restoring the exact sold quantity and raw data", async () => {
  const row = committedSale();
  const rollbackTransactionId = "rollback_sale_000001";
  const harness = createHarness({ row });

  const result = await harness.service.rollback(row.transactionId, rollbackOptions({ rollbackTransactionId }));

  assert.deepEqual(harness.trace, ["saleCurrency", "saleItem"]);
  assert.equal(harness.economic.currencyCopper, 200);
  assert.equal(harness.economic.itemQuantity, 2);
  assert.deepEqual(harness.economic.restoredRawItemData, row.item.rawItemData);
  assert.equal(result.kind, "sale");
});

test("full-sale tombstone rollback restores the exact original quantity", async () => {
  const row = committedSale();
  const harness = createHarness({ row });

  await harness.service.rollback(row.transactionId, rollbackOptions({
    rollbackTransactionId: "rollback_sale_tombstone"
  }));

  assert.equal(harness.economic.itemQuantity, row.item.beforeQuantity);
});

test("concurrent calls with the same rollback ID coalesce across active GM failover", async () => {
  const gate = deferred();
  const harness = createHarness({ operationsOptions: { gate } });

  const first = harness.service.rollback(ORIGINAL_ID, rollbackOptions());
  const second = harness.service.rollback(ORIGINAL_ID, rollbackOptions({ requestedByUserId: "gm-b" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.counters.purchaseItem, 1);
  gate.resolve();

  const [left, right] = await Promise.all([first, second]);
  assert.deepEqual(left, right);
  assert.notEqual(left, right);
  assert.deepEqual(harness.counters, {
    purchaseItem: 1,
    purchaseCurrency: 1,
    saleCurrency: 0,
    saleItem: 0
  });
});

test("a new active GM resumes the same durable rollback ID from remaining phases", async () => {
  const harness = createHarness({ operationsOptions: { failures: { purchaseCurrency: 1 } } });
  await assert.rejects(
    harness.service.rollback(ORIGINAL_ID, rollbackOptions()),
    (error) => assertRollbackError(error, "reconciliation-required")
  );
  const reconciled = findRow(harness);
  assert.equal(reconciled.rollback.requestedByUserId, "gm-a");
  assert.equal(reconciled.rollback.phase, "item-reversed");

  const result = await harness.service.rollback(ORIGINAL_ID, rollbackOptions({
    requestedByUserId: "gm-b"
  }));
  const committed = findRow(harness);
  assert.equal(result.rolledBack, true);
  assert.equal(committed.rollback.requestedByUserId, "gm-a");
  assert.equal(committed.rolledBackByUserId, "gm-b");
  assert.equal(harness.seenTransactions.at(-1).request.requestedByUserId, "gm-b");
});

test("a different rollback ID conflicts while the original rollback owns the lock", async () => {
  const gate = deferred();
  const harness = createHarness({ operationsOptions: { gate } });
  const first = harness.service.rollback(ORIGINAL_ID, rollbackOptions());
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    harness.service.rollback(ORIGINAL_ID, rollbackOptions({
      rollbackTransactionId: OTHER_ROLLBACK_ID
    })),
    (error) => assertRollbackError(error, "transaction-conflict", {
      rollbackTransactionId: OTHER_ROLLBACK_ID
    })
  );
  gate.resolve();
  await first;
});

test("a committed rollback returns a detached result without ports or writes", async () => {
  const harness = createHarness();
  const first = await harness.service.rollback(ORIGINAL_ID, rollbackOptions());
  const writes = harness.writeAttempts;

  const repeated = await harness.service.rollback(ORIGINAL_ID, rollbackOptions());
  repeated.itemName = "changed";

  assert.deepEqual({ ...repeated, itemName: first.itemName }, first);
  assert.equal(harness.writeAttempts, writes);
  assert.deepEqual(harness.counters, {
    purchaseItem: 1,
    purchaseCurrency: 1,
    saleCurrency: 0,
    saleItem: 0
  });
  assert.notEqual(repeated, findRow(harness).rollback.result);
});

test("every compensation port success-then-throw reconciles and resumes without repeating an economic delta", async () => {
  const cases = [
    ["purchaseItem", committedPurchase(), ORIGINAL_ID, ROLLBACK_ID],
    ["purchaseCurrency", committedPurchase(), ORIGINAL_ID, ROLLBACK_ID],
    ["saleCurrency", committedSale(), "trade_sale_rollback_0001", "rollback_sale_resume_1"],
    ["saleItem", committedSale(), "trade_sale_rollback_0001", "rollback_sale_resume_2"]
  ];

  for (const [port, row, transactionId, rollbackTransactionId] of cases) {
    const harness = createHarness({
      row,
      operationsOptions: { afterEffectFailures: { [port]: 1 } }
    });
    const options = rollbackOptions({ rollbackTransactionId });
    await assert.rejects(
      harness.service.rollback(transactionId, options),
      (error) => assertRollbackError(error, "reconciliation-required", {
        transactionId,
        rollbackTransactionId
      })
    );
    const failed = findRow(harness, transactionId);
    assert.equal(failed.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED, port);
    assert.equal(failed.rollback.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED, port);

    await harness.service.rollback(transactionId, options);
    assert.equal(harness.economic.currencyCopper, row.currency.beforeCopper, port);
    assert.equal(harness.economic.itemQuantity, row.item.beforeQuantity, port);
    assert.equal(findRow(harness, transactionId).rollback.status, "committed", port);
  }
});

test("rollback checkpoints recover before-store and lost acknowledgements without duplicate deltas", async () => {
  for (const mode of ["before-store", "after-store"]) {
    for (const ordinal of [2, 3]) {
      const harness = createHarness({ writeFailures: { [ordinal]: mode } });
      await harness.service.rollback(ORIGINAL_ID, rollbackOptions());
      assert.equal(harness.economic.itemQuantity, 7, `${mode} write ${ordinal}`);
      assert.equal(harness.economic.currencyCopper, 500, `${mode} write ${ordinal}`);
    }
  }
});

test("stock release and its checkpoint are atomic and add stock exactly once across ACK failures", async () => {
  for (const mode of ["before-store", "after-store"]) {
    const harness = createHarness({ writeFailures: { 4: mode } });
    await harness.service.rollback(ORIGINAL_ID, rollbackOptions());
    assert.equal(harness.state.traders[TRADER_ID].inventory[0].quantity, 4, mode);
  }
});

test("a failed rollback phase durably reconciles and the same rollback ID resumes after correction", async () => {
  const harness = createHarness({
    operationsOptions: { failures: { purchaseCurrency: 1 } }
  });

  await assert.rejects(
    harness.service.rollback(ORIGINAL_ID, rollbackOptions()),
    (error) => assertRollbackError(error, "reconciliation-required")
  );
  assert.equal(findRow(harness).rollback.phase, "item-reversed");
  assert.equal(harness.economic.itemQuantity, 7);
  assert.equal(harness.economic.currencyCopper, 400);

  await harness.service.rollback(ORIGINAL_ID, rollbackOptions());
  assert.equal(harness.counters.purchaseItem, 1);
  assert.equal(harness.economic.currencyCopper, 500);
});

test("a typed compensation port failure is correlated, durably reconciled, and resumes with the same rollback ID", async () => {
  const harness = createHarness();
  const compensatePurchaseItem = harness.operations.compensatePurchaseItem;
  let failTyped = true;
  harness.operations.compensatePurchaseItem = async (transaction) => {
    if (failTyped) {
      failTyped = false;
      throw new TradeTransactionError(
        "port-failed",
        "Typed purchase item reversal failed",
        { transactionId: transaction.transactionId }
      );
    }
    return compensatePurchaseItem(transaction);
  };

  await assert.rejects(
    harness.service.rollback(ORIGINAL_ID, rollbackOptions()),
    (error) => assertRollbackError(error, "reconciliation-required")
  );
  const failed = findRow(harness);
  assert.equal(failed.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
  assert.equal(failed.rollback.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
  assert.equal(failed.rollback.phase, "prepared");
  assert.equal(failed.rollback.error.code, "port-failed");
  assert.equal(failed.rollback.error.transactionId, ORIGINAL_ID);
  assert.equal(failed.rollback.error.rollbackTransactionId, ROLLBACK_ID);

  const result = await harness.service.rollback(ORIGINAL_ID, rollbackOptions());
  assert.equal(result.rolledBack, true);
  assert.equal(harness.economic.itemQuantity, 7);
  assert.equal(findRow(harness).rollback.status, TRADE_TRANSACTION_STATUS.COMMITTED);
});

test("an invalid persisted rollback phase fails closed through durable reconciliation", async () => {
  const row = committedPurchase({
    rollback: {
      transactionId: ROLLBACK_ID,
      status: "applying",
      phase: "unknown-phase",
      requestedByUserId: "gm-a",
      result: null,
      error: null,
      startedAt: 1,
      updatedAt: 1,
      completedAt: 0
    }
  });
  const harness = createHarness({ row });

  await assert.rejects(
    harness.service.rollback(ORIGINAL_ID, rollbackOptions()),
    (error) => assertRollbackError(error, "reconciliation-required")
  );
  const failed = findRow(harness);
  assert.equal(failed.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
  assert.equal(failed.rollback.status, TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED);
  assert.equal(failed.rollback.phase, "unknown-phase");
  assert.equal(failed.rollback.error.code, "transaction-not-rollbackable");
});

test("persistent reconciliation write failure returns correlated transaction-write-failed and keeps nested rollback resumable", async () => {
  const harness = createHarness({
    operationsOptions: { failures: { purchaseItem: 1 } },
    writeFailures: {
      2: "before-store",
      3: "before-store",
      4: "before-store",
      5: "before-store"
    }
  });

  await assert.rejects(
    harness.service.rollback(ORIGINAL_ID, rollbackOptions()),
    (error) => assertRollbackError(error, "transaction-write-failed")
  );
  const row = findRow(harness);
  assert.equal(row.status, TRADE_TRANSACTION_STATUS.COMMITTED);
  assert.equal(row.rollback.status, TRADE_TRANSACTION_STATUS.PREPARED);
  assert.equal(row.rollback.phase, "prepared");
});

test("persistent initial journal outage fails before ports with both IDs and no false terminal rollback", async () => {
  const harness = createHarness({
    writeFailures: {
      1: "before-store",
      2: "before-store",
      3: "before-store",
      4: "before-store"
    }
  });

  await assert.rejects(
    harness.service.rollback(ORIGINAL_ID, rollbackOptions()),
    (error) => assertRollbackError(error, "transaction-write-failed")
  );
  assert.equal(findRow(harness).rollback, null);
  assert.deepEqual(harness.counters, {
    purchaseItem: 0,
    purchaseCurrency: 0,
    saleCurrency: 0,
    saleItem: 0
  });
});

test("invalid rollback IDs, exact options, requester, and legacy rows fail before ports", async () => {
  const invalidCases = [
    ["short", rollbackOptions()],
    [ORIGINAL_ID, { rollbackTransactionId: "short", requestedByUserId: "gm-a" }],
    [ORIGINAL_ID, { rollbackTransactionId: ORIGINAL_ID, requestedByUserId: "gm-a" }],
    [ORIGINAL_ID, { rollbackTransactionId: ROLLBACK_ID, requestedByUserId: " " }],
    [ORIGINAL_ID, { ...rollbackOptions(), extra: true }]
  ];
  for (const [transactionId, options] of invalidCases) {
    const harness = createHarness();
    await assert.rejects(
      harness.service.rollback(transactionId, options),
      (error) => error instanceof TradeTransactionError && error.code === "invalid-request"
    );
    assert.equal(harness.writeAttempts, 0);
    assert.equal(Object.values(harness.counters).reduce((sum, value) => sum + value, 0), 0);
  }

  const legacy = createHarness({
    row: { id: "legacy-audit", type: "purchase", quantity: 1, createdAt: 1 }
  });
  await assert.rejects(
    legacy.service.rollback("legacy-audit", {
      rollbackTransactionId: ROLLBACK_ID,
      requestedByUserId: "gm-a"
    }),
    (error) => error instanceof TradeTransactionError && error.code === "transaction-not-rollbackable"
  );
  assert.equal(Object.values(legacy.counters).reduce((sum, value) => sum + value, 0), 0);
});

function installAuditGlobals(state, { actor = null } = {}) {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;
  globalThis.foundry = {
    utils: {
      deepClone: clone,
      escapeHTML: (value) => String(value ?? ""),
      getProperty: (source, path) => String(path).split(".").reduce((value, key) => value?.[key], source),
      setProperty(source, path, value) {
        const parts = String(path).split(".");
        const last = parts.pop();
        const target = parts.reduce((cursor, key) => (cursor[key] ??= {}), source);
        target[last] = value;
      }
    }
  };
  globalThis.game = {
    user: { id: "gm-a", isGM: true },
    users: { get: () => ({ id: "gm-a", name: "GM", isGM: true }) },
    actors: { get: (id) => id === actor?.id ? actor : null },
    settings: {
      get: () => state.value,
      async set(_moduleId, _key, next) { state.value = next; }
    }
  };
  return () => {
    globalThis.foundry = previousFoundry;
    globalThis.game = previousGame;
  };
}

test("modern audit views fall back to transaction ID and distinguish rollback and transaction states", () => {
  const rows = [
    committedPurchase({ id: "", rollback: { transactionId: ROLLBACK_ID, status: "applying", phase: "item-reversed" } }),
    committedPurchase({ transactionId: "modern_nested_reconcile", id: "nested", status: "reconciliation-required", phase: "rollback-reconciliation-required", rollback: { transactionId: "rollback_nested_rec", status: "reconciliation-required", phase: "prepared" } }),
    committedPurchase({ transactionId: "modern_nested_invalid_01", id: "nested-invalid", rollback: { transactionId: "bad", status: "applying", phase: "prepared" } }),
    committedPurchase({ transactionId: "modern_rolled_back_01", id: "rolled", rolledBack: true, rollback: { transactionId: "rollback_committed_1", status: "committed", phase: "committed" } }),
    committedPurchase({ transactionId: "modern_compensated_01", id: "compensated", status: "compensated", phase: "compensated" }),
    committedPurchase({ transactionId: "modern_top_reconcile_1", id: "top-reconcile", status: "reconciliation-required", phase: "reconciliation-required" }),
    committedPurchase({ transactionId: "modern_prepared_00001", id: "top-prepared", status: "prepared", phase: "stock-reserved" }),
    committedPurchase({ transactionId: "modern_applying_00001", id: "top-applying", status: "applying", phase: "item-applied" })
  ];
  const state = { value: buildState({ row: rows[0] }) };
  state.value.tradeLog = rows;
  const restore = installAuditGlobals(state);
  try {
    const view = new TraderService({}).getTradeAuditLog();
    assert.equal(view.find((row) => row.transactionId === ORIGINAL_ID).id, ORIGINAL_ID);
    assert.equal(view.find((row) => row.transactionId === ORIGINAL_ID).statusLabel, "Откат выполняется");
    assert.equal(view.find((row) => row.id === "nested").statusLabel, "Откат требует сверки");
    assert.equal(view.find((row) => row.id === "rolled").statusLabel, "Откат выполнен");
    assert.equal(view.find((row) => row.id === "compensated").statusLabel, "Транзакция компенсирована");
    assert.equal(view.find((row) => row.id === "top-reconcile").statusLabel, "Транзакция требует сверки");
    assert.equal(view.find((row) => row.id === "top-prepared").statusLabel, "Транзакция выполняется");
    assert.equal(view.find((row) => row.id === "top-applying").statusLabel, "Транзакция выполняется");
    assert.equal(view.find((row) => row.transactionId === ORIGINAL_ID).rollbackDisabled, false);
    assert.equal(view.find((row) => row.id === "nested").rollbackDisabled, false);
    assert.match(view.find((row) => row.id === "nested").rollbackTitle, /Продолж/u);
    assert.equal(view.find((row) => row.id === "nested-invalid").rollbackDisabled, true);
    assert.equal(view.find((row) => row.id === "rolled").rollbackDisabled, true);
    assert.equal(view.find((row) => row.id === "top-reconcile").rollbackDisabled, true);
    assert.equal(view.find((row) => row.id === "top-prepared").rollbackDisabled, true);
    assert.equal(view.find((row) => row.id === "top-applying").rollbackDisabled, true);
  }
  finally {
    restore();
  }
});

test("TraderService delegates modern rollback exactly, propagates errors, and fails closed without a service", async () => {
  const row = committedPurchase({ id: "modern-audit" });
  const state = { value: buildState({ row }) };
  const restore = installAuditGlobals(state);
  try {
    const calls = [];
    const service = new TraderService({});
    service.setTransactionService({
      async rollback(...args) {
        calls.push(clone(args));
        return { delegated: true };
      }
    });
    assert.deepEqual(
      await service.rollbackTradeAuditEntry("modern-audit", rollbackOptions()),
      { delegated: true }
    );
    assert.deepEqual(calls, [[ORIGINAL_ID, rollbackOptions()]]);

    const expected = new Error("engine failure");
    service.setTransactionService({ rollback: async () => { throw expected; } });
    await assert.rejects(
      service.rollbackTradeAuditEntry(ORIGINAL_ID, rollbackOptions()),
      (error) => error === expected
    );

    service.setTransactionService(null);
    await assert.rejects(
      service.rollbackTradeAuditEntry(ORIGINAL_ID, rollbackOptions()),
      /transaction service|сервис транзакций/i
    );
  }
  finally {
    restore();
  }
});

test("rollback wraps repository transaction-not-found errors from start and checkpoint with both IDs", async () => {
  for (const started of [false, true]) {
    const row = committedPurchase(started ? {
      rollback: {
        transactionId: ROLLBACK_ID,
        status: "prepared",
        phase: "prepared",
        requestedByUserId: "gm-a",
        result: null,
        error: null,
        startedAt: 1,
        updatedAt: 1,
        completedAt: 0
      }
    } : {});
    const repository = {
      findTransaction: () => clone(row),
      async mutateTransaction() {
        throw new TradeTransactionError(
          "transaction-not-found",
          "Trade transaction was removed",
          { transactionId: ORIGINAL_ID }
        );
      }
    };
    const service = new TradeTransactionService({
      repository,
      operations: {
        compensatePurchaseItem: async () => {}
      }
    });

    await assert.rejects(
      service.rollback(ORIGINAL_ID, rollbackOptions()),
      (error) => assertRollbackError(error, "transaction-not-found")
    );
  }
});
