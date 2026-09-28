import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import { BUILTIN_STORAGE_PRESETS } from "../scripts/data/builtin-storage-presets.js";
import { CHEST_OBJECT_DURABILITY } from "../scripts/data/native-object-durability-service.js";

const EXPECTED_PRESETS = [
  ["wood-dark-copper", "Сундук — медные монеты", "Сундук", ["wood-dark-closed.webp", "wood-dark-copper-open.webp", "wood-dark-empty.webp"]],
  ["wood-dark-silver", "Сундук — серебряные монеты", "Сундук", ["wood-dark-closed.webp", "wood-dark-silver-open.webp", "wood-dark-empty.webp"]],
  ["wood-dark-gold", "Сундук — золотые монеты", "Сундук", ["wood-dark-closed.webp", "wood-dark-gold-open.webp", "wood-dark-empty.webp"]],
  ["barrel", "Бочка", "Бочка", ["barrel-closed.webp", "barrel-open.webp", "barrel-empty.webp"]],
  ["wicker-basket", "Плетёная корзина", "Плетёная корзина", ["wicker-basket-closed.webp", "wicker-basket-open.webp", "wicker-basket-empty.webp"]],
  ["provision-sack", "Мешок припасов", "Мешок припасов", ["provision-sack-closed.webp", "provision-sack-open.webp", "provision-sack-empty.webp"]],
  ["ceramic-storage-jar", "Керамический сосуд", "Керамический сосуд", ["ceramic-storage-jar-closed.webp", "ceramic-storage-jar-open.webp", "ceramic-storage-jar-empty.webp"]],
  ["wardrobe", "Платяной шкаф", "Платяной шкаф", ["wardrobe.webp", "wardrobe.webp", "wardrobe.webp"]],
  ["kitchen-hutch", "Кухонный буфет", "Кухонный буфет", ["kitchen-hutch.webp", "kitchen-hutch.webp", "kitchen-hutch.webp"]],
  ["dresser", "Комод", "Комод", ["dresser.webp", "dresser.webp", "dresser.webp"]],
  ["bedside-cabinet", "Прикроватная тумба", "Прикроватная тумба", ["bedside-cabinet.webp", "bedside-cabinet.webp", "bedside-cabinet.webp"]]
];

test("built-in storage catalog exposes the approved immutable token presets", () => {
  assert.equal(Object.isFrozen(BUILTIN_STORAGE_PRESETS), true);
  assert.deepEqual(
    BUILTIN_STORAGE_PRESETS.map(({ id, name, prototypeToken }) => [id, name, prototypeToken.name]),
    EXPECTED_PRESETS.map(([id, name, tokenName]) => [id, name, tokenName])
  );

  for (const [index, preset] of BUILTIN_STORAGE_PRESETS.entries()) {
    assert.equal(Object.isFrozen(preset), true);
    assert.equal(Object.isFrozen(preset.textures), true);
    assert.equal(Object.isFrozen(preset.prototypeToken), true);
    assert.equal(Object.isFrozen(preset.prototypeToken.texture), true);
    assert.deepEqual(
      Object.values(preset.textures).map((path) => path.split("/").at(-1)),
      EXPECTED_PRESETS[index][3]
    );
    assert.equal(preset.prototypeToken.actorLink, false);
    assert.equal(preset.prototypeToken.texture.src, preset.textures.unopened);
    assert.deepEqual(preset.prototypeToken.objectDurability, CHEST_OBJECT_DURABILITY);
    assert.deepEqual(preset.prototypeToken.delta.system.attributes.hp, { value: 18, max: 18, dt: 0 });
    assert.deepEqual(preset.prototypeToken.delta.system.attributes.ac, { calc: "flat", flat: 15 });
    assert.equal(preset.prototypeToken.bar1.attribute, "attributes.hp");
  }
});

test("all built-in storage assets are real WebP files", async () => {
  const paths = new Set(BUILTIN_STORAGE_PRESETS.flatMap(({ textures }) => Object.values(textures)));
  assert.equal(paths.size, 21);
  assert.equal([...paths].some((path) => /writing-desk|pantry-cupboard|storage-bench|wooden-crate/u.test(path)), false);

  for (const modulePath of paths) {
    const relativePath = modulePath.replace(/^modules\/rebreya-main\//u, "../");
    const url = new URL(relativePath, import.meta.url);
    await access(url);
    const bytes = await readFile(url);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
  }
});
