import test from "node:test";
import assert from "node:assert/strict";
import { resolveMagicArmorProfile } from "../scripts/data/magic-armor-profile.js";

const gear = [
  { id: "shirt", name: "Кольчужная рубаха", armor: { type: "medium", baseItem: "chainshirt", value: 13, dex: 2 } },
  { id: "mail", name: "Кольчуга", armor: { type: "heavy", baseItem: "chainmail", value: 16 } }
];

test("Elven Chain uses chain shirt, not the legacy subtype chain mail", () => {
  const item = { id: "эльфийская-кольчуга", itemSubtype: "Кольчуга" };
  assert.deepEqual(resolveMagicArmorProfile(item, gear), { gearId: "shirt", type: "medium", baseItem: "chainshirt",
    armor: { value: 13, dex: 2 }, strength: 0, properties: [] });
});

test("other armor and an explicit user-selected base retain their original meaning", () => {
  assert.equal(resolveMagicArmorProfile({ id: "other", itemSubtype: "Кольчуга" }, gear).baseItem, "chainmail");
  assert.equal(resolveMagicArmorProfile({ id: "эльфийская-кольчуга", itemSubtype: "Кольчуга",
    flags: { "rebreya-main": { magicEquipmentGearId: "mail" } } }, gear).baseItem, "chainmail");
});
