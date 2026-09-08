import { validateUpgradeChoices } from "./item-upgrade-choices.js?v=1.4.255";

const TYPES = new Set(["gear", "material", "magicItem"]);
const HOST_KEYS = ["version", "instanceKey", "sourceType", "sourceId", "quantity", "isBroken", "upgrades", "container"];
const CHILD_KEYS = ["instanceKey", "sourceId", "slotIndex", "choices"];
const object = value => value && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const fail = field => { const error = new Error(`Некорректный состав лута: ${field}.`); error.code = "invalid-lootgen-descriptor"; throw error; };

/** Boundary adapter only: legacy plain rows never acquire a new random identity or composition. */
export function normalizeLootgenFlatItemDescriptor(raw, { legacy = false, allowContainer = false } = {}) {
  let value = raw;
  if (legacy && raw?.version !== 2) {
    if (!object(raw) || (raw.version != null && raw.version !== 1)
      || (raw.upgrades != null && (!Array.isArray(raw.upgrades) || raw.upgrades.length)) || raw.container != null) fail("legacy-composition");
    value = { version:2, instanceKey:`legacy:${raw.sourceType}:${raw.sourceId}:${raw.isBroken === true ? "broken" : "intact"}`,
      sourceType:raw.sourceType, sourceId:raw.sourceId, quantity:raw.quantity ?? 1, isBroken:raw.isBroken === true, upgrades:[], container:null };
  }
  if (!exact(value,HOST_KEYS) || value.version !== 2 || !id(value.instanceKey) || !TYPES.has(value.sourceType) || !id(value.sourceId)
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
  return { version:2, instanceKey:value.instanceKey, sourceType:value.sourceType, sourceId:value.sourceId,
    quantity:value.quantity, isBroken:value.isBroken, upgrades, container:value.container };
}

/** Storage owns quantity and the only nested tree; composition metadata contains neither. */
export function normalizeLootgenComposition(raw) {
  const keys=HOST_KEYS.filter(key=>key!=="quantity" && key!=="container");
  if(!exact(raw,keys))fail("storage-composition");
  const {quantity,container,...composition}=normalizeLootgenFlatItemDescriptor({...raw,quantity:1,container:null});
  return composition;
}
