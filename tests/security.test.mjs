import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { RaceAutomationService } from "../scripts/combat/race-automation-service.js";
import { InventoryService } from "../scripts/data/inventory-service.js";
import { TraderService } from "../scripts/data/trader-service.js";

test("scene storage and durability are owned by Rebreya and add no retired external pile dependency", async () => {
  const [manifestSource, mainSource, ...runtimeSources] = await Promise.all([
    readFile(new URL("../module.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/main.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/data/storage-service.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/data/storage-command-service.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/data/storage-journal-reader.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/data/durability-rules.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/data/durability-service.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/integrations/storage-token-hooks.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/hooks.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ui/storage-app.js", import.meta.url), "utf8")
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.relationships.requires.some((entry) => entry.id === "item-piles"), false);
  assert.doesNotMatch([mainSource, ...runtimeSources].join("\n"), /item.?piles|itempiles/iu);
  for (const apiName of [
    "openStorage", "readStorageJournal", "claimStorageRow", "claimStorageCoins", "configureStorageToken",
    "dropStorageCoinsToScene", "dropStorageJournalToScene"
  ]) {
    assert.match(mainSource, new RegExp(`\\b${apiName}\\b`, "u"));
  }
  assert.match(mainSource, /STORAGE_JOURNAL_READ_COMMAND\s*=\s*"storage\.journal\.read"/u);
  assert.match(mainSource, /STORAGE_COIN_DROP_COMMAND\s*=\s*"storage\.coin\.drop"/u);
  assert.match(mainSource, /STORAGE_JOURNAL_DROP_COMMAND\s*=\s*"storage\.journal\.drop-to-scene"/u);
  assert.doesNotMatch([mainSource, ...runtimeSources].join("\n"), /(?:currency|coin)(?:Store|Repository)/iu);
});

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

test("race automation socket ignores player-origin GM mutation requests", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const previousActor = globalThis.Actor;
  const previousRoll = globalThis.Roll;
  const previousFromUuidSync = globalThis.fromUuidSync;
  const previousChatMessage = globalThis.ChatMessage;

  class TestActor {}
  let damageCalls = 0;
  const targetActor = new TestActor();
  Object.assign(targetActor, {
    uuid: "Actor.target",
    applyDamage: async () => {
      damageCalls += 1;
    }
  });
  const sourceActor = new TestActor();
  Object.assign(sourceActor, {
    uuid: "Actor.source"
  });

  globalThis.Actor = TestActor;
  globalThis.Roll = class Roll {
    constructor() {
      this.total = 5;
    }

    async evaluate() {
      return this;
    }

    async toMessage() {
      return null;
    }
  };
  globalThis.fromUuidSync = (uuid) => ({
    "Actor.target": targetActor,
    "Actor.source": sourceActor
  })[uuid] ?? null;
  globalThis.ChatMessage = {
    getSpeaker: () => ({})
  };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: {
      get: (id) => ({ id, isGM: id === "gm" })
    }
  };

  try {
    const result = await new RaceAutomationService({}).handleSocketMessage({
      action: "applyTargetDamage",
      actorUuid: "Actor.target",
      sourceActorUuid: "Actor.source",
      formula: "5",
      damageType: "fire",
      label: "forged"
    }, {
      senderId: "player-1"
    });

    assert.equal(result, false);
    assert.equal(damageCalls, 0);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.Actor = previousActor;
    globalThis.Roll = previousRoll;
    globalThis.fromUuidSync = previousFromUuidSync;
    globalThis.ChatMessage = previousChatMessage;
    restoreFoundry();
  }
});

