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
  const updateCalls = [];
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

    async update(updates = {}) {
      updateCalls.push(updates);
      for (const [path, value] of Object.entries(updates)) {
        if (path === "name") {
          this.name = value;
        }
        else {
          foundry.utils.setProperty(this, path, value);
        }
      }
      return this;
    }
  }();
  item.updateCalls = updateCalls;
  return item;
}

function makeWeaponItem({
  id = "sword",
  name = "Sword",
  equipped = true,
  heldHands = [],
  handRequirement = null,
  properties = {},
  attackModes = []
} = {}) {
  return new class extends Item {
    constructor() {
      super();
      this.id = id;
      this.name = name;
      this.type = "weapon";
      this.system = {
        equipped,
        type: {
          value: "simpleM"
        },
        range: {
          units: "ft",
          reach: 5
        },
        properties,
        attackModes
      };
      this.flags = {
        [MODULE_ID]: {}
      };
      if (heldHands.length) {
        this.flags[MODULE_ID].heldHands = heldHands;
      }
      if (handRequirement) {
        this.flags[MODULE_ID].handRequirement = handRequirement;
      }
    }

    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  }();
}

test("weapon attack activities require the item to already be held in a hand", () => {
  const warnings = [];
  const previousWarn = globalThis.ui.notifications.warn;
  globalThis.ui.notifications.warn = (message) => warnings.push(message);
  try {
    const weapon = makeWeaponItem();
    const actor = makeActor([weapon]);
    weapon.actor = actor;
    const activity = {
      type: "attack",
      actor,
      item: weapon,
      attack: {
        type: {
          value: "melee"
        }
      },
      range: {}
    };

    const service = new CombatAttackService({});

    assert.equal(service.applyDnd5ePreUseActivity(activity), false);
    assert.match(warnings.at(-1), /возьмите предмет в руку/u);
  }
  finally {
    globalThis.ui.notifications.warn = previousWarn;
  }
});

test("weapon attack activities are allowed after the item was taken in hand", () => {
  const weapon = makeWeaponItem({ heldHands: ["right"] });
  const actor = makeActor([weapon]);
  weapon.actor = actor;
  const activity = {
    type: "attack",
    actor,
    item: weapon,
    attack: {
      type: {
        value: "melee"
      }
    },
    range: {}
  };

  const service = new CombatAttackService({});

  assert.equal(service.applyDnd5ePreUseActivity(activity), true);
});

test("two-handed weapon attacks can use a free second hand but not an occupied one", () => {
  const warnings = [];
  const previousWarn = globalThis.ui.notifications.warn;
  globalThis.ui.notifications.warn = (message) => warnings.push(message);
  try {
    const weapon = makeWeaponItem({
      heldHands: ["right"],
      properties: ["two"]
    });
    const actor = makeActor([weapon]);
    weapon.actor = actor;
    const activity = {
      type: "attack",
      actor,
      item: weapon,
      attack: {
        type: {
          value: "melee"
        }
      },
      range: {}
    };

    const service = new CombatAttackService({});

    assert.equal(service.applyDnd5ePreUseActivity(activity), true);
    assert.equal(warnings.length, 0);

    const occupiedWeapon = makeWeaponItem({
      id: "occupied-bow",
      heldHands: ["right"],
      properties: ["two"]
    });
    const offhandItem = makeWeaponItem({
      id: "offhand-item",
      heldHands: ["left"]
    });
    const occupiedActor = makeActor([occupiedWeapon, offhandItem]);
    occupiedWeapon.actor = occupiedActor;
    offhandItem.actor = occupiedActor;
    const blockedActivity = {
      type: "attack",
      actor: occupiedActor,
      item: occupiedWeapon,
      attack: {
        type: {
          value: "melee"
        }
      },
      range: {}
    };

    assert.equal(service.applyDnd5ePreUseActivity(blockedActivity), false);
    assert.match(warnings.at(-1), /2/u);
  }
  finally {
    globalThis.ui.notifications.warn = previousWarn;
  }
});

