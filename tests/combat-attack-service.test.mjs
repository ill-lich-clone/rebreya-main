import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {
  utils: {
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

const { CombatAttackService } = await import("../scripts/combat/attack-service.js");

function makeActor(items) {
  return {
    items: {
      contents: items,
      get: (id) => items.find((item) => item.id === id) ?? null
    }
  };
}

test("fighter dominance maneuvers retarget shared dominance dice item and creature targeting before use", () => {
  const dominanceItem = {
    id: "actualDominanceItemId",
    name: "Стиль доминирования",
    flags: {
      "rebreya-main": {
        sourceType: "classFeature",
        classIdentifier: "fighter-rework-v028",
        featureId: "fighter-rework-v028::class::fighter-dominance"
      }
    },
    system: {
      uses: {
        max: "@scale.fighter-rework-v028.dominance-dice"
      }
    }
  };
  const maneuverItem = {
    id: "maneuverItemId",
    name: "Ответный удар"
  };
  const actor = makeActor([dominanceItem, maneuverItem]);
  maneuverItem.actor = actor;
  const target = {
    type: "itemUses",
    target: "fighter-dominance",
    value: "1"
  };
  const activity = {
    type: "utility",
    actor,
    item: maneuverItem,
    flags: {
      "rebreya-main": {
        automation: "fighter-dominance-maneuver",
        fighterAutomation: {
          kind: "maneuver",
          extraDamage: {
            formula: "1d4"
          }
        }
      }
    },
    consumption: {
      targets: [target]
    },
    range: {
      units: "self"
    },
    target: {
      affects: {
        type: "self"
      },
      prompt: false
    }
  };

  const service = new CombatAttackService({});
  service.applyDnd5ePreUseActivity(activity);

  assert.equal(target.target, dominanceItem.id);
  assert.equal(activity.target.affects.type, "creature");
  assert.equal(activity.target.prompt, true);
  assert.equal(activity.range.units, "");
});

test("fighter dominance maneuvers retarget blank or own-item use consumption before use", () => {
  const dominanceItem = {
    id: "actualDominanceItemId",
    name: "Стиль доминирования",
    flags: {
      "rebreya-main": {
        sourceType: "classFeature",
        classIdentifier: "fighter-rework-v028",
        featureId: "fighter-rework-v028::class::fighter-dominance"
      }
    },
    system: {
      uses: {
        max: "@scale.fighter-rework-v028.dominance-dice"
      }
    }
  };
  const maneuverItem = {
    id: "maneuverItemId",
    name: "Атака с угрозой",
    flags: {
      "rebreya-main": {
        sourceType: "fighterManeuver",
        classIdentifier: "fighter-rework-v028",
        featureId: "fighter-rework-v028::fighterManeuver::menacing-attack"
      }
    }
  };
  const actor = makeActor([dominanceItem, maneuverItem]);
  maneuverItem.actor = actor;
  const blankTarget = {
    type: "itemUses",
    target: "",
    value: "1"
  };
  const ownItemTarget = {
    type: "itemUses",
    target: maneuverItem.id,
    value: "1"
  };
  const activityUsesTarget = {
    type: "activityUses",
    target: "dominance-activity",
    value: "1"
  };
  const activity = {
    type: "utility",
    actor,
    item: maneuverItem,
    flags: {
      "rebreya-main": {
        fighterAutomation: {
          kind: "maneuver",
          extraDamage: {
            formula: "1d4"
          }
        }
      }
    },
    consumption: {
      targets: [blankTarget, ownItemTarget, activityUsesTarget]
    }
  };

  const service = new CombatAttackService({});
  service.applyDnd5ePreUseActivity(activity);

  assert.equal(blankTarget.target, dominanceItem.id);
  assert.equal(ownItemTarget.target, dominanceItem.id);
  assert.equal(activityUsesTarget.type, "itemUses");
  assert.equal(activityUsesTarget.target, dominanceItem.id);
});
