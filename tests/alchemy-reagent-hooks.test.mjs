import assert from "node:assert/strict";
import test from "node:test";

test("combat hooks route potion use, MIDI completion and time refresh exactly once", async () => {
  const previous = { game: globalThis.game, Hooks: globalThis.Hooks };
  const callbacks = new Map();
  const calls = [];
  globalThis.game = {};
  globalThis.Hooks = { on(name, callback) { callbacks.set(name, callback); } };
  try {
    const { registerCombatHooks } = await import(`../scripts/combat/hooks.js?alchemy-reagent=${Date.now()}`);
    const service = {
      handlePreUse(...args) { calls.push(["pre", ...args]); return false; },
      handlePreConsumption(activity) { calls.push(["consume", activity]); return true; },
      async handleUse(...args) { calls.push(["use", ...args]); },
      async handleMidiComplete(workflow) { calls.push(["midi", workflow]); },
      async handleMidiAbort(workflow) { calls.push(["abort", workflow]); },
      observeItemConsumption(...args) { calls.push(["observed", ...args]); },
      refreshOpenSheets() { calls.push(["refresh"]); }
    };
    registerCombatHooks({ alchemyReagentService: service });
    registerCombatHooks({ alchemyReagentService: service });
    assert.equal(callbacks.get("dnd5e.preUseActivity")("activity", "usage", "dialog", "message"), false);
    assert.equal(callbacks.get("dnd5e.preActivityConsumption")("activity"), true);
    callbacks.get("dnd5e.postUseActivity")("activity", "usage", "result");
    callbacks.get("midi-qol.RollComplete")("workflow");
    callbacks.get("midi-qol.preAbort")("workflow");
    callbacks.get("updateItem")("item", { system: { quantity: 0 } }, {}, "player");
    callbacks.get("deleteItem")("item", {}, "player");
    callbacks.get("updateWorldTime")(120);
    assert.deepEqual(calls.map(([name]) => name), ["pre", "consume", "use", "midi", "abort", "observed", "observed", "refresh"]);
  }
  finally {
    globalThis.game = previous.game;
    globalThis.Hooks = previous.Hooks;
  }
});
