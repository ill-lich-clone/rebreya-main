import { createHash } from "node:crypto";

import { NARRATIVE_SHEET_DEFINITION } from "./sheet-definitions.mjs";

const clean = (value) => String(value ?? "").trim();

const normalizeName = (value) => clean(value).toLocaleLowerCase("ru");

const stableVariantId = (fields) => createHash("sha256")
  .update(fields.join("\u0000"), "utf8")
  .digest("hex")
  .slice(0, 24);

function assertHeaders(headers) {
  if (JSON.stringify(headers) !== JSON.stringify(NARRATIVE_SHEET_DEFINITION.headers)) {
    throw new Error(`invalid narrative headers: ${headers.join(" | ")}`);
  }
}

export function buildNarrativeArtifacts({ spreadsheetId, importedAt, values, gear }) {
  if (!Array.isArray(values) || !Array.isArray(gear)) {
    throw new TypeError("narrative values and gear must be arrays");
  }

  const [rawHeaders = [], ...sourceRows] = values;
  const headers = NARRATIVE_SHEET_DEFINITION.headers.map((_header, index) => String(rawHeaders[index] ?? ""));
  assertHeaders(headers);

  const gearByName = new Map();
  for (const item of gear) {
    const key = normalizeName(item?.name);
    if (!key) continue;
    const bucket = gearByName.get(key) ?? [];
    bucket.push(item);
    gearByName.set(key, bucket);
  }

  const rows = sourceRows.flatMap((sourceRow, index) => {
    const valuesForRow = headers.map((_header, column) => String(sourceRow?.[column] ?? ""));
    if (!valuesForRow.some((cell) => clean(cell))) return [];
    return [{ rowNumber: index + 2, values: valuesForRow }];
  });

  const variants = rows.map(({ rowNumber, values: row }) => {
    const [sourceName, title, description, rawRank] = row.map(clean);
    if (!sourceName || !description || !rawRank) {
      throw new Error(`invalid narrative row ${rowNumber}: required field is empty`);
    }
    const matches = gearByName.get(normalizeName(sourceName)) ?? [];
    if (matches.length !== 1) {
      throw new Error(`${matches.length ? "ambiguous" : "unknown"} gear name at row ${rowNumber}: ${sourceName}`);
    }
    const rank = Number(rawRank);
    if (!Number.isSafeInteger(rank) || rank < 0) {
      throw new Error(`invalid narrative row ${rowNumber}: rank must be a non-negative integer`);
    }
    const gearId = clean(matches[0]?.id);
    if (!gearId) throw new Error(`invalid gear id at row ${rowNumber}: ${sourceName}`);
    return {
      variantId: stableVariantId([gearId, title, description, String(rank)]),
      gearId,
      sourceName,
      title,
      description,
      rank
    };
  });

  if (new Set(variants.map((row) => row.variantId)).size !== variants.length) {
    throw new Error("duplicate narrative variantId");
  }

  return {
    snapshot: {
      schemaVersion: 1,
      spreadsheetId: clean(spreadsheetId),
      sheetTitle: NARRATIVE_SHEET_DEFINITION.sheetTitle,
      range: NARRATIVE_SHEET_DEFINITION.range,
      importedAt: clean(importedAt),
      headers,
      rowCount: rows.length,
      rows
    },
    catalog: {
      schemaVersion: 1,
      source: {
        spreadsheetId: clean(spreadsheetId),
        sheetTitle: NARRATIVE_SHEET_DEFINITION.sheetTitle
      },
      variants
    }
  };
}
