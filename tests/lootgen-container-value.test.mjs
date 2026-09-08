import test from "node:test";
import assert from "node:assert/strict";
import { evaluateItemValue } from "../scripts/data/item-value.js";
import { buildStorageContainerSnapshot, buildStorageContainerRow, rekeyStorageContainerSnapshot } from "../scripts/data/storage-container-snapshot.js";
import { makeValuedContainer } from "./helpers/lootgen-container-fixture.mjs";
import { readContainerValueNodes } from "../scripts/data/lootgen-container-value-adapter.js";

test("canonical container value counts shell, upgrades, contents and currency exactly once",()=>{
  const {descriptor,catalogReader}=makeValuedContainer();const before=structuredClone(descriptor);
  assert.deepEqual(evaluateItemValue(descriptor,catalogReader),{baseValue:1000,upgradeValue:2000,contentsValue:4000,totalValue:7000,diagnostics:[]});
  assert.equal(evaluateItemValue(descriptor,catalogReader).totalValue+3000,10000);
  assert.deepEqual(descriptor,before);
});

test("remaining manual/generated currency and claimed children use the existing storage flags",()=>{
  const {descriptor,catalogReader}=makeValuedContainer();const state=descriptor.container.state;
  state.generatedCoins={gp:2,sp:1};state.manualCoins={pp:1,cp:5,totalCopper:999999};
  assert.equal(evaluateItemValue(descriptor,catalogReader).contentsValue,4215);
  state.claimedRowIds=["child-row"];
  assert.equal(evaluateItemValue(descriptor,catalogReader).contentsValue,1215);
  state.coinsClaimed=true;
  assert.equal(evaluateItemValue(descriptor,catalogReader).totalValue,3000);
});

function addNested(descriptor,index){
  const state=descriptor.container.state;
  const metadata={version:2,instanceKey:`nested-${index}`,sourceType:"gear",sourceId:"shell",isBroken:false,upgrades:[]};
  const container=buildStorageContainerSnapshot({containerId:`container-${index}`,state:{lootgenComposition:metadata,manualRows:[],generatedRows:[],manualCoins:{},generatedCoins:{}}});
  state.manualRows.push(buildStorageContainerRow(container,{rowId:`row-${index}`}));
  return {...metadata,quantity:1,container:state.manualRows.at(-1).container};
}

test("nested shell composition survives snapshot normalization and rekey without a second tree",()=>{
  const {descriptor,catalogReader}=makeValuedContainer();addNested(descriptor,1);
  const normalized=buildStorageContainerSnapshot(descriptor.container);
  assert.deepEqual(normalized.state.manualRows[1].composition,normalized.state.manualRows[1].container.state.lootgenComposition);
  assert.equal(Object.hasOwn(normalized.state.manualRows[1].composition,"container"),false);
  let n=0;const rekeyed=rekeyStorageContainerSnapshot(normalized,{createId:()=>`new-${++n}`});
  assert.equal(rekeyed.state.manualRows[1].sourceId,"shell");
  assert.equal(evaluateItemValue({...descriptor,container:rekeyed},catalogReader).totalValue,8000);
});

test("one traversal detects shared host/upgrade/container identities and cycles",()=>{
  for(const corrupt of [
    d=>d.container.state.manualRows.push(structuredClone(d.container.state.manualRows[0])),
    d=>d.container.state.manualRows[0].composition.instanceKey=d.upgrades[0].instanceKey,
    d=>{const child=addNested(d,1);child.container.containerId=d.container.containerId;},
    d=>{const row=d.container.state.manualRows[0];row.container=d.container;row.rowKind="container";row.composition={...d.container.state.lootgenComposition,instanceKey:"cycle-host"};}
  ]) {const {descriptor,catalogReader}=makeValuedContainer();corrupt(descriptor);assert.throws(()=>evaluateItemValue(descriptor,catalogReader));}
});

test("runtime depth eight remains supported and depth nine is rejected",()=>{
  const {descriptor,catalogReader}=makeValuedContainer();let parent=descriptor;
  for(let n=1;n<=8;n++)parent=addNested(parent,n);
  assert.equal(evaluateItemValue(descriptor,catalogReader).totalValue,15000);
  addNested(parent,9);
  assert.throws(()=>evaluateItemValue(descriptor,catalogReader),e=>e.code==="container-depth");
});

test("shared document cap includes upgrade nodes",()=>{
  const {descriptor,catalogReader}=makeValuedContainer();const rows=descriptor.container.state.manualRows;
  for(let n=1;n<198;n++)rows.push({...structuredClone(rows[0]),rowId:`row-${n}`,composition:{...rows[0].composition,instanceKey:`child-${n}`}});
  assert.equal(rows.length,198);
  assert.doesNotThrow(()=>evaluateItemValue(descriptor,catalogReader));
  rows.push({...structuredClone(rows[0]),rowId:"overflow",composition:{...rows[0].composition,instanceKey:"overflow"}});
  assert.throws(()=>evaluateItemValue(descriptor,catalogReader),e=>e.code==="document-limit");
});

test("unknown legacy composition fails pricing but remains a valid portable snapshot",()=>{
  const {descriptor,catalogReader}=makeValuedContainer();delete descriptor.container.state.manualRows[0].composition;
  assert.doesNotThrow(()=>buildStorageContainerSnapshot(descriptor.container));
  assert.throws(()=>evaluateItemValue(descriptor,catalogReader),e=>e.code==="unknown-composition");
});

test("unknown/zero child prices, invalid currency and container quantity fail without partial totals",()=>{
  const zero=makeValuedContainer({childValue:0});assert.equal(evaluateItemValue(zero.descriptor,zero.catalogReader).totalValue,4000);
  const unknown=makeValuedContainer({childValue:NaN});assert.throws(()=>evaluateItemValue(unknown.descriptor,unknown.catalogReader),e=>e.code==="unknown-price");
  for(const bad of [-1,0.5,Infinity,Number.MAX_SAFE_INTEGER]){
    const {descriptor,catalogReader}=makeValuedContainer();descriptor.container.state.manualCoins={pp:bad};
    assert.throws(()=>evaluateItemValue(descriptor,catalogReader));
  }
  const {descriptor,catalogReader}=makeValuedContainer();descriptor.quantity=2;
  assert.throws(()=>evaluateItemValue(descriptor,catalogReader),e=>e.code==="invalid-descriptor");
});

test("value projection rejects shell drift, nested metadata trees, duplicate upgrade nodes and unsupported currency",()=>{
  for(const corrupt of [
    d=>d.container.state.lootgenComposition.sourceId="child",
    d=>d.container.state.manualRows[0].composition.container={},
    d=>d.container.state.manualCoins={ep:1},
    d=>{const nested=addNested(d,1);nested.container.state.lootgenComposition.upgrades=structuredClone(d.upgrades);d.container.state.manualRows.at(-1).composition.upgrades=structuredClone(d.upgrades);}
  ]) {const {descriptor,catalogReader}=makeValuedContainer();corrupt(descriptor);assert.throws(()=>evaluateItemValue(descriptor,catalogReader));}
});

test("one-level projection reads currency and detached composition without traversing or duplicating child snapshots",()=>{
  const {descriptor}=makeValuedContainer();addNested(descriptor,1);
  const before=structuredClone(descriptor);
  const projection=readContainerValueNodes(descriptor.container,{shell:descriptor});
  assert.equal(projection.entries.length,2);assert.equal(projection.currencyValue,1000);
  assert.equal(projection.entries[1].container,descriptor.container.state.manualRows[1].container);
  projection.entries[0].sourceId="changed";
  assert.deepEqual(descriptor,before);
});
