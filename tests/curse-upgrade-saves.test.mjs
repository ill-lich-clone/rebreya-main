import test from "node:test";
import assert from "node:assert/strict";
import { CurseUpgradeSaveAdapter, isDamageOnlySaveActivity } from "../scripts/combat/curse-upgrade-saves.js";

function fixture() {
  const actor = { uuid: "Actor.owner" };
  const source = { key: "success", host: { uuid: "Actor.owner.Item.host" } };
  const state = {};
  const calls = [];
  let now = 100;
  const service = {
    isAuthority: () => true,
    sources: (_actor, key) => key === source.key ? [source] : [],
    state: () => state,
    writeState: async (_source, patch) => Object.assign(state, patch),
    prompt: async () => { calls.push("prompt"); return true; },
    restrain: async (target) => calls.push(target.uuid),
    now: () => now
  };
  const adapter = new CurseUpgradeSaveAdapter(service);
  return { actor, source, state, calls, service, adapter, advance: () => { now += 61; } };
}

test("failed save may become success once; next save fails and cannot prompt; repeat event is idempotent", async () => {
  const f = fixture();
  const first = await f.adapter.resolveSaveAuthority(f.actor, { eventId: "a", saved: false });
  assert.equal(first.saved, true);
  assert.equal(f.state.successUsed, true);
  assert.equal(f.state.forcedFailurePending, true);
  assert.deepEqual(await f.adapter.resolveSaveAuthority(f.actor, { eventId: "a", saved: false }), first);
  assert.equal((await f.adapter.resolveSaveAuthority(f.actor, { eventId: "b", saved: true })).saved, false);
  assert.equal(f.state.forcedFailurePending, false);
  assert.equal((await f.adapter.resolveSaveAuthority(f.actor, { eventId: "c", saved: false })).saved, false);
  assert.deepEqual(f.calls, ["prompt"]);
});

test("concurrent saves serialize the once-rest choice and debt", async () => {
  const f = fixture();
  const results = await Promise.all(["a", "b"].map(eventId => f.adapter.resolveSaveAuthority(f.actor, { eventId, saved: false })));
  assert.deepEqual(results.map(r => r.saved), [true, false]);
  assert.equal(f.calls.length, 1);
});

test("persisted receipts survive adapter reload without consuming the new debt", async () => {
  const f = fixture();
  const request = { eventId: "a", saved: false };
  await f.adapter.resolveSaveAuthority(f.actor, request);
  const replacement = new CurseUpgradeSaveAdapter(f.service);
  assert.equal((await replacement.resolveSaveAuthority(f.actor, request)).saved, true);
  assert.equal(f.state.forcedFailurePending, true);
  await replacement.resolveSaveAuthority(f.actor, { eventId: "b", saved: true });
  f.state.forcedFailurePending = true;
  const third = new CurseUpgradeSaveAdapter(f.service);
  assert.equal((await third.resolveSaveAuthority(f.actor, { eventId: "b", saved: true })).forced, true);
  assert.equal(f.state.forcedFailurePending, true);
  assert.deepEqual(f.calls, ["prompt"]);
});

test("unequipping a source cannot evade pending debt", async () => {
  const f = fixture();
  f.state.forcedFailurePending = true;
  f.service.sources = () => [];
  f.service.debtSources = () => [f.source];
  assert.equal((await f.adapter.resolveSaveAuthority(f.actor, { eventId: "a", saved: true })).saved, false);
  assert.equal(f.state.forcedFailurePending, false);
});

test("revalidation identifies the exact upgrade when two upgrades share a host", async () => {
  const f = fixture();
  f.source.upgrade = { id: "chosen" };
  const other = { ...f.source, upgrade: { id: "other" } };
  let prompted = false;
  f.service.sources = () => prompted ? [other] : [f.source];
  f.service.prompt = async () => { prompted = true; return true; };
  assert.equal((await f.adapter.resolveSaveAuthority(f.actor, { eventId: "a", saved: false })).saved, false);
  assert.deepEqual(f.state, {});
});

test("decline and failed persistence do not mutate save outcome", async () => {
  const f = fixture();
  f.service.prompt = async () => false;
  assert.equal((await f.adapter.resolveSaveAuthority(f.actor, { eventId: "a", saved: false })).saved, false);
  assert.deepEqual(f.state, {});
  f.service.prompt = async () => true;
  f.service.writeState = async () => { throw new Error("storage unavailable"); };
  await assert.rejects(f.adapter.resolveSaveAuthority(f.actor, { eventId: "b", saved: false }), /storage unavailable/);
});

