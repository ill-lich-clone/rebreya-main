import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  parseCurrentEquipmentBundle,
  serializeEquipmentBundle
} from "../tools/equipment-import/serialization.mjs";
import { GENERATED_CATALOG_PATHS } from "../tools/equipment-import/pipeline.mjs";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/equipment-import/complete-bundle.json", import.meta.url),
  "utf8"
));

function reverseObjects(value) {
  if (Array.isArray(value)) return value.map(reverseObjects);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseObjects(child)]));
}

test("bundle serialization is byte-stable across insertion order", () => {
  const first = serializeEquipmentBundle(fixture);
  const reordered = reverseObjects(fixture);
  for (const records of Object.values(reordered.catalogs)) records.reverse();
  const second = serializeEquipmentBundle(reordered);
  assert.deepEqual([...first.keys()], Object.values(GENERATED_CATALOG_PATHS).sort());
  assert.deepEqual(second, first);
  for (const content of first.values()) {
    assert.equal(content.endsWith("\n"), true);
    assert.equal(content.includes("\r\n"), false);
  }
});

test("serialized JSON and magic module parse back without supported-field loss", () => {
  const filesByPath = serializeEquipmentBundle(fixture);
  const parsed = parseCurrentEquipmentBundle({ filesByPath });
  const serializedAgain = serializeEquipmentBundle(parsed);
  assert.deepEqual(serializedAgain, filesByPath);
  assert.equal(parsed.catalogs.magicItems.length, fixture.catalogs.magicItems.length);
});

test("current generated catalogs parse and round-trip semantically", async () => {
  const filesByPath = new Map();
  for (const path of Object.values(GENERATED_CATALOG_PATHS)) {
    filesByPath.set(path, await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
  }
  const parsed = parseCurrentEquipmentBundle({ filesByPath });
  const reparsed = parseCurrentEquipmentBundle({ filesByPath: serializeEquipmentBundle(parsed) });
  assert.deepEqual(reparsed.catalogs, parsed.catalogs);
});

test("serialization rejects unsafe scalar values and absolute paths", () => {
  for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalid = structuredClone(fixture);
    invalid.catalogs.gear[0].unsafe = value;
    assert.throws(() => serializeEquipmentBundle(invalid), /unsupported|finite/iu);
  }
  const absolute = structuredClone(fixture);
  absolute.catalogs.gear[0].image = "C:\\private\\secret.png";
  assert.throws(() => serializeEquipmentBundle(absolute), /absolute path/iu);
});
