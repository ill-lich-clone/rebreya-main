import test from "node:test";
import assert from "node:assert/strict";

import { TraderService } from "../scripts/data/trader-service.js";
import { TradeTransactionService } from "../scripts/features/trading/trade-transaction-service.js";

const MODULE_ID = "rebreya-main";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getProperty(source, path) {
  return String(path ?? "").split(".").reduce((current, part) => current?.[part], source);
}

function setProperty(source, path, value) {
  const parts = String(path ?? "").split(".");
  let cursor = source;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      cursor[part] = clone(value);
      return;
    }
    cursor[part] ??= {};
    cursor = cursor[part];
  }
}

function applyPatch(document, patch) {
  for (const [path, value] of Object.entries(patch)) {
    setProperty(document, path, value);
  }
}

class FakeItem {
  constructor(data, parent, { id = "item-1" } = {}) {
    const source = clone(data);
    Object.assign(this, source);
    this.id = id;
    this.uuid = `Actor.${parent.id}.Item.${id}`;
    this.parent = parent;
    this.flags ??= {};
    this.system ??= {};
    this.updatePatches = [];
    this.deleteCalls = 0;
    this.throwAfterUpdateOnce = false;
  }

  getFlag(moduleId, key) {
    return this.flags?.[moduleId]?.[key];
  }

  toObject() {
    return clone({
      _id: this.id,
      name: this.name,
      type: this.type,
      img: this.img,
      system: this.system,
      flags: this.flags
    });
  }

  async update(patch) {
    this.updatePatches.push(clone(patch));
    applyPatch(this, patch);
    if (this.throwAfterUpdateOnce) {
      this.throwAfterUpdateOnce = false;
      throw new Error("lost item update acknowledgement");
    }
    return this;
  }

  async delete() {
    this.deleteCalls += 1;
    this.parent.items.contents = this.parent.items.contents.filter((item) => item !== this);
  }
}

class FakeActor {
  constructor({
    id = "actor-1",
    copper = 1_000,
    ownership = { "player-1": 3 }
  } = {}) {
    this.id = id;
    this.name = "Buyer";
    this.img = "buyer.webp";
    this.isOwner = true;
    this.ownership = ownership;
    this.flags = {};
    this.system = {
      currency: {
        pp: 0,
        gp: Math.floor(copper / 100),
        ep: 0,
        sp: Math.floor((copper % 100) / 10),
        cp: copper % 10
      }
    };
    this.items = {
      contents: [],
      get: (itemId) => this.items.contents.find((item) => item.id === itemId) ?? null
    };
    this.updatePatches = [];
    this.createdPayloads = [];
    this.throwAfterUpdateOnce = false;
    this.throwAfterCreateOnce = false;
  }

  addItem(data, { id = `item-${this.items.contents.length + 1}` } = {}) {
    const item = new FakeItem(data, this, { id });
    this.items.contents.push(item);
    return item;
  }

  async update(patch) {
    this.updatePatches.push(clone(patch));
    applyPatch(this, patch);
    if (this.throwAfterUpdateOnce) {
      this.throwAfterUpdateOnce = false;
      throw new Error("lost actor update acknowledgement");
    }
    return this;
  }

  async createEmbeddedDocuments(type, documents) {
    assert.equal(type, "Item");
    this.createdPayloads.push(...clone(documents));
    const created = documents.map((document) => this.addItem(document));
    if (this.throwAfterCreateOnce) {
      this.throwAfterCreateOnce = false;
      throw new Error("lost item create acknowledgement");
    }
    return created;
  }
}

function installFoundry({ actors = [], stateRepository = null } = {}) {
  const previous = {
    Actor: globalThis.Actor,
    Item: globalThis.Item,
    CONST: globalThis.CONST,
    canvas: globalThis.canvas,
    foundry: globalThis.foundry,
    fromUuid: globalThis.fromUuid,
    game: globalThis.game
  };

  globalThis.Actor = FakeActor;
  globalThis.Item = FakeItem;
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
  globalThis.canvas = { tokens: { controlled: [] } };
  globalThis.foundry = {
    utils: {
      deepClone: clone,
      escapeHTML: (value) => String(value ?? ""),
      getProperty,
      setProperty
    }
  };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: {
      get: (id) => ({ id, isGM: id === "gm" }),
      contents: []
    },
    actors: {
      get: (id) => actors.find((actor) => actor.id === id) ?? null,
      contents: actors
    },
    settings: {
      get: () => stateRepository?.read?.() ?? {},
      set: async () => {
        throw new Error("unexpected direct state write");
      }
    }
  };
  globalThis.fromUuid = async (uuid) => actors
    .flatMap((actor) => actor.items.contents)
    .find((item) => item.uuid === uuid) ?? null;

  return () => {
    Object.assign(globalThis, previous);
  };
}

