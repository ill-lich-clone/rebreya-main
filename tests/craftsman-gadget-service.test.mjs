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

function gadgetActivitySources(id) {
  const build = (activityId, operation) => ({
    _id: activityId,
    type: "utility",
    name: operation,
    flags: {
      "rebreya-main": {
        craftsmanGadget: { gadgetId: id, operation }
      }
    }
  });
  return {
    aaaaaaaaaaaaaaaa: build("aaaaaaaaaaaaaaaa", "activate"),
    bbbbbbbbbbbbbbbb: build("bbbbbbbbbbbbbbbb", "activate"),
    cccccccccccccccc: build("cccccccccccccccc", "action")
  };
}

function applyFlatPatch(target, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split(".");
    let destination = target;
    for (const key of keys.slice(0, -1)) destination = destination[key] ??= {};
    destination[keys.at(-1)] = structuredClone(value);
  }
}

function attachTestItemMethods(item) {
  item.update ??= async (patch) => {
    if (item.failNextUpdate) {
      item.failNextUpdate = false;
      throw new Error("item update failed");
    }
    applyFlatPatch(item, patch);
    return item;
  };
  item.toObject ??= () => {
    const { actor, update, toObject, failNextUpdate, ...data } = item;
    return structuredClone(data);
  };
  return item;
}

