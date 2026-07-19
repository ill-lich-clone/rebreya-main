import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildLootgenTypeFilterOptions,
  isLootgenTypeAllowed,
  resolveMagicLootgenTypeLabel
} from "../scripts/ui/lootgen-type-filters.js";

test("lootgen type filters build distinct sorted checked options by default", () => {
  const options = buildLootgenTypeFilterOptions([
    "Оружие",
    "Снаряжение",
    "Оружие",
    "",
    "Доспех"
  ]);

  assert.deepEqual(options.map((option) => option.label), [
    "Доспех",
    "Оружие",
    "Снаряжение"
  ]);
  assert.deepEqual(options.map((option) => option.checked), [true, true, true]);
});

test("lootgen type filters exclude only explicitly disabled types", () => {
  const options = buildLootgenTypeFilterOptions(["Оружие", "Доспех"], {
    [buildLootgenTypeFilterOptions(["Оружие"])[0].key]: false
  });

  assert.equal(isLootgenTypeAllowed("Оружие", options), false);
  assert.equal(isLootgenTypeAllowed("Доспех", options), true);
  assert.equal(isLootgenTypeAllowed("Снаряжение", options), true);
});

test("lootgen magic type label uses imported item type metadata before fallback", () => {
  const document = {
    type: "equipment",
    flags: {
      "rebreya-main": {
        itemType: "Волшебная палочка",
        itemSubtype: "Боевой фокус"
      }
    },
    system: {
      type: {
        label: "Wand"
      }
    }
  };

  assert.equal(resolveMagicLootgenTypeLabel(document), "Волшебная палочка");
  assert.equal(resolveMagicLootgenTypeLabel({ type: "loot", flags: {} }), "Магический предмет");
});

test("lootgen app exposes equipment and magic type filter checkboxes", async () => {
  const [source, template] = await Promise.all([
    readFile(new URL("../scripts/ui/lootgen-app.js", import.meta.url), "utf8"),
    readFile(new URL("../templates/lootgen-app.hbs", import.meta.url), "utf8")
  ]);

  assert.match(source, /gearTypeFilters/u);
  assert.match(source, /magicTypeFilters/u);
  assert.match(source, /isLootgenTypeAllowed/u);
  assert.match(template, /data-action="lootgen-type-filter"/u);
  assert.match(template, /data-filter-group="gear"/u);
  assert.match(template, /data-filter-group="magic"/u);
});

test("lootgen app no longer exposes materials as a generation source", async () => {
  const [source, template] = await Promise.all([
    readFile(new URL("../scripts/ui/lootgen-app.js", import.meta.url), "utf8"),
    readFile(new URL("../templates/lootgen-app.hbs", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(template, /data-field="includeMaterials"/u);
  assert.doesNotMatch(template, />\s*Материалы\s*</u);
  assert.doesNotMatch(source, /this\.includeMaterials\s*=/u);
  assert.doesNotMatch(source, /if\s*\(\s*this\.includeMaterials\s*\)/u);
});
