import test from "node:test";
import assert from "node:assert/strict";
import {optionalModule,required,makeTargetCase,makeWeaponModMutationFixture,makeItem,gear} from "./helpers/weapon-mod-fixture.mjs";
import {CurseUpgradeDamageAdapter} from "../scripts/combat/curse-upgrade-damage.js";
import {ItemUpgradeAutomationService} from "../scripts/automation/item-upgrade-automation-service.js";
import {createDnd5eItemData} from "../scripts/data/gear-compendium.js";
import {weaponModProfileSignature} from "../scripts/data/weapon-mod-rules.js";
globalThis.CONST??={DOCUMENT_OWNERSHIP_LEVELS:{OBSERVER:2}};
const module=await optionalModule(new URL("../scripts/automation/weapon-mod-roll-modifiers.js",import.meta.url)),build=required(module,"buildWeaponModTargetDecision");

test("silencers use the actual attack total, exact ammunition and their source hearing radius",()=>{
  const basic=build(makeTargetCase("glushitel")),improved=build(makeTargetCase("uluchshennyy-glushitel",{distanceFeet:10,attackTotal:25}));
  assert.equal(basic.suppressionCheck.dc,22);assert.equal(basic.suppressionCheck.radiusFeet,30);assert.equal(improved.suppressionCheck.dc,22);assert.equal(improved.suppressionCheck.radiusFeet,10);
  for(const distanceFeet of [10.1,30])assert.equal(build(makeTargetCase("uluchshennyy-glushitel",{distanceFeet})).suppressionCheck,null);
  for(const field of ["canHear","hiddenFromTarget"])assert.equal(build(makeTargetCase("glushitel",{[field]:false})).suppressionCheck,null);
  for(const family of ["shotgun","energy","gauss",null]){const input=makeTargetCase("glushitel");input.attack.ammunitionFamily=family;assert.equal(build(input).suppressionCheck,null);}
  for(const family of ["musket","pistol","rifle"]){const input=makeTargetCase("glushitel");input.attack.ammunitionFamily=family;assert.ok(build(input).suppressionCheck);}
});

test("unknown hearing and hidden facts require a target-bound decision, known false short-circuits it",()=>{
  const input=makeTargetCase("glushitel",{canHear:null,hiddenFromTarget:null}),before=structuredClone(input),result=build(input);
  assert.equal(result.suppressionCheck,null);assert.deepEqual(result.needsDecision.map(entry=>entry.field).sort(),["canHear","hiddenFromTarget"]);assert.deepEqual(input,before);
  assert.deepEqual(build(makeTargetCase("glushitel",{canHear:false,hiddenFromTarget:null})).needsDecision,[]);
});

test("accelerator requires explicit material status while condenser works on immaterial targets",()=>{
  const material=build(makeTargetCase("razgonshchik-snaryadov")),immaterial=build(makeTargetCase("razgonshchik-snaryadov",{materialTarget:false}));
  assert.equal(material.damageRule.ignoreNonmagicalResistance,true);assert.equal(material.damageRule.treatNonmagicalImmunityAsResistance,true);assert.equal(immaterial.damageRule.ignoreNonmagicalResistance,false);
  assert.equal(build(makeTargetCase("uplotnitel-snaryadov",{materialTarget:false})).damageRule.treatNonmagicalImmunityAsResistance,true);
  assert.deepEqual(build(makeTargetCase("razgonshchik-snaryadov",{materialTarget:null})).needsDecision.map(entry=>entry.field),["materialTarget"]);
  const melee=makeTargetCase("uplotnitel-snaryadov");melee.attack.type="melee";assert.equal(build(melee).damageRule.ignoreNonmagicalResistance,false);
});

