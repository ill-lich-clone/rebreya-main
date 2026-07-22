import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {
  applications: {
    api: {
      DialogV2: {
        confirm: async () => false
      }
    }
  },
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
    isGM: true,
    targets: new Set()
  },
  combat: null,
  socket: null
};

const {
  RaceAutomationService,
  buildGiantTribeConfiguration
} = await import("../scripts/combat/race-automation-service.js");

class TestActor extends Actor {
  constructor({ id, name = id, size = "sm", disposition = 1, items = [] } = {}) {
    super();
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.name = name;
    this.type = "character";
    this.isOwner = true;
    this.system = {
      attributes: {
        prof: 2,
        hp: {
          value: 10,
          max: 20,
          temp: 0
        }
      },
      traits: {
        size
      }
    };
    this.damageApplications = [];
    this.items = {
      contents: items,
      [Symbol.iterator]: function* iterator() {
        yield* items;
      }
    };
    this.token = makeToken(this, disposition);

    for (const item of items) {
      item.actor = this;
      item.parent = this;
    }
  }

  getActiveTokens() {
    return [this.token];
  }

  getRollData() {
    return {
      attributes: this.system.attributes,
      traits: this.system.traits
    };
  }

  async applyDamage(damages, options) {
    this.damageApplications.push({ damages, options });
    return true;
  }
}

function makeToken(actor, disposition = 1) {
  return {
    id: `${actor.id}-token`,
    actor,
    document: {
      id: `${actor.id}-token-document`,
      actor,
      disposition
    },
    disposition
  };
}