test("held versatile attacks leave midi attack mode untouched", () => {
  const weapon = makeWeaponItem({
    heldHands: ["left", "right"],
    handRequirement: {
      requiredHands: 1,
      allowedHands: [1, 2],
      versatile: true
    },
    properties: ["ver"],
    attackModes: [
      { value: "oneHanded", label: "One-Handed" },
      { value: "twoHanded", label: "Two-Handed" }
    ]
  });
  const actor = makeActor([weapon]);
  weapon.actor = actor;
  const activity = {
    id: "attack-activity",
    type: "attack",
    actor,
    item: weapon,
    attack: {
      type: {
        value: "melee"
      }
    },
    range: {}
  };
  const usageConfig = {
    midiOptions: {
      workflowOptions: {}
    },
    workflow: {
      workflowOptions: {}
    }
  };
  const config = { subject: activity };

  const service = new CombatAttackService({});

  assert.equal(service.applyDnd5ePreUseActivity(activity, usageConfig), true);
  assert.equal(service.applyDnd5eAttackRollConfig(config, {}, {}), true);
  assert.equal(usageConfig.attackMode, undefined);
  assert.deepEqual(usageConfig.midiOptions.workflowOptions, {});
  assert.equal(usageConfig.workflow.attackMode, undefined);
  assert.deepEqual(usageConfig.workflow.workflowOptions, {});
  assert.equal(config.attackMode, undefined);
  assert.equal(weapon.flags.dnd5e, undefined);
});

test("weapon usage cards keep a damage button for base weapon damage", () => {
  const weapon = makeWeaponItem({
    heldHands: ["left", "right"],
    handRequirement: {
      requiredHands: 1,
      allowedHands: [1, 2],
      versatile: true
    },
    properties: ["ver"],
    attackModes: [
      { value: "oneHanded", label: "One-Handed" },
      { value: "twoHanded", label: "Two-Handed" }
    ]
  });
  weapon.system.damage = {
    base: {
      formula: "1d8 + @mod"
    }
  };
  const actor = makeActor([weapon]);
  weapon.actor = actor;
  const activity = {
    id: "attack-activity",
    type: "attack",
    actor,
    item: weapon,
    damage: {
      includeBase: true,
      parts: []
    },
    attack: {
      type: {
        value: "melee"
      }
    },
    range: {},
    _usageChatButtons() {
      return [
        {
          label: "Attack",
          dataset: {
            action: "rollAttack"
          }
        }
      ];
    }
  };

  const service = new CombatAttackService({});

  assert.equal(service.applyDnd5ePreUseActivity(activity, {}), true);
  const buttons = activity._usageChatButtons({});
  assert.ok(buttons.some((button) => button?.dataset?.action === "rollDamage"));
});

test("weapon usage card damage button survives dnd5e activity replacement", () => {
  const weapon = makeWeaponItem({
    heldHands: ["left", "right"],
    handRequirement: {
      requiredHands: 1,
      allowedHands: [1, 2],
      versatile: true
    },
    properties: ["ver"],
    attackModes: [
      { value: "oneHanded", label: "One-Handed" },
      { value: "twoHanded", label: "Two-Handed" }
    ]
  });
  weapon.system.damage = {
    base: {
      formula: "1d8 + @mod"
    },
    versatile: {
      formula: "1d10"
    }
  };
  const actor = makeActor([weapon]);
  weapon.actor = actor;

  class ReplacementAttackActivity {
    constructor(item) {
      this.id = "attack-activity";
      this.type = "attack";
      this.actor = actor;
      this.item = item;
      this.damage = {
        includeBase: true,
        parts: []
      };
      this.attack = {
        type: {
          value: "melee"
        }
      };
      this.range = {};
    }

    _usageChatButtons() {
      return [
        {
          label: "Attack",
          dataset: {
            action: "rollAttack"
          }
        }
      ];
    }
  }

  const service = new CombatAttackService({});

  assert.equal(service.applyDnd5ePreUseActivity(new ReplacementAttackActivity(weapon), {}), true);
  const replacementButtons = new ReplacementAttackActivity(weapon)._usageChatButtons({});
  const damageButton = replacementButtons.find((button) => button?.dataset?.action === "rollDamage");
  assert.ok(damageButton);
  assert.equal(damageButton.dataset.attackMode, undefined);
});

