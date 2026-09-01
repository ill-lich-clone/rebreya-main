import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const TOP_DOWN_ATLAS_SIZE = 3000;
export const TOP_DOWN_GRID_SIZE = 5;
export const TOP_DOWN_CELL_GUTTER = 48;
export const TOP_DOWN_OUTPUT_SIZE = 512;

export const TOP_DOWN_SCALE_TARGETS = Object.freeze({
  tiny: 320,
  standard: 384,
  long: 432,
  bulky: 448
});

function clean(value) {
  return String(value ?? "").trim();
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${clean(result.stderr || result.stdout)}`);
  }
  return clean(result.stdout);
}

function parseBoundingBox(value) {
  const match = clean(value).match(/^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/u);
  if (!match) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: Number(match[3]),
    y: Number(match[4]),
    width: Number(match[1]),
    height: Number(match[2])
  };
}

export function atlasCellGeometry({
  atlasSize,
  cellIndex,
  gutter = TOP_DOWN_CELL_GUTTER
} = {}) {
  if (!Number.isInteger(atlasSize) || atlasSize <= 0 || atlasSize % TOP_DOWN_GRID_SIZE !== 0) {
    throw new Error("atlasSize must be a positive integer divisible by 5");
  }
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= 25) {
    throw new Error("cellIndex must be an integer from 0 to 24");
  }
  const size = atlasSize / TOP_DOWN_GRID_SIZE;
  if (!Number.isInteger(gutter) || gutter < 0 || gutter * 2 >= size) {
    throw new Error("gutter must leave a positive safe cell area");
  }
  const column = cellIndex % TOP_DOWN_GRID_SIZE;
  const row = Math.floor(cellIndex / TOP_DOWN_GRID_SIZE);
  const x = column * size;
  const y = row * size;
  return {
    column,
    row,
    x,
    y,
    width: size,
    height: size,
    gutter,
    safe: {
      x: x + gutter,
      y: y + gutter,
      width: size - gutter * 2,
      height: size - gutter * 2
    }
  };
}

export function inspectImage(path) {
  const identity = run("magick", [
    "identify",
    "-format",
    "%m|%w|%h|%[channels]",
    path
  ]).split("|");
  const alphaBoundingBox = parseBoundingBox(run("magick", [
    path,
    "-alpha", "extract",
    "-threshold", "0",
    "-format", "%@",
    "info:"
  ]));
  const visiblePixels = Math.round(Number(run("magick", [
    path,
    "-alpha", "extract",
    "-format", "%[fx:mean*w*h]",
    "info:"
  ])) || 0);
  return {
    format: clean(identity[0]).toUpperCase(),
    width: Number(identity[1]),
    height: Number(identity[2]),
    hasAlpha: /a/iu.test(clean(identity[3])),
    visiblePixels,
    alphaBoundingBox,
    contentHash: createHash("sha256").update(readFileSync(path)).digest("hex")
  };
}

export function validateProcessedAsset(metadata, entry) {
  const problems = [];
  if (clean(metadata?.format).toUpperCase() !== "WEBP") problems.push("format must be WEBP");
  if (metadata?.width !== 512 || metadata?.height !== 512) problems.push("dimensions must be 512x512");
  if (metadata?.hasAlpha !== true) problems.push("alpha channel is required");
  if (!Number.isFinite(metadata?.visiblePixels) || metadata.visiblePixels <= 0) problems.push("image is empty");
  const box = metadata?.alphaBoundingBox ?? {};
  const boxValues = [box.x, box.y, box.width, box.height];
  if (!boxValues.every(Number.isFinite) || box.width <= 0 || box.height <= 0) {
    problems.push("alpha bounding box is empty");
  } else {
    const edge = Math.min(box.x, box.y, 512 - box.x - box.width, 512 - box.y - box.height);
    if (edge < 24) problems.push("alpha bounding box crosses the safe edge");
    const target = TOP_DOWN_SCALE_TARGETS[clean(entry?.scaleClass)] ?? TOP_DOWN_SCALE_TARGETS.standard;
    const longest = Math.max(box.width, box.height);
    if (longest < Math.floor(target * 0.9) || longest > target + 2) {
      problems.push(`visual scale must target ${target}px`);
    }
  }
  if (problems.length) {
    throw new Error(`${entry?.sourceType ?? "item"}:${entry?.sourceId ?? "unknown"}: ${problems.join("; ")}`);
  }
  return true;
}

export function validateAssetCollection(assets = []) {
  const seenHashes = new Map();
  for (const asset of assets) {
    validateProcessedAsset(asset?.metadata, asset?.entry);
    const hash = clean(asset?.metadata?.contentHash);
    const key = `${asset?.entry?.sourceType}:${asset?.entry?.sourceId}`;
    if (!hash) throw new Error(`${key}: content hash is required`);
    if (seenHashes.has(hash)) {
      throw new Error(`duplicate content hash: ${key} matches ${seenHashes.get(hash)}`);
    }
    seenHashes.set(hash, key);
  }
  return true;
}

function assertSourceInsideSafeArea(cellPath, geometry) {
  const box = inspectImage(cellPath).alphaBoundingBox;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const localSafeRight = geometry.width - geometry.gutter;
  const localSafeBottom = geometry.height - geometry.gutter;
  if (box.width <= 0 || box.height <= 0) throw new Error("processed source cell is empty");
  if (box.x < geometry.gutter || box.y < geometry.gutter
    || right > localSafeRight || bottom > localSafeBottom) {
    throw new Error("source bounding box intersects the atlas gutter");
  }
}

export function processAtlas({
  atlasPath,
  atlasId,
  entries = [],
  moduleRoot,
  chromaColor = "#00ff00",
  force = false
} = {}) {
  const selected = entries.filter((entry) => clean(entry?.atlasId) === clean(atlasId));
  if (!selected.length) throw new Error(`No manifest entries found for atlas ${atlasId}`);
  const workRoot = mkdtempSync(join(tmpdir(), "rebreya-topdown-atlas-"));
  const normalizedPath = join(workRoot, "normalized.png");
  try {
    run("magick", [atlasPath, "-resize", `${TOP_DOWN_ATLAS_SIZE}x${TOP_DOWN_ATLAS_SIZE}!`, normalizedPath]);
    const results = [];
    for (const entry of selected) {
      const geometry = atlasCellGeometry({
        atlasSize: TOP_DOWN_ATLAS_SIZE,
        cellIndex: entry.cellIndex
      });
      const cellPath = join(workRoot, `cell-${String(entry.cellIndex).padStart(2, "0")}.png`);
      run("magick", [
        normalizedPath,
        "-crop", `${geometry.width}x${geometry.height}+${geometry.x}+${geometry.y}`,
        "+repage",
        "-alpha", "on",
        "-fuzz", "8%",
        "-transparent", chromaColor,
        cellPath
      ]);
      assertSourceInsideSafeArea(cellPath, geometry);
      const outputPath = resolve(moduleRoot, entry.assetPath);
      if (existsSync(outputPath) && force !== true) {
        throw new Error(`Refusing to overwrite existing asset: ${entry.assetPath}`);
      }
      mkdirSync(dirname(outputPath), { recursive: true });
      const target = TOP_DOWN_SCALE_TARGETS[clean(entry.scaleClass)] ?? TOP_DOWN_SCALE_TARGETS.standard;
      run("magick", [
        cellPath,
        "-trim", "+repage",
        "-resize", `${target}x${target}`,
        "-gravity", "center",
        "-background", "none",
        "-extent", `${TOP_DOWN_OUTPUT_SIZE}x${TOP_DOWN_OUTPUT_SIZE}`,
        "-define", "webp:lossless=true",
        outputPath
      ]);
      const metadata = inspectImage(outputPath);
      validateProcessedAsset(metadata, entry);
      results.push({ entry, outputPath, metadata });
    }
    validateAssetCollection(results);
    return results;
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}
