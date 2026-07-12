import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  PendingTradeTransactions,
  commitSaleBasket,
  createTradePendingStorageKey,
  hasFrozenSaleBasketEntries,
  isFrozenSaleBasketEntry,
  purchaseSemanticKey,
  rollbackSemanticKey,
  rollbackResumeIdentity,
  saleSemanticKey,
  summarizeCommittedSaleEntries
} from "../scripts/features/trading/trade-ui-transaction-lifecycle.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeStorage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

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

test("sale basket success never deletes a replacement added while the request awaits", async () => {
  const gate = deferred();
  const original = { preview: { itemUuid: "Item.a" }, quantity: 1 };
  const replacement = { preview: { itemUuid: "Item.a" }, quantity: 4 };
  const basket = new Map([["Item.a", original]]);
  let settled = 0;
  const running = commitSaleBasket(basket, async () => gate.promise, {
    onSettledEntry: () => { settled += 1; }
  });
  await new Promise((resolve) => setImmediate(resolve));
  basket.delete("Item.a");
  basket.set("Item.a", replacement);
  gate.resolve();
  await running;
  assert.equal(basket.get("Item.a"), replacement);
  assert.equal(settled, 0);
});

test("sale basket terminal failure never deletes a replacement added while awaiting", async () => {
  const gate = deferred();
  const original = { preview: { itemUuid: "Item.a" }, quantity: 1 };
  const replacement = { preview: { itemUuid: "Item.a" }, quantity: 4 };
  const basket = new Map([["Item.a", original]]);
  const running = commitSaleBasket(basket, async () => gate.promise);
  await new Promise((resolve) => setImmediate(resolve));
  basket.set("Item.a", replacement);
  const terminal = new Error("conflict");
  terminal.code = "transaction-conflict";
  gate.reject(terminal);
  await assert.rejects(() => running, { code: "transaction-conflict" });
  assert.equal(basket.get("Item.a"), replacement);
});

test("sale basket timeout never mutates a replacement added during the lost acknowledgement", async () => {
  const gate = deferred();
  const original = { preview: { itemUuid: "Item.a" }, quantity: 1 };
  const replacement = { preview: { itemUuid: "Item.a" }, quantity: 5 };
  const basket = new Map([["Item.a", original]]);
  const running = commitSaleBasket(basket, async () => gate.promise);
  await new Promise((resolve) => setImmediate(resolve));
  basket.set("Item.a", replacement);
  const timeout = new Error("lost acknowledgement");
  timeout.code = "request-timeout";
  gate.reject(timeout);
  await assert.rejects(() => running, { code: "request-timeout" });
  assert.equal(basket.get("Item.a"), replacement);
  assert.equal(replacement.frozenQuantity, undefined);
});

test("sale basket skips queued snapshot entries removed or replaced while an earlier row awaits", async () => {
  for (const replacement of [null, { preview: { itemUuid: "Item.b" }, quantity: 9 }]) {
    const gate = deferred();
    const first = { preview: { itemUuid: "Item.a" }, quantity: 1 };
    const staleSecond = { preview: { itemUuid: "Item.b" }, quantity: 2 };
    const basket = new Map([["Item.a", first], ["Item.b", staleSecond]]);
    const calls = [];
    const running = commitSaleBasket(basket, async (entry) => {
      calls.push(entry);
      if (entry === first) await gate.promise;
    });
    await new Promise((resolve) => setImmediate(resolve));
    if (replacement) basket.set("Item.b", replacement);
    else basket.delete("Item.b");
    gate.resolve();
    await running;
    assert.deepEqual(calls, [first]);
    assert.equal(basket.get("Item.b"), replacement ?? undefined);
  }
});

