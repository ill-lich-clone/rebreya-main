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

  constructor(formula, data = {}, options = {}) {
    this.formula = String(formula ?? "0");
    this.data = data;
    this.options = options;
    this.total = 0;
    this._evaluated = false;
  }

  async evaluate() {
    const diceMatch = this.formula.match(/^(\d+)d8$/u);
    if (diceMatch) {
      this.total = Number(diceMatch[1]) * 4;
      this._evaluated = true;
      return this;
    }

    this.total = Number(this.formula) || 0;
    this._evaluated = true;
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
const { registerCombatHooks } = await import("../scripts/combat/hooks.js");

class TestActor extends Actor {
  constructor({
    id = "paladin",
    name = "Паладин",
    level = 5,
    chaMod = 2,
    isOwner = true,
    ownership = {},
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
    this.isOwner = isOwner;
    this.ownership = ownership;
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
    if (type === "ActiveEffect") {
      for (const document of documents) {
        const effect = foundry.utils.deepClone(document);
        effect.parent = this;
        effect.actor = this;
        this.effects.contents.push(effect);
      }
    }
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
  isCritical = false,
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
    targets: new Set([{ actor }]),
    isCritical
  };
}

function makeDamageConfig() {
  return {
    rolls: []
  };
}

function magistratePaladinWithSmiteVariant(variantId) {
  const variantNames = {
    "magistrate-accusation-smite": "Кара обвинения",
    "magistrate-detention-smite": "Кара задержания"
  };
  const divineSmite = makeFeatureItem({
    id: "divine-smite",
    name: "Божественная кара",
    featureId: "paladin-rework-v01::class::paladin-divine-smite"
  });
  const variant = makeFeatureItem({
    id: variantId,
    name: variantNames[variantId] ?? variantId,
    featureId: `paladin-oath-magistrate::subclass::${variantId}`
  });
  return new TestActor({
    id: "magistrate",
    name: "Магистрат",
    items: [divineSmite, variant],
    spellSlots: {
      spell1: { value: 1, max: 1 }
    }
  });
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

test("paladin lay on hands sends a GM socket request when the player cannot update the target", async () => {
  const previousGame = globalThis.game;
  const layOnHands = makeFeatureItem({
    id: "lay-on-hands",
    name: "РќР°Р»РѕР¶РµРЅРёРµ СЂСѓРє",
    featureId: "paladin-rework-v01::class::paladin-lay-on-hands",
    uses: {
      spent: 5,
      max: 25,
      recovery: []
    }
  });
  const paladin = new TestActor({
    items: [layOnHands],
    ownership: {
      player: 3
    }
  });
  const target = new TestActor({
    id: "target",
    name: "Р¦РµР»СЊ",
    isOwner: false,
    hp: {
      value: 10,
      max: 30
    },
    items: []
  });
  target.update = async () => {
    throw new Error("player should not update target directly");
  };
  const emitted = [];
  globalThis.game = {
    ...previousGame,
    user: {
      id: "player",
      isGM: false,
      targets: new Set([{ actor: target }])
    },
    socket: {
      emit: (channel, message) => {
        emitted.push({ channel, message });
      }
    }
  };
  const service = new PaladinAutomationService({}, {
    promptLayOnHandsPoints: async () => 12
  });

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
    globalThis.game = previousGame;
  }

  assert.deepEqual(layOnHands.updates, []);
  assert.equal(target.system.attributes.hp.value, 10);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].channel, "module.rebreya-main");
  assert.deepEqual(emitted[0].message, {
    type: "character-class-automation",
    payload: {
      action: "paladin.layOnHands",
      sourceActorUuid: paladin.uuid,
      sourceItemId: layOnHands.id,
      sourceItemUuid: layOnHands.uuid,
      targetActorUuid: target.uuid,
      amount: 12
    },
    senderId: "player"
  });
});

