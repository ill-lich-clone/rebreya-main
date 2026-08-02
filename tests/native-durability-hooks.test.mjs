import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { CHEST_OBJECT_DURABILITY } from "../scripts/data/native-object-durability-service.js";
import { buildStorageTokenState, STORAGE_UPDATED_HOOK } from "../scripts/data/storage-service.js";

function applyPatch(target, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let cursor = target;
    for (const part of parts.slice(0, -1)) cursor = (cursor[part] ??= {});
    cursor[parts.at(-1)] = structuredClone(value);
  }
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

function createChest({ id = "chest", hp = 18 } = {}) {
  const token = {
    id,
    uuid: `Scene.scene.Token.${id}`,
    name: "Сундук",
    flags: {
      [MODULE_ID]: {
        storage: buildStorageTokenState({ baseName: "Сундук", state: "unopened" }),
        objectDurability: {
          ...structuredClone(CHEST_OBJECT_DURABILITY),
          hp: { value: hp, max: 18 }
        }
      }
    },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async update(patch) { applyPatch(this, patch); return this; }
  };
  const actor = {
    id: `${id}-actor`,
    uuid: `${token.uuid}.Actor.delta`,
    token: { document: token },
    system: { attributes: { hp: { value: hp, max: 18 }, ac: { calc: "flat", flat: 15 } } }
  };
  token.actor = actor;
  return { token, actor };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("DnD5e damage on a Rebreya chest routes through native durability", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?native-damage=${Date.now()}`);
  const Hooks = createHooks();
  const { token, actor } = createChest();
  const damageCalls = [];
  registerDurabilityHooks({
    async damageDurabilityTarget(target, options) {
      damageCalls.push([target, structuredClone(options)]);
      return { outcome: "damaged" };
    }
  }, { Hooks, CONFIG: {}, isActiveGm: () => true });

  const preApplyDamage = Hooks.callbacks.get("dnd5e.preApplyDamage");
  assert.equal(preApplyDamage(actor, 6, {}, { damageType: "slashing" }), false);
  assert.equal(preApplyDamage({ id: "hero" }, 6, {}, {}), true);
  await flush();

  assert.deepEqual(damageCalls, [[token, { amount: 6, damageType: "slashing" }]]);
});

test("parallel chest damage is serialized per native target", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?native-queue=${Date.now()}`);
  const Hooks = createHooks();
  const { actor } = createChest();
  const releases = [];
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  registerDurabilityHooks({
    async damageDurabilityTarget() {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => releases.push(resolve));
      inFlight -= 1;
      return { outcome: "damaged" };
    }
  }, { Hooks, CONFIG: {}, isActiveGm: () => true });
  const preApplyDamage = Hooks.callbacks.get("dnd5e.preApplyDamage");

  assert.equal(preApplyDamage(actor, 1, {}, {}), false);
  assert.equal(preApplyDamage(actor, 1, {}, {}), false);
  await flush();
  assert.equal(calls, 1);
  releases.shift()();
  await flush();
  assert.equal(calls, 2);
  releases.shift()();
  await flush();
  assert.equal(maxInFlight, 1);
});

test("direct native HP loss is neutralized and routed while healing is only neutralized", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?native-hp=${Date.now()}`);
  const Hooks = createHooks();
  const { actor } = createChest({ hp: 8 });
  const damageCalls = [];
  registerDurabilityHooks({
    async damageDurabilityTarget(_target, options) {
      damageCalls.push(structuredClone(options));
      return { outcome: "damaged" };
    }
  }, { Hooks, CONFIG: {}, isActiveGm: () => true });

  const preUpdateActor = Hooks.callbacks.get("preUpdateActor");
  const damaged = { "system.attributes.hp.value": 3 };
  assert.equal(preUpdateActor(actor, damaged, { damageType: "bludgeoning" }), true);
  assert.equal(damaged["system.attributes.hp.value"], 8);
  await flush();
  assert.deepEqual(damageCalls, [{ amount: 5, damageType: "bludgeoning" }]);

  const healed = { system: { attributes: { hp: { value: 12 } } } };
  assert.equal(preUpdateActor(actor, healed, {}), true);
  assert.equal(healed.system.attributes.hp.value, 8);
  await flush();
  assert.equal(damageCalls.length, 1);
});

test("native reconciliation repairs chest and single ground-row projections", async () => {
  const { reconcileNativeObjectDurability } = await import(`../scripts/integrations/durability-hooks.js?native-reconcile=${Date.now()}`);
  const { token: chest } = createChest({ id: "chest", hp: 7 });
  const { token: pile } = createChest({ id: "pile" });
  pile.flags[MODULE_ID] = {
    groundPile: { enabled: true },
    storage: buildStorageTokenState({
      baseName: "Меч",
      state: "opened",
      manualRows: [{
        rowId: "sword",
        itemData: {
          flags: { [MODULE_ID]: { durability: { eligible: true, hp: { value: 4, max: 9 }, ac: 17, damageThreshold: 2 } } }
        }
      }]
    })
  };
  const scene = { id: "scene", tokens: { contents: [chest, pile] } };
  const reconciled = await reconcileNativeObjectDurability({
    game: { scenes: { contents: [scene] } },
    canvas: {},
    isActiveGm: () => true
  });

  assert.deepEqual(reconciled, [chest.uuid, pile.uuid]);
  assert.equal(chest.delta.system.attributes.hp.value, 7);
  assert.deepEqual(pile.delta.system.attributes.hp, { value: 4, max: 9, dt: 2 });
  assert.equal(pile.delta.system.attributes.ac.flat, 17);
});

test("storage updates refresh only their matching native projection", async () => {
  const { registerDurabilityHooks } = await import(`../scripts/integrations/durability-hooks.js?native-refresh=${Date.now()}`);
  const Hooks = createHooks();
  const { token } = createChest({ hp: 5 });
  let ensures = 0;
  registerDurabilityHooks({ damageDurabilityTarget() {} }, {
    Hooks,
    CONFIG: {},
    isActiveGm: () => true,
    ensureDurability: async (target) => {
      assert.equal(target, token);
      ensures += 1;
    }
  });

  Hooks.callbacks.get(STORAGE_UPDATED_HOOK)(token, token.flags[MODULE_ID].storage);
  await flush();
  assert.equal(ensures, 1);
});
