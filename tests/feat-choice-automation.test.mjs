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

function loadBundle() {
  const bundleUrl = new URL("../cherty-v08-foundry-2014-import-pack/cherty-v08-foundry-2014-bundle.json", import.meta.url);
  return JSON.parse(readFileSync(bundleUrl, "utf8"));
}

function loadBundleItems() {
  return loadBundle().items;
}

function byIdentifier(items, identifier) {
  return items.find((item) => item.system?.identifier === identifier);
}

function getChoiceAdvancement(item) {
  return item.system.advancement.find((advancement) => advancement.type === "ItemChoice");
}

function textContent(value) {
  return String(value ?? "").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

function getEffectChange(item, key) {
  return (item.effects ?? []).flatMap((effect) => effect.changes ?? []).find((change) => change.key === key);
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
        { value: "med", label: "Medium Armor", uuid: "Compendium.world.rebreya-feats.Item.bbbbbbbbbbbbbbbb" }
      ]
    }
  });

  assert.equal(advancement.type, "ItemChoice");
  assert.equal(advancement.configuration.type, "feat");
  assert.equal(advancement.configuration.allowDrops, false);
  assert.equal(advancement.configuration.choices["0"].count, 1);
  assert.deepEqual(advancement.configuration.pool, [
    { uuid: "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa" },
    { uuid: "Compendium.world.rebreya-feats.Item.bbbbbbbbbbbbbbbb" }
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
            options: [{ value: "lgt", label: "Light Armor", uuid: "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa" }]
          }
        })
      ]
    },
    getFlag: () => ({
      title: "Choose armor training",
      count: 1,
      options: [{ value: "lgt", label: "Light Armor", uuid: "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa" }]
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

test("resolves choice option UUIDs from the live feats compendium index", async () => {
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const staleUuid = "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa";
  const actualUuid = "Compendium.world.rebreya-feats.Item.ActualLight00001";
  const updates = [];
  const choiceConfig = {
    title: "Choose armor training",
    count: 1,
    options: [{ value: "lgt", label: "Light Armor", uuid: staleUuid }]
  };

  globalThis.fromUuid = async (uuid) => uuid === actualUuid ? { uuid } : null;
  globalThis.game = {
    packs: {
      get: (packId) => packId === "world.rebreya-feats" ? {
        collection: "world.rebreya-feats",
        getIndex: async () => [{
          _id: "ActualLight00001",
          system: { identifier: "armor-expert-lgt" },
          flags: {
            [CHOICE_FLAG_SCOPE]: {
              choiceOption: {
                parentIdentifier: "armor-expert",
                value: "lgt"
              }
            }
          }
        }]
      } : null
    }
  };

  const item = {
    id: "feat-id",
    name: "Armor Expert",
    type: "feat",
    system: {
      identifier: "armor-expert",
      advancement: []
    },
    getFlag: () => choiceConfig,
    update: async (update) => {
      updates.push(update);
      if (update["system.advancement"]) {
        item.system.advancement = update["system.advancement"];
      }
      if (update[`flags.${CHOICE_FLAG_SCOPE}.choiceConfig.options`]) {
        choiceConfig.options = update[`flags.${CHOICE_FLAG_SCOPE}.choiceConfig.options`];
      }
      return item;
    }
  };

  try {
    await new FeatChoiceAutomationService().configureItemChoice(item);

    assert.equal(item.system.advancement[0].configuration.pool[0].uuid, actualUuid);
    assert.equal(choiceConfig.options[0].uuid, actualUuid);
    assert.equal(updates.length, 2);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("syncs the feats compendium when choice option items are missing", async () => {
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const staleUuid = "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa";
  const actualUuid = "Compendium.world.rebreya-feats.Item.CreatedLight0001";
  const updates = [];
  let syncCalls = 0;
  let synced = false;

  globalThis.fromUuid = async (uuid) => uuid === actualUuid ? { uuid } : null;
  globalThis.game = {
    packs: {
      get: (packId) => packId === "world.rebreya-feats" ? {
        collection: "world.rebreya-feats",
        getIndex: async () => synced ? [{
          _id: "CreatedLight0001",
          flags: {
            [CHOICE_FLAG_SCOPE]: {
              choiceOption: {
                parentIdentifier: "armor-expert",
                value: "lgt"
              }
            }
          }
        }] : []
      } : null
    }
  };

  const item = {
    id: "feat-id",
    name: "Armor Expert",
    type: "feat",
    system: {
      identifier: "armor-expert",
      advancement: []
    },
    getFlag: () => ({
      title: "Choose armor training",
      count: 1,
      options: [{ value: "lgt", label: "Light Armor", uuid: staleUuid }]
    }),
    update: async (update) => {
      updates.push(update);
      if (update["system.advancement"]) {
        item.system.advancement = update["system.advancement"];
      }
      return item;
    }
  };
  const moduleApi = {
    featsCompendium: {
      sync: async () => {
        syncCalls += 1;
        synced = true;
      }
    }
  };

  try {
    await new FeatChoiceAutomationService(moduleApi).configureItemChoice(item);

    assert.equal(syncCalls, 1);
    assert.equal(item.system.advancement[0].configuration.pool[0].uuid, actualUuid);
    assert.equal(updates.length, 2);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
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
      options: [{ value: "lgt", label: "Light Armor", uuid: "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa" }]
    }
  });
  advancement.value = {
    added: {
      0: {
        childItemId: "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa"
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
      options: [{ value: "lgt", label: "Light Armor", uuid: "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa" }]
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

test("does not open an incomplete feat choice again when the owned feat is updated", async () => {
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
            return { steps: [{ type: "forward" }], render: () => {} };
          }
        }
      }
    }
  };

  const advancement = buildItemChoiceAdvancementData({
    identifier: "aristokratichnost",
    choiceConfig: {
      title: "Аристократичность: выберите преимущества",
      type: "multiple",
      min: 2,
      max: 6,
      options: [
        { value: "etiquette", label: "Этикет", uuid: "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa" },
        { value: "privilege", label: "Привилегия", uuid: "Compendium.world.rebreya-feats.Item.bbbbbbbbbbbbbbbb" }
      ]
    }
  });
  const actor = { documentName: "Actor", isOwner: true, items: [] };
  const item = {
    id: "feat-id",
    name: "Аристократичность",
    type: "feat",
    parent: actor,
    isOwner: true,
    system: { advancement: [advancement] },
    getFlag: () => ({
      title: "Аристократичность: выберите преимущества",
      type: "multiple",
      min: 2,
      max: 6,
      options: [
        { value: "etiquette", label: "Этикет", uuid: "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa" },
        { value: "privilege", label: "Привилегия", uuid: "Compendium.world.rebreya-feats.Item.bbbbbbbbbbbbbbbb" }
      ]
    })
  };

  try {
    const result = await new FeatChoiceAutomationService().handleItemUpdated(item, {}, {}, "user-1");

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

  assert.equal(Array.isArray(parent.system.advancement), true);
  assert.equal(getChoiceAdvancement(parent), undefined);
  assert.equal(config.min, 2);
  assert.equal(config.max, 6);
  assert.equal(config.options.length, 8);
  assert.equal(parent.effects.length, 0);
  assert.deepEqual(Object.keys(parent.system.activities ?? {}), []);

  for (const option of config.options) {
    assert.match(option.uuid, /^Compendium\.world\.rebreya-feats\.Item\.[A-Za-z0-9]{16}$/u);
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
  const config = parent.flags?.[CHOICE_FLAG_SCOPE]?.choiceConfig;

  assert.equal(getChoiceAdvancement(parent), undefined);
  assert.equal(config.count, 1);
  assert.equal(config.options.length, 3);
  assert.equal(parent.effects.length, 0);

  const optionItems = config.options.map((option) => items.find((item) => item._id === option.uuid.split(".").at(-1)));
  assert.deepEqual(optionItems.map((item) => item.name), ["Лёгкие доспехи", "Средние доспехи", "Тяжёлые доспехи"]);
  assert.deepEqual(optionItems.map((item) => item.effects[0].changes[0].value), ["lgt", "med", "hvy"]);
});

test("Guild Network cultural feat grants Insight proficiency", () => {
  const items = loadBundleItems();
  const feat = byIdentifier(items, "gildeyskaya-set");
  const description = textContent(feat.system.description.value);
  const proficiency = getEffectChange(feat, "system.skills.ins.value");

  assert.equal(feat.name, "\u0413\u0438\u043b\u044c\u0434\u0435\u0439\u0441\u043a\u0430\u044f \u0441\u0435\u0442\u044c");
  assert.equal(feat.flags.teyvankal.empty, false);
  assert.deepEqual(feat.flags.teyvankal.tags, ["\u041a\u0443\u0440\u043e\u0432\u0438\u0439\u0441\u043a\u0438\u0439 \u0441\u043e\u044e\u0437", "\u0420\u0435\u0441\u043f\u0443\u0431\u043b\u0438\u043a\u0430 \u0417\u043e\u043c\u0430\u0440"]);
  assert.match(description, /\u0412\u044b \u043f\u043e\u043b\u0443\u0447\u0430\u0435\u0442\u0435 \u0432\u043b\u0430\u0434\u0435\u043d\u0438\u0435 \u043d\u0430\u0432\u044b\u043a\u043e\u043c \u041f\u0440\u043e\u043d\u0438\u0446\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c/u);
  assert.equal(proficiency?.value, "1");
  assert.equal(proficiency?.mode, 4);
  assert.equal(feat.flags[CHOICE_FLAG_SCOPE].automation.status, "automated");
});

test("direct cultural skill proficiencies are automated as proficiency effects", () => {
  const items = loadBundleItems();
  const cultural = items.filter((item) => item.flags?.teyvankal?.sectionKey === "cultural");
  const skillKeysByName = new Map([
    ["\u0410\u043a\u0440\u043e\u0431\u0430\u0442\u0438\u043a\u0430", "acr"],
    ["\u0410\u0442\u043b\u0435\u0442\u0438\u043a\u0430", "ath"],
    ["\u0412\u044b\u0436\u0438\u0432\u0430\u043d\u0438\u0435", "sur"],
    ["\u0412\u044b\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u0435", "prf"],
    ["\u0417\u0430\u043f\u0443\u0433\u0438\u0432\u0430\u043d\u0438\u0435", "itm"],
    ["\u041b\u043e\u0432\u043a\u043e\u0441\u0442\u044c \u0440\u0443\u043a", "slt"],
    ["\u041c\u0430\u0433\u0438\u044f", "arc"],
    ["\u041c\u0435\u0434\u0438\u0446\u0438\u043d\u0430", "med"],
    ["\u041e\u0431\u043c\u0430\u043d", "dec"],
    ["\u041f\u0440\u043e\u043d\u0438\u0446\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c", "ins"],
    ["\u041f\u0440\u0438\u0440\u043e\u0434\u0430", "nat"],
    ["\u0420\u0430\u0441\u0441\u043b\u0435\u0434\u043e\u0432\u0430\u043d\u0438\u0435", "inv"],
    ["\u0420\u0435\u043b\u0438\u0433\u0438\u044f", "rel"],
    ["\u0423\u0431\u0435\u0436\u0434\u0435\u043d\u0438\u0435", "per"]
  ]);
  const failures = [];

  for (const feat of cultural) {
    const description = textContent(feat.system.description.value);
    for (const [skillName, skillKey] of skillKeysByName) {
      if (!description.includes(`\u0432\u043b\u0430\u0434\u0435\u043d\u0438\u0435 \u043d\u0430\u0432\u044b\u043a\u043e\u043c ${skillName}`)) {
        continue;
      }

      const proficiency = getEffectChange(feat, `system.skills.${skillKey}.value`);
      if (proficiency?.value !== "1" || proficiency?.mode !== 4) {
        failures.push(`${feat.name}: ${skillName}`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

test("feat bundle empty summary matches item flags", () => {
  const bundle = loadBundle();
  const emptyItems = bundle.items.filter((item) => item.flags?.teyvankal?.empty);

  assert.equal(bundle.summary.emptyCount, emptyItems.length);
});
