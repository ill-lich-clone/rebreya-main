import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class FakeApplicationV2 {
  constructor(options = {}) {
    this.options = options;
  }

  async render() {}
}

class FakeElement {}

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: FakeApplicationV2,
      HandlebarsApplicationMixin: (Base) => Base
    }
  },
  utils: { deepClone: (value) => structuredClone(value) }
};
globalThis.game = { user: { isGM: true } };
globalThis.randomID = () => "storage-test-id";
globalThis.HTMLElement = FakeElement;

const { StorageApp } = await import("../scripts/ui/storage-app.js?storage-app-test");

function createApp({ canManage = true, configure = true, withTextures = true, getStorageSnapshot = null } = {}) {
  globalThis.game.user.isGM = canManage;
  const textureCalls = [];
  const claimCalls = [];
  const depositCalls = [];
  const moduleApi = {
    async getStorageSnapshot() {
      if (getStorageSnapshot) return getStorageSnapshot();
      return {
        tokenUuid: "Scene.scene.Token.chest",
        baseName: "Chest",
        name: "Сундук",
        state: "opened",
        rows: [{ rowId: "row-1", name: "Меч", quantity: 1, typeLabel: "Оружие", img: "icons/sword.webp" }],
        coins: { pp: 0, gp: 2, sp: 0, cp: 0 },
        manualRows: [],
        template: { name: "Простой сундук", form: {} },
        textures: withTextures ? {
          unopened: "closed.webp",
          opened: "open.webp",
          empty: "empty.webp"
        } : null,
        displayMode: "opened"
      };
    },
    listLootgenTemplates() {
      return [{ id: "simple", name: "Простой сундук", form: { itemCount: 2 } }];
    },
    async setStorageTextureMode(tokenUuid, mode) {
      textureCalls.push({ tokenUuid, mode });
    },
    async claimStorageRow(...args) {
      claimCalls.push(args);
    },
    async inspectStorageDepositSource(data) {
      return {
        source: { kind: "item", itemUuid: data.uuid },
        available: 1,
        mode: "copy"
      };
    },
    async depositStorageItem(...args) {
      depositCalls.push(args);
    }
  };
  const app = new StorageApp(moduleApi, "Scene.scene.Token.chest", { configure });
  return { app, textureCalls, claimCalls, depositCalls };
}

