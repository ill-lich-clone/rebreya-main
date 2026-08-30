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

test("magic item automation manifest audits every stable catalog row", () => {
  assert.equal(typeof magicItemsCompendium.buildMagicItemAutomationManifest, "function");

  const manifest = magicItemsCompendium.buildMagicItemAutomationManifest();
  assert.equal(manifest.length, MAGIC_ITEMS.length);
  assert.equal(manifest.length, 655);
  assert.equal(new Set(manifest.map((row) => row.id)).size, MAGIC_ITEMS.length);
  assert.deepEqual(
    manifest.map(({ id, name }) => ({ id, name })),
    MAGIC_ITEMS.map(({ id, name }) => ({ id, name }))
  );

  const allowedStatuses = new Set(["full", "partial", "manual", "deferred"]);
  for (const row of manifest) {
    assert.ok(allowedStatuses.has(row.status), `${row.id}:${row.status}`);
    assert.equal(typeof row.existingAutomation, "string", row.id);
    assert.ok(row.existingAutomation.trim(), row.id);
    assert.equal(typeof row.proposedAutomation, "string", row.id);
    assert.ok(row.proposedAutomation.trim(), row.id);
    assert.equal(typeof row.reason, "string", row.id);
    assert.ok(row.reason.trim(), row.id);
  }

  const byId = new Map(manifest.map((row) => [row.id, row]));
  for (const id of ["оружие-1", "оружие-2", "оружие-3", "доспех-1", "доспех-2", "доспех-3", "щит-1", "щит-2", "щит-3"]) {
    assert.equal(byId.get(id).status, "full", id);
    assert.match(byId.get(id).proposedAutomation, /system\.(?:armor\.)?magicalBonus/iu, id);
    assert.match(byId.get(id).reason, /native dnd5e/iu, id);
  }

  assert.equal(byId.get("амулет-благочестия-1").status, "partial");
  assert.match(byId.get("амулет-благочестия-1").existingAutomation, /managed activity/iu);
  assert.equal(byId.get("амулет-естественной-брони-1").status, "partial");
  assert.match(byId.get("амулет-естественной-брони-1").reason, /без доспех/iu);
});

test("annotated common through rare items expose only approved automation", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const create = (id) => {
    const [normalized] = magicItemsCompendium.normalizeMagicItems([sourceById.get(id)]);
    return magicItemsCompendium.createMagicItemData(normalized, new Map());
  };
  const manifest = new Map(magicItemsCompendium.buildMagicItemAutomationManifest()
    .map((row) => [row.id, row]));

  for (const id of [
    "бусина-насыщения",
    "великий-талисман-вражды",
    "великий-талисман-осечки",
    "великий-талисман-преследования",
    "великий-талисман-разрушения",
    "великий-талисман-удачи"
  ]) {
    assert.equal(manifest.get(id).status, "manual", id);
  }

  const lantern = create("вечно-горящий-фонарь");
  const lanternActivities = Object.values(lantern.system.activities);
  assert.deepEqual(lanternActivities.map((activity) => activity.name), [
    "Включить фонарь",
    "Потушить фонарь"
  ]);
  assert.deepEqual(
    lanternActivities.map((activity) => activity.flags["rebreya-main"].magicItemRuntime.action),
    ["token-light-on", "token-light-off"]
  );

  for (const [id, bonus] of [["боеприпас-1", 1], ["боеприпас-2", 2], ["боеприпас-3", 3]]) {
    const ammo = create(id);
    assert.equal(ammo.type, "consumable", id);
    assert.equal(ammo.system.type.value, "ammo", id);
    assert.equal(ammo.system.magicalBonus, bonus, id);
    assert.equal(manifest.get(id).status, "full", id);
  }

  for (const [id, bonus] of [
    ["амулет-естественной-брони-1", 1],
    ["амулет-естественной-брони-2", 2],
    ["амулет-естественной-брони-3", 3]
  ]) {
    const amulet = create(id);
    assert.deepEqual(amulet.effects[0].changes, [{
      key: "system.attributes.ac.bonus",
      mode: 2,
      value: `+${bonus}`,
      priority: 20
    }], id);
    assert.equal(
      amulet.effects[0].flags["rebreya-main"].condition,
      "no-equipped-armor",
      id
    );
    assert.equal(manifest.get(id).status, "partial", id);
  }

  const pearl = create("жемчужина-силы");
  const pearlActivity = Object.values(pearl.system.activities)[0];
  assert.equal(pearlActivity.name, "Восстановить ячейку заклинания");
  assert.equal(pearlActivity.uses.max, "1");
  assert.equal(pearlActivity.uses.recovery[0].period, "dawn");
  assert.equal(pearlActivity.flags["rebreya-main"].magicItemRuntime.action, "restore-spell-slot");
  assert.equal(manifest.get("жемчужина-силы").status, "full");

  for (const [id, bonus] of [
    ["обмотки-безоружного-мастерства-1", 1],
    ["обмотки-безоружного-мастерства-2", 2],
    ["обмотки-безоружного-мастерства-3", 3]
  ]) {
    const wraps = create(id);
    const activity = Object.values(wraps.system.activities)[0];
    assert.equal(activity.type, "attack", id);
    assert.equal(activity.attack.type.classification, "unarmed", id);
    assert.equal(activity.attack.bonus, `+${bonus}`, id);
    assert.equal(activity.damage.parts[0].custom.formula, `1 + @mod + ${bonus}`, id);
    assert.equal(manifest.get(id).status, "partial", id);
  }

  for (const [id, hp] of [
    ["охраняющий-доспех-3", 10],
    ["укрепляющий-доспех-10", 30],
    ["укрепляющий-доспех-20", 50]
  ]) {
    const armor = create(id);
    assert.deepEqual(armor.effects[0].changes.map(({ key, value }) => [key, value]), [
      ["system.attributes.hp.bonuses.overall", `+${hp}`]
    ], id);
    assert.equal(manifest.get(id).status, "partial", id);
  }

  assert.equal(manifest.get("перчатки-двуручного-боя").status, "full");
  assert.match(manifest.get("перчатки-двуручного-боя").reason, /CombatAttackService/iu);

  const medallion = create("медальон-затягивающихся-ран");
  assert.equal(medallion.flags["rebreya-main"].magicItemAutomation.kind, "doubleHitDieHealing");
  assert.equal(manifest.get("медальон-затягивающихся-ран").status, "partial");

  for (const id of ["рунный-ключ-ракдоса", "рунный-ключ-симиков"]) {
    const keyrune = create(id);
    const activity = Object.values(keyrune.system.activities)[0];
    assert.equal(activity.type, "utility", id);
    assert.equal(activity.uses.max, "1", id);
    assert.deepEqual(activity.uses.recovery, [], id);
    assert.equal(manifest.get(id).status, "partial", id);
  }
});

test("remaining uncommon and rare manual candidates expose their unambiguous actions", () => {
  const byId = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const create = (id) => magicItemsCompendium.createMagicItemData(byId.get(id), new Map());
  const manifest = new Map(magicItemsCompendium.buildMagicItemAutomationManifest()
    .map((row) => [row.id, row]));

  const drunkard = Object.values(create("амулет-пьяницы").system.activities)[0];
  assert.equal(drunkard.type, "heal");
  assert.equal(drunkard.healing.custom.formula, "4d4 + 4");
  assert.deepEqual(drunkard.uses, {
    spent: 0,
    max: "1",
    recovery: [{ period: "dawn", type: "recoverAll", formula: "" }]
  });
  assert.equal(manifest.get("амулет-пьяницы").status, "partial");

  const card = Object.values(create("колода-карточного-шулера").system.activities)
    .find((activity) => activity.name === "Смертельная сдача");
  assert.equal(card.type, "attack");
  assert.deepEqual(card.attack, {
    ability: "dex",
    bonus: "",
    critical: { threshold: null },
    flat: false,
    type: { value: "ranged", classification: "spell" }
  });
  assert.equal(card.range.value, 120);
  assert.equal(card.damage.parts[0].custom.formula, "1d8");
  assert.equal(manifest.get("колода-карточного-шулера").status, "partial");

  const bead = Object.values(create("бусина-силы").system.activities)[0];
  assert.equal(bead.type, "save");
  assert.deepEqual(bead.save, { ability: ["dex"], dc: { calculation: "", formula: "15" } });
  assert.equal(bead.damage.parts[0].number, 5);
  assert.equal(bead.damage.parts[0].denomination, 4);
  assert.equal(bead.uses.max, "1");
  assert.deepEqual(bead.uses.recovery, []);

  const bands = Object.values(create("железные-ленты-биларро").system.activities)[0];
  assert.equal(bands.type, "attack");
  assert.equal(bands.attack.ability, "dex");
  assert.equal(bands.range.value, 60);
  assert.equal(bands.uses.max, "1");
  assert.equal(bands.uses.recovery[0].period, "dawn");

  const ram = Object.values(create("кольцо-тарана").system.activities)
    .find((activity) => activity.name === "Таранить существо");
  assert.equal(ram.attack.flat, true);
  assert.equal(ram.attack.bonus, "+7");
  assert.equal(ram.damage.parts[0].custom.formula, "2d10");
  assert.equal(create("кольцо-тарана").system.uses.max, "3");
  assert.equal(create("кольцо-тарана").system.uses.recovery[0].formula, "1d3");

  const bracers = create("наручи-защиты");
  assert.equal(bracers.effects[0].changes[0].key, "system.attributes.ac.bonus");
  assert.equal(bracers.effects[0].changes[0].value, "+2");
  assert.equal(
    bracers.effects[0].flags["rebreya-main"].condition,
    "no-equipped-armor-or-shield"
  );

  for (const id of [
    "алхимический-сборник",
    "архив-астромантии",
    "атлас-бесконечных-горизонтов",
    "гремящий-трактат",
    "двойственная-рукопись",
    "книга-начинающего-сердцееда",
    "кодекс-планолога",
    "сборник-защитных-стихов",
    "фолиант-души-и-плоти"
  ]) {
    const book = create(id);
    assert.equal(book.system.uses.max, "3", id);
    assert.equal(book.system.uses.recovery[0].formula, "1d3", id);
    assert.equal(
      Object.values(book.system.activities).some((activity) => activity.name === "Заменить подготовленное заклинание"),
      true,
      id
    );
    assert.equal(manifest.get(id).status, "partial", id);
  }
});

