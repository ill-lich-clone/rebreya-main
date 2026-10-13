import test from "node:test";
import assert from "node:assert/strict";
import { withInventoryItemQuantity, readInventoryItemQuantity } from "../scripts/data/inventory-material-quantity.js";
import { makeInstanceDocumentsFixture } from "./helpers/item-instance-documents-fixture.mjs";
import { buildStorageDragData, parseStorageDragData, promptStorageTransferQuantity } from "../scripts/ui/storage-transfer-ui.js";
import { resolveStorageDepositSource } from "../scripts/data/storage-deposit-source.js";
import { isValidStorageDepositPayload, isValidStorageDropItemPayload, isValidStorageCoinDropPayload } from "../scripts/data/storage-command-service.js";

const material = { name: "Dreadnought", type: "loot", flags: { "rebreya-main": { sourceType: "material", sourceId: "claw", materialId: "claw" } }, system: { quantity: 1, weight: { value: 630, units: "lb" }, price: { value: 10000, denomination: "gp" } } };

test("fractional material folder split retains 12-digit units, integer native count and retry identity", async () => {
  const q = 0.000793650794;
  const data = withInventoryItemQuantity(material, q);
  const fx = makeInstanceDocumentsFixture({ quantity: data.system.quantity, itemFlags: data.flags["rebreya-main"], itemSystem: data.system });
  try {
    const request = { groupActorId: "g", itemId: "rope", folderId: "bag", quantity: 0.0003, expectedSourceQuantity: q, operationId: "claw-split" };
    const result = await fx.api.inventoryService.moveInventoryItemToFolder(request);
    await fx.api.inventoryService.moveInventoryItemToFolder(request);
    const target = fx.group.items.get(result.itemId);
    assert.equal(fx.group.items.contents.length, 2);
    assert.equal(readInventoryItemQuantity(target.toObject()), 0.0003);
    assert.equal(readInventoryItemQuantity(fx.source.toObject()), 0.000493650794);
    for (const item of fx.group.items.contents) assert.equal(item.system.quantity, 1);
    assert.ok(Math.abs(fx.group.items.contents.reduce((sum, item) => sum + item.system.weight.value, 0) - q * 630) < 1e-10);
    await assert.rejects(fx.api.inventoryService.moveInventoryItemToFolder({ ...request, operationId: "too-precise", quantity: 1e-13, expectedSourceQuantity: 0.000493650794 }), error => error.code === "invalid-quantity");
  } finally { fx.restore(); }
});

test("material storage drag and quantity dialog preserve small fractions and cancel", async () => {
  const payload = buildStorageDragData({ tokenUuid: "Scene.s.Token.t", rowId: "scrap", quantity: 0.000793650794 });
  assert.equal(parseStorageDragData(JSON.stringify(payload)).quantity, payload.quantity);
  assert.equal(await promptStorageTransferQuantity(payload.quantity, { prompt: async () => 0.0003 }), 0.0003);
  assert.equal(await promptStorageTransferQuantity(payload.quantity, { prompt: async () => null }), null);
  await assert.rejects(promptStorageTransferQuantity(2, { prompt: async () => 0.5 }), /Количество/);
});

test("storage native debit and compensation restore exact material quantity, weight, price and flag", async () => {
  const data = withInventoryItemQuantity(material, 0.000793650794);
  const before = structuredClone(data);
  const item = { ...data, id: "part", uuid: "Actor.hero.Item.part", documentName: "Item", parent: { documentName: "Actor" }, toObject() { return structuredClone({ name: this.name, type: this.type, flags: this.flags, system: this.system }); }, async update(patch) {
    assert.ok(Number.isInteger(patch["system.quantity"]));
    for (const [path, value] of Object.entries(patch)) { const parts = path.split("."); let cursor = this; for (const part of parts.slice(0, -1)) cursor = (cursor[part] ??= {}); const key = parts.at(-1); if (key.startsWith("-=")) delete cursor[key.slice(2)]; else cursor[key] = structuredClone(value); }
  } };
  const source = await resolveStorageDepositSource({ kind: "item", itemUuid: item.uuid }, { fromUuid: async () => item });
  assert.equal(source.available, 0.000793650794);
  const receipt = await source.consume(0.0003);
  assert.equal(readInventoryItemQuantity(item.toObject()), 0.000493650794);
  await source.restore(receipt);
  assert.deepEqual(item.toObject(), before);
});

test("typed storage Item quantities accept twelve digits while coins and payload shape stay strict", () => {
  const deposit = { tokenUuid: "Scene.s.Token.t", characterTokenUuid: "", mutationId: "part", quantity: 0.000793650794, source: { kind: "item", itemUuid: "Actor.hero.Item.part" } };
  assert.equal(isValidStorageDepositPayload(deposit), true);
  assert.equal(isValidStorageDepositPayload({ ...deposit, quantity: 1e-13 }), false);
  assert.equal(isValidStorageDepositPayload({ ...deposit, materialId: "forged" }), false);
  const drop = { characterTokenUuid: "", itemUuid: "Actor.hero.Item.part", mutationId: "part", quantity: deposit.quantity, sceneId: "s", x: 1, y: 1 };
  assert.equal(isValidStorageDropItemPayload(drop), true);
  assert.equal(isValidStorageCoinDropPayload({ ...drop, denomination: "gp" }), false);
});
