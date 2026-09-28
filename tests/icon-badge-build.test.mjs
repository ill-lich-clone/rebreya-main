import assert from "node:assert/strict";
import { test } from "node:test";

import {
  badgePlacement,
  buildManagedIconProjection,
  prepareCompendiumBadgeImages,
  runBadgeBuild
} from "../scripts/data/icon-badge-build.js";

const manifest = {
  schemaVersion: 1,
  markers: { feats: { path: "default-feats.png" }, gear: { path: "default-gear.png" } },
  targets: [
    { packId: "world.rebreya-feats", documentId: "feat1", badgeId: "feats", sourcePath: "feat1.webp", sourceHash: "a", baselineImg: "old-feat.webp" },
    { packId: "world.rebreya-gear", documentId: "gear1", badgeId: "gear", sourcePath: "gear1.webp", sourceHash: "b", baselineImg: "old-gear.webp" },
    { packId: "world.rebreya-gear", documentId: "gear2", badgeId: "gear", sourcePath: "gear2.webp", sourceHash: "c", baselineImg: "old-gear2.webp" }
  ]
};

function harness({ state = { packs: {} }, markerHashes = { feats: "f1", gear: "g1" }, active = true, failPack = "" } = {}) {
  const uploads = [];
  const saved = [];
  const files = new Set();
  return {
    uploads, saved, files, state, markerHashes,
    run: () => runBadgeBuild({
      manifest,
      state,
      markerHashes,
      isActiveGm: () => active,
      fileExists: async (name) => files.has(name),
      pathForName: (name) => `storage/rebreya-main/${name}`,
      upload: async (target, name) => {
        if (target.packId === failPack) throw new Error("upload failed");
        uploads.push(name);
        files.add(name);
        return `storage/rebreya-main/${name}`;
      },
      saveCheckpoint: async (packId, checkpoint) => {
        state.packs[packId] = checkpoint;
        saved.push(packId);
      }
    })
  };
}

test("badge placement leaves the source size intact and uses the upper-right corner", () => {
  assert.deepEqual(badgePlacement(256), { side: 256, badgeSize: 87, x: 166, y: 3 });
});

test("first build uploads exact document outputs and second build is unchanged", async () => {
  const h = harness();
  const first = await h.run();
  assert.equal(h.uploads.length, 3);
  assert.equal(h.saved.length, 2);
  assert.equal(first.images.size, 3);
  const second = await h.run();
  assert.equal(h.uploads.length, 3);
  assert.equal(h.saved.length, 2);
  assert.equal(second.images.size, 3);
});

test("changing the shared gear badge rebuilds only gear", async () => {
  const h = harness();
  await h.run();
  h.markerHashes.gear = "g2";
  await h.run();
  assert.equal(h.uploads.length, 5);
  assert.deepEqual(h.saved, ["world.rebreya-feats", "world.rebreya-gear", "world.rebreya-gear"]);
});

test("inactive GM performs no upload or checkpoint write", async () => {
  const h = harness({ active: false });
  const result = await h.run();
  assert.equal(h.uploads.length, 0);
  assert.equal(h.saved.length, 0);
  assert.equal(result.images.size, 0);
});

test("failed pack retains its previous complete checkpoint", async () => {
  const h = harness();
  await h.run();
  const old = h.state.packs["world.rebreya-gear"];
  h.markerHashes.gear = "g2";
  const result = await harness({ state: h.state, markerHashes: h.markerHashes, failPack: "world.rebreya-gear" }).run();
  assert.equal(h.state.packs["world.rebreya-gear"], old);
  assert.equal(result.failures.length, 1);
  assert.equal(result.images.get("world.rebreya-gear\0gear1"), old.pathsById.gear1);
});

test("duplicate pack/document identity is rejected before uploads", async () => {
  const h = harness();
  const bad = { ...manifest, targets: [...manifest.targets, manifest.targets[0]] };
  await assert.rejects(() => runBadgeBuild({
    manifest: bad, state: h.state, markerHashes: { feats: "f1", gear: "g1" }, isActiveGm: () => true,
    fileExists: async () => false, pathForName: (name) => name, upload: async () => { throw new Error("should not upload"); },
    saveCheckpoint: async () => {}
  }), /Duplicate badge target/);
});

