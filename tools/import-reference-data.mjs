import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createGoogleSheetsClient,
  loadGoogleServiceAccount
} from "./equipment-import/google-sheets-client.mjs";
import { buildRawSheetSnapshot } from "./equipment-import/snapshot.mjs";
import { buildNarrativeArtifacts } from "./reference-import/narrative-pipeline.mjs";
import {
  NARRATIVE_SHEET_DEFINITION,
  REFERENCE_SPREADSHEET_ID
} from "./reference-import/sheet-definitions.mjs";

const OUTPUT_PATHS = Object.freeze({
  narrativeSnapshot: "data/source/narrative-filling.snapshot.json",
  narrativeCatalog: "data/lootgen-narrative-variants.json"
});

const USAGE = `Usage: node tools/import-reference-data.mjs [options]

Options:
  --apply                 write validated artifacts; default is dry-run
  --target <target>       target catalog (narratives)
  --credentials <path>    service-account JSON; defaults to env or ignored tools file
  --snapshot <path>       read local sheet values instead of Google
  --help                  print usage
`;

class UsageError extends Error {}

function parseArguments(argv) {
  const options = {
    apply: false,
    target: "narratives",
    credentials: null,
    snapshot: null,
    help: false
  };
  const valueFlags = new Map([
    ["--target", "target"],
    ["--credentials", "credentials"],
    ["--snapshot", "snapshot"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--help") options.help = true;
    else if (valueFlags.has(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new UsageError(`${argument} requires a value`);
      options[valueFlags.get(argument)] = value;
    } else {
      throw new UsageError(`Unknown option: ${argument}`);
    }
  }
  if (options.target !== "narratives") throw new UsageError(`Unsupported target: ${options.target}`);
  return options;
}

function assertSnapshotContainsNoSecrets(value, label = "snapshot") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSnapshotContainsNoSecrets(child, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:private_key|private_key_id|client_email|access_token|refresh_token|assertion)$/iu.test(key)) {
      throw new Error(`Snapshot contains forbidden credential field at ${label}.${key}`);
    }
    assertSnapshotContainsNoSecrets(child, `${label}.${key}`);
  }
}

function quotedRange(definition) {
  return `'${definition.sheetTitle.replaceAll("'", "''")}'!${definition.range}`;
}

function valuesFromSnapshot(snapshot) {
  if (Array.isArray(snapshot?.values)) return snapshot.values;
  if (Array.isArray(snapshot?.headers) && Array.isArray(snapshot?.rows)) {
    return [snapshot.headers, ...snapshot.rows.map((row) => row?.values ?? [])];
  }
  throw new Error("Reference snapshot must contain values or lossless headers/rows");
}

async function loadLocalSnapshot(snapshotPath, cwd) {
  const source = await fs.readFile(path.resolve(cwd, snapshotPath), "utf8");
  const parsed = JSON.parse(source);
  assertSnapshotContainsNoSecrets(parsed);
  return {
    spreadsheetId: String(parsed.spreadsheetId ?? REFERENCE_SPREADSHEET_ID),
    importedAt: String(parsed.importedAt ?? new Date().toISOString()),
    values: valuesFromSnapshot(parsed)
  };
}

async function fetchNarrativeSheet({ options, cwd, env }) {
  const serviceAccount = await loadGoogleServiceAccount({
    credentialsPath: options.credentials ? path.resolve(cwd, options.credentials) : null,
    env,
    cwd
  });
  const client = createGoogleSheetsClient();
  const [result] = await client.fetchRanges({
    spreadsheetId: REFERENCE_SPREADSHEET_ID,
    ranges: [quotedRange(NARRATIVE_SHEET_DEFINITION)],
    serviceAccount
  });
  return {
    spreadsheetId: REFERENCE_SPREADSHEET_ID,
    importedAt: new Date().toISOString(),
    values: result?.values ?? []
  };
}

function validateRawNarrativeValues(values) {
  const raw = buildRawSheetSnapshot({
    sheetKey: "narratives",
    range: quotedRange(NARRATIVE_SHEET_DEFINITION),
    values,
    declaration: NARRATIVE_SHEET_DEFINITION
  });
  return raw.values;
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function writeArtifactsAtomically(cwd, files) {
  const staged = [];
  try {
    for (const [relativePath, content] of files) {
      const target = path.resolve(cwd, ...relativePath.split("/"));
      const temporary = `${target}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(temporary, content, "utf8");
      staged.push({ target, temporary });
    }
    for (const entry of staged) await fs.rename(entry.temporary, entry.target);
  } catch (error) {
    await Promise.allSettled(staged.map((entry) => fs.rm(entry.temporary, { force: true })));
    throw error;
  }
}

export async function runReferenceImporterCli({
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
    stderr.write(`Usage error: ${error.message}\n`);
    return 2;
  }
  if (options.help) {
    stdout.write(USAGE);
    return 0;
  }

  let source;
  try {
    source = options.snapshot
      ? await loadLocalSnapshot(options.snapshot, cwd)
      : await fetchNarrativeSheet({ options, cwd, env });
    source.values = validateRawNarrativeValues(source.values);
  } catch (error) {
    stderr.write(`Source failed: ${error.message}\n`);
    return 3;
  }

  let artifacts;
  try {
    const gear = JSON.parse(await fs.readFile(path.join(cwd, "data", "gear.json"), "utf8"));
    artifacts = buildNarrativeArtifacts({ ...source, gear });
  } catch (error) {
    stderr.write(`Validation failed: ${error.message}\n`);
    return 4;
  }

  const snapshotJson = serializeJson(artifacts.snapshot);
  const catalogJson = serializeJson(artifacts.catalog);
  stdout.write(`target: narratives\n`);
  stdout.write(`rows: ${artifacts.snapshot.rowCount}\n`);
  stdout.write(`variants: ${artifacts.catalog.variants.length}\n`);
  stdout.write(`snapshot sha256: ${sha256(snapshotJson)}\n`);
  stdout.write(`catalog sha256: ${sha256(catalogJson)}\n`);

  if (!options.apply) {
    stdout.write("DRY-RUN: no files written.\n");
    return 0;
  }

  try {
    await writeArtifactsAtomically(cwd, new Map([
      [OUTPUT_PATHS.narrativeSnapshot, snapshotJson],
      [OUTPUT_PATHS.narrativeCatalog, catalogJson]
    ]));
    stdout.write("APPLIED: reference artifacts verified.\n");
    return 0;
  } catch (error) {
    stderr.write(`Write failed: ${error.message}\n`);
    return 6;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) process.exitCode = await runReferenceImporterCli();
