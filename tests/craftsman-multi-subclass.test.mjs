import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CRAFTSMAN_ARCHETYPE_ID_FLAG,
  CRAFTSMAN_ARCHETYPE_REGISTRY,
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_TRACK_FLAG,
  CRAFTSMAN_TRACKS,
  MODULE_ID
} from "../scripts/constants.js";

function defaultArchetypeId(track) {
  return track === CRAFTSMAN_TRACKS.SPECIALTY
    ? "craftsman-specialty-constructor"
    : "craftsman-research-weaponsmith";
}

function sourceDefinition(track, archetypeId) {
  return CRAFTSMAN_ARCHETYPE_REGISTRY[archetypeId]
    ?? CRAFTSMAN_ARCHETYPE_REGISTRY[defaultArchetypeId(track)];
}
import * as craftsmanIntegration from "../scripts/integrations/craftsman-multi-subclass.js";

const {
  createCraftsmanLevelChangeSteps,
  getCraftsmanSubclasses,
  registerCraftsmanAdvancementManagerPatch,
  registerCraftsmanMultiSubclassIntegration,
  registerCraftsmanSubclassItemLinks,
  unregisterCraftsmanMultiSubclassIntegration
} = craftsmanIntegration;

const ORIGINAL_GLOBALS = {
  CONFIG: globalThis.CONFIG,
  Hooks: globalThis.Hooks,
  Item: globalThis.Item,
  game: globalThis.game,
  libWrapper: globalThis.libWrapper,
  ui: globalThis.ui
};

let originalSubclassCalls = 0;
let characterDropCalls = 0;
let genericDropCalls = 0;
let notifications = [];

