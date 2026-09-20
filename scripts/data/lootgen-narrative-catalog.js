import { MODULE_ID } from "../constants.js";
import { cloneFoundryValue, escapeFoundryHtml } from "../shared/foundry-values.js";

const CATALOG_PATH = `modules/${MODULE_ID}/data/lootgen-narrative-variants.json`;
const NARRATIVE_FIELD_NAMES = Object.freeze([
  "narrativeVariantId",
  "narrativeGearId",
  "narrativeTitle",
  "narrativeDescription"
]);

let catalogPromise = null;

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeVariant(raw, index) {
  const variantId = clean(raw?.variantId);
  const gearId = clean(raw?.gearId);
  const sourceName = clean(raw?.sourceName);
  const title = clean(raw?.title);
  const description = clean(raw?.description);
  const rank = Number(raw?.rank);
  if (!variantId) throw new Error(`narrative variant ${index} is missing variantId`);
  if (!gearId) throw new Error(`narrative variant ${variantId} is missing gearId`);
  if (!sourceName) throw new Error(`narrative variant ${variantId} is missing sourceName`);
  if (!description) throw new Error(`narrative variant ${variantId} is missing description`);
  if (!Number.isSafeInteger(rank) || rank < 0) {
    throw new Error(`narrative variant ${variantId} has invalid rank`);
  }
  return Object.freeze({ variantId, gearId, sourceName, title, description, rank });
}

export function normalizeLootgenNarrativeCatalog(raw) {
  if (raw?.schemaVersion !== 1) throw new Error("Unsupported narrative catalog schemaVersion");
  if (!Array.isArray(raw?.variants)) throw new Error("Narrative catalog variants must be an array");

  const byVariantId = new Map();
  const byGearId = new Map();
  const semanticRows = new Set();
  const variants = raw.variants.map((entry, index) => {
    const variant = normalizeVariant(entry, index);
    if (byVariantId.has(variant.variantId)) {
      throw new Error(`duplicate narrative variantId: ${variant.variantId}`);
    }
    const semanticKey = JSON.stringify([
      variant.gearId,
      variant.title,
      variant.description,
      variant.rank
    ]);
    if (semanticRows.has(semanticKey)) {
      throw new Error(`duplicate narrative semantic row: ${variant.variantId}`);
    }
    semanticRows.add(semanticKey);
    byVariantId.set(variant.variantId, variant);
    const bucket = byGearId.get(variant.gearId) ?? [];
    bucket.push(variant);
    byGearId.set(variant.gearId, bucket);
    return variant;
  });

  for (const [gearId, entries] of byGearId) byGearId.set(gearId, Object.freeze([...entries]));
  return Object.freeze({
    schemaVersion: 1,
    variants: Object.freeze(variants),
    byGearId,
    byVariantId
  });
}

export function selectLootgenNarrativeVariant(candidate, random) {
  const variants = Array.isArray(candidate?.narrativeVariants) ? candidate.narrativeVariants : [];
  if (!variants.length) return null;
  if (typeof random !== "function") throw new TypeError("random must be a function");
  const draw = Number(random());
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new RangeError("random must return a number in [0,1)");
  }
  return cloneFoundryValue(variants[Math.min(variants.length - 1, Math.floor(draw * variants.length))]);
}

export function pickLootgenNarrativeFields(value = {}) {
  return Object.fromEntries(NARRATIVE_FIELD_NAMES
    .filter((key) => value?.[key] !== undefined)
    .map((key) => [key, cloneFoundryValue(value[key])]));
}

export function applyLootgenNarrativeVariant(itemData, variant) {
  const result = cloneFoundryValue(itemData ?? {});
  if (!variant) return result;
  const variantId = clean(variant.variantId);
  const gearId = clean(variant.gearId);
  const title = clean(variant.title);
  const description = clean(variant.description);
  if (!variantId || !gearId || !description) throw new Error("Invalid lootgen narrative variant");

  const heading = title ? `<h3>${escapeFoundryHtml(title)}</h3>` : "";
  const body = escapeFoundryHtml(description.replace(/\r\n?/gu, "\n")).replace(/\n/gu, "<br>");
  result.system ??= {};
  result.system.description ??= {};
  result.system.description.value = `${heading}<p>${body}</p>`;
  result.system.quantity = 1;
  result.flags ??= {};
  result.flags[MODULE_ID] = {
    ...(result.flags[MODULE_ID] ?? {}),
    narrativeVariantId: variantId,
    narrativeGearId: gearId,
    narrativeTitle: title,
    narrativeDescription: description,
    nonStackable: true
  };
  return result;
}

export function hasLootgenNarrative(itemOrData) {
  const fromDocument = typeof itemOrData?.getFlag === "function"
    ? itemOrData.getFlag(MODULE_ID, "narrativeVariantId")
    : undefined;
  const fromData = itemOrData?.flags?.[MODULE_ID]?.narrativeVariantId;
  return Boolean(clean(fromDocument ?? fromData));
}

export async function loadLootgenNarrativeCatalog() {
  catalogPromise ??= (async () => {
    const response = await fetch(CATALOG_PATH);
    if (!response?.ok) throw new Error(`Failed to load narrative catalog: HTTP ${response?.status ?? 0}`);
    return normalizeLootgenNarrativeCatalog(await response.json());
  })();
  try {
    return await catalogPromise;
  } catch (error) {
    catalogPromise = null;
    throw error;
  }
}
