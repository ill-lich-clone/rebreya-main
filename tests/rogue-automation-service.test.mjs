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
    dexMod = 3,
    prof = 2,
    isOwner = true,
    items = []
  } = {}) {
    super();
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.name = name;
    this.isOwner = isOwner;
    this.system = {
      abilities: {
        dex: { mod: dexMod }
      },
      attributes: {
        prof
      },
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
    this.createdDocuments = [];
  }

  async createEmbeddedDocuments(type, documents) {
    this.createdDocuments.push({ type, documents });
    return documents;
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
  cost = 0,
  description = `${name}.`
} = {}) {
  return {
    id,
    name,
    type: "feat",
    uuid: `Actor.rogue.Item.${id}`,
    system: {
      description: {
        value: description
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

function fixedRoll(total) {
  return { total };
}

function makeMessage(content = "<div class=\"midi-card\">Attack</div>") {
  return {
    content,
    updates: [],
    async update(patch) {
      this.updates.push(patch);
      if (Object.hasOwn(patch, "content")) {
        this.content = patch.content;
      }
      return this;
    }
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

test("rogue hamstring cunning strike applies a speed penalty and writes the attack card", async () => {
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
    cost: 1,
    description: "Speed is reduced by 10 feet."
  });
  const rogue = new TestActor({ items: [sneakAttack, hamstring], level: 5 });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  const service = new RogueAutomationService({}, {
    promptSneakAttack: async () => ({
      targetUuid: target.uuid,
      cunningStrikeId: "rogue-cunning-strike-hamstring"
    })
  });
  const workflow = makeWeaponWorkflow({ actor: rogue, target });
  const config = makeDamageConfig();
  const message = makeMessage();

  await service.applyMidiPreDamageRoll(workflow, workflow.activity, config, null, message);

  assert.equal(target.createdDocuments.length, 1);
  assert.equal(target.createdDocuments[0].type, "ActiveEffect");
  const [effect] = target.createdDocuments[0].documents;
  const changesByKey = new Map(effect.changes.map((change) => [change.key, change]));
  assert.equal(changesByKey.get("system.attributes.movement.walk").value, "-10");
  assert.equal(changesByKey.get("system.attributes.movement.fly").value, "-10");
  assert.deepEqual(effect.flags.dae.specialDuration, ["turnStartSource", "combatEnd"]);
  assert.equal(effect.origin, rogue.uuid);
  assert.equal(message.updates.length, 1);
  assert.match(message.content, /data-rebreya-cunning-strike="rogue-cunning-strike-hamstring"/u);
  assert.match(message.content, /Hamstring/u);
  assert.match(message.content, /Speed is reduced by 10 feet/u);
});

test("rogue disrupt aim cunning strike gives the target disadvantage on its next attack", async () => {
  const sneakAttack = makeFeatureItem({
    id: "sneak-attack",
    name: "Sneak Attack",
    featureId: "rogue-rework-v00::class::rogue-sneak-attack"
  });
  const disruptAim = makeFeatureItem({
    id: "disrupt-aim",
    name: "Disrupt Aim",
    featureId: "rogue-rework-v00::rogueCunningStrike::rogue-cunning-strike-disrupt-aim",
    sourceType: "rogueCunningStrike",
    cost: 1
  });
  const rogue = new TestActor({ items: [sneakAttack, disruptAim], level: 5 });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  const service = new RogueAutomationService({}, {
    promptSneakAttack: async () => ({
      targetUuid: target.uuid,
      cunningStrikeId: "rogue-cunning-strike-disrupt-aim"
    })
  });
  const workflow = makeWeaponWorkflow({ actor: rogue, target });
  const config = makeDamageConfig();

  await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);

  assert.equal(target.createdDocuments.length, 1);
  const [effect] = target.createdDocuments[0].documents;
  assert.deepEqual(effect.changes, [{
    key: "flags.midi-qol.disadvantage.attack.all",
    mode: 0,
    value: "1",
    priority: 20
  }]);
  assert.deepEqual(effect.flags.dae.specialDuration, ["1Attack", "turnStartSource", "combatEnd"]);
});

test("rogue cunning strike writes card info through the workflow item card uuid when midi passes a message config", async () => {
  const previousFromUuid = globalThis.fromUuid;
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
  const card = makeMessage();
  globalThis.fromUuid = async (uuid) => (uuid === "ChatMessage.card" ? card : null);
  const service = new RogueAutomationService({}, {
    promptSneakAttack: async () => ({
      targetUuid: target.uuid,
      cunningStrikeId: "rogue-cunning-strike-hamstring"
    })
  });
  const workflow = makeWeaponWorkflow({ actor: rogue, target });
  workflow.itemCardUuid = "ChatMessage.card";
  const config = makeDamageConfig();

  try {
    await service.applyMidiPreDamageRoll(workflow, workflow.activity, config, null, {});
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
  }

  assert.equal(card.updates.length, 1);
  assert.match(card.content, /data-rebreya-cunning-strike="rogue-cunning-strike-hamstring"/u);
});

test("rogue open position cunning strike applies through Convenient Effects when available", async () => {
  const previousDfreds = globalThis.game.dfreds;
  const sneakAttack = makeFeatureItem({
    id: "sneak-attack",
    name: "Sneak Attack",
    featureId: "rogue-rework-v00::class::rogue-sneak-attack"
  });
  const openPosition = makeFeatureItem({
    id: "open-position",
    name: "Open Position",
    featureId: "rogue-rework-v00::rogueCunningStrike::rogue-cunning-strike-open-position",
    sourceType: "rogueCunningStrike",
    cost: 1
  });
  const rogue = new TestActor({ items: [sneakAttack, openPosition], level: 5 });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  const appliedEffects = [];
  const effectUpdates = [];
  globalThis.game.dfreds = {
    effectInterface: {
      findEffect: ({ effectName }) => (effectName === "\u041e\u0442\u043a\u0440\u044b\u0442\u0430\u044f \u043f\u043e\u0437\u0438\u0446\u0438\u044f" ? { name: effectName } : null),
      addEffect: async (payload) => {
        appliedEffects.push(payload);
        return [{
          async update(patch) {
            effectUpdates.push(patch);
            return this;
          }
        }];
      }
    }
  };
  const statuses = [];
  const service = new RogueAutomationService({
    combatStatusService: {
      setStatus: async (...args) => {
        statuses.push(args);
        return true;
      }
    }
  }, {
    promptSneakAttack: async () => ({
      targetUuid: target.uuid,
      cunningStrikeId: "rogue-cunning-strike-open-position"
    })
  });
  const workflow = makeWeaponWorkflow({ actor: rogue, target });
  const config = makeDamageConfig();

  try {
    await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);
  }
  finally {
    globalThis.game.dfreds = previousDfreds;
  }

  assert.deepEqual(appliedEffects, [{
    effectName: "\u041e\u0442\u043a\u0440\u044b\u0442\u0430\u044f \u043f\u043e\u0437\u0438\u0446\u0438\u044f",
    uuid: target.uuid,
    origin: rogue.uuid
  }]);
  assert.equal(statuses.length, 0);
  assert.equal(effectUpdates.length, 1);
  assert.equal(effectUpdates[0].origin, rogue.uuid);
  assert.deepEqual(effectUpdates[0]["flags.dae.specialDuration"], ["turnStartSource", "combatEnd"]);
  assert.equal(effectUpdates[0]["flags.rebreya-main.rogueAutomation.kind"], "cunningStrikeConvenientEffect");
});

test("rogue trip cunning strike rolls a dexterity save before applying prone", async () => {
  const sneakAttack = makeFeatureItem({
    id: "sneak-attack",
    name: "Sneak Attack",
    featureId: "rogue-rework-v00::class::rogue-sneak-attack"
  });
  const trip = makeFeatureItem({
    id: "trip",
    name: "Trip",
    featureId: "rogue-rework-v00::rogueCunningStrike::rogue-cunning-strike-trip",
    sourceType: "rogueCunningStrike",
    cost: 2
  });
  const rogue = new TestActor({ items: [sneakAttack, trip], level: 5, dexMod: 4, prof: 3 });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  const saves = [];
  target.rollSavingThrow = async (config) => {
    saves.push(config);
    return [fixedRoll(8)];
  };
  const statusUpdates = [];
  const service = new RogueAutomationService({
    combatStatusService: {
      setStatus: async (...args) => {
        statusUpdates.push(args);
        return {
          async update(patch) {
            this.patch = patch;
            return this;
          }
        };
      }
    }
  }, {
    promptSneakAttack: async () => ({
      targetUuid: target.uuid,
      cunningStrikeId: "rogue-cunning-strike-trip"
    })
  });
  const workflow = makeWeaponWorkflow({ actor: rogue, target });
  const config = makeDamageConfig();

  await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);

  assert.deepEqual(saves.map((save) => ({ ability: save.ability, target: save.target })), [{
    ability: "dex",
    target: 15
  }]);
  assert.equal(statusUpdates.length, 1);
  assert.equal(statusUpdates[0][0], target);
  assert.equal(statusUpdates[0][1], "prone");
  assert.deepEqual(statusUpdates[0][2], {
    active: true,
    durationRounds: 1,
    sourceActor: rogue
  });
});

test("rogue break tempo cunning strike applies frostbitten 1 on a successful save", async () => {
  const sneakAttack = makeFeatureItem({
    id: "sneak-attack",
    name: "Sneak Attack",
    featureId: "rogue-rework-v00::class::rogue-sneak-attack"
  });
  const breakTempo = makeFeatureItem({
    id: "break-tempo",
    name: "Break Tempo",
    featureId: "rogue-rework-v00::rogueCunningStrike::rogue-cunning-strike-break-tempo",
    sourceType: "rogueCunningStrike",
    cost: 3
  });
  const rogue = new TestActor({ items: [sneakAttack, breakTempo], level: 7 });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  const saves = [];
  target.rollSavingThrow = async (config) => {
    saves.push(config);
    return [fixedRoll(20)];
  };
  const statusUpdates = [];
  const service = new RogueAutomationService({
    combatStatusService: {
      setStatus: async (...args) => {
        statusUpdates.push(args);
        return true;
      }
    }
  }, {
    promptSneakAttack: async () => ({
      targetUuid: target.uuid,
      cunningStrikeId: "rogue-cunning-strike-break-tempo"
    })
  });
  const workflow = makeWeaponWorkflow({ actor: rogue, target });
  const config = makeDamageConfig();

  await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);

  assert.deepEqual(saves.map((save) => ({ ability: save.ability, target: save.target })), [{
    ability: "con",
    target: 13
  }]);
  assert.equal(statusUpdates.length, 1);
  assert.equal(statusUpdates[0][1], "rebreya-frostbitten");
  assert.deepEqual(statusUpdates[0][2], {
    active: true,
    value: 1,
    durationRounds: 1,
    sourceActor: rogue
  });
});

