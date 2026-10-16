import test from "node:test";
import assert from "node:assert/strict";
import { optionalModule, required, gear, ruleDefinitions, hostDefinitions, makeItem, makeCatalog, getCandidate, getHost, buildCatalog } from "./helpers/weapon-mod-fixture.mjs";

test("every baseline attachment has a verified detached source-backed rule", () => {
  const catalogue=makeCatalog();
  assert.equal(catalogue.rows.filter(row=>row.profile.kind==="weaponAttachment").length,13);
  assert.equal(catalogue.rows.filter(row=>row.profile.kind==="modernizedPart").length,12);
  assert.equal(catalogue.hosts.length,38);
  const source=gear.find(row=>row.id==="soshki"), before=JSON.stringify(source);
  const candidate=getCandidate(makeItem("soshki"),catalogue);
  assert.equal(candidate.available,true); assert.ok(candidate.profile.requires.includes("long-firearm"));
  candidate.profile.requires.push("test"); assert.equal(JSON.stringify(source),before);
  assert.equal(getCandidate(makeItem("soshki"),catalogue).profile.requires.includes("test"),false);
});

test("legacy profile fallback is exact-ID only and custom source is preserved unavailable", () => {
  const catalogue=makeCatalog(), item=makeItem("glushitel");
  delete item.flags["rebreya-main"].attachment;
  assert.equal(getCandidate(item,catalogue).available,true);
  item.flags["rebreya-main"].attachment={kind:"weaponAttachment",propertiesText:"Авторский эффект"};
  const result=getCandidate(item,catalogue);
  assert.equal(result.available,false); assert.equal(result.legacyOverride,true);
  assert.equal(item.flags["rebreya-main"].attachment.propertiesText,"Авторский эффект");
  const unknown=makeItem("unknown",{name:"Глушитель"});
  assert.equal(getCandidate(unknown,catalogue).available,false); assert.equal(getHost(unknown,catalogue),null);
});

test("future catalogue items remain visible but unavailable and invalid registry definitions fail closed", () => {
  const future={id:"future-attachment",name:"Новый",equipmentType:"Обвес",attachment:{kind:"weaponAttachment",slots:{mode:"oneOf",values:["top"]},compatibility:[],propertiesText:"Новая механика"}};
  const catalogue=buildCatalog([...gear,future],ruleDefinitions,hostDefinitions);
  assert.equal(catalogue.rows.find(row=>row.sourceId===future.id).available,false);
  for (const definitions of [[...ruleDefinitions,ruleDefinitions[0]],[...ruleDefinitions,{...ruleDefinitions[0],sourceId:"orphan"}],ruleDefinitions.map((row,i)=>i?row:{...row,requires:["unrecognized"]})]) {
    assert.throws(()=>buildCatalog(gear,definitions,hostDefinitions),/weapon-mod-catalog/);
  }
});

test("parallel catalogue reads share one load and failed load can be retried", async () => {
  const module=await optionalModule(new URL(`../scripts/data/weapon-mod-catalog.js?loader-test=${Date.now()}`,import.meta.url));
  const load=required(module,"loadWeaponModCatalog"), original=globalThis.fetch; let reads=0;
  const snapshots={gear,"weapon-mod-rules":ruleDefinitions,"weapon-mod-hosts":hostDefinitions};
  globalThis.fetch=async url=>{reads++; const name=String(url).match(/\/([^/?]+)\.json/)?.[1]; return {ok:true,json:async()=>structuredClone(snapshots[name])};};
  try { const [a,b]=await Promise.all([load(),load()]); assert.equal(a,b); assert.equal(reads,3); }
  finally {globalThis.fetch=original;}
  const retryModule=await optionalModule(new URL(`../scripts/data/weapon-mod-catalog.js?retry-test=${Date.now()}`,import.meta.url));
  const retryLoad=required(retryModule,"loadWeaponModCatalog"); let failed=true;
  globalThis.fetch=async url=>{ if(failed)throw new Error("network"); const name=String(url).match(/\/([^/?]+)\.json/)?.[1]; return {ok:true,json:async()=>structuredClone(snapshots[name])}; };
  try { await assert.rejects(()=>retryLoad(),/network/); failed=false; assert.equal((await retryLoad()).rows.length,25); }
  finally {globalThis.fetch=original;}
});
