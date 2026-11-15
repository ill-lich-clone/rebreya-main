import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, mkdirSync, unlinkSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const installed = fileURLToPath(new URL("../../../../midi-qol/", import.meta.url));
const patch = fileURLToPath(new URL("patches/midi-qol.patch", import.meta.url));
const bundleName = "midi-qol.js";
const manifest = JSON.parse(readFileSync(join(installed, "module.json"), "utf8"));
const patchManifest = JSON.parse(readFileSync(new URL("manifest.json", import.meta.url), "utf8"));
const sourceHashes = patchManifest.files.find((file) => file.path === bundleName);
assert.equal(manifest.version, patchManifest.beforeVersion, "The installed Midi-QOL is a different release");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function readSource() {
  const original = readFileSync(join(installed, bundleName));
  assert.equal(sha256(original), sourceHashes.beforeSha256, "Installed Midi-QOL does not match the exact patch source");
  if (process.env.MIDI_DISCONNECT_TEST_UNPATCHED === "1") return original.toString("utf8");
  const workspace = mkdtempSync(join(tmpdir(), "rebreya-midi-"));
  const copy = join(workspace, "midi-qol", bundleName);
  mkdirSync(dirname(copy));
  writeFileSync(copy, original);
  try {
    execFileSync("git", ["-c", "core.autocrlf=false", "apply", patch], { cwd: workspace });
    const patched = readFileSync(copy);
    assert.equal(sha256(patched), sourceHashes.afterSha256, "Patched Midi-QOL does not match the manifest");
    execFileSync(process.execPath, ["--check", copy]);
    execFileSync("git", ["-c", "core.autocrlf=false", "apply", "--reverse", patch], { cwd: workspace });
    assert.deepEqual(readFileSync(copy), original, "Reverse patch must restore the original bytes");
    return patched.toString("utf8");
  } finally {
    unlinkSync(copy);
    rmdirSync(dirname(copy));
    rmdirSync(workspace);
  }
}

const source = readSource();

function extract(start, end, from = 0) {
  const first = source.indexOf(start, from);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= from && last > first, `Missing installed bundle anchors: ${start} / ${end}`);
  return source.slice(first, last);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

function fakeTimers() {
  const pending = new Map();
  const durations = new Map();
  let id = 0;
  return {
    pending, durations,
    setTimeout(callback, delay) {
      pending.set(++id, callback);
      durations.set(id, delay);
      return id;
    },
    clearTimeout(timer) { pending.delete(timer); durations.delete(timer); },
    expire(timer) {
      const callback = pending.get(timer);
      this.clearTimeout(timer);
      callback();
    }
  };
}

function reactionFixture({ choose, deletePrompt = () => {}, isGM = false }) {
  const timer = fakeTimers();
  const errors = [];
  let deleted = 0;
  let reset = 0;
  const target = {
    name: "target",
    document: { uuid: "token" },
    actor: { flags: { midi: { optional: { shield: { ac: 2 } } } }, items: [], reset: () => reset++ }
  };
  const sourceCode = extract("async function doReactions(", "async function promptReactions(");
  const api = runInNewContext(`${sourceCode}\n ({ doReactions, pauseReactionTimeout,
    extendReactionTimeout: typeof extendReactionTimeout === "function" ? extendReactionTimeout : undefined,
    remoteExtension: typeof _extendReactionTimer === "function" ? _extendReactionTimer : undefined })`, {
    ...timer,
    getToken: (token) => token,
    getTokenDocument: (token) => token.document,
    checkIncapacitated: () => false,
    playerFor: () => ({ id: "owner", active: true, isGM }),
    hasUsedReaction: () => false,
    getReactionSetting: () => "all",
    maxCastLevel: () => 1,
    enableNotifications() {},
    asyncHooksCall: async () => true,
    reactionTriggerLabelFor: () => "isAttacked",
    reactionPromptFor: () => "trigger",
    game: { user: { id: "owner" }, i18n: { format: () => "reaction" } },
    ChatMessage: { create: async () => ({ delete() { deleted++; return deletePrompt(); } }) },
    Workflow: { getWorkflow() {} },
    configSettings: { reactionTimeout: 30, showReactionChatMessage: true },
    showReactionAttackRollOptions: {},
    foundry: { utils: { randomID: () => "reaction-id" } },
    reactionTimers: new Map(),
    socketlibSocket: { executeAsUser: choose },
    unTimedExecuteAsGM: choose,
    busyWait: async () => {},
    DAE: { actionQueue: { remaining: 0 } },
    TroubleShooter: { recordError: (error) => errors.push(error) },
    debugEnabled: 0,
    MODULE_ID: "midi",
    error() {}
  });
  return {
    start: () => api.doReactions(target, "source", {}, "reactionattacked"),
    extend: api.extendReactionTimeout,
    remoteExtension: (request, userId) => api.remoteExtension.call({ socketdata: { userId } }, request),
    pause: api.pauseReactionTimeout,
    timer,
    errors,
    get deleted() { return deleted; },
    get reset() { return reset; }
  };
}

