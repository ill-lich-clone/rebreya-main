import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";

function installFoundryApplicationStub() {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    utils: {
      escapeHTML: (value) => String(value ?? "")
        .replace(/&/gu, "&amp;")
        .replace(/</gu, "&lt;")
        .replace(/>/gu, "&gt;")
        .replace(/"/gu, "&quot;")
        .replace(/'/gu, "&#039;")
    },
    applications: {
      api: {
        ApplicationV2: class {},
        HandlebarsApplicationMixin: (Base) => class extends Base {},
        DialogV2: {}
      }
    }
  };

  return () => {
    globalThis.foundry = previousFoundry;
  };
}

function installMainModuleFixture() {
  const previousConsoleError = console.error;
  const previousConsoleWarn = console.warn;
  const previousGame = globalThis.game;
  const previousHooks = globalThis.Hooks;
  const previousUi = globalThis.ui;
  const restoreFoundry = installFoundryApplicationStub();

  console.error = () => {};
  console.warn = () => {};
  globalThis.Hooks = {
    once() {},
    on() {}
  };
  globalThis.game = {
    modules: new Map([[MODULE_ID, { version: "test-notifications" }]]),
    user: { isGM: true },
    users: new Map(),
    i18n: {
      localize: (key) => key,
      format: (key) => key
    }
  };

  return {
    restore() {
      console.error = previousConsoleError;
      console.warn = previousConsoleWarn;
      globalThis.game = previousGame;
      globalThis.Hooks = previousHooks;
      globalThis.ui = previousUi;
      restoreFoundry();
    }
  };
}

test("openInventoryApp keeps the original failure when Foundry notifications are unavailable", async () => {
  const fixture = installMainModuleFixture();
  const notificationError = new TypeError("Cannot set properties of null (setting 'hidden')");
  const primaryError = new Error("inventory actor failed");
  globalThis.ui = {
    notifications: {
      error() {
        throw notificationError;
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?notification-open-inventory=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    moduleApi.inventoryService = {
      async getInventoryActor() {
        throw primaryError;
      }
    };

    await assert.rejects(
      () => moduleApi.openInventoryApp(),
      (error) => error === primaryError
    );
  }
  finally {
    fixture.restore();
  }
});

test("module version notice whispers the loaded manifest version only to the current user", async () => {
  const fixture = installMainModuleFixture();
  const created = [];

  try {
    const main = await import(`../scripts/main.js?notification-version=${Date.now()}`);
    assert.equal(typeof main.publishModuleVersionNotice, "function");

    const published = await main.publishModuleVersionNotice({
      moduleEntry: { version: "9.8.<7>" },
      user: { id: "player-17" },
      createChatMessage: async (data) => {
        created.push(data);
        return { id: "notice-1" };
      }
    });

    assert.equal(published, true);
    assert.deepEqual(created, [{
      user: "player-17",
      whisper: ["player-17"],
      content: "<p>Rebreya Main v9.8.&lt;7&gt; загружен.</p>"
    }]);
  }
  finally {
    fixture.restore();
  }
});

test("module version notice failure stays presentation-only", async () => {
  const fixture = installMainModuleFixture();
  const warnings = [];

  try {
    const main = await import(`../scripts/main.js?notification-version-error=${Date.now()}`);
    assert.equal(typeof main.publishModuleVersionNotice, "function");

    const published = await main.publishModuleVersionNotice({
      moduleEntry: { version: "9.8.7" },
      user: { id: "player-17" },
      createChatMessage: async () => {
        throw new Error("chat unavailable");
      },
      logger: {
        warn(...args) {
          warnings.push(args);
        }
      }
    });

    assert.equal(published, false);
    assert.match(String(warnings[0]?.[0] ?? ""), /Failed to publish module version notice/u);
  }
  finally {
    fixture.restore();
  }
});
