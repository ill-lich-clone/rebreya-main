import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildItemChoiceAdvancementData,
  CHOICE_FLAG_SCOPE,
  FeatChoiceAutomationService,
  getSelectedChoiceValues,
  normalizeChoiceConfig
} from "../scripts/automation/feat-choice-service.js";

function loadBundleItems() {
  const bundleUrl = new URL("../cherty-v08-foundry-2014-import-pack/cherty-v08-foundry-2014-bundle.json", import.meta.url);
  return JSON.parse(readFileSync(bundleUrl, "utf8")).items;
}

function byIdentifier(items, identifier) {
  return items.find((item) => item.system?.identifier === identifier);
}

function getChoiceAdvancement(item) {
  return item.system.advancement.find((advancement) => advancement.type === "ItemChoice");
}

test("normalizes a single feat choice config and selected value", () => {
  const config = normalizeChoiceConfig({
    title: "Armor Expert",
    type: "single",
    count: 1,
    selectedValue: "med",
    options: [
      { value: "lgt", label: "Light Armor" },
      { value: "med", label: "Medium Armor" }
    ]
  });

  assert.equal(config.title, "Armor Expert");
  assert.equal(config.count, 1);
  assert.deepEqual(getSelectedChoiceValues(config), ["med"]);
});

test("builds native dnd5e ItemChoice advancement data from choice config", () => {
  const advancement = buildItemChoiceAdvancementData({
    identifier: "armor-expert",
    choiceConfig: {
      title: "Choose armor training",
      type: "single",
      count: 1,
      options: [
        { value: "lgt", label: "Light Armor", uuid: "Compendium.world.rebreya-feats.aaaaaaaaaaaaaaaa" },
        { value: "med", label: "Medium Armor", uuid: "Compendium.world.rebreya-feats.bbbbbbbbbbbbbbbb" }
      ]
    }
  });

  assert.equal(advancement.type, "ItemChoice");
  assert.equal(advancement.configuration.type, "feat");
  assert.equal(advancement.configuration.allowDrops, false);
  assert.equal(advancement.configuration.choices["0"].count, 1);
  assert.deepEqual(advancement.configuration.pool, [
    { uuid: "Compendium.world.rebreya-feats.aaaaaaaaaaaaaaaa" },
    { uuid: "Compendium.world.rebreya-feats.bbbbbbbbbbbbbbbb" }
  ]);
});

test("opens native AdvancementManager for an unconfigured owned choice feat", async () => {
  const previousDnd5e = globalThis.dnd5e;
  const previousGame = globalThis.game;
  const previousDialog = globalThis.Dialog;
  const calls = [];

  globalThis.Dialog = function Dialog() {
    throw new Error("Custom Dialog must not be used for feat choices");
  };
  globalThis.game = {
    system: { id: "dnd5e" },
    user: { id: "user-1", isGM: true },
    settings: { get: () => false }
  };
  globalThis.dnd5e = {
    applications: {
      advancement: {
        AdvancementManager: {
          forModifyChoices: (actor, itemId, level) => {
            calls.push({ actor, itemId, level });
            return {
              steps: [{ type: "forward" }],
              render: () => {
                calls.push({ rendered: true });
              }
            };
          }
        }
      }
    }
  };

  const actor = { documentName: "Actor", isOwner: true, items: [] };
  const item = {
    id: "feat-id",
    name: "Armor Expert",
    type: "feat",
    parent: actor,
    isOwner: true,
    system: {
      advancement: [
        buildItemChoiceAdvancementData({
          identifier: "armor-expert",
          choiceConfig: {
            title: "Choose armor training",
            count: 1,
            options: [{ value: "lgt", label: "Light Armor", uuid: "Compendium.world.rebreya-feats.aaaaaaaaaaaaaaaa" }]
          }
        })
      ]
    },
    getFlag: () => ({
      title: "Choose armor training",
      count: 1,
      options: [{ value: "lgt", label: "Light Armor", uuid: "Compendium.world.rebreya-feats.aaaaaaaaaaaaaaaa" }]
    })
  };

  try {
    const result = await new FeatChoiceAutomationService().handleItemCreated(item, {}, "user-1");

    assert.equal(result, true);
    assert.deepEqual(calls, [
      { actor, itemId: "feat-id", level: 0 },
      { rendered: true }
    ]);
  }
  finally {
    globalThis.dnd5e = previousDnd5e;
    globalThis.game = previousGame;
    globalThis.Dialog = previousDialog;
  }
});

