import test from "node:test";
import assert from "node:assert/strict";
import {makeCatalog,makeInstalled,gear,optionalModule,required,makeWeaponModMutationFixture,makeItem} from "./helpers/weapon-mod-fixture.mjs";
import {ItemUpgradeAutomationService} from "../scripts/automation/item-upgrade-automation-service.js";
import {createDnd5eItemData} from "../scripts/data/gear-compendium.js";
import {buildHeldItemHandUpdate} from "../scripts/integrations/held-items.js";
import {captureRuntimeItemGraph} from "../scripts/data/runtime-item-graph.js";
globalThis.CONST??={DOCUMENT_OWNERSHIP_LEVELS:{OBSERVER:2}};
const module=await optionalModule(new URL("../scripts/data/weapon-mod-activities.js",import.meta.url)),build=required(module,"buildWeaponModActivities"),spear=required(module,"buildWeaponModBayonetProfile"),reconcile=required(module,"reconcileWeaponModActivities"),NS="rebreya-main",catalog=makeCatalog();
const mods=(...ids)=>({attachments:ids.map((id,index)=>makeInstalled(id,`child${index}`)),modernizedParts:[]});

test("grenade activity preserves canonical packets, DC and radius and requires explicit missing save rules",()=>{
  const buildGrenade=required(module,"buildWeaponModGrenadeActivity"),source=gear.find(row=>row.id==="malaya-oskolochnaya-granata"),marker={hostItemId:"host",childItemId:"launcher",sourceId:"podstvol-nyy-granatomet",effectKey:"0",action:"launcher-shot"};
  assert.throws(()=>buildGrenade(marker,source,null),/мастер|спасброс/u);
  const data=buildGrenade(marker,source,{saveAbility:"dex",onSave:"none",manualSpecial:true});
  assert.deepEqual(data.save,{ability:["dex"],dc:{calculation:"",formula:"13"}});assert.equal(data.damage.onSave,"none");
  assert.deepEqual(data.damage.parts.map(part=>[part.custom.formula,part.types]),[["1d4",["piercing"]],["1d4",["fire"]]]);
  assert.equal(data.target.template.size,10);assert.equal(data.range.value,90);assert.deepEqual(data.consumption.targets,[]);
});
test("bayonet uses canonical spear without thrown and has a separate melee activity",()=>{
  const source=gear.find(row=>row.id==="kop-e"),before=structuredClone(source),profile=spear(source);
  assert.equal(profile.properties.has("thr"),false);assert.equal(profile.properties.has("ver"),true);assert.equal(profile.damageFormula,"1d6");assert.equal(profile.versatileDamageFormula,"1d8");assert.equal(profile.firearmAmmoSpent,0);assert.deepEqual(source,before);
  const activity=build({hostId:"host",mods:mods("shtyk"),sources:new Map(gear.map(row=>[row.id,row]))}).find(activity=>activity.flags[NS].weaponModActivity.action==="bayonet-attack");
  assert.equal(activity.type,"attack");assert.equal(activity.attack.type.value,"melee");assert.equal(activity.attack.ability,"str");assert.equal(activity.damage.includeBase,false);assert.deepEqual(activity.consumption.targets,[]);
});
test("flashlight and launcher activities expose source action costs, cone and independent six-round store",()=>{
  const activities=build({hostId:"host",mods:mods("fonarik","podstvol-nyy-granatomet")}),byAction=action=>activities.find(activity=>activity.flags[NS].weaponModActivity.action===action),light=byAction("flashlight-toggle"),load=byAction("launcher-load"),fire=byAction("launcher-fire");
  assert.equal(light.activation.type,"bonus");assert.equal(load.activation.type,"action");assert.equal(fire.range.value,90);assert.equal(fire.range.units,"ft");
  const profile=required(module,"buildWeaponModLightProfile")({bright:30,dim:60});assert.deepEqual([profile.distance,profile.bright,profile.dim,profile.angle],[60,30,60,60]);
  assert.equal(required(module,"WEAPON_MOD_LAUNCHER_CAPACITY"),6);assert.deepEqual(fire.consumption.targets,[]);
});
test("managed sync is idempotent, preserves foreign activities, foreign flags and current uses",()=>{
  const desired=build({hostId:"host",mods:mods("kollimatornyy-pritsel")}),foreign={_id:"authored",type:"damage",damage:{parts:[{custom:{enabled:true,formula:"@custom + 1d7"}}]}},current=structuredClone(desired);
  current[0].uses={max:"9",spent:3,recovery:[]};current[0].flags.foreign={kept:1};
  const result=reconcile([foreign,...current],desired);assert.deepEqual(result.activities.find(activity=>activity._id==="authored"),foreign);
  const own=result.activities.find(activity=>activity._id===current[0]._id);assert.equal(own.uses.spent,3);assert.equal(own.uses.max,"9");assert.equal(own.flags.foreign.kept,1);
  assert.deepEqual(reconcile(result.activities,desired),result);
  const removed=reconcile(result.activities,[]);assert.deepEqual(removed.activities,[foreign]);
});
test("managed sync preserves an authored formula override and reports it instead of replacing it",()=>{
  const desired=build({hostId:"host",mods:mods("shtyk"),sources:new Map(gear.map(row=>[row.id,row]))}),initial=reconcile([],desired).activities;
  initial[0].damage.parts[0].custom={enabled:true,formula:"@mySpear + 2d7"};
  const result=reconcile(initial,desired);assert.equal(result.activities[0].damage.parts[0].custom.formula,"@mySpear + 2d7");assert.equal(result.diagnostics[0].code,"customized-weapon-mod-activity");
  const extra=reconcile([],desired).activities;extra[0].damage.parts.push({custom:{enabled:true,formula:"1d7"}});assert.equal(reconcile(extra,desired).activities[0].damage.parts.length,2);
});

