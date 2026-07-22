import {
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_TRACK_FLAG,
  CRAFTSMAN_TRACKS,
  MODULE_ID
} from "../constants.js";
import {
  getCraftsmanSubclasses as getCommittedCraftsmanSubclasses,
  isCraftsmanClass
} from "./craftsman-subclass-tracks.js";

const ITEM_LINK_TARGET = "CONFIG.Item.documentClass.prototype.subclass";
const LEVEL_CHANGE_TARGET = "game.dnd5e.applications.advancement.AdvancementManager.prototype.createLevelChangeSteps";
const VALID_TRACKS = new Set(Object.values(CRAFTSMAN_TRACKS));

let itemLinkRegistration = null;
let advancementManagerRegistration = null;

function cleanString(value, fallback = "unknown") {
  return String(value ?? "").trim() || fallback;
}

function getActorItems(actor) {
  const items = actor?.items;
  if (Array.isArray(items?.contents)) return items.contents;
  if (Array.isArray(items)) return items;
  if (items?.values instanceof Function) return Array.from(items.values());
  return [];
}

function getRawTrack(item) {
  return item?.getFlag?.(MODULE_ID, CRAFTSMAN_TRACK_FLAG)
    ?? item?.flags?.[MODULE_ID]?.[CRAFTSMAN_TRACK_FLAG];
}

function getCraftsmanContext(classItemOrActor) {
  if (isCraftsmanClass(classItemOrActor)) {
    return {
      actor: classItemOrActor.actor ?? classItemOrActor.parent ?? null,
      classItem: classItemOrActor
    };
  }

  const actor = classItemOrActor?.items ? classItemOrActor : null;
  const classItem = getActorItems(actor).find((item) => isCraftsmanClass(item)) ?? null;
  return { actor, classItem };
}

/**
 * Resolve both native Craftsman subclass axes with diagnostics suitable for lifecycle patches.
 * The committed track helper performs the final resolution; this guard adds the strict unknown-
 * track and document-identity diagnostics required at shared system seams.
 */
export function getCraftsmanSubclasses(classItemOrActor) {
  const { actor, classItem } = getCraftsmanContext(classItemOrActor);
  const actorId = cleanString(actor?.id ?? actor?._id);
  const classId = cleanString(classItem?.id ?? classItem?._id);
  const seenTracks = new Set();

  for (const item of getActorItems(actor)) {
    if (item?.type !== "subclass" || item?.system?.classIdentifier !== CRAFTSMAN_CLASS_IDENTIFIER) {
      continue;
    }

    const track = getRawTrack(item);
    const diagnosticTrack = cleanString(track, "missing");
    if (!VALID_TRACKS.has(track)) {
      throw new Error(
        `Unknown Craftsman subclass track ${diagnosticTrack} on Actor ${actorId}, class ${classId}.`
      );
    }
    if (seenTracks.has(track)) {
      throw new Error(
        `Duplicate Craftsman ${track} subclass on Actor ${actorId}, class ${classId}.`
      );
    }
    seenTracks.add(track);
  }

  return getCommittedCraftsmanSubclasses(actor ?? classItemOrActor);
}

function getLibWrapperContract() {
  const active = globalThis.game?.modules?.get?.("lib-wrapper")?.active === true;
  if (!active) return { active: false, api: null };
  const api = globalThis.libWrapper;
  return {
    active: true,
    api: api?.register instanceof Function && api?.unregister instanceof Function ? api : null
  };
}

function descriptorsMatch(left, right) {
  return Boolean(left && right)
    && left.configurable === right.configurable
    && left.enumerable === right.enumerable
    && left.get === right.get
    && left.set === right.set;
}

function getItemSubclassContract() {
  const prototype = globalThis.CONFIG?.Item?.documentClass?.prototype;
  const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "subclass");
  if (!prototype || !(descriptor?.get instanceof Function)) return null;
  return { descriptor, prototype };
}

