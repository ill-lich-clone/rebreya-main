import test from "node:test";
import assert from "node:assert/strict";

import {
  buildItemSimilarityPaths,
  ensureItemPilesDnD5eIntegration
} from "../scripts/integrations/item-piles-dnd5e.js";

test("Item Piles similarity preserves custom paths and separates every durability field", () => {
  const paths = buildItemSimilarityPaths(["name", "flags.custom.identity", "name"]);

  assert.deepEqual(paths, [
    "name",
    "flags.custom.identity",
    "type",
    "flags.rebreya-main.durability.version",
    "flags.rebreya-main.durability.eligible",
    "flags.rebreya-main.durability.state",
    "flags.rebreya-main.durability.breakStage",
    "flags.rebreya-main.durability.materialProfile",
    "flags.rebreya-main.durability.construction",
    "flags.rebreya-main.durability.size",
    "flags.rebreya-main.durability.hp.value",
    "flags.rebreya-main.durability.hp.max",
    "flags.rebreya-main.durability.ac",
    "flags.rebreya-main.durability.damageThreshold"
  ]);
  assert.equal(new Set(paths).size, paths.length);
});

test("active itempilesdnd5e still receives durability similarities without replacing its integration", async () => {
  const originalGame = globalThis.game;
  const writes = [];
  let integrationCalls = 0;
  const settings = new Map([
    ["itemSimilarities", ["name", "type", "flags.custom.identity"]]
  ]);

  globalThis.game = {
    system: { id: "dnd5e", version: "5.2.5" },
    modules: new Map([
      ["item-piles", { active: true }],
      ["itempilesdnd5e", { active: true }]
    ]),
    itempiles: {
      API: {
        addSystemIntegration() {
          integrationCalls += 1;
        }
      }
    },
    user: { isGM: true },
    settings: {
      get(_moduleId, key) {
        return settings.get(key);
      },
      async set(_moduleId, key, value) {
        settings.set(key, value);
        writes.push([key, value]);
      }
    }
  };

  try {
    assert.equal(await ensureItemPilesDnD5eIntegration(), true);
    assert.equal(integrationCalls, 0);
    assert.deepEqual(writes.map(([key]) => key), ["itemSimilarities"]);
    assert.deepEqual(settings.get("itemSimilarities"), buildItemSimilarityPaths([
      "name",
      "type",
      "flags.custom.identity"
    ]));
  }
  finally {
    globalThis.game = originalGame;
  }
});

test("fallback system integration is registered once across init and ready calls", async () => {
  const originalGame = globalThis.game;
  const integrations = [];
  const API = {
    addSystemIntegration(data) {
      integrations.push(data);
    }
  };

  globalThis.game = {
    system: { id: "dnd5e", version: "5.2.5" },
    modules: new Map([
      ["item-piles", { active: true }],
      ["itempilesdnd5e", { active: false }]
    ]),
    itempiles: { API },
    user: { isGM: false }
  };

  try {
    assert.equal(await ensureItemPilesDnD5eIntegration(), true);
    assert.equal(await ensureItemPilesDnD5eIntegration(), true);
    assert.equal(integrations.length, 1);
    assert.deepEqual(integrations[0].ITEM_SIMILARITIES, buildItemSimilarityPaths());
  }
  finally {
    globalThis.game = originalGame;
  }
});

test("similarity repair hook restores durability paths after Item Piles reapplies companion defaults", async () => {
  const integration = await import(`../scripts/integrations/item-piles-dnd5e.js?repair=${Date.now()}`);
  assert.equal(typeof integration.registerItemPilesSimilarityRepairHook, "function");

  const originalGame = globalThis.game;
  const callbacks = new Map();
  const settings = new Map([["itemSimilarities", ["name", "type"]]]);
  globalThis.game = {
    system: { id: "dnd5e", version: "5.2.5" },
    modules: new Map([
      ["item-piles", { active: true }],
      ["itempilesdnd5e", { active: true }]
    ]),
    itempiles: { API: {} },
    user: { isGM: true },
    settings: {
      get(_moduleId, key) {
        return settings.get(key);
      },
      async set(_moduleId, key, value) {
        settings.set(key, value);
      }
    }
  };
  const Hooks = {
    on(name, callback) {
      callbacks.set(name, callback);
    }
  };

  try {
    assert.equal(integration.registerItemPilesSimilarityRepairHook({ Hooks }), true);
    assert.equal(integration.registerItemPilesSimilarityRepairHook({ Hooks }), false);
    await callbacks.get("updateSetting")({ key: "item-piles.itemSimilarities" });
    assert.deepEqual(settings.get("itemSimilarities"), buildItemSimilarityPaths());
  }
  finally {
    globalThis.game = originalGame;
  }
});