test("existing automation owner syncs managed actions and preserves native authored activities",async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1});try{
    fx.component.data.flags=makeItem("kollimatornyy-pritsel").flags;await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"optic",mountId:"top"});
    const foreign={_id:"authored",type:"damage",damage:{parts:[{custom:{enabled:true,formula:"1d7 + @custom"}}]}};fx.host.system.activities={authored:foreign};
    const automation=new ItemUpgradeAutomationService(fx.api,{isAuthority:()=>true,readActor:async uuid=>fx.actors.get(uuid)});automation.weaponModCatalog=fx.catalog;
    await automation.syncActor(fx.group);const first=structuredClone(fx.host.system.activities);assert.equal(Object.keys(first).length,3);assert.deepEqual(first.authored,foreign);
    await automation.syncActor(fx.group);assert.deepEqual(fx.host.system.activities,first);
    await fx.service.removeWeaponAttachment(fx.host,fx.component,{operationId:"remove-optic"});await automation.syncActor(fx.group);assert.deepEqual(fx.host.system.activities,{authored:foreign});
  }finally{fx.restore();}
});

test("flashlight keeps foreign Token light and uses one separately owned native cone that follows the Token",async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1}),previousScenes=globalThis.game?.scenes;try{
    fx.component.data.flags=makeItem("fonarik").flags;await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"light",mountId:"side-1"});
    const sourceLight={bright:5,dim:10,angle:360,color:"#ff0000"},scene={id:"s",uuid:"Scene.s",grid:{size:100,units:"ft"},lights:{contents:[]}},token={uuid:"Scene.s.Token.t",id:"t",actor:fx.group,parent:scene,x:100,y:200,width:1,height:1,rotation:45,elevation:0,light:structuredClone(sourceLight)};
    scene.createEmbeddedDocuments=async(type,rows)=>{assert.equal(type,"AmbientLight");const result=rows.map(row=>{const doc={...structuredClone(row),id:row._id,toObject:()=>structuredClone(Object.fromEntries(Object.entries(doc).filter(([,value])=>typeof value!=="function"))),async update(patch){Object.assign(doc,structuredClone(patch));},async delete(){scene.lights.contents=scene.lights.contents.filter(value=>value!==doc);}};scene.lights.contents.push(doc);return doc;});return result;};
    const resolve=globalThis.fromUuid;globalThis.fromUuid=async uuid=>uuid===token.uuid?token:resolve(uuid);game.scenes={contents:[scene]};
    const projection=await fx.service.getWeaponModsProjection(fx.host),activity=build({hostId:fx.host.id,mods:projection}).find(activity=>activity.flags[NS].weaponModActivity.action==="flashlight-toggle");fx.host.system.activities={[activity._id]:activity};
    // Boundary fixture exposes native Collection.get after source writes.
    const attachGet=()=>Object.defineProperty(fx.host.system.activities,"get",{enumerable:false,configurable:true,value:id=>fx.host.system.activities[id]});attachGet();
    const automation=new ItemUpgradeAutomationService(fx.api,{isAuthority:()=>true,readActor:async uuid=>fx.actors.get(uuid)});automation.weaponModCatalog=fx.catalog;fx.api.itemUpgradeAutomationService=automation;
    const payload={actorUuid:fx.group.uuid,hostItemId:fx.host.id,childItemId:fx.component.id,activityId:activity._id,operationId:"on",decision:{kind:"light-token",tokenUuid:token.uuid}};
    await fx.service.useWeaponModActivity(payload,{sender:fx.sender});assert.equal(scene.lights.contents.length,1);let light=scene.lights.contents[0];assert.deepEqual([light.config.bright,light.config.dim,light.config.angle,light.rotation],[30,60,60,45]);assert.deepEqual(token.light,sourceLight);
    light.config.color="#ffee00";light.flags.foreign={kept:1};
    token.x=300;token.rotation=90;await automation.syncActor(fx.group);light=scene.lights.contents[0];assert.equal(light.x,350);assert.equal(light.rotation,90);assert.equal(scene.lights.contents.length,1);assert.equal(light.config.color,"#ffee00");assert.equal(light.flags.foreign.kept,1);
    token.light.bright=120;attachGet();await fx.service.useWeaponModActivity({...payload,operationId:"off",decision:null},{sender:fx.sender});assert.equal(scene.lights.contents.length,0);assert.equal(token.light.bright,120);
    attachGet();await fx.service.useWeaponModActivity({...payload,operationId:"on-again"},{sender:fx.sender});assert.equal(scene.lights.contents.length,1);
    token.actor=fx.hero;await automation.syncActor(fx.hero);assert.equal(scene.lights.contents.length,0);assert.equal(token.light.bright,120);
  }finally{if(globalThis.game)game.scenes=previousScenes;fx.restore();}
});

