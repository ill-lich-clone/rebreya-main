import {
  CLASS_FEATURES_COMPENDIUM_NAME,
  CLASSES_COMPENDIUM_NAME,
  CRAFTSMAN_ARCHETYPE_REGISTRY,
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_SUBCLASS_COMPENDIUM_ID,
  CRAFTSMAN_TRACKS,
  MODULE_ID,
  RESEARCH_ITEM_TYPE,
  SETTINGS_KEYS,
  SPECIALTY_ITEM_TYPE
} from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export const CRAFTSMAN_SUBCLASS_MIGRATION_VERSION = 1;

const MIGRATION_OPTIONS = Object.freeze({
  rebreyaCraftsmanSubclassMigration: true
});
const CLASS_PACK_ID = `world.${CLASSES_COMPENDIUM_NAME}`;
const SUBCLASS_PACK_ID = CRAFTSMAN_SUBCLASS_COMPENDIUM_ID;
const FEATURE_PACK_ID = `world.${CLASS_FEATURES_COMPENDIUM_NAME}`;
const ACTOR_FLAG = "craftsmanSubclassMigrationVersion";
const AXIS_CONFIG = Object.freeze({
  [CRAFTSMAN_TRACKS.RESEARCH]: Object.freeze({
    classType: "ResearchSubclass",
    legacyClassType: "ResearchChoice",
    legacyItemType: RESEARCH_ITEM_TYPE,
    level: 2
  }),
  [CRAFTSMAN_TRACKS.SPECIALTY]: Object.freeze({
    classType: "SpecialtySubclass",
    legacyClassType: "SpecialtyChoice",
    legacyItemType: SPECIALTY_ITEM_TYPE,
    level: 3
  })
});
const AXES = Object.freeze(Object.keys(AXIS_CONFIG));
const SERVER_MANAGED_STAT_FIELDS = Object.freeze([
  "coreVersion",
  "systemId",
  "systemVersion",
  "createdTime",
  "modifiedTime",
  "lastModifiedBy"
]);
const RESTORABLE_STAT_FIELDS = Object.freeze([
  "compendiumSource",
  "duplicateSource",
  "exportSource"
]);
const NON_RESTORABLE_TOP_LEVEL_FIELDS = Object.freeze(new Set(["_id", "type", "_stats"]));

