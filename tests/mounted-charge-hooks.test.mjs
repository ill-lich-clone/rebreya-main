import test from "node:test";
import assert from "node:assert/strict";
import { registerCombatHooks } from "../scripts/combat/hooks.js";

test("mounted combat uses existing update and damage hooks", async () => {
  const callbacks = new Map(), calls = [];
  globalThis.Hooks = { on(name, fn) { const entries = callbacks.get(name) ?? []; entries.push(fn); callbacks.set(name, entries); } };
  globalThis.game = {};
  const combatAttackService = { noteChargeMovement() { calls.push("move"); }, async handleWeaponModTokenMove() {},
    applyWhirlwindDamage() {}, async applyMidiMountedChargeDamage() { calls.push("damage"); }, applyMountedChargePreCalculateDamage() { calls.push("filter"); return true; } };
  const reactionCapabilityIndex = { refreshToken() {} };
  registerCombatHooks({ combatAttackService, reactionCapabilityIndex });
  callbacks.get("updateToken")[0]({}, { x: 1 }, {});
  await callbacks.get("midi-qol.DamageRollComplete")[0]({});
  for (const callback of callbacks.get("dnd5e.preCalculateDamage")) callback({}, [], {});
  assert.deepEqual(calls, ["move", "damage", "filter"]);
});
