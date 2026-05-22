import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildChoiceEffectData,
  buildChoiceDialogContent,
  CHOICE_FLAG_SCOPE,
  FeatChoiceAutomationService,
  getSelectedChoiceValues,
  normalizeChoiceConfig
} from "../scripts/automation/feat-choice-service.js";

test("normalizes a single feat choice config and selected value", () => {
  const config = normalizeChoiceConfig({
    title: "Armor Expert",
    type: "single",
    count: 1,
    selectedValue: "med",
    options: [
      { value: "lgt", label: "Light Armor" },
      { value: "med", label: "Medium Armor" }
    ],
    effectChanges: {
      med: [{ key: "system.traits.armorProf.value", mode: 2, value: "med" }]
    }
  });

  assert.equal(config.title, "Armor Expert");
  assert.equal(config.count, 1);
  assert.deepEqual(getSelectedChoiceValues(config), ["med"]);
});

test("builds a transferred item Active Effect from selected choice changes", () => {
  const config = normalizeChoiceConfig({
    title: "Choose armor training",
    selectedValue: "hvy",
    options: [
      { value: "hvy", label: "Heavy Armor" }
    ],
    effectChanges: {
      hvy: [{ key: "system.traits.armorProf.value", mode: 2, value: "hvy", priority: null }]
    }
  });

  const effect = buildChoiceEffectData({
    name: "Armor Expert",
    img: "icons/svg/shield.svg",
    uuid: "Actor.abc.Item.def"
  }, config);

  assert.equal(effect.transfer, true);
  assert.equal(effect.origin, "Actor.abc.Item.def");
  assert.equal(effect.name, "Armor Expert: Heavy Armor");
  assert.deepEqual(effect.changes, [
    { key: "system.traits.armorProf.value", mode: 2, value: "hvy", priority: null }
  ]);
  assert.equal(CHOICE_FLAG_SCOPE, "rebreya-main");
  assert.equal(effect.flags["rebreya-main"].choiceAutomation.managed, true);
  assert.deepEqual(effect.flags["rebreya-main"].choiceAutomation.selectedValues, ["hvy"]);
});

test("expands template effect changes for multiple selected values", () => {
  const config = normalizeChoiceConfig({
    title: "Choose two tools",
    type: "multiple",
    count: 2,
    selectedValues: ["smith", "cook"],
    options: [
      { value: "smith", label: "Smith Tools" },
      { value: "cook", label: "Cook Tools" }
    ],
    effectChanges: [
      { key: "system.tools.{{value}}.value", mode: 4, value: "1", priority: 20 }
    ]
  });

  const effect = buildChoiceEffectData({ name: "Training" }, config);

  assert.deepEqual(effect.changes, [
    { key: "system.tools.smith.value", mode: 4, value: "1", priority: 20 },
    { key: "system.tools.cook.value", mode: 4, value: "1", priority: 20 }
  ]);
});

test("normalizes ranged multiple choices without truncating valid selections", () => {
  const config = normalizeChoiceConfig({
    title: "Aristocraticness",
    type: "multiple",
    min: 2,
    max: 6,
    selectedValues: ["etiquette", "intrigue", "history"],
    options: [
      { value: "etiquette", label: "Polished Etiquette" },
      { value: "intrigue", label: "Aristocratic Intrigue" },
      { value: "history", label: "Historical References" }
    ]
  });

  assert.equal(config.type, "multiple");
  assert.equal(config.minCount, 2);
  assert.equal(config.maxCount, 3);
  assert.deepEqual(getSelectedChoiceValues(config), ["etiquette", "intrigue", "history"]);
});

test("builds effect changes for every selected value in a ranged choice", () => {
  const config = normalizeChoiceConfig({
    title: "Choose noble benefits",
    type: "multiple",
    min: 2,
    max: 6,
    selectedValues: ["insight", "investigation", "history"],
    options: [
      {
        value: "insight",
        label: "Insight",
        effectChanges: [{ key: "system.skills.ins.bonuses.check", mode: 2, value: "2" }]
      },
      {
        value: "investigation",
        label: "Investigation",
        effectChanges: [{ key: "system.skills.inv.bonuses.check", mode: 2, value: "2" }]
      },
      {
        value: "history",
        label: "History",
        effectChanges: [{ key: "system.skills.his.bonuses.check", mode: 2, value: "2" }]
      }
    ]
  });

  const effect = buildChoiceEffectData({ name: "Aristocraticness" }, config);

  assert.deepEqual(effect.changes, [
    { key: "system.skills.ins.bonuses.check", mode: 2, value: "2", priority: null },
    { key: "system.skills.inv.bonuses.check", mode: 2, value: "2", priority: null },
    { key: "system.skills.his.bonuses.check", mode: 2, value: "2", priority: null }
  ]);
});

