import test from "node:test";
import assert from "node:assert/strict";
import { optionalModule, required, makeHost, makeCandidate, makeInstalled, makeItem, makeCatalog, getHost } from "./helpers/weapon-mod-fixture.mjs";

const rules = await optionalModule(new URL("../scripts/data/weapon-mod-rules.js", import.meta.url));
const install = required(rules, "validateWeaponAttachmentInstallation");
const modernize = required(rules, "validateModernizedPartInstallation");
const readMods = required(rules, "readWeaponMods");

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
