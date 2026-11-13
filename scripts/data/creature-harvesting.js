import { MATERIALS_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { createDnd5eItemData } from "./materials-compendium.js?v=1.5.72";
import { TOP_DOWN_ITEM_TEXTURES } from "./top-down-item-texture-catalog.js?v=1.4.322";
import { canonicalCatalogId } from "../shared/canonical-catalog-id.js";

export const HARVEST_DCS = Object.freeze([20, 21, 22, 23, 25, 26, 27, 28, 30, 35]);
export const DEFAULT_HARVEST_CHECK = "wis:sur";
const abilities = ["str", "dex", "con", "int", "wis", "cha"];
const standardSkills = { acr: "dex", ani: "wis", arc: "int", ath: "str", dec: "cha", his: "int", ins: "wis",
  itm: "cha", inv: "int", med: "wis", nat: "int", prc: "wis", prf: "cha", per: "cha", rel: "int",
  slt: "dex", ste: "dex", sur: "wis" };
const BLOOD = "Кровь чудовища";
const bloodlessTypes = new Set(["construct", "elemental", "ooze", "undead", "конструкт", "элементаль", "слизь", "нежить"]);
const normalize = value => String(value ?? "").normalize("NFC").trim().toLocaleLowerCase("ru")
  .replace(/\s+/g, " ").replaceAll("ё", "е");
const isHumanoid = value => /^(?:humanoids?|гуманоиды?)(?:\s*\([^)]*\))?$/.test(normalize(value));
const isBlood = name => /^кровь чудовища(?: \d+-й ранг)?$/.test(normalize(name));

export function harvestDc(rank, override) {
  return HARVEST_DCS[rank] ?? (rank === 10 && Number.isInteger(override) && override > 0 ? override : null);
}

export function harvestChecks(skills = globalThis.CONFIG?.DND5E?.skills) {
  const checks = Object.entries(skills ?? standardSkills).map(([skill, config]) => `${config.ability ?? config}:${skill}`);
  return [...new Set([DEFAULT_HARVEST_CHECK, ...checks, ...abilities])];
}

export function harvestAvailability({ type, custom, overrideType }) {
  if ([type, custom, overrideType].some(isHumanoid)) return "humanoid";
  if (!normalize(type === "custom" ? custom : type) && !overrideType) return "type";
  return null;
}

export function matchHarvestMonster(catalog, names, selectedId) {
  if (selectedId) return catalog.filter(entry => entry.id === selectedId);
  for (const name of names.map(normalize).filter(Boolean)) {
    const matches = catalog.filter(entry => normalize(entry.name) === name);
    if (matches.length) return matches;
  }
  return [];
}

export function harvestHasBlood(monster, type) {
  return [monster?.typeLoot, ...(monster?.common ?? [])].some(isBlood) || !bloodlessTypes.has(normalize(type));
}

export function harvestRewards(monster, { total, dc, type, bloodOverride, random = Math.random }) {
  const margin = total - dc;
  if (margin <= -5) return { outcome: "severe", loot: [] };
  const names = [monster.typeLoot, ...monster.common].filter(Boolean);
  const authoredBlood = names.find(isBlood);
  const common = names.filter(name => !isBlood(name));
  if (bloodOverride ?? harvestHasBlood(monster, type)) common.push(authoredBlood || BLOOD);
  const loot = common.map(name => ({ name, unique: false }));
  if (margin < 0) {
    const selected = loot[Math.floor(random() * loot.length)];
    return { outcome: "partial", loot: selected ? [selected] : [] };
  }
  if (margin >= 5) {
    loot.push({ name: monster.unique || `Уникальный компонент — ${monster.name}`, unique: true });
    return { outcome: "exceptional", loot };
  }
  return { outcome: "success", loot };
}

function materialIcon(id, icons) {
  const key = canonicalCatalogId(id);
  return icons?.get(key) || TOP_DOWN_ITEM_TEXTURES.get(`material:${key}`);
}

export function harvestItem(reward, materials, monster, icons) {
  const name = normalize(reward.name);
  const material = materials.find(item => normalize(item.name) === name);
  if (material) {
    const data = createDnd5eItemData(material);
    data.img = materialIcon(material.id, icons) || data.img;
    return data;
  }
  return {
    name: reward.name,
    type: "loot",
    img: "icons/svg/item-bag.svg",
    system: { description: { value: "", chat: "" }, quantity: 1, type: { value: "material" } },
    flags: { [MODULE_ID]: { harvestSource: { monsterId: monster.id, unique: reward.unique } } }
  };
}

const genericIcons = new Set(["", "icons/svg/item-bag.svg", "systems/dnd5e/icons/svg/items/loot.svg",
  "icons/commodities/leather/leather-bolt-brown.webp"]);

export async function getHarvestMaterialIcons(game = globalThis.game) {
  const pack = game?.packs?.get(`world.${MATERIALS_COMPENDIUM_NAME}`);
  let entries = [];
  try {
    entries = await pack?.getIndex({ fields: [`flags.${MODULE_ID}.materialId`, "img"] }) ?? [];
  } catch (error) {
    console.warn(`${MODULE_ID} | Harvest material icons unavailable`, error);
  }
  const icons = new Map();
  for (const item of [...entries, ...(game?.items ?? [])]) {
    const id = item.flags?.[MODULE_ID]?.materialId;
    if (id && !genericIcons.has(item.img ?? "")) icons.set(canonicalCatalogId(id), item.img);
  }
  return icons;
}

export async function repairHarvestIcons(rows, claimedRowIds, getIcons) {
  const claimed = new Set(claimedRowIds);
  const candidates = new Map();
  for (const row of rows) {
    const id = row.itemData?.flags?.[MODULE_ID]?.materialId;
    if (row.rowId?.startsWith("harvest:") && id && !claimed.has(row.rowId)
      && genericIcons.has(row.img ?? "") && genericIcons.has(row.itemData.img ?? "")) candidates.set(row, id);
  }
  if (!candidates.size) return rows;
  const icons = await getIcons();
  let changed = false;
  const next = rows.map(row => {
    const id = candidates.get(row);
    const img = id && materialIcon(id, icons);
    if (!img || (img === row.img && img === row.itemData.img)) return row;
    changed = true;
    return { ...row, img, itemData: { ...row.itemData, img } };
  });
  return changed ? next : rows;
}
