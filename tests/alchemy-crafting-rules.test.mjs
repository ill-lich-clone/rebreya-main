import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeEconomyDataset } from "../scripts/data/normalizer.js";

const readData = async (name) => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const [products, materials] = await Promise.all([readData("alchemy-products"), readData("materials")]);
const rules = () => import("../scripts/data/alchemy-crafting-rules.js");
const catalog = async () => (await rules()).normalizePotionRecipeCatalog(await readData("alchemy-potion-recipes"), { products, materials });
const product = (id) => products.find((row) => row.id === `alchemy-${id}`);
const material = (name) => materials.find((row) => row.name === name);
const stack = (itemId, quantity, data) => ({ actorId: "hero", itemId, quantity, ...data });
const selected = (row, role, quantity = row.quantity) => ({ actorId: row.actorId, itemId: row.itemId, quantity, role });
const blood = stack("blood", 1, { materialId: "material-4" });
const aspect = (kind, quantity) => stack(kind, quantity, { aspect: kind });
const ingredient = (name, quantity = 1) => stack(material(name).id, quantity, { materialId: material(name).id });
const field = { ability: "int" };
const table = [{ rank: 2, weeks: 2, baseCost: 75 }, { rank: 3, weeks: 3, baseCost: 130 }];

async function quote(id, stock, items, extra = {}) {
  const { selection, ...options } = extra;
  return (await rules()).buildPotionCraftQuote({
    recipe: (await catalog()).get(`alchemy-${id}`),
    product: product(id),
    mode: "field",
    stock,
    selection: { ...field, items, ...selection },
    tool: { rank: 9 },
    laboratory: table,
    ...options
  });
}

test("recipe catalog assigns a checked recipe to every potion and retains the rulebook's substitutions", async () => {
  const recipes = await catalog();
  assert.deepEqual([...recipes.keys()].sort(), products.filter((row) => row.productType === "Зелье").map((row) => row.id).sort());
  assert.equal(recipes.size, 109);
  assert.deepEqual(recipes.get("alchemy-13").options[0].aspects, { earth: 20, fire: 5 });
  assert.equal(recipes.get("alchemy-13").options[1].components[0].materialId, "material-20");
  assert.equal(recipes.get("alchemy-86").options[0].goldGp, 50);
  assert.equal(recipes.get("alchemy-86").options[1].components[0].materialId, "material-66");
  assert.equal(recipes.get("alchemy-71").options[0].components[0].materialId, material("Поток временной жилы").id);
});

test("the rulebook resolves alternate material IDs against the normalized runtime economy model", async (t) => {
  const previous = globalThis.foundry;
  globalThis.foundry = { utils: { deepClone: structuredClone } };
  t.after(() => { globalThis.foundry = previous; });
  const model = normalizeEconomyDataset({ alchemyProducts: products, materials });
  const recipes = (await rules()).normalizePotionRecipeCatalog(await readData("alchemy-potion-recipes"), {
    products: model.alchemyProducts, materials: model.materials
  });
  const alternative = recipes.get("alchemy-2").options[2].components[0];
  assert.equal(recipes.get("alchemy-2").materialById.get(alternative.materialId).name, "Шерсть гриффона 1-й ранг");
});

test("an aspect recipe and its component alternative consume only the selected branch and the base", async () => {
  const earth = aspect("earth", 20);
  const fire = aspect("fire", 5);
  const heart = ingredient("Сердце чудовища");
  const stock = [blood, earth, fire, heart];
  const first = await quote(13, stock, [selected(blood, "base"), selected(earth, "aspect"), selected(fire, "aspect")]);
  const second = await quote(13, stock, [selected(blood, "base"), selected(heart, "component")], { selection: { optionIndex: 1 } });
  assert.deepEqual(first.errors, []);
  assert.deepEqual(second.errors, []);
  assert.deepEqual(first.debits.map((row) => [row.itemId, row.quantity]), [["blood", 1], ["earth", 20], ["fire", 5]]);
  assert.deepEqual(second.debits.map((row) => [row.itemId, row.quantity]), [["blood", 1], [heart.itemId, 1]]);
});

test("an ingredient missing from the world catalog cannot be substituted by renaming a different material", async () => {
  const fakeShell = { ...ingredient("Копыто чудовища"), name: "Панцирь чудовища 2-й ранг", isMaterial: true };
  const result = await quote(19, [blood, fakeShell], [selected(blood, "base"), selected(fakeShell, "component")], {
    selection: { optionIndex: 1 }
  });
  assert.ok(result.errors.some(({ code }) => code === "material-unavailable"));
});

