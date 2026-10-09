import test from 'node:test';
import assert from 'node:assert/strict';
import { HeroDollService } from '../scripts/data/hero-doll-service.js';
import { itemInstanceFingerprint } from '../scripts/application/item-instance-workflow.js';
import { makeInstanceDocumentsFixture } from './helpers/item-instance-documents-fixture.mjs';

function setup(t,options={}) {
  const fx=makeInstanceDocumentsFixture({quantity:1,...options});t.after(()=>fx.restore());
  fx.group.items.contents=[];fx.hero.items.contents.push(fx.source);fx.source.parent=fx.hero;
  fx.source.data.img='amulet.webp';fx.source.system.equipped=true;
  fx.hero.flags['rebreya-main'].heroDoll={version:1,slots:{neck:{itemId:fx.source.id}}};
  fx.service=new HeroDollService(fx.api);let sequence=0;
  fx.payload=(action,fields={})=>({actorUuid:fx.hero.uuid,operationId:`preset-op-${++sequence}`,action,...fields});
  fx.run=(action,fields={},sender=game.user)=>fx.service.executePresetMutation(fx.payload(action,fields),{sender});
  fx.create=(name='Бой',presetId='battle')=>fx.run('create',{name,presetId});
  fx.apply=(presetId='battle',fields={})=>fx.run('apply',{presetId,expectedFingerprint:itemInstanceFingerprint(fx.hero.getFlag('rebreya-main','heroDollPresets').presets.find(p=>p.id===presetId)),...fields});
  fx.state=()=>fx.hero.getFlag('rebreya-main','heroDollPresets');
  return fx;
}

test('NPC presets apply missing equipment as a removable ghost',async t=>{
  const fx=setup(t);fx.hero.type='npc';await fx.create();fx.hero.items.contents=[];
  await fx.apply();assert.equal(fx.service.getActorSnapshot(fx.hero).slots.find(s=>s.id==='neck').ghost,true);
  await fx.run('clear-ghost',{slotId:'neck'});assert.deepEqual(fx.state().ghosts,{});
  assert.equal(fx.state().presets[0].slots.neck.itemId,'rope');
});
test('NPC presets reject unauthorized users and unsupported Actor types',async t=>{
  const fx=setup(t);fx.hero.type='npc';
  await assert.rejects(fx.run('create',{name:'Бой',presetId:'battle'},{id:'stranger',isGM:false}),/прав|доступ|персонаж/iu);
  assert.equal(fx.state(),undefined);fx.hero.type='vehicle';
  await assert.rejects(fx.create(),/прав|доступ|персонаж/iu);
});
test('save captures concrete IDs with name/image, independent Actor state and no writes on snapshot',async t=>{
  const fx=setup(t);await fx.create();const count=fx.calls.length;
  assert.deepEqual(fx.state().presets[0].slots,{neck:{itemId:'rope',name:'Амулет',img:'amulet.webp'}});
  assert.equal(fx.group.getFlag('rebreya-main','heroDollPresets'),undefined);
  const snap=fx.service.getActorSnapshot(fx.hero);assert.equal(snap.activePresetId,'battle');assert.equal(snap.presetModified,false);
  assert.equal(fx.calls.length,count);
});
test('missing preset item becomes a mechanically empty ghost without substituting a same-name Item',async t=>{
  const fx=setup(t);await fx.create();fx.hero.items.contents=[];
  await fx.hero.createEmbeddedDocuments('Item',[{_id:'lookalike',name:'Амулет',img:'copy.webp',type:'equipment',system:{quantity:1,equipped:false},flags:{'rebreya-main':{heroDollSlots:['neck']}}}]);
  await fx.apply();const count=fx.calls.length,snap=fx.service.getActorSnapshot(fx.hero),slot=snap.slots.find(s=>s.id==='neck');
  assert.equal(slot.ghost,true);assert.equal(slot.occupied,false);assert.equal(slot.itemId,'');assert.equal(slot.itemUuid,'');
  assert.equal(slot.itemImg,'amulet.webp');assert.match(slot.title,/Амулет.*предмет отсутствует/u);
  assert.equal(snap.reservedCount,0);assert.equal(snap.availableCount,1);assert.equal(fx.hero.items.get('lookalike').system.equipped,false);
  assert.deepEqual(fx.hero.getFlag('rebreya-main','heroDoll').slots,{});assert.equal(fx.calls.length,count);assert.equal(snap.presetModified,false);
});
test('removing ghost changes current doll only; reapply restores it until explicit save',async t=>{
  const fx=setup(t);await fx.create();fx.hero.items.contents=[];await fx.apply();
  await fx.run('clear-ghost',{slotId:'neck'});assert.deepEqual(fx.state().ghosts,{});
  assert.equal(fx.service.getActorSnapshot(fx.hero).presetModified,true);assert.equal(fx.state().presets[0].slots.neck.itemId,'rope');
  await fx.apply();assert.equal(fx.state().ghosts.neck.itemId,'rope');
  await fx.run('clear-ghost',{slotId:'neck'});await fx.run('save',{presetId:'battle'});await fx.apply();
  assert.deepEqual(fx.state().presets[0].slots,{});assert.deepEqual(fx.state().ghosts,{});
});
test('saving a remaining ghost retains its reference and metadata; return does not auto-equip',async t=>{
  const fx=setup(t);await fx.create();fx.hero.items.contents=[];await fx.apply();await fx.run('save',{presetId:'battle'});
  assert.equal(fx.state().presets[0].slots.neck.img,'amulet.webp');
  fx.source.system.equipped=false;fx.hero.items.contents.push(fx.source);
  assert.equal(fx.service.getActorSnapshot(fx.hero).slots.find(s=>s.id==='neck').ghost,true);assert.equal(fx.source.system.equipped,false);
  await fx.apply();assert.equal(fx.source.system.equipped,true);assert.deepEqual(fx.state().ghosts,{});
});
test('full set clears old slots, preserves real grip and independent equipped items',async t=>{
  const fx=setup(t,{itemFlags:{heldHands:['right']}});await fx.create();
  await fx.hero.createEmbeddedDocuments('Item',[{_id:'unrelated',name:'Одежда',type:'equipment',system:{quantity:1,equipped:true},flags:{'rebreya-main':{}}}]);
  fx.hero.flags['rebreya-main'].heroDoll.slots={};await fx.create('Пусто','empty');
  await fx.apply();await fx.apply('empty');
  assert.deepEqual(fx.hero.getFlag('rebreya-main','heroDoll').slots,{});assert.equal(fx.source.system.equipped,true);
  assert.deepEqual(fx.source.getFlag('rebreya-main','heldHands'),['right']);assert.equal(fx.hero.items.get('unrelated').system.equipped,true);
});
test('empty set releases formerly doll-equipped Item while keeping saved set immutable',async t=>{
  const fx=setup(t);await fx.create();fx.hero.flags['rebreya-main'].heroDoll.slots={};await fx.create('Пусто','empty');
  await fx.apply();await fx.apply('empty');assert.equal(fx.source.system.equipped,false);assert.equal(fx.state().presets[0].slots.neck.itemId,'rope');
});

