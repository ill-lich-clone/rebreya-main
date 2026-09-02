import { MODULE_ID } from "../constants.js";
import { TOP_DOWN_ITEM_TEXTURES } from "./top-down-item-texture-catalog.js";

function clean(value) {
  return String(value ?? "").trim();
}

export function resolveTopDownItemTexture(row, {
  textures = TOP_DOWN_ITEM_TEXTURES
} = {}) {
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

  return textures.get(`${sourceType}:${sourceId}`) ?? null;
}
