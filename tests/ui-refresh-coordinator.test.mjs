import test from "node:test";
import assert from "node:assert/strict";

import { UiRefreshCoordinator } from "../scripts/infrastructure/ui/ui-refresh-coordinator.js";
import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import { registerSettings } from "../scripts/settings.js";
import { buildPartyInventoryItemDragData, handleAcceptedPartyInventoryItem, registerInventorySyncHooks } from "../scripts/integrations/inventory-sync.js";

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
  const previousWindow = globalThis.window;
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
  globalThis.window = {
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout
  };
  globalThis.foundry = {
    applications: {
      instances: [],
      api: {
        ApplicationV2: class {
          constructor(options = {}) {
            this.options = structuredClone(options);
            this.rendered = false;
            this.minimized = false;
          }

          async render(options = {}) {
            this.rendered = true;
            this.renderOptions = options;
            return this;
          }

          async close(options = {}) {
            await this._preClose?.(options);
            this.rendered = false;
            await this._onClose?.(options);
          }

          async _preClose() {}
          async _onClose() {}

          bringToFront() {
            this.bringToFrontCalls = (this.bringToFrontCalls ?? 0) + 1;
          }
        },
        HandlebarsApplicationMixin: (Base) => class extends Base {},
        DialogV2: {}
      }
    },
    utils: {
      escapeHTML: (value) => String(value ?? "")
    }
  };

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
      globalThis.window = previousWindow;
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

test("UiRefreshCoordinator lets an unrelated caller finish while an earlier window is rendering", async () => {
  const coordinator = new UiRefreshCoordinator();
  let release, healthyFinished = false;
  const gate = new Promise(resolve => { release = resolve; });
  const slow = coordinator.request([{ key: "trader", run: () => gate }]);
  await new Promise(resolve => setImmediate(resolve));
  const healthy = coordinator.request([{ key: "inventory", run: () => "fresh inventory" }])
    .then(results => { healthyFinished = true; assert.deepEqual(results, [{ status: "fulfilled", value: "fresh inventory" }]); });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(healthyFinished, true);
  } finally { release(); await Promise.all([slow, healthy]); }
});

test("UiRefreshCoordinator only waits for the caller's own pass of a busy app", async () => {
  const coordinator = new UiRefreshCoordinator();
  let releaseFirst, releaseSecond, firstFinished = false;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const secondGate = new Promise(resolve => { releaseSecond = resolve; });
  const first = coordinator.request([{ key: "inventory", run: () => firstGate }]).then(() => { firstFinished = true; });
  await new Promise(resolve => setImmediate(resolve));
  let secondRuns = 0;
  const second = coordinator.request([{ key: "inventory", run: () => { secondRuns++; return secondGate; } }]);
  const joined = coordinator.request([{ key: "inventory", run: () => { throw Error("coalescing failed"); } }]);
  releaseFirst();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(firstFinished, true);
    assert.equal(secondRuns, 1);
  } finally { releaseSecond(); await Promise.all([first, second, joined]); }
});

