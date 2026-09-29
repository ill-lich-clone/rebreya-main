import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AlchemyCompendiumService,
  buildAlchemyDescriptionHtml,
  buildAlchemyFolderPath,
  buildAlchemySignature,
  createAlchemyItemData,
  resolveAlchemyConsumableSubtype
} from "../scripts/data/alchemy-compendium.js";
import {
  buildAlchemyActivities,
  buildAlchemyConsumableUses,
  getAlchemyAutomationDefinition
} from "../scripts/data/alchemy-automation.js";
import { getAlchemyTypeRules } from "../scripts/data/alchemy-product-rules.js";
import { createStableGearDocumentId } from "../scripts/data/gear-document-ids.js";

const MODULE_ID = "rebreya-main";
const productionCatalog = JSON.parse(
  await readFile(new URL("../data/alchemy-products.json", import.meta.url), "utf8")
);

function product(overrides = {}) {
  return {
    id: "alchemy-1",
    sourceNumber: 1,
    name: "Взрывное зелье",
    productType: "Зелье",
    priceFormula: "(1d6+1) * 5",
    priceMaximumGp: 35,
    rank: 1,
    reagentLevel: 2,
    effect: "Основной эффект",
    catalystEffect: "Усиленный эффект",
    aspects: {
      fire: 15,
      water: null,
      earth: 0,
      air: null,
      positive: 2,
      negative: null
    },
    mandatoryComponent: "Компонент",
    craftingDc: 14,
    privateCatalyst: "Катализатор",
    activation: "Действие",
    duration: "1 минута",
    requirements: "Требование",
    simplifiedCreation: "Упрощённое создание",
    radiusOrEmanation: "10 футов",
    rarity: "common",
    weight: 1,
    icon: "templates/icons/Alchemy/1-vzryvnoe-zel-e.webp",
    topDownImage: "assets/top-down/items/alchemy/1-vzryvnoe-zel-e.webp",
    sourceRef: "Алхимические продукты V1!A3",
    ...overrides
  };
}

function flagOf(document, key) {
  return document.flags?.[MODULE_ID]?.[key];
}

function makeDocument(data) {
  const document = structuredClone(data);
  document.id = document._id ?? document.id;
  document.getFlag = (scope, key) => document.flags?.[scope]?.[key];
  document.update = async (update) => {
    const replacementSystem = update["==system"];
    const cloned = structuredClone(update);
    if (cloned.system && !replacementSystem) {
      document.system = {
        ...(document.system ?? {}),
        ...cloned.system,
        activities: {
          ...(document.system?.activities ?? {}),
          ...(cloned.system.activities ?? {})
        }
      };
      delete cloned.system;
    }
    for (const key of Object.keys(cloned)) {
      if (key.startsWith("system.activities.-=")) {
        delete document.system.activities[key.slice("system.activities.-=".length)];
        delete cloned[key];
      }
    }
    Object.assign(document, cloned);
    if (replacementSystem) document.system = structuredClone(replacementSystem);
    delete document["==system"];
  };
  document.deleteEmbeddedDocuments = async (documentName, ids) => {
    assert.equal(documentName, "ActiveEffect");
    document.effects = (document.effects ?? []).filter((effect) => !ids.includes(effect._id ?? effect.id));
  };
  return document;
}

test("alchemy rules and dnd5e subtype mapping preserve exact source types", () => {
  const validTypes = new Set(["potion", "poison", "food", "trinket"]);
  const expected = new Map([
    ["Зелье", "potion"],
    ["Масло", "potion"],
    ["Вещество", "food"],
    ["Бомба", "trinket"],
    ["Побочный продукт", "trinket"],
    ["Яд (Оружейный)", "poison"],
    ["Яд (Поглощаемый)", "poison"],
    ["Яд (Вдыхаемый)", "poison"],
    ["Яд (Контактный)", "poison"]
  ]);

  for (const [sourceType, subtype] of expected) {
    assert.equal(resolveAlchemyConsumableSubtype(sourceType, validTypes), subtype, sourceType);
    const rules = getAlchemyTypeRules(sourceType);
    assert.ok(rules.length > 0, sourceType);
    assert.ok(rules.every((rule) => typeof rule === "string" && rule.trim()), sourceType);
  }

  assert.equal(resolveAlchemyConsumableSubtype("Зелье", { poison: {}, trinket: {} }), "trinket");
  assert.equal(resolveAlchemyConsumableSubtype("Зелье", ["poison"]), "poison");
  assert.throws(() => resolveAlchemyConsumableSubtype("Неизвестно", validTypes), /Неизвестный тип/iu);
});

