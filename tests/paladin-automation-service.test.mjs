import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    escapeHTML: (value) => String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;"),
    getProperty: (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object),
    setProperty: (object, path, value) => {
      const keys = String(path ?? "").split(".").filter(Boolean);
      let cursor = object;
      while (keys.length > 1) {
        const key = keys.shift();
        cursor[key] ??= {};
        cursor = cursor[key];
      }
      cursor[keys[0]] = value;
      return true;
    }
  }
};

globalThis.Actor ??= class Actor {};
globalThis.ui ??= {
  notifications: {
    info: () => {},
    warn: () => {}
  }
};
globalThis.game ??= {
  user: {
    id: "user",
    isGM: true
  }
};

const { PaladinAutomationService } = await import("../scripts/combat/paladin-automation-service.js");

class TestActor extends Actor {
  constructor({
    id = "paladin",
    name = "Паладин",
    level = 5,
    chaMod = 2,
    hp = { value: 10, max: 30 },
    items = []
  } = {}) {
    super();
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.name = name;
    this.isOwner = true;
    this.system = {
      abilities: {
        cha: { mod: chaMod }
      },
      attributes: {
        hp: {
          value: hp.value,
          max: hp.max
        }
      },
      classes: {
        "paladin-rework-v01": {
          identifier: "paladin-rework-v01",
          levels: level
        }
      }
    };
    this.createdItems = [];
    this.items = {
      contents: items,
      get: (itemId) => items.find((item) => item.id === itemId) ?? null,
      values: () => items.values(),
      [Symbol.iterator]: function* iterator() {
        yield* items;
      }
    };
    for (const item of items) {
      item.actor = this;
    }
    this.updates = [];
  }

  async createEmbeddedDocuments(type, documents) {
    this.createdItems.push({ type, documents });
    return documents;
  }

  async update(patch) {
    this.updates.push(patch);
    for (const [key, value] of Object.entries(patch)) {
      foundry.utils.setProperty(this, key, value);
    }
    return this;
  }
}

function makeSpellItem({
  id,
  name,
  sourceId = "",
  identifier = "",
  sourceClass = "paladin-rework-v01",
  method = "spell",
  prepared = 1
} = {}) {
  const item = {
    id,
    name,
    type: "spell",
    uuid: `Actor.paladin.Item.${id}`,
    system: {
      identifier,
      sourceClass,
      method,
      prepared
    },
    flags: {
      dnd5e: {
        sourceId
      },
      "rebreya-main": {
        paladinPreparedSpell: true
      }
    },
    updates: [],
    async update(patch) {
      this.updates.push(patch);
      for (const [key, value] of Object.entries(patch)) {
        foundry.utils.setProperty(this, key, value);
      }
      return this;
    }
  };
  return item;
}

function makeCompendiumSpell({ uuid, name, identifier, level = 1 } = {}) {
  return {
    uuid,
    name,
    type: "spell",
    system: {
      identifier,
      level,
      method: "",
      prepared: 0,
      sourceClass: ""
    },
    flags: {
      dnd5e: {
        sourceId: uuid
      }
    },
    toObject() {
      return foundry.utils.deepClone({
        name: this.name,
        type: this.type,
        img: "icons/svg/book.svg",
        system: this.system,
        flags: this.flags
      });
    }
  };
}

function makeFeatureItem({
  id,
  name,
  featureId,
  uses = { spent: 0, max: 25, recovery: [] }
} = {}) {
  const item = {
    id,
    name,
    type: "feat",
    uuid: `Actor.paladin.Item.${id}`,
    system: {
      uses
    },
    flags: {
      "rebreya-main": {
        featureId
      }
    },
    updates: [],
    async update(patch) {
      this.updates.push(patch);
      for (const [key, value] of Object.entries(patch)) {
        foundry.utils.setProperty(this, key, value);
      }
      return this;
    }
  };
  return item;
}

