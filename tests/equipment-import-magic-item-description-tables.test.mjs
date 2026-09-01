import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { MAGIC_ITEMS } from "../magicItem.js";

import {
  normalizeMagicItemDescriptionTables,
  validateMagicItemDescriptionTableContracts
} from "../tools/equipment-import/magic-item-description-tables.mjs";

function contracts(tables) {
  return validateMagicItemDescriptionTableContracts({
    schemaVersion: 1,
    items: {
      "test-item": {
        sourceUrl: "https://dnd.su/items/1-test-item/",
        tables
      }
    }
  });
}

function normalize(description, tables) {
  return normalizeMagicItemDescriptionTables({
    stableId: "test-item",
    itemName: "Тестовый предмет",
    description,
    contracts: contracts(tables),
    context: { sheetKey: "magicItems", range: "A2:V2", rowNumber: 2, column: "Описание" },
    diagnostics: []
  });
}

test("spaced legacy tables become canonical markdown without changing prose", () => {
  const description = [
    "Текст до таблицы.",
    "",
    "к4        Эффект",
    "1        Первый эффект",
    "2        Второй | эффект",
    "",
    "Текст после таблицы."
  ].join("\n");

  const normalized = normalize(description, [{
    header: ["к4", "Эффект"],
    rowCount: 2,
    layout: "spaced-lines"
  }]);
  assert.equal(normalized, [
    "Текст до таблицы.",
    "",
    "| к4 | Эффект |",
    "| --- | --- |",
    "| 1 | Первый эффект |",
    "| 2 | Второй \\| эффект |",
    "",
    "Текст после таблицы."
  ].join("\n"));
  assert.equal(normalize(normalized, [{
    header: ["к4", "Эффект"],
    rowCount: 2,
    layout: "spaced-lines"
  }]), normalized);
});

test("contracts support repeated tables and split legacy row layouts", () => {
  const description = [
    "к4        Масть        Эффект",
    "1",
    "Жезлы        Огонь",
    "2",
    "Монеты        Молния",
    "",
    "Заклинание или предмет        Потеря зарядов",
    "Огненная стена",
    "1к4",
    "Распад",
    "1к12",
    "",
    "к8        Существо",
    "1        Куница",
    "2        Крыса",
    "",
    "к8        Существо",
    "1        Сова",
    "2        Мастиф"
  ].join("\n");

  const result = normalize(description, [
    { header: ["к4", "Масть", "Эффект"], rowCount: 2, layout: "key-plus-spaced" },
    { header: ["Заклинание или предмет", "Потеря зарядов"], rowCount: 2, layout: "paired-lines" },
    { header: ["к8", "Существо"], rowCount: 2, layout: "spaced-lines" },
    { header: ["к8", "Существо"], rowCount: 2, layout: "spaced-lines" }
  ]);

  assert.equal((result.match(/<not-present>/gu) ?? []).length, 0);
  assert.equal(result.split("\n").filter((line) => /^\|(?: --- \|){2,}$/u.test(line)).length, 4);
  assert.match(result, /\| 1 \| Жезлы \| Огонь \|/u);
  assert.match(result, /\| Огненная стена \| 1к4 \|/u);
  assert.match(result, /\| 2 \| Мастиф \|/u);
});

test("missing rows fail closed with an importer diagnostic", () => {
  const diagnostics = [];
  const validated = contracts([{
    header: ["к4", "Эффект"],
    rowCount: 2,
    layout: "spaced-lines"
  }]);

  assert.throws(
    () => normalizeMagicItemDescriptionTables({
      stableId: "test-item",
      itemName: "Тестовый предмет",
      description: "к4        Эффект\n1        Осталась одна строка",
      contracts: validated,
      context: { sheetKey: "magicItems", range: "A2:V2", rowNumber: 2, column: "Описание" },
      diagnostics
    }),
    (error) => error.diagnostics?.some((entry) => (
      entry.code === "magic-item-description-table-structure"
      && entry.rowNumber === 2
      && entry.column === "Описание"
    ))
  );
});

test("invalid contracts reject unsupported layouts and unsafe source URLs", () => {
  assert.throws(
    () => validateMagicItemDescriptionTableContracts({
      schemaVersion: 1,
      items: {
        bad: {
          sourceUrl: "javascript:alert(1)",
          tables: [{ header: ["A", "B"], rowCount: 1, layout: "unknown" }]
        }
      }
    }),
    /contract/iu
  );
});

test("uncontracted descriptions remain byte-for-byte sheet owned", () => {
  const description = "Первая строка.\r\n\r\nВторая строка.";
  assert.equal(normalizeMagicItemDescriptionTables({
    stableId: "uncontracted-item",
    itemName: "Обычный предмет",
    description,
    contracts: validateMagicItemDescriptionTableContracts({ schemaVersion: 1, items: {} }),
    diagnostics: []
  }), description);
});

test("tracked contracts cover 36 current catalog items and all 39 tables normalize idempotently", async () => {
  const rawContracts = JSON.parse(await readFile(
    new URL("../data/magic-item-description-tables.json", import.meta.url),
    "utf8"
  ));
  const validated = validateMagicItemDescriptionTableContracts(rawContracts);
  const itemsById = new Map(MAGIC_ITEMS.map((item) => [item.id, item]));
  let tableCount = 0;

  assert.equal(Object.keys(validated.items).length, 36);
  for (const [stableId, itemContract] of Object.entries(validated.items)) {
    const item = itemsById.get(stableId);
    assert.ok(item, `missing contracted catalog item ${stableId}`);
    const first = normalizeMagicItemDescriptionTables({
      stableId,
      itemName: item.name,
      description: item.description,
      contracts: validated,
      diagnostics: []
    });
    const second = normalizeMagicItemDescriptionTables({
      stableId,
      itemName: item.name,
      description: first,
      contracts: validated,
      diagnostics: []
    });
    assert.equal(second, first, `${item.name} normalization must be idempotent`);
    tableCount += itemContract.tables.length;
  }
  assert.equal(tableCount, 39);
});
