import assert from "node:assert/strict";
import test from "node:test";
import { GroupedCombatService } from "../scripts/application/grouped-combat-service.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";

function setup() {
  const calls = [], positions = [], tokens = ["a", "b", "c", "pc"].map(id => ({ id, uuid: `Scene.s.Token.${id}`, parent: { id: "s" }, disposition: -1, actorLink: id === "pc", baseActor: { id: "goblin" }, actor: { id, uuid: `Actor.${id}`, type: id === "pc" ? "character" : "npc", getInitiativeRoll: () => ({ formula: "1d20+2", options: {} }) } }));
  const combat = { id: "fight", scene: { id: "s" }, round: 0, turn: null, started: false, flags: {}, combatants: [], turns: [], settings: { skipDefeated: true } };
  const repository = {
    getCombat: () => combat, getActiveCombat: () => combat, createCombat: async () => combat,
    readState: () => structuredClone(combat.flags["rebreya-main"]?.groupedCombat ?? null),
    async writeState(_combat, state, { expectedRevision } = {}) {
      const previous = combat.flags["rebreya-main"]?.groupedCombat;
      assert.equal(previous?.revision ?? 0, expectedRevision ?? 0);
      state.revision = (previous?.revision ?? 0) + 1;
      combat.flags["rebreya-main"] = { groupedCombat: structuredClone(state) }; return state;
    },
    async createMissingCombatants(_combat, selection) {
      for (const token of selection) if (!combat.combatants.some(c => c.token?.id === token.id)) combat.combatants.push({ id: token.id, token, actor: token.actor, initiative: null });
      combat.turns = combat.combatants;
    },
    async commitNativePosition(_combat, position) { positions.push(`${position.round}:${position.turn}`); Object.assign(combat, position, { started: position.round > 0 }); combat.combatant = combat.turns[combat.turn]; },
    async beginCombat(_combat, position) { return this.commitNativePosition(_combat, position); }
  };
  combat.rollInitiative = async ids => { for (const id of ids) { combat.combatants.find(c => c.id === id).initiative = id === "pc" ? 10 : 15; calls.push(`roll:${id}`); } };
  combat.updateEmbeddedDocuments = async (_type, updates) => { for (const update of updates) Object.assign(combat.combatants.find(c => c.id === update._id), update); };
  let fail = null, gate = null;
  const effects = { inspect: () => ({ supported: true }), plan: (_combat, phase) => phase.memberIds.map(id => ({ key: JSON.stringify([phase.kind, phase.round, phase.groupId, id]), combatantId: id, provider: "test", effectUuid: `effect:${id}`, async run() { if (id === fail) throw new Error("provider failure"); if (gate) await gate; calls.push(`${phase.kind}:${id}`); return { status: "completed" }; } })) };
  const service = new GroupedCombatService({ repository, effects, coordinator: new WorldMutationCoordinator(), resolveToken: uuid => tokens.find(t => t.uuid === uuid), gameProvider: () => ({ user: { isGM: true } }), isAuthority: () => true });
  const start = operationId => service.start({ sceneId: "s", tokenUuids: tokens.map(t => t.uuid), operationId }, { sender: { id: "gm", isGM: true } });
  return { service, combat, calls, positions, repository, tokens, start, setFail: id => { fail = id; }, setGate: value => { gate = value; } };
}

test("a native position failure has an explicit receipt and can be retried without repeating completed effects", async () => {
  const e = setup(), original = e.repository.beginCombat;
  e.repository.beginCombat = async () => { throw new Error("native-write-failed"); };
  assert.equal((await e.start("start")).ok, false);
  let state = e.repository.readState();
  const key = Object.keys(state.receipts).find(key => state.receipts[key].status === "uncertain");
  assert.ok(key, "the failed native position must be recoverable by the same explicit GM decision");
  e.repository.beginCombat = original;
  const result = await e.service.resolveUncertainStep({ combatId: "fight", expectedRevision: state.revision, stepKey: key, resolution: "retry", operationId: "retry" }, { sender: { isGM: true } });
  assert.equal(result.ok, true); assert.equal(e.combat.started, true);
  assert.equal(e.calls.filter(c => c === "turn-start:a").length, 1);
});

test("reconcile resumes a persisted transition only through confirmed receipts", async () => {
  const e = setup(); await e.start("start");
  const state = e.repository.readState(), before = e.calls.length;
  state.pendingTransition = { phases: [], target: state.current, operationId: "interrupted", committedPositions: [JSON.stringify(state.current)], lastPosition: state.current };
  await e.repository.writeState(e.combat, state, { expectedRevision: state.revision });
  await e.service.reconcile(e.combat);
  assert.equal(e.repository.readState().pendingTransition, undefined);
  assert.equal(e.calls.length, before);
});