test("launcher loads one real grenade per action, mixes types up to six, and leaves the firearm magazine intact",async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1});try{
    fx.component.data.flags=makeItem("podstvol-nyy-granatomet").flags;await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"launcher",mountId:"bottom-1"});
    fx.host.data.flags[NS].firearmAmmoState={current:9};
    const add=(sourceId,id,quantity)=>{const data=createDnd5eItemData(gear.find(row=>row.id===sourceId),new Map());data._id=id;data.system.quantity=quantity;const item=new Item(data,fx.group);fx.group.items.contents.push(item);return item;},first=add("malaya-oskolochnaya-granata","small",6),second=add("oskolochnaya-granat","regular",1),projection=await fx.service.getWeaponModsProjection(fx.host),load=build({hostId:fx.host.id,mods:projection}).find(activity=>activity.flags[NS].weaponModActivity.action==="launcher-load");
    fx.host.system.activities=new Map([[load._id,load]]);
    const payload={actorUuid:fx.group.uuid,hostItemId:fx.host.id,childItemId:fx.component.id,activityId:load._id,operationId:"load0",decision:{kind:"launcher-load",grenadeItemId:first.id}};
    const result=await fx.service.useWeaponModActivity(payload,{sender:fx.sender});assert.equal(first.system.quantity,5);assert.equal(fx.group.items.get(result.grenadeItemId).system.container,fx.component.id);
    assert.equal((await fx.service.useWeaponModActivity(payload,{sender:fx.sender})).replayed,true);assert.equal(first.system.quantity,5);
    for(let index=1;index<5;index++)await fx.service.useWeaponModActivity({...payload,operationId:`load${index}`},{sender:fx.sender});
    await fx.service.useWeaponModActivity({...payload,operationId:"different-type",decision:{kind:"launcher-load",grenadeItemId:second.id}},{sender:fx.sender});
    const loaded=fx.group.items.contents.filter(item=>item.system.container===fx.component.id);assert.equal(loaded.length,6);assert.ok(loaded.some(item=>item.getFlag(NS,"gearId")==="oskolochnaya-granat"));assert.equal(first.system.quantity,1);
    await assert.rejects(fx.service.useWeaponModActivity({...payload,operationId:"seventh"},{sender:fx.sender}),/6|шест/u);assert.equal(first.system.quantity,1);assert.deepEqual(fx.host.getFlag(NS,"firearmAmmoState"),{current:9});
    await fx.service.removeWeaponAttachment(fx.host,fx.component,{operationId:"detach-loaded"});assert.equal(loaded.filter(item=>item.system.container===fx.component.id).length,6);
  }finally{fx.restore();}
});

