import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAttachmentWeightModifier,
  parseBooleanToken,
  parseCurrency,
  parseDamageFormula,
  parseDecimal,
  parseDelimitedList,
  parseEnum,
  parseInteger,
  parseOptionalText,
  parseRange,
  parseRequiredText,
  parseTransportWeight,
  parseWeight
} from "../tools/equipment-import/parsers.mjs";

const context = Object.freeze({
  sheetKey: "baseGear",
  range: "'Общий компендиум снаряжения V0.1'!A1:M806",
  rowNumber: 112,
  column: "Вес",
  registryOrder: 0
});

for (const [raw, expected] of [
  ["1/4 фнт", 0.25],
  ["1/2 фунта", 0.5],
  ["1 1/4 фнт", 1.25],
  ["¼ фнт", 0.25],
  ["½ фнт", 0.5],
  ["¾ фнт", 0.75],
  ["2 фнт", 2],
  ["0,25 фнт", 0.25],
  ["1 500 фнт.", 1500],
  ["Незнач.", 0],
  ["—", null]
]) {
  test(`parseWeight maps ${JSON.stringify(raw)} to ${JSON.stringify(expected)}`, () => {
    assert.equal(parseWeight(raw, context), expected);
  });
}

for (const raw of ["1/0 фнт", "1//4", "14/", "полфунта", "NaN", "Infinity", "-1 фнт"]) {
  test(`parseWeight rejects malformed or forbidden ${JSON.stringify(raw)}`, () => {
    assert.throws(
      () => parseWeight(raw, context),
      (error) => {
        assert.equal(error.name, "ImportDiagnosticError");
        assert.equal(error.diagnostics[0].rowNumber, 112);
        assert.equal(error.diagnostics[0].column, "Вес");
        return true;
      }
    );
  });
}

test("weight parsers keep negative attachment modifiers and transport tons field-specific", () => {
  assert.equal(parseAttachmentWeightModifier("-1 фнт", context), -1);
  assert.equal(parseAttachmentWeightModifier("—", context), null);
  assert.deepEqual(parseTransportWeight("2 тонн", context), { value: 2, unit: "ton" });
  assert.deepEqual(parseTransportWeight("540 фнт", context), { value: 540, unit: "lb" });
  assert.equal(parseTransportWeight("—", context), null);
});

test("integer and decimal parsers match the entire numeric token", () => {
  assert.equal(parseInteger("1 500", context, { min: 0, max: 2000 }), 1500);
  assert.equal(parseDecimal("-1,5", context, { min: -2, max: 2 }), -1.5);
  assert.equal(parseDecimal("1 1/4", context), 1.25);
  assert.throws(() => parseInteger("1,5", context), /integer/i);
  assert.throws(() => parseDecimal("уровень 20", context), /number/i);
});

test("currency parser separates fixed and variable prices without extracting a prefix", () => {
  assert.deepEqual(parseCurrency("20 ЗМ", context), {
    kind: "fixed",
    raw: "20 ЗМ",
    value: 20,
    denomination: "gp",
    goldEquivalent: 20
  });
  assert.deepEqual(parseCurrency("2 см", context), {
    kind: "fixed",
    raw: "2 см",
    value: 2,
    denomination: "sp",
    goldEquivalent: 0.2
  });
  assert.deepEqual(parseCurrency("(2d8kl1+1)*5000 зм", context), {
    kind: "variable",
    raw: "(2d8kl1+1)*5000 зм"
  });
  assert.deepEqual(parseCurrency("20–1 500 зм (по уровню)", context), {
    kind: "variable",
    raw: "20–1 500 зм (по уровню)"
  });
  assert.equal(parseCurrency("—", context), null);
});

test("damage formula accepts a complete dice grammar and normalizes Cyrillic dice", () => {
  assert.equal(parseDamageFormula("1к4+1к4", context), "1d4+1d4");
  assert.equal(parseDamageFormula("2d6 + 3", context), "2d6+3");
  assert.equal(parseDamageFormula("2d8kh1", context), "2d8kh1");
  assert.equal(parseDamageFormula("—", context, { optional: true }), null);
  assert.throws(() => parseDamageFormula("1d4 огонь", context), /damage formula/i);
});

test("range parser validates normal and long distances independently", () => {
  assert.deepEqual(parseRange("30/90", context), { normal: 30, long: 90 });
  assert.deepEqual(parseRange("60 футов", context), { normal: 60, long: null });
  assert.equal(parseRange("—", context, { optional: true }), null);
  assert.throws(() => parseRange("90/30", context), /long range/i);
  assert.throws(() => parseRange("далеко", context), /range/i);
});

test("boolean, enum, and list parsers use explicit token maps", () => {
  for (const raw of ["TRUE", "1", "Да"]) assert.equal(parseBooleanToken(raw, context), true);
  for (const raw of ["FALSE", "0", "Нет"]) assert.equal(parseBooleanToken(raw, context), false);
  assert.equal(parseBooleanToken("—", context, { optional: true }), null);
  assert.throws(() => parseBooleanToken("возможно", context), /boolean/i);

  assert.equal(parseEnum(" Дробящий ", context, {
    values: { дробящий: "bludgeoning", колющий: "piercing" },
    label: "damage type"
  }), "bludgeoning");
  assert.throws(() => parseEnum("огненный", context, {
    values: { дробящий: "bludgeoning" },
    label: "damage type"
  }), /damage type/i);

  assert.deepEqual(
    parseDelimitedList("Верх, Низ; Ствол", context, { delimiters: /[,;]/u }),
    ["Верх", "Низ", "Ствол"]
  );
});

test("text parsers trim only outer whitespace and preserve internal Unicode and line breaks", () => {
  assert.equal(parseRequiredText("  строка  с  пробелами\nи переносом  ", context), "строка  с  пробелами\nи переносом");
  assert.equal(parseOptionalText("  — авторский текст —  ", context), "— авторский текст —");
  assert.equal(parseOptionalText("   ", context), null);
  assert.throws(() => parseRequiredText("   ", context), /required text/i);
  assert.throws(() => parseRequiredText(14, context), /string/i);
});
