import test from "node:test";
import assert from "node:assert/strict";
import { registerExtendedDamageDice } from "../scripts/integrations/dnd5e-damage-dice.js";

test("weapon damage denominations include d2 and d3 while preserving existing dice order", () => {
  const dieSteps = [4, 6, 8, 10, 12, 20, 100];
  const config = { dieSteps };
  registerExtendedDamageDice(config);
  assert.equal(config.dieSteps, dieSteps);
  assert.deepEqual(dieSteps, [2, 3, 4, 6, 8, 10, 12, 20, 100]);
  registerExtendedDamageDice(config);
  assert.deepEqual(dieSteps, [2, 3, 4, 6, 8, 10, 12, 20, 100]);
});

test("existing d2 or d3 is not duplicated and missing dice are inserted in order", () => {
  for (const existing of [[2, 4, 6], [3, 4, 6], [2, 3, 4, 6]]) {
    registerExtendedDamageDice({ dieSteps: existing });
    assert.deepEqual(existing, [2, 3, 4, 6]);
  }
});

test("missing or unsupported dnd5e configuration is left untouched", () => {
  assert.doesNotThrow(() => registerExtendedDamageDice(null));
  const config = { dieSteps: undefined };
  assert.equal(registerExtendedDamageDice(config), false);
  assert.equal(config.dieSteps, undefined);
});
