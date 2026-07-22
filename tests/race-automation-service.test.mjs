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

const { RaceAutomationService } = await import("../scripts/combat/race-automation-service.js");

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
