import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { LootgenTemplateCatalog } from "../scripts/data/lootgen-template-catalog.js";

test("legacy setting catalog is detached read-only migration input", () => {
  const source = {
    version: 1,
    templates: [{ id: "legacy", name: " Старый шаблон ", form: { itemCount: 7 }, updatedAt: 50 }]
  };
  const catalog = new LootgenTemplateCatalog({ get: () => source });
  const listed = catalog.list();
  assert.equal(listed[0].name, "Старый шаблон");
  assert.equal(listed[0].form.itemCount, 7);
  assert.equal(catalog.get("legacy").id, "legacy");
  listed[0].form.itemCount = 99;
  assert.equal(catalog.get("legacy").form.itemCount, 7);
  assert.equal(catalog.save, undefined);
  assert.equal(catalog.remove, undefined);
  assert.equal(catalog.migrate, undefined);
});

test("legacy setting remains private migration input while Item service owns public Lootgen APIs", async () => {
  const [constants, settings, main] = await Promise.all([
    readFile(new URL("../scripts/constants.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/settings.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/main.js", import.meta.url), "utf8")
  ]);
  assert.match(constants, /LOOTGEN_TEMPLATES:\s*"lootgenTemplates"/u);
  assert.match(settings, /game\.settings\.register\(MODULE_ID,\s*SETTINGS_KEYS\.LOOTGEN_TEMPLATES/u);
  assert.match(main, /LootgenTemplateItemService/u);
  assert.match(main, /migrateLegacyTemplates/u);
  assert.match(main, /saveLootgenTemplate/u);
  assert.match(main, /listLootgenTemplates/u);
  assert.doesNotMatch(main, /new LootgenTemplateCatalog/u);
});
