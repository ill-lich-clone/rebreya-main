import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {
  utils: {
    getProperty: (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object),
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
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
globalThis.ChatMessage.messages ??= [];
globalThis.ChatMessage.create ??= async (messageData = {}) => {
  globalThis.ChatMessage.messages.push(messageData);
  return messageData;
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
const { ReactionQueueService } = await import("../scripts/combat/reaction-queue-service.js");

function makeActor(items, {
  id = "actor-a",
  name = "Стрелок",
  abilities = {
    str: { mod: 1 },
    dex: { mod: 3 },
    int: { mod: 0 }
  },
  prof = 2
} = {}) {
  const actor = new class extends Actor {
    constructor() {
      super();
      this.id = id;
      this.name = name;
      this.uuid = `Actor.${id}`;
      this.system = {
        abilities,
        attributes: {
          prof
        }
      };
      this.flags = {
        [MODULE_ID]: {}
      };
      this.items = {
        contents: items,
        get: (itemId) => items.find((item) => item.id === itemId) ?? null
      };
    }

    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  }();

  for (const item of items) {
    if (item && typeof item === "object") {
      item.actor = actor;
      item.parent = actor;
    }
  }

  return actor;
}

function makeFirearmItem({
  id = "pistol",
  name = "Пистолет",
  typeValue = "firearmPrimitive",
  properties = { lchFirearmMisfire: true },
  values = { misfire: 3 },
  weight = 3,
  ammoState = null,
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
        weight: {
          value: weight,
          units: "lb"
        },
        properties
      };
      this.flags = {
        [MODULE_ID]: {
          lichWeaponPropertyValues: values
        }
      };
      if (ammoState) {
        this.flags[MODULE_ID].firearmAmmoState = ammoState;
      }
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

function makeAmmoItem({
  id = "ammo",
  name = "Винтовочный патрон",
  quantity = 30,
  subtype = "firearmBullet"
} = {}) {
  const updateCalls = [];
  const item = new class extends Item {
    constructor() {
      super();
      this.id = id;
      this.name = name;
      this.type = "consumable";
      this.system = {
        type: {
          value: "ammo",
          subtype
        },
        quantity
      };
      this.flags = {
        [MODULE_ID]: {}
      };
    }

    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
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
  attackModes = [],
  deferUpdateMutation = false
} = {}) {
  const updateCalls = [];
  const item = new class extends Item {
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

    async update(updates, options = {}) {
      options.parent = this.actor ?? null;
      updateCalls.push({ updates, options });
      const applyUpdates = () => {
        for (const [path, value] of Object.entries(updates)) {
          foundry.utils.setProperty(this, path, value);
        }
      };
      if (deferUpdateMutation) {
        await Promise.resolve();
        applyUpdates();
      }
      else {
        applyUpdates();
      }
      return this;
    }
  }();
  item.updateCalls = updateCalls;
  return item;
}

test("weapon attack activities automatically take an unused item in the left hand", async () => {
  const warnings = [];
  const previousWarn = globalThis.ui.notifications.warn;
  const previousHooks = globalThis.Hooks;
  const hookCalls = [];
  globalThis.ui.notifications.warn = (message) => warnings.push(message);
  globalThis.Hooks = {
    callAll(name, payload) {
      hookCalls.push({ name, payload });
    }
  };
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

    assert.equal(service.applyDnd5ePreUseActivity(activity), true);
    await Promise.resolve();
    assert.deepEqual(weapon.updateCalls.at(-1), {
      updates: {
        "system.equipped": true,
        "flags.rebreya-main.heldHands": ["left"]
      },
      options: { render: false, parent: actor }
    });
    assert.deepEqual(weapon.flags[MODULE_ID].heldHands, ["left"]);
    assert.equal(hookCalls.at(-1)?.name, "rebreya-main.heldItemUpdated");
    assert.equal(hookCalls.at(-1)?.payload.actor, actor);
    assert.equal(hookCalls.at(-1)?.payload.item, weapon);
    assert.equal(hookCalls.at(-1)?.payload.itemId, weapon.id);
    assert.equal(warnings.length, 0);
  }
  finally {
    globalThis.ui.notifications.warn = previousWarn;
    globalThis.Hooks = previousHooks;
  }
});

test("weapon attack activities mark auto-held items before activity use continues", async () => {
  const weapon = makeWeaponItem({ deferUpdateMutation: true });
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
  assert.equal(weapon.system.equipped, true);
  assert.deepEqual(weapon.flags[MODULE_ID].heldHands, ["left"]);
  await Promise.resolve();
});

test("Runic Juggernaut reach comes only from its active Huge form and only affects melee", () => {
  const weapon = makeWeaponItem({ heldHands: ["left"] });
  const actor = makeActor([weapon]);
  actor.effects = [{
    id: "giant-form",
    disabled: false,
    flags: {
      [MODULE_ID]: {
        runeKnight: {
          automation: "giant-might-form",
          reachBonus: 5,
          form: { appliedActorSize: "huge" }
        }
      }
    }
  }];
  const melee = {
    type: "attack",
    actor,
    item: weapon,
    attack: { type: { value: "melee" } },
    range: {}
  };
  const ranged = {
    type: "attack",
    actor,
    item: weapon,
    attack: { type: { value: "ranged" } },
    range: {}
  };
  const service = new CombatAttackService({});

  assert.equal(service.applyDnd5ePreUseActivity(melee), true);
  assert.equal(melee.range.reach, 10);
  assert.equal(weapon.system.range.reach, 5);
  assert.equal(service.applyDnd5ePreUseActivity(ranged), true);
  assert.equal(ranged.range.reach, undefined);

  actor.effects[0].disabled = true;
  const inactive = {
    type: "attack",
    actor,
    item: weapon,
    attack: { type: { value: "melee" } },
    range: {}
  };
  assert.equal(service.applyDnd5ePreUseActivity(inactive), true);
  assert.equal(inactive.range.reach, undefined);
});

test("two-handed weapon attack auto-holds the item in one hand and uses a free hand for the attack", async () => {
  const weapon = makeWeaponItem({
    deferUpdateMutation: true,
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
        value: "ranged"
      }
    },
    range: {}
  };

  const service = new CombatAttackService({});

  assert.equal(service.applyDnd5ePreUseActivity(activity), true);
  assert.deepEqual(weapon.updateCalls.at(-1), {
    updates: {
      "system.equipped": true,
      "flags.rebreya-main.heldHands": ["left"]
    },
    options: { render: false, parent: actor }
  });
  assert.deepEqual(weapon.flags[MODULE_ID].heldHands, ["left"]);
  await Promise.resolve();
});

test("auto-held weapon activities refresh prepared base damage before usage card buttons", async () => {
  const weapon = makeWeaponItem({ deferUpdateMutation: true });
  const actor = makeActor([weapon]);
  weapon.actor = actor;
  weapon.system.offersBaseDamage = true;
  weapon.system.damage = {
    base: {
      formula: "1d8 + 10"
    }
  };
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
      const buttons = [
        {
          label: "Attack",
          dataset: {
            action: "rollAttack"
          }
        }
      ];
      if (this.damage.parts.length) {
        buttons.push({
          label: "Damage",
          dataset: {
            action: "rollDamage"
          }
        });
      }
      return buttons;
    }
  };
  weapon.system.activities = {
    get(id) {
      return id === activity.id ? activity : null;
    }
  };
  weapon.prepareDataCalls = 0;
  weapon.prepareData = () => {
    weapon.prepareDataCalls += 1;
    activity.damage.parts = [
      {
        formula: weapon.system.damage.base.formula,
        base: true,
        locked: true
      }
    ];
  };

  const service = new CombatAttackService({});

  assert.equal(service.applyDnd5ePreUseActivity(activity), true);
  assert.equal(weapon.prepareDataCalls, 1);
  const buttons = activity._usageChatButtons({});
  assert.ok(buttons.some((button) => button?.dataset?.action === "rollDamage"));
  await Promise.resolve();
});

