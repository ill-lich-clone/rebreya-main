import { createHash } from "node:crypto";

import {
  createImportDiagnostic,
  throwIfDiagnostics
} from "./validation.mjs";

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function parseRangeStart(range) {
  const coordinates = String(range).split("!").at(-1);
  const match = coordinates.match(/^\$?([A-Z]+)\$?(\d+)/i);
  if (!match) return { columnIndex: 0, rowNumber: 1 };
  let columnIndex = 0;
  for (const character of match[1].toUpperCase()) {
    columnIndex = (columnIndex * 26) + character.charCodeAt(0) - 64;
  }
  return { columnIndex: columnIndex - 1, rowNumber: Number(match[2]) };
}

function quoteSheetTitle(title) {
  return `'${String(title).replaceAll("'", "''")}'`;
}

function qualifyRange(title, range) {
  return `${quoteSheetTitle(title)}!${range}`;
}

function normalizeCell(value) {
  return value === null || value === undefined ? "" : value;
}

function normalizeMatrix(values = []) {
  return values.map((row) => (Array.isArray(row) ? row.map(normalizeCell) : []));
}

function hasNonEmptyValue(row) {
  return row.some((value) => value !== "");
}

function buildHeaders({ values, declaration, range, sheetKey, diagnostics }) {
  const rangeStart = parseRangeStart(range);
  const headerIndexes = declaration.headerRows.map((rowNumber) => rowNumber - rangeStart.rowNumber);
  const width = Math.max(0, ...values.map((row) => row.length));
  const headers = [];
  const seen = new Map();

  for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
    let header = "";
    for (const headerIndex of headerIndexes) {
      const candidate = normalizeCell(values[headerIndex]?.[columnIndex]);
      if (typeof candidate !== "string") {
        diagnostics.push(createImportDiagnostic({
          code: "non-string-cell",
          sheetKey,
          range,
          rowNumber: headerIndex + rangeStart.rowNumber,
          column: columnName(rangeStart.columnIndex + columnIndex),
          columnIndex,
          value: candidate,
          message: "Header cell must be a formatted string",
          registryOrder: declaration.registryOrder
        }));
        continue;
      }
      if (candidate.trim()) header = candidate.trim();
    }
    headers.push(header);
    if (!header) continue;
    if (seen.has(header)) {
      diagnostics.push(createImportDiagnostic({
        code: "duplicate-header",
        sheetKey,
        range,
        rowNumber: declaration.headerRows.at(-1) ?? rangeStart.rowNumber,
        column: header,
        columnIndex,
        value: header,
        message: `Duplicate header: ${header}`,
        registryOrder: declaration.registryOrder
      }));
    } else {
      seen.set(header, columnIndex);
    }
  }

  for (const required of declaration.requiredHeaders) {
    if (seen.has(required)) continue;
    diagnostics.push(createImportDiagnostic({
      code: "missing-header",
      sheetKey,
      range,
      rowNumber: declaration.headerRows.at(-1) ?? rangeStart.rowNumber,
      column: required,
      columnIndex: width,
      value: null,
      message: `Missing required header: ${required}`,
      registryOrder: declaration.registryOrder
    }));
  }

  return { headers, rangeStart };
}

export function validateHeaders({ sheetKey, headers, declaration, range = null }) {
  const diagnostics = [];
  const seen = new Set();
  for (let index = 0; index < headers.length; index += 1) {
    const header = String(headers[index] ?? "").trim();
    if (!header) continue;
    if (seen.has(header)) {
      diagnostics.push(createImportDiagnostic({
        code: "duplicate-header",
        sheetKey,
        range,
        rowNumber: declaration.headerRows?.at(-1) ?? null,
        column: header,
        columnIndex: index,
        value: header,
        message: `Duplicate header: ${header}`,
        registryOrder: declaration.registryOrder
      }));
    }
    seen.add(header);
  }
  for (const required of declaration.requiredHeaders ?? []) {
    if (!seen.has(required)) {
      diagnostics.push(createImportDiagnostic({
        code: "missing-header",
        sheetKey,
        range,
        rowNumber: declaration.headerRows?.at(-1) ?? null,
        column: required,
        columnIndex: headers.length,
        value: null,
        message: `Missing required header: ${required}`,
        registryOrder: declaration.registryOrder
      }));
    }
  }
  throwIfDiagnostics(diagnostics, `Invalid headers for ${sheetKey}`);
  return headers;
}

