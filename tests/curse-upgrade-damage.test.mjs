import test from "node:test";
import assert from "node:assert/strict";
import { CurseUpgradeDamageAdapter } from "../scripts/combat/curse-upgrade-damage.js";

function setup(keys = ["fire"], extra = {}) {
  const actor = { uuid: "Actor.a", system: { attributes: { hp: {} } } };
  const host = { uuid: "Actor.a.Item.weapon", type: "weapon", actor };
  const sources = keys.map(key => ({ key, host, upgrade: { uuid: `Item.${key}` } }));
  const service = { sources: (a, key) => a === actor ? sources.filter(s => s.key === key) : [], ...extra };
  return { actor, host, sources, adapter: new CurseUpgradeDamageAdapter(service) };
}
const part = (type, value) => ({ type, value, properties: new Set() });

test("fire absorption aggregates components once, cold weakness once, preserves other types", () => {
  const { actor, adapter } = setup();
  const damage = [part("fire", 1), part("fire", 6), part("cold", 4), part("cold", 2), part("slashing", 9)];
  adapter.preCalculateDamage(actor, damage, {});
  assert.equal(damage.filter(p => p.type === "fire").reduce((n,p) => n+p.value,0), 5);
  assert.equal(damage.filter(p => p.type === "cold").reduce((n,p) => n+p.value,0), 8);
  assert.equal(damage[4].value, 9);
});
test("absorption leaves at least one, does not create damage from zero", () => {
  const { actor, adapter } = setup();
  const damage = [part("fire", 1), part("cold", 0)];
  adapter.preCalculateDamage(actor, damage, {});
  assert.deepEqual(damage.map(p => p.value), [1,0]);
});
test("native save multiplier precedes flat modifier, resistance remains for native pipeline", () => {
  const { actor, adapter } = setup();
  const damage = [part("fire", 28), part("cold", 28)];
  adapter.preCalculateDamage(actor, damage, { multiplier: 0.5 });
  assert.equal(Math.floor(damage[0].value * 0.5 * 0.5), 6);
  assert.equal(damage[1].value * 0.5, 16);
});
test("MIDI callback handles saves already applied and later saves without native duplicate", () => {
  const { actor, adapter } = setup();
  for (const order of ["SaveDrDR", "SaveDRDr", "DRSaveDr"]) {
    adapter.getSaveDROrder = () => order;
    const options = { midi: { saved: true, saveMultiplier: 0.5 } };
    const damage = [part("fire", order === "DRSaveDr" ? 28 : 14)];
    adapter.preCalculateDamage(actor, damage, options);
    assert.equal(damage[0].value, order === "DRSaveDr" ? 28 : 14);
    adapter.midiPreCalculateDamage(actor, damage, options);
    adapter.midiPreCalculateDamage(actor, damage, options);
    adapter.preCalculateDamage(actor, damage, options);
    assert.equal(damage[0].value * (order === "DRSaveDr" ? 0.5 : 1), 12);
  }
});
test("same options reused for distinct packets does not suppress recalculation", () => {
  const { actor, adapter } = setup(); const options = {};
  for (let i=0;i<2;i++) { const damage=[part("fire",10)]; adapter.preCalculateDamage(actor,damage,options); assert.equal(damage[0].value,8); }
});
test("noCalc and explicitly ignored modification do not alter damage", () => {
  const { actor, adapter } = setup();
  for (const options of [{ignore:true},{ignore:{modification:true}},{midi:{noCalc:true}}]) {
    const damage=[part("fire",5)]; adapter.preCalculateDamage(actor,damage,options); adapter.midiPreCalculateDamage(actor,damage,options); assert.equal(damage[0].value,5);
  }
});
test("blood bonus belongs only to exact host and is added once across pre-roll callbacks", () => {
  const { actor, host, adapter } = setup(["blood"]);
  const config={subject:{actor,item:host},rolls:[{parts:["1d8"],options:{type:"piercing",types:["piercing"]}}]};
  adapter.preRollDamage(config); adapter.preRollDamage(config);
  assert.equal(config.rolls.length,2);
  assert.deepEqual(config.rolls[1].parts,["1d6"]);
  assert.equal(config.rolls[1].options.type,"slashing");
  assert.deepEqual(config.rolls[1].options.types,["slashing"]);
  assert.equal(config.rolls[1].options.rebreyaCurseBlood,"Item.blood");
  const other={subject:{actor,item:{uuid:"Item.other",type:"weapon"}},rolls:[]};
  adapter.preRollDamage(other); assert.equal(other.rolls.length,0);
});