class Item5eStub {
  constructor({
    id,
    type,
    identifier,
    classIdentifier,
    track,
    managed,
    archetypeId,
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
    const moduleFlags = {};
    if (track !== undefined) {
      const identityArchetypeId = archetypeId ?? defaultArchetypeId(track);
      const definition = sourceDefinition(track, identityArchetypeId);
      moduleFlags[CRAFTSMAN_TRACK_FLAG] = track;
      moduleFlags[CRAFTSMAN_ARCHETYPE_ID_FLAG] = identityArchetypeId;
      moduleFlags.classIdentifier = classIdentifier;
      moduleFlags.managed = managed ?? true;
      moduleFlags.sourceType = "subclass";
      this.flags = {
        [MODULE_ID]: moduleFlags,
        dnd5e: { sourceId: definition.uuid }
      };
    }
    else this.flags = {};
    this.uuid = `Actor.actor-1.Item.${id}`;
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

  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }
}

function attachActor(items, { id = "actor-1", level = 1, race = null } = {}) {
  const collection = [...items];
  collection.contents = collection;
  collection.get = (itemId) => collection.find((item) => item.id === itemId);
  const actor = {
    id,
    type: "character",
    items: collection,
    system: { details: { level, race }, metadata: { supportsAdvancement: true } }
  };
  actor.itemTypes = {
    class: collection.filter((item) => item.type === "class"),
    subclass: collection.filter((item) => item.type === "subclass")
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
    AdvancementManagerStub.modifyCalls.push({ actor, itemId, level });
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

  static forNewItem(actor, itemData) {
    AdvancementManagerStub.newItemCalls.push({ actor, itemData });
    const manager = new this(actor);
    if (itemData.system?.advancement?.length) manager.steps.push({ type: "forward" });
    return manager;
  }

  render(options) {
    this.renderOptions = options;
    AdvancementManagerStub.renderCalls.push({ manager: this, options });
    return this;
  }
}
AdvancementManagerStub.originalCalls = 0;
AdvancementManagerStub.modifyCalls = [];
AdvancementManagerStub.newItemCalls = [];
AdvancementManagerStub.renderCalls = [];

class BaseActorSheetStub {
  constructor(actor) {
    this.actor = actor;
    this.inventorySource = actor;
    this.tabGroups = { primary: "features" };
  }

  async _onDropSingleItem(event, itemData) {
    genericDropCalls += 1;
    if (this.actor.system.metadata?.supportsAdvancement && itemData.system?.advancement?.length) {
      const manager = AdvancementManagerStub.forNewItem(this.actor, itemData);
      if (manager.steps.length) {
        manager.render(true);
        return false;
      }
    }
    return itemData;
  }
}

class CharacterActorSheetStub extends BaseActorSheetStub {
  async _onDropSingleItem(event, itemData) {
    characterDropCalls += 1;
    if (itemData.type === "subclass") {
      const other = this.actor.itemTypes.subclass.find((item) => item.identifier === itemData.system.identifier);
      if (other) return undefined;
      const cls = this.actor.itemTypes.class.find((item) => item.identifier === itemData.system.classIdentifier);
      if (cls?.subclass) return undefined;
    }
    return super._onDropSingleItem(event, itemData);
  }
}

function createHooksHarness() {
  let nextId = 1;
  const callbacks = new Map();
  const calls = [];
  return {
    callbacks,
    calls,
    on(name, callback) {
      const id = nextId++;
      callbacks.set(name, { callback, id });
      calls.push({ action: "on", name, id });
      return id;
    },
    off(name, id) {
      calls.push({ action: "off", name, id });
      if (callbacks.get(name)?.id === id) callbacks.delete(name);
    }
  };
}

function installGlobals({ libWrapperActive = false, libWrapper = undefined, hooks = createHooksHarness() } = {}) {
  globalThis.Item = Item5eStub;
  globalThis.CONFIG = { Item: { dataModels: {}, documentClass: Item5eStub } };
  globalThis.Hooks = hooks;
  globalThis.game = {
    i18n: {
      format: (key, data) => `${key}:${JSON.stringify(data)}`,
      localize: (key) => key
    },
    modules: {
      get: (id) => id === "lib-wrapper" ? { active: libWrapperActive } : null
    },
    dnd5e: {
      applications: {
        actor: { CharacterActorSheet: CharacterActorSheetStub },
        advancement: { AdvancementManager: AdvancementManagerStub }
      }
    }
  };
  globalThis.libWrapper = libWrapper;
  globalThis.ui = {
    notifications: {
      error: (key, options) => notifications.push({ key, options, type: "error" }),
      warn: (key, options) => notifications.push({ key, options, type: "warn" })
    }
  };
  return hooks;
}

function makeCraftsmanSubclassData({
  id = "incoming-subclass",
  identifier = "incoming-craftsman-subclass",
  classIdentifier = CRAFTSMAN_CLASS_IDENTIFIER,
  track = CRAFTSMAN_TRACKS.RESEARCH,
  managed = true,
  archetypeId = defaultArchetypeId(track),
  sourceUuid = sourceDefinition(track, archetypeId).uuid,
  type = "subclass",
  advancement = []
} = {}) {
  return {
    _id: id,
    name: "Candidate",
    type,
    _stats: { compendiumSource: sourceUuid },
    system: { advancement, classIdentifier, identifier },
    flags: {
      [MODULE_ID]: {
        [CRAFTSMAN_ARCHETYPE_ID_FLAG]: archetypeId,
        [CRAFTSMAN_TRACK_FLAG]: track,
        classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
        managed,
        sourceType: "subclass"
      }
    }
  };
}

function makePreCreateDocument(actor, data) {
  return {
    ...structuredClone(data),
    actor,
    parent: actor,
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
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
    identifier: "craftsman-research-existing",
    classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
    track: CRAFTSMAN_TRACKS.RESEARCH,
    flows: {}
  });
  const specialty = makeItem({
    id: "specialty",
    type: "subclass",
    identifier: "craftsman-specialty-existing",
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

function removeActorItem(actor, item) {
  actor.items.splice(actor.items.indexOf(item), 1);
  actor.itemTypes[item.type] = actor.itemTypes[item.type].filter((entry) => entry !== item);
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
    },
    "game.dnd5e.applications.actor.CharacterActorSheet.prototype._onDropSingleItem": {
      prototype: CharacterActorSheetStub.prototype,
      property: "_onDropSingleItem",
      kind: "method"
    }
  };

  const restoreRegistration = (id, action = null, packageId = MODULE_ID) => {
    const registration = registrations.get(id);
    if (!registration) return;
    if (action) calls.push({ action, packageId, id });
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
  };

  const harness = {
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
            let chained = false;
            const wrapped = (...args) => {
              chained = true;
              return original.get.call(this, ...args);
            };
            const result = wrapper.call(this, wrapped);
            if (type === "WRAPPER" && !chained) restoreRegistration(id, "auto-unregister", packageId);
            return result;
          }
        };
        Object.defineProperty(target.prototype, target.property, owned);
        registrations.set(id, { ...target, original, owned, type });
      }
      else {
        const original = target.prototype[target.property];
        const owned = function(...args) {
          let chained = false;
          const wrapped = (...wrappedArgs) => {
            chained = true;
            return original.call(this, ...wrappedArgs);
          };
          const result = wrapper.call(this, wrapped, ...args);
          if (type === "WRAPPER" && !chained) restoreRegistration(id, "auto-unregister", packageId);
          return result;
        };
        target.prototype[target.property] = owned;
        registrations.set(id, { ...target, original, owned, type });
      }
      return id;
    },
    unregister(packageId, id) {
      calls.push({ action: "unregister", packageId, id });
      restoreRegistration(id);
    }
  };
  return harness;
}

