import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    getProperty: (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object),
    setProperty: (object, path, value) => {
      const keys = String(path ?? "").split(".").filter(Boolean);
      let cursor = object;
      while (keys.length > 1) {
        const key = keys.shift();
        cursor[key] ??= {};
        cursor = cursor[key];
      }
      cursor[keys[0]] = value;
      return true;
    }
  }
};

const { normalizeFeatItems } = await import("../scripts/data/feats-compendium.js");

function loadBundleItems() {
  const bundleUrl = new URL("../cherty-v08-foundry-2014-import-pack/cherty-v08-foundry-2014-bundle.json", import.meta.url);
  return JSON.parse(readFileSync(bundleUrl, "utf8")).items;
}

test("Elemental Adept remains one repeatable runtime-managed feat without choice documents", () => {
  const bundleItems = loadBundleItems();
  const elementalAdepts = bundleItems.filter((item) => item.type === "feat" && item.system?.identifier === "stihiynyy-adept");

  assert.equal(elementalAdepts.length, 1);
  const elementalAdept = elementalAdepts[0];
  assert.equal(elementalAdept.system.prerequisites.repeatable, true);
  assert.equal(
    Object.values(elementalAdept.system.advancement ?? {}).some((advancement) => advancement?.type === "ItemChoice"),
    false
  );
  assert.equal(
    bundleItems.some((item) => item.flags?.["rebreya-main"]?.choiceOption?.parentIdentifier === "stihiynyy-adept"),
    false
  );
  assert.equal(elementalAdept.system.activities && Object.keys(elementalAdept.system.activities).length, 0);
  assert.equal(elementalAdept.effects.length, 0);
  assert.equal(elementalAdept.flags["rebreya-main"].automation.status, "full");
  assert.deepEqual(elementalAdept.flags["rebreya-main"].automation.runtime, {
    service: "ElementalAdeptAutomationService"
  });
  assert.match(elementalAdept.flags["rebreya-main"].automation.notes, /ElementalAdeptAutomationService/u);
});

test("performer feat exposes automated active performance runtime activity", () => {
  const feats = normalizeFeatItems(loadBundleItems());
  const performer = feats.find((feat) => feat.featId === "ispolnitel");
  const activities = Object.values(performer.system.activities);

  assert.equal(activities.length, 1);
  const activity = activities[0];
  assert.equal(activity.name, "Активное выступление");
  assert.equal(activity.type, "utility");
  assert.equal(activity.img, "systems/dnd5e/icons/svg/activity/utility.svg");
  assert.equal(activity.activation.type, "bonus");
  assert.equal(activity.range.value, 60);
  assert.equal(activity.range.units, "ft");
  assert.equal(activity.target.prompt, true);
  assert.equal(activity.target.affects.type, "creature");
  assert.equal(activity.check, undefined);
  assert.deepEqual(activity.consumption.targets, []);
  assert.equal(performer.system.uses.max, "2");
  assert.deepEqual(performer.system.uses.recovery, [{ period: "lr", type: "recoverAll", formula: "" }]);
  assert.deepEqual(activity.flags["rebreya-main"].runtime, {
    action: "activePerformance",
    dc: 20,
    skill: "prf",
    ability: "cha",
    successFormula: "1d5",
    failureFormula: "1d3",
    durationSeconds: 60
  });
  assert.equal(performer.flags["rebreya-main"].automation.status, "active");
});
