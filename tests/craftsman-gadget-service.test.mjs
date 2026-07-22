import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    getProperty: (object, path) => String(path).split(".").reduce((value, key) => value?.[key], object)
  }
};

const {
  CraftsmanGadgetService,
  getCraftsmanGadgetCapacity,
  getPreparedCraftsmanGadgets
} = await import("../scripts/combat/craftsman-gadget-service.js");

function classItem(level = 1) {
  return {
    id: "craftsman-class",
    type: "class",
    system: { identifier: "craftsman-v01", levels: level }
  };
}

function gadgetTemplate(id, availability = "base") {
  return {
    id: `template-${id}`,
    name: id,
    type: "feat",
    flags: {
      "rebreya-main": {
        managed: true,
        sourceType: "craftsmanGadget",
        craftsmanGadgetTemplate: { gadgetId: id, availability, requiredLevel: availability === "base" ? 1 : 2 }
      }
    },
    toObject() {
      const { toObject, ...data } = this;
      return structuredClone(data);
    }
  };
}

function preparedGadget(id, generation = "old", instanceId = `old-${id}`) {
  const item = {
    id: instanceId,
    name: id,
    type: "feat",
    flags: {
      "rebreya-main": {
        craftsmanGadget: {
          managed: true,
          catalogId: id,
          ownerUuid: "Actor.craftsman",
          instanceId,
          restGeneration: generation,
          state: "prepared",
          vehicleUuid: ""
        }
      }
    }
  };
  item.update = async (patch) => {
    for (const [path, value] of Object.entries(patch)) {
      const keys = path.split(".");
      let target = item;
      for (const key of keys.slice(0, -1)) target = target[key] ??= {};
      target[keys.at(-1)] = value;
    }
    return item;
  };
  return item;
}

function gadgetActivity(item, operation, activationType = "special") {
  return {
    item,
    actor: item.actor,
    activation: { type: activationType },
    flags: {
      "rebreya-main": {
        craftsmanGadget: {
          gadgetId: item.flags["rebreya-main"].craftsmanGadget.catalogId,
          operation
        }
      }
    }
  };
}

class TestActor {
  constructor({ level = 1, items = [], scale = null } = {}) {
    this.id = "craftsman";
    this.uuid = "Actor.craftsman";
    this.isOwner = true;
    this.flags = {};
    this.system = {
      scale: scale === null ? {} : { "craftsman-v01": { gadgets: scale } }
    };
    this.items = { contents: [classItem(level), ...items] };
    for (const item of this.items.contents) item.actor = this;
    this.created = [];
    this.deleted = [];
    this.createdEffects = [];
    this.effects = { contents: this.createdEffects };
  }

  async update(patch) {
    for (const [path, value] of Object.entries(patch)) {
      const keys = path.split(".");
      let target = this;
      for (const key of keys.slice(0, -1)) target = target[key] ??= {};
      target[keys.at(-1)] = structuredClone(value);
    }
    return this;
  }

  async createEmbeddedDocuments(type, rows) {
    if (type === "ActiveEffect") {
      const created = rows.map((row, index) => ({ ...structuredClone(row), id: `effect-${index}` }));
      this.createdEffects.push(...created);
      return created;
    }
    assert.equal(type, "Item");
    const created = rows.map((row, index) => ({ ...structuredClone(row), id: `created-${this.created.length}-${index}` }));
    this.created.push(...created);
    this.items.contents.push(...created);
    for (const item of created) item.actor = this;
    return created;
  }

  async deleteEmbeddedDocuments(type, ids) {
    if (type === "ActiveEffect") {
      this.createdEffects.splice(0, this.createdEffects.length, ...this.createdEffects.filter((effect) => !ids.includes(effect.id)));
      return ids;
    }
    assert.equal(type, "Item");
    this.deleted.push(...ids);
    this.items.contents = this.items.contents.filter((item) => !ids.includes(item.id));
    return ids;
  }
}

