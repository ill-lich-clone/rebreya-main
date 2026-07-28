import { MODULE_ID } from "../constants.js";

export const DEFAULT_HAND_CAPACITY = 2;
export const RACE_HANDS_FLAG = "hands";
export const HAND_REQUIREMENT_FLAG = "handRequirement";
export const HELD_ITEM_HANDS_FLAG = "heldHands";
export const VERSATILE_BASE_DAMAGE_ORIGINAL_FLAG = "versatileBaseDamageOriginal";
export const HAND_SLOTS = Object.freeze(["left", "right"]);
export const HAND_SLOT_LABELS = Object.freeze({
  left: "Левая рука",
  right: "Правая рука"
});
export const HELD_ITEM_PRESENTATIONS = Object.freeze({
  worn: {
    label: "Надето",
    icon: "fa-solid fa-shirt fa-fw"
  },
  unequipped: {
    label: "Снято",
    icon: "fa-solid fa-box-open fa-fw"
  },
  left: {
    label: HAND_SLOT_LABELS.left,
    icon: "fa-solid fa-hand-point-left fa-fw"
  },
  right: {
    label: HAND_SLOT_LABELS.right,
    icon: "fa-solid fa-hand-point-right fa-fw"
  },
  both: {
    label: "Две руки",
    icon: "fa-solid fa-hands fa-fw"
  }
});
export const HELD_ITEM_ELIGIBLE_TYPES = new Set(["weapon", "equipment", "consumable"]);

const HAND_SLOT_SET = new Set(HAND_SLOTS);
const GENERIC_HAND_SLOT_PATTERN = /^hand([3-9]|\d{2,})$/u;
const NATURAL_WEAPON_TYPE_VALUES = new Set(["natural", "naturalweapon", "naturalweapons"]);
const NATURAL_WEAPON_PROPERTIES = ["natural", "nat", "naturalWeapon"];

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

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toPlainValue(value) {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toPlainValue(entry));
  }

  if (value instanceof Set) {
    return Array.from(value, (entry) => toPlainValue(entry));
  }

  const source = typeof value.toObject === "function" ? value.toObject() : value;
  return Object.fromEntries(Object.keys(source).map((key) => [key, toPlainValue(source[key])]));
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

function normalizeHandCounts(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value
      .map((entry) => positiveInteger(entry, 0))
      .filter((entry) => entry > 0)));
  }

  if (value && typeof value === "object") {
    return normalizeHandCounts(value.allowedHands ?? value.allowed ?? value.options ?? value.values ?? value.slots);
  }

  if (typeof value === "string") {
    const matches = value.match(/\d+/gu);
    return normalizeHandCounts(matches ?? []);
  }

  const count = positiveInteger(value, 0);
  return count > 0 ? [count] : [];
}

function hasSystemProperty(item, property) {
  const properties = getProperty(item, "system.properties");
  if (!properties || !property) {
    return false;
  }

  if (Array.isArray(properties)) {
    return properties.includes(property);
  }

  if (typeof properties.has === "function") {
    return properties.has(property);
  }

  if (properties && typeof properties === "object") {
    if (Array.isArray(properties.value)) {
      return properties.value.includes(property);
    }

    const entry = properties[property];
    if (entry && typeof entry === "object") {
      return entry.value === true || entry.selected === true;
    }

    return entry === true || entry === 1 || entry === property;
  }

  return String(properties).split(/[,\s;]+/u).includes(property);
}

function normalizeNaturalWeaponValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, "");
}

export function isNaturalWeapon(item) {
  if (String(item?.type ?? "") !== "weapon") {
    return false;
  }

  const typeValues = [
    getProperty(item, "system.type.value"),
    getProperty(item, "system.type.subtype"),
    getProperty(item, "system.type.baseItem"),
    getProperty(item, "system.baseItem")
  ];
  if (typeValues.some((value) => NATURAL_WEAPON_TYPE_VALUES.has(normalizeNaturalWeaponValue(value)))) {
    return true;
  }

  return NATURAL_WEAPON_PROPERTIES.some((property) => hasSystemProperty(item, property));
}

function getItemQuantity(item) {
  const quantity = getProperty(item, "system.quantity");
  if (quantity && typeof quantity === "object") {
    return positiveInteger(quantity.value ?? quantity.count, 1);
  }

  return positiveInteger(quantity, 1);
}

function cleanFormula(value) {
  return String(value ?? "").trim();
}

