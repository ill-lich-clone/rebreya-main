import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildRaceAdvancement,
  buildRaceFlags,
  findStaleGeneratedDocumentIds
} from "../scripts/data/races-compendium.js";
import { syncFlaggedManagedDocuments } from "../scripts/data/managed-compendium-sync.js";

function makeDocument({
  id,
  name = "Гоблины",
  type = "race",
  managed = true,
  sourceIdFlag = "raceId",
  sourceId = "гоблины",
  signature = "signature",
  sourceCustom = "Расы Тейванкаля V0.1"
}) {
  return {
    id,
    name,
    type,
    system: {
      source: {
        custom: sourceCustom
      }
    },
    getFlag: (scope, key) => {
      if (scope !== "rebreya-main") {
        return undefined;
      }

      if (key === "managed") {
        return managed;
      }

      if (key === sourceIdFlag) {
        return sourceId;
      }

      if (key === "signature") {
        return signature;
      }

      return undefined;
    }
  };
}

test("race compendium delegates managed lifecycle to the shared diff synchronizer", () => {
  const source = readFileSync(new URL("../scripts/data/races-compendium.js", import.meta.url), "utf8");

  assert.match(source, /syncFlaggedManagedDocuments/u);
  assert.doesNotMatch(source, /function shouldRebuildManagedPack/u);
  assert.doesNotMatch(source, /async function deleteManagedDocuments/u);
  assert.doesNotMatch(source, /async function createManagedDocuments/u);
});

test("race signature changes update the stable document without pack-wide deletion", async () => {
  const operations = [];
  const document = makeDocument({
    id: "stableGoblins",
    sourceId: "гоблины",
    signature: "oldSignature"
  });
  document.update = async (patch) => operations.push(["update", patch]);
  const pack = {
    collection: "world.rebreya-races",
    documentClass: {
      async createDocuments(data) {
        operations.push(["create", data]);
      },
      async deleteDocuments(ids) {
        operations.push(["delete", ids]);
      }
    }
  };

  await syncFlaggedManagedDocuments({
    pack,
    entries: [{ raceId: "гоблины", documentId: "stableGoblins", signature: "newSignature" }],
    documents: [document],
    moduleId: "rebreya-main",
    sourceIdFlag: "raceId",
    buildData: (entry) => ({
      _id: entry.documentId,
      name: "Гоблины",
      flags: { "rebreya-main": { signature: entry.signature } }
    })
  });

  assert.deepEqual(operations, [["update", {
    name: "Гоблины",
    flags: { "rebreya-main": { signature: "newSignature" } }
  }]]);
});

test("race pack cleanup finds legacy generated duplicates without managed flags", () => {
  const entries = [
    { raceId: "гоблины", documentId: "stableGoblins", name: "Гоблины", signature: "goblinSignature" }
  ];
  const documents = [
    makeDocument({ id: "legacyDuplicate", managed: false, sourceId: "", name: "Гоблины" }),
    makeDocument({ id: "userNote", managed: false, sourceId: "", name: "Домашняя раса", sourceCustom: "" })
  ];

  assert.deepEqual(findStaleGeneratedDocumentIds(documents, entries, "raceId"), ["legacyDuplicate"]);
});

test("fixed-size races do not show a size advancement step", () => {
  const advancement = buildRaceAdvancement({
    id: "гоблины",
    name: "Гоблины",
    size: "sm",
    fields: {
      size: "Рост гоблинов между 3 и 4 футами. Ваш размер — Маленький.",
      abilityIncrease: "",
      languages: ""
    },
    abilities: [],
    raceFeatNames: []
  });

  assert.equal(advancement.some((entry) => entry.type === "Size"), false);
});

test("variable-size races keep the size advancement step", () => {
  const advancement = buildRaceAdvancement({
    id: "железорождённые",
    name: "Железорождённые",
    size: "med",
    fields: {
      size: "Ваш размер — Средний или Маленький (на ваш выбор).",
      abilityIncrease: "",
      languages: ""
    },
    abilities: [],
    raceFeatNames: []
  });
  const sizeAdvancement = advancement.find((entry) => entry.type === "Size");

  assert.deepEqual(sizeAdvancement.configuration.sizes, ["med", "sm"]);
});