function createModuleApi() {
  return {
    inventoryService: { getInventoryActor: async () => null },
    globalEventsService: {
      collectMerchantModifiers: () => ({
        buyPricePercent: 0,
        sellPricePercent: 0,
        stockPercent: 0,
        blocked: false,
        sourceEventNames: []
      })
    }
  };
}

function createPurchaseTransaction(overrides = {}) {
  return {
    transactionId: "purchase_port_001",
    kind: "purchase",
    request: {
      actorId: "actor-1",
      cityId: "city-1",
      traderKey: "shop-1",
      itemKey: "gear:arrows",
      quantity: 1,
      requestedByUserId: "player-1"
    },
    item: {
      itemId: "item-1",
      itemUuid: "Actor.actor-1.Item.item-1",
      beforeQuantity: 5,
      afterQuantity: 25,
      delta: 20,
      created: false,
      rawItemData: {
        name: "Arrows",
        type: "consumable",
        system: { quantity: 20 },
        flags: { [MODULE_ID]: { sourceType: "gear", sourceId: "arrows" } }
      }
    },
    currency: {
      beforeCopper: 1_000,
      afterCopper: 800,
      deltaCopper: -200
    },
    ...clone(overrides)
  };
}

function createSaleTransaction(overrides = {}) {
  return {
    transactionId: "sale_port_001",
    kind: "sale",
    request: {
      actorId: "actor-1",
      cityId: "city-1",
      traderKey: "shop-1",
      itemKey: "",
      itemUuid: "Actor.actor-1.Item.item-1",
      quantity: 2,
      requestedByUserId: "player-1"
    },
    item: {
      itemId: "item-1",
      itemUuid: "Actor.actor-1.Item.item-1",
      beforeQuantity: 5,
      afterQuantity: 3,
      delta: -2,
      created: false,
      rawItemData: {
        name: "Iron",
        type: "loot",
        img: "iron.webp",
        system: { quantity: 5 },
        flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron" } }
      }
    },
    currency: {
      beforeCopper: 100,
      afterCopper: 220,
      deltaCopper: 120
    },
    ...clone(overrides)
  };
}

test("transaction service delegation sends exact semantic purchase and sale requests", async () => {
  const calls = [];
  const transactionService = {
    async purchase(request, context) {
      calls.push(["purchase", request, context]);
      return { ok: "purchase" };
    },
    async sale(request, context) {
      calls.push(["sale", request, context]);
      return { ok: "sale" };
    }
  };
  const service = new TraderService(createModuleApi());
  service.setTransactionService(transactionService);

  assert.deepEqual(
    await service.purchaseItem("city-1", "shop-1", "gear:arrows", 2, {
      transactionId: "purchase_delegate_01",
      actorId: "actor-1",
      requestedByUserId: "player-1",
      forgedTotal: 1
    }),
    { ok: "purchase" }
  );
  assert.deepEqual(
    await service.sellItem("city-1", "shop-1", {
      actorId: "actor-1",
      itemUuid: "Actor.actor-1.Item.item-1",
      grossOfferCopper: 999_999,
      taxCopper: -1,
      netPayoutCopper: 999_999,
      rawItemData: { forged: true }
    }, 2, {
      transactionId: "sale_delegate_0001",
      requestedByUserId: "player-1"
    }),
    { ok: "sale" }
  );

  assert.deepEqual(calls, [
    ["purchase", {
      transactionId: "purchase_delegate_01",
      actorId: "actor-1",
      cityId: "city-1",
      traderKey: "shop-1",
      itemKey: "gear:arrows",
      quantity: 2,
      requestedByUserId: "player-1"
    }, { source: "trader-service" }],
    ["sale", {
      transactionId: "sale_delegate_0001",
      actorId: "actor-1",
      cityId: "city-1",
      traderKey: "shop-1",
      itemUuid: "Actor.actor-1.Item.item-1",
      quantity: 2,
      requestedByUserId: "player-1"
    }, { source: "trader-service" }]
  ]);
});

test("engine errors propagate without legacy fallback while no injection retains fallback", async () => {
  const service = new TraderService(createModuleApi());
  let legacyCalls = 0;
  service.purchaseItemLegacy = async () => {
    legacyCalls += 1;
    return "legacy";
  };

  assert.equal(await service.purchaseItem("city", "shop", "item", 1), "legacy");
  assert.equal(legacyCalls, 1);

  service.setTransactionService({
    async purchase() {
      throw new Error("engine failed");
    }
  });
  await assert.rejects(
    service.purchaseItem("city", "shop", "item", 1, {
      transactionId: "purchase_error_01",
      actorId: "actor-1",
      requestedByUserId: "player-1"
    }),
    /engine failed/
  );
  assert.equal(legacyCalls, 1);
});

