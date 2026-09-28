import test from "node:test";
import assert from "node:assert/strict";
import { buildDisarmRollPlan, DisarmRollAdapter } from "../scripts/integrations/disarm-roll-adapter.js";
function fixture({finesse=false, multiplier=1}={}) {
  const source={system:{abilities:{str:{value:16},dex:{value:18}},attributes:{prof:3}}};
  return {actor:{system:structuredClone(source.system),toObject:()=>structuredClone(source),effects:[]},
    weapon:{type:"weapon",system:{type:{value:"martialM"},properties:new Set(finesse?["fin"]:[]),proficiencyMultiplier:multiplier,magicalBonus:3,attackBonus:"9"}}};
}
test("baseline formula excludes magical, temporary and feat bonuses",()=>{
  const f=fixture(); f.actor.system.bonuses={mwak:{attack:"1d4+5"}};
  const plan=buildDisarmRollPlan({...f,mode:"melee"});
  assert.equal(plan.formula,"1d20 + 3 + 3"); assert.equal(plan.ability,"str");
  assert.deepEqual(plan.unresolvedModifiers,[]); assert.ok(plan.excludedModifiers.length);
  assert.equal(buildDisarmRollPlan({...fixture({finesse:true}),mode:"melee"}).ability,"dex");
  assert.equal(buildDisarmRollPlan({...f,mode:"ranged"}).ability,"dex");
  f.weapon.system.properties.add("thr");
  assert.equal(buildDisarmRollPlan({...f,mode:"thrown"}).ability,"str");
});
test("actual zero, half and double proficiency; no truthy fallback",()=>{
  for (const [multiplier,expected] of [[0,0],[.5,1],[1,3],[2,6]]) {
    assert.equal(buildDisarmRollPlan({...fixture({multiplier}),mode:"melee"}).proficiencyContribution,expected);
  }
});
test("buffed abilities and unknown provenance require a recorded baseline",()=>{
  const f=fixture(); f.actor.system.abilities.str.value=20;
  let plan=buildDisarmRollPlan({...f,mode:"melee"});
  assert.equal(plan.formula,null); assert.ok(plan.unresolvedModifiers.includes("ability-baseline"));
  plan=buildDisarmRollPlan({...f,mode:"melee",context:{baseline:{abilityScore:16,proficiencyContribution:3}}});
  assert.equal(plan.formula,"1d20 + 3 + 3");
  f.weapon.system.ability="int"; assert.equal(buildDisarmRollPlan({...f,mode:"melee",context:{baseline:{abilityScore:16,proficiencyContribution:3}}}).ability,"str");
  assert.throws(()=>buildDisarmRollPlan({...f,mode:"invented"}));
});
test("trusted roll executor evaluates once without chat; save uses native dnd5e modifiers",async()=>{
  const calls=[];
  class FakeRoll { constructor(formula){this.formula=formula;} async evaluate(){calls.push(this.formula);this.total=17;return this;} toJSON(){return {formula:this.formula,total:this.total};} }
  const adapter=new DisarmRollAdapter({RollClass:FakeRoll});
  const rolled=await adapter.attack({formula:"1d20 + 3 + 3"},"disadvantage");
  assert.equal(rolled.total,17); assert.deepEqual(calls,["2d20kl + 3 + 3"]);
  const actor={async rollSavingThrow(config,dialog,message){calls.push({config,dialog,message});return [{total:16,toJSON:()=>({total:16})}];}};
  await adapter.save(actor,"str","advantage");
  assert.equal(calls[1].message.create,false); assert.equal(calls[1].dialog.configure,false);
  assert.equal(calls[1].config.rolls[0].options.advantage,true);
});
