import assert from "node:assert/strict";
import test from "node:test";
import { createGroupedCombatEffects, describeInitiative, inspectGroupedCombatSupport } from "../scripts/integrations/grouped-combat-effects.js";
import { loadInstalledFunction, loadInstalledClass } from "./helpers/installed-combat-providers.mjs";

const effect = (id, flags = {}, changes = []) => ({ id, uuid: `Actor.a.ActiveEffect.${id}`, flags, changes, duration: {}, toObject() { return { _id: id, flags }; } });
function environment() {
  const calls = [], actors = ["a", "b", "c"].map(id => ({ id, uuid: `Actor.${id}`, appliedEffects: [effect(id, { dae: { macroRepeat: "startEndEveryTurn" } })] }));
  const combatants = actors.map((actor, i) => ({ id: actor.id, actor, token: { id: actor.id }, async recoverCombatUses(periods) { calls.push([actor.id, periods.join(",")]); } }));
  const state = { groups: [{ id: "g", memberIds: ["a", "b", "c"] }], current: { round: 1, groupId: "g" }, mode: "active" };
  const combat = { id: "combat", turns: combatants, combatants, flags: { "rebreya-main": { groupedCombat: state } } };
  const game = { user: { id: "gm", isGM: true }, version: "13.351", system: { id: "dnd5e", version: "5.2.5" }, modules: new Map() };
  const api = createGroupedCombatEffects({ gameProvider: () => game, DAE: { async daeMacro(_each, actor, _effect, options) { calls.push([actor.id, options.turn]); } } });
  return { calls, combat, actors, game, api };
}
test("every group member starts at entry and ends only at exit, with awaited individual repeats", async () => {
  const { calls, combat, api } = environment();
  for (const step of api.plan(combat, { kind: "turn-start", round: 1, groupId: "g", memberIds: ["a", "b", "c"] })) await step.run();
  assert.deepEqual(calls.filter(c => c[1] === "startTurn").map(c => c[0]), ["a", "b", "c"]);
  assert.equal(calls.some(c => c[1] === "endTurn"), false);
  for (const step of api.plan(combat, { kind: "turn-end", round: 1, groupId: "g", memberIds: ["a", "b", "c"] })) await step.run();
  assert.deepEqual(calls.filter(c => c[1] === "endTurn").map(c => c[0]), ["a", "b", "c"]);
});
test("source durations expire on the source member, Any repeats include suppressed effects, native guards leave ordinary combat intact", async () => {
  const { calls, combat, actors, game } = environment();
  const source = effect("source", { dae: { specialDuration: ["turnStartSource"] } }); source.origin = "Actor.b.Item.spell";
  actors[2].appliedEffects.push(source);
  actors[0].appliedEffects[0].disabled = true;
  actors[1].appliedEffects[0].disabled = true; actors[1].appliedEffects[0].flags.dae.macroRepeat = "startEveryTurnAny";
  let ordinaryCalls = 0;
  const native = function updateCombat() { const specialDuration = "turnStartSource"; const timesUpEnabled = true; ordinaryCalls++; return [specialDuration, timesUpEnabled]; };
  const Hooks = { events: { updateCombat: [{ fn: native }] } };
  game.modules.set("times-up", { active: true, version: "13.1.9" });
  const api = createGroupedCombatEffects({ gameProvider: () => game, Hooks, TimesUp: { async expireEffect(e) { calls.push([e.id, "expired"]); } }, DAE: { async daeMacro(_each, actor, _e, opts) { calls.push([actor.id, opts.turn]); } } });
  api.installNativeGuards();
  Hooks.events.updateCombat[0].fn(combat, { turn: 2 });
  Hooks.events.updateCombat[0].fn(combat, { flags: { "rebreya-main": { groupedCombat: { revision: 2 } } } });
  Hooks.events.updateCombat[0].fn({ flags: {} }, { turn: 2 });
  assert.equal(ordinaryCalls, 1);
  Hooks.events.updateCombat[0].fn({ flags: { "rebreya-main": { groupedCombat: { mode: "pending" } } } }, { turn: 2 });
  assert.equal(ordinaryCalls, 2, "pending native round must keep its original provider handler");
  for (const step of api.plan(combat, { kind: "turn-start", round: 2, groupId: "g", memberIds: ["a", "b", "c"] })) await step.run();
  assert.equal(calls.some(c => c[0] === "a" && c[1] === "startTurn"), false);
  assert.equal(calls.some(c => c[0] === "b" && c[1] === "startTurn"), true);
  assert.equal(calls.filter(c => c[0] === "source" && c[1] === "expired").length, 1);
});
test("initiative profiles retain fixed scores, advantage and authored terms while ignoring display fields", () => {
  const actor = (options = {}) => ({ getInitiativeRoll: () => ({ formula: "1d20 + 5", terms: [{ formula: "1d20" }, { number: 5 }], options }) });
  assert.equal(describeInitiative(actor({ advantage: true, flavor: "Первый" })).key, describeInitiative(actor({ advantage: true, flavor: "Второй" })).key);
  assert.notEqual(describeInitiative(actor()).key, describeInitiative(actor({ advantage: true })).key);
  assert.equal(describeInitiative(actor({ customRule: true })).canShare, false);
  assert.equal(inspectGroupedCombatSupport({ game: { system: { id: "other" }, modules: new Map() }, Hooks: {} }).supported, false);
});

