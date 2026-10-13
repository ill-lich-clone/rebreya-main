import assert from "node:assert/strict";
import test from "node:test";

import { MODULE_ID } from "../scripts/constants.js";
import {
  buildInventoryIngressDescriptor,
  canResolveInventoryDismantle,
  captureInventoryIngressIdentity,
  resolveInventoryDismantleOutputs
} from "../scripts/data/inventory-ingress-descriptor.js";

function clone(value) {
  return structuredClone(value);
}

function createModel() {
  const iron = { id: "iron", name: "Железо", type: "Металл", weight: 1 };
  const sword = {
    id: "gear-sword-1",
    name: "Железный меч",
    equipmentType: "Оружие",
    rank: 3,
    predominantMaterialId: iron.id,
    predominantMaterialName: iron.name
  };
  return {
    materials: [iron],
    materialById: new Map([[iron.id, iron]]),
    materialByGoodId: new Map(),
    gear: [sword],
    gearById: new Map([[sword.id, sword]])
  };
}

function createSwordData() {
  return {
    name: "Железный меч",
    type: "weapon",
    system: {
      quantity: 1,
      price: { value: 12.345, denomination: "gp" },
      weight: { value: 3, units: "lb" },
      type: { value: "martialM", subtype: "sword" },
      rarity: { value: "uncommon" }
    },
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "gear",
        sourceId: "gear-sword-1",
        gearId: "gear-sword-1",
        equipmentType: "Оружие",
        rank: 3,
        predominantMaterialId: "iron",
        predominantMaterialName: "Железо",
        durability: { eligible: true, state: "broken" }
      }
    }
  };
}

test("projects the exact canonical matching fields without source origin or name identity", () => {
  const model = createModel();
  const itemData = createSwordData();
  const descriptor = buildInventoryIngressDescriptor(itemData, { model });

  assert.deepEqual(descriptor, {
    sourceKind: "ordinary",
    sourceType: "gear",
    sourceId: "gear-sword-1",
    documentType: "weapon",
    systemTypeValue: "martialM",
    systemTypeSubtype: "sword",
    sourceCategory: "Оружие",
    rarity: "uncommon",
    rank: 3,
    durabilityState: "broken",
    unitValue: 1234,
    unitWeight: 3,
    predominantMaterialId: "iron",
    dismantlable: true
  });
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal("origin" in descriptor, false);
  assert.equal("name" in descriptor, false);
  assert.equal(itemData.system.price.value, 12.345);
});

test("Lootgen, persisted Storage and external drop wrappers have descriptor parity", () => {
  const model = createModel();
  const canonical = createSwordData();
  const lootgen = { sourceOrigin: "lootgen", rowId: "loot-row", itemData: clone(canonical) };
  const storage = { sourceOrigin: "storage", rowId: "storage-row", itemData: clone(canonical) };
  const externalDocument = {
    uuid: "Item.external",
    toObject: () => ({ ...clone(canonical), name: "Переименованный меч" })
  };

  const lootgenDescriptor = buildInventoryIngressDescriptor(lootgen.itemData, { model });
  const storageDescriptor = buildInventoryIngressDescriptor(storage.itemData, { model });
  const dropDescriptor = buildInventoryIngressDescriptor(externalDocument.toObject(), { model });

  assert.deepEqual(lootgenDescriptor, storageDescriptor);
  assert.deepEqual(storageDescriptor, dropDescriptor);
  assert.deepEqual(captureInventoryIngressIdentity(dropDescriptor, 2), {
    sourceType: "gear",
    sourceId: "gear-sword-1",
    documentType: "weapon",
    durabilityState: "broken",
    quantity: 2
  });
});

test("manual ingress keeps an explicit non-catalog identity even when its name matches gear", () => {
  const descriptor = buildInventoryIngressDescriptor({
    name: "Железный меч",
    type: "loot",
    system: {
      quantity: 3,
      price: { value: 4, denomination: "gp" },
      weight: { value: 2.5, units: "lb" },
      type: { value: "loot", subtype: "Прочее" }
    },
    flags: {
      [MODULE_ID]: {
        sourceType: "manual",
        sourceId: "manual-entry-1",
        itemType: "Прочее",
        predominantMaterialName: "Ткань",
        manualEntry: { version: 1, manualEntryId: "manual-entry-1" }
      }
    }
  }, { model: createModel() });

  assert.equal(descriptor.sourceType, "manual");
  assert.equal(descriptor.sourceId, "manual-entry-1");
  assert.equal(descriptor.unitWeight, 2.5);
  assert.equal(descriptor.unitValue, 400);
  assert.equal(descriptor.predominantMaterialId, "");
});

