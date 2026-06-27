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
globalThis.ChatMessage ??= {
  getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? "" })
};
globalThis.game ??= {
  user: {
    id: "user"
  }
};
globalThis.ui ??= {
  notifications: {
    warn() {}
  }
};

const MODULE_ID = "rebreya-main";

class TestRoll {
  constructor(formula, data = {}) {
    this.formula = String(formula ?? "");
    this.data = data;
    this.total = 0;
    this.dice = [{
      total: 0,
      results: []
    }];
  }

  evaluate() {
    this.total = TestRoll.queuedTotals.shift() ?? 20;
    this.dice[0].total = this.total;
    this.dice[0].results = [{ result: this.total, active: true }];
    return this;
  }

  async toMessage(messageData = {}) {
    TestRoll.messages.push({
      formula: this.formula,
      total: this.total,
      messageData
    });
    return messageData;
  }
}
TestRoll.queuedTotals = [];
TestRoll.messages = [];

globalThis.Roll = TestRoll;

const { CombatAttackService } = await import("../scripts/combat/attack-service.js");

function makeActor(items) {
  return {
    items: {
      contents: items,
      get: (id) => items.find((item) => item.id === id) ?? null
    }
  };
}

function makeFirearmItem({
  id = "pistol",
  name = "Пистолет",
  typeValue = "firearmPrimitive",
  properties = { lchFirearmMisfire: true },
  values = { misfire: 3 },
  jammed = null
} = {}) {
  const item = new class extends Item {
    constructor() {
      super();
      this.id = id;
      this.name = name;
      this.type = "weapon";
      this.system = {
        type: {
          value: typeValue
        },
        properties
      };
      this.flags = {
        [MODULE_ID]: {
          lichWeaponPropertyValues: values
        }
      };
      if (jammed) {
        this.flags[MODULE_ID].firearmJammed = jammed;
      }
    }

    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }

    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = value;
      return this;
    }

    async unsetFlag(scope, key) {
      delete this.flags?.[scope]?.[key];
      return this;
    }
  }();
  return item;
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

test("fighter dominance maneuvers retarget stale subtype-only owned items via activity source", () => {
  const dominanceItem = {
    id: "actualDominanceItemId",
    name: "Стиль доминирования",
    flags: {
      "rebreya-main": {
        featureId: "fighter-rework-v028::class::fighter-dominance"
      }
    },
    system: {
      identifier: "fighter-dominance",
      uses: {
        max: "@scale.fighter-rework-v028.dominance-dice"
      }
    }
  };
  const maneuverItem = {
    id: "maneuverItemId",
    name: "Атака с угрозой",
    system: {
      type: {
        value: "feat",
        subtype: "fighterManeuver"
      }
    }
  };
  const actor = makeActor([dominanceItem, maneuverItem]);
  maneuverItem.actor = actor;
  const updates = [];
  const activity = {
    type: "utility",
    actor,
    item: maneuverItem,
    consumption: {
      targets: [{
        type: "itemUses",
        target: "",
        value: "1",
        scaling: {
          mode: "",
          formula: ""
        }
      }]
    },
    range: {
      units: "self"
    },
    target: {
      affects: {
        type: "self"
      },
      prompt: false
    },
    updateSource(patch) {
      updates.push(patch);
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
  const usageConfig = {
    consume: {
      resources: [0]
    },
    hasConsumption: true
  };
  const messageConfig = {
    hasConsumption: true
  };

  const service = new CombatAttackService({});
  service.applyDnd5ePreUseActivity(activity, usageConfig, {}, messageConfig);

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0]["consumption.targets"], [{
    type: "itemUses",
    target: dominanceItem.id,
    value: "1",
    scaling: {
      mode: "",
      formula: ""
    }
  }]);
  assert.deepEqual(usageConfig.consume.resources, [0]);
  assert.equal(usageConfig.hasConsumption, true);
  assert.equal(messageConfig.hasConsumption, true);
  assert.equal(activity.target.affects.type, "creature");
  assert.equal(activity.target.prompt, true);
  assert.equal(activity.range.units, "");
});

test("firearm misfire rolls an extra d20 and jams the weapon before the attack", () => {
  TestRoll.queuedTotals = [2];
  TestRoll.messages = [];
  const weapon = makeFirearmItem();
  const activity = {
    id: "attack-1",
    type: "attack",
    actor: {
      id: "actor-a",
      name: "Стрелок",
      uuid: "Actor.actor-a"
    },
    item: weapon
  };
  const service = new CombatAttackService({});

  const result = service.applyDnd5eAttackRollConfig({ subject: activity }, {}, {});

  assert.equal(result, false);
  assert.equal(weapon.getFlag(MODULE_ID, "firearmJammed").value, true);
  assert.equal(weapon.getFlag(MODULE_ID, "firearmJammed").rollTotal, 2);
  assert.equal(TestRoll.messages.length, 1);
  assert.match(TestRoll.messages[0].messageData.flavor, /Осечка/u);
});

test("already jammed firearms cannot be used for attack activities", () => {
  const warnings = [];
  const previousWarn = globalThis.ui.notifications.warn;
  globalThis.ui.notifications.warn = (message) => warnings.push(message);
  try {
    const weapon = makeFirearmItem({
      jammed: {
        value: true,
        threshold: 3,
        rollTotal: 2
      }
    });
    const activity = {
      id: "attack-1",
      type: "attack",
      actor: {
        id: "actor-a",
        name: "Стрелок",
        uuid: "Actor.actor-a"
      },
      item: weapon
    };
    const service = new CombatAttackService({});

    const result = service.applyDnd5ePreUseActivity(activity);

    assert.equal(result, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /заклинено/u);
  }
  finally {
    globalThis.ui.notifications.warn = previousWarn;
  }
});
