import { aggregateKey, keyedMutationScheduling } from "./socket-command-scheduling.js";
const object=value=>value && typeof value==="object" && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const text=value=>typeof value==="string" && value.length>0 && value.length<=256 && value.trim()===value && !/[\u0000-\u001f\u007f]/u.test(value);
const exact=(value,keys,optional=[])=>Boolean(object(value) && keys.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>keys.includes(key)||optional.includes(key)));
const base=["actorUuid","hostItemId","componentItemId","operationId"],mounts=["top","bottom-1","bottom-2","side-1","side-2","barrel"];
export function isValidWeaponAttachmentInstallPayload(p){return exact(p,base,["mountId"]) && base.every(key=>text(p[key])) && (p.mountId===undefined || p.mountId===null || mounts.includes(p.mountId));}
export function isValidWeaponAttachmentRemovePayload(p){return exact(p,base) && base.every(key=>text(p[key]));}
export function isValidWeaponModernizationApprovalPayload(p){const keys=["actorUuid","hostItemId","sourceId","profileSignature","operationId"];
  return exact(p,keys) && keys.filter(key=>key!=="profileSignature").every(key=>text(p[key])) && typeof p.profileSignature==="string" && p.profileSignature.length>0 && p.profileSignature.length<=16384;}
export function isValidWeaponModActivityPayload(p){const keys=["actorUuid","hostItemId","childItemId","activityId","operationId","decision"];
  return exact(p,keys) && keys.filter(key=>key!=="decision").every(key=>text(p[key])) && p.decision===null;}
export function registerWeaponModCommands(moduleApi,bus){
  const authorize=async(p,{sender})=>{
    const actor=await globalThis.fromUuid(p.actorUuid);
    return Boolean(sender?.id && actor?.items && (sender.isGM || actor.testUserPermission?.(sender,"OWNER")));
  };
  const resolve=async p=>{const actor=await globalThis.fromUuid(p.actorUuid);return {host:actor?.items?.get(p.hostItemId),component:actor?.items?.get(p.componentItemId)};};
  for(const [action,validate] of [["install",isValidWeaponAttachmentInstallPayload],["remove",isValidWeaponAttachmentRemovePayload]]){
    bus.register(`item-mod.attachment.${action}`,{validate,authorize,scheduling:keyedMutationScheduling(p=>[aggregateKey("actor",p.actorUuid)]),
      execute:async(p,{sender,assertActiveGm})=>{
        const {host,component}=await resolve(p);
        if(!host)throw new Error("Оружие больше не существует.");
        // Removal and terminal retries resolve the stable ID even after the component is gone.
        return moduleApi.itemUpgradeService[action==="install"?"installWeaponAttachment":"removeWeaponAttachment"](host,component??p.componentItemId,
          {operationId:p.operationId,...(action==="install"?{mountId:p.mountId??null}:{}),sender,assertAuthority:assertActiveGm});
      }});
  }
  bus.register("item-mod.modernization.approve",{validate:isValidWeaponModernizationApprovalPayload,
    authorize:(p,c)=>Boolean(c.sender?.isGM)&&authorize(p,c),scheduling:keyedMutationScheduling(p=>[aggregateKey("actor",p.actorUuid)]),
    execute:async(p,c)=>{
      if(!moduleApi.craftingService?.approveWeaponModernization)throw new Error("Согласование пересборки пока недоступно.");
      return moduleApi.craftingService.approveWeaponModernization(p,{sender:c.sender,assertAuthority:c.assertActiveGm});
    }});
  bus.register("item-mod.activity.use",{validate:isValidWeaponModActivityPayload,authorize,scheduling:keyedMutationScheduling(p=>[aggregateKey("actor",p.actorUuid)]),
    execute:async(p,c)=>{
      if(moduleApi.itemUpgradeService.useWeaponModActivity)return moduleApi.itemUpgradeService.useWeaponModActivity(p,{sender:c.sender,assertAuthority:c.assertActiveGm});
      const error=new Error("Действие обвеса пока не поддерживается.");error.code="unsupported-weapon-mod-activity";throw error;
    }});
}