test("UiRefreshCoordinator retains a reentrant refresh after the current render fails", async () => {
  const coordinator = new UiRefreshCoordinator();
  let next, runs = 0;
  const first = await coordinator.request([{ key: "inventory", run: () => {
    next = coordinator.request([{ key: "inventory", run: () => ++runs }]);
    throw Error("render failed");
  } }]);
  assert.equal(first[0].status, "rejected");
  assert.deepEqual(await next, [{ status: "fulfilled", value: 1 }]);
  assert.equal(runs, 1);
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

test("city presentation refresh targets only requested city apps", async () => {
  const fixture = installUiFixture();
  try {
    fixture.moduleApi.cityApps.set("a", fixture.createApp("city-a"));
    fixture.moduleApi.cityApps.set("b", fixture.createApp("city-b"));

    await fixture.moduleApi.refreshCityViews({ cityIds: ["b"] });

    assert.deepEqual(fixture.calls.map((call) => call.name), ["city-b"]);
    assert.equal(fixture.calls[0].options.focus, false);
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

test("second full inventory reuses its own window, refreshes with main and closes independently", async () => {
  const fixture = installUiFixture();
  try {
    fixture.moduleApi.inventoryService.getInventoryActor = async () => ({ id: "group-a" });
    const main = await fixture.moduleApi.openInventoryApp();
    const second = await fixture.moduleApi.openInventoryApp({ newWindow: true });
    assert.notEqual(second, main);
    assert.notEqual(second.id, main.id);
    assert.equal(second.rootFolderId, null);
    assert.equal(second.groupActorId, "");
    assert.equal(await fixture.moduleApi.openInventoryApp({ newWindow: true }), second);
    second.search = "sword"; second.typeFilter = "weapon";
    assert.equal(main.search, ""); assert.equal(main.typeFilter, "all");
    let mainRefresh = 0, secondRefresh = 0;
    main.refreshInventorySnapshot = async () => mainRefresh++;
    second.refreshInventorySnapshot = async () => secondRefresh++;
    await fixture.moduleApi.refreshInventoryViews();
    assert.equal(mainRefresh, 1); assert.equal(secondRefresh, 1);
    await second.close();
    assert.equal(main.rendered, true);
    assert.equal(fixture.moduleApi.inventoryFolderApps.has("full:secondary"), false);
    assert.notEqual(await fixture.moduleApi.openInventoryApp({ newWindow: true }), second);
  } finally { fixture.restore(); }
});

test("folder popout registry reuses exact scopes, keeps distinct scopes separate and unregisters by identity", async () => {
  const fixture = installUiFixture();
  const userFlagWrites = [];
  try {
    globalThis.game.modules = new Map([[MODULE_ID, { version: `folder-popouts-${Date.now()}` }]]);
    globalThis.game.user.setFlag = async (...args) => userFlagWrites.push(args);
    fixture.moduleApi.inventoryService.getInventorySnapshot = async ({ groupActorId } = {}) => ({
      actor: { id: groupActorId, type: "group" },
      folders: [
        { id: "weapons", name: "Оружие", parentId: null },
        { id: "potions", name: "Зелья", parentId: null }
      ]
    });

    const weapons = await fixture.moduleApi.openInventoryFolderPopout("group-a", "weapons");
    const reusedWeapons = await fixture.moduleApi.openInventoryFolderPopout("group-a", "weapons");
    const potions = await fixture.moduleApi.openInventoryFolderPopout("group-a", "potions");

    assert.equal(reusedWeapons, weapons);
    assert.notEqual(potions, weapons);
    assert.equal(fixture.moduleApi.inventoryFolderApps.size, 2);
    assert.equal(weapons.options.window.title, "Оружие");
    assert.notEqual(weapons.id, potions.id);
    assert.equal(weapons.inventoryViewKey, "group-a:weapons");
    assert.equal(weapons.bringToFrontCalls, 2);
    assert.deepEqual(userFlagWrites, []);

    const replacement = { inventoryViewKey: weapons.inventoryViewKey };
    fixture.moduleApi.unregisterInventoryFolderPopout(weapons.inventoryViewKey, replacement);
    assert.equal(fixture.moduleApi.inventoryFolderApps.get(weapons.inventoryViewKey), weapons);
    await weapons.close({ reason: "manual" });
    assert.equal(fixture.moduleApi.inventoryFolderApps.has(weapons.inventoryViewKey), false);
    assert.equal(fixture.moduleApi.inventoryFolderApps.get(potions.inventoryViewKey), potions);
    assert.equal(new RebreyaMainModule().inventoryFolderApps.size, 0);
  }
  finally {
    fixture.restore();
  }
});

test("inventory refresh targets only live views and Actor sheets in the affected group scope", async () => {
  const fixture = installUiFixture();
  const refreshCalls = [];
  const inventoryView = (name, actorId, overrides = {}) => ({
    rendered: true,
    inventoryActorId: actorId,
    async refreshInventorySnapshot(options) {
      refreshCalls.push({ name, options });
    },
    ...overrides
  });
  try {
    fixture.moduleApi.inventoryApp = inventoryView("main-a", "group-a");
    fixture.moduleApi.inventoryFolderApps.set("group-a:weapons", inventoryView("weapons-a", "group-a"));
    fixture.moduleApi.inventoryFolderApps.set("group-a:potions", inventoryView("potions-a", "group-a", { minimized: true }));
    fixture.moduleApi.inventoryFolderApps.set("group-b:weapons", inventoryView("weapons-b", "group-b"));
    fixture.moduleApi.inventoryFolderApps.set("group-a:closed", inventoryView("closed-a", "group-a", { rendered: false }));
    globalThis.ui.windows = {
      affected: fixture.createApp("actor-a", "group-a"),
      unrelated: fixture.createApp("actor-b", "group-b")
    };

    await fixture.moduleApi.refreshInventoryViews({ actorIds: ["group-a"] });

    assert.deepEqual(refreshCalls, [
      { name: "main-a", options: { preserveScroll: true } },
      { name: "weapons-a", options: { preserveScroll: true } }
    ]);
    assert.deepEqual(fixture.calls, [{ name: "actor-a", options: { force: true, focus: false } }]);
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

test("runInventoryMutation returns the authoritative result before the default scoped refresh settles", async () => {
  const fixture = installUiFixture();
  let rejectRefresh;
  let refreshCalls = 0;
  let mutationResolved = false;
  let holdCountAtResolution = null;
  const warnings = [];
  const previousConsoleError = console.error;
  try {
    console.error = () => {};
    globalThis.ui.notifications.warn = (message) => warnings.push(message);
    fixture.moduleApi.refreshInventoryViews = async ({ actorIds }) => {
      refreshCalls += 1;
      assert.deepEqual(actorIds, ["group-a", "hero-a"]);
      return new Promise((_resolve, reject) => { rejectRefresh = reject; });
    };

    const mutation = fixture.moduleApi.runInventoryMutation(
      async () => ({ actorId: "hero-a", sourceActorId: "group-a", changed: true }),
      {
        actorIdsFromResult: (result) => [result.sourceActorId, result.actorId]
      }
    ).then((result) => {
      mutationResolved = true;
      holdCountAtResolution = fixture.moduleApi.inventoryRefreshHoldCount;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(mutationResolved, true);
    assert.equal(holdCountAtResolution, 0);
    assert.equal(refreshCalls, 1);
    assert.deepEqual(await mutation, { actorId: "hero-a", sourceActorId: "group-a", changed: true });

    rejectRefresh(new Error("render failed"));
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(warnings, ["Инвентарь изменён, но интерфейс не удалось обновить автоматически."]);
  }
  finally {
    console.error = previousConsoleError;
    fixture.restore();
  }
});

test("runInventoryMutation waits for refresh only when an explicit caller requests it", async () => {
  const fixture = installUiFixture();
  let resolveRefresh;
  let mutationResolved = false;
  try {
    fixture.moduleApi.refreshInventoryViews = () => new Promise((resolve) => {
      resolveRefresh = resolve;
    });

    const mutation = fixture.moduleApi.runInventoryMutation(
      async () => ({ actorId: "hero-a", changed: true }),
      { awaitRefresh: true }
    ).then((result) => {
      mutationResolved = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(fixture.moduleApi.inventoryRefreshHoldCount, 0);
    assert.equal(mutationResolved, false);

    resolveRefresh();
    assert.deepEqual(await mutation, { actorId: "hero-a", changed: true });
  }
  finally {
    fixture.restore();
  }
});

test("simple take failure schedules deferred refresh for the exact source and target Actors", async () => {
  const fixture = installUiFixture();
  const refreshedScopes = [];
  try {
    fixture.moduleApi.refreshInventoryViews = async ({ actorIds }) => {
      refreshedScopes.push(actorIds);
    };
    fixture.moduleApi.inventoryService.takeInventoryItemToCharacter = async () => {
      const error = new Error("manual review required");
      Object.assign(error, {
        code: "transfer-manual-review",
        inventoryTransferMode: "simple",
        sourceActorId: "source-group",
        targetActorId: "target-hero"
      });
      throw error;
    };

    await assert.rejects(
      fixture.moduleApi.takeInventoryItemToCharacter("item-a"),
      (error) => error?.code === "transfer-manual-review"
    );
    await Promise.resolve();

    assert.deepEqual(refreshedScopes, [["source-group", "target-hero"]]);
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
    await new Promise((resolve) => setTimeout(resolve, 100));

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
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.deepEqual(fixture.calls.map((call) => call.name).sort(), ["inventory", "resolved"]);
  }
  finally {
    fixture.restore();
  }
});

for (const route of ["accepted-item", "socket-request", "socket-result"]) {
  test(`party transfer refreshes only the source inventory and recipient sheet: ${route}`, async () => {
    const fixture = installUiFixture();
    try {
      game.user.active = true;
      game.users.activeGM = game.user;
      const affected = fixture.createApp("source-inventory");
      affected.inventoryActorId = "source-group";
      const unrelated = fixture.createApp("other-inventory");
      unrelated.inventoryActorId = "other-group";
      fixture.moduleApi.inventoryApp = affected;
      fixture.moduleApi.inventoryFolderApps.set("other", unrelated);
      ui.windows = { hero: fixture.createApp("recipient", "hero"), other: fixture.createApp("other-sheet", "other-hero") };
      const result = { handled: true, actorId: "source-group", targetActorId: "hero" };
      fixture.moduleApi.inventoryService.handlePartyInventorySourceDepletionSocketRequest = async () => result;
      fixture.moduleApi.inventoryService.handleAcceptedPartyInventoryItem = async () => result;
      fixture.moduleApi.initializeItem = async () => {};
      if (route === "accepted-item") {
        const source = { uuid: "Actor.source-group.Item.torch", name: "Torch", type: "loot", system: { quantity: 1 } };
        const target = { ...source, uuid: "Actor.hero.Item.copy", parent: { id: "hero", type: "character" } };
        buildPartyInventoryItemDragData(source.uuid, source);
        await handleAcceptedPartyInventoryItem(target, {}, "gm", fixture.moduleApi);
      }
      else {
        await fixture.moduleApi.handleSocketMessage({
          type: route === "socket-request" ? "inventory-source-depletion-request" : "inventory-source-depletion-result",
          senderId: route === "socket-request" ? "player" : "other-gm", forUserId: "gm", ok: true,
          actorId: "source-group", targetActorId: "hero"
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(fixture.calls.map(call => call.name).sort(), ["recipient", "source-inventory"]);
    }
    finally { fixture.restore(); }
  });
}
test("combat status refresh leaves unrelated windows and sheets untouched", async () => {
  const fixture = installUiFixture();
  try {
    fixture.moduleApi.economyApp = fixture.createApp("economy");
    globalThis.ui.windows = { affected: fixture.createApp("actor-a", "actor-a"), unrelated: fixture.createApp("actor-b", "actor-b") };
    fixture.moduleApi.combatStatusService.setStatus = async () => true;
    await fixture.moduleApi.setCombatStatus({ id: "actor-a", type: "npc" }, "test", {});
    assert.deepEqual(fixture.calls.map(call => call.name), ["actor-a"]);
  } finally { fixture.restore(); }
});

test("scoped combat refresh updates only the affected actor sheet", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.economyApp = f.createApp("economy"); f.moduleApi.inventoryApp = f.createApp("inventory");
    globalThis.ui.windows = { a: f.createApp("a", "actor-a"), b: f.createApp("b", "actor-b") };
    await f.moduleApi.refreshScopedViews({ scope: "combat", actorIds: ["actor-a"] });
    assert.deepEqual(f.calls.map(c => c.name), ["a"]);
  } finally { f.restore(); }
});

test("scoped economy refresh updates economy surfaces without actor sheets or group UI", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.economyApp = f.createApp("economy"); f.moduleApi.groupsApp = f.createApp("group");
    f.moduleApi.cityApps.set("city-a", f.createApp("city")); f.moduleApi.cosmologyApp = f.createApp("cosmology");
    globalThis.ui.windows = { b: f.createApp("b", "actor-b") };
    await f.moduleApi.refreshScopedViews({ scope: "economy" });
    assert.deepEqual(f.calls.map(c => c.name).sort(), ["city", "economy"]);
  } finally { f.restore(); }
});


test("reaction and firearm maintenance refresh only the affected actor", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.economyApp = f.createApp("economy");
    globalThis.ui.windows = { a: f.createApp("a", "actor-a"), b: f.createApp("b", "actor-b") };
    const actor = { id: "actor-a", type: "character" };
    f.moduleApi.combatAttackService.consumeReaction = async () => ({ consumed: true });
    f.moduleApi.combatAttackService.maintainFirearm = async () => ({ maintained: true });
    await f.moduleApi.consumeReaction(actor); await f.moduleApi.maintainFirearm({ actor });
    assert.deepEqual(f.calls.map(c => c.name), ["a", "a"]);
  } finally { f.restore(); }
});
test("equipment refresh updates only inventories containing the affected actor", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.inventoryApp = { ...f.createApp("inventory-a"), inventoryActorId: "group-a" };
    f.moduleApi.inventoryFolderApps.set("b", { ...f.createApp("inventory-b"), inventoryActorId: "group-b" });
    f.moduleApi.groupContextService.resolveReferenceForGroup = id => ({ memberActorIds: id === "group-a" ? ["actor-a"] : ["actor-b"] });
    globalThis.ui.windows = { a: f.createApp("a", "actor-a"), b: f.createApp("b", "actor-b") };
    await f.moduleApi.refreshScopedViews({ scope: "equipment", actorIds: ["actor-a"] });
    assert.deepEqual(f.calls.map(c => c.name).sort(), ["a", "inventory-a"]);
  } finally { f.restore(); }
});
test("weapon modification activity refreshes only its actor and relevant inventory", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.economyApp = f.createApp("economy");
    f.moduleApi.inventoryApp = { ...f.createApp("inventory-a"), inventoryActorId: "group-a" };
    f.moduleApi.inventoryFolderApps.set("b", { ...f.createApp("inventory-b"), inventoryActorId: "group-b" });
    f.moduleApi.groupContextService.resolveReferenceForGroup = id => ({ memberActorIds: id === "group-a" ? ["actor-a"] : ["actor-b"] });
    f.moduleApi.privilegedMutationGateway.mutate = async () => ({ ok: true });
    globalThis.ui.windows = { a: f.createApp("a", "actor-a"), b: f.createApp("b", "actor-b") };
    globalThis.ui.windows.a.actor.uuid = "Actor.actor-a";
    await f.moduleApi.useWeaponModActivity({ actorUuid: "Actor.actor-a", operationId: "operation" });
    assert.deepEqual(f.calls.map(c => c.name).sort(), ["a", "inventory-a"]);
  } finally { f.restore(); }
});
test("trade refresh keeps the active trader and other views of the buyer current", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.economyApp = f.createApp("economy"); f.moduleApi.cosmologyApp = f.createApp("cosmology");
    f.moduleApi.cityApps.set("city-a", { ...f.createApp("city-a"), cityId: "city-a" });
    f.moduleApi.cityApps.set("city-b", { ...f.createApp("city-b"), cityId: "city-b" });
    f.moduleApi.traderV2Apps.set("a", { ...f.createApp("shop-a"), cityId: "city-a", traderKey: "a" });
    f.moduleApi.traderV2Apps.set("buyer", { ...f.createApp("shop-buyer"), cityId: "city-b", traderKey: "b", selectedActorId: "actor-a" });
    f.moduleApi.traderV2Apps.set("other", { ...f.createApp("shop-other"), cityId: "city-b", traderKey: "c", selectedActorId: "actor-b" });
    globalThis.ui.windows = { a: f.createApp("a", "actor-a"), b: f.createApp("b", "actor-b") };
    await f.moduleApi.refreshScopedViews({ scope: "trade", actorIds: ["actor-a"], cityId: "city-a", traderKey: "a" });
    assert.deepEqual(f.calls.map(c => c.name).sort(), ["a", "city-a", "economy", "shop-a", "shop-buyer"]);
  } finally { f.restore(); }
});
test("transport refresh updates the affected group inventory and vehicle only", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.inventoryApp = { ...f.createApp("inventory-a"), inventoryActorId: "group-a" };
    f.moduleApi.inventoryFolderApps.set("b", { ...f.createApp("inventory-b"), inventoryActorId: "group-b" });
    f.moduleApi.economyApp = f.createApp("economy"); f.moduleApi.groupsApp = f.createApp("groups");
    f.moduleApi.groupContextService.resolveReferenceForGroup = id => ({ memberActorIds: id === "group-a" ? ["vehicle-a"] : ["vehicle-b"] });
    globalThis.ui.windows = { a: f.createApp("a", "vehicle-a"), b: f.createApp("b", "vehicle-b") };
    await f.moduleApi.refreshScopedViews({ scope: "transport", actorIds: ["group-a", "vehicle-a"] });
    assert.deepEqual(f.calls.map(c => c.name).sort(), ["a", "inventory-a"]);
  } finally { f.restore(); }
});
test("bloodied synchronization refreshes only actors reported changed", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.economyApp = f.createApp("economy");
    globalThis.ui.windows = { a: f.createApp("a", "actor-a"), b: f.createApp("b", "actor-b") };
    f.moduleApi.combatStatusService.syncBloodiedForAllActors = async ({ onActorChanged } = {}) => { onActorChanged?.({ id: "actor-a" }); return { scanned: 2, changed: 1 }; };
    const result = await f.moduleApi.syncBloodiedStatuses();
    assert.deepEqual(result, { scanned: 2, changed: 1 });
    assert.deepEqual(f.calls.map(c => c.name), ["a"]);
  } finally { f.restore(); }
});
test("global event configuration refreshes economy data without unrelated sheets", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.economyApp = f.createApp("economy"); f.moduleApi.groupsApp = f.createApp("groups");
    f.moduleApi.cityApps.set("city-a", f.createApp("city"));
    f.moduleApi.repository.rebuildModel = async () => {};
    globalThis.ui.windows = { a: f.createApp("a", "actor-a") };
    await f.moduleApi.handleGlobalEventsConfigChange();
    assert.deepEqual(f.calls.map(c => c.name).sort(), ["city", "economy"]);
  } finally { f.restore(); }
});
test("time of day updates the calendar views and leaves unrelated sheets and cosmology idle", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.calendarService.setTimeOfDaySeconds = async () => ({ seconds: 7200 });
    f.moduleApi.inventoryApp = f.createApp("inventory"); f.moduleApi.economyApp = f.createApp("economy");
    f.moduleApi.cosmologyApp = f.createApp("cosmology");
    globalThis.ui.windows = { a: f.createApp("a", "actor-a") };
    const result = await f.moduleApi.setCalendarTimeOfDay(7200, { refreshSmallTime: false });
    assert.deepEqual(result, { seconds: 7200 });
    assert.deepEqual(f.calls.map(c => c.name), ["inventory"]);
  } finally { f.restore(); }
});
test("trade rollback refreshes only the affected actor and trade views", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.economyApp = f.createApp("economy"); f.moduleApi.cosmologyApp = f.createApp("cosmology");
    globalThis.ui.windows = { a: f.createApp("a", "actor-a"), b: f.createApp("b", "actor-b") };
    globalThis.game.user.active = true;
    globalThis.game.users = { contents: [globalThis.game.user] };
    f.moduleApi.traderService.rollbackTradeAuditEntry = async () => ({ actorId: "actor-a" });
    f.moduleApi.traderService.getTradeAuditLog = () => [];
    await f.moduleApi.rollbackTraderAuditEntry("purchase", { rollbackTransactionId: "rollback" });
    assert.deepEqual(f.calls.map(c => c.name).sort(), ["a", "economy"]);
  } finally { f.restore(); }
});
test("synthetic actor refresh uses UUID and leaves another token of the same actor untouched", async () => {
  const f = installUiFixture();
  try {
    const a = f.createApp("a", "shared"), b = f.createApp("b", "shared");
    a.actor.uuid = "Scene.scene.Token.one.Actor.shared"; b.actor.uuid = "Scene.scene.Token.two.Actor.shared";
    globalThis.ui.windows = { a, b };
    await f.moduleApi.refreshScopedViews({ scope: "combat", actorUuids: [a.actor.uuid] });
    assert.deepEqual(f.calls.map(c => c.name), ["a"]);
  } finally { f.restore(); }
});
test("status on a synthetic token refreshes only its own sheet", async () => {
  const f = installUiFixture();
  try {
    const a = f.createApp("a", "shared"), b = f.createApp("b", "shared");
    a.actor.uuid = "Scene.scene.Token.one.Actor.shared"; b.actor.uuid = "Scene.scene.Token.two.Actor.shared";
    globalThis.ui.windows = { a, b }; f.moduleApi.combatStatusService.setStatus = async () => true;
    await f.moduleApi.setCombatStatus(a.actor, "test");
    assert.deepEqual(f.calls.map(c => c.name), ["a"]);
  } finally { f.restore(); }
});
test("a purchase refreshes a second shop displaying the buyer's group funds", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.groupContextService.resolveReferenceForGroup = id => ({ memberActorIds: id === "group-a" ? ["actor-a"] : ["actor-b"] });
    f.moduleApi.traderV2Apps.set("buyer", { ...f.createApp("group-shop"), cityId: "city-b", traderKey: "b", partyInventoryActorId: "group-a" });
    f.moduleApi.traderV2Apps.set("other", { ...f.createApp("other-shop"), cityId: "city-b", traderKey: "c", partyInventoryActorId: "group-b" });
    await f.moduleApi.refreshScopedViews({ scope: "trade", actorIds: ["actor-a"], cityId: "city-a", traderKey: "a" });
    assert.deepEqual(f.calls.map(c => c.name), ["group-shop"]);
  } finally { f.restore(); }
});
test("feat compendium synchronization does not rerender unrelated windows", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.economyApp = f.createApp("economy"); f.moduleApi.lootgenApps.set("loot", f.createApp("loot"));
    globalThis.ui.windows = { a: f.createApp("a", "actor-a") };
    f.moduleApi.featsCompendium.syncFromWorldCompendium = async () => ({ itemCount: 3 });
    assert.deepEqual(await f.moduleApi.syncFeatsFromWorldCompendium(), { itemCount: 3 });
    assert.deepEqual(f.calls.map(c => c.name), ["loot"]);
  } finally { f.restore(); }
});
test("economy reset does not rerender unrelated actor sheets", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.economyApp = f.createApp("economy"); f.moduleApi.cosmologyApp = f.createApp("cosmology");
    globalThis.ui.windows = { a: f.createApp("a", "actor-a") };
    f.moduleApi.privilegedMutationGateway.mutate = async () => ({ ok: true });
    await f.moduleApi.resetWorldData();
    assert.deepEqual(f.calls.map(c => c.name), ["economy"]);
  } finally { f.restore(); }
});
test("equipment changes refresh a trader showing that actor's sale items", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.traderV2Apps.set("mine", { ...f.createApp("mine"), saleSellerActorId: "actor-a" });
    f.moduleApi.traderV2Apps.set("other", { ...f.createApp("other"), saleSellerActorId: "actor-b" });
    await f.moduleApi.refreshScopedViews({ scope: "equipment", actorIds: ["actor-a"] });
    assert.deepEqual(f.calls.map(c => c.name), ["mine"]);
  } finally { f.restore(); }
});
test("time change refreshes only the captured group's calendar inventory", async () => {
  const f = installUiFixture();
  try {
    f.moduleApi.inventoryApp = { ...f.createApp("a"), inventoryActorId: "group-a" };
    f.moduleApi.inventoryFolderApps.set("b", { ...f.createApp("b"), inventoryActorId: "group-b" });
    f.moduleApi.groupContextService.resolveReferenceForCurrentUser = () => ({ groupId: "group-a" });
    f.moduleApi.calendarService.setTimeOfDaySeconds = async () => ({ seconds: 2 });
    await f.moduleApi.setCalendarTimeOfDay(2, { refreshSmallTime: false });
    assert.deepEqual(f.calls.map(c => c.name), ["a"]);
  } finally { f.restore(); }
});
test("a minimized affected sheet refreshes once when restored", async () => {
  const f = installUiFixture();
  try {
    const app = { ...f.createApp("a", "actor-a"), minimized: true, async maximize() { this.minimized = false; } };
    globalThis.ui.windows = { a: app };
    await f.moduleApi.refreshScopedViews({ scope: "combat", actorIds: ["actor-a"] });
    await f.moduleApi.refreshScopedViews({ scope: "combat", actorIds: ["actor-a"] });
    assert.deepEqual(f.calls, []);
    await app.maximize();
    assert.deepEqual(f.calls.map(c => c.name), ["a"]);
  } finally { f.restore(); }
});
test("item hook and equipment operation coalesce one actor and group render", async () => {
  const f = installUiFixture(); const handlers = new Map();
  try {
    const actor = { id: "actor-a", type: "character" };
    f.moduleApi.inventoryApp = { ...f.createApp("inventory-a"), inventoryActorId: "group-a" };
    f.moduleApi.groupContextService.resolveReferenceForGroup = () => ({ memberActorIds: ["actor-a"] });
    globalThis.ui.windows = { a: f.createApp("a", "actor-a") };
    registerInventorySyncHooks(f.moduleApi, { force: true, Hooks: { on(name, fn) { handlers.set(name, fn); } } });
    handlers.get("updateItem")({ parent: actor }, {}, {}, "gm");
    await f.moduleApi.refreshScopedViews({ scope: "equipment", actorIds: ["actor-a"] });
    await new Promise(resolve => setTimeout(resolve, 140));
    assert.deepEqual(f.calls.map(c => c.name).sort(), ["a", "inventory-a"]);
  } finally { f.restore(); }
});
test("synthetic item hook coalesces with equipment refresh without touching another token", async () => {
  const f = installUiFixture(); const handlers = new Map();
  try {
    const a = f.createApp("a", "shared"), b = f.createApp("b", "shared");
    a.actor.uuid = "Scene.scene.Token.one.Actor.shared"; b.actor.uuid = "Scene.scene.Token.two.Actor.shared";
    a.actor.isToken = true; b.actor.isToken = true; globalThis.ui.windows = { a, b };
    registerInventorySyncHooks(f.moduleApi, { force: true, Hooks: { on(name, fn) { handlers.set(name, fn); } } });
    handlers.get("updateItem")({ parent: a.actor }, {}, {}, "gm");
    await f.moduleApi.refreshScopedViews({ scope: "equipment", actorUuids: [a.actor.uuid] });
    await new Promise(resolve => setTimeout(resolve, 140));
    assert.deepEqual(f.calls.map(c => c.name), ["a"]);
  } finally { f.restore(); }
});
test("item hook and trade operation coalesce one actor and group render", async () => {
  const f = installUiFixture(); const handlers = new Map();
  try {
    const actor = { id: "actor-a", type: "character" };
    f.moduleApi.inventoryApp = { ...f.createApp("inventory-a"), inventoryActorId: "group-a" };
    f.moduleApi.groupContextService.resolveReferenceForGroup = () => ({ memberActorIds: ["actor-a"] });
    globalThis.ui.windows = { a: f.createApp("a", "actor-a") };
    registerInventorySyncHooks(f.moduleApi, { force: true, Hooks: { on(name, fn) { handlers.set(name, fn); } } });
    handlers.get("updateItem")({ parent: actor }, {}, {}, "gm");
    await f.moduleApi.refreshScopedViews({ scope: "trade", cityId: "city-a", traderKey: "a", actorIds: ["actor-a"] });
    await new Promise(resolve => setTimeout(resolve, 140));
    assert.deepEqual(f.calls.map(c => c.name).sort(), ["a", "inventory-a"]);
  } finally { f.restore(); }
});
test("group hook and transport operation coalesce one group inventory render", async () => {
  const f = installUiFixture(); const handlers = new Map();
  try {
    const actor = { id: "group-a", type: "group" };
    f.moduleApi.inventoryApp = { ...f.createApp("inventory-a"), inventoryActorId: "group-a" };
    registerInventorySyncHooks(f.moduleApi, { force: true, Hooks: { on(name, fn) { handlers.set(name, fn); } } });
    handlers.get("updateActor")(actor);
    await f.moduleApi.refreshScopedViews({ scope: "transport", actorIds: ["group-a"] });
    await new Promise(resolve => setTimeout(resolve, 140));
    assert.deepEqual(f.calls.map(c => c.name), ["inventory-a"]);
  } finally { f.restore(); }
});
test("group hook and calendar clock refresh coalesce the inventory view", async () => {
  const f = installUiFixture(); const handlers = new Map();
  try {
    const actor = { id: "group-a", type: "group" };
    f.moduleApi.inventoryApp = { ...f.createApp("inventory-a"), inventoryActorId: "group-a" };
    f.moduleApi.groupContextService.resolveReferenceForCurrentUser = () => ({ groupId: "group-a" });
    f.moduleApi.calendarService.setTimeOfDaySeconds = async () => ({ seconds: 2 });
    registerInventorySyncHooks(f.moduleApi, { force: true, Hooks: { on(name, fn) { handlers.set(name, fn); } } });
    handlers.get("updateActor")(actor);
    await f.moduleApi.setCalendarTimeOfDay(2, { refreshSmallTime: false });
    await new Promise(resolve => setTimeout(resolve, 140));
    assert.deepEqual(f.calls.map(c => c.name), ["inventory-a"]);
  } finally { f.restore(); }
});
test("group hook and group operation coalesce the inventory view", async () => {
  const f = installUiFixture(); const handlers = new Map();
  try {
    const actor = { id: "group-a", type: "group" };
    f.moduleApi.inventoryApp = { ...f.createApp("inventory-a"), inventoryActorId: "group-a" };
    registerInventorySyncHooks(f.moduleApi, { force: true, Hooks: { on(name, fn) { handlers.set(name, fn); } } });
    handlers.get("updateActor")(actor);
    await f.moduleApi.refreshScopedViews({ scope: "group", actorIds: ["group-a"] });
    await new Promise(resolve => setTimeout(resolve, 140));
    assert.deepEqual(f.calls.map(c => c.name), ["inventory-a"]);
  } finally { f.restore(); }
});
test("a minimized inventory invalidates its snapshot once when restored", async () => {
  const f = installUiFixture();
  try {
    const app = { rendered: true, minimized: true, inventoryActorId: "group-a", async maximize() { this.minimized = false; }, async refreshInventorySnapshot(options) { f.calls.push({ name: "inventory", options }); } };
    f.moduleApi.inventoryApp = app;
    await f.moduleApi.refreshScopedViews({ scope: "clock", groupIds: ["group-a"] });
    assert.deepEqual(f.calls, []); await app.maximize();
    assert.deepEqual(f.calls, [{ name: "inventory", options: { preserveScroll: true } }]);
  } finally { f.restore(); }
});
test("reaction-only actor updates do not refresh inventory or other actor sheets", async () => {
  const f = installUiFixture(); const handlers = new Map();
  try {
    const actor = { id: "actor-a", type: "character" };
    f.moduleApi.inventoryApp = f.createApp("inventory"); globalThis.ui.windows = { a: f.createApp("a", "actor-a") };
    registerInventorySyncHooks(f.moduleApi, { force: true, Hooks: { on(name, fn) { handlers.set(name, fn); } } });
    handlers.get("updateActor")(actor, { flags: { "rebreya-main": { reactionState: { usesRemaining: 0 } } } });
    handlers.get("updateActor")(actor, { "flags.rebreya-main.reactionState.usesRemaining": 0 });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual(f.calls, []);
  } finally { f.restore(); }
});
test("reaction updates combined with another actor change still refresh inventory", async () => {
  const f = installUiFixture(); const handlers = new Map();
  try {
    const actor = { id: "actor-a", type: "character" };
    f.moduleApi.inventoryApp = f.createApp("inventory");
    registerInventorySyncHooks(f.moduleApi, { force: true, Hooks: { on(name, fn) { handlers.set(name, fn); } } });
    handlers.get("updateActor")(actor, { flags: { "rebreya-main": { reactionState: { usesRemaining: 0 }, other: true } } });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual(f.calls.map(c => c.name), ["inventory"]);
  } finally { f.restore(); }
});
test("firearm maintenance coalesces item updates with the affected views", async () => {
  const f = installUiFixture(); const handlers = new Map();
  try {
    const actor = { id: "actor-a", type: "character" };
    f.moduleApi.inventoryApp = f.createApp("inventory"); globalThis.ui.windows = { a: f.createApp("a", "actor-a") };
    registerInventorySyncHooks(f.moduleApi, { force: true, Hooks: { on(name, fn) { handlers.set(name, fn); } } });
    f.moduleApi.combatAttackService.clearFirearmJam = async () => { handlers.get("updateItem")({ parent: actor }, {}, {}, "gm"); return {}; };
    await f.moduleApi.clearFirearmJam({ actor }); await new Promise(resolve => setTimeout(resolve, 140));
    assert.deepEqual(f.calls.map(c => c.name).sort(), ["a", "inventory"]);
  } finally { f.restore(); }
});
test("firearm maintenance accepts a synthetic Actor without selecting its token parent as actor", async () => {
  const f = installUiFixture();
  try {
    const a = f.createApp("a", "shared"), b = f.createApp("b", "shared");
    a.actor.uuid = "Scene.scene.Token.one.Actor.shared"; a.actor.documentName = "Actor"; a.actor.parent = { id: "one", uuid: "Scene.scene.Token.one" };
    b.actor.uuid = "Scene.scene.Token.two.Actor.shared";
    globalThis.ui.windows = { a, b }; f.moduleApi.combatAttackService.maintainFirearm = async () => ({ success: true });
    await f.moduleApi.maintainFirearm(a.actor); assert.deepEqual(f.calls.map(c => c.name), ["a"]);
  } finally { f.restore(); }
});
