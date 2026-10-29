import test from "node:test";
import assert from "node:assert/strict";
import {makeWeaponModMutationFixture, makeItem, gear} from "./helpers/weapon-mod-fixture.mjs";
const NS="rebreya-main";
test("extra mounts require current proficiency and remain removable after the feat is lost",async()=>{
 const fx=await makeWeaponModMutationFixture({quantity:1});try{
  fx.group.system.attributes={prof:3};
  const feat={id:"feat",type:"feat",system:{identifier:"master-ognestrelnogo-oruzhiya"}};fx.group.items.contents.push(feat);
  await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"extra-invalid",mountIds:["top","extra-4"]}));
  const result=await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"extra-valid",mountIds:["top","extra-3"]});
  const child=fx.group.items.get(result.itemId);assert.deepEqual(child.getFlag(NS,"installedWeaponMod").mountIds,["top","extra-3"]);
  fx.group.items.contents.splice(fx.group.items.contents.indexOf(feat),1);
  assert.equal((await fx.service.getWeaponModsProjection(fx.host)).attachments.length,1);
  await fx.service.removeWeaponAttachment(fx.host,child,{operationId:"extra-remove"});
  assert.equal(fx.host.getFlag(NS,"weaponMods").attachments.length,0);
 }finally{fx.restore();}
});
test("attachment request checks mastery on the actor under the lock and persists both chosen mounts",async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1});
  try{
    await assert.rejects(()=>fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"no-feat",mountIds:["top","side-1"]}));
    fx.group.items.contents.push({id:"feat",type:"feat",system:{identifier:"master-ognestrelnogo-oruzhiya"}});
    const result=await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"master",mountIds:["top","side-1"]});
    const link=fx.host.getFlag(NS,"weaponMods").attachments[0],child=fx.group.items.get(result.itemId);
    assert.deepEqual(link.mountIds,["top","side-1"]);assert.equal(link.freeMounts,true);
    assert.equal(child.getFlag(NS,"installedWeaponMod").freeMounts,true);
  }finally{fx.restore();}
});
test("native required nullable container is cleared with null, without dropping the entire attachment removal update",async()=>{
 const fx=await makeWeaponModMutationFixture({quantity:1});try{
  const result=await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"native-install",mountId:"bottom-1"}),child=fx.group.items.get(result.itemId),update=child.update.bind(child),quantity=child.system.quantity;
  let dropped=0;child.update=async patch=>{if(Object.hasOwn(patch,"system.-=container")){dropped++;return child;}return update(patch);};
  await fx.service.removeWeaponAttachment(fx.host,child,{operationId:"native-remove"});
  assert.equal(dropped,0);assert.equal(child.system.container,null);assert.equal(child.system.quantity,quantity);
  assert.equal(child.getFlag(NS,"installedWeaponMod"),undefined);assert.equal(fx.host.getFlag(NS,"weaponMods").attachments.length,0);
 }finally{fx.restore();}
});
test("install splits one owned component, keeps upgrades and replays durably after reload",async()=>{
  const fx=await makeWeaponModMutationFixture();try{
    const upgradeBefore=structuredClone(fx.host.getFlag(NS,"itemUpgrades"));
    const first=await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"install",mountId:"bottom-2"});
    const journal=await fx.api.inventoryService.mutationJournal.find(`item-instance:${JSON.stringify(["gm","weapon-mod-install","install"])}`);
    assert.equal(Object.hasOwn(journal.intent,"mountIds"),false);
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
    assert.equal(child.system.container,null);assert.equal(child.getFlag(NS,"installedWeaponMod"),undefined);
    assert.equal(fx.host.getFlag(NS,"weaponMods").attachments.length,0);assert.equal(fx.cards.size,2);
    assert.equal([...fx.cards.values()][1].flags[NS].weaponModAction.activation.type,"action");
  }finally{fx.restore();}
});

