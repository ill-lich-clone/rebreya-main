#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  buildAlchemyImageManifest,
  synchronizeAlchemyImageManifest,
  validateAlchemyImageManifest
} from "./alchemy-images/manifest.mjs";
import { processAlchemyGrid } from "./alchemy-images/processing.mjs";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = path.join(moduleRoot, "data", "alchemy-image-assets.json");
const productsPath = path.join(moduleRoot, "data", "alchemy-products.json");

function parseArguments(argv) {
  const [command = "", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--require-accepted" || argument === "--replace-existing") {
      options[argument.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())] = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const value = rest[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2)] = value;
  }
  return { command, options };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    renameSync(temporary, filePath);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function loadContext(options, { allowMissingManifest = false } = {}) {
  const manifestPath = path.resolve(options.manifest ?? defaultManifestPath);
  return {
    manifestPath,
    manifest: allowMissingManifest && !existsSync(manifestPath) ? null : readJson(manifestPath),
    products: readJson(productsPath)
  };
}

function entryKey(entry) {
  return `${entry.kind}:${entry.productId}`;
}

function buildGridPlan(manifest, gridId) {
  const grid = manifest.grids.find((candidate) => candidate.gridId === gridId);
  if (!grid) throw new Error(`Unknown alchemy grid: ${gridId}`);
  const byKey = new Map(manifest.entries.map((entry) => [entryKey(entry), entry]));
  const cells = grid.cells.map((cell) => {
    const entry = typeof cell.entryKey === "string" ? byKey.get(cell.entryKey) : null;
    return entry
      ? {
          cellIndex: cell.cellIndex,
          entryKey: cell.entryKey,
          sourceNumber: entry.sourceNumber,
          name: entry.name,
          productType: entry.productType,
          promptInput: entry.promptInput
        }
      : { cellIndex: cell.cellIndex, empty: true };
  });
  const cellLines = cells.map((cell) => (
    cell.empty
      ? `CELL ${String(cell.cellIndex + 1).padStart(2, "0")} — EMPTY — leave completely blank`
      : `CELL ${String(cell.cellIndex + 1).padStart(2, "0")} — ${cell.entryKey} — ${cell.name} — ${cell.productType} — ${cell.promptInput}`
  ));
  const shared = [
    "Create one square image arranged as a strict 5x5 grid; canvas must be exactly 1254x1254 pixels.",
    "Keep every object fully inside its assigned nominal cell with wide clear gutters; do not draw grid lines.",
    "Every populated cell contains exactly one clearly separated object in the stated order.",
    "Use no text, labels, numbers, logos, or watermarks anywhere in the image."
  ];
  const artDirection = grid.kind === "topDown"
    ? [
        "Strict orthographic 90-degree overhead view, isolated tabletop item art, consistent dark-fantasy realism.",
        "Use a fully transparent background with no frame, floor, cast shadow, glow spill, or neighboring object."
      ]
    : [
        "Foundry VTT inventory icon art matching the existing Rebreya Goods icons: detailed dark-fantasy painting, centered silhouette, controlled dramatic light.",
        "Give each cell its own subtle dark brown square icon field, but no drawn border or text."
      ];
  return {
    gridId,
    kind: grid.kind,
    cells,
    prompt: [...shared, ...artDirection, ...cellLines].join("\n")
  };
}

function synchronizeManifest(context) {
  const manifest = synchronizeAlchemyImageManifest({
    manifest: context.manifest,
    products: context.products
  });
  validateAlchemyImageManifest({ manifest, products: context.products, moduleRoot });
  const previousByKey = new Map((context.manifest?.entries ?? []).map((entry) => [entryKey(entry), entry]));
  const nextByKey = new Map(manifest.entries.map((entry) => [entryKey(entry), entry]));
  const result = {
    total: manifest.entries.length,
    added: [...nextByKey.keys()].filter((key) => !previousByKey.has(key)).length,
    updated: [...nextByKey].filter(([key, entry]) => previousByKey.has(key)
      && JSON.stringify(previousByKey.get(key)) !== JSON.stringify(entry)).length,
    removed: [...previousByKey.keys()].filter((key) => !nextByKey.has(key)).length
  };
  writeJsonAtomic(context.manifestPath, manifest);
  return result;
}

function validationReport(context, requireAccepted) {
  validateAlchemyImageManifest({
    manifest: context.manifest,
    products: context.products,
    moduleRoot,
    requireAccepted
  });
  const counts = { total: context.manifest.entries.length, accepted: 0, planned: 0, rejected: 0 };
  for (const entry of context.manifest.entries) {
    if (entry.status === "accepted") counts.accepted += 1;
    else if (entry.status === "rejected") counts.rejected += 1;
    else counts.planned += 1;
  }
  return counts;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
}

function createContactSheet(context, options) {
  const kind = options.kind;
  if (!new Set(["icon", "topDown"]).has(kind)) throw new Error("contact-sheet --kind must be icon or topDown");
  if (!options.output) throw new Error("contact-sheet requires --output");
  const entries = context.manifest.entries
    .filter((entry) => entry.kind === kind && entry.status === "accepted")
    .sort((left, right) => left.sourceNumber - right.sourceNumber);
  if (!entries.length) throw new Error(`No accepted ${kind} entries for contact sheet`);
  const workRoot = mkdtempSync(path.join(os.tmpdir(), "rebreya-alchemy-contact-"));
  try {
    const listPath = path.join(workRoot, "inputs.ffconcat");
    const lines = ["ffconcat version 1.0"];
    for (const entry of entries) {
      const source = path.resolve(moduleRoot, ...entry.outputPath.split("/"));
      if (!existsSync(source)) throw new Error(`Missing contact-sheet asset: ${entry.outputPath}`);
      lines.push(`file '${source.replaceAll("'", "'\\''")}'`, "duration 1");
    }
    writeFileSync(listPath, `${lines.join("\n")}\n`, "utf8");
    const rows = Math.ceil(entries.length / 5);
    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-vf", `scale=192:192:flags=lanczos,tile=5x${rows}:padding=4:margin=4`,
      "-frames:v", "1", path.resolve(options.output)
    ]);
    return { kind, output: path.resolve(options.output), entries: entries.length };
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

export function runAlchemyImagesCli(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  let result;
  if (command === "sync") {
    result = synchronizeManifest(loadContext(options, { allowMissingManifest: true }));
  } else {
    const context = loadContext(options);
    switch (command) {
      case "plan":
        validateAlchemyImageManifest({ manifest: context.manifest, products: context.products, moduleRoot });
        result = buildGridPlan(context.manifest, cleanRequired(options["grid-id"], "plan requires --grid-id"));
        break;
      case "process-grid":
        result = processAlchemyGrid({
          manifest: context.manifest,
          moduleRoot,
          manifestPath: context.manifestPath,
          gridId: cleanRequired(options["grid-id"], "process-grid requires --grid-id"),
          sourcePath: path.resolve(cleanRequired(options.source, "process-grid requires --source")),
          replaceExisting: options.replaceExisting === true
        });
        break;
      case "contact-sheet":
        result = createContactSheet(context, options);
        break;
      case "validate":
        result = validationReport(context, options.requireAccepted === true);
        break;
      default:
        throw new Error("Usage: alchemy-images.mjs <sync|plan|process-grid|contact-sheet|validate> [options]");
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function cleanRequired(value, message) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(message);
  return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    runAlchemyImagesCli();
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