test('switching swapped singleton slots preserves identities, quantity and authored Item state',async t=>{
  const fx=setup(t,{itemFlags:{heroDollSlots:['neck','head']}});
  await fx.hero.createEmbeddedDocuments('Item',[{_id:'second',name:'Второй',type:'equipment',system:{quantity:1,equipped:true,uses:{max:'@prof + 2',spent:1}},flags:{'rebreya-main':{heroDollSlots:['neck','head']}}}]);
  fx.hero.flags['rebreya-main'].heroDoll.slots.head={itemId:'second'};await fx.create();
  fx.hero.flags['rebreya-main'].heroDoll.slots={head:{itemId:'rope'},neck:{itemId:'second'}};
  const second=fx.hero.items.get('second').toObject();const creates=fx.calls.filter(([phase])=>phase==='create').length;
  await fx.apply();assert.deepEqual(fx.hero.getFlag('rebreya-main','heroDoll').slots,{neck:{itemId:'rope'},head:{itemId:'second'}});
  assert.deepEqual(fx.hero.items.get('second').toObject(),second);assert.equal(fx.total(),2);
  assert.equal(fx.calls.filter(([phase])=>phase==='create').length,creates);
});
test('choosing another named set in a second view does not apply it or overwrite active layout',async t=>{
  const fx=setup(t);await fx.create();await fx.create('Поход','travel');await fx.apply();
  const before=structuredClone(fx.hero.flags),count=fx.calls.length;fx.service.selectPreset(fx.hero,'travel');
  const snapshot=fx.service.getActorSnapshot(fx.hero);assert.equal(snapshot.selectedPresetId,'travel');assert.equal(snapshot.activePresetId,'battle');
  assert.deepEqual(fx.hero.flags,before);assert.equal(fx.calls.length,count);
});
test('CRUD validates names and permissions; deleting applied preset retains current doll and ghosts',async t=>{
  const fx=setup(t);await fx.create(' Бой ');assert.equal(fx.state().presets[0].name,'Бой');
  await assert.rejects(fx.create('Бой','other'),e=>e.code==='duplicate-name');
  await assert.rejects(fx.create('   ','other'),e=>e.code==='invalid-payload');
  const count=fx.calls.length;await assert.rejects(fx.run('rename',{presetId:'battle',name:'Поход'},{id:'stranger',isGM:false}),e=>e.code==='unauthorized');assert.equal(fx.calls.length,count);
  await fx.run('rename',{presetId:'battle',name:'Поход'});assert.equal(fx.state().presets[0].name,'Поход');
  fx.hero.items.contents=[];await fx.apply();await fx.run('delete',{presetId:'battle'});
  assert.deepEqual(fx.state().presets,[]);assert.equal(fx.state().activePresetId,'');assert.equal(fx.state().ghosts.neck.itemId,'rope');
});
test('terminal save retry does not recapture changed doll and mismatched retry conflicts',async t=>{
  const fx=setup(t),payload=fx.payload('create',{name:'Бой',presetId:'battle'});
  await fx.service.executePresetMutation(payload,{sender:game.user});fx.hero.flags['rebreya-main'].heroDoll.slots={};
  const count=fx.calls.length;assert.equal((await fx.service.executePresetMutation(payload,{sender:game.user})).replayed,true);
  assert.equal(fx.calls.length,count);assert.equal(fx.state().presets[0].slots.neck.itemId,'rope');
  await assert.rejects(fx.service.executePresetMutation({...payload,name:'Другое'},{sender:game.user}),e=>e.code==='operation-conflict');
});
test('stale preset, existing incompatible Item and duplicate instance references fail before writes',async t=>{
  const fx=setup(t);await fx.create();const oldFingerprint=itemInstanceFingerprint(fx.state().presets[0]);
  await fx.run('rename',{presetId:'battle',name:'Другой'});let count=fx.calls.length;
  await assert.rejects(fx.apply('battle',{expectedFingerprint:oldFingerprint}),e=>e.code==='stale-preset');assert.equal(fx.calls.length,count);
  fx.source.flags['rebreya-main'].heroDollSlots=['head'];await assert.rejects(fx.apply(),e=>e.code==='invalid-slot');assert.equal(fx.calls.length,count);
  fx.source.flags['rebreya-main'].heroDollSlots=['neck','head'];fx.state().presets[0].slots.head={...fx.state().presets[0].slots.neck};
  await assert.rejects(fx.apply(),e=>e.code==='duplicate-instance');assert.equal(fx.calls.length,count);
});
test('legacy stack apply keeps original equipped ID and creates only one unequipped remainder across retries',async t=>{
  const fx=setup(t,{quantity:3});await fx.create();await fx.apply();
  assert.equal(fx.source.system.quantity,1);assert.equal(fx.source.system.equipped,true);
  const remainder=fx.hero.items.contents.find(i=>i.id!=='rope');assert.equal(remainder.system.quantity,2);assert.equal(remainder.system.equipped,false);
  assert.equal(fx.hero.getFlag('rebreya-main','heroDoll').slots.neck.itemId,'rope');assert.equal(fx.state().presets[0].slots.neck.itemId,'rope');
  await fx.apply();assert.equal(fx.hero.items.contents.length,2);assert.equal(fx.total(),3);
});
test('complex legacy stack is rejected without modifying formulas, quantity, held state or upgrades',async t=>{
  const fx=setup(t,{quantity:3,itemSystem:{uses:{max:'@prof + 2',spent:0}},itemFlags:{itemUpgrades:{installed:[{id:'upgrade'}]},heldHands:['right']}});
  await fx.create();const before=fx.source.toObject(),count=fx.calls.length;
  await assert.rejects(fx.apply(),e=>e.code==='complex-stack');assert.deepEqual(fx.source.toObject(),before);assert.equal(fx.calls.length,count);
});
for(const phase of ['create','debit','equip','placement'])for(const timing of ['before','after'])test(`preset ${timing} ${phase} fault restores legacy stack and active layout`,async t=>{
  const fx=setup(t,{quantity:3});await fx.create();fx.source.system.equipped=false;fx.hero.flags['rebreya-main'].heroDoll.slots={};
  const before=structuredClone(fx.hero.flags);fx.failAt(phase,timing);
  await assert.rejects(fx.apply());assert.equal(fx.source.system.quantity,3);assert.equal(fx.source.system.equipped,false);
  assert.equal(fx.hero.items.contents.length,1);assert.equal(fx.total(),3);assert.deepEqual(fx.hero.flags,before);
});
test('assignment replaces current ghost only and failed assignment retains it',async t=>{
  const fx=setup(t);await fx.create();fx.hero.items.contents=[];await fx.apply();
  fx.source.data._id='replacement';fx.source.system.equipped=false;fx.hero.items.contents.push(fx.source);
  const payload={actorUuid:fx.hero.uuid,sourceItemUuid:fx.source.uuid,slotId:'neck',operationId:'assign-replacement'};
  fx.failAt('placement','after');await assert.rejects(fx.service.executeAssignItemToSlot(payload,{sender:game.user}));
  assert.equal(fx.state().ghosts.neck.itemId,'rope');
  await fx.service.executeAssignItemToSlot({...payload,operationId:'assign-ok'},{sender:game.user});assert.deepEqual(fx.state().ghosts,{});
  assert.equal(fx.state().presets[0].slots.neck.itemId,'rope');assert.equal(fx.service.getActorSnapshot(fx.hero).presetModified,true);
});