test("allows completed narrative choices without warning about missing effects", async () => {
  const previousUi = globalThis.ui;
  let warnings = 0;
  let deletedEffectIds = [];
  globalThis.ui = { notifications: { warn: () => { warnings += 1; } } };

  const item = {
    name: "Narrative Feat",
    getFlag: () => ({
      title: "Choose noble benefits",
      type: "multiple",
      min: 2,
      max: 6,
      effectRequired: false,
      selectedValues: ["etiquette", "servants"],
      options: [
        { value: "etiquette", label: "Polished Etiquette" },
        { value: "servants", label: "Servants" }
      ]
    }),
    effects: [
      {
        id: "managed-effect",
        flags: {
          "rebreya-main": {
            choiceAutomation: { managed: true }
          }
        }
      }
    ],
    deleteEmbeddedDocuments: async (_type, ids) => {
      deletedEffectIds = ids;
    },
    updateEmbeddedDocuments: async () => {
      throw new Error("No Active Effect should be updated for narrative-only choices");
    },
    createEmbeddedDocuments: async () => {
      throw new Error("No Active Effect should be created for narrative-only choices");
    }
  };

  try {
    const result = await new FeatChoiceAutomationService().configureItemChoice(item, { promptIfMissing: false });

    assert.equal(result, true);
    assert.equal(warnings, 0);
    assert.deepEqual(deletedEffectIds, ["managed-effect"]);
  }
  finally {
    globalThis.ui = previousUi;
  }
});

test("renders multiple choices as item cards with a description preview", () => {
  const config = normalizeChoiceConfig({
    title: "Choose noble benefits",
    type: "multiple",
    min: 2,
    max: 6,
    options: [
      {
        value: "etiquette",
        label: "Polished Etiquette",
        summary: "Advantage on noble etiquette checks.",
        description: "You know the etiquette and customs of high society."
      },
      {
        value: "intrigue",
        label: "Aristocratic Intrigue",
        summary: "+2 to Insight and Investigation.",
        description: "Local intrigues sharpened your wit."
      }
    ]
  });

  const html = buildChoiceDialogContent(config, ["intrigue"]);

  assert.match(html, /rm-feat-choice-grid/u);
  assert.match(html, /data-choice-card/u);
  assert.match(html, /data-choice-preview/u);
  assert.match(html, /data-choice-count/u);
  assert.match(html, /Local intrigues sharpened your wit\./u);
  assert.match(html, /Advantage on noble etiquette checks\./u);
});

test("Aristocraticness compendium config offers two to six selectable benefits", () => {
  const bundleUrl = new URL("../cherty-v08-foundry-2014-import-pack/cherty-v08-foundry-2014-bundle.json", import.meta.url);
  const bundle = JSON.parse(readFileSync(bundleUrl, "utf8"));
  const feat = bundle.items.find((item) => item.system?.identifier === "aristokratichnost");
  const choiceConfig = feat.flags?.[CHOICE_FLAG_SCOPE]?.choiceConfig;

  const config = normalizeChoiceConfig({
    ...choiceConfig,
    selectedValues: ["aristocratic-intrigue", "historical-references"]
  });
  const effect = buildChoiceEffectData(feat, config);

  assert.equal(feat.effects.length, 0);
  assert.equal(config.minCount, 2);
  assert.equal(config.maxCount, 6);
  assert.equal(config.options.length, 8);
  assert.equal(config.options.every((option) => typeof option.description === "string" && option.description.length > 40), true);
  assert.deepEqual(effect.changes, [
    { key: "system.skills.ins.bonuses.check", mode: 2, value: "2", priority: null },
    { key: "system.skills.inv.bonuses.check", mode: 2, value: "2", priority: null },
    { key: "system.skills.his.bonuses.check", mode: 2, value: "2", priority: null }
  ]);
});
