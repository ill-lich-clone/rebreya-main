import assert from "node:assert/strict";
import test from "node:test";

import {
  CombatStatusService,
  DECAYING_DAMAGE_OVERTIME_LABEL,
  buildDecayingDamageChange
} from "../scripts/combat/status-service.js";
import { registerCombatHooks } from "../scripts/combat/hooks.js";

const MODULE_ID = "rebreya-main";
const STATUS_ID = "rebreya-decaying-damage";

function applyPatch(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!key.includes(".")) {
      target[key] = value;
      continue;
    }

    key.split(".").reduce((current, part, index, parts) => {
      if (index === parts.length - 1) {
        current[part] = value;
        return current;
      }
      current[part] ??= {};
      return current[part];
    }, target);
  }
}

function installFoundryGlobals() {
  const previous = {
    Actor: globalThis.Actor,
    ActiveEffect: globalThis.ActiveEffect,
    CONFIG: globalThis.CONFIG,
    CONST: globalThis.CONST,
    foundry: globalThis.foundry,
    game: globalThis.game,
    Dialog: globalThis.Dialog,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement
  };

  class TestActor {}
  class TestActiveEffect {}
  globalThis.Actor = TestActor;
  globalThis.ActiveEffect = TestActiveEffect;
  globalThis.CONFIG = {
    statusEffects: [],
    DND5E: {
      damageTypes: {
        acid: { label: "Кислота" },
        fire: { label: "Огонь" },
        necrotic: { label: "Некротическая энергия" }
      }
    }
  };
  globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0 } };
  globalThis.foundry = {
    utils: {
      deepClone: (value) => structuredClone(value),
      escapeHTML: (value) => String(value ?? ""),
      getProperty: (source, path) => String(path ?? "").split(".").reduce((current, part) => current?.[part], source)
    }
  };
  const activeGm = { id: "gm-1", isGM: true, active: true };
  globalThis.game = {
    user: activeGm,
    users: { activeGM: activeGm }
  };

  return {
    TestActor,
    TestActiveEffect,
    restore() {
      Object.assign(globalThis, previous);
    }
  };
}

function makeEffect(TestActiveEffect, actor, { id = "decaying-effect", value = 10, step = 1, damageType = "fire" } = {}) {
  const effect = new TestActiveEffect();
  Object.assign(effect, {
    id,
    uuid: `Actor.actor-1.ActiveEffect.${id}`,
    name: `Затихающий урон ${value}(-${step})`,
    statuses: [STATUS_ID],
    flags: {
      core: { statusId: STATUS_ID },
      [MODULE_ID]: {
        statusId: STATUS_ID,
        statusValue: value,
        statusMeta: { version: 2, step, damageType }
      },
      statuscounter: { value, visible: true }
    },
    changes: [buildDecayingDamageChange(value, { step, damageType }, { effectId: id })],
    parent: actor,
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(patch) {
      applyPatch(this, patch);
      return this;
    },
    async delete() {
      actor.effects.contents = actor.effects.contents.filter((candidate) => candidate !== this);
    }
  });
  return effect;
}

test("decaying damage emits one typed Midi-QOL OverTime change for the current amount", () => {
  const globals = installFoundryGlobals();
  try {
    assert.deepEqual(buildDecayingDamageChange(10, { step: 1, damageType: "fire" }), {
      key: "flags.midi-qol.OverTime.rebreyaDecayingDamage",
      mode: 0,
      value: `turn=start,damageRoll=10,damageType=fire,fastForwardDamage=true,allowIncapacitated=true,label="${DECAYING_DAMAGE_OVERTIME_LABEL}"`,
      priority: 20
    });
    assert.throws(
      () => buildDecayingDamageChange(10, { step: 1, damageType: "" }),
      /тип урона/iu
    );
    assert.throws(
      () => buildDecayingDamageChange(10, { step: 1, damageType: "unknown" }),
      /неподдерживаемый тип урона/iu
    );
  }
  finally {
    globals.restore();
  }
});

