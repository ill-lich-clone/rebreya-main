import { aggregateKey, keyedMutationScheduling } from "./socket-command-scheduling.js";
import { weaponModFlag, weaponModProfileSignature } from "../data/weapon-mod-rules.js?v=1.4.383";
import { isValidWeaponModAttackDecision } from "../automation/weapon-mod-roll-modifiers.js?v=1.4.384";
const object=value=>value && typeof value==="object" && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const text=value=>typeof value==="string" && value.length>0 && value.length<=256 && value.trim()===value && !/[\u0000-\u001f\u007f]/u.test(value);
const exact=(value,keys,optional=[])=>Boolean(object(value) && keys.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>keys.includes(key)||optional.includes(key)));
const base=["actorUuid","hostItemId","componentItemId","operationId"],mounts=["top","bottom-1","bottom-2","side-1","side-2","barrel"];
export function isValidWeaponAttachmentInstallPayload(p){return exact(p,base,["mountId"]) && base.every(key=>text(p[key])) && (p.mountId===undefined || p.mountId===null || mounts.includes(p.mountId));}
export function isValidWeaponAttachmentRemovePayload(p){return exact(p,base) && base.every(key=>text(p[key]));}
export function isValidWeaponModernizationInstallPayload(p){return exact(p,base,["removeItemId","approvalReceiptId"]) && base.every(key=>text(p[key]))
  && ["removeItemId","approvalReceiptId"].every(key=>p[key]===undefined || p[key]===null || text(p[key]));}
export function isValidWeaponModernizationApprovalPayload(p){const keys=["actorUuid","hostItemId","sourceId","profileSignature","operationId"];
  return exact(p,keys) && keys.filter(key=>key!=="profileSignature").every(key=>text(p[key])) && typeof p.profileSignature==="string" && p.profileSignature.length>0 && p.profileSignature.length<=16384;}
export function isValidWeaponModActivityPayload(p){const keys=["actorUuid","hostItemId","childItemId","activityId","operationId","decision"];
  return exact(p,keys) && keys.filter(key=>key!=="decision").every(key=>text(p[key])) && (p.decision===null || isValidWeaponModAttackDecision(p.decision)
    || exact(p.decision,["kind","tokenUuid"]) && p.decision.kind==="light-token" && text(p.decision.tokenUuid)
    || exact(p.decision,["kind","grenadeItemId"]) && ["launcher-load","launcher-prepare"].includes(p.decision.kind) && text(p.decision.grenadeItemId)
    || exact(p.decision,["kind","prepareOperationId","grenadeItemId"]) && p.decision.kind==="launcher-consume" && text(p.decision.prepareOperationId) && text(p.decision.grenadeItemId)
    || exact(p.decision,["kind","prepareOperationId","cardId"]) && p.decision.kind==="launcher-ack" && text(p.decision.prepareOperationId) && text(p.decision.cardId));}
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
  bus.register("item-mod.modernization.install",{validate:isValidWeaponModernizationInstallPayload,authorize,
    scheduling:keyedMutationScheduling(p=>[aggregateKey("actor",p.actorUuid)]),execute:async(p,{sender,assertActiveGm})=>{
      const {host,component}=await resolve(p);if(!host)throw new Error("Оружие больше не существует.");
      const options={operationId:p.operationId,removeItemId:p.removeItemId??null,approvalReceiptId:p.approvalReceiptId??null,sender,assertAuthority:assertActiveGm};
      try{return await moduleApi.itemUpgradeService.installWeaponModernization(host,component??p.componentItemId,options);}
      catch(error){
        if(error.code!=="gm-approval-required" || !component)throw error;
        const dialog=globalThis.foundry?.applications?.api?.DialogV2;
        if(!dialog?.confirm)throw error;
        const catalog=await moduleApi.itemUpgradeService.getWeaponModCatalog(),sourceId=weaponModFlag(component,"gearId"),row=catalog.rows.find(row=>row.sourceId===sourceId);
        const approvalContext=()=>weaponModProfileSignature({host:{gearId:weaponModFlag(host,"gearId"),type:host.type,system:(host.toObject?.()??host).system},
          component:{sourceId:weaponModFlag(component,"gearId"),profile:weaponModFlag(component,"attachment")}});
        const before=approvalContext();
        assertActiveGm();
        const escape=value=>String(value??"").replace(/[&<>"']/gu,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
        const approved=await dialog.confirm({window:{title:"Применимость модернизации"},content:`<p>Разрешить «${escape(component.name)}» для «${escape(host.name)}»? Пересборка спишет 500 зм у владельца оружия.</p>`,defaultYes:false});
        assertActiveGm();
        if(!approved)return {operationId:p.operationId,itemId:p.componentItemId,sourceRemaining:Number(component.system?.quantity??0),changed:false,replayed:false,cancelled:true};
        if(approvalContext()!==before){const stale=new Error("Оружие или часть изменились во время согласования. Повторите выбор.");stale.code="stale-gm-approval";throw stale;}
        const approval=await moduleApi.itemUpgradeService.approveWeaponModernization({actorUuid:p.actorUuid,hostItemId:p.hostItemId,sourceId,
          profileSignature:row?.profileSignature,operationId:p.operationId},{sender:globalThis.game.user,assertAuthority:assertActiveGm});
        return moduleApi.itemUpgradeService.installWeaponModernization(host,component,{...options,approvalReceiptId:approval.approvalReceiptId});
      }
    }});
  bus.register("item-mod.modernization.approve",{validate:isValidWeaponModernizationApprovalPayload,
    authorize:(p,c)=>Boolean(c.sender?.isGM)&&authorize(p,c),scheduling:keyedMutationScheduling(p=>[aggregateKey("actor",p.actorUuid)]),
    execute:async(p,c)=>{
      return moduleApi.itemUpgradeService.approveWeaponModernization(p,{sender:c.sender,assertAuthority:c.assertActiveGm});
    }});
  bus.register("item-mod.activity.use",{validate:isValidWeaponModActivityPayload,authorize,scheduling:keyedMutationScheduling(p=>[aggregateKey("actor",p.actorUuid)]),
    execute:async(p,c)=>{
      if(moduleApi.itemUpgradeService.useWeaponModActivity)return moduleApi.itemUpgradeService.useWeaponModActivity(p,{sender:c.sender,assertAuthority:c.assertActiveGm});
      const error=new Error("Действие обвеса пока не поддерживается.");error.code="unsupported-weapon-mod-activity";throw error;
    }});
}
