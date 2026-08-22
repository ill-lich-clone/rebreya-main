import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { MAGIC_ITEMS } from "../magicItem.js";
import { GENERATED_CATALOG_PATHS } from "../tools/equipment-import/pipeline.mjs";
import { validateEquipmentOverrides } from "../tools/equipment-import/overrides.mjs";
import { parseCurrentEquipmentBundle } from "../tools/equipment-import/serialization.mjs";

const readJson = async (relative) => JSON.parse(await readFile(new URL(`../${relative}`, import.meta.url), "utf8"));
const [gear, upgrades, materials, implants, transport, rawOverrides] = await Promise.all([
  readJson("data/gear.json"),
  readJson("data/upgrades.json"),
  readJson("data/materials.json"),
  readJson("data/implants.json"),
  readJson("data/rebreya-transport-v01.json"),
  readJson("data/equipment-import-overrides.json")
]);
const overrides = validateEquipmentOverrides(rawOverrides);

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

test("tracked generated catalogs parse and stable IDs match migrated overrides", async () => {
  const filesByPath = new Map();
  for (const relative of Object.values(GENERATED_CATALOG_PATHS)) {
    filesByPath.set(relative, await readFile(new URL(`../${relative}`, import.meta.url), "utf8"));
  }
  const parsed = parseCurrentEquipmentBundle({ filesByPath });
  assert.equal(parsed.catalogs.gear.length, gear.length);
  assert.equal(parsed.catalogs.magicItems.length, MAGIC_ITEMS.length);

  const expectations = [
    ["gear", gear.map((item) => item.id)],
    ["materials", materials.map((item) => item.id)],
    ["implants", implants.map((item) => item.id)],
    ["transport", transport.map((item) => item.sourceId)],
    ["magicItems", MAGIC_ITEMS.map((item, index) => item.id ?? Object.values(overrides.identities.magicItems)[index]?.id)]
  ];
  for (const [catalog, ids] of expectations) {
    const migrated = Object.values(overrides.identities[catalog] ?? {}).map((entry) => entry.id);
    assert.equal(migrated.length, ids.length, `${catalog} override count`);
    assert.deepEqual(new Set(migrated), new Set(ids), `${catalog} override IDs`);
    unique(migrated, `${catalog} IDs`);
  }
});

test("tracked catalogs preserve representative runtime fields and typed regressions", () => {
  const byGearName = new Map(gear.map((item) => [item.name, item]));
  const expectedWeights = {
    "Арбалетные болты (20)": 1.5,
    "Снаряды для пращи (20)": 1.5,
    "Зелье лечения 1-го уровня": 0.5,
    "Зеркало, стальное": 0.5,
    "Мешок": 0.5,
    "Шлямбур": 0.25,
    "Дротик": 0.25,
    "Праща": 0,
    "Миниатюрный портрет в медальоне": 0.5,
    "Карманные часы латунные": 0.5,
    "Карманные часы серебряные": 0.5,
    "Карманные часы золотые": 0.5,
    "Карманные часы мастера": 0.5,
    "Резная табакерка": 0.5,
    "Платиновые карманные часы двора": 0.5,
    "Брошюра": 0.25,
    "Товарный каталог": 0.5,
    "Типовые бланки (20)": 0.5,
    "Настенный календарь": 0.5,
    "Карта города, печатная": 0.5,
    "Карманный справочник": 0.5,
    "Бензин (1 галлон)": 6.2,
    "Керосин (1 галлон)": 6.8,
    "Дизель (1 галлон)": 7.1,
    "Мазут (1 галлон)": 8.4
  };
  for (const [name, weight] of Object.entries(expectedWeights)) {
    assert.equal(byGearName.get(name)?.weight, weight, name);
  }
  assert.match(byGearName.get("Боевой посох")?.weapon?.damageFormula ?? "", /^1d6$/u);
  assert.equal(byGearName.get("Кремневый пистолет")?.firearmClass, "primitive");
  assert.equal(byGearName.get("Стёганый доспех")?.armor?.baseItem, "padded");

  assert.ok(materials.some((item) => item.id && item.name && item.source?.row));
  assert.ok(implants.some((item) => item.name === "Навесная броня" && item.implant?.pointsMin === 1));
  assert.ok(transport.some((item) => item.name === "Гражданский автомобиль" && item.consumption && item.travelSpeed));
  assert.ok(MAGIC_ITEMS.some((item) => item.name === "Аметистовый магнетит" && item.description && item.value > 0));
});

test("tracked cross-catalog material and upgrade references resolve", () => {
  const gearIds = new Set(gear.map((item) => item.id));
  const materialIds = new Set(materials.map((item) => item.id));
  for (const item of gear) {
    if (item.predominantMaterialId) assert.equal(materialIds.has(item.predominantMaterialId), true, item.id);
  }
  for (const item of upgrades) {
    assert.equal(gearIds.has(item.productId), true, item.productId);
    if (item.upgrade?.sourceMaterialId) {
      assert.equal(materialIds.has(item.upgrade.sourceMaterialId), true, item.upgrade.sourceMaterialId);
    }
  }
});
