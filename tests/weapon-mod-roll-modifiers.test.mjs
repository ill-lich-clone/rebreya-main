import test from "node:test";
import assert from "node:assert/strict";
import {optionalModule,required,makeAttackCase,makeWeaponModMutationFixture,makeItem} from "./helpers/weapon-mod-fixture.mjs";
import {SimpleUpgradeRollAdapter} from "../scripts/integrations/item-upgrade-roll-adapter.js";
import {CombatAttackService} from "../scripts/combat/attack-service.js";
const module=await optionalModule(new URL("../scripts/automation/weapon-mod-roll-modifiers.js",import.meta.url)),evaluate=required(module,"evaluateWeaponModAttack"),resolve=required(module,"resolveWeaponModConditions");
test("collimator ten versus eleven feet and scope requires no movement",()=>{
  const collimator=evaluate(makeAttackCase("kollimatornyy-pritsel",{movedFeet:10}));assert.equal(collimator.allowed,true);assert.equal(collimator.stopMovement,true);assert.equal(collimator.ignoreHalfCover,true);
  assert.equal(evaluate(makeAttackCase("kollimatornyy-pritsel",{movedFeet:11})).allowed,false);
  assert.equal(evaluate(makeAttackCase("opticheskiy-pritsel",{movedFeet:0})).rangeMultiplier,2);
  assert.equal(evaluate(makeAttackCase("opticheskiy-pritsel",{movedFeet:.1})).allowed,false);
  assert.equal(evaluate(makeAttackCase("opticheskiy-pritsel",{aimMode:null})).rangeMultiplier,1);
});
test("laser requires this target visibility and proficiency, unrelated unknown facts do not prompt",()=>{
  assert.equal(evaluate(makeAttackCase("lazernyy-tseleukazatel")).attackBonus,1);
  assert.equal(evaluate(makeAttackCase("lazernyy-tseleukazatel",{usesProficiency:false})).attackBonus,0);
  assert.equal(evaluate(makeAttackCase("lazernyy-tseleukazatel",{targetVisible:false})).attackBonus,0);
  assert.equal(evaluate(makeAttackCase("lazernyy-tseleukazatel",{targetVisible:null,usesProficiency:false})).needsDecision.length,0);
  const unknown=evaluate(makeAttackCase("lazernyy-tseleukazatel",{targetVisible:null}));assert.equal(unknown.attackBonus,0);assert.equal(unknown.needsDecision.some(entry=>entry.field==="targetVisible"),true);
});
test("stock and bipod prone rules are opposite and passive grips sum to two",()=>{
  assert.equal(evaluate(makeAttackCase("priklad",{prone:false})).attackBonus,1);assert.equal(evaluate(makeAttackCase("priklad",{prone:true})).attackBonus,0);
  assert.equal(evaluate(makeAttackCase("soshki",{prone:true})).attackBonus,2);assert.equal(evaluate(makeAttackCase("soshki",{prone:false})).attackBonus,0);
  const value=makeAttackCase("pistoletnaya-rukoyat");value.contributions.push(...makeAttackCase("uluchshennaya-pistoletnaya-rukoyat").contributions);
  assert.equal(evaluate(value).attackBonus,2);
});
test("underwater mode halves both ranges only underwater and never grants an unrelated weapon a valve",()=>{
  assert.equal(evaluate(makeAttackCase("podvodnyy-klapan",{underwater:true})).rangeMultiplier,.5);
  assert.equal(evaluate(makeAttackCase("podvodnyy-klapan",{underwater:false})).rangeMultiplier,1);
  assert.equal(evaluate(makeAttackCase("podvodnyy-klapan",{underwater:null})).needsDecision.some(entry=>entry.field==="underwater"),true);
  assert.equal(evaluate(makeAttackCase("priklad",{underwater:true})).allowed,false);
  const melee=makeAttackCase("priklad",{underwater:true});melee.attack.type="melee";assert.equal(evaluate(melee).allowed,true);
  const meleeValve=makeAttackCase("podvodnyy-klapan",{underwater:true});meleeValve.attack.type="melee";assert.equal(evaluate(meleeValve).rangeMultiplier,1);
});
test("decisions fill only unknown authoritative facts and bind to the concrete target/attack",()=>{
  const known={movedFeet:null,prone:false,targetVisible:null,usesProficiency:true,underwater:false,aimMode:null},decision={kind:"attack-conditions",targetUuid:"Token.a",attackMessageId:"card",movedFeet:10,prone:false,targetVisible:true,usesProficiency:true,underwater:false,aimMode:null};
  assert.deepEqual(resolve(known,decision,{targetUuid:"Token.a",attackMessageId:"card"}),{...known,movedFeet:10,targetVisible:true});
  assert.throws(()=>resolve(known,{...decision,prone:true},{targetUuid:"Token.a",attackMessageId:"card"}),e=>e.code==="condition-conflict");
  assert.throws(()=>resolve(known,decision,{targetUuid:"Token.b",attackMessageId:"card"}),e=>e.code==="condition-context-conflict");
  assert.throws(()=>resolve(known,decision,{targetUuid:"Token.a",attackMessageId:"other"}),e=>e.code==="condition-context-conflict");
});
test("native adapter adds a passive bonus once and refuses mixed visibility targets before rolling",()=>{
  const base=makeAttackCase("lazernyy-tseleukazatel"),actor={uuid:"Actor.a"},item={id:"host",type:"weapon",actor},activity={item,actionType:"rwak"},warnings=[];
  const service={project:()=>({contributions:base.contributions}),moduleApi:{combatAttackService:{getWeaponModAttackConditions:(_activity,target)=>({...base.conditions,targetVisible:target.visible})}}};
  const adapter=new SimpleUpgradeRollAdapter(service,{warn:message=>warnings.push(message)}),config={subject:activity,targets:[{visible:true,actor:{system:{},statuses:new Set()}}],rolls:[{parts:["@mod"]}]};
  assert.equal(adapter.preRollAttack(config),true);assert.deepEqual(config.rolls[0].parts,["@mod","1"]);adapter.preRollAttack(config);assert.deepEqual(config.rolls[0].parts,["@mod","1"]);
  const mixed={subject:activity,targets:[{visible:true,actor:{system:{},statuses:new Set()}},{visible:false,actor:{system:{},statuses:new Set()}}],rolls:[{parts:["@mod"]}]};
  assert.equal(adapter.preRollAttack(mixed),false);assert.deepEqual(mixed.rolls[0].parts,["@mod"]);assert.equal(warnings.length,1);
});
test("native scope ignores exactly half cover and leaves three-quarter cover intact",()=>{
  const base=makeAttackCase("opticheskiy-pritsel"),actor={uuid:"Actor.a"},item={id:"host",type:"weapon",actor},activity={item,actionType:"rwak"},service={project:()=>({contributions:base.contributions}),
    moduleApi:{combatAttackService:{getWeaponModAttackConditions:()=>base.conditions}}},adapter=new SimpleUpgradeRollAdapter(service);
  for(const [status,bonus] of [["coverHalf",2],["coverThreeQuarters",0]]){
    const config={subject:activity,targets:[{actor:{system:{},statuses:new Set([status])}}],rolls:[{parts:[]}]};
    assert.equal(adapter.preRollAttack(config),true);assert.deepEqual(config.rolls[0].parts,bonus?[String(bonus)]:[]);
    assert.equal(config.rolls[0].options.rebreyaWeaponMods.rangeMultiplier,2);
  }
});
test("optics use MIDI dynamic cover for this token pair and retain greater cover",()=>{
  const previous=globalThis.MidiQOL,base=makeAttackCase("opticheskiy-pritsel"),source={uuid:"Token.source"},actor={uuid:"Actor.a",getActiveTokens:()=>[source]},
    item={id:"host",type:"weapon",actor},activity={item,actionType:"rwak"},target={uuid:"Token.target",actor:{system:{attributes:{ac:{cover:0}}},statuses:new Set()}},
    service={project:()=>({contributions:base.contributions}),moduleApi:{combatAttackService:{getWeaponModAttackConditions:()=>base.conditions}}};
  let dynamic=2,calls=0;globalThis.MidiQOL={computeCoverBonus:(attacker,defender,subject)=>{calls++;assert.equal(attacker,source);assert.equal(defender,target);assert.equal(subject,activity);return dynamic;}};
  try{
    const adapter=new SimpleUpgradeRollAdapter(service),bonus=()=>adapter.evaluate(item,{primary:false},target,activity).attackBonus;
    assert.equal(bonus(),2);target.actor.statuses.add("coverHalf");target.actor.system.attributes.ac.cover=2;
    dynamic=5;assert.equal(bonus(),0);dynamic=Infinity;assert.equal(bonus(),0);
    dynamic=0;assert.equal(bonus(),2);target.actor.statuses.add("coverTotal");assert.equal(bonus(),0);assert.equal(calls,4);
  }finally{globalThis.MidiQOL=previous;}
});

