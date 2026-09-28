import {
  ImportDiagnosticError,
  createImportDiagnostic
} from "./validation.mjs";

export const MAGIC_ITEM_DESCRIPTION_TABLE_SCHEMA_VERSION = 1;

const SUPPORTED_LAYOUTS = new Set(["spaced-lines", "key-plus-spaced", "paired-lines"]);
const DND_SU_ITEM_URL = /^https:\/\/(?:www\.)?dnd\.su\/items\/[^\s]+\/$/u;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function contractError(message) {
  throw new Error(`Invalid magic item description table contract: ${message}`);
}

function normalizeHeader(value, stableId, tableIndex) {
  if (!Array.isArray(value) || value.length < 2) {
    contractError(`${stableId} table ${tableIndex + 1} header must contain at least two cells`);
  }
  const header = value.map((cell) => String(cell ?? "").trim());
  if (header.some((cell) => !cell)) {
    contractError(`${stableId} table ${tableIndex + 1} header cells must be non-empty`);
  }
  return header;
}

export function validateMagicItemDescriptionTableContracts(rawContracts) {
  if (!isPlainObject(rawContracts)) contractError("root must be an object");
  if (rawContracts.schemaVersion !== MAGIC_ITEM_DESCRIPTION_TABLE_SCHEMA_VERSION) {
    contractError(`schemaVersion must be ${MAGIC_ITEM_DESCRIPTION_TABLE_SCHEMA_VERSION}`);
  }
  if (!isPlainObject(rawContracts.items)) contractError("items must be an object");

  const items = {};
  for (const stableId of Object.keys(rawContracts.items).sort()) {
    const rawItem = rawContracts.items[stableId];
    if (!isPlainObject(rawItem)) contractError(`${stableId} must be an object`);
    const sourceUrl = String(rawItem.sourceUrl ?? "").trim();
    if (!DND_SU_ITEM_URL.test(sourceUrl)) contractError(`${stableId} sourceUrl must be an https dnd.su item URL`);
    if (!Array.isArray(rawItem.tables) || !rawItem.tables.length) {
      contractError(`${stableId} tables must be a non-empty array`);
    }

    items[stableId] = {
      sourceUrl,
      tables: rawItem.tables.map((rawTable, tableIndex) => {
        if (!isPlainObject(rawTable)) contractError(`${stableId} table ${tableIndex + 1} must be an object`);
        const header = normalizeHeader(rawTable.header, stableId, tableIndex);
        const rowCount = Number(rawTable.rowCount);
        const layout = String(rawTable.layout ?? "").trim();
        if (!Number.isInteger(rowCount) || rowCount < 1) {
          contractError(`${stableId} table ${tableIndex + 1} rowCount must be a positive integer`);
        }
        if (!SUPPORTED_LAYOUTS.has(layout)) {
          contractError(`${stableId} table ${tableIndex + 1} layout ${layout || "<empty>"} is unsupported`);
        }
        if (layout === "paired-lines" && header.length !== 2) {
          contractError(`${stableId} table ${tableIndex + 1} paired-lines layout requires exactly two columns`);
        }
        return { header, rowCount, layout };
      })
    };
  }

  return deepFreeze({
    schemaVersion: MAGIC_ITEM_DESCRIPTION_TABLE_SCHEMA_VERSION,
    items
  });
}

function splitLegacyCells(value) {
  return String(value ?? "").trim().split(/\s{2,}/u).map((cell) => cell.trim()).filter(Boolean);
}

