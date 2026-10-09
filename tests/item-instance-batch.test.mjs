import test from 'node:test';
import assert from 'node:assert/strict';
import { ItemInstanceWorkflow, itemInstanceFingerprint } from '../scripts/application/item-instance-workflow.js';
import { ItemInstanceDocuments } from '../scripts/infrastructure/foundry/item-instance-documents.js';
import { makeInstanceDocumentsFixture } from './helpers/item-instance-documents-fixture.mjs';

function setup(t) {
  const fx=makeInstanceDocumentsFixture({quantity:1}); t.after(()=>fx.restore());
  fx.group.items.contents=[];fx.hero.items.contents.push(fx.source);fx.source.parent=fx.hero;
  const documents=new ItemInstanceDocuments();
  const workflow=new ItemInstanceWorkflow({documents,coordinator:fx.api.worldMutationCoordinator,journal:fx.api.inventoryService.mutationJournal});
  const intent={operationId:'batch-1',mode:'hero-preset',sourceActorUuid:fx.hero.uuid,destinationActorUuid:fx.hero.uuid};
  const context={sender:game.user,assertAuthority:()=>{},authorize:()=>{},prepareBatch:async()=>({steps:[{
    intent,plan:{kind:'placement',preserveSourceId:true},placement:[
      {actor:'target',itemId:fx.source.id,before:{'system.equipped':false},after:{'system.equipped':true}},
      {actor:'target',before:{'flags.rebreya-main.heroDoll':null},after:{'flags.rebreya-main.heroDoll':{version:1,slots:{neck:{itemId:'rope'}}}}}
    ]}],value:{applied:true}})};
  fx.run=(request=intent)=>workflow.runBatch(request,context);
  return fx;
}

test('placement preserves a foreign Actor edit during the authority await',async t=>{
  const fx=setup(t);
  const documents=new ItemInstanceDocuments();
  const foreign={version:1,slots:{head:{itemId:'foreign'}}};
  const record={intent:{sourceActorUuid:fx.hero.uuid,destinationActorUuid:fx.hero.uuid},placement:[{
    actor:'target',before:{'flags.rebreya-main.heroDoll':null},after:{'flags.rebreya-main.heroDoll':{version:1,slots:{neck:{itemId:'rope'}}}}
  }]};
  await assert.rejects(documents.writePlacement(record,{assertAuthority:async()=>{fx.hero.flags['rebreya-main'].heroDoll=structuredClone(foreign);}}),e=>e.code==='manual-review');
  assert.deepEqual(fx.hero.getFlag('rebreya-main','heroDoll'),foreign);
});
test('resumed compensation conflict preserves the original durable failure',async t=>{
  const fx=setup(t),journal=fx.api.inventoryService.mutationJournal;
  const intent={operationId:'batch-1',mode:'hero-preset',sourceActorUuid:fx.hero.uuid,destinationActorUuid:fx.hero.uuid};
  const id=`item-instance:${JSON.stringify([game.user.id,intent.mode,intent.operationId])}`;
  const failure={code:'EIO',message:'original database error'};
  await journal.start({id,intent,fingerprint:itemInstanceFingerprint(intent),kind:'item-instance-v1',batch:true,phase:'compensating',failure,
    steps:[{intent,plan:{kind:'placement',preserveSourceId:true},placement:[{actor:'target',before:{'flags.rebreya-main.heroDoll':null},after:{'flags.rebreya-main.heroDoll':{slots:{neck:{itemId:'rope'}}}}}]}]});
  fx.hero.flags['rebreya-main'].heroDoll={slots:{head:{itemId:'foreign'}}};
  await assert.rejects(fx.run(),e=>e.code==='manual-review');
  const record=await journal.find(id);
  assert.deepEqual(record.failure,failure);assert.equal(record.compensationFailure.code,'manual-review');
  assert.deepEqual(fx.hero.getFlag('rebreya-main','heroDoll'),{slots:{head:{itemId:'foreign'}}});
});
test('batch applies real equipped fields and doll placement; terminal retry never writes again',async t=>{
  const fx=setup(t);await fx.run();const count=fx.calls.length;
  assert.equal(fx.source.system.equipped,true);
  assert.deepEqual(fx.hero.getFlag('rebreya-main','heroDoll').slots,{neck:{itemId:'rope'}});
  assert.equal((await fx.run()).replayed,true);assert.equal(fx.calls.length,count);
});
for(const phase of ['equip','placement'])for(const timing of ['before','after'])test(`batch ${timing} ${phase} error compensates all owned fields`,async t=>{
  const fx=setup(t);fx.failAt(phase,timing);
  await assert.rejects(fx.run(),e=>e.code==='instance-compensated');
  assert.equal(fx.source.system.equipped,false);assert.equal(fx.hero.getFlag('rebreya-main','heroDoll'),undefined);
  assert.equal(fx.total(),1);
});
test('batch foreign touched field edit enters manual review and blocks a new operation',async t=>{
  const fx=setup(t);fx.failAt('placement','after',()=>fx.hero.flags['rebreya-main'].heroDoll={slots:{head:{itemId:'foreign'}}});
  await assert.rejects(fx.run(),e=>e.code==='manual-review');
  assert.deepEqual(fx.hero.flags['rebreya-main'].heroDoll,{slots:{head:{itemId:'foreign'}}});
  await assert.rejects(fx.run({operationId:'batch-2',mode:'hero-preset',sourceActorUuid:fx.hero.uuid,destinationActorUuid:fx.hero.uuid}),e=>e.code==='pending-instance-operation');
});
test('batch finish persistence failure retries committed receipts without compensating',async t=>{
  const fx=setup(t),journal=fx.api.inventoryService.mutationJournal;
  const finish=journal.finish.bind(journal);let failed=false;
  journal.finish=async(...args)=>{if(!failed){failed=true;throw Error('journal temporarily unavailable');}return finish(...args);};
  await assert.rejects(fx.run(),e=>e.code==='ambiguous-outcome');
  assert.equal(fx.source.system.equipped,true);const count=fx.calls.length;
  assert.equal((await fx.run()).applied,true);assert.equal(fx.calls.length,count);
});

test('batch checkpoint response loss after persistence compensates using current durable phase',async t=>{
  const fx=setup(t),journal=fx.api.inventoryService.mutationJournal;
  const checkpoint=journal.checkpoint.bind(journal);let failed=false;
  journal.checkpoint=async(...args)=>{
    const result=await checkpoint(...args);
    if(!failed && args[2]==='placement-written'){failed=true;throw Error('checkpoint response lost');}
    return result;
  };
  await assert.rejects(fx.run(),e=>e.code==='instance-compensated');
  assert.equal(fx.source.system.equipped,false);assert.equal(fx.hero.getFlag('rebreya-main','heroDoll'),undefined);
});

test('batch rollback preserves a foreign edit made during an earlier restoration await',async t=>{
  const fx=setup(t);
  const update=fx.hero.update.bind(fx.hero);let fail=true;
  fx.hero.update=async patch=>{
    const result=await update(patch);
    if(Object.hasOwn(patch,'flags.rebreya-main.==heroDoll') && fail){fail=false;throw Error('after placement');}
    if(Object.hasOwn(patch,'flags.rebreya-main.-=heroDoll') && !fail)fx.source.system.equipped='foreign-value';
    return result;
  };
  await assert.rejects(fx.run(),e=>e.code==='manual-review');
  assert.equal(fx.source.system.equipped,'foreign-value');
});
