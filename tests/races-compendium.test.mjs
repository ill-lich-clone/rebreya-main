import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRaceAdvancement,
  buildRaceFlags,
  findStaleGeneratedDocumentIds,
  shouldRebuildManagedPack
} from "../scripts/data/races-compendium.js";

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

test("race pack rebuild detects duplicate managed source ids even when counts match", () => {
  const entries = [
    { raceId: "гоблины", documentId: "stableGoblins", signature: "goblinSignature" },
    { raceId: "гномы", documentId: "stableGnomes", signature: "gnomeSignature" }
  ];
  const documents = [
    makeDocument({ id: "oldA", sourceId: "гоблины", signature: "goblinSignature" }),
    makeDocument({ id: "oldB", sourceId: "гоблины", signature: "goblinSignature" })
  ];

  assert.equal(shouldRebuildManagedPack(documents, entries, "raceId"), true);
});

test("race pack rebuild migrates managed race documents to stable document ids", () => {
  const entries = [
    { raceId: "гоблины", documentId: "stableGoblins", signature: "goblinSignature" }
  ];
  const documents = [
    makeDocument({ id: "randomOldId", sourceId: "гоблины", signature: "goblinSignature" })
  ];

  assert.equal(shouldRebuildManagedPack(documents, entries, "raceId"), true);
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

test("generated race flags expose the default two usable hands", () => {
  const flags = buildRaceFlags({
    id: "humans",
    name: "Humans",
    size: "med",
    automation: null
  }, "signature");

  assert.deepEqual(flags["rebreya-main"].hands, {
    max: 2
  });
});
