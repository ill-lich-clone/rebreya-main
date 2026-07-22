import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_TRACK_FLAG,
  CRAFTSMAN_TRACKS,
  MODULE_ID
} from "../scripts/constants.js";
import {
  createCraftsmanLevelChangeSteps,
  getCraftsmanSubclasses,
  registerCraftsmanAdvancementManagerPatch,
  registerCraftsmanMultiSubclassIntegration,
  registerCraftsmanSubclassItemLinks,
  unregisterCraftsmanMultiSubclassIntegration
} from "../scripts/integrations/craftsman-multi-subclass.js";

const ORIGINAL_GLOBALS = {
  CONFIG: globalThis.CONFIG,
  Item: globalThis.Item,
  game: globalThis.game,
  libWrapper: globalThis.libWrapper
};

let originalSubclassCalls = 0;

class Item5eStub {
  constructor({
    id,
    type,
    identifier,
    classIdentifier,
    track,
    levels = 0,
    flows = {},
    advancementRootItem = null,
    advancementClassLinked = false
  }) {
    this.id = id;
    this.type = type;
    this.system = {
      identifier,
      classIdentifier,
      levels,
      advancementRootItem,
      advancementClassLinked
    };
    this.flags = track === undefined ? {} : {
      [MODULE_ID]: { [CRAFTSMAN_TRACK_FLAG]: track }
    };
    this.flows = flows;
    this.parent = null;
    this.actor = null;
    this._classLink = undefined;
  }

  get identifier() {
    return this.system.identifier;
  }

  get isEmbedded() {
    return Boolean(this.parent);
  }

  get class() {
    if (!this.isEmbedded || this.type !== "subclass") return null;
    const classIdentifier = this.system.classIdentifier;
    return this._classLink ??= this.parent.items.find((item) => (
      item.type === "class" && item.identifier === classIdentifier
    ));
  }

  get subclass() {
    originalSubclassCalls += 1;
    if (!this.isEmbedded || this.type !== "class") return null;
    const items = this.parent.items;
    const classIdentifier = this.identifier;
    return this._classLink ??= items.find((item) => (
      item.type === "subclass" && item.system.classIdentifier === classIdentifier
    ));
  }
}

function attachActor(items, { id = "actor-1", level = 1, race = null } = {}) {
  const collection = [...items];
  collection.contents = collection;
  collection.get = (itemId) => collection.find((item) => item.id === itemId);
  const actor = {
    id,
    items: collection,
    system: { details: { level, race } }
  };
  for (const item of collection) {
    item.parent = actor;
    item.actor = actor;
  }
  return actor;
}

function makeItem(options) {
  return new Item5eStub(options);
}

function makeFlow(item, type, level) {
  return { item, level, type, advancement: { id: `${type}-${level}` } };
}

class AdvancementManagerStub {
  constructor(actor) {
    this.actor = actor;
    this.clone = actor;
    this.steps = [];
  }

  createLevelChangeSteps(classItem, levelDelta) {
    AdvancementManagerStub.originalCalls += 1;
    return { native: true, classItem, levelDelta, manager: this };
  }

  static flowsForLevel(item, level) {
    return (item?.flows?.[level] ?? []).map((type) => makeFlow(item, type, level));
  }

  static currentLevel(item) {
    return item.system.levels;
  }

  static forModifyChoices(actor, itemId, level) {
    const manager = new this(actor);
    const clonedItem = manager.clone.items.get(itemId);
    if (!clonedItem) return manager;
    const flows = Array.from({ length: this.currentLevel(clonedItem, manager.clone) + 1 }, (_, index) => index)
      .slice(level)
      .flatMap((flowLevel) => this.flowsForLevel(clonedItem, flowLevel));
    flows.reverse().forEach((flow) => manager.steps.push({ type: "reverse", flow, automatic: true }));
    flows.reverse().filter((flow) => flow.level === level)
      .forEach((flow) => manager.steps.push({ type: "forward", flow }));
    flows.filter((flow) => flow.level > level)
      .forEach((flow) => manager.steps.push({ type: "restore", flow, automatic: true }));
    return manager;
  }
}
AdvancementManagerStub.originalCalls = 0;

