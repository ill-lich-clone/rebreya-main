import test from "node:test";
import assert from "node:assert/strict";
import { collectItemSourceUuids, preserveItemSourceUuid, stripItemSourceUuidFromFlags } from "../scripts/data/item-source-reference.js";

test("source references preserve canonical priority and reject embedded or non-Item UUIDs", () => {
  const data = { flags: { "rebreya-main": { itemSourceUuid: "Item.original" }, core: { sourceId: "Compendium.world.goods.Item.source" }, dnd5e: { sourceId: "Actor.hero.Item.copy" } }, _stats: { compendiumSource: "Compendium.world.goods.source" } };
  assert.deepEqual(collectItemSourceUuids(data, { sourceUuid: "Item.original" }), ["Item.original", "Compendium.world.goods.Item.source", "Compendium.world.goods.source"]);
  for (const sourceUuid of ["Actor.hero.Item.copy", "JournalEntry.journal", "Compendium.world.goods.JournalEntry.journal", "Compendium.bad", "", null]) {
    assert.deepEqual(collectItemSourceUuids({}, { sourceUuid }), []);
  }
});

test("source metadata survives cleanup without changing input, economics or authority flags", () => {
  const data = { name: "Мой предмет", type: "loot", system: { quantity: 2, weight: { value: 0.5 }, price: { value: 7 } }, flags: { "rebreya-main": { sourceType: "manual", manualEntry: { version: 1 } } }, _stats: { compendiumSource: "Compendium.world.items.Item.original" } };
  const before = structuredClone(data);
  const result = preserveItemSourceUuid(data, { sourceUuid: "Actor.hero.Item.temporary" });
  assert.deepEqual(data, before);
  assert.equal(result.flags["rebreya-main"].itemSourceUuid, "Compendium.world.items.Item.original");
  assert.deepEqual(result.system, data.system);
  assert.deepEqual(stripItemSourceUuidFromFlags(result.flags), data.flags);
  assert.equal(result.flags["rebreya-main"].nativeImportSource, undefined);
  assert.deepEqual(preserveItemSourceUuid({ name: "Без источника" }), { name: "Без источника" });
});

test("display-only source flags do not change comparison flags or create an empty namespace", () => {
  for (const flags of [{}, { core: { sourceId: "Item.original" } }, { "rebreya-main": { sourceType: "manual", quantityRule: "authored" } }]) {
    const withSource = structuredClone(flags);
    withSource["rebreya-main"] ??= {};
    withSource["rebreya-main"].itemSourceUuid = "Item.original";
    assert.deepEqual(stripItemSourceUuidFromFlags(withSource), flags);
    assert.equal(withSource["rebreya-main"].itemSourceUuid, "Item.original");
  }
});
