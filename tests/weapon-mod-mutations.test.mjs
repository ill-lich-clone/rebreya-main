import test from "node:test";
import assert from "node:assert/strict";
import {makeWeaponModMutationFixture} from "./helpers/weapon-mod-fixture.mjs";
const NS="rebreya-main";
test("install splits one owned component, keeps upgrades and replays durably after reload",async()=>{
  const fx=await makeWeaponModMutationFixture();try{
    const upgradeBefore=structuredClone(fx.host.getFlag(NS,"itemUpgrades"));
    const first=await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"install",mountId:"bottom-2"});
    assert.equal(fx.component.system.quantity,2);const child=fx.group.items.get(first.itemId);
    assert.notEqual(child.id,fx.component.id);assert.equal(child.system.quantity,1);assert.equal(child.system.container,fx.host.id);
    assert.deepEqual(child.getFlag(NS,"installedWeaponMod").mountIds,["bottom-2","barrel"]);
    assert.deepEqual(fx.host.getFlag(NS,"itemUpgrades"),upgradeBefore);
    const {ItemUpgradeService}=await import("../scripts/data/item-upgrade-service.js");
    const restarted=new ItemUpgradeService(fx.api,{getWeaponModCatalog:async()=>fx.catalog});
    const replay=await restarted.installWeaponAttachment(fx.host,fx.component,{operationId:"install",mountId:"bottom-2"});
    assert.equal(replay.itemId,first.itemId);assert.equal(replay.replayed,true);assert.equal(fx.cards.size,1);
    assert.equal([...fx.cards.values()][0].flags[NS].weaponModAction.activation.type,"bonus");
    await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"install",mountId:"bottom-1"}),e=>e.code==="operation-conflict");
    await fx.service.removeWeaponAttachment(fx.host,child.id,{operationId:"remove"});
    assert.equal(child.system.container,undefined);assert.equal(child.getFlag(NS,"installedWeaponMod"),undefined);
    assert.equal(fx.host.getFlag(NS,"weaponMods").attachments.length,0);assert.equal(fx.cards.size,2);
    assert.equal([...fx.cards.values()][1].flags[NS].weaponModAction.activation.type,"action");
  }finally{fx.restore();}
});
test("two writers serialize and duplicate, unavailable, foreign and stacked hosts refuse before mutation",async()=>{
  const fx=await makeWeaponModMutationFixture();try{
    const results=await Promise.allSettled(["a","b"].map(operationId=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId})));
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(fx.component.system.quantity,2);assert.equal(fx.cards.size,1);
    const projection=await fx.service.getWeaponModsProjection(fx.host);assert.equal(projection.attachments.length,1);assert.equal(projection.catalogue.length,25);
    fx.host.data.system.quantity=2;
    await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"stacked"}));
    fx.host.data.system.quantity=1;fx.group.ownership.player=0;
    await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"no-owner",sender:{id:"player",isGM:false}}));
    const foreign=new Item({...fx.component.toObject(),_id:"foreign"},fx.hero);
    await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,foreign,{operationId:"foreign"}));
    assert.equal(fx.component.system.quantity,2);assert.equal(fx.cards.size,1);
  }finally{fx.restore();}
});
test("authority loss never compensates and the next GM completes the same operation once",async()=>{
  const fx=await makeWeaponModMutationFixture();try{
    fx.failAt("debit","after",()=>{game.user.active=false;});
    await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"leader-loss"}));
    assert.equal(fx.component.system.quantity,2);assert.equal(fx.group.items.contents.length,3);assert.equal(fx.cards.size,0);
    game.user.active=true;
    await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"leader-loss"});
    assert.equal(fx.component.system.quantity,2);assert.equal(fx.cards.size,1);
  }finally{fx.restore();}
});
test("write-then-throw chat publication is confirmed and terminal retry never recreates a deleted child",async()=>{
  const fx=await makeWeaponModMutationFixture();try{
    fx.chatWriteThenThrow();const first=await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"chat"});
    assert.equal(fx.cards.size,1);await fx.group.items.get(first.itemId).delete();
    const replay=await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"chat"});
    assert.equal(replay.replayed,true);assert.equal(fx.group.items.contents.length,2);assert.equal(fx.cards.size,1);
  }finally{fx.restore();}
});
test("failed placement restores exact quantities and forged modernization receipts cannot install",async()=>{
  const fx=await makeWeaponModMutationFixture();try{
    fx.failAt("equip","before");await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"fault"}));
    assert.equal(fx.component.system.quantity,3);assert.equal(fx.group.items.contents.length,2);assert.equal(fx.host.getFlag(NS,"weaponMods"),undefined);assert.equal(fx.cards.size,0);
    await assert.rejects(()=>fx.service.applyWeaponModernization(fx.host,fx.component,{operationId:"forged",completionReceipt:{approved:true}}));
  }finally{fx.restore();}
});
for(const phase of ["create","debit","equip"])for(const timing of ["before","after"]){
  test(`weapon mod ${phase} failure ${timing} restores state and a new operation can succeed`,async()=>{
    const fx=await makeWeaponModMutationFixture();try{
      fx.failAt(phase,timing);await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"failed"}));
      assert.equal(fx.component.system.quantity,3);assert.equal(fx.group.items.contents.length,2);assert.equal(fx.cards.size,0);
      await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"new"});
      assert.equal(fx.component.system.quantity,2);assert.equal(fx.group.items.contents.length,3);assert.equal(fx.cards.size,1);
    }finally{fx.restore();}
  });
}
test("failed card publication retries without a second install, busy and custom components remain untouched",async()=>{
  const fx=await makeWeaponModMutationFixture();try{
    fx.api.craftingService={isWeaponRebuildBusy:()=>true};
    await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"busy"}));
    fx.api.craftingService=null;
    const attachment=fx.component.data.flags[NS].attachment;fx.component.data.flags[NS].attachment={...attachment,custom:true};
    await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"custom"}));
    fx.component.data.flags[NS].attachment=attachment;
    const create=ChatMessage.create;ChatMessage.create=async()=>{throw Error("chat unavailable");};
    await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"card-retry"}),/chat unavailable/);
    assert.equal(fx.component.system.quantity,2);assert.equal(fx.cards.size,0);
    ChatMessage.create=create;
    const replay=await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"card-retry"});
    assert.equal(replay.replayed,true);assert.equal(fx.component.system.quantity,2);assert.equal(fx.cards.size,1);
  }finally{fx.restore();}
});
