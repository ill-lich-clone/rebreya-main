import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    getProperty: (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object)
  }
};

globalThis.CONST ??= {
  DOCUMENT_OWNERSHIP_LEVELS: {
    OBSERVER: 2
  }
};

const {
  buildClassAdvancement,
  buildFeatureDefinitions,
  createFeatureEntryData,
  normalizeClassCompendiumData
} = await import("../scripts/data/classes-compendium.js");

function loadJson(path) {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8").replace(/^\uFEFF/u, ""));
}

function makeUuidMap(definitions) {
  return new Map(definitions.map((definition) => [definition.featureId, `Compendium.world.rebreya-class-features.Item.${definition.identifier}`]));
}

test("fighter data defines dominance dice, fighting styles, maneuvers, and subclasses", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));

  assert.equal(fighter.classData.identifier, "fighter-rework-v028");
  assert.equal(fighter.classData.hitDie, "d10");
  assert.equal(fighter.classData.features.some((feature) => feature.name === "Стиль доминирования"), true);
  assert.equal(fighter.fightingStyles.length, 12);
  assert.equal(fighter.maneuvers.length, 24);
  assert.equal(fighter.subclasses.length, 9);
  assert.deepEqual(fighter.dominanceProgression, {
    dice: { "1": 2, "5": 3, "9": 4, "13": 5, "17": 6 },
    die: { "1": "d4", "9": "d6", "16": "d8" }
  });
});

test("fighter advancements expose dominance scales and a fighting style choice", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const featureDefinitions = buildFeatureDefinitions(fighter);
  const advancement = buildClassAdvancement(fighter.classData, {
    featureUuidById: makeUuidMap(featureDefinitions),
    classFeatureEntries: fighter.classData.features,
    minorFeatUuids: ["Compendium.world.rebreya-feats.Item.minor"],
    maneuverEntries: fighter.maneuvers,
    fightingStyleEntries: fighter.fightingStyles,
    dominanceProgression: fighter.dominanceProgression
  });

  const dominanceDice = advancement.find((entry) => entry.type === "ScaleValue" && entry.configuration.identifier === "dominance-dice");
  const dominanceDie = advancement.find((entry) => entry.type === "ScaleValue" && entry.configuration.identifier === "dominance-die");
  const styleChoice = advancement.find((entry) => entry.type === "ItemChoice" && entry.title === "Боевой стиль");

  assert.equal(dominanceDice.configuration.type, "number");
  assert.deepEqual(dominanceDice.configuration.scale["17"], { value: 6 });
  assert.equal(dominanceDie.configuration.type, "dice");
  assert.deepEqual(dominanceDie.configuration.scale["16"], { number: null, faces: 8, modifiers: [] });
  assert.equal(styleChoice.level, 1);
  assert.equal(styleChoice.configuration.choices["1"].count, 1);
  assert.equal(styleChoice.configuration.pool.length, 12);
});

test("fighter maneuvers consume the shared dominance dice item by identifier", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const maneuver = buildFeatureDefinitions(fighter).find((definition) => definition.sourceType === "fighterManeuver");
  const entry = createFeatureEntryData(maneuver, new Map());
  const activity = Object.values(entry.system.activities)[0];

  assert.equal(entry.flags["rebreya-main"].sourceType, "fighterManeuver");
  assert.deepEqual(activity.consumption.targets, [{
    type: "itemUses",
    target: "fighter-dominance",
    value: "1",
    scaling: {
      mode: "",
      formula: ""
    }
  }]);
  assert.match(activity.description.chatFlavor, /@scale\.fighter-rework-v028\.dominance-die/u);
});
