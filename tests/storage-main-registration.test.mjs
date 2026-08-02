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
  assert.match(main, /registerStorageTokenDropHooks\(moduleApi/u);
  assert.match(main, /STORAGE_RESTORE_PORTABLE_COMMAND\s*=\s*"storage\.restore-portable"/u);
  assert.match(main, /register\(STORAGE_RESTORE_PORTABLE_COMMAND,\s*\{/u);
  assert.match(main, /this\.storageCommandService\.restorePortableItem\(payload,\s*\{ sender \}\)/u);
  assert.match(main, /this\.storageContainerItemService = new StorageContainerItemService\(\);/u);
  for (const importPath of [
    "data/storage-service.js?v=1.4.118-nested-storage-containers",
    "data/storage-container-item-service.js?v=1.4.118-nested-storage-containers",
    "data/storage-deposit-source.js?v=1.4.118-nested-storage-containers",
    "data/storage-command-service.js?v=1.4.118-nested-storage-containers",
    "integrations/storage-transfer-drop.js?v=1.4.118-nested-storage-containers",
    "integrations/storage-token-drop.js?v=1.4.118-nested-storage-containers"
  ]) {
    assert.equal(main.includes(importPath), true, importPath);
  }
  assert.equal(manifest.version, "1.4.118");
});

test("storage drop hook registrations have independent error boundaries", async () => {
  const main = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  const transferRegistration = main.indexOf("registerStorageTransferDropHooks(moduleApi");
  const tokenRegistration = main.indexOf("registerStorageTokenDropHooks(moduleApi");
  const transferCatch = main.indexOf("Failed to register storage transfer drop hooks", transferRegistration);

  assert.ok(transferRegistration >= 0);
  assert.ok(tokenRegistration > transferRegistration);
  assert.ok(transferCatch > transferRegistration && transferCatch < tokenRegistration);
});
