import { MODULE_ID } from "../constants.js";
import { isDurabilityEligible } from "../data/durability-rules.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { isNaturalWeapon } from "./held-items.js?v=1.4.96-npc-held-natural";

const EFFECT_SUPPRESSION_PATCH = Symbol.for(`${MODULE_ID}.durabilityEffectSuppression`);
const REGISTERED_HOOK_TARGETS = new WeakSet();
const MAX_WORKFLOW_WARNING_KEYS = 256;
const ITEM_PILES_MODULE_ID = "item-piles";
const ITEM_PILES_PRE_CREATE_HOOK = "item-piles-preCreateItemPile";
const ITEM_PILES_CREATE_HOOK = "item-piles-createItemPile";
const PILE_PROJECTION_OPTION = "durabilityPileProjection";
const CLEANED_EMPTY_PILES = new WeakSet();
const EMPTY_PILE_CLEANUP_TASKS = new WeakMap();
const PILE_SYNC_TASKS = new WeakMap();

function cleanText(value) {
  return String(value ?? "").trim();
}

function itemDataOf(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  if (typeof item.toObject === "function") {
    try {
      return item.toObject();
    }
    catch (_error) {
      // Frozen or synthetic documents still expose the fields used below.
    }
  }
  return item;
}

function durabilityOf(item) {
  try {
    const flag = item?.getFlag?.(MODULE_ID, "durability");
    if (flag && typeof flag === "object") {
      return flag;
    }
  }
  catch (_error) {
    // Fall through to plain source data.
  }
  return item?.flags?.[MODULE_ID]?.durability
    ?? item?._source?.flags?.[MODULE_ID]?.durability
    ?? null;
}

function resolveHookItem(context) {
  return context?.workflow?.item
    ?? context?.activity?.item
    ?? context?.item
    ?? null;
}

function resolveWorkflowWarningKey(context, item) {
  const workflowId = cleanText(context?.workflow?.id ?? context?.config?.workflow?.id);
  const activityId = cleanText(context?.activity?.uuid ?? context?.activity?.id);
  const itemId = cleanText(item?.uuid ?? item?.id);
  const executionId = workflowId || activityId;
  return executionId && itemId ? `${executionId}:${itemId}` : "";
}

function findPropertyDescriptor(prototype, property) {
  for (let current = prototype; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor) {
      return descriptor;
    }
  }
  return null;
}

export function patchDurabilityItemEffectSuppression({ CONFIG: FoundryConfig = globalThis.CONFIG } = {}) {
  const prototype = FoundryConfig?.Item?.documentClass?.prototype;
  if (!prototype || prototype[EFFECT_SUPPRESSION_PATCH] === true) {
    return false;
  }

  const descriptor = findPropertyDescriptor(prototype, "areEffectsSuppressed");
  const originalGetter = descriptor?.get;
  if (typeof originalGetter !== "function") {
    return false;
  }

  Object.defineProperty(prototype, "areEffectsSuppressed", {
    configurable: true,
    get() {
      return isBrokenDurabilityItem(this) || originalGetter.call(this);
    }
  });
  Object.defineProperty(prototype, EFFECT_SUPPRESSION_PATCH, {
    configurable: true,
    value: true
  });
  return true;
}

function isBodyArmor(item) {
  if (item?.type !== "equipment") {
    return false;
  }
  const type = cleanText(item?.system?.type?.value).toLowerCase();
  return Boolean(type) && type !== "shield";
}

function forceBrokenArmorUnequipped(item, update) {
  if (!isBrokenDurabilityItem(item) || !isBodyArmor(item) || !update || typeof update !== "object") {
    return;
  }

  if (update["system.equipped"] === true) {
    update["system.equipped"] = false;
  }
  if (update.system?.equipped === true) {
    update.system.equipped = false;
  }
}

export function isBrokenDurabilityItem(item) {
  if (!item || typeof item !== "object" || isNaturalWeapon(item) || !isDurabilityEligible(item)) {
    return false;
  }

  const durability = durabilityOf(item);
  return durability?.eligible !== false && ["broken", "destroyed"].includes(cleanText(durability?.state));
}

export function canUseDurabilityItem(item) {
  if (!isBrokenDurabilityItem(item)) {
    return { allowed: true, reason: "" };
  }

  const name = cleanText(item?.name) || "Предмет";
  return {
    allowed: false,
    reason: `Предмет «${name}» сломан и не может использоваться.`
  };
}

