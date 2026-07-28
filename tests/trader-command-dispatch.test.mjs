import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import {
  COMMAND_REQUEST_TYPE,
  COMMAND_RESULT_TYPE
} from "../scripts/infrastructure/foundry/socket-command-bus.js";

const originalHooks = globalThis.Hooks;
globalThis.Hooks = { once() {}, on() {} };
const { RebreyaMainModule } = await import(`../scripts/main.js?trader-command-dispatch=${Date.now()}`);
if (originalHooks === undefined) delete globalThis.Hooks;
else globalThis.Hooks = originalHooks;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function usersCollection(users, activeGmId = "gm-a") {
  const collection = new Map(users.map((user) => [user.id, user]));
  collection.contents = users;
  collection.activeGM = collection.get(activeGmId);
  return collection;
}

function installFixture({ currentUserId = "gm-a" } = {}) {
  const previous = {
    game: globalThis.game,
    foundry: globalThis.foundry,
    ui: globalThis.ui
  };
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const player = { id: "player-a", isGM: false, active: true };
  const stranger = { id: "player-b", isGM: false, active: true };
  const users = usersCollection([gmA, gmB, player, stranger]);
  const character = {
    id: "actor-a",
    type: "character",
    ownership: { [player.id]: 3 },
    testUserPermission: (user, level) => user.id === player.id && level === "OWNER"
  };
  const party = {
    id: "party-inventory",
    type: "npc",
    ownership: { [player.id]: 3 },
    testUserPermission: (user, level) => user.id === player.id && level === "OWNER"
  };
  const actors = [character, party];
  const emitted = [];
  const writes = [];
  let traderState = { version: 1, traders: {}, order: [], tradeLog: [] };

  globalThis.foundry = {
    utils: {
      deepClone: clone,
      mergeObject: (left, right) => ({ ...clone(left), ...clone(right) }),
      getProperty: (source, path) => String(path).split(".").reduce((value, key) => value?.[key], source),
      setProperty(source, path, value) {
        const keys = String(path).split(".");
        let cursor = source;
        keys.forEach((key, index) => {
          if (index === keys.length - 1) cursor[key] = value;
          else cursor = (cursor[key] ??= {});
        });
      }
    }
  };
  globalThis.ui = { notifications: {} };
  globalThis.game = {
    user: users.get(currentUserId),
    users,
    actors: {
      contents: actors,
      get: (id) => actors.find((actor) => actor.id === id) ?? null
    },
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        return key === SETTINGS_KEYS.TRADER_STATE ? clone(traderState) : {};
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        if (key === SETTINGS_KEYS.TRADER_STATE) traderState = clone(value);
        writes.push({ key, value: clone(value) });
        return value;
      }
    },
    socket: {
      emit(_channel, message) {
        emitted.push(clone(message));
      }
    }
  };

  return {
    actors: { character, party },
    emitted,
    users: { gmA, gmB, player, stranger },
    writes,
    restore() {
      globalThis.game = previous.game;
      globalThis.foundry = previous.foundry;
      globalThis.ui = previous.ui;
    }
  };
}

function request(command, senderId, payload, requestId = `request-${Date.now()}`) {
  return { type: COMMAND_REQUEST_TYPE, command, requestId, senderId, payload };
}

async function dispatch(moduleApi, message) {
  await moduleApi.handleSocketMessage(message);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function result(fixture, requestId) {
  return fixture.emitted.find((message) => (
    message.type === COMMAND_RESULT_TYPE && message.requestId === requestId
  ));
}

test("live module composes one shared durable trader engine", () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    assert.ok(moduleApi.traderStateRepository);
    assert.ok(moduleApi.tradeTransactionService);
    assert.equal(moduleApi.traderService.stateRepository, moduleApi.traderStateRepository);
    assert.equal(moduleApi.traderService.transactionService, moduleApi.tradeTransactionService);
    assert.equal(moduleApi.traderStateRepository.coordinator, undefined, "repository keeps coordinator encapsulated");
  }
  finally {
    fixture.restore();
  }
});