test("native bayonet attack works with an empty jammed firearm without spending rounds or rolling misfire",async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1});try{
    const nativeGun=createDnd5eItemData(gear.find(row=>row.id==="mushket"),new Map());Object.assign(fx.host.data,{...nativeGun,_id:fx.host.id});
    fx.component.data.flags=makeItem("shtyk").flags;await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"bayonet",mountId:"bottom-1"});await fx.host.update(buildHeldItemHandUpdate(["left","right"],fx.host));
    fx.host.data.flags[NS].firearmAmmoState={current:0};fx.host.data.flags[NS].firearmJammed=true;
    const projection=await fx.service.getWeaponModsProjection(fx.host),data=build({hostId:fx.host.id,mods:projection,sources:fx.catalog.gearById}).find(activity=>activity.type==="attack"),activity={...data,id:data._id,item:fx.host,actor:fx.group};fx.host.system.activities=new Map([[data._id,data]]);
    fx.api.itemUpgradeAutomationService={weaponModCatalog:fx.catalog,project:()=>({contributions:[]}),rolls:{preRollAttack:()=>true}};
    const service=fx.api.combatAttackService;assert.equal(service.getActivityAvailability(activity).available,true);assert.equal(service.applyDnd5ePreUseActivity(activity,{}, {},{}),true);
    assert.equal(service.applyDnd5eAttackRollConfig({subject:activity,rolls:[{parts:["@authored"]}]}),true);service.applyDnd5ePostAttackRoll([{total:15}],{subject:activity});
    assert.deepEqual(fx.host.getFlag(NS,"firearmAmmoState"),{current:0});assert.equal(fx.host.getFlag(NS,"firearmJammed"),true);
  }finally{fx.restore();}
});

test("bayonet native attack data delegates to a canonical spear model, preserving Actor bonuses and exhaustion",async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1});try{
    fx.component.data.flags=makeItem("shtyk").flags;await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"bayonet",mountId:"bottom-1"});
    const projection=await fx.service.getWeaponModsProjection(fx.host),data=build({hostId:fx.host.id,mods:projection,sources:fx.catalog.gearById}).find(activity=>activity.type==="attack"),snapshot=fx.host.toObject(),activity={...data,id:data._id,item:fx.host,actor:fx.group,getAttackData:()=>({parts:["wrong firearm proficiency"]})};
    snapshot.system.activities={[data._id]:data};fx.host.toObject=()=>structuredClone(snapshot);fx.host.system.activities=new Map([[data._id,activity]]);
    const captured=[],nativeResult={parts:["@str","@spearProf","@nativeActorBonus","@nativeExhaustion"],data:{prof:2}},damageResult={rolls:[{base:true,parts:["1d6","@mod"]}]};
    activity.getDamageConfig=()=>({rolls:[{parts:["wrong firearm damage"]}]});activity.rollAttack=async(config,dialog)=>{assert.equal(config.ammunition,false);assert.deepEqual(dialog.options.ammunitionOptions,[]);return nativeResult;};
    activity._buildAttackConfig=(_process,config)=>{config.options={ammunition:"bullets",attackMode:"thrown"};};
    const automation=new ItemUpgradeAutomationService(fx.api,{createNativeItem:(nativeData,actor)=>{captured.push({nativeData,actor});return {prepareData(){},system:{prof:{hasProficiency:true},activities:new Map([[data._id,{getAttackData:()=>nativeResult,getDamageConfig:config=>{assert.equal(config.ammunition,false);return damageResult;},rollAttack:async config=>{assert.equal(config.ammunition,false);return nativeResult;}}]])}};}});automation.weaponModCatalog=fx.catalog;fx.api.itemUpgradeAutomationService=automation;
    automation.applyWeaponModActivityRuntime(fx.host);assert.deepEqual(activity.getAttackData({situational:"@custom"}),nativeResult);
    assert.equal(captured[0].actor,fx.group);assert.equal(captured[0].nativeData.flags[NS].gearId,"kop-e");assert.equal(captured[0].nativeData.system.properties.includes("thr"),false);
    assert.equal(captured[0].nativeData._id,fx.host.id);assert.equal(captured[0].nativeData.system.activities[data._id].damage.includeBase,true);
    assert.deepEqual(activity.getDamageConfig({ammunition:{system:{damage:{}}}}),damageResult);assert.deepEqual(await activity.rollAttack({ammunition:"bullets"}),nativeResult);
    const roll={};activity._buildAttackConfig({},roll);assert.equal(Boolean(roll.options.ammunition),false);assert.equal(roll.options.attackMode.startsWith("thrown"),false);
    assert.equal(automation.getWeaponModActivityProficiency(activity),true);assert.equal(fx.host.getFlag(NS,"gearId"),"vintovka");
  }finally{fx.restore();}
});

