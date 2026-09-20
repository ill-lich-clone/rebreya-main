import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildNarrativeArtifacts } from "../tools/reference-import/narrative-pipeline.mjs";
import { runReferenceImporterCli } from "../tools/import-reference-data.mjs";

test("narrative import preserves source cells and joins every row to one gear id", () => {
  const values = [
    ["Оригинальный предмет", "Название", "Нарративное описание", "Ранг"],
    ["Энциклопедия (20 томов)", "Следы копоти", "Края страниц обуглены.", "3"]
  ];
  const result = buildNarrativeArtifacts({
    spreadsheetId: "sheet-id",
    importedAt: "2026-09-20T00:00:00.000Z",
    values,
    gear: [{ id: "энциклопедия-20-томов", name: "Энциклопедия (20 томов)" }]
  });

  assert.deepEqual(result.snapshot.headers, values[0]);
  assert.deepEqual(result.snapshot.rows[0].values, values[1]);
  assert.equal(result.catalog.variants[0].gearId, "энциклопедия-20-томов");
  assert.equal(result.catalog.variants[0].rank, 3);
});

test("narrative import rejects unknown and ambiguous gear names", () => {
  const values = [
    ["Оригинальный предмет", "Название", "Нарративное описание", "Ранг"],
    ["Книга", "Пометки", "На полях есть записи.", "1"]
  ];

  assert.throws(() => buildNarrativeArtifacts({
    spreadsheetId: "sheet-id",
    importedAt: "2026-09-20T00:00:00.000Z",
    values,
    gear: [{ id: "book-a", name: "Книга" }, { id: "book-b", name: "Книга" }]
  }), /ambiguous gear name/u);

  assert.throws(() => buildNarrativeArtifacts({
    spreadsheetId: "sheet-id",
    importedAt: "2026-09-20T00:00:00.000Z",
    values,
    gear: []
  }), /unknown gear name/u);
});

test("narrative import keeps source rows whose optional title is blank", () => {
  const result = buildNarrativeArtifacts({
    spreadsheetId: "sheet-id",
    importedAt: "2026-09-20T00:00:00.000Z",
    values: [
      ["Оригинальный предмет", "Название", "Нарративное описание", "Ранг"],
      ["Книга", "", "Только нарративное описание.", "1"]
    ],
    gear: [{ id: "book", name: "Книга" }]
  });

  assert.equal(result.snapshot.rowCount, 1);
  assert.equal(result.catalog.variants[0].title, "");
  assert.equal(result.catalog.variants[0].description, "Только нарративное описание.");
});

async function createReferenceImporterFixture(t, snapshot) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "rebreya-reference-import-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  await fs.mkdir(path.join(cwd, "data"), { recursive: true });
  await fs.writeFile(path.join(cwd, "data", "gear.json"), `${JSON.stringify([
    { id: "book", name: "Книга" }
  ], null, 2)}\n`, "utf8");
  const snapshotPath = path.join(cwd, "narratives-source.json");
  await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return { cwd, snapshotPath };
}

function captureStream() {
  let value = "";
  return {
    write(chunk) {
      value += String(chunk);
    },
    read() {
      return value;
    }
  };
}

test("reference importer dry-run reports hashes without writing artifacts", async (t) => {
  const { cwd, snapshotPath } = await createReferenceImporterFixture(t, {
    spreadsheetId: "sheet-id",
    importedAt: "2026-09-20T00:00:00.000Z",
    values: [
      ["Оригинальный предмет", "Название", "Нарративное описание", "Ранг"],
      ["Книга", "Пометки", "На полях есть записи.", "1"]
    ]
  });
  const stdout = captureStream();
  const stderr = captureStream();

  const exitCode = await runReferenceImporterCli({
    argv: ["--target", "narratives", "--snapshot", snapshotPath],
    cwd,
    stdout,
    stderr
  });

  assert.equal(exitCode, 0, stderr.read());
  assert.match(stdout.read(), /DRY-RUN/u);
  assert.match(stdout.read(), /rows: 1/u);
  assert.match(stdout.read(), /snapshot sha256: [a-f0-9]{64}/u);
  await assert.rejects(fs.access(path.join(cwd, "data", "lootgen-narrative-variants.json")), /ENOENT/u);
});

test("reference importer apply atomically writes snapshot and runtime catalog", async (t) => {
  const { cwd, snapshotPath } = await createReferenceImporterFixture(t, {
    spreadsheetId: "sheet-id",
    importedAt: "2026-09-20T00:00:00.000Z",
    values: [
      ["Оригинальный предмет", "Название", "Нарративное описание", "Ранг"],
      ["Книга", "Пометки", "На полях есть записи.", "1"]
    ]
  });
  const stdout = captureStream();
  const stderr = captureStream();

  const exitCode = await runReferenceImporterCli({
    argv: ["--apply", "--target", "narratives", "--snapshot", snapshotPath],
    cwd,
    stdout,
    stderr
  });

  assert.equal(exitCode, 0, stderr.read());
  assert.match(stdout.read(), /APPLIED/u);
  const source = JSON.parse(await fs.readFile(path.join(cwd, "data", "source", "narrative-filling.snapshot.json"), "utf8"));
  const catalog = JSON.parse(await fs.readFile(path.join(cwd, "data", "lootgen-narrative-variants.json"), "utf8"));
  assert.equal(source.rowCount, 1);
  assert.equal(catalog.variants[0].gearId, "book");
  assert.deepEqual((await fs.readdir(path.join(cwd, "data", "source"))).filter((name) => name.endsWith(".tmp")), []);
});

test("reference importer rejects credentials in snapshots and unsupported targets", async (t) => {
  const { cwd, snapshotPath } = await createReferenceImporterFixture(t, {
    spreadsheetId: "sheet-id",
    private_key: "must-not-be-accepted",
    values: []
  });
  const stdout = captureStream();
  const stderr = captureStream();

  assert.equal(await runReferenceImporterCli({
    argv: ["--target", "narratives", "--snapshot", snapshotPath],
    cwd,
    stdout,
    stderr
  }), 3);
  assert.doesNotMatch(`${stdout.read()}${stderr.read()}`, /must-not-be-accepted/u);

  assert.equal(await runReferenceImporterCli({
    argv: ["--target", "unknown", "--snapshot", snapshotPath],
    cwd,
    stdout: captureStream(),
    stderr: captureStream()
  }), 2);
});

test("checked-in narrative artifacts match the approved sheet shape", async () => {
  const snapshot = JSON.parse(await fs.readFile(new URL("../data/source/narrative-filling.snapshot.json", import.meta.url), "utf8"));
  const catalog = JSON.parse(await fs.readFile(new URL("../data/lootgen-narrative-variants.json", import.meta.url), "utf8"));

  assert.deepEqual(snapshot.headers, ["Оригинальный предмет", "Название", "Нарративное описание", "Ранг"]);
  assert.equal(snapshot.rowCount, 3996);
  assert.equal(snapshot.rows.length, 3996);
  assert.equal(catalog.variants.length, 3996);
  assert.equal(new Set(catalog.variants.map((row) => row.gearId)).size, 160);
  assert.ok(catalog.variants.some((row) => row.gearId === "энциклопедия-20-томов"));
});
