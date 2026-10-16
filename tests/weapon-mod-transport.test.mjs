import test from "node:test";
import assert from "node:assert/strict";
import { captureRuntimeItemGraph, buildRuntimeGraphDocuments, materializeRuntimeItemGraph } from "../scripts/data/runtime-item-graph.js";
import { normalizeLootgenItemDescriptor, getLootgenAggregationKey } from "../scripts/data/lootgen-item-descriptor.js";
import { evaluateItemValue } from "../scripts/data/item-value.js";
import { StorageContainerItemService } from "../scripts/data/storage-container-item-service.js";
import { getInventoryDismantleBlockReason } from "../scripts/data/inventory-ingress-descriptor.js";
import { planItemInstanceMutation } from "../scripts/data/item-instance-rules.js";
import { ItemInstanceDocuments } from "../scripts/infrastructure/foundry/item-instance-documents.js";
import { isInventoryGraphItem } from "../scripts/application/inventory-graph-transfer.js";
import { buildLootgenPreparedItem, readLootgenPreparedComposition } from "../scripts/data/lootgen-prepared-item.js";
import { buildCompositeItemGraph } from "../scripts/data/composite-item-graph.js";
import { makeCatalog } from "./helpers/weapon-mod-fixture.mjs";
const NS="rebreya-main";
function actorFixture(id="source") {
  const items=new Map(),actor={id,uuid:`Actor.${id}`,type:"character",documentName:"Actor",items,getFlag:()=>null};
  Object.defineProperty(items,"contents",{get:()=>[...items.values()]});
  actor.add=data=>{const saved=structuredClone(data);const item={...saved,id:saved._id,parent:actor,actor,
    getFlag:(scope,key)=>saved.flags?.[scope]?.[key],toObject:()=>structuredClone(saved)};items.set(item.id,item);return item;};
  actor.createEmbeddedDocuments=async(_type,data)=>data.map(actor.add);
  return actor;
}
function fixture({bag=false}={}) {
  const actor=actorFixture();
  const rootData={_id:"host",name:"Винтовка",type:"weapon",system:{quantity:1,container:bag?"bag":null},flags:{[NS]:{gearId:"vintovka",firearmClass:"advanced",
    itemUpgrades:{capacity:1,installed:[]},firearmAmmo:{current:5,capacity:6},weaponMods:{version:1,attachments:[{itemId:"bipod",sourceId:"soshki",mountIds:["bottom-2","barrel"]}],modernizedParts:[],approvals:[]}}}};
  const root=actor.add(rootData);
  const child=actor.add({_id:"bipod",name:"Сошки",type:"loot",system:{quantity:1,container:"host",uses:{spent:2,max:"6"}},effects:[{name:"Сохранённый эффект",changes:[]}],flags:{[NS]:{gearId:"soshki",installedWeaponMod:{version:1,kind:"weaponAttachment",hostActorId:actor.id,hostItemId:"host",mountIds:["bottom-2","barrel"]}}}});
  const bagItem=bag?actor.add({_id:"bag",name:"Рюкзак",type:"container",system:{quantity:1,container:null,type:{value:"backpack"},currency:{gp:3}},flags:{}}):null;
  return {actor,root,child,bag:bagItem};
}
const descriptor=()=>({version:3,instanceKey:"weapon-instance",sourceType:"gear",sourceId:"vintovka",quantity:1,isBroken:false,upgrades:[],container:null,
  weaponMods:{version:1,attachments:[{instanceKey:"bipod-instance",sourceId:"soshki",mountIds:["bottom-2","barrel"]}],modernizedParts:[{instanceKey:"body-instance",sourceId:"oblegchyonnyy-korpus"}]}});