test("paladin lay on hands socket request is applied by the active GM", async () => {
  const previousGame = globalThis.game;
  const previousFromUuidSync = globalThis.fromUuidSync;
  const layOnHands = makeFeatureItem({
    id: "lay-on-hands",
    name: "РќР°Р»РѕР¶РµРЅРёРµ СЂСѓРє",
    featureId: "paladin-rework-v01::class::paladin-lay-on-hands",
    uses: {
      spent: 5,
      max: 25,
      recovery: []
    }
  });
  const paladin = new TestActor({
    items: [layOnHands],
    ownership: {
      player: 3
    }
  });
  const target = new TestActor({
    id: "target",
    name: "Р¦РµР»СЊ",
    hp: {
      value: 10,
      max: 30
    },
    items: []
  });
  const gmUser = { id: "gm", isGM: true, active: true };
  const playerUser = { id: "player", isGM: false, active: true };
  globalThis.game = {
    ...previousGame,
    user: gmUser,
    users: {
      activeGM: gmUser,
      get: (id) => ({ gm: gmUser, player: playerUser })[id] ?? null,
      contents: [gmUser, playerUser]
    }
  };
  globalThis.fromUuidSync = (uuid) => ({
    [paladin.uuid]: paladin,
    [target.uuid]: target,
    [layOnHands.uuid]: layOnHands
  })[uuid] ?? null;

  try {
    const result = await new PaladinAutomationService({}).handleSocketMessage({
      action: "paladin.layOnHands",
      sourceActorUuid: paladin.uuid,
      sourceItemId: layOnHands.id,
      sourceItemUuid: layOnHands.uuid,
      targetActorUuid: target.uuid,
      amount: 12
    }, {
      senderId: "player"
    });

    assert.equal(result, true);
    assert.equal(target.system.attributes.hp.value, 22);
    assert.deepEqual(target.updates, [{
      "system.attributes.hp.value": 22
    }]);
    assert.equal(layOnHands.system.uses.spent, 17);
    assert.deepEqual(layOnHands.updates, [{
      "system.uses.spent": 17
    }]);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuidSync = previousFromUuidSync;
  }
});

test("paladin lay on hands socket request rejects senders that do not own the source actor", async () => {
  const previousGame = globalThis.game;
  const previousFromUuidSync = globalThis.fromUuidSync;
  const layOnHands = makeFeatureItem({
    id: "lay-on-hands",
    name: "РќР°Р»РѕР¶РµРЅРёРµ СЂСѓРє",
    featureId: "paladin-rework-v01::class::paladin-lay-on-hands",
    uses: {
      spent: 5,
      max: 25,
      recovery: []
    }
  });
  const paladin = new TestActor({
    items: [layOnHands],
    ownership: {
      other: 3
    }
  });
  const target = new TestActor({
    id: "target",
    hp: {
      value: 10,
      max: 30
    },
    items: []
  });
  const gmUser = { id: "gm", isGM: true, active: true };
  const playerUser = { id: "player", isGM: false, active: true };
  globalThis.game = {
    ...previousGame,
    user: gmUser,
    users: {
      activeGM: gmUser,
      get: (id) => ({ gm: gmUser, player: playerUser })[id] ?? null,
      contents: [gmUser, playerUser]
    }
  };
  globalThis.fromUuidSync = (uuid) => ({
    [paladin.uuid]: paladin,
    [target.uuid]: target,
    [layOnHands.uuid]: layOnHands
  })[uuid] ?? null;

  try {
    const result = await new PaladinAutomationService({}).handleSocketMessage({
      action: "paladin.layOnHands",
      sourceActorUuid: paladin.uuid,
      sourceItemId: layOnHands.id,
      sourceItemUuid: layOnHands.uuid,
      targetActorUuid: target.uuid,
      amount: 12
    }, {
      senderId: "player"
    });

    assert.equal(result, false);
    assert.equal(target.system.attributes.hp.value, 10);
    assert.deepEqual(target.updates, []);
    assert.equal(layOnHands.system.uses.spent, 5);
    assert.deepEqual(layOnHands.updates, []);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuidSync = previousFromUuidSync;
  }
});

