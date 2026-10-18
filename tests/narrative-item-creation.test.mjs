import test from "node:test";
import assert from "node:assert/strict";

const integrationModule = await import("../scripts/integrations/narrative-item-creation.js")
  .catch(() => ({}));

const catalog = {
  byGearId: new Map([["book", [{
    variantId: "book-scorched",
    gearId: "book",
    sourceName: "Книга",
    title: "Следы копоти",
    description: "Края обуглены.",
    rank: 1
  }]]])
};

function createdItem({ pack = null, flags = { "rebreya-main": { gearId: "book" } } } = {}) {
  const source = {
    name: "Книга",
    type: "loot",
    system: { description: { value: "base" }, quantity: 3 },
    flags
  };
  return {
    pack,
    toObject: () => structuredClone(source),
    updateSource(patch) {
      this.patch = patch;
    }
  };
}

test("creation integration personalizes actor world and canvas-pile item instances", () => {
  const personalize = integrationModule.personalizeNarrativeItemCreation;
  assert.equal(typeof personalize, "function");
  if (typeof personalize !== "function") return;
  const item = createdItem();

  assert.equal(personalize(item, {}, { catalog, random: () => 0 }), true);
  assert.equal(item.patch.system.quantity, 1);
  assert.equal(item.patch.flags["rebreya-main"].narrativeVariantId, "book-scorched");
  assert.equal(item.patch.name, "Следы копоти");
});

test("creation integration excludes canonical compendium documents", () => {
  const personalize = integrationModule.personalizeNarrativeItemCreation;
  assert.equal(typeof personalize, "function");
  if (typeof personalize !== "function") return;
  const directPackItem = createdItem({ pack: "world.rebreya-gear" });
  const optionPackItem = createdItem();

  assert.equal(personalize(directPackItem, {}, { catalog, random: () => 0 }), false);
  assert.equal(personalize(optionPackItem, { pack: "world.rebreya-gear" }, { catalog, random: () => 0 }), false);
  assert.equal(directPackItem.patch, undefined);
  assert.equal(optionPackItem.patch, undefined);
});

test("opening an owned narrative Item restores an empty name from its saved title without changing saved text", async () => {
  assert.equal(typeof integrationModule.restoreNarrativeItemTitle, "function");
  const item = { name: "", documentName: "Item", isOwner: true, id: "saved-book", parent: {},
    flags: { "rebreya-main": { narrativeVariantId: "book-scorched", narrativeTitle: "Следы копоти" } },
    toObject() { return { name: this.name, flags: structuredClone(this.flags), system: { description: { value: "saved" } } }; },
    async update(patch) { assert.deepEqual(patch, { name: "Следы копоти" }); Object.assign(this, patch); this.updates = (this.updates ?? 0) + 1; }
  };
  item.collection = new Map([[item.id, item]]);
  assert.equal(await integrationModule.restoreNarrativeItemTitle(item, { catalog }), true);
  assert.equal(item.name, "Следы копоти");
  assert.equal(await integrationModule.restoreNarrativeItemTitle(item, { catalog }), false);
  assert.equal(item.updates, 1);
  item.name = "Моя книга";
  assert.equal(await integrationModule.restoreNarrativeItemTitle(item, { catalog }), false);
  item.pack = "world.rebreya-gear"; item.name = "";
  assert.equal(await integrationModule.restoreNarrativeItemTitle(item, { catalog }), false);
});

test("registered preCreateItem hook never cancels creation and reports failures", async () => {
  const register = integrationModule.registerNarrativeItemCreationHooks;
  assert.equal(typeof register, "function");
  if (typeof register !== "function") return;
  const registrations = [];
  const errors = [];
  const Hooks = { on: (name, callback) => registrations.push({ name, callback }) };

  assert.equal(await register({
    Hooks,
    loadCatalog: async () => catalog,
    random: () => { throw new Error("rng failed"); },
    logger: { error: (...args) => errors.push(args) }
  }), true);
  assert.equal(registrations[0].name, "preCreateItem");
  assert.equal(registrations[0].callback(createdItem(), {}, {}, "user"), undefined);
  assert.equal(errors.length, 1);
  assert.equal(await register({ Hooks, loadCatalog: async () => catalog }), false);
});

