import { MODULE_ID } from "../constants.js";

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

export function isMagicItem(item) {
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
