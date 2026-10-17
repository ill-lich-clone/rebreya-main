import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLootgenItemDescriptor, getLootgenAggregationKey } from "../scripts/data/lootgen-item-descriptor.js";
import { normalizeLootgenComposition } from "../scripts/data/lootgen-composition.js";
import { evaluateItemValue } from "../scripts/data/item-value.js";
import { buildCompositeItemGraph } from "../scripts/data/composite-item-graph.js";
import { storageRowsCanStack } from "../scripts/data/storage-row-stacking.js";
import { buildStorageContainerSnapshot } from "../scripts/data/storage-container-snapshot.js";
import { StorageContainerItemService } from "../scripts/data/storage-container-item-service.js";
import { buildLootgenPreparedItem, readLootgenPreparedComposition } from "../scripts/data/lootgen-prepared-item.js";
import { buildInventoryIngressDescriptor, captureInventoryIngressIdentity } from "../scripts/data/inventory-ingress-descriptor.js";
import { isValidSerializedInventoryIngressPlan } from "../scripts/application/inventory-ingress-planner.js";
import { buildEquipmentSizeUpdate } from "../scripts/integrations/equipment-size.js";
import { makeEquipment, applyUpdate } from "./helpers/equipment-size-fixture.mjs";
import { makeValuedContainer } from "./helpers/lootgen-container-fixture.mjs";

const plain = () => ({ version: 2, instanceKey: "host", sourceType: "gear", sourceId: "plate", quantity: 1,
  isBroken: false, upgrades: [], container: null });
const sized = (size = "grg") => ({ ...plain(), version: 4, equipmentSize: size,
  weaponMods: { version: 1, attachments: [], modernizedParts: [] } });

test("v4 strictly transports size while v2/v3 contracts remain unchanged", () => {
  const d = sized();
  assert.deepEqual(normalizeLootgenItemDescriptor(d), d);
  const { quantity, container, ...composition } = d;
  assert.deepEqual(normalizeLootgenComposition(composition), composition);
  assert.deepEqual(normalizeLootgenItemDescriptor(plain()), plain());
  for (const patch of [{ equipmentSize: "invalid" }, { reference: {} }, { version: 3 }, { equipmentSize: null }]) {
    assert.throws(() => normalizeLootgenItemDescriptor({ ...d, ...patch }));
  }
  assert.notEqual(getLootgenAggregationKey(d), getLootgenAggregationKey(plain()));
  assert.equal(getLootgenAggregationKey(sized("med")), getLootgenAggregationKey(plain()));
});

test("size scales only the host price, preserving upgrade, child and currency amounts", () => {
  const reader = { resolveValueComponent: ({ sourceId }) => ({ priceKnown: true, unitValue: sourceId === "plate" ? 150000 : 10000 }) };
  const descriptor = { ...sized(), upgrades: [{ instanceKey: "child", sourceId: "u", slotIndex: 1, choices: {} }] };
  const value = evaluateItemValue(descriptor, reader);
  assert.equal(value.baseValue, 506250);
  assert.equal(value.upgradeValue, 10000);
  assert.equal(value.totalValue, 516250);
  const nested = makeValuedContainer();
  const root = { ...nested.descriptor, version: 4, equipmentSize: "grg", weaponMods: sized().weaponMods };
  const { quantity, container, ...metadata } = root;
  root.container.state.lootgenComposition = metadata;
  assert.equal(evaluateItemValue(root, nested.catalogReader).totalValue, 9375);
  assert.throws(() => evaluateItemValue(sized(), { resolveValueComponent: () => ({ priceKnown: true, unitValue: Number.MAX_SAFE_INTEGER }) }),
    error => error.code === "overflow");
});

test("catalog graph materialization scales once and keeps its own immutable size reference", async () => {
  const source = makeEquipment({ type: "equipment", flags: { sourceType: "gear", gearId: "plate" }, system: {
    type: { value: "heavy" }, quantity: 1, price: { value: 1500, denomination: "gp" }, weight: { value: 65, units: "lb" }
  } }).toObject();
  const graph = await buildCompositeItemGraph(sized(), {
    buildBase: async () => source, buildUpgrade: async () => { throw new Error("unexpected upgrade"); },
    createDocumentId: () => "A".repeat(16), manifest: []
  });
  const item = graph.documents[0];
  assert.equal(item.system.price.value, 5062.5);
  assert.equal(item.system.weight.value, 520);
  assert.equal(item.flags["rebreya-main"].equipmentSize.reference.price.value, 1500);
  assert.equal(source.system.price.value, 1500);
});

