import test from "node:test";
import assert from "node:assert/strict";
import { registerCombatHooks } from "../scripts/combat/hooks.js";

test("flourish hooks use the existing bardic service and clean up combat transitions", async () => {
  const callbacks = new Map(), calls = [];
  globalThis.Hooks = { on(name, fn) { const list = callbacks.get(name) ?? []; list.push(fn); callbacks.set(name, list); } };
  globalThis.game = {};
  const service = {
    applyMidiBladeFlourishPreAttack: async workflow => { calls.push(["pre", workflow]); return true; },
    applyMidiBladeFlourishDamage: async workflow => { calls.push(["damage", workflow]); return true; },
    applyBladeFlourishPreCalculateDamage: () => { calls.push(["filter"]); return true; },
    handleBladeFlourishCombatTurn: async combat => { calls.push(["turn", combat]); },
    handleBladeFlourishCombatEnd: async combat => { calls.push(["end", combat]); },
    handleBladeFlourishCombatantRemoved: async combatant => { calls.push(["removed", combatant]); },
    reconcileBladeFlourishEffects: async () => {}, applyDnd5ePreUseActivity: () => true, applyDnd5ePostUseActivity: async () => true
  };
  registerCombatHooks({ bardicInspirationCompatService: service });
  const workflow = {}, combat = {}, combatant = {};
  await callbacks.get("midi-qol.preAttackRoll")[0](workflow);
  await callbacks.get("midi-qol.DamageRollComplete")[0](workflow);
  callbacks.get("dnd5e.preCalculateDamage")[0]({}, [], {});
  await callbacks.get("updateCombat")[0](combat, { turn: 2 });
  await callbacks.get("deleteCombat")[0](combat);
  await callbacks.get("deleteCombatant")[0](combatant);
  assert.deepEqual(calls.map(call => call[0]), ["pre", "damage", "filter", "turn", "end", "removed"]);
});


test("flourish recovery is reconsidered when users reconnect", async () => {
  const callbacks = new Map(); let reconciles = 0;
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: { activeGM: gm }, actors: { contents: [] } };
  globalThis.canvas = { scene: { tokens: { contents: [] } } };
  globalThis.Hooks = { on(name, fn) { const list = callbacks.get(name) ?? []; list.push(fn); callbacks.set(name, list); } };
  const bard = { reconcileBladeFlourishEffects: async () => { reconciles++; } };
  registerCombatHooks({ bardicInspirationCompatService: bard });
  await Promise.resolve();
  const initial = reconciles;
  await callbacks.get("userConnected")[0]();
  assert.equal(reconciles, initial + 1);
});
