import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { GENERATED_CATALOG_PATHS } from "./pipeline.mjs";
import { parseCurrentEquipmentBundle } from "./serialization.mjs";

const MANIFEST_NAME = ".equipment-import-transaction.json";
const ALLOWED_PATHS = new Set(Object.values(GENERATED_CATALOG_PATHS));

function asFilesMap(filesByPath) {
  const files = filesByPath instanceof Map ? new Map(filesByPath) : new Map(Object.entries(filesByPath ?? {}));
  const keys = [...files.keys()].sort();
  const expected = [...ALLOWED_PATHS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(`Generated transaction must contain exactly: ${expected.join(", ")}`);
  }
  for (const [relativePath, content] of files) {
    if (!ALLOWED_PATHS.has(relativePath)) throw new Error(`Generated output path is not allowed: ${relativePath}`);
    if (typeof content !== "string") throw new TypeError(`Generated output ${relativePath} must be a UTF-8 string`);
  }
  parseCurrentEquipmentBundle({ filesByPath: files });
  return new Map([...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function ensureInside(root, target, label) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (path.resolve(root) === path.resolve(target) && label === "transaction root") return target;
    throw new Error(`${label} escapes the equipment transaction root`);
  }
  return target;
}

function resolveTarget(root, relativePath) {
  if (!ALLOWED_PATHS.has(relativePath)) throw new Error(`Generated output path is not allowed: ${relativePath}`);
  return ensureInside(root, path.resolve(root, ...relativePath.split("/")), "generated target");
}

async function exists(fsImpl, target) {
  try {
    await fsImpl.access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeDurable(fsImpl, target, content) {
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  if (typeof fsImpl.open !== "function") {
    await fsImpl.writeFile(target, content, "utf8");
    return;
  }
  const handle = await fsImpl.open(target, "w");
  try {
    await handle.writeFile(content, "utf8");
    if (typeof handle.sync === "function") await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeManifest(fsImpl, manifestPath, manifest) {
  await writeDurable(fsImpl, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function validateRecoveryManifest(manifest, root) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.entries)) {
    throw new Error("Equipment transaction manifest is invalid");
  }
  const transactionRoot = ensureInside(root, path.resolve(manifest.transactionRoot), "transaction directory");
  for (const entry of manifest.entries) {
    if (!ALLOWED_PATHS.has(entry.relativePath)) {
      throw new Error(`Recovery manifest contains disallowed target ${entry.relativePath}`);
    }
    const expectedTarget = resolveTarget(root, entry.relativePath);
    if (path.resolve(entry.target) !== expectedTarget) {
      throw new Error(`Recovery target mismatch for ${entry.relativePath}`);
    }
    ensureInside(transactionRoot, path.resolve(entry.backup), "backup path");
  }
  return { ...manifest, transactionRoot };
}

async function restoreManifest({ fsImpl, root, manifestPath, manifest }) {
  const cleanupErrors = [];
  for (const entry of [...manifest.entries].reverse()) {
    try {
      if (entry.originalExists) {
        if (entry.backupReady === false) continue;
        await fsImpl.mkdir(path.dirname(entry.target), { recursive: true });
        await fsImpl.copyFile(entry.backup, entry.target);
      } else {
        await fsImpl.rm(entry.target, { force: true });
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, "Equipment transaction recovery could not restore every original; manifest retained");
  }
  try {
    await fsImpl.rm(manifest.transactionRoot, { recursive: true, force: true });
    await fsImpl.rm(manifestPath, { force: true });
  } catch (error) {
    throw new AggregateError([error], "Equipment transaction originals were restored but cleanup failed");
  }
  return { recovered: true, files: manifest.entries.map((entry) => entry.relativePath).sort() };
}

export async function recoverInterruptedEquipmentTransaction({ fsImpl = fs, tempRoot = process.cwd() } = {}) {
  const root = path.resolve(tempRoot);
  const manifestPath = path.join(root, MANIFEST_NAME);
  let source;
  try {
    source = await fsImpl.readFile(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { recovered: false, files: [] };
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`Equipment transaction manifest is not valid JSON: ${manifestPath}`);
  }
  const manifest = validateRecoveryManifest(parsed, root);
  return restoreManifest({ fsImpl, root, manifestPath, manifest });
}

async function rollbackAfterFailure({ fsImpl, root, manifestPath, manifest, primaryError }) {
  try {
    await restoreManifest({ fsImpl, root, manifestPath, manifest });
  } catch (cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `${primaryError.message}; rollback or cleanup also failed`,
      { cause: primaryError }
    );
  }
  throw primaryError;
}

export async function applyGeneratedFilesTransaction({
  filesByPath,
  fsImpl = fs,
  tempRoot = process.cwd(),
  dryRun = false
}) {
  const files = asFilesMap(filesByPath);
  const root = path.resolve(tempRoot);
  await recoverInterruptedEquipmentTransaction({ fsImpl, tempRoot: root });
  const relativePaths = [...files.keys()];
  if (dryRun) return { applied: false, dryRun: true, files: relativePaths };

  const manifestPath = path.join(root, MANIFEST_NAME);
  if (await exists(fsImpl, manifestPath)) {
    throw new Error("An equipment transaction manifest still exists after recovery");
  }
  await fsImpl.mkdir(root, { recursive: true });
  const transactionRoot = await fsImpl.mkdtemp(path.join(root, ".equipment-import-"));
  ensureInside(root, transactionRoot, "transaction directory");
  const stagedRoot = path.join(transactionRoot, "staged");
  const backupRoot = path.join(transactionRoot, "backup");
  const entries = [];

  try {
    for (const [relativePath, content] of files) {
      const target = resolveTarget(root, relativePath);
      const staged = ensureInside(stagedRoot, path.join(stagedRoot, ...relativePath.split("/")), "staged path");
      const backup = ensureInside(backupRoot, path.join(backupRoot, ...relativePath.split("/")), "backup path");
      await writeDurable(fsImpl, staged, content);
      const stagedContent = await fsImpl.readFile(staged);
      const expectedHash = sha256(Buffer.from(content, "utf8"));
      if (sha256(stagedContent) !== expectedHash) throw new Error(`Staged hash mismatch for ${relativePath}`);
      entries.push({
        relativePath,
        target,
        staged,
        backup,
        originalExists: await exists(fsImpl, target),
        backupReady: false,
        expectedHash,
        replaced: false
      });
    }

    for (const entry of entries) {
      if (!entry.originalExists) continue;
      await fsImpl.mkdir(path.dirname(entry.backup), { recursive: true });
      await fsImpl.copyFile(entry.target, entry.backup);
      entry.backupReady = true;
    }

    const manifest = {
      schemaVersion: 1,
      transactionId: randomUUID(),
      transactionRoot,
      phase: "prepared",
      entries
    };
    await writeManifest(fsImpl, manifestPath, manifest);

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      manifest.phase = "replacing";
      manifest.nextIndex = index;
      await writeManifest(fsImpl, manifestPath, manifest);
      await fsImpl.mkdir(path.dirname(entry.target), { recursive: true });
      await fsImpl.copyFile(entry.staged, entry.target);
      entry.replaced = true;
      manifest.nextIndex = index + 1;
      await writeManifest(fsImpl, manifestPath, manifest);
    }

    manifest.phase = "verifying";
    await writeManifest(fsImpl, manifestPath, manifest);
    for (const entry of entries) {
      const actualHash = sha256(await fsImpl.readFile(entry.target));
      if (actualHash !== entry.expectedHash) throw new Error(`Generated output hash mismatch for ${entry.relativePath}`);
    }

    manifest.phase = "verified";
    await writeManifest(fsImpl, manifestPath, manifest);
    await fsImpl.rm(transactionRoot, { recursive: true, force: true });
    await fsImpl.rm(manifestPath, { force: true });
    return { applied: true, dryRun: false, files: relativePaths };
  } catch (error) {
    const manifest = {
      schemaVersion: 1,
      transactionRoot,
      phase: "rollback",
      entries
    };
    try {
      if (!(await exists(fsImpl, manifestPath))) await writeManifest(fsImpl, manifestPath, manifest);
    } catch (manifestError) {
      throw new AggregateError([error, manifestError], `${error.message}; unable to persist rollback manifest`, { cause: error });
    }
    return rollbackAfterFailure({ fsImpl, root, manifestPath, manifest, primaryError: error });
  }
}