test("installed native D20Roll normalization stays shareable and all native semantic modifiers remain distinct", async () => {
  class Die {
    options = {}; isValid = true;
    applyFlag() {} applyAdvantage() {} applyRange() {}
  }
  class BasicRoll {
    constructor(formula, data, options) { this.formula = formula; this.options = { ...options }; this.terms = [new Die()]; }
    resetFormula() {}
  }
  const D20Roll = await loadInstalledClass("../systems/dnd5e/dnd5e.mjs", "D20Roll", { BasicRoll, D20RollConfigurationDialog: class {}, CONFIG: { Dice: { D20Die: Die } }, foundry: { dice: { terms: { Die } } } });
  const profile = options => {
    const roll = new D20Roll("1d20 + 2 + 0.13", {}, { advantage: false, disadvantage: false, halflingLucky: false, maximum: Infinity, minimum: -Infinity, ...options });
    assert.equal(roll.options.configured, true);
    assert.equal(typeof roll.options.advantageMode, "number");
    return describeInitiative({ getInitiativeRoll: () => roll });
  };
  const normal = profile({});
  assert.equal(normal.canShare, true);
  assert.equal(normal.key, profile({ flavor: "Другой тролль" }).key);
  for (const options of [{ advantageMode: 1 }, { advantageMode: -1 }, { criticalSuccess: 19 }, { criticalFailure: 2 }, { target: 15 }]) {
    const changed = profile(options); assert.equal(changed.canShare, true); assert.notEqual(changed.key, normal.key);
  }
  assert.equal(profile({ customRule: true }).canShare, false);
});
test("installed MIDI ActivityOverTime route awaits its registered handler and preserves private active/offline ownership", async () => {
  const calls = [], actor = { uuid: "Actor.a" }, e = effect("activity", {}, [{ key: "flags.midi-qol.ActivityOverTime.a", value: "Item.activity" }]);
  let owner = { id: "player", active: true };
  const fn = await loadInstalledFunction("midi-qol/midi-qol.js", "doActivityOverTimeEffect", {
    CONST: { DICE_ROLL_MODES: { PRIVATE: "gmroll", SELF: "selfroll" } }, game: { user: { id: "gm" } },
    playerForActor: () => owner, getOvertimeActivity: async () => ({ midiProperties: { rollMode: "selfroll" } }),
    localActivityOverTimeEffect: async () => calls.push("local"), socketlibSocket: { executeAsUser: async (_handler, id) => { await Promise.resolve(); calls.push(id); } }
  });
  await fn(actor, e, true); assert.deepEqual(calls, ["player"]);
  owner.active = false; await fn(actor, e, true); assert.deepEqual(calls, ["player", "local"]);
  e.disabled = true; await fn(actor, e, true); assert.equal(calls.length, 2);
});

