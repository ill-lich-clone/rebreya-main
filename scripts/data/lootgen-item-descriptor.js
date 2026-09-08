import { normalizeLootgenFlatItemDescriptor } from "./lootgen-composition.js?v=1.4.268";
import { buildStorageContainerSnapshot } from "./storage-container-snapshot.js?v=1.4.268";
import { readContainerValueNodes } from "./lootgen-container-value-adapter.js?v=1.4.268";
export { normalizeLootgenComposition } from "./lootgen-composition.js?v=1.4.268";

const fail = reason => {const error=new Error(`Некорректное дерево лута: ${reason}.`);error.code="invalid-lootgen-descriptor";throw error;};
function projectTree(root) {
  const instances=new Set(),containers=new Set(),nodes=[];let documents=0;
  const visit=(raw,parentInstanceKey=null,depth=0)=>{
    const descriptor=normalizeLootgenFlatItemDescriptor(raw,{allowContainer:true});
    if(descriptor.container!==null && (descriptor.quantity!==1 || depth>8))fail("container-quantity-or-depth");
    documents+=1+descriptor.upgrades.length;if(documents>200)fail("document-limit");
    for(const entry of [descriptor,...descriptor.upgrades]){
      if(instances.has(entry.instanceKey))fail("duplicate-instance");instances.add(entry.instanceKey);
    }
    const node={descriptor,parentInstanceKey,currencyValue:0};nodes.push(node);
    if(descriptor.container!==null){
      const projection=readContainerValueNodes(descriptor.container,{shell:descriptor});
      if(containers.has(projection.containerId))fail("duplicate-container");containers.add(projection.containerId);
      node.currencyValue=projection.currencyValue;
      for(const child of projection.entries)visit(child,descriptor.instanceKey,depth+1);
    }
  };
  visit(root);return nodes;
}

/** Validate before snapshot normalization so it cannot repair an invalid generated identity or quantity. */
export function normalizeLootgenItemDescriptor(raw, {legacy=false}={}) {
  const flat=normalizeLootgenFlatItemDescriptor(raw,{legacy,allowContainer:true});
  projectTree(flat);
  return {...flat,container:flat.container===null?null:buildStorageContainerSnapshot(flat.container)};
}
export function validateLootgenItemDescriptor(raw) {return normalizeLootgenItemDescriptor(raw);}

/** Read-only projection; each node refers to the single detached canonical snapshot tree. */
export function projectLootgenDescriptorTree(raw) {return projectTree(normalizeLootgenItemDescriptor(raw));}

export function getLootgenAggregationKey(raw) {
  const value=normalizeLootgenItemDescriptor(raw);
  if(!value.upgrades.length && value.container===null)return `${value.sourceType}:${value.sourceId}:${value.isBroken?"broken":"intact"}`;
  return JSON.stringify([value.sourceType,value.sourceId,value.instanceKey,value.isBroken,value.upgrades]);
}
