import { MODULE_ID } from "../constants.js";
import { getInstalledUpgradeItems } from "../data/item-upgrade-service.js?v=1.4.96-item-upgrades";

export const CURSE_EATER_RARITY = Object.freeze({
  common: 0,
  uncommon: 1,
  rare: 2,
  veryRare: 3,
  legendary: 4,
  artifact: 5
});

const CURSE_EATER_TIER_REQUIREMENTS = Object.freeze([
  CURSE_EATER_RARITY.uncommon,
  CURSE_EATER_RARITY.rare,
  CURSE_EATER_RARITY.rare,
  CURSE_EATER_RARITY.rare,
  CURSE_EATER_RARITY.veryRare,
  CURSE_EATER_RARITY.veryRare,
  CURSE_EATER_RARITY.legendary,
  CURSE_EATER_RARITY.artifact
]);

const ITEM_RARITY_BY_NAME = new Map([
  ["common", CURSE_EATER_RARITY.common],
  ["обычный", CURSE_EATER_RARITY.common],
  ["обычная", CURSE_EATER_RARITY.common],
  ["uncommon", CURSE_EATER_RARITY.uncommon],
  ["необычный", CURSE_EATER_RARITY.uncommon],
  ["необычная", CURSE_EATER_RARITY.uncommon],
  ["rare", CURSE_EATER_RARITY.rare],
  ["редкий", CURSE_EATER_RARITY.rare],
  ["редкая", CURSE_EATER_RARITY.rare],
  ["veryrare", CURSE_EATER_RARITY.veryRare],
  ["очень редкий", CURSE_EATER_RARITY.veryRare],
  ["очень редкая", CURSE_EATER_RARITY.veryRare],
  ["legendary", CURSE_EATER_RARITY.legendary],
  ["легендарный", CURSE_EATER_RARITY.legendary],
  ["легендарная", CURSE_EATER_RARITY.legendary],
  ["artifact", CURSE_EATER_RARITY.artifact],
  ["артефакт", CURSE_EATER_RARITY.artifact]
]);

function getProperty(source, path) {
  return globalThis.foundry?.utils?.getProperty?.(source, path)
    ?? String(path ?? "").split(".").reduce((current, part) => (
      current && typeof current === "object" ? current[part] : undefined
    ), source);
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

function readModuleFlag(document, key) {
  return document?.getFlag?.(MODULE_ID, key)
    ?? getProperty(document, `flags.${MODULE_ID}.${key}`);
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/gu, " ");
}

function isCurseText(value) {
  return /проклят(?:ье|ие)/iu.test(String(value ?? ""));
}

function normalizeItemRarity(item) {
  const rawRarity = getProperty(item, "system.rarity")
    ?? readModuleFlag(item, "rarity")
    ?? "";
  const normalized = normalizeText(rawRarity).replace(/\s+/gu, " ");
  return ITEM_RARITY_BY_NAME.get(normalized)
    ?? ITEM_RARITY_BY_NAME.get(normalized.replace(/\s+/gu, ""))
    ?? CURSE_EATER_RARITY.common;
}

function readUpgradeProfile(upgrade) {
  const profile = readModuleFlag(upgrade, "upgrade");
  return profile && typeof profile === "object" ? profile : {};
}

export function curseRankToRarity(rank) {
  const numericRank = Number(rank);
  const safeRank = Number.isFinite(numericRank)
    ? Math.max(1, Math.min(10, Math.trunc(numericRank)))
    : 1;
  return Math.floor((safeRank - 1) / 2);
}

export function getEffectiveCursedItemRarity(item) {
  const curseRarities = getInstalledUpgradeItems(item)
    .map(readUpgradeProfile)
    .filter((profile) => isCurseText(profile.type))
    .map((profile) => curseRankToRarity(profile.rank));
  return Math.max(normalizeItemRarity(item), ...curseRarities);
}

function isCursedItem(item) {
  const description = getProperty(item, "system.description.value")
    ?? getProperty(item, "system.description")
    ?? "";
  return isCurseText(description)
    || getInstalledUpgradeItems(item)
      .map(readUpgradeProfile)
      .some((profile) => isCurseText(profile.type));
}

export function collectActiveCursedItems(actor) {
  const slots = readModuleFlag(actor, "heroDoll")?.slots ?? {};
  const itemIds = [...new Set(
    Object.values(slots)
      .map((slot) => String(slot?.itemId ?? "").trim())
      .filter(Boolean)
  )];
  const actorItems = collectionValues(actor?.items);

  return itemIds
    .map((itemId) => actor?.items?.get?.(itemId)
      ?? actorItems.find((item) => String(item?.id ?? item?._id ?? "") === itemId)
      ?? null)
    .filter((item) => item && isCursedItem(item))
    .map((item) => ({
      itemId: String(item.id ?? item._id ?? ""),
      itemName: String(item.name ?? ""),
      rarity: getEffectiveCursedItemRarity(item)
    }))
    .sort((left, right) => (
      (left.rarity - right.rarity)
      || left.itemId.localeCompare(right.itemId)
    ));
}

export function calculateCurseEaterProgress(items = []) {
  const available = (Array.isArray(items) ? items : [])
    .map((item) => ({
      ...item,
      itemId: String(item?.itemId ?? ""),
      rarity: Math.max(
        CURSE_EATER_RARITY.common,
        Math.min(CURSE_EATER_RARITY.artifact, Math.trunc(Number(item?.rarity) || 0))
      )
    }))
    .sort((left, right) => (
      (left.rarity - right.rarity)
      || left.itemId.localeCompare(right.itemId)
    ));
  const usedItems = [];

  for (const requiredRarity of CURSE_EATER_TIER_REQUIREMENTS) {
    const itemIndex = available.findIndex((item) => item.rarity >= requiredRarity);
    if (itemIndex < 0) break;
    usedItems.push(available.splice(itemIndex, 1)[0]);
  }

  return {
    tier: usedItems.length,
    usedItemIds: usedItems.map((item) => item.itemId),
    usedItems
  };
}
