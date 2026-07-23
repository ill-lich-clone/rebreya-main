import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MODULE_ID } from "../scripts/constants.js";
import { createDnd5eItemData } from "../scripts/data/gear-compendium.js";
import { normalizeEconomyDataset } from "../scripts/data/normalizer.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = join(TESTS_DIR, "..");

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value))
  }
};
globalThis.CONST ??= {
  DOCUMENT_OWNERSHIP_LEVELS: {
    OBSERVER: 2
  }
};

function loadImplants() {
  return JSON.parse(readFileSync(join(MODULE_DIR, "data", "implants.json"), "utf8"));
}

test("implant catalog preserves all named spreadsheet rows and exact armor metadata", () => {
  const implants = loadImplants();
  assert.equal(implants.length, 90);

  const armor = implants.find((entry) => entry.name === "Навесная броня");
  assert.ok(armor);
  assert.equal(armor.rank, 3);
  assert.equal(armor.implant.pointsText, "1");
  assert.equal(armor.implant.pointsMin, 1);
  assert.equal(armor.implant.pointsMax, 1);
  assert.equal(armor.implant.type, "Общая");
  assert.equal(armor.implant.kind, "mechanical");
  assert.equal(armor.implant.magical, false);
  assert.match(armor.implant.effect, /\+1 к КД/u);
  assert.equal(armor.implant.requirements, "—");
});

test("implant catalog preserves variable costs and magical classification", () => {
  const implants = loadImplants();
  const condenser = implants.find((entry) => entry.name === "Конденсатор магии (М)");
  assert.deepEqual(
    {
      text: condenser.implant.pointsText,
      min: condenser.implant.pointsMin,
      max: condenser.implant.pointsMax
    },
    { text: "1–5", min: 1, max: 5 }
  );

  for (const name of ["Кости Тролля", "Кожа кракена", "Панцирь кристального левиафана"]) {
    const implant = implants.find((entry) => entry.name === name);
    assert.equal(implant.implant.kind, "magical", name);
    assert.equal(implant.implant.magical, true, name);
  }
});

test("gear normalization and Foundry Item creation preserve implant data", () => {
  const source = loadImplants().find((entry) => entry.name === "Навесная броня");
  const normalized = normalizeEconomyDataset({
    goods: [],
    regions: [],
    cities: [],
    reference: {},
    materials: [],
    gear: [source]
  }).gear[0];

  assert.deepEqual(normalized.implant, source.implant);

  const itemData = createDnd5eItemData(
    normalized,
    new Map([[normalized.foundryFolder, "implant-folder"]])
  );
  assert.equal(itemData.type, "equipment");
  assert.deepEqual(itemData.flags[MODULE_ID].implant, source.implant);
  assert.match(itemData.system.description.value, /Очки модификации/u);
  assert.match(itemData.system.description.value, /Навесная броня|\+1 к КД/u);
});

test("builtin importer merges implants into the ordinary gear pipeline", () => {
  const source = readFileSync(join(MODULE_DIR, "scripts", "data", "importer.js"), "utf8");
  assert.match(source, /implants\.json/u);
  assert.match(source, /gear:\s*\[[\s\S]*Array\.isArray\(gear\)[\s\S]*Array\.isArray\(implants\)/u);
});
