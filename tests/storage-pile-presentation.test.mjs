import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  deriveGroundPilePresentation,
  isGroundPileToken,
  STORAGE_PILE_PRESENTATIONS
} from "../scripts/data/storage-pile-presentation.js";

test("ground pile presentation uses the item itself for one visible row", () => {
  assert.deepEqual(deriveGroundPilePresentation([
    { name: "Стрела", img: "icons/arrow.webp", typeLabel: "Боеприпас", quantity: 20 }
  ]), {
    name: "Стрела (20)",
    img: "icons/arrow.webp",
    categoryKey: "single"
  });
  assert.equal(deriveGroundPilePresentation([
    { name: "Меч", img: "icons/sword.webp", typeLabel: "Оружие", quantity: 1 }
  ]).name, "Меч");
});

test("ground pile presentation derives same-category and mixed pile tokens", () => {
  const weapons = deriveGroundPilePresentation([
    { name: "Меч", typeLabel: "Оружие", quantity: 1 },
    { name: "Топор", typeLabel: "Оружие", quantity: 1 }
  ]);
  assert.equal(weapons.name, "Куча оружия");
  assert.equal(weapons.categoryKey, "weapons");
  assert.match(weapons.img, /weapons\.png$/u);

  const mixed = deriveGroundPilePresentation([
    { name: "Меч", typeLabel: "Оружие", quantity: 1 },
    { name: "Зелье", typeLabel: "Зелье", quantity: 1 }
  ]);
  assert.equal(mixed.name, "Куча предметов");
  assert.equal(mixed.categoryKey, "mixed-items");
  assert.match(mixed.img, /mixed-items\.png$/u);
});

test("unknown category labels safely use the mixed pile presentation", () => {
  const result = deriveGroundPilePresentation([
    { name: "Первый", typeLabel: "Неизвестное", quantity: 1 },
    { name: "Второй", typeLabel: "Неизвестное", quantity: 1 }
  ]);
  assert.equal(result.name, "Куча предметов");
  assert.equal(result.categoryKey, "mixed-items");
  assert.ok(STORAGE_PILE_PRESENTATIONS.length >= 14);
});

test("ground pile marker is owned by Rebreya token flags", () => {
  assert.equal(isGroundPileToken({
    flags: { [MODULE_ID]: { groundPile: { enabled: true } } }
  }), true);
  assert.equal(isGroundPileToken({ flags: {} }), false);
});
