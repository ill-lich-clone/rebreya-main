import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const TOP_DOWN_ATLAS_SIZE = 3000;
export const TOP_DOWN_GRID_SIZE = 5;
export const TOP_DOWN_CELL_GUTTER = 48;
export const TOP_DOWN_ALPHA_CELL_GUTTER = 24;
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

function chromaDespill(chromaColor) {
  switch (clean(chromaColor).toLowerCase()) {
    case "#ff0000": return { channel: "R", expression: "min(r,max(g,b))" };
    case "#00ff00": return { channel: "G", expression: "min(g,max(r,b))" };
    case "#0000ff": return { channel: "B", expression: "min(b,max(r,g))" };
    default: return null;
  }
}

function chromaAlphaExpression(chromaColor) {
  switch (clean(chromaColor).toLowerCase()) {
    case "#ff0000": return "min(a,clamp((max(g,b)-r+0.12)/0.12))";
    case "#00ff00": return "min(a,clamp((max(r,b)-g+0.12)/0.12))";
    case "#0000ff": return "min(a,clamp((max(r,g)-b+0.12)/0.12))";
    default: return null;
  }
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

function assertSourceInsideCell(cellPath, geometry) {
  const box = parseBoundingBox(run("magick", [
    cellPath,
    "-alpha", "extract",
    "-threshold", "1%",
    "-format", "%@",
    "info:"
  ]));
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  if (box.width <= 0 || box.height <= 0) throw new Error("processed source cell is empty");
  if (box.x <= 0 || box.y <= 0 || right >= geometry.width || bottom >= geometry.height) {
    throw new Error("source bounding box touches or crosses the cell boundary");
  }
}

export function processAtlas({
  atlasPath,
  atlasId,
  entries = [],
  moduleRoot,
  chromaColor = "#00ff00",
  chromaFuzz = 12,
  matteMethod = "chroma",
  force = false
} = {}) {
  if (!new Set(["alpha", "chroma"]).has(matteMethod)) {
    throw new Error("matteMethod must be alpha or chroma");
  }
  const atlasMetadata = inspectImage(atlasPath);
  if (atlasMetadata.width !== atlasMetadata.height) {
    throw new Error(`atlas source must be square, received ${atlasMetadata.width}x${atlasMetadata.height}`);
  }
  const selected = entries.filter((entry) => clean(entry?.atlasId) === clean(atlasId));
  if (!selected.length) throw new Error(`No manifest entries found for atlas ${atlasId}`);
  const workRoot = mkdtempSync(join(tmpdir(), "rebreya-topdown-atlas-"));
  const normalizedPath = join(workRoot, "normalized.png");
  try {
    const destinations = selected.map((entry) => ({
      entry,
      outputPath: resolve(moduleRoot, entry.assetPath)
    }));
    for (const destination of destinations) {
      if (existsSync(destination.outputPath) && force !== true) {
        throw new Error(`Refusing to overwrite existing asset: ${destination.entry.assetPath}`);
      }
    }
    run("magick", [atlasPath, "-resize", `${TOP_DOWN_ATLAS_SIZE}x${TOP_DOWN_ATLAS_SIZE}!`, normalizedPath]);
    const staged = [];
    for (let index = 0; index < selected.length; index += 1) {
      const entry = selected[index];
      const geometry = atlasCellGeometry({
        atlasSize: TOP_DOWN_ATLAS_SIZE,
        cellIndex: entry.cellIndex,
        gutter: matteMethod === "alpha" ? TOP_DOWN_ALPHA_CELL_GUTTER : TOP_DOWN_CELL_GUTTER
      });
      const cellPath = join(workRoot, `cell-${String(entry.cellIndex).padStart(2, "0")}.png`);
      const cropArguments = [
        normalizedPath,
        "-crop", `${geometry.width}x${geometry.height}+${geometry.x}+${geometry.y}`,
        "+repage"
      ];
      if (matteMethod === "chroma") {
        cropArguments.push(
          "-alpha", "on",
          "-fuzz", `${chromaFuzz}%`,
          "-transparent", chromaColor
        );
        const alphaExpression = chromaAlphaExpression(chromaColor);
        if (alphaExpression) {
          cropArguments.push("-channel", "A", "-fx", alphaExpression, "+channel");
        }
        const despill = chromaDespill(chromaColor);
        if (despill) {
          cropArguments.push("-channel", despill.channel, "-fx", despill.expression, "+channel");
        }
      }
      cropArguments.push("-channel", "A", "-fx", "a <= 0.01 ? 0 : a", "+channel");
      cropArguments.push(cellPath);
      run("magick", cropArguments);
      if (matteMethod === "alpha" && inspectImage(cellPath).hasAlpha !== true) {
        throw new Error(`${entry.sourceType}:${entry.sourceId}: source alpha channel is required`);
      }
      try {
        assertSourceInsideCell(cellPath, geometry);
      } catch (error) {
        throw new Error(`${entry.sourceType}:${entry.sourceId}: ${error.message}`, { cause: error });
      }
      const outputPath = resolve(moduleRoot, entry.assetPath);
      const temporaryOutputPath = join(workRoot, `output-${String(index).padStart(2, "0")}.webp`);
      const target = TOP_DOWN_SCALE_TARGETS[clean(entry.scaleClass)] ?? TOP_DOWN_SCALE_TARGETS.standard;
      const outputArguments = [
        cellPath,
        "-trim", "+repage",
        "-resize", `${target}x${target}`,
        "-gravity", "center",
        "-background", "none",
        "-extent", `${TOP_DOWN_OUTPUT_SIZE}x${TOP_DOWN_OUTPUT_SIZE}`
      ];
      const outputDespill = matteMethod === "chroma" ? chromaDespill(chromaColor) : null;
      if (outputDespill) {
        outputArguments.push("-channel", outputDespill.channel, "-fx", outputDespill.expression, "+channel");
      }
      outputArguments.push("-define", "webp:lossless=true", temporaryOutputPath);
      run("magick", outputArguments);
      const metadata = inspectImage(temporaryOutputPath);
      validateProcessedAsset(metadata, entry);
      staged.push({ entry, outputPath, temporaryOutputPath, metadata });
    }
    validateAssetCollection(staged);

    const committed = [];
    try {
      for (let index = 0; index < staged.length; index += 1) {
        const result = staged[index];
        mkdirSync(dirname(result.outputPath), { recursive: true });
        const backupPath = existsSync(result.outputPath)
          ? join(workRoot, `backup-${String(index).padStart(2, "0")}.webp`)
          : "";
        if (backupPath) copyFileSync(result.outputPath, backupPath);
        copyFileSync(result.temporaryOutputPath, result.outputPath);
        committed.push({ outputPath: result.outputPath, backupPath });
      }
    } catch (error) {
      for (const result of committed.reverse()) {
        if (result.backupPath) copyFileSync(result.backupPath, result.outputPath);
        else if (existsSync(result.outputPath)) unlinkSync(result.outputPath);
      }
      throw error;
    }
    return staged.map(({ temporaryOutputPath: _temporaryOutputPath, ...result }) => result);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}