test("purchase preparation expands packs and describes new and existing actor items without mutation", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 1_000 });
  const restore = installFoundry({ actors: [actor] });
  const service = new TraderService(createModuleApi());
  const snapshot = {
    traderId: "city-1::shop-1",
    cityName: "City",
    name: "Armorer",
    inventory: [{
      itemKey: "gear:arrows",
      sourceType: "gear",
      sourceId: "arrows",
      name: "Стрелы (20)",
      quantity: 3,
      finalPriceCopper: 100,
      basePriceGold: 1,
      baseWeight: 1,
      finalWeight: 1,
      itemTypeLabel: "Боеприпас",
      predominantMaterialId: "iron",
      linkedGoodId: "iron-good"
    }]
  };
  service.getTraderSnapshot = async () => clone(snapshot);
  const operations = service.createFoundryTradeOperations();
  const request = {
    transactionId: "purchase_prepare_01",
    actorId: actor.id,
    cityId: "city-1",
    traderKey: "shop-1",
    itemKey: "gear:arrows",
    quantity: 2,
    requestedByUserId: "player-1"
  };

  try {
    const created = await operations.preparePurchase(request, { source: "test" });
    assert.equal(created.traderId, snapshot.traderId);
    assert.deepEqual(created.stock, { itemKey: request.itemKey });
    assert.deepEqual(created.item, {
      itemId: "",
      itemUuid: "",
      beforeQuantity: 0,
      afterQuantity: 40,
      delta: 40,
      created: true,
      rawItemData: created.item.rawItemData
    });
    assert.equal(getProperty(created.item.rawItemData, "system.quantity"), 40);
    assert.equal(getProperty(created.item.rawItemData, `flags.${MODULE_ID}.sourcePackQuantity`), 20);
    assert.deepEqual(created.currency, {
      beforeCopper: 1_000,
      afterCopper: 800,
      deltaCopper: -200
    });
    assert.equal(created.result.transactionId, request.transactionId);
    assert.equal(created.result.totalPriceCopper, 200);
    assert.equal(actor.updatePatches.length, 0);
    assert.equal(actor.createdPayloads.length, 0);

    const existingItem = actor.addItem({
      name: "Arrows",
      type: "consumable",
      system: { quantity: 5 },
      flags: { [MODULE_ID]: { sourceType: "gear", sourceId: "arrows" } }
    }, { id: "existing-arrows" });
    const existing = await operations.preparePurchase({ ...request, quantity: 1 });
    assert.equal(existing.item.created, false);
    assert.equal(existing.item.itemId, existingItem.id);
    assert.equal(existing.item.itemUuid, existingItem.uuid);
    assert.equal(existing.item.beforeQuantity, 5);
    assert.equal(existing.item.afterQuantity, 25);
    assert.equal(existing.item.delta, 20);
    assert.ok(existing.item.rawItemData);

    await assert.rejects(
      operations.preparePurchase({ ...request, quantity: 4 }),
      /количеств|stock|товар/i
    );
    actor.system.currency.gp = 0;
    await assert.rejects(
      operations.preparePurchase({ ...request, quantity: 1 }),
      /монет|fund/i
    );
    assert.equal(existingItem.updatePatches.length, 0);
  }
  finally {
    restore();
  }
});

test("sale preparation reloads the current item and recomputes all totals from a fresh preview", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 100 });
  const item = actor.addItem({
    name: "Iron",
    type: "loot",
    img: "iron.webp",
    system: { quantity: 5 },
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron" } }
  });
  const restore = installFoundry({ actors: [actor] });
  const service = new TraderService(createModuleApi());
  const previewCalls = [];
  service.createSalePreview = async (...args) => {
    previewCalls.push(args);
    return {
      actorId: actor.id,
      actorName: actor.name,
      cityName: "City",
      traderName: "Armorer",
      itemUuid: item.uuid,
      itemId: item.id,
      itemName: item.name,
      sourceType: "material",
      sourceId: "iron",
      grossOfferCopper: 70,
      taxCopper: 10,
      netPayoutCopper: 60
    };
  };
  const operations = service.createFoundryTradeOperations();
  const request = {
    transactionId: "sale_prepare_0001",
    actorId: actor.id,
    cityId: "city-1",
    traderKey: "shop-1",
    itemUuid: item.uuid,
    quantity: 2,
    requestedByUserId: "player-1"
  };

  try {
    const descriptor = await operations.prepareSale(request, {
      grossOfferCopper: 99_999,
      netPayoutCopper: 99_999
    });
    assert.deepEqual(previewCalls, [["city-1", "shop-1", { uuid: item.uuid }]]);
    assert.equal(descriptor.traderId, "city-1::shop-1");
    assert.deepEqual(descriptor.item, {
      itemId: item.id,
      itemUuid: item.uuid,
      beforeQuantity: 5,
      afterQuantity: 3,
      delta: -2,
      created: false,
      rawItemData: descriptor.item.rawItemData
    });
    assert.deepEqual(descriptor.currency, {
      beforeCopper: 100,
      afterCopper: 220,
      deltaCopper: 120
    });
    assert.equal(descriptor.result.grossOfferCopper, 140);
    assert.equal(descriptor.result.taxCopper, 20);
    assert.equal(descriptor.result.netPayoutCopper, 120);
    assert.equal(descriptor.audit.cityName, "City");
    assert.equal(descriptor.audit.traderName, "Armorer");
    assert.equal(descriptor.audit.rawItemData._id, undefined);
    assert.deepEqual(descriptor.audit.rawItemData, descriptor.item.rawItemData);
    assert.equal(actor.updatePatches.length, 0);
    assert.equal(item.updatePatches.length, 0);
  }
  finally {
    restore();
  }
});

