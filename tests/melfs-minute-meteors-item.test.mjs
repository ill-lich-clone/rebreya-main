import test from "node:test";
import assert from "node:assert/strict";

import {
  MELFS_ACTIVITY_IDS,
  MELFS_MINUTE_METEORS_ID,
  MELFS_MINUTE_METEORS_RECIPE,
  MELFS_MINUTE_METEORS_VERSION,
  buildMelfsMinuteMeteorsItem
} from "../scripts/data/melfs-minute-meteors-item.js";

const MODULE_ID = "rebreya-main";
const FOUNDRY_ID = /^[A-Za-z0-9]{16}$/u;

test("Melf's Minute Meteors uses the canonical Rebreya catalog title", () => {
  const item = buildMelfsMinuteMeteorsItem();

  assert.equal(item.name, "Мельфовы маленькие метеоры");
});

test("Melf's Minute Meteors creates native utility and Dexterity-save activities", () => {
  const item = buildMelfsMinuteMeteorsItem();
  const { cast, release, burst } = item.system.activities;

  assert.equal(item._id, "melfMeteorsItem1");
  assert.match(item._id, FOUNDRY_ID);
  assert.equal(MELFS_MINUTE_METEORS_ID, "melfs-minute-meteors-rebreya");
  assert.equal(MELFS_MINUTE_METEORS_RECIPE, "melfs-minute-meteors");
  assert.equal(MELFS_MINUTE_METEORS_VERSION, 1);
  for (const id of Object.values(MELFS_ACTIVITY_IDS)) assert.match(id, FOUNDRY_ID);

  assert.equal(cast._id, MELFS_ACTIVITY_IDS.CAST);
  assert.equal(cast.type, "utility");
  assert.deepEqual(cast.activation, { type: "action", value: 1, condition: "", override: false });
  assert.equal(release._id, MELFS_ACTIVITY_IDS.RELEASE);
  assert.equal(release.type, "utility");
  assert.deepEqual(release.activation, { type: "bonus", value: 1, condition: "", override: false });
  assert.equal(burst._id, MELFS_ACTIVITY_IDS.BURST);
  assert.equal(burst.type, "save");
  assert.deepEqual(burst.save, { ability: ["dex"], dc: { calculation: "spellcasting", formula: "" } });
  assert.deepEqual(burst.damage, {
    onSave: "half",
    parts: [{
      number: 2,
      denomination: 6,
      bonus: "",
      types: ["fire"],
      custom: { enabled: false, formula: "" },
      scaling: { mode: "", number: 1, formula: "" }
    }]
  });
  assert.equal(Array.isArray(burst.damage.parts[0]), false);
  assert.deepEqual(burst.target.template, { type: "radius", size: "5", units: "ft" });
  assert.equal(burst.attack, undefined);
});

test("Melf's Minute Meteors preserves concentration and charges only its cast activity", () => {
  const item = buildMelfsMinuteMeteorsItem();
  const { cast, release, burst } = item.system.activities;

  assert.equal(item.type, "spell");
  assert.equal(item.system.level, 3);
  assert.ok(item.system.properties.includes("concentration"));
  assert.deepEqual(item.system.duration, { value: "10", units: "minute", special: "" });
  assert.deepEqual(cast.consumption, {
    scaling: { allowed: true, max: "" },
    spellSlot: true,
    targets: []
  });
  assert.equal(cast.spell, undefined);
  for (const activity of [release, burst]) {
    assert.equal(activity.consumption.spellSlot, false);
    assert.equal(activity.consumption.scaling.allowed, false);
    assert.deepEqual(activity.consumption.targets, []);
  }
});

test("Melf's Minute Meteors declares the instance recipe on its Item and activities without Craftsman flags", () => {
  const item = buildMelfsMinuteMeteorsItem();

  assert.deepEqual(item.flags[MODULE_ID].spellAutomation, {
    runtime: "instance",
    recipe: "melfs-minute-meteors",
    version: 1
  });
  assert.deepEqual(item.system.activities.cast.flags[MODULE_ID].spellAutomation, {
    runtime: "instance",
    recipe: "melfs-minute-meteors",
    version: 1,
    action: "cast"
  });
  assert.deepEqual(item.system.activities.release.flags[MODULE_ID].spellAutomation, {
    runtime: "instance",
    recipe: "melfs-minute-meteors",
    version: 1,
    action: "release"
  });
  assert.deepEqual(item.system.activities.burst.flags[MODULE_ID].spellAutomation, {
    runtime: "instance",
    recipe: "melfs-minute-meteors",
    version: 1,
    action: "burst"
  });
  assert.equal(Object.keys(item.flags).some((key) => key.toLowerCase().includes("craftsman")), false);
});
