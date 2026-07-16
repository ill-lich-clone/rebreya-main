import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { REBREYA_TOOLS } from "../scripts/constants.js";
import {
  buildBaseRawMaterialIndex,
  mergeMaterialCatalog,
  normalizeMaterialSheetRows
} from "../scripts/data/material-catalog-sync.js";

const FIXTURE_URL = new URL("./fixtures/materials-encyclopedia.json", import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));

function normalizeIdentifier(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function parseNullableNumber(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+(?:зм|фнт)$/u, "")
    .replace(/\s+/gu, "")
    .replace(",", ".");

  if (!text) {
    return null;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function expectedProjection({ row, cells }) {
  return {
    name: normalizeIdentifier(cells[0]),
    type: normalizeIdentifier(cells[1]),
    subtype: normalizeIdentifier(cells[2]),
    priceGold: parseNullableNumber(cells[3]),
    weight: parseNullableNumber(cells[4]),
    rank: parseNullableNumber(cells[5]),
    description: cells[6],
    applications: {
      upgrade: cells[7],
      implant: cells[8],
      crafting: cells[9],
      alchemy: cells[10],
      knowledge: cells[11]
    },
    alchemyAspects: cells[12],
    source: {
      spreadsheetId: fixture.spreadsheetId,
      sheetName: fixture.sheetName,
      row
    },
    isSynthetic: false
  };
}

function actualProjection(material) {
  return {
    name: material.name,
    type: material.type,
    subtype: material.subtype,
    priceGold: material.priceGold,
    weight: material.weight,
    rank: material.rank,
    description: material.description,
    applications: material.applications,
    alchemyAspects: material.alchemyAspects,
    source: material.source,
    isSynthetic: material.isSynthetic
  };
}

test("normalizeMaterialSheetRows maps every raw A:M source row without changing G:M", () => {
  const normalized = normalizeMaterialSheetRows(fixture.sourceRows);

  assert.equal(normalized.length, 247);
  for (let index = 0; index < fixture.sourceRows.length; index += 1) {
    assert.deepEqual(
      actualProjection(normalized[index]),
      expectedProjection(fixture.sourceRows[index]),
      `source row ${fixture.sourceRows[index].row} preserves A:M`
    );
  }
});

test("normalizeMaterialSheetRows keeps null D:F and parses decorated decimal cells", () => {
  const normalized = normalizeMaterialSheetRows(fixture.sourceRows);
  const byName = new Map(normalized.map((material) => [material.name, material]));

  assert.deepEqual(
    {
      priceGold: byName.get("Кости тролля").priceGold,
      weight: byName.get("Кости тролля").weight,
      rank: byName.get("Кости тролля").rank
    },
    { priceGold: null, weight: null, rank: null }
  );
  assert.equal(byName.get("Базовое сырье для Инструменты Воровские").priceGold, 1);
  assert.equal(byName.get("Базовое сырье для Инструменты Воровские").weight, 0.1);
  assert.equal(byName.get("Алхимические реагенты").rank, 0);
});

test("mergeMaterialCatalog adds 202 rows and preserves every historical id", () => {
  const existing = Object.entries(fixture.originalMaterialIds).map(([name, id]) => ({
    id,
    name,
    linkedGoodId: id,
    linkedGoodName: name
  }));
  const incoming = normalizeMaterialSheetRows(fixture.sourceRows);
  const result = mergeMaterialCatalog(existing, incoming);
  const byName = new Map(result.materials.map((material) => [material.name, material]));

  assert.equal(result.materials.length, 247);
  assert.equal(result.addedIds.length, 202);
  assert.equal(result.updatedIds.length, 45);
  for (let index = 0; index < fixture.sourceRows.length; index += 1) {
    assert.deepEqual(
      actualProjection(result.materials[index]),
      expectedProjection(fixture.sourceRows[index]),
      `merged source row ${fixture.sourceRows[index].row} preserves A:M`
    );
  }
  for (const [name, id] of Object.entries(fixture.originalMaterialIds)) {
    assert.equal(byName.get(name)?.id, id, `${name} keeps ${id}`);
    assert.equal(byName.get(name)?.linkedGoodId, id, `${name} keeps linked good ${id}`);
  }

  assert.equal(new Set(result.materials.map(({ id }) => id)).size, 247);
  assert.equal(new Set(result.materials.map(({ name }) => name.toLocaleLowerCase("ru"))).size, 247);
});

test("mergeMaterialCatalog reserves a later historical id before assigning an inserted row", () => {
  const existing = [{ id: "material-2", name: "Historical material" }];
  const incoming = [
    { id: "material-2", name: "Inserted material" },
    { id: "material-3", name: "Historical material" }
  ];

  const result = mergeMaterialCatalog(existing, incoming);

  assert.deepEqual(
    result.materials.map(({ id, name }) => ({ id, name })),
    [
      { id: "material-2-2", name: "Inserted material" },
      { id: "material-2", name: "Historical material" }
    ]
  );
});

test("mergeMaterialCatalog is idempotent after a source row insertion", () => {
  const incoming = [
    { id: "material-2", name: "Inserted material" },
    { id: "material-3", name: "Historical material" }
  ];
  const first = mergeMaterialCatalog(
    [{ id: "material-2", name: "Historical material" }],
    incoming
  );

  const second = mergeMaterialCatalog(first.materials, incoming);

  assert.deepEqual(second.materials, first.materials);
});

test("PowerShell import reserves historical ids and stays idempotent", {
  skip: process.platform !== "win32"
}, () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "rebreya-materials-"));
  const sourcePath = join(tempDirectory, "materials.csv");
  const goodsPath = join(tempDirectory, "goods.json");
  const existingPath = join(tempDirectory, "existing.json");
  const firstOutputPath = join(tempDirectory, "first.json");
  const secondOutputPath = join(tempDirectory, "second.json");
  const scriptPath = fileURLToPath(new URL("../tools/import-materials.ps1", import.meta.url));
  const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const sourceRows = Array.from({ length: 247 }, (_, index) => {
    const name = index === 0
      ? "Inserted material"
      : (index === 1 ? "Historical material" : `Filler material ${index + 1}`);
    return [name, ...Array(12).fill("")].map(csvCell).join(",");
  });
  const csv = [Array.from({ length: 13 }, (_, index) => csvCell(`Column ${index + 1}`)).join(","), ...sourceRows]
    .join("\r\n");

  const runImport = (inputPath, outputPath, sha256) => spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    "-SourcePath", sourcePath,
    "-GoodsPath", goodsPath,
    "-ExistingMaterialsPath", inputPath,
    "-OutputPath", outputPath,
    "-ExpectedCsvSha256", sha256,
    "-Quiet"
  ], { encoding: "utf8" });

  try {
    writeFileSync(sourcePath, csv, "utf8");
    writeFileSync(goodsPath, "[]", "utf8");
    writeFileSync(existingPath, JSON.stringify([
      { id: "material-2", name: "Historical material", linkedGoodId: null }
    ]), "utf8");
    const sha256 = createHash("sha256").update(csv).digest("hex").toUpperCase();

    const firstRun = runImport(existingPath, firstOutputPath, sha256);
    assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout || firstRun.error?.message);
    const first = JSON.parse(readFileSync(firstOutputPath, "utf8"));
    assert.deepEqual(
      first.slice(0, 2).map(({ id, name }) => ({ id, name })),
      [
        { id: "material-2-2", name: "Inserted material" },
        { id: "material-2", name: "Historical material" }
      ]
    );

    const secondRun = runImport(firstOutputPath, secondOutputPath, sha256);
    assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout || secondRun.error?.message);
    assert.deepEqual(JSON.parse(readFileSync(secondOutputPath, "utf8")), first);
  }
  finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("buildBaseRawMaterialIndex resolves exactly one source material for all 15 tools", () => {
  const incoming = normalizeMaterialSheetRows(fixture.sourceRows);
  const result = mergeMaterialCatalog(
    Object.entries(fixture.originalMaterialIds).map(([name, id]) => ({ id, name })),
    incoming
  );
  const index = buildBaseRawMaterialIndex(result.materials);
  const byName = new Map(result.materials.map((material) => [material.name, material]));

  assert.equal(index.size, REBREYA_TOOLS.length);
  for (const tool of REBREYA_TOOLS) {
    const expected = byName.get(`Базовое сырье для Инструменты ${tool.label}`);
    assert.ok(expected, `${tool.label} source row exists`);
    assert.equal(index.get(tool.id), expected.id, `${tool.id} maps to ${expected.name}`);
  }
  assert.ok(byName.has("Алхимические реагенты"));
});
