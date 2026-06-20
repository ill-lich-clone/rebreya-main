import { MODULE_ID } from "../constants.js";
import { buildNamedIconLookup, normalizeFolderPath, resolveNamedIcon } from "./compendium-utils.js";
import { classifyGearEntry } from "./item-classification.js";

export const DEFAULT_GEAR_ICON = "systems/dnd5e/icons/svg/items/loot.svg";

const CUSTOM_GEAR_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const GEAR_ICON_SEARCH_PATHS = [
  `${CUSTOM_GEAR_ICONS_BASE_PATH}/Goods`,
  `${CUSTOM_GEAR_ICONS_BASE_PATH}/weapons`,
  CUSTOM_GEAR_ICONS_BASE_PATH
];

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function buildFolderPath(classification) {
  return normalizeFolderPath(classification?.folderPath);
}

function stripTrailingParenthetical(value) {
  return cleanString(value).replace(/\s*\([^()]*\)\s*$/u, "").trim();
}

function getGearIconNameCandidates(item) {
  const name = cleanString(item?.name);
  if (!name) {
    return [];
  }

  const candidates = [];
  const equipmentType = cleanString(item?.equipmentType);
  if (equipmentType) {
    candidates.push(`${name} (${equipmentType})`);
  }

  candidates.push(name);

  const shortenedName = stripTrailingParenthetical(name);
  if (shortenedName && shortenedName !== name) {
    candidates.push(shortenedName);
  }

  return Array.from(new Set(candidates));
}

export async function buildGearIconLookup({ forceRefresh = false } = {}) {
  return buildNamedIconLookup(GEAR_ICON_SEARCH_PATHS, { forceRefresh });
}

export function resolveGearNamedIcon(item, iconLookup) {
  for (const iconName of getGearIconNameCandidates(item)) {
    const iconPath = resolveNamedIcon(iconName, iconLookup, "");
    if (iconPath) {
      return iconPath;
    }
  }

  return "";
}

export function resolveGearItemIcon(item, { classification = null, iconLookup = null } = {}) {
  const safeClassification = classification ?? classifyGearEntry(item ?? {});
  const folderPath = buildFolderPath(safeClassification).join(" / ").toLowerCase();
  const typeText = normalizeMatchText(item?.equipmentType);
  const namedCustomIcon = resolveGearNamedIcon(item, iconLookup);
  if (namedCustomIcon) {
    return namedCustomIcon;
  }

  if (safeClassification.documentType === "container") {
    if (safeClassification.systemTypeValue === "chest") {
      return "icons/containers/chest/chest-reinforced-steel-brown.webp";
    }

    return "icons/containers/bags/pack-simple-leather-brown.webp";
  }

  if (safeClassification.documentType === "weapon") {
    if (safeClassification.firearmClass) {
      return "icons/weapons/guns/gun-pistol-flintlock-metal.webp";
    }

    const weaponName = normalizeMatchText(item?.name);
    if (/арбалет/u.test(`${typeText} ${weaponName}`)) {
      return "icons/weapons/crossbows/crossbow-simple-brown.webp";
    }

    if (/пращ/u.test(`${typeText} ${weaponName}`)) {
      return "icons/weapons/slings/slingshot-wood.webp";
    }

    if (/лук/u.test(`${typeText} ${weaponName}`)) {
      return "icons/weapons/bows/longbow-recurve-brown.webp";
    }

    return "icons/weapons/swords/greatsword-crossguard-silver.webp";
  }

  if (safeClassification.documentType === "equipment") {
    if (safeClassification.systemTypeValue === "shield") {
      return "icons/equipment/shield/heater-steel-grey.webp";
    }

    return "icons/equipment/chest/breastplate-layered-steel.webp";
  }

  if (safeClassification.documentType === "tool") {
    return "icons/tools/smithing/anvil.webp";
  }

  if (safeClassification.documentType === "consumable") {
    if (safeClassification.systemTypeValue === "ammo") {
      return "icons/weapons/ammunition/arrow-broadhead-glowing-orange.webp";
    }

    return "icons/consumables/potions/potion-bottle-corked-labeled-red.webp";
  }

  if (folderPath.includes("обвес")) {
    return "icons/tools/hand/wrench-steel-grey.webp";
  }

  if (folderPath.includes("скакуны") || folderPath.includes("транспорт")) {
    return "icons/environment/settlement/wagon.webp";
  }

  if (folderPath.includes("снаряжение") && /рюкзак|сумк|чехол|футляр/u.test(normalizeMatchText(item?.name))) {
    return "icons/containers/bags/pack-simple-leather-brown.webp";
  }

  return DEFAULT_GEAR_ICON;
}