test("magic item automation gap report groups every rarity and flags manual prose signals", () => {
  assert.equal(typeof magicItemsCompendium.buildMagicItemAutomationGapReport, "function");

  const report = magicItemsCompendium.buildMagicItemAutomationGapReport([
    makeMagicItem({
      id: "оружие-1",
      name: "Оружие +1",
      rarity: "Обычный",
      itemType: "Оружие"
    }),
    makeMagicItem({
      id: "gap-common-spell",
      name: "Заряженный талисман",
      rarity: "Обычный",
      description: "Талисман имеет 3 заряда. Действием вы можете наложить заклинание Свет."
    }),
    makeMagicItem({ id: "щит-1", name: "Щит +1", rarity: "Необычный" }),
    makeMagicItem({ id: "посох-огня", name: "Посох огня", rarity: "Редкий" }),
    makeMagicItem({
      id: "gap-very-rare-action",
      name: "Испытующий знак",
      rarity: "Очень редкий",
      description: "Реакцией заставьте цель совершить спасбросок Мудрости."
    }),
    makeMagicItem({
      id: "gap-legendary-bonus",
      name: "Знак мастерства",
      rarity: "Легендарный",
      description: "Вы получаете бонус +2 к спасброскам и проверкам характеристик."
    }),
    makeMagicItem({
      id: "gap-artifact-traits",
      name: "Око стихий",
      rarity: "Артефакт",
      description: "Вы получаете сопротивление огню, скорость полёта и тёмное зрение."
    }),
    makeMagicItem({
      id: "gap-unclassified",
      name: "Предмет без редкости",
      rarity: "",
      description: "Описание без однозначной механики."
    })
  ]);

  assert.equal(report.total, 8);
  assert.deepEqual(
    report.rarities.map(({ rarity, total, full, partial, manual }) => ({
      rarity,
      total,
      full,
      partial,
      manual
    })),
    [
      { rarity: "Обычный", total: 2, full: 1, partial: 0, manual: 1 },
      { rarity: "Необычный", total: 1, full: 1, partial: 0, manual: 0 },
      { rarity: "Редкий", total: 1, full: 0, partial: 1, manual: 0 },
      { rarity: "Очень редкий", total: 1, full: 0, partial: 0, manual: 1 },
      { rarity: "Легендарный", total: 1, full: 0, partial: 0, manual: 1 },
      { rarity: "Артефакт", total: 1, full: 0, partial: 0, manual: 1 },
      { rarity: "Без редкости", total: 1, full: 0, partial: 0, manual: 1 }
    ]
  );

  const candidates = new Map(report.rarities
    .flatMap((entry) => entry.manualCandidates)
    .map((entry) => [entry.id, entry.signals]));
  assert.deepEqual(candidates.get("gap-common-spell"), ["spells", "resource", "action"]);
  assert.deepEqual(candidates.get("gap-very-rare-action"), ["action"]);
  assert.deepEqual(candidates.get("gap-legendary-bonus"), ["flatBonus"]);
  assert.deepEqual(candidates.get("gap-artifact-traits"), ["traits"]);
  assert.equal(candidates.has("gap-unclassified"), false);
});

test("catalog gap report locks current coverage totals by rarity", () => {
  const report = magicItemsCompendium.buildMagicItemAutomationGapReport();
  assert.equal(report.total, 655);
  assert.deepEqual(
    report.rarities.map(({ rarity, total, full, partial, manual, manualCandidates }) => ({
      rarity,
      total,
      full,
      partial,
      manual,
      candidates: manualCandidates.length
    })),
    [
      { rarity: "Обычный", total: 102, full: 34, partial: 16, manual: 52, candidates: 21 },
      { rarity: "Необычный", total: 165, full: 67, partial: 50, manual: 48, candidates: 33 },
      { rarity: "Редкий", total: 187, full: 63, partial: 61, manual: 63, candidates: 51 },
      { rarity: "Очень редкий", total: 120, full: 34, partial: 42, manual: 44, candidates: 33 },
      { rarity: "Легендарный", total: 79, full: 23, partial: 28, manual: 28, candidates: 27 },
      { rarity: "Артефакт", total: 1, full: 0, partial: 0, manual: 1, candidates: 1 },
      { rarity: "Без редкости", total: 1, full: 0, partial: 0, manual: 1, candidates: 0 }
    ]
  );
});

test("magic item automation manifest preserves exact deferred world-card rulings", () => {
  const deferredRows = magicItemsCompendium.buildMagicItemAutomationManifest([
    { id: "world-special-dagger", name: "Особый Кинжал телепортации" },
    { id: "world-wound-potion", name: "Зелье заживления ран" },
    { id: "world-level-one-potion", name: "Зелье лечения 1-го уровня" }
  ]);

  assert.deepEqual(deferredRows.map(({ name, status }) => ({ name, status })), [
    { name: "Особый Кинжал телепортации", status: "deferred" },
    { name: "Зелье заживления ран", status: "deferred" },
    { name: "Зелье лечения 1-го уровня", status: "deferred" }
  ]);
  for (const row of deferredRows) {
    assert.match(row.reason, /отдельн.*решени/iu, row.name);
  }
});

test("magic item automation manifest distinguishes complete and partial activity coverage", () => {
  const ids = [
    "шлем-понимания-языков",
    "аметистовый-магнетит",
    "посох-огня",
    "печатка-гильдии-груул",
    "печатка-гильдии-иззет"
  ];
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const byId = new Map(magicItemsCompendium.buildMagicItemAutomationManifest(
    ids.map((id) => sourceById.get(id))
  ).map((row) => [row.id, row]));

  assert.equal(byId.get("шлем-понимания-языков").status, "full");
  assert.equal(byId.get("аметистовый-магнетит").status, "partial");
  assert.match(byId.get("аметистовый-магнетит").reason, /остальн|ручн/iu);
  assert.equal(byId.get("посох-огня").status, "partial");
  assert.match(byId.get("посох-огня").reason, /последн.*заряд|уничтож/iu);
  for (const id of ["печатка-гильдии-груул", "печатка-гильдии-иззет"]) {
    assert.equal(byId.get(id).status, "manual", id);
    assert.match(byId.get(id).reason, /отсутств.*установлен.*compendium/iu, id);
  }
});

test("manifest keeps partial coverage when native magical bonus and activities coexist", () => {
  const byId = new Map(magicItemsCompendium.buildMagicItemAutomationManifest()
    .map((row) => [row.id, row]));
  for (const itemId of ["боевая-кирка-камнетворца", "кинжал-яда", "слизь-кирзина"]) {
    assert.equal(byId.get(itemId).status, "partial", itemId);
    assert.match(byId.get(itemId).existingAutomation, /managed activity/iu, itemId);
  }
});

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
  assert.deepEqual(watcherShield.effects[0].changes.map((entry) => entry.key), [
    "system.attributes.init.roll.mode",
    "system.skills.prc.roll.mode"
  ]);

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
    assert.equal(created.flags["rebreya-main"].magicItemAutomation.version, 4, item.id);
    const signature = JSON.parse(created.flags["rebreya-main"].signature);
    assert.equal(signature.magicItemAutomation.version, 4, item.id);
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
  assert.equal(lunarSickle.system.magicalBonus, 1);
});