test("runtime graph remaps every weapon mod link and preserves physical child state",()=>{
  const {actor,root}=fixture(),graph=captureRuntimeItemGraph(actor,root),before=structuredClone(graph);
  const plan=buildRuntimeGraphDocuments(graph,"weapon-mod-transfer",root.toObject(),{actorId:"destination"});
  const [host,child]=plan.documents;
  assert.equal(host.flags[NS].weaponMods.attachments[0].itemId,child._id);
  assert.equal(child.flags[NS].installedWeaponMod.hostItemId,host._id);
  assert.equal(child.flags[NS].installedWeaponMod.hostActorId,"destination");
  assert.deepEqual(child.flags[NS].installedWeaponMod.mountIds,["bottom-2","barrel"]);
  assert.deepEqual(host.flags[NS].firearmAmmo,{current:5,capacity:6});
  assert.deepEqual(child.system.uses,{spent:2,max:"6"});assert.equal(child.effects[0].name,"Сохранённый эффект");
  assert.deepEqual(graph,before);
});

test("missing linked child and orphan reverse weapon mod links cannot be silently transported",()=>{
  const missing=fixture();missing.actor.items.delete(missing.child.id);
  assert.throws(()=>captureRuntimeItemGraph(missing.actor,missing.root),error=>error.code==="graph-manual-review");
  const orphan=fixture();const data=orphan.root.toObject();data.flags[NS].weaponMods.attachments=[];orphan.actor.add(data);
  assert.throws(()=>captureRuntimeItemGraph(orphan.actor,orphan.actor.items.get("host")),error=>error.code==="graph-manual-review");
});

test("already materialized graph rejects a foreign weapon mod edit without overwriting",async()=>{
  const {actor,root}=fixture(),graph=captureRuntimeItemGraph(actor,root),target=actorFixture("destination");
  await materializeRuntimeItemGraph(target,graph,"weapon-mod-replay",root.toObject());
  const changed=target.items.contents.find(item=>item.type==="weapon").toObject();changed.flags[NS].weaponMods.attachments[0].mountIds=["bottom-1","barrel"];
  target.add(changed);const size=target.items.size;
  await assert.rejects(()=>materializeRuntimeItemGraph(target,graph,"weapon-mod-replay",root.toObject()),error=>error.code==="graph-manual-review");
  assert.equal(target.items.size,size);assert.deepEqual(target.items.get(changed._id).flags[NS].weaponMods.attachments[0].mountIds,["bottom-1","barrel"]);
});

test("native Storage round trip preserves one multi-mount child and exact uses/ammunition",async()=>{
  const {bag}=fixture({bag:true}),service=new StorageContainerItemService({buildItemData:()=>{throw new Error("captured state cannot be rebuilt from catalogue");}});
  const snapshot=await service.captureFromItem(bag);
  assert.equal(snapshot.state.manualRows.length,1);
  const graph=await service.prepareItemGraph(snapshot,{actorId:"destination"});
  assert.equal(graph.nodes.length,3);
  const host=graph.nodes.find(node=>node.type==="weapon"),child=graph.nodes.find(node=>node.flags?.[NS]?.installedWeaponMod);
  assert.equal(host.flags[NS].weaponMods.attachments[0].itemId,child._id);
  assert.equal(child.flags[NS].installedWeaponMod.hostActorId,"destination");
  assert.equal(child.system.uses.spent,2);assert.equal(host.flags[NS].firearmAmmo.current,5);
});

