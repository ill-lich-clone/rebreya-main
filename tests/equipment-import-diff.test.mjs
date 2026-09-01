import test from "node:test";
import assert from "node:assert/strict";

import {
  diffEquipmentBundles,
  evaluateDestructiveGuards,
  formatEquipmentDiffReport
} from "../tools/equipment-import/diff.mjs";

const catalogNames = ["gear", "upgrades", "materials", "implants", "transport", "magicItems"];

function entry(catalog, id, index = 1, overrides = {}) {
  const common = { name: `${catalog}-${index}`, ...overrides };
  switch (catalog) {
    case "gear": return { id, sourceIdentity: `gear-source-${index}`, sourceRef: `Gear!A${index}`, rank: 1, ...common };
    case "upgrades": return { productId: id, canonicalName: common.name, upgrade: { sourceSheet: "Upgrades", sourceSheetRow: index, rank: 1 }, ...overrides };
    case "materials": return { id, source: { sheetName: "Materials", row: index }, rank: 1, ...common };
    case "implants": return { id, implant: { sourceSheet: "Implants", sourceSheetRow: index }, rank: 1, ...common };
    case "transport": return { sourceId: id, sourceRow: index, rank: "1", ...common };
    case "magicItems": return { id, rank: 1, ...common };
    default: throw new Error(`Unknown catalog ${catalog}`);
  }
}

function bundle(catalogOverrides = {}) {
  return {
    schemaVersion: 1,
    source: { spreadsheetId: "sheet", fingerprint: "f".repeat(64) },
    catalogs: Object.fromEntries(catalogNames.map((catalog) => [
      catalog,
      catalogOverrides[catalog] ?? [entry(catalog, `${catalog}-1`)]
    ])),
    diagnostics: []
  };
}

function gearRows(count, { start = 1 } = {}) {
  return Array.from({ length: count }, (_, offset) => entry("gear", `gear-${start + offset}`, start + offset));
}

test("identical bundles yield only unchanged records", () => {
  const current = bundle();
  const diff = diffEquipmentBundles({ currentBundle: current, nextBundle: structuredClone(current) });
  for (const catalog of catalogNames) {
    assert.equal(diff.catalogs[catalog].added.length, 0);
    assert.equal(diff.catalogs[catalog].changed.length, 0);
    assert.equal(diff.catalogs[catalog].removed.length, 0);
    assert.equal(diff.catalogs[catalog].identityChurn.length, 0);
    assert.equal(diff.catalogs[catalog].unchanged.length, 1);
  }
});

test("field edits are changed records with stable field paths", () => {
  const current = bundle();
  const next = structuredClone(current);
  next.catalogs.gear[0].rank = 2;
  next.catalogs.gear[0].weapon = { damageFormula: "1d8", properties: ["fin"] };

  const diff = diffEquipmentBundles({ currentBundle: current, nextBundle: next });
  assert.deepEqual(diff.catalogs.gear.changed, [{
    id: "gear-1",
    name: "gear-1",
    sourceIdentity: "gear-source-1",
    fields: ["rank", "weapon"]
  }]);
  assert.equal(diff.catalogs.gear.added.length, 0);
  assert.equal(diff.catalogs.gear.removed.length, 0);
});

test("same source moving to another stable ID is identity churn and always blocks", () => {
  const current = bundle();
  const next = structuredClone(current);
  next.catalogs.gear[0].id = "gear-renumbered";
  const diff = diffEquipmentBundles({ currentBundle: current, nextBundle: next });

  assert.deepEqual(diff.catalogs.gear.identityChurn, [{
    sourceIdentity: "gear-source-1",
    previousId: "gear-1",
    nextId: "gear-renumbered",
    name: "gear-1"
  }]);
  assert.equal(diff.catalogs.gear.added.length, 0);
  assert.equal(diff.catalogs.gear.removed.length, 0);
  assert.throws(
    () => evaluateDestructiveGuards({ diff, flags: { allowRemovals: true, allowLargeDiff: true }, sourceSummary: {} }),
    (error) => error.blockers?.some((blocker) => blocker.code === "identity-churn")
  );
});

