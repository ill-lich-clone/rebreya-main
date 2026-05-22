import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChoiceEffectData,
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
  assert.equal(effect.flags.vnde.choiceAutomation.managed, true);
  assert.deepEqual(effect.flags.vnde.choiceAutomation.selectedValues, ["hvy"]);
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