import test from "node:test";
import assert from "node:assert/strict";

import { buildBackgroundAdvancement } from "../scripts/data/backgrounds-compendium.js";

function makeBackground(level) {
  return {
    id: `background-${level}-test`,
    level,
    skillText: "Insight.",
    toolText: "One gaming set.",
    languageText: "One language.",
    skillProficiencies: {
      grants: ["ins"],
      choices: []
    },
    toolProficiencies: {
      grants: [],
      choices: [{ count: 1, pool: ["tool:game:*"] }]
    },
    languageChoices: {
      grants: [],
      choices: [{ count: 1, pool: ["languages:*"] }]
    },
    bonusFeat: {
      text: "Bonus feat.",
      names: ["Test Feat"]
    }
  };
}

test("background advancements apply at level 0 so classless actors receive them", () => {
  const bonusFeatResolution = {
    itemUuids: ["Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa"],
    missingNames: []
  };

  for (const sourceLevel of [1, 5]) {
    const advancements = buildBackgroundAdvancement(makeBackground(sourceLevel), bonusFeatResolution);

    assert.equal(advancements.length, 4);
    assert.deepEqual(advancements.map((advancement) => advancement.level), [0, 0, 0, 0]);
    assert.deepEqual(advancements.map((advancement) => advancement.type), ["Trait", "Trait", "Trait", "ItemGrant"]);
  }
});
