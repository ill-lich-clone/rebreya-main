import { normalizeLootgenComposition } from "./lootgen-item-descriptor.js?v=1.4.264";
import { ItemValueError, addItemValue } from "./item-value.js?v=1.4.264";

const object=value=>value!==null && typeof value==="object" && !Array.isArray(value);
const fail=(code="invalid-container")=>{throw new ItemValueError(code);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

/** Project one canonical v1 scope only. The value owner controls traversal and global limits. */
export function readContainerValueNodes(snapshot,{shell=null}={}) {
  if(!object(snapshot) || snapshot.version!==1 || typeof snapshot.containerId!=="string" || !snapshot.containerId.trim()
    || !object(snapshot.state))fail();
  const state=snapshot.state;
  if(!state.lootgenComposition)fail("unknown-composition");
  const composition=normalizeLootgenComposition(state.lootgenComposition);
  if(shell){
    const {quantity,container,...metadata}=shell;
    if(!same(composition,normalizeLootgenComposition(metadata)))fail("composition-mismatch");
  }
  if(!Array.isArray(state.manualRows) || !Array.isArray(state.generatedRows)
    || (state.claimedRowIds!==undefined && !Array.isArray(state.claimedRowIds)))fail();
  const claimed=new Set(state.claimedRowIds??[]),rowIds=new Set(),entries=[];
  for(const row of [...state.manualRows,...state.generatedRows]){
    if(!object(row) || typeof row.rowId!=="string" || !row.rowId.trim() || rowIds.has(row.rowId))fail("duplicate-row");
    rowIds.add(row.rowId);
    if(claimed.has(row.rowId))continue;
    if(!row.composition || !["item","container"].includes(row.rowKind))fail("unknown-composition");
    const metadata=normalizeLootgenComposition(row.composition);
    const nested=row.rowKind==="container";
    if((nested && !object(row.container)) || (!nested && row.container!=null))fail();
    // Keep the existing child snapshot by reference; do not clone a second tree or mutate it.
    entries.push({...metadata,quantity:row.quantity,container:nested?row.container:null});
  }
  let currencyValue=0;
  if(state.coinsClaimed!==true)for(const coins of [state.manualCoins,state.generatedCoins]){
    if(coins===undefined)continue;
    if(!object(coins))fail("invalid-currency");
    if(Object.keys(coins).some(key=>!["pp","gp","sp","cp","totalCopper"].includes(key)))fail("invalid-currency");
    for(const [key,multiplier] of Object.entries({pp:1000,gp:100,sp:10,cp:1})){
      const amount=coins[key]??0;
      if(!Number.isSafeInteger(amount) || amount<0)fail("invalid-currency");
      currencyValue=addItemValue(currencyValue,amount*multiplier);
    }
  }
  return {containerId:snapshot.containerId,entries,currencyValue};
}
