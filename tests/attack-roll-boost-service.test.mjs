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
globalThis.Item ??= class Item {};
globalThis.ChatMessage ??= {
  create: async (data) => data,
  getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? "" })
};
globalThis.game ??= {
  user: {
    id: "user",
    isGM: true
  },
  i18n: {
    localize: (value) => value
  }
};

class TestRoll {
  constructor(formula, data = {}, options = {}) {
    this.formula = String(formula ?? "0");
    this.data = data;
    this.options = options;
    this.total = 0;
  }

  async evaluate(options = {}) {
    this.total = options.maximize === true
      ? maxFormulaTotal(this.formula)
      : (TestRoll.queuedTotals.shift() ?? maxFormulaTotal(this.formula));
    return this;
  }

  async roll(options = {}) {
    return this.evaluate(options);
  }

  async toMessage(messageData = {}) {
    TestRoll.messages.push({
      formula: this.formula,
      total: this.total,
      messageData
    });
    return messageData;
  }
}
TestRoll.queuedTotals = [];
TestRoll.messages = [];

globalThis.Roll = TestRoll;

const { AttackRollBoostService } = await import("../scripts/combat/attack-roll-boost-service.js");

function maxFormulaTotal(formula) {
  const text = String(formula ?? "0").replace(/\s+/gu, "");
  if (text === "@scale.fighter-rework-v028.dominance-die") {
    return 6;
  }
  const replaced = text.replace(/(\d*)d(\d+)/giu, (_match, count, faces) => {
    const diceCount = Number(count || 1);
    return String(diceCount * Number(faces));
  });
  return replaced
    .split(/(?=[+-])/u)
    .map((part) => Number(part || 0))
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
}

