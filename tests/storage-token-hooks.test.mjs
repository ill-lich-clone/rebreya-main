import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { registerStorageTokenHooks } from "../scripts/integrations/storage-token-hooks.js";

function createHarness({ isGM = false, distance = 5, frameController = null } = {}) {
  const listeners = new Map();
  const calls = [];
  const openCalls = [];
  const tokenListeners = new Map();
  const scene = { id: "scene" };
  const user = { id: isGM ? "gm" : "player", isGM };
  const storageToken = {
    actor: {
      type: "npc",
      flags: { [MODULE_ID]: { storage: { enabled: true } } },
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
    },
    document: { uuid: "Scene.scene.Token.chest", parent: scene },
    visible: true,
    center: { x: 150, y: 50 },
    on(name, callback) { tokenListeners.set(name, callback); },
    off(name, callback) {
      if (tokenListeners.get(name) === callback) tokenListeners.delete(name);
    },
    removeAllListeners() { tokenListeners.clear(); }
  };
  const characterToken = {
    actor: {
      type: "character",
      testUserPermission: (candidate, permission) => candidate === user && permission === "OWNER"
    },
    document: { uuid: "Scene.scene.Token.hero", parent: scene },
    center: { x: 50, y: 50 }
  };
  const hooks = {
    on(name, callback) { listeners.set(name, callback); }
  };
  const moduleApi = {
    openStorageApp: async (options) => calls.push(options),
    openStorage: async (...args) => openCalls.push(args),
    markStorageActor: async (actorUuid) => calls.push({ actorUuid })
  };
  const shown = [];
  const feedback = [];
  const overlayController = {
    showActions(token, actions) { shown.push(actions); },
    showFeedback(token, text, options) { feedback.push({ token, text, ...options }); },
    reposition() {},
    close() {},
    destroy() {}
  };
  registerStorageTokenHooks(moduleApi, {
    hooks,
    gameProvider: () => ({ user }),
    canvasProvider: () => ({
      grid: { measurePath: () => ({ distance }) },
      tokens: { controlled: [characterToken], placeables: [characterToken, storageToken], get: () => null }
    }),
    overlayController,
    ...(frameController ? { frameController } : {})
  });
  return { listeners, calls, openCalls, shown, feedback, moduleApi, storageToken, tokenListeners };
}

test("drawing a ground pile ensures its persistent frame through the storage token owner", async () => {
  const framed = [];
  const frameController = {
    async ensure(token) {
      framed.push(token);
      return true;
    }
  };
  const harness = createHarness({ isGM: true, frameController });
  harness.storageToken.actor.flags[MODULE_ID].groundPilePrototype = { enabled: true };

  await harness.listeners.get("drawToken")(harness.storageToken);

  assert.deepEqual(framed, [harness.storageToken]);
});

test("creating a ground-pile TokenDocument ensures its frame even off the viewed canvas", async () => {
  const framed = [];
  const frameController = {
    async ensure(token) {
      framed.push(token);
      return true;
    }
  };
  const harness = createHarness({ isGM: true, frameController });
  const tokenDocument = {
    ...harness.storageToken.document,
    actor: harness.storageToken.actor
  };
  tokenDocument.actor.flags[MODULE_ID].groundPilePrototype = { enabled: true };
  const createToken = harness.listeners.get("createToken");

  assert.equal(typeof createToken, "function");
  await createToken(tokenDocument);
  assert.deepEqual(framed, [tokenDocument]);
});

test("left-clicking storage offers only Open to a player", async () => {
  const harness = createHarness({ isGM: false });
  await harness.listeners.get("controlToken")(harness.storageToken, true);
  assert.equal(harness.shown.length, 0);
  assert.equal(harness.feedback.length, 0);
  harness.tokenListeners.get("pointertap")({ button: 0 });
  assert.deepEqual(harness.shown[0].map((action) => action.label), ["Открыть"]);
  await harness.shown[0][0].callback();
  assert.deepEqual(harness.calls, [{
    tokenUuid: harness.storageToken.document.uuid,
    configure: false,
    anchorToToken: true,
    characterTokenUuid: "Scene.scene.Token.hero"
  }]);
});

