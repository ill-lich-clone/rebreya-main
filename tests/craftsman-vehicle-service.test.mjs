import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => structuredClone(value),
    getProperty: (object, path) => String(path).split(".").reduce((value, key) => value?.[key], object)
  }
};

const { CraftsmanVehicleService } = await import("../scripts/combat/craftsman-vehicle-service.js");

function updatable(document) {
  document.update = async (patch) => {
    for (const [path, value] of Object.entries(patch)) {
      const keys = path.split(".");
      let target = document;
      for (const key of keys.slice(0, -1)) target = target[key] ??= {};
      target[keys.at(-1)] = structuredClone(value);
    }
    return document;
  };
  return document;
}

function owner() {
  return updatable({
    uuid: "Actor.owner",
    flags: {},
    system: { attributes: { prof: 3 } }
  });
}

function vehicle({ acceleration, movement = { land: 40, water: 0, fly: 0 } } = {}) {
  return updatable({
    uuid: "Actor.vehicle",
    type: "vehicle",
    isOwner: true,
    flags: {
      "rebreya-main": {
        vehicleState: {
          ...(acceleration === undefined ? {} : { acceleration }),
          breakdownThreshold: 2
        }
      }
    },
    system: {
      attributes: {
        movement: structuredClone(movement),
        travel: { speeds: { land: 4, water: 0, air: 0 } }
      }
    }
  });
}

test("research object binding accepts only an owned vehicle", async () => {
  const craftsman = owner();
  const target = vehicle();
  const service = new CraftsmanVehicleService({ fromUuid: async () => target });
  assert.equal(await service.bindResearchObject(craftsman, target.uuid), true);
  assert.equal(craftsman.flags["rebreya-main"].craftsman.researchObjectUuid, target.uuid);

  target.type = "npc";
  assert.equal(await service.bindResearchObject(craftsman, target.uuid), false);
  target.type = "vehicle";
  target.isOwner = false;
  assert.equal(await service.bindResearchObject(craftsman, target.uuid), false);
});

test("Afterburner passive increases acceleration when the vehicle has it", async () => {
  const target = vehicle({ acceleration: 20 });
  const service = new CraftsmanVehicleService();
  await service.activateAfterburner(target, owner(), { instanceId: "afterburner" });
  assert.equal(target.flags["rebreya-main"].vehicleState.acceleration, 30);
  assert.equal(target.system.attributes.movement.land, 40);
});

test("Afterburner passive increases existing speeds when acceleration is absent", async () => {
  const target = vehicle();
  const service = new CraftsmanVehicleService();
  await service.activateAfterburner(target, owner(), { instanceId: "afterburner" });
  assert.deepEqual(target.system.attributes.movement, { land: 50, water: 0, fly: 0 });
  assert.deepEqual(target.system.attributes.travel.speeds, { land: 14, water: 0, air: 0 });
});

test("Afterburner action grants 10 times proficiency speed until turn end then rolls breakdown", async () => {
  const target = vehicle();
  const rolls = [];
  const service = new CraftsmanVehicleService({
    rollD20: async () => ({ total: 7 }),
    emitBreakdown: (context) => rolls.push(context)
  });
  await service.useAfterburnerAction(target, owner(), { instanceId: "afterburner", turnKey: "combat:1:2" });
  assert.equal(target.system.attributes.movement.land, 70);
  await service.handleCombatTurnChange("combat:1:3");
  assert.equal(target.system.attributes.movement.land, 40);
  assert.equal(rolls[0].selectedTotal, 7);
  assert.equal(rolls[0].effectiveThreshold, 2);
});

test("Emergency Regulator lowers effective threshold and lets the player choose a reroll", async () => {
  const target = vehicle();
  const d20 = [{ total: 1 }, { total: 14 }];
  const emitted = [];
  const service = new CraftsmanVehicleService({
    rollD20: async () => d20.shift(),
    chooseBreakdownRoll: async ({ rolls }) => rolls[1],
    emitBreakdown: (context) => emitted.push(context)
  });
  await service.activateEmergencyRegulator(target, owner(), { instanceId: "regulator" });
  const result = await service.rollBreakdown(target, { sourceInstanceId: "afterburner", allowReroll: true });
  assert.equal(result.baseThreshold, 2);
  assert.equal(result.effectiveThreshold, 1);
  assert.deepEqual(result.rolls, [1, 14]);
  assert.equal(result.selectedTotal, 14);
  assert.deepEqual(emitted, [result]);
  assert.equal(Object.hasOwn(result, "consequence"), false);
});
