import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDnd5eItemData,
  getPrimaryGearDocumentCreateOptions
} from "../scripts/data/gear-compendium.js";
import { buildNamedIconLookup } from "../scripts/data/compendium-utils.js";
import { createStableGearDocumentId } from "../scripts/data/gear-document-ids.js";
import { getRebreyaWeaponBaseItemDefinitions } from "../scripts/data/item-classification.js";
import { normalizeEconomyDataset } from "../scripts/data/normalizer.js";
import {
  buildRebreyaWeaponIdsConfig,
  registerRebreyaWeaponBaseItemsFromGearPack
} from "../scripts/integrations/dnd5e-sheet-extensions.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const EQUIPMENT_PACK_CONTENTS = {
  "nabor-artista": [
    ["spal-nik", 1],
    ["odezhda-kostyum", 2],
    ["svecha", 5],
    ["ratsiony-1-den", 5],
    ["burdyuk", 1],
    ["instrumenty-grimyora-0-y-rang", 1]
  ],
  "nabor-vzlomshchika": [
    ["metallicheskie-shariki-1-000-sht-v-sumke", 1],
    ["leska-10-futov", 1],
    ["kolokol-chik", 1],
    ["svecha", 5],
    ["lomik", 1],
    ["molotok", 1],
    ["shlyambur", 10],
    ["fonar-zakrytyy", 1],
    ["maslo-flyaga", 2],
    ["ratsiony-1-den", 5],
    ["trutnitsa", 1],
    ["burdyuk", 1],
    ["veryovka-pen-kovaya-50-futov", 1]
  ],
  "nabor-diplomata": [
    ["konteyner-dlya-kart-i-svitkov", 2],
    ["odezhda-otlichnaya", 1],
    ["chernila-butylochka-30-gramm", 1],
    ["pischee-pero", 1],
    ["lampa", 1],
    ["maslo-flyaga", 2],
    ["bumaga-odin-list", 5],
    ["dukhi-flakon", 1],
    ["vosk", 1],
    ["mylo", 1]
  ],
  "nabor-issledovatelya-podzemeliy": [
    ["lomik", 1],
    ["molotok", 1],
    ["shlyambur", 10],
    ["fakel", 10],
    ["trutnitsa", 1],
    ["ratsiony-1-den", 10],
    ["burdyuk", 1],
    ["veryovka-pen-kovaya-50-futov", 1]
  ],
  "nabor-puteshestvennika": [
    ["spal-nik", 1],
    ["stolovyy-nabor", 1],
    ["trutnitsa", 1],
    ["fakel", 10],
    ["ratsiony-1-den", 10],
    ["burdyuk", 1],
    ["veryovka-pen-kovaya-50-futov", 1]
  ],
  "nabor-svyashchennika": [
    ["odeyalo", 1],
    ["svecha", 10],
    ["trutnitsa", 1],
    ["korobka-dlya-pozhertvovaniy", 1],
    ["blagovoniya-upakovka", 2],
    ["kadilo", 1],
    ["oblachenie", 1],
    ["ratsiony-1-den", 2],
    ["burdyuk", 1]
  ],
  "nabor-uchyonogo": [
    ["nauchnaya-kniga", 1],
    ["chernila-butylochka-30-gramm", 1],
    ["pischee-pero", 1],
    ["pergament-odin-list", 10],
    ["sumochka-s-peskom", 1],
    ["nozh-nebolshoy", 1]
  ]
};
const DAMAGE_TYPE_BY_LABEL = new Map([
  ["Дробящий", "bludgeoning"],
  ["Колющий", "piercing"],
  ["Рубящий", "slashing"],
  ["Огнём", "fire"],
  ["Электричеством", "lightning"]
]);
const NATIVE_DND5E_WEAPON_BASE_ITEMS = new Set([
  "battleaxe",
  "blowgun",
  "club",
  "dagger",
  "dart",
  "flail",
  "glaive",
  "greataxe",
  "greatclub",
  "greatsword",
  "halberd",
  "handaxe",
  "handcrossbow",
  "heavycrossbow",
  "javelin",
  "lance",
  "lightcrossbow",
  "lighthammer",
  "longbow",
  "longsword",
  "mace",
  "maul",
  "morningstar",
  "musket",
  "pike",
  "pistol",
  "quarterstaff",
  "rapier",
  "scimitar",
  "shortbow",
  "shortsword",
  "sickle",
  "sling",
  "spear",
  "trident",
  "warhammer",
  "warpick",
  "whip"
]);
const EXPECTED_ORDINARY_WEAPONS = [
  ["boevoy-posokh", "simpleM", "quarterstaff"],
  ["bulava", "simpleM", "mace"],
  ["dubinka", "simpleM", "club"],
  ["kinzhal", "simpleM", "dagger"],
  ["kop-e", "simpleM", "spear"],
  ["lyogkiy-molot", "simpleM", "lighthammer"],
  ["palitsa", "simpleM", "greatclub"],
  ["kosa", "simpleM", "kosa"],
  ["kastet", "simpleM", "kastet"],
  ["ruchnoy-topor", "simpleM", "handaxe"],
  ["serp", "simpleM", "sickle"],
  ["arbalet-legkiy", "simpleR", "lightcrossbow"],
  ["drotik", "simpleR", "dart"],
  ["korotkiy-luk", "simpleR", "shortbow"],
  ["prashcha", "simpleR", "sling"],
  ["alebarda", "martialM", "halberd"],
  ["boevaya-kirka", "martialM", "warpick"],
  ["boevoy-molot", "martialM", "warhammer"],
  ["glefa", "martialM", "glaive"],
  ["dvuruchnyy-mech", "martialM", "greatsword"],
  ["kavaleriyskaya-pika", "martialM", "lance"],
  ["dlinnyy-mech", "martialM", "longsword"],
  ["knut", "martialM", "whip"],
  ["korotkiy-mech", "martialM", "shortsword"],
  ["molot", "martialM", "maul"],
  ["morgenshtern", "martialM", "morningstar"],
  ["pika", "martialM", "pike"],
  ["rapira", "martialM", "rapier"],
  ["sekira", "martialM", "greataxe"],
  ["skimitar", "martialM", "scimitar"],
  ["trezubets", "martialM", "trident"],
  ["tsep", "martialM", "flail"],
  ["gear-2", "martialM", "tsep-chain"],
  ["palash", "martialM", "palash"],
  ["sablya", "martialM", "sablya"],
  ["katana", "martialM", "katana"],
  ["estok", "martialM", "estok"],
  ["boevaya-kosa", "martialM", "boevaya-kosa"],
  ["dvustoronniy-topor", "martialM", "dvustoronniy-topor"],
  ["kostyanoy-topor", "martialM", "kostyanoy-topor"],
  ["molot-vsadnika", "martialM", "molot-vsadnika"],
  ["dvustoronniy-molot", "martialM", "dvustoronniy-molot"],
  ["kinzhal-na-tsepi", "martialM", "kinzhal-na-tsepi"],
  ["dlinnaya-bulava", "martialM", "dlinnaya-bulava"],
  ["tsepnoy-serp", "martialM", "tsepnoy-serp"],
  ["mech-palacha", "martialM", "mech-palacha"],
  ["metallicheskaya-perchatka", "martialM", "metallicheskaya-perchatka"],
  ["shamshir", "martialM", "shamshir"],
  ["boevoy-topor", "martialM", "battleaxe"],
  ["arbalet-ruchnoy", "martialR", "handcrossbow"],
  ["arbalet-tyazhelyy", "martialR", "heavycrossbow"],
  ["dlinnyy-luk", "martialR", "longbow"],
  ["dukhovaya-trubka", "martialR", "blowgun"],
  ["set", "martialR", "set"],
  ["luk-vsadnika", "martialR", "luk-vsadnika"],
  ["kompozitnyy-luk", "martialR", "kompozitnyy-luk"],
  ["mnogozaryadnyy-arbalet", "martialR", "mnogozaryadnyy-arbalet"]
];
const EXPECTED_ARMOR = new Map([
  ["styoganyy-dospekh", { type: "light", baseItem: "padded", value: 11, dex: null, strength: 0, stealth: true }],
  ["kozhanyy-dospekh", { type: "light", baseItem: "leather", value: 11, dex: null, strength: 0, stealth: false }],
  ["proklyopannyy-kozhanyy-dospekh", { type: "light", baseItem: "studded", value: 12, dex: null, strength: 0, stealth: false }],
  ["boevaya-bronya-shef-povara", { type: "light", baseItem: "", value: 11, dex: null, strength: 0, stealth: false }],
  ["shkurnyy-dospekh", { type: "medium", baseItem: "hide", value: 12, dex: 2, strength: 0, stealth: false }],
  ["kol-chuzhnaya-rubakha", { type: "medium", baseItem: "chainshirt", value: 13, dex: 2, strength: 0, stealth: false }],
  ["cheshuychatyy-dospekh", { type: "medium", baseItem: "scalemail", value: 14, dex: 2, strength: 0, stealth: true }],
  ["kirasa", { type: "medium", baseItem: "breastplate", value: 14, dex: 2, strength: 0, stealth: false }],
  ["polulaty", { type: "medium", baseItem: "halfplate", value: 15, dex: 2, strength: 0, stealth: true }],
  ["improvizirovannyy-dospekh", { type: "medium", baseItem: "", value: 11, dex: 2, strength: 0, stealth: true }],
  ["kolechnyy-dospekh", { type: "heavy", baseItem: "ringmail", value: 14, dex: null, strength: 0, stealth: true }],
  ["kol-chuga", { type: "heavy", baseItem: "chainmail", value: 16, dex: null, strength: 0, stealth: true }],
  ["nabornyy-dospekh", { type: "heavy", baseItem: "splint", value: 17, dex: null, strength: 13, stealth: true }],
  ["laty", { type: "heavy", baseItem: "plate", value: 18, dex: null, strength: 15, stealth: true }],
  ["pantsir-tortla", { type: "heavy", baseItem: "", value: 17, dex: null, strength: 18, stealth: true }],
  ["shchit", { type: "shield", baseItem: "shield", value: 2, dex: null, strength: 0, stealth: false }],
  ["bakler", { type: "shield", baseItem: "", value: 1, dex: null, strength: 0, stealth: false }],
  ["bashennyy-shchit", { type: "shield", baseItem: "", value: 2, dex: null, strength: 16, stealth: true }],
  ["tyazhelyy-plashch", { type: "light", baseItem: "", value: 11, dex: null, strength: 0, stealth: true }],
  ["kozhanaya-kurtka", { type: "light", baseItem: "", value: 11, dex: null, strength: 0, stealth: false }],
  ["zashchitnaya-rubashka", { type: "light", baseItem: "", value: 11, dex: null, strength: 0, stealth: false }],
  ["listovoy-zhilet", { type: "light", baseItem: "", value: 12, dex: null, strength: 0, stealth: true }],
  ["ukreplennyy-plashch", { type: "light", baseItem: "", value: 12, dex: null, strength: 0, stealth: false }],
  ["mnogosloynyy-bronezhilet", { type: "medium", baseItem: "", value: 13, dex: 2, strength: 0, stealth: false }],
  ["lyogkaya-sluzhebnaya-bronya", { type: "medium", baseItem: "", value: 14, dex: 2, strength: 0, stealth: false }],
  ["takticheskaya-bronya", { type: "medium", baseItem: "", value: 15, dex: 2, strength: 10, stealth: true }],
  ["pekhotnaya-shturmovaya-bronya", { type: "heavy", baseItem: "", value: 16, dex: null, strength: 10, stealth: true }],
  ["tyazhelaya-sluzhebnaya-bronya", { type: "heavy", baseItem: "", value: 17, dex: null, strength: 13, stealth: true }],
  ["sverkhtyazhelaya-shturmovaya-bronya", { type: "heavy", baseItem: "", value: 18, dex: null, strength: 15, stealth: true }],
  ["ukreplennyy-shchit", { type: "shield", baseItem: "", value: 2, dex: null, strength: 13, stealth: false }],
  ["ballisticheskiy-shchit", { type: "shield", baseItem: "", value: 3, dex: null, strength: 15, stealth: true }]
]);
const EXPECTED_AMMUNITION = new Map([
  ["arbaletnye-bolty-20", { sourceName: "Арбалетные болты (20)", sheetQuantity: 20, subtype: "crossbowBolt", sourcePriceGoldEquivalent: 1, sourceWeight: 1.5, actorName: "Арбалетные болты", actorPriceGoldEquivalent: 0.05, actorWeight: 0.075 }],
  ["igly-dlya-trubki-50", { sourceName: "Иглы для трубки (50)", sheetQuantity: 50, subtype: "blowgunNeedle", sourcePriceGoldEquivalent: 1, sourceWeight: 1, actorName: "Иглы для трубки", actorPriceGoldEquivalent: 0.02, actorWeight: 0.02 }],
  ["snaryady-dlya-prashchi-20", { sourceName: "Снаряды для пращи (20)", sheetQuantity: 20, subtype: "slingBullet", sourcePriceGoldEquivalent: 0.04, sourceWeight: 1.5, actorName: "Снаряды для пращи", actorPriceGoldEquivalent: 0.002, actorWeight: 0.075 }],
  ["strely-20", { sourceName: "Стрелы (20)", sheetQuantity: 20, subtype: "arrow", sourcePriceGoldEquivalent: 1, sourceWeight: 1, actorName: "Стрелы", actorPriceGoldEquivalent: 0.05, actorWeight: 0.05 }],
  ["mushketnyy-patron-20", { sourceName: "Мушкетный патрон (20)", sheetQuantity: 20, subtype: "firearmBullet", sourcePriceGoldEquivalent: 20, sourceWeight: 1, actorName: "Мушкетный патрон", actorPriceGoldEquivalent: 1, actorWeight: 0.05 }],
  ["vintovochnyy-patron-10", { sourceName: "Винтовочный патрон (10)", sheetQuantity: 10, subtype: "firearmBullet", sourcePriceGoldEquivalent: 60, sourceWeight: 1, actorName: "Винтовочный патрон", actorPriceGoldEquivalent: 6, actorWeight: 0.1 }],
  ["kartechnyy-patron-20", { sourceName: "Картечный патрон (20)", sheetQuantity: 20, subtype: "firearmBullet", sourcePriceGoldEquivalent: 60, sourceWeight: 2, actorName: "Картечный патрон", actorPriceGoldEquivalent: 3, actorWeight: 0.1 }],
  ["pulevoy-patron-10", { sourceName: "Пулевой патрон (10)", sheetQuantity: 10, subtype: "firearmBullet", sourcePriceGoldEquivalent: 50, sourceWeight: 3, actorName: "Пулевой патрон", actorPriceGoldEquivalent: 5, actorWeight: 0.3 }],
  ["toplivnyy-bak-1", { sourceName: "Топливный бак (1)", sheetQuantity: 1, subtype: "", sourcePriceGoldEquivalent: 12, sourceWeight: 5, actorName: "Топливный бак", actorPriceGoldEquivalent: 12, actorWeight: 5 }],
  ["raketnyy-vystrel-3", { sourceName: "Ракетный выстрел (3)", sheetQuantity: 3, subtype: "", sourcePriceGoldEquivalent: 75, sourceWeight: 9, actorName: "Ракетный выстрел", actorPriceGoldEquivalent: 25, actorWeight: 3 }],
  ["pistoletnyy-patron-20", { sourceName: "Пистолетный патрон (20)", sheetQuantity: 20, subtype: "firearmBullet", sourcePriceGoldEquivalent: 40, sourceWeight: 1, actorName: "Пистолетный патрон", actorPriceGoldEquivalent: 2, actorWeight: 0.05 }],
  ["batareya-4", { sourceName: "Батарея (4)", sheetQuantity: 4, subtype: "", sourcePriceGoldEquivalent: 20, sourceWeight: 3, actorName: "Батарея", actorPriceGoldEquivalent: 5, actorWeight: 0.75 }],
  ["stal-noy-bolt-1", { sourceName: "Стальной болт (1)", sheetQuantity: 1, subtype: "crossbowBolt", sourcePriceGoldEquivalent: 10, sourceWeight: 2, actorName: "Стальной болт", actorPriceGoldEquivalent: 10, actorWeight: 2 }],
  ["zaryad-antimaterii-20", { sourceName: "Заряд антиматерии (20)", sheetQuantity: 20, subtype: "", sourcePriceGoldEquivalent: 400000, sourceWeight: 15, actorName: "Заряд антиматерии", actorPriceGoldEquivalent: 20000, actorWeight: 0.75 }],
  ["teplovaya-batareya-20", { sourceName: "Тепловая батарея (20)", sheetQuantity: 20, subtype: "", sourcePriceGoldEquivalent: 15000, sourceWeight: 10, actorName: "Тепловая батарея", actorPriceGoldEquivalent: 750, actorWeight: 0.5 }],
  ["neletal-nye-puli-20", { sourceName: "Нелетальные пули (20)", sheetQuantity: 20, subtype: "firearmBullet", sourcePriceGoldEquivalent: 80, sourceWeight: 1, actorName: "Нелетальные пули", actorPriceGoldEquivalent: 4, actorWeight: 0.05 }],
  ["serebryannaya-pulya-10", { sourceName: "Серебрянная пуля (10)", sheetQuantity: 10, subtype: "firearmBullet", sourcePriceGoldEquivalent: 100, sourceWeight: 1, actorName: "Серебрянная пуля", actorPriceGoldEquivalent: 10, actorWeight: 0.1 }],
  ["adamantovaya-pulya-10", { sourceName: "Адамантовая пуля (10)", sheetQuantity: 10, subtype: "firearmBullet", sourcePriceGoldEquivalent: 1000, sourceWeight: 1, actorName: "Адамантовая пуля", actorPriceGoldEquivalent: 100, actorWeight: 0.1 }]
]);

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    escapeHTML: (value) => String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;")
  }
};

