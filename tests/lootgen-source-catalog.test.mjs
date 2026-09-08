import test from "node:test";
import assert from "node:assert/strict";
import { buildLootgenMundanePool, buildLootgenMagicPool, LootgenSourceCatalog } from "../scripts/data/lootgen-source-catalog.js";

const form={rankMin:0,rankMax:4,includeGear:true,includeMagicItems:true,gearTypeFilters:{},magicTypeFilters:{}};
test("catalog pools preserve packages, type/rank/bargaining filters and exclude loose upgrades",()=>{
  const model={gear:[{id:"paper",name:"Paper",rank:0,value:2,multipleAppearance:"2к12",equipmentType:"Снаряжение"},
    {id:"sword",rank:1,value:100,equipmentType:"Оружие"},{id:"blocked",rank:1,value:3,bargaining:"Запрещено"},
    {id:"high",rank:9,value:2},{id:"upgrade",rank:1,value:2,equipmentType:"Усовершенствование"}],materials:[{id:"iron",name:"Iron",rank:1,value:50}]};
  const pool=buildLootgenMundanePool({model,form,breakableGearIds:new Set(["sword"])});
  assert.deepEqual(pool.map(row=>row.sourceId),["paper","iron","sword"]);
  assert.equal(pool[0].multipleAppearance,"2к12");assert.equal(pool[2].breakable,true);
  assert.deepEqual(buildLootgenMundanePool({model,form:{...form,gearTypeFilters:{"оружие":false,"материал":false}}}).map(row=>row.sourceId),["paper"]);
  assert.deepEqual(buildLootgenMundanePool({model,form:{...form,includeGear:false}}),[]);
});

test("magic pool preserves source identity and legacy price precedence",()=>{
  const magic=(id,flags,system={})=>({id,type:"loot",name:id,flags:{"rebreya-main":flags},system});
  const documents=[magic("doc",{magicItemId:"stable",rank:2,value:40,priceGold:99}),
    magic("legacy",{rank:1,priceGold:12}),magic("native",{rank:1},{price:{value:3,denomination:"sp"}}),
    magic("denied",{rank:1,signature:JSON.stringify({bargaining:"невозможно"})}),magic("high",{rank:9})];
  const pool=buildLootgenMagicPool({form,documents});
  assert.deepEqual(pool.map(row=>[row.sourceId,row.value]),[["legacy",12],["native",30],["stable",40]]);
});

test("source catalog reads requested sources once and generates without a UI instance",async()=>{
  const calls=[];
  const catalog=new LootgenSourceCatalog({getModel:async()=>{calls.push("model");return {gear:[{id:"paper",rank:0,value:2}],materials:[]};},
    getGearIndex:async()=>{calls.push("gear");return [];},getMagicDocuments:async()=>{calls.push("magic");return [];}});
  const snapshot=await catalog.load({...form,includeMagicItems:false});
  assert.deepEqual(calls.sort(),["gear","model"]);assert.equal(snapshot.mundanePool.length,1);assert.deepEqual(snapshot.magicPool,[]);
  const result=await catalog.generate({...form,includeMagicItems:false,itemCount:1,optimalItemQuantity:1,budgetValue:2,includeCoins:false},{random:()=>0,batchId:"fixed",generatedAt:"fixed"});
  assert.equal(result.rows[0].sourceId,"paper");assert.equal(result.spentValue,2);
});

test("enabled generation combines real catalog prices and compatibility before spending budget",async()=>{
  const source=id=>({_id:id,type:id==="sword"?"weapon":"loot",system:{type:{value:"martialM"}},flags:{"rebreya-main":{managed:true,gearId:id}}});
  const catalog=new LootgenSourceCatalog({getModel:async()=>({gear:[{id:"sword",rank:1,value:100,equipmentType:"Оружие"},{id:"zacharovanie-ostroty",rank:1,value:20,equipmentType:"Усовершенствование"}]}),
    getGearIndex:async()=>[source("sword"),source("zacharovanie-ostroty")],getMagicDocuments:async()=>[],
    getManifest:async()=>[{productId:"zacharovanie-ostroty",decision:"simple-implemented",profile:{type:"Зачарование",rank:1,compatibility:["weapon"]}}]});
  let id=0;const generated=await catalog.generate({...form,includeCoins:false,enableUpgrades:true,upgradeChance:100,itemCount:1,optimalItemQuantity:1,budgetValue:120},{random:()=>0,createInstanceKey:()=>String(++id)});
  assert.equal(generated.rows.length,1);assert.equal(generated.rows[0].descriptor.upgrades[0].sourceId,"zacharovanie-ostroty");
  assert.equal(generated.rows[0].value,120);assert.equal(generated.spentValue,120);
});
