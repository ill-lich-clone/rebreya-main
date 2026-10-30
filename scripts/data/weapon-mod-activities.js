import { createStableGearDocumentId } from "./gear-document-ids.js";
import { createDnd5eItemData } from "./gear-compendium.js?v=1.5.27";
import { weaponModProfileSignature, weaponModFlag } from "./weapon-mod-rules.js?v=1.5.23";
const NS="rebreya-main";
export const WEAPON_MOD_LAUNCHER_CAPACITY=6;
export function getWeaponModGrenadeCandidate(item,{sources,allowedSourceIds}){
  const sourceId=weaponModFlag(item,"gearId"),source=sources?.get(sourceId),profile=source?.explosive,stored=weaponModFlag(item,"explosive"),
    available=Boolean(allowedSourceIds?.includes(sourceId) && profile?.deployment==="hand" && profile.uses===1
      && (!stored || weaponModProfileSignature(stored)===weaponModProfileSignature(profile)));
  return {sourceId,profile,quantity:Number(item?.system?.quantity??0),available,
    reason:available?"":"Нет проверенного профиля гранаты для гранатомёта; исходный предмет сохранён."};
}
export function buildWeaponModLightProfile(effect){return {distance:effect.dim,bright:effect.bright,dim:effect.dim,angle:60};}
export function buildWeaponModBayonetProfile(source){
  if(source?.id!=="kop-e" || !source.weapon)throw new Error("Недоступен канонический профиль копья.");
  const data=createDnd5eItemData(source,new Map()),properties=new Set(data.system.properties??[]);properties.delete("thr");
  return {sourceId:source.id,properties,damageFormula:source.weapon.damageFormula,versatileDamageFormula:source.weapon.versatileDamageFormula,
    damage:structuredClone(data.system.damage),range:{reach:source.weapon.range?.reach??5,units:"ft"},nativeData:data,firearmAmmoSpent:0};
}
const activityId=marker=>createStableGearDocumentId(`weapon-mod:${marker.hostItemId}:${marker.childItemId}:${marker.effectKey}:${marker.action}${marker.projectileSourceId?`:${marker.projectileSourceId}:${marker.ruleKey}`:""}`);
export function buildWeaponModGrenadeActivity(marker,source,rule){
  const profile=source?.explosive;
  if(!profile || !["str","dex","con","int","wis","cha"].includes(rule?.saveAbility)
    || !["none","half","full"].includes(rule.onSave) || rule.manualSpecial!==true
    || profile.saveAbility && rule.saveAbility!==profile.saveAbility)throw new Error("Мастер должен уточнить спасбросок и применение особых свойств гранаты.");
  const own={...marker,action:"launcher-shot",projectileSourceId:source.id,ruleKey:weaponModProfileSignature(rule)};
  return {_id:activityId(own),name:`Гранатомёт: ${source.name}`,type:"save",activation:{type:"action",value:1},consumption:{targets:[]},
    range:{value:90,units:"ft",override:true},save:{ability:[rule.saveAbility],dc:{calculation:"",formula:String(profile.saveDc)}},
    damage:{onSave:rule.onSave,parts:profile.damage.map(part=>({custom:{enabled:true,formula:part.formula},types:[part.type]}))},
    target:{template:{type:"radius",size:profile.radius,units:"ft"},affects:{type:"creature"},prompt:true,override:true},
    description:{chatFlavor:`${profile.propertiesText||""} Задержка: ${profile.delay??"по решению мастера"}. Особые свойства, задержку и выбор целей разрешает мастер.`},
    flags:{[NS]:{weaponModActivity:own}}};
}
/** Managed identities derive from verified links. Source activities and foreign flags are never adopted. */
export function buildWeaponModActivities({hostId,mods,sources=new Map(),heldHands=1,grenadeActivities=[]}){
  const activities=[];
  for(const mod of [...mods.attachments??[],...mods.modernizedParts??[]])for(const [index,effect] of (mod.profile?.effects??[]).entries()){
    const actions=({aim:["aim","stop-aim"],flashlight:["flashlight-toggle"],bayonet:["bayonet-attack"],"grenade-launcher":["launcher-load","launcher-fire"]})[effect.kind]??[];
    for(const action of actions){
      const marker={hostItemId:hostId,childItemId:mod.itemId,sourceId:mod.sourceId,effectKey:String(index),action};
      const labels={aim:`Прицелиться: ${mod.item?.name??mod.sourceId}`,"stop-aim":"Прекратить прицеливание","flashlight-toggle":"Включить / выключить фонарик","bayonet-attack":"Удар штыком","launcher-load":"Зарядить гранату","launcher-fire":"Выстрелить гранатой"};
      const activity={_id:activityId(marker),type:"utility",name:labels[action],activation:{type:effect.kind==="aim"?"special":effect.kind==="flashlight"?"bonus":"action",value:effect.kind==="aim"?0:1},
        consumption:{targets:[]},flags:{[NS]:{weaponModActivity:marker}}};
      if(action==="bayonet-attack"){
        const profile=buildWeaponModBayonetProfile(sources.get("kop-e"));
        Object.assign(activity,{type:"attack",attack:{ability:"str",type:{value:"melee",classification:"weapon"}},
          damage:{includeBase:false,parts:[structuredClone(heldHands>=2?profile.damage.versatile:profile.damage.base)]},range:{...profile.range,override:true}});
      }
      if(action==="launcher-fire")activity.range={value:effect.rangeFeet,units:"ft",override:true};
      activities.push(activity);
    }
    if(effect.kind==="grenade-launcher")for(const entry of grenadeActivities.filter(entry=>entry.childItemId===mod.itemId)){
      const source=sources.get(entry.projectileSourceId);
      if(!effect.grenadeSourceIds.includes(source?.id) || entry.profileSignature!==weaponModProfileSignature(source.explosive))continue;
      activities.push(buildWeaponModGrenadeActivity({hostItemId:hostId,childItemId:mod.itemId,sourceId:mod.sourceId,effectKey:String(index)},source,entry.rule));
    }
  }
  return activities;
}