test("paladin long rest asks to change prepared spells and applies the browser selection", async () => {
  const cure = makeSpellItem({
    id: "cure",
    name: "Лечение ран",
    sourceId: "Compendium.dnd5e.spells.Item.cure",
    identifier: "cure-wounds",
    prepared: 0
  });
  const command = makeSpellItem({
    id: "command",
    name: "Приказ",
    sourceId: "Compendium.dnd5e.spells.Item.command",
    identifier: "command",
    prepared: 1
  });
  const actor = new TestActor({ level: 5, chaMod: 2, items: [cure, command] });
  const requested = [];
  const spellDocuments = new Map([
    ["Compendium.dnd5e.spells.Item.cure", makeCompendiumSpell({
      uuid: "Compendium.dnd5e.spells.Item.cure",
      name: "Лечение ран",
      identifier: "cure-wounds"
    })],
    ["Compendium.dnd5e.spells.Item.bless", makeCompendiumSpell({
      uuid: "Compendium.dnd5e.spells.Item.bless",
      name: "Благословение",
      identifier: "bless"
    })]
  ]);
  const service = new PaladinAutomationService({}, {
    confirmPreparedSpellChange: async (targetActor, details) => {
      requested.push({ targetActor, details });
      return true;
    },
    selectPreparedSpellUuids: async (_targetActor, details) => {
      requested.push({ browser: details });
      return ["Compendium.dnd5e.spells.Item.cure", "Compendium.dnd5e.spells.Item.bless"];
    },
    fromUuid: async (uuid) => spellDocuments.get(uuid) ?? null
  });

  await service.handleRestCompleted(actor, { type: "long" }, {});

  assert.equal(requested[0].targetActor, actor);
  assert.deepEqual(requested[0].details, {
    paladinLevel: 5,
    preparedCount: 4,
    maxSpellLevel: 2
  });
  assert.equal(requested[1].browser.preparedCount, 4);
  assert.equal(requested[1].browser.maxSpellLevel, 2);
  assert.deepEqual(cure.updates, [{
    "system.prepared": 1
  }]);
  assert.equal(cure.system.sourceClass, "paladin-rework-v01");
  assert.equal(cure.system.method, "spell");
  assert.equal(cure.flags["rebreya-main"].paladinPreparedSpell, true);
  assert.deepEqual(command.updates, [{
    "system.prepared": 0
  }]);
  assert.equal(actor.createdItems.length, 1);
  assert.equal(actor.createdItems[0].type, "Item");
  assert.equal(actor.createdItems[0].documents[0].name, "Благословение");
  assert.equal(actor.createdItems[0].documents[0].system.sourceClass, "paladin-rework-v01");
  assert.equal(actor.createdItems[0].documents[0].system.method, "spell");
  assert.equal(actor.createdItems[0].documents[0].system.prepared, 1);
});

test("paladin long rest leaves spells untouched when the player declines the prompt", async () => {
  const actor = new TestActor({ level: 5, chaMod: 2, items: [] });
  let browserOpened = false;
  const service = new PaladinAutomationService({}, {
    confirmPreparedSpellChange: async () => false,
    selectPreparedSpellUuids: async () => {
      browserOpened = true;
      return [];
    }
  });

  await service.handleRestCompleted(actor, { longRest: true }, {});

  assert.equal(browserOpened, false);
  assert.deepEqual(actor.createdItems, []);
});

test("paladin lay on hands prompts for points, spends the item pool, and heals the selected target", async () => {
  const layOnHands = makeFeatureItem({
    id: "lay-on-hands",
    name: "Наложение рук",
    featureId: "paladin-rework-v01::class::paladin-lay-on-hands",
    uses: {
      spent: 5,
      max: 25,
      recovery: []
    }
  });
  const paladin = new TestActor({ items: [layOnHands] });
  const target = new TestActor({
    id: "target",
    name: "Цель",
    hp: {
      value: 10,
      max: 30
    },
    items: []
  });
  const prompts = [];
  const service = new PaladinAutomationService({}, {
    promptLayOnHandsPoints: async (actor, item, details) => {
      prompts.push({ actor, item, details });
      return 12;
    }
  });
  const previousTargets = globalThis.game.user.targets;
  globalThis.game.user.targets = new Set([{ actor: target }]);

  try {
    const activity = {
      actor: paladin,
      item: layOnHands,
      flags: {
        "rebreya-main": {
          automation: "paladin-lay-on-hands"
        }
      }
    };

    await service.applyDnd5ePostUseActivity(activity, {}, {});
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].actor, paladin);
  assert.equal(prompts[0].item, layOnHands);
  assert.deepEqual(prompts[0].details, {
    remaining: 20,
    max: 20
  });
  assert.equal(layOnHands.system.uses.spent, 17);
  assert.deepEqual(layOnHands.updates, [{
    "system.uses.spent": 17
  }]);
  assert.equal(target.system.attributes.hp.value, 22);
  assert.deepEqual(target.updates, [{
    "system.attributes.hp.value": 22
  }]);
});