test("target decisions are exact, cannot replace known facts, and reserve material judgments to GM",()=>{
  const validate=required(module,"isValidWeaponModTargetDecision"),resolve=required(module,"resolveWeaponModTargetConditions"),decision={kind:"target-effects",targetUuid:"Token.t",attackMessageId:"attack",targetVisible:null,canHear:true,hiddenFromTarget:true,materialTarget:null},context={targetUuid:"Token.t",attackMessageId:"attack"};
  assert.equal(validate(decision),true);assert.equal(validate({...decision,approvedBy:"forged"}),false);assert.equal(validate({...decision,attackMessageId:null}),false);
  assert.throws(()=>resolve({canHear:false},decision,context));assert.throws(()=>resolve({},decision,{...context,targetUuid:"Token.other"}));
  assert.throws(()=>resolve({}, {...decision,materialTarget:true},context));assert.equal(resolve({}, {...decision,materialTarget:false},{...context,allowMaterialDecision:true}).materialTarget,false);
});

function packetFixture(){
  const actor={uuid:"Actor.target",system:{attributes:{hp:{}},traits:{dr:{value:new Set(["piercing"]),bypasses:new Set(["mgc"])},di:{value:new Set(["slashing"]),bypasses:new Set(["mgc"])}}}},
    service={sources:()=>[],moduleApi:{combatAttackService:{getWeaponModDamageRule:()=>({ignoreNonmagicalResistance:true,treatNonmagicalImmunityAsResistance:true})}}};
  return {actor,service,adapter:new CurseUpgradeDamageAdapter(service)};
}
test("native packet changes only nonmagical traits, preserves save/other ignores, and restores reused options",()=>{
  const {actor,adapter}=packetFixture(),resistance=new Set(["cold"]),downgrade=new Set(["acid"]),ignore={resistance,modification:new Set(["fire"])},options={multiplier:0.5,ignore,downgrade},
    packets=[{type:"piercing",value:20,properties:new Set()},{type:"slashing",value:20,properties:new Set()},{type:"piercing",value:20,properties:new Set(["mgc"])}];
  adapter.preCalculateDamage(actor,packets,options);assert.equal(options.ignore.resistance.has("piercing"),true);assert.equal(options.downgrade.has("slashing"),true);assert.equal(options.ignore.modification.has("fire"),true);
  assert.deepEqual(packets.map(part=>part.value),[20,20,20]);assert.equal(options.multiplier,0.5);assert.deepEqual([...resistance],["cold"]);assert.deepEqual([...downgrade],["acid"]);
  adapter.calculateDamage(actor,packets,options);assert.equal(options.ignore,ignore);assert.equal(options.downgrade,downgrade);
  actor.system.traits.dr.bypasses.clear();actor.system.traits.di.bypasses.clear();adapter.preCalculateDamage(actor,packets.map(part=>({...part})),options);assert.equal(options.ignore,ignore);assert.equal(options.downgrade,downgrade);
});

test("MIDI and native callbacks do not repeat trait changes and noCalc stays untouched",()=>{
  const {actor,adapter}=packetFixture(),packet=[{type:"slashing",value:20,properties:new Set()}],options={midi:{saved:true,saveMultiplier:0.5}};
  adapter.preCalculateDamage(actor,packet,options);assert.equal(options.downgrade,undefined);adapter.midiPreCalculateDamage(actor,packet,options);const own=options.downgrade;assert.equal(own.has("slashing"),true);
  adapter.midiPreCalculateDamage(actor,packet,options);assert.equal(options.downgrade,own);adapter.calculateDamage(actor,packet,options);assert.equal(options.downgrade,own);adapter.midiCalculateDamage(actor,packet,options);assert.equal(options.downgrade,undefined);
  const ignored={midi:{noCalc:true}};adapter.midiPreCalculateDamage(actor,packet,ignored);assert.equal(ignored.downgrade,undefined);
});

