import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";

import { renderMagicItemsModule } from "./adapters/magic-items.mjs";
import { GENERATED_CATALOG_PATHS } from "./pipeline.mjs";

function catalogId(catalog, entry) {
  switch (catalog) {
    case "gear": return entry?.id;
    case "upgrades": return entry?.productId;
    case "materials": return entry?.id;
    case "implants": return entry?.id;
    case "transport": return entry?.sourceId;
    case "magicItems": return entry?.id;
    default: return "";
  }
}

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertSafeValue(value, path = "bundle") {
  if (value === undefined) throw new TypeError(`Unsupported undefined value at ${path}`);
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`Numeric value at ${path} must be finite`);
  }
  if (typeof value === "string" && (/^[A-Za-z]:[\\/]/u.test(value) || /^\\\\/u.test(value) || /^\/(?:Users|home|root|tmp)\//u.test(value))) {
    throw new TypeError(`Generated data contains an absolute path at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSafeValue(child, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) assertSafeValue(child, `${path}.${key}`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort(compareText).map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalCatalog(catalog, records) {
  if (!Array.isArray(records)) throw new TypeError(`Catalog ${catalog} must be an array`);
  return [...records]
    .sort((left, right) => compareText(catalogId(catalog, left), catalogId(catalog, right)))
    .map(canonicalize);
}

function filesMap(filesByPath) {
  return filesByPath instanceof Map ? filesByPath : new Map(Object.entries(filesByPath ?? {}));
}

function parseMagicItemsModule(source) {
  const text = String(source ?? "");
  const assignment = text.match(/export\s+const\s+MAGIC_ITEMS\s*=\s*/u);
  if (!assignment) throw new SyntaxError("magicItem.js does not export MAGIC_ITEMS");
  const expression = text.slice(assignment.index + assignment[0].length).replace(/;\s*$/u, "").trim();
  if (!expression.startsWith("[") || !expression.endsWith("]")) {
    throw new SyntaxError("magicItem.js MAGIC_ITEMS export must be a single array literal");
  }
  const parsed = runInNewContext(`(${expression})`, Object.create(null), {
    timeout: 2_000,
    contextCodeGeneration: { strings: false, wasm: false }
  });
  if (!Array.isArray(parsed)) throw new TypeError("magicItem.js MAGIC_ITEMS must be an array");
  return structuredClone(parsed);
}

export function serializeEquipmentBundle(bundle) {
  assertSafeValue(bundle);
  const rendered = new Map();
  for (const [catalog, relativePath] of Object.entries(GENERATED_CATALOG_PATHS)) {
    const records = canonicalCatalog(catalog, bundle?.catalogs?.[catalog]);
    const content = catalog === "magicItems"
      ? renderMagicItemsModule(records)
      : `${JSON.stringify(records, null, 2)}\n`;
    rendered.set(relativePath, content);
  }
  return new Map([...rendered].sort(([left], [right]) => compareText(left, right)));
}

export function parseCurrentEquipmentBundle({ filesByPath }) {
  const files = filesMap(filesByPath);
  const catalogs = {};
  const fingerprint = createHash("sha256");
  for (const [catalog, relativePath] of Object.entries(GENERATED_CATALOG_PATHS)) {
    if (!files.has(relativePath)) throw new Error(`Missing generated catalog file ${relativePath}`);
    const source = String(files.get(relativePath));
    fingerprint.update(relativePath, "utf8").update("\0", "utf8").update(source, "utf8").update("\0", "utf8");
    const records = catalog === "magicItems" ? parseMagicItemsModule(source) : JSON.parse(source);
    if (!Array.isArray(records)) throw new TypeError(`Generated catalog ${relativePath} must contain an array`);
    assertSafeValue(records, catalog);
    catalogs[catalog] = canonicalCatalog(catalog, records);
  }
  return {
    schemaVersion: 1,
    source: {
      spreadsheetId: "current-generated-files",
      fingerprint: fingerprint.digest("hex")
    },
    catalogs,
    diagnostics: []
  };
}