function installGlobals({ libWrapperActive = false, libWrapper = undefined } = {}) {
  globalThis.Item = Item5eStub;
  globalThis.CONFIG = { Item: { documentClass: Item5eStub } };
  globalThis.game = {
    modules: {
      get: (id) => id === "lib-wrapper" ? { active: libWrapperActive } : null
    },
    dnd5e: {
      applications: { advancement: { AdvancementManager: AdvancementManagerStub } }
    }
  };
  globalThis.libWrapper = libWrapper;
}

function makeCraftsmanFixture({ level = 1, actorLevel = level } = {}) {
  const race = makeItem({ id: "race", type: "race", flows: {} });
  const craftsman = makeItem({
    id: "craftsman-class",
    type: "class",
    identifier: CRAFTSMAN_CLASS_IDENTIFIER,
    levels: level,
    flows: {}
  });
  const research = makeItem({
    id: "research",
    type: "subclass",
    classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
    track: CRAFTSMAN_TRACKS.RESEARCH,
    flows: {}
  });
  const specialty = makeItem({
    id: "specialty",
    type: "subclass",
    classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
    track: CRAFTSMAN_TRACKS.SPECIALTY,
    flows: {}
  });
  const dependentResearch = makeItem({
    id: "dependent-research",
    type: "feat",
    advancementRootItem: research,
    advancementClassLinked: true,
    flows: {}
  });
  const dependentSpecialty = makeItem({
    id: "dependent-specialty",
    type: "feat",
    advancementRootItem: specialty,
    advancementClassLinked: true,
    flows: {}
  });
  const general = makeItem({ id: "general", type: "feat", flows: {} });
  const actor = attachActor(
    [specialty, craftsman, research, race, dependentResearch, dependentSpecialty, general],
    { id: "actor-craftsman", level: actorLevel, race }
  );
  return { actor, craftsman, dependentResearch, dependentSpecialty, general, race, research, specialty };
}

function flowStepLabels(manager) {
  return manager.steps.map((step) => step.flow
    ? `${step.type}:${step.flow.item.id}:${step.flow.type}:${step.flow.level}`
    : `${step.type}:${step.item?.id ?? "level"}:${step.class?.level ?? "-"}`);
}

function createLibWrapperHarness() {
  let nextId = 1;
  const registrations = new Map();
  const calls = [];
  const targets = {
    "CONFIG.Item.documentClass.prototype.subclass": {
      prototype: Item5eStub.prototype,
      property: "subclass",
      kind: "getter"
    },
    "game.dnd5e.applications.advancement.AdvancementManager.prototype.createLevelChangeSteps": {
      prototype: AdvancementManagerStub.prototype,
      property: "createLevelChangeSteps",
      kind: "method"
    }
  };

  return {
    calls,
    register(packageId, targetPath, wrapper, type) {
      const target = targets[targetPath];
      assert.ok(target, `Unexpected libWrapper target ${targetPath}`);
      const id = nextId++;
      calls.push({ action: "register", packageId, targetPath, type, id });
      if (target.kind === "getter") {
        const original = Object.getOwnPropertyDescriptor(target.prototype, target.property);
        const owned = {
          ...original,
          get: function() {
            return wrapper.call(this, original.get.bind(this));
          }
        };
        Object.defineProperty(target.prototype, target.property, owned);
        registrations.set(id, { ...target, original, owned });
      }
      else {
        const original = target.prototype[target.property];
        const owned = function(...args) {
          return wrapper.call(this, original.bind(this), ...args);
        };
        target.prototype[target.property] = owned;
        registrations.set(id, { ...target, original, owned });
      }
      return id;
    },
    unregister(packageId, id) {
      calls.push({ action: "unregister", packageId, id });
      const registration = registrations.get(id);
      if (!registration) return;
      if (registration.kind === "getter") {
        const current = Object.getOwnPropertyDescriptor(registration.prototype, registration.property);
        if (current?.get === registration.owned.get) {
          Object.defineProperty(registration.prototype, registration.property, registration.original);
        }
      }
      else if (registration.prototype[registration.property] === registration.owned) {
        registration.prototype[registration.property] = registration.original;
      }
      registrations.delete(id);
    }
  };
}