function getAdvancementManagerContract() {
  const documentClass = globalThis.game?.dnd5e?.applications?.advancement?.AdvancementManager;
  const prototype = documentClass?.prototype;
  const method = prototype?.createLevelChangeSteps;
  if (!prototype || !(method instanceof Function)) return null;
  return { method, prototype };
}

export function registerCraftsmanSubclassItemLinks() {
  if (itemLinkRegistration) return true;
  const contract = getItemSubclassContract();
  if (!contract) return false;

  const libWrapperContract = getLibWrapperContract();
  if (libWrapperContract.active) {
    if (!libWrapperContract.api) return false;
    const wrapper = function(wrapped, ...args) {
      if (!isCraftsmanClass(this)) return wrapped(...args);
      return getCraftsmanSubclasses(this).research;
    };
    const id = libWrapperContract.api.register(MODULE_ID, ITEM_LINK_TARGET, wrapper, "WRAPPER");
    itemLinkRegistration = { api: libWrapperContract.api, id, kind: "libWrapper" };
    return true;
  }

  const wrapper = function() {
    if (!isCraftsmanClass(this)) return contract.descriptor.get.call(this);
    return getCraftsmanSubclasses(this).research;
  };
  const ownedDescriptor = { ...contract.descriptor, get: wrapper };
  Object.defineProperty(contract.prototype, "subclass", ownedDescriptor);
  itemLinkRegistration = {
    kind: "direct",
    originalDescriptor: contract.descriptor,
    ownedDescriptor,
    prototype: contract.prototype
  };
  return true;
}

export function unregisterCraftsmanSubclassItemLinks() {
  const registration = itemLinkRegistration;
  itemLinkRegistration = null;
  if (!registration) return;

  if (registration.kind === "libWrapper") {
    registration.api.unregister(MODULE_ID, registration.id);
    return;
  }

  const current = Object.getOwnPropertyDescriptor(registration.prototype, "subclass");
  if (descriptorsMatch(current, registration.ownedDescriptor)) {
    Object.defineProperty(registration.prototype, "subclass", registration.originalDescriptor);
  }
}

/**
 * Reproduce the installed dnd5e AdvancementManager level-change algorithm while extending only
 * its singleton subclass groups to the two validated Craftsman axes.
 */
export function createCraftsmanLevelChangeSteps(manager, classItem, levelDelta) {
  const ItemClass = globalThis.Item;
  const race = manager.clone.system?.details?.race;
  const raceItem = ItemClass instanceof Function && race instanceof ItemClass ? race : null;
  const { research, specialty } = getCraftsmanSubclasses(classItem);
  const subclasses = [research, specialty].filter(Boolean);
  const pushSteps = (flows, data) => manager.steps.push(...flows.map((flow) => ({ flow, ...data })));
  const getItemFlows = (characterLevel, classLevel) => manager.clone.items.contents.flatMap((item) => {
    if (["class", "subclass", "race"].includes(item.type)) return [];
    if (["class", "subclass"].includes(item.system.advancementRootItem?.type) && item.system.advancementClassLinked) {
      const rootClass = item.system.advancementRootItem.class ?? item.system.advancementRootItem;
      if (rootClass !== classItem) return [];
      return manager.constructor.flowsForLevel(item, classLevel);
    }
    return manager.constructor.flowsForLevel(item, characterLevel);
  });

  for (let offset = 1; offset <= levelDelta; offset += 1) {
    const classLevel = classItem.system.levels + offset;
    const characterLevel = (manager.actor.system.details.level ?? 0) + offset;
    const stepData = {
      type: "forward",
      class: { item: classItem, level: classLevel },
      level: characterLevel
    };
    pushSteps(manager.constructor.flowsForLevel(raceItem, characterLevel), stepData);
    pushSteps(manager.constructor.flowsForLevel(classItem, classLevel), stepData);
    for (const subclass of subclasses) {
      pushSteps(manager.constructor.flowsForLevel(subclass, classLevel), stepData);
    }
    pushSteps(getItemFlows(characterLevel, classLevel), stepData);
  }

  for (let offset = 0; offset > levelDelta; offset -= 1) {
    const classLevel = classItem.system.levels + offset;
    const characterLevel = (manager.actor.system.details.level ?? 0) + offset;
    const stepData = {
      type: "reverse",
      class: { item: classItem, level: classLevel },
      automatic: true,
      level: characterLevel
    };
    pushSteps(getItemFlows(characterLevel, classLevel).reverse(), stepData);
    for (const subclass of [...subclasses].reverse()) {
      pushSteps(manager.constructor.flowsForLevel(subclass, classLevel).reverse(), stepData);
    }
    pushSteps(manager.constructor.flowsForLevel(classItem, classLevel).reverse(), stepData);
    pushSteps(manager.constructor.flowsForLevel(raceItem, characterLevel).reverse(), stepData);
    if (classLevel === 1) manager.steps.push({ type: "delete", item: classItem, automatic: true });
  }

  manager.steps.push({
    type: "forward",
    automatic: true,
    class: { item: classItem, level: classItem.system.levels += levelDelta },
    level: (manager.actor.system.details.level ?? 0) + levelDelta
  });
  return manager;
}

