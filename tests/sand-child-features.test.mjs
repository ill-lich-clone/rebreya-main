import test from "node:test";
import assert from "node:assert/strict";
import { SAND_CHILD_FEATURE_IDS, buildSandChildItemPatch, sandChildFeatureKind } from "../scripts/data/sand-child-features.js";

test("repairs the legacy Sand Child item in place", () => {
  const flags = { "rebreya-main": { featureId: SAND_CHILD_FEATURE_IDS.manifestation } };
  const item = { id: "owned", name: "Проявление духов", flags, system: { uses: { spent: 1 } } };
  const profile = { max: "@prof", recovery: [{ period: "lr", type: "recoverAll", formula: "" }] };
  const source = { flags, system: { description: { value: "Current" }, activities: { sand: { activation: { type: "bonus" } } }, uses: profile } };
  assert.equal(sandChildFeatureKind(item), "manifestation");
  const patch = buildSandChildItemPatch(item, source);
  assert.deepEqual(patch, {
    "system.description.value": "Current", "system.activities.sand": source.system.activities.sand,
    "system.uses.max": "@prof", "system.uses.recovery": profile.recovery
  });
  assert.equal(buildSandChildItemPatch({ ...item, system: { ...source.system, uses: { ...profile, spent: 1 } } }, source), null);
  assert.equal(buildSandChildItemPatch({ ...item, flags: {} }, source), null);
  assert.equal(sandChildFeatureKind({ flags: { "rebreya-main": { featureId: SAND_CHILD_FEATURE_IDS.ancestralArt } } }), "ancestralArt");
});