test("auto-held weapon activities run final dnd5e preparation before midi builds the first card", async () => {
  const weapon = makeWeaponItem({ deferUpdateMutation: true });
  const actor = makeActor([weapon]);
  weapon.actor = actor;
  weapon.system.offersBaseDamage = true;
  weapon.system.damage = {
    base: {
      formula: "1d8 + 10"
    }
  };
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
    range: {}
  };
  weapon.system.activities = {
    get(id) {
      return id === activity.id ? activity : null;
    }
  };
  weapon.prepareDataCalls = 0;
  weapon.prepareFinalAttributesCalls = 0;
  weapon.prepareData = () => {
    weapon.prepareDataCalls += 1;
  };
  weapon.prepareFinalAttributes = () => {
    weapon.prepareFinalAttributesCalls += 1;
    activity.damage.parts = [
      {
        formula: weapon.system.damage.base.formula,
        base: true,
        locked: true
      }
    ];
  };

  const service = new CombatAttackService({});

  assert.equal(service.applyDnd5ePreUseActivity(activity), true);
  assert.equal(weapon.prepareDataCalls, 1);
  assert.equal(weapon.prepareFinalAttributesCalls, 1);
  assert.deepEqual(activity.damage.parts, [
    {
      formula: "1d8 + 10",
      base: true,
      locked: true
    }
  ]);
  await Promise.resolve();
});

test("weapon attack activities warn when an unused item cannot find a free hand", async () => {
  const warnings = [];
  const previousWarn = globalThis.ui.notifications.warn;
  globalThis.ui.notifications.warn = (message) => warnings.push(message);
  try {
    const weapon = makeWeaponItem({ id: "sword" });
    const torch = makeWeaponItem({ id: "torch", heldHands: ["left"] });
    const shield = makeWeaponItem({ id: "shield", heldHands: ["right"] });
    const actor = makeActor([weapon, torch, shield]);
    weapon.actor = actor;
    torch.actor = actor;
    shield.actor = actor;
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
    assert.equal(weapon.updateCalls.length, 0);
    assert.match(warnings.at(-1), /нет свободных рук/u);
  }
  finally {
    globalThis.ui.notifications.warn = previousWarn;
  }
});

