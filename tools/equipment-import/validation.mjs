const DIAGNOSTIC_LIMIT = 100;

function compareNullableNumber(left, right) {
  const a = Number.isFinite(left) ? left : Number.MAX_SAFE_INTEGER;
  const b = Number.isFinite(right) ? right : Number.MAX_SAFE_INTEGER;
  return a - b;
}

export function sortImportDiagnostics(diagnostics = []) {
  return [...diagnostics].sort((left, right) => (
    compareNullableNumber(left.registryOrder, right.registryOrder)
    || String(left.sheetKey ?? "").localeCompare(String(right.sheetKey ?? ""), "ru")
    || compareNullableNumber(left.rowNumber, right.rowNumber)
    || compareNullableNumber(left.columnIndex, right.columnIndex)
    || String(left.column ?? "").localeCompare(String(right.column ?? ""), "ru")
    || String(left.code ?? "").localeCompare(String(right.code ?? ""), "en")
  ));
}

export class ImportDiagnosticError extends Error {
  constructor(message, diagnostics = []) {
    const sorted = sortImportDiagnostics(diagnostics);
    const visible = sorted.slice(0, DIAGNOSTIC_LIMIT);
    const suppressedCount = Math.max(0, sorted.length - visible.length);
    super(suppressedCount > 0 ? `${message} (${suppressedCount} more diagnostics suppressed)` : message);
    this.name = "ImportDiagnosticError";
    this.diagnostics = visible;
    this.suppressedCount = suppressedCount;
  }
}

export function throwIfDiagnostics(diagnostics, message = "Equipment import validation failed") {
  if (diagnostics?.length) {
    throw new ImportDiagnosticError(message, diagnostics);
  }
}

export function createImportDiagnostic({
  code,
  sheetKey = null,
  range = null,
  rowNumber = null,
  column = null,
  columnIndex = null,
  value = null,
  message,
  registryOrder = null
}) {
  return {
    code,
    sheetKey,
    range,
    rowNumber,
    column,
    columnIndex,
    value,
    message,
    registryOrder
  };
}
