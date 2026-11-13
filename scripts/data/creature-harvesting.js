import { MODULE_ID } from "../constants.js";
import { createDnd5eItemData } from "./materials-compendium.js?v=1.5.72";

export const HARVEST_DCS = Object.freeze([20, 21, 22, 23, 25, 26, 27, 28, 30, 35]);
export const HARVEST_MINUTES = 10;
const BLOOD = "Кровь чудовища";
const bloodlessTypes = new Set(["construct", "elemental", "ooze", "undead", "конструкт", "элементаль", "слизь", "нежить"]);
const normalize = value => String(value ?? "").normalize("NFC").trim().toLocaleLowerCase("ru")
  .replace(/\s+/g, " ").replaceAll("ё", "е");
const isHumanoid = value => /^(?:humanoids?|гуманоиды?)(?:\s*\([^)]*\))?$/.test(normalize(value));
const isBlood = name => /^кровь чудовища(?: \d+-й ранг)?$/.test(normalize(name));

export function harvestDc(rank, override) {
  return HARVEST_DCS[rank] ?? (rank === 10 && Number.isInteger(override) && override > 0 ? override : null);
}

export function harvestAvailability({ type, custom, overrideType, diedAt, now }) {
  if ([type, custom, overrideType].some(isHumanoid)) return "humanoid";
  if (!normalize(type === "custom" ? custom : type) && !overrideType) return "type";
  if (!Number.isFinite(diedAt) || !Number.isFinite(now) || now < diedAt) return "freshness";
  return now - diedAt > 3600 ? "expired" : null;
}

export function matchHarvestMonster(catalog, names, selectedId) {
  if (selectedId) return catalog.filter(entry => entry.id === selectedId);
  for (const name of names.map(normalize).filter(Boolean)) {
    const matches = catalog.filter(entry => normalize(entry.name) === name);
    if (matches.length) return matches;
  }
  return [];
}

export function harvestRewards(monster, { total, dc, type, bloodOverride, random = Math.random }) {
  const margin = total - dc;
  if (margin <= -5) return { outcome: "severe", loot: [] };
  const names = [monster.typeLoot, ...monster.common].filter(Boolean);
  const authoredBlood = names.find(isBlood);
  const common = names.filter(name => !isBlood(name));
  if (authoredBlood) common.push(authoredBlood);
  else if (bloodOverride ?? !bloodlessTypes.has(normalize(type))) common.push(BLOOD);
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

export function harvestItem(reward, materials, monster) {
  const name = normalize(reward.name);
  const material = materials.find(item => normalize(item.name) === name);
  if (material) return createDnd5eItemData(material);
  return {
    name: reward.name,
    type: "loot",
    img: "icons/svg/item-bag.svg",
    system: { description: { value: "", chat: "" }, quantity: 1, type: { value: "material" } },
    flags: { [MODULE_ID]: { harvestSource: { monsterId: monster.id, unique: reward.unique } } }
  };
}
