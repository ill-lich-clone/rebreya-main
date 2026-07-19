import test from "node:test";
import assert from "node:assert/strict";

import {
  REBREYA_STATUS_DEFINITIONS,
  buildRebreyaStatusConfig,
  getRebreyaStatusDefinition,
  normalizeRebreyaStatusId
} from "../scripts/combat/status-definitions.js";
import {
  CombatStatusService,
  buildDiscreetStatusEffectData,
  buildDiscreetStatusSyncUpdates,
  buildFrightenedStatusEffectData,
  buildFrightenedStatusSyncUpdates,
  registerCombatStatusConfig
} from "../scripts/combat/status-service.js";

test("dnd5e restrained is not aliased to the Rebreya discreet status", () => {
  assert.equal(normalizeRebreyaStatusId("restrained", ""), "");
  assert.equal(normalizeRebreyaStatusId("discreet", ""), "rebreya-discreet");
  assert.equal(normalizeRebreyaStatusId("rbDiscreet", ""), "rebreya-discreet");
  assert.equal(normalizeRebreyaStatusId("Сдержанный", ""), "rebreya-discreet");
  assert.equal(normalizeRebreyaStatusId("frightened", ""), "frightened");
  assert.equal(normalizeRebreyaStatusId("rebreya-frightened", ""), "frightened");
  assert.equal(normalizeRebreyaStatusId("Испуганный", ""), "frightened");

  const definition = getRebreyaStatusDefinition("rebreya-discreet");
  assert.equal(definition.key, "discreet");
  assert.equal(definition.label, "Сдержанный");
  assert.equal(definition.supportsValue, true);

  const statusConfig = buildRebreyaStatusConfig("discreet");
  assert.equal(statusConfig.id, "rbDiscreet");
  assert.match(statusConfig._id, /^[a-zA-Z0-9]{16}$/u);
  assert.equal(statusConfig.name, "Сдержанный");
  assert.equal(statusConfig.icon, "icons/svg/anchor.svg");
  assert.deepEqual(statusConfig.statuses, ["rebreya-discreet"]);
  assert.equal(statusConfig.flags["rebreya-main"].statusId, "rebreya-discreet");
});

test("custom Rebreya status configs use Foundry-safe ids and keep legacy aliases", () => {
  const seenDocumentIds = new Set();

  for (const definition of REBREYA_STATUS_DEFINITIONS.filter((row) => row.id.startsWith("rebreya-"))) {
    const statusConfig = buildRebreyaStatusConfig(definition.id);
    const expectedDocumentId = `dnd5e${statusConfig.id}`.padEnd(16, "0").slice(0, 16);

    assert.notEqual(statusConfig.id, definition.id);
    assert.match(statusConfig.id, /^[a-zA-Z0-9]+$/u);
    assert.equal(statusConfig._id, expectedDocumentId);
    assert.match(statusConfig._id, /^[a-zA-Z0-9]{16}$/u);
    assert.deepEqual(statusConfig.statuses, [definition.id]);
    assert.equal(statusConfig.flags["rebreya-main"].statusId, definition.id);
    assert.equal(normalizeRebreyaStatusId(statusConfig.id, ""), definition.id);
    assert.equal(seenDocumentIds.has(statusConfig._id), false, `${statusConfig._id} must be unique`);
    seenDocumentIds.add(statusConfig._id);
  }
});

test("discreet effect data stores a visible status counter and speed penalty", () => {
  const data = buildDiscreetStatusEffectData(15);

  assert.equal(data.name, "Сдержанный 15");
  assert.equal(data.flags["rebreya-main"].statusId, "rebreya-discreet");
  assert.equal(data.flags["rebreya-main"].statusValue, 15);
  assert.equal(data.flags.statuscounter.value, 15);
  assert.equal(data.flags.statuscounter.visible, true);
  assert.deepEqual([...data.statuses], ["rebreya-discreet"]);
  assert.deepEqual(
    data.changes.map((change) => [change.key, change.value]),
    [
      ["system.attributes.movement.walk", "-15"],
      ["system.attributes.movement.burrow", "-15"],
      ["system.attributes.movement.climb", "-15"],
      ["system.attributes.movement.fly", "-15"],
      ["system.attributes.movement.swim", "-15"]
    ]
  );
});

test("discreet effect data can be created without a counter value", () => {
  const data = buildDiscreetStatusEffectData(null);

  assert.equal(data.name, "Сдержанный");
  assert.equal(data.flags["rebreya-main"].statusValue, null);
  assert.equal(data.flags.statuscounter.value, undefined);
  assert.equal(data.flags.statuscounter.visible, false);
  assert.deepEqual(data.changes, []);
});

test("combat status config registers Rebreya statuses for dnd5e HUD rebuilds", () => {
  const previousConfig = globalThis.CONFIG;
  globalThis.CONFIG = {
    statusEffects: [],
    DND5E: {
      statusEffects: {}
    }
  };

  try {
    registerCombatStatusConfig();
    registerCombatStatusConfig();

    const coreDiscreetStatuses = globalThis.CONFIG.statusEffects.filter(
      (status) => status.id === "rbDiscreet"
    );
    const legacyDiscreetStatuses = globalThis.CONFIG.statusEffects.filter(
      (status) => status.id === "rebreya-discreet"
    );
    const dnd5eDiscreetStatus = globalThis.CONFIG.DND5E.statusEffects.rbDiscreet;

    assert.equal(coreDiscreetStatuses.length, 1);
    assert.equal(legacyDiscreetStatuses.length, 0);
    assert.match(coreDiscreetStatuses[0]._id, /^[a-zA-Z0-9]{16}$/u);
    assert.equal(dnd5eDiscreetStatus.name, "Сдержанный");
    assert.equal(dnd5eDiscreetStatus.img, "icons/svg/anchor.svg");
    assert.equal(dnd5eDiscreetStatus.icon, "icons/svg/anchor.svg");
    assert.deepEqual(dnd5eDiscreetStatus.statuses, ["rebreya-discreet"]);
    assert.equal(dnd5eDiscreetStatus.flags["rebreya-main"].statusKey, "discreet");
    assert.equal(dnd5eDiscreetStatus.flags["rebreya-main"].statusId, "rebreya-discreet");
  }
  finally {
    globalThis.CONFIG = previousConfig;
  }
});

test("combat status config marks Rebreya-owned native statuses as self-referential for DAE", () => {
  const previousConfig = globalThis.CONFIG;
  globalThis.CONFIG = {
    statusEffects: [
      {
        _id: "dnd5efrightened0",
        id: "frightened",
        name: "Frightened",
        statuses: ["fear-aura"]
      }
    ],
    DND5E: {
      statusEffects: {
        frightened: {
          id: "frightened",
          name: "Frightened",
          statuses: ["fear-aura"]
        }
      }
    }
  };

  try {
    registerCombatStatusConfig();
    registerCombatStatusConfig();

    assert.deepEqual(globalThis.CONFIG.statusEffects[0].statuses, ["fear-aura", "frightened"]);
    assert.deepEqual(globalThis.CONFIG.DND5E.statusEffects.frightened.statuses, ["fear-aura", "frightened"]);
  }
  finally {
    globalThis.CONFIG = previousConfig;
  }
});

