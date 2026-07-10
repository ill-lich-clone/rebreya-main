import test from "node:test";
import assert from "node:assert/strict";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import {
  createEmptyTraderState,
  normalizeTraderState
} from "../scripts/data/trader-service.js";
import {
  TRADE_TRANSACTION_STATUS,
  TradeTransactionError
} from "../scripts/features/trading/trade-transaction-model.js";
import {
  TraderStateRepository
} from "../scripts/infrastructure/foundry/trader-state-repository.js";

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

function createRepositoryFixture(initialState = {}) {
  let storedState = initialState;
  const reads = [];
  const writes = [];
  const game = {
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        assert.equal(key, SETTINGS_KEYS.TRADER_STATE);
        reads.push(clone(storedState));
        return storedState;
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        assert.equal(key, SETTINGS_KEYS.TRADER_STATE);
        storedState = value;
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

  return {
    game,
    reads,
    repository,
    get storedState() {
      return storedState;
    },
    set storedState(value) {
      storedState = value;
    },
    writes
  };
}

function buildTransaction(transactionId, status, updatedAt) {
  return {
    transactionId,
    status,
    updatedAt,
    request: { quantity: 1 }
  };
}

test("trader state helpers create and normalize durable state without Foundry globals", () => {
  const previousFoundry = globalThis.foundry;
  const source = {
    version: 3,
    order: "invalid",
    traders: null,
    extra: { preserved: true },
    tradeLog: [{
      id: "legacy-state-row",
      type: "sale",
      quantity: 2,
      rollback: { restored: true }
    }]
  };
  globalThis.foundry = undefined;

  try {
    assert.deepEqual(createEmptyTraderState(), {
      version: 1,
      order: [],
      traders: {},
      tradeLog: []
    });

    const state = normalizeTraderState(source);
    assert.equal(state.version, 3);
    assert.deepEqual(state.order, []);
    assert.deepEqual(state.traders, {});
    assert.deepEqual(state.extra, { preserved: true });
    assert.notEqual(state.extra, source.extra);
    assert.equal(state.tradeLog.length, 1);
    assert.equal(state.tradeLog[0].transactionId, "legacy-state-row");
    assert.equal(state.tradeLog[0].status, "committed");
    assert.equal(state.tradeLog[0].legacy, true);
    assert.equal(state.tradeLog[0].kind, "sale");
    assert.deepEqual(state.tradeLog[0].rollback, { restored: true });
  }
  finally {
    globalThis.foundry = previousFoundry;
  }
});

test("TraderStateRepository read returns a detached normalized current state", () => {
  const source = {
    order: [" trader-a "],
    traders: { "trader-a": { name: "Trader A" } },
    tradeLog: [{ id: "legacy-read-row", type: "purchase", quantity: 1 }]
  };
  const fixture = createRepositoryFixture(source);

  const state = fixture.repository.read();

  assert.equal(state.version, 1);
  assert.deepEqual(state.order, [" trader-a "]);
  assert.notEqual(state.traders, source.traders);
  assert.equal(state.tradeLog[0].transactionId, "legacy-read-row");
  assert.equal(state.tradeLog[0].legacy, true);
  assert.equal(fixture.reads.length, 1);
  assert.equal(fixture.writes.length, 0);
});

test("TraderStateRepository queues fresh reads through one completed setting write", async () => {
  const fixture = createRepositoryFixture({ mutationIds: [] });
  const firstWriteGate = createDeferred();
  const savedMutationIds = [];
  let inFlightWrites = 0;
  let maxInFlightWrites = 0;
  let writeCount = 0;
  fixture.game.settings.set = async (moduleId, key, value) => {
    assert.equal(moduleId, MODULE_ID);
    assert.equal(key, SETTINGS_KEYS.TRADER_STATE);
    writeCount += 1;
    inFlightWrites += 1;
    maxInFlightWrites = Math.max(maxInFlightWrites, inFlightWrites);
    savedMutationIds.push(value.mutationIds.at(-1));
    if (writeCount === 1) {
      await firstWriteGate.promise;
    }
    fixture.storedState = value;
    fixture.writes.push(clone(value));
    inFlightWrites -= 1;
    return value;
  };

  const first = fixture.repository.mutate((state) => {
    state.mutationIds ??= [];
    state.mutationIds.push("one");
    return "first-result";
  });
  const second = fixture.repository.mutate((state) => {
    state.mutationIds ??= [];
    state.mutationIds.push("two");
    return "second-result";
  });

  await flushTasks();
  assert.equal(fixture.reads.length, 1);
  assert.equal(writeCount, 1);
  assert.equal(maxInFlightWrites, 1);
  assert.deepEqual(savedMutationIds, ["one"]);

  firstWriteGate.resolve();
  assert.deepEqual(await Promise.all([first, second]), ["first-result", "second-result"]);
  assert.equal(fixture.reads.length, 2);
  assert.equal(fixture.writes.length, 2);
  assert.equal(maxInFlightWrites, 1);
  assert.deepEqual(savedMutationIds, ["one", "two"]);
  assert.deepEqual(fixture.storedState.mutationIds, ["one", "two"]);
});

test("TraderStateRepository recovers its queue after a mutator rejection without writing", async () => {
  const fixture = createRepositoryFixture({ attempts: [] });
  const failureGate = createDeferred();
  const expectedError = new Error("mutation failed");

  const failed = fixture.repository.mutate(async (state) => {
    state.attempts.push("discarded");
    await failureGate.promise;
    throw expectedError;
  });
  const recovered = fixture.repository.mutate((state) => {
    state.attempts.push("recovered");
    return "recovered-result";
  });

  await flushTasks();
  assert.equal(fixture.reads.length, 1);
  assert.equal(fixture.writes.length, 0);
  failureGate.resolve();

  await assert.rejects(failed, (error) => error === expectedError);
  assert.equal(await recovered, "recovered-result");
  assert.equal(fixture.reads.length, 2);
  assert.equal(fixture.writes.length, 1);
  assert.deepEqual(fixture.storedState.attempts, ["recovered"]);
});

test("TraderStateRepository recovers its queue after a setting write rejection", async () => {
  const fixture = createRepositoryFixture({ attempts: [] });
  const expectedError = new Error("setting write failed");
  let attempts = 0;
  fixture.game.settings.set = async (_moduleId, _key, value) => {
    attempts += 1;
    if (attempts === 1) {
      throw expectedError;
    }
    fixture.storedState = value;
    fixture.writes.push(clone(value));
    return value;
  };

  const failed = fixture.repository.mutate((state) => {
    state.attempts.push("failed-write");
  });
  const recovered = fixture.repository.mutate((state) => {
    state.attempts.push("recovered-write");
    return "saved";
  });

  await assert.rejects(failed, (error) => error === expectedError);
  assert.equal(await recovered, "saved");
  assert.equal(attempts, 2);
  assert.equal(fixture.reads.length, 2);
  assert.equal(fixture.writes.length, 1);
  assert.deepEqual(fixture.storedState.attempts, ["recovered-write"]);
});

test("TraderStateRepository findTransaction reads normalized rows", () => {
  const fixture = createRepositoryFixture({
    tradeLog: [{ id: "legacy-find-row", type: "purchase", quantity: 1 }]
  });

  const found = fixture.repository.findTransaction("legacy-find-row");

  assert.equal(found.transactionId, "legacy-find-row");
  assert.equal(found.status, "committed");
  assert.equal(fixture.repository.findTransaction("missing-row"), null);
});

test("TraderStateRepository mutateTransaction updates a row and returns the mutator result", async () => {
  const fixture = createRepositoryFixture({
    marker: "state-marker",
    tradeLog: [buildTransaction("transaction_0001", "prepared", 1)]
  });

  const result = await fixture.repository.mutateTransaction(
    "transaction_0001",
    (row, state) => {
      assert.equal(state.marker, "state-marker");
      row.status = TRADE_TRANSACTION_STATUS.COMMITTED;
      row.phase = "committed";
      row.result = { receipt: "saved" };
      return row.transactionId;
    }
  );

  assert.equal(result, "transaction_0001");
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.storedState.tradeLog[0].status, "committed");
  assert.deepEqual(fixture.storedState.tradeLog[0].result, { receipt: "saved" });
});

