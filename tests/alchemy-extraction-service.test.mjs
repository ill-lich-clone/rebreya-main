import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AlchemyCraftingService } from "../scripts/data/alchemy-crafting-service.js";
import { getAlchemyAspectKind } from "../scripts/data/alchemy-aspects.js";
import { buildInventoryItemQuantityPatch, buildInventoryItemQuantityRestorePatch, captureInventoryItemQuantityState } from "../scripts/data/inventory-material-quantity.js";
import { normalizePotionRecipeCatalog, planPotionStock } from "../scripts/data/alchemy-crafting-rules.js";

const loadService = () => import("../scripts/data/alchemy-extraction-service.js");
const materials = JSON.parse(readFileSync(new URL("../data/materials.json", import.meta.url), "utf8"));
const products = JSON.parse(readFileSync(new URL("../data/alchemy-products.json", import.meta.url), "utf8"));
const recipeData = JSON.parse(readFileSync(new URL("../data/alchemy-potion-recipes.json", import.meta.url), "utf8"));
const materialById = new Map(materials.map((row) => [row.id, row]));
const moduleId = "rebreya-main";

function setPath(target, path, value) {
  const keys = path.split(".");
  const key = keys.pop();
  for (const segment of keys) target = target[segment] ??= {};
  if (key.startsWith("-=")) delete target[key.slice(2)];
  else target[key] = structuredClone(value);
}

function fixture(total = 25) {
  let rolls = 0;
  let dice = 0;
  const actors = new Map();
  const state = {};
  const repository = {
    readObject: () => structuredClone(state),
    async mutateObject(_key, fn) { return fn(state); }
  };
  const addActor = (id, type) => {
    const actor = {
      id, type, name: id, items: new Map(),
      testUserPermission: ({ id }) => id === "owner",
      async createEmbeddedDocuments(_type, [data]) {
        const item = addItem(actor, data._id, data);
        if (actor.failCreate) { actor.failCreate = false; throw new Error("lost create"); }
        return [item];
      },
      async rollToolCheck(config) {
        assert.equal(config.ability, "int");
        assert.equal(config.tool, "rebreyaAlchemy");
        rolls++;
        await actor.onRoll?.();
        return [{ total }];
      }
    };
    actors.set(id, actor);
    return actor;
  };
  const addItem = (actor, id, source) => {
    const data = structuredClone(source);
    const item = {
      id, parent: actor,
      get name() { return data.name; }, get type() { return data.type; },
      get system() { return data.system; }, get flags() { return data.flags; },
      toObject: () => structuredClone(data),
      async update(patch) {
        for (const [key, value] of Object.entries(patch)) setPath(data, key, value);
        if (item.failUpdate) { item.failUpdate = false; throw new Error("lost update"); }
        return item;
      },
      async delete() { actor.items.delete(id); return item; }
    };
    actor.items.set(id, item);
    return item;
  };
  const plant = (actor, id, materialId, quantity) => addItem(actor, id, {
    name: materialById.get(materialId).name, type: "loot", flags: { [moduleId]: { materialId } },
    system: { quantity, weight: { value: 1, units: "lb" }, price: { value: 10, denomination: "gp" } }
  });
  const group = addActor("party", "group");
  const hero = addActor("hero", "character");
  const foreign = addActor("foreign", "character");
  addItem(hero, "kit", { type: "tool", flags: { [moduleId]: { rank: 3 } },
    system: { quantity: 1, type: { baseItem: "rebreyaAlchemy" } } });
  const api = {
    getModel: async () => ({ materialById, alchemyProductById: new Map(products.map((product) => [product.id, product])) }),
    groupContextService: { resolveReferenceForGroup: (groupId) => groupId === group.id
      ? { groupActor: group, memberActorIds: [hero.id], members: [hero] } : null }
  };
  const gameProvider = () => ({ actors, user: { id: "owner" } });
  const brewing = new AlchemyCraftingService({ moduleApi: api, repository, gameProvider });
  const setup = async () => {
    const { AlchemyExtractionService } = await loadService();
    return new AlchemyExtractionService({ moduleApi: api, craftingService: brewing, gameProvider,
      rollDie: async () => { dice++; return 4; } });
  };
  const execution = { sender: { id: "owner" }, assertActiveGm() {} };
  return { setup, brewing, execution, group, hero, foreign, plant, addItem, rolls: () => rolls, dice: () => dice };
}

const request = (ingredients) => ({ groupId: "party", actorId: "hero", operationId: "brew-1", ingredients });
const selected = (actor, item, quantity) => ({ actorId: actor.id, itemId: item.id, quantity });

test("single failed extraction consumes the plant and rejects fractions, foreign stock and repeated rows before rolling", async () => {
  const f = fixture(9);
  const service = await f.setup();
  const portion = f.plant(f.group, "plant", "material-129", 1);
  const foreign = f.plant(f.foreign, "other", "material-128", 1);
  assert.deepEqual((await service.preview(request([]))).plants.map(({ itemId, available }) => [itemId, available]), [["plant", 1]]);
  for (const ingredients of [
    [selected(f.group, portion, 0.5)], [selected(f.foreign, foreign, 1)],
    [selected(f.group, portion, 2)], [selected(f.group, portion, 1), selected(f.group, portion, 1)]
  ]) await assert.rejects(service.extract(request(ingredients), f.execution));
  await assert.rejects(service.extract(request([selected(f.group, portion, 1)]), { ...f.execution, sender: { id: "stranger" } }));
  assert.equal(f.rolls(), 0);
  const result = await service.extract(request([selected(f.group, portion, 1)]), f.execution);
  assert.deepEqual(result.aspects, {});
  assert.equal(f.group.items.has(portion.id), false);
  assert.equal(f.rolls(), 1);
  assert.equal(f.dice(), 0);
});

