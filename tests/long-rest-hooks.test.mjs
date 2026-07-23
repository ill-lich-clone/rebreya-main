import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  registerLongRestHooks,
  restKind
} from "../scripts/integrations/long-rest-hooks.js";

function hookHarness() {
  const listeners = new Map();
  const onceListeners = new Map();
  const counts = new Map();
  return {
    listeners,
    onceListeners,
    counts,
    Hooks: {
      on(name, listener) {
        listeners.set(name, listener);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      },
      once(name, listener) {
        onceListeners.set(name, listener);
      }
    }
  };
}

test("rest kind recognizes supported dnd5e result and config shapes", () => {
  assert.equal(restKind({ type: "long" }), "long");
  assert.equal(restKind({ restType: "short" }), "short");
  assert.equal(restKind({}, { period: "lr" }), "long");
  assert.equal(restKind({ longRest: true }), "long");
  assert.equal(restKind({}, { shortRest: true }), "short");
  assert.equal(restKind({}, {}), "");
});

test("rest dispatcher sends long rest to pipeline and short rest to Rune Knight", async () => {
  const { Hooks, listeners } = hookHarness();
  const calls = [];
  registerLongRestHooks({
    longRestPipelineService: {
      enqueue: async (...args) => calls.push(["long", ...args])
    },
    runeKnightAutomationService: {
      handleRestCompleted: async (...args) => calls.push(["short", ...args])
    }
  }, { Hooks, game: {} });

  const actor = { uuid: "Actor.hero" };
  assert.equal(
    listeners.get("dnd5e.restCompleted")(actor, { type: "long" }, {}),
    true
  );
  assert.equal(
    listeners.get("dnd5e.restCompleted")(actor, { type: "short" }, {}),
    true
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls.map((entry) => entry[0]), ["long", "short"]);
});

test("rest dispatcher registers exactly once, ignores unknown rests, and shuts down", async () => {
  const { Hooks, listeners, onceListeners, counts } = hookHarness();
  const game = {};
  const shutdownReasons = [];
  const moduleApi = {
    longRestPipelineService: {
      enqueue: async () => assert.fail("must not run"),
      shutdown: (reason) => shutdownReasons.push(reason)
    }
  };

  registerLongRestHooks(moduleApi, { Hooks, game });
  registerLongRestHooks(moduleApi, { Hooks, game });

  assert.equal(counts.get("dnd5e.restCompleted"), 1);
  listeners.get("dnd5e.restCompleted")({}, {}, {});
  onceListeners.get("closeWorld")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(shutdownReasons, ["world-closed"]);
});

test("live module composes and exposes the long-rest pipeline", async () => {
  const source = await readFile(
    new URL("../scripts/main.js", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /import \{ LongRestPipelineService \} from "\.\/rest\/long-rest-pipeline-service\.js";/u
  );
  assert.match(
    source,
    /this\.longRestPipelineService = new LongRestPipelineService\(/u
  );
  assert.match(
    source,
    /registerLongRestStep\(definition\) \{[\s\S]*?registerStep\(definition\)/u
  );
  assert.match(
    source,
    /runLongRestPipeline\(actor, result = \{\}, config = \{\}\)/u
  );
  assert.match(source, /getRecentLongRestRuns\(\)/u);
  assert.match(source, /registerLongRestHooks\(moduleApi\)/u);
});
