import test from "node:test";
import assert from "node:assert/strict";
import { HeroDollService } from "../scripts/data/hero-doll-service.js";
import { makeInstanceDocumentsFixture } from "./helpers/item-instance-documents-fixture.mjs";

function setup(options={}) {
  const fx=makeInstanceDocumentsFixture({quantity:2,...options});
  fx.group.flags["rebreya-main"].managedPartyGroup=true;
  fx.group.items.contents=[];fx.hero.items.contents.push(fx.source);fx.source.parent=fx.hero;
  fx.service=new HeroDollService(fx.api);
  fx.payload={actorUuid:fx.hero.uuid,sourceItemUuid:fx.source.uuid,slotId:"neck",operationId:"equip-1"};
  fx.run=(payload=fx.payload,sender=game.user)=>fx.service.executeAssignItemToSlot(payload,{sender});
  return fx;
}

test("hero equips one real unit and replay does not create another",async t=>{
  const fx=setup();t.after(()=>fx.restore());
  const result=await fx.run();assert.notEqual(result.itemId,fx.source.id);
  assert.equal(fx.source.system.quantity,1);assert.equal(fx.source.system.equipped,false);
  assert.equal(fx.hero.items.get(result.itemId).system.quantity,1);
  assert.equal(fx.hero.items.get(result.itemId).system.equipped,true);
  assert.equal(fx.hero.getFlag("rebreya-main","heroDoll").slots.neck.itemId,result.itemId);
  assert.equal((await fx.run()).itemId,result.itemId);assert.equal(fx.total(),2);
});
test("hero moves an equipped singleton between slots preserving ID and removes old slot",async t=>{
  const fx=setup({quantity:1,itemFlags:{heroDollSlots:["ring1","ring2"]}});t.after(()=>fx.restore());
  const first=await fx.run({...fx.payload,slotId:"ring1"});
  const second=await fx.run({...fx.payload,slotId:"ring2",operationId:"equip-2"});
  assert.equal(first.itemId,second.itemId);assert.equal(first.itemId,fx.source.id);
  assert.deepEqual(fx.hero.getFlag("rebreya-main","heroDoll").slots,{ring2:{itemId:fx.source.id}});
  assert.equal(fx.calls.filter(([phase])=>phase==="create").length,0);
});
test("invalid slot, ownership and complex stack fail before writes",async t=>{
  const fx=setup();t.after(()=>fx.restore());
  await assert.rejects(fx.run({...fx.payload,slotId:"leftHand"}));
  await assert.rejects(fx.run(fx.payload,{id:"stranger",isGM:false}));
  fx.source.data.flags["rebreya-main"].itemUpgrades={installed:[{id:"upgrade"}]};
  await assert.rejects(fx.run(),e=>e.code==="complex-stack");
  assert.deepEqual(fx.calls,[]);assert.equal(fx.total(),2);
});
for(const phase of ["create","debit","equip","placement"]) for(const timing of ["before","after"]) {
  test(`hero ${timing} ${phase} failure preserves physical units and slot state`,async t=>{
    const fx=setup();t.after(()=>fx.restore());fx.failAt(phase,timing);
    await assert.rejects(fx.run());
    assert.equal(fx.total(),2);assert.equal(fx.source.system.quantity,2);
    assert.equal(fx.source.system.equipped,false);assert.equal(fx.hero.getFlag("rebreya-main","heroDoll"),undefined);
  });
}


test("legacy normalization keeps equipped original ID and unequipped remainder; clear never merges",async t=>{
  const fx=setup({quantity:3,itemSystem:{equipped:true}});t.after(()=>fx.restore());
  fx.hero.flags["rebreya-main"].heroDoll={version:1,slots:{neck:{itemId:fx.source.id}}};
  const before=fx.source.toObject();fx.service.getActorSnapshot(fx.hero);assert.deepEqual(fx.source.toObject(),before);
  const result=await fx.service.executeAssignItemToSlot(fx.payload,{sender:game.user},"normalize");
  assert.equal(fx.source.system.quantity,1);assert.equal(fx.source.system.equipped,true);
  assert.equal(fx.hero.items.get(result.itemId).system.quantity,2);assert.equal(fx.hero.items.get(result.itemId).system.equipped,false);
  assert.equal(fx.hero.getFlag("rebreya-main","heroDoll").slots.neck.itemId,fx.source.id);
  assert.equal((await fx.service.executeAssignItemToSlot(fx.payload,{sender:game.user},"normalize")).itemId,result.itemId);
  await fx.service.executeAssignItemToSlot({...fx.payload,operationId:"clear-1"},{sender:game.user},"clear");
  assert.equal(fx.source.system.equipped,false);assert.equal(fx.hero.items.contents.length,2);assert.equal(fx.total(),3);
  assert.deepEqual(fx.hero.getFlag("rebreya-main","heroDoll").slots,{});
});

