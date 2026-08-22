import {
  ImportDiagnosticError,
  createImportDiagnostic
} from "./validation.mjs";

const DASH_TOKEN = /^(?:-|–|—)$/u;
const UNICODE_FRACTIONS = Object.freeze({
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75
});
const DENOMINATIONS = Object.freeze({
  "мм": { denomination: "cp", goldRate: 0.01 },
  cp: { denomination: "cp", goldRate: 0.01 },
  "см": { denomination: "sp", goldRate: 0.1 },
  sp: { denomination: "sp", goldRate: 0.1 },
  "эм": { denomination: "ep", goldRate: 0.5 },
  ep: { denomination: "ep", goldRate: 0.5 },
  "зм": { denomination: "gp", goldRate: 1 },
  gp: { denomination: "gp", goldRate: 1 },
  "пм": { denomination: "pp", goldRate: 10 },
  pp: { denomination: "pp", goldRate: 10 }
});

function diagnosticContext(context = {}) {
  return {
    sheetKey: context.sheetKey ?? null,
    range: context.range ?? null,
    rowNumber: context.rowNumber ?? null,
    column: context.column ?? null,
    columnIndex: context.columnIndex ?? null,
    registryOrder: context.registryOrder ?? null
  };
}

function fail(code, raw, context, message) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({
    code,
    value: raw,
    message,
    ...diagnosticContext(context)
  })]);
}

function requireString(raw, context, label) {
  if (typeof raw !== "string") {
    fail("non-string-field", raw, context, `${label} must be a string`);
  }
  return raw;
}

function normalizeNumericWhitespace(raw) {
  return raw.replace(/[\u00a0\u202f]/gu, " ").trim();
}

function parseStrictNumberToken(raw, context, label = "number") {
  const value = normalizeNumericWhitespace(requireString(raw, context, label));
  const mixedFraction = value.match(/^([+-]?\d+)\s+(\d+)\/(\d+)$/u);
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    if (denominator === 0) fail("invalid-number", raw, context, `${label} has a zero fraction denominator`);
    const fraction = numerator / denominator;
    return whole < 0 ? whole - fraction : whole + fraction;
  }

  const simpleFraction = value.match(/^([+-]?)(\d+)\/(\d+)$/u);
  if (simpleFraction) {
    const denominator = Number(simpleFraction[3]);
    if (denominator === 0) fail("invalid-number", raw, context, `${label} has a zero fraction denominator`);
    const result = Number(simpleFraction[2]) / denominator;
    return simpleFraction[1] === "-" ? -result : result;
  }

  const unicodeFraction = value.match(/^([+-]?)(?:(\d+)\s*)?([¼½¾])$/u);
  if (unicodeFraction) {
    const whole = Number(unicodeFraction[2] ?? 0);
    const fraction = UNICODE_FRACTIONS[unicodeFraction[3]];
    const result = whole + fraction;
    return unicodeFraction[1] === "-" ? -result : result;
  }

  if (!/^[+-]?(?:\d{1,3}(?: \d{3})+|\d+)(?:[.,]\d+)?$/u.test(value)) {
    fail("invalid-number", raw, context, `${label} is not a complete number`);
  }
  const result = Number(value.replaceAll(" ", "").replace(",", "."));
  if (!Number.isFinite(result)) fail("invalid-number", raw, context, `${label} must be finite`);
  return result;
}

function assertBounds(value, raw, context, { min = null, max = null, label = "number" } = {}) {
  if (min !== null && value < min) fail("number-below-minimum", raw, context, `${label} must be at least ${min}`);
  if (max !== null && value > max) fail("number-above-maximum", raw, context, `${label} must be at most ${max}`);
  return value;
}

function splitWeightUnit(raw, context, { allowTons = false } = {}) {
  const source = requireString(raw, context, "weight");
  const text = normalizeNumericWhitespace(source);
  const unitPattern = allowTons
    ? /^(.*?)\s*(фнт\.?|фунт(?:а|ов)?|тонн(?:а|ы)?)$/iu
    : /^(.*?)\s*(фнт\.?|фунт(?:а|ов)?)$/iu;
  const match = text.match(unitPattern);
  if (match) {
    return {
      numeric: match[1].trim(),
      unit: /^тонн/iu.test(match[2]) ? "ton" : "lb"
    };
  }
  return { numeric: text, unit: "lb" };
}

export function parseRequiredText(raw, context) {
  const text = requireString(raw, context, "required text").trim();
  if (!text) fail("missing-required-text", raw, context, "required text is blank");
  return text;
}

export function parseOptionalText(raw, context) {
  const text = requireString(raw, context, "optional text").trim();
  return text || null;
}

export function parseBooleanToken(raw, context, { optional = false, values = null } = {}) {
  const source = requireString(raw, context, "boolean token");
  const text = source.trim();
  if (!text || DASH_TOKEN.test(text)) {
    if (optional) return null;
    fail("missing-boolean", raw, context, "boolean token is required");
  }
  const tokenMap = values ?? {
    true: true,
    false: false,
    "1": true,
    "0": false,
    "да": true,
    "нет": false
  };
  const key = text.toLocaleLowerCase("ru-RU");
  if (!Object.hasOwn(tokenMap, key)) fail("invalid-boolean", raw, context, `Unknown boolean token: ${text}`);
  return tokenMap[key];
}

