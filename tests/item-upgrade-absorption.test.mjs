import test from "node:test";
import assert from "node:assert/strict";
import { CurseUpgradeDamageAdapter } from "../scripts/combat/curse-upgrade-damage.js";
import { buildSimpleUpgradeContributions } from "../scripts/automation/item-upgrade-projections.js";

const part = (type, value, magical = false) => ({ type, value, properties: new Set(magical ? ["mgc"] : []) });
function fixture(ids, curses = 0) {
  const actor = { uuid: "Actor.a", system: { attributes: { hp: { value: 20, temp: 0, damage: 0 } } } };
  const hosts = ids.map((sourceId, i) => ({ id: `h${i}`, descriptor: { isEquipped: true, isBroken: false }, source: {}, upgrades: [{ id: `u${i}`, sourceId, valid: true }] }));
  const project = () => buildSimpleUpgradeContributions({ actor, hosts });
  const service = { sources: (_actor, key) => key === "fire" ? Array(curses).fill({}) : [], moduleApi: { itemUpgradeAutomationService: { project } } };
  return { actor, hosts, adapter: new CurseUpgradeDamageAdapter(service), project };
}

for (const [id, expected] of [
  ["fragment-pantsirya-chudovishcha", [9,10,10]],
  ["pantsir-chudovishcha", [9,9,10]],
  ["shkura-chudovishcha", [10,10,9]],
  ["zakalyonnaya-cheshuya", [10,9,10]],
  ["khrebet-chudovishcha", [9,10,11]],
  ["oskolok-kosti-chudovishcha", [10,11,9]]
]) test(`${id}: complete absorption/weakness through canonical packet owner`, () => {
  const f = fixture([id]), damages = [part("slashing",10), part("piercing",10), part("bludgeoning",10)];
  assert.ok(f.project().contributions.length);
  f.adapter.preCalculateDamage(f.actor, damages);
  f.adapter.preCalculateDamage(f.actor, damages);
  assert.deepEqual(damages.map(d => d.value), expected);
  f.hosts[0].descriptor.isEquipped = false;
  const inactive = [part("slashing",10)]; f.adapter.preCalculateDamage(f.actor, inactive);
  assert.equal(inactive[0].value,10);
});

test("nonmagical predicates preserve magical and unknown descriptions, same-type flat bonus is spent once", () => {
  const f = fixture(["khrebet-chudovishcha"]);
  const d = [part("slashing",3), part("slashing",3), part("slashing",8,true), {type:"slashing",value:4}, part("bludgeoning",5,true)];
  f.adapter.preCalculateDamage(f.actor,d);
  assert.deepEqual(d.map(d=>d.value),[2.5,2.5,8,4,5]);
});

test("simple and curse contributions share save/DR ordering, minimum one and ignored modifications", () => {
  const f = fixture(["fragment-pantsirya-chudovishcha","fragment-pantsirya-chudovishcha"],1);
  const d = [part("slashing",10),part("fire",10),part("cold",10)];
  f.adapter.preCalculateDamage(f.actor,d,{multiplier:0.5});
  assert.deepEqual(d.map(d=>d.value*0.5),[3,3,7]);
  const min=[part("slashing",1),part("slashing",0)];f.adapter.preCalculateDamage(f.actor,min);assert.deepEqual(min.map(d=>d.value),[1,0]);
  const ignore=[part("slashing",10)];f.adapter.preCalculateDamage(f.actor,ignore,{ignore:{modification:true}});assert.equal(ignore[0].value,10);
});

test("MIDI finalization spends simple absorption once across default and bonus slices after saves", () => {
  const f=fixture(["fragment-pantsirya-chudovishcha"]), options={midi:{saved:true,saveMultiplier:0.5,applyDamage:true}};
  f.actor.calculateDamage=(raw,opts)=>{
    const d=structuredClone(raw);for(const p of d)p.value*=0.5;
    f.adapter.midiPreCalculateDamage(f.actor,d,opts);for(const p of d)p.value*=0.5;return d;
  };
  const damageItem={damageSelector:"combinedDamage",damageDetails:{rawdefaultDamage:[part("slashing",8)],rawbonusDamage:[part("slashing",4)],calcDamageOptions:{defaultDamage:options,bonusDamage:options}},damageDetail:[],calcDamageOptions:options};
  f.adapter.preTargetDamageApplication({actor:f.actor},{workflow:{},damageItem});
  assert.equal(damageItem.damageDetail.reduce((n,p)=>n+p.value,0),2.5);
  assert.equal(damageItem.hpDamage,2);
  f.adapter.preTargetDamageApplication({actor:f.actor},{workflow:{},damageItem});
  assert.equal(damageItem.hpDamage,2);
});

for (const [id,delta] of [["cheshuya-monstra",2],["zacharovanie-pogloshcheniya",1]]) test(`${id}: only the saved valid choice contributes`, () => {
  const f=fixture([id]);
  assert.equal(f.project().contributions.length,0);
  assert.equal(f.project().unavailable.length,1);
  f.hosts[0].upgrades[0].choices={damageType:"fire"};
  const d=[part("fire",8),part("cold",8)];f.adapter.preCalculateDamage(f.actor,d);
  assert.deepEqual(d.map(p=>p.value),[8-delta,8]);
  f.hosts[0].upgrades[0].choices={damageType:"healing"};
  assert.equal(f.project().contributions.length,0);
});

test("a MIDI noCalc slice cannot consume absorption belonging to a calculated slice", () => {
  const f=fixture(["fragment-pantsirya-chudovishcha"]), options={midi:{applyDamage:true}}, noCalc={midi:{applyDamage:true,noCalc:true}};
  f.actor.calculateDamage=(raw,opts)=>{const d=structuredClone(raw);f.adapter.midiPreCalculateDamage(f.actor,d,opts);return d;};
  const damageItem={damageSelector:"combinedDamage",damageDetails:{rawdefaultDamage:[part("slashing",10)],rawbonusDamage:[part("slashing",10)],calcDamageOptions:{defaultDamage:options,bonusDamage:noCalc}},damageDetail:[],calcDamageOptions:options};
  f.adapter.preTargetDamageApplication({actor:f.actor},{workflow:{},damageItem});
  assert.deepEqual(damageItem.damageDetail.map(p=>p.value),[9,10]);
});