test("native managed utility returns false synchronously and sends one owned-instance command",async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1});try{
    fx.component.data.flags=makeItem("kollimatornyy-pritsel").flags;await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"optic",mountId:"top"});
    const projection=await fx.service.getWeaponModsProjection(fx.host),data=build({hostId:fx.host.id,mods:projection}).find(activity=>activity.flags[NS].weaponModActivity.action==="stop-aim"),activity={...data,id:data._id,item:fx.host,actor:fx.group},calls=[];fx.host.system.activities=new Map([[data._id,data]]);
    fx.api.itemUpgradeAutomationService={weaponModCatalog:fx.catalog};fx.api.useWeaponModActivity=async payload=>{calls.push(payload);return {action:"stop-aim"};};
    const service=fx.api.combatAttackService;assert.equal(service.applyDnd5ePreUseActivity(activity),false);assert.equal(service.applyDnd5ePreUseActivity(activity),false);await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(calls.length,1);assert.equal(calls[0].actorUuid,fx.group.uuid);assert.equal(calls[0].childItemId,fx.component.id);assert.equal(calls[0].activityId,data._id);assert.equal(calls[0].decision,null);
    fx.api.useWeaponModActivity=async payload=>{calls.push(payload);const error=Error("Отмена мастером");error.code="weapon-mod-cancelled";throw error;};
    service.applyDnd5ePreUseActivity(activity);await new Promise(resolve=>setTimeout(resolve,0));service.applyDnd5ePreUseActivity(activity);await new Promise(resolve=>setTimeout(resolve,0));assert.notEqual(calls[1].operationId,calls[2].operationId);
  }finally{fx.restore();}
});

test("utility publication retries its durable action without loading or paying twice",async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1});try{
    fx.component.data.flags=makeItem("podstvol-nyy-granatomet").flags;await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"launcher",mountId:"bottom-1"});
    const grenadeData=createDnd5eItemData(gear.find(row=>row.id==="malaya-oskolochnaya-granata"),new Map());grenadeData._id="grenades";grenadeData.system.quantity=3;const grenade=new Item(grenadeData,fx.group);fx.group.items.contents.push(grenade);
    const projection=await fx.service.getWeaponModsProjection(fx.host),data=build({hostId:fx.host.id,mods:projection}).find(activity=>activity.flags[NS].weaponModActivity.action==="launcher-load");fx.host.system.activities=new Map([[data._id,data]]);
    const payload={actorUuid:fx.group.uuid,hostItemId:fx.host.id,childItemId:fx.component.id,activityId:data._id,operationId:"load",decision:{kind:"launcher-load",grenadeItemId:grenade.id}},create=ChatMessage.create;
    ChatMessage.create=async()=>{throw Error("card unavailable");};await assert.rejects(fx.service.useWeaponModActivity(payload,{sender:fx.sender}),/card unavailable/u);assert.equal(grenade.system.quantity,2);
    ChatMessage.create=create;const result=await fx.service.useWeaponModActivity(payload,{sender:fx.sender});assert.equal(result.replayed,true);assert.equal(grenade.system.quantity,2);
    const card=[...fx.cards.values()].find(card=>card.flags?.[NS]?.weaponModAction?.operationId==="load");assert.equal(card.flags[NS].weaponModAction.activation.type,"action");assert.equal(fx.cards.size,2);
  }finally{fx.restore();}
});