test("chooseReactions rejection settles immediately, clears its timer, and deletes the whisper once", async () => {
  const rpc = deferred();
  const disconnect = new Error("SocketlibInvalidUserError");
  const failedDelete = new Error("prompt was already deleted");
  const fixture = reactionFixture({ choose: () => rpc.promise, deletePrompt: () => Promise.reject(failedDelete) });
  const result = fixture.start();
  let settled = false;
  result.then(() => { settled = true; });
  await turn();
  const [timerId] = fixture.timer.pending.keys();
  rpc.reject(disconnect);
  await turn();
  if (!settled) fixture.timer.expire(timerId);
  assert.ok(settled, "no need to wait for twice the configured reaction timeout");
  assert.equal((await result).name, undefined);
  assert.equal(fixture.timer.pending.size, 0);
  assert.equal(fixture.deleted, 1);
  assert.deepEqual(fixture.errors, [disconnect, failedDelete]);
});

test("a native timeout cleans the whisper once even when its late RPC rejects", async () => {
  const rpc = deferred();
  const fixture = reactionFixture({ choose: () => rpc.promise });
  const result = fixture.start();
  await turn();
  fixture.timer.expire(fixture.timer.pending.keys().next().value);
  assert.equal((await result).name, undefined);
  const disconnect = new Error("late disconnect");
  rpc.reject(disconnect);
  await turn();
  assert.deepEqual(fixture.errors, [disconnect]);
  assert.equal(fixture.deleted, 1);
  assert.equal(fixture.reset, 0);
});

test("native GM reaction success keeps its result, document refresh, and cleanup", async () => {
  const chosen = { name: "Shield", uuid: "activity" };
  const fixture = reactionFixture({ isGM: true, choose: async (route) => {
    assert.equal(route, "chooseReactions");
    return chosen;
  } });
  assert.equal(await fixture.start(), chosen);
  assert.equal(fixture.timer.pending.size, 0);
  assert.equal(fixture.deleted, 1);
  assert.equal(fixture.reset, 1);
});

test("an on-time selection extends the request once without pausing unselected requests", async () => {
  let request;
  const rpc = deferred();
  const fixture = reactionFixture({ choose: (_route, _owner, data) => {
    request = data.options.reactionRequest;
    return rpc.promise;
  } });
  const result = fixture.start();
  await turn();
  const [original] = fixture.timer.pending.keys();
  assert.equal(fixture.timer.durations.get(original), 60_000);
  assert.equal(fixture.remoteExtension(request, "other-user"), false);
  assert.deepEqual([...fixture.timer.pending.keys()], [original]);
  assert.equal(await fixture.extend(request), true);
  const [extended] = fixture.timer.pending.keys();
  assert.notEqual(extended, original);
  assert.equal(fixture.timer.durations.get(extended), 130_000);
  assert.equal(await fixture.extend(request), false);
  assert.deepEqual([...fixture.timer.pending.keys()], [extended]);
  rpc.resolve({ name: "Shield", uuid: "shield" });
  assert.equal((await result).uuid, "shield");
  assert.equal(await fixture.extend(request), false);
  assert.equal(fixture.timer.pending.size, 0);
});

