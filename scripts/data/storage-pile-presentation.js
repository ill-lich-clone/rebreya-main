import { MODULE_ID } from "../constants.js";
import { isStorageJournalRow } from "./storage-container-snapshot.js";
import { formatDurabilityItemName } from "./durability-item-presentation.js?v=1.4.200-storage-broken-presentation";
import { resolveTopDownItemPresentation } from "./top-down-item-texture-resolver.js?v=1.4.211-furniture-footprints";

const ASSET_ROOT = `modules/${MODULE_ID}/assets/storage/piles`;
const COIN_PRESENTATIONS = Object.freeze([
  Object.freeze({ denomination: "pp", name: "Платиновая монета", img: "icons/commodities/currency/coins-assorted-mix-platinum.webp" }),
  Object.freeze({ denomination: "gp", name: "Золотая монета", img: "icons/commodities/currency/coins-plain-gold.webp" }),
  Object.freeze({ denomination: "sp", name: "Серебряная монета", img: "icons/commodities/currency/coins-assorted-mix-silver.webp" }),
  Object.freeze({ denomination: "cp", name: "Медная монета", img: "icons/commodities/currency/coins-assorted-mix-copper.webp" })
]);

function clean(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

export function normalizeStoragePileCategory(value) {
  return clean(value).toLocaleLowerCase("ru-RU").replace(/ё/gu, "е");
}

const DEFINITIONS = [
  ["ammunition", "Боеприпас", "Куча боеприпасов", "ammunition.png"],
  ["explosives", "Взрывчатка", "Куча взрывчатки", "explosives.png"],
  ["armor", "Доспех", "Куча доспехов", "armor.png"],
  ["tools", "Инструменты", "Куча инструментов", "tools.png"],
  ["implants", "Имплант", "Куча имплантов", "implants.png"],
  ["upgrades", "Усовершенствование", "Куча усовершенствований", "upgrades.png"],
  ["potions", "Зелье", "Куча зелий", "potions.png"],
  ["attachments", "Обвес", "Куча обвеса", "attachments.png"],
  ["firearms", "Огнестрельное оружие", "Куча огнестрельного оружия", "firearms.png"],
  ["weapons", "Оружие", "Куча оружия", "weapons.png"],
  ["equipment", "Снаряжение", "Куча снаряжения", "equipment.png"],
  ["treasure", "Сокровища", "Куча сокровищ", "treasure.png"],
  ["materials", "Материал", "Куча материалов", "materials.png"],
  ["journal-note", "", "", "journal-note.png"],
  ["journal-notes", "", "Куча заметок", "journal-notes.png"],
  ["coins", "", "Куча монет", "coins.png"],
  ["mixed-items", "", "Куча предметов", "mixed-items.png"]
];

export const STORAGE_PILE_PRESENTATIONS = Object.freeze(DEFINITIONS.map(([
  key, typeLabel, name, file
]) => Object.freeze({
  key,
  typeLabel,
  normalizedTypeLabel: normalizeStoragePileCategory(typeLabel),
  name,
  img: `${ASSET_ROOT}/${file}`
})));

const GENERIC_PRESENTATION = STORAGE_PILE_PRESENTATIONS.at(-1);
const COIN_PRESENTATION = STORAGE_PILE_PRESENTATIONS.find((entry) => entry.key === "coins");
const JOURNAL_NOTE_PRESENTATION = STORAGE_PILE_PRESENTATIONS.find((entry) => entry.key === "journal-note");
const JOURNAL_NOTES_PRESENTATION = STORAGE_PILE_PRESENTATIONS.find((entry) => entry.key === "journal-notes");
const PRESENTATION_BY_TYPE = new Map(STORAGE_PILE_PRESENTATIONS
  .filter((entry) => entry.normalizedTypeLabel)
  .map((entry) => [entry.normalizedTypeLabel, entry]));

export function deriveGroundPilePresentation(rows = [], {
  coins = {},
  preserveEmptyCoinPile = false,
  readJournalRowIds = []
} = {}) {
  const availableRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object");
  const referenceRows = availableRows.filter((row) => isStorageJournalRow(row));
  const ordinaryRows = availableRows.filter((row) => !isStorageJournalRow(row));
  const journalRows = referenceRows.filter((row) => (
    row.rowKind === "journal"
    && clean(row.sourceType).toLowerCase() === "journal"
    && clean(row.sourceId)
    && clean(row.rowId)
    && Number(row.quantity) === 1
  ));
  const readIds = new Set((Array.isArray(readJournalRowIds) ? readJournalRowIds : [])
    .map(clean)
    .filter(Boolean));
  const positiveDenominations = COIN_PRESENTATIONS.filter(({ denomination }) => {
    const amount = Number(coins?.[denomination] ?? 0);
    return Number.isFinite(amount) && Math.trunc(amount) > 0;
  });

  if (ordinaryRows.length === 1) {
    const row = ordinaryRows[0];
    const topDownPresentation = resolveTopDownItemPresentation(row);
    const quantity = Math.max(1, Math.trunc(Number(
      row.quantity ?? row.itemData?.system?.quantity ?? 1
    )) || 1);
    const name = formatDurabilityItemName(
      clean(row.name ?? row.itemData?.name) || "Предмет",
      row.itemData?.flags?.[MODULE_ID]?.durability
    );
    const presentation = {
      name: quantity > 1 ? `${name} (${quantity})` : name,
      img: topDownPresentation?.img
        ?? (clean(row.img ?? row.itemData?.img) || GENERIC_PRESENTATION.img),
      categoryKey: "single"
    };
    if (!topDownPresentation) return presentation;
    return {
      ...presentation,
      topDownItem: true,
      tokenSize: normalizeStoragePileCategory(topDownPresentation.visualType) === "доспех" ? 1 : 0.5,
      textureScale: topDownPresentation.textureScale,
      rotationSeed: clean(row.rowId) || `${clean(row.sourceType)}:${clean(row.sourceId)}`,
      ...(topDownPresentation.rotationMode === "cardinal" ? {
        tokenWidth: topDownPresentation.tokenWidth,
        tokenHeight: topDownPresentation.tokenHeight,
        rotationMode: "cardinal"
      } : {})
    };
  }

  if (ordinaryRows.length > 1) {
    const labels = new Set(ordinaryRows.map((row) => normalizeStoragePileCategory(
      row.typeLabel ?? row.itemData?.type
    )).filter(Boolean));
    if (labels.size === 1) {
      const presentation = PRESENTATION_BY_TYPE.get(labels.values().next().value);
      if (presentation) {
        return { name: presentation.name, img: presentation.img, categoryKey: presentation.key };
      }
    }
    return {
      name: GENERIC_PRESENTATION.name,
      img: GENERIC_PRESENTATION.img,
      categoryKey: GENERIC_PRESENTATION.key
    };
  }

  if (positiveDenominations.length === 1) {
    const [{ name, img }] = positiveDenominations;
    return { name, img, categoryKey: COIN_PRESENTATION.key };
  }
  if (positiveDenominations.length > 1) {
    return {
      name: COIN_PRESENTATION.name,
      img: COIN_PRESENTATION.img,
      categoryKey: COIN_PRESENTATION.key
    };
  }
  if (preserveEmptyCoinPile === true) {
    return {
      name: `${COIN_PRESENTATION.name} (пусто)`,
      img: COIN_PRESENTATION.img,
      categoryKey: COIN_PRESENTATION.key
    };
  }

  if (journalRows.length === 1) {
    const [row] = journalRows;
    const name = clean(row.name) || "Запись";
    return {
      name: readIds.has(clean(row.rowId)) ? `${name} (прочитано)` : name,
      img: JOURNAL_NOTE_PRESENTATION.img,
      categoryKey: JOURNAL_NOTE_PRESENTATION.key
    };
  }
  if (journalRows.length > 1) {
    return {
      name: JOURNAL_NOTES_PRESENTATION.name,
      img: JOURNAL_NOTES_PRESENTATION.img,
      categoryKey: JOURNAL_NOTES_PRESENTATION.key
    };
  }

  return {
    name: GENERIC_PRESENTATION.name,
    img: GENERIC_PRESENTATION.img,
    categoryKey: GENERIC_PRESENTATION.key
  };
}

export function deriveGroundPilePlacement(row) {
  const presentation = deriveGroundPilePresentation(row ? [row] : []);
  const width = Number(presentation?.tokenWidth);
  const height = Number(presentation?.tokenHeight);
  if (presentation?.topDownItem !== true
    || presentation.rotationMode !== "cardinal"
    || !Number.isFinite(width)
    || width <= 0
    || !Number.isFinite(height)
    || height <= 0) return null;
  return { width, height, rotationMode: "cardinal" };
}

export function isGroundPileToken(token) {
  const document = token?.document ?? token;
  const flag = typeof document?.getFlag === "function"
    ? document.getFlag(MODULE_ID, "groundPile")
    : document?.flags?.[MODULE_ID]?.groundPile;
  return flag?.enabled === true;
}