afterEach(() => {
  unregisterCraftsmanMultiSubclassIntegration();
  globalThis.CONFIG = ORIGINAL_GLOBALS.CONFIG;
  globalThis.Hooks = ORIGINAL_GLOBALS.Hooks;
  globalThis.Item = ORIGINAL_GLOBALS.Item;
  globalThis.game = ORIGINAL_GLOBALS.game;
  globalThis.libWrapper = ORIGINAL_GLOBALS.libWrapper;
  globalThis.ui = ORIGINAL_GLOBALS.ui;
  originalSubclassCalls = 0;
  characterDropCalls = 0;
  genericDropCalls = 0;
  notifications = [];
  AdvancementManagerStub.originalCalls = 0;
  AdvancementManagerStub.modifyCalls = [];
  AdvancementManagerStub.newItemCalls = [];
  AdvancementManagerStub.renderCalls = [];
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

test("Standard drop accepts a valid opposite Craftsman axis through the generic native parent", async () => {
  installGlobals();
  const { actor, specialty } = makeCraftsmanFixture({ level: 3, actorLevel: 3 });
  removeActorItem(actor, specialty);
  const sheet = new CharacterActorSheetStub(actor);
  const candidate = makeCraftsmanSubclassData({
    identifier: "new-specialty",
    track: CRAFTSMAN_TRACKS.SPECIALTY,
    advancement: [{ _id: "specialty-advancement" }]
  });

  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  assert.equal(await sheet._onDropSingleItem({}, candidate), false);
  assert.equal(characterDropCalls, 0, "only the Character singleton check is bypassed");
  assert.equal(genericDropCalls, 1, "the installed generic parent handles the drop once");
  assert.equal(AdvancementManagerStub.newItemCalls.length, 1, "native advancement creation remains active");
  assert.equal(AdvancementManagerStub.renderCalls.length, 1);
});

test("Standard drop rejects the same Craftsman axis and preserves native duplicate identifiers", async () => {
  installGlobals();
  const { actor, specialty } = makeCraftsmanFixture({ level: 3, actorLevel: 3 });
  removeActorItem(actor, specialty);
  const sheet = new CharacterActorSheetStub(actor);
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);

  const sameAxis = makeCraftsmanSubclassData({ identifier: "another-research" });
  assert.equal(await sheet._onDropSingleItem({}, sameAxis), false);
  assert.equal(genericDropCalls, 0);
  assert.equal(notifications.at(-1)?.key, "REBREYA_MAIN.CraftsmanSubclass.Duplicate");

  const duplicateIdentifier = makeCraftsmanSubclassData({
    identifier: "craftsman-research-existing",
    track: CRAFTSMAN_TRACKS.SPECIALTY
  });
  assert.equal(await sheet._onDropSingleItem({}, duplicateIdentifier), undefined);
  assert.equal(genericDropCalls, 0);
  assert.match(notifications.at(-1)?.key ?? "", /DND5E\.SubclassDuplicateError/u);
});

test("Standard drop rejects missing, unknown, unmanaged, and wrong-class Craftsman candidates", async () => {
  installGlobals();
  const { actor, specialty } = makeCraftsmanFixture({ level: 3, actorLevel: 3 });
  removeActorItem(actor, specialty);
  const sheet = new CharacterActorSheetStub(actor);
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);

  const missingTrack = makeCraftsmanSubclassData({ track: CRAFTSMAN_TRACKS.SPECIALTY });
  delete missingTrack.flags[MODULE_ID][CRAFTSMAN_TRACK_FLAG];
  const invalidCandidates = [
    missingTrack,
    makeCraftsmanSubclassData({ track: "prototype" }),
    makeCraftsmanSubclassData({ managed: false, track: CRAFTSMAN_TRACKS.SPECIALTY }),
    makeCraftsmanSubclassData({ classIdentifier: "fighter-v01", track: CRAFTSMAN_TRACKS.SPECIALTY }),
    makeCraftsmanSubclassData({ archetypeId: "", track: CRAFTSMAN_TRACKS.SPECIALTY })
  ];

  for (const candidate of invalidCandidates) {
    assert.equal(await sheet._onDropSingleItem({}, candidate), false);
  }
  assert.equal(characterDropCalls, 0);
  assert.equal(genericDropCalls, 0);
  assert.equal(notifications.length, invalidCandidates.length);
});

