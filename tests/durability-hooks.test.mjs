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
  assert.deepEqual(canUseDurabilityItem(brokenSword), {
    allowed: false,
    reason: "Предмет «sword» сломан и не может использоваться."
  });
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

test("Item Piles pre-create and create lifecycle projects item durability onto the pile token actor", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?pile-lifecycle=${Date.now()}`);
  const Hooks = createHooks();
  const item = makeItem({ id: "crate", hpValue: 5, hpMax: 9, ac: 17, damageThreshold: 4 });
  const actorUpdates = [];
  const tokenUpdates = [];
  const actor = {
    id: "pile-actor",
    uuid: "Scene.scene.Token.pile.Actor.delta",
    items: { contents: [item] },
    system: { attributes: { hp: { value: 5, max: 9, dt: 4 }, ac: { calc: "flat", flat: 17 } } },
    async update(payload) {
      actorUpdates.push(payload);
    }
  };
  item.parent = actor;
  const token = {
    id: "pile",
    uuid: "Scene.scene.Token.pile",
    actor,
    async update(payload) {
      tokenUpdates.push(payload);
    }
  };
  const game = {
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API: { isValidItemPile: () => true } }
  };

  registerDurabilityHooks({}, {
    Hooks,
    notifications: { warn() {} },
    CONFIG: {},
    game,
    isActiveGm: () => true
  });
  const preCreatePile = Hooks.callbacks.get("item-piles-preCreateItemPile");
  const createPile = Hooks.callbacks.get("item-piles-createItemPile");
  assert.equal(typeof preCreatePile, "function");
  assert.equal(typeof createPile, "function");

  const tokenOverrides = {};
  assert.equal(preCreatePile(tokenOverrides, [item]), true);
  assert.deepEqual(tokenOverrides.delta.system.attributes.hp, { value: 5, max: 9, dt: 4 });
  assert.deepEqual(tokenOverrides.delta.system.attributes.ac, { calc: "flat", flat: 17 });
  assert.equal(tokenOverrides.bar1.attribute, "attributes.hp");

  await createPile(token);
  assert.deepEqual(actorUpdates, [{
    "system.attributes.hp.value": 5,
    "system.attributes.hp.max": 9,
    "system.attributes.hp.dt": 4,
    "system.attributes.ac.calc": "flat",
    "system.attributes.ac.flat": 17,
    [`flags.${MODULE_ID}.durabilityPile`]: {
      itemId: "crate",
      itemUuid: "Actor.hero.Item.crate"
    }
  }]);
  assert.deepEqual(tokenUpdates, [{ "bar1.attribute": "attributes.hp" }]);
});

test("updating an Item Pile item after durability appears synchronizes pile HP and AC", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?pile-item-update=${Date.now()}`);
  const Hooks = createHooks();
  const item = makeItem({ id: "bow", hpValue: 7, hpMax: 11, ac: 16, damageThreshold: 2 });
  const actorUpdates = [];
  const actor = {
    id: "pile-actor",
    uuid: "Scene.scene.Token.pile.Actor.delta",
    items: { contents: [item] },
    async update(payload) {
      actorUpdates.push(payload);
    }
  };
  item.parent = actor;
  actor.token = { id: "pile", uuid: "Scene.scene.Token.pile", actor, async update() {} };
  const game = {
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API: { isValidItemPile: () => true } }
  };

  registerDurabilityHooks({}, {
    Hooks,
    notifications: { warn() {} },
    CONFIG: {},
    game,
    isActiveGm: () => true
  });
  const updateItem = Hooks.callbacks.get("updateItem");
  assert.equal(typeof updateItem, "function");

  await updateItem(item, {
    [`flags.${MODULE_ID}.durability`]: item.flags[MODULE_ID].durability
  });

  assert.deepEqual(actorUpdates, [{
    "system.attributes.hp.value": 7,
    "system.attributes.hp.max": 11,
    "system.attributes.hp.dt": 2,
    "system.attributes.ac.calc": "flat",
    "system.attributes.ac.flat": 16,
    [`flags.${MODULE_ID}.durabilityPile`]: {
      itemId: "bow",
      itemUuid: "Actor.hero.Item.bow"
    }
  }]);
});

