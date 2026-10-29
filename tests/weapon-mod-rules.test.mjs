import test from "node:test";
import assert from "node:assert/strict";
import { optionalModule, required, makeHost, makeCandidate, makeInstalled, makeItem, makeCatalog, getHost } from "./helpers/weapon-mod-fixture.mjs";

const rules = await optionalModule(new URL("../scripts/data/weapon-mod-rules.js", import.meta.url));
const install = required(rules, "validateWeaponAttachmentInstallation");
const modernize = required(rules, "validateModernizedPartInstallation");
const readMods = required(rules, "readWeaponMods");

test("firearm mastery grants extra mounts equal to proficiency without changing normal topology",()=>{
  const item=makeItem("vintovka"),feat={type:"feat",system:{identifier:"master-ognestrelnogo-oruzhiya"}};
  item.actor={system:{attributes:{prof:3}},items:{contents:[feat]}};
  let host=getHost(item,makeCatalog());
  assert.deepEqual(host.mountIds.slice(-3),["extra-1","extra-2","extra-3"]);
  item.actor.system.attributes.prof=0;assert.equal(getHost(item,makeCatalog()).mountIds.length,6);
  item.actor.system.attributes.prof=6;assert.equal(getHost(item,makeCatalog()).mountIds.length,12);
  assert.equal(host.mountIds.length,9);
  item.actor.system.attributes.prof=7;host=getHost(item,makeCatalog());assert.equal(host.mountIds.at(-1),"extra-7");
  item.actor.items.contents=[];host=getHost(item,makeCatalog());assert.equal(host.mountIds.length,6);
});

test("extra slots remain readable after mastery is lost but cannot be newly selected",()=>{
  const host=makeItem("vintovka"),child=makeItem("soshki"),feat={type:"feat",system:{identifier:"master-ognestrelnogo-oruzhiya"}};
  host.actor={id:"actor",system:{attributes:{prof:3}},items:{contents:[feat],get:id=>id===child.id?child:null}};child.actor=host.actor;child.system.container=host.id;
  host.flags["rebreya-main"].weaponMods={version:1,attachments:[{itemId:child.id,sourceId:"soshki",mountIds:["top","extra-3"],freeMounts:true}],modernizedParts:[]};
  child.flags["rebreya-main"].installedWeaponMod={version:1,kind:"weaponAttachment",hostActorId:"actor",hostItemId:host.id,mountIds:["top","extra-3"],freeMounts:true};
  host.actor.system.attributes.prof=1;
  assert.equal(readMods(host,id=>host.actor.items.get(id),makeCatalog()).attachments.length,1);
  assert.equal(getHost(host,makeCatalog()).selectableMountIds.some(id=>id.startsWith("extra-")),false);
  assert.throws(()=>install(getHost(host,makeCatalog()),[],makeCandidate("soshki"),{mountId:"extra-3",freeMounts:true}),e=>e.code==="incompatible");
  host.actor.items.contents=[];host.actor.system.attributes.prof=0;
  assert.equal(readMods(host,()=>child,makeCatalog()).attachments.length,1);
  const descriptor=getHost(host,makeCatalog());assert.ok(descriptor.mountIds.includes("extra-3"));
  assert.throws(()=>install(descriptor,[],makeCandidate("fonarik"),{mountId:"extra-3",freeMounts:true}),{code:"incompatible"});
});

test("mount topology follows source family and survives renaming", () => {
  assert.deepEqual(makeHost("mushket").mountIds, ["top", "bottom-1", "barrel"]);
  assert.deepEqual(makeHost("vintovka").mountIds, ["top", "bottom-1", "bottom-2", "side-1", "side-2", "barrel"]);
  assert.deepEqual(makeHost("arbalet-legkiy").mountIds, ["top", "bottom-1"]);
  assert.equal(getHost(makeItem("kolestsovyy-pistolet", {name:"Переименовано"}), makeCatalog()).form, "long");
  assert.equal(getHost(makeItem("mnogozaryadnyy-arbalet"), makeCatalog()).family, "crossbow");
  assert.equal(getHost(makeItem("not-a-real-weapon"), makeCatalog()), null);
});

test("all-mount attachment consumes one selected bottom and barrel", () => {
  assert.deepEqual(install(makeHost("vintovka"), [], makeCandidate("soshki"), {mountId:"bottom-2"}), {mountIds:["bottom-2","barrel"]});
  const occupied = [makeInstalled("fonarik", "flashlight", ["bottom-1"])];
  assert.deepEqual(install(makeHost("vintovka"), occupied, makeCandidate("soshki")), {mountIds:["bottom-2","barrel"]});
  const before = structuredClone(occupied);
  assert.throws(() => install(makeHost("mushket"), occupied, makeCandidate("soshki")), {code:"slot-conflict"});
  assert.deepEqual(occupied, before);
});

