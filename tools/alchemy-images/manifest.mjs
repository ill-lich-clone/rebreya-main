import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { inspectProcessedAlchemyImage } from "./processing.mjs";

export const ALCHEMY_IMAGE_MANIFEST_SCHEMA_VERSION = 1;
export const ALCHEMY_GRID_SIZE = 1254;
export const ALCHEMY_GRID_CAPACITY = 25;
export const ALCHEMY_NOMINAL_BOUNDARIES = Object.freeze([0, 251, 502, 752, 1003, 1254]);

const KINDS = Object.freeze(["icon", "topDown"]);
const STATUSES = new Set(["planned", "processing", "rejected", "accepted"]);
const QA_STATUSES = new Set(["pending", "failed", "passed"]);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function clean(value) {
  return String(value ?? "").trim();
}

function kindPrefix(kind) {
  return kind === "topDown" ? "topdown" : "icon";
}

function entryKey(entry) {
  return `${clean(entry?.kind)}:${clean(entry?.productId)}`;
}

function productPrompt(product, kind) {
  return [
    clean(product?.name),
    clean(product?.productType),
    `ранг ${product?.rank}`,
    clean(product?.effect),
    clean(product?.catalystEffect)
  ].filter(Boolean).join(" | ");
}

function hashText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function baseEntry(product, kind, index) {
  const prefix = kindPrefix(kind);
  const promptInput = productPrompt(product, kind);
  return {
    kind,
    productId: clean(product?.id),
    sourceNumber: Number(product?.sourceNumber),
    name: clean(product?.name),
    productType: clean(product?.productType),
    sourceRef: clean(product?.sourceRef),
    promptInput,
    promptHash: hashText(`${kind}\n${promptInput}`),
    gridId: `${prefix}-primary-${String(Math.floor(index / ALCHEMY_GRID_CAPACITY) + 1).padStart(3, "0")}`,
    cellIndex: index % ALCHEMY_GRID_CAPACITY,
    outputPath: clean(kind === "icon" ? product?.icon : product?.topDownImage),
    padding: kind === "topDown"
      ? { mode: "transparent", color: "0x00000000" }
      : { mode: "color", color: "#1f1712" },
    crop: null,
    cropReviewed: false,
    status: "planned",
    technicalQa: "pending",
    visualQa: "pending",
    visualIssue: "",
    generationHash: "",
    assetHash: ""
  };
}

function compareEntries(left, right) {
  const kindDifference = KINDS.indexOf(left.kind) - KINDS.indexOf(right.kind);
  return kindDifference || left.sourceNumber - right.sourceNumber;
}

function requiredPrimaryGridIds(products) {
  const count = Math.ceil(products.length / ALCHEMY_GRID_CAPACITY);
  return KINDS.flatMap((kind) => Array.from({ length: count }, (_, index) => (
    `${kindPrefix(kind)}-primary-${String(index + 1).padStart(3, "0")}`
  )));
}

function gridKind(gridId) {
  return clean(gridId).startsWith("topdown-") ? "topDown" : "icon";
}

function buildGrids(entries, products) {
  const ids = new Set(requiredPrimaryGridIds(products));
  for (const entry of entries) ids.add(entry.gridId);
  return [...ids].sort((left, right) => {
    const kindDifference = KINDS.indexOf(gridKind(left)) - KINDS.indexOf(gridKind(right));
    return kindDifference || left.localeCompare(right, "en");
  }).map((gridId) => {
    const placements = new Map(entries
      .filter((entry) => entry.gridId === gridId)
      .map((entry) => [entry.cellIndex, entryKey(entry)]));
    return {
      gridId,
      kind: gridKind(gridId),
      cells: Array.from({ length: ALCHEMY_GRID_CAPACITY }, (_, cellIndex) => (
        placements.has(cellIndex)
          ? { cellIndex, entryKey: placements.get(cellIndex) }
          : { cellIndex, empty: true }
      ))
    };
  });
}

export function buildAlchemyImageManifest(products) {
  const ordered = [...(Array.isArray(products) ? products : [])]
    .sort((left, right) => Number(left?.sourceNumber) - Number(right?.sourceNumber));
  const entries = KINDS.flatMap((kind) => ordered.map((product, index) => baseEntry(product, kind, index)))
    .sort(compareEntries);
  return {
    schemaVersion: ALCHEMY_IMAGE_MANIFEST_SCHEMA_VERSION,
    grid: {
      size: ALCHEMY_GRID_SIZE,
      columns: 5,
      rows: 5,
      capacity: ALCHEMY_GRID_CAPACITY,
      nominalBoundaries: [...ALCHEMY_NOMINAL_BOUNDARIES]
    },
    grids: buildGrids(entries, ordered),
    entries
  };
}

function preserveReview(current, previous) {
  if (!previous || clean(previous.promptHash) !== current.promptHash) return current;
  return {
    ...current,
    gridId: clean(previous.gridId) || current.gridId,
    cellIndex: Number.isInteger(previous.cellIndex) ? previous.cellIndex : current.cellIndex,
    padding: previous.padding ?? current.padding,
    crop: previous.crop ?? current.crop,
    cropReviewed: previous.cropReviewed === true,
    status: clean(previous.status) || current.status,
    technicalQa: clean(previous.technicalQa) || current.technicalQa,
    visualQa: clean(previous.visualQa) || current.visualQa,
    visualIssue: clean(previous.visualIssue),
    generationHash: clean(previous.generationHash),
    assetHash: clean(previous.assetHash)
  };
}

