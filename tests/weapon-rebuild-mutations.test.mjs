import test from "node:test";
import assert from "node:assert/strict";
import {makeWeaponModMutationFixture,makeItem} from "./helpers/weapon-mod-fixture.mjs";
const NS="rebreya-main";
async function fixture(){const fx=await makeWeaponModMutationFixture({quantity:2}),part=makeItem("oblegchyonnyy-korpus");
  Object.assign(fx.component.data,{name:part.name,flags:part.flags});fx.group.system.currency={gp:500};return fx;}
test("paid modernization debits owner wallet once, installs one part and replays without a project",async()=>{
  const fx=await fixture();try{
    const result=await fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"paid"});
    assert.equal(fx.group.system.currency.gp,0);assert.equal(fx.component.system.quantity,1);assert.equal(fx.host.getFlag(NS,"weaponMods").modernizedParts.length,1);
    const replay=await fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"paid"});
    assert.equal(replay.replayed,true);assert.equal(replay.itemId,result.itemId);assert.equal(fx.group.system.currency.gp,0);
    assert.equal(fx.api.craftingService,undefined);
  }finally{fx.restore();}
});
test("499gp and a forged completion receipt refuse before any item or wallet write",async()=>{
  const fx=await fixture();try{
    fx.group.system.currency.gp=499;
    await assert.rejects(()=>fx.service.applyWeaponModernization(fx.host,fx.component,{operationId:"poor",completionReceipt:{approved:true}}),e=>e.code==="insufficient-funds");
    assert.equal(fx.group.system.currency.gp,499);assert.equal(fx.component.system.quantity,2);assert.equal(fx.host.getFlag(NS,"weaponMods"),undefined);
  }finally{fx.restore();}
});
test("failure after wallet debit restores its exact denominations, lost GM resumes one payment",async()=>{
  const fx=await fixture();try{
    fx.group.system.currency={pp:50,gp:0,ep:0,sp:0,cp:7};const before=structuredClone(fx.group.system.currency);
    fx.failAt("placement","after");await assert.rejects(()=>fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"wallet-failure"}));
    assert.deepEqual(fx.group.system.currency,before);assert.equal(fx.component.system.quantity,2);
    fx.failAt("placement","after",()=>game.user.active=false);
    await assert.rejects(()=>fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"wallet-leader-loss"}));
    game.user.active=true;await fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"wallet-leader-loss"});
    assert.equal(fx.group.system.currency.cp,7);assert.equal(fx.group.system.currency.pp,0);assert.equal(fx.component.system.quantity,1);
  }finally{fx.restore();}
});
test("foreign wallet edit is preserved and no successful modernization can be claimed",async()=>{
  const fx=await fixture();try{
    fx.failAt("placement","after",()=>fx.group.system.currency.gp=123);
    await assert.rejects(()=>fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"foreign-wallet"}),e=>e.code==="manual-review");
    assert.equal(fx.group.system.currency.gp,123);assert.equal(fx.host.getFlag(NS,"weaponMods"),undefined);
  }finally{fx.restore();}
});
test("special host approval must come from GM journal audit bound to host, profile and this operation",async()=>{
  const fx=await fixture();try{
    fx.host.data.system.properties.push("spc");
    fx.host.data.flags[NS].weaponMods={version:1,attachments:[],modernizedParts:[],approvals:[{sourceId:"oblegchyonnyy-korpus",approvedByUserId:"gm"}]};
    await assert.rejects(()=>fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"special"}),e=>e.code==="gm-approval-required");
    assert.equal(fx.group.system.currency.gp,500);
    const row=fx.catalog.rows.find(row=>row.sourceId==="oblegchyonnyy-korpus");
    const approval=await fx.service.approveWeaponModernization({actorUuid:fx.group.uuid,hostItemId:fx.host.id,sourceId:row.sourceId,profileSignature:row.profileSignature,operationId:"special"},{sender:fx.sender});
    await assert.rejects(()=>fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"other",approvalReceiptId:approval.approvalReceiptId}),e=>e.code==="gm-approval-required");
    await fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"special",approvalReceiptId:approval.approvalReceiptId});
    assert.equal(fx.group.system.currency.gp,0);
    const replay=await fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"special"});
    assert.equal(replay.replayed,true);
  }finally{fx.restore();}
});
test("GM cancellation is free and a confirmed special modernization retries without a second prompt or payment",async()=>{
  const fx=await fixture();try{
    const {registerWeaponModCommands}=await import("../scripts/application/weapon-mod-mutation-commands.js"),commands=new Map();
    registerWeaponModCommands({itemUpgradeService:fx.service},{register:(id,command)=>commands.set(id,command)});
    fx.host.data.system.properties.push("spc");let prompts=0,approved=false;
    foundry.applications={api:{DialogV2:{confirm:async()=>{prompts++;return approved;}}}};
    const command=commands.get("item-mod.modernization.install"),payload={actorUuid:fx.group.uuid,hostItemId:fx.host.id,componentItemId:fx.component.id,operationId:"dialog"},context={sender:{id:"player",isGM:false},assertActiveGm:()=>{}};
    const cancelled=await command.execute(payload,context);assert.equal(cancelled.cancelled,true);
    assert.equal(fx.group.system.currency.gp,500);assert.equal(fx.component.system.quantity,2);assert.equal(fx.cards.size,0);
    approved=true;await command.execute(payload,context);await command.execute(payload,context);
    assert.equal(prompts,2);assert.equal(fx.group.system.currency.gp,0);assert.equal(fx.component.system.quantity,1);assert.equal(fx.cards.size,1);
  }finally{fx.restore();}
});
test("a changed component during GM confirmation cannot inherit approval for the previously shown part",async()=>{
  const fx=await fixture();try{
    const {registerWeaponModCommands}=await import("../scripts/application/weapon-mod-mutation-commands.js"),commands=new Map();
    registerWeaponModCommands({itemUpgradeService:fx.service},{register:(id,command)=>commands.set(id,command)});
    fx.host.data.system.properties.push("spc");
    foundry.applications={api:{DialogV2:{confirm:async()=>{fx.component.data.flags=makeItem("utyazhelyonnyy-stvol").flags;return true;}}}};
    await assert.rejects(()=>commands.get("item-mod.modernization.install").execute({actorUuid:fx.group.uuid,hostItemId:fx.host.id,componentItemId:fx.component.id,operationId:"stale-dialog"},
      {sender:{id:"player",isGM:false},assertActiveGm:()=>{}}),e=>e.code==="stale-gm-approval");
    assert.equal(fx.group.system.currency.gp,500);assert.equal(fx.component.system.quantity,2);assert.equal(fx.host.getFlag(NS,"weaponMods"),undefined);
  }finally{fx.restore();}
});