function clone(value) {
  if (value === undefined) return undefined;
  const deepClone = globalThis.foundry?.utils?.deepClone;
  return typeof deepClone === "function" ? deepClone(value) : structuredClone(value);
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function getItems(actor) {
  const items = actor?.items;
  if (Array.isArray(items?.contents)) return items.contents;
  if (Array.isArray(items)) return items;
  if (typeof items?.values === "function") return Array.from(items.values());
  return [];
}

function getActors(game) {
  const actors = game?.actors;
  if (Array.isArray(actors?.contents)) return actors.contents;
  if (Array.isArray(actors)) return actors;
  if (typeof actors?.values === "function") return Array.from(actors.values());
  return [];
}

function itemId(item) {
  return cleanString(item?.id ?? item?._id);
}

function actorId(actor) {
  return cleanString(actor?.id ?? actor?._id) || "unknown";
}

function getFlag(document, scope, key) {
  return document?.getFlag?.(scope, key) ?? document?.flags?.[scope]?.[key];
}

function moduleFlag(document, key) {
  return getFlag(document, MODULE_ID, key);
}

function hasOwn(object, key) {
  return Object.hasOwn(object ?? {}, key);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isPlainEmptyObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === 0;
}

function comparablePersistedSource(source) {
  const comparable = clone(source);
  for (const field of SERVER_MANAGED_STAT_FIELDS) delete comparable?._stats?.[field];
  return comparable;
}

function toSource(document) {
  return clone(document?.toObject?.() ?? document ?? {});
}

function sourceAdvancements(document) {
  const advancements = toSource(document)?.system?.advancement;
  return Array.isArray(advancements) ? advancements : [];
}

function packDocuments(pack) {
  if (!pack) return Promise.resolve([]);
  if (typeof pack.getDocuments === "function") return pack.getDocuments();
  if (Array.isArray(pack.contents)) return Promise.resolve(pack.contents);
  if (Array.isArray(pack.documents)) return Promise.resolve(pack.documents);
  return Promise.resolve([]);
}

function expectedUuid(packId, document) {
  const id = typeof (document?.id ?? document?._id) === "string"
    ? (document.id ?? document._id)
    : "";
  return `Compendium.${packId}.Item.${id}`;
}

function preflightError(actor, axis, detail) {
  return new Error(
    `Craftsman subclass migration preflight failed [Actor ${actorId(actor)}] [axis ${axis || "all"}]: ${detail}`
  );
}

function canonicalArchetype(actor, axis, archetypeId, label = "archetype") {
  const definition = typeof archetypeId === "string"
    && Object.hasOwn(CRAFTSMAN_ARCHETYPE_REGISTRY, archetypeId)
    ? CRAFTSMAN_ARCHETYPE_REGISTRY[archetypeId]
    : null;
  if (!definition) {
    throw preflightError(actor, axis, `${label} has unknown canonical archetypeId ${cleanString(archetypeId) || "<missing>"}`);
  }
  if (definition.track !== axis) {
    throw preflightError(actor, axis, `${label} archetypeId ${archetypeId} belongs to ${definition.track}`);
  }
  return definition;
}

function rollbackError(actor, originalError, rollbackFailure) {
  return new AggregateError(
    [originalError, rollbackFailure],
    `Craftsman subclass migration rollback failed irrecoverably [Actor ${actorId(actor)}]: ${rollbackFailure.message}`
  );
}

function validatePack(pack, expectedCollection, actor, axis) {
  if (!pack || pack.collection !== expectedCollection) {
    throw preflightError(actor, axis, `missing exact compendium ${expectedCollection}`);
  }
  return pack;
}

function validateSourceUuid(source, packId, actor, axis, label) {
  const uuid = typeof source?.uuid === "string" ? source.uuid : "";
  const expected = expectedUuid(packId, source);
  const sourceId = typeof (source?.id ?? source?._id) === "string"
    ? (source.id ?? source._id)
    : "";
  if (!sourceId || uuid !== expected) {
    throw preflightError(actor, axis, `${label} has invalid UUID ${uuid || "<missing>"}; expected ${expected}`);
  }
  return uuid;
}

function validateManagedSource(source, actor, axis, label, expectedSourceType) {
  if (moduleFlag(source, "managed") !== true) {
    throw preflightError(actor, axis, `${label} is unmanaged`);
  }
  if (expectedSourceType && moduleFlag(source, "sourceType") !== expectedSourceType) {
    throw preflightError(
      actor,
      axis,
      `${label} has sourceType ${cleanString(moduleFlag(source, "sourceType")) || "<missing>"}`
    );
  }
  if (moduleFlag(source, "classIdentifier") !== CRAFTSMAN_CLASS_IDENTIFIER) {
    throw preflightError(actor, axis, `${label} has the wrong classIdentifier`);
  }
}

function uniqueIdentity(candidates, actor, axis, label, identifier) {
  if (candidates.length === 0) {
    throw preflightError(actor, axis, `missing ${label}: ${identifier}`);
  }
  if (candidates.length > 1) {
    throw preflightError(actor, axis, `ambiguous ${label}: ${identifier}`);
  }
  return candidates[0];
}

function isRelatedAxisFeature(item, axis) {
  return moduleFlag(item, "axis") === axis
    || moduleFlag(item, "sourceType") === `${axis}Feature`;
}

function validateActorClass(actor, items) {
  const related = items.filter((item) => (
    item?.type === "class"
    && moduleFlag(item, "classIdentifier") === CRAFTSMAN_CLASS_IDENTIFIER
  ));
  if (related.length === 0) {
    const hasRelatedAxisItem = items.some((item) => (
      Object.values(AXIS_CONFIG).some((config) => item?.type === config.legacyItemType)
      || (
        item?.type === "subclass"
        && (
          AXIS_CONFIG[moduleFlag(item, "craftsmanTrack")]
          || moduleFlag(item, "classIdentifier") === CRAFTSMAN_CLASS_IDENTIFIER
          || item?.system?.classIdentifier === CRAFTSMAN_CLASS_IDENTIFIER
        )
      )
      || AXES.some((axis) => isRelatedAxisFeature(item, axis))
    ));
    if (hasRelatedAxisItem) {
      throw preflightError(actor, "all", "axis Items exist without an embedded Craftsman class");
    }
    return null;
  }
  if (related.length > 1) throw preflightError(actor, "all", "duplicate embedded Craftsman class Items");
  const classItem = related[0];
  validateManagedSource(classItem, actor, "all", "embedded Craftsman class", "class");
  return classItem;
}

function validatePublishedClassSource(actor, documents) {
  const matching = documents.filter((document) => (
    moduleFlag(document, "classIdentifier") === CRAFTSMAN_CLASS_IDENTIFIER
  ));
  const source = uniqueIdentity(
    matching,
    actor,
    "all",
    "published class source",
    CRAFTSMAN_CLASS_IDENTIFIER
  );
  if (source?.type !== "class") throw preflightError(actor, "all", "published class source has the wrong Item type");
  validateManagedSource(source, actor, "all", "published class source", "class");
  validateSourceUuid(source, CLASS_PACK_ID, actor, "all", "published class source");
  return source;
}

function publishedAxisAdvancements(actor, classSource) {
  const advancements = sourceAdvancements(classSource);
  return Object.fromEntries(AXES.map((axis) => {
    const config = AXIS_CONFIG[axis];
    const matches = advancements.filter((advancement) => advancement?.type === config.classType);
    const advancement = uniqueIdentity(matches, actor, axis, "published class advancement", config.classType);
    if (!cleanString(advancement?._id)) {
      throw preflightError(actor, axis, `published ${config.classType} advancement has no _id`);
    }
    if (Number(advancement.level) !== config.level) {
      throw preflightError(actor, axis, `published ${config.classType} advancement must be level ${config.level}`);
    }
    if (!isPlainEmptyObject(advancement.configuration)) {
      throw preflightError(
        actor,
        axis,
        `published ${config.classType} advancement configuration must be a plain empty object`
      );
    }
    return [axis, clone(advancement)];
  }));
}

function actorAxisAdvancements(actor, classItem) {
  const advancements = sourceAdvancements(classItem);
  return Object.fromEntries(AXES.map((axis) => {
    const config = AXIS_CONFIG[axis];
    const types = new Set([config.legacyClassType, config.classType]);
    const matches = advancements
      .map((advancement, index) => ({ advancement, index }))
      .filter(({ advancement }) => types.has(advancement?.type));
    const match = uniqueIdentity(matches, actor, axis, "embedded class advancement", `${config.legacyClassType}/${config.classType}`);
    return [axis, match];
  }));
}

function actorLegacyAxes(actor, items) {
  return Object.fromEntries(AXES.map((axis) => {
    const config = AXIS_CONFIG[axis];
    const candidates = items.filter((item) => item?.type === config.legacyItemType);
    for (const item of candidates) {
      validateManagedSource(item, actor, axis, "legacy axis Item", axis);
      canonicalArchetype(actor, axis, moduleFlag(item, "archetypeId"), "legacy axis Item");
    }
    if (candidates.length > 1) throw preflightError(actor, axis, "duplicate legacy axis Items");
    return [axis, candidates[0] ?? null];
  }));
}

function actorNativeAxes(actor, items) {
  const grouped = Object.fromEntries(AXES.map((axis) => [axis, []]));
  for (const item of items) {
    if (item?.type !== "subclass") continue;
    const moduleClass = moduleFlag(item, "classIdentifier");
    const systemClass = item?.system?.classIdentifier;
    const axis = moduleFlag(item, "craftsmanTrack");
    const hasCraftsmanFlags = Boolean(
      AXIS_CONFIG[axis]
      || (moduleFlag(item, "sourceType") === "subclass" && cleanString(moduleFlag(item, "archetypeId")))
    );
    if (
      moduleClass !== CRAFTSMAN_CLASS_IDENTIFIER
      && systemClass !== CRAFTSMAN_CLASS_IDENTIFIER
      && !hasCraftsmanFlags
    ) continue;
    if (!AXIS_CONFIG[axis]) {
      throw preflightError(actor, cleanString(axis) || "unknown", "unmanaged or unknown tracked Craftsman subclass Item");
    }
    validateManagedSource(item, actor, axis, "native tracked subclass Item", "subclass");
    canonicalArchetype(actor, axis, moduleFlag(item, "archetypeId"), "native tracked subclass Item");
    grouped[axis].push(item);
  }
  for (const axis of AXES) {
    if (grouped[axis].length > 1) throw preflightError(actor, axis, "duplicate native tracked subclass Items");
  }
  return Object.fromEntries(AXES.map((axis) => [axis, grouped[axis][0] ?? null]));
}

function resolveSubclassSource(actor, axis, archetypeId, documents) {
  const expected = canonicalArchetype(actor, axis, archetypeId, "subclass source request");
  const candidates = documents.filter((document) => moduleFlag(document, "archetypeId") === archetypeId);
  const source = uniqueIdentity(candidates, actor, axis, "subclass source", archetypeId);
  if (source?.type !== "subclass") throw preflightError(actor, axis, `subclass source ${archetypeId} has the wrong Item type`);
  validateManagedSource(source, actor, axis, `subclass source ${archetypeId}`, "subclass");
  if (moduleFlag(source, "craftsmanTrack") !== axis) {
    throw preflightError(actor, axis, `subclass source ${archetypeId} has the wrong track`);
  }
  if (source?.system?.classIdentifier !== CRAFTSMAN_CLASS_IDENTIFIER) {
    throw preflightError(actor, axis, `subclass source ${archetypeId} has the wrong system classIdentifier`);
  }
  const sourceId = typeof (source?.id ?? source?._id) === "string"
    ? (source.id ?? source._id)
    : "";
  if (sourceId !== expected.documentId || source?.uuid !== expected.uuid) {
    throw preflightError(actor, axis, `subclass source ${archetypeId} has the wrong canonical document identity`);
  }
  return source;
}

function relatedFeatures(actor, items, axis, archetypeId) {
  const candidates = items.filter((item) => isRelatedAxisFeature(item, axis));
  const byFeatureId = new Map();
  for (const feature of candidates) {
    if (moduleFlag(feature, "managed") !== true) {
      throw preflightError(actor, axis, `unmanaged embedded feature ${itemId(feature)}`);
    }
    if (moduleFlag(feature, "classIdentifier") !== CRAFTSMAN_CLASS_IDENTIFIER) {
      throw preflightError(actor, axis, `embedded feature ${itemId(feature)} has the wrong classIdentifier`);
    }
    if (moduleFlag(feature, "sourceType") !== `${axis}Feature`) {
      throw preflightError(actor, axis, `embedded feature ${itemId(feature)} has the wrong sourceType`);
    }
    if (moduleFlag(feature, "axis") !== axis) {
      throw preflightError(actor, axis, `embedded feature ${itemId(feature)} has the wrong axis`);
    }
    if (moduleFlag(feature, "archetypeId") !== archetypeId) {
      throw preflightError(
        actor,
        axis,
        `embedded feature ${itemId(feature)} has archetypeId ${cleanString(moduleFlag(feature, "archetypeId")) || "<missing>"}; expected ${archetypeId}`
      );
    }
    const featureId = cleanString(moduleFlag(feature, "featureId"));
    if (!featureId) throw preflightError(actor, axis, `embedded feature ${itemId(feature)} has no featureId`);
    if (byFeatureId.has(featureId)) {
      throw preflightError(actor, axis, `ambiguous embedded feature identity ${featureId}`);
    }
    byFeatureId.set(featureId, feature);
  }
  return Array.from(byFeatureId.values());
}

function validateNoOrphanFeatures(actor, items, axis) {
  const orphans = items.filter((item) => isRelatedAxisFeature(item, axis));
  if (orphans.length) {
    throw preflightError(
      actor,
      axis,
      `orphan embedded feature ${cleanString(moduleFlag(orphans[0], "featureId")) || itemId(orphans[0]) || "<unknown>"}`
    );
  }
}

function resolveFeatureSource(actor, axis, feature, documents) {
  const featureId = cleanString(moduleFlag(feature, "featureId"));
  const candidates = documents.filter((document) => moduleFlag(document, "featureId") === featureId);
  const source = uniqueIdentity(candidates, actor, axis, "feature source", featureId);
  if (source?.type !== feature?.type) {
    throw preflightError(actor, axis, `feature source ${featureId} has the wrong Item type`);
  }
  validateManagedSource(source, actor, axis, `feature source ${featureId}`);
  if (moduleFlag(source, "axis") !== axis || moduleFlag(source, "archetypeId") !== moduleFlag(feature, "archetypeId")) {
    throw preflightError(actor, axis, `feature source ${featureId} has mismatched axis/archetype identity`);
  }
  const level = Number(moduleFlag(source, "requiredLevel"));
  if (!Number.isInteger(level) || level < 0) {
    throw preflightError(actor, axis, `feature source ${featureId} has invalid requiredLevel`);
  }
  if (Number(moduleFlag(feature, "requiredLevel")) !== level) {
    throw preflightError(actor, axis, `embedded feature ${featureId} has mismatched requiredLevel`);
  }
  return { source, level };
}

function configuredGrantForFeature(actor, axis, subclassSource, featureUuid, level, featureId) {
  const advancements = sourceAdvancements(subclassSource);
  const candidates = advancements.filter((advancement) => (
    advancement?.type === "ItemGrant"
    && Number(advancement.level) === level
    && Array.isArray(advancement.configuration?.items)
    && advancement.configuration.items.some((item) => item?.uuid === featureUuid)
  ));
  const grant = uniqueIdentity(candidates, actor, axis, "ItemGrant for feature", featureId);
  if (!cleanString(grant?._id)) throw preflightError(actor, axis, `ItemGrant for feature ${featureId} has no _id`);
  return grant;
}

function validateExistingNativeAdvancements(actor, axis, nativeItem, source) {
  const existing = sourceAdvancements(nativeItem);
  const published = sourceAdvancements(source);
  for (const sourceAdvancement of published.filter((advancement) => advancement?.type === "ItemGrant")) {
    const matches = existing.filter((advancement) => advancement?._id === sourceAdvancement._id);
    const advancement = uniqueIdentity(matches, actor, axis, "existing native ItemGrant", sourceAdvancement._id);
    if (
      advancement.type !== sourceAdvancement.type
      || Number(advancement.level) !== Number(sourceAdvancement.level)
      || !sameValue(advancement.configuration, sourceAdvancement.configuration)
    ) {
      throw preflightError(actor, axis, `existing native ItemGrant ${sourceAdvancement._id} differs from its managed source`);
    }
  }
}

function buildDesiredSubclassAdvancements(axisPlan) {
  const base = axisPlan.nativeItem
    ? sourceAdvancements(axisPlan.nativeItem)
    : sourceAdvancements(axisPlan.source);
  const maps = axisPlan.grantMaps;
  return base.map((advancement) => {
    if (advancement?.type !== "ItemGrant" || !maps.has(advancement._id)) return advancement;
    return {
      ...advancement,
      value: {
        ...(advancement.value ?? {}),
        added: clone(maps.get(advancement._id))
      }
    };
  });
}

function makeNativeItemSource(game, source, embeddedId, sourceUuid) {
  const compendiumData = game?.items?.fromCompendium?.(source);
  const stats = clone(compendiumData?._stats ?? toSource(source)._stats ?? {});
  let data;
  if (typeof source?.clone === "function") {
    data = source.clone({
      _stats: stats,
      _id: embeddedId,
      "flags.dnd5e.sourceId": sourceUuid,
      "system.classIdentifier": CRAFTSMAN_CLASS_IDENTIFIER
    }, { keepId: true }).toObject();
  }
  else {
    data = toSource(source);
    data._id = embeddedId;
    data._stats = stats;
    data.flags ??= {};
    data.flags.dnd5e ??= {};
    data.flags.dnd5e.sourceId = sourceUuid;
    data.system ??= {};
    data.system.classIdentifier = CRAFTSMAN_CLASS_IDENTIFIER;
  }
  data.flags ??= {};
  data.flags.dnd5e ??= {};
  data.flags.dnd5e.sourceId = sourceUuid;
  delete data.flags.dnd5e.advancementOrigin;
  delete data.flags.dnd5e.advancementRoot;
  data.system ??= {};
  data.system.classIdentifier = CRAFTSMAN_CLASS_IDENTIFIER;
  return data;
}

function exactRestoreUpdate(snapshot, current) {
  const update = { _id: snapshot._id };
  for (const key of Object.keys(current ?? {})) {
    if (!NON_RESTORABLE_TOP_LEVEL_FIELDS.has(key) && !hasOwn(snapshot, key)) update[`-=${key}`] = null;
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (!NON_RESTORABLE_TOP_LEVEL_FIELDS.has(key)) update[`==${key}`] = clone(value);
  }
  for (const field of RESTORABLE_STAT_FIELDS) {
    if (hasOwn(snapshot?._stats, field)) update[`_stats.${field}`] = clone(snapshot._stats[field]);
    else if (hasOwn(current?._stats, field)) update[`_stats.-=${field}`] = null;
  }
  return update;
}

export class CraftsmanSubclassMigrationService {
  constructor({
    fromUuid = (uuid) => globalThis.fromUuid?.(uuid),
    gameProvider = () => globalThis.game,
    randomId = () => globalThis.foundry?.utils?.randomID?.()
  } = {}) {
    this.fromUuid = fromUuid;
    this.gameProvider = gameProvider;
    this.randomId = randomId;
  }

  async migrateWorldActors() {
    const game = this.gameProvider();
    const result = { actorsMigrated: 0, actorsScanned: 0, actorsSkipped: 0 };
    if (!game?.user?.isGM || game?.system?.id !== "dnd5e" || !isActiveGmClient(game)) return result;

    const errors = [];
    for (const actor of getActors(game)) {
      result.actorsScanned += 1;
      try {
        const actorResult = await this.migrateActor(actor);
        if (actorResult.migrated) result.actorsMigrated += 1;
        else result.actorsSkipped += 1;
      }
      catch (error) {
        errors.push(error);
      }
    }

    if (errors.length) {
      throw new AggregateError(errors, `Craftsman subclass migration failed for ${errors.length} Actor(s).`);
    }
    await game.settings.set(
      MODULE_ID,
      SETTINGS_KEYS.CRAFTSMAN_SUBCLASS_MIGRATION_VERSION,
      CRAFTSMAN_SUBCLASS_MIGRATION_VERSION
    );
    return result;
  }

  async migrateActor(actor) {
    const game = this.gameProvider();
    if (!game?.user?.isGM || game?.system?.id !== "dnd5e" || !isActiveGmClient(game)) {
      return { migrated: false, skipped: true };
    }

    const plan = await this.#buildPlan(actor, game);
    if (!plan) return { migrated: false, skipped: true };
    if (!plan.requiresWrite) {
      await this.#verify(actor, plan, { legacyExpected: false });
      return { migrated: false, skipped: true };
    }

    const snapshots = this.#snapshot(actor, plan);
    const createdIds = new Set(plan.axes.filter((axisPlan) => axisPlan?.createSource).map((axisPlan) => axisPlan.nativeId));
    try {
      const createSources = plan.axes.filter((axisPlan) => axisPlan?.createSource).map((axisPlan) => axisPlan.createSource);
      if (createSources.length) {
        await actor.createEmbeddedDocuments("Item", createSources, { ...MIGRATION_OPTIONS, keepId: true });
      }

      if (plan.subclassUpdates.length) {
        await actor.updateEmbeddedDocuments("Item", plan.subclassUpdates, MIGRATION_OPTIONS);
      }
      if (plan.classUpdate) {
        await actor.updateEmbeddedDocuments("Item", [plan.classUpdate], MIGRATION_OPTIONS);
      }
      if (plan.featureUpdates.length) {
        await actor.updateEmbeddedDocuments("Item", plan.featureUpdates, MIGRATION_OPTIONS);
      }

      await this.#verify(actor, plan, { legacyExpected: true });

      if (plan.legacyIds.length) {
        await actor.deleteEmbeddedDocuments("Item", plan.legacyIds, MIGRATION_OPTIONS);
        for (const id of plan.legacyIds) {
          if (getItems(actor).some((item) => itemId(item) === id)) {
            throw new Error(`Craftsman subclass migration verification failed [Actor ${actorId(actor)}]: legacy Item ${id} survived deletion`);
          }
        }
      }

      if (plan.actorFlag !== CRAFTSMAN_SUBCLASS_MIGRATION_VERSION) {
        await actor.setFlag(MODULE_ID, ACTOR_FLAG, CRAFTSMAN_SUBCLASS_MIGRATION_VERSION);
      }
      return { migrated: true, skipped: false };
    }
    catch (error) {
      try {
        await this.#rollback(actor, snapshots, createdIds);
      }
      catch (rollbackFailure) {
        throw rollbackError(actor, error, rollbackFailure);
      }
      throw error;
    }
  }

  async #buildPlan(actor, game) {
    const items = getItems(actor);
    const classItem = validateActorClass(actor, items);
    if (!classItem) return null;

    const classPack = validatePack(game.packs?.get?.(CLASS_PACK_ID), CLASS_PACK_ID, actor, "all");
    const subclassPack = validatePack(game.packs?.get?.(SUBCLASS_PACK_ID), SUBCLASS_PACK_ID, actor, "all");
    const featurePack = validatePack(game.packs?.get?.(FEATURE_PACK_ID), FEATURE_PACK_ID, actor, "all");
    const [classDocuments, subclassDocuments, featureDocuments] = await Promise.all([
      packDocuments(classPack),
      packDocuments(subclassPack),
      packDocuments(featurePack)
    ]);
    const classSource = validatePublishedClassSource(actor, classDocuments);
    await this.#validateResolution(actor, "all", classSource, CLASS_PACK_ID, "published class source");
    const publishedAdvancements = publishedAxisAdvancements(actor, classSource);
    const embeddedAdvancements = actorAxisAdvancements(actor, classItem);
    const legacy = actorLegacyAxes(actor, items);
    const native = actorNativeAxes(actor, items);

    const axes = [];
    const reservedEmbeddedIds = new Set(items.map(itemId).filter(Boolean));
    for (const axis of AXES) {
      const legacyItem = legacy[axis];
      const nativeItem = native[axis];
      const legacyArchetypeId = cleanString(moduleFlag(legacyItem, "archetypeId"));
      const nativeArchetypeId = cleanString(moduleFlag(nativeItem, "archetypeId"));
      if (legacyItem && nativeItem && legacyArchetypeId !== nativeArchetypeId) {
        throw preflightError(actor, axis, `legacy/native archetype mismatch ${legacyArchetypeId}/${nativeArchetypeId}`);
      }
      const archetypeId = legacyArchetypeId || nativeArchetypeId;
      if (!archetypeId) {
        validateNoOrphanFeatures(actor, items, axis);
        axes.push({
          axis,
          archetypeId: "",
          classAdvancement: publishedAdvancements[axis],
          classIndex: embeddedAdvancements[axis].index,
          createSource: null,
          features: [],
          grantMaps: new Map(),
          legacyItem: null,
          nativeId: "",
          nativeItem: null,
          source: null,
          sourceUuid: ""
        });
        continue;
      }

      const source = resolveSubclassSource(actor, axis, archetypeId, subclassDocuments);
      const sourceUuid = validateSourceUuid(source, SUBCLASS_PACK_ID, actor, axis, `subclass source ${archetypeId}`);
      await this.#validateResolution(actor, axis, source, SUBCLASS_PACK_ID, `subclass source ${archetypeId}`);
      if (nativeItem) validateExistingNativeAdvancements(actor, axis, nativeItem, source);
      const nativeId = nativeItem ? itemId(nativeItem) : cleanString(this.randomId());
      if (!nativeId) throw preflightError(actor, axis, "failed to allocate a known embedded subclass ID");
      if (!nativeItem && reservedEmbeddedIds.has(nativeId)) {
        throw preflightError(actor, axis, `embedded subclass ID ${nativeId} collision`);
      }
      reservedEmbeddedIds.add(nativeId);

      const features = [];
      const grantMaps = new Map(
        sourceAdvancements(source)
          .filter((advancement) => advancement?.type === "ItemGrant")
          .map((advancement) => [advancement._id, {}])
      );
      for (const feature of relatedFeatures(actor, items, axis, archetypeId)) {
        const { source: featureSource, level } = resolveFeatureSource(actor, axis, feature, featureDocuments);
        const featureUuid = validateSourceUuid(featureSource, FEATURE_PACK_ID, actor, axis, `feature source ${moduleFlag(feature, "featureId")}`);
        await this.#validateResolution(actor, axis, featureSource, FEATURE_PACK_ID, `feature source ${moduleFlag(feature, "featureId")}`);
        const existingSourceId = cleanString(getFlag(feature, "dnd5e", "sourceId"));
        if (existingSourceId !== featureUuid) {
          throw preflightError(actor, axis, `feature ${moduleFlag(feature, "featureId")} sourceId is missing or stale`);
        }
        await this.#validateResolution(actor, axis, featureSource, FEATURE_PACK_ID, `embedded feature sourceId ${existingSourceId}`);
        const grant = configuredGrantForFeature(
          actor,
          axis,
          source,
          featureUuid,
          level,
          moduleFlag(feature, "featureId")
        );
        grantMaps.get(grant._id)[itemId(feature)] = featureUuid;
        features.push({
          document: feature,
          grantId: grant._id,
          origin: `${nativeId}.${grant._id}`,
          sourceUuid: featureUuid
        });
      }

      const axisPlan = {
        axis,
        archetypeId,
        classAdvancement: publishedAdvancements[axis],
        classIndex: embeddedAdvancements[axis].index,
        createSource: null,
        features,
        grantMaps,
        legacyItem,
        nativeId,
        nativeItem,
        source,
        sourceUuid
      };
      if (!nativeItem) axisPlan.createSource = makeNativeItemSource(game, source, nativeId, sourceUuid);
      axisPlan.desiredAdvancements = buildDesiredSubclassAdvancements(axisPlan);
      axes.push(axisPlan);
    }

    const currentClassAdvancements = sourceAdvancements(classItem);
    const desiredClassAdvancements = clone(currentClassAdvancements);
    for (const axisPlan of axes) {
      const replacement = clone(axisPlan.classAdvancement);
      replacement.value = axisPlan.source
        ? { document: axisPlan.nativeId, uuid: axisPlan.sourceUuid }
        : { document: null, uuid: null };
      desiredClassAdvancements[axisPlan.classIndex] = replacement;
    }
    const classUpdate = sameValue(currentClassAdvancements, desiredClassAdvancements)
      ? null
      : { _id: itemId(classItem), "system.advancement": desiredClassAdvancements };

    const subclassUpdates = axes.filter((axisPlan) => axisPlan.source).flatMap((axisPlan) => {
      const nativeFlags = axisPlan.nativeItem?.flags?.dnd5e ?? {};
      const needsUpdate = !axisPlan.nativeItem
        || !sameValue(sourceAdvancements(axisPlan.nativeItem), axisPlan.desiredAdvancements)
        || axisPlan.nativeItem.system.classIdentifier !== CRAFTSMAN_CLASS_IDENTIFIER
        || getFlag(axisPlan.nativeItem, "dnd5e", "sourceId") !== axisPlan.sourceUuid
        || hasOwn(nativeFlags, "advancementOrigin")
        || hasOwn(nativeFlags, "advancementRoot");
      if (!needsUpdate) return [];
      return [{
        _id: axisPlan.nativeId,
        "system.advancement": clone(axisPlan.desiredAdvancements),
        "system.classIdentifier": CRAFTSMAN_CLASS_IDENTIFIER,
        "flags.dnd5e.sourceId": axisPlan.sourceUuid,
        "flags.dnd5e.-=advancementOrigin": null,
        "flags.dnd5e.-=advancementRoot": null
      }];
    });

    const featureUpdates = axes.flatMap((axisPlan) => axisPlan.features.flatMap((feature) => {
      const document = feature.document;
      if (
        getFlag(document, "dnd5e", "advancementOrigin") === feature.origin
        && getFlag(document, "dnd5e", "advancementRoot") === feature.origin
      ) return [];
      return [{
        _id: itemId(document),
        "flags.dnd5e.advancementOrigin": feature.origin,
        "flags.dnd5e.advancementRoot": feature.origin
      }];
    }));
    const legacyIds = axes.map((axisPlan) => itemId(axisPlan.legacyItem)).filter(Boolean);
    const actorFlag = actor.getFlag?.(MODULE_ID, ACTOR_FLAG) ?? actor.flags?.[MODULE_ID]?.[ACTOR_FLAG];
    const requiresWrite = Boolean(
      axes.some((axisPlan) => axisPlan.createSource)
      || subclassUpdates.length
      || classUpdate
      || featureUpdates.length
      || legacyIds.length
      || actorFlag !== CRAFTSMAN_SUBCLASS_MIGRATION_VERSION
    );

    return {
      actorFlag,
      actorFlagPresent: hasOwn(actor.flags?.[MODULE_ID], ACTOR_FLAG),
      axes,
      classItem,
      classUpdate,
      desiredClassAdvancements,
      featureUpdates,
      legacyIds,
      requiresWrite,
      subclassUpdates
    };
  }

  async #validateResolution(actor, axis, source, packId, label) {
    const uuid = validateSourceUuid(source, packId, actor, axis, label);
    const resolved = await this.fromUuid(uuid);
    if (!resolved || itemId(resolved) !== itemId(source) || resolved.uuid !== uuid) {
      throw preflightError(actor, axis, `${label} UUID does not resolve exactly: ${uuid}`);
    }
  }

  #snapshot(actor, plan) {
    const sources = new Map();
    const participants = [
      plan.classItem,
      ...plan.axes.flatMap((axisPlan) => [
        axisPlan.nativeItem,
        axisPlan.legacyItem,
        ...axisPlan.features.map((feature) => feature.document)
      ])
    ].filter(Boolean);
    for (const item of participants) sources.set(itemId(item), toSource(item));
    return {
      actorFlag: clone(plan.actorFlag),
      actorFlagPresent: plan.actorFlagPresent,
      sources
    };
  }

  async #rollback(actor, snapshots, createdIds) {
    const restoreIds = Array.from(snapshots.sources.keys());
    const existing = new Set(getItems(actor).map(itemId));
    const updates = [];
    const missing = [];
    for (const id of restoreIds) {
      const snapshot = snapshots.sources.get(id);
      if (!snapshot) continue;
      if (existing.has(id)) {
        const current = getItems(actor).find((item) => itemId(item) === id);
        updates.push(exactRestoreUpdate(snapshot, toSource(current)));
      }
      else missing.push(snapshot);
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates, MIGRATION_OPTIONS);
    if (missing.length) {
      await actor.createEmbeddedDocuments("Item", missing.map(clone), { ...MIGRATION_OPTIONS, keepId: true });
    }

    const createdPresent = Array.from(createdIds).filter((id) => getItems(actor).some((item) => itemId(item) === id));
    if (createdPresent.length) await actor.deleteEmbeddedDocuments("Item", createdPresent, MIGRATION_OPTIONS);

    if (snapshots.actorFlagPresent) await actor.setFlag(MODULE_ID, ACTOR_FLAG, clone(snapshots.actorFlag));
    else await actor.unsetFlag(MODULE_ID, ACTOR_FLAG);

    for (const [id, snapshot] of snapshots.sources) {
      const current = getItems(actor).find((item) => itemId(item) === id);
      if (
        !current
        || !sameValue(comparablePersistedSource(toSource(current)), comparablePersistedSource(snapshot))
      ) {
        throw new Error(`rollback source mismatch for embedded Item ${id}`);
      }
    }
    for (const id of createdIds) {
      if (getItems(actor).some((item) => itemId(item) === id)) {
        throw new Error(`rollback retained run-created native Item ${id}`);
      }
    }
    const restoredFlag = actor.getFlag?.(MODULE_ID, ACTOR_FLAG) ?? actor.flags?.[MODULE_ID]?.[ACTOR_FLAG];
    if (snapshots.actorFlagPresent ? !sameValue(restoredFlag, snapshots.actorFlag) : restoredFlag !== undefined) {
      throw new Error("rollback actor migration flag mismatch");
    }
  }

  async #verify(actor, plan, { legacyExpected }) {
    const items = getItems(actor);
    const classItem = items.find((item) => itemId(item) === itemId(plan.classItem));
    if (!classItem || !sameValue(sourceAdvancements(classItem), plan.desiredClassAdvancements)) {
      throw new Error(`Craftsman subclass migration verification failed [Actor ${actorId(actor)}]: class advancement mismatch`);
    }

    for (const axisPlan of plan.axes) {
      if (!axisPlan.source) {
        const accidental = items.filter((item) => (
          item?.type === "subclass" && moduleFlag(item, "craftsmanTrack") === axisPlan.axis
        ));
        if (accidental.length) {
          throw new Error(`Craftsman subclass migration verification failed [Actor ${actorId(actor)}] [axis ${axisPlan.axis}]: unexpected subclass`);
        }
        continue;
      }
      const native = items.find((item) => itemId(item) === axisPlan.nativeId);
      if (!native || native.type !== "subclass") {
        throw new Error(`Craftsman subclass migration verification failed [Actor ${actorId(actor)}] [axis ${axisPlan.axis}]: missing native subclass`);
      }
      if (
        moduleFlag(native, "managed") !== true
        || moduleFlag(native, "classIdentifier") !== CRAFTSMAN_CLASS_IDENTIFIER
        || moduleFlag(native, "craftsmanTrack") !== axisPlan.axis
        || moduleFlag(native, "archetypeId") !== axisPlan.archetypeId
        || native.system.classIdentifier !== CRAFTSMAN_CLASS_IDENTIFIER
        || getFlag(native, "dnd5e", "sourceId") !== axisPlan.sourceUuid
        || hasOwn(native.flags?.dnd5e, "advancementOrigin")
        || hasOwn(native.flags?.dnd5e, "advancementRoot")
        || !sameValue(sourceAdvancements(native), axisPlan.desiredAdvancements)
      ) {
        throw new Error(`Craftsman subclass migration verification failed [Actor ${actorId(actor)}] [axis ${axisPlan.axis}]: native subclass identity/state mismatch`);
      }

      for (const featurePlan of axisPlan.features) {
        const feature = items.find((item) => itemId(item) === itemId(featurePlan.document));
        const nativeAdvancements = sourceAdvancements(native);
        const grant = nativeAdvancements.find((advancement) => advancement?._id === featurePlan.grantId);
        if (
          !feature
          || getFlag(feature, "dnd5e", "sourceId") !== featurePlan.sourceUuid
          || getFlag(feature, "dnd5e", "advancementOrigin") !== featurePlan.origin
          || getFlag(feature, "dnd5e", "advancementRoot") !== featurePlan.origin
          || grant?.type !== "ItemGrant"
          || grant.value?.added?.[itemId(feature)] !== featurePlan.sourceUuid
        ) {
          throw new Error(`Craftsman subclass migration verification failed [Actor ${actorId(actor)}] [axis ${axisPlan.axis}]: feature/grant link mismatch for ${itemId(featurePlan.document)}`);
        }
        const [rootId, grantId] = cleanString(getFlag(feature, "dnd5e", "advancementRoot")).split(".");
        if (rootId !== native.id || !nativeAdvancements.some((advancement) => advancement?._id === grantId)) {
          throw new Error(`Craftsman subclass migration verification failed [Actor ${actorId(actor)}] [axis ${axisPlan.axis}]: unresolved feature root`);
        }
      }
    }

    for (const legacyId of plan.legacyIds) {
      const present = items.some((item) => itemId(item) === legacyId);
      if (present !== legacyExpected) {
        throw new Error(`Craftsman subclass migration verification failed [Actor ${actorId(actor)}]: legacy Item ${legacyId} expectation mismatch`);
      }
    }
  }
}
