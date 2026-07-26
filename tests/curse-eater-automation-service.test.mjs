import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCurseEaterEffectData,
  calculateCurseEaterProgress,
  collectActiveCursedItems,
  CurseEaterAutomationService,
  curseRankToRarity,
  getEffectiveCursedItemRarity,
  promptCurseEaterAbilityChoice
} from "../scripts/combat/curse-eater-automation-service.js";

function makeItem(id, {
  description = "",
  identifier = "",
  rarity = "",
  type = "equipment",
  upgrade = null,
  installed = []
} = {}) {
  return {
    id,
    name: id,
    type,
    effects: new Map(),
    system: {
      description: { value: description },
      identifier,
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
    },
    async deleteEmbeddedDocuments(documentName, ids) {
      assert.equal(documentName, "ActiveEffect");
      for (const effectId of ids) this.effects.delete(effectId);
      return [];
    }
  };
}

function makeActor(items, slots) {
  const actor = {
    id: "actor-1",
    name: "Hero",
    type: "character",
    isOwner: true,
    items: new Map(items.map((item) => [item.id, item])),
    effects: new Map(),
    flags: {
      "rebreya-main": {
        heroDoll: { version: 1, slots }
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = structuredClone(value);
      return this;
    },
    async createEmbeddedDocuments(documentName, rows) {
      assert.equal(documentName, "ActiveEffect");
      return rows.map((row, index) => {
        const id = `effect-${this.effects.size + index + 1}`;
        const effect = {
          ...structuredClone(row),
          id,
          _id: id,
          parent: this,
          async update(patch) {
            Object.assign(this, structuredClone(patch));
            return this;
          }
        };
        this.effects.set(id, effect);
        return effect;
      });
    },
    async deleteEmbeddedDocuments(documentName, ids) {
      assert.equal(documentName, "ActiveEffect");
      for (const id of ids) this.effects.delete(id);
      return [];
    }
  };
  for (const item of items) {
    item.actor = actor;
    item.parent = actor;
  }
  return actor;
}

function managedEffects(actor) {
  return [...actor.effects.values()].filter((effect) =>
    effect.flags?.["rebreya-main"]?.curseEater?.managed === true);
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

test("all reached bonuses share one effect while tier eight stays manual", () => {
  const effect = buildCurseEaterEffectData({
    tier: 8,
    usedItems: [{ itemId: "artifact", itemName: "Artifact", rarity: 5 }]
  }, ["str", "wis"]);
  const changes = new Map(effect.changes.map((change) => [change.key, change.value]));

  assert.equal(effect.name, "Пожиратель проклятий");
  assert.equal(effect.flags["rebreya-main"].curseEater.managed, true);
  assert.equal(effect.flags["rebreya-main"].curseEater.tier, 8);
  assert.equal(effect.flags["rebreya-main"].curseEater.manualTierEight, true);
  assert.equal(changes.get("system.bonuses.mwak.attack"), "+1");
  assert.equal(changes.get("system.bonuses.mwak.damage"), "+1");
  assert.equal(changes.get("system.bonuses.rwak.attack"), "+1");
  assert.equal(changes.get("system.bonuses.rwak.damage"), "+1");
  assert.equal(changes.get("system.attributes.hp.bonuses.overall"), "@prof");
  assert.equal(changes.get("system.bonuses.abilities.save"), "+1");
  assert.equal(changes.get("system.attributes.ac.bonus"), "1");
  assert.equal(changes.get("system.abilities.str.value"), "1");
  assert.equal(changes.get("system.abilities.wis.value"), "1");
  assert.deepEqual(
    effect.changes
      .filter((change) => change.key === "system.traits.dr.value")
      .map((change) => change.value),
    ["necrotic", "psychic"]
  );
  assert.equal([...changes.keys()].some((key) => key.includes("curseSuppression")), false);
  assert.equal([...changes.keys()].filter((key) => /^system\.abilities\.\w+\.value$/u.test(key)).length, 2);
});

test("sync creates and removes at most one managed effect", async () => {
  const feat = makeItem("curse-eater", {
    type: "feat",
    identifier: "pozhiratel-proklyatiy"
  });
  const crown = makeItem("crown", {
    rarity: "uncommon",
    description: "<p>Проклятье: шёпот.</p>"
  });
  const actor = makeActor([feat, crown], { head: { itemId: "crown" } });
  const service = new CurseEaterAutomationService();

  await service.syncActor(actor);
  assert.equal(managedEffects(actor).length, 1);
  await service.syncActor(actor);
  assert.equal(managedEffects(actor).length, 1);

  actor.flags["rebreya-main"].heroDoll.slots = {};
  await service.syncActor(actor);
  assert.equal(managedEffects(actor).length, 0);
});

test("tier six stores two distinct ability choices only once", async () => {
  const feat = makeItem("curse-eater", {
    type: "feat",
    identifier: "pozhiratel-proklyatiy"
  });
  const rarities = ["uncommon", "rare", "rare", "rare", "veryRare", "veryRare"];
  const curses = rarities.map((rarity, index) => makeItem(`curse-${index + 1}`, {
    rarity,
    description: "<p>Проклятье: испытание.</p>"
  }));
  const slots = Object.fromEntries(curses.map((item, index) => [
    `slot-${index + 1}`,
    { itemId: item.id }
  ]));
  const actor = makeActor([feat, ...curses], slots);
  let choiceCalls = 0;
  const service = new CurseEaterAutomationService({
    chooseAbilities: async () => {
      choiceCalls += 1;
      return ["str", "wis"];
    }
  });

  await service.syncActor(actor);
  await service.syncActor(actor);

  assert.equal(choiceCalls, 1);
  assert.deepEqual(actor.flags["rebreya-main"].curseEater.abilities, ["str", "wis"]);
  assert.deepEqual(
    managedEffects(actor)[0].changes
      .filter((change) => change.key.startsWith("system.abilities."))
      .map((change) => change.key),
    ["system.abilities.str.value", "system.abilities.wis.value"]
  );
});

test("default ability prompt returns the two selected dnd5e abilities", async () => {
  const previousFoundry = globalThis.foundry;
  let dialogConfig;
  globalThis.foundry = {
    applications: {
      api: {
        DialogV2: {
          async wait(config) {
            dialogConfig = config;
            return config.buttons[0].callback(null, {
              form: {
                elements: {
                  firstAbility: { value: "dex" },
                  secondAbility: { value: "cha" }
                }
              }
            });
          }
        }
      }
    }
  };

  try {
    assert.deepEqual(await promptCurseEaterAbilityChoice(), ["dex", "cha"]);
    assert.match(dialogConfig.content, /name="firstAbility"/u);
    assert.match(dialogConfig.content, /name="secondAbility"/u);
    assert.equal(dialogConfig.buttons.some((button) => button.action === "cancel"), true);
  }
  finally {
    globalThis.foundry = previousFoundry;
  }
});

test("sync removes only the known unconditional legacy feat effects", async () => {
  const feat = makeItem("curse-eater", {
    type: "feat",
    identifier: "pozhiratel-proklyatiy"
  });
  feat.effects.set("84fc61e9aa590cdd", {
    id: "84fc61e9aa590cdd",
    name: "Урон"
  });
  feat.effects.set("custom-effect", {
    id: "custom-effect",
    name: "Пользовательский эффект"
  });
  const crown = makeItem("crown", {
    rarity: "uncommon",
    description: "Проклятье: шёпот."
  });
  const actor = makeActor([feat, crown], { head: { itemId: "crown" } });

  await new CurseEaterAutomationService().syncActor(actor);

  assert.equal(feat.effects.has("84fc61e9aa590cdd"), false);
  assert.equal(feat.effects.has("custom-effect"), true);
});

test("tier notifications fire only when the effective tier changes", async () => {
  const feat = makeItem("curse-eater", {
    type: "feat",
    identifier: "pozhiratel-proklyatiy"
  });
  const crown = makeItem("crown", {
    rarity: "uncommon",
    description: "Проклятье: шёпот."
  });
  const actor = makeActor([feat, crown], { head: { itemId: "crown" } });
  const notifications = [];
  const service = new CurseEaterAutomationService({
    notifyTierChanged: (_actor, previousTier, nextTier) => {
      notifications.push([previousTier, nextTier]);
    }
  });

  await service.syncActor(actor);
  await service.syncActor(actor);
  actor.flags["rebreya-main"].heroDoll.slots = {};
  await service.syncActor(actor);

  assert.deepEqual(notifications, [[0, 1], [1, 0]]);
});
