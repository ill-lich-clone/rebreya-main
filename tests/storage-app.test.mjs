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

function createApp({ canManage = true, configure = true, withTextures = true } = {}) {
  globalThis.game.user.isGM = canManage;
  const textureCalls = [];
  const moduleApi = {
    async getStorageSnapshot() {
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
    }
  };
  const app = new StorageApp(moduleApi, "Scene.scene.Token.chest", { configure });
  return { app, textureCalls };
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