test("frightened effect data stores a visible counter and attack penalties only", () => {
  const data = buildFrightenedStatusEffectData(3);

  assert.equal(data.name, "Испуганный 3");
  assert.equal(data.flags.core.statusId, "frightened");
  assert.equal(data.flags["rebreya-main"].statusId, "frightened");
  assert.equal(data.flags["rebreya-main"].statusValue, 3);
  assert.equal(data.flags.statuscounter.value, 3);
  assert.equal(data.flags.statuscounter.visible, true);
  assert.deepEqual([...data.statuses], ["frightened"]);
  assert.deepEqual(
    data.changes.map((change) => [change.key, change.value]),
    [
      ["system.bonuses.abilities.check", "-3"],
      ["system.bonuses.mwak.attack", "-3"],
      ["system.bonuses.rwak.attack", "-3"],
      ["system.bonuses.msak.attack", "-3"],
      ["system.bonuses.rsak.attack", "-3"]
    ]
  );
});

test("frightened setStatus uses the native dnd5e status id for midi and dae", async () => {
  const previousActor = globalThis.Actor;
  const previousActiveEffect = globalThis.ActiveEffect;
  const previousConfig = globalThis.CONFIG;

  class TestActor {}
  class TestActiveEffect {}
  globalThis.Actor = TestActor;
  globalThis.ActiveEffect = TestActiveEffect;
  globalThis.CONFIG = {
    statusEffects: [
      { id: "frightened" }
    ]
  };

  try {
    const service = new CombatStatusService({});
    const createdEffects = [];
    let toggleCalls = 0;
    const actor = new TestActor();
    actor.id = "actor-1";
    actor.system = { attributes: { prof: 4 } };
    actor.effects = { contents: createdEffects };
    actor.toggleStatusEffect = async (statusId, options) => {
      toggleCalls += 1;
      assert.equal(statusId, "frightened");
      assert.deepEqual(options, { active: true, overlay: false });
      const effect = new TestActiveEffect();
      Object.assign(effect, {
        id: "native-effect",
        _id: "native-effect",
        name: "Испуганный",
        statuses: ["frightened"],
        flags: {
          core: { statusId: "frightened" }
        },
        changes: [],
        parent: actor,
        getFlag(scope, key) {
          return this.flags?.[scope]?.[key];
        },
        async update(patch) {
          Object.assign(this, patch);
          for (const [key, value] of Object.entries(patch)) {
            if (!key.includes(".")) continue;
            key.split(".").reduce((target, part, partIndex, parts) => {
              if (partIndex === parts.length - 1) {
                target[part] = value;
                return target;
              }

              target[part] ??= {};
              return target[part];
            }, this);
          }
        }
      });
      createdEffects.push(effect);
      return effect;
    };
    actor.createEmbeddedDocuments = async (_type, documents) => {
      assert.fail("createEmbeddedDocuments must not be called when native frightened toggle returns an effect");
      const created = documents.map((document, index) => ({
        ...document,
        id: `effect-${index}`,
        _id: `effect-${index}`,
        parent: actor,
        getFlag(scope, key) {
          return this.flags?.[scope]?.[key];
        },
        async update(patch) {
          Object.assign(this, patch);
          for (const [key, value] of Object.entries(patch)) {
            if (!key.includes(".")) continue;
            key.split(".").reduce((target, part, partIndex, parts) => {
              if (partIndex === parts.length - 1) {
                target[part] = value;
                return target;
              }

              target[part] ??= {};
              return target[part];
            }, this);
          }
        }
      }));
      createdEffects.push(...created);
      return created;
    };
    actor.updateEmbeddedDocuments = async (_type, updates) => {
      for (const update of updates) {
        const effect = createdEffects.find((candidate) => candidate.id === update._id);
        await effect?.update(update);
      }
      return updates;
    };

    const effect = await service.setStatus(actor, "frightened", {
      active: true,
      value: 2
    });

    assert.equal(toggleCalls, 1);
    assert.equal(effect.name, "Испуганный 2");
    assert.equal(createdEffects.length, 1);
    assert.equal(createdEffects[0].flags.core.statusId, "frightened");
    assert.deepEqual(createdEffects[0].statuses, ["frightened"]);
    assert.equal(createdEffects[0].flags["rebreya-main"].statusValue, 2);
    assert.equal(createdEffects[0].flags["rebreya-main"].statusId, "frightened");
    assert.equal(createdEffects[0].flags.statuscounter.value, 2);
    assert.deepEqual(
      createdEffects[0].changes.map((change) => [change.key, change.value]),
      [
        ["system.bonuses.abilities.check", "-2"],
        ["system.bonuses.mwak.attack", "-2"],
        ["system.bonuses.rwak.attack", "-2"],
        ["system.bonuses.msak.attack", "-2"],
        ["system.bonuses.rsak.attack", "-2"]
      ]
    );
  }
  finally {
    globalThis.Actor = previousActor;
    globalThis.ActiveEffect = previousActiveEffect;
    globalThis.CONFIG = previousConfig;
  }
});

test("surrounded setStatus applies a minus two armor class effect", async () => {
  const previousActor = globalThis.Actor;
  const previousActiveEffect = globalThis.ActiveEffect;
  const previousConfig = globalThis.CONFIG;
  const previousConst = globalThis.CONST;
  const previousFoundry = globalThis.foundry;

  class TestActor {}
  class TestActiveEffect {}
  globalThis.Actor = TestActor;
  globalThis.ActiveEffect = TestActiveEffect;
  globalThis.CONFIG = { statusEffects: [] };
  globalThis.CONST = {
    ACTIVE_EFFECT_MODES: {
      ADD: 2
    }
  };
  globalThis.foundry = {
    utils: {
      deepClone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
      }
    }
  };

  try {
    const service = new CombatStatusService({});
    const createdEffects = [];
    const actor = new TestActor();
    actor.id = "actor-1";
    actor.effects = { contents: createdEffects };
    actor.createEmbeddedDocuments = async (_type, documents) => {
      const created = documents.map((document, index) => ({
        ...document,
        id: `effect-${index}`,
        _id: `effect-${index}`,
        parent: actor,
        getFlag(scope, key) {
          return this.flags?.[scope]?.[key];
        },
        async update(patch) {
          Object.assign(this, patch);
        }
      }));
      createdEffects.push(...created);
      return created;
    };

    const effect = await service.setStatus(actor, "rebreya-surrounded", {
      active: true
    });

    assert.equal(effect.flags["rebreya-main"].statusId, "rebreya-surrounded");
    assert.deepEqual([...effect.statuses], ["rebreya-surrounded"]);
    assert.deepEqual(
      effect.changes.map((change) => [change.key, change.value, change.mode, change.priority]),
      [
        ["system.attributes.ac.bonus", "-2", 2, 20]
      ]
    );
  }
  finally {
    globalThis.Actor = previousActor;
    globalThis.ActiveEffect = previousActiveEffect;
    globalThis.CONFIG = previousConfig;
    globalThis.CONST = previousConst;
    globalThis.foundry = previousFoundry;
  }
});

