export const WEAPON_MOD_CONDITION_FIELDS=["movedFeet","prone","targetVisible","usesProficiency","underwater","aimMode"];
export function getWeaponModAimState(host,combat,contributions=[]){
  const state=host?.flags?.["rebreya-main"]?.weaponModAim ?? host?.getFlag?.("rebreya-main","weaponModAim"),actor=host?.actor??host?.parent;
  if(!state || !combat || combat.started===false || state.actorUuid!==actor?.uuid || state.hostItemId!==host.id || combat.combatant?.actor?.uuid!==actor?.uuid
    || state.combatId!==combat.id || state.round!==combat.round || state.turn!==combat.turn)return null;
  return contributions.some(c=>c.scope==="weapon-mod" && c.kind==="aim" && c.hostItemId===host.id && c.childItemId===state.childItemId && c.mode===state.mode)?state:null;
}
const text=value=>typeof value==="string" && value.length>0 && value.length<=256;
const nullable=(value,test)=>value===null || test(value);
const fail=(code)=>{const error=new Error(code==="condition-conflict"?"Условия атаки изменились; повторите выбор.":"Решение относится к другой атаке или цели.");error.code=code;throw error;};
export function isValidWeaponModAttackDecision(value){
  const keys=["kind","targetUuid","attackMessageId",...WEAPON_MOD_CONDITION_FIELDS];
  return Boolean(value && typeof value==="object" && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key))
    && value.kind==="attack-conditions" && nullable(value.targetUuid,text) && nullable(value.attackMessageId,text)
    && nullable(value.movedFeet,number=>Number.isFinite(number)&&number>=0)
    && ["prone","targetVisible","usesProficiency","underwater"].every(key=>nullable(value[key],value=>typeof value==="boolean"))
    && [null,"collimator","scope"].includes(value.aimMode));
}
export function resolveWeaponModConditions(known,decision,{targetUuid=null,attackMessageId=null}={}){
  if(!isValidWeaponModAttackDecision(decision) || decision.targetUuid!==targetUuid || decision.attackMessageId!==attackMessageId)fail("condition-context-conflict");
  const result={...known};
  for(const field of WEAPON_MOD_CONDITION_FIELDS){
    if((known[field]!=null || field==="aimMode") && decision[field]!=null && known[field]!==decision[field])fail("condition-conflict");
    if(result[field]==null)result[field]=decision[field];
  }
  return result;
}
export function evaluateWeaponModAttack({host,attack={},target=null,contributions=[],conditions={}}){
  const result={allowed:true,attackBonus:0,rangeMultiplier:1,ignoreHalfCover:false,stopMovement:false,damageRules:[],diagnostics:[],needsDecision:[]};
  const effects=contributions.filter(c=>c.scope==="weapon-mod" && c.hostItemId===host.id),need=(field,effect)=>{
    if(!result.needsDecision.some(entry=>entry.field===field))result.needsDecision.push({field,sourceId:effect.sourceId,targetUuid:target?.uuid??null});
  };
  if(attack.type!=="melee" && conditions.underwater===true && (attack.isFirearm??host.isFirearm) && !effects.some(c=>c.kind==="underwater")){
    result.allowed=false;result.diagnostics.push({code:"firearm-underwater-unavailable",reason:"Для стрельбы под водой требуется подводный клапан."});
  }
  for(const effect of effects){
    if(effect.kind==="attack-bonus"){
      const checks=(effect.conditions??[]).map(condition=>{
        const [field,inverted]=({prone:["prone",false],"not-prone":["prone",true],"target-visible":["targetVisible",false],proficient:["usesProficiency",false]})[condition]??[];
        return {field,matched:conditions[field]==null?null:inverted?!conditions[field]:conditions[field]};
      });
      if(checks.some(check=>check.matched===false))continue;
      if(checks.some(check=>check.matched===null)){for(const check of checks.filter(c=>c.matched===null))need(check.field,effect);continue;}
      result.attackBonus+=effect.value;
    }
    if(effect.kind==="aim" && attack.type!=="melee" && conditions.aimMode===effect.mode){
      if(conditions.movedFeet==null){need("movedFeet",effect);continue;}
      if(conditions.movedFeet>effect.maximumMovedFeet){result.allowed=false;result.diagnostics.push({code:"aim-movement",sourceId:effect.sourceId,reason:"Превышено допустимое перемещение для прицеливания."});continue;}
      result.ignoreHalfCover=effect.ignoreHalfCover===true;result.stopMovement||=effect.stopMovement===true;result.rangeMultiplier*=effect.rangeMultiplier??1;
    }
    if(effect.kind==="underwater" && attack.type!=="melee"){
      if(conditions.underwater==null)need("underwater",effect);
      else if(conditions.underwater)result.rangeMultiplier*=effect.rangeMultiplier;
    }
  }
  return result;
}

