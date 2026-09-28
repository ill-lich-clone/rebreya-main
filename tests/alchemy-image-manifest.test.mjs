import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALCHEMY_GRID_CAPACITY,
  ALCHEMY_GRID_SIZE,
  ALCHEMY_NOMINAL_BOUNDARIES,
  buildAlchemyImageManifest,
  synchronizeAlchemyImageManifest,
  validateAlchemyImageManifest
} from "../tools/alchemy-images/manifest.mjs";

const products = JSON.parse(await readFile(new URL("../data/alchemy-products.json", import.meta.url), "utf8"));

function key(entry) {
  return `${entry.kind}:${entry.productId}`;
}

function reviewedCrop(entry) {
  const column = entry.cellIndex % 5;
  const row = Math.floor(entry.cellIndex / 5);
  return {
    x: ALCHEMY_NOMINAL_BOUNDARIES[column] + 50,
    y: ALCHEMY_NOMINAL_BOUNDARIES[row] + 55,
    width: 100,
    height: 110
  };
}

function writeOpaqueWebp(target) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=#7b2838:s=512x512:d=0.04",
    "-frames:v", "1", "-c:v", "libwebp", "-lossless", "1", target
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

test("canonical manifest assigns two ordered ten-grid 5x5 families", () => {
  const manifest = buildAlchemyImageManifest(products);
  const iconGrids = manifest.grids.filter((grid) => grid.kind === "icon");
  const topDownGrids = manifest.grids.filter((grid) => grid.kind === "topDown");

  assert.equal(ALCHEMY_GRID_SIZE, 1254);
  assert.equal(ALCHEMY_GRID_CAPACITY, 25);
  assert.deepEqual(ALCHEMY_NOMINAL_BOUNDARIES, [0, 251, 502, 752, 1003, 1254]);
  assert.equal(manifest.entries.length, 460);
  assert.equal(new Set(manifest.entries.map(key)).size, 460);
  assert.deepEqual(iconGrids.map((grid) => grid.gridId),
    Array.from({ length: 10 }, (_, index) => `icon-primary-${String(index + 1).padStart(3, "0")}`));
  assert.deepEqual(topDownGrids.map((grid) => grid.gridId),
    Array.from({ length: 10 }, (_, index) => `topdown-primary-${String(index + 1).padStart(3, "0")}`));

  for (const grids of [iconGrids, topDownGrids]) {
    assert.ok(grids.slice(0, 9).every((grid) => grid.cells.every((cell) => typeof cell.entryKey === "string")));
    assert.equal(grids[9].cells.filter((cell) => typeof cell.entryKey === "string").length, 5);
    assert.equal(grids[9].cells.filter((cell) => cell.empty === true).length, 20);
  }
  assert.deepEqual(manifest.entries.slice(0, 3).map((entry) => entry.sourceNumber), [1, 2, 3]);
  assert.deepEqual(manifest.entries.slice(230, 233).map((entry) => entry.sourceNumber), [1, 2, 3]);
  assert.ok(manifest.entries.every((entry) => entry.status === "planned"
    && entry.technicalQa === "pending" && entry.visualQa === "pending"));
  assert.ok(manifest.entries.filter((entry) => entry.kind === "icon")
    .every((entry) => entry.outputPath === products.find((product) => product.id === entry.productId).icon));
  assert.ok(manifest.entries.filter((entry) => entry.kind === "topDown")
    .every((entry) => entry.outputPath === products.find((product) => product.id === entry.productId).topDownImage));
  assert.equal(validateAlchemyImageManifest({ manifest, products, moduleRoot: process.cwd() }), true);
});

test("manifest synchronization preserves reviewed work for unchanged prompts", () => {
  const initial = buildAlchemyImageManifest(products.slice(0, 2));
  Object.assign(initial.entries[0], {
    status: "processing",
    visualQa: "passed",
    cropReviewed: true,
    crop: reviewedCrop(initial.entries[0]),
    generationHash: "a".repeat(64)
  });

  const synchronized = synchronizeAlchemyImageManifest({ manifest: initial, products: products.slice(0, 2) });

  assert.deepEqual({
    status: synchronized.entries[0].status,
    visualQa: synchronized.entries[0].visualQa,
    cropReviewed: synchronized.entries[0].cropReviewed,
    crop: synchronized.entries[0].crop,
    generationHash: synchronized.entries[0].generationHash
  }, {
    status: "processing",
    visualQa: "passed",
    cropReviewed: true,
    crop: reviewedCrop(initial.entries[0]),
    generationHash: "a".repeat(64)
  });
});

