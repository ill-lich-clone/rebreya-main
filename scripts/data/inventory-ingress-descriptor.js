import { MODULE_ID } from "../constants.js";
import { isDurabilityEligible } from "./durability-rules.js";

const COPPER_MULTIPLIERS = Object.freeze({ pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 });
const DURABILITY_STATES = new Set(["intact", "damaged", "broken", "destroyed"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value, digits = 5) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeSourceType(value) {
  const compact = cleanString(value).toLocaleLowerCase().replace(/[_\-\s]+/gu, "");
  if (["gear", "equipment", "loot", "снаряжение"].includes(compact)) return "gear";
  if (["material", "materials", "материал", "материалы"].includes(compact)) return "material";
  if (["magicitem", "magicitems", "magic", "magical", "магическийпредмет", "магия"].includes(compact)) {
    return "magicItem";
  }
  return cleanString(value);
}

function readRarity(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return cleanString(value.value ?? value.id ?? value.key ?? value.slug);
  }
  return cleanString(value);
}

function moduleFlags(itemData) {
  const flags = itemData?.flags?.[MODULE_ID];
  return flags && typeof flags === "object" && !Array.isArray(flags) ? flags : {};
}

function resolveManagedIdentity(itemData) {
  const flags = moduleFlags(itemData);
  let sourceType = normalizeSourceType(flags.sourceType);
  if (!sourceType) {
    if (cleanString(flags.materialId)) sourceType = "material";
    else if (cleanString(flags.magicItemId ?? flags.magicId)) sourceType = "magicItem";
    else if (cleanString(flags.gearId)) sourceType = "gear";
  }
  const markerId = sourceType === "material"
    ? flags.materialId
    : sourceType === "magicItem"
      ? flags.magicItemId ?? flags.magicId
      : sourceType === "gear"
        ? flags.gearId
        : "";
  const sourceId = cleanString(flags.sourceId ?? markerId);
  return {
    sourceType: sourceType && sourceId ? sourceType : "",
    sourceId: sourceType && sourceId ? sourceId : ""
  };
}

function resolveModelSource(identity, model) {
  if (!identity.sourceId) return null;
  if (identity.sourceType === "gear") return model?.gearById?.get?.(identity.sourceId) ?? null;
  if (identity.sourceType === "material") return model?.materialById?.get?.(identity.sourceId) ?? null;
  if (identity.sourceType === "magicItem") {
    return model?.magicItemById?.get?.(identity.sourceId)
      ?? model?.magicItemsById?.get?.(identity.sourceId)
      ?? null;
  }
  return null;
}

function sourceKindOf(identity) {
  if (identity.sourceType === "material") return "material";
  if (identity.sourceType === "magicItem") return "magic";
  return "ordinary";
}

function unitValueCopper(itemData) {
  const price = itemData?.system?.price;
  const value = Math.max(0, finiteNumber(price?.value) ?? 0);
  const denomination = cleanString(price?.denomination).toLocaleLowerCase() || "gp";
  const multiplier = COPPER_MULTIPLIERS[denomination] ?? COPPER_MULTIPLIERS.gp;
  return Math.max(0, Math.floor(value * multiplier));
}

function unitWeightPounds(itemData) {
  const weight = itemData?.system?.weight;
  const value = Math.max(0, finiteNumber(weight?.value ?? weight) ?? 0);
  const units = cleanString(weight?.units).toLocaleLowerCase() || "lb";
  const multiplier = units === "kg"
    ? 2.20462
    : units === "oz"
      ? 1 / 16
      : units === "ton"
        ? 2000
        : 1;
  return rounded(value * multiplier);
}

function durabilityStateOf(itemData) {
  const durability = moduleFlags(itemData).durability;
  if (durability?.eligible === false) return "ineligible";
  const explicit = cleanString(durability?.state).toLocaleLowerCase();
  if (DURABILITY_STATES.has(explicit)) return explicit;
  return isDurabilityEligible(itemData) ? "intact" : "ineligible";
}

function findMaterialById(model, sourceId) {
  const id = cleanString(sourceId);
  return id ? model?.materialById?.get?.(id) ?? null : null;
}

