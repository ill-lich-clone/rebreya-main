import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAlchemyImporterCli } from "../tools/import-alchemy-products.mjs";
import {
  diffAlchemyCatalogs,
  evaluateAlchemyDiffGuards
} from "../tools/alchemy-import/diff.mjs";
import { adaptAlchemyCatalog } from "../tools/alchemy-import/catalog.mjs";
import { buildAlchemySourceSnapshot } from "../tools/alchemy-import/source.mjs";
import {
  ALCHEMY_CATALOG_PATH,
  serializeAlchemyCatalog
} from "../tools/alchemy-import/serialization.mjs";

const fixtureUrl = new URL("fixtures/alchemy-import/products-formatted-values.json", import.meta.url);
const fixture = JSON.parse(await fs.readFile(fixtureUrl, "utf8"));
const metadata = {
  sheets: [{ properties: { sheetId: fixture.sheetId, title: fixture.sheetTitle } }]
};
const products = adaptAlchemyCatalog(buildAlchemySourceSnapshot({
  spreadsheetId: fixture.spreadsheetId,
  metadata,
  values: fixture.values
}));

function captureStream() {
  let value = "";
  return {
    write(chunk) { value += String(chunk); },
    read() { return value; }
  };
}

function fakeGoogle({ error = null, secret = "PRIVATE_TOKEN_DO_NOT_PRINT" } = {}) {
  return {
    loadServiceAccount: async () => ({
      type: "service_account",
      client_email: "fixture@example.invalid",
      private_key: secret
    }),
    createSheetsClient: () => ({
      async fetchSpreadsheetMetadata() {
        if (error) throw error;
        return metadata;
      },
      async fetchRanges() {
        if (error) throw error;
        return [{ range: fixture.range, values: fixture.values }];
      }
    })
  };
}

async function setup(t, current = null) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "rebreya-alchemy-cli-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  if (current) {
    const target = path.join(cwd, ...ALCHEMY_CATALOG_PATH.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, serializeAlchemyCatalog(current), "utf8");
  }
  return cwd;
}

async function run({ cwd, argv = [], google = fakeGoogle(), fsImpl = fs } = {}) {
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCode = await runAlchemyImporterCli({
    argv,
    cwd,
    env: {},
    stdout,
    stderr,
    fsImpl,
    loadServiceAccount: google.loadServiceAccount,
    createSheetsClient: google.createSheetsClient
  });
  return { exitCode, stdout: stdout.read(), stderr: stderr.read() };
}

test("default command is a Google-backed dry-run with 230 additions and no write", async (t) => {
  const cwd = await setup(t);

  const result = await run({ cwd });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Alchemy import dry-run/u);
  assert.match(result.stdout, /\+230 ~0 =0 -0 churn:0/u);
  assert.match(result.stdout, /DRY-RUN: no files written/u);
  await assert.rejects(fs.access(path.join(cwd, ...ALCHEMY_CATALOG_PATH.split("/"))), /ENOENT/u);
});

test("help is complete and unknown options fail as usage errors", async (t) => {
  const cwd = await setup(t);
  const help = await run({ cwd, argv: ["--help"] });
  assert.equal(help.exitCode, 0);
  for (const option of ["--apply", "--allow-removals", "--credentials", "--spreadsheet-id", "--snapshot", "--write-snapshot", "--help"]) {
    assert.match(help.stdout, new RegExp(option, "u"));
  }
  assert.equal((await run({ cwd, argv: ["--unknown"] })).exitCode, 2);
  assert.equal((await run({ cwd, argv: ["--snapshot", "a.json", "--write-snapshot", "b.json"] })).exitCode, 2);
});

test("Google source failures redact credentials", async (t) => {
  const cwd = await setup(t);
  const secret = "PRIVATE_TOKEN_DO_NOT_PRINT";
  const result = await run({
    cwd,
    google: fakeGoogle({ error: new Error(`request rejected ${secret}`), secret })
  });

  assert.equal(result.exitCode, 3);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret, "u"));
  assert.match(result.stderr, /Source failed/u);
});

