import { normalizeLootgenItemDescriptor } from "./lootgen-item-descriptor.js?v=1.4.256";
import { evaluateItemValue } from "./item-value.js";
import { validateUpgradeInstallation } from "./item-upgrade-rules.js?v=1.4.250";
import { getUpgradeChoiceOptions, validateUpgradeChoices } from "./item-upgrade-choices.js?v=1.4.255";

/** Finite variant search inside the generator's remaining budget; no documents or writes. */
export function chooseLootgenUpgradeVariant({ host, remainingValue, form, catalogReader, manifest, random, createInstanceKey, attemptBudget = { remaining:2000 } }) {
  const diagnostics=[], empty=()=>({descriptor:null,value:null,diagnostics});
  if (!form.enableUpgrades || form.upgradeChance <= 0) return empty();
  const descriptor=catalogReader?.describeUpgradeHost?.(host);
  if (!descriptor || descriptor.capacity < 1) return empty();
  const pool=(manifest??[]).filter(entry=>["simple-implemented","existing-curse"].includes(entry.decision)
    && (!form.upgradeTypes.length || form.upgradeTypes.includes(entry.profile?.type))
    && (!form.upgradeRanks.length || form.upgradeRanks.includes(entry.profile?.rank)));
  if (!pool.length || (form.upgradeChance < 100 && random() >= form.upgradeChance / 100)) return empty();
  const preview={version:2,instanceKey:"preview-host",sourceType:host.sourceType,sourceId:host.sourceId,quantity:1,isBroken:Boolean(host.isBroken),upgrades:[],container:null};
  let value=null;
  while(pool.length && preview.upgrades.length < Math.min(3,form.maxUpgradesPerItem,descriptor.capacity) && attemptBudget.remaining-- > 0) {
    const index=Math.max(0,Math.min(pool.length-1,Math.floor(random()*pool.length))), [entry]=pool.splice(index,1);
    try {
      const {slotIndex}=validateUpgradeInstallation({...descriptor,quantity:1},preview.upgrades,{profile:entry.profile,availability:entry.decision});
      const choices=getUpgradeChoiceOptions(entry.productId), choice=choices.length?{damageType:choices[Math.min(choices.length-1,Math.max(0,Math.floor(random()*choices.length)))]}:{};
      const upgrade={instanceKey:`preview-upgrade-${slotIndex}`,sourceId:entry.productId,slotIndex,choices:validateUpgradeChoices(entry.productId,choice)};
      const candidate={...preview,upgrades:[...preview.upgrades,upgrade]}, price=evaluateItemValue(candidate,catalogReader);
      if(price.totalValue>remainingValue)continue;
      preview.upgrades.push(upgrade);value=price;
    } catch(error) { diagnostics.push({sourceId:entry.productId,reason:error.message}); }
  }
  if(!preview.upgrades.length)return empty();
  const result=normalizeLootgenItemDescriptor({...preview,instanceKey:createInstanceKey(),upgrades:preview.upgrades.map(upgrade=>({...upgrade,instanceKey:createInstanceKey()}))});
  return {descriptor:result,value,diagnostics};
}