function getAutomaticDamagePartFormula(part) {
  if (!part || typeof part !== "object") {
    return "";
  }

  const denomination = positiveInteger(part.denomination, 0);
  if (denomination <= 0) {
    return "";
  }

  const number = Math.max(1, positiveInteger(part.number, 1));
  const bonus = cleanFormula(part.bonus);
  return `${number}d${denomination}${bonus ? ` + ${bonus}` : ""}`;
}

function normalizeFormulaForComparison(value) {
  return cleanFormula(value).replace(/\s+/gu, " ").toLowerCase();
}

function isAutomaticDamagePartFormula(part, formula) {
  const automaticFormula = normalizeFormulaForComparison(getAutomaticDamagePartFormula(part));
  return Boolean(automaticFormula && normalizeFormulaForComparison(formula) === automaticFormula);
}

function isUnsafeCustomDamageFormula(formula) {
  const safeFormula = cleanFormula(formula);
  return !safeFormula
    || safeFormula === "[object Object]"
    || safeFormula.startsWith("{")
    || /(^|[^.\w])@?mod($|[^\w])/iu.test(safeFormula);
}

function normalizeDamageCustom(source) {
  if (!isPlainObject(source?.custom)) {
    return undefined;
  }

  const custom = toPlainValue(source.custom);
  const customFormula = cleanFormula(custom.formula);
  if (
    custom.enabled === true
    && !isUnsafeCustomDamageFormula(customFormula)
    && !isAutomaticDamagePartFormula(source, customFormula)
  ) {
    return {
      ...custom,
      formula: customFormula
    };
  }

  return {
    ...custom,
    enabled: false,
    formula: ""
  };
}

function getDamagePartFormula(part) {
  if (!part || typeof part !== "object") {
    return "";
  }

  const explicitFormula = cleanFormula(part.formula);
  if (explicitFormula) {
    return explicitFormula;
  }

  const customFormula = cleanFormula(part.custom?.formula);
  if (part.custom?.enabled === true && customFormula) {
    return customFormula;
  }

  return getAutomaticDamagePartFormula(part) || customFormula;
}

function replaceLeadingDamageFormula(formula, replacement) {
  const safeFormula = cleanFormula(formula);
  const safeReplacement = cleanFormula(replacement);
  if (!safeReplacement) {
    return safeFormula;
  }

  if (!safeFormula) {
    return safeReplacement;
  }

  const leadingDamagePattern = /^\s*\d+\s*[dк]\s*\d+(?:k[hl]\d+)?/iu;
  if (!leadingDamagePattern.test(safeFormula)) {
    return safeReplacement;
  }

  return safeFormula.replace(leadingDamagePattern, safeReplacement);
}

function itemReplacementDescriptor(slot, item) {
  if (!item) {
    return null;
  }

  return {
    slot,
    itemId: itemId(item),
    itemName: String(item?.name ?? itemId(item) ?? "").trim()
  };
}