afterEach(() => {
  unregisterCraftsmanMultiSubclassIntegration();
  globalThis.CONFIG = ORIGINAL_GLOBALS.CONFIG;
  globalThis.Item = ORIGINAL_GLOBALS.Item;
  globalThis.game = ORIGINAL_GLOBALS.game;
  globalThis.libWrapper = ORIGINAL_GLOBALS.libWrapper;
  originalSubclassCalls = 0;
  AdvancementManagerStub.originalCalls = 0;
});

test("the Item relationship wrapper keeps native links and deterministically exposes Research", () => {
  installGlobals();
  const classDescriptor = Object.getOwnPropertyDescriptor(Item5eStub.prototype, "class");
  const symbolsBefore = Object.getOwnPropertySymbols(Item5eStub.prototype);
  const { actor, craftsman, research, specialty } = makeCraftsmanFixture();
  const ordinaryClass = makeItem({ id: "fighter", type: "class", identifier: "fighter-v01", levels: 1 });
  const ordinarySubclass = makeItem({ id: "fighter-subclass", type: "subclass", classIdentifier: "fighter-v01" });
  actor.items.push(ordinaryClass, ordinarySubclass);
  ordinaryClass.actor = ordinaryClass.parent = actor;
  ordinarySubclass.actor = ordinarySubclass.parent = actor;

  assert.equal(craftsman.subclass, specialty, "the installed one-slot getter sees actor order before patching");
  assert.equal(originalSubclassCalls, 1);
  assert.equal(registerCraftsmanSubclassItemLinks(), true);
  assert.equal(registerCraftsmanSubclassItemLinks(), true, "registration is idempotent");

  assert.equal(craftsman.subclass, research, "the wrapper must ignore the stale native one-slot cache");
  assert.equal(originalSubclassCalls, 1, "Craftsman must not call the native one-slot getter");
  assert.equal(ordinaryClass.subclass, ordinarySubclass);
  assert.equal(originalSubclassCalls, 2, "an ordinary class delegates exactly once");
  assert.equal(research.class, craftsman);
  assert.equal(specialty.class, craftsman);
  assert.equal(Object.getOwnPropertyDescriptor(Item5eStub.prototype, "class").get, classDescriptor.get);
  assert.deepEqual(Object.getOwnPropertySymbols(Item5eStub.prototype), symbolsBefore);
  assert.deepEqual(getCraftsmanSubclasses(craftsman), { research, specialty });
});

test("Craftsman relationship diagnostics reject duplicate and unknown tracks with document identities", () => {
  installGlobals();
  const { actor, craftsman } = makeCraftsmanFixture();
  actor.items.push(makeItem({
    id: "research-duplicate",
    type: "subclass",
    classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
    track: CRAFTSMAN_TRACKS.RESEARCH
  }));
  actor.items.at(-1).actor = actor.items.at(-1).parent = actor;

  assert.throws(
    () => getCraftsmanSubclasses(craftsman),
    /(?=.*actor-craftsman)(?=.*craftsman-class)(?=.*research)/i
  );

  actor.items.pop();
  const unknown = makeItem({
    id: "unknown-track",
    type: "subclass",
    classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
    track: "prototype"
  });
  unknown.actor = unknown.parent = actor;
  actor.items.push(unknown);
  assert.throws(
    () => getCraftsmanSubclasses(craftsman),
    /(?=.*actor-craftsman)(?=.*craftsman-class)(?=.*prototype)/i
  );
});

