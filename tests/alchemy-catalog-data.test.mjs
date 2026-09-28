import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildEconomyModel } from "../scripts/engine/economy-engine.js";
import { normalizeAlchemyProducts, normalizeEconomyDataset } from "../scripts/data/normalizer.js";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value))
  }
};

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const products = JSON.parse(await readFile(new URL("../data/alchemy-products.json", import.meta.url), "utf8"));

const rankRules = new Map([
  [1, { formula: "(1d6+1) * 5", maximum: 35, rarity: "common" }],
  [2, { formula: "(1d6+1) * 40", maximum: 280, rarity: "uncommon" }],
  [3, { formula: "(1d6+1) * 50", maximum: 350, rarity: "uncommon" }],
  [4, { formula: "(1d6+1) * 400", maximum: 2800, rarity: "rare" }],
  [5, { formula: "(1d6+1) * 500", maximum: 3500, rarity: "rare" }],
  [6, { formula: "(1d8+1) * 4000", maximum: 36000, rarity: "veryRare" }],
  [7, { formula: "(1d8+1) * 5000", maximum: 45000, rarity: "veryRare" }],
  [8, { formula: "2d6 * 10000", maximum: 120000, rarity: "veryRare" }],
  [9, { formula: "2d6 * 12500", maximum: 150000, rarity: "legendary" }]
]);

test("alchemy normalization preserves every canonical field without sharing nested state", () => {
  const normalized = normalizeAlchemyProducts([products[0]]);

  assert.deepEqual(normalized, [products[0]]);
  assert.notEqual(normalized[0], products[0]);
  assert.notEqual(normalized[0].aspects, products[0].aspects);
});

test("alchemy normalization rejects missing required fields and duplicate ids", () => {
  assert.throws(
    () => normalizeAlchemyProducts([{ ...products[0], name: undefined }]),
    /required field name/i
  );
  assert.throws(
    () => normalizeAlchemyProducts([products[0], { ...products[1], id: products[0].id }]),
    /duplicate alchemy product id: alchemy-1/i
  );
});

test("production alchemy catalog preserves source identity, rank rules, and both asset paths", async () => {
  const omittedSourceNumbers = new Set([36, 52, 67, 76]);
  const expectedSourceNumbers = Array.from({ length: 234 }, (_value, index) => index + 1)
    .filter((sourceNumber) => !omittedSourceNumbers.has(sourceNumber));

  assert.equal(products.length, 230);
  assert.deepEqual(products.map((product) => product.sourceNumber), expectedSourceNumbers);
  for (const [index, product] of products.entries()) {
    const rules = rankRules.get(product.rank);
    assert.ok(rules, `${product.id}: rank rule`);
    assert.equal(product.priceFormula, rules.formula, `${product.id}: price formula`);
    assert.equal(product.priceMaximumGp, rules.maximum, `${product.id}: maximum price`);
    assert.equal(product.rarity, rules.rarity, `${product.id}: rarity`);
    assert.equal(product.weight, product.rank, `${product.id}: rank weight`);
    assert.equal(product.sourceRef, `Алхимические продукты V1!A${index + 3}`);
    await access(path.join(moduleRoot, ...product.icon.split("/")));
    await access(path.join(moduleRoot, ...product.topDownImage.split("/")));
  }
});

test("economy model exposes alchemy separately from ordinary gear with a 230-entry id map", () => {
  const dataset = normalizeEconomyDataset({
    goods: [], regions: [], cities: [], materials: [], gear: [], reference: {}, alchemyProducts: products
  });
  const model = buildEconomyModel(dataset);

  assert.equal(dataset.alchemyProducts.length, 230);
  assert.equal(model.alchemyProducts.length, 230);
  assert.equal(model.alchemyProductById.size, 230);
  assert.equal(model.alchemyProductById.get("alchemy-1"), model.alchemyProducts[0]);
  assert.deepEqual(model.gear, []);
  assert.equal(model.gearById.size, 0);
});
