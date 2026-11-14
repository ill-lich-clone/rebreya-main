import assert from "node:assert/strict";
import test from "node:test";
import { registerGroupedCombatRuntime, panToActiveCombatGroup } from "../scripts/integrations/grouped-combat-runtime.js";

function fixture() {
  const listeners = new Map(), calls = [];
  const Hooks = { on(name, fn) { const list = listeners.get(name) ?? []; list.push(fn); listeners.set(name, list); return fn; }, off(name, fn) { listeners.set(name, (listeners.get(name) ?? []).filter(f => f !== fn)); }, callAll(name, ...args) { for (const fn of listeners.get(name) ?? []) fn(...args); } };
  class Combat {
    constructor(managed = true) {
      this.id = "fight"; this.round = 1; this.turn = 0; this.started = true; this.scene = { id: "s" }; this.settings = { skipDefeated: true };
      this.combatants = ["a", "b", "pc"].map(id => ({ id, parent: this, visible: true, actor: { uuid: `Actor.${id}` }, token: { id, parent: this.scene, uuid: `Scene.s.Token.${id}` }, initiative: id === "pc" ? 10 : 15 }));
      this.turns = [...this.combatants]; this.combatant = this.turns[0];
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
test("an oversized jump tells the GM to use smaller transitions", async (t) => {
  const e = fixture(), warnings = [];
  const oldGame = globalThis.game, oldUi = globalThis.ui;
  t.after(() => { globalThis.game = oldGame; globalThis.ui = oldUi; });
  globalThis.game = { user: { id: "gm", isGM: true } };
  globalThis.ui = { notifications: { warn: message => warnings.push(message) } };
  e.moduleApi.groupedCombatService.transition = async () => ({ ok: false, code: "combat-transition-too-large" });
  t.after(registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat }));
  await new e.Combat().nextTurn();
  assert.match(warnings[0], /несколькими меньшими шагами/);
});
test("next round advances through each live group in order and stops on failure", async (t) => {
  const e = fixture(), combat = new e.Combat(), state = combat.flags["rebreya-main"].groupedCombat;
  const oldGame = globalThis.game, oldUi = globalThis.ui;
  t.after(() => { globalThis.game = oldGame; globalThis.ui = oldUi; });
  globalThis.game = { user: { id: "gm", isGM: true } }; globalThis.ui = { notifications: { warn() {} } };
  combat.combatants.push({ id: "d", actor: { uuid: "Actor.d" } }); combat.turns = combat.combatants;
  state.groups.push({ id: "d", memberIds: ["d"] });
  let fail = false;
  e.moduleApi.groupedCombatService.transition = async request => {
    e.calls.push([request.targetRound, request.targetGroupId]);
    if (fail && request.targetGroupId === "d") return { ok: false, code: "combat-phase-failed" };
    state.current = { round: request.targetRound, groupId: request.targetGroupId }; state.revision++;
    combat.round = request.targetRound; return { ok: true };
  };
  t.after(registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat }));
  await combat.nextRound();
  assert.deepEqual(e.calls, [[1, "pc"], [1, "d"], [2, "g"]]);
  e.calls.length = 0; fail = true;
  await combat.nextRound();
  assert.deepEqual(e.calls, [[2, "pc"], [2, "d"]]);
  assert.deepEqual(state.current, { round: 2, groupId: "pc" });
});
test("next round joins an already running transition without starting another", async (t) => {
  const e = fixture(), combat = new e.Combat(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  const oldGame = globalThis.game;
  globalThis.game = { user: { id: "gm", isGM: true } };
  t.after(() => { globalThis.game = oldGame; });
  e.moduleApi.groupedCombatService.transition = async request => { e.calls.push(request); await gate; return { ok: true }; };
  t.after(registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat }));
  const turn = combat.nextTurn(), round = combat.nextRound();
  assert.equal(e.calls.length, 1); release(); await Promise.all([turn, round]);
  assert.equal(e.calls.length, 1);
});
test("a player's next round is checked as one request without ending intermediate turns", async (t) => {
  const e = fixture(), combat = new e.Combat(), oldGame = globalThis.game, oldUi = globalThis.ui;
  t.after(() => { globalThis.game = oldGame; globalThis.ui = oldUi; });
  globalThis.game = { user: { id: "player", isGM: false } }; globalThis.ui = { notifications: { warn() {} } };
  e.moduleApi.groupedCombatService.transition = async request => { e.calls.push(request); return { ok: false, code: "forbidden" }; };
  t.after(registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat }));
  await combat.nextRound();
  assert.equal(e.calls.length, 1); assert.equal(e.calls[0].targetRound, 2); assert.equal(e.calls[0].targetGroupId, "g");
  assert.deepEqual(combat.flags["rebreya-main"].groupedCombat.current, { round: 1, groupId: "g" });
});
test("next round stops if another client changes the combat between steps", async (t) => {
  const e = fixture(), combat = new e.Combat(), state = combat.flags["rebreya-main"].groupedCombat;
  const oldGame = globalThis.game, oldUi = globalThis.ui, oldTimeout = globalThis.setTimeout;
  t.after(() => { globalThis.game = oldGame; globalThis.ui = oldUi; globalThis.setTimeout = oldTimeout; });
  globalThis.game = { user: { id: "gm", isGM: true } }; globalThis.ui = { notifications: { warn() {} } };
  combat.combatants.push({ id: "d", actor: { uuid: "Actor.d" } }); combat.turns = combat.combatants;
  state.groups.push({ id: "d", memberIds: ["d"] });
  e.moduleApi.groupedCombatService.transition = async request => { e.calls.push(request); state.current = { round: request.targetRound, groupId: request.targetGroupId }; state.revision++; return { ok: true }; };
  globalThis.setTimeout = callback => { state.current = { round: 1, groupId: "d" }; state.revision++; callback(); };
  t.after(registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat }));
  await combat.nextRound();
  assert.equal(e.calls.length, 1); assert.equal(state.current.groupId, "d");
});
test("next round does not rewind when the current last group is defeated", async (t) => {
  const e = fixture(), combat = new e.Combat(), state = combat.flags["rebreya-main"].groupedCombat;
  const oldGame = globalThis.game; t.after(() => { globalThis.game = oldGame; });
  globalThis.game = { user: { id: "gm", isGM: true } };
  combat.combatants[2].isDefeated = true; state.current.groupId = "pc"; combat.turn = 2;
  e.moduleApi.groupedCombatService.transition = async request => { e.calls.push(request); state.current = { round: request.targetRound, groupId: request.targetGroupId }; state.revision++; return { ok: true }; };
  t.after(registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat }));
  await combat.nextRound();
  assert.equal(e.calls.length, 1); assert.equal(e.calls[0].targetRound, 2); assert.equal(e.calls[0].targetGroupId, "g");
});
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