globalThis.CONST ??= {
  DOCUMENT_OWNERSHIP_LEVELS: {
    OBSERVER: 2
  }
};

test("creates weapon compendium data with damage and Rebreya attack properties", () => {
  const item = {
    id: "test-spear",
    name: "Test Spear",
    equipmentType: "Оружие",
    priceGoldEquivalent: 1,
    weight: 3,
    weapon: {
      damageFormula: "1d6",
      damageType: "piercing",
      versatileDamageFormula: "1d8",
      properties: ["ver", "thr", "lchDash", "lchMku", "lchRku"],
      range: {
        value: 20,
        long: 60,
        reach: 5,
        units: "ft"
      },
      attackTraitsText: "Наскок 2d2; МКУ 1; РКУ 1",
      attackTraits: {
        mku: 1,
        rku: 1
      },
      lichWeaponPropertyValues: {
        dashDice: "2d2",
        mku: 1,
        rku: 1
      }
    }
  };

  const created = createDnd5eItemData(item, new Map());

  assert.equal(created.type, "weapon");
  assert.equal(created.system.damage.base.number, 1);
  assert.equal(created.system.damage.base.denomination, 6);
  assert.deepEqual(created.system.damage.base.custom, {
    enabled: false,
    formula: ""
  });
  assert.deepEqual(created.system.damage.base.types, ["piercing"]);
  assert.equal(created.system.damage.versatile.number, 1);
  assert.equal(created.system.damage.versatile.denomination, 8);
  assert.deepEqual(created.system.damage.versatile.custom, {
    enabled: false,
    formula: ""
  });
  assert.deepEqual(created.system.properties, ["ver", "thr", "lchDash", "lchMku", "lchRku"]);
  assert.deepEqual(created.system.range, {
    value: 20,
    long: 60,
    reach: 5,
    units: "ft"
  });
  assert.deepEqual(created.flags["rebreya-main"].attackTraits, {
    mku: 1,
    rku: 1
  });
  assert.deepEqual(created.flags["rebreya-main"].lichWeaponPropertyValues, {
    dashDice: "2d2",
    mku: 1,
    rku: 1
  });
  assert.equal(created.flags["rebreya-main"].attackTraitsText, "Наскок 2d2; МКУ 1; РКУ 1");
  assert.deepEqual(created.flags["rebreya-main"].handRequirement, {
    requiredHands: 1,
    allowedHands: [1, 2],
    maxHands: 2,
    canUseTwoHands: true,
    mode: "versatile",
    source: null,
    special: false,
    versatile: true,
    versatileDamageFormula: "1d8"
  });
});