test("magic item compendium projects every flat skill bonus family", () => {
  const families = new Map([
    ["амулет-натуралиста", "nat"],
    ["брошь-дипломата", "per"],
    ["линзы-сыщика", "inv"],
    ["маска-лжеца", "dec"],
    ["медальон-религиозности", "rel"],
    ["обруч-заклинателя", "arc"],
    ["очки-летописца", "his"],
    ["очки-наблюдателя", "prc"],
    ["очки-проницательности", "ins"],
    ["перчатки-виртуоза", "prf"],
    ["перчатки-лекаря", "med"],
    ["перчатки-ловкача", "slt"],
    ["перчатки-укротителя", "ani"],
    ["плащ-лазутчика", "ste"],
    ["пояс-атлета", "ath"],
    ["сапоги-акробата", "acr"],
    ["сапоги-следопыта", "sur"],
    ["угрожающий-амулет", "itm"]
  ]);
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));

  for (const [family, skillId] of families) {
    for (const bonus of [1, 2, 3]) {
      const itemId = `${family}-${bonus}`;
      const [normalized] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
      const created = magicItemsCompendium.createMagicItemData(normalized, new Map());
      assert.deepEqual(created.effects[0]?.changes, [{
        key: `system.skills.${skillId}.bonuses.check`,
        mode: 2,
        value: `+${bonus}`,
        priority: 20
      }], itemId);
    }
  }
});

test("magic item compendium uses native magical bonuses without duplicate effects", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const cases = [
    ["оружие-1", "system.magicalBonus", 1],
    ["оружие-2", "system.magicalBonus", 2],
    ["оружие-3", "system.magicalBonus", 3],
    ["доспех-1", "system.armor.magicalBonus", 1],
    ["доспех-2", "system.armor.magicalBonus", 2],
    ["доспех-3", "system.armor.magicalBonus", 3],
    ["щит-1", "system.armor.magicalBonus", 1],
    ["щит-2", "system.armor.magicalBonus", 2],
    ["щит-3", "system.armor.magicalBonus", 3],
    ["кинжал-яда", "system.magicalBonus", 1],
    ["дварфийский-метатель", "system.magicalBonus", 3],
    ["демонический-доспех", "system.armor.magicalBonus", 1],
    ["щит-черепахи", "system.armor.magicalBonus", 1],
    ["боевая-кирка-камнетворца", "system.magicalBonus", 1],
    ["булава-кары", "system.magicalBonus", 1],
    ["волна", "system.magicalBonus", 3],
    ["вор-девяти-жизней", "system.magicalBonus", 2],
    ["двуручный-серебряный-меч", "system.magicalBonus", 3],
    ["длинный-лук-исцеляющего-очага", "system.magicalBonus", 3],
    ["доспех-из-драконьей-чешуи", "system.armor.magicalBonus", 1],
    ["доспех-истовости-3", "system.armor.magicalBonus", 1],
    ["доспех-последней-битвы", "system.armor.magicalBonus", 1],
    ["драконье-копье", "system.magicalBonus", 3],
    ["живой-доспех", "system.armor.magicalBonus", 1],
    ["защитник", "system.magicalBonus", 3],
    ["зловещий-коготь", "system.magicalBonus", 1],
    ["игла-починки", "system.magicalBonus", 1],
    ["клинок-ахерона", "system.magicalBonus", 1],
    ["клинок-удачи", "system.magicalBonus", 1],
    ["кольчуга-ифритов", "system.armor.magicalBonus", 3],
    ["красивый-проклепанный-кожаный-доспех", "system.armor.magicalBonus", 1],
    ["крик-жнеца", "system.magicalBonus", 2],
    ["кровавый-топор", "system.magicalBonus", 2],
    ["латы-дварфов", "system.armor.magicalBonus", 2],
    ["ледяной-кинжал", "system.magicalBonus", 2],
    ["меч-головоруб", "system.magicalBonus", 3],
    ["меч-мести", "system.magicalBonus", 1],
    ["меч-ответа", "system.magicalBonus", 3],
    ["меч-отцов", "system.magicalBonus", 1],
    ["меч-плановых-измерений", "system.magicalBonus", 3],
    ["молот-грома", "system.magicalBonus", 1],
    ["молот-рунного-фокуса", "system.magicalBonus", 3],
    ["оружие-драконьего-гнева-восходящий", "system.magicalBonus", 1],
    ["оружие-драконьего-гнева-пробуждающийся", "system.magicalBonus", 1],
    ["оружие-драконьего-гнева-пробужденный", "system.magicalBonus", 1],
    ["оружие-повеления-трона", "system.magicalBonus", 1],
    ["оружие-разрушения-силы", "system.magicalBonus", 2],
    ["охраняющий-доспех-1", "system.armor.magicalBonus", 2],
    ["охраняющий-доспех-2", "system.armor.magicalBonus", 3],
    ["последний-рассвет", "system.magicalBonus", 2],
    ["праща-двух-зайцев", "system.magicalBonus", 1],
    ["разрушающий-цеп", "system.magicalBonus", 1],
    ["ритуальный-нож-ракдосов", "system.magicalBonus", 1],
    ["сверкающий-лунный-лук", "system.magicalBonus", 1],
    ["святой-мститель", "system.magicalBonus", 3],
    ["секира-кровавой-ярости", "system.magicalBonus", 2],
    ["сокрушитель", "system.magicalBonus", 3],
    ["солнечный-молот", "system.magicalBonus", 2],
    ["таранный-щит", "system.armor.magicalBonus", 1],
    ["топор-берсерка", "system.magicalBonus", 1],
    ["трезубец-зова-приливов", "system.magicalBonus", 2],
    ["убийца-великанов", "system.magicalBonus", 1],
    ["убийца-драконов", "system.magicalBonus", 1],
    ["убийца-мертвецов", "system.magicalBonus", 1],
    ["хватающий-кнут", "system.magicalBonus", 1],
    ["цеп-тиамат", "system.magicalBonus", 3],
    ["черный-клинок", "system.magicalBonus", 3],
    ["эльфийская-кольчуга", "system.armor.magicalBonus", 1],
    ["эльфийский-метатель", "system.magicalBonus", 3],
    ["посох-грома-и-молнии", "system.magicalBonus", 2],
    ["посох-корневых-холмов", "system.magicalBonus", 1],
    ["посох-леса", "system.magicalBonus", 2],
    ["посох-магов", "system.magicalBonus", 2],
    ["посох-силы", "system.magicalBonus", 2],
    ["посох-ударов", "system.magicalBonus", 3],
    ["солнечный-посох", "system.magicalBonus", 1],
    ["непенте", "system.magicalBonus", 3],
    ["лунный-серп-1", "system.magicalBonus", 1],
    ["лунный-серп-2", "system.magicalBonus", 2],
    ["лунный-серп-3", "system.magicalBonus", 3]
  ];

  for (const [itemId, path, expected] of cases) {
    const [normalized] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(normalized, new Map());
    const actual = path.split(".").slice(1).reduce((value, key) => value?.[key], created.system);
    assert.equal(actual, expected, itemId);
    assert.equal(created.effects.some((effect) => effect.changes.some((change) => (
      change.key === "system.bonuses.mwak.attack"
      || change.key === "system.bonuses.mwak.damage"
      || change.key === "system.attributes.ac.bonus"
    ))), false, itemId);
  }
});

test("magic item compendium projects only unconditional flat spellcasting bonuses", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));

  for (const bonus of [1, 2, 3]) {
    const itemId = `волшебная-палочка-боевого-мага-${bonus}`;
    const [normalized] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(normalized, new Map());
    assert.deepEqual(created.effects[0]?.changes.map(({ key, value }) => [key, value]), [
      ["system.bonuses.msak.attack", `+${bonus}`],
      ["system.bonuses.rsak.attack", `+${bonus}`]
    ], itemId);
  }

  for (const family of [
    "амулет-благочестия",
    "барабан-задающего-ритм",
    "лунный-серп",
    "универсальный-инструмент",
    "жезл-хранителя-договора"
  ]) {
    for (const bonus of [1, 2, 3]) {
      const itemId = `${family}-${bonus}`;
      const [normalized] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
      const created = magicItemsCompendium.createMagicItemData(normalized, new Map());
      assert.equal(created.effects.some((effect) => effect.changes.some(({ key }) => (
        key === "system.bonuses.msak.attack"
        || key === "system.bonuses.rsak.attack"
        || key === "system.bonuses.spell.dc"
      ))), false, itemId);
    }
  }
});

test("magic item compendium projects representative core dnd5e passive paths", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const expected = new Map([
    ["амулет-здоровья", [
      ["system.abilities.con.value", 2, "+4"],
      ["system.abilities.con.max", 4, "19"]
    ]],
    ["сапоги-странника", [
      ["system.attributes.movement.walk", 2, "+10"],
      ["system.skills.sur.roll.mode", 2, "1"]
    ]],
    ["брошь-защиты", [
      ["system.traits.dr.value", 2, "force"]
    ]],
    ["татуировка-с-клеймом-царства-теней", [
      ["system.attributes.senses.darkvision", 4, "60"],
      ["system.skills.ste.roll.mode", 2, "1"]
    ]],
    ["жезл-бдительности", [
      ["system.attributes.init.roll.mode", 2, "1"],
      ["system.skills.prc.roll.mode", 2, "1"]
    ]],
    ["щит-часового", [
      ["system.attributes.init.roll.mode", 2, "1"],
      ["system.skills.prc.roll.mode", 2, "1"]
    ]]
  ]);

  for (const [itemId, changes] of expected) {
    const [normalized] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(normalized, new Map());
    assert.deepEqual(created.effects[0]?.changes.map((change) => [
      change.key,
      change.mode,
      change.value
    ]), changes, itemId);
  }
});

