import test from "node:test";
import assert from "node:assert/strict";
import { CurseUpgradeAttackAdapter } from "../scripts/combat/curse-upgrade-attacks.js";

function setup() {
  const actor={uuid:"Actor.attacker"}; const item={uuid:"Item.weapon",type:"weapon",actor};
  const target={document:{uuid:"Token.target"},actor:{statuses:new Set(["rebreya-surrounded"])}};
  const shield={document:{uuid:"Token.shield"},actor:{uuid:"Actor.shield"}};
  const service={sources:(a,key)=>key==="mourning"&&a===actor?[{host:item}]:key==="shield"&&a===shield.actor?[{host:{actor:a}}]:[]};
  const adapter=new CurseUpgradeAttackAdapter(service,{tokens:()=>[target,shield],distance:()=>8});
  return {adapter,actor,item,target,shield};
}
test("mourning exact weapon against surrounded adds advantage and one -2",()=>{
  const {adapter,actor,item,target}=setup();
  const config={subject:{actor,item},targets:new Set([target]),rolls:[{parts:["1d20"],options:{}}]};
  adapter.preRollAttack(config); adapter.preRollAttack(config);
  assert.equal(config.advantage,true); assert.equal(config.rolls[0].options.advantage,true);
  assert.deepEqual(config.rolls[0].parts,["1d20","-2"]);
  const other={subject:{actor,item:{uuid:"Other",type:"weapon"}},targets:new Set([target]),rolls:[{parts:[],options:{}}]};
  adapter.preRollAttack(other); assert.equal(other.advantage,undefined);
});
test("mourning blocks a mixed-target shared roll with an actionable warning",()=>{
  const {adapter,actor,item,target}=setup();
  const warnings=[]; adapter.warn=message=>warnings.push(message);
  const config={subject:{actor,item},targets:new Set([target,{actor:{statuses:new Set()}}]),rolls:[{parts:[],options:{}}]};
  assert.equal(adapter.preRollAttack(config),false); assert.equal(config.advantage,undefined);
  assert.equal(warnings.length,1); assert.match(warnings[0],/отдельно/);
  assert.deepEqual(config.rolls[0].parts,[]);
});
test("shield redirects rwak before roll once; does not reroute spell attacks",async()=>{
  const {adapter,actor,item,target,shield}=setup();
  const workflow={actor,item,activity:{item,actionType:"rwak"},targets:new Set([target])};
  await adapter.midiPreAttackRoll(workflow); assert.deepEqual([...workflow.targets],[shield]);
  await adapter.midiPreAttackRoll(workflow); assert.deepEqual([...workflow.targets],[shield]);
  const spell={actor,item:{type:"spell"},activity:{actionType:"rsak"},targets:new Set([target])};
  await adapter.midiPreAttackRoll(spell); assert.deepEqual([...spell.targets],[target]);
});
test("shield stable nearest selection preserves unaffected targets and checks range",async()=>{
  const {adapter,actor,item,target,shield}=setup();
  const far={document:{uuid:"Token.far"},actor:{}};
  adapter.distance=(from,to)=>from===far?11:5;
  const workflow={actor,item,activity:{item,actionType:"rwak"},targets:new Set([target,far])};
  await adapter.midiPreAttackRoll(workflow); assert.deepEqual([...workflow.targets],[shield,far]);
});
test("native mourning reads redirected MIDI workflow target and releases it after completion",async()=>{
  const {adapter,actor,item,target,shield}=setup();
  const activity={actor,item,actionType:"rwak"};
  const workflow={actor,item,activity,targets:new Set([target])};
  await adapter.midiPreAttackRoll(workflow);
  const config={subject:activity,rolls:[{parts:[],options:{}}]};
  adapter.preRollAttack(config); assert.equal(config.advantage,undefined);
  shield.actor.statuses=new Set(["rebreya-surrounded"]);
  adapter.preRollAttack(config); assert.equal(config.advantage,true);
  adapter.releaseWorkflow(workflow);
  const fresh={subject:activity,rolls:[]}; adapter.preRollAttack(fresh); assert.equal(fresh.advantage,undefined);
});