test("Standard and core creation reject fake, cross-axis, self-consistent, and conflicting canonical identities", async () => {
  const hooks = installGlobals();
  const { actor, specialty } = makeCraftsmanFixture({ level: 3, actorLevel: 3 });
  removeActorItem(actor, specialty);
  const sheet = new CharacterActorSheetStub(actor);
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  const preCreate = hooks.callbacks.get("preCreateItem")?.callback;
  const wrongUuid = "Compendium.world.rebreya-subclasses.Item.selfconsistentbad";
  const conflicting = makeCraftsmanSubclassData({ track: CRAFTSMAN_TRACKS.SPECIALTY });
  conflicting.flags.dnd5e = {
    sourceId: "Compendium.world.rebreya-subclasses.Item.conflicting"
  };
  const invalidCandidates = [
    makeCraftsmanSubclassData({
      track: CRAFTSMAN_TRACKS.SPECIALTY,
      archetypeId: "craftsman-specialty-fake"
    }),
    makeCraftsmanSubclassData({
      track: CRAFTSMAN_TRACKS.RESEARCH,
      archetypeId: "craftsman-specialty-constructor"
    }),
    makeCraftsmanSubclassData({
      id: "selfconsistentbad",
      track: CRAFTSMAN_TRACKS.SPECIALTY,
      sourceUuid: wrongUuid
    }),
    conflicting,
    makeCraftsmanSubclassData({ type: "feat", track: CRAFTSMAN_TRACKS.SPECIALTY })
  ];

  for (const candidate of invalidCandidates) {
    assert.equal(await sheet._onDropSingleItem({}, candidate), false);
    assert.equal(preCreate(
      makePreCreateDocument(actor, candidate),
      candidate,
      { route: "programmatic", rebreyaCraftsmanSubclassMigration: true },
      "user-1"
    ), false);
  }
  assert.equal(characterDropCalls, 0);
  assert.equal(genericDropCalls, 0);
});

test("Standard drop delegates every unrelated item and subclass to CharacterActorSheet exactly once", async () => {
  installGlobals();
  const { actor } = makeCraftsmanFixture({ level: 3, actorLevel: 3 });
  const sheet = new CharacterActorSheetStub(actor);
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);

  const feat = { type: "feat", system: { identifier: "feat" }, flags: {} };
  assert.equal(await sheet._onDropSingleItem({}, feat), feat);
  const ordinarySubclass = {
    type: "subclass",
    system: { classIdentifier: "fighter-v01", identifier: "champion" },
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "subclass",
        classIdentifier: "fighter-v01",
        subclassId: "fighter-champion"
      }
    }
  };
  assert.equal(await sheet._onDropSingleItem({}, ordinarySubclass), ordinarySubclass);
  assert.equal(characterDropCalls, 2);
  assert.equal(genericDropCalls, 2);
});

test("core drop/create invariant protects Standard, Tidy, and programmatic creation including advancements", () => {
  const hooks = installGlobals();
  const { actor, specialty } = makeCraftsmanFixture({ level: 3, actorLevel: 3 });
  removeActorItem(actor, specialty);
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  const preCreate = hooks.callbacks.get("preCreateItem")?.callback;
  assert.equal(typeof preCreate, "function");

  for (const route of ["standard", "tidy", "programmatic"]) {
    const data = makeCraftsmanSubclassData({
      id: `${route}-specialty`,
      identifier: `${route}-specialty`,
      track: CRAFTSMAN_TRACKS.SPECIALTY
    });
    assert.notEqual(preCreate(makePreCreateDocument(actor, data), data, { route }, "user-1"), false);
  }

  const advancementData = makeCraftsmanSubclassData({
    id: "advancement-specialty",
    track: CRAFTSMAN_TRACKS.SPECIALTY
  });
  assert.notEqual(
    preCreate(makePreCreateDocument(actor, advancementData), advancementData, { isAdvancement: true }, "user-1"),
    false
  );
  const duplicate = makeCraftsmanSubclassData({ id: "duplicate-research" });
  const unknown = makeCraftsmanSubclassData({ id: "unknown", track: "prototype" });
  assert.equal(preCreate(makePreCreateDocument(actor, duplicate), duplicate, {}, "user-1"), false);
  assert.equal(preCreate(makePreCreateDocument(actor, unknown), unknown, {}, "user-1"), false);
});

