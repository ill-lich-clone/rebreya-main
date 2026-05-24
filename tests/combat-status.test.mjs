import test from "node:test";
import assert from "node:assert/strict";

import {
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
  assert.equal(normalizeRebreyaStatusId("Сдержанный", ""), "rebreya-discreet");
  assert.equal(normalizeRebreyaStatusId("frightened", ""), "frightened");
  assert.equal(normalizeRebreyaStatusId("rebreya-frightened", ""), "frightened");
  assert.equal(normalizeRebreyaStatusId("Испуганный", ""), "frightened");

  const definition = getRebreyaStatusDefinition("rebreya-discreet");
  assert.equal(definition.key, "discreet");
  assert.equal(definition.label, "Сдержанный");
  assert.equal(definition.supportsValue, true);

  const statusConfig = buildRebreyaStatusConfig("discreet");
  assert.equal(statusConfig.id, "rebreya-discreet");
  assert.equal(statusConfig.name, "Сдержанный");
  assert.equal(statusConfig.icon, "icons/svg/anchor.svg");
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
      (status) => status.id === "rebreya-discreet"
    );
    const dnd5eDiscreetStatus = globalThis.CONFIG.DND5E.statusEffects["rebreya-discreet"];

    assert.equal(coreDiscreetStatuses.length, 1);
    assert.equal(dnd5eDiscreetStatus.name, "Сдержанный");
    assert.equal(dnd5eDiscreetStatus.img, "icons/svg/anchor.svg");
    assert.equal(dnd5eDiscreetStatus.icon, "icons/svg/anchor.svg");
    assert.equal(dnd5eDiscreetStatus.flags["rebreya-main"].statusKey, "discreet");
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
  const updates = buildFrightenedStatusSyncUpdates([
    {
      id: "weak",
      name: "Испуг 2",
      flags: {
        statuscounter: { value: 2 },
        "rebreya-main": { statusId: "rebreya-frightened", statusValue: 2 }
      },
      changes: [
        { key: "system.bonuses.abilities.check", mode: 2, value: "-2", priority: 20 }
      ],
      statuses: ["rebreya-frightened"]
    },
    {
      id: "fallback",
      name: "Испуг",
      flags: {
        "rebreya-main": { statusId: "frightened", statusValue: null }
      },
      changes: [],
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
    statuses: ["frightened"],
    changes: [],
    "flags.core.statusId": "frightened",
    "flags.rebreya-main.statusId": "frightened",
    "flags.rebreya-main.statusValue": 2,
    "flags.statuscounter.value": 2,
    "flags.statuscounter.visible": true
  });
  assert.deepEqual(
    updates.find((update) => update._id === "fallback")?.changes.map((change) => [change.key, change.value]),
    [
      ["system.bonuses.mwak.attack", "-3"],
      ["system.bonuses.rwak.attack", "-3"],
      ["system.bonuses.msak.attack", "-3"],
      ["system.bonuses.rsak.attack", "-3"]
    ]
  );
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
