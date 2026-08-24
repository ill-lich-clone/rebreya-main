import assert from "node:assert/strict";
import test from "node:test";

import {
  INVENTORY_INGRESS_PLAN_VERSION,
  InventoryIngressPlanError,
  InventoryIngressPlanner
} from "../scripts/application/inventory-ingress-planner.js";

function row(sourceKey, descriptor, {
  quantity = 1,
  legacyFolderId = null,
  container = null,
  name = sourceKey
} = {}) {
  return {
    sourceKey,
    quantity,
    itemData: { name, descriptor },
    legacyFolderId,
    container
  };
}

function createHarness({ decisions, confirmation = { rootOverrideSourceKeys: [] } } = {}) {
  const calls = {
    readRules: 0,
    compile: 0,
    evaluateMany: 0,
    descriptor: 0,
    dismantlePreview: 0,
    confirm: 0
  };
  const ruleState = { version: 1, revision: 7, rules: [] };
  const compiler = {
    evaluateMany(descriptors) {
      calls.evaluateMany += 1;
      return typeof decisions === "function"
        ? decisions(descriptors)
        : decisions ?? descriptors.map(() => null);
    }
  };
  const planner = new InventoryIngressPlanner({
    async readRules(groupActorId) {
      calls.readRules += 1;
      assert.equal(groupActorId, "group-a");
      return ruleState;
    },
    buildDescriptor(itemData) {
      calls.descriptor += 1;
      return structuredClone(itemData.descriptor);
    },
    resolveDismantleOutputs(itemData, quantity) {
      calls.dismantlePreview += 1;
      return [{ sourceType: "material", sourceId: "iron", name: "Железо", quantity: quantity * 1.5 }];
    },
    compilerCache: {
      get(groupActorId, state) {
        calls.compile += 1;
        assert.equal(groupActorId, "group-a");
        assert.equal(state, ruleState);
        return compiler;
      }
    },
    async confirm(preview) {
      calls.confirm += 1;
      assert.equal(Object.isFrozen(preview), true);
      return confirmation;
    }
  });
  return { calls, planner };
}

test("preview reads and evaluates once, builds one descriptor per row and resolves only matched dismantle", async () => {
  const { calls, planner } = createHarness({
    decisions: [
      { ruleId: "folder-rule", action: { type: "folder", folderId: "weapons" } },
      { ruleId: "skip-rule", action: { type: "skip" } },
      { ruleId: "dismantle-rule", action: { type: "dismantle" } },
      null
    ]
  });
  const rows = [
    row("folder", { sourceType: "gear", sourceId: "sword", documentType: "weapon", durabilityState: "intact" }),
    row("skip", { sourceType: "gear", sourceId: "rope", documentType: "loot", durabilityState: "ineligible" }),
    row("dismantle", { sourceType: "gear", sourceId: "axe", documentType: "weapon", durabilityState: "broken" }, { quantity: 2 }),
    row("legacy", { sourceType: "gear", sourceId: "torch", documentType: "loot", durabilityState: "ineligible" }, { legacyFolderId: "supplies" })
  ];

  const preview = await planner.preview({
    groupActorId: "group-a",
    requestedFolderId: "requested",
    rows,
    batch: true
  });

  assert.deepEqual(calls, {
    readRules: 1,
    compile: 1,
    evaluateMany: 1,
    descriptor: rows.length,
    dismantlePreview: 1,
    confirm: 0
  });
  assert.equal(preview.version, INVENTORY_INGRESS_PLAN_VERSION);
  assert.equal(preview.rulesRevision, 7);
  assert.deepEqual(preview.rows.map((entry) => entry.action), [
    { type: "folder", folderId: "weapons" },
    { type: "skip" },
    { type: "dismantle" },
    { type: "legacy", folderId: "supplies" }
  ]);
  assert.deepEqual(preview.rows[2].dismantlePreview, [{
    sourceType: "material",
    sourceId: "iron",
    name: "Железо",
    quantity: 3
  }]);
  assert.deepEqual(preview.rows[0].identity, {
    sourceType: "gear",
    sourceId: "sword",
    documentType: "weapon",
    durabilityState: "intact",
    quantity: 1
  });
  assert.equal(Object.isFrozen(preview.rows), true);
  assert.equal(rows[0].itemData.name, "folder");
});

