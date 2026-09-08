import test from "node:test";
import assert from "node:assert/strict";
import { resolveLootgenContainerProfile, canFitLootgenContents, debitLootgenBudget } from "../scripts/data/lootgen-container-rules.js";

const container=(capacity,properties=[])=>({type:"container",system:{capacity,properties}});
const weight=(value,units="lb")=>({value,units});
const item=(value,quantity=1)=>({quantity,weight:weight(value),upgrades:[]});

test("container profiles require explicit finite capacity and supported units",()=>{
  assert.deepEqual(resolveLootgenContainerProfile(container({count:3,weight:weight(2,"kg"),volume:{value:1,units:"ft3"}},["weightlessContents"])),{
    eligible:true,reason:null,capacity:{count:3,weightLb:5,volumeFt3:1},weightlessContents:true
  });
  for(const raw of [{type:"loot"},container({}),container({weight:weight(-1)}),container({weight:weight(Infinity)}),container({weight:weight(1,"unknown")}),container({count:0.5}),container({count:1,weight:"corrupt"}),container({count:1,volume:[]})]){
    assert.equal(resolveLootgenContainerProfile(raw).eligible,false);
  }
  assert.equal(resolveLootgenContainerProfile(container({weight:weight(0)})).capacity.weightLb,0);
});

test("filling includes occupied space, quantities and installed upgrade weight",()=>{
  const profile=resolveLootgenContainerProfile(container({weight:weight(10),count:4}));
  assert.equal(canFitLootgenContents({profile,currentContents:[item(2,2)],candidate:{...item(4),upgrades:[{weight:weight(2)}]}}).fits,true);
  assert.equal(canFitLootgenContents({profile,currentContents:[item(2,2)],candidate:{...item(4),upgrades:[{weight:weight(3)}]}}).reason,"weight-capacity");
  assert.equal(canFitLootgenContents({profile,currentContents:[item(0,4)],candidate:item(0)}).reason,"count-capacity");
  assert.equal(canFitLootgenContents({profile,currentContents:[],candidate:item(2,0)}).fits,false);
});

test("weightless contents affect carried child weight without removing the parent hard limit",()=>{
  const profile=resolveLootgenContainerProfile(container({weight:weight(10)},["weightlessContents"]));
  assert.equal(canFitLootgenContents({profile,candidate:item(11)}).reason,"weight-capacity");
  const nested={...item(5),isContainer:true,contentsWeight:weight(20),weightlessContents:false};
  assert.equal(canFitLootgenContents({profile,candidate:nested}).fits,false);
  assert.equal(canFitLootgenContents({profile,candidate:{...nested,weightlessContents:true}}).fits,true);
  assert.equal(canFitLootgenContents({profile,candidate:{...nested,quantity:2}}).fits,false);
  assert.equal(canFitLootgenContents({profile,candidate:{...nested,contentsWeight:undefined}}).fits,false);
});

test("volume conversion checks known occupied and candidate volumes and fails closed on missing measurements",()=>{
  const profile=resolveLootgenContainerProfile(container({volume:{value:1,units:"cubicFoot"}}));
  const candidate={...item(0),volume:{value:28,units:"liter"}};
  assert.equal(canFitLootgenContents({profile,candidate}).fits,true);
  assert.equal(canFitLootgenContents({profile,currentContents:[{...item(0),volume:{value:1,units:"liter"}}],candidate}).reason,"volume-capacity");
  assert.equal(canFitLootgenContents({profile,candidate:item(0)}).reason,"unknown-volume");
  assert.equal(canFitLootgenContents({profile,candidate:{...candidate,upgrades:[{weight:weight(0)}]}}).reason,"unknown-volume");
});

test("capacity calculations reject bad measurements and do not mutate projections",()=>{
  const profile=resolveLootgenContainerProfile(container({weight:weight(0.3)}));
  const currentContents=[item(0.1)],candidate=item(0.2),before=structuredClone({profile,currentContents,candidate});
  assert.equal(canFitLootgenContents({profile,currentContents,candidate}).fits,true);
  assert.deepEqual({profile,currentContents,candidate},before);
  for(const value of [undefined,NaN,-1,Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(canFitLootgenContents({profile,candidate:item(value)}).fits,false);
  assert.equal(canFitLootgenContents({profile,candidate:{...item(1),weight:weight(1,"unknown")}}).fits,false);
  assert.equal(canFitLootgenContents({profile:{eligible:false},candidate:item(1)}).fits,false);
  const countProfile=resolveLootgenContainerProfile(container({count:1000000000000000}));
  assert.equal(canFitLootgenContents({profile:countProfile,candidate:item(0,1000000000000001)}).fits,false);
});

test("budget debit accepts safe exact values and never borrows another budget",()=>{
  assert.equal(debitLootgenBudget(10000,7000),3000);
  assert.equal(debitLootgenBudget(0,0),0);
  assert.equal(debitLootgenBudget(Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),0);
  for(const [remaining,amount] of [[0,1],[1,-1],[NaN,0],[1.1,1],[1,Infinity],[Number.MAX_SAFE_INTEGER+1,0]])assert.throws(()=>debitLootgenBudget(remaining,amount),RangeError);
});

test("known-only volume policy keeps weight/count limits and rejects volume-only unknown contents",()=>{
  const profile=resolveLootgenContainerProfile(container({weight:weight(10),volume:{value:1,units:"ft3"}}));
  assert.equal(canFitLootgenContents({profile,candidate:item(2),allowUnknownVolume:true}).fits,true);
  assert.equal(canFitLootgenContents({profile,candidate:item(11),allowUnknownVolume:true}).reason,"weight-capacity");
  const volumeOnly=resolveLootgenContainerProfile(container({volume:{value:1,units:"ft3"}}));
  assert.equal(canFitLootgenContents({profile:volumeOnly,candidate:item(1),allowUnknownVolume:true}).fits,false);
  assert.equal(canFitLootgenContents({profile,candidate:{...item(1),volume:{value:2,units:"ft3"}},allowUnknownVolume:true}).fits,false);
});
