import assert from "node:assert/strict";
import test from "node:test";

import { PurchaseBasketFoundryOperations } from "../scripts/infrastructure/foundry/purchase-basket-operations.js";

const REQUEST = Object.freeze({
  transactionId: "purchase_basket_ops_001",
  actorId: "actor-a",
  requestedByUserId: "player-a",
  fingerprint: "fingerprint-a",
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

function sourceItem(uuid, name, quantity = 99) {
  const data = {
    _id: `${name}-source-id`,
    name,
    type: "equipment",
    img: `${name}.webp`,
    folder: "folder-id",
    ownership: { default: 3 },
    sort: 42,
    _stats: { modifiedTime: 123 },
    system: { quantity, price: { value: 10, denomination: "gp" } },
    flags: { source: { preserved: true } }
  };
  return {
    uuid,
    documentName: "Item",
    name,
    toObject: () => clone(data),
    sourceData: data
  };
}

function createActor({ currency = { pp: 0, gp: 4, ep: 1, sp: 0, cp: 0 } } = {}) {
  const actor = {
    id: "actor-a",
    uuid: "Actor.actor-a",
    system: { currency: clone(currency) },
    items: [{
      id: "unrelated",
      uuid: "Actor.actor-a.Item.unrelated",
      parent: null,
      flags: { "rebreya-main": { purchaseBasketTransaction: { transactionId: "another" } } }
    }],
    createCalls: [],
    deleteCalls: [],
    updateCalls: [],
    async createEmbeddedDocuments(type, rows) {
      this.createCalls.push({ type, rows: clone(rows) });
      const created = rows.map((data, index) => ({
        id: `created-${index}`,
        uuid: `Actor.actor-a.Item.created-${index}`,
        parent: this,
        ...clone(data)
      }));
      this.items.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(type, ids) {
      this.deleteCalls.push({ type, ids: [...ids] });
      this.items = this.items.filter((item) => !ids.includes(item.id));
    },
    async update(patch) {
      this.updateCalls.push(clone(patch));
      for (const denomination of ["pp", "gp", "ep", "sp", "cp"]) {
        const key = `system.currency.${denomination}`;
        if (Object.hasOwn(patch, key)) this.system.currency[denomination] = patch[key];
      }
    }
  };
  actor.items[0].parent = actor;
  return actor;
}

function createHarness(options = {}) {
  const actor = createActor(options);
  const sources = new Map([
    ["Item.rope", sourceItem("Item.rope", "Rope")],
    ["Compendium.world.gear.Item.torch", sourceItem("Compendium.world.gear.Item.torch", "Torch")]
  ]);
  const game = { actors: new Map([[actor.id, actor]]) };
  const operations = new PurchaseBasketFoundryOperations({
    gameProvider: () => game,
    fromUuid: (uuid) => sources.get(uuid) ?? null
  });
  return { actor, game, operations, sources };
}

test("purchase preparation resolves authoritative Items and builds sanitized requested copies", async () => {
  const harness = createHarness();
  const sourceBefore = clone(harness.sources.get("Item.rope").sourceData);

  const descriptor = await harness.operations.prepare(REQUEST);

  assert.equal(descriptor.totalPriceCopper, 450);
  assert.deepEqual(descriptor.currency, { beforeCopper: 450, afterCopper: 0 });
  assert.deepEqual(descriptor.items.map((item) => item.itemData.system.quantity), [2, 3]);
  for (const item of descriptor.items) {
    assert.equal(Object.hasOwn(item.itemData, "_id"), false);
    assert.equal(Object.hasOwn(item.itemData, "folder"), false);
    assert.equal(Object.hasOwn(item.itemData, "ownership"), false);
    assert.equal(Object.hasOwn(item.itemData, "sort"), false);
    assert.equal(Object.hasOwn(item.itemData, "_stats"), false);
    assert.deepEqual(item.itemData.flags["rebreya-main"].purchaseBasketTransaction, {
      version: 1,
      transactionId: REQUEST.transactionId,
      rowId: item.rowId,
      sourceUuid: item.sourceUuid
    });
  }
  assert.deepEqual(harness.sources.get("Item.rope").sourceData, sourceBefore);
});

test("purchase preparation rejects missing/non-Item sources and insufficient funds", async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.operations.prepare({ ...REQUEST, rows: [{ ...REQUEST.rows[0], sourceUuid: "Item.missing" }] }),
    (error) => error.code === "source-unavailable"
  );

  const poor = createHarness({ currency: { pp: 0, gp: 0, ep: 0, sp: 1, cp: 0 } });
  await assert.rejects(
    poor.operations.prepare(REQUEST),
    (error) => error.code === "insufficient-funds"
  );
});

test("Foundry operations create one batch, normalize the wallet, and expose exact receipts", async () => {
  const harness = createHarness();
  const descriptor = await harness.operations.prepare(REQUEST);
  const record = { id: REQUEST.transactionId, request: REQUEST, descriptor };

  await harness.operations.applyItems(record);
  let receipts = await harness.operations.readReceipts(record);
  assert.deepEqual(receipts, {
    itemUuids: ["Actor.actor-a.Item.created-0", "Actor.actor-a.Item.created-1"],
    currency: "before"
  });
  assert.equal(harness.actor.createCalls.length, 1);
  assert.equal(harness.actor.createCalls[0].type, "Item");

  await harness.operations.applyCurrency(record);
  receipts = await harness.operations.readReceipts(record);
  assert.equal(receipts.currency, "after");
  assert.deepEqual(harness.actor.system.currency, { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
  assert.equal(harness.actor.updateCalls.length, 1);
});

test("compensation removes only exact transaction copies and leaves sources and unrelated Items", async () => {
  const harness = createHarness();
  const descriptor = await harness.operations.prepare(REQUEST);
  const record = { id: REQUEST.transactionId, request: REQUEST, descriptor };
  const sourceBefore = clone(harness.sources.get("Item.rope").sourceData);

  await harness.operations.applyItems(record);
  await harness.operations.compensateItems(record);

  assert.deepEqual(harness.actor.deleteCalls, [{
    type: "Item",
    ids: ["created-0", "created-1"]
  }]);
  assert.deepEqual(harness.actor.items.map((item) => item.id), ["unrelated"]);
  assert.deepEqual(harness.sources.get("Item.rope").sourceData, sourceBefore);
});

test("currency application refuses a wallet changed after preparation", async () => {
  const harness = createHarness();
  const descriptor = await harness.operations.prepare(REQUEST);
  const record = { id: REQUEST.transactionId, request: REQUEST, descriptor };
  harness.actor.system.currency.cp = 1;

  await assert.rejects(
    harness.operations.applyCurrency(record),
    (error) => error.code === "currency-changed"
  );
  assert.equal(harness.actor.updateCalls.length, 0);
});