test("extending a paused request leaves it paused until the native teleport path resumes it", async () => {
  let request;
  const rpc = deferred();
  const fixture = reactionFixture({ choose: (_route, _owner, data) => {
    request = data.options.reactionRequest;
    return rpc.promise;
  } });
  const result = fixture.start();
  await turn();
  await fixture.pause(request, true);
  assert.equal(fixture.timer.pending.size, 0);
  assert.equal(await fixture.extend(request), true);
  assert.equal(fixture.timer.pending.size, 0);
  await fixture.pause(request, false);
  assert.equal(fixture.timer.durations.values().next().value, 130_000);
  fixture.timer.expire(fixture.timer.pending.keys().next().value);
  assert.equal((await result).name, undefined);
  assert.equal(await fixture.extend(request), false);
  rpc.resolve({ name: "Shield", uuid: "shield" });
  await turn();
  assert.equal(fixture.reset, 0);
});

test("a selection on the actor owner's client sends the extension to the original requester", async () => {
  const calls = [];
  const fixture = reactionFixture({ choose: async (...args) => { calls.push(args); return true; } });
  const request = { id: "a-request", userId: "requester" };
  assert.equal(await fixture.extend(request), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "extendReactionTimer");
  assert.equal(calls[0][1], request.userId);
  assert.equal(calls[0][2].id, request.id);
});

function dialogFixture(coordinate) {
  const timer = fakeTimers();
  const typename = "ReactionDialog = class";
  const typeIndex = source.indexOf(typename);
  assert.ok(typeIndex >= 0);
  const methods = extract("      async submit(button) {", "    };", typeIndex);
  const native = extract("async function reactionDialog(", "function getConcentrationEffect(");
  const shown = [];
  class NativeItem {}
  const activity = { name: "Shield", uuid: "act", item: new NativeItem() };
  const item = Object.assign(activity.item, { name: "Shield item", uuid: "item" });
  const call = runInNewContext(`
    class TestDialogBase {
      constructor(data) { this.data = { ...data, completed: false }; shown.push(this); }
      render() {}
      close() { this.closeCount = (this.closeCount ?? 0) + 1; }
    }
    class ReactionDialog extends TestDialogBase { ${methods} }
    ${native}
    reactionDialog`, {
    ...timer,
    shown,
    __name: (callback) => callback,
    foundry: { utils: { mergeObject: Object.assign } },
    CONFIG: { Item: { documentClass: NativeItem } },
    async completeActivityUse() {
      return { activity: { ...activity, item }, currentAction: "cleanup", WorkflowState_Cleanup: "cleanup" };
    },
    debug() {},
    document: {},
    $: () => ({ off() {} })
  });
  const result = call({ name: "Caster" }, "source", [activity], "prompt", "reactionattacked", { timeout: 1 });
  const [dialog] = shown;
  const submit = () => dialog.submit({
    key: activity.uuid,
    async callback(dialog, button) {
      await coordinate;
      return dialog.data.callback(dialog, button);
    }
  });
  return { dialog, result, timer, submit };
}

test("on-time native click remains pending across lexical timeout until the commit completes", async () => {
  const commit = deferred();
  const fixture = dialogFixture(commit.promise);
  const submission = fixture.submit();
  let settled = false;
  fixture.result.then(() => { settled = true; });
  fixture.timer.expire(fixture.timer.pending.keys().next().value);
  await turn();
  assert.equal(settled, false);
  assert.equal(fixture.dialog.closeCount, undefined);
  commit.resolve();
  await submission;
  assert.equal((await fixture.result).uuid, "act");
});