function makeService({ selection, mechanic = false, templates = null, randomIds = [] } = {}) {
  const documents = templates ?? [
    gadgetTemplate("force-glove"), gadgetTemplate("magnetic-engine"),
    gadgetTemplate("charged-boot"), gadgetTemplate("smoke-device"),
    gadgetTemplate("afterburner-injector", "mechanic"), gadgetTemplate("emergency-regulator", "mechanic")
  ];
  let idIndex = 0;
  return new CraftsmanGadgetService({}, {
    promptLoadout: async () => selection,
    getCraftsmanSubclasses: () => ({
      research: mechanic ? { flags: { "rebreya-main": { archetypeId: "craftsman-research-mechanic" } } } : null,
      specialty: null
    }),
    getTemplateDocuments: async () => documents,
    randomId: () => randomIds[idIndex++] ?? `generated-${idIndex}`,
    logError: () => undefined
  });
}

test("gadget capacity prefers the class scale and falls back to Craftsman level", () => {
  assert.equal(getCraftsmanGadgetCapacity(new TestActor({ level: 1 })), 2);
  assert.equal(getCraftsmanGadgetCapacity(new TestActor({ level: 5 })), 3);
  assert.equal(getCraftsmanGadgetCapacity(new TestActor({ level: 9 })), 4);
  assert.equal(getCraftsmanGadgetCapacity(new TestActor({ level: 13 })), 5);
  assert.equal(getCraftsmanGadgetCapacity(new TestActor({ level: 17 })), 6);
  assert.equal(getCraftsmanGadgetCapacity(new TestActor({ level: 1, scale: { value: 4 } })), 4);
});

test("long rest creates duplicate gadget instances with one fresh generation", async () => {
  const actor = new TestActor({ level: 1, items: [preparedGadget("smoke-device")] });
  const service = makeService({
    selection: ["force-glove", "force-glove"],
    randomIds: ["generation-new", "instance-a", "instance-b"]
  });

  assert.equal(await service.handleRestCompleted(actor, { type: "long" }, {}), true);
  const gadgets = getPreparedCraftsmanGadgets(actor);
  assert.deepEqual(gadgets.map((item) => item.flags["rebreya-main"].craftsmanGadget.catalogId), [
    "force-glove", "force-glove"
  ]);
  assert.deepEqual(gadgets.map((item) => item.flags["rebreya-main"].craftsmanGadget.instanceId), [
    "instance-a", "instance-b"
  ]);
  assert.ok(gadgets.every((item) => item.flags["rebreya-main"].craftsmanGadget.restGeneration === "generation-new"));
  assert.equal(actor.flags["rebreya-main"].craftsmanGadgets.restGeneration, "generation-new");
  assert.deepEqual(actor.deleted, ["old-smoke-device"]);
});

test("Mechanic templates are hidden from other Craftsmen and allowed for Mechanic", async () => {
  const actor = new TestActor({ level: 2 });
  let observed = null;
  const ordinary = makeService({ selection: null });
  ordinary.options.promptLoadout = async (_actor, choices) => {
    observed = choices;
    return null;
  };
  await ordinary.handleRestCompleted(actor, { longRest: true }, {});
  assert.equal(observed.some((entry) => entry.availability === "mechanic"), false);

  const mechanic = makeService({ selection: null, mechanic: true });
  mechanic.options.promptLoadout = async (_actor, choices) => {
    observed = choices;
    return null;
  };
  await mechanic.handleRestCompleted(actor, { longRest: true }, {});
  assert.equal(observed.filter((entry) => entry.availability === "mechanic").length, 2);
});

test("cancelling selection recreates the previous types as a fresh generation", async () => {
  const actor = new TestActor({
    level: 1,
    items: [preparedGadget("force-glove"), preparedGadget("smoke-device")]
  });
  const service = makeService({ selection: null, randomIds: ["generation-new", "instance-a", "instance-b"] });
  await service.handleRestCompleted(actor, { type: "long" }, {});
  const gadgets = getPreparedCraftsmanGadgets(actor);
  assert.deepEqual(gadgets.map((item) => item.flags["rebreya-main"].craftsmanGadget.catalogId), [
    "force-glove", "smoke-device"
  ]);
  assert.ok(gadgets.every((item) => item.flags["rebreya-main"].craftsmanGadget.restGeneration === "generation-new"));
});

