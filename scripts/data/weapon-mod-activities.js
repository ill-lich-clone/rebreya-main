import { createStableGearDocumentId } from "./gear-document-ids.js";
const NS="rebreya-main";
/** Managed identities derive from verified links. Source activities and foreign flags are never adopted. */
export function buildWeaponModActivities({hostId,mods}){
  const activities=[];
  for(const mod of [...mods.attachments??[],...mods.modernizedParts??[]])for(const [index,effect] of (mod.profile?.effects??[]).entries()){
    if(effect.kind!=="aim")continue;
    for(const action of ["aim","stop-aim"]){
      const marker={hostItemId:hostId,childItemId:mod.itemId,sourceId:mod.sourceId,effectKey:String(index),action};
      activities.push({_id:createStableGearDocumentId(`weapon-mod:${hostId}:${mod.itemId}:${index}:${action}`),type:"utility",
        name:action==="aim"?`Прицелиться: ${mod.item?.name??mod.sourceId}`:"Прекратить прицеливание",activation:{type:"special",value:0},
        consumption:{targets:[]},flags:{[NS]:{weaponModActivity:marker}}});
    }
  }
  return activities;
}

export function resolveWeaponModActivity(host,mods,{childItemId,activityId}){
  const expected=buildWeaponModActivities({hostId:host.id,mods}).find(activity=>activity._id===activityId && activity.flags[NS].weaponModActivity.childItemId===childItemId);
  const actual=host.system?.activities?.get?.(activityId),marker=actual?.flags?.[NS]?.weaponModActivity??actual?.getFlag?.(NS,"weaponModActivity");
  if(!expected || !marker || Object.keys(marker).length!==Object.keys(expected.flags[NS].weaponModActivity).length
    || Object.entries(expected.flags[NS].weaponModActivity).some(([key,value])=>marker[key]!==value))throw new Error("Действие обвеса больше недоступно.");
  const mod=[...mods.attachments,...mods.modernizedParts].find(mod=>mod.itemId===childItemId);
  return {marker:expected.flags[NS].weaponModActivity,effect:mod.profile.effects[Number(marker.effectKey)],mod};
}
