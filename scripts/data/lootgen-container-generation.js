import { addItemValue, evaluateItemValue } from "./item-value.js?v=1.4.264";
import { normalizeLootgenComposition } from "./lootgen-item-descriptor.js?v=1.4.264";
import { buildStorageContainerSnapshot, buildStorageContainerRow } from "./storage-container-snapshot.js?v=1.4.264";
import { canFitLootgenContents, debitLootgenBudget, readLootgenPhysicalFootprint } from "./lootgen-container-rules.js?v=1.4.266";
import { chooseLootgenUpgradeVariant } from "./lootgen-upgrade-variants.js?v=1.4.256";
import { rollLootgenBrokenState } from "./lootgen-durability.js?v=1.4.154-corpse-storage-broken-name";
import { rollLootgenMultipleAppearance } from "./lootgen-multiple-appearance.js?v=1.4.128-lootgen-multiplicity";

const key=row=>`${row.sourceType}:${row.sourceId}`;
const composition=descriptor=>{const {quantity,container,...metadata}=descriptor;return normalizeLootgenComposition(metadata);};

/** Internal policy of generateLootgenResult: one ledger for every accepted root and descendant. */
export function generateLootgenContainerResult({form,mundanePool,magicPool,catalogReader,manifest,random,createInstanceKey,batchId,generatedAt,
  pick,makeCoins,coinWeightPerCoinLb=0.02,priceDiagnostics=[]}){
  if(!catalogReader?.readPhysicalItem || !catalogReader?.resolveContainerProfile)throw new Error("Каталог не поддерживает заполненные контейнеры.");
  if(typeof coinWeightPerCoinLb!=="number" || !Number.isFinite(coinWeightPerCoinLb) || coinWeightPerCoinLb<0)throw new Error("Некорректный вес монет.");
  const draw=random;random=()=>{const value=draw();if(typeof value!=="number" || !Number.isFinite(value) || value<0 || value>=1)throw new RangeError("random must return a number in [0,1)");return value;};
  const coinReserve=form.includeCoins?Math.floor(form.budgetValue/100)*form.coinBudgetPercent+Math.floor((form.budgetValue%100)*form.coinBudgetPercent/100):0;
  const ledger={itemBudgetRemaining:form.budgetValue-coinReserve,coinBudgetRemaining:coinReserve,documentsRemaining:200,attemptsRemaining:2000};
  const diagnostics=[...priceDiagnostics],identities=new Set(),rows=[];
  const note=(reason,sourceId="")=>{if(diagnostics.length<200 && !diagnostics.some(d=>d.reason===reason && d.sourceId===sourceId))diagnostics.push({reason,sourceId});};
  const allocate=()=>{const id=createInstanceKey();if(typeof id!=="string" || !id || id.length>256 || id.trim()!==id || /[\u0000-\u001f\u007f]/u.test(id) || identities.has(id))throw new Error("Повторный или некорректный идентификатор лута.");identities.add(id);return id;};
  const attemptBudget={get remaining(){return ledger.attemptsRemaining;},set remaining(value){ledger.attemptsRemaining=value;}};
  const reserve=()=>({itemBudgetRemaining:ledger.itemBudgetRemaining,coinBudgetRemaining:ledger.coinBudgetRemaining,documentsRemaining:ledger.documentsRemaining});
  const restore=checkpoint=>Object.assign(ledger,checkpoint);
  const fraction=()=>0.5+Math.max(0,Math.min(1,Number(random())||0))*0.5;
  const physicalWeight=footprint=>{try{return readLootgenPhysicalFootprint(footprint).weightLb;}catch{return null;}};

  function buildCandidate(allowance,depth,excluded=new Set()){
    if(ledger.attemptsRemaining--<=0){note("attempt-limit");return null;}
    if(ledger.documentsRemaining<1){note("document-limit");return null;}
    const affordable=row=>!excluded.has(key(row)) && row.value<=allowance
      && !(depth>=form.generationDepth && catalogReader.readPhysicalItem(row)?.type==="container");
    const mundane=mundanePool.filter(affordable),magic=magicPool.filter(affordable);
    const wantsMagic=form.includeMagicItems && magic.length && (!mundane.length || random()<form.magicPercent/100);
    const pool=form.includeMagicItems && form.magicPercent===100?magic:wantsMagic?magic:mundane.length?mundane:magic;
    const selected=pick(pool,()=>1,random);if(!selected)return null;
    const physical=catalogReader.readPhysicalItem(selected),isContainer=physical?.type==="container";
    const host={...selected,isBroken:rollLootgenBrokenState({sourceType:selected.sourceType,chance:form.brokenEquipmentChance,isEligible:selected.breakable===true,random})};
    const variant=chooseLootgenUpgradeVariant({host,remainingValue:allowance,form,catalogReader,manifest,random,createInstanceKey:allocate,attemptBudget});
    let descriptor=variant.descriptor;
    if(descriptor && 1+descriptor.upgrades.length>ledger.documentsRemaining){note("document-limit",selected.sourceId);descriptor=null;}
    const quantity=descriptor || isContainer || selected.sourceType==="magicItem" || selected.stackable===false?1
      :Math.max(1,Math.min(rollLootgenMultipleAppearance(selected.multipleAppearance??"1",random),selected.value>0?Math.floor(allowance/selected.value):form.optimalItemQuantity));
    descriptor??={version:2,instanceKey:allocate(),sourceType:selected.sourceType,sourceId:selected.sourceId,quantity,isBroken:host.isBroken,upgrades:[],container:null};
    const ownValue=evaluateItemValue(descriptor,catalogReader).totalValue;
    ledger.itemBudgetRemaining=debitLootgenBudget(ledger.itemBudgetRemaining,ownValue);
    ledger.documentsRemaining=debitLootgenBudget(ledger.documentsRemaining,1+descriptor.upgrades.length);
    const footprint={quantity:descriptor.quantity,weight:physical?.system?.weight,volume:physical?.system?.volume,
      upgrades:descriptor.upgrades.map(upgrade=>{const source=catalogReader.readPhysicalItem({sourceType:"gear",sourceId:upgrade.sourceId});return {weight:source?.system?.weight,volume:source?.system?.volume};}),
      isContainer,weightlessContents:false,...(isContainer?{contentsWeight:{value:0,units:"lb"}}:{})};
    const profile=catalogReader.resolveContainerProfile(selected);
    footprint.weightlessContents=profile.weightlessContents===true;
    if(isContainer && !profile.eligible)note(profile.reason,selected.sourceId);
    if(isContainer && profile.eligible && depth<form.generationDepth && form.filledContainerChance>0
      && (form.filledContainerChance===100 || random()<form.filledContainerChance/100)){
      const children=[],contents=[],rejected=new Set();
      const childAllowance=Math.floor(Math.min(allowance-ownValue,ledger.itemBudgetRemaining)*fraction());
      const startItems=ledger.itemBudgetRemaining;
      while(ledger.documentsRemaining>0 && ledger.attemptsRemaining>0){
        const checkpoint=reserve();
        const child=buildCandidate(childAllowance-(startItems-ledger.itemBudgetRemaining),depth+1,rejected);
        if(!child)break;
        const fit=canFitLootgenContents({profile,currentContents:contents,candidate:child.footprint,allowUnknownVolume:true});
        if(!fit.fits){restore(checkpoint);rejected.add(key(child.row));note(fit.reason,child.row.sourceId);continue;}
        if(profile.capacity.volumeFt3!==null && !readLootgenPhysicalFootprint(child.footprint,{needWeight:false,needVolume:true,allowUnknownVolume:true}).volumeKnown)note("volume-unverified",selected.sourceId);
        const d=child.row.descriptor,rowId=allocate();
        children.push(d.container?buildStorageContainerRow(d.container,{rowId}):{rowKind:"item",rowId,name:child.row.name,sourceType:d.sourceType,sourceId:d.sourceId,
          quantity:d.quantity,composition:composition(d)});
        contents.push(child.footprint);
      }
      let internalCoins=makeCoins(0,random);
      const coinAllowance=Math.floor(ledger.coinBudgetRemaining*fraction());
      if(coinAllowance>0){
        const proposed=makeCoins(coinAllowance,random),count=["pp","gp","sp","cp"].reduce((sum,key)=>sum+proposed[key],0);
        const coinFootprint={quantity:1,currency:true,weight:{value:count*coinWeightPerCoinLb,units:"lb"},upgrades:[]};
        const fit=canFitLootgenContents({profile,currentContents:contents,candidate:coinFootprint,allowUnknownVolume:true});
        if(fit.fits){internalCoins=proposed;contents.push(coinFootprint);ledger.coinBudgetRemaining=debitLootgenBudget(ledger.coinBudgetRemaining,coinAllowance);if(profile.capacity.volumeFt3!==null)note("volume-unverified",selected.sourceId);}
        else note(fit.reason,selected.sourceId);
      }
      if(children.length || internalCoins.totalCopper>0){
        descriptor.container=buildStorageContainerSnapshot({containerId:allocate(),name:selected.name,storageKind:"chest",img:selected.img??"",
          state:{state:"opened",displayMode:"opened",lootgenComposition:composition(descriptor),manualRows:children,generatedRows:[],claimedRowIds:[],
            manualCoins:Object.fromEntries(["pp","gp","sp","cp"].map(key=>[key,internalCoins[key]])),generatedCoins:{},coinsClaimed:internalCoins.totalCopper<=0},presentation:{itemSystem:physical.system}});
        const weights=contents.map(physicalWeight);
        footprint.contentsWeight=weights.includes(null)?undefined:{value:weights.reduce((sum,value)=>sum+value,0),units:"lb"};
      }
    }
    const totalValue=evaluateItemValue(descriptor,catalogReader).totalValue;
    return {row:{...host,descriptor,quantity:descriptor.quantity,stackable:descriptor.upgrades.length || descriptor.container?false:selected.stackable,
      value:descriptor.quantity===1?totalValue:selected.value,totalValue},footprint};
  }

  for(let index=0;index<form.itemCount && ledger.documentsRemaining>0 && ledger.attemptsRemaining>0;index++){
    const candidate=buildCandidate(ledger.itemBudgetRemaining,0);if(!candidate)break;
    rows.push({...candidate.row,directGrantId:`lootgen:${batchId}:row:${rows.length}`});
  }
  if(ledger.documentsRemaining===0)note("document-limit");
  if(ledger.attemptsRemaining<=0)note("attempt-limit");
  const spentValue=form.budgetValue-coinReserve-ledger.itemBudgetRemaining;
  const internalCurrencyValue=coinReserve-ledger.coinBudgetRemaining;
  const coins=makeCoins(form.includeCoins?addItemValue(ledger.itemBudgetRemaining,ledger.coinBudgetRemaining):0,random);
  const currencyValue=addItemValue(internalCurrencyValue,coins.totalCopper),totalValue=addItemValue(spentValue,currencyValue);
  const treeValue=rows.reduce((sum,row)=>addItemValue(sum,row.totalValue),0);
  if(addItemValue(treeValue,coins.totalCopper)!==totalValue)throw new Error("Нарушен общий бюджет дерева лута.");
  return {rows,coins,spentValue,currencyValue,totalValue,unusedValue:debitLootgenBudget(form.budgetValue,totalValue),budgetValue:form.budgetValue,
    totalItems:rows.reduce((sum,row)=>addItemValue(sum,row.quantity),0),generatedAt:String(generatedAt??""),directCoinGrantId:`lootgen:${batchId}:coins`,
    hasResult:rows.length>0 || coins.totalCopper>0,diagnostics};
}