test("aim belongs to the actor, verified child and current combat turn, surviving client reload",()=>{
  const getAim=required(module,"getWeaponModAimState"),base=makeAttackCase("kollimatornyy-pritsel"),actor={uuid:"Actor.a"},host={id:"host",actor,flags:{"rebreya-main":{weaponModAim:{actorUuid:"Actor.a",hostItemId:"host",childItemId:base.contributions[0].childItemId,mode:"collimator",combatId:"fight",round:2,turn:0}}}},combat={id:"fight",round:2,turn:0,combatant:{actor}};
  assert.equal(getAim(host,combat,base.contributions).mode,"collimator");
  assert.equal(getAim(host,{...combat,turn:1},base.contributions),null);
  assert.equal(getAim({...host,actor:{uuid:"Actor.other"}},combat,base.contributions),null);
  assert.equal(getAim(host,combat,[]),null);
  assert.equal(getAim(host,null,base.contributions),null);
});

test("combat conditions read native proficiency and prone state without guessing visibility or movement",()=>{
  const actor={uuid:"Actor.a",statuses:new Set(["prone"]),flags:{}},item={id:"host",actor,system:{prof:{hasProficiency:false}}},service=new CombatAttackService({itemUpgradeAutomationService:{project:()=>({contributions:[]})}}),activity={item,actor};
  const conditions=service.getWeaponModAttackConditions(activity,{uuid:"Token.t",actor:{statuses:new Set()}},{});
  assert.equal(conditions.prone,true);assert.equal(conditions.usesProficiency,false);assert.equal(conditions.movedFeet,null);assert.equal(conditions.targetVisible,null);assert.equal(conditions.aimMode,null);
});

