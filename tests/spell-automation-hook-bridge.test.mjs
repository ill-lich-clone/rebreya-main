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

test("builds the same normalized fields for dnd5e and midi events", () => {
  const sharedActivity = activity();
  const usageConfig = { action: "cast", [MODULE_ID]: { operationId: "operation-existing" } };
  const dnd5e = buildSpellAutomationContext("preUseActivity", [sharedActivity, usageConfig, { fastForward: true }, { createMessage: false }]);
  const midi = buildSpellAutomationContext("midiRollComplete", [{
    activity: sharedActivity,
    item: sharedActivity.item,
    actor: sharedActivity.actor,
    options: usageConfig,
    dialogConfig: { fastForward: true },
    messageConfig: { createMessage: false }
  }]);

  for (const context of [dnd5e, midi]) {
    assert.equal(context.activity, sharedActivity);
    assert.equal(context.item, sharedActivity.item);
    assert.equal(context.actor, sharedActivity.actor);
    assert.equal(context.usageConfig, usageConfig);
    assert.equal(context.dialogConfig.fastForward, true);
    assert.equal(context.messageConfig.createMessage, false);
    assert.equal(context.declaration.recipe, "melf-minute-meteors");
    assert.equal(context.operationId, "operation-existing");
    assert.equal(context.action, "cast");
  }
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
