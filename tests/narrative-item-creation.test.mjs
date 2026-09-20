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
