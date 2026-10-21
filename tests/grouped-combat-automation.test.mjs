import assert from "node:assert/strict";
import test from "node:test";
import { planRebreyaCombatAutomation } from "../scripts/combat/grouped-turn-automation.js";
import { ImplantAutomationService } from "../scripts/combat/implant-automation-service.js";

test("Rebreya phase dispatch identifies each member and runs group-wide cleanup once", async () => {
  const calls = [];
  const combatants = ["a", "b", "c"].map(id => ({ id, actor: { id }, token: { id } }));
  const combat = { id: "fight", round: 1, turn: 0, combatants, turns: combatants, combatant: combatants[0] };
  const moduleApi = {
    fighterAutomationService: { async handleCombatTurnChange(_combat, context) { calls.push(["fighter", context.combatantId]); } },
    combatAttackService: { async handleGroupedCombatPhase(_combat, phase) { calls.push(["attack", phase.memberIds.join()]); } },
    raceAutomationService: { handleCombatTurnChange() { calls.push(["race", "once"]); } }
  };
  for (const step of planRebreyaCombatAutomation(moduleApi, combat, { kind: "turn-start", round: 1, groupId: "g", memberIds: ["a", "b", "c"] })) await step.run();
  assert.deepEqual(calls.filter(c => c[0] === "fighter").map(c => c[1]), ["a", "b", "c"]);
  calls.length = 0;
  for (const step of planRebreyaCombatAutomation(moduleApi, combat, { kind: "each-turn", round: 1, groupId: "g", memberIds: ["a", "b", "c"] })) await step.run();
  assert.deepEqual(calls.filter(c => c[0] === "race"), [["race", "once"]]);
});
test("grouped implant movement tracks independent actors and preserves ordinary counters", async () => {
  const service = new ImplantAutomationService();
  const actors = ["a", "b"].map(id => ({ id, uuid: `Actor.${id}` }));
  const combat = { id: "fight", round: 1, turn: 0, combatants: actors.map(actor => ({ id: actor.id, actor })) };
  await service.handleGroupedCombatPhase(combat, { kind: "turn-start", round: 1, groupId: "g", memberIds: ["a", "b"] });
  assert.equal(service.recordMovement(actors[0], 5), true);
  assert.equal(service.recordMovement(actors[1], 10), true);
  await service.handleGroupedCombatPhase(combat, { kind: "turn-end", round: 1, groupId: "g", memberIds: ["a", "b"] });
  assert.equal(service.completedTurnDistances.get("Actor.a"), 5);
  assert.equal(service.completedTurnDistances.get("Actor.b"), 10);
  assert.equal(service.recordMovement(actors[0], 5), false);
});