test("collectChoices opens nothing for folder/no-match or batch skip, but confirms single skip and dismantle once", async () => {
  const quiet = createHarness({ decisions: [
    { ruleId: "folder", action: { type: "folder", folderId: "weapons" } },
    null,
    { ruleId: "skip", action: { type: "skip" } }
  ] });
  const quietPreview = await quiet.planner.preview({
    groupActorId: "group-a",
    rows: [
      row("folder", { sourceType: "gear", sourceId: "1", documentType: "loot", durabilityState: "ineligible" }),
      row("legacy", { sourceType: "gear", sourceId: "2", documentType: "loot", durabilityState: "ineligible" }),
      row("skip", { sourceType: "gear", sourceId: "3", documentType: "loot", durabilityState: "ineligible" })
    ],
    batch: true
  });
  assert.deepEqual(await quiet.planner.collectChoices(quietPreview), { rootOverrideSourceKeys: [] });
  assert.equal(quiet.calls.confirm, 0);

  const single = createHarness({
    decisions: [{ ruleId: "skip", action: { type: "skip" } }],
    confirmation: { rootOverrideSourceKeys: ["single"] }
  });
  const singlePreview = await single.planner.preview({
    groupActorId: "group-a",
    rows: [row("single", { sourceType: "gear", sourceId: "1", documentType: "loot", durabilityState: "ineligible" })]
  });
  assert.deepEqual(await single.planner.collectChoices(singlePreview), {
    rootOverrideSourceKeys: ["single"]
  });
  assert.equal(single.calls.confirm, 1);

  const dismantle = createHarness({
    decisions: [
      { ruleId: "d1", action: { type: "dismantle" } },
      { ruleId: "d2", action: { type: "dismantle" } }
    ],
    confirmation: { rootOverrideSourceKeys: ["second"] }
  });
  const dismantlePreview = await dismantle.planner.preview({
    groupActorId: "group-a",
    rows: [
      row("first", { sourceType: "gear", sourceId: "1", documentType: "weapon", durabilityState: "broken" }),
      row("second", { sourceType: "gear", sourceId: "2", documentType: "weapon", durabilityState: "broken" })
    ],
    batch: true
  });
  assert.deepEqual(await dismantle.planner.collectChoices(dismantlePreview), {
    rootOverrideSourceKeys: ["second"]
  });
  assert.equal(dismantle.calls.confirm, 1);
});

test("collectChoices preserves cancel and rejects overrides for non-actionable rows", async () => {
  const cancelled = createHarness({
    decisions: [{ ruleId: "skip", action: { type: "skip" } }],
    confirmation: null
  });
  const preview = await cancelled.planner.preview({
    groupActorId: "group-a",
    rows: [row("skip", { sourceType: "gear", sourceId: "1", documentType: "loot", durabilityState: "ineligible" })]
  });
  assert.equal(await cancelled.planner.collectChoices(preview), null);

  const invalid = createHarness({
    decisions: [{ ruleId: "folder", action: { type: "folder", folderId: "weapons" } }],
    confirmation: { rootOverrideSourceKeys: ["folder"] }
  });
  const invalidPreview = await invalid.planner.preview({
    groupActorId: "group-a",
    rows: [row("folder", { sourceType: "gear", sourceId: "2", documentType: "loot", durabilityState: "ineligible" })]
  });
  assert.throws(
    () => invalid.planner.serialize(invalidPreview, { rootOverrideSourceKeys: ["folder"] }),
    (error) => error instanceof InventoryIngressPlanError && error.code === "invalid-root-override"
  );
});

