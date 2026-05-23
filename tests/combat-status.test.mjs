import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRebreyaStatusConfig,
  getRebreyaStatusDefinition,
  normalizeRebreyaStatusId
} from "../scripts/combat/status-definitions.js";
import {
  buildDiscreetStatusEffectData,
  buildDiscreetStatusSyncUpdates,
  registerCombatStatusConfig
} from "../scripts/combat/status-service.js";

test("dnd5e restrained is not aliased to the Rebreya discreet status", () => {
  assert.equal(normalizeRebreyaStatusId("restrained", ""), "");
  assert.equal(normalizeRebreyaStatusId("discreet", ""), "rebreya-discreet");
  assert.equal(normalizeRebreyaStatusId("Сдержанный", ""), "rebreya-discreet");

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