test("does not reopen advancement for a feat with completed ItemChoice values", async () => {
  const previousDnd5e = globalThis.dnd5e;
  const previousGame = globalThis.game;
  let managerCalls = 0;

  globalThis.game = {
    system: { id: "dnd5e" },
    user: { id: "user-1", isGM: true },
    settings: { get: () => false }
  };
  globalThis.dnd5e = {
    applications: {
      advancement: {
        AdvancementManager: {
          forModifyChoices: () => {
            managerCalls += 1;
            return { steps: [], render: () => {} };
          }
        }
      }
    }
  };

  const advancement = buildItemChoiceAdvancementData({
    identifier: "armor-expert",
    choiceConfig: {
      title: "Choose armor training",
      count: 1,
      options: [{ value: "lgt", label: "Light Armor", uuid: "Compendium.world.rebreya-feats.aaaaaaaaaaaaaaaa" }]
    }
  });
  advancement.value = {
    added: {
      0: {
        childItemId: "Compendium.world.rebreya-feats.aaaaaaaaaaaaaaaa"
      }
    },
    replaced: {}
  };

  const actor = { documentName: "Actor", isOwner: true, items: [] };
  const item = {
    id: "feat-id",
    name: "Armor Expert",
    type: "feat",
    parent: actor,
    isOwner: true,
    system: { advancement: [advancement] },
    getFlag: () => ({
      title: "Choose armor training",
      count: 1,
      options: [{ value: "lgt", label: "Light Armor", uuid: "Compendium.world.rebreya-feats.aaaaaaaaaaaaaaaa" }]
    })
  };

  try {
    const result = await new FeatChoiceAutomationService().handleItemCreated(item, {}, "user-1");

    assert.equal(result, false);
    assert.equal(managerCalls, 0);
  }
  finally {
    globalThis.dnd5e = previousDnd5e;
    globalThis.game = previousGame;
  }
});

test("Aristocraticness uses native ItemChoice advancement backed by real option Items", () => {
  const items = loadBundleItems();
  const parent = byIdentifier(items, "aristokratichnost");
  const config = parent.flags?.[CHOICE_FLAG_SCOPE]?.choiceConfig;
  const advancement = getChoiceAdvancement(parent);

  assert.equal(Array.isArray(parent.system.advancement), true);
  assert.equal(advancement.type, "ItemChoice");
  assert.equal(advancement.configuration.choices["0"].count, 6);
  assert.equal(config.min, 2);
  assert.equal(config.max, 6);
  assert.equal(config.options.length, 8);
  assert.equal(advancement.configuration.pool.length, 8);
  assert.equal(parent.effects.length, 0);
  assert.deepEqual(Object.keys(parent.system.activities ?? {}), []);

  for (const option of config.options) {
    assert.match(option.uuid, /^Compendium\.world\.rebreya-feats\.[A-Za-z0-9]{16}$/u);
    const optionId = option.uuid.split(".").at(-1);
    const optionItem = items.find((item) => item._id === optionId);
    assert.equal(optionItem?.type, "feat");
    assert.equal(optionItem?.name, option.label);
    assert.equal(typeof optionItem?.system?.description?.value, "string");
  }
});

test("Armor Expert uses native ItemChoice advancement backed by armor option Items", () => {
  const items = loadBundleItems();
  const parent = byIdentifier(items, "znatok-dospehov");
  const advancement = getChoiceAdvancement(parent);

  assert.equal(advancement.type, "ItemChoice");
  assert.equal(advancement.configuration.choices["0"].count, 1);
  assert.equal(advancement.configuration.pool.length, 3);
  assert.equal(parent.effects.length, 0);

  const optionItems = advancement.configuration.pool.map((entry) => items.find((item) => item._id === entry.uuid.split(".").at(-1)));
  assert.deepEqual(optionItems.map((item) => item.name), ["Лёгкие доспехи", "Средние доспехи", "Тяжёлые доспехи"]);
  assert.deepEqual(optionItems.map((item) => item.effects[0].changes[0].value), ["lgt", "med", "hvy"]);
});
