import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTransportFuelInventorySnapshot,
  buildTransportFuelSelector
} from "../scripts/data/transport-fuel-item.js";

const compendiumCoal = {
  documentName: "Item",
  uuid: "Compendium.world.goods.Item.coal",
  name: "Жидкий уголь",
  type: "loot",
  img: "icons/coal.webp",
  system: { quantity: 40 },
  flags: {
    "rebreya-main": { sourceType: "good", sourceId: "liquid-coal" }
  }
};

function warehouseCoal(itemId, quantity) {
  return {
    documentName: "Item",
    id: itemId,
    uuid: `Actor.group-a.Item.${itemId}`,
    name: "Жидкий уголь",
    type: "loot",
    img: "icons/coal.webp",
    system: { quantity },
    flags: {
      core: { sourceId: compendiumCoal.uuid },
      "rebreya-main": { sourceType: "good", sourceId: "liquid-coal" }
    }
  };
}

function warehouseWood(itemId, quantity) {
  return {
    documentName: "Item",
    id: itemId,
    uuid: `Actor.group-a.Item.${itemId}`,
    name: "Дрова",
    type: "loot",
    img: "icons/wood.webp",
    system: { quantity },
    flags: {
      "rebreya-main": { sourceType: "good", sourceId: "wood" }
    }
  };
}

test("fuel selector stores identity and presentation but never quantity", () => {
  const selector = buildTransportFuelSelector(compendiumCoal);

  assert.deepEqual(selector, {
    uuid: "Compendium.world.goods.Item.coal",
    sourceUuid: "",
    sourceType: "good",
    sourceId: "liquid-coal",
    type: "loot",
    normalizedName: "жидкий уголь",
    name: "Жидкий уголь",
    img: "icons/coal.webp"
  });
  assert.equal("quantity" in selector, false);
});

test("fuel inventory snapshot aggregates every matching warehouse stack", () => {
  const selector = buildTransportFuelSelector(compendiumCoal);
  const snapshot = buildTransportFuelInventorySnapshot([
    warehouseCoal("coal-b", 3),
    warehouseCoal("coal-a", 2),
    warehouseWood("wood-a", 9)
  ], selector);

  assert.equal(snapshot.quantity, 5);
  assert.deepEqual(snapshot.stacks.map((stack) => stack.itemId), ["coal-a", "coal-b"]);
  assert.equal(snapshot.primaryItemId, "coal-a");
  assert.equal(snapshot.primaryItemUuid, "Actor.group-a.Item.coal-a");
  assert.equal(snapshot.openUuid, "Actor.group-a.Item.coal-a");
  assert.equal(snapshot.isEmpty, false);
});

test("selected compendium fuel remains openable when warehouse stock is absent", () => {
  const selector = buildTransportFuelSelector(compendiumCoal);
  const snapshot = buildTransportFuelInventorySnapshot([], selector);

  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.quantity, 0);
  assert.equal(snapshot.openUuid, compendiumCoal.uuid);
  assert.equal(snapshot.name, "Жидкий уголь");
  assert.equal(snapshot.isEmpty, true);
});
