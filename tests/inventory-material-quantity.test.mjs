import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/constants.js";
import {
  isInventoryMaterialItemData, readInventoryItemQuantity, readInventoryItemUnitWeight,
  readInventoryItemUnitPrice, withInventoryItemQuantity, buildInventoryItemQuantityPatch,
  normalizeInventoryMaterialProjection, inventoryMaterialQuantitiesMatch,
  captureInventoryItemQuantityState, buildInventoryItemQuantityRestorePatch
} from "../scripts/data/inventory-material-quantity.js";

function material({ quantity = 1, weight = 10, price = 500 } = {}) {
  return {
    name: "Адамантин", type: "loot",
    system: { quantity, weight: { value: weight, units: "lb" }, price: { value: price, denomination: "gp" } },
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "material-168", materialId: "material-168" } }
  };
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) <= 1e-8 * Math.max(1, expected), `${actual} != ${expected}`);
}

test("half-pound adamant scrap preserves fractional quantity, mass and proportional value", () => {
  const source = material();
  const before = structuredClone(source);
  const scrap = withInventoryItemQuantity(source, 0.05);
  assert.deepEqual(source, before);
  assert.equal(scrap.system.quantity, 1);
  assert.equal(scrap.system.weight.value, 0.5);
  assert.equal(scrap.system.price.value, 25);
  assert.equal(readInventoryItemQuantity(scrap), 0.05);
  assert.equal(readInventoryItemUnitWeight(scrap), 10);
  assert.deepEqual(readInventoryItemUnitPrice(scrap), { value: 500, denomination: "gp" });
});

test("merge, split and repeated writes conserve the material's canonical unit", () => {
  let scrap = withInventoryItemQuantity(material(), 0.05);
  const merged = withInventoryItemQuantity(scrap, 1.05);
  assert.equal(merged.system.quantity, 2);
  near(merged.system.quantity * merged.system.weight.value, 10.5);
  near(merged.system.quantity * merged.system.price.value, 525);
  const left = withInventoryItemQuantity(merged, 0.02);
  const right = withInventoryItemQuantity(merged, 0.03);
  near(left.system.quantity * left.system.weight.value + right.system.quantity * right.system.weight.value, 0.5);
  near(left.system.quantity * left.system.price.value + right.system.quantity * right.system.price.value, 25);
  for (let i = 0; i < 100; i++) {
    scrap = withInventoryItemQuantity(scrap, i % 2 ? 0.05 : 1.05);
  }
  near(scrap.system.quantity * scrap.system.weight.value, 0.5);
  near(scrap.system.quantity * scrap.system.price.value, 25);
  assert.equal(readInventoryItemUnitWeight(scrap), 10);
});

test("half-pound outputs stay half a pound for light and very heavy catalog units", () => {
  for (const weight of [0.5, 1, 10, 450, 630]) {
    const scrap = withInventoryItemQuantity(material({ weight, price: 100 }), 0.5 / weight);
    assert.equal(Number.isSafeInteger(scrap.system.quantity), true);
    near(scrap.system.quantity * scrap.system.weight.value, 0.5);
    near(scrap.system.quantity * scrap.system.price.value, 100 * 0.5 / weight);
  }
});

test("zero depletion restores canonical piece properties and native edits count real pieces", () => {
  const scrap = withInventoryItemQuantity(material(), 0.05);
  const empty = withInventoryItemQuantity(scrap, 0);
  assert.equal(empty.system.quantity, 0);
  assert.equal(empty.system.weight.value, 10);
  assert.equal(empty.system.price.value, 500);
  assert.equal(readInventoryItemQuantity(empty), 0);
  const twoPieces = structuredClone(scrap);
  twoPieces.system.quantity = 2;
  assert.equal(readInventoryItemQuantity(twoPieces), 0.1);
  assert.equal(twoPieces.system.quantity * twoPieces.system.weight.value, 1);
});

test("ordinary gear and unflagged catalog materials keep their quantity contract", () => {
  const gear = material({ quantity: 3, weight: 4, price: 15 });
  gear.type = "weapon";
  gear.flags[MODULE_ID] = { sourceType: "gear", gearId: "sword", predominantMaterialId: "iron" };
  assert.equal(isInventoryMaterialItemData(gear), false);
  assert.equal(isInventoryMaterialItemData(material()), true);
  assert.deepEqual(buildInventoryItemQuantityPatch(gear, 2), { "system.quantity": 2 });
  assert.equal(readInventoryItemQuantity(gear), 3);
  assert.equal(readInventoryItemQuantity(material({ quantity: 8 })), 8);
  const compendium = material();
  compendium.flags[MODULE_ID] = { managed: true, materialId: "material-168" };
  assert.equal(isInventoryMaterialItemData(compendium), true);
});

