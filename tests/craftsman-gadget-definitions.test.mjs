import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value))
  }
};

const {
  CRAFTSMAN_GADGET_IDS,
  buildCraftsmanGadgetAutomation,
  buildCraftsmanGadgetFeatureDefinitions,
  normalizeCraftsmanGadgets
} = await import("../scripts/data/craftsman-gadget-definitions.js");

const source = JSON.parse(readFileSync(join(process.cwd(), "data/craftsman-v01.json"), "utf8"));

function gadgetBlock(markdown, name, nextName = "") {
  const startMarker = `**${name}.**`;
  const start = markdown.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source block for ${name}`);
  const end = nextName ? markdown.indexOf(`**${nextName}.**`, start + startMarker.length) : markdown.length;
  assert.notEqual(end, -1, `missing next source block after ${name}`);
  return markdown.slice(start, end).trim();
}

test("catalog contains exactly four base and two Mechanic gadgets", () => {
  const gadgets = normalizeCraftsmanGadgets(source);
  assert.deepEqual(gadgets.map((entry) => entry.id), [
    CRAFTSMAN_GADGET_IDS.FORCE_GLOVE,
    CRAFTSMAN_GADGET_IDS.MAGNETIC_ENGINE,
    CRAFTSMAN_GADGET_IDS.CHARGED_BOOT,
    CRAFTSMAN_GADGET_IDS.SMOKE_DEVICE,
    CRAFTSMAN_GADGET_IDS.AFTERBURNER_INJECTOR,
    CRAFTSMAN_GADGET_IDS.EMERGENCY_REGULATOR
  ]);
  assert.deepEqual(gadgets.map((entry) => entry.availability), [
    "base", "base", "base", "base", "mechanic", "mechanic"
  ]);
});

test("gadget descriptions copy the existing source blocks verbatim", () => {
  const base = source.class.features.find((feature) => feature.id === "gadget").descriptionMarkdown;
  const mechanic = source.researches
    .find((entry) => entry.id === "craftsman-research-mechanic")
    .features.find((feature) => feature.id === "vehicle-training").descriptionMarkdown;
  const expected = new Map([
    ["Силовая перчатка", gadgetBlock(base, "Силовая перчатка", "Магнитный движок")],
    ["Магнитный движок", gadgetBlock(base, "Магнитный движок", "Заряженный ботинок")],
    ["Заряженный ботинок", gadgetBlock(base, "Заряженный ботинок", "Дымовой аппарат")],
    ["Дымовой аппарат", gadgetBlock(base, "Дымовой аппарат")],
    ["Форсажный инжектор (транспорт)", gadgetBlock(mechanic, "Форсажный инжектор (транспорт)", "Аварийный регулятор (транспорт)")],
    ["Аварийный регулятор (транспорт)", gadgetBlock(mechanic, "Аварийный регулятор (транспорт)")]
  ]);

  for (const gadget of normalizeCraftsmanGadgets(source)) {
    assert.equal(gadget.descriptionMarkdown, expected.get(gadget.name));
  }
});

test("each gadget publishes three native activities with stable operation flags", () => {
  for (const gadget of normalizeCraftsmanGadgets(source)) {
    const automation = buildCraftsmanGadgetAutomation(gadget);
    const activities = Object.values(automation.activities);
    assert.equal(activities.length, 3);
    assert.deepEqual(activities.map((activity) => activity.type), [
      "utility", "utility", gadget.id === "magnetic-engine" ? "attack" : "utility"
    ]);
    assert.deepEqual(activities.map((activity) => activity.activation.type), ["bonus", "special", "special"]);
    assert.deepEqual(activities.map((activity) => activity.flags["rebreya-main"].craftsmanGadget.operation), [
      "activate", "activate", "action"
    ]);
    assert.ok(activities.every((activity) => activity.flags["rebreya-main"].craftsmanGadget.gadgetId === gadget.id));
  }
});

test("gadget templates are managed feature definitions but are not class advancements", () => {
  const definitions = buildCraftsmanGadgetFeatureDefinitions(normalizeCraftsmanGadgets(source));
  assert.equal(definitions.length, 6);
  assert.ok(definitions.every((definition) => definition.sourceType === "craftsmanGadget"));
  assert.ok(definitions.every((definition) => definition.optional === true));
  assert.ok(definitions.every((definition) => definition.featureId.startsWith("craftsman-v01::gadget::")));
});

test("Magnetic Engine gadget action is a native Intelligence attack at 30 feet", () => {
  const gadget = normalizeCraftsmanGadgets(source).find((entry) => entry.id === "magnetic-engine");
  const activity = Object.values(buildCraftsmanGadgetAutomation(gadget))
    .flatMap((value) => value && typeof value === "object" ? Object.values(value) : [])
    .find((entry) => entry?.flags?.["rebreya-main"]?.craftsmanGadget?.operation === "action");
  assert.equal(activity.type, "attack");
  assert.equal(activity.attack.ability, "int");
  assert.deepEqual(activity.attack.type, { value: "ranged", classification: "weapon" });
  assert.deepEqual(activity.range, { value: 30, units: "ft", special: "", override: true });
});

test("Smoke Device activation uses one native 15-foot cube template", () => {
  const gadget = normalizeCraftsmanGadgets(source).find((entry) => entry.id === "smoke-device");
  const activation = Object.values(buildCraftsmanGadgetAutomation(gadget).activities)
    .find((entry) => entry.flags["rebreya-main"].craftsmanGadget.operation === "activate");
  assert.deepEqual(activation.target.template, {
    count: "1", contiguous: false, type: "cube", size: "15", width: "", height: "", units: "ft"
  });
  assert.equal(activation.target.prompt, true);
});