test("level 1 to 3 uses exact race, class, Research, Specialty, dependent order per level", () => {
  installGlobals();
  const fixture = makeCraftsmanFixture({ level: 1, actorLevel: 1 });
  const { craftsman, dependentResearch, dependentSpecialty, general, race, research, specialty } = fixture;
  race.flows = { 2: ["race"], 3: ["race"] };
  craftsman.flows = { 2: ["ResearchSubclass"], 3: ["SpecialtySubclass"] };
  research.flows = { 2: ["research"], 3: ["research"] };
  specialty.flows = { 2: ["specialty"], 3: ["specialty"] };
  dependentResearch.flows = { 2: ["research-dependent"], 3: ["research-dependent"] };
  dependentSpecialty.flows = { 2: ["specialty-dependent"], 3: ["specialty-dependent"] };
  general.flows = { 2: ["general-dependent"], 3: ["general-dependent"] };
  const manager = new AdvancementManagerStub(fixture.actor);

  assert.equal(createCraftsmanLevelChangeSteps(manager, craftsman, 2), manager);
  assert.deepEqual(flowStepLabels(manager), [
    "forward:race:race:2",
    "forward:craftsman-class:ResearchSubclass:2",
    "forward:research:research:2",
    "forward:specialty:specialty:2",
    "forward:dependent-research:research-dependent:2",
    "forward:dependent-specialty:specialty-dependent:2",
    "forward:general:general-dependent:2",
    "forward:race:race:3",
    "forward:craftsman-class:SpecialtySubclass:3",
    "forward:research:research:3",
    "forward:specialty:specialty:3",
    "forward:dependent-research:research-dependent:3",
    "forward:dependent-specialty:specialty-dependent:3",
    "forward:general:general-dependent:3",
    "forward:level:3"
  ]);
  assert.equal(craftsman.system.levels, 3);
});

test("level 3 to 1 reverses dependents, Specialty, Research, class, and race exactly", () => {
  installGlobals();
  const fixture = makeCraftsmanFixture({ level: 3, actorLevel: 3 });
  const { craftsman, dependentResearch, dependentSpecialty, general, race, research, specialty } = fixture;
  race.flows = { 2: ["race"], 3: ["race"] };
  craftsman.flows = { 2: ["ResearchSubclass"], 3: ["SpecialtySubclass"] };
  research.flows = { 2: ["research"], 3: ["research"] };
  specialty.flows = { 2: ["specialty"], 3: ["specialty"] };
  dependentResearch.flows = { 2: ["research-dependent"], 3: ["research-dependent"] };
  dependentSpecialty.flows = { 2: ["specialty-dependent"], 3: ["specialty-dependent"] };
  general.flows = { 2: ["general-dependent"], 3: ["general-dependent"] };
  const manager = new AdvancementManagerStub(fixture.actor);

  createCraftsmanLevelChangeSteps(manager, craftsman, -2);
  assert.deepEqual(flowStepLabels(manager), [
    "reverse:general:general-dependent:3",
    "reverse:dependent-specialty:specialty-dependent:3",
    "reverse:dependent-research:research-dependent:3",
    "reverse:specialty:specialty:3",
    "reverse:research:research:3",
    "reverse:craftsman-class:SpecialtySubclass:3",
    "reverse:race:race:3",
    "reverse:general:general-dependent:2",
    "reverse:dependent-specialty:specialty-dependent:2",
    "reverse:dependent-research:research-dependent:2",
    "reverse:specialty:specialty:2",
    "reverse:research:research:2",
    "reverse:craftsman-class:ResearchSubclass:2",
    "reverse:race:race:2",
    "forward:level:1"
  ]);
  assert.ok(manager.steps.slice(0, -1).every((step) => step.automatic === true));
  assert.equal(craftsman.system.levels, 1);
});

