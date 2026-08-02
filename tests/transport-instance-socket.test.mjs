import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TRANSPORT_IMPORT_COMMAND,
  TRANSPORT_SELECT_FUEL_COMMAND,
  TRANSPORT_UPDATE_STATE_COMMAND,
  registerTransportInstanceCommands
} from "../scripts/data/transport-instance-service.js";

const validImport = {
  groupActorId: "group-a",
  sourceActorUuid: "Compendium.world.rebreya-transport.Actor.lchtransport0001"
};

const validState = {
  groupActorId: "group-a",
  actorId: "vehicle-a",
  patch: {
    hpCurrent: 8,
    condition: "operational",
    reserveCurrent: 3,
    reserveCapacity: 10
  }
};

const validFuelSelection = {
  groupActorId: "group-a",
  actorId: "vehicle-a",
  itemUuid: "Compendium.world.goods.Item.coal"
};

function createRegisteredTransportCommandHarness() {
  const registrations = new Map();
  const importCalls = [];
  const updateCalls = [];
  const fuelSelectionCalls = [];
  const service = {
    canManageGroup: (_groupActorId, sender) => sender?.id === "player-a",
    async importIntoGroup(payload, context) {
      importCalls.push([structuredClone(payload), context]);
      return { actorId: "vehicle-created", ...payload };
    },
    async updateInstanceState(payload, context) {
      updateCalls.push([structuredClone(payload), context]);
      return { actorId: payload.actorId, groupActorId: payload.groupActorId };
    },
    async selectFuel(payload, context) {
      fuelSelectionCalls.push([structuredClone(payload), context]);
      return { actorId: payload.actorId, groupActorId: payload.groupActorId };
    }
  };
  const commandBus = {
    register(command, definition) {
      registrations.set(command, definition);
    }
  };
  registerTransportInstanceCommands(commandBus, service);
  return { registrations, importCalls, updateCalls, fuelSelectionCalls };
}

test("registered import command validates and authorizes the authenticated sender", async () => {
  const harness = createRegisteredTransportCommandHarness();
  const definition = harness.registrations.get(TRANSPORT_IMPORT_COMMAND);
  const sender = { id: "player-a", isGM: false };

  assert.equal(definition.validate(validImport), true);
  assert.equal(definition.validate({ ...validImport, forged: true }), false);
  assert.equal(await definition.authorize(validImport, { sender }), true);
  assert.equal(
    await definition.authorize(validImport, { sender: { id: "stranger", isGM: false } }),
    false
  );
  const result = await definition.execute(validImport, { sender });
  assert.equal(result.actorId, "vehicle-created");
  assert.equal(harness.importCalls[0][1].sender, sender);
});

test("registered state command delegates only exact state payloads", async () => {
  const harness = createRegisteredTransportCommandHarness();
  const definition = harness.registrations.get(TRANSPORT_UPDATE_STATE_COMMAND);
  const sender = { id: "player-a", isGM: false };

  assert.equal(definition.validate(validState), true);
  assert.equal(definition.validate({
    ...validState,
    patch: { ...validState.patch, reserveCurrent: -1 }
  }), true);
  assert.equal(definition.validate({
    ...validState,
    patch: { ...validState.patch, actorId: "forged" }
  }), false);
  await definition.execute(validState, { sender });
  assert.equal(harness.updateCalls[0][1].sender, sender);
});

test("registered fuel command validates and delegates the exact Item selection", async () => {
  const harness = createRegisteredTransportCommandHarness();
  const definition = harness.registrations.get(TRANSPORT_SELECT_FUEL_COMMAND);
  const sender = { id: "player-a", isGM: false };

  assert.equal(definition.validate(validFuelSelection), true);
  assert.equal(definition.validate({ ...validFuelSelection, itemUuid: "" }), false);
  assert.equal(definition.validate({ ...validFuelSelection, forged: true }), false);
  assert.equal(await definition.authorize(validFuelSelection, { sender }), true);
  await definition.execute(validFuelSelection, { sender });
  assert.deepEqual(harness.fuelSelectionCalls[0][0], validFuelSelection);
  assert.equal(harness.fuelSelectionCalls[0][1].sender, sender);
});

test("main composes transport commands and exposes local-or-socket APIs", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

  assert.match(source, /TransportInstanceService/u);
  assert.match(source, /this\.transportInstanceService\s*=\s*new TransportInstanceService/u);
  assert.match(
    source,
    /registerTransportInstanceCommands\(this\.socketCommandBus,\s*this\.transportInstanceService\)/u
  );
  assert.match(source, /async importTransportIntoGroup\(payload\)/u);
  assert.match(source, /this\.socketCommandBus\.request\(TRANSPORT_IMPORT_COMMAND,\s*payload\)/u);
  assert.match(source, /async updateTransportInstanceState\(payload\)/u);
  assert.match(source, /this\.socketCommandBus\.request\(TRANSPORT_UPDATE_STATE_COMMAND,\s*payload\)/u);
  assert.match(source, /async selectTransportFuel\(payload\)/u);
  assert.match(source, /this\.socketCommandBus\.request\(TRANSPORT_SELECT_FUEL_COMMAND,\s*payload\)/u);
  assert.match(source, /this\.transportInstanceService\.importIntoGroup\(payload,\s*\{\s*sender:/u);
  assert.match(source, /this\.transportInstanceService\.updateInstanceState\(payload,\s*\{\s*sender:/u);
});
