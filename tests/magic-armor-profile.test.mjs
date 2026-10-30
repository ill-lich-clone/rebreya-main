import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeMagicItems, createMagicItemData } from "../scripts/data/magic-items-compendium.js";
import { buildMagicItemAutomationProjection, buildEmbeddedMagicItemPatch } from "../scripts/data/magic-item-embedded-sync.js";

globalThis.CONST ??= { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
const gear = JSON.parse(await readFile(new URL("../data/gear.json", import.meta.url), "utf8"));
function create(subtype, bonus = 0) {
  const [row] = normalizeMagicItems([{ id: bonus ? `доспех-${bonus}` : "test-armor", name: "Проверяемый доспех", itemType: "Доспех", itemSubtype: subtype }]);
  return createMagicItemData(row, new Map(), null, { gear });
}

for (const [subtype, value, dex, strength, type] of [
  ["Кираса", 14, 2, 0, "medium"], ["Кольчуга", 16, null, 0, "heavy"],
  ["Латы", 18, null, 15, "heavy"], ["Проклёпанный кожаный доспех", 12, null, 0, "light"],
  ["Щит", 2, null, 0, "shield"], ["Баклер", 1, null, 0, "shield"]
]) test(`magic armor ${subtype} receives the canonical base profile`, () => {
  const data = create(subtype, 2);
  assert.equal(data.system.armor?.value, value);
  assert.equal(data.system.armor.dex, dex);
  assert.equal(data.system.armor.magicalBonus, 2);
  assert.equal(data.system.strength, strength);
  assert.equal(data.system.type.value, type);
  assert.ok(data.system.properties.includes("mgc"));
  if (subtype === "Латы") assert.ok(data.system.properties.includes("stealthDisadvantage"));
});

test("ambiguous armor templates do not invent a concrete armor class", () => {
  for (const subtype of ["Любой", "Лёгкий", "Средний, Тяжёлый", "Тяжёлый"]) {
    assert.equal(create(subtype).system.armor?.value, undefined);
  }
});

test("owned zero armor is repaired without replacing manual AC, resources, or a selected base", () => {
  const projection = buildMagicItemAutomationProjection(create("Кираса", 2));
  const source = {
    _id: "ownedArmor", type: "equipment", name: "Моя броня", effects: [],
    system: { type: { value: "medium", baseItem: "breastplate" }, armor: { value: 0, magicalBonus: 2 }, quantity: 3, description: { value: "Мой текст" }, activities: {} },
    flags: { "rebreya-main": { magicItemId: "доспех-2" } }
  };
  const resolution = { status: "resolved", magicItemId: "доспех-2" };
  const before = structuredClone(source);
  const repaired = buildEmbeddedMagicItemPatch(source, projection, resolution);
  assert.equal(repaired.update.system.armor?.value, 14);
  assert.equal(repaired.update.system.armor.magicalBonus, undefined);
  assert.equal(repaired.update.system.quantity, undefined);
  assert.equal(repaired.update.system.description, undefined);
  assert.deepEqual(source, before);
  const manual = structuredClone(source);
  manual.system.armor.value = 19;
  assert.equal(buildEmbeddedMagicItemPatch(manual, projection, resolution).update?.system.armor, undefined);
  const selected = structuredClone(source);
  selected.flags["rebreya-main"].magicEquipmentGearId = "laty";
  const selectedResolution = { ...resolution, armorProfile: { gearId: "laty", type: "heavy", armor: { value: 18, dex: null }, strength: 15, properties: ["stealthDisadvantage"] } };
  assert.equal(buildEmbeddedMagicItemPatch(selected, projection, selectedResolution).update.system.armor.value, 18);
});