test("real gear weapon data maps spreadsheet damage and properties to system keys", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));

  for (const item of gear) {
    const weapon = item.weapon;
    if (!weapon?.damageFormula) {
      continue;
    }

    const expectedDamageType = DAMAGE_TYPE_BY_LABEL.get(weapon.damageTypeLabel);
    assert.ok(expectedDamageType, `${item.id} has unsupported damage type label ${weapon.damageTypeLabel}`);
    assert.equal(weapon.damageType, expectedDamageType, `${item.id} maps ${weapon.damageTypeLabel} to dnd5e damage type`);
  }

  assert.ok(byId.get("kinzhal").weapon.properties.includes("lchDeadly"));
  assert.equal(byId.get("kinzhal").weapon.attackTraits.deadly, 1);
  assert.ok(byId.get("ruchnoy-topor").weapon.properties.includes("lchRku"));
  assert.equal(byId.get("ruchnoy-topor").weapon.attackTraits.rku, 1);
  assert.ok(byId.get("set").weapon.properties.includes("spc"));
  assert.ok(byId.get("arbalet-legkiy").weapon.properties.includes("lod"));
  assert.ok(byId.get("arbalet-legkiy").weapon.properties.includes("lchAim"));
  assert.ok(byId.get("dlinnyy-luk").weapon.properties.includes("lchArcShot"));
  assert.ok(byId.get("molot").weapon.properties.includes("lchPowerStrike"));
  assert.ok(byId.get("molot").weapon.properties.includes("lchPush"));
  assert.ok(byId.get("kavaleriyskaya-pika").weapon.properties.includes("lchMounted"));

  assert.deepEqual(createDnd5eItemData(byId.get("boevoy-posokh"), new Map()).flags["rebreya-main"].handRequirement, {
    requiredHands: 1,
    allowedHands: [1, 2],
    maxHands: 2,
    canUseTwoHands: true,
    mode: "versatile",
    source: "Универсальное (1d8)",
    special: false,
    versatile: true,
    versatileDamageFormula: "1d8"
  });
  assert.deepEqual(createDnd5eItemData(byId.get("kinzhal"), new Map()).flags["rebreya-main"].handRequirement, {
    requiredHands: 1,
    allowedHands: [1],
    maxHands: 1,
    canUseTwoHands: false,
    mode: "oneHanded",
    source: "Одноручное",
    special: false,
    versatile: false,
    versatileDamageFormula: null
  });
  assert.deepEqual(createDnd5eItemData(byId.get("dvuruchnyy-mech"), new Map()).flags["rebreya-main"].handRequirement, {
    requiredHands: 2,
    allowedHands: [2],
    maxHands: 2,
    canUseTwoHands: true,
    mode: "twoHanded",
    source: "Двуручное",
    special: false,
    versatile: false,
    versatileDamageFormula: null
  });
});

