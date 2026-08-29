import test from "node:test";
import assert from "node:assert/strict";

function getPath(source, path) {
  return String(path ?? "").split(".").filter(Boolean).reduce((current, part) => (
    current && typeof current === "object" ? current[part] : undefined
  ), source);
}

function makeItem({
  id,
  type = "weapon",
  equipped = false,
  flags = {},
  system = {}
} = {}) {
  return {
    id,
    _id: id,
    name: id,
    type,
    flags,
    system: {
      equipped,
      ...system
    },
    getFlag(scope, key) {
      return getPath(this.flags?.[scope], key);
    }
  };
}

function makeActor(items = []) {
  return {
    type: "character",
    items: {
      contents: items,
      get(id) {
        return items.find((item) => item.id === id || item._id === id) ?? null;
      }
    }
  };
}

test("hand helpers read race capacity, occupied hand slots, and held-item requirements", async () => {
  const {
    canUseHeldItemForHandRequirement,
    getActorHandCapacity,
    getFreeHandSlots,
    getItemHeldHands
  } = await import(`../scripts/integrations/held-items.js?helpers=${Date.now()}`);

  const race = makeItem({
    id: "race",
    type: "race",
    flags: {
      "rebreya-main": {
        hands: {
          max: 2
        }
      }
    }
  });
  const sword = makeItem({
    id: "sword",
    equipped: true,
    flags: {
      "rebreya-main": {
        heldHands: ["left"]
      }
    }
  });
  const dagger = makeItem({ id: "dagger", equipped: true });
  const shield = makeItem({
    id: "shield",
    equipped: true,
    flags: {
      "rebreya-main": {
        heldHands: ["right"]
      }
    }
  });
  const actor = makeActor([race, sword, dagger]);
  const blockedActor = makeActor([race, sword, shield]);

  assert.equal(getActorHandCapacity(actor), 2);
  assert.deepEqual(getItemHeldHands(sword), ["left"]);
  assert.deepEqual(getFreeHandSlots(actor), ["right"]);
  assert.equal(canUseHeldItemForHandRequirement(actor, sword, { requiredHands: 1 }).ok, true);
  assert.equal(canUseHeldItemForHandRequirement(actor, sword, { requiredHands: 2 }).ok, true);
  assert.equal(canUseHeldItemForHandRequirement(blockedActor, sword, { requiredHands: 2 }).ok, false);
  assert.equal(canUseHeldItemForHandRequirement(actor, dagger, { requiredHands: 1 }).ok, false);
});

test("installed extra limbs add secondary hand slots that can use only light weapons", async () => {
  const {
    buildHeldItemEquipMenuActions,
    canUseHeldItemForHandRequirement,
    getActorHandCapacity,
    getActorHandSlots
  } = await import(`../scripts/integrations/held-items.js?implant-hands=${Date.now()}`);
  const light = makeItem({
    id: "dagger",
    equipped: true,
    system: { properties: ["lgt"] },
    flags: {
      "rebreya-main": {
        heldHands: ["hand3"]
      }
    }
  });
  const heavy = makeItem({
    id: "sword",
    equipped: true,
    flags: {
      "rebreya-main": {
        heldHands: ["hand3"]
      }
    }
  });
  const actor = makeActor([light]);
  actor.effects = {
    contents: [{
      name: "Импланты",
      flags: {
        "rebreya-main": {
          implantAggregate: true,
          automation: {
            actorFlags: { secondaryHands: 2 }
          }
        }
      }
    }]
  };

  assert.equal(getActorHandCapacity(actor), 4);
  assert.deepEqual(getActorHandSlots(actor), ["left", "right", "hand3", "hand4"]);
  assert.equal(canUseHeldItemForHandRequirement(actor, light, { requiredHands: 1 }).ok, true);
  assert.deepEqual(
    buildHeldItemEquipMenuActions(actor, light)
      .filter((action) => action.id.startsWith("hand"))
      .map((action) => [action.id, action.disabled]),
    [["hand3", false], ["hand4", false]]
  );

  actor.items.contents = [heavy];
  assert.equal(canUseHeldItemForHandRequirement(actor, heavy, { requiredHands: 1 }).reason, "secondaryHandRestricted");
  assert.deepEqual(
    buildHeldItemEquipMenuActions(actor, heavy)
      .filter((action) => action.id.startsWith("hand"))
      .map((action) => [action.id, action.disabled]),
    [["hand3", true], ["hand4", true]]
  );
});

