import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class FakeApplicationV2 {
  constructor(options = {}) {
    this.options = options;
  }
}

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

const { StorageApp } = await import("../scripts/ui/storage-app.js?storage-app-test");

function createApp({ canManage = true, configure = true } = {}) {
  globalThis.game.user.isGM = canManage;
  return new StorageApp({
    async getStorageSnapshot() {
      return {
        tokenUuid: "Scene.scene.Token.chest",
        baseName: "Chest",
        name: "Сундук",
        state: "opened",
        rows: [{ rowId: "row-1", name: "Меч", quantity: 1, typeLabel: "Оружие", img: "icons/sword.webp" }],
        coins: { pp: 0, gp: 2, sp: 0, cp: 0 },
        manualRows: [],
        template: { name: "Простой сундук", form: {} }
      };
    },
    listLootgenTemplates() {
      return [{ id: "simple", name: "Простой сундук", form: { itemCount: 2 } }];
    }
  }, "Scene.scene.Token.chest", { configure });
}

test("storage grid offers self and party destinations for rows and coins", async () => {
  const template = await readFile(new URL("../templates/storage-app.hbs", import.meta.url), "utf8");
  assert.match(template, /data-action="storage-claim-self"/u);
  assert.match(template, /data-action="storage-claim-party"/u);
  assert.match(template, /data-action="storage-claim-coins-self"/u);
  assert.match(template, /data-action="storage-claim-coins-party"/u);
});

test("storage configuration exposes template and manual item controls to GMs", async () => {
  const context = await createApp()._prepareContext();
  assert.equal(context.canManage, true);
  assert.equal(context.configuration.enabled, true);
  assert.equal(context.configuration.templateOptions[0].name, "Простой сундук");
  assert.equal(context.configuration.canAddManualItems, true);
  assert.equal(context.configuration.baseName, "Chest");
});

test("storage configuration is hidden from players", async () => {
  const context = await createApp({ canManage: false, configure: true })._prepareContext();
  assert.equal(context.canManage, false);
  assert.equal(context.configuration.enabled, false);
  assert.deepEqual(context.configuration.templateOptions, []);
});
