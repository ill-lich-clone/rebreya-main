import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class FakeApplicationV2 {
  constructor(options = {}) {
    this.options = options;
  }

  async _onRender() {
    await this.baseRenderGate;
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

function createApp({
  canManage = true,
  configure = true,
  withTextures = true,
  getStorageSnapshot = null,
  inspectStorageDepositSource = null,
  readStorageJournal = null,
  openStorageJournalViewer = null,
  appOptions = {}
} = {}) {
  globalThis.game.user.isGM = canManage;
  const textureCalls = [];
  const claimCalls = [];
  const depositCalls = [];
  const quantityCalls = [];
  const journalReadCalls = [];
  const moduleApi = {
    async getStorageSnapshot(...args) {
      if (getStorageSnapshot) return getStorageSnapshot(...args);
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
      if (inspectStorageDepositSource) return inspectStorageDepositSource(data);
      return {
        source: { kind: "item", itemUuid: data.uuid },
        available: 1,
        mode: "copy"
      };
    },
    async depositStorageItem(...args) {
      depositCalls.push(args);
    },
    async updateStorageRowQuantity(...args) {
      quantityCalls.push(args);
    },
    async readStorageJournal(...args) {
      journalReadCalls.push(args);
      return readStorageJournal
        ? readStorageJournal(...args)
        : { name: "Запись", pages: [] };
    }
  };
  const app = new StorageApp(moduleApi, "Scene.scene.Token.chest", {
    configure,
    ...(openStorageJournalViewer ? { openStorageJournalViewer } : {}),
    ...appOptions
  });
  return { app, textureCalls, claimCalls, depositCalls, quantityCalls, journalReadCalls };
}

test("storage grid offers self and party destinations for rows and coins", async () => {
  const template = await readFile(new URL("../templates/storage-app.hbs", import.meta.url), "utf8");
  assert.match(template, /class="rm-storage-item__icon"/u);
  assert.match(template, /draggable="true"/u);
  assert.match(template, /data-action="\{\{primaryAction\}\}"/u);
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

test("Journal rows expose a read-only view model and no transfer controls", async () => {
  const { app } = createApp({
    configure: true,
    getStorageSnapshot: async () => ({
      tokenUuid: "Scene.scene.Token.chest",
      name: "Сундук",
      state: "opened",
      rows: [{
        rowId: "journal-row",
        rowKind: "journal",
        sourceId: "JournalEntry.private-notes",
        name: "Полевые заметки",
        quantity: 1
      }],
      coins: {}
    })
  });

  const context = await app._prepareContext();
  const row = context.rows[0];
  assert.equal(row.isJournal, true);
  assert.equal(row.canDrag, false);
  assert.equal(row.canClaim, false);
  assert.equal(row.canOpenSource, false);
  assert.equal(row.showQuantity, false);
  assert.equal(row.canDelete, true);

  const template = await readFile(new URL("../templates/storage-app.hbs", import.meta.url), "utf8");
  assert.match(template, /\{\{#if canDrag\}\}[\s\S]*?data-storage-row-drag[\s\S]*?\{\{\/if\}\}/u);
  assert.match(template, /\{\{#if activePopover\.isJournal\}\}[\s\S]*?data-action="storage-read-journal"[\s\S]*?\{\{\/if\}\}/u);
  const journalBranch = template.match(/\{\{#if activePopover\.isJournal\}\}([\s\S]*?)\{\{else\}\}/u)?.[1] ?? "";
  assert.doesNotMatch(journalBranch, /storage-claim-self|storage-claim-party|data-storage-quantity|data-storage-row-drag/u);
});

test("Journal read action passes nested access context and opens only the returned snapshot", async () => {
  const snapshot = {
    name: "Полевые заметки",
    pages: [{ pageId: "text-1", name: "День первый", type: "text", html: "<p>Безопасный текст</p>" }]
  };
  const viewerCalls = [];
  const { app, journalReadCalls } = createApp({
    configure: false,
    appOptions: {
      path: ["bag-row"],
      characterTokenUuid: "Scene.scene.Token.hero"
    },
    getStorageSnapshot: async () => ({
      tokenUuid: "Scene.scene.Token.chest",
      name: "Сумка",
      state: "opened",
      rows: [{ rowId: "journal-row", rowKind: "journal", name: "Полевые заметки", quantity: 1 }],
      coins: {}
    }),
    readStorageJournal: async () => snapshot,
    openStorageJournalViewer: async (receivedSnapshot) => viewerCalls.push(receivedSnapshot)
  });
  const listeners = new Map();
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  app.render = async () => {};
  await app._prepareContext();
  await app._onRender({}, {});
  const control = {
    dataset: { action: "storage-read-journal", rowId: "journal-row" },
    closest(selector) { return selector === "[data-action]" ? this : null; }
  };

  await listeners.get("click")({ target: control, preventDefault() {} });

  assert.deepEqual(journalReadCalls, [[
    "Scene.scene.Token.chest",
    "journal-row",
    { path: ["bag-row"], characterTokenUuid: "Scene.scene.Token.hero" }
  ]]);
  assert.deepEqual(viewerCalls, [snapshot]);
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
  assert.equal(context.activePopover, null);
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
  assert.match(template, /class="rm-storage-popover-layer"/u);
  assert.match(template, /data-anchor-row-id="\{\{activePopover\.anchorRowId\}\}"/u);
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
  await app._onRender({}, {});
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

test("changing a storage quantity saves it without requiring the tiny check button", async () => {
  const { app, quantityCalls } = createApp();
  const listeners = new Map();
  const root = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  app.element = root;
  await app._onRender({}, {});
  const input = {
    value: "7",
    dataset: { rowId: "row-1" },
    matches: (selector) => selector === "[data-storage-quantity]"
  };

  await listeners.get("change")({ target: input });

  assert.deepEqual(quantityCalls, [[
    "Scene.scene.Token.chest",
    "row-1",
    7,
    {}
  ]]);
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
  await app._onRender(context, {});

  assert.equal(app.options.window.title, "Сундук");
  assert.equal(app.title, "Сундук");
  assert.equal(header.textContent, "Сундук");
  assert.doesNotMatch(template, /rm-storage-header|rm-eyebrow[^>]*>\s*Хранилище|<h2>\{\{name\}\}<\/h2>/u);
});

test("item cells keep click actions separate from article dragging and use no native title", async () => {
  const template = await readFile(new URL("../templates/storage-app.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(template, /<article[^>]*draggable="true"[^>]*data-storage-row-drag/u);
  assert.match(template, /class="rm-storage-item__icon rm-tooltip-anchor"[^>]*data-action="\{\{primaryAction\}\}"/u);
  assert.match(template, /class="rm-storage-item__icon rm-tooltip-anchor"[^>]*data-rm-tooltip="\{\{name\}\}"/u);
  assert.match(template, /data-storage-popover/u);
  assert.doesNotMatch(template, /class="[^"]*rm-storage-item__icon[^"]*"[^>]*title=/u);
  assert.match(template, /aria-label="[^"]*\{\{name\}\}"/u);
  assert.match(css, /\.rm-storage-item__icon\.rm-tooltip-anchor\s*\{[^}]*overflow:\s*visible/isu);
  assert.match(css, /\.rm-storage-item__icon\.rm-tooltip-anchor\s*>\s*img\s*\{[^}]*border-radius:\s*inherit/isu);
  assert.match(
    css,
    /\.rm-storage-item__icon\.rm-tooltip-anchor\[aria-expanded="true"\]\[data-rm-tooltip\]::before,[\s\S]*?::after\s*\{[^}]*opacity:\s*0[^}]*visibility:\s*hidden/isu
  );
});

test("container cells open the nested storage directly while ordinary items open their popover", async () => {
  const { app } = createApp({
    configure: false,
    getStorageSnapshot: async () => ({
      tokenUuid: "Scene.scene.Token.chest",
      name: "Сундук",
      state: "opened",
      rows: [
        { rowId: "item-row", rowKind: "item", name: "Меч", quantity: 1 },
        {
          rowId: "bag-row",
          rowKind: "container",
          name: "Сумка хранения",
          quantity: 1,
          container: { containerId: "bag-1" }
        }
      ],
      coins: {}
    })
  });

  const context = await app._prepareContext();

  assert.equal(context.rows.find((row) => row.rowId === "item-row").primaryAction, "storage-toggle-row");
  assert.equal(context.rows.find((row) => row.rowId === "bag-row").primaryAction, "storage-open-container");
  const template = await readFile(new URL("../templates/storage-app.hbs", import.meta.url), "utf8");
  assert.match(template, /data-action="\{\{primaryAction\}\}"/u);
});

test("PKM on a nested container still exposes transfer actions", async () => {
  const { app } = createApp({
    configure: false,
    getStorageSnapshot: async () => ({
      tokenUuid: "Scene.scene.Token.chest",
      name: "Сундук",
      state: "opened",
      rows: [{
        rowId: "bag-row",
        rowKind: "container",
        name: "Сумка хранения",
        quantity: 1,
        container: { containerId: "bag-1" }
      }],
      coins: {}
    })
  });
  const listeners = new Map();
  app.render = async () => {};
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  await app._onRender({}, {});
  const icon = {
    dataset: { action: "storage-open-container", rowId: "bag-row" },
    closest(selector) { return selector.includes("storage-open-container") ? this : null; }
  };

  await listeners.get("contextmenu")({ target: icon, preventDefault() {}, stopPropagation() {} });

  assert.equal(app.activeRowId, "bag-row");
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
    await app._onRender({}, {});

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
    await app._onRender({}, {});

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
  const { app, claimCalls } = createApp({
    appOptions: { characterTokenUuid: "Scene.scene.Token.hero" }
  });
  const listeners = new Map();
  const renders = [];
  app.render = async (options) => renders.push(options);
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  await app._onRender({}, {});

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
  assert.deepEqual(claimCalls[0][4], {
    quantity: 1,
    characterTokenUuid: "Scene.scene.Token.hero"
  });
});

test("popover close control dismisses the active item popover", async () => {
  const { app } = createApp();
  const listeners = new Map();
  const renders = [];
  app.render = async (options) => renders.push(options);
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  await app._onRender({}, {});
  app.activeRowId = "row-1";
  const closeControl = {
    dataset: { action: "storage-close-popover" },
    closest(selector) { return selector === "[data-action]" ? this : null; }
  };

  await listeners.get("click")({ target: closeControl, preventDefault() {} });

  assert.equal(app.activeRowId, "");
  assert.deepEqual(renders.at(-1), { force: true });
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
  await app._onRender({}, {});

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

test("storage popover waits for the rendered DOM and anchors below the selected item", async () => {
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => callback();
  try {
    const { app } = createApp();
    let releaseBaseRender;
    let domReady = false;
    app.baseRenderGate = new Promise((resolve) => { releaseBaseRender = resolve; })
      .then(() => { domReady = true; });
    const styles = new Map();
    const popover = {
      dataset: { anchorRowId: "row-1" },
      style: { setProperty: (name, value) => styles.set(name, value) },
      getBoundingClientRect: () => ({ width: 224 })
    };
    const icon = {
      getBoundingClientRect: () => ({ left: 294, right: 366, bottom: 260 })
    };
    const row = {
      dataset: { rowId: "row-1" },
      querySelector: (selector) => selector === ".rm-storage-item__icon" ? icon : null
    };
    const shell = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 286 })
    };
    app.element = new class extends FakeElement {
      addEventListener() {}
      querySelector(selector) {
        if (!domReady) return null;
        if (selector === ".rm-storage-shell") return shell;
        if (selector === "[data-storage-popover]") return popover;
        return null;
      }
      querySelectorAll(selector) {
        return domReady && selector === "[data-row-id]" ? [row] : [];
      }
    }();

    const rendered = app._onRender({}, {});
    releaseBaseRender();
    await rendered;

    assert.equal(styles.get("top"), "219px");
    assert.equal(styles.get("left"), "166px");
    assert.equal(styles.get("--rm-storage-popover-arrow-left"), "176px");
  }
  finally {
    globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

test("storage item popovers stay interactive above their grid", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  const template = await readFile(new URL("../templates/storage-app.hbs", import.meta.url), "utf8");
  assert.match(css, /\.rm-storage-item__popover\s*\{[^}]*pointer-events:\s*auto/isu);
  assert.match(css, /\.rm-storage-popover-layer\s*\{[^}]*position:\s*absolute[^}]*pointer-events:\s*none/isu);
  assert.match(css, /\.rebreya-storage-app\s+\.window-content\s*\{[^}]*overflow:\s*visible/isu);
  assert.doesNotMatch(css, /\.rm-storage-grid:has\(/u);
  assert.match(template, /<\/div>\s*\{\{else\}\}[\s\S]*?\{\{#if activePopover\}\}\s*<div class="rm-storage-popover-layer"/u);
});

test("minimized storage hides all overflowing window content", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  assert.match(css, /\.rebreya-storage-app\.minimized\s*>?\s*\.window-content\s*\{[^}]*display:\s*none\s*!important/isu);
});

test("container title opens a nested path and breadcrumbs return to the root", async () => {
  const requests = [];
  const rootSnapshot = {
    tokenUuid: "Scene.scene.Token.chest",
    name: "Сундук",
    baseName: "Сундук",
    state: "opened",
    rows: [{
      rowKind: "container",
      rowId: "bag-row",
      name: "Сумка хранения",
      quantity: 1,
      container: { containerId: "bag-1" }
    }],
    coins: {}
  };
  const nestedSnapshot = {
    tokenUuid: rootSnapshot.tokenUuid,
    path: ["bag-row"],
    name: "Сумка хранения",
    baseName: "Сумка хранения",
    state: "opened",
    rows: [{ rowId: "gem-row", name: "Самоцвет", quantity: 2 }],
    coins: {}
  };
  const { app } = createApp({
    configure: false,
    getStorageSnapshot: async (_tokenUuid, request = {}) => {
      requests.push(structuredClone(request));
      return request.path?.length ? nestedSnapshot : rootSnapshot;
    }
  });
  const listeners = new Map();
  app.render = async () => {};
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  await app._onRender({}, {});
  const control = (action, rowId = "bag-row", index = "0") => ({
    dataset: { action, rowId, index },
    closest(selector) { return selector === "[data-action]" ? this : null; }
  });

  await listeners.get("click")({ target: control("storage-open-container") });
  assert.deepEqual(app.path, ["bag-row"]);
  assert.equal(app.snapshot.name, "Сумка хранения");
  assert.deepEqual(requests.at(-1), { path: ["bag-row"] });
  const nestedContext = await app._prepareContext();
  assert.equal(nestedContext.hasBreadcrumbs, true);
  assert.deepEqual(nestedContext.breadcrumbs.map(({ name }) => name), ["Сундук", "Сумка хранения"]);

  await listeners.get("click")({ target: control("storage-breadcrumb", "", "0") });
  assert.deepEqual(app.path, []);
  assert.equal(app.snapshot.name, "Сундук");
});

test("GM configuration drop routes an item through the authoritative deposit API", async () => {
  const { app, depositCalls } = createApp({ configure: true });
  const listeners = new Map();
  app.render = async () => {};
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  await app._onRender({}, {});
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

test("GM configuration drop routes a JournalEntry reference through the authoritative deposit API", async () => {
  const { app, depositCalls } = createApp({
    configure: true,
    inspectStorageDepositSource: async (data) => ({
      source: { kind: "journal", journalUuid: data.uuid },
      available: 1,
      mode: "copy"
    })
  });
  const listeners = new Map();
  app.render = async () => {};
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  await app._onRender({}, {});
  let prevented = 0;
  const dropzone = {
    closest(selector) { return selector === "[data-storage-dropzone]" ? this : null; }
  };
  await listeners.get("drop")({
    target: dropzone,
    preventDefault: () => { prevented += 1; },
    dataTransfer: {
      getData: () => JSON.stringify({ type: "JournalEntry", uuid: "JournalEntry.mechanus" })
    }
  });

  assert.equal(prevented, 1);
  assert.equal(depositCalls.length, 1);
  assert.deepEqual(depositCalls[0][1], {
    kind: "journal",
    journalUuid: "JournalEntry.mechanus"
  });
  assert.equal(depositCalls[0][2], 1);
});

test("ordinary player storage accepts a ground-pile row drop anywhere in its window", async () => {
  const source = {
    type: "RebreyaStorageClaim",
    tokenUuid: "Scene.scene.Token.pile",
    path: ["source-bag"],
    rowId: "rope-row",
    quantity: 1
  };
  const { app, depositCalls } = createApp({
    canManage: false,
    configure: false,
    appOptions: {
      path: ["target-bag"],
      characterTokenUuid: "Scene.scene.Token.hero"
    },
    inspectStorageDepositSource: async (data) => ({
      source: {
        kind: "storage-row",
        tokenUuid: data.tokenUuid,
        path: data.path,
        rowId: data.rowId,
        quantity: data.quantity
      },
      available: data.quantity,
      mode: "move"
    })
  });
  const listeners = new Map();
  app.render = async () => {};
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  await app._onRender({}, {});
  let prevented = 0;
  let phase = "dragover";
  const dropEvent = {
    target: { closest: () => null },
    preventDefault: () => { prevented += 1; },
    dataTransfer: {
      types: ["text/plain"],
      getData: () => phase === "dragover" ? "" : JSON.stringify(source)
    }
  };

  listeners.get("dragover")(dropEvent);
  assert.equal(prevented, 1);
  phase = "drop";
  await listeners.get("drop")(dropEvent);

  assert.equal(prevented, 2);
  assert.equal(depositCalls.length, 1);
  assert.equal(depositCalls[0][0], app.tokenUuid);
  assert.deepEqual(depositCalls[0][1], {
    kind: "storage-row",
    tokenUuid: source.tokenUuid,
    path: source.path,
    rowId: source.rowId,
    quantity: source.quantity
  });
  assert.deepEqual(depositCalls[0][4], {
    path: ["target-bag"],
    characterTokenUuid: "Scene.scene.Token.hero"
  });
});

test("ordinary storage leaves unsupported and editable-target drops to native behavior", async () => {
  const { app, depositCalls } = createApp({ configure: false });
  const listeners = new Map();
  app.render = async () => {};
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  await app._onRender({}, {});
  let prevented = 0;
  const unsupported = {
    target: { closest: () => null },
    preventDefault: () => { prevented += 1; },
    dataTransfer: {
      getData: () => JSON.stringify({ type: "Actor", uuid: "Actor.hero" })
    }
  };

  listeners.get("dragover")(unsupported);
  await listeners.get("drop")(unsupported);
  const editable = {
    target: { closest: (selector) => selector.includes("input") ? {} : null },
    preventDefault: () => { prevented += 1; },
    dataTransfer: {
      getData: () => JSON.stringify({ type: "Item", uuid: "Actor.hero.Item.rope" })
    }
  };
  listeners.get("dragover")(editable);
  await listeners.get("drop")(editable);

  assert.equal(prevented, 0);
  assert.equal(depositCalls.length, 0);
});
