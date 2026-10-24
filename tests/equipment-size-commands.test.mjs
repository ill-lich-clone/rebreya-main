import test from "node:test";
import assert from "node:assert/strict";
import { isValidCreatureResizePayload, registerEquipmentSizeCommands } from "../scripts/application/equipment-size-commands.js";
const payload = () => ({ actorUuid: "Actor.hero", tokenUuid: "Scene.scene.Token.hero", size: "lg", weaponIds: ["sword"],
  expected: { actorSize: "med", token: { x: 1, y: 2, width: 1, height: 1 }, weapons: [{ id: "sword", signature: "a".repeat(64) }] } });
test("strict resize intent rejects patches, duplicates, malformed snapshots and unsupported categories", () => {
  assert.equal(isValidCreatureResizePayload(payload()), true);
  for (const p of [{ ...payload(), patch: {} }, { ...payload(), size: "large" }, { ...payload(), weaponIds: ["sword", "sword"] },
    { ...payload(), expected: { ...payload().expected, token: { x: NaN, y: 0, width: 1, height: 1 } } }]) assert.equal(isValidCreatureResizePayload(p), false);
});
test("typed command uses existing Actor queue and forwards authenticated sender and active-GM assertion", async () => {
  let command, definition, invocation;
  registerEquipmentSizeCommands({ equipmentSizeService: { authorizeCreatureResize: async (_, sender) => sender.id === "owner",
    resizeCreature: async (...args) => invocation = args } }, { register: (c, d) => { command = c; definition = d; } });
  assert.equal(command, "equipment.resize-creature");
  assert.deepEqual(definition.scheduling.keys(payload()), ["actor:hero"]);
  assert.equal(await definition.authorize(payload(), { sender: { id: "owner" } }), true);
  let asserted = false;
  await definition.execute(payload(), { sender: { id: "owner" }, assertActiveGm: () => { asserted = true; } });
  assert.equal(asserted, true);
  assert.equal(invocation[1].senderUserId, "owner");
});