export function synchronizeAlchemyImageManifest({ manifest, products }) {
  const canonical = buildAlchemyImageManifest(products);
  const previousByKey = new Map((Array.isArray(manifest?.entries) ? manifest.entries : [])
    .map((entry) => [entryKey(entry), entry]));
  const entries = canonical.entries.map((entry) => preserveReview(entry, previousByKey.get(entryKey(entry))));
  return {
    ...canonical,
    grids: buildGrids(entries, products),
    entries
  };
}

function validCrop(crop) {
  return crop && [crop.x, crop.y, crop.width, crop.height].every(Number.isInteger)
    && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0
    && crop.x + crop.width <= ALCHEMY_GRID_SIZE
    && crop.y + crop.height <= ALCHEMY_GRID_SIZE;
}

function cropInsideAssignedCell(entry) {
  if (!validCrop(entry.crop)) return false;
  const column = entry.cellIndex % 5;
  const row = Math.floor(entry.cellIndex / 5);
  const left = ALCHEMY_NOMINAL_BOUNDARIES[column];
  const right = ALCHEMY_NOMINAL_BOUNDARIES[column + 1];
  const top = ALCHEMY_NOMINAL_BOUNDARIES[row];
  const bottom = ALCHEMY_NOMINAL_BOUNDARIES[row + 1];
  return entry.crop.x >= left && entry.crop.y >= top
    && entry.crop.x + entry.crop.width <= right
    && entry.crop.y + entry.crop.height <= bottom;
}

function validatePadding(entry, diagnostics) {
  if (entry.kind === "topDown") {
    if (entry.padding?.mode !== "transparent" || entry.padding?.color !== "0x00000000") {
      diagnostics.push(`${entryKey(entry)} topDown padding must be transparent RGBA`);
    }
    return;
  }
  if (entry.padding?.mode !== "color" || !/^#[a-f0-9]{6}$/iu.test(clean(entry.padding?.color))) {
    diagnostics.push(`${entryKey(entry)} icon padding requires a manifest color`);
  }
}

export function validateAlchemyImageManifest({
  manifest,
  products,
  moduleRoot,
  requireAccepted = false
}) {
  const diagnostics = [];
  const canonical = buildAlchemyImageManifest(products);
  if (manifest?.schemaVersion !== ALCHEMY_IMAGE_MANIFEST_SCHEMA_VERSION) diagnostics.push("invalid schemaVersion");
  if (manifest?.grid?.size !== ALCHEMY_GRID_SIZE
    || manifest?.grid?.capacity !== ALCHEMY_GRID_CAPACITY
    || JSON.stringify(manifest?.grid?.nominalBoundaries) !== JSON.stringify(ALCHEMY_NOMINAL_BOUNDARIES)) {
    diagnostics.push("invalid grid contract");
  }
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  const grids = Array.isArray(manifest?.grids) ? manifest.grids : [];
  if (!Array.isArray(manifest?.entries)) diagnostics.push("manifest entries must be an array");
  if (!Array.isArray(manifest?.grids)) diagnostics.push("manifest grids must be an array");

  const canonicalByKey = new Map(canonical.entries.map((entry) => [entryKey(entry), entry]));
  const entryByKey = new Map();
  const paths = new Set();
  const placements = new Set();
  const acceptedHashes = new Map();
  for (const entry of entries) {
    const key = entryKey(entry);
    const placement = `${clean(entry?.gridId)}:${entry?.cellIndex}`;
    if (entryByKey.has(key)) diagnostics.push(`duplicate manifest entry: ${key}`);
    if (paths.has(clean(entry?.outputPath))) diagnostics.push(`duplicate output path: ${entry?.outputPath}`);
    if (placements.has(placement)) diagnostics.push(`duplicate grid placement: ${placement}`);
    entryByKey.set(key, entry);
    paths.add(clean(entry?.outputPath));
    placements.add(placement);

    const expected = canonicalByKey.get(key);
    if (!expected) diagnostics.push(`unknown manifest entry: ${key}`);
    if (expected && clean(entry.outputPath) !== expected.outputPath) diagnostics.push(`invalid output path: ${key}`);
    if (!KINDS.includes(entry?.kind)) diagnostics.push(`invalid image kind: ${key}`);
    const expectedPrefix = `${kindPrefix(entry?.kind)}-`;
    if (!clean(entry?.gridId).startsWith(expectedPrefix)
      || !/^(?:icon|topdown)-(?:primary|repair)-\d{3}$/u.test(clean(entry?.gridId))) {
      diagnostics.push(`invalid grid id: ${key}`);
    }
    if (!Number.isInteger(entry?.cellIndex) || entry.cellIndex < 0 || entry.cellIndex >= ALCHEMY_GRID_CAPACITY) {
      diagnostics.push(`invalid cell index: ${key}`);
    }
    if (!STATUSES.has(clean(entry?.status))) diagnostics.push(`invalid status: ${key}`);
    if (!QA_STATUSES.has(clean(entry?.technicalQa))) diagnostics.push(`invalid technical QA: ${key}`);
    if (!QA_STATUSES.has(clean(entry?.visualQa))) diagnostics.push(`invalid visual QA: ${key}`);
    validatePadding(entry, diagnostics);

    const requiresCrop = entry?.crop != null || entry?.cropReviewed === true
      || entry?.visualQa === "passed" || entry?.technicalQa === "passed" || entry?.status === "accepted";
    if (requiresCrop && (entry?.cropReviewed !== true || !validCrop(entry?.crop))) {
      diagnostics.push(`${key} requires reviewed crop bounds`);
    } else if (requiresCrop && !cropInsideAssignedCell(entry)) {
      diagnostics.push(`${key} crop crosses nominal cell`);
    }
    if (entry?.status === "accepted") {
      if (entry?.technicalQa !== "passed" || entry?.visualQa !== "passed") {
        diagnostics.push(`${key} accepted state requires passed QA`);
      }
      if (!HASH_PATTERN.test(clean(entry?.generationHash)) || !HASH_PATTERN.test(clean(entry?.assetHash))) {
        diagnostics.push(`${key} accepted state requires current hashes`);
      }
      const target = path.resolve(moduleRoot, ...clean(entry?.outputPath).split("/"));
      if (!existsSync(target)) {
        diagnostics.push(`missing accepted asset: ${entry?.outputPath}`);
      } else {
        try {
          const metadata = inspectProcessedAlchemyImage(target);
          if (metadata.width !== 512 || metadata.height !== 512 || metadata.codec !== "webp") {
            diagnostics.push(`${key} accepted asset must be a 512x512 WebP`);
          }
          if (entry.kind === "topDown" && metadata.hasAlpha !== true) {
            diagnostics.push(`${key} accepted topDown asset requires alpha`);
          }
          if (metadata.contentHash !== entry.assetHash) diagnostics.push(`asset hash mismatch: ${key}`);
          if (acceptedHashes.has(metadata.contentHash)) {
            diagnostics.push(`duplicate final hash: ${key} matches ${acceptedHashes.get(metadata.contentHash)}`);
          }
          acceptedHashes.set(metadata.contentHash, key);
        } catch (error) {
          diagnostics.push(`${key} asset inspection failed: ${error.message}`);
        }
      }
    } else if (requireAccepted) {
      diagnostics.push(`${key} is not accepted`);
    }
  }
  for (const key of canonicalByKey.keys()) {
    if (!entryByKey.has(key)) diagnostics.push(`missing manifest entry: ${key}`);
  }

  const gridById = new Map();
  const assignedEntryKeys = new Map();
  for (const grid of grids) {
    if (gridById.has(grid?.gridId)) diagnostics.push(`duplicate grid: ${grid?.gridId}`);
    gridById.set(grid?.gridId, grid);
    if (!/^(?:icon|topdown)-(?:primary|repair)-\d{3}$/u.test(clean(grid?.gridId))) {
      diagnostics.push(`invalid grid definition: ${grid?.gridId}`);
    }
    if (grid?.kind !== gridKind(grid?.gridId)) diagnostics.push(`grid kind mismatch: ${grid?.gridId}`);
    if (!Array.isArray(grid?.cells) || grid.cells.length !== ALCHEMY_GRID_CAPACITY) {
      diagnostics.push(`grid must contain 25 explicit cells: ${grid?.gridId}`);
      continue;
    }
    for (let index = 0; index < ALCHEMY_GRID_CAPACITY; index += 1) {
      const cell = grid.cells[index];
      if (cell?.cellIndex !== index) diagnostics.push(`invalid explicit cell index: ${grid?.gridId}:${index}`);
      if (typeof cell?.entryKey === "string") {
        if (assignedEntryKeys.has(cell.entryKey)) diagnostics.push(`duplicate grid entry assignment: ${cell.entryKey}`);
        assignedEntryKeys.set(cell.entryKey, `${grid.gridId}:${index}`);
        const entry = entryByKey.get(cell.entryKey);
        if (!entry || entry.gridId !== grid.gridId || entry.cellIndex !== index) {
          diagnostics.push(`grid cell assignment mismatch: ${grid.gridId}:${index}`);
        }
      } else if (cell?.empty !== true) {
        diagnostics.push(`grid cell must be entry or explicit empty: ${grid?.gridId}:${index}`);
      }
    }
  }
  for (const entry of entries) {
    if (assignedEntryKeys.get(entryKey(entry)) !== `${entry.gridId}:${entry.cellIndex}`) {
      diagnostics.push(`missing grid cell assignment: ${entryKey(entry)}`);
    }
  }
  for (const requiredId of requiredPrimaryGridIds(products)) {
    if (!gridById.has(requiredId)) diagnostics.push(`missing primary grid: ${requiredId}`);
  }

  if (diagnostics.length) throw new Error(diagnostics.join("\n"));
  return true;
}