test("core drop/create invariant rejects exact type, class, managed source, and archetype violations", () => {
  const hooks = installGlobals();
  const { actor, specialty } = makeCraftsmanFixture({ level: 3, actorLevel: 3 });
  removeActorItem(actor, specialty);
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  const preCreate = hooks.callbacks.get("preCreateItem")?.callback;
  assert.equal(typeof preCreate, "function");
  const invalidCandidates = [
    makeCraftsmanSubclassData({ type: "feat", track: CRAFTSMAN_TRACKS.SPECIALTY }),
    makeCraftsmanSubclassData({ classIdentifier: "fighter-v01", track: CRAFTSMAN_TRACKS.SPECIALTY }),
    makeCraftsmanSubclassData({ managed: false, track: CRAFTSMAN_TRACKS.SPECIALTY }),
    makeCraftsmanSubclassData({ archetypeId: "", track: CRAFTSMAN_TRACKS.SPECIALTY })
  ];

  for (const data of invalidCandidates) {
    assert.equal(preCreate(makePreCreateDocument(actor, data), data, {}, "user-1"), false);
  }
  const npc = { ...actor, type: "npc" };
  const npcData = makeCraftsmanSubclassData({ track: CRAFTSMAN_TRACKS.SPECIALTY });
  assert.notEqual(preCreate(makePreCreateDocument(npc, npcData), npcData, {}, "user-1"), false);
});

test("core drop/create migration bypass recognizes only the exact internal marker and only for duplicates", () => {
  const hooks = installGlobals();
  const { actor } = makeCraftsmanFixture({ level: 3, actorLevel: 3 });
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  const preCreate = hooks.callbacks.get("preCreateItem")?.callback;
  assert.equal(typeof preCreate, "function");
  const duplicate = makeCraftsmanSubclassData({ id: "migrated-research" });
  const document = makePreCreateDocument(actor, duplicate);

  assert.equal(preCreate(document, duplicate, {}, "user-1"), false);
  assert.equal(preCreate(document, duplicate, { rebreyaCraftsmanMigration: true }, "user-1"), false);
  assert.equal(preCreate(document, duplicate, { rebreyaCraftsmanSubclassMigration: false }, "user-1"), false);
  assert.notEqual(
    preCreate(document, duplicate, { rebreyaCraftsmanSubclassMigration: true }, "user-1"),
    false
  );

  const invalidClass = makeCraftsmanSubclassData({ classIdentifier: "fighter-v01" });
  assert.equal(preCreate(
    makePreCreateDocument(actor, invalidClass),
    invalidClass,
    { rebreyaCraftsmanSubclassMigration: true },
    "user-1"
  ), false);
});

test("modify choice opens only the native level 2 and level 3 managers when steps exist", () => {
  installGlobals();
  const { actor, craftsman } = makeCraftsmanFixture({ level: 3, actorLevel: 3 });
  craftsman.flows = { 2: ["ResearchSubclass"], 3: ["SpecialtySubclass"] };
  assert.equal(typeof craftsmanIntegration.openCraftsmanSubclassChoice, "function");

  const researchManager = craftsmanIntegration.openCraftsmanSubclassChoice(
    actor,
    craftsman.id,
    CRAFTSMAN_TRACKS.RESEARCH
  );
  const specialtyManager = craftsmanIntegration.openCraftsmanSubclassChoice(
    actor,
    craftsman.id,
    CRAFTSMAN_TRACKS.SPECIALTY
  );
  assert.deepEqual(AdvancementManagerStub.modifyCalls.map(({ itemId, level }) => ({ itemId, level })), [
    { itemId: craftsman.id, level: 2 },
    { itemId: craftsman.id, level: 3 }
  ]);
  assert.equal(researchManager.renderOptions.force, true);
  assert.equal(specialtyManager.renderOptions.force, true);
  assert.equal(AdvancementManagerStub.renderCalls.length, 2);

  craftsman.flows = {};
  const emptyManager = craftsmanIntegration.openCraftsmanSubclassChoice(
    actor,
    craftsman.id,
    CRAFTSMAN_TRACKS.RESEARCH
  );
  assert.equal(emptyManager.steps.length, 0);
  assert.equal(AdvancementManagerStub.renderCalls.length, 2, "a manager without steps is not rendered");
});