export function registerCraftsmanAdvancementManagerPatch() {
  if (advancementManagerRegistration) return true;
  const contract = getAdvancementManagerContract();
  if (!contract) return false;

  const libWrapperContract = getLibWrapperContract();
  if (libWrapperContract.active) {
    if (!libWrapperContract.api) return false;
    const wrapper = function(wrapped, classItem, levelDelta, ...args) {
      if (!isCraftsmanClass(classItem)) return wrapped(classItem, levelDelta, ...args);
      return createCraftsmanLevelChangeSteps(this, classItem, levelDelta);
    };
    const id = libWrapperContract.api.register(MODULE_ID, LEVEL_CHANGE_TARGET, wrapper, "WRAPPER");
    advancementManagerRegistration = { api: libWrapperContract.api, id, kind: "libWrapper" };
    return true;
  }

  const wrapper = function(classItem, levelDelta, ...args) {
    if (!isCraftsmanClass(classItem)) {
      return contract.method.call(this, classItem, levelDelta, ...args);
    }
    return createCraftsmanLevelChangeSteps(this, classItem, levelDelta);
  };
  contract.prototype.createLevelChangeSteps = wrapper;
  advancementManagerRegistration = {
    kind: "direct",
    originalMethod: contract.method,
    ownedMethod: wrapper,
    prototype: contract.prototype
  };
  return true;
}

export function unregisterCraftsmanAdvancementManagerPatch() {
  const registration = advancementManagerRegistration;
  advancementManagerRegistration = null;
  if (!registration) return;

  if (registration.kind === "libWrapper") {
    registration.api.unregister(MODULE_ID, registration.id);
    return;
  }

  if (registration.prototype.createLevelChangeSteps === registration.ownedMethod) {
    registration.prototype.createLevelChangeSteps = registration.originalMethod;
  }
}

export function registerCraftsmanMultiSubclassIntegration() {
  const itemLinksWereRegistered = Boolean(itemLinkRegistration);
  if (!registerCraftsmanSubclassItemLinks()) return false;
  try {
    if (registerCraftsmanAdvancementManagerPatch()) return true;
    if (!itemLinksWereRegistered) unregisterCraftsmanSubclassItemLinks();
    return false;
  }
  catch (error) {
    if (!itemLinksWereRegistered) unregisterCraftsmanSubclassItemLinks();
    throw error;
  }
}

export function unregisterCraftsmanMultiSubclassIntegration() {
  unregisterCraftsmanAdvancementManagerPatch();
  unregisterCraftsmanSubclassItemLinks();
}
