import assert from "node:assert/strict";
import test from "node:test";

import {
  INVENTORY_INGRESS_RULES_VERSION,
  InventoryIngressRuleCompilerCache,
  InventoryIngressRuleError,
  compileInventoryIngressRules,
  createEmptyInventoryIngressRuleState,
  describeInventoryIngressRule,
  findInventoryIngressRuleConflicts,
  normalizeInventoryIngressRule,
  normalizeInventoryIngressRuleState
} from "../scripts/data/inventory-ingress-rules.js";

function rule({
  id = "rule-1",
  name = id,
  conditions = [{ field: "documentType", operator: "is", value: "weapon" }],
  action = { type: "skip" }
} = {}) {
  return { id, name, conditions, action };
}

function state(rules, revision = 1) {
  return { version: 1, revision, rules };
}

test("normalizes an absent state to the exact versioned empty contract", () => {
  assert.equal(INVENTORY_INGRESS_RULES_VERSION, 1);
  assert.deepEqual(normalizeInventoryIngressRuleState(null), {
    version: 1,
    revision: 0,
    rules: []
  });
  assert.deepEqual(createEmptyInventoryIngressRuleState(), {
    version: 1,
    revision: 0,
    rules: []
  });
});

test("normalizes enum sets, rule order, names and nested output immutably", () => {
  const input = state([
    rule({
      id: "z-rule",
      name: "  ",
      conditions: [{
        field: "documentType",
        operator: "in",
        value: ["weapon", "equipment", "weapon"]
      }],
      action: { type: "folder", folderId: " weapons " }
    }),
    rule({ id: "a-rule" })
  ], 4);

  const normalized = normalizeInventoryIngressRuleState(input);

  assert.deepEqual(normalized, {
    version: 1,
    revision: 4,
    rules: [
      rule({ id: "a-rule" }),
      {
        id: "z-rule",
        name: "documentType in equipment, weapon → folder weapons",
        conditions: [{
          field: "documentType",
          operator: "in",
          value: ["equipment", "weapon"]
        }],
        action: { type: "folder", folderId: "weapons" }
      }
    ]
  });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.rules), true);
  assert.equal(Object.isFrozen(normalized.rules[1].conditions[0].value), true);
  assert.equal(Object.isFrozen(normalized.rules[1].action), true);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(input.rules[0].action.folderId, " weapons ");
});

test("supports every typed operator with AND across fields and OR inside enum sets", () => {
  const compiled = compileInventoryIngressRules(state([
    rule({
      conditions: [
        { field: "sourceKind", operator: "isNot", value: "material" },
        { field: "sourceType", operator: "notIn", value: ["spell", "material"] },
        { field: "sourceId", operator: "in", value: ["sword", "axe"] },
        { field: "documentType", operator: "is", value: "weapon" },
        { field: "systemTypeValue", operator: "in", value: ["martialM", "martialR"] },
        { field: "systemTypeSubtype", operator: "isNot", value: "firearm" },
        { field: "sourceCategory", operator: "is", value: "weapon" },
        { field: "rarity", operator: "notIn", value: ["legendary"] },
        { field: "rank", operator: "gte", value: 2 },
        { field: "durabilityState", operator: "in", value: ["damaged", "broken"] },
        { field: "unitValue", operator: "between", value: [100, 500] },
        { field: "unitWeight", operator: "gt", value: 0 },
        { field: "predominantMaterialId", operator: "is", value: "iron" },
        { field: "dismantlable", operator: "is", value: true }
      ],
      action: { type: "folder", folderId: "weapons" }
    })
  ]));
  const descriptor = {
    sourceKind: "ordinary",
    sourceType: "gear",
    sourceId: "axe",
    documentType: "weapon",
    systemTypeValue: "martialM",
    systemTypeSubtype: "axe",
    sourceCategory: "weapon",
    rarity: "uncommon",
    rank: 2,
    durabilityState: "broken",
    unitValue: 500,
    unitWeight: 0.01,
    predominantMaterialId: "iron",
    dismantlable: true
  };

  assert.deepEqual(compiled.evaluateMany([descriptor]), [{
    ruleId: "rule-1",
    action: { type: "folder", folderId: "weapons" }
  }]);
  assert.deepEqual(compiled.evaluateMany([
    { ...descriptor, sourceId: "sword" },
    { ...descriptor, rank: 1 },
    { ...descriptor, rarity: "legendary" }
  ]), [
    { ruleId: "rule-1", action: { type: "folder", folderId: "weapons" } },
    null,
    null
  ]);
});

