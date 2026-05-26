import test from "node:test";
import assert from "node:assert/strict";

import { deduplicateCompendiumFolders } from "../scripts/data/compendium-utils.js";

function createPackFixture() {
  const folders = [
    { id: "firearms-a", name: "Огнестрельное оружие", folder: null, sort: 10 },
    { id: "primitive-a", name: "Примитивное", folder: "firearms-a", sort: 20 },
    { id: "advanced-a", name: "Продвинутое", folder: "firearms-a", sort: 30 },
    { id: "firearms-b", name: "Огнестрельное оружие", folder: null, sort: 40 },
    { id: "primitive-b", name: "Примитивное", folder: "firearms-b", sort: 50 },
    { id: "advanced-b", name: "Продвинутое", folder: "firearms-b", sort: 60 }
  ];
  const documents = [
    { id: "flintlock", folder: "primitive-b" },
    { id: "rifle", folder: "advanced-b" }
  ];

  for (const folder of folders) {
    folder.delete = async () => {
      const index = folders.findIndex((entry) => entry.id === folder.id);
      if (index >= 0) {
        folders.splice(index, 1);
      }
    };
  }

  return {
    folders,
    documents,
    pack: {
      collection: "world.test-gear",
      folders: { contents: folders },
      getDocuments: async () => documents
    }
  };
}

test("deduplicates nested compendium folders after merging duplicate parents", async () => {
  const originalFolder = globalThis.Folder;
  const originalItem = globalThis.Item;
  const { folders, documents, pack } = createPackFixture();

  globalThis.Folder = {
    updateDocuments: async (updates) => {
      for (const update of updates) {
        const folder = folders.find((entry) => entry.id === update._id);
        if (folder) {
          folder.folder = update.folder;
        }
      }
    }
  };
  globalThis.Item = {
    implementation: {
      updateDocuments: async (updates) => {
        for (const update of updates) {
          const document = documents.find((entry) => entry.id === update._id);
          if (document) {
            document.folder = update.folder;
          }
        }
      }
    }
  };

  try {
    const result = await deduplicateCompendiumFolders(pack, [
      "Огнестрельное оружие",
      "Примитивное",
      "Продвинутое"
    ]);

    assert.equal(result.removed, 3);
    assert.deepEqual(
      folders.map((folder) => [folder.id, folder.name, folder.folder]),
      [
        ["firearms-a", "Огнестрельное оружие", null],
        ["primitive-a", "Примитивное", "firearms-a"],
        ["advanced-a", "Продвинутое", "firearms-a"]
      ]
    );
    assert.deepEqual(
      documents.map((document) => [document.id, document.folder]),
      [
        ["flintlock", "primitive-a"],
        ["rifle", "advanced-a"]
      ]
    );
  }
  finally {
    globalThis.Folder = originalFolder;
    globalThis.Item = originalItem;
  }
});
