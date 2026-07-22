import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_TRACKS,
  MODULE_ID,
  RESEARCH_ITEM_TYPE,
  SETTINGS_KEYS,
  SPECIALTY_ITEM_TYPE
} from "../scripts/constants.js";
import {
  CRAFTSMAN_SUBCLASS_MIGRATION_VERSION,
  CraftsmanSubclassMigrationService
} from "../scripts/data/craftsman-subclass-migration.js";
import { registerSettings } from "../scripts/settings.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(TEST_DIR, "..");
const SUBCLASS_PACK_ID = "world.rebreya-subclasses";
const CLASS_PACK_ID = "world.rebreya-classes";
const FEATURE_PACK_ID = "world.rebreya-class-features";
const LEGACY_PACK_ID = "world.rebreya-craftsman-archetypes";
const MIGRATION_OPTION = Object.freeze({ rebreyaCraftsmanSubclassMigration: true });

const AXIS_DATA = Object.freeze({
  [CRAFTSMAN_TRACKS.RESEARCH]: Object.freeze({
    archetypeId: "research-alpha",
    classAdvancementId: "advResearchNativ",
    featureId: "craftsman-v01::research::research-alpha::research-feature",
    featureEmbeddedId: "featureResearch1",
    featureSourceId: "sourceFeatureRes",
    grantId: "grantResearch001",
    legacyAdvancementId: "oldResearchAdv01",
    legacyId: "legacyResearch01",
    level: 2,
    nativeId: "nativeResearch01",
    type: RESEARCH_ITEM_TYPE,
    nativeType: "ResearchSubclass"
  }),
  [CRAFTSMAN_TRACKS.SPECIALTY]: Object.freeze({
    archetypeId: "specialty-beta",
    classAdvancementId: "advSpecialtyNat",
    featureId: "craftsman-v01::specialty::specialty-beta::specialty-feature",
    featureEmbeddedId: "featureSpecialty",
    featureSourceId: "sourceFeatureSpe",
    grantId: "grantSpecialty01",
    legacyAdvancementId: "oldSpecialtyAdv",
    legacyId: "legacySpecialty1",
    level: 3,
    nativeId: "nativeSpecialty1",
    type: SPECIALTY_ITEM_TYPE,
    nativeType: "SpecialtySubclass"
  })
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function splitPath(key) {
  return String(key).split(".").filter(Boolean);
}

function setPath(target, key, value) {
  const parts = splitPath(key);
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor[part] ??= {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = clone(value);
}

function deletePath(target, key) {
  const parts = splitPath(key);
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor = cursor?.[part];
    if (!cursor) return;
  }
  delete cursor[parts.at(-1)];
}

function getPath(target, key) {
  return splitPath(key).reduce((value, part) => value?.[part], target);
}

function applyUpdate(source, update) {
  for (const [key, value] of Object.entries(update ?? {})) {
    if (key === "_id") continue;
    if (key.startsWith("==")) {
      source[key.slice(2)] = clone(value);
      continue;
    }
    const deletionIndex = key.lastIndexOf(".-=");
    if (deletionIndex >= 0) {
      const parentPath = key.slice(0, deletionIndex);
      const child = key.slice(deletionIndex + 3);
      const parent = getPath(source, parentPath);
      if (parent) delete parent[child];
      continue;
    }
    if (key.startsWith("-=")) {
      delete source[key.slice(2)];
      continue;
    }
    if (key.includes(".")) {
      setPath(source, key, value);
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      source[key] = { ...(source[key] ?? {}), ...clone(value) };
    }
    else {
      source[key] = clone(value);
    }
  }
}

class FakeItem {
  constructor(source, { parent = null, uuid = "" } = {}) {
    this._source = clone(source);
    this.parent = parent;
    this.uuid = uuid;
  }

  get id() { return this._source._id; }
  get _id() { return this._source._id; }
  get name() { return this._source.name; }
  get type() { return this._source.type; }
  get system() { return this._source.system; }
  get flags() { return this._source.flags; }

  getFlag(scope, key) {
    return this._source.flags?.[scope]?.[key];
  }

  toObject() {
    return clone(this._source);
  }

  clone(changes = {}, { keepId = false } = {}) {
    const source = this.toObject();
    applyUpdate(source, changes);
    if (changes._id !== undefined) source._id = changes._id;
    if (!keepId) delete source._id;
    return new FakeItem(source, { uuid: this.uuid });
  }
}

class FakeItemCollection {
  constructor(actor) {
    this.actor = actor;
  }

  get contents() { return this.actor._items; }
  get(id) { return this.actor._items.find((item) => item.id === id); }
  values() { return this.actor._items.values(); }
  [Symbol.iterator]() { return this.actor._items[Symbol.iterator](); }
}

class FakeActor {
  constructor(source, { failAfterMutation = 0, mutationHook = null } = {}) {
    this.id = source._id;
    this._id = source._id;
    this.name = source.name;
    this.type = source.type;
    this.flags = clone(source.flags ?? {});
    this._items = (source.items ?? []).map((item) => new FakeItem(item, { parent: this }));
    this.items = new FakeItemCollection(this);
    this.failAfterMutation = failAfterMutation;
    this.mutationHook = mutationHook;
    this.failureThrown = false;
    this.mutationCount = 0;
    this.mutations = [];
  }

  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }

  async #recordMutation(operation, options, callback) {
    callback();
    this.mutationCount += 1;
    this.mutations.push({ operation, options: clone(options ?? {}) });
    if (!this.failureThrown && typeof this.mutationHook === "function") {
      this.mutationHook({ actor: this, mutationCount: this.mutationCount, operation });
    }
    if (!this.failureThrown && this.failAfterMutation === this.mutationCount) {
      this.failureThrown = true;
      throw new Error(`Injected failure after mutation ${this.mutationCount}: ${operation}`);
    }
  }

  async createEmbeddedDocuments(documentName, sources, options = {}) {
    assert.equal(documentName, "Item");
    const created = [];
    await this.#recordMutation("createEmbeddedDocuments", options, () => {
      for (const rawSource of sources) {
        const source = clone(rawSource);
        assert.ok(source._id, "migration creates embedded Items with known IDs");
        if (this.items.get(source._id)) throw new Error(`Duplicate embedded Item ID ${source._id}`);
        const item = new FakeItem(source, { parent: this });
        this._items.push(item);
        created.push(item);
      }
    });
    return created;
  }

  async updateEmbeddedDocuments(documentName, updates, options = {}) {
    assert.equal(documentName, "Item");
    for (const update of updates) {
      if (Object.hasOwn(update, "==type")) {
        throw new Error("Foundry forbids updating Document type through ==type");
      }
      if (Object.hasOwn(update, "==_stats")) {
        throw new Error("Foundry rollback must not replace the complete server-owned _stats object");
      }
    }
    const updated = [];
    await this.#recordMutation("updateEmbeddedDocuments", options, () => {
      for (const update of updates) {
        const item = this.items.get(update._id);
        if (!item) throw new Error(`Missing embedded Item ${update._id}`);
        applyUpdate(item._source, update);
        updated.push(item);
      }
    });
    return updated;
  }

  async deleteEmbeddedDocuments(documentName, ids, options = {}) {
    assert.equal(documentName, "Item");
    const deleted = [];
    const failsAtThisBoundary = !this.failureThrown && this.failAfterMutation === this.mutationCount + 1;
    const idsAppliedBeforeFailure = failsAtThisBoundary ? ids.slice(0, 1) : ids;
    await this.#recordMutation("deleteEmbeddedDocuments", options, () => {
      for (const id of idsAppliedBeforeFailure) {
        const item = this.items.get(id);
        if (item) deleted.push(item);
      }
      const idSet = new Set(idsAppliedBeforeFailure);
      this._items = this._items.filter((item) => !idSet.has(item.id));
    });
    return deleted;
  }

  async setFlag(scope, key, value) {
    await this.#recordMutation("setFlag", {}, () => setPath(this.flags, `${scope}.${key}`, value));
    return this;
  }

  async unsetFlag(scope, key) {
    await this.#recordMutation("unsetFlag", {}, () => deletePath(this.flags, `${scope}.${key}`));
    return this;
  }

  addItem(source) {
    const item = new FakeItem(source, { parent: this });
    this._items.push(item);
    return item;
  }
}

