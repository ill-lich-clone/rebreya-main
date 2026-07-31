import assert from "node:assert/strict";
import test from "node:test";

import { registerSpellAutomationHooks } from "../scripts/integrations/spell-automation-hooks.js";

const EXPECTED_HOOKS = [
  "dnd5e.preUseActivity",
  "dnd5e.postUseActivity",
  "midi-qol.RollComplete",
  "dnd5e.preSummon",
  "dnd5e.summonToken",
  "dnd5e.postSummon",
  "createActiveEffect",
  "updateActiveEffect",
  "deleteActiveEffect",
  "createMeasuredTemplate",
  "updateMeasuredTemplate",
  "deleteMeasuredTemplate",
  "combatTurnChange"
];

function fakeHooks() {
  const listeners = new Map();
  return {
    listeners,
    on(name, callback) {
      const callbacks = listeners.get(name) ?? [];
      callbacks.push(callback);
      listeners.set(name, callbacks);
      return callbacks.length;
    }
  };
}

function moduleApi(bridge = {}) {
  return { spellAutomationHookBridge: bridge };
}

function mutationGuard(value, onMutation, seen = new WeakMap()) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  if (seen.has(value)) return seen.get(value);

  const guarded = new Proxy(value, {
    get(target, property, receiver) {
      return mutationGuard(Reflect.get(target, property, receiver), onMutation, seen);
    },
    set(target, property, next, receiver) {
      onMutation();
      return Reflect.set(target, property, next, receiver);
    },
    deleteProperty(target, property) {
      onMutation();
      return Reflect.deleteProperty(target, property);
    },
    defineProperty(target, property, descriptor) {
      onMutation();
      return Reflect.defineProperty(target, property, descriptor);
    }
  });
  seen.set(value, guarded);
  return guarded;
}

test("registers every bridge hook once", async () => {
  const Hooks = fakeHooks();
  const game = {};
  const calls = [];
  const bridge = {
    handlePreUseActivity: (...args) => {
      calls.push(["pre", ...args]);
      return true;
    },
    handlePostUseActivity: (...args) => calls.push(["post", ...args]),
    handleMidiRollComplete: (...args) => calls.push(["midi", ...args]),
    handlePostSummon: (...args) => calls.push(["summon", ...args]),
    handleActiveEffectChanged: (...args) => calls.push(["effect", ...args]),
    handleMeasuredTemplateChanged: (...args) => calls.push(["template", ...args]),
    handleCombatTurnChanged: (...args) => calls.push(["combat", ...args])
  };
  const activity = { id: "activity" };
  const options = { id: "options" };
  const changed = { value: 1 };

  assert.equal(registerSpellAutomationHooks(moduleApi(bridge), { Hooks, game }), true);
  assert.deepEqual([...Hooks.listeners.keys()], EXPECTED_HOOKS);
  assert.ok([...Hooks.listeners.values()].every((callbacks) => callbacks.length === 1));
  assert.equal(registerSpellAutomationHooks(moduleApi(), { game }), false);
  assert.equal(registerSpellAutomationHooks({}, { Hooks, game: {} }), false);
  assert.equal(registerSpellAutomationHooks(moduleApi(), { Hooks }), false);

  assert.equal(Hooks.listeners.get("dnd5e.preUseActivity")[0](activity, options, changed, {}), true);
  for (const name of EXPECTED_HOOKS.slice(1)) {
    assert.equal(Hooks.listeners.get(name)[0](activity, changed, options), true);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    ["pre", activity, options, changed, {}],
    ["post", activity, changed, options],
    ["midi", activity],
    ["summon", activity, changed, options, undefined],
    ["effect", "create", activity, undefined, changed],
    ["effect", "update", activity, changed, options],
    ["effect", "delete", activity, undefined, changed],
    ["template", "create", activity, undefined, changed],
    ["template", "update", activity, changed, options],
    ["template", "delete", activity, undefined, changed],
    ["combat", activity, changed, options]
  ]);
});

test("a second registration is idempotent", () => {
  const Hooks = fakeHooks();
  const game = {};

  assert.equal(registerSpellAutomationHooks(moduleApi(), { Hooks, game }), true);
  assert.equal(registerSpellAutomationHooks(moduleApi(), { Hooks, game }), true);
  assert.ok([...Hooks.listeners.values()].every((callbacks) => callbacks.length === 1));
});

test("preUse returns the bridge boolean synchronously", () => {
  const Hooks = fakeHooks();
  const calls = [];
  const bridge = {
    handlePreUseActivity(...args) {
      calls.push(args);
      return false;
    }
  };
  const activity = { id: "activity" };
  const usageConfig = { consume: true };
  const dialogConfig = { fastForward: true };
  const messageConfig = { createMessage: false };

  registerSpellAutomationHooks(moduleApi(bridge), { Hooks, game: {} });
  const result = Hooks.listeners.get("dnd5e.preUseActivity")[0](
    activity,
    usageConfig,
    dialogConfig,
    messageConfig
  );

  assert.equal(result, false);
  assert.deepEqual(calls, [[activity, usageConfig, dialogConfig, messageConfig]]);
});

