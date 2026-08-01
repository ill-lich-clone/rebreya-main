import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { registerStorageTokenHooks } from "../scripts/integrations/storage-token-hooks.js";

function createHarness({ isGM = false } = {}) {
  const listeners = new Map();
  const calls = [];
  const tokenListeners = new Map();
  const storageToken = {
    actor: {
      type: "npc",
      flags: { [MODULE_ID]: { storage: { enabled: true } } },
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
    },
    document: { uuid: "Scene.scene.Token.chest" },
    on(name, callback) { tokenListeners.set(name, callback); }
  };
  const hooks = {
    on(name, callback) { listeners.set(name, callback); }
  };
  const moduleApi = {
    openStorageApp: async (options) => calls.push(options),
    markStorageActor: async (actorUuid) => calls.push({ actorUuid })
  };
  const shown = [];
  registerStorageTokenHooks(moduleApi, {
    hooks,
    gameProvider: () => ({ user: { isGM } }),
    showActions: (_token, actions) => shown.push(actions)
  });
  return { listeners, calls, shown, storageToken, tokenListeners };
}

test("left-clicking storage offers only Open to a player", async () => {
  const harness = createHarness({ isGM: false });
  await harness.listeners.get("controlToken")(harness.storageToken, true);
  assert.deepEqual(harness.shown[0].map((action) => action.label), ["Открыть"]);
  await harness.shown[0][0].callback();
  assert.deepEqual(harness.calls, [{ tokenUuid: harness.storageToken.document.uuid, configure: false }]);
});

test("GM storage actions include a gear configuration button", async () => {
  const harness = createHarness({ isGM: true });
  await harness.listeners.get("controlToken")(harness.storageToken, true);
  assert.deepEqual(harness.shown[0].map((action) => action.label), ["Открыть", "Настроить"]);
  await harness.shown[0][1].callback();
  assert.deepEqual(harness.calls, [{ tokenUuid: harness.storageToken.document.uuid, configure: true }]);
});

test("an unowned storage token opens its action menu from a left pointer click", async () => {
  const harness = createHarness({ isGM: false });
  harness.listeners.get("hoverToken")(harness.storageToken, true);
  harness.tokenListeners.get("pointertap")({ button: 0 });
  assert.deepEqual(harness.shown[0].map((action) => action.label), ["Открыть"]);
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
