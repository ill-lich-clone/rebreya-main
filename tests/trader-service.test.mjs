import test from "node:test";
import assert from "node:assert/strict";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { resolveGearItemIcon } from "../scripts/data/gear-icon-resolver.js";
import {
  TraderService,
  createEmptyTraderState,
  normalizeTraderState
} from "../scripts/data/trader-service.js";
import { TraderStateRepository } from "../scripts/infrastructure/foundry/trader-state-repository.js";

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

function createActiveTraderStateRepository(gameProvider = () => globalThis.game) {
  const coordinator = new WorldMutationCoordinator();
  return new TraderStateRepository({
    mutationGateway: {
      commit(key, operation) {
        return coordinator.run(key, () => operation(Object.freeze({
          assertActiveGm() {}
        })));
      }
    },
    gameProvider,
    normalizeState: normalizeTraderState
  });
}

function installFoundryUtils() {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    utils: {
      deepClone: (value) => JSON.parse(JSON.stringify(value)),
      escapeHTML: (value) => String(value ?? "")
        .replace(/&/gu, "&amp;")
        .replace(/</gu, "&lt;")
        .replace(/>/gu, "&gt;")
        .replace(/"/gu, "&quot;")
        .replace(/'/gu, "&#39;"),
      getProperty: (source, path) => String(path ?? "").split(".").reduce((current, part) => current?.[part], source),
      mergeObject: (target, source) => ({ ...target, ...source }),
      setProperty: (source, path, value) => {
        const parts = String(path ?? "").split(".");
        let cursor = source;
        for (const [index, part] of parts.entries()) {
          if (index === parts.length - 1) {
            cursor[part] = value;
            return;
          }

          cursor[part] ??= {};
          cursor = cursor[part];
        }
      }
    }
  };
  return () => {
    globalThis.foundry = previousFoundry;
  };
}

test("resetAssortments aborts before persistence when authority changes during model loading", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const modelRequested = createDeferred();
  const releaseModel = createDeferred();
  let settingWrites = 0;
  let authorityActive = true;
  const guard = () => {
    if (!authorityActive) {
      throw new Error("calendar execution context changed");
    }
  };

  globalThis.game = {
    user: { id: "gm", isGM: true },
    settings: {
      get: () => createEmptyTraderState(),
      set: async () => {
        settingWrites += 1;
      }
    }
  };
  const service = new TraderService({
    async getModel() {
      modelRequested.resolve();
      return releaseModel.promise;
    }
  }, { stateRepository: createActiveTraderStateRepository() });

  try {
    const resetting = service.resetAssortments({
      groupId: "group-1",
      guard,
      assertExecutionContext: guard
    });
    await modelRequested.promise;
    authorityActive = false;
    releaseModel.resolve({});

    await assert.rejects(resetting, /calendar execution context changed/u);
    assert.equal(settingWrites, 0);
  }
  finally {
    releaseModel.resolve({});
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("trader snapshot resolves gear icons from the shared gear icon lookup", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;

  let state = null;
  const gearItem = {
    id: "odezhda-obychnaya",
    name: "Одежда, обычная",
    equipmentType: "Снаряжение",
    shopSubtype: "Портняжная лавка",
    priceValue: 5,
    priceGoldEquivalent: 5,
    rank: 0,
    weight: 2,
    description: "Простая добротная одежда."
  };
  const iconLookup = new Map([
    ["одежда обычная", "modules/rebreya-main/templates/icons/Goods/%D0%9E%D0%B4%D0%B5%D0%B6%D0%B4%D0%B0%2C%20%D0%BE%D0%B1%D1%8B%D1%87%D0%BD%D0%B0%D1%8F.webp"]
  ]);
  const model = {
    materials: [],
    materialById: new Map(),
    materialByGoodId: new Map(),
    gear: [gearItem],
    gearById: new Map([[gearItem.id, gearItem]]),
    reference: {},
    goods: []
  };
  const citySnapshot = {
    id: "city-1",
    name: "Тестоград",
    state: "state-1",
    regionName: "Регион",
    rank: 1,
    cityType: "столичный",
    goodsRows: [],
    goodsRowById: {}
  };

  globalThis.canvas = {
    tokens: {
      controlled: []
    }
  };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    actors: {
      get: () => null,
      contents: []
    },
    settings: {
      get: () => state,
      set: async (_moduleId, _key, nextState) => {
        state = nextState;
      }
    }
  };

  const service = new TraderService({
    getModel: async () => model,
    getCitySnapshot: (cityId) => cityId === citySnapshot.id ? citySnapshot : null,
    getCalendarSnapshot: () => ({ year: 1200, month: 3 }),
    getGearIconLookup: async () => iconLookup,
    inventoryService: {
      getInventoryActor: async () => null
    },
    globalEventsService: {
      collectMerchantModifiers: () => ({
        buyPricePercent: 0,
        sellPricePercent: 0,
        stockPercent: 0,
        blocked: false,
        rarityShift: 0,
        restockMode: "",
        sourceEventNames: []
      })
    },
    getEffectiveStatePolicy: () => ({
      taxPercent: 0,
      generalDutyPercent: 0,
      bilateralDuties: {},
      eventDelta: {
        sourceEventNames: []
      }
    })
  }, { stateRepository: createActiveTraderStateRepository() });

  try {
    const snapshot = await service.getTraderSnapshot(citySnapshot.id, "shop-tailor-shop");

    assert.equal(snapshot.inventory.length, 1);
    assert.equal(snapshot.inventory[0].name, gearItem.name);
    assert.equal(snapshot.inventory[0].img, resolveGearItemIcon(gearItem, { iconLookup }));
    assert.notEqual(snapshot.inventory[0].img, "icons/svg/item-bag.svg");
  }
  finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    restoreFoundry();
  }
});

