import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
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
      "-size", "3000x3000", "xc:#18e818",
      "-fill", "#075807", "-draw", "rectangle 0,200 80,400",
      "-fill", "#a06020", "-draw", "rectangle 100,250 500,350",
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
      const spill = spawnSync("magick", [
        result.outputPath,
        "-fx", "a*(g-max(r,b))",
        "-format", "%[fx:maxima]",
        "info:"
      ], { encoding: "utf8", windowsHide: true });
      assert.equal(spill.status, 0, spill.stderr);
      assert.ok(Number(spill.stdout) <= 0.01, `green spill=${spill.stdout}`);
    }
    const retainedGreen = spawnSync("magick", [
      results[0].outputPath,
      "-format", "%[fx:p{256,256}.g]",
      "info:"
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(retainedGreen.status, 0, retainedGreen.stderr);
    assert.ok(Number(retainedGreen.stdout) > 0.25, `object green channel=${retainedGreen.stdout}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("atlas processing leaves no partial production files when a later cell fails", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rebreya-topdown-rollback-"));
  const outputRoot = join(tempRoot, "module");
  const atlasPath = join(tempRoot, "atlas.png");
  const firstOutput = join(outputRoot, "assets/top-down/items/gear/safe.webp");
  await mkdir(outputRoot, { recursive: true });
  try {
    const generated = spawnSync("magick", [
      "-size", "3000x3000", "xc:#00ff00",
      "-fill", "#7f1d1d", "-draw", "rectangle 100,250 500,350",
      "-fill", "#1d4ed8", "-draw", "rectangle 600,250 900,350",
      atlasPath
    ], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);

    assert.throws(() => processAtlas({
      atlasPath,
      atlasId: "primary-001",
      moduleRoot: outputRoot,
      chromaColor: "#00ff00",
      entries: [
        { sourceType: "gear", sourceId: "safe", assetPath: "assets/top-down/items/gear/safe.webp", atlasId: "primary-001", cellIndex: 0, scaleClass: "long" },
        { sourceType: "gear", sourceId: "gutter", assetPath: "assets/top-down/items/gear/gutter.webp", atlasId: "primary-001", cellIndex: 1, scaleClass: "long" }
      ]
    }), /gear:gutter: source bounding box intersects the atlas gutter/u);
    assert.equal(existsSync(firstOutput), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("atlas processing preserves a genuine transparent source without chroma matting", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rebreya-topdown-alpha-"));
  const outputRoot = join(tempRoot, "module");
  const atlasPath = join(tempRoot, "atlas.png");
  try {
    const generated = spawnSync("magick", [
      "-size", "3000x3000", "xc:none",
      "-fill", "rgba(255,0,0,0.005)", "-draw", "rectangle 0,0 20,20",
      "-fill", "#00ff00", "-draw", "rectangle 30,250 530,350",
      atlasPath
    ], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const [result] = processAtlas({
      atlasPath,
      atlasId: "primary-001",
      moduleRoot: outputRoot,
      matteMethod: "alpha",
      entries: [{
        sourceType: "gear",
        sourceId: "alpha-blade",
        assetPath: "assets/top-down/items/gear/alpha-blade.webp",
        atlasId: "primary-001",
        cellIndex: 0,
        scaleClass: "long"
      }]
    });
    assert.equal(result.metadata.hasAlpha, true);
    assert.equal(result.metadata.alphaBoundingBox.width, 432);
    assert.equal(result.metadata.alphaBoundingBox.height, 87);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("pipeline CLI emits a deterministic 25-cell generation plan", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rebreya-topdown-plan-"));
  const manifestPath = join(tempRoot, "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(new URL("data/top-down-item-assets.json", moduleRoot), "utf8"));
    manifest.entries.slice(0, 25).forEach((entry, cellIndex) => {
      entry.atlasId = "primary-001";
      entry.cellIndex = cellIndex;
    });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("tools/top-down-item-assets.mjs", moduleRoot)),
      "plan",
      "--manifest", manifestPath,
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
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("pipeline CLI moves rejected cells to a new append-only retry atlas", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rebreya-topdown-retry-"));
  const manifestPath = join(tempRoot, "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(new URL("data/top-down-item-assets.json", moduleRoot), "utf8"));
    const keys = manifest.entries.slice(0, 2).map((entry) => `${entry.sourceType}:${entry.sourceId}`);
    const untouchedAtlasId = manifest.entries[2].atlasId;
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
    const retryNumbers = manifest.entries
      .map((entry) => /^retry-(\d+)$/u.exec(entry.atlasId)?.[1])
      .filter(Boolean)
      .map(Number);
    const expectedAtlasId = `retry-${String(Math.max(0, ...retryNumbers) + 1).padStart(3, "0")}`;
    assert.deepEqual(updated.entries.slice(0, 2).map((entry) => ({
      atlasId: entry.atlasId,
      cellIndex: entry.cellIndex,
      status: entry.status,
      technicalQa: entry.technicalQa,
      visualQa: entry.visualQa
    })), [
      { atlasId: expectedAtlasId, cellIndex: 0, status: "planned", technicalQa: "pending", visualQa: "pending" },
      { atlasId: expectedAtlasId, cellIndex: 1, status: "planned", technicalQa: "pending", visualQa: "pending" }
    ]);
    assert.equal(updated.entries[2].atlasId, untouchedAtlasId);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("pipeline CLI records visual decisions for explicit entry keys only", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rebreya-topdown-decisions-"));
  const manifestPath = join(tempRoot, "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(new URL("data/top-down-item-assets.json", moduleRoot), "utf8"));
    const [first, second] = manifest.entries;
    for (const entry of [first, second]) {
      entry.status = "processing";
      entry.technicalQa = "passed";
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    for (const [command, key] of [
      ["reject-entries", `${first.sourceType}:${first.sourceId}`],
      ["accept-entries", `${second.sourceType}:${second.sourceId}`]
    ]) {
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL("tools/top-down-item-assets.mjs", moduleRoot)),
        command,
        "--manifest", manifestPath,
        "--keys", key
      ], { cwd: new URL(".", moduleRoot), encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    }
    const updated = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.deepEqual(updated.entries.slice(0, 3).map(({ status, visualQa }) => ({ status, visualQa })), [
      { status: "rejected", visualQa: "failed" },
      { status: "accepted", visualQa: "passed" },
      { status: "planned", visualQa: "pending" }
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("pipeline contact sheet includes only technically processed files", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rebreya-topdown-contact-"));
  const manifestPath = join(tempRoot, "manifest.json");
  const existingPath = join(tempRoot, "existing.webp");
  const outputPath = join(tempRoot, "contact.png");
  try {
    const generated = spawnSync("magick", ["-size", "64x64", "xc:red", existingPath], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const entries = [
      { sourceType: "gear", sourceId: "existing", name: "Existing", assetPath: existingPath, atlasId: "primary-001", cellIndex: 0, status: "processing", technicalQa: "passed" },
      { sourceType: "gear", sourceId: "missing", name: "Missing", assetPath: join(tempRoot, "missing.webp"), atlasId: "primary-001", cellIndex: 1, status: "planned", technicalQa: "pending" }
    ];
    await writeFile(manifestPath, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("tools/top-down-item-assets.mjs", moduleRoot)),
      "contact-sheet",
      "--manifest", manifestPath,
      "--atlas-id", "primary-001",
      "--output", outputPath
    ], { cwd: new URL(".", moduleRoot), encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).entries, 1);
    assert.equal(existsSync(outputPath), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
