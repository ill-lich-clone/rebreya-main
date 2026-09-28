import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizePurchaseBasketRequest,
  isValidPurchaseBasketPayload
} from "../scripts/application/purchase-basket-command.js";
import {
  PurchaseBasketError,
  PurchaseBasketService
} from "../scripts/features/trading/purchase-basket-service.js";

const REQUEST = Object.freeze({
  transactionId: "purchase_basket_001",
  actorId: "actor-a",
  rows: Object.freeze([
    Object.freeze({
      rowId: "rope",
      sourceUuid: "Item.rope",
      quantity: 2,
      unitPrice: Object.freeze({ value: 1.5, denomination: "gp" })
    }),
    Object.freeze({
      rowId: "torch",
      sourceUuid: "Compendium.world.gear.Item.torch",
      quantity: 3,
      unitPrice: Object.freeze({ value: 5, denomination: "sp" })
    })
  ])
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class MemoryJournal {
  records = new Map();

  async find(id) {
    return clone(this.records.get(id) ?? null);
  }

  async start(record) {
    if (!this.records.has(record.id)) {
      this.records.set(record.id, { ...clone(record), terminal: false });
    }
    return this.find(record.id);
  }

  async checkpoint(id, expectedPhase, nextPhase, patch = {}) {
    const current = this.records.get(id);
    assert.equal(current.phase, expectedPhase);
    this.records.set(id, { ...clone(current), ...clone(patch), id, phase: nextPhase, terminal: false });
    return this.find(id);
  }

  async finish(id, result) {
    const current = this.records.get(id);
    this.records.set(id, { ...clone(current), terminal: true, result: clone(result) });
    return this.find(id);
  }
}

function createHarness({
  compensationFailure = false,
  currencyFailure = false,
  currencyLostAck = false,
  itemFailure = false,
  itemLostAck = false
} = {}) {
  const journal = new MemoryJournal();
  const trace = [];
  const state = {
    currency: "before",
    itemUuids: []
  };
  const operations = {
    async prepare(request) {
      trace.push("prepare");
      return {
        actorId: request.actorId,
        items: request.rows.map((row) => ({ rowId: row.rowId, sourceUuid: row.sourceUuid })),
        totalPriceCopper: 450,
        currency: { beforeCopper: 1000, afterCopper: 550 }
      };
    },
    async readReceipts() {
      return clone(state);
    },
    async applyItems(record) {
      trace.push("apply-items");
      if (itemFailure) throw Object.assign(new Error("item creation failed"), { code: "item-create-failed" });
      state.itemUuids = record.descriptor.items.map((item) => `Actor.actor-a.Item.${item.rowId}`);
      if (itemLostAck) throw Object.assign(new Error("lost item acknowledgement"), { code: "socket-timeout" });
      return clone(state.itemUuids);
    },
    async applyCurrency() {
      trace.push("apply-currency");
      if (currencyFailure) throw Object.assign(new Error("currency failed"), { code: "currency-update-failed" });
      state.currency = "after";
      if (currencyLostAck) throw Object.assign(new Error("lost currency acknowledgement"), { code: "socket-timeout" });
    },
    async compensateItems() {
      trace.push("compensate-items");
      if (compensationFailure) throw Object.assign(new Error("compensation failed"), { code: "item-delete-failed" });
      state.itemUuids = [];
    }
  };
  return {
    journal,
    service: new PurchaseBasketService({ journal, operations }),
    state,
    trace
  };
}

function assertBasketError(error, code) {
  assert.ok(error instanceof PurchaseBasketError);
  assert.equal(error.code, code);
  assert.equal(error.transactionId, REQUEST.transactionId);
  return true;
}

test("basket command accepts only exact safe rows and whole-copper prices", () => {
  assert.equal(isValidPurchaseBasketPayload(REQUEST), true);
  assert.equal(isValidPurchaseBasketPayload({ ...REQUEST, unexpected: true }), false);
  assert.equal(isValidPurchaseBasketPayload({
    ...REQUEST,
    rows: [{ ...REQUEST.rows[0], unitPrice: { value: 0.01, denomination: "ep" } }]
  }), false);
  assert.equal(isValidPurchaseBasketPayload({ ...REQUEST, rows: Array.from({ length: 101 }, (_, index) => ({
    rowId: `row-${index}`,
    sourceUuid: `Item.${index}`,
    quantity: 1,
    unitPrice: { value: 0, denomination: "gp" }
  })) }), false);
});

test("canonical basket sorting produces one fingerprint independent of input row order", () => {
  const first = canonicalizePurchaseBasketRequest(REQUEST, "player-a");
  const reversed = canonicalizePurchaseBasketRequest({ ...REQUEST, rows: [...REQUEST.rows].reverse() }, "player-a");

  assert.deepEqual(first.rows.map((row) => row.rowId), ["rope", "torch"]);
  assert.equal(first.fingerprint, reversed.fingerprint);
  assert.equal(first.requestedByUserId, "player-a");
  assert.throws(
    () => canonicalizePurchaseBasketRequest({ ...REQUEST, rows: [REQUEST.rows[0], { ...REQUEST.rows[1], sourceUuid: "Item.rope" }] }, "player-a"),
    /source UUID/u
  );
});

test("basket purchase commits all item rows before one currency debit", async () => {
  const harness = createHarness();
  const result = await harness.service.commit(REQUEST, { requestedByUserId: "player-a" });

  assert.deepEqual(harness.trace, ["prepare", "apply-items", "apply-currency"]);
  assert.deepEqual(result, {
    status: "committed",
    transactionId: REQUEST.transactionId,
    actorId: "actor-a",
    createdItemUuids: ["Actor.actor-a.Item.rope", "Actor.actor-a.Item.torch"],
    totalPriceCopper: 450
  });
  assert.equal(harness.journal.records.get(REQUEST.transactionId).terminal, true);
  assert.equal(harness.journal.records.get(REQUEST.transactionId).phase, "committed");
});

test("committed basket replay returns stored result without repeating effects", async () => {
  const harness = createHarness();
  const first = await harness.service.commit(REQUEST, { requestedByUserId: "player-a" });
  const traceAfterCommit = [...harness.trace];
  first.createdItemUuids.push("mutated");

  const replay = await harness.service.commit(REQUEST, { requestedByUserId: "player-a" });

  assert.deepEqual(harness.trace, traceAfterCommit);
  assert.deepEqual(replay.createdItemUuids, ["Actor.actor-a.Item.rope", "Actor.actor-a.Item.torch"]);
});

test("same transaction ID with changed basket is rejected before effects", async () => {
  const harness = createHarness();
  await harness.service.commit(REQUEST, { requestedByUserId: "player-a" });
  const traceAfterCommit = [...harness.trace];

  await assert.rejects(
    harness.service.commit({ ...REQUEST, rows: [{ ...REQUEST.rows[0], quantity: 3 }, REQUEST.rows[1]] }, { requestedByUserId: "player-a" }),
    (error) => assertBasketError(error, "transaction-conflict")
  );
  assert.deepEqual(harness.trace, traceAfterCommit);
});

test("currency failure compensates created items and preserves a terminal error", async () => {
  const harness = createHarness({ currencyFailure: true });

  await assert.rejects(
    harness.service.commit(REQUEST, { requestedByUserId: "player-a" }),
    (error) => assertBasketError(error, "transaction-compensated")
  );

  assert.deepEqual(harness.trace, ["prepare", "apply-items", "apply-currency", "compensate-items"]);
  assert.deepEqual(harness.state.itemUuids, []);
  assert.equal(harness.state.currency, "before");
  assert.equal(harness.journal.records.get(REQUEST.transactionId).phase, "compensated");
});

test("lost currency acknowledgement is recovered from receipts without compensation", async () => {
  const harness = createHarness({ currencyLostAck: true });

  const result = await harness.service.commit(REQUEST, { requestedByUserId: "player-a" });

  assert.equal(result.status, "committed");
  assert.deepEqual(harness.trace, ["prepare", "apply-items", "apply-currency"]);
  assert.equal(harness.state.currency, "after");
  assert.equal(harness.state.itemUuids.length, 2);
});

test("lost item acknowledgement is recovered from receipts without duplicating the batch", async () => {
  const harness = createHarness({ itemLostAck: true });

  const result = await harness.service.commit(REQUEST, { requestedByUserId: "player-a" });

  assert.equal(result.status, "committed");
  assert.deepEqual(harness.trace, ["prepare", "apply-items", "apply-currency"]);
  assert.equal(harness.state.itemUuids.length, 2);
});

test("failed compensation becomes terminal reconciliation-required", async () => {
  const harness = createHarness({ currencyFailure: true, compensationFailure: true });

  await assert.rejects(
    harness.service.commit(REQUEST, { requestedByUserId: "player-a" }),
    (error) => assertBasketError(error, "reconciliation-required")
  );

  assert.deepEqual(harness.trace, ["prepare", "apply-items", "apply-currency", "compensate-items"]);
  assert.equal(harness.journal.records.get(REQUEST.transactionId).phase, "reconciliation-required");
  assert.equal(harness.journal.records.get(REQUEST.transactionId).terminal, true);
});
