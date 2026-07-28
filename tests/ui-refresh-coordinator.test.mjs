import test from "node:test";
import assert from "node:assert/strict";

import { UiRefreshCoordinator } from "../scripts/infrastructure/ui/ui-refresh-coordinator.js";
import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import { registerSettings } from "../scripts/settings.js";
import { registerInventorySyncHooks } from "../scripts/integrations/inventory-sync.js";

const originalHooks = globalThis.Hooks;
globalThis.Hooks = { once() {}, on() {} };
const { RebreyaMainModule } = await import(`../scripts/main.js?ui-refresh-routing=${Date.now()}`);
if (originalHooks === undefined) {
  delete globalThis.Hooks;
}
else {
  globalThis.Hooks = originalHooks;
}

function installUiFixture() {
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;
  const calls = [];

  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: new Map(),
    actors: { contents: [], get() { return null; } }
  };
  globalThis.ui = {
    windows: {},
    notifications: {
      error() {},
      info() {},
      warn() {}
    }
  };
  globalThis.foundry = { applications: { instances: [] } };

  const createApp = (name, actorId = "") => ({
    rendered: true,
    ...(actorId ? { actor: { id: actorId, type: "character" } } : {}),
    async render(options) {
      calls.push({ name, options });
    }
  });

  return {
    calls,
    createApp,
    moduleApi: new RebreyaMainModule(),
    restore() {
      globalThis.game = previousGame;
      globalThis.ui = previousUi;
      globalThis.foundry = previousFoundry;
    }
  };
}

test("UiRefreshCoordinator coalesces duplicate keys requested in the same turn", async () => {
  const coordinator = new UiRefreshCoordinator();
  const calls = [];

  const first = coordinator.request([{ key: "inventory", run: async () => calls.push("first") }]);
  const second = coordinator.request([{ key: "inventory", run: async () => calls.push("second") }]);

  await Promise.all([first, second]);
  assert.deepEqual(calls, ["first"]);
});

test("UiRefreshCoordinator refreshes independent keys in one drain", async () => {
  const coordinator = new UiRefreshCoordinator();
  const calls = [];

  await coordinator.request([
    { key: "inventory", run: async () => calls.push("inventory") },
    { key: "actor-a", run: async () => calls.push("actor-a") }
  ]);

  assert.deepEqual(calls.sort(), ["actor-a", "inventory"]);
});

test("UiRefreshCoordinator runs a request added while the same key is active in a later pass", async () => {
  const coordinator = new UiRefreshCoordinator();
  const calls = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = coordinator.request([{
    key: "inventory",
    run: async () => {
      calls.push("first:start");
      await firstGate;
      calls.push("first:end");
    }
  }]);
  await Promise.resolve();
  await Promise.resolve();

  const second = coordinator.request([{
    key: "inventory",
    run: async () => calls.push("second")
  }]);
  releaseFirst();

  await Promise.all([first, second]);
  assert.deepEqual(calls, ["first:start", "first:end", "second"]);
});

test("UiRefreshCoordinator remains usable after an individual refresh rejects", async () => {
  const coordinator = new UiRefreshCoordinator();
  let successfulRuns = 0;

  await coordinator.request([{
    key: "broken",
    run: async () => {
      throw new Error("render failed");
    }
  }]);
  await coordinator.request([{
    key: "healthy",
    run: async () => {
      successfulRuns += 1;
    }
  }]);

  assert.equal(successfulRuns, 1);
});

test("UiRefreshCoordinator isolates synchronous render failures without dropping sibling tasks", async () => {
  const coordinator = new UiRefreshCoordinator();
  const calls = [];

  await coordinator.request([
    {
      key: "broken",
      run() {
        calls.push("broken");
        throw new Error("sync render failure");
      }
    },
    {
      key: "healthy",
      run() {
        calls.push("healthy");
      }
    }
  ]);

  assert.deepEqual(calls, ["broken", "healthy"]);
});

test("RebreyaMainModule coalesces concurrent full refreshes for the same application", async () => {
  const fixture = installUiFixture();
  try {
    fixture.moduleApi.economyApp = fixture.createApp("economy");

    await Promise.all([
      fixture.moduleApi.refreshOpenApps(),
      fixture.moduleApi.refreshOpenApps()
    ]);

    assert.deepEqual(fixture.calls.map((call) => call.name), ["economy"]);
    assert.equal(fixture.calls[0].options.focus, false);
  }
  finally {
    fixture.restore();
  }
});

test("cosmology refresh does not render unrelated open applications", async () => {
  const fixture = installUiFixture();
  try {
    fixture.moduleApi.cosmologyApp = fixture.createApp("cosmology");
    fixture.moduleApi.inventoryApp = fixture.createApp("inventory");
    fixture.moduleApi.traderV2Apps.set("trader", fixture.createApp("trader"));

    await fixture.moduleApi.refreshCosmologyViews();

    assert.deepEqual(fixture.calls.map((call) => call.name), ["cosmology"]);
  }
  finally {
    fixture.restore();
  }
});