test("pending lifecycle clears known terminal failures and retains ambiguous or unknown outcomes", () => {
  const terminalCodes = [
    "transaction-conflict",
    "transaction-compensated",
    "invalid-request",
    "invalid-payload",
    "unauthorized",
    "transaction-not-found",
    "transaction-not-rollbackable",
    "sale-preparation-failed",
    "invalid-sale-descriptor",
    "purchase-preparation-failed",
    "invalid-purchase-descriptor",
    "stock-unavailable"
  ];
  const retainedCodes = [
    "request-timeout",
    "reconciliation-required",
    "transaction-write-failed",
    "transaction-state-unavailable",
    "unknown-error"
  ];
  let serial = 0;
  const lifecycle = new PendingTradeTransactions({ idFactory: () => `trade_${++serial}_stable` });
  for (const code of terminalCodes) {
    const key = `terminal-${code}`;
    const before = lifecycle.acquire("trade", key);
    lifecycle.reject(key, { code });
    assert.notEqual(lifecycle.acquire("trade", key), before, code);
  }
  for (const code of retainedCodes) {
    const key = `retained-${code}`;
    const before = lifecycle.acquire("trade", key);
    lifecycle.reject(key, { code });
    assert.equal(lifecycle.acquire("trade", key), before, code);
  }
});

test("every proven pre-journal error releases the current frozen basket entry", async () => {
  for (const code of [
    "sale-preparation-failed",
    "invalid-sale-descriptor",
    "purchase-preparation-failed",
    "invalid-purchase-descriptor",
    "stock-unavailable"
  ]) {
    const entry = {
      preview: { itemUuid: `Item.${code}` },
      quantity: 1,
      frozenQuantity: 1,
      transactionId: `sale_${code.replaceAll("-", "_")}`
    };
    const basket = new Map([[entry.preview.itemUuid, entry]]);
    await assert.rejects(() => commitSaleBasket(basket, async () => {
      const error = new Error(code);
      error.code = code;
      throw error;
    }), { code });
    assert.equal(basket.has(entry.preview.itemUuid), false, code);
    assert.equal(hasFrozenSaleBasketEntries(basket), false, code);
  }
});

test("pending lifecycle adopts a valid durable rollback ID after reload", () => {
  const key = rollbackSemanticKey("audit-1");
  const lifecycle = new PendingTradeTransactions({ idFactory: () => "rollback_generated_1" });
  assert.equal(lifecycle.adopt(key, "rollback_durable_1"), true);
  assert.equal(lifecycle.acquire("rollback", key), "rollback_durable_1");
  assert.equal(lifecycle.adopt(key, "constructor"), false);

  const fresh = new PendingTradeTransactions({ idFactory: () => "rollback_generated_2" });
  assert.equal(fresh.adopt(key, "bad"), false);
  assert.equal(fresh.acquire("rollback", key), "rollback_generated_2");
});

test("persistent lifecycle reuses ambiguous IDs across instances and clears terminal IDs", () => {
  const storage = new FakeStorage();
  const storageKey = createTradePendingStorageKey({
    moduleId: "rebreya-main", worldId: "world-a", userId: "player-a", surface: "trader"
  });
  const semanticKey = saleSemanticKey({
    actorId: "actor-a", cityId: "city-a", traderKey: "shop", itemUuid: "Item.a", quantity: 2
  });
  const first = new PendingTradeTransactions({
    storage,
    storageKey,
    idFactory: () => "sale_persisted_0001",
    now: () => 10
  });
  const transactionId = first.acquire("sale", semanticKey);
  first.reject(semanticKey, { code: "request-timeout" });

  const second = new PendingTradeTransactions({
    storage,
    storageKey,
    idFactory: () => "sale_should_not_run",
    now: () => 20
  });
  assert.equal(second.acquire("sale", semanticKey), transactionId);
  second.reject(semanticKey, { code: "transaction-compensated" });

  const third = new PendingTradeTransactions({
    storage,
    storageKey,
    idFactory: () => "sale_after_terminal_1",
    now: () => 30
  });
  assert.equal(third.acquire("sale", semanticKey), "sale_after_terminal_1");
});

test("every ambiguous outcome remains persistent across lifecycle instances", () => {
  for (const code of [
    "request-timeout",
    "reconciliation-required",
    "transaction-write-failed",
    "transaction-state-unavailable",
    "unknown-error"
  ]) {
    const storage = new FakeStorage();
    const storageKey = `ambiguous-${code}`;
    const first = new PendingTradeTransactions({
      storage, storageKey, idFactory: () => `sale_${code.replaceAll("-", "_")}`
    });
    const id = first.acquire("sale", "semantic");
    first.reject("semantic", { code });
    const second = new PendingTradeTransactions({
      storage, storageKey, idFactory: () => "sale_must_not_replace"
    });
    assert.equal(second.acquire("sale", "semantic"), id, code);
  }
});