async function targetFixture(sourceId="glushitel",{modernized=false}={}){
  const fx=await makeWeaponModMutationFixture({quantity:1}),previousRoll=globalThis.Roll;
  const native=createDnd5eItemData(gear.find(row=>row.id===(modernized?"drobovik":"vintovka")),new Map());Object.assign(fx.host.data,{...native,_id:fx.host.id});fx.component.data.flags=makeItem(sourceId).flags;
  if(modernized)await fx.service.installWeaponModernization(fx.host,fx.component,{operationId:"component"});
  else await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"component",mountId:"barrel"});
  const automation=new ItemUpgradeAutomationService(fx.api);automation.weaponModCatalog=fx.catalog;fx.api.itemUpgradeAutomationService=automation;
  const scene={id:"scene",uuid:"Scene.scene",grid:{type:1,size:100,distance:5,units:"ft"},tokens:{contents:[]}},shooter={id:"shooter",uuid:"Scene.scene.Token.shooter",parent:scene,actor:fx.group,x:0,y:0,width:1,height:1},observer={id:"observer",uuid:"Scene.scene.Token.observer",parent:scene,actor:fx.hero,x:400,y:0,width:1,height:1};
  scene.tokens.contents=[shooter,observer];fx.group.getActiveTokens=()=>[shooter];fx.hero.statuses=new Set();
  const resolve=globalThis.fromUuid;globalThis.fromUuid=async uuid=>uuid===shooter.uuid?shooter:uuid===observer.uuid?observer:resolve(uuid);
  const attackData=Object.values(fx.host.system.activities).find(activity=>activity.type==="attack"),activity={...attackData,id:attackData._id,uuid:`${fx.host.uuid}.Activity.${attackData._id}`,item:fx.host,actor:fx.group,actionType:"rwak"};
  const nonce="native-attack",roll={total:24,options:{rebreyaWeaponModAttack:{nonce,actorUuid:fx.group.uuid,hostItemId:fx.host.id,activityUuid:activity.uuid,sourceTokenUuid:shooter.uuid,ammunitionFamily:"rifle",targetUuids:[observer.uuid],
    components:[{itemId:fx.component.id,sourceId,profileSignature:weaponModProfileSignature(fx.catalog.rows.find(row=>row.sourceId===sourceId).profile)}]}}};
  // Native message/document boundaries; subject services and physical inventory are real.
  const flag=(data,path)=>path.split(".").reduce((value,key)=>value?.[key],data),message={id:"attack",_id:"attack",rolls:[roll],flags:{dnd5e:{activity:{uuid:activity.uuid},roll:{type:"attack"}}},getFlag(scope,key){return flag(this.flags[scope],key);}};fx.cards.set(message.id,message);
  let rolled=0;fx.hero.rollSkill=async(config,_dialog,messageConfig)=>{rolled++;assert.equal(config.skill,"prc");assert.equal(config.ability,"wis");assert.equal(messageConfig.create,false);return [{total:23,toJSON:()=>JSON.stringify({total:23})}];};
  globalThis.Roll={fromJSON:json=>JSON.parse(json)};
  const create=ChatMessage.create;ChatMessage.create=async data=>{const document={...structuredClone(data),id:data._id,getFlag(scope,key){return flag(this.flags?.[scope],key);},async update(patch){for(const [path,value] of Object.entries(patch))foundry.utils.setProperty(this,path,structuredClone(value));return this;}};fx.cards.set(document.id,document);return document;};
  game.messages.values=()=>fx.cards.values();
  const payload={actorUuid:fx.group.uuid,hostItemId:fx.host.id,childItemId:fx.component.id,activityId:activity.id,operationId:"target-request",decision:{kind:"target-effects",targetUuid:observer.uuid,attackMessageId:message.id,targetVisible:null,canHear:true,hiddenFromTarget:true,materialTarget:null}};
  return {...fx,activity,message,observer,shooter,payload,roll,rolled:()=>rolled,restore(){ChatMessage.create=create;globalThis.Roll=previousRoll;fx.restore();}};
}