test("generated race flags expose the default two usable hands and race group", () => {
  const flags = buildRaceFlags({
    id: "humans",
    name: "Humans",
    group: "Обычные",
    size: "med",
    automation: null
  }, "signature");

  assert.deepEqual(flags["rebreya-main"].hands, {
    max: 2
  });
  assert.equal(flags["rebreya-main"].raceGroup, "Обычные");
});

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

function expectedAbilityConfig({ fixed = {}, points, cap, allowed = null }) {
  return {
    fixed: Object.fromEntries(ABILITY_KEYS.map((key) => [key, fixed[key] ?? 0])),
    points,
    cap,
    locked: Array.isArray(allowed) ? ABILITY_KEYS.filter((key) => !allowed.includes(key)) : []
  };
}

const EXPECTED_RACE_ABILITY_CONFIGS = {
  люди: [{ points: 2, cap: 2 }],
  дварфы: [{ fixed: { con: 2 }, points: 1, cap: 2, allowed: ["str", "wis"] }],
  полуэльфы: [{ points: 2, cap: 2 }, { points: 2, cap: 1 }],
  "высшие-эльфы": [{ points: 3, cap: 2 }],
  полурослики: [{ points: 3, cap: 2 }],
  полуорки: [{ fixed: { str: 2 }, points: 1, cap: 2, allowed: ["dex", "con", "int", "wis", "cha"] }],
  орки: [{ points: 3, cap: 2 }],
  "лесные-эльфы": [{ fixed: { dex: 2 }, points: 1, cap: 2, allowed: ["str", "con", "int", "wis", "cha"] }],
  "морские-эльфы": [{ points: 3, cap: 2 }],
  кирисан: [{ points: 3, cap: 2 }],
  таргулы: [{ points: 3, cap: 2 }],
  гномы: [{ points: 3, cap: 2 }],
  гоблины: [{ points: 3, cap: 2 }],
  голиафы: [{ points: 3, cap: 2 }],
  драконорождённые: [{ points: 3, cap: 2 }],
  железорождённые: [{ fixed: { con: 2 }, points: 1, cap: 2, allowed: ["str", "dex", "int", "wis", "cha"] }],
  гении: [{ points: 3, cap: 2 }],
  синтеты: [{ points: 3, cap: 2 }],
  дроу: [{ points: 3, cap: 2 }],
  ааракокры: [{ points: 3, cap: 2 }],
  людоящеры: [{ points: 3, cap: 2 }],
  тортлы: [{ points: 3, cap: 2 }],
  багбиры: [{ points: 3, cap: 2 }],
  кобольды: [{ points: 2, cap: 2 }],
  грунги: [{ points: 3, cap: 2 }],
  гноллы: [{ points: 3, cap: 2 }],
  табакси: [{ points: 3, cap: 2 }],
  минотавры: [{ fixed: { con: 2, int: -1 }, points: 2, cap: 2, allowed: ["str", "wis", "cha"] }],
  кентавры: [{ fixed: { wis: 2 }, points: 2, cap: 2, allowed: ["str", "dex"] }],
  леониды: [
    { points: 2, cap: 2, allowed: ["str", "dex"] },
    { points: 2, cap: 2, allowed: ["cha", "int"] }
  ],
  полувеликаны: [{ fixed: { str: 2, dex: -2 }, points: 2, cap: 2, allowed: ["con", "wis"] }],
  нефилимы: [
    { points: 2, cap: 2, allowed: ["int", "cha"] },
    { points: 1, cap: 1, allowed: ["dex", "str"] }
  ],
  пепельные: [{ fixed: { cha: 1 }, points: 2, cap: 2, allowed: ["wis", "dex"] }],
  големы: [{ fixed: { con: 2, int: -1 }, points: 2, cap: 2, allowed: ["str", "wis", "cha"] }]
};

