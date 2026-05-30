import test from "node:test";
import assert from "node:assert/strict";

import {
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