test("honors every numeric inclusive and exclusive edge", () => {
  const cases = [
    ["lt", 5, [4.99], [5]],
    ["lte", 5, [5], [5.01]],
    ["eq", 5, [5], [4.99]],
    ["gte", 5, [5], [4.99]],
    ["gt", 5, [5.01], [5]],
    ["between", [2, 5], [2, 5], [1.99, 5.01]]
  ];

  for (const [operator, value, accepted, rejected] of cases) {
    const compiled = compileInventoryIngressRules(state([
      rule({ conditions: [{ field: "unitValue", operator, value }] })
    ]));
    for (const unitValue of accepted) {
      assert.equal(compiled.evaluateMany([{ unitValue }])[0]?.ruleId, "rule-1", `${operator} accepts ${unitValue}`);
    }
    for (const unitValue of rejected) {
      assert.equal(compiled.evaluateMany([{ unitValue }])[0], null, `${operator} rejects ${unitValue}`);
    }
  }
});

test("a missing descriptor value never satisfies positive or negative conditions", () => {
  for (const operator of ["is", "isNot", "in", "notIn"]) {
    const value = operator === "in" || operator === "notIn" ? ["weapon"] : "weapon";
    const compiled = compileInventoryIngressRules(state([
      rule({ conditions: [{ field: "documentType", operator, value }] })
    ]));
    assert.equal(compiled.evaluateMany([{}])[0], null, operator);
  }
});

test("rejects unknown keys, duplicate fields and invalid typed values with stable codes", () => {
  const invalidCases = [
    ["invalid-state-shape", { version: 1, revision: 0, rules: [], extra: true }],
    ["unsupported-version", { version: 2, revision: 0, rules: [] }],
    ["invalid-revision", { version: 1, revision: -1, rules: [] }],
    ["invalid-rule-shape", state([{ ...rule(), priority: 1 }])],
    ["duplicate-condition-field", state([rule({ conditions: [
      { field: "rarity", operator: "is", value: "rare" },
      { field: "rarity", operator: "isNot", value: "common" }
    ] })])],
    ["unknown-condition-field", state([rule({ conditions: [{ field: "name", operator: "is", value: "Sword" }] })])],
    ["invalid-condition-shape", state([rule({ conditions: [{ field: "rarity", operator: "is", value: "rare", extra: 1 }] })])],
    ["invalid-condition-operator", state([rule({ conditions: [{ field: "rank", operator: "in", value: [1] }] })])],
    ["invalid-condition-value", state([rule({ conditions: [{ field: "rarity", operator: "in", value: [] }] })])],
    ["invalid-condition-value", state([rule({ conditions: [{ field: "rank", operator: "eq", value: Number.NaN }] })])],
    ["invalid-condition-value", state([rule({ conditions: [{ field: "rank", operator: "between", value: [4, 2] }] })])],
    ["invalid-condition-value", state([rule({ conditions: [{ field: "dismantlable", operator: "is", value: "true" }] })])],
    ["invalid-action-shape", state([rule({ action: { type: "skip", folderId: "x" } })])],
    ["invalid-action", state([rule({ action: { type: "folder", folderId: " " } })])]
  ];

  for (const [code, input] of invalidCases) {
    assert.throws(
      () => normalizeInventoryIngressRuleState(input),
      (error) => error instanceof InventoryIngressRuleError && error.code === code,
      code
    );
  }
});

test("describes a normalized rule without depending on a supplied display name", () => {
  assert.equal(describeInventoryIngressRule(rule({
    name: "Ignored",
    conditions: [
      { field: "rarity", operator: "in", value: ["rare", "uncommon"] },
      { field: "rank", operator: "between", value: [2, 4] }
    ],
    action: { type: "dismantle" }
  })), "rarity in rare, uncommon & rank between 2..4 → dismantle");
});

test("finds equal, subset, partial numeric and conservative cross-field conflicts", () => {
  const specificSword = rule({
    id: "specific-sword",
    conditions: [
      { field: "documentType", operator: "is", value: "weapon" },
      { field: "sourceId", operator: "is", value: "sword" }
    ]
  });
  const broadWeapon = rule({
    id: "broad-weapon",
    conditions: [{ field: "documentType", operator: "is", value: "weapon" }]
  });
  const rankBand = rule({
    id: "rank-band",
    conditions: [{ field: "rank", operator: "between", value: [2, 5] }]
  });
  const highRank = rule({
    id: "high-rank",
    conditions: [{ field: "rank", operator: "gte", value: 5 }]
  });

  assert.deepEqual(findInventoryIngressRuleConflicts([specificSword, structuredClone(specificSword)]), [{
    leftRuleId: "specific-sword",
    rightRuleId: "specific-sword",
    intersectingFields: ["documentType", "sourceId"]
  }]);
  assert.deepEqual(findInventoryIngressRuleConflicts([specificSword, broadWeapon]), [{
    leftRuleId: "specific-sword",
    rightRuleId: "broad-weapon",
    intersectingFields: ["documentType", "sourceId"]
  }]);
  assert.deepEqual(findInventoryIngressRuleConflicts([rankBand, highRank]), [{
    leftRuleId: "rank-band",
    rightRuleId: "high-rank",
    intersectingFields: ["rank"]
  }]);
  assert.deepEqual(findInventoryIngressRuleConflicts([
    specificSword,
    rule({ id: "rare-items", conditions: [{ field: "rarity", operator: "is", value: "rare" }] })
  ]).length, 1);
});

