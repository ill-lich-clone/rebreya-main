import test from "node:test";
import assert from "node:assert/strict";

import {
  EQUIPMENT_SPREADSHEET_ID,
  SHEET_REGISTRY
} from "../tools/equipment-import/sheet-registry.mjs";
import { ImportDiagnosticError } from "../tools/equipment-import/validation.mjs";
import {
  buildRawSheetSnapshot,
  buildRawWorkbookSnapshot
} from "../tools/equipment-import/snapshot.mjs";

const baseDeclaration = Object.freeze({
  sheetTitle: "Тест",
  range: "A1:B10",
  headerRows: [1],
  dataStartRow: 2,
  requiredHeaders: ["Название", "Вес"],
  optionalHeaders: [],
  stableKeyHeader: "Название",
  adapter: "test",
  outputCatalog: "gear",
  registryOrder: 0
});

function sheetInput(values, declaration = baseDeclaration) {
  return {
    sheetKey: "test",
    range: "'Тест'!A1:B10",
    values,
    declaration
  };
}

test("snapshot preserves a fractional weight as its exact formatted source string", () => {
  const snapshot = buildRawSheetSnapshot(sheetInput([
    ["Название", "Вес"],
    ["Дротик", "1/4 фнт"]
  ]));

  assert.equal(snapshot.rows[0].cells.Вес, "1/4 фнт");
  assert.equal(snapshot.rows[0].rowNumber, 2);
});

test("snapshot pads omitted trailing cells without changing physical row numbers", () => {
  const snapshot = buildRawSheetSnapshot(sheetInput([
    ["Название", "Вес"],
    [],
    ["Дротик"]
  ]));

  assert.deepEqual(snapshot.rows, [{
    rowNumber: 3,
    sourceIdentity: "Дротик",
    cells: { Название: "Дротик", Вес: "" }
  }]);
});

test("snapshot rejects a non-string formatted scalar instead of coercing it", () => {
  assert.throws(
    () => buildRawSheetSnapshot(sheetInput([
      ["Название", "Вес"],
      ["Дротик", 0.25]
    ])),
    (error) => {
      assert.equal(error.name, "ImportDiagnosticError");
      assert.equal(error.diagnostics[0].code, "non-string-cell");
      assert.equal(error.diagnostics[0].rowNumber, 2);
      assert.equal(error.diagnostics[0].column, "Вес");
      return true;
    }
  );
});

test("snapshot reports duplicate, missing, and populated unknown headers", () => {
  const declaration = {
    ...baseDeclaration,
    requiredHeaders: ["Название", "Вес", "Цена"]
  };

  assert.throws(
    () => buildRawSheetSnapshot(sheetInput([
      ["Название", "Название", "Лишнее"],
      ["Дротик", "1/4 фнт", "не должно потеряться"]
    ], declaration)),
    (error) => {
      assert.ok(error instanceof ImportDiagnosticError);
      assert.deepEqual(
        error.diagnostics.map((diagnostic) => diagnostic.code),
        ["duplicate-header", "missing-header", "missing-header", "unknown-populated-header"]
      );
      return true;
    }
  );
});

test("workbook snapshot is deterministic and contains no fetch timestamp", () => {
  const registry = Object.freeze({ test: baseDeclaration });
  const input = {
    spreadsheetId: "sheet-1",
    metadata: {
      sheets: [{
        properties: {
          sheetId: 7,
          title: "Тест",
          index: 0,
          gridProperties: { rowCount: 10, columnCount: 2 }
        }
      }]
    },
    valueRanges: [{
      range: "'Тест'!A1:B10",
      values: [["Название", "Вес"], ["Дротик", "1/4 фнт"]]
    }],
    registry
  };

  const first = buildRawWorkbookSnapshot(input);
  const second = buildRawWorkbookSnapshot({
    ...input,
    metadata: structuredClone(input.metadata),
    valueRanges: structuredClone(input.valueRanges)
  });

  assert.equal(first.fingerprint, second.fingerprint);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.spreadsheetId, "sheet-1");
  assert.equal(first.sheets.test.sheetId, 7);
  assert.equal("timestamp" in first, false);
  assert.equal(JSON.stringify(first).includes("credential"), false);
});

