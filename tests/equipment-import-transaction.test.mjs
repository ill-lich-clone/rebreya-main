import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyGeneratedFilesTransaction,
  recoverInterruptedEquipmentTransaction
} from "../tools/equipment-import/transactional-writer.mjs";
import { GENERATED_CATALOG_PATHS } from "../tools/equipment-import/pipeline.mjs";

const paths = Object.values(GENERATED_CATALOG_PATHS).sort();

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "rebreya-equipment-transaction-"));
}

async function seed(root, { omit = [] } = {}) {
  for (const relative of paths) {
    if (omit.includes(relative)) continue;
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `old:${relative}\n`, "utf8");
  }
}

function nextFiles() {
  return new Map(paths.map((relative) => [
    relative,
    relative === "magicItem.js"
      ? `export const MAGIC_ITEMS = ${JSON.stringify([{ path: relative }])};\n`
      : `${JSON.stringify([{ path: relative }])}\n`
  ]));
}

async function readState(root) {
  const result = new Map();
  for (const relative of paths) {
    try {
      result.set(relative, await fs.readFile(path.join(root, relative), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      result.set(relative, null);
    }
  }
  return result;
}

test("dry-run validates without calling filesystem mutation methods", async () => {
  const reads = {
    async readFile() { const error = new Error("missing"); error.code = "ENOENT"; throw error; }
  };
  const result = await applyGeneratedFilesTransaction({ filesByPath: nextFiles(), fsImpl: reads, tempRoot: "C:\\fixture", dryRun: true });
  assert.deepEqual(result, { applied: false, dryRun: true, files: paths });
});

test("successful apply replaces every file and removes transaction artifacts", async (t) => {
  const root = await tempRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seed(root);
  const result = await applyGeneratedFilesTransaction({ filesByPath: nextFiles(), fsImpl: fs, tempRoot: root });
  assert.equal(result.applied, true);
  assert.deepEqual(await readState(root), nextFiles());
  assert.equal((await fs.readdir(root)).some((name) => name.startsWith(".equipment-import-")), false);
});

test("failure on the third replacement restores originals byte-for-byte", async (t) => {
  const root = await tempRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seed(root);
  const before = await readState(root);
  let replacements = 0;
  const injected = {
    ...fs,
    async copyFile(source, target, ...args) {
      if (String(source).includes(`${path.sep}staged${path.sep}`)) {
        replacements += 1;
        if (replacements === 3) throw new Error("injected replacement failure");
      }
      return fs.copyFile(source, target, ...args);
    }
  };
  await assert.rejects(
    applyGeneratedFilesTransaction({ filesByPath: nextFiles(), fsImpl: injected, tempRoot: root }),
    /injected replacement failure/u
  );
  assert.deepEqual(await readState(root), before);
});

test("rollback removes a target that did not exist before the transaction", async (t) => {
  const root = await tempRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const missing = paths[0];
  await seed(root, { omit: [missing] });
  let replacements = 0;
  const injected = {
    ...fs,
    async copyFile(source, target, ...args) {
      if (String(source).includes(`${path.sep}staged${path.sep}`) && ++replacements === 3) {
        throw new Error("stop after creating missing target");
      }
      return fs.copyFile(source, target, ...args);
    }
  };
  await assert.rejects(applyGeneratedFilesTransaction({ filesByPath: nextFiles(), fsImpl: injected, tempRoot: root }));
  assert.equal((await readState(root)).get(missing), null);
});

test("post-replacement hash mismatch triggers rollback", async (t) => {
  const root = await tempRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seed(root);
  const before = await readState(root);
  let corrupted = false;
  const injected = {
    ...fs,
    async copyFile(source, target, ...args) {
      await fs.copyFile(source, target, ...args);
      if (!corrupted && String(source).includes(`${path.sep}staged${path.sep}`)) {
        corrupted = true;
        await fs.appendFile(target, "corrupt", "utf8");
      }
    }
  };
  await assert.rejects(
    applyGeneratedFilesTransaction({ filesByPath: nextFiles(), fsImpl: injected, tempRoot: root }),
    /hash mismatch/iu
  );
  assert.deepEqual(await readState(root), before);
});

test("cleanup failure is reported without hiding the primary replacement error", async (t) => {
  const root = await tempRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seed(root);
  let replacements = 0;
  const injected = {
    ...fs,
    async copyFile(source, target, ...args) {
      if (String(source).includes(`${path.sep}staged${path.sep}`) && ++replacements === 3) {
        throw new Error("primary replacement failure");
      }
      return fs.copyFile(source, target, ...args);
    },
    async rm(target, options) {
      if (path.basename(String(target)).startsWith(".equipment-import-") && options?.recursive) {
        throw new Error("cleanup failure");
      }
      return fs.rm(target, options);
    }
  };

  await assert.rejects(
    applyGeneratedFilesTransaction({ filesByPath: nextFiles(), fsImpl: injected, tempRoot: root }),
    (error) => /primary replacement failure/u.test(error.message)
      && error.errors?.some((entry) => /cleanup failed|cleanup failure/iu.test(entry.message))
  );
});

test("interrupted manifest restores originals before a new transaction", async (t) => {
  const root = await tempRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const relative = paths[0];
  const target = path.join(root, relative);
  const transactionRoot = path.join(root, ".equipment-import-interrupted");
  const backup = path.join(transactionRoot, "backup", relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.writeFile(target, "partial-new\n", "utf8");
  await fs.writeFile(backup, "original\n", "utf8");
  await fs.writeFile(path.join(root, ".equipment-import-transaction.json"), JSON.stringify({
    schemaVersion: 1,
    transactionRoot,
    entries: [{ relativePath: relative, target, backup, originalExists: true }]
  }), "utf8");

  const result = await recoverInterruptedEquipmentTransaction({ fsImpl: fs, tempRoot: root });
  assert.equal(result.recovered, true);
  assert.equal(await fs.readFile(target, "utf8"), "original\n");
  await assert.rejects(fs.access(path.join(root, ".equipment-import-transaction.json")));
});
