import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createGoogleSheetsClient,
  loadGoogleServiceAccount
} from "./equipment-import/google-sheets-client.mjs";
import {
  EQUIPMENT_SPREADSHEET_ID,
  SHEET_REGISTRY
} from "./equipment-import/sheet-registry.mjs";
import { buildRawWorkbookSnapshot } from "./equipment-import/snapshot.mjs";
import { validateEquipmentOverrides } from "./equipment-import/overrides.mjs";
import { buildEquipmentBundle, GENERATED_CATALOG_PATHS } from "./equipment-import/pipeline.mjs";
import {
  EquipmentDiffGuardError,
  diffEquipmentBundles,
  evaluateDestructiveGuards,
  formatEquipmentDiffReport
} from "./equipment-import/diff.mjs";
import {
  parseCurrentEquipmentBundle,
  serializeEquipmentBundle
} from "./equipment-import/serialization.mjs";
import {
  applyGeneratedFilesTransaction,
  recoverInterruptedEquipmentTransaction
} from "./equipment-import/transactional-writer.mjs";
import { ImportDiagnosticError } from "./equipment-import/validation.mjs";

const USAGE = `Usage: node tools/import-equipment.mjs [options]

Options:
  --apply                 write the validated bundle; default is dry-run
  --allow-removals        permit non-catastrophic removals
  --allow-large-diff      permit a catalog loss exceeding 25 records or 10%
  --credentials <path>    service-account JSON; defaults to env or ignored tools file
  --spreadsheet-id <id>   defaults to the approved primary spreadsheet
  --snapshot <path>       read a local raw snapshot instead of Google (test/debug only)
  --write-snapshot <path> save fetched raw string snapshot for debugging
  --help                  print usage
`;

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