test("failed creation rolls back only the new generation and retains old gadgets", async () => {
  const old = preparedGadget("smoke-device");
  const actor = new TestActor({ level: 1, items: [old] });
  actor.createEmbeddedDocuments = async function createThenFail(_type, rows) {
    const partial = { ...structuredClone(rows[0]), id: "partial-new" };
    this.items.contents.push(partial);
    throw new Error("create failed");
  };
  const service = makeService({
    selection: ["force-glove", "magnetic-engine"],
    randomIds: ["generation-new", "instance-a", "instance-b"]
  });

  assert.equal(await service.handleRestCompleted(actor, { type: "long" }, {}), false);
  assert.deepEqual(getPreparedCraftsmanGadgets(actor), []);
  assert.equal(actor.items.contents.includes(old), true);
  assert.deepEqual(actor.deleted, ["partial-new"]);
});

test("old generation expires before the preparation prompt opens", async () => {
  const old = preparedGadget("smoke-device");
  const actor = new TestActor({ level: 1, items: [old] });
  const service = makeService({ randomIds: ["generation-new", "instance-a"] });
  service.options.promptLoadout = async () => {
    assert.equal(actor.flags["rebreya-main"].craftsmanGadgets.restGeneration, "generation-new");
    assert.deepEqual(getPreparedCraftsmanGadgets(actor), []);
    return null;
  };

  await service.handleRestCompleted(actor, { type: "long" }, {});
});

test("activating another gadget spends the previous active instance", async () => {
  const first = preparedGadget("force-glove", "current", "first");
  const second = preparedGadget("charged-boot", "current", "second");
  const actor = new TestActor({ items: [first, second] });
  const service = makeService();
  service.options.worldTime = () => 100;

  await service.applyDnd5ePostUseActivity(gadgetActivity(first, "activate", "bonus"), {}, {}, {});
  await service.applyDnd5ePostUseActivity(gadgetActivity(second, "activate"), {}, {}, {});

  assert.equal(first.flags["rebreya-main"].craftsmanGadget.state, "spent");
  assert.equal(second.flags["rebreya-main"].craftsmanGadget.state, "active");
  assert.equal(second.flags["rebreya-main"].craftsmanGadget.expiresAtWorldTime, 160);
  assert.equal(actor.flags["rebreya-main"].craftsmanGadgets.activeInstanceId, "second");
  assert.equal(actor.items.contents.includes(first), true);
});

test("gadget action is accepted once only while its instance is active", async () => {
  const item = preparedGadget("force-glove", "current", "g1");
  const actor = new TestActor({ items: [item] });
  const service = makeService();
  service.options.worldTime = () => 100;
  const activation = gadgetActivity(item, "activate");
  const action = gadgetActivity(item, "action");

  assert.equal(service.applyDnd5ePreUseActivity(action), false);
  await service.applyDnd5ePostUseActivity(activation, {}, {}, {});
  assert.equal(service.applyDnd5ePreUseActivity(action), true);
  await service.applyDnd5ePostUseActivity(action, {}, {}, {});
  assert.equal(service.applyDnd5ePreUseActivity(action), false);
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.actionUsed, true);
  assert.equal(actor.items.contents.includes(item), true);
});

test("world time expiry permanently spends an active gadget", async () => {
  const item = preparedGadget("smoke-device", "current", "g1");
  new TestActor({ items: [item] });
  const service = makeService();
  service.options.worldTime = () => 100;
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {}, {}, {});
  await service.handleWorldTime(159);
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.state, "active");
  await service.handleWorldTime(160);
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.state, "spent");
});