test("real firearm gear data maps firearm sheet damage, properties, and attack activity", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));
  const musket = byId.get("mushket");
  const arquebus = byId.get("arkebuza");
  const automaticRifle = byId.get("avtomaticheskaya-vintovka");
  const semiAutomaticRifle = byId.get("poluavtomaticheskaya-vintovka");

  assert.ok(musket?.weapon, "musket has firearm weapon data");
  assert.equal(musket.weapon.damageFormula, "2d8");
  assert.equal(musket.weapon.damageType, "piercing");
  assert.deepEqual(musket.weapon.range, {
    value: 90,
    long: 210,
    reach: 0,
    units: "ft"
  });
  assert.ok(musket.weapon.properties.includes("lchFirearmMisfire"));
  assert.equal(musket.weapon.lichWeaponPropertyValues.misfire, 2);
  assert.ok(musket.weapon.properties.includes("lchFirearmReload"));
  assert.equal(musket.weapon.lichWeaponPropertyValues.reload, "Перезарядка 1");
  assert.ok(musket.weapon.properties.includes("lchFirearmBulky"));
  assert.ok(musket.weapon.properties.includes("lchFirearmProneFire"));

  assert.ok(automaticRifle?.weapon, "automatic rifle has firearm weapon data");
  assert.equal(automaticRifle.weapon.damageFormula, "2d8");
  assert.ok(automaticRifle.weapon.properties.includes("lchFirearmAutomatic"));
  assert.equal(automaticRifle.weapon.lichWeaponPropertyValues.automaticDamage, "4d8");
  assert.ok(semiAutomaticRifle?.weapon, "semi automatic rifle has firearm weapon data");
  assert.ok(semiAutomaticRifle.weapon.properties.includes("lchFirearmSemiAutomatic"));
  assert.equal(semiAutomaticRifle.weapon.lichWeaponPropertyValues.semiAutomaticDamage, "2d12");

  const createdMusket = createDnd5eItemData(musket, new Map());
  const musketActivityIds = Object.keys(createdMusket.system.activities ?? {});
  const musketAttack = Object.values(createdMusket.system.activities ?? {})[0];
  assert.equal(createdMusket.system.damage.base.number, 2);
  assert.equal(createdMusket.system.damage.base.denomination, 8);
  assert.ok(createdMusket.system.properties.includes("lchFirearmMisfire"));
  assert.deepEqual(createdMusket.flags["rebreya-main"].handRequirement, {
    requiredHands: 2,
    allowedHands: [2],
    maxHands: 2,
    canUseTwoHands: true,
    mode: "twoHanded",
    source: "Двуручное",
    special: false,
    versatile: false,
    versatileDamageFormula: null
  });
  assert.equal(musketActivityIds.length, 4);
  assert.ok(musketActivityIds.every((activityId) => /^[A-Za-z0-9]{16}$/u.test(activityId)));
  assert.equal(musketAttack._id, musketActivityIds[0]);
  assert.equal(musketAttack.type, "attack");
  assert.equal(musketAttack.attack.type.value, "firearm");
  assert.equal(musketAttack.attack.type.classification, "weapon");
  assert.equal(musketAttack.attack.ability, "str");

  const musketActivitiesByName = new Map(Object.values(createdMusket.system.activities ?? {})
    .map((activity) => [activity.name, activity]));
  assert.equal(musketActivitiesByName.get("Перезарядить")?.type, "utility");
  assert.equal(musketActivitiesByName.get("Перезарядить")?.activation.type, "action");
  assert.equal(musketActivitiesByName.get("Перезарядить")?.flags["rebreya-main"].automation, "firearm-reload");
  assert.equal(musketActivitiesByName.get("Очистить затвор")?.type, "utility");
  assert.equal(musketActivitiesByName.get("Очистить затвор")?.activation.type, "action");
  assert.equal(musketActivitiesByName.get("Очистить затвор")?.flags["rebreya-main"].automation, "firearm-clear-jam");
  assert.equal(musketActivitiesByName.get("Привести оружие в порядок")?.type, "utility");
  assert.equal(musketActivitiesByName.get("Привести оружие в порядок")?.activation.type, "minute");
  assert.equal(musketActivitiesByName.get("Привести оружие в порядок")?.flags["rebreya-main"].automation, "firearm-maintain");

  const createdAutomaticRifle = createDnd5eItemData(automaticRifle, new Map());
  const automaticRifleActivityIds = new Set(Object.keys(createdAutomaticRifle.system.activities ?? {}));
  const automaticRifleActivitiesByName = new Map(Object.values(createdAutomaticRifle.system.activities ?? {})
    .map((activity) => [activity.name, activity]));
  const automaticFire = automaticRifleActivitiesByName.get("Автоматический огонь");
  assert.equal(automaticFire?.type, "save");
  assert.equal(automaticFire?.activation.type, "action");
  assert.equal(automaticFire?.target.template.type, "cone");
  assert.equal(automaticFire?.target.template.size, 45);
  assert.equal(automaticFire?.target.affects.type, "creature");
  assert.equal(automaticFire?.target.prompt, true);
  assert.deepEqual(automaticFire?.save.ability, ["dex"]);
  assert.equal(automaticFire?.save.dc.calculation, "dex");
  assert.equal(automaticFire?.save.dc.formula, "");
  assert.equal(automaticFire?.damage.onSave, "half");
  assert.equal(automaticFire?.damage.parts[0].number, 4);
  assert.equal(automaticFire?.damage.parts[0].denomination, 8);
  assert.deepEqual(automaticFire?.damage.parts[0].types, ["piercing"]);
  assert.equal(automaticFire?.flags["rebreya-main"].automation, "firearm-automatic-fire");
  assert.match(automaticFire?.description.chatFlavor ?? "", /4d8/u);
  assert.equal(automaticRifleActivityIds.has("lchClearBreech01"), false);
  assert.equal(automaticRifleActivityIds.has("lchMaintainGun01"), false);
  assert.equal(automaticRifleActivitiesByName.get("Очистить затвор"), undefined);
  assert.equal(automaticRifleActivitiesByName.get("Привести оружие в порядок"), undefined);

  const createdSemiAutomaticRifle = createDnd5eItemData(semiAutomaticRifle, new Map());
  const semiAutomaticRifleActivitiesByName = new Map(Object.values(createdSemiAutomaticRifle.system.activities ?? {})
    .map((activity) => [activity.name, activity]));
  const semiAutomaticFire = semiAutomaticRifleActivitiesByName.get("Полуавтоматический огонь");
  assert.equal(semiAutomaticFire?.type, "save");
  assert.equal(semiAutomaticFire?.activation.type, "action");
  assert.equal(semiAutomaticFire?.target.template.type, "cone");
  assert.equal(semiAutomaticFire?.target.template.size, 30);
  assert.equal(semiAutomaticFire?.target.affects.type, "creature");
  assert.equal(semiAutomaticFire?.target.prompt, true);
  assert.deepEqual(semiAutomaticFire?.save.ability, ["dex"]);
  assert.equal(semiAutomaticFire?.save.dc.calculation, "dex");
  assert.equal(semiAutomaticFire?.save.dc.formula, "");
  assert.equal(semiAutomaticFire?.damage.onSave, "half");
  assert.equal(semiAutomaticFire?.damage.parts[0].number, 2);
  assert.equal(semiAutomaticFire?.damage.parts[0].denomination, 12);
  assert.deepEqual(semiAutomaticFire?.damage.parts[0].types, ["piercing"]);
  assert.equal(semiAutomaticFire?.flags["rebreya-main"].automation, "firearm-semi-automatic-fire");
  assert.match(semiAutomaticFire?.description.chatFlavor ?? "", /2d12/u);

  const createdArquebus = createDnd5eItemData(arquebus, new Map());
  const arquebusAttack = Object.values(createdArquebus.system.activities ?? {})[0];
  assert.equal(createdArquebus.system.damage.base.number, 6);
  assert.equal(createdArquebus.system.damage.base.denomination, 4);
  assert.equal(arquebusAttack.attack.type.value, "firearm");
  assert.equal(arquebusAttack.attack.ability, "str");
});

