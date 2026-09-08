import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { SIMPLE_UPGRADE_PROFILES } from "../scripts/automation/item-upgrade-projections.js";
const decisions = JSON.parse(await readFile(new URL("../data/upgrade-automation-manifest.json", import.meta.url)));
test("every implemented simple profile has an executable projection and existing owner/tests", async () => {
  const implemented = decisions.filter(r => r.decision === "simple-implemented");
  assert.deepEqual(implemented.map(r => r.productId).sort(), Object.keys(SIMPLE_UPGRADE_PROFILES).sort());
  assert.equal(decisions.filter(r => r.decision === "existing-curse").length, 11);
  for (const row of implemented) {
    assert.ok(["carried", "equipped", "held", "attuned"].includes(row.activation));
    assert.equal(typeof row.worksWhenBroken, "boolean"); assert.ok(row.stacking);
    for (const path of [...row.owner, ...row.tests.filter(t => t.status === "existing").map(t => t.path)]) await access(new URL(`../${path}`, import.meta.url));
  }
});
