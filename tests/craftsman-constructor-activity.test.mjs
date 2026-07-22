import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => structuredClone(value),
    getProperty: (object, path) => String(path).split(".").reduce((value, key) => value?.[key], object)
  }
};
globalThis.CONST ??= { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };

import { CRAFTSMAN_CONSTRUCT_UUID } from "../scripts/constants.js";
import {
  CRAFTSMAN_BODY_ASSEMBLIES,
  CRAFTSMAN_COMBAT_MODES,
  CRAFTSMAN_CONSTRUCT_FEATURE_ID,
  buildCraftsmanConstructSummonAutomation
} from "../scripts/data/craftsman-construct-definitions.js";

const {
  buildFeatureDefinitions,
  createFeatureEntryData,
  normalizeClassCompendiumData
} = await import("../scripts/data/classes-compendium.js");

function source() {
  return JSON.parse(readFileSync(new URL("../data/craftsman-v01.json", import.meta.url), "utf8"));
}

test("Constructor registries contain four body assemblies and ten independent combat modes", () => {
  assert.deepEqual(Object.values(CRAFTSMAN_BODY_ASSEMBLIES).map((entry) => entry.label), [
    "Крепкий корпус", "Мощные руки", "Доводка прицела", "Проводник магии"
  ]);
  assert.deepEqual(Object.values(CRAFTSMAN_COMBAT_MODES).map((entry) => entry.label), [
    "Дуэлянт", "Защита", "Сражение в лёгком доспехе", "Сражение в массивных доспехах",
    "Сражение большим оружием", "Сражение двумя оружиями", "Стрельба", "Сражение вслепую",
    "Перехват", "Граничащий потенциал"
  ]);
});

test("construct assembly contains one dnd5e 5.2.5 Summon Activity and one profile", () => {
  const automation = buildCraftsmanConstructSummonAutomation({ description: "Точное описание" });
  const activities = Object.values(automation.activities);
  assert.equal(activities.length, 1);
  const activity = activities[0];
  assert.equal(activity.type, "summon");
  assert.equal(activity.profiles.length, 1);
  assert.equal(activity.profiles[0].uuid, CRAFTSMAN_CONSTRUCT_UUID);
  assert.deepEqual(activity.visibility, { identifier: "craftsman-v01", level: { min: 3, max: null } });
  assert.deepEqual(activity.bonuses, {
    ac: "@prof",
    hd: "@classes.craftsman-v01.levels",
    hp: "5 * @classes.craftsman-v01.levels",
    attackDamage: "",
    saveDamage: "",
    healing: ""
  });
  assert.deepEqual(activity.creatureSizes, ["med"]);
  assert.deepEqual(activity.creatureTypes, ["construct"]);
  assert.deepEqual(activity.match, {
    ability: "", attacks: false, disposition: true, proficiency: true, saves: false
  });
  assert.equal(activity.summon.prompt, true);
  assert.equal(activity.flags["rebreya-main"].craftsmanConstructor.kind, "constructSummon");
});

test("final generated Construct Assembly Item receives the one native Summon Activity", () => {
  const normalized = normalizeClassCompendiumData(source());
  const feature = buildFeatureDefinitions(normalized)
    .find((entry) => entry.featureId === CRAFTSMAN_CONSTRUCT_FEATURE_ID);
  assert.ok(feature);
  const item = createFeatureEntryData(feature, new Map([[feature.folderPath.join("/"), null]]));
  const activities = Object.values(item.system.activities);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].type, "summon");
  assert.equal(activities[0].profiles[0].uuid, CRAFTSMAN_CONSTRUCT_UUID);
});
