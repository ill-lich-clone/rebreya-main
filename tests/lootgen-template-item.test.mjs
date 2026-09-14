import test from "node:test";
import assert from "node:assert/strict";

import {
  LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION,
  LootgenTemplateItemService,
  buildLootgenTemplateSnapshot,
  normalizeLootgenTemplateItemSystem,
  projectLootgenTemplateItem
} from "../scripts/data/lootgen-template-item.js";
import {
  getLootgenTemplateItemDataModel,
  registerLootgenTemplateItemSheet,
  registerLootgenTemplateItemType
} from "../scripts/integrations/lootgen-template-item-type.js";

const TYPE = "rebreya-main.lootgen-template";

function templateItem({
  id = "template-a",
  name = "Bandit cache",
  img = "icons/cache.webp",
  form = { itemCount: 2 },
  legacyTemplateId = "",
  uuid = `Item.${id}`
} = {}) {
  return {
    documentName: "Item",
    id,
    uuid,
    name,
    img,
    type: TYPE,
    system: { schemaVersion: 1, form: structuredClone(form) },
    flags: legacyTemplateId
      ? { "rebreya-main": { lootgenTemplate: { legacyTemplateId } } }
      : {},
    async update(patch) {
      if (patch.name !== undefined) this.name = patch.name;
      if (patch.img !== undefined) this.img = patch.img;
      if (patch.system !== undefined) this.system = structuredClone(patch.system);
      return this;
    },
    async delete() {
      this.deleted = true;
      return this;
    }
  };
}

function serviceHarness({ legacy, failCreateFor = "", supportsItemType = () => true } = {}) {
  const items = [];
  const folders = [];
  let setting = legacy ?? { version: 2, templates: [] };
  let nextId = 0;
  const dependencies = {
    isGm: () => true,
    isActiveGm: () => true,
    supportsItemType,
    listItems: () => items.filter((item) => !item.deleted),
    listFolders: () => folders,
    resolveUuid: async (uuid) => items.find((item) => !item.deleted && item.uuid === uuid) ?? null,
    createFolder: async (data) => {
      const folder = { id: "folder-a", ...data };
      folders.push(folder);
      return folder;
    },
    createItem: async (data) => {
      const legacyId = data.flags?.["rebreya-main"]?.lootgenTemplate?.legacyTemplateId ?? "";
      if (failCreateFor && legacyId === failCreateFor) throw new Error("create failed");
      const item = templateItem({
        id: `created-${++nextId}`,
        name: data.name,
        img: data.img,
        form: data.system.form,
        legacyTemplateId: legacyId
      });
      item.folder = data.folder;
      items.push(item);
      return item;
    },
    getLegacySetting: () => structuredClone(setting),
    setLegacySetting: async (value) => { setting = structuredClone(value); },
    now: () => 1234
  };
  return {
    service: new LootgenTemplateItemService(dependencies),
    dependencies,
    items,
    folders,
    setting: () => structuredClone(setting),
    replaceSetting: (value) => { setting = structuredClone(value); }
  };
}

test("Lootgen template system normalization accepts version one and rejects malformed or future schemas", () => {
  const normalized = normalizeLootgenTemplateItemSystem({ schemaVersion: 1, form: { rankMin: 4, rankMax: 1 } });
  assert.equal(normalized.schemaVersion, LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION);
  assert.equal(normalized.form.rankMin, 1);
  assert.equal(normalized.form.rankMax, 4);
  assert.throws(() => normalizeLootgenTemplateItemSystem({ schemaVersion: 2, form: {} }), /верс/iu);
  assert.throws(() => normalizeLootgenTemplateItemSystem({ schemaVersion: 1, form: [] }), /форм/u);
});

test("template Item projection and storage snapshot are detached from the source Item", () => {
  const item = templateItem({ form: { itemCount: 3 } });
  const projection = projectLootgenTemplateItem(item);
  const snapshot = buildLootgenTemplateSnapshot(item, { now: () => 500 });

  assert.deepEqual(Object.keys(projection).sort(), ["form", "id", "img", "name", "schemaVersion", "uuid"]);
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.sourceUuid, item.uuid);
  assert.equal(snapshot.assignedAt, 500);

  item.system.form.itemCount = 9;
  item.name = "Edited";
  item.deleted = true;
  assert.equal(projection.form.itemCount, 3);
  assert.equal(snapshot.form.itemCount, 3);
  assert.equal(snapshot.name, "Bandit cache");
});

