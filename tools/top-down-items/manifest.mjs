import { createHash } from "node:crypto";

export const TOP_DOWN_MANIFEST_SCHEMA_VERSION = 1;
export const TOP_DOWN_ATLAS_CAPACITY = 25;

const VALID_SOURCE_TYPES = new Set(["gear", "material"]);
const VALID_STATUSES = new Set(["planned", "processing", "rejected", "accepted"]);
const VALID_QA_STATUSES = new Set(["pending", "failed", "passed"]);

function clean(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

function sourceReference(sourceType, source) {
  if (sourceType === "gear") return clean(source?.sourceRef);
  const sheetName = clean(source?.source?.sheetName);
  const row = Number(source?.source?.row);
  return sheetName && Number.isInteger(row) && row > 0 ? `${sheetName}!A${row}` : "";
}

function scaleClass(sourceType, source) {
  if (sourceType === "material") return "standard";
  const type = clean(source?.equipmentType).toLocaleLowerCase("ru-RU");
  if (["оружие", "огнестрельное оружие", "инструменты"].includes(type)) return "long";
  if (["доспех", "снаряжение"].includes(type) && /доспех|брон/iu.test(clean(source?.name))) {
    return "bulky";
  }
  return "standard";
}

function promptInput(sourceType, source) {
  const type = sourceType === "gear"
    ? clean(source?.equipmentType)
    : [clean(source?.type), clean(source?.subtype)].filter(Boolean).join(" / ");
  return [clean(source?.name), type, clean(source?.description)].filter(Boolean).join(" | ");
}

function promptHash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function baseEntry(sourceType, source) {
  const sourceId = clean(source?.id);
  const input = promptInput(sourceType, source);
  return {
    sourceType,
    sourceId,
    name: clean(source?.name),
    sourceRef: sourceReference(sourceType, source),
    visualType: sourceType === "gear"
      ? clean(source?.equipmentType)
      : [clean(source?.type), clean(source?.subtype)].filter(Boolean).join(" / "),
    promptInput: input,
    promptHash: promptHash(input),
    scaleClass: scaleClass(sourceType, source),
    atlasId: "",
    cellIndex: -1,
    assetPath: `assets/top-down/items/${sourceType}/${sourceId}.webp`,
    status: "planned",
    technicalQa: "pending",
    visualQa: "pending",
    generationHash: "",
    assetHash: "",
    matteMethod: ""
  };
}

function compareEntries(left, right) {
  return topDownEntryKey(left).localeCompare(topDownEntryKey(right), "en");
}

function placementAt(index) {
  return {
    atlasId: `primary-${String(Math.floor(index / TOP_DOWN_ATLAS_CAPACITY) + 1).padStart(3, "0")}`,
    cellIndex: index % TOP_DOWN_ATLAS_CAPACITY
  };
}

function placementOrdinal(entry) {
  const match = clean(entry?.atlasId).match(/^primary-(\d+)$/u);
  if (!match || !Number.isInteger(entry?.cellIndex)) return -1;
  return (Number(match[1]) - 1) * TOP_DOWN_ATLAS_CAPACITY + entry.cellIndex;
}

export function topDownEntryKey(entry) {
  return `${clean(entry?.sourceType)}:${clean(entry?.sourceId)}`;
}

export function buildCanonicalTopDownEntries({ gear = [], materials = [] } = {}) {
  const entries = [
    ...(Array.isArray(gear) ? gear : []).map((source) => baseEntry("gear", source)),
    ...(Array.isArray(materials) ? materials : []).map((source) => baseEntry("material", source))
  ].sort(compareEntries);
  return entries.map((entry, index) => ({ ...entry, ...placementAt(index) }));
}

export function synchronizeTopDownManifest({ manifest, gear = [], materials = [] } = {}) {
  const canonical = buildCanonicalTopDownEntries({ gear, materials });
  const previousEntries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  const previousByKey = new Map(previousEntries.map((entry) => [topDownEntryKey(entry), entry]));
  let nextOrdinal = previousEntries.reduce(
    (highest, entry) => Math.max(highest, placementOrdinal(entry)),
    -1
  ) + 1;
  const entries = canonical.map((current) => {
    const previous = previousByKey.get(topDownEntryKey(current));
    if (!previous) return { ...current, ...placementAt(nextOrdinal++) };
    const promptChanged = clean(previous.promptHash) !== current.promptHash;
    return {
      ...current,
      atlasId: clean(previous.atlasId) || current.atlasId,
      cellIndex: Number.isInteger(previous.cellIndex) ? previous.cellIndex : current.cellIndex,
      status: promptChanged ? "planned" : clean(previous.status) || current.status,
      technicalQa: promptChanged ? "pending" : clean(previous.technicalQa) || current.technicalQa,
      visualQa: promptChanged ? "pending" : clean(previous.visualQa) || current.visualQa,
      generationHash: promptChanged ? "" : clean(previous.generationHash),
      assetHash: promptChanged ? "" : clean(previous.assetHash),
      matteMethod: promptChanged ? "" : clean(previous.matteMethod)
    };
  });
  return {
    schemaVersion: TOP_DOWN_MANIFEST_SCHEMA_VERSION,
    atlas: { columns: 5, rows: 5, capacity: TOP_DOWN_ATLAS_CAPACITY },
    entries
  };
}

export function validateTopDownManifest({ manifest, gear = [], materials = [] } = {}) {
  const diagnostics = [];
  if (manifest?.schemaVersion !== TOP_DOWN_MANIFEST_SCHEMA_VERSION) {
    diagnostics.push(`invalid schemaVersion: ${manifest?.schemaVersion}`);
  }
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  if (!Array.isArray(manifest?.entries)) diagnostics.push("manifest entries must be an array");

  const canonicalEntries = buildCanonicalTopDownEntries({ gear, materials });
  const canonicalKeys = new Set(canonicalEntries.map(topDownEntryKey));
  const seenKeys = new Set();
  const seenPaths = new Set();
  const seenPlacements = new Set();
  for (const entry of entries) {
    const key = topDownEntryKey(entry);
    const path = clean(entry?.assetPath);
    const placement = `${clean(entry?.atlasId)}:${entry?.cellIndex}`;
    if (seenKeys.has(key)) diagnostics.push(`duplicate manifest key: ${key}`);
    if (seenPaths.has(path)) diagnostics.push(`duplicate asset path: ${path}`);
    if (seenPlacements.has(placement)) diagnostics.push(`duplicate atlas placement: ${placement}`);
    seenKeys.add(key);
    seenPaths.add(path);
    seenPlacements.add(placement);
    if (!canonicalKeys.has(key)) diagnostics.push(`unknown manifest key: ${key}`);
    if (!VALID_SOURCE_TYPES.has(clean(entry?.sourceType))) diagnostics.push(`invalid sourceType: ${key}`);
    if (path !== `assets/top-down/items/${entry?.sourceType}/${clean(entry?.sourceId)}.webp`) {
      diagnostics.push(`invalid asset path: ${key}`);
    }
    if (!/^primary-\d{3}$/u.test(clean(entry?.atlasId))) diagnostics.push(`invalid atlasId: ${key}`);
    if (!Number.isInteger(entry?.cellIndex) || entry.cellIndex < 0 || entry.cellIndex >= 25) {
      diagnostics.push(`invalid cellIndex: ${key}`);
    }
    if (!VALID_STATUSES.has(clean(entry?.status))) diagnostics.push(`invalid status: ${key}`);
    if (!VALID_QA_STATUSES.has(clean(entry?.technicalQa))) diagnostics.push(`invalid technicalQa: ${key}`);
    if (!VALID_QA_STATUSES.has(clean(entry?.visualQa))) diagnostics.push(`invalid visualQa: ${key}`);
  }
  for (const key of canonicalKeys) {
    if (!seenKeys.has(key)) diagnostics.push(`missing manifest key: ${key}`);
  }
  if (diagnostics.length) throw new Error(diagnostics.join("\n"));
  return true;
}
