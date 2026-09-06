import test from "node:test";
import assert from "node:assert/strict";
import { registerCombatHooks } from "../scripts/combat/hooks.js";
test("curse-only composition registers once and awaits MIDI save resolution", async () => {
  const callbacks = new Map();
  globalThis.game = {};
  globalThis.Hooks = { on: (key, fn) => { const list = callbacks.get(key) ?? []; list.push(fn); callbacks.set(key, list); } };
  let resolved = false;
  const service = { saves: { applyMidiPostCheckSaves: async () => { await Promise.resolve(); resolved = true; return "done"; } } };
  registerCombatHooks({ curseUpgradeAutomationService: service });
  registerCombatHooks({ curseUpgradeAutomationService: service });
  assert.equal(callbacks.get("midi-qol.postCheckSaves").length, 1);
  assert.equal(await callbacks.get("midi-qol.postCheckSaves")[0]({}), "done");
  assert.equal(resolved, true);
  assert.equal(callbacks.get("dnd5e.preApplyDamage").length, 1);
  assert.equal(callbacks.has("dnd5e.restCompleted"), false);
  assert.equal(callbacks.get("midi-qol.preAbort").length, 1);
});
