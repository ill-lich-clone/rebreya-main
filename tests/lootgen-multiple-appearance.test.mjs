import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeLootgenMultipleAppearance,
  rollLootgenMultipleAppearance
} from "../scripts/data/lootgen-multiple-appearance.js";

test("multiple appearance accepts package counts and Russian or Latin dice", () => {
  assert.equal(normalizeLootgenMultipleAppearance(" 2к12 "), "2d12");
  assert.equal(normalizeLootgenMultipleAppearance("1D6"), "1d6");
  assert.equal(normalizeLootgenMultipleAppearance(20), "20");
});

test("multiple appearance falls back to one for invalid formulas", () => {
  for (const value of ["", "0", "garbage", "2d0", "0к6"]) {
    assert.equal(normalizeLootgenMultipleAppearance(value), "1");
  }
});

test("multiple appearance rolls every die deterministically", () => {
  const rolls = [0, 0.49, 0.99];

  assert.equal(rollLootgenMultipleAppearance("3к6", () => rolls.shift()), 10);
  assert.equal(rollLootgenMultipleAppearance("100", () => 0), 100);
});
