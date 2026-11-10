import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const loadAspects = () => import("../scripts/data/alchemy-aspects.js");
const materials = JSON.parse(readFileSync(new URL("../data/materials.json", import.meta.url), "utf8"));
const byName = (name) => materials.find((row) => row.name === name);

test("six stable templates recognize a renamed canonical aspect and a legacy loot stack", async () => {
  const { ALCHEMY_ASPECTS, createAlchemyAspectItemData, getAlchemyAspectKind } = await loadAspects();
  assert.deepEqual(Object.keys(ALCHEMY_ASPECTS), ["fire", "water", "earth", "air", "positive", "negative"]);
  const documents = Object.keys(ALCHEMY_ASPECTS).map((kind) => createAlchemyAspectItemData(kind));
  assert.equal(new Set(documents.map(({ _id }) => _id)).size, 6);
  assert.ok(documents.every((item) => item.type === "loot" && item.system.type.value === "resource" && item.system.quantity === 1));
  assert.equal(getAlchemyAspectKind({ ...documents[0], name: "Мой сосуд" }), "fire");
  assert.equal(getAlchemyAspectKind({ name: "Аспект ПЭ", type: "loot" }), "positive");
  assert.equal(getAlchemyAspectKind({ name: "Аспект ПЭ", type: "consumable" }), null);
  assert.equal(getAlchemyAspectKind({ name: "Аспект ПЭ", type: "loot",
    flags: { "rebreya-main": { materialId: "material-129" } } }), null);
});

test("plant yields come from the actual encyclopedia and exclude other material types", async () => {
  const { readPlantAspectYield } = await loadAspects();
  assert.deepEqual(readPlantAspectYield(byName("Хромовая слизь")), { earth: 42 });
  assert.deepEqual(readPlantAspectYield(byName("Сушеная Эфедра")), { positive: 22 });
  assert.equal(materials.filter(readPlantAspectYield).length, 60);
  assert.equal(readPlantAspectYield({ type: "Минерал", alchemyAspects: "15 О" }), null);
  assert.equal(readPlantAspectYield({ type: "Существо", alchemyAspects: "15 О" }), null);
});

test("the same d6 is applied to each present aspect at the rulebook thresholds", async () => {
  const { calculateAspectExtraction } = await loadAspects();
  const baseYield = { earth: 42, positive: 22 };
  for (const [total, expected] of [
    [9, { earth: 21, positive: 11 }], [10, { earth: 38, positive: 18 }],
    [14, { earth: 38, positive: 18 }], [15, baseYield], [24, baseYield],
    [25, { earth: 46, positive: 26 }]
  ]) assert.deepEqual(calculateAspectExtraction({ baseYield, portionCount: 2, total, d6: 4 }), expected);
  assert.deepEqual(calculateAspectExtraction({ baseYield: { fire: 15 }, portionCount: 1, total: 9 }), {});
  assert.deepEqual(calculateAspectExtraction({ baseYield: { fire: 15, water: 5 }, portionCount: 2, total: 9 }), { fire: 7, water: 2 });
  assert.deepEqual(calculateAspectExtraction({ baseYield: { fire: 2 }, portionCount: 1, total: 10, d6: 4 }), {});
});