test("oneOf selects exactly one free mount and refuses an unrelated requested mount", () => {
  assert.deepEqual(install(makeHost("vintovka"), [], makeCandidate("fonarik"), {mountId:"side-2"}), {mountIds:["side-2"]});
  assert.deepEqual(install(makeHost("vintovka"), [], makeCandidate("fonarik")), {mountIds:["bottom-1"]});
  assert.throws(() => install(makeHost("vintovka"), [], makeCandidate("fonarik"), {mountId:"top"}), {code:"incompatible"});
  assert.throws(() => install(makeHost("arbalet-legkiy"), [], makeCandidate("glushitel")), {code:"incompatible"});
  assert.throws(() => install(makeHost("arbalet-legkiy"), [], makeCandidate("soshki")), {code:"incompatible"});
});

test("firearm master chooses any two distinct free mounts without bypassing compatibility", () => {
  const host = makeHost("vintovka"), bipod = makeCandidate("soshki");
  assert.deepEqual(install(host, [], bipod, {freeMounts:true, mountIds:["top", "side-1"]}), {mountIds:["top", "side-1"]});
  assert.throws(() => install(host, [], bipod, {mountIds:["top", "side-1"]}), {code:"incompatible"});
  assert.throws(() => install(host, [], bipod, {freeMounts:true, mountIds:["top", "top"]}), {code:"slot-conflict"});
  assert.throws(() => install(host, [makeInstalled("fonarik", "light", ["side-1"])], bipod, {freeMounts:true, mountIds:["top", "side-1"]}), {code:"slot-conflict"});
  assert.throws(() => install(makeHost("pistolet"), [], bipod, {freeMounts:true, mountIds:["top", "barrel"]}), {code:"incompatible"});
});

test("firearm mastery is derived from the owning actor and not a caller-provided flag", () => {
  const host=makeItem("vintovka");
  host.actor={items:{contents:[{type:"feat",system:{identifier:"master-ognestrelnogo-oruzhiya"}}]}};
  assert.equal(getHost(host,makeCatalog()).freeMounts,true);
  const crossbow=makeItem("arbalet-legkiy");crossbow.actor=host.actor;
  assert.equal(getHost(crossbow,makeCatalog()).freeMounts,true);
  host.actor.items.contents=[];
  assert.equal(getHost(host,makeCatalog()).freeMounts,false);
});

test("a master-installed attachment remains valid after transfer when both links preserve its mount policy", () => {
  const host=makeItem("vintovka"), child=makeItem("soshki");
  host.actor={id:"actor"};child.actor=host.actor;child.system.container=host.id;
  host.flags["rebreya-main"].weaponMods={version:1,attachments:[{itemId:child.id,sourceId:"soshki",mountIds:["top","side-1"],freeMounts:true}],modernizedParts:[]};
  child.flags["rebreya-main"].installedWeaponMod={version:1,kind:"weaponAttachment",hostActorId:"actor",hostItemId:host.id,mountIds:["top","side-1"],freeMounts:true};
  assert.equal(readMods(host,()=>child,makeCatalog()).attachments.length,1);
  delete child.flags["rebreya-main"].installedWeaponMod.freeMounts;
  assert.equal(readMods(host,()=>child,makeCatalog()).attachments.length,0);
});

test("duplicate attachment kind, malformed installed links and stacked hosts fail before allocation", () => {
  const host = makeHost("vintovka"), candidate = makeCandidate("lazernyy-tseleukazatel");
  assert.throws(() => install(host, [makeInstalled(candidate.sourceId,"laser",["side-1"])], candidate), {code:"duplicate-mod"});
  assert.throws(() => install({...host,quantity:2}, [], candidate), {code:"invalid-quantity"});
  assert.throws(() => install(host, [], {...candidate,quantity:0}), {code:"invalid-quantity"});
  assert.throws(() => install(host, [], {...candidate,available:false}), {code:"unavailable"});
  assert.throws(() => install(host, [makeInstalled("fonarik","flashlight",["not-a-mount"])], candidate), {code:"slot-conflict"});
  assert.throws(() => install(host, [makeInstalled("fonarik","flashlight",["side-1"]),makeInstalled("glushitel","silencer",["side-1"])], candidate), {code:"slot-conflict"});
  assert.throws(() => install(host, [], {...candidate,profile:{...candidate.profile,requires:["invented-rule"]}}), {code:"incompatible"});
});

test("long-firearm-only attachment text is enforced independently of available mounts", () => {
  assert.throws(() => install(makeHost("pistolet"), [], makeCandidate("soshki")), {code:"incompatible"});
  assert.throws(() => install(makeHost("pistolet"), [], makeCandidate("takticheskaya-rukoyatka")), {code:"incompatible"});
  assert.deepEqual(install(makeHost("arbalet-ruchnoy"), [], makeCandidate("kollimatornyy-pritsel")), {mountIds:["top"]});
  assert.throws(() => install(makeHost("arbalet-ruchnoy"), [], makeCandidate("fonarik")), {code:"incompatible"});
});

