import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCulturalFeatChoiceAdvancement,
  createStateItemData,
  resolveCulturalFeats
} from "../scripts/data/states-compendium.js";

function makeFeatLookup({ culturalFeatUuids = [], recordsByName = [] } = {}) {
  const lookup = new Map(recordsByName);
  lookup.culturalFeatUuids = culturalFeatUuids;
  return lookup;
}

test("states without linked cultural feats choose two from all cultural feats", () => {
  const state = {
    id: "unlinked-state",
    name: "Unlinked State",
    culturalFeatNames: []
  };
  const featUuids = [
    "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa",
    "Compendium.world.rebreya-feats.Item.bbbbbbbbbbbbbbbb",
    "Compendium.world.rebreya-feats.Item.cccccccccccccccc"
  ];

  const resolution = resolveCulturalFeats(state, makeFeatLookup({ culturalFeatUuids: featUuids }));
  const advancement = buildCulturalFeatChoiceAdvancement(state, resolution);

  assert.equal(resolution.usesFallbackPool, true);
  assert.deepEqual(resolution.itemUuids, featUuids);
  assert.equal(advancement.type, "ItemChoice");
  assert.equal(advancement.level, 0);
  assert.equal(advancement.configuration.type, "feat");
  assert.equal(advancement.configuration.allowDrops, false);
  assert.deepEqual(advancement.configuration.choices["0"], {
    count: 2,
    replacement: false
  });
  assert.deepEqual(advancement.configuration.pool, featUuids.map((uuid) => ({ uuid })));
});

test("states with linked cultural feats keep their explicit feat pool", () => {
  const linkedUuid = "Compendium.world.rebreya-feats.Item.linked0000000001";
  const fallbackUuid = "Compendium.world.rebreya-feats.Item.fallback00000001";
  const state = {
    id: "linked-state",
    name: "Linked State",
    culturalFeatNames: ["Linked Feat"]
  };
  const lookup = makeFeatLookup({
    culturalFeatUuids: [fallbackUuid],
    recordsByName: [
      ["linked feat", [{ uuid: linkedUuid, sectionKey: "cultural", section: "cultural feats" }]]
    ]
  });

  const resolution = resolveCulturalFeats(state, lookup);
  const advancement = buildCulturalFeatChoiceAdvancement(state, resolution);

  assert.equal(resolution.usesFallbackPool, false);
  assert.deepEqual(resolution.itemUuids, [linkedUuid]);
  assert.equal(advancement.level, 0);
  assert.deepEqual(advancement.configuration.choices["0"], {
    count: 1,
    replacement: false
  });
  assert.deepEqual(advancement.configuration.pool, [{ uuid: linkedUuid }]);
});

test("state item data prefers a module-owned icon matched by state name", () => {
  const previousConst = globalThis.CONST;
  const previousFoundry = globalThis.foundry;
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
  globalThis.foundry = { utils: { deepClone: (value) => structuredClone(value) } };
  try {
    const iconPath = "modules/rebreya-main/templates/icons/States/%D0%90%D0%B7%D0%B0%D0%B4%D1%80%D0%B0%D0%BD%D1%81%D0%BA%D0%B0%D1%8F%20%D0%B8%D0%BC%D0%BF%D0%B5%D1%80%D0%B8%D1%8F.webp";
    const itemData = createStateItemData({
      state: {
        id: "azadran-empire",
        name: "Азадранская империя",
        rank: 8,
        continent: "Северный континент",
        languages: { native: "Азадранский", dominant: "" },
        culturalFeatNames: []
      },
      culturalFeatResolution: { missingNames: [] },
      system: {},
      folderPath: ["Государства Тейванкаля"],
      signature: "state-signature"
    }, new Map(), new Map([["азадранская империя", iconPath]]));

    assert.equal(itemData.img, iconPath);
  }
  finally {
    globalThis.CONST = previousConst;
    globalThis.foundry = previousFoundry;
  }
});