function buildMinimalTraderHarness() {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousConst = globalThis.CONST;

  const material = {
    id: "iron",
    name: "Iron",
    priceGold: 1,
    weight: 1,
    linkedGoodId: "iron-good"
  };
  const model = {
    materials: [material],
    materialByGoodId: new Map([["iron-good", material]]),
    materialById: new Map([[material.id, material]]),
    gear: [],
    reference: {},
    goods: []
  };
  const city = {
    id: "city-1",
    name: "City",
    rank: 1,
    state: "state-1",
    goodsRows: [{
      goodId: "iron-good",
      surplus: 10
    }]
  };
  let actorUpdates = 0;
  let createdItems = 0;
  const buyer = {
    id: "buyer-1",
    name: "Buyer",
    img: "",
    isOwner: true,
    system: {
      currency: {
        gp: 10,
        sp: 0,
        cp: 0
      }
    },
    items: {
      contents: [],
      get: () => null
    },
    getFlag: () => false,
    createEmbeddedDocuments: async () => {
      createdItems += 1;
      return [];
    },
    update: async () => {
      actorUpdates += 1;
    }
  };

  globalThis.CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: {
      OWNER: 3,
      OBSERVER: 2
    }
  };
  globalThis.canvas = {
    tokens: {
      controlled: []
    }
  };
  globalThis.game = {
    user: { id: "player-1", isGM: false, character: buyer },
    actors: {
      get: (id) => id === buyer.id ? buyer : null,
      contents: [buyer]
    },
    settings: {
      get: () => ({}),
      set: async () => {
        throw new Error("settings must not be mutated by player trade calls");
      }
    }
  };

  const service = new TraderService({
    getModel: async () => model,
    getCitySnapshot: (cityId) => cityId === city.id ? city : null,
    getCalendarSnapshot: () => ({ year: 1200, month: 1 }),
    inventoryService: {
      getInventoryActor: async () => null
    },
    globalEventsService: {
      collectMerchantModifiers: () => ({
        buyPricePercent: 0,
        sellPricePercent: 0,
        stockPercent: 0,
        blocked: false,
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

  return {
    service,
    buyer,
    get actorUpdates() {
      return actorUpdates;
    },
    get createdItems() {
      return createdItems;
    },
    restore() {
      globalThis.game = previousGame;
      globalThis.canvas = previousCanvas;
      globalThis.CONST = previousConst;
      restoreFoundry();
    }
  };
}

test("direct player purchase call mutates only the owned actor and records an audit", async () => {
  const harness = buildMinimalTraderHarness();
  const audits = [];
  harness.service.moduleApi.recordTraderAudit = async (operation) => {
    audits.push(operation);
    return null;
  };

  try {
    const result = await harness.service.purchaseItem("city-1", "materials-shop", "material:iron", 1, { actorId: "buyer-1" });

    assert.equal(result.actorName, "Buyer");
    assert.equal(harness.createdItems, 1);
    assert.equal(harness.actorUpdates, 1);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].type, "purchase");
    assert.equal(audits[0].actorId, "buyer-1");
    assert.equal(audits[0].itemName, "Iron");
    assert.equal(audits[0].quantity, 1);
    return;

    await assert.rejects(
      () => harness.service.purchaseItem("city-1", "materials-shop", "material:iron", 1, { actorId: "buyer-1" }),
      /мастер|ГМ|GM|торгов/i
    );

    assert.equal(harness.createdItems, 0);
    assert.equal(harness.actorUpdates, 0);
  }
  finally {
    harness.restore();
  }
});

test("direct player sale call mutates only the owned actor and records an audit", async () => {
  const harness = buildMinimalTraderHarness();
  const audits = [];
  harness.service.moduleApi.recordTraderAudit = async (operation) => {
    audits.push(operation);
    return null;
  };
  const previousItem = globalThis.Item;
  const previousFromUuid = globalThis.fromUuid;

  class TestItem {}
  let itemUpdates = 0;
  let itemDeletes = 0;
  const item = new TestItem();
  Object.assign(item, {
    id: "item-1",
    uuid: "Actor.buyer-1.Item.item-1",
    parent: harness.buyer,
    toObject: () => ({
      system: {
        quantity: 1
      }
    }),
    update: async () => {
      itemUpdates += 1;
    },
    delete: async () => {
      itemDeletes += 1;
    }
  });

  globalThis.Item = TestItem;
  globalThis.fromUuid = async (uuid) => uuid === item.uuid ? item : null;

  try {
    const result = await harness.service.sellItem("city-1", "materials-shop", {
      actorId: "buyer-1",
      itemUuid: item.uuid,
      itemName: "Iron",
      sourceType: "material",
      sourceId: "iron",
      grossOfferCopper: 100,
      taxCopper: 0,
      netPayoutCopper: 100
    }, 1);

    assert.equal(result.actorName, "Buyer");
    assert.equal(harness.actorUpdates, 1);
    assert.equal(itemUpdates, 0);
    assert.equal(itemDeletes, 1);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].type, "sale");
    assert.equal(audits[0].actorId, "buyer-1");
    assert.equal(audits[0].itemName, "Iron");
    assert.equal(audits[0].quantity, 1);
    return;

    await assert.rejects(
      () => harness.service.sellItem("city-1", "materials-shop", {
        actorId: "buyer-1",
        itemUuid: item.uuid,
        itemName: "Iron",
        sourceType: "material",
        sourceId: "iron",
        grossOfferCopper: 100,
        taxCopper: 0,
        netPayoutCopper: 100
      }, 1),
      /мастер|ГМ|GM|торгов/i
    );

    assert.equal(harness.actorUpdates, 0);
    assert.equal(itemUpdates, 0);
    assert.equal(itemDeletes, 0);
  }
  finally {
    globalThis.Item = previousItem;
    globalThis.fromUuid = previousFromUuid;
    harness.restore();
  }
});

