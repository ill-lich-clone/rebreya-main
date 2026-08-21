import { MODULE_ID } from "../constants.js";
import {
  buildInitialDurability,
  isDurabilityEligible,
  resolveDurabilityProfile
} from "./durability-rules.js";
import { formatDurabilityItemName } from "./durability-item-presentation.js?v=1.4.154-broken-item-name";

function clone(value) {
  if (value == null) {
    return value;
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function cleanSourceType(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeBrokenEquipmentChance(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.trunc(numeric)));
}

export function rollLootgenBrokenState({ sourceType, chance, isEligible = true, random = Math.random } = {}) {
  if (cleanSourceType(sourceType) !== "gear" || isEligible !== true) {
    return false;
  }

  const normalizedChance = normalizeBrokenEquipmentChance(chance);
  if (normalizedChance <= 0) {
    return false;
  }
  if (normalizedChance >= 100) {
    return true;
  }
  if (typeof random !== "function") {
    throw new TypeError("random must be a function");
  }
  return Number(random()) < normalizedChance / 100;
}

export function collectBreakableManagedGearIds(entries = []) {
  const rows = Array.isArray(entries)
    ? entries
    : Array.from(entries?.values?.() ?? entries ?? []);
  const result = new Set();
  for (const entry of rows) {
    const flags = entry?.flags?.[MODULE_ID] ?? {};
    const sourceType = cleanSourceType(flags.sourceType);
    const sourceId = String(flags.gearId ?? flags.sourceId ?? "").trim();
    if (
      flags.managed === true
      && sourceType === "gear"
      && sourceId
      && isDurabilityEligible(entry)
    ) {
      result.add(sourceId);
    }
  }
  return result;
}

export function normalizeLootgenBrokenMarker(row = {}) {
  return cleanSourceType(row.sourceType) === "gear" && Boolean(row.isBroken);
}

export function buildLootgenRowIdentity(row = {}) {
  const sourceType = String(row.sourceType ?? "").trim();
  const sourceId = String(row.sourceId ?? "").trim();
  const condition = normalizeLootgenBrokenMarker(row) ? "broken" : "intact";
  return `${sourceType}:${sourceId}:${condition}`;
}

function lookupById(index, rows, id) {
  const cleanId = String(id ?? "").trim();
  if (!cleanId) {
    return null;
  }
  return index?.get?.(cleanId)
    ?? (Array.isArray(rows) ? rows.find((row) => String(row?.id ?? "").trim() === cleanId) : null)
    ?? null;
}

export function applyLootgenRowDurability(itemData, row = {}, {
  model = {},
  updatedAt
} = {}) {
  const gear = lookupById(model?.gearById, model?.gear, row.sourceId);
  const materialId = gear?.predominantMaterialId;
  const material = lookupById(model?.materialById, model?.materials, materialId)
    ?? lookupById(model?.materialByGoodId, [], gear?.linkedGoodId);

  return applyLootgenBrokenDurability(itemData, {
    isBroken: normalizeLootgenBrokenMarker(row),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    gear: gear ?? {},
    material: material ?? {},
    updatedAt
  });
}

export function applyLootgenBrokenDurability(itemData, {
  isBroken = false,
  sourceType = "",
  sourceId = "",
  gear = {},
  material = {},
  updatedAt = new Date().toISOString()
} = {}) {
  const result = clone(itemData);
  if (
    !result
    || isBroken !== true
    || cleanSourceType(sourceType) !== "gear"
    || !isDurabilityEligible(result)
  ) {
    return result;
  }

  result.flags = result.flags && typeof result.flags === "object" ? result.flags : {};
  result.flags[MODULE_ID] = result.flags[MODULE_ID] && typeof result.flags[MODULE_ID] === "object"
    ? result.flags[MODULE_ID]
    : {};

  const profile = resolveDurabilityProfile({ itemData: result, gear, material });
  const durability = buildInitialDurability({
    ...profile,
    initializedFrom: {
      sourceType: "gear",
      sourceId: String(sourceId ?? "").trim()
    }
  });
  durability.state = "broken";
  durability.breakStage = 1;
  durability.updatedAt = String(updatedAt ?? "").trim() || new Date().toISOString();
  result.flags[MODULE_ID].durability = durability;
  result.name = formatDurabilityItemName(result.name, durability);
  return result;
}