test("simplified laboratory uses manual weeks and gold while field uses the authored recipe price", async () => {
  const lab = await quote(78, [], [], { mode: "laboratory", selection: { manualWeeks: 3, manualGoldGp: 42 } });
  const outdoors = await quote(78, [], []);
  assert.deepEqual(lab.errors, []);
  assert.equal(lab.goldGp, 42);
  assert.equal(lab.weeks, 3);
  assert.deepEqual(outdoors.errors, []);
  assert.equal(outdoors.goldGp, 40);
  assert.equal(outdoors.weeks, null);
});

test("any-aspect recipes accept a mix and lose only whole quarter-aspects of each type on field failure", async () => {
  const fire = aspect("fire", 9);
  const water = aspect("water", 6);
  const mixed = await quote(3, [blood, fire, water], [selected(blood, "base"), selected(fire, "aspect"), selected(water, "aspect")]);
  assert.deepEqual(mixed.errors, []);
  assert.deepEqual(mixed.failureDebits.map((row) => [row.itemId, row.quantity]), [["fire", 2], ["water", 1]]);
  const synthetic = { options: [{ aspects: { fire: 15, earth: 22 }, components: [] }], catalysts: [] };
  const largeFire = aspect("fire", 15);
  const earth = aspect("earth", 22);
  const large = await quote(1, [blood, largeFire, earth], [selected(blood, "base"), selected(largeFire, "aspect"), selected(earth, "aspect")], { recipe: synthetic });
  assert.deepEqual(large.failureDebits.map((row) => row.quantity), [3, 5]);
});

test("field cap and catalyst rank apply even when a character has a higher-rank tool", async () => {
  const catalyst = stack("catalyst", 1, { materialId: "material-20", rank: 2 });
  const recipe = { options: [{ aspects: {}, components: [] }], catalysts: [{ materialId: "material-20", effect: "test" }] };
  const result = await quote(49, [blood, catalyst], [selected(blood, "base"), selected(catalyst, "catalyst")], { recipe });
  assert.deepEqual(result.errors, []);
  assert.equal(result.dc, 16);
  const highRank = await quote(61, [blood], [selected(blood, "base")], { recipe });
  assert.ok(highRank.errors.some(({ code }) => code === "field-rank-limit"));
});

test("salt increases field DC by five and keeps the potion for seven days", async () => {
  const salt = ingredient("Соль");
  const fire = aspect("fire", 15);
  const result = await quote(1, [blood, salt, fire], [selected(blood, "base"), selected(fire, "aspect"), selected(salt, "catalyst")]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.dc, 16);
  assert.equal(result.output.lifetimeSeconds, 7 * 86400);
});

test("tin preserves aspects on failure without consuming the catalyst", async () => {
  const tin = ingredient("Олово");
  const fire = aspect("fire", 15);
  const result = await quote(1, [blood, tin, fire], [selected(blood, "base"), selected(fire, "aspect"), selected(tin, "catalyst")]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.dc, 12);
  assert.deepEqual(result.failureDebits, []);
});

test("legacy tool rank works for its exact managed base item and broken tools cannot provide access", async () => {
  const { resolveAlchemyToolRank } = await rules();
  const item = {
    name: "Инструменты Алхимические 3-й ранг",
    type: "tool",
    system: { quantity: 1, type: { baseItem: "rebreyaAlchemy" } },
    flags: { "rebreya-main": { managed: true, gearId: "instrumenty-alkhimicheskie-0-y-rang", rank: 0 } }
  };
  assert.equal(resolveAlchemyToolRank(item), 3);
  assert.equal(resolveAlchemyToolRank({ ...item, flags: { "rebreya-main": { ...item.flags["rebreya-main"], durability: { state: "broken" } } } }), null);
  assert.equal(resolveAlchemyToolRank({ ...item, flags: {} }), 0);
});

test("one material portion cannot be counted twice and high-value alternatives preserve the unused portion", async () => {
  const one = { options: [{ aspects: {}, components: [{ materialId: "material-4" }] }], catalysts: [] };
  const duplicate = await quote(1, [blood], [selected(blood, "base"), selected(blood, "component")], { recipe: one });
  assert.ok(duplicate.errors.some(({ code }) => code === "stock-shortage"));
  const upgraded = ingredient("Сердце чудовища 3-й ранг");
  const otherHeart = { ...upgraded, itemId: "other-heart", quantity: 0.2 };
  const mixed = await quote(13, [blood, upgraded, otherHeart], [
    selected(blood, "base"), selected(upgraded, "component", 0.1), selected(otherHeart, "component", 0.2)
  ], { selection: { optionIndex: 1 } });
  assert.deepEqual(mixed.errors, []);
  assert.deepEqual(mixed.debits.map((row) => [row.itemId, row.quantity]), [["blood", 1], [upgraded.itemId, 0.1], ["other-heart", 0.2]]);
});
