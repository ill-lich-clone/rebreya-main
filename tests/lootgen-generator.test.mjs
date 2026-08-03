import test from "node:test";
import assert from "node:assert/strict";

import {
  generateLootgenResult,
  normalizeLootgenForm
} from "../scripts/data/lootgen-generator.js";

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
