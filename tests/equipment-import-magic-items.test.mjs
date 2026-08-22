import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  adaptMagicItemsCatalog,
  renderMagicItemsModule
} from "../tools/equipment-import/adapters/magic-items.mjs";

const fixtureRoot = new URL("./fixtures/equipment-import/", import.meta.url);
const raw = JSON.parse(await readFile(new URL("magic-items-raw.json", fixtureRoot), "utf8"));
const expected = JSON.parse(await readFile(new URL("magic-items-expected.json", fixtureRoot), "utf8"));

function overrides() {
  return {
    identities: {
      magicItems: {
        "магический-предмет|1": { id: "аметистовый-магнетит", aliases: [] },
        "магический-предмет|5": { id: "боевая-кирка-камнетворца", aliases: [] }
      }
    },
    enrichment: { magicItems: {} }
  };
}

function referenceIndex() {
  const reference = {
    sourceKey: "оружие|боевая кирка",
    canonicalName: "Боевая кирка",
    equipmentType: "Оружие",
    sourceRef: "Оружие V0.36!A3"
  };
  return {
    gearByKey: new Map([[reference.sourceKey, reference]]),
    resolveStableGearId: (entry) => entry === reference ? "boevaya-kirka" : null
  };
}

test("magic item adapter preserves source gameplay text and parses typed fields", () => {
  const result = adaptMagicItemsCatalog({
    snapshots: { magicItems: raw },
    overrides: overrides(),
    referenceIndex: referenceIndex(),
    diagnostics: []
  });

  assert.deepEqual(result, expected);
  assert.equal(result[0].value, 6000);
  assert.equal(result[0].description, raw.rows[0].cells.Описание);
  assert.equal(result[1].costText, "(2d8kh1+1)*2500 зм");
});

test("magic item adapter rejects malformed complete values with coordinates", () => {
  for (const [column, value, code] of [
    ["Value", "6 00", "invalid-number"],
    ["Стоимость", "10000 зм мусор", "invalid-magic-item-cost"],
    ["Расходник", "иногда", "invalid-boolean"],
    ["Редкость", "Сверхредкий", "invalid-enum"],
    ["Тип", "Штуковина", "invalid-enum"]
  ]) {
    const snapshot = structuredClone(raw);
    snapshot.rows = [snapshot.rows[0]];
    snapshot.rows[0].cells[column] = value;
    assert.throws(
      () => adaptMagicItemsCatalog({
        snapshots: { magicItems: snapshot }, overrides: overrides(), referenceIndex: referenceIndex(), diagnostics: []
      }),
      (error) => error.diagnostics?.some((entry) => entry.code === code && entry.rowNumber === 2 && entry.column === column),
      `${column} should fail as ${code}`
    );
  }
});

test("magic item adapter diagnoses duplicate source numbers, stable ids, descriptions, and dangling base gear", () => {
  const duplicateNumber = structuredClone(raw);
  duplicateNumber.rows = [duplicateNumber.rows[0], structuredClone(duplicateNumber.rows[0])];
  duplicateNumber.rows[1].rowNumber = 3;
  duplicateNumber.rows[1].cells.Название = "Другое имя";
  assert.throws(
    () => adaptMagicItemsCatalog({ snapshots: { magicItems: duplicateNumber }, overrides: overrides(), referenceIndex: referenceIndex(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "duplicate-magic-source-number")
  );

  const duplicateId = structuredClone(raw);
  duplicateId.rows = duplicateId.rows.slice(0, 2);
  const collisionOverrides = overrides();
  collisionOverrides.identities.magicItems["магический-предмет|5"].id = "аметистовый-магнетит";
  assert.throws(
    () => adaptMagicItemsCatalog({ snapshots: { magicItems: duplicateId }, overrides: collisionOverrides, referenceIndex: referenceIndex(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "duplicate-magic-item-id")
  );

  const missingDescription = structuredClone(raw);
  missingDescription.rows = [missingDescription.rows[0]];
  missingDescription.rows[0].cells.Описание = "";
  assert.throws(
    () => adaptMagicItemsCatalog({ snapshots: { magicItems: missingDescription }, overrides: overrides(), referenceIndex: referenceIndex(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "missing-required-text" && entry.column === "Описание")
  );

  const dangling = structuredClone(raw);
  dangling.rows = [dangling.rows[1]];
  assert.throws(
    () => adaptMagicItemsCatalog({ snapshots: { magicItems: dangling }, overrides: overrides(), referenceIndex: { gearByKey: new Map(), resolveStableGearId() {} }, diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "missing-magic-base-equipment")
  );
});

test("duplicate display names remain separate when source-number identities differ", () => {
  const snapshot = structuredClone(raw);
  snapshot.rows = [snapshot.rows[0], structuredClone(snapshot.rows[0])];
  snapshot.rows[1].rowNumber = 17;
  snapshot.rows[1].sourceIdentity = "16";
  snapshot.rows[1].cells["№"] = "16";
  const distinctOverrides = overrides();
  distinctOverrides.identities.magicItems["магический-предмет|16"] = {
    id: "аметистовый-магнетит-2",
    aliases: []
  };

  const result = adaptMagicItemsCatalog({
    snapshots: { magicItems: snapshot },
    overrides: distinctOverrides,
    referenceIndex: referenceIndex(),
    diagnostics: []
  });

  assert.deepEqual(result.map((item) => item.name), ["Аметистовый магнетит", "Аметистовый магнетит"]);
  assert.deepEqual(result.map((item) => item.id), ["аметистовый-магнетит", "аметистовый-магнетит-2"]);
});

test("magic item renderer is deterministic and emits importable ESM", async () => {
  const first = renderMagicItemsModule(expected);
  const second = renderMagicItemsModule(structuredClone(expected));
  assert.equal(first, second);
  assert.match(first, /^\/\/ Generated by the unified equipment importer\./u);

  const imported = await import(`data:text/javascript;base64,${Buffer.from(first).toString("base64")}`);
  assert.deepEqual(imported.MAGIC_ITEMS, expected);
});
