import { MODULE_ID } from "../constants.js";
import {
  CHEST_OBJECT_DURABILITY,
  ensureStorageObjectDurability,
  readStorageObjectDurability
} from "../data/native-object-durability-service.js";
import { isDurabilityEligible } from "../data/durability-rules.js";
import { storageObjectKind } from "../data/storage-object-kind.js";
import { readStorageState, STORAGE_UPDATED_HOOK } from "../data/storage-service.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { isNaturalWeapon } from "./held-items.js?v=1.4.96-npc-held-natural";

const EFFECT_SUPPRESSION_PATCH = Symbol.for(`${MODULE_ID}.durabilityEffectSuppression`);
const REGISTERED_HOOK_TARGETS = new WeakSet();
const TARGET_TASKS = new WeakMap();
const MAX_WORKFLOW_WARNING_KEYS = 256;

function cleanText(value) {
  return String(value ?? "").trim();
}

function itemDataOf(item) {
  if (!item || typeof item !== "object") return null;
  if (typeof item.toObject === "function") {
    try {
      return item.toObject();
    }
    catch (_error) {
      // Synthetic documents still expose the fields read below.
    }
  }
  return item;
}

function durabilityOf(item) {
  try {
    const flag = item?.getFlag?.(MODULE_ID, "durability");
    if (flag && typeof flag === "object") return flag;
  }
  catch (_error) {
    // Fall through to source data.
  }
  return item?.flags?.[MODULE_ID]?.durability
    ?? item?._source?.flags?.[MODULE_ID]?.durability
    ?? null;
}

function resolveHookItem(context) {
  return context?.workflow?.item ?? context?.activity?.item ?? context?.item ?? null;
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
    if (descriptor) return descriptor;
  }
  return null;
}

export function patchDurabilityItemEffectSuppression({ CONFIG: FoundryConfig = globalThis.CONFIG } = {}) {
  const prototype = FoundryConfig?.Item?.documentClass?.prototype;
  if (!prototype || prototype[EFFECT_SUPPRESSION_PATCH] === true) return false;
  const originalGetter = findPropertyDescriptor(prototype, "areEffectsSuppressed")?.get;
  if (typeof originalGetter !== "function") return false;
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
  if (item?.type !== "equipment") return false;
  const type = cleanText(item?.system?.type?.value).toLowerCase();
  return Boolean(type) && type !== "shield";
}

function forceBrokenArmorUnequipped(item, update) {
  if (!isBrokenDurabilityItem(item) || !isBodyArmor(item) || !update || typeof update !== "object") return;
  if (update["system.equipped"] === true) update["system.equipped"] = false;
  if (update.system?.equipped === true) update.system.equipped = false;
}

export function isBrokenDurabilityItem(item) {
  if (!item || typeof item !== "object" || isNaturalWeapon(item) || !isDurabilityEligible(item)) return false;
  const durability = durabilityOf(item);
  return durability?.eligible !== false && ["broken", "destroyed"].includes(cleanText(durability?.state));
}

export function canUseDurabilityItem(item) {
  if (!isBrokenDurabilityItem(item)) return { allowed: true, reason: "" };
  const name = cleanText(item?.name) || "Предмет";
  return { allowed: false, reason: `Предмет «${name}» сломан и не может использоваться.` };
}

export function filterBrokenItemEffects(effects, item) {
  return isBrokenDurabilityItem(item) ? [] : Array.from(effects ?? []);
}

function collectionValues(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  try {
    return collection ? Array.from(collection) : [];
  }
  catch (_error) {
    return [];
  }
}

