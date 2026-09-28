import { MODULE_ID } from "../constants.js";

const PACK_PREFIX = "world.rebreya-";
export const BADGE_BUILD_SETTING = "iconBadgeBuild";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function targetKey(packId, documentId) {
  return `${packId}\0${documentId}`;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function badgePlacement(side) {
  if (!Number.isSafeInteger(side) || side < 32) throw new RangeError("Badge source must be a square image of at least 32 pixels");
  const badgeSize = Math.round(side * 0.34);
  const margin = Math.round(side * 0.012);
  return { side, badgeSize, x: side - badgeSize - margin, y: margin };
}

export function buildManagedIconProjection(manifest, images) {
  const projection = new Map();
  for (const target of manifest?.targets ?? []) {
    const key = targetKey(target.packId, target.documentId);
    const path = images?.get(key);
    if (clean(path)) projection.set(key, { path, baselineImg: target.baselineImg });
  }
  return projection;
}

function validateManifest(manifest, markerHashes) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.targets) || !manifest.markers) {
    throw new TypeError("Invalid icon badge manifest");
  }
  const packs = new Map();
  const seen = new Set();
  for (const target of manifest.targets) {
    const packId = clean(target?.packId);
    const documentId = clean(target?.documentId);
    const badgeId = clean(target?.badgeId);
    if (!packId.startsWith(PACK_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(documentId)
      || !badgeId || !clean(target?.sourcePath) || !clean(target?.sourceHash)
      || !clean(target?.baselineImg) || !clean(markerHashes?.[badgeId])) {
      throw new TypeError(`Invalid badge target: ${packId}/${documentId}`);
    }
    const key = targetKey(packId, documentId);
    if (seen.has(key)) throw new Error(`Duplicate badge target: ${packId}/${documentId}`);
    seen.add(key);
    const entries = packs.get(packId) ?? [];
    entries.push(target);
    packs.set(packId, entries);
  }
  return packs;
}

function addImages(images, packId, checkpoint) {
  for (const [documentId, path] of Object.entries(checkpoint?.pathsById ?? {})) {
    if (clean(path)) images.set(targetKey(packId, documentId), path);
  }
}

/** Build each changed pack completely before publishing its new checkpoint. */
export async function runBadgeBuild({
  manifest,
  state = { packs: {} },
  markerHashes,
  isActiveGm,
  fileExists,
  pathForName,
  upload,
  saveCheckpoint
} = {}) {
  const packs = validateManifest(manifest, markerHashes);
  const images = new Map();
  const failures = [];
  if (!isActiveGm?.()) return { images, failures, skipped: true };
  for (const [packId, targets] of packs) {
    const prior = state?.packs?.[packId] ?? null;
    const sorted = [...targets].sort((a, b) => a.documentId.localeCompare(b.documentId));
    const revision = await sha256(JSON.stringify(sorted.map((target) => [
      target.documentId, target.sourcePath, target.sourceHash, target.badgeId, markerHashes[target.badgeId], 1
    ])));
    const slug = packId.slice("world.".length);
    const names = new Map(sorted.map((target) => [
      target.documentId, `${slug}-${revision.slice(0, 16)}-${target.documentId}.webp`
    ]));
    try {
      const pathsById = {};
      let changed = prior?.fingerprint !== revision;
      let nextIndex = 0;
      let workerError = null;
      const worker = async () => {
        while (nextIndex < sorted.length && !workerError) {
          const target = sorted[nextIndex++];
          try {
            if (!isActiveGm()) throw new Error("Active GM changed during badge build");
            const name = names.get(target.documentId);
            const expectedPath = pathForName(name);
            const exists = await fileExists(name);
            if (prior?.fingerprint === revision
              && prior?.pathsById?.[target.documentId] === expectedPath
              && exists) {
              pathsById[target.documentId] = expectedPath;
              continue;
            }
            changed = true;
            pathsById[target.documentId] = exists ? expectedPath : await upload(target, name);
            if (!clean(pathsById[target.documentId])) throw new Error(`Badge upload returned no path: ${name}`);
          }
          catch (error) {
            workerError ??= error;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, sorted.length) }, () => worker()));
      if (workerError) throw workerError;
      if (changed) {
        if (!isActiveGm()) throw new Error("Active GM changed before badge checkpoint");
        const checkpoint = { fingerprint: revision, pathsById };
        await saveCheckpoint(packId, checkpoint);
        addImages(images, packId, checkpoint);
      }
      else addImages(images, packId, prior);
    }
    catch (error) {
      failures.push({ packId, error });
      addImages(images, packId, prior);
      if (!isActiveGm()) break;
    }
  }
  return { images, failures, skipped: false };
}

async function fetchBlob(fetchImpl, path) {
  const response = await fetchImpl(path, { cache: "no-store" });
  if (!response?.ok) throw new Error(`Failed to load badge asset: ${path} (${response?.status ?? "no response"})`);
  return response.blob();
}

