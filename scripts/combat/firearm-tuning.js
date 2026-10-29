const NS="rebreya-main";
const pendingStarts=new WeakMap();
const isFirearm=item=>item?.type==="weapon" && (["firearmPrimitive","firearmAdvanced","firearmSpecial"].includes(item.system?.type?.value)
  || Boolean(item.getFlag?.(NS,"firearmClass") ?? item.flags?.[NS]?.firearmClass));
const effects=item=>Array.from(item?.effects?.contents ?? item?.effects?.values?.() ?? []);
const state=effect=>effect.getFlag?.(NS,"firearmTuning") ?? effect.flags?.[NS]?.firearmTuning;
const isTuningActivity=activity=>{
  const feat=activity?.item,identifier=feat?.system?.identifier ?? feat?.flags?.[NS]?.featId;
  return Boolean(activity?.flags?.[NS]?.firearmTuning || identifier==="master-ognestrelnogo-oruzhiya"
    && activity?.type==="enchant" && /настро(йка|ить).*огнестрельн/iu.test(activity.name ?? ""));
};
function tuning(item,now) {
  if(!isFirearm(item) || !Number.isFinite(now))return null;
  return effects(item).find(effect=>!effect.disabled && state(effect) && (state(effect).startedAt==null || now<Number(state(effect).startedAt)+60));
}
export const getFirearmTuningBonus=(item,now)=>tuning(item,now)?1:0;
export function applyFirearmTuning(item,config,now) {
  if(!tuning(item,now))return;
  for(const roll of config?.rolls ?? []) {
    roll.options ??= {};
    if(roll.options.rebreyaFirearmTuning)continue;
    roll.parts ??= [];roll.parts.push("1");roll.options.rebreyaFirearmTuning=true;
  }
}
export async function startFirearmTuning(item,now) {
  const effect=tuning(item,now);
  if(!effect || state(effect).startedAt!=null || typeof effect.update!=="function")return;
  if(pendingStarts.has(effect))return pendingStarts.get(effect);
  const pending=Promise.resolve(effect.update({duration:{startTime:now,seconds:60},[`flags.${NS}.firearmTuning`]:{startedAt:now}}));
  pendingStarts.set(effect,pending);
  try{await pending;}finally{pendingStarts.delete(effect);}
}
export async function startTuningForAreaFire(activity,now) {
  if(["firearm-automatic-fire","firearm-semi-automatic-fire"].includes(activity?.flags?.[NS]?.automation))await startFirearmTuning(activity.item,now);
}
export function canApplyFirearmTuning(item,activity,data={}) {
  if(!isTuningActivity(activity))return true;
  if(!isFirearm(item)){
    globalThis.ui?.notifications?.warn?.("Настройка применяется только к огнестрельному оружию.");
    return false;
  }
  const existing=effects(item).find(effect=>state(effect));
  if(!existing){
    data.flags ??= {};data.flags[NS] ??= {};data.flags[NS].firearmTuning={startedAt:null};
    if(Array.isArray(data.changes))data.changes=data.changes.filter(change=>!(change.key==="activities[attack].attack.bonus" && Number(change.mode)===2 && String(change.value).trim()==="1"));
    data.duration={...data.duration,startTime:null,seconds:null};
    return true;
  }
  Promise.resolve(existing.update({duration:{startTime:null,seconds:null},[`flags.${NS}.firearmTuning`]:{startedAt:null},disabled:false}))
    .catch(error=>console.error(`${NS} | Failed to reset firearm tuning.`,error));
  return false;
}
export function allowMagicalFirearmTuning(activity,item,errors) {
  if(!isTuningActivity(activity) || !isFirearm(item) || !Array.isArray(errors))return;
  const message=globalThis.game?.i18n?.localize?.("DND5E.ENCHANT.Warning.NoMagicalItems");
  if(!message || message==="DND5E.ENCHANT.Warning.NoMagicalItems")return;
  for(let index=errors.length-1;index>=0;index--)if(errors[index]?.message===message)errors.splice(index,1);
}
