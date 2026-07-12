import test from "node:test";
import assert from "node:assert/strict";

import {
  PendingTradeTransactions,
  commitSaleBasket,
  rollbackSemanticKey
} from "../scripts/features/trading/trade-ui-transaction-lifecycle.js";

test("pending trade lifecycle reuses IDs after ambiguous errors and clears terminal outcomes", () => {
  let serial = 0;
  const pending = new PendingTradeTransactions({
    idFactory: (prefix) => `${prefix}_stable_${++serial}`
  });
  const key = "purchase|actor-a|city-a|smith|gear:sword|2";
  const first = pending.acquire("purchase", key);
  pending.reject(key, { code: "request-timeout" });
  assert.equal(pending.acquire("purchase", key), first);
  pending.resolve(key);
  assert.notEqual(pending.acquire("purchase", key), first);

  const saleKey = "sale|actor-a|city-a|smith|Item.a|1";
  const saleId = pending.acquire("sale", saleKey);
  pending.reject(saleKey, { code: "transaction-compensated" });
  assert.notEqual(pending.acquire("sale", saleKey), saleId);

  const rollbackKey = rollbackSemanticKey("audit-1");
  const rollbackId = pending.acquire("rollback", rollbackKey);
  pending.reject(rollbackKey, { code: "reconciliation-required" });
  assert.equal(pending.acquire("rollback", rollbackKey), rollbackId);
});

test("sale basket removes each committed row and never replays it after a later failure", async () => {
  const basket = new Map([
    ["Item.a", { preview: { itemUuid: "Item.a" }, quantity: 1, transactionId: "sale_item_a", frozenQuantity: 1 }],
    ["Item.b", { preview: { itemUuid: "Item.b" }, quantity: 2, transactionId: "sale_item_b", frozenQuantity: 2 }]
  ]);
  const calls = [];
  const dispatch = async (entry) => {
    calls.push([entry.preview.itemUuid, entry.frozenQuantity, entry.transactionId]);
    if (entry.preview.itemUuid === "Item.b") {
      const error = new Error("timeout");
      error.code = "request-timeout";
      throw error;
    }
  };

  await assert.rejects(() => commitSaleBasket(basket, dispatch), { code: "request-timeout" });
  assert.equal(basket.has("Item.a"), false);
  assert.equal(basket.has("Item.b"), true);
  assert.deepEqual(calls, [
    ["Item.a", 1, "sale_item_a"],
    ["Item.b", 2, "sale_item_b"]
  ]);

  await assert.rejects(() => commitSaleBasket(basket, dispatch), { code: "request-timeout" });
  assert.deepEqual(calls.at(-1), ["Item.b", 2, "sale_item_b"]);
  assert.equal(calls.filter(([uuid]) => uuid === "Item.a").length, 1);
});

test("sale basket freezes quantity once an economic ID is assigned", async () => {
  const basket = new Map([
    ["Item.a", { preview: { itemUuid: "Item.a" }, quantity: 3 }]
  ]);
  const seen = [];
  await commitSaleBasket(basket, async (entry) => {
    seen.push({ id: entry.transactionId, quantity: entry.frozenQuantity });
  }, { idFactory: () => "sale_frozen_123" });
  assert.deepEqual(seen, [{ id: "sale_frozen_123", quantity: 3 }]);
});
