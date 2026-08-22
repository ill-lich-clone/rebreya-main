import {
  parseDecimal,
  parseInteger,
  parseRequiredText,
  parseWeight
} from "../parsers.mjs";
import { applyManualEnrichment, resolveStableIdentity } from "../overrides.mjs";
import { createImportDiagnostic, throwIfDiagnostics } from "../validation.mjs";
import { EQUIPMENT_SPREADSHEET_ID } from "../sheet-registry.mjs";

const DASH = /^(?:-|–|—)$/u;
const MATERIAL_ENRICHMENT_FIELDS = Object.freeze(["linkedGoodId", "linkedGoodName"]);

function context(snapshot, row, column) {
  return { sheetKey: snapshot.sheetKey, range: snapshot.range, rowNumber: row.rowNumber, column };
}

function optionalDecimal(raw, ctx, options) {
  const value = String(raw ?? "").trim();
  if (!value || DASH.test(value)) return null;
  const match = value.match(/^(.+?)(?:\s*зм)?$/iu);
  return parseDecimal(match?.[1] ?? value, ctx, options);
}

function optionalInteger(raw, ctx, options) {
  const value = String(raw ?? "").trim();
  return !value || DASH.test(value) ? null : parseInteger(value, ctx, options);
}

function literal(cells, column) {
  const value = cells[column];
  return typeof value === "string" ? value : "";
}

export function adaptMaterialsCatalog({ snapshot, overrides, diagnostics = [] }) {
  const materials = [];
  const seenNames = new Set();
  const seenIds = new Set();
  for (const row of snapshot?.rows ?? []) {
    const cells = row.cells ?? {};
    const name = parseRequiredText(cells.Название, context(snapshot, row, "Название"));
    const nameKey = name.toLocaleLowerCase("ru-RU");
    if (seenNames.has(nameKey)) {
      diagnostics.push(createImportDiagnostic({
        code: "duplicate-material-name", sheetKey: snapshot.sheetKey, range: snapshot.range,
        rowNumber: row.rowNumber, column: "Название", value: name,
        message: `Duplicate material name: ${name}`
      }));
      continue;
    }
    seenNames.add(nameKey);
    const stableId = resolveStableIdentity({ catalog: "materials", sourceKey: name, sourceName: `material-${name}`, overrides });
    if (seenIds.has(stableId)) {
      diagnostics.push(createImportDiagnostic({
        code: "duplicate-material-id", sheetKey: snapshot.sheetKey, range: snapshot.range,
        rowNumber: row.rowNumber, column: "Название", value: stableId,
        message: `Duplicate material stable id: ${stableId}`
      }));
      continue;
    }
    seenIds.add(stableId);
    const generated = {
      id: stableId,
      name,
      type: parseRequiredText(cells.Тип, context(snapshot, row, "Тип")),
      subtype: String(cells["Подтип / добыча"] ?? "").trim(),
      priceGold: optionalDecimal(cells["Цена (зм)"], context(snapshot, row, "Цена (зм)"), { min: 0, label: "material price" }),
      weight: (() => {
        const value = String(cells["Вес (фнт)"] ?? "").trim();
        return !value ? null : parseWeight(value, context(snapshot, row, "Вес (фнт)"));
      })(),
      rank: optionalInteger(cells.Ранг, context(snapshot, row, "Ранг"), { min: 0, max: 20, label: "material rank" }),
      description: literal(cells, "Описание"),
      linkedGoodId: null,
      linkedGoodName: null,
      applications: {
        upgrade: literal(cells, "Усовершенствование"),
        implant: literal(cells, "Имплант"),
        crafting: literal(cells, "Создание и Снаряжение"),
        alchemy: literal(cells, "Алхимия"),
        knowledge: literal(cells, "Знания")
      },
      alchemyAspects: literal(cells, "Аспекты (алхимия)"),
      source: {
        spreadsheetId: EQUIPMENT_SPREADSHEET_ID,
        sheetName: snapshot.sheetTitle,
        row: row.rowNumber
      },
      isSynthetic: false
    };
    materials.push(applyManualEnrichment({
      catalog: "materials", stableId, generated, overrides,
      allowedFields: MATERIAL_ENRICHMENT_FIELDS
    }));
  }
  throwIfDiagnostics(diagnostics, "Materials catalog adaptation failed");
  return materials;
}
