import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  BUILTIN_COIN_FOLDER_NAME,
  BUILTIN_COIN_TEMPLATE_FLAG,
  BUILTIN_COIN_TEMPLATES,
  BuiltinCoinTemplateService
} from "../scripts/data/builtin-coin-template-service.js";

const EXPECTED_TEMPLATES = [
  ["pp", "Платиновая монета", "icons/commodities/currency/coins-assorted-mix-platinum.webp"],
  ["gp", "Золотая монета", "icons/commodities/currency/coins-plain-gold.webp"],
  ["sp", "Серебряная монета", "icons/commodities/currency/coins-assorted-mix-silver.webp"],
  ["cp", "Медная монета", "icons/commodities/currency/coins-assorted-mix-copper.webp"]
];

function createHarness({ active = true } = {}) {
  const folders = [];
  const items = [];
  const folderCreates = [];
  const itemCreates = [];
  const warnings = [];
  let folderReads = 0;
  let itemReads = 0;
  const game = {
    folders: {
      get contents() {
        folderReads += 1;
        return folders;
      }
    },
    items: {
      get contents() {
        itemReads += 1;
        return items;
      }
    }
  };
  const Folder = {
    async create(data) {
      folderCreates.push(structuredClone(data));
      const folder = { ...structuredClone(data), id: `folder-${folderCreates.length}` };
      folders.push(folder);
      return folder;
    }
  };
  const Item = {
    async create(data, options) {
      itemCreates.push({ data: structuredClone(data), options: structuredClone(options) });
      const item = makeItem({
        ...structuredClone(data),
        id: `item-${itemCreates.length}`,
        sort: itemCreates.length * 100
      });
      items.push(item);
      return item;
    }
  };
  const service = new BuiltinCoinTemplateService({
    gameProvider: () => game,
    folderProvider: () => Folder,
    itemProvider: () => Item,
    isActiveGm: () => active,
    logger: { warn: (...args) => warnings.push(args) }
  });
  return {
    service,
    folders,
    items,
    folderCreates,
    itemCreates,
    warnings,
    get folderReads() { return folderReads; },
    get itemReads() { return itemReads; }
  };
}

function makeItem(data) {
  return {
    ...data,
    updates: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(patch) {
      this.updates.push(structuredClone(patch));
    }
  };
}

function expectedManagedData(denomination, folderId) {
  const [, name, img] = EXPECTED_TEMPLATES.find(([id]) => id === denomination);
  return {
    name,
    type: "loot",
    img,
    folder: folderId,
    system: {
      quantity: 1,
      type: { value: "treasure" }
    },
    flags: {
      [MODULE_ID]: {
        sourceType: "coinTemplate",
        [BUILTIN_COIN_TEMPLATE_FLAG]: { version: 1, denomination }
      }
    }
  };
}

test("inactive clients do not read or create built-in coin documents", async () => {
  const harness = createHarness({ active: false });

  assert.equal(await harness.service.sync(), null);
  assert.equal(harness.folderReads, 0);
  assert.equal(harness.itemReads, 0);
  assert.equal(harness.folderCreates.length, 0);
  assert.equal(harness.itemCreates.length, 0);
});

test("active GM creates the root coin folder and immutable catalog exactly once", async () => {
  const harness = createHarness();

  const first = await harness.service.sync();
  const second = await harness.service.sync();

  assert.equal(BUILTIN_COIN_FOLDER_NAME, "МОНЕТЫ");
  assert.deepEqual(BUILTIN_COIN_TEMPLATES.map(({ denomination, name, img }) => (
    [denomination, name, img]
  )), EXPECTED_TEMPLATES);
  assert.deepEqual(harness.folderCreates, [{
    name: "МОНЕТЫ",
    type: "Item",
    folder: null
  }]);
  assert.equal(harness.itemCreates.length, 4);
  assert.deepEqual(
    harness.itemCreates.map(({ data }) => data),
    EXPECTED_TEMPLATES.map(([denomination]) => expectedManagedData(denomination, first.folder.id))
  );
  assert.equal(harness.itemCreates.every(({ options }) => options.renderSheet === false), true);
  assert.deepEqual(second.items, first.items);
  assert.equal(harness.folderCreates.length, 1);
  assert.equal(harness.itemCreates.length, 4);
});

test("sync finds renamed and moved Items by stable flag and repairs only managed fields", async () => {
  const harness = createHarness();
  await harness.service.sync();
  const gold = harness.items.find((item) => (
    item.getFlag(MODULE_ID, BUILTIN_COIN_TEMPLATE_FLAG)?.denomination === "gp"
  ));
  gold.name = "Пользовательское имя";
  gold.type = "equipment";
  gold.img = "icons/svg/mystery-man.svg";
  gold.folder = { id: "other-folder" };
  gold.system = { quantity: 99, type: { value: "gear" }, untouched: "keep" };
  gold.flags[MODULE_ID].sourceType = "wrong";
  gold.flags[MODULE_ID][BUILTIN_COIN_TEMPLATE_FLAG].version = 0;

  await harness.service.sync();

  assert.equal(harness.itemCreates.length, 4);
  assert.equal(gold.updates.length, 1);
  assert.deepEqual(gold.updates[0], {
    name: "Золотая монета",
    type: "loot",
    img: "icons/commodities/currency/coins-plain-gold.webp",
    folder: "folder-1",
    "system.quantity": 1,
    "system.type.value": "treasure",
    [`flags.${MODULE_ID}.sourceType`]: "coinTemplate",
    [`flags.${MODULE_ID}.${BUILTIN_COIN_TEMPLATE_FLAG}`]: { version: 1, denomination: "gp" }
  });
});

test("an unflagged same-name Item remains untouched and does not satisfy the managed catalog", async () => {
  const harness = createHarness();
  const unrelated = makeItem({
    id: "unrelated-gold",
    sort: 10,
    name: "Золотая монета",
    type: "loot",
    img: "custom.webp",
    folder: null,
    system: { quantity: 17, type: { value: "treasure" } },
    flags: {}
  });
  harness.items.push(unrelated);

  const result = await harness.service.sync();

  assert.equal(harness.itemCreates.length, 4);
  assert.equal(result.items.length, 4);
  assert.equal(unrelated.updates.length, 0);
  assert.equal(unrelated.system.quantity, 17);
});

test("duplicate flags repair deterministic first Item without creating or deleting another", async () => {
  const harness = createHarness();
  harness.folders.push({ id: "coin-folder", name: "МОНЕТЫ", type: "Item", folder: null });
  const duplicateLaterById = makeItem({
    ...expectedManagedData("gp", "wrong-folder"),
    id: "item-z",
    sort: 100
  });
  const deterministicFirst = makeItem({
    ...expectedManagedData("gp", "wrong-folder"),
    id: "item-a",
    sort: 100,
    name: "Repair me"
  });
  harness.items.push(duplicateLaterById, deterministicFirst);

  const result = await harness.service.sync();

  assert.equal(harness.itemCreates.length, 3);
  assert.equal(result.items.length, 4);
  assert.equal(harness.items.length, 5);
  assert.equal(deterministicFirst.updates.length, 1);
  assert.equal(duplicateLaterById.updates.length, 0);
  assert.equal(harness.warnings.length, 1);
  assert.match(String(harness.warnings[0][0]), /duplicate built-in coin templates.*gp/iu);
});