test("material row movement does not masquerade as stable identity churn", () => {
  const current = bundle({ materials: [
    entry("materials", "zhelezo", 10, { name: "Железо" }),
    entry("materials", "stal", 11, { name: "Сталь" })
  ] });
  const next = bundle({ materials: [
    entry("materials", "zhelezo", 11, { name: "Железо" }),
    entry("materials", "stal", 10, { name: "Сталь" })
  ] });
  const diff = diffEquipmentBundles({ currentBundle: current, nextBundle: next });

  assert.equal(diff.catalogs.materials.identityChurn.length, 0);
  assert.deepEqual(diff.catalogs.materials.changed.map((entry) => entry.fields), [["source.row"], ["source.row"]]);
});

test("a removal requires allow-removals", () => {
  const current = bundle({ gear: gearRows(10) });
  const next = bundle({ gear: gearRows(9) });
  const diff = diffEquipmentBundles({ currentBundle: current, nextBundle: next });
  assert.throws(
    () => evaluateDestructiveGuards({ diff, flags: {}, sourceSummary: {} }),
    (error) => error.blockers?.some((blocker) => blocker.code === "removals-not-allowed")
  );
  assert.doesNotThrow(() => evaluateDestructiveGuards({ diff, flags: { allowRemovals: true }, sourceSummary: {} }));
});

test("large removal thresholds use more than 10 percent or more than 25 records", () => {
  for (const [previous, removed] of [[100, 11], [400, 26]]) {
    const current = bundle({ gear: gearRows(previous) });
    const next = bundle({ gear: gearRows(previous - removed) });
    const diff = diffEquipmentBundles({ currentBundle: current, nextBundle: next });
    assert.throws(
      () => evaluateDestructiveGuards({ diff, flags: { allowRemovals: true }, sourceSummary: {} }),
      (error) => error.blockers?.some((blocker) => blocker.code === "large-removal")
    );
    assert.doesNotThrow(() => evaluateDestructiveGuards({
      diff, flags: { allowRemovals: true, allowLargeDiff: true }, sourceSummary: {}
    }));
  }

  const exact = diffEquipmentBundles({
    currentBundle: bundle({ gear: gearRows(100) }),
    nextBundle: bundle({ gear: gearRows(90) })
  });
  assert.doesNotThrow(() => evaluateDestructiveGuards({
    diff: exact, flags: { allowRemovals: true }, sourceSummary: {}
  }));
});

test("empty required catalogs and loss over half always block", () => {
  for (const nextGear of [[], gearRows(4)]) {
    const diff = diffEquipmentBundles({
      currentBundle: bundle({ gear: gearRows(10) }),
      nextBundle: bundle({ gear: nextGear })
    });
    assert.throws(
      () => evaluateDestructiveGuards({
        diff, flags: { allowRemovals: true, allowLargeDiff: true }, sourceSummary: { catalogs: { gear: { rows: nextGear.length } } }
      }),
      (error) => error.blockers?.some((blocker) => blocker.code === "catastrophic-removal" || blocker.code === "empty-source-catalog")
    );
  }
});

test("diff report is deterministic and never prints credential content", () => {
  const current = bundle({ gear: gearRows(3) });
  const next = bundle({ gear: [entry("gear", "gear-1", 1, { rank: 2 }), entry("gear", "gear-4", 4)] });
  const diff = diffEquipmentBundles({ currentBundle: current, nextBundle: next });
  const sourceSummary = { spreadsheetId: "sheet", credential: "PRIVATE_SECRET", catalogs: { gear: { rows: 2 } } };
  const first = formatEquipmentDiffReport({ diff, sourceSummary, mode: "dry-run" });
  const second = formatEquipmentDiffReport({ diff, sourceSummary: structuredClone(sourceSummary), mode: "dry-run" });

  assert.equal(first, second);
  assert.match(first, /^Equipment import dry-run/u);
  assert.match(first, /gear: \+1 ~1 =0 -2/u);
  assert.match(first, /gear-1 \[rank\]/u);
  assert.doesNotMatch(first, /PRIVATE_SECRET/u);
  assert.ok(first.indexOf("gear:") < first.indexOf("materials:"));
});
