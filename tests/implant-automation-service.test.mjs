import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  ImplantAutomationService,
  getActorImplantCapabilities
} from "../scripts/combat/implant-automation-service.js";
import { registerImplantAutomationHooks } from "../scripts/integrations/implant-automation-hooks.js";

function actorWithCapabilities(capabilities, system = {}) {
  return {
    id: "actor-1",
    uuid: "Actor.actor-1",
    system,
    effects: [{
      id: "implant-effect",
      flags: {
        [MODULE_ID]: {
          implantAggregate: true,
          automation: { capabilities }
        }
      }
    }]
  };
}

test("runtime reads capabilities only from the aggregate Implants effect", () => {
  const actor = actorWithCapabilities([
    { implantId: "krepkiy-sharnir", type: "grappleShoveBonus", value: 2 }
  ]);
  actor.effects.push({
    flags: {
      [MODULE_ID]: {
        automation: {
          capabilities: [{ implantId: "ignored", type: "hover" }]
        }
      }
    }
  });

  assert.deepEqual(getActorImplantCapabilities(actor), [
    { implantId: "krepkiy-sharnir", type: "grappleShoveBonus", value: 2 }
  ]);
});

test("sturdy joint adds +2 once to grapple and shove checks", () => {
  const actor = actorWithCapabilities([
    { implantId: "krepkiy-sharnir", type: "grappleShoveBonus", value: 2 }
  ]);
  const service = new ImplantAutomationService();
  const grapple = { actor, item: { name: "Захват" }, bonus: "1" };
  const shove = { actor, activity: { identifier: "shove" } };

  assert.equal(service.applyDnd5ePreRollD20Test(grapple), true);
  assert.equal(grapple.bonus, "1 + 2");
  service.applyDnd5ePreRollD20Test(grapple);
  assert.equal(grapple.bonus, "1 + 2");

  service.applyDnd5ePreRollD20Test(shove);
  assert.equal(shove.bonus, "2");
  const unrelated = { actor, item: { name: "Атлетика" } };
  service.applyDnd5ePreRollD20Test(unrelated);
  assert.equal(unrelated.bonus, undefined);
});

test("trajectory aid adds +1 only to attacks made with a weapon item", () => {
  const actor = actorWithCapabilities([
    { implantId: "pomoshch-v-postroenii-traektorii", type: "weaponAttackBonus", value: 1 }
  ]);
  const service = new ImplantAutomationService();
  const weaponAttack = { actor, item: { type: "weapon", name: "Мушкет" }, bonus: "2" };
  const unarmedAttack = { actor, item: { type: "feat", name: "Безоружный удар" } };

  service.applyDnd5ePreRollAttack(weaponAttack);
  service.applyDnd5ePreRollAttack(weaponAttack);
  service.applyDnd5ePreRollAttack(unarmedAttack);

  assert.equal(weaponAttack.bonus, "2 + 1");
  assert.equal(unarmedAttack.bonus, undefined);
});

test("built-in workshop adds +2 only to the selected artisan tool", () => {
  const actor = actorWithCapabilities([
    {
      implantId: "vstroennyy-stanok",
      type: "artisanToolBonus",
      value: 2,
      toolItemId: "tool-smith"
    }
  ]);
  const service = new ImplantAutomationService();
  const smith = { actor, item: { id: "tool-smith", type: "tool" }, bonus: "1" };
  const brewer = { actor, item: { id: "tool-brewer", type: "tool" } };

  service.applyDnd5ePreRollTool(smith);
  service.applyDnd5ePreRollTool(smith);
  service.applyDnd5ePreRollTool(brewer);

  assert.equal(smith.bonus, "1 + 2");
  assert.equal(brewer.bonus, undefined);
});

