import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ALCHEMY_CATALOG_PATH,
  serializeAlchemyCatalog,
  writeAlchemyCatalogAtomic
} from "../tools/alchemy-import/serialization.mjs";

test("alchemy serialization is numeric, two-space indented, newline terminated, and stable", () => {
  const products = [
    { id: "alchemy-10", sourceNumber: 10, name: "Ten" },
    { id: "alchemy-2", sourceNumber: 2, name: "Two" }
  ];

  const first = serializeAlchemyCatalog(products);
  const second = serializeAlchemyCatalog(JSON.parse(first));

  assert.equal(first, second);
  assert.ok(first.endsWith("\n"));
  assert.match(first, /\n  \{/u);
  assert.deepEqual(JSON.parse(first).map((product) => product.sourceNumber), [2, 10]);
});

test("atomic catalog write reparses and leaves no temporary file", async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "rebreya-alchemy-write-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const content = serializeAlchemyCatalog([{ id: "alchemy-1", sourceNumber: 1, name: "One" }]);

  await writeAlchemyCatalogAtomic({ cwd, content });

  const target = path.join(cwd, ...ALCHEMY_CATALOG_PATH.split("/"));
  assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), [
    { id: "alchemy-1", sourceNumber: 1, name: "One" }
  ]);
  assert.deepEqual((await fs.readdir(path.dirname(target))).filter((name) => name.endsWith(".tmp")), []);
});
