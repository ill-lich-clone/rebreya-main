import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ALCHEMY_COLUMNS,
  ALCHEMY_SHEET,
  ALCHEMY_SPREADSHEET_ID,
  buildAlchemySourceSnapshot
} from "../tools/alchemy-import/source.mjs";
import {
  normalizeAlchemyPriceFormula,
  priceProfileForRank
} from "../tools/alchemy-import/parsers.mjs";
import { adaptAlchemyRow } from "../tools/alchemy-import/adapter.mjs";
import {
  adaptAlchemyCatalog,
  validateAlchemyCatalog
} from "../tools/alchemy-import/catalog.mjs";

const fixture = JSON.parse(await readFile(
  new URL("fixtures/alchemy-import/products-formatted-values.json", import.meta.url),
  "utf8"
));

const expectedColumns = [
  "sourceNumber", "name", "productType", "priceFormula", "rank", "reagentLevel",
  "effect", "catalystEffect", "fire", "water", "earth", "air", "positive", "negative",
  "mandatoryComponent", "craftingDc", "privateCatalyst", "activation", "duration",
  "requirements", "simplifiedCreation", "radiusOrEmanation"
];

const priceProfiles = [
  [1, "(1d6+1) * 5", 35, "common"],
  [2, "(1d6+1) * 40", 280, "uncommon"],
  [3, "(1d6+1) * 50", 350, "uncommon"],
  [4, "(1d6+1) * 400", 2800, "rare"],
  [5, "(1d6+1) * 500", 3500, "rare"],
  [6, "(1d8+1) * 4000", 36000, "veryRare"],
  [7, "(1d8+1) * 5000", 45000, "veryRare"],
  [8, "2d6 * 10000", 120000, "veryRare"],
  [9, "2d6 * 12500", 150000, "legendary"]
];

function metadata() {
  return {
    sheets: [{ properties: { sheetId: ALCHEMY_SHEET.sheetId, title: ALCHEMY_SHEET.sheetTitle } }]
  };
}

function rowValues(overrides = {}) {
  const values = [
    "99", "Тестовое зелье", "Зелье", " ( 1d6 + 1 ) × 5 ", "1", "0",
    "Эффект", "—", "0", "", "—", "2", "3", "4", "Компонент", "15",
    "Катализатор", "Действие", "1 минута", "", "Упрощение", "10 футов"
  ];
  for (const [column, value] of Object.entries(overrides)) {
    values[ALCHEMY_COLUMNS.indexOf(column)] = value;
  }
  return values;
}

test("alchemy source locks the approved sheet and exact A-V column positions", () => {
  assert.equal(ALCHEMY_SPREADSHEET_ID, "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk");
  assert.deepEqual(ALCHEMY_SHEET, {
    sheetId: 179310389,
    sheetTitle: "Алхимические продукты V1",
    range: "'Алхимические продукты V1'!A3:V996",
    dataStartRow: 3,
    width: 22
  });
  assert.deepEqual(ALCHEMY_COLUMNS, expectedColumns);
});

test("formatted-value snapshot retains physical row tracing and deterministic fingerprint", () => {
  const snapshot = buildAlchemySourceSnapshot({
    spreadsheetId: fixture.spreadsheetId,
    metadata: metadata(),
    values: fixture.values
  });

  assert.equal(snapshot.fingerprint, fixture.fingerprint);
  assert.equal(snapshot.rows.length, 230);
  assert.equal(snapshot.rows[0].rowNumber, 3);
  assert.equal(snapshot.rows.at(-1).rowNumber, 232);
  assert.ok(snapshot.rows.every((row) => row.values.length === 22));
  assert.ok(snapshot.rows.every((row) => row.values.every((value) => typeof value === "string")));
});

test("source rejects an unapproved sheet and any non-string Google scalar", () => {
  assert.throws(() => buildAlchemySourceSnapshot({
    spreadsheetId: ALCHEMY_SPREADSHEET_ID,
    metadata: { sheets: [{ properties: { sheetId: 99, title: ALCHEMY_SHEET.sheetTitle } }] },
    values: [rowValues()]
  }), /sheet id/i);
  assert.throws(() => buildAlchemySourceSnapshot({
    spreadsheetId: ALCHEMY_SPREADSHEET_ID,
    metadata: metadata(),
    values: [[...rowValues().slice(0, 4), 1, ...rowValues().slice(5)]]
  }), /formatted string.*E3/i);
});

