import assert from "node:assert/strict";
import test from "node:test";
import { registerGroupedCombatRuntime, panToActiveCombatGroup } from "../scripts/integrations/grouped-combat-runtime.js";

function fixture() {
  const listeners = new Map(), calls = [];
  const Hooks = { on(name, fn) { const list = listeners.get(name) ?? []; list.push(fn); listeners.set(name, list); return fn; }, off(name, fn) { listeners.set(name, (listeners.get(name) ?? []).filter(f => f !== fn)); }, callAll(name, ...args) { for (const fn of listeners.get(name) ?? []) fn(...args); } };
  class Combat {
    constructor(managed = true) {
      this.id = "fight"; this.round = 1; this.turn = 0; this.started = true; this.scene = { id: "s" }; this.settings = { skipDefeated: true };
      this.combatants = ["a", "b", "pc"].map(id => ({ id, parent: this, actor: { uuid: `Actor.${id}` }, token: { id, uuid: `Scene.s.Token.${id}` }, initiative: id === "pc" ? 10 : 15 }));
      this.turns = this.combatants; this.combatant = this.turns[0];
      this.flags = managed ? { "rebreya-main": { groupedCombat: { version: 1, mode: "active", revision: 2, current: { round: 1, groupId: "g" }, groups: [{ id: "g", memberIds: ["a", "b"], initiative: 15 }, { id: "pc", memberIds: ["pc"], initiative: 10 }] } } } : {};
    }
    async nextTurn() { calls.push("original-next"); return this; }
    async previousTurn() { calls.push("original-previous"); return this; }
    async nextRound() { calls.push("original-round"); return this; }
    async previousRound() { return this; }
    async update(patch) { Object.assign(this, patch); return this; }
    async _manageTurnEvents() { calls.push("original-lifecycle"); }
    _sortCombatants(a, b) { return b.initiative - a.initiative; }
  }
  class Combatant { getGroupingKey() { return "original"; } }
  const moduleApi = { groupedCombatService: { isAuthority: () => true, effects: { installNativeGuards() {} }, observeNativeTransition: async () => {},
    async transition(request) { calls.push(request); return { ok: true }; }, reconcile: async () => {} } };
  return { Hooks, Combat, Combatant, moduleApi, calls, listeners };
}
test("normal next advances an entire group once; ordinary combat delegates; registration is idempotent", async () => {
  const e = fixture();
  const dispose = registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat, CombatantClass: e.Combatant });
  registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat, CombatantClass: e.Combatant });
  globalThis.game = { user: { id: "gm", isGM: true } };
  await new e.Combat().nextTurn();
  assert.equal(e.calls.length, 1); assert.equal(e.calls[0].targetGroupId, "pc");
  await new e.Combat(false).nextTurn(); assert.equal(e.calls.at(-1), "original-next");
  dispose(); delete globalThis.game;
});

test("repeated navigation and a positional update join the pending transition rather than sending stale revisions", async () => {
  const e = fixture(), combat = new e.Combat(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  e.moduleApi.groupedCombatService.transition = async request => {
    e.calls.push(request); await gate;
    const state = combat.flags["rebreya-main"].groupedCombat;
    state.current = { round: request.targetRound, groupId: request.targetGroupId }; state.revision++;
    combat.round = request.targetRound; combat.turn = request.targetGroupId === "pc" ? 2 : 0;
    return { ok: true };
  };
  const dispose = registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat, CombatantClass: e.Combatant });
  const next = combat.nextTurn(), repeated = combat.nextTurn(), updated = combat.update({ round: 1, turn: 2 });
  try {
    assert.equal(e.calls.length, 1, "one in-flight workflow must not receive duplicate requests with the old revision");
    release(); await Promise.all([next, repeated, updated]);
    await combat.nextTurn(); assert.equal(e.calls.length, 2); assert.equal(e.calls[1].targetRound, 2);
  } finally { release(); await Promise.allSettled([next, repeated, updated]); dispose(); }
});

test("a failed transition releases navigation so the next action can be attempted", async () => {
  const e = fixture(), combat = new e.Combat(); let attempts = 0;
  e.moduleApi.groupedCombatService.transition = async () => { attempts++; if (attempts === 1) throw new Error("transport-failed"); return { ok: true }; };
  const dispose = registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat, CombatantClass: e.Combatant });
  try { await assert.rejects(combat.nextTurn(), /transport-failed/); await combat.nextTurn(); assert.equal(attempts, 2); }
  finally { dispose(); }
});

test("deleting a pending combat releases an observing client's lifecycle listener", async () => {
  const e = fixture(); e.moduleApi.groupedCombatService.isAuthority = () => false;
  const dispose = registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat, CombatantClass: e.Combatant });
  const combat = new e.Combat(); combat.flags["rebreya-main"].groupedCombat.pendingTransition = {};
  const pending = combat._manageTurnEvents();
  assert.equal(e.listeners.get("updateCombat").length, 2);
  e.Hooks.callAll("deleteCombat", combat);
  assert.equal(e.listeners.get("updateCombat").length, 1);
  await pending; dispose();
});
test("native grouping keys reflect stable logical groups instead of collisions in integer initiative", () => {
  const e = fixture(); const dispose = registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat, CombatantClass: e.Combatant });
  const combat = new e.Combat(), a = new e.Combatant(), b = new e.Combatant();
  Object.assign(a, { id: "a", parent: combat }); Object.assign(b, { id: "b", parent: combat });
  assert.equal(a.getGroupingKey(), b.getGroupingKey()); assert.equal(a.getGroupingKey(), "g");
  dispose();
});
test("camera is local, keeps scale and selection, and skips hidden group members for players", async () => {
  const e = fixture(), combat = new e.Combat(), pans = [];
  combat.combatants[0].token.object = { isVisible: false, center: { x: 900, y: 900 } };
  combat.combatants[1].token.object = { isVisible: true, center: { x: 10, y: 20 } };
  const canvas = { ready: true, scene: { id: "s" }, animatePan: async options => pans.push(options) };
  await panToActiveCombatGroup(combat, { canvas, game: { user: { isGM: false } }, enabled: true });
  assert.equal(pans.length, 1); assert.equal(pans[0].x, 10); assert.equal(pans[0].y, 20); assert.equal(Object.hasOwn(pans[0], "scale"), false);
  await panToActiveCombatGroup(combat, { canvas, game: { user: { isGM: false } }, enabled: false }); assert.equal(pans.length, 1);
  canvas.scene.id = "other"; await panToActiveCombatGroup(combat, { canvas, game: { user: { isGM: true } }, enabled: true }); assert.equal(pans.length, 1);
});
