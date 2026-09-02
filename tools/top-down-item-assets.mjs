#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  inspectImage,
  processAtlas,
  validateAssetCollection
} from "./top-down-items/image-processing.mjs";
import {
  topDownEntryKey,
  validateTopDownManifest
} from "./top-down-items/manifest.mjs";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = resolve(moduleRoot, "data/top-down-item-assets.json");

function parseArguments(values) {
  const [command = "", ...rest] = values;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (name === "force") {
      options.force = true;
      continue;
    }
    const value = rest[index + 1];
    if (value == null || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function loadContext(options) {
  const manifestPath = resolve(options.manifest ?? defaultManifestPath);
  return {
    manifestPath,
    manifest: readJson(manifestPath),
    gear: readJson(resolve(moduleRoot, "data/gear.json")),
    materials: readJson(resolve(moduleRoot, "data/materials.json"))
  };
}

function atlasPlan(manifest, atlasId) {
  const entries = manifest.entries
    .filter((entry) => entry.atlasId === atlasId)
    .sort((left, right) => left.cellIndex - right.cellIndex);
  if (!entries.length) throw new Error(`Unknown or empty atlas: ${atlasId}`);
  const cells = entries.map((entry) => ({
    cellIndex: entry.cellIndex,
    key: topDownEntryKey(entry),
    name: entry.name,
    visualType: entry.visualType,
    promptInput: entry.promptInput
  }));
  const cellLines = cells.map((cell) => (
    `CELL ${String(cell.cellIndex + 1).padStart(2, "0")} — ${cell.key} — ${cell.name} — ${cell.visualType} — ${cell.promptInput}`
  ));
  const emptyCells = Array.from({ length: 25 }, (_, cellIndex) => cellIndex)
    .filter((cellIndex) => !cells.some((cell) => cell.cellIndex === cellIndex))
    .map((cellIndex) => `CELL ${String(cellIndex + 1).padStart(2, "0")} — EMPTY`);
  return {
    atlasId,
    cells,
    prompt: [
      "Create one square 5x5 atlas on a perfectly uniform #00ff00 chroma background.",
      "Each populated cell contains exactly one isolated object in realistic detailed dark-fantasy style matching Rebreya storage pile art.",
      "Use strict orthographic 90-degree overhead camera. Every object lies flat or exposes its natural top surface. No horizon or three-quarter view.",
      "No text, labels, cards, frames, cast shadows, glow outside the object, cell crossing, or neighbor overlap. Keep wide empty gutters.",
      ...cellLines,
      ...emptyCells
    ].join("\n")
  };
}

function requestedKeys(options) {
  return String(options.keys ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

function selectEntries(manifest, options, { requireAtlas = false } = {}) {
  const keys = requestedKeys(options);
  if (keys.length) {
    if (new Set(keys).size !== keys.length) throw new Error("Entry keys must be unique");
    const byKey = new Map(manifest.entries.map((entry) => [topDownEntryKey(entry), entry]));
    return keys.map((key) => {
      const entry = byKey.get(key);
      if (!entry) throw new Error(`Unknown manifest key: ${key}`);
      return entry;
    });
  }
  const atlasId = String(options["atlas-id"] ?? "").trim();
  if (!atlasId && requireAtlas) throw new Error("--atlas-id or --keys is required");
  return manifest.entries.filter((entry) => entry.atlasId === atlasId);
}

function runProcessAtlas(context, options) {
  const atlasId = String(options["atlas-id"] ?? "").trim();
  const input = resolve(String(options.input ?? ""));
  if (!atlasId || !options.input) throw new Error("process-atlas requires --atlas-id and --input");
  const selected = selectEntries(context.manifest, options);
  if (options.keys && selected.some((entry) => entry.atlasId !== atlasId)) {
    throw new Error("Every --keys entry must belong to --atlas-id");
  }
  const results = processAtlas({
    atlasPath: input,
    atlasId,
    entries: options.keys ? selected : context.manifest.entries,
    moduleRoot,
    chromaColor: options.chroma ?? "#00ff00",
    chromaFuzz: Number(options.fuzz ?? 12),
    matteMethod: options.matte ?? "chroma",
    force: options.force === true
  });
  const generationHash = createHash("sha256").update(readFileSync(input)).digest("hex");
  const byKey = new Map(results.map((result) => [topDownEntryKey(result.entry), result]));
  for (const entry of context.manifest.entries) {
    const result = byKey.get(topDownEntryKey(entry));
    if (!result) continue;
    entry.status = "processing";
    entry.technicalQa = "passed";
    entry.visualQa = "pending";
    entry.generationHash = generationHash;
    entry.assetHash = result.metadata.contentHash;
    entry.matteMethod = options.matte ?? "chroma";
  }
  writeJsonAtomic(context.manifestPath, context.manifest);
  return { atlasId, processed: results.length };
}

function runVisualDecision(context, options, passed) {
  const atlasId = String(options["atlas-id"] ?? "").trim();
  const entries = selectEntries(context.manifest, options, { requireAtlas: true });
  if (!entries.length) throw new Error(`Unknown or empty atlas: ${atlasId || "entry selection"}`);
  for (const entry of entries) {
    if (passed && entry.technicalQa !== "passed") {
      throw new Error(`${topDownEntryKey(entry)} has not passed technical QA`);
    }
    entry.visualQa = passed ? "passed" : "failed";
    entry.status = passed ? "accepted" : "rejected";
  }
  writeJsonAtomic(context.manifestPath, context.manifest);
  return { atlasId: atlasId || null, status: passed ? "accepted" : "rejected", entries: entries.length };
}

function assignRetryAtlas(context, options) {
  const keys = requestedKeys(options);
  if (!keys.length || keys.length > 25) throw new Error("assign-retry requires 1 to 25 comma-separated --keys");
  if (new Set(keys).size !== keys.length) throw new Error("assign-retry keys must be unique");
  const entryByKey = new Map(context.manifest.entries.map((entry) => [topDownEntryKey(entry), entry]));
  const selected = keys.map((key) => {
    const entry = entryByKey.get(key);
    if (!entry) throw new Error(`Unknown manifest key: ${key}`);
    if (entry.status !== "rejected") throw new Error(`Retry key is not rejected: ${key}`);
    return entry;
  });
  const highestRetry = context.manifest.entries.reduce((highest, entry) => {
    const match = String(entry.atlasId ?? "").match(/^retry-(\d+)$/u);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  const atlasId = `retry-${String(highestRetry + 1).padStart(3, "0")}`;
  selected.forEach((entry, cellIndex) => Object.assign(entry, {
    atlasId,
    cellIndex,
    status: "planned",
    technicalQa: "pending",
    visualQa: "pending",
    generationHash: "",
    assetHash: "",
    matteMethod: ""
  }));
  writeJsonAtomic(context.manifestPath, context.manifest);
  return { atlasId, keys };
}

function validateProduction(context) {
  validateTopDownManifest(context);
  const assets = [];
  const stateCounts = new Map();
  for (const entry of context.manifest.entries) {
    const state = `${entry.status}/${entry.technicalQa}/${entry.visualQa}`;
    stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1);
    if (entry.status !== "accepted" || entry.technicalQa !== "passed" || entry.visualQa !== "passed") {
      continue;
    }
    const path = resolve(moduleRoot, entry.assetPath);
    if (!existsSync(path)) throw new Error(`Missing accepted asset: ${entry.assetPath}`);
    const metadata = inspectImage(path);
    if (metadata.contentHash !== entry.assetHash) throw new Error(`Asset hash mismatch: ${topDownEntryKey(entry)}`);
    assets.push({ entry, metadata });
  }
  if (assets.length !== context.manifest.entries.length) {
    throw new Error(`Incomplete assets: accepted ${assets.length}/${context.manifest.entries.length}; states ${JSON.stringify(Object.fromEntries(stateCounts))}`);
  }
  validateAssetCollection(assets);
  return {
    total: assets.length,
    gear: assets.filter(({ entry }) => entry.sourceType === "gear").length,
    material: assets.filter(({ entry }) => entry.sourceType === "material").length,
    pending: 0,
    rejected: 0
  };
}

function runtimeCatalogSource(manifest) {
  const accepted = manifest.entries
    .filter((entry) => entry.status === "accepted"
      && entry.technicalQa === "passed"
      && entry.visualQa === "passed")
    .sort((left, right) => topDownEntryKey(left).localeCompare(topDownEntryKey(right), "en"));
  const rows = accepted.map((entry) => (
    `  [${JSON.stringify(topDownEntryKey(entry))}, ${JSON.stringify(`modules/rebreya-main/${entry.assetPath}`)}]`
  ));
  const tokenScales = accepted
    .filter((entry) => entry.tokenScale !== 1)
    .map((entry) => `  [${JSON.stringify(topDownEntryKey(entry))}, ${JSON.stringify(entry.tokenScale)}]`);
  const footprints = accepted
    .filter((entry) => entry.rotationMode === "cardinal")
    .map((entry) => `  [${JSON.stringify(topDownEntryKey(entry))}, Object.freeze({ width: ${JSON.stringify(entry.tokenWidth)}, height: ${JSON.stringify(entry.tokenHeight)}, rotationMode: "cardinal" })]`);
  const armorKeys = accepted
    .filter((entry) => entry.visualType === "Доспех")
    .map((entry) => `  ${JSON.stringify(topDownEntryKey(entry))}`);
  return [
    "// Generated by tools/top-down-item-assets.mjs. Do not edit manually.",
    "",
    "export const TOP_DOWN_ITEM_TEXTURE_ENTRIES = Object.freeze([",
    rows.join(",\n"),
    "]);",
    "",
    "export const TOP_DOWN_ITEM_TEXTURES = new Map(TOP_DOWN_ITEM_TEXTURE_ENTRIES);",
    "",
    "export const TOP_DOWN_ITEM_TOKEN_SCALES = new Map(Object.freeze([",
    tokenScales.join(",\n"),
    "]));",
    "",
    "export const TOP_DOWN_ITEM_FOOTPRINTS = new Map(Object.freeze([",
    footprints.join(",\n"),
    "]));",
    "",
    "export const TOP_DOWN_ITEM_ARMOR_KEYS = new Set(Object.freeze([",
    armorKeys.join(",\n"),
    "]));",
    ""
  ].join("\n");
}

function generateRuntimeCatalog(context, options) {
  const output = resolve(options.output ?? resolve(moduleRoot, "scripts/data/top-down-item-texture-catalog.js"));
  writeFileSync(output, runtimeCatalogSource(context.manifest), "utf8");
  return {
    output,
    entries: context.manifest.entries.filter((entry) => entry.status === "accepted").length
  };
}

function createContactSheet(context, options) {
  const atlasId = String(options["atlas-id"] ?? "").trim();
  const output = resolve(String(options.output ?? ""));
  if (!atlasId || !options.output) throw new Error("contact-sheet requires --atlas-id and --output");
  const entries = context.manifest.entries
    .filter((entry) => (
      entry.atlasId === atlasId
      && entry.technicalQa === "passed"
      && existsSync(resolve(moduleRoot, entry.assetPath))
    ))
    .sort((left, right) => left.cellIndex - right.cellIndex);
  if (!entries.length) throw new Error(`Unknown or empty atlas: ${atlasId}`);
  const args = ["montage"];
  for (const entry of entries) {
    args.push("-label", `${String(entry.cellIndex + 1).padStart(2, "0")} ${topDownEntryKey(entry)}\n${entry.name}`);
    args.push(resolve(moduleRoot, entry.assetPath));
  }
  args.push("-background", "#202020", "-fill", "white", "-tile", "5x5", "-geometry", "256x300+12+12", output);
  const result = spawnSync("magick", args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`contact-sheet failed: ${result.stderr || result.stdout}`);
  return { atlasId, output, entries: entries.length };
}

function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const context = loadContext(options);
  let result;
  switch (command) {
    case "plan":
      result = atlasPlan(context.manifest, String(options["atlas-id"] ?? "").trim());
      break;
    case "process-atlas":
      result = runProcessAtlas(context, options);
      break;
    case "accept-atlas":
      result = runVisualDecision(context, options, true);
      break;
    case "reject-atlas":
      result = runVisualDecision(context, options, false);
      break;
    case "accept-entries":
      result = runVisualDecision(context, options, true);
      break;
    case "reject-entries":
      result = runVisualDecision(context, options, false);
      break;
    case "assign-retry":
      result = assignRetryAtlas(context, options);
      break;
    case "validate":
      result = validateProduction(context);
      break;
    case "generate-runtime-catalog":
      result = generateRuntimeCatalog(context, options);
      break;
    case "contact-sheet":
      result = createContactSheet(context, options);
      break;
    default:
      throw new Error("Usage: top-down-item-assets.mjs <plan|process-atlas|accept-atlas|reject-atlas|accept-entries|reject-entries|assign-retry|validate|generate-runtime-catalog|contact-sheet> [options]");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
}