test("completed Midi overtime damage reduces the status only after the workflow and never writes HP directly", async () => {
  const globals = installFoundryGlobals();
  try {
    const service = new CombatStatusService({});
    const actor = new globals.TestActor();
    actor.id = "actor-1";
    actor.uuid = "Actor.actor-1";
    actor.effects = { contents: [] };
    actor.updateCalls = [];
    actor.update = async (patch) => actor.updateCalls.push(patch);
    const effect = makeEffect(globals.TestActiveEffect, actor, { value: 10, step: 1, damageType: "fire" });
    actor.effects.contents = [effect];

    const workflow = {
      id: "workflow-1",
      workflowOptions: { isOverTime: true },
      item: { name: `${DECAYING_DAMAGE_OVERTIME_LABEL} [${effect.id}]` },
      targets: new Set([{ actor }])
    };

    assert.equal(await service.handleMidiRollComplete(workflow), true);
    assert.equal(effect.flags[MODULE_ID].statusValue, 9);
    assert.equal(effect.flags.statuscounter.value, 9);
    assert.match(effect.changes[0].value, /damageRoll=9/iu);
    assert.deepEqual(actor.updateCalls, []);
    assert.equal(await service.handleMidiRollComplete(workflow), false);
    assert.equal(effect.flags[MODULE_ID].statusValue, 9);
  }
  finally {
    globals.restore();
  }
});

test("completed final decay tick removes the status and unrelated overtime workflows leave it unchanged", async () => {
  const globals = installFoundryGlobals();
  try {
    const service = new CombatStatusService({});
    const actor = new globals.TestActor();
    actor.id = "actor-1";
    actor.uuid = "Actor.actor-1";
    actor.effects = { contents: [] };
    const effect = makeEffect(globals.TestActiveEffect, actor, { value: 2, step: 2, damageType: "necrotic" });
    actor.effects.contents = [effect];

    const unrelated = {
      id: "workflow-unrelated",
      workflowOptions: { isOverTime: true },
      item: { name: "Другой периодический урон" },
      targets: new Set([{ actor }])
    };
    assert.equal(await service.handleMidiRollComplete(unrelated), false);
    assert.equal(actor.effects.contents.length, 1);

    const finalTick = {
      id: "workflow-final",
      workflowOptions: { isOverTime: true },
      item: { name: `${DECAYING_DAMAGE_OVERTIME_LABEL} [${effect.id}]` },
      targets: new Set([{ actor }])
    };
    assert.equal(await service.handleMidiRollComplete(finalTick), true);
    assert.equal(actor.effects.contents.length, 0);
  }
  finally {
    globals.restore();
  }
});