function makeItem({ id, name, boosts = [], uses = null } = {}) {
  return {
    id,
    name,
    uuid: `Actor.hero.Item.${id}`,
    flags: {
      "rebreya-main": {
        attackRollBoosts: boosts
      }
    },
    system: {
      identifier: id,
      uses: uses ?? {
        spent: 0,
        max: ""
      }
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

function makeActor(items = []) {
  const actor = new Actor();
  actor.id = "hero";
  actor.uuid = "Actor.hero";
  actor.name = "Герой";
  actor.isOwner = true;
  actor.getRollData = () => ({});
  actor.items = {
    contents: items,
    get: (itemId) => items.find((item) => item.id === itemId) ?? null,
    values: () => items.values(),
    [Symbol.iterator]: function* iterator() {
      yield* items;
    }
  };
  for (const item of items) {
    item.actor = actor;
  }
  return actor;
}

function makeTarget({ id = "target", ac = 19, name = "Цель" } = {}) {
  return {
    id,
    uuid: `Scene.scene.Token.${id}`,
    name,
    actor: {
      uuid: `Actor.${id}`,
      name,
      system: {
        attributes: {
          ac: {
            value: ac
          }
        }
      }
    },
    document: {
      uuid: `Scene.scene.Token.${id}`
    }
  };
}

function makeWeaponWorkflow({ actor, target, attackTotal = 18 } = {}) {
  return {
    actor,
    item: {
      type: "weapon",
      name: "Длинный меч",
      uuid: "Actor.hero.Item.weapon"
    },
    activity: {
      actionType: "mwak",
      attack: true,
      hasAttack: true,
      target: {
        affects: {
          type: "creature"
        }
      }
    },
    attackRoll: {
      total: attackTotal,
      options: {},
      data: {}
    },
    attackTotal,
    targets: new Set([target]),
    hitTargets: new Set(),
    hitTargetsEC: new Set(),
    hitDisplayData: {}
  };
}

test("attack roll boosts show all sources whose combined maximum can turn a miss into a hit", async () => {
  const boosts = [
    { id: "small-1", label: "+1d3", formula: "1d3" },
    { id: "small-2", label: "+1d3", formula: "1d3" },
    { id: "large", label: "+1d12", formula: "1d12" }
  ];
  const actor = makeActor([makeItem({ id: "boosts", name: "Boosts", boosts })]);
  const target = makeTarget({ ac: 24 });
  const workflow = makeWeaponWorkflow({ actor, target, attackTotal: 18 });
  let promptDetails = null;
  const service = new AttackRollBoostService({}, {
    promptAttackRollBoosts: async (details) => {
      promptDetails = details;
      return [];
    }
  });

  await service.applyMidiHitsChecked(workflow);

  assert.deepEqual(promptDetails.options.map((option) => option.id), ["small-1", "small-2", "large"]);
  assert.equal(promptDetails.needed, 6);
  assert.equal(workflow.hitTargets.size, 0);
});

test("attack roll boosts add selected dice, spend configured uses, and mark targets hit when the new total reaches AC", async () => {
  const dominance = makeItem({
    id: "fighter-dominance",
    name: "Стиль доминирования",
    uses: {
      spent: 0,
      max: "4"
    }
  });
  const preciseAttack = makeItem({
    id: "precise-attack",
    name: "Точная атака",
    boosts: [{
      id: "fighter-precise-attack",
      label: "Точная атака",
      formula: "1d6",
      consumption: {
        type: "itemUses",
        target: "fighter-dominance",
        value: "1"
      }
    }]
  });
  const actor = makeActor([dominance, preciseAttack]);
  const target = makeTarget({ ac: 19 });
  const workflow = makeWeaponWorkflow({ actor, target, attackTotal: 18 });
  TestRoll.queuedTotals = [6];
  const service = new AttackRollBoostService({}, {
    promptAttackRollBoosts: async () => ["fighter-precise-attack"]
  });

  await service.applyMidiHitsChecked(workflow);

  assert.equal(workflow.attackTotal, 24);
  assert.equal(workflow.attackRoll.total, 24);
  assert.equal(workflow.hitTargets.has(target), true);
  assert.equal(dominance.system.uses.spent, 1);
  assert.deepEqual(workflow.flags?.["rebreya-main"]?.attackRollBoosts?.map((entry) => ({
    id: entry.id,
    rollTotal: entry.rollTotal,
    targetNames: entry.targetNames
  })), [{
    id: "fighter-precise-attack",
    rollTotal: 6,
    targetNames: ["Цель"]
  }]);
});

test("stale fighter precise attack maneuver items still provide an attack roll boost", async () => {
  const dominance = makeItem({
    id: "old-dominance-id",
    name: "Стиль доминирования",
    boosts: [],
    uses: {
      spent: 0,
      max: "4"
    }
  });
  dominance.flags["rebreya-main"] = {};
  dominance.system.identifier = "";
  const preciseAttack = makeItem({
    id: "old-precise-id",
    name: "Точная атака",
    boosts: []
  });
  preciseAttack.flags["rebreya-main"] = {
    sourceType: "fighterManeuver",
    classIdentifier: "fighter-rework-v028"
  };
  preciseAttack.system.activities = {
    oldActivity: {
      flags: {
        "rebreya-main": {
          automation: "fighter-dominance-maneuver",
          fighterAutomation: {
            kind: "maneuver",
            key: "точная атака"
          }
        }
      }
    }
  };
  const actor = makeActor([dominance, preciseAttack]);
  const target = makeTarget({ ac: 18 });
  const workflow = makeWeaponWorkflow({ actor, target, attackTotal: 17 });
  let promptDetails = null;
  const service = new AttackRollBoostService({}, {
    promptAttackRollBoosts: async (details) => {
      promptDetails = details;
      return [];
    }
  });

  await service.applyMidiHitsChecked(workflow);

  assert.deepEqual(promptDetails.options.map((option) => ({
    id: option.id,
    label: option.label,
    formula: option.formula,
    displayFormula: option.displayFormula
  })), [{
    id: "fighter-precise-attack",
    label: "Точная атака",
    formula: "@scale.fighter-rework-v028.dominance-die",
    displayFormula: "1к4"
  }]);
  assert.equal(promptDetails.needed, 1);
});

test("duplicate precise attack maneuver items only show one attack roll boost option", async () => {
  const dominance = makeItem({
    id: "fighter-dominance",
    name: "Стиль доминирования",
    uses: {
      spent: 0,
      max: "4"
    }
  });
  const firstPreciseAttack = makeItem({
    id: "first-precise",
    name: "Точная атака",
    boosts: []
  });
  firstPreciseAttack.flags["rebreya-main"] = {
    sourceType: "fighterManeuver",
    classIdentifier: "fighter-rework-v028"
  };
  const secondPreciseAttack = makeItem({
    id: "second-precise",
    name: "Точная атака",
    boosts: []
  });
  secondPreciseAttack.flags["rebreya-main"] = {
    sourceType: "fighterManeuver",
    classIdentifier: "fighter-rework-v028"
  };
  const actor = makeActor([dominance, firstPreciseAttack, secondPreciseAttack]);
  const target = makeTarget({ ac: 18 });
  const workflow = makeWeaponWorkflow({ actor, target, attackTotal: 14 });
  let promptDetails = null;
  const service = new AttackRollBoostService({}, {
    promptAttackRollBoosts: async (details) => {
      promptDetails = details;
      return [];
    }
  });

  await service.applyMidiHitsChecked(workflow);

  assert.deepEqual(promptDetails.options.map((option) => option.id), ["fighter-precise-attack"]);
});

test("bare dnd5e attack rolls prompt for selected target boosts", async () => {
  const dominance = makeItem({
    id: "fighter-dominance",
    name: "Стиль доминирования",
    uses: {
      spent: 0,
      max: "4"
    }
  });
  const preciseAttack = makeItem({
    id: "precise-attack",
    name: "Точная атака",
    boosts: []
  });
  preciseAttack.flags["rebreya-main"] = {
    sourceType: "fighterManeuver",
    classIdentifier: "fighter-rework-v028"
  };
  const weapon = makeItem({
    id: "longbow",
    name: "Длинный лук",
    boosts: []
  });
  weapon.type = "weapon";
  const actor = makeActor([dominance, preciseAttack, weapon]);
  const target = makeTarget({ ac: 18 });
  const previousTargets = globalThis.game.user.targets;
  globalThis.game.user.targets = new Set([target]);
  let promptDetails = null;
  const service = new AttackRollBoostService({}, {
    promptAttackRollBoosts: async (details) => {
      promptDetails = details;
      return [];
    }
  });

  try {
    await service.applyDnd5eRollAttack([{
      total: 14,
      _total: 14,
      formula: "1d20 + 6",
      flags: {}
    }], {
      subject: {
        actor,
        item: weapon,
        actionType: "rwak",
        hasAttack: true,
        attack: true
      }
    });
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }

  assert.deepEqual(promptDetails.options.map((option) => option.id), ["fighter-precise-attack"]);
  assert.equal(promptDetails.needed, 4);
});

test("dnd5e attack roll fallback skips rolls already owned by a MIDI workflow", async () => {
  const dominance = makeItem({
    id: "fighter-dominance",
    name: "Стиль доминирования",
    uses: {
      spent: 0,
      max: "4"
    }
  });
  const preciseAttack = makeItem({
    id: "precise-attack",
    name: "Точная атака",
    boosts: []
  });
  preciseAttack.flags["rebreya-main"] = {
    sourceType: "fighterManeuver",
    classIdentifier: "fighter-rework-v028"
  };
  const weapon = makeItem({
    id: "longbow",
    name: "Длинный лук",
    boosts: []
  });
  weapon.type = "weapon";
  const actor = makeActor([dominance, preciseAttack, weapon]);
  const target = makeTarget({ ac: 18 });
  const previousTargets = globalThis.game.user.targets;
  globalThis.game.user.targets = new Set([target]);
  let promptDetails = null;
  const service = new AttackRollBoostService({}, {
    promptAttackRollBoosts: async (details) => {
      promptDetails = details;
      return [];
    }
  });

  try {
    await service.applyDnd5eRollAttack([{
      total: 14,
      _total: 14,
      formula: "1d20 + 6",
      flags: {},
      options: {
        workflow: {}
      }
    }], {
      subject: {
        actor,
        item: weapon,
        actionType: "rwak",
        hasAttack: true,
        attack: true
      }
    });
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }

  assert.equal(promptDetails, null);
});

test("bare dnd5e attack roll fallback only prompts once per roll object", async () => {
  const dominance = makeItem({
    id: "fighter-dominance",
    name: "Стиль доминирования",
    uses: {
      spent: 0,
      max: "4"
    }
  });
  const preciseAttack = makeItem({
    id: "precise-attack",
    name: "Точная атака",
    boosts: []
  });
  preciseAttack.flags["rebreya-main"] = {
    sourceType: "fighterManeuver",
    classIdentifier: "fighter-rework-v028"
  };
  const weapon = makeItem({
    id: "longbow",
    name: "Длинный лук",
    boosts: []
  });
  weapon.type = "weapon";
  const actor = makeActor([dominance, preciseAttack, weapon]);
  const target = makeTarget({ ac: 18 });
  const previousTargets = globalThis.game.user.targets;
  globalThis.game.user.targets = new Set([target]);
  let promptCount = 0;
  const service = new AttackRollBoostService({}, {
    promptAttackRollBoosts: async () => {
      promptCount += 1;
      return [];
    }
  });
  const attackRoll = {
    total: 14,
    _total: 14,
    formula: "1d20 + 6",
    flags: {}
  };
  const context = {
    subject: {
      actor,
      item: weapon,
      actionType: "rwak",
      hasAttack: true,
      attack: true
    }
  };

  try {
    await service.applyDnd5eRollAttack([attackRoll], context);
    await service.applyDnd5eRollAttack([attackRoll], context);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }

  assert.equal(promptCount, 1);
});

test("fresh precise attack boost still prompts when scale max cannot be evaluated by Roll", async () => {
  const dominance = makeItem({
    id: "fighter-dominance",
    name: "Стиль доминирования",
    uses: {
      spent: 0,
      max: "2"
    }
  });
  const preciseAttack = makeItem({
    id: "precise-attack",
    name: "Точная атака",
    boosts: [{
      id: "fighter-precise-attack",
      label: "Точная атака",
      formula: "@scale.fighter-rework-v028.dominance-die",
      consumption: {
        type: "itemUses",
        target: "fighter-dominance",
        value: "1"
      }
    }]
  });
  const actor = makeActor([dominance, preciseAttack]);
  actor.system = {
    scale: {
      "fighter-rework-v028": {
        "dominance-die": {
          number: null,
          faces: 6,
          modifiers: []
        }
      }
    }
  };
  const target = makeTarget({ ac: 18 });
  const workflow = makeWeaponWorkflow({ actor, target, attackTotal: 17 });
  let promptDetails = null;
  const service = new AttackRollBoostService({}, {
    rollFactory: (formula) => {
      if (String(formula).includes("@scale.")) {
        throw new Error("Scale formula is unavailable in this roll context");
      }
      return new TestRoll(formula);
    },
    promptAttackRollBoosts: async (details) => {
      promptDetails = details;
      return [];
    }
  });

  await service.applyMidiHitsChecked(workflow);

  assert.deepEqual(promptDetails.options.map((option) => ({
    id: option.id,
    label: option.label,
    formula: option.formula,
    displayFormula: option.displayFormula,
    maxTotal: option.maxTotal
  })), [{
    id: "fighter-precise-attack",
    label: "Точная атака",
    formula: "@scale.fighter-rework-v028.dominance-die",
    displayFormula: "1к6",
    maxTotal: 6
  }]);
  assert.equal(promptDetails.needed, 1);
});

test("manually added precise attack boost falls back to a base dominance die without actor scale", async () => {
  const dominance = makeItem({
    id: "fighter-dominance",
    name: "Стиль доминирования",
    uses: {
      spent: 0,
      max: "2"
    }
  });
  const preciseAttack = makeItem({
    id: "precise-attack",
    name: "Точная атака",
    boosts: [{
      id: "fighter-precise-attack",
      label: "Точная атака",
      formula: "@scale.fighter-rework-v028.dominance-die",
      consumption: {
        type: "itemUses",
        target: "fighter-dominance",
        value: "1"
      }
    }]
  });
  const actor = makeActor([dominance, preciseAttack]);
  const target = makeTarget({ ac: 18 });
  const workflow = makeWeaponWorkflow({ actor, target, attackTotal: 17 });
  let promptDetails = null;
  let rolledFormula = "";
  TestRoll.queuedTotals = [3];
  const service = new AttackRollBoostService({}, {
    rollFactory: (formula) => {
      rolledFormula = formula;
      if (String(formula).includes("@scale.")) {
        throw new Error("Unresolved scale formula reached Roll");
      }
      return new TestRoll(formula);
    },
    promptAttackRollBoosts: async (details) => {
      promptDetails = details;
      return ["fighter-precise-attack"];
    }
  });

  await service.applyMidiHitsChecked(workflow);

  assert.equal(promptDetails.options[0].maxTotal, 4);
  assert.equal(promptDetails.options[0].displayFormula, "1к4");
  assert.equal(rolledFormula, "1d4");
  assert.equal(workflow.attackTotal, 20);
  assert.equal(workflow.hitTargets.has(target), true);
  assert.equal(dominance.system.uses.spent, 1);
});

test("attack roll boosts do not prompt when available dice cannot reach any missed target AC", async () => {
  const actor = makeActor([makeItem({
    id: "boosts",
    name: "Boosts",
    boosts: [{ id: "small", label: "+1d3", formula: "1d3" }]
  })]);
  const target = makeTarget({ ac: 25 });
  const workflow = makeWeaponWorkflow({ actor, target, attackTotal: 18 });
  let promptCount = 0;
  const service = new AttackRollBoostService({}, {
    promptAttackRollBoosts: async () => {
      promptCount += 1;
      return ["small"];
    }
  });

  await service.applyMidiHitsChecked(workflow);

  assert.equal(promptCount, 0);
  assert.equal(workflow.hitTargets.size, 0);
  assert.equal(workflow.attackTotal, 18);
});

test("attack roll boost prompt uses DialogV2 input and checkbox options", async () => {
  const previousApplications = globalThis.foundry.applications;
  let dialogContent = "";
  globalThis.foundry.applications = {
    api: {
      DialogV2: {
        async input({ content, ok }) {
          dialogContent = content;
          const form = {
            querySelectorAll(selector) {
              if (selector === "[data-attack-roll-boost]:checked") {
                return [{ value: "large" }];
              }
              return [];
            }
          };
          return ok?.callback?.({}, { form }) ?? [];
        }
      }
    }
  };
  const service = new AttackRollBoostService({});

  try {
    const selected = await service.promptAttackRollBoosts({
      actor: { name: "Герой" },
      item: { name: "Длинный меч" },
      attackTotal: 18,
      needed: 6,
      target: { name: "Цель", ac: 24 },
      options: [
        { id: "small", label: "+1d3", formula: "1d3", sourceName: "Мелкая добавка" },
        { id: "large", label: "+1d12", formula: "@scale.fighter-rework-v028.dominance-die", displayFormula: "1к4", sourceName: "Большая добавка" }
      ]
    });

    assert.deepEqual(selected, ["large"]);
    assert.match(dialogContent, /type="checkbox"/u);
    assert.match(dialogContent, /data-attack-roll-boost/u);
    assert.match(dialogContent, /max-height:/u);
    assert.match(dialogContent, /overflow-y:\s*auto/u);
    assert.match(dialogContent, /1к4/u);
    assert.doesNotMatch(dialogContent, /@scale\.fighter-rework-v028\.dominance-die/u);
  }
  finally {
    globalThis.foundry.applications = previousApplications;
  }
});
