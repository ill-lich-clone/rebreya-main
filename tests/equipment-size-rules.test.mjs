import test from "node:test";
import assert from "node:assert/strict";
import {
  getEquipmentSize, shiftEquipmentDamage, inferEquipmentSize,
  getEquipmentSizeMultipliers, getCreatureTokenFootprint, getWeaponSizeUse
} from "../scripts/data/equipment-size-rules.js";

const sizes = ["tiny", "sm", "med", "lg", "huge", "grg"];
const weapon = (size = "med", properties = []) => ({
  type: "weapon", system: { properties },
  flags: { "rebreya-main": { equipmentSize: { version: 1, size } } }
});

test("all 48 Lich damage table cells are preserved", () => {
  const rows = [
    ["1d2", ["0", "1", "1d2", "1d3", "1d4", "1d6"]],
    ["1d3", ["1", "1d2", "1d3", "1d4", "1d6", "1d8"]],
    ["1d4", ["1d2", "1d3", "1d4", "1d6", "1d8", "1d10"]],
    ["1d6", ["1d3", "1d4", "1d6", "1d8", "1d10", "1d12"]],
    ["1d8", ["1d4", "1d6", "1d8", "1d10", "1d12", "2d6"]],
    ["1d10", ["1d6", "1d8", "1d10", "1d12", "2d6", "2d8"]],
    ["1d12", ["1d8", "1d10", "1d12", "2d6", "2d8", "2d10"]],
    ["2d6", ["1d10", "1d12", "2d6", "2d8", "2d10", "2d12"]]
  ];
  for (const [medium, expected] of rows) {
    for (let index = 0; index < sizes.length; index++) {
      assert.deepEqual(shiftEquipmentDamage(medium, index - 2),
        { formula: expected[index], supported: true }, `${medium}/${sizes[index]}`);
    }
  }
});

test("damage ladder continues by doubling d6/d8/d10/d12 blocks and preserves flat riders", () => {
  for (const [source, steps, expected] of [
    ["2d12", 1, "4d6"], ["4d12", 1, "8d6"], ["8d6", -1, "4d12"],
    ["1", 1, "1d2"], ["1d2", -3, "0"], ["1d8 + 3", 1, "1d10 + 3"],
    ["1d8+@mod-2", 1, "1d10+@mod-2"], ["1к6", 1, "1d8"]
  ]) assert.deepEqual(shiftEquipmentDamage(source, steps), { formula: expected, supported: true });
  for (const formula of ["1d8+1d4+@mod", "3d6", "2d4", "@scale.weapon", "special"]) {
    assert.deepEqual(shiftEquipmentDamage(formula, 2), { formula, supported: false });
  }
});

test("manual die edits infer owner size relative to the specific original weapon", () => {
  assert.equal(inferEquipmentSize("1d8", "med", "1d10"), "lg");
  assert.equal(inferEquipmentSize("1d6", "med", "1d8"), "lg");
  assert.equal(inferEquipmentSize("1d8", "med", "1d8"), "med");
  assert.equal(inferEquipmentSize("1d8", "med", "1d4"), "tiny");
  assert.equal(inferEquipmentSize("1d8", "med", "4d6"), null);
  assert.equal(inferEquipmentSize("1d8", "med", "1d8+1d4"), null);
  assert.equal(inferEquipmentSize("1d2", "med", "0"), "tiny");
  assert.equal(inferEquipmentSize("1", "med", "0"), null, "clamped categories are ambiguous");
});

test("price and weight multipliers implement the plate example without rounding", () => {
  const hugePlate = getEquipmentSizeMultipliers("med", "grg");
  assert.equal(1500 * hugePlate.price, 5062.5);
  assert.equal(65 * hugePlate.weight, 520);
  assert.deepEqual(getEquipmentSizeMultipliers("med", "sm"), { price: 1 / 1.5, weight: 0.5 });
  assert.deepEqual(getEquipmentSizeMultipliers("lg", "med"), { price: 1 / 1.5, weight: 0.5 });
  assert.throws(() => getEquipmentSizeMultipliers("bogus", "lg"));
});

test("six actor categories have native token footprints, including Small and Medium sharing one cell", () => {
  const expected = [0.5, 1, 1, 2, 3, 4];
  sizes.forEach((size, index) => assert.deepEqual(getCreatureTokenFootprint(size), {
    width: expected[index], height: expected[index]
  }));
});

test("all 36 actor/weapon pairs respect the Small/Medium exception and heavy exclusion", () => {
  const allowed = [
    [true, false, false, false, false, false],
    [true, true, true, false, false, false],
    [true, true, true, false, false, false],
    [true, true, true, true, false, false],
    [true, true, true, true, true, false],
    [true, true, true, true, true, true]
  ];
  sizes.forEach((actorSize, row) => sizes.forEach((weaponSize, column) => {
    const actor = { system: { traits: { size: actorSize } } };
    const item = weapon(weaponSize);
    const before = structuredClone(item);
    assert.equal(getWeaponSizeUse(actor, item).improvised, !allowed[row][column], `${actorSize}/${weaponSize}`);
    assert.deepEqual(item, before);
  }));
  const small = { system: { traits: { size: "sm" } } };
  assert.equal(getWeaponSizeUse(small, weapon("med", ["hvy"])).improvised, true);
  assert.equal(getWeaponSizeUse(small, weapon("med", new Set(["hvy"])) ).improvised, true);
  assert.equal(getWeaponSizeUse({}, weapon("lg")).improvised, true);
});

test("unmarked and invalid legacy size flags safely default to Medium", () => {
  assert.equal(getEquipmentSize({}), "med");
  assert.equal(getEquipmentSize(weapon("lg")), "lg");
  assert.equal(getEquipmentSize(weapon("bogus")), "med");
});
