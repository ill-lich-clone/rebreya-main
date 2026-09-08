import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLootgenItemDescriptor, validateLootgenItemDescriptor, getLootgenAggregationKey } from "../scripts/data/lootgen-item-descriptor.js";

const descriptor = () => ({version:2,instanceKey:"host-a",sourceType:"gear",sourceId:"sword",quantity:1,isBroken:false,upgrades:[{instanceKey:"child-a",sourceId:"zacharovanie-ostroty",slotIndex:1,choices:{}}],container:null});

test("same base with two physical compositions never aggregates; plain legacy identity remains stable", () => {
  const a=descriptor(), b={...descriptor(),instanceKey:"host-b",upgrades:[{...descriptor().upgrades[0],instanceKey:"child-b"}]};
  assert.notEqual(getLootgenAggregationKey(a),getLootgenAggregationKey(b));
  const legacy={sourceType:"gear",sourceId:"sword",quantity:4,isBroken:false,name:"Old row"};
  const normalized=normalizeLootgenItemDescriptor(legacy,{legacy:true});
  assert.equal(getLootgenAggregationKey(normalized),"gear:sword:intact");assert.equal(normalized.quantity,4);
  assert.deepEqual(normalized.upgrades,[]);assert.equal(normalized.container,null);
});

test("strict descriptor rejects arbitrary fields, unsafe counts and duplicate child identities or slots", () => {
  const a=descriptor();
  assert.deepEqual(validateLootgenItemDescriptor(a),a);
  for(const patch of [{quantity:2},{quantity:0},{quantity:Number.MAX_SAFE_INTEGER+1},{effects:[]},{sourceType:"Actor"},{instanceKey:""},{container:{}},
    {upgrades:[{...a.upgrades[0],effects:[]}]},{upgrades:[{...a.upgrades[0],instanceKey:a.instanceKey}]},
    {upgrades:[a.upgrades[0],{...a.upgrades[0],instanceKey:"b"}]},
    {upgrades:[{...a.upgrades[0],slotIndex:0}]},{upgrades:[{...a.upgrades[0],choices:{damageType:"fire"}}]}]) {
    assert.throws(()=>normalizeLootgenItemDescriptor({...a,...patch}));
  }
  assert.deepEqual(a,descriptor());
});

test("generated absorption choices use the same finite validator as installed Items", () => {
  const a=descriptor();a.upgrades[0]={instanceKey:"u",sourceId:"cheshuya-monstra",slotIndex:1,choices:{damageType:"fire"}};
  assert.deepEqual(normalizeLootgenItemDescriptor(a).upgrades[0].choices,{damageType:"fire"});
  a.upgrades[0].choices={};assert.throws(()=>normalizeLootgenItemDescriptor(a));
});
