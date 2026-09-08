import test from "node:test";
import assert from "node:assert/strict";
import { createLootgenCatalogReader } from "../scripts/data/lootgen-catalog-reader.js";
import { evaluateItemValue } from "../scripts/data/item-value.js";
const gear=(id,system={},flags={})=>({_id:id,type:"weapon",system:{type:{value:"martialM"},...system},flags:{"rebreya-main":{managed:true,sourceType:"gear",sourceId:id,gearId:id,...flags}}});
const manifest=[{productId:"sharp",decision:"simple-implemented",profile:{compatibility:["weapon"],type:"Зачарование",rank:1}}];
test("catalog reader resolves full value and native compatibility from stable IDs",()=>{
  const reader=createLootgenCatalogReader({model:{gear:[{id:"sword",value:100},{id:"sharp",value:20}],materials:[]},gearIndex:[gear("sword"),gear("sharp")],manifest});
  const host=reader.describeUpgradeHost({sourceType:"gear",sourceId:"sword"});
  assert.ok(host.compatibilityTags.includes("melee"));assert.equal(host.quantity,1);
  assert.equal(evaluateItemValue({version:2,instanceKey:"h",sourceType:"gear",sourceId:"sword",quantity:1,isBroken:false,container:null,upgrades:[{instanceKey:"u",sourceId:"sharp",slotIndex:1,choices:{}}]},reader).totalValue,120);
  assert.equal(reader.resolveValueComponent({sourceType:"gear",sourceId:"sharp"}).upgradeProfile.type,"Зачарование");
});
test("unknown and unsafe prices cannot silently become free upgrades",()=>{
  const reader=createLootgenCatalogReader({model:{gear:[{id:"unknown"},{id:"zero",value:0},{id:"unsafe",value:Number.MAX_SAFE_INTEGER+1}],materials:[]},gearIndex:[gear("unknown"),gear("zero"),gear("unsafe")]});
  assert.equal(reader.resolveValueComponent({sourceType:"gear",sourceId:"unknown"}).priceKnown,false);
  assert.equal(reader.resolveValueComponent({sourceType:"gear",sourceId:"missing"}),null);
  assert.equal(reader.resolveValueComponent({sourceType:"gear",sourceId:"unsafe"}).priceKnown,false);
  assert.equal(reader.resolveValueComponent({sourceType:"gear",sourceId:"zero"}).unitValue,0);
  assert.equal(reader.resolveValueComponent({sourceType:"gear",sourceId:"zero"}).priceKnown,true);
});
test("catalog data is detached and duplicate identities fail closed",()=>{
  const source=gear("sword"),reader=createLootgenCatalogReader({model:{gear:[{id:"sword",value:100}]},gearIndex:[source]});
  source.system.type.value="martialR";const host=reader.describeUpgradeHost({sourceType:"gear",sourceId:"sword"});host.compatibilityTags.length=0;
  assert.ok(reader.describeUpgradeHost({sourceType:"gear",sourceId:"sword"}).compatibilityTags.includes("melee"));
  assert.throws(()=>createLootgenCatalogReader({model:{gear:[{id:"same",value:1},{id:"same",value:2}]}}),/duplicate/u);
});

test("magic known zero, denomination and invalid prices remain explicit",()=>{
  const magic=(id,flags,price)=>({_id:id,type:"loot",flags:{"rebreya-main":{magicItemId:id,...flags}},system:{price}});
  const reader=createLootgenCatalogReader({magicDocuments:[magic("zero",{value:0}),magic("ep",{},{value:2,denomination:"ep"}),magic("invalid",{value:-1},{value:5,denomination:"gp"})]});
  assert.deepEqual(reader.resolveValueComponent({sourceType:"magicItem",sourceId:"zero"}),{priceKnown:true,unitValue:0,upgradeProfile:null,includedUpgradeSourceIds:[]});
  assert.equal(reader.resolveValueComponent({sourceType:"magicItem",sourceId:"ep"}).unitValue,100);
  assert.equal(reader.resolveValueComponent({sourceType:"magicItem",sourceId:"invalid"}).priceKnown,false);
});
test("upgrade component missing its source document is not selectable",()=>{
  const reader=createLootgenCatalogReader({model:{gear:[{id:"sharp",value:20}]},manifest});
  assert.equal(reader.resolveValueComponent({sourceType:"gear",sourceId:"sharp"}).priceKnown,false);
});

test("an explicit custom source profile is unavailable rather than replaced by the manifest",()=>{
  const reader=createLootgenCatalogReader({model:{gear:[{id:"sharp",value:20}]},gearIndex:[gear("sharp",{},{upgrade:{compatibility:["weapon"],activation:"custom"}})],manifest});
  assert.throws(()=>reader.resolveValueComponent({sourceType:"gear",sourceId:"sharp"}),error=>error.code==="unavailable");
  assert.equal(reader.describeUpgradeHost({sourceType:"gear",sourceId:"sharp"}),null);
});
