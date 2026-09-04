import test from "node:test";
import assert from "node:assert/strict";

import { LootgenTemplateCatalog } from "../scripts/data/lootgen-template-catalog.js";
import { readFile } from "node:fs/promises";

function createMemorySettingStore(initialValue = { version: 1, templates: [] }) {
  let value = initialValue;
  let setCount = 0;
  return {
    get: () => value,
    set: async (nextValue) => {
      setCount += 1;
      value = nextValue;
      return value;
    },
    value: () => value,
    setCount: () => setCount
  };
}

test("catalog saves a named normalized Lootgen template", async () => {
  const store = createMemorySettingStore();
  const catalog = new LootgenTemplateCatalog({
    get: store.get,
    set: store.set,
    now: () => 100,
    randomId: () => "simple-chest"
  });

  const saved = await catalog.save({
    name: "  Простой сундук  ",
    form: { rankMin: 4, rankMax: 1, itemCount: "2" }
  });

  assert.equal(saved.id, "simple-chest");
  assert.equal(saved.name, "Простой сундук");
  assert.equal(saved.updatedAt, 100);
  assert.deepEqual(saved.form, {
    rankMin: 1,
    rankMax: 4,
    itemCount: 2,
    optimalItemQuantity: 4,
    budgetValue: 5000,
    coinBudgetPercent: 0,
    magicPercent: 25,
    brokenEquipmentChance: 0,
    includeGear: true,
    includeMagicItems: false,
    includeCoins: true,
    gearTypeFilters: {},
    magicTypeFilters: {}
  });
  assert.deepEqual(catalog.list(), [saved]);
});

test("catalog persists version two migration with the soft target", async () => {
  const legacyTemplate = {
    id: "legacy",
    name: "Старый шаблон",
    form: { itemCount: 7 },
    updatedAt: 50
  };
  const store = createMemorySettingStore({ version: 1, templates: [legacyTemplate] });
  const catalog = new LootgenTemplateCatalog({ get: store.get, set: store.set });

  assert.equal(await catalog.migrate(), true);
  assert.equal(store.setCount(), 1);
  assert.equal(store.value().version, 2);
  assert.equal(store.value().templates[0].form.optimalItemQuantity, 4);
  assert.equal(await catalog.migrate(), false);
  assert.equal(store.setCount(), 1);
});

test("catalog rejects blank and duplicate template names", async () => {
  const store = createMemorySettingStore();
  let nextId = 0;
  const catalog = new LootgenTemplateCatalog({
    get: store.get,
    set: store.set,
    now: () => 100,
    randomId: () => "template-" + (++nextId)
  });

  await assert.rejects(catalog.save({ name: "", form: {} }), /название/u);
  await catalog.save({ name: "Простой сундук", form: {} });
  await assert.rejects(
    catalog.save({ name: " простой сундук ", form: {} }),
    /уже существует/u
  );
});

test("template catalog is registered as a private world setting and exposed through the module API", async () => {
  const [constants, settings, main] = await Promise.all([
    readFile(new URL("../scripts/constants.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/settings.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/main.js", import.meta.url), "utf8")
  ]);

  assert.match(constants, /LOOTGEN_TEMPLATES:\s*"lootgenTemplates"/u);
  assert.match(settings, /game\.settings\.register\(MODULE_ID,\s*SETTINGS_KEYS\.LOOTGEN_TEMPLATES/u);
  assert.match(main, /LootgenTemplateCatalog/u);
  assert.match(main, /saveLootgenTemplate/u);
  assert.match(main, /listLootgenTemplates/u);
});