test("ordinary weapons from the weapon sheet use registered dnd5e base weapon ids", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));
  const customDefinitions = new Map(getRebreyaWeaponBaseItemDefinitions()
    .map((definition) => [definition.baseItem, definition]));
  const weaponIdsConfig = buildRebreyaWeaponIdsConfig();

  for (const [gearId, expectedType, expectedBaseItem] of EXPECTED_ORDINARY_WEAPONS) {
    const item = byId.get(gearId);
    assert.ok(item, `ordinary weapon ${gearId} exists in Rebreya gear data`);
    assert.equal(item.equipmentType, "Оружие", `${gearId} remains an ordinary weapon`);

    const created = createDnd5eItemData(item, new Map());
    assert.equal(created._id, createStableGearDocumentId(gearId), `${gearId} uses a stable compendium document id`);
    assert.equal(created.type, "weapon", `${gearId} is created as a dnd5e weapon`);
    assert.equal(created.system.type.value, expectedType, `${gearId} uses ${expectedType}`);
    assert.equal(created.system.type.baseItem, expectedBaseItem, `${gearId} uses base weapon ${expectedBaseItem}`);

    if (!NATIVE_DND5E_WEAPON_BASE_ITEMS.has(expectedBaseItem)) {
      const definition = customDefinitions.get(expectedBaseItem);
      assert.ok(definition, `${expectedBaseItem} is registered as a Rebreya base weapon`);
      assert.equal(definition.gearId, gearId, `${expectedBaseItem} points at the ${gearId} compendium item`);
      assert.equal(
        weaponIdsConfig[expectedBaseItem],
        `Compendium.world.rebreya-gear.Item.${createStableGearDocumentId(gearId)}`,
        `${expectedBaseItem} is exposed through CONFIG.DND5E.weaponIds as a full UUID`
      );
    }
  }
});

