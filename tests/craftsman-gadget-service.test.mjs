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
  return {
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
}

class TestActor {
  constructor({ level = 1, items = [], scale = null } = {}) {
    this.id = "craftsman";
    this.uuid = "Actor.craftsman";
    this.isOwner = true;
    this.system = {
      scale: scale === null ? {} : { "craftsman-v01": { gadgets: scale } }
    };
    this.items = { contents: [classItem(level), ...items] };
    this.created = [];
    this.deleted = [];
  }

  async createEmbeddedDocuments(type, rows) {
    assert.equal(type, "Item");
    const created = rows.map((row, index) => ({ ...structuredClone(row), id: `created-${this.created.length}-${index}` }));
    this.created.push(...created);
    this.items.contents.push(...created);
    return created;
  }

  async deleteEmbeddedDocuments(type, ids) {
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
  assert.deepEqual(getPreparedCraftsmanGadgets(actor).map((item) => item.id), ["old-smoke-device"]);
  assert.deepEqual(actor.deleted, ["partial-new"]);
});
