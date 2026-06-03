import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("module manifest enables the Foundry module socket namespace", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));

  assert.equal(manifest.socket, true);
});