test("narrative V1 and V2 sheet hooks restore a read-only local title once without writing world data", async () => {
  const callbacks = new Map();
  const Hooks = { on: (name, callback) => callbacks.set(name, callback) };
  await integrationModule.registerNarrativeItemCreationHooks({ Hooks, loadCatalog: async () => catalog, random: () => assert.fail("render reroll") });
  const item = { documentName: "Item", name: "", id: "readonly", isOwner: false,
    flags: { "rebreya-main": { narrativeVariantId: "book-scorched", narrativeTitle: "Следы копоти" } },
    toObject() { return { name: this.name, flags: this.flags }; },
    updateSource(patch) { Object.assign(this, patch); },
    update() { assert.fail("read-only world write"); }
  };
  let renders = 0;
  const app = { document: item, rendered: true, render: async () => { renders++; } };
  callbacks.get("renderItemSheetV2")(app);
  callbacks.get("renderItemSheet")(app);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(item.name, "Следы копоти"); assert.equal(renders, 1);
  callbacks.get("renderItemSheetV2")(app);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(renders, 1);
});

test("narrative temporary documents repair locally even when the GM owns their generated ID", async () => {
  const item = { documentName: "Item", name: "", id: "temporary", isOwner: true, collection: new Map(),
    flags: { "rebreya-main": { narrativeVariantId: "chosen", narrativeTitle: "Летопись" } },
    toObject() { return { name: this.name, flags: this.flags }; },
    update() { assert.fail("temporary document must not write to the world"); },
    updateSource(patch) { Object.assign(this, patch); }
  };
  assert.equal(await integrationModule.restoreNarrativeItemTitle(item, { catalog }), true);
  assert.equal(item.name, "Летопись");
});

test("narrative sheet repair never reopens a sheet closed while its name update is pending", async () => {
  const callbacks = new Map();
  await integrationModule.registerNarrativeItemCreationHooks({ Hooks: { on: (name, callback) => callbacks.set(name, callback) }, loadCatalog: async () => catalog });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const item = { documentName: "Item", name: "", id: "owned", isOwner: true,
    flags: { "rebreya-main": { narrativeVariantId: "chosen", narrativeTitle: "Летопись" } },
    toObject() { return { name: this.name, flags: this.flags }; },
    async update(patch) { await gate; Object.assign(this, patch); }
  };
  item.collection = new Map([[item.id, item]]);
  let renders = 0;
  const app = { document: item, rendered: true, render: async () => { renders++; } };
  callbacks.get("renderItemSheetV2")(app);
  app.rendered = false;
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(item.name, "Летопись"); assert.equal(renders, 0);
});

test("preCreateActor personalizes items embedded in a newly created canvas pile", async () => {
  const register = integrationModule.registerNarrativeItemCreationHooks;
  assert.equal(typeof register, "function");
  if (typeof register !== "function") return;
  const registrations = [];
  const Hooks = { on: (name, callback) => registrations.push({ name, callback }) };
  const embeddedBook = createdItem();
  const actor = { pack: null, items: { contents: [embeddedBook] } };

  assert.equal(await register({ Hooks, loadCatalog: async () => catalog, random: () => 0 }), true);
  const callback = registrations.find((entry) => entry.name === "preCreateActor")?.callback;
  assert.equal(typeof callback, "function");
  if (typeof callback !== "function") return;
  assert.equal(callback(actor, {}, {}, "user"), undefined);
  assert.equal(embeddedBook.patch.flags["rebreya-main"].narrativeVariantId, "book-scorched");
  assert.equal(embeddedBook.patch.system.quantity, 1);
});
