import test from "node:test";
import assert from "node:assert/strict";
import { EquipmentSizeService } from "../scripts/application/equipment-size-service.js";
import { buildEquipmentSizeUpdate, registerEquipmentSizeItemHooks, isEquipmentSizeItem } from "../scripts/integrations/equipment-size.js";
import { makeEquipment, applyUpdate, damage } from "./helpers/equipment-size-fixture.mjs";

function resized(item, size, changes = {}) {
  const result = buildEquipmentSizeUpdate(item, { size, changes });
  applyUpdate(item, result.update);
  return result;
}

test("size projection scales base/versatile, own weight and price and exactly restores the instance", () => {
  const item = makeEquipment({ flags: { durability: { size: "tiny", hp: 12 }, custom: "keep" } });
  const original = item.toObject();
  resized(item, "lg");
  assert.equal(item.system.damage.base.denomination, 10);
  assert.equal(item.system.damage.versatile.denomination, 12);
  assert.equal(item.system.weight.value, 6);
  assert.deepEqual(item.system.price, { value: 22.5, denomination: "gp" });
  assert.equal(item.system.quantity, 3);
  assert.deepEqual(item.flags["rebreya-main"].durability, original.flags["rebreya-main"].durability);
  resized(item, "med");
  assert.deepEqual(item.system, original.system);
  assert.equal(item.flags["rebreya-main"].custom, "keep");
});

test("Gargantuan plate implements 5062.5 gp and 520 lb; native units and denomination survive", () => {
  const plate = makeEquipment({ type: "equipment", system: {
    weight: { value: 65, units: "lb" }, price: { value: 1500, denomination: "gp" }
  } });
  resized(plate, "grg");
  assert.equal(plate.system.weight.value, 520);
  assert.equal(plate.system.price.value, 5062.5);
  const custom = makeEquipment({ system: { weight: { value: 1.3, units: "kg" }, price: { value: 50, denomination: "sp" } } });
  resized(custom, "sm"); resized(custom, "med");
  assert.deepEqual(custom.system.weight, { value: 1.3, units: "kg" });
  assert.deepEqual(custom.system.price, { value: 50, denomination: "sp" });
});

test("manual base die edits infer size and update weight, price and alternate damage without losing riders", () => {
  const item = makeEquipment();
  const changes = { "system.damage.base.denomination": 10, "system.damage.base.bonus": "3", "system.quantity": 7 };
  const { update } = buildEquipmentSizeUpdate(item, { changes, source: "edit" });
  applyUpdate(item, update);
  assert.equal(item.flags["rebreya-main"].equipmentSize.size, "lg");
  assert.equal(item.system.damage.base.bonus, "3");
  assert.equal(item.system.damage.versatile.denomination, 12);
  assert.equal(item.system.weight.value, 6);
  assert.equal(item.system.price.value, 22.5);
  assert.equal(item.system.quantity, 7);
  resized(item, "med");
  assert.equal(item.system.damage.base.denomination, 8);
  assert.equal(item.system.damage.base.bonus, "3");
});

test("custom formulas remain freely savable and become the current-size reference", () => {
  const item = makeEquipment();
  const custom = { ...damage(8), custom: { enabled: true, formula: "1d8 + 1d4 + @mod" } };
  const result = buildEquipmentSizeUpdate(item, { changes: { "system.damage.base": custom }, source: "edit" });
  applyUpdate(item, result.update);
  assert.equal(item.flags["rebreya-main"].equipmentSize.size, "med");
  assert.equal(item.system.damage.base.custom.formula, "1d8 + 1d4 + @mod");
  const scaled = resized(item, "lg");
  assert.equal(item.system.damage.base.custom.formula, "1d8 + 1d4 + @mod");
  assert.ok(scaled.diagnostics.some(row => row.code === "unsupported-size-damage"));
  assert.equal(item.system.weight.value, 6);
});