export function parseInteger(raw, context, options = {}) {
  const value = parseStrictNumberToken(raw, context, options.label ?? "integer");
  if (!Number.isInteger(value)) fail("invalid-integer", raw, context, `${options.label ?? "integer"} must be an integer`);
  return assertBounds(value, raw, context, { ...options, label: options.label ?? "integer" });
}

export function parseDecimal(raw, context, options = {}) {
  const value = parseStrictNumberToken(raw, context, options.label ?? "number");
  return assertBounds(value, raw, context, { ...options, label: options.label ?? "number" });
}

export function parseWeight(raw, context) {
  const source = requireString(raw, context, "weight");
  const text = source.trim();
  if (DASH_TOKEN.test(text)) return null;
  if (/^Незнач\.$/iu.test(text)) return 0;
  const { numeric } = splitWeightUnit(source, context);
  const value = parseStrictNumberToken(numeric, context, "weight");
  if (value < 0) fail("negative-equipment-weight", raw, context, "ordinary equipment weight cannot be negative");
  return value;
}

export function parseAttachmentWeightModifier(raw, context) {
  const source = requireString(raw, context, "attachment weight modifier");
  if (DASH_TOKEN.test(source.trim())) return null;
  const { numeric } = splitWeightUnit(source, context);
  return parseStrictNumberToken(numeric, context, "attachment weight modifier");
}

export function parseTransportWeight(raw, context) {
  const source = requireString(raw, context, "transport weight");
  if (DASH_TOKEN.test(source.trim())) return null;
  const { numeric, unit } = splitWeightUnit(source, context, { allowTons: true });
  const value = parseStrictNumberToken(numeric, context, "transport weight");
  if (value < 0) fail("negative-transport-weight", raw, context, "transport weight cannot be negative");
  return { value, unit };
}

export function parseCurrency(raw, context) {
  const source = requireString(raw, context, "currency");
  const text = source.trim();
  if (!text || DASH_TOKEN.test(text)) return null;
  const fixed = text.match(/^(.+?)\s*(мм|см|эм|зм|пм|cp|sp|ep|gp|pp)$/iu);
  if (!fixed) return { kind: "variable", raw: source };
  let value;
  try {
    value = parseStrictNumberToken(fixed[1], context, "currency value");
  } catch {
    return { kind: "variable", raw: source };
  }
  if (value < 0) fail("negative-currency", raw, context, "currency value cannot be negative");
  const definition = DENOMINATIONS[fixed[2].toLocaleLowerCase("ru-RU")];
  return {
    kind: "fixed",
    raw: source,
    value,
    denomination: definition.denomination,
    goldEquivalent: value * definition.goldRate
  };
}

export function parseRange(raw, context, { optional = false } = {}) {
  const source = requireString(raw, context, "range");
  const text = source.trim();
  if (!text || DASH_TOKEN.test(text)) {
    if (optional) return null;
    fail("missing-range", raw, context, "range is required");
  }
  const stripped = text.replace(/\s*(?:фут(?:а|ов)?|фт\.?)$/iu, "").trim();
  const parts = stripped.split("/");
  if (parts.length > 2 || parts.some((part) => !part.trim())) {
    fail("invalid-range", raw, context, "range must be a normal distance or normal/long distance");
  }
  let normal;
  let long = null;
  try {
    normal = parseStrictNumberToken(parts[0], context, "range");
    if (parts.length === 2) long = parseStrictNumberToken(parts[1], context, "long range");
  } catch {
    fail("invalid-range", raw, context, "range must contain complete numeric distances");
  }
  if (normal < 0 || (long !== null && long < 0)) fail("negative-range", raw, context, "range cannot be negative");
  if (long !== null && long < normal) fail("invalid-long-range", raw, context, "long range cannot be shorter than normal range");
  return { normal, long };
}

export function parseDamageFormula(raw, context, { optional = false } = {}) {
  const source = requireString(raw, context, "damage formula");
  const text = source.trim();
  if (!text || DASH_TOKEN.test(text)) {
    if (optional) return null;
    fail("missing-damage-formula", raw, context, "damage formula is required");
  }
  const normalized = text.replace(/[кК]/gu, "d").replace(/\s+/gu, "");
  if (!/^(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/iu.test(normalized)) {
    fail("invalid-damage-formula", raw, context, "damage formula does not match the complete dice grammar");
  }
  return normalized.toLowerCase();
}

export function parseDelimitedList(raw, context, {
  delimiters = /[,;]/u,
  optional = false,
  unique = false
} = {}) {
  const source = requireString(raw, context, "delimited list");
  const text = source.trim();
  if (!text || DASH_TOKEN.test(text)) {
    if (optional) return null;
    return [];
  }
  const values = text.split(delimiters).map((value) => value.trim());
  if (values.some((value) => !value)) fail("invalid-list", raw, context, "delimited list contains an empty token");
  return unique ? [...new Set(values)] : values;
}

export function parseEnum(raw, context, { values, label = "enum", optional = false } = {}) {
  const source = requireString(raw, context, label);
  const text = source.trim();
  if (!text || DASH_TOKEN.test(text)) {
    if (optional) return null;
    fail("missing-enum", raw, context, `${label} is required`);
  }
  const key = text.toLocaleLowerCase("ru-RU");
  const definition = values instanceof Map ? values.get(key) : values?.[key];
  if (definition === undefined) fail("invalid-enum", raw, context, `Unknown ${label}: ${text}`);
  return definition;
}