test("non-authority cannot write save or chains state", async () => {
  const f = fixture();
  f.service.isAuthority = () => false;
  assert.equal((await f.adapter.resolveSaveAuthority(f.actor, { eventId: "a", saved: false })).saved, false);
  f.source.key = "chains";
  await f.adapter.resolveMidiChainAuthority(f.actor, { uuid: "Actor.target" }, { eventId: "b", saved: false, damageOnly: true });
  assert.deepEqual(f.state, {});
  assert.deepEqual(f.calls, []);
});

test("chains restrain failed target, cooldown success restrains source, ready success does nothing", async () => {
  const f = fixture();
  f.source.key = "chains";
  const target = { uuid: "Actor.target" };
  await f.adapter.resolveMidiChainAuthority(f.actor, target, { eventId: "a", saved: false, damageOnly: true });
  assert.equal(f.state.chainsReadyAt, 160);
  assert.deepEqual(f.calls, ["prompt", "Actor.target"]);
  await f.adapter.resolveMidiChainAuthority(f.actor, target, { eventId: "b", saved: true, damageOnly: true });
  assert.deepEqual(f.calls, ["prompt", "Actor.target", "Actor.owner"]);
  f.advance();
  await f.adapter.resolveMidiChainAuthority(f.actor, target, { eventId: "c", saved: true, damageOnly: true });
  assert.equal(f.calls.length, 3);
});

test("damage-only requires save damage and excludes effects or healing", () => {
  const activity = { type: "save", damage: { parts: [{ types: new Set(["fire"]) }] }, effects: [] };
  assert.equal(isDamageOnlySaveActivity(activity), true);
  assert.equal(isDamageOnlySaveActivity({ ...activity, effects: [{ _id: "condition" }] }), false);
  assert.equal(isDamageOnlySaveActivity({ ...activity, damage: { parts: [{ types: new Set(["healing"]) }] } }), false);
  assert.equal(isDamageOnlySaveActivity({ type: "save" }), false);
});

test("native boundary awaits authority before posting and preserves dice total", async () => {
  const f = fixture();
  let received;
  f.service.resolveSaveRequest = async request => { received = request; return { saved: true, forced: false }; };
  const roll = { total: 7, options: { target: 15 } };
  await f.adapter.applyNativeBuildPost([roll], { subject: f.actor, hookNames: ["SavingThrow"] }, {});
  assert.equal(received.saved, false);
  assert.equal(roll.total, 7);
  assert.equal(roll.options.target, 7);
  assert.equal(roll.options.rebreyaCurseSave.originalTarget, 15);
});

test("native boundary skips unevaluated and unknown DC saves", async () => {
  const f = fixture();
  f.service.resolveSaveRequest = async () => { throw new Error("must not resolve"); };
  await f.adapter.applyNativeBuildPost([{ total: 7, options: {} }], { subject: f.actor, hookNames: ["SavingThrow"] }, {});
  await f.adapter.applyNativeBuildPost([{ total: 7, options: { target: 15 } }], { subject: f.actor, hookNames: ["SavingThrow"], evaluate: false }, {});
});

test("MIDI native owner boundary records a receipt without retargeting the original roll", async () => {
  const f = fixture();
  const requests = [];
  f.service.resolveSaveRequest = request => { requests.push(request); return f.adapter.resolveSaveAuthority(f.actor, request); };
  const roll = { total: 7, options: { target: 15 } };
  await f.adapter.applyNativeBuildPost([roll], {
    subject: f.actor, hookNames: ["SavingThrow"], midiOptions: { workflowId: "workflow" }
  }, {});
  assert.equal(roll.options.target, 15);
  assert.equal(requests[0].eventId, "curse-save:workflow:Actor.owner");
  assert.equal(requests[0].sourceActorUuid, undefined);
  assert.equal(f.state.forcedFailurePending, true);
  const target = { uuid: "Scene.s.Token.t", id: "t", actor: f.actor };
  await f.adapter.applyMidiPostCheckSaves({
    id: "workflow", actor: { uuid: "Actor.attacker" }, activity: { type: "save" },
    saves: new Set(), failedSaves: new Set([target])
  });
  assert.equal(requests[1].eventId, requests[0].eventId);
  assert.equal(f.state.forcedFailurePending, true);
  assert.deepEqual(f.calls, ["prompt"]);
});