test("world time expiry discovers persisted actors after reload and tears down smoke", async () => {
  const smoke = preparedGadget("smoke-device", "current", "smoke-reload");
  const actor = new TestActor({ items: [smoke] });
  actor.flags["rebreya-main"] = {
    craftsmanGadgets: { restGeneration: "current", activeInstanceId: "smoke-reload" }
  };
  smoke.flags["rebreya-main"].craftsmanGadget.state = "active";
  smoke.flags["rebreya-main"].craftsmanGadget.expiresAtWorldTime = 100;
  const deleted = [];
  const service = makeService();
  service.options.actorDocuments = () => [actor];
  service.options.isActiveGmClient = () => true;
  service.options.zoneService = { deleteByInstanceId: async (id) => deleted.push(id) };

  assert.equal(await service.handleWorldTime(101), true);
  assert.equal(smoke.flags["rebreya-main"].craftsmanGadget.state, "spent");
  assert.deepEqual(deleted, ["smoke-reload"]);
});

test("replacing an active gadget tears down smoke, boot effect, and vehicle state", async () => {
  const smoke = preparedGadget("smoke-device", "current", "smoke-cleanup");
  const boot = preparedGadget("charged-boot", "current", "boot-cleanup");
  const afterburner = preparedGadget("afterburner-injector", "current", "vehicle-cleanup");
  const force = preparedGadget("force-glove", "current", "force-cleanup");
  afterburner.flags["rebreya-main"].craftsmanGadget.vehicleUuid = "Actor.vehicle";
  const actor = new TestActor({ items: [smoke, boot, afterburner, force] });
  actor.flags["rebreya-main"] = { craftsmanGadgets: { restGeneration: "current" } };
  const calls = [];
  const vehicle = { uuid: "Actor.vehicle", type: "vehicle" };
  const service = makeService();
  service.options.zoneService = { deleteByInstanceId: async (id) => calls.push(["smoke", id]) };
  service.options.vehicleService = {
    resolveVehicle: async () => vehicle,
    activateAfterburner: async () => true,
    deactivateGadget: async (_vehicle, state) => calls.push(["vehicle", state.instanceId])
  };

  await service.applyDnd5ePostUseActivity(gadgetActivity(smoke, "activate"), {}, {});
  await service.applyDnd5ePostUseActivity(gadgetActivity(boot, "activate"), {}, {});
  assert.deepEqual(calls[0], ["smoke", "smoke-cleanup"]);
  assert.equal(actor.createdEffects.length, 1);

  await service.applyDnd5ePostUseActivity(gadgetActivity(afterburner, "activate"), {}, {});
  assert.equal(actor.createdEffects.length, 0);
  await service.applyDnd5ePostUseActivity(gadgetActivity(force, "activate"), {}, {});
  assert.deepEqual(calls.at(-1), ["vehicle", "vehicle-cleanup"]);
});

test("deleting an active gadget runs the same teardown path", async () => {
  const smoke = preparedGadget("smoke-device", "current", "smoke-delete");
  const actor = new TestActor({ items: [smoke] });
  actor.flags["rebreya-main"] = { craftsmanGadgets: { restGeneration: "current" } };
  const deleted = [];
  const service = makeService();
  service.options.zoneService = { deleteByInstanceId: async (id) => deleted.push(id) };
  await service.applyDnd5ePostUseActivity(gadgetActivity(smoke, "activate"), {}, {});

  await service.handleDeletedItem(smoke);

  assert.deepEqual(deleted, ["smoke-delete"]);
});

