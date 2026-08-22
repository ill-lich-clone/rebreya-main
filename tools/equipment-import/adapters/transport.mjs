import {
  parseCurrency,
  parseDecimal,
  parseInteger,
  parseRequiredText,
  parseTransportWeight
} from "../parsers.mjs";
import {
  DEFAULT_ENRICHMENT_FIELDS,
  applyManualEnrichment,
  resolveStableIdentity
} from "../overrides.mjs";
import { ImportDiagnosticError, createImportDiagnostic, throwIfDiagnostics } from "../validation.mjs";

const DASH = /^(?:-|–|—)$/u;
const TYPES = new Set(["Скакун", "Водный транспорт", "Воздушный транспорт", "Механический транспорт"]);
const SIZES = new Set(["Крошечный", "Маленький", "Средний", "Большой", "Огромный", "Громадный"]);

function text(value) { return String(value ?? "").trim(); }
function missing(value) { const token = text(value); return !token || DASH.test(token); }
function context(snapshot, row, column) {
  return { sheetKey: snapshot.sheetKey, range: snapshot.range, rowNumber: row.rowNumber, column };
}
function fail(code, value, ctx, message) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({ code, value, message, ...ctx })]);
}
function validateOptionalInteger(raw, ctx, label, options = {}) {
  if (missing(raw)) return null;
  return parseInteger(text(raw), ctx, { min: 0, label, ...options });
}
function validateDistance(raw, ctx, label, unitPattern) {
  if (missing(raw)) return null;
  const match = text(raw).match(new RegExp(`^((?:\\d+(?:[.,]\\d+)?))(?:\\s+)${unitPattern}$`, "u"));
  if (!match) fail("invalid-transport-distance", raw, ctx, `Malformed ${label}: ${text(raw)}`);
  return parseDecimal(match[1], ctx, { min: 0, label });
}
function validateCombatSpeed(raw, ctx) {
  if (missing(raw)) return null;
  const match = text(raw).match(/^(\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+(?:[.,]\d+)?))?\s+футов$/u);
  if (!match) fail("invalid-transport-speed", raw, ctx, `Malformed transport combat speed: ${text(raw)}`);
  parseDecimal(match[1], ctx, { min: 0, label: "transport combat speed" });
  if (match[2]) parseDecimal(match[2], ctx, { min: 0, label: "transport secondary speed" });
}
function validateCapacity(raw, ctx) {
  if (missing(raw)) return null;
  const match = text(raw).match(/^(.+?)(?:\s*\/\s*(.+?))?\s*(фнт\.?|фунт(?:а|ов)?|тонн(?:а|ы)?)$/iu);
  if (!match) fail("invalid-transport-capacity", raw, ctx, `Malformed transport capacity: ${text(raw)}`);
  const unit = match[3];
  parseTransportWeight(`${match[1]} ${unit}`, ctx);
  if (match[2]) parseTransportWeight(`${match[2]} ${unit}`, ctx);
}
function validateFuelTank(raw, ctx) {
  if (missing(raw)) return null;
  const match = text(raw).match(/^(.+?)\s+(фнт\.?|фунт(?:а|ов)?|галлон(?:а|ов)?)$/iu);
  if (!match) fail("invalid-transport-fuel-tank", raw, ctx, `Malformed transport fuel tank: ${text(raw)}`);
  if (/^галлон/iu.test(match[2])) parseDecimal(match[1], ctx, { min: 0, label: "transport fuel tank" });
  else parseTransportWeight(text(raw), ctx);
}
function validatePrice(raw, ctx, { rental = false } = {}) {
  if (missing(raw)) return null;
  const value = text(raw);
  if (rental) {
    const match = value.match(/^(.+?\s*(?:мм|см|эм|зм|пм|cp|sp|ep|gp|pp))\s*\/\s*[\p{L}]+$/iu);
    if (!match) fail("invalid-transport-price", raw, ctx, `Malformed transport rental price: ${value}`);
    const parsed = parseCurrency(match[1], ctx);
    if (parsed?.kind !== "fixed") fail("invalid-transport-price", raw, ctx, `Malformed transport rental price: ${value}`);
    return parsed;
  }
  const parsed = parseCurrency(value, ctx);
  if (parsed?.kind !== "fixed") fail("invalid-transport-price", raw, ctx, `Transport price must be a fixed currency: ${value}`);
  return parsed;
}
function validateConsumption(raw, type, ctx) {
  if (missing(raw)) return null;
  const value = text(raw);
  const match = value.match(/^(Корм|Уголь|Мазут|Керосин|Бензин|Дизель),\s*([+]?(?:\d+(?:[.,]\d+)?|\d+\/\d+))\s+(фнт\.?|фунт(?:а|ов)?|галлон(?:а|ов)?)\s*\/\s*(день|милю)$/iu);
  if (!match) fail("invalid-transport-consumption", raw, ctx, `Malformed transport consumption: ${value}`);
  const isFeed = match[1].toLocaleLowerCase("ru-RU") === "корм";
  if ((type === "Скакун") !== isFeed || (isFeed ? match[4] !== "день" : match[4] !== "милю")) {
    fail("invalid-transport-consumption", raw, ctx, `Transport fuel/feed does not match type ${type}: ${value}`);
  }
  parseDecimal(match[2], ctx, { min: 0, label: "transport consumption" });
}
function exactReference(snapshot, row, referenceIndex, diagnostics) {
  const sourceRef = `${snapshot.sheetTitle}!A${row.rowNumber}`;
  const reference = referenceIndex?.gearBySourceRef?.get(sourceRef);
  if (!reference) {
    diagnostics.push(createImportDiagnostic({
      code: "missing-equipment-reference", sheetKey: snapshot.sheetKey, range: snapshot.range,
      rowNumber: row.rowNumber, column: "Название", value: row.cells?.Название,
      message: `Missing exact equipment reference for ${sourceRef}`
    }));
    return null;
  }
  referenceIndex.resolveStableGearId(reference);
  return reference;
}