test("Magistrate socket rejects forged raw effect payloads", async () => {
  const previousGame = globalThis.game;
  const previousFromUuidSync = globalThis.fromUuidSync;
  const paladin = new TestActor({
    id: "source",
    ownership: {
      player: 3
    },
    items: []
  });
  const target = new TestActor({ id: "target", items: [] });
  const gmUser = { id: "gm", isGM: true, active: true };
  const playerUser = { id: "player", isGM: false, active: true };
  globalThis.game = {
    ...previousGame,
    user: gmUser,
    users: {
      activeGM: gmUser,
      get: (id) => ({ gm: gmUser, player: playerUser })[id] ?? null,
      contents: [gmUser, playerUser]
    }
  };
  globalThis.fromUuidSync = (uuid) => ({
    [paladin.uuid]: paladin,
    [target.uuid]: target
  })[uuid] ?? null;

  try {
    const result = await new PaladinAutomationService({}).handleSocketMessage({
      action: "paladin.magistrateEffects",
      sourceActorUuid: paladin.uuid,
      targetActorUuid: target.uuid,
      effects: [{
        flags: {
          "rebreya-main": {
            paladinAutomation: {
              kind: "magistrateEffect",
              effect: "detentionNoReaction",
              variantId: "magistrate-detention-smite"
            }
          }
        }
      }]
    }, {
      senderId: "player"
    });

    assert.equal(result, false);
    assert.equal(target.effects.contents.length, 0);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuidSync = previousFromUuidSync;
  }
});

test("paladin divine smite spends the selected spell slot and adds radiant bonus damage", async () => {
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

  const workflow = makeWeaponWorkflow({ actor: paladin, target });
  const config = makeDamageConfig();

  await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);

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
  assert.equal(target.damageApplications.length, 0);
  assert.equal(TestRoll.messages.length, 0);
  assert.equal(config.rolls.length, 1);
  assert.deepEqual(config.rolls[0].parts, ["5d8"]);
  assert.equal(config.rolls[0].options.type, "radiant");
  assert.deepEqual(config.rolls[0].options.types, ["radiant"]);
  assert.equal(typeof config.rolls[0].options.flavor, "string");
});

test("Magistrate accusation smite strips target advantage after a failed Charisma save", async () => {
  const paladin = magistratePaladinWithSmiteVariant("magistrate-accusation-smite");
  const target = new TestActor({ id: "target", name: "Подсудимый", items: [] });
  const service = new PaladinAutomationService({}, {
    promptDivineSmite: async () => ({
      slotLevel: 1,
      variantIds: ["magistrate-accusation-smite"]
    }),
    rollPaladinSave: async () => ({ success: false, total: 7, dc: 15 })
  });
  const workflow = makeWeaponWorkflow({ actor: paladin, target });
  const config = makeDamageConfig();

  await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);

  assert.equal(paladin.system.spells.spell1.value, 0);
  assert.equal(config.rolls.length, 1);
  const accusationEffect = target.effects.contents.find((effect) => (
    effect.flags["rebreya-main"].paladinAutomation.effect === "accusationNoAdvantage"
  ));
  assert.equal(
    Boolean(accusationEffect),
    true
  );
  assert.equal(accusationEffect.origin, paladin.uuid);
  assert.equal(accusationEffect.transfer, false);
  assert.deepEqual(accusationEffect.flags.dae.specialDuration, ["turnStartSource", "combatEnd"]);
});

test("Magistrate detention smite slows on success and suppresses reactions on failure", async () => {
  const paladin = magistratePaladinWithSmiteVariant("magistrate-detention-smite");
  const target = new TestActor({ id: "target", name: "Задержанный", items: [] });
  const service = new PaladinAutomationService({}, {
    promptDivineSmite: async () => ({
      slotLevel: 1,
      variantIds: ["magistrate-detention-smite"]
    }),
    rollPaladinSave: async () => ({ success: false, total: 6, dc: 15 })
  });
  const workflow = makeWeaponWorkflow({ actor: paladin, target });
  const config = makeDamageConfig();

  await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);

  const effects = target.effects.contents.map((effect) => effect.flags["rebreya-main"].paladinAutomation.effect);
  assert.equal(paladin.system.spells.spell1.value, 0);
  assert.equal(config.rolls.length, 1);
  assert.equal(effects.includes("detentionSlow"), true);
  assert.equal(effects.includes("detentionNoReaction"), true);
});

