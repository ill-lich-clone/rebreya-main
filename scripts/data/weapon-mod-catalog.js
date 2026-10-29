import { WEAPON_MOD_TAGS, WEAPON_MOD_MOUNTS, weaponModFlag, weaponModProfileSignature, getWeaponModHostDescriptor } from "./weapon-mod-rules.js?v=1.5.23";
export { getWeaponModHostDescriptor };
const fail=(code,id)=>{throw new Error(`weapon-mod-catalog: ${code}: ${id ?? ""}`);};
const index=(rows,key)=>{
  if(!Array.isArray(rows))fail("invalid-data",key);
  const map=new Map();
  for(const row of rows) {if(!row || typeof row[key]!=="string" || !row[key] || map.has(row[key]))fail("duplicate-or-missing-id",row?.[key]);map.set(row[key],row);}
  return map;
};
const EFFECTS=new Set(["flashlight","magazine","silencer","aim","attack-bonus","range-add","ammunition","body-weight","saw-off","grenade-launcher","underwater","nonmagical-resistance","bayonet","scatter-radius","scatter-ability-modifier","property","disarm-bonus"]);
export function buildWeaponModCatalog(gear,definitions,hosts) {
  const byId=index(gear,"id"), rules=index(definitions,"sourceId");index(hosts,"gearId");
  for(const rule of rules.values()) {
    const source=byId.get(rule.sourceId);
    if(!source?.attachment)fail("orphan-rule",rule.sourceId);
    if(!Array.isArray(rule.requires) || rule.requires.some(tag=>!WEAPON_MOD_TAGS.has(tag))
      || !Array.isArray(rule.effects) || !rule.effects.length || rule.effects.some(effect=>!EFFECTS.has(effect?.kind)))fail("invalid-rule",rule.sourceId);
    for(const field of ["excludes","requiresParts"])if(rule[field]!=null && (!Array.isArray(rule[field]) || rule[field].some(id=>!rules.has(id))))fail("invalid-dependency",rule.sourceId);
    if(rule.countsTowardLimit!=null && typeof rule.countsTowardLimit!=="boolean")fail("invalid-count",rule.sourceId);
    if((source.attachment.compatibility ?? []).some(tag=>!WEAPON_MOD_TAGS.has(tag)))fail("invalid-compatibility",source.id);
  }
  for(const host of hosts) {
    if(!byId.has(host.gearId) || !WEAPON_MOD_MOUNTS[host.family] || !["short","long",null].includes(host.form)
      || !Array.isArray(host.modelTags) || host.modelTags.some(tag=>!WEAPON_MOD_TAGS.has(tag)))fail("invalid-host",host.gearId);
  }
  const rows=gear.filter(row=>row.attachment).map(source=>{
    const rule=rules.get(source.id), base=source.attachment;
    const profile={...structuredClone(base),requires:[],excludes:[],requiresParts:[],countsTowardLimit:true,...structuredClone(rule ?? {})};
    return {sourceId:source.id,name:source.name,img:source.img ?? "",weight:source.weight ?? 0,priceKnown:Number.isFinite(source.priceGoldEquivalent),
      sourceRef:source.sourceRef,profile,profileSignature:weaponModProfileSignature(base),available:Boolean(rule),
      reason:rule?"":"Нет проверенного правила для этого вида компонента."};
  }).sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
  return {rows,hosts:structuredClone(hosts),gearById:byId};
}
export function getWeaponModCandidate(item,catalog) {
  const sourceId=weaponModFlag(item,"gearId"), row=catalog?.rows?.find(row=>row.sourceId===sourceId);
  const stored=weaponModFlag(item,"attachment");
  const legacyOverride=Boolean(stored && weaponModProfileSignature(stored)!==row?.profileSignature);
  return {itemId:item?.id ?? item?._id,sourceId,quantity:Number(item?.system?.quantity ?? 1),profile:row?structuredClone(row.profile):null,
    profileSignature:row?.profileSignature ?? null,available:Boolean(row?.available && !legacyOverride),legacyOverride,
    reason:legacyOverride?"Сохранён пользовательский профиль; новая установка не подтверждена.":row?.reason ?? "Нет проверенного правила для этого stable ID."};
}
let cataloguePromise;
export function loadWeaponModCatalog() {
  cataloguePromise ??= Promise.all(["gear","weapon-mod-rules","weapon-mod-hosts"].map(async name=>{
    const response=await fetch(`modules/rebreya-main/data/${name}.json?v=1.4.385`,{cache:"no-store"});
    if(!response.ok)throw new Error(`weapon-mod-catalog: load ${name}: ${response.status}`);
    return response.json();
  })).then(args=>buildWeaponModCatalog(...args)).catch(error=>{cataloguePromise=undefined;throw error;});
  return cataloguePromise;
}