test("explicit zero hands stays zero while missing hand data keeps the default", async () => {
  const {
    getActorHandCapacity,
    getActorHandSlots
  } = await import(`../scripts/integrations/held-items.js?zero-hands=${Date.now()}`);
  const actorWithNoHands = makeActor([]);
  actorWithNoHands.flags = { "rebreya-main": { hands: 0 } };
  actorWithNoHands.getFlag = function getFlag(scope, key) {
    return getPath(this.flags?.[scope], key);
  };

  assert.equal(getActorHandCapacity(actorWithNoHands), 0);
  assert.deepEqual(getActorHandSlots(actorWithNoHands), []);
  assert.equal(getActorHandCapacity(makeActor([])), 2);
});

test("grapple hand reservations remove only their exact slots from free hands", async () => {
  const {
    buildActorHandReservationsUpdate,
    getActorHandReservations,
    getFreeHandSlots,
    HAND_RESERVATIONS_FLAG
  } = await import(`../scripts/integrations/held-items.js?hand-reservations=${Date.now()}`);
  const reservation = {
    linkId: "link-1",
    kind: "grapple",
    handSlot: "left",
    sourceTokenUuid: "Scene.scene.Token.source",
    targetTokenUuid: "Scene.scene.Token.target"
  };
  const actor = makeActor([]);
  actor.flags = { "rebreya-main": { handReservations: [reservation] } };
  actor.getFlag = function getFlag(scope, key) {
    return getPath(this.flags?.[scope], key);
  };

  assert.equal(HAND_RESERVATIONS_FLAG, "handReservations");
  assert.deepEqual(getActorHandReservations(actor), [reservation]);
  assert.deepEqual(getFreeHandSlots(actor), ["right"]);
  assert.deepEqual(buildActorHandReservationsUpdate([reservation]), {
    "flags.rebreya-main.handReservations": [reservation]
  });
});

test("hand update patches equip items into a specific hand and can clear hand state", async () => {
  const {
    buildHeldItemHandUpdate,
    buildHeldItemWornUpdate,
    HELD_ITEM_HANDS_FLAG
  } = await import(`../scripts/integrations/held-items.js?updates=${Date.now()}`);

  assert.equal(HELD_ITEM_HANDS_FLAG, "heldHands");
  assert.deepEqual(buildHeldItemHandUpdate("right"), {
    "system.equipped": true,
    "flags.rebreya-main.heldHands": ["right"]
  });
  assert.deepEqual(buildHeldItemWornUpdate(false), {
    "system.equipped": false,
    "flags.rebreya-main.-=heldHands": null
  });
});

test("two-hand versatile updates rewrite item base damage until grip changes back", async () => {
  const {
    buildHeldItemHandUpdate,
    buildHeldItemWornUpdate
  } = await import(`../scripts/integrations/held-items.js?versatile-damage=${Date.now()}`);

  const baseDamage = {
    number: 1,
    denomination: 8,
    types: ["slashing"],
    custom: {
      enabled: false,
      formula: ""
    }
  };
  const versatileWeapon = makeItem({
    id: "longsword",
    equipped: true,
    flags: {
      "rebreya-main": {
        handRequirement: {
          requiredHands: 1,
          allowedHands: [1, 2],
          versatile: true
        }
      }
    },
    system: {
      properties: ["ver"],
      damage: {
        base: baseDamage,
        versatile: {
          number: 1,
          denomination: 10,
          custom: {
            enabled: false,
            formula: ""
          }
        }
      }
    }
  });

  assert.deepEqual(buildHeldItemHandUpdate(["left", "right"], versatileWeapon), {
    "system.equipped": true,
    "system.damage.base.number": 1,
    "system.damage.base.denomination": 10,
    "system.damage.base.types": ["slashing"],
    "system.damage.base.custom": {
      enabled: false,
      formula: ""
    },
    "flags.rebreya-main.heldHands": ["left", "right"],
    "flags.rebreya-main.versatileBaseDamageOriginal": baseDamage
  });

  const twoHandedWeapon = makeItem({
    id: "longsword",
    equipped: true,
    flags: {
      "rebreya-main": {
        heldHands: ["left", "right"],
        handRequirement: {
          requiredHands: 1,
          allowedHands: [1, 2],
          versatile: true
        },
        versatileBaseDamageOriginal: baseDamage
      }
    },
    system: {
      properties: ["ver"],
      damage: {
        base: {
          number: 1,
          denomination: 10,
          types: ["slashing"],
          custom: {
            enabled: false,
            formula: ""
          }
        },
        versatile: {
          number: 1,
          denomination: 10,
          custom: {
            enabled: false,
            formula: ""
          }
        }
      }
    }
  });

  assert.deepEqual(buildHeldItemHandUpdate("left", twoHandedWeapon), {
    "system.equipped": true,
    "system.damage.base.number": 1,
    "system.damage.base.denomination": 8,
    "system.damage.base.types": ["slashing"],
    "system.damage.base.custom": {
      enabled: false,
      formula: ""
    },
    "flags.rebreya-main.heldHands": ["left"],
    "flags.rebreya-main.-=versatileBaseDamageOriginal": null
  });
  assert.deepEqual(buildHeldItemWornUpdate(false, twoHandedWeapon), {
    "system.equipped": false,
    "system.damage.base.number": 1,
    "system.damage.base.denomination": 8,
    "system.damage.base.types": ["slashing"],
    "system.damage.base.custom": {
      enabled: false,
      formula: ""
    },
    "flags.rebreya-main.-=heldHands": null,
    "flags.rebreya-main.-=versatileBaseDamageOriginal": null
  });
});

