import { parseCurrency, parseInteger, parseRequiredText } from "../parsers.mjs";
import { ImportDiagnosticError, createImportDiagnostic, throwIfDiagnostics } from "../validation.mjs";

const COMPATIBILITY = new Map([
  ["Чудестный предмет", ["wondrous-item"]], ["Чудесный предмет", ["wondrous-item"]],
  ["Чудесный предмет (носимый)", ["wondrous-item", "worn"]],
  ["Чудесный предмет (закрывающаяся ёмкость)", ["wondrous-item", "closable-container"]],
  ["Чудесный предмет (магическая фокусировка)", ["wondrous-item", "spellcasting-focus"]],
  ["Оружие", ["weapon"]],
  ["Верхняя одежда (Щит)", ["outerwear", "shield"]], ["Верхняя одежда", ["outerwear"]],
  ["Верхняя одежда (щит)", ["outerwear", "shield"]],
  ["Доспех", ["armor"]], ["Любой", ["any"]],
  ["Любой (металлический)", ["any", "metallic"]],
  ["Оружие (кастет или металлическая перчатка)", ["weapon", "brass-knuckles-or-metal-gauntlet"]],
  ["Оружие (не металлическое)", ["weapon", "nonmetal"]],
  ["Оружие (Дальнобойное)", ["weapon", "ranged"]], ["Оружие (дальнобойное)", ["weapon", "ranged"]],
  ["Оружие (рукопашное)", ["weapon", "melee"]],
  ["Оружие (со свойством «Смена хвата»)", ["weapon", "grip-change"]],
  ["Оружие (луки и арбалеты)", ["weapon", "bow-or-crossbow"]]
]);
const TYPES = new Set(["Материал", "Зачарование", "Проклятье"]);
const DASH = /^(?:-|–|—)$/u;

function text(value) { return String(value ?? "").trim(); }
function normalizedName(value) {
  return text(value).normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/\s+/gu, " ");
}
function materialIdsByName(materials) {
  const result = new Map();
  for (const material of materials ?? []) {
    const name = normalizedName(material?.name);
    const id = text(material?.id);
    if (!name || !id) continue;
    if (result.has(name) && result.get(name) !== id) {
      fail("duplicate-material-name", material?.name, {}, `Material name resolves to multiple stable IDs: ${material?.name}`);
    }
    result.set(name, id);
  }
  return result;
}
function context(snapshot, row, column) {
  return { sheetKey: snapshot.sheetKey, range: snapshot.range, rowNumber: row.rowNumber, column };
}
function fail(code, value, ctx, message) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({ code, value, message, ...ctx })]);
}

function parseGoldColumnPrice(raw, ctx) {
  const value = text(raw);
  const normalized = /^[+-]?(?:\d{1,3}(?: \d{3})+|\d+)(?:[.,]\d+)?$/u.test(value)
    ? `${value} зм`
    : value;
  return parseCurrency(normalized, ctx);
}

export function adaptUpgradeCatalog({ snapshot, referenceIndex, overrides, materials = [], diagnostics = [] }) {
  const materialIndex = materialIdsByName(materials);
  const entries = [];
  for (const row of snapshot.rows ?? []) {
    const cells = row.cells ?? {};
    const type = text(cells.Тип);
    if (!TYPES.has(type)) fail("unknown-upgrade-type", type, context(snapshot, row, "Тип"), `Unknown upgrade type: ${type}`);
    const appliesTo = parseRequiredText(cells["Применимо к"], context(snapshot, row, "Применимо к"));
    const compatibility = COMPATIBILITY.get(appliesTo);
    if (!compatibility) fail("unknown-upgrade-compatibility", appliesTo, context(snapshot, row, "Применимо к"), `Unknown upgrade compatibility: ${appliesTo}`);
    const sourceRef = `${snapshot.sheetTitle}!A${row.rowNumber}`;
    const reference = referenceIndex?.gearBySourceRef?.get(sourceRef);
    if (!reference) {
      diagnostics.push(createImportDiagnostic({
        code: "missing-equipment-reference", sheetKey: snapshot.sheetKey, range: snapshot.range,
        rowNumber: row.rowNumber, column: "Название", value: cells.Название,
        message: `Missing exact equipment reference for ${sourceRef}`
      }));
      continue;
    }
    const price = parseGoldColumnPrice(cells["Цена (зм)"], context(snapshot, row, "Цена (зм)"));
    if (price?.kind !== "fixed") fail("invalid-upgrade-price", cells["Цена (зм)"], context(snapshot, row, "Цена (зм)"), "Upgrade price must be fixed currency");
    const sourceMaterialName = text(cells.Источник);
    const hasMaterial = sourceMaterialName && !DASH.test(sourceMaterialName);
    entries.push({
      name: parseRequiredText(cells.Название, context(snapshot, row, "Название")),
      productId: referenceIndex.resolveStableGearId(reference),
      canonicalName: reference.canonicalName,
      upgrade: {
        rank: parseInteger(text(cells.Ранг), context(snapshot, row, "Ранг"), { min: 0, max: 20, label: "upgrade rank" }),
        appliesTo,
        compatibility: [...compatibility],
        effect: text(cells.Эффект),
        priceGold: price.goldEquivalent,
        sourceWeight: null,
        sourceMaterialName: hasMaterial ? sourceMaterialName : "",
        sourceMaterialId: hasMaterial ? materialIndex.get(normalizedName(sourceMaterialName)) ?? null : null,
        type,
        sourceSheet: snapshot.sheetTitle,
        sourceSheetRow: row.rowNumber
      }
    });
  }
  throwIfDiagnostics(diagnostics, "Upgrade catalog adaptation failed");
  return entries;
}
