import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    escapeHTML: (value) => String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;"),
    getProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object)
  }
};

globalThis.CONST ??= {
  DOCUMENT_OWNERSHIP_LEVELS: {
    OBSERVER: 2
  }
};

const materialsModule = await import("../scripts/data/materials-compendium.js");
const { normalizeEconomyDataset } = await import("../scripts/data/normalizer.js");
const materials = JSON.parse(readFileSync(new URL("../data/materials.json", import.meta.url), "utf8"));

test("materials compendium exposes item data creation for focused verification", () => {
  assert.equal(typeof materialsModule.createDnd5eItemData, "function");
});

test("material signature and rendered description include applications and alchemy aspects", () => {
  const material = materials.find(({ name }) => name === "Шерсть чудовища");
  const created = materialsModule.createDnd5eItemData(material, new Map());
  const signature = JSON.parse(created.flags["rebreya-main"].signature);
  const html = created.system.description.value;

  assert.deepEqual(signature.applications, material.applications);
  assert.equal(signature.alchemyAspects, material.alchemyAspects);
  assert.deepEqual(created.flags["rebreya-main"].applications, material.applications);
  assert.equal(created.flags["rebreya-main"].alchemyAspects, material.alchemyAspects);
  assert.match(html, /<strong>Усовершенствование:<\/strong> Недоступно/u);
  assert.match(html, /<strong>Создание и снаряжение:<\/strong> Немагическая одежда/u);
  assert.match(html, /<strong>Аспекты \(алхимия\):<\/strong> —/u);
});

test("material rendering retains literal trailing source description whitespace", () => {
  const material = materials.find(({ name }) => name === "Кристаллы забытых Титанов");
  assert.equal(material.description.endsWith(" "), true);

  const created = materialsModule.createDnd5eItemData(material, new Map());
  assert.ok(
    created.system.description.value.includes(`${material.description}</p>`),
    "description is rendered without trimming the source cell"
  );
});

test("null-price and null-weight materials remain creatable and keep nullable metadata", () => {
  const material = materials.find(({ name }) => name === "Кости тролля");
  const created = materialsModule.createDnd5eItemData(material, new Map());
  const flags = created.flags["rebreya-main"];

  assert.equal(created.name, "Кости тролля");
  assert.equal(created.type, "loot");
  assert.equal(flags.materialId, material.id);
  assert.equal(flags.priceGold, null);
  assert.equal(flags.weight, null);
  assert.equal(flags.rank, null);
});

test("sync reuses world.rebreya-materials and indexes all materials for search and open", async () => {
  const material = materials.find(({ name }) => name === "Кости тролля");
  const documents = [];
  let createDocumentsCount = 0;
  let renderCount = 0;
  let createCompendiumCount = 0;
  const documentClass = {
    createDocuments: async (data, options) => {
      createDocumentsCount += 1;
      assert.equal(options.pack, "world.rebreya-materials");
      for (const [index, entry] of data.entries()) {
        documents.push({
          ...entry,
          id: `materialDocument${index + 1}`,
          _id: `materialDocument${index + 1}`,
          getFlag(scope, key) {
            return this.flags?.[scope]?.[key];
          },
          sheet: {
            render: async () => {
              renderCount += 1;
            },
            bringToFront: () => {}
          }
        });
      }
      return documents;
    },
    deleteDocuments: async () => assert.fail("fresh pack has no documents to delete")
  };
  const pack = {
    collection: "world.rebreya-materials",
    documentName: "Item",
    metadata: {
      system: "dnd5e"
    },
    documentClass,
    getDocuments: async () => documents,
    getIndex: async () => documents.map((document) => ({
      _id: document.id,
      name: document.name,
      flags: document.flags
    })),
    getDocument: async (id) => documents.find((document) => document.id === id) ?? null
  };
  const packs = new Map([["world.rebreya-materials", pack]]);
  const gm = { id: "acceptance-gm", isGM: true, active: true };
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousWindow = globalThis.window;
  const previousFoundryDocuments = globalThis.foundry.documents;
  globalThis.game = {
    user: gm,
    users: {
      activeGM: gm
    },
    system: {
      id: "dnd5e"
    },
    packs,
    i18n: {
      localize: (key) => key
    }
  };
  globalThis.foundry.documents = {
    collections: {
      CompendiumCollection: {
        createCompendium: async () => {
          createCompendiumCount += 1;
          throw new Error("sync must reuse the existing materials pack");
        }
      }
    }
  };
  globalThis.ui = {
    notifications: {
      warn: () => assert.fail("material should be found")
    }
  };
  globalThis.window = {
    setTimeout: (callback) => callback()
  };

  try {
    assert.deepEqual(
      { priceGold: material.priceGold, weight: material.weight, rank: material.rank },
      { priceGold: null, weight: null, rank: null }
    );
    const service = new materialsModule.MaterialsCompendiumService();
    const syncedPack = await service.sync(materials);
    const index = await syncedPack.getIndex({
      fields: ["flags.rebreya-main.materialId"]
    });
    const indexEntry = index.find((entry) => (
      globalThis.foundry.utils.getProperty(entry, "flags.rebreya-main.materialId") === material.id
    ));

    assert.equal(syncedPack, pack);
    assert.equal(createCompendiumCount, 0);
    assert.equal(createDocumentsCount, 1);
    assert.equal(packs.size, 1);
    assert.equal(documents.length, materials.length);
    assert.equal(index.length, materials.length);
    assert.ok(indexEntry, "nullable material is present in the index created by sync");
    const document = await pack.getDocument(indexEntry._id);
    assert.equal(await service.openMaterial(material), document);
    assert.equal(renderCount, 1);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.window = previousWindow;
    globalThis.foundry.documents = previousFoundryDocuments;
  }
});

test("normalizer preserves nullable material fields and expanded source metadata", () => {
  const material = {
    id: "nullable-material",
    name: "Nullable Material",
    priceGold: null,
    weight: null,
    rank: null,
    description: "Literal description  ",
    applications: {
      upgrade: "Upgrade  ",
      implant: "",
      crafting: "Crafting",
      alchemy: "Alchemy",
      knowledge: "Knowledge"
    },
    alchemyAspects: "Aspect  ",
    source: {
      spreadsheetId: "sheet",
      sheetName: "tab",
      row: 7
    }
  };

  const normalized = normalizeEconomyDataset({
    goods: [],
    regions: [],
    cities: [],
    materials: [material],
    gear: [],
    reference: {}
  }).materials[0];

  assert.equal(normalized.priceGold, null);
  assert.equal(normalized.weight, null);
  assert.equal(normalized.rank, null);
  assert.equal(normalized.description, material.description);
  assert.deepEqual(normalized.applications, material.applications);
  assert.equal(normalized.alchemyAspects, material.alchemyAspects);
  assert.deepEqual(normalized.source, material.source);
});