test("resuming after lost responses consumes and credits exactly once using one roll and one shared die", async () => {
  const f = fixture();
  const service = await f.setup();
  const positive = f.plant(f.hero, "ephedra", "material-129", 1);
  const earth = f.plant(f.group, "slime", "material-128", 2);
  const existing = f.addItem(f.hero, "legacy", { name: "Аспект ПЭ", type: "loot", flags: {}, system: { quantity: 7 } });
  const intent = request([selected(f.hero, positive, 1), selected(f.group, earth, 1)]);
  positive.failUpdate = true;
  await assert.rejects(service.extract(intent, f.execution), /lost update/);
  assert.equal(positive.system.quantity, 0);
  existing.failUpdate = true;
  await assert.rejects(service.extract(intent, f.execution), /lost update/);
  assert.equal(existing.system.quantity, 33);
  f.hero.failCreate = true;
  await assert.rejects(service.extract(intent, f.execution), /lost create/);
  const result = await service.extract(intent, f.execution);
  assert.deepEqual(result, await service.extract(intent, f.execution));
  assert.deepEqual(result.aspects, { positive: 26, earth: 46 });
  assert.equal(earth.system.quantity, 1);
  assert.equal(existing.system.quantity, 33);
  assert.equal([...f.hero.items.values()].find((item) => getAlchemyAspectKind(item) === "earth").system.quantity, 46);
  assert.equal(f.rolls(), 1);
  assert.equal(f.dice(), 1);
  await assert.rejects(service.extract(request([selected(f.group, earth, 1)]), f.execution), /состав|использован/u);
});

test("two portions from one stack count as a batch on a failed check", async () => {
  const f = fixture(9);
  const service = await f.setup();
  const item = f.plant(f.hero, "ephedra", "material-129", 2);
  const result = await service.extract(request([selected(f.hero, item, 2)]), f.execution);
  assert.equal(result.portionCount, 2);
  assert.deepEqual(result.aspects, { positive: 22 });
  assert.equal(f.hero.items.has(item.id), false);
});

test("recovery unlocks every piece of a pending aspect stack split between inventories", async () => {
  const f = fixture(20);
  const service = await f.setup();
  const plant = f.plant(f.hero, "ephedra", "material-129", 1);
  const existing = f.addItem(f.hero, "legacy", { name: "Аспект ПЭ", type: "loot", flags: {}, system: { quantity: 7 } });
  const intent = request([selected(f.hero, plant, 1)]);
  existing.failUpdate = true;
  await assert.rejects(service.extract(intent, f.execution), /lost update/);
  await existing.update({ "system.quantity": 24 });
  const copied = existing.toObject();
  copied.system.quantity = 5;
  const moved = f.addItem(f.group, "moved", copied);
  await service.extract(intent, f.execution);
  assert.equal(existing.system.quantity + moved.system.quantity, 29);
  assert.equal(existing.flags[moduleId].alchemyAspectCredit, null);
  assert.equal(moved.flags[moduleId].alchemyAspectCredit, null);
});

test("an external depletion during the check cannot pass for the extraction debit", async () => {
  const f = fixture(20);
  const service = await f.setup();
  const item = f.plant(f.hero, "ephedra", "material-129", 1);
  const intent = request([selected(f.hero, item, 1)]);
  const original = captureInventoryItemQuantityState(item.toObject());
  f.hero.onRoll = async () => { await item.update(buildInventoryItemQuantityPatch(item.toObject(), 0)); };
  await assert.rejects(service.extract(intent, f.execution), /запас|порци/iu);
  assert.equal([...f.hero.items.values()].some((row) => getAlchemyAspectKind(row)), false);
  await item.update(buildInventoryItemQuantityRestorePatch(original));
  const result = await service.extract(intent, f.execution);
  assert.deepEqual(result.aspects, { positive: 22 });
  assert.equal(f.rolls(), 1);
});

test("extracted Fire satisfies the explosive potion recipe using the same world inventory", async () => {
  const f = fixture(20);
  const extraction = await f.setup();
  const plant = f.plant(f.group, "bloodgrass", "material-127", 1);
  f.plant(f.group, "blood", "material-4", 1);
  await extraction.extract(request([selected(f.group, plant, 1)]), f.execution);
  f.brewing.catalog = async () => normalizePotionRecipeCatalog(recipeData, { products, materials });
  const intent = { groupId: f.group.id, actorId: f.hero.id, productId: "alchemy-1", mode: "field" };
  const context = await f.brewing.context(intent);
  const { items } = planPotionStock({ ...context, mode: intent.mode });
  const quote = await f.brewing.quote({ ...intent, selection: { optionIndex: 0, ability: "int", items } }, context);
  assert.deepEqual(quote.errors, []);
  assert.equal(quote.debits.find(({ aspect }) => aspect === "fire").quantity, 15);
});
