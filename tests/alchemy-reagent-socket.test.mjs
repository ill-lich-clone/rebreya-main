import test from "node:test";
import assert from "node:assert/strict";
import { registerAlchemyReagentSocketCommand } from "../scripts/integrations/alchemy-reagent-socket.js";

test("reagent command accepts only an exact chat-message identity and delegates authorization", async () => {
  const registered = new Map();
  const gateway = { registerCommand(name, definition) { registered.set(name, definition); } };
  const sender = { id: "player" };
  const message = { uuid: "ChatMessage.message1" };
  const calls = [];
  const service = {
    async authorizeReservation(value, user) { calls.push(["authorize-reservation", value, user]); return user === sender; },
    async reserveUse(value, context) { calls.push(["reserve", value, context.sender]); return { status: "reserved" }; },
    canCancelReservation() { return true; },
    cancelReservation() { return true; },
    async authorizeRecordedUse(value, user) { calls.push(["authorize", value, user]); return user === sender; },
    async applyRecordedUse(value, context) { calls.push(["apply", value, context.sender]); return { ok: true }; }
  };
  const fromUuid = async (uuid) => uuid === message.uuid ? message : null;
  assert.equal(registerAlchemyReagentSocketCommand(gateway, service, { fromUuid }), true);
  const apply = registered.get("alchemy-reagent.apply");
  const reserve = registered.get("alchemy-reagent.reserve");
  const payload = { operationId: "op1", sourceActorUuid: "Actor.source", sourceItemId: "item1",
    targetActorUuid: "Actor.target", targetTokenUuid: "Scene.scene1.Token.target1", productId: "alchemy-1",
    durationSeconds: 60, reagentLevel: 2 };
  assert.equal(reserve.validate(payload), true);
  assert.equal(reserve.validate({ ...payload, extra: true }), false);
  assert.equal(reserve.validate({ ...payload, operationId: 123 }), false);
  assert.equal(reserve.validate({ ...payload, sourceItemId: null }), false);
  assert.equal(reserve.validate({ ...payload, operationId: "constructor" }), false);
  assert.equal(registered.get("alchemy-reagent.cancel").validate({ operationId: 123 }), false);
  assert.equal(await reserve.authorize(payload, { sender }), true);
  assert.deepEqual(await reserve.execute(payload, { sender }), { status: "reserved" });
  assert.equal(apply.validate({ messageUuid: message.uuid }), true);
  assert.equal(apply.validate({ messageUuid: message.uuid, target: "Actor.other" }), false);
  assert.equal(apply.validate({ messageUuid: "Actor.source" }), false);
  assert.equal(await apply.authorize({ messageUuid: message.uuid }, { sender }), true);
  assert.deepEqual(await apply.execute({ messageUuid: message.uuid }, { sender }), { ok: true });
  assert.deepEqual(calls.map((call) => call[0]), ["authorize-reservation", "reserve", "authorize", "apply"]);
});
