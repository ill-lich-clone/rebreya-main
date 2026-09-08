import test from "node:test";
import assert from "node:assert/strict";
import { buildLootgenGeneratedState, readLootgenCatalogFingerprint, assertLootgenCatalogCurrent } from "../scripts/application/lootgen-generated-state.js";
import { LootgenSourceCatalog } from "../scripts/data/lootgen-source-catalog.js";
import { readLootgenPreparedComposition } from "../scripts/data/lootgen-prepared-item.js";
import { StorageContainerItemService } from "../scripts/data/storage-container-item-service.js";
const profile={type:"Зачарование",rank:1,compatibility:["weapon"]};
function fixture(){
  const source=id=>({_id:id,type:id==="sword"?"weapon":"loot",system:{type:{value:"martialM"}},flags:{"rebreya-main":{managed:true,gearId:id}}});
  const catalog=new LootgenSourceCatalog({getModel:async()=>({gear:[{id:"sword",name:"Sword",rank:1,value:100,equipmentType:"Оружие"},{id:"zacharovanie-ostroty",name:"Sharp",rank:1,value:20,equipmentType:"Усовершенствование"}]}),getGearIndex:async()=>[source("sword"),source("zacharovanie-ostroty")],getMagicDocuments:async()=>[],getManifest:async()=>[{productId:"zacharovanie-ostroty",decision:"simple-implemented",profile}]});
  let id=0;return {catalog,createDocumentId:()=>String(++id).padStart(16,"0"),random:()=>0,
    buildItemData:async(row)=>({name:row.sourceId,type:row.sourceId==="sword"?"weapon":"loot",system:{quantity:row.quantity,price:{value:row.sourceId==="sword"?1:0.2,denomination:"gp"}},flags:{"rebreya-main":{sourceType:row.sourceType,sourceId:row.sourceId}}})};
}
const form={rankMin:1,rankMax:1,includeGear:true,includeMagicItems:false,includeCoins:false,enableUpgrades:true,upgradeChance:100,itemCount:1,optimalItemQuantity:1,budgetValue:120};
test("generated state contains one fully prepared graph, complete value and automation summary",async()=>{
  const state=await buildLootgenGeneratedState(form,{operationId:"op",lootId:"loot",authorId:"gm"},fixture());
  assert.equal(state.rows.length,1);const row=state.rows[0];
  assert.equal(row.quantity,1);assert.equal(row.totalValue,120);assert.equal(state.spentValue,120);
  assert.equal(readLootgenPreparedComposition(row.itemData).unitValue,120);
  assert.equal(row.upgrades[0].name,"Sharp");assert.equal(row.upgrades[0].decision,"simple-implemented");
  assert.equal(row.itemData.flags["rebreya-main"].runtimeItemGraph.nodes.length,2);
  assert.equal(row.itemData.flags["rebreya-main"].lootgenChat,undefined);
  assert.equal(row.claimed,false);assert.equal(typeof state.catalogFingerprint,"string");
});
test("catalog signature changes with the profile",async()=>{
  const a=fixture(),b=fixture();b.catalog.getManifest=async()=>[{productId:"zacharovanie-ostroty",decision:"simple-implemented",profile:{...profile,activation:"carried"}}];
  const first=await buildLootgenGeneratedState(form,{operationId:"op",lootId:"loot",authorId:"gm"},a);
  const second=await buildLootgenGeneratedState(form,{operationId:"op",lootId:"loot",authorId:"gm"},b);
  assert.notEqual(first.catalogFingerprint,second.catalogFingerprint);
});

test("catalog fingerprint ignores random instance identity and tracks template modification",async()=>{
  const f=fixture(),state=await buildLootgenGeneratedState(form,{operationId:"op",lootId:"loot",authorId:"gm"},f);
  const snapshot=await f.catalog.load(form),descriptor=state.rows[0].descriptor;
  const original=readLootgenCatalogFingerprint([descriptor],snapshot);
  assert.equal(readLootgenCatalogFingerprint([{...descriptor,instanceKey:"other",upgrades:descriptor.upgrades.map(u=>({...u,instanceKey:"other-child"}))}],snapshot),original);
  snapshot.gearIndex[0]._stats={modifiedTime:123};
  assert.notEqual(readLootgenCatalogFingerprint([descriptor],snapshot),original);
});

test("catalog signature changes with the authoritative source price",async()=>{
  const a=fixture(),b=fixture(),read=b.catalog.getModel;
  b.catalog.getModel=async()=>{const model=await read();model.gear[0].value=90;return model;};
  const first=await buildLootgenGeneratedState(form,{operationId:"op",lootId:"loot",authorId:"gm"},a);
  const second=await buildLootgenGeneratedState(form,{operationId:"op",lootId:"loot",authorId:"gm"},b);
  assert.equal(first.spentValue,120);assert.equal(second.spentValue,110);
  assert.notEqual(first.catalogFingerprint,second.catalogFingerprint);
});

