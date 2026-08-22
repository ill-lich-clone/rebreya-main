import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  adaptWeaponProfiles,
  parseFirearmProfile,
  parseWeaponProperties
} from "../tools/equipment-import/adapters/weapons.mjs";

const fixtureRoot = new URL("./fixtures/equipment-import/", import.meta.url);
const raw = JSON.parse(await readFile(new URL("weapons-raw.json", fixtureRoot), "utf8"));
const expected = JSON.parse(await readFile(new URL("weapons-expected.json", fixtureRoot), "utf8"));

function referenceIndex({ omit = "" } = {}) {
  const references = [
    ["Оружие V0.36!A4", "оружие|боевой посох", "boevoy-posokh"],
    ["Огнестрел V0.36!A5", "огнестрельное оружие|кремневый пистолет", "kremnevyy-pistolet"]
  ].filter(([sourceRef]) => sourceRef !== omit);
  const gearBySourceRef = new Map(references.map(([sourceRef, sourceKey]) => [sourceRef, { sourceRef, sourceKey }]));
  const stableIds = new Map(references.map(([sourceRef, , stableId]) => [sourceRef, stableId]));
  return {
    gearBySourceRef,
    resolveStableGearId(reference) {
      return stableIds.get(reference.sourceRef);
    }
  };
}

function staffRow(snapshot) {
  return snapshot.weapons.rows.find((row) => row.sourceIdentity === "Боевой посох");
}

test("weapon adapter deep-compares current staff and complete firearm profiles", () => {
  const fragments = adaptWeaponProfiles({ snapshots: raw, referenceIndex: referenceIndex(), diagnostics: [] });

  assert.deepEqual(Object.fromEntries(fragments), expected);
  assert.equal(Object.hasOwn(fragments.get("boevoy-posokh").weapon, "firearmClass"), false);
  assert.equal(fragments.get("kremnevyy-pistolet").weapon.lichWeaponPropertyValues.inventionYear, 270);
});

test("explicit property maps reject an unknown structured weapon property", () => {
  assert.throws(
    () => parseWeaponProperties({ "Количество рук": "Одноручное", "Тип по весу": "Сверхлёгкое" }, { sheetKey: "weapons", rowNumber: 10 }),
    (error) => error.diagnostics?.[0]?.code === "unknown-weapon-property"
  );
});

test("weapon adapter rejects impossible ranges and malformed complete dice formulas", () => {
  const badRange = structuredClone(raw);
  staffRow(badRange).cells["Дистанция. (Дис.)"] = "Дис. 90/30";
  assert.throws(
    () => adaptWeaponProfiles({ snapshots: badRange, referenceIndex: referenceIndex(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "invalid-long-range")
  );

  const badDice = structuredClone(raw);
  staffRow(badDice).cells.Урон = "1d6 мусор";
  assert.throws(
    () => adaptWeaponProfiles({ snapshots: badDice, referenceIndex: referenceIndex(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "invalid-damage-formula")
  );
});

test("weapon adapter accepts the complete Foundry keep-high dice modifier used by the sheet", () => {
  const keepHigh = structuredClone(raw);
  staffRow(keepHigh).cells.Урон = "2d8kh1";
  const fragments = adaptWeaponProfiles({ snapshots: keepHigh, referenceIndex: referenceIndex(), diagnostics: [] });
  assert.equal(fragments.get("boevoy-posokh").weapon.damageFormula, "2d8kh1");
});

test("weapon adapter requires an exact source-coordinate reference", () => {
  assert.throws(
    () => adaptWeaponProfiles({
      snapshots: raw,
      referenceIndex: referenceIndex({ omit: "Огнестрел V0.36!A5" }),
      diagnostics: []
    }),
    (error) => error.diagnostics?.[0]?.code === "missing-equipment-reference"
  );
});

test("firearm-only fields are rejected on a non-firearm row", () => {
  const invalid = structuredClone(raw);
  staffRow(invalid).cells.Осечка = "3";
  assert.throws(
    () => adaptWeaponProfiles({ snapshots: invalid, referenceIndex: referenceIndex(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "firearm-field-on-weapon")
  );
});

test("firearm parser preserves every declared typed value", () => {
  const row = structuredClone(raw.firearms.rows[1]);
  Object.assign(row.cells, {
    "Свойство боеприпасов": "Разброс (1d4)",
    "Тип стрельбы": "Автоматический (6d4)",
    "Минимальная сила": "13",
    "Различие конструкции": "Громоздкое",
    "Внезапность": "2к6",
    "Дополнительные свойства": "Перегрев (6), Особое"
  });
  const profile = parseFirearmProfile(row, {
    sheetKey: "firearms",
    range: raw.firearms.range,
    firearmClass: "advanced"
  });

  assert.deepEqual(profile.lichWeaponPropertyValues, {
    inventionYear: 270,
    misfire: 3,
    ammunition: "Мушкетные",
    ammoProperty: "Разброс (1d4)",
    scatterDamage: "1d4",
    fireMode: "Автоматический (6d4)",
    automaticDamage: "6d4",
    reload: "Перезарядка 1",
    minStrength: 13,
    construction: "Громоздкое",
    surpriseDamage: "2d6",
    overheat: 6
  });
  assert.deepEqual(profile.properties, [
    "amm", "lchFirearmWaterVulnerability", "lchFirearmMisfire", "lchFirearmAmmunition",
    "lchFirearmAmmoProperty", "lchFirearmScatter", "lchFirearmFireMode", "lchFirearmAutomatic",
    "lchFirearmReload", "lchStrReq", "lchFirearmConstruction", "lchFirearmBulky",
    "lchFirearmSurprise", "lchFirearmOverheat", "spc"
  ]);
});

test("firearm parser accepts the exact descriptive rocket-launcher rule without treating prose as tokens", () => {
  const row = structuredClone(raw.firearms.rows[1]);
  row.cells.Урон = "Особое";
  row.cells["Тип урона"] = "Особое";
  row.cells.Дальность = "Особое";
  row.cells["Дополнительные свойства"] = "Ручница использует ракетные боеприпасы, урон и цена которых зависит от типа боеприпаса";
  const profile = parseFirearmProfile(row, {
    sheetKey: "firearms",
    range: raw.firearms.range,
    firearmClass: "advanced"
  });
  assert.match(profile.propertiesText, /Ручница использует ракетные боеприпасы; урон и цена/);
  assert.equal(profile.properties.includes("spc"), false);
  assert.equal(profile.damageFormula, "");
  assert.equal(profile.range, null);
});
