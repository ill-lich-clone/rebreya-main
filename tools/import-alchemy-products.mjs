import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createGoogleSheetsClient,
  loadGoogleServiceAccount
} from "./equipment-import/google-sheets-client.mjs";
import { adaptAlchemyCatalog, validateAlchemyCatalog } from "./alchemy-import/catalog.mjs";
import {
  AlchemyDiffGuardError,
  diffAlchemyCatalogs,
  evaluateAlchemyDiffGuards,
  formatAlchemyDiffReport
} from "./alchemy-import/diff.mjs";
import {
  ALCHEMY_CATALOG_PATH,
  serializeAlchemyCatalog,
  writeAlchemyCatalogAtomic
} from "./alchemy-import/serialization.mjs";
import {
  ALCHEMY_SHEET,
  ALCHEMY_SPREADSHEET_ID,
  buildAlchemySourceSnapshot
} from "./alchemy-import/source.mjs";

const USAGE = `Usage: node tools/import-alchemy-products.mjs [options]

Options:
  --apply                 write the validated catalog; default is dry-run
  --allow-removals        permit catalog removals
  --credentials <path>    service-account JSON; defaults to env or ignored tools file
  --spreadsheet-id <id>   defaults to the approved alchemy spreadsheet
  --snapshot <path>       read a local sanitized formatted-value snapshot
  --write-snapshot <path> save fetched formatted values for debugging
  --help                  print usage
`;

class UsageError extends Error {}

function parseArguments(argv) {
  const options = {
    apply: false,
    allowRemovals: false,
    credentials: null,
    spreadsheetId: ALCHEMY_SPREADSHEET_ID,
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
    else if (argument === "--help") options.help = true;
    else if (valueFlags.has(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new UsageError(`${argument} requires a value`);
      options[valueFlags.get(argument)] = value;
    } else {
      throw new UsageError(`Unknown option: ${argument}`);
    }
  }
  if (options.snapshot && options.writeSnapshot) {
    throw new UsageError("--snapshot and --write-snapshot cannot be used together");
  }
  return options;
}

function assertNoSecrets(value, label = "snapshot") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoSecrets(child, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:private_key|private_key_id|client_email|access_token|refresh_token|assertion)$/iu.test(key)) {
      throw new Error(`Snapshot contains forbidden credential field at ${label}.${key}`);
    }
    assertNoSecrets(child, `${label}.${key}`);
  }
}

function sanitizedMessage(error, secrets = []) {
  let message = String(error?.message ?? error ?? "unknown error");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret) message = message.replaceAll(secret, "[REDACTED]");
  }
  return message
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]");
}

function rawSnapshotPayload(snapshot) {
  const lastRowNumber = snapshot.rows.at(-1)?.rowNumber ?? (ALCHEMY_SHEET.dataStartRow - 1);
  const values = Array.from(
    { length: Math.max(0, lastRowNumber - ALCHEMY_SHEET.dataStartRow + 1) },
    () => []
  );
  for (const row of snapshot.rows) {
    values[row.rowNumber - ALCHEMY_SHEET.dataStartRow] = [...row.values];
  }
  return {
    spreadsheetId: snapshot.spreadsheetId,
    sheetId: snapshot.sheetId,
    sheetTitle: snapshot.sheetTitle,
    range: snapshot.range,
    values,
    fingerprint: snapshot.fingerprint
  };
}

function buildSnapshotFromPayload(payload) {
  assertNoSecrets(payload);
  if (payload?.sheetId !== ALCHEMY_SHEET.sheetId) throw new Error(`Unexpected alchemy sheet id: ${payload?.sheetId}`);
  if (payload?.sheetTitle !== ALCHEMY_SHEET.sheetTitle) throw new Error(`Unexpected alchemy sheet title: ${payload?.sheetTitle}`);
  if (payload?.range !== ALCHEMY_SHEET.range) throw new Error(`Unexpected alchemy range: ${payload?.range}`);
  return buildAlchemySourceSnapshot({
    spreadsheetId: payload?.spreadsheetId,
    metadata: { sheets: [{ properties: { sheetId: payload.sheetId, title: payload.sheetTitle } }] },
    values: payload?.values
  });
}

async function loadLocalSnapshot({ snapshotPath, cwd, fsImpl }) {
  const source = await fsImpl.readFile(path.resolve(cwd, snapshotPath), "utf8");
  return buildSnapshotFromPayload(JSON.parse(source));
}