test("catalog gate accepts the saved composition and ignores legacy state",async()=>{
  const f=fixture(), state={...await buildLootgenGeneratedState(form,{operationId:"op",lootId:"loot",authorId:"gm"},f),form,resultVersion:2};
  await assertLootgenCatalogCurrent(state,f.catalog);
  await assertLootgenCatalogCurrent({rows:[]},{load:()=>{throw new Error("legacy must not read catalog");}});
});

test("catalog gate rejects price, availability, missing source and malformed saved descriptors",async()=>{
  for(const change of ["price","availability","missing","descriptor","signature"]){
    const f=fixture(),state={...await buildLootgenGeneratedState(form,{operationId:"op",lootId:"loot",authorId:"gm"},f),form,resultVersion:2};
    const read=f.catalog.getModel;
    if(change==="price")f.catalog.getModel=async()=>{const model=await read();model.gear[0].value=200;return model;};
    if(change==="availability")f.catalog.getManifest=async()=>[{productId:"zacharovanie-ostroty",decision:"unavailable",profile}];
    if(change==="missing")f.catalog.getGearIndex=async()=>[];
    if(change==="descriptor")delete state.rows[0].descriptor;
    if(change==="signature")delete state.catalogFingerprint;
    await assert.rejects(assertLootgenCatalogCurrent(state,f.catalog),{code:"lootgen-result-stale"},change);
    assert.equal(state.rows[0].claimed,false);
  }
});

test("catalog transport failure remains retryable without relabelling it as catalog drift",async()=>{
  const f=fixture(),state={...await buildLootgenGeneratedState(form,{operationId:"op",lootId:"loot",authorId:"gm"},f),form,resultVersion:2};
  await assert.rejects(assertLootgenCatalogCurrent(state,{load:async()=>{throw new Error("catalog read offline");}}),/catalog read offline/u);
});

function filledFixture() {
  const options=fixture(),readModel=options.catalog.getModel,readIndex=options.catalog.getGearIndex;
  options.catalog.getModel=async()=>{const model=await readModel();model.gear.push({id:"chest",name:"Chest",rank:1,value:30,equipmentType:"Хранилище"});return model;};
  options.catalog.getGearIndex=async()=>[...(await readIndex()).map(row=>({...row,system:{...row.system,weight:{value:1,units:"lb"}}})),
    {_id:"chest",type:"container",system:{quantity:1,weight:{value:2,units:"lb"},capacity:{weight:{value:100,units:"lb"}}},flags:{"rebreya-main":{managed:true,gearId:"chest"}}}];
  const build=options.buildItemData;
  options.buildItemData=async row=>row.sourceId==="chest"?{name:"Chest",type:"container",system:{quantity:1,price:{value:.3,denomination:"gp"},capacity:{weight:{value:100,units:"lb"}}},flags:{}}:build(row);
  const service=new StorageContainerItemService();options.prepareContainerGraph=(snapshot,adapters)=>service.prepareItemGraph(snapshot,adapters);
  return options;
}
const filledForm={...form,budgetValue:500,enableFilledContainers:true,filledContainerChance:100,generationDepth:1};

test("generated filled loot is persisted as a validated complete graph with one budget",async()=>{
  for(const enableUpgrades of [false,true]){
    const state=await buildLootgenGeneratedState({...filledForm,enableUpgrades},{operationId:"filled",lootId:"loot",authorId:"gm"},filledFixture());
    assert.ok(state.rows[0].descriptor.container);assert.ok(readLootgenPreparedComposition(state.rows[0].itemData));
    assert.equal(state.rows.length,1);assert.equal(state.rows[0].itemData.flags['rebreya-main'].lootgenChat,undefined);
    assert.equal(state.spentValue+state.currencyValue+state.unusedValue,500);
    assert.equal(state.rows[0].totalValue+state.coins.totalCopper+state.unusedValue,500);
  }
});

test("filled catalog gate tracks child prices, physical capacities and coin weight",async()=>{
  const options=filledFixture(),state={...await buildLootgenGeneratedState(filledForm,{operationId:"filled",lootId:"loot",authorId:"gm"},options),form:filledForm,resultVersion:2};
  await assertLootgenCatalogCurrent(state,options.catalog);
  const snapshot=await options.catalog.load(filledForm),original=readLootgenCatalogFingerprint(state.rows.map(row=>row.descriptor),snapshot);
  snapshot.coinWeightPerCoinLb*=2;
  assert.notEqual(readLootgenCatalogFingerprint(state.rows.map(row=>row.descriptor),snapshot),original);
  const read=options.catalog.getGearIndex;
  options.catalog.getGearIndex=async()=>{const index=await read();index.find(row=>row._id==="chest").system.capacity.weight.value=1;return index;};
  await assert.rejects(assertLootgenCatalogCurrent(state,options.catalog),{code:"lootgen-result-stale"});
});