test("craftsman tools use stable ids and native dnd5e tool subtypes", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));
  const thievesTools = byId.get("instrumenty-vora");
  const repairTools = byId.get("instrumenty-remontnika");

  assert.ok(thievesTools);
  assert.ok(repairTools);
  assert.equal(createStableGearDocumentId("instrumenty-vora"), "re8ae4d6d637951f");
  assert.equal(createStableGearDocumentId("instrumenty-remontnika"), "r154c7529b59a643");
  assert.equal(createDnd5eItemData(thievesTools, new Map()).system.type.value, "thief");
  assert.equal(createDnd5eItemData(repairTools, new Map()).system.type.value, "art");
});

test("Rebreya artisan tool items use the same base ids and abilities as craftsman proficiencies", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));
  const expected = {
    "instrumenty-alkhimicheskie-0-y-rang": ["rebreyaAlchemy", "int"],
    "instrumenty-kuznetsa-0-y-rang": ["rebreyaSmith", "str"],
    "instrumenty-kalligrafa-0-y-rang": ["rebreyaCalligrapher", "dex"],
    "instrumenty-poddelshchika-0-y-rang": ["rebreyaForgery", "dex"],
    "instrumenty-grimyora-0-y-rang": ["rebreyaDisguise", "cha"],
    "instrumenty-khudozhestvennye-0-y-rang": ["rebreyaArtisan", "wis"],
    "instrumenty-issledovatelya-0-y-rang": ["rebreyaInvestigator", "int"],
    "instrumenty-zhestyanshchika-0-y-rang": ["rebreyaTinker", "dex"],
    "instrumenty-kamneloma-0-y-rang": ["rebreyaMason", "str"],
    "instrumenty-kozhedela-0-y-rang": ["rebreyaLeatherworker", "dex"],
    "instrumenty-pivovara-0-y-rang": ["rebreyaBrewer", "int"],
    "instrumenty-derevyanshchika-0-y-rang": ["rebreyaWoodcarver", "dex"],
    "instrumenty-povara-0-y-rang": ["rebreyaCook", "wis"],
    "instrumenty-yuvelira-0-y-rang": ["rebreyaJeweler", "int"]
  };

  for (const [gearId, [baseItem, ability]] of Object.entries(expected)) {
    const source = byId.get(gearId);
    assert.ok(source, `${gearId} exists in Rebreya gear data`);
    const item = createDnd5eItemData(source, new Map());
    assert.equal(item.type, "tool");
    assert.equal(item.system.type.value, "art");
    assert.equal(item.system.type.baseItem, baseItem);
    assert.equal(item.system.ability, ability);
  }
});

test("real gear armor data maps every armor sheet row to dnd5e armor system keys", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));

  for (const [gearId, expected] of EXPECTED_ARMOR) {
    const item = byId.get(gearId);
    assert.ok(item, `armor ${gearId} exists in Rebreya gear data`);
    assert.equal(item.armor?.type, expected.type, `${gearId} stores armor type from the armor sheet`);
    assert.equal(item.armor?.value, expected.value, `${gearId} stores AC value from the armor sheet`);
    assert.equal(item.armor?.dex, expected.dex, `${gearId} stores dex cap from the armor sheet`);
    assert.equal(item.armor?.strength, expected.strength, `${gearId} stores strength requirement from the armor sheet`);
    assert.equal(
      (item.armor?.properties ?? []).includes("stealthDisadvantage"),
      expected.stealth,
      `${gearId} stores stealth disadvantage from the armor sheet`
    );

    const created = createDnd5eItemData(item, new Map());
    assert.equal(created.type, "equipment", `${gearId} is created as dnd5e equipment`);
    assert.equal(created.system.type.value, expected.type, `${gearId} uses the expected equipment armor type`);
    assert.equal(created.system.type.baseItem, expected.baseItem, `${gearId} uses the expected base armor id`);
    assert.equal(created.system.armor.value, expected.value, `${gearId} emits armor.value`);
    assert.equal(created.system.armor.dex, expected.dex, `${gearId} emits armor.dex`);
    assert.equal(created.system.strength, expected.strength, `${gearId} emits strength requirement`);
    assert.equal(
      (created.system.properties ?? []).includes("stealthDisadvantage"),
      expected.stealth,
      `${gearId} emits stealth disadvantage`
    );
  }
});

test("real gear ammunition rows create dnd5e consumable ammo items", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));

  for (const [gearId, expected] of EXPECTED_AMMUNITION) {
    const item = byId.get(gearId);
    assert.ok(item, `ammunition ${gearId} exists in Rebreya gear data`);
    assert.equal(item.equipmentType, "Боеприпас", `${gearId} uses the ammunition equipment type from the sheet`);
    assert.equal(item.name, expected.sourceName, `${gearId} keeps the source pack size in Rebreya gear data`);
    assert.equal(item.priceGoldEquivalent, expected.sourcePriceGoldEquivalent, `${gearId} stores source pack price as gp equivalent`);
    assert.equal(item.weight, expected.sourceWeight, `${gearId} stores source pack weight`);

    const created = createDnd5eItemData(item, new Map());
    assert.equal(created.name, expected.actorName, `${gearId} drops the pack suffix on the dnd5e item`);
    assert.equal(created.type, "consumable", `${gearId} is created as a dnd5e consumable`);
    assert.equal(created.system.quantity, expected.sheetQuantity, `${gearId} creates one actor stack per source pack`);
    assert.equal(created.system.weight.value, expected.actorWeight, `${gearId} creates dnd5e item with one-piece weight`);
    assert.equal(created.system.type.value, "ammo", `${gearId} uses dnd5e ammo type`);
    assert.equal(created.system.type.subtype, expected.subtype, `${gearId} uses expected ammo subtype`);
    assert.equal(created.flags["rebreya-main"].foundrySubtype, "ammo");
    assert.equal(created.flags["rebreya-main"].foundrySubtypeExtra, expected.subtype);
    assert.equal(created.flags["rebreya-main"].sourcePackQuantity, expected.sheetQuantity);
    assert.equal(created.flags["rebreya-main"].sourcePackPriceGoldEquivalent, expected.sourcePriceGoldEquivalent);
    assert.equal(created.flags["rebreya-main"].sourcePackWeight, expected.sourceWeight);
    assert.equal(created.flags["rebreya-main"].priceGoldEquivalent, expected.actorPriceGoldEquivalent);
  }
});

test("Rebreya weapon ids can point at live gear documents instead of predicted ids", () => {
  const weaponIdsConfig = buildRebreyaWeaponIdsConfig(new Map([
    ["katana", "Compendium.world.rebreya-gear.Item.liveKatanaDoc"]
  ]));

  assert.equal(
    weaponIdsConfig.katana,
    "Compendium.world.rebreya-gear.Item.liveKatanaDoc"
  );
  assert.equal(
    weaponIdsConfig.palash,
    `Compendium.world.rebreya-gear.Item.${createStableGearDocumentId("palash")}`
  );
});

