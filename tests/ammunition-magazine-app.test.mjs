import test from "node:test";
import assert from "node:assert/strict";
globalThis.foundry={applications:{api:{ApplicationV2:class{async _onRender(){}},HandlebarsApplicationMixin:Base=>Base}}};
const { MagazineDraft, AmmunitionMagazineApp, buildMagazineView }=await import("../scripts/ui/ammunition-magazine-app.js");
const fixture=()=>({capacity:8,groupSize:3,rounds:[],sources:{a:{name:"Обычные"},b:{name:"Огненные"}},stock:[{key:"a",quantity:6},{key:"b",quantity:8}],presets:[],lastPattern:["b","b","b"],revision:"before"});

test("native template identifier has a valid extension for Foundry socket loading",()=>{
  assert.match(AmmunitionMagazineApp.PARTS.main.template,/\.(?:hbs|html|handlebars)$/u);
});

test("rifle cartridges follow the actual two frame edges and stay separated",()=>{
  const value={...fixture(),capacity:24,groupSize:6};
  const slots=buildMagazineView(value,0,{system:{type:{value:"firearmAdvanced"},ammunition:{type:"rebreyaRifle"}}}).cells.flatMap(cell=>cell.slots);
  for(const [i,x,y,angle] of [[0,132.88875,85.66775,-26.0779],[11,139.66757,191.65256,18.02531],[23,99.18091,303.19944,40.32439]]){
    assert.ok(Math.abs(slots[i].x-x)<.02);assert.ok(Math.abs(slots[i].y-y)<.02);assert.ok(Math.abs(slots[i].angle-angle)<.02);
  }
  for(let i=1;i<slots.length;i++){
    const a=slots[i-1],b=slots[i],angle=(a.angle+b.angle)/2*Math.PI/180;
    const spacing=(b.x-a.x)*-Math.sin(angle)+(b.y-a.y)*Math.cos(angle);
    const support=s=>s.width/2*Math.abs(Math.sin(s.angle*Math.PI/180-angle))+s.height/2*Math.abs(Math.cos(s.angle*Math.PI/180-angle));
    assert.ok(spacing>=support(a)+support(b),"cartridge bodies must not intersect");
  }
});

test("primitive and shotgun weapons use their own loading presentation",()=>{
  const cases=[
    [{system:{type:{value:"firearmPrimitive"},ammunition:{type:"rebreyaMusket"}}},1,"muzzle"],
    [{system:{type:{value:"firearmPrimitive"},ammunition:{type:"rebreyaShotgun"}}},6,"muzzle"],
    [{system:{type:{value:"firearmAdvanced"},ammunition:{type:"rebreyaShotgun"}}},2,"shotgun-chambers"],
    [{system:{type:{value:"firearmAdvanced"},ammunition:{type:"rebreyaShotgun"}}},6,"shotgun-tube"]
  ];
  for(const [weapon,capacity,kind] of cases){const view=buildMagazineView({...fixture(),capacity,groupSize:1},0,weapon);assert.equal(view.presentation.kind,kind);assert.equal(view.cells.flatMap(cell=>cell.slots).length,capacity);assert.equal(view.presentation.isCurved,false);}
});

test("slot counts and cropped sprites remain correct at small and dense capacities",()=>{
  for(const capacity of [1,2,6,18,24,36]){
    const view=buildMagazineView({...fixture(),capacity,groupSize:capacity>6?6:1},0,{system:{ammunition:{type:"rebreyaRifle"}}});
    const slots=view.cells.flatMap(cell=>cell.slots);
    assert.equal(slots.length,capacity);assert.equal(view.presentation.isCurved,capacity>2);
    assert.equal(view.presentation.sprite.viewBox,"14 174 2144 364");
    for(const slot of slots){assert.ok(slot.width>0&&slot.height>0);assert.equal(slot.left,-slot.width/2);assert.equal(slot.top,-slot.height/2);assert.ok(Math.abs(slot.width/slot.height-2144/364)<1e-8);}
  }
  const flags={"rebreya-main":{firearmClass:"primitive",lichWeaponPropertyValues:{ammunition:"Картечные"}}};
  assert.equal(buildMagazineView({...fixture(),capacity:1},0,{flags}).presentation.kind,"muzzle");
});

