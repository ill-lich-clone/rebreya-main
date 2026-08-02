import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { buildTransportFuelSelector } from "../scripts/data/transport-fuel-item.js";
import {
  TransportFuelService,
  validateTransportFuelConsumptionPayload
} from "../scripts/data/transport-fuel-service.js";

const selectedFuel = {
  documentName: "Item",
  uuid: "Compendium.world.goods.Item.coal",
  name: "Жидкий уголь",
  type: "loot",
  img: "icons/coal.webp",
  flags: {
    [MODULE_ID]: { sourceType: "good", sourceId: "liquid-coal" }
  }
};

function createFuelHarness({
  quantities = [2, 3],
  configured = true,
  rate = 0.125,
  override = null,
  mutationError = null
} = {}) {
  const updates = [];
  const items = quantities.map((quantity, index) => {
    const id = index === 0 ? "coal-b" : `coal-${String.fromCharCode(96 + index)}`;
    return {
      documentName: "Item",
      id,
      uuid: `Actor.group-a.Item.${id}`,
      name: "Жидкий уголь",
      type: "loot",
      img: "icons/coal.webp",
      system: { quantity },
      flags: {
        [MODULE_ID]: { sourceType: "good", sourceId: "liquid-coal" }
      }
    };
  });
  const vehicle = {
    id: "vehicle-a",
    type: "vehicle",
    flags: {
      [MODULE_ID]: {
        transport: {
          instance: true,
          sourceId: "transport-v01-kettle",
          sourceActorUuid: "Compendium.world.rebreya-transport.Actor.lchtransport0048",
          groupActorId: "group-a",
          consumption: { kind: "fuel", amount: rate, unit: "gal", cadence: "mile" },
          instanceState: configured
            ? {
                fuelSelector: buildTransportFuelSelector(selectedFuel),
                ...(override ? { fuelConsumption: structuredClone(override) } : {})
              }
            : {}
        }
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
  const groupActor = {
    id: "group-a",
    type: "group",
    items: { contents: items },
    async updateEmbeddedDocuments(documentName, patches) {
      if (mutationError) throw mutationError;
      updates.push([documentName, structuredClone(patches)]);
      for (const patch of patches) {
        const item = items.find((entry) => entry.id === patch._id);
        if (item) item.system.quantity = patch["system.quantity"];
      }
      return items;
    }
  };
  const service = new TransportFuelService({
    groupContextService: {
      resolveForGroup(groupActorId) {
        assert.equal(groupActorId, "group-a");
        return {
          groupId: "group-a",
          groupActor,
          members: [vehicle],
          groupState: { transportState: { activeTransportId: "member:vehicle-a" } }
        };
      }
    }
  });
  return { service, items, updates };
}

test("fuel consumption payload is exact and non-negative", () => {
  const valid = { groupActorId: "group-a", appliedMiles: 10 };
  assert.equal(validateTransportFuelConsumptionPayload(valid), true);
  assert.equal(validateTransportFuelConsumptionPayload({ ...valid, appliedMiles: "10,5" }), true);
  assert.equal(validateTransportFuelConsumptionPayload({ ...valid, appliedMiles: -1 }), false);
  assert.equal(validateTransportFuelConsumptionPayload({ ...valid, forged: true }), false);
  assert.equal(validateTransportFuelConsumptionPayload({ ...valid, groupActorId: "__proto__" }), false);
});

test("travel consumes matching warehouse stacks in stable item-id order", async () => {
  const harness = createFuelHarness();
  const result = await harness.service.consumeForTravel({ groupActorId: "group-a", appliedMiles: 32 });

  assert.equal(result.required, 4);
  assert.equal(result.consumed, 4);
  assert.equal(result.shortage, 0);
  assert.deepEqual(harness.updates, [["Item", [
    { _id: "coal-a", "system.quantity": 0 },
    { _id: "coal-b", "system.quantity": 1 }
  ]]]);
});

test("travel consumes the same instance fuel rate shown by inventory", async () => {
  const harness = createFuelHarness({
    quantities: [300],
    rate: 0.125,
    override: { amount: 120, unit: "lb" }
  });

  const result = await harness.service.consumeForTravel({ groupActorId: "group-a", appliedMiles: 2 });

  assert.equal(result.required, 240);
  assert.equal(result.consumed, 240);
  assert.equal(harness.items[0].system.quantity, 60);
});

test("insufficient fuel is depleted without deleting stacks or blocking travel", async () => {
  const harness = createFuelHarness({ quantities: [1, 1] });
  const result = await harness.service.consumeForTravel({ groupActorId: "group-a", appliedMiles: 24 });

  assert.equal(result.required, 3);
  assert.equal(result.consumed, 2);
  assert.equal(result.shortage, 1);
  assert.match(result.warning, /не хватило 1/u);
  assert.deepEqual(harness.items.map((item) => item.system.quantity), [0, 0]);
});

test("selected fuel without warehouse stock reports shortage and remains configured", async () => {
  const harness = createFuelHarness({ quantities: [] });
  const result = await harness.service.consumeForTravel({ groupActorId: "group-a", appliedMiles: 8 });

  assert.equal(result.configured, true);
  assert.equal(result.required, 1);
  assert.equal(result.consumed, 0);
  assert.equal(result.shortage, 1);
  assert.equal(result.itemName, "Жидкий уголь");
  assert.match(result.warning, /не найдено/u);
});

test("unconfigured fuel and travel rewind never mutate inventory", async () => {
  const unconfigured = createFuelHarness({ configured: false });
  assert.deepEqual(
    await unconfigured.service.consumeForTravel({ groupActorId: "group-a", appliedMiles: 8 }),
    { configured: false, required: 0, consumed: 0, shortage: 0, itemName: "", warning: "" }
  );

  const rewind = createFuelHarness();
  const rewindResult = await rewind.service.consumeForTravel({ groupActorId: "group-a", appliedMiles: -12 });
  assert.equal(rewindResult.required, 0);
  assert.deepEqual(rewind.updates, []);
});

test("fuel mutation errors become warnings instead of travel failures", async () => {
  const harness = createFuelHarness({ mutationError: new Error("warehouse locked") });
  const result = await harness.service.consumeForTravel({ groupActorId: "group-a", appliedMiles: 8 });

  assert.equal(result.required, 1);
  assert.equal(result.consumed, 0);
  assert.equal(result.shortage, 1);
  assert.match(result.warning, /не удалось списать/iu);
});
