import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { adaptMaterialsCatalog } from "../tools/equipment-import/adapters/materials.mjs";
import { adaptImplantsCatalog } from "../tools/equipment-import/adapters/implants.mjs";
import { adaptTransportCatalog } from "../tools/equipment-import/adapters/transport.mjs";

const fixtureRoot = new URL("./fixtures/equipment-import/", import.meta.url);
const raw = JSON.parse(await readFile(new URL("secondary-catalogs-raw.json", fixtureRoot), "utf8"));
const expected = JSON.parse(await readFile(new URL("secondary-catalogs-expected.json", fixtureRoot), "utf8"));

function overrides() {
  return {
    identities: {
      materials: { "Шерсть чудовища": { id: "material-3", aliases: [] } },
      implants: { "Навесная броня": { id: "implant-navesnaya-bronya", aliases: [] } },
      transport: { "Гражданский автомобиль": { id: "transport-v01-grazhdanskiy-avtomobil", aliases: [] } }
    },
    enrichment: {
      materials: {
        "material-3": { linkedGoodId: "monster-wool", linkedGoodName: "Шерсть чудовища" }
      },
      implants: {},
      transport: {
        "transport-v01-grazhdanskiy-avtomobil": { documentId: "lchtransport0049" }
      }
    }
  };
}

function exactReferenceIndex(entries) {
  const gearBySourceRef = new Map(entries.map(([sourceRef, stableId]) => [sourceRef, { sourceRef, stableId }]));
  return { gearBySourceRef, resolveStableGearId: (reference) => reference.stableId };
}

function rawImplantSnapshot(fixture) {
  const values = Array.from({ length: fixture.rowNumber }, () => []);
  values[0] = ["Название", "Ранг", "Очки модификации", "Эффект", "Требования", "Цена (ЗМ ) и Источник", "Тип"];
  values[fixture.rowNumber - 1] = fixture.values;
  return { ...fixture, values };
}

test("materials adapter preserves exact A:M text and parses fractional numeric fields", () => {
  const result = adaptMaterialsCatalog({
    snapshot: { ...raw.material, rows: [raw.material.row] },
    overrides: overrides(),
    diagnostics: []
  });
  assert.deepEqual(result, [expected.material]);
  assert.equal(result[0].weight, 0.25);
  assert.equal(result[0].isSynthetic, false);
});

test("materials adapter rejects a malformed numeric cell with its source coordinate", () => {
  const snapshot = structuredClone({ ...raw.material, rows: [raw.material.row] });
  snapshot.rows[0].cells["Вес (фнт)"] = "14/ фнт";
  assert.throws(
    () => adaptMaterialsCatalog({ snapshot, overrides: overrides(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "invalid-number" && entry.rowNumber === 3 && entry.column === "Вес (фнт)")
  );
});

test("materials adapter accepts the live decorated gold price without prefix extraction", () => {
  const snapshot = structuredClone({ ...raw.material, rows: [raw.material.row] });
  snapshot.rows[0].cells["Цена (зм)"] = "500 зм";
  const [material] = adaptMaterialsCatalog({ snapshot, overrides: overrides(), diagnostics: [] });
  assert.equal(material.priceGold, 500);
});

test("implants adapter preserves stable identity, decorated price, category, and point range", () => {
  const result = adaptImplantsCatalog({
    snapshot: rawImplantSnapshot(raw.implant),
    referenceIndex: exactReferenceIndex([["Импланты V0.1!A49", "navesnaya-bronya"]]),
    overrides: overrides(),
    diagnostics: []
  });
  assert.deepEqual(result, [expected.implant]);
});

test("implants adapter marks intentionally incomplete source rows as non-installable", () => {
  const fixture = { ...raw.implant, rowNumber: 66, values: ["Паучьи лапы «Нова Индастриз»", "7", "", "", "", "", "Сверхтяжёлая"] };
  const result = adaptImplantsCatalog({
    snapshot: rawImplantSnapshot(fixture),
    referenceIndex: exactReferenceIndex([["Импланты V0.1!A66", "pauchi-lapy"]]),
    overrides: { identities: {}, enrichment: {} }, diagnostics: []
  });
  assert.match(result[0].id, /^implant-/u);
  assert.equal(result[0].implant.installable, false);
  assert.equal(result[0].implant.pointsMin, null);
  assert.equal(result[0].priceValue, 0);
});

test("implants adapter requires an exact equipment reference", () => {
  assert.throws(
    () => adaptImplantsCatalog({
      snapshot: rawImplantSnapshot(raw.implant),
      referenceIndex: exactReferenceIndex([]), overrides: overrides(), diagnostics: []
    }),
    (error) => error.diagnostics?.some((entry) => entry.code === "missing-equipment-reference" && entry.rowNumber === 49)
  );
});

test("transport adapter validates typed statistics and serializes the existing raw contract", () => {
  const result = adaptTransportCatalog({
    snapshots: { transport: { ...raw.transport, rows: [raw.transport.row] } },
    referenceIndex: exactReferenceIndex([["Транспорт V0.1!A51", "grazhdanskiy-avtomobil"]]),
    overrides: overrides(), diagnostics: []
  });
  assert.deepEqual(result, [expected.transport]);
});

test("transport adapter rejects malformed speed and missing exact references with coordinates", () => {
  const malformed = structuredClone({ ...raw.transport, rows: [raw.transport.row] });
  malformed.rows[0].cells["Скорость (сражение)"] = "быстро 250";
  assert.throws(
    () => adaptTransportCatalog({
      snapshots: { transport: malformed },
      referenceIndex: exactReferenceIndex([["Транспорт V0.1!A51", "car"]]), overrides: overrides(), diagnostics: []
    }),
    (error) => error.diagnostics?.some((entry) => entry.code === "invalid-transport-speed" && entry.column === "Скорость (сражение)")
  );
  assert.throws(
    () => adaptTransportCatalog({
      snapshots: { transport: { ...raw.transport, rows: [raw.transport.row] } },
      referenceIndex: exactReferenceIndex([]), overrides: overrides(), diagnostics: []
    }),
    (error) => error.diagnostics?.some((entry) => entry.code === "missing-equipment-reference" && entry.rowNumber === 51)
  );
});

test("transport adapter accepts the live Russian singular travel-speed unit", () => {
  const snapshot = structuredClone({ ...raw.transport, rows: [raw.transport.row] });
  snapshot.rows[0].cells["Скорость путешествия"] = "4 мили/час";
  const [transport] = adaptTransportCatalog({
    snapshots: { transport: snapshot },
    referenceIndex: exactReferenceIndex([["Транспорт V0.1!A51", "car"]]),
    overrides: overrides(), diagnostics: []
  });
  assert.equal(transport.travelSpeed, "4 мили/час");
});