test("async hooks report errors without rejecting Foundry hooks", async () => {
  const Hooks = fakeHooks();
  const failure = new Error("bridge rejected");
  const reported = [];
  const bridge = {
    handlePostUseActivity() {
      return Promise.reject(failure);
    }
  };
  const originalError = console.error;
  console.error = (...args) => reported.push(args);

  try {
    registerSpellAutomationHooks(moduleApi(bridge), { Hooks, game: {} });
    const result = Hooks.listeners.get("dnd5e.postUseActivity")[0]({ id: "activity" }, {}, { id: "results" });

    assert.equal(result, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(reported, [["rebreya-main | Failed to route spell automation hook.", failure]]);
  }
  finally {
    console.error = originalError;
  }
});

test("postSummon remains available to the separate Craftsman hook", async () => {
  const Hooks = fakeHooks();
  const craftsmanCalls = [];
  const bridgeCalls = [];
  Hooks.on("dnd5e.postSummon", (...args) => {
    craftsmanCalls.push(args);
    return true;
  });
  const bridge = {
    handlePostSummon(...args) {
      bridgeCalls.push(args);
      return Promise.resolve(true);
    }
  };
  const args = [{ id: "activity" }, { id: "profile" }, [{ id: "token" }], { mode: "summon" }];

  registerSpellAutomationHooks(moduleApi(bridge), { Hooks, game: {} });
  const callbacks = Hooks.listeners.get("dnd5e.postSummon");

  assert.equal(callbacks.length, 2);
  assert.equal(callbacks[0](...args), true);
  assert.equal(callbacks[1](...args), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(craftsmanCalls, [args]);
  assert.deepEqual(bridgeCalls, [args]);
});

test("registered empty hook paths do not access runtime documents, mutate state, or start timers", async () => {
  const Hooks = fakeHooks();
  let documentLookups = 0;
  let mutations = 0;
  let timers = 0;
  const originalSetTimeout = globalThis.setTimeout;
  const originalSetInterval = globalThis.setInterval;
  const originalSetImmediate = globalThis.setImmediate;
  const game = new Proxy({}, {
    get(target, property, receiver) {
      if (property === "actors" || property === "scenes") documentLookups += 1;
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      mutations += 1;
      return Reflect.set(target, property, value, receiver);
    }
  });

  assert.equal(registerSpellAutomationHooks(moduleApi({}), { Hooks, game }), true);
  mutations = 0;
  const guard = (value) => mutationGuard(value, () => { mutations += 1; });
  const hookArguments = {
    "dnd5e.preUseActivity": [guard({ id: "activity" }), guard({}), guard({}), guard({})],
    "dnd5e.postUseActivity": [guard({ id: "activity" }), guard({}), guard({})],
    "midi-qol.RollComplete": [guard({
      activity: { id: "activity" },
      item: { id: "item" },
      actor: { id: "actor" },
      options: {},
      dialogConfig: {},
      messageConfig: {}
    })],
    "dnd5e.preSummon": [guard({ id: "activity" }), guard({ id: "profile" }), guard({})],
    "dnd5e.summonToken": [guard({ id: "activity" }), guard({ id: "profile" }), guard({}), guard({})],
    "dnd5e.postSummon": [guard({ id: "activity" }), guard({ id: "profile" }), guard([{ id: "token" }]), guard({})],
    createActiveEffect: [guard({ id: "effect" }), guard({})],
    updateActiveEffect: [guard({ id: "effect" }), guard({}), guard({})],
    deleteActiveEffect: [guard({ id: "effect" }), guard({})],
    createMeasuredTemplate: [guard({ id: "template" }), guard({})],
    updateMeasuredTemplate: [guard({ id: "template" }), guard({}), guard({})],
    deleteMeasuredTemplate: [guard({ id: "template" }), guard({})],
    combatTurnChange: [guard({ id: "combat" }), guard({}), guard({})]
  };
  globalThis.setTimeout = (...args) => {
    timers += 1;
    return originalSetTimeout(...args);
  };
  globalThis.setInterval = (...args) => {
    timers += 1;
    return originalSetInterval(...args);
  };

  try {
    for (const name of EXPECTED_HOOKS) {
      assert.equal(Hooks.listeners.get(name)[0](...hookArguments[name]), true);
    }
    await new Promise((resolve) => originalSetImmediate(resolve));

    assert.equal(documentLookups, 0);
    assert.equal(mutations, 0);
    assert.equal(timers, 0);
  }
  finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.setInterval = originalSetInterval;
  }
});