test("physical profile exposes exact impulse, climbing, and hover rules", () => {
  const actor = actorWithCapabilities([
    { implantId: "impulsnye-nogi", type: "impulseLegs" },
    {
      implantId: "impulsnye-dvigateli",
      type: "impulseEngines",
      jumpMultiplier: 2,
      fallAbsorption: 30
    },
    { implantId: "usilennye-ladoni", type: "climbingHand" },
    { implantId: "modul-pareniya", type: "hover" }
  ], {
    attributes: {
      movement: { walk: 40, fly: 0 }
    }
  });
  const service = new ImplantAutomationService();

  assert.deepEqual(service.getPhysicalProfile(actor, { previousTurnDistance: 0 }), {
    impulseLegsEligible: true,
    speedMultiplier: 2,
    jumpMultiplier: 2,
    fallAbsorption: 30,
    climbWithoutFreeHand: true,
    hover: false
  });
  actor.system.attributes.movement.fly = 30;
  assert.equal(service.getPhysicalProfile(actor, { previousTurnDistance: 5 }).hover, true);
  assert.equal(service.getPhysicalProfile(actor, { previousTurnDistance: 5 }).speedMultiplier, 1);
});

test("impulse legs offer one aggregate speed multiplier only after a zero-movement turn", async () => {
  const impulseActor = actorWithCapabilities([
    { implantId: "impulsnye-nogi", type: "impulseLegs" }
  ]);
  const otherActor = actorWithCapabilities([]);
  otherActor.id = "actor-2";
  otherActor.uuid = "Actor.actor-2";
  const prompts = [];
  const multipliers = [];
  const service = new ImplantAutomationService({
    promptImpulseLegs: async (actor) => {
      prompts.push(actor.id);
      return true;
    },
    setMovementMultiplier: async (actor, multiplier) => {
      multipliers.push([actor.id, multiplier]);
    }
  });

  await service.handleCombatTurnChange({ combatant: { actor: impulseActor } });
  await service.handleCombatTurnChange({ combatant: { actor: otherActor } });
  await service.handleCombatTurnChange({ combatant: { actor: impulseActor } });

  assert.deepEqual(prompts, ["actor-1"]);
  assert.deepEqual(multipliers, [["actor-1", 2]]);

  await service.handleCombatEnd();
  assert.deepEqual(multipliers, [["actor-1", 2], ["actor-1", 1]]);
});

test("impulse legs do not trigger when the actor moved during its previous turn", async () => {
  const impulseActor = actorWithCapabilities([
    { implantId: "impulsnye-nogi", type: "impulseLegs" }
  ]);
  const otherActor = actorWithCapabilities([]);
  otherActor.id = "actor-2";
  otherActor.uuid = "Actor.actor-2";
  const prompts = [];
  const service = new ImplantAutomationService({
    promptImpulseLegs: async () => {
      prompts.push(true);
      return true;
    }
  });

  await service.handleCombatTurnChange({ combatant: { actor: impulseActor } });
  service.recordMovement(impulseActor, 5);
  await service.handleCombatTurnChange({ combatant: { actor: otherActor } });
  await service.handleCombatTurnChange({ combatant: { actor: impulseActor } });

  assert.deepEqual(prompts, []);
});

test("token movement hooks feed measured distance into the active implant turn", async () => {
  const impulseActor = actorWithCapabilities([
    { implantId: "impulsnye-nogi", type: "impulseLegs" }
  ]);
  const otherActor = actorWithCapabilities([]);
  otherActor.id = "actor-2";
  otherActor.uuid = "Actor.actor-2";
  const prompts = [];
  const token = { id: "token-1", actor: impulseActor, x: 0, y: 0 };
  const service = new ImplantAutomationService({
    measureTokenMovement: (_token, origin) => origin.x === 0 ? 10 : 0,
    promptImpulseLegs: async () => {
      prompts.push(true);
      return true;
    }
  });

  await service.handleCombatTurnChange({ combatant: { actor: impulseActor } });
  service.handlePreUpdateToken(token, { x: 100 });
  token.x = 100;
  service.handleUpdateToken(token, { x: 100 });
  await service.handleCombatTurnChange({ combatant: { actor: otherActor } });
  await service.handleCombatTurnChange({ combatant: { actor: impulseActor } });

  assert.deepEqual(prompts, []);
});

test("impulse engines absorb only explicitly identified falling damage", () => {
  const actor = actorWithCapabilities([
    {
      implantId: "impulsnye-dvigateli",
      type: "impulseEngines",
      jumpMultiplier: 2,
      fallAbsorption: 30
    }
  ], {
    attributes: {
      hp: { value: 50, temp: 5, damage: 0 }
    }
  });
  const service = new ImplantAutomationService();
  const fallingUpdates = {};

  service.applyDnd5ePreApplyDamage(actor, 42, fallingUpdates, { isFalling: true });
  assert.deepEqual(fallingUpdates, {
    "system.attributes.hp.temp": 0,
    "system.attributes.hp.value": 43
  });

  const ordinaryUpdates = {};
  service.applyDnd5ePreApplyDamage(actor, 42, ordinaryUpdates, { damageType: "bludgeoning" });
  assert.deepEqual(ordinaryUpdates, {});
});