test("alchemy folders retain product and poison subtype hierarchy", () => {
  const cases = [
    ["Зелье", ["Зелья", "Ранг 4"]],
    ["Масло", ["Масла", "Ранг 4"]],
    ["Вещество", ["Вещества", "Ранг 4"]],
    ["Бомба", ["Бомбы", "Ранг 4"]],
    ["Побочный продукт", ["Побочные продукты", "Ранг 4"]],
    ["Яд (Оружейный)", ["Яды", "Оружейные", "Ранг 4"]],
    ["Яд (Поглощаемый)", ["Яды", "Поглощаемые", "Ранг 4"]],
    ["Яд (Вдыхаемый)", ["Яды", "Вдыхаемые", "Ранг 4"]],
    ["Яд (Контактный)", ["Яды", "Контактные", "Ранг 4"]]
  ];

  for (const [productType, expected] of cases) {
    assert.deepEqual(buildAlchemyFolderPath(product({ productType, rank: 4 })), expected);
  }
});

test("alchemy description escapes source text and exposes the complete non-empty recipe in stable order", () => {
  const value = product({
    effect: "Эффект <script>alert(1)</script>",
    catalystEffect: "Катализатор & усиление",
    requirements: "<img src=x onerror=alert(1)>",
    mandatoryComponent: "Клык <дракона>",
    privateCatalyst: "Секретов нет",
    productType: "Вещество"
  });
  const html = buildAlchemyDescriptionHtml(value);

  assert.match(html, /^<section class="rebreya-gear-item">/u);
  assert.doesNotMatch(html, /<script|<img/iu);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /Катализатор &amp; усиление/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.match(html, /\(1d6\+1\) \* 5 ЗМ/u);
  assert.match(html, /Огонь[\s\S]*15/u);
  assert.match(html, /Земля[\s\S]*0/u);
  assert.match(html, /Позитивная энергия[\s\S]*2/u);
  assert.match(html, /Клык &lt;дракона&gt;/u);
  assert.match(html, /Частный катализатор[\s\S]*Секретов нет/u);
  assert.doesNotMatch(html, /Правила|Зависимость от веществ/u);

  const ordered = [
    "Эффект",
    "Эффект катализатора",
    "Активация",
    "Длительность",
    "Требования",
    "Зона",
    "Цена",
    "Уровень реагентов",
    "Огонь",
    "Земля",
    "Позитивная энергия",
    "Обязательный компонент",
    "Сл создания",
    "Частный катализатор",
    "Упрощённое создание"
  ];
  let cursor = -1;
  for (const marker of ordered) {
    const next = html.indexOf(marker);
    assert.ok(next > cursor, `${marker} should follow the preceding section`);
    cursor = next;
  }

  const sparse = buildAlchemyDescriptionHtml(product({
    catalystEffect: null,
    requirements: null,
    radiusOrEmanation: null,
    mandatoryComponent: null,
    craftingDc: null,
    privateCatalyst: null,
    simplifiedCreation: null,
    aspects: { fire: null, water: null, earth: null, air: null, positive: null, negative: null }
  }));
  assert.doesNotMatch(sparse, /Эффект катализатора|Требования|Зона|Обязательный компонент|Сл создания|Частный катализатор|Упрощённое создание/u);
});