test("rogue sneak attack uses DialogV2 input without the legacy Dialog class", async () => {
  const previousDialog = globalThis.Dialog;
  const previousApplications = globalThis.foundry.applications;
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
    cost: 1,
    description: "Speed is reduced by 10 feet."
  });
  const rogue = new TestActor({ items: [sneakAttack, hamstring], level: 5 });
  const target = new TestActor({ id: "target", name: "Target", items: [] });
  let dialogCalls = 0;
  let dialogContent = "";
  globalThis.Dialog = undefined;
  globalThis.foundry.applications = {
    api: {
      DialogV2: {
        async input({ content, ok }) {
          dialogCalls += 1;
          dialogContent = content;
          const form = {
            querySelector(selector) {
              if (selector === "[data-sneak-attack-target]") return { value: target.uuid };
              if (selector === "[data-sneak-attack-cunning-strike]:checked") {
                return { value: "rogue-cunning-strike-hamstring" };
              }
              return null;
            }
          };
          return ok?.callback?.({}, { form }) ?? {};
        }
      }
    }
  };
  const service = new RogueAutomationService({});
  const workflow = makeWeaponWorkflow({ actor: rogue, target });
  const config = makeDamageConfig();

  try {
    await service.applyMidiPreDamageRoll(workflow, workflow.activity, config);
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.foundry.applications = previousApplications;
  }

  assert.equal(dialogCalls, 1);
  assert.equal(config.rolls.length, 1);
  assert.deepEqual(config.rolls[0].parts, ["2d6"]);
  assert.equal(config.rolls[0].options.type, "piercing");
  assert.match(dialogContent, /type="checkbox"/u);
  assert.doesNotMatch(dialogContent, /<select[^>]*data-sneak-attack-cunning-strike/u);
  assert.match(dialogContent, /Hamstring/u);
  assert.match(dialogContent, /Speed is reduced by 10 feet/u);
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