test("GM storage actions include a gear configuration button", async () => {
  const harness = createHarness({ isGM: true });
  await harness.listeners.get("controlToken")(harness.storageToken, true);
  assert.equal(harness.shown.length, 0);
  assert.equal(harness.feedback.length, 0);
  harness.tokenListeners.get("pointertap")({ button: 0 });
  assert.deepEqual(harness.shown[0].map((action) => action.label), ["Открыть", "Настроить"]);
  await harness.shown[0][1].callback();
  assert.deepEqual(harness.calls, [{
    tokenUuid: harness.storageToken.document.uuid,
    configure: true,
    anchorToToken: true
  }]);
});

test("a distant player sees token-local feedback instead of actions", () => {
  const harness = createHarness({ isGM: false, distance: 11 });
  harness.listeners.get("hoverToken")(harness.storageToken, true);
  harness.tokenListeners.get("pointertap")({ button: 0 });

  assert.equal(harness.shown.length, 0);
  assert.deepEqual(harness.feedback, [{
    token: harness.storageToken,
    text: "Подойдите ближе",
    durationMs: 2000
  }]);
});

test("a denied storage trigger uses token-local feedback instead of a notification error", async () => {
  const harness = createHarness({ isGM: false });
  harness.listeners.get("drawToken")(harness.storageToken);
  await harness.tokenListeners.get("pointertap")({ button: 0 });
  const error = new Error("Хранилище заперто. Требуется предмет: «Золотой ключ».");
  error.code = "STORAGE_TRIGGER_DENIED";

  const handled = await harness.shown[0][0].onError(error);

  assert.equal(handled, true);
  assert.deepEqual(harness.feedback, [{
    token: harness.storageToken,
    text: "Хранилище заперто. Требуется предмет: «Золотой ключ».",
    durationMs: 3000
  }]);
});

test("an unowned storage token opens its action menu from a left pointer click", async () => {
  const harness = createHarness({ isGM: false });
  harness.listeners.get("hoverToken")(harness.storageToken, true);
  harness.tokenListeners.get("pointertap")({ button: 0 });
  assert.deepEqual(harness.shown[0].map((action) => action.label), ["Открыть"]);
});

test("storage pointer click is rebound after Foundry redraw removes token listeners", () => {
  const harness = createHarness({ isGM: true });
  harness.listeners.get("hoverToken")(harness.storageToken, true);
  const originalHandler = harness.tokenListeners.get("pointertap");

  harness.storageToken.removeAllListeners();
  harness.listeners.get("drawToken")(harness.storageToken);

  assert.equal(harness.tokenListeners.get("pointertap"), originalHandler);
  harness.tokenListeners.get("pointertap")({ button: 0 });
  assert.deepEqual(harness.shown[0].map((action) => action.label), ["Открыть", "Настроить"]);
});

test("left-clicking a dead NPC offers the existing storage actions to player and GM", async () => {
  const playerHarness = createHarness({ isGM: false });
  playerHarness.storageToken.actor.flags = {};
  playerHarness.storageToken.actor.system = { attributes: { hp: { value: 0 } } };
  playerHarness.listeners.get("drawToken")(playerHarness.storageToken);

  await playerHarness.tokenListeners.get("pointertap")({ button: 0 });

  assert.deepEqual(playerHarness.shown[0].map((action) => action.label), ["Открыть"]);
  assert.deepEqual(playerHarness.calls, []);
  await playerHarness.shown[0][0].callback();
  assert.deepEqual(playerHarness.calls, [{
    tokenUuid: playerHarness.storageToken.document.uuid,
    configure: false,
    anchorToToken: true,
    characterTokenUuid: "Scene.scene.Token.hero"
  }]);

  const gmHarness = createHarness({ isGM: true });
  gmHarness.storageToken.actor.flags = {};
  gmHarness.storageToken.actor.system = { attributes: { hp: { value: -2 } } };
  gmHarness.listeners.get("drawToken")(gmHarness.storageToken);
  await gmHarness.tokenListeners.get("pointertap")({ button: 0 });

  assert.deepEqual(gmHarness.shown[0].map((action) => action.label), ["Открыть", "Настроить"]);
  assert.deepEqual(gmHarness.calls, []);
  await gmHarness.shown[0][1].callback();
  assert.deepEqual(gmHarness.openCalls, [[gmHarness.storageToken.document.uuid]]);
  assert.deepEqual(gmHarness.calls, [{
    tokenUuid: gmHarness.storageToken.document.uuid,
    configure: true,
    anchorToToken: true
  }]);
});

