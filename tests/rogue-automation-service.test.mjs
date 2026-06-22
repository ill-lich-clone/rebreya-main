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

  constructor(formula, data = {}, options = {}) {
    this.formula = String(formula ?? "0");
    this.data = data;
    this.options = options;
    this.total = 0;
    this._evaluated = false;
  }

  async evaluate() {
    const diceMatch = this.formula.match(/^(\d+)d6$/u);
    if (diceMatch) {
      this.total = Number(diceMatch[1]) * 3;
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

const { RogueAutomationService } = await import("../scripts/combat/rogue-automation-service.js");
const { registerCombatHooks } = await import("../scripts/combat/hooks.js");

class TestActor extends Actor {
  constructor({
    id = "rogue",
    name = "Rogue",
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
  isCritical = false,
  item = {
    id: "shortsword",
    uuid: "Actor.rogue.Item.shortsword",
    name: "Shortsword",
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
  const workflow = {
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
    hitTargetsEC: new Set(),
    isCritical
  };
  return workflow;
}

function makeDamageConfig() {
  return {
    rolls: []
  };
}

test("rogue sneak attack prompts on a weapon hit and adds reduced bonus damage for a selected cunning strike", async () => {
  TestRoll.messages = [];
  const sneakAttack = makeFeatureItem({
    id: "sneak-attack",
    name: "Sneak Attack",
    featureId: "rogue-rework-v00::class::rogue-sneak-attack"
  });
  const hamstring = makeFeatureItem({
    id: "hamstring",
    name: "Hamstring",
    featureId: "rogue-rework-v00::rogueCunningStrike::rogue-cunning-strike-hamstring",
    sourceType: "rogueCunningStrike",
    cost: 1
  });
  const rogue = new TestActor({ items: [sneakAttack, hamstring], level: 5 });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
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
  const workflow = makeWeaponWorkflow({ actor: rogue, target });
  const config = makeDamageConfig();

  await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].actor, rogue);
  assert.equal(prompts[0].details.formula, "3d6");
  assert.equal(prompts[0].details.damageType, "piercing");
  assert.equal(prompts[0].details.weapon.name, "Shortsword");
  assert.deepEqual(prompts[0].details.targets.map((entry) => [entry.uuid, entry.name]), [
    [target.uuid, "Target"]
  ]);
  assert.deepEqual(prompts[0].details.cunningStrikes.map((entry) => [entry.id, entry.name, entry.cost]), [
    ["rogue-cunning-strike-hamstring", "Hamstring", 1]
  ]);
  assert.equal(target.damageApplications.length, 0);
  assert.equal(TestRoll.messages.length, 0);
  assert.equal(config.rolls.length, 1);
  assert.deepEqual(config.rolls[0].parts, ["2d6"]);
  assert.equal(config.rolls[0].options.type, "piercing");
  assert.deepEqual(config.rolls[0].options.types, ["piercing"]);
  assert.match(config.rolls[0].options.flavor, /Hamstring/u);
});

test("rogue sneak attack asks without checking finesse or advantage and only once per turn after use", async () => {
  const sneakAttack = makeFeatureItem({
    id: "sneak-attack",
    name: "Sneak Attack",
    featureId: "rogue-rework-v00::class::rogue-sneak-attack"
  });
  const rogue = new TestActor({ items: [sneakAttack], level: 1 });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
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
    name: "Mace",
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
  const firstWorkflow = makeWeaponWorkflow({ actor: rogue, target, item: unfinessedWeapon });
  const secondWorkflow = makeWeaponWorkflow({ actor: rogue, target, item: unfinessedWeapon });
  const firstConfig = makeDamageConfig();
  const secondConfig = makeDamageConfig();

  await service.applyMidiPreDamageRoll(firstWorkflow, firstWorkflow.activity, firstConfig);
  await service.applyMidiPreDamageRoll(secondWorkflow, secondWorkflow.activity, secondConfig);

  assert.equal(prompts, 1);
  assert.equal(target.damageApplications.length, 0);
  assert.equal(firstConfig.rolls.length, 1);
  assert.deepEqual(firstConfig.rolls[0].parts, ["1d6"]);
  assert.equal(firstConfig.rolls[0].options.type, "bludgeoning");
  assert.equal(secondConfig.rolls.length, 0);
});

test("rogue sneak attack prompts from rogue class data even if the feature item is missing", async () => {
  const rogue = new TestActor({ items: [], level: 1 });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  let prompts = 0;
  const service = new RogueAutomationService({}, {
    promptSneakAttack: async () => {
      prompts += 1;
      return {};
    }
  });
  const workflow = makeWeaponWorkflow({ actor: rogue, target });
  const config = makeDamageConfig();

  await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);

  assert.equal(prompts, 1);
  assert.equal(target.damageApplications.length, 0);
  assert.equal(config.rolls.length, 1);
  assert.deepEqual(config.rolls[0].parts, ["1d6"]);
  assert.equal(config.rolls[0].options.type, "piercing");
});

test("rogue sneak attack leaves critical doubling to the dnd5e damage roll", async () => {
  const sneakAttack = makeFeatureItem({
    id: "sneak-attack",
    name: "Sneak Attack",
    featureId: "rogue-rework-v00::class::rogue-sneak-attack"
  });
  const hamstring = makeFeatureItem({
    id: "hamstring",
    name: "Hamstring",
    featureId: "rogue-rework-v00::rogueCunningStrike::rogue-cunning-strike-hamstring",
    sourceType: "rogueCunningStrike",
    cost: 1
  });
  const rogue = new TestActor({ items: [sneakAttack, hamstring], level: 5 });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  const service = new RogueAutomationService({}, {
    promptSneakAttack: async () => ({
      targetUuid: target.uuid,
      cunningStrikeId: "rogue-cunning-strike-hamstring"
    })
  });
  const workflow = makeWeaponWorkflow({ actor: rogue, target, isCritical: true });
  const config = makeDamageConfig();

  await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);

  assert.equal(config.rolls.length, 1);
  assert.deepEqual(config.rolls[0].parts, ["2d6"]);
  assert.equal(workflow.isCritical, true);
  assert.equal(target.damageApplications.length, 0);
});

test("rogue sneak attack does not lock itself forever when combat is inactive", async () => {
  const previousCombat = globalThis.game.combat;
  globalThis.game.combat = null;
  const sneakAttack = makeFeatureItem({
    id: "sneak-attack",
    name: "Sneak Attack",
    featureId: "rogue-rework-v00::class::rogue-sneak-attack"
  });
  const rogue = new TestActor({ items: [sneakAttack], level: 1 });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  let prompts = 0;
  const service = new RogueAutomationService({}, {
    promptSneakAttack: async () => {
      prompts += 1;
      return {};
    }
  });
  const firstWorkflow = makeWeaponWorkflow({ actor: rogue, target });
  const secondWorkflow = makeWeaponWorkflow({ actor: rogue, target });
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
  assert.equal(firstConfig.rolls.length, 1);
  assert.equal(secondConfig.rolls.length, 1);
});

test("rogue sneak attack automation hooks into midi pre-damage roll", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const listeners = [];
  const workflow = { id: "workflow" };
  let handledWorkflow = null;
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
      rogueAutomationService: {
        async applyMidiPreDamageRoll(value) {
          handledWorkflow = value;
        }
      }
    });

    const hookNames = listeners.map((entry) => entry.hookName);
    assert.ok(hookNames.includes("midi-qol.preDamageRoll"));
    assert.equal(hookNames.includes("midi-qol.DamageRollComplete"), false);
    assert.equal(hookNames.includes("midi-qol.RollComplete"), false);

    const preDamageRoll = listeners.find((entry) => entry.hookName === "midi-qol.preDamageRoll");
    await preDamageRoll.listener(workflow, workflow.activity, {});
    assert.equal(handledWorkflow, workflow);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});
