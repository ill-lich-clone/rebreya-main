import { validateModernizedPartInstallation, validateWeaponAttachmentInstallation, getWeaponModEffectiveHost } from "./weapon-mod-rules.js?v=1.4.383";
const units={pp:1000,gp:100,ep:50,sp:10,cp:1};
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
/** Fixed work fee, independent of the price paid to acquire the physical component. No calendar state. */
export function buildWeaponRebuildQuote({host,component,parts=[],attachments=[],removeItemId=null,gmApproval=null,currency}={}){
  validateModernizedPartInstallation(host,parts,component,{removeItemId,gmApproval});
  const effective=getWeaponModEffectiveHost(host,[...parts.filter(part=>part.itemId!==removeItemId),component]);
  for(const attachment of attachments)validateWeaponAttachmentInstallation(effective,attachments.filter(part=>part!==attachment),
    {...attachment,available:true,quantity:1},{mountId:attachment.mountIds[0]});
  if(!currency || typeof currency!=="object" || Array.isArray(currency))fail("invalid-currency","Кошелёк владельца оружия недоступен.");
  let beforeCp=0;
  for(const [key,unit] of Object.entries(units)){
    const value=currency[key]??0;
    if(!Number.isSafeInteger(value) || value<0 || !Number.isSafeInteger(beforeCp+value*unit))fail("invalid-currency","Некорректное количество монет.");
    beforeCp+=value*unit;
  }
  const costCp=50000,afterCp=beforeCp-costCp;
  if(afterCp<0)fail("insufficient-funds","Для пересборки требуется 500 зм в кошельке владельца оружия.");
  let remaining=costCp;
  const after=structuredClone(currency);
  for(const key of ["gp","ep","sp","cp","pp"]){
    const take=Math.min(after[key]??0,Math.floor(remaining/units[key]));
    if(take){after[key]-=take;remaining-=take*units[key];}
  }
  if(remaining){
    const key=["sp","ep","gp","pp"].find(key=>(after[key]??0)>0 && units[key]>remaining);
    if(!key)fail("invalid-currency","Не удалось составить плату из имеющихся монет.");
    after[key]--;let change=units[key]-remaining;
    for(const coin of ["gp","sp","cp"]){const amount=Math.floor(change/units[coin]);if(amount)after[coin]=(after[coin]??0)+amount;change-=amount*units[coin];}
  }
  return {costCp,beforeCp,afterCp,currencyBefore:structuredClone(currency),currencyAfter:after,removeItemId};
}
