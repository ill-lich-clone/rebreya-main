import test from "node:test";
import assert from "node:assert/strict";

const {
  registerCraftsmanGadgetSocketCommand
} = await import("../scripts/integrations/craftsman-gadget-socket.js");

test("registers one authorized active-GM command for Craftsman gadget mutations", async () => {
  const actor = {
    uuid: "Actor.craftsman",
    testUserPermission: (user, permission) => user.id === "owner" && permission === "OWNER"
  };
  const registrations = [];
  const executions = [];
  const moduleApi = {
    socketCommandBus: {
      register: (command, definition) => registrations.push([command, definition])
    },
    craftsmanGadgetService: {
      executeAuthoritativeMutation: async (payload) => {
        executions.push(payload);
        return true;
      }
    }
  };

  assert.equal(registerCraftsmanGadgetSocketCommand(moduleApi, {
    fromUuid: async (uuid) => uuid === actor.uuid ? actor : null
  }), true);
  assert.equal(registrations.length, 1);
  const [command, definition] = registrations[0];
  assert.equal(command, "craftsman.gadget.mutate");
  const payload = {
    kind: "use",
    actorUuid: actor.uuid,
    itemId: "item-id",
    gadgetId: "force-glove",
    operation: "activate",
    expectedInstanceId: "instance-id",
    expectedActiveInstanceId: "",
    expectedRestGeneration: "generation",
    templateUuids: []
  };
  assert.equal(definition.validate(payload), true);
  assert.equal(await definition.authorize(payload, { sender: { id: "owner", isGM: false } }), true);
  assert.equal(await definition.authorize(payload, { sender: { id: "stranger", isGM: false } }), false);
  assert.equal(await definition.authorize(payload, { sender: { id: "gm", isGM: true } }), true);
  assert.equal(await definition.execute(payload), true);
  assert.deepEqual(executions, [payload]);
});

test("rejects malformed gadget socket payloads before execution", async () => {
  const registrations = [];
  registerCraftsmanGadgetSocketCommand({
    socketCommandBus: {
      register: (command, definition) => registrations.push([command, definition])
    },
    craftsmanGadgetService: { executeAuthoritativeMutation: async () => true }
  });
  const definition = registrations[0][1];

  assert.equal(definition.validate({ kind: "use" }), false);
  assert.equal(definition.validate({
    kind: "rest",
    actorUuid: "Actor.craftsman",
    catalogIds: ["charged-boot"],
    restGeneration: "next",
    expectedRestGeneration: "current",
    expectedActiveInstanceId: "",
    vehicleUuid: ""
  }), false);
});
