import { normalizeLootgenItemDescriptor } from "./lootgen-item-descriptor.js?v=1.4.256";
import { itemInstanceFingerprint } from "../application/item-instance-workflow.js";
import { RUNTIME_ITEM_GRAPH_FLAG } from "./runtime-item-graph.js?v=1.4.257";

const MODULE_ID="rebreya-main";
export const LOOTGEN_COMPOSITION_FLAG="lootgenComposition";
const fail=()=>{const error=new Error("Подготовленный состав лута повреждён; требуется новая генерация или сверка выдачи.");error.code="invalid-prepared-lootgen-item";throw error;};
const keyOf=(descriptor,unitValue)=>itemInstanceFingerprint({descriptor:{...descriptor,upgrades:[...descriptor.upgrades].sort((a,b)=>a.slotIndex-b.slotIndex)},unitValue});

export function readLootgenPreparedComposition(itemData) {
  const flags=itemData?.flags?.[MODULE_ID], marker=flags?.[LOOTGEN_COMPOSITION_FLAG];
  if(marker===undefined)return null;
  if(!marker || Object.keys(marker).sort().join(',')!=='compositionKey,descriptor,unitValue,version' || marker.version!==2
    || !Number.isSafeInteger(marker.unitValue) || marker.unitValue<0)fail();
  const descriptor=normalizeLootgenItemDescriptor(marker.descriptor),graph=flags[RUNTIME_ITEM_GRAPH_FLAG];
  if(!descriptor.upgrades.length || descriptor.quantity!==1 || marker.compositionKey!==keyOf(descriptor,marker.unitValue)
    || flags.sourceType!==descriptor.sourceType || flags.sourceId!==descriptor.sourceId
    || graph?.version!==1 || !Array.isArray(graph.nodes) || graph.nodes.length!==descriptor.upgrades.length+1
    || graph.nodes[0]?._id!==graph.rootId || new Set(graph.nodes.map(d=>d._id)).size!==graph.nodes.length
    || graph.nodes.some(d=>typeof d._id!=='string' || !/^[a-zA-Z0-9]{16}$/u.test(d._id))
    || itemData.system?.quantity!==1 || graph.nodes[0].system?.quantity!==1)fail();
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