test("portable Storage preserves loaded launcher descendants and their exact native sources",async()=>{
  const {actor,root,child,bag}=fixture({bag:true}),hostData=root.toObject(),launcherData=child.toObject();
  hostData.flags[NS].weaponMods.attachments=[{itemId:child.id,sourceId:"podstvol-nyy-granatomet",mountIds:["bottom-1"]}];
  launcherData.flags[NS].gearId="podstvol-nyy-granatomet";launcherData.flags[NS].installedWeaponMod.mountIds=["bottom-1"];actor.add(hostData);actor.add(launcherData);
  actor.add({_id:"loaded-grenade",name:"Авторская граната",type:"loot",system:{quantity:1,container:child.id,uses:{spent:2,max:"7"},description:{value:"Исходное описание"}},
    effects:[{name:"Сохранённый эффект",changes:[]}],flags:{core:{sourceId:"Item.original-grenade"},[NS]:{gearId:"malaya-oskolochnaya-granata",authoredFormula:"2d6 + @abilities.dex.mod"}}});
  const service=new StorageContainerItemService({buildItemData:()=>{throw Error("native captured state must survive");}}),snapshot=await service.captureFromItem(bag),graph=await service.prepareItemGraph(snapshot,{actorId:"destination"});
  assert.equal(snapshot.state.manualRows.length,1);assert.equal(graph.nodes.length,4);
  const launcher=graph.nodes.find(node=>node.flags?.[NS]?.gearId==="podstvol-nyy-granatomet"),grenade=graph.nodes.find(node=>node.flags?.[NS]?.gearId==="malaya-oskolochnaya-granata");
  assert.equal(grenade.system.container,launcher._id);assert.deepEqual(grenade.system.uses,{spent:2,max:"7"});assert.equal(grenade.flags[NS].authoredFormula,"2d6 + @abilities.dex.mod");
  assert.equal(grenade.flags.core.sourceId,"Item.original-grenade");assert.equal(grenade.effects[0].name,"Сохранённый эффект");assert.equal(new Set(graph.nodes.map(node=>node._id)).size,4);
});

test("v3 descriptor keeps weapon mods separate, counts identities and prevents merging physical builds",()=>{
  const value=descriptor(),normalized=normalizeLootgenItemDescriptor(value);
  assert.deepEqual(normalized,value);assert.notEqual(normalized.weaponMods,value.weaponMods);
  assert.deepEqual(normalized.upgrades,[]);
  assert.notEqual(getLootgenAggregationKey(value),getLootgenAggregationKey({...value,instanceKey:"another-instance"}));
  for(const mutate of [v=>v.quantity=2,v=>v.weaponMods.attachments[0].instanceKey=v.instanceKey,v=>v.weaponMods.modernizedParts[0].instanceKey="bipod-instance",
    v=>v.weaponMods.attachments[0].mountIds=["bottom-1","bottom-1"],v=>v.weaponMods.attachments[0].mountIds=["imaginary"],v=>v.weaponMods.extra=true,
    v=>v.weaponMods.attachments.push({...v.weaponMods.attachments[0],instanceKey:"duplicate-kind",mountIds:["top"]})]) {
    const invalid=descriptor();mutate(invalid);assert.throws(()=>normalizeLootgenItemDescriptor(invalid),error=>error.code==="invalid-lootgen-descriptor");
  }
});

test("v3 value counts a multi-mount component once and keeps the v2 return contract",()=>{
  const reader={resolveValueComponent:({sourceId})=>({priceKnown:true,unitValue:{vintovka:1000,soshki:200,"oblegchyonnyy-korpus":300}[sourceId],
    weaponModProfile:sourceId==="soshki"?{kind:"weaponAttachment"}:sourceId==="oblegchyonnyy-korpus"?{kind:"modernizedPart"}:null})};
  assert.deepEqual(evaluateItemValue(descriptor(),reader),{baseValue:1000,upgradeValue:0,weaponModValue:500,contentsValue:0,totalValue:1500,diagnostics:[]});
  const {weaponMods,...legacy}=descriptor();legacy.version=2;
  assert.deepEqual(evaluateItemValue(legacy,reader),{baseValue:1000,upgradeValue:0,contentsValue:0,totalValue:1000,diagnostics:[]});
  assert.throws(()=>evaluateItemValue(descriptor(),{resolveValueComponent:()=>({priceKnown:false})}),error=>error.code==="unknown-price");
  const wrongKind={resolveValueComponent:()=>({priceKnown:true,unitValue:1,weaponModProfile:{kind:"weaponAttachment"}})};
  assert.throws(()=>evaluateItemValue(descriptor(),wrongKind),error=>error.code==="invalid-descriptor");
  const duplicate=descriptor();duplicate.weaponMods.modernizedParts[0].instanceKey=duplicate.instanceKey;
  assert.throws(()=>evaluateItemValue(duplicate,reader),error=>error.code==="invalid-descriptor");
  const shell={...legacy,instanceKey:"bag",sourceId:"bag",container:{}};
  const children=Array.from({length:67},(_,i)=>{const child=descriptor();child.instanceKey=`weapon-${i}`;
    child.weaponMods.attachments[0].instanceKey=`bipod-${i}`;child.weaponMods.modernizedParts[0].instanceKey=`body-${i}`;return child;});
  assert.throws(()=>evaluateItemValue(shell,{...reader,resolveValueComponent:component=>component.sourceId==="bag"?{priceKnown:true,unitValue:1}:reader.resolveValueComponent(component),
    readContainerValueNodes:()=>({containerId:"bag",currencyValue:0,entries:children})}),error=>error.code==="document-limit");
});

