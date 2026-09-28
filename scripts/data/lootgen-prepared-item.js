import { normalizeLootgenItemDescriptor, projectLootgenDescriptorTree } from "./lootgen-item-descriptor.js?v=1.4.268";
import { sha256Hex } from "../shared/sha256.js?v=1.4.268";
import { itemInstanceFingerprint } from "../application/item-instance-workflow.js";
import { RUNTIME_ITEM_GRAPH_FLAG } from "./runtime-item-graph.js?v=1.4.257";

const MODULE_ID="rebreya-main";
export const LOOTGEN_COMPOSITION_FLAG="lootgenComposition";
const fail=()=>{const error=new Error("Подготовленный состав лута повреждён; требуется новая генерация или сверка выдачи.");error.code="invalid-prepared-lootgen-item";throw error;};
function keyOf(descriptor,unitValue) {
  const value=itemInstanceFingerprint({descriptor:{...descriptor,upgrades:[...descriptor.upgrades].sort((a,b)=>a.slotIndex-b.slotIndex)},unitValue});
  return descriptor.container===null ? value : `sha256:${sha256Hex(value)}`;
}

function validatePreparedContainerGraph(itemData,descriptor,graph) {
  const nodes=projectLootgenDescriptorTree(descriptor),hosts=new Map(),used=new Set();
  if(graph.nodes.length!==nodes.reduce((sum,node)=>sum+1+node.descriptor.upgrades.length,0))fail();
  for(const node of graph.nodes){
    const metadata=node.flags?.[MODULE_ID]?.storageContainerMember?.composition;
    if(!metadata)continue;
    if(hosts.has(metadata.instanceKey))fail();hosts.set(metadata.instanceKey,node);
  }
  if(hosts.size!==nodes.length || hosts.get(descriptor.instanceKey)?._id!==graph.rootId)fail();
  for(const entry of nodes){
    const d=entry.descriptor,host=hosts.get(d.instanceKey),flags=host?.flags?.[MODULE_ID];
    const {quantity,container,...metadata}=d;
    if(!host || used.has(host._id) || host.system?.quantity!==quantity
      || (host.system?.container??null)!==(entry.parentInstanceKey===null?null:hosts.get(entry.parentInstanceKey)?._id)
      || itemInstanceFingerprint(flags.storageContainerMember.composition)!==itemInstanceFingerprint(metadata))fail();
    used.add(host._id);
    if(container!==null){
      if(host.type!=="container" || itemInstanceFingerprint(flags.storageContainer)!==itemInstanceFingerprint(container))fail();
      const expected=Object.fromEntries(["pp","gp","sp","cp"].map(key=>[key,container.state.coinsClaimed===true?0:
        (container.state.manualCoins?.[key]??0)+(container.state.generatedCoins?.[key]??0)]));
      if(itemInstanceFingerprint(host.system.currency)!==itemInstanceFingerprint(expected))fail();
    }
    const installed=flags.itemUpgrades?.installed;
    if(!Array.isArray(installed) || installed.length!==d.upgrades.length)fail();
    for(const upgrade of d.upgrades){
      const link=installed.find(link=>link.slotIndex===upgrade.slotIndex),child=graph.nodes.find(node=>node._id===link?.itemId),childFlags=child?.flags?.[MODULE_ID];
      if(!child || used.has(child._id) || child.system?.quantity!==1 || child.system.container!==host._id
        || childFlags?.gearId!==upgrade.sourceId || childFlags.installedUpgrade?.hostItemId!==host._id
        || childFlags.installedUpgrade.slotIndex!==upgrade.slotIndex
        || itemInstanceFingerprint(childFlags.upgradeChoices)!==itemInstanceFingerprint(upgrade.choices))fail();
      used.add(child._id);
    }
  }
  const root=graph.nodes[0];
  if(used.size!==graph.nodes.length || itemInstanceFingerprint(itemData.system)!==itemInstanceFingerprint(root.system)
    || itemInstanceFingerprint(itemData.effects??[])!==itemInstanceFingerprint(root.effects??[])
    || itemInstanceFingerprint(itemData.flags[MODULE_ID].storageContainer)!==itemInstanceFingerprint(root.flags[MODULE_ID].storageContainer)
    || itemInstanceFingerprint(itemData.flags[MODULE_ID].itemUpgrades)!==itemInstanceFingerprint(root.flags[MODULE_ID].itemUpgrades))fail();
}