test("surrounded setStatus refreshes an existing marker with armor class changes", async () => {
  const previousActor = globalThis.Actor;
  const previousActiveEffect = globalThis.ActiveEffect;
  const previousConfig = globalThis.CONFIG;
  const previousConst = globalThis.CONST;
  const previousFoundry = globalThis.foundry;

  class TestActor {}
  class TestActiveEffect {}
  globalThis.Actor = TestActor;
  globalThis.ActiveEffect = TestActiveEffect;
  globalThis.CONFIG = { statusEffects: [] };
  globalThis.CONST = {
    ACTIVE_EFFECT_MODES: {
      ADD: 2
    }
  };
  globalThis.foundry = {
    utils: {
      deepClone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
      }
    }
  };

  try {
    const service = new CombatStatusService({});
    const existingEffect = new TestActiveEffect();
    Object.assign(existingEffect, {
      id: "existing",
      _id: "existing",
      statuses: ["rebreya-surrounded"],
      flags: {
        core: { statusId: "rebreya-surrounded" },
        "rebreya-main": { statusId: "rebreya-surrounded" }
      },
      changes: [],
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      async update(patch) {
        Object.assign(this, patch);
        for (const [key, value] of Object.entries(patch)) {
          if (!key.includes(".")) continue;
          key.split(".").reduce((target, part, partIndex, parts) => {
            if (partIndex === parts.length - 1) {
              target[part] = value;
              return target;
            }

            target[part] ??= {};
            return target[part];
          }, this);
        }
      }
    });
    const actor = new TestActor();
    actor.id = "actor-1";
    actor.effects = { contents: [existingEffect] };

    const effect = await service.setStatus(actor, "rebreya-surrounded", {
      active: true,
      meta: { source: "rebreya-environment" }
    });

    assert.equal(effect, existingEffect);
    assert.deepEqual(
      existingEffect.changes.map((change) => [change.key, change.value, change.mode, change.priority]),
      [
        ["system.attributes.ac.bonus", "-2", 2, 20]
      ]
    );
  }
  finally {
    globalThis.Actor = previousActor;
    globalThis.ActiveEffect = previousActiveEffect;
    globalThis.CONFIG = previousConfig;
    globalThis.CONST = previousConst;
    globalThis.foundry = previousFoundry;
  }
});

test("clearStatus treats already-deleted Rebreya effects as cleared", async () => {
  const previousActor = globalThis.Actor;
  const previousActiveEffect = globalThis.ActiveEffect;
  const previousConfig = globalThis.CONFIG;
  const previousFoundry = globalThis.foundry;

  class TestActor {}
  class TestActiveEffect {}
  globalThis.Actor = TestActor;
  globalThis.ActiveEffect = TestActiveEffect;
  globalThis.CONFIG = { statusEffects: [] };
  globalThis.foundry = {
    utils: {
      deepClone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
      }
    }
  };

  try {
    const service = new CombatStatusService({});
    const effect = new TestActiveEffect();
    Object.assign(effect, {
      id: "stale-effect",
      statuses: ["rebreya-open-position"],
      flags: {
        core: { statusId: "rebreya-open-position" },
        "rebreya-main": { statusId: "rebreya-open-position" }
      },
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      async delete() {
        throw new Error('ActiveEffect "stale-effect" does not exist!');
      }
    });
    const actor = new TestActor();
    actor.id = "actor-1";
    actor.effects = { contents: [effect] };

    assert.equal(await service.clearStatus(actor, "rebreya-open-position"), true);
  }
  finally {
    globalThis.Actor = previousActor;
    globalThis.ActiveEffect = previousActiveEffect;
    globalThis.CONFIG = previousConfig;
    globalThis.foundry = previousFoundry;
  }
});

