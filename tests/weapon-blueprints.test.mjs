import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {optionalModule,required,hostDefinitions,makeItem,makeCatalog} from "./helpers/weapon-mod-fixture.mjs";
const module=await optionalModule(new URL("../scripts/data/weapon-blueprints.js",import.meta.url));
const build=required(module,"buildWeaponBlueprintIndex"),resolve=required(module,"getWeaponBlueprint");
const manifest=async()=>JSON.parse(await readFile(new URL("../data/weapon-blueprints.json",import.meta.url),"utf8"));
test("every known host has a distinct individual raster blueprint and supported anchors",async()=>{
 const data=await manifest(),index=build(data,hostDefinitions),hashes=new Set();
 for(const host of hostDefinitions){
  const blueprint=resolve(index,makeItem(host.gearId),makeCatalog());
  assert.equal(blueprint.gearId,host.gearId);assert.equal(blueprint.isFallback,false);
  const file=await readFile(new URL("../"+blueprint.img.replace("modules/rebreya-main/",""),import.meta.url));
  assert.equal(file.subarray(1,4).toString(),"PNG");const hash=createHash("sha256").update(file).digest("hex");
  assert.equal(hashes.has(hash),false,host.gearId);hashes.add(hash);
  assert.deepEqual(Object.keys(blueprint.anchors).sort(),Object.keys(({primitive:{top:1,"bottom-1":1,barrel:1},advanced:{top:1,"bottom-1":1,"bottom-2":1,"side-1":1,"side-2":1,barrel:1},crossbow:{top:1,"bottom-1":1}})[host.family]).sort());
 }
 for(const fallback of Object.values(data.fallbacks)){
  const file=await readFile(new URL("../"+fallback.img.replace("modules/rebreya-main/",""),import.meta.url)),hash=createHash("sha256").update(file).digest("hex");
  assert.equal(hashes.has(hash),false);hashes.add(hash);
 }
});
test("blueprint validation rejects missing coverage, duplicate ids, and missing or invalid anchors",async()=>{
 const data=await manifest(),copy=()=>structuredClone(data);let invalid=copy();invalid.blueprints.pop();assert.throws(()=>build(invalid,hostDefinitions));
 invalid=copy();invalid.blueprints.push(invalid.blueprints[0]);assert.throws(()=>build(invalid,hostDefinitions));
 invalid=copy();delete invalid.blueprints[0].anchors.top;assert.throws(()=>build(invalid,hostDefinitions));
 invalid=copy();invalid.blueprints[0].anchors.top.x=NaN;assert.throws(()=>build(invalid,hostDefinitions));
});
test("fallbacks serve only unknown supported hosts and never replace known or unrelated item art",async()=>{
 const index=build(await manifest(),hostDefinitions),catalog=makeCatalog(),host=makeItem("vintovka"),before=structuredClone(host);
 assert.equal(resolve(index,host,catalog).isFallback,false);assert.deepEqual(host,before);
 const unknown=makeItem("vintovka");unknown.flags["rebreya-main"].gearId="custom-gun";
 assert.equal(resolve(index,unknown,catalog).isFallback,true);
 assert.equal(resolve(index,{id:"sword",type:"weapon",system:{type:{value:"martialM"}}},catalog),null);
});
test("blueprint manifest is fetched once for concurrent and repeated sheets",async()=>{
 const load=required(module,"loadWeaponBlueprints"),previous=globalThis.fetch;let count=0;
 try{
  const data=await manifest();globalThis.fetch=async url=>{count++;assert.match(url,/weapon-blueprints\.json/);return {ok:true,json:async()=>data};};
  const [first,second]=await Promise.all([load(hostDefinitions),load(hostDefinitions)]);
  assert.equal(first,second);assert.equal(await load(hostDefinitions),first);assert.equal(count,1);
 }finally{globalThis.fetch=previous;}
});
