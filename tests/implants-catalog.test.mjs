import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MODULE_ID } from "../scripts/constants.js";
import { createDnd5eItemData } from "../scripts/data/gear-compendium.js";
import { normalizeEconomyDataset } from "../scripts/data/normalizer.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = join(TESTS_DIR, "..");

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value))
  }
};
globalThis.CONST ??= {
  DOCUMENT_OWNERSHIP_LEVELS: {
    OBSERVER: 2
  }
};

function loadImplants() {
  return JSON.parse(readFileSync(join(MODULE_DIR, "data", "implants.json"), "utf8"));
}

test("implant catalog preserves all named spreadsheet rows and exact armor metadata", () => {
  const implants = loadImplants();
  assert.equal(implants.length, 90);

  const armor = implants.find((entry) => entry.name === "Навесная броня");
  assert.ok(armor);
  assert.equal(armor.rank, 3);
  assert.equal(armor.implant.pointsText, "1");
  assert.equal(armor.implant.pointsMin, 1);
  assert.equal(armor.implant.pointsMax, 1);
  assert.equal(armor.implant.type, "Общая");
  assert.equal(armor.implant.kind, "mechanical");
  assert.equal(armor.implant.magical, false);
  assert.match(armor.implant.effect, /\+1 к КД/u);
  assert.equal(armor.implant.requirements, "—");
});

test("implant catalog preserves variable costs and magical classification", () => {
  const implants = loadImplants();
  const condenser = implants.find((entry) => entry.name === "Конденсатор магии (М)");
  assert.deepEqual(
    {
      text: condenser.implant.pointsText,
      min: condenser.implant.pointsMin,
      max: condenser.implant.pointsMax
    },
    { text: "1–5", min: 1, max: 5 }
  );

  for (const name of ["Кости Тролля", "Кожа кракена", "Панцирь кристального левиафана"]) {
    const implant = implants.find((entry) => entry.name === name);
    assert.equal(implant.implant.kind, "magical", name);
    assert.equal(implant.implant.magical, true, name);
  }
});

test("gear normalization and Foundry Item creation preserve implant data", () => {
  const source = loadImplants().find((entry) => entry.name === "Навесная броня");
  const normalized = normalizeEconomyDataset({
    goods: [],
    regions: [],
    cities: [],
    reference: {},
    materials: [],
    gear: [source]
  }).gear[0];

  assert.deepEqual(normalized.implant, source.implant);

  const itemData = createDnd5eItemData(
    normalized,
    new Map([[normalized.foundryFolder, "implant-folder"]])
  );
  assert.equal(itemData.type, "equipment");
  assert.deepEqual(itemData.flags[MODULE_ID].implant, source.implant);
  assert.match(itemData.system.description.value, /Очки модификации/u);
  assert.match(itemData.system.description.value, /Навесная броня|\+1 к КД/u);
});

test("builtin importer merges implant rules into existing implant gear without duplicate Items", async () => {
  const source = readFileSync(join(MODULE_DIR, "scripts", "data", "importer.js"), "utf8");
  assert.match(source, /implants\.json/u);
  assert.match(source, /mergeGearWithImplants/u);

  const importer = await import(`../scripts/data/importer.js?implant-merge-test=${Date.now()}`);
  assert.equal(typeof importer.mergeGearWithImplants, "function");

  const gear = JSON.parse(
    readFileSync(join(MODULE_DIR, "data", "gear.json"), "utf8").replace(/^\uFEFF/u, "")
  );
  const implants = loadImplants();
  const merged = importer.mergeGearWithImplants(gear, implants);
  const mergedImplants = merged.filter((entry) => entry.equipmentType === "Имплант");
  const implantNames = mergedImplants.map((entry) => entry.name);

  assert.equal(mergedImplants.length, implants.length);
  assert.equal(mergedImplants.every((entry) => entry.implant), true);
  assert.equal(new Set(implantNames).size, implantNames.length);
  assert.equal(merged.length, gear.length + implants.length - 52);

  const armor = mergedImplants.find((entry) => entry.name === "Навесная броня");
  assert.equal(armor.id, "navesnaya-bronya");
  assert.equal(armor.shopSubtype, "Клиника аугментаций");
  assert.equal(armor.predominantMaterialName, "Сталь");
  assert.equal(armor.linkedTool, "Жестянщика");
  assert.match(armor.description, /бронепластин/u);
  assert.equal(armor.foundryType, "equipment");
  assert.equal(armor.implant.automationKey, "mounted-armor-ac");
  assert.match(armor.implant.effect, /\+1 к КД/u);
  assert.equal(
    merged.some((entry) => entry.id === "implant-navesnaya-bronya"),
    false
  );
  const mergedArmorItem = createDnd5eItemData(
    normalizeEconomyDataset({
      goods: [],
      regions: [],
      cities: [],
      reference: {},
      materials: [],
      gear: [armor]
    }).gear[0],
    new Map([[armor.foundryFolder, "implant-folder"]])
  );
  assert.match(mergedArmorItem.system.description.value, /бронепластин/u);
  assert.match(mergedArmorItem.system.description.value, /\+1 к КД/u);

  for (const [name, expectedId] of [
    ["Настроенные сервоприводы", "nastroennye-servoprivody"],
    ["Сокрушительные конечности", "sokrushitelnye-konechnosti"],
    ["Конденсатор магии", "kondensator-magii"],
    ["Модуль чувства жизни", "modul-chuvstva-zhizni"],
    ["Телепатический модуль", "telepaticheskiy-modul"],
    ["Язык чудовища", "yazyk-chudovishcha"],
    ["Модуль имитации речи", "modul-imitatsii-rechi"],
    ["Искусственный глаз", "iskusstvennyy-glaz"]
  ]) {
    const item = mergedImplants.find((entry) => entry.id === expectedId);
    assert.equal(item?.name, name);
    assert.ok(item?.implant, name);
  }

  const lightweightBodies = merged.filter((entry) => entry.name === "Облегчённый корпус");
  assert.deepEqual(
    lightweightBodies.map((entry) => entry.equipmentType).sort(),
    ["Имплант", "Обвес"]
  );
});