test("trader snapshot refreshes stale monthly assortment on first GM open even when the plan signature is unchanged", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;

  let currentMonth = 3;
  let state = createEmptyTraderState();
  const goodRow = {
    goodId: "iron-good",
    goodName: "Железо",
    production: 10,
    demand: 0,
    surplus: 5,
    deficit: 0,
    priceModifierPercent: 0,
    routePriceModifierPercent: 0,
    eventPriceModifierPercent: 0,
    importSources: [],
    eventSourceNames: []
  };
  const material = {
    id: "iron",
    name: "Железо",
    linkedGoodId: goodRow.goodId,
    linkedGoodName: goodRow.goodName,
    priceGold: 2,
    weight: 1,
    rank: 1,
    type: "Материал"
  };
  const model = {
    materials: [material],
    materialById: new Map([[material.id, material]]),
    materialByGoodId: new Map([[material.linkedGoodId, material]]),
    gear: [],
    gearById: new Map(),
    reference: {},
    goods: []
  };
  const citySnapshot = {
    id: "city-1",
    name: "Тестоград",
    state: "state-1",
    regionName: "Регион",
    rank: 1,
    cityType: "столичный",
    goodsRows: [goodRow],
    goodsRowById: {
      [goodRow.goodId]: goodRow
    }
  };

  globalThis.canvas = {
    tokens: {
      controlled: []
    }
  };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    actors: {
      get: () => null,
      contents: []
    },
    settings: {
      get: () => state,
      set: async (_moduleId, _key, nextState) => {
        state = nextState;
      }
    }
  };

  const service = new TraderService({
    getModel: async () => model,
    getCitySnapshot: (cityId) => cityId === citySnapshot.id ? citySnapshot : null,
    getCalendarSnapshot: () => ({ year: 1200, month: currentMonth }),
    inventoryService: {
      getInventoryActor: async () => null
    },
    globalEventsService: {
      collectMerchantModifiers: () => ({
        buyPricePercent: 0,
        sellPricePercent: 0,
        stockPercent: 0,
        blocked: false,
        rarityShift: 0,
        restockMode: "",
        sourceEventNames: []
      })
    },
    getEffectiveStatePolicy: () => ({
      taxPercent: 0,
      generalDutyPercent: 0,
      bilateralDuties: {},
      eventDelta: {
        sourceEventNames: []
      }
    })
  }, { stateRepository: createActiveTraderStateRepository() });

  try {
    const firstSnapshot = await service.getTraderSnapshot(citySnapshot.id, "materials-shop");
    const traderId = `${citySnapshot.id}::materials-shop`;
    assert.equal(firstSnapshot.inventory[0].quantity, 5);
    assert.equal(state.traders[traderId].assortmentSeedSalt, "1200-03");

    currentMonth = 4;
    const secondSnapshot = await service.getTraderSnapshot(citySnapshot.id, "materials-shop");

    assert.equal(secondSnapshot.inventory[0].quantity, 5);
    assert.equal(state.traders[traderId].assortmentSeedSalt, "1200-04");
    assert.equal(state.traders[traderId].assortmentStatus, "updated");
  }
  finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    restoreFoundry();
  }
});

