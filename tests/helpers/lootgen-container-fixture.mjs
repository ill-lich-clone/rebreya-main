import { buildStorageContainerSnapshot } from "../../scripts/data/storage-container-snapshot.js";
import { createLootgenCatalogReader } from "../../scripts/data/lootgen-catalog-reader.js";

export function makeValuedContainer({shellValue=1000,upgradeValue=2000,childValue=3000,internalCoins=1000}={}) {
  const shell={version:2,instanceKey:"shell-instance",sourceType:"gear",sourceId:"shell",isBroken:false,
    upgrades:[{instanceKey:"upgrade-instance",sourceId:"upgrade",slotIndex:1,choices:{}}]};
  const child={version:2,instanceKey:"child-instance",sourceType:"gear",sourceId:"child",isBroken:false,upgrades:[]};
  const container=buildStorageContainerSnapshot({containerId:"container-root",name:"Сундук",state:{
    lootgenComposition:shell,manualRows:[{rowId:"child-row",quantity:1,composition:child}],generatedRows:[],
    manualCoins:{cp:internalCoins},generatedCoins:{},coinsClaimed:false,claimedRowIds:[]
  }});
  const model={gear:[{id:"shell",value:shellValue},{id:"upgrade",value:upgradeValue},{id:"child",value:childValue}]};
  return {descriptor:{...shell,quantity:1,container},model,catalogReader:createLootgenCatalogReader({model})};
}
