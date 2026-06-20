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
