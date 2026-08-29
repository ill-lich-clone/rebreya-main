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

test("magic item compendium preserves importer IDs as stable document identity", () => {
  const imported = makeMagicItem({
    id: "magic-source-0042",
    name: "Переименованный предмет"
  });
  const [first] = magicItemsCompendium.normalizeMagicItems([imported]);
  const [second] = magicItemsCompendium.normalizeMagicItems([structuredClone(imported)]);
  const firstData = magicItemsCompendium.createMagicItemData(first, new Map());
  const secondData = magicItemsCompendium.createMagicItemData(second, new Map());

  assert.equal(first.id, "magic-source-0042");
  assert.equal(firstData.flags["rebreya-main"].magicItemId, "magic-source-0042");
  assert.equal(secondData.flags["rebreya-main"].magicItemId, firstData.flags["rebreya-main"].magicItemId);
  assert.equal(secondData.flags["rebreya-main"].signature, firstData.flags["rebreya-main"].signature);
  assert.ok(JSON.parse(firstData.flags["rebreya-main"].signature).templateVersion > 4);
});

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
  assert.match(created.system.description.value, /Вэлью:<\/strong>\s*60000 зм/iu);
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

test("magic item compendium renders description before its compact trade metadata", () => {
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
  const descriptionHtml = created.system.description.value;
  assert.ok(descriptionHtml.indexOf("Пока вы держите этот щит") < descriptionHtml.indexOf("Материалы:"));
  assert.ok(descriptionHtml.indexOf("Материалы:") < descriptionHtml.indexOf("Торг:"));
  assert.ok(descriptionHtml.indexOf("Торг:") < descriptionHtml.indexOf("Цена:"));
  assert.ok(descriptionHtml.indexOf("Цена:") < descriptionHtml.indexOf("Вэлью:"));
  assert.ok(descriptionHtml.indexOf("Вэлью:") < descriptionHtml.indexOf("Влиятельность:"));
  for (const label of [
    "Редкость", "Вид предмета", "Подтип", "Слот", "Слоты куклы", "Источник",
    "Ранг", "Настройка", "Тип Foundry", "Подтип Foundry"
  ]) {
    assert.doesNotMatch(descriptionHtml, new RegExp(`<strong>${label}:<\\/strong>`, "u"));
  }
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
  assert.match(created.system.description.value, /Вэлью:<\/strong>\s*60000 зм/iu);
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
  assert.equal(byName.get("Крылатые боеприпасы").isConsumable, false);
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
  assert.equal(nightGoggles.effects[0].changes[0]?.value, "+60");
  assert.equal(nightGoggles.effects[0].changes[0]?.mode, 2);

  const cloakOfProtection = magicItemsCompendium.createMagicItemData(byName.get(cloakName), new Map());
  assert.equal(cloakOfProtection.effects.length, 1);
  assert.deepEqual(cloakOfProtection.effects[0].changes, [{
    key: "system.bonuses.abilities.save",
    mode: 2,
    value: "+2",
    priority: 20
  }]);

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

test("magic item compendium projects the approved passive automation matrix", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const expectedChangesById = new Map([
    ["амулет-благочестия-1", [
      ["system.bonuses.msak.attack", 2, "+1"],
      ["system.bonuses.rsak.attack", 2, "+1"],
      ["system.bonuses.spell.dc", 2, "+1"]
    ]],
    ["барабан-задающего-ритм-1", [
      ["system.bonuses.msak.attack", 2, "+1"],
      ["system.bonuses.rsak.attack", 2, "+1"],
      ["system.bonuses.spell.dc", 2, "+1"]
    ]],
    ["лунный-серп-1", [
      ["system.bonuses.msak.attack", 2, "+1"],
      ["system.bonuses.rsak.attack", 2, "+1"],
      ["system.bonuses.spell.dc", 2, "+1"]
    ]],
    ["универсальный-инструмент-1", [
      ["system.bonuses.msak.attack", 2, "+1"],
      ["system.bonuses.rsak.attack", 2, "+1"],
      ["system.bonuses.spell.dc", 2, "+1"]
    ]],
    ["обруч-заклинателя-2", [
      ["system.skills.arc.bonuses.check", 2, "+2"]
    ]],
    ["пояс-атлета-1", [
      ["system.skills.ath.bonuses.check", 2, "+1"]
    ]],
    ["камень-удачи", [
      ["system.bonuses.abilities.check", 2, "+1"],
      ["system.bonuses.abilities.save", 2, "+1"]
    ]],
    ["пояс-силы-холмового-великана", [
      ["system.abilities.str.value", 2, "+3"],
      ["system.abilities.str.max", 4, "21"]
    ]],
    ["очки-орлиного-зрения", [
      ["flags.midi-qol.advantage.skill.prc", 0, "1"]
    ]]
  ]);
  const normalized = magicItemsCompendium.normalizeMagicItems(
    [...expectedChangesById.keys()].map((id) => sourceById.get(id))
  );

  for (const item of normalized) {
    const created = magicItemsCompendium.createMagicItemData(item, new Map());
    const actual = created.effects.flatMap((effect) => effect.changes)
      .map(({ key, mode, value }) => [key, mode, value]);
    assert.deepEqual(actual, expectedChangesById.get(item.id), item.id);
    assert.equal(created.effects.every((effect) => effect._id.length === 16), true, item.id);
    assert.equal(
      created.effects.every((effect) => effect.flags["rebreya-main"].magicItemAutomation === true),
      true,
      item.id
    );
    assert.equal(created.flags["rebreya-main"].magicItemAutomation.version, 1, item.id);
    const signature = JSON.parse(created.flags["rebreya-main"].signature);
    assert.equal(signature.magicItemAutomation.version, 1, item.id);
    assert.deepEqual(signature.magicItemAutomation.effects, created.effects, item.id);
  }

  const [gloves, lunarSickle] = magicItemsCompendium.normalizeMagicItems([
    sourceById.get("перчатки-двуручного-боя"),
    sourceById.get("лунный-серп-1")
  ]).map((item) => magicItemsCompendium.createMagicItemData(item, new Map()));

  assert.equal(gloves.effects.length, 0);
  assert.equal(
    lunarSickle.effects.some((effect) => effect.changes.some((change) => change.key === "system.bonuses.healing")),
    false
  );
});

test("magic instruments expose independent native cast activities", () => {
  const sourceItems = new Map(MAGIC_ITEMS.map((item) => [item.name, item]));
  const names = ["Бандура Фоклучан", "Лира Кли", "Лютня Досс"];
  const expectedByInstrument = {
    "Бандура Фоклучан": [
      ["Дубинка", 0, "Compendium.dnd5e.spells.Item.VzgFzcmocr1X1cp4"],
      ["Защита от зла и добра", 1, "Compendium.dnd5e.spells.Item.xmDBqZhRVrtLP8h2"],
      ["Левитация", 2, "Compendium.dnd5e.spells.Item.MRxldJd6C4bsBo3O"],
      ["Невидимость", 2, "Compendium.dnd5e.spells.Item.1N8dDMMgZ1h1YJ3B"],
      ["Огонь фей", 1, "Compendium.dnd5e.spells.Item.nqBDWkVOfcGZt4YU"],
      ["Опутывание", 1, "Compendium.dnd5e.spells.Item.gMrWeG8fMDPRFiVe"],
      ["Полёт", 3, "Compendium.dnd5e.spells.Item.yfbK8gZqESlaoY5t"],
      ["Разговор с животными", 1, "Compendium.dnd5e.spells.Item.aL1F8fvYLtNzUbKu"]
    ],
    "Лира Кли": [
      ["Защита от зла и добра", 1, "Compendium.dnd5e.spells.Item.xmDBqZhRVrtLP8h2"],
      ["Изменение формы камня", 4, "Compendium.dnd5e.spells.Item.QvGcdRUSNRKEQJlK"],
      ["Левитация", 2, "Compendium.dnd5e.spells.Item.MRxldJd6C4bsBo3O"],
      ["Невидимость", 2, "Compendium.dnd5e.spells.Item.1N8dDMMgZ1h1YJ3B"],
      ["Огненная стена", 4, "Compendium.dnd5e.spells.Item.X3DrXgxjwI2dvkD6"],
      ["Полёт", 3, "Compendium.dnd5e.spells.Item.yfbK8gZqESlaoY5t"],
      ["Стена ветров", 3, "Compendium.dnd5e.spells.Item.ew6GA8dJy2spQmFW"]
    ],
    "Лютня Досс": [
      ["Дружба с животными", 1, "Compendium.dnd5e.spells.Item.hDOENzjuj5WpLq7B"],
      ["Защита от энергии (только огонь)", 3, "Compendium.dnd5e.spells.Item.j8NtLXOOJ3GAKF8I"],
      ["Защита от яда", 2, "Compendium.dnd5e.spells.Item.MAxM77CDUu8dgIRQ"],
      ["Защита от зла и добра", 1, "Compendium.dnd5e.spells.Item.xmDBqZhRVrtLP8h2"],
      ["Левитация", 2, "Compendium.dnd5e.spells.Item.MRxldJd6C4bsBo3O"],
      ["Невидимость", 2, "Compendium.dnd5e.spells.Item.1N8dDMMgZ1h1YJ3B"],
      ["Полёт", 3, "Compendium.dnd5e.spells.Item.yfbK8gZqESlaoY5t"]
    ]
  };
  const normalized = magicItemsCompendium.normalizeMagicItems(
    names.map((name) => sourceItems.get(name))
  );
  const byName = new Map(normalized.map((item) => [item.name, item]));
  const createdByName = new Map(names.map((name) => [
    name,
    magicItemsCompendium.createMagicItemData(byName.get(name), new Map())
  ]));

  for (const name of names) {
    const created = createdByName.get(name);
    const activities = Object.values(created.system.activities ?? {});
    const expected = expectedByInstrument[name];

    assert.equal(activities.length, expected.length);
    assert.deepEqual(
      activities.map((activity) => [activity.name, activity.spell.level, activity.spell.uuid]),
      expected
    );

    for (const activity of activities) {
      assert.equal(activity.type, "cast");
      assert.deepEqual(activity.activation, { type: "action", value: 1, condition: "" });
      assert.equal(activity.consumption.spellSlot, false);
      assert.deepEqual(activity.consumption.targets, [{ type: "activityUses", value: "1" }]);
      assert.deepEqual(activity.uses, {
        spent: 0,
        max: "1",
        recovery: [{ period: "dawn", type: "recoverAll", formula: "" }]
      });
      assert.equal(activity.spell.ability, "");
      assert.deepEqual(activity.spell.challenge, { override: false });
      assert.deepEqual(activity.spell.properties, ["vocal", "somatic", "material"]);
      assert.equal(activity.spell.spellbook, true);
      assert.equal(activity._id.length, 16);
    }

    assert.deepEqual(
      Object.keys(created.system.activities ?? {}),
      activities.map((activity) => activity._id)
    );
    assert.deepEqual(
      magicItemsCompendium.createMagicItemData(byName.get(name), new Map()).system.activities,
      created.system.activities
    );

    const signature = JSON.parse(created.flags["rebreya-main"].signature);
    assert.equal(signature.nativeInstrumentSpellActivities.version, 1);
    assert.deepEqual(signature.nativeInstrumentSpellActivities.activities, created.system.activities);
  }

  const flyActivityIds = names.map((name) => Object.values(createdByName.get(name).system.activities)
    .find((activity) => activity.spell.uuid === "Compendium.dnd5e.spells.Item.yfbK8gZqESlaoY5t")._id);
  assert.equal(new Set(flyActivityIds).size, 3);

  const [illusionTool] = magicItemsCompendium.normalizeMagicItems([
    sourceItems.get("Инструмент иллюзий")
  ]);
  const illusionToolData = magicItemsCompendium.createMagicItemData(illusionTool, new Map());
  assert.equal(illusionToolData.system.activities, undefined);
  assert.equal(
    Object.hasOwn(JSON.parse(illusionToolData.flags["rebreya-main"].signature), "nativeInstrumentSpellActivities"),
    false
  );
});
