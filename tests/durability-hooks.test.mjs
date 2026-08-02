import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";

function makeItem({
  id = "sword",
  type = "weapon",
  state = "intact",
  natural = false,
  magical = false,
  equipmentType = "",
  hpValue = 8,
  hpMax = 8,
  ac = 15,
  damageThreshold = 3
} = {}) {
  return {
    id,
    uuid: `Actor.hero.Item.${id}`,
    name: id,
    type,
    system: {
      equipped: false,
      type: {
        value: natural ? "natural" : equipmentType
      },
      properties: magical ? new Set(["mgc"]) : new Set()
    },
    flags: {
      [MODULE_ID]: {
        durability: {
          eligible: true,
          state,
          hp: { value: hpValue, max: hpMax },
          ac,
          damageThreshold
        }
      }
    }
  };
}

function createHooks() {
  const callbacks = new Map();
  return {
    callbacks,
    on(name, callback) {
      callbacks.set(name, callback);
      return name;
    }
  };
}

test("broken mundane items are unusable while natural and magical actions remain available", async () => {
  const {
    canUseDurabilityItem,
    isBrokenDurabilityItem
  } = await import(`../scripts/integrations/durability-hooks.js?decision=${Date.now()}`);

  const brokenSword = makeItem({ state: "broken" });
  const brokenNatural = makeItem({ id: "claw", state: "broken", natural: true });
  const staleMagic = makeItem({ id: "magic", state: "broken", magical: true });

  assert.equal(isBrokenDurabilityItem(brokenSword), true);
  const decision = canUseDurabilityItem(brokenSword);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /Предмет «sword» сломан/iu);
  assert.equal(canUseDurabilityItem(null).allowed, true);
  assert.equal(canUseDurabilityItem(brokenNatural).allowed, true);
  assert.equal(canUseDurabilityItem(staleMagic).allowed, true);
});

test("dnd5e and Midi pre-use hooks block one workflow with one warning", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?hooks=${Date.now()}`);
  const Hooks = createHooks();
  const warnings = [];
  const item = makeItem({ state: "broken" });

  const options = {
    Hooks,
    notifications: {
      warn(message) {
        warnings.push(message);
      }
    },
    CONFIG: {}
  };
  assert.equal(registerDurabilityHooks({}, options), true);
  assert.equal(registerDurabilityHooks({}, options), false);

  assert.equal(Hooks.callbacks.get("midi-qol.preItemRoll")({
    activity: { item },
    config: { workflow: { id: "workflow-1", item } }
  }), false);
  assert.equal(Hooks.callbacks.get("midi-qol.preItemRollV2")({ workflow: { id: "workflow-1", item } }), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /сломан/iu);

  assert.equal(Hooks.callbacks.get("midi-qol.preItemRollV2")({ workflow: { id: "workflow-2", item } }), false);
  assert.equal(Hooks.callbacks.get("dnd5e.preUseActivity")({ item }), false);
  assert.equal(warnings.length, 3);
});
test("broken item effects are filtered and the dnd5e suppression getter is patched", async () => {
  const {
    filterBrokenItemEffects,
    registerDurabilityHooks
  } = await import(`../scripts/integrations/durability-hooks.js?effects=${Date.now()}`);
  const broken = makeItem({ state: "broken" });
  const intact = makeItem({ state: "intact" });
  const effects = [{ id: "one" }, { id: "two" }];

  assert.deepEqual(filterBrokenItemEffects(effects, broken), []);
  assert.deepEqual(filterBrokenItemEffects(effects, intact), effects);

  class ItemDocument {}
  Object.defineProperty(ItemDocument.prototype, "areEffectsSuppressed", {
    configurable: true,
    get() {
      return this.baseSuppressed === true;
    }
  });
  registerDurabilityHooks({}, {
    Hooks: createHooks(),
    notifications: { warn() {} },
    CONFIG: { Item: { documentClass: ItemDocument } }
  });

  assert.equal(Object.assign(new ItemDocument(), broken).areEffectsSuppressed, true);
  assert.equal(Object.assign(new ItemDocument(), intact).areEffectsSuppressed, false);
  const normallySuppressed = Object.assign(new ItemDocument(), intact, { baseSuppressed: true });
  assert.equal(normallySuppressed.areEffectsSuppressed, true);
});

test("effect suppression reads document fields without serializing the item", async () => {
  const { patchDurabilityItemEffectSuppression } = await import(
    `../scripts/integrations/durability-hooks.js?effects-fast-path=${Date.now()}`
  );
  let toObjectCalls = 0;

  class ItemDocument {
    toObject() {
      toObjectCalls += 1;
      return { ...this };
    }
  }
  Object.defineProperty(ItemDocument.prototype, "areEffectsSuppressed", {
    configurable: true,
    get() {
      return false;
    }
  });
  patchDurabilityItemEffectSuppression({
    CONFIG: { Item: { documentClass: ItemDocument } }
  });

  const broken = Object.assign(new ItemDocument(), makeItem({ state: "broken" }));
  assert.equal(broken.areEffectsSuppressed, true);
  assert.equal(broken.areEffectsSuppressed, true);
  assert.equal(toObjectCalls, 0);
});

test("broken body armor cannot be re-equipped while broken held objects stay allowed", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?updates=${Date.now()}`);
  const Hooks = createHooks();
  registerDurabilityHooks({}, {
    Hooks,
    notifications: { warn() {} },
    CONFIG: {}
  });
  const preUpdate = Hooks.callbacks.get("preUpdateItem");
  const armor = makeItem({ type: "equipment", state: "broken", equipmentType: "heavy" });
  const shield = makeItem({ type: "equipment", state: "broken", equipmentType: "shield" });
  const sword = makeItem({ state: "broken" });
  const armorUpdate = { "system.equipped": true };
  const shieldUpdate = { "system.equipped": true };
  const swordUpdate = { system: { equipped: true } };

  preUpdate(armor, armorUpdate);
  preUpdate(shield, shieldUpdate);
  preUpdate(sword, swordUpdate);

  assert.equal(armorUpdate["system.equipped"], false);
  assert.equal(shieldUpdate["system.equipped"], true);
  assert.equal(swordUpdate.system.equipped, true);
});