test("active frightened HUD click updates the value instead of clearing the status", async () => {
  const previousActor = globalThis.Actor;
  const previousActiveEffect = globalThis.ActiveEffect;
  const previousConfig = globalThis.CONFIG;
  const previousConst = globalThis.CONST;
  const previousFoundry = globalThis.foundry;
  const previousDialog = globalThis.Dialog;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousHTMLInputElement = globalThis.HTMLInputElement;

  class TestHTMLElement {
    constructor() {
      this.dataset = {};
      this.listeners = [];
      this.input = null;
    }

    addEventListener(type, handler, capture) {
      this.listeners.push({ type, handler, capture });
    }

    closest(selector) {
      return selector === ".effect-control[data-status-id]" ? this : null;
    }

    querySelector(selector) {
      return selector === "[data-field='status-value']" ? this.input : null;
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

  function applyPatch(target, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (!key.includes(".")) {
        target[key] = value;
        continue;
      }

      key.split(".").reduce((current, part, partIndex, parts) => {
        if (partIndex === parts.length - 1) {
          current[part] = value;
          return current;
        }

        current[part] ??= {};
        return current[part];
      }, target);
    }
  }

  class TestActor {}
  class TestActiveEffect {}

  globalThis.Actor = TestActor;
  globalThis.ActiveEffect = TestActiveEffect;
  globalThis.HTMLElement = TestHTMLElement;
  globalThis.HTMLInputElement = TestHTMLInputElement;
  globalThis.CONFIG = { statusEffects: [{ id: "frightened" }] };
  globalThis.CONST = { ACTIVE_EFFECT_MODES: { ADD: 2 } };
  globalThis.foundry = {
    utils: {
      deepClone: (value) => JSON.parse(JSON.stringify(value)),
      escapeHTML: (value) => String(value ?? ""),
      getProperty: (source, path) => String(path ?? "").split(".").reduce((current, part) => current?.[part], source)
    }
  };

  let dialogOpened = 0;
  globalThis.Dialog = class Dialog {
    constructor(config) {
      this.config = config;
    }

    render() {
      dialogOpened += 1;
      const root = new TestHTMLElement();
      root.input = new TestHTMLInputElement("4");
      this.config.render?.(root);
      this.config.buttons.confirm.callback(root);
    }
  };

  try {
    const service = new CombatStatusService({});
    const actor = new TestActor();
    actor.id = "actor-1";
    actor.system = { attributes: { prof: 4 } };
    let clearCalls = 0;

    const effect = new TestActiveEffect();
    Object.assign(effect, {
      id: "abcdefghijklmnop",
      _id: "abcdefghijklmnop",
      name: "РСЃРїСѓРіР°РЅРЅС‹Р№ 2",
      statuses: ["frightened"],
      flags: {
        core: { statusId: "frightened" },
        "rebreya-main": { statusId: "frightened", statusValue: 2 },
        statuscounter: { value: 2, visible: true }
      },
      changes: [],
      parent: actor,
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      async update(patch) {
        applyPatch(this, patch);
      },
      async delete() {
        clearCalls += 1;
      }
    });

    actor.effects = { contents: [effect] };
    actor.toggleStatusEffect = async (_statusId, options) => {
      if (options?.active === false) {
        clearCalls += 1;
      }
      return true;
    };
    actor.updateEmbeddedDocuments = async (_type, updates) => {
      for (const update of updates) {
        if (update._id === effect.id) {
          await effect.update(update);
        }
      }
      return updates;
    };

    const root = new TestHTMLElement();
    await service.bindTokenHud({ object: { actor } }, root);

    const control = new TestHTMLElement();
    control.dataset.statusId = "frightened";
    const event = {
      type: "click",
      button: 0,
      target: control,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {}
    };

    root.listeners.find((entry) => entry.type === "click")?.handler(event);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(dialogOpened, 1);
    assert.equal(clearCalls, 0);
    assert.equal(effect.flags["rebreya-main"].statusValue, 4);
    assert.equal(effect.flags.statuscounter.value, 4);
    assert.deepEqual(
      effect.changes.map((change) => [change.key, change.value]),
      [
        ["system.bonuses.abilities.check", "-4"],
        ["system.bonuses.mwak.attack", "-4"],
        ["system.bonuses.rwak.attack", "-4"],
        ["system.bonuses.msak.attack", "-4"],
        ["system.bonuses.rsak.attack", "-4"]
      ]
    );
  }
  finally {
    globalThis.Actor = previousActor;
    globalThis.ActiveEffect = previousActiveEffect;
    globalThis.CONFIG = previousConfig;
    globalThis.CONST = previousConst;
    globalThis.foundry = previousFoundry;
    globalThis.Dialog = previousDialog;
    globalThis.HTMLElement = previousHTMLElement;
    globalThis.HTMLInputElement = previousHTMLInputElement;
  }
});

test("ctrl-click on frightened asks for value then duration and patches DAE source expiry from the single target", async () => {
  const previousActor = globalThis.Actor;
  const previousActiveEffect = globalThis.ActiveEffect;
  const previousConfig = globalThis.CONFIG;
  const previousConst = globalThis.CONST;
  const previousFoundry = globalThis.foundry;
  const previousDialog = globalThis.Dialog;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousHTMLInputElement = globalThis.HTMLInputElement;
  const previousGame = globalThis.game;

  class TestHTMLElement {
    constructor() {
      this.dataset = {};
      this.listeners = [];
      this.input = null;
    }

    addEventListener(type, handler, capture) {
      this.listeners.push({ type, handler, capture });
    }

    closest(selector) {
      return selector === ".effect-control[data-status-id]" ? this : null;
    }

    querySelector(selector) {
      return selector === "[data-field='status-value']" ? this.input : null;
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

  function applyPatch(target, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (!key.includes(".")) {
        target[key] = value;
        continue;
      }

      key.split(".").reduce((current, part, partIndex, parts) => {
        if (partIndex === parts.length - 1) {
          current[part] = value;
          return current;
        }

        current[part] ??= {};
        return current[part];
      }, target);
    }
  }

  class TestActor {}
  class TestActiveEffect {}

  globalThis.Actor = TestActor;
  globalThis.ActiveEffect = TestActiveEffect;
  globalThis.HTMLElement = TestHTMLElement;
  globalThis.HTMLInputElement = TestHTMLInputElement;
  globalThis.CONFIG = { statusEffects: [{ id: "frightened" }] };
  globalThis.CONST = { ACTIVE_EFFECT_MODES: { ADD: 2 } };
  globalThis.foundry = {
    utils: {
      deepClone: (value) => JSON.parse(JSON.stringify(value)),
      escapeHTML: (value) => String(value ?? ""),
      getProperty: (source, path) => String(path ?? "").split(".").reduce((current, part) => current?.[part], source)
    }
  };

  const openedDialogs = [];
  const dialogOptions = [];
  const dialogQueue = [
    { kind: "value", input: "4" },
    { kind: "duration", button: "turnStart" }
  ];

  globalThis.Dialog = class Dialog {
    constructor(config, options) {
      this.config = config;
      this.options = options;
    }

    render() {
      openedDialogs.push(this.config.title);
      dialogOptions.push(this.options ?? {});
      const plan = dialogQueue.shift();
      if (!plan) {
        throw new Error("Unexpected dialog render");
      }

      if (plan.kind === "value") {
        const root = new TestHTMLElement();
        root.input = new TestHTMLInputElement(plan.input);
        this.config.render?.(root);
        this.config.buttons.confirm.callback(root);
        return;
      }

      this.config.buttons[plan.button].callback();
    }
  };

  try {
    const service = new CombatStatusService({});
    const actor = new TestActor();
    actor.id = "actor-1";
    actor.uuid = "Actor.actor-1";
    actor.name = "Lich";
    actor.system = { attributes: { prof: 4 } };

    const sourceActor = new TestActor();
    sourceActor.id = "actor-2";
    sourceActor.uuid = "Actor.actor-2";
    sourceActor.name = "Monk";
    sourceActor.system = { attributes: { prof: 5 } };

    globalThis.game = {
      combat: { round: 3, turn: 1 },
      user: {
        targets: new Set([{ actor: sourceActor }])
      }
    };

    const effect = new TestActiveEffect();
    Object.assign(effect, {
      id: "abcdefghijklmnop",
      _id: "abcdefghijklmnop",
      name: "Frightened 2",
      statuses: ["frightened"],
      flags: {
        core: { statusId: "frightened" },
        "rebreya-main": { statusId: "frightened", statusValue: 2 },
        statuscounter: { value: 2, visible: true }
      },
      changes: [],
      parent: actor,
      origin: null,
      duration: {},
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      async update(patch) {
        applyPatch(this, patch);
      }
    });

    actor.effects = { contents: [effect] };
    actor.updateEmbeddedDocuments = async (_type, updates) => {
      for (const update of updates) {
        if (update._id === effect.id) {
          await effect.update(update);
        }
      }
      return updates;
    };

    const root = new TestHTMLElement();
    await service.bindTokenHud({ object: { actor } }, root);

    const control = new TestHTMLElement();
    control.dataset.statusId = "frightened";
    const event = {
      type: "click",
      button: 0,
      ctrlKey: true,
      target: control,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {}
    };

    root.listeners.find((entry) => entry.type === "click")?.handler(event);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(openedDialogs.length, 2);
    assert.deepEqual(dialogOptions[1].classes, ["rebreya-main", "rebreya-trader-dialog", "rm-status-duration-dialog"]);
    assert.equal(dialogOptions[1].width, 560);
    assert.equal(effect.flags["rebreya-main"].statusValue, 4);
    assert.equal(effect.flags.statuscounter.value, 4);
    assert.equal(effect.origin, "Actor.actor-2");
    assert.deepEqual(effect.flags.dae.specialDuration, ["turnStartSource", "combatEnd"]);
    assert.equal(effect.flags["rebreya-main"].statusMeta.sourceActorId, "actor-2");
    assert.equal(effect.flags["rebreya-main"].statusMeta.durationMode, "turnStartSource");
    assert.equal(effect.duration.rounds, 1);
    assert.equal(effect.duration.startRound, 3);
    assert.equal(effect.duration.startTurn, 1);
  }
  finally {
    globalThis.Actor = previousActor;
    globalThis.ActiveEffect = previousActiveEffect;
    globalThis.CONFIG = previousConfig;
    globalThis.CONST = previousConst;
    globalThis.foundry = previousFoundry;
    globalThis.Dialog = previousDialog;
    globalThis.HTMLElement = previousHTMLElement;
    globalThis.HTMLInputElement = previousHTMLInputElement;
    globalThis.game = previousGame;
  }
});

test("ctrl-click on a standard status falls back to the bearer when there is not exactly one target", async () => {
  const previousActor = globalThis.Actor;
  const previousActiveEffect = globalThis.ActiveEffect;
  const previousConfig = globalThis.CONFIG;
  const previousConst = globalThis.CONST;
  const previousFoundry = globalThis.foundry;
  const previousDialog = globalThis.Dialog;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousGame = globalThis.game;

  class TestHTMLElement {
    constructor() {
      this.dataset = {};
      this.listeners = [];
    }

    addEventListener(type, handler, capture) {
      this.listeners.push({ type, handler, capture });
    }

    closest(selector) {
      return selector === ".effect-control[data-status-id]" ? this : null;
    }
  }

  function applyPatch(target, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (!key.includes(".")) {
        target[key] = value;
        continue;
      }

      key.split(".").reduce((current, part, partIndex, parts) => {
        if (partIndex === parts.length - 1) {
          current[part] = value;
          return current;
        }

        current[part] ??= {};
        return current[part];
      }, target);
    }
  }

  class TestActor {}
  class TestActiveEffect {}

  globalThis.Actor = TestActor;
  globalThis.ActiveEffect = TestActiveEffect;
  globalThis.HTMLElement = TestHTMLElement;
  globalThis.CONFIG = { statusEffects: [{ id: "stunned" }] };
  globalThis.CONST = { ACTIVE_EFFECT_MODES: { ADD: 2 } };
  globalThis.foundry = {
    utils: {
      deepClone: (value) => JSON.parse(JSON.stringify(value)),
      escapeHTML: (value) => String(value ?? ""),
      getProperty: (source, path) => String(path ?? "").split(".").reduce((current, part) => current?.[part], source)
    }
  };

  const openedDialogs = [];
  globalThis.Dialog = class Dialog {
    constructor(config) {
      this.config = config;
    }

    render() {
      openedDialogs.push(this.config.title);
      this.config.buttons.turnEnd.callback();
    }
  };

  try {
    const service = new CombatStatusService({});
    const actor = new TestActor();
    actor.id = "actor-1";
    actor.uuid = "Actor.actor-1";
    actor.name = "Lich";

    const sourceA = new TestActor();
    sourceA.id = "actor-2";
    sourceA.uuid = "Actor.actor-2";

    const sourceB = new TestActor();
    sourceB.id = "actor-3";
    sourceB.uuid = "Actor.actor-3";

    globalThis.game = {
      combat: { round: 4, turn: 2 },
      user: {
        targets: new Set([{ actor: sourceA }, { actor: sourceB }])
      }
    };

    const effect = new TestActiveEffect();
    Object.assign(effect, {
      id: "stunned-effect",
      _id: "stunned-effect",
      name: "Stunned",
      statuses: ["stunned"],
      flags: {
        core: { statusId: "stunned" }
      },
      changes: [],
      parent: actor,
      origin: null,
      duration: {},
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      async update(patch) {
        applyPatch(this, patch);
      }
    });

    actor.effects = { contents: [effect] };

    const root = new TestHTMLElement();
    await service.bindTokenHud({ object: { actor } }, root);

    const control = new TestHTMLElement();
    control.dataset.statusId = "stunned";
    const event = {
      type: "click",
      button: 0,
      ctrlKey: true,
      target: control,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {}
    };

    root.listeners.find((entry) => entry.type === "click")?.handler(event);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(openedDialogs.length, 1);
    assert.equal(effect.origin, "Actor.actor-1");
    assert.deepEqual(effect.flags.dae.specialDuration, ["turnEndSource", "combatEnd"]);
    assert.equal(effect.flags["rebreya-main"].statusMeta.sourceActorId, "actor-1");
    assert.equal(effect.flags["rebreya-main"].statusMeta.durationMode, "turnEndSource");
  }
  finally {
    globalThis.Actor = previousActor;
    globalThis.ActiveEffect = previousActiveEffect;
    globalThis.CONFIG = previousConfig;
    globalThis.CONST = previousConst;
    globalThis.foundry = previousFoundry;
    globalThis.Dialog = previousDialog;
    globalThis.HTMLElement = previousHTMLElement;
    globalThis.game = previousGame;
  }
});

test("frightened effect data falls back to half source proficiency with minimum two", () => {
  const highProficiency = buildFrightenedStatusEffectData(null, {
    sourceActor: {
      system: {
        attributes: {
          prof: 6
        }
      }
    }
  });
  const lowProficiency = buildFrightenedStatusEffectData(null, {
    sourceActor: {
      system: {
        attributes: {
          prof: 3
        }
      }
    }
  });

  assert.equal(highProficiency.flags["rebreya-main"].statusValue, 3);
  assert.equal(highProficiency.flags.statuscounter.value, 3);
  assert.equal(lowProficiency.flags["rebreya-main"].statusValue, 2);
  assert.equal(lowProficiency.flags.statuscounter.value, 2);
});

test("frightened status sync keeps only the strongest attack penalty active", () => {
  const attackBonusKeys = [
    "system.bonuses.abilities.check",
    "system.bonuses.mwak.attack",
    "system.bonuses.rwak.attack",
    "system.bonuses.msak.attack",
    "system.bonuses.rsak.attack"
  ];
  const weakOverTime = {
    key: "flags.midi-qol.OverTime",
    mode: 0,
    value: "turn=end,saveAbility=wis,saveDC=13",
    priority: 20
  };
  const strongestOverTime = {
    key: "flags.midi-qol.OverTime",
    mode: 0,
    value: "turn=end,saveAbility=wis,saveDC=15",
    priority: 20
  };
  const updates = buildFrightenedStatusSyncUpdates([
    {
      id: "weak",
      name: "Frightened 2",
      flags: {
        statuscounter: { value: 2 },
        "rebreya-main": { statusId: "rebreya-frightened", statusValue: 2 }
      },
      changes: [
        weakOverTime,
        { key: "system.bonuses.mwak.attack", mode: 2, value: "-2", priority: 20 }
      ],
      statuses: []
    },
    {
      id: "fallback",
      name: "Frightened",
      flags: {
        "rebreya-main": { statusId: "frightened", statusValue: null }
      },
      changes: [
        strongestOverTime,
        { key: "system.bonuses.rwak.attack", mode: 2, value: "-99", priority: 20 }
      ],
      statuses: ["frightened"]
    }
  ], {
    sourceActor: {
      system: {
        attributes: {
          prof: 6
        }
      }
    }
  });

  assert.deepEqual(updates.find((update) => update._id === "weak"), {
    _id: "weak",
    name: "Испуганный 2",
    img: "systems/dnd5e/icons/svg/statuses/frightened.svg",
    icon: "systems/dnd5e/icons/svg/statuses/frightened.svg",
    statuses: [],
    disabled: true,
    changes: [weakOverTime],
    "flags.core.statusId": null,
    "flags.rebreya-main.statusId": "frightened",
    "flags.rebreya-main.statusValue": 2,
    "flags.statuscounter.visible": false
  });
  assert.deepEqual(
    updates.find((update) => update._id === "fallback")?.changes,
    [
      strongestOverTime,
      { key: "system.bonuses.abilities.check", mode: 2, value: "-3", priority: 20 },
      { key: "system.bonuses.mwak.attack", mode: 2, value: "-3", priority: 20 },
      { key: "system.bonuses.rwak.attack", mode: 2, value: "-3", priority: 20 },
      { key: "system.bonuses.msak.attack", mode: 2, value: "-3", priority: 20 },
      { key: "system.bonuses.rsak.attack", mode: 2, value: "-3", priority: 20 }
    ]
  );
  assert.deepEqual(updates.find((update) => update._id === "fallback")?.statuses, ["frightened"]);
  assert.deepEqual(
    updates.flatMap((update) => update.changes
      .filter((change) => attackBonusKeys.includes(change.key))
      .map((change) => [update._id, change.key, change.value])),
    attackBonusKeys.map((key) => ["fallback", key, "-3"])
  );
});

test("frightened status sync canonicalizes named external effects", () => {
  const updates = buildFrightenedStatusSyncUpdates([
    {
      id: "external",
      name: "Frightened 2",
      flags: {},
      changes: [
        { key: "flags.midi-qol.OverTime", mode: 0, value: "turn=end,saveAbility=wis,saveDC=15", priority: 20 },
        { key: "system.traits.di.value", mode: 0, value: "fear", priority: 20 }
      ]
    }
  ]);

  assert.deepEqual(updates, [{
    _id: "external",
    name: "Испуганный 2",
    img: "systems/dnd5e/icons/svg/statuses/frightened.svg",
    icon: "systems/dnd5e/icons/svg/statuses/frightened.svg",
    statuses: ["frightened"],
    changes: [
      { key: "flags.midi-qol.OverTime", mode: 0, value: "turn=end,saveAbility=wis,saveDC=15", priority: 20 },
      { key: "system.bonuses.abilities.check", mode: 2, value: "-2", priority: 20 },
      { key: "system.bonuses.mwak.attack", mode: 2, value: "-2", priority: 20 },
      { key: "system.bonuses.rwak.attack", mode: 2, value: "-2", priority: 20 },
      { key: "system.bonuses.msak.attack", mode: 2, value: "-2", priority: 20 },
      { key: "system.bonuses.rsak.attack", mode: 2, value: "-2", priority: 20 }
    ],
    "flags.core.statusId": "frightened",
    "flags.rebreya-main.statusId": "frightened",
    "flags.rebreya-main.statusValue": 2,
    "flags.statuscounter.value": 2,
    "flags.statuscounter.visible": true
  }]);
});

test("frightened status sync leaves only the strongest duplicate as an active native status", () => {
  const updates = buildFrightenedStatusSyncUpdates([
    {
      id: "native",
      name: "Frightened",
      flags: {
        core: { statusId: "frightened" },
        statuscounter: { value: 1, visible: true }
      },
      statuses: ["frightened"],
      changes: []
    },
    {
      id: "external",
      name: "Frightened 2",
      flags: {},
      changes: []
    }
  ]);

  assert.deepEqual(updates, [{
    _id: "native",
    name: "Испуганный 1",
    img: "systems/dnd5e/icons/svg/statuses/frightened.svg",
    icon: "systems/dnd5e/icons/svg/statuses/frightened.svg",
    statuses: [],
    disabled: true,
    changes: [],
    "flags.core.statusId": null,
    "flags.rebreya-main.statusId": "frightened",
    "flags.rebreya-main.statusValue": 1,
    "flags.statuscounter.visible": false
  }, {
    _id: "external",
    name: "Испуганный 2",
    img: "systems/dnd5e/icons/svg/statuses/frightened.svg",
    icon: "systems/dnd5e/icons/svg/statuses/frightened.svg",
    statuses: ["frightened"],
    changes: [
      { key: "system.bonuses.abilities.check", mode: 2, value: "-2", priority: 20 },
      { key: "system.bonuses.mwak.attack", mode: 2, value: "-2", priority: 20 },
      { key: "system.bonuses.rwak.attack", mode: 2, value: "-2", priority: 20 },
      { key: "system.bonuses.msak.attack", mode: 2, value: "-2", priority: 20 },
      { key: "system.bonuses.rsak.attack", mode: 2, value: "-2", priority: 20 }
    ],
    "flags.core.statusId": "frightened",
    "flags.rebreya-main.statusId": "frightened",
    "flags.rebreya-main.statusValue": 2,
    "flags.statuscounter.value": 2,
    "flags.statuscounter.visible": true
  }]);
});

test("frightened create hook ignores DAE auto-created static statuses", async () => {
  const previousActor = globalThis.Actor;
  class TestActor {}
  globalThis.Actor = TestActor;

  try {
    const service = new CombatStatusService({});
    const databaseUpdates = [];
    const localMirrorUpdates = [];
    const actor = new TestActor();
    actor.id = "actor-1";

    const source = {
      id: "source",
      name: "Испуганный 2",
      img: "systems/dnd5e/icons/svg/statuses/frightened.svg",
      icon: "systems/dnd5e/icons/svg/statuses/frightened.svg",
      statuses: ["frightened"],
      flags: {
        core: { statusId: "frightened" },
        "rebreya-main": { statusId: "frightened", statusValue: 2 },
        statuscounter: { value: 2, visible: true }
      },
      changes: [
        { key: "system.bonuses.abilities.check", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.mwak.attack", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.rwak.attack", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.msak.attack", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.rsak.attack", mode: 2, value: "-2", priority: 20 }
      ],
      parent: actor,
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      }
    };

    const daeMirror = {
      id: "dnd5efrightened0",
      name: "Frightened",
      statuses: ["frightened"],
      flags: {
        core: { statusId: "frightened" },
        dae: { autoCreated: true },
        statuscounter: { value: 1, visible: true }
      },
      changes: [],
      parent: actor,
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      updateSource(update) {
        localMirrorUpdates.push(update);
      }
    };

    actor.effects = { contents: [source, daeMirror] };
    actor.updateEmbeddedDocuments = async (_type, documents) => {
      databaseUpdates.push(...documents);
      return documents;
    };

    const didSync = await service.handleActiveEffectCreated(daeMirror);

    assert.equal(didSync, false);
    assert.deepEqual(databaseUpdates, []);
    assert.deepEqual(localMirrorUpdates, []);
  }
  finally {
    globalThis.Actor = previousActor;
  }
});