test("three counted parts allow only the dependent improved grip above capacity", () => {
  const host = makeHost("pistolet");
  const parts = [makeInstalled("pistoletnaya-rukoyat","grip"),makeInstalled("oblegchyonnyy-korpus","body"),makeInstalled("rasshirennaya-oboyma","magazine")];
  assert.deepEqual(modernize(host, parts, makeCandidate("uluchshennaya-pistoletnaya-rukoyat")), {countedParts:3,removeItemId:null});
  assert.throws(() => modernize(host, [], makeCandidate("uluchshennaya-pistoletnaya-rukoyat")), {code:"missing-dependency"});
  assert.throws(() => modernize(host, parts, makeCandidate("pistoletnaya-rukoyat")), {code:"duplicate-mod"});
  assert.throws(() => modernize(host, parts, makeCandidate("giganskaya-oboyma")), {code:"incompatible"});
  assert.deepEqual(modernize(host, parts, makeCandidate("giganskaya-oboyma"), {removeItemId:"magazine"}), {countedParts:3,removeItemId:"magazine"});
  assert.throws(() => modernize(host, [parts[0],makeInstalled("uluchshennaya-pistoletnaya-rukoyat","better"),parts[1],parts[2]], makeCandidate("giganskaya-oboyma"), {removeItemId:"grip"}), {code:"missing-dependency"});
});

test("modernized part conflicts, type restrictions and master approval are authoritative inputs", () => {
  const host = makeHost("vintovka");
  assert.throws(() => modernize(host,[makeInstalled("utyazhelyonnyy-stvol","heavy")],makeCandidate("oblegchyonnyy-stvol")), {code:"incompatible"});
  assert.throws(() => modernize(makeHost("drobovik"),[makeInstalled("slabaya-sverdlovka","weak")],makeCandidate("sil-naya-sverdlovka")), {code:"incompatible"});
  assert.throws(() => modernize(makeHost("arbalet-legkiy"),[],makeCandidate("oblegchyonnyy-korpus")), {code:"incompatible"});
  const special = makeHost("ognemyot");
  assert.throws(() => modernize(special,[],makeCandidate("priklad")), {code:"gm-approval-required"});
  assert.equal(modernize(special,[],makeCandidate("priklad"),{gmApproval:true}).countedParts, 1);
  assert.throws(() => modernize(host,[],makeCandidate("oblegchyonnyy-korpus"),{removeItemId:"missing"}), {code:"slot-conflict"});
  assert.throws(() => modernize(host,[makeInstalled("priklad","stock"),makeInstalled("oblegchyonnyy-korpus","body"),makeInstalled("rasshirennaya-oboyma","magazine")],makeCandidate("utyazhelyonnyy-stvol")), {code:"capacity"});
});

test("read projection validates both sides, preserves damaged historical links and never writes", () => {
  const host = makeItem("vintovka"), child = makeItem("soshki");
  host.flags["rebreya-main"].weaponMods = {version:1,attachments:[{itemId:child.id,sourceId:"soshki",mountIds:["bottom-2","barrel"]}],modernizedParts:[],approvals:[]};
  child.system.container = host.id;
  child.flags["rebreya-main"].installedWeaponMod = {version:1,kind:"weaponAttachment",hostActorId:"actor",hostItemId:host.id,mountIds:["bottom-2","barrel"]};
  host.actor = {id:"actor"}; child.actor=host.actor;
  const projection = readMods(host,id=>id===child.id?child:null,makeCatalog());
  assert.equal(projection.attachments.length,1); assert.equal(projection.diagnostics.length,0);
  child.flags["rebreya-main"].installedWeaponMod.hostItemId="other";
  const broken=readMods(host,id=>id===child.id?child:null,makeCatalog());
  assert.equal(broken.attachments.length,0); assert.equal(broken.diagnostics.length,1);
  assert.equal(host.flags["rebreya-main"].weaponMods.attachments.length,1);
});

test("historical links with a missing required mount or incompatible host never activate", () => {
  const host=makeItem("vintovka"), child=makeItem("soshki");
  host.actor={id:"actor"};child.actor=host.actor;child.system.container=host.id;
  host.flags["rebreya-main"].weaponMods={version:1,attachments:[{itemId:child.id,sourceId:"soshki",mountIds:["bottom-1"]}],modernizedParts:[],approvals:[]};
  child.flags["rebreya-main"].installedWeaponMod={version:1,kind:"weaponAttachment",hostActorId:"actor",hostItemId:host.id,mountIds:["bottom-1"]};
  const result=readMods(host,()=>child,makeCatalog());
  assert.equal(result.attachments.length,0);assert.equal(result.diagnostics.length,1);
  host.flags["rebreya-main"].weaponMods.attachments[0].mountIds=["bottom-1","barrel"];
  child.flags["rebreya-main"].installedWeaponMod.mountIds=["bottom-1","barrel"];
  child.actor={id:"another-actor"};
  assert.equal(readMods(host,()=>child,makeCatalog()).attachments.length,0);
});
