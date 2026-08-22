import { parseCurrency, parseInteger, parseRequiredText } from "../parsers.mjs";
import { resolveStableIdentity } from "../overrides.mjs";
import { ImportDiagnosticError, createImportDiagnostic, throwIfDiagnostics } from "../validation.mjs";

const COMPATIBILITY = new Map([
  ["Чудестный предмет", ["wondrous-item"]], ["Оружие", ["weapon"]],
  ["Верхняя одежда (Щит)", ["outerwear", "shield"]], ["Верхняя одежда", ["outerwear"]],
  ["Доспех", ["armor"]], ["Любой", ["any"]],
  ["Оружие (кастет или металлическая перчатка)", ["weapon", "brass-knuckles-or-metal-gauntlet"]],
  ["Оружие (не металлическое)", ["weapon", "nonmetal"]],
  ["Оружие (Дальнобойное)", ["weapon", "ranged"]], ["Оружие (дальнобойное)", ["weapon", "ranged"]],
  ["Оружие (рукопашное)", ["weapon", "melee"]]
]);
const TYPES = new Set(["Материал", "Зачарование"]);
const DASH = /^(?:-|–|—)$/u;

function text(value) { return String(value ?? "").trim(); }
function context(snapshot, row, column) {
  return { sheetKey: snapshot.sheetKey, range: snapshot.range, rowNumber: row.rowNumber, column };
}
function fail(code, value, ctx, message) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({ code, value, message, ...ctx })]);
}

export function adaptUpgradeCatalog({ snapshot, referenceIndex, overrides, diagnostics = [] }) {
  const entries = [];
  for (const row of snapshot.rows ?? []) {
    const cells = row.cells ?? {};
    const type = text(cells.Тип);
    if (type === "Проклятье") continue;
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
    const price = parseCurrency(text(cells["Цена (зм)"]), context(snapshot, row, "Цена (зм)"));
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
        sourceMaterialId: hasMaterial
          ? resolveStableIdentity({ catalog: "materials", sourceKey: sourceMaterialName, sourceName: sourceMaterialName, overrides })
          : null,
        type,
        sourceSheet: snapshot.sheetTitle,
        sourceSheetRow: row.rowNumber
      }
    });
  }
  throwIfDiagnostics(diagnostics, "Upgrade catalog adaptation failed");
  return entries;
}
