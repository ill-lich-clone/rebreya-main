import assert from "node:assert/strict";
import test from "node:test";

import {
  SpellAutomationHookBridge,
  buildSpellAutomationContext,
  isSpellAutomationChildInvocation,
  readSpellAutomationDeclaration
} from "../scripts/combat/spell-automation-hook-bridge.js";
import { SpellAutomationRegistry } from "../scripts/combat/spell-automation-registry.js";

const MODULE_ID = "rebreya-main";

function declaration(overrides = {}) {
  return {
    runtime: "instance",
    recipe: "melf-minute-meteors",
    version: 1,
    ...overrides
  };
}

function activity(overrides = {}) {
  return {
    uuid: "Activity.meteors",
    actor: { uuid: "Actor.wizard" },
    item: {
      uuid: "Item.meteors",
      actor: { uuid: "Actor.wizard" },
      flags: { [MODULE_ID]: { spellAutomation: declaration() } }
    },
    ...overrides
  };
}

function registryWith(handler) {
  const registry = new SpellAutomationRegistry();
  registry.register({ ...declaration(), handlers: { preUseActivity: handler } });
  return registry;
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

test("reads an activity declaration before the item declaration", () => {
  const fromActivity = declaration({ recipe: "activity-first" });
  const source = activity({
    flags: { [MODULE_ID]: { spellAutomation: fromActivity } }
  });

  assert.equal(readSpellAutomationDeclaration(source), fromActivity);
});

test("ignores an activity with no new spellAutomation declaration", () => {
  assert.equal(readSpellAutomationDeclaration(activity({
    flags: { [MODULE_ID]: { spellAutomation: { kind: "spell-shatter" } } },
    item: { flags: { [MODULE_ID]: { spellAutomation: { kind: "counterspell" } } } }
  })), null);
});

test("ignores legacy craftsmanConstructor flags", () => {
  assert.equal(readSpellAutomationDeclaration(activity({
    flags: { [MODULE_ID]: { craftsmanConstructor: true } },
    item: { flags: { [MODULE_ID]: { craftsmanConstructor: { kind: "construct" } } } }
  })), null);
});

test("marks spellAutomationChild and spellAutomationBypass as child invocations", () => {
  assert.equal(isSpellAutomationChildInvocation({ [MODULE_ID]: { spellAutomationChild: true } }), true);
  assert.equal(isSpellAutomationChildInvocation({ [MODULE_ID]: { spellAutomationBypass: true } }), true);
  assert.equal(isSpellAutomationChildInvocation({}), false);
});

test("normalizes every public context field from dnd5e and Midi workflow relationships", () => {
  const sceneFromActorToken = { id: "Scene.dnd5e" };
  const actorToken = { id: "Token.dnd5e", parent: sceneFromActorToken };
  const dnd5eActor = { uuid: "Actor.dnd5e", token: actorToken };
  const dnd5eItem = {
    uuid: "Item.dnd5e",
    actor: dnd5eActor,
    flags: { [MODULE_ID]: { spellAutomation: declaration({ recipe: "dnd5e-recipe" }) } }
  };
  const dnd5eActivity = { uuid: "Activity.dnd5e", actor: dnd5eActor, item: dnd5eItem };
  const dnd5eUsage = { action: "cast", [MODULE_ID]: { operationId: "operation-dnd5e" } };
  const dnd5eDialog = { fastForward: true };
  const dnd5eMessage = { createMessage: false };
  const dnd5eArgs = [dnd5eActivity, dnd5eUsage, dnd5eDialog, dnd5eMessage];

  const sceneFromWorkflowToken = { id: "Scene.midi" };
  const workflowToken = { id: "Token.midi", parent: sceneFromWorkflowToken };
  const midiActor = { uuid: "Actor.midi" };
  const midiItem = {
    uuid: "Item.midi",
    actor: midiActor,
    flags: { [MODULE_ID]: { spellAutomation: declaration({ recipe: "midi-recipe" }) } }
  };
  const midiActivity = { uuid: "Activity.midi", actor: midiActor, item: midiItem };
  const midiUsage = { action: "cast", [MODULE_ID]: { operationId: "operation-midi" } };
  const workflow = {
    id: "Workflow.midi",
    activity: midiActivity,
    item: midiItem,
    actor: midiActor,
    token: workflowToken,
    options: midiUsage,
    dialogConfig: { fastForward: false },
    messageConfig: { createMessage: true }
  };

  const dnd5e = buildSpellAutomationContext("preUseActivity", dnd5eArgs);
  const midi = buildSpellAutomationContext("midiRollComplete", [workflow]);

  const canonicalFields = [
    "eventName", "activity", "item", "actor", "token", "scene", "workflow", "document",
    "usageConfig", "dialogConfig", "messageConfig", "results", "rawArgs", "declaration",
    "operationId", "isChildInvocation"
  ];
  assert.deepEqual(Object.fromEntries(canonicalFields.map((field) => [field, dnd5e[field]])), {
    eventName: "preUseActivity",
    activity: dnd5eActivity,
    item: dnd5eItem,
    actor: dnd5eActor,
    token: actorToken,
    scene: sceneFromActorToken,
    workflow: null,
    document: dnd5eActivity,
    usageConfig: dnd5eUsage,
    dialogConfig: dnd5eDialog,
    messageConfig: dnd5eMessage,
    results: null,
    rawArgs: dnd5eArgs,
    declaration: dnd5eItem.flags[MODULE_ID].spellAutomation,
    operationId: "operation-dnd5e",
    isChildInvocation: false
  });
  assert.deepEqual(Object.fromEntries(canonicalFields.map((field) => [field, midi[field]])), {
    eventName: "midiRollComplete",
    activity: midiActivity,
    item: midiItem,
    actor: midiActor,
    token: workflowToken,
    scene: sceneFromWorkflowToken,
    workflow,
    document: workflow,
    usageConfig: midiUsage,
    dialogConfig: { fastForward: false },
    messageConfig: { createMessage: true },
    results: null,
    rawArgs: [workflow],
    declaration: midiItem.flags[MODULE_ID].spellAutomation,
    operationId: "operation-midi",
    isChildInvocation: false
  });
  assert.equal(dnd5e.childInvocation, false);
  assert.equal(midi.childInvocation, false);
});

test("uses an existing operationId or creates one once per invocation", () => {
  let created = 0;
  const operationIdFactory = () => `operation-${++created}`;
  const existing = buildSpellAutomationContext("preUseActivity", [activity(), {
    [MODULE_ID]: { operationId: "kept-operation" }
  }], { operationIdFactory });
  const createdContext = buildSpellAutomationContext("preUseActivity", [activity(), {}], { operationIdFactory });

  assert.equal(existing.operationId, "kept-operation");
  assert.equal(createdContext.operationId, "operation-1");
  assert.equal(created, 1);
});

test("dispatches an exact recipe and preserves the action field", async () => {
  let seen;
  const bridge = new SpellAutomationHookBridge({
    registry: registryWith((registered, context) => {
      seen = { registered, context };
      return true;
    }),
    operationIdFactory: () => "operation-1"
  });
  const use = { action: "consume", [MODULE_ID]: {} };

  assert.equal(bridge.handlePreUseActivity(activity(), use, {}, {}), true);
  assert.equal(seen.registered.recipe, "melf-minute-meteors");
  assert.equal(seen.context.action, "consume");
  assert.equal(seen.context.operationId, "operation-1");
});

test("fails closed for an explicitly managed unknown pre-use recipe", async () => {
  const warnings = [];
  const bridge = new SpellAutomationHookBridge({
    registry: new SpellAutomationRegistry(),
    notifyWarning: (message) => warnings.push(message)
  });

  assert.equal(bridge.handlePreUseActivity(activity(), {}, {}, {}), false);
  assert.equal(warnings.length, 1);
});

test("fails closed and contains Promise-returning pre-use handlers", async () => {
  const fulfilled = Promise.resolve(true);
  const rejected = Promise.reject(new Error("late recipe failure"));
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);

  try {
    const logger = { error() {} };
    const fulfilledBridge = new SpellAutomationHookBridge({ registry: registryWith(() => fulfilled), logger });
    const rejectedBridge = new SpellAutomationHookBridge({ registry: registryWith(() => rejected), logger });

    assert.equal(fulfilledBridge.handlePreUseActivity(activity(), {}, {}, {}), false);
    assert.equal(rejectedBridge.handlePreUseActivity(activity(), {}, {}, {}), false);
    await fulfilled;
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(unhandled, []);
  }
  finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("fails open for an unmanaged event and for non-blocking handler errors", async () => {
  const unmanaged = new SpellAutomationHookBridge({ registry: new SpellAutomationRegistry() });
  const managedError = new SpellAutomationHookBridge({
    registry: registryWith(() => { throw new Error("non-blocking"); }),
    logger: { error() {} }
  });

  assert.equal(unmanaged.handlePreUseActivity(activity({ item: {} }), {}, {}, {}), true);
  assert.equal(managedError.handlePreUseActivity(activity(), {}, {}, {}), true);
});

test("1,000 unmanaged pre-use activities return synchronously without runtime work", async () => {
  let dispatchResolutions = 0;
  let dispatches = 0;
  let documentLookups = 0;
  let mutations = 0;
  let timers = 0;
  let notifications = 0;
  let operationIds = 0;
  const originalGame = globalThis.game;
  const originalSetTimeout = globalThis.setTimeout;
  const originalSetInterval = globalThis.setInterval;
  const originalSetImmediate = globalThis.setImmediate;
  const registry = {
    get dispatch() {
      dispatchResolutions += 1;
      return () => {
        dispatches += 1;
        return { handled: true, value: true };
      };
    }
  };
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
  const bridge = new SpellAutomationHookBridge({
    registry,
    notifyWarning: () => { notifications += 1; },
    operationIdFactory: () => `unexpected-operation-${++operationIds}`
  });
  const guard = (value) => mutationGuard(value, () => { mutations += 1; });
  const unmanagedActivity = guard({ flags: {} });
  const usageConfig = guard({});
  const dialogConfig = guard({});
  const messageConfig = guard({});

  globalThis.game = game;
  globalThis.setTimeout = (...args) => {
    timers += 1;
    return originalSetTimeout(...args);
  };
  globalThis.setInterval = (...args) => {
    timers += 1;
    return originalSetInterval(...args);
  };

  try {
    for (let index = 0; index < 1_000; index += 1) {
      assert.equal(bridge.handlePreUseActivity(unmanagedActivity, usageConfig, dialogConfig, messageConfig), true);
    }
    await new Promise((resolve) => originalSetImmediate(resolve));

    assert.equal(dispatchResolutions, 0);
    assert.equal(dispatches, 0);
    assert.equal(documentLookups, 0);
    assert.equal(mutations, 0);
    assert.equal(timers, 0);
    assert.equal(notifications, 0);
    assert.equal(operationIds, 0);
  }
  finally {
    globalThis.game = originalGame;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.setInterval = originalSetInterval;
  }

});

test("unmanaged asynchronous events return fail-open without creating an operation ID", async () => {
  let operationIds = 0;
  let dispatches = 0;
  const bridge = new SpellAutomationHookBridge({
    registry: {
      dispatch() {
        dispatches += 1;
        return { handled: true, value: false };
      }
    },
    operationIdFactory: () => `unexpected-operation-${++operationIds}`
  });

  assert.equal(await bridge.handleMidiRollComplete({
    id: "Workflow.unmanaged",
    activity: { id: "Activity.unmanaged", item: { flags: {} } },
    options: {}
  }), true);
  assert.equal(dispatches, 0);
  assert.equal(operationIds, 0);
});

test("routes managed cast and release actions from their versioned declarations", async () => {
  const contexts = [];
  const bridge = new SpellAutomationHookBridge({
    registry: {
      dispatch(eventName, registered, context) {
        contexts.push({ eventName, registered, context });
        return { handled: true, value: true };
      }
    }
  });
  const cast = activity({ item: { flags: { [MODULE_ID]: { spellAutomation: declaration({ action: "cast" }) } } } });
  const release = activity({ item: { flags: { [MODULE_ID]: { spellAutomation: declaration({ action: "release" }) } } } });

  assert.equal(await bridge.handlePostUseActivity(cast, {}, { updates: [] }), true);
  assert.equal(bridge.handlePreUseActivity(release, {}, {}, {}), true);

  assert.deepEqual(contexts.map(({ eventName, context }) => [eventName, context.action]), [
    ["postUseActivity", "cast"],
    ["preUseActivity", "release"]
  ]);
});

test("correlates one generated operation ID through pre-use, post-use, and Midi workflows", async () => {
  const contexts = [];
  let generated = 0;
  const bridge = new SpellAutomationHookBridge({
    registry: {
      dispatch(eventName, registered, context) {
        contexts.push({ eventName, context });
        return { handled: true, value: true };
      }
    },
    operationIdFactory: () => `operation-${++generated}`
  });
  const primary = activity({ item: { flags: { [MODULE_ID]: { spellAutomation: declaration({ action: "cast" }) } } } });
  const primaryUsage = { midiOptions: { workflowOptions: {} } };

  assert.equal(bridge.handlePreUseActivity(primary, primaryUsage, {}, {}), true);
  assert.equal(primaryUsage.flags[MODULE_ID].operationId, "operation-1");
  assert.equal(primaryUsage.midiOptions.workflowOptions[MODULE_ID].operationId, "operation-1");
  assert.equal(await bridge.handlePostUseActivity(primary, primaryUsage, { updates: [] }), true);
  assert.equal(await bridge.handleMidiRollComplete({ activity: primary, options: primaryUsage.midiOptions.workflowOptions }), true);

  const secondaryUsage = { midiOptions: { workflowOptions: {} } };
  assert.equal(bridge.handlePreUseActivity(activity(), secondaryUsage, {}, {}), true);

  assert.deepEqual(contexts.slice(0, 3).map(({ eventName, context }) => [eventName, context.operationId]), [
    ["preUseActivity", "operation-1"],
    ["postUseActivity", "operation-1"],
    ["midiRollComplete", "operation-1"]
  ]);
  assert.equal(secondaryUsage.flags[MODULE_ID].operationId, "operation-2");
});

test("preserves an existing operation ID from module flags when top-level options are present", () => {
  let context = null;
  const bridge = new SpellAutomationHookBridge({
    registry: {
      dispatch(eventName, registered, received) {
        context = received;
        return { handled: true, value: true };
      }
    },
    operationIdFactory: () => "unexpected-operation"
  });
  const usageConfig = {
    [MODULE_ID]: { configureDialog: false },
    flags: { [MODULE_ID]: { operationId: "kept-operation" } },
    midiOptions: { workflowOptions: { [MODULE_ID]: { operationId: "kept-operation" } } }
  };

  assert.equal(bridge.handlePreUseActivity(activity(), usageConfig, {}, {}), true);

  assert.equal(context.operationId, "kept-operation");
  assert.equal(usageConfig[MODULE_ID].operationId, "kept-operation");
  assert.equal(usageConfig.flags[MODULE_ID].operationId, "kept-operation");
  assert.equal(usageConfig.midiOptions.workflowOptions[MODULE_ID].operationId, "kept-operation");
});

test("routes resumed parent uses while skipping child and ordinary bypass uses", () => {
  const contexts = [];
  const bridge = new SpellAutomationHookBridge({
    registry: {
      dispatch(eventName, registered, context) {
        contexts.push({ eventName, context });
        return { handled: true, value: true };
      }
    }
  });
  const parent = activity({ item: { flags: { [MODULE_ID]: { spellAutomation: declaration({ action: "release" }) } } } });
  const resumedUsage = {
    [MODULE_ID]: {
      operationId: "parent-operation",
      spellAutomationBypass: true,
      spellAutomationResume: true
    }
  };

  assert.equal(bridge.handlePreUseActivity(parent, resumedUsage, {}, {}), true);
  assert.equal(bridge.handlePreUseActivity(parent, { [MODULE_ID]: { spellAutomationChild: true } }, {}, {}), true);
  assert.equal(bridge.handlePreUseActivity(parent, { [MODULE_ID]: { spellAutomationBypass: true } }, {}, {}), true);

  assert.deepEqual(contexts.map(({ eventName, context }) => [eventName, context.action, context.operationId]), [
    ["preUseActivity", "release", "parent-operation"]
  ]);
});

test("normalizes preSummon with the original summon options object", () => {
  const seen = [];
  const summon = declaration({ runtime: "summon", recipe: "animate-objects" });
  const bridge = new SpellAutomationHookBridge({ registry: { dispatch(eventName, registered, context) { seen.push({ eventName, registered, context }); return { handled: true, value: true }; } } });
  const source = activity({ flags: { [MODULE_ID]: { spellAutomation: summon } } });
  const options = { [MODULE_ID]: { operationId: "summon-operation" } };

  assert.equal(bridge.handlePreSummon(source, { id: "profile" }, options), true);
  assert.equal(seen[0].eventName, "preSummon");
  assert.equal(seen[0].context.summonOptions, options);
  assert.equal(seen[0].context.operationId, "summon-operation");
});

test("normalizes summonToken with the original mutable token data synchronously", () => {
  const summon = declaration({ runtime: "summon", recipe: "animate-objects" });
  const bridge = new SpellAutomationHookBridge({ registry: { dispatch(_eventName, _registered, context) { context.tokenData.flags = { stamped: true }; return { handled: true, value: true }; } } });
  const source = activity({ flags: { [MODULE_ID]: { spellAutomation: summon } } });
  const options = { [MODULE_ID]: { operationId: "summon-operation" } };
  const tokenData = {};

  assert.equal(bridge.handleSummonToken(source, {}, tokenData, options), true);
  assert.deepEqual(tokenData, { flags: { stamped: true } });
});

test("normalizes postSummon with only the created token list", async () => {
  const seen = [];
  const summon = declaration({ runtime: "summon", recipe: "animate-objects" });
  const bridge = new SpellAutomationHookBridge({ registry: { dispatch(eventName, _registered, context) { seen.push({ eventName, context }); return { handled: true, value: true }; } } });
  const source = activity({ flags: { [MODULE_ID]: { spellAutomation: summon } } });
  const created = [{ id: "created" }];

  assert.equal(await bridge.handlePostSummon(source, {}, created, {}), true);
  assert.equal(seen[0].eventName, "postSummon");
  assert.equal(seen[0].context.tokens, created);
});

test("unmanaged and legacy summon phases take the immediate fast path", async () => {
  let dispatches = 0;
  let operations = 0;
  const bridge = new SpellAutomationHookBridge({
    registry: { dispatch() { dispatches += 1; return { handled: true, value: true }; } },
    operationIdFactory: () => `unexpected-${++operations}`
  });
  const legacy = activity({ flags: { [MODULE_ID]: { craftsmanConstructor: { kind: "constructSummon" } } } });
  const unmanaged = activity({ item: { flags: {} } });

  assert.equal(bridge.handlePreSummon(legacy, {}, {}), true);
  assert.equal(bridge.handleSummonToken(unmanaged, {}, {}, {}), true);
  assert.equal(await bridge.handlePostSummon(legacy, {}, [], {}), true);
  assert.equal(dispatches, 0);
  assert.equal(operations, 0);
});