class FakePack {
  constructor(collection, sources) {
    this.collection = collection;
    this.documents = sources.map((source) => new FakeItem(source, {
      uuid: `Compendium.${collection}.Item.${source._id}`
    }));
  }

  async getDocuments() {
    return this.documents;
  }
}

function moduleFlags(overrides = {}) {
  return {
    managed: true,
    classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
    ...overrides
  };
}

function dnd5eFlags(sourceId, origin = undefined, root = undefined) {
  return {
    sourceId,
    ...(origin === undefined ? {} : { advancementOrigin: origin }),
    ...(root === undefined ? {} : { advancementRoot: root })
  };
}

function sourceUuid(packId, id) {
  return `Compendium.${packId}.Item.${id}`;
}

function publishedClassAdvancement(axis) {
  const data = AXIS_DATA[axis];
  return {
    _id: data.classAdvancementId,
    type: data.nativeType,
    title: `${axis} published title`,
    hint: `${axis} published hint`,
    level: data.level,
    configuration: {},
    value: { document: null, uuid: null }
  };
}

function legacyClassAdvancement(axis, selected = true) {
  const data = AXIS_DATA[axis];
  return {
    _id: data.legacyAdvancementId,
    type: axis === CRAFTSMAN_TRACKS.RESEARCH ? "ResearchChoice" : "SpecialtyChoice",
    title: `${axis} legacy title that must not survive`,
    hint: `${axis} legacy hint that must not survive`,
    level: data.level,
    configuration: {
      choices: { [data.level]: 1 },
      pool: [{ uuid: sourceUuid(LEGACY_PACK_ID, data.legacyId) }],
      type: data.type
    },
    value: {
      ability: "int",
      added: selected ? { [data.legacyId]: sourceUuid(LEGACY_PACK_ID, data.legacyId) } : {},
      replaced: {}
    }
  };
}

function classSource({ classNativeAxes = [], selectedAxes = [] } = {}) {
  const nativeSet = new Set(classNativeAxes);
  const selectedSet = new Set(selectedAxes);
  return {
    _id: "actorClass000001",
    name: "A deliberately renamed class",
    type: "class",
    img: "class.webp",
    system: {
      identifier: CRAFTSMAN_CLASS_IDENTIFIER,
      levels: 10,
      advancement: Object.values(CRAFTSMAN_TRACKS).map((axis) => {
        if (!nativeSet.has(axis)) return legacyClassAdvancement(axis, selectedSet.has(axis));
        const advancement = publishedClassAdvancement(axis);
        const data = AXIS_DATA[axis];
        advancement.value = selectedSet.has(axis)
          ? { document: data.nativeId, uuid: sourceUuid(SUBCLASS_PACK_ID, axis === "research" ? "sourceResearch01" : "sourceSpecialty") }
          : { document: null, uuid: null };
        return advancement;
      }),
      userOwnedClassState: { retained: true }
    },
    effects: [{ _id: "classEffect00001", disabled: false }],
    flags: {
      [MODULE_ID]: moduleFlags({ sourceType: "class" }),
      user: { classNote: "preserve me" }
    }
  };
}

function legacyItemSource(axis) {
  const data = AXIS_DATA[axis];
  return {
    _id: data.legacyId,
    name: `Renamed ${axis} legacy choice`,
    type: data.type,
    img: `${axis}-legacy.webp`,
    system: {
      classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
      userChoiceState: { notes: `retained ${axis}` }
    },
    effects: [{ _id: `${axis}LegacyFx`, disabled: false }],
    flags: {
      [MODULE_ID]: moduleFlags({
        sourceType: axis,
        archetypeId: data.archetypeId
      }),
      user: { legacyNote: axis }
    }
  };
}

