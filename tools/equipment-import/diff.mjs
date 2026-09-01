const CATALOG_ORDER = Object.freeze([
  "gear",
  "upgrades",
  "materials",
  "implants",
  "transport",
  "magicItems"
]);

function stableId(catalog, entry) {
  switch (catalog) {
    case "gear": return entry?.id;
    case "upgrades": return entry?.productId;
    case "materials": return entry?.id;
    case "implants": return entry?.id;
    case "transport": return entry?.sourceId;
    case "magicItems": return entry?.id;
    default: return null;
  }
}

function displayName(entry) {
  return String(entry?.name ?? entry?.canonicalName ?? "").trim();
}

function sourceIdentity(catalog, entry) {
  switch (catalog) {
    case "gear": return String(entry?.sourceIdentity ?? entry?.sourceRef ?? "").trim();
    case "upgrades": return entry?.upgrade?.sourceSheet && entry?.upgrade?.sourceSheetRow
      ? `${entry.upgrade.sourceSheet}!${entry.upgrade.sourceSheetRow}`
      : "";
    case "materials": return displayName(entry)
      ? `material:${displayName(entry).toLocaleLowerCase("ru-RU")}`
      : "";
    case "implants": return entry?.implant?.sourceSheet && entry?.implant?.sourceSheetRow
      ? `${entry.implant.sourceSheet}!${entry.implant.sourceSheetRow}`
      : "";
    case "transport": return entry?.sourceRow ? `transport!${entry.sourceRow}` : "";
    case "magicItems": return entry?.sourceNumber ? `magicItems!${entry.sourceNumber}` : "";
    default: return "";
  }
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), "ru");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function changedFieldPaths(previous, next, prefix = "") {
  if (Object.is(previous, next)) return [];
  if (Array.isArray(previous) && Array.isArray(next)) {
    if (JSON.stringify(previous) === JSON.stringify(next)) return [];
    return [prefix];
  }
  if (!isObject(previous) || !isObject(next)) return [prefix];
  const paths = [];
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort(compareText);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(...changedFieldPaths(previous[key], next[key], path));
  }
  return paths;
}

function summary(catalog, entry) {
  return {
    id: String(stableId(catalog, entry) ?? "").trim(),
    name: displayName(entry),
    sourceIdentity: sourceIdentity(catalog, entry)
  };
}

function indexBy(records, keyOf) {
  const result = new Map();
  for (const entry of records) {
    const key = String(keyOf(entry) ?? "").trim();
    if (key) result.set(key, entry);
  }
  return result;
}

function diffCatalog(catalog, currentRecords, nextRecords) {
  const currentById = indexBy(currentRecords, (entry) => stableId(catalog, entry));
  const nextById = indexBy(nextRecords, (entry) => stableId(catalog, entry));
  const currentBySource = indexBy(currentRecords, (entry) => sourceIdentity(catalog, entry));
  const nextBySource = indexBy(nextRecords, (entry) => sourceIdentity(catalog, entry));
  const identityChurn = [];
  const churnPreviousIds = new Set();
  const churnNextIds = new Set();

  for (const source of [...currentBySource.keys()].sort(compareText)) {
    const previous = currentBySource.get(source);
    const next = nextBySource.get(source);
    if (!next) continue;
    const previousId = String(stableId(catalog, previous) ?? "").trim();
    const nextId = String(stableId(catalog, next) ?? "").trim();
    if (!previousId || !nextId || previousId === nextId) continue;
    identityChurn.push({
      sourceIdentity: source,
      previousId,
      nextId,
      name: displayName(next) || displayName(previous)
    });
    churnPreviousIds.add(previousId);
    churnNextIds.add(nextId);
  }

  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];
  for (const id of [...nextById.keys()].sort(compareText)) {
    const next = nextById.get(id);
    const previous = currentById.get(id);
    if (!previous) {
      if (!churnNextIds.has(id)) added.push(summary(catalog, next));
      continue;
    }
    const fields = changedFieldPaths(previous, next).filter(Boolean).sort(compareText);
    if (fields.length) changed.push({ ...summary(catalog, next), fields });
    else unchanged.push(summary(catalog, next));
  }
  for (const id of [...currentById.keys()].sort(compareText)) {
    if (nextById.has(id) || churnPreviousIds.has(id)) continue;
    removed.push(summary(catalog, currentById.get(id)));
  }

  return {
    previousCount: currentRecords.length,
    nextCount: nextRecords.length,
    added,
    changed,
    unchanged,
    removed,
    identityChurn
  };
}