test("frightened update hook ignores DAE auto-created static statuses", async () => {
  const previousActor = globalThis.Actor;
  class TestActor {}
  globalThis.Actor = TestActor;

  try {
    const service = new CombatStatusService({});
    const databaseUpdates = [];
    const localMirrorUpdates = [];
    const actor = new TestActor();
    actor.id = "actor-1";

    const source = {
      id: "source",
      name: "Испуганный 2",
      img: "systems/dnd5e/icons/svg/statuses/frightened.svg",
      icon: "systems/dnd5e/icons/svg/statuses/frightened.svg",
      statuses: ["frightened"],
      flags: {
        core: { statusId: "frightened" },
        "rebreya-main": { statusId: "frightened", statusValue: 2 },
        statuscounter: { value: 2, visible: true }
      },
      changes: [
        { key: "system.bonuses.abilities.check", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.mwak.attack", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.rwak.attack", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.msak.attack", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.rsak.attack", mode: 2, value: "-2", priority: 20 }
      ],
      parent: actor,
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      }
    };

    const daeMirror = {
      id: "dnd5efrightened0",
      name: "Frightened",
      statuses: ["frightened"],
      flags: {
        core: { statusId: "frightened" },
        dae: { autoCreated: true },
        statuscounter: { value: 1, visible: true }
      },
      changes: [],
      parent: actor,
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      updateSource(update) {
        localMirrorUpdates.push(update);
      }
    };

    actor.effects = { contents: [source, daeMirror] };
    actor.updateEmbeddedDocuments = async (_type, documents) => {
      databaseUpdates.push(...documents);
      return documents;
    };

    const didSync = await service.handleActiveEffectUpdate(daeMirror);

    assert.equal(didSync, false);
    assert.deepEqual(databaseUpdates, []);
    assert.deepEqual(localMirrorUpdates, []);
  }
  finally {
    globalThis.Actor = previousActor;
  }
});