test("manual HUD application requires amount, decay step, and a base damage type", async () => {
  const globals = installFoundryGlobals();
  class TestHTMLElement {
    constructor() {
      this.dataset = {};
      this.listeners = [];
      this.fields = new Map();
    }
    addEventListener(type, handler, capture) {
      this.listeners.push({ type, handler, capture });
    }
    closest(selector) {
      return selector === ".effect-control[data-status-id]" ? this : null;
    }
    querySelector(selector) {
      return this.fields.get(selector) ?? null;
    }
  }
  class TestHTMLInputElement extends TestHTMLElement {
    constructor(value = "") {
      super();
      this.value = value;
    }
    focus() {}
    select() {}
  }
  globalThis.HTMLElement = TestHTMLElement;
  globalThis.HTMLInputElement = TestHTMLInputElement;

  let dialogContent = "";
  globalThis.Dialog = class Dialog {
    constructor(config) {
      this.config = config;
    }
    render() {
      dialogContent = this.config.content;
      const root = new TestHTMLElement();
      root.fields.set("[data-field='status-value']", new TestHTMLInputElement("10"));
      root.fields.set("[data-field='decaying-damage-step']", new TestHTMLInputElement("2"));
      root.fields.set("[data-field='decaying-damage-type']", new TestHTMLInputElement("fire"));
      this.config.buttons.confirm.callback(root);
    }
  };

  try {
    const service = new CombatStatusService({});
    const actor = new globals.TestActor();
    actor.id = "actor-1";
    actor.uuid = "Actor.actor-1";
    const effect = makeEffect(globals.TestActiveEffect, actor, { value: 5, step: 1, damageType: "acid" });
    actor.effects = { contents: [effect] };
    actor.updateEmbeddedDocuments = async (_type, updates) => {
      for (const update of updates) await effect.update(update);
      return updates;
    };

    const root = new TestHTMLElement();
    await service.bindTokenHud({ object: { actor } }, root);
    const control = new TestHTMLElement();
    control.dataset.statusId = STATUS_ID;
    root.listeners.find((entry) => entry.type === "click")?.handler({
      type: "click",
      button: 0,
      target: control,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {}
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(dialogContent, /decaying-damage-step/u);
    assert.match(dialogContent, /decaying-damage-type/u);
    assert.equal(effect.flags[MODULE_ID].statusValue, 10);
    assert.equal(effect.flags[MODULE_ID].statusMeta.step, 2);
    assert.equal(effect.flags[MODULE_ID].statusMeta.damageType, "fire");
    assert.equal(effect.name, "Затихающий урон 10(-2) — Огонь");
    assert.match(effect.changes[0].value, /damageRoll=10,damageType=fire/iu);
  }
  finally {
    globals.restore();
  }
});

test("generic status API rejects decaying damage without a base damage type", async () => {
  const globals = installFoundryGlobals();
  try {
    const service = new CombatStatusService({});
    const actor = new globals.TestActor();
    actor.id = "actor-1";
    actor.effects = { contents: [] };
    actor.createEmbeddedDocuments = async () => {
      throw new Error("effect creation must not be reached");
    };

    await assert.rejects(
      service.setStatus(actor, STATUS_ID, { active: true, value: 10 }),
      /тип урона/iu
    );
  }
  finally {
    globals.restore();
  }
});

test("external decaying effect keeps unrelated changes while gaining the managed Midi overtime", async () => {
  const globals = installFoundryGlobals();
  try {
    const service = new CombatStatusService({});
    const actor = new globals.TestActor();
    actor.id = "actor-1";
    const effect = makeEffect(globals.TestActiveEffect, actor, { value: 6, step: 2, damageType: "acid" });
    effect.changes = [{
      key: "system.bonuses.abilities.check",
      mode: 2,
      value: "-1",
      priority: 20
    }];
    actor.effects = { contents: [effect] };
    actor.updateEmbeddedDocuments = async (_type, updates) => {
      for (const update of updates) await effect.update(update);
      return updates;
    };

    assert.equal(await service.handleActiveEffectCreated(effect), true);
    assert.deepEqual(effect.changes.map((change) => change.key), [
      "system.bonuses.abilities.check",
      "flags.midi-qol.OverTime.rebreyaDecayingDamage"
    ]);
    assert.match(effect.changes[1].value, /damageRoll=6,damageType=acid/iu);
  }
  finally {
    globals.restore();
  }
});

test("each Midi workflow advances only the decaying effect encoded in its synthetic item label", async () => {
  const globals = installFoundryGlobals();
  try {
    const service = new CombatStatusService({});
    const actor = new globals.TestActor();
    actor.id = "actor-1";
    actor.uuid = "Actor.actor-1";
    const first = makeEffect(globals.TestActiveEffect, actor, {
      id: "decay-a",
      value: 10,
      step: 1,
      damageType: "fire"
    });
    const second = makeEffect(globals.TestActiveEffect, actor, {
      id: "decay-b",
      value: 6,
      step: 2,
      damageType: "acid"
    });
    actor.effects = { contents: [first, second] };

    assert.equal(await service.handleMidiRollComplete({
      workflowOptions: { isOverTime: true },
      item: { name: `${DECAYING_DAMAGE_OVERTIME_LABEL} [${second.id}]` },
      targets: new Set([{ actor }])
    }), true);
    assert.equal(first.flags[MODULE_ID].statusValue, 10);
    assert.equal(second.flags[MODULE_ID].statusValue, 4);
    assert.match(second.changes[0].value, /damageRoll=4/iu);
  }
  finally {
    globals.restore();
  }
});

test("combat hook returns the decaying-damage Promise so Midi waits for the effect update", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const callbacks = new Map();
  globalThis.Hooks = {
    on(name, callback) {
      callbacks.set(name, callback);
    }
  };
  globalThis.game = {};
  try {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    registerCombatHooks({
      combatStatusService: {
        handleMidiRollComplete: () => pending
      }
    });
    const result = callbacks.get("midi-qol.RollComplete")?.({});
    assert.equal(typeof result?.then, "function");
    release(true);
    assert.equal(await result, true);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});