test("Magistrate smite sends a constrained GM request when the player cannot update the target", async () => {
  const previousGame = globalThis.game;
  const paladin = magistratePaladinWithSmiteVariant("magistrate-detention-smite");
  paladin.ownership = { player: 3 };
  const target = new TestActor({
    id: "target",
    name: "Задержанный",
    isOwner: false,
    items: []
  });
  const emitted = [];
  globalThis.game = {
    ...previousGame,
    user: {
      id: "player",
      isGM: false
    },
    combat: {
      id: "combat",
      round: 1,
      turn: 0
    },
    socket: {
      emit: (channel, message) => emitted.push({ channel, message })
    }
  };
  const service = new PaladinAutomationService({}, {
    promptDivineSmite: async () => ({
      slotLevel: 1,
      variantIds: ["magistrate-detention-smite"]
    }),
    rollPaladinSave: async () => ({ success: false, total: 6, dc: 15 })
  });
  const workflow = makeWeaponWorkflow({ actor: paladin, target });

  try {
    await service.applyMidiPreDamageRoll(workflow, workflow.activity, makeDamageConfig());
  }
  finally {
    globalThis.game = previousGame;
  }

  assert.equal(target.effects.contents.length, 0);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].channel, "module.rebreya-main");
  assert.deepEqual(emitted[0].message, {
    type: "character-class-automation",
    payload: {
      action: "paladin.magistrateSmite",
      sourceActorUuid: paladin.uuid,
      targetActorUuid: target.uuid,
      slotLevel: 1,
      variantIds: ["magistrate-detention-smite"],
      workflowId: "",
      workflowItemUuid: workflow.item.uuid
    },
    senderId: "player"
  });
});

test("Magistrate accusation effect removes advantage from d20 tests", () => {
  const target = new TestActor({
    id: "target",
    effects: [{
      name: "Кара обвинения: запрет преимущества",
      disabled: false,
      flags: {
        "rebreya-main": {
          paladinAutomation: {
            kind: "magistrateEffect",
            effect: "accusationNoAdvantage"
          }
        }
      }
    }]
  });
  const service = new PaladinAutomationService({});
  const rollConfig = {
    actor: target,
    advantage: true,
    rolls: [{
      options: {
        advantage: true,
        advantageMode: 1
      }
    }],
    options: {
      advantage: true,
      advantageMode: 1
    }
  };
  const dialogConfig = {
    advantage: true,
    options: {
      advantage: true
    }
  };

  service.applyDnd5ePreRollD20Test(rollConfig, dialogConfig, {});

  assert.equal(rollConfig.advantage, false);
  assert.equal(rollConfig.options.advantage, false);
  assert.equal(rollConfig.options.advantageMode, 0);
  assert.equal(rollConfig.rolls[0].options.advantage, false);
  assert.equal(rollConfig.rolls[0].options.advantageMode, 0);
  assert.equal(dialogConfig.advantage, false);
  assert.equal(dialogConfig.options.advantage, false);
});

test("Magistrate source-next-turn effects expire at the start of the Paladin turn", async () => {
  const deletedEffects = [];
  const paladin = new TestActor({ id: "magistrate", name: "Магистрат" });
  const makeEffect = (effect, sourceActorUuid = paladin.uuid) => ({
    name: effect,
    disabled: false,
    flags: {
      "rebreya-main": {
        paladinAutomation: {
          kind: "magistrateEffect",
          effect,
          sourceActorUuid,
          duration: "sourceNextTurn"
        }
      }
    },
    async delete() {
      deletedEffects.push(effect);
    }
  });
  const target = new TestActor({
    id: "target",
    effects: [
      makeEffect("detentionNoReaction"),
      makeEffect("accusationNoAdvantage"),
      makeEffect("detentionSlow", "Actor.other")
    ]
  });
  globalThis.game.actors = {
    get: (actorId) => (actorId === target.id ? target : null),
    contents: [target],
    values: () => [target].values()
  };
  const service = new PaladinAutomationService({});

  try {
    await service.handleCombatTurnChange({
      combatants: {
        contents: [{ actor: paladin }, { actor: target }],
        values: () => [{ actor: paladin }, { actor: target }].values()
      }
    }, { current: { actor: paladin } });
  }
  finally {
    delete globalThis.game.actors;
  }

  assert.deepEqual(deletedEffects.sort(), ["accusationNoAdvantage", "detentionNoReaction"]);
});