test("Force Glove action grants the next attack advantage and a confirmed hit adds Intelligence damage once", async () => {
  const item = preparedGadget("force-glove", "current", "force");
  const actor = new TestActor({ items: [item] });
  actor.system.abilities = { int: { mod: 4 } };
  const service = makeService();
  service.options.worldTime = () => 100;
  service.options.turnKey = () => "combat:1:2";
  service.options.confirmForceDamage = async () => true;
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {}, {}, {});
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "action"), {}, {}, {});

  const attackConfig = { subject: { actor, item: { type: "weapon" } }, rolls: [{ options: {} }] };
  const attackDialog = {};
  service.applyDnd5eAttackRollConfig(attackConfig, attackDialog, {});
  assert.equal(attackDialog.advantage, true);
  await service.applyDnd5eRollAttack([{ total: 18, options: { target: 15 } }], { subject: attackConfig.subject });

  const damage = { subject: attackConfig.subject, rolls: [{ base: true, parts: ["1d8"] }] };
  assert.equal(service.applyDnd5ePreRollDamage(damage), true);
  assert.deepEqual(damage.rolls[0].parts, ["1d8", "@abilities.int.mod"]);
  const secondDamage = { subject: attackConfig.subject, rolls: [{ base: true, parts: ["1d8"] }] };
  service.applyDnd5ePreRollDamage(secondDamage);
  assert.deepEqual(secondDamage.rolls[0].parts, ["1d8"]);
});

test("Force Glove marks its damage before the non-awaited native rollAttack hook returns", async () => {
  const item = preparedGadget("force-glove", "current", "force-sync");
  const actor = new TestActor({ items: [item] });
  const service = makeService();
  service.options.turnKey = () => "combat:1:2";
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {}, {}, {});
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "action"), {}, {}, {});
  const subject = { actor, item: { type: "weapon" } };

  void service.applyDnd5eRollAttack([{ total: 18, options: { target: 15 } }], { subject });
  const damage = { subject, rolls: [{ base: true, parts: ["1d8"] }] };
  service.applyDnd5ePreRollDamage(damage);

  assert.deepEqual(damage.rolls[0].parts, ["1d8", "@abilities.int.mod"]);
});

test("Charged Boot activation adds walk speed and its action suppresses provoked attacks for the turn", async () => {
  const item = preparedGadget("charged-boot", "current", "boot");
  const actor = new TestActor({ items: [item] });
  const service = makeService();
  service.options.turnKey = () => "combat:1:2";
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {}, {}, {});
  assert.deepEqual(actor.createdEffects[0].changes, [{
    key: "system.attributes.movement.walk", mode: 2, value: "10", priority: 20
  }]);
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "action"), {}, {}, {});
  assert.equal(service.suppressesProvokedAttack(actor), true);
  await service.handleCombatTurnChange({ id: "combat", round: 1, turn: 3 });
  assert.equal(service.suppressesProvokedAttack(actor), false);
});

test("Magnetic Engine grants two AC only against weapon attacks", async () => {
  const item = preparedGadget("magnetic-engine", "current", "magnet");
  const actor = new TestActor({ items: [item] });
  const service = makeService();
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {}, {}, {});
  assert.equal(service.getWeaponAttackAcBonus(actor, { item: { type: "weapon" } }), 2);
  assert.equal(service.getWeaponAttackAcBonus(actor, { item: { type: "spell" } }), 0);
  assert.equal(service.getWeaponAttackAcBonus(new TestActor(), { item: { type: "weapon" } }), 0);
});

test("native attack targeting applies Magnetic Engine AC and smoke obscuration", async () => {
  const magnetic = preparedGadget("magnetic-engine", "current", "magnet");
  const targetActor = new TestActor({ items: [magnetic] });
  const attacker = new TestActor();
  const sourceToken = { id: "source", actor: attacker };
  const targetToken = { id: "target", actor: targetActor };
  const service = makeService();
  service.options.attackTargets = () => [targetToken];
  service.options.sourceToken = () => sourceToken;
  service.options.zoneService = {
    isSightObscured: (source, target) => source === sourceToken && target === targetToken
  };
  await service.applyDnd5ePostUseActivity(gadgetActivity(magnetic, "activate"), {}, {}, {});

  const config = {
    subject: { actor: attacker, item: { type: "weapon" } },
    target: 15,
    rolls: [{ options: {} }]
  };
  const dialog = {};
  service.applyDnd5eAttackRollConfig(config, dialog);

  assert.equal(config.target, 17);
  assert.equal(dialog.disadvantage, true);
  assert.equal(config.rolls[0].options.disadvantage, true);
});