test("Item Piles item updates synchronize durability only on the active GM client", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?pile-item-update-authority=${Date.now()}`);
  const Hooks = createHooks();
  const item = makeItem({ id: "bow", hpValue: 7, hpMax: 11, ac: 16, damageThreshold: 2 });
  const actorUpdates = [];
  const actor = {
    id: "pile-actor",
    items: { contents: [item] },
    async update(payload) {
      actorUpdates.push(payload);
    }
  };
  item.parent = actor;
  actor.token = { id: "pile", actor, async update() {} };
  const game = {
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API: { isValidItemPile: () => true } }
  };

  registerDurabilityHooks({}, {
    Hooks,
    notifications: { warn() {} },
    CONFIG: {},
    game,
    isActiveGm: () => false
  });
  await Hooks.callbacks.get("updateItem")(item);

  assert.deepEqual(actorUpdates, []);
});

test("loaded Item Piles reconcile persisted zero HP from their durable item", async () => {
  const { reconcileItemPileDurability } = await import(`../scripts/integrations/durability-hooks.js?pile-reconcile=${Date.now()}`);
  const item = makeItem({ id: "bow", hpValue: 7, hpMax: 11, ac: 16, damageThreshold: 2 });
  const actorUpdates = [];
  const actor = {
    id: "pile-actor",
    uuid: "Actor.pile-actor",
    items: { contents: [item] },
    system: { attributes: { hp: { value: 0, max: 0 }, ac: { calc: "flat", flat: 0 } } },
    async update(payload) {
      actorUpdates.push(payload);
    }
  };
  item.parent = actor;
  actor.token = { id: "pile", actor, async update() {} };
  const game = {
    actors: { contents: [actor] },
    scenes: { contents: [] },
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API: { isValidItemPile: () => true } }
  };

  const reconciled = await reconcileItemPileDurability({
    game,
    canvas: {},
    isActiveGm: () => true
  });

  assert.deepEqual(reconciled, [actor.id]);
  assert.equal(actorUpdates[0]["system.attributes.hp.value"], 7);
  assert.equal(actorUpdates[0]["system.attributes.hp.max"], 11);
  assert.equal(actorUpdates[0]["system.attributes.ac.flat"], 16);
});

test("Item Pile projection stops writing when active GM authority changes mid-sync", async () => {
  const { reconcileItemPileDurability } = await import(`../scripts/integrations/durability-hooks.js?pile-authority-change=${Date.now()}`);
  const item = makeItem({ id: "bow", hpValue: 7, hpMax: 11, ac: 16, damageThreshold: 2 });
  const actorUpdates = [];
  const tokenUpdates = [];
  let activeGm = true;
  const actor = {
    id: "pile-actor",
    uuid: "Actor.pile-actor",
    items: { contents: [item] },
    async update(payload) {
      actorUpdates.push(payload);
      activeGm = false;
    }
  };
  item.parent = actor;
  actor.token = {
    id: "pile",
    actor,
    async update(payload) {
      tokenUpdates.push(payload);
    }
  };
  const game = {
    actors: { contents: [actor] },
    scenes: { contents: [] },
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API: { isValidItemPile: () => true } }
  };

  const reconciled = await reconcileItemPileDurability({
    game,
    canvas: {},
    isActiveGm: () => activeGm
  });

  assert.equal(actorUpdates.length, 1);
  assert.deepEqual(tokenUpdates, []);
  assert.deepEqual(reconciled, []);
});

test("dnd5e pile damage is cancelled on the actor and applied to the durable item", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?pile-damage=${Date.now()}`);
  const Hooks = createHooks();
  const item = makeItem({ id: "barrel", hpValue: 8, hpMax: 8, ac: 14, damageThreshold: 2 });
  const actorUpdates = [];
  const actor = {
    id: "pile-actor",
    uuid: "Scene.scene.Token.pile.Actor.delta",
    items: { contents: [item] },
    system: { attributes: { hp: { value: 8, max: 8, dt: 2 }, ac: { calc: "flat", flat: 14 } } },
    async update(payload) {
      actorUpdates.push(payload);
    }
  };
  item.parent = actor;
  actor.token = { id: "pile", uuid: "Scene.scene.Token.pile", actor };
  const damageCalls = [];
  const moduleApi = {
    async damageItem(damagedItem, options) {
      damageCalls.push([damagedItem, options]);
      damagedItem.flags[MODULE_ID].durability.hp.value = 3;
      return {
        outcome: "damaged",
        nextFlag: damagedItem.flags[MODULE_ID].durability
      };
    }
  };
  const game = {
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API: { isValidItemPile: () => true } }
  };

  registerDurabilityHooks(moduleApi, {
    Hooks,
    notifications: { warn() {} },
    CONFIG: {},
    game,
    isActiveGm: () => true
  });
  const preApplyDamage = Hooks.callbacks.get("dnd5e.preApplyDamage");
  assert.equal(typeof preApplyDamage, "function");
  assert.equal(preApplyDamage(actor, 5, {
    "system.attributes.hp.value": 3
  }, { damageType: "slashing" }), false);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(damageCalls.length, 1);
  assert.equal(damageCalls[0][0], item);
  assert.deepEqual(damageCalls[0][1], { amount: 5, damageType: "slashing" });
  assert.equal(actorUpdates.at(-1)["system.attributes.hp.value"], 3);
});