function getPropertyValue(object, path) {
  if (!object || typeof object !== "object") return undefined;
  if (Object.hasOwn(object, path)) return object[path];
  if (globalThis.foundry?.utils?.getProperty) return globalThis.foundry.utils.getProperty(object, path);
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setPropertyValue(object, path, value) {
  if (Object.hasOwn(object, path)) {
    object[path] = value;
    return;
  }
  if (globalThis.foundry?.utils?.setProperty) {
    globalThis.foundry.utils.setProperty(object, path, value);
    return;
  }
  const parts = path.split(".");
  const last = parts.pop();
  let target = object;
  for (const part of parts) target = (target[part] ??= {});
  target[last] = value;
}

function safeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function resolveDamageType(options = {}) {
  const direct = cleanText(options.damageType ?? options.type);
  if (direct) return direct;
  const types = collectionValues(options.damageTypes ?? options.types).map(cleanText).filter(Boolean);
  return types.length === 1 ? types[0] : "";
}

function tokenDocumentOf(value) {
  const direct = value?.document ?? value;
  if (direct?.actor && storageObjectKind(direct)) return direct;
  const candidates = [value?.token?.document, value?.token, value?.actor?.token?.document, value?.actor?.token];
  return candidates.map((entry) => entry?.document ?? entry)
    .find((entry) => entry?.actor && storageObjectKind(entry)) ?? null;
}

function visibleRows(state) {
  const claimed = new Set(state?.claimedRowIds ?? []);
  return [...(state?.manualRows ?? []), ...(state?.generatedRows ?? [])]
    .filter((row) => !claimed.has(cleanText(row?.rowId)));
}

function nativeProjection(token) {
  const kind = storageObjectKind(token);
  if (kind === "chest") return readStorageObjectDurability(token) ?? CHEST_OBJECT_DURABILITY;
  if (kind !== "groundPile") return null;
  const rows = visibleRows(readStorageState(token));
  if (rows.length !== 1) return null;
  const durability = rows[0]?.itemData?.flags?.[MODULE_ID]?.durability;
  return durability?.eligible === false ? null : durability ?? null;
}

function nativeDamageContext(actor, amount) {
  const target = tokenDocumentOf(actor);
  const durability = nativeProjection(target);
  const damage = Number(amount);
  return target && durability && Number.isFinite(damage) && damage > 0
    ? { target, durability, damage }
    : null;
}

function queueTargetTask(target, callback) {
  const previous = TARGET_TASKS.get(target) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(callback);
  TARGET_TASKS.set(target, task);
  void task.finally(() => {
    if (TARGET_TASKS.get(target) === task) TARGET_TASKS.delete(target);
  }).catch(() => undefined);
  return task;
}

function reportTask(task, label) {
  void Promise.resolve(task).catch((error) => console.error(`${MODULE_ID} | ${label}`, error));
}

function queueDamage(context, moduleApi, options) {
  return queueTargetTask(context.target, () => moduleApi.damageDurabilityTarget(context.target, {
    amount: context.damage,
    damageType: resolveDamageType(options)
  }));
}

function allScenes(foundryGame, foundryCanvas) {
  const scenes = [...collectionValues(foundryGame?.scenes)];
  for (const scene of [foundryGame?.scenes?.active, foundryGame?.scenes?.current, foundryCanvas?.scene]) {
    if (scene && !scenes.includes(scene)) scenes.push(scene);
  }
  return scenes;
}

function allStorageTokens(foundryGame, foundryCanvas) {
  const result = [];
  const seen = new Set();
  for (const scene of allScenes(foundryGame, foundryCanvas)) {
    for (const token of collectionValues(scene?.tokens)) {
      const key = cleanText(token?.uuid ?? `${scene?.id}.${token?.id}`);
      if (!storageObjectKind(token) || (key && seen.has(key))) continue;
      if (key) seen.add(key);
      result.push(token);
    }
  }
  return result;
}

async function projectNativeToken(token, { isActiveGm, ensureDurability }) {
  if (!isActiveGm()) return false;
  if (storageObjectKind(token) === "chest") {
    await ensureDurability(token, { isActiveGm });
    return isActiveGm();
  }
  const durability = nativeProjection(token);
  if (!durability || !isActiveGm() || typeof token?.update !== "function") return false;
  const hpMax = Math.max(1, safeInteger(durability?.hp?.max, 1));
  const hpValue = Math.min(hpMax, safeInteger(durability?.hp?.value));
  await token.update({
    "delta.system.attributes.hp": {
      value: hpValue,
      max: hpMax,
      dt: safeInteger(durability.damageThreshold)
    },
    "delta.system.attributes.ac": { calc: "flat", flat: safeInteger(durability.ac) },
    "bar1.attribute": "attributes.hp"
  });
  return isActiveGm();
}

export async function reconcileNativeObjectDurability({
  game: foundryGame = globalThis.game,
  canvas: foundryCanvas = globalThis.canvas,
  isActiveGm = () => isActiveGmClient(foundryGame),
  ensureDurability = ensureStorageObjectDurability
} = {}) {
  if (!isActiveGm()) return [];
  const reconciled = [];
  for (const token of allStorageTokens(foundryGame, foundryCanvas)) {
    if (await projectNativeToken(token, { isActiveGm, ensureDurability })) {
      reconciled.push(cleanText(token.uuid ?? token.id));
    }
  }
  return reconciled.filter(Boolean);
}

function collectLoadedActors(foundryGame, foundryCanvas) {
  const result = [];
  const seen = new Set();
  const add = (actor) => {
    if (!actor || typeof actor !== "object") return;
    const key = cleanText(actor.uuid ?? actor.id);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    result.push(actor);
  };
  for (const actor of collectionValues(foundryGame?.actors)) add(actor);
  for (const scene of allScenes(foundryGame, foundryCanvas)) {
    for (const token of collectionValues(scene?.tokens)) {
      add(token?.actor);
      add(token?.delta?.syntheticActor ?? token?.actorDelta?.syntheticActor);
    }
  }
  return result;
}

export async function reconcileBrokenEquippedArmor({
  game: foundryGame = globalThis.game,
  canvas: foundryCanvas = globalThis.canvas,
  isActiveGm = () => isActiveGmClient(foundryGame)
} = {}) {
  if (!isActiveGm()) return [];
  const updated = [];
  for (const actor of collectLoadedActors(foundryGame, foundryCanvas)) {
    for (const item of collectionValues(actor?.items)) {
      if (!isBodyArmor(item) || !isBrokenDurabilityItem(item) || item?.system?.equipped !== true) continue;
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
  isActiveGm = () => isActiveGmClient(foundryGame),
  ensureDurability = ensureStorageObjectDurability
} = {}) {
  if (!Hooks?.on || (typeof Hooks !== "object" && typeof Hooks !== "function")) return false;
  if (REGISTERED_HOOK_TARGETS.has(Hooks)) return false;
  REGISTERED_HOOK_TARGETS.add(Hooks);

  const warnedWorkflowKeys = new Set();
  const checkUse = (item, warningKey = "") => {
    const decision = canUseDurabilityItem(item);
    if (decision.allowed) return true;
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

  Hooks.on("dnd5e.preApplyDamage", (actor, amount, _updates, options = {}) => {
    const context = nativeDamageContext(actor, amount);
    if (!context || typeof moduleApi?.damageDurabilityTarget !== "function") return true;
    reportTask(queueDamage(context, moduleApi, options), "Native durability damage failed.");
    return false;
  });

  Hooks.on("preUpdateActor", (actor, changed, options = {}) => {
    const target = tokenDocumentOf(actor);
    const durability = nativeProjection(target);
    if (!target || !durability || !changed || typeof changed !== "object") return true;
    const currentHp = safeInteger(durability?.hp?.value);
    const requestedHp = Number(getPropertyValue(changed, "system.attributes.hp.value"));
    if (!Number.isFinite(requestedHp) || requestedHp === currentHp) return true;
    setPropertyValue(changed, "system.attributes.hp.value", currentHp);
    if (requestedHp < currentHp && typeof moduleApi?.damageDurabilityTarget === "function") {
      const context = { target, durability, damage: currentHp - requestedHp };
      reportTask(queueDamage(context, moduleApi, options), "Native durability HP routing failed.");
    }
    return true;
  });

  const refreshProjection = (token) => {
    if (!storageObjectKind(token)) return;
    reportTask(queueTargetTask(token, () => projectNativeToken(token, {
      isActiveGm,
      ensureDurability
    })), "Native durability projection failed.");
  };
  Hooks.on(STORAGE_UPDATED_HOOK, refreshProjection);
  Hooks.on("updateToken", (token, changed = {}) => {
    if (getPropertyValue(changed, `flags.${MODULE_ID}.storage`) !== undefined) refreshProjection(token);
  });

  patchDurabilityItemEffectSuppression({ CONFIG: FoundryConfig });
  return true;
}