test("row adapter maps all fields, preserves zero, and normalizes optional blanks", () => {
  const product = adaptAlchemyRow({ rowNumber: 42, values: rowValues() });

  assert.deepEqual(product, {
    id: "alchemy-99",
    sourceNumber: 99,
    name: "Тестовое зелье",
    productType: "Зелье",
    priceFormula: "(1d6+1) * 5",
    priceMaximumGp: 35,
    rank: 1,
    reagentLevel: 0,
    effect: "Эффект",
    catalystEffect: null,
    aspects: { fire: 0, water: null, earth: null, air: 2, positive: 3, negative: 4 },
    mandatoryComponent: "Компонент",
    craftingDc: 15,
    privateCatalyst: "Катализатор",
    activation: "Действие",
    duration: "1 минута",
    requirements: null,
    simplifiedCreation: "Упрощение",
    radiusOrEmanation: "10 футов",
    rarity: "common",
    weight: 1,
    icon: "templates/icons/Alchemy/99-testovoe-zel-e.webp",
    topDownImage: "assets/top-down/items/alchemy/99-testovoe-zel-e.webp",
    sourceRef: "Алхимические продукты V1!A42"
  });
});

for (const [rank, formula, maximum, rarity] of priceProfiles) {
  test(`rank ${rank} owns its exact price, maximum, rarity, and weight`, () => {
    assert.deepEqual(priceProfileForRank(rank), {
      priceFormula: formula,
      priceMaximumGp: maximum,
      rarity,
      weight: rank
    });
    const product = adaptAlchemyRow({
      rowNumber: rank + 2,
      values: rowValues({ rank: String(rank), priceFormula: formula })
    });
    assert.equal(product.priceFormula, formula);
    assert.equal(product.priceMaximumGp, maximum);
    assert.equal(product.rarity, rarity);
    assert.equal(product.weight, rank);
  });
}

test("price grammar normalizes harmless spacing and multiplication signs only", () => {
  assert.equal(normalizeAlchemyPriceFormula(" ( 1d8 + 1 )× 5 000 "), "(1d8+1) * 5000");
  assert.equal(normalizeAlchemyPriceFormula("2d6*12 500"), "2d6 * 12500");
  for (const invalid of ["(1d10+1) * 5", "(1d6+1) * 5 зм", "2d6 + 10000", ""] ) {
    assert.throws(() => normalizeAlchemyPriceFormula(invalid), /price formula/i);
  }
  assert.throws(() => adaptAlchemyRow({
    rowNumber: 3,
    values: rowValues({ rank: "2", priceFormula: "(1d6+1) * 5" })
  }), /rank 2.*price formula/i);
});

test("integer fields reject partial and decimal tokens", () => {
  assert.throws(() => adaptAlchemyRow({ rowNumber: 3, values: rowValues({ sourceNumber: "1x" }) }), /source number/i);
  assert.throws(() => adaptAlchemyRow({ rowNumber: 3, values: rowValues({ rank: "1.0" }) }), /rank/i);
  assert.throws(() => adaptAlchemyRow({ rowNumber: 3, values: rowValues({ craftingDc: "15 Сл" }) }), /crafting dc/i);
  assert.throws(() => adaptAlchemyRow({ rowNumber: 3, values: rowValues({ productType: "Эликсир" }) }), /product type/i);
});

test("catalog validates the exact live number set, types, names, IDs, and paths", () => {
  const snapshot = buildAlchemySourceSnapshot({
    spreadsheetId: fixture.spreadsheetId,
    metadata: metadata(),
    values: fixture.values
  });
  const products = adaptAlchemyCatalog(snapshot);
  assert.equal(validateAlchemyCatalog(products), products);
  assert.equal(products.length, 230);
  assert.deepEqual(products.map((product) => product.sourceNumber),
    Array.from({ length: 234 }, (_, index) => index + 1).filter((number) => ![36, 52, 67, 76].includes(number)));
  assert.equal(new Set(products.map((product) => product.id)).size, 230);
  assert.equal(new Set(products.map((product) => product.name)).size, 230);
  assert.deepEqual(Object.fromEntries(Object.entries(Object.groupBy(products, (product) => product.productType))
    .map(([type, rows]) => [type, rows.length])), {
    "Зелье": 109,
    "Вещество": 23,
    "Яд (Оружейный)": 7,
    "Яд (Поглощаемый)": 4,
    "Яд (Вдыхаемый)": 6,
    "Яд (Контактный)": 2,
    "Бомба": 63,
    "Масло": 15,
    "Побочный продукт": 1
  });
  assert.ok(products.every((product) => product.icon.startsWith(`templates/icons/Alchemy/${product.sourceNumber}-`)));
  assert.ok(products.every((product) => product.topDownImage.startsWith(`assets/top-down/items/alchemy/${product.sourceNumber}-`)));
  assert.throws(() => validateAlchemyCatalog([...products.slice(0, -1), products[0]]), /duplicate.*source number/i);
});

test("physical row movement changes sourceRef only", () => {
  const original = adaptAlchemyRow({ rowNumber: 15, values: rowValues() });
  const moved = adaptAlchemyRow({ rowNumber: 87, values: rowValues() });
  assert.equal(original.id, moved.id);
  assert.equal(original.icon, moved.icon);
  assert.equal(original.topDownImage, moved.topDownImage);
  assert.notEqual(original.sourceRef, moved.sourceRef);
  assert.deepEqual(
    { ...original, sourceRef: null },
    { ...moved, sourceRef: null }
  );
});