test("two-hand item uses one document and clearing either slot releases both hands",async t=>{
  const fx=setup({quantity:1,itemFlags:{heroDollSlots:["leftHand","rightHand"],handRequirement:2}});t.after(()=>fx.restore());
  fx.source.data.type="weapon";const payload={...fx.payload,slotId:"leftHand"};
  await fx.run(payload);
  assert.deepEqual(fx.source.getFlag("rebreya-main","heldHands"),["left","right"]);
  assert.deepEqual(fx.hero.getFlag("rebreya-main","heroDoll").slots,{leftHand:{itemId:fx.source.id},rightHand:{itemId:fx.source.id}});
  await fx.service.executeAssignItemToSlot({...payload,operationId:"clear-2"},{sender:game.user},"clear");
  assert.equal(fx.source.getFlag("rebreya-main","heldHands"),undefined);assert.equal(fx.total(),1);
});

test("group stack validates slot before transfer and creates only one hero unit",async t=>{
  const fx=makeInstanceDocumentsFixture({quantity:2});t.after(()=>fx.restore());
  fx.group.flags["rebreya-main"].managedPartyGroup=true;const service=new HeroDollService(fx.api);
  const payload={actorUuid:fx.hero.uuid,sourceItemUuid:fx.source.uuid,slotId:"neck",operationId:"group-1"};
  await assert.rejects(service.executeAssignItemToSlot({...payload,slotId:"leftHand"},{sender:game.user}));
  assert.equal(fx.calls.length,0);
  const result=await service.executeAssignItemToSlot(payload,{sender:game.user});
  assert.equal(fx.group.items.get(fx.source.id).system.quantity,1);assert.equal(fx.hero.items.get(result.itemId).system.quantity,1);
  assert.equal(fx.total(),2);
});

test("replacing a slot releases the previous instance and failure restores it",async t=>{
  const fx=setup();t.after(()=>fx.restore());
  const first=await fx.run();
  fx.failAt("placement","after");
  await assert.rejects(fx.run({...fx.payload,operationId:"replace-fault"}));
  assert.equal(fx.hero.getFlag("rebreya-main","heroDoll").slots.neck.itemId,first.itemId);
  assert.equal(fx.hero.items.get(first.itemId).system.equipped,true);assert.equal(fx.source.system.equipped,false);
  await fx.run({...fx.payload,operationId:"replace-ok"});
  assert.equal(fx.hero.items.get(first.itemId).system.equipped,false);assert.equal(fx.source.system.equipped,true);assert.equal(fx.total(),2);
});


test("whole upgraded group item delegates to existing transfer owner and survives deleted-source replay",async t=>{
  const fx=makeInstanceDocumentsFixture({quantity:1,itemFlags:{itemUpgrades:{installed:[{itemId:"up",slotIndex:0}]}}});t.after(()=>fx.restore());
  fx.group.flags["rebreya-main"].managedPartyGroup=true;
  await fx.group.createEmbeddedDocuments("Item",[{_id:"up",name:"Upgrade",type:"loot",system:{quantity:1,container:fx.source.id},flags:{"rebreya-main":{installedUpgrade:{hostItemId:fx.source.id,slotIndex:0}}}}]);
  const service=new HeroDollService(fx.api);
  const payload={actorUuid:fx.hero.uuid,sourceItemUuid:fx.source.uuid,slotId:"neck",operationId:"whole-1"};
  const result=await service.executeAssignItemToSlot(payload,{sender:game.user});
  assert.equal(fx.group.items.contents.length,0);assert.equal(fx.hero.items.get(result.itemId).system.quantity,1);
  assert.equal((await service.executeAssignItemToSlot(payload,{sender:game.user})).itemId,result.itemId);
  assert.equal(fx.hero.items.get(result.itemId).system.equipped,true);
  assert.equal(fx.hero.items.get(result.itemId).flags["rebreya-main"].itemUpgrades.installed[0].itemId,fx.hero.items.contents.find(i=>i.name==="Upgrade").id);
  assert.equal(fx.total(),2);
});