test('unknown saved slot is rejected, rather than silently clearing the doll',async t=>{
  const fx=setup(t);await fx.create();fx.state().presets[0].slots.nonexistent={itemId:'missing',name:'Missing',img:'x.webp'};
  const count=fx.calls.length;await assert.rejects(fx.apply(),e=>e.code==='invalid-preset');assert.equal(fx.calls.length,count);
});
test('ambiguous client request reuses exact intent and prevents a different preset mutation',async t=>{
  const fx=setup(t);await fx.create();const requests=[];
  fx.api.mutateHeroDollPreset=async payload=>{requests.push(structuredClone(payload));throw Object.assign(Error('timeout'),{code:'request-timeout'});};
  await assert.rejects(fx.service.applyPreset(fx.hero,'battle'));
  await assert.rejects(fx.service.renamePreset(fx.hero,'battle','Other'),e=>e.code==='pending-instance-operation');
  await assert.rejects(fx.service.applyPreset(fx.hero,'battle'));
  assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
});
test('ordinary legacy stack resumes on replacement GM with one remainder and durable original ID',async t=>{
  const fx=setup(t,{quantity:3});await fx.create();fx.source.system.equipped=false;fx.hero.flags['rebreya-main'].heroDoll.slots={};
  const payload=fx.payload('apply',{presetId:'battle',expectedFingerprint:itemInstanceFingerprint(fx.state().presets[0])});
  const gm=game.user;fx.failAt('debit','after',()=>{game.user={id:'newgm',isGM:true,active:true};game.users.activeGM=game.user;});
  await assert.rejects(fx.service.executePresetMutation(payload,{sender:gm}),e=>e.code==='active-gm-changed');
  fx.service=new HeroDollService(fx.api);await fx.service.executePresetMutation(payload,{sender:gm});
  assert.equal(fx.hero.items.contents.length,2);assert.equal(fx.source.system.quantity,1);assert.equal(fx.source.system.equipped,true);
  assert.equal(fx.total(),3);assert.equal(fx.hero.getFlag('rebreya-main','heroDoll').slots.neck.itemId,'rope');
});