test("parallel Item Pile damage waits on one shared durability queue", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?pile-damage-queue=${Date.now()}`);
  const Hooks = createHooks();
  const item = makeItem({ id: "barrel", hpValue: 8, hpMax: 8, ac: 14, damageThreshold: 2 });
  const actor = {
    id: "pile-actor",
    uuid: "Scene.scene.Token.pile.Actor.delta",
    items: { contents: [item] },
    system: { attributes: { hp: { value: 8, max: 8, dt: 2 }, ac: { calc: "flat", flat: 14 } } },
    async update() {}
  };
  item.parent = actor;
  actor.token = { id: "pile", uuid: "Scene.scene.Token.pile", actor };
  const releases = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let damageCalls = 0;
  const moduleApi = {
    async damageItem(damagedItem, options) {
      damageCalls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => releases.push(resolve));
      damagedItem.flags[MODULE_ID].durability.hp.value -= options.amount;
      inFlight -= 1;
      return {
        outcome: "damaged",
        nextFlag: damagedItem.flags[MODULE_ID].durability
      };
    }
  };
  const game = {
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API: { isValidItemPile: () => true } }
  };

  registerDurabilityHooks(moduleApi, {
    Hooks,
    notifications: { warn() {} },
    CONFIG: {},
    game,
    isActiveGm: () => true
  });
  const preApplyDamage = Hooks.callbacks.get("dnd5e.preApplyDamage");
  assert.equal(preApplyDamage(actor, 1, {}, { damageType: "slashing" }), false);
  assert.equal(preApplyDamage(actor, 1, {}, { damageType: "slashing" }), false);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(damageCalls, 1);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(damageCalls, 2);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(maxInFlight, 1);
  assert.equal(item.flags[MODULE_ID].durability.hp.value, 6);
});

test("inactive clients still route Item Pile HP loss through item durability", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?pile-damage-authority=${Date.now()}`);
  const Hooks = createHooks();
  const item = makeItem({ id: "barrel", hpValue: 8, hpMax: 8 });
  const actor = {
    id: "pile-actor",
    items: { contents: [item] },
    system: { attributes: { hp: { value: 8, max: 8 } } }
  };
  item.parent = actor;
  actor.token = { id: "pile", actor };
  let damageCalls = 0;
  const actorUpdates = [];
  actor.update = async (payload) => actorUpdates.push(payload);
  const game = {
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API: { isValidItemPile: () => true } }
  };
  registerDurabilityHooks({
    async damageItem() {
      throw new Error("pile damage should use the routed module API");
    },
    async damageItemPile() {
      damageCalls += 1;
      return { outcome: "damaged", nextFlag: item.flags[MODULE_ID].durability };
    }
  }, {
    Hooks,
    notifications: { warn() {} },
    CONFIG: {},
    game,
    isActiveGm: () => false
  });

  assert.equal(Hooks.callbacks.get("dnd5e.preApplyDamage")(actor, 1, {}, {}), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(damageCalls, 1);
  assert.deepEqual(actorUpdates, []);
});