test("gap-scan flat AC and spell-attack rows receive only their unconditional bonuses", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  for (const bonus of [1, 2, 3]) {
    const itemId = `кольцо-защиты-${bonus}`;
    const [item] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(item, new Map());
    assert.deepEqual(created.effects[0]?.changes.map(({ key, mode, value }) => [key, mode, value]), [
      ["system.attributes.ac.bonus", 2, `+${bonus}`]
    ], itemId);
  }

  const nativeCases = [
    ["охотничье-пальто", "system.armor.magicalBonus", 1],
    ["посох-ослепляющий-небеса", "system.magicalBonus", 1]
  ];
  for (const [itemId, path, bonus] of nativeCases) {
    const [item] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(item, new Map());
    const value = path === "system.magicalBonus"
      ? created.system.magicalBonus
      : created.system.armor?.magicalBonus;
    assert.equal(value, bonus, itemId);
    assert.equal(created.effects.some((effect) => effect.changes.some((change) => change.key === "system.attributes.ac.bonus")), false, itemId);
  }

  for (const itemId of ["посох-костяного-когтя", "посох-ослепляющий-небеса"]) {
    const [item] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(item, new Map());
    assert.deepEqual(created.effects[0]?.changes.map(({ key, mode, value }) => [key, mode, value]), [
      ["system.bonuses.msak.attack", 2, "+1"],
      ["system.bonuses.rsak.attack", 2, "+1"]
    ], itemId);
  }

  for (const conditionalId of [
    "ловящий-стрелы-щит",
    "щит-парии",
    "маска-шута",
    "очки-орлиного-зрения"
  ]) {
    const [item] = magicItemsCompendium.normalizeMagicItems([sourceById.get(conditionalId)]);
    assert.deepEqual(magicItemsCompendium.createMagicItemData(item, new Map()).effects, [], conditionalId);
  }
});

test("magic item compendium projects the audited unconditional passive catalog", () => {
  const expected = new Map([
    ["адамантитовый-щит", [["system.bonuses.abilities.save", 2, "+1"]]],
    ["доспех-истовости-1", [["system.bonuses.abilities.save", 2, "+2"]]],
    ["доспех-истовости-2", [["system.bonuses.abilities.save", 2, "+3"]]],
    ["доспех-истовости-3", [["system.bonuses.abilities.save", 2, "+1"]]],
    ["охраняющий-доспех-1", [["system.bonuses.abilities.save", 2, "+2"]]],
    ["охраняющий-доспех-2", [["system.bonuses.abilities.save", 2, "+3"]]],
    ["клинок-удачи", [["system.bonuses.abilities.save", 2, "+1"]]],
    ["мантия-звезд", [["system.bonuses.abilities.save", 2, "+1"]]],
    ["укус-харкона", [
      ["system.bonuses.abilities.check", 2, "+1"],
      ["system.bonuses.abilities.save", 2, "+1"]
    ]],
    ["великая-повязка-интеллекта", [
      ["system.abilities.int.value", 2, "+3"],
      ["system.abilities.int.max", 4, "25"]
    ]],
    ["повязка-интеллекта", [
      ["system.abilities.int.value", 2, "+3"],
      ["system.abilities.int.max", 4, "19"]
    ]],
    ["пояс-силы-громового-великана", [
      ["system.abilities.str.value", 2, "+7"],
      ["system.abilities.str.max", 4, "29"]
    ]],
    ["пояс-силы-каменного-великана", [
      ["system.abilities.str.value", 2, "+4"],
      ["system.abilities.str.max", 4, "23"]
    ]],
    ["пояс-силы-облачного-великана", [
      ["system.abilities.str.value", 2, "+7"],
      ["system.abilities.str.max", 4, "27"]
    ]],
    ["пояс-силы-огненного-великана", [
      ["system.abilities.str.value", 2, "+5"],
      ["system.abilities.str.max", 4, "25"]
    ]],
    ["рукавицы-силы-огра", [
      ["system.abilities.str.value", 2, "+4"],
      ["system.abilities.str.max", 4, "16"]
    ]],
    ["пояс-дварфов", [
      ["system.abilities.con.value", 2, "+2"],
      ["system.abilities.con.max", 4, "20"]
    ]],
    ["сфера-вуали", [
      ["system.abilities.wis.value", 2, "+2"],
      ["system.abilities.wis.max", 2, "+2"],
      ["system.attributes.senses.darkvision", 2, "+60"]
    ]],
    ["амулет-молниеносного-движения", [["system.attributes.movement.walk", 2, "+15"]]],
    ["кольцо-плавания", [["system.attributes.movement.swim", 4, "40"]]],
    ["сапоги-ходьбы-и-прыжков", [["system.attributes.movement.walk", 4, "30"]]],
    ["мантия-плута", [["system.attributes.senses.darkvision", 2, "+60"]]],
    ["светящийся-рунический-пигмент", [["system.attributes.senses.darkvision", 2, "+30"]]],
    ["амулет-святилища", [["system.traits.dr.value", 2, "necrotic"]]],
    ["двуручный-серебряный-меч", [
      ["system.traits.dr.value", 2, "psychic"],
      ["system.traits.ci.value", 2, "charmed"]
    ]],
    ["живой-доспех", [
      ["system.traits.dr.value", 2, "necrotic"],
      ["system.traits.dr.value", 2, "psychic"],
      ["system.traits.dr.value", 2, "poison"]
    ]],
    ["кольчуга-ифритов", [["system.traits.di.value", 2, "fire"]]],
    ["кираса-камнелома", [
      ["system.traits.dr.value", 2, "bludgeoning"],
      ["system.traits.dr.value", 2, "piercing"],
      ["system.traits.dr.value", 2, "slashing"],
      ["system.traits.ci.value", 2, "prone"]
    ]],
    ["жезл-адского-пламени", [["system.traits.dr.value", 2, "fire"]]],
    ["мантия-мистраля", [["system.traits.dr.value", 2, "cold"]]],
    ["морозный-клинок", [["system.traits.dr.value", 2, "fire"]]],
    ["посох-мороза", [["system.traits.dr.value", 2, "cold"]]],
    ["посох-огня", [["system.traits.dr.value", 2, "fire"]]],
    ["шлем-череп", [
      ["system.traits.dr.value", 2, "cold"],
      ["system.traits.dr.value", 2, "poison"],
      ["system.traits.dr.value", 2, "necrotic"]
    ]],
    ["эгида-эвриаллы", [
      ["system.traits.dr.value", 2, "poison"],
      ["system.traits.ci.value", 2, "petrified"]
    ]],
    ["перчатки-воровства", [["system.skills.slt.bonuses.check", 2, "+5"]]]
  ]);
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));

  for (const [itemId, changes] of expected) {
    const [normalized] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(normalized, new Map());
    assert.deepEqual(created.effects[0]?.changes.map(({ key, mode, value }) => [key, mode, value]), changes, itemId);
  }
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

test("charged magic items expose native spell activities with shared item uses", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const normalized = magicItemsCompendium.normalizeMagicItems([
    sourceById.get("печатка-гильдии-ракдоса"),
    sourceById.get("ушной-червь")
  ]);
  const createdById = new Map(normalized.map((item) => [
    item.id,
    magicItemsCompendium.createMagicItemData(item, new Map())
  ]));
  const expectedUsesById = new Map([
    ["печатка-гильдии-ракдоса", {
      spent: 0,
      max: "3",
      recovery: [{ period: "dawn", type: "formula", formula: "1d3" }]
    }],
    ["ушной-червь", {
      spent: 0,
      max: "4",
      recovery: [{ period: "dawn", type: "formula", formula: "1d4" }]
    }]
  ]);
  const expectedSpells = [
    ["печатка-гильдии-ракдоса", "Hellish Rebuke", "Compendium.dnd5e.spells24.Item.phbsplHellishReb", 1, "1"],
    ["ушной-червь", "Detect Thoughts", "Compendium.dnd5e.spells24.Item.phbsplDetectThou", 2, "2"],
    ["ушной-червь", "Dissonant Whispers", "Compendium.dnd5e.spells24.Item.phbsplDissonantW", 1, "1"]
  ];

  for (const [itemId, expectedUses] of expectedUsesById) {
    const created = createdById.get(itemId);
    assert.deepEqual(created.system.uses, expectedUses, itemId);
    const signature = JSON.parse(created.flags["rebreya-main"].signature);
    assert.deepEqual(signature.magicItemAutomation.activities, created.system.activities, itemId);
  }

  for (const [itemId, name, uuid, level, cost] of expectedSpells) {
    const created = createdById.get(itemId);
    const activity = Object.values(created.system.activities ?? {})
      .find((entry) => entry.name === name);
    assert.ok(activity, `${itemId}:${name}`);
    assert.equal(activity.type, "cast");
    assert.equal(activity._id.length, 16);
    assert.equal(activity.spell.uuid, uuid);
    assert.equal(activity.spell.level, level);
    assert.equal(activity.spell.spellbook, true);
    assert.equal(activity.consumption.spellSlot, false);
    assert.deepEqual(activity.consumption.targets, [{
      type: "itemUses",
      target: "",
      value: cost,
      scaling: { mode: "", formula: "" }
    }]);
    assert.equal(activity.flags["rebreya-main"].magicItemAutomation, true);
    if (itemId === "ушной-червь") {
      assert.deepEqual(activity.spell.challenge, { attack: null, save: 15, override: true });
    }
  }
});