test("purchase Item and currency application are atomic and idempotent", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 1_000 });
  const item = actor.addItem({
    name: "Arrows",
    type: "consumable",
    system: { quantity: 5 },
    flags: { [MODULE_ID]: { sourceType: "gear", sourceId: "arrows" } }
  });
  const restore = installFoundry({ actors: [actor] });
  const operations = new TraderService(createModuleApi()).createFoundryTradeOperations();
  const transaction = createPurchaseTransaction();

  try {
    await operations.applyPurchaseItem(transaction);
    assert.equal(item.updatePatches.length, 1);
    assert.equal(item.updatePatches[0]["system.quantity"], 25);
    const itemMarkers = item.updatePatches[0][`flags.${MODULE_ID}.tradeTransactions`];
    assert.equal(itemMarkers[transaction.transactionId].kind, "purchase");
    assert.equal(itemMarkers[transaction.transactionId].applied, true);
    assert.equal(itemMarkers[transaction.transactionId].delta, 20);
    assert.equal(itemMarkers[transaction.transactionId].before, 5);
    assert.equal(itemMarkers[transaction.transactionId].after, 25);

    await operations.applyPurchaseCurrency(transaction);
    assert.equal(actor.updatePatches.length, 1);
    assert.equal(actor.updatePatches[0]["system.currency.gp"], 8);
    const receipts = actor.updatePatches[0][`flags.${MODULE_ID}.tradeReceipts`];
    assert.equal(receipts[transaction.transactionId].kind, "purchase");
    assert.equal(receipts[transaction.transactionId].applied, true);
    assert.equal(receipts[transaction.transactionId].deltaCopper, -200);
    assert.equal(receipts[transaction.transactionId].beforeCopper, 1_000);
    assert.equal(receipts[transaction.transactionId].afterCopper, 800);

    assert.deepEqual(await operations.readPurchaseReceipts(transaction), {
      itemApplied: true,
      currencyApplied: true,
      itemId: item.id,
      itemUuid: item.uuid
    });
    await operations.applyPurchaseItem(transaction);
    await operations.applyPurchaseCurrency(transaction);
    assert.equal(item.updatePatches.length, 1);
    assert.equal(actor.updatePatches.length, 1);
  }
  finally {
    restore();
  }
});

test("new purchase Item creation includes its marker and receipt lookup returns actual identity", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 1_000 });
  const restore = installFoundry({ actors: [actor] });
  const operations = new TraderService(createModuleApi()).createFoundryTradeOperations();
  const transaction = createPurchaseTransaction({
    transactionId: "purchase_create_001",
    item: {
      itemId: "",
      itemUuid: "",
      beforeQuantity: 0,
      afterQuantity: 3,
      delta: 3,
      created: true,
      rawItemData: {
        name: "Iron",
        type: "loot",
        system: { quantity: 3 },
        flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron" } }
      }
    }
  });

  try {
    await operations.applyPurchaseItem(transaction);
    assert.equal(actor.createdPayloads.length, 1);
    assert.equal(getProperty(actor.createdPayloads[0], "system.quantity"), 3);
    const marker = getProperty(
      actor.createdPayloads[0],
      `flags.${MODULE_ID}.tradeTransactions.${transaction.transactionId}`
    );
    assert.equal(marker.kind, "purchase");
    assert.equal(marker.applied, true);
    assert.equal(marker.created, true);

    const createdItem = actor.items.contents[0];
    assert.deepEqual(await operations.readPurchaseReceipts(transaction), {
      itemApplied: true,
      currencyApplied: false,
      itemId: createdItem.id,
      itemUuid: createdItem.uuid
    });
    await operations.applyPurchaseItem(transaction);
    assert.equal(actor.createdPayloads.length, 1);
  }
  finally {
    restore();
  }
});

