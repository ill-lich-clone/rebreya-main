import test from "node:test";
import assert from "node:assert/strict";
import { registerSandChildCommands } from "../scripts/infrastructure/foundry/sand-child-command.js";

test("registers bounded sand child requests and delegates authenticated sender", async () => {
  const seen = new Map();
  const gateway = { registerCommand: (name, definition) => seen.set(name, definition) };
  const service = { canControl: async (_uuid, sender) => sender?.id === "owner", activate: async (_payload, context) => context };
  registerSandChildCommands(gateway, service);
  const activation = seen.get("combat.sandChild.activate");
  const payload = { tokenUuid: "Scene.s.Token.t", itemUuid: "Actor.a.Item.i", messageId: "message" };
  assert.equal(activation.validate(payload), true);
  assert.equal(activation.validate({ ...payload, messageId: "x".repeat(500) }), false);
  assert.equal(activation.validate({ ...payload, total: 200 }), false);
  assert.equal(await activation.authorize(payload, { sender: { id: "other" } }), false);
  assert.equal(await activation.authorize(payload, { sender: { id: "owner" } }), true);
  const context = { sender: { id: "owner" }, operationId: "op" };
  assert.equal(await activation.execute(payload, context), context);
  const manual = seen.get("combat.sandChild.placeManual");
  const cell = { tokenUuid: payload.tokenUuid, effectId: "effect", row: 2, col: 1 };
  assert.equal(manual.validate(cell), true);
  assert.equal(await manual.authorize(cell, { sender: { id: "owner" } }), false);
  assert.equal(await manual.authorize(cell, { sender: { id: "owner", isGM: true } }), true);
});