test("catalog spell activities cover shared, separate, unlimited, and scalable resource contracts", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const itemIds = [
    "посох-огня",
    "посох-мороза",
    "волшебная-палочка-сковывания",
    "волшебная-палочка-огненных-шаров",
    "трезубец-зова-приливов",
    "шлем-телепатии",
    "шлем-понимания-языков",
    "шлем-телепортации"
  ];
  const createdById = new Map(magicItemsCompendium.normalizeMagicItems(
    itemIds.map((id) => sourceById.get(id))
  ).map((item) => [item.id, magicItemsCompendium.createMagicItemData(item, new Map())]));

  const expectedShared = new Map([
    ["посох-огня", ["10", "1d6 + 4"]],
    ["посох-мороза", ["10", "1d6 + 4"]],
    ["волшебная-палочка-сковывания", ["7", "1d6 + 1"]],
    ["волшебная-палочка-огненных-шаров", ["7", "1d6 + 1"]],
    ["трезубец-зова-приливов", ["3", "1d3"]],
    ["шлем-телепортации", ["3", "1d3"]]
  ]);
  for (const [itemId, [max, formula]] of expectedShared) {
    assert.deepEqual(createdById.get(itemId).system.uses, {
      spent: 0,
      max,
      recovery: [{ period: "dawn", type: "formula", formula }]
    }, itemId);
  }

  const spellCases = [
    ["посох-огня", "Burning Hands", "phbsplBurningHan", 1, "1"],
    ["посох-огня", "Fireball", "phbsplFireball00", 3, "3"],
    ["посох-огня", "Wall of Fire", "phbsplWallofFire", 4, "4"],
    ["посох-мороза", "Cone of Cold", "phbsplConeofCold", 5, "5"],
    ["посох-мороза", "Fog Cloud", "phbsplFogCloud00", 1, "1"],
    ["посох-мороза", "Ice Storm", "phbsplIceStorm00", 4, "4"],
    ["посох-мороза", "Wall of Ice", "phbsplWallofIce0", 6, "4"],
    ["волшебная-палочка-сковывания", "Hold Monster", "phbsplHoldMonste", 5, "5"],
    ["волшебная-палочка-сковывания", "Hold Person", "phbsplHoldPerson", 2, "2"],
    ["трезубец-зова-приливов", "Control Water", "phbsplControlWat", 4, "1"],
    ["трезубец-зова-приливов", "Tsunami", "phbsplTsunami000", 8, "3"],
    ["шлем-телепортации", "Teleport", "phbsplTeleport00", 7, "1"]
  ];
  for (const [itemId, name, spellId, level, cost] of spellCases) {
    const activity = Object.values(createdById.get(itemId).system.activities ?? {})
      .find((entry) => entry.name === name);
    assert.ok(activity, `${itemId}:${name}`);
    assert.equal(activity.spell.uuid, `Compendium.dnd5e.spells24.Item.${spellId}`);
    assert.equal(activity.spell.level, level);
    assert.deepEqual(activity.consumption.targets[0], {
      type: "itemUses",
      target: "",
      value: cost,
      scaling: { mode: "", formula: "" }
    });
  }

  const scalable = Object.values(createdById.get("волшебная-палочка-огненных-шаров").system.activities)[0];
  assert.equal(scalable.consumption.scaling.allowed, true);
  assert.equal(scalable.consumption.scaling.max, "min(@item.uses.value,3)");
  assert.deepEqual(scalable.consumption.targets[0].scaling, { mode: "amount", formula: "" });

  const telepathy = Object.values(createdById.get("шлем-телепатии").system.activities);
  const detectThoughts = telepathy.find((activity) => activity.name === "Detect Thoughts");
  const suggestion = telepathy.find((activity) => activity.name === "Suggestion");
  assert.deepEqual(detectThoughts.consumption.targets, []);
  assert.equal(detectThoughts.uses, undefined);
  assert.deepEqual(detectThoughts.spell.challenge, { attack: null, save: 13, override: true });
  assert.deepEqual(suggestion.consumption.targets, [{ type: "activityUses", value: "1" }]);
  assert.deepEqual(suggestion.uses, {
    spent: 0,
    max: "1",
    recovery: [{ period: "dawn", type: "recoverAll", formula: "" }]
  });

  const comprehend = Object.values(createdById.get("шлем-понимания-языков").system.activities)[0];
  assert.equal(comprehend.spell.uuid, "Compendium.dnd5e.spells24.Item.phbsplComprehend");
  assert.deepEqual(comprehend.consumption.targets, []);
  assert.equal(comprehend.uses, undefined);
});

test("all guild signets expose their one explicit spell through the shared three-charge pool", () => {
  const expected = new Map([
    ["печатка-гильдии-азориус", "phbsplEnsnaringS"],
    ["печатка-гильдии-бороса", "phbsplHeroism000"],
    ["печатка-гильдии-голгари", "phbsplEntangle00"],
    ["печатка-гильдии-димир", "phbsplDisguiseSe"],
    ["печатка-гильдии-орзова", "phbsplCommand000"],
    ["печатка-гильдии-ракдоса", "phbsplHellishReb"],
    ["печатка-гильдии-селезнии", "phbsplCharmPerso"],
    ["печатка-гильдии-симиков", "phbsplExpeditiou"]
  ]);
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));

  for (const [itemId, spellId] of expected) {
    const [item] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(item, new Map());
    assert.deepEqual(created.system.uses, {
      spent: 0,
      max: "3",
      recovery: [{ period: "dawn", type: "formula", formula: "1d3" }]
    }, itemId);
    const activities = Object.values(created.system.activities ?? {});
    assert.equal(activities.length, 1, itemId);
    assert.equal(activities[0].spell.uuid, `Compendium.dnd5e.spells24.Item.${spellId}`, itemId);
    assert.equal(activities[0].consumption.targets[0].value, "1", itemId);
  }

  for (const unsupportedId of ["печатка-гильдии-груул", "печатка-гильдии-иззет"]) {
    const [unsupported] = magicItemsCompendium.normalizeMagicItems([sourceById.get(unsupportedId)]);
    const data = magicItemsCompendium.createMagicItemData(unsupported, new Map());
    assert.equal(data.system.activities, undefined, unsupportedId);
    assert.equal(magicItemsCompendium.buildMagicItemAutomationManifest([unsupported])[0].status, "manual");
  }
});

test("remaining named instruments expose every explicit once-per-dawn spell", () => {
  const expectedById = new Map([
    ["арфа-анструт", ["phbsplControlWea", "phbEvilAndGoodPr", "phbsplLevitate00", "phbsplCureWounds", "phbsplInvisibili", "phbsplFly0000000", "phbsplWallofThor"]],
    ["арфа-оллава", ["phbsplControlWea", "phbEvilAndGoodPr", "phbsplLevitate00", "phbsplInvisibili", "phbsplFireStorm0", "phbsplConfusion0", "phbsplFly0000000"]],
    ["мандолина-канаит", ["phbEvilAndGoodPr", "phbProtectionFro", "phbsplLevitate00", "phbsplCureWounds", "phbsplDispelMagi", "phbsplInvisibili", "phbsplFly0000000"]],
    ["цитра-мак-фуирми", ["phbsplBarkskin00", "phbEvilAndGoodPr", "phbsplLevitate00", "phbsplCureWounds", "phbsplInvisibili", "phbsplFly0000000", "phbsplFogCloud00"]]
  ]);
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  for (const [itemId, spellIds] of expectedById) {
    const [item] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(item, new Map());
    const activities = Object.values(created.system.activities ?? {});
    assert.deepEqual(
      activities.map((activity) => activity.spell.uuid),
      spellIds.map((id) => `Compendium.dnd5e.spells24.Item.${id}`),
      itemId
    );
    for (const activity of activities) {
      assert.deepEqual(activity.consumption.targets, [{ type: "activityUses", value: "1" }]);
      assert.deepEqual(activity.uses?.recovery, [{ period: "dawn", type: "recoverAll", formula: "" }]);
    }
  }
});