test("suppression uses one native observer check and one private durable receipt without rerolling the attack",async()=>{
  const fx=await targetFixture();try{
    const result=await fx.service.useWeaponModActivity(fx.payload,{sender:fx.sender});assert.equal(result.revealedToObserver,true);assert.equal(result.perceptionTotal,23);assert.equal(result.dc,22);assert.equal(fx.rolled(),1);
    const replay=await fx.service.useWeaponModActivity({...fx.payload,operationId:"new-click"},{sender:fx.sender});assert.equal(replay.replayed,true);assert.equal(fx.rolled(),1);
    const receipt=fx.cards.get(result.receiptId);assert.ok(receipt.whisper.includes("gm"));assert.equal(receipt.flags["rebreya-main"].weaponModTargetReceipt.targetUuid,fx.observer.uuid);assert.equal(receipt.rolls.length,1);
    assert.equal(fx.observer.hidden,undefined);assert.equal(fx.hero.statuses.has("hidden"),false);assert.equal(fx.roll.total,24);
  }finally{fx.restore();}
});

test("target effect cancellation is free, uncertain rolling receipts never reroll, and private facts stay scoped",async()=>{
  const fx=await targetFixture();try{
    fx.hero.rollSkill=async()=>null;const cancelled=await fx.service.useWeaponModActivity(fx.payload,{sender:fx.sender});assert.equal(cancelled.cancelled,true);
    let attempts=0;fx.hero.rollSkill=async()=>{attempts++;throw Error("lost roll response");};
    assert.equal((await fx.service.useWeaponModActivity(fx.payload,{sender:fx.sender})).cancelled,true);assert.equal(attempts,0);
    await assert.rejects(fx.service.useWeaponModActivity({...fx.payload,operationId:"explicit-new-attempt"},{sender:fx.sender}),/lost roll response/u);assert.equal(attempts,1);
    await assert.rejects(fx.service.useWeaponModActivity({...fx.payload,operationId:"retry"},{sender:fx.sender}),/повторного броска|сверк/u);assert.equal(attempts,1);
  }finally{fx.restore();}
});

test("confirmed material decision applies only to its exact native attack and target",async()=>{
  const fx=await targetFixture("razgonshchik-snaryadov");try{
    const player={id:"player",isGM:false};fx.group.ownership.player=3;
    await assert.rejects(fx.service.useWeaponModActivity({...fx.payload,decision:{...fx.payload.decision,materialTarget:true}},{sender:player}));
    const payload={...fx.payload,decision:{...fx.payload.decision,materialTarget:true}},result=await fx.service.useWeaponModActivity(payload,{sender:fx.sender});assert.equal(result.damageRule.ignoreNonmagicalResistance,true);assert.equal(fx.rolled(),0);
    const service=fx.api.combatAttackService,context={attackMessageId:fx.message.id,activityUuid:fx.activity.uuid,attackNonce:fx.roll.options.rebreyaWeaponModAttack.nonce,targetUuid:fx.observer.uuid};
    assert.equal(required({get:service.getWeaponModDamageRule?.bind(service)},"get")(fx.hero,{rebreyaWeaponModDamage:context}).ignoreNonmagicalResistance,true);
    assert.equal(service.getWeaponModDamageRule(fx.hero,{rebreyaWeaponModDamage:{...context,targetUuid:"Scene.scene.Token.other"}}),null);
    assert.equal(service.getWeaponModDamageRule(fx.hero,{rebreyaWeaponModDamage:{...context,attackNonce:"other-shot"}}),null);
    assert.equal(service.getWeaponModDamageRule(fx.group,{rebreyaWeaponModDamage:context}),null);
  }finally{fx.restore();}
});

