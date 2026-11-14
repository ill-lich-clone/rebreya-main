// Synthetic Node benchmark: no Foundry Documents, network, rendering or real provider workflows.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { GroupedCombatService } from "../scripts/application/grouped-combat-service.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { createGroupedCombatEffects } from "../scripts/integrations/grouped-combat-effects.js";

const counts = { effects: 0, recoveries: 0, snapshots: 0, patches: 0, rolls: 0 };
const tokens = Array.from({ length: 200 }, (_, i) => {
  const id = `c${String(i).padStart(3, "0")}`, npc = i < 160;
  const effect = { id: `effect-${id}`, uuid: `Actor.${id}.ActiveEffect.effect-${id}`, flags: { dae: { macroRepeat: "startEndEveryTurn" } }, changes: [], duration: {}, toObject() { return { _id: this.id, flags: this.flags }; } };
  const actor = { id, uuid: `Actor.${id}`, type: npc ? "npc" : "character", appliedEffects: [effect], items: { contents: [] }, getInitiativeRoll: () => ({ formula: "1d20+2", options: {} }) };
  return { id, uuid: `Scene.s.Token.${id}`, parent: { id: "s" }, disposition: -1, actorLink: !npc, baseActor: { id: npc ? "goblin" : id }, actor };
});
const byToken = new Map(tokens.map(token => [token.uuid, token]));
const combat = { id: "fight", scene: { id: "s" }, round: 0, turn: null, started: false, combatants: [], turns: [], settings: { skipDefeated: true } };
let saved = null;
const repository = {
  getCombat: () => combat, getActiveCombat: () => combat,
  readState: () => structuredClone(saved),
  async writeState(_combat, state, { expectedRevision }) {
    assert.equal(saved?.revision ?? 0, expectedRevision); counts.snapshots++;
    state.revision = expectedRevision + 1; saved = structuredClone(state);
  },
  async writeReceipt(_combat, state, key, { expectedRevision }) {
    assert.equal(saved.revision, expectedRevision); counts.patches++;
    state.revision = expectedRevision + 1; saved.revision = state.revision; saved.receipts[key] = structuredClone(state.receipts[key]);
  },
  async createMissingCombatants(_combat, selected) {
    combat.combatants = selected.map(token => ({ id: token.id, token, actor: token.actor, initiative: null, async recoverCombatUses() { counts.recoveries++; } }));
    combat.turns = combat.combatants;
  },
  async commitNativePosition(_combat, position) { Object.assign(combat, position, { started: true }); combat.combatant = combat.turns[combat.turn]; },
  async beginCombat(combat, position) { return this.commitNativePosition(combat, position); }
};
combat.rollInitiative = async ids => { for (const id of ids) { combat.combatants.find(c => c.id === id).initiative = id === "c000" ? 20 : 10; counts.rolls++; } };
combat.updateEmbeddedDocuments = async (_type, updates) => { for (const update of updates) Object.assign(combat.combatants.find(c => c.id === update._id), update); };
const game = { user: { id: "gm", isGM: true }, version: "13.351", system: { id: "dnd5e", version: "5.2.5" }, modules: new Map() };
const effects = createGroupedCombatEffects({ gameProvider: () => game, DAE: { async daeMacro() { counts.effects++; } }, planRebreyaPhase: () => [] });
effects.inspect = () => ({ supported: true });
const service = new GroupedCombatService({ repository, effects, coordinator: new WorldMutationCoordinator(), resolveToken: uuid => byToken.get(uuid), gameProvider: () => game, isAuthority: () => true });
async function measure(label, run) {
  const before = { ...counts }, start = performance.now(), result = await run(), ms = performance.now() - start;
  assert.equal(result.ok, true, JSON.stringify(result));
  console.log(JSON.stringify({ operation: label, ms: +ms.toFixed(1), ...Object.fromEntries(Object.keys(counts).map(k => [k, counts[k] - before[k]])) }));
}
await measure("start", () => service.start({ sceneId: "s", tokenUuids: tokens.map(t => t.uuid), operationId: "start" }, { sender: game.user }));
assert.equal(saved.groups.length, 41); assert.equal(counts.rolls, 41); assert.equal(counts.effects, 160);
console.log(JSON.stringify({ participants: tokens.length, groups: saved.groups.length, npcGroup: 160, independent: 40, effectsPerActor: 1 }));
for (let i = 1; i <= 3; i++) {
  const state = repository.readState();
  await measure(`next-${i}`, () => service.transition({ combatId: combat.id, expectedRevision: state.revision, targetRound: 1, targetGroupId: state.groups[i].id, operationId: `next-${i}` }, { sender: game.user }));
}
await measure("finish-round-by-turns", async () => {
  while (saved.current.round === 1) {
    const state = repository.readState(), next = state.groups.findIndex(group => group.id === state.current.groupId) + 1;
    const result = await service.transition({ combatId: combat.id, expectedRevision: state.revision, targetRound: next === state.groups.length ? 2 : 1,
      targetGroupId: state.groups[next % state.groups.length].id, operationId: `finish-${next}` }, { sender: game.user });
    if (!result.ok) return result;
  }
  return { ok: true };
});
