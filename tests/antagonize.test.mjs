import assert from 'node:assert/strict';
import test from 'node:test';
import { ANTAGONIZE_UUID, buildAntagonizeSpellItem, prepareAntagonizeCastMigration } from '../scripts/data/antagonize-spell-item.js';
import { antagonize, registerAntagonizeCommand } from '../scripts/combat/antagonize.js';

test('the old mantle cache changes source in place, preserves text and charges, and is retryable', async () => {
  const legacy = 'Compendium.chris-premades.CPRSpells.Item.bJRgW6qhbNU3KgoR';
  const id = 'r4dqh51772ngy000', cast = { _id: id, type: 'cast', spell: { uuid: ANTAGONIZE_UUID }, uses: { spent: 1 } };
  const mantle = { id: 'mantle', system: { activities: { [id]: { ...cast, spell: { uuid: legacy } } } } };
  const old = { id: 'cached', type: 'spell', _stats: { compendiumSource: legacy },
    flags: { dnd5e: { cachedFor: '.Item.mantle.Activity.' + id } }, system: { description: { value: 'Авторский текст' } } };
  const separate = structuredClone(old); separate.id = 'separate'; separate.flags = {};
  const writes = [], actor = { items: [old, separate], async updateEmbeddedDocuments(_, [update]) {
    writes.push(update); old._stats.compendiumSource = update['_stats.compendiumSource'];
  } };
  const source = { ...buildAntagonizeSpellItem(), uuid: ANTAGONIZE_UUID }, update = { system: { activities: { [id]: cast } } };
  await assert.rejects(prepareAntagonizeCastMigration(actor, mantle, update, async () => null));
  assert.equal(writes.length, 0);
  for (let i = 0; i < 2; i++) await prepareAntagonizeCastMigration(actor, mantle, update, async () => source);
  assert.deepEqual(writes, [{ _id: 'cached', '_stats.compendiumSource': ANTAGONIZE_UUID }]);
  assert.equal(old.system.description.value, 'Авторский текст');
  assert.equal(separate._stats.compendiumSource, legacy);
  assert.equal(cast.uses.spent, 1);
});

function encounter() {
  const calls = [], flags = {}, cardUuid = 'ChatMessage.abcdefgh12345678';
  const caster = { id: 'caster', testUserPermission: user => user.id === 'player' };
  const card = { uuid: cardUuid, author: { id: 'player' }, timestamp: Date.now(),
    getAssociatedItem: () => ({ ...buildAntagonizeSpellItem(), actor: caster, uuid: 'Actor.caster.Item.spell' }),
    getFlag: (_, key) => flags[key], async setFlag(_, key, value) { flags[key] = value; } };
  const token = (id, actor = {}) => ({ id, name: id, visible: true, actor, document: { id, uuid: 'Scene.scene.Token.'+id, parent: { id:'scene' } } });
  const attacker = token('failed', { id: 'npc', items: [], async createEmbeddedDocuments(_, [effect]) { calls.push(effect); } });
  const source = token('caster', caster), victim = token('victim');
  const weapon = { id: 'weapon', name: 'Копьё', type: 'weapon', system: { equipped: true, range: { reach: 10 }, activities: [] } };
  const activity = { id: 'attack', type: 'attack', name: 'Удар', item: weapon, attack: { type: { value: 'melee' } } };
  weapon.system.activities = [activity]; attacker.actor.items = [weapon];
  const workflow = { itemCardUuid: cardUuid, item: card.getAssociatedItem(), token: source, failedSaves: new Set([attacker]) };
  globalThis.canvas = { scene: { id:'scene' }, tokens: { placeables:[source, attacker, victim] } };
  globalThis.game = { user: { id: 'player' }, release: {generation: 14}, messages: { get: () => card } };
  globalThis.MidiQOL = {
    Workflow: { getWorkflow: () => workflow }, hasUsedReaction: () => false, checkIncapacitated: () => false,
    canSee: (_source, target) => target === victim, getDistance: () => 10,
    completeActivityUse: async (a, usage) => {calls.push([a.id, usage.midiOptions.targetUuids]); return {};},
    setReactionUsed: async () => calls.push('reaction')
  };
  let def, payload;
  const gateway = { registerCommand(_, value) { def = value; }, async mutate(_, data) { payload = data; } };
  globalThis.game.rebreyaMain = { privilegedMutationGateway: gateway };
  registerAntagonizeCommand(gateway);
  return { calls, workflow, def, attacker, victim, getPayload: () => payload };
}

