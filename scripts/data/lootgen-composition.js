import { validateUpgradeChoices } from "./item-upgrade-choices.js?v=1.4.255";

const TYPES = new Set(["gear", "material", "magicItem"]);
const HOST_KEYS = ["version", "instanceKey", "sourceType", "sourceId", "quantity", "isBroken", "upgrades", "container"];
const CHILD_KEYS = ["instanceKey", "sourceId", "slotIndex", "choices"];
const MOD_MOUNTS = ["top","bottom-1","bottom-2","side-1","side-2","barrel"];
const object = value => value && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const fail = field => { const error = new Error(`Некорректный состав лута: ${field}.`); error.code = "invalid-lootgen-descriptor"; throw error; };

/** Strict transport DTO: component state lives in the physical graph, never in arbitrary descriptor fields. */
export function normalizeWeaponModComposition(raw,{instanceKeys=new Set()}={}) {
  if(!exact(raw,["version","attachments","modernizedParts"]) || raw.version!==1 || !Array.isArray(raw.attachments)
    || !Array.isArray(raw.modernizedParts) || raw.attachments.length>6 || raw.modernizedParts.length>4)fail("weapon-mods");
  const occupied=new Set(),sources=new Set();
  const read=(child,attachment)=>{
    if(!exact(child,attachment?["instanceKey","sourceId","mountIds"]:["instanceKey","sourceId"])
      || !id(child.instanceKey) || !id(child.sourceId) || instanceKeys.has(child.instanceKey) || sources.has(child.sourceId))fail("weapon-mod-child");
    instanceKeys.add(child.instanceKey);sources.add(child.sourceId);
    if(!attachment)return {instanceKey:child.instanceKey,sourceId:child.sourceId};
    if(!Array.isArray(child.mountIds) || !child.mountIds.length || child.mountIds.some(mount=>!MOD_MOUNTS.includes(mount)
      || occupied.has(mount) || child.mountIds.indexOf(mount)!==child.mountIds.lastIndexOf(mount)))fail("weapon-mod-mounts");
    child.mountIds.forEach(mount=>occupied.add(mount));
    return {instanceKey:child.instanceKey,sourceId:child.sourceId,mountIds:[...child.mountIds]};
  };
  return {version:1,attachments:raw.attachments.map(child=>read(child,true)),modernizedParts:raw.modernizedParts.map(child=>read(child,false))};
}
export const weaponModComponents = descriptor => [...(descriptor?.weaponMods?.attachments ?? []),...(descriptor?.weaponMods?.modernizedParts ?? [])];

/** Boundary adapter only: legacy plain rows never acquire a new random identity or composition. */
export function normalizeLootgenFlatItemDescriptor(raw, { legacy = false, allowContainer = false } = {}) {
  let value = raw;
  if (legacy && ![2,3].includes(raw?.version)) {
    if (!object(raw) || (raw.version != null && raw.version !== 1)
      || (raw.upgrades != null && (!Array.isArray(raw.upgrades) || raw.upgrades.length)) || raw.container != null || raw.weaponMods != null) fail("legacy-composition");
    value = { version:2, instanceKey:`legacy:${raw.sourceType}:${raw.sourceId}:${raw.isBroken === true ? "broken" : "intact"}`,
      sourceType:raw.sourceType, sourceId:raw.sourceId, quantity:raw.quantity ?? 1, isBroken:raw.isBroken === true, upgrades:[], container:null };
  }
  if (!exact(value,value?.version===3?[...HOST_KEYS,"weaponMods"]:HOST_KEYS) || ![2,3].includes(value.version) || !id(value.instanceKey) || !TYPES.has(value.sourceType) || !id(value.sourceId)
    || !Number.isSafeInteger(value.quantity) || value.quantity < 1 || typeof value.isBroken !== "boolean") fail("host");
  if (value.container !== null && !allowContainer) fail("container-requires-tree-owner");
  if (!Array.isArray(value.upgrades) || value.upgrades.length > 3 || (value.upgrades.length && value.quantity !== 1)) fail("upgrades-quantity");
  const keys = new Set([value.instanceKey]), slots = new Set();
  const upgrades = value.upgrades.map(child => {
    if (!exact(child,CHILD_KEYS) || !object(child.choices) || !id(child.instanceKey) || !id(child.sourceId) || keys.has(child.instanceKey)
      || !Number.isInteger(child.slotIndex) || child.slotIndex < 1 || child.slotIndex > 3 || slots.has(child.slotIndex)) fail("child");
    keys.add(child.instanceKey);slots.add(child.slotIndex);
    return { instanceKey:child.instanceKey, sourceId:child.sourceId, slotIndex:child.slotIndex,
      choices:validateUpgradeChoices(child.sourceId,child.choices) };
  });
  const weaponMods=value.version===3?normalizeWeaponModComposition(value.weaponMods,{instanceKeys:keys}):null;
  if(weaponMods && (weaponMods.attachments.length || weaponMods.modernizedParts.length) && value.quantity!==1)fail("weapon-mods-quantity");
  return { version:value.version, instanceKey:value.instanceKey, sourceType:value.sourceType, sourceId:value.sourceId,
    quantity:value.quantity, isBroken:value.isBroken, upgrades, container:value.container,...(weaponMods?{weaponMods}:{}) };
}

/** Storage owns quantity and the only nested tree; composition metadata contains neither. */
export function normalizeLootgenComposition(raw) {
  const keys=[...HOST_KEYS,...(raw?.version===3?["weaponMods"]:[])].filter(key=>key!=="quantity" && key!=="container");
  if(!exact(raw,keys))fail("storage-composition");
  const {quantity,container,...composition}=normalizeLootgenFlatItemDescriptor({...raw,quantity:1,container:null});
  return composition;
}
