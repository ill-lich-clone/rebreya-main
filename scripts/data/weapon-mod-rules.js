const MODULE_ID = "rebreya-main";
export const WEAPON_MODS_FLAG = "weaponMods";
export const INSTALLED_WEAPON_MOD_FLAG = "installedWeaponMod";
export const WEAPON_MOD_MOUNTS = Object.freeze({
  primitive: ["top", "bottom-1", "barrel"],
  advanced: ["top", "bottom-1", "bottom-2", "side-1", "side-2", "barrel"],
  crossbow: ["top", "bottom-1"]
});
export const WEAPON_MOD_TAGS = new Set(["firearm","all-firearms","long-firearm","short-firearm","magazine-fed-firearm","rifle","carbine","shotgun","musket","flintlock-pistol","arquebus","wheellock","short-firearm-with-pistol-grip"]);
const messages = {
  incompatible: "Обвес или часть несовместимы с этим оружием.", "invalid-quantity": "Нужен один экземпляр оружия и доступная целая единица компонента.",
  "slot-conflict": "Крепление занято или связи сборки повреждены.", "duplicate-mod": "На оружии уже установлен компонент этого вида.",
  "component-held": "Перед установкой освободите руки от выбранного компонента.",
  capacity: "Можно установить не более трёх учитываемых модернизированных частей.", "missing-dependency": "Для этой части требуется другая установленная часть.",
  unavailable: "Нет доступного экземпляра с проверенным правилом.", "gm-approval-required": "Применимость модернизации должен подтвердить мастер."
};
export class WeaponModRuleError extends Error {
  constructor(code, details = {}) { super(messages[code] ?? code); this.name="WeaponModRuleError"; this.code=code; this.details=details; }
}
const fail = (code, details) => { throw new WeaponModRuleError(code, details); };
export const weaponModFlag = (item,key) => item?.getFlag?.(MODULE_ID,key) ?? item?.flags?.[MODULE_ID]?.[key];
export function hasFirearmMastery(actor) {
  return Array.from(actor?.items?.contents ?? actor?.items?.values?.() ?? []).some(item=>item.type==="feat"
    && (item.system?.identifier==="master-ognestrelnogo-oruzhiya" || weaponModFlag(item,"featId")==="master-ognestrelnogo-oruzhiya"));
}
export function weaponModProfileSignature(profile) {
  return JSON.stringify(profile, (_key,value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])) : value);
}
export function getWeaponModHostDescriptor(item,catalog) {
  if(item?.type!=="weapon")return null;
  const gearId=weaponModFlag(item,"gearId"), entry=catalog?.hosts?.find(row=>row.gearId===gearId);
  const type=item.system?.type?.value;
  const family=entry?.family ?? ({firearmPrimitive:"primitive",firearmAdvanced:"advanced",firearmSpecial:"advanced"}[type]);
  if(!WEAPON_MOD_MOUNTS[family])return null;
  const properties=new Set(item.system?.properties ?? []);
  const modelTags=[...(entry?.modelTags ?? [])].filter(tag=>tag!=="magazine-fed-firearm" || properties.has("lchFirearmReload"));
  if(family!=="crossbow")modelTags.push("firearm","all-firearms");
  if(entry?.form)modelTags.push(`${entry.form}-firearm`);
  return {id:item.id ?? item._id,gearId,family,form:entry?.form ?? null,baseForm:entry?.form ?? null,
    modelTags:[...new Set(modelTags)],mountIds:[...WEAPON_MOD_MOUNTS[family]],quantity:Number(item.system?.quantity ?? 1),
    requiresGmApproval:Boolean(entry?.requiresGmApproval || properties.has("spc") || !entry),
    freeMounts:hasFirearmMastery(item.actor??item.parent)};
}
export function isInstalledWeaponMod(item) {
  const link=weaponModFlag(item,INSTALLED_WEAPON_MOD_FLAG);
  return Boolean(link?.version===1 && link.hostItemId && item?.system?.container===link.hostItemId);
}
export function getWeaponModEffectiveHost(host,parts=[]){
  if(!host)return null;
  const form=parts.some(part=>part.sourceId==="obrezka-stvola")?"short":(host.baseForm??host.form);
  return {...host,form,modelTags:[...host.modelTags.filter(tag=>!["short-firearm","long-firearm"].includes(tag)),...(form?[`${form}-firearm`]:[])]};
}

