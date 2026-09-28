import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildAlchemyImageManifest } from "../tools/alchemy-images/manifest.mjs";
import {
  buildFfmpegFilter,
  computeSquarePad,
  inspectProcessedAlchemyImage,
  processAlchemyGrid
} from "../tools/alchemy-images/processing.mjs";

const products = JSON.parse(await readFile(new URL("../data/alchemy-products.json", import.meta.url), "utf8"));

function generateTransparentGrid(target) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i",
    "color=c=black@0.0:s=1254x1254:d=0.04,format=rgba,drawbox=x=60:y=50:w=100:h=120:color=#d74758@1:t=fill",
    "-frames:v", "1", target
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

test("square padding preserves square, portrait 1:1.2, and landscape 1.2:1 content", () => {
  assert.deepEqual(computeSquarePad({ width: 100, height: 100 }), {
    side: 100, left: 0, top: 0, right: 0, bottom: 0
  });
  assert.deepEqual(computeSquarePad({ width: 100, height: 120 }), {
    side: 120, left: 10, top: 0, right: 10, bottom: 0
  });
  assert.deepEqual(computeSquarePad({ width: 120, height: 100 }), {
    side: 120, left: 0, top: 10, right: 0, bottom: 10
  });
});

test("ffmpeg filter crops, pads, then scales once without unequal-axis distortion", () => {
  const crop = { x: 31, y: 42, width: 100, height: 120 };
  const topDown = buildFfmpegFilter({ crop, kind: "topDown", pad: { mode: "transparent" } });
  const icon = buildFfmpegFilter({ crop, kind: "icon", pad: { mode: "color", color: "#2a1d18" } });

  assert.match(topDown, /^crop=100:120:31:42,format=rgba,pad=120:120:10:0:color=0x00000000,scale=512:512/u);
  assert.match(icon, /^crop=100:120:31:42,pad=120:120:10:0:color=0x2a1d18,scale=512:512/u);
  assert.equal((topDown.match(/scale=/gu) ?? []).length, 1);
  assert.doesNotMatch(topDown, /scale=100:120|scale=120:100/u);
});

test("top-down grid processing emits a verified 512x512 alpha WebP and updates state last", async (t) => {
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "rebreya-alchemy-process-"));
  t.after(() => rm(moduleRoot, { recursive: true, force: true }));
  const sourcePath = path.join(moduleRoot, "grid.png");
  const manifestPath = path.join(moduleRoot, "manifest.json");
  generateTransparentGrid(sourcePath);
  const manifest = buildAlchemyImageManifest(products.slice(0, 1));
  const entry = manifest.entries.find((candidate) => candidate.kind === "topDown");
  Object.assign(entry, {
    status: "processing",
    visualQa: "passed",
    cropReviewed: true,
    crop: { x: 60, y: 50, width: 100, height: 120 }
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const result = processAlchemyGrid({
    manifest,
    products: products.slice(0, 1),
    moduleRoot,
    manifestPath,
    gridId: entry.gridId,
    sourcePath
  });

  assert.equal(result.processed, 1);
  const outputPath = path.join(moduleRoot, ...entry.outputPath.split("/"));
  assert.equal(existsSync(outputPath), true);
  const metadata = inspectProcessedAlchemyImage(outputPath);
  assert.deepEqual({ width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha }, {
    width: 512, height: 512, hasAlpha: true
  });
  const updated = JSON.parse(await readFile(manifestPath, "utf8"));
  const saved = updated.entries.find((candidate) => candidate.kind === "topDown");
  assert.equal(saved.status, "accepted");
  assert.equal(saved.technicalQa, "passed");
  assert.match(saved.generationHash, /^[a-f0-9]{64}$/u);
  assert.match(saved.assetHash, /^[a-f0-9]{64}$/u);
});

test("grid processing refuses an unreviewed crop before creating output", async (t) => {
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "rebreya-alchemy-unreviewed-"));
  t.after(() => rm(moduleRoot, { recursive: true, force: true }));
  const sourcePath = path.join(moduleRoot, "grid.png");
  generateTransparentGrid(sourcePath);
  const manifest = buildAlchemyImageManifest(products.slice(0, 1));
  const entry = manifest.entries.find((candidate) => candidate.kind === "topDown");
  Object.assign(entry, { status: "processing", visualQa: "passed" });
  await mkdir(path.join(moduleRoot, "data"), { recursive: true });

  assert.throws(() => processAlchemyGrid({
    manifest,
    products: products.slice(0, 1),
    moduleRoot,
    gridId: entry.gridId,
    sourcePath
  }), /reviewed crop/i);
  assert.equal(existsSync(path.join(moduleRoot, ...entry.outputPath.split("/"))), false);
});

test("failed ffmpeg output leaves manifest status and hashes untouched", async (t) => {
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "rebreya-alchemy-failed-grid-"));
  t.after(() => rm(moduleRoot, { recursive: true, force: true }));
  const sourcePath = path.join(moduleRoot, "grid.png");
  generateTransparentGrid(sourcePath);
  const manifest = buildAlchemyImageManifest(products.slice(0, 1));
  const entry = manifest.entries.find((candidate) => candidate.kind === "topDown");
  Object.assign(entry, {
    status: "processing",
    visualQa: "passed",
    cropReviewed: true,
    crop: { x: 60, y: 50, width: 100, height: 120 }
  });
  const failingSpawn = (command, args, options) => (
    command === "ffmpeg"
      ? { status: 1, stdout: "", stderr: "synthetic encoding failure" }
      : spawnSync(command, args, options)
  );

  assert.throws(() => processAlchemyGrid({
    manifest,
    products: products.slice(0, 1),
    moduleRoot,
    gridId: entry.gridId,
    sourcePath,
    spawnImpl: failingSpawn
  }), /synthetic encoding failure/i);
  assert.deepEqual({
    status: entry.status,
    technicalQa: entry.technicalQa,
    generationHash: entry.generationHash,
    assetHash: entry.assetHash
  }, {
    status: "processing",
    technicalQa: "pending",
    generationHash: "",
    assetHash: ""
  });
});