function featureSource(axis, { linkedToNative = false } = {}) {
  const data = AXIS_DATA[axis];
  const featureUuid = sourceUuid(FEATURE_PACK_ID, data.featureSourceId);
  const root = linkedToNative
    ? `${data.nativeId}.${data.grantId}`
    : `${data.legacyId}.${axis}OldGrant`;
  return {
    _id: data.featureEmbeddedId,
    name: `User renamed ${axis} feature`,
    type: "feat",
    img: `${axis}-custom.webp`,
    system: {
      uses: { spent: 2, max: "5" },
      description: { value: `user annotations for ${axis}` }
    },
    effects: [{ _id: `${axis}FeatureFx`, disabled: true, duration: { rounds: 7 } }],
    flags: {
      [MODULE_ID]: moduleFlags({
        sourceType: `${axis}Feature`,
        axis,
        archetypeId: data.archetypeId,
        featureId: data.featureId,
        requiredLevel: data.level
      }),
      dnd5e: dnd5eFlags(featureUuid, root, root),
      user: { customized: true, note: axis }
    }
  };
}

function subclassPackSource(axis) {
  const data = AXIS_DATA[axis];
  const id = axis === CRAFTSMAN_TRACKS.RESEARCH ? "sourceResearch01" : "sourceSpecialty";
  const featureUuid = sourceUuid(FEATURE_PACK_ID, data.featureSourceId);
  return {
    _id: id,
    name: `Published ${axis} source`,
    type: "subclass",
    img: `${axis}-source.webp`,
    folder: `${axis}PackFolder`,
    ownership: { default: 2 },
    _stats: {
      compendiumSource: null,
      duplicateSource: null,
      exportSource: null,
      coreVersion: "13.346",
      systemId: "dnd5e",
      systemVersion: "5.1.10",
      createdTime: 100,
      modifiedTime: 200,
      lastModifiedBy: "gm-user"
    },
    system: {
      identifier: data.archetypeId,
      classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
      advancement: [{
        _id: data.grantId,
        type: "ItemGrant",
        title: `${axis} exact grant`,
        hint: "published grant",
        level: data.level,
        configuration: {
          items: [{ uuid: featureUuid, optional: false }],
          optional: false,
          spell: null
        },
        value: { added: {} }
      }],
      publishedOnly: { retained: true }
    },
    effects: [],
    flags: {
      [MODULE_ID]: moduleFlags({
        sourceType: "subclass",
        subclassId: data.archetypeId,
        archetypeId: data.archetypeId,
        craftsmanTrack: axis
      })
    }
  };
}

function embeddedNativeSource(axis, { correct = false } = {}) {
  const data = AXIS_DATA[axis];
  const source = subclassPackSource(axis);
  source._id = data.nativeId;
  source.folder = null;
  source.ownership = { default: 3 };
  source.flags.dnd5e = correct
    ? dnd5eFlags(sourceUuid(SUBCLASS_PACK_ID, axis === "research" ? "sourceResearch01" : "sourceSpecialty"))
    : dnd5eFlags("Compendium.world.wrong.Item.stale", "legacy.bad", "legacy.bad");
  source.system.classIdentifier = correct ? CRAFTSMAN_CLASS_IDENTIFIER : "wrong-class";
  source.system.advancement[0].value = correct
    ? { added: { [data.featureEmbeddedId]: sourceUuid(FEATURE_PACK_ID, data.featureSourceId) } }
    : { added: { staleEmbeddedId: "Compendium.world.stale.Item.feature" } };
  source.system.userNativeState = { preserve: axis };
  source.flags.user = { nativeCustomization: axis };
  return source;
}

function publishedClassSource() {
  return {
    _id: "sourceClass00001",
    name: "Published class source",
    type: "class",
    system: {
      identifier: CRAFTSMAN_CLASS_IDENTIFIER,
      advancement: Object.values(CRAFTSMAN_TRACKS).map(publishedClassAdvancement)
    },
    flags: {
      [MODULE_ID]: moduleFlags({ sourceType: "class" })
    }
  };
}

function publishedFeatureSource(axis) {
  const data = AXIS_DATA[axis];
  return {
    _id: data.featureSourceId,
    name: `Published ${axis} feature source`,
    type: "feat",
    system: { identifier: `${axis}-feature` },
    flags: {
      [MODULE_ID]: moduleFlags({
        sourceType: `${axis}Feature`,
        axis,
        archetypeId: data.archetypeId,
        featureId: data.featureId,
        requiredLevel: data.level
      })
    }
  };
}

function actorSnapshot(actor) {
  return {
    flags: clone(actor.flags),
    items: actor.items.contents
      .map((item) => item.toObject())
      .sort((left, right) => left._id.localeCompare(right._id))
  };
}

