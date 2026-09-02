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

  assert.equal(TOP_DOWN_MANIFEST_SCHEMA_VERSION, 3);
  assert.equal(TOP_DOWN_ATLAS_CAPACITY, 25);
  assert.equal(entries.length, 1015);
  assert.equal(new Set(keys).size, 1015);
  assert.equal(entries.filter((entry) => entry.sourceType === "gear").length, 745);
  assert.equal(entries.filter((entry) => entry.sourceType === "material").length, 270);
  assert.equal(new Set(entries.map((entry) => entry.atlasId)).size, 41);
  assert.ok(entries.every((entry) => entry.cellIndex >= 0 && entry.cellIndex < 25));
  assert.ok(entries.every((entry) => entry.tokenScale === 1));

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

test("canonical manifest entries use the same normalized IDs as the runtime catalog", () => {
  const entries = buildCanonicalTopDownEntries({
    gear: [{ id: "железный-ключ", name: "Железный ключ" }],
    materials: [
      { id: "material-язык", name: "Язык" },
      { id: "material-белое-сердцецветье", name: "Белое сердцецветье" }
    ]
  });

  assert.deepEqual(entries.map((entry) => ({
    key: topDownEntryKey(entry),
    assetPath: entry.assetPath
  })), [
    {
      key: "gear:zheleznyy-klyuch",
      assetPath: "assets/top-down/items/gear/zheleznyy-klyuch.webp"
    },
    {
      key: "material:material-beloe-serdtsetsvet-e",
      assetPath: "assets/top-down/items/material/material-beloe-serdtsetsvet-e.webp"
    },
    {
      key: "material:material-yazyk",
      assetPath: "assets/top-down/items/material/material-yazyk.webp"
    }
  ]);
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
    matteMethod: "chroma",
    tokenScale: 1.5,
    tokenWidth: 3,
    tokenHeight: 2,
    rotationMode: "cardinal"
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
    matteMethod: preserved.matteMethod,
    tokenScale: preserved.tokenScale,
    tokenWidth: preserved.tokenWidth,
    tokenHeight: preserved.tokenHeight,
    rotationMode: preserved.rotationMode
  }, {
    atlasId: accepted.entries[7].atlasId,
    cellIndex: accepted.entries[7].cellIndex,
    status: "accepted",
    technicalQa: "passed",
    visualQa: "passed",
    generationHash: "generation-7",
    assetHash: "asset-7",
    matteMethod: "chroma",
    tokenScale: 1.5,
    tokenWidth: 3,
    tokenHeight: 2,
    rotationMode: "cardinal"
  });
  assert.equal(synchronized.entries.length, 31);
});

test("manifest synchronization migrates accepted raw Cyrillic IDs without regenerating assets", () => {
  const source = { id: "железный-ключ", name: "Железный ключ" };
  const legacy = {
    schemaVersion: TOP_DOWN_MANIFEST_SCHEMA_VERSION,
    atlas: { columns: 5, rows: 5, capacity: TOP_DOWN_ATLAS_CAPACITY },
    entries: [{
      ...buildCanonicalTopDownEntries({ gear: [{ ...source, id: "zheleznyy-klyuch" }] })[0],
      sourceId: source.id,
      assetPath: `assets/top-down/items/gear/${source.id}.webp`,
      atlasId: "primary-030",
      cellIndex: 7,
      status: "accepted",
      technicalQa: "passed",
      visualQa: "passed",
      generationHash: "generation-key",
      assetHash: "asset-key",
      matteMethod: "alpha"
    }]
  };

  const [entry] = synchronizeTopDownManifest({ manifest: legacy, gear: [source] }).entries;

  assert.deepEqual({
    sourceId: entry.sourceId,
    assetPath: entry.assetPath,
    atlasId: entry.atlasId,
    cellIndex: entry.cellIndex,
    status: entry.status,
    technicalQa: entry.technicalQa,
    visualQa: entry.visualQa,
    generationHash: entry.generationHash,
    assetHash: entry.assetHash,
    matteMethod: entry.matteMethod
  }, {
    sourceId: "zheleznyy-klyuch",
    assetPath: "assets/top-down/items/gear/zheleznyy-klyuch.webp",
    atlasId: "primary-030",
    cellIndex: 7,
    status: "accepted",
    technicalQa: "passed",
    visualQa: "passed",
    generationHash: "generation-key",
    assetHash: "asset-key",
    matteMethod: "alpha"
  });
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

test("manifest validation rejects unsupported runtime texture scales", () => {
  const manifest = synchronizeTopDownManifest({
    manifest: null,
    gear: gear.slice(0, 1),
    materials: []
  });
  manifest.entries[0].tokenScale = 2;

  assert.throws(
    () => validateTopDownManifest({ manifest, gear: gear.slice(0, 1), materials: [] }),
    /invalid tokenScale/u
  );
});

test("manifest validation rejects incomplete or unsupported token footprints", () => {
  const manifest = synchronizeTopDownManifest({
    manifest: null,
    gear: gear.slice(0, 1),
    materials: []
  });

  Object.assign(manifest.entries[0], { tokenWidth: 2, rotationMode: "cardinal" });
  assert.throws(
    () => validateTopDownManifest({ manifest, gear: gear.slice(0, 1), materials: [] }),
    /invalid token footprint/u
  );

  Object.assign(manifest.entries[0], { tokenHeight: 1, rotationMode: "free" });
  assert.throws(
    () => validateTopDownManifest({ manifest, gear: gear.slice(0, 1), materials: [] }),
    /invalid token footprint/u
  );
});

test("checked-in manifest matches the canonical catalogs", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("data/top-down-item-assets.json", moduleRoot),
    "utf8"
  ));

  assert.equal(validateTopDownManifest({ manifest, gear, materials }), true);
  assert.equal(manifest.entries.length, 1015);
  assert.ok(manifest.entries.every((entry) => [1, 1.5].includes(entry.tokenScale)));
  const byKey = new Map(manifest.entries.map((entry) => [topDownEntryKey(entry), entry]));
  assert.equal(byKey.get("gear:revol-ver").tokenScale, 1);
  assert.equal(byKey.get("gear:alebarda").tokenScale, 1.5);
  assert.equal(byKey.get("gear:laty").tokenScale, 1.5);
  assert.deepEqual(
    [...byKey.entries()]
      .filter(([, entry]) => entry.rotationMode === "cardinal")
      .map(([key, entry]) => [key, entry.tokenWidth, entry.tokenHeight]),
    [
      ["gear:korobka-derevyannaya", 1, 1],
      ["gear:krovat", 1, 2],
      ["gear:prilavok", 2, 1],
      ["gear:shkaf", 2, 1],
      ["gear:skamya", 2, 1],
      ["gear:stellazh", 2, 1],
      ["gear:stol-bolshoy", 3, 2],
      ["gear:stol-pismennyy", 2, 1],
      ["gear:stol-prostoy", 2, 2],
      ["gear:stul", 1, 1],
      ["gear:verstak", 2, 1],
      ["gear:yashchik-derevyannyy", 1, 1]
    ]
  );
});