test("paladin divine smite uses DialogV2 input without the legacy Dialog class", async () => {
  const previousDialog = globalThis.Dialog;
  const previousApplications = globalThis.foundry.applications;
  const divineSmite = makeFeatureItem({
    id: "divine-smite",
    name: "Божественная кара",
    featureId: "paladin-rework-v01::class::paladin-divine-smite"
  });
  const paladin = new TestActor({
    items: [divineSmite],
    spellSlots: {
      spell1: { value: 1, max: 1 }
    }
  });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  let dialogCalls = 0;
  globalThis.Dialog = undefined;
  globalThis.foundry.applications = {
    api: {
      DialogV2: {
        async input({ ok }) {
          dialogCalls += 1;
          const form = {
            querySelector(selector) {
              if (selector === "[data-smite-slot]") return { value: "1" };
              if (selector === "[data-smite-target]") return { value: target.uuid };
              return null;
            },
            querySelectorAll() {
              return [];
            }
          };
          return ok?.callback?.({}, { form }) ?? {};
        }
      }
    }
  };
  const service = new PaladinAutomationService({});
  const workflow = makeWeaponWorkflow({ actor: paladin, target });
  const config = makeDamageConfig();

  try {
    await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.foundry.applications = previousApplications;
  }

  assert.equal(dialogCalls, 1);
  assert.equal(paladin.system.spells.spell1.value, 0);
  assert.equal(config.rolls.length, 1);
  assert.deepEqual(config.rolls[0].parts, ["2d8"]);
  assert.equal(config.rolls[0].options.type, "radiant");
});

test("paladin divine smite leaves critical doubling to the dnd5e damage roll", async () => {
  const divineSmite = makeFeatureItem({
    id: "divine-smite",
    name: "Divine Smite",
    featureId: "paladin-rework-v01::class::paladin-divine-smite"
  });
  const paladin = new TestActor({
    items: [divineSmite],
    spellSlots: {
      spell4: { value: 1, max: 1 }
    }
  });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  const service = new PaladinAutomationService({}, {
    promptDivineSmite: async () => ({ slotLevel: 4 })
  });
  const workflow = makeWeaponWorkflow({ actor: paladin, target, isCritical: true });
  const config = makeDamageConfig();

  await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);

  assert.equal(paladin.system.spells.spell4.value, 0);
  assert.equal(target.damageApplications.length, 0);
  assert.equal(config.rolls.length, 1);
  assert.deepEqual(config.rolls[0].parts, ["5d8"]);
  assert.equal(config.rolls[0].options.type, "radiant");
  assert.equal(workflow.isCritical, true);
});