test("rebuilt basket semantic row reuses the persisted dispatch ID after timeout", async () => {
  const storage = new FakeStorage();
  const storageKey = "rebuilt-basket";
  const createLifecycle = (idFactory) => new PendingTradeTransactions({
    storage, storageKey, idFactory
  });
  const semantic = saleSemanticKey({
    actorId: "actor-a", cityId: "city-a", traderKey: "shop", itemUuid: "Item.a", quantity: 2
  });
  const run = async (lifecycle, entry, expectedCode) => commitSaleBasket(
    new Map([["Item.a", entry]]),
    async () => {
      const error = new Error(expectedCode);
      error.code = expectedCode;
      throw error;
    },
    {
      prepareEntry(candidate) {
        candidate.semanticKey = semantic;
        candidate.transactionId = lifecycle.acquire("sale", semantic);
      }
    }
  );
  const firstEntry = { preview: { itemUuid: "Item.a" }, quantity: 2 };
  await assert.rejects(
    run(createLifecycle(() => "sale_rebuilt_stable_1"), firstEntry, "request-timeout"),
    { code: "request-timeout" }
  );
  const rebuilt = { preview: { itemUuid: "Item.a" }, quantity: 2 };
  await assert.rejects(
    run(createLifecycle(() => "sale_must_not_replace"), rebuilt, "request-timeout"),
    { code: "request-timeout" }
  );
  assert.equal(rebuilt.transactionId, firstEntry.transactionId);
});

test("persistent lifecycle scopes IDs by user and world and stores no trade preview", () => {
  const storage = new FakeStorage();
  const semanticKey = saleSemanticKey({
    actorId: "actor-a", cityId: "city-a", traderKey: "shop", itemUuid: "Item.a", quantity: 2
  });
  const keyA = createTradePendingStorageKey({ moduleId: "rebreya-main", worldId: "world-a", userId: "player-a", surface: "trader" });
  const keyB = createTradePendingStorageKey({ moduleId: "rebreya-main", worldId: "world-a", userId: "player-b", surface: "trader" });
  const keyC = createTradePendingStorageKey({ moduleId: "rebreya-main", worldId: "world-b", userId: "player-a", surface: "trader" });
  const ids = [
    new PendingTradeTransactions({ storage, storageKey: keyA, idFactory: () => "sale_scope_a_01" }).acquire("sale", semanticKey),
    new PendingTradeTransactions({ storage, storageKey: keyB, idFactory: () => "sale_scope_b_01" }).acquire("sale", semanticKey),
    new PendingTradeTransactions({ storage, storageKey: keyC, idFactory: () => "sale_scope_c_01" }).acquire("sale", semanticKey)
  ];
  assert.deepEqual(ids, ["sale_scope_a_01", "sale_scope_b_01", "sale_scope_c_01"]);
  const serialized = storage.getItem(keyA);
  assert.doesNotMatch(serialized, /preview|price|payout|rawItemData/u);
});

test("persistent lifecycle ignores corruption and invalid or reserved stored IDs", () => {
  const storage = new FakeStorage();
  const storageKey = "pending-corrupt";
  storage.setItem(storageKey, "{broken");
  const corrupt = new PendingTradeTransactions({
    storage, storageKey, idFactory: () => "sale_corrupt_safe_1"
  });
  assert.equal(corrupt.acquire("sale", "semantic-a"), "sale_corrupt_safe_1");

  storage.setItem(storageKey, JSON.stringify({
    version: 1,
    entries: [
      { semanticKey: "semantic-b", transactionId: "constructor", updatedAt: 1 },
      { semanticKey: "semantic-c", transactionId: "bad", updatedAt: 2 }
    ]
  }));
  const invalid = new PendingTradeTransactions({
    storage, storageKey, idFactory: () => "sale_invalid_safe_1"
  });
  assert.equal(invalid.acquire("sale", "semantic-b"), "sale_invalid_safe_1");
});