test("proves disjoint enum exclusions and touching exclusive numeric ranges", () => {
  const specificSword = rule({
    id: "specific-sword",
    conditions: [{ field: "sourceId", operator: "is", value: "sword" }]
  });
  const weaponExceptSword = rule({
    id: "not-sword",
    conditions: [{ field: "sourceId", operator: "isNot", value: "sword" }]
  });
  const belowFive = rule({
    id: "below-five",
    conditions: [{ field: "rank", operator: "lt", value: 5 }]
  });
  const fiveOrMore = rule({
    id: "five-or-more",
    conditions: [{ field: "rank", operator: "gte", value: 5 }]
  });

  assert.deepEqual(findInventoryIngressRuleConflicts([specificSword, weaponExceptSword]), []);
  assert.deepEqual(findInventoryIngressRuleConflicts([belowFive, fiveOrMore]), []);
});

test("dismantle adds an implicit dismantlable constraint for conflicts and matching", () => {
  const dismantle = rule({
    id: "dismantle-weapons",
    conditions: [{ field: "documentType", operator: "is", value: "weapon" }],
    action: { type: "dismantle" }
  });
  const keepIneligible = rule({
    id: "keep-ineligible",
    conditions: [{ field: "dismantlable", operator: "is", value: false }],
    action: { type: "folder", folderId: "scrap" }
  });
  const keepEligible = rule({
    id: "keep-eligible",
    conditions: [{ field: "dismantlable", operator: "is", value: true }],
    action: { type: "folder", folderId: "scrap" }
  });

  assert.deepEqual(findInventoryIngressRuleConflicts([dismantle, keepIneligible]), []);
  assert.equal(findInventoryIngressRuleConflicts([dismantle, keepEligible]).length, 1);
  const compiled = compileInventoryIngressRules(state([dismantle]));
  assert.equal(compiled.evaluateMany([{ documentType: "weapon", dismantlable: false }])[0], null);
  assert.equal(compiled.evaluateMany([{ documentType: "weapon", dismantlable: true }])[0]?.ruleId, "dismantle-weapons");
});

test("refuses to compile conflicting state instead of selecting by priority", () => {
  assert.throws(
    () => compileInventoryIngressRules(state([
      rule({ id: "one" }),
      rule({ id: "two" })
    ])),
    (error) => error instanceof InventoryIngressRuleError
      && error.code === "rule-conflict"
      && error.details.conflicts.length === 1
  );
});

test("compiled decisions and candidates are detached and deeply frozen", () => {
  const compiled = compileInventoryIngressRules(state([rule()]));
  const candidates = compiled.candidateRuleIds({ documentType: "weapon" });
  const decisions = compiled.evaluateMany([{ documentType: "weapon" }]);

  assert.deepEqual(candidates, ["rule-1"]);
  assert.equal(Object.isFrozen(compiled), true);
  assert.equal(Object.isFrozen(candidates), true);
  assert.equal(Object.isFrozen(decisions), true);
  assert.equal(Object.isFrozen(decisions[0]), true);
  assert.equal(Object.isFrozen(decisions[0].action), true);
});

test("compiler cache keys immutable compiled engines by group and revision", () => {
  const cache = new InventoryIngressRuleCompilerCache();
  const revisionOne = state([rule()], 1);
  const first = cache.get("group-a", revisionOne);

  assert.equal(cache.get("group-a", structuredClone(revisionOne)), first);
  assert.notEqual(cache.get("group-b", revisionOne), first);
  assert.notEqual(cache.get("group-a", state([rule()], 2)), first);
  cache.clear("group-a");
  assert.notEqual(cache.get("group-a", revisionOne), first);
});

test("identity indexes bound candidate checks for hundreds of rules and thousands of rows", () => {
  const rules = Array.from({ length: 300 }, (_, index) => rule({
    id: `gear-${index}`,
    conditions: [
      { field: "sourceType", operator: "is", value: "gear" },
      { field: "sourceId", operator: "is", value: `gear-${index}` }
    ],
    action: { type: "folder", folderId: `folder-${index}` }
  }));
  const descriptors = Array.from({ length: 5_000 }, (_, index) => ({
    sourceType: "gear",
    sourceId: `gear-${index % 300}`
  }));
  const compiled = compileInventoryIngressRules(state(rules));
  const candidateChecks = descriptors.reduce(
    (sum, descriptor) => sum + compiled.candidateRuleIds(descriptor).length,
    0
  );
  const decisions = compiled.evaluateMany(descriptors);

  assert.equal(decisions.length, descriptors.length);
  assert.equal(decisions.filter(Boolean).length, descriptors.length);
  assert.ok(candidateChecks < descriptors.length * 6);
  assert.equal(decisions[299].ruleId, "gear-299");
  assert.equal(decisions[300].ruleId, "gear-0");
});