test("cosmology setting changes request only the cosmology refresh scope", () => {
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const registrations = new Map();
  let scopedRefreshes = 0;
  let fullRefreshes = 0;
  globalThis.ui = {};
  globalThis.game = {
    settings: {
      register(moduleId, key, options) {
        if (moduleId === MODULE_ID) {
          registrations.set(key, options);
        }
      }
    },
    rebreyaMain: {
      refreshCosmologyViews() {
        scopedRefreshes += 1;
      },
      refreshOpenApps() {
        fullRefreshes += 1;
      }
    }
  };

  try {
    registerSettings();
    registrations.get(SETTINGS_KEYS.COSMOLOGY_STATE).onChange();
    assert.equal(scopedRefreshes, 1);
    assert.equal(fullRefreshes, 0);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
  }
});

test("downtime refresh renders only inventory and affected Actor sheets", async () => {
  const fixture = installUiFixture();
  try {
    fixture.moduleApi.inventoryApp = fixture.createApp("inventory");
    globalThis.ui.windows = {
      affected: fixture.createApp("actor-a", "actor-a"),
      unrelated: fixture.createApp("actor-b", "actor-b")
    };

    await fixture.moduleApi.refreshDowntimeViews({ actorIds: ["actor-a"] });

    assert.deepEqual(fixture.calls.map((call) => call.name).sort(), ["actor-a", "inventory"]);
  }
  finally {
    fixture.restore();
  }
});

test("actor sheet refreshes skip minimized character sheets", async () => {
  const fixture = installUiFixture();
  try {
    fixture.moduleApi.inventoryApp = fixture.createApp("inventory");
    globalThis.ui.windows = {
      visible: fixture.createApp("visible", "actor-a"),
      minimizedLegacy: {
        ...fixture.createApp("minimizedLegacy", "actor-a"),
        _minimized: true
      }
    };
    globalThis.foundry.applications.instances = new Map([[
      "minimizedV2",
      {
        ...fixture.createApp("minimizedV2", "actor-a"),
        minimized: true,
        document: { id: "actor-a", type: "character" }
      }
    ]]);

    await fixture.moduleApi.refreshDowntimeViews({ actorIds: ["actor-a"] });

    assert.deepEqual(fixture.calls.map((call) => call.name).sort(), ["inventory", "visible"]);
  }
  finally {
    fixture.restore();
  }
});

test("inventory refresh skips the party inventory while it is minimized", async () => {
  const fixture = installUiFixture();
  try {
    fixture.moduleApi.inventoryApp = {
      ...fixture.createApp("inventory"),
      minimized: true
    };

    await fixture.moduleApi.refreshInventoryViews();

    assert.deepEqual(fixture.calls, []);
  }
  finally {
    fixture.restore();
  }
});

test("inventory refresh without actor ids does not render every open Actor sheet", async () => {
  const fixture = installUiFixture();
  try {
    fixture.moduleApi.inventoryApp = fixture.createApp("inventory");
    globalThis.ui.windows = {
      actor: fixture.createApp("actor-a", "actor-a")
    };

    await fixture.moduleApi.refreshInventoryViews();

    assert.deepEqual(fixture.calls.map((call) => call.name), ["inventory"]);
  }
  finally {
    fixture.restore();
  }
});

test("multi-document inventory hooks wait for the mutation boundary and render once", async () => {
  const fixture = installUiFixture();
  const handlers = new Map();
  try {
    fixture.moduleApi.inventoryApp = fixture.createApp("inventory");
    registerInventorySyncHooks(fixture.moduleApi, {
      force: true,
      Hooks: {
        on(eventName, handler) {
          handlers.set(eventName, handler);
        }
      }
    });
    const actor = { id: "group-a", type: "group" };

    handlers.get("updateItem")({ parent: actor }, {}, {}, "gm");
    await Promise.resolve();
    await Promise.resolve();
    await fixture.moduleApi.runInventoryMutation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      handlers.get("deleteItem")({ parent: actor });
      return { actorId: "group-a" };
    });
    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.deepEqual(fixture.calls.map((call) => call.name), ["inventory"]);
  }
  finally {
    fixture.restore();
  }
});

test("take inventory refresh uses the Actor resolved by the service result", async () => {
  const fixture = installUiFixture();
  try {
    fixture.moduleApi.inventoryApp = fixture.createApp("inventory");
    globalThis.ui.windows = {
      resolved: fixture.createApp("resolved", "resolved-actor"),
      unrelated: fixture.createApp("unrelated", "other-actor")
    };
    fixture.moduleApi.inventoryService.takeInventoryItemToCharacter = async () => ({
      actorId: "resolved-actor",
      itemName: "Test item"
    });

    await fixture.moduleApi.takeInventoryItemToCharacter("item-a");

    assert.deepEqual(fixture.calls.map((call) => call.name).sort(), ["inventory", "resolved"]);
  }
  finally {
    fixture.restore();
  }
});

test("inventory take socket result routes refresh to the affected Actor sheet", async () => {
  const fixture = installUiFixture();
  try {
    fixture.moduleApi.inventoryApp = fixture.createApp("inventory");
    globalThis.ui.windows = {
      resolved: fixture.createApp("resolved", "resolved-actor"),
      unrelated: fixture.createApp("unrelated", "other-actor")
    };

    await fixture.moduleApi.handleSocketMessage({
      type: "inventory-item-action-result",
      forUserId: "gm",
      senderId: "other-gm",
      action: "take",
      actorId: "resolved-actor",
      ok: true
    });

    assert.deepEqual(fixture.calls.map((call) => call.name).sort(), ["inventory", "resolved"]);
  }
  finally {
    fixture.restore();
  }
});