test("persistent lifecycle falls back in memory when storage throws and bounds serialized entries", () => {
  const throwingStorage = {
    getItem() { throw new Error("security"); },
    setItem() { throw new Error("quota"); }
  };
  let serial = 0;
  const fallback = new PendingTradeTransactions({
    storage: throwingStorage,
    storageKey: "throwing",
    idFactory: () => `sale_fallback_${++serial}`
  });
  assert.equal(fallback.acquire("sale", "same"), "sale_fallback_1");
  assert.equal(fallback.acquire("sale", "same"), "sale_fallback_1");

  const storage = new FakeStorage();
  const bounded = new PendingTradeTransactions({
    storage,
    storageKey: "bounded",
    idFactory: (prefix) => `${prefix}_${String(++serial).padStart(8, "0")}`,
    now: () => serial
  });
  for (let index = 0; index < 140; index += 1) bounded.acquire("sale", `semantic-${index}`);
  assert.equal(JSON.parse(storage.getItem("bounded")).entries.length, 128);
});

test("semantic keys are injective even when fields contain separators", () => {
  const left = purchaseSemanticKey({
    actorId: "a", cityId: "b|c", traderKey: "d", itemKey: "e", quantity: 1
  });
  const right = purchaseSemanticKey({
    actorId: "a", cityId: "b", traderKey: "c|d", itemKey: "e", quantity: 1
  });
  assert.notEqual(left, right);
});

test("frozen basket helpers identify unresolved dispatched entries", () => {
  const pending = { frozenQuantity: null };
  const frozen = { frozenQuantity: 2 };
  assert.equal(isFrozenSaleBasketEntry(pending), false);
  assert.equal(isFrozenSaleBasketEntry(frozen), true);
  assert.equal(hasFrozenSaleBasketEntries(new Map([["a", pending], ["b", frozen]])), true);
  assert.equal(hasFrozenSaleBasketEntries(new Map([["a", pending]])), false);
});

test("rollback resume identity distinguishes new, durable, and malformed nested rollback", () => {
  assert.deepEqual(rollbackResumeIdentity({ rollback: null }), { kind: "new", transactionId: "" });
  assert.deepEqual(rollbackResumeIdentity({
    rollback: { transactionId: "rollback_durable_1", status: "applying" }
  }), { kind: "resume", transactionId: "rollback_durable_1" });
  assert.deepEqual(rollbackResumeIdentity({
    rollback: { transactionId: "bad", status: "reconciliation-required" }
  }), { kind: "unavailable", transactionId: "" });
  assert.deepEqual(rollbackResumeIdentity({
    rollback: { status: "applying" }
  }), { kind: "unavailable", transactionId: "" });
});

test("trader V2 blocks close and preserves a frozen ambiguous basket entry", async () => {
  const previous = {
    foundry: globalThis.foundry,
    game: globalThis.game,
    ui: globalThis.ui,
    window: globalThis.window
  };
  let warnings = 0;
  let superCloseCalls = 0;
  class TestApplication {
    constructor() {}
    async close() {
      superCloseCalls += 1;
      return "closed";
    }
  }
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2: TestApplication,
        HandlebarsApplicationMixin: (Base) => Base
      }
    },
    utils: {
      deepClone: (value) => structuredClone(value),
      escapeHTML: (value) => String(value),
      getProperty: () => undefined
    }
  };
  globalThis.game = { user: { id: "gm-a", isGM: true } };
  globalThis.ui = { notifications: { warn: () => { warnings += 1; } } };
  globalThis.window = { clearTimeout() {} };
  try {
    const { TraderAppV2 } = await import(`../scripts/ui/trader-app-v2.js?close-guard=${Date.now()}`);
    const app = new TraderAppV2({}, "city-a", "smith");
    const entry = {
      preview: { itemUuid: "Item.a" },
      quantity: 2,
      frozenQuantity: 2,
      transactionId: "sale_frozen_123"
    };
    app.saleBasket.set("Item.a", entry);
    app.isClosing = true;
    assert.equal(await app.close({}), undefined);
    assert.equal(app.saleBasket.get("Item.a"), entry);
    assert.equal(app.isClosing, false);
    assert.equal(warnings, 1);
    assert.equal(superCloseCalls, 0);

    app.saleBasket.clear();
    assert.equal(await app.close({}), "closed");
    assert.equal(superCloseCalls, 1);
  }
  finally {
    globalThis.foundry = previous.foundry;
    globalThis.game = previous.game;
    globalThis.ui = previous.ui;
    globalThis.window = previous.window;
  }
});