test("straightforward catalog spell items use exact native spell and resource projections", () => {
  const cases = [
    ["волшебная-палочка-обнаружения-магии", "Detect Magic", "phbsplDetectMagi", "3", "1d3", "1"],
    ["волшебная-палочка-молний", "Lightning Bolt", "phbsplLightningB", "7", "1d6 + 1", "1"],
    ["волшебная-палочка-паутины", "Web", "phbsplWeb0000000", "7", "1d6 + 1", "1"],
    ["волшебная-палочка-превращения", "Polymorph", "phbsplPolymorph0", "7", "1d6 + 1", "1"],
    ["волшебная-палочка-снарядов", "Magic Missile", "phbsplMagicMissi", "7", "1d6 + 1", "1"],
    ["посох-лечения", "Mass Cure Wounds", "phbsplMassCureWo", "10", "1d6 + 4", "5"],
    ["трезубец-командования-рыбами", "Dominate Beast", "phbsplDominateBe", "3", "1d3", "1"],
    ["медальон-мыслей", "Detect Thoughts", "phbsplDetectThou", "3", "1d3", "1"],
    ["кольцо-затуманивания", "Fog Cloud", "phbsplFogCloud00", "3", "1d3", "1"]
  ];
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  for (const [itemId, name, spellId, max, recovery, cost] of cases) {
    const [item] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(item, new Map());
    assert.deepEqual(created.system.uses, {
      spent: 0,
      max,
      recovery: [{ period: "dawn", type: "formula", formula: recovery }]
    }, itemId);
    const activity = Object.values(created.system.activities ?? {})
      .find((entry) => entry.name === name);
    assert.ok(activity, `${itemId}:${name}`);
    assert.equal(activity.spell.uuid, `Compendium.dnd5e.spells24.Item.${spellId}`);
    assert.equal(activity.consumption.targets[0].value, cost);
  }

  const independentCases = [
    ["игла-починки", "Mending", "phbsplMending000", null, "action"],
    ["шапка-маскировки", "Disguise Self", "phbsplDisguiseSe", null, "action"],
    ["татуировка-маскарада", "Disguise Self", "phbsplDisguiseSe", "dawn", "action"],
    ["сапоги-странника", "Expeditious Retreat", "phbsplExpeditiou", "dawn", "bonus"],
    ["плащ-шарлатана", "Dimension Door", "phbsplDimensionD", "dawn", "action"]
  ];
  for (const [itemId, name, spellId, limit, activation] of independentCases) {
    const [item] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(item, new Map());
    const activity = Object.values(created.system.activities ?? {})
      .find((entry) => entry.name === name);
    assert.ok(activity, `${itemId}:${name}`);
    assert.equal(activity.spell.uuid, `Compendium.dnd5e.spells24.Item.${spellId}`);
    assert.equal(activity.activation.type, activation);
    assert.deepEqual(activity.consumption.targets, limit
      ? [{ type: "activityUses", value: "1" }]
      : []);
    assert.equal(activity.uses?.max, limit ? "1" : undefined);
  }
});

test("audited single-spell catalog rows expose their unambiguous cast activity", () => {
  const cases = [
    ["аметистовый-магнетит", "phbsplReverseGra", "3"],
    ["амулет-святилища", "phbsplSparetheDy", null],
    ["боевая-кирка-камнетворца", "phbsplMeldintoSt", "activity"],
    ["ветвь-с-колокольчиками", "phbEvilAndGoodPr", "1"],
    ["визор-данота", "phbsplAntimagicF", "activity"],
    ["доспех-антимагии", "phbsplAntimagicF", "activity"],
    ["доспех-защиты", "phbsplBeaconofHo", "activity"],
    ["доспех-зефира", "phbsplWindWall00", "activity"],
    ["доспехи-мрака", "phbsplCalmEmotio", "1"],
    ["доспехи-фей", "phbsplCompulsion", "1"],
    ["жезл-адского-пламени", "phbsplHellishReb", "activity"],
    ["камни-послания", "phbsplSending000", "activity"],
    ["кираса-баланса", "phbsplLesserRest", "2"],
    ["кираса-камнелома", "phbsplWallofSton", "activity"],
    ["книга-фокусов", "phbsplPrestidigi", "1"],
    ["книга-чудотворства", "phbsplThaumaturg", "1"],
    ["колода-оракула", "phbsplDivination", "activity"],
    ["корона-несущего-гнев", "phbsplFear000000", "activity"],
    ["мантия-мистраля", "phbsplSleetStorm", "activity"],
    ["обруч-сжигания", "phbsplScorchingR", "activity"],
    ["очки-распознавания-объектов", "phbsplIdentify00", "activity"],
    ["плащ-летучей-мыши", "phbsplPolymorph0", "activity"],
    ["плащ-паука", "phbsplWeb0000000", "activity"],
    ["сокрушитель-сумерек", "phbsplSunbeam000", "activity"],
    ["тиара-кружащихся-комет", "phbsplIceStorm00", "3"],
    ["штормовой-пояс", "phbsplControlWea", "activity"]
  ];
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  for (const [itemId, spellId, resource] of cases) {
    const [item] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(item, new Map());
    const activity = Object.values(created.system.activities ?? {})
      .find((entry) => entry.spell?.uuid === `Compendium.dnd5e.spells24.Item.${spellId}`);
    assert.ok(activity, itemId);
    if (resource === null) {
      assert.deepEqual(activity.consumption.targets, [], itemId);
    } else if (resource === "activity") {
      assert.deepEqual(activity.consumption.targets, [{ type: "activityUses", value: "1" }], itemId);
      assert.equal(activity.uses.max, "1", itemId);
    } else {
      assert.equal(activity.consumption.targets[0]?.type, "itemUses", itemId);
      assert.equal(activity.consumption.targets[0]?.value, resource, itemId);
    }
  }
});

test("magic items expose approved native utility and poison save activities", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const utilityCases = [
    ["кинжал-яда", "Покрыть клинок ядом", "action", "1"],
    ["механистический-амулет", "Принять 10 на броске атаки", "special", "1"],
    ["таранный-щит", "Усиленный толчок", "special", "1"],
    ["развевающийся-плащ", "Драматично развеять плащ", "bonus", null],
    ["трубка-дымных-чудовищ", "Выдохнуть дымное существо", "action", null],
    ["фонарь-обнаружения", "Открыть фонарь", "action", null],
    ["фонарь-обнаружения", "Опустить козырёк", "action", null],
    ["универсальный-инструмент-1", "Изменить форму инструмента", "action", null],
    ["универсальный-инструмент-1", "Выбрать заговор", "action", "1"],
    ["амулет-благочестия-1", "Божественный канал без расхода", "special", "1"],
    ["барабан-задающего-ритм-1", "Восстановить Бардовское вдохновение", "action", "1"],
    ["аметистовый-магнетит", "Звёздный полёт", "bonus", "1"],
    ["аметистовый-магнетит", "Гравитационный бросок", "action", "1"],
    ["амулет-святилища", "Пробудить руну", "reaction", "1"],
    ["ветвь-с-колокольчиками", "Обнаружить существ", "bonus", "1"],
    ["волшебная-палочка-сковывания", "Помощь в освобождении", "reaction", "1"],
    ["доспех-антимагии", "Защита от заклинания", "reaction", "1"],
    ["тиара-кружащихся-комет", "Звёздный полёт", "bonus", "1"],
    ["сокрушитель-сумерек", "Зажечь навершие", "bonus", null],
    ["сокрушитель-сумерек", "Погасить навершие", "action", null]
  ];
  const ids = [...new Set(utilityCases.map(([id]) => id))];
  const createdById = new Map(magicItemsCompendium.normalizeMagicItems(
    ids.map((id) => sourceById.get(id))
  ).map((item) => [item.id, magicItemsCompendium.createMagicItemData(item, new Map())]));

  for (const [itemId, name, activation, cost] of utilityCases) {
    const activity = Object.values(createdById.get(itemId).system.activities ?? {})
      .find((entry) => entry.name === name);
    assert.ok(activity, `${itemId}:${name}`);
    assert.equal(activity.type, "utility");
    assert.equal(activity.activation.type, activation);
    assert.equal(activity._id.length, 16);
    assert.equal(activity.flags["rebreya-main"].magicItemAutomation, true);
    assert.deepEqual(
      activity.consumption.targets,
      cost === null ? [] : [{
        type: "itemUses",
        target: "",
        value: cost,
        scaling: { mode: "", formula: "" }
      }],
      `${itemId}:${name}`
    );
  }

  assert.deepEqual(createdById.get("кинжал-яда").system.uses, {
    spent: 0,
    max: "1",
    recovery: [{ period: "dawn", type: "recoverAll", formula: "" }]
  });
  assert.deepEqual(createdById.get("таранный-щит").system.uses, {
    spent: 0,
    max: "3",
    recovery: [{ period: "dawn", type: "formula", formula: "1d3" }]
  });
  assert.deepEqual(createdById.get("амулет-святилища").system.uses, {
    spent: 0,
    max: "1",
    recovery: [{ period: "dawn", type: "recoverAll", formula: "" }]
  });
  assert.deepEqual(createdById.get("доспех-антимагии").system.uses, {
    spent: 0,
    max: "1",
    recovery: [{ period: "dawn", type: "recoverAll", formula: "" }]
  });

  const poisonSave = Object.values(createdById.get("кинжал-яда").system.activities)
    .find((entry) => entry.name === "Яд: спасбросок после попадания");
  assert.ok(poisonSave);
  assert.equal(poisonSave.type, "save");
  assert.deepEqual(poisonSave.save, {
    ability: ["con"],
    dc: { calculation: "", formula: "15" }
  });
  assert.deepEqual(poisonSave.damage.parts[0], {
    number: 2,
    denomination: 10,
    bonus: "",
    types: ["poison"],
    custom: { enabled: false, formula: "" },
    scaling: { mode: "", number: 1, formula: "" }
  });
  assert.match(poisonSave.description.chatFlavor, /отравлен.+1 минут/iu);
  assert.deepEqual(poisonSave.consumption.targets, []);
});