test("both subclass axes and their class-linked dependents participate at every nested feature level", () => {
  installGlobals();
  const featureLevels = [5, 6, 9, 10, 13, 15];
  const fixture = makeCraftsmanFixture({ level: 4, actorLevel: 4 });
  const { craftsman, dependentResearch, dependentSpecialty, research, specialty } = fixture;
  for (const level of featureLevels) {
    research.flows[level] = ["research-nested"];
    specialty.flows[level] = ["specialty-nested"];
    dependentResearch.flows[level] = ["research-grant"];
    dependentSpecialty.flows[level] = ["specialty-grant"];
  }

  const manager = new AdvancementManagerStub(fixture.actor);
  createCraftsmanLevelChangeSteps(manager, craftsman, 11);
  for (const level of featureLevels) {
    const labels = manager.steps
      .filter((step) => step.flow?.level === level)
      .map((step) => `${step.type}:${step.flow.item.id}:${step.flow.type}:${step.flow.level}`);
    assert.deepEqual(labels, [
      `forward:research:research-nested:${level}`,
      `forward:specialty:specialty-nested:${level}`,
      `forward:dependent-research:research-grant:${level}`,
      `forward:dependent-specialty:specialty-grant:${level}`
    ]);
  }
});

test("an absent Craftsman axis is filtered before calling the installed flowsForLevel contract", () => {
  installGlobals();
  const fixture = makeCraftsmanFixture({ level: 1, actorLevel: 1 });
  fixture.actor.items.splice(fixture.actor.items.indexOf(fixture.specialty), 1);
  class StrictAdvancementManager extends AdvancementManagerStub {
    static flowsForLevel(item, level) {
      assert.ok(item, `flowsForLevel received an absent item at level ${level}`);
      return super.flowsForLevel(item, level);
    }
  }

  const manager = new StrictAdvancementManager(fixture.actor);
  assert.equal(createCraftsmanLevelChangeSteps(manager, fixture.craftsman, 1), manager);
});

test("class deletion reverses both subclass axes and their grants before deleting the class", () => {
  installGlobals();
  const fixture = makeCraftsmanFixture({ level: 1, actorLevel: 1 });
  const { craftsman, dependentResearch, dependentSpecialty, race, research, specialty } = fixture;
  race.flows = { 1: ["race"] };
  craftsman.flows = { 1: ["class"] };
  research.flows = { 1: ["research"] };
  specialty.flows = { 1: ["specialty"] };
  dependentResearch.flows = { 1: ["research-grant"] };
  dependentSpecialty.flows = { 1: ["specialty-grant"] };
  const manager = new AdvancementManagerStub(fixture.actor);

  createCraftsmanLevelChangeSteps(manager, craftsman, -1);
  assert.deepEqual(flowStepLabels(manager), [
    "reverse:dependent-specialty:specialty-grant:1",
    "reverse:dependent-research:research-grant:1",
    "reverse:specialty:specialty:1",
    "reverse:research:research:1",
    "reverse:craftsman-class:class:1",
    "reverse:race:race:1",
    "delete:craftsman-class:-",
    "forward:level:0"
  ]);
});

test("native forModifyChoices preserves the opposite level choice while the wrapper delegates ordinary classes once", () => {
  installGlobals();
  const { actor, craftsman } = makeCraftsmanFixture({ level: 3, actorLevel: 3 });
  craftsman.flows = { 2: ["ResearchSubclass"], 3: ["SpecialtySubclass"] };
  const researchChange = AdvancementManagerStub.forModifyChoices(actor, craftsman.id, 2);
  const specialtyChange = AdvancementManagerStub.forModifyChoices(actor, craftsman.id, 3);

  assert.deepEqual(researchChange.steps.map((step) => `${step.type}:${step.flow.type}`), [
    "reverse:SpecialtySubclass",
    "reverse:ResearchSubclass",
    "forward:ResearchSubclass",
    "restore:SpecialtySubclass"
  ]);
  assert.deepEqual(specialtyChange.steps.map((step) => `${step.type}:${step.flow.type}`), [
    "reverse:SpecialtySubclass",
    "forward:SpecialtySubclass"
  ]);

  assert.equal(registerCraftsmanAdvancementManagerPatch(), true);
  assert.equal(registerCraftsmanAdvancementManagerPatch(), true);
  const ordinary = makeItem({ id: "fighter", type: "class", identifier: "fighter-v01", levels: 1 });
  ordinary.actor = ordinary.parent = actor;
  const manager = new AdvancementManagerStub(actor);
  const result = manager.createLevelChangeSteps(ordinary, 1);
  assert.equal(result.native, true);
  assert.equal(AdvancementManagerStub.originalCalls, 1);
});

