import { getHeroDollSlots } from "./item-classification.js?v=1.4.338-hero-doll-menu";

const slotIds = new Set(getHeroDollSlots().map(slot => slot.id));
export const HERO_DOLL_GHOST_IMAGE = "icons/svg/item-bag.svg";
const object = value => value && typeof value === "object" && !Array.isArray(value);

export function normalizeHeroDollPresets(raw) {
  const references = slots => Object.fromEntries(Object.entries(object(slots) ? slots : {})
    .filter(([slot,entry]) => slotIds.has(slot) && object(entry) && typeof entry.itemId === "string" && entry.itemId)
    .map(([slot,entry]) => [slot,{itemId:entry.itemId,name:String(entry.name ?? "Предмет"),img:String(entry.img || HERO_DOLL_GHOST_IMAGE)}]));
  const ids = new Set();
  const presets = (Array.isArray(raw?.presets) ? raw.presets : []).filter(preset => {
    if (!object(preset) || typeof preset.id !== "string" || !preset.id || ids.has(preset.id)) return false;
    ids.add(preset.id);return true;
  }).map(preset => ({id:preset.id,name:String(preset.name ?? "Комплект"),slots:references(preset.slots)}));
  return {version:1,presets,activePresetId:presets.some(preset=>preset.id===raw?.activePresetId)?raw.activePresetId:"",ghosts:references(raw?.ghosts)};
}

export function captureHeroDollPresetSlots(actor, dollState, presetState) {
  const slots = structuredClone(presetState.ghosts);
  for (const [slot,entry] of Object.entries(dollState.slots ?? {})) {
    const item = actor.items.get(entry.itemId);
    if (item && slotIds.has(slot)) slots[slot]={itemId:item.id,name:item.name,img:item.img || HERO_DOLL_GHOST_IMAGE};
  }
  return slots;
}

export function heroDollPresetModified(actor, dollState, presetState) {
  const preset = presetState.presets.find(entry=>entry.id===presetState.activePresetId);
  if (!preset) return false;
  // Metadata updates and missing documents are not edits to the saved layout.
  const current = {...presetState.ghosts,...(dollState.slots ?? {})};
  const all = new Set([...Object.keys(current),...Object.keys(preset.slots)]);
  return [...all].some(slot=>current[slot]?.itemId !== preset.slots[slot]?.itemId);
}