test("city trader summaries do not generate unopened shop inventories", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;

  let state = createEmptyTraderState();
  const goodRow = {
    goodId: "wood-good",
    goodName: "Древесина",
    production: 20,
    demand: 0,
    surplus: 12,
    deficit: 0,
    priceModifierPercent: 0,
    importSources: []
  };
  const material = {
    id: "wood",
    name: "Древесина",
    linkedGoodId: goodRow.goodId,
    linkedGoodName: goodRow.goodName,
    priceGold: 1,
    weight: 1,
    rank: 1,
    type: "Материал"
  };
  const model = {
    materials: [material],
    materialById: new Map([[material.id, material]]),
    materialByGoodId: new Map([[material.linkedGoodId, material]]),
    gear: [],
    gearById: new Map(),
    reference: {},
    goods: []
  };
  const citySnapshot = {
    id: "city-1",
    name: "Тестоград",
    state: "state-1",
    regionName: "Регион",
    rank: 1,
    cityType: "столичный",
    goodsRows: [goodRow],
    goodsRowById: {
      [goodRow.goodId]: goodRow
    }
  };

  globalThis.game = {
    user: { id: "gm", isGM: true },
    settings: {
      get: () => state,
      set: async (_moduleId, _key, nextState) => {
        state = nextState;
      }
    }
  };

  const service = new TraderService({
    getModel: async () => model,
    getCitySnapshot: (cityId) => cityId === citySnapshot.id ? citySnapshot : null,
    getCalendarSnapshot: () => ({ year: 1200, month: 5 })
  });

  try {
    const summaries = await service.getCityTraderSummaries(citySnapshot.id);
    const materialsSummary = summaries.find((entry) => entry.traderKey === "materials-shop");

    assert.equal(Object.keys(state.traders).length, 0);
    assert.equal(materialsSummary.totalDistinctItems, 0);
    assert.equal(materialsSummary.totalQuantity, 0);
    assert.equal(materialsSummary.statusLabel, "Готов к открытию");
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("trader purchase expands ammunition packs into actor item quantity", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;

  const createdItems = [];
  const buyer = {
    id: "buyer-1",
    name: "Покупатель",
    img: "",
    isOwner: true,
    system: {
      currency: {
        pp: 0,
        gp: 10,
        ep: 0,
        sp: 0,
        cp: 0
      }
    },
    ownership: {
      player: 3
    },
    getFlag: () => false,
    items: {
      contents: []
    },
    createEmbeddedDocuments: async (type, documents) => {
      assert.equal(type, "Item");
      createdItems.push(...documents);
      return documents.map((document, index) => ({
        ...document,
        id: `created-${index + 1}`,
        uuid: `Actor.buyer-1.Item.created-${index + 1}`
      }));
    },
    update: async (patch) => {
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(buyer, path, value);
      }
    }
  };
  const arrows = {
    id: "strely-20",
    name: "Стрелы (20)",
    equipmentType: "Боеприпас",
    shopSubtype: "Оружейная лавка",
    priceText: "1 зм",
    priceGoldEquivalent: 1,
    rank: 1,
    weight: 1,
    description: "стандартные стрелы для коротких и длинных луков.",
    predominantMaterialId: "zhelezo",
    predominantMaterialName: "Железо",
    linkedTool: "Кузнеца"
  };
  const model = {
    materials: [],
    materialById: new Map(),
    materialByGoodId: new Map(),
    gear: [arrows],
    gearById: new Map([[arrows.id, arrows]]),
    reference: {},
    goods: []
  };
  const citySnapshot = {
    id: "city-1",
    name: "Тестоград",
    state: "state-1",
    regionName: "Регион",
    rank: 1,
    cityType: "военный",
    goodsRows: [],
    goodsRowById: {}
  };
  let state = {
    version: 1,
    order: ["city-1::shop-armory"],
    traders: {
      "city-1::shop-armory": {
        traderId: "city-1::shop-armory",
        cityId: citySnapshot.id,
        traderKey: "shop-armory",
        traderType: "shop",
        planSignature: "stale-ok-for-player-test",
        portrait: "",
        description: "",
        inventory: [{
          itemKey: "gear:strely-20",
          sourceType: "gear",
          sourceId: "strely-20",
          name: "Стрелы (20)",
          quantity: 1,
          basePriceGold: 1,
          baseWeight: 1,
          rank: 1,
          itemTypeLabel: "Боеприпас",
          predominantMaterialId: "zhelezo",
          predominantMaterialName: "Железо",
          linkedTool: "Кузнеца",
          shopSubtype: "Оружейная лавка",
          rawItemData: null
        }]
      }
    },
    tradeLog: []
  };

  globalThis.canvas = {
    tokens: {
      controlled: []
    }
  };
  globalThis.game = {
    user: { id: "player", isGM: false, character: buyer },
    actors: {
      get: (id) => (id === buyer.id ? buyer : null),
      contents: [buyer]
    },
    users: {
      get: () => null,
      contents: []
    },
    settings: {
      get: () => state,
      set: async (_moduleId, _key, nextState) => {
        state = nextState;
      }
    }
  };

  const service = new TraderService({
    getModel: async () => model,
    getCitySnapshot: (cityId) => cityId === citySnapshot.id ? citySnapshot : null,
    getCalendarSnapshot: () => ({ year: 1200, month: 3 }),
    getGearIconLookup: async () => new Map(),
    inventoryService: {
      getInventoryActor: async () => buyer
    },
    globalEventsService: {
      collectMerchantModifiers: () => ({
        buyPricePercent: 0,
        sellPricePercent: 0,
        stockPercent: 0,
        blocked: false,
        rarityShift: 0,
        restockMode: "",
        sourceEventNames: []
      })
    },
    getEffectiveStatePolicy: () => ({
      taxPercent: 0,
      generalDutyPercent: 0,
      bilateralDuties: {},
      eventDelta: {
        sourceEventNames: []
      }
    })
  });

  try {
    await service.purchaseItem(citySnapshot.id, "shop-armory", "gear:strely-20", 1, { actorId: buyer.id });

    assert.equal(createdItems.length, 1);
    assert.equal(createdItems[0].name, "Стрелы");
    assert.equal(createdItems[0].type, "consumable");
    assert.equal(createdItems[0].system.quantity, 20);
    assert.equal(createdItems[0].system.weight.value, 0.05);
    assert.deepEqual(createdItems[0].system.price, { value: 5, denomination: "cp" });
    assert.equal(createdItems[0].system.type.value, "ammo");
    assert.equal(createdItems[0].system.type.subtype, "arrow");
    assert.equal(createdItems[0].flags["rebreya-main"].sourcePackQuantity, 20);
    assert.equal(createdItems[0].flags["rebreya-main"].sourcePackPriceGoldEquivalent, 1);
    assert.equal(createdItems[0].flags["rebreya-main"].priceGoldEquivalent, 0.05);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    restoreFoundry();
  }
});