function parseArguments(argv) {
  const options = {
    apply: false,
    allowRemovals: false,
    allowLargeDiff: false,
    credentials: null,
    spreadsheetId: EQUIPMENT_SPREADSHEET_ID,
    snapshot: null,
    writeSnapshot: null,
    help: false
  };
  const valueFlags = new Map([
    ["--credentials", "credentials"],
    ["--spreadsheet-id", "spreadsheetId"],
    ["--snapshot", "snapshot"],
    ["--write-snapshot", "writeSnapshot"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--allow-removals") options.allowRemovals = true;
    else if (argument === "--allow-large-diff") options.allowLargeDiff = true;
    else if (argument === "--help") options.help = true;
    else if (valueFlags.has(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new UsageError(`${argument} requires a value`);
      options[valueFlags.get(argument)] = value;
    } else {
      throw new UsageError(`Unknown option: ${argument}`);
    }
  }
  if (options.allowLargeDiff && !options.allowRemovals) {
    throw new UsageError("--allow-large-diff requires --allow-removals");
  }
  if (options.snapshot && options.writeSnapshot) {
    throw new UsageError("--snapshot and --write-snapshot cannot be used together");
  }
  return options;
}

function assertSnapshotContainsNoSecrets(value, pathLabel = "snapshot") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSnapshotContainsNoSecrets(child, `${pathLabel}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:private_key|private_key_id|client_email|access_token|refresh_token|assertion)$/iu.test(key)) {
      throw new Error(`Snapshot contains forbidden credential field at ${pathLabel}.${key}`);
    }
    assertSnapshotContainsNoSecrets(child, `${pathLabel}.${key}`);
  }
}

async function loadSnapshotFile(snapshotPath, cwd) {
  const source = await fs.readFile(path.resolve(cwd, snapshotPath), "utf8");
  const snapshot = JSON.parse(source);
  assertSnapshotContainsNoSecrets(snapshot);
  return snapshot;
}

function requestedRanges() {
  const result = [];
  for (const declaration of Object.values(SHEET_REGISTRY)) {
    result.push(`'${declaration.sheetTitle.replaceAll("'", "''")}'!${declaration.range}`);
    for (const mirror of declaration.legacyMirrors ?? []) {
      result.push(`'${mirror.sheetTitle.replaceAll("'", "''")}'!${mirror.range}`);
    }
  }
  return result;
}

async function fetchWorkbookSnapshot({ options, cwd, env }) {
  const serviceAccount = await loadGoogleServiceAccount({
    credentialsPath: options.credentials ? path.resolve(cwd, options.credentials) : null,
    env,
    cwd
  });
  const client = createGoogleSheetsClient();
  const metadata = await client.fetchSpreadsheetMetadata({
    spreadsheetId: options.spreadsheetId,
    serviceAccount
  });
  const ranges = requestedRanges();
  const fetched = await client.fetchRanges({
    spreadsheetId: options.spreadsheetId,
    ranges,
    serviceAccount
  });
  const valueRanges = fetched.map((entry, index) => ({
    range: ranges[index],
    values: entry.values
  }));
  return buildRawWorkbookSnapshot({
    spreadsheetId: options.spreadsheetId,
    metadata,
    valueRanges,
    registry: SHEET_REGISTRY
  });
}

async function loadOverrides(cwd) {
  const source = await fs.readFile(path.join(cwd, "data", "equipment-import-overrides.json"), "utf8");
  return validateEquipmentOverrides(JSON.parse(source));
}

async function loadCurrentFiles(cwd) {
  const files = new Map();
  for (const relativePath of Object.values(GENERATED_CATALOG_PATHS)) {
    files.set(relativePath, await fs.readFile(path.join(cwd, relativePath), "utf8"));
  }
  return files;
}

function sourceSummary(workbookSnapshot, bundle) {
  return {
    spreadsheetId: workbookSnapshot.spreadsheetId,
    fingerprint: workbookSnapshot.fingerprint,
    catalogs: Object.fromEntries(
      Object.entries(bundle.catalogs).map(([catalog, records]) => [catalog, { rows: records.length }])
    )
  };
}

function printSourceSummary(stdout, workbookSnapshot) {
  stdout.write(`spreadsheet: ${workbookSnapshot.spreadsheetId}\n`);
  stdout.write(`fingerprint: ${workbookSnapshot.fingerprint}\n`);
  for (const [sheetKey, sheet] of Object.entries(workbookSnapshot.sheets ?? {}).sort(([left], [right]) => left < right ? -1 : 1)) {
    stdout.write(`sheet ${sheetKey}: ${sheet.sheetTitle ?? ""} ${sheet.range ?? ""}\n`);
  }
  stdout.write("warnings: 0, errors: 0\n");
}

function conciseError(error) {
  if (error instanceof ImportDiagnosticError) {
    const lines = error.diagnostics.slice(0, 10).map((entry) => {
      const coordinate = [entry.sheetKey, entry.rowNumber ? `row ${entry.rowNumber}` : "", entry.column ?? ""]
        .filter(Boolean).join("/");
      return `${entry.code}${coordinate ? ` (${coordinate})` : ""}: ${entry.message}`;
    });
    if (error.suppressedCount) lines.push(`${error.suppressedCount} additional diagnostics suppressed`);
    return lines.join("\n");
  }
  if (error instanceof EquipmentDiffGuardError) {
    return error.blockers.map((blocker) => `${blocker.code} (${blocker.catalog}): ${blocker.message}`).join("\n");
  }
  return String(error?.message ?? error);
}

export async function runEquipmentImporterCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    stderr.write(`Usage error: ${conciseError(error)}\n`);
    return 2;
  }
  if (options.help) {
    stdout.write(USAGE);
    return 0;
  }

  try {
    const recovered = await recoverInterruptedEquipmentTransaction({ tempRoot: cwd });
    if (recovered.recovered) stderr.write(`Warning: recovered interrupted equipment transaction (${recovered.files.length} files).\n`);
  } catch (error) {
    stderr.write(`Transaction recovery failed: ${conciseError(error)}\n`);
    return 6;
  }

  let overrides;
  try {
    overrides = await loadOverrides(cwd);
  } catch (error) {
    stderr.write(`Validation failed: ${conciseError(error)}\n`);
    return 4;
  }

  let workbookSnapshot;
  try {
    const selectedSnapshot = options.snapshot || env.REBREYA_EQUIPMENT_SNAPSHOT || null;
    workbookSnapshot = selectedSnapshot
      ? await loadSnapshotFile(selectedSnapshot, cwd)
      : await fetchWorkbookSnapshot({ options, cwd, env });
    if (options.writeSnapshot) {
      const target = path.resolve(cwd, options.writeSnapshot);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, `${JSON.stringify({ ...workbookSnapshot, fetchedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    }
  } catch (error) {
    stderr.write(`Source failed: ${conciseError(error)}\n`);
    return 3;
  }

  let nextBundle;
  let currentBundle;
  try {
    nextBundle = buildEquipmentBundle({ workbookSnapshot, overrides });
    currentBundle = parseCurrentEquipmentBundle({ filesByPath: await loadCurrentFiles(cwd) });
  } catch (error) {
    stderr.write(`Validation failed: ${conciseError(error)}\n`);
    return 4;
  }

  const diff = diffEquipmentBundles({ currentBundle, nextBundle });
  const summary = sourceSummary(workbookSnapshot, nextBundle);
  printSourceSummary(stdout, workbookSnapshot);
  stdout.write(formatEquipmentDiffReport({
    diff,
    sourceSummary: summary,
    mode: options.apply ? "apply" : "dry-run"
  }));
  try {
    evaluateDestructiveGuards({
      diff,
      flags: { allowRemovals: options.allowRemovals, allowLargeDiff: options.allowLargeDiff },
      sourceSummary: summary
    });
  } catch (error) {
    stderr.write(`Destructive guard failed: ${conciseError(error)}\n`);
    return 5;
  }

  if (!options.apply) {
    stdout.write("DRY-RUN: no files written.\n");
    return 0;
  }

  try {
    const filesByPath = serializeEquipmentBundle(nextBundle);
    await applyGeneratedFilesTransaction({ filesByPath, tempRoot: cwd });
    parseCurrentEquipmentBundle({ filesByPath: await loadCurrentFiles(cwd) });
    stdout.write("APPLIED: all generated catalogs verified.\n");
    return 0;
  } catch (error) {
    stderr.write(`Transactional write failed: ${conciseError(error)}\n`);
    return 6;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  process.exitCode = await runEquipmentImporterCli();
}
