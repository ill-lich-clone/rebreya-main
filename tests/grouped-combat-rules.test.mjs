import assert from "node:assert/strict";
import test from "node:test";
import { buildCombatTurnGroups, planGroupTransition, buildPhaseStepKey, getActiveGroupMemberIds, isCombatActorActive } from "../scripts/combat/turn-group-rules.js";

const member = (id, extra = {}) => ({ combatantId: id, actorUuid: `Actor.${id}`, tokenUuid: `Scene.s.Token.${id}`, baseActorId: "goblin", disposition: -1, initiative: 15, initiativeKey: "1d20+2", groupable: true, ...extra });
test("identical NPCs share one stable group; side, profile, linked tokens and established initiatives split it", () => {
  const groups = buildCombatTurnGroups([member("c"), member("b"), member("a"), member("pc", { groupable: false, initiative: 10 })]);
  assert.deepEqual(groups.map(g => g.memberIds), [["a", "b", "c"], ["pc"]]);
  assert.equal(buildCombatTurnGroups([member("b"), member("c")], groups)[0].id, groups[0].id);
  for (const extra of [{ baseActorId: "orc" }, { disposition: 1 }, { initiativeKey: "1d20+4" }, { initiativeKey: null }, { groupable: false }, { initiative: 17 }]) {
    assert.equal(buildCombatTurnGroups([member("a"), member("b", extra)]).length, 2);
  }
  assert.equal(buildCombatTurnGroups([member("a", { hp: 2, name: "Первый" }), member("b", { hp: 10, name: "Второй" })]).length, 1);
});
test("unrolled reinforcements join an unambiguous established group without discarding old initiatives", () => {
  assert.equal(buildCombatTurnGroups([member("a"), member("b", { initiative: null })]).length, 1);
  assert.equal(buildCombatTurnGroups([member("a"), member("b", { initiative: 17 }), member("c", { initiative: null })]).length, 3);
});
test("one group transition ends all members before entering the next; round phases and skipped groups are explicit", () => {
  const groups = buildCombatTurnGroups([member("a"), member("b"), member("c"), member("pc", { groupable: false, initiative: 10 })]);
  const state = { current: { round: 1, groupId: groups[0].id }, groups };
  const phases = planGroupTransition(state, { round: 1, groupId: groups[1].id }, groups);
  assert.deepEqual(phases.map(p => p.kind), ["turn-end", "each-turn", "turn-start"]);
  assert.deepEqual(phases[0].memberIds, ["a", "b", "c"]);
  assert.deepEqual(phases[2].memberIds, ["pc"]);
  assert.deepEqual(planGroupTransition({ ...state, current: { round: 1, groupId: groups[1].id } }, { round: 2, groupId: groups[0].id }, groups).map(p => p.kind), ["turn-end", "round-end", "round-start", "each-turn", "turn-start"]);
  assert.deepEqual(planGroupTransition(state, { round: 0, groupId: groups[0].id }, groups), []);
  assert.equal(planGroupTransition(state, { round: 2, groupId: groups[0].id }, groups).filter(p => p.kind === "turn-start").length, 2);
  const allTurnPhases = planGroupTransition(state, { round: 2, groupId: groups[0].id }, groups).filter(p => p.kind === "each-turn");
  assert.equal(allTurnPhases[0].groupId, groups[1].id);
  assert.notEqual(buildPhaseStepKey("fight", allTurnPhases[0], "all", "rebreya", "turn"), buildPhaseStepKey("fight", allTurnPhases[1], "all", "rebreya", "turn"));
});
test("start phases and receipt identity distinguish combatants even when they share an Actor", () => {
  const groups = buildCombatTurnGroups([member("linked-1", { groupable: false }), member("linked-2", { groupable: false, actorUuid: "Actor.linked-1" })]);
  const state = { mode: "active", groups, current: { round: 1, groupId: groups[0].id } };
  const start = planGroupTransition({ current: null }, state.current, groups);
  assert.deepEqual(start.map(p => p.kind), ["combat-start", "round-start", "each-turn", "turn-start"]);
  assert.notEqual(buildPhaseStepKey("fight", start.at(-1), "linked-1", "dae", "effect"), buildPhaseStepKey("fight", start.at(-1), "linked-2", "dae", "effect"));
  assert.deepEqual(getActiveGroupMemberIds(state), ["linked-1"]);
  const combat = { combatants: [{ id: "linked-1", actor: { uuid: "Actor.linked-1" } }], combatant: null };
  assert.equal(isCombatActorActive(combat, { uuid: "Actor.linked-1" }, state), true);
});