test("derives ordinary, magic and material source kinds from stable managed metadata", () => {
  const model = createModel();
  const ordinary = createSwordData();
  const magic = {
    ...createSwordData(),
    system: { ...createSwordData().system, rarity: "rare" },
    flags: { [MODULE_ID]: { sourceType: "magicItem", sourceId: "magic-1", magicItemId: "magic-1" } }
  };
  const material = {
    name: "Железо",
    type: "loot",
    system: { quantity: 1, weight: { value: 1, units: "lb" } },
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron", materialId: "iron" } }
  };

  assert.equal(buildInventoryIngressDescriptor(ordinary, { model }).sourceKind, "ordinary");
  assert.equal(buildInventoryIngressDescriptor(magic, { model }).sourceKind, "magic");
  assert.equal(buildInventoryIngressDescriptor(material, { model }).sourceKind, "material");
  assert.equal(buildInventoryIngressDescriptor(material, { model }).dismantlable, false);
});

test("does not create managed identity or dismantle eligibility from a matching name", () => {
  const model = createModel();
  const unmanaged = {
    name: "Железный меч",
    type: "weapon",
    system: { weight: { value: 3, units: "lb" } },
    flags: { [MODULE_ID]: { predominantMaterialName: "Железо" } }
  };

  const descriptor = buildInventoryIngressDescriptor(unmanaged, { model });

  assert.equal(descriptor.sourceType, "");
  assert.equal(descriptor.sourceId, "");
  assert.equal(descriptor.predominantMaterialId, "");
  assert.equal(descriptor.dismantlable, false);
});

test("normalizes rarity variants, weight units, copper and durability states", () => {
  const model = createModel();
  const states = ["intact", "damaged", "broken", "destroyed"];
  for (const durabilityState of states) {
    const itemData = createSwordData();
    itemData.system.rarity = { id: "very-rare" };
    itemData.system.price = { value: 12.9, denomination: "sp" };
    itemData.system.weight = { value: 1, units: "kg" };
    itemData.flags[MODULE_ID].durability.state = durabilityState;
    const descriptor = buildInventoryIngressDescriptor(itemData, { model });
    assert.equal(descriptor.rarity, "very-rare");
    assert.equal(descriptor.unitValue, 129);
    assert.equal(descriptor.unitWeight, 2.20462);
    assert.equal(descriptor.durabilityState, durabilityState);
  }

  const ineligible = createSwordData();
  ineligible.flags[MODULE_ID].durability = { eligible: false, state: "broken" };
  assert.equal(buildInventoryIngressDescriptor(ineligible, { model }).durabilityState, "ineligible");
});

test("resolves frozen canonical dismantle outputs with the 50 percent mass rule", () => {
  const model = createModel();
  const swordData = createSwordData();
  const outputs = resolveInventoryDismantleOutputs(swordData, 2, { model });

  assert.deepEqual(outputs, [{
    sourceType: "material",
    sourceId: "iron",
    name: "Железо",
    quantity: 3
  }]);
  assert.equal(canResolveInventoryDismantle(swordData, { model }), true);
  assert.equal(Object.isFrozen(outputs), true);
  assert.equal(Object.isFrozen(outputs[0]), true);
  assert.equal("document" in outputs[0], false);
});

test("dismantle output is fractional catalog quantity before native projection", () => {
  const model = createModel();
  const itemData = createSwordData();
  itemData.system.weight = { value: 1, units: "lb" };
  itemData.system.quantity = 3;

  assert.equal(canResolveInventoryDismantle(itemData, { model }), true);
  assert.deepEqual(resolveInventoryDismantleOutputs(itemData, 3, { model }), [{
    sourceType: "material",
    sourceId: "iron",
    name: "Железо",
    quantity: 1.5
  }]);
  itemData.system.quantity = 1;
  assert.equal(canResolveInventoryDismantle(itemData, { model }), true);
  assert.equal(resolveInventoryDismantleOutputs(itemData, 1, { model })[0].quantity, 0.5);
});