test("a modded host and an installed child cannot be split, dismantled or treated as plain inventory",async()=>{
  const {actor,root,child}=fixture();
  assert.ok(getInventoryDismantleBlockReason(root.toObject()));assert.ok(getInventoryDismantleBlockReason(child.toObject()));
  assert.equal(isInventoryGraphItem(actor,root),true);
  assert.throws(()=>planItemInstanceMutation({source:{quantity:3,step:1,hasWeaponMods:true},quantity:1,sameActor:true,sameFolder:false,forHeroSlot:false}),error=>error.code==="complex-stack");
  const source=await new ItemInstanceDocuments().readSource({sourceItemId:root.id},{sourceActor:actor,targetActor:actor});
  assert.equal(source.hasWeaponMods,true);
});

test("prepared v3 marker validates mod links and preserves a single physical graph",()=>{
  const {actor,root}=fixture(),captured=captureRuntimeItemGraph(actor,root);
  const graph=buildRuntimeGraphDocuments(captured,"prepared-mods",root.toObject(),{actorId:"destination"});
  const value=descriptor();value.weaponMods.modernizedParts=[];
  const item=buildLootgenPreparedItem(value,{graph,unitValue:1200});
  assert.equal(readLootgenPreparedComposition(item).descriptor.version,3);
  assert.equal(item.flags[NS].runtimeItemGraph.nodes.length,2);
  const corrupt=structuredClone(item);corrupt.flags[NS].runtimeItemGraph.nodes[1].flags[NS].installedWeaponMod.mountIds=["side-1"];
  assert.throws(()=>readLootgenPreparedComposition(corrupt),error=>error.code==="invalid-prepared-lootgen-item");
});

test("trusted v3 graph builds mod children once and rejects incompatible mounts before child construction",async()=>{
  let sequence=0,builds=0;
  const value=descriptor();value.weaponMods.modernizedParts=[];
  const options={weaponModCatalog:makeCatalog(),manifest:[],actorId:"target",createDocumentId:()=>String(++sequence).padStart(16,"0"),
    buildBase:async()=>({name:"Винтовка",type:"weapon",system:{quantity:1},flags:{[NS]:{gearId:"vintovka",firearmClass:"advanced"}}}),
    buildUpgrade:async()=>{builds++;return {name:"Сошки",type:"loot",system:{quantity:1},flags:{}};}};
  const graph=await buildCompositeItemGraph(value,options);
  assert.equal(graph.documents.length,2);assert.equal(builds,1);
  assert.equal(graph.documents[1].flags[NS].installedWeaponMod.hostActorId,"target");
  assert.equal(graph.documents[0].flags[NS].weaponMods.attachments[0].itemId,graph.documents[1]._id);
  value.weaponMods.attachments[0].mountIds=["top"];
  await assert.rejects(()=>buildCompositeItemGraph(value,options));assert.equal(builds,1);
});
