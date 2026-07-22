import {
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_TRACK_FLAG,
  CRAFTSMAN_TRACKS,
  MODULE_ID
} from "../constants.js";

const TRACKS = new Set(Object.values(CRAFTSMAN_TRACKS));

function cleanString(value) {
  return String(value ?? "").trim();
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

function itemId(item) {
  return cleanString(item?.id ?? item?._id);
}

export function isCraftsmanClass(item) {
  return item?.type === "class"
    && item?.system?.identifier === CRAFTSMAN_CLASS_IDENTIFIER;
}

export function getCraftsmanSubclassTrack(item) {
  if (
    item?.type !== "subclass"
    || item?.system?.classIdentifier !== CRAFTSMAN_CLASS_IDENTIFIER
  ) {
    return null;
  }

  const track = getTrackFlag(item);
  return TRACKS.has(track) ? track : null;
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
    const track = getCraftsmanSubclassTrack(item);
    if (!track) {
      continue;
    }
    if (subclasses[track]) {
      throw new Error(`Duplicate Craftsman ${track} subclass on Actor ${cleanString(actor?.id ?? actor?._id, "unknown")}.`);
    }
    subclasses[track] = item;
  }

  return subclasses;
}

export function hasCraftsmanTrackDuplicate(actor, candidate, { excludeId = "" } = {}) {
  const track = getCraftsmanSubclassTrack(candidate);
  const ignoredId = cleanString(excludeId);
  if (!track) {
    return false;
  }

  return getActorItems(actor).some((item) => (
    itemId(item) !== ignoredId
    && getCraftsmanSubclassTrack(item) === track
  ));
}

export function assertValidCraftsmanSubclass(item, expectedTrack) {
  const track = getCraftsmanSubclassTrack(item);
  if (!track) {
    throw new Error("Expected a native Craftsman subclass with a valid class identifier and track.");
  }
  if (expectedTrack !== undefined && expectedTrack !== null && !TRACKS.has(expectedTrack)) {
    throw new Error(`Unsupported Craftsman track ${cleanString(expectedTrack)}.`);
  }
  if (expectedTrack && track !== expectedTrack) {
    throw new Error(`Expected Craftsman ${expectedTrack} subclass, received ${track}.`);
  }
  return item;
}
