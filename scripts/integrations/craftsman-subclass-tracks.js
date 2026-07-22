import {
  CRAFTSMAN_ARCHETYPE_ID_FLAG,
  CRAFTSMAN_ARCHETYPE_REGISTRY,
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_TRACK_FLAG,
  CRAFTSMAN_TRACKS,
  MODULE_ID
} from "../constants.js";

const TRACKS = new Set(Object.values(CRAFTSMAN_TRACKS));

export class CraftsmanSubclassIdentityError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "CraftsmanSubclassIdentityError";
    this.reason = reason;
  }
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function exactString(value) {
  return typeof value === "string" ? value : "";
}

function getActorItems(actor) {
  const items = actor?.items;
  if (Array.isArray(items?.contents)) {
    return items.contents;
  }
  if (Array.isArray(items)) {
    return items;
  }
  if (items?.values instanceof Function) {
    return Array.from(items.values());
  }
  return [];
}

function getTrackFlag(item) {
  return item?.getFlag?.(MODULE_ID, CRAFTSMAN_TRACK_FLAG)
    ?? item?.flags?.[MODULE_ID]?.[CRAFTSMAN_TRACK_FLAG];
}

function getModuleFlag(item, key) {
  return item?.getFlag?.(MODULE_ID, key)
    ?? item?.flags?.[MODULE_ID]?.[key];
}

function getFlag(item, scope, key) {
  return item?.getFlag?.(scope, key)
    ?? item?.flags?.[scope]?.[key];
}

function identityError(reason, message) {
  throw new CraftsmanSubclassIdentityError(reason, message);
}

function sourceUuids(item) {
  const candidates = [
    getFlag(item, "dnd5e", "sourceId"),
    item?._stats?.compendiumSource
  ];
  return [...new Set(candidates.map(exactString).filter(Boolean))];
}

function itemId(item) {
  return cleanString(item?.id ?? item?._id);
}

export function isCraftsmanClass(item) {
  return item?.type === "class"
    && item?.system?.identifier === CRAFTSMAN_CLASS_IDENTIFIER;
}

export function isCraftsmanSubclassCandidate(item) {
  const moduleFlags = item?.flags?.[MODULE_ID] ?? {};
  if (Object.hasOwn(moduleFlags, CRAFTSMAN_TRACK_FLAG)) return true;
  if (
    moduleFlags.sourceType === "subclass"
    && moduleFlags.classIdentifier === CRAFTSMAN_CLASS_IDENTIFIER
  ) return true;
  if (
    item?.type === "subclass"
    && item?.system?.classIdentifier === CRAFTSMAN_CLASS_IDENTIFIER
  ) return true;
  return item?.type === "subclass" && (
    moduleFlags.classIdentifier === CRAFTSMAN_CLASS_IDENTIFIER
    || Object.hasOwn(moduleFlags, CRAFTSMAN_ARCHETYPE_ID_FLAG)
  );
}

export function getCraftsmanArchetypeDefinition(archetypeId) {
  return typeof archetypeId === "string" && Object.hasOwn(CRAFTSMAN_ARCHETYPE_REGISTRY, archetypeId)
    ? CRAFTSMAN_ARCHETYPE_REGISTRY[archetypeId]
    : null;
}

export function validateCraftsmanSubclassIdentity(item, expectedTrack = null) {
  if (item?.type !== "subclass") {
    identityError("type", "Expected a native Craftsman subclass Item.");
  }
  if (
    item?.system?.classIdentifier !== CRAFTSMAN_CLASS_IDENTIFIER
    || getModuleFlag(item, "classIdentifier") !== CRAFTSMAN_CLASS_IDENTIFIER
  ) {
    identityError("class", "Expected the exact Craftsman class identifier.");
  }

  const track = getTrackFlag(item);
  if (!TRACKS.has(track)) {
    identityError("track", `Unsupported Craftsman track ${cleanString(track) || "<missing>"}.`);
  }
  if (expectedTrack !== null && expectedTrack !== undefined && !TRACKS.has(expectedTrack)) {
    identityError("track", `Unsupported Craftsman track ${cleanString(expectedTrack)}.`);
  }

  const archetypeId = getModuleFlag(item, CRAFTSMAN_ARCHETYPE_ID_FLAG);
  const definition = getCraftsmanArchetypeDefinition(archetypeId);
  if (!definition) {
    identityError("source", `Unknown canonical Craftsman archetype ${cleanString(archetypeId) || "<missing>"}.`);
  }
  if (definition.track !== track || (expectedTrack && definition.track !== expectedTrack)) {
    identityError(
      "track",
      `Canonical Craftsman archetype ${archetypeId} belongs to ${definition.track}, not ${expectedTrack || track}.`
    );
  }
  if (
    getModuleFlag(item, "managed") !== true
    || getModuleFlag(item, "sourceType") !== "subclass"
  ) {
    identityError("source", `Craftsman archetype ${archetypeId} is not an exact managed subclass source.`);
  }

  const documentUuid = exactString(item?.uuid);
  const packId = cleanString(item?.pack?.collection ?? item?.pack);
  const isCompendiumDocument = documentUuid.startsWith("Compendium.") || Boolean(packId);
  if (isCompendiumDocument) {
    if (documentUuid !== definition.uuid || exactString(item?.id ?? item?._id) !== definition.documentId) {
      identityError(
        "source",
        `Craftsman archetype ${archetypeId} has a non-canonical compendium UUID or document ID.`
      );
    }
  }
  else {
    const observedUuids = sourceUuids(item);
    if (!observedUuids.length || observedUuids.some((uuid) => uuid !== definition.uuid)) {
      identityError(
        "source",
        `Craftsman archetype ${archetypeId} has missing or non-canonical embedded source provenance.`
      );
    }
  }

  return definition;
}

export function getCraftsmanSubclassTrack(item) {
  if (!isCraftsmanSubclassCandidate(item)) return null;
  return validateCraftsmanSubclassIdentity(item).track;
}

export function getCraftsmanSubclasses(classItemOrActor) {
  const actor = isCraftsmanClass(classItemOrActor)
    ? classItemOrActor.actor
    : classItemOrActor?.items
      ? classItemOrActor
      : null;
  const subclasses = {
    [CRAFTSMAN_TRACKS.RESEARCH]: null,
    [CRAFTSMAN_TRACKS.SPECIALTY]: null
  };

  for (const item of getActorItems(actor)) {
    if (!isCraftsmanSubclassCandidate(item)) continue;
    const definition = validateCraftsmanSubclassIdentity(item);
    const track = definition.track;
    if (subclasses[track]) {
      throw new Error(`Duplicate Craftsman ${track} subclass on Actor ${cleanString(actor?.id ?? actor?._id) || "unknown"}.`);
    }
    subclasses[track] = item;
  }

  return subclasses;
}

export function hasCraftsmanTrackDuplicate(actor, candidate, { excludeId = "" } = {}) {
  const track = validateCraftsmanSubclassIdentity(candidate).track;
  const ignoredId = cleanString(excludeId);
  if (!track) {
    return false;
  }

  return getActorItems(actor).some((item) => {
    if (itemId(item) === ignoredId || !isCraftsmanSubclassCandidate(item)) return false;
    return validateCraftsmanSubclassIdentity(item).track === track;
  });
}

export function assertValidCraftsmanSubclass(item, expectedTrack) {
  validateCraftsmanSubclassIdentity(item, expectedTrack);
  return item;
}