test("skipping defeated groups reads the combatant collection once per navigation", async (t) => {
  const e = fixture(), combat = new e.Combat();
  t.after(registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat }));
  const previousGame = globalThis.game;
  t.after(() => { globalThis.game = previousGame; });
  globalThis.game = { user: { id: "gm", isGM: true } };
  const members = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, isDefeated: i === 1 }));
  const state = combat.flags["rebreya-main"].groupedCombat;
  state.current.groupId = "g0";
  state.groups = members.map((member, i) => ({ id: `g${i}`, memberIds: [member.id] }));
  let snapshots = 0;
  combat.combatants = { get contents() { snapshots++; return members; } };

  await combat.nextTurn();
  assert.equal(e.calls[0].targetGroupId, "g2");
  assert.equal(snapshots, 1);
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

test("camera requires a live and eligible entry in initiative for the current group", async () => {
  const e = fixture(), combat = new e.Combat(), pans = [], arrivals = [];
  const [a, b, other] = combat.combatants;
  a.token.object = { isVisible: true, center: { x: 10, y: 20 } };
  b.token.object = { isVisible: true, center: { x: 30, y: 40 } };
  other.token.object = { isVisible: true, center: { x: 50, y: 60 } };
  const canvas = { ready: true, scene: combat.scene, animatePan: async point => pans.push(point) };
  const player = { isGM: false };
  const options = { canvas, game: { user: player }, onArrive: candidate => arrivals.push(candidate.c.id) };
  a.initiative = null;
  b.visible = false;
  assert.equal(await panToActiveCombatGroup(combat, options), false);
  assert.deepEqual(pans, []);
  b.visible = true;
  b.initiative = 0;
  assert.equal(await panToActiveCombatGroup(combat, options), true);
  assert.deepEqual(arrivals, ["b"]);
  combat.turns = [a, other];
  player.isGM = true;
  assert.equal(await panToActiveCombatGroup(combat, options), false);
  a.initiative = NaN;
  assert.equal(await panToActiveCombatGroup(combat, options), false);
  a.initiative = 15;
  a.token.parent = { id: "elsewhere" };
  assert.equal(await panToActiveCombatGroup(combat, options), false);
  assert.equal(pans.length, 1);
});