test("two-hand versatile updates tolerate dnd5e damage data with getter-only formula", async () => {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    utils: {
      deepClone: (value) => value
    }
  };

  try {
    const {
      buildHeldItemHandUpdate
    } = await import(`../scripts/integrations/held-items.js?readonly-damage=${Date.now()}`);

    const baseDamage = {
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
      },
      toObject() {
        return {
          number: this.number,
          denomination: this.denomination,
          bonus: this.bonus,
          types: Array.from(this.types),
          custom: { ...this.custom },
          scaling: { ...this.scaling }
        };
      }
    };
    Object.defineProperty(baseDamage, "formula", {
      get() {
        return `${this.number}d${this.denomination}`;
      },
      enumerable: true
    });

    const weapon = makeItem({
      id: "old-longsword",
      equipped: true,
      flags: {
        "rebreya-main": {
          handRequirement: {
            requiredHands: 1,
            allowedHands: [1, 2],
            versatile: true
          }
        }
      },
      system: {
        properties: ["ver"],
        damage: {
          base: baseDamage,
          versatile: {
            number: 1,
            denomination: 10,
            custom: {
              enabled: false,
              formula: ""
            }
          }
        }
      }
    });

    assert.deepEqual(buildHeldItemHandUpdate(["left", "right"], weapon), {
      "system.equipped": true,
      "system.damage.base.number": 1,
      "system.damage.base.denomination": 10,
      "system.damage.base.bonus": "",
      "system.damage.base.types": ["slashing"],
      "system.damage.base.custom": {
        enabled: false,
        formula: ""
      },
      "system.damage.base.scaling": {
        mode: "",
        number: 1,
        formula: ""
      },
      "flags.rebreya-main.heldHands": ["left", "right"],
      "flags.rebreya-main.versatileBaseDamageOriginal": {
        number: 1,
        denomination: 8,
        bonus: "",
        types: ["slashing"],
        custom: {
          enabled: false,
          formula: ""
        },
        scaling: {
          mode: "",
          number: 1,
          formula: ""
        }
      }
    });
  }
  finally {
    if (previousFoundry === undefined) {
      delete globalThis.foundry;
    }
    else {
      globalThis.foundry = previousFoundry;
    }
  }
});

