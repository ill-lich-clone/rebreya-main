import test from "node:test";
import assert from "node:assert/strict";

test("bonus survives term serialization without changing the original d20 results", async () => {
  const { appendD20Bonus } = await import("../scripts/combat/d20-bonus-roll.js");
  class NumericTerm { constructor(data) { Object.assign(this, data); } get expression() { return String(this.number); } }
  class OperatorTerm { constructor(data) { Object.assign(this, data); } get expression() { return this.operator; } }
  globalThis.foundry = { dice: { terms: { NumericTerm, OperatorTerm } } };
  const die = { expression: "2d20kh", results: [{ result: 15, active: true }, { result: 4, active: false }] };
  const roll = { total: 15, terms: [die], options: { critical: 20 }, constructor: {
    getFormula: terms => terms.map(term => term.expression).join(" ")
  } };
  appendD20Bonus(roll, { total: 4, formula: "1d6" });
  const saved = JSON.parse(JSON.stringify(roll));
  assert.equal(roll.terms[0], die);
  assert.deepEqual(saved.terms[0].results, [{ result: 15, active: true }, { result: 4, active: false }]);
  assert.equal(saved.terms[1].operator, "+");
  assert.equal(saved.terms[2].number, 4);
  assert.equal(saved._formula, "2d20kh + 4");
  assert.equal(saved.total, 19);
  assert.equal(saved.terms[0].results.find(result => result.active).result + saved.terms[2].number, 19);
  assert.equal(saved.options.critical, 20);
  appendD20Bonus(roll, { total: 3 }, { sign: -1 });
  assert.equal(roll.total, 16);
  assert.equal(roll.terms[3].operator, "-");
});

test("expired effects are unavailable without relying on an external cleanup module", async () => {
  const { isAvailableD20BonusEffect } = await import("../scripts/combat/d20-bonus-roll.js");
  const effect = { duration: { startTime: 0, seconds: 600 } };
  assert.equal(isAvailableD20BonusEffect(effect, 599), true);
  assert.equal(isAvailableD20BonusEffect(effect, 600), false);
  assert.equal(isAvailableD20BonusEffect({ duration: { seconds: null, remaining: null } }, 600), true);
  assert.equal(isAvailableD20BonusEffect({ disabled: true }, 0), false);
  assert.equal(isAvailableD20BonusEffect({ transfer: true }, 0), false);
});