export function adaptTransportCatalog({ snapshots, referenceIndex, overrides, diagnostics = [] }) {
  const snapshot = snapshots?.transport ?? snapshots;
  if (!snapshot) fail("missing-transport-snapshot", "", {}, "Transport snapshot is required");
  const entries = [];
  for (const row of snapshot.rows ?? []) {
    const cells = row.cells ?? {};
    const name = parseRequiredText(cells.Название, context(snapshot, row, "Название"));
    if (!exactReference(snapshot, row, referenceIndex, diagnostics)) continue;
    const type = text(cells["Тип транспорта"]);
    if (!TYPES.has(type)) fail("unknown-transport-type", type, context(snapshot, row, "Тип транспорта"), `Unknown transport type: ${type}`);
    validateOptionalInteger(cells["Год изобретения (распространения)"], context(snapshot, row, "Год изобретения (распространения)"), "transport invention year");
    validatePrice(cells.Цена, context(snapshot, row, "Цена"));
    validatePrice(cells["Цена аренды"], context(snapshot, row, "Цена аренды"), { rental: true });
    validateOptionalInteger(cells.Ранг, context(snapshot, row, "Ранг"), "transport rank", { max: 20 });
    if (!missing(cells.Вес)) parseTransportWeight(text(cells.Вес), context(snapshot, row, "Вес"));
    validateOptionalInteger(cells.Хиты, context(snapshot, row, "Хиты"), "transport HP");
    validateOptionalInteger(cells.КД, context(snapshot, row, "КД"), "transport AC", { max: 50 });
    validateCombatSpeed(cells["Скорость (сражение)"], context(snapshot, row, "Скорость (сражение)"));
    validateDistance(cells["Разгон (футы)"], context(snapshot, row, "Разгон (футы)"), "transport acceleration", "футов");
    validateDistance(cells["Скорость путешествия"], context(snapshot, row, "Скорость путешествия"), "transport travel speed", "мил(?:я|и|ь)\\s*\\/\\s*час");
    validateOptionalInteger(cells["Граница поломки (к20)"], context(snapshot, row, "Граница поломки (к20)"), "breakdown threshold", { max: 20 });
    validateConsumption(cells["Топливо или корм и расход"], type, context(snapshot, row, "Топливо или корм и расход"));
    validateFuelTank(cells["Топливный бак"], context(snapshot, row, "Топливный бак"));
    validateDistance(cells["Запас хода"], context(snapshot, row, "Запас хода"), "transport range", "мил(?:я|и|ь)");
    validateOptionalInteger(cells.Экипаж, context(snapshot, row, "Экипаж"), "transport crew");
    validateOptionalInteger(cells.Пассажиры, context(snapshot, row, "Пассажиры"), "transport passengers");
    validateOptionalInteger(cells.Сила, context(snapshot, row, "Сила"), "transport strength", { max: 30 });
    const size = text(cells.Размер);
    if (!missing(size) && !SIZES.has(size)) fail("unknown-transport-size", size, context(snapshot, row, "Размер"), `Unknown transport size: ${size}`);
    validateCapacity(cells.Грузоподъемность, context(snapshot, row, "Грузоподъемность"));

    const stableId = resolveStableIdentity({ catalog: "transport", sourceKey: name, sourceName: `transport-v01-${name}`, overrides });
    const generated = {
      sourceId: stableId,
      sourceRow: row.rowNumber,
      name,
      inventionYear: text(cells["Год изобретения (распространения)"]),
      type,
      price: text(cells.Цена),
      rentalPrice: text(cells["Цена аренды"]),
      rank: text(cells.Ранг),
      weight: text(cells.Вес),
      hp: text(cells.Хиты),
      ac: text(cells.КД),
      combatSpeed: text(cells["Скорость (сражение)"]),
      acceleration: text(cells["Разгон (футы)"]),
      travelSpeed: text(cells["Скорость путешествия"]),
      breakdownThreshold: text(cells["Граница поломки (к20)"]),
      consumption: text(cells["Топливо или корм и расход"]),
      fuelTank: text(cells["Топливный бак"]),
      range: text(cells["Запас хода"]),
      crew: text(cells.Экипаж),
      passengers: text(cells.Пассажиры),
      strength: text(cells.Сила),
      size,
      cargoCapacity: text(cells.Грузоподъемность),
      description: typeof cells.Описание === "string" ? cells.Описание : ""
    };
    const enriched = applyManualEnrichment({
      catalog: "transport", stableId, generated, overrides,
      allowedFields: DEFAULT_ENRICHMENT_FIELDS.transport
    });
    if (!/^lchtransport\d{4}$/u.test(enriched.documentId ?? "")) {
      fail("missing-transport-document-id", enriched.documentId, context(snapshot, row, "Название"), `Transport ${name} requires a stable documentId override`);
    }
    entries.push(enriched);
  }
  throwIfDiagnostics(diagnostics, "Transport catalog adaptation failed");
  return entries;
}
