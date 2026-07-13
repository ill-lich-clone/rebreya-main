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
