import test from "node:test";
import assert from "node:assert/strict";

import { resolveGearItemIcon } from "../scripts/data/gear-icon-resolver.js";
import { TraderService } from "../scripts/data/trader-service.js";

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
  });

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
