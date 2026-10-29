import { MODULE_ID } from "../constants.js";

const registeredHooks = new WeakSet();
const physicalTypes = new Set(["weapon", "equipment", "tool", "consumable", "loot", "container"]);
const magicNames = new Set(["mgc", "magic", "magical", "магия", "магический"]);
const magicTypes = new Set(["magicitem", "magicitems", "magic", "magical", "магическийпредмет", "магия"]);
const token = value => typeof value === "string" ? value.trim().toLowerCase() : "";

function hasMagicProperty(properties) {
  if (properties instanceof Set || Array.isArray(properties)) return Array.from(properties).some(hasMagicProperty);
  if (typeof properties === "string") return magicNames.has(token(properties));
  if (!properties || typeof properties !== "object") return false;
  return hasMagicProperty(properties.value) || Object.entries(properties).some(([key, enabled]) => key !== "value" && enabled === true && magicNames.has(token(key)));
}

function isMagicItem(item) {
  const flags = item?.flags?.[MODULE_ID] ?? {};
  const dnd5e = item?.flags?.dnd5e ?? {};
  const rarityValue = item?.system?.rarity;
  const rarity = token(typeof rarityValue === "object" && rarityValue !== null
    ? rarityValue.value ?? rarityValue.id ?? rarityValue.key ?? rarityValue.slug : rarityValue);
  const sourceTypes = [flags.sourceType, flags.itemType, flags.magicItemType];
  const markers = [flags.magical, flags.isMagical, flags.isMagic, flags.magic, flags.magicItemId, flags.magicId,
    flags.magicItem, flags.magicWeaponTemplate, flags.magicArmorTemplate, flags.magicShieldTemplate,
    flags.magicEquipmentTemplate, flags.magicAmmunitionTemplate, dnd5e.magical, dnd5e.isMagical, dnd5e.isMagic, dnd5e.magic];
  return physicalTypes.has(item?.type) && (sourceTypes.some(value => magicTypes.has(token(value).replace(/[^\p{L}\p{N}]/gu, "")))
    || hasMagicProperty(item?.system?.properties) || Boolean(rarity && !["mundane", "none"].includes(rarity)) || markers.some(Boolean));
}

export function filterMagicItemSpellbook(actor, context) {
  const section = context?.spellbook?.item;
  if (actor?.type !== "character" || !Array.isArray(section?.items)) return;
  const slots = actor.getFlag?.(MODULE_ID, "heroDoll")?.slots ?? actor.flags?.[MODULE_ID]?.heroDoll?.slots ?? {};
  const equipped = new Set(Object.values(slots).map(slot => slot?.itemId).filter(Boolean));
  section.items = section.items.filter(spell => {
    const cachedFor = spell.getFlag?.("dnd5e", "cachedFor") ?? spell.flags?.dnd5e?.cachedFor;
    const item = cachedFor ? spell.system?.linkedActivity?.item : null;
    return !isMagicItem(item) || equipped.has(item.id);
  });
}

export function registerMagicItemSpellbookHook(hooks = globalThis.Hooks) {
  if (!hooks?.on || registeredHooks.has(hooks)) return;
  registeredHooks.add(hooks);
  hooks.on("dnd5e.prepareSheetContext", (sheet, partId, context) => {
    if (partId === "spells") filterMagicItemSpellbook(sheet?.actor, context);
  });
}
