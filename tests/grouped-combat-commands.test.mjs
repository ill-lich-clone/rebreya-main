import assert from "node:assert/strict";
import test from "node:test";
import { isValidGroupedCombatStartPayload, isValidGroupedCombatTransitionPayload, isValidGroupedCombatResolvePayload, registerGroupedCombatCommands } from "../scripts/infrastructure/foundry/grouped-combat-command-contract.js";
import { buildStartCombatMacroData } from "../scripts/combat/grapple-macro-service.js";

test("wire shapes reject extra fields, foreign UUIDs, duplicates, nonfinite revisions and forged requester data", () => {
  const start = { sceneId: "s", tokenUuids: ["Scene.s.Token.a"], operationId: "op" };
  assert.equal(isValidGroupedCombatStartPayload(start), true);
  for (const patch of [{ requesterUserId: "gm" }, { tokenUuids: ["Actor.a"] }, { tokenUuids: ["Scene.x.Token.a"] }, { tokenUuids: ["Scene.s.Token.a", "Scene.s.Token.a"] }, { sceneId: " s" }]) assert.equal(isValidGroupedCombatStartPayload({ ...start, ...patch }), false);
  const transition = { combatId: "fight", targetRound: 1, targetGroupId: "g", expectedRevision: 2, operationId: "op" };
  assert.equal(isValidGroupedCombatTransitionPayload(transition), true);
  assert.equal(isValidGroupedCombatTransitionPayload({ ...transition, expectedRevision: Infinity }), false);
  assert.equal(isValidGroupedCombatResolvePayload({ combatId: "fight", expectedRevision: 2, stepKey: "step", resolution: "retry", operationId: "op" }), true);
  assert.equal(isValidGroupedCombatResolvePayload({ combatId: "fight", expectedRevision: 2, stepKey: "step", resolution: "skip", operationId: "op" }), false);
});
test("typed registration authorizes GM start/recovery and keeps authenticated sender for service authorization", async () => {
  const definitions = new Map(), seen = [];
  registerGroupedCombatCommands({ socketCommandBus: { register(name, definition) { definitions.set(name, definition); } }, groupedCombatService: {
    start: (_payload, { sender }) => seen.push(sender.id), transition: (_payload, { sender }) => seen.push(sender.id), resolveUncertainStep: () => {}
  } });
  assert.equal(definitions.get("combat.grouped.start").authorize({}, { sender: { isGM: false } }), false);
  assert.equal(definitions.get("combat.grouped.resolve").authorize({}, { sender: { isGM: false } }), false);
  await definitions.get("combat.grouped.transition").execute({}, { sender: { id: "authenticated" } });
  assert.deepEqual(seen, ["authenticated"]);
});
test("the managed start macro is only a stable public API invocation in the existing folder", () => {
  const data = buildStartCombatMacroData("folder");
  assert.equal(data.name, "Начать сражение"); assert.equal(data.folder, "folder");
  assert.equal(data.command, "await game.rebreyaMain?.startCombatFromSelection?.();");
  assert.equal(data.flags["rebreya-main"].sourceId, "start-combat-macro");
});
