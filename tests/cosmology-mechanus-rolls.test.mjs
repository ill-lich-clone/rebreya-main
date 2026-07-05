import test from "node:test";
import assert from "node:assert/strict";

const {
  applyMechanusAveragesToRoll,
  computeMechanusAverageFormulaTotal,
  getMechanusDieAverage,
  patchMechanusRollClass,
  resetMechanusRollClassPatch
} = await import("../scripts/cosmology/mechanus-rolls.js");

test("Mechanus averages non-d20 and non-d100 dice at the whole roll level", () => {
  assert.equal(getMechanusDieAverage(1, 4), 2.5);
  assert.equal(computeMechanusAverageFormulaTotal("1d4"), 2);
  assert.equal(computeMechanusAverageFormulaTotal("2d4"), 5);
  assert.equal(computeMechanusAverageFormulaTotal("1d4 + 1d4"), 5);
  assert.equal(computeMechanusAverageFormulaTotal("8d6"), 28);
});

test("Mechanus formula averaging ignores d20 and d100 expressions", () => {
  assert.equal(computeMechanusAverageFormulaTotal("1d20 + 1d4"), null);
  assert.equal(computeMechanusAverageFormulaTotal("1d100 + 2d4"), null);
  assert.equal(computeMechanusAverageFormulaTotal("1d20 + 1d100"), null);
});

test("Mechanus roll patch replaces only eligible dice terms after evaluation", async () => {
  class TestRoll {
    constructor(formula, total, terms) {
      this.formula = formula;
      this.total = total;
      this._total = total;
      this.terms = terms;
    }

    async evaluate() {
      return this;
    }
  }

  patchMechanusRollClass(TestRoll, { isEnabled: () => true });
  try {
    const mixedRoll = new TestRoll("1d20 + 1d4", 16, [
      { number: 1, faces: 20, total: 12, results: [{ result: 12, active: true }] },
      "+",
      { number: 1, faces: 4, total: 4, results: [{ result: 4, active: true }] }
    ]);
    await mixedRoll.evaluate();
    assert.equal(mixedRoll.total, 14);
    assert.equal(mixedRoll._total, 14);

    const damageRoll = new TestRoll("2d4", 4, [
      { number: 2, faces: 4, total: 4, results: [{ result: 1, active: true }, { result: 3, active: true }] }
    ]);
    await damageRoll.evaluate();
    assert.equal(damageRoll.total, 5);
  }
  finally {
    resetMechanusRollClassPatch(TestRoll);
  }
});

test("Mechanus roll patch leaves rolls untouched while disabled", async () => {
  class TestRoll {
    constructor() {
      this.formula = "8d6";
      this.total = 19;
      this._total = 19;
    }

    async evaluate() {
      return this;
    }
  }

  patchMechanusRollClass(TestRoll, { isEnabled: () => false });
  try {
    const roll = new TestRoll();
    await roll.evaluate();
    assert.equal(roll.total, 19);
    assert.equal(applyMechanusAveragesToRoll(roll, { enabled: false }), false);
  }
  finally {
    resetMechanusRollClassPatch(TestRoll);
  }
});

test("Mechanus roll patch also covers synchronous roll evaluation", () => {
  class TestRoll {
    constructor() {
      this.formula = "8d6";
      this.total = 19;
      this._total = 19;
    }

    evaluateSync() {
      return this;
    }
  }

  patchMechanusRollClass(TestRoll, { isEnabled: () => true });
  try {
    const roll = new TestRoll();
    roll.evaluateSync();
    assert.equal(roll.total, 28);
  }
  finally {
    resetMechanusRollClassPatch(TestRoll);
  }
});
