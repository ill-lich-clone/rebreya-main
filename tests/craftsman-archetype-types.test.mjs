import test from "node:test";
import assert from "node:assert/strict";
import {
  getCraftsmanAdvancementClasses,
  hasDuplicateCraftsmanArchetype,
  registerCraftsmanArchetypeTypes
} from "../scripts/integrations/craftsman-archetype-types.js";
import {
  RESEARCH_ITEM_TYPE,
  SPECIALTY_ITEM_TYPE
} from "../scripts/constants.js";

function mergeObject(original, other, { inplace = true } = {}) {
  const target = inplace ? original : structuredClone(original ?? {});
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

  class ItemChoiceAdvancement {
    static VALID_TYPES = new Set(["feat"]);

    static get metadata() {
      return {
        apps: { config: class Config {}, flow: class Flow {} },
        hint: "Item choice hint",
        title: "Item choice"
      };
    }
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
    dnd5e: { documents: { advancement: { ItemChoiceAdvancement } } },
    i18n: {
      localize: (key) => key
    }
  };

  return { ItemChoiceAdvancement, SubclassData };
}

test("craftsman archetype types inherit subclass data without widening ItemChoice", () => {
  const originalConfig = globalThis.CONFIG;
  const originalFoundry = globalThis.foundry;
  const originalGame = globalThis.game;
  const { ItemChoiceAdvancement, SubclassData } = installDnd5eStubs();

  try {
    assert.equal(registerCraftsmanArchetypeTypes(), true);
    const { ResearchChoice, SpecialtyChoice } = getCraftsmanAdvancementClasses();

    assert.equal(CONFIG.Item.dataModels[RESEARCH_ITEM_TYPE].prototype instanceof SubclassData, true);
    assert.equal(CONFIG.Item.dataModels[SPECIALTY_ITEM_TYPE].prototype instanceof SubclassData, true);
    assert.deepEqual([...ResearchChoice.VALID_TYPES], [RESEARCH_ITEM_TYPE]);
    assert.deepEqual([...SpecialtyChoice.VALID_TYPES], [SPECIALTY_ITEM_TYPE]);
    assert.deepEqual([...CONFIG.DND5E.advancementTypes.ResearchChoice.validItemTypes], ["class"]);
    assert.deepEqual([...CONFIG.DND5E.advancementTypes.SpecialtyChoice.validItemTypes], ["class"]);
    assert.equal(CONFIG.DND5E.advancementTypes.ItemGrant.validItemTypes.has(RESEARCH_ITEM_TYPE), true);
    assert.equal(CONFIG.DND5E.advancementTypes.ItemGrant.validItemTypes.has(SPECIALTY_ITEM_TYPE), true);
    assert.equal(ItemChoiceAdvancement.VALID_TYPES.has(RESEARCH_ITEM_TYPE), false);
    assert.equal(ItemChoiceAdvancement.VALID_TYPES.has(SPECIALTY_ITEM_TYPE), false);
  }
  finally {
    globalThis.CONFIG = originalConfig;
    globalThis.foundry = originalFoundry;
    globalThis.game = originalGame;
  }
});

test("craftsman archetype duplicate detection is scoped by axis and class", () => {
  const actor = {
    items: [
      {
        id: "research-a",
        type: RESEARCH_ITEM_TYPE,
        system: { classIdentifier: "craftsman-v01" }
      },
      {
        id: "specialty-other-class",
        type: SPECIALTY_ITEM_TYPE,
        system: { classIdentifier: "another-class" }
      }
    ]
  };

  assert.equal(hasDuplicateCraftsmanArchetype(actor, {
    type: RESEARCH_ITEM_TYPE,
    system: { classIdentifier: "craftsman-v01" }
  }), true);
  assert.equal(hasDuplicateCraftsmanArchetype(actor, {
    type: SPECIALTY_ITEM_TYPE,
    system: { classIdentifier: "craftsman-v01" }
  }), false);
  assert.equal(hasDuplicateCraftsmanArchetype(actor, {
    id: "research-a",
    type: RESEARCH_ITEM_TYPE,
    system: { classIdentifier: "craftsman-v01" }
  }, { excludeId: "research-a" }), false);
});

test("craftsman archetype registration fails closed without dnd5e", () => {
  const originalConfig = globalThis.CONFIG;
  const originalGame = globalThis.game;
  globalThis.CONFIG = { Item: {}, DND5E: {} };
  globalThis.game = {};

  try {
    assert.equal(registerCraftsmanArchetypeTypes(), false);
    assert.equal(CONFIG.Item.dataModels, undefined);
  }
  finally {
    globalThis.CONFIG = originalConfig;
    globalThis.game = originalGame;
  }
});
