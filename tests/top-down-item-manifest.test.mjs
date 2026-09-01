import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TOP_DOWN_ATLAS_CAPACITY,
  TOP_DOWN_MANIFEST_SCHEMA_VERSION,
  buildCanonicalTopDownEntries,
  synchronizeTopDownManifest,
  topDownEntryKey,
  validateTopDownManifest
} from "../tools/top-down-items/manifest.mjs";

const moduleRoot = new URL("../", import.meta.url);
const gear = JSON.parse(await readFile(new URL("data/gear.json", moduleRoot), "utf8"));
const materials = JSON.parse(await readFile(new URL("data/materials.json", moduleRoot), "utf8"));

test("canonical manifest entries cover every gear and material ID once", () => {
  const entries = buildCanonicalTopDownEntries({ gear, materials });
  const keys = entries.map(topDownEntryKey);

  assert.equal(TOP_DOWN_MANIFEST_SCHEMA_VERSION, 1);
  assert.equal(TOP_DOWN_ATLAS_CAPACITY, 25);
  assert.equal(entries.length, 1015);
  assert.equal(new Set(keys).size, 1015);
  assert.equal(entries.filter((entry) => entry.sourceType === "gear").length, 745);
  assert.equal(entries.filter((entry) => entry.sourceType === "material").length, 270);
  assert.equal(new Set(entries.map((entry) => entry.atlasId)).size, 41);
  assert.ok(entries.every((entry) => entry.cellIndex >= 0 && entry.cellIndex < 25));

  const rapier = entries.find((entry) => topDownEntryKey(entry) === "gear:rapira");
  assert.deepEqual({
    sourceId: rapier.sourceId,
    assetPath: rapier.assetPath,
    status: rapier.status,
    technicalQa: rapier.technicalQa,
    visualQa: rapier.visualQa
  }, {
    sourceId: "rapira",
    assetPath: "assets/top-down/items/gear/rapira.webp",
    status: "planned",
    technicalQa: "pending",
    visualQa: "pending"
  });
});

test("manifest synchronization preserves accepted work and stable placement", () => {
  const initial = synchronizeTopDownManifest({
    manifest: null,
    gear: gear.slice(0, 30),
    materials: []
  });
  const accepted = structuredClone(initial);
  Object.assign(accepted.entries[7], {
    status: "accepted",
    technicalQa: "passed",
    visualQa: "passed",
    generationHash: "generation-7",
    assetHash: "asset-7",
    matteMethod: "chroma"
  });

  const synchronized = synchronizeTopDownManifest({
    manifest: accepted,
    gear: [...gear.slice(0, 30), gear[30]],
    materials: []
  });
  const preserved = synchronized.entries.find((entry) => (
    topDownEntryKey(entry) === topDownEntryKey(accepted.entries[7])
  ));

  assert.deepEqual({
    atlasId: preserved.atlasId,
    cellIndex: preserved.cellIndex,
    status: preserved.status,
    technicalQa: preserved.technicalQa,
    visualQa: preserved.visualQa,
    generationHash: preserved.generationHash,
    assetHash: preserved.assetHash,
    matteMethod: preserved.matteMethod
  }, {
    atlasId: accepted.entries[7].atlasId,
    cellIndex: accepted.entries[7].cellIndex,
    status: "accepted",
    technicalQa: "passed",
    visualQa: "passed",
    generationHash: "generation-7",
    assetHash: "asset-7",
    matteMethod: "chroma"
  });
  assert.equal(synchronized.entries.length, 31);
});

test("manifest validation rejects missing, unknown, duplicate-key, and duplicate-path entries", () => {
  const manifest = synchronizeTopDownManifest({
    manifest: null,
    gear: gear.slice(0, 3),
    materials: materials.slice(0, 2)
  });

  assert.equal(validateTopDownManifest({
    manifest,
    gear: gear.slice(0, 3),
    materials: materials.slice(0, 2)
  }), true);

  const invalid = structuredClone(manifest);
  invalid.entries.pop();
  invalid.entries.push(structuredClone(invalid.entries[0]));
  invalid.entries.push({
    ...structuredClone(invalid.entries[1]),
    sourceId: "not-canonical",
    assetPath: invalid.entries[2].assetPath
  });

  assert.throws(
    () => validateTopDownManifest({
      manifest: invalid,
      gear: gear.slice(0, 3),
      materials: materials.slice(0, 2)
    }),
    (error) => {
      assert.match(error.message, /duplicate manifest key/u);
      assert.match(error.message, /duplicate asset path/u);
      assert.match(error.message, /unknown manifest key/u);
      assert.match(error.message, /missing manifest key/u);
      return true;
    }
  );
});

test("manifest validation accepts append-only retry atlas assignments", () => {
  const manifest = synchronizeTopDownManifest({
    manifest: null,
    gear: gear.slice(0, 4),
    materials: []
  });
  Object.assign(manifest.entries[2], { atlasId: "retry-001", cellIndex: 0, status: "rejected" });
  Object.assign(manifest.entries[3], { atlasId: "retry-001", cellIndex: 1, status: "rejected" });

  assert.equal(validateTopDownManifest({ manifest, gear: gear.slice(0, 4), materials: [] }), true);
});

test("checked-in manifest matches the canonical catalogs", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("data/top-down-item-assets.json", moduleRoot),
    "utf8"
  ));

  assert.equal(validateTopDownManifest({ manifest, gear, materials }), true);
  assert.equal(manifest.entries.length, 1015);
});