test("launcher shot prepares without spending, consumes its exact physical grenade once, then acknowledges a native card",async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1});try{
    fx.component.data.flags=makeItem("podstvol-nyy-granatomet").flags;await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"launcher",mountId:"bottom-1"});
    const data=createDnd5eItemData(gear.find(row=>row.id==="malaya-oskolochnaya-granata"),new Map());data._id="loaded";data.system.quantity=1;data.system.container=fx.component.id;
    const grenade=new Item(data,fx.group);fx.group.items.contents.push(grenade);fx.host.data.flags[NS].firearmAmmoState={current:7};
    const projection=await fx.service.getWeaponModsProjection(fx.host),fire=build({hostId:fx.host.id,mods:projection}).find(activity=>activity.flags[NS].weaponModActivity.action==="launcher-fire");fx.host.system.activities={[fire._id]:fire};
    const payload={actorUuid:fx.group.uuid,hostItemId:fx.host.id,childItemId:fx.component.id,activityId:fire._id,operationId:"prepare",decision:{kind:"launcher-prepare",grenadeItemId:grenade.id}};
    fx.service.resolveWeaponModGrenadeRule=async()=>null;
    await assert.rejects(fx.service.useWeaponModActivity(payload,{sender:fx.sender}),error=>error.code==="weapon-mod-cancelled");assert.equal(grenade.system.quantity,1);
    fx.service.resolveWeaponModGrenadeRule=async()=>({saveAbility:"dex",onSave:"half",manualSpecial:true});
    const prepared=await fx.service.useWeaponModActivity(payload,{sender:fx.sender});assert.equal(grenade.system.quantity,1);assert.equal(prepared.shot.grenadeItemId,grenade.id);
    const shotData=fx.host.system.activities[prepared.shot.activityId];assert.equal(shotData.type,"save");assert.equal(shotData.damage.parts.length,2);
    const consume={...payload,activityId:shotData._id,operationId:"consume",decision:{kind:"launcher-consume",prepareOperationId:"prepare",grenadeItemId:grenade.id}};
    const nextGm={id:"next-gm",active:true,isGM:true};
    fx.failAt("equip","after",()=>{game.users.set(nextGm.id,nextGm);game.users.activeGM=nextGm;});
    await assert.rejects(fx.service.useWeaponModActivity(consume,{sender:fx.sender}),/мастер/u);assert.equal(grenade.system.quantity,0);assert.equal(fx.host.getFlag(NS,"weaponModShot").phase,"prepared");
    game.user=nextGm;
    const spent=await fx.service.useWeaponModActivity(consume,{sender:fx.sender});assert.equal(grenade.system.quantity,0);assert.equal(grenade.system.container??null,null);assert.equal(spent.shot.phase,"consumed");
    assert.equal((await fx.service.useWeaponModActivity(consume,{sender:fx.sender})).replayed,true);assert.deepEqual(fx.host.getFlag(NS,"firearmAmmoState"),{current:7});
    assert.throws(()=>captureRuntimeItemGraph(fx.group,fx.host),/карточ/u);
    await assert.rejects(fx.service.useWeaponModActivity({...consume,operationId:"duplicate"},{sender:fx.sender}),/израсход|выстрел/u);
    await assert.rejects(fx.service.useWeaponModActivity({...payload,operationId:"blocked"},{sender:fx.sender}),/карточ|выстрел/u);
    const card={_id:spent.shot.cardId,flags:{[NS]:{weaponModShot:spent.shot}}};fx.cards.set(card._id,card);
    const ack={...payload,activityId:shotData._id,operationId:"ack",decision:{kind:"launcher-ack",prepareOperationId:"prepare",cardId:card._id}};
    const originalName=grenade.name;grenade.data.name="Чужая правка после выстрела";
    await assert.rejects(fx.service.useWeaponModActivity(ack,{sender:fx.sender}),/сверк|измен/u);assert.equal(fx.group.items.get(grenade.id),grenade);grenade.data.name=originalName;
    await fx.service.useWeaponModActivity(ack,{sender:fx.sender});assert.equal(fx.group.items.get(grenade.id),undefined);assert.equal(fx.host.getFlag(NS,"weaponModShot").phase,"published");
    assert.equal((await fx.service.useWeaponModActivity(ack,{sender:fx.sender})).replayed,true);
  }finally{fx.restore();}
});

