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
globalThis.ChatMessage ??= {
  create: async (data) => data,
  getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? "", alias: actor?.name ?? "" })
};
globalThis.game ??= {
  user: {
    id: "user",
    isGM: true,
    targets: new Set()
  },
  time: {
    worldTime: 100
  }
};
globalThis.ui ??= {
  notifications: {
    warn: () => {},
    info: () => {}
  }
};

const { PerformerAutomationService } = await import("../scripts/combat/performer-automation-service.js");

class TestActor extends Actor {
  constructor({ id, name = id, disposition = 1, flags = {}, effects = [], rollTotal = 20 } = {}) {
    super();
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.name = name;
    this.isOwner = true;
    this.flags = foundry.utils.deepClone(flags);
    this.rollTotal = rollTotal;
    this.rolls = [];
    this.updates = [];
    this.created = [];
    this.token = makeToken(this, disposition);
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
  }

  getActiveTokens() {
    return [this.token];
  }

  getRollData() {
    return {};
  }

  getFlag(scope, key) {
    return foundry.utils.getProperty(this, `flags.${scope}.${key}`);
  }

  async setFlag(scope, key, value) {
    foundry.utils.setProperty(this, `flags.${scope}.${key}`, value);
    this.updates.push({ [`flags.${scope}.${key}`]: value });
    return this;
  }

  async unsetFlag(scope, key) {
    foundry.utils.setProperty(this, `flags.${scope}.${key}`, undefined);
    this.updates.push({ [`flags.${scope}.${key}`]: undefined });
    return this;
  }

  async update(patch) {
    this.updates.push(patch);
    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(this, path, value);
    }
    return this;
  }

  async createEmbeddedDocuments(type, documents) {
    this.created.push({ type, documents });
    return documents;
  }

  async rollSkill(config = {}, dialog = {}, message = {}) {
    const roll = {
      total: this.rollTotal,
      options: {},
      formula: "1d20 + 5"
    };
    this.rolls.push({ config, dialog, message, roll });
    return [roll];
  }
}

function makeToken(actor, disposition = 1) {
  return {
    id: `${actor.id}-token`,
    name: actor.name,
    actor,
    document: {
      uuid: `Scene.scene.Token.${actor.id}`,
      id: `${actor.id}-token-document`,
      actor,
      disposition
    },
    disposition
  };
}

function makeActivity(actor, item = {}) {
  return {
    id: "active-performance",
    name: "Активное выступление",
    actor,
    item: {
      uuid: "Actor.performer.Item.performer",
      img: "icons/svg/book.svg",
      ...item,
      actor
    },
    flags: {
      "rebreya-main": {
        runtime: {
          action: "activePerformance",
          dc: 20,
          successFormula: "1d5",
          failureFormula: "1d3",
          durationSeconds: 60
        }
      }
    },
    getFlag(scope, key) {
      return foundry.utils.getProperty(this, `flags.${scope}.${key}`);
    }
  };
}

function makePerformerEffect({ formula = "1d3", mode = "add" } = {}) {
  return {
    id: "effect-id",
    uuid: "Actor.target.ActiveEffect.effect-id",
    name: "Активное выступление",
    disabled: false,
    transfer: false,
    flags: {
      "rebreya-main": {
        performerAutomation: {
          kind: "activePerformanceDie",
          formula,
          mode
        }
      }
    },
    deleted: false,
    async delete() {
      this.deleted = true;
      return this;
    }
  };
}

test("active performance success applies a d5 die to the selected ally and clears failure streak", async () => {
  const previousTargets = globalThis.game.user.targets;
  const performer = new TestActor({
    id: "performer",
    disposition: 1,
    rollTotal: 24,
    flags: {
      "rebreya-main": {
        performerAutomation: {
          activePerformance: {
            failures: 1
          }
        }
      }
    }
  });
  const target = new TestActor({ id: "ally", disposition: 1 });
  globalThis.game.user.targets = new Set([target.token]);
  const service = new PerformerAutomationService({});

  try {
    await service.applyDnd5ePostUseActivity(makeActivity(performer), {}, {});

    assert.equal(performer.rolls[0].config.skill, "prf");
    assert.equal(performer.rolls[0].config.ability, "cha");
    assert.equal(performer.rolls[0].config.target, 20);
    assert.equal(target.created[0].type, "ActiveEffect");
    const effect = target.created[0].documents[0];
    assert.equal(effect.duration.seconds, 60);
    assert.equal(effect.flags["rebreya-main"].performerAutomation.formula, "1d5");
    assert.equal(effect.flags["rebreya-main"].performerAutomation.mode, "add");
    assert.equal(performer.getFlag("rebreya-main", "performerAutomation.activePerformance.failures"), 0);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("second consecutive active performance failure gives a hostile d3 penalty and blocks the feature", async () => {
  const previousTargets = globalThis.game.user.targets;
  const performer = new TestActor({
    id: "performer",
    disposition: 1,
    rollTotal: 14,
    flags: {
      "rebreya-main": {
        performerAutomation: {
          activePerformance: {
            failures: 1
          }
        }
      }
    }
  });
  const target = new TestActor({ id: "enemy", disposition: -1 });
  globalThis.game.user.targets = new Set([target.token]);
  const service = new PerformerAutomationService({});

  try {
    await service.applyDnd5ePostUseActivity(makeActivity(performer), {}, {});

    const effect = target.created[0].documents[0];
    assert.equal(effect.flags["rebreya-main"].performerAutomation.formula, "1d3");
    assert.equal(effect.flags["rebreya-main"].performerAutomation.mode, "subtract");
    assert.equal(performer.getFlag("rebreya-main", "performerAutomation.activePerformance.failures"), 2);
    assert.equal(performer.getFlag("rebreya-main", "performerAutomation.activePerformance.blocked"), true);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("performer die is injected into the next d20 test and deleted after the roll", async () => {
  const effect = makePerformerEffect({ formula: "1d3", mode: "subtract" });
  const actor = new TestActor({ id: "target", effects: [effect] });
  const service = new PerformerAutomationService({});
  const config = {
    subject: actor,
    rolls: [{
      parts: [],
      data: {},
      options: {}
    }]
  };
  const message = {
    data: {
      flavor: "Спасбросок"
    }
  };

  service.applyDnd5ePreRollD20Test(config, {}, message);
  assert.deepEqual(config.rolls[0].parts, ["-1d3"]);
  assert.equal(config.rolls[0].options.rebreyaPerformerEffectUuid, effect.uuid);
  assert.match(message.data.flavor, /1к3/u);

  await service.applyDnd5eD20Roll([{ options: config.rolls[0].options }], { subject: actor }, "save");

  assert.equal(effect.deleted, true);
});

test("active performance cannot start while shame flag is active", () => {
  const performer = new TestActor({
    id: "performer",
    flags: {
      "rebreya-main": {
        performerAutomation: {
          activePerformance: {
            blocked: true
          }
        }
      }
    }
  });
  const service = new PerformerAutomationService({});

  assert.equal(service.applyDnd5ePreUseActivity(makeActivity(performer), {}, {}, {}), false);
});
