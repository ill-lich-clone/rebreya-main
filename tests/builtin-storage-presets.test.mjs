import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import { BUILTIN_STORAGE_PRESETS } from "../scripts/data/builtin-storage-presets.js";

const EXPECTED_PRESETS = [
  ["wood-dark-copper", "Сундук — медные монеты", "wood-dark-copper-open.webp"],
  ["wood-dark-silver", "Сундук — серебряные монеты", "wood-dark-silver-open.webp"],
  ["wood-dark-gold", "Сундук — золотые монеты", "wood-dark-gold-open.webp"]
];

test("built-in storage catalog exposes the three immutable coin presets", () => {
  assert.equal(Object.isFrozen(BUILTIN_STORAGE_PRESETS), true);
  assert.deepEqual(
    BUILTIN_STORAGE_PRESETS.map(({ id, name }) => [id, name]),
    EXPECTED_PRESETS.map(([id, name]) => [id, name])
  );

  for (const [index, preset] of BUILTIN_STORAGE_PRESETS.entries()) {
    assert.equal(Object.isFrozen(preset), true);
    assert.equal(Object.isFrozen(preset.textures), true);
    assert.equal(Object.isFrozen(preset.prototypeToken), true);
    assert.equal(Object.isFrozen(preset.prototypeToken.texture), true);
    assert.match(preset.textures.unopened, /wood-dark-closed\.webp$/u);
    assert.match(preset.textures.opened, new RegExp(`${EXPECTED_PRESETS[index][2]}$`, "u"));
    assert.match(preset.textures.empty, /wood-dark-empty\.webp$/u);
    assert.equal(preset.prototypeToken.name, "Сундук");
    assert.equal(preset.prototypeToken.actorLink, false);
    assert.equal(preset.prototypeToken.texture.src, preset.textures.unopened);
  }
});

test("all built-in storage assets are real WebP files", async () => {
  const paths = new Set(BUILTIN_STORAGE_PRESETS.flatMap(({ textures }) => Object.values(textures)));
  assert.equal(paths.size, 5);

  for (const modulePath of paths) {
    const relativePath = modulePath.replace(/^modules\/rebreya-main\//u, "../");
    const url = new URL(relativePath, import.meta.url);
    await access(url);
    const bytes = await readFile(url);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
  }
});
