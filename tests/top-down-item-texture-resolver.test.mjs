import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  TOP_DOWN_ITEM_FOOTPRINTS,
  TOP_DOWN_ITEM_TEXTURES,
  TOP_DOWN_ITEM_TOKEN_SCALES
} from "../scripts/data/top-down-item-texture-catalog.js";
import {
  resolveTopDownItemPresentation,
  resolveTopDownItemTexture
} from "../scripts/data/top-down-item-texture-resolver.js";

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

test("runtime texture scale is curated per gear identity instead of inferred from weapon type", () => {
  assert.equal(
    resolveTopDownItemPresentation(managedRow("gear", "revol-ver", { gearId: "revol-ver" })).textureScale,
    1
  );
  assert.equal(
    resolveTopDownItemPresentation(managedRow("gear", "alebarda", { gearId: "alebarda" })).textureScale,
    1.5
  );
  assert.equal(
    resolveTopDownItemPresentation(managedRow("gear", "laty", { gearId: "laty" })).textureScale,
    1.5
  );
});

test("runtime presentation exposes curated furniture footprints and legacy defaults", () => {
  assert.deepEqual(
    resolveTopDownItemPresentation(managedRow("gear", "stol-bolshoy", { gearId: "stol-bolshoy" })),
    {
      img: "modules/rebreya-main/assets/top-down/items/gear/stol-bolshoy.webp",
      visualType: "",
      textureScale: 1,
      tokenWidth: 3,
      tokenHeight: 2,
      rotationMode: "cardinal"
    }
  );
  assert.deepEqual(
    resolveTopDownItemPresentation(managedRow("gear", "rapira", { gearId: "rapira" })),
    {
      img: "modules/rebreya-main/assets/top-down/items/gear/rapira.webp",
      visualType: "",
      textureScale: 1.5,
      tokenWidth: null,
      tokenHeight: null,
      rotationMode: "full"
    }
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

test("generated runtime scale overrides match every curated manifest value", async () => {
  const manifest = (await import("../data/top-down-item-assets.json", {
    with: { type: "json" }
  })).default;
  const enlarged = manifest.entries.filter((entry) => entry.tokenScale !== 1);

  assert.equal(TOP_DOWN_ITEM_TOKEN_SCALES.size, enlarged.length);
  for (const entry of manifest.entries) {
    assert.equal(
      TOP_DOWN_ITEM_TOKEN_SCALES.get(`${entry.sourceType}:${entry.sourceId}`) ?? 1,
      entry.tokenScale,
      `${entry.sourceType}:${entry.sourceId}`
    );
  }
});

test("generated runtime footprint overrides match every curated manifest value", async () => {
  const manifest = (await import("../data/top-down-item-assets.json", {
    with: { type: "json" }
  })).default;
  const footprints = manifest.entries.filter((entry) => entry.rotationMode === "cardinal");

  assert.equal(TOP_DOWN_ITEM_FOOTPRINTS.size, 12);
  assert.equal(TOP_DOWN_ITEM_FOOTPRINTS.size, footprints.length);
  for (const entry of footprints) {
    assert.deepEqual(
      TOP_DOWN_ITEM_FOOTPRINTS.get(`${entry.sourceType}:${entry.sourceId}`),
      {
        width: entry.tokenWidth,
        height: entry.tokenHeight,
        rotationMode: "cardinal"
      },
      `${entry.sourceType}:${entry.sourceId}`
    );
  }
});
