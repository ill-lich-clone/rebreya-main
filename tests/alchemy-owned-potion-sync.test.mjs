import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AlchemyCompendiumService } from "../scripts/data/alchemy-compendium.js";

const catalog = JSON.parse(await readFile(new URL("../data/alchemy-products.json", import.meta.url), "utf8"));
const first = catalog.find((product) => product.id === "alchemy-1");

function item(overrides = {}) {
  const result = {
    id: "owned-potion",
    type: "consumable",
    system: {
      quantity: 3,
      uses: { spent: 1, max: "3", recovery: [], autoDestroy: false },
      activities: { custom: { _id: "custom", type: "utility", name: "Ручное действие" } }
    },
    effects: [{ id: "custom-effect" }],
    flags: { "rebreya-main": {
      managed: true, sourceType: "alchemyProduct", alchemyProductId: first.id,
      sourceNumber: 1, productType: "Зелье", rank: 1
    } },
    updates: [],
    ...overrides
  };
  result.update = async (patch) => {
    result.updates.push(structuredClone(patch));
    for (const [path, value] of Object.entries(patch)) {
      const parts = path.split(".");
      let target = result;
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = structuredClone(value);
    }
  };
  return result;
}

test("owned potion sync adds only the missing drink action, preserving custom data and quantities", async () => {
  const previous = globalThis.game;
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: { activeGM: gm }, system: { id: "dnd5e" } };
  try {
    const owned = item();
    const unrelated = item({ id: "unrelated", flags: {} });
    const actor = { type: "character", items: { contents: [owned, unrelated] } };
    const before = structuredClone({ quantity: owned.system.quantity, uses: owned.system.uses,
      custom: owned.system.activities.custom, effects: owned.effects });
    const service = new AlchemyCompendiumService();
    await service.syncOwnedPotionActivities(catalog, { actors: [actor] });
    assert.deepEqual({ quantity: owned.system.quantity, uses: owned.system.uses,
      custom: owned.system.activities.custom, effects: owned.effects }, before);
    const added = Object.values(owned.system.activities).find((activity) => activity.name === "Выпить зелье");
    assert.ok(added);
    assert.equal(added.consumption.targets[0].type, "material");
    assert.equal(added.consumption.targets[0].target, owned.id);
    assert.equal(added.flags["rebreya-main"].alchemyConsumeOwnQuantity, true);
    assert.equal(unrelated.updates.length, 0);
    assert.equal(owned.updates.length, 1);
    await service.syncOwnedPotionActivities(catalog, { actors: [actor] });
    assert.equal(owned.updates.length, 1);
  }
  finally {
    globalThis.game = previous;
  }
});

test("legacy healing potion without an activity receives the original healing formula", async () => {
  const previous = globalThis.game;
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: { activeGM: gm }, system: { id: "dnd5e" } };
  try {
    const healing = item({ id: "healing", system: { quantity: 2, activities: {} }, flags: { "rebreya-main": {
      managed: true, sourceType: "alchemyProduct", alchemyProductId: "alchemy-80",
      sourceNumber: 80, productType: "Зелье", rank: 4
    } } });
    await new AlchemyCompendiumService().syncOwnedPotionActivities(catalog, {
      actors: [{ type: "character", items: { contents: [healing] } }]
    });
    const activity = Object.values(healing.system.activities)[0];
    assert.equal(activity.type, "heal");
    assert.equal(activity.healing.custom.formula, "4d4 + 4");
    assert.equal(activity.target.affects.count, "1");
    assert.equal(healing.system.quantity, 2);
  }
  finally {
    globalThis.game = previous;
  }
});

test("owned potion automation preserves a deliberately adjusted reagent level", async () => {
  const previous = globalThis.game;
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: { activeGM: gm }, system: { id: "dnd5e" } };
  try {
    const owned = item();
    owned.flags["rebreya-main"].reagentLevel = 5;
    await new AlchemyCompendiumService().syncOwnedPotionActivities(catalog, {
      actors: [{ type: "character", items: { contents: [owned] } }]
    });
    const added = Object.values(owned.system.activities).find((activity) => activity.name === "Выпить зелье");
    assert.equal(owned.flags["rebreya-main"].reagentLevel, 5);
    assert.equal(added.flags["rebreya-main"].alchemyReagent.reagentLevel, 5);
  }
  finally {
    globalThis.game = previous;
  }
});

test("one broken owned item does not prevent synchronization of the others", async () => {
  const previous = globalThis.game;
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: { activeGM: gm }, system: { id: "dnd5e" } };
  try {
    const broken = item({ id: "broken" });
    broken.update = async () => { throw new Error("broken item"); };
    const good = item({ id: "good" });
    const errors = [];
    const service = new AlchemyCompendiumService({ logger: { error: (...args) => errors.push(args) } });
    await service.syncOwnedPotionActivities(catalog, { actors: [{ type: "character", items: { contents: [broken, good] } }] });
    assert.equal(good.updates.length, 1);
    assert.equal(errors.length, 1);
  }
  finally {
    globalThis.game = previous;
  }
});