test("TraderStateRepository mutateTransaction rejects a missing row without writing", async () => {
  const fixture = createRepositoryFixture({ tradeLog: [] });

  await assert.rejects(
    fixture.repository.mutateTransaction("missing_0000001", () => null),
    (error) => {
      assert.equal(error instanceof TradeTransactionError, true);
      assert.equal(error.code, "transaction-not-found");
      assert.equal(error.transactionId, "missing_0000001");
      return true;
    }
  );
  assert.equal(fixture.writes.length, 0);
});

test("TraderStateRepository normalizes and retains the trade log after every mutation", async () => {
  const fixture = createRepositoryFixture({ tradeLog: [] });

  await fixture.repository.mutate((state) => {
    state.tradeLog = [
      ...Array.from({ length: 23 }, (_value, index) => buildTransaction(
        `terminal_${String(index).padStart(8, "0")}`,
        index % 2 === 0 ? "committed" : "compensated",
        index + 1
      )),
      buildTransaction("applying_0000001", "applying", 1),
      buildTransaction("reconcile_000001", "reconciliation-required", 2)
    ];
  });

  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.storedState.tradeLog.length, 22);
  assert.deepEqual(
    fixture.storedState.tradeLog.slice(0, 2).map((row) => row.transactionId),
    ["applying_0000001", "reconcile_000001"]
  );
  assert.deepEqual(
    fixture.storedState.tradeLog.slice(2).map((row) => row.updatedAt),
    Array.from({ length: 20 }, (_value, index) => 23 - index)
  );
  assert.equal(
    fixture.storedState.tradeLog.every((row) => row.request.quantity === 1),
    true
  );
});
