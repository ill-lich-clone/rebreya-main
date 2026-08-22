import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  GENERATED_CATALOG_PATHS,
  buildEquipmentBundle,
  validateEquipmentBundle
} from "../tools/equipment-import/pipeline.mjs";

const fixtureRoot = new URL("./fixtures/equipment-import/", import.meta.url);
const core = JSON.parse(await readFile(new URL("complete-snapshot.json", fixtureRoot), "utf8"));
const expected = JSON.parse(await readFile(new URL("complete-bundle.json", fixtureRoot), "utf8"));
const weapons = JSON.parse(await readFile(new URL("weapons-raw.json", fixtureRoot), "utf8"));
const profiles = JSON.parse(await readFile(new URL("gear-profiles-raw.json", fixtureRoot), "utf8"));
const secondary = JSON.parse(await readFile(new URL("secondary-catalogs-raw.json", fixtureRoot), "utf8"));
const magicItems = JSON.parse(await readFile(new URL("magic-items-raw.json", fixtureRoot), "utf8"));

function implantSnapshot() {
  return {
    ...secondary.implant,
    values: [
      ["Название", "Ранг", "Очки модификации", "Эффект", "Требования", "Цена (ЗМ ) и Источник", "Тип"],
      secondary.implant.values
    ]
  };
}

function transportSnapshot() {
  const snapshot = structuredClone(secondary.transport);
  snapshot.row.rowNumber = 2;
  return { ...snapshot, rows: [snapshot.row] };
}

function workbookSnapshot() {
  return {
    spreadsheetId: core.spreadsheetId,
    fingerprint: core.fingerprint,
    sheets: {
      equipmentReferences: core.equipmentReferences,
      baseGear: core.baseGear,
      weapons: weapons.weapons,
      firearms: weapons.firearms,
      armor: profiles.paddedArmor,
      ammunition: { sheetKey: "ammunition", sheetTitle: "Боеприпасы", range: "'Боеприпасы'!B1:G1005", layout: "raw", values: [] },
      specialAmmunition: { sheetKey: "specialAmmunition", sheetTitle: "Особые боеприпасы", range: "'Особые боеприпасы'!B2:H1000", rows: [] },
      explosives: { sheetKey: "explosives", sheetTitle: "Взрывчатка V0.0", range: "'Взрывчатка V0.0'!A1:N1000", rows: [] },
      attachments: { sheetKey: "attachments", sheetTitle: "Улучшения и обвесы V0.2", range: "'Улучшения и обвесы V0.2'!A1:AA1010", layout: "raw", values: [] },
      upgrades: { sheetKey: "upgrades", sheetTitle: "Усовершенствования V0.21", range: "'Усовершенствования V0.21'!A1:G1000", rows: [] },
      materials: { ...secondary.material, rows: [secondary.material.row] },
      implants: implantSnapshot(),
      transport: transportSnapshot(),
      magicItems
    }
  };
}

test("pipeline composes the complete immutable catalog bundle", () => {
  assert.deepEqual(GENERATED_CATALOG_PATHS, {
    gear: "data/gear.json",
    upgrades: "data/upgrades.json",
    materials: "data/materials.json",
    implants: "data/implants.json",
    transport: "data/rebreya-transport-v01.json",
    magicItems: "magicItem.js"
  });
  const source = workbookSnapshot();
  const before = structuredClone(source);
  const bundle = buildEquipmentBundle({ workbookSnapshot: source, overrides: core.overrides });

  assert.deepEqual(bundle, expected);
  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.catalogs.gear[0]), true);
  for (const [catalog, key] of [["gear", "id"], ["upgrades", "productId"], ["materials", "id"], ["implants", "id"], ["transport", "sourceId"], ["magicItems", "id"]]) {
    const values = bundle.catalogs[catalog].map((entry) => entry[key]);
    assert.equal(new Set(values).size, values.length, `${catalog} IDs must be unique`);
  }
});

test("pipeline accumulates and sorts independent adapter diagnostics", () => {
  const source = workbookSnapshot();
  source.sheets.weapons.rows[1].cells["Тип урона"] = "Космический";
  source.sheets.materials.rows[0].cells["Вес (фнт)"] = "1/0";
  source.sheets.magicItems.rows[0].cells.Редкость = "Сверхредкий";

  assert.throws(
    () => buildEquipmentBundle({ workbookSnapshot: source, overrides: core.overrides }),
    (error) => {
      assert.equal(error.name, "ImportDiagnosticError");
      assert.deepEqual(error.diagnostics.map((entry) => entry.sheetKey), ["magicItems", "materials", "weapons"]);
      return true;
    }
  );
});

test("pipeline does not cascade missing base rows into orphan profile noise", () => {
  const source = workbookSnapshot();
  source.sheets.equipmentReferences.values = source.sheets.equipmentReferences.values
    .filter((row) => row[0] !== "оружие|боевой посох");

  assert.throws(
    () => buildEquipmentBundle({ workbookSnapshot: source, overrides: core.overrides }),
    (error) => {
      assert.equal(error.diagnostics.some((entry) => entry.code === "missing-equipment-reference"), true);
      assert.equal(error.diagnostics.some((entry) => entry.code === "orphan-gear-fragment"), false);
      return true;
    }
  );
});

test("bundle validation caps duplicate diagnostics and reports suppression", () => {
  const gear = Array.from({ length: 102 }, (_, index) => ({ id: "same", name: `Gear ${index}`, sourceRef: `Sheet!A${index + 1}` }));
  const invalid = {
    schemaVersion: 1,
    source: { spreadsheetId: "fixture", fingerprint: "f".repeat(64) },
    catalogs: { gear, upgrades: [], materials: [], implants: [], transport: [], magicItems: [] },
    diagnostics: []
  };
  assert.throws(
    () => validateEquipmentBundle({ bundle: invalid, workbookSnapshot: workbookSnapshot(), overrides: core.overrides }),
    (error) => error.diagnostics.length === 100 && error.suppressedCount >= 1
  );
});
