import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildUpgradeAutomationManifest, getUpgradeAvailability } from "../scripts/data/upgrade-automation-manifest.js";
const read = async name => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url)));
const [upgrades, gear, decisions] = await Promise.all([read("upgrades"), read("gear"), read("upgrade-automation-manifest")]);
test("all 91 stable IDs have one explicit, source-backed decision", () => {
  const rows = buildUpgradeAutomationManifest(upgrades, gear, decisions);
  assert.equal(rows.length, 91);
  assert.equal(new Set(rows.map(r => r.productId)).size, 91);
  assert.equal(rows.filter(r => r.decision === "existing-curse").length, 11);
  assert.ok(rows.every(r => r.gearId === r.productId && r.reason && r.ruleSource.productId === r.productId));
  assert.deepEqual(rows.map(r => r.productId), rows.map(r => r.productId).sort());
  assert.ok(rows.filter(r => r.decision === "simple-candidate").every(r => !getUpgradeAvailability(r.productId, rows).available));
  assert.equal(getUpgradeAvailability("unknown", rows).decision, "unavailable-no-rule");
  assert.equal(getUpgradeAvailability("absolyutnaya-pustota", rows).available, false);
});
test("missing, duplicate and orphan mappings fail explicitly without name matching", () => {
  for (const args of [[upgrades, gear, decisions.slice(1)], [upgrades, gear, [...decisions, decisions[0]]],
    [[...upgrades, upgrades[0]], gear, decisions], [upgrades, [...gear, gear[0]], decisions],
    [upgrades, gear.filter(g => g.id !== upgrades[0].productId), decisions],
    [upgrades, gear, [...decisions, { ...decisions[0], productId: "orphan" }]]]) {
    assert.throws(() => buildUpgradeAutomationManifest(...args), /upgrade-manifest/);
  }
});
test("build is detached and validates decisions and implemented evidence", () => {
  const before = JSON.stringify({ upgrades, gear, decisions });
  const rows = buildUpgradeAutomationManifest(upgrades, gear, decisions);
  rows[0].profile.compatibility.push("test");
  assert.equal(JSON.stringify({ upgrades, gear, decisions }), before);
  assert.throws(() => buildUpgradeAutomationManifest(upgrades, gear, decisions.map((r, i) => i ? r : { ...r, decision: "working" })), /upgrade-manifest/);
  assert.throws(() => buildUpgradeAutomationManifest(upgrades, gear, decisions.map((r, i) => i ? r : {
    ...r, decision: "simple-implemented", tests: [{ path: "tests/future.test.mjs", status: "planned-R7" }] })), /missing-evidence/);
});
