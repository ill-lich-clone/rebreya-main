import assert from "node:assert/strict";
import test from "node:test";

import {
  SpellAutomationRegistry,
  spellAutomationKey
} from "../scripts/combat/spell-automation-registry.js";

function declaration(overrides = {}) {
  return {
    runtime: "instance",
    recipe: "melf-minute-meteors",
    version: 1,
    ...overrides
  };
}

test("registers and resolves an exact runtime recipe version", () => {
  const registry = new SpellAutomationRegistry();
  const registered = registry.register({
    ...declaration(),
    handlers: { cast: () => "cast" }
  });

  assert.equal(spellAutomationKey(declaration()), "instance:melf-minute-meteors:v1");
  assert.equal(registry.resolve(declaration()), registered);
  assert.equal(registry.resolve(declaration({ version: 2 })), null);
});

test("rejects malformed declarations and non-function handlers", () => {
  const registry = new SpellAutomationRegistry();

  assert.throws(() => spellAutomationKey({ runtime: "", recipe: "meteor", version: 1 }), TypeError);
  assert.throws(() => spellAutomationKey({ runtime: "instance", recipe: "", version: 1 }), TypeError);
  assert.throws(() => spellAutomationKey({ runtime: "instance", recipe: "meteor", version: 0 }), TypeError);
  assert.throws(() => registry.register({ ...declaration(), handlers: null }), TypeError);
  assert.throws(() => registry.register({ ...declaration(), handlers: { cast: "not a function" } }), TypeError);
});

test("rejects a conflicting duplicate key", () => {
  const registry = new SpellAutomationRegistry();
  const definition = { ...declaration(), handlers: {} };

  registry.register(definition);

  assert.throws(() => registry.register(definition), /already registered/);
});

test("returns null for an unknown version", () => {
  const registry = new SpellAutomationRegistry();
  registry.register({ ...declaration(), handlers: {} });

  assert.equal(registry.resolve(declaration({ version: 99 })), null);
});

test("lists immutable registered keys in insertion order without exposing declarations", () => {
  const registry = new SpellAutomationRegistry();
  registry.register({ ...declaration({ recipe: "first" }), handlers: {} });
  registry.register({ ...declaration({ recipe: "second", version: 2 }), handlers: {} });

  const keys = registry.listKeys();

  assert.deepEqual(keys, ["instance:first:v1", "instance:second:v2"]);
  assert.ok(Object.isFrozen(keys));
  assert.throws(() => keys.push("instance:leak:v1"), TypeError);
  assert.equal(registry.resolve(declaration({ recipe: "first" }))?.recipe, "first");
});

test("does not dispatch an inherited handler name", () => {
  const registry = new SpellAutomationRegistry();
  registry.register({ ...declaration(), handlers: {} });

  assert.deepEqual(registry.dispatch("toString", declaration(), {}), { handled: false, value: undefined });
});

test("dispatches only the named handler with a frozen declaration", async () => {
  const registry = new SpellAutomationRegistry();
  const original = {
    ...declaration(),
    label: "Original declaration",
    handlers: {
      cast: async (registeredDeclaration, context) => ({
        label: registeredDeclaration.label,
        frozen: Object.isFrozen(registeredDeclaration),
        context
      }),
      damage: () => {
        throw new Error("the unnamed handler must not run");
      }
    }
  };
  registry.register(original);
  original.label = "Mutated caller declaration";
  original.handlers.cast = () => "mutated handler";

  const dispatched = registry.dispatch("cast", declaration(), { target: "Token.ember" });
  const result = await dispatched.value;

  assert.deepEqual(result, {
    label: "Original declaration",
    frozen: true,
    context: { target: "Token.ember" }
  });
  assert.deepEqual(dispatched, { handled: true, value: dispatched.value });
  assert.deepEqual(registry.dispatch("save", declaration(), {}), { handled: false, value: undefined });
});