test("Rebreya weapon base items register from the live gear pack index", async () => {
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  globalThis.game = {
    system: { id: "dnd5e" },
    packs: {
      get: () => null
    }
  };
  globalThis.CONFIG = {
    DND5E: {
      weaponIds: {}
    }
  };

  try {
    assert.equal(await registerRebreyaWeaponBaseItemsFromGearPack(), false);
    assert.equal(CONFIG.DND5E.weaponIds.katana, undefined);

    globalThis.game.packs.get = (packId) => packId === "world.rebreya-gear"
      ? {
          collection: "world.rebreya-gear",
          getIndex: async () => [
            {
              _id: "liveKatanaDoc",
              uuid: "Compendium.world.rebreya-gear.Item.liveKatanaDoc",
              name: "Катана",
              flags: {
                "rebreya-main": {
                  gearId: "katana",
                  sourceType: "gear"
                }
              },
              system: {
                type: {
                  baseItem: "katana"
                }
              }
            }
          ]
        }
      : null;
    assert.equal(await registerRebreyaWeaponBaseItemsFromGearPack(), true);
    assert.equal(
      CONFIG.DND5E.weaponIds.katana,
      "Compendium.world.rebreya-gear.Item.liveKatanaDoc"
    );
  }
  finally {
    globalThis.game = previousGame;
    globalThis.CONFIG = previousConfig;
  }
});

test("primary gear compendium documents preserve stable ids when created", () => {
  assert.deepEqual(
    getPrimaryGearDocumentCreateOptions({ collection: "world.rebreya-gear" }),
    { pack: "world.rebreya-gear", keepId: true }
  );
});

test("gear compendium delegates managed lifecycle to the shared diff synchronizer", () => {
  const source = readFileSync(new URL("../scripts/data/gear-compendium.js", import.meta.url), "utf8");

  assert.match(source, /syncManagedDocuments/u);
  assert.doesNotMatch(source, /function shouldRebuildPack/u);
  assert.doesNotMatch(source, /async function deleteManagedDocuments/u);
  assert.doesNotMatch(source, /async function createManagedDocuments/u);
});

test("gear signatures include stable document ids so old compendium documents rebuild", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const katana = gear.find((item) => item.id === "katana");
  const created = createDnd5eItemData(katana, new Map());
  const signature = JSON.parse(created.flags["rebreya-main"].signature);

  assert.equal(signature.templateVersion, 18);
  assert.equal(created._id, createStableGearDocumentId("katana"));
  assert.equal(signature.stableDocumentId, created._id);
});

test("gear stock icons avoid missing Foundry core asset paths", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));
  const knownMissingStockIcons = new Set([
    "icons/consumables/potions/potion-bottle-corked-red.webp",
    "icons/containers/bags/pack-simple-brown.webp",
    "icons/equipment/shield/heater-steel-blue.webp",
    "icons/tools/hand/wrench-double-headed.webp",
    "icons/weapons/ammunition/arrows-war-quiver-brown.webp",
    "icons/weapons/guns/gun-pistol-flintlock-blue.webp"
  ]);

  for (const item of gear) {
    const created = createDnd5eItemData(item, new Map());
    assert.ok(
      !knownMissingStockIcons.has(created.img),
      `${item.id} uses missing stock icon path ${created.img}`
    );
  }

  assert.equal(createDnd5eItemData(byId.get("dlinnyy-luk"), new Map()).img, "icons/weapons/bows/longbow-recurve-brown.webp");
  assert.equal(createDnd5eItemData(byId.get("arbalet-legkiy"), new Map()).img, "icons/weapons/crossbows/crossbow-simple-brown.webp");
  assert.equal(createDnd5eItemData(byId.get("prashcha"), new Map()).img, "icons/weapons/slings/slingshot-wood.webp");
  assert.equal(createDnd5eItemData(byId.get("mushket"), new Map()).img, "icons/weapons/guns/gun-pistol-flintlock-metal.webp");
  assert.equal(createDnd5eItemData(byId.get("shchit"), new Map()).img, "icons/equipment/shield/heater-steel-grey.webp");
  assert.equal(createDnd5eItemData(byId.get("ryukzak"), new Map()).img, "icons/containers/bags/pack-simple-leather-brown.webp");
  assert.equal(createDnd5eItemData(byId.get("zel-e-lecheniya-1-go-urovnya"), new Map()).img, "icons/consumables/potions/potion-bottle-corked-labeled-red.webp");
  assert.equal(createDnd5eItemData(byId.get("kollimatornyy-pritsel"), new Map()).img, "icons/tools/hand/wrench-steel-grey.webp");
});

test("gear custom icons override stock fallbacks by item name", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));
  const iconLookup = new Map([
    ["абак", "modules/rebreya-main/templates/icons/Goods/%D0%90%D0%B1%D0%B0%D0%BA.webp"],
    ["мушкет", "modules/rebreya-main/templates/icons/weapons/%D0%9C%D1%83%D1%88%D0%BA%D0%B5%D1%82.webp"]
  ]);

  assert.equal(
    createDnd5eItemData(byId.get("abak"), new Map(), iconLookup).img,
    "modules/rebreya-main/templates/icons/Goods/%D0%90%D0%B1%D0%B0%D0%BA.webp"
  );
  assert.equal(
    createDnd5eItemData(byId.get("mushket"), new Map(), iconLookup).img,
    "modules/rebreya-main/templates/icons/weapons/%D0%9C%D1%83%D1%88%D0%BA%D0%B5%D1%82.webp"
  );
});

