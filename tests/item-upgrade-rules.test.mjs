import test from "node:test";
import assert from "node:assert/strict";
import { resolveUpgradeProfile, validateUpgradeInstallation, evaluateUpgradeActivation, validateUpgradeCapacity } from "../scripts/data/item-upgrade-rules.js";
const host = { id: "h", compatibilityTags: ["weapon", "melee"], capacity: 2, quantity: 1 };
const candidate = { sourceId: "u", profile: { compatibility: ["weapon"] }, availability: "simple-implemented" };
test("stored profile wins without mutating or merging catalog rules", () => {
  const stored = { type: "Материал", compatibility: ["weapon"], effect: "Авторское правило" };
  const result = resolveUpgradeProfile(stored, { type: "Зачарование", activation: "equipped" });
  assert.deepEqual(result, stored);
  result.compatibility.push("armor");
  assert.deepEqual(stored.compatibility, ["weapon"]);
  assert.deepEqual(resolveUpgradeProfile(null, candidate.profile), candidate.profile);
});
test("availability, host quantity, compatibility and slots are checked", () => {
  assert.deepEqual(validateUpgradeInstallation(host, [], candidate), { allowed: true, slotIndex: 1 });
  assert.equal(validateUpgradeInstallation(host, [{ slotIndex: 1 }], candidate).slotIndex, 2);
  for (const [h, entries, c, code] of [
    [host, [], { ...candidate, availability: "simple-candidate" }, "unavailable"],
    [{ ...host, quantity: 2 }, [], candidate, "invalid-quantity"],
    [{ ...host, quantity: 0 }, [], candidate, "invalid-quantity"],
    [{ ...host, compatibilityTags: ["armor"] }, [], candidate, "incompatible"],
    [host, [], { ...candidate, profile: { compatibility: ["weapon", "ranged"] } }, "incompatible"],
    [host, [{ slotIndex: 1 }], { ...candidate, slotIndex: 1 }, "slot-conflict"],
    [host, [], { ...candidate, slotIndex: 3 }, "capacity"],
    [host, [], { ...candidate, slotIndex: 1.5 }, "capacity"],
    [host, [], { ...candidate, profile: {} }, "incompatible"],
    [host, [{ slotIndex: 1 }, { slotIndex: 1 }], candidate, "slot-conflict"]
  ]) assert.throws(() => validateUpgradeInstallation(h, entries, c), e => e.code === code);
});
test("shield alternatives differ from weapon qualifiers; unknown tags fail closed", () => {
  const c = { ...candidate, profile: { compatibility: ["outerwear", "shield"] } };
  assert.equal(validateUpgradeInstallation({ ...host, compatibilityTags: ["shield"] }, [], c).allowed, true);
  assert.throws(() => validateUpgradeInstallation(host, [], { ...candidate, profile: { compatibility: ["any", "unknown"] } }), e => e.code === "incompatible");
});
test("capacity respects occupied slot positions, integer bounds and singleton host", () => {
  assert.equal(validateUpgradeCapacity(host, [{ slotIndex: 2 }], 2), 2);
  for (const next of [1, 0, 4, 1.5, NaN]) assert.throws(() => validateUpgradeCapacity(host, [{ slotIndex: 2 }], next), e => e.code === "capacity");
});
test("activation requires an explicit supported policy and respects broken rule", () => {
  for (const [policy, field] of [["equipped", "isEquipped"], ["held", "isHeld"], ["attuned", "isAttuned"]]) {
    assert.equal(evaluateUpgradeActivation({ [field]: true }, {}, { activation: policy }).active, true);
    assert.equal(evaluateUpgradeActivation({}, {}, { activation: policy }).active, false);
  }
  assert.equal(evaluateUpgradeActivation({}, {}, { activation: "carried" }).active, true);
  assert.equal(evaluateUpgradeActivation({}, {}, {}).supported, false);
  assert.equal(evaluateUpgradeActivation({ isBroken: true }, {}, { activation: "equipped", worksWhenBroken: false }).active, false);
});
