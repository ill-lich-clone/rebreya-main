import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCulturalFeatChoiceAdvancement,
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