test("turn title replaces the native name only after camera arrival and restores it after two seconds", async (t) => {
  const e = fixture(), combat = new e.Combat(), displays = [], timers = new Map();
  const originals = { canvas: globalThis.canvas, game: globalThis.game, document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  t.after(() => Object.assign(globalThis, originals));
  const nativeName = { renderable: true, visible: true };
  const token = { name: "Мира", nameplate: nativeName, center: { x: 12, y: 20 }, bounds: { x: 2, y: 10, width: 20, height: 20 } };
  combat.combatants[0].token.object = token;
  combat.combatants[0].actor = { type: "character", hasPlayerOwner: true };
  let arrive;
  globalThis.canvas = { ready: true, scene: { id: "s" }, animatePan: () => new Promise(resolve => { arrive = resolve; }),
    clientCoordinatesFromCanvas: ({ x, y }) => ({ x: x + 200, y: y + 100 }) };
  globalThis.game = { user: { isGM: true } };
  globalThis.document = {
    createElement: () => ({ dataset: {}, style: {}, remove() { displays.splice(displays.indexOf(this), 1); } }),
    documentElement: { clientWidth: 500, clientHeight: 300 },
    body: { append: element => displays.push(element) }
  };
  let cssPosition = "fixed";
  globalThis.getComputedStyle = () => ({ position: cssPosition });
  globalThis.setTimeout = (callback, delay) => { timers.set(callback, delay); return callback; };
  globalThis.clearTimeout = callback => timers.delete(callback);
  t.after(registerGroupedCombatRuntime(e.moduleApi, { Hooks: e.Hooks, CombatClass: e.Combat }));

  e.Hooks.callAll("updateCombat", combat);
  assert.equal(displays.length, 0);
  assert.equal(nativeName.renderable, true);
  arrive(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(displays[0]?.textContent, "Мира");
  assert.equal(displays[0].dataset.style, "hero");
  assert.equal(displays[0].style.left, "212px");
  assert.equal(displays[0].style.top, "130px");
  assert.equal(nativeName.renderable, false);
  nativeName.visible = false;
  const [[finish, delay]] = timers;
  assert.equal(delay, 2000);
  finish();
  assert.equal(displays.length, 0);
  assert.deepEqual(nativeName, { renderable: true, visible: false });

  const enemyName = { renderable: true };
  combat.combatants[2].token.object = { ...token, name: "Страж", nameplate: enemyName };
  combat.flags["rebreya-main"].groupedCombat.current = { round: 1, groupId: "pc" };
  e.Hooks.callAll("updateCombat", combat);
  arrive(true); await Promise.resolve();
  assert.equal(displays[0]?.textContent, "Страж");
  assert.equal(displays[0].dataset.style, "opponent");
  assert.equal(enemyName.renderable, false);
  globalThis.game.user.isGM = false;
  combat.combatants[2].token.object.isVisible = false;
  e.Hooks.callAll("sightRefresh");
  assert.equal(displays.length, 0);
  assert.equal(enemyName.renderable, true);
  globalThis.game.user.isGM = true;
  combat.flags["rebreya-main"].groupedCombat.current = { round: 2, groupId: "pc" };
  e.Hooks.callAll("updateCombat", combat);
  arrive(true); await Promise.resolve();
  assert.equal(enemyName.renderable, false);
  e.Hooks.callAll("canvasTearDown");
  assert.equal(displays.length, 0);
  assert.equal(enemyName.renderable, true);

  const current = combat.flags["rebreya-main"].groupedCombat.current;
  current.round = 3;
  cssPosition = "static";
  e.Hooks.callAll("updateCombat", combat);
  arrive(true); await Promise.resolve();
  assert.equal(displays.length, 0);
  assert.equal(enemyName.renderable, true);
  current.round = 4;
  cssPosition = "fixed";
  e.Hooks.callAll("updateCombat", combat);
  arrive(true); await Promise.resolve();
  assert.equal(displays.length, 1);
  combat.combatants[2].initiative = null;
  e.Hooks.callAll("updateCombatant", combat.combatants[2]);
  assert.equal(displays.length, 0);
  assert.equal(enemyName.renderable, true);

  current.round = 5;
  combat.combatants[2].initiative = 10;
  globalThis.canvas.clientCoordinatesFromCanvas = () => ({ x: 550, y: 100 });
  e.Hooks.callAll("updateCombat", combat);
  arrive(true); await Promise.resolve();
  assert.equal(displays.length, 0);
  assert.equal(enemyName.renderable, true);
});

test("an interrupted or stale camera move cannot show a title", async () => {
  const e = fixture(), combat = new e.Combat(), names = [];
  const state = combat.flags["rebreya-main"].groupedCombat;
  combat.combatants[0].token.object = { isVisible: true, center: { x: 2, y: 3 } };
  const canvas = { ready: true, scene: { id: "s" }, animatePan: async () => false };
  const options = { canvas, game: { user: { isGM: false } }, onArrive: value => names.push(value) };
  assert.equal(await panToActiveCombatGroup(combat, options), false);
  combat.combatants[0].token.isSecret = true;
  canvas.animatePan = async () => assert.fail("secret token cannot become a player camera target");
  assert.equal(await panToActiveCombatGroup(combat, options), false);
  combat.combatants[0].token.isSecret = false;
  canvas.animatePan = async () => { state.current = { round: 1, groupId: "pc" }; return true; };
  assert.equal(await panToActiveCombatGroup(combat, options), false);
  assert.deepEqual(names, []);
  state.current = { round: 1, groupId: "g" };
  const a = combat.combatants[0];
  canvas.animatePan = async () => { a.initiative = null; return true; };
  assert.equal(await panToActiveCombatGroup(combat, options), false);
  a.initiative = 15;
  canvas.animatePan = async () => { a.token.object = { ...a.token.object }; return true; };
  assert.equal(await panToActiveCombatGroup(combat, options), false);
  canvas.animatePan = async () => { combat.combatants.shift(); return true; };
  assert.equal(await panToActiveCombatGroup(combat, options), false);
  assert.deepEqual(names, []);
});