test("a native dialog with no submitted selection still times out", async () => {
  const fixture = dialogFixture();
  fixture.timer.expire(fixture.timer.pending.keys().next().value);
  assert.equal((await fixture.result).uuid, undefined);
  assert.equal(fixture.dialog.closeCount, 1);
});

function optionalAcFixture({ flag, activation = true, force = true, beforeForcedAc, activities = [], timeout = 3 }) {
  const timer = fakeTimers();
  const events = [];
  const dialogs = [];
  class Roll {
    constructor(total) { this.total = Number(total); this.options = {}; }
    async roll() { return this; }
    async reroll() { return new Roll(17); }
  }
  const actor = { name: "Actor", uuid: "actor", system: { attributes: { ac: { value: 12 } } }, flags: { midi: { optional: { guard: flag } } } };
  const bonus = extract("async function bonusDialog(", "function getOptionalCountRemainingShortFlag(");
  const prompt = extract("async function promptReactions(", "function playerFor(");
  const run = runInNewContext(`${bonus}\n${prompt}\npromptReactions`, {
    ...timer,
    Date: { now: () => 0 },
    __name: (value) => value,
    Roll,
    Workflow: class {},
    RollModifyDialog: class { constructor(data) { dialogs.push(data); } render() {} },
    fromUuidSync: (uuid) => uuid === "token" ? { actor } : undefined,
    fromUuid: async (uuid) => ({ uuid }),
    hasUsedReaction: () => false,
    asyncHooksCall: async () => true,
    reactionDialog: async (_actor, _source, _activities, _flavor, _type, options) => {
      events.push({ activityOptions: options });
      return { uuid: "activity" };
    },
    foundry: { utils: {
      getProperty: (source, path) => path.split(".").reduce((value, key) => value?.[key], source),
      randomID: () => "undo",
      setProperty() {},
      deepClone: (value) => value
    } },
    getOptionalCountRemainingShortFlag: () => 1,
    getOptionalCountRemaining: () => 1,
    checkMechanic: () => false,
    dice3dEnabled: () => false,
    midiRenderRoll: async () => "roll",
    playerForActor: () => ({ id: "owner" }),
    createConditionData: () => ({}),
    evalCondition: async (condition) => { events.push(condition); return condition === "activation" ? activation : force; },
    removeEffectGranting: async () => { events.push("apply"); },
    hasEffectGranting: () => true,
    unTimedExecuteAsGM: async () => {},
    safeGetGameSetting: () => "public",
    DSNMarkDiceDisplayed() {},
    i18n: () => "AC",
    enableNotifications() {},
    configSettings: { reactionTimeout: 10 },
    game: { user: { isGM: true } },
    debugEnabled: 0,
    MODULE_ID: "midi",
    TroubleShooter: { recordError() {} }
  });
  return { timer, events, dialogs, run: () => run("token", activities, "source", "prompt", "reactionattacked", { timeout, rebreyaBeforeForcedAc: beforeForcedAc }) };
}

test("an authored forced AC reaction reserves only after its native condition succeeds", async () => {
  const decision = deferred();
  const fixture = optionalAcFixture({ flag: { ac: "reroll", activation: "activation", force: "force" }, beforeForcedAc: () => {
    fixture.events.push("commit");
    return decision.promise;
  } });
  const result = fixture.run();
  await turn();
  assert.deepEqual(fixture.events, ["activation", "force", "commit"]);
  decision.resolve(true);
  assert.equal((await result).ac, 17);
  assert.deepEqual(fixture.events, ["activation", "force", "commit", "apply"]);
});

