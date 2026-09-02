import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { TOP_DOWN_ITEM_TEXTURES } from "../scripts/data/top-down-item-texture-catalog.js";
import { resolveTopDownItemTexture } from "../scripts/data/top-down-item-texture-resolver.js";

function managedRow(sourceType, sourceId, moduleIdentity = {}) {
  return {
    sourceType,
    sourceId,
    name: "Канонический предмет",
    img: "icons/original-item-icon.webp",
    itemData: {
      name: "Канонический предмет",
      img: "icons/original-item-icon.webp",
      flags: {
        [MODULE_ID]: {
          sourceType,
          sourceId,
          ...moduleIdentity
        }
      }
    }
  };
}

test("managed gear identities resolve distinct canonical top-down textures", () => {
  assert.equal(
    resolveTopDownItemTexture(managedRow("gear", "rapira", { gearId: "rapira" })),
    "modules/rebreya-main/assets/top-down/items/gear/rapira.webp"
  );
  assert.equal(
    resolveTopDownItemTexture(managedRow("gear", "dlinnyy-mech", { gearId: "dlinnyy-mech" })),
    "modules/rebreya-main/assets/top-down/items/gear/dlinnyy-mech.webp"
  );
});

test("different managed ammunition identities do not collapse to one texture", () => {
  assert.equal(
    resolveTopDownItemTexture(managedRow("gear", "adamantovaya-pulya-10", { gearId: "adamantovaya-pulya-10" })),
    "modules/rebreya-main/assets/top-down/items/gear/adamantovaya-pulya-10.webp"
  );
  assert.equal(
    resolveTopDownItemTexture(managedRow("gear", "ekspansivnye-puli-5", { gearId: "ekspansivnye-puli-5" })),
    "modules/rebreya-main/assets/top-down/items/gear/ekspansivnye-puli-5.webp"
  );
});

test("managed materials resolve by material identity", () => {
  assert.equal(
    resolveTopDownItemTexture(managedRow("material", "material-10", { materialId: "material-10" })),
    "modules/rebreya-main/assets/top-down/items/material/material-10.webp"
  );
});

test("legacy managed gear with gearId but no flag sourceId remains supported", () => {
  const row = managedRow("gear", "rapira", { gearId: "rapira" });
  delete row.itemData.flags[MODULE_ID].sourceId;

  assert.equal(
    resolveTopDownItemTexture(row),
    "modules/rebreya-main/assets/top-down/items/gear/rapira.webp"
  );
});

test("resolved Foundry Item rows use canonical module flags instead of their document type and UUID", () => {
  assert.equal(resolveTopDownItemTexture({
    sourceType: "weapon",
    sourceId: "Compendium.world.rebreya-gear.Item.rapier-document",
    itemData: {
      flags: {
        [MODULE_ID]: {
          managed: true,
          sourceType: "gear",
          gearId: "rapira"
        }
      }
    }
  }), "modules/rebreya-main/assets/top-down/items/gear/rapira.webp");

  assert.equal(resolveTopDownItemTexture({
    sourceType: "loot",
    sourceId: "Compendium.world.rebreya-materials.Item.monster-hoof-document",
    itemData: {
      flags: {
        [MODULE_ID]: {
          managed: true,
          materialId: "material-10"
        }
      }
    }
  }), "modules/rebreya-main/assets/top-down/items/material/material-10.webp");
});

test("conflicting, unknown, and external identities return null", () => {
  assert.equal(resolveTopDownItemTexture(managedRow("gear", "rapira", {
    gearId: "dlinnyy-mech"
  })), null);
  assert.equal(resolveTopDownItemTexture(managedRow("material", "material-10", {
    materialId: "material-11",
    sourceId: "material-10"
  })), null);
  assert.equal(resolveTopDownItemTexture(managedRow("gear", "unknown-gear", {
    gearId: "unknown-gear"
  })), null);
  assert.equal(resolveTopDownItemTexture({
    sourceType: "gear",
    sourceId: "rapira",
    name: "Сторонняя рапира",
    img: "icons/external.webp",
    itemData: { flags: {} }
  }), null);
});

test("resolver does not mutate storage rows", () => {
  const row = managedRow("gear", "rapira", { gearId: "rapira" });
  const before = structuredClone(row);

  resolveTopDownItemTexture(row);

  assert.deepEqual(row, before);
});

test("generated runtime catalog covers every accepted manifest entry", async () => {
  const manifest = (await import("../data/top-down-item-assets.json", {
    with: { type: "json" }
  })).default;

  assert.equal(TOP_DOWN_ITEM_TEXTURES.size, 1015);
  for (const entry of manifest.entries) {
    assert.equal(
      TOP_DOWN_ITEM_TEXTURES.get(`${entry.sourceType}:${entry.sourceId}`),
      `modules/rebreya-main/${entry.assetPath}`,
      `${entry.sourceType}:${entry.sourceId}`
    );
  }
});