function buildRawLayoutSnapshot({ sheetKey, range, values, declaration }) {
  const diagnostics = [];
  const normalized = normalizeMatrix(values);
  const rangeStart = parseRangeStart(range);
  for (let rowIndex = 0; rowIndex < normalized.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < normalized[rowIndex].length; columnIndex += 1) {
      const value = normalized[rowIndex][columnIndex];
      if (typeof value === "string") continue;
      diagnostics.push(createImportDiagnostic({
        code: "non-string-cell",
        sheetKey,
        range,
        rowNumber: rangeStart.rowNumber + rowIndex,
        column: columnName(rangeStart.columnIndex + columnIndex),
        columnIndex,
        value,
        message: "Sheet cell must be a formatted string",
        registryOrder: declaration.registryOrder
      }));
    }
  }
  throwIfDiagnostics(diagnostics, `Invalid raw values for ${sheetKey}`);
  return {
    sheetKey,
    sheetTitle: declaration.sheetTitle,
    range,
    layout: "raw",
    values: normalized
  };
}

export function buildRawSheetSnapshot({ sheetKey, range, values = [], declaration }) {
  if (declaration.layout === "raw") {
    return buildRawLayoutSnapshot({ sheetKey, range, values, declaration });
  }

  const diagnostics = [];
  const normalized = normalizeMatrix(values);
  const { headers, rangeStart } = buildHeaders({
    values: normalized,
    declaration,
    range,
    sheetKey,
    diagnostics
  });
  const accepted = new Set([...declaration.requiredHeaders, ...declaration.optionalHeaders]);
  const firstDataIndex = declaration.dataStartRow - rangeStart.rowNumber;
  const rows = [];

  for (let rowIndex = Math.max(0, firstDataIndex); rowIndex < normalized.length; rowIndex += 1) {
    const sourceRow = normalized[rowIndex];
    const width = Math.max(headers.length, sourceRow.length);
    const padded = Array.from({ length: width }, (_, index) => normalizeCell(sourceRow[index]));
    if (!hasNonEmptyValue(padded)) continue;

    const cells = {};
    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      const value = padded[columnIndex];
      const header = headers[columnIndex] ?? "";
      const absoluteColumn = columnName(rangeStart.columnIndex + columnIndex);
      if (typeof value !== "string") {
        diagnostics.push(createImportDiagnostic({
          code: "non-string-cell",
          sheetKey,
          range,
          rowNumber: rangeStart.rowNumber + rowIndex,
          column: header || absoluteColumn,
          columnIndex,
          value,
          message: "Sheet cell must be a formatted string",
          registryOrder: declaration.registryOrder
        }));
        continue;
      }
      if (!header) {
        if (value !== "") {
          diagnostics.push(createImportDiagnostic({
            code: "unknown-populated-header",
            sheetKey,
            range,
            rowNumber: rangeStart.rowNumber + rowIndex,
            column: absoluteColumn,
            columnIndex,
            value,
            message: `Populated column ${absoluteColumn} has no recognized header`,
            registryOrder: declaration.registryOrder
          }));
        }
        continue;
      }
      if (!accepted.has(header)) {
        if (value !== "") {
          diagnostics.push(createImportDiagnostic({
            code: "unknown-populated-header",
            sheetKey,
            range,
            rowNumber: rangeStart.rowNumber + rowIndex,
            column: header,
            columnIndex,
            value,
            message: `Populated unknown header: ${header}`,
            registryOrder: declaration.registryOrder
          }));
        }
        continue;
      }
      cells[header] = value;
    }

    rows.push({
      rowNumber: rangeStart.rowNumber + rowIndex,
      sourceIdentity: declaration.stableKeyHeader ? (cells[declaration.stableKeyHeader] ?? "") : "",
      cells
    });
  }

  throwIfDiagnostics(diagnostics, `Invalid sheet snapshot: ${sheetKey}`);
  return {
    sheetKey,
    sheetTitle: declaration.sheetTitle,
    range,
    layout: "tabular",
    headers,
    rows
  };
}