test("typed trader purchase validates exact payload and derives requester from sender", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.traderService.ensureTraderState = async () => ({ traderId: "city-a::smith" });
    moduleApi.tradeTransactionService.purchase = async (payload) => {
      calls.push(clone(payload));
      return { transactionId: payload.transactionId, committed: true };
    };
    const payload = {
      transactionId: "purchase_12345678",
      legacy: false,
      actorId: fixture.actors.character.id,
      cityId: "city-a",
      traderKey: "smith",
      itemKey: "gear:sword",
      quantity: 2
    };
    await dispatch(moduleApi, request("trader.purchase", fixture.users.player.id, payload, "purchase-valid"));
    assert.deepEqual(calls, [{
      transactionId: payload.transactionId,
      actorId: payload.actorId,
      cityId: payload.cityId,
      traderKey: payload.traderKey,
      itemKey: payload.itemKey,
      quantity: 2,
      requestedByUserId: fixture.users.player.id
    }]);
    assert.equal(result(fixture, "purchase-valid")?.ok, true);

    for (const [id, invalid] of [
      ["extra", { ...payload, totalPriceCopper: 1 }],
      ["preview", { ...payload, preview: { finalPriceCopper: 1 } }],
      ["raw", { ...payload, rawItemData: { name: "forged" } }],
      ["requester", { ...payload, requestedByUserId: fixture.users.gmA.id }],
      ["legacy", { ...payload, legacy: true }],
      ["quantity", { ...payload, quantity: 0 }],
      ["reserved", { ...payload, transactionId: "constructor" }]
    ]) {
      await dispatch(moduleApi, request("trader.purchase", fixture.users.player.id, invalid, id));
      assert.equal(result(fixture, id)?.error?.code, "invalid-payload");
    }
    assert.equal(calls.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("typed trader purchase materializes the shop before committing the transaction", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.traderService.ensureTraderState = async (cityId, traderKey) => {
      calls.push({
        type: "ensure",
        cityId,
        traderKey
      });
      return { traderId: `${cityId}::${traderKey}` };
    };
    moduleApi.tradeTransactionService.purchase = async (payload) => {
      calls.push({
        type: "purchase",
        cityId: payload.cityId,
        traderKey: payload.traderKey,
        actorId: payload.actorId
      });
      return { transactionId: payload.transactionId, committed: true };
    };

    await dispatch(moduleApi, request("trader.purchase", fixture.users.player.id, {
      transactionId: "purchase_lazy_01",
      legacy: false,
      actorId: fixture.actors.character.id,
      cityId: "city-a",
      traderKey: "smith",
      itemKey: "gear:sword",
      quantity: 1
    }, "purchase-lazy"));

    assert.deepEqual(calls, [
      {
        type: "ensure",
        cityId: "city-a",
        traderKey: "smith"
      },
      {
        type: "purchase",
        cityId: "city-a",
        traderKey: "smith",
        actorId: fixture.actors.character.id
      }
    ]);
    assert.equal(result(fixture, "purchase-lazy")?.ok, true);
  }
  finally {
    fixture.restore();
  }
});

test("typed trader sale authorizes any owned Actor including party NPC", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.traderService.ensureTraderState = async () => ({ traderId: "city-a::smith" });
    moduleApi.tradeTransactionService.sale = async (payload) => {
      calls.push(clone(payload));
      return { transactionId: payload.transactionId };
    };
    const payload = {
      transactionId: "sale_1234567890",
      actorId: fixture.actors.party.id,
      cityId: "city-a",
      traderKey: "smith",
      itemUuid: "Actor.party-inventory.Item.item-a",
      quantity: 1
    };
    await dispatch(moduleApi, request("trader.sell", fixture.users.player.id, payload, "sale-party"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].requestedByUserId, fixture.users.player.id);

    await dispatch(moduleApi, request("trader.sell", fixture.users.stranger.id, payload, "sale-denied"));
    assert.equal(result(fixture, "sale-denied")?.error?.code, "unauthorized");
    assert.equal(calls.length, 1);

    await dispatch(moduleApi, request("trader.sell", fixture.users.player.id, {
      ...payload,
      netPayoutCopper: 999999
    }, "sale-payout"));
    assert.equal(result(fixture, "sale-payout")?.error?.code, "invalid-payload");
    assert.equal(calls.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("typed trader sale materializes the shop before committing the transaction", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.traderService.ensureTraderState = async (cityId, traderKey) => {
      calls.push({
        type: "ensure",
        cityId,
        traderKey
      });
      return { traderId: `${cityId}::${traderKey}` };
    };
    moduleApi.tradeTransactionService.sale = async (payload) => {
      calls.push({
        type: "sale",
        cityId: payload.cityId,
        traderKey: payload.traderKey,
        actorId: payload.actorId
      });
      return { transactionId: payload.transactionId, committed: true };
    };

    await dispatch(moduleApi, request("trader.sell", fixture.users.player.id, {
      transactionId: "sale_lazy_01",
      actorId: fixture.actors.character.id,
      cityId: "city-a",
      traderKey: "smith",
      itemUuid: "Actor.actor-a.Item.sword",
      quantity: 1
    }, "sale-lazy"));

    assert.deepEqual(calls, [
      {
        type: "ensure",
        cityId: "city-a",
        traderKey: "smith"
      },
      {
        type: "sale",
        cityId: "city-a",
        traderKey: "smith",
        actorId: fixture.actors.character.id
      }
    ]);
    assert.equal(result(fixture, "sale-lazy")?.ok, true);
  }
  finally {
    fixture.restore();
  }
});