test("unknown-condition cancellation resumes no roll and touches no authored roll parts",async()=>{
  const fx=await makeWeaponModMutationFixture();try{
  const base=makeAttackCase("lazernyy-tseleukazatel"),actor=fx.group,item=fx.host,calls=[],activity={item,actor,rollAttack:async()=>calls.push("roll")};
  item.system.prof={hasProficiency:true};base.contributions.forEach(c=>c.hostItemId=item.id);
  const service=new CombatAttackService({itemUpgradeAutomationService:{project:()=>({contributions:base.contributions})}});
  let prompted=0;service.promptWeaponModConditions=async()=>{prompted++;return null;};
  const config={subject:activity,targets:[{uuid:"Token.t"}],rolls:[{parts:["@authored"]}]};
  assert.equal(service.deferWeaponModAttack(activity,config,{}, {},"rollAttack"),false);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(prompted,1);assert.deepEqual(calls,[]);assert.deepEqual(config.rolls[0].parts,["@authored"]);
  }finally{fx.restore();}
});

test("managed aim validates actual installed child, own turn and atomic replay",async()=>{
  const definitions=await optionalModule(new URL("../scripts/data/weapon-mod-activities.js",import.meta.url)),build=required(definitions,"buildWeaponModActivities"),fx=await makeWeaponModMutationFixture({quantity:1});
  try{
    const source=makeItem("kollimatornyy-pritsel");fx.component.data.flags=source.flags;
    await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"mount-optic",mountId:"top"});
    const projection=await fx.service.getWeaponModsProjection(fx.host),activities=build({hostId:fx.host.id,mods:projection}),aim=activities.find(activity=>activity.flags["rebreya-main"].weaponModActivity.action==="aim");
    fx.host.system.activities=new Map([[aim._id,aim]]);game.combat={id:"fight",round:2,turn:0,combatant:{actor:fx.group}};
    fx.group.flags["rebreya-main"].weaponModMovement={combatId:"fight",round:2,turn:0,feet:10};
    const payload={actorUuid:fx.group.uuid,hostItemId:fx.host.id,childItemId:fx.component.id,activityId:aim._id,operationId:"aim",decision:null};
    await fx.service.useWeaponModActivity(payload,{sender:fx.sender});
    const state=structuredClone(fx.host.flags["rebreya-main"].weaponModAim);assert.equal(state.mode,"collimator");assert.equal(state.movedFeet,10);
    const again=await fx.service.useWeaponModActivity(payload,{sender:fx.sender});assert.equal(again.replayed,true);assert.deepEqual(fx.host.flags["rebreya-main"].weaponModAim,state);
    game.combat.turn=1;game.combat.combatant={actor:fx.hero};
    await assert.rejects(fx.service.useWeaponModActivity({...payload,operationId:"other-turn"},{sender:fx.sender}),/сво[её]м ходу/u);
    game.combat.turn=0;game.combat.combatant={actor:fx.group};fx.host.system.activities.delete(aim._id);
    await assert.rejects(fx.service.useWeaponModActivity({...payload,operationId:"forged"},{sender:fx.sender}),/действие|Действие/u);
  }finally{fx.restore();}
});

