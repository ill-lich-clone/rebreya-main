import assert from "node:assert/strict";
import test from "node:test";

import { SpellAreaRuntime } from "../scripts/combat/spell-area-runtime.js";
import { SpellInterceptionRuntime } from "../scripts/combat/spell-interception-runtime.js";

test("interception runtime exposes a versioned recipe registration entrypoint", () => {
  const registrations = [];
  const registry = { register: (definition) => registrations.push(definition) };
  const handlers = { intercept: () => {} };
  const runtime = new SpellInterceptionRuntime({ registry });

  runtime.registerRecipe({ recipe: "counterspell", version: 1, handlers });

  assert.deepEqual(registrations, [{
    runtime: "interception",
    recipe: "counterspell",
    version: 1,
    handlers
  }]);
});

test("area runtime exposes template region and turn entrypoints", () => {
  const registrations = [];
  const registry = { register: (definition) => registrations.push(definition) };
  const handlers = { template: () => {}, region: () => {}, turn: () => {} };
  const runtime = new SpellAreaRuntime({ registry });

  runtime.registerRecipe({ recipe: "moonbeam", version: 1, handlers });

  assert.deepEqual(registrations, [{
    runtime: "area",
    recipe: "moonbeam",
    version: 1,
    handlers
  }]);
});

test("empty runtimes perform no document lookup or mutation", async () => {
  let lookupCalls = 0;
  let mutationCalls = 0;
  const lookup = () => { lookupCalls += 1; };
  const mutate = () => { mutationCalls += 1; };

  new SpellInterceptionRuntime({ lookup, mutate });
  new SpellAreaRuntime({ lookup, mutate });

  assert.equal(lookupCalls, 0);
  assert.equal(mutationCalls, 0);
});