function makeFixture({
  actorFlag = undefined,
  classNativeAxes = [],
  failAfterMutation = 0,
  legacyAxes,
  mutationHook = null,
  nativeAxes = [],
  nativeCorrect = false,
  selectedAxes = [CRAFTSMAN_TRACKS.RESEARCH, CRAFTSMAN_TRACKS.SPECIALTY],
  worldVersion = 0
} = {}) {
  const selectedSet = new Set(selectedAxes);
  const legacySet = new Set(legacyAxes ?? selectedAxes);
  const nativeSet = new Set(nativeAxes);
  const items = [classSource({ classNativeAxes, selectedAxes })];

  for (const axis of Object.values(CRAFTSMAN_TRACKS)) {
    if (legacySet.has(axis)) items.push(legacyItemSource(axis));
    if (selectedSet.has(axis)) items.push(featureSource(axis, { linkedToNative: nativeCorrect }));
    if (nativeSet.has(axis)) items.push(embeddedNativeSource(axis, { correct: nativeCorrect }));
  }

  const flags = actorFlag === undefined
    ? { user: { actorState: "preserve" } }
    : {
        user: { actorState: "preserve" },
        [MODULE_ID]: { craftsmanSubclassMigrationVersion: actorFlag }
      };
  const actor = new FakeActor({
    _id: "actorCraftsman01",
    name: "Craftsman migration fixture",
    type: "character",
    flags,
    items
  }, { failAfterMutation, mutationHook });

  const packs = new Map([
    [CLASS_PACK_ID, new FakePack(CLASS_PACK_ID, [publishedClassSource()])],
    [SUBCLASS_PACK_ID, new FakePack(SUBCLASS_PACK_ID, Object.values(CRAFTSMAN_TRACKS).map(subclassPackSource))],
    [FEATURE_PACK_ID, new FakePack(FEATURE_PACK_ID, Object.values(CRAFTSMAN_TRACKS).map(publishedFeatureSource))],
    [LEGACY_PACK_ID, new FakePack(LEGACY_PACK_ID, [{
      _id: "outsiderLegacy01",
      name: "Third-party legacy document",
      type: RESEARCH_ITEM_TYPE,
      system: { classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER },
      flags: { [MODULE_ID]: { managed: false, archetypeId: "third-party" } }
    }])]
  ]);
  const settingsStore = new Map([[SETTINGS_KEYS.CRAFTSMAN_SUBCLASS_MIGRATION_VERSION, worldVersion]]);
  const settingsWrites = [];
  const gmUser = { id: "gm-user", isGM: true, active: true };
  const game = {
    user: gmUser,
    users: { activeGM: gmUser, contents: [gmUser] },
    system: { id: "dnd5e" },
    actors: { contents: [actor] },
    packs,
    items: {
      fromCompendium(document) {
        return {
          ...document.toObject(),
          _stats: {
            ...clone(document.toObject()._stats ?? {}),
            compendiumSource: document.uuid
          }
        };
      }
    },
    settings: {
      get(_moduleId, key) { return settingsStore.get(key); },
      async set(_moduleId, key, value) {
        settingsWrites.push({ key, value });
        settingsStore.set(key, value);
        return value;
      }
    }
  };

  const uuidMap = new Map();
  for (const pack of packs.values()) {
    for (const document of pack.documents) uuidMap.set(document.uuid, document);
  }
  let randomCounter = 0;
  const service = new CraftsmanSubclassMigrationService({
    fromUuid: async (uuid) => uuidMap.get(uuid) ?? null,
    gameProvider: () => game,
    randomId: () => `n${String(++randomCounter).padStart(15, "0")}`
  });

  return {
    actor,
    game,
    legacyOutsider: packs.get(LEGACY_PACK_ID).documents[0],
    packs,
    service,
    settingsStore,
    settingsWrites,
    uuidMap
  };
}

function byTrack(actor, axis) {
  return actor.items.contents.find((item) => (
    item.type === "subclass"
    && item.getFlag(MODULE_ID, "craftsmanTrack") === axis
  ));
}

function axisClassAdvancement(actor, axis) {
  const expectedType = AXIS_DATA[axis].nativeType;
  return actor.items.get("actorClass000001").system.advancement.find((advancement) => advancement.type === expectedType);
}

function assertMigrationOption(mutation) {
  assert.equal(mutation.options?.rebreyaCraftsmanSubclassMigration, true);
}

function assertSelectedAxisMigrated(actor, axis) {
  const data = AXIS_DATA[axis];
  const native = byTrack(actor, axis);
  assert.ok(native, `${axis} native subclass exists`);
  const expectedSubclassUuid = sourceUuid(
    SUBCLASS_PACK_ID,
    axis === CRAFTSMAN_TRACKS.RESEARCH ? "sourceResearch01" : "sourceSpecialty"
  );
  assert.equal(native.getFlag(MODULE_ID, "managed"), true);
  assert.equal(native.getFlag(MODULE_ID, "archetypeId"), data.archetypeId);
  assert.equal(native.getFlag(MODULE_ID, "classIdentifier"), CRAFTSMAN_CLASS_IDENTIFIER);
  assert.equal(native.system.classIdentifier, CRAFTSMAN_CLASS_IDENTIFIER);
  assert.equal(native.getFlag("dnd5e", "sourceId"), expectedSubclassUuid);
  assert.equal(Object.hasOwn(native.flags?.dnd5e ?? {}, "advancementOrigin"), false);
  assert.equal(Object.hasOwn(native.flags?.dnd5e ?? {}, "advancementRoot"), false);

  const classAdvancement = axisClassAdvancement(actor, axis);
  const published = publishedClassAdvancement(axis);
  assert.deepEqual(classAdvancement, {
    ...published,
    value: { document: native.id, uuid: expectedSubclassUuid }
  });
  assert.deepEqual(Object.keys(classAdvancement.configuration), []);
  assert.deepEqual(Object.keys(classAdvancement.value).sort(), ["document", "uuid"]);

  const grant = native.system.advancement.find((advancement) => advancement._id === data.grantId);
  const featureUuid = sourceUuid(FEATURE_PACK_ID, data.featureSourceId);
  assert.equal(grant.type, "ItemGrant");
  assert.equal(grant.level, data.level);
  assert.deepEqual(grant.value, { added: { [data.featureEmbeddedId]: featureUuid } });

  const feature = actor.items.get(data.featureEmbeddedId);
  assert.ok(feature, `${axis} embedded feature ID is retained`);
  assert.equal(feature.getFlag("dnd5e", "sourceId"), featureUuid);
  assert.equal(feature.getFlag("dnd5e", "advancementOrigin"), `${native.id}.${data.grantId}`);
  assert.equal(feature.getFlag("dnd5e", "advancementRoot"), `${native.id}.${data.grantId}`);
  assert.deepEqual(feature.system.uses, { spent: 2, max: "5" });
  assert.deepEqual(feature.flags.user, { customized: true, note: axis });
  assert.equal(actor.items.get(data.legacyId), undefined);
}