for(const method of ['start','finish'])for(const timing of ['before','after'])test(`public apply retries original intent after journal ${method} ${timing} persistence failure`,async t=>{
  const fx=setup(t,{quantity:3});await fx.create();fx.source.system.equipped=false;fx.hero.flags['rebreya-main'].heroDoll.slots={};
  const journal=fx.api.inventoryService.mutationJournal,original=journal[method].bind(journal);let failed=false;
  journal[method]=async(...args)=>{
    if(!failed && timing==='before'){failed=true;throw Object.assign(Error('temporary storage failure'),{code:'EIO'});}
    const result=await original(...args);if(!failed){failed=true;throw Error('response lost after persistence');}return result;
  };
  const requests=[];fx.api.mutateHeroDollPreset=payload=>{requests.push(structuredClone(payload));return fx.service.executePresetMutation(payload,{sender:game.user});};
  await assert.rejects(fx.service.applyPreset(fx.hero,'battle'),e=>e.code==='ambiguous-outcome');
  assert.equal(fx.service.pendingPresets.size,1);
  await fx.service.applyPreset(fx.hero,'battle');assert.deepEqual(requests[0],requests[1]);assert.equal(fx.service.pendingPresets.size,0);
  assert.equal(fx.hero.items.contents.length,2);assert.equal(fx.source.system.quantity,1);assert.equal(fx.total(),3);
});