test("direct registration teardown restores only wrappers and hook still owned by this integration", () => {
  const hooks = installGlobals();
  const originalSubclass = Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass");
  const originalManager = AdvancementManagerStub.prototype.createLevelChangeSteps;
  const originalDrop = CharacterActorSheetStub.prototype._onDropSingleItem;
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  const ownedSubclass = Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass");
  const ownedManager = AdvancementManagerStub.prototype.createLevelChangeSteps;
  const ownedDrop = CharacterActorSheetStub.prototype._onDropSingleItem;
  assert.notEqual(ownedSubclass.get, originalSubclass.get);
  assert.notEqual(ownedManager, originalManager);
  assert.notEqual(ownedDrop, originalDrop);
  assert.deepEqual(hooks.calls, [
    { action: "on", name: "preCreateItem", id: 1 }
  ]);

  unregisterCraftsmanMultiSubclassIntegration();
  assert.equal(Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass").get, originalSubclass.get);
  assert.equal(AdvancementManagerStub.prototype.createLevelChangeSteps, originalManager);
  assert.equal(CharacterActorSheetStub.prototype._onDropSingleItem, originalDrop);
  assert.deepEqual(hooks.calls, [
    { action: "on", name: "preCreateItem", id: 1 },
    { action: "off", name: "preCreateItem", id: 1 }
  ]);
  unregisterCraftsmanMultiSubclassIntegration();

  registerCraftsmanMultiSubclassIntegration();
  const thirdPartySubclass = { ...ownedSubclass, get() { return "third-party"; } };
  const thirdPartyManager = function() { return "third-party"; };
  const thirdPartyDrop = function() { return "third-party"; };
  Object.defineProperty(Item5eStub.prototype, "subclass", thirdPartySubclass);
  AdvancementManagerStub.prototype.createLevelChangeSteps = thirdPartyManager;
  CharacterActorSheetStub.prototype._onDropSingleItem = thirdPartyDrop;
  unregisterCraftsmanMultiSubclassIntegration();
  assert.equal(Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass").get, thirdPartySubclass.get);
  assert.equal(AdvancementManagerStub.prototype.createLevelChangeSteps, thirdPartyManager);
  assert.equal(CharacterActorSheetStub.prototype._onDropSingleItem, thirdPartyDrop);

  Object.defineProperty(Item5eStub.prototype, "subclass", originalSubclass);
  AdvancementManagerStub.prototype.createLevelChangeSteps = originalManager;
  CharacterActorSheetStub.prototype._onDropSingleItem = originalDrop;
});

test("active libWrapper uses MIXED for all conditional wrappers and unregisters every owned id", async () => {
  const libWrapper = createLibWrapperHarness();
  const hooks = installGlobals({ libWrapperActive: true, libWrapper });
  const { actor, craftsman, research, specialty } = makeCraftsmanFixture();
  const ordinaryClass = makeItem({ id: "fighter", type: "class", identifier: "fighter-v01", levels: 1 });
  const ordinarySubclass = makeItem({ id: "fighter-subclass", type: "subclass", classIdentifier: "fighter-v01" });
  actor.items.push(ordinaryClass, ordinarySubclass);
  ordinaryClass.actor = ordinaryClass.parent = actor;
  ordinarySubclass.actor = ordinarySubclass.parent = actor;

  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  assert.equal(registerCraftsmanMultiSubclassIntegration(), true);
  assert.equal(ordinaryClass.subclass, ordinarySubclass, "an ordinary getter invocation chains to native");
  assert.equal(craftsman.subclass, research, "a Craftsman getter invocation may skip wrapped");
  assert.equal(craftsman.subclass, research, "skipping wrapped must not unregister the getter");

  const ordinaryManager = new AdvancementManagerStub(actor);
  assert.equal(ordinaryManager.createLevelChangeSteps(ordinaryClass, 1).native, true);
  const craftsmanManager = new AdvancementManagerStub(actor);
  assert.equal(craftsmanManager.createLevelChangeSteps(craftsman, 0), craftsmanManager);
  const repeatedCraftsmanManager = new AdvancementManagerStub(actor);
  assert.equal(
    repeatedCraftsmanManager.createLevelChangeSteps(craftsman, 0),
    repeatedCraftsmanManager,
    "skipping wrapped must not unregister the manager patch"
  );
  assert.equal(originalSubclassCalls, 1, "the ordinary getter invokes its original exactly once");
  assert.equal(AdvancementManagerStub.originalCalls, 1, "the ordinary manager invokes its original exactly once");

  const sheet = new CharacterActorSheetStub(actor);
  const ordinaryDrop = { type: "feat", system: { identifier: "feat" }, flags: {} };
  assert.equal(await sheet._onDropSingleItem({}, ordinaryDrop), ordinaryDrop);
  removeActorItem(actor, specialty);
  const craftsmanDrop = makeCraftsmanSubclassData({ track: CRAFTSMAN_TRACKS.SPECIALTY });
  assert.equal(await sheet._onDropSingleItem({}, craftsmanDrop), craftsmanDrop);
  assert.equal(await sheet._onDropSingleItem({}, craftsmanDrop), craftsmanDrop);
  assert.equal(characterDropCalls, 1, "the unrelated drop invokes CharacterActorSheet once");
  assert.equal(genericDropCalls, 3, "the unrelated and both Craftsman drops invoke the generic parent once each");
  assert.equal(libWrapper.calls.some((call) => call.action === "auto-unregister"), false);
  assert.deepEqual(libWrapper.calls.map((call) => [call.action, call.targetPath, call.type]), [
    ["register", "CONFIG.Item.documentClass.prototype.subclass", "MIXED"],
    ["register", "game.dnd5e.applications.advancement.AdvancementManager.prototype.createLevelChangeSteps", "MIXED"],
    ["register", "game.dnd5e.applications.actor.CharacterActorSheet.prototype._onDropSingleItem", "MIXED"]
  ]);
  assert.deepEqual(hooks.calls, [
    { action: "on", name: "preCreateItem", id: 1 }
  ]);

  unregisterCraftsmanMultiSubclassIntegration();
  assert.deepEqual(libWrapper.calls.slice(3).map((call) => [call.action, call.id]), [
    ["unregister", 3],
    ["unregister", 2],
    ["unregister", 1]
  ]);
  assert.deepEqual(hooks.calls, [
    { action: "on", name: "preCreateItem", id: 1 },
    { action: "off", name: "preCreateItem", id: 1 }
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

test("a failed preCreate hook registration rolls back every newly owned drop and Task 5 wrapper", () => {
  const libWrapper = createLibWrapperHarness();
  const hooks = createHooksHarness();
  hooks.on = () => {
    throw new Error("hook registration failed");
  };
  installGlobals({ hooks, libWrapperActive: true, libWrapper });
  const originalSubclass = Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass");
  const originalManager = AdvancementManagerStub.prototype.createLevelChangeSteps;
  const originalDrop = CharacterActorSheetStub.prototype._onDropSingleItem;

  assert.throws(() => registerCraftsmanMultiSubclassIntegration(), /hook registration failed/u);
  assert.equal(Object.getOwnPropertyDescriptor(Item5eStub.prototype, "subclass").get, originalSubclass.get);
  assert.equal(AdvancementManagerStub.prototype.createLevelChangeSteps, originalManager);
  assert.equal(CharacterActorSheetStub.prototype._onDropSingleItem, originalDrop);
  assert.deepEqual(libWrapper.calls.map((call) => [call.action, call.id]), [
    ["register", 1],
    ["register", 2],
    ["register", 3],
    ["unregister", 3],
    ["unregister", 2],
    ["unregister", 1]
  ]);
});

test("the ready-phase dnd5e sheet integration registers the multi-subclass lifecycle", async () => {
  const source = await readFile(
    new URL("../scripts/integrations/dnd5e-sheet-extensions.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /import\s*\{\s*registerCraftsmanMultiSubclassIntegration\s*\}\s*from\s*"\.\/craftsman-multi-subclass\.js"/u);
  assert.match(source, /registerDnd5eSheetExtensions[\s\S]*?registerCraftsmanMultiSubclassIntegration\(\)/u);
});