test("serialize strips ItemData and material authority while preserving exact expectations", async () => {
  const { planner } = createHarness({
    decisions: [{ ruleId: "dismantle", action: { type: "dismantle" } }]
  });
  const preview = await planner.preview({
    groupActorId: "group-a",
    requestedFolderId: "requested",
    rows: [row("source", {
      sourceType: "gear",
      sourceId: "sword",
      documentType: "weapon",
      durabilityState: "broken"
    }, { quantity: 2 })]
  });

  const serialized = planner.serialize(preview, { rootOverrideSourceKeys: ["source"] });

  assert.deepEqual(serialized, {
    version: 1,
    groupActorId: "group-a",
    rulesRevision: 7,
    requestedFolderId: "requested",
    rows: [{
      sourceKey: "source",
      identity: {
        sourceType: "gear",
        sourceId: "sword",
        documentType: "weapon",
        durabilityState: "broken",
        quantity: 2
      },
      quantity: 2,
      matchedRuleId: "dismantle",
      action: { type: "dismantle" }
    }],
    rootOverrideSourceKeys: ["source"]
  });
  assert.equal(JSON.stringify(serialized).includes("Железо"), false);
  assert.equal(JSON.stringify(serialized).includes("itemData"), false);
  assert.equal(Object.isFrozen(serialized), true);
});

test("assertParity accepts the same authoritative preview and rejects every stale authority field", async () => {
  const { planner } = createHarness({ decisions: [
    { ruleId: "folder", action: { type: "folder", folderId: "weapons" } }
  ] });
  const request = {
    groupActorId: "group-a",
    requestedFolderId: "requested",
    rows: [row("source", {
      sourceType: "gear",
      sourceId: "sword",
      documentType: "weapon",
      durabilityState: "intact"
    })]
  };
  const preview = await planner.preview(request);
  const serialized = planner.serialize(preview);
  const authoritative = await planner.preview(request);

  assert.equal(planner.assertParity(serialized, authoritative), true);
  const mutations = [
    { ...serialized, rulesRevision: 8 },
    { ...serialized, requestedFolderId: null },
    { ...serialized, rows: [{ ...serialized.rows[0], sourceKey: "other" }] },
    { ...serialized, rows: [{ ...serialized.rows[0], identity: { ...serialized.rows[0].identity, sourceId: "axe" } }] },
    { ...serialized, rows: [{ ...serialized.rows[0], matchedRuleId: "other" }] },
    { ...serialized, rows: [{ ...serialized.rows[0], action: { type: "folder", folderId: "other" } }] }
  ];
  for (const stale of mutations) {
    assert.throws(
      () => planner.assertParity(stale, authoritative),
      (error) => error instanceof InventoryIngressPlanError && error.code === "plan-stale"
    );
  }
});

test("preview rejects non-exact rows and duplicate source keys before reading rules", async () => {
  const { calls, planner } = createHarness();
  await assert.rejects(
    planner.preview({
      groupActorId: "group-a",
      rows: [{ ...row("source", {}), extra: true }]
    }),
    (error) => error instanceof InventoryIngressPlanError && error.code === "invalid-row"
  );
  await assert.rejects(
    planner.preview({
      groupActorId: "group-a",
      rows: [row("same", {}), row("same", {})]
    }),
    (error) => error instanceof InventoryIngressPlanError && error.code === "duplicate-source-key"
  );
  assert.equal(calls.readRules, 0);
});

test("preview awaits asynchronous descriptor and dismantle adapters", async () => {
  const planner = new InventoryIngressPlanner({
    readRules: async () => ({ version: 1, revision: 1, rules: [] }),
    buildDescriptor: async (itemData) => itemData.descriptor,
    resolveDismantleOutputs: async (_itemData, quantity) => [{
      sourceType: "material",
      sourceId: "iron",
      name: "Iron",
      quantity
    }],
    compilerCache: {
      get: () => ({
        evaluateMany: () => [{ ruleId: "dismantle", action: { type: "dismantle" } }]
      })
    },
    confirm: async () => ({ rootOverrideSourceKeys: [] })
  });

  const preview = await planner.preview({
    groupActorId: "group-a",
    rows: [row("async-row", {
      sourceType: "gear",
      sourceId: "sword",
      documentType: "weapon",
      durabilityState: "intact"
    })]
  });

  assert.equal(preview.rows[0].identity.sourceId, "sword");
  assert.equal(preview.rows[0].dismantlePreview[0].sourceId, "iron");
});
