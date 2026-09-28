import { makeValuedContainer } from "./lootgen-container-fixture.mjs";
import { StorageContainerItemService } from "../../scripts/data/storage-container-item-service.js";

export async function makePreparedContainerGraph({plainChildren=0}={}) {
  const {descriptor}=makeValuedContainer();
  descriptor.upgrades=[];descriptor.container.state.lootgenComposition.upgrades=[];
  descriptor.container.state.manualRows[0].composition.upgrades=[{instanceKey:"sharp-instance",sourceId:"zacharovanie-ostroty",slotIndex:1,choices:{}}];
  for(let index=0;index<plainChildren;index++)descriptor.container.state.manualRows.push({rowId:`extra-${index}`,rowKind:"item",quantity:1,
    composition:{version:2,instanceKey:`extra-instance-${index}`,sourceType:"gear",sourceId:"child",isBroken:false,upgrades:[]}});
  let id=0;
  const options={createDocumentId:()=>String(++id).padStart(16,"0"),
    getManifest:async()=>[{productId:"zacharovanie-ostroty",decision:"simple-implemented",profile:{compatibility:["weapon"]}}],
    buildItemData:async row=>({name:row.sourceId,type:row.sourceId==="shell"?"container":row.sourceId==="child"?"weapon":"loot",
      system:{quantity:row.quantity,price:{value:10,denomination:"gp"}},flags:{"rebreya-main":{sourceType:row.sourceType,sourceId:row.sourceId}}})};
  const runtime=await new StorageContainerItemService(options).prepareItemGraph(descriptor.container);
  return {descriptor,graph:{rootItemId:runtime.rootId,documents:runtime.nodes}};
}
