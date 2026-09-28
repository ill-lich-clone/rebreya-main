import test from "node:test";
import assert from "node:assert/strict";

import {
  buildActionReferenceAliases,
  getActionReferenceDefinitions
} from "../scripts/data/actions-compendium.js";

test("reaction action references expose an explicit alias without the decorative lightning marker", () => {
  assert.deepEqual(
    buildActionReferenceAliases("Провоцированные атаки ⚡"),
    ["Провоцированные атаки"]
  );
  assert.deepEqual(buildActionReferenceAliases("Атака"), []);
});

test("action reference definitions expose the same stable source identity used by managed items", () => {
  const opportunity = getActionReferenceDefinitions()
    .find((entry) => entry.canonicalName === "Провоцированные атаки ⚡");

  assert.equal(opportunity.sourceId, "glossary-opportunity-attack");
  assert.deepEqual(opportunity.aliases, ["Провоцированные атаки"]);
});