test("validation rejects missing, duplicate, and inconsistent assignments", () => {
  const selected = products.slice(0, 2);
  const manifest = buildAlchemyImageManifest(selected);
  const missing = structuredClone(manifest);
  missing.entries.pop();
  assert.throws(() => validateAlchemyImageManifest({ manifest: missing, products: selected, moduleRoot: process.cwd() }), /missing manifest entry/i);

  const duplicate = structuredClone(manifest);
  duplicate.entries[1].gridId = duplicate.entries[0].gridId;
  duplicate.entries[1].cellIndex = duplicate.entries[0].cellIndex;
  assert.throws(() => validateAlchemyImageManifest({ manifest: duplicate, products: selected, moduleRoot: process.cwd() }), /duplicate grid placement/i);

  const brokenCell = structuredClone(manifest);
  brokenCell.grids[0].cells[0] = { cellIndex: 0, empty: true };
  assert.throws(() => validateAlchemyImageManifest({ manifest: brokenCell, products: selected, moduleRoot: process.cwd() }), /grid cell assignment/i);

  const extraGrid = structuredClone(manifest);
  extraGrid.grids.push({
    gridId: "unscoped-grid",
    kind: "icon",
    cells: Array.from({ length: 25 }, (_, cellIndex) => ({ cellIndex, empty: true }))
  });
  assert.throws(() => validateAlchemyImageManifest({ manifest: extraGrid, products: selected, moduleRoot: process.cwd() }), /invalid grid definition/i);
});

test("reviewed crop bounds cannot cross the assigned nominal cell", () => {
  const selected = products.slice(0, 1);
  const manifest = buildAlchemyImageManifest(selected);
  Object.assign(manifest.entries[0], {
    cropReviewed: true,
    crop: { x: 240, y: 40, width: 20, height: 100 }
  });
  assert.throws(() => validateAlchemyImageManifest({ manifest, products: selected, moduleRoot: process.cwd() }), /crosses nominal cell/i);

  const unreviewed = buildAlchemyImageManifest(selected);
  Object.assign(unreviewed.entries[0], { status: "processing", visualQa: "passed" });
  assert.throws(() => validateAlchemyImageManifest({ manifest: unreviewed, products: selected, moduleRoot: process.cwd() }), /reviewed crop/i);
});

test("failed multiple-object visual QA remains repairable but cannot pass production validation", () => {
  const selected = products.slice(0, 1);
  const manifest = buildAlchemyImageManifest(selected);
  Object.assign(manifest.entries[0], {
    status: "rejected",
    visualQa: "failed",
    visualIssue: "multiple-objects"
  });
  assert.equal(validateAlchemyImageManifest({ manifest, products: selected, moduleRoot: process.cwd() }), true);
  assert.throws(() => validateAlchemyImageManifest({ manifest, products: selected, moduleRoot: process.cwd(), requireAccepted: true }), /not accepted/i);
});

test("accepted assets require existing files, current hashes, and unique final bytes", async (t) => {
  const selected = products.slice(0, 2);
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "rebreya-alchemy-manifest-"));
  t.after(() => rm(moduleRoot, { recursive: true, force: true }));
  const manifest = buildAlchemyImageManifest(selected);
  const icons = manifest.entries.filter((entry) => entry.kind === "icon");
  for (const entry of icons) {
    Object.assign(entry, {
      status: "accepted",
      technicalQa: "passed",
      visualQa: "passed",
      cropReviewed: true,
      crop: reviewedCrop(entry),
      generationHash: "a".repeat(64)
    });
  }

  assert.throws(() => validateAlchemyImageManifest({ manifest, products: selected, moduleRoot }), /missing accepted asset/i);

  const firstPath = path.join(moduleRoot, ...icons[0].outputPath.split("/"));
  const secondPath = path.join(moduleRoot, ...icons[1].outputPath.split("/"));
  await mkdir(path.dirname(firstPath), { recursive: true });
  writeOpaqueWebp(firstPath);
  await copyFile(firstPath, secondPath);
  const hash = createHash("sha256").update(await readFile(firstPath)).digest("hex");
  icons[0].assetHash = "0".repeat(64);
  icons[1].assetHash = hash;
  assert.throws(() => validateAlchemyImageManifest({ manifest, products: selected, moduleRoot }), /asset hash mismatch/i);

  icons[0].assetHash = hash;
  assert.throws(() => validateAlchemyImageManifest({ manifest, products: selected, moduleRoot }), /duplicate final hash/i);
});

test("pipeline CLI emits an exact ordered grid prompt and validates planned state", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rebreya-alchemy-plan-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const manifestPath = path.join(tempRoot, "manifest.json");
  await import("node:fs/promises").then(({ writeFile }) => (
    writeFile(manifestPath, `${JSON.stringify(buildAlchemyImageManifest(products), null, 2)}\n`, "utf8")
  ));
  const cliPath = fileURLToPath(new URL("../tools/alchemy-images.mjs", import.meta.url));
  const planned = spawnSync(process.execPath, [
    cliPath, "plan", "--manifest", manifestPath, "--grid-id", "icon-primary-001"
  ], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", windowsHide: true });
  assert.equal(planned.status, 0, planned.stderr);
  const plan = JSON.parse(planned.stdout);
  assert.equal(plan.cells.length, 25);
  assert.match(plan.prompt, /exactly 1254x1254/u);
  assert.match(plan.prompt, /CELL 01 — icon:alchemy-1 — Взрывное зелье/u);
  assert.match(plan.prompt, /CELL 25 — icon:alchemy-25/u);
  assert.match(plan.prompt, /no text, labels, numbers, logos, or watermarks/iu);

  const validated = spawnSync(process.execPath, [
    cliPath, "validate", "--manifest", manifestPath
  ], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", windowsHide: true });
  assert.equal(validated.status, 0, validated.stderr);
  assert.deepEqual(JSON.parse(validated.stdout), { total: 460, accepted: 0, planned: 460, rejected: 0 });
});
