import test from "node:test";
import assert from "node:assert/strict";

import { MAGIC_ITEMS } from "../magicItem.js";

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

test("magic item compendium keeps named weapon subtypes aligned with their source text", () => {
  const sourceItems = new Map(MAGIC_ITEMS.map((item) => [item.name, item]));
  const normalizedItems = magicItemsCompendium.normalizeMagicItems([
    sourceItems.get("\u0412\u043e\u043b\u043d\u0430"),
    sourceItems.get("\u0426\u0435\u043f \u0422\u0438\u0430\u043c\u0430\u0442"),
  ]);
  const byName = new Map(normalizedItems.map((item) => [item.name, item]));

  const wave = byName.get("\u0412\u043e\u043b\u043d\u0430");
  assert.equal(wave.itemSubtype, "\u0422\u0440\u0435\u0437\u0443\u0431\u0435\u0446");
  const waveData = magicItemsCompendium.createMagicItemData(wave, new Map());
  assert.equal(waveData.type, "weapon");
  assert.equal(waveData.system.type.value, "martialM");
  assert.equal(waveData.system.type.baseItem, "trident");

  const tiamatFlail = byName.get("\u0426\u0435\u043f \u0422\u0438\u0430\u043c\u0430\u0442");
  assert.equal(tiamatFlail.itemSubtype, "\u0426\u0435\u043f");
  const tiamatFlailData = magicItemsCompendium.createMagicItemData(tiamatFlail, new Map());
  assert.equal(tiamatFlailData.type, "weapon");
  assert.equal(tiamatFlailData.system.type.value, "martialM");
  assert.equal(tiamatFlailData.system.type.baseItem, "flail");
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

test("magic item compendium treats subtype-backed staves and ammunition as adaptable base items", () => {
  const sourceItems = new Map(MAGIC_ITEMS.map((item) => [item.name, item]));
  const normalizedItems = magicItemsCompendium.normalizeMagicItems([
    sourceItems.get("Солнечный посох"),
    sourceItems.get("Стрела убийства"),
    sourceItems.get("Крылатые боеприпасы"),
    sourceItems.get("Лунный клинок"),
  ]);
  const byName = new Map(normalizedItems.map((item) => [item.name, item]));

  assert.equal(byName.get("Крылатые боеприпасы").itemType, "Оружие");
  assert.equal(byName.get("Крылатые боеприпасы").itemSubtype, "Боеприпас");
  assert.equal(byName.get("Крылатые боеприпасы").isConsumable, true);
  assert.equal(byName.get("Лунный клинок").itemType, "Оружие");

  const solarStaff = magicItemsCompendium.createMagicItemData(byName.get("Солнечный посох"), new Map());
  assert.equal(solarStaff.type, "weapon");
  assert.equal(solarStaff.system.type.value, "simpleM");
  assert.equal(solarStaff.system.type.baseItem, "quarterstaff");

  const slayingArrow = magicItemsCompendium.createMagicItemData(byName.get("Стрела убийства"), new Map());
  assert.equal(slayingArrow.type, "consumable");
  assert.equal(slayingArrow.system.type.value, "ammo");
  assert.equal(slayingArrow.system.type.subtype, "arrow");

  const wingedAmmo = magicItemsCompendium.createMagicItemData(byName.get("Крылатые боеприпасы"), new Map());
  assert.equal(wingedAmmo.type, "consumable");
  assert.equal(wingedAmmo.system.type.value, "ammo");

  const moonblade = magicItemsCompendium.createMagicItemData(byName.get("Лунный клинок"), new Map());
  assert.equal(moonblade.type, "weapon");
});

test("magic item compendium flags rhythm-maker drums as bardic inspiration restorers", () => {
  const sourceItems = new Map(MAGIC_ITEMS.map((item) => [item.name, item]));
  const normalizedItems = magicItemsCompendium.normalizeMagicItems([
    sourceItems.get("Барабан задающего ритм +2"),
    sourceItems.get("Инструмент иллюзий"),
  ]);
  const byName = new Map(normalizedItems.map((item) => [item.name, item]));

  const drum = magicItemsCompendium.createMagicItemData(byName.get("Барабан задающего ритм +2"), new Map());
  const illusionTool = magicItemsCompendium.createMagicItemData(byName.get("Инструмент иллюзий"), new Map());

  assert.equal(drum.flags["rebreya-main"].restoreBardicInspiration, true);
  assert.equal(illusionTool.flags["rebreya-main"].restoreBardicInspiration, false);
});

test("magic item compendium builds automation for selected magic items", () => {
  const sourceItems = new Map(MAGIC_ITEMS.map((item) => [item.name, item]));
  const nightGogglesName = "\u041D\u043E\u0447\u043D\u044B\u0435 \u043E\u0447\u043A\u0438";
  const cloakName = "\u041F\u043B\u0430\u0449 \u0437\u0430\u0449\u0438\u0442\u044B +2";
  const hoardingPouchName = "\u0421\u0443\u043C\u043A\u0430 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F";
  const pearlName = "\u0416\u0435\u043C\u0447\u0443\u0436\u0438\u043D\u0430 \u0441\u0438\u043B\u044B";
  const watcherShieldName = "\u0429\u0438\u0442 \u0447\u0430\u0441\u043E\u0432\u043E\u0433\u043E";
  const ringCommonName = "\u041A\u043E\u043B\u044C\u0446\u043E \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438 \u043E\u0431\u044B\u0447\u043D\u043E\u0435";
  const ringUncommonName = "\u041A\u043E\u043B\u044C\u0446\u043E \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438 \u043D\u0435\u043E\u0431\u044B\u0447\u043D\u043E\u0435";
  const ringRareName = "\u041A\u043E\u043B\u044C\u0446\u043E \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438 \u0440\u0435\u0434\u043A\u043E\u0435";
  const ringVeryRareName = "\u041A\u043E\u043B\u044C\u0446\u043E \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438 \u043E\u0447\u0435\u043D\u044C \u0440\u0435\u0434\u043A\u043E\u0435";
  const ringLegendaryName = "\u041A\u043E\u043B\u044C\u0446\u043E \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438 \u043B\u0435\u0433\u0435\u043D\u0434\u0430\u0440\u043D\u043E\u0435";
  const normalizedItems = magicItemsCompendium.normalizeMagicItems([
    sourceItems.get(nightGogglesName),
    sourceItems.get(cloakName),
    sourceItems.get(hoardingPouchName),
    sourceItems.get(pearlName),
    sourceItems.get(watcherShieldName),
    sourceItems.get(ringCommonName),
    sourceItems.get(ringUncommonName),
    sourceItems.get(ringRareName),
    sourceItems.get(ringVeryRareName),
    sourceItems.get(ringLegendaryName)
  ]);
  const byName = new Map(normalizedItems.map((item) => [item.name, item]));

  const nightGoggles = magicItemsCompendium.createMagicItemData(byName.get(nightGogglesName), new Map());
  assert.equal(nightGoggles.effects.length, 1);
  assert.equal(nightGoggles.effects[0].changes[0]?.key, "system.attributes.senses.darkvision");
  assert.equal(nightGoggles.effects[0].changes[0]?.value, "60");
  assert.equal(nightGoggles.effects[0].changes[0]?.mode, 4);

  const cloakOfProtection = magicItemsCompendium.createMagicItemData(byName.get(cloakName), new Map());
  assert.equal(cloakOfProtection.effects.length, 1);
  assert.equal(cloakOfProtection.effects[0].changes[0]?.key, "system.attributes.ac.bonus");
  assert.equal(cloakOfProtection.effects[0].changes[0]?.value, "2");
  assert.equal(cloakOfProtection.effects[0].changes[1]?.key, "system.bonuses.abilities.save");
  assert.equal(cloakOfProtection.effects[0].changes[1]?.value, "+2");

  const watcherShield = magicItemsCompendium.createMagicItemData(byName.get(watcherShieldName), new Map());
  assert.equal(watcherShield.effects.length, 1);
  assert.match(watcherShield.effects[0].changes.map((entry) => entry.key).join("|"), /flags\.midi-qol\.advantage\.ability\.check\.dex/u);

  const hoardingPouch = magicItemsCompendium.createMagicItemData(byName.get(hoardingPouchName), new Map());
  assert.equal(hoardingPouch.type, "container");
  assert.equal(hoardingPouch.system.type.value, "backpack");
  assert.deepEqual(hoardingPouch.system.weight, { value: 15, units: "lb" });
  assert.deepEqual(
    [...hoardingPouch.system.properties].sort(),
    ["mgc", "weightlessContents"]
  );
  assert.equal(hoardingPouch.system.capacity?.weight?.value, 500);
  assert.equal(hoardingPouch.system.capacity?.volume?.value, 64);
  assert.equal(hoardingPouch.flags["rebreya-main"].magicItemAutomation?.kind, "bagOfHolding");
  assert.equal(hoardingPouch.flags["rebreya-main"].magicItemAutomation?.capacity?.volume?.value, 64);

  const pearlOfPower = magicItemsCompendium.createMagicItemData(byName.get(pearlName), new Map());
  assert.equal(pearlOfPower.effects.length, 0);
  assert.equal(pearlOfPower.flags["rebreya-main"].magicItemAutomation?.kind, "pearlOfPower");

  const ringVariants = [
    [ringCommonName, 1, 10],
    [ringUncommonName, 2, 12],
    [ringRareName, 1, 16],
    [ringVeryRareName, 2, 20],
    [ringLegendaryName, 2, 26]
  ];

  for (const [ringName, expectedBonus, expectedMaxAbilityScore] of ringVariants) {
    const ring = magicItemsCompendium.createMagicItemData(byName.get(ringName), new Map());
    const automation = ring.flags["rebreya-main"].magicItemAutomation;
    assert.equal(ring.effects.length, 0);
    assert.equal(automation?.kind, "abilityRing");
    assert.equal(automation?.bonus, expectedBonus);
    assert.equal(automation?.maxAbilityScore, expectedMaxAbilityScore);
  }
});