test("lost acknowledgements are recovered from purchase document markers without duplication", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 1_000 });
  const item = actor.addItem({
    name: "Arrows",
    type: "consumable",
    system: { quantity: 5 },
    flags: { [MODULE_ID]: { sourceType: "gear", sourceId: "arrows" } }
  });
  const restore = installFoundry({ actors: [actor] });
  const operations = new TraderService(createModuleApi()).createFoundryTradeOperations();
  const transaction = createPurchaseTransaction();

  try {
    item.throwAfterUpdateOnce = true;
    await assert.rejects(operations.applyPurchaseItem(transaction), /acknowledgement/);
    assert.equal(item.system.quantity, 25);
    assert.equal((await operations.readPurchaseReceipts(transaction)).itemApplied, true);
    await operations.applyPurchaseItem(transaction);
    assert.equal(item.updatePatches.length, 1);

    actor.throwAfterUpdateOnce = true;
    await assert.rejects(operations.applyPurchaseCurrency(transaction), /acknowledgement/);
    assert.equal(actor.system.currency.gp, 8);
    assert.equal((await operations.readPurchaseReceipts(transaction)).currencyApplied, true);
    await operations.applyPurchaseCurrency(transaction);
    assert.equal(actor.updatePatches.length, 1);
  }
  finally {
    restore();
  }
});

test("purchase compensation removes only its exact deltas and preserves later Item changes", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 1_000 });
  const restore = installFoundry({ actors: [actor] });
  const operations = new TraderService(createModuleApi()).createFoundryTradeOperations();
  const transaction = createPurchaseTransaction({
    transactionId: "purchase_compensate_01",
    item: {
      itemId: "",
      itemUuid: "",
      beforeQuantity: 0,
      afterQuantity: 3,
      delta: 3,
      created: true,
      rawItemData: {
        name: "Iron",
        type: "loot",
        system: { quantity: 3 },
        flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron" } }
      }
    }
  });

  try {
    await operations.applyPurchaseItem(transaction);
    await operations.applyPurchaseCurrency(transaction);
    const createdItem = actor.items.contents[0];
    createdItem.system.quantity += 2;
    actor.system.currency.cp += 7;

    await operations.compensatePurchaseCurrency(transaction);
    assert.equal(actor.system.currency.gp, 10);
    assert.equal(actor.system.currency.cp, 7);
    assert.equal(getProperty(
      actor,
      `flags.${MODULE_ID}.tradeReceipts.${transaction.transactionId}.applied`
    ), false);

    await operations.compensatePurchaseItem(transaction);
    assert.equal(createdItem.system.quantity, 2);
    assert.equal(createdItem.deleteCalls, 0);
    assert.equal(getProperty(
      createdItem,
      `flags.${MODULE_ID}.tradeTransactions.${transaction.transactionId}.applied`
    ), false);
    assert.deepEqual(await operations.readPurchaseReceipts(transaction), {
      itemApplied: false,
      currencyApplied: false,
      itemId: "",
      itemUuid: ""
    });
  }
  finally {
    restore();
  }
});

test("partial and full sales atomically retain quantity markers including a zero tombstone", async () => {
  const partialActor = new FakeActor({ id: "actor-1", copper: 100 });
  const partialItem = partialActor.addItem({
    name: "Iron",
    type: "loot",
    system: { quantity: 5 },
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron" } }
  });
  const fullActor = new FakeActor({ id: "actor-2", copper: 100, ownership: { "player-1": 3 } });
  const fullItem = fullActor.addItem({
    name: "Silver",
    type: "loot",
    system: { quantity: 2 },
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "silver" } }
  });
  const restore = installFoundry({ actors: [partialActor, fullActor] });
  const operations = new TraderService(createModuleApi()).createFoundryTradeOperations();
  const partial = createSaleTransaction();
  const full = createSaleTransaction();
  full.transactionId = "sale_full_tombstone_01";
  full.request.actorId = fullActor.id;
  full.request.itemUuid = fullItem.uuid;
  full.request.quantity = 2;
  full.item.itemId = fullItem.id;
  full.item.itemUuid = fullItem.uuid;
  full.item.beforeQuantity = 2;
  full.item.afterQuantity = 0;
  full.item.delta = -2;
  full.item.rawItemData.name = "Silver";
  full.item.rawItemData.system.quantity = 2;
  full.item.rawItemData.flags[MODULE_ID].sourceId = "silver";

  try {
    await operations.applySaleItem(partial);
    await operations.applySaleItem(full);

    for (const [item, transaction, expectedQuantity] of [
      [partialItem, partial, 3],
      [fullItem, full, 0]
    ]) {
      assert.equal(item.updatePatches.length, 1);
      assert.equal(item.updatePatches[0]["system.quantity"], expectedQuantity);
      const marker = item.updatePatches[0][`flags.${MODULE_ID}.tradeTransactions`]
        [transaction.transactionId];
      assert.equal(marker.kind, "sale");
      assert.equal(marker.applied, true);
      assert.equal(marker.delta, -2);
      assert.equal(marker.before, transaction.item.beforeQuantity);
      assert.equal(marker.after, expectedQuantity);
      assert.equal(item.deleteCalls, 0);
      assert.deepEqual(await operations.readSaleReceipts(transaction), {
        itemRemoved: true,
        currencyApplied: false
      });
    }

    await operations.applySaleItem(partial);
    await operations.applySaleItem(full);
    assert.equal(partialItem.updatePatches.length, 1);
    assert.equal(fullItem.updatePatches.length, 1);
  }
  finally {
    restore();
  }
});