test("weapon attack activities are allowed after the item was taken in hand", async () => {
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

  assert.equal(await service.applyDnd5ePreUseActivity(activity), true);
});

test("natural weapon attack activities do not require held hands", async () => {
  const warnings = [];
  const previousWarn = globalThis.ui.notifications.warn;
  globalThis.ui.notifications.warn = (message) => warnings.push(message);
  try {
    const weapon = makeWeaponItem({
      properties: ["two"]
    });
    weapon.system.type.value = "natural";
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

    assert.equal(await service.applyDnd5ePreUseActivity(activity), true);
    assert.equal(warnings.length, 0);
  }
  finally {
    globalThis.ui.notifications.warn = previousWarn;
  }
});

test("two-handed weapon attacks can use a free second hand but not an occupied one", async () => {
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

    assert.equal(await service.applyDnd5ePreUseActivity(activity), true);
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
    assert.match(warnings.at(-1), /нет свободных рук/u);
  }
  finally {
    globalThis.ui.notifications.warn = previousWarn;
  }
});

test("held versatile attacks leave midi attack mode untouched", async () => {
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

  assert.equal(await service.applyDnd5ePreUseActivity(activity, usageConfig), true);
  assert.equal(service.applyDnd5eAttackRollConfig(config, {}, {}), true);
  assert.equal(usageConfig.attackMode, undefined);
  assert.deepEqual(usageConfig.midiOptions.workflowOptions, {});
  assert.equal(usageConfig.workflow.attackMode, undefined);
  assert.deepEqual(usageConfig.workflow.workflowOptions, {});
  assert.equal(config.attackMode, undefined);
  assert.equal(weapon.flags.dnd5e, undefined);
});

test("weapon usage cards keep a damage button for base weapon damage", async () => {
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

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {}), true);
  const buttons = activity._usageChatButtons({});
  assert.ok(buttons.some((button) => button?.dataset?.action === "rollDamage"));
});

test("weapon usage card damage button survives dnd5e activity replacement", async () => {
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

  assert.equal(await service.applyDnd5ePreUseActivity(new ReplacementAttackActivity(weapon), {}), true);
  const replacementButtons = new ReplacementAttackActivity(weapon)._usageChatButtons({});
  const damageButton = replacementButtons.find((button) => button?.dataset?.action === "rollDamage");
  assert.ok(damageButton);
  assert.equal(damageButton.dataset.attackMode, undefined);
});

test("pre-use held versatile attacks do not rewrite activity damage parts", async () => {
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

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {}), true);
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

test("fighter dominance maneuvers retarget shared dominance dice item and creature targeting before use", async () => {
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
  await service.applyDnd5ePreUseActivity(activity);

  assert.equal(target.target, dominanceItem.id);
  assert.equal(activity.target.affects.type, "creature");
  assert.equal(activity.target.prompt, true);
  assert.equal(activity.range.units, "");
});

test("fighter dominance maneuvers retarget blank or own-item use consumption before use", async () => {
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
  await service.applyDnd5ePreUseActivity(activity);

  assert.equal(blankTarget.target, dominanceItem.id);
  assert.equal(ownItemTarget.target, dominanceItem.id);
  assert.equal(activityUsesTarget.type, "itemUses");
  assert.equal(activityUsesTarget.target, dominanceItem.id);
});