function itemReplacementDescriptors(occupied, slots) {
  return slots
    .map((slot) => itemReplacementDescriptor(slot, occupied.get(slot)))
    .filter(Boolean);
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

export function getItemHandRequirement(item) {
  const requirement = getDocumentFlag(item, HAND_REQUIREMENT_FLAG);
  if (requirement === undefined || requirement === null || requirement === "") {
    return null;
  }

  if (requirement && typeof requirement === "object" && !Array.isArray(requirement)) {
    const requiredHands = positiveInteger(
      requirement.requiredHands ?? requirement.hands ?? requirement.min ?? requirement.value,
      0
    );
    const allowedHands = normalizeHandCounts(
      requirement.allowedHands ?? requirement.allowed ?? requirement.options ?? requirement.values
    );
    const normalizedAllowedHands = allowedHands.length ? allowedHands : normalizeHandCounts(requiredHands);
    const maxHands = positiveInteger(requirement.maxHands ?? requirement.max, Math.max(0, ...normalizedAllowedHands));
    const canUseTwoHands = allowedHands.includes(2)
      || maxHands >= 2
      || requiredHands >= 2
      || requirement.canUseTwoHands === true
      || requirement.twoHanded === true
      || requirement.versatile === true;

    return {
      ...requirement,
      requiredHands,
      allowedHands: normalizedAllowedHands,
      maxHands,
      canUseTwoHands
    };
  }

  const allowedHands = normalizeHandCounts(requirement);
  const requiredHands = allowedHands[0] ?? 0;
  return {
    requiredHands,
    allowedHands,
    maxHands: Math.max(0, ...allowedHands),
    canUseTwoHands: allowedHands.includes(2)
  };
}

export function isItemEquipped(item) {
  const equipped = getProperty(item, "system.equipped");
  if (equipped && typeof equipped === "object") {
    return equipped.value === true;
  }

  return equipped === true;
}

export function isHeldItemEligible(item) {
  return HELD_ITEM_ELIGIBLE_TYPES.has(String(item?.type ?? "")) && !isNaturalWeapon(item);
}

export function canHoldItemInTwoHands(item) {
  if (!isHeldItemEligible(item)) {
    return false;
  }

  const requirement = getItemHandRequirement(item);
  if (requirement?.canUseTwoHands) {
    return true;
  }

  if (hasSystemProperty(item, "two") || hasSystemProperty(item, "ver")) {
    return true;
  }

  if (String(item?.type ?? "") !== "weapon" || !hasSystemProperty(item, "lgt") || getItemQuantity(item) < 2) {
    return false;
  }

  if (requirement?.requiredHands > 1 || (requirement?.allowedHands?.length && !requirement.allowedHands.includes(1))) {
    return false;
  }

  return true;
}

export function itemRequiresTwoHandsForUse(item) {
  if (!isHeldItemEligible(item)) {
    return false;
  }

  const requirement = getItemHandRequirement(item);
  return requirement?.requiredHands > 1 || hasSystemProperty(item, "two");
}

function isVersatileWeapon(item) {
  if (String(item?.type ?? "") !== "weapon") {
    return false;
  }

  const requirement = getItemHandRequirement(item);
  return requirement?.versatile === true
    || getProperty(item, "system.isVersatile") === true
    || hasSystemProperty(item, "ver");
}

function getOriginalBaseDamage(item) {
  const originalBase = getDocumentFlag(item, VERSATILE_BASE_DAMAGE_ORIGINAL_FLAG);
  return originalBase === undefined ? undefined : toPlainValue(originalBase);
}

function isTwoHandGrip(hands) {
  const heldHands = new Set(normalizeHeldHands(hands));
  return heldHands.has("left") && heldHands.has("right");
}

export function buildVersatileBaseDamage(item) {
  if (!isVersatileWeapon(item)) {
    return null;
  }

  const baseDamage = getProperty(item, "system.damage.base");
  const versatileDamage = getProperty(item, "system.damage.versatile");
  if (!isPlainObject(baseDamage) || !isPlainObject(versatileDamage)) {
    return null;
  }

  const versatileFormula = getDamagePartFormula(versatileDamage);
  if (!versatileFormula) {
    return null;
  }

  const nextBaseDamage = toPlainValue(baseDamage);
  const versatileDenomination = positiveInteger(versatileDamage.denomination, 0);
  if (versatileDenomination > 0) {
    nextBaseDamage.number = Math.max(1, positiveInteger(versatileDamage.number, 1));
    nextBaseDamage.denomination = versatileDenomination;
  }

  const baseFormula = cleanFormula(nextBaseDamage.formula);
  if (baseFormula) {
    nextBaseDamage.formula = replaceLeadingDamageFormula(baseFormula, versatileFormula);
  }

  if (isPlainObject(nextBaseDamage.custom)) {
    const customFormula = cleanFormula(nextBaseDamage.custom.formula);
    if (
      customFormula
      && !isUnsafeCustomDamageFormula(customFormula)
      && !isAutomaticDamagePartFormula(baseDamage, customFormula)
    ) {
      nextBaseDamage.custom = {
        ...nextBaseDamage.custom,
        formula: replaceLeadingDamageFormula(customFormula, versatileFormula)
      };
    }
    else if (nextBaseDamage.custom.enabled === true || customFormula) {
      nextBaseDamage.custom = {
        ...nextBaseDamage.custom,
        enabled: false,
        formula: ""
      };
    }
  }

  if (versatileDenomination <= 0 && !baseFormula && !cleanFormula(nextBaseDamage.custom?.formula)) {
    nextBaseDamage.formula = replaceLeadingDamageFormula(getDamagePartFormula(baseDamage), versatileFormula);
  }

  return nextBaseDamage;
}

function writeBaseDamageUpdate(update, damage) {
  const source = toPlainValue(damage);
  if (!isPlainObject(source)) {
    return false;
  }

  let wrote = false;
  for (const key of ["number", "denomination", "bonus"]) {
    if (source[key] !== undefined) {
      update[`system.damage.base.${key}`] = source[key];
      wrote = true;
    }
  }

  if (source.types !== undefined) {
    update["system.damage.base.types"] = toPlainValue(source.types);
    wrote = true;
  }

  const normalizedCustom = normalizeDamageCustom(source);
  if (normalizedCustom !== undefined) {
    update["system.damage.base.custom"] = normalizedCustom;
    wrote = true;
  }

  if (source.scaling !== undefined) {
    update["system.damage.base.scaling"] = toPlainValue(source.scaling);
    wrote = true;
  }

  return wrote;
}

function applyVersatileBaseDamageUpdate(update, item, hands, equipped = true) {
  if (!item) {
    return update;
  }

  const originalBaseDamage = getOriginalBaseDamage(item);
  const shouldUseVersatileDamage = equipped === true && isTwoHandGrip(hands);
  if (shouldUseVersatileDamage) {
    const versatileBaseDamage = buildVersatileBaseDamage(item);
    if (!versatileBaseDamage) {
      return update;
    }

    if (!writeBaseDamageUpdate(update, versatileBaseDamage)) {
      return update;
    }

    update[`flags.${MODULE_ID}.${VERSATILE_BASE_DAMAGE_ORIGINAL_FLAG}`] =
      originalBaseDamage ?? toPlainValue(getProperty(item, "system.damage.base"));
    return update;
  }

  if (originalBaseDamage !== undefined) {
    writeBaseDamageUpdate(update, originalBaseDamage);
    update[`flags.${MODULE_ID}.-=${VERSATILE_BASE_DAMAGE_ORIGINAL_FLAG}`] = null;
  }

  return update;
}

export function getHeldItemDamageFormulaPresentation(item, formula) {
  const safeFormula = cleanFormula(formula);
  if (getItemHeldHands(item).length < 2) {
    return safeFormula;
  }

  const requirement = getItemHandRequirement(item);
  const isVersatile = requirement?.versatile === true
    || getProperty(item, "system.isVersatile") === true
    || hasSystemProperty(item, "ver");
  if (!isVersatile) {
    return safeFormula;
  }

  const versatileFormula = getDamagePartFormula(getProperty(item, "system.damage.versatile"));
  return versatileFormula ? replaceLeadingDamageFormula(safeFormula, versatileFormula) : safeFormula;
}

export function getActorHandCapacity(actor) {
  const actorCapacity = readHandCapacity(getDocumentFlag(actor, RACE_HANDS_FLAG));
  let raceCapacity = 0;
  if (actorCapacity <= 0) {
    for (const item of collectionValues(actor?.items)) {
      if (item?.type !== "race") {
        continue;
      }
      raceCapacity = Math.max(raceCapacity, readHandCapacity(getDocumentFlag(item, RACE_HANDS_FLAG)));
    }
  }
  const baseCapacity = actorCapacity > 0
    ? actorCapacity
    : raceCapacity > 0 ? raceCapacity : DEFAULT_HAND_CAPACITY;
  const aggregate = collectionValues(actor?.effects).find((effect) => (
    getDocumentFlag(effect, "implantAggregate") === true
  ));
  const secondaryHands = positiveInteger(
    getDocumentFlag(aggregate, "automation")?.actorFlags?.secondaryHands,
    0
  );
  return baseCapacity + secondaryHands;
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

    if (!isHeldItemEligible(item) || !isItemEquipped(item)) {
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

export function buildHeldItemHandUpdate(hands, item = null) {
  const heldHands = normalizeHeldHands(hands);
  return applyVersatileBaseDamageUpdate({
    "system.equipped": true,
    [`flags.${MODULE_ID}.${HELD_ITEM_HANDS_FLAG}`]: heldHands
  }, item, heldHands, true);
}

export function buildHeldItemWornUpdate(equipped = true, item = null) {
  return applyVersatileBaseDamageUpdate({
    "system.equipped": equipped === true,
    [`flags.${MODULE_ID}.-=${HELD_ITEM_HANDS_FLAG}`]: null
  }, item, [], equipped === true);
}

export function buildHeldItemReleaseHandUpdate(item, hands) {
  const releasedHands = new Set(normalizeHeldHands(hands));
  const remainingHands = getItemHeldHands(item).filter((hand) => !releasedHands.has(hand));
  return remainingHands.length ? buildHeldItemHandUpdate(remainingHands, item) : buildHeldItemWornUpdate(true, item);
}

export function getHeldItemEquipPresentation(item) {
  if (!isItemEquipped(item)) {
    return HELD_ITEM_PRESENTATIONS.unequipped;
  }

  const heldHands = getItemHeldHands(item);
  if (heldHands.includes("left") && heldHands.includes("right")) {
    return HELD_ITEM_PRESENTATIONS.both;
  }

  if (heldHands[0] && HELD_ITEM_PRESENTATIONS[heldHands[0]]) {
    return HELD_ITEM_PRESENTATIONS[heldHands[0]];
  }
  if (GENERIC_HAND_SLOT_PATTERN.test(heldHands[0] ?? "")) {
    return {
      label: `Дополнительная рука ${Number(heldHands[0].slice(4)) - DEFAULT_HAND_CAPACITY}`,
      icon: "fa-solid fa-hand fa-fw"
    };
  }

  return HELD_ITEM_PRESENTATIONS.worn;
}

export function canUseHeldItemForHandRequirement(actor, item, { requiredHands = 1 } = {}) {
  if (!isHeldItemEligible(item)) {
    return {
      ok: true,
      reason: "",
      requiredHands: 0,
      heldHands: [],
      freeHands: []
    };
  }

  const required = positiveInteger(requiredHands, 1);
  const heldHands = isItemEquipped(item) ? getItemHeldHands(item) : [];
  const heldHandSet = new Set(heldHands);
  const freeHands = getFreeHandSlots(actor, { exceptItem: item }).filter((hand) => !heldHandSet.has(hand));
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

  const usesSecondaryHand = heldHands.some((hand) => GENERIC_HAND_SLOT_PATTERN.test(hand));
  if (usesSecondaryHand && item?.type === "weapon" && !hasSystemProperty(item, "lgt")) {
    return {
      ok: false,
      reason: "secondaryHandRestricted",
      requiredHands: required,
      heldHands,
      freeHands
    };
  }

  const availableHands = required > 1
    ? [...heldHands, ...freeHands].filter((hand) => HAND_SLOT_SET.has(hand))
    : [...heldHands, ...freeHands];
  if (availableHands.length < required) {
    return {
      ok: false,
      reason: "insufficientAvailableHands",
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
  if (!isHeldItemEligible(item)) {
    return [];
  }

  const occupied = getOccupiedHandSlots(actor, { exceptItem: item });
  const singleHandCarryOnly = itemRequiresTwoHandsForUse(item);
  const actions = [
    {
      id: "worn",
      ...HELD_ITEM_PRESENTATIONS.worn,
      update: buildHeldItemWornUpdate(true, item)
    },
    {
      id: "unequipped",
      ...HELD_ITEM_PRESENTATIONS.unequipped,
      update: buildHeldItemWornUpdate(false, item)
    },
    ...getActorHandSlots(actor).map((slot) => {
      const secondary = GENERIC_HAND_SLOT_PATTERN.test(slot);
      const secondaryRestricted = secondary
        && item?.type === "weapon"
        && !hasSystemProperty(item, "lgt");
      const presentation = HELD_ITEM_PRESENTATIONS[slot] ?? {
        label: `Дополнительная рука ${Number(slot.slice(4)) - DEFAULT_HAND_CAPACITY}`,
        icon: "fa-solid fa-hand fa-fw"
      };
      return {
      id: slot,
      ...presentation,
      disabled: secondaryRestricted,
      carryOnly: singleHandCarryOnly,
      occupied: occupied.has(slot),
      replacements: itemReplacementDescriptors(occupied, [slot]),
      tooltip: [
        secondaryRestricted ? "Дополнительная конечность может использовать только лёгкое оружие" : "",
        singleHandCarryOnly ? "Только переноска: для атаки нужны две руки" : "",
        occupied.has(slot) ? `Заменить ${occupied.get(slot)?.name ?? "предмет"}` : ""
      ].filter(Boolean).join(". "),
      update: buildHeldItemHandUpdate(slot, item)
      };
    })
  ];

  if (canHoldItemInTwoHands(item)) {
    const replacements = itemReplacementDescriptors(occupied, HAND_SLOTS);
    actions.push({
      id: "both",
      ...HELD_ITEM_PRESENTATIONS.both,
      disabled: false,
      carryOnly: false,
      occupied: replacements.length > 0,
      replacements,
      tooltip: replacements.length
        ? `Заменить ${Array.from(new Set(replacements.map((entry) => entry.itemName))).join(", ")}`
        : "",
      update: buildHeldItemHandUpdate(HAND_SLOTS, item)
    });
  }

  return actions;
}