test("Smoke Device registers the native activation template and poisons that same cloud", async () => {
  const item = preparedGadget("smoke-device", "current", "smoke");
  new TestActor({ items: [item] });
  const calls = [];
  const service = makeService();
  service.options.zoneService = {
    registerTemplate: (template) => calls.push(["register", template]),
    poisonTemplate: async (instanceId, context) => calls.push(["poison", instanceId, context])
  };
  const cloud = { id: "cloud" };
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {}, { templates: [[cloud]] });
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "action"), {}, {});
  assert.equal(calls[0][0], "register");
  assert.equal(calls[0][1], cloud);
  assert.deepEqual(calls[1].slice(0, 2), ["poison", "smoke"]);
});

test("cancelled smoke placement fallback unwraps the single native template document", async () => {
  const item = preparedGadget("smoke-device", "current", "smoke-fallback");
  new TestActor({ items: [item] });
  const cloud = { id: "placed-cloud" };
  let fallbackResult = null;
  const previousDnd5e = globalThis.dnd5e;
  globalThis.dnd5e = {
    canvas: {
      AbilityTemplate: {
        fromActivity: () => [{ drawPreview: async () => [cloud] }]
      }
    }
  };
  const service = makeService();
  service.options.zoneService = {
    poisonTemplate: async (_instanceId, context) => {
      fallbackResult = await context.createPoisonedTemplate(context);
    }
  };

  try {
    await service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {}, { templates: [] });
    await service.applyDnd5ePostUseActivity(gadgetActivity(item, "action"), {}, {});
    assert.equal(fallbackResult, cloud);
  }
  finally {
    globalThis.dnd5e = previousDnd5e;
  }
});

test("Mechanic gadget instances bind to the research vehicle and delegate activation/action", async () => {
  const targetVehicle = { uuid: "Actor.vehicle", type: "vehicle" };
  const vehicleCalls = [];
  const vehicleService = {
    resolveResearchObject: async () => targetVehicle,
    activateAfterburner: async (...args) => vehicleCalls.push(["activateAfterburner", ...args]),
    useAfterburnerAction: async (...args) => vehicleCalls.push(["useAfterburnerAction", ...args])
  };
  const actor = new TestActor({ level: 2 });
  const service = makeService({
    mechanic: true,
    selection: ["afterburner-injector", "afterburner-injector"],
    randomIds: ["generation", "afterburner-a", "afterburner-b"]
  });
  service.options.vehicleService = vehicleService;
  await service.handleRestCompleted(actor, { longRest: true }, {});
  const item = getPreparedCraftsmanGadgets(actor)[0];
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.vehicleUuid, targetVehicle.uuid);
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {}, {});
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "action"), {}, {});
  assert.deepEqual(vehicleCalls.map((entry) => entry[0]), ["activateAfterburner", "useAfterburnerAction"]);
});

test("Mechanic preparation opens research object selection when no vehicle is bound", async () => {
  const targetVehicle = { uuid: "Actor.selected-vehicle", type: "vehicle" };
  let selections = 0;
  const actor = new TestActor({ level: 2 });
  const service = makeService({
    mechanic: true,
    selection: ["afterburner-injector", "afterburner-injector"],
    randomIds: ["generation", "afterburner-a", "afterburner-b"]
  });
  service.options.vehicleService = {
    resolveResearchObject: async () => null,
    selectResearchObject: async () => {
      selections += 1;
      return targetVehicle;
    }
  };

  await service.handleRestCompleted(actor, { longRest: true }, {});

  assert.equal(selections, 1);
  assert.ok(getPreparedCraftsmanGadgets(actor).every((item) => (
    item.flags["rebreya-main"].craftsmanGadget.vehicleUuid === targetVehicle.uuid
  )));
});
