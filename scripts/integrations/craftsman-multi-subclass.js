import {
  CRAFTSMAN_ARCHETYPE_ID_FLAG,
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
const SHEET_DROP_TARGET = "game.dnd5e.applications.actor.CharacterActorSheet.prototype._onDropSingleItem";
const PRE_CREATE_HOOK = "preCreateItem";
const VALID_TRACKS = new Set(Object.values(CRAFTSMAN_TRACKS));
const INVALID_TYPE_KEY = "REBREYA_MAIN.CraftsmanSubclass.InvalidType";
const INVALID_CLASS_KEY = "REBREYA_MAIN.CraftsmanSubclass.InvalidClass";
const INVALID_TRACK_KEY = "REBREYA_MAIN.CraftsmanSubclass.InvalidTrack";
const INVALID_SOURCE_KEY = "REBREYA_MAIN.CraftsmanSubclass.InvalidSource";
const DUPLICATE_KEY = "REBREYA_MAIN.CraftsmanSubclass.Duplicate";

let itemLinkRegistration = null;
let advancementManagerRegistration = null;
let sheetDropRegistration = null;
let preCreateHookRegistration = null;

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

function getModuleFlag(item, key) {
  return item?.getFlag?.(MODULE_ID, key)
    ?? item?.flags?.[MODULE_ID]?.[key];
}

function getItemId(item) {
  return cleanString(item?.id ?? item?._id, "");
}

function getCandidate(document, data) {
  const source = data && typeof data === "object" ? data : {};
  return {
    id: source.id ?? source._id ?? document?.id ?? document?._id,
    type: source.type ?? document?.type,
    system: source.system ?? document?.system ?? {},
    flags: source.flags ?? document?.flags ?? {}
  };
}

function isCraftsmanCandidate(candidate) {
  const moduleFlags = candidate?.flags?.[MODULE_ID] ?? {};
  return candidate?.system?.classIdentifier === CRAFTSMAN_CLASS_IDENTIFIER
    || moduleFlags.classIdentifier === CRAFTSMAN_CLASS_IDENTIFIER
    || Object.hasOwn(moduleFlags, CRAFTSMAN_TRACK_FLAG);
}

function findDuplicateIdentifier(actor, candidate) {
  const identifier = cleanString(candidate?.system?.identifier, "");
  if (!identifier) return null;
  return getActorItems(actor).find((item) => (
    item?.type === "subclass"
    && cleanString(item?.system?.identifier ?? item?.identifier, "") === identifier
  )) ?? null;
}

function hasDuplicateTrack(actor, candidate) {
  const track = getRawTrack(candidate);
  const candidateId = getItemId(candidate);
  return getActorItems(actor).some((item) => (
    getItemId(item) !== candidateId
    && item?.type === "subclass"
    && item?.system?.classIdentifier === CRAFTSMAN_CLASS_IDENTIFIER
    && getRawTrack(item) === track
  ));
}

function notifyError(key, options) {
  if (options === undefined) globalThis.ui?.notifications?.error?.(key);
  else globalThis.ui?.notifications?.error?.(key, options);
}

function validateCraftsmanCandidate(candidate, actor, { allowDuplicate = false, notify = false } = {}) {
  if (!isCraftsmanCandidate(candidate)) return { associated: false, valid: true };

  let errorKey = null;
  if (candidate?.type !== "subclass") errorKey = INVALID_TYPE_KEY;
  else if (candidate?.system?.classIdentifier !== CRAFTSMAN_CLASS_IDENTIFIER) errorKey = INVALID_CLASS_KEY;
  else if (!VALID_TRACKS.has(getRawTrack(candidate))) errorKey = INVALID_TRACK_KEY;
  else if (
    getModuleFlag(candidate, "managed") !== true
    || !cleanString(getModuleFlag(candidate, CRAFTSMAN_ARCHETYPE_ID_FLAG), "")
  ) errorKey = INVALID_SOURCE_KEY;
  else if (!allowDuplicate && hasDuplicateTrack(actor, candidate)) errorKey = DUPLICATE_KEY;

  if (errorKey && notify) notifyError(errorKey, { localize: true });
  return { associated: true, errorKey, valid: !errorKey };
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

function getCharacterActorSheetContract() {
  const documentClass = globalThis.game?.dnd5e?.applications?.actor?.CharacterActorSheet;
  const prototype = documentClass?.prototype;
  const method = prototype?._onDropSingleItem;
  const genericPrototype = prototype && Object.getPrototypeOf(prototype);
  const genericMethod = genericPrototype?._onDropSingleItem;
  if (
    !prototype
    || !(method instanceof Function)
    || !genericPrototype
    || !(genericMethod instanceof Function)
    || genericMethod === method
  ) return null;
  return { genericMethod, method, prototype };
}

function getHooksContract() {
  const hooks = globalThis.Hooks;
  if (!(hooks?.on instanceof Function) || !(hooks?.off instanceof Function)) return null;
  return hooks;
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
    const id = libWrapperContract.api.register(MODULE_ID, ITEM_LINK_TARGET, wrapper, "MIXED");
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
    const id = libWrapperContract.api.register(MODULE_ID, LEVEL_CHANGE_TARGET, wrapper, "MIXED");
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

async function handleCraftsmanSheetDrop(sheet, delegate, genericMethod, event, itemData, args) {
  const actor = sheet?.inventorySource ?? sheet?.actor ?? null;
  const candidate = getCandidate(null, itemData);
  if (actor?.type !== "character" || !isCraftsmanCandidate(candidate)) {
    return delegate(event, itemData, ...args);
  }

  const duplicateIdentifier = findDuplicateIdentifier(actor, candidate);
  if (candidate.type === "subclass" && duplicateIdentifier) {
    const error = globalThis.game?.i18n?.format?.("DND5E.SubclassDuplicateError", {
      identifier: duplicateIdentifier.system?.identifier ?? duplicateIdentifier.identifier
    }) ?? "DND5E.SubclassDuplicateError";
    notifyError(error);
    return undefined;
  }

  const validation = validateCraftsmanCandidate(candidate, actor, { notify: true });
  if (!validation.valid) return false;
  return genericMethod.call(sheet, event, itemData, ...args);
}

export function registerCraftsmanCharacterSheetDropPatch() {
  if (sheetDropRegistration) return true;
  const contract = getCharacterActorSheetContract();
  if (!contract) return false;

  const libWrapperContract = getLibWrapperContract();
  if (libWrapperContract.active) {
    if (!libWrapperContract.api) return false;
    const wrapper = function(wrapped, event, itemData, ...args) {
      return handleCraftsmanSheetDrop(
        this,
        (delegatedEvent, delegatedData, ...delegatedArgs) => wrapped(
          delegatedEvent,
          delegatedData,
          ...delegatedArgs
        ),
        contract.genericMethod,
        event,
        itemData,
        args
      );
    };
    const id = libWrapperContract.api.register(MODULE_ID, SHEET_DROP_TARGET, wrapper, "MIXED");
    sheetDropRegistration = { api: libWrapperContract.api, id, kind: "libWrapper" };
    return true;
  }

  const wrapper = function(event, itemData, ...args) {
    return handleCraftsmanSheetDrop(
      this,
      (delegatedEvent, delegatedData, ...delegatedArgs) => contract.method.call(
        this,
        delegatedEvent,
        delegatedData,
        ...delegatedArgs
      ),
      contract.genericMethod,
      event,
      itemData,
      args
    );
  };
  contract.prototype._onDropSingleItem = wrapper;
  sheetDropRegistration = {
    kind: "direct",
    originalMethod: contract.method,
    ownedMethod: wrapper,
    prototype: contract.prototype
  };
  return true;
}

export function unregisterCraftsmanCharacterSheetDropPatch() {
  const registration = sheetDropRegistration;
  sheetDropRegistration = null;
  if (!registration) return;

  if (registration.kind === "libWrapper") {
    registration.api.unregister(MODULE_ID, registration.id);
    return;
  }

  if (registration.prototype._onDropSingleItem === registration.ownedMethod) {
    registration.prototype._onDropSingleItem = registration.originalMethod;
  }
}

function validateCraftsmanPreCreate(document, data, options) {
  const actor = document?.parent ?? document?.actor ?? null;
  if (actor?.type !== "character" || !document?.parent) return undefined;
  const candidate = getCandidate(document, data);
  if (!isCraftsmanCandidate(candidate)) return undefined;
  const validation = validateCraftsmanCandidate(candidate, actor, {
    allowDuplicate: options?.rebreyaCraftsmanSubclassMigration === true,
    notify: true
  });
  return validation.valid ? undefined : false;
}

export function registerCraftsmanSubclassCreateHook() {
  if (preCreateHookRegistration) return true;
  const hooks = getHooksContract();
  if (!hooks) return false;
  const callback = (document, data, options, userId) => (
    validateCraftsmanPreCreate(document, data, options, userId)
  );
  const id = hooks.on(PRE_CREATE_HOOK, callback);
  preCreateHookRegistration = { callback, hooks, id };
  return true;
}

export function unregisterCraftsmanSubclassCreateHook() {
  const registration = preCreateHookRegistration;
  preCreateHookRegistration = null;
  if (!registration) return;
  registration.hooks.off(PRE_CREATE_HOOK, registration.id);
}

export function openCraftsmanSubclassChoice(actor, classId, track) {
  if (!VALID_TRACKS.has(track)) return null;
  const classItem = actor?.items?.get?.(classId)
    ?? getActorItems(actor).find((item) => getItemId(item) === cleanString(classId, ""));
  if (!isCraftsmanClass(classItem)) return null;
  const AdvancementManager = globalThis.game?.dnd5e?.applications?.advancement?.AdvancementManager;
  if (!(AdvancementManager?.forModifyChoices instanceof Function)) return null;
  const level = track === CRAFTSMAN_TRACKS.RESEARCH ? 2 : 3;
  const manager = AdvancementManager.forModifyChoices(actor, classId, level);
  if (manager?.steps?.length) manager.render({ force: true });
  return manager;
}

export function registerCraftsmanMultiSubclassIntegration() {
  const prior = {
    advancementManager: Boolean(advancementManagerRegistration),
    itemLinks: Boolean(itemLinkRegistration),
    preCreateHook: Boolean(preCreateHookRegistration),
    sheetDrop: Boolean(sheetDropRegistration)
  };
  const rollbackNewRegistrations = () => {
    if (!prior.preCreateHook) unregisterCraftsmanSubclassCreateHook();
    if (!prior.sheetDrop) unregisterCraftsmanCharacterSheetDropPatch();
    if (!prior.advancementManager) unregisterCraftsmanAdvancementManagerPatch();
    if (!prior.itemLinks) unregisterCraftsmanSubclassItemLinks();
  };

  try {
    if (!registerCraftsmanSubclassItemLinks()) return false;
    if (!registerCraftsmanAdvancementManagerPatch()) {
      rollbackNewRegistrations();
      return false;
    }
    if (!registerCraftsmanCharacterSheetDropPatch()) {
      rollbackNewRegistrations();
      return false;
    }
    if (!registerCraftsmanSubclassCreateHook()) {
      rollbackNewRegistrations();
      return false;
    }
    return true;
  }
  catch (error) {
    rollbackNewRegistrations();
    throw error;
  }
}

export function unregisterCraftsmanMultiSubclassIntegration() {
  unregisterCraftsmanSubclassCreateHook();
  unregisterCraftsmanCharacterSheetDropPatch();
  unregisterCraftsmanAdvancementManagerPatch();
  unregisterCraftsmanSubclassItemLinks();
}