export function filterBrokenItemEffects(effects, item) {
  return isBrokenDurabilityItem(item) ? [] : Array.from(effects ?? []);
}

function collectionValues(collection) {
  if (Array.isArray(collection)) {
    return collection;
  }
  if (Array.isArray(collection?.contents)) {
    return collection.contents;
  }
  if (typeof collection?.values === "function") {
    return Array.from(collection.values());
  }
  try {
    return collection ? Array.from(collection) : [];
  }
  catch (_error) {
    return [];
  }
}

function getPropertyValue(object, path) {
  if (!object || typeof object !== "object") {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(object, path)) {
    return object[path];
  }
  if (globalThis.foundry?.utils?.getProperty) {
    return globalThis.foundry.utils.getProperty(object, path);
  }
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setPropertyValue(object, path, value) {
  if (globalThis.foundry?.utils?.setProperty) {
    globalThis.foundry.utils.setProperty(object, path, value);
    return;
  }
  const parts = path.split(".");
  const last = parts.pop();
  let target = object;
  for (const part of parts) {
    if (!target[part] || typeof target[part] !== "object") {
      target[part] = {};
    }
    target = target[part];
  }
  target[last] = value;
}

function setChangedProperty(changed, path, value) {
  if (Object.prototype.hasOwnProperty.call(changed, path)) {
    changed[path] = value;
    return;
  }
  setPropertyValue(changed, path, value);
}

function safeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function unwrapPileItem(entry) {
  return entry?.item ?? entry;
}

function durabilityProjectionForItem(item, durabilityOverride = null) {
  const itemData = itemDataOf(item);
  const durability = durabilityOverride ?? durabilityOf(item);
  if (!itemData || !isDurabilityEligible(itemData) || !durability || durability.eligible === false) {
    return null;
  }

  const hpMax = Math.max(1, safeInteger(durability?.hp?.max, 1));
  const hpValue = Math.min(hpMax, safeInteger(durability?.hp?.value));
  return {
    itemId: cleanText(item?.id ?? item?._id),
    itemUuid: cleanText(item?.uuid),
    hp: { value: hpValue, max: hpMax, dt: safeInteger(durability.damageThreshold) },
    ac: { calc: "flat", flat: safeInteger(durability.ac) }
  };
}

function singleDurabilityItem(collection) {
  const durableItems = collectionValues(collection)
    .map(unwrapPileItem)
    .filter((item) => durabilityProjectionForItem(item));
  return durableItems.length === 1 ? durableItems[0] : null;
}

function itemPilesApi(foundryGame) {
  const module = foundryGame?.modules?.get?.(ITEM_PILES_MODULE_ID);
  if (module?.active === false) {
    return null;
  }
  return foundryGame?.itempiles?.API ?? null;
}

function actorOfPileTarget(target) {
  return target?.actor ?? target?.document?.actor ?? target ?? null;
}

function tokenDocumentOf(value) {
  const token = value?.document ?? value;
  return token?.actor ? token : null;
}

function pileTargetForActor(actor) {
  return tokenDocumentOf(actor?.token) ?? actor;
}

function isValidPile(api, target, actor = actorOfPileTarget(target)) {
  if (typeof api?.isValidItemPile !== "function") {
    return false;
  }
  try {
    return api.isValidItemPile(target) === true || (target !== actor && api.isValidItemPile(actor) === true);
  }
  catch (_error) {
    return false;
  }
}

function pileActorUpdate(projection) {
  return {
    "system.attributes.hp.value": projection.hp.value,
    "system.attributes.hp.max": projection.hp.max,
    "system.attributes.hp.dt": projection.hp.dt,
    "system.attributes.ac.calc": projection.ac.calc,
    "system.attributes.ac.flat": projection.ac.flat,
    [`flags.${MODULE_ID}.durabilityPile`]: {
      itemId: projection.itemId,
      itemUuid: projection.itemUuid
    }
  };
}

function projectDurabilityOntoTokenData(tokenData, item) {
  const projection = durabilityProjectionForItem(item);
  if (!projection || !tokenData || typeof tokenData !== "object") {
    return false;
  }
  setPropertyValue(tokenData, "delta.system.attributes.hp", projection.hp);
  setPropertyValue(tokenData, "delta.system.attributes.ac", projection.ac);
  setPropertyValue(tokenData, "bar1.attribute", "attributes.hp");
  return true;
}

async function syncPileDurability(target, foundryGame, isActiveGm = () => isActiveGmClient(foundryGame)) {
  const api = itemPilesApi(foundryGame);
  const actor = actorOfPileTarget(target);
  const pileTarget = target?.actor ? target : pileTargetForActor(actor);
  if (!api || !actor || !isActiveGm() || !isValidPile(api, pileTarget, actor)) {
    return false;
  }

  const item = singleDurabilityItem(actor.items);
  if (item && typeof actor.update === "function") {
    const projection = durabilityProjectionForItem(item);
    if (!isActiveGm()) {
      return false;
    }
    await actor.update(pileActorUpdate(projection), {
      [MODULE_ID]: { [PILE_PROJECTION_OPTION]: true }
    });
  }

  const token = tokenDocumentOf(pileTarget) ?? tokenDocumentOf(actor.token);
  if (token && typeof token.update === "function") {
    if (!isActiveGm()) {
      return false;
    }
    await token.update({ "bar1.attribute": "attributes.hp" }, {
      [MODULE_ID]: { [PILE_PROJECTION_OPTION]: true }
    });
  }
  return Boolean(item || token);
}

function queuePileTask(target, callback) {
  const actor = actorOfPileTarget(target);
  if (!actor || typeof actor !== "object") {
    return Promise.resolve(false);
  }
  const previous = PILE_SYNC_TASKS.get(actor) ?? Promise.resolve();
  const task = previous.catch(() => false).then(callback);
  PILE_SYNC_TASKS.set(actor, task);
  void task.then(() => {
    if (PILE_SYNC_TASKS.get(actor) === task) {
      PILE_SYNC_TASKS.delete(actor);
    }
  }, () => {
    if (PILE_SYNC_TASKS.get(actor) === task) {
      PILE_SYNC_TASKS.delete(actor);
    }
  });
  return task;
}

function queuePileDurabilitySync(
  target,
  foundryGame,
  isActiveGm = () => isActiveGmClient(foundryGame)
) {
  return queuePileTask(target, () => syncPileDurability(target, foundryGame, isActiveGm));
}

function resolveDamageType(options = {}) {
  const direct = cleanText(options.damageType ?? options.type);
  if (direct) {
    return direct;
  }
  const types = collectionValues(options.damageTypes ?? options.types)
    .map(cleanText)
    .filter(Boolean);
  return types.length === 1 ? types[0] : "";
}

function pileDurabilityContext(moduleApi, actor, foundryGame) {
  const api = itemPilesApi(foundryGame);
  const pileTarget = pileTargetForActor(actor);
  if (!api || (typeof moduleApi?.damageItemPile !== "function" && typeof moduleApi?.damageItem !== "function")) {
    return null;
  }
  if (!isValidPile(api, pileTarget, actor)) {
    return null;
  }
  const item = singleDurabilityItem(actor?.items);
  return item ? { actor, item, pileTarget } : null;
}

function pileDamageContext(moduleApi, actor, amount, foundryGame) {
  const context = pileDurabilityContext(moduleApi, actor, foundryGame);
  const damage = Number(amount);
  return context && Number.isFinite(damage) && damage > 0
    ? { ...context, damage }
    : null;
}

function activePileTokens(actor) {
  const tokens = [];
  const seen = new Set();
  const add = (value) => {
    const token = tokenDocumentOf(value);
    const key = cleanText(token?.uuid ?? token?.id);
    if (!token || (key && seen.has(key))) {
      return;
    }
    if (key) {
      seen.add(key);
    }
    tokens.push(token);
  };
  add(actor?.token);
  try {
    for (const token of collectionValues(actor?.getActiveTokens?.(true, true))) {
      add(token);
    }
  }
  catch (_error) {
    // Synthetic actors expose their token directly and do not need this fallback.
  }
  return tokens;
}

function isDefaultItemPileActor(actor, foundryGame) {
  try {
    return cleanText(foundryGame?.settings?.get?.(ITEM_PILES_MODULE_ID, "defaultItemPileActorID")) === cleanText(actor?.id);
  }
  catch (_error) {
    return false;
  }
}

async function cleanupDestroyedPileItem(item, {
  game: foundryGame,
  isActiveGm
}) {
  const actor = item?.parent ?? item?.actor ?? null;
  if (!actor || typeof actor !== "object" || durabilityOf(item)?.state !== "destroyed" || !isActiveGm()) {
    return false;
  }
  if (CLEANED_EMPTY_PILES.has(actor)) {
    return true;
  }
  const running = EMPTY_PILE_CLEANUP_TASKS.get(actor);
  if (running) {
    return running;
  }

  const task = (async () => {
    const api = itemPilesApi(foundryGame);
    const pileTarget = pileTargetForActor(actor);
    if (!api || !isValidPile(api, pileTarget, actor)) {
      return false;
    }
    const deletedItemId = cleanText(item?.id ?? item?._id);
    const remainingItems = collectionValues(actor.items).filter((candidate) => (
      candidate !== item && cleanText(candidate?.id ?? candidate?._id) !== deletedItemId
    ));
    if (remainingItems.length > 0) {
      return false;
    }
    if (typeof api.isItemPileEmpty === "function" && api.isItemPileEmpty(pileTarget) !== true) {
      return false;
    }

    const tokens = activePileTokens(actor);
    if (tokens.length > 0) {
      if (typeof api.deleteItemPile !== "function") {
        return false;
      }
      for (const token of tokens) {
        if (!CLEANED_EMPTY_PILES.has(token)) {
          await api.deleteItemPile(token);
          CLEANED_EMPTY_PILES.add(token);
        }
      }
      CLEANED_EMPTY_PILES.add(actor);
      return true;
    }

    if (isDefaultItemPileActor(actor, foundryGame) || typeof actor.delete !== "function") {
      return false;
    }
    await actor.delete();
    CLEANED_EMPTY_PILES.add(actor);
    return true;
  })();

  EMPTY_PILE_CLEANUP_TASKS.set(actor, task);
  try {
    return await task;
  }
  finally {
    EMPTY_PILE_CLEANUP_TASKS.delete(actor);
  }
}

async function applyPileDamage(context, moduleApi, options, dependencies) {
  const damageItem = typeof moduleApi.damageItemPile === "function"
    ? moduleApi.damageItemPile.bind(moduleApi)
    : moduleApi.damageItem.bind(moduleApi);
  const transition = await damageItem(context.item, {
    amount: context.damage,
    damageType: resolveDamageType(options)
  });
  const state = transition?.nextFlag?.state ?? durabilityOf(context.item)?.state;
  if (transition?.outcome === "destroyed" || state === "destroyed") {
    await cleanupDestroyedPileItem(context.item, dependencies);
    return transition;
  }
  await syncPileDurability(context.pileTarget, dependencies.game, dependencies.isActiveGm);
  return transition;
}

function queuePileDamage(context, moduleApi, options, dependencies) {
  return queuePileTask(
    context.pileTarget,
    () => applyPileDamage(context, moduleApi, options, dependencies)
  );
}

function reportPileTask(task, label) {
  return Promise.resolve(task).catch((error) => {
    console.error(`${MODULE_ID} | ${label}`, error);
    return false;
  });
}

function syntheticTokenActors(token) {
  const delta = token?.delta ?? token?.actorDelta ?? null;
  return [
    token?.actor,
    delta?.syntheticActor,
    delta?.actor,
    delta?.items ? delta : null
  ];
}

function collectLoadedActors(foundryGame, foundryCanvas) {
  const actors = [];
  const seenActors = new Set();
  const seenActorObjects = new WeakSet();
  const addActor = (actor) => {
    if (!actor || typeof actor !== "object" || seenActorObjects.has(actor)) {
      return;
    }
    const key = cleanText(actor.uuid) || cleanText(actor.id);
    if (key && seenActors.has(key)) {
      return;
    }
    seenActorObjects.add(actor);
    if (key) {
      seenActors.add(key);
    }
    actors.push(actor);
  };

  for (const actor of collectionValues(foundryGame?.actors)) {
    addActor(actor);
  }

  const scenes = [];
  const seenScenes = new Set();
  const seenSceneObjects = new WeakSet();
  const addScene = (scene) => {
    if (!scene || typeof scene !== "object" || seenSceneObjects.has(scene)) {
      return;
    }
    const key = cleanText(scene.uuid) || cleanText(scene.id);
    if (key && seenScenes.has(key)) {
      return;
    }
    seenSceneObjects.add(scene);
    if (key) {
      seenScenes.add(key);
    }
    scenes.push(scene);
  };
  for (const scene of collectionValues(foundryGame?.scenes)) {
    addScene(scene);
  }
  addScene(foundryGame?.scenes?.active);
  addScene(foundryGame?.scenes?.current);
  addScene(foundryCanvas?.scene);

  for (const scene of scenes) {
    for (const token of collectionValues(scene?.tokens)) {
      for (const actor of syntheticTokenActors(token)) {
        addActor(actor);
      }
    }
  }
  return actors;
}

export async function reconcileItemPileDurability({
  game: foundryGame = globalThis.game,
  canvas: foundryCanvas = globalThis.canvas,
  isActiveGm = () => isActiveGmClient(foundryGame)
} = {}) {
  const api = itemPilesApi(foundryGame);
  if (!api || !isActiveGm()) {
    return [];
  }

  const reconciled = [];
  for (const actor of collectLoadedActors(foundryGame, foundryCanvas)) {
    const target = pileTargetForActor(actor);
    if (!isValidPile(api, target, actor) || !singleDurabilityItem(actor?.items)) {
      continue;
    }
    if (await queuePileDurabilitySync(target, foundryGame, isActiveGm)) {
      reconciled.push(cleanText(actor.id ?? actor.uuid));
    }
  }
  return reconciled.filter(Boolean);
}

export async function reconcileBrokenEquippedArmor({
  game: foundryGame = globalThis.game,
  canvas: foundryCanvas = globalThis.canvas,
  isActiveGm = () => isActiveGmClient(foundryGame)
} = {}) {
  if (!isActiveGm()) {
    return [];
  }

  const updated = [];
  for (const actor of collectLoadedActors(foundryGame, foundryCanvas)) {
    for (const item of collectionValues(actor?.items)) {
      if (!isBodyArmor(item) || !isBrokenDurabilityItem(item) || item?.system?.equipped !== true) {
        continue;
      }
      await item.update({ "system.equipped": false });
      updated.push(cleanText(item.uuid ?? item.id));
    }
  }
  return updated;
}

export function registerDurabilityHooks(moduleApi, {
  Hooks = globalThis.Hooks,
  notifications = globalThis.ui?.notifications,
  CONFIG: FoundryConfig = globalThis.CONFIG,
  game: foundryGame = globalThis.game,
  isActiveGm = () => isActiveGmClient(foundryGame)
} = {}) {
  if (!Hooks?.on || (typeof Hooks !== "object" && typeof Hooks !== "function")) {
    return false;
  }
  if (REGISTERED_HOOK_TARGETS.has(Hooks)) {
    return false;
  }
  REGISTERED_HOOK_TARGETS.add(Hooks);

  const warnedWorkflowKeys = new Set();
  const checkUse = (item, warningKey = "") => {
    const decision = canUseDurabilityItem(item);
    if (decision.allowed) {
      return true;
    }

    if (!warningKey || !warnedWorkflowKeys.has(warningKey)) {
      notifications?.warn?.(decision.reason);
      if (warningKey) {
        warnedWorkflowKeys.add(warningKey);
        while (warnedWorkflowKeys.size > MAX_WORKFLOW_WARNING_KEYS) {
          warnedWorkflowKeys.delete(warnedWorkflowKeys.values().next().value);
        }
      }
    }
    return false;
  };

  Hooks.on("dnd5e.preUseActivity", (activity) => checkUse(activity?.item));
  Hooks.on("midi-qol.preItemRoll", (context) => {
    const item = resolveHookItem(context);
    return checkUse(item, resolveWorkflowWarningKey(context, item));
  });
  Hooks.on("midi-qol.preItemRollV2", (context) => {
    const item = resolveHookItem(context);
    return checkUse(item, resolveWorkflowWarningKey(context, item));
  });
  Hooks.on("preCreateItem", forceBrokenArmorUnequipped);
  Hooks.on("preUpdateItem", forceBrokenArmorUnequipped);
  patchDurabilityItemEffectSuppression({ CONFIG: FoundryConfig });
  return true;
}
