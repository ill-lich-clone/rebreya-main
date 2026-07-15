import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCraftBatch,
  calculateMaterialReservation,
  calculateProjectWorkdays,
  resolveDailyProgressGold,
  validateCraftEligibility
} from "../scripts/data/crafting-rules.js";

const gearById = new Map([
  ["sword", {
    id: "sword",
    name: "Longsword",
    requiredToolId: "smiths",
    priceGoldEquivalent: 15,
    weight: 3,
    rank: 2
  }],
  ["shield", {
    id: "shield",
    name: "Shield",
    requiredToolId: "smiths",
    priceGoldEquivalent: 10,
    weight: 6,
    rank: 1
  }],
  ["musket", {
    id: "musket",
    name: "Musket",
    requiredToolId: "tinkers",
    priceGoldEquivalent: 500,
    weight: 10,
    rank: 4,
    firearmClass: "longarm"
  }],
  ["wand", {
    id: "wand",
    name: "Magic wand",
    requiredToolId: "woodcarvers",
    priceGoldEquivalent: 100,
    weight: 1,
    rank: 3,
    isMagic: true
  }]
]);

test("buildCraftBatch aggregates quantity, price, weight, rank, and one required tool", () => {
  const batch = buildCraftBatch([
    { sourceId: "sword", quantity: 2 },
    { sourceId: "shield", quantity: 1 }
  ], gearById);

  assert.deepEqual(batch.outputs.map(({ sourceId, quantity }) => ({ sourceId, quantity })), [
    { sourceId: "sword", quantity: 2 },
    { sourceId: "shield", quantity: 1 }
  ]);
  assert.equal(batch.totalQuantity, 3);
  assert.equal(batch.totalPriceGold, 40);
  assert.equal(batch.totalWeightLb, 12);
  assert.equal(batch.requiredRank, 2);
  assert.equal(batch.requiredToolId, "smiths");
  assert.deepEqual(batch.requiredToolIds, ["smiths"]);
  assert.equal(batch.profile, "mundane");
  assert.equal(batch.hasMagicItems, false);
});

test("buildCraftBatch records incompatible tools and firearm requirements", () => {
  const batch = buildCraftBatch([
    { sourceId: "sword", quantity: 1 },
    { sourceId: "musket", quantity: 1 }
  ], gearById);

  assert.deepEqual(batch.requiredToolIds, ["smiths", "tinkers"]);
  assert.equal(batch.requiredToolId, null);
  assert.equal(batch.profile, "firearm");
  assert.deepEqual(batch.firearmSourceIds, ["musket"]);
});

test("buildCraftBatch rejects missing gear and invalid quantities", () => {
  assert.throws(() => buildCraftBatch([{ sourceId: "missing", quantity: 1 }], gearById), /not found/i);
  assert.throws(() => buildCraftBatch([{ sourceId: "sword", quantity: 0 }], gearById), /quantity/i);
  assert.throws(() => buildCraftBatch([], gearById), /at least one/i);
});

test("resolveDailyProgressGold covers the full 8-16 hour table", () => {
  const expected = new Map([
    [8, 5], [9, 5.5], [10, 6], [11, 6.5], [12, 7],
    [13, 7.5], [14, 8], [15, 9], [16, 10]
  ]);

  for (const [hours, gold] of expected) {
    assert.equal(resolveDailyProgressGold({ hours }), gold);
  }
  assert.throws(() => resolveDailyProgressGold({ hours: 7 }), /8.*16/);
  assert.throws(() => resolveDailyProgressGold({ hours: 8.5 }), /integer/i);
});

test("resolveDailyProgressGold applies effect scaling and firearm multiplier", () => {
  assert.equal(resolveDailyProgressGold({ hours: 12, effectiveBaseGold: 10 }), 14);
  assert.equal(resolveDailyProgressGold({ hours: 8, profile: "firearm" }), 25);
  assert.equal(resolveDailyProgressGold({ hours: 16, profile: "firearm", effectiveBaseGold: 7.5 }), 75);
});