test("fighter dominance maneuvers retarget stale subtype-only owned items via activity source", async () => {
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
  await service.applyDnd5ePreUseActivity(activity, usageConfig, {}, messageConfig);

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

test("firearm attack activities disable dnd5e item ammunition consumption before sheet use", async () => {
  const weapon = makeFirearmItem({
    name: "Автоматическая винтовка",
    typeValue: "firearmAdvanced",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmReload: true
    },
    values: {
      ammunition: "Винтовочный",
      reload: "Смена магазина 24"
    },
    ammoState: {
      current: 24,
      capacity: 24,
      ammunition: "Винтовочный"
    }
  });
  weapon.flags[MODULE_ID].heldHands = ["right"];
  const ammo = makeAmmoItem({
    id: "rifle-ammo",
    name: "Винтовочный патрон",
    quantity: 236
  });
  const actor = makeActor([weapon, ammo]);
  const updates = [];
  const activity = {
    type: "attack",
    actor,
    item: weapon,
    attack: {
      type: {
        value: "firearm"
      }
    },
    consumption: {
      targets: [{
        type: "itemUses",
        target: ammo.id,
        value: "1",
        scaling: {
          mode: "",
          formula: ""
        }
      }]
    },
    range: {},
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

  const result = await service.applyDnd5ePreUseActivity(activity, usageConfig, {}, messageConfig);

  assert.equal(result, true);
  assert.deepEqual(updates.at(-1), { "consumption.targets": [] });
  assert.deepEqual(activity.consumption.targets, []);
  assert.deepEqual(usageConfig.consume.resources, []);
  assert.equal(usageConfig.hasConsumption, false);
  assert.equal(messageConfig.hasConsumption, false);
  assert.equal(ammo.system.quantity, 236);
  assert.equal(ammo.updateCalls.length, 0);
});

test("empty firearm magazines should stop native activity use before an attack roll workflow starts", async () => {
  TestRoll.queuedTotals = [15];
  const weapon = makeFirearmItem({
    name: "Револьвер",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmReload: true
    },
    values: {
      ammunition: "Пистолетные",
      reload: "Смена магазина 6"
    },
    ammoState: {
      current: 0,
      capacity: 6,
      ammunition: "Пистолетные"
    }
  });
  weapon.flags[MODULE_ID].heldHands = ["right"];
  const actor = makeActor([weapon]);
  const activity = {
    id: "attack-1",
    type: "attack",
    actor,
    item: weapon,
    activation: {
      type: "action",
      value: 1
    },
    attack: {
      type: {
        value: "firearm"
      }
    },
    consumption: {
      targets: []
    },
    range: {}
  };
  const service = new CombatAttackService({});

  const result = await service.applyDnd5ePreUseActivity(activity, {}, {}, {});

  assert.equal(result, false);
  assert.equal(weapon.getFlag(MODULE_ID, "firearmAmmoState").current, 0);
  assert.equal(TestRoll.queuedTotals.length, 1);
});

test("empty firearm magazines are reported unavailable for activity sheet badges", () => {
  TestRoll.queuedTotals = [15];
  const weapon = makeFirearmItem({
    name: "Р РµРІРѕР»СЊРІРµСЂ",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmReload: true
    },
    values: {
      ammunition: "РџРёСЃС‚РѕР»РµС‚РЅС‹Рµ",
      reload: "РЎРјРµРЅР° РјР°РіР°Р·РёРЅР° 6"
    },
    ammoState: {
      current: 0,
      capacity: 6,
      ammunition: "РџРёСЃС‚РѕР»РµС‚РЅС‹Рµ"
    }
  });
  weapon.flags[MODULE_ID].heldHands = ["right"];
  const actor = makeActor([weapon]);
  const activity = {
    id: "attack-1",
    type: "attack",
    actor,
    item: weapon,
    activation: {
      type: "action",
      value: 1
    },
    attack: {
      type: {
        value: "firearm"
      }
    },
    consumption: {
      targets: []
    },
    range: {}
  };
  const service = new CombatAttackService({});

  const result = service.getActivityAvailability(activity);

  assert.equal(result.available, false);
  assert.equal(result.label, "Недоступно");
  assert.equal(result.reason, "firearmAmmoEmpty");
  assert.equal(weapon.getFlag(MODULE_ID, "firearmAmmoState").current, 0);
  assert.equal(TestRoll.queuedTotals.length, 1);
});

test("empty firearm magazines should not be first cancelled inside attack roll config", () => {
  TestRoll.queuedTotals = [15];
  const weapon = makeFirearmItem({
    name: "Револьвер",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmReload: true
    },
    values: {
      ammunition: "Пистолетные",
      reload: "Смена магазина 6"
    },
    ammoState: {
      current: 0,
      capacity: 6,
      ammunition: "Пистолетные"
    }
  });
  const actor = makeActor([weapon]);
  const activity = {
    id: "attack-1",
    type: "attack",
    actor,
    item: weapon,
    activation: {
      type: "action",
      value: 1
    },
    attack: {
      type: {
        value: "firearm"
      }
    }
  };
  const service = new CombatAttackService({});

  const result = service.applyDnd5eAttackRollConfig({ subject: activity }, {}, {});

  assert.equal(result, true);
  assert.equal(weapon.getFlag(MODULE_ID, "firearmAmmoState").current, 0);
  assert.equal(TestRoll.queuedTotals.length, 1);
});

test("firearm area fire activities continue native save workflow after spending loaded ammo", async () => {
  globalThis.ChatMessage.messages = [];
  const weapon = makeFirearmItem({
    name: "Automatic Rifle",
    typeValue: "firearmAdvanced",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmFireMode: true,
      lchFirearmAutomatic: true,
      lchFirearmReload: true
    },
    values: {
      ammunition: "Rifle",
      fireMode: "Automatic (4d8)",
      automaticDamage: "4d8",
      reload: "Magazine 24"
    },
    ammoState: {
      current: 12,
      capacity: 24,
      ammunition: "Rifle"
    }
  });
  const actor = makeActor([weapon]);
  const activity = {
    type: "save",
    actor,
    item: weapon,
    flags: {
      [MODULE_ID]: {
        automation: "firearm-automatic-fire"
      }
    },
    target: {
      template: {
        type: "cone",
        size: 45
      },
      affects: {
        type: "creature"
      },
      prompt: true
    }
  };
  const service = new CombatAttackService({});

  const result = await service.applyDnd5ePreUseActivity(activity, {}, {}, {});

  assert.equal(result, true);
  assert.equal(weapon.getFlag(MODULE_ID, "firearmAmmoState").current, 0);
  assert.equal(activity.target.template.type, "cone");
  assert.equal(activity.target.prompt, true);
  assert.equal(globalThis.ChatMessage.messages.some((message) => String(message.content ?? "").includes("4d8")), false);
});

