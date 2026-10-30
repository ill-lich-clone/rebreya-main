import test from "node:test";
import assert from "node:assert/strict";
import { captureAmmunition, magazineRounds, validateMagazine, getAmmunitionDamage, applyAmmunitionDamage } from "../scripts/combat/ammunition-magazine.js";

const ammo = (id = "боеприпасы-с-огненной-мазью-20") => ({ name: "Патрон", type: "consumable", system: { quantity: 20, type: { value: "ammo", subtype: "rebreyaRifle" } }, flags: { "rebreya-main": { gearId: id } }, effects: [] });
test("magazine identity ignores stack quantity and location but distinguishes authored effects", () => {
  const a=ammo(), b=structuredClone(a); b._id="other";b.system.quantity=2;b.system.container="bag";
  assert.equal(captureAmmunition(a).key,captureAmmunition(b).key);
  b.effects.push({changes:[{key:"system.bonuses.rwak.attack",value:"2",mode:2}]});
  assert.notEqual(captureAmmunition(a).key,captureAmmunition(b).key);
  assert.equal(a.system.quantity,20);
});
test("historical magazine preserves unknown charges instead of inventing ammunition", () => {
  assert.deepEqual(magazineRounds({current:5}),{rounds:Array(5).fill("@legacy"),sources:{}});
});
test("native empty rider metadata and generated identifiers do not change ammunition identity",()=>{
  const original=ammo(),normalized=structuredClone(original);normalized.flags.dnd5e={riders:{activity:[]}};normalized.system.identifier="generated-slug";
  assert.equal(captureAmmunition(original).key,captureAmmunition(normalized).key);
});
test("groups accept different adjacent types and reject mixed or malformed prefixes", () => {
  assert.doesNotThrow(()=>validateMagazine(["a","a","a","b","b","b"],3,6));
  assert.doesNotThrow(()=>validateMagazine(Array(6).fill("a").concat(["b","b"]),6,8));
  for(const rounds of [["a","b","a"],["a","a","b","b","b"],["a",null,"a"],Array(7).fill("a")]) assert.throws(()=>validateMagazine(rounds,3,6));
});
test("fire and frost ammunition bonus is once per attack and native authored damage wins", () => {
  assert.deepEqual(getAmmunitionDamage(ammo()).parts,[{formula:"1d6",type:"fire"}]);
  assert.deepEqual(getAmmunitionDamage(ammo("боеприпасы-с-ледяной-мазью-20")).parts,[{formula:"1d6",type:"cold"}]);
  const a=ammo();a.system.damage={base:{custom:{enabled:true,formula:"2d8"},types:["acid"]}};
  assert.deepEqual(getAmmunitionDamage(a).parts,[{formula:"2d8",type:"acid"}]);
});
test("damage projection preserves authored addenda and changes only base damage die and type", () => {
  const a=ammo("rocket");a.flags["rebreya-main"].ammunition={damageModifiers:[{formula:"2d6",type:"fire"}],damageType:"piercing",handCannonDamageDieStep:-1};
  const config={rolls:[{base:true,parts:["2d10","@mod"],options:{type:"bludgeoning"}},{parts:["1d4"],options:{type:"cold"}}]};
  applyAmmunitionDamage(config,a);applyAmmunitionDamage(config,a);
  assert.deepEqual(config.rolls[0].parts,["2d8","@mod"]);
  assert.equal(config.rolls[0].options.type,"piercing");
  assert.deepEqual(config.rolls[1].parts,["1d4"]);
  assert.equal(config.rolls.filter(x=>x.options?.rebreyaAmmunition).length,1);
  assert.deepEqual(config.rolls[2].parts,["2d6"]);
});
test("unsupported effects remain explicitly manual", () => {
  const a=ammo("bleeding");a.flags["rebreya-main"].ammunition={propertiesText:"При попадании вызывает кровотечение."};
  assert.equal(getAmmunitionDamage(a).manual,"При попадании вызывает кровотечение.");
  assert.deepEqual(getAmmunitionDamage(a).parts,[]);
});
test("native physical ammunition properties reach each damage packet without erasing weapon properties",()=>{
  const config={rolls:[{base:true,parts:["1d8"],options:{properties:["mgc"]}},{parts:["1d4"],options:{properties:[]}}]};
  applyAmmunitionDamage(config,ammo("silver"),{physicalProperties:["sil"]});
  assert.deepEqual(config.rolls[0].options.properties,["mgc","sil"]);assert.deepEqual(config.rolls[1].options.properties,["sil"]);
});
test("extra ammunition damage retains native roll-data classes and independent critical options",()=>{
  class NativeRollValue{constructor(){this.actor={pool:this};}valueOf(){return 4;}}
  const value=new NativeRollValue(),config={rolls:[{base:true,parts:["1d8"],data:{hd:value},options:{critical:{bonusDice:0}}}]};
  applyAmmunitionDamage(config,ammo());
  assert.equal(config.rolls[1].data.hd.valueOf(),4);
  config.rolls[0].options.critical.bonusDice=2;
  assert.equal(config.rolls[1].options.critical.bonusDice,0);
});