test("a new GM cannot overwrite and replay the previous GM's running receipt through a fresh transition", async () => {
  const e = setup(); await e.start("start");
  const state = e.repository.readState(), before = e.calls.length;
  state.receipts.interrupted = { status: "running", operationId: "old-gm", provider: "midi-qol", phase: "turn-end" };
  state.pendingTransition = { phases: [], target: state.current, operationId: "old-gm", committedPositions: [JSON.stringify(state.current)], lastPosition: state.current };
  await e.repository.writeState(e.combat, state, { expectedRevision: state.revision });
  const result = await e.service.transition({ combatId: "fight", expectedRevision: state.revision, targetRound: 1, targetGroupId: state.groups[1].id, operationId: "new-gm" }, { sender: { isGM: true } });
  assert.equal(result.code, "combat-blocked");
  assert.equal(e.repository.readState().receipts.interrupted.status, "uncertain");
  assert.equal(e.calls.length, before);
});

test("skipDefeated skips a whole defeated group's own phases while retaining round boundaries", async () => {
  const e = setup(); await e.start("start");
  e.combat.combatants.find(c => c.id === "pc").isDefeated = true;
  const state = e.repository.readState(), before = e.calls.length;
  await e.service.transition({ combatId: "fight", expectedRevision: state.revision, targetRound: 2, targetGroupId: state.groups[0].id, operationId: "skip" }, { sender: { isGM: true } });
  const calls = e.calls.slice(before);
  assert.equal(calls.includes("turn-start:pc"), false); assert.equal(calls.includes("turn-end:pc"), false);
  assert.equal(calls.includes("round-start:a"), true); assert.equal(calls.includes("turn-start:a"), true);
});

test("deleting the active group does not add an invented turnTime interval", async () => {
  const e = setup(); await e.start("start"); const previousConfig = globalThis.CONFIG;
  globalThis.CONFIG = { time: { roundTime: 6, turnTime: 2 } };
  try {
    const state = e.repository.readState(), deltas = [], original = e.repository.commitNativePosition;
    e.repository.commitNativePosition = async (combat, position, options) => { deltas.push(options.worldTime.delta); return original(combat, position); };
    e.combat.combatants.splice(0, 3); e.combat.turn = 0; e.combat.combatant = e.combat.combatants[0];
    await e.service.transition({ combatId: "fight", expectedRevision: state.revision, targetRound: 1, targetGroupId: state.groups[1].id, operationId: "deleted" }, { sender: { isGM: true } });
    assert.deepEqual(deltas, [0]);
  } finally { globalThis.CONFIG = previousConfig; }
});
test("start rolls once per group; repeat preserves combat position and effects; next ends all members before PC", async () => {
  const e = setup(); assert.equal((await e.start("start")).ok, true);
  assert.deepEqual(e.calls.filter(c => c.startsWith("roll:")), ["roll:a", "roll:pc"]);
  assert.deepEqual(e.calls.filter(c => c.startsWith("turn-start:")), ["turn-start:a", "turn-start:b", "turn-start:c"]);
  const before = e.calls.length; await e.start("again"); assert.equal(e.calls.length, before);
  const state = e.repository.readState();
  const result = await e.service.transition({ combatId: "fight", targetRound: 1, targetGroupId: state.groups[1].id, expectedRevision: state.revision, operationId: "next" }, { sender: { isGM: true } });
  assert.equal(result.ok, true);
  assert.deepEqual(e.calls.filter(c => c.startsWith("turn-end:")), ["turn-end:a", "turn-end:b", "turn-end:c"]);
  assert.ok(e.calls.indexOf("turn-end:c") < e.calls.indexOf("turn-start:pc"));
});

test("conversion of an already started native combat waits for the next round without replaying the old round", async () => {
  const e = setup();
  await e.repository.createMissingCombatants(e.combat, e.tokens);
  for (const c of e.combat.combatants) c.initiative = c.id === "pc" ? 10 : 15;
  Object.assign(e.combat, { started: true, round: 4, turn: 2, combatant: e.combat.turns[2] });
  const result = await e.start("convert");
  assert.equal(result.pending, true); assert.equal(e.calls.length, 0); assert.equal(e.combat.turn, 2);
  const state = e.repository.readState();
  const transitioned = await e.service.transition({ combatId: "fight", expectedRevision: state.revision, targetRound: 5, targetGroupId: state.groups[0].id, operationId: "activate" }, { sender: { isGM: true } });
  assert.equal(transitioned.ok, true);
  assert.deepEqual(e.calls.filter(c => c.startsWith("turn-end:")), ["turn-end:c"]);
  assert.deepEqual(e.calls.filter(c => c.startsWith("turn-start:")), ["turn-start:a", "turn-start:b", "turn-start:c"]);
});