test("interrupted pack resumes already uploaded images before checkpoint", async () => {
  const state = { packs: {} };
  const files = new Set();
  const uploads = [];
  let fail = true;
  const run = () => runBadgeBuild({
    manifest, state, markerHashes: { feats: "f1", gear: "g1" }, isActiveGm: () => true,
    fileExists: async (name) => files.has(name),
    pathForName: (name) => `storage/rebreya-main/${name}`,
    upload: async (target, name) => {
      if (target.documentId === "gear2" && fail) throw new Error("interrupted");
      uploads.push(target.documentId); files.add(name);
      return `storage/rebreya-main/${name}`;
    },
    saveCheckpoint: async (packId, checkpoint) => { state.packs[packId] = checkpoint; }
  });
  const first = await run();
  assert.equal(first.failures.length, 1);
  assert.equal(state.packs["world.rebreya-gear"], undefined);
  fail = false;
  const second = await run();
  assert.equal(second.failures.length, 0);
  assert.deepEqual(uploads, ["feat1", "gear1", "gear2"]);
  assert.equal(Object.keys(state.packs["world.rebreya-gear"].pathsById).length, 2);
});

test("active GM loss stops remaining uploads and leaves the pack uncommitted", async () => {
  let active = true;
  const uploads = [];
  const result = await runBadgeBuild({
    manifest, state: { packs: {} }, markerHashes: { feats: "f1", gear: "g1" },
    isActiveGm: () => active,
    fileExists: async () => false, pathForName: (name) => name,
    upload: async (target, name) => {
      uploads.push(target.documentId);
      active = false;
      return name;
    },
    saveCheckpoint: async () => { throw new Error("checkpoint must not write"); }
  });
  assert.deepEqual(uploads, ["feat1"]);
  assert.ok(result.failures.length >= 1);
});

test("independent images within a pack upload concurrently with a bounded queue", async () => {
  let activeUploads = 0;
  let peakUploads = 0;
  await runBadgeBuild({
    manifest, state: { packs: {} }, markerHashes: { feats: "f1", gear: "g1" },
    isActiveGm: () => true, fileExists: async () => false, pathForName: (name) => name,
    upload: async (_target, name) => {
      activeUploads += 1;
      peakUploads = Math.max(peakUploads, activeUploads);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeUploads -= 1;
      return name;
    },
    saveCheckpoint: async () => {}
  });
  assert.equal(peakUploads, 2);
});

test("Foundry adapter copies editable markers once and detects a later marker edit", async () => {
  const stored = new Map();
  const writes = [];
  const game = { world: { id: "test-world" }, settings: {
    value: { markers: {}, packs: {} },
    get() { return structuredClone(this.value); },
    async set(_moduleId, _key, value) { this.value = structuredClone(value); writes.push(structuredClone(value)); }
  } };
  const picker = {
    async uploadPersistent(_moduleId, _dir, file) {
      stored.set(file.name, file);
      return { path: `storage/rebreya-main/${file.name}` };
    },
    async browse() {
      return { files: [...stored.keys()].map((name) => `storage/rebreya-main/${name}`) };
    }
  };
  const fetchImpl = async (path) => {
    const name = String(path).split("/").pop();
    const blob = stored.get(name) ?? new Blob([name], { type: "image/png" });
    return new Response(blob, { status: 200 });
  };
  let compositions = 0;
  const options = {
    game, filePicker: picker, manifest, fetchImpl, isActiveGm: () => true,
    compose: async () => { compositions += 1; return new Blob(["compiled"], { type: "image/webp" }); }
  };
  const first = await prepareCompendiumBadgeImages(options);
  assert.equal(first.images.size, 3);
  assert.equal(compositions, 3);
  assert.equal(stored.size, 5);
  await prepareCompendiumBadgeImages(options);
  assert.equal(compositions, 3);
  stored.set(game.settings.value.markers.gear.split("/").pop(), new Blob(["edited marker"], { type: "image/png" }));
  await prepareCompendiumBadgeImages(options);
  assert.equal(compositions, 5);
  assert.ok(writes.length >= 3);
});

test("finished image paths join the manifest by exact pack and document ID", () => {
  const images = new Map([["world.rebreya-gear\0gear2", "storage/rebreya-main/gear2.webp"]]);
  const projection = buildManagedIconProjection(manifest, images);
  assert.equal(projection.size, 1);
  assert.deepEqual(projection.get("world.rebreya-gear\0gear2"), {
    path: "storage/rebreya-main/gear2.webp", baselineImg: "old-gear2.webp"
  });
});