test("corpse pointer handlers recheck HP and living unmarked NPCs never open", async () => {
  const harness = createHarness({ isGM: false });
  harness.storageToken.actor.flags = {};
  harness.storageToken.actor.system = { attributes: { hp: { value: 0 } } };
  harness.listeners.get("drawToken")(harness.storageToken);
  const staleHandler = harness.tokenListeners.get("pointertap");

  harness.storageToken.actor.system.attributes.hp.value = 1;
  await staleHandler({ button: 0 });

  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.shown, []);

  harness.storageToken.removeAllListeners();
  harness.listeners.get("drawToken")(harness.storageToken);
  assert.equal(harness.tokenListeners.has("pointertap"), false);
});

test("materialized corpse pointer remains available after a stale positive HP projection", async () => {
  const harness = createHarness({ isGM: true });
  harness.storageToken.actor.flags = {};
  harness.storageToken.actor.system = { attributes: { hp: { value: 7 } } };
  harness.storageToken.document.flags = {
    [MODULE_ID]: {
      storage: {
        corpseMaterialization: { version: 1, status: "complete" }
      }
    }
  };

  harness.listeners.get("drawToken")(harness.storageToken);
  const handler = harness.tokenListeners.get("pointertap");
  assert.equal(typeof handler, "function");
  await handler({ button: 0 });

  assert.deepEqual(harness.shown[0].map((action) => action.label), ["Открыть", "Настроить"]);
});

test("a distant player gets the existing local feedback instead of opening a corpse", async () => {
  const harness = createHarness({ isGM: false, distance: 11 });
  harness.storageToken.actor.flags = {};
  harness.storageToken.actor.system = { attributes: { hp: { value: 0 } } };
  harness.listeners.get("drawToken")(harness.storageToken);

  await harness.tokenListeners.get("pointertap")({ button: 0 });

  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.feedback, [{
    token: harness.storageToken,
    text: "Подойдите ближе",
    durationMs: 2000
  }]);
});

test("corpse pointer opens only the action menu without starting a direct StorageApp request", async () => {
  const previousUi = globalThis.ui;
  const errors = [];
  globalThis.ui = { notifications: { error: (message) => errors.push(message) } };
  try {
    const harness = createHarness({ isGM: true });
    harness.storageToken.actor.flags = {};
    harness.storageToken.actor.system = { attributes: { hp: { value: 0 } } };
    harness.moduleApi.openStorageApp = async () => {
      throw new Error("socket unavailable");
    };
    harness.listeners.get("drawToken")(harness.storageToken);

    await assert.doesNotReject(harness.tokenListeners.get("pointertap")({ button: 0 }));

    assert.deepEqual(harness.calls, []);
    assert.deepEqual(harness.shown[0].map((action) => action.label), ["Открыть", "Настроить"]);
    assert.deepEqual(errors, []);
  }
  finally {
    if (previousUi === undefined) delete globalThis.ui;
    else globalThis.ui = previousUi;
  }
});

test("actor sheet header can mark an NPC as storage", async () => {
  const harness = createHarness({ isGM: true });
  const buttons = [];
  const actor = { uuid: "Actor.chest", type: "npc", flags: {} };
  harness.listeners.get("getActorSheetHeaderButtons")({ actor }, buttons);
  assert.equal(buttons[0].label, "Хранилище");
  await buttons[0].onclick();
  assert.deepEqual(harness.calls, [{ actorUuid: actor.uuid }]);
});

test("ApplicationV2 actor sheet header can mark an NPC as storage", async () => {
  const harness = createHarness({ isGM: true });
  const controls = [];
  const actor = { uuid: "Actor.chest-v2", type: "npc", flags: {} };
  harness.listeners.get("getHeaderControlsActorSheetV2")({ actor, isEditable: true }, controls);
  assert.equal(controls[0].label, "Хранилище");
  await controls[0].onClick();
  assert.deepEqual(harness.calls, [{ actorUuid: actor.uuid }]);
});
