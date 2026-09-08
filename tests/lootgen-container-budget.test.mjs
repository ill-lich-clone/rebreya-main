import test from "node:test";
import assert from "node:assert/strict";
import { generateLootgenResult, normalizeLootgenForm } from "../scripts/data/lootgen-generator.js";
import { createLootgenCatalogReader } from "../scripts/data/lootgen-catalog-reader.js";
import { evaluateItemValue } from "../scripts/data/item-value.js";

function fixture({budgetValue=10000,includeCoins=true,coinBudgetPercent=20,generationDepth=1,itemCount=1,chestValue=1000,childValue=1000,weightCapacity=100,childWeight=1,volumeKnown=true,weightlessContents=false}={}){
  const model={gear:[{id:"chest",value:chestValue},{id:"blade",value:childValue},{id:"zacharovanie-ostroty",value:200}]};
  const source=(id,type,system)=>({_id:id,type,system,flags:{"rebreya-main":{managed:true,gearId:id}}});
  const gearIndex=[source("chest","container",{quantity:1,properties:weightlessContents?["weightlessContents"]:[],capacity:{weight:{value:weightCapacity,units:"lb"},volume:{value:100,units:"ft3"}},weight:{value:5,units:"lb"},volume:volumeKnown?{value:5,units:"ft3"}:undefined}),
    source("blade","weapon",{type:{value:"martialM"},quantity:1,weight:{value:childWeight,units:"lb"},volume:volumeKnown?{value:1,units:"ft3"}:undefined}),
    source("zacharovanie-ostroty","loot",{weight:{value:1,units:"lb"},volume:{value:0,units:"ft3"}})];
  const manifest=[{productId:"zacharovanie-ostroty",decision:"simple-implemented",profile:{type:"Зачарование",rank:1,compatibility:["weapon"]}}];
  const catalogReader=createLootgenCatalogReader({model,gearIndex,manifest});
  const form=normalizeLootgenForm({budgetValue,includeCoins,coinBudgetPercent,generationDepth,itemCount,enableFilledContainers:true,filledContainerChance:100,includeMagicItems:false,enableUpgrades:true,upgradeChance:100,maxUpgradesPerItem:1});
  const mundanePool=[{sourceType:"gear",sourceId:"chest",name:"Сундук",value:chestValue,stackable:false},{sourceType:"gear",sourceId:"blade",name:"Клинок",value:childValue,stackable:true,multipleAppearance:"1"}];
  return {form,mundanePool,magicPool:[],catalogReader,manifest};
}

function run(options){let id=0;return generateLootgenResult({...options,random:()=>0,createInstanceKey:()=>`instance-${++id}`,batchId:"fixed",generatedAt:"fixed"});}

function walk(rows){const descriptors=[];const visit=d=>{descriptors.push(d);for(const row of [...(d.container?.state.manualRows??[]),...(d.container?.state.generatedRows??[])])visit({...row.composition,quantity:row.quantity,container:row.container??null});};for(const row of rows)visit(row.descriptor);return descriptors;}

test("filled container generation spends one shared item and coin budget with upgraded children",()=>{
  const options=fixture(),result=run(options);
  assert.ok(result.rows[0].descriptor.container);
  assert.ok(walk(result.rows).some(d=>d.upgrades.length));
  const treeValue=result.rows.reduce((sum,row)=>sum+evaluateItemValue(row.descriptor,options.catalogReader).totalValue,0);
  assert.equal(treeValue+result.coins.totalCopper+result.unusedValue,10000);
  assert.equal(result.spentValue+result.currencyValue,result.totalValue);
  assert.equal(result.totalValue+result.unusedValue,10000);
  assert.equal(result.totalItems,1);
  assert.equal(result.rows[0].quantity,1);
});

test("budget boundaries, zero prices and disabled currency preserve nonnegative exact accounting",()=>{
  for(const config of [{budgetValue:0},{budgetValue:1000},{budgetValue:999},{coinBudgetPercent:0},{coinBudgetPercent:100},{includeCoins:false},{chestValue:0,childValue:0,budgetValue:0}]){
    const options=fixture(config),result=run(options);
    assert.ok(result.unusedValue>=0);assert.ok(result.spentValue>=0);
    assert.equal(result.spentValue+result.currencyValue+result.unusedValue,options.form.budgetValue);
    assert.equal(result.rows.reduce((sum,row)=>sum+row.totalValue,0)+result.coins.totalCopper+result.unusedValue,options.form.budgetValue);
    if(config.includeCoins===false)assert.equal(result.currencyValue,0);
  }
});