test("firearm actor repair removes jam maintenance activities from weapons without misfire", async () => {
  const shotActivity = {
    _id: "shot",
    type: "attack",
    name: "Выстрел"
  };
  const automaticFireActivity = {
    _id: "automatic-fire",
    type: "utility",
    name: "Автоматический огонь",
    flags: {
      [MODULE_ID]: {
        automation: "firearm-automatic-fire"
      }
    }
  };
  const weapon = makeFirearmItem({
    name: "Автоматическая винтовка",
    typeValue: "firearmAdvanced",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmReload: true,
      lchFirearmAutomatic: true,
      lchFirearmMisfire: true
    },
    values: {
      automaticDamage: "4d8",
      misfire: 2,
      ammunition: "Винтовочный",
      reload: "Смена магазина 24"
    }
  });
  weapon.flags[MODULE_ID].gearId = "avtomaticheskaya-vintovka";
  weapon.system.damage = {
    base: {
      types: ["piercing"]
    }
  };
  weapon.system.activities = {
    [shotActivity._id]: shotActivity,
    lchClearBreech01: {
      _id: "lchClearBreech01",
      type: "utility",
      name: "Очистить затвор",
      flags: {
        [MODULE_ID]: {
          automation: "firearm-clear-jam"
        }
      }
    },
    [automaticFireActivity._id]: automaticFireActivity,
    lchMaintainGun01: {
      _id: "lchMaintainGun01",
      type: "utility",
      name: "Привести оружие в порядок",
      flags: {
        [MODULE_ID]: {
          automation: "firearm-maintain"
        }
      }
    }
  };
  const actor = makeActor([weapon]);
  const service = new CombatAttackService({
    repository: {
      model: {
        gearById: new Map([[
          "avtomaticheskaya-vintovka",
          {
            weapon: {
              properties: ["lchFirearmAutomatic"],
              lichWeaponPropertyValues: {
                automaticDamage: "4d8"
              }
            }
          }
        ]])
      }
    }
  });

  const result = await service.repairFirearmActivities(actor);

  assert.equal(result.updated, 1);
  assert.equal(result.removed, 2);
  assert.equal(result.upgraded, 1);
  assert.deepEqual(Object.keys(weapon.system.activities).sort(), ["automatic-fire", "shot"]);
  const repairedAutomaticFire = weapon.updateCalls.at(-1)["system.activities"][automaticFireActivity._id];
  assert.equal(repairedAutomaticFire.type, "save");
  assert.equal(repairedAutomaticFire.target.template.type, "cone");
  assert.equal(repairedAutomaticFire.target.template.size, 45);
  assert.equal(repairedAutomaticFire.target.prompt, true);
  assert.equal(repairedAutomaticFire.damage.onSave, "half");
  assert.equal(repairedAutomaticFire.damage.parts[0].number, 4);
  assert.equal(repairedAutomaticFire.damage.parts[0].denomination, 8);
  assert.deepEqual(repairedAutomaticFire.damage.parts[0].types, ["piercing"]);
  assert.deepEqual(weapon.updateCalls.at(-1)["system.activities"][shotActivity._id], shotActivity);
});

test("firearm activity repair writes plain source data for unchanged activity documents", async () => {
  const shotSource = {
    _id: "shot",
    type: "attack",
    name: "Выстрел",
    activation: {
      type: "action",
      value: 1
    },
    attack: {
      type: {
        value: "firearm"
      }
    }
  };
  const shotActivityDocument = {
    ...shotSource,
    id: "shot",
    _inferredSource: { stale: true },
    toObject() {
      return { ...shotSource };
    }
  };
  const weapon = makeFirearmItem({
    name: "Automatic Rifle",
    typeValue: "firearmAdvanced",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmReload: true,
      lchFirearmAutomatic: true,
      lchFirearmMisfire: true
    },
    values: {
      automaticDamage: "4d8",
      ammunition: "Rifle",
      reload: "Magazine 24"
    }
  });
  weapon.system.activities = new Map([
    ["shot", shotActivityDocument],
    ["lchClearBreech01", {
      _id: "lchClearBreech01",
      type: "utility",
      name: "Clear Breech",
      flags: {
        [MODULE_ID]: {
          automation: "firearm-clear-jam"
        }
      }
    }]
  ]);
  const actor = makeActor([weapon]);
  const service = new CombatAttackService({});

  await service.repairFirearmActivities(actor);

  const repairedShot = weapon.updateCalls.at(-1)["system.activities"].shot;
  assert.notEqual(repairedShot, shotActivityDocument);
  assert.deepEqual(repairedShot, shotSource);
  assert.equal("_inferredSource" in repairedShot, false);
});

