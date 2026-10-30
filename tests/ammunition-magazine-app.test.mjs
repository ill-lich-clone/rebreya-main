import test from "node:test";
import assert from "node:assert/strict";
globalThis.foundry={applications:{api:{ApplicationV2:class{async _onRender(){}},HandlebarsApplicationMixin:Base=>Base}}};
const { MagazineDraft, AmmunitionMagazineApp }=await import("../scripts/ui/ammunition-magazine-app.js");
const fixture=()=>({capacity:8,groupSize:3,rounds:[],sources:{a:{name:"Обычные"},b:{name:"Огненные"}},stock:[{key:"a",quantity:6},{key:"b",quantity:8}],presets:[],lastPattern:["b","b","b"],revision:"before"});
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
test("blurring the preset name input does not rerender away the pending save click",async()=>{
  const body=new EventTarget();body.matches=()=>false;
  const app=new AmmunitionMagazineApp({getMagazineEditorData:fixture},{},{name:"Оружие"});
  app.element={querySelector:()=>body};let renders=0;app.render=()=>{renders++;};
  await app._onRender({},{});body.dispatchEvent(new Event("change"));
  assert.equal(renders,0);
});
