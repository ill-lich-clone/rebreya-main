// Foundry dnd5e units, including the ft3 spelling stored by the existing gear adapter.
const WEIGHT_UNITS={lb:1,tn:2000,kg:2.5,Mg:2500};
const VOLUME_UNITS={ft3:1,cubicFoot:1,liter:0.03531447540346788};
const object=value=>value!==null && typeof value==="object" && !Array.isArray(value);
const numeric=value=>typeof value==="number" && Number.isFinite(value) && value>=0 && value<=Number.MAX_SAFE_INTEGER;
const fail=reason=>{throw Object.assign(new Error(reason),{reason});};

function measure(value,units,kind){
  if(!object(value) || value.value==null)fail(`unknown-${kind}`);
  if(!numeric(value.value))fail(`invalid-${kind}`);
  if(!Object.hasOwn(units,value.units))fail("unknown-unit");
  const result=value.value*units[value.units];
  if(!numeric(result))fail("measurement-overflow");
  return result;
}

/** Read a detached native Item-like catalog projection; unknown capacity is never infinite. */
export function resolveLootgenContainerProfile(catalogRow){
  const item=catalogRow?.itemData??catalogRow;
  const properties=item?.system?.properties;
  const weightlessContents=item?.type==="container" && (properties?.has?.("weightlessContents")===true
    || (Array.isArray(properties) && properties.includes("weightlessContents")));
  try{
    if(item?.type!=="container")fail("not-container");
    const capacity=item.system?.capacity;
    if(!object(capacity))fail("unknown-capacity");
    for(const key of ["weight","volume"])if(capacity[key]!=null && !object(capacity[key]))fail("invalid-capacity");
    const count=capacity.count??null;
    if(count!==null && (!Number.isSafeInteger(count) || count<0))fail("invalid-capacity");
    const weightLb=capacity.weight?.value==null?null:measure(capacity.weight,WEIGHT_UNITS,"weight");
    const volumeFt3=capacity.volume?.value==null?null:measure(capacity.volume,VOLUME_UNITS,"volume");
    if(count===null && weightLb===null && volumeFt3===null)fail("unknown-capacity");
    return {eligible:true,reason:null,capacity:{count,weightLb,volumeFt3},weightlessContents};
  }catch(error){return {eligible:false,reason:error.reason??"invalid-capacity",capacity:null,weightlessContents};}
}

function addMeasurement(a,b){const total=a+b;if(!numeric(total))fail("measurement-overflow");return total;}

/** A footprint is a one-level physical projection, never a persisted second container tree. */
function readFootprint(item,{needWeight,needVolume}){
  if(!object(item) || !Number.isSafeInteger(item.quantity) || item.quantity<1)fail("invalid-quantity");
  if(item.isContainer===true && item.quantity!==1)fail("invalid-quantity");
  const upgrades=item.upgrades??[];
  if(!Array.isArray(upgrades) || upgrades.length>3 || (upgrades.length && item.quantity!==1))fail("invalid-upgrades");
  let weightLb=0,volumeFt3=0;
  if(needWeight){
    weightLb=measure(item.weight,WEIGHT_UNITS,"weight");
    for(const upgrade of upgrades)weightLb=addMeasurement(weightLb,measure(upgrade?.weight,WEIGHT_UNITS,"weight"));
    if(item.isContainer===true){
      const contents=measure(item.contentsWeight,WEIGHT_UNITS,"weight");
      if(item.weightlessContents!==true)weightLb=addMeasurement(weightLb,contents);
    }
    weightLb*=item.quantity;if(!numeric(weightLb))fail("measurement-overflow");
  }
  if(needVolume){
    volumeFt3=measure(item.volume,VOLUME_UNITS,"volume");
    for(const upgrade of upgrades)volumeFt3=addMeasurement(volumeFt3,measure(upgrade?.volume,VOLUME_UNITS,"volume"));
    volumeFt3*=item.quantity;if(!numeric(volumeFt3))fail("measurement-overflow");
  }
  return {count:item.quantity,weightLb,volumeFt3};
}

/** Check all declared limits, including those of a weightless container. No source mutation. */
export function canFitLootgenContents({profile,currentContents=[],candidate}={}){
  try{
    if(profile?.eligible!==true || !object(profile.capacity))fail(profile?.reason??"unknown-capacity");
    if(!Array.isArray(currentContents))fail("invalid-contents");
    const capacity=profile.capacity,used={count:0,weightLb:0,volumeFt3:0};
    if(Object.values(capacity).every(value=>value===null))fail("unknown-capacity");
    for(const key of ["count","weightLb","volumeFt3"])if(capacity[key]!==null && !numeric(capacity[key]))fail("invalid-capacity");
    if(capacity.count!==null && !Number.isSafeInteger(capacity.count))fail("invalid-capacity");
    for(const entry of [...currentContents,candidate]){
      const footprint=readFootprint(entry,{needWeight:capacity.weightLb!==null,needVolume:capacity.volumeFt3!==null});
      for(const key of Object.keys(used))used[key]=addMeasurement(used[key],footprint[key]);
    }
    for(const [key,reason] of [["count","count-capacity"],["weightLb","weight-capacity"],["volumeFt3","volume-capacity"]]){
      const limit=capacity[key];
      const tolerance=key==="count"?0:Number.EPSILON*Math.max(1,limit)*8;
      if(limit!==null && used[key]>limit+tolerance)fail(reason);
    }
    return {fits:true,reason:null};
  }catch(error){return {fits:false,reason:error.reason??"invalid-contents"};}
}

export function debitLootgenBudget(remaining,amount){
  if(!Number.isSafeInteger(remaining) || !Number.isSafeInteger(amount) || remaining<0 || amount<0 || amount>remaining){
    throw new RangeError("Недостаточный или некорректный бюджет лута");
  }
  return remaining-amount;
}
