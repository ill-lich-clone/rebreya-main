import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const products = JSON.parse(await readFile(new URL("../data/alchemy-products.json", import.meta.url), "utf8"));
const healing = products.find(({ id }) => id === "alchemy-78");
const serviceModule = () => import("../scripts/data/alchemy-crafting-service.js");
const execution = { assertActiveGm() {} };

function fixture() {
  const entries = {};
  const journal = {
    readObject: () => structuredClone(entries),
    async mutateObject(_name, mutate) { return mutate(entries); }
  };
  let currency = { gp: 100, cp: 0 };
  const created = new Map();
  const actor = {
    id: "hero",
    type: "character",
    system: { get currency() { return currency; } },
    items: { get: (id) => created.get(id), get contents() { return [...created.values()]; } },
    async update(patch) { currency = patch["system.currency"]; },
    async createEmbeddedDocuments(_type, [item]) {
      created.set(item._id, { ...item, id: item._id, async update(patch) {
        this.flags["rebreya-main"].alchemyCraft.pending = patch["flags.rebreya-main.alchemyCraft.pending"];
      } });
      if (actor.failAfterCreate) { actor.failAfterCreate = false; throw new Error("lost output response"); }
      return [created.get(item._id)];
    }
  };
  return { journal, actor, created, entries };
}

test("a replay finds the already-created output and leaves a single debit and output", async () => {
  const { AlchemyCraftingService } = await serviceModule();
  const { journal, actor, created } = fixture();
  const service = new AlchemyCraftingService({
    moduleApi: { getModel: async () => ({ alchemyProductById: new Map([[healing.id, healing]]) }) },
    repository: journal,
    gameProvider: () => ({ actors: new Map([[actor.id, actor]]) })
  });
  const request = {
    operationId: "field-1", outputActorId: actor.id, outcome: "field-success", expiresAt: 86400,
    quote: { errors: [], debits: [], goldGp: 40, output: { productId: healing.id } }
  };
  actor.failAfterCreate = true;
  await assert.rejects(service.applyCraft(request, execution), /lost output response/);
  const result = await service.applyCraft(request, execution);
  assert.equal(result.phase, "committed");
  assert.equal(actor.system.currency.gp, 60);
  assert.equal(created.size, 1);
  assert.equal([...created.values()][0].flags["rebreya-main"].alchemyCraft.expiresAt, 86400);
});

test("a transferred pending output can be recovered after Foundry loses the creation response", async () => {
  const { AlchemyCraftingService, canUseCraftedPotion } = await serviceModule();
  const { journal, actor, created } = fixture();
  const received = [];
  const group = { id: "party", items: { contents: received, get: (id) => received.find((row) => row.id === id) } };
  const service = new AlchemyCraftingService({
    moduleApi: { getModel: async () => ({ alchemyProductById: new Map([[healing.id, healing]]) }) },
    repository: journal,
    gameProvider: () => ({ actors: new Map([[actor.id, actor], [group.id, group]]) })
  });
  const request = {
    operationId: "field-moved", outputActorId: actor.id, outcome: "field-success", expiresAt: 86400,
    quote: { errors: [], debits: [], goldGp: 40, output: { productId: healing.id } }
  };
  actor.failAfterCreate = true;
  await assert.rejects(service.applyCraft(request, execution), /lost output response/);
  const potion = [...created.values()][0];
  assert.equal(canUseCraftedPotion(potion, 0), false);
  created.clear();
  potion.id = "moved";
  received.push(potion);
  const result = await service.applyCraft(request, execution);
  assert.equal(result.itemId, "moved");
  assert.equal(created.size, 0);
  assert.equal(actor.system.currency.gp, 60);
  assert.equal(canUseCraftedPotion(potion, 0), true);
});

test("crafted healing preserves authored formula and applies coal to the native healing bonus", async () => {
  const { buildCraftedPotion } = await serviceModule();
  const data = buildCraftedPotion(healing, {
    operationId: "field-2", expiresAt: 86400, lifetimeSeconds: 86400,
    catalyst: { materialId: "ugol", name: "Уголь", effect: "Восстанавливает на 2 хита больше." }
  });
  const activity = Object.values(data.system.activities)[0];
  assert.equal(data.system.quantity, 1);
  assert.equal(data.flags["rebreya-main"].alchemyProductId, "alchemy-78");
  assert.equal(activity.healing.custom.formula, "2d4 + 2 + 2");
  assert.match(data.system.description.value, /Уголь/);
  assert.match(data.system.description.value, /24 ч\./u);
  assert.equal(data.flags["rebreya-main"].alchemyCraft.expiresAt, 86400);
});

test("crafting retains authored world effects and variant duration resolves the same way on use", async () => {
  const { buildCraftedPotion } = await serviceModule();
  const { resolveCraftedPotionProduct } = await import("../scripts/data/alchemy-crafting-rules.js");
  const { createAlchemyItemData } = await import("../scripts/data/alchemy-compendium.js");
  const potion = products.find(({ id }) => id === "alchemy-15");
  const catalyst = { materialId: "material-132", name: "Кисть Генгкоу", effect: "Длительность увеличивается до 1 часа." };
  const source = createAlchemyItemData(potion);
  source.effects.push({ name: "Авторский эффект" });
  source.system.description.value += "<p>Авторская заметка</p>";
  const crafted = buildCraftedPotion(potion, { operationId: "field-3", catalyst, source });
  assert.equal(crafted.effects[0].name, "Авторский эффект");
  assert.match(crafted.system.description.value, /Авторская заметка/);
  const variant = resolveCraftedPotionProduct(potion, crafted.flags["rebreya-main"].alchemyCraft.catalyst);
  assert.equal(variant.duration, "1 час");
  assert.equal(Object.values(crafted.system.activities)[0].duration.units, "hour");
});

test("craft commands reject malformed or untrusted selections before writing", async () => {
  const { isValidAlchemyCraftIntent } = await import("../scripts/application/alchemy-crafting-commands.js");
  const input = {
    groupId: "group", actorId: "hero", productId: "alchemy-78", operationId: "brew",
    selection: { items: [], optionIndex: 0, ability: "int" }
  };
  assert.equal(isValidAlchemyCraftIntent(input), true);
  assert.equal(isValidAlchemyCraftIntent({ ...input, goldGp: 0 }), false);
  assert.equal(isValidAlchemyCraftIntent({ ...input, selection: { ...input.selection, items: [
    { actorId: "other", itemId: "stock", quantity: 1, role: "base", price: 0 }
  ] } }), false);
});