test("shield resistance only applies to ranged weapon damage and never stacks innate resistance",()=>{
  const {actor,adapter}=setup(["shield"]);
  const options={sourceItem:{type:"weapon"},activity:{actionType:"rwak"}};
  const damage=[part("piercing",8),{...part("fire",4),active:{resistance:true}}];
  adapter.calculateDamage(actor,damage,options); adapter.calculateDamage(actor,damage,options);
  assert.deepEqual(damage.map(p=>p.value),[4,4]); assert.equal(damage.amount,8);
  const spell=[part("fire",8)]; adapter.calculateDamage(actor,spell,{sourceItem:{type:"spell"},activity:{actionType:"rsak"}});
  assert.equal(spell[0].value,8);
});
test("shield MIDI nested callback uses explicit damage source resolver",()=>{
  const {actor,adapter}=setup(["shield"]);
  adapter.resolveDamageSource=()=>({item:{type:"weapon"},activity:{actionType:"rwak"}});
  const damage=[part("piercing",7)]; const options={midi:{}};
  adapter.calculateDamage(actor,damage,options); assert.equal(damage[0].value,7);
  adapter.midiCalculateDamage(actor,damage,options); assert.equal(damage[0].value,3.5); assert.equal(damage.amount,3);
});

test("MIDI finalization applies absorption once across default and bonus categories",()=>{
  const {actor,adapter}=setup(); actor.system.attributes.hp={value:20,temp:2,damage:0};
  actor.calculateDamage=(raw,options)=>{
    const result=structuredClone(raw);
    if(options.midi.saved) for(const d of result)d.value*=options.midi.saveMultiplier;
    adapter.midiPreCalculateDamage(actor,result,options);
    for(const d of result)if(d.type==="fire")d.value*=0.5;
    return result;
  };
  const opts={midi:{saved:true,saveMultiplier:0.5,applyDamage:true}};
  const initial=[part("fire",6)]; adapter.midiPreCalculateDamage(actor,initial,opts); assert.equal(initial[0].value,6);
  const damageItem={damageSelector:"combinedDamage",damageDetails:{
    rawdefaultDamage:[part("fire",8)],rawbonusDamage:[part("fire",4)],
    calcDamageOptions:{defaultDamage:opts,bonusDamage:opts}
  },damageDetail:[part("fire",3)],rawDamageDetail:[part("fire",12)],calcDamageOptions:opts};
  adapter.preTargetDamageApplication({actor},{workflow:{activity:{},item:{}},damageItem});
  assert.equal(damageItem.damageDetail.reduce((n,d)=>n+d.value,0),2);
  assert.equal(damageItem.hpDamage,0); assert.equal(damageItem.tempDamage,2);
  adapter.preTargetDamageApplication({actor},{workflow:{activity:{},item:{}},damageItem});
  assert.equal(damageItem.damageDetail.reduce((n,d)=>n+d.value,0),2);
});
test("MIDI actual workflow context enables shield without ambiguous source lookup",()=>{
  const {actor,adapter}=setup(["shield"]); actor.system.attributes.hp={value:20,temp:0,damage:0};
  const damageItem={damageDetail:[part("piercing",9)],calcDamageOptions:{midi:{applyDamage:true}}};
  adapter.preTargetDamageApplication({actor},{workflow:{item:{type:"weapon"},activity:{actionType:"rwak"}},damageItem});
  assert.equal(damageItem.hpDamage,4); assert.equal(damageItem.newHP,16);
});
test("incomplete third-party MIDI payload does not erase existing damage",()=>{
  const {actor,adapter}=setup(); actor.system.attributes.hp={value:20,temp:0,damage:0};
  actor.calculateDamage=raw=>raw;
  const damageItem={damageDetail:[part("fire",8)],calcDamageOptions:{midi:{applyDamage:true}}};
  adapter.preTargetDamageApplication({actor},{workflow:{},damageItem});
  assert.equal(damageItem.damageDetail[0]?.value,8);
});