test("pre-use held versatile attacks do not rewrite activity damage parts", () => {
  const weapon = makeWeaponItem({
    heldHands: ["left", "right"],
    handRequirement: {
      requiredHands: 1,
      allowedHands: [1, 2],
      versatile: true
    },
    properties: ["ver"],
    attackModes: [
      { value: "oneHanded", label: "One-Handed" },
      { value: "twoHanded", label: "Two-Handed" }
    ]
  });
  weapon.system.damage = {
    base: {
      number: 1,
      denomination: 10,
      bonus: "",
      types: new Set(["slashing"]),
      custom: {
        enabled: false,
        formula: ""
      },
      scaling: {
        mode: "",
        number: 1,
        formula: ""
      }
    },
    versatile: {
      number: 1,
      denomination: 10
    }
  };
  const actor = makeActor([weapon]);
  weapon.actor = actor;
  const staleBasePart = {
    base: true,
    locked: true,
    number: 1,
    denomination: 8,
    bonus: "",
    types: new Set(["slashing"]),
    custom: {
      enabled: false,
      formula: ""
    },
    scaling: {
      mode: "",
      number: 1,
      formula: ""
    }
  };
  Object.defineProperty(staleBasePart, "formula", {
    get() {
      return `${this.number}d${this.denomination}`;
    },
    enumerable: true
  });
  const activity = {
    id: "attack-activity",
    type: "attack",
    actor,
    item: weapon,
    damage: {
      includeBase: true,
      parts: [staleBasePart]
    },
    attack: {
      type: {
        value: "melee"
      }
    },
    range: {}
  };

  const service = new CombatAttackService({});

  assert.equal(service.applyDnd5ePreUseActivity(activity, {}), true);
  assert.equal(activity.damage.parts[0].number, 1);
  assert.equal(activity.damage.parts[0].denomination, 8);
  assert.equal(activity.damage.parts[0].formula, "1d8");
  assert.equal(activity.damage.parts[0].base, true);
  assert.equal(activity.damage.parts[0].locked, true);
});

test("held versatile damage roll config uses the item-provided base damage as-is", () => {
  const weapon = makeWeaponItem({
    heldHands: ["left", "right"],
    handRequirement: {
      requiredHands: 1,
      allowedHands: [1, 2],
      versatile: true
    },
    properties: ["ver"],
    attackModes: [
      { value: "oneHanded", label: "One-Handed" },
      { value: "twoHanded", label: "Two-Handed" }
    ]
  });
  weapon.system.damage = {
    base: {
      number: 1,
      denomination: 8
    },
    versatile: {
      number: 1,
      denomination: 10
    }
  };
  const actor = makeActor([weapon]);
  weapon.actor = actor;
  const activity = {
    id: "attack-activity",
    type: "attack",
    actor,
    item: weapon,
    attack: {
      type: {
        value: "melee"
      }
    },
    range: {}
  };
  const config = {
    subject: activity,
    rolls: [
      {
        base: true,
        parts: ["1d8", "@mod"],
        data: {}
      }
    ]
  };

  const service = new CombatAttackService({});

  assert.equal(service.applyDnd5eDamageRollConfig(config, {}, {}), true);
  assert.equal(config.attackMode, undefined);
  assert.deepEqual(config.rolls[0].parts, ["1d8", "@mod"]);
});

