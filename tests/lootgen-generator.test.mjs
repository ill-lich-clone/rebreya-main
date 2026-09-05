import test from "node:test";
import assert from "node:assert/strict";

import {
  generateLootgenResult,
  normalizeLootgenForm
} from "../scripts/data/lootgen-generator.js";

test("upgrades, enchantments and curses never enter random loot in either pool", () => {
  const excluded = [
    { equipmentType: "Усовершенствование" },
    { typeLabel: "Зачарование" },
    { typeLabel: "Проклятье" },
    { upgrade: { type: "Материал" } }
  ].map((data, i) => ({ ...data, sourceId: `excluded-${i}`, name: `Excluded ${i}`, value: 1 }));
  for (const pool of ["mundanePool", "magicPool"]) {
    const result = generateLootgenResult({
      [pool]: [...excluded, { sourceId: "ordinary", name: "Проклятый меч", value: 1 }],
      budgetValue: 100, itemCount: 10, includeMagicItems: true, includeCoins: false, random: () => 0
    });
    assert.deepEqual(result.rows.map(row => row.sourceId), ["ordinary"]);
  }
});

test("canonical coin candidates become currency rather than ordinary loot Items", () => {
  const result = generateLootgenResult({
    mundanePool: [{ sourceType: "gear", sourceId: "mednaya-moneta", value: 2, multipleAppearance: "1", stackable: true }],
    budgetValue: 47, itemCount: 1, includeCoins: true, random: () => 0
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.coins.cp, 47);
  assert.equal(result.spentValue + result.coins.totalCopper, 47);
});

test("coins never consume the requested ordinary item row limit", () => {
  const result = generateLootgenResult({
    mundanePool: [
      { sourceType: "gear", sourceId: "mednaya-moneta", name: "Coin", value: 1 },
      ...Array.from({ length: 5 }, (_, i) => ({ sourceType: "gear", sourceId: `ordinary-${i}`, name: `Ordinary ${i}`, value: 10, stackable: false }))
    ],
    budgetValue: 100, itemCount: 5, includeCoins: true, random: () => 0
  });
  assert.equal(result.rows.length, 5);
  assert.equal(result.coins.totalCopper, 50);
  assert.equal(result.spentValue, 50);
});

test("disabled currency excludes canonical coin candidates without matching ordinary names", () => {
  const coin = { sourceType: "gear", sourceId: "zolotaya-moneta", name: "Золотая монета", value: 200 };
  assert.throws(() => generateLootgenResult({ mundanePool: [coin], budgetValue: 1000, includeCoins: false }), /нет доступных предметов/u);
  const ordinary = generateLootgenResult({ mundanePool: [{ ...coin, sourceId: "coin-shaped-medallion" }], budgetValue: 200, includeCoins: false });
  assert.equal(ordinary.rows[0].sourceId, "coin-shaped-medallion");
});

test("lootgen generator normalizes a reusable form snapshot", () => {
  assert.deepEqual(normalizeLootgenForm({
    rankMin: "4",
    rankMax: "2",
    itemCount: "3",
    budgetValue: "-5",
    includeGear: false,
    includeMagicItems: true,
    gearTypeFilters: { weapon: 1, invalid: "no" },
    magicTypeFilters: { wand: false }
  }), {
    rankMin: 2,
    rankMax: 4,
    itemCount: 3,
    optimalItemQuantity: 4,
    budgetValue: 0,
    coinBudgetPercent: 0,
    magicPercent: 25,
    brokenEquipmentChance: 0,
    includeGear: false,
    includeMagicItems: true,
    includeCoins: true,
    gearTypeFilters: { weapon: true, invalid: false },
    magicTypeFilters: { wand: false }
  });
});

test("lootgen generator normalizes the soft quantity target", () => {
  assert.equal(normalizeLootgenForm({}).optimalItemQuantity, 4);
  assert.equal(normalizeLootgenForm({ optimalItemQuantity: "7" }).optimalItemQuantity, 7);
  assert.equal(normalizeLootgenForm({ optimalItemQuantity: 0 }).optimalItemQuantity, 1);
});

test("coin reserve is bounded and missing legacy values preserve the old budget", () => {
  assert.equal(normalizeLootgenForm({}).coinBudgetPercent, 0);
  assert.equal(normalizeLootgenForm({ coinBudgetPercent: "20" }).coinBudgetPercent, 20);
  assert.equal(normalizeLootgenForm({ coinBudgetPercent: -1 }).coinBudgetPercent, 0);
  assert.equal(normalizeLootgenForm({ coinBudgetPercent: 101 }).coinBudgetPercent, 100);
  assert.equal(normalizeLootgenForm({ coinBudgetPercent: "invalid" }).coinBudgetPercent, 0);
});

for (const scenario of [
  { percent: 20, includeCoins: true, spent: 800, coins: 201 },
  { percent: 100, includeCoins: true, spent: 0, coins: 1001 },
  { percent: 0, includeCoins: true, spent: 1000, coins: 1 },
  { percent: 20, includeCoins: false, spent: 1000, coins: 0 }
]) {
  test(`lootgen reserves ${scenario.percent}% for coins when enabled=${scenario.includeCoins}`, () => {
    const result = generateLootgenResult({
      mundanePool: [{ sourceType: "gear", sourceId: "ration", name: "Рацион", value: 100, multipleAppearance: "1", stackable: true }],
      budgetValue: 1001, itemCount: 1, coinBudgetPercent: scenario.percent,
      includeCoins: scenario.includeCoins, random: () => 0.5
    });
    assert.equal(result.spentValue, scenario.spent);
    assert.equal(result.coins.totalCopper, scenario.coins);
    assert.equal(result.totalItems, scenario.spent / 100);
    assert.ok(result.spentValue + result.coins.totalCopper <= 1001);
  });
}

test("lootgen rolls an authored package formula once for a valueless source", () => {
  const result = generateLootgenResult({
    mundanePool: [{
      sourceType: "gear",
      sourceId: "paper",
      name: "Бумага (один лист)",
      rank: 0,
      value: 0,
      multipleAppearance: "2к12",
      typeLabel: "Снаряжение",
      stackable: true
    }],
    itemCount: 1,
    optimalItemQuantity: 4,
    budgetValue: 100,
    includeCoins: true,
    random: () => 0.999
  });

  assert.equal(result.rows[0].quantity, 24);
  assert.equal(result.spentValue, 0);
  assert.equal(result.coins.totalCopper, 100);
});

test("lootgen repeats selection passes and may exceed the soft target to spend budget", () => {
  const result = generateLootgenResult({
    mundanePool: [{
      sourceType: "gear",
      sourceId: "ration",
      name: "Рацион",
      rank: 0,
      value: 100,
      multipleAppearance: "1",
      typeLabel: "Снаряжение",
      stackable: true
    }],
    itemCount: 1,
    optimalItemQuantity: 4,
    budgetValue: 600,
    includeCoins: true,
    random: () => 0
  });

  assert.equal(result.rows[0].quantity, 6);
  assert.equal(result.spentValue, 600);
});

test("lootgen treats itemCount as a hard cap on result rows across budget passes", () => {
  const mundanePool = Array.from({ length: 10 }, (_, index) => ({
    sourceType: "gear",
    sourceId: `tool-${index}`,
    name: `Tool ${index}`,
    rank: 0,
    value: 5,
    multipleAppearance: "1",
    typeLabel: "Gear",
    stackable: false
  }));

  const result = generateLootgenResult({
    mundanePool,
    itemCount: 4,
    optimalItemQuantity: 4,
    budgetValue: 50,
    includeCoins: true,
    random: () => 0
  });

  assert.equal(result.rows.length, 4);
  assert.equal(result.spentValue, 20);
  assert.equal(result.coins.totalCopper, 30);
});

test("lootgen fills requested rows before increasing selected stack quantities", () => {
  const mundanePool = Array.from({ length: 4 }, (_, index) => ({
    sourceType: "gear",
    sourceId: `material-${index}`,
    name: `Material ${index}`,
    rank: 0,
    value: 5,
    multipleAppearance: "1",
    typeLabel: "Material",
    stackable: true
  }));

  const result = generateLootgenResult({
    mundanePool,
    itemCount: 4,
    optimalItemQuantity: 4,
    budgetValue: 50,
    includeCoins: true,
    random: () => 0
  });

  assert.equal(result.rows.length, 4);
  assert.equal(result.totalItems, 10);
  assert.equal(result.rows.some((row) => row.quantity > 1), true);
  assert.equal(result.spentValue, 50);
});

test("lootgen never repeats one specific magic item even when it is consumable", () => {
  const result = generateLootgenResult({
    mundanePool: [],
    magicPool: [{
      sourceType: "magicItem",
      sourceId: "healing-potion",
      name: "Зелье лечения",
      rank: 0,
      value: 100,
      typeLabel: "Зелье",
      stackable: true
    }],
    includeMagicItems: true,
    magicPercent: 100,
    itemCount: 5,
    optimalItemQuantity: 4,
    budgetValue: 1000,
    includeCoins: true,
    random: () => 0
  });

  assert.equal(result.rows[0].quantity, 1);
  assert.equal(result.spentValue, 100);
  assert.equal(result.coins.totalCopper, 900);
});

test("lootgen selects a zero-value item once without using it as a budget filler", () => {
  const result = generateLootgenResult({
    mundanePool: [{
      sourceType: "gear",
      sourceId: "free-sample",
      name: "Бесплатный образец",
      rank: 0,
      value: 0,
      multipleAppearance: "1",
      typeLabel: "Снаряжение",
      stackable: true
    }],
    itemCount: 5,
    budgetValue: 500,
    includeCoins: true,
    random: () => 0
  });

  assert.equal(result.rows[0].quantity, 1);
  assert.equal(result.spentValue, 0);
  assert.equal(result.coins.totalCopper, 500);
});

test("lootgen generator produces a reusable result payload within the configured budget", () => {
  const result = generateLootgenResult({
    mundanePool: [{
      sourceType: "gear",
      sourceId: "rope",
      name: "Верёвка",
      rank: 0,
      value: 200,
      typeLabel: "Снаряжение",
      stackable: true,
      breakable: false
    }],
    magicPool: [],
    includeMagicItems: false,
    magicPercent: 0,
    itemCount: 1,
    budgetValue: 500,
    includeCoins: true,
    brokenEquipmentChance: 0,
    batchId: "test-batch",
    generatedAt: "01.08.2026, 12:00:00",
    random: () => 0
  });

  assert.deepEqual(result, {
    rows: [{
      sourceType: "gear",
      sourceId: "rope",
      name: "Верёвка",
      rank: 0,
      value: 200,
      typeLabel: "Снаряжение",
      stackable: true,
      isBroken: false,
      quantity: 2,
      totalValue: 400,
      rowIndex: 0,
      directGrantId: "lootgen:test-batch:row:0"
    }],
    coins: {
      pp: 0,
      gp: 0,
      sp: 0,
      cp: 100,
      totalCopper: 100,
      label: "100 мм"
    },
    spentValue: 400,
    budgetValue: 500,
    totalItems: 2,
    generatedAt: "01.08.2026, 12:00:00",
    directCoinGrantId: "lootgen:test-batch:coins",
    hasResult: true
  });
});
