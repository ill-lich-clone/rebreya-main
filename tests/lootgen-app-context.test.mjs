import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

const {
  LootgenApp,
  buildLootgenMundaneCandidate,
  promptLootgenTemplateName,
  resolveLootgenItemValue
} = await import("../scripts/ui/lootgen-app.js?context-test");

test("lootgen mundane candidates carry authored package formulas", () => {
  assert.deepEqual(buildLootgenMundaneCandidate({
    id: "paper-sheet",
    name: "Бумага (один лист)",
    multipleAppearance: "2к12"
  }, {
    rank: 0,
    value: 2,
    typeLabel: "Снаряжение",
    breakable: false
  }), {
    sourceType: "gear",
    sourceId: "paper-sheet",
    name: "Бумага (один лист)",
    rank: 0,
    value: 2,
    multipleAppearance: "2к12",
    typeLabel: "Снаряжение",
    stackable: true,
    breakable: false
  });
});

test("lootgen item value keeps truly valueless items at zero", () => {
  assert.equal(resolveLootgenItemValue("", 0), 0);
  assert.equal(resolveLootgenItemValue(0, 0), 0);
  assert.equal(resolveLootgenItemValue("25", 0), 25);
  assert.equal(resolveLootgenItemValue("", 1.5), 150);
});

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

  assert.deepEqual(context.form.lootgenTemplates, [{ ...savedTemplate, selected: false }]);
  assert.equal(context.form.hasLootgenTemplates, true);
});

test("lootgen carries the soft quantity target through context and saved templates", async () => {
  let savedPayload = null;
  const app = new LootgenApp({
    getModel: async () => ({ gear: [], materials: [] }),
    listLootgenTemplates: () => [],
    saveLootgenTemplate: async (payload) => {
      savedPayload = payload;
      return payload;
    }
  }, { appKey: "soft-target" });

  app.applyLootgenTemplate({ form: { optimalItemQuantity: 7 } });
  const context = await app._prepareContext();
  await app.saveTemplateFromName("Семь предметов");

  assert.equal(context.form.optimalItemQuantity, 7);
  assert.equal(savedPayload.form.optimalItemQuantity, 7);
});

test("lootgen exposes a coin reserve for new windows and preserves it in saved templates", async () => {
  let savedPayload;
  const app = new LootgenApp({
    getModel: async () => ({ gear: [], materials: [] }),
    listLootgenTemplates: () => [],
    saveLootgenTemplate: async payload => { savedPayload = payload; return { id: "reserve", ...payload }; }
  }, { appKey: "coin-reserve" });
  assert.equal((await app._prepareContext({})).form.coinBudgetPercent, 20);
  app.applyLootgenTemplate({ form: { coinBudgetPercent: 35 } });
  await app.saveTemplateFromName("Резерв монет");
  assert.equal((await app._prepareContext({})).form.coinBudgetPercent, 35);
  assert.equal(savedPayload.form.coinBudgetPercent, 35);
  app.applyLootgenTemplate({ form: {} });
  assert.equal((await app._prepareContext({})).form.coinBudgetPercent, 0);
});

test("lootgen deletes a selected template only after confirmation", async () => {
  const removed = [];
  const template = { id: "codex-test", name: "Codex test", form: {} };
  const app = new LootgenApp({
    getLootgenTemplate: (id) => id === template.id ? template : null,
    removeLootgenTemplate: async (id) => {
      removed.push(id);
      return true;
    }
  }, { appKey: "delete-template" });

  assert.equal(await app.removeTemplateById(template.id, { confirm: async () => false }), false);
  assert.deepEqual(removed, []);
  assert.equal(await app.removeTemplateById(template.id, { confirm: async () => true }), true);
  assert.deepEqual(removed, [template.id]);
});

test("lootgen applies a selected template and remembers its selection", async () => {
  const template = {
    id: "small-cache",
    name: "Small cache",
    form: { itemCount: 4, budgetValue: 900 }
  };
  const app = new LootgenApp({
    getLootgenTemplate: (id) => id === template.id ? template : null
  }, { appKey: "apply-template" });

  await app.applyTemplateById(template.id, { render: false });

  assert.equal(app.itemCount, 4);
  assert.equal(app.budgetValue, 900);
  assert.equal(app.selectedTemplateId, template.id);
});

test("lootgen take-all delegates one batch instead of looping over row grants", () => {
  const source = readFileSync(new URL("../scripts/ui/lootgen-app.js", import.meta.url), "utf8");
  const body = source.match(/async #takeAllToInventory\(\) \{(?<body>[\s\S]*?)\n  \}\n\n  async #sendResultToChat/u)?.groups?.body ?? "";

  assert.match(body, /addLootgenRowsToInventory\(/u);
  assert.doesNotMatch(body, /addLootgenRowToInventory\(/u);
  assert.doesNotMatch(body, /\bfor\s*\(/u);
});
