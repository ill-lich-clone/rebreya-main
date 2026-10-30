import { MODULE_ID } from "../constants.js";
import { inferRebreyaWeaponAmmunitionSubtype } from "../data/ammunition-types.js";
import { resolveAmmunitionProfile } from "../data/ammunition-compatibility.js?v=1.5.31";

export const LEGACY_AMMUNITION = "@legacy";
export function ammunitionFingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(ammunitionFingerprint).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>`${JSON.stringify(k)}:${ammunitionFingerprint(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function captureAmmunition(item, options = {}) {
  const data = structuredClone(item?.toObject?.() ?? {name:item.name,type:item.type,img:item.img,system:item.system,flags:item.flags??{},...(item.effects!==undefined?{effects:item.effects?.toObject?.()??item.effects}:{})});
  const profile=resolveAmmunitionProfile(item,options);
  if(profile!=null && data.flags?.[MODULE_ID]?.ammunition==null){
    data.flags??={};data.flags[MODULE_ID]??={};data.flags[MODULE_ID].ammunition=structuredClone(profile);
  }
  for (const key of ["_id", "id", "_stats", "folder", "sort", "ownership"]) delete data[key];
  data.system ??= {};
  delete data.system.quantity; delete data.system.container;
  const flags=data.flags?.[MODULE_ID];
  if(flags) for(const key of ["itemInstanceOrigin","itemInstanceDebit","itemInstancePlacement","inventoryMutation"]) delete flags[key];
  const mechanics=structuredClone(data);delete mechanics.name;delete mechanics.img;
  delete mechanics.system.identifier;
  const native=mechanics.flags?.dnd5e;
  if(native?.riders?.activity?.length===0){delete native.riders.activity;if(!Object.keys(native.riders).length)delete native.riders;}
  if(native && !Object.keys(native).length)delete mechanics.flags.dnd5e;
  const durability=mechanics.flags?.[MODULE_ID]?.durability;
  if(durability){
    delete durability.updatedAt;
    if(durability.initializedFrom && durability.state==="intact" && durability.breakStage===0 && durability.hp?.value===durability.hp?.max)delete mechanics.flags[MODULE_ID].durability;
  }
  if(data.system.type?.subtype==="firearmBullet")mechanics.legacyAmmunitionFamily=inferRebreyaWeaponAmmunitionSubtype({lichWeaponPropertyValues:{ammunition:data.name}});
  if(mechanics.system.description)delete mechanics.system.description;
  let hash=0xcbf29ce484222325n;
  for(const byte of new TextEncoder().encode(ammunitionFingerprint(mechanics))) hash=BigInt.asUintN(64,(hash^BigInt(byte))*0x100000001b3n);
  return { key: `ammo${hash.toString(16).padStart(16,"0")}`, data };
}

export function magazineRounds(state = {}) {
  const current=Number(state.current ?? 0);
  if (!Number.isSafeInteger(current) || current<0) throw new Error("Повреждено количество патронов.");
  if(state.schemaVersion!==2) return {rounds:Array(current).fill(LEGACY_AMMUNITION),sources:{}};
  const rounds=structuredClone(state.rounds),sources=structuredClone(state.sources??{});
  if(!Array.isArray(rounds) || rounds.length!==current || rounds.some(key=>typeof key!=="string" || (key!==LEGACY_AMMUNITION && !sources[key]))) throw new Error("Повреждён состав магазина.");
  return {rounds,sources};
}

export function validateMagazine(rounds,groupSize,capacity) {
  if(!Array.isArray(rounds) || ![1,3,6].includes(groupSize) || !Number.isSafeInteger(capacity) || capacity<0 || rounds.length>capacity) throw new Error("Неверная вместимость магазина.");
  for(let i=0;i<rounds.length;i+=groupSize){
    const group=rounds.slice(i,i+groupSize);
    if(group.some(key=>typeof key!=="string" || !key || key!==group[0])) throw new Error("В одной ячейке должны быть одинаковые патроны.");
  }
}

function nativeDamagePart(part) {
  if(!part)return null;
  const formula=part.custom?.enabled?part.custom.formula:part.formula || (part.number && part.denomination?`${part.number}d${part.denomination}${part.bonus?` + ${part.bonus}`:""}`:part.bonus);
  return formula?{formula:String(formula),type:Array.from(part.types??[])[0]??""}:null;
}

export function getAmmunitionDamage(data) {
  if(!data)return {parts:[],type:"",dieStep:0,manual:""};
  const profile=data.flags?.[MODULE_ID]?.ammunition??{},id=data.flags?.[MODULE_ID]?.gearId;
  const native=[nativeDamagePart(data.system?.damage?.base),...(data.system?.damage?.parts??[]).map(nativeDamagePart)].filter(Boolean);
  const type={"боеприпасы-с-огненной-мазью-20":"fire","boepripasy-s-ognennoy-maz-yu-20":"fire","боеприпасы-с-ледяной-мазью-20":"cold","boepripasy-s-ledyanoy-maz-yu-20":"cold"}[id];
  const direct=type?[{formula:"1d6",type}]:null;
  const authored=profile.damageModifiers??[],text=String(profile.propertiesText??"");
  const defaultText=type==="fire"?"При попадании атака наносит дополнительно 1к6 урона огнём.":"При попадании атака наносит дополнительно 1к6 урона холодом.";
  return {parts:native.length?native:structuredClone(authored.length?authored:direct??[]),type:profile.damageType??"",dieStep:Number(profile.handCannonDamageDieStep)||0,
    replace:Boolean(native.length && data.system?.damage?.replace),native:Boolean(native.length),manual:direct&&!native.length&&!authored.length&&text===defaultText?"":text};
}

export function applyAmmunitionDamage(config,data,{nativeApplied=false,physicalProperties=[]}={}) {
  if(config.rebreyaAmmunitionApplied)return;
  config.rebreyaAmmunitionApplied=true;
  const rule=getAmmunitionDamage(data),base=config.rolls?.find(x=>x.base)??config.rolls?.[0];
  if(!base)return;
  for(const roll of config.rolls){roll.options??={};roll.options.properties=[...new Set([...Array.from(roll.options.properties??[]),...physicalProperties])];}
  base.options??={};
  if(rule.type)base.options.type=rule.type;
  if(rule.dieStep){
    const steps=[1,4,6,8,10,12];let changed=false;
    base.parts=(base.parts??[]).map(part=>String(part).replace(/(\d+)d(\d+)/u,(match,n,faces)=>{
      if(changed)return match;changed=true;const index=steps.indexOf(Number(faces));return index<0?match:`${n}d${steps[Math.max(0,Math.min(steps.length-1,index+rule.dieStep))]}`;
    }));
  }
  if(!(nativeApplied && rule.native)){
    for(const [index,part] of rule.parts.entries()){
      if(rule.replace && index===0){base.parts=[part.formula,...base.parts.slice(1)];base.options.type=part.type;continue;}
      config.rolls.push({parts:[part.formula],data:base.data??{},options:{...base.options,...(base.options.critical?{critical:{...base.options.critical}}:{}),type:part.type,rebreyaAmmunition:true}});
    }
    const bonus=data?.system?.magicalBonus;
    if(!nativeApplied && bonus && data.system.magicAvailable!==false)base.parts.push(String(bonus));
  }
}