test("explicit debug snapshot contains only sanitized source values", async (t) => {
  const cwd = await setup(t);
  const result = await run({ cwd, argv: ["--write-snapshot", "debug/source.json"] });

  assert.equal(result.exitCode, 0, result.stderr);
  const source = await fs.readFile(path.join(cwd, "debug", "source.json"), "utf8");
  const parsed = JSON.parse(source);
  assert.equal(parsed.values.length, 230);
  assert.equal(parsed.fingerprint, fixture.fingerprint);
  assert.doesNotMatch(source, /private_key|client_email|access_token|PRIVATE_TOKEN/iu);
});

test("snapshot apply writes the validated catalog and becomes an unchanged dry-run", async (t) => {
  const cwd = await setup(t);
  const snapshotPath = path.join(cwd, "source.json");
  await fs.writeFile(snapshotPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

  const applied = await run({ cwd, argv: ["--apply", "--snapshot", snapshotPath] });
  assert.equal(applied.exitCode, 0, applied.stderr);
  assert.match(applied.stdout, /APPLIED/u);
  const written = JSON.parse(await fs.readFile(path.join(cwd, ...ALCHEMY_CATALOG_PATH.split("/")), "utf8"));
  assert.equal(written.length, 230);

  const stable = await run({ cwd, argv: ["--snapshot", snapshotPath] });
  assert.equal(stable.exitCode, 0, stable.stderr);
  assert.match(stable.stdout, /\+0 ~0 =230 -0 churn:0/u);
});

test("validation failure never mutates the current catalog", async (t) => {
  const cwd = await setup(t, products);
  const before = await fs.readFile(path.join(cwd, ...ALCHEMY_CATALOG_PATH.split("/")), "utf8");
  const invalid = structuredClone(fixture);
  invalid.values[0][2] = "Неизвестный продукт";
  const snapshotPath = path.join(cwd, "invalid-source.json");
  await fs.writeFile(snapshotPath, `${JSON.stringify(invalid, null, 2)}\n`, "utf8");

  const result = await run({ cwd, argv: ["--apply", "--snapshot", snapshotPath] });

  assert.equal(result.exitCode, 4);
  assert.equal(await fs.readFile(path.join(cwd, ...ALCHEMY_CATALOG_PATH.split("/")), "utf8"), before);
});

test("atomic rename failure returns a write error and cleans staged bytes", async (t) => {
  const cwd = await setup(t);
  const failingFs = {
    readFile: fs.readFile,
    mkdir: fs.mkdir,
    writeFile: fs.writeFile,
    rm: fs.rm,
    async rename() { throw new Error("rename denied"); }
  };

  const result = await run({ cwd, argv: ["--apply"], fsImpl: failingFs });

  assert.equal(result.exitCode, 6);
  assert.match(result.stderr, /Write failed/u);
  const dataPath = path.join(cwd, "data");
  assert.deepEqual((await fs.readdir(dataPath)).filter((name) => name.endsWith(".tmp")), []);
});

test("removals require permission and identity churn always blocks", async (t) => {
  const extra = {
    ...structuredClone(products[0]),
    id: "alchemy-999",
    sourceNumber: 999,
    name: "Лишний старый продукт"
  };
  const removalCwd = await setup(t, [...products, extra]);
  const blockedRemoval = await run({ cwd: removalCwd });
  assert.equal(blockedRemoval.exitCode, 5);
  assert.match(blockedRemoval.stdout, /-1/u);
  const allowedRemoval = await run({ cwd: removalCwd, argv: ["--apply", "--allow-removals"] });
  assert.equal(allowedRemoval.exitCode, 0, allowedRemoval.stderr);

  const churned = structuredClone(products);
  churned[0].id = "old-alchemy-id";
  const churnCwd = await setup(t, churned);
  const churn = await run({ cwd: churnCwd, argv: ["--apply", "--allow-removals"] });
  assert.equal(churn.exitCode, 5);
  assert.match(churn.stdout, /churn:1/u);
});

test("catalog diff is deterministic and guards stable source identity", () => {
  const current = [{ sourceNumber: 1, id: "old", name: "Old" }];
  const next = [{ sourceNumber: 1, id: "new", name: "New" }];
  const diff = diffAlchemyCatalogs({ current, next });
  assert.deepEqual(diff.identityChurn, [{ sourceNumber: 1, currentId: "old", nextId: "new" }]);
  assert.throws(() => evaluateAlchemyDiffGuards({ diff, allowRemovals: true }), /identity churn/i);
});
