import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildNarrativeArtifacts } from "../tools/reference-import/narrative-pipeline.mjs";
import { buildGlossaryArtifacts } from "../tools/reference-import/glossary-pipeline.mjs";
import { runReferenceImporterCli } from "../tools/import-reference-data.mjs";

test("glossary import preserves every nonempty row and emits described terms", () => {
  const values = [
    ["ГЛОССАРИЙ СВОЙСТВ ОРУЖИЯ И АТАК"],
    ["Источник: тест"],
    [],
    ["Термин", "Описание"],
    ["СВОЙСТВА ОРУЖИЯ"],
    ["Тяжёлое [Lich]", "Свойство оружия."]
  ];
  const result = buildGlossaryArtifacts({ spreadsheetId: "sheet-id", importedAt: "2026-09-20T00:00:00.000Z", values });
  assert.equal(result.snapshot.rowCount, 2);
  assert.deepEqual(result.snapshot.preambleRows.map((row) => row.values), [values[0], values[1]]);
  assert.deepEqual(result.snapshot.rows[1].values, ["Тяжёлое [Lich]", "Свойство оружия."]);
  assert.deepEqual(result.catalog.terms.map((term) => term.name), ["Тяжёлое"]);
  assert.equal(result.catalog.terms[0].sourceLabel, "Lich");
  assert.equal(result.catalog.terms[0].section, "СВОЙСТВА ОРУЖИЯ");
});

test("glossary term ids ignore row order and prose line endings are canonical", () => {
  const preamble = [["Глоссарий"], ["Источник"], [], ["Термин", "Описание"]];
  const first = buildGlossaryArtifacts({spreadsheetId:"sheet",importedAt:"2026-09-20T00:00:00.000Z",values:[...preamble,
    ["Раздел"], ["Тяжёлое [PHB+]","Строка 1\r\nСтрока 2"], ["Лёгкое","Текст"]]});
  const second = buildGlossaryArtifacts({spreadsheetId:"sheet",importedAt:"2026-09-20T00:00:00.000Z",values:[...preamble,
    ["Раздел"], ["Лёгкое","Текст"], ["Тяжёлое [PHB+]","Строка 1\nСтрока 2"]]});
  const ids = catalog => new Map(catalog.terms.map(term => [term.name,term.termId]));
  assert.deepEqual(ids(first.catalog),ids(second.catalog));
  assert.equal(first.catalog.terms[0].description,"Строка 1\nСтрока 2");
  assert.equal(first.catalog.terms[0].sourceLabel,"PHB+");
});

test("glossary import rejects blank described names and conflicting normalized duplicates", () => {
  const base=[["Глоссарий"],[],[],["Термин","Описание"],["Раздел"]];
  assert.throws(()=>buildGlossaryArtifacts({spreadsheetId:"sheet",importedAt:"now",values:[...base,["","Описание"]]}),/blank glossary term name/u);
  assert.throws(()=>buildGlossaryArtifacts({spreadsheetId:"sheet",importedAt:"now",values:[...base,
    ["Тяжёлое [Lich]","Первое"],[" тяжёлое [PHB+] ","Второе"]]}),/conflicting glossary term/u);
});

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

test("reference importer writes glossary snapshot and runtime catalog", async (t) => {
  const {cwd,snapshotPath}=await createReferenceImporterFixture(t,{
    spreadsheetId:"sheet-id",importedAt:"2026-09-20T00:00:00.000Z",values:[
      ["Глоссарий"],["Источник"],[],["Термин","Описание"],["Раздел"],["Тяжёлое [Lich]","Описание"]
    ]
  });
  const stdout=captureStream(),stderr=captureStream();
  const exitCode=await runReferenceImporterCli({argv:["--apply","--target","glossary","--snapshot",snapshotPath],cwd,stdout,stderr});
  assert.equal(exitCode,0,stderr.read());
  assert.match(stdout.read(),/target: glossary/u);
  assert.match(stdout.read(),/terms: 1/u);
  const snapshot=JSON.parse(await fs.readFile(path.join(cwd,"data","source","glossary-0.1.snapshot.json"),"utf8"));
  const catalog=JSON.parse(await fs.readFile(path.join(cwd,"data","glossary-terms.json"),"utf8"));
  assert.equal(snapshot.rowCount,2);
  assert.equal(catalog.terms[0].name,"Тяжёлое");
  assert.deepEqual((await fs.readdir(path.join(cwd,"data","source"))).filter(name=>name.endsWith(".tmp")),[]);
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

test("checked-in glossary artifacts match the approved sheet shape", async () => {
  const snapshot=JSON.parse(await fs.readFile(new URL("../data/source/glossary-0.1.snapshot.json",import.meta.url),"utf8"));
  const catalog=JSON.parse(await fs.readFile(new URL("../data/glossary-terms.json",import.meta.url),"utf8"));
  assert.deepEqual(snapshot.headers,["Термин","Описание"]);
  assert.equal(snapshot.preambleRows.length,2);
  assert.equal(snapshot.rowCount,68);
  assert.equal(snapshot.rows.length,68);
  assert.equal(catalog.terms.length,63);
  assert.equal(new Set(catalog.terms.map(term=>term.termId)).size,63);
  assert.ok(catalog.terms.every(term=>term.termId && term.name && term.description && Array.isArray(term.aliases)));
});
