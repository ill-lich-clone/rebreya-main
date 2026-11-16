import assert from "node:assert/strict";
import test from "node:test";

import { COMMAND_REQUEST_TYPE, COMMAND_RESULT_TYPE } from "../scripts/infrastructure/foundry/socket-command-bus.js";

const originalHooks = globalThis.Hooks;
globalThis.Hooks = { once() {}, on() {} };
const { RebreyaMainModule } = await import(`../scripts/main.js?purchase-basket-dispatch=${Date.now()}`);
if (originalHooks === undefined) delete globalThis.Hooks;
else globalThis.Hooks = originalHooks;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function usersCollection(users, activeGmId = "gm-a") {
  const collection = new Map(users.map((user) => [user.id, user]));
  collection.contents = users;
  collection.activeGM = collection.get(activeGmId);
  return collection;
}

function installFixture({ currentUserId = "gm-a" } = {}) {
  const previous = { game: globalThis.game, foundry: globalThis.foundry, ui: globalThis.ui };
  const gm = { id: "gm-a", isGM: true, active: true };
  const inactiveGm = { id: "gm-b", isGM: true, active: true };
  const owner = { id: "player-a", isGM: false, active: true };
  const stranger = { id: "player-b", isGM: false, active: true };
  const users = usersCollection([gm, inactiveGm, owner, stranger]);
  const actor = {
    id: "actor-a",
    type: "character",
    ownership: { [owner.id]: 3 },
    testUserPermission: (user, level) => user.id === owner.id && level === "OWNER"
  };
  const emitted = [];
  const settings = new Map();
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
  globalThis.ui = { controls: { render() {} }, notifications: {} };
  globalThis.game = {
    user: users.get(currentUserId),
    users,
    actors: { contents: [actor], get: (id) => id === actor.id ? actor : null },
    modules: new Map([
      ["rebreya-main", { id: "rebreya-main", active: true }],
      ["rebreya-gen", { id: "rebreya-gen", active: true }]
    ]),
    settings: {
      get: (_moduleId, key) => clone(settings.get(key) ?? {}),
      async set(_moduleId, key, value) {
        settings.set(key, clone(value));
        return value;
      }
    },
    socket: { emit: (_channel, message) => emitted.push(clone(message)) }
  };
  return {
    actor,
    emitted,
    users: { gm, inactiveGm, owner, stranger },
    restore() {
      globalThis.game = previous.game;
      globalThis.foundry = previous.foundry;
      globalThis.ui = previous.ui;
    }
  };
}

const payload = Object.freeze({
  transactionId: "purchase_basket_dispatch_001",
  actorId: "actor-a",
  rows: Object.freeze([Object.freeze({
    rowId: "rope",
    sourceUuid: "Item.rope",
    quantity: 2,
    unitPrice: Object.freeze({ value: 1.5, denomination: "gp" })
  })])
});

function request(senderId, requestPayload, requestId) {
  return {
    type: COMMAND_REQUEST_TYPE,
    command: "purchase-basket.commit",
    requestId,
    senderId,
    payload: requestPayload
  };
}

async function dispatch(moduleApi, message, transportSenderId) {
  await moduleApi.handleSocketMessage(message, transportSenderId);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function result(fixture, requestId) {
  return fixture.emitted.find((message) => message.type === COMMAND_RESULT_TYPE && message.requestId === requestId);
}

test("typed purchase basket command authorizes the Actor owner and binds sender identity", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.purchaseBasketService.commit = async (requestPayload, context) => {
      calls.push({ payload: clone(requestPayload), context: clone(context) });
      return { status: "committed", transactionId: requestPayload.transactionId };
    };

    await dispatch(moduleApi, request(fixture.users.owner.id, payload, "owner-request"));
    await dispatch(moduleApi, request(fixture.users.stranger.id, payload, "stranger-request"));
    await dispatch(moduleApi, request(fixture.users.owner.id, { ...payload, rawItemData: { name: "forged" } }, "invalid-request"));

    assert.deepEqual(calls, [{ payload, context: { requestedByUserId: fixture.users.owner.id } }]);
    assert.equal(result(fixture, "owner-request")?.ok, true);
    assert.equal(result(fixture, "stranger-request")?.error?.code, "unauthorized");
    assert.equal(result(fixture, "invalid-request")?.error?.code, "invalid-payload");
  }
  finally {
    fixture.restore();
  }
});