function resolveMaterialProfile(itemData, model) {
  const identity = resolveManagedIdentity(itemData);
  if (identity.sourceType === "material" || cleanString(itemData?.type).toLocaleLowerCase() === "container") {
    return null;
  }
  const flags = moduleFlags(itemData);
  const explicitMaterialId = cleanString(flags.materialId ?? flags.predominantMaterialId);
  if (explicitMaterialId) {
    const material = findMaterialById(model, explicitMaterialId);
    return material ? { material, materialId: explicitMaterialId } : null;
  }
  const linkedGoodId = cleanString(flags.linkedGoodId);
  if (linkedGoodId) {
    const material = model?.materialByGoodId?.get?.(linkedGoodId) ?? null;
    return material ? { material, materialId: cleanString(material.id) } : null;
  }
  const source = resolveModelSource(identity, model);
  const sourceMaterialId = cleanString(source?.predominantMaterialId ?? source?.materialId);
  const material = findMaterialById(model, sourceMaterialId);
  return material ? { material, materialId: sourceMaterialId } : null;
}

export function canResolveInventoryDismantle(itemData, { model } = {}) {
  return unitWeightPounds(itemData) > 0 && Boolean(resolveMaterialProfile(itemData, model));
}

export function resolveInventoryDismantleOutputs(itemData, quantity, { model } = {}) {
  const safeQuantity = finiteNumber(quantity);
  const unitWeight = unitWeightPounds(itemData);
  const profile = resolveMaterialProfile(itemData, model);
  if (!(safeQuantity > 0) || unitWeight <= 0 || !profile) return deepFreeze([]);
  const outputQuantity = Math.floor(unitWeight * safeQuantity * 0.5 * 100) / 100;
  if (outputQuantity <= 0) return deepFreeze([]);
  const sourceId = cleanString(profile.material.id ?? profile.materialId);
  if (!sourceId) return deepFreeze([]);
  return deepFreeze([{
    sourceType: "material",
    sourceId,
    name: cleanString(profile.material.name) || sourceId,
    quantity: outputQuantity
  }]);
}

export function buildInventoryIngressDescriptor(itemData, {
  model,
  dismantlable = canResolveInventoryDismantle(itemData, { model })
} = {}) {
  const identity = resolveManagedIdentity(itemData);
  const flags = moduleFlags(itemData);
  const source = resolveModelSource(identity, model);
  const rarity = readRarity(itemData?.system?.rarity ?? flags.rarity ?? source?.rarity);
  const rank = finiteNumber(flags.rank ?? source?.rank);
  const materialProfile = resolveMaterialProfile(itemData, model);
  const sourceCategory = cleanString(
    flags.sourceCategory
      ?? flags.equipmentType
      ?? source?.sourceCategory
      ?? source?.equipmentType
      ?? flags.magicItemType
      ?? ""
  );
  return deepFreeze({
    sourceKind: sourceKindOf(identity),
    sourceType: identity.sourceType,
    sourceId: identity.sourceId,
    documentType: cleanString(itemData?.type),
    systemTypeValue: cleanString(itemData?.system?.type?.value),
    systemTypeSubtype: cleanString(itemData?.system?.type?.subtype),
    sourceCategory,
    rarity,
    rank,
    durabilityState: durabilityStateOf(itemData),
    unitValue: unitValueCopper(itemData),
    unitWeight: unitWeightPounds(itemData),
    predominantMaterialId: cleanString(materialProfile?.materialId),
    dismantlable: dismantlable === true
  });
}

export function captureInventoryIngressIdentity(descriptor, quantity) {
  const safeQuantity = finiteNumber(quantity);
  if (!(safeQuantity > 0)) throw new TypeError("Inventory ingress quantity must be a positive finite number.");
  return deepFreeze({
    sourceType: cleanString(descriptor?.sourceType),
    sourceId: cleanString(descriptor?.sourceId),
    documentType: cleanString(descriptor?.documentType),
    durabilityState: cleanString(descriptor?.durabilityState),
    quantity: safeQuantity
  });
}