function findMetadataSheet(metadata, title) {
  return metadata?.sheets?.find((sheet) => sheet?.properties?.title === title) ?? null;
}

function findValueRange(valueRanges, title, range) {
  const qualified = qualifyRange(title, range);
  return valueRanges.find((entry) => entry.range === qualified) ?? null;
}

function matricesEqual(left, right) {
  return JSON.stringify(normalizeMatrix(left)) === JSON.stringify(normalizeMatrix(right));
}

export function buildRawWorkbookSnapshot({ spreadsheetId, metadata, valueRanges = [], registry }) {
  const diagnostics = [];
  const sheets = {};
  const fingerprintSource = { spreadsheetId, sheets: [] };

  for (const [sheetKey, declaration] of Object.entries(registry)) {
    const metadataSheet = findMetadataSheet(metadata, declaration.sheetTitle);
    const valueRange = findValueRange(valueRanges, declaration.sheetTitle, declaration.range);
    if (!metadataSheet) {
      diagnostics.push(createImportDiagnostic({
        code: "missing-sheet",
        sheetKey,
        range: declaration.range,
        message: `Missing required sheet: ${declaration.sheetTitle}`,
        registryOrder: declaration.registryOrder
      }));
      continue;
    }
    if (!valueRange) {
      diagnostics.push(createImportDiagnostic({
        code: "missing-range",
        sheetKey,
        range: qualifyRange(declaration.sheetTitle, declaration.range),
        message: `Missing values for ${declaration.sheetTitle}`,
        registryOrder: declaration.registryOrder
      }));
      continue;
    }

    const snapshot = buildRawSheetSnapshot({
      sheetKey,
      range: valueRange.range,
      values: valueRange.values ?? [],
      declaration
    });
    const legacyMirrors = [];
    for (const mirror of declaration.legacyMirrors ?? []) {
      const mirrorMetadata = findMetadataSheet(metadata, mirror.sheetTitle);
      if (!mirrorMetadata) continue;
      const mirrorRange = findValueRange(valueRanges, mirror.sheetTitle, mirror.range);
      if (!mirrorRange) {
        diagnostics.push(createImportDiagnostic({
          code: "missing-mirror-range",
          sheetKey,
          range: qualifyRange(mirror.sheetTitle, mirror.range),
          message: `Missing values for legacy mirror ${mirror.sheetTitle}`,
          registryOrder: declaration.registryOrder
        }));
        continue;
      }
      const equivalent = matricesEqual(valueRange.values ?? [], mirrorRange.values ?? []);
      legacyMirrors.push({
        sheetId: mirrorMetadata.properties.sheetId,
        sheetTitle: mirror.sheetTitle,
        range: mirrorRange.range,
        equivalent
      });
      if (mirror.requireEquivalent && !equivalent) {
        diagnostics.push(createImportDiagnostic({
          code: "divergent-legacy-mirror",
          sheetKey,
          range: mirrorRange.range,
          message: `${mirror.sheetTitle} diverges from canonical ${declaration.sheetTitle}`,
          registryOrder: declaration.registryOrder
        }));
      }
    }

    sheets[sheetKey] = {
      ...snapshot,
      sheetId: metadataSheet.properties.sheetId,
      sheetIndex: metadataSheet.properties.index ?? null,
      hidden: metadataSheet.properties.hidden === true,
      legacyMirrors
    };
    fingerprintSource.sheets.push({
      sheetKey,
      sheetId: metadataSheet.properties.sheetId,
      sheetTitle: declaration.sheetTitle,
      range: valueRange.range,
      values: normalizeMatrix(valueRange.values ?? []),
      legacyMirrors
    });
  }

  throwIfDiagnostics(diagnostics, "Invalid equipment workbook snapshot");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(fingerprintSource), "utf8")
    .digest("hex");

  return {
    spreadsheetId,
    fingerprint,
    sheets
  };
}
