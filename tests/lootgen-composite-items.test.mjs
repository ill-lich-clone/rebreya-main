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