test("turn lifecycle records native path distance once and clears aim after movement or turn end",async()=>{
  const fx=await makeWeaponModMutationFixture(),combat={id:"fight",round:2,turn:0,combatants:{contents:[{actor:fx.group},{actor:fx.hero}]}};
  combat.combatant={actor:fx.group,token:{id:"token",x:0,y:0}};game.combat=combat;
  try{
    const service=fx.api.combatAttackService;
    await service.handleWeaponModTurnChange(combat);
    assert.equal(fx.group.getFlag("rebreya-main","weaponModMovement").feet,0);
    const token={id:"token",actor:fx.group,parent:{grid:{units:"ft"}},x:100,y:0,movement:{id:"path1",passed:{distance:10,waypoints:[]}}};
    await service.handleWeaponModTokenMove(token,{x:100});await service.handleWeaponModTokenMove(token,{x:100});
    assert.equal(fx.group.getFlag("rebreya-main","weaponModMovement").feet,10);
    fx.host.data.flags["rebreya-main"].weaponModAim={combatId:"fight",round:2,turn:0};
    token.x=200;token.movement.id="path2";token.movement.passed.distance=5;
    await service.handleWeaponModTokenMove(token,{x:200});assert.equal(fx.host.getFlag("rebreya-main","weaponModAim"),undefined);
    fx.host.data.flags["rebreya-main"].weaponModAim={combatId:"fight",round:2,turn:0};
    combat.turn=1;combat.combatant={actor:fx.hero};await service.handleWeaponModTurnChange(combat);
    assert.equal(fx.host.getFlag("rebreya-main","weaponModAim"),undefined);
  }finally{fx.restore();}
});

