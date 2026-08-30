import assert from "node:assert/strict";
import test from "node:test";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => structuredClone(value),
    escapeHTML: (value) => String(value ?? ""),
    getProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object)
  }
};
globalThis.CONST ??= { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };

const { MagicItemsCompendiumService } = await import("../scripts/data/magic-items-compendium.js");

test("magic-item runtime hooks work when no Rune Knight service is installed", async () => {
  const originalGame = globalThis.game;
  const originalHooks = globalThis.Hooks;
  const handlers = new Map();
  const calls = [];
  globalThis.game = {};
  globalThis.Hooks = { on: (name, handler) => handlers.set(name, handler) };
  try {
    const { registerCombatHooks } = await import(`../scripts/combat/hooks.js?magic-runtime=${Date.now()}`);
    registerCombatHooks({
      magicItemsCompendium: {
        applyDnd5eRollHitDie: () => calls.push("hit-die"),
        applyDnd5ePostUseActivity: async () => calls.push("activity")
      }
    });

    assert.equal(typeof handlers.get("dnd5e.rollHitDie"), "function");
    assert.equal(typeof handlers.get("dnd5e.postUseActivity"), "function");
    handlers.get("dnd5e.rollHitDie")([], {});
    handlers.get("dnd5e.postUseActivity")({}, {}, {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["hit-die", "activity"]);
  }
  finally {
    globalThis.game = originalGame;
    globalThis.Hooks = originalHooks;
  }
});

test("pearl restores the selected expended slot and lantern restores prior token light", async () => {
  const actorUpdates = [];
  const actor = {
    system: { spells: {
      spell1: { value: 1, max: 1 },
      spell2: { value: 1, max: 2 },
      spell3: { value: 0, max: 0 }
    } },
    update: async (update) => actorUpdates.push(structuredClone(update))
  };
  const service = new MagicItemsCompendiumService({ promptSpellSlot: async () => 2 });
  await service.applyDnd5ePostUseActivity({
    id: "pearl-activity",
    actor,
    item: { actor },
    flags: { "rebreya-main": { magicItemRuntime: { action: "restore-spell-slot" } } }
  });
  assert.deepEqual(actorUpdates, [{ "system.spells.spell2.value": 2 }]);

  const tokenUpdates = [];
  const itemUpdates = [];
  const token = {
    id: "token-1",
    uuid: "Scene.scene.Token.token-1",
    _source: { light: { bright: 5, dim: 10, angle: 360, color: "#ffaa00" } },
    update: async (update) => tokenUpdates.push(structuredClone(update))
  };
  const lanternItem = {
    name: "Вечно горящий фонарь",
    actor: { getActiveTokens: () => [{ document: token }] },
    flags: { "rebreya-main": { magicItemRuntime: {} } },
    update: async (update) => itemUpdates.push(structuredClone(update))
  };
  await service.applyDnd5ePostUseActivity({
    item: lanternItem,
    flags: { "rebreya-main": { magicItemRuntime: {
      action: "token-light-on",
      light: { bright: 60, dim: 120, angle: 60 }
    } } }
  });
  assert.deepEqual(tokenUpdates[0].light, {
    bright: 60, dim: 120, angle: 60, color: "#ffaa00"
  });
  lanternItem.flags["rebreya-main"].magicItemRuntime.tokenLights =
    itemUpdates[0]["flags.rebreya-main.magicItemRuntime.tokenLights"];
  await service.applyDnd5ePostUseActivity({
    item: lanternItem,
    flags: { "rebreya-main": { magicItemRuntime: { action: "token-light-off" } } }
  });
  assert.deepEqual(tokenUpdates[1].light, {
    bright: 5, dim: 10, angle: 360, color: "#ffaa00"
  });
});

test("wound-closure medallion doubles Hit Die healing without exceeding effective maximum", () => {
  const actor = {
    items: { contents: [{
      system: { equipped: true },
      flags: { "rebreya-main": { magicItemId: "медальон-затягивающихся-ран" } }
    }] },
    system: { attributes: { hp: { value: 10, max: 30, effectiveMax: 30 } } }
  };
  const context = {
    subject: actor,
    updates: { actor: { "system.attributes.hp.value": 18 } }
  };

  new MagicItemsCompendiumService().applyDnd5eRollHitDie([{ total: 8 }], context);

  assert.equal(context.updates.actor["system.attributes.hp.value"], 26);
});

test("unattuned wound-closure medallion does not alter Hit Die healing", () => {
  const actor = {
    items: { contents: [{
      system: { equipped: true, attuned: false },
      flags: { "rebreya-main": { magicItemId: "медальон-затягивающихся-ран" } }
    }] },
    system: { attributes: { hp: { value: 10, max: 30 } } }
  };
  const context = {
    subject: actor,
    updates: { actor: { "system.attributes.hp.value": 18 } }
  };

  new MagicItemsCompendiumService().applyDnd5eRollHitDie([{ total: 8 }], context);

  assert.equal(context.updates.actor["system.attributes.hp.value"], 18);
});

test("ability-ring long-rest choice projects the selected capped ability effect", async () => {
  const packSource = {
    _id: "ring-pack",
    name: "Кольцо характеристики обычное",
    effects: [],
    system: { activities: {}, uses: null },
    flags: { "rebreya-main": {
      magicItemId: "уроборос",
      signature: "ring-signature",
      magicItemAutomation: {
        version: 4,
        kind: "abilityRing",
        coverage: "full",
        bonus: 1,
        maxAbilityScore: 10
      }
    } }
  };
  const packDocument = {
    ...packSource,
    getFlag: (_moduleId, key) => packSource.flags["rebreya-main"][key],
    toObject: () => structuredClone(packSource)
  };
  const pack = {
    getIndex: async () => [{
      _id: "ring-pack",
      name: packSource.name,
      flags: { "rebreya-main": { magicItemId: "уроборос" } }
    }],
    getDocument: async () => packDocument,
    getDocuments: async () => [packDocument]
  };
  const itemSource = {
    _id: "ring-owned",
    id: "ring-owned",
    name: packSource.name,
    type: "equipment",
    system: { equipped: true, activities: {}, uses: null },
    effects: [],
    flags: { "rebreya-main": { magicItemId: "уроборос" } }
  };
  const itemUpdates = [];
  const actor = {
    system: { abilities: Object.fromEntries(
      ["str", "dex", "con", "int", "wis", "cha"].map((ability) => [ability, { value: ability === "str" ? 9 : 10 }])
    ) },
    items: { contents: [] }
  };
  const item = {
    ...itemSource,
    actor,
    toObject: () => structuredClone(itemSource),
    update: async (update) => itemUpdates.push(structuredClone(update))
  };
  actor.items.contents.push(item);
  const service = new MagicItemsCompendiumService({
    gameProvider: () => ({ packs: new Map([["world.rebreya-magic-items", pack]]) }),
    promptAbilityChoice: async () => "str"
  });

  assert.deepEqual(await service.chooseAbilityRingsAfterLongRest(actor), { status: "completed" });
  assert.deepEqual(
    itemUpdates[0].effects[0].changes.map(({ key, value }) => [key, value]),
    [["system.abilities.str.value", "+1"], ["system.abilities.str.max", "10"]]
  );
  assert.deepEqual(
    itemUpdates[0].flags["rebreya-main"].magicItemRuntime.abilityChoice,
    { ability: "str", appliedBonus: 1 }
  );
});
