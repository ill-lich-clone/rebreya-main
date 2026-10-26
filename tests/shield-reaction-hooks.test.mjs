import assert from "node:assert/strict";
import test from "node:test";
import { registerCombatHooks } from "../scripts/combat/hooks.js";

test("combat hook registers Shield filter once and preserves all original hook arguments", async () => {
  const oldGame = globalThis.game; const oldHooks = globalThis.Hooks;
  const hooks = new Map(); const received = [];
  globalThis.game = {};
  globalThis.Hooks = { on: (name, fn) => { hooks.set(name, [...hooks.get(name) ?? [], fn]); } };
  try {
    const api = { midiReactionAdapter: { filterReactions: (...args) => received.push(args) } };
    registerCombatHooks(api); registerCombatHooks(api);
    assert.equal(hooks.get("midi-qol.ReactionFilter")?.length, 1);
    const args = [[], { workflow: {} }, "reaction", []];
    await hooks.get("midi-qol.ReactionFilter")[0](...args);
    assert.deepEqual(received, [args]);
  } finally { globalThis.game = oldGame; globalThis.Hooks = oldHooks; }
});