test("native conditional range changes roll disadvantage and blocks beyond the effective long range",()=>{
  const grid={size:100,distance:5,type:1,units:"ft"},source={x:0,y:0,width:1,height:1,parent:{grid}},target={x:1800,y:0,width:1,height:1,parent:{grid}},actor={token:source},item={actor,system:{range:{value:60,long:180,units:"ft"}}},service=new CombatAttackService({});
  assert.equal(service.getWeaponModRangeResolution({item},target,2).disadvantage,false);
  const underwater=service.getWeaponModRangeResolution({item},target,.5);assert.equal(underwater.disadvantage,true);assert.equal(underwater.allowed,true);
  target.x=1900;assert.equal(service.getWeaponModRangeResolution({item},target,.5).allowed,false);
  assert.deepEqual(item.system.range,{value:60,long:180,units:"ft"});
});

test("resolved native roll resumes once with authored parts and target-specific facts preserved",async()=>{
  const fx=await makeWeaponModMutationFixture();try{
  const base=makeAttackCase("lazernyy-tseleukazatel"),actor=fx.group,item=fx.host,resumes=[],service=new CombatAttackService({itemUpgradeAutomationService:{project:()=>({contributions:base.contributions})}}),activity={item,actor,rollAttack:async(config)=>resumes.push(config)};
  item.system.prof={hasProficiency:true};base.contributions.forEach(c=>c.hostItemId=item.id);
  service.promptWeaponModConditions=async(_a,target,known)=>({kind:"attack-conditions",targetUuid:target.uuid,attackMessageId:null,...known,targetVisible:true});
  const config={subject:activity,targets:[{uuid:"Token.a"}],hookNames:["caller","attack","d20Test"],rolls:[{parts:["@authored"],options:{criticalSuccess:19}}]};
  assert.equal(service.deferWeaponModAttack(activity,config,{}, {},"rollAttack"),false);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(resumes.length,1);assert.deepEqual(resumes[0].rolls[0].parts,["@authored"]);assert.equal(resumes[0].rolls[0].options.criticalSuccess,19);assert.deepEqual(resumes[0].hookNames,["caller"]);
  assert.equal(service.getWeaponModAttackConditions(activity,{uuid:"Token.a"},resumes[0]).targetVisible,true);
  assert.equal(service.getWeaponModAttackConditions(activity,{uuid:"Token.b"},resumes[0]).targetVisible,null);
  }finally{fx.restore();}
});

test("native use stores decisions on its own originating card, never on the shared activity",async()=>{
  const fx=await makeWeaponModMutationFixture();try{
    const base=makeAttackCase("lazernyy-tseleukazatel"),resumes=[];base.contributions.forEach(c=>c.hostItemId=fx.host.id);fx.host.system.prof={hasProficiency:true};
    const service=new CombatAttackService({itemUpgradeAutomationService:{project:()=>({contributions:base.contributions})}}),activity={uuid:"Actor.g.Item.weapon.Activity.a",item:fx.host,actor:fx.group,use:async(...args)=>resumes.push(args)};
    service.promptWeaponModConditions=async(_a,target,known)=>({kind:"attack-conditions",targetUuid:target.uuid,attackMessageId:null,...known,targetVisible:true});
    service.deferWeaponModAttack(activity,{targets:[{uuid:"Token.a"}]},{},{data:{flags:{foreign:{retained:1}}}},"use");await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(resumes.length,1);const stored=resumes[0][2].data.flags["rebreya-main"].weaponModConditions;assert.equal(resumes[0][2].data.flags.foreign.retained,1);
    const card={id:"card",getFlag:(scope,key)=>scope==="dnd5e"?activity.uuid:stored};game.messages={get:id=>id==="card"?card:null};
    const config={subject:activity};service.hydrateWeaponModAttackConditions(config,{data:{"flags.dnd5e.originatingMessage":"card"}});
    assert.equal(service.getWeaponModAttackConditions(activity,{uuid:"Token.a"},config).targetVisible,true);
    const other={subject:{...activity,uuid:"Activity.other"}};service.hydrateWeaponModAttackConditions(other,{data:{"flags.dnd5e.originatingMessage":"card"}});assert.equal(other.rebreyaWeaponModDecisions,undefined);
    assert.equal(service.getWeaponModAttackConditions(activity,{uuid:"Token.a"},{}).targetVisible,null);
  }finally{fx.restore();}
});