test("shared limits bound recursive nesting and distinguish identical shells",()=>{
  const options=fixture({generationDepth:3,itemCount:40,chestValue:0,childValue:0,budgetValue:0});options.form.enableUpgrades=false;
  const result=run(options),nodes=walk(result.rows);
  assert.ok(nodes.length<=200);assert.ok(result.rows.length<=40);
  assert.equal(new Set(nodes.map(d=>d.instanceKey)).size,nodes.length);
  const depth=d=>d.container?1+Math.max(0,...[...d.container.state.manualRows,...d.container.state.generatedRows].map(row=>depth({...row.composition,container:row.container??null}))):0;
  assert.ok(result.rows.every(row=>depth(row.descriptor)<=3));
  assert.ok(result.diagnostics.some(d=>d.reason==="document-limit"));
});

test("rejected heavy contents restore reservations and leave an ordinary valid shell",()=>{
  const options=fixture({weightCapacity:0,includeCoins:false});options.form.enableUpgrades=false;
  const result=run(options);
  assert.equal(result.rows[0].descriptor.container,null);
  assert.equal(result.spentValue,1000);assert.equal(result.unusedValue,9000);
  assert.ok(result.diagnostics.some(d=>d.reason==="weight-capacity"));
});

test("known weight permits filling when catalog volumes are absent, with an explicit diagnostic",()=>{
  const result=run(fixture({volumeKnown:false,includeCoins:false}));
  assert.ok(result.rows[0].descriptor.container);
  assert.ok(result.diagnostics.some(d=>d.reason==="volume-unverified"));
});

test("fixed random and identity factories reproduce the complete canonical tree",()=>{
  const options=fixture({generationDepth:3});assert.deepEqual(run(options),run(options));
});

test("old templates default to disabled filling and preserve the old generation stream",()=>{
  const base={mundanePool:[{sourceType:"gear",sourceId:"blade",name:"Клинок",value:10,multipleAppearance:"1"}],form:{budgetValue:50,itemCount:1,includeCoins:true,includeMagicItems:false}};
  const a=[],b=[];const first=generateLootgenResult({...base,random:()=>{a.push(0.2);return 0.2;}});
  const second=generateLootgenResult({...base,form:{...base.form,enableFilledContainers:false},random:()=>{b.push(0.2);return 0.2;}});
  assert.deepEqual(first,second);assert.deepEqual(a,b);
  assert.equal(normalizeLootgenForm({}).enableFilledContainers,false);
  assert.equal(normalizeLootgenForm({}).generationDepth,1);
  assert.equal(normalizeLootgenForm({generationDepth:20}).generationDepth,3);
});

test("the same cap includes installed children and upgrade attempts cannot restart the search budget",()=>{
  const options=fixture({budgetValue:1000000,itemCount:40,generationDepth:3});
  const result=run(options),nodes=walk(result.rows);
  assert.ok(nodes.reduce((sum,d)=>sum+1+d.upgrades.length,0)<=200);
  options.manifest=Array.from({length:2001},(_,i)=>({productId:`incompatible-${i}`,decision:"simple-implemented",profile:{type:"Зачарование",rank:1,compatibility:["armor"]}}));
  assert.ok(run(options).diagnostics.some(d=>d.reason==="attempt-limit"));
});

test("unknown prices are diagnosed and unsafe budget or random input never produce a tree",()=>{
  const options=fixture();options.mundanePool.push({sourceType:"gear",sourceId:"unknown",value:0,name:"Неизвестно"});
  assert.ok(run(options).diagnostics.some(d=>d.reason==="unknown-price" && d.sourceId==="unknown"));
  for(const budgetValue of [Number.MAX_SAFE_INTEGER+1,Infinity])assert.throws(()=>run({...options,form:{...options.form,budgetValue}}));
  for(const random of [()=>1,()=>NaN,()=>-0.1])assert.throws(()=>generateLootgenResult({...options,random}));
});

test("weightless nested contents fit by carried weight while ordinary loaded containers still fail the same parent limit",()=>{
  const options={generationDepth:2,includeCoins:false,weightCapacity:5};
  const normal=run(fixture(options)),weightless=run(fixture({...options,weightlessContents:true}));
  assert.equal(normal.rows[0].descriptor.container.state.manualRows.some(row=>row.container),false);
  assert.equal(weightless.rows[0].descriptor.container.state.manualRows.some(row=>row.container),true);
});

test("two identical top-level shells remain separate physical instances",()=>{
  const options=fixture({itemCount:2,budgetValue:2000,includeCoins:false});options.form.filledContainerChance=0;
  const result=run(options);assert.equal(result.rows.length,2);
  assert.equal(result.rows[0].sourceId,result.rows[1].sourceId);
  assert.notEqual(result.rows[0].descriptor.instanceKey,result.rows[1].descriptor.instanceKey);
});