test("migrates both legacy axes to exact native subclass, class, grant, and feature relationships", async () => {
  const fixture = makeFixture();
  const featureBefore = Object.fromEntries(Object.values(CRAFTSMAN_TRACKS).map((axis) => {
    const id = AXIS_DATA[axis].featureEmbeddedId;
    return [axis, fixture.actor.items.get(id).toObject()];
  }));

  const result = await fixture.service.migrateWorldActors();

  assert.deepEqual(result, { actorsMigrated: 1, actorsScanned: 1, actorsSkipped: 0 });
  assertSelectedAxisMigrated(fixture.actor, CRAFTSMAN_TRACKS.RESEARCH);
  assertSelectedAxisMigrated(fixture.actor, CRAFTSMAN_TRACKS.SPECIALTY);
  for (const axis of Object.values(CRAFTSMAN_TRACKS)) {
    const after = fixture.actor.items.get(AXIS_DATA[axis].featureEmbeddedId).toObject();
    const before = featureBefore[axis];
    assert.equal(after._id, before._id);
    assert.equal(after.name, before.name);
    assert.equal(after.img, before.img);
    assert.deepEqual(after.system, before.system);
    assert.deepEqual(after.effects, before.effects);
    assert.deepEqual(after.flags.user, before.flags.user);
  }
  assert.equal(
    fixture.actor.getFlag(MODULE_ID, "craftsmanSubclassMigrationVersion"),
    CRAFTSMAN_SUBCLASS_MIGRATION_VERSION
  );
  assert.deepEqual(fixture.settingsWrites, [{
    key: SETTINGS_KEYS.CRAFTSMAN_SUBCLASS_MIGRATION_VERSION,
    value: CRAFTSMAN_SUBCLASS_MIGRATION_VERSION
  }]);
  assert.equal(fixture.legacyOutsider.getFlag(MODULE_ID, "managed"), false);
  fixture.actor.mutations
    .filter((mutation) => mutation.operation.endsWith("EmbeddedDocuments"))
    .forEach(assertMigrationOption);
  assert.deepEqual(
    fixture.actor.mutations.slice(0, 6).map((mutation) => mutation.operation),
    [
      "createEmbeddedDocuments",
      "updateEmbeddedDocuments",
      "updateEmbeddedDocuments",
      "updateEmbeddedDocuments",
      "deleteEmbeddedDocuments",
      "setFlag"
    ]
  );
});

test("migrates one selected axis independently and replaces the unselected choice with an empty native schema", async () => {
  const fixture = makeFixture({ selectedAxes: [CRAFTSMAN_TRACKS.RESEARCH] });

  await fixture.service.migrateActor(fixture.actor);

  assertSelectedAxisMigrated(fixture.actor, CRAFTSMAN_TRACKS.RESEARCH);
  assert.equal(byTrack(fixture.actor, CRAFTSMAN_TRACKS.SPECIALTY), undefined);
  assert.deepEqual(axisClassAdvancement(fixture.actor, CRAFTSMAN_TRACKS.SPECIALTY), publishedClassAdvancement(CRAFTSMAN_TRACKS.SPECIALTY));
});

test("migrates a Craftsman with neither axis selected without inventing subclass Items", async () => {
  const fixture = makeFixture({ selectedAxes: [], legacyAxes: [] });

  await fixture.service.migrateActor(fixture.actor);

  assert.equal(byTrack(fixture.actor, CRAFTSMAN_TRACKS.RESEARCH), undefined);
  assert.equal(byTrack(fixture.actor, CRAFTSMAN_TRACKS.SPECIALTY), undefined);
  assert.deepEqual(axisClassAdvancement(fixture.actor, CRAFTSMAN_TRACKS.RESEARCH), publishedClassAdvancement(CRAFTSMAN_TRACKS.RESEARCH));
  assert.deepEqual(axisClassAdvancement(fixture.actor, CRAFTSMAN_TRACKS.SPECIALTY), publishedClassAdvancement(CRAFTSMAN_TRACKS.SPECIALTY));
  assert.equal(fixture.actor.getFlag(MODULE_ID, "craftsmanSubclassMigrationVersion"), CRAFTSMAN_SUBCLASS_MIGRATION_VERSION);
});

test("reconciles native plus legacy crash state and repairs partial grant maps, source flags, class values, and feature links", async () => {
  const fixture = makeFixture({
    classNativeAxes: [CRAFTSMAN_TRACKS.RESEARCH],
    nativeAxes: [CRAFTSMAN_TRACKS.RESEARCH],
    nativeCorrect: false
  });
  const existingNative = fixture.actor.items.get(AXIS_DATA.research.nativeId);
  const existingUserState = clone(existingNative.system.userNativeState);
  const existingUserFlags = clone(existingNative.flags.user);

  await fixture.service.migrateActor(fixture.actor);

  assertSelectedAxisMigrated(fixture.actor, CRAFTSMAN_TRACKS.RESEARCH);
  assertSelectedAxisMigrated(fixture.actor, CRAFTSMAN_TRACKS.SPECIALTY);
  assert.equal(byTrack(fixture.actor, CRAFTSMAN_TRACKS.RESEARCH).id, AXIS_DATA.research.nativeId);
  assert.deepEqual(byTrack(fixture.actor, CRAFTSMAN_TRACKS.RESEARCH).system.userNativeState, existingUserState);
  assert.deepEqual(byTrack(fixture.actor, CRAFTSMAN_TRACKS.RESEARCH).flags.user, existingUserFlags);
  assert.equal(
    fixture.actor.mutations.filter((mutation) => mutation.operation === "createEmbeddedDocuments")[0].options.keepId,
    true
  );
  assert.equal(
    fixture.actor.mutations.filter((mutation) => mutation.operation === "createEmbeddedDocuments").length,
    1,
    "only the missing specialty is created"
  );
});

test("an already migrated Actor and a second run converge with zero Item creation or other writes", async () => {
  const fixture = makeFixture({ actorFlag: CRAFTSMAN_SUBCLASS_MIGRATION_VERSION });
  await fixture.service.migrateActor(fixture.actor);
  fixture.actor.mutations.length = 0;
  fixture.actor.mutationCount = 0;

  const result = await fixture.service.migrateActor(fixture.actor);

  assert.deepEqual(result, { migrated: false, skipped: true });
  assert.deepEqual(fixture.actor.mutations, []);
  assert.equal(fixture.actor.items.contents.filter((item) => item.type === "subclass").length, 2);
});