test("a false condition or denied permission does not start the native forced roll", async () => {
  const flag = { ac: "reroll", activation: "activation", force: "force" };
  for (const options of [{ activation: false }, { force: false }, {}]) {
    const fixture = optionalAcFixture({ ...options, flag, beforeForcedAc: async () => { fixture.events.push("commit"); return false; } });
    assert.equal((await fixture.run()).uuid, undefined);
    assert.deepEqual(fixture.events, options.activation === false ? ["activation"]
      : options.force === false ? ["activation", "force"] : ["activation", "force", "commit"]);
  }
});

test("optional AC gets the remaining native window without another lexical timeout", async () => {
  const fixture = optionalAcFixture({ flag: { ac: 5 }, beforeForcedAc: assert.fail });
  const result = fixture.run();
  await turn();
  assert.equal(fixture.dialogs.length, 1);
  assert.equal(fixture.dialogs[0].timeout, 3);
  assert.equal(fixture.timer.pending.size, 0);
  await fixture.dialogs[0].close();
  assert.equal((await result).uuid, undefined);
});

test("the local forced AC gate does not travel into a native activity's use options", async () => {
  const fixture = optionalAcFixture({ flag: { ac: 5 }, beforeForcedAc: assert.fail, activities: ["activity"] });
  assert.equal((await fixture.run()).uuid, "activity");
  assert.equal(fixture.events[0].activityOptions.timeout, 3);
  assert.equal(fixture.events[0].activityOptions.rebreyaBeforeForcedAc, undefined);
});

function saveFixture() {
  const bad = { name: "Disconnected", actor: {} };
  const good = { name: "Still connected", actor: {} };
  const dc = 13;
  const disconnected = new Error("rollAbility was dispatched before disconnect");
  const saveCalls = [];
  const errors = [];
  const notifications = [];
  class Roll {
    constructor(total, options = {}) { Object.assign(this, { total: Number(total), options }); }
    evaluate() { return Promise.resolve(this); }
  }
  const realRoll = new Roll(19);
  const normalize = extract("      normalizeRollResults(", "      async computeSaveDisplayFlavor(");
  const init = extract("      initSaveResults() {", "      async checkAttackAdvantage(");
  const Workflow = runInNewContext(`class Workflow { ${init} ${normalize} }; Workflow`, {
    Set, Roll,
    CONFIG: { Dice: { D20Roll: Roll } },
    ui: { notifications: { warn: (message) => notifications.push(message) } },
    MODULE_ID: "midi",
    debugEnabled: 0,
    configSettings: {},
    TroubleShooter: { recordError: (error) => errors.push(error) },
    getTokenDocument: () => undefined,
    asyncHooksCallAll: async () => turn(),
    error() {}
  });
  const channels = () => ({ player: [], gm: [] });
  const workflow = Object.assign(new Workflow(), {
    hitTargets: new Set([bad, good]),
    hitTargetsEC: new Set(),
    targets: new Set([bad, good]),
    saveActivity: { save: { dc: { value: dc } } },
    actor: { type: "npc" },
    item: { flags: { midi: { noProvokeReaction: true } } },
    activity: {},
    workflowOptions: {},
    determineRollTypeAndAction: () => ({ rollAction: "save", rollType: "save", rollAbilities: ["con"] }),
    computeModuleIntegrationSettings: () => ({ flags: {}, requests: { monks: channels(), flash: channels(), epic: channels() } }),
    buildSaveDetailsForTarget: async () => ({}),
    determineTargetRollSettings: () => ({}),
    queueTargetSaveRoll({ target }) {
      saveCalls.push(target);
      return { promise: target === bad ? Promise.reject(disconnected) : Promise.resolve(realRoll) };
    },
    dispatchMonksTokenBarSaves() {},
    dispatchFlashRollsSaves() {},
    dispatchEpicRollsSaves() {},
    async processTargetSaveResult(target, [roll]) {
      if (roll.total >= dc) {
        this.saves.add(target);
        this.failedSaves.delete(target);
      }
    },
    computeSaveDisplayFlavor: async () => "Save results"
  });
  return { workflow, bad, good, realRoll, disconnected, saveCalls, errors, notifications };
}

