import test from "node:test";
import assert from "node:assert/strict";

import {
  TRANSPORT_CONSUME_FUEL_COMMAND,
  TransportFuelService,
  registerTransportFuelCommand,
  validateTransportFuelConsumptionPayload
} from "../scripts/data/transport-fuel-service.js";

function createFuelHarness({
  quantity = 5,
  fuelItemId = "liquid-coal",
  fuelItemName = "Жидкий уголь",
  fuelPerMile = 0.125,
  includeItem = true,
  mutationError = null
} = {}) {
  const itemUpdates = [];
  let deleted = false;
  const item = {
    id: "liquid-coal",
    name: "Жидкий уголь",
    system: { quantity },
    async update(patch) {
      if (mutationError) throw mutationError;
      itemUpdates.push(structuredClone(patch));
      this.system.quantity = patch["system.quantity"];
    },
    async delete() {
      if (mutationError) throw mutationError;
      deleted = true;
    }
  };
  const vehicle = {
    id: "vehicle-a",
    type: "vehicle",
    flags: {
      "rebreya-main": {
        sourceId: "transport-v01-kettle",
        transport: {
          instance: true,
          sourceId: "transport-v01-kettle",
          sourceActorUuid: "Compendium.world.rebreya-transport.Actor.lchtransport0048",
          groupActorId: "group-a",
          instanceState: { fuelItemId, fuelItemName, fuelPerMile }
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
    items: {
      contents: includeItem ? [item] : [],
      get(id) {
        return this.contents.find((entry) => entry.id === id) ?? null;
      }
    }
  };
  const context = {
    groupId: "group-a",
    groupActor,
    members: [vehicle],
    groupState: {
      transportState: { activeTransportId: "member:vehicle-a" }
    }
  };
  const service = new TransportFuelService({
    groupContextService: {
      resolveForGroup(groupActorId) {
        assert.equal(groupActorId, "group-a");
        return context;
      }
    }
  });
  return {
    service,
    item,
    itemUpdates,
    wasDeleted: () => deleted
  };
}

test("fuel consumption payload is exact and non-negative", () => {
  const valid = { groupActorId: "group-a", appliedMiles: 10 };
  assert.equal(validateTransportFuelConsumptionPayload(valid), true);
  assert.equal(validateTransportFuelConsumptionPayload({ ...valid, appliedMiles: "10,5" }), true);
  assert.equal(validateTransportFuelConsumptionPayload({ ...valid, appliedMiles: -1 }), false);
  assert.equal(validateTransportFuelConsumptionPayload({ ...valid, forged: true }), false);
  assert.equal(validateTransportFuelConsumptionPayload({ ...valid, groupActorId: "__proto__" }), false);
});

test("travel consumes the configured fractional warehouse quantity", async () => {
  const harness = createFuelHarness();

  const result = await harness.service.consumeForTravel({
    groupActorId: "group-a",
    appliedMiles: 10
  });

  assert.deepEqual(result, {
    configured: true,
    required: 1.25,
    consumed: 1.25,
    shortage: 0,
    itemName: "Жидкий уголь",
    warning: ""
  });
  assert.deepEqual(harness.itemUpdates, [{ "system.quantity": 3.75 }]);
  assert.equal(harness.wasDeleted(), false);
});

test("insufficient fuel is depleted and reported without blocking travel", async () => {
  const harness = createFuelHarness({ quantity: 2, fuelPerMile: 0.3 });

  const result = await harness.service.consumeForTravel({
    groupActorId: "group-a",
    appliedMiles: 10
  });

  assert.equal(result.configured, true);
  assert.equal(result.required, 3);
  assert.equal(result.consumed, 2);
  assert.equal(result.shortage, 1);
  assert.match(result.warning, /не хватило 1/u);
  assert.equal(harness.wasDeleted(), true);
});

test("missing or unconfigured fuel returns a reminder and never throws", async () => {
  const missing = createFuelHarness({ includeItem: false });
  const missingResult = await missing.service.consumeForTravel({
    groupActorId: "group-a",
    appliedMiles: 8
  });
  assert.equal(missingResult.configured, true);
  assert.equal(missingResult.consumed, 0);
  assert.equal(missingResult.shortage, 1);
  assert.match(missingResult.warning, /не найден/u);

  const unconfigured = createFuelHarness({ fuelItemId: "", fuelItemName: "", fuelPerMile: 0 });
  const unconfiguredResult = await unconfigured.service.consumeForTravel({
    groupActorId: "group-a",
    appliedMiles: 8
  });
  assert.deepEqual(unconfiguredResult, {
    configured: false,
    required: 0,
    consumed: 0,
    shortage: 0,
    itemName: "",
    warning: ""
  });
});

test("rewinding travel never refunds or mutates fuel", async () => {
  const harness = createFuelHarness();
  const result = await harness.service.consumeForTravel({
    groupActorId: "group-a",
    appliedMiles: -12
  });

  assert.equal(result.required, 0);
  assert.equal(result.consumed, 0);
  assert.deepEqual(harness.itemUpdates, []);
  assert.equal(harness.wasDeleted(), false);
});

test("fuel mutation errors become warnings instead of travel failures", async () => {
  const harness = createFuelHarness({ mutationError: new Error("warehouse locked") });

  const result = await harness.service.consumeForTravel({
    groupActorId: "group-a",
    appliedMiles: 8
  });

  assert.equal(result.required, 1);
  assert.equal(result.consumed, 0);
  assert.equal(result.shortage, 1);
  assert.match(result.warning, /не удалось списать/iu);
});

test("fuel command delegates only authorized exact payloads", async () => {
  const registrations = new Map();
  const calls = [];
  const service = {
    async consumeForTravel(payload) {
      calls.push(structuredClone(payload));
      return { configured: false };
    }
  };
  registerTransportFuelCommand({
    register(command, definition) {
      registrations.set(command, definition);
    }
  }, service, {
    authorize: (payload, { sender }) => payload.groupActorId === "group-a" && sender?.id === "player-a"
  });
  const definition = registrations.get(TRANSPORT_CONSUME_FUEL_COMMAND);
  const payload = { groupActorId: "group-a", appliedMiles: 10 };
  const sender = { id: "player-a" };

  assert.equal(definition.validate(payload), true);
  assert.equal(await definition.authorize(payload, { sender }), true);
  await definition.execute(payload, { sender });
  assert.deepEqual(calls, [payload]);
});