test("alchemy Item projection uses maximum price, rank weight, selective automation, and complete managed flags", () => {
  const previousConst = globalThis.CONST;
  const previousConfig = globalThis.CONFIG;
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
  globalThis.CONFIG = {
    DND5E: { consumableTypes: { potion: {}, poison: {}, food: {}, trinket: {} } }
  };

  try {
    const value = product();
    const folderPath = buildAlchemyFolderPath(value).join("/");
    const data = createAlchemyItemData(value, new Map([[folderPath, "folder-1"]]));
    const flags = data.flags[MODULE_ID];

    assert.equal(data._id, createStableGearDocumentId("alchemy-product:alchemy-1"));
    assert.equal(data.name, value.name);
    assert.equal(data.type, "consumable");
    assert.equal(data.img, `modules/${MODULE_ID}/${value.icon}`);
    assert.equal(data.folder, "folder-1");
    assert.equal(data.ownership.default, 2);
    assert.deepEqual(data.system.price, { value: 35, denomination: "gp" });
    assert.deepEqual(data.system.weight, { value: 1, units: "lb" });
    assert.equal(data.system.rarity, "common");
    assert.deepEqual(data.system.type, { value: "potion", subtype: "" });
    assert.deepEqual(data.system.activities, {});
    assert.equal(data.system.uses, undefined);
    assert.deepEqual(data.effects, []);
    assert.deepEqual(flags, {
      managed: true,
      sourceType: "alchemyProduct",
      alchemyProductId: "alchemy-1",
      sourceNumber: 1,
      sourceRef: "Алхимические продукты V1!A3",
      productType: "Зелье",
      rank: 1,
      reagentLevel: 2,
      priceFormula: "(1d6+1) * 5",
      priceMaximumGp: 35,
      rarity: "common",
      weight: 1,
      topDownImage: `modules/${MODULE_ID}/${value.topDownImage}`,
      signature: buildAlchemySignature(value)
    });

    const renamed = product({ name: "Новое имя", sourceRef: "Алхимические продукты V1!A999" });
    const renamedData = createAlchemyItemData(renamed, new Map());
    assert.equal(renamedData._id, data._id);
    assert.notEqual(renamedData.flags[MODULE_ID].signature, flags.signature);
  }
  finally {
    globalThis.CONST = previousConst;
    globalThis.CONFIG = previousConfig;
  }
});

test("the nine basic healing potions expose native selected-target healing activities", () => {
  const expectedFormulas = [
    "1d4 + 1", "2d4 + 2", "3d4 + 3", "4d4 + 4", "6d4 + 6",
    "8d4 + 8", "10d4 + 10", "15d4 + 15", "25d4 + 25"
  ];
  const healingProducts = productionCatalog.filter((entry) => (
    Number(entry.sourceNumber) >= 77 && Number(entry.sourceNumber) <= 85
  ));

  assert.equal(healingProducts.length, 9);
  healingProducts.forEach((entry, index) => {
    const definition = getAlchemyAutomationDefinition(entry);
    const activities = buildAlchemyActivities(entry);
    const [activity] = Object.values(activities);

    assert.equal(definition.kind, "healing");
    assert.equal(definition.formula, expectedFormulas[index]);
    assert.equal(activity._id, Object.keys(activities)[0]);
    assert.equal(activity.type, "heal");
    assert.equal(activity.activation.type, "action");
    assert.deepEqual(activity.target.affects, {
      count: "1",
      type: "creature",
      choice: true,
      special: ""
    });
    assert.equal(activity.target.prompt, true);
    assert.equal(activity.healing.custom.formula, expectedFormulas[index]);
    assert.deepEqual(activity.healing.types, ["healing"]);
    assert.deepEqual(activity.consumption.targets, [{
      type: "itemUses",
      target: "",
      value: "1",
      scaling: { mode: "", formula: "" }
    }]);
    assert.deepEqual(buildAlchemyConsumableUses(entry), {
      spent: 0,
      max: "1",
      recovery: [],
      autoDestroy: true
    });
  });
});

