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
  })
};

class TestRoll {
  static messages = [];

  constructor(formula, data = {}) {
    this.formula = String(formula ?? "0");
    this.data = data;
    this.total = 0;
  }

  async evaluate() {
    const diceMatch = this.formula.match(/^(\d+)d6$/u);
    if (diceMatch) {
      this.total = Number(diceMatch[1]) * 3;
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

const { RogueAutomationService } = await import("../scripts/combat/rogue-automation-service.js");

class TestActor extends Actor {
  constructor({
    id = "rogue",
    name = "Плут",
    level = 5,
    isOwner = true,
    items = []
  } = {}) {
    super();
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.name = name;
    this.isOwner = isOwner;
    this.system = {
      classes: {
        "rogue-rework-v00": {
          identifier: "rogue-rework-v00",
          levels: level
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
    this.damageApplications = [];
  }

  getRollData() {
    return this.system;
  }

  async applyDamage(damage, options) {
    this.damageApplications.push({ damage, options });
    return this;
  }
}

function makeFeatureItem({
  id,
  name,
  featureId,
  sourceType = "classFeature",
  cost = 0
} = {}) {
  return {
    id,
    name,
    type: "feat",
    uuid: `Actor.rogue.Item.${id}`,
    system: {
      description: {
        value: `${name}.`
      }
    },
    flags: {
      "rebreya-main": {
        featureId,
        sourceType,
        cunningStrikeCost: cost
      }
    }
  };
}

function makeWeaponWorkflow({
  actor,
  target,
  item = {
    id: "shortsword",
    uuid: "Actor.rogue.Item.shortsword",
    name: "Короткий меч",
    type: "weapon",
    system: {
      actionType: "mwak",
      damage: {
        base: {
          types: ["piercing"]
        }
      }
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
    damageDetail: [{ type: item.system?.damage?.base?.types?.[0] ?? "piercing" }],
    hitTargets: new Set([{ actor: target }]),
    hitTargetsEC: new Set()
  };
}

test("rogue sneak attack prompts on a weapon hit and applies reduced damage for a selected cunning strike", async () => {
  TestRoll.messages = [];
  const sneakAttack = makeFeatureItem({
    id: "sneak-attack",
    name: "Скрытая атака",
    featureId: "rogue-rework-v00::class::rogue-sneak-attack"
  });
  const hamstring = makeFeatureItem({
    id: "hamstring",
    name: "Подрезать",
    featureId: "rogue-rework-v00::rogueCunningStrike::rogue-cunning-strike-hamstring",
    sourceType: "rogueCunningStrike",
    cost: 1
  });
  const rogue = new TestActor({ items: [sneakAttack, hamstring], level: 5 });
  const target = new TestActor({ id: "target", name: "Цель", items: [] });
  const prompts = [];
  const service = new RogueAutomationService({}, {
    promptSneakAttack: async (actor, details) => {
      prompts.push({ actor, details });
      return {
        targetUuid: target.uuid,
        cunningStrikeId: "rogue-cunning-strike-hamstring"
      };
    }
  });

  await service.applyMidiRollComplete(makeWeaponWorkflow({ actor: rogue, target }));

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].actor, rogue);
  assert.equal(prompts[0].details.formula, "3d6");
  assert.equal(prompts[0].details.damageType, "piercing");
  assert.equal(prompts[0].details.weapon.name, "Короткий меч");
  assert.deepEqual(prompts[0].details.targets.map((entry) => [entry.uuid, entry.name]), [
    [target.uuid, "Цель"]
  ]);
  assert.deepEqual(prompts[0].details.cunningStrikes.map((entry) => [entry.id, entry.name, entry.cost]), [
    ["rogue-cunning-strike-hamstring", "Подрезать", 1]
  ]);
  assert.equal(target.damageApplications.length, 1);
  assert.deepEqual(target.damageApplications[0].damage, [{
    value: 6,
    type: "piercing"
  }]);
  assert.equal(target.damageApplications[0].options.sourceActorUuid, rogue.uuid);
  assert.equal(TestRoll.messages[0].formula, "2d6");
  assert.match(TestRoll.messages[0].message.flavor, /Скрытая атака/u);
  assert.match(TestRoll.messages[0].message.flavor, /Подрезать/u);
});

test("rogue sneak attack asks without checking finesse or advantage and only once per turn after use", async () => {
  const sneakAttack = makeFeatureItem({
    id: "sneak-attack",
    name: "Скрытая атака",
    featureId: "rogue-rework-v00::class::rogue-sneak-attack"
  });
  const rogue = new TestActor({ items: [sneakAttack], level: 1 });
  const target = new TestActor({ id: "target", name: "Цель", items: [] });
  let prompts = 0;
  const service = new RogueAutomationService({}, {
    promptSneakAttack: async () => {
      prompts += 1;
      return {};
    }
  });
  const unfinessedWeapon = {
    id: "mace",
    uuid: "Actor.rogue.Item.mace",
    name: "Булава",
    type: "weapon",
    system: {
      actionType: "mwak",
      damage: {
        base: {
          types: ["bludgeoning"]
        }
      }
    }
  };

  await service.applyMidiRollComplete(makeWeaponWorkflow({ actor: rogue, target, item: unfinessedWeapon }));
  await service.applyMidiRollComplete(makeWeaponWorkflow({ actor: rogue, target, item: unfinessedWeapon }));

  assert.equal(prompts, 1);
  assert.equal(target.damageApplications.length, 1);
  assert.deepEqual(target.damageApplications[0].damage, [{
    value: 3,
    type: "bludgeoning"
  }]);
});