function preparedGadget(id, generation = "old", instanceId = `old-${id}`, quantity = 1) {
  const activitySources = gadgetActivitySources(id);
  const item = {
    id: instanceId,
    name: id,
    type: "rebreya-main.gadget",
    system: {
      quantity,
      activities: {
        aaaaaaaaaaaaaaaa: structuredClone(activitySources.aaaaaaaaaaaaaaaa),
        bbbbbbbbbbbbbbbb: structuredClone(activitySources.bbbbbbbbbbbbbbbb)
      }
    },
    flags: {
      "rebreya-main": {
        craftsmanGadgetActivities: activitySources,
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
  return attachTestItemMethods(item);
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
    for (const item of created) {
      item.actor = this;
      attachTestItemMethods(item);
    }
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

function makeService({ selection, mechanic = false, templates = null, randomIds = [], moduleApi = {} } = {}) {
  const documents = templates ?? [
    gadgetTemplate("force-glove"), gadgetTemplate("magnetic-engine"),
    gadgetTemplate("charged-boot"), gadgetTemplate("smoke-device"),
    gadgetTemplate("afterburner-injector", "mechanic"), gadgetTemplate("emergency-regulator", "mechanic")
  ];
  let idIndex = 0;
  return new CraftsmanGadgetService(moduleApi, {
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

test("long rest groups duplicate choices into one fresh physical gadget stack", async () => {
  const actor = new TestActor({ level: 1, items: [preparedGadget("smoke-device")] });
  const service = makeService({
    selection: ["force-glove", "force-glove"],
    randomIds: ["generation-new", "instance-a"]
  });

  assert.equal(await service.handleRestCompleted(actor, { type: "long" }, {}), true);
  const gadgets = getPreparedCraftsmanGadgets(actor);
  assert.equal(gadgets.length, 1);
  assert.equal(gadgets[0].type, "rebreya-main.gadget");
  assert.equal(gadgets[0].system.quantity, 2);
  assert.equal(gadgets[0].flags["rebreya-main"].craftsmanGadget.catalogId, "force-glove");
  assert.equal(gadgets[0].flags["rebreya-main"].craftsmanGadget.instanceId, "instance-a");
  assert.ok(gadgets.every((item) => item.flags["rebreya-main"].craftsmanGadget.restGeneration === "generation-new"));
  assert.equal(actor.flags["rebreya-main"].craftsmanGadgets.restGeneration, "generation-new");
  assert.deepEqual(actor.flags["rebreya-main"].craftsmanGadgets.selectedIds, ["force-glove", "force-glove"]);
  assert.deepEqual(actor.deleted, ["old-smoke-device"]);
});

test("level 17 groups six selections of two unique gadgets into 3 + 3 stacks", async () => {
  const actor = new TestActor({ level: 17 });
  const service = makeService({
    selection: [
      "charged-boot", "charged-boot", "charged-boot",
      "force-glove", "force-glove", "force-glove"
    ],
    randomIds: ["generation-new", "instance-boot", "instance-glove"]
  });

  assert.equal(await service.handleRestCompleted(actor, { type: "long" }, {}), true);
  const gadgets = getPreparedCraftsmanGadgets(actor);
  assert.equal(gadgets.length, 2);
  assert.deepEqual(
    gadgets.map((item) => [item.flags["rebreya-main"].craftsmanGadget.catalogId, item.system.quantity]),
    [["charged-boot", 3], ["force-glove", 3]]
  );
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

test("cancelling long-rest selection keeps the previous generation unchanged", async () => {
  const actor = new TestActor({
    level: 1,
    items: [preparedGadget("force-glove", "old", "old-force", 2)]
  });
  const service = makeService({ selection: null, randomIds: ["generation-new", "instance-a"] });

  assert.equal(await service.handleRestCompleted(actor, { type: "long" }, {}), false);

  const gadgets = getPreparedCraftsmanGadgets(actor);
  assert.equal(gadgets.length, 1);
  assert.equal(gadgets[0].flags["rebreya-main"].craftsmanGadget.catalogId, "force-glove");
  assert.equal(gadgets[0].system.quantity, 2);
  assert.equal(gadgets[0].flags["rebreya-main"].craftsmanGadget.restGeneration, "old");
  assert.deepEqual(actor.created, []);
  assert.deepEqual(actor.deleted, []);
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
  assert.deepEqual(getPreparedCraftsmanGadgets(actor), [old]);
  assert.equal(actor.items.contents.includes(old), true);
  assert.deepEqual(actor.deleted, ["partial-new"]);
  assert.equal(actor.flags["rebreya-main"]?.craftsmanGadgets, undefined);
});

test("old generation remains authoritative until the replacement set is complete", async () => {
  const old = preparedGadget("smoke-device");
  const actor = new TestActor({ level: 1, items: [old] });
  const service = makeService({ randomIds: ["generation-new", "instance-a"] });
  service.options.promptLoadout = async () => {
    assert.equal(actor.flags["rebreya-main"]?.craftsmanGadgets, undefined);
    assert.deepEqual(getPreparedCraftsmanGadgets(actor), [old]);
    return null;
  };

  await service.handleRestCompleted(actor, { type: "long" }, {});
});

test("next long rest removes managed prepared active and spent gadgets from every generation", async () => {
  const prepared = preparedGadget("force-glove", "current", "old-prepared");
  const active = preparedGadget("smoke-device", "older", "old-active");
  const spent = preparedGadget("charged-boot", "oldest", "old-spent");
  active.flags["rebreya-main"].craftsmanGadget.state = "active";
  spent.flags["rebreya-main"].craftsmanGadget.state = "spent";
  const unmanaged = preparedGadget("magnetic-engine", "foreign", "unmanaged");
  unmanaged.flags["rebreya-main"].craftsmanGadget.managed = false;
  const actor = new TestActor({ level: 1, items: [prepared, active, spent, unmanaged] });
  actor.flags["rebreya-main"] = {
    craftsmanGadgets: {
      restGeneration: "current",
      selectedIds: ["force-glove", "force-glove"]
    }
  };
  const cleanedSmoke = [];
  const service = makeService({
    selection: ["force-glove", "force-glove"],
    randomIds: ["generation-new", "instance-new"]
  });
  service.options.zoneService = { deleteByInstanceId: async (id) => cleanedSmoke.push(id) };

  assert.equal(await service.handleRestCompleted(actor, { type: "long" }, {}), true);
  assert.equal(actor.items.contents.includes(prepared), false);
  assert.equal(actor.items.contents.includes(active), false);
  assert.equal(actor.items.contents.includes(spent), false);
  assert.equal(actor.items.contents.includes(unmanaged), true);
  assert.deepEqual(cleanedSmoke, ["old-active"]);
  assert.deepEqual(actor.deleted.sort(), ["old-active", "old-prepared", "old-spent"].sort());
});

test("activating a quantity-one gadget updates the same inventory Item", async () => {
  const item = preparedGadget("force-glove", "current", "single", 1);
  const actor = new TestActor({ items: [item] });
  const service = makeService();

  assert.equal(await service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate")), true);

  const managed = getPreparedCraftsmanGadgets(actor);
  assert.equal(managed.length, 1);
  assert.equal(managed[0], item);
  assert.equal(item.name, "force-glove (активный)");
  assert.equal(item.system.quantity, 1);
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.state, "active");
  assert.deepEqual(
    Object.values(item.system.activities).map((entry) => entry.flags["rebreya-main"].craftsmanGadget.operation),
    ["action"]
  );
  assert.equal(actor.created.length, 0);
});

test("activating a stack splits one active Item and leaves a smaller prepared stack", async () => {
  const item = preparedGadget("force-glove", "current", "stack-instance", 3);
  const actor = new TestActor({ items: [item] });
  const service = makeService({ randomIds: ["next-stack-instance"] });

  assert.equal(await service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate")), true);

  const prepared = getPreparedCraftsmanGadgets(actor).find((entry) => (
    entry.flags["rebreya-main"].craftsmanGadget.state === "prepared"
  ));
  const active = getPreparedCraftsmanGadgets(actor).find((entry) => (
    entry.flags["rebreya-main"].craftsmanGadget.state === "active"
  ));
  assert.equal(prepared, item);
  assert.equal(prepared.system.quantity, 2);
  assert.equal(prepared.flags["rebreya-main"].craftsmanGadget.instanceId, "next-stack-instance");
  assert.equal(prepared.name, "force-glove");
  assert.notEqual(active, item);
  assert.equal(active.system.quantity, 1);
  assert.equal(active.flags["rebreya-main"].craftsmanGadget.instanceId, "stack-instance");
  assert.equal(active.name, "force-glove (активный)");
  assert.deepEqual(
    Object.values(active.system.activities).map((entry) => entry.flags["rebreya-main"].craftsmanGadget.operation),
    ["action"]
  );
  assert.equal(actor.flags["rebreya-main"].craftsmanGadgets.activeInstanceId, "stack-instance");
});

test("smoke stack activation keeps the workflow instance ID on the active split Item", async () => {
  const item = preparedGadget("smoke-device", "current", "smoke-workflow", 2);
  const actor = new TestActor({ items: [item] });
  const service = makeService({ randomIds: ["smoke-remainder"] });
  const templateData = {};
  const activation = gadgetActivity(item, "activate");
  service.applyDnd5ePreCreateActivityTemplate(activation, templateData);

  await service.applyDnd5ePostUseActivity(activation, {}, {}, {});

  const active = getPreparedCraftsmanGadgets(actor).find((entry) => (
    entry.flags["rebreya-main"].craftsmanGadget.state === "active"
  ));
  assert.equal(templateData.flags["rebreya-main"].craftsmanSmoke.instanceId, "smoke-workflow");
  assert.equal(active.flags["rebreya-main"].craftsmanGadget.instanceId, "smoke-workflow");
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.instanceId, "smoke-remainder");
});

test("failed stack update removes the active clone without consuming quantity", async () => {
  const item = preparedGadget("force-glove", "current", "rollback-stack", 2);
  const actor = new TestActor({ items: [item] });
  const service = makeService({ randomIds: ["rollback-remainder"] });
  item.failNextUpdate = true;

  await assert.rejects(
    service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate")),
    /item update failed/u
  );

  assert.equal(item.system.quantity, 2);
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.instanceId, "rollback-stack");
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.state, "prepared");
  assert.deepEqual(getPreparedCraftsmanGadgets(actor), [item]);
  assert.equal(actor.deleted.length, 1);
});

test("concurrent activation hooks consume a prepared stack only once", async () => {
  const item = preparedGadget("force-glove", "current", "queued-stack", 2);
  const actor = new TestActor({ items: [item] });
  const service = makeService({ randomIds: ["queued-remainder"] });
  const activation = gadgetActivity(item, "activate");

  await Promise.all([
    service.applyDnd5ePostUseActivity(activation),
    service.applyDnd5ePostUseActivity(activation)
  ]);

  const states = getPreparedCraftsmanGadgets(actor).map((entry) => (
    [entry.flags["rebreya-main"].craftsmanGadget.state, entry.system.quantity]
  )).sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(states, [["active", 1], ["prepared", 1]]);
});

test("zero-quantity gadget stacks cannot be activated", async () => {
  const item = preparedGadget("force-glove", "current", "empty-stack", 0);
  const actor = new TestActor({ items: [item] });
  const service = makeService();
  const activation = gadgetActivity(item, "activate");

  assert.equal(service.applyDnd5ePreUseActivity(activation, {}), false);
  assert.equal(await service.applyDnd5ePostUseActivity(activation, {}), false);
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.state, "prepared");
  assert.equal(item.system.quantity, 0);
  assert.equal(actor.created.length, 0);
});

test("template creation reserves one actor activation before smoke can be created twice", async () => {
  const item = preparedGadget("smoke-device", "current", "reserved-smoke", 2);
  new TestActor({ items: [item] });
  const service = makeService({ randomIds: ["smoke-remainder"] });
  const firstUsage = {};
  const secondUsage = {};
  const firstActivity = gadgetActivity(item, "activate");
  const secondActivity = gadgetActivity(item, "activate");

  assert.equal(service.applyDnd5ePreUseActivity(firstActivity, firstUsage), true);
  assert.equal(service.applyDnd5ePreUseActivity(secondActivity, secondUsage), true);
  const templateData = {};
  assert.equal(service.applyDnd5ePreCreateActivityTemplate(firstActivity, templateData), true);
  assert.equal(service.applyDnd5ePreCreateActivityTemplate(secondActivity, {}), false);
  assert.equal(templateData.flags["rebreya-main"].craftsmanSmoke.instanceId, "reserved-smoke");

  await service.applyDnd5ePostUseActivity(firstActivity, firstUsage, {}, {});
  assert.equal(service.applyDnd5ePreUseActivity(gadgetActivity(item, "activate"), {}), true);
});

test("two different prepared Items on one actor cannot become active concurrently", async () => {
  const first = preparedGadget("force-glove", "current", "actor-first", 1);
  const second = preparedGadget("charged-boot", "current", "actor-second", 1);
  const actor = new TestActor({ items: [first, second] });
  const service = makeService();

  await Promise.all([
    service.applyDnd5ePostUseActivity(gadgetActivity(first, "activate"), {}),
    service.applyDnd5ePostUseActivity(gadgetActivity(second, "activate"), {})
  ]);

  assert.deepEqual(
    getPreparedCraftsmanGadgets(actor).map((item) => item.flags["rebreya-main"].craftsmanGadget.state),
    ["active", "prepared"]
  );
});

test("concurrent gadget action hooks execute their side effect only once", async () => {
  const item = preparedGadget("afterburner-injector", "current", "action-once", 1);
  item.flags["rebreya-main"].craftsmanGadget.vehicleUuid = "Actor.vehicle";
  new TestActor({ items: [item] });
  let actionCalls = 0;
  const service = makeService();
  service.options.vehicleService = {
    resolveResearchObject: async () => ({ uuid: "Actor.vehicle", type: "vehicle" }),
    activateAfterburner: async () => true,
    useAfterburnerAction: async () => { actionCalls += 1; }
  };
  await service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {});
  const action = gadgetActivity(item, "action");

  await Promise.all([
    service.applyDnd5ePostUseActivity(action, {}),
    service.applyDnd5ePostUseActivity(action, {})
  ]);

  assert.equal(actionCalls, 1);
});

test("long rest serializes behind activation and removes the activated old generation", async () => {
  const item = preparedGadget("force-glove", "current", "rest-race", 2);
  const actor = new TestActor({ level: 1, items: [item] });
  const service = makeService({
    selection: ["charged-boot", "charged-boot"],
    randomIds: ["activation-remainder", "rest-generation", "rest-instance"]
  });

  await Promise.all([
    service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {}),
    service.handleRestCompleted(actor, { type: "long" }, {})
  ]);

  const managed = getPreparedCraftsmanGadgets(actor);
  assert.equal(managed.length, 1);
  assert.equal(managed[0].flags["rebreya-main"].craftsmanGadget.catalogId, "charged-boot");
  assert.equal(managed[0].flags["rebreya-main"].craftsmanGadget.state, "prepared");
  assert.equal(managed[0].system.quantity, 2);
});

test("activation effect failure restores the source stack and removes the active clone", async () => {
  const item = preparedGadget("afterburner-injector", "current", "effect-rollback", 2);
  item.flags["rebreya-main"].craftsmanGadget.vehicleUuid = "Actor.vehicle";
  const actor = new TestActor({ items: [item] });
  const service = makeService({ randomIds: ["failed-remainder"] });
  service.options.vehicleService = {
    resolveResearchObject: async () => ({ uuid: "Actor.vehicle", type: "vehicle" }),
    activateAfterburner: async () => { throw new Error("vehicle activation failed"); },
    deactivateGadget: async () => true
  };

  await assert.rejects(
    service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {}),
    /vehicle activation failed/u
  );

  assert.deepEqual(getPreparedCraftsmanGadgets(actor), [item]);
  assert.equal(item.system.quantity, 2);
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.instanceId, "effect-rollback");
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.state, "prepared");
  assert.equal(actor.flags["rebreya-main"]?.craftsmanGadgets?.activeInstanceId ?? "", "");
});

test("non-authoritative clients route gadget activation to the active GM with CAS identity", async () => {
  const item = preparedGadget("smoke-device", "current", "socket-smoke", 2);
  const actor = new TestActor({ items: [item] });
  actor.flags["rebreya-main"] = {
    craftsmanGadgets: { restGeneration: "current", activeInstanceId: "" }
  };
  const requests = [];
  const service = makeService({
    moduleApi: {
      socketCommandBus: {
        request: async (command, payload) => {
          requests.push([command, payload]);
          return true;
        }
      }
    }
  });
  service.options.isActiveGmClient = () => false;
  const cloud = { uuid: "Scene.scene.MeasuredTemplate.cloud" };

  assert.equal(await service.applyDnd5ePostUseActivity(
    gadgetActivity(item, "activate"),
    {},
    { templates: [[cloud]] }
  ), true);

  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], "craftsman.gadget.mutate");
  assert.deepEqual(requests[0][1], {
    kind: "use",
    actorUuid: "Actor.craftsman",
    itemId: "socket-smoke",
    gadgetId: "smoke-device",
    operation: "activate",
    expectedInstanceId: "socket-smoke",
    expectedActiveInstanceId: "",
    expectedRestGeneration: "current",
    templateUuids: ["Scene.scene.MeasuredTemplate.cloud"]
  });
  assert.equal(item.system.quantity, 2);
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.state, "prepared");
});