test("a rejected rollAbility does not leak during later target hooks, erase a real save or trigger a reroll", async () => {
  const { workflow, bad, good, realRoll, disconnected, saveCalls, errors, notifications } = saveFixture();
  await workflow.checkSaves();
  assert.deepEqual(saveCalls, [bad, good]);
  assert.deepEqual([...workflow.saves], [good]);
  assert.equal(workflow.failedSaves.size, 0);
  assert.deepEqual([...workflow.unresolvedSaveTargets], [bad]);
  assert.deepEqual([...workflow.saveResults], [realRoll]);
  assert.deepEqual(errors, [disconnected]);
  assert.match(notifications.join("\n"), /Disconnected/);
  assert.equal(workflow.saveDisplayFlavor, "Save results");
});

test("native damage and effects skip only targets with unresolved saves", async () => {
  class FoundrySet extends Set {
    filter(predicate) { return new FoundrySet([...this].filter(predicate)); }
  }
  const damaged = [];
  const makeTarget = (name) => ({
    actor: { uuid: name, calculateDamage: (damage) => damage },
    document: { uuid: name }
  });
  const unresolved = makeTarget("unresolved");
  const resolved = makeTarget("resolved");
  const targets = new FoundrySet([unresolved, resolved]);
  const workflow = {
    actor: { uuid: "source", name: "Caster" },
    activity: { save: {}, actionType: "save" },
    item: { type: "spell" },
    targets, hitTargets: targets, hitTargetsEC: new FoundrySet(),
    unresolvedSaveTargets: new FoundrySet([unresolved]),
    failedSaves: new FoundrySet([resolved]),
    saves: new FoundrySet(), fumbleSaves: new FoundrySet(), criticalSaves: new FoundrySet(),
    superSavers: new FoundrySet(), semiSuperSavers: new FoundrySet(),
    rawDamageDetail: [{ type: "fire", value: 6 }], damageDetail: [{ type: "fire", value: 6 }],
    rawBonusDamageDetail: [], rawOtherDamageDetail: [],
    otherDamageFor: () => [], async callDamageHooksAndMacros() {},
    WorkflowState_RollFinished: Symbol("finished"), async expireTargetEffects() {}
  };
  const damage = extract("async function processDamageRoll(", "function getSaveMultiplierForActivity(");
  const effects = extract("      async WorkflowState_ApplyDynamicEffects(", "      async WorkflowState_Cleanup(");
  const run = runInNewContext(`
    ${damage}
    class Effects { ${effects} }
    async (workflow) => {
      await processDamageRoll(workflow, "fire");
      await Effects.prototype.WorkflowState_ApplyDynamicEffects.call(workflow);
    }`, {
    Set: FoundrySet,
    configSettings: { autoItemEffects: "off" },
    debugEnabled: 0,
    MODULE_ID: "midi",
    __name: (value) => value,
    expireMyEffects() {},
    getSaveMultiplierForActivity: () => 0.5,
    canvas: { scene: { id: "test" } },
    foundry: { utils: { getProperty: () => true, deepClone: (value) => value } },
    checkRule: () => undefined,
    uncannyDodgeSourceIcon: () => undefined,
    mergeDamageDetail: (details) => details,
    setupDamageDetails: (details) => details,
    prepareDamageListToJSON: (damage) => damage,
    timedAwaitExecuteAsGM: async (_route, { damageList }) => damaged.push(...Array.from(damageList, (entry) => entry.targetUuid)),
  });
  await run(workflow);
  assert.deepEqual(damaged, ["resolved"]);
  assert.deepEqual([...workflow.effectTargets], [resolved]);
  assert.deepEqual([...workflow.effectTargetsOnSave], [resolved]);
  assert.deepEqual([...workflow.hitTargets], [unresolved, resolved]);
});
