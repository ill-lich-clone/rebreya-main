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
globalThis.ActiveEffect ??= class ActiveEffect {};
globalThis.ChatMessage ??= {
  create: async (data) => data,
  getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? "" })
};
globalThis.game ??= {
  user: {
    id: "user",
    isGM: true
  },
  combat: null,
  socket: null
};

const { FighterAutomationService } = await import("../scripts/combat/fighter-automation-service.js");

class TestActor extends Actor {
  constructor({ id = "actor", name = "Actor", hp = {}, items = [], effects = [] } = {}) {
    super();
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.name = name;
    this.isOwner = true;
    this.system = {
      abilities: {
        con: { mod: 3 }
      },
      attributes: {
        hp: {
          value: hp.value ?? 10,
          max: hp.max ?? 30,
          temp: 0
        }
      }
    };
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
    this.damageApplications = [];
    this.updates = [];
    this.createdEffects = [];
  }

  getRollData() {
    return {
      abilities: this.system.abilities,
      attributes: this.system.attributes
    };
  }

  async applyDamage(damages, options) {
    this.damageApplications.push({ damages, options });
    return true;
  }

  async update(patch) {
    this.updates.push(patch);
    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(this, path, value);
    }
    return this;
  }

  async createEmbeddedDocuments(type, rows) {
    this.createdEffects.push({ type, rows });
    return rows;
  }
}

function makeItem({ id, name, featureId = "", uses = null } = {}) {
  return {
    id,
    _id: id,
    uuid: `Item.${id}`,
    name,
    type: "feat",
    system: {
      uses: uses ?? {
        spent: 0,
        max: ""
      }
    },
    flags: {
      "rebreya-main": {
        featureId
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    updates: [],
    async update(patch) {
      this.updates.push(patch);
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
}

function makeActivity({ actor, item, automation, fighterAutomation } = {}) {
  return {
    actor,
    item,
    type: "utility",
    name: item?.name ?? "Activity",
    flags: {
      "rebreya-main": {
        automation,
        fighterAutomation
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function fixedRoll(total) {
  return {
    total,
    async evaluate() {
      return this;
    },
    async toMessage(data) {
      this.message = data;
      return data;
    }
  };
}

test("fighter maneuver runtime adds dominance damage to the last MIDI hit target and applies Rebreya status", async () => {
  const source = new TestActor({ id: "fighter", name: "Воин" });
  const target = new TestActor({ id: "target", name: "Цель" });
  const statuses = [];
  const service = new FighterAutomationService({
    combatStatusService: {
      setStatus: async (...args) => {
        statuses.push(args);
        return true;
      }
    }
  }, {
    rollFactory: () => fixedRoll(5)
  });
  const item = makeItem({ id: "provocation", name: "Провоцирующая атака" });
  const activity = makeActivity({
    actor: source,
    item,
    automation: "fighter-dominance-maneuver",
    fighterAutomation: {
      kind: "maneuver",
      extraDamage: {
        formula: "1d6"
      },
      status: {
        id: "rebreya-provoked",
        value: 1,
        durationRounds: 1
      }
    }
  });

  await service.applyMidiRollComplete({
    actor: source,
    item: {
      type: "weapon"
    },
    hitTargets: new Set([{ actor: target }]),
    damageDetail: [{ type: "slashing" }]
  });
  await service.applyDnd5ePostUseActivity(activity, {}, {});

  assert.deepEqual(target.damageApplications[0].damages, [{
    value: 5,
    type: "slashing"
  }]);
  assert.equal(target.damageApplications[0].options.sourceActorUuid, source.uuid);
  assert.deepEqual(statuses[0], [target, "rebreya-provoked", {
    active: true,
    value: 1,
    durationRounds: 1,
    sourceActor: source
  }]);
});

test("fighter second wind prompts for dice, spends selected uses, and heals the actor", async () => {
  const secondWind = makeItem({
    id: "second-wind",
    name: "Второе дыхание",
    featureId: "fighter-rework-v028::class::second-wind",
    uses: {
      spent: 1,
      max: 5,
      recovery: []
    }
  });
  const actor = new TestActor({
    id: "fighter",
    hp: {
      value: 10,
      max: 30
    },
    items: [secondWind]
  });
  const service = new FighterAutomationService({}, {
    promptSecondWindDice: async () => 3,
    rollFactory: () => fixedRoll(11)
  });
  const activity = makeActivity({
    actor,
    item: secondWind,
    automation: "fighter-second-wind",
    fighterAutomation: {
      kind: "secondWind",
      die: "d6",
      maxDiceAbility: "con",
      minDice: 1
    }
  });

  await service.applyDnd5ePostUseActivity(activity, {}, {});

  assert.equal(secondWind.system.uses.spent, 4);
  assert.equal(actor.system.attributes.hp.value, 21);
  assert.deepEqual(secondWind.updates[0], {
    "system.uses.spent": 4
  });
});

test("fighter iron will prompts second wind at the start of a bloodied turn", async () => {
  const secondWind = makeItem({
    id: "second-wind",
    name: "Второе дыхание",
    featureId: "fighter-rework-v028::class::second-wind",
    uses: {
      spent: 0,
      max: 5,
      recovery: []
    }
  });
  const ironWill = makeItem({
    id: "iron-will",
    name: "Железная воля",
    featureId: "fighter-rework-v028::class::iron-will"
  });
  const actor = new TestActor({
    id: "fighter",
    hp: {
      value: 10,
      max: 30
    },
    items: [secondWind, ironWill],
    effects: [{
      statuses: new Set(["bloodied"])
    }]
  });
  const service = new FighterAutomationService({}, {
    confirmIronWillSecondWind: async () => true,
    promptSecondWindDice: async () => 2,
    rollFactory: () => fixedRoll(7)
  });

  await service.handleCombatTurnChange({
    round: 4,
    turn: 2,
    combatant: {
      actor
    }
  });

  assert.equal(secondWind.system.uses.spent, 2);
  assert.equal(actor.system.attributes.hp.value, 17);
});

test("fighter iron will creates its next-save effect after healing while not bloodied", async () => {
  const ironWill = makeItem({
    id: "iron-will",
    name: "Железная воля",
    featureId: "fighter-rework-v028::class::iron-will"
  });
  const actor = new TestActor({
    id: "fighter",
    hp: {
      value: 20,
      max: 30
    },
    items: [ironWill]
  });
  const service = new FighterAutomationService({});

  await service.applyDnd5eApplyDamage(actor, -4, {});

  assert.equal(actor.createdEffects[0].type, "ActiveEffect");
  assert.equal(actor.createdEffects[0].rows[0].name, "Железная воля");
  assert.equal(actor.createdEffects[0].rows[0].flags["rebreya-main"].fighterAutomation.kind, "ironWillNextSave");
});
