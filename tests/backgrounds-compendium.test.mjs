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

function makeBackgroundWithBonusFeat(names, text = "Bonus feat choice.") {
  return {
    ...makeBackground(1),
    id: "background-bonus-choice-test",
    bonusFeat: {
      text,
      names
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

test("background alternative bonus feats use one ItemChoice with custom feat drops enabled", () => {
  const bonusFeatResolution = {
    itemUuids: [
      "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa",
      "Compendium.world.rebreya-feats.Item.bbbbbbbbbbbbbbbb"
    ],
    missingNames: []
  };

  const advancements = buildBackgroundAdvancement(
    makeBackgroundWithBonusFeat(
      ["Аристократичность", "Исполнитель"],
      "На 1-м уровне вы получаете младшую черту “Аристократичность” или “Исполнитель”."
    ),
    bonusFeatResolution
  );
  const bonusFeatAdvancement = advancements.at(-1);

  assert.equal(bonusFeatAdvancement.type, "ItemChoice");
  assert.equal(bonusFeatAdvancement.level, 0);
  assert.equal(bonusFeatAdvancement.configuration.type, "feat");
  assert.equal(bonusFeatAdvancement.configuration.allowDrops, true);
  assert.deepEqual(bonusFeatAdvancement.configuration.choices["0"], {
    count: 1,
    replacement: false
  });
  assert.deepEqual(bonusFeatAdvancement.configuration.pool, [
    { uuid: "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa" },
    { uuid: "Compendium.world.rebreya-feats.Item.bbbbbbbbbbbbbbbb" }
  ]);
});
