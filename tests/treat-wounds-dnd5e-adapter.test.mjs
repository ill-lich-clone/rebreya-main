import test from "node:test";
import assert from "node:assert/strict";
import { TreatWoundsDnd5eAdapter } from "../scripts/integrations/treat-wounds-dnd5e-adapter.js";
const adapter=new TreatWoundsDnd5eAdapter();
const actor=(type="character")=>({type,system:{details:{level:11,cr:0.5,type:{value:"humanoid"}},skills:{med:{value:1}},attributes:{hp:{value:10,max:10,temp:3},death:{failure:2,success:1}}},statuses:new Set()});
const kit=(spent=0,quantity=2)=>({name:"Комплект целителя",flags:{"rebreya-main":{gearId:"komplekt-tselitelya"}},system:{quantity,uses:{spent,max:"10"}}});
test("level uses character level and unconverted NPC CR",()=>{
  assert.equal(adapter.level(actor()),11); assert.equal(adapter.level(actor("npc")),0.5);
});
test("living accepts full or zero HP; Medicine requires full proficiency",()=>{
  const a=actor(); assert.equal(adapter.isLiving(a),true);
  a.system.attributes.hp.value=0; assert.equal(adapter.isLiving(a),true);
  a.statuses.add("dead"); assert.equal(adapter.isLiving(a),true); a.statuses.clear();
  a.system.details.type.value="undead"; assert.equal(adapter.isLiving(a),false);
  for(const [value,want] of [[0,false],[0.5,false],[1,true],[2,true]]) {a.system.skills.med.value=value; assert.equal(adapter.hasMedicineProficiency(a),want);}
});

test("constructs and zero-HP patients with the automatic dead marker can be treated",()=>{
  const a=actor(); a.system.details.type.value="construct"; assert.equal(adapter.isLiving(a),true);
  a.system.attributes.hp.value=0; a.statuses.add("dead"); assert.equal(adapter.isLiving(a),true);
  a.system.attributes.death.failure=3; assert.equal(adapter.isLiving(a),false);
  a.system.attributes.death.failure=2; a.system.attributes.hp.value=5; assert.equal(adapter.isLiving(a),false);
});
test("whole-kit rules reject spent, empty, unknown and unrelated inventory",()=>{
  assert.equal(adapter.kitState(kit()).eligible,true); assert.equal(adapter.kitState(kit(1)).eligible,false);
  assert.equal(adapter.kitState(kit(0,0)).eligible,false);
  const k=kit(); delete k.system.uses; assert.equal(adapter.kitState(k).eligible,true); // catalog loot has no uses pool
  k.system.uses={max:"@foo",spent:0}; assert.equal(adapter.kitState(k).eligible,false);
  k.flags={};k.name="Бинты";assert.equal(adapter.kitState(k).eligible,false);
});
test("Medicine uses wisdom and returns one native roll without duplicate message",async()=>{
  const a=actor();a.rollSkill=async(config,dialog,message)=>{assert.equal(config.skill,"med");assert.equal(config.ability,"wis");assert.equal(message.create,false);return [{total:18}];};
  assert.equal((await adapter.rollMedicine(a,{dc:15})).total,18);
  a.rollSkill=async()=>null;assert.equal(await adapter.rollMedicine(a,{dc:15}),null);
});
test("healing capped; failures only cleared; pure damage absorbs temp HP",()=>{
  const a=actor();a.system.attributes.hp.value=4;
  const heal=adapter.planResult(a,{kind:"success",amount:19,operationId:"a"});
  assert.equal(heal.updates["system.attributes.hp.value"],10); assert.equal(heal.updates["system.attributes.death.failure"],0);
  assert.equal(Object.hasOwn(heal.updates,"system.attributes.death.success"),false);
  const hit=adapter.planResult(a,{kind:"critical-failure",amount:5,operationId:"b"});
  assert.equal(hit.updates["system.attributes.hp.value"],2);assert.equal(hit.updates["system.attributes.hp.temp"],0);
});
test("native zero-HP recovery resets death counters, so adapter restores saved successes once",async()=>{
  const a=actor();a.system.attributes.hp.value=0;let updates=0;
  a.update=async patch=>{
    updates++;
    if(a.system.attributes.hp.value<=0&&patch["system.attributes.hp.value"]>0){a.system.attributes.death.success=0;a.system.attributes.death.failure=0;}
    for(const [path,value]of Object.entries(patch)){
      const parts=path.split('.');let current=a;for(const part of parts.slice(0,-1))current=current[part]??={};current[parts.at(-1)]=value;
    }
  };
  const plan=adapter.planResult(a,{kind:"success",amount:5,operationId:"recover"});
  await adapter.applyResult(a,plan);await adapter.applyResult(a,plan);
  assert.equal(a.system.attributes.hp.value,5);assert.equal(a.system.attributes.death.success,1);assert.equal(a.system.attributes.death.failure,0);
  assert.equal(updates,2);
});
test("healing uses effective maximum including positive and negative tempmax",()=>{
  const a=actor();a.system.attributes.hp={value:15,max:10,temp:0,tempmax:10,effectiveMax:20};
  assert.equal(adapter.planResult(a,{kind:"success",amount:9,operationId:"plus"}).updates["system.attributes.hp.value"],20);
  a.system.attributes.hp={value:4,max:10,temp:0,tempmax:-3,effectiveMax:7};
  assert.equal(adapter.planResult(a,{kind:"success",amount:9,operationId:"minus"}).updates["system.attributes.hp.value"],7);
});
