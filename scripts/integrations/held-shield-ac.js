import { MODULE_ID } from "../constants.js";
import { isBrokenDurabilityItem } from "./durability-hooks.js";
import { getItemHeldHands } from "./held-items.js?v=1.4.95-npc-held-natural";

const PATCH_MARKER = "__rebreyaHeldShieldArmorClassPatched";
const ACTOR_DATA_MODEL_TYPES = ["character", "npc"];

function cleanString(value) {
  return String(value ?? "").trim();
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }

  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }

  return Array.from(collection);
}

function getActorEquipment(actor) {
  const equipment = actor?.itemTypes?.equipment;
  if (Array.isArray(equipment)) {
    return equipment;
  }

  return collectionValues(actor?.items).filter((item) => item?.type === "equipment");
}

function isShieldEquipmentItem(item) {
  return item?.type === "equipment" && cleanString(item?.system?.type?.value).toLowerCase() === "shield";
}

function getHeldShield(actor) {
  return getActorEquipment(actor).find((item) => (
    isShieldEquipmentItem(item)
    && !isBrokenDurabilityItem(item)
    && getItemHeldHands(item).length > 0
  )) ?? null;
}

function getArmorClassData(actorData) {
  return actorData?.attributes?.ac ?? actorData?.system?.attributes?.ac ?? null;
}

function applyHeldShieldArmorClass(actorData) {
  const actor = actorData?.parent ?? actorData;
  const ac = getArmorClassData(actorData);
  if (!actor || !ac) {
    return;
  }

  const currentShield = toNumber(ac.shield, 0);
  const heldShield = getHeldShield(actor);
  const heldShieldValue = heldShield ? toNumber(heldShield.system?.armor?.value, 0) : 0;
  if (heldShield === ac.equippedShield && currentShield === heldShieldValue) {
    return;
  }

  const currentValue = toNumber(ac.value, NaN);
  if (Number.isFinite(currentValue)) {
    const minimum = toNumber(ac.min, Number.NEGATIVE_INFINITY);
    ac.value = Math.max(minimum, currentValue - currentShield + heldShieldValue);
  }

  ac.shield = heldShieldValue;
  ac.equippedShield = heldShield ?? null;
}

function patchActorDataModel(type, dataModel) {
  const prototype = dataModel?.prototype;
  if (!prototype || prototype[PATCH_MARKER] === true || typeof prototype.prepareDerivedData !== "function") {
    return false;
  }

  const originalPrepareDerivedData = prototype.prepareDerivedData;
  prototype.prepareDerivedData = function rebreyaHeldShieldArmorClassPrepareDerivedData(...args) {
    const result = originalPrepareDerivedData.apply(this, args);
    applyHeldShieldArmorClass(this);
    return result;
  };

  Object.defineProperty(prototype, PATCH_MARKER, {
    value: true,
    configurable: true
  });
  Object.defineProperty(prototype.prepareDerivedData, "name", {
    value: `rebreyaHeldShieldArmorClass${type[0].toUpperCase()}${type.slice(1)}PrepareDerivedData`,
    configurable: true
  });
  return true;
}

export function registerHeldShieldArmorClassPatch({ CONFIG: FoundryConfig = globalThis.CONFIG } = {}) {
  const dataModels = FoundryConfig?.Actor?.dataModels;
  if (!dataModels) {
    console.warn(`${MODULE_ID} | Cannot register held shield armor class patch before dnd5e actor data models are ready.`);
    return [];
  }

  return ACTOR_DATA_MODEL_TYPES.filter((type) => patchActorDataModel(type, dataModels[type]));
}
