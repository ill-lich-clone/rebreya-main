import { MODULE_ID } from "../constants.js";
import {
  TOP_DOWN_ITEM_ARMOR_KEYS,
  TOP_DOWN_ITEM_LONG_KEYS,
  TOP_DOWN_ITEM_TEXTURES
} from "./top-down-item-texture-catalog.js";

function clean(value) {
  return String(value ?? "").trim();
}

function resolveTopDownItemKey(row) {
  if (!row || typeof row !== "object") return null;

  const flags = row.itemData?.flags?.[MODULE_ID];
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return null;

  const gearId = clean(flags.gearId);
  const materialId = clean(flags.materialId);
  if (gearId && materialId) return null;

  const flagSourceType = clean(flags.sourceType).toLowerCase();
  const sourceType = gearId ? "gear" : materialId ? "material" : flagSourceType;
  if (sourceType !== "gear" && sourceType !== "material") return null;
  if (flagSourceType && flagSourceType !== sourceType) return null;

  const rowSourceType = clean(row.sourceType).toLowerCase();
  if (["gear", "material"].includes(rowSourceType) && rowSourceType !== sourceType) return null;

  const identities = [
    sourceType === "gear" ? gearId : materialId,
    flags.sourceId,
    rowSourceType === sourceType ? row.sourceId : ""
  ]
    .map(clean)
    .filter(Boolean);
  const sourceId = identities[0] ?? "";
  if (!sourceId || identities.some((identity) => identity !== sourceId)) return null;

  return `${sourceType}:${sourceId}`;
}

export function resolveTopDownItemPresentation(row, {
  textures = TOP_DOWN_ITEM_TEXTURES,
  longKeys = TOP_DOWN_ITEM_LONG_KEYS,
  armorKeys = TOP_DOWN_ITEM_ARMOR_KEYS
} = {}) {
  const key = resolveTopDownItemKey(row);
  const img = key ? textures.get(key) : null;
  if (!img) return null;
  return {
    img,
    visualType: armorKeys.has(key) ? "Доспех" : "",
    scaleClass: longKeys.has(key) ? "long" : "standard"
  };
}

export function resolveTopDownItemTexture(row, {
  textures = TOP_DOWN_ITEM_TEXTURES
} = {}) {
  const key = resolveTopDownItemKey(row);
  return key ? textures.get(key) ?? null : null;
}
