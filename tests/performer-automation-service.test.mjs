import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/constants.js";

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
globalThis.fromUuidSync ??= () => null;

const {
  PERFORMER_APPLY_RESULT_COMMAND,
  PerformerAutomationService
} = await import("../scripts/combat/performer-automation-service.js");

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

function makePerformerItem({ spent = 0, max = "2" } = {}) {
  return {
    id: "performer-item",
    uuid: "Actor.performer.Item.performer",
    img: "icons/svg/book.svg",
    name: "Исполнитель",
    system: {
      uses: {
        spent,
        max,
        recovery: [{ period: "lr", type: "recoverAll", formula: "" }]
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

function makeActorCollection(actors) {
  return {
    contents: actors,
    values: () => actors.values(),
    [Symbol.iterator]: function* iterator() {
      yield* actors;
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

function makeD20BonusEffect({ formula = "1d4", mode = "add", label = "Р”РѕР±СЂРѕСЃ" } = {}) {
  return {
    id: "generic-effect-id",
    uuid: "Actor.target.ActiveEffect.generic-effect-id",
    name: label,
    disabled: false,
    transfer: false,
    flags: {
      "rebreya-main": {
        d20Bonus: {
          formula,
          mode,
          label
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

test("initialize migrates owned performer activity to automated utility activity", async () => {
  const previousActors = globalThis.game.actors;
  const previousIsGM = globalThis.game.user.isGM;
  const actor = new TestActor({ id: "performer" });
  const item = makePerformerItem();
  item.type = "feat";
  item.name = "Исполнитель";
  item.system.identifier = "ispolnitel";
  item.system.activities = {
    bd37d8496d0f0415: {
      _id: "bd37d8496d0f0415",
      type: "utility",
      img: "systems/dnd5e/icons/svg/activity/utility.svg",
      flags: {
        "rebreya-main": {
          runtime: {
            action: "activePerformance"
          }
        }
      }
    }
  };
  actor.items = makeActorCollection([item]);
  globalThis.game.user.isGM = true;
  globalThis.game.actors = makeActorCollection([actor]);

  try {
    await new PerformerAutomationService({}).initialize();

    const activity = item.system.activities.bd37d8496d0f0415;
    assert.equal(activity.type, "utility");
    assert.equal(activity.img, "systems/dnd5e/icons/svg/activity/utility.svg");
    assert.equal(activity.check, undefined);
    assert.equal(item.system.uses.max, "2");
    assert.equal(item.updates.length, 1);
  }
  finally {
    globalThis.game.actors = previousActors;
    globalThis.game.user.isGM = previousIsGM;
  }
});

test("initialize recognizes an older managed Performer feat without a system identifier", async () => {
  const previousActors = globalThis.game.actors;
  const previousIsGM = globalThis.game.user.isGM;
  const actor = new TestActor({ id: "legacy-performer" });
  const item = makePerformerItem();
  item.type = "feat";
  item.system.identifier = "";
  item.flags = {
    [MODULE_ID]: {
      managed: true,
      featId: "ispolnitel"
    }
  };
  item.getFlag = function getFlag(scope, key) {
    return foundry.utils.getProperty(this, `flags.${scope}.${key}`);
  };
  item.system.activities = {
    bd37d8496d0f0415: {
      _id: "bd37d8496d0f0415",
      type: "check",
      flags: {
        [MODULE_ID]: {
          runtime: {
            action: "activePerformance"
          }
        }
      }
    }
  };
  actor.items = makeActorCollection([item]);
  globalThis.game.user.isGM = true;
  globalThis.game.actors = makeActorCollection([actor]);

  try {
    await new PerformerAutomationService({}).initialize();

    assert.equal(item.system.activities.bd37d8496d0f0415.type, "utility");
    assert.equal(item.updates.length, 1);
  }
  finally {
    globalThis.game.actors = previousActors;
    globalThis.game.user.isGM = previousIsGM;
  }
});

test("active performance success applies a d5 die to the selected ally and clears failure streak", async () => {
  const previousTargets = globalThis.game.user.targets;
  const performerItem = makePerformerItem({ spent: 1 });
  const performer = new TestActor({
    id: "performer",
    disposition: 1,
    rollTotal: 24
  });
  const target = new TestActor({ id: "ally", disposition: 1 });
  globalThis.game.user.targets = new Set([target.token]);
  const service = new PerformerAutomationService({});

  try {
    await service.applyDnd5ePostUseActivity(makeActivity(performer, performerItem), {}, {});

    assert.equal(performer.rolls.length, 1);
    assert.deepEqual(performer.rolls[0].config, {
      ability: "cha",
      skill: "prf",
      target: 20,
      hookNames: ["activePerformance"]
    });
    assert.equal(target.created[0].type, "ActiveEffect");
    const effect = target.created[0].documents[0];
    assert.equal(effect.duration.seconds, 60);
    assert.equal(effect.flags["rebreya-main"].performerAutomation.formula, "1d5");
    assert.equal(effect.flags["rebreya-main"].performerAutomation.mode, "add");
    assert.equal(performerItem.system.uses.spent, 0);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("player performer routes an unowned target effect through the active GM", async () => {
  const previousTargets = globalThis.game.user.targets;
  const previousIsGm = globalThis.game.user.isGM;
  const performerItem = makePerformerItem({ spent: 1 });
  const performer = new TestActor({ id: "performer", disposition: 1, rollTotal: 24 });
  const target = new TestActor({ id: "ally", disposition: 1 });
  target.isOwner = false;
  const requests = [];
  const service = new PerformerAutomationService({
    socketCommandBus: {
      async request(command, payload) {
        requests.push({ command, payload });
        return { applied: true };
      }
    }
  });
  globalThis.game.user.isGM = false;
  globalThis.game.user.targets = new Set([target.token]);

  try {
    await service.applyDnd5ePostUseActivity(makeActivity(performer, performerItem), {}, {});

    assert.deepEqual(requests, [{
      command: PERFORMER_APPLY_RESULT_COMMAND,
      payload: {
        sourceActorId: performer.id,
        sourceItemId: performerItem.id,
        targetActorId: target.id,
        targetTokenUuid: target.token.document.uuid,
        total: 24
      }
    }]);
    assert.equal(target.created.length, 0);
    assert.equal(performerItem.system.uses.spent, 1);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
    globalThis.game.user.isGM = previousIsGm;
  }
});

test("active performance GM commit clears performer failure uses on success", async () => {
  const previousActors = globalThis.game.actors;
  const performerItem = makePerformerItem({ spent: 1 });
  performerItem.system.identifier = "ispolnitel";
  const performer = new TestActor({ id: "performer", disposition: 1 });
  const target = new TestActor({ id: "ally", disposition: 1 });
  performer.items = makeActorCollection([performerItem]);
  performerItem.system.activities = {
    activePerformance: makeActivity(performer, performerItem)
  };
  globalThis.game.actors = makeActorCollection([performer, target]);
  const service = new PerformerAutomationService({});

  try {
    const result = await service.commitActivePerformance({
      sourceActorId: performer.id,
      sourceItemId: performerItem.id,
      targetActorId: target.id,
      total: 24
    });

    assert.equal(result.success, true);
    assert.equal(performerItem.system.uses.spent, 0);
    assert.equal(target.created[0].type, "ActiveEffect");
  }
  finally {
    globalThis.game.actors = previousActors;
  }
});

test("active performance can resolve the target from the dnd5e usage message", async () => {
  const previousTargets = globalThis.game.user.targets;
  const previousFromUuidSync = globalThis.fromUuidSync;
  const performerItem = makePerformerItem({ spent: 0 });
  const performer = new TestActor({ id: "performer", disposition: 1, rollTotal: 23 });
  const target = new TestActor({ id: "ally", disposition: 1 });
  globalThis.game.user.targets = new Set();
  globalThis.fromUuidSync = (uuid) => uuid === target.token.document.uuid ? target.token : null;
  const service = new PerformerAutomationService({});

  try {
    await service.applyDnd5ePostUseActivity(makeActivity(performer, performerItem), {}, {
      message: {
        flags: {
          dnd5e: {
            use: {
              targets: [{ uuid: target.token.document.uuid, name: target.name }]
            }
          }
        }
      }
    });

    assert.equal(performer.rolls.length, 1);
    assert.equal(target.created[0].type, "ActiveEffect");
  }
  finally {
    globalThis.game.user.targets = previousTargets;
    globalThis.fromUuidSync = previousFromUuidSync;
  }
});

test("second consecutive active performance failure spends the second use and blocks the feature", async () => {
  const previousTargets = globalThis.game.user.targets;
  const performerItem = makePerformerItem({ spent: 1 });
  const performer = new TestActor({
    id: "performer",
    disposition: 1,
    rollTotal: 14
  });
  const target = new TestActor({ id: "enemy", disposition: -1 });
  globalThis.game.user.targets = new Set([target.token]);
  const service = new PerformerAutomationService({});

  try {
    await service.applyDnd5ePostUseActivity(makeActivity(performer, performerItem), {}, {});

    const effect = target.created[0].documents[0];
    assert.equal(effect.flags["rebreya-main"].performerAutomation.formula, "1d3");
    assert.equal(effect.flags["rebreya-main"].performerAutomation.mode, "subtract");
    assert.equal(performerItem.system.uses.spent, 2);
    assert.equal(service.applyDnd5ePreUseActivity(makeActivity(performer, performerItem), {}, {}, {}), false);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("active performance still applies its die when dnd5e has already spent the last failure use before post-use", async () => {
  const previousTargets = globalThis.game.user.targets;
  const performerItem = makePerformerItem({ spent: 2 });
  const performer = new TestActor({
    id: "performer",
    disposition: 1,
    rollTotal: 14
  });
  const target = new TestActor({ id: "ally", disposition: 1 });
  globalThis.game.user.targets = new Set([target.token]);
  const service = new PerformerAutomationService({});

  try {
    await service.applyDnd5ePostUseActivity(makeActivity(performer, performerItem), {}, {});

    const effect = target.created[0].documents[0];
    assert.equal(effect.flags["rebreya-main"].d20Bonus.formula, "1d3");
    assert.equal(effect.flags["rebreya-main"].d20Bonus.mode, "add");
    assert.equal(effect.flags["rebreya-main"].d20Bonus.label, "Активное выступление");
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("allied performer die is not spent when the holder declines the d20 bonus", async () => {
  const effect = makePerformerEffect({ formula: "1d5", mode: "add" });
  const actor = new TestActor({ id: "target", effects: [effect] });
  const service = new PerformerAutomationService({}, {
    promptD20Bonus: async () => false
  });
  const roll = {
    total: 12,
    options: {}
  };

  await service.applyDnd5eD20Roll([roll], { subject: actor }, "skill");

  assert.equal(roll.total, 12);
  assert.equal(effect.deleted, false);
});

test("generic d20 bonus active effect can be added voluntarily and then expires", async () => {
  const effect = makeD20BonusEffect({ formula: "1d4", mode: "add", label: "РџСЂРѕР±РЅС‹Р№ РґРѕР±СЂРѕСЃ" });
  const actor = new TestActor({ id: "target", effects: [effect] });
  const service = new PerformerAutomationService({}, {
    promptD20Bonus: async (details) => {
      assert.equal(details.label, "РџСЂРѕР±РЅС‹Р№ РґРѕР±СЂРѕСЃ");
      assert.equal(details.displayFormula, "1к4");
      return true;
    },
    rollFactory: () => ({
      total: 3,
      formula: "1d4",
      async evaluate() {
        return this;
      },
      async toMessage() {
        return {};
      }
    })
  });
  const roll = {
    total: 10,
    options: {}
  };

  await service.applyDnd5eD20Roll([roll], { subject: actor }, "save");

  assert.equal(roll.total, 13);
  assert.equal(effect.deleted, true);
});

test("allied performer die can be voluntarily added to a skill d20 test and then expires", async () => {
  const effect = makePerformerEffect({ formula: "1d5", mode: "add" });
  const actor = new TestActor({ id: "target", effects: [effect] });
  const service = new PerformerAutomationService({}, {
    promptD20Bonus: async (details) => {
      assert.equal(details.kind, "skill");
      assert.equal(details.displayFormula, "1к5");
      return true;
    },
    rollFactory: () => ({
      total: 4,
      formula: "1d5",
      async evaluate() {
        return this;
      },
      async toMessage() {
        return {};
      }
    })
  });
  const roll = {
    total: 12,
    options: {}
  };

  await service.applyDnd5eD20Roll([roll], { subject: actor }, "skill");

  assert.equal(roll.total, 16);
  assert.equal(effect.deleted, true);
});

test("allied performer die waits for the attack roll boost dialog on attack d20 tests", async () => {
  const effect = makePerformerEffect({ formula: "1d3", mode: "add" });
  const actor = new TestActor({ id: "target", effects: [effect] });
  let promptCount = 0;
  const service = new PerformerAutomationService({}, {
    promptD20Bonus: async () => {
      promptCount += 1;
      return true;
    }
  });
  const roll = {
    total: 24,
    options: {}
  };

  await service.applyDnd5eD20Roll([roll], { subject: actor }, "attack");

  assert.equal(promptCount, 0);
  assert.equal(roll.total, 24);
  assert.equal(effect.deleted, false);
});

test("hostile performer die is subtracted from a saving throw d20 test and then expires", async () => {
  const effect = makePerformerEffect({ formula: "1d3", mode: "subtract" });
  const actor = new TestActor({ id: "target", effects: [effect] });
  const service = new PerformerAutomationService({}, {
    rollFactory: () => ({
      total: 2,
      formula: "1d3",
      async evaluate() {
        return this;
      },
      async toMessage() {
        return {};
      }
    })
  });
  const roll = {
    total: 14,
    options: {}
  };

  await service.applyDnd5eD20Roll([roll], { subject: actor }, "save");

  assert.equal(roll.total, 12);
  assert.equal(effect.deleted, true);
});

test("performer die is no longer injected into d20 tests before the holder chooses to use it", () => {
  const effect = makePerformerEffect({ formula: "1d5", mode: "add" });
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
  assert.deepEqual(config.rolls[0].parts, []);
  assert.equal(config.rolls[0].options.rebreyaPerformerEffectUuid, undefined);
  assert.doesNotMatch(message.data.flavor, /Активное выступление/u);
});

test("active performance cannot start when both failure uses are spent", () => {
  const performer = new TestActor({ id: "performer" });
  const performerItem = makePerformerItem({ spent: 2 });
  const service = new PerformerAutomationService({});

  assert.equal(service.applyDnd5ePreUseActivity(makeActivity(performer, performerItem), {}, {}, {}), false);
});