test("fall absorption composes with damage reductions that already populated updates", () => {
  const actor = actorWithCapabilities([
    {
      implantId: "impulsnye-dvigateli",
      type: "impulseEngines",
      jumpMultiplier: 2,
      fallAbsorption: 30
    }
  ], {
    attributes: {
      hp: { value: 50, temp: 5, damage: 0 }
    }
  });
  const service = new ImplantAutomationService();
  const updates = {
    "system.attributes.hp.temp": 0,
    "system.attributes.hp.value": 30
  };

  service.applyDnd5ePreApplyDamage(actor, 42, updates, { isFalling: true });

  assert.deepEqual(updates, {
    "system.attributes.hp.temp": 5,
    "system.attributes.hp.value": 50
  });
});

test("magnetic palm validates range, weight, and unattended state without moving the item", () => {
  const actor = actorWithCapabilities([
    { implantId: "magnitnaya-ladon", type: "magneticPalm", range: 30, maximumWeight: 5 }
  ]);
  const service = new ImplantAutomationService();
  const target = { name: "Ключ", system: { weight: { value: 3 } } };

  assert.deepEqual(service.validateMagneticPalmTarget(actor, target, { distance: 25 }), {
    allowed: true,
    reason: ""
  });
  assert.equal(service.validateMagneticPalmTarget(actor, target, { distance: 35 }).reason, "range");
  assert.equal(service.validateMagneticPalmTarget(actor, {
    system: { weight: { value: 6 } }
  }, { distance: 10 }).reason, "weight");
  assert.equal(service.validateMagneticPalmTarget(actor, {
    parent: { documentName: "Actor" },
    system: { weight: { value: 1 } }
  }, { distance: 10 }).reason, "attended");
});

test("implant automation hooks delegate actor-local d20 and damage contexts", () => {
  const callbacks = new Map();
  const Hooks = {
    on(name, callback) {
      callbacks.set(name, callback);
    }
  };
  const calls = [];
  const service = {
    applyDnd5ePreRollAttack(...args) {
      calls.push(["attack", ...args]);
      return true;
    },
    applyDnd5ePreRollTool(...args) {
      calls.push(["tool", ...args]);
      return true;
    },
    applyDnd5ePreRollD20Test(...args) {
      calls.push(["roll", ...args]);
      return true;
    },
    applyDnd5ePreApplyDamage(...args) {
      calls.push(["damage", ...args]);
      return true;
    },
    handleCombatTurnChange(...args) {
      calls.push(["turn", ...args]);
      return Promise.resolve(true);
    },
    handlePreUpdateToken(...args) {
      calls.push(["pre-token", ...args]);
      return true;
    },
    handleUpdateToken(...args) {
      calls.push(["token", ...args]);
      return true;
    },
    handleCombatEnd(...args) {
      calls.push(["combat-end", ...args]);
      return Promise.resolve(true);
    }
  };

  assert.equal(registerImplantAutomationHooks({ implantAutomationService: service }, { Hooks }), true);
  callbacks.get("dnd5e.preRollAttack")({ id: "attack" }, {}, {});
  callbacks.get("dnd5e.preRollTool")({ id: "tool" }, {}, {});
  callbacks.get("dnd5e.preRollD20Test")({ id: "roll" }, {}, {});
  callbacks.get("dnd5e.preApplyDamage")({ id: "actor" }, 10, {}, { isFalling: true });
  callbacks.get("preUpdateToken")({ id: "token" }, { x: 1 });
  callbacks.get("updateToken")({ id: "token" }, { x: 1 });
  callbacks.get("combatTurnChange")({ id: "combat" }, {}, {});
  callbacks.get("deleteCombat")({ id: "combat" });
  assert.deepEqual(
    calls.map(([type]) => type),
    ["attack", "tool", "roll", "damage", "pre-token", "token", "turn", "combat-end"]
  );
});