test("a structurally migrated fixture is a zero-write no-op", async () => {
  const fixture = makeFixture({
    actorFlag: CRAFTSMAN_SUBCLASS_MIGRATION_VERSION,
    classNativeAxes: Object.values(CRAFTSMAN_TRACKS),
    legacyAxes: [],
    nativeAxes: Object.values(CRAFTSMAN_TRACKS),
    nativeCorrect: true
  });

  const result = await fixture.service.migrateActor(fixture.actor);

  assert.deepEqual(result, { migrated: false, skipped: true });
  assert.deepEqual(fixture.actor.mutations, []);
});

test("current world version still scans and migrates an Actor imported later", async () => {
  const fixture = makeFixture({ worldVersion: CRAFTSMAN_SUBCLASS_MIGRATION_VERSION });

  const result = await fixture.service.migrateWorldActors();

  assert.equal(result.actorsScanned, 1);
  assert.equal(result.actorsMigrated, 1);
  assertSelectedAxisMigrated(fixture.actor, CRAFTSMAN_TRACKS.RESEARCH);
  assertSelectedAxisMigrated(fixture.actor, CRAFTSMAN_TRACKS.SPECIALTY);
});

test("preflight fails closed before the first write for missing, unmanaged, ambiguous, and duplicate identities", async (t) => {
  const cases = [
    {
      name: "missing subclass source",
      mutate(fixture) {
        const pack = fixture.packs.get(SUBCLASS_PACK_ID);
        const [removed] = pack.documents.splice(0, 1);
        fixture.uuidMap.delete(removed.uuid);
      },
      error: /Actor actorCraftsman01.*research.*research-alpha/u
    },
    {
      name: "unmanaged subclass source collision",
      mutate(fixture) {
        fixture.packs.get(SUBCLASS_PACK_ID).documents[0]._source.flags[MODULE_ID].managed = false;
      },
      error: /Actor actorCraftsman01.*research.*unmanaged/u
    },
    {
      name: "ambiguous subclass source collision",
      mutate(fixture) {
        const duplicate = subclassPackSource(CRAFTSMAN_TRACKS.RESEARCH);
        duplicate._id = "sourceResearch02";
        const item = new FakeItem(duplicate, { uuid: sourceUuid(SUBCLASS_PACK_ID, duplicate._id) });
        fixture.packs.get(SUBCLASS_PACK_ID).documents.push(item);
        fixture.uuidMap.set(item.uuid, item);
      },
      error: /Actor actorCraftsman01.*research.*ambiguous/u
    },
    {
      name: "missing feature source",
      mutate(fixture) {
        const pack = fixture.packs.get(FEATURE_PACK_ID);
        const [removed] = pack.documents.splice(0, 1);
        fixture.uuidMap.delete(removed.uuid);
      },
      error: /Actor actorCraftsman01.*research.*research-feature/u
    },
    {
      name: "affected feature with malformed class identity",
      mutate(fixture) {
        delete fixture.actor.items.get(AXIS_DATA.research.featureEmbeddedId).flags[MODULE_ID].classIdentifier;
      },
      error: /Actor actorCraftsman01.*research.*feature.*classIdentifier/u
    },
    {
      name: "stale feature from another archetype on the selected research axis",
      mutate(fixture) {
        const stale = featureSource(CRAFTSMAN_TRACKS.RESEARCH);
        stale._id = "featureResearchBeta";
        stale.flags[MODULE_ID].archetypeId = "research-beta";
        stale.flags[MODULE_ID].featureId = "craftsman-v01::research::research-beta::stale-feature";
        fixture.actor.addItem(stale);
      },
      error: /Actor actorCraftsman01.*research.*feature.*archetypeId/u
    },
    {
      name: "related research feature with missing archetype identity",
      mutate(fixture) {
        delete fixture.actor.items.get(AXIS_DATA.research.featureEmbeddedId).flags[MODULE_ID].archetypeId;
      },
      error: /Actor actorCraftsman01.*research.*feature.*archetypeId/u
    },
    {
      name: "related research feature with missing feature identity",
      mutate(fixture) {
        delete fixture.actor.items.get(AXIS_DATA.research.featureEmbeddedId).flags[MODULE_ID].featureId;
      },
      error: /Actor actorCraftsman01.*research.*feature.*featureId/u
    },
    {
      name: "related research feature with missing managed identity",
      mutate(fixture) {
        delete fixture.actor.items.get(AXIS_DATA.research.featureEmbeddedId).flags[MODULE_ID].managed;
      },
      error: /Actor actorCraftsman01.*research.*unmanaged embedded feature/u
    },
    {
      name: "duplicate legacy Item",
      mutate(fixture) {
        const duplicate = legacyItemSource(CRAFTSMAN_TRACKS.RESEARCH);
        duplicate._id = "legacyResearch02";
        fixture.actor.addItem(duplicate);
      },
      error: /Actor actorCraftsman01.*research.*duplicate legacy/u
    },
    {
      name: "duplicate native tracked Item",
      mutate(fixture) {
        const duplicateA = embeddedNativeSource(CRAFTSMAN_TRACKS.RESEARCH);
        const duplicateB = embeddedNativeSource(CRAFTSMAN_TRACKS.RESEARCH);
        duplicateA._id = "nativeResearch02";
        duplicateB._id = "nativeResearch03";
        fixture.actor.addItem(duplicateA);
        fixture.actor.addItem(duplicateB);
      },
      error: /Actor actorCraftsman01.*research.*duplicate native/u
    },
    {
      name: "unmanaged Craftsman subclass on Actor",
      mutate(fixture) {
        const unmanaged = embeddedNativeSource(CRAFTSMAN_TRACKS.RESEARCH);
        unmanaged._id = "nativeUnmanaged1";
        unmanaged.flags[MODULE_ID].managed = false;
        fixture.actor.addItem(unmanaged);
      },
      error: /Actor actorCraftsman01.*research.*unmanaged/u
    },
    {
      name: "tracked native subclass with malformed class identity",
      mutate(fixture) {
        const malformed = embeddedNativeSource(CRAFTSMAN_TRACKS.RESEARCH);
        malformed._id = "nativeMalformed1";
        delete malformed.flags[MODULE_ID].classIdentifier;
        malformed.system.classIdentifier = "wrong-class";
        fixture.actor.addItem(malformed);
      },
      error: /Actor actorCraftsman01.*research.*classIdentifier/u
    },
    {
      name: "allocated embedded native ID collision",
      mutate(fixture) {
        fixture.actor.addItem({
          _id: "n000000000000001",
          name: "Unrelated user Item",
          type: "loot",
          system: { quantity: 1 },
          flags: { user: { retained: true } }
        });
      },
      error: /Actor actorCraftsman01.*research.*embedded subclass ID.*collision/u
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const fixture = makeFixture();
      scenario.mutate(fixture);
      const before = actorSnapshot(fixture.actor);

      await assert.rejects(() => fixture.service.migrateActor(fixture.actor), scenario.error);

      assert.deepEqual(fixture.actor.mutations, []);
      assert.deepEqual(actorSnapshot(fixture.actor), before);
      assert.ok(fixture.actor.items.get(AXIS_DATA.research.legacyId));
      assert.ok(fixture.actor.items.get(AXIS_DATA.specialty.legacyId));
    });
  }
});

