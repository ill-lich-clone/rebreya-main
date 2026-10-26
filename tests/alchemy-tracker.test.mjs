import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateAlchemyInventoryTotals } from "../scripts/data/alchemy-tracker.js";
import * as alchemyTracker from "../scripts/data/alchemy-tracker.js";

function alchemyItem(number, rank, quantity, productType = "Зелье", extra = {}) {
  return {
    type: "consumable",
    system: { quantity, ...extra.system },
    flags: {
      "rebreya-main": {
        managed: true,
        sourceType: "alchemyProduct",
        alchemyProductId: `alchemy-${number}`,
        sourceNumber: number,
        productType,
        rank,
        ...extra.flags
      }
    }
  };
}

test("inventory breakdown uses the same trusted stacks and ranks as both counters", () => {
  assert.equal(typeof alchemyTracker.getAlchemyInventoryEntries, "function");
  const healing = Object.assign(alchemyItem(80, 4, 2), { name: "Лечение" });
  const first = Object.assign(alchemyItem(35, 3, 2), { name: "Скорость" });
  const second = Object.assign(alchemyItem(35, 3, 1), { name: "Скорость" });
  const bomb = Object.assign(alchemyItem(154, 1, 1, "Бомба"), { name: "Бомба" });
  const invalid = alchemyItem(10, 2, 1, "Зелье", { flags: { alchemyProductId: "alchemy-99" } });
  const items = [healing, first, second, bomb, alchemyItem(80, 4, 0), invalid];
  assert.deepEqual(alchemyTracker.getAlchemyInventoryEntries(items), [
    { kind: "healing", productId: "alchemy-80", name: "Лечение", rank: 4, quantity: 2 },
    { kind: "utility", productId: "alchemy-35", name: "Скорость", rank: 3, quantity: 2 },
    { kind: "utility", productId: "alchemy-35", name: "Скорость", rank: 3, quantity: 1 },
    { kind: "utility", productId: "alchemy-154", name: "Бомба", rank: 1, quantity: 1 }
  ]);
  assert.deepEqual(calculateAlchemyInventoryTotals(items), { healing: 8, utility: 10 });
});

test("inventory totals sum ranks times quantity and separate the nine healing potions", () => {
  const items = [
    alchemyItem(35, 3, 2),
    alchemyItem(10, 2, 1),
    alchemyItem(80, 4, 2),
    alchemyItem(154, 1, 1, "Бомба"),
    alchemyItem(42, 3, 1)
  ];
  assert.deepEqual(calculateAlchemyInventoryTotals(items), { healing: 8, utility: 12 });
});

test("untrusted identities, missing ranks and zero or invalid quantities never invent levels", () => {
  const items = [
    alchemyItem(80, 4, 0),
    alchemyItem(35, 3, -2),
    alchemyItem(10, 0, 1),
    alchemyItem(35, 10, 1),
    alchemyItem(10, 2, NaN),
    alchemyItem(10, 2, 1, "Зелье", { flags: { alchemyProductId: "alchemy-35" } }),
    alchemyItem(10, 2, 1, "Зелье", { flags: { sourceType: "other" } }),
    { name: "Зелье лечения (4 ур.)", type: "consumable", system: { quantity: 2 } }
  ];
  assert.deepEqual(calculateAlchemyInventoryTotals(items), { healing: 0, utility: 0 });
});

test("belt splits, nested items and quantity changes preserve a single inventory total", () => {
  const normal = alchemyItem(35, 3, 1, "Зелье", { system: { container: "backpack" } });
  const belted = alchemyItem(35, 3, 1, "Зелье", { flags: { universalBelt: { slot: 1 } } });
  assert.deepEqual(calculateAlchemyInventoryTotals([normal, belted]), { healing: 0, utility: 6 });
  normal.system.quantity = 2;
  assert.deepEqual(calculateAlchemyInventoryTotals([normal]), { healing: 0, utility: 6 });
  normal.system.quantity = 1;
  assert.deepEqual(calculateAlchemyInventoryTotals([normal]), { healing: 0, utility: 3 });
});

test("all authored alchemy product types contribute to their intended storage tracker", async () => {
  const catalog = JSON.parse(await readFile(new URL("../data/alchemy-products.json", import.meta.url), "utf8"));
  const items = catalog.map((product) => alchemyItem(product.sourceNumber, product.rank, 1, product.productType));
  const healing = catalog.filter((product) => product.sourceNumber >= 77 && product.sourceNumber <= 85)
    .reduce((sum, product) => sum + product.rank, 0);
  const utility = catalog.filter((product) => product.sourceNumber < 77 || product.sourceNumber > 85)
    .reduce((sum, product) => sum + product.rank, 0);
  assert.deepEqual(calculateAlchemyInventoryTotals(items), { healing, utility });
});
