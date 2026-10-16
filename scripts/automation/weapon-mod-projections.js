const WEIGHTS={lb:1,kg:2.5,tn:2000,Mg:2500},DICE=[4,6,8,10,12];
const key=({actorUuid,hostItemId,childItemId,effectKey,projectionVersion=1})=>JSON.stringify([actorUuid,hostItemId,childItemId,effectKey,projectionVersion]);
/** Inputs contain only verified physical links and detached authored source. No flags or Documents are written. */
export function buildWeaponModContributions({host,mods,context={}}){
  const contributions=[],diagnostics=[],weights={...WEIGHTS,...context.poundsPerUnit},body=host.source.system?.weight,
    baseWeightLb=Number.isFinite(body?.value) && weights[body.units]?body.value*weights[body.units]:null;
  for(const field of ["modernizedParts","attachments"])for(const mod of mods?.[field]??[]){
    if(mod.valid===false)continue;
    const identity={actorUuid:host.actorUuid,hostItemId:host.id,childItemId:mod.itemId,effectKey:"",projectionVersion:1};
    const push=(effect,effectKey,targetItemId=host.id)=>{const data={...identity,...structuredClone(effect),effectKey,targetItemId,sourceId:mod.sourceId,scope:"weapon-mod"};
      contributions.push({...data,key:key(data)});};
    const weight=mod.source?.system?.weight,factor=weights[weight?.units];
    let weightLb=Number.isFinite(weight?.value) && factor?weight.value*factor:Number(mod.catalogWeightLb??0);
    // Native nonnegative weight fields clamp authored negative replacement deltas to zero.
    if(field==="modernizedParts" && weightLb===0 && mod.catalogWeightLb<0)weightLb=mod.catalogWeightLb;
    if(baseWeightLb!==null && Number.isFinite(weightLb)){
      push({kind:"component-weight",weightLb,baseWeightLb,componentKind:field==="attachments"?"attachment":"modernizedPart",poundsPerUnit:weights},"weight");
      push({kind:"installed-weight"},"carried-weight",mod.itemId);
    }else diagnostics.push({code:"unknown-weapon-mod-weight",sourceId:mod.sourceId});
    for(const [index,effect] of (mod.profile?.effects??[]).entries()){
      const data=structuredClone(effect);
      if(effect.kind==="saw-off"){
        const base=host.source.system?.damage?.base;
        data.canStepDamage=Boolean(base && base.custom?.enabled!==true && Number.isSafeInteger(base.number) && base.number>0 && DICE.includes(base.denomination));
        if(!data.canStepDamage)diagnostics.push({code:"saw-off-custom-damage",sourceId:mod.sourceId,reason:"Авторскую формулу урона должен скорректировать мастер."});
      }
      push(data,String(index));
    }
  }
  return {contributions,diagnostics};
}

/** Apply a delta to native derived fields after foreign effects; source and other authored damage terms survive. */
export function projectWeaponModItem(system,contributions,{itemId}={}){
  const own=contributions.filter(c=>c.scope==="weapon-mod" && c.targetItemId===itemId);
  if(own.some(c=>c.kind==="installed-weight") && system.weight){system.weight.value=0;return system;}
  const parts=own.filter(c=>c.kind==="component-weight");
  if(parts.length && system.weight && Number.isFinite(system.weight.value)){
    const base=parts[0].baseWeightLb,modern=parts.filter(c=>c.componentKind==="modernizedPart").reduce((sum,c)=>sum+c.weightLb,0),
      attachments=parts.filter(c=>c.componentKind==="attachment").reduce((sum,c)=>sum+c.weightLb,0),
      multiplier=own.filter(c=>c.kind==="body-weight").reduce((value,c)=>value*c.multiplier,1),factor=parts[0].poundsPerUnit[system.weight.units];
    if(factor){const total=Math.max(0,(base+modern)*multiplier)+attachments;system.weight.value=Math.max(0,system.weight.value+(total-base)/factor);}
  }
  for(const effect of own){
    if(effect.kind==="property")system.properties?.add?.(effect.value);
    if(effect.kind==="range-add" && system.range){
      const factor={ft:1,m:0.3}[system.range.units??"ft"];
      if(factor)for(const [field,delta] of [["value",effect.normal],["long",effect.long]])if(Number.isFinite(system.range[field]))system.range[field]=Math.max(0,system.range[field]+delta*factor);
    }
    if(effect.kind==="saw-off"){
      system.properties?.delete?.(effect.removeProperty);
      const base=system.damage?.base;
      if(effect.canStepDamage && base && DICE.includes(base.denomination))base.denomination=DICE[Math.max(0,DICE.indexOf(base.denomination)-1)];
    }
  }
  return system;
}