/** The caller supplies verified final parts; source Reload remains the base for automatic area fire. */
export function getWeaponModAmmoConfiguration({capacity,ammunition},parts=[]) {
  let multiplier=1,nextAmmunition=ammunition;
  for(const part of parts)for(const effect of part.profile?.effects??[]){
    if(effect.kind==="magazine")multiplier=effect.multiplier;
    if(effect.kind==="ammunition")nextAmmunition=effect.value;
  }
  if(!Number.isSafeInteger(capacity) || capacity<0 || !Number.isFinite(multiplier) || multiplier<1)fail("incompatible");
  const effective=Math.floor(capacity*multiplier);
  if(!Number.isSafeInteger(effective))fail("incompatible");
  return {baseCapacity:capacity,capacity:effective,ammunition:nextAmmunition};
}
function basic(host,candidate,kind) {
  if(!host || host.quantity!==1 || !Number.isSafeInteger(candidate?.quantity) || candidate.quantity<1)fail("invalid-quantity");
  if(!candidate.available || !candidate.profile || candidate.profile.kind!==kind)fail("unavailable");
}
function compatible(host,profile,parts=[]) {
  const tags=new Set(host.modelTags ?? []), partIds=new Set(parts.map(part=>part.sourceId));
  if(partIds.has("pistoletnaya-rukoyat") && tags.has("short-firearm"))tags.add("short-firearm-with-pistol-grip");
  const requires=profile.requires ?? [], alternatives=profile.compatibility ?? [];
  if([...requires,...alternatives].some(tag=>!WEAPON_MOD_TAGS.has(tag))
    || requires.some(tag=>!tags.has(tag)) || (alternatives.length && !alternatives.some(tag=>tags.has(tag))))fail("incompatible");
}
function validateInstalledMounts(host,installed) {
  if(!Array.isArray(installed))fail("slot-conflict");
  const occupied=new Set(), children=new Set(), sources=new Set();
  for(const entry of installed) {
    if(!entry?.itemId || !entry.sourceId || children.has(entry.itemId) || sources.has(entry.sourceId)
      || !Array.isArray(entry.mountIds) || !entry.mountIds.length)fail("slot-conflict");
    children.add(entry.itemId); sources.add(entry.sourceId);
    for(const mount of entry.mountIds) { if(!host.mountIds.includes(mount) || occupied.has(mount))fail("slot-conflict"); occupied.add(mount); }
  }
  return occupied;
}
const category = mount => mount.replace(/-\d+$/u,"");
export function validateWeaponAttachmentInstallation(host,installed,candidate,{mountId=null,mountIds=null,freeMounts=false}={}) {
  basic(host,candidate,"weaponAttachment");
  const occupied=validateInstalledMounts(host,installed);
  if(installed.some(part=>part.sourceId===candidate.sourceId))fail("duplicate-mod");
  compatible(host,candidate.profile);
  const slots=candidate.profile.slots;
  if(!slots || !["oneOf","all"].includes(slots.mode) || !Array.isArray(slots.values) || !slots.values.length
    || new Set(slots.values).size!==slots.values.length || slots.values.some(value=>!["top","bottom","side","barrel"].includes(value)))fail("incompatible");
  const count=slots.mode==="oneOf"?1:slots.values.length;
  if(mountIds!==null){
    if(!Array.isArray(mountIds) || mountIds.length!==count)fail("incompatible");
    if(new Set(mountIds).size!==count || mountIds.some(mount=>!host.mountIds.includes(mount) || occupied.has(mount)))fail("slot-conflict");
    if(mountId!==null && !mountIds.includes(mountId))fail("incompatible");
    if(!freeMounts && (slots.mode==="oneOf" ? !slots.values.includes(category(mountIds[0])) : slots.values.some(value=>!mountIds.some(mount=>category(mount)===value))))fail("incompatible");
    return {mountIds:[...mountIds]};
  }
  if(freeMounts){
    if(mountId!==null && !host.mountIds.includes(mountId))fail("incompatible");
    if(mountId!==null && occupied.has(mountId))fail("slot-conflict");
    const selected=[...(mountId?[mountId]:[]),...host.mountIds.filter(mount=>mount!==mountId && !occupied.has(mount))].slice(0,count);
    if(selected.length!==count)fail("slot-conflict");
    return {mountIds:selected};
  }
  if(mountId!==null && (!host.mountIds.includes(mountId) || !slots.values.includes(category(mountId))))fail("incompatible");
  if(mountId!==null && occupied.has(mountId))fail("slot-conflict");
  if(slots.mode==="oneOf") {
    const selected=mountId ?? host.mountIds.find(mount=>slots.values.includes(category(mount)) && !occupied.has(mount));
    if(!selected)fail(host.mountIds.some(mount=>slots.values.includes(category(mount)))?"slot-conflict":"incompatible");
    return {mountIds:[selected]};
  }
  const mounts=slots.values.map(value=>{
    if(!host.mountIds.some(mount=>category(mount)===value))fail("incompatible");
    const selected=mountId && category(mountId)===value ? mountId : host.mountIds.find(mount=>category(mount)===value && !occupied.has(mount));
    if(!selected)fail("slot-conflict");
    return selected;
  });
  return {mountIds:mounts};
}
export function validateModernizedPartInstallation(host,parts,candidate,{removeItemId=null,gmApproval=null}={}) {
  basic(host,candidate,"modernizedPart");
  if(host.family==="crossbow")fail("incompatible");
  if(!Array.isArray(parts) || new Set(parts.map(part=>part.itemId)).size!==parts.length || parts.some(part=>!part.itemId || !part.profile))fail("slot-conflict");
  if(removeItemId!==null && !parts.some(part=>part.itemId===removeItemId))fail("slot-conflict");
  const remaining=parts.filter(part=>part.itemId!==removeItemId);
  if(remaining.some(part=>part.sourceId===candidate.sourceId))fail("duplicate-mod");
  const final=[...remaining,candidate], ids=new Set(final.map(part=>part.sourceId));
  for(const part of final) if((part.profile.requiresParts ?? []).some(id=>!ids.has(id)))fail("missing-dependency");
  for(const part of final) if((part.profile.excludes ?? []).some(id=>ids.has(id)))fail("incompatible");
  const countedParts=final.filter(part=>part.profile.countsTowardLimit!==false).length;
  if(countedParts>3)fail("capacity");
  if(removeItemId!==null && parts.filter(part=>part.profile.countsTowardLimit!==false).length<3)fail("capacity");
  const effective=getWeaponModEffectiveHost(host,final);
  for(const part of final)compatible(effective,part.profile,final);
  if(host.requiresGmApproval && !gmApproval)fail("gm-approval-required");
  return {countedParts,removeItemId};
}
/** Returns only verified live children; invalid historical links remain untouched for cleanup. */
export function readWeaponMods(host,resolveItem,catalog) {
  const result={attachments:[],modernizedParts:[],diagnostics:[]}, state=weaponModFlag(host,WEAPON_MODS_FLAG);
  if(state==null)return result;
  if(state.version!==1 || !Array.isArray(state.attachments) || !Array.isArray(state.modernizedParts)) {
    result.diagnostics.push({code:"invalid-weapon-mod-state"}); return result;
  }
  const descriptor=getWeaponModHostDescriptor(host,catalog), seen=new Set(), mounts=new Set(), sources=new Set();
  for(const [field,kind] of [["attachments","weaponAttachment"],["modernizedParts","modernizedPart"]])for(const entry of state[field]) {
    const child=resolveItem(entry?.itemId), reverse=weaponModFlag(child,INSTALLED_WEAPON_MOD_FLAG), row=catalog?.rows?.find(row=>row.sourceId===entry?.sourceId);
    const selected=field==="attachments"?entry?.mountIds:[];
    const reverseMounts=reverse?.mountIds;
    const valid=descriptor && child && row?.available && row.profile.kind===kind && !seen.has(entry.itemId) && !sources.has(entry.sourceId)
      && weaponModFlag(child,"gearId")===entry.sourceId && Number(child.system?.quantity ?? 1)===1
      && child.system?.container===(host.id ?? host._id) && reverse?.version===1 && reverse.kind===kind
      && reverse.hostItemId===(host.id ?? host._id) && reverse.hostActorId===(host.actor?.id ?? host.parent?.id)
      && (child.actor?.id ?? child.parent?.id)===(host.actor?.id ?? host.parent?.id)
      && Array.isArray(selected) && Array.isArray(reverseMounts) && selected.length===reverseMounts.length && selected.every(mount=>reverseMounts.includes(mount))
      && (entry.freeMounts===true)===(reverse?.freeMounts===true)
      && selected.every(mount=>descriptor.mountIds.includes(mount) && !mounts.has(mount)) && new Set(selected).size===selected.length
      && (field!=="attachments" || selected.length>0)
      && (!weaponModFlag(child,"attachment") || weaponModProfileSignature(weaponModFlag(child,"attachment"))===row.profileSignature);
    if(!valid) {result.diagnostics.push({code:"invalid-weapon-mod-link",itemId:entry?.itemId});continue;}
    seen.add(entry.itemId);sources.add(entry.sourceId);selected.forEach(mount=>mounts.add(mount));
    result[field].push({...structuredClone(entry),profile:structuredClone(row.profile),item:child});
  }
  for(const field of ["modernizedParts","attachments"]) {
    const entries=result[field];
    result[field]=entries.filter(entry=>{
      const candidate={...entry,quantity:1,available:true};
      try {
        if(field==="attachments") {
          const checked=validateWeaponAttachmentInstallation(getWeaponModEffectiveHost(descriptor,result.modernizedParts),entries.filter(other=>other!==entry),candidate,{mountIds:entry.mountIds,freeMounts:entry.freeMounts===true});
          if(checked.mountIds.length!==entry.mountIds.length || checked.mountIds.some(mount=>!entry.mountIds.includes(mount)))fail("slot-conflict");
        } else validateModernizedPartInstallation(descriptor,entries.filter(other=>other!==entry),candidate,{gmApproval:true});
        return true;
      } catch(error) {
        result.diagnostics.push({code:"invalid-weapon-mod-link",itemId:entry.itemId,reason:error.code});
        return false;
      }
    });
  }
  return result;
}
