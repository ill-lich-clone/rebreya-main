import {getWeaponModHostDescriptor,WEAPON_MOD_MOUNTS} from "./weapon-mod-rules.js?v=1.5.23";
export function buildWeaponBlueprintIndex(manifest,hosts){
  if(manifest?.version!==1 || !Array.isArray(manifest.blueprints) || !manifest.fallbacks)throw new Error("Некорректный каталог чертежей.");
  const byId=new Map(),validate=(entry,family)=>{
    const mounts=WEAPON_MOD_MOUNTS[family];
    if(!entry || typeof entry.img!=="string" || !/^modules\/rebreya-main\/assets\/weapon-blueprints\/[a-z0-9-]+\.png$/u.test(entry.img)
      || !Number.isFinite(entry.width) || entry.width<=0 || !Number.isFinite(entry.height) || entry.height<=0
      || !mounts || Object.keys(entry.anchors??{}).length!==mounts.length || mounts.some(id=>{
        const point=entry.anchors[id];return !point || ![point.x,point.y].every(value=>Number.isFinite(value)&&value>=0&&value<=1);
      }))throw new Error("Отсутствует изображение или точка крепления чертежа.");
  };
  const paths=new Set();
  for(const entry of manifest.blueprints){
    const host=hosts.find(host=>host.gearId===entry.gearId);
    if(!host || byId.has(entry.gearId) || paths.has(entry.img))throw new Error("Повторный или неизвестный чертёж.");
    validate(entry,host.family);byId.set(entry.gearId,{...entry,isFallback:false});paths.add(entry.img);
  }
  for(const host of hosts)if(!byId.has(host.gearId))throw new Error("Нет индивидуального чертежа: "+host.gearId);
  const fallbacks={};for(const family of Object.keys(WEAPON_MOD_MOUNTS)){
    const entry=manifest.fallbacks[family];validate(entry,family);
    if(paths.has(entry.img))throw new Error("Резервный чертёж должен быть отдельным.");paths.add(entry.img);fallbacks[family]={...entry,isFallback:true};
  }
  return {byId,fallbacks};
}
export function getWeaponBlueprint(index,item,catalog){
  const host=getWeaponModHostDescriptor(item,catalog);if(!host)return null;
  const known=catalog.hosts.some(entry=>entry.gearId===host.gearId);
  if(known && !index.byId.has(host.gearId))throw new Error("Нет индивидуального чертежа: "+host.gearId);
  return index.byId.get(host.gearId)??index.fallbacks[host.family];
}
let blueprintPromise;
export function loadWeaponBlueprints(hosts){
  blueprintPromise??=fetch("modules/rebreya-main/data/weapon-blueprints.json?v=1.4.387",{cache:"no-store"}).then(response=>{
    if(!response.ok)throw new Error("Не удалось загрузить чертежи: "+response.status);
    return response.json();
  }).then(manifest=>buildWeaponBlueprintIndex(manifest,hosts)).catch(error=>{blueprintPromise=undefined;throw error;});
  return blueprintPromise;
}
