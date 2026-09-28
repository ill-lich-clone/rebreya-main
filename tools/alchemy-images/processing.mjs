import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function clean(value) {
  return String(value ?? "").trim();
}

function run(command, args, spawnImpl = spawnSync) {
  const result = spawnImpl(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${clean(result.stderr || result.stdout)}`);
  }
  return clean(result.stdout);
}

function probeImage(imagePath, spawnImpl = spawnSync) {
  const result = JSON.parse(run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,pix_fmt",
    "-of", "json",
    imagePath
  ], spawnImpl));
  const stream = result?.streams?.[0];
  if (!stream) throw new Error(`ffprobe found no image stream: ${imagePath}`);
  const pixelFormat = clean(stream.pix_fmt).toLowerCase();
  return {
    codec: clean(stream.codec_name).toLowerCase(),
    width: Number(stream.width),
    height: Number(stream.height),
    pixelFormat,
    hasAlpha: pixelFormat.includes("a")
  };
}

export function computeSquarePad({ width, height }) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("Square padding requires positive integer width and height");
  }
  const side = Math.max(width, height);
  const horizontal = side - width;
  const vertical = side - height;
  const left = Math.floor(horizontal / 2);
  const top = Math.floor(vertical / 2);
  return {
    side,
    left,
    top,
    right: horizontal - left,
    bottom: vertical - top
  };
}

function normalizedPadColor(kind, pad) {
  if (kind === "topDown") {
    if (pad?.mode !== "transparent") throw new Error("Top-down padding must be transparent");
    return "0x00000000";
  }
  if (pad?.mode !== "color" || !/^#[a-f0-9]{6}$/iu.test(clean(pad?.color))) {
    throw new Error("Icon padding requires a six-digit manifest color");
  }
  return `0x${clean(pad.color).slice(1).toLowerCase()}`;
}

export function buildFfmpegFilter({ crop, pad, kind }) {
  if (!crop || ![crop.x, crop.y, crop.width, crop.height].every(Number.isInteger)
    || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0) {
    throw new Error("FFmpeg crop requires reviewed positive integer bounds");
  }
  if (!new Set(["icon", "topDown"]).has(kind)) throw new Error(`Unsupported alchemy image kind: ${kind}`);
  const square = computeSquarePad(crop);
  const color = normalizedPadColor(kind, pad);
  const filters = [
    `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`
  ];
  if (kind === "topDown") filters.push("format=rgba");
  filters.push(`pad=${square.side}:${square.side}:${square.left}:${square.top}:color=${color}`);
  filters.push("scale=512:512:flags=lanczos");
  if (kind === "topDown") filters.push("format=rgba");
  return filters.join(",");
}

export function inspectProcessedAlchemyImage(imagePath, { spawnImpl = spawnSync } = {}) {
  return {
    ...probeImage(imagePath, spawnImpl),
    contentHash: createHash("sha256").update(readFileSync(imagePath)).digest("hex")
  };
}

function writeManifestAtomic(manifestPath, manifest) {
  const temporary = `${manifestPath}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  try {
    renameSync(temporary, manifestPath);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function assertReviewedEntry(entry) {
  if (entry?.visualQa !== "passed") throw new Error(`${entry?.kind}:${entry?.productId} has not passed visual QA`);
  if (entry?.cropReviewed !== true || !entry?.crop) {
    throw new Error(`${entry?.kind}:${entry?.productId} requires reviewed crop bounds`);
  }
}

export function processAlchemyGrid({
  manifest,
  moduleRoot,
  manifestPath = null,
  gridId,
  sourcePath,
  spawnImpl = spawnSync
}) {
  const source = probeImage(sourcePath, spawnImpl);
  if (source.width !== 1254 || source.height !== 1254) {
    throw new Error(`Alchemy grid must be exactly 1254x1254; received ${source.width}x${source.height}`);
  }
  const selected = (Array.isArray(manifest?.entries) ? manifest.entries : [])
    .filter((entry) => entry.gridId === gridId && entry.visualQa === "passed")
    .sort((left, right) => left.cellIndex - right.cellIndex);
  if (!selected.length) throw new Error(`No visually passed entries found for grid ${gridId}`);
  selected.forEach(assertReviewedEntry);

  const workRoot = mkdtempSync(path.join(os.tmpdir(), "rebreya-alchemy-grid-"));
  const generationHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
  const staged = [];
  try {
    for (const [index, entry] of selected.entries()) {
      const outputPath = path.resolve(moduleRoot, ...entry.outputPath.split("/"));
      if (existsSync(outputPath)) throw new Error(`Refusing to overwrite alchemy asset: ${entry.outputPath}`);
      const temporary = path.join(workRoot, `${String(index).padStart(2, "0")}.webp`);
      const filter = buildFfmpegFilter({ crop: entry.crop, pad: entry.padding, kind: entry.kind });
      const args = [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", sourcePath,
        "-vf", filter,
        "-frames:v", "1",
        "-c:v", "libwebp",
        "-lossless", "1",
        "-compression_level", "6"
      ];
      if (entry.kind === "topDown") args.push("-pix_fmt", "yuva420p");
      args.push(temporary);
      run("ffmpeg", args, spawnImpl);
      const metadata = inspectProcessedAlchemyImage(temporary, { spawnImpl });
      if (metadata.codec !== "webp" || metadata.width !== 512 || metadata.height !== 512) {
        throw new Error(`${entry.kind}:${entry.productId} output must be a 512x512 WebP`);
      }
      if (entry.kind === "topDown" && metadata.hasAlpha !== true) {
        throw new Error(`${entry.kind}:${entry.productId} output requires alpha`);
      }
      staged.push({ entry, temporary, outputPath, metadata });
    }

    const knownHashes = new Set((manifest.entries ?? [])
      .filter((entry) => entry.status === "accepted" && !selected.includes(entry))
      .map((entry) => clean(entry.assetHash)).filter(Boolean));
    for (const item of staged) {
      if (knownHashes.has(item.metadata.contentHash)) {
        throw new Error(`Duplicate alchemy asset hash: ${item.entry.kind}:${item.entry.productId}`);
      }
      knownHashes.add(item.metadata.contentHash);
    }
    for (const item of staged) {
      mkdirSync(path.dirname(item.outputPath), { recursive: true });
      renameSync(item.temporary, item.outputPath);
    }
    for (const item of staged) {
      Object.assign(item.entry, {
        status: "accepted",
        technicalQa: "passed",
        generationHash,
        assetHash: item.metadata.contentHash
      });
    }
    if (manifestPath) writeManifestAtomic(manifestPath, manifest);
    return { gridId, processed: staged.length, generationHash };
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}