test("all Teyvankal races generate the exact documented ability advancements", () => {
  const source = JSON.parse(readFileSync(
    new URL("../data/races-teyvankal-v01.json", import.meta.url),
    "utf8"
  ));
  assert.equal(source.races.length, 34);
  assert.deepEqual(Object.keys(EXPECTED_RACE_ABILITY_CONFIGS).sort(), source.races.map((race) => race.id).sort());

  for (const race of source.races) {
    const actual = buildRaceAdvancement({
      ...race,
      abilities: [],
      raceFeatNames: []
    })
      .filter((entry) => entry.type === "AbilityScoreImprovement")
      .map((entry) => ({
        fixed: entry.configuration.fixed,
        points: entry.configuration.points,
        cap: entry.configuration.cap,
        locked: entry.configuration.locked
      }));
    const expected = EXPECTED_RACE_ABILITY_CONFIGS[race.id].map(expectedAbilityConfig);
    assert.deepEqual(actual, expected, race.name);
  }
});

test("selectable racial penalties are published only for the four affected races", () => {
  const source = JSON.parse(readFileSync(
    new URL("../data/races-teyvankal-v01.json", import.meta.url),
    "utf8"
  ));
  const expected = {
    кентавры: { amount: 2, allowed: ["int", "cha"] },
    леониды: { amount: 1, allowed: ["wis", "con"] },
    нефилимы: { amount: 2, allowed: ["con", "wis"] },
    пепельные: { amount: 2, allowed: ["con", "str"] }
  };

  for (const race of source.races) {
    assert.deepEqual(
      buildRaceFlags(race)["rebreya-main"].abilityPenaltyChoice,
      expected[race.id],
      race.name
    );
  }
});

test("Нечеловеческая сила raises only the Strength maximum to 22", () => {
  const source = JSON.parse(readFileSync(
    new URL("../data/races-teyvankal-v01.json", import.meta.url),
    "utf8"
  ));
  const halfGiant = source.races.find((race) => race.id === "полувеликаны");
  const feature = halfGiant.abilities.find((ability) => ability.name === "Нечеловеческая сила");
  const changes = feature.automation.effects.map((effect) => ({
    key: effect.key,
    mode: effect.mode,
    value: effect.value,
    transfer: effect.transfer
  }));

  assert.deepEqual(changes, [{
    key: "system.abilities.str.max",
    mode: 4,
    value: "22",
    transfer: true
  }]);
  assert.equal(changes.some((change) => change.key === "system.abilities.str.value"), false);
});

test("Half-Giant publishes one required six-option GiantTribe advancement after its feature grant", () => {
  const source = JSON.parse(readFileSync(
    new URL("../data/races-teyvankal-v01.json", import.meta.url),
    "utf8"
  ));
  const halfGiant = source.races.find((race) => race.id === "полувеликаны");
  const featureUuidById = new Map(halfGiant.abilities.map((ability) => [
    ability.featureId,
    `Compendium.world.race-features.Item.${ability.id}`
  ]));
  const advancement = buildRaceAdvancement(halfGiant, { featureUuidById });
  const grantIndex = advancement.findIndex((entry) => entry.type === "ItemGrant");
  const tribeIndex = advancement.findIndex((entry) => entry.type === "GiantTribe");
  const tribe = advancement[tribeIndex];

  assert.equal(tribeIndex, grantIndex + 1);
  assert.equal(advancement.filter((entry) => entry.type === "GiantTribe").length, 1);
  assert.equal(tribe.level, 0);
  assert.equal(tribe.title, "Великанье племя");
  assert.deepEqual(tribe.configuration.sizes, ["hill", "stone", "frost", "fire", "cloud", "storm"]);
  assert.deepEqual(tribe.value, {});
});

test("Великанье племя source contains no runtime chooser or random choice", () => {
  const source = JSON.parse(readFileSync(
    new URL("../data/races-teyvankal-v01.json", import.meta.url),
    "utf8"
  ));
  const halfGiant = source.races.find((race) => race.id === "полувеликаны");
  const feature = halfGiant.abilities.find((ability) => ability.name === "Великанье племя");

  assert.equal(feature.automation.coverage, "partial");
  assert.deepEqual(feature.automation.effects, []);
  assert.deepEqual(feature.automation.mechanics, ["giant-tribe-advancement"]);
  assert.deepEqual(feature.automation.activities, []);
  assert.doesNotMatch(JSON.stringify(feature), /chooseGiantTribe|случайно определите/u);
});