test("inactive GM Item Pile damage is routed to the active GM command bus", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const emitted = [];
  const inactiveGm = { id: "gm-b", isGM: true, active: true };
  const activeGm = { id: "gm-a", isGM: true, active: true };
  globalThis.Hooks = { once() {} };
  globalThis.game = {
    user: inactiveGm,
    users: {
      activeGM: activeGm,
      contents: [activeGm, inactiveGm],
      get(id) {
        return this.contents.find((user) => user.id === id) ?? null;
      }
    },
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  };

  try {
    const { ITEM_PILE_DAMAGE_COMMAND, RebreyaMainModule } = await import(`../scripts/main.js?pile-damage-request=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const item = makeItem({ id: "barrel" });
    const pending = moduleApi.damageItemPile(item, { amount: 9, damageType: "force" });

    assert.equal(emitted.length, 1);
    const [channel, request] = emitted[0];
    assert.equal(channel, `module.${MODULE_ID}`);
    assert.equal(request.command, ITEM_PILE_DAMAGE_COMMAND);
    assert.equal(request.payload.itemUuid, item.uuid);
    assert.equal(request.payload.amount, 9);
    assert.equal(request.payload.damageType, "force");
    assert.match(request.payload.mutationId, /^durability-pile-/u);

    await moduleApi.handleSocketMessage({
      type: "rebreya.command.result",
      command: request.command,
      requestId: request.requestId,
      forUserId: inactiveGm.id,
      senderId: activeGm.id,
      ok: true,
      data: { outcome: "destroyed" }
    }, activeGm.id);
    assert.deepEqual(await pending, { outcome: "destroyed" });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("active GM validates and executes routed Item Pile destruction", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const emitted = [];
  const activeGm = { id: "gm-a", isGM: true, active: true };
  const inactiveGm = { id: "gm-b", isGM: true, active: true };
  const item = makeItem({ id: "barrel", state: "broken", hpValue: 1, hpMax: 8 });
  const actor = {
    id: "pile-actor",
    items: { contents: [item] },
    token: { id: "pile-token" }
  };
  item.parent = actor;
  globalThis.Hooks = { once() {} };
  globalThis.fromUuid = async (uuid) => uuid === item.uuid ? item : null;
  globalThis.game = {
    user: activeGm,
    users: {
      activeGM: activeGm,
      contents: [activeGm, inactiveGm],
      get(id) {
        return this.contents.find((user) => user.id === id) ?? null;
      }
    },
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API: { isValidItemPile: () => true } },
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  };

  try {
    const { ITEM_PILE_DAMAGE_COMMAND, RebreyaMainModule } = await import(`../scripts/main.js?pile-damage-execute=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.durabilityService.damageItem = async (target, options) => {
      calls.push([target, options]);
      return { outcome: "destroyed" };
    };
    await moduleApi.handleSocketMessage({
      type: "rebreya.command",
      command: ITEM_PILE_DAMAGE_COMMAND,
      requestId: "pile-damage-1",
      senderId: inactiveGm.id,
      payload: {
        itemUuid: item.uuid,
        amount: 9,
        damageType: "force",
        mutationId: "pile-damage-mutation-1"
      }
    }, inactiveGm.id);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(calls, [[item, {
      amount: 9,
      damageType: "force",
      mutationId: "pile-damage-mutation-1"
    }]]);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][1].ok, true);
    assert.deepEqual(emitted[0][1].data, { outcome: "destroyed" });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("direct pile HP loss is neutralized and routed to item durability", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?pile-hp-update=${Date.now()}`);
  const Hooks = createHooks();
  const item = makeItem({ id: "chest", hpValue: 8, hpMax: 8 });
  const actor = {
    id: "pile-actor",
    uuid: "Scene.scene.Token.pile.Actor.delta",
    items: { contents: [item] },
    system: { attributes: { hp: { value: 8, max: 8 } } },
    async update() {}
  };
  item.parent = actor;
  actor.token = { id: "pile", uuid: "Scene.scene.Token.pile", actor };
  const damageCalls = [];
  const game = {
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API: { isValidItemPile: () => true } }
  };
  registerDurabilityHooks({
    async damageItem(_item, options) {
      damageCalls.push(options);
      return { outcome: "damaged", nextFlag: item.flags[MODULE_ID].durability };
    }
  }, {
    Hooks,
    notifications: { warn() {} },
    CONFIG: {},
    game,
    isActiveGm: () => true
  });

  const preUpdateActor = Hooks.callbacks.get("preUpdateActor");
  assert.equal(typeof preUpdateActor, "function");
  const changed = { "system.attributes.hp.value": 3 };
  assert.equal(preUpdateActor(actor, changed, { damageType: "bludgeoning" }), true);
  assert.equal(changed["system.attributes.hp.value"], 8);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(damageCalls, [{ amount: 5, damageType: "bludgeoning" }]);

  const healing = { "system.attributes.hp.value": 12 };
  assert.equal(preUpdateActor(actor, healing, {}), true);
  assert.equal(healing["system.attributes.hp.value"], 8);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(damageCalls.length, 1);
});

test("destroying the last pile item removes its empty token or actor once", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?pile-cleanup=${Date.now()}`);
  const Hooks = createHooks();
  const deletedTokens = [];
  const API = {
    isValidItemPile: () => true,
    isItemPileEmpty: () => true,
    async deleteItemPile(token) {
      deletedTokens.push(token.uuid);
    }
  };
  const game = {
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { API }
  };
  registerDurabilityHooks({}, {
    Hooks,
    notifications: { warn() {} },
    CONFIG: {},
    game,
    isActiveGm: () => true
  });
  const deleteItem = Hooks.callbacks.get("deleteItem");
  assert.equal(typeof deleteItem, "function");

  const token = { id: "pile", uuid: "Scene.scene.Token.pile" };
  const tokenActor = {
    id: "synthetic-pile",
    uuid: "Scene.scene.Token.pile.Actor.delta",
    token,
    items: { contents: [] }
  };
  token.actor = tokenActor;
  const destroyedTokenItem = makeItem({ id: "last-token-item", state: "destroyed" });
  destroyedTokenItem.parent = tokenActor;
  await Promise.all([deleteItem(destroyedTokenItem), deleteItem(destroyedTokenItem)]);
  assert.deepEqual(deletedTokens, [token.uuid]);

  let actorDeleteCalls = 0;
  const actorPile = {
    id: "actor-pile",
    uuid: "Actor.actor-pile",
    items: { contents: [] },
    async delete() {
      actorDeleteCalls += 1;
    }
  };
  const destroyedActorItem = makeItem({ id: "last-actor-item", state: "destroyed" });
  destroyedActorItem.parent = actorPile;
  await deleteItem(destroyedActorItem);
  await deleteItem(destroyedActorItem);
  assert.equal(actorDeleteCalls, 1);
});

test("Item Piles durability hooks are inert when Item Piles is disabled", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?pile-disabled=${Date.now()}`);
  const Hooks = createHooks();
  const damageCalls = [];
  const moduleApi = {
    async damageItem(...args) {
      damageCalls.push(args);
    }
  };
  const game = {
    modules: new Map([["item-piles", { active: false }]]),
    itempiles: { API: { isValidItemPile: () => true } }
  };
  registerDurabilityHooks(moduleApi, { Hooks, notifications: { warn() {} }, CONFIG: {}, game });

  const tokenOverrides = {};
  assert.equal(Hooks.callbacks.get("item-piles-preCreateItemPile")(tokenOverrides, [makeItem()]), true);
  assert.deepEqual(tokenOverrides, {});
  assert.equal(Hooks.callbacks.get("dnd5e.preApplyDamage")({}, 5, {}, {}), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(damageCalls, []);
});