test("sale payout receipts recover lost acknowledgements without removing or paying twice", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 100 });
  const item = actor.addItem({
    name: "Iron",
    type: "loot",
    system: { quantity: 5 },
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron" } }
  });
  const restore = installFoundry({ actors: [actor] });
  const operations = new TraderService(createModuleApi()).createFoundryTradeOperations();
  const transaction = createSaleTransaction();

  try {
    item.throwAfterUpdateOnce = true;
    await assert.rejects(operations.applySaleItem(transaction), /acknowledgement/);
    assert.equal(item.system.quantity, 3);
    assert.equal((await operations.readSaleReceipts(transaction)).itemRemoved, true);
    await operations.applySaleItem(transaction);
    assert.equal(item.updatePatches.length, 1);

    actor.throwAfterUpdateOnce = true;
    await assert.rejects(operations.applySaleCurrency(transaction), /acknowledgement/);
    assert.equal(actor.system.currency.gp, 2);
    assert.equal(actor.system.currency.sp, 2);
    const receipt = getProperty(
      actor,
      `flags.${MODULE_ID}.tradeReceipts.${transaction.transactionId}`
    );
    assert.equal(receipt.kind, "sale");
    assert.equal(receipt.applied, true);
    assert.equal(receipt.deltaCopper, 120);
    assert.equal(receipt.beforeCopper, 100);
    assert.equal(receipt.afterCopper, 220);
    assert.deepEqual(await operations.readSaleReceipts(transaction), {
      itemRemoved: true,
      currencyApplied: true
    });

    await operations.applySaleCurrency(transaction);
    assert.equal(actor.updatePatches.length, 1);
  }
  finally {
    restore();
  }
});

test("sale compensation reverses exact payout and restores only the sold Item delta", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 100 });
  const item = actor.addItem({
    name: "Iron",
    type: "loot",
    system: { quantity: 5 },
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron" } }
  });
  const restore = installFoundry({ actors: [actor] });
  const operations = new TraderService(createModuleApi()).createFoundryTradeOperations();
  const transaction = createSaleTransaction();

  try {
    await operations.applySaleItem(transaction);
    await operations.applySaleCurrency(transaction);
    item.system.quantity += 1;
    actor.system.currency.cp += 7;

    await operations.compensateSaleCurrency(transaction);
    assert.equal(actor.system.currency.gp, 1);
    assert.equal(actor.system.currency.cp, 7);
    assert.equal(getProperty(
      actor,
      `flags.${MODULE_ID}.tradeReceipts.${transaction.transactionId}.applied`
    ), false);

    await operations.compensateSaleItem(transaction);
    assert.equal(item.system.quantity, 6);
    assert.equal(getProperty(
      item,
      `flags.${MODULE_ID}.tradeTransactions.${transaction.transactionId}.applied`
    ), false);
    assert.deepEqual(await operations.readSaleReceipts(transaction), {
      itemRemoved: false,
      currencyApplied: false
    });

    await operations.compensateSaleCurrency(transaction);
    await operations.compensateSaleItem(transaction);
    assert.equal(actor.updatePatches.length, 2);
    assert.equal(item.updatePatches.length, 2);
  }
  finally {
    restore();
  }
});

test("sale Item compensation recreates externally removed data and recovers a lost create acknowledgement", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 100 });
  const item = actor.addItem({
    name: "Iron",
    type: "loot",
    img: "iron.webp",
    system: { quantity: 2 },
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron" } }
  });
  const restore = installFoundry({ actors: [actor] });
  const operations = new TraderService(createModuleApi()).createFoundryTradeOperations();
  const transaction = createSaleTransaction();
  transaction.item.beforeQuantity = 2;
  transaction.item.afterQuantity = 0;
  transaction.item.delta = -2;
  transaction.item.rawItemData.system.quantity = 2;

  try {
    await operations.applySaleItem(transaction);
    await item.delete();
    assert.equal(actor.items.contents.length, 0);

    actor.throwAfterCreateOnce = true;
    await assert.rejects(
      operations.compensateSaleItem(transaction),
      /acknowledgement/
    );
    assert.equal(actor.createdPayloads.length, 1);
    const restoredItem = actor.items.contents[0];
    assert.equal(restoredItem.name, "Iron");
    assert.equal(restoredItem.img, "iron.webp");
    assert.equal(restoredItem.system.quantity, 2);
    const marker = getProperty(
      restoredItem,
      `flags.${MODULE_ID}.tradeTransactions.${transaction.transactionId}`
    );
    assert.equal(marker.kind, "sale");
    assert.equal(marker.applied, false);
    assert.equal(marker.phase, "compensated");
    assert.equal(marker.delta, -2);
    assert.deepEqual(await operations.readSaleReceipts(transaction), {
      itemRemoved: false,
      currencyApplied: false
    });

    await operations.compensateSaleItem(transaction);
    assert.equal(actor.createdPayloads.length, 1);
  }
  finally {
    restore();
  }
});