test("native attack context is unique and damage UI retains cached option identity with exact source binding",async()=>{
  const fx=await targetFixture("uplotnitel-snaryadov");try{
    const config={subject:fx.activity,targets:new Set([fx.observer]),rolls:[{parts:["@authored"],options:{}}]},service=fx.api.combatAttackService;
    required({tag:service.tagWeaponModAttack?.bind(service)},"tag")(config);const first=config.rolls[0].options.rebreyaWeaponModAttack;
    service.tagWeaponModAttack(config);assert.equal(config.rolls[0].options.rebreyaWeaponModAttack.nonce,first.nonce);assert.equal(first.hostItemId,fx.host.id);assert.deepEqual(first.targetUuids,[fx.observer.uuid]);assert.deepEqual(config.rolls[0].parts,["@authored"]);
    class NativeElement{constructor(){this.chatMessage=fx.message;this.options={multiplier:0.5};}getTargetOptions(){return this.options;}}
    const adapter=new CurseUpgradeDamageAdapter({sources:()=>[],moduleApi:fx.api});required({register:adapter.registerNativeDamageOptions?.bind(adapter)},"register")(NativeElement);
    const element=new NativeElement(),options=element.getTargetOptions(fx.observer.uuid);assert.equal(options,element.options);assert.equal(options.multiplier,0.5);assert.equal(options.rebreyaWeaponModDamage.attackMessageId,fx.message.id);
    assert.equal(options.rebreyaWeaponModDamage.targetUuid,fx.observer.uuid);element.chatMessage=null;assert.equal(element.getTargetOptions(fx.observer.uuid).rebreyaWeaponModDamage,undefined);
    const merged={...fx.message,id:"merged",getAssociatedRolls:()=>[fx.message]};element.chatMessage=merged;assert.equal(element.getTargetOptions(fx.observer.uuid).rebreyaWeaponModDamage.attackMessageId,fx.message.id);
  }finally{fx.restore();}
});
for(const method of ["rollWeaponAttack","rollFirearmAttack"])test(`${method} publishes the actual tagged attack and drives suppressor receipts; message-free rolls stay message-free`,async()=>{
  const fx=await targetFixture();try{
    Object.defineProperty(fx.host,"actor",{value:fx.group});fx.group.system.abilities={dex:{mod:4}};fx.group.system.attributes={prof:3};
    fx.host.data.flags["rebreya-main"].firearmAmmoState={current:6,capacity:6,ammunition:"Винтовочный"};
    ChatMessage.getSpeaker=({actor})=>({actor:actor.id});let cards=0;
    class NativeRoll{
      constructor(formula,data){Object.assign(this,{formula,data,options:{},dice:[{results:[{result:15,active:true}]}]});}
      evaluate(){this.total=24;return this;}
      async toMessage(data){cards++;return ChatMessage.create({...data,_id:`legacy-${cards}`,rolls:[this]});}
      static fromJSON(json){return JSON.parse(json);}
    }
    globalThis.Roll=NativeRoll;
    const service=fx.api.combatAttackService,options={targetToken:fx.observer,firearmMisfire:0};
    const result=await service[method](fx.group,fx.host,options),card=fx.cards.get("legacy-1"),attack=service.getWeaponModAttackContext(card);
    assert.ok(attack,"public attack must enter the canonical target-effect route");assert.equal(attack.roll.total,result.total);
    assert.equal(attack.context.activityUuid,fx.activity.uuid);assert.deepEqual(attack.context.targetUuids,[fx.observer.uuid]);assert.equal(attack.context.abilityModifier,4);
    assert.equal(attack.context.sourceTokenUuid,fx.shooter.uuid);assert.equal(result.roll.options.rebreyaWeaponModAttack.nonce,attack.context.nonce);
    service.promptWeaponModTargetConditions=async()=>({canHear:true,hiddenFromTarget:true,targetVisible:null,materialTarget:null});
    await service.handleWeaponModAttackMessage(card);assert.equal(fx.rolled(),1);
    const before=cards;await service[method](fx.group,fx.host,{...options,createMessage:false});assert.equal(cards,before);assert.equal(fx.rolled(),1);
  }finally{fx.restore();}
});

