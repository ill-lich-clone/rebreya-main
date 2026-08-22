import {
  parseBooleanToken,
  parseCurrency,
  parseDecimal,
  parseEnum,
  parseInteger,
  parseRequiredText
} from "../parsers.mjs";
import {
  buildMagicItemSourceKey,
  resolveStableIdentity
} from "../overrides.mjs";
import {
  ImportDiagnosticError,
  createImportDiagnostic,
  throwIfDiagnostics
} from "../validation.mjs";

const DASH = /^(?:-|–|—)$/u;
const MAGIC_ITEM_TYPE = "Магический предмет";
const RARITIES = enumMap([
  "Обычный",
  "Необычный",
  "Редкий",
  "Очень редкий",
  "Легендарный",
  "Артефакт"
]);
const ITEM_TYPES = new Map([
  ...enumMap([
    "Оружие",
    "Волшебная палочка",
    "Доспех",
    "Жезл",
    "Кольцо",
    "Посох",
    "Свиток",
    "Чудесный предмет",
    "Талисман"
  ]),
  [enumKey("Чудестный предмет"), "Чудесный предмет"]
]);
const ITEM_SLOTS = enumMap([
  "Рука",
  "Шея",
  "Спина",
  "Грудь",
  "Голова",
  "Кольцо",
  "Плечи",
  "Наручи",
  "Ноги",
  "Пояс",
  "Любой"
]);
const MATERIALS = enumMap([
  "Стандартные",
  "Труднодоступные",
  "Доступные",
  "Стандарт",
  "НА РЕВОРК",
  "Распространённые"
]);
const BARGAINING = enumMap([
  "Удачные",
  "Выгодные",
  "Нормальные",
  "Невыгодные",
  "Невозможные",
  "Провальные",
  "НА РЕВОРК",
  "Заберите пожалуйста",
  "Запрещённые",
  "Доступные"
]);
const IMPACT = enumMap(["Минор", "Мажор"]);
const REWORK = enumMap(["1", "0", "Выполнен"]);
const GENERIC_BASE_SUBTYPES = new Set([
  "боеприпас",
  "меч",
  "молоты",
  "любой",
  "любое",
  "топор",
  "лук",
  "стрела",
  "татуировка",
  "тяжелый",
  "легкий",
  "арбалет",
  "средний, тяжелый",
  "священный символ",
  "любой боеприпас",
  "оружие"
]);
const VARIABLE_COST = /^(?:(?:\((?:\d+)?d\d+(?:(?:kh|kl)\d+)?(?:[+-]\d+)?\)|(?:\d+)?d\d+(?:(?:kh|kl)\d+)?(?:[+-]\d+)?)\*(?:\d{1,3}(?: \d{3})+|\d+)|\d+\+(?:\d+)?d\d+(?:(?:kh|kl)\d+)?\*(?:\d{1,3}(?: \d{3})+|\d+))\s*(?:мм|см|эм|зм|пм|cp|sp|ep|gp|pp)$/iu;

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ");
}

function enumKey(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ru-RU");
}

function enumMap(values) {
  return new Map(values.map((value) => [enumKey(value), value]));
}

function text(value) {
  return String(value ?? "").trim();
}

function missing(value) {
  const valueText = text(value);
  return !valueText || DASH.test(valueText);
}

function context(snapshot, row, column) {
  return {
    sheetKey: snapshot.sheetKey,
    range: snapshot.range,
    rowNumber: row.rowNumber,
    column
  };
}

function fail(code, raw, ctx, message) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({
    code,
    value: raw,
    message,
    ...ctx
  })]);
}

function optionalEnum(raw, ctx, values, label) {
  if (missing(raw)) return "";
  return parseEnum(text(raw), ctx, { values, label });
}

function optionalRank(raw, ctx) {
  if (missing(raw)) return 0;
  return parseInteger(text(raw), ctx, { min: 0, max: 12, label: "magic item rank" });
}

function optionalValue(raw, ctx) {
  if (missing(raw)) return 0;
  return parseDecimal(text(raw), ctx, { min: 0, label: "magic item value" });
}

function validateCost(raw, ctx) {
  if (missing(raw)) return;
  const value = text(raw);
  const parsed = parseCurrency(value, ctx);
  if (parsed?.kind === "fixed") return;
  const compact = value.replace(/[\u00a0\u202f]/gu, " ").replace(/\s*([+*()])\s*/gu, "$1");
  if (compact === "Цена зависит от уровня" || VARIABLE_COST.test(compact)) return;
  fail("invalid-magic-item-cost", raw, ctx, `Malformed magic item cost: ${value}`);
}

function isNumberOnlyPlaceholder(row) {
  const cells = row.cells ?? {};
  if (!text(cells["№"]) || text(cells.Название)) return false;
  return Object.entries(cells).every(([column, value]) => column === "№" || !text(value));
}

function validateBaseEquipmentReference({ itemType, itemSubtype, snapshot, row, referenceIndex, diagnostics }) {
  if (!itemSubtype || GENERIC_BASE_SUBTYPES.has(normalize(itemSubtype))) return;
  if (!["Оружие", "Доспех", "Посох"].includes(itemType)) return;
  const reference = [...(referenceIndex?.gearByKey?.values?.() ?? [])]
    .find((entry) => normalize(entry.canonicalName) === normalize(itemSubtype));
  if (!reference) {
    diagnostics.push(createImportDiagnostic({
      code: "missing-magic-base-equipment",
      sheetKey: snapshot.sheetKey,
      range: snapshot.range,
      rowNumber: row.rowNumber,
      column: "Подтип",
      value: itemSubtype,
      message: `Missing base equipment reference for magic item subtype: ${itemSubtype}`
    }));
    return;
  }
  referenceIndex.resolveStableGearId(reference);
}

