import assert from "node:assert/strict";
import test from "node:test";
import { registerCombatHooks } from "../scripts/combat/hooks.js";

test("combat hooks dispatch the native reaction filter and abort once with their original arguments", async () => {
  const oldGame = globalThis.game; const oldHooks = globalThis.Hooks;
  const hooks = new Map(); const received = [];
  globalThis.game = {};
  globalThis.Hooks = { on: (name, fn) => { hooks.set(name, [...hooks.get(name) ?? [], fn]); } };
  try {
    const api = { midiReactionAdapter: {}, reactionQueueService: { dispatchMidi: (phase, ...args) => {
      received.push([phase, ...args]);
    } } };
    registerCombatHooks(api); registerCombatHooks(api);
    assert.equal(hooks.get("midi-qol.ReactionFilter")?.length, 1);
    assert.equal(hooks.get("midi-qol.preAbort")?.length, 1);
    const args = [[], { workflow: {} }, "reaction", []];
    const workflow = { id: "shield" };
    await hooks.get("midi-qol.ReactionFilter")[0](...args);
    await hooks.get("midi-qol.preAbort")[0](workflow);
    assert.deepEqual(received, [["ReactionFilter", ...args], ["preAbort", workflow]]);
  } finally { globalThis.game = oldGame; globalThis.Hooks = oldHooks; }
});

test("v13 forward turn boundary expires only active Rebreya Shield effects on the entering defender", async () => {
  const old = { game: globalThis.game, Hooks: globalThis.Hooks };
  const gm = { id: "gm", active: true, isGM: true };
  const handlers = new Map();
  const deleted = [];
  const actor = { effects: [
    { id: "shield", flags: { "rebreya-main": { shieldReaction: { version: 1 } } } },
    { id: "other", flags: {} }
  ], deleteEmbeddedDocuments: async (type, ids) => deleted.push([type, ids]) };
  globalThis.game = { release: { generation: 13 }, users: { activeGM: gm }, user: gm };
  globalThis.Hooks = { on: (name, callback) => handlers.set(name, [...handlers.get(name) ?? [], callback]) };
  try {
    registerCombatHooks({ midiReactionAdapter: {} });
    const event = async (from, to) => {
      for (const fn of handlers.get("combatTurnChange") ?? []) await fn({ combatant: { actor } }, { round: 1, turn: from }, { round: 1, turn: to });
    };
    await event(2, 1);
    assert.deepEqual(deleted, []);
    await event(1, 2);
    assert.deepEqual(deleted, [["ActiveEffect", ["shield"]]]);
  } finally { Object.assign(globalThis, old); }
});

test("reaction hooks route combat exit and only permit native MIDI markers in combat", async t => {
  const previous = { game: globalThis.game, Hooks: globalThis.Hooks };
  const hooks = new Map();
  const exits = [];
  globalThis.game = { release: { generation: 14 } };
  globalThis.Hooks = { on: (name, callback) => hooks.set(name, callback) };
  t.after(() => Object.assign(globalThis, previous));
  registerCombatHooks({ midiReactionAdapter: {}, combatAttackService: {
    handleReactionCombatEnd: (...args) => exits.push(args),
    isReactionTracked: actor => actor.inCombat
  } });
  const combat = { id: "fight" };
  const combatant = { parent: combat };
  assert.equal(hooks.get("midi-qol.preSetReactionUsed")({ inCombat: false }), false);
  assert.equal(hooks.get("midi-qol.preSetReactionUsed")({ inCombat: true }), true);
  await hooks.get("deleteCombatant")(combatant);
  await hooks.get("deleteCombat")(combat);
  assert.deepEqual(exits, [[combat, combatant], [combat, undefined]]);
});