test("MIDI targets without success sources or debt do not send a save adjustment request", async () => {
  const f = fixture();
  f.service.sources = () => [];
  f.service.resolveSaveRequest = async () => { throw new Error("must not request"); };
  const target = { uuid: "Scene.s.Token.t", id: "t", actor: f.actor };
  await f.adapter.applyMidiPostCheckSaves({ id: "workflow", activity: { type: "save" }, saves: new Set([target]), failedSaves: new Set() });
});

test("unchanged native MIDI receipt survives reload without undoing later successful MIDI bonuses", async () => {
  const f = fixture();
  f.service.prompt = async () => false;
  f.service.resolveSaveRequest = request => f.adapter.resolveSaveAuthority(f.actor, request);
  await f.adapter.applyNativeBuildPost([{ total: 7, options: { target: 15 } }], {
    subject: f.actor, hookNames: ["SavingThrow"], midiOptions: { workflowId: "workflow" }
  }, {});
  assert.equal(f.state.saveReceipts[0].result.override, false);
  const replacement = new CurseUpgradeSaveAdapter(f.service);
  f.service.resolveSaveRequest = request => replacement.resolveSaveAuthority(f.actor, request);
  const target = { uuid: "Scene.s.Token.t", id: "t", actor: f.actor };
  const workflow = { id: "workflow", activity: { type: "save" }, saves: new Set([target]), failedSaves: new Set() };
  await replacement.applyMidiPostCheckSaves(workflow);
  assert.equal(workflow.saves.has(target), true);
  assert.equal(workflow.failedSaves.has(target), false);
});

// Installed dnd5e 5.2.5 rollDeathSave checks the DC first, then critical/fumble in the selected branch.
function consumeNativeDeathSave(roll) {
  if (roll.total >= (roll.options.target ?? 10)) {
    return roll.isCritical ? { hp: 1, successes: 0, failures: 0 } : { successes: 1, failures: 0 };
  }
  return { successes: 0, failures: roll.isFumble ? 2 : 1 };
}

test("native forced failure on natural 20 cannot trigger death-save resurrection", async () => {
  const f = fixture();
  f.state.forcedFailurePending = true;
  f.service.resolveSaveRequest = request => f.adapter.resolveSaveAuthority(f.actor, request);
  const roll = { total: 20, isCritical: true, isFumble: false, options: { target: 10 } };
  await f.adapter.applyNativeBuildPost([roll], { subject: f.actor, hookNames: ["deathSave", "SavingThrow"] }, {});
  assert.deepEqual(consumeNativeDeathSave(roll), { successes: 0, failures: 1 });
  assert.equal(roll.total, 20);
  assert.equal(f.state.forcedFailurePending, false);
});

test("native chosen success on natural 1 does not count two death-save failures", async () => {
  const f = fixture();
  f.service.resolveSaveRequest = request => f.adapter.resolveSaveAuthority(f.actor, request);
  const roll = { total: 1, isCritical: false, isFumble: true, options: { target: 10 } };
  await f.adapter.applyNativeBuildPost([roll], { subject: f.actor, hookNames: ["deathSave", "SavingThrow"] }, {});
  assert.deepEqual(consumeNativeDeathSave(roll), { successes: 1, failures: 0 });
  assert.equal(roll.total, 1);
  assert.equal(f.state.forcedFailurePending, true);
});

test("MIDI canonical sets and display agree after awaited change and duplicate hook is ignored", async () => {
  const f = fixture();
  const target = { uuid: "Scene.s.Token.t", id: "t", actor: f.actor };
  const requests = [];
  f.service.resolveSaveRequest = async request => { requests.push(request); return { saved: true }; };
  const workflow = { id: "workflow", actor: { uuid: "Actor.attacker" }, activity: { type: "save" }, saves: new Set(), failedSaves: new Set([target]), saveDisplayData: [{ target, saveClass: "failure", saveSymbol: "midi-qol-save-symbol fa-xmark" }] };
  await f.adapter.applyMidiPostCheckSaves(workflow);
  await f.adapter.applyMidiPostCheckSaves(workflow);
  assert.equal(requests.length, 1);
  assert.equal(workflow.saves.has(target), true);
  assert.equal(workflow.failedSaves.has(target), false);
  assert.equal(workflow.saveDisplayData[0].saveClass, "success");
  assert.match(workflow.saveDisplayData[0].saveSymbol, /fa-check/);
});

