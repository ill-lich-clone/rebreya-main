import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  atlasCellGeometry,
  inspectImage,
  processAtlas,
  validateAssetCollection,
  validateProcessedAsset
} from "../tools/top-down-items/image-processing.mjs";

const moduleRoot = new URL("../", import.meta.url);

test("atlas geometry divides a 3000px atlas into fixed 5x5 cells and gutters", () => {
  assert.deepEqual(atlasCellGeometry({ atlasSize: 3000, cellIndex: 0 }), {
    column: 0,
    row: 0,
    x: 0,
    y: 0,
    width: 600,
    height: 600,
    gutter: 48,
    safe: { x: 48, y: 48, width: 504, height: 504 }
  });
  assert.deepEqual(atlasCellGeometry({ atlasSize: 3000, cellIndex: 24 }), {
    column: 4,
    row: 4,
    x: 2400,
    y: 2400,
    width: 600,
    height: 600,
    gutter: 48,
    safe: { x: 2448, y: 2448, width: 504, height: 504 }
  });
  assert.throws(() => atlasCellGeometry({ atlasSize: 3001, cellIndex: 0 }), /divisible by 5/u);
  assert.throws(() => atlasCellGeometry({ atlasSize: 3000, cellIndex: 25 }), /cellIndex/u);
});

test("processed asset validation rejects invalid format, alpha, emptiness, scale, and edge contact", () => {
  const entry = { sourceType: "gear", sourceId: "rapira", scaleClass: "long" };
  const valid = {
    format: "WEBP",
    width: 512,
    height: 512,
    hasAlpha: true,
    visiblePixels: 12000,
    alphaBoundingBox: { x: 40, y: 120, width: 432, height: 70 },
    contentHash: "hash-rapira"
  };
  assert.equal(validateProcessedAsset(valid, entry), true);

  const cases = [
    [{ ...valid, format: "PNG" }, /format must be WEBP/u],
    [{ ...valid, width: 256 }, /dimensions must be 512x512/u],
    [{ ...valid, hasAlpha: false }, /alpha channel/u],
    [{ ...valid, visiblePixels: 0 }, /empty/u],
    [{ ...valid, alphaBoundingBox: { x: 0, y: 120, width: 432, height: 70 } }, /safe edge/u],
    [{ ...valid, alphaBoundingBox: { x: 120, y: 120, width: 200, height: 70 } }, /visual scale/u]
  ];
  for (const [metadata, expected] of cases) {
    assert.throws(() => validateProcessedAsset(metadata, entry), expected);
  }
});

test("asset collection validation rejects duplicate content hashes", () => {
  const metadata = {
    format: "WEBP",
    width: 512,
    height: 512,
    hasAlpha: true,
    visiblePixels: 12000,
    alphaBoundingBox: { x: 64, y: 120, width: 384, height: 70 },
    contentHash: "same-hash"
  };
  assert.throws(() => validateAssetCollection([
    { entry: { sourceType: "gear", sourceId: "one", scaleClass: "standard" }, metadata },
    { entry: { sourceType: "gear", sourceId: "two", scaleClass: "standard" }, metadata }
  ]), /duplicate content hash/u);
});

test("real atlas processing crops fixed cells and writes transparent 512px WebP", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rebreya-topdown-processing-"));
  const outputRoot = join(tempRoot, "module");
  const atlasPath = join(tempRoot, "atlas.png");
  await mkdir(outputRoot, { recursive: true });
  try {
    const generated = spawnSync("magick", [
      "-size", "3000x3000", "xc:#00ff00",
      "-fill", "#7f1d1d", "-draw", "rectangle 100,250 500,350",
      "-fill", "#1d4ed8", "-draw", "ellipse 900,300 180,180 0,360",
      atlasPath
    ], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);

    const entries = [
      {
        sourceType: "gear",
        sourceId: "blade",
        assetPath: "assets/top-down/items/gear/blade.webp",
        atlasId: "primary-001",
        cellIndex: 0,
        scaleClass: "long",
        status: "planned"
      },
      {
        sourceType: "material",
        sourceId: "ore",
        assetPath: "assets/top-down/items/material/ore.webp",
        atlasId: "primary-001",
        cellIndex: 1,
        scaleClass: "standard",
        status: "planned"
      }
    ];
    const results = processAtlas({
      atlasPath,
      atlasId: "primary-001",
      entries,
      moduleRoot: outputRoot,
      chromaColor: "#00ff00"
    });

    assert.equal(results.length, 2);
    for (const result of results) {
      const metadata = inspectImage(result.outputPath);
      assert.equal(metadata.format, "WEBP");
      assert.equal(metadata.width, 512);
      assert.equal(metadata.height, 512);
      assert.equal(metadata.hasAlpha, true);
      assert.ok(metadata.visiblePixels > 0);
      assert.equal(validateProcessedAsset(metadata, result.entry), true);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("pipeline CLI emits a deterministic 25-cell generation plan", () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("tools/top-down-item-assets.mjs", moduleRoot)),
    "plan",
    "--atlas-id", "primary-001"
  ], {
    cwd: new URL(".", moduleRoot),
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.atlasId, "primary-001");
  assert.equal(plan.cells.length, 25);
  assert.deepEqual(plan.cells[0], {
    cellIndex: 0,
    key: "gear:abak",
    name: "Абак",
    visualType: "Снаряжение",
    promptInput: "Абак | Снаряжение | счётное устройство с костяшками, позволяющее быстро производить арифметические расчёты, вести учёт ресурсов, денег или времени."
  });
  assert.match(plan.prompt, /strict orthographic 90-degree overhead/u);
  assert.match(plan.prompt, /CELL 01 — gear:abak — Абак/u);
});

test("pipeline CLI moves rejected cells to a new append-only retry atlas", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rebreya-topdown-retry-"));
  const manifestPath = join(tempRoot, "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(new URL("data/top-down-item-assets.json", moduleRoot), "utf8"));
    const keys = manifest.entries.slice(0, 2).map((entry) => `${entry.sourceType}:${entry.sourceId}`);
    for (const entry of manifest.entries.slice(0, 2)) entry.status = "rejected";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("tools/top-down-item-assets.mjs", moduleRoot)),
      "assign-retry",
      "--manifest", manifestPath,
      "--keys", keys.join(",")
    ], {
      cwd: new URL(".", moduleRoot),
      encoding: "utf8",
      windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr);
    const updated = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.deepEqual(updated.entries.slice(0, 2).map((entry) => ({
      atlasId: entry.atlasId,
      cellIndex: entry.cellIndex,
      status: entry.status,
      technicalQa: entry.technicalQa,
      visualQa: entry.visualQa
    })), [
      { atlasId: "retry-001", cellIndex: 0, status: "planned", technicalQa: "pending", visualQa: "pending" },
      { atlasId: "retry-001", cellIndex: 1, status: "planned", technicalQa: "pending", visualQa: "pending" }
    ]);
    assert.equal(updated.entries[2].atlasId, "primary-001");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