test("firearm item repair removes stale jam maintenance activities from item sheets", async () => {
  const weapon = makeFirearmItem({
    name: "Automatic Rifle",
    typeValue: "firearmAdvanced",
    properties: {
      lchFirearmAutomatic: true,
      lchFirearmMisfire: true
    },
    values: {
      automaticDamage: "4d8"
    }
  });
  weapon.system.activities = {
    lchClearBreech01: {
      _id: "lchClearBreech01",
      type: "utility",
      name: "Clear Breech",
      flags: {
        [MODULE_ID]: {
          automation: "firearm-clear-jam"
        }
      }
    },
    lchMaintainGun01: {
      _id: "lchMaintainGun01",
      type: "utility",
      name: "Maintain Firearm",
      flags: {
        [MODULE_ID]: {
          automation: "firearm-maintain"
        }
      }
    }
  };
  const service = new CombatAttackService({});

  const result = await service.repairFirearmActivities(weapon);

  assert.equal(result.updated, 1);
  assert.equal(result.removed, 2);
  assert.deepEqual(weapon.updateCalls.at(-1), {
    "system.activities": {}
  });
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

test("firearm attack roll notes ammo and misfire in the originating attack card", () => {
  TestRoll.queuedTotals = [13];
  TestRoll.messages = [];
  globalThis.ChatMessage.messages = [];
  const cardMessage = {
    id: "card-a",
    content: `
      <div class="chat-card activation-card">
        <div class="card-buttons"><button type="button" data-action="rollAttack">Attack</button></div>
        <ul class="card-footer pills unlist"></ul>
      </div>
    `,
    updateCalls: [],
    update(update = {}) {
      this.updateCalls.push(update);
      if (typeof update.content === "string") {
        this.content = update.content;
      }
      return this;
    }
  };
  globalThis.game.messages = new Map([["card-a", cardMessage]]);
  const weapon = makeFirearmItem({
    name: "Musket",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmReload: true,
      lchFirearmMisfire: true
    },
    values: {
      ammunition: "Musket",
      reload: "Reload 1",
      misfire: 2
    },
    ammoState: {
      current: 1,
      capacity: 1,
      ammunition: "Musket"
    }
  });
  const actor = makeActor([weapon]);
  const activity = {
    id: "attack-1",
    type: "attack",
    actor,
    item: weapon,
    attack: {
      type: {
        value: "firearm"
      }
    }
  };
  const messageConfig = {
    data: {
      flags: {
        dnd5e: {
          originatingMessage: "card-a"
        }
      }
    }
  };
  const service = new CombatAttackService({});

  const result = service.applyDnd5eAttackRollConfig({ subject: activity }, {}, messageConfig);

  assert.equal(result, true);
  assert.equal(weapon.getFlag(MODULE_ID, "firearmAmmoState").current, 0);
  assert.equal(globalThis.ChatMessage.messages.length, 0);
  assert.equal(TestRoll.messages.length, 0);
  assert.match(messageConfig.data.flavor, /Musket \(0\/1\)/u);
  assert.match(messageConfig.data.flavor, /d20 = 13/u);
  assert.match(cardMessage.content, /data-rebreya-firearm-chat-notes/u);
  assert.match(cardMessage.content, /Musket \(0\/1\)/u);
  assert.match(cardMessage.content, /d20 = 13/u);
});

test("already jammed firearms cannot be used for attack activities", async () => {
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

test("firearm attacks spend loaded ammunition and mark an empty magazine in the weapon name", async () => {
  TestRoll.queuedTotals = [15];
  TestRoll.messages = [];
  globalThis.ChatMessage.messages = [];
  const weapon = makeFirearmItem({
    name: "Пистолет",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmFireMode: true,
      lchFirearmReload: true
    },
    values: {
      ammunition: "Пистолетные",
      fireMode: "Одиночные",
      reload: "Смена магазина 1"
    },
    ammoState: {
      current: 1,
      capacity: 1,
      ammunition: "Пистолетные"
    }
  });
  const actor = makeActor([weapon]);
  const service = new CombatAttackService({});

  const result = await service.rollFirearmAttack(actor, weapon, { createMessage: false });

  assert.equal(result.breakdown.abilityKey, "dex");
  assert.equal(weapon.getFlag(MODULE_ID, "firearmAmmoState").current, 0);
  assert.match(weapon.name, /0\/1/u);
  assert.doesNotMatch(weapon.name, /пуст|боезапас/iu);
  assert.equal(TestRoll.queuedTotals.length, 0);
});

test("firearm attacks use dexterity at exactly ten pounds and strength above ten pounds", async () => {
  TestRoll.queuedTotals = [15, 15];
  TestRoll.messages = [];
  const service = new CombatAttackService({});

  const tenPoundWeapon = makeFirearmItem({
    name: "Ten Pound Firearm",
    weight: 10
  });
  const tenPoundActor = makeActor([tenPoundWeapon]);
  const tenPoundResult = await service.rollFirearmAttack(tenPoundActor, tenPoundWeapon, { createMessage: false });

  const heavyWeapon = makeFirearmItem({
    name: "Heavy Firearm",
    weight: 10.01
  });
  const heavyActor = makeActor([heavyWeapon]);
  const heavyResult = await service.rollFirearmAttack(heavyActor, heavyWeapon, { createMessage: false });

  assert.equal(tenPoundResult.breakdown.abilityKey, "dex");
  assert.equal(heavyResult.breakdown.abilityKey, "str");
});

test("empty firearm magazines block firearm attacks before the attack roll", async () => {
  TestRoll.queuedTotals = [15];
  TestRoll.messages = [];
  const weapon = makeFirearmItem({
    name: "Револьвер",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmReload: true
    },
    values: {
      ammunition: "Пистолетные",
      fireMode: "Одиночные",
      reload: "Смена магазина 6"
    },
    ammoState: {
      current: 0,
      capacity: 6,
      ammunition: "Пистолетные"
    }
  });
  const actor = makeActor([weapon]);
  const service = new CombatAttackService({});

  const result = await service.rollFirearmAttack(actor, weapon, { createMessage: false });

  assert.equal(result.success, false);
  assert.equal(result.reason, "firearmAmmoEmpty");
  assert.equal(TestRoll.queuedTotals.length, 1);
});

test("automatic firearm attacks spend six loaded rounds", async () => {
  TestRoll.queuedTotals = [18];
  TestRoll.messages = [];
  const weapon = makeFirearmItem({
    name: "Автоматическая винтовка",
    typeValue: "firearmAdvanced",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmFireMode: true,
      lchFirearmAutomatic: true,
      lchFirearmReload: true
    },
    values: {
      ammunition: "Винтовочный",
      fireMode: "Автоматический (4d8)",
      automaticDamage: "4d8",
      reload: "Смена магазина 24"
    },
    ammoState: {
      current: 8,
      capacity: 24,
      ammunition: "Винтовочный"
    },
    weight: 8
  });
  const actor = makeActor([weapon]);
  const service = new CombatAttackService({});

  const result = await service.rollFirearmAttack(actor, weapon, { createMessage: false });

  assert.equal(result.breakdown.abilityKey, "dex");
  assert.equal(weapon.getFlag(MODULE_ID, "firearmAmmoState").current, 2);
  assert.match(weapon.name, /2\/24/u);
});