test("two-hand versatile updates keep automatic bonuses out of custom damage formulas", async () => {
  const {
    buildHeldItemHandUpdate
  } = await import(`../scripts/integrations/held-items.js?automatic-custom-damage=${Date.now()}`);

  const baseDamage = {
    number: 1,
    denomination: 8,
    bonus: "@mod",
    types: ["slashing"],
    custom: {
      enabled: true,
      formula: ""
    },
    toObject() {
      return {
        number: this.number,
        denomination: this.denomination,
        bonus: this.bonus,
        types: this.types,
        custom: { ...this.custom }
      };
    }
  };
  Object.defineProperty(baseDamage, "formula", {
    get() {
      return `${this.number}d${this.denomination} + ${this.bonus}`;
    },
    enumerable: true
  });

  const weapon = makeItem({
    id: "custom-enabled-longsword",
    equipped: true,
    flags: {
      "rebreya-main": {
        handRequirement: {
          requiredHands: 1,
          allowedHands: [1, 2],
          versatile: true
        }
      }
    },
    system: {
      properties: ["ver"],
      damage: {
        base: baseDamage,
        versatile: {
          number: 1,
          denomination: 10,
          custom: {
            enabled: false,
            formula: ""
          }
        }
      }
    }
  });

  assert.deepEqual(buildHeldItemHandUpdate(["left", "right"], weapon), {
    "system.equipped": true,
    "system.damage.base.number": 1,
    "system.damage.base.denomination": 10,
    "system.damage.base.bonus": "@mod",
    "system.damage.base.types": ["slashing"],
    "system.damage.base.custom": {
      enabled: false,
      formula: ""
    },
    "flags.rebreya-main.heldHands": ["left", "right"],
    "flags.rebreya-main.versatileBaseDamageOriginal": {
      number: 1,
      denomination: 8,
      bonus: "@mod",
      types: ["slashing"],
      custom: {
        enabled: true,
        formula: ""
      }
    }
  });
});

test("equipment context menu actions keep native wear states and add eligible two-hand grips", async () => {
  const {
    canHoldItemInTwoHands,
    buildHeldItemEquipMenuActions,
    getHeldItemEquipPresentation,
    HELD_ITEM_PRESENTATIONS
  } = await import(`../scripts/integrations/held-items.js?menu=${Date.now()}`);

  const item = makeItem({ id: "sword", equipped: true });
  const actor = makeActor([item]);
  const actions = buildHeldItemEquipMenuActions(actor, item);

  assert.deepEqual(actions.map((action) => action.id), ["worn", "unequipped", "left", "right"]);
  assert.deepEqual(actions.map((action) => action.label), [
    HELD_ITEM_PRESENTATIONS.worn.label,
    HELD_ITEM_PRESENTATIONS.unequipped.label,
    HELD_ITEM_PRESENTATIONS.left.label,
    HELD_ITEM_PRESENTATIONS.right.label
  ]);
  assert.notEqual(actions.find((action) => action.id === "left").icon, actions.find((action) => action.id === "right").icon);

  const versatile = makeItem({
    id: "versatile",
    equipped: true,
    flags: {
      "rebreya-main": {
        handRequirement: {
          requiredHands: 1,
          allowedHands: [1, 2],
          versatile: true
        }
      }
    }
  });
  const versatileActions = buildHeldItemEquipMenuActions(makeActor([versatile]), versatile);
  assert.equal(canHoldItemInTwoHands(versatile), true);
  assert.deepEqual(versatileActions.find((action) => action.id === "both").update, {
    "system.equipped": true,
    "flags.rebreya-main.heldHands": ["left", "right"]
  });

  const lightWeapon = makeItem({
    id: "dagger",
    equipped: true,
    system: {
      quantity: 1,
      properties: ["lgt"]
    }
  });
  assert.equal(canHoldItemInTwoHands(lightWeapon), false);
  lightWeapon.system.quantity = 2;
  assert.equal(canHoldItemInTwoHands(lightWeapon), true);
  assert.ok(buildHeldItemEquipMenuActions(makeActor([lightWeapon]), lightWeapon).some((action) => action.id === "both"));

  const leftHandWeapon = makeItem({
    id: "left-hand-weapon",
    equipped: true,
    flags: {
      "rebreya-main": {
        heldHands: ["left"]
      }
    }
  });
  const replacement = makeItem({ id: "replacement", equipped: true });
  const replacementActions = buildHeldItemEquipMenuActions(makeActor([leftHandWeapon, replacement]), replacement);
  const replaceLeftAction = replacementActions.find((action) => action.id === "left");
  assert.equal(replaceLeftAction.disabled, false);
  assert.equal(replaceLeftAction.occupied, true);
  assert.deepEqual(replaceLeftAction.replacements, [{
    slot: "left",
    itemId: "left-hand-weapon",
    itemName: "left-hand-weapon"
  }]);

  const twoHandedWeapon = makeItem({
    id: "longbow",
    equipped: true,
    system: {
      properties: ["two"]
    }
  });
  const twoHandedActions = buildHeldItemEquipMenuActions(makeActor([twoHandedWeapon]), twoHandedWeapon);
  const carryLeftAction = twoHandedActions.find((action) => action.id === "left");
  assert.equal(carryLeftAction.disabled, false);
  assert.equal(carryLeftAction.carryOnly, true);
  assert.equal(carryLeftAction.occupied, false);
  assert.ok(carryLeftAction.tooltip);
  assert.equal(twoHandedActions.find((action) => action.id === "both").carryOnly, false);

  assert.deepEqual(getHeldItemEquipPresentation(makeItem({
    id: "sword",
    equipped: true,
    flags: {
      "rebreya-main": {
        heldHands: ["left", "right"]
      }
    }
  })), {
    label: "Две руки",
    icon: "fa-solid fa-hands fa-fw"
  });
});

