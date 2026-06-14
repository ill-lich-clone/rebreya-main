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
  },
  combat: {
    id: "combat",
    round: 1,
    turn: 0
  }
};
globalThis.ChatMessage ??= {
  getSpeaker: ({ actor } = {}) => ({
    actor: actor?.id,
    alias: actor?.name
  }),
  create: async (data) => data
};

class TestRoll {
  static messages = [];

  constructor(formula, data = {}) {
    this.formula = String(formula ?? "0");
    this.data = data;
    this.total = 0;
  }

  async evaluate() {
    const diceMatch = this.formula.match(/^(\d+)d8$/u);
    if (diceMatch) {
      this.total = Number(diceMatch[1]) * 4;
      return this;
    }

    this.total = Number(this.formula) || 0;
    return this;
  }

  async toMessage(message) {
    TestRoll.messages.push({
      formula: this.formula,
      total: this.total,
      message
    });
    return message;
  }
}

globalThis.Roll ??= TestRoll;

const { PaladinAutomationService } = await import("../scripts/combat/paladin-automation-service.js");

class TestActor extends Actor {
  constructor({
    id = "paladin",
    name = "Паладин",
    level = 5,
    chaMod = 2,
    hp = { value: 10, max: 30 },
    spellSlots = {},
    effects = [],
    flags = {},
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
      spells: spellSlots,
      classes: {
        "paladin-rework-v01": {
          identifier: "paladin-rework-v01",
          levels: level
        }
      }
    };
    this.flags = foundry.utils.deepClone(flags);
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
    this.effects = {
      contents: effects,
      values: () => effects.values(),
      [Symbol.iterator]: function* iterator() {
        yield* effects;
      }
    };
    for (const effect of effects) {
      effect.parent = this;
      effect.actor = this;
    }
    this.updates = [];
    this.damageApplications = [];
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

  getRollData() {
    return this.system;
  }

  async applyDamage(damage, options) {
    this.damageApplications.push({ damage, options });
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

function makeWeaponWorkflow({
  actor,
  target,
  item = {
    id: "sword",
    uuid: "Actor.paladin.Item.sword",
    type: "weapon",
    system: {
      actionType: "mwak"
    }
  }
} = {}) {
  return {
    actor,
    item,
    activity: {
      type: "attack",
      item,
      attack: {
        type: {
          value: "melee"
        }
      }
    },
    hitTargets: new Set([{ actor: target }]),
    hitTargetsEC: new Set(),
    targets: new Set([{ actor }])
  };
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

test("paladin spellcasting feature creation asks for initial prepared spells once", async () => {
  const spellcasting = makeFeatureItem({
    id: "spellcasting",
    name: "Использование заклинаний",
    featureId: "paladin-rework-v01::class::paladin-spellcasting"
  });
  const actor = new TestActor({ level: 2, chaMod: 3, items: [spellcasting] });
  const requested = [];
  const spellDocuments = new Map([
    ["Compendium.dnd5e.spells.Item.bless", makeCompendiumSpell({
      uuid: "Compendium.dnd5e.spells.Item.bless",
      name: "Благословение",
      identifier: "bless"
    })],
    ["Compendium.dnd5e.spells.Item.cure", makeCompendiumSpell({
      uuid: "Compendium.dnd5e.spells.Item.cure",
      name: "Лечение ран",
      identifier: "cure-wounds"
    })]
  ]);
  const service = new PaladinAutomationService({}, {
    selectPreparedSpellUuids: async (targetActor, details) => {
      requested.push({ targetActor, details });
      return ["Compendium.dnd5e.spells.Item.bless", "Compendium.dnd5e.spells.Item.cure"];
    },
    fromUuid: async (uuid) => spellDocuments.get(uuid) ?? null
  });

  await service.handleCreatedItem(spellcasting, {}, "user");

  assert.equal(requested[0].targetActor, actor);
  assert.deepEqual(requested[0].details, {
    paladinLevel: 2,
    preparedCount: 5,
    maxSpellLevel: 1,
    initialSelection: true
  });
  assert.equal(actor.createdItems.length, 1);
  assert.equal(actor.createdItems[0].type, "Item");
  assert.deepEqual(
    actor.createdItems[0].documents.map((document) => document.name),
    ["Благословение", "Лечение ран"]
  );
  assert.equal(actor.flags["rebreya-main"].paladinInitialPreparedSpellsSelected, true);
});

test("paladin initial prepared spell selection does not repeat after the actor flag is set", async () => {
  const spellcasting = makeFeatureItem({
    id: "spellcasting",
    name: "Использование заклинаний",
    featureId: "paladin-rework-v01::class::paladin-spellcasting"
  });
  const actor = new TestActor({
    level: 2,
    items: [spellcasting],
    flags: {
      "rebreya-main": {
        paladinInitialPreparedSpellsSelected: true
      }
    }
  });
  let browserOpened = false;
  const service = new PaladinAutomationService({}, {
    selectPreparedSpellUuids: async () => {
      browserOpened = true;
      return [];
    }
  });

  await service.handleCreatedItem(spellcasting, {}, "user");

  assert.equal(browserOpened, false);
  assert.deepEqual(actor.createdItems, []);
});

test("paladin actor level update asks for initial prepared spells when spellcasting already exists", async () => {
  const spellcasting = makeFeatureItem({
    id: "spellcasting",
    name: "Использование заклинаний",
    featureId: "paladin-rework-v01::class::paladin-spellcasting"
  });
  const actor = new TestActor({ level: 2, chaMod: 1, items: [spellcasting] });
  const spellDocuments = new Map([
    ["Compendium.dnd5e.spells.Item.bless", makeCompendiumSpell({
      uuid: "Compendium.dnd5e.spells.Item.bless",
      name: "Благословение",
      identifier: "bless"
    })]
  ]);
  let detailsSeen = null;
  const service = new PaladinAutomationService({}, {
    selectPreparedSpellUuids: async (_targetActor, details) => {
      detailsSeen = details;
      return ["Compendium.dnd5e.spells.Item.bless"];
    },
    fromUuid: async (uuid) => spellDocuments.get(uuid) ?? null
  });

  await service.handleActorUpdated(actor, {
    system: {
      classes: {
        "paladin-rework-v01": {
          levels: 2
        }
      }
    }
  }, {}, "user");

  assert.deepEqual(detailsSeen, {
    paladinLevel: 2,
    preparedCount: 3,
    maxSpellLevel: 1,
    initialSelection: true
  });
  assert.equal(actor.createdItems.length, 1);
  assert.equal(actor.flags["rebreya-main"].paladinInitialPreparedSpellsSelected, true);
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

test("paladin divine smite spends the selected spell slot and applies radiant damage to the hit target", async () => {
  TestRoll.messages = [];
  const divineSmite = makeFeatureItem({
    id: "divine-smite",
    name: "Божественная кара",
    featureId: "paladin-rework-v01::class::paladin-divine-smite"
  });
  const heavenlySmite = makeFeatureItem({
    id: "heavenly-smite",
    name: "Небесная кара",
    featureId: "paladin-rework-v01::class::paladin-heavenly-smite"
  });
  const paladin = new TestActor({
    items: [divineSmite, heavenlySmite],
    spellSlots: {
      spell1: { value: 1, max: 2 },
      spell2: { value: 1, max: 1 },
      spell3: { value: 1, max: 1 },
      spell4: { value: 1, max: 1 }
    }
  });
  const target = new TestActor({ id: "target", name: "Лич", items: [] });
  const prompts = [];
  const service = new PaladinAutomationService({}, {
    promptDivineSmite: async (actor, details) => {
      prompts.push({ actor, details });
      return {
        slotLevel: 4,
        variantIds: ["paladin-heavenly-smite"]
      };
    }
  });

  await service.applyMidiRollComplete(makeWeaponWorkflow({ actor: paladin, target }));

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].actor, paladin);
  assert.deepEqual(prompts[0].details.slots.map((slot) => [slot.level, slot.value, slot.max]), [
    [1, 1, 2],
    [2, 1, 1],
    [3, 1, 1],
    [4, 1, 1]
  ]);
  assert.deepEqual(prompts[0].details.variants.map((variant) => [variant.id, variant.name]), [
    ["paladin-heavenly-smite", "Небесная кара"]
  ]);
  assert.equal(paladin.system.spells.spell4.value, 0);
  assert.deepEqual(paladin.updates.at(-1), {
    "system.spells.spell4.value": 0
  });
  assert.equal(target.damageApplications.length, 1);
  assert.deepEqual(target.damageApplications[0].damage, [{
    value: 20,
    type: "radiant"
  }]);
  assert.equal(target.damageApplications[0].options.sourceActorUuid, paladin.uuid);
  assert.equal(TestRoll.messages[0].formula, "5d8");
  assert.match(TestRoll.messages[0].message.flavor, /Божественная кара/u);
  assert.match(TestRoll.messages[0].message.flavor, /Небесная кара/u);
});

test("paladin divine smite is once per turn unless a bypass effect or feature is present", async () => {
  const makePaladin = ({ id, items, effects = [] }) => new TestActor({
    id,
    items,
    effects,
    spellSlots: {
      spell1: { value: 4, max: 4 }
    }
  });
  const target = new TestActor({ id: "target", name: "Цель", items: [] });
  const smite = makeFeatureItem({
    id: "divine-smite",
    name: "Божественная кара",
    featureId: "paladin-rework-v01::class::paladin-divine-smite"
  });
  const cappedPaladin = makePaladin({ id: "capped", items: [smite] });
  let cappedPrompts = 0;
  const cappedService = new PaladinAutomationService({}, {
    promptDivineSmite: async () => {
      cappedPrompts += 1;
      return { slotLevel: 1 };
    }
  });

  await cappedService.applyMidiRollComplete(makeWeaponWorkflow({ actor: cappedPaladin, target }));
  await cappedService.applyMidiRollComplete(makeWeaponWorkflow({ actor: cappedPaladin, target }));

  assert.equal(cappedPrompts, 1);
  assert.equal(cappedPaladin.system.spells.spell1.value, 3);
  assert.deepEqual(target.damageApplications[0].damage, [{
    value: 8,
    type: "radiant"
  }]);

  const uncappedSmite = makeFeatureItem({
    id: "divine-smite-uncapped",
    name: "Божественная кара",
    featureId: "paladin-rework-v01::class::paladin-divine-smite"
  });
  const uncappedPaladin = makePaladin({
    id: "uncapped",
    items: [uncappedSmite],
    effects: [{
      name: "Святой нимб",
      disabled: false,
      flags: {
        "rebreya-main": {
          paladinAutomation: {
            divineSmiteIgnoreTurnLimit: true
          }
        }
      }
    }]
  });
  let uncappedPrompts = 0;
  const uncappedService = new PaladinAutomationService({}, {
    promptDivineSmite: async () => {
      uncappedPrompts += 1;
      return { slotLevel: 1 };
    }
  });

  await uncappedService.applyMidiRollComplete(makeWeaponWorkflow({ actor: uncappedPaladin, target }));
  await uncappedService.applyMidiRollComplete(makeWeaponWorkflow({ actor: uncappedPaladin, target }));

  assert.equal(uncappedPrompts, 2);
  assert.equal(uncappedPaladin.system.spells.spell1.value, 2);
});