async function fetchAlchemySnapshot({
  options,
  cwd,
  env,
  loadServiceAccount,
  createSheetsClient
}) {
  let serviceAccount;
  try {
    serviceAccount = await loadServiceAccount({
      credentialsPath: options.credentials ? path.resolve(cwd, options.credentials) : null,
      env,
      cwd
    });
    const client = createSheetsClient();
    const metadata = await client.fetchSpreadsheetMetadata({
      spreadsheetId: options.spreadsheetId,
      serviceAccount
    });
    const [result] = await client.fetchRanges({
      spreadsheetId: options.spreadsheetId,
      ranges: [ALCHEMY_SHEET.range],
      serviceAccount
    });
    return buildAlchemySourceSnapshot({
      spreadsheetId: options.spreadsheetId,
      metadata,
      values: result?.values ?? []
    });
  } catch (error) {
    const secrets = serviceAccount
      ? [serviceAccount.private_key, serviceAccount.private_key_id, serviceAccount.client_email]
      : [];
    throw new Error(sanitizedMessage(error, secrets));
  }
}

async function loadCurrentCatalog({ cwd, fsImpl }) {
  try {
    const source = await fsImpl.readFile(path.resolve(cwd, ...ALCHEMY_CATALOG_PATH.split("/")), "utf8");
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) throw new Error("Current alchemy catalog must be an array");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeDebugSnapshot({ cwd, relativePath, snapshot, fsImpl }) {
  const target = path.resolve(cwd, relativePath);
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  await fsImpl.writeFile(target, `${JSON.stringify(rawSnapshotPayload(snapshot), null, 2)}\n`, "utf8");
}

export async function runAlchemyImporterCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  fsImpl = fs,
  loadServiceAccount = loadGoogleServiceAccount,
  createSheetsClient = createGoogleSheetsClient
} = {}) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    stderr.write(`Usage error: ${sanitizedMessage(error)}\n`);
    return 2;
  }
  if (options.help) {
    stdout.write(USAGE);
    return 0;
  }

  let snapshot;
  try {
    snapshot = options.snapshot
      ? await loadLocalSnapshot({ snapshotPath: options.snapshot, cwd, fsImpl })
      : await fetchAlchemySnapshot({ options, cwd, env, loadServiceAccount, createSheetsClient });
    if (options.writeSnapshot) {
      await writeDebugSnapshot({ cwd, relativePath: options.writeSnapshot, snapshot, fsImpl });
    }
  } catch (error) {
    stderr.write(`Source failed: ${sanitizedMessage(error)}\n`);
    return 3;
  }

  let next;
  let current;
  let diff;
  try {
    next = adaptAlchemyCatalog(snapshot);
    current = await loadCurrentCatalog({ cwd, fsImpl });
    diff = diffAlchemyCatalogs({ current, next });
  } catch (error) {
    stderr.write(`Validation failed: ${sanitizedMessage(error)}\n`);
    return 4;
  }

  stdout.write(`spreadsheet: ${snapshot.spreadsheetId}\n`);
  stdout.write(`sheet: ${snapshot.sheetTitle} (${snapshot.sheetId}) ${snapshot.range}\n`);
  stdout.write(`fingerprint: ${snapshot.fingerprint}\n`);
  stdout.write(formatAlchemyDiffReport({ diff, mode: options.apply ? "apply" : "dry-run" }));
  try {
    evaluateAlchemyDiffGuards({ diff, allowRemovals: options.allowRemovals });
  } catch (error) {
    const prefix = error instanceof AlchemyDiffGuardError ? "Destructive guard failed" : "Validation failed";
    stderr.write(`${prefix}: ${sanitizedMessage(error)}\n`);
    return 5;
  }

  if (!options.apply) {
    stdout.write("DRY-RUN: no files written.\n");
    return 0;
  }

  try {
    const content = serializeAlchemyCatalog(next);
    await writeAlchemyCatalogAtomic({ cwd, content, fsImpl });
    const written = JSON.parse(await fsImpl.readFile(path.resolve(cwd, ...ALCHEMY_CATALOG_PATH.split("/")), "utf8"));
    validateAlchemyCatalog(written);
    if (serializeAlchemyCatalog(written) !== content) throw new Error("Written alchemy catalog bytes are not deterministic");
    stdout.write("APPLIED: alchemy catalog verified.\n");
    return 0;
  } catch (error) {
    stderr.write(`Write failed: ${sanitizedMessage(error)}\n`);
    return 6;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) process.exitCode = await runAlchemyImporterCli();
