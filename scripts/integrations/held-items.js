import { MODULE_ID } from "../constants.js";

export const DEFAULT_HAND_CAPACITY = 2;
export const RACE_HANDS_FLAG = "hands";
export const HELD_ITEM_HANDS_FLAG = "heldHands";
export const HAND_SLOTS = Object.freeze(["left", "right"]);
export const HAND_SLOT_LABELS = Object.freeze({
  left: "Левая рука",
  right: "Правая рука"
});
export const HELD_ITEM_ELIGIBLE_TYPES = new Set(["weapon", "equipment", "consumable"]);

const HAND_SLOT_SET = new Set(HAND_SLOTS);
const GENERIC_HAND_SLOT_PATTERN = /^hand([3-9]|\d{2,})$/u;

function getProperty(source, path) {
  if (!source || !path) {
    return undefined;
  }

  if (globalThis.foundry?.utils?.getProperty) {
    return foundry.utils.getProperty(source, path);
  }

  return String(path).split(".").filter(Boolean).reduce((current, part) => (
    current && typeof current === "object" ? current[part] : undefined
  ), source);
}

function getDocumentFlag(document, key) {
  if (!document || !key) {
    return undefined;
  }

  if (typeof document.getFlag === "function") {
    const value = document.getFlag(MODULE_ID, key);
    if (value !== undefined) {
      return value;
    }
  }

  return getProperty(document, `flags.${MODULE_ID}.${key}`);
}

function positiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(0, Math.floor(numericValue));
}

function readHandCapacity(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return positiveInteger(value.max ?? value.value ?? value.count ?? value.capacity, 0);
  }

  return positiveInteger(value, 0);
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }

  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }

  if (typeof collection[Symbol.iterator] === "function") {
    return Array.from(collection);
  }

  return [];
}

function itemId(item) {
  return String(item?.id ?? item?._id ?? "");
}

function sameItem(left, right) {
  if (!left || !right) {
    return false;
  }

  const leftId = itemId(left);
  const rightId = itemId(right);
  return Boolean(leftId && rightId && leftId === rightId);
}

export function normalizeHandSlot(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return "";
  }

  if (text === "left" || text === "l" || text === "левая" || text === "левая рука") {
    return "left";
  }

  if (text === "right" || text === "r" || text === "правая" || text === "правая рука") {
    return "right";
  }

  if (HAND_SLOT_SET.has(text) || GENERIC_HAND_SLOT_PATTERN.test(text)) {
    return text;
  }

  return "";
}

export function normalizeHeldHands(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((entry) => normalizeHandSlot(entry)).filter(Boolean)));
  }

  if (value && typeof value === "object") {
    if (Array.isArray(value.slots)) {
      return normalizeHeldHands(value.slots);
    }

    const entries = [];
    for (const [slot, enabled] of Object.entries(value)) {
      if (enabled === true || enabled === 1 || enabled === "true") {
        entries.push(slot);
      }
    }
    return normalizeHeldHands(entries);
  }

  if (typeof value === "string" && value.includes(",")) {
    return normalizeHeldHands(value.split(","));
  }

  const slot = normalizeHandSlot(value);
  return slot ? [slot] : [];
}

export function getItemHeldHands(item) {
  return normalizeHeldHands(getDocumentFlag(item, HELD_ITEM_HANDS_FLAG));
}

export function isItemEquipped(item) {
  const equipped = getProperty(item, "system.equipped");
  if (equipped && typeof equipped === "object") {
    return equipped.value === true;
  }

  return equipped === true;
}

export function isHeldItemEligible(item) {
  return HELD_ITEM_ELIGIBLE_TYPES.has(String(item?.type ?? ""));
}

export function getActorHandCapacity(actor) {
  const actorCapacity = readHandCapacity(getDocumentFlag(actor, RACE_HANDS_FLAG));
  if (actorCapacity > 0) {
    return actorCapacity;
  }

  let raceCapacity = 0;
  for (const item of collectionValues(actor?.items)) {
    if (item?.type !== "race") {
      continue;
    }

    raceCapacity = Math.max(raceCapacity, readHandCapacity(getDocumentFlag(item, RACE_HANDS_FLAG)));
  }

  return raceCapacity > 0 ? raceCapacity : DEFAULT_HAND_CAPACITY;
}

export function getActorHandSlots(actor) {
  const capacity = getActorHandCapacity(actor);
  const slots = HAND_SLOTS.slice(0, capacity);
  for (let index = slots.length; index < capacity; index += 1) {
    slots.push(`hand${index + 1}`);
  }
  return slots;
}

export function getOccupiedHandSlots(actor, { exceptItem = null } = {}) {
  const occupied = new Map();
  const validSlots = new Set(getActorHandSlots(actor));
  for (const item of collectionValues(actor?.items)) {
    if (exceptItem && sameItem(item, exceptItem)) {
      continue;
    }

    if (!isItemEquipped(item)) {
      continue;
    }

    for (const hand of getItemHeldHands(item)) {
      if (validSlots.has(hand) && !occupied.has(hand)) {
        occupied.set(hand, item);
      }
    }
  }

  return occupied;
}

export function getFreeHandSlots(actor, { exceptItem = null } = {}) {
  const occupied = getOccupiedHandSlots(actor, { exceptItem });
  return getActorHandSlots(actor).filter((slot) => !occupied.has(slot));
}

export function buildHeldItemHandUpdate(hands) {
  const heldHands = normalizeHeldHands(hands);
  return {
    "system.equipped": true,
    [`flags.${MODULE_ID}.${HELD_ITEM_HANDS_FLAG}`]: heldHands
  };
}

export function buildHeldItemWornUpdate(equipped = true) {
  return {
    "system.equipped": equipped === true,
    [`flags.${MODULE_ID}.-=${HELD_ITEM_HANDS_FLAG}`]: null
  };
}

export function canUseHeldItemForHandRequirement(actor, item, { requiredHands = 1 } = {}) {
  const required = positiveInteger(requiredHands, 1);
  const heldHands = isItemEquipped(item) ? getItemHeldHands(item) : [];
  const freeHands = getFreeHandSlots(actor, { exceptItem: item });
  if (required <= 0) {
    return {
      ok: true,
      reason: "",
      requiredHands: required,
      heldHands,
      freeHands
    };
  }

  if (!heldHands.length) {
    return {
      ok: false,
      reason: "notHeld",
      requiredHands: required,
      heldHands,
      freeHands
    };
  }

  if (heldHands.length < required) {
    return {
      ok: false,
      reason: "insufficientHeldHands",
      requiredHands: required,
      heldHands,
      freeHands
    };
  }

  return {
    ok: true,
    reason: "",
    requiredHands: required,
    heldHands,
    freeHands
  };
}

export function buildHeldItemEquipMenuActions(actor, item) {
  const occupied = getOccupiedHandSlots(actor, { exceptItem: item });
  return [
    {
      id: "worn",
      label: "Надето",
      icon: "fa-solid fa-shirt fa-fw",
      update: buildHeldItemWornUpdate(true)
    },
    {
      id: "unequipped",
      label: "Снято",
      icon: "fa-solid fa-box-open fa-fw",
      update: buildHeldItemWornUpdate(false)
    },
    ...HAND_SLOTS.map((slot) => ({
      id: slot,
      label: HAND_SLOT_LABELS[slot],
      icon: "fa-solid fa-hand fa-fw",
      disabled: occupied.has(slot),
      disabledReason: occupied.has(slot) ? "occupied" : "",
      update: buildHeldItemHandUpdate(slot)
    }))
  ];
}
