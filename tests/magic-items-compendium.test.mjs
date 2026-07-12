import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => structuredClone(value),
    escapeHTML: (value) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;")
  }
};

globalThis.CONST ??= {
  DOCUMENT_OWNERSHIP_LEVELS: {
    OBSERVER: 2
  }
};

const magicItemsCompendium = await import("../scripts/data/magic-items-compendium.js");

function makeMagicItem(overrides = {}) {
  return {
    name: "Щит +3",
    type: "Магический предмет",
    rarity: "Легендарный",
    itemType: "Доспех",
    itemSubtype: "Щит",
    itemSlot: "Рука",
    source: "DMG14",
    rank: 10,
    materials: "Труднодоступные",
    bargaining: "Провальные",
    costText: "300000 зм",
    impact: "Мажор",
    attunement: "0",
    isConsumable: false,
    description: "Пока вы держите этот щит, вы получаете бонус к КД.",
    value: 60000,
    ...overrides
  };
}

test("magic item compendium uses fixed costText as native price and keeps estimate in flags", () => {
  assert.equal(typeof magicItemsCompendium.normalizeMagicItems, "function");
  assert.equal(typeof magicItemsCompendium.createMagicItemData, "function");

  const [normalizedItem] = magicItemsCompendium.normalizeMagicItems([makeMagicItem()]);
  const created = magicItemsCompendium.createMagicItemData(normalizedItem, new Map());

  assert.deepEqual(created.system.price, {
    value: 300000,
    denomination: "gp"
  });
  assert.equal(created.flags["rebreya-main"].priceGold, 60000);
  assert.equal(created.flags["rebreya-main"].value, 60000);
  assert.match(created.system.description.value, /Цена:<\/strong>\s*300000 зм/iu);
  assert.match(created.system.description.value, /Оценка:<\/strong>\s*60000 зм/iu);
});

test("magic item compendium shows the item kind without the legacy magic type row", () => {
  const [normalizedItem] = magicItemsCompendium.normalizeMagicItems([
    makeMagicItem({
      name: "Механистический амулет",
      type: "?????????? ???????",
      rarity: "Обычный",
      itemType: "Чудесный предмет",
      itemSubtype: "?",
      itemSlot: "Шея",
      costText: "70 зм",
      value: 70
    })
  ]);
  const created = magicItemsCompendium.createMagicItemData(normalizedItem, new Map());

  assert.equal(normalizedItem.type, "Магический предмет");
  assert.equal(normalizedItem.itemSubtype, "");
  assert.doesNotMatch(created.system.description.value, /<strong>Тип:<\/strong>/iu);
  assert.doesNotMatch(created.system.description.value, /<strong>Подтип:<\/strong>\s*\?/iu);
  assert.match(created.system.description.value, /<strong>Вид предмета:<\/strong>\s*Чудесный предмет/iu);
  assert.doesNotMatch(created.system.description.value, /\?{3,}/u);
});

test("magic item compendium leaves native price empty when costText is a formula", () => {
  const [normalizedItem] = magicItemsCompendium.normalizeMagicItems([
    makeMagicItem({
      name: "Пояс силы облачного великана",
      itemType: "Чудесный предмет",
      itemSubtype: "—",
      itemSlot: "Пояс",
      costText: "(2d8kh1+1)*5000 зм",
      value: 60000
    })
  ]);
  const created = magicItemsCompendium.createMagicItemData(normalizedItem, new Map());

  assert.deepEqual(created.system.price, {
    value: null,
    denomination: "gp"
  });
  assert.equal(created.flags["rebreya-main"].priceGold, 60000);
  assert.equal(created.flags["rebreya-main"].value, 60000);
  assert.match(created.system.description.value, /\(2d8kh1\+1\)\*5000 зм/iu);
  assert.match(created.system.description.value, /Оценка:<\/strong>\s*60000 зм/iu);
});
