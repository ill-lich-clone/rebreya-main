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