test("legacy explanation refers to original loaded count even after selecting new ammunition",()=>{
  const view=buildMagazineView({...fixture(),rounds:["b","b","b"],originalRounds:["@legacy","@legacy","@legacy"]});
  assert.equal(view.legacyCount,3);assert.equal(view.hasSavedLegacy,true);assert.equal(view.hasLegacy,true);
  assert.equal(buildMagazineView(fixture()).hasLegacy,false);
});
test("magazine draft fills groups and tail locally without modifying its source",()=>{
  const source=fixture(),draft=new MagazineDraft(source);draft.selectGroup(0,"a");draft.fill("b");
  assert.deepEqual(draft.value.rounds,["a","a","a","b","b","b","b","b"]);
  assert.deepEqual(source.rounds,[]);assert.deepEqual(source.presets,[]);
});
test("presets and reorder remain local and malformed mixed preset is rejected",()=>{
  const draft=new MagazineDraft(fixture());draft.selectGroup(0,"a");draft.selectGroup(1,"b");draft.move(1,-1);draft.savePreset("Смешанный");
  assert.deepEqual(draft.value.rounds,["b","b","b","a","a","a"]);
  draft.usePattern(["a","a","a"]);draft.usePreset(0);
  assert.deepEqual(draft.value.rounds,["b","b","b","a","a","a"]);
  assert.throws(()=>draft.usePattern(["a","b","a"]),/одинаковые/u);
});

test("placing ammunition in a selected attack group refuses shortage without changing the draft",()=>{
  const value=fixture();value.stock[0].quantity=2;const draft=new MagazineDraft(value);
  assert.throws(()=>draft.selectGroup(0,"a"),/хватает/u);assert.deepEqual(draft.value.rounds,[]);
  assert.throws(()=>draft.selectGroup(2,"b"),/предыдущую/u);
});

test("physical magazine shows each cartridge and keeps legacy rounds out of available stock",()=>{
  const view=buildMagazineView({capacity:24,groupSize:6,rounds:Array(24).fill("@legacy"),originalRounds:Array(24).fill("@legacy"),sources:{a:{name:"Патроны"}},stock:[{key:"a",quantity:10},{key:"@legacy",data:null,quantity:0}]},1);
  assert.equal(view.cells.length,4);assert.equal(view.cells.flatMap(c=>c.slots).length,24);
  assert.equal(view.cells[1].selected,true);assert.equal(view.cells[0].unknown,true);
  assert.equal(view.stock.length,1);assert.equal(view.stock[0].remaining,10);
  assert.ok(view.cells[0].slots[0].y<view.cells[3].slots.at(-1).y);
});

test("real historical implant stock remains loadable as unknown ammunition",()=>{
  const value=fixture();value.sources={};value.stock=[{key:"@legacy",data:null,quantity:20}];
  const view=buildMagazineView(value);assert.equal(view.stock.length,1);assert.equal(view.stock[0].remaining,20);assert.match(view.stock[0].name,/неизвест|Неизвест/u);
  const draft=new MagazineDraft(value);draft.selectGroup(0,"@legacy");assert.deepEqual(draft.value.rounds,Array(3).fill("@legacy"));assert.deepEqual(value.rounds,[]);
});

test("explicit legacy resolution updates only the local draft and keeps loaded stock accounting",()=>{
  const value=fixture();value.rounds=Array(3).fill("@legacy");value.originalRounds=[...value.rounds];
  const draft=new MagazineDraft(value);draft.resolveLegacy("b");
  assert.deepEqual(draft.value.rounds,["b","b","b"]);assert.deepEqual(draft.value.originalRounds,draft.value.rounds);
  assert.deepEqual(value.rounds,Array(3).fill("@legacy"));assert.equal(draft.value.legacyResolutionKey,"b");
});
test("blurring the preset name input does not rerender away the pending save click",async()=>{
  const body=new EventTarget();body.matches=()=>false;
  const app=new AmmunitionMagazineApp({getMagazineEditorData:fixture},{},{name:"Оружие"});
  app.element={querySelector:()=>body};let renders=0;app.render=()=>{renders++;};
  await app._onRender({},{});body.dispatchEvent(new Event("change"));
  assert.equal(renders,0);
});