test("trader V2 and economy source wire frozen controls and durable rollback adoption", async () => {
  const [traderSource, classicSource, economySource] = await Promise.all([
    readFile(new URL("../scripts/ui/trader-app-v2.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ui/trader-app.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ui/economy-app.js", import.meta.url), "utf8")
  ]);
  assert.match(traderSource, /isFrozenSaleBasketEntry\(entry\)/u);
  assert.match(traderSource, /data-action="sale-remove-item"[\s\S]*?\$\{disabled\}/u);
  assert.match(traderSource, /hasFrozenSaleBasketEntries\(this\.saleBasket\)/u);
  assert.match(traderSource, /async close\(options[\s\S]*?super\.close/u);
  assert.match(traderSource, /onDispatched:[\s\S]*?#renderSaleBasket/u);
  assert.match(traderSource, /committedSummary\.count > 0/u);
  assert.match(traderSource, /createTradePendingStorageOptions/u);
  assert.match(traderSource, /surface: "trader-direct"/u);
  assert.match(classicSource, /surface: "trader-direct"/u);
  assert.match(economySource, /surface: "economy-rollback"/u);
  assert.match(economySource, /rollbackResumeIdentity\(record\)/u);
  assert.match(economySource, /pendingTradeRollbacks\.adopt/u);
});

test("committed sale summary counts only actual settled entries at frozen quantities", () => {
  const committed = [
    {
      entry: { preview: { netPayoutCopper: 125 }, quantity: 99, frozenQuantity: 2 },
      result: { netPayoutCopper: 175, sellQuantity: 2 }
    },
    {
      entry: { preview: { netPayoutCopper: 40 }, quantity: 99, frozenQuantity: 3 },
      result: { netPayoutCopper: 150, sellQuantity: 3 }
    }
  ];
  assert.deepEqual(summarizeCommittedSaleEntries(committed), {
    count: 2,
    netCopper: 325
  });
  assert.deepEqual(summarizeCommittedSaleEntries([{
    entry: { preview: { netPayoutCopper: 40 }, frozenQuantity: 3 },
    result: { netPayoutCopper: 999, sellQuantity: "invalid" }
  }]), { count: 1, netCopper: 120 });
  assert.deepEqual(summarizeCommittedSaleEntries([{
    entry: { preview: {}, frozenQuantity: 3 },
    result: { netPayoutCopper: 999, sellQuantity: "invalid" }
  }]), { count: 0, netCopper: 0 });
  assert.deepEqual(summarizeCommittedSaleEntries([]), { count: 0, netCopper: 0 });
});

test("basket outcome excludes a queued row removed while the first dispatch awaits", async () => {
  const gate = deferred();
  const first = { preview: { itemUuid: "Item.a", netPayoutCopper: 10 }, quantity: 2 };
  const removed = { preview: { itemUuid: "Item.b", netPayoutCopper: 500 }, quantity: 4 };
  const basket = new Map([["Item.a", first], ["Item.b", removed]]);
  const running = commitSaleBasket(basket, async (entry) => {
    if (entry === first) await gate.promise;
  });
  await new Promise((resolve) => setImmediate(resolve));
  basket.delete("Item.b");
  gate.resolve();
  const outcome = await running;
  assert.deepEqual(outcome.committedEntries.map((entry) => entry.entry), [first]);
  assert.deepEqual(summarizeCommittedSaleEntries(outcome.committedEntries), {
    count: 1,
    netCopper: 20
  });
});
