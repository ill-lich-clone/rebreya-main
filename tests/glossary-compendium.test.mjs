import test from "node:test";
import assert from "node:assert/strict";

import { createStableGearDocumentId } from "../scripts/data/gear-document-ids.js";
import { STATUS_REFERENCE_DATA } from "../scripts/data/status-reference-data.js";
import {
  GlossaryCompendiumService,
  normalizeGlossaryEntries
} from "../scripts/data/glossary-compendium.js";

const MODULE_ID = "rebreya-main";

test("glossary entries merge sheet terms and statuses with stable item ids", () => {
  const entries = normalizeGlossaryEntries({
    terms: [{
      termId: "heavy",
      name: "Тяжёлое",
      description: "Свойство оружия.",
      section: "Свойства оружия",
      aliases: []
    }],
    statuses: STATUS_REFERENCE_DATA,
    statusLabels: new Map([
      ["prone", "Сбитый с ног"],
      ["bloodied", "Окровавленный"]
    ])
  });
  const prone = entries.find((entry) => entry.name === "Сбитый с ног");

  assert.equal(prone.documentId, createStableGearDocumentId("glossary:status:prone"));
  assert.ok(prone.aliases.includes("Лежащий ничком"));
  assert.equal(entries.find((entry) => entry.name === "Тяжёлое").folderPath.join("/"), "Свойства оружия");
});

test("glossary normalization rejects colliding canonical names and aliases", () => {
  assert.throws(() => normalizeGlossaryEntries({
    terms: [
      { termId: "one", name: "Размах", description: "Первый.", section: "Свойства оружия", aliases: [] },
      { termId: "two", name: "Иное", description: "Второй.", section: "Свойства оружия", aliases: [" размах "] }
    ],
    statuses: {},
    statusLabels: new Map()
  }), /duplicate glossary lookup.*размах/iu);
});

test("glossary sync creates observer feat cards once and updates stale managed data in place", async () => {
  const previous = {
    game: globalThis.game,
    foundry: globalThis.foundry,
    Folder: globalThis.Folder,
    CONST: globalThis.CONST,
    CONFIG: globalThis.CONFIG
  };
  const documents = [];
  const folders = [];
  const createBatches = [];
  const packMetadata = [];
  const pack = {
    collection: "world.rebreya-glossary",
    documentName: "Item",
    metadata: { system: "dnd5e" },
    folders: { contents: folders },
    async getDocuments() {
      return documents;
    }
  };
  pack.documentClass = {
    async createDocuments(data, options) {
      assert.deepEqual(options, { pack: pack.collection, keepId: true });
      createBatches.push(data);
      for (const source of data) {
        const document = {
          ...structuredClone(source),
          id: source._id,
          getFlag(scope, key) {
            return this.flags?.[scope]?.[key];
          },
          async update(update) {
            Object.assign(this, structuredClone(update));
          }
        };
        documents.push(document);
      }
      return documents;
    },
    async deleteDocuments() {
      assert.fail("no glossary document should be deleted");
    }
  };
  const packs = new Map();
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
  globalThis.CONFIG = {
    statusEffects: [{ id: "prone", name: "Сбитый с ног" }]
  };
  globalThis.game = {
    user: gm,
    users: { activeGM: gm, contents: [gm] },
    system: { id: "dnd5e" },
    packs,
    i18n: { localize: (value) => value }
  };
  globalThis.foundry = {
    documents: {
      collections: {
        CompendiumCollection: {
          async createCompendium(metadata) {
            packMetadata.push(metadata);
            packs.set(pack.collection, pack);
            return pack;
          }
        }
      }
    }
  };
  globalThis.Folder = {
    async create(data, options) {
      assert.equal(options.pack, pack.collection);
      const folder = { ...data, id: `folder-${folders.length + 1}` };
      folders.push(folder);
      return folder;
    }
  };

  try {
    const service = new GlossaryCompendiumService({
      loadCatalog: async () => ({
        schemaVersion: 1,
        source: { sheetTitle: "Глоссарий 0.1" },
        terms: [{
          termId: "heavy",
          name: "Тяжёлое",
          description: "Свойство оружия.",
          section: "Свойства оружия",
          sourceLabel: "PHB+",
          aliases: []
        }]
      }),
      statuses: { prone: STATUS_REFERENCE_DATA.prone }
    });

    await service.sync();
    assert.equal(packMetadata[0].ownership.PLAYER, "OBSERVER");
    assert.deepEqual(new Set(folders.map((folder) => folder.name)), new Set(["Состояния", "Свойства оружия"]));
    assert.equal(documents.length, 2);
    assert.equal(createBatches.length, 1);
    for (const document of documents) {
      assert.equal(document.type, "feat");
      assert.equal(document.ownership.default, 2);
      assert.equal(document.flags[MODULE_ID].managed, true);
      assert.ok(document.flags[MODULE_ID].glossaryTermId);
      assert.deepEqual(document.system.activities, {});
      assert.deepEqual(document.effects, []);
    }

    const prone = documents.find((document) => document.name === "Сбитый с ног");
    const originalId = prone.id;
    prone.system.activities = { stale: { type: "utility" } };
    let updateCount = 0;
    prone.update = async function update(data) {
      updateCount += 1;
      Object.assign(this, structuredClone(data));
    };

    await service.sync();
    assert.equal(createBatches.length, 1);
    assert.equal(documents.length, 2);
    assert.equal(updateCount, 1);
    assert.equal(prone.id, originalId);
  }
  finally {
    globalThis.game = previous.game;
    globalThis.foundry = previous.foundry;
    globalThis.Folder = previous.Folder;
    globalThis.CONST = previous.CONST;
    globalThis.CONFIG = previous.CONFIG;
  }
});
