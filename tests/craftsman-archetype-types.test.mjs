import test from "node:test";
import assert from "node:assert/strict";
import { registerLegacyCraftsmanArchetypeTypes } from "../scripts/integrations/craftsman-archetype-types.js";
import {
  RESEARCH_ITEM_TYPE,
  SPECIALTY_ITEM_TYPE
} from "../scripts/constants.js";

function mergeObject(original, other, { inplace = true } = {}) {
  const target = inplace ? original : { ...(original ?? {}) };
  for (const [key, value] of Object.entries(other ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Set)) {
      target[key] = mergeObject(target[key] ?? {}, value, { inplace: true });
    }
    else {
      target[key] = value;
    }
  }
  return target;
}

function installDnd5eStubs() {
  class SubclassData {
    static metadata = Object.freeze({ singleton: false });

    async getSheetData() {}
  }

  globalThis.foundry = { utils: { mergeObject } };
  globalThis.CONFIG = {
    Item: {
      dataModels: { subclass: SubclassData },
      typeIcons: {},
      typeLabels: {}
    },
    DND5E: {
      advancementTypes: {
        ItemGrant: {
          documentClass: class ItemGrantAdvancement {},
          validItemTypes: new Set(["class", "subclass"])
        }
      }
    }
  };
  globalThis.game = {
    dnd5e: { documents: { advancement: {} } },
    i18n: { localize: (key) => key }
  };

  return { SubclassData };
}

test("legacy Craftsman item types remain readable without custom choice advancements", () => {
  const originalConfig = globalThis.CONFIG;
  const originalFoundry = globalThis.foundry;
  const originalGame = globalThis.game;
  const { SubclassData } = installDnd5eStubs();

  try {
    assert.equal(registerLegacyCraftsmanArchetypeTypes(), true);
    assert.equal(CONFIG.Item.dataModels[RESEARCH_ITEM_TYPE].prototype instanceof SubclassData, true);
    assert.equal(CONFIG.Item.dataModels[SPECIALTY_ITEM_TYPE].prototype instanceof SubclassData, true);
    assert.equal(CONFIG.DND5E.advancementTypes.ResearchChoice, undefined);
    assert.equal(CONFIG.DND5E.advancementTypes.SpecialtyChoice, undefined);
    assert.deepEqual([...CONFIG.DND5E.advancementTypes.ItemGrant.validItemTypes], ["class", "subclass"]);
  }
  finally {
    globalThis.CONFIG = originalConfig;
    globalThis.foundry = originalFoundry;
    globalThis.game = originalGame;
  }
});

test("legacy Craftsman item registration fails closed without the subclass data model", () => {
  const originalConfig = globalThis.CONFIG;
  const originalGame = globalThis.game;
  globalThis.CONFIG = { Item: {}, DND5E: { advancementTypes: {} } };
  globalThis.game = {};

  try {
    assert.equal(registerLegacyCraftsmanArchetypeTypes(), false);
    assert.equal(CONFIG.Item.dataModels, undefined);
  }
  finally {
    globalThis.CONFIG = originalConfig;
    globalThis.game = originalGame;
  }
});
