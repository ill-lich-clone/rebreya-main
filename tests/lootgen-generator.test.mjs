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