test("public purchase basket API executes locally only on the active GM", async () => {
  for (const currentUserId of ["gm-a", "gm-b", "player-a"]) {
    const fixture = installFixture({ currentUserId });
    try {
      const moduleApi = new RebreyaMainModule();
      const localCalls = [];
      moduleApi.purchaseBasketService.commit = async (requestPayload, context) => {
        localCalls.push({ payload: clone(requestPayload), context: clone(context) });
        return { status: "committed", transactionId: requestPayload.transactionId };
      };

      const pending = moduleApi.purchaseItemBasket(payload);
      if (currentUserId === "gm-a") {
        assert.equal((await pending).status, "committed");
        assert.deepEqual(localCalls, [{ payload, context: { requestedByUserId: "gm-a" } }]);
        assert.equal(fixture.emitted.length, 0);
      }
      else {
        await new Promise((resolve) => setImmediate(resolve));
        const outbound = fixture.emitted[0];
        assert.equal(outbound.command, "purchase-basket.commit");
        assert.deepEqual(outbound.payload, payload);
        assert.equal(localCalls.length, 0);
        await moduleApi.handleSocketMessage({
          type: COMMAND_RESULT_TYPE,
          command: outbound.command,
          requestId: outbound.requestId,
          forUserId: currentUserId,
          senderId: "gm-a",
          ok: true,
          data: { status: "committed", transactionId: payload.transactionId }
        }, "gm-a");
        assert.equal((await pending).status, "committed");
      }
    }
    finally {
      fixture.restore();
    }
  }
});

test("a committed basket opens the armor picker on the purchaser client and updates only the purchased Item", async () => {
  const fixture = installFixture({ currentUserId: "player-a" });
  const previous = { fromUuid: globalThis.fromUuid, Dialog: globalThis.Dialog, CONST: globalThis.CONST };
  try {
    const api = new RebreyaMainModule();
    globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2, OWNER: 3 } };
    api.getModel = async () => ({
      gear: [{
        id: "chef-armor", name: "Боевая броня шеф-повара", equipmentType: "Доспех",
        armor: { type: "light", value: 11 }
      }]
    });
    const dialogs = [];
    globalThis.Dialog = class {
      constructor(data) { this.data = data; }
      render() { dialogs.push({ data: this.data, userId: globalThis.game.user.id }); }
    };
    const updates = [];
    const item = {
      uuid: "Actor.actor-a.Item.armor",
      parent: fixture.actor,
      type: "equipment",
      name: "Укрепляющий доспех +30",
      system: { quantity: 2 },
      flags: { "rebreya-main": { sourceType: "magicItem", itemType: "Доспех", itemSubtype: "Любой" } },
      async update(data) { updates.push(data); }
    };
    const unrelated = {
      ...item, uuid: "Actor.unrelated.Item.armor",
      parent: { ...fixture.actor, id: "unrelated" }
    };
    const documents = new Map([[item.uuid, item], [unrelated.uuid, unrelated]]);
    globalThis.fromUuid = async (uuid) => documents.get(uuid);

    const buy = async (transactionId, reply) => {
      const pending = api.purchaseItemBasket({ ...payload, transactionId });
      await new Promise((resolve) => setImmediate(resolve));
      const outbound = fixture.emitted.at(-1);
      assert.equal(dialogs.length, 0);
      await dispatch(api, {
        type: COMMAND_RESULT_TYPE,
        command: outbound.command,
        requestId: outbound.requestId,
        forUserId: fixture.users.owner.id,
        senderId: fixture.users.gm.id,
        ok: true,
        data: {
          ...reply, transactionId, actorId: fixture.actor.id,
          createdItemUuids: [unrelated.uuid, item.uuid]
        }
      }, fixture.users.gm.id);
      return pending;
    };

    assert.equal((await buy("basket_compensated", { status: "compensated" })).status, "compensated");
    assert.equal(dialogs.length, 0);
    assert.equal((await buy("basket_committed", { status: "committed" })).status, "committed");
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].userId, fixture.users.owner.id);
    assert.match(dialogs[0].data.content, /Укрепляющий доспех \+30/u);
    assert.match(dialogs[0].data.content, /Боевая броня шеф-повара/u);
    dialogs[0].data.buttons.apply.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(updates.length, 1);
    assert.equal(updates[0].name, "Укрепляющий доспех +30 (Боевая броня шеф-повара)");
    assert.equal(updates[0].system.quantity, 2);
  }
  finally {
    Object.assign(globalThis, previous);
    fixture.restore();
  }
});

test("canonical Main API publishes panel-tool registration delegates", () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const visible = () => true;
    const onChange = () => undefined;
    const registration = moduleApi.registerPanelTool("rebreya-gen", {
      name: "rebreya-gen-purchase",
      title: "Закупка",
      icon: "fa-solid fa-cart-shopping",
      order: 45,
      visible,
      onChange
    });

    assert.equal(registration.registered, true);
    assert.equal(moduleApi.unregisterPanelTool("rebreya-gen", "rebreya-gen-purchase"), true);
  }
  finally {
    fixture.restore();
  }
});