test("standalone held versatile sheet attacks do not roll separate damage", async () => {
  const weapon = makeWeaponItem({
    heldHands: ["left", "right"],
    handRequirement: {
      requiredHands: 1,
      allowedHands: [1, 2],
      versatile: true
    },
    properties: ["ver"],
    attackModes: [
      { value: "oneHanded", label: "One-Handed" },
      { value: "twoHanded", label: "Two-Handed" }
    ]
  });
  weapon.system.damage = {
    base: {
      number: 1,
      denomination: 8
    },
    versatile: {
      number: 1,
      denomination: 10
    }
  };
  const actor = makeActor([weapon]);
  weapon.actor = actor;
  let damageCall = null;
  const activity = {
    id: "attack-activity",
    type: "attack",
    actor,
    item: weapon,
    attack: {
      type: {
        value: "melee"
      }
    },
    range: {},
    async rollDamage(config = {}, dialog = {}, message = {}) {
      damageCall = { config, dialog, message };
      return [];
    }
  };
  const roll = {
    formula: "1d20 + 10",
    total: 24,
    isFumble: false,
    options: {}
  };

  const service = new CombatAttackService({});

  assert.equal(service.applyDnd5ePostAttackRoll([roll], { subject: activity }), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(damageCall, null);
});

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
  const weapon = makeFirearmItem({ name: "Пистолет" });
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
  assert.equal(weapon.name, "Пистолет (клин)");
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

test("clearing firearm jam removes jam suffix and raises current misfire by one", async () => {
  const weapon = makeFirearmItem({
    name: "Мушкет (клин)",
    jammed: {
      value: true,
      threshold: 3,
      rollTotal: 2
    }
  });
  const service = new CombatAttackService({});

  const result = await service.clearFirearmJam(weapon);

  assert.equal(result.isJammed, false);
  assert.equal(result.previousMisfire, 3);
  assert.equal(result.currentMisfire, 4);
  assert.equal(weapon.name, "Мушкет");
  assert.equal(weapon.getFlag(MODULE_ID, "firearmJammed"), undefined);
  assert.equal(weapon.getFlag(MODULE_ID, "firearmMisfire"), 4);
});

test("clearing firearm jam caps current misfire at ten", async () => {
  const weapon = makeFirearmItem({
    name: "Мушкет (клин)",
    values: { misfire: 9 },
    jammed: {
      value: true,
      threshold: 9,
      rollTotal: 3
    }
  });
  const service = new CombatAttackService({});

  await service.clearFirearmJam(weapon);
  await service.clearFirearmJam(weapon);

  assert.equal(weapon.getFlag(MODULE_ID, "firearmMisfire"), 10);
});

test("maintaining firearm restores base misfire after successful tinker check", async () => {
  const weapon = makeFirearmItem({
    name: "Мушкет",
    values: { misfire: 3 }
  });
  weapon.flags[MODULE_ID].firearmMisfire = 6;
  weapon.flags[MODULE_ID].firearmBaseMisfire = 3;
  const service = new CombatAttackService({});

  const result = await service.maintainFirearm(weapon, null, {
    firearmMaintenanceTotal: 16
  });

  assert.equal(result.success, true);
  assert.equal(result.dc, 16);
  assert.equal(result.currentMisfire, 3);
  assert.equal(weapon.getFlag(MODULE_ID, "firearmMisfire"), undefined);
  assert.equal(weapon.getFlag(MODULE_ID, "firearmBaseMisfire"), undefined);
});

test("maintaining firearm rolls tinker tools with the better dex or int ability", async () => {
  const weapon = makeFirearmItem({
    name: "Мушкет",
    values: { misfire: 4 }
  });
  weapon.flags[MODULE_ID].firearmMisfire = 5;
  const calls = [];
  const actor = new class extends Actor {
    constructor() {
      super();
      this.system = {
        abilities: {
          dex: { mod: 1 },
          int: { mod: 4 }
        }
      };
    }

    async rollToolCheck(config = {}, dialog = {}, message = {}) {
      calls.push({ config, dialog, message });
      if (!config || typeof config !== "object" || typeof config.tool !== "string") {
        throw new Error("Expected dnd5e rollToolCheck config object.");
      }
      return [{ total: 20 }];
    }
  }();
  weapon.actor = actor;
  const service = new CombatAttackService({});
  const previousConfig = globalThis.CONFIG;
  globalThis.CONFIG = {
    DND5E: {
      tools: { tinker: {} },
      vehicleTypes: {}
    }
  };

  try {
    const result = await service.maintainFirearm(weapon);

    assert.equal(result.success, true);
    assert.equal(calls[0].config.tool, "tinker");
    assert.equal(calls[0].config.ability, "int");
    assert.equal(calls[0].config.dc, 15);
  }
  finally {
    globalThis.CONFIG = previousConfig;
  }
});