function splitMarkdownCells(value) {
  const text = String(value ?? "").trim();
  if (!text.startsWith("|") || !text.endsWith("|")) return null;
  const cells = [];
  let cell = "";
  let escaped = false;
  for (const character of text.slice(1, -1)) {
    if (escaped) {
      cell += character;
      escaped = false;
    }
    else if (character === "\\") {
      escaped = true;
    }
    else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    }
    else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function sameCells(left, right) {
  return left?.length === right.length && left.every((cell, index) => cell === right[index]);
}

function isMarkdownDivider(value, columnCount) {
  const cells = splitMarkdownCells(value);
  return cells?.length === columnCount && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function escapeMarkdownCell(value) {
  return String(value ?? "").replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|").trim();
}

function renderMarkdownTable(header, rows) {
  const row = (cells) => `| ${cells.map(escapeMarkdownCell).join(" | ")} |`;
  return [
    row(header),
    row(header.map(() => "---")),
    ...rows.map(row)
  ];
}

function structureFailure({ stableId, itemName, tableIndex, contract, context, diagnostics, reason }) {
  const diagnostic = createImportDiagnostic({
    code: "magic-item-description-table-structure",
    ...context,
    value: stableId,
    message: `Magic item ${itemName || stableId} table ${tableIndex + 1} (${contract.header.join(" | ")}) ${reason}`
  });
  diagnostics.push(diagnostic);
  throw new ImportDiagnosticError("Magic item description table validation failed", [diagnostic]);
}

function findHeader(lines, header, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (sameCells(splitLegacyCells(lines[index]), header) || sameCells(splitMarkdownCells(lines[index]), header)) {
      return index;
    }
  }
  return -1;
}

function readCanonicalMarkdownTable(lines, headerIndex, contract) {
  if (!sameCells(splitMarkdownCells(lines[headerIndex]), contract.header)) return null;
  if (!isMarkdownDivider(lines[headerIndex + 1], contract.header.length)) return null;
  const rows = [];
  for (let offset = 0; offset < contract.rowCount; offset += 1) {
    const cells = splitMarkdownCells(lines[headerIndex + 2 + offset]);
    if (!cells || cells.length !== contract.header.length) return null;
    rows.push(cells);
  }
  return { rows, endIndex: headerIndex + 2 + contract.rowCount };
}

function readLegacyTable(lines, headerIndex, contract) {
  const rows = [];
  let index = headerIndex + 1;
  for (let rowIndex = 0; rowIndex < contract.rowCount; rowIndex += 1) {
    if (contract.layout === "spaced-lines") {
      const cells = splitLegacyCells(lines[index]);
      if (cells.length !== contract.header.length) return null;
      rows.push(cells);
      index += 1;
      continue;
    }

    if (contract.layout === "key-plus-spaced") {
      const key = String(lines[index] ?? "").trim();
      const remainder = splitLegacyCells(lines[index + 1]);
      if (!key || remainder.length !== contract.header.length - 1) return null;
      rows.push([key, ...remainder]);
      index += 2;
      continue;
    }

    const left = String(lines[index] ?? "").trim();
    const right = String(lines[index + 1] ?? "").trim();
    if (!left || !right) return null;
    rows.push([left, right]);
    index += 2;
  }
  return { rows, endIndex: index };
}

export function normalizeMagicItemDescriptionTables({
  stableId,
  itemName,
  description,
  contracts,
  context = {},
  diagnostics = []
}) {
  const itemContract = contracts?.items?.[stableId];
  const sourceDescription = String(description ?? "");
  if (!itemContract) return sourceDescription;
  const normalizedDescription = sourceDescription.replace(/\r\n?/gu, "\n");

  const lines = normalizedDescription.split("\n");
  let searchIndex = 0;
  for (let tableIndex = 0; tableIndex < itemContract.tables.length; tableIndex += 1) {
    const contract = itemContract.tables[tableIndex];
    const headerIndex = findHeader(lines, contract.header, searchIndex);
    if (headerIndex < 0) {
      structureFailure({
        stableId, itemName, tableIndex, contract, context, diagnostics,
        reason: "header is missing or flattened"
      });
    }

    const parsed = readCanonicalMarkdownTable(lines, headerIndex, contract)
      ?? readLegacyTable(lines, headerIndex, contract);
    if (!parsed) {
      structureFailure({
        stableId, itemName, tableIndex, contract, context, diagnostics,
        reason: `does not contain ${contract.rowCount} rows with ${contract.header.length} columns`
      });
    }

    const markdownLines = renderMarkdownTable(contract.header, parsed.rows);
    lines.splice(headerIndex, parsed.endIndex - headerIndex, ...markdownLines);
    searchIndex = headerIndex + markdownLines.length;
  }

  return lines.join("\n");
}