test("missing sale Items and contradictory markers are never treated as applied receipts", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 100 });
  const restore = installFoundry({ actors: [actor] });
  const operations = new TraderService(createModuleApi()).createFoundryTradeOperations();
  const transaction = createSaleTransaction();

  try {
    assert.deepEqual(await operations.readSaleReceipts(transaction), {
      itemRemoved: false,
      currencyApplied: false
    });

    const item = actor.addItem({
      name: "Iron",
      type: "loot",
      system: { quantity: 3 },
      flags: {
        [MODULE_ID]: {
          sourceType: "material",
          sourceId: "iron",
          tradeTransactions: {
            [transaction.transactionId]: {
              transactionId: transaction.transactionId,
              kind: "purchase",
              applied: true,
              phase: "applied",
              actorId: actor.id,
              itemId: "wrong-item",
              itemUuid: "Actor.actor-1.Item.wrong-item",
              created: false,
              delta: -2,
              before: 5,
              after: 3,
              updatedAt: 1
            }
          }
        }
      }
    });
    transaction.item.itemId = item.id;
    transaction.item.itemUuid = item.uuid;
    transaction.request.itemUuid = item.uuid;
    setProperty(actor, `flags.${MODULE_ID}.tradeReceipts.${transaction.transactionId}`, {
      transactionId: transaction.transactionId,
      kind: "sale",
      applied: true,
      phase: "applied",
      actorId: actor.id,
      deltaCopper: 999,
      beforeCopper: 100,
      afterCopper: 220,
      updatedAt: 1
    });

    assert.deepEqual(await operations.readSaleReceipts(transaction), {
      itemRemoved: false,
      currencyApplied: false
    });
    await assert.rejects(operations.applySaleItem(transaction), /маркер|marker|конфликт/i);
    await assert.rejects(operations.applySaleCurrency(transaction), /квитанц|receipt|конфликт/i);
    assert.equal(item.updatePatches.length, 0);
    assert.equal(actor.updatePatches.length, 0);

    setProperty(item, `flags.${MODULE_ID}.tradeTransactions.${transaction.transactionId}`, {
      transactionId: transaction.transactionId,
      kind: "sale",
      applied: true,
      phase: "compensated",
      actorId: actor.id,
      itemId: item.id,
      itemUuid: item.uuid,
      created: false,
      delta: -2,
      before: 5,
      after: 3,
      updatedAt: 2
    });
    setProperty(actor, `flags.${MODULE_ID}.tradeReceipts.${transaction.transactionId}`, {
      transactionId: transaction.transactionId,
      kind: "sale",
      applied: true,
      phase: "compensated",
      actorId: actor.id,
      deltaCopper: 120,
      beforeCopper: 100,
      afterCopper: 220,
      updatedAt: 2
    });
    assert.deepEqual(await operations.readSaleReceipts(transaction), {
      itemRemoved: false,
      currencyApplied: false
    });
  }
  finally {
    restore();
  }
});

test("stale Item quantity and Actor currency fail without clobbering unrelated changes", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 999 });
  const item = actor.addItem({
    name: "Arrows",
    type: "consumable",
    system: { quantity: 6 },
    flags: { [MODULE_ID]: { sourceType: "gear", sourceId: "arrows" } }
  });
  const restore = installFoundry({ actors: [actor] });
  const operations = new TraderService(createModuleApi()).createFoundryTradeOperations();
  const transaction = createPurchaseTransaction();
  const currencyBefore = clone(actor.system.currency);

  try {
    await assert.rejects(
      operations.applyPurchaseItem(transaction),
      /количество|quantity|измен/i
    );
    await assert.rejects(
      operations.applyPurchaseCurrency(transaction),
      /баланс|currency|fund/i
    );
    assert.equal(item.updatePatches.length, 0);
    assert.equal(item.system.quantity, 6);
    assert.equal(actor.updatePatches.length, 0);
    assert.deepEqual(actor.system.currency, currencyBefore);
  }
  finally {
    restore();
  }
});