test("storage grid offers self and party destinations for rows and coins", async () => {
  const template = await readFile(new URL("../templates/storage-app.hbs", import.meta.url), "utf8");
  assert.match(template, /class="rm-storage-item__icon"/u);
  assert.match(template, /draggable="true"/u);
  assert.match(template, /data-action="storage-toggle-row"/u);
  assert.match(template, /data-storage-popover/u);
  assert.match(template, /data-action="storage-open-item"/u);
  assert.match(template, /data-action="storage-claim-self"/u);
  assert.match(template, /data-action="storage-claim-party"/u);
  assert.match(template, /data-action="storage-claim-coins-self"/u);
  assert.match(template, /data-action="storage-claim-coins-party"/u);
  assert.match(template, /\{\{#if configuration\.canSetTexture\}\}/u);
  assert.match(template, /data-action="storage-set-texture"/u);
  assert.match(template, /data-mode="\{\{mode\}\}"/u);
  assert.doesNotMatch(template, /storage-page/u);
});

test("storage configuration exposes template and manual item controls to GMs", async () => {
  const context = await createApp().app._prepareContext();
  assert.equal(context.canManage, true);
  assert.equal(context.configuration.enabled, true);
  assert.equal(context.configuration.templateOptions[0].name, "Простой сундук");
  assert.equal(context.configuration.canAddManualItems, true);
  assert.equal(context.configuration.baseName, "Chest");
  assert.equal(context.configuration.canSetTexture, true);
  assert.equal(context.configuration.displayMode, "opened");
  assert.deepEqual(
    context.configuration.textureModes.map(({ mode, label, number }) => [mode, label, number]),
    [
      ["unopened", "Закрытый", "1"],
      ["opened", "Открытый", "2"],
      ["empty", "Пустой", "3"]
    ]
  );
  assert.deepEqual(context.configuration.textureModes.map(({ active }) => active), [false, true, false]);
  assert.equal(StorageApp.DEFAULT_OPTIONS.position.width, 286);
  assert.equal(context.rows[0].canEdit, true);
  assert.equal(context.gridColumns, 3);
  assert.equal(context.rows[0].popoverAlignment, "left");
  assert.equal(context.coinsPopoverAlignment, "center");
});

test("storage configuration is hidden from players", async () => {
  const context = await createApp({ canManage: false, configure: true }).app._prepareContext();
  assert.equal(context.canManage, false);
  assert.equal(context.configuration.enabled, false);
  assert.deepEqual(context.configuration.templateOptions, []);
  assert.equal(context.configuration.canSetTexture, false);
  assert.equal(context.rows[0].canEdit, false);
});

test("storage template exposes generated-row quantity and delete controls to GMs", async () => {
  const template = await readFile(new URL("../templates/storage-app.hbs", import.meta.url), "utf8");
  assert.match(template, /data-action="storage-update-row"/u);
  assert.match(template, /data-action="storage-delete-row"/u);
  assert.match(template, /data-storage-quantity/u);
  assert.match(template, /rm-storage-item__popover--\{\{popoverAlignment\}\}/u);
});

test("storage texture controls stay hidden when a token has no complete texture set", async () => {
  const context = await createApp({ withTextures: false }).app._prepareContext();

  assert.equal(context.configuration.enabled, true);
  assert.equal(context.configuration.canSetTexture, false);
  assert.deepEqual(context.configuration.textureModes, []);
});

test("clicking a texture mode sends the exact token and mode through the module API", async () => {
  const { app, textureCalls } = createApp();
  const listeners = new Map();
  const root = new class extends FakeElement {
    addEventListener(name, callback) {
      listeners.set(name, callback);
    }
  }();
  app.element = root;
  app._onRender({}, {});
  const control = {
    dataset: { action: "storage-set-texture", mode: "empty" },
    closest(selector) {
      return selector === "[data-action]" ? this : null;
    }
  };

  await listeners.get("click")({ target: control });

  assert.deepEqual(textureCalls, [{
    tokenUuid: "Scene.scene.Token.chest",
    mode: "empty"
  }]);
});

test("compact storage uses the token name only in the window title", async () => {
  const template = await readFile(new URL("../templates/storage-app.hbs", import.meta.url), "utf8");
  const { app } = createApp();
  const header = { textContent: "Хранилище" };
  app.element = new class extends FakeElement {
    style = { setProperty() {} };
    addEventListener() {}
    querySelector(selector) {
      return selector === ".window-title" ? header : null;
    }
  }();

  const context = await app._prepareContext();
  app._onRender(context, {});

  assert.equal(app.options.window.title, "Сундук");
  assert.equal(app.title, "Сундук");
  assert.equal(header.textContent, "Сундук");
  assert.doesNotMatch(template, /rm-storage-header|rm-eyebrow[^>]*>\s*Хранилище|<h2>\{\{name\}\}<\/h2>/u);
});

test("item cells keep click actions separate from article dragging and use no native title", async () => {
  const template = await readFile(new URL("../templates/storage-app.hbs", import.meta.url), "utf8");

  assert.match(template, /<article[^>]*draggable="true"[^>]*data-storage-row-drag/u);
  assert.match(template, /class="rm-storage-item__icon"[^>]*data-action="storage-toggle-row"/u);
  assert.match(template, /data-storage-popover/u);
  assert.doesNotMatch(template, /class="rm-storage-item__icon"[^>]*title=/u);
  assert.match(template, /aria-label="[^"]*\{\{name\}\}"/u);
});

test("matching token updates rerender from a fresh snapshot and unrelated updates do not", async () => {
  const previousHooks = globalThis.Hooks;
  const callbacks = new Map();
  globalThis.Hooks = {
    on(name, callback) {
      const rows = callbacks.get(name) ?? [];
      rows.push(callback);
      callbacks.set(name, rows);
      return callback;
    },
    off(name, callback) {
      callbacks.set(name, (callbacks.get(name) ?? []).filter((entry) => entry !== callback));
    }
  };
  try {
    let name = "Сундук";
    const { app } = createApp({
      getStorageSnapshot: async () => ({
        tokenUuid: app.tokenUuid,
        baseName: name,
        name,
        state: "opened",
        rows: [],
        coins: {}
      })
    });
    const renders = [];
    app.render = async (options) => renders.push(options);
    app.element = new class extends FakeElement {
      addEventListener() {}
    }();
    await app._prepareContext();
    app._onRender({}, {});

    name = "Сундук (пусто)";
    await callbacks.get("updateToken")[0]({ uuid: app.tokenUuid });
    assert.equal(renders.length, 1);
    assert.deepEqual(renders[0], { force: true });
    assert.equal(app.snapshot.name, "Сундук (пусто)");

    await callbacks.get("updateToken")[0]({ uuid: "Scene.other.Token.chest" });
    assert.equal(renders.length, 1);
  }
  finally {
    globalThis.Hooks = previousHooks;
  }
});

test("newer snapshot requests win and hook subscriptions are removed on close", async () => {
  const previousHooks = globalThis.Hooks;
  const callbacks = new Map();
  const removed = [];
  globalThis.Hooks = {
    on(name, callback) {
      callbacks.set(name, callback);
      return callback;
    },
    off(name, callback) {
      removed.push([name, callback]);
    }
  };
  try {
    const pending = [];
    const { app } = createApp({
      getStorageSnapshot: () => new Promise((resolve) => pending.push(resolve))
    });
    app.render = async () => {};
    app.element = new class extends FakeElement { addEventListener() {} }();
    app._onRender({}, {});

    const first = app.scheduleSnapshotRefresh();
    const second = app.scheduleSnapshotRefresh();
    pending[1]({ name: "Новый", rows: [], coins: {}, state: "opened" });
    await second;
    pending[0]({ name: "Старый", rows: [], coins: {}, state: "opened" });
    await first;
    assert.equal(app.snapshot.name, "Новый");

    await app._onClose?.({}, {});
    assert.deepEqual(removed.map(([name]) => name).sort(), [
      "deleteToken",
      "rebreya-main.storageUpdated",
      "updateToken"
    ]);
  }
  finally {
    globalThis.Hooks = previousHooks;
  }
});

test("LKM opens an item popover and its self action claims the row", async () => {
  const { app, claimCalls } = createApp();
  const listeners = new Map();
  const renders = [];
  app.render = async (options) => renders.push(options);
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  app._onRender({}, {});

  const control = (action) => ({
    dataset: { action, rowId: "row-1" },
    closest(selector) { return selector === "[data-action]" ? this : null; }
  });
  await listeners.get("click")({ target: control("storage-toggle-row") });
  assert.equal(app.activeRowId, "row-1");
  assert.deepEqual(renders.at(-1), { force: true });

  await listeners.get("click")({ target: control("storage-claim-self") });
  assert.equal(claimCalls.length, 1);
  assert.equal(claimCalls[0][0], app.tokenUuid);
  assert.equal(claimCalls[0][1], "row-1");
  assert.equal(claimCalls[0][2], "self");
  assert.deepEqual(claimCalls[0][4], { quantity: 1 });
});

test("PKM opens the same item popover and suppresses the native menu", async () => {
  const { app } = createApp();
  const listeners = new Map();
  const renders = [];
  app.render = async (options) => renders.push(options);
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  app._onRender({}, {});

  let prevented = 0;
  let stopped = 0;
  const icon = {
    dataset: { action: "storage-toggle-row", rowId: "row-1" },
    closest(selector) {
      return selector.includes("storage-toggle-row") || selector === "[data-action]" ? this : null;
    }
  };
  await listeners.get("contextmenu")({
    target: icon,
    preventDefault: () => { prevented += 1; },
    stopPropagation: () => { stopped += 1; }
  });

  assert.equal(app.activeRowId, "row-1");
  assert.deepEqual(renders.at(-1), { force: true });
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

test("storage item popovers stay interactive above their grid", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  assert.match(css, /\.rm-storage-item__popover\s*\{[^}]*pointer-events:\s*auto/isu);
  assert.match(css, /\.rebreya-storage-app\s+\.window-content\s*\{[^}]*overflow:\s*visible/isu);
});

test("GM configuration drop routes an item through the authoritative deposit API", async () => {
  const { app, depositCalls } = createApp({ configure: true });
  const listeners = new Map();
  app.render = async () => {};
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  app._onRender({}, {});
  let prevented = 0;
  const dropzone = {
    closest(selector) { return selector === "[data-storage-dropzone]" ? this : null; }
  };
  await listeners.get("drop")({
    target: dropzone,
    preventDefault: () => { prevented += 1; },
    dataTransfer: {
      getData: () => JSON.stringify({ type: "Item", uuid: "Compendium.dnd5e.items.Item.sword" })
    }
  });

  assert.equal(prevented, 1);
  assert.equal(depositCalls.length, 1);
  assert.equal(depositCalls[0][0], app.tokenUuid);
  assert.deepEqual(depositCalls[0][1], {
    kind: "item",
    itemUuid: "Compendium.dnd5e.items.Item.sword"
  });
  assert.equal(depositCalls[0][2], 1);
  assert.match(depositCalls[0][3], /^storage-window-deposit-/u);
});
