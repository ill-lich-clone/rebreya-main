import { parseDecimal, parseInteger, parseRequiredText } from "../parsers.mjs";
import {
  DEFAULT_ENRICHMENT_FIELDS,
  applyManualEnrichment,
  resolveStableIdentity
} from "../overrides.mjs";
import { ImportDiagnosticError, createImportDiagnostic, throwIfDiagnostics } from "../validation.mjs";

const DASH = /^(?:-|–|—)$/u;
const TYPES = new Set([
  "—", "Военная", "Волшебные", "Гражданский", "Древняя", "Общая",
  "Сверхтяжёлая", "Титаническая", "Транспортный узел"
]);
const MAGICAL_TYPES = new Set(["Волшебные", "Древняя", "Титаническая"]);
const AUTOMATION_BY_NAME = new Map([["Навесная броня", "mounted-armor-ac"]]);

function text(value) { return String(value ?? "").trim(); }
function context(snapshot, rowNumber, column) {
  return { sheetKey: snapshot.sheetKey, range: snapshot.range, rowNumber, column };
}
function fail(code, value, ctx, message) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({ code, value, message, ...ctx })]);
}

function parsePoints(raw, ctx) {
  const value = text(raw);
  if (!value) return { text: "", min: null, max: null, installable: false };
  const shell = value.match(/^Оболочка\s*\((\d+)\)$/u);
  if (shell) {
    const amount = parseInteger(shell[1], ctx, { min: 0, max: 20, label: "implant points" });
    return { text: value, min: amount, max: amount, installable: true };
  }
  const range = value.match(/^(\d+)\s*[–-]\s*(\d+)$/u);
  if (range) {
    const min = parseInteger(range[1], ctx, { min: 0, max: 20, label: "implant points minimum" });
    const max = parseInteger(range[2], ctx, { min, max: 20, label: "implant points maximum" });
    return { text: value, min, max, installable: true };
  }
  if (/^\d+$/u.test(value)) {
    const amount = parseInteger(value, ctx, { min: 0, max: 20, label: "implant points" });
    return { text: value, min: amount, max: amount, installable: true };
  }
  fail("invalid-implant-points", raw, ctx, `Malformed implant points: ${value}`);
}

function parseImplantPrice(raw, ctx) {
  const value = text(raw);
  if (!value) return { value: 0, denomination: "gp", goldEquivalent: 0 };
  const fixed = value.match(/^((?:\d{1,3}(?: \d{3})+|\d+)(?:[.,]\d+)?)\s*(?:зм)?(?:\s*\([^()]+\))?$/u);
  if (fixed) {
    const amount = parseDecimal(fixed[1], ctx, { min: 0, label: "implant price" });
    return { value: amount, denomination: "gp", goldEquivalent: amount };
  }
  if (/^[\p{L}][\p{L}\p{M}\s«»"'’-]*$/u.test(value)) {
    return { value: 0, denomination: "gp", goldEquivalent: 0 };
  }
  fail("invalid-implant-price", raw, ctx, `Malformed implant price: ${value}`);
}

function exactReference(snapshot, rowNumber, name, referenceIndex, diagnostics) {
  const sourceRef = `${snapshot.sheetTitle}!A${rowNumber}`;
  const reference = referenceIndex?.gearBySourceRef?.get(sourceRef);
  if (!reference) {
    diagnostics.push(createImportDiagnostic({
      code: "missing-equipment-reference", sheetKey: snapshot.sheetKey, range: snapshot.range,
      rowNumber, column: "Название", value: name,
      message: `Missing exact equipment reference for ${sourceRef}`
    }));
    return null;
  }
  referenceIndex.resolveStableGearId(reference);
  return reference;
}

export function adaptImplantsCatalog({ snapshot, referenceIndex, overrides, diagnostics = [] }) {
  if (!snapshot || snapshot.layout !== "raw") fail("missing-implant-snapshot", "", {}, "Raw implant snapshot is required");
  const entries = [];
  for (let rowNumber = 2; rowNumber <= (snapshot.values?.length ?? 0); rowNumber += 1) {
    const row = snapshot.values[rowNumber - 1] ?? [];
    const name = text(row[0]);
    if (!name) continue;
    if (!exactReference(snapshot, rowNumber, name, referenceIndex, diagnostics)) continue;
    const type = text(row[6]);
    if (!TYPES.has(type)) fail("unknown-implant-type", row[6], context(snapshot, rowNumber, "Тип"), `Unknown implant type: ${type}`);
    const points = parsePoints(row[2], context(snapshot, rowNumber, "Очки модификации"));
    const price = parseImplantPrice(row[5], context(snapshot, rowNumber, "Цена (ЗМ ) и Источник"));
    const rawRank = text(row[1]);
    const rank = rawRank && !DASH.test(rawRank)
      ? parseInteger(rawRank, context(snapshot, rowNumber, "Ранг"), { min: 0, max: 20, label: "implant rank" })
      : 0;
    const kind = MAGICAL_TYPES.has(type) ? "magical" : "mechanical";
    const stableId = resolveStableIdentity({ catalog: "implants", sourceKey: name, sourceName: `implant-${name}`, overrides });
    const effect = text(row[3]);
    const implant = {
      pointsText: points.text,
      pointsMin: points.min,
      pointsMax: points.max,
      effect,
      requirements: text(row[4]),
      type,
      kind,
      magical: kind === "magical",
      installable: points.installable,
      sourceSheet: snapshot.sheetTitle,
      sourceSheetRow: rowNumber
    };
    const automationKey = AUTOMATION_BY_NAME.get(name);
    if (automationKey) implant.automationKey = automationKey;
    entries.push(applyManualEnrichment({
      catalog: "implants", stableId, overrides,
      allowedFields: DEFAULT_ENRICHMENT_FIELDS.implants,
      generated: {
        id: stableId,
        name: parseRequiredText(name, context(snapshot, rowNumber, "Название")),
        equipmentType: "Имплант",
        shopSubtype: "",
        priceText: text(row[5]),
        priceValue: price.value,
        priceDenomination: price.denomination,
        priceGoldEquivalent: price.goldEquivalent,
        rank,
        weight: 0,
        description: effect,
        foundryType: "equipment",
        foundrySubtype: "wondrous",
        foundryFolder: `Импланты/${kind === "magical" ? "Магические" : "Механические"}/${type === "—" ? "Без типа" : type}`,
        itemSlot: "",
        heroDollSlots: [],
        source: "gear-workbook-implants-v0.1",
        implant
      }
    }));
  }
  throwIfDiagnostics(diagnostics, "Implants catalog adaptation failed");
  return entries;
}