test("preflight rejects missing or ambiguous published class advancement contracts before writing", async (t) => {
  await t.test("missing published class source", async () => {
    const fixture = makeFixture();
    fixture.packs.get(CLASS_PACK_ID).documents.length = 0;
    await assert.rejects(
      () => fixture.service.migrateActor(fixture.actor),
      /Actor actorCraftsman01.*published class source/u
    );
    assert.deepEqual(fixture.actor.mutations, []);
  });

  await t.test("wrong published advancement level", async () => {
    const fixture = makeFixture();
    fixture.packs.get(CLASS_PACK_ID).documents[0].system.advancement[0].level = 3;
    await assert.rejects(
      () => fixture.service.migrateActor(fixture.actor),
      /Actor actorCraftsman01.*research.*level 2/u
    );
    assert.deepEqual(fixture.actor.mutations, []);
  });

  for (const [label, configuration] of [
    ["configuration with keys", { unexpected: true }],
    ["array configuration", []],
    ["null configuration", null]
  ]) {
    await t.test(`non-empty native ${label}`, async () => {
      const fixture = makeFixture();
      fixture.packs.get(CLASS_PACK_ID).documents[0].system.advancement[0].configuration = configuration;
      await assert.rejects(
        () => fixture.service.migrateActor(fixture.actor),
        /Actor actorCraftsman01.*research.*configuration.*plain empty object/u
      );
      assert.deepEqual(fixture.actor.mutations, []);
    });
  }
});

test("preflight rejects an orphan native Craftsman subclass when its embedded class is absent", async () => {
  const fixture = makeFixture({
    classNativeAxes: [CRAFTSMAN_TRACKS.RESEARCH],
    legacyAxes: [],
    nativeAxes: [CRAFTSMAN_TRACKS.RESEARCH],
    selectedAxes: [CRAFTSMAN_TRACKS.RESEARCH]
  });
  fixture.actor._items = fixture.actor._items.filter((item) => item.type !== "class");

  await assert.rejects(
    () => fixture.service.migrateActor(fixture.actor),
    /Actor actorCraftsman01.*embedded Craftsman class/u
  );
  assert.deepEqual(fixture.actor.mutations, []);
});

test("failure after every mutation boundary restores full sources, deleted legacy IDs, partial native state, and actor flag", async (t) => {
  for (const boundary of [1, 2, 3, 4, 5, 6]) {
    await t.test(`boundary ${boundary}`, async () => {
      const fixture = makeFixture({
        actorFlag: 0,
        classNativeAxes: [CRAFTSMAN_TRACKS.RESEARCH],
        failAfterMutation: boundary,
        nativeAxes: [CRAFTSMAN_TRACKS.RESEARCH],
        nativeCorrect: false
      });
      const before = actorSnapshot(fixture.actor);

      await assert.rejects(
        () => fixture.service.migrateActor(fixture.actor),
        new RegExp(`Injected failure after mutation ${boundary}`, "u")
      );

      assert.deepEqual(actorSnapshot(fixture.actor), before);
      assert.ok(fixture.actor.items.get(AXIS_DATA.research.legacyId));
      assert.ok(fixture.actor.items.get(AXIS_DATA.specialty.legacyId));
      assert.equal(fixture.actor.items.get("n000000000000001"), undefined);
      assert.deepEqual(
        fixture.actor.items.get(AXIS_DATA.research.nativeId).toObject(),
        before.items.find((item) => item._id === AXIS_DATA.research.nativeId)
      );
      assert.equal(fixture.actor.getFlag(MODULE_ID, "craftsmanSubclassMigrationVersion"), 0);
    });
  }
});

