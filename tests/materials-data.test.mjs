import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TextDecoder } from "node:util";

const MATERIALS_URL = new URL("../data/materials.json", import.meta.url);
const FIXTURE_URL = new URL("./fixtures/materials-encyclopedia.json", import.meta.url);
const SPREADSHEET_ID = "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk";
const SHEET_NAME = "Энциклопедия материалов";
const CSV_SHA256 = "AF2E69169C70CB4165A671502C87AC96CD9D549B6E3E19BEDDF401FEEC5DEE82";
const SOURCE_ROW_COUNT = 247;
const ORIGINAL_MATERIAL_COUNT = 45;

const materialBytes = readFileSync(MATERIALS_URL);
const materialText = new TextDecoder("utf-8", { fatal: true }).decode(materialBytes);
const materials = JSON.parse(materialText);
const fixture = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));

function normalizeIdentifier(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function parseNullableNumber(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+(?:зм|фнт)$/u, "")
    .replace(/\s+/gu, "")
    .replace(",", ".");

  if (!text) {
    return null;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function expectedSourceMaterial({ row, cells }) {
  return {
    name: normalizeIdentifier(cells[0]),
    type: normalizeIdentifier(cells[1]),
    subtype: normalizeIdentifier(cells[2]),
    priceGold: parseNullableNumber(cells[3]),
    weight: parseNullableNumber(cells[4]),
    rank: parseNullableNumber(cells[5]),
    description: cells[6],
    applications: {
      upgrade: cells[7],
      implant: cells[8],
      crafting: cells[9],
      alchemy: cells[10],
      knowledge: cells[11]
    },
    alchemyAspects: cells[12],
    source: {
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      row
    },
    isSynthetic: false
  };
}

function sourceProjection(material) {
  return {
    name: material.name,
    type: material.type,
    subtype: material.subtype,
    priceGold: material.priceGold,
    weight: material.weight,
    rank: material.rank,
    description: material.description,
    applications: material.applications,
    alchemyAspects: material.alchemyAspects,
    source: material.source,
    isSynthetic: material.isSynthetic
  };
}

test("materials fixture is a raw positional snapshot of CSV rows 3-249", () => {
  assert.equal(fixture.spreadsheetId, SPREADSHEET_ID);
  assert.equal(fixture.sheetName, SHEET_NAME);
  assert.equal(fixture.csvSha256, CSV_SHA256);
  assert.deepEqual(fixture.columns, [..."ABCDEFGHIJKLM"]);
  assert.equal(fixture.sourceRows.length, SOURCE_ROW_COUNT);
  assert.deepEqual(
    fixture.sourceRows.map(({ row }) => row),
    Array.from({ length: SOURCE_ROW_COUNT }, (_, index) => index + 3)
  );
  assert.ok(fixture.sourceRows.every(({ cells }) => Array.isArray(cells) && cells.length === 13));
  assert.equal(Object.keys(fixture.originalMaterialIds).length, ORIGINAL_MATERIAL_COUNT);

  assert.equal(fixture.sourceRows.find(({ row }) => row === 43).cells[7], "Малое зачарование  остроты, защиты и стойкости");
  assert.equal(fixture.sourceRows.find(({ row }) => row === 171).cells[6].endsWith(" "), true);
});

test("materials data is valid UTF-8 and matches every raw source row", () => {
  assert.ok(Array.isArray(materials));
  assert.equal(materials.length, SOURCE_ROW_COUNT);
  assert.doesNotMatch(materialText, /\uFFFD/u);

  const bySourceRow = new Map(materials.map((material) => [material.source?.row, material]));
  for (const sourceRow of fixture.sourceRows) {
    const actual = bySourceRow.get(sourceRow.row);
    assert.ok(actual, `source row ${sourceRow.row} is present`);
    assert.deepEqual(
      sourceProjection(actual),
      expectedSourceMaterial(sourceRow),
      `source row ${sourceRow.row} preserves A:M`
    );
  }
});

test("materials data adds 202 records and preserves all 45 historical ids", () => {
  const byName = new Map(materials.map((material) => [material.name, material]));
  const originalEntries = Object.entries(fixture.originalMaterialIds);
  const additions = materials.filter((material) => !Object.hasOwn(fixture.originalMaterialIds, material.name));

  assert.equal(originalEntries.length, ORIGINAL_MATERIAL_COUNT);
  assert.equal(additions.length, SOURCE_ROW_COUNT - ORIGINAL_MATERIAL_COUNT);
  for (const [name, id] of originalEntries) {
    assert.equal(byName.get(name)?.id, id, `${name} keeps historical id ${id}`);
  }
});

test("materials ids and names are non-empty and unique", () => {
  const ids = materials.map((material) => String(material.id ?? "").trim());
  const names = materials.map((material) => String(material.name ?? "").trim().toLocaleLowerCase("ru"));

  assert.ok(ids.every(Boolean));
  assert.ok(names.every(Boolean));
  assert.equal(new Set(ids).size, SOURCE_ROW_COUNT);
  assert.equal(new Set(names).size, SOURCE_ROW_COUNT);
});

test("catalog includes all base raw rows, alchemy reagents, and nullable/decorated numbers", () => {
  const byName = new Map(materials.map((material) => [material.name, material]));
  const toolLabels = [
    "Воровские",
    "Алхимические",
    "Кузнеца",
    "Каллиграфа",
    "Поддельщика",
    "Гримёра",
    "Художественные",
    "Исследователя",
    "Жестянщика",
    "Камнелома",
    "Кожедела",
    "Пивовара",
    "Деревянщика",
    "Повара",
    "Ювелира"
  ];

  for (const label of toolLabels) {
    assert.ok(byName.has(`Базовое сырье для Инструменты ${label}`), `${label} base raw material exists`);
  }
  assert.ok(byName.has("Алхимические реагенты"));

  const trollBones = byName.get("Кости тролля");
  assert.equal(trollBones.priceGold, null);
  assert.equal(trollBones.weight, null);
  assert.equal(trollBones.rank, null);

  const thievesRaw = byName.get("Базовое сырье для Инструменты Воровские");
  assert.equal(thievesRaw.priceGold, 1, "decorated '1 зм' parses to 1");
  assert.equal(thievesRaw.weight, 0.1, "decorated '0,1 фнт' parses to 0.1");
  assert.equal(thievesRaw.rank, null);
});