test("paladin divine smite does not lock itself forever when combat is inactive", async () => {
  const previousCombat = globalThis.game.combat;
  globalThis.game.combat = null;
  const divineSmite = makeFeatureItem({
    id: "divine-smite",
    name: "Divine Smite",
    featureId: "paladin-rework-v01::class::paladin-divine-smite"
  });
  const paladin = new TestActor({
    items: [divineSmite],
    spellSlots: {
      spell1: { value: 2, max: 2 }
    }
  });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  let prompts = 0;
  const service = new PaladinAutomationService({}, {
    promptDivineSmite: async () => {
      prompts += 1;
      return { slotLevel: 1 };
    }
  });
  const firstWorkflow = makeWeaponWorkflow({ actor: paladin, target });
  const secondWorkflow = makeWeaponWorkflow({ actor: paladin, target });
  const firstConfig = makeDamageConfig();
  const secondConfig = makeDamageConfig();

  try {
    await service.applyMidiPreDamageRoll(firstWorkflow, firstWorkflow.activity, firstConfig);
    await service.applyMidiPreDamageRoll(secondWorkflow, secondWorkflow.activity, secondConfig);
  }
  finally {
    globalThis.game.combat = previousCombat;
  }

  assert.equal(prompts, 2);
  assert.equal(paladin.system.spells.spell1.value, 0);
  assert.equal(target.damageApplications.length, 0);
  assert.equal(firstConfig.rolls.length, 1);
  assert.equal(secondConfig.rolls.length, 1);
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

  const cappedFirstWorkflow = makeWeaponWorkflow({ actor: cappedPaladin, target });
  const cappedSecondWorkflow = makeWeaponWorkflow({ actor: cappedPaladin, target });
  const cappedFirstConfig = makeDamageConfig();
  const cappedSecondConfig = makeDamageConfig();
  await cappedService.applyMidiPreDamageRoll(cappedFirstWorkflow, cappedFirstWorkflow.activity, cappedFirstConfig);
  await cappedService.applyMidiPreDamageRoll(cappedSecondWorkflow, cappedSecondWorkflow.activity, cappedSecondConfig);

  assert.equal(cappedPrompts, 1);
  assert.equal(cappedPaladin.system.spells.spell1.value, 3);
  assert.equal(target.damageApplications.length, 0);
  assert.equal(cappedFirstConfig.rolls.length, 1);
  assert.deepEqual(cappedFirstConfig.rolls[0].parts, ["2d8"]);
  assert.equal(cappedFirstConfig.rolls[0].options.type, "radiant");
  assert.equal(cappedSecondConfig.rolls.length, 0);

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

  const uncappedFirstWorkflow = makeWeaponWorkflow({ actor: uncappedPaladin, target });
  const uncappedSecondWorkflow = makeWeaponWorkflow({ actor: uncappedPaladin, target });
  const uncappedFirstConfig = makeDamageConfig();
  const uncappedSecondConfig = makeDamageConfig();
  await uncappedService.applyMidiPreDamageRoll(uncappedFirstWorkflow, uncappedFirstWorkflow.activity, uncappedFirstConfig);
  await uncappedService.applyMidiPreDamageRoll(uncappedSecondWorkflow, uncappedSecondWorkflow.activity, uncappedSecondConfig);

  assert.equal(uncappedPrompts, 2);
  assert.equal(uncappedPaladin.system.spells.spell1.value, 2);
  assert.equal(uncappedFirstConfig.rolls.length, 1);
  assert.equal(uncappedSecondConfig.rolls.length, 1);
});

test("paladin divine smite automation hooks into midi pre-damage roll", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const listeners = [];
  const workflow = { id: "workflow" };
  let handledWorkflow = null;
  let handledD20Config = null;
  let handledCombat = null;
  globalThis.Hooks = {
    on(hookName, listener) {
      listeners.push({ hookName, listener });
      return listeners.length;
    }
  };
  globalThis.game = {
    user: {
      id: "user",
      isGM: true
    }
  };

  try {
    registerCombatHooks({
      paladinAutomationService: {
        async applyMidiPreDamageRoll(value) {
          handledWorkflow = value;
        },
        applyDnd5ePreRollD20Test(rollConfig) {
          handledD20Config = rollConfig;
          return true;
        },
        async handleCombatTurnChange(combat) {
          handledCombat = combat;
        }
      }
    });

    const hookNames = listeners.map((entry) => entry.hookName);
    assert.ok(hookNames.includes("midi-qol.preDamageRoll"));
    assert.ok(hookNames.includes("dnd5e.preRollD20Test"));
    assert.equal(hookNames.includes("midi-qol.DamageRollComplete"), false);
    assert.equal(hookNames.includes("midi-qol.RollComplete"), false);

    const preDamageRoll = listeners.find((entry) => entry.hookName === "midi-qol.preDamageRoll");
    await preDamageRoll.listener(workflow, workflow.activity, {});
    assert.equal(handledWorkflow, workflow);

    const preRollD20Test = listeners.find((entry) => entry.hookName === "dnd5e.preRollD20Test");
    const rollConfig = { id: "roll-config" };
    assert.equal(preRollD20Test.listener(rollConfig, {}, {}), true);
    assert.equal(handledD20Config, rollConfig);

    const combatTurn = listeners.find((entry) => entry.hookName === "combatTurn");
    assert.equal(typeof combatTurn?.listener, "function");
    await combatTurn.listener({ id: "combat" }, {}, {});
    assert.deepEqual(handledCombat, { id: "combat" });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});