test("unchanged damage fields in a native full submit do not override an explicit size change", () => {
  const item = makeEquipment();
  resized(item, "lg", { "system.damage.base": structuredClone(item.system.damage.base) });
  assert.equal(item.system.damage.base.denomination, 10);
  const override = { ...damage(12), number: 2 };
  resized(item, "huge", { "system.damage.base": override });
  assert.equal(item.system.damage.base.number, 2);
  assert.equal(item.system.damage.base.denomination, 12);
  resized(item, "grg");
  assert.equal(item.system.damage.base.number, 4);
  assert.equal(item.system.damage.base.denomination, 6);
});

test("quantity-only edits do not create size flags; manual weight/price overrides survive later resizing", () => {
  const item = makeEquipment();
  assert.deepEqual(buildEquipmentSizeUpdate(item, { changes: { "system.quantity": 8 }, source: "edit" }).update,
    { "system.quantity": 8 });
  resized(item, "lg");
  applyUpdate(item, buildEquipmentSizeUpdate(item, {
    changes: { "system.price.value": 60, "system.weight.value": 10 }, source: "edit"
  }).update);
  resized(item, "med");
  assert.equal(item.system.price.value, 40);
  assert.equal(item.system.weight.value, 5);
});

test("two-hand versatile projection preserves one-hand reference and does not infer a spurious size", () => {
  const item = makeEquipment({ flags: { versatileBaseDamageOriginal: damage(8), heldHands: ["left", "right"] },
    system: { damage: { base: damage(10), versatile: damage(10) } } });
  resized(item, "lg");
  assert.equal(item.system.damage.base.denomination, 12);
  assert.equal(item.system.damage.versatile.denomination, 12);
  assert.equal(item.flags["rebreya-main"].versatileBaseDamageOriginal.denomination, 10);
  const changeGrip = { "system.damage.base": damage(10), "flags.rebreya-main.heldHands": ["left"],
    "flags.rebreya-main.-=versatileBaseDamageOriginal": null };
  applyUpdate(item, buildEquipmentSizeUpdate(item, { changes: changeGrip, source: "edit" }).update);
  assert.equal(item.flags["rebreya-main"].equipmentSize.size, "lg");
  resized(item, "med");
  assert.equal(item.system.damage.base.denomination, 8);
});

test("preUpdate normalization is synchronous and hooks register once without world observers", async () => {
  const hooks = new Map(), bus = { on(event, handler) { hooks.set(event, handler); } };
  const service = new EquipmentSizeService({}, { buildItemUpdate: buildEquipmentSizeUpdate });
  assert.equal(registerEquipmentSizeItemHooks({ equipmentSizeService: service }, { Hooks: bus }), true);
  assert.equal(registerEquipmentSizeItemHooks({ equipmentSizeService: service }, { Hooks: bus }), false);
  assert.equal(hooks.has("updateToken"), false);
  assert.equal(hooks.has("updateActor"), false);
  const item = makeEquipment(), patch = { "flags.rebreya-main.equipmentSize.size": "lg" };
  const result = service.preUpdateItem(item, patch);
  assert.equal(result instanceof Promise, false);
  assert.equal(patch["system.damage.base.denomination"], 10);
  assert.equal(item.updates.length, 0);
  await service.setItemSize(item, "lg");
  assert.equal(item.updates.length, 1);
  item.isOwner = false;
  await assert.rejects(service.setItemSize(item, "huge"));
});

test("equipment controls exclude natural weapons, coins, spells and journal records", () => {
  assert.equal(isEquipmentSizeItem(makeEquipment()), true);
  assert.equal(isEquipmentSizeItem(makeEquipment({ type: "container" })), true);
  assert.equal(isEquipmentSizeItem(makeEquipment({ type: "spell" })), false);
  assert.equal(isEquipmentSizeItem(makeEquipment({ system: { type: { value: "natural" } } })), false);
  assert.equal(isEquipmentSizeItem(makeEquipment({ flags: { storageCoinTemplate: { version: 1, denomination: "gp" } } })), false);
});
