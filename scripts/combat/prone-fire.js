/** Remove MIDI's prone-only attack disadvantage without suppressing other sources. */
export function ignoreProneFireDisadvantage(workflow) {
  const {actor,item,attackRollModifierTracker:tracker}=workflow ?? {};
  if(item?.type!=="weapon" || !item.system?.properties?.has?.("lchFirearmProneFire") || !actor?.statuses?.has?.("prone"))return;
  const disadvantage=tracker?.disadvantage,sources=tracker?.attribution?.DIS;
  if(!disadvantage?.isActive || disadvantage.hasOverride || !sources || !Object.hasOwn(sources,"attack.all"))return;
  const effects=Array.from(actor.appliedEffects ?? actor.effects?.contents ?? []).filter(effect=>!effect.disabled && !effect.isSuppressed),key="flags.midi-qol.disadvantage.attack.all";
  const changes=effect=>effect.system?.changes ?? effect.changes ?? [];
  const causes=effects.filter(effect=>changes(effect).some(change=>change.key===key));
  const source=actor._source?.flags?.["midi-qol"]?.disadvantage?.attack;
  if(!causes.some(effect=>effect.statuses?.has?.("prone")))return;
  if(causes.some(effect=>effect.statuses?.has?.("prone") && effect.statuses.size>1))return;
  const competing=effects.filter(effect=>!effect.statuses?.has?.("prone"));
  const actionType=workflow.activity?.actionType,ability=["mwak","rwak"].includes(actionType)?(item.abilityMod ?? ""):"",school=item.system?.school;
  const applicable=actionType?new Set(["all",actionType,...(ability?[ability]:[]),...(school?[`school.${school}`]:[])]):null;
  const hasCompeting=change=>{
    if(!change.key.startsWith("flags.midi-qol.disadvantage.attack."))return false;
    if(applicable && !applicable.has(change.key.slice("flags.midi-qol.disadvantage.attack.".length)))return false;
    const value=String(change.value).trim().toLowerCase();if(["","0","false"].includes(value))return false;
    if(["1","true"].includes(value))return true;
    try{
      const midi=globalThis.MidiQOL;
      if(!midi?.evalCondition || !midi?.createConditionData)return true;
      const data=midi.createConditionData({workflow,actor,item,target:workflow.targets?.first?.() ?? workflow.token ?? actor});
      const result=midi.evalCondition(change.value,data,{errorReturn:true,async:false});
      return result && typeof result.then==="function" ? true : Boolean(result);
    }catch{return true;}
  };
  if(competing.some(effect=>changes(effect).some(hasCompeting)))return;
  const sourceChanges=[];
  const collect=(value,path)=>{
    if(value && typeof value==="object" && !Array.isArray(value))for(const [name,child] of Object.entries(value))collect(child,`${path}.${name}`);
    else sourceChanges.push({key:`flags.midi-qol.disadvantage.attack.${path}`,value});
  };
  for(const [name,value] of Object.entries(source??{}))collect(value,name);
  if(sourceChanges.some(hasCompeting))return;
  delete sources["attack.all"];
  tracker.legacyAttribution?.delete?.("DIS:attack.all");
  tracker.advReminderAttribution?.delete?.("DIS:attack.all");
  if(Number.isInteger(disadvantage.count) && typeof disadvantage.add==="function"){
    const remaining=disadvantage.count-1;
    disadvantage.clear();
    for(let i=0;i<remaining;i++)disadvantage.add();
  }else if(!Object.keys(sources).length)disadvantage.clear();
}