test("reloading a firearm consumes matching actor ammunition and fills the magazine", async () => {
  globalThis.ChatMessage.messages = [];
  const weapon = makeFirearmItem({
    name: "Автоматическая винтовка",
    typeValue: "firearmAdvanced",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmReload: true
    },
    values: {
      ammunition: "Винтовочный",
      reload: "Смена магазина 24"
    },
    ammoState: {
      current: 0,
      capacity: 24,
      ammunition: "Винтовочный"
    }
  });
  const ammo = makeAmmoItem({
    id: "rifle-ammo",
    name: "Винтовочный патрон",
    quantity: 30
  });
  const actor = makeActor([weapon, ammo]);
  const service = new CombatAttackService({});

  const result = await service.reloadFirearm(actor, weapon);

  assert.equal(result.loaded, 24);
  assert.equal(result.current, 24);
  assert.equal(ammo.system.quantity, 6);
  assert.deepEqual(ammo.updateCalls.at(-1), {
    "system.quantity": 6
  });
  assert.equal(weapon.getFlag(MODULE_ID, "firearmAmmoState").current, 24);
  assert.match(weapon.name, /24\/24/u);
  assert.equal(
    globalThis.ChatMessage.messages.at(-1)?.content,
    "Автоматическая винтовка (24/24): перезарядка."
  );
  assert.doesNotMatch(globalThis.ChatMessage.messages.at(-1)?.content ?? "", /боезапас|загружено/iu);
});

test("reloading a firearm resolves selected ammunition item identifiers", async () => {
  globalThis.ChatMessage.messages = [];
  const ammoId = "yrYgqnZjyFUdqkpg";
  const weapon = makeFirearmItem({
    name: "Musket",
    typeValue: "firearmPrimitive",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmReload: true
    },
    values: {
      ammunition: ammoId,
      reload: "Magazine 1"
    },
    ammoState: {
      current: 0,
      capacity: 1,
      ammunition: ammoId
    }
  });
  const ammo = makeAmmoItem({
    id: ammoId,
    name: "Musket Ammunition",
    quantity: 3,
    subtype: "firearmBullet"
  });
  const actor = makeActor([weapon, ammo]);
  const service = new CombatAttackService({});

  const result = await service.reloadFirearm(actor, weapon);

  assert.equal(result.success, true);
  assert.equal(result.loaded, 1);
  assert.equal(result.current, 1);
  assert.equal(ammo.system.quantity, 2);
  assert.deepEqual(ammo.updateCalls.at(-1), {
    "system.quantity": 2
  });
});