test("Actor receipts and Item markers retain all nonterminal rows plus the latest 64 terminal entries", async () => {
  const terminalMarkers = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [
    `terminal_${String(index).padStart(2, "0")}`,
    { updatedAt: index }
  ]));
  const retainedMarkers = {
    ...terminalMarkers,
    nonterminal_prepared: { updatedAt: -2 },
    nonterminal_reconciliation: { updatedAt: -1 }
  };
  const actor = new FakeActor({ id: "actor-1", copper: 1_000 });
  actor.flags = {
    [MODULE_ID]: { tradeReceipts: clone(retainedMarkers) }
  };
  const item = actor.addItem({
    name: "Arrows",
    type: "consumable",
    system: { quantity: 5 },
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        sourceId: "arrows",
        tradeTransactions: clone(retainedMarkers)
      }
    }
  });
  const stateRepository = {
    read() {
      return {
        tradeLog: [
          { transactionId: "nonterminal_prepared", status: "prepared" },
          {
            transactionId: "nonterminal_reconciliation",
            status: "reconciliation-required"
          }
        ]
      };
    }
  };
  const restore = installFoundry({ actors: [actor] });
  const operations = new TraderService(createModuleApi(), { stateRepository })
    .createFoundryTradeOperations();
  const transaction = createPurchaseTransaction();

  try {
    await operations.applyPurchaseItem(transaction);
    await operations.applyPurchaseCurrency(transaction);

    const itemMarkers = getProperty(item, `flags.${MODULE_ID}.tradeTransactions`);
    const actorReceipts = getProperty(actor, `flags.${MODULE_ID}.tradeReceipts`);
    for (const markers of [itemMarkers, actorReceipts]) {
      assert.equal(Object.keys(markers).length, 67);
      assert.ok(markers[transaction.transactionId]);
      assert.ok(markers.nonterminal_prepared);
      assert.ok(markers.nonterminal_reconciliation);
      assert.equal(markers.terminal_05, undefined);
      assert.ok(markers.terminal_06);
      assert.ok(markers.terminal_69);
    }
  }
  finally {
    restore();
  }
});

test("sale workflow pays only after the Foundry Item marker is durable", async () => {
  const actor = new FakeActor({ id: "actor-1", copper: 100 });
  const item = actor.addItem({
    name: "Iron",
    type: "loot",
    system: { quantity: 5 },
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron" } }
  });
  const state = { version: 1, order: [], traders: {}, tradeLog: [] };
  const repository = {
    read() {
      return state;
    },
    async mutate(mutator) {
      return mutator(state);
    },
    findTransaction(transactionId) {
      return state.tradeLog.find((row) => row.transactionId === transactionId) ?? null;
    },
    async mutateTransaction(transactionId, mutator) {
      const row = state.tradeLog.find((entry) => entry.transactionId === transactionId);
      assert.ok(row);
      return mutator(row, state);
    }
  };
  const restore = installFoundry({ actors: [actor] });
  const service = new TraderService(createModuleApi(), { stateRepository: repository });
  service.createSalePreview = async () => ({
    actorId: actor.id,
    actorName: actor.name,
    cityName: "City",
    traderName: "Armorer",
    itemUuid: item.uuid,
    itemId: item.id,
    itemName: item.name,
    sourceType: "material",
    sourceId: "iron",
    grossOfferCopper: 70,
    taxCopper: 10,
    netPayoutCopper: 60
  });
  const operations = service.createFoundryTradeOperations();
  service.setTransactionService(new TradeTransactionService({ repository, operations }));
  const events = [];
  const itemUpdate = item.update.bind(item);
  item.update = async (patch) => {
    events.push(["item", clone(patch)]);
    return itemUpdate(patch);
  };
  const actorUpdate = actor.update.bind(actor);
  actor.update = async (patch) => {
    events.push(["actor", clone(patch)]);
    return actorUpdate(patch);
  };

  try {
    const result = await service.sellItem("city-1", "shop-1", {
      actorId: actor.id,
      itemUuid: item.uuid,
      netPayoutCopper: 999_999
    }, 2, {
      transactionId: "sale_integration_001",
      requestedByUserId: "player-1"
    });

    assert.equal(result.netPayoutCopper, 120);
    assert.deepEqual(events.map(([kind]) => kind), ["item", "actor"]);
    assert.ok(events[0][1][`flags.${MODULE_ID}.tradeTransactions`]
      .sale_integration_001);
    assert.ok(events[1][1][`flags.${MODULE_ID}.tradeReceipts`]
      .sale_integration_001);
    assert.equal(state.tradeLog[0].status, "committed");
    assert.equal(item.system.quantity, 3);
    assert.equal(actor.system.currency.gp, 2);
    assert.equal(actor.system.currency.sp, 2);
  }
  finally {
    restore();
  }
});