export function readLootgenPreparedComposition(itemData) {
  const flags=itemData?.flags?.[MODULE_ID], marker=flags?.[LOOTGEN_COMPOSITION_FLAG];
  if(marker===undefined)return null;
  if(!marker || Object.keys(marker).sort().join(',')!=='compositionKey,descriptor,unitValue,version' || marker.version!==2
    || !Number.isSafeInteger(marker.unitValue) || marker.unitValue<0)fail();
  const descriptor=normalizeLootgenItemDescriptor(marker.descriptor),graph=flags[RUNTIME_ITEM_GRAPH_FLAG];
  if((!descriptor.upgrades.length && descriptor.container===null) || descriptor.quantity!==1 || marker.compositionKey!==keyOf(descriptor,marker.unitValue)
    || flags.sourceType!==descriptor.sourceType || flags.sourceId!==descriptor.sourceId
    || graph?.version!==1 || !Array.isArray(graph.nodes) || (descriptor.container===null && graph.nodes.length!==descriptor.upgrades.length+1)
    || graph.nodes[0]?._id!==graph.rootId || new Set(graph.nodes.map(d=>d._id)).size!==graph.nodes.length
    || graph.nodes.some(d=>typeof d._id!=='string' || !/^[a-zA-Z0-9]{16}$/u.test(d._id))
    || itemData.system?.quantity!==1 || graph.nodes[0].system?.quantity!==1)fail();
  if(descriptor.container!==null){
    validatePreparedContainerGraph(itemData,descriptor,graph);
    return {version:2,descriptor,unitValue:marker.unitValue,compositionKey:marker.compositionKey};
  }
  const installed=flags.itemUpgrades?.installed;
  if(!Array.isArray(installed) || installed.length!==descriptor.upgrades.length
    || itemInstanceFingerprint(installed)!==itemInstanceFingerprint(graph.nodes[0].flags?.[MODULE_ID]?.itemUpgrades?.installed))fail();
  for(const upgrade of descriptor.upgrades){
    const link=installed.find(link=>link.slotIndex===upgrade.slotIndex),child=graph.nodes.find(d=>d._id===link?.itemId),childFlags=child?.flags?.[MODULE_ID];
    if(!child || child._id===graph.rootId || child.system?.quantity!==1 || child.system.container!==graph.rootId
      || childFlags?.gearId!==upgrade.sourceId || childFlags.installedUpgrade?.hostItemId!==graph.rootId
      || childFlags.installedUpgrade.slotIndex!==upgrade.slotIndex
      || itemInstanceFingerprint(childFlags.upgradeChoices)!==itemInstanceFingerprint(upgrade.choices))fail();
  }
  return {version:2,descriptor,unitValue:marker.unitValue,compositionKey:marker.compositionKey};
}

/** Root native price remains the base price; full value is temporary ingress metadata. */
export function buildLootgenPreparedItem(raw, {graph,unitValue}) {
  const descriptor=normalizeLootgenItemDescriptor(raw),root=structuredClone(graph?.documents?.[0]);
  if(!root || graph.rootItemId!==root._id)fail();
  root.flags??={};root.flags[MODULE_ID]??={};
  Object.assign(root.flags[MODULE_ID],{sourceType:descriptor.sourceType,sourceId:descriptor.sourceId,
    [RUNTIME_ITEM_GRAPH_FLAG]:{version:1,rootId:graph.rootItemId,nodes:structuredClone(graph.documents)},
    [LOOTGEN_COMPOSITION_FLAG]:{version:2,descriptor,unitValue,compositionKey:keyOf(descriptor,unitValue)}});
  readLootgenPreparedComposition(root);
  return root;
}