test("loaded broken body armor is unequipped by the active GM reconciliation", async () => {
  const { reconcileBrokenEquippedArmor } = await import(`../scripts/integrations/durability-hooks.js?reconcile=${Date.now()}`);
  const armor = makeItem({ type: "equipment", state: "broken", equipmentType: "heavy" });
  armor.uuid = "Actor.hero.Item.armor";
  armor.system.equipped = true;
  const updates = [];
  armor.update = async (payload) => {
    updates.push(payload);
    armor.system.equipped = payload["system.equipped"];
  };

  const updated = await reconcileBrokenEquippedArmor({
    game: {
      actors: {
        contents: [{ items: { contents: [armor] } }]
      }
    },
    isActiveGm: () => true
  });

  assert.deepEqual(updated, [armor.uuid]);
  assert.deepEqual(updates, [{ "system.equipped": false }]);
});

test("reconciliation includes loaded and active synthetic token actors without duplicating linked actors", async () => {
  const { reconcileBrokenEquippedArmor } = await import(`../scripts/integrations/durability-hooks.js?synthetic=${Date.now()}`);
  const makeBrokenArmor = (uuid) => {
    const armor = makeItem({ id: uuid.split(".").at(-1), type: "equipment", state: "broken", equipmentType: "heavy" });
    armor.uuid = uuid;
    armor.system.equipped = true;
    armor.updateCalls = [];
    armor.update = async (payload) => {
      armor.updateCalls.push(payload);
    };
    return armor;
  };
  const worldArmor = makeBrokenArmor("Actor.world.Item.armor");
  const loadedSyntheticArmor = makeBrokenArmor("Scene.loaded.Token.unlinked.Actor.delta.Item.armor");
  const activeDeltaArmor = makeBrokenArmor("Scene.active.Token.delta.Actor.delta.Item.armor");
  const worldActor = {
    id: "world",
    uuid: "Actor.world",
    items: { contents: [worldArmor] }
  };
  const loadedSyntheticActor = {
    id: "unlinked",
    uuid: "Scene.loaded.Token.unlinked.Actor.delta",
    items: { contents: [loadedSyntheticArmor] }
  };
  const activeDeltaActor = {
    id: "delta",
    uuid: "Scene.active.Token.delta.Actor.delta",
    items: { contents: [activeDeltaArmor] }
  };
  const loadedScene = {
    id: "loaded",
    tokens: {
      contents: [
        { id: "linked", actorLink: true, actor: worldActor },
        { id: "unlinked", actorLink: false, actor: loadedSyntheticActor }
      ]
    }
  };
  const activeScene = {
    id: "active",
    tokens: {
      contents: [
        {
          id: "delta",
          actorLink: false,
          actor: null,
          delta: {
            syntheticActor: activeDeltaActor
          }
        }
      ]
    }
  };

  const updated = await reconcileBrokenEquippedArmor({
    game: {
      actors: { contents: [worldActor] },
      scenes: { contents: [loadedScene] }
    },
    canvas: { scene: activeScene },
    isActiveGm: () => true
  });

  assert.deepEqual(updated, [worldArmor.uuid, loadedSyntheticArmor.uuid, activeDeltaArmor.uuid]);
  assert.deepEqual(worldArmor.updateCalls, [{ "system.equipped": false }]);
  assert.deepEqual(loadedSyntheticArmor.updateCalls, [{ "system.equipped": false }]);
  assert.deepEqual(activeDeltaArmor.updateCalls, [{ "system.equipped": false }]);
  assert.equal(worldArmor.system.equipped, true);
  assert.equal(loadedSyntheticArmor.system.equipped, true);
  assert.equal(activeDeltaArmor.system.equipped, true);
});