test("MIDI finalizes a source-bound immunity downgrade once without any flat curse and keeps the save once",()=>{
  const {actor,service,adapter}=packetFixture(),context={attackMessageId:"attack",attackNonce:"nonce",activityUuid:"Activity.a",targetUuid:"Token.t"};
  service.moduleApi.combatAttackService.getWeaponModDamageContext=()=>context;actor.system.attributes.hp={value:100,max:100,damage:0,temp:0};let calculations=0;
  actor.calculateDamage=(raw,options)=>{
    calculations++;assert.deepEqual(options.rebreyaWeaponModDamage,context);adapter.midiPreCalculateDamage(actor,raw,options);assert.equal(options.downgrade.has("slashing"),true);
    const result=raw.map(part=>({...part,value:part.value*options.midi.saveMultiplier*0.5,active:{resistance:true}}));adapter.midiCalculateDamage(actor,result,options);return result;
  };
  const item={damageDetails:{rawdefaultDamage:[{type:"slashing",value:20,properties:new Set()}],calcDamageOptions:{defaultDamage:{multiplier:1,midi:{saved:true,saveMultiplier:0.5,applyDamage:true}}}}},token={uuid:"Token.t",actor};
  const args={workflow:{itemCardId:"attack",activity:{uuid:"Activity.a"}},damageItem:item};adapter.preTargetDamageApplication(token,args);adapter.preTargetDamageApplication(token,args);
  assert.equal(calculations,1);assert.equal(item.damageDetail[0].value,5);assert.equal(item.newHP,95);
});

test("MIDI custom traits remain intact and explicitly request manual resolution",()=>{
  const {actor,service,adapter}=packetFixture();actor.system.traits.dr.custom="spell";let warned=0;service.moduleApi.combatAttackService.warnWeaponModDamageLimit=()=>warned++;
  const options={midi:{saved:true},ignore:{resistance:new Set(["fire"])}},before=structuredClone(options),packet=[{type:"piercing",value:10,properties:new Set()}];
  adapter.midiPreCalculateDamage(actor,packet,options);assert.deepEqual(options,before);assert.equal(packet[0].value,10);assert.equal(warned,1);assert.equal(actor.system.traits.dr.custom,"spell");
});

test("an aborted native damage calculation restores scoped options even when no post hook runs",()=>{
  const {actor,adapter}=packetFixture(),options={multiplier:0.5};
  class NativeActor{constructor(){Object.assign(this,actor);}calculateDamage(damages,actualOptions){adapter.preCalculateDamage(this,damages,actualOptions);assert.ok(actualOptions.downgrade.has("slashing"));return false;}}
  required({register:adapter.registerNativePacketCleanup?.bind(adapter)},"register")(NativeActor);
  assert.equal(new NativeActor().calculateDamage([{type:"slashing",value:20,properties:new Set()}],options),false);assert.deepEqual(options,{multiplier:0.5});
});

test("native damage waits for exact target approval while preserving authored config and native originating flags",async()=>{
  const fx=await targetFixture("uplotnitel-snaryadov");try{
    let calls=0;const config={event:{target:{closest:()=>({dataset:{messageId:fx.message.id}})}},rolls:[{parts:["@authored + 2d7"]}]},dialog={configure:false},message={data:{flags:{dnd5e:{originatingMessage:"usage"},foreign:{kept:1}}}},
      clone=new Item(fx.host.toObject(),fx.group),activity={...fx.activity,item:null,async rollDamage(actualConfig,actualDialog,actualMessage){calls++;assert.equal(actualConfig,config);assert.equal(actualDialog,dialog);assert.equal(actualMessage.data.flags.dnd5e.originatingMessage,"usage");assert.equal(actualMessage.data.flags.foreign.kept,1);assert.equal(actualMessage.data.flags["rebreya-main"].weaponModDamageContext.attackMessageId,fx.message.id);return "native-damage";}};
    activity.item=clone;clone.system.activities=new Map([[activity.id,activity]]);fx.api.itemUpgradeAutomationService.applyWeaponModActivityRuntime(clone);
    assert.equal(await activity.rollDamage(config,dialog,message),"native-damage");assert.equal(calls,1);assert.equal(fx.rolled(),0);
    assert.ok([...fx.cards.values()].some(card=>card.flags?.["rebreya-main"]?.weaponModTargetReceipt?.status==="resolved"));assert.deepEqual(config.rolls[0].parts,["@authored + 2d7"]);
    const original=()=>"untouched",bare={system:{activities:new Map([["plain",{id:"plain",type:"attack",rollDamage:original}]])}};
    fx.api.itemUpgradeAutomationService.applyWeaponModActivityRuntime(bare);assert.equal(bare.system.activities.get("plain").rollDamage,original);
  }finally{fx.restore();}
});