async function hashBlob(blob) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compose on the source's own square canvas and encode an opaque WebP. */
export async function composeBadgeWebp(sourceBlob, badgeBlob) {
  const [base, badge] = await Promise.all([createImageBitmap(sourceBlob), createImageBitmap(badgeBlob)]);
  try {
    if (base.width !== base.height) throw new Error(`Badge source is not square: ${base.width}x${base.height}`);
    const { side, badgeSize, x, y } = badgePlacement(base.width);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("2D canvas is unavailable for icon badges");
    context.fillStyle = "#080a0f";
    context.fillRect(0, 0, side, side);
    context.drawImage(base, 0, 0);
    context.drawImage(badge, x, y, badgeSize, badgeSize);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("WebP badge encoding failed")), "image/webp", 0.92);
    });
  }
  finally {
    base.close?.();
    badge.close?.();
  }
}

/** Initialize user-editable markers, then compile only packs whose inputs changed. */
export async function prepareCompendiumBadgeImages({
  game = globalThis.game,
  filePicker = globalThis.FilePicker,
  manifest,
  fetchImpl = globalThis.fetch,
  isActiveGm,
  compose = composeBadgeWebp
} = {}) {
  if (!isActiveGm?.()) return { images: new Map(), failures: [], skipped: true };
  if (typeof filePicker?.uploadPersistent !== "function" || typeof filePicker?.browse !== "function") {
    throw new TypeError("Foundry FilePicker persistent upload and browse are required");
  }
  const state = structuredClone(game.settings.get(MODULE_ID, BADGE_BUILD_SETTING) ?? {});
  state.markers ??= {};
  state.packs ??= {};
  const markerBlobs = {};
  const markerHashes = {};
  let markerPathsChanged = false;
  for (const [badgeId, definition] of Object.entries(manifest?.markers ?? {})) {
    let path = clean(state.markers[badgeId]);
    try {
      if (!path) {
        if (!isActiveGm()) throw new Error("Active GM changed before marker upload");
        const sourceBlob = await fetchBlob(fetchImpl, definition.path);
        const worldId = clean(game?.world?.id).replace(/[^A-Za-z0-9_-]/g, "-") || "world";
        const file = new File(
          [sourceBlob],
          `badge-${worldId}-${badgeId}-${Date.now().toString(36)}.png`,
          { type: "image/png" }
        );
        const result = await filePicker.uploadPersistent(MODULE_ID, "", file, {}, { notify: false });
        path = clean(result?.path);
        if (!path) throw new Error(`Persistent marker upload returned no path: ${badgeId}`);
        state.markers[badgeId] = path;
        markerPathsChanged = true;
      }
      markerBlobs[badgeId] = await fetchBlob(fetchImpl, path);
      markerHashes[badgeId] = await hashBlob(markerBlobs[badgeId]);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Badge marker unavailable: ${badgeId}`, error);
      markerHashes[badgeId] = "unavailable";
    }
  }
  if (markerPathsChanged && isActiveGm()) await game.settings.set(MODULE_ID, BADGE_BUILD_SETTING, state);
  const firstMarkerPath = Object.values(state.markers).find((path) => clean(path));
  if (!firstMarkerPath) throw new Error("No persistent badge marker path is available");
  const storageRoot = firstMarkerPath.slice(0, firstMarkerPath.lastIndexOf("/"));
  const listed = await filePicker.browse("data", storageRoot);
  const existingNames = new Set((listed?.files ?? []).map((path) => String(path).split("/").pop()));
  return runBadgeBuild({
    manifest,
    state,
    markerHashes,
    isActiveGm,
    fileExists: async (name) => existingNames.has(name),
    pathForName: (name) => `${storageRoot}/${name}`,
    upload: async (target, name) => {
      const badgeBlob = markerBlobs[target.badgeId];
      if (!badgeBlob) throw new Error(`Badge marker is unavailable: ${target.badgeId}`);
      const sourceBlob = await fetchBlob(fetchImpl, target.sourcePath);
      const output = await compose(sourceBlob, badgeBlob);
      const file = new File([output], name, { type: "image/webp" });
      const result = await filePicker.uploadPersistent(MODULE_ID, "", file, {}, { notify: false });
      const path = clean(result?.path);
      if (!path.endsWith(`/${name}`)) throw new Error(`Unexpected badge output path: ${path}`);
      existingNames.add(name);
      return path;
    },
    saveCheckpoint: async (packId, checkpoint) => {
      const nextState = structuredClone(state);
      nextState.packs[packId] = checkpoint;
      await game.settings.set(MODULE_ID, BADGE_BUILD_SETTING, nextState);
      state.packs[packId] = checkpoint;
    }
  });
}