test("public trader APIs route only the active GM locally and preserve the economic ID", async () => {
  for (const currentUserId of ["gm-a", "gm-b", "player-a"]) {
    const fixture = installFixture({ currentUserId });
    try {
      const moduleApi = new RebreyaMainModule();
      const local = [];
      const remote = [];
      moduleApi.tradeTransactionService.purchase = async (payload) => {
        local.push(clone(payload));
        return { transactionId: payload.transactionId };
      };
      moduleApi.traderService.ensureTraderState = async () => ({ traderId: "city-a::smith" });
      moduleApi.socketCommandBus.request = async (command, payload) => {
        remote.push({ command, payload: clone(payload) });
        return { transactionId: payload.transactionId };
      };
      const response = await moduleApi.purchaseTraderItem("city-a", "smith", "gear:sword", 1, {
        actorId: fixture.actors.character.id,
        transactionId: "purchase_stable_1"
      });
      assert.equal(response.transactionId, "purchase_stable_1");
      moduleApi.tradeTransactionService.sale = async (payload) => {
        local.push(clone(payload));
        return { transactionId: payload.transactionId };
      };
      const saleResponse = await moduleApi.sellTraderItem("city-a", "smith", {
        actorId: fixture.actors.character.id,
        itemUuid: "Actor.actor-a.Item.sword",
        netPayoutCopper: 999999,
        rawItemData: { forged: true }
      }, 1, { transactionId: "sale_stable_1234" });
      assert.equal(saleResponse.transactionId, "sale_stable_1234");
      if (currentUserId === "gm-a") {
        assert.equal(local.length, 2);
        assert.equal(local[0].requestedByUserId, "gm-a");
        assert.equal(local[1].requestedByUserId, "gm-a");
        assert.equal(Object.hasOwn(local[1], "netPayoutCopper"), false);
        assert.equal(remote.length, 0);
      }
      else {
        assert.equal(local.length, 0);
        assert.deepEqual(remote, [{
          command: "trader.purchase",
          payload: {
            transactionId: "purchase_stable_1",
            legacy: false,
            actorId: fixture.actors.character.id,
            cityId: "city-a",
            traderKey: "smith",
            itemKey: "gear:sword",
            quantity: 1
          }
        }, {
          command: "trader.sell",
          payload: {
            transactionId: "sale_stable_1234",
            actorId: fixture.actors.character.id,
            cityId: "city-a",
            traderKey: "smith",
            itemUuid: "Actor.actor-a.Item.sword",
            quantity: 1
          }
        }]);
      }
    }
    finally {
      fixture.restore();
    }
  }
});

test("live engine failures never call the legacy trader implementation", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    let legacyCalls = 0;
    moduleApi.traderService.purchaseItemLegacy = async () => { legacyCalls += 1; };
    moduleApi.traderService.ensureTraderState = async () => ({ traderId: "city-a::smith" });
    moduleApi.tradeTransactionService.purchase = async () => {
      const error = new Error("needs reconciliation");
      error.code = "reconciliation-required";
      throw error;
    };
    await assert.rejects(() => moduleApi.purchaseTraderItem("city-a", "smith", "gear:sword", 1, {
      actorId: fixture.actors.character.id,
      transactionId: "purchase_failure_1"
    }), { code: "reconciliation-required" });
    assert.equal(legacyCalls, 0);
  }
  finally {
    fixture.restore();
  }
});

test("rollback wrapper requires the active GM and preserves the supplied rollback ID", async () => {
  const activeFixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.traderService.rollbackTradeAuditEntry = async (entryId, options) => {
      calls.push({ entryId, options: clone(options) });
      return { itemName: "Sword" };
    };
    moduleApi.refreshOpenApps = async () => undefined;
    await moduleApi.rollbackTraderAuditEntry("purchase_stable_1", {
      rollbackTransactionId: "rollback_stable_1"
    });
    await moduleApi.rollbackTraderAuditEntry("purchase_stable_1", {
      rollbackTransactionId: "rollback_stable_1"
    });
    assert.deepEqual(calls, [
      {
        entryId: "purchase_stable_1",
        options: { rollbackTransactionId: "rollback_stable_1", requestedByUserId: "gm-a" }
      },
      {
        entryId: "purchase_stable_1",
        options: { rollbackTransactionId: "rollback_stable_1", requestedByUserId: "gm-a" }
      }
    ]);
  }
  finally {
    activeFixture.restore();
  }

  const inactiveFixture = installFixture({ currentUserId: "gm-b" });
  try {
    const moduleApi = new RebreyaMainModule();
    let calls = 0;
    moduleApi.traderService.rollbackTradeAuditEntry = async () => { calls += 1; };
    await assert.rejects(() => moduleApi.rollbackTraderAuditEntry("purchase_stable_1", {
      rollbackTransactionId: "rollback_stable_1"
    }), /active GM/u);
    assert.equal(calls, 0);
  }
  finally {
    inactiveFixture.restore();
  }
});