test("a changed observer during the GM dialog cannot trigger a stale perception roll",async()=>{
  const fx=await targetFixture();try{
    fx.api.combatAttackService.promptWeaponModTargetConditions=async({conditions})=>{fx.observer.x+=100;return {...conditions,canHear:true,hiddenFromTarget:true};};
    await assert.rejects(fx.service.useWeaponModActivity({...fx.payload,decision:{...fx.payload.decision,canHear:null,hiddenFromTarget:null}},{sender:fx.sender}),/измен/u);assert.equal(fx.rolled(),0);
  }finally{fx.restore();}
});

test("GM chat lifecycle processes each new attack once and does not resolve historical cards on reload",async()=>{
  const fx=await targetFixture();try{
    const service=fx.api.combatAttackService;required({init:service.initializeWeaponModTargetIndex?.bind(service)},"init")();
    service.promptWeaponModTargetConditions=async({conditions})=>({...conditions,canHear:true,hiddenFromTarget:true});
    await service.handleWeaponModAttackMessage(fx.message);assert.equal(fx.rolled(),0);
    fx.roll.options.rebreyaWeaponModAttack.nonce="fresh-attack";await service.handleWeaponModAttackMessage(fx.message);await service.handleWeaponModAttackMessage(fx.message);assert.equal(fx.rolled(),1);
    assert.equal(fx.message.getFlag("rebreya-main","weaponModTargetReceipt"),undefined);
  }finally{fx.restore();}
});

test("scatter keeps its fixed source formula, strong drilling changes radius, weak drilling alone adds the actual ability modifier",()=>{
  const plan=required(module,"buildWeaponModScatterPlan"),base={host:{id:"host"},attack:{total:24,isFumble:false},scatterDamage:"1d6",abilityModifier:3,
    targets:[{uuid:"near",distanceFeet:5,ac:14},{uuid:"ten",distanceFeet:10,ac:20},{uuid:"miss",distanceFeet:5,ac:25}]};
  const strong=plan({...base,contributions:makeTargetCase("sil-naya-sverdlovka").contributions});assert.equal(strong.radiusFeet,10);assert.equal(strong.damageFormula,"1d6");assert.deepEqual(strong.targets.filter(target=>target.hit).map(target=>target.uuid),["near","ten"]);
  const weak=plan({...base,contributions:makeTargetCase("slabaya-sverdlovka").contributions});assert.equal(weak.radiusFeet,5);assert.equal(weak.damageFormula,"(1d6) + (3)");assert.deepEqual(weak.targets.filter(target=>target.hit).map(target=>target.uuid),["near"]);
  assert.equal(plan({...base,attack:{...base.attack,isFumble:true},contributions:[]}).targets.some(target=>target.hit),false);
  assert.equal(plan({...base,abilityModifier:null,contributions:makeTargetCase("slabaya-sverdlovka").contributions}).needsDecision[0].field,"abilityModifier");
});