test("template Item service creates, edits, resolves legacy IDs, and deletes detached Items", async () => {
  const harness = serviceHarness();
  const created = await harness.service.save({ name: "  New cache  ", form: { itemCount: "4" } });
  assert.equal(created.name, "New cache");
  assert.equal(created.form.itemCount, 4);
  assert.equal(harness.items[0].folder, "folder-a");
  assert.equal(harness.folders.length, 1);
  assert.deepEqual(harness.folders[0].flags, {
    "rebreya-main": { lootgenTemplateFolder: { version: 1 } }
  });

  const updated = await harness.service.save({ itemUuid: created.uuid, name: "Edited cache", form: { itemCount: 7 } });
  assert.equal(updated.id, created.id);
  assert.equal(updated.name, "Edited cache");
  assert.equal(harness.items.length, 1);
  updated.form.itemCount = 99;
  assert.equal(harness.items[0].system.form.itemCount, 7);

  harness.items[0].flags = { "rebreya-main": { lootgenTemplate: { legacyTemplateId: "legacy-a" } } };
  assert.equal(harness.service.get("legacy-a").uuid, created.uuid);
  assert.equal(await harness.service.remove(created.uuid), true);
  assert.equal(harness.service.list().length, 0);
});

test("template Item service does not reuse an unrelated same-name Item folder", async () => {
  const harness = serviceHarness();
  harness.folders.push({
    id: "user-folder",
    name: "Шаблоны Lootgen",
    type: "Item",
    flags: {}
  });

  const created = await harness.service.save({ name: "Module cache", form: { itemCount: 2 } });

  assert.equal(created.name, "Module cache");
  assert.equal(harness.folders.length, 2);
  assert.equal(harness.items[0].folder, "folder-a");
  assert.deepEqual(harness.folders[1].flags, {
    "rebreya-main": { lootgenTemplateFolder: { version: 1 } }
  });
});

test("template Item writes stop before folder, Item, or setting mutation when the subtype is unavailable", async () => {
  const initialSetting = {
    version: 2,
    templates: [{ id: "legacy-a", name: "Legacy cache", form: { itemCount: 1 } }]
  };
  const harness = serviceHarness({
    legacy: initialSetting,
    supportsItemType: () => false
  });

  await assert.rejects(
    harness.service.save({ name: "New cache", form: { itemCount: 2 } }),
    /полностью перезапустите Foundry VTT/iu
  );
  await assert.rejects(
    harness.service.migrateLegacyTemplates(),
    /полностью перезапустите Foundry VTT/iu
  );

  assert.equal(harness.folders.length, 0);
  assert.equal(harness.items.length, 0);
  assert.deepEqual(harness.setting(), initialSetting);
});

test("template Item service resolves a compendium Item to a detached projection and snapshot", async () => {
  const compendium = templateItem({
    id: "pack-template",
    uuid: "Compendium.rebreya.templates.Item.pack-template",
    name: "Pack cache",
    form: { itemCount: 6 }
  });
  compendium.pack = "rebreya.templates";
  const service = new LootgenTemplateItemService({
    isGm: () => true,
    resolveUuid: async (uuid) => uuid === compendium.uuid ? compendium : null,
    now: () => 777
  });

  const projection = await service.getResolved(compendium.uuid);
  const snapshot = await service.buildSnapshot(compendium.uuid);
  assert.equal(projection.uuid, compendium.uuid);
  assert.equal(projection.form.itemCount, 6);
  assert.equal(snapshot.sourceUuid, compendium.uuid);
  assert.equal(snapshot.assignedAt, 777);
});