test("all 63 bombs expose stable fixed-DC save activities and normalized runtime definitions", () => {
  const bombs = productionCatalog.filter((entry) => entry.productType === "Бомба");
  assert.equal(bombs.length, 63);

  for (const entry of bombs) {
    const definition = getAlchemyAutomationDefinition(entry);
    const firstActivities = buildAlchemyActivities(entry);
    const secondActivities = buildAlchemyActivities(structuredClone(entry));
    const [activity] = Object.values(firstActivities);

    assert.equal(definition.kind, "bomb", entry.id);
    assert.equal(definition.dc, 11 + entry.rank, entry.id);
    assert.equal(definition.radius, entry.rank <= 3 ? 5 : entry.rank <= 6 ? 10 : 15, entry.id);
    assert.deepEqual(firstActivities, secondActivities, entry.id);
    assert.equal(activity._id, Object.keys(firstActivities)[0], entry.id);
    assert.equal(activity.type, "save", entry.id);
    assert.equal(activity.name, "Бросить бомбу", entry.id);
    assert.equal(activity.activation.type, "attack", entry.id);
    assert.equal(activity.save.dc.formula, String(11 + entry.rank), entry.id);
    assert.equal(activity.target.prompt, false, entry.id);
    assert.deepEqual(activity.target.template, {
      count: "1",
      contiguous: false,
      type: "radius",
      size: String(definition.radius),
      width: "",
      height: "",
      units: "ft"
    }, entry.id);
    assert.deepEqual(activity.consumption.targets, [{
      type: "itemUses",
      target: "",
      value: "1",
      scaling: { mode: "", formula: "" }
    }], entry.id);
    assert.deepEqual(activity.flags[MODULE_ID].alchemyBomb, definition, entry.id);
    assert.deepEqual(buildAlchemyConsumableUses(entry), {
      spent: 0,
      max: "1",
      recovery: [],
      autoDestroy: true
    }, entry.id);
  }
});

test("all 230 catalog products project stable consumables and automate only healing potions and bombs", async () => {
  const previousConst = globalThis.CONST;
  const previousConfig = globalThis.CONFIG;
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
  globalThis.CONFIG = {
    DND5E: { consumableTypes: { potion: {}, poison: {}, food: {}, trinket: {} } }
  };

  try {
    const items = productionCatalog.map((entry) => createAlchemyItemData(entry, new Map()));
    assert.equal(items.length, 230);
    assert.equal(new Set(items.map((entry) => entry._id)).size, 230);
    assert.equal(new Set(items.map((entry) => entry.img)).size, 230);
    assert.equal(new Set(items.map((entry) => entry.flags[MODULE_ID].topDownImage)).size, 230);
    assert.ok(items.every((entry) => entry.type === "consumable"));
    const automated = items.filter((entry) => Object.keys(entry.system.activities).length === 1);
    const manual = items.filter((entry) => Object.keys(entry.system.activities).length === 0);
    assert.equal(automated.length, 72);
    assert.equal(manual.length, 158);
    assert.ok(automated.every((entry) => entry.system.uses?.max === "1" && entry.system.uses.autoDestroy === true));
    assert.ok(manual.every((entry) => entry.system.uses === undefined));
    assert.ok(items.every((entry) => entry.effects.length === 0));
  }
  finally {
    globalThis.CONST = previousConst;
    globalThis.CONFIG = previousConfig;
  }
});

