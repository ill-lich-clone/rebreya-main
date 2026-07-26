import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateCurseEaterProgress,
  collectActiveCursedItems,
  curseRankToRarity,
  getEffectiveCursedItemRarity
} from "../scripts/combat/curse-eater-automation-service.js";

function makeItem(id, {
  description = "",
  rarity = "",
  upgrade = null,
  installed = []
} = {}) {
  return {
    id,
    name: id,
    system: {
      description: { value: description },
      rarity
    },
    flags: {
      "rebreya-main": {
        ...(upgrade ? { upgrade } : {}),
        ...(installed.length ? {
          itemUpgrades: {
            capacity: installed.length,
            installed: installed.map((itemId, index) => ({ itemId, slotIndex: index + 1 }))
          }
        } : {})
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function makeActor(items, slots) {
  const actor = {
    items: new Map(items.map((item) => [item.id, item])),
    flags: {
      "rebreya-main": {
        heroDoll: { version: 1, slots }
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
  for (const item of items) {
    item.actor = actor;
    item.parent = actor;
  }
  return actor;
}

test("curse ranks map to the five non-artifact rarity bands", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(curseRankToRarity),
    [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]
  );
});

test("only cursed parent items on the hero doll are collected", () => {
  const crown = makeItem("crown", {
    rarity: "rare",
    description: "<p>ПРОКЛЯТЬЕ: шёпот.</p>"
  });
  const coat = makeItem("coat", {
    rarity: "legendary",
    installed: ["minor-curse"]
  });
  const minorCurse = makeItem("minor-curse", {
    upgrade: { type: "Проклятье", rank: 3 }
  });
  const bag = makeItem("bag", {
    rarity: "artifact",
    description: "<p>Проклятие: забыто.</p>"
  });
  const actor = makeActor(
    [crown, coat, minorCurse, bag],
    {
      head: { itemId: "crown" },
      chest: { itemId: "coat" }
    }
  );

  assert.deepEqual(
    collectActiveCursedItems(actor).map(({ itemId, rarity }) => [itemId, rarity]),
    [["crown", 2], ["coat", 4]]
  );
  assert.equal(getEffectiveCursedItemRarity(coat), 4);
});

test("tier matching saves stronger items for later requirements", () => {
  const progress = calculateCurseEaterProgress([
    { itemId: "rare", rarity: 2 },
    { itemId: "artifact", rarity: 5 }
  ]);

  assert.equal(progress.tier, 2);
  assert.deepEqual(progress.usedItemIds, ["rare", "artifact"]);
});

test("common plus legendary reaches only the first tier", () => {
  const progress = calculateCurseEaterProgress([
    { itemId: "common", rarity: 0 },
    { itemId: "legendary", rarity: 4 }
  ]);

  assert.equal(progress.tier, 1);
  assert.deepEqual(progress.usedItemIds, ["legendary"]);
});
