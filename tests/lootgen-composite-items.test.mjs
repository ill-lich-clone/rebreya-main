import test from "node:test";
import assert from "node:assert/strict";
import { generateLootgenResult } from "../scripts/data/lootgen-generator.js";

const manifest=[{productId:"zacharovanie-ostroty",decision:"simple-implemented",profile:{compatibility:["weapon"],type:"Зачарование",rank:1}},
  {productId:"ognennaya-maz",decision:"simple-implemented",profile:{compatibility:["weapon"],type:"Материал",rank:1}}];
const prices={sword:1000,"zacharovanie-ostroty":200,"ognennaya-maz":300};
const catalogReader={resolveValueComponent:({sourceId})=>({unitValue:prices[sourceId],priceKnown:Object.hasOwn(prices,sourceId)}),
  describeUpgradeHost:()=>({quantity:1,capacity:2,compatibilityTags:["weapon"]})};
function options(budget=1500){let id=0;return {form:{enableUpgrades:true,upgradeChance:100,maxUpgradesPerItem:2,budgetValue:budget,itemCount:1,includeCoins:false},
  mundanePool:[{sourceType:"gear",sourceId:"sword",name:"Sword",value:1000,rank:1,stackable:false}],manifest,catalogReader,random:()=>0,createInstanceKey:()=>`instance-${++id}`};}

test("generator budgets the entire composed host and gives a separate identity to each copy",()=>{
  const exact=generateLootgenResult(options());
  assert.equal(exact.spentValue,1500);assert.equal(exact.rows[0].descriptor.upgrades.length,2);assert.equal(exact.rows[0].quantity,1);
  const short=generateLootgenResult(options(1499));assert.ok(short.spentValue<=1499);assert.equal(short.rows[0].descriptor.upgrades.length,1);
  const o=options(3000);o.form.itemCount=2;
  const twice=generateLootgenResult(o);assert.equal(twice.rows.length,2);assert.equal(twice.spentValue,3000);
  assert.notEqual(twice.rows[0].descriptor.instanceKey,twice.rows[1].descriptor.instanceKey);
});

test("capacity, availability, type/rank filters and zero chance bound generated composition",()=>{
  const o=options();o.catalogReader={...catalogReader,describeUpgradeHost:()=>({quantity:1,capacity:1,compatibilityTags:["weapon"]})};
  assert.equal(generateLootgenResult(o).rows[0].descriptor.upgrades.length,1);
  for(const patch of [{upgradeChance:0},{upgradeTypes:["Проклятье"]},{upgradeRanks:[10]}]) {
    const next=options();Object.assign(next.form,patch);const r=generateLootgenResult(next);assert.equal(r.rows[0].descriptor,undefined);assert.equal(r.spentValue,1000);
  }
  const next=options();next.manifest=manifest.map(r=>({...r,decision:"simple-candidate"}));
  assert.equal(generateLootgenResult(next).rows[0].descriptor,undefined);
});

test("disabled options preserve exact legacy result and random consumption",()=>{
  let calls=0;const base={mundanePool:[{sourceType:"gear",sourceId:"ration",name:"Ration",rank:0,value:10,multipleAppearance:"1"}],budgetValue:41,itemCount:1,includeCoins:true,random:()=>{calls++;return 0.3;}};
  const legacy=generateLootgenResult(base),expectedCalls=calls;calls=0;
  const disabled=generateLootgenResult({...base,enableUpgrades:false,upgradeChance:100,manifest,catalogReader,createInstanceKey:()=>assert.fail("No identity allocation")});
  assert.deepEqual(disabled,legacy);assert.equal(calls,expectedCalls);
});

test("composed generation rejects unsafe budgets and excludes unknown component prices",()=>{
  assert.throws(()=>generateLootgenResult(options(Number.MAX_SAFE_INTEGER+1)));
  const o=options();o.catalogReader={...catalogReader,resolveValueComponent:()=>({priceKnown:false})};
  assert.throws(()=>generateLootgenResult(o),/доступных|цен/u);
});

test("one result rejects repeated instance identities across individually valid variants",()=>{
  const o=options(3000);o.form.itemCount=2;let i=0;o.createInstanceKey=()=>['host','upgrade1','upgrade2'][i++%3];
  assert.throws(()=>generateLootgenResult(o),/Повторный идентификатор/u);
});

test("composed generation counts upgrade documents inside the maximum forty host rows",()=>{
  const o=options(1000000);o.form.itemCount=1000;o.form.maxUpgradesPerItem=3;
  o.manifest=[...manifest,{productId:"test-third",decision:"simple-implemented",profile:{compatibility:["weapon"],type:"Материал",rank:1}}];
  o.catalogReader={resolveValueComponent:({sourceId})=>({priceKnown:true,unitValue:sourceId==="test-third"?100:prices[sourceId]}),
    describeUpgradeHost:()=>({quantity:1,capacity:3,compatibilityTags:["weapon"]})};
  const result=generateLootgenResult(o);
  assert.equal(result.rows.length,40);assert.equal(result.rows.reduce((n,row)=>n+1+row.descriptor.upgrades.length,0),160);
  assert.equal(result.spentValue,64000);
});

test("incompatible upgrade candidates exhaust the shared attempt allowance without a runaway search",()=>{
  const o=options(1000000);o.form.itemCount=40;let randomCalls=0;o.random=()=>{randomCalls++;return 0;};
  o.manifest=Array.from({length:3000},(_,i)=>({productId:`incompatible-${i}`,decision:"simple-implemented",profile:{compatibility:["armor"],type:"Материал",rank:1}}));
  const result=generateLootgenResult(o);
  assert.ok(randomCalls<=2000);assert.equal(result.rows.length,1);assert.equal(result.rows[0].descriptor,undefined);
  assert.equal(result.spentValue,1000);
});

test("zero priced variants stay bounded and invalid authoritative prices never enter loot",()=>{
  const o=options(100);o.form.itemCount=4;o.catalogReader={...catalogReader,resolveValueComponent:()=>({priceKnown:true,unitValue:0})};
  const result=generateLootgenResult(o);assert.equal(result.rows.length,4);assert.equal(result.spentValue,0);
  for(const unitValue of [-1,Number.MAX_SAFE_INTEGER+1,NaN])
    assert.throws(()=>generateLootgenResult({...options(),catalogReader:{...catalogReader,resolveValueComponent:()=>({priceKnown:true,unitValue})}}),/доступных|цен/u);
  assert.equal(generateLootgenResult(options(-1)).spentValue,0);
});

test("broken composed hosts price both the shell and installed children with the same broken state",()=>{
  const o=options();o.form.brokenEquipmentChance=100;o.mundanePool[0].breakable=true;const reads=[];
  o.catalogReader={...catalogReader,resolveValueComponent:descriptor=>{reads.push(descriptor);return catalogReader.resolveValueComponent(descriptor);}};
  const result=generateLootgenResult(o),row=result.rows[0];
  assert.equal(row.isBroken,true);assert.equal(row.descriptor.isBroken,true);assert.equal(result.spentValue,1500);
  for(const sourceId of Object.keys(prices))assert.ok(reads.some(d=>d.sourceId===sourceId&&d.isBroken===true));
});

test("zero and full coin reserves share the composed budget exactly once",()=>{
  for(const percent of [0,100]){
    const o=options(1500);o.form.includeCoins=true;o.form.coinBudgetPercent=percent;const result=generateLootgenResult(o);
    assert.equal(result.spentValue+result.coins.totalCopper,1500);
    assert.equal(result.spentValue,percent===0?1500:0);assert.equal(result.rows.length,percent===0?1:0);
  }
});
