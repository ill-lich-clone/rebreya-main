import test from "node:test";
import assert from "node:assert/strict";

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
  utils: {
    deepClone: (value) => structuredClone(value),
    getProperty: () => undefined,
    hasProperty: () => false,
    setProperty: () => undefined
  }
};
globalThis.game = {
  user: { isGM: true },
  packs: { get: () => null }
};
globalThis.randomID = () => "test-id";

const { LootgenApp, promptLootgenTemplateName } = await import("../scripts/ui/lootgen-app.js?context-test");

test("lootgen asks for a template name through a Foundry dialog", async () => {
  const name = await promptLootgenTemplateName({
    wait: async (options) => {
      assert.equal(options.window.title, "Сохранить шаблон Lootgen");
      return options.buttons[0].callback(null, {
        form: { elements: { templateName: { value: "  Простой сундук  " } } }
      });
    }
  });

  assert.equal(name, "Простой сундук");
});

test("lootgen context exposes saved templates to a GM", async () => {
  const savedTemplate = {
    id: "simple-chest",
    name: "Простой сундук",
    form: {}
  };
  const app = new LootgenApp({
    getModel: async () => ({ gear: [], materials: [] }),
    listLootgenTemplates: () => [savedTemplate]
  }, { appKey: "context-test" });

  const context = await app._prepareContext();

  assert.deepEqual(context.form.lootgenTemplates, [savedTemplate]);
  assert.equal(context.form.hasLootgenTemplates, true);
});