test("legacy migration resumes partial runs, avoids duplicates, and preserves edited Items", async () => {
  const legacy = {
    version: 2,
    templates: [
      { id: "legacy-a", name: "A", form: { itemCount: 1 } },
      { id: "legacy-b", name: "B", form: { itemCount: 2 } }
    ]
  };
  const first = serviceHarness({ legacy, failCreateFor: "legacy-b" });
  const partial = await first.service.migrateLegacyTemplates();
  assert.equal(partial.completed, false);
  assert.equal(first.items.length, 1);
  assert.deepEqual(first.setting().itemMigration.migratedLegacyIds, ["legacy-a"]);
  assert.equal(first.setting().templates.length, 2);

  const existing = first.items[0];
  existing.name = "User edited A";
  const resumed = new LootgenTemplateItemService({
    ...first.dependencies,
    createItem: async (data) => {
      const item = templateItem({
        id: "created-b",
        name: data.name,
        form: data.system.form,
        legacyTemplateId: data.flags["rebreya-main"].lootgenTemplate.legacyTemplateId
      });
      first.items.push(item);
      return item;
    },
    getLegacySetting: first.setting,
    setLegacySetting: async (value) => first.replaceSetting(value)
  });
  const complete = await resumed.migrateLegacyTemplates();
  assert.equal(complete.completed, true);
  assert.equal(first.items.length, 2);
  assert.equal(existing.name, "User edited A");
});

test("completed legacy migration does not recreate an intentionally deleted Item", async () => {
  const harness = serviceHarness({
    legacy: {
      version: 2,
      templates: [{ id: "legacy-a", name: "A", form: {} }],
      itemMigration: { version: 1, completed: true, migratedLegacyIds: ["legacy-a"], errors: [] }
    }
  });
  const result = await harness.service.migrateLegacyTemplates();
  assert.equal(result.completed, true);
  assert.equal(result.changed, false);
  assert.equal(harness.items.length, 0);
});

test("legacy migration reports duplicate legacy Items without creating another copy", async () => {
  const harness = serviceHarness({
    legacy: { version: 2, templates: [{ id: "legacy-a", name: "A", form: {} }] }
  });
  harness.items.push(
    templateItem({ id: "duplicate-a", legacyTemplateId: "legacy-a" }),
    templateItem({ id: "duplicate-b", legacyTemplateId: "legacy-a" })
  );

  const result = await harness.service.migrateLegacyTemplates();
  assert.equal(result.completed, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /несколько/iu);
  assert.equal(harness.items.length, 2);
});

test("Lootgen template subtype uses a dedicated model and registers one delegating sheet", () => {
  const previous = {
    CONFIG: globalThis.CONFIG,
    foundry: globalThis.foundry,
    Item: globalThis.Item
  };
  class TypeDataModel {}
  class DocumentSheetV2 {}
  class NumberField { constructor(options) { this.options = options; } }
  class ObjectField { constructor(options) { this.options = options; } }
  const registrations = [];
  globalThis.CONFIG = { Item: { dataModels: {}, typeLabels: {}, typeIcons: {} } };
  globalThis.Item = class Item {};
  globalThis.foundry = {
    abstract: { TypeDataModel },
    data: { fields: { NumberField, ObjectField } },
    applications: {
      api: { DocumentSheetV2 },
      apps: { DocumentSheetConfig: { registerSheet: (...args) => registrations.push(args) } }
    }
  };
  try {
    assert.equal(registerLootgenTemplateItemType(), true);
    const Model = getLootgenTemplateItemDataModel();
    assert.equal(Object.getPrototypeOf(Model), TypeDataModel);
    assert.equal(globalThis.CONFIG.Item.dataModels[TYPE], Model);
    assert.equal(globalThis.CONFIG.Item.typeLabels[TYPE], "TYPES.Item.rebreya-main.lootgen-template");
    assert.equal(globalThis.CONFIG.Item.typeIcons[TYPE], "fa-solid fa-box-open");
    assert.deepEqual(Object.keys(Model.defineSchema()).sort(), ["form", "schemaVersion"]);
    assert.equal(registerLootgenTemplateItemSheet(), true);
    assert.equal(registerLootgenTemplateItemSheet(), false);
    assert.equal(registrations.length, 1);
    assert.deepEqual(registrations[0][3].types, [TYPE]);
  }
  finally {
    globalThis.CONFIG = previous.CONFIG;
    globalThis.foundry = previous.foundry;
    globalThis.Item = previous.Item;
  }
});