test("authoritative CAS rejects a stale second activation and deletes only its cloud", async () => {
  const item = preparedGadget("smoke-device", "current", "authoritative-smoke", 2);
  const actor = new TestActor({ items: [item] });
  actor.flags["rebreya-main"] = {
    craftsmanGadgets: { restGeneration: "current", activeInstanceId: "winner" }
  };
  const cloud = {
    uuid: "Scene.scene.MeasuredTemplate.loser",
    documentName: "MeasuredTemplate",
    parent: { id: "scene", documentName: "Scene" },
    flags: {
      "rebreya-main": {
        craftsmanSmoke: {
          instanceId: "authoritative-smoke",
          ownerActorUuid: actor.uuid
        }
      }
    },
    deleted: false,
    async delete() { this.deleted = true; }
  };
  const service = makeService();
  service.options.fromUuid = async (uuid) => (
    uuid === actor.uuid ? actor : uuid === cloud.uuid ? cloud : null
  );

  assert.equal(await service.executeAuthoritativeMutation({
    kind: "use",
    actorUuid: actor.uuid,
    itemId: item.id,
    gadgetId: "smoke-device",
    operation: "activate",
    expectedInstanceId: "authoritative-smoke",
    expectedActiveInstanceId: "",
    expectedRestGeneration: "current",
    templateUuids: [cloud.uuid]
  }), false);

  assert.equal(cloud.deleted, true);
  assert.equal(item.system.quantity, 2);
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.state, "prepared");
});

