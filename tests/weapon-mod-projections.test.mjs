import test from "node:test";
import assert from "node:assert/strict";
import {optionalModule,required,makeCatalog,makeCandidate,getHost,makeAttackCase,makeWeaponModMutationFixture,makeItem} from "./helpers/weapon-mod-fixture.mjs";
import {readFile} from "node:fs/promises";
import {CombatAttackService} from "../scripts/combat/attack-service.js";
import {ItemUpgradeAutomationService} from "../scripts/automation/item-upgrade-automation-service.js";
import {buildActorInventoryWeightSnapshot} from "../scripts/data/inventory-weight.js";
import {getItemHandRequirement} from "../scripts/integrations/held-items.js";
import {ItemUpgradeService} from "../scripts/data/item-upgrade-service.js";
import {buildWeaponRebuildQuote} from "../scripts/data/weapon-rebuild-rules.js";
const module=await optionalModule(new URL("../scripts/automation/weapon-mod-projections.js",import.meta.url)),build=required(module,"buildWeaponModContributions"),apply=required(module,"projectWeaponModItem"),NS="rebreya-main",catalog=makeCatalog();
function fixture({gearId="vintovka",weight={value:20,units:"lb"}}={}){
  const actor={id:"a",uuid:"Actor.a",type:"character",items:{contents:[],get:id=>actor.items.contents.find(item=>item.id===id)}};
  const add=data=>{const item={id:data._id,actor,parent:actor,_source:structuredClone(data),system:structuredClone(data.system),
    get flags(){return this._source.flags;},get type(){return this._source.type;},getFlag:(scope,key)=>item._source.flags?.[scope]?.[key],toObject:()=>structuredClone(item._source)};
    if(Array.isArray(item.system.properties))item.system.properties=new Set(item.system.properties);
    actor.items.contents.push(item);return item;};
  const host=add({_id:"host",type:"weapon",name:"Оружие",system:{type:{value:"firearmAdvanced"},quantity:1,weight,range:{value:60,long:180,units:"ft"},properties:["two","lchFirearmReload"],
    damage:{base:{number:2,denomination:10,bonus:"@mod",types:["piercing"],custom:{enabled:false}},extra:[{formula:"1d4",type:"fire"},{formula:"2"}]}},
    flags:{[NS]:{gearId,itemUpgrades:{capacity:1,installed:[]},weaponMods:{version:1,attachments:[],modernizedParts:[],approvals:[]}}}});
  const install=(sourceId,id,weight,mountIds=[])=>{
    const row=catalog.rows.find(row=>row.sourceId===sourceId),kind=row.profile.kind;
    const child=add({_id:id,type:"loot",name:sourceId,system:{quantity:1,container:host.id,weight:{value:weight,units:"lb"}},flags:{[NS]:{gearId:sourceId,
      installedWeaponMod:{version:1,kind,hostActorId:actor.id,hostItemId:host.id,mountIds}}}});
    host._source.flags[NS].weaponMods[kind==="weaponAttachment"?"attachments":"modernizedParts"].push({itemId:id,sourceId,...(kind==="weaponAttachment"?{mountIds}:{})});
    return {itemId:id,sourceId,profile:row.profile,source:child.toObject(),catalogWeightLb:row.weight,mountIds,child};
  };
  const service=new ItemUpgradeAutomationService({},{getManifest:async()=>[]});service.weaponModCatalog=catalog;service.hostAdapterReady=true;
  const prepare=item=>{service.restoreItemProjection(item);service.applyItemProjection(item);};
  return {actor,host,install,add,service,prepare};
}
test("native projection counts signed body parts before halving and attachments after, child source weights survive",()=>{
  const fx=fixture();fx.install("oblegchyonnyy-korpus","body",0);fx.install("utyazhelyonnyy-stvol","barrel",2);
  const bipod=fx.install("soshki","bipod",2,["bottom-1","barrel"]),light=fx.install("fonarik","light",2,["side-1"]);
  for(const item of fx.actor.items.contents)fx.prepare(item);
  assert.equal(fx.host.system.weight.value,15);assert.equal(buildActorInventoryWeightSnapshot(fx.actor).weightLb,15);
  assert.equal(bipod.child.system.weight.value,0);assert.equal(light.child.system.weight.value,0);assert.equal(light.child.toObject().system.weight.value,2);
  assert.deepEqual(fx.host.system.range,{value:80,long:210,units:"ft"});assert.equal(fx.host.system.properties.has("lchFirearmProneFire"),true);
  for(const item of fx.actor.items.contents)fx.prepare(item);
  assert.equal(fx.host.system.weight.value,15);assert.equal(buildActorInventoryWeightSnapshot(fx.actor).weightLb,15);
  fx.host._source.system.weight.value=40;fx.host.system.weight.value=40;fx.prepare(fx.host);assert.equal(fx.host.system.weight.value,25);
  fx.host._source.flags[NS].weaponMods.attachments=[];fx.host._source.flags[NS].weaponMods.modernizedParts=[];
  for(const item of fx.actor.items.contents)fx.prepare(item);
  assert.equal(fx.host.system.weight.value,40);assert.equal(light.child.system.weight.value,2);assert.equal(fx.host.system.properties.has("lchFirearmProneFire"),false);
});
test("foreign weight survives and existing weight upgrade reduces the aggregate once",()=>{
  const fx=fixture();fx.install("oblegchyonnyy-korpus","body",0);fx.install("utyazhelyonnyy-stvol","barrel",2);fx.install("fonarik","light",4,["side-1"]);
  fx.host.system.weight.value=30;
  const upgrade=fx.add({_id:"upgrade",type:"loot",system:{quantity:1,container:fx.host.id,weight:{value:0,units:"lb"}},flags:{[NS]:{gearId:"zacharovanie-lyogkosti",installedUpgrade:{hostItemId:fx.host.id,slotIndex:1}}}});
  fx.host._source.flags[NS].itemUpgrades.installed=[{itemId:upgrade.id,slotIndex:1}];
  fx.service.manifest=[{productId:"zacharovanie-lyogkosti",profile:{compatibility:["weapon"]},decision:"simple-implemented",activation:"carried"}];
  fx.prepare(fx.host);assert.equal(fx.host.system.weight.value,15);fx.prepare(fx.host);assert.equal(fx.host.system.weight.value,15);
});
test("native metric conversion gives the same carried weight without altering native child sources",()=>{
  const fx=fixture({weight:{value:8,units:"kg"}});fx.install("oblegchyonnyy-korpus","body",0);fx.install("utyazhelyonnyy-stvol","barrel",2);fx.install("fonarik","light",4,["side-1"]);
  for(const item of fx.actor.items.contents)fx.prepare(item);
  assert.equal(fx.host.system.weight.value,6);assert.equal(buildActorInventoryWeightSnapshot(fx.actor).weightLb,15);
});
test("scope projects the native activity before MIDI range checks and restores after aim without changing its source",async t=>{
  const fx=fixture();fx.install("opticheskiy-pritsel","scope",0,["top"]);
  const base=makeAttackCase("opticheskiy-pritsel"),combat=new CombatAttackService({itemUpgradeAutomationService:fx.service});fx.service.moduleApi.combatAttackService=combat;
  combat.getWeaponModAttackConditions=()=>base.conditions;
  let preparedRange={value:60,long:180,units:"ft"};
  const authored={value:"@range",long:"3 * @range",units:"ft",override:true},activity={type:"attack",actionType:"rwak",item:fx.host,actor:fx.actor,_source:{range:structuredClone(authored)},
    range:{...preparedRange},prepareFinalData(){this.range={...preparedRange};}};
  fx.host.system.activities=new Map([["attack",activity]]);fx.service.applyWeaponModActivityRuntime(fx.host);activity.prepareFinalData();
  assert.deepEqual(activity.range,{value:120,long:360,units:"ft"});activity.prepareFinalData();assert.equal(activity.range.long,360);
  assert.deepEqual(activity._source.range,authored);assert.deepEqual(fx.host.system.range,{value:60,long:180,units:"ft"});
  const grid={size:100,distance:5,type:1,units:"ft"};fx.actor.token={x:0,y:0,width:1,height:1,parent:{grid}};
  const target={x:6000,y:0,width:1,height:1,parent:{grid}};
  assert.equal(combat.getWeaponModRangeResolution(activity,target,2).long,360);
  let source;try{source=await readFile(new URL("../../midi-qol/midi-qol.js",import.meta.url),"utf8");}catch(error){if(error.code!=="ENOENT")throw error;t.diagnostic("Installed MIDI source unavailable; native range values were verified.");}
  if(source){
    const start=source.indexOf("  const checkRangeFunction = ",source.indexOf("function checkActivityRange(")),terminator='}, "checkRangeFunction");',end=source.indexOf(terminator,start)+terminator.length;
    assert.ok(start>0 && end>start);let distance=300;
    const checkRange=new Function("canvas","game","configSettings","MODULE_ID","allAttackTypes","getDistance","checkMechanic","__name","debugEnabled","log",`${source.slice(start,end)}; return checkRangeFunction;`)
      ({scene:{grid:{units:"ft"}}},{settings:{get:()=>false}},{optionalRules:{wallsBlockRange:"none"}},"midi-qol",["rwak"],()=>distance,()=>"fail",fn=>fn,0,()=>{});
    const nativeActor={name:"Shooter",system:{},flags:{}},token={actor:nativeActor},midiTarget={name:"Target",actor:{}},midiItem={actor:nativeActor,labels:{properties:[]}},
      nativeActivity={actor:nativeActor,item:midiItem,actionType:"rwak",range:activity.range,target:{affects:{type:"creature"}}};
    assert.equal(checkRange(nativeActivity,token,[midiTarget]).result,"dis");distance=100;assert.equal(checkRange(nativeActivity,token,[midiTarget]).result,"normal");
  }
  preparedRange={value:90,long:270,units:"ft"};activity.prepareFinalData();assert.deepEqual(activity.range,{value:180,long:540,units:"ft"});
  assert.equal(combat.getWeaponModRangeResolution(activity,target,2).long,540);
  base.conditions.aimMode=null;activity.prepareFinalData();assert.equal(activity.range.long,270);
  assert.deepEqual(activity._source.range,authored);
});
test("underwater valve rejects out of effective range in the use gate before native consumption",async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1});try{
    fx.component.data.flags=makeItem("podvodnyy-klapan").flags;await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"valve",mountId:"side-1"});
    const automation=new ItemUpgradeAutomationService(fx.api);automation.weaponModCatalog=fx.catalog;fx.api.itemUpgradeAutomationService=automation;
    const combat=fx.api.combatAttackService,conditions=makeAttackCase("podvodnyy-klapan",{underwater:true}).conditions;
    combat.getWeaponModAttackConditions=()=>conditions;fx.host.system.range={value:60,long:180,units:"ft"};
    const grid={size:100,distance:5,type:1,units:"ft"};fx.group.token={x:0,y:0,width:1,height:1,parent:{grid}};
    const activity={item:fx.host,actor:fx.group,actionType:"rwak"},target={x:2000,y:0,width:1,height:1,parent:{grid}};
    assert.equal(combat.deferWeaponModAttack(activity,{targets:[target]}),false);
  }finally{fx.restore();}
});
test("pure contributions preserve identity, two grips give two, and saw-off edits only base die/properties/range",()=>{
  const fx=fixture(),mods={attachments:[],modernizedParts:[fx.install("pistoletnaya-rukoyat","base",0),fx.install("uluchshennaya-pistoletnaya-rukoyat","improved",0)]};
  const host={id:fx.host.id,actorUuid:fx.actor.uuid,source:fx.host.toObject()},result=build({host,mods});
  assert.equal(result.contributions.filter(c=>c.kind==="attack-bonus").reduce((sum,c)=>sum+c.value,0),2);
  assert.equal(new Set(result.contributions.map(c=>c.key)).size,result.contributions.length);
  assert.equal(result.contributions.every(c=>c.actorUuid==="Actor.a" && c.hostItemId==="host" && c.childItemId),true);
  const saw=fx.install("obrezka-stvola","saw",0),system=structuredClone(fx.host._source.system);system.properties=new Set(system.properties);
  const before=structuredClone(fx.host.toObject()),projection=build({host,mods:{attachments:[],modernizedParts:[saw]}});
  apply(system,projection.contributions,{itemId:host.id});
  assert.equal(system.damage.base.denomination,8);assert.equal(system.damage.base.number,2);assert.deepEqual(system.damage.extra,before.system.damage.extra);
  assert.equal(system.properties.has("two"),false);assert.deepEqual(system.range,{value:50,long:170,units:"ft"});assert.deepEqual(fx.host.toObject(),before);
});
test("custom damage is diagnosed and negative canonical body deltas clamp safely",()=>{
  const fx=fixture({weight:{value:2,units:"lb"}}),part=fx.install("obrezka-stvola","saw",0);
  fx.host._source.system.damage.base.custom={enabled:true,formula:"@custom.dice + 1d4"};
  const host={id:fx.host.id,actorUuid:fx.actor.uuid,source:fx.host.toObject()},result=build({host,mods:{attachments:[],modernizedParts:[part]}});
  assert.ok(result.diagnostics.some(d=>d.code==="saw-off-custom-damage"));
  const system=structuredClone(host.source.system);system.properties=new Set(system.properties);apply(system,result.contributions,{itemId:host.id});
  assert.equal(system.damage.base.denomination,10);assert.equal(system.damage.base.custom.formula,"@custom.dice + 1d4");assert.equal(system.weight.value,0);
  const light=fx.install("fonarik","light",2,["side-1"]),withAttachment=build({host,mods:{attachments:[light],modernizedParts:[part]}}),next=structuredClone(host.source.system);next.properties=new Set(next.properties);
  apply(next,withAttachment.contributions,{itemId:host.id});assert.equal(next.weight.value,2);
});
test("the MODS projection exposes the saw-off manual-formula warning without rewriting authored damage",async()=>{
  const fx=fixture({gearId:catalog.hosts.find(row=>row.modelTags.includes("shotgun")).gearId});fx.install("obrezka-stvola","saw",0);
  fx.host._source.system.damage.base.custom={enabled:true,formula:"@custom.dice + 1d4"};
  const before=fx.host.toObject(),service=new ItemUpgradeService({itemUpgradeAutomationService:fx.service},{getWeaponModCatalog:async()=>catalog});
  const projection=await service.getWeaponModsProjection(fx.host);
  assert.ok(projection.diagnostics.some(d=>d.code==="saw-off-custom-damage" && d.reason.includes("мастер")));
  assert.deepEqual(fx.host.toObject(),before);
  const worldItem={...fx.host,actor:null,parent:null};assert.doesNotThrow(()=>worldItem.toObject());
  assert.equal((await service.getWeaponModsProjection(worldItem)).host.family,"advanced");
});
test("saw-off reports short form and its derived hand requirement becomes one without changing authored flags",async()=>{
  const shotgun=catalog.hosts.find(row=>row.modelTags.includes("shotgun")).gearId,fx=fixture({gearId:shotgun}),previous=globalThis.game;
  fx.host._source.flags[NS].handRequirement={requiredHands:2,allowedHands:[2],maxHands:2};fx.install("obrezka-stvola","saw",0);fx.prepare(fx.host);
  try{
    globalThis.game={rebreyaMain:{itemUpgradeAutomationService:fx.service}};
    assert.equal(getItemHandRequirement(fx.host).requiredHands,1);assert.equal(fx.host._source.flags[NS].handRequirement.requiredHands,2);
    const projection=await new ItemUpgradeService(null,{getWeaponModCatalog:async()=>catalog}).getWeaponModsProjection(fx.host);
    assert.equal(projection.host.form,"short");assert.equal(projection.host.modelTags.includes("long-firearm"),false);
    fx.host._source.flags[NS].handRequirement=2;assert.equal(getItemHandRequirement(fx.host).requiredHands,1);
    fx.host._source.flags[NS].weaponMods.modernizedParts=[];fx.prepare(fx.host);assert.equal(getItemHandRequirement(fx.host).requiredHands,2);
  }finally{globalThis.game=previous;}
});
test("saw-off cannot charge while leaving an installed long-firearm-only attachment on the new short host",()=>{
  const shotgun=catalog.hosts.find(row=>row.modelTags.includes("shotgun")).gearId,fx=fixture({gearId:shotgun}),part=fx.install("soshki","bipod",2,["bottom-1","barrel"]);
  assert.throws(()=>buildWeaponRebuildQuote({host:getHost(fx.host,catalog),component:makeCandidate("obrezka-stvola"),parts:[],attachments:[part],currency:{gp:500},gmApproval:true}),e=>e.code==="incompatible");
});

test("collimator speed override belongs only to verified live aim and expires with the turn",()=>{
  const fx=fixture(),previous=globalThis.game;fx.install("kollimatornyy-pritsel","optic",0,["top"]);
  fx.host._source.flags[NS].weaponModAim={actorUuid:fx.actor.uuid,hostItemId:fx.host.id,childItemId:"optic",mode:"collimator",combatId:"fight",round:1,turn:0,movedFeet:10};
  try{
    game={combat:{id:"fight",round:1,turn:0,combatant:{actor:fx.actor}}};
    const speed=fx.service.project(fx.actor).contributions.filter(c=>c.scope==="actor" && c.path.startsWith("system.attributes.movement."));
    assert.equal(speed.length,5);assert.ok(speed.every(c=>c.mode===5 && c.value===0));
    game.combat.turn=1;assert.equal(fx.service.project(fx.actor).contributions.filter(c=>c.scope==="actor").length,0);
    game.combat.turn=0;fx.host._source.flags[NS].weaponMods.attachments=[];
    assert.equal(fx.service.project(fx.actor).contributions.filter(c=>c.scope==="actor").length,0);
  }finally{globalThis.game=previous;}
});