export function diffEquipmentBundles({ currentBundle, nextBundle }) {
  const catalogs = {};
  for (const catalog of CATALOG_ORDER) {
    catalogs[catalog] = diffCatalog(
      catalog,
      Array.isArray(currentBundle?.catalogs?.[catalog]) ? currentBundle.catalogs[catalog] : [],
      Array.isArray(nextBundle?.catalogs?.[catalog]) ? nextBundle.catalogs[catalog] : []
    );
  }
  return Object.freeze({ catalogs: Object.freeze(catalogs) });
}

export class EquipmentDiffGuardError extends Error {
  constructor(blockers) {
    super(`Equipment import blocked by ${blockers.length} destructive change guard${blockers.length === 1 ? "" : "s"}`);
    this.name = "EquipmentDiffGuardError";
    this.blockers = blockers;
  }
}

function sourceRowCount(sourceSummary, catalog) {
  const source = sourceSummary?.catalogs?.[catalog];
  const candidate = source?.rows ?? source?.rowCount ?? source?.count;
  return Number.isFinite(Number(candidate)) ? Number(candidate) : null;
}

export function evaluateDestructiveGuards({ diff, flags = {}, sourceSummary = {} }) {
  const blockers = [];
  for (const catalog of CATALOG_ORDER) {
    const catalogDiff = diff?.catalogs?.[catalog] ?? {
      previousCount: 0,
      nextCount: 0,
      removed: [],
      identityChurn: []
    };
    const previousCount = Number(catalogDiff.previousCount) || 0;
    const nextCount = Number(catalogDiff.nextCount) || 0;
    const removedCount = catalogDiff.removed?.length ?? 0;
    const removalRate = previousCount === 0 ? 0 : removedCount / previousCount;
    const isLargeRemoval = removedCount > 25 || removalRate > 0.10;
    const isCatastrophic = nextCount === 0 || removalRate > 0.50;
    const sourceRows = sourceRowCount(sourceSummary, catalog);

    if ((catalogDiff.identityChurn?.length ?? 0) > 0) {
      blockers.push({
        code: "identity-churn",
        catalog,
        count: catalogDiff.identityChurn.length,
        message: `${catalog} changes stable IDs for existing source identities`
      });
    }
    if (sourceRows === 0) {
      blockers.push({
        code: "empty-source-catalog",
        catalog,
        count: 0,
        message: `${catalog} source unexpectedly contains no rows`
      });
    }
    if (isCatastrophic) {
      blockers.push({
        code: "catastrophic-removal",
        catalog,
        count: removedCount,
        removalRate,
        message: `${catalog} would become empty or lose more than half its records`
      });
      continue;
    }
    if (removedCount > 0 && flags.allowRemovals !== true) {
      blockers.push({
        code: "removals-not-allowed",
        catalog,
        count: removedCount,
        removalRate,
        message: `${catalog} removals require --allow-removals`
      });
    }
    if (removedCount > 0 && isLargeRemoval && flags.allowLargeDiff !== true) {
      blockers.push({
        code: "large-removal",
        catalog,
        count: removedCount,
        removalRate,
        message: `${catalog} large removal requires --allow-large-diff`
      });
    }
  }
  if (blockers.length) throw new EquipmentDiffGuardError(blockers);
  return { allowed: true, blockers: [] };
}

export function formatEquipmentDiffReport({ diff, sourceSummary = {}, mode = "dry-run" }) {
  const lines = [`Equipment import ${mode}`];
  const spreadsheetId = String(sourceSummary?.spreadsheetId ?? "").trim();
  if (spreadsheetId) lines.push(`Source: ${spreadsheetId}`);
  for (const catalog of CATALOG_ORDER) {
    const value = diff?.catalogs?.[catalog] ?? {
      added: [], changed: [], unchanged: [], removed: [], identityChurn: []
    };
    lines.push(
      `${catalog}: +${value.added.length} ~${value.changed.length} =${value.unchanged.length} -${value.removed.length} churn:${value.identityChurn.length}`
    );
    for (const entry of value.changed) lines.push(`  ~ ${entry.id} [${entry.fields.join(", ")}]`);
    for (const entry of value.removed) lines.push(`  - ${entry.id} (${entry.name})`);
    for (const entry of value.identityChurn) {
      lines.push(`  ! ${entry.sourceIdentity}: ${entry.previousId} -> ${entry.nextId}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