test("scatter uses one native fixed damage roll, exact hit list, and a private durable replay without spending more ammunition",async()=>{
  const fx=await targetFixture("slabaya-sverdlovka",{modernized:true}),previousConfig=globalThis.CONFIG;
  try{
    fx.roll.data={mod:3};fx.hero.system={attributes:{ac:{value:12}}};
    const neighbor={...fx.observer,id:"neighbor",uuid:"Scene.scene.Token.neighbor",x:500},resolve=globalThis.fromUuid;
    fx.observer.parent.tokens.contents.push(neighbor);globalThis.fromUuid=async uuid=>uuid===neighbor.uuid?neighbor:resolve(uuid);
    let evaluations=0;globalThis.CONFIG={...previousConfig,Dice:{DamageRoll:class{
      constructor(formula){assert.equal(formula,"(1d6) + (3)");this.total=7;}
      async evaluate(){evaluations++;return this;}toJSON(){return JSON.stringify({total:this.total});}
    }}};
    const payload={...fx.payload,decision:{kind:"scatter",attackMessageId:fx.message.id,primaryTargetUuid:fx.observer.uuid,originPoint:null,abilityModifier:null}},
      before=structuredClone(fx.host.toObject()),currency=structuredClone(fx.group.system.currency);
    const result=await fx.service.useWeaponModActivity(payload,{sender:fx.sender});
    assert.deepEqual(result.hits.map(hit=>hit.uuid),[neighbor.uuid]);assert.equal(result.damageTotal,7);assert.equal(evaluations,1);
    const receipt=fx.cards.get(result.receiptId);assert.ok(receipt.whisper.every(id=>game.users.get(id).isGM));assert.equal(receipt.rolls.length,1);
    assert.equal((await fx.service.useWeaponModActivity({...payload,operationId:"retry"},{sender:fx.sender})).replayed,true);assert.equal(evaluations,1);
    assert.deepEqual(fx.host.toObject(),before);assert.deepEqual(fx.group.system.currency,currency);
  }finally{globalThis.CONFIG=previousConfig;fx.restore();}
});

test("scatter validates exact decisions, occupied cells, and refuses uncertain RNG retries",async()=>{
  const validate=required(module,"isValidWeaponModScatterDecision"),decision={kind:"scatter",attackMessageId:"attack",primaryTargetUuid:null,originPoint:null,abilityModifier:null};
  assert.equal(validate(decision),true);assert.equal(validate({...decision,approvedBy:"fake"}),false);assert.equal(validate({...decision,originPoint:{x:0,y:0,extra:true}}),false);
  const fx=await targetFixture("sil-naya-sverdlovka",{modernized:true}),previousConfig=globalThis.CONFIG;
  try{
    fx.hero.system={attributes:{ac:{value:12}}};fx.observer.width=2;fx.observer.height=2;
    const near={...fx.observer,id:"near",uuid:"Scene.scene.Token.near",x:700,width:1,height:1},resolve=globalThis.fromUuid;
    fx.observer.parent.tokens.contents.push(near);globalThis.fromUuid=async uuid=>uuid===near.uuid?near:resolve(uuid);
    const payload={...fx.payload,decision:{...decision,primaryTargetUuid:fx.observer.uuid,originPoint:{x:650,y:50}}};
    await assert.rejects(fx.service.useWeaponModActivity(payload,{sender:fx.sender}),/пространство/u);
    payload.decision.originPoint={x:550,y:50};let count=0;
    globalThis.CONFIG={...previousConfig,Dice:{DamageRoll:class{async evaluate(){count++;throw Error("uncertain scatter roll");}}}};
    await assert.rejects(fx.service.useWeaponModActivity(payload,{sender:fx.sender}),/uncertain scatter roll/u);
    await assert.rejects(fx.service.useWeaponModActivity({...payload,operationId:"retry"},{sender:fx.sender}),/ручная сверка/u);assert.equal(count,1);
  }finally{globalThis.CONFIG=previousConfig;fx.restore();}
});