test("trade audit keeps the latest twenty rows and rollback reverses a purchase", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;

  let actorUpdatePatch = null;
  let itemDeleteCalls = 0;
  const item = {
    id: "item-1",
    name: "Iron",
    getFlag: (moduleId, key) => {
      if (moduleId !== "rebreya-main") {
        return null;
      }

      return key === "sourceType" ? "material" : "iron";
    },
    toObject: () => ({
      system: {
        quantity: 20
      }
    }),
    delete: async () => {
      itemDeleteCalls += 1;
    },
    update: async () => {}
  };
  const actor = {
    id: "buyer-1",
    name: "Buyer",
    ownership: {
      default: 3
    },
    system: {
      currency: {
        gp: 0,
        sp: 0,
        cp: 0
      }
    },
    items: {
      contents: [item],
      get: (id) => id === item.id ? item : null
    },
    update: async (patch) => {
      actorUpdatePatch = patch;
    }
  };
  let state = {
    version: 1,
    traders: {},
    order: [],
    tradeLog: []
  };

  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: {
      get: (id) => ({ id, name: id === "player-1" ? "Player" : "GM", isGM: id === "gm" })
    },
    actors: {
      get: (id) => id === actor.id ? actor : null
    },
    settings: {
      get: () => state,
      set: async (_moduleId, _key, nextState) => {
        state = nextState;
      }
    }
  };

  const service = new TraderService({}, {
    stateRepository: {
      read: () => state,
      async mutate(mutator) {
        const result = await mutator(state);
        return result;
      }
    }
  });

  try {
    for (let index = 0; index < 21; index += 1) {
      await service.recordTradeAudit({
        type: "purchase",
        actorId: "buyer-1",
        actorName: "Buyer",
        itemId: "item-1",
        itemName: `Iron ${index}`,
        sourceType: "material",
        sourceId: "iron",
        quantity: 1,
        itemQuantityBefore: 0,
        itemQuantityAfter: 20,
        totalCopper: 100,
        cityName: "City",
        traderName: "Trader"
      }, {
        senderId: "player-1"
      });
    }

    const log = service.getTradeAuditLog();
    assert.equal(log.length, 20);
    assert.equal(log[0].itemName, "Iron 20");
    assert.equal(log.at(-1).itemName, "Iron 1");

    const rollbackResult = await service.rollbackTradeAuditEntry(log[0].id);
    assert.equal(rollbackResult.type, "purchase");
    assert.equal(itemDeleteCalls, 1);
    assert.equal(actorUpdatePatch["system.currency.gp"], 1);
    assert.equal(service.getTradeAuditLog()[0].rolledBack, true);
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("party inventory is created as player-owned and owned players can manage stock", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const previousActor = globalThis.Actor;
  const previousConst = globalThis.CONST;

  let state = {};
  let createdActorData = null;
  let supplyUpdatePatch = null;
  let currencyUpdatePatch = null;
  let partyActor = null;
  let supplyCreatedItemData = null;

  class TestActor {
    static async create(data) {
      createdActorData = data;
      partyActor = new TestActor();
      Object.assign(partyActor, {
        id: "party-inventory",
        name: data.name,
        img: data.img,
        isOwner: true,
        system: {
          currency: {
            pp: 0,
            gp: 0,
            sp: 0,
            cp: 0
          }
        },
        items: {
          contents: [],
          get: () => null
        },
        getFlag: (_moduleId, key) => key === "managedPartyInventory",
        createEmbeddedDocuments: async (_type, documents) => {
          const document = documents[0];
          supplyCreatedItemData = foundry.utils.deepClone(document);
          const item = {
            name: document.name,
            flags: document.flags,
            getFlag: (moduleId, key) => document.flags?.[moduleId]?.[key],
            toObject: () => foundry.utils.deepClone(document),
            update: async (patch) => {
              supplyUpdatePatch = patch;
            }
          };
          partyActor.items.contents.push(item);
          return [item];
        },
        update: async (patch) => {
          currencyUpdatePatch = patch;
        }
      });
      return partyActor;
    }
  }

  globalThis.Actor = TestActor;
  globalThis.CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: {
      OWNER: 3,
      OBSERVER: 2
    }
  };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    actors: {
      get: (id) => id === partyActor?.id ? partyActor : null,
      contents: []
    },
    settings: {
      get: () => state,
      set: async (_moduleId, _key, nextState) => {
        state = nextState;
      }
    }
  };

  const service = new InventoryService({
    getModel: async () => ({
      materials: [],
      gear: []
    })
  });

  try {
    await service.getInventoryActor({ create: true });
    assert.equal(createdActorData.ownership.default, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);

    globalThis.game.user = { id: "player-1", isGM: false };
    globalThis.game.actors.contents = [partyActor];

    await service.addSupply("food", 2);
    assert.equal(supplyCreatedItemData.img, "icons/consumables/food/berries-ration-round-red.webp");
    assert.equal(supplyUpdatePatch["system.quantity"], 2);

    await service.addSupply("water", 1);
    assert.equal(supplyCreatedItemData.img, "icons/sundries/survival/waterskin-leather-brown.webp");

    await service.updateCurrency({ gp: 3, sp: 4 });
    const partySnapshot = await service.getPartySnapshot();

    assert.equal(currencyUpdatePatch["system.currency.gp"], 3);
    assert.equal(currencyUpdatePatch["system.currency.sp"], 4);
    assert.equal(partySnapshot.canManage, true);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.Actor = previousActor;
    globalThis.CONST = previousConst;
    restoreFoundry();
  }
});

