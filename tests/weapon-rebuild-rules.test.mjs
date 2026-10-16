import test from "node:test";
import assert from "node:assert/strict";
import {optionalModule,required,makeHost,makeCandidate,makeInstalled} from "./helpers/weapon-mod-fixture.mjs";
const rules=await optionalModule(new URL("../scripts/data/weapon-rebuild-rules.js",import.meta.url)),quote=required(rules,"buildWeaponRebuildQuote");
const input=()=>({host:makeHost("vintovka"),component:makeCandidate("oblegchyonnyy-korpus"),parts:[],currency:{gp:500}});
test("one modernization costs exactly 500gp without calendar or project state",()=>{
  const q=quote(input());assert.equal(q.costCp,50000);assert.equal(q.beforeCp-q.afterCp,50000);assert.equal(q.afterCp,0);
  assert.equal(q.days,undefined);assert.equal(q.calendar,undefined);assert.equal(q.project,undefined);
  assert.throws(()=>quote({...input(),currency:{gp:499}}),e=>e.code==="insufficient-funds");
});
test("mixed coins, unknown component price and detached currency preserve the exact debit",()=>{
  const source=input();source.currency={gp:499,pp:1,ep:1,sp:1,cp:1};source.component.priceKnown=false;
  const before=structuredClone(source),q=quote(source);assert.equal(q.beforeCp,50961);assert.equal(q.afterCp,961);assert.deepEqual(source,before);
  for(const currency of [{gp:-1},{gp:500.5},{gp:Infinity},{gp:Number.MAX_SAFE_INTEGER}])assert.throws(()=>quote({...input(),currency}));
});
test("capacity replacement has one fee and improved grip also costs its own 500gp",()=>{
  const host=makeHost("vintovka",{form:"short",baseForm:"short",modelTags:["firearm","all-firearms","short-firearm","magazine-fed-firearm"]});
  const parts=[makeInstalled("pistoletnaya-rukoyat","grip"),makeInstalled("oblegchyonnyy-korpus","body"),makeInstalled("rasshirennaya-oboyma","mag")];
  const improved=quote({host,parts,component:makeCandidate("uluchshennaya-pistoletnaya-rukoyat"),currency:{gp:500}});
  assert.equal(improved.costCp,50000);assert.equal(improved.afterCp,0);
  const replacement=quote({host,parts,component:makeCandidate("giganskaya-oboyma"),removeItemId:"mag",currency:{gp:500}});
  assert.equal(replacement.costCp,50000);assert.equal(replacement.afterCp,0);
});
test("payment preserves untouched coin denominations and only makes change when needed",()=>{
  const currency={pp:4,gp:600,ep:5,sp:12,cp:17};
  assert.deepEqual(quote({...input(),currency}).currencyAfter,{...currency,gp:100});
  const change=quote({...input(),currency:{pp:1,gp:499}});
  assert.equal(change.beforeCp-change.afterCp,50000);assert.deepEqual(change.currencyAfter,{pp:0,gp:9});
});
