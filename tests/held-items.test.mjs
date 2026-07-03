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
  const actor = makeActor([race, sword, dagger]);

  assert.equal(getActorHandCapacity(actor), 2);
  assert.deepEqual(getItemHeldHands(sword), ["left"]);
  assert.deepEqual(getFreeHandSlots(actor), ["right"]);
  assert.equal(canUseHeldItemForHandRequirement(actor, sword, { requiredHands: 1 }).ok, true);
  assert.equal(canUseHeldItemForHandRequirement(actor, sword, { requiredHands: 2 }).ok, false);
  assert.equal(canUseHeldItemForHandRequirement(actor, dagger, { requiredHands: 1 }).ok, false);
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
