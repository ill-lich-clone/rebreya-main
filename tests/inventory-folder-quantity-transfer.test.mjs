import test from "node:test";
import assert from "node:assert/strict";
import { makeInstanceDocumentsFixture } from "./helpers/item-instance-documents-fixture.mjs";
const intent={groupActorId:"g",itemId:"rope",folderId:"bag",quantity:3,operationId:"split",expectedSourceQuantity:10};

test("folder split creates one exact target, preserves seven source units and replays",async()=>{
  const fx=makeInstanceDocumentsFixture();try{
    const result=await fx.api.inventoryService.moveInventoryItemToFolder(intent);
    assert.notEqual(result.itemId,"rope");assert.equal(fx.source.system.quantity,7);
    assert.equal(fx.group.items.get(result.itemId).system.quantity,3);
    assert.equal(fx.group.getFlag("rebreya-main","inventoryFolders").itemFolderIds[result.itemId],"bag");
    const replay=await fx.api.inventoryService.moveInventoryItemToFolder(intent);assert.equal(replay.replayed,true);assert.equal(fx.total(),10);
  }finally{fx.restore();}
});
test("whole folder movement and same-folder no-op do not create Documents",async()=>{
  const fx=makeInstanceDocumentsFixture();try{
    const same=await fx.api.inventoryService.moveInventoryItemToFolder({...intent,folderId:null});assert.equal(same.changed,false);
    const whole=await fx.api.inventoryService.moveInventoryItemToFolder({...intent,operationId:"whole",quantity:10});
    assert.equal(whole.itemId,"rope");assert.equal(fx.total(),10);assert.equal(fx.calls.filter(c=>c[0]==="create").length,0);
  }finally{fx.restore();}
});
for(const phase of ["create","debit","placement"]) for(const timing of ["before","after"])test(`real Document driver compensates ${timing} ${phase}`,async()=>{
  const fx=makeInstanceDocumentsFixture();try{
    fx.failAt(phase,timing);await assert.rejects(fx.api.inventoryService.moveInventoryItemToFolder(intent));
    assert.equal(fx.total(),10);assert.equal(fx.group.items.contents.length,1);assert.equal(fx.source.system.quantity,10);
  }finally{fx.restore();}
});
test("stale dialog maximum, missing destination and complex stacks write nothing",async()=>{
  const fx=makeInstanceDocumentsFixture({itemFlags:{itemUpgrades:{installed:[{itemId:"up"}]}}});try{
    for(const patch of [{expectedSourceQuantity:11},{folderId:"missing"},{}])await assert.rejects(fx.api.inventoryService.moveInventoryItemToFolder({...intent,...patch}));
    assert.equal(fx.calls.length,0);assert.equal(fx.total(),10);
  }finally{fx.restore();}
});


for(const itemSystem of [{attuned:true},{uses:{max:"@prof",spent:0}},{activities:{limited:{uses:{max:"1",spent:0}}}}]) {
  test(`individual attunement or limited activity uses cannot be split: ${JSON.stringify(itemSystem)}`,async t=>{
    const fx=makeInstanceDocumentsFixture({itemSystem});t.after(()=>fx.restore());
    await assert.rejects(fx.api.inventoryService.moveInventoryItemToFolder({groupActorId:"g",itemId:"rope",folderId:"bag",quantity:3,operationId:"limited"}),error=>error.code==="complex-stack");
    assert.equal(fx.total(),10);assert.equal(fx.calls.length,0);
  });
}
