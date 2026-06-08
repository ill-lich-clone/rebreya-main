import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

function compareVersion(a, b) {
  const left = String(a).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta) {
      return delta;
    }
  }
  return 0;
}

test("module manifest enables the Foundry module socket namespace", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));

  assert.equal(manifest.socket, true);
});

test("module manifest loads a cache-busted entrypoint for the current version", async () => {
  const manifestUrl = new URL("../module.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const scripts = await readdir(new URL("../scripts/", import.meta.url));
  const latestEntrypointVersion = scripts
    .map((fileName) => fileName.match(/^main-(\d+\.\d+\.\d+)\.js$/u)?.[1] ?? "")
    .filter(Boolean)
    .sort(compareVersion)
    .at(-1);
  const expectedEntrypoint = `scripts/main-${manifest.version}.js`;
  const entrypointSource = await readFile(new URL(expectedEntrypoint, manifestUrl), "utf8");

  assert.equal(manifest.version, latestEntrypointVersion);
  assert.deepEqual(manifest.esmodules, [expectedEntrypoint]);
  assert.match(entrypointSource, new RegExp(`\\?v=${manifest.version.replaceAll(".", "\\.")}`, "u"));
});