test("second-pass passive automation keeps only unconditional bonuses across rarities", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const expectedById = new Map([
    ["заполярные-сапоги", [["system.traits.dr.value", 2, "cold"]]],
    ["кольцо-тепла", [["system.traits.dr.value", 2, "cold"]]],
    ["мантия-глаз", [["system.attributes.senses.darkvision", 4, "120"]]],
    ["медальон-защиты-от-яда", [
      ["system.traits.di.value", 2, "poison"],
      ["system.traits.ci.value", 2, "poisoned"]
    ]],
    ["расплавленная-бронзовая-кожа", [["system.traits.dr.value", 2, "fire"]]],
    ["брошь-арканиста", [["system.attributes.ac.bonus", 2, "+1"]]],
    ["маска-сокола", [
      ["system.attributes.movement.fly", 4, "60"],
      ["system.attributes.init.roll.mode", 2, "1"]
    ]],
    ["татуировка-жизненной-энергии", [["system.traits.dr.value", 2, "necrotic"]]],
    ["сфера-скориуса", [["system.attributes.senses.darkvision", 4, "120"]]]
  ]);

  for (const [itemId, expectedChanges] of expectedById) {
    const [item] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(item, new Map());
    assert.deepEqual(created.effects.flatMap((effect) => effect.changes).map(({ key, mode, value }) => [
      key,
      mode,
      value
    ]), expectedChanges, itemId);
  }
});

test("second-pass spell automation supports shared, independent, unlimited, and nonrecovering uses", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const itemIds = [
    "доспехи-невесомости",
    "парящая-сфера",
    "посох-путешественника",
    "корона-бехолдеров-белаширры",
    "кольцо-трех-желаний",
    "ключ-лазутчика"
  ];
  const createdById = new Map(magicItemsCompendium.normalizeMagicItems(
    itemIds.map((id) => sourceById.get(id))
  ).map((item) => [item.id, magicItemsCompendium.createMagicItemData(item, new Map())]));

  assert.deepEqual(createdById.get("доспехи-невесомости").system.uses, {
    spent: 0,
    max: "5",
    recovery: [{ period: "dawn", type: "formula", formula: "1d4 + 1" }]
  });
  const weightlessActivities = Object.values(createdById.get("доспехи-невесомости").system.activities);
  assert.deepEqual(weightlessActivities.map((activity) => [
    activity.spell.uuid,
    activity.activation.type,
    activity.consumption.targets[0]?.value
  ]), [
    ["Compendium.dnd5e.spells24.Item.phbsplJump000000", "bonus", "1"],
    ["Compendium.dnd5e.spells24.Item.phbsplLevitate00", "bonus", "2"]
  ]);

  const orbActivities = Object.values(createdById.get("парящая-сфера").system.activities);
  const light = orbActivities.find((activity) => activity.name === "Light");
  const daylight = orbActivities.find((activity) => activity.name === "Daylight");
  assert.deepEqual(light.consumption.targets, []);
  assert.equal(light.uses, undefined);
  assert.deepEqual(daylight.consumption.targets, [{ type: "activityUses", value: "1" }]);
  assert.deepEqual(daylight.uses, {
    spent: 0,
    max: "1",
    recovery: [{ period: "dawn", type: "recoverAll", formula: "" }]
  });

  const traveler = createdById.get("посох-путешественника");
  assert.deepEqual(traveler.system.uses, {
    spent: 0,
    max: "10",
    recovery: [{ period: "dawn", type: "formula", formula: "1d6 + 4" }]
  });
  assert.deepEqual(Object.values(traveler.system.activities).map((activity) => [
    activity.name,
    activity.consumption.targets[0]?.value
  ]), [
    ["Banishment", "4"],
    ["Blink", "3"],
    ["Misty Step", "2"],
    ["Passwall", "5"],
    ["Teleport", "7"]
  ]);

  const crown = createdById.get("корона-бехолдеров-белаширры");
  assert.equal(Object.keys(crown.system.activities).length, 10);
  assert.equal(Object.values(crown.system.activities).every((activity) => (
    activity.spell.challenge.override === true
    && activity.spell.challenge.save === 16
    && activity.consumption.targets[0]?.type === "itemUses"
  )), true);

  const wishes = createdById.get("кольцо-трех-желаний");
  assert.deepEqual(wishes.system.uses, { spent: 0, max: "3", recovery: [] });
  assert.equal(Object.values(wishes.system.activities)[0].spell.uuid, "Compendium.dnd5e.spells24.Item.phbsplWish000000");

  const infiltrator = Object.values(createdById.get("ключ-лазутчика").system.activities);
  assert.equal(infiltrator.length, 7);
  assert.equal(infiltrator.every((activity) => activity.uses?.recovery?.[0]?.period === "dawn"), true);
  assert.equal(infiltrator.every((activity) => activity.consumption.targets[0]?.type === "activityUses"), true);
});

test("second-pass native save and utility activities preserve exact resource contracts", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const itemIds = [
    "палочка-улыбок",
    "жезл-возмездия",
    "пирослияние",
    "дирижерская-палочка",
    "сфера-направления",
    "скарабей-защиты",
    "куб-силового-поля"
  ];
  const createdById = new Map(magicItemsCompendium.normalizeMagicItems(
    itemIds.map((id) => sourceById.get(id))
  ).map((item) => [item.id, magicItemsCompendium.createMagicItemData(item, new Map())]));

  const smiles = Object.values(createdById.get("палочка-улыбок").system.activities)[0];
  assert.equal(smiles.type, "save");
  assert.deepEqual(smiles.save, { ability: ["wis"], dc: { calculation: "", formula: "10" } });
  assert.deepEqual(smiles.damage, { onSave: "none", parts: [] });
  assert.equal(smiles.consumption.targets[0]?.type, "itemUses");

  const reprisal = Object.values(createdById.get("жезл-возмездия").system.activities)[0];
  assert.equal(reprisal.activation.type, "reaction");
  assert.deepEqual(reprisal.save, { ability: ["dex"], dc: { calculation: "", formula: "13" } });
  assert.equal(reprisal.damage.onSave, "half");
  assert.deepEqual(reprisal.damage.parts[0], {
    number: 2,
    denomination: 10,
    bonus: "",
    types: ["lightning"],
    custom: { enabled: false, formula: "" },
    scaling: { mode: "", number: 1, formula: "" }
  });

  const pyro = Object.values(createdById.get("пирослияние").system.activities)[0];
  assert.equal(pyro.type, "save");
  assert.equal(pyro.damage.parts[0].number, 4);
  assert.equal(pyro.damage.parts[0].denomination, 6);
  assert.equal(pyro.damage.onSave, "half");
  assert.deepEqual(pyro.consumption.targets, []);

  const baton = createdById.get("дирижерская-палочка");
  assert.deepEqual(baton.system.uses, {
    spent: 0,
    max: "3",
    recovery: [{ period: "dawn", type: "recoverAll", formula: "" }]
  });
  assert.equal(Object.values(baton.system.activities)[0].type, "utility");

  const compass = Object.values(createdById.get("сфера-направления").system.activities)[0];
  assert.deepEqual(compass.consumption.targets, []);

  const scarab = createdById.get("скарабей-защиты");
  assert.deepEqual(scarab.system.uses, { spent: 0, max: "12", recovery: [] });
  assert.equal(Object.values(scarab.system.activities)[0].activation.type, "reaction");

  const cubeFaces = Object.values(createdById.get("куб-силового-поля").system.activities);
  assert.equal(cubeFaces.find((activity) => activity.name === "Грань 5: всё")
    ?.consumption.targets[0]?.value, "5");
  assert.deepEqual(cubeFaces.find((activity) => activity.name === "Грань 6: отключить")
    ?.consumption.targets, []);
});

