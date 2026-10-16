import { validateModernizedPartInstallation } from "./weapon-mod-rules.js?v=1.4.381";
const units={pp:1000,gp:100,ep:50,sp:10,cp:1};
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
/** Fixed work fee, independent of the price paid to acquire the physical component. No calendar state. */
export function buildWeaponRebuildQuote({host,component,parts=[],removeItemId=null,gmApproval=null,currency}={}){
  validateModernizedPartInstallation(host,parts,component,{removeItemId,gmApproval});
  if(!currency || typeof currency!=="object" || Array.isArray(currency))fail("invalid-currency","Кошелёк владельца оружия недоступен.");
  let beforeCp=0;
  for(const [key,unit] of Object.entries(units)){
    const value=currency[key]??0;
    if(!Number.isSafeInteger(value) || value<0 || !Number.isSafeInteger(beforeCp+value*unit))fail("invalid-currency","Некорректное количество монет.");
    beforeCp+=value*unit;
  }
  const costCp=50000,afterCp=beforeCp-costCp;
  if(afterCp<0)fail("insufficient-funds","Для пересборки требуется 500 зм в кошельке владельца оружия.");
  let remaining=afterCp;
  const after={...structuredClone(currency),ep:0};
  for(const key of ["pp","gp","sp","cp"]){after[key]=Math.floor(remaining/units[key]);remaining-=after[key]*units[key];}
  return {costCp,beforeCp,afterCp,currencyBefore:structuredClone(currency),currencyAfter:after,removeItemId};
}
