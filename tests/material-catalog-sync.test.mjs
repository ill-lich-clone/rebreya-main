import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { REBREYA_TOOLS } from "../scripts/constants.js";
import { buildBaseRawMaterialIndex } from "../scripts/data/material-catalog-sync.js";
import { adaptMaterialsCatalog } from "../tools/equipment-import/adapters/materials.mjs";

const FIXTURE_URL = new URL("./fixtures/materials-encyclopedia.json", import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
const COLUMNS = [
  "Название", "Тип", "Подтип / добыча", "Цена (зм)", "Вес (фнт)", "Ранг", "Описание",
  "Усовершенствование", "Имплант", "Создание и Снаряжение", "Алхимия", "Знания", "Аспекты (алхимия)"
];

function snapshot() {
  return {
    sheetKey: "materials",
    sheetTitle: fixture.sheetName,
    range: `'${fixture.sheetName}'!A1:M1065`,
    rows: fixture.sourceRows.map(({ row, cells }) => ({
      rowNumber: row,
      sourceIdentity: cells[0],
      cells: Object.fromEntries(COLUMNS.map((column, index) => [column, cells[index] ?? ""]))
    }))
  };
}

function overrides() {
  const identities = Object.fromEntries(Object.entries(fixture.originalMaterialIds).map(([name, id]) => [
    name, { id, aliases: [] }
  ]));
  const enrichment = Object.fromEntries(Object.entries(fixture.originalMaterialIds).map(([name, id]) => [
    id, { linkedGoodId: id, linkedGoodName: name }
  ]));
  return { identities: { materials: identities }, enrichment: { materials: enrichment } };
}

test("Node materials adapter owns all real encyclopedia rows and preserves literal G:M text", () => {
  const materials = adaptMaterialsCatalog({ snapshot: snapshot(), overrides: overrides(), diagnostics: [] });
  assert.equal(materials.length, fixture.sourceRows.length);
  assert.equal(materials.every((material) => material.isSynthetic === false), true);

  for (let index = 0; index < fixture.sourceRows.length; index += 1) {
    const { row, cells } = fixture.sourceRows[index];
    const material = materials[index];
    assert.equal(material.name, cells[0].trim(), `row ${row} name`);
    assert.equal(material.description, cells[6], `row ${row} description`);
    assert.deepEqual(material.applications, {
      upgrade: cells[7], implant: cells[8], crafting: cells[9], alchemy: cells[10], knowledge: cells[11]
    }, `row ${row} applications`);
    assert.equal(material.alchemyAspects, cells[12], `row ${row} alchemy aspects`);
    assert.deepEqual(material.source, {
      spreadsheetId: fixture.spreadsheetId, sheetName: fixture.sheetName, row
    });
  }
});

test("Node materials adapter preserves historical ids and linked-good enrichment without reading generated JSON", () => {
  const materials = adaptMaterialsCatalog({ snapshot: snapshot(), overrides: overrides(), diagnostics: [] });
  const byName = new Map(materials.map((material) => [material.name, material]));
  for (const [name, id] of Object.entries(fixture.originalMaterialIds)) {
    assert.equal(byName.get(name)?.id, id, `${name} keeps ${id}`);
    assert.equal(byName.get(name)?.linkedGoodId, id, `${name} keeps linked good ${id}`);
  }
  assert.equal(new Set(materials.map(({ id }) => id)).size, materials.length);
  assert.equal(new Set(materials.map(({ name }) => name.toLocaleLowerCase("ru-RU"))).size, materials.length);
});

test("buildBaseRawMaterialIndex remains the runtime lookup for all tool raw materials", () => {
  const materials = adaptMaterialsCatalog({ snapshot: snapshot(), overrides: overrides(), diagnostics: [] });
  const index = buildBaseRawMaterialIndex(materials);
  const byName = new Map(materials.map((material) => [material.name, material]));

  assert.equal(index.size, REBREYA_TOOLS.length);
  for (const tool of REBREYA_TOOLS) {
    const expected = byName.get(`Базовое сырье для Инструменты ${tool.label}`);
    assert.ok(expected, `${tool.label} source row exists`);
    assert.equal(index.get(tool.id), expected.id, `${tool.id} maps to ${expected.name}`);
  }
  assert.ok(byName.has("Алхимические реагенты"));
});
