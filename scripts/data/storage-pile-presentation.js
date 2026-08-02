import { MODULE_ID } from "../constants.js";

const ASSET_ROOT = `modules/${MODULE_ID}/assets/storage/piles`;

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
const PRESENTATION_BY_TYPE = new Map(STORAGE_PILE_PRESENTATIONS
  .filter((entry) => entry.normalizedTypeLabel)
  .map((entry) => [entry.normalizedTypeLabel, entry]));

export function deriveGroundPilePresentation(rows = []) {
  const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === "object");
  if (visibleRows.length === 1) {
    const row = visibleRows[0];
    const quantity = Math.max(1, Math.trunc(Number(
      row.quantity ?? row.itemData?.system?.quantity ?? 1
    )) || 1);
    const name = clean(row.name ?? row.itemData?.name) || "Предмет";
    return {
      name: quantity > 1 ? `${name} (${quantity})` : name,
      img: clean(row.img ?? row.itemData?.img) || GENERIC_PRESENTATION.img,
      categoryKey: "single"
    };
  }

  if (visibleRows.length > 1) {
    const labels = new Set(visibleRows.map((row) => normalizeStoragePileCategory(
      row.typeLabel ?? row.itemData?.type
    )).filter(Boolean));
    if (labels.size === 1) {
      const presentation = PRESENTATION_BY_TYPE.get(labels.values().next().value);
      if (presentation) {
        return { name: presentation.name, img: presentation.img, categoryKey: presentation.key };
      }
    }
  }

  return {
    name: GENERIC_PRESENTATION.name,
    img: GENERIC_PRESENTATION.img,
    categoryKey: GENERIC_PRESENTATION.key
  };
}

export function isGroundPileToken(token) {
  const document = token?.document ?? token;
  const flag = typeof document?.getFlag === "function"
    ? document.getFlag(MODULE_ID, "groundPile")
    : document?.flags?.[MODULE_ID]?.groundPile;
  return flag?.enabled === true;
}
