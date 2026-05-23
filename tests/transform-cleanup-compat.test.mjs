import test from "node:test";
import assert from "node:assert/strict";

import { patchTransformCleanupUpdateActorHook } from "../scripts/integrations/transform-cleanup-compat.js";

function makeUnsafeTransformCleanupHook(calls) {
  return function onUpdateActor(updatedActor, changed, options, userId) {
    calls.push({ updatedActor, changed, options, userId });
    if (game.user.isActiveGM && "-=isPolymorphed" in changed.flags.dnd5e) {
      Actor.implementation.deleteDocuments([updatedActor.id]);
    }
  };
}

test("transform cleanup compatibility patch ignores actor updates without dnd5e flag changes", () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousActor = globalThis.Actor;
  const calls = [];
  const deletions = [];

  globalThis.Hooks = {
    events: {
      updateActor: [{ fn: makeUnsafeTransformCleanupHook(calls) }]
    }
  };
  globalThis.game = {
    user: { isActiveGM: true }
  };
  globalThis.Actor = {
    implementation: {
      deleteDocuments: (ids) => {
        deletions.push(ids);
      }
    }
  };

  try {
    assert.equal(patchTransformCleanupUpdateActorHook(), true);

    assert.doesNotThrow(() => {
      globalThis.Hooks.events.updateActor[0].fn({ id: "actor-1" }, { system: {} }, {}, "user-1");
    });
    assert.equal(calls.length, 0);
    assert.deepEqual(deletions, []);

    globalThis.Hooks.events.updateActor[0].fn(
      { id: "actor-1" },
      { flags: { dnd5e: { "-=isPolymorphed": null } } },
      {},
      "user-1"
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(deletions, [["actor-1"]]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.Actor = previousActor;
  }
});

test("transform cleanup compatibility patch is idempotent", () => {
  const previousHooks = globalThis.Hooks;
  const calls = [];

  globalThis.Hooks = {
    events: {
      updateActor: [{ fn: makeUnsafeTransformCleanupHook(calls) }]
    }
  };

  try {
    assert.equal(patchTransformCleanupUpdateActorHook(), true);
    const patchedHook = globalThis.Hooks.events.updateActor[0].fn;

    assert.equal(patchTransformCleanupUpdateActorHook(), false);
    assert.equal(globalThis.Hooks.events.updateActor[0].fn, patchedHook);
  }
  finally {
    globalThis.Hooks = previousHooks;
  }
});