test("alchemy compendium validates all assets before mutation and synchronizes only managed documents idempotently", async () => {
  const previous = {
    game: globalThis.game,
    foundry: globalThis.foundry,
    Folder: globalThis.Folder,
    CONST: globalThis.CONST,
    CONFIG: globalThis.CONFIG
  };
  const mutations = [];
  const deletedEffects = [];
  const folders = [];
  const sidebarFolders = [];
  const [first, second] = productionCatalog;
  const currentFirstData = createAlchemyItemData(first, new Map());
  const currentFirst = makeDocument({
    ...currentFirstData,
    name: "Старое имя",
    system: {
      ...currentFirstData.system,
      activities: { "legacy-activity": { _id: "legacy-activity", name: "Legacy activity" } }
    },
    effects: [{ _id: "legacy-effect", name: "Legacy effect" }],
    flags: { [MODULE_ID]: { ...currentFirstData.flags[MODULE_ID], signature: "old" } }
  });
  const deleteEmbeddedDocuments = currentFirst.deleteEmbeddedDocuments;
  currentFirst.deleteEmbeddedDocuments = async (documentName, ids) => {
    deletedEffects.push([documentName, [...ids]]);
    return deleteEmbeddedDocuments(documentName, ids);
  };
  const documents = [
    currentFirst,
    makeDocument({
      _id: "stale-managed",
      name: "Устаревший",
      type: "consumable",
      flags: { [MODULE_ID]: { managed: true, sourceType: "alchemyProduct", alchemyProductId: "alchemy-stale", signature: "stale" } }
    }),
    makeDocument({
      _id: "user-copy",
      name: second.name,
      type: "consumable",
      flags: {}
    })
  ];
  const pack = {
    collection: "world.rebreya-alchemy",
    documentName: "Item",
    metadata: {
      system: "dnd5e",
      flags: { dnd5e: { sourceBook: "Rebreya", types: ["consumable"] } }
    },
    folders: { contents: folders },
    folder: { id: "sidebar-rebreya" },
    async getDocuments() {
      return documents;
    },
    async setFolder(id) {
      mutations.push(`set-folder:${id}`);
      this.folder = { id };
    },
    async configure(data) {
      mutations.push("configure-pack");
      this.metadata = { ...this.metadata, ...structuredClone(data) };
    },
    documentClass: {
      async createDocuments(data) {
        mutations.push(`create:${data.length}`);
        documents.push(...data.map(makeDocument));
      },
      async deleteDocuments(ids) {
        mutations.push(`delete:${ids.join(",")}`);
        for (const id of ids) {
          const index = documents.findIndex((entry) => entry.id === id);
          if (index >= 0) documents.splice(index, 1);
        }
      }
    }
  };

  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
  globalThis.CONFIG = {
    DND5E: { consumableTypes: { potion: {}, poison: {}, food: {}, trinket: {} } }
  };
  globalThis.game = {
    user: { isGM: true },
    system: { id: "dnd5e" },
    packs: new Map([[pack.collection, pack]]),
    folders: {
      filter: (predicate) => sidebarFolders.filter(predicate)
    }
  };
  globalThis.foundry = {
    documents: {
      collections: {
        CompendiumCollection: {
          async createCompendium() {
            mutations.push("create-pack");
            return pack;
          }
        }
      }
    }
  };
  globalThis.Folder = {
    async create(data, options = {}) {
      mutations.push(`create-folder:${data.name}`);
      const folder = { ...structuredClone(data), id: `folder-${folders.length + sidebarFolders.length + 1}` };
      if (options.pack) folders.push(folder);
      else sidebarFolders.push(folder);
      return folder;
    }
  };

  try {
    let validationCalls = 0;
    const service = new AlchemyCompendiumService({
      validateAssetPaths: async (paths) => {
        validationCalls += 1;
        assert.deepEqual(mutations, [], "asset validation must precede every world mutation");
        assert.deepEqual(new Set(paths), new Set(productionCatalog.flatMap((entry) => [
          `modules/${MODULE_ID}/${entry.icon}`,
          `modules/${MODULE_ID}/${entry.topDownImage}`
        ])));
      }
    });

    await service.sync(productionCatalog);
    assert.equal(validationCalls, 1);
    assert.equal(documents.filter((entry) => flagOf(entry, "managed")).length, 230);
    assert.ok(documents.some((entry) => entry.id === "user-copy"));
    assert.equal(documents.some((entry) => entry.id === "stale-managed"), false);
    assert.equal(documents.find((entry) => flagOf(entry, "alchemyProductId") === first.id)?.name, first.name);
    assert.equal(documents.find((entry) => flagOf(entry, "alchemyProductId") === second.id)?.name, second.name);
    assert.deepEqual(currentFirst.system.activities, {});
    assert.deepEqual(currentFirst.effects, []);
    assert.deepEqual(deletedEffects, [["ActiveEffect", ["legacy-effect"]]]);
    assert.ok(mutations.some((entry) => entry === "create:229"));
    assert.ok(mutations.some((entry) => entry.startsWith("delete:stale-managed")));

    const folderKeys = folders.map((folder) => `${folder.folder ?? "root"}/${folder.name}`);
    assert.equal(new Set(folderKeys).size, folderKeys.length);
    const folderCount = folders.length;
    mutations.length = 0;
    await service.sync(productionCatalog);
    assert.equal(validationCalls, 2);
    assert.equal(folders.length, folderCount);
    assert.deepEqual(mutations, []);
  }
  finally {
    globalThis.game = previous.game;
    globalThis.foundry = previous.foundry;
    globalThis.Folder = previous.Folder;
    globalThis.CONST = previous.CONST;
    globalThis.CONFIG = previous.CONFIG;
  }
});

