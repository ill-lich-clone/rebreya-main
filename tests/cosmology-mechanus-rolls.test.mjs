import test from "node:test";
import assert from "node:assert/strict";

const {
  applyMechanusAveragesToRoll,
  computeMechanusAverageFormulaTotal,
  getMechanusDieAverage,
  patchMechanusRollClass,
  registerMechanusRollHooks,
  resetMechanusRollClassPatch
} = await import("../scripts/cosmology/mechanus-rolls.js");

test("Mechanus averages non-d20 and non-d100 dice at the whole roll level", () => {
  assert.equal(getMechanusDieAverage(0, 6), 0);
  assert.equal(getMechanusDieAverage(1, 4), 2.5);
  assert.equal(computeMechanusAverageFormulaTotal("0d6"), 0);
  assert.equal(computeMechanusAverageFormulaTotal("1d4"), 2);
  assert.equal(computeMechanusAverageFormulaTotal("2d4"), 5);
  assert.equal(computeMechanusAverageFormulaTotal("1d4 + 1d4"), 5);
  assert.equal(computeMechanusAverageFormulaTotal("8d6"), 28);
});

test("Mechanus preserves an explicit zero-dice damage term", () => {
  const damageRoll = {
    formula: "0d6",
    total: 0,
    _total: 0,
    terms: [{ number: 0, faces: 6, total: 0, results: [] }]
  };

  assert.equal(applyMechanusAveragesToRoll(damageRoll), true);
  assert.equal(damageRoll.total, 0);
  assert.equal(damageRoll.terms[0].number, 0);
  assert.deepEqual(damageRoll.terms[0].results, []);
});