test("atomic quantity patches and exact recovery preserve weight units and missing flag", () => {
  const source = material();
  const state = captureInventoryItemQuantityState(source);
  assert.deepEqual(state, { quantity: 1, weight: source.system.weight, price: source.system.price, materialQuantityFlag: null });
  const patch = buildInventoryItemQuantityPatch(source, 0.05);
  assert.equal(patch["system.quantity"], 1);
  assert.equal(patch["system.weight.value"], 0.5);
  assert.equal(patch["system.price.value"], 25);
  assert.equal(patch[`flags.${MODULE_ID}.materialQuantity`].unitsPerItem, 0.05);
  const restore = buildInventoryItemQuantityRestorePatch(state);
  assert.equal(restore[`flags.${MODULE_ID}.-=materialQuantity`], null);
  assert.deepEqual(restore["system.weight"], source.system.weight);
  assert.deepEqual(restore["system.price"], source.system.price);
  state.weight.value = 123;
  assert.equal(source.system.weight.value, 10);
  const scrap = withInventoryItemQuantity(source, 0.05);
  const scrapState = captureInventoryItemQuantityState(scrap);
  assert.deepEqual(buildInventoryItemQuantityRestorePatch(scrapState)[`flags.${MODULE_ID}.materialQuantity`], scrap.flags[MODULE_ID].materialQuantity);
});

test("canonical projections ignore piece density but preserve authored unit differences", () => {
  const a = normalizeInventoryMaterialProjection(withInventoryItemQuantity(material(), 0.05));
  const b = normalizeInventoryMaterialProjection(withInventoryItemQuantity(material(), 1.05));
  assert.deepEqual(a.system.weight, b.system.weight);
  assert.deepEqual(a.system.price, b.system.price);
  assert.equal(a.system.quantity, 0.05);
  assert.equal(Object.hasOwn(a.flags[MODULE_ID], "materialQuantity"), false);
  const changedWeight = normalizeInventoryMaterialProjection(withInventoryItemQuantity(material({ weight: 12 }), 0.05));
  const changedPrice = normalizeInventoryMaterialProjection(withInventoryItemQuantity(material({ price: 600 }), 0.05));
  assert.notDeepEqual(a.system.weight, changedWeight.system.weight);
  assert.notDeepEqual(a.system.price, changedPrice.system.price);
});

test("material precision distinguishes adjacent quantum without ceil drift", () => {
  assert.equal(inventoryMaterialQuantitiesMatch(0, 1e-12), false);
  assert.equal(inventoryMaterialQuantitiesMatch(0.1 + 0.2, 0.3), true);
  assert.equal(withInventoryItemQuantity(material(), 1 + 1e-14).system.quantity, 1);
  const tiny = withInventoryItemQuantity(material(), 1e-12);
  assert.equal(readInventoryItemQuantity(tiny), 1e-12);
  assert.throws(() => withInventoryItemQuantity(material(), 1e-14), /quantity|represent|количеств/iu);
});

test("material adapter rejects invalid quantities, metadata and inconsistent piece values", () => {
  for (const quantity of [-1, NaN, Infinity]) assert.throws(() => withInventoryItemQuantity(material(), quantity));
  const valid = withInventoryItemQuantity(material(), 0.05);
  for (const change of [{ version: 2 }, { unitsPerItem: 0 }, { unitsPerItem: 1.5 }, { unitWeightLb: 0 }, { unitPriceDenomination: "xyz" }]) {
    const item = structuredClone(valid);
    Object.assign(item.flags[MODULE_ID].materialQuantity, change);
    assert.throws(() => readInventoryItemQuantity(item));
    assert.throws(() => withInventoryItemQuantity(item, 0.1));
  }
  const changed = structuredClone(valid);
  changed.system.weight.value = 1;
  assert.throws(() => readInventoryItemQuantity(changed));
});

test("legacy material weight units survive exact rollback and project into pounds", () => {
  const source = material({ weight: 1, price: 10 });
  source.system.weight.units = "kg";
  const scrap = withInventoryItemQuantity(source, 0.5);
  near(scrap.system.quantity * scrap.system.weight.value, 1.10231);
  assert.equal(scrap.system.weight.units, "lb");
  assert.deepEqual(buildInventoryItemQuantityRestorePatch(captureInventoryItemQuantityState(source))["system.weight"], { value: 1, units: "kg" });
});
