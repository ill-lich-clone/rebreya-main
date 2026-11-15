import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MAGIC_ITEMS } from "../magicItem.js";
import { MAGIC_ITEM_TOP_DOWN_ASSETS } from "../scripts/data/magic-item-top-down-catalog.js";
import { normalizeMagicItems } from "../scripts/data/magic-items-compendium.js";
import { canonicalCatalogId } from "../scripts/shared/canonical-catalog-id.js";

const assetRoot = new URL("../assets/top-down/items/magic/", import.meta.url);
const expectedNames = MAGIC_ITEMS.map(({ id }) => `${canonicalCatalogId(id)}.png`);

test("every stable magic catalog ID has its own square RGBA scene PNG", () => {
  assert.equal(MAGIC_ITEM_TOP_DOWN_ASSETS.size, MAGIC_ITEMS.length);
  assert.equal(new Set(expectedNames).size, expectedNames.length);
  assert.deepEqual(new Set(MAGIC_ITEM_TOP_DOWN_ASSETS.keys()), new Set(normalizeMagicItems().map(({ id }) => id)));
  assert.deepEqual(readdirSync(assetRoot).sort(), [...expectedNames].sort());

  const seenHashes = new Set();
  for (const [index, item] of MAGIC_ITEMS.entries()) {
    const name = expectedNames[index];
    assert.deepEqual(MAGIC_ITEM_TOP_DOWN_ASSETS.get(item.id), {
      img: `modules/rebreya-main/assets/top-down/items/magic/${name}`,
      visualType: item.itemType === "Доспех" ? "Доспех" : ""
    });
    const png = readFileSync(new URL(name, assetRoot));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", item.id);
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR", item.id);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[25]], [512, 512, 6], item.id);
    const hash = createHash("sha256").update(png).digest("hex");
    assert.ok(!seenHashes.has(hash), `Duplicate artwork for ${item.id}`);
    seenHashes.add(hash);
  }
});

test("magic scene sprites have a visible silhouette and a fully transparent 32px margin", {
  skip: spawnSync("magick", ["-version"], { windowsHide: true }).status !== 0 && "ImageMagick unavailable"
}, () => {
  for (let start = 0; start < expectedNames.length; start += 64) {
    const names = expectedNames.slice(start, start + 64);
    const result = spawnSync("magick", [
      "-limit", "thread", "2", ...names, "-alpha", "extract", "-threshold", "0",
      "-bordercolor", "black", "-border", "1", "-format", "%f|%@|%[fx:mean]\\n", "info:"
    ], { cwd: fileURLToPath(assetRoot), encoding: "utf8", windowsHide: true });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split(/\r?\n/u);
    assert.equal(lines.length, names.length);
    for (const line of lines) {
      const [name, bounds, coverage] = line.split("|");
      const box = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/u.exec(bounds);
      assert.ok(box && Number(coverage) >= 0.01, `Missing silhouette in ${name}`);
      const [width, height, x, y] = box.slice(1).map(Number);
      const margin = Math.min(x - 1, y - 1, 513 - x - width, 513 - y - height);
      assert.ok(margin >= 32, `Only ${margin}px transparent margin in ${name}`);
    }
  }
});