test('a failed save requests only the selected attack, verifies owner and target, and spends one reaction once', async () => {
  const e=encounter(), sender={id:'player'};
  await antagonize.midi.item[0].macro({ workflow:e.workflow });
  const payload=e.getPayload();
  assert.ok(e.def.validate(payload));
  assert.equal(await e.def.authorize(payload,{sender:{id:'intruder'}}),false);
  assert.equal(await e.def.authorize(payload,{sender}),true);
  assert.equal(e.def.validate({...payload, effect: 'arbitrary'}),false);
  assert.equal(await e.def.authorize({...payload,failedUuid:e.victim.document.uuid},{sender}),false);
  await assert.rejects(e.def.execute({...payload,choice:'weapon.attack.outside'},{sender,assertActiveGm(){}}),/недоступна/u);
  assert.deepEqual(e.calls,[]);
  await e.def.execute(payload,{sender,assertActiveGm(){}});
  await e.def.execute(payload,{sender,assertActiveGm(){}});
  assert.deepEqual(e.calls,[['attack',[e.victim.document.uuid]],'reaction']);
});

test('spent reaction gives limited disadvantage and a successful save causes no secondary effect', async () => {
  const e=encounter(), sender={id:'player'};
  globalThis.MidiQOL.hasUsedReaction=()=>true;
  await antagonize.midi.item[0].macro({workflow:e.workflow});
  const payload=e.getPayload();
  await e.def.execute(payload,{sender,assertActiveGm(){}});
  assert.deepEqual(e.calls[0].system.changes,[{key:'flags.midi-qol.disadvantage.attack.all',type:'custom',value:1,priority:20}]);
  assert.deepEqual(e.calls[0].flags.dae.specialDuration.sort(),['1Attack','turnStartSource']);
  e.workflow.failedSaves.clear();
  assert.equal(await e.def.authorize(payload,{sender}),false);
});

test('no visible creature in reach gives disadvantage and never rolls a weapon', async () => {
  const e=encounter(), sender={id:'player'};
  globalThis.MidiQOL.getDistance=()=>15;
  await antagonize.midi.item[0].macro({workflow:e.workflow});
  const payload=e.getPayload();
  assert.equal(payload.choice,'');
  await e.def.execute(payload,{sender,assertActiveGm(){}});
  assert.equal(e.calls.length,1);
  assert.deepEqual(e.calls[0].duration,{value:12,units:'seconds'});
});

test('an interrupted secondary attack is never restarted or charged twice for one cast and target',async()=>{
 const e=encounter(), sender={id:'player'};
 await antagonize.midi.item[0].macro({workflow:e.workflow});
 const payload=e.getPayload(), context={sender,assertActiveGm(){}};
 let attempted=0;
 globalThis.MidiQOL.completeActivityUse=async()=>{attempted++;return undefined;};
 assert.equal((await e.def.execute(payload,context)).status,'uncertain');
 assert.equal((await e.def.execute(payload,context)).status,'uncertain');
 assert.equal(attempted,1);
 assert.deepEqual(e.calls,[]);
});

test('an attack that charged the native reaction itself does not receive a second charge',async()=>{
 const e=encounter(),sender={id:'player'};
 e.attacker.actor.flags={'midi-qol':{actions:{reactionsUsed:0,reactionsMax:2}}};
 await antagonize.midi.item[0].macro({workflow:e.workflow});
 globalThis.MidiQOL.completeActivityUse=async()=>{e.attacker.actor.flags['midi-qol'].actions.reactionsUsed++;return {};};
 await e.def.execute(e.getPayload(),{sender,assertActiveGm(){}});
 assert.equal(e.attacker.actor.flags['midi-qol'].actions.reactionsUsed,1);
 assert.deepEqual(e.calls,[]);
});