test("frightened pre-create hook leaves DAE static mirrors untouched", () => {
  const service = new CombatStatusService({});
  const options = { animate: true };
  const updates = [];
  const effect = {
    id: "dnd5efrightened0",
    name: "Frightened",
    statuses: ["frightened"],
    flags: {
      core: { statusId: "frightened" },
      dae: { autoCreated: true }
    },
    changes: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    updateSource(update) {
      updates.push(update);
    }
  };

  assert.equal(service.prepareActiveEffectCreate(effect, options), false);
  assert.equal(options.animate, false);
  assert.deepEqual(updates, []);
});

test("frightened pre-delete hook suppresses DAE static marker animation", () => {
  const service = new CombatStatusService({});
  const options = { animate: true };
  const effect = {
    id: "dnd5efrightened0",
    name: "Frightened",
    statuses: ["frightened"],
    flags: {
      core: { statusId: "frightened" },
      dae: { autoCreated: true }
    },
    changes: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };

  assert.equal(service.prepareActiveEffectDelete(effect, options), false);
  assert.equal(options.animate, false);
});

test("frightened delete hook ignores DAE auto-created static statuses", async () => {
  const previousActor = globalThis.Actor;
  class TestActor {}
  globalThis.Actor = TestActor;

  try {
    const service = new CombatStatusService({});
    const databaseUpdates = [];
    const actor = new TestActor();
    actor.id = "actor-1";

    const source = {
      id: "source",
      name: "Frightened 2",
      statuses: ["frightened"],
      flags: {
        core: { statusId: "frightened" },
        "rebreya-main": { statusId: "frightened", statusValue: 2 },
        statuscounter: { value: 2, visible: true }
      },
      changes: [],
      parent: actor,
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      }
    };

    const daeMirror = {
      id: "dnd5efrightened0",
      name: "Frightened",
      statuses: ["frightened"],
      flags: {
        core: { statusId: "frightened" },
        dae: { autoCreated: true },
        statuscounter: { value: 1, visible: true }
      },
      changes: [],
      parent: actor,
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      }
    };

    actor.effects = { contents: [source, daeMirror] };
    actor.updateEmbeddedDocuments = async (_type, documents) => {
      databaseUpdates.push(...documents);
      return documents;
    };

    const didSync = await service.handleActiveEffectDeleted(daeMirror);

    assert.equal(didSync, false);
    assert.deepEqual(databaseUpdates, []);
  }
  finally {
    globalThis.Actor = previousActor;
  }
});