test("dismantle minimum allows a single light source Item", async () => {
  const descriptorModule = await import(
    `../scripts/data/inventory-ingress-descriptor.js?minimum-quantity=${Date.now()}`
  );
  assert.equal(typeof descriptorModule.resolveInventoryDismantleMinimumQuantity, "function");
  const model = createModel();
  const itemData = createSwordData();
  itemData.system.weight = { value: 1, units: "lb" };
  itemData.system.quantity = 3;

  assert.equal(
    descriptorModule.resolveInventoryDismantleMinimumQuantity(itemData, { model }),
    1
  );
  itemData.system.quantity = 1;
  assert.equal(
    descriptorModule.resolveInventoryDismantleMinimumQuantity(itemData, { model }),
    1
  );
  itemData.system.quantity = 0;
  assert.equal(descriptorModule.resolveInventoryDismantleMinimumQuantity(itemData, { model }), null);
});

test("ammo salvage conserves half-pound mass across catalog unit weights", () => {
  for (const weight of [0.5, 1, 10, 450, 630]) {
    const model = createModel();
    model.materialById.get("iron").weight = weight;
    const ammo = createSwordData();
    ammo.type = "consumable";
    ammo.system.quantity = 20;
    ammo.system.weight = { value: 0.05, units: "lb" };
    assert.equal(canResolveInventoryDismantle(ammo, { model }), true);
    const [output] = resolveInventoryDismantleOutputs(ammo, 20, { model });
    assert.ok(Math.abs(output.quantity * weight - 0.5) <= 1e-8);
    assert.deepEqual(Object.keys(output), ["sourceType", "sourceId", "name", "quantity"]);
  }
});

test("dismantle rejects unknown material weight without inventing a unit", () => {
  for (const weight of [undefined, 0, -1, NaN]) {
    const model = createModel();
    model.materialById.get("iron").weight = weight;
    assert.equal(canResolveInventoryDismantle(createSwordData(), { model }), false);
    assert.deepEqual(resolveInventoryDismantleOutputs(createSwordData(), 1, { model }), []);
  }
});

test("returns no dismantle output for zero weight, unknown material, material or container", () => {
  const model = createModel();
  const fixtures = [
    { ...createSwordData(), system: { ...createSwordData().system, weight: { value: 0, units: "lb" } } },
    {
      ...createSwordData(),
      flags: { [MODULE_ID]: { ...createSwordData().flags[MODULE_ID], predominantMaterialId: "unknown" } }
    },
    {
      name: "Железо",
      type: "loot",
      system: { weight: { value: 1, units: "lb" } },
      flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron", materialId: "iron" } }
    },
    { ...createSwordData(), type: "container" }
  ];

  for (const itemData of fixtures) {
    assert.equal(canResolveInventoryDismantle(itemData, { model }), false);
    assert.deepEqual(resolveInventoryDismantleOutputs(itemData, 1, { model }), []);
    assert.equal(buildInventoryIngressDescriptor(itemData, { model }).dismantlable, false);
  }
});

test("capture identity rejects invalid quantities and freezes its detached result", () => {
  const descriptor = buildInventoryIngressDescriptor(createSwordData(), { model: createModel() });
  const identity = captureInventoryIngressIdentity(descriptor, 1.5);
  assert.equal(Object.isFrozen(identity), true);
  assert.throws(() => captureInventoryIngressIdentity(descriptor, 0), /quantity/iu);
  assert.throws(() => captureInventoryIngressIdentity(descriptor, Number.NaN), /quantity/iu);
});

test("installed hosts and children are unavailable for shell-only dismantling",()=>{
  const model=createModel();
  for(const flags of [{itemUpgrades:{installed:[{itemId:"child",slotIndex:1}]}},{installedUpgrade:{hostItemId:"host",slotIndex:1}}]){
    const item=createSwordData();Object.assign(item.flags[MODULE_ID],flags);
    assert.equal(canResolveInventoryDismantle(item,{model}),false);
    assert.equal(buildInventoryIngressDescriptor(item,{model}).dismantlable,false);
    assert.deepEqual(resolveInventoryDismantleOutputs(item,1,{model}),[]);
  }
});