for(const modernized of [false,true])test(`authoritative ${modernized?"rebuild":"attachment"} rejects a component that became held before execution`,async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1});
  try{
    if(modernized)fx.component.data.flags=makeItem("oblegchyonnyy-korpus").flags;
    fx.component.data.type="equipment";fx.component.data.system.equipped=true;fx.component.data.flags["rebreya-main"].heldHands=["left"];
    const before=fx.component.toObject(),wallet=structuredClone(fx.group.system.currency),host=fx.host.toObject();
    await assert.rejects(modernized?fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"held"}):fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"held",mountId:"bottom-1"}),error=>error.code==="component-held");
    assert.deepEqual(fx.component.toObject(),before);assert.deepEqual(fx.host.toObject(),host);assert.deepEqual(fx.group.system.currency,wallet);
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
test("failed card publication retries without a second install and custom components remain untouched",async()=>{
  const fx=await makeWeaponModMutationFixture();try{
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

async function expandedWeaponFixture({inventoryAmmo=true}={}){
  const fx=await makeWeaponModMutationFixture({quantity:1});
  const {CombatAttackService}=await import("../scripts/combat/attack-service.js");
  fx.api.repository={model:{gear,gearById:new Map(gear.map(row=>[row.id,row]))}};
  fx.api.combatAttackService=new CombatAttackService(fx.api);
  Object.assign(fx.host.data.flags[NS],{lichWeaponPropertyValues:{reload:"Смена магазина 18",ammunition:"Винтовочный"},firearmAmmoState:{current:18,capacity:18,ammunition:"Винтовочный"}});
  for(const [i,sourceId] of ["rasshirennaya-oboyma","oblegchyonnyy-stvol","priklad"].entries()){
    const source=makeItem(sourceId),part=new Item({_id:`part-${i}`,name:source.name,type:"loot",system:{quantity:1,container:null},flags:source.flags},fx.group);
    fx.group.items.contents.push(part);await fx.service.applyWeaponModernization(fx.host,part,{operationId:`prepare-${i}`,completionReceipt:{projectId:`trusted-${i}`}});
  }
  fx.host.data.flags[NS].firearmAmmoState.current=27;
  const source=makeItem("oblegchyonnyy-korpus");Object.assign(fx.component.data,{name:source.name,flags:source.flags});
  if(inventoryAmmo){const ammo=new Item({_id:"ammo",name:"Винтовочный патрон",type:"consumable",system:{quantity:5,type:{value:"ammo",subtype:"rebreyaRifle"}},flags:{[NS]:{gearId:"vintovochnyy-patron-10"}}},fx.group);fx.group.items.contents.push(ammo);}
  return fx;
}
test("modernization shrinking magazine returns overflow exactly once in the same durable batch",async()=>{
  const fx=await expandedWeaponFixture();try{
    await fx.service.applyWeaponModernization(fx.host,fx.component,{operationId:"shrink",removeItemId:"part-0",completionReceipt:{projectId:"trusted"}});
    assert.equal(fx.host.getFlag(NS,"firearmAmmoState").current,18);assert.equal(fx.group.items.get("ammo").system.quantity,14);
    assert.equal(fx.group.items.get("part-0").getFlag(NS,"installedWeaponMod"),undefined);
    await fx.service.applyWeaponModernization(fx.host,fx.component,{operationId:"shrink",removeItemId:"part-0",completionReceipt:{projectId:"trusted"}});
    assert.equal(fx.group.items.get("ammo").system.quantity,14);
  }finally{fx.restore();}
});
test("ammo refund failure rolls back part links, ammo and overflow; a foreign stack edit blocks overwrite",async()=>{
  const fx=await expandedWeaponFixture();try{
    fx.failAt("debit","after");await assert.rejects(()=>fx.service.applyWeaponModernization(fx.host,fx.component,{operationId:"failed-shrink",removeItemId:"part-0",completionReceipt:{projectId:"trusted"}}));
    assert.equal(fx.host.getFlag(NS,"firearmAmmoState").current,27);assert.equal(fx.group.items.get("ammo").system.quantity,5);
    assert.equal(fx.host.getFlag(NS,"weaponMods").modernizedParts.some(p=>p.itemId==="part-0"),true);
    fx.failAt("debit","after",()=>fx.group.items.get("ammo").data.system.quantity=99);
    await assert.rejects(()=>fx.service.applyWeaponModernization(fx.host,fx.component,{operationId:"foreign-shrink",removeItemId:"part-0",completionReceipt:{projectId:"trusted"}}),e=>e.code==="manual-review");
    assert.equal(fx.group.items.get("ammo").system.quantity,99);
  }finally{fx.restore();}
});
test("ammo overflow creates a canonical single cartridge stack when all prior ammunition was loaded",async()=>{
  const previous=globalThis.CONST;globalThis.CONST={DOCUMENT_OWNERSHIP_LEVELS:{OBSERVER:2}};
  const fx=await expandedWeaponFixture({inventoryAmmo:false});try{
    fx.failAt("create","after");await assert.rejects(()=>fx.service.applyWeaponModernization(fx.host,fx.component,{operationId:"create-fault",removeItemId:"part-0",completionReceipt:{projectId:"trusted"}}));
    assert.equal(fx.group.items.contents.filter(i=>i.type==="consumable").length,0);
    await fx.service.applyWeaponModernization(fx.host,fx.component,{operationId:"create-refund",removeItemId:"part-0",completionReceipt:{projectId:"trusted"}});
    const ammo=fx.group.items.contents.filter(i=>i.type==="consumable");assert.equal(ammo.length,1);assert.equal(ammo[0].system.quantity,9);
    assert.equal(ammo[0].getFlag(NS,"gearId"),"vintovochnyy-patron-10");assert.equal(fx.host.getFlag(NS,"firearmAmmoState").current,18);
  }finally{fx.restore();globalThis.CONST=previous;}
});
test("ammo refund refuses a changed ammunition identity even when its quantity was untouched",async()=>{
  const fx=await expandedWeaponFixture();try{
    fx.failAt("debit","before",()=>fx.group.items.get("ammo").data.flags[NS].gearId="obolochennye-puli-10");
    await assert.rejects(()=>fx.service.applyWeaponModernization(fx.host,fx.component,{operationId:"identity-shrink",removeItemId:"part-0",completionReceipt:{projectId:"trusted"}}),e=>e.code==="manual-review");
    assert.equal(fx.group.items.get("ammo").getFlag(NS,"gearId"),"obolochennye-puli-10");
  }finally{fx.restore();}
});
test("ammo refund creation after GM loss resumes one receipt and never duplicates returned rounds",async()=>{
  const previous=globalThis.CONST;globalThis.CONST={DOCUMENT_OWNERSHIP_LEVELS:{OBSERVER:2}};
  const fx=await expandedWeaponFixture({inventoryAmmo:false});try{
    const options={operationId:"refund-leader-loss",removeItemId:"part-0",completionReceipt:{projectId:"trusted"}};
    fx.failAt("create","after",()=>game.user.active=false);
    await assert.rejects(()=>fx.service.applyWeaponModernization(fx.host,fx.component,options));
    assert.equal(fx.group.items.contents.filter(i=>i.type==="consumable").length,1);game.user.active=true;
    await fx.service.applyWeaponModernization(fx.host,fx.component,options);await fx.service.applyWeaponModernization(fx.host,fx.component,options);
    const ammo=fx.group.items.contents.filter(i=>i.type==="consumable");assert.equal(ammo.length,1);assert.equal(ammo[0].system.quantity,9);
    assert.equal(fx.host.getFlag(NS,"firearmAmmoState").current,18);
  }finally{fx.restore();globalThis.CONST=previous;}
});
test("ammo refund recovery never accepts or deletes a foreign edited newly created stack",async()=>{
  const previous=globalThis.CONST;globalThis.CONST={DOCUMENT_OWNERSHIP_LEVELS:{OBSERVER:2}};
  const fx=await expandedWeaponFixture({inventoryAmmo:false});try{
    const options={operationId:"refund-foreign-create",removeItemId:"part-0",completionReceipt:{projectId:"trusted"}};
    fx.failAt("create","after",()=>game.user.active=false);await assert.rejects(()=>fx.service.applyWeaponModernization(fx.host,fx.component,options));
    const ammo=fx.group.items.contents.find(i=>i.type==="consumable");ammo.data.system.quantity=99;game.user.active=true;
    await assert.rejects(()=>fx.service.applyWeaponModernization(fx.host,fx.component,options),e=>e.code==="manual-review");
    assert.equal(fx.group.items.contents.filter(i=>i.type==="consumable").length,1);assert.equal(ammo.system.quantity,99);
  }finally{fx.restore();globalThis.CONST=previous;}
});