test("the grouped MIDI adapter awaits each member's native legacy/activity workflow and preserves owner routing", async () => {
  const e = environment(), calls = [];
  let owner = { id: "player", active: true };
  const activity = { overTimeProperties: { turnChoice: "start" }, midiProperties: { rollMode: "selfroll" } };
  for (const actor of e.actors) actor.appliedEffects = [effect(actor.id, {}, [{ key: "flags.midi-qol.OverTime.a", value: "turn=start,damageRoll=1" }, { key: "flags.midi-qol.ActivityOverTime.a", value: "Item.activity" }])];
  const api = createGroupedCombatEffects({ gameProvider: () => e.game, fromUuid: async () => activity,
    MidiQOL: { playerForActor: () => owner, async doOverTimeEffect(actor, _effect, start) { calls.push(`legacy:${actor.id}:${start}:begin`); await Promise.resolve(); calls.push(`legacy:${actor.id}:${start}:done`); },
      socket: () => ({ async executeAsGM() {}, async executeAsUser(handler, executorId, payload) { calls.push(`${handler}:${executorId}:${payload.actorUuid}:${payload.startTurn}:begin`); await Promise.resolve(); calls.push("activity:done"); } }) } });
  for (const step of api.plan(e.combat, { kind: "turn-start", round: 1, groupId: "g", memberIds: ["a", "b", "c"] })) await step.run();
  assert.deepEqual(calls.slice(0, 4), ["legacy:a:true:begin", "legacy:a:true:done", "localActivityOverTimeEffect:player:Actor.a:true:begin", "activity:done"]);
  assert.equal(calls.filter(c => c.endsWith(":true:done")).length, 3);
  owner = { id: "player", active: false }; calls.length = 0;
  for (const step of api.plan(e.combat, { kind: "turn-start", round: 2, groupId: "g", memberIds: ["a"] })) await step.run();
  assert.equal(calls[2], "localActivityOverTimeEffect:gm:Actor.a:true:begin");
  calls.length = 0;
  for (const step of api.plan(e.combat, { kind: "turn-end", round: 2, groupId: "g", memberIds: ["a"] })) await step.run();
  assert.equal(calls[0], "legacy:a:false:begin"); assert.equal(calls[1], "legacy:a:false:done");
});
test("Effect Macro retains its designated player executor through an awaited, receipt-bound handler", async () => {
  const e = environment(), calls = [], handlers = new Map();
  const game = e.game; game.combats = new Map([[e.combat.id, e.combat]]);
  const effectmacro = { utils: { hasMacro: () => true, getExecutor: () => ({ id: "player", active: true }), isExecutor: () => false,
    callMacro: async () => { throw new Error("must not run a player macro on the GM"); } } };
  const socketlib = { registerModule() { return { register(name, fn) { handlers.set(name, fn); }, async executeAsUser(name, userId, payload) { await Promise.resolve(); calls.push([name, userId, payload]); } }; } };
  const api = createGroupedCombatEffects({ gameProvider: () => game, effectmacro, socketlib });
  for (const step of api.plan(e.combat, { kind: "turn-start", round: 1, groupId: "g", memberIds: ["a"] })) await step.run();
  assert.equal(calls.length, 1); assert.equal(calls[0][1], "player");
  const handler = handlers.get("groupedEffectMacro"); assert.ok(handler);
  assert.equal((await handler(calls[0][2])).status, "cancelled");
});
test("round/turn durations on an outside target expire at the shared boundary without changing authored duration", async () => {
  const e = environment(), expired = [];
  const duration = { type: "turns", rounds: 1, turns: 0, startRound: 1, startTurn: 0 };
  const outside = effect("outside"); outside.duration = { ...duration };
  e.combat.combatants.push({ id: "pc", actor: { id: "pc", appliedEffects: [outside] } });
  e.combat.flags["rebreya-main"].groupedCombat.groups.push({ id: "pc", memberIds: ["pc"] });
  const api = createGroupedCombatEffects({ gameProvider: () => e.game, TimesUp: { expireEffect: async ef => expired.push(ef.id) } });
  for (const step of api.plan(e.combat, { kind: "turn-start", round: 2, groupId: "g", memberIds: ["a", "b", "c"] })) await step.run();
  assert.deepEqual(expired, ["outside"]); assert.deepEqual(outside.duration, duration);
});
test("MIDI automatic individual rerolls are rejected before combat mutation rather than breaking shared initiative", () => {
  const e = environment(); e.game.modules.set("midi-qol", { active: true, version: "13.0.61" });
  const fn = function () { _processOverTime(); _processActivityOverTime(); };
  const api = createGroupedCombatEffects({ gameProvider: () => e.game, Hooks: { events: { updateCombat: [{ fn }] } },
    MidiQOL: { doOverTimeEffect() {}, socket() {}, playerForActor() {}, currentConfigSettings: { toggleOptionalRules: false, optionalRules: { autoRerollInitiative: true } } } });
  assert.equal(api.inspect().supported, false);
  assert.ok(api.inspect().issues.includes("midi-auto-reroll-initiative"));
});