export const WEAPON_MOD_TARGET_FIELDS=["targetVisible","canHear","hiddenFromTarget","materialTarget"];
export function isValidWeaponModScatterDecision(value){
  const keys=["kind","attackMessageId","primaryTargetUuid","originPoint","abilityModifier"];
  return Boolean(value && typeof value==="object" && !Array.isArray(value) && Object.keys(value).length===keys.length
    && keys.every(key=>Object.hasOwn(value,key)) && value.kind==="scatter" && text(value.attackMessageId)
    && nullable(value.primaryTargetUuid,text) && nullable(value.abilityModifier,Number.isFinite)
    && nullable(value.originPoint,point=>point && Object.keys(point).length===2 && Number.isFinite(point.x) && Number.isFinite(point.y)));
}
export function buildWeaponModScatterPlan({host,attack={},scatterDamage,abilityModifier,contributions=[],targets=[]}){
  const effects=contributions.filter(effect=>effect.scope==="weapon-mod" && effect.hostItemId===host.id),
    weak=effects.find(effect=>effect.kind==="scatter-ability-modifier"),
    result={radiusFeet:effects.find(effect=>effect.kind==="scatter-radius")?.feet??5,damageFormula:scatterDamage,targets:[],needsDecision:[]};
  if(typeof scatterDamage!=="string" || !scatterDamage.trim())throw new Error("Не задана исходная формула разброса.");
  if(weak){
    if(!Number.isFinite(abilityModifier)){result.needsDecision.push({field:"abilityModifier",sourceId:weak.sourceId});return result;}
    result.damageFormula=`(${scatterDamage}) + (${abilityModifier})`;
  }
  if(attack.isFumble || !Number.isFinite(attack.total))return result;
  for(const target of targets){
    if(!Number.isFinite(target.distanceFeet) || target.distanceFeet>result.radiusFeet)continue;
    if(!Number.isFinite(target.ac)){result.needsDecision.push({field:"ac",targetUuid:target.uuid});continue;}
    result.targets.push({...target,hit:Boolean(attack.isCritical || attack.total>=target.ac)});
  }
  return result;
}
export function isValidWeaponModTargetDecision(value){
  const keys=["kind","targetUuid","attackMessageId",...WEAPON_MOD_TARGET_FIELDS];
  return Boolean(value && typeof value==="object" && !Array.isArray(value) && Object.keys(value).length===keys.length
    && keys.every(key=>Object.hasOwn(value,key)) && value.kind==="target-effects" && text(value.targetUuid) && text(value.attackMessageId)
    && WEAPON_MOD_TARGET_FIELDS.every(key=>nullable(value[key],value=>typeof value==="boolean")));
}
export function resolveWeaponModTargetConditions(known,decision,{targetUuid,attackMessageId,allowMaterialDecision=false}={}){
  if(!isValidWeaponModTargetDecision(decision) || decision.targetUuid!==targetUuid || decision.attackMessageId!==attackMessageId)fail("condition-context-conflict");
  const result={...known};
  for(const field of WEAPON_MOD_TARGET_FIELDS){
    if(known[field]!=null && decision[field]!=null && known[field]!==decision[field])fail("condition-conflict");
    if(field==="materialTarget" && known[field]==null && decision[field]!=null && !allowMaterialDecision)fail("condition-context-conflict");
    if(result[field]==null)result[field]=decision[field];
  }
  return result;
}
export function buildWeaponModTargetDecision({host,attack={},target,contributions=[],conditions={}}){
  const result={suppressionCheck:null,damageRule:{ignoreNonmagicalResistance:false,treatNonmagicalImmunityAsResistance:false},needsDecision:[],diagnostics:[]},
    need=(field,effect)=>{if(!result.needsDecision.some(row=>row.field===field))result.needsDecision.push({field,targetUuid:target?.uuid,sourceId:effect.sourceId});};
  if(attack.type!=="ranged" || !(attack.isFirearm??host.isFirearm) || !text(attack.messageId) || !text(target?.uuid))return result;
  for(const effect of contributions.filter(effect=>effect.scope==="weapon-mod" && effect.hostItemId===host.id)){
    if(effect.kind==="nonmagical-resistance"){
      if(effect.materialOnly && conditions.materialTarget==null){need("materialTarget",effect);continue;}
      if(!effect.materialOnly || conditions.materialTarget===true)Object.assign(result.damageRule,{ignoreNonmagicalResistance:true,treatNonmagicalImmunityAsResistance:true});
    }
    if(effect.kind!=="silencer" || !effect.ammunition.includes(attack.ammunitionFamily))continue;
    if(!Number.isFinite(conditions.distanceFeet)){need("distanceFeet",effect);continue;}
    if(conditions.distanceFeet>effect.radiusFeet || conditions.canHear===false || conditions.hiddenFromTarget===false)continue;
    if(conditions.canHear==null || conditions.hiddenFromTarget==null){
      for(const field of ["canHear","hiddenFromTarget"])if(conditions[field]==null)need(field,effect);continue;
    }
    if(!Number.isFinite(attack.total)){result.diagnostics.push({code:"missing-attack-total"});continue;}
    result.suppressionCheck={dc:10+Math.floor(attack.total/2),radiusFeet:effect.radiusFeet,targetUuid:target.uuid,attackMessageId:attack.messageId,
      childItemId:effect.childItemId,sourceId:effect.sourceId};
  }
  return result;
}