test("frightened sync does not update a DAE mirror after the real source is gone", () => {
  const updates = buildFrightenedStatusSyncUpdates([
    {
      id: "dnd5efrightened0",
      name: "Frightened",
      statuses: [],
      flags: {
        core: {},
        dae: { autoCreated: true },
        statuscounter: { visible: false }
      },
      changes: []
    }
  ]);

  assert.deepEqual(updates, []);
});

test("frightened status sync ignores the effect currently being deleted", () => {
  const updates = buildFrightenedStatusSyncUpdates([
    {
      id: "deleted",
      name: "Испуг 4",
      flags: {
        statuscounter: { value: 4 },
        "rebreya-main": { statusId: "frightened", statusValue: 4 }
      },
      statuses: ["frightened"]
    },
    {
      id: "remaining",
      name: "Испуг 2",
      flags: {
        statuscounter: { value: 2 },
        "rebreya-main": { statusId: "frightened", statusValue: 2 }
      },
      statuses: ["frightened"]
    }
  ], {
    excludeEffectIds: ["deleted"]
  });

  assert.deepEqual(updates.map((update) => update._id), ["remaining"]);
  assert.deepEqual(
    updates[0].changes.map((change) => [change.key, change.value]),
    [
      ["system.bonuses.abilities.check", "-2"],
      ["system.bonuses.mwak.attack", "-2"],
      ["system.bonuses.rwak.attack", "-2"],
      ["system.bonuses.msak.attack", "-2"],
      ["system.bonuses.rsak.attack", "-2"]
    ]
  );
});

test("frightened status sync ranks but does not update the effect currently being created", () => {
  const updates = buildFrightenedStatusSyncUpdates([
    {
      id: "created",
      name: "Frightened 4",
      flags: {
        statuscounter: { value: 4 },
        "rebreya-main": { statusId: "frightened", statusValue: 4 }
      },
      statuses: ["frightened"]
    },
    {
      id: "existing",
      name: "Frightened 2",
      flags: {
        statuscounter: { value: 2 },
        "rebreya-main": { statusId: "frightened", statusValue: 2 }
      },
      changes: [
        { key: "system.bonuses.mwak.attack", mode: 2, value: "-2", priority: 20 }
      ],
      statuses: ["frightened"]
    }
  ], {
    skipUpdateEffectIds: ["created"]
  });

  assert.deepEqual(updates.map((update) => update._id), ["existing"]);
  assert.deepEqual(updates[0].changes, []);
});

test("discreet status sync keeps several effects but only applies the strongest speed penalty", () => {
  const updates = buildDiscreetStatusSyncUpdates([
    {
      id: "weak",
      name: "Сдержанный 5",
      flags: {
        statuscounter: { value: 5 },
        "rebreya-main": { statusId: "rebreya-discreet", statusValue: 5 }
      },
      changes: []
    },
    {
      id: "strong",
      name: "Сдержанный 15",
      flags: {
        statuscounter: { value: 15 },
        "rebreya-main": { statusId: "rebreya-discreet", statusValue: 15 }
      },
      changes: []
    }
  ]);

  assert.equal(updates.length, 2);
  assert.deepEqual(updates.find((update) => update._id === "weak"), {
    _id: "weak",
    name: "Сдержанный 5",
    img: "icons/svg/anchor.svg",
    icon: "icons/svg/anchor.svg",
    statuses: ["rebreya-discreet"],
    changes: [],
    "flags.core.statusId": "rebreya-discreet",
    "flags.rebreya-main.statusId": "rebreya-discreet",
    "flags.rebreya-main.statusValue": 5,
    "flags.statuscounter.value": 5,
    "flags.statuscounter.visible": true
  });
  assert.deepEqual(
    updates.find((update) => update._id === "strong")?.changes.map((change) => [change.key, change.value]),
    [
      ["system.attributes.movement.walk", "-15"],
      ["system.attributes.movement.burrow", "-15"],
      ["system.attributes.movement.climb", "-15"],
      ["system.attributes.movement.fly", "-15"],
      ["system.attributes.movement.swim", "-15"]
    ]
  );
});

