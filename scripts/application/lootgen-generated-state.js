import { generateLootgenResult } from "../data/lootgen-generator.js?v=1.4.256";
import { normalizeLootgenItemDescriptor } from "../data/lootgen-item-descriptor.js?v=1.4.256";
import { buildCompositeItemGraph } from "../data/composite-item-graph.js?v=1.4.259";
import { buildLootgenPreparedItem } from "../data/lootgen-prepared-item.js?v=1.4.257";
import { evaluateItemValue } from "../data/item-value.js?v=1.4.264";
import { createStableGearDocumentId } from "../data/gear-document-ids.js";
import { itemInstanceFingerprint } from "./item-instance-workflow.js";

const MODULE_ID="rebreya-main";
const values=rows=>Array.isArray(rows)?rows:Array.from(rows?.values?.()??[]);
const flags=row=>row?.flags?.[MODULE_ID]??{};

/** Validate current inputs only before the inventory owner has persisted a grant receipt. */
export async function assertLootgenCatalogCurrent(state,catalog) {
  if (state?.resultVersion !== 2) return;
  const stale = () => Object.assign(new Error("Каталог усовершенствований или предметов изменился. Сгенерируйте добычу заново перед выдачей."), {code:"lootgen-result-stale"});
  let descriptors;
  try {
    if (!state.form?.enableUpgrades || typeof state.catalogFingerprint !== "string" || !state.catalogFingerprint
      || !Array.isArray(state.rows)) throw stale();
    descriptors = state.rows.map(row=>normalizeLootgenItemDescriptor(row.descriptor));
  } catch (error) { throw stale(); }
  // A transport/read failure must remain retryable; it does not prove catalog drift.
  const snapshot = await catalog.load(state.form);
  try {
    if (readLootgenCatalogFingerprint(descriptors,snapshot) !== state.catalogFingerprint) throw stale();
  } catch (error) { throw stale(); }
}

/** Signature of referenced catalog/rule inputs; it never regenerates items or uses instance IDs. */
export function readLootgenCatalogFingerprint(descriptors,snapshot) {
  const components=new Map();
  for(const descriptor of descriptors) {
    for(const component of [descriptor,...descriptor.upgrades.map(upgrade=>({...upgrade,sourceType:"gear",isBroken:descriptor.isBroken}))]) {
      const key=itemInstanceFingerprint([component.sourceType,component.sourceId,component.isBroken===true]);
      const manifest=snapshot.manifest.find(row=>row.productId===component.sourceId);
      const modelRows=component.sourceType==="material"?snapshot.model.materials:component.sourceType==="gear"?snapshot.model.gear:[];
      const modelSource=(modelRows??[]).find(row=>row.id===component.sourceId);
      const source=component.sourceType==="magicItem"
        ? snapshot.magicDocuments.find(row=>(flags(row).magicItemId??row.id??row._id)===component.sourceId)
        : values(snapshot.gearIndex).find(row=>(flags(row).gearId??flags(row).sourceId)===component.sourceId);
      components.set(key,{key,price:snapshot.catalogReader.resolveValueComponent(component),
        host:snapshot.catalogReader.describeUpgradeHost(component),
        source:{name:source?.name??modelSource?.name??null,type:source?.type??null,modifiedTime:source?._stats?.modifiedTime??null,
          rank:modelSource?.rank??flags(source).rank??null,bargaining:modelSource?.bargaining??modelSource?.itemBargaining??flags(source).bargaining??null},
        upgrade:manifest?{decision:manifest.decision,profile:manifest.profile,capabilities:manifest.capabilities??[]}:null});
    }
  }
  return itemInstanceFingerprint({version:1,components:[...components.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,value])=>value)});
}

/** Detached preparation only. The result service persists this state before the Chat publisher writes. */
export async function buildLootgenGeneratedState(form,{operationId,lootId,authorId}, {
  catalog,buildItemData,createDocumentId,random=Math.random,now=()=>new Date().toISOString()
}) {
  const snapshot=await catalog.load(form);
  if(!snapshot.form.enableUpgrades || !snapshot.catalogReader)throw new Error("Prepared loot requires a composed catalog snapshot.");
  const allocated=new Set();
  const allocate=()=>{
    const id=createDocumentId();
    if(typeof id!=="string" || !/^[a-zA-Z0-9]{16}$/u.test(id) || allocated.has(id))throw new Error("Invalid generated item identity.");
    allocated.add(id);return id;
  };
  const generated=generateLootgenResult({form:snapshot.form,mundanePool:snapshot.mundanePool,magicPool:snapshot.magicPool,
    manifest:snapshot.manifest,catalogReader:snapshot.catalogReader,random,createInstanceKey:allocate,batchId:operationId,generatedAt:now()});
  const rows=[];
  for(const [rowIndex,row] of generated.rows.entries()) {
    const descriptor=normalizeLootgenItemDescriptor(row.descriptor??{version:2,instanceKey:allocate(),sourceType:row.sourceType,
      sourceId:row.sourceId,quantity:row.quantity,isBroken:row.isBroken===true,upgrades:[],container:null});
    const price=evaluateItemValue(descriptor,snapshot.catalogReader);
    if(price.totalValue!==row.totalValue)throw new Error("Generated composition price changed during preparation.");
    let itemData;
    if(descriptor.upgrades.length) {
      const graph=await buildCompositeItemGraph(descriptor,{manifest:snapshot.manifest,createDocumentId:allocate,
        buildBase:(sourceType,sourceId)=>buildItemData({sourceType,sourceId,quantity:1,isBroken:descriptor.isBroken}),
        buildUpgrade:sourceId=>buildItemData({sourceType:"gear",sourceId,quantity:1,isBroken:false})});
      itemData=buildLootgenPreparedItem(descriptor,{graph,unitValue:price.totalValue});
    } else itemData=structuredClone(await buildItemData(row));
    const rowId=createStableGearDocumentId(`lootgen-row:${operationId}:${rowIndex}`);
    itemData.flags??={};itemData.flags[MODULE_ID]??={};
    // Composed claims are acknowledged by the batch owner after all children exist.
    // A legacy per-Item creation hook must not claim the row when only its root is observed.
    if (!descriptor.upgrades.length) itemData.flags[MODULE_ID].lootgenChat={lootId,rowId,appKey:"",rowIndex};
    const upgrades=descriptor.upgrades.map(upgrade=>{
      const entry=snapshot.manifest.find(row=>row.productId===upgrade.sourceId);
      const source=snapshot.model.gear.find(row=>row.id===upgrade.sourceId);
      return {...structuredClone(upgrade),name:String(source?.name??upgrade.sourceId),decision:entry.decision};
    });
    rows.push({...structuredClone(row),rowId,rowIndex,descriptor,itemData,upgrades,itemId:"",itemUuid:"",
      name:itemData.name??row.name,img:itemData.img??row.img??"",claimed:false});
  }
  return {lootId,createdBy:authorId,appKey:"",rows,coins:structuredClone(generated.coins),coinsClaimed:generated.coins.totalCopper<=0,
    generatedAt:generated.generatedAt,spentValue:generated.spentValue,budgetValue:generated.budgetValue,totalItems:generated.totalItems,
    catalogFingerprint:readLootgenCatalogFingerprint(rows.map(row=>row.descriptor),snapshot)};
}