const fields=activity=>structuredClone(Object.fromEntries(Object.entries(activity).filter(([key])=>!["flags","uses","name","sort","img","description"].includes(key))));
const projectShape=(actual,shape)=>Array.isArray(shape)?(!Array.isArray(actual) || actual.length!==shape.length?actual:shape.map((entry,index)=>projectShape(actual?.[index],entry)))
  :shape && typeof shape==="object"?Object.fromEntries(Object.entries(shape).map(([key,value])=>[key,projectShape(actual?.[key],value)])):actual;
export function reconcileWeaponModActivities(existing,desired){
  const pending=new Map(desired.map(activity=>[activity._id,structuredClone(activity)])),activities=[],diagnostics=[];
  for(const raw of existing){
    const current=structuredClone(raw),marker=current.flags?.[NS]?.weaponModActivity;
    if(!marker || activityId(marker)!==current._id){activities.push(current);continue;}
    const wanted=pending.get(current._id);pending.delete(current._id);
    const baseline=current.flags?.[NS]?.weaponModActivitySource;
    if(baseline && weaponModProfileSignature(projectShape(current,baseline))!==weaponModProfileSignature(baseline)){
      activities.push(current);diagnostics.push({code:"customized-weapon-mod-activity",activityId:current._id});continue;
    }
    if(!wanted)continue;
    activities.push({...current,...wanted,...(current.name?{name:current.name}:{}),...(current.uses?{uses:current.uses}:{}),flags:{...current.flags,...wanted.flags,[NS]:{...current.flags?.[NS],...wanted.flags[NS],weaponModActivitySource:fields(wanted)}}});
  }
  for(const wanted of pending.values())activities.push({...wanted,flags:{...wanted.flags,[NS]:{...wanted.flags[NS],weaponModActivitySource:fields(wanted)}}});
  return {activities,diagnostics};
}

export function resolveWeaponModActivity(host,mods,{childItemId,activityId:requestedId},{sources=new Map()}={}){
  const expected=buildWeaponModActivities({hostId:host.id,mods,sources,grenadeActivities:weaponModFlag(host,"weaponModGrenadeActivities")??[]}).find(activity=>activity._id===requestedId && activity.flags[NS].weaponModActivity.childItemId===childItemId);
  const actual=host.system?.activities?.get?.(requestedId)??host.system?.activities?.[requestedId],marker=actual?.flags?.[NS]?.weaponModActivity??actual?.getFlag?.(NS,"weaponModActivity");
  if(!expected || !marker || Object.keys(marker).length!==Object.keys(expected.flags[NS].weaponModActivity).length
    || Object.entries(expected.flags[NS].weaponModActivity).some(([key,value])=>marker[key]!==value))throw new Error("Действие обвеса больше недоступно.");
  const source=actual.toObject?.()??actual,baseline=source.flags?.[NS]?.weaponModActivitySource;
  if(baseline && weaponModProfileSignature(projectShape(source,baseline))!==weaponModProfileSignature(baseline))throw new Error("Сохранена авторская формула действия обвеса; автоматическое выполнение отключено.");
  const mod=[...mods.attachments,...mods.modernizedParts].find(mod=>mod.itemId===childItemId);
  return {marker:expected.flags[NS].weaponModActivity,effect:mod.profile.effects[Number(marker.effectKey)],mod};
}