test("second-pass partial manifest notes name the exact manual remainder", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const items = [
    "палочка-пиротехники",
    "доспехи-падшего",
    "посох-очарования",
    "кольцо-телекинеза",
    "корона-бехолдеров-белаширры"
  ].map((id) => sourceById.get(id));
  const byId = new Map(magicItemsCompendium.buildMagicItemAutomationManifest(items)
    .map((row) => [row.id, row]));

  for (const item of items) {
    assert.equal(byId.get(item.id).status, "partial", item.id);
  }
  assert.match(byId.get("палочка-пиротехники").reason, /уничтожен/iu);
  assert.match(byId.get("доспехи-падшего").reason, /смерт|уничтож/iu);
  assert.match(byId.get("посох-очарования").reason, /отраж|уничтож/iu);
  assert.match(byId.get("кольцо-телекинеза").reason, /только.+предмет/iu);
  assert.match(byId.get("корона-бехолдеров-белаширры").reason, /симбиот|настрой/iu);
});

test("class-restricted spellcasting items keep their safe utility resources without global bonuses", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const expected = new Map([
    ["амулет-благочестия-2", ["Божественный канал без расхода", "dawn"]],
    ["барабан-задающего-ритм-3", ["Восстановить Бардовское вдохновение", "dawn"]],
    ["универсальный-инструмент-2", ["Выбрать заговор", "dawn"]],
    ["жезл-хранителя-договора-3", ["Восстановить ячейку колдуна", "lr"]]
  ]);

  for (const [itemId, [activityName, recoveryPeriod]] of expected) {
    const [item] = magicItemsCompendium.normalizeMagicItems([sourceById.get(itemId)]);
    const created = magicItemsCompendium.createMagicItemData(item, new Map());
    assert.equal(created.effects.some((effect) => effect.changes.some(({ key }) => (
      key.startsWith("system.bonuses.msak")
      || key.startsWith("system.bonuses.rsak")
      || key === "system.bonuses.spell.dc"
    ))), false, itemId);
    assert.equal(Object.values(created.system.activities).some(({ name }) => name === activityName), true, itemId);
    assert.equal(created.system.uses.recovery[0]?.period, recoveryPeriod, itemId);
  }
});

test("second-pass activities cover attack overrides and newly audited legacy partials", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const itemIds = [
    "обруч-сжигания",
    "жезл-бдительности",
    "мантия-звезд",
    "мантия-мистраля",
    "посох-ослепляющий-небеса",
    "эгида-эвриаллы"
  ];
  const createdById = new Map(magicItemsCompendium.normalizeMagicItems(
    itemIds.map((id) => sourceById.get(id))
  ).map((item) => [item.id, magicItemsCompendium.createMagicItemData(item, new Map())]));

  const circlet = Object.values(createdById.get("обруч-сжигания").system.activities)[0];
  assert.deepEqual(circlet.spell.challenge, { attack: 5, save: null, override: true });
  assert.equal(magicItemsCompendium.buildMagicItemAutomationManifest([sourceById.get("обруч-сжигания")])[0].status, "full");

  const vigilance = Object.values(createdById.get("жезл-бдительности").system.activities);
  assert.equal(vigilance.filter(({ type }) => type === "cast").length, 4);
  assert.equal(vigilance.some(({ name }) => name === "Защитная аура"), true);
  assert.deepEqual(createdById.get("жезл-бдительности").effects[0].changes.map(({ key }) => key), [
    "system.attributes.init.roll.mode",
    "system.skills.prc.roll.mode"
  ]);

  assert.equal(Object.values(createdById.get("мантия-звезд").system.activities)
    .some(({ name }) => name === "Перейти на Астральный План"), true);
  assert.equal(Object.values(createdById.get("мантия-мистраля").system.activities)
    .some(({ type, save }) => type === "save" && save.dc.formula === "14"), true);
  assert.equal(Object.values(createdById.get("посох-ослепляющий-небеса").system.activities)
    .some(({ type, save }) => type === "save" && save.dc.formula === "15"), true);
  assert.equal(Object.values(createdById.get("эгида-эвриаллы").system.activities).length, 4);
});

test("third-pass manual candidates expose their unambiguous native subset", () => {
  const sourceById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  const partialIds = [
    "волшебная-палочка-секретов",
    "вечнодымящаяся-бутылка",
    "татуировка-жутких-когтей",
    "свирель-канализации",
    "волшебная-палочка-обнаружения-врагов",
    "волшебная-палочка-паралича",
    "волшебная-палочка-страха",
    "камень-сияния",
    "крылья-полета",
    "солнечный-клинок",
    "язык-пламени",
    "амулет-планов",
    "плащ-невидимости",
    "сапоги-скорости",
    "татуировка-поглощения",
    "татуировка-призрачных-шагов",
    "железная-фляга",
    "кольцо-призыва-джинна",
    "щит-пылающего-дредноута"
  ];
  const itemIds = ["медальон-здоровья", ...partialIds];
  const createdById = new Map(magicItemsCompendium.normalizeMagicItems(
    itemIds.map((id) => sourceById.get(id))
  ).map((item) => [item.id, magicItemsCompendium.createMagicItemData(item, new Map())]));
  const manifestById = new Map(magicItemsCompendium.buildMagicItemAutomationManifest(
    itemIds.map((id) => sourceById.get(id))
  ).map((row) => [row.id, row]));

  assert.equal(manifestById.get("медальон-здоровья").status, "full");
  assert.deepEqual(createdById.get("медальон-здоровья").effects[0].changes, [{
    key: "system.traits.ci.value",
    mode: 2,
    value: "diseased",
    priority: 20
  }]);
  for (const id of partialIds) {
    assert.equal(manifestById.get(id).status, "partial", id);
    assert.match(manifestById.get(id).reason, /ручн|не автомат|не проец/iu, id);
  }

  const expectedUses = new Map([
    ["волшебная-палочка-секретов", ["3", "dawn", "formula", "1d3"]],
    ["волшебная-палочка-обнаружения-врагов", ["7", "dawn", "formula", "1d6 + 1"]],
    ["волшебная-палочка-паралича", ["7", "dawn", "formula", "1d6 + 1"]],
    ["волшебная-палочка-страха", ["7", "dawn", "formula", "1d6 + 1"]],
    ["камень-сияния", ["50", null, null, null]],
    ["плащ-невидимости", ["120", null, null, null]],
    ["сапоги-скорости", ["10", "lr", "recoverAll", ""]],
    ["татуировка-поглощения", ["1", "dawn", "recoverAll", ""]],
    ["татуировка-призрачных-шагов", ["3", "dawn", "recoverAll", ""]],
    ["кольцо-призыва-джинна", ["1", null, null, null]]
  ]);
  for (const [id, [max, period, type, formula]] of expectedUses) {
    const uses = createdById.get(id).system.uses;
    assert.equal(uses.max, max, id);
    assert.equal(uses.spent, 0, id);
    assert.equal(uses.recovery[0]?.period ?? null, period, id);
    assert.equal(uses.recovery[0]?.type ?? null, type, id);
    assert.equal(uses.recovery[0]?.formula ?? null, formula, id);
  }

  const paralysis = Object.values(createdById.get("волшебная-палочка-паралича").system.activities)[0];
  assert.deepEqual(paralysis.save, { ability: ["con"], dc: { calculation: "", formula: "15" } });
  const fearActivities = Object.values(createdById.get("волшебная-палочка-страха").system.activities);
  assert.equal(fearActivities.some(({ spell }) => spell?.uuid === "Compendium.dnd5e.spells24.Item.phbsplCommand000"), true);
  assert.equal(fearActivities.some(({ save, consumption }) => (
    save?.dc?.formula === "15" && consumption.targets[0]?.value === "2"
  )), true);

  const planeShift = Object.values(createdById.get("амулет-планов").system.activities)[0];
  assert.equal(planeShift.spell.uuid, "Compendium.dnd5e.spells24.Item.phbsplPlaneShift");
  assert.deepEqual(planeShift.consumption.targets, []);
  assert.equal(createdById.get("солнечный-клинок").system.magicalBonus, 2);

  const brilliance = Object.values(createdById.get("камень-сияния").system.activities);
  assert.deepEqual(brilliance.map(({ name, consumption }) => [name, consumption.targets[0]?.value ?? null]), [
    ["Включить или выключить свет", null],
    ["Ослепляющий луч", "1"],
    ["Ослепляющий конус", "5"]
  ]);
  const dreadnought = Object.values(createdById.get("щит-пылающего-дредноута").system.activities);
  assert.equal(dreadnought.some(({ name }) => name === "Активировать щит"), true);
  assert.equal(dreadnought.some(({ save }) => save?.dc?.formula === "8 + @prof + @abilities.str.mod"), true);
});

test("every partial manifest row replaces the generic note with a concrete manual remainder", () => {
  const partialRows = magicItemsCompendium.buildMagicItemAutomationManifest()
    .filter((row) => row.status === "partial");
  for (const row of partialRows) {
    assert.doesNotMatch(row.reason, /Автоматизируется managed effects и native activities/iu, row.id);
    assert.match(row.reason, /ручн|не автомат|не проец|не выраж|требует ручной/iu, row.id);
  }
});
