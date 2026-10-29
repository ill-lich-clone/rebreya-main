import test from "node:test";
import assert from "node:assert/strict";
import { ignoreProneFireDisadvantage } from "../scripts/combat/prone-fire.js";
import { registerCombatHooks } from "../scripts/combat/hooks.js";

const effect=(prone,key="flags.midi-qol.disadvantage.attack.all")=>({disabled:false,statuses:new Set(prone?["prone"]:[]),changes:[{key,value:"1"}]});
function workflow({property=true,others=[],sources={"attack.all":"Опрокинутый"}}={}) {
  let active=true;
  return { actor:{statuses:new Set(["prone"]),appliedEffects:[effect(true),...others],_source:{flags:{}}},
    item:{type:"weapon",system:{properties:new Set(property?["lchFirearmProneFire"]:[])}},
    attackRollModifierTracker:{attribution:{DIS:sources},disadvantage:{get isActive(){return active;},get hasOverride(){return false;},clear(){active=false;}}} };
}
test("prone fire removes only the prone attack disadvantage",()=>{
 const only=workflow();ignoreProneFireDisadvantage(only);assert.equal(only.attackRollModifierTracker.disadvantage.isActive,false);assert.deepEqual(only.attackRollModifierTracker.attribution.DIS,{});
 const range=workflow({sources:{"attack.all":"Опрокинутый",range:"Long Range"}});ignoreProneFireDisadvantage(range);assert.equal(range.attackRollModifierTracker.disadvantage.isActive,true);assert.deepEqual(range.attackRollModifierTracker.attribution.DIS,{range:"Long Range"});
 const blinded=workflow({others:[effect(false)]});ignoreProneFireDisadvantage(blinded);assert.equal(blinded.attackRollModifierTracker.disadvantage.isActive,true);
 const specific=workflow({others:[effect(false,"flags.midi-qol.disadvantage.attack.rwak")]});ignoreProneFireDisadvantage(specific);assert.equal(specific.attackRollModifierTracker.disadvantage.isActive,true);
 const ordinary=workflow({property:false});ignoreProneFireDisadvantage(ordinary);assert.equal(ordinary.attackRollModifierTracker.disadvantage.isActive,true);
});
test("combat registration applies prone fire after MIDI computes attack modifiers",()=>{
 const previousHooks=globalThis.Hooks,previousGame=globalThis.game,listeners=new Map();
 globalThis.Hooks={on(name,fn){listeners.set(name,fn);}};globalThis.game={user:{id:"gm"}};
 try{
  registerCombatHooks({combatAttackService:{}});
  const w=workflow();listeners.get("midi-qol.preAttackRollConfig")(w);
  assert.equal(w.attackRollModifierTracker.disadvantage.isActive,false);
  assert.equal(listeners.get("dnd5e.preApplyEnchantment")({type:"loot"},{},{activity:{flags:{"rebreya-main":{firearmTuning:true}}}}),false);
 }finally{globalThis.Hooks=previousHooks;globalThis.game=previousGame;}
});
test("a false conditional disadvantage does not preserve the prone penalty",()=>{
 const old=globalThis.MidiQOL;globalThis.MidiQOL={createConditionData:()=>({}),evalCondition:()=>false};
 try{
  const other=effect(false,"flags.midi-qol.disadvantage.attack.rwak");other.changes[0].value="@condition";
  const w=workflow({others:[other]});ignoreProneFireDisadvantage(w);assert.equal(w.attackRollModifierTracker.disadvantage.isActive,false);
  const same=effect(false);same.changes[0].value="@condition";
  const sameFlag=workflow({others:[same]});ignoreProneFireDisadvantage(sameFlag);assert.equal(sameFlag.attackRollModifierTracker.disadvantage.isActive,false);
 }finally{globalThis.MidiQOL=old;}
});
test("a melee-only penalty does not affect a prone firearm attack",()=>{
 const w=workflow({others:[effect(false,"flags.midi-qol.disadvantage.attack.mwak")]});w.activity={actionType:"fwak"};
 ignoreProneFireDisadvantage(w);assert.equal(w.attackRollModifierTracker.disadvantage.isActive,false);
});
test("conditional disadvantage uses the defender as MIDI's condition target",()=>{
 const old=globalThis.MidiQOL,target={id:"enemy"};
 globalThis.MidiQOL={createConditionData:input=>input,evalCondition:(_expression,data)=>data.target===target && data.item===w.item};
 const competing=effect(false);competing.changes[0].value="@target.special";const w=workflow({others:[competing]});
 w.targets={first:()=>target};w.token={id:"attacker"};
 try{ignoreProneFireDisadvantage(w);assert.equal(w.attackRollModifierTracker.disadvantage.isActive,true);}finally{globalThis.MidiQOL=old;}
});
test("direct actor flags preserve only applicable and true non-prone penalties",()=>{
 const old=globalThis.MidiQOL;globalThis.MidiQOL={createConditionData:()=>({}),evalCondition:()=>false};
 try{
  const melee=workflow();melee.activity={actionType:"fwak"};melee.actor._source.flags={"midi-qol":{disadvantage:{attack:{mwak:true}}}};
  ignoreProneFireDisadvantage(melee);assert.equal(melee.attackRollModifierTracker.disadvantage.isActive,false);
  const conditional=workflow();conditional.activity={actionType:"fwak"};conditional.actor._source.flags={"midi-qol":{disadvantage:{attack:{fwak:"@condition"}}}};
  ignoreProneFireDisadvantage(conditional);assert.equal(conditional.attackRollModifierTracker.disadvantage.isActive,false);
  const active=workflow();active.activity={actionType:"fwak"};active.actor._source.flags={"midi-qol":{disadvantage:{attack:{fwak:true}}}};
  ignoreProneFireDisadvantage(active);assert.equal(active.attackRollModifierTracker.disadvantage.isActive,true);
 }finally{globalThis.MidiQOL=old;}
});
test("combined prone and blinded effect does not erase an inseparable disadvantage",()=>{
 const w=workflow();w.actor.appliedEffects[0].statuses.add("blinded");
 ignoreProneFireDisadvantage(w);assert.equal(w.attackRollModifierTracker.disadvantage.isActive,true);
});