test("party inventory snapshot remaps removed core supply icon paths", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;

  const state = {
    inventoryActorId: "party-inventory"
  };
  const actor = {
    id: "party-inventory",
    name: "Party Inventory",
    img: "icons/svg/item-bag.svg",
    isOwner: true,
    system: {
      currency: {}
    },
    items: {
      contents: [
        {
          id: "food",
          uuid: "Actor.party.Item.food",
          name: "Еда",
          type: "loot",
          img: "icons/consumables/food/bowl-oatmeal-brown.webp",
          flags: {
            "rebreya-main": {
              resourceKey: "food",
              sourceType: "supply"
            }
          },
          toObject: () => ({
            system: {
              quantity: 2,
              weight: { value: 1 },
              price: {}
            }
          })
        },
        {
          id: "water",
          uuid: "Actor.party.Item.water",
          name: "Вода",
          type: "loot",
          img: "icons/consumables/water/waterskin-leather-blue.webp",
          flags: {
            "rebreya-main": {
              resourceKey: "water",
              sourceType: "supply"
            }
          },
          toObject: () => ({
            system: {
              quantity: 1,
              weight: { value: 8 },
              price: {}
            }
          })
        }
      ]
    }
  };

  globalThis.game = {
    user: { id: "gm", isGM: true },
    actors: {
      get: (id) => id === actor.id ? actor : null
    },
    settings: {
      get: () => state
    }
  };

  const service = new InventoryService({
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    const snapshot = await service.getInventorySnapshot();

    assert.equal(snapshot.allItems.find((item) => item.itemId === "food").img, "icons/consumables/food/berries-ration-round-red.webp");
    assert.equal(snapshot.allItems.find((item) => item.itemId === "water").img, "icons/sundries/survival/waterskin-leather-brown.webp");
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("party inventory projection preserves custom icons and replaces only placeholder icons from the stable gear source", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const actor = {
    id: "party-inventory",
    name: "Party Inventory",
    isOwner: true,
    system: { currency: {} },
    items: {
      contents: [
        {
          id: "custom-icon",
          uuid: "Actor.party.Item.custom-icon",
          name: "Бензин (1 галлон)",
          type: "loot",
          img: "worlds/rebreya/uploads/fuel.png",
          flags: { "rebreya-main": { sourceType: "gear", sourceId: "catalog-fuel", gearId: "catalog-fuel" } },
          toObject: () => ({ system: { quantity: 1, weight: { value: 1 }, price: {} } })
        },
        {
          id: "placeholder-icon",
          uuid: "Actor.party.Item.placeholder-icon",
          name: "Переименованный бензин",
          type: "loot",
          img: "icons/svg/item-bag.svg",
          flags: { "rebreya-main": { sourceType: "gear", sourceId: "catalog-fuel", gearId: "catalog-fuel" } },
          toObject: () => ({ system: { quantity: 1, weight: { value: 1 }, price: {} } })
        }
      ]
    }
  };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    actors: { get: (id) => id === actor.id ? actor : null },
    settings: { get: () => ({ inventoryActorId: actor.id }) }
  };
  const service = new InventoryService({
    getModel: async () => ({
      materials: [], materialById: new Map(), materialByGoodId: new Map(),
      gear: [{ id: "catalog-fuel", name: "Бензин (1 галлон)", equipmentType: "Снаряжение" }],
      gearById: new Map([["catalog-fuel", { id: "catalog-fuel", name: "Бензин (1 галлон)", equipmentType: "Снаряжение" }]])
    })
  });

  try {
    const snapshot = await service.getInventorySnapshot();
    assert.equal(snapshot.allItems.find((entry) => entry.itemId === "custom-icon").img, "worlds/rebreya/uploads/fuel.png");
    assert.notEqual(snapshot.allItems.find((entry) => entry.itemId === "placeholder-icon").img, "icons/svg/item-bag.svg");
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("InventoryService converts ration items into Rebreya food supply pounds", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const previousActor = globalThis.Actor;

  let createdSupplyData = null;
  let supplyUpdatePatch = null;
  let sourceDeleted = false;

  class TestActor {}

  const partyActor = new TestActor();
  Object.assign(partyActor, {
    id: "party-inventory",
    type: "npc",
    isOwner: true,
    system: {
      currency: {}
    },
    items: {
      contents: [],
      get: () => null
    },
    createEmbeddedDocuments: async (_type, documents) => {
      createdSupplyData = foundry.utils.deepClone(documents[0]);
      const item = {
        name: createdSupplyData.name,
        type: createdSupplyData.type,
        flags: createdSupplyData.flags,
        getFlag: (moduleId, key) => createdSupplyData.flags?.[moduleId]?.[key],
        toObject: () => foundry.utils.deepClone(createdSupplyData),
        update: async (patch) => {
          supplyUpdatePatch = patch;
        }
      };
      partyActor.items.contents.push(item);
      return [item];
    }
  });

  const characterActor = new TestActor();
  Object.assign(characterActor, {
    id: "hero",
    type: "character",
    isOwner: true
  });

  const rationItem = {
    name: "Рационы",
    type: "consumable",
    parent: characterActor,
    actor: characterActor,
    flags: {},
    getFlag: () => undefined,
    toObject: () => ({
      name: "Рационы",
      type: "consumable",
      system: {
        quantity: 3,
        weight: {
          value: 2
        }
      },
      flags: {}
    }),
    delete: async () => {
      sourceDeleted = true;
    }
  };

  globalThis.Actor = TestActor;
  globalThis.game = {
    user: { id: "gm", isGM: true },
    actors: {
      get: (id) => id === partyActor.id ? partyActor : null
    },
    settings: {
      get: () => ({
        inventoryActorId: partyActor.id
      }),
      set: async () => {}
    }
  };

  const service = new InventoryService({
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    assert.deepEqual(service.getRationFoodConversion(rationItem), {
      itemName: "Рационы",
      quantity: 3,
      weightEach: 2,
      foodLb: 6
    });

    const result = await service.convertRationItemToFoodSupply(rationItem);

    assert.equal(createdSupplyData.name, "Еда");
    assert.equal(createdSupplyData.flags["rebreya-main"].resourceKey, "food");
    assert.equal(supplyUpdatePatch["system.quantity"], 6);
    assert.equal(supplyUpdatePatch["system.weight.value"], 1);
    assert.equal(sourceDeleted, true);
    assert.deepEqual(result, {
      itemName: "Рационы",
      foodLb: 6
    });
  }
  finally {
    globalThis.game = previousGame;
    globalThis.Actor = previousActor;
    restoreFoundry();
  }
});