test("direct registration teardown restores only wrappers still owned by this integration", () => {
  installGlobals();
  const originalSubclass = Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass");
  const originalManager = AdvancementManagerStub.prototype.createLevelChangeSteps;
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  const ownedSubclass = Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass");
  const ownedManager = AdvancementManagerStub.prototype.createLevelChangeSteps;
  assert.notEqual(ownedSubclass.get, originalSubclass.get);
  assert.notEqual(ownedManager, originalManager);

  unregisterCraftsmanMultiSubclassIntegration();
  assert.equal(Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass").get, originalSubclass.get);
  assert.equal(AdvancementManagerStub.prototype.createLevelChangeSteps, originalManager);
  unregisterCraftsmanMultiSubclassIntegration();

  registerCraftsmanMultiSubclassIntegration();
  const thirdPartySubclass = { ...ownedSubclass, get() { return "third-party"; } };
  const thirdPartyManager = function() { return "third-party"; };
  Object.defineProperty(Item5eStub.prototype, "subclass", thirdPartySubclass);
  AdvancementManagerStub.prototype.createLevelChangeSteps = thirdPartyManager;
  unregisterCraftsmanMultiSubclassIntegration();
  assert.equal(Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass").get, thirdPartySubclass.get);
  assert.equal(AdvancementManagerStub.prototype.createLevelChangeSteps, thirdPartyManager);

  Object.defineProperty(Item5eStub.prototype, "subclass", originalSubclass);
  AdvancementManagerStub.prototype.createLevelChangeSteps = originalManager;
});

test("active libWrapper is preferred, uses installed public targets, and unregisters by owned ids", () => {
  const libWrapper = createLibWrapperHarness();
  installGlobals({ libWrapperActive: true, libWrapper });
  const { craftsman, research } = makeCraftsmanFixture();

  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  assert.deepEqual(libWrapper.calls.map((call) => [call.action, call.targetPath, call.type]), [
    ["register", "CONFIG.Item.documentClass.prototype.subclass", "WRAPPER"],
    ["register", "game.dnd5e.applications.advancement.AdvancementManager.prototype.createLevelChangeSteps", "WRAPPER"]
  ]);
  assert.equal(craftsman.subclass, research, "the registered libWrapper getter must execute real relationship behavior");

  unregisterCraftsmanMultiSubclassIntegration();
  assert.deepEqual(libWrapper.calls.slice(2).map((call) => [call.action, call.id]), [
    ["unregister", 2],
    ["unregister", 1]
  ]);
});

test("a failed manager registration rolls back the newly owned Item wrapper", () => {
  const libWrapper = createLibWrapperHarness();
  const successfulRegister = libWrapper.register.bind(libWrapper);
  libWrapper.register = (packageId, targetPath, wrapper, type) => {
    if (targetPath.includes("AdvancementManager")) throw new Error("manager registration failed");
    return successfulRegister(packageId, targetPath, wrapper, type);
  };
  installGlobals({ libWrapperActive: true, libWrapper });
  const originalSubclass = Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass");

  assert.throws(() => registerCraftsmanMultiSubclassIntegration(), /manager registration failed/);
  assert.equal(Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass").get, originalSubclass.get);
  assert.deepEqual(libWrapper.calls.map((call) => call.action), ["register", "unregister"]);
});

test("the ready-phase dnd5e sheet integration registers the multi-subclass lifecycle", async () => {
  const source = await readFile(
    new URL("../scripts/integrations/dnd5e-sheet-extensions.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /import\s*\{\s*registerCraftsmanMultiSubclassIntegration\s*\}\s*from\s*"\.\/craftsman-multi-subclass\.js"/u);
  assert.match(source, /registerDnd5eSheetExtensions[\s\S]*?registerCraftsmanMultiSubclassIntegration\(\)/u);
});
