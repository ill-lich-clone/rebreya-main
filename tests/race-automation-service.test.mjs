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