test("alchemy sync rejects malformed, empty, and partial catalogs before any pack mutation", async () => {
  const previous = { game: globalThis.game, CONFIG: globalThis.CONFIG, CONST: globalThis.CONST };
  let packLookups = 0;
  globalThis.game = {
    user: { isGM: true },
    system: { id: "dnd5e" },
    packs: { get() { packLookups += 1; return null; } }
  };
  globalThis.CONFIG = { DND5E: { consumableTypes: { potion: {} } } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };

  try {
    const service = new AlchemyCompendiumService({ validateAssetPaths: async () => {} });
    for (const catalog of [null, {}, [], productionCatalog.slice(0, -1)]) {
      await assert.rejects(() => service.sync(catalog), /complete approved catalog of 230 products/iu);
    }
    assert.equal(packLookups, 0);
  }
  finally {
    globalThis.game = previous.game;
    globalThis.CONFIG = previous.CONFIG;
    globalThis.CONST = previous.CONST;
  }
});

test("alchemy sync preserves an incompatible existing pack instead of deleting it", async () => {
  const previous = {
    game: globalThis.game,
    foundry: globalThis.foundry,
    CONFIG: globalThis.CONFIG,
    CONST: globalThis.CONST
  };
  let deleted = 0;
  let created = 0;
  const pack = {
    collection: "world.rebreya-alchemy",
    documentName: "Actor",
    metadata: { system: "dnd5e" },
    async deleteCompendium() { deleted += 1; }
  };
  globalThis.game = {
    user: { isGM: true },
    system: { id: "dnd5e" },
    packs: new Map([[pack.collection, pack]])
  };
  globalThis.foundry = {
    documents: { collections: { CompendiumCollection: {
      async createCompendium() { created += 1; return pack; }
    } } }
  };
  globalThis.CONFIG = { DND5E: { consumableTypes: { potion: {}, poison: {}, food: {}, trinket: {} } } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };

  try {
    const service = new AlchemyCompendiumService({ validateAssetPaths: async () => {} });
    await assert.rejects(() => service.sync(productionCatalog), /incompatible existing compendium/iu);
    assert.equal(deleted, 0);
    assert.equal(created, 0);
  }
  finally {
    globalThis.game = previous.game;
    globalThis.foundry = previous.foundry;
    globalThis.CONFIG = previous.CONFIG;
    globalThis.CONST = previous.CONST;
  }
});

test("alchemy sync aborts before world mutation when any required asset is missing", async () => {
  const previous = { game: globalThis.game, CONFIG: globalThis.CONFIG, CONST: globalThis.CONST };
  let packLookups = 0;
  globalThis.game = {
    user: { isGM: true },
    system: { id: "dnd5e" },
    packs: { get() { packLookups += 1; return null; } }
  };
  globalThis.CONFIG = { DND5E: { consumableTypes: { potion: {} } } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };

  try {
    const service = new AlchemyCompendiumService({
      validateAssetPaths: async () => {
        throw new Error("Missing alchemy asset: broken.webp");
      }
    });
    await assert.rejects(() => service.sync(productionCatalog), /Missing alchemy asset/iu);
    assert.equal(packLookups, 0);
  }
  finally {
    globalThis.game = previous.game;
    globalThis.CONFIG = previous.CONFIG;
    globalThis.CONST = previous.CONST;
  }
});
