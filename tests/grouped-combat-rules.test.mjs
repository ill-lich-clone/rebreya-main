import assert from "node:assert/strict";
import test from "node:test";
import { buildCombatTurnGroups, planGroupTransition, isGroupTransitionWithinBudget, buildPhaseStepKey, getActiveGroupMemberIds, isCombatActorActive } from "../scripts/combat/turn-group-rules.js";

const member = (id, extra = {}) => ({ combatantId: id, actorUuid: `Actor.${id}`, tokenUuid: `Scene.s.Token.${id}`, baseActorId: "goblin", disposition: -1, initiative: 15, initiativeKey: "1d20+2", groupable: true, ...extra });
test("adjacent groups remain distinct at very large safe round numbers", () => {
  const groups = ["a", "b", "c"].map(id => ({ id, memberIds: [id] }));
  const round = Number.MAX_SAFE_INTEGER - 1;
  const phases = planGroupTransition({ current: { round, groupId: "a" } }, { round, groupId: "b" }, groups);
  assert.deepEqual(phases.map(p => p.kind), ["turn-end", "each-turn", "turn-start"]);
  assert.deepEqual(phases.map(p => p.round), [round, round, round]);
});
test("phase budget accepts its boundary and rejects excess without traversing distant rounds", () => {
  const groups = [{ id: "a", memberIds: Array(200_000).fill("a") }];
  const state = { current: { round: 1, groupId: "a" } };
  assert.equal(isGroupTransitionWithinBudget(state, { round: 2, groupId: "a" }, groups), true);
  groups[0].memberIds.push("b");
  assert.equal(isGroupTransitionWithinBudget(state, { round: 2, groupId: "a" }, groups), false);
  assert.equal(isGroupTransitionWithinBudget(state, { round: Number.MAX_SAFE_INTEGER, groupId: "a" }, groups), false);
  assert.throws(() => planGroupTransition(state, { round: Number.MAX_SAFE_INTEGER, groupId: "a" }, groups), /combat-transition-too-large/);
});
test("a crowded encounter cannot schedule many participant-wide turn passes at once", () => {
  const groups = Array.from({ length: 200 }, (_, i) => ({ id: String(i), memberIds: [String(i)] }));
  const state = { current: { round: 1, groupId: "0" } };
  assert.equal(isGroupTransitionWithinBudget(state, { round: 1, groupId: "2" }, groups), true);
  assert.equal(isGroupTransitionWithinBudget(state, { round: 1, groupId: "3" }, groups), false);
});
test("a normal next turn can cross defeated groups without counting nonexistent each-turn phases", () => {
  const groups = Array.from({ length: 200 }, (_, i) => ({ id: String(i), memberIds: [String(i)] }));
  const state = { current: { round: 1, groupId: "0" } }, skipped = new Set(["1", "2", "3"]);
  assert.equal(isGroupTransitionWithinBudget(state, { round: 1, groupId: "4" }, groups, skipped), true);
  const phases = planGroupTransition(state, { round: 1, groupId: "4" }, groups, skipped);
  assert.equal(phases.filter(p => p.kind === "each-turn").length, 1);
  assert.equal(phases.at(-1).groupId, "4");
});
test("a long run of defeated single-creature groups does not inflate phase member costs", () => {
  const groups = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), memberIds: [String(i)] }));
  const skipped = new Set(groups.slice(1, 335).map(g => g.id));
  assert.equal(isGroupTransitionWithinBudget({ current: { round: 1, groupId: "0" } }, { round: 1, groupId: "335" }, groups, skipped), true);
});
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