export function adaptMagicItemsCatalog({ snapshots, overrides, referenceIndex, diagnostics = [] }) {
  const snapshot = snapshots?.magicItems ?? snapshots;
  if (!snapshot) fail("missing-magic-items-snapshot", "", {}, "Magic items snapshot is required");
  const items = [];
  const sourceNumbers = new Map();
  const stableIds = new Map();

  for (const row of snapshot.rows ?? []) {
    if (isNumberOnlyPlaceholder(row)) continue;
    const cells = row.cells ?? {};
    const sourceNumber = parseInteger(text(cells["№"]), context(snapshot, row, "№"), {
      min: 1,
      label: "magic item source number"
    });
    if (sourceNumbers.has(sourceNumber)) {
      diagnostics.push(createImportDiagnostic({
        code: "duplicate-magic-source-number",
        sheetKey: snapshot.sheetKey,
        range: snapshot.range,
        rowNumber: row.rowNumber,
        column: "№",
        value: cells["№"],
        message: `Duplicate magic item source number ${sourceNumber}; first seen at row ${sourceNumbers.get(sourceNumber)}`
      }));
      continue;
    }
    sourceNumbers.set(sourceNumber, row.rowNumber);

    const name = parseRequiredText(cells.Название, context(snapshot, row, "Название"));
    const description = parseRequiredText(cells.Описание, context(snapshot, row, "Описание"));
    const rarity = optionalEnum(cells.Редкость, context(snapshot, row, "Редкость"), RARITIES, "magic item rarity");
    const itemType = optionalEnum(cells.Тип, context(snapshot, row, "Тип"), ITEM_TYPES, "magic item type");
    const itemSubtype = missing(cells.Подтип) ? "" : text(cells.Подтип);
    const itemSlot = optionalEnum(cells.Слот, context(snapshot, row, "Слот"), ITEM_SLOTS, "magic item slot");
    const materials = optionalEnum(cells.Материалы, context(snapshot, row, "Материалы"), MATERIALS, "magic item materials");
    const bargaining = optionalEnum(cells.Торги, context(snapshot, row, "Торги"), BARGAINING, "magic item bargaining");
    const impact = optionalEnum(cells.Влиятельность, context(snapshot, row, "Влиятельность"), IMPACT, "magic item impact");
    const attunementFlag = parseBooleanToken(text(cells.Настройка), context(snapshot, row, "Настройка"), { optional: true });
    const attunement = missing(cells["Настройка детали"]) ? "" : text(cells["Настройка детали"]);
    const isConsumable = parseBooleanToken(text(cells.Расходник), context(snapshot, row, "Расходник"), { optional: true }) ?? false;
    optionalEnum(cells.РЕВОРК, context(snapshot, row, "РЕВОРК"), REWORK, "magic item rework state");
    validateCost(cells.Стоимость, context(snapshot, row, "Стоимость"));
    validateBaseEquipmentReference({ itemType, itemSubtype, snapshot, row, referenceIndex, diagnostics });

    if (attunementFlag === false && !["", "0"].includes(attunement)) {
      diagnostics.push(createImportDiagnostic({
        code: "contradictory-magic-attunement",
        sheetKey: snapshot.sheetKey,
        range: snapshot.range,
        rowNumber: row.rowNumber,
        column: "Настройка детали",
        value: cells["Настройка детали"],
        message: "Magic item attunement details are populated while attunement is false"
      }));
    }

    const sourceKey = buildMagicItemSourceKey({ sourceNumber });
    const stableId = resolveStableIdentity({ catalog: "magicItems", sourceKey, sourceName: name, overrides });
    if (stableIds.has(stableId)) {
      diagnostics.push(createImportDiagnostic({
        code: "duplicate-magic-item-id",
        sheetKey: snapshot.sheetKey,
        range: snapshot.range,
        rowNumber: row.rowNumber,
        column: "№",
        value: stableId,
        message: `Duplicate magic item stable id ${stableId}; first seen at row ${stableIds.get(stableId)}`
      }));
      continue;
    }
    stableIds.set(stableId, row.rowNumber);

    items.push({
      id: stableId,
      name,
      type: MAGIC_ITEM_TYPE,
      rarity,
      itemType,
      itemSubtype,
      itemSlot,
      source: missing(cells.Источник) ? "" : text(cells.Источник),
      rank: optionalRank(cells.Ранг, context(snapshot, row, "Ранг")),
      materials,
      bargaining,
      costText: missing(cells.Стоимость) ? "" : text(cells.Стоимость),
      impact,
      attunement,
      isConsumable,
      description,
      value: optionalValue(cells.Value, context(snapshot, row, "Value"))
    });
  }

  throwIfDiagnostics(diagnostics, "Magic items catalog adaptation failed");
  return items;
}

export function renderMagicItemsModule(items) {
  return `// Generated by the unified equipment importer. Do not edit manually.\nexport const MAGIC_ITEMS = ${JSON.stringify(items, null, 2)};\n`;
}
