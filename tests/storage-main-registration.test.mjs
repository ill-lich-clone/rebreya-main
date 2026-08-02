import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("main registers the storage deposit socket API and current cache keys", async () => {
  const main = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));

  assert.match(main, /isValidStorageDepositPayload/u);
  assert.match(main, /STORAGE_DEPOSIT_COMMAND\s*=\s*"storage\.deposit"/u);
  assert.match(main, /register\(STORAGE_DEPOSIT_COMMAND,\s*\{/u);
  assert.match(main, /this\.storageCommandService\.deposit\(payload,\s*\{ sender \}\)/u);
  assert.match(main, /async inspectStorageDepositSource\(/u);
  assert.match(main, /async depositStorageItem\(/u);
  assert.match(main, /1\.4\.117-storage-deposits/u);
  assert.match(main, /storage-deposit-interactions-1/u);
  assert.match(main, /1\.4\.117-storage-deposit-interactions/u);
  assert.equal(manifest.version, "1.4.117");
});