test("equivalent legacy special-ammunition sheet is accepted only as a mirror", () => {
  const declaration = {
    ...baseDeclaration,
    sheetTitle: "Особые боеприпасы",
    range: "B2:C10",
    headerRows: [2],
    dataStartRow: 3,
    legacyMirrors: [{
      sheetTitle: "Особые боеприпа",
      range: "A1:B9",
      requireEquivalent: true
    }]
  };
  const snapshot = buildRawWorkbookSnapshot({
    spreadsheetId: "sheet-1",
    metadata: {
      sheets: [
        { properties: { sheetId: 1, title: "Особые боеприпасы", index: 20 } },
        { properties: { sheetId: 2, title: "Особые боеприпа", index: 6 } }
      ]
    },
    valueRanges: [
      { range: "'Особые боеприпасы'!B2:C10", values: [["Название", "Вес"], ["Пуля", "1 фнт"]] },
      { range: "'Особые боеприпа'!A1:B9", values: [["Название", "Вес"], ["Пуля", "1 фнт"]] }
    ],
    registry: { specialAmmunition: declaration }
  });

  assert.equal(snapshot.sheets.specialAmmunition.sheetTitle, "Особые боеприпасы");
  assert.deepEqual(snapshot.sheets.specialAmmunition.legacyMirrors, [{
    sheetId: 2,
    sheetTitle: "Особые боеприпа",
    range: "'Особые боеприпа'!A1:B9",
    equivalent: true
  }]);
});

test("divergent legacy special-ammunition sheet blocks the workbook snapshot", () => {
  const declaration = {
    ...baseDeclaration,
    sheetTitle: "Особые боеприпасы",
    range: "B2:C10",
    headerRows: [2],
    dataStartRow: 3,
    legacyMirrors: [{
      sheetTitle: "Особые боеприпа",
      range: "A1:B9",
      requireEquivalent: true
    }]
  };

  assert.throws(
    () => buildRawWorkbookSnapshot({
      spreadsheetId: "sheet-1",
      metadata: {
        sheets: [
          { properties: { sheetId: 1, title: "Особые боеприпасы", index: 20 } },
          { properties: { sheetId: 2, title: "Особые боеприпа", index: 6 } }
        ]
      },
      valueRanges: [
        { range: "'Особые боеприпасы'!B2:C10", values: [["Название", "Вес"], ["Пуля", "1 фнт"]] },
        { range: "'Особые боеприпа'!A1:B9", values: [["Название", "Вес"], ["Пуля", "2 фнт"]] }
      ],
      registry: { specialAmmunition: declaration }
    }),
    (error) => {
      assert.equal(error.name, "ImportDiagnosticError");
      assert.equal(error.diagnostics[0].code, "divergent-legacy-mirror");
      return true;
    }
  );
});

test("production registry covers the approved spreadsheet and canonical special ammunition", () => {
  assert.equal(EQUIPMENT_SPREADSHEET_ID, "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk");
  assert.equal(SHEET_REGISTRY.baseGear.sheetTitle, "Общий компендиум снаряжения V0.1");
  assert.equal(SHEET_REGISTRY.baseGear.range, "A1:N830");
  assert.equal(SHEET_REGISTRY.materials.sheetTitle, "Энциклопедия материалов");
  assert.equal(SHEET_REGISTRY.magicItems.sheetTitle, "Магические предметы V0");
  assert.equal(SHEET_REGISTRY.ammunition.sheetTitle, "Боеприпасы V0.1");
  assert.equal(SHEET_REGISTRY.specialAmmunition.sheetTitle, "Особые боеприпасы");
});

test("production magic-item registry tolerates the source-only charges column before Value", () => {
  const declaration = SHEET_REGISTRY.magicItems;
  const headers = [
    "№", "Название", "Редкость", "Тип", "Подтип", "Слот", "Источник", "Ранг", "Материалы",
    "Торги", "Стоимость", "Влиятельность", "Настройка", "Настройка детали", "Расходник", "РЕВОРК",
    "Заряды", "Описание", "Value"
  ];
  const values = [headers, [
    "1", "Аметистовый магнетит", "Очень редкий", "Чудестный предмет", "", "Спина", "FTD", "7",
    "Стандартные", "Удачные", "10000 зм", "Минор", "1", "0", "FALSE", "Выполнен", "3",
    "Описание", "6000"
  ]];

  const snapshot = buildRawWorkbookSnapshot({
    spreadsheetId: "sheet-id",
    metadata: { sheets: [{ properties: { sheetId: 1, title: declaration.sheetTitle, index: 16 } }] },
    valueRanges: [{ range: `'${declaration.sheetTitle}'!A1:S1004`, values }],
    registry: { magicItems: declaration }
  });

  assert.equal(snapshot.sheets.magicItems.rows[0].cells["Заряды"], "3");
  assert.equal(snapshot.sheets.magicItems.rows[0].cells.Value, "6000");
});