test("recordTradeAudit retains every nonterminal row and only the newest twenty terminal rows", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const nonterminalIds = ["prepared_service_001", "reconcile_service_01"];
  let state = {
    version: 1,
    order: [],
    traders: {},
    tradeLog: [
      {
        transactionId: nonterminalIds[0],
        status: "prepared",
        updatedAt: 1,
        request: { quantity: 1 }
      },
      {
        transactionId: nonterminalIds[1],
        status: "reconciliation-required",
        updatedAt: 2,
        request: { quantity: 1 }
      },
      ...Array.from({ length: 23 }, (_value, index) => ({
        transactionId: `terminal_service_${String(index).padStart(8, "0")}`,
        status: "committed",
        createdAt: index + 1,
        request: { quantity: 1 }
      }))
    ]
  };

  globalThis.game = {
    user: { id: "gm", isGM: true },
    actors: { get: () => null },
    settings: {
      get: () => state,
      set: async (_moduleId, _key, nextState) => {
        state = nextState;
      }
    }
  };

  try {
    const service = new TraderService({}, {
      stateRepository: createActiveTraderStateRepository()
    });
    await service.recordTradeAudit({
      id: "legacy-new-audit",
      type: "purchase",
      createdAt: 1000,
      quantity: 1,
      totalCopper: 10
    });

    const nonterminal = state.tradeLog.filter((row) => (
      row.status === "prepared" || row.status === "reconciliation-required"
    ));
    const terminal = state.tradeLog.filter((row) => (
      row.status === "committed" || row.status === "compensated"
    ));

    assert.deepEqual(nonterminal.map((row) => row.transactionId), nonterminalIds);
    assert.equal(terminal.length, 20);
    assert.equal(state.tradeLog.length, 22);
    assert.equal(state.tradeLog.some((row) => row.transactionId === "legacy-new-audit"), true);
    assert.equal(state.tradeLog.find((row) => row.transactionId === "legacy-new-audit")?.legacy, true);
    assert.equal(state.tradeLog.some((row) => row.transactionId === "terminal_service_00000004"), true);
    assert.equal(state.tradeLog.some((row) => row.transactionId === "terminal_service_00000003"), false);
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("TraderService treats mutation without TraderStateRepository as a configuration error", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  let directWrites = 0;
  globalThis.game = {
    user: { id: "gm", isGM: true },
    actors: { get: () => null },
    settings: {
      get: () => ({ version: 1, traders: {}, order: [], tradeLog: [] }),
      set: async () => {
        directWrites += 1;
      }
    }
  };

  try {
    const service = new TraderService({});
    await assert.rejects(
      service.recordTradeAudit({ actorId: "actor-a", type: "purchase" }),
      /Trader state repository is unavailable/u
    );
    assert.equal(directWrites, 0);
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("recordTradeAudit overwrites payload sender identity with the authoritative sender", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  let state = createEmptyTraderState();
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: {
      get: (id) => ({ id, name: id === "player-a" ? "Player A" : "GM" })
    },
    actors: { get: () => null },
    settings: {
      get: () => state,
      set: async (_moduleId, _key, nextState) => {
        state = nextState;
      }
    }
  };

  try {
    const service = new TraderService({}, {
      stateRepository: createActiveTraderStateRepository()
    });
    await service.recordTradeAudit({
      actorId: "actor-a",
      senderId: "forged-sender",
      senderName: "Forged sender",
      type: "purchase"
    }, { senderId: "player-a" });

    assert.equal(state.tradeLog[0].senderId, "player-a");
    assert.equal(state.tradeLog[0].senderName, "Player A");
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("injected Trader state repository serializes legacy audit and transaction writers", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const transactionId = "transaction_queue_01";
  const firstWriteGate = createDeferred();
  let state = {
    version: 1,
    order: [],
    traders: {},
    tradeLog: [{
      transactionId,
      status: "prepared",
      updatedAt: 1,
      request: { quantity: 1 }
    }]
  };
  let inFlightWrites = 0;
  let maxInFlightWrites = 0;
  const savedTransactionStatuses = [];

  const game = {
    user: { id: "gm", isGM: true },
    actors: { get: () => null },
    settings: {
      get: () => state,
      set: async (_moduleId, _key, nextState) => {
        inFlightWrites += 1;
        maxInFlightWrites = Math.max(maxInFlightWrites, inFlightWrites);
        savedTransactionStatuses.push(
          nextState.tradeLog.find((row) => row.transactionId === transactionId)?.status
        );
        if (savedTransactionStatuses.length === 1) {
          await firstWriteGate.promise;
        }
        state = nextState;
        inFlightWrites -= 1;
        return nextState;
      }
    }
  };
  globalThis.game = game;
  const mutationCoordinator = new WorldMutationCoordinator();
  const repository = new TraderStateRepository({
    mutationGateway: {
      commit(_key, operation) {
        return mutationCoordinator.run(
          "setting:traderState",
          () => operation(Object.freeze({ assertActiveGm() {} }))
        );
      }
    },
    gameProvider: () => game,
    normalizeState: normalizeTraderState
  });
  const service = new TraderService({}, { stateRepository: repository });

  try {
    const legacyWrite = service.recordTradeAudit({
      id: "legacy-queued-audit",
      type: "purchase",
      createdAt: 100,
      quantity: 1,
      totalCopper: 10
    });
    const transactionWrite = repository.mutateTransaction(transactionId, (row) => {
      row.status = "applying";
      row.phase = "item-applied";
    });

    await flushTasks();
    assert.equal(maxInFlightWrites, 1);
    assert.deepEqual(savedTransactionStatuses, ["prepared"]);

    firstWriteGate.resolve();
    await Promise.all([legacyWrite, transactionWrite]);

    assert.equal(maxInFlightWrites, 1);
    assert.deepEqual(savedTransactionStatuses, ["prepared", "applying"]);
    assert.equal(
      state.tradeLog.find((row) => row.transactionId === transactionId)?.status,
      "applying"
    );
    assert.equal(
      state.tradeLog.some((row) => row.transactionId === "legacy-queued-audit"),
      true
    );
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("resetState replaces state through the injected repository", async () => {
  const previousGame = globalThis.game;
  let repositoryMutations = 0;
  let directWrites = 0;
  const state = {
    version: 9,
    order: ["trader-a"],
    traders: { "trader-a": { name: "Trader A" } },
    tradeLog: [{ id: "legacy-reset-audit", type: "purchase" }],
    extra: "remove-me"
  };
  const stateRepository = {
    read: () => state,
    async mutate(mutator) {
      repositoryMutations += 1;
      return mutator(state);
    }
  };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    settings: {
      get: () => state,
      set: async () => {
        directWrites += 1;
      }
    }
  };

  try {
    const service = new TraderService({}, { stateRepository });
    assert.equal(await service.resetState(), 0);

    assert.equal(repositoryMutations, 1);
    assert.equal(directWrites, 0);
    assert.deepEqual(state, {
      version: 1,
      order: [],
      traders: {},
      tradeLog: []
    });
  }
  finally {
    globalThis.game = previousGame;
  }
});