test("material quote caps predominant material by output weight", () => {
  assert.deepEqual(calculateMaterialReservation({
    totalPriceGold: 100,
    totalWeightLb: 3,
    predominantMaterial: { priceGold: 10, weightLb: 1 },
    baseRawMaterial: { priceGold: 1, weightLb: 0.1 }
  }), {
    materialValueGold: 50,
    predominantMaterialLb: 3,
    predominantMaterialValueGold: 30,
    baseRawMaterialQuantity: 20,
    baseRawWeightLb: 2
  });
});

test("material quote uses predominant material for the entire material value when weight permits", () => {
  assert.deepEqual(calculateMaterialReservation({
    totalPriceGold: 20,
    totalWeightLb: 10,
    predominantMaterial: { priceGold: 4, weight: 2 },
    baseRawMaterial: { priceGold: 0.5, weight: 0.25 }
  }), {
    materialValueGold: 10,
    predominantMaterialLb: 5,
    predominantMaterialValueGold: 10,
    baseRawMaterialQuantity: 0,
    baseRawWeightLb: 0
  });
});

test("material quote preserves deterministic five-decimal fractional quantities", () => {
  assert.deepEqual(calculateMaterialReservation({
    totalPriceGold: 1,
    totalWeightLb: 0,
    predominantMaterial: { priceGold: 2, weightLb: 1 },
    baseRawMaterial: { priceGold: 0.3, weightLb: 0.1 }
  }), {
    materialValueGold: 0.5,
    predominantMaterialLb: 0,
    predominantMaterialValueGold: 0,
    baseRawMaterialQuantity: 1.66667,
    baseRawWeightLb: 0.16667
  });
});

test("material quote rejects missing or invalid prices", () => {
  assert.throws(() => calculateMaterialReservation({
    totalPriceGold: 10,
    totalWeightLb: 1,
    predominantMaterial: { priceGold: 0, weightLb: 1 },
    baseRawMaterial: { priceGold: 1, weightLb: 1 }
  }), /predominant material price/i);
  assert.throws(() => calculateMaterialReservation({
    totalPriceGold: 10,
    totalWeightLb: 0,
    predominantMaterial: { priceGold: 1, weightLb: 1 },
    baseRawMaterial: { priceGold: null, weightLb: 1 }
  }), /base raw material price/i);
});

test("calculateProjectWorkdays rounds up from the selected daily progress", () => {
  assert.equal(calculateProjectWorkdays({ targetGold: 11, hours: 8 }), 3);
  assert.equal(calculateProjectWorkdays({ targetGold: 100, hours: 8, profile: "firearm" }), 4);
  assert.equal(calculateProjectWorkdays({ targetGold: 0, hours: 8 }), 0);
});

test("validateCraftEligibility accepts a compatible mundane batch", () => {
  const batch = buildCraftBatch([{ sourceId: "sword", quantity: 1 }], gearById);
  assert.deepEqual(validateCraftEligibility({
    batch,
    toolAccess: { toolId: "smiths", rank: 2, owned: true },
    workshopApproved: true
  }), { valid: true, errors: [] });
});

test("validateCraftEligibility reports magic, tool, rank, workshop, and firearm blueprint failures", () => {
  const magicBatch = buildCraftBatch([{ sourceId: "wand", quantity: 1 }], gearById);
  const magic = validateCraftEligibility({
    batch: magicBatch,
    toolAccess: { toolId: "woodcarvers", rank: 5, owned: true },
    workshopApproved: true
  });
  assert.equal(magic.valid, false);
  assert.ok(magic.errors.some((error) => error.code === "magic-item"));

  const mixedBatch = buildCraftBatch([
    { sourceId: "sword", quantity: 1 },
    { sourceId: "musket", quantity: 1 }
  ], gearById);
  const invalid = validateCraftEligibility({
    batch: mixedBatch,
    toolAccess: { toolId: "smiths", rank: 1, owned: true },
    workshopApproved: false,
    blueprintIds: []
  });
  assert.equal(invalid.valid, false);
  assert.deepEqual(new Set(invalid.errors.map((error) => error.code)), new Set([
    "incompatible-tools",
    "insufficient-tool-rank",
    "workshop-required",
    "blueprint-required"
  ]));
});