test("rollback restores the full persisted Item source after hook-side top-level mutations", async () => {
  const fixture = makeFixture({
    actorFlag: 0,
    classNativeAxes: [CRAFTSMAN_TRACKS.RESEARCH],
    failAfterMutation: 2,
    mutationHook({ actor, mutationCount }) {
      if (mutationCount !== 2) return;
      const classItem = actor.items.get("actorClass000001");
      classItem._source.name = "Hook-mutated class name";
      classItem._source.img = "hook-mutated.webp";
      classItem._source.effects = [{ _id: "hookEffect000001", disabled: true }];
      classItem._source.sort = 999999;
      classItem._source.system.hookAdded = { removeOnRollback: true };
      classItem._source.flags.hookAdded = { removeOnRollback: true };
      const legacyItem = actor.items.get(AXIS_DATA.research.legacyId);
      legacyItem._source.name = "Hook-mutated legacy name";
      legacyItem._source.img = "hook-mutated-legacy.webp";
      legacyItem._source.effects = [{ _id: "hookLegacyFx0001", disabled: true }];
      legacyItem._source.sort = 888888;
      legacyItem._source.system.hookAdded = { removeOnRollback: true };
      legacyItem._source.flags.hookAdded = { removeOnRollback: true };
      const nativeItem = actor.items.get(AXIS_DATA.research.nativeId);
      nativeItem._source._stats.compendiumSource = "Compendium.world.hook.Item.changedSource";
      nativeItem._source._stats.duplicateSource = "Actor.hookActor.Item.changedDuplicate";
      nativeItem._source._stats.exportSource = {
        worldId: "hook-world",
        uuid: "Actor.hookActor.Item.changedExport",
        coreVersion: "13.999",
        systemId: "dnd5e",
        systemVersion: "99.0.0"
      };
    },
    nativeAxes: [CRAFTSMAN_TRACKS.RESEARCH],
    nativeCorrect: false
  });
  fixture.actor.items.get("actorClass000001")._source.sort = 123456;
  fixture.actor.items.get(AXIS_DATA.research.legacyId)._source.sort = 234567;
  const before = actorSnapshot(fixture.actor);

  await assert.rejects(
    () => fixture.service.migrateActor(fixture.actor),
    /Injected failure after mutation 2/u
  );

  assert.deepEqual(actorSnapshot(fixture.actor), before);
});

test("migrated ItemGrant maps make level-down removal and retained re-level restore converge without duplicates", async () => {
  const fixture = makeFixture();
  await fixture.service.migrateActor(fixture.actor);
  const axis = CRAFTSMAN_TRACKS.RESEARCH;
  const data = AXIS_DATA[axis];
  const native = byTrack(fixture.actor, axis);
  const grant = native.system.advancement.find((advancement) => advancement._id === data.grantId);
  const retained = fixture.actor.items.get(data.featureEmbeddedId).toObject();

  await fixture.actor.deleteEmbeddedDocuments("Item", Object.keys(grant.value.added), MIGRATION_OPTION);
  grant.value = { added: {} };
  assert.equal(fixture.actor.items.get(data.featureEmbeddedId), undefined);

  await fixture.actor.createEmbeddedDocuments("Item", [retained], { ...MIGRATION_OPTION, keepId: true });
  grant.value = { added: { [retained._id]: retained.flags.dnd5e.sourceId } };

  assert.equal(fixture.actor.items.contents.filter((item) => item.id === data.featureEmbeddedId).length, 1);
  assert.deepEqual(grant.value.added, {
    [data.featureEmbeddedId]: sourceUuid(FEATURE_PACK_ID, data.featureSourceId)
  });
});

test("a failed Actor prevents the world version write but does not prevent later Actors from being scanned", async () => {
  const fixture = makeFixture();
  const failing = makeFixture().actor;
  failing.id = "actorFailing0001";
  failing._id = "actorFailing0001";
  const later = makeFixture({ selectedAxes: [], legacyAxes: [] }).actor;
  later.id = "actorLater000001";
  later._id = "actorLater000001";
  const missingSourceId = AXIS_DATA.research.featureSourceId;
  fixture.packs.get(FEATURE_PACK_ID).documents = fixture.packs.get(FEATURE_PACK_ID).documents
    .filter((document) => document.id !== missingSourceId);
  fixture.uuidMap.delete(sourceUuid(FEATURE_PACK_ID, missingSourceId));
  fixture.game.actors.contents = [failing, later];

  await assert.rejects(() => fixture.service.migrateWorldActors(), /Craftsman subclass migration failed/u);

  assert.deepEqual(fixture.settingsWrites, []);
  assert.equal(failing.mutations.length, 0);
  assert.ok(later.mutations.length > 0, "the later valid Actor is still migrated during the failed pass");
  assert.equal(later.getFlag(MODULE_ID, "craftsmanSubclassMigrationVersion"), CRAFTSMAN_SUBCLASS_MIGRATION_VERSION);
});

test("migration is an active-GM-only dnd5e operation", async () => {
  const fixture = makeFixture();
  fixture.game.user.active = false;
  fixture.game.users.activeGM = { id: "other-gm", isGM: true, active: true };

  const result = await fixture.service.migrateWorldActors();

  assert.deepEqual(result, { actorsMigrated: 0, actorsScanned: 0, actorsSkipped: 0 });
  assert.deepEqual(fixture.actor.mutations, []);
  assert.deepEqual(fixture.settingsWrites, []);
});

test("registerSettings exposes a hidden numeric Craftsman migration version", () => {
  const originalGame = globalThis.game;
  const registrations = [];
  globalThis.game = {
    settings: {
      register(moduleId, key, config) { registrations.push({ moduleId, key, config }); }
    }
  };
  try {
    registerSettings();
  }
  finally {
    globalThis.game = originalGame;
  }

  assert.equal(SETTINGS_KEYS.CRAFTSMAN_SUBCLASS_MIGRATION_VERSION, "craftsmanSubclassMigrationVersion");
  const registration = registrations.find((entry) => entry.key === SETTINGS_KEYS.CRAFTSMAN_SUBCLASS_MIGRATION_VERSION);
  assert.ok(registration);
  assert.equal(registration.moduleId, MODULE_ID);
  assert.equal(registration.config.scope, "world");
  assert.equal(registration.config.config, false);
  assert.equal(registration.config.type, Number);
  assert.equal(registration.config.default, 0);
});

test("main wires migration immediately after a successful classes compendium sync and contains one migration warning path", () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, "scripts", "main.js"), "utf8");
  assert.match(source, /import \{ CraftsmanSubclassMigrationService \} from "\.\/data\/craftsman-subclass-migration\.js";/u);
  assert.match(source, /this\.craftsmanSubclassMigration = new CraftsmanSubclassMigrationService\(\);/u);
  assert.match(
    source,
    /await this\.classesCompendium\.sync\(\);\s*try \{\s*await this\.craftsmanSubclassMigration\.migrateWorldActors\(\);/u
  );
  assert.equal((source.match(/Failed to migrate Craftsman subclasses/gu) ?? []).length, 1);
});
