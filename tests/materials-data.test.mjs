import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TextDecoder } from "node:util";

const MATERIALS_URL = new URL("../data/materials.json", import.meta.url);
const FIXTURE_URL = new URL("./fixtures/materials-encyclopedia.json", import.meta.url);
const SPREADSHEET_ID = "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk";
const SHEET_NAME = "Энциклопедия материалов";
const WORKBOOK_FINGERPRINT = "804f8a558d15af42615f95aeec6ec9a24663c411a6842a7b0e11f286dc545070";
const SOURCE_ROW_COUNT = 270;
const CURRENT_ROW_COUNT = 275;
const ORIGINAL_MATERIAL_COUNT = 45;

const materialBytes = readFileSync(MATERIALS_URL);
const materialText = new TextDecoder("utf-8", { fatal: true }).decode(materialBytes);
const materials = JSON.parse(materialText);
const fixture = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));

function normalizeIdentifier(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

test("materials fixture is a raw positional snapshot of sheet rows 3-272", () => {
  assert.equal(fixture.spreadsheetId, SPREADSHEET_ID);
  assert.equal(fixture.sheetName, SHEET_NAME);
  assert.equal(fixture.workbookFingerprint, WORKBOOK_FINGERPRINT);
  assert.deepEqual(fixture.columns, [..."ABCDEFGHIJKLM"]);
  assert.equal(fixture.sourceRows.length, SOURCE_ROW_COUNT);
  assert.deepEqual(
    fixture.sourceRows.map(({ row }) => row),
    Array.from({ length: SOURCE_ROW_COUNT }, (_, index) => index + 3)
  );
  assert.ok(fixture.sourceRows.every(({ cells }) => Array.isArray(cells) && cells.length === 13));
  assert.equal(Object.keys(fixture.originalMaterialIds).length, ORIGINAL_MATERIAL_COUNT);

  assert.equal(fixture.sourceRows.find(({ row }) => row === 43).cells[7], "Малое зачарование  остроты, защиты и стойкости");
  assert.equal(fixture.sourceRows.find(({ row }) => row === 191).cells[6].endsWith(" "), true);
});

test("materials data is valid UTF-8 and retains historical rows plus five new source rows", () => {
  assert.ok(Array.isArray(materials));
  assert.equal(materials.length, CURRENT_ROW_COUNT);
  assert.doesNotMatch(materialText, /\uFFFD/u);

  const bySourceRow = new Map(materials.map((material) => [material.source?.row, material]));
  for (const sourceRow of fixture.sourceRows) {
    const actual = bySourceRow.get(sourceRow.row);
    assert.ok(actual, `source row ${sourceRow.row} is present`);
    assert.equal(actual.name, normalizeIdentifier(sourceRow.cells[0]), `source row ${sourceRow.row} keeps identity`);
    assert.equal(actual.source?.sheetName, SHEET_NAME);
    assert.equal(actual.source?.spreadsheetId, SPREADSHEET_ID);
  }
  assert.deepEqual([273, 274, 275, 276, 277].map((row) => bySourceRow.get(row)?.name), [
    "Киноварная руда", "Звёздный иридий", "Руда нулевого меридиана",
    "Угольная нефть (1 баррель)", "Синтезатор замедления"
  ]);
});

test("materials data adds 230 records and preserves all 45 historical ids", () => {
  const byName = new Map(materials.map((material) => [material.name, material]));
  const originalEntries = Object.entries(fixture.originalMaterialIds);
  const additions = materials.filter((material) => !Object.hasOwn(fixture.originalMaterialIds, material.name));

  assert.equal(originalEntries.length, ORIGINAL_MATERIAL_COUNT);
  assert.equal(additions.length, CURRENT_ROW_COUNT - ORIGINAL_MATERIAL_COUNT);
  for (const [name, id] of originalEntries) {
    assert.equal(byName.get(name)?.id, id, `${name} keeps historical id ${id}`);
  }
});

test("materials ids and names are non-empty and unique", () => {
  const ids = materials.map((material) => String(material.id ?? "").trim());
  const names = materials.map((material) => String(material.name ?? "").trim().toLocaleLowerCase("ru"));

  assert.ok(ids.every(Boolean));
  assert.ok(names.every(Boolean));
  assert.equal(new Set(ids).size, CURRENT_ROW_COUNT);
  assert.equal(new Set(names).size, CURRENT_ROW_COUNT);
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
  assert.equal(thievesRaw.rank, 0);
});