test("storage snapshots retain the full author profile and do not stack different sizes", () => {
  const item = makeEquipment({ flags: { sourceType: "gear", gearId: "sword" } });
  const original = item.toObject();
  applyUpdate(item, buildEquipmentSizeUpdate(item, { size: "lg" }).update);
  const row = data => ({ rowId: "r", sourceType: "gear", sourceId: "sword", quantity: 1, itemData: data });
  const snapshot = buildStorageContainerSnapshot({ containerId: "box", state: { manualRows: [row(item.toObject())] } });
  assert.deepEqual(snapshot.state.manualRows[0].itemData.flags["rebreya-main"].equipmentSize,
    item.flags["rebreya-main"].equipmentSize);
  assert.equal(storageRowsCanStack(row(original), row(item.toObject())), false);
  const explicitMedium = structuredClone(original);
  explicitMedium.flags["rebreya-main"].equipmentSize = { version: 1, size: "med" };
  assert.equal(storageRowsCanStack(row(original), row(explicitMedium)), true);
  applyUpdate(item, buildEquipmentSizeUpdate(item, { size: "med" }).update);
  assert.equal(storageRowsCanStack(row(original), row(item.toObject())), true, "round-trip Medium still shares the legacy stack contract");
});

test("ingress native price and identity preserve resized instances and reject size tampering", () => {
  const item = makeEquipment({ flags: { sourceType: "gear", gearId: "sword" } });
  applyUpdate(item, buildEquipmentSizeUpdate(item, { size: "lg" }).update);
  const descriptor = buildInventoryIngressDescriptor(item.toObject());
  assert.equal(descriptor.unitValue, 2250);
  assert.equal(descriptor.unitWeight, 6);
  const identity = captureInventoryIngressIdentity(descriptor, 1);
  assert.equal(identity.equipmentSize, "lg");
  const plan = { version: 3, groupActorId: "party", requestedFolderId: null, rulesRevision: 0, rootOverrideSourceKeys: [],
    rows: [{ sourceKey: "row", matchedRuleId: null, action: { type: "legacy", folderId: null }, quantity: 1, identity }] };
  assert.equal(isValidSerializedInventoryIngressPlan(plan), true);
  plan.rows[0].identity = { ...identity, equipmentSize: "invalid" };
  assert.equal(isValidSerializedInventoryIngressPlan(plan), false);
});

test("prepared v4 composition rejects forged physical size metadata", async () => {
  const descriptor = { ...sized("lg"), upgrades: [{ instanceKey: "upgrade", sourceId: "zacharovanie-ostroty", slotIndex: 1, choices: {} }] };
  let id = 0;
  const graph = await buildCompositeItemGraph(descriptor, {
    buildBase: async () => makeEquipment({ flags: { sourceType: "gear", sourceId: "plate", gearId: "plate", itemUpgrades: { capacity: 1 } } }).toObject(),
    buildUpgrade: async () => ({ name: "Sharp", type: "loot", system: { quantity: 1 }, flags: {} }),
    createDocumentId: () => String(++id).padStart(16, "0"),
    manifest: [{ productId: "zacharovanie-ostroty", profile: { compatibility: ["weapon"] }, decision: "simple-implemented" }]
  });
  const prepared = buildLootgenPreparedItem(descriptor, { graph, unitValue: 2500 });
  assert.equal(readLootgenPreparedComposition(prepared).descriptor.equipmentSize, "lg");
  prepared.flags["rebreya-main"].equipmentSize.size = "med";
  assert.throws(() => readLootgenPreparedComposition(prepared), error => error.code === "invalid-prepared-lootgen-item");
});

test("native container capture upgrades stale composition categories and restores author data without catalog rebuild", async () => {
  const { quantity, container, ...composition } = plain();
  const bag = makeEquipment({ id: "bag", type: "container", flags: { storageContainer: buildStorageContainerSnapshot({
    containerId: "box", state: { state: "empty", lootgenComposition: { ...composition, instanceKey: "bag", sourceId: "bag" } }
  }) }, system: { currency: {}, quantity: 1 } });
  const item = makeEquipment({ flags: { sourceType: "gear", gearId: "plate", storageContainerMember: { composition } },
    system: { container: "bag", quantity: 1 } });
  applyUpdate(item, buildEquipmentSizeUpdate(item, { size: "lg" }).update);
  const actor = { id: "hero", type: "character", items: { contents: [bag, item] } };
  bag.parent = actor; item.parent = actor;
  const service = new StorageContainerItemService({});
  const snapshot = await service.captureFromItem(bag);
  assert.equal(snapshot.state.manualRows[0].composition.version, 4);
  assert.equal(snapshot.state.manualRows[0].composition.equipmentSize, "lg");
  let id = 0;
  const graph = await service.prepareItemGraph(snapshot, { createDocumentId: () => String(++id).padStart(16, "0") });
  const restored = graph.nodes.find(node => node.type === "weapon");
  assert.deepEqual(restored.flags["rebreya-main"].equipmentSize, item.flags["rebreya-main"].equipmentSize);
  assert.equal(restored.system.price.value, 22.5);
  assert.equal(restored.system.damage.base.denomination, 10);
});
