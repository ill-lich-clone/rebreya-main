import assert from "node:assert/strict";
import test from "node:test";

test("combat hooks bridge bomb prepare, completion, abort and sticky expiry", async () => {
  const previous = { game: globalThis.game, Hooks: globalThis.Hooks };
  const callbacks = new Map();
  const calls = [];
  globalThis.game = {};
  globalThis.Hooks = { on(name, callback) { callbacks.set(name, callback); } };
  try {
    const { registerCombatHooks } = await import(`../scripts/combat/hooks.js?alchemy-bomb=${Date.now()}`);
    registerCombatHooks({
      alchemyBombRuntimeService: {
        async prepareWorkflow(workflow) { calls.push(["prepare", workflow]); return false; },
        async excludeBombTarget(workflow) { calls.push(["filter", workflow]); return true; },
        async completeWorkflow(workflow) { calls.push(["complete", workflow]); return true; },
        async abortWorkflow(workflow) { calls.push(["abort", workflow]); return true; },
        async cleanupExpiredStickyZones(time) { calls.push(["expire", time]); return 1; }
      }
    });
    const workflow = { id: "workflow" };
    assert.equal(await callbacks.get("midi-qol.preItemRollV2")({ workflow }), false);
    for (const event of ["preWaitForSaves", "preCheckSaves", "preAllRollsComplete", "preApplyDynamicEffects"]) {
      assert.equal(await callbacks.get(`midi-qol.${event}`)(workflow), true);
    }
    await callbacks.get("midi-qol.RollComplete")(workflow);
    await callbacks.get("midi-qol.preAbort")(workflow);
    await callbacks.get("updateWorldTime")(123);
    assert.deepEqual(calls.map((entry) => entry[0]), ["prepare", "filter", "filter", "filter", "filter", "complete", "abort", "expire"]);
  }
  finally {
    globalThis.game = previous.game;
    globalThis.Hooks = previous.Hooks;
  }
});