test("Mechanus formula averaging respects non-d20 keep modifiers", () => {
  assert.equal(computeMechanusAverageFormulaTotal("4d6kh3"), 10);
  assert.equal(computeMechanusAverageFormulaTotal("4d6kl3"), 10);
  assert.equal(computeMechanusAverageFormulaTotal("2d8kh + 1d4"), 7);
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

test("Mechanus floors a fractional final damage total inside the averaged dice term", () => {
  const damageRoll = {
    formula: "1d8 + 10",
    total: 18,
    _total: 18,
    terms: [
      { number: 1, faces: 8, total: 8, results: [{ result: 8, active: true }] },
      "+",
      { number: 10, total: 10 }
    ]
  };

  assert.equal(applyMechanusAveragesToRoll(damageRoll), true);
  assert.equal(damageRoll.total, 14);
  assert.equal(damageRoll.terms[0].total, 4);
  assert.equal(damageRoll.terms[0].results[0].result, 4);
});

test("Mechanus roll averaging keeps Foundry non-d20 kh and kl active dice counts", () => {
  const keepHighestRoll = {
    formula: "4d6kh3",
    total: 16,
    _total: 16,
    terms: [{
      number: 4,
      faces: 6,
      modifiers: ["kh3"],
      total: 16,
      results: [
        { result: 2, active: false, discarded: true },
        { result: 5, active: true },
        { result: 5, active: true },
        { result: 6, active: true }
      ]
    }]
  };

  assert.equal(applyMechanusAveragesToRoll(keepHighestRoll), true);
  assert.equal(keepHighestRoll.total, 10);
  assert.equal(keepHighestRoll.terms[0].total, 10);
  assert.deepEqual(keepHighestRoll.terms[0].results.map((result) => result.active), [false, true, true, true]);

  const keepLowestRoll = {
    formula: "4d6kl3",
    total: 7,
    _total: 7,
    terms: [{
      number: 4,
      faces: 6,
      modifiers: ["kl3"],
      total: 7,
      results: [
        { result: 1, active: true },
        { result: 2, active: true },
        { result: 4, active: true },
        { result: 6, active: false, discarded: true }
      ]
    }]
  };

  assert.equal(applyMechanusAveragesToRoll(keepLowestRoll), true);
  assert.equal(keepLowestRoll.total, 10);
  assert.equal(keepLowestRoll.terms[0].total, 10);
  assert.deepEqual(keepLowestRoll.terms[0].results.map((result) => result.active), [true, true, true, false]);
});

test("Mechanus converts d20 advantage and disadvantage into flat bonuses", () => {
  const advantageRoll = {
    formula: "2d20kh",
    total: 18,
    _total: 18,
    terms: [{
      number: 2,
      faces: 20,
      modifiers: ["kh"],
      total: 18,
      results: [{ result: 1, active: false }, { result: 20, active: true }]
    }]
  };
  assert.equal(applyMechanusAveragesToRoll(advantageRoll), true);
  assert.equal(advantageRoll.total, 3);
  assert.equal(advantageRoll.terms[0].number, 1);
  assert.deepEqual(advantageRoll.terms[0].results.map((result) => result.active), [true, false]);

  const heroicAdvantageRoll = {
    formula: "3d20kh",
    total: 20,
    _total: 20,
    terms: [{
      number: 3,
      faces: 20,
      modifiers: ["kh"],
      total: 20,
      results: [{ result: 12, active: false }, { result: 20, active: true }, { result: 8, active: false }]
    }]
  };
  assert.equal(applyMechanusAveragesToRoll(heroicAdvantageRoll), true);
  assert.equal(heroicAdvantageRoll.total, 14);

  const disadvantageRoll = {
    formula: "2d20kl",
    total: 4,
    _total: 4,
    terms: [{
      number: 2,
      faces: 20,
      modifiers: ["kl"],
      total: 4,
      results: [{ result: 15, active: false }, { result: 4, active: true }]
    }]
  };
  assert.equal(applyMechanusAveragesToRoll(disadvantageRoll), true);
  assert.equal(disadvantageRoll.total, 13);
});

test("Mechanus d20 advantage survives a dnd5e and MIDI-style total recomputation", () => {
  const previousFoundry = globalThis.foundry;

  class TestOperatorTerm {
    constructor({ operator }) {
      this.operator = operator;
    }

    get formula() {
      return ` ${this.operator} `;
    }

    get total() {
      return ` ${this.operator} `;
    }
  }

  class TestNumericTerm {
    constructor({ number, options = {} }) {
      this.number = Number(number);
      this.options = options;
    }

    get formula() {
      return String(this.number);
    }

    get total() {
      return this.number;
    }
  }

  class TestD20Term {
    constructor() {
      this.number = 2;
      this._number = 2;
      this.faces = 20;
      this.modifiers = ["kh"];
      this.options = { advantageMode: 1 };
      this.results = [{ result: 14, active: false }, { result: 18, active: true }];
      Object.preventExtensions(this);
    }

    get formula() {
      return `${this.number}d${this.faces}${this.modifiers.join("")}`;
    }

    get total() {
      return this.results.reduce((total, result) => result.active ? total + result.result : total, 0);
    }
  }

  globalThis.foundry = {
    ...(previousFoundry ?? {}),
    dice: {
      ...(previousFoundry?.dice ?? {}),
      terms: {
        ...(previousFoundry?.dice?.terms ?? {}),
        NumericTerm: TestNumericTerm,
        OperatorTerm: TestOperatorTerm
      }
    }
  };

  try {
    const d20 = new TestD20Term();
    const roll = {
      _formula: "2d20kh + 4",
      _total: 22,
      options: { advantageMode: 1 },
      terms: [d20, new TestOperatorTerm({ operator: "+" }), new TestNumericTerm({ number: 4 })],
      get formula() {
        return this.terms.map((term) => term.formula).join("");
      },
      get total() {
        return this._total;
      },
      _evaluateTotal() {
        return Function(`"use strict"; return (${this.terms.map((term) => term.total).join("")});`)();
      }
    };

    assert.equal(applyMechanusAveragesToRoll(roll), true);
    assert.deepEqual(d20.results.map((result) => result.active), [true, false]);
    assert.equal(d20.results[0].result, 14);

    assert.equal(roll.total, 20);
    assert.equal(roll._evaluateTotal(), 20);
    assert.equal(roll._formula, "1d20 + 2 + 4");
  }
  finally {
    if (previousFoundry === undefined) {
      delete globalThis.foundry;
    }
    else {
      globalThis.foundry = previousFoundry;
    }
  }
});

test("Mechanus repairs the exact malformed d20 roll persisted by MIDI", () => {
  class TestOperatorTerm {
    constructor({ operator }) {
      this.operator = operator;
      this.options = {};
      this._evaluated = true;
    }

    get formula() {
      return ` ${this.operator} `;
    }

    get total() {
      return ` ${this.operator} `;
    }
  }

  class TestNumericTerm {
    constructor({ number, options = {}, evaluated = false }) {
      this.number = Number(number);
      this.options = options;
      this._evaluated = evaluated;
    }

    evaluate() {
      this._evaluated = true;
      return this;
    }

    get formula() {
      return String(this.number);
    }

    get total() {
      return this.number;
    }
  }

  class TestD20Term {
    constructor() {
      this.number = 1;
      this._number = 1;
      this.faces = 20;
      this.modifiers = [];
      this.options = { advantageMode: 1, rebreyaMechanusAdvantageBonus: 2 };
      this.results = [
        { result: 6, value: 6, active: true, discarded: false },
        { result: 15, active: false, discarded: true }
      ];
      this._evaluated = true;
    }

    get formula() {
      return `${this.number}d${this.faces}${this.modifiers.join("")}`;
    }

    get total() {
      return this.results.reduce((total, result) => result.active ? total + result.result : total, 0);
    }
  }

  const d20 = new TestD20Term();
  const bonus = new TestNumericTerm({
    number: 2,
    options: { rebreyaMechanusAdvantageBonus: 2 }
  });
  const roll = {
    _formula: "2d20kh + 4",
    _total: 19,
    options: { advantageMode: 1 },
    terms: [
      d20,
      new TestOperatorTerm({ operator: "+" }),
      bonus,
      new TestOperatorTerm({ operator: "+" }),
      new TestNumericTerm({ number: 4, evaluated: true })
    ],
    get formula() {
      return this.terms.map((term) => term.formula).join("");
    },
    get total() {
      return this._total;
    },
    resetFormula() {
      this._formula = this.formula;
      return this._formula;
    },
    _evaluateTotal() {
      return Function(`"use strict"; return (${this.terms.map((term) => term.total).join("")});`)();
    }
  };

  assert.equal(applyMechanusAveragesToRoll(roll), true);
  assert.equal(bonus._evaluated, true);
  assert.equal(roll._formula, "1d20 + 2 + 4");
  assert.equal(roll.total, 12);
});

test("Mechanus repairs MIDI rolls at the preCreateChatMessage boundary", () => {
  const previousRoll = globalThis.Roll;
  const previousHooks = globalThis.Hooks;
  const previousLibWrapper = globalThis.libWrapper;
  const callbacks = new Map();

  class TestRoll {
    async evaluate() {
      return this;
    }
  }

  const d20 = {
    number: 1,
    _number: 1,
    faces: 20,
    modifiers: [],
    options: { advantageMode: 1, rebreyaMechanusAdvantageBonus: 2 },
    results: [
      { result: 6, value: 6, active: true, discarded: false },
      { result: 15, active: false, discarded: true }
    ],
    _evaluated: true,
    get formula() {
      return "1d20";
    },
    get total() {
      return 6;
    },
    toJSON() {
      return { class: "D20Die", evaluated: true, number: 1, faces: 20, modifiers: [], results: this.results };
    }
  };
  const operator = (value) => ({
    operator: value,
    options: {},
    _evaluated: true,
    get formula() {
      return ` ${value} `;
    },
    get total() {
      return ` ${value} `;
    },
    toJSON() {
      return { class: "OperatorTerm", evaluated: true, operator: value };
    }
  });
  const numeric = (number, options = {}, evaluated = true) => ({
    number,
    options,
    _evaluated: evaluated,
    evaluate() {
      this._evaluated = true;
      return this;
    },
    get formula() {
      return String(number);
    },
    get total() {
      return number;
    },
    toJSON() {
      return { class: "NumericTerm", options, evaluated: this._evaluated, number };
    }
  });
  const roll = {
    _formula: "2d20kh + 4",
    _total: 19,
    terms: [d20, operator("+"), numeric(2, { rebreyaMechanusAdvantageBonus: 2 }, false), operator("+"), numeric(4)],
    get formula() {
      return this.terms.map((term) => term.formula).join("");
    },
    get total() {
      return this._total;
    },
    resetFormula() {
      return this._formula = this.formula;
    },
    _evaluateTotal() {
      return Function(`"use strict"; return (${this.terms.map((term) => term.total).join("")});`)();
    },
    toJSON() {
      return {
        class: "D20Roll",
        formula: this._formula,
        terms: this.terms.map((term) => term.toJSON()),
        total: this._total,
        evaluated: true
      };
    }
  };
  const document = {
    rolls: [roll],
    content: "19",
    updateSource(update) {
      this.update = update;
    }
  };

  globalThis.Roll = TestRoll;
  globalThis.libWrapper = undefined;
  globalThis.Hooks = {
    on(name, callback) {
      callbacks.set(name, callback);
      return 17;
    },
    off() {}
  };

  try {
    assert.equal(registerMechanusRollHooks({ isMechanusEnabled: () => true }), true);
    const preCreate = callbacks.get("preCreateChatMessage");
    assert.equal(typeof preCreate, "function");
    preCreate(document);

    assert.equal(document.update.content, "12");
    assert.equal(document.update.rolls[0].formula, "1d20 + 2 + 4");
    assert.equal(document.update.rolls[0].total, 12);
    assert.equal(document.update.rolls[0].terms[2].evaluated, true);
  }
  finally {
    resetMechanusRollClassPatch(TestRoll);
    globalThis.Roll = previousRoll;
    globalThis.Hooks = previousHooks;
    globalThis.libWrapper = previousLibWrapper;
  }
});

test("Mechanus reads dnd5e d20 advantage mode when keep modifiers are absent", () => {
  const advantageRoll = {
    formula: "2d20kh + 3",
    total: 23,
    _total: 23,
    options: { advantageMode: 1 },
    terms: [
      {
        number: 2,
        faces: 20,
        total: 20,
        results: [{ result: 2, active: false }, { result: 20, active: true }],
        options: { advantageMode: 1 }
      },
      "+",
      { number: 3, total: 3 }
    ]
  };

  assert.equal(applyMechanusAveragesToRoll(advantageRoll), true);
  assert.equal(advantageRoll.total, 7);
  assert.equal(advantageRoll.terms[0].total, 4);
  assert.deepEqual(advantageRoll.terms[0].results.map((result) => result.active), [true, false]);

  const disadvantageRoll = {
    formula: "2d20kl + 3",
    total: 7,
    _total: 7,
    options: { advantageMode: -1 },
    terms: [
      {
        number: 2,
        faces: 20,
        total: 4,
        results: [{ result: 15, active: false }, { result: 4, active: true }],
        options: { advantageMode: -1 }
      },
      "+",
      { number: 3, total: 3 }
    ]
  };

  assert.equal(applyMechanusAveragesToRoll(disadvantageRoll), true);
  assert.equal(disadvantageRoll.total, 16);
  assert.equal(disadvantageRoll.terms[0].total, 13);
  assert.deepEqual(disadvantageRoll.terms[0].results.map((result) => result.active), [true, false]);
});

test("Mechanus reads d20 advantage mode from the roll formula as a fallback", () => {
  const advantageRoll = {
    formula: "2d20kh + 3",
    total: 23,
    _total: 23,
    terms: [
      {
        number: 2,
        faces: 20,
        total: 20,
        results: [{ result: 2, active: false }, { result: 20, active: true }]
      },
      "+",
      { number: 3, total: 3 }
    ]
  };

  assert.equal(applyMechanusAveragesToRoll(advantageRoll), true);
  assert.equal(advantageRoll.total, 7);

  const disadvantageRoll = {
    formula: "2d20kl + 3",
    total: 7,
    _total: 7,
    terms: [
      {
        number: 2,
        faces: 20,
        total: 4,
        results: [{ result: 15, active: false }, { result: 4, active: true }]
      },
      "+",
      { number: 3, total: 3 }
    ]
  };

  assert.equal(applyMechanusAveragesToRoll(disadvantageRoll), true);
  assert.equal(disadvantageRoll.total, 16);
});

test("Mechanus roll patch registers global Roll hooks through libWrapper", () => {
  const previousRoll = globalThis.Roll;
  const previousLibWrapper = globalThis.libWrapper;
  const registrations = [];
  const unregistrations = [];

  class TestRoll {
    async evaluate() {
      return this;
    }

    evaluateSync() {
      return this;
    }
  }

  globalThis.Roll = TestRoll;
  globalThis.libWrapper = {
    register(moduleId, target, wrapper, type) {
      registrations.push({ moduleId, target, wrapper, type });
    },
    unregister(moduleId, target) {
      unregistrations.push({ moduleId, target });
    }
  };

  try {
    assert.equal(patchMechanusRollClass(TestRoll, { isEnabled: () => true }), true);
    assert.deepEqual(registrations.map(({ target, type }) => ({ target, type })), [
      { target: "Roll.prototype.evaluate", type: "WRAPPER" },
      { target: "Roll.prototype.evaluateSync", type: "WRAPPER" }
    ]);
    assert.equal(TestRoll.prototype.evaluate.name, "evaluate");

    assert.equal(resetMechanusRollClassPatch(TestRoll), true);
    assert.deepEqual(unregistrations.map(({ target }) => target), [
      "Roll.prototype.evaluate",
      "Roll.prototype.evaluateSync"
    ]);
  }
  finally {
    resetMechanusRollClassPatch(TestRoll);
    globalThis.Roll = previousRoll;
    globalThis.libWrapper = previousLibWrapper;
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