test("native launcher clone awaits one journal debit, publishes one card after ambiguous success, and never resumes a second shot",async()=>{
  const fx=await makeWeaponModMutationFixture({quantity:1});try{
    fx.component.data.flags=makeItem("podstvol-nyy-granatomet").flags;await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"launcher",mountId:"bottom-1"});
    const data=createDnd5eItemData(gear.find(row=>row.id==="oskolochnaya-granat"),new Map());data._id="loaded";data.system.quantity=1;data.system.container=fx.component.id;const grenade=new Item(data,fx.group);fx.group.items.contents.push(grenade);
    const projection=await fx.service.getWeaponModsProjection(fx.host),fire=build({hostId:fx.host.id,mods:projection}).find(activity=>activity.flags[NS].weaponModActivity.action==="launcher-fire");fx.host.system.activities={[fire._id]:fire};
    fx.service.resolveWeaponModGrenadeRule=async()=>({saveAbility:"dex",onSave:"none",manualSpecial:true});
    const prepared=await fx.service.useWeaponModActivity({actorUuid:fx.group.uuid,hostItemId:fx.host.id,childItemId:fx.component.id,activityId:fire._id,operationId:"native",decision:{kind:"launcher-prepare",grenadeItemId:grenade.id}},{sender:fx.sender});
    const calls=[],native=fx.host.system.activities[prepared.shot.activityId],clone={id:fx.host.id,actor:fx.group,parent:fx.group},activity={...native,id:native._id,item:clone,actor:fx.group,
      async consume(){calls.push("native-consume");return {rolls:[]};},async _createUsageMessage(config){calls.push("native-card-data");assert.equal(config.create,false);return config.data;}};
    clone.system={activities:new Map([[activity.id,activity]])};
    const automation=new ItemUpgradeAutomationService(fx.api);automation.weaponModCatalog=fx.catalog;fx.api.itemUpgradeAutomationService=automation;fx.api.useWeaponModActivity=p=>fx.service.useWeaponModActivity(p,{sender:fx.sender});
    automation.applyWeaponModActivityRuntime(clone);const message={data:{}},usage={rebreyaWeaponModShot:prepared.shot};
    assert.deepEqual(await activity.consume(usage,message),{rolls:[]});assert.equal(grenade.system.quantity,0);assert.equal(calls.filter(x=>x==="native-consume").length,1);
    const expectedGrenade=structuredClone(prepared.grenadeSource);expectedGrenade.system.quantity=0;expectedGrenade.system.container=null;expectedGrenade.flags[NS].weaponModSpent={prepareOperationId:prepared.shot.prepareOperationId,cardId:prepared.shot.cardId,sourceId:prepared.shot.projectileSourceId};
    const actualGrenade=grenade.toObject();if(expectedGrenade.folder==null)delete expectedGrenade.folder;if(actualGrenade.folder==null)delete actualGrenade.folder;assert.deepEqual(actualGrenade,expectedGrenade);
    fx.chatWriteThenThrow();const card=await activity._createUsageMessage(message);assert.equal(card._id,prepared.shot.cardId);assert.equal(fx.cards.size,2);
    assert.equal(await activity.consume(usage,{data:{}}),false);assert.equal(calls.filter(x=>x==="native-consume").length,1);assert.equal(fx.group.items.get(grenade.id),undefined);
    fx.cards.delete(prepared.shot.cardId);assert.equal(await activity.consume(usage,{data:{}}),false);assert.equal(calls.filter(x=>x==="native-consume").length,1);
  }finally{fx.restore();}
});
