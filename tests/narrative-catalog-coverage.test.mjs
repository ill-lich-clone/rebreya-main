import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeEconomyDataset } from "../scripts/data/normalizer.js";
import { createDnd5eItemData } from "../scripts/data/gear-compendium.js";
import * as narrative from "../scripts/data/lootgen-narrative-catalog.js";
import { prepareStorageNarrativeRows } from "../scripts/data/storage-narrative-rows.js";

globalThis.foundry ??= { utils: { deepClone: structuredClone } };
globalThis.CONST ??= { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
const scope = "rebreya-main";
const raw = JSON.parse(readFileSync(new URL("../data/lootgen-narrative-variants.json", import.meta.url), "utf8"));
const gear = JSON.parse(readFileSync(new URL("../data/gear.json", import.meta.url), "utf8"));
const model = normalizeEconomyDataset({ gear });
const catalog = narrative.normalizeLootgenNarrativeCatalog(raw);
const groups = [...new Set(raw.variants.map(v => v.sourceName))];
const sourceFor = name => createDnd5eItemData(model.gear.find(g => g.name === name), new Map());

test("every real narrative gear group resolves after the same normalization used by Foundry", () => {
  assert.equal(groups.length, 160);
  const missing = groups.filter(name => !catalog.byGearId.has(sourceFor(name).flags[scope].gearId));
  assert.deepEqual(missing, []);
  assert.deepEqual([...catalog.byVariantId.keys()], raw.variants.map(v => v.variantId), "persisted variant IDs must not change");
});

test("all real gear groups retain source HTML and mechanics for first and last narrative variants", () => {
  for (const name of groups) {
    const source = sourceFor(name), before = structuredClone(source);
    const variants = catalog.byGearId.get(source.flags[scope].gearId);
    for (const draw of [0, 0.999999]) {
      const patch = narrative.buildNarrativeItemCreationPatch(source, catalog, { random: () => draw });
      assert.ok(patch, name);
      const selected = variants[draw === 0 ? 0 : variants.length - 1];
      assert.equal(selected.rank, source.flags[scope].rank, name);
      assert.equal(patch.flags[scope].narrativeGearId, source.flags[scope].gearId, name);
      assert.equal(patch.flags[scope].narrativeVariantId, selected.variantId, name);
      assert.equal(patch.name, selected.title || source.name, "blank authored title keeps source name");
      assert.ok(patch.system.description.value.includes(source.system.description.value), `${name}: source HTML lost`);
      const applied = narrative.applyLootgenNarrativeVariant(source, selected);
      assert.deepEqual(applied.system.price, source.system.price, name);
      assert.deepEqual(applied.system.weight, source.system.weight, name);
    }
    assert.deepEqual(source, before, name);
  }
});

test("ranked Book map rows preserve both physical copies and their source footer without reroll", () => {
  const itemData = sourceFor("Книга (7 ранг)");
  itemData.system.quantity = 2;
  const original = structuredClone(itemData);
  const rows = prepareStorageNarrativeRows([{ rowId: "ranked", quantity: 2, itemData }], catalog, { random: () => 0, idFactory: () => "second" });
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].name, itemData.name);
  for (const row of rows) assert.ok(row.itemData.system.description.value.includes(itemData.system.description.value));
  assert.deepEqual(prepareStorageNarrativeRows(rows, catalog, { random: () => assert.fail("reroll") }), rows);
  assert.deepEqual(itemData, original);
});

test("empty names of blank-title non-book variants restore the saved source name without reroll", () => {
  const selected = catalog.variants.find(v => !v.title && !v.sourceName.includes("Книга"));
  const item = narrative.applyLootgenNarrativeVariant(sourceFor(selected.sourceName), selected);
  item.name = "";
  assert.deepEqual(narrative.buildNarrativeItemNamePatch(item, catalog), { name: selected.sourceName });
  delete item.flags[scope].narrativeBaseName;
  assert.deepEqual(narrative.buildNarrativeItemNamePatch(item, catalog), { name: selected.sourceName });
});

function legacy() {
  return { name: "Моё имя", system: { quantity: 1, price: { value: 25, denomination: "gp" }, description: { value: "<h3>Летопись</h3><p>Записки.</p>", chat: "keep" } },
    flags: { [scope]: { gearId: "kniga", narrativeVariantId: "saved-id", narrativeTitle: "Летопись", narrativeDescription: "Записки.", predominantMaterialName: "Бумага", linkedTool: "Каллиграфа", value: 36000 } } };
}

test("exact legacy generated descriptions regain saved metadata once without replacing custom text", () => {
  assert.equal(typeof narrative.buildNarrativeItemRepairPatch, "function");
  const source = legacy(), before = structuredClone(source);
  const patch = narrative.buildNarrativeItemRepairPatch(source, catalog);
  assert.equal(patch.name, undefined, "manual name remains authoritative");
  assert.ok(patch.system.description.value.startsWith(source.system.description.value));
  assert.match(patch.system.description.value, /Преобладающий материал.*Бумага/u);
  assert.match(patch.system.description.value, /Связанный инструмент.*Каллиграфа/u);
  assert.match(patch.system.description.value, /Value.*36000/u);
  assert.equal(patch.system.description.chat, "keep");
  const repaired = { ...source, system: { ...source.system, ...patch.system } };
  assert.equal(narrative.buildNarrativeItemRepairPatch(repaired, catalog), null);
  const custom = legacy(); custom.system.description.value = "<p>Мой авторский текст</p>";
  assert.equal(narrative.buildNarrativeItemRepairPatch(custom, catalog), null);
  const created = narrative.buildNarrativeItemCreationPatch(source, catalog, { random: () => assert.fail("reroll") });
  assert.equal(created.system.description.value, patch.system.description.value);
  assert.equal(created.flags[scope].narrativeVariantId, "saved-id");
  assert.deepEqual(source, before);
});