test("discreet status sync ignores the effect currently being deleted", () => {
  const updates = buildDiscreetStatusSyncUpdates([
    {
      id: "deleted",
      name: "Сдержанный 15",
      flags: {
        statuscounter: { value: 15 },
        "rebreya-main": { statusId: "rebreya-discreet", statusValue: 15 }
      },
      changes: []
    },
    {
      id: "remaining",
      name: "Сдержанный 5",
      flags: {
        statuscounter: { value: 5 },
        "rebreya-main": { statusId: "rebreya-discreet", statusValue: 5 }
      },
      changes: []
    }
  ], {
    excludeEffectIds: ["deleted"]
  });

  assert.deepEqual(updates.map((update) => update._id), ["remaining"]);
  assert.deepEqual(
    updates[0].changes.map((change) => [change.key, change.value]),
    [
      ["system.attributes.movement.walk", "-5"],
      ["system.attributes.movement.burrow", "-5"],
      ["system.attributes.movement.climb", "-5"],
      ["system.attributes.movement.fly", "-5"],
      ["system.attributes.movement.swim", "-5"]
    ]
  );
});

test("discreet status sync ranks but does not update the effect currently being created", () => {
  const updates = buildDiscreetStatusSyncUpdates([
    {
      id: "created",
      name: "Discreet 15",
      flags: {
        statuscounter: { value: 15 },
        "rebreya-main": { statusId: "rebreya-discreet", statusValue: 15 }
      },
      changes: []
    },
    {
      id: "existing",
      name: "Discreet 5",
      flags: {
        statuscounter: { value: 5 },
        "rebreya-main": { statusId: "rebreya-discreet", statusValue: 5 }
      },
      changes: [
        { key: "system.attributes.movement.walk", mode: 2, value: "-5", priority: 20 }
      ]
    }
  ], {
    skipUpdateEffectIds: ["created"]
  });

  assert.deepEqual(updates.map((update) => update._id), ["existing"]);
  assert.deepEqual(updates[0].changes, []);
});

test("unvalued discreet status halves movement instead of using a counter value", () => {
  const updates = buildDiscreetStatusSyncUpdates([
    {
      id: "half-speed",
      name: "Сдержанный",
      flags: {
        "rebreya-main": { statusId: "rebreya-discreet", statusValue: null }
      },
      changes: []
    }
  ], {
    actor: {
      _source: {
        system: {
          attributes: {
            movement: {
              walk: 30,
              burrow: 0,
              climb: 20,
              fly: 60,
              swim: 10
            }
          }
        }
      }
    }
  });

  assert.deepEqual(updates, [{
    _id: "half-speed",
    name: "Сдержанный",
    img: "icons/svg/anchor.svg",
    icon: "icons/svg/anchor.svg",
    statuses: ["rebreya-discreet"],
    changes: [
      { key: "system.attributes.movement.walk", mode: 2, value: "-15", priority: 20 },
      { key: "system.attributes.movement.climb", mode: 2, value: "-10", priority: 20 },
      { key: "system.attributes.movement.fly", mode: 2, value: "-30", priority: 20 },
      { key: "system.attributes.movement.swim", mode: 2, value: "-5", priority: 20 }
    ],
    "flags.core.statusId": "rebreya-discreet",
    "flags.rebreya-main.statusId": "rebreya-discreet",
    "flags.rebreya-main.statusValue": null,
    "flags.statuscounter.visible": false
  }]);
});

test("external named Rebreya statuses are canonicalized on create", async () => {
  const previousActor = globalThis.Actor;
  class TestActor {}
  globalThis.Actor = TestActor;

  try {
    const service = new CombatStatusService({});
    const updates = [];
    const actor = new TestActor();
    actor.id = "actor-1";
    actor.effects = { contents: [] };
    actor.updateEmbeddedDocuments = async (_type, documents) => {
      updates.push(...documents);
      return documents;
    };

    const effect = {
      id: "external",
      name: "Weakened 2",
      flags: {},
      changes: [
        { key: "flags.midi-qol.disadvantage.attack.all", mode: 0, value: "1", priority: 20 }
      ],
      parent: actor
    };
    actor.effects.contents.push(effect);

    const didSync = await service.handleActiveEffectCreated(effect);

    assert.equal(didSync, true);
    assert.deepEqual(updates, [{
      _id: "external",
      name: "Ослабленный 2",
      img: "icons/svg/downgrade.svg",
      icon: "icons/svg/downgrade.svg",
      statuses: ["rebreya-weakened"],
      changes: [],
      "flags.core.statusId": "rebreya-weakened",
      "flags.rebreya-main.statusId": "rebreya-weakened",
      "flags.rebreya-main.statusValue": 2,
      "flags.statuscounter.value": 2,
      "flags.statuscounter.visible": true
    }]);
  }
  finally {
    globalThis.Actor = previousActor;
  }
});

test("frightened update hook skips already canonical suppressed duplicates", async () => {
  const previousActor = globalThis.Actor;
  class TestActor {}
  globalThis.Actor = TestActor;

  try {
    const service = new CombatStatusService({});
    const updates = [];
    const actor = new TestActor();
    actor.id = "actor-1";

    const weak = {
      id: "weak",
      name: "Испуганный 1",
      disabled: true,
      img: "systems/dnd5e/icons/svg/statuses/frightened.svg",
      icon: "systems/dnd5e/icons/svg/statuses/frightened.svg",
      statuses: [],
      flags: {
        core: {},
        "rebreya-main": { statusId: "frightened", statusValue: 1 },
        statuscounter: { visible: false }
      },
      changes: [],
      parent: actor,
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      }
    };

    const strong = {
      id: "strong",
      name: "Испуганный 2",
      img: "systems/dnd5e/icons/svg/statuses/frightened.svg",
      icon: "systems/dnd5e/icons/svg/statuses/frightened.svg",
      statuses: ["frightened"],
      flags: {
        core: { statusId: "frightened" },
        "rebreya-main": { statusId: "frightened", statusValue: 2 },
        statuscounter: { value: 2, visible: true }
      },
      changes: [
        { key: "system.bonuses.abilities.check", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.mwak.attack", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.rwak.attack", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.msak.attack", mode: 2, value: "-2", priority: 20 },
        { key: "system.bonuses.rsak.attack", mode: 2, value: "-2", priority: 20 }
      ],
      parent: actor,
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      }
    };

    actor.effects = { contents: [weak, strong] };
    actor.updateEmbeddedDocuments = async (_type, documents) => {
      updates.push(...documents);
      return documents;
    };

    const didSync = await service.handleActiveEffectUpdate(weak);

    assert.equal(didSync, false);
    assert.deepEqual(updates, []);
  }
  finally {
    globalThis.Actor = previousActor;
  }
});