test("MIDI requests carry source activity, token and actual message evidence for remote authorization", async () => {
  const f = fixture();
  const requests = [];
  f.service.resolveSaveRequest = async request => { requests.push(request); return { saved: false }; };
  const target = { uuid: "Scene.s.Token.t", id: "t", actor: f.actor };
  const workflow = {
    id: "wf", itemCardId: "card", actor: { uuid: "Actor.attacker" },
    activity: { uuid: "Actor.attacker.Item.spell.Activity.save", type: "save", effects: [], damage: { parts: [{ types: ["fire"] }] } },
    saves: new Set(), failedSaves: new Set([target])
  };
  await f.adapter.applyMidiPostCheckSaves(workflow);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.sourceActorUuid, "Actor.attacker");
    assert.equal(request.itemCardUuid, "ChatMessage.card");
    assert.equal(request.activityUuid, workflow.activity.uuid);
    assert.equal(request.targetUuid, target.uuid);
    assert.equal(request.workflowId, "wf");
  }
});

test("chain receipt survives reload and does not convert replayed activation into backlash", async () => {
  const f = fixture();
  f.source.key = "chains";
  const request = { eventId: "a", saved: false, damageOnly: true };
  await f.adapter.resolveMidiChainAuthority(f.actor, { uuid: "Actor.target" }, request);
  const replacement = new CurseUpgradeSaveAdapter(f.service);
  await replacement.resolveMidiChainAuthority(f.actor, { uuid: "Actor.target" }, request);
  assert.deepEqual(f.calls, ["prompt", "Actor.target"]);
});

test("chain intent survives ambiguous effect failure and replay recovers before returning its receipt", async () => {
  const f = fixture();
  f.source.key = "chains";
  const target = { uuid: "Actor.target" };
  const request = { eventId: "chain-failure", saved: false, damageOnly: true };
  f.service.restrain = async () => { throw new Error("connection lost after effect create"); };
  await assert.rejects(f.adapter.resolveMidiChainAuthority(f.actor, target, request), /connection lost/);
  assert.equal(f.state.chainsReadyAt, 160);
  assert.deepEqual(f.state.chainsPending, { targetActorUuid: target.uuid, eventId: request.eventId, expiresAt: 112 });
  assert.equal(f.state.saveReceipts[0].result.applied, true);
  let recovered = false;
  f.service.recoverPendingChains = async source => {
    assert.equal(source, f.source);
    assert.equal(f.state.chainsPending.expiresAt, 112);
    recovered = true;
    await f.service.writeState(source, { chainsPending: null });
  };
  const replacement = new CurseUpgradeSaveAdapter(f.service);
  assert.equal((await replacement.resolveMidiChainAuthority(f.actor, target, request)).applied, true);
  assert.equal(recovered, true);
  assert.equal(f.state.chainsPending, null);
  assert.deepEqual(f.calls, ["prompt"]);
});

test("chain backlash reserves recoverable intent without extending cooldown", async () => {
  const f = fixture();
  f.source.key = "chains";
  f.state.chainsReadyAt = 140;
  f.service.restrain = async () => { throw new Error("ambiguous effect update"); };
  await assert.rejects(f.adapter.resolveMidiChainAuthority(f.actor, { uuid: "Actor.target" }, {
    eventId: "backlash", saved: true, damageOnly: true
  }), /ambiguous effect update/);
  assert.equal(f.state.chainsReadyAt, 140);
  assert.deepEqual(f.state.chainsPending, { targetActorUuid: f.actor.uuid, eventId: "backlash", expiresAt: 112 });
  assert.equal(f.state.saveReceipts[0].result.applied, true);
  assert.deepEqual(f.calls, []);
});

test("chain success clears intent only after status application", async () => {
  const f = fixture();
  f.source.key = "chains";
  let observed;
  f.service.restrain = async () => { observed = structuredClone(f.state.chainsPending); };
  await f.adapter.resolveMidiChainAuthority(f.actor, { uuid: "Actor.target" }, { eventId: "success", saved: false, damageOnly: true });
  assert.equal(observed.eventId, "success");
  assert.equal(f.state.chainsPending, null);
});