test("only the owner of a solo character may finish that current turn, and never an NPC group or another turn", async () => {
  const e = setup(); await e.start("start"); let state = e.repository.readState();
  const request = (operationId, groupId = state.groups[0].id, round = 2) => ({ combatId: "fight", expectedRevision: state.revision, targetRound: round, targetGroupId: groupId, operationId });
  assert.equal((await e.service.transition(request("npc"), { sender: { id: "player" } })).code, "forbidden");
  await e.service.transition(request("gm", state.groups[1].id, 1), { sender: { isGM: true } }); state = e.repository.readState();
  e.combat.combatant.actor.testUserPermission = sender => sender?.id === "owner";
  assert.equal((await e.service.transition(request("stranger"), { sender: { id: "stranger" } })).code, "forbidden");
  assert.equal((await e.service.transition(request("back", state.groups[0].id, 1), { sender: { id: "owner" } })).code, "forbidden");
  assert.equal((await e.service.transition(request("owned"), { sender: { id: "owner" } })).ok, true);
});

test("selection excludes all storage/object/actorless forms and an empty eligible selection makes no writes", async () => {
  const e = setup();
  e.tokens[0].actor.flags = { "rebreya-main": { mapObjectToken: true } };
  e.tokens[1].flags = { "rebreya-main": { mapObjectToken: true } };
  e.tokens[2].actor.system = { details: { type: { value: "object" } } };
  e.tokens[3].actor = null;
  const result = await e.start("objects");
  assert.equal(result.code, "no-creatures"); assert.equal(e.combat.combatants.length, 0); assert.equal(e.calls.length, 0); assert.deepEqual(e.combat.flags, {});
});
test("failures persist uncertain receipts; reload and explicit GM resolution never repeat completed damage", async () => {
  const e = setup(); e.setFail("b");
  assert.equal((await e.start("start")).ok, false);
  const state = e.repository.readState(); assert.equal(state.mode, "blocked");
  const key = Object.keys(state.receipts).find(key => state.receipts[key].status === "uncertain");
  assert.ok(key);
  const alreadyDone = e.calls.filter(c => c === "combat-start:a").length;
  e.setFail(null);
  const result = await e.service.resolveUncertainStep({ combatId: "fight", expectedRevision: state.revision, stepKey: key, resolution: "completed", operationId: "resolve" }, { sender: { isGM: true } });
  assert.equal(result.ok, true);
  assert.equal(e.calls.filter(c => c === "combat-start:a").length, alreadyDone);
  assert.equal((await e.service.resolveUncertainStep({ combatId: "fight" }, { sender: {} })).code, "forbidden");
});
test("two clicks with one revision cannot skip two groups, and rewind does not replay effects", async () => {
  const e = setup(); await e.start("start");
  const state = e.repository.readState(), request = { combatId: "fight", targetRound: 1, targetGroupId: state.groups[1].id, expectedRevision: state.revision };
  const results = await Promise.all([e.service.transition({ ...request, operationId: "one" }, { sender: { isGM: true } }), e.service.transition({ ...request, operationId: "two" }, { sender: { isGM: true } })]);
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.find(r => !r.ok).code, "stale-combat");
  const before = e.calls.length;
  let current = e.repository.readState();
  await e.service.transition({ ...request, expectedRevision: current.revision, targetGroupId: state.groups[0].id, operationId: "back" }, { sender: { isGM: true } });
  assert.equal(e.combat.turn, 0, "rewind still changes the physical native position");
  current = e.repository.readState();
  await e.service.transition({ ...request, expectedRevision: current.revision, operationId: "forward" }, { sender: { isGM: true } });
  assert.equal(e.calls.length, before);
  assert.equal(e.combat.turn, 3);
});
test("a multi-group jump commits each crossed native position before its start effects", async () => {
  const e = setup(); await e.start("start"); const state = e.repository.readState();
  await e.service.transition({ combatId: "fight", expectedRevision: state.revision, targetRound: 2, targetGroupId: state.groups[0].id, operationId: "jump" }, { sender: { isGM: true } });
  assert.deepEqual(e.positions, ["1:0", "1:3", "2:0"]);
});
test("existing storage/object combatants are excluded and initiative recovery runs for an established-group reinforcement", async () => {
  const e = setup(); await e.start("start");
  const storage = { id: "storage", actor: { id: "storage", type: "npc", getFlag: () => ({ enabled: true }), getInitiativeRoll: () => ({ formula: "1d20", options: {} }) } };
  storage.token = { id: "storage", uuid: "Scene.s.Token.storage", actor: storage.actor, parent: { id: "s" } };
  e.combat.combatants.push(storage);
  const newcomer = { ...e.tokens[0], id: "new", uuid: "Scene.s.Token.new", actor: { ...e.tokens[0].actor, id: "new", uuid: "Actor.new" } };
  e.tokens.push(newcomer);
  let recovered = 0;
  e.combat.combatants.push({ id: "new", actor: newcomer.actor, token: newcomer, initiative: null, recoverCombatUses: async periods => { if (periods.includes("initiative")) recovered++; } });
  await e.start("reinforcements");
  assert.equal(e.repository.readState().groups.some(g => g.memberIds.includes("storage")), false);
  assert.equal(recovered, 1);
});
test("removing a whole group does not block the next round on nonexistent combatants", async () => {
  const e = setup(); await e.start("start"); let state = e.repository.readState();
  await e.service.transition({ combatId: "fight", expectedRevision: state.revision, targetRound: 1, targetGroupId: state.groups[1].id, operationId: "pc" }, { sender: { isGM: true } });
  e.combat.combatants.splice(0, 3); e.combat.turn = 0; e.combat.combatant = e.combat.combatants[0];
  state = e.repository.readState();
  const result = await e.service.transition({ combatId: "fight", expectedRevision: state.revision, targetRound: 2, targetGroupId: state.groups[1].id, operationId: "next-round" }, { sender: { isGM: true } });
  assert.equal(result.ok, true); assert.equal(e.repository.readState().mode, "active");
});
test("native lifecycle joins the existing transition ticket; grouped world time counts logical turns", { timeout: 2000 }, async () => {
  const e = setup(); await e.start("start"); const previousConfig = globalThis.CONFIG;
  globalThis.CONFIG = { time: { roundTime: 6, turnTime: 2 } };
  const deltas = [], observed = [], original = e.repository.commitNativePosition;
  e.repository.commitNativePosition = async (combat, position, options) => { observed.push(e.service.observeNativeTransition(combat)); deltas.push(options.worldTime.delta); return original(combat, position); };
  try {
    let state = e.repository.readState();
    await e.service.transition({ combatId: "fight", expectedRevision: state.revision, targetRound: 1, targetGroupId: state.groups[1].id, operationId: "next" }, { sender: { isGM: true } });
    state = e.repository.readState();
    await e.service.transition({ combatId: "fight", expectedRevision: state.revision, targetRound: 2, targetGroupId: state.groups[0].id, operationId: "round" }, { sender: { isGM: true } });
    await Promise.all(observed); assert.deepEqual(deltas, [2, 4]);
  } finally { globalThis.CONFIG = previousConfig; }
});
test("losing active GM authority mid-workflow rejects the lifecycle ticket without writing after handover", { timeout: 2000 }, async () => {
  const e = setup(); await e.start("start"); const state = e.repository.readState(); let authority = true, release;
  e.service.isAuthority = () => authority; e.setGate(new Promise(resolve => { release = resolve; }));
  const transition = e.service.transition({ combatId: "fight", expectedRevision: state.revision, targetRound: 1, targetGroupId: state.groups[1].id, operationId: "handover" }, { sender: { isGM: true } });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const ticket = e.service.observeNativeTransition(e.combat);
  authority = false; release();
  const result = await transition;
  assert.equal(result.ok, false);
  await assert.rejects(ticket, /active-gm-changed/u);
});
test("a member removed during another member's awaited workflow is never processed from a stale phase snapshot", { timeout: 2000 }, async () => {
  const e = setup(); await e.start("start"); const state = e.repository.readState(); let release;
  e.setGate(new Promise(resolve => { release = resolve; }));
  const operation = e.service.transition({ combatId: "fight", expectedRevision: state.revision, targetRound: 1, targetGroupId: state.groups[1].id, operationId: "deleted-during-save" }, { sender: { isGM: true } });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  e.combat.combatants.splice(e.combat.combatants.findIndex(c => c.id === "b"), 1); release();
  assert.equal((await operation).ok, true);
  assert.equal(e.calls.includes("turn-end:b"), false); assert.equal(e.calls.includes("turn-end:c"), true);
});
