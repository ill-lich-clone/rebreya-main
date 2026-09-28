import { createHash } from "node:crypto";

export const ALCHEMY_SPREADSHEET_ID = "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk";

export const ALCHEMY_SHEET = Object.freeze({
  sheetId: 179310389,
  sheetTitle: "Алхимические продукты V1",
  range: "'Алхимические продукты V1'!A3:V996",
  dataStartRow: 3,
  width: 22
});

export const ALCHEMY_COLUMNS = Object.freeze([
  "sourceNumber", "name", "productType", "priceFormula", "rank", "reagentLevel",
  "effect", "catalystEffect", "fire", "water", "earth", "air", "positive", "negative",
  "mandatoryComponent", "craftingDc", "privateCatalyst", "activation", "duration",
  "requirements", "simplifiedCreation", "radiusOrEmanation"
]);

function columnName(index) {
  return String.fromCharCode(65 + index);
}

function approvedSheet(metadata) {
  return metadata?.sheets?.find((sheet) => sheet?.properties?.title === ALCHEMY_SHEET.sheetTitle) ?? null;
}

function sourceFingerprint(values) {
  const source = {
    spreadsheetId: ALCHEMY_SPREADSHEET_ID,
    sheetId: ALCHEMY_SHEET.sheetId,
    sheetTitle: ALCHEMY_SHEET.sheetTitle,
    range: ALCHEMY_SHEET.range,
    values
  };
  return createHash("sha256").update(JSON.stringify(source), "utf8").digest("hex");
}

export function buildAlchemySourceSnapshot({ spreadsheetId, metadata, values }) {
  if (spreadsheetId !== ALCHEMY_SPREADSHEET_ID) {
    throw new Error(`Unexpected alchemy spreadsheet id: ${spreadsheetId}`);
  }
  const sheet = approvedSheet(metadata);
  if (!sheet) throw new Error(`Missing approved alchemy sheet: ${ALCHEMY_SHEET.sheetTitle}`);
  if (sheet.properties.sheetId !== ALCHEMY_SHEET.sheetId) {
    throw new Error(`Alchemy sheet id mismatch: expected ${ALCHEMY_SHEET.sheetId}`);
  }
  if (!Array.isArray(values)) throw new Error("Alchemy formatted values must be an array of rows");

  const normalizedValues = [];
  const rows = [];
  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const sourceRow = values[rowIndex];
    const rowNumber = ALCHEMY_SHEET.dataStartRow + rowIndex;
    if (!Array.isArray(sourceRow)) throw new Error(`Alchemy row ${rowNumber} must be an array`);
    if (sourceRow.length > ALCHEMY_SHEET.width) {
      throw new Error(`Alchemy row ${rowNumber} exceeds ${ALCHEMY_SHEET.width} columns`);
    }
    const normalized = Array.from({ length: ALCHEMY_SHEET.width }, (_, columnIndex) => {
      const value = sourceRow[columnIndex] ?? "";
      if (typeof value !== "string") {
        throw new Error(`Alchemy formatted string required at ${columnName(columnIndex)}${rowNumber}`);
      }
      return value;
    });
    if (!normalized.some((value) => value.trim())) continue;
    normalizedValues.push(normalized);
    rows.push(Object.freeze({ rowNumber, values: Object.freeze(normalized) }));
  }
  if (rows.length !== 230) throw new Error(`Alchemy source must contain exactly 230 products; received ${rows.length}`);

  return Object.freeze({
    spreadsheetId,
    sheetId: ALCHEMY_SHEET.sheetId,
    sheetTitle: ALCHEMY_SHEET.sheetTitle,
    range: ALCHEMY_SHEET.range,
    fingerprint: sourceFingerprint(normalizedValues),
    rows: Object.freeze(rows)
  });
}