test("authoritative rejection never deletes an unverified document UUID", async () => {
  const item = preparedGadget("smoke-device", "current", "safe-smoke", 1);
  const actor = new TestActor({ items: [item] });
  actor.flags["rebreya-main"] = {
    craftsmanGadgets: { restGeneration: "current", activeInstanceId: "winner" }
  };
  const foreignItem = {
    uuid: "Actor.foreign.Item.target",
    documentName: "Item",
    deleted: false,
    async delete() { this.deleted = true; }
  };
  const service = makeService();
  service.options.fromUuid = async (uuid) => (
    uuid === actor.uuid ? actor : uuid === foreignItem.uuid ? foreignItem : null
  );

  assert.equal(await service.executeAuthoritativeMutation({
    kind: "use",
    actorUuid: actor.uuid,
    itemId: item.id,
    gadgetId: "smoke-device",
    operation: "activate",
    expectedInstanceId: "safe-smoke",
    expectedActiveInstanceId: "",
    expectedRestGeneration: "current",
    templateUuids: [foreignItem.uuid]
  }), false);

  assert.equal(foreignItem.deleted, false);
});

test("long rest mutates from the confirmed local hook and never exposes a socket rest command", async () => {
  const item = preparedGadget("force-glove", "current", "socket-rest-old", 2);
  const actor = new TestActor({ level: 1, items: [item] });
  actor.flags["rebreya-main"] = {
    craftsmanGadgets: {
      restGeneration: "current",
      activeInstanceId: "",
      selectedIds: ["force-glove", "force-glove"]
    }
  };
  const requests = [];
  const service = makeService({
    selection: ["charged-boot", "charged-boot"],
    randomIds: ["socket-rest-generation"],
    moduleApi: {
      socketCommandBus: {
        request: async (command, payload) => {
          requests.push([command, payload]);
          return true;
        }
      }
    }
  });
  service.options.isActiveGmClient = () => false;

  assert.equal(await service.handleRestCompleted(actor, { type: "long" }, {}), true);

  assert.equal(requests.length, 0);
  assert.equal(actor.items.contents.includes(item), false);
  assert.equal(actor.created.length, 1);
  assert.equal(actor.created[0].system.quantity, 2);
  assert.equal(actor.created[0].flags["rebreya-main"].craftsmanGadget.catalogId, "charged-boot");
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
    resolveResearchObject: async () => vehicle,
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
  const prepared = getPreparedCraftsmanGadgets(actor)[0];
  assert.equal(prepared.flags["rebreya-main"].craftsmanGadget.vehicleUuid, targetVehicle.uuid);
  await service.applyDnd5ePostUseActivity(gadgetActivity(prepared, "activate"), {}, {});
  const active = getPreparedCraftsmanGadgets(actor).find((item) => (
    item.flags["rebreya-main"].craftsmanGadget.state === "active"
  ));
  await service.applyDnd5ePostUseActivity(gadgetActivity(active, "action"), {}, {});
  assert.deepEqual(vehicleCalls.map((entry) => entry[0]), ["activateAfterburner", "useAfterburnerAction"]);
});

test("Mechanic gadget cannot mutate a vehicle other than the actor research object", async () => {
  const item = preparedGadget("afterburner-injector", "current", "foreign-vehicle", 1);
  item.flags["rebreya-main"].craftsmanGadget.vehicleUuid = "Actor.foreign-vehicle";
  const actor = new TestActor({ level: 2, items: [item] });
  const calls = [];
  const service = makeService({ mechanic: true });
  service.options.vehicleService = {
    resolveVehicle: async () => ({ uuid: "Actor.foreign-vehicle", type: "vehicle" }),
    resolveResearchObject: async () => ({ uuid: "Actor.research-vehicle", type: "vehicle" }),
    activateAfterburner: async (...args) => calls.push(args)
  };

  await assert.rejects(
    service.applyDnd5ePostUseActivity(gadgetActivity(item, "activate"), {}, {}),
    /research object/u
  );
  assert.deepEqual(calls, []);
  assert.equal(item.flags["rebreya-main"].craftsmanGadget.state, "prepared");
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