test("automatic fire area action empties the magazine and reports save data", async () => {
  globalThis.ChatMessage.messages = [];
  const weapon = makeFirearmItem({
    name: "Автоматическая винтовка",
    typeValue: "firearmAdvanced",
    properties: {
      lchFirearmAmmunition: true,
      lchFirearmFireMode: true,
      lchFirearmAutomatic: true,
      lchFirearmReload: true
    },
    values: {
      ammunition: "Винтовочный",
      fireMode: "Автоматический (4d8)",
      automaticDamage: "4d8",
      reload: "Смена магазина 24"
    },
    ammoState: {
      current: 7,
      capacity: 24,
      ammunition: "Винтовочный"
    },
    weight: 8
  });
  const actor = makeActor([weapon]);
  const service = new CombatAttackService({});

  const result = await service.resolveFirearmAreaFire(actor, weapon, {
    mode: "automatic",
    createMessage: false
  });

  assert.equal(result.success, true);
  assert.equal(result.mode, "automatic");
  assert.equal(result.damageFormula, "4d8");
  assert.equal(result.coneFeet, 45);
  assert.equal(result.saveDC, 13);
  assert.equal(result.ammoSpent, 7);
  assert.equal(weapon.getFlag(MODULE_ID, "firearmAmmoState").current, 0);
});

test("attack reactions register with the global reaction queue", async () => {
  const registered = [];
  const service = new CombatAttackService({
    reactionQueueService: {
      registerType: (kind) => registered.push(kind)
    }
  });

  await service.initialize();

  assert.deepEqual(registered, ["provoked-attack", "parry", "interception"]);
});

test("manual parry resolution uses the global ten-second reaction workflow", async () => {
  const weapon = makeWeaponItem();
  const defender = makeActor([weapon], { id: "defender", prof: 2 });
  defender.system.attributes.ac = { value: 15 };
  defender.setFlag = async (scope, key, value) => {
    defender.flags[scope] ??= {};
    defender.flags[scope][key] = value;
    return defender;
  };
  const moduleApi = {};
  const service = new CombatAttackService(moduleApi);
  moduleApi.combatAttackService = service;
  let promptCalls = 0;
  moduleApi.reactionQueueService = new ReactionQueueService(moduleApi, {
    actorResolver: () => defender,
    isCoordinator: () => true,
    promptCandidate: async () => {
      promptCalls += 1;
      return { accepted: true };
    }
  });
  await service.initialize();

  const result = await service.resolveParry(defender, 16, { baseAc: 15 });

  assert.equal(promptCalls, 1);
  assert.equal(result.success, true);
  assert.equal(result.preventedHit, true);
  assert.equal(result.reaction.consumed, true);
  assert.equal(service.getReactionState(defender).usesRemaining, 0);
});

test("one provoked-attack trigger lets every eligible reactor act in initiative order", async () => {
  const first = makeActor([makeWeaponItem({ id: "first-sword" })], { id: "first-reactor" });
  const second = makeActor([makeWeaponItem({ id: "second-sword" })], { id: "second-reactor" });
  const target = makeActor([], { id: "moving-target" });
  for (const actor of [first, second]) {
    actor.setFlag = async (scope, key, value) => {
      actor.flags[scope] ??= {};
      actor.flags[scope][key] = value;
      return actor;
    };
  }
  const previousGame = globalThis.game;
  const actors = new Map([first, second, target].map((actor) => [actor.id, actor]));
  const gm = { id: "gm", active: true, isGM: true };
  const users = [gm];
  users.activeGM = gm;
  globalThis.game = {
    user: gm,
    users,
    actors: { get: (id) => actors.get(id) ?? null }
  };
  const moduleApi = {};
  const service = new CombatAttackService(moduleApi);
  moduleApi.combatAttackService = service;
  moduleApi.reactionQueueService = new ReactionQueueService(moduleApi, {
    combatProvider: () => ({
      started: true,
      turns: [{ actor: first }, { actor: second }]
    }),
    isCoordinator: () => true,
    promptCandidate: async () => ({ accepted: true })
  });
  await service.initialize();
  TestRoll.queuedTotals.push(15, 16);

  try {
    const result = await moduleApi.reactionQueueService.resolve({
      triggerId: "shared-provoked-trigger",
      kind: "provoked-attack",
      context: {
        triggerId: "shared-provoked-trigger",
        reactorIds: [first.id, second.id],
        targetId: target.id,
        options: { targetAc: 10, createMessage: false }
      }
    });

    assert.equal(result.accepted.length, 2);
    assert.deepEqual(result.accepted.map((entry) => entry.candidate.actorUuid), [first.uuid, second.uuid]);
    assert.equal(service.getReactionState(first).usesRemaining, 0);
    assert.equal(service.getReactionState(second).usesRemaining, 0);
  }
  finally {
    globalThis.game = previousGame;
  }
});