function makeFuryFeature() {
  return {
    id: "fury-small",
    uuid: "Item.fury-small",
    name: "Fury Small",
    type: "feat",
    system: {
      uses: {
        spent: 0,
        max: "@prof"
      }
    },
    flags: {
      "rebreya-main": {
        automation: {
          mechanics: ["fury-small"]
        }
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(patch) {
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
}

function makeOwnedRace({ allowed = ["int", "cha"], amount = 2, selected = null, effects = [] } = {}) {
  const updateCalls = [];
  const item = new class extends Item {
    constructor() {
      super();
      this.id = "race-item";
      this.uuid = "Actor.actor-race.Item.race-item";
      this.name = "Кентавры";
      this.type = "race";
      this.pack = null;
      this.flags = {
        "rebreya-main": {
          abilityPenaltyChoice: { allowed: [...allowed], amount },
          ...(selected ? { abilityPenalty: structuredClone(selected) } : {})
        }
      };
      this.effects = {
        contents: effects,
        [Symbol.iterator]: function* iterator() {
          yield* effects;
        }
      };
    }

    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }

    async update(patch, options = {}) {
      updateCalls.push({ patch: structuredClone(patch), options: structuredClone(options) });
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(this, path, structuredClone(value));
      }
      return this;
    }

    async createEmbeddedDocuments(documentName, entries) {
      assert.equal(documentName, "ActiveEffect");
      const created = entries.map((entry, index) => ({
        ...structuredClone(entry),
        id: `race-effect-${this.effects.contents.length + index + 1}`
      }));
      this.effects.contents.push(...created);
      return created;
    }

    async updateEmbeddedDocuments(documentName, entries) {
      assert.equal(documentName, "ActiveEffect");
      for (const entry of entries) {
        const effect = this.effects.contents.find((candidate) => candidate.id === entry._id);
        Object.assign(effect, structuredClone(entry));
      }
      return entries;
    }

    async deleteEmbeddedDocuments(documentName, ids) {
      assert.equal(documentName, "ActiveEffect");
      this.effects.contents = this.effects.contents.filter((effect) => !ids.includes(effect.id));
      return ids;
    }
  }();
  item.updateCalls = updateCalls;
  return item;
}

function makeGiantTribeFeature({
  selected = null,
  effects = [],
  activities = {},
  legacyMechanics = false
} = {}) {
  const updateCalls = [];
  const item = new class extends Item {
    constructor() {
      super();
      this.id = "giant-tribe-item";
      this.uuid = "Actor.half-giant.Item.giant-tribe-item";
      this.name = "Великанье племя";
      this.type = "feat";
      this.pack = null;
      this.flags = {
        "rebreya-main": {
          sourceType: "raceFeature",
          raceId: "полувеликаны",
          abilityId: "полувеликаны-ability-3",
          automation: {
            mechanics: legacyMechanics
              ? ["choice-table", "damage-traits", "proficiencies", "damage-activity", "interactive-runtime"]
              : ["giant-tribe-choice", "interactive-runtime"]
          },
          ...(selected ? { raceAutomation: { giantTribe: selected } } : {})
        }
      };
      this.system = {
        identifier: "poluvelikany-velikane-plemya",
        activities: structuredClone(activities)
      };
      this.effects = {
        contents: structuredClone(effects),
        get(id) {
          return this.contents.find((effect) => effect.id === id || effect._id === id);
        },
        [Symbol.iterator]: function* iterator() {
          yield* this.contents;
        }
      };
    }

    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }

    async update(patch, options = {}) {
      updateCalls.push({ patch: structuredClone(patch), options: structuredClone(options) });
      for (const [path, value] of Object.entries(patch)) {
        if (path === "system.activities") {
          Object.assign(this.system.activities, structuredClone(value));
          continue;
        }
        if (path.startsWith("system.activities.-=")) {
          delete this.system.activities[path.slice("system.activities.-=".length)];
          continue;
        }
        if (path.startsWith("system.activities.")) {
          this.system.activities[path.slice("system.activities.".length)] = structuredClone(value);
          continue;
        }
        foundry.utils.setProperty(this, path, structuredClone(value));
      }
      return this;
    }

    async createEmbeddedDocuments(documentName, entries) {
      assert.equal(documentName, "ActiveEffect");
      const created = entries.map((entry, index) => ({
        ...structuredClone(entry),
        id: `giant-effect-${this.effects.contents.length + index + 1}`
      }));
      this.effects.contents.push(...created);
      return created;
    }

    async deleteEmbeddedDocuments(documentName, ids) {
      assert.equal(documentName, "ActiveEffect");
      this.effects.contents = this.effects.contents.filter((effect) => !ids.includes(effect.id ?? effect._id));
      return ids;
    }
  }();
  item.updateCalls = updateCalls;
  return item;
}

function activitiesOf(item) {
  return Object.values(item.system.activities ?? {});
}

function workflow({ source, target, activityType = "attack", actionType = "mwak", damageType = "slashing" } = {}) {
  return {
    actor: source,
    item: {
      type: activityType === "heal" ? "spell" : "weapon",
      system: {
        actionType
      }
    },
    activity: {
      type: activityType,
      actionType
    },
    hitTargets: new Set([target.token]),
    damageDetail: damageType ? [{ type: damageType }] : []
  };
}

function setConfirmHandler(handler) {
  foundry.applications.api.DialogV2.confirm = handler;
}

test("fury-small ignores healing workflows against a larger hostile target", async () => {
  const source = new TestActor({ id: "source", size: "sm", disposition: 1, items: [makeFuryFeature()] });
  const target = new TestActor({ id: "target", size: "med", disposition: -1 });
  let prompts = 0;
  setConfirmHandler(async () => {
    prompts += 1;
    return false;
  });

  const service = new RaceAutomationService({});
  await service.applyMidiRollComplete(workflow({
    source,
    target,
    activityType: "heal",
    actionType: "heal",
    damageType: "healing"
  }));

  assert.equal(prompts, 0);
  assert.equal(target.damageApplications.length, 0);
});

test("fury-small ignores larger ally targets", async () => {
  const source = new TestActor({ id: "source", size: "sm", disposition: 1, items: [makeFuryFeature()] });
  const target = new TestActor({ id: "target", size: "med", disposition: 1 });
  let prompts = 0;
  setConfirmHandler(async () => {
    prompts += 1;
    return false;
  });

  const service = new RaceAutomationService({});
  await service.applyMidiRollComplete(workflow({ source, target }));

  assert.equal(prompts, 0);
  assert.equal(target.damageApplications.length, 0);
});

test("fury-small still prompts for a larger hostile damage target", async () => {
  const source = new TestActor({ id: "source", size: "sm", disposition: 1, items: [makeFuryFeature()] });
  const target = new TestActor({ id: "target", size: "med", disposition: -1 });
  let prompts = 0;
  setConfirmHandler(async () => {
    prompts += 1;
    return false;
  });

  const service = new RaceAutomationService({});
  await service.applyMidiRollComplete(workflow({ source, target }));

  assert.equal(prompts, 1);
  assert.equal(target.damageApplications.length, 0);
});

test("an owned race stores and transfers only the selected ability penalty", async () => {
  const race = makeOwnedRace();
  const actor = new TestActor({ id: "actor-race", items: [race] });
  const service = new RaceAutomationService({}, { promptChoice: async () => "cha" });

  assert.equal(await service.handleCreatedItem(race, {}, game.user.id), true);

  assert.deepEqual(race.flags["rebreya-main"].abilityPenalty, { ability: "cha", amount: 2 });
  assert.equal(race.effects.contents.length, 1);
  assert.deepEqual(race.effects.contents[0].changes, [{
    key: "system.abilities.cha.value",
    mode: 2,
    value: "-2",
    priority: 20
  }]);
  assert.equal(race.effects.contents[0].transfer, true);
  assert.equal(race.effects.contents[0].flags["rebreya-main"].raceAbilityPenalty.managed, true);
  assert.equal(actor.effects, undefined, "penalty must stay on the removable race Item");
});

test("race penalty creation ignores hooks emitted for another user", async () => {
  const race = makeOwnedRace();
  new TestActor({ id: "actor-race", items: [race] });
  let prompts = 0;
  const service = new RaceAutomationService({}, {
    promptChoice: async () => {
      prompts += 1;
      return "cha";
    }
  });

  assert.equal(await service.handleCreatedItem(race, {}, "another-user"), false);
  assert.equal(prompts, 0);
  assert.equal(race.effects.contents.length, 0);
});

test("cancelled race penalty remains unresolved and actor repair prompts again", async () => {
  const race = makeOwnedRace();
  const actor = new TestActor({ id: "actor-race", items: [race] });
  const answers = [null, "int"];
  const service = new RaceAutomationService({}, { promptChoice: async () => answers.shift() });

  assert.equal(await service.handleCreatedItem(race, {}, game.user.id), false);
  assert.equal(race.flags["rebreya-main"].abilityPenalty, undefined);
  assert.equal(race.effects.contents.length, 0);

  assert.equal(await service.repairActor(actor), true);
  assert.deepEqual(race.flags["rebreya-main"].abilityPenalty, { ability: "int", amount: 2 });
  assert.equal(race.effects.contents.length, 1);
});

test("actor repair replaces an invalid saved penalty and removes duplicate managed effects", async () => {
  const legacyEffect = {
    id: "legacy-one",
    name: "Расовый штраф",
    transfer: true,
    changes: [{ key: "system.abilities.str.value", mode: 2, value: "-2", priority: 20 }],
    flags: { "rebreya-main": { raceAbilityPenalty: { managed: true, ability: "str", amount: 2 } } }
  };
  const duplicate = structuredClone(legacyEffect);
  duplicate.id = "legacy-two";
  const race = makeOwnedRace({
    selected: { ability: "str", amount: 2 },
    effects: [legacyEffect, duplicate]
  });
  const actor = new TestActor({ id: "actor-race", items: [race] });
  const service = new RaceAutomationService({}, { promptChoice: async () => "cha" });

  assert.equal(await service.repairActor(actor), true);
  assert.deepEqual(race.flags["rebreya-main"].abilityPenalty, { ability: "cha", amount: 2 });
  assert.equal(race.effects.contents.length, 1);
  assert.equal(race.effects.contents[0].changes[0].key, "system.abilities.cha.value");
});

test("giant tribe configurations expose only the selected passive benefit", () => {
  const expectedChanges = {
    hill: [["system.skills.sur.roll.mode", 2, "1"]],
    stone: [],
    frost: [["system.traits.dr.value", 2, "cold"]],
    fire: [["system.tools.smith.value", 4, "1"]],
    cloud: [
      ["system.skills.dec.bonuses.check", 2, "2"],
      ["system.skills.per.bonuses.check", 2, "2"]
    ],
    storm: []
  };

  for (const [tribe, changes] of Object.entries(expectedChanges)) {
    const configuration = buildGiantTribeConfiguration(tribe);
    assert.equal(configuration.tribe, tribe);
    assert.deepEqual(
      configuration.effects.flatMap((effect) => effect.changes)
        .map((change) => [change.key, change.mode, change.value]),
      changes,
      tribe
    );
    assert.equal(configuration.effects.every((effect) => effect.transfer === true), true, tribe);
    assert.equal(configuration.activities.some((activity) => activity.flags["rebreya-main"].runtime?.action === "chooseGiantTribe"), true);
    assert.equal(configuration.activities.filter((activity) => activity.type === "damage").length, tribe === "storm" ? 1 : 0);
  }
});

test("adding Giant Tribe configures the same feature as Frost Giant", async () => {
  const feature = makeGiantTribeFeature();
  const actor = new TestActor({ id: "half-giant", items: [feature] });
  const service = new RaceAutomationService({}, { promptChoice: async () => "frost" });

  assert.equal(await service.handleCreatedItem(feature, {}, game.user.id), true);
  assert.equal(feature.id, "giant-tribe-item");
  assert.equal(feature.flags["rebreya-main"].raceAutomation.giantTribe, "frost");
  assert.equal(feature.name, "Великанье племя (Ледяной великан)");
  assert.equal(feature.effects.contents.length, 1);
  assert.deepEqual(feature.effects.contents[0].changes, [{
    key: "system.traits.dr.value",
    mode: 2,
    value: "cold",
    priority: 20
  }]);
  assert.equal(feature.effects.contents[0].transfer, true);
  assert.equal(activitiesOf(feature).length, 1);
  assert.equal(activitiesOf(feature)[0].flags["rebreya-main"].runtime.action, "chooseGiantTribe");
  assert.equal(actor.items.contents.length, 1);
});

test("Storm Giant receives a targeted touch damage button without passive effects", async () => {
  const feature = makeGiantTribeFeature();
  new TestActor({ id: "half-giant", items: [feature] });
  const service = new RaceAutomationService({}, { promptChoice: async () => "storm" });

  assert.equal(await service.handleCreatedItem(feature, {}, game.user.id), true);
  assert.equal(feature.effects.contents.length, 0);
  const damage = activitiesOf(feature).find((activity) => activity.type === "damage");
  assert.ok(damage);
  assert.equal(damage.range.units, "touch");
  assert.equal(damage.target.affects.type, "creature");
  assert.equal(damage.target.affects.count, "1");
  assert.equal(damage.target.prompt, true);
  assert.deepEqual(damage.damage.parts[0].types, ["lightning"]);
  assert.equal(damage.damage.parts[0].custom.formula, "1d4");
  assert.deepEqual(damage.flags["rebreya-main"].giantTribe, { managed: true, tribe: "storm" });
});

test("using the tribe choice activity replaces Storm with Cloud on the same feature", async () => {
  const feature = makeGiantTribeFeature();
  const actor = new TestActor({ id: "half-giant", items: [feature] });
  const answers = ["storm", "cloud"];
  const service = new RaceAutomationService({}, { promptChoice: async () => answers.shift() });
  await service.handleCreatedItem(feature, {}, game.user.id);
  const choose = activitiesOf(feature).find((activity) => activity.flags["rebreya-main"].runtime?.action === "chooseGiantTribe");

  await service.applyDnd5ePostUseActivity({ ...choose, actor, item: feature }, {}, {});

  assert.equal(feature.flags["rebreya-main"].raceAutomation.giantTribe, "cloud");
  assert.equal(feature.effects.contents.length, 2);
  assert.deepEqual(feature.effects.contents.map((effect) => effect.changes[0].key).sort(), [
    "system.skills.dec.bonuses.check",
    "system.skills.per.bonuses.check"
  ]);
  assert.equal(activitiesOf(feature).filter((activity) => activity.type === "damage").length, 0);
  assert.equal(activitiesOf(feature).length, 1);
});

test("repairing a legacy Giant Tribe removes dormant effects and old activities", async () => {
  const legacyEffects = ["cold", "smith", "dec", "per"].map((key, index) => ({
    id: `legacy-${index}`,
    name: key,
    transfer: false,
    changes: [],
    flags: { "rebreya-main": { automation: "race-feature-effect" } }
  }));
  const feature = makeGiantTribeFeature({
    effects: legacyEffects,
    legacyMechanics: true,
    activities: {
      customActivity: {
        _id: "customActivity",
        type: "utility",
        name: "Пользовательская активность",
        flags: {}
      },
      legacyStorm: {
        _id: "legacyStorm",
        type: "damage",
        name: "Штормовой великан: касание",
        flags: { "rebreya-main": { automation: "race-feature-activity", runtime: null } }
      },
      legacyPrompt: {
        _id: "legacyPrompt",
        type: "utility",
        name: "Применить остаток механики",
        flags: { "rebreya-main": { automation: "race-feature-activity", runtime: { action: "promptCustomEffect" } } }
      }
    }
  });
  const actor = new TestActor({ id: "half-giant", items: [feature] });
  const service = new RaceAutomationService({}, { promptChoice: async () => "hill" });

  assert.equal(await service.repairActor(actor), true);
  assert.equal(feature.effects.contents.length, 1);
  assert.equal(feature.effects.contents[0].changes[0].key, "system.skills.sur.roll.mode");
  assert.equal(feature.effects.contents.some((effect) => effect.flags["rebreya-main"].automation === "race-feature-effect"), false);
  assert.equal(activitiesOf(feature).length, 2);
  assert.equal(activitiesOf(feature).some((activity) => activity.name === "Пользовательская активность"), true);
  assert.equal(activitiesOf(feature).some((activity) => activity.flags["rebreya-main"]?.runtime?.action === "chooseGiantTribe"), true);
});

test("repair leaves an already valid Giant Tribe configuration unchanged", async () => {
  const feature = makeGiantTribeFeature();
  const actor = new TestActor({ id: "half-giant", items: [feature] });
  let prompts = 0;
  const service = new RaceAutomationService({}, {
    promptChoice: async () => {
      prompts += 1;
      return "frost";
    }
  });
  await service.handleCreatedItem(feature, {}, game.user.id);
  const updatesAfterConfiguration = feature.updateCalls.length;

  assert.equal(await service.repairActor(actor), false);
  assert.equal(prompts, 1);
  assert.equal(feature.updateCalls.length, updatesAfterConfiguration);
});

test("cancelled Giant Tribe choice stays unresolved and repair asks again", async () => {
  const feature = makeGiantTribeFeature();
  const actor = new TestActor({ id: "half-giant", items: [feature] });
  const answers = [null, "fire"];
  const service = new RaceAutomationService({}, { promptChoice: async () => answers.shift() });

  assert.equal(await service.handleCreatedItem(feature, {}, game.user.id), false);
  assert.equal(feature.flags["rebreya-main"].raceAutomation, undefined);
  assert.equal(await service.repairActor(actor), true);
  assert.equal(feature.flags["rebreya-main"].raceAutomation.giantTribe, "fire");
  assert.equal(feature.effects.contents[0].changes[0].key, "system.tools.smith.value");
});