test("gear custom icons can match shortened and type-qualified item names", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));
  const iconLookup = new Map([
    ["алхимический огонь", "modules/rebreya-main/templates/icons/Goods/%D0%90%D0%BB%D1%85%D0%B8%D0%BC%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D0%B9%20%D0%BE%D0%B3%D0%BE%D0%BD%D1%8C.webp"],
    ["коготь чудовища имплант", "modules/rebreya-main/templates/icons/Goods/%D0%9A%D0%BE%D0%B3%D0%BE%D1%82%D1%8C%20%D1%87%D1%83%D0%B4%D0%BE%D0%B2%D0%B8%D1%89%D0%B0%20(%D0%B8%D0%BC%D0%BF%D0%BB%D0%B0%D0%BD%D1%82).webp"],
    ["коготь чудовища усовершенствование", "modules/rebreya-main/templates/icons/Goods/%D0%9A%D0%BE%D0%B3%D0%BE%D1%82%D1%8C%20%D1%87%D1%83%D0%B4%D0%BE%D0%B2%D0%B8%D1%89%D0%B0%20(%D1%83%D1%81%D0%BE%D0%B2%D0%B5%D1%80%D1%88%D0%B5%D0%BD%D1%81%D1%82%D0%B2%D0%BE%D0%B2%D0%B0%D0%BD%D0%B8%D0%B5).webp"]
  ]);

  assert.equal(
    createDnd5eItemData(byId.get("alkhimicheskiy-ogon-flyaga"), new Map(), iconLookup).img,
    "modules/rebreya-main/templates/icons/Goods/%D0%90%D0%BB%D1%85%D0%B8%D0%BC%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D0%B9%20%D0%BE%D0%B3%D0%BE%D0%BD%D1%8C.webp"
  );
  assert.equal(
    createDnd5eItemData(byId.get("kogot-chudovishcha"), new Map(), iconLookup).img,
    "modules/rebreya-main/templates/icons/Goods/%D0%9A%D0%BE%D0%B3%D0%BE%D1%82%D1%8C%20%D1%87%D1%83%D0%B4%D0%BE%D0%B2%D0%B8%D1%89%D0%B0%20(%D0%B8%D0%BC%D0%BF%D0%BB%D0%B0%D0%BD%D1%82).webp"
  );
  assert.equal(
    createDnd5eItemData(byId.get("kogot-chudovishcha-2"), new Map(), iconLookup).img,
    "modules/rebreya-main/templates/icons/Goods/%D0%9A%D0%BE%D0%B3%D0%BE%D1%82%D1%8C%20%D1%87%D1%83%D0%B4%D0%BE%D0%B2%D0%B8%D1%89%D0%B0%20(%D1%83%D1%81%D0%BE%D0%B2%D0%B5%D1%80%D1%88%D0%B5%D0%BD%D1%81%D1%82%D0%B2%D0%BE%D0%B2%D0%B0%D0%BD%D0%B8%D0%B5).webp"
  );
});

test("nested Goods icon paths stay URL encoded in named icon lookup", async () => {
  const originalFilePicker = globalThis.FilePicker;
  globalThis.FilePicker = function MockFilePicker() {
  };
  globalThis.FilePicker.browse = async (_source, path) => {
    assert.equal(path, "modules/rebreya-main/templates/icons/Goods");
    return {
      files: ["modules/rebreya-main/templates/icons/Goods/Абак.webp"],
      dirs: []
    };
  };

  try {
    const iconLookup = await buildNamedIconLookup(["modules/rebreya-main/templates/icons/Goods"], { forceRefresh: true });
    assert.equal(
      iconLookup.get("абак"),
      "modules/rebreya-main/templates/icons/Goods/%D0%90%D0%B1%D0%B0%D0%BA.webp"
    );
  }
  finally {
    globalThis.FilePicker = originalFilePicker;
  }
});

test("gear data defines D&D equipment packs as Rebreya containers", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));

  for (const [packId, expectedContents] of Object.entries(EQUIPMENT_PACK_CONTENTS)) {
    const pack = byId.get(packId);
    assert.ok(pack, `${packId} exists`);
    assert.equal(pack.foundryType, "container", `${packId} is a dnd5e container`);
    assert.equal(pack.foundrySubtype, packId === "nabor-diplomata" ? "chest" : "backpack");
    assert.ok(pack.containerCapacity?.weight > 0, `${packId} has weight capacity`);
    assert.deepEqual(
      pack.containerContents.map((entry) => [entry.gearId, entry.quantity ?? 1]),
      expectedContents,
      `${packId} contains the expected Rebreya item ids`
    );

    for (const [gearId] of expectedContents) {
      assert.ok(byId.has(gearId), `${packId} references existing Rebreya gear ${gearId}`);
    }
  }
});

test("creates container compendium data with dnd5e capacity and Rebreya contents flag", () => {
  const created = createDnd5eItemData({
    id: "test-pack",
    name: "Test Pack",
    equipmentType: "Наборы снаряжения",
    foundryType: "container",
    foundrySubtype: "backpack",
    priceGoldEquivalent: 12,
    weight: 5,
    containerCapacity: {
      weight: 30,
      units: "lb"
    },
    containerContents: [
      { gearId: "svecha", quantity: 5 }
    ]
  }, new Map());

  assert.equal(created.type, "container");
  assert.equal(created.img, "icons/containers/bags/pack-simple-leather-brown.webp");
  assert.equal(created.system.type.value, "backpack");
  assert.equal(created.system.capacity.weight.value, 30);
  assert.equal(created.system.capacity.weight.units, "lb");
  assert.deepEqual(created.flags["rebreya-main"].containerContents, [
    { gearId: "svecha", quantity: 5 }
  ]);
});

test("creates contained compendium documents linked to their parent container", async () => {
  const module = await import("../scripts/data/gear-compendium.js");

  assert.equal(typeof module.createDnd5eContainerContentData, "function");

  const docs = module.createDnd5eContainerContentData(
    {
      id: "test-pack",
      name: "Test Pack",
      containerContents: [
        { gearId: "svecha", quantity: 5 }
      ]
    },
    new Map([[
      "svecha",
      {
        id: "svecha",
        name: "Свеча",
        equipmentType: "Снаряжение",
        priceGoldEquivalent: 0.01,
        weight: 0
      }
    ]]),
    "parentContainerId",
    new Map()
  );

  assert.equal(docs.length, 1);
  assert.equal(docs[0].name, "Свеча");
  assert.equal(docs[0].system.quantity, 5);
  assert.equal(docs[0].system.container, "parentContainerId");
  assert.equal(docs[0].flags["rebreya-main"].sourceType, "gearContainerContent");
  assert.equal(docs[0].flags["rebreya-main"].containerGearId, "test-pack");
  assert.equal(docs[0].flags["rebreya-main"].containerContentGearId, "svecha");
  assert.equal(docs[0].flags["rebreya-main"].containerContentId, "test-pack::svecha");
  assert.equal(docs[0].flags["rebreya-main"].gearId, undefined);
});

test("normalizes gear without dropping weapon data before compendium sync", () => {
  const weapon = {
    damageFormula: "1d8",
    damageType: "slashing",
    properties: ["ver", "lchGrip"],
    range: {
      value: 0,
      long: 0,
      reach: 5,
      units: "ft"
    },
    lichWeaponPropertyValues: {
      gripModes: "Смена хвата"
    }
  };

  const armor = {
    type: "heavy",
    baseItem: "chainmail",
    value: 16,
    dex: null,
    strength: 0,
    properties: ["stealthDisadvantage"]
  };

  const normalized = normalizeEconomyDataset({
    goods: [],
    regions: [],
    cities: [],
    materials: [],
    reference: {},
    gear: [{
      id: "dlinnyy-mech",
      name: "Длинный меч",
      equipmentType: "Оружие",
      weapon,
      armor
    }]
  });

  assert.deepEqual(normalized.gear[0].weapon, weapon);
  assert.deepEqual(normalized.gear[0].armor, armor);
});