test("natural weapons do not require held hands or expose hand choices", async () => {
  const {
    buildHeldItemEquipMenuActions,
    canUseHeldItemForHandRequirement,
    getFreeHandSlots,
    isHeldItemEligible
  } = await import(`../scripts/integrations/held-items.js?natural-weapons=${Date.now()}`);

  const bite = makeItem({
    id: "bite",
    equipped: true,
    system: {
      type: {
        value: "natural"
      },
      properties: ["two"]
    },
    flags: {
      "rebreya-main": {
        heldHands: ["left"]
      }
    }
  });
  const actor = makeActor([bite]);

  assert.equal(isHeldItemEligible(bite), false);
  assert.deepEqual(buildHeldItemEquipMenuActions(actor, bite), []);
  assert.deepEqual(getFreeHandSlots(actor), ["left", "right"]);
  assert.deepEqual(canUseHeldItemForHandRequirement(actor, bite, { requiredHands: 2 }), {
    ok: true,
    reason: "",
    requiredHands: 0,
    heldHands: [],
    freeHands: []
  });
});

test("distinct held-item predicate requires different live unreserved hand slots and includes the current item", async () => {
  const { hasDistinctHeldItemsInDifferentHands } = await import(
    `../scripts/integrations/held-items.js?distinct-held=${Date.now()}`
  );
  const left = makeItem({
    id: "left-sword",
    equipped: true,
    flags: { "rebreya-main": { heldHands: ["left"] } }
  });
  const right = makeItem({
    id: "right-dagger",
    equipped: true,
    flags: { "rebreya-main": { heldHands: ["right"] } }
  });
  const third = makeItem({
    id: "third-weapon",
    equipped: true,
    flags: { "rebreya-main": { heldHands: ["hand3"] } }
  });
  const actor = makeActor([left, right, third]);
  actor.flags = { "rebreya-main": { hands: 3 } };
  actor.getFlag = (scope, key) => actor.flags?.[scope]?.[key];
  const equipped = (item) => item.system.equipped === true;

  assert.equal(hasDistinctHeldItemsInDifferentHands(actor, left, { predicate: equipped }), true);
  assert.equal(hasDistinctHeldItemsInDifferentHands(actor, third, { predicate: equipped }), true);

  right.system.equipped = false;
  assert.equal(hasDistinctHeldItemsInDifferentHands(actor, left, { predicate: equipped }), true);
  third.system.equipped = false;
  assert.equal(hasDistinctHeldItemsInDifferentHands(actor, left, { predicate: equipped }), false);

  right.system.equipped = true;
  left.flags["rebreya-main"].heldHands = ["left", "right"];
  right.flags["rebreya-main"].heldHands = [];
  assert.equal(hasDistinctHeldItemsInDifferentHands(actor, left, { predicate: equipped }), false);

  left.flags["rebreya-main"].heldHands = ["left"];
  right.flags["rebreya-main"].heldHands = ["right"];
  actor.flags["rebreya-main"].handReservations = [{
    linkId: "grapple-1",
    kind: "grapple",
    handSlot: "right",
    sourceTokenUuid: "Scene.scene.Token.source",
    targetTokenUuid: "Scene.scene.Token.target"
  }];
  assert.equal(hasDistinctHeldItemsInDifferentHands(actor, left, { predicate: equipped }), false);

  actor.flags["rebreya-main"].handReservations = [];
  assert.equal(hasDistinctHeldItemsInDifferentHands(actor, makeItem({ id: "not-held" }), { predicate: equipped }), false);
});
