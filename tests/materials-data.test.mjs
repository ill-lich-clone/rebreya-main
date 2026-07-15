import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TextDecoder } from "node:util";

const MATERIALS_URL = new URL("../data/materials.json", import.meta.url);
const GOODS_URL = new URL("../data/goods.json", import.meta.url);
const SPREADSHEET_ID = "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk";
const SHEET_NAME = "Энциклопедия материалов";
const SOURCE_ROW_COUNT = 247;

const materialBytes = readFileSync(MATERIALS_URL);
const materialText = new TextDecoder("utf-8", { fatal: true }).decode(materialBytes);
const goods = JSON.parse(readFileSync(GOODS_URL, "utf8"));

let materials = null;
let materialParseError = null;
try {
  materials = JSON.parse(materialText);
}
catch (error) {
  materialParseError = error;
}

test("materials data is a valid UTF-8 JSON array without mojibake", () => {
  assert.equal(materialParseError, null);
  assert.ok(Array.isArray(materials));
  assert.doesNotMatch(materialText, /Р[Ўњ]|\uFFFD/u);
});

test("materials data contains all source rows and only necessary synthetic goods", () => {
  assert.ok(Array.isArray(materials));

  const sourceMaterials = materials.filter((material) => material.isSynthetic === false);
  const syntheticMaterials = materials.filter((material) => material.isSynthetic === true);
  const sourceGoodIds = new Set(sourceMaterials.map((material) => material.linkedGoodId).filter(Boolean));
  const expectedSyntheticGoodIds = goods
    .filter((good) => !sourceGoodIds.has(good.id))
    .map((good) => good.id)
    .sort();

  assert.equal(sourceMaterials.length, SOURCE_ROW_COUNT);
  assert.equal(materials.length, SOURCE_ROW_COUNT + expectedSyntheticGoodIds.length);
  assert.deepEqual(
    syntheticMaterials.map((material) => material.linkedGoodId).sort(),
    expectedSyntheticGoodIds
  );
});

test("materials data has unique non-empty ids and names", () => {
  assert.ok(Array.isArray(materials));

  const ids = materials.map((material) => String(material.id ?? "").trim());
  const names = materials.map((material) => String(material.name ?? "").trim());
  assert.ok(ids.every(Boolean));
  assert.ok(names.every(Boolean));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length);
});

test("source metadata and synthetic flags are consistent", () => {
  assert.ok(Array.isArray(materials));

  const sourceRows = [];
  for (const material of materials) {
    if (material.isSynthetic) {
      assert.equal(material.source, "synthetic-from-goods", material.name);
      continue;
    }

    assert.deepEqual(material.source, {
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      row: material.source?.row
    }, material.name);
    assert.ok(Number.isInteger(material.source.row), material.name);
    sourceRows.push(material.source.row);
  }

  assert.deepEqual(sourceRows, Array.from({ length: SOURCE_ROW_COUNT }, (_, index) => index + 3));
});

test("source materials preserve positional application and alchemy columns", () => {
  assert.ok(Array.isArray(materials));

  for (const material of materials.filter((entry) => !entry.isSynthetic)) {
    assert.deepEqual(Object.keys(material.applications ?? {}), [
      "upgrade",
      "implant",
      "crafting",
      "alchemy",
      "knowledge"
    ], material.name);
    assert.ok(Object.values(material.applications).every((value) => typeof value === "string"), material.name);
    assert.equal(typeof material.alchemyAspects, "string", material.name);
  }

  const wool = materials.find((material) => material.name === "Шерсть чудовища");
  assert.deepEqual(wool?.applications, {
    upgrade: "Недоступно",
    implant: "Недоступно",
    crafting: "Немагическая одежда",
    alchemy: "Компонент согревающих и защитных мазей",
    knowledge: "Недоступно"
  });
  assert.equal(wool?.alchemyAspects, "—");
  assert.equal(wool?.source.row, 3);

  const manaShard = materials.find((material) => material.name === "Осколок маны");
  assert.equal(
    manaShard?.applications.upgrade,
    "Малое зачарование  остроты, защиты и стойкости",
    "application text keeps the source cell's double space"
  );
  assert.equal(manaShard?.source.row, 43);
});

test("base raw materials are present and existing ids stay stable", () => {
  assert.ok(Array.isArray(materials));

  const byName = new Map(materials.map((material) => [material.name, material]));
  for (const name of [
    "Базовое сырье для Инструменты Кузнеца",
    "Железо",
    "Глина",
    "Дерево",
    "Хлопок",
    "Алхимические реагенты"
  ]) {
    assert.ok(byName.has(name), `${name} is present`);
  }

  assert.deepEqual(
    Object.fromEntries(["Железо", "Сталь", "Дерево", "Кожа", "Порох", "Мёд"]
      .map((name) => [name, byName.get(name)?.id])),
    {
      "Железо": "zhelezo",
      "Сталь": "stal",
      "Дерево": "derevo",
      "Кожа": "kozha",
      "Порох": "porokh",
      "Мёд": "myod"
    }
  );
});
