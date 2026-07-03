import { MODULE_ID } from "../constants.js";
import { getFighterManeuverAutomation } from "../data/fighter-automation.js";
import { canUseHeldItemForHandRequirement, getItemHeldHands } from "../integrations/held-items.js";

const FIREARM_WEAPON_TYPES = new Set(["firearmPrimitive", "firearmAdvanced"]);
const WEAPON_TYPE_SIMPLE_PREFIX = "simple";
const WEAPON_TYPE_MARTIAL_PREFIX = "martial";
const FIREARM_WEIGHT_THRESHOLD_LB = 10;
const FIREARM_JAMMED_FLAG = "firearmJammed";
const FIREARM_CURRENT_MISFIRE_FLAG = "firearmMisfire";
const FIREARM_BASE_MISFIRE_FLAG = "firearmBaseMisfire";
const FIREARM_MISFIRE_PROPERTY = "lchFirearmMisfire";
const FIREARM_RUST_PROPERTY = "lchFirearmRust";
const FIREARM_MISFIRE_DIE_FORMULA = "1d20";
const FIREARM_JAM_NAME_SUFFIX = " (клин)";
const FIREARM_CLEAR_JAM_AUTOMATION = "firearm-clear-jam";
const FIREARM_MAINTAIN_AUTOMATION = "firearm-maintain";
const FIREARM_MAINTENANCE_TOOL_IDS = ["art:tinker", "tinker", "tink"];
const REACTION_STATE_FLAG = "reactionState";
const REACTION_DEFAULT_MAX_USES = 1;
const FIGHTER_DOMINANCE_TARGET = "fighter-dominance";

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clampInteger(value, min, max) {
  const numericValue = Math.floor(toNumber(value, min));
  return Math.max(min, Math.min(max, numericValue));
}

function signedNumber(value) {
  const safe = toNumber(value, 0);
  return safe >= 0 ? `+${safe}` : String(safe);
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isConfiguredDnd5eToolId(toolId) {
  const dnd5eConfig = globalThis.CONFIG?.DND5E;
  const tools = dnd5eConfig?.tools;
  const vehicles = dnd5eConfig?.vehicleTypes;
  if (!tools && !vehicles) {
    return true;
  }

  return Object.hasOwn(tools ?? {}, toolId) || Object.hasOwn(vehicles ?? {}, toolId);
}

function stripFirearmJamSuffix(name) {
  const text = cleanText(name);
  return text.replace(/\s*\(клин\)\s*$/iu, "").trim() || text;
}

function withFirearmJamSuffix(name) {
  const baseName = stripFirearmJamSuffix(name);
  return `${baseName}${FIREARM_JAM_NAME_SUFFIX}`;
}

function extractRollTotal(result) {
  const direct = toNumber(result?.total, NaN);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const roll = result?.roll ?? result?.rolls?.[0] ?? result?.dice?.[0];
  const rollTotal = toNumber(roll?.total, NaN);
  if (Number.isFinite(rollTotal)) {
    return rollTotal;
  }

  if (Array.isArray(result) && result.length) {
    return extractRollTotal(result[0]);
  }

  return NaN;
}

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/[_\-\s]+/gu, " ")
    .replace(/\s+/gu, " ");
}

function readDocumentFlag(document, scope, key) {
  if (typeof document?.getFlag === "function") {
    return document.getFlag(scope, key);
  }

  return foundry.utils.getProperty(document, `flags.${scope}.${key}`);
}

function readRequiredHands(document) {
  const directValue = readDocumentFlag(document, MODULE_ID, "requiredHands");
  if (directValue !== undefined && directValue !== null && directValue !== "") {
    return directValue;
  }

  const requirement = readDocumentFlag(document, MODULE_ID, "handRequirement");
  if (isPlainObject(requirement)) {
    return requirement.requiredHands ?? requirement.hands ?? requirement.min;
  }

  return undefined;
}

function writeDocumentFlagSource(document, scope, key, value) {
  if (!document || !scope || !key) {
    return;
  }

  const path = `flags.${scope}.${key}`;
  if (typeof document.updateSource === "function") {
    document.updateSource({ [path]: value });
    return;
  }

  foundry.utils.setProperty(document, path, value);
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

  return [];
}

function activityConsumptionTargets(activity) {
  return collectionValues(foundry.utils.getProperty(activity, "consumption.targets"));
}

function consumptionTargetData(target, overrides = {}) {
  return {
    type: String(overrides.type ?? target?.type ?? "").trim(),
    target: String(overrides.target ?? target?.target ?? "").trim(),
    value: String(overrides.value ?? target?.value ?? "1").trim() || "1",
    scaling: {
      mode: String(overrides.scaling?.mode ?? target?.scaling?.mode ?? "").trim(),
      formula: String(overrides.scaling?.formula ?? target?.scaling?.formula ?? "").trim()
    }
  };
}

function normalizeAbilityKey(value, fallback = "str") {
  const abilityKey = String(value ?? "").trim().toLowerCase();
  if (["str", "dex", "con", "int", "wis", "cha"].includes(abilityKey)) {
    return abilityKey;
  }
  return fallback;
}

function buildD20Formula(rollMode) {
  switch (rollMode) {
    case "advantage":
      return "2d20kh";
    case "disadvantage":
      return "2d20kl";
    case "heroicAdvantage":
      return "3d20kh";
    case "heroicDisadvantage":
      return "3d20kl";
    case "normal":
    default:
      return "1d20";
  }
}

function resolveRollMode(options = {}) {
  const hasAdvantage = options.advantage === true || options.heroicAdvantage === true;
  const hasDisadvantage = options.disadvantage === true || options.heroicDisadvantage === true;
  if (hasAdvantage && hasDisadvantage) {
    return "normal";
  }

  if (options.heroicAdvantage === true) {
    return "heroicAdvantage";
  }

  if (options.heroicDisadvantage === true) {
    return "heroicDisadvantage";
  }

  if (options.advantage === true) {
    return "advantage";
  }

  if (options.disadvantage === true) {
    return "disadvantage";
  }

  const explicit = String(options.rollMode ?? "").trim();
  if (["normal", "advantage", "disadvantage", "heroicAdvantage", "heroicDisadvantage"].includes(explicit)) {
    return explicit;
  }

  return "normal";
}

function getWeaponTypeValue(item) {
  return String(foundry.utils.getProperty(item, "system.type.value") ?? "").trim();
}

function isWeaponItem(item) {
  return item instanceof Item && item.type === "weapon";
}

function isMeleeWeaponItem(item) {
  if (!isWeaponItem(item)) {
    return false;
  }

  const typeValue = getWeaponTypeValue(item);
  return /M$/u.test(typeValue) || typeValue.includes("melee");
}

function isFirearmItem(item) {
  if (!isWeaponItem(item)) {
    return false;
  }

  const typeValue = getWeaponTypeValue(item);
  if (FIREARM_WEAPON_TYPES.has(typeValue)) {
    return true;
  }

  const firearmClassFlag = String(item.getFlag(MODULE_ID, "firearmClass") ?? "").trim();
  return Boolean(firearmClassFlag);
}

function isSimpleOrMartialWeapon(item) {
  if (!isWeaponItem(item)) {
    return false;
  }

  const typeValue = getWeaponTypeValue(item).toLowerCase();
  return typeValue.startsWith(WEAPON_TYPE_SIMPLE_PREFIX) || typeValue.startsWith(WEAPON_TYPE_MARTIAL_PREFIX);
}

function isEquippedItem(item) {
  if (!(item instanceof Item)) {
    return false;
  }

  const equipped = foundry.utils.getProperty(item, "system.equipped");
  if (typeof equipped === "boolean") {
    return equipped;
  }

  const equippedValue = foundry.utils.getProperty(item, "system.equipped.value");
  if (typeof equippedValue === "boolean") {
    return equippedValue;
  }

  return true;
}

function getItemWeightLb(item) {
  return toNumber(foundry.utils.getProperty(item, "system.weight.value"), 0);
}

function getActorAcValue(actor) {
  if (!(actor instanceof Actor)) {
    return null;
  }

  const ac = toNumber(foundry.utils.getProperty(actor, "system.attributes.ac.value"), NaN);
  return Number.isFinite(ac) ? ac : null;
}

function getActorProficiencyBonus(actor) {
  const prof = toNumber(foundry.utils.getProperty(actor, "system.attributes.prof"), NaN);
  if (Number.isFinite(prof)) {
    return prof;
  }

  const rollDataProf = toNumber(actor.getRollData?.()?.prof, 0);
  return rollDataProf;
}

function getActorAbilityModifier(actor, abilityKey) {
  const safeAbilityKey = normalizeAbilityKey(abilityKey, "str");
  const modifier = toNumber(foundry.utils.getProperty(actor, `system.abilities.${safeAbilityKey}.mod`), NaN);
  if (Number.isFinite(modifier)) {
    return modifier;
  }

  return toNumber(foundry.utils.getProperty(actor.getRollData?.(), `abilities.${safeAbilityKey}.mod`), 0);
}

function parseAttackTraitNumber(text, tags = []) {
  const safeText = String(text ?? "");
  for (const tag of tags) {
    const escapedTag = String(tag ?? "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (!escapedTag) {
      continue;
    }

    const match = safeText.match(new RegExp(`(?:^|[\\s,;|])(?:${escapedTag})\\s*(?:[:=]\\s*)?([+-]?\\d+)\\b`, "iu"));
    if (!match) {
      continue;
    }

    const value = Math.floor(toNumber(match[1], 0));
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function parseAttackTraitsText(text) {
  return {
    mku: Math.max(0, parseAttackTraitNumber(text, ["МКУ", "MKU"])),
    mu: Math.max(0, parseAttackTraitNumber(text, ["МУ", "MU"])),
    rku: Math.max(0, parseAttackTraitNumber(text, ["РКУ", "RKU"])),
    deadly: Math.max(0, parseAttackTraitNumber(text, ["Смертельное", "Смерт", "Deadly"]))
  };
}

function extractNaturalD20Result(roll) {
  const firstDie = roll?.dice?.[0] ?? null;
  if (!firstDie) {
    return null;
  }

  const activeResult = firstDie.results?.find?.((result) => {
    if (result?.discarded === true) {
      return false;
    }

    if (result?.rerolled === true) {
      return false;
    }

    return result?.active !== false;
  }) ?? null;

  if (activeResult && Number.isFinite(Number(activeResult.result))) {
    return Number(activeResult.result);
  }

  if (Number.isFinite(Number(firstDie.total))) {
    return Number(firstDie.total);
  }

  return null;
}

function extractPrimaryDiceTerm(formula) {
  const safeFormula = String(formula ?? "");
  const match = safeFormula.match(/(\d*)d(\d+)/iu);
  if (!match) {
    return null;
  }

  const number = Math.max(1, Math.floor(toNumber(match[1] || 1, 1)));
  const faces = Math.max(2, Math.floor(toNumber(match[2], 0)));
  if (!Number.isFinite(number) || !Number.isFinite(faces)) {
    return null;
  }

  return { number, faces };
}

function randomIntegerInclusive(min, max) {
  const safeMin = Math.ceil(toNumber(min, 1));
  const safeMax = Math.floor(toNumber(max, safeMin));
  const low = Math.min(safeMin, safeMax);
  const high = Math.max(safeMin, safeMax);
  const randomUniform = globalThis.CONFIG?.Dice?.randomUniform;
  const raw = typeof randomUniform === "function" ? randomUniform() : Math.random();
  return Math.floor(raw * (high - low + 1)) + low;
}

function isPromiseLike(value) {
  return value && typeof value.then === "function";
}

function convertFeetToUnits(feet, units) {
  const safeFeet = Math.max(0, toNumber(feet, 0));
  const normalizedUnits = String(units ?? "").trim().toLowerCase();
  switch (normalizedUnits) {
    case "m":
      return safeFeet * 0.3048;
    case "km":
      return safeFeet * 0.0003048;
    case "mi":
      return safeFeet / 5280;
    case "ft":
    default:
      return safeFeet;
  }
}

export class CombatAttackService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
    this._activityAttackOutcomes = new Map();
    this._pendingDeadlyExecutions = new Map();
    this._processedDeadlyWorkflowTargets = new Set();
  }

  async initialize() {
    return null;
  }

  #resolveActor(actorOrId) {
    if (actorOrId instanceof Actor) {
      return actorOrId;
    }

    const embeddedActor = actorOrId?.actor;
    if (embeddedActor instanceof Actor) {
      return embeddedActor;
    }

    if (typeof actorOrId === "string") {
      const actor = game.actors?.get?.(actorOrId) ?? null;
      if (actor instanceof Actor) {
        return actor;
      }
    }

    return null;
  }

  #resolveItem(actor, itemOrId) {
    if (!(actor instanceof Actor)) {
      return null;
    }

    if (itemOrId instanceof Item) {
      return itemOrId.parent === actor ? itemOrId : null;
    }

    if (typeof itemOrId === "string") {
      const byId = actor.items?.get?.(itemOrId) ?? null;
      if (byId instanceof Item) {
        return byId;
      }

      const normalizedName = normalizeLookupText(itemOrId);
      if (!normalizedName) {
        return null;
      }

      return actor.items?.contents?.find?.((item) => normalizeLookupText(item.name) === normalizedName) ?? null;
    }

    return null;
  }

  #resolveItemFromUuid(itemUuid) {
    const safeUuid = String(itemUuid ?? "").trim();
    if (!safeUuid) {
      return null;
    }

    try {
      const resolved = fromUuidSync(safeUuid);
      if (resolved instanceof Item) {
        return resolved;
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to resolve item UUID "${safeUuid}".`, error);
    }

    return null;
  }

  #resolveActorFromUuid(actorUuid) {
    const safeUuid = String(actorUuid ?? "").trim();
    if (!safeUuid) {
      return null;
    }

    try {
      const resolved = fromUuidSync(safeUuid);
      if (resolved instanceof Actor) {
        return resolved;
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to resolve actor UUID "${safeUuid}".`, error);
    }

    return null;
  }

  #resolveFirearmAbilityKey(item, fallback = "dex") {
    if (!isFirearmItem(item)) {
      return normalizeAbilityKey(fallback, "dex");
    }

    const weight = getItemWeightLb(item);
    if (weight > FIREARM_WEIGHT_THRESHOLD_LB) {
      return "str";
    }

    return "dex";
  }

  #resolveAttackAbilityKey(actor, item, options = {}) {
    if (options.abilityKey) {
      return normalizeAbilityKey(options.abilityKey, "str");
    }

    if (isFirearmItem(item)) {
      return this.#resolveFirearmAbilityKey(item, "dex");
    }

    const explicitAbility = String(
      foundry.utils.getProperty(item, "system.ability")
      ?? foundry.utils.getProperty(item, "system.ability.value")
      ?? ""
    ).trim();
    if (explicitAbility) {
      return normalizeAbilityKey(explicitAbility, "str");
    }

    if (isMeleeWeaponItem(item)) {
      return "str";
    }

    return "dex";
  }

  #hasItemProperty(item, propertyKey) {
    const safePropertyKey = String(propertyKey ?? "").trim();
    if (!safePropertyKey) {
      return false;
    }

    const properties = foundry.utils.getProperty(item, "system.properties");
    const propertyValue = foundry.utils.getProperty(item, "system.properties.value");

    if (Array.isArray(propertyValue) && propertyValue.includes(safePropertyKey)) {
      return true;
    }

    if (propertyValue instanceof Set && propertyValue.has(safePropertyKey)) {
      return true;
    }

    if (properties instanceof Set) {
      return properties.has(safePropertyKey);
    }

    if (Array.isArray(properties)) {
      return properties.includes(safePropertyKey);
    }

    if (typeof properties?.has === "function") {
      return properties.has(safePropertyKey);
    }

    if (properties && typeof properties === "object") {
      if (Object.hasOwn(properties, safePropertyKey)) {
        return Boolean(properties[safePropertyKey]);
      }

      return Object.values(properties).some((value) => value === safePropertyKey);
    }

    return false;
  }

  #getLichWeaponPropertyValues(item, options = {}) {
    const explicit = options.lichWeaponPropertyValues;
    if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
      return explicit;
    }

    const fromItem = item.getFlag(MODULE_ID, "lichWeaponPropertyValues");
    if (fromItem && typeof fromItem === "object" && !Array.isArray(fromItem)) {
      return fromItem;
    }

    return {};
  }

  #resolveMinimumStrengthRequirement(actor, item, options = {}) {
    const explicit = toNumber(options.minStrength, NaN);
    if (Number.isFinite(explicit)) {
      return Math.max(0, Math.floor(explicit));
    }

    if (!this.#hasItemProperty(item, "lchStrReq")) {
      return 0;
    }

    const values = this.#getLichWeaponPropertyValues(item, options);
    const minStrength = toNumber(values.minStrength, NaN);
    if (Number.isFinite(minStrength)) {
      return Math.max(0, Math.floor(minStrength));
    }

    return 0;
  }

  #isAttackProficient(actor, item, options = {}) {
    if (options.includeProficiency === false) {
      return false;
    }

    if (typeof options.proficient === "boolean") {
      return options.proficient;
    }

    const explicit = foundry.utils.getProperty(item, "system.proficient");
    if (typeof explicit === "boolean") {
      return explicit;
    }

    const explicitValue = foundry.utils.getProperty(item, "system.proficient.value");
    if (typeof explicitValue === "boolean") {
      return explicitValue;
    }

    const actorFlag = actor.getFlag(MODULE_ID, "alwaysUntrainedAttacks");
    if (actorFlag === true) {
      return false;
    }

    const minStrengthRequirement = this.#resolveMinimumStrengthRequirement(actor, item, options);
    if (minStrengthRequirement > 0) {
      const actorStrengthScore = Math.floor(toNumber(foundry.utils.getProperty(actor, "system.abilities.str.value"), 0));
      if (actorStrengthScore < minStrengthRequirement) {
        return false;
      }
    }

    return true;
  }

  #getAttackTraits(item, options = {}) {
    const traitText = String(
      options.attackTraitsText
      ?? item.getFlag(MODULE_ID, "attackTraitsText")
      ?? item.getFlag(MODULE_ID, "attackProperties")
      ?? ""
    ).trim();
    const parsedTextTraits = parseAttackTraitsText(traitText);

    const flagTraits = item.getFlag(MODULE_ID, "attackTraits");
    const actorTraits = item.actor?.getFlag?.(MODULE_ID, "racialAttackTraits");
    const lichValues = this.#getLichWeaponPropertyValues(item, options);
    const explicitTraits = options.attackTraits && typeof options.attackTraits === "object"
      ? options.attackTraits
      : null;
    const hasAnyLichAttackTraitProperty = (
      this.#hasItemProperty(item, "lchMku")
      || this.#hasItemProperty(item, "lchMu")
      || this.#hasItemProperty(item, "lchRku")
      || this.#hasItemProperty(item, "lchDeadly")
    );
    const normalizeTraitNumber = (value) => Math.max(0, Math.floor(toNumber(value, 0)));

    const resolveTraitValue = (traitKey, propertyKey, parsedFallback) => {
      const explicitValue = toNumber(explicitTraits?.[traitKey], NaN);
      if (Number.isFinite(explicitValue)) {
        return normalizeTraitNumber(explicitValue);
      }

      const hasProperty = this.#hasItemProperty(item, propertyKey);
      const allowLegacyFallback = !hasAnyLichAttackTraitProperty;
      if (!hasProperty && !allowLegacyFallback) {
        return 0;
      }

      return normalizeTraitNumber(
        toNumber(
          flagTraits?.[traitKey],
          toNumber(lichValues?.[traitKey], parsedFallback)
        )
      );
    };

    const itemTraits = {
      mku: resolveTraitValue("mku", "lchMku", parsedTextTraits.mku),
      mu: resolveTraitValue("mu", "lchMu", parsedTextTraits.mu),
      rku: resolveTraitValue("rku", "lchRku", parsedTextTraits.rku),
      deadly: resolveTraitValue("deadly", "lchDeadly", parsedTextTraits.deadly)
    };

    return {
      mku: Math.max(itemTraits.mku, normalizeTraitNumber(actorTraits?.mku)),
      mu: Math.max(itemTraits.mu, normalizeTraitNumber(actorTraits?.mu)),
      rku: Math.max(itemTraits.rku, normalizeTraitNumber(actorTraits?.rku)),
      deadly: Math.max(itemTraits.deadly, normalizeTraitNumber(actorTraits?.deadly))
    };
  }

  #resolveReachBonusFeet(item, options = {}) {
    const explicit = toNumber(options.reachBonusFeet, NaN);
    if (Number.isFinite(explicit)) {
      return Math.max(0, explicit);
    }
    const actorBonus = toNumber(item.actor?.getFlag?.(MODULE_ID, "racialReachBonusFeet"), NaN);

    if (!this.#hasItemProperty(item, "lchReach")) {
      return Number.isFinite(actorBonus) ? Math.max(0, actorBonus) : 0;
    }

    const values = this.#getLichWeaponPropertyValues(item, options);
    const parsed = toNumber(values.reachBonus, NaN);
    const itemBonus = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;

    return Math.max(itemBonus, Number.isFinite(actorBonus) ? Math.max(0, actorBonus) : 0);
  }

  #getLichAutomationState(item, options = {}) {
    const attackTraits = this.#getAttackTraits(item, options);
    return {
      ...attackTraits,
      reachBonusFeet: this.#resolveReachBonusFeet(item, options)
    };
  }

  #isFirearmJammed(item) {
    if (!isFirearmItem(item)) {
      return false;
    }

    const state = readDocumentFlag(item, MODULE_ID, FIREARM_JAMMED_FLAG);
    if (state === true) {
      return true;
    }

    return state?.value === true;
  }

  #resolveFirearmMisfireThreshold(item, options = {}) {
    if (!isFirearmItem(item)) {
      return 0;
    }

    const explicit = toNumber(options.firearmMisfire ?? options.misfire, NaN);
    if (Number.isFinite(explicit)) {
      return clampInteger(explicit, 0, 20);
    }

    const directFlag = toNumber(readDocumentFlag(item, MODULE_ID, FIREARM_CURRENT_MISFIRE_FLAG), NaN);
    if (Number.isFinite(directFlag)) {
      return clampInteger(directFlag, 0, 20);
    }

    const values = this.#getLichWeaponPropertyValues(item, options);
    const fromValues = toNumber(values.misfire ?? values.firearmMisfire, NaN);
    if (this.#hasItemProperty(item, FIREARM_MISFIRE_PROPERTY)) {
      return clampInteger(Number.isFinite(fromValues) ? fromValues : 1, 1, 20);
    }

    if (this.#hasItemProperty(item, FIREARM_RUST_PROPERTY)) {
      return 1;
    }

    return 0;
  }

  #evaluateFirearmMisfireDie(options = {}) {
    const explicit = toNumber(options.firearmMisfireRoll ?? options.misfireRoll, NaN);
    if (Number.isFinite(explicit)) {
      return {
        roll: null,
        total: clampInteger(explicit, 1, 20)
      };
    }

    let roll = null;
    try {
      roll = new Roll(FIREARM_MISFIRE_DIE_FORMULA);
      if (typeof roll.evaluateSync === "function") {
        roll.evaluateSync();
      }
      else if (typeof roll.evaluate === "function") {
        const evaluated = roll.evaluate({ async: false });
        if (isPromiseLike(evaluated)) {
          roll = null;
        }
      }

      const total = toNumber(roll?.total, NaN);
      if (Number.isFinite(total)) {
        return {
          roll,
          total: clampInteger(total, 1, 20)
        };
      }
    }
    catch (_error) {
      roll = null;
    }

    return {
      roll: null,
      total: randomIntegerInclusive(1, 20)
    };
  }

  #writeItemFlag(item, key, value) {
    try {
      item.flags ??= {};
      item.flags[MODULE_ID] ??= {};
      item.flags[MODULE_ID][key] = value;
    }
    catch (_error) {
      // Foundry persists the flag through setFlag below; direct mutation is only for same-tick reads.
    }

    if (typeof item?.setFlag === "function") {
      Promise.resolve(item.setFlag(MODULE_ID, key, value)).catch((error) => {
        console.error(`${MODULE_ID} | Failed to set item flag "${key}".`, error);
      });
    }
  }

  #clearItemFlag(item, key) {
    try {
      if (item.flags?.[MODULE_ID]) {
        delete item.flags[MODULE_ID][key];
      }
    }
    catch (_error) {
      // Foundry persists the flag removal through unsetFlag below.
    }

    if (typeof item?.unsetFlag === "function") {
      return item.unsetFlag(MODULE_ID, key);
    }

    return item?.update?.({ [`flags.${MODULE_ID}.${key}`]: null }) ?? Promise.resolve(item);
  }

  async #setItemFlag(item, key, value) {
    try {
      item.flags ??= {};
      item.flags[MODULE_ID] ??= {};
      item.flags[MODULE_ID][key] = value;
    }
    catch (_error) {
      // Foundry persists the flag through setFlag or update below.
    }

    if (typeof item?.setFlag === "function") {
      return item.setFlag(MODULE_ID, key, value);
    }

    return item?.update?.({ [`flags.${MODULE_ID}.${key}`]: value }) ?? item;
  }

  async #unsetItemFlag(item, key) {
    try {
      if (item.flags?.[MODULE_ID]) {
        delete item.flags[MODULE_ID][key];
      }
    }
    catch (_error) {
      // Foundry persists the flag removal through unsetFlag or update below.
    }

    if (typeof item?.unsetFlag === "function") {
      return item.unsetFlag(MODULE_ID, key);
    }

    return item?.update?.({ [`flags.${MODULE_ID}.${key}`]: null }) ?? item;
  }

  #writeItemName(item, name) {
    const nextName = cleanText(name, item?.name ?? "");
    if (!nextName || item?.name === nextName) {
      return;
    }

    try {
      item.name = nextName;
    }
    catch (_error) {
      // Foundry persists the name through update below.
    }

    if (typeof item?.update === "function") {
      Promise.resolve(item.update({ name: nextName })).catch((error) => {
        console.error(`${MODULE_ID} | Failed to update item name.`, error);
      });
    }
  }

  async #setItemName(item, name) {
    const nextName = cleanText(name, item?.name ?? "");
    if (!nextName || item?.name === nextName) {
      return item;
    }

    try {
      item.name = nextName;
    }
    catch (_error) {
      // Foundry persists the name through update below.
    }

    return item?.update?.({ name: nextName }) ?? item;
  }

  #resolveFirearmBaseMisfireThreshold(item, fallback = 1) {
    const baseFlag = toNumber(readDocumentFlag(item, MODULE_ID, FIREARM_BASE_MISFIRE_FLAG), NaN);
    if (Number.isFinite(baseFlag)) {
      return clampInteger(baseFlag, 1, 10);
    }

    const values = this.#getLichWeaponPropertyValues(item);
    const configured = toNumber(values.misfire ?? values.firearmMisfire, NaN);
    if (this.#hasItemProperty(item, FIREARM_MISFIRE_PROPERTY) && Number.isFinite(configured)) {
      return clampInteger(configured, 1, 10);
    }

    if (this.#hasItemProperty(item, FIREARM_RUST_PROPERTY)) {
      return 1;
    }

    return clampInteger(fallback, 1, 10);
  }

  #rememberFirearmBaseMisfire(item, currentThreshold) {
    const existing = toNumber(readDocumentFlag(item, MODULE_ID, FIREARM_BASE_MISFIRE_FLAG), NaN);
    if (Number.isFinite(existing)) {
      return;
    }

    this.#writeItemFlag(
      item,
      FIREARM_BASE_MISFIRE_FLAG,
      this.#resolveFirearmBaseMisfireThreshold(item, currentThreshold)
    );
  }

  #markFirearmNameJammed(item) {
    this.#writeItemName(item, withFirearmJamSuffix(item?.name));
  }

  #createFirearmMisfireMessage(actor, item, result, options = {}) {
    if (options.createMessage === false) {
      return;
    }

    const weaponName = item?.name ?? "Оружие";
    const threshold = Math.max(1, Math.floor(toNumber(result?.threshold, 1)));
    const rollTotal = Math.max(1, Math.floor(toNumber(result?.rollTotal, 1)));
    const flavor = result?.jammed === true
      ? `${weaponName}: Осечка ${threshold} - оружие заклинено`
      : `${weaponName}: проверка осечки ${threshold}`;

    try {
      if (result?.roll && typeof result.roll.toMessage === "function") {
        Promise.resolve(result.roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor
        })).catch((error) => {
          console.error(`${MODULE_ID} | Failed to create firearm misfire roll message.`, error);
        });
        return;
      }

      const userId = String(game.user?.id ?? "").trim();
      if (typeof ChatMessage?.create === "function" && userId) {
        const outcome = result?.jammed === true ? "заклинено" : "без осечки";
        Promise.resolve(ChatMessage.create({
          user: userId,
          speaker: ChatMessage.getSpeaker?.({ actor }) ?? {},
          content: `${weaponName}: Осечка ${threshold}, d20 = ${rollTotal} (${outcome})`
        })).catch((error) => {
          console.error(`${MODULE_ID} | Failed to create firearm misfire chat message.`, error);
        });
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to create firearm misfire chat message.`, error);
    }
  }

  #notifyFirearmJammed(item) {
    const weaponName = item?.name ?? "Оружие";
    ui.notifications?.warn?.(`${weaponName}: оружие заклинено. Устраните осечку перед выстрелом.`);
  }

  #jamFirearm(actor, item, result, options = {}) {
    this.#rememberFirearmBaseMisfire(item, result.threshold);
    this.#markFirearmNameJammed(item);
    const jamState = {
      value: true,
      threshold: result.threshold,
      rollTotal: result.rollTotal,
      jammedAt: new Date().toISOString()
    };
    this.#writeItemFlag(item, FIREARM_JAMMED_FLAG, jamState);
    this.#createFirearmMisfireMessage(actor, item, { ...result, jammed: true }, options);
    this.#notifyFirearmJammed(item);
  }

  #rollFirearmMisfire(actor, item, options = {}) {
    const threshold = this.#resolveFirearmMisfireThreshold(item, options);
    if (threshold <= 0) {
      return {
        checked: false,
        jammed: false,
        threshold: 0,
        rollTotal: null
      };
    }

    const { roll, total } = this.#evaluateFirearmMisfireDie(options);
    const result = {
      checked: true,
      jammed: total <= threshold,
      threshold,
      rollTotal: total,
      roll
    };

    if (result.jammed) {
      this.#jamFirearm(actor, item, result, options);
    }
    else {
      this.#createFirearmMisfireMessage(actor, item, result, options);
    }

    return result;
  }

  #blockJammedFirearm(item) {
    if (!this.#isFirearmJammed(item)) {
      return false;
    }

    this.#notifyFirearmJammed(item);
    return true;
  }

  #applyDeadlyExecution(actor, deadlyValue, context = {}) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    const deadly = Math.max(0, Math.floor(toNumber(deadlyValue, 0)));
    if (deadly <= 0) {
      return false;
    }

    const damageAmount = toNumber(context.damageAmount, 0);
    if (damageAmount <= 0) {
      return false;
    }

    const currentHp = toNumber(foundry.utils.getProperty(actor, "system.attributes.hp.value"), NaN);
    if (!Number.isFinite(currentHp) || currentHp <= 0 || currentHp > deadly) {
      return false;
    }

    actor.update({
      "system.attributes.hp.value": 0
    }).then(() => {
      this.#createDeadlyExecutionChatMessage(deadly);
    }).catch((error) => {
      console.error(`${MODULE_ID} | Failed to apply deadly execution damage update.`, error);
    });

    return true;
  }

  #createDeadlyExecutionChatMessage(deadlyValue) {
    const deadly = Math.max(0, Math.floor(toNumber(deadlyValue, 0)));
    if (deadly <= 0) {
      return;
    }

    const userId = String(game.user?.id ?? "").trim();
    if (!userId || typeof ChatMessage?.create !== "function") {
      return;
    }

    const content = `Смертельное ${deadly}: хиты опущены до 0`;
    ChatMessage.create({
      user: userId,
      content
    }).catch((error) => {
      console.error(`${MODULE_ID} | Failed to create deadly execution chat message.`, error);
    });
  }

  #buildWorkflowTargetKey(workflow, targetActorUuid) {
    const workflowId = String(
      workflow?.id
      ?? workflow?.uuid
      ?? workflow?.itemCardUuid
      ?? ""
    ).trim();
    const targetUuid = String(targetActorUuid ?? "").trim();
    if (!workflowId || !targetUuid) {
      return "";
    }

    return `${workflowId}::${targetUuid}`;
  }

  #markWorkflowTargetProcessed(workflow, targetActorUuid) {
    const key = this.#buildWorkflowTargetKey(workflow, targetActorUuid);
    if (!key) {
      return;
    }

    this._processedDeadlyWorkflowTargets.add(key);
    if (this._processedDeadlyWorkflowTargets.size > 5000) {
      const entries = Array.from(this._processedDeadlyWorkflowTargets.values());
      this._processedDeadlyWorkflowTargets = new Set(entries.slice(-2500));
    }
  }

  #wasWorkflowTargetProcessed(workflow, targetActorUuid) {
    const key = this.#buildWorkflowTargetKey(workflow, targetActorUuid);
    if (!key) {
      return false;
    }

    return this._processedDeadlyWorkflowTargets.has(key);
  }

  #isWeaponAttackActivity(activity) {
    if (!activity) {
      return false;
    }

    const item = activity.item ?? null;
    if (!isWeaponItem(item)) {
      return false;
    }

    const activityType = String(activity.type ?? "").trim().toLowerCase();
    return activityType === "attack";
  }

  #resolveRequiredHands(activity) {
    const explicitRequirement = readRequiredHands(activity) ?? readRequiredHands(activity?.item);
    if (explicitRequirement !== undefined && explicitRequirement !== null && explicitRequirement !== "") {
      return clampInteger(toNumber(explicitRequirement, 1), 0, 99);
    }

    return this.#hasItemProperty(activity?.item, "two") ? 2 : 1;
  }

  #hasAttackMode(item, attackMode) {
    const safeAttackMode = String(attackMode ?? "").trim();
    if (!safeAttackMode) {
      return false;
    }

    const attackModes = collectionValues(foundry.utils.getProperty(item, "system.attackModes"));
    if (!attackModes.length) {
      return true;
    }

    return attackModes.some((mode) => String(mode?.value ?? mode ?? "").trim() === safeAttackMode);
  }

  #isHeldVersatileTwoHandedAttack(activity) {
    const item = activity?.item ?? null;
    if (!item || getItemHeldHands(item).length < 2) {
      return false;
    }

    const handRequirement = readDocumentFlag(item, MODULE_ID, "handRequirement");
    const isVersatile = foundry.utils.getProperty(item, "system.isVersatile") === true
      || this.#hasItemProperty(item, "ver")
      || (isPlainObject(handRequirement) && handRequirement.versatile === true);
    return isVersatile && this.#hasAttackMode(item, "twoHanded");
  }

  #applyHeldWeaponAttackMode(activity, usageConfig = {}) {
    if (!this.#isHeldVersatileTwoHandedAttack(activity)) {
      return;
    }

    usageConfig.attackMode = "twoHanded";
    const activityId = cleanText(activity?.id ?? activity?._id);
    if (activityId) {
      writeDocumentFlagSource(activity.item, "dnd5e", `last.${activityId}.attackMode`, "twoHanded");
    }
  }

  #ensureHeldWeaponActivity(activity) {
    const item = activity?.item ?? null;
    const actor = activity?.actor ?? item?.actor ?? item?.parent ?? null;
    const requiredHands = this.#resolveRequiredHands(activity);
    const result = canUseHeldItemForHandRequirement(actor, item, { requiredHands });
    if (result.ok) {
      return true;
    }

    const itemName = cleanText(item?.name, "предмет");
    const message = requiredHands > 1
      ? `Чтобы использовать "${itemName}", возьмите предмет в ${requiredHands} руки.`
      : `Чтобы использовать "${itemName}", возьмите предмет в руку.`;
    ui.notifications?.warn?.(message);
    return false;
  }

  #resolveActivityKey(activity) {
    if (!activity) {
      return "";
    }

    const explicitUuid = String(activity.uuid ?? "").trim();
    if (explicitUuid) {
      return explicitUuid;
    }

    const actorUuid = String(activity.actor?.uuid ?? activity.item?.actor?.uuid ?? "").trim();
    const itemUuid = String(activity.item?.uuid ?? "").trim();
    const activityId = String(activity.id ?? activity._id ?? "").trim();
    return [actorUuid, itemUuid, activityId].filter(Boolean).join("::");
  }

  #rememberActivityAttackOutcome(activity, data = {}) {
    const key = this.#resolveActivityKey(activity);
    if (!key) {
      return;
    }

    const timestamp = Date.now();
    this._activityAttackOutcomes.set(key, {
      ...data,
      timestamp
    });

    const maxAgeMs = 120000;
    for (const [entryKey, entry] of this._activityAttackOutcomes.entries()) {
      const entryTimestamp = Number(entry?.timestamp ?? 0);
      if (!Number.isFinite(entryTimestamp) || ((timestamp - entryTimestamp) > maxAgeMs)) {
        this._activityAttackOutcomes.delete(entryKey);
      }
    }
  }

  #readActivityAttackOutcome(activity, options = {}) {
    const key = this.#resolveActivityKey(activity);
    if (!key) {
      return null;
    }

    const stored = this._activityAttackOutcomes.get(key) ?? null;
    if (!stored) {
      return null;
    }

    const maxAgeMs = Math.max(1000, Math.floor(toNumber(options.maxAgeMs, 45000)));
    const timestamp = Number(stored.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || ((Date.now() - timestamp) > maxAgeMs)) {
      this._activityAttackOutcomes.delete(key);
      return null;
    }

    return stored;
  }

  #buildDeadlyExecutionKey(sourceActorUuid, targetActorUuid) {
    const source = String(sourceActorUuid ?? "").trim();
    const target = String(targetActorUuid ?? "").trim();
    if (!source || !target) {
      return "";
    }

    return `${source}::${target}`;
  }

  #rememberPendingDeadlyExecution(sourceActorUuid, targetActorUuid, deadlyValue, options = {}) {
    const key = this.#buildDeadlyExecutionKey(sourceActorUuid, targetActorUuid);
    if (!key) {
      return;
    }

    const deadly = Math.max(0, Math.floor(toNumber(deadlyValue, 0)));
    if (deadly <= 0) {
      return;
    }

    const now = Date.now();
    const usesLeft = Math.max(1, Math.floor(toNumber(options.usesLeft, 3)));
    const sourceItemUuid = String(options.sourceItemUuid ?? "").trim();

    this._pendingDeadlyExecutions.set(key, {
      deadly,
      sourceItemUuid,
      usesLeft,
      timestamp: now
    });

    const maxAgeMs = 120000;
    for (const [entryKey, entry] of this._pendingDeadlyExecutions.entries()) {
      const entryTimestamp = Number(entry?.timestamp ?? 0);
      if (!Number.isFinite(entryTimestamp) || ((now - entryTimestamp) > maxAgeMs)) {
        this._pendingDeadlyExecutions.delete(entryKey);
      }
    }
  }

  #takePendingDeadlyExecution(sourceActorUuid, targetActorUuid, options = {}) {
    const key = this.#buildDeadlyExecutionKey(sourceActorUuid, targetActorUuid);
    if (!key) {
      return 0;
    }

    const entry = this._pendingDeadlyExecutions.get(key) ?? null;
    if (!entry) {
      return 0;
    }

    const maxAgeMs = Math.max(1000, Math.floor(toNumber(options.maxAgeMs, 8000)));
    const now = Date.now();
    const timestamp = Number(entry.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || ((now - timestamp) > maxAgeMs)) {
      this._pendingDeadlyExecutions.delete(key);
      return 0;
    }

    const deadly = Math.max(0, Math.floor(toNumber(entry.deadly, 0)));
    if (deadly <= 0) {
      this._pendingDeadlyExecutions.delete(key);
      return 0;
    }

    const decrement = options.decrement !== false;
    if (decrement) {
      const nextUses = Math.max(0, Math.floor(toNumber(entry.usesLeft, 1)) - 1);
      if (nextUses <= 0) {
        this._pendingDeadlyExecutions.delete(key);
      }
      else {
        this._pendingDeadlyExecutions.set(key, {
          ...entry,
          usesLeft: nextUses,
          timestamp: now
        });
      }
    }

    return deadly;
  }

  #isFighterDominanceManeuverActivity(activity) {
    if (readDocumentFlag(activity, MODULE_ID, "automation") === "fighter-dominance-maneuver") {
      return true;
    }

    if (readDocumentFlag(activity, MODULE_ID, "fighterAutomation")?.kind === "maneuver") {
      return true;
    }

    return this.#isFighterManeuverItem(activity?.item);
  }

  #isFighterManeuverItem(item) {
    const sourceType = String(readDocumentFlag(item, MODULE_ID, "sourceType") ?? "").trim();
    if (sourceType === "fighterManeuver") {
      return true;
    }

    if (String(foundry.utils.getProperty(item, "system.type.subtype") ?? "").trim() === "fighterManeuver") {
      return true;
    }

    const identifier = String(foundry.utils.getProperty(item, "system.identifier") ?? "").trim().toLowerCase();
    if (identifier.includes("fighter-rework-v028") && identifier.includes("maneuver")) {
      return true;
    }

    const rebreyaSection = normalizeLookupText(readDocumentFlag(item, MODULE_ID, "section"));
    const teyvankalSection = normalizeLookupText(foundry.utils.getProperty(item, "flags.teyvankal.section"));
    if (rebreyaSection === "воинские приёмы" || teyvankalSection === "воинские приёмы") {
      return true;
    }

    const featureId = String(readDocumentFlag(item, MODULE_ID, "featureId") ?? "").trim();
    if (featureId.includes("::fighterManeuver::")) {
      return true;
    }

    return readDocumentFlag(item, MODULE_ID, "automation")?.type === "fighterManeuver";
  }

  #fighterManeuverClassIdentifier(activity) {
    return String(
      readDocumentFlag(activity?.item, MODULE_ID, "classIdentifier")
      ?? readDocumentFlag(activity, MODULE_ID, "classIdentifier")
      ?? ""
    ).trim();
  }

  #fighterManeuverAutomation(activity) {
    const directAutomation = readDocumentFlag(activity, MODULE_ID, "fighterAutomation")
      ?? readDocumentFlag(activity?.item, MODULE_ID, "fighterAutomation");
    if (directAutomation?.kind === "maneuver") {
      return directAutomation;
    }

    if (!this.#isFighterManeuverItem(activity?.item)) {
      return null;
    }

    return getFighterManeuverAutomation(
      activity?.item?.name ?? activity?.name,
      this.#fighterManeuverClassIdentifier(activity)
    );
  }

  #resolveFighterDominanceItem(actor, classIdentifier = "") {
    const normalizedClassIdentifier = String(classIdentifier ?? "").trim();
    return collectionValues(actor?.items).find((item) => {
      const featureId = String(readDocumentFlag(item, MODULE_ID, "featureId") ?? "").trim();
      if (featureId === `${normalizedClassIdentifier}::class::${FIGHTER_DOMINANCE_TARGET}`) {
        return true;
      }

      if (!normalizedClassIdentifier && featureId.endsWith(`::class::${FIGHTER_DOMINANCE_TARGET}`)) {
        return true;
      }

      const identifier = String(foundry.utils.getProperty(item, "system.identifier") ?? "").trim();
      if (identifier === FIGHTER_DOMINANCE_TARGET || identifier.endsWith(`-${FIGHTER_DOMINANCE_TARGET}`)) {
        return true;
      }

      return normalizeLookupText(item?.name) === "стиль доминирования";
    }) ?? null;
  }

  #syncUsageConsumptionConfig(usageConfig = {}, messageConfig = {}, indexes = []) {
    if (!indexes.length) {
      return;
    }

    if (usageConfig.consume !== false) {
      usageConfig.consume ??= {};
      usageConfig.consume.resources = indexes;
    }
    usageConfig.hasConsumption = true;
    messageConfig.hasConsumption = true;
  }

  #applyActivitySourcePatch(activity, patch) {
    if (!isPlainObject(patch) || !Object.keys(patch).length) {
      return;
    }

    if (typeof activity?.updateSource === "function") {
      activity.updateSource(patch);
      return;
    }

    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(activity, path, value);
    }
  }

  #retargetFighterDominanceConsumption(activity, usageConfig = {}, messageConfig = {}) {
    if (!this.#isFighterDominanceManeuverActivity(activity)) {
      return;
    }

    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    if (!actor?.items) {
      return;
    }

    const classIdentifier = this.#fighterManeuverClassIdentifier(activity);
    const dominanceItem = this.#resolveFighterDominanceItem(actor, classIdentifier);
    const dominanceItemId = dominanceItem?.id ?? dominanceItem?._id ?? "";
    if (!dominanceItemId) {
      return;
    }

    const allTargets = activityConsumptionTargets(activity);
    const resourceTargetIndexes = [];
    let nextTargets = [];
    if (!allTargets.length) {
      resourceTargetIndexes.push(0);
      nextTargets = [consumptionTargetData(null, {
        type: "itemUses",
        target: dominanceItemId
      })];
      this.#applyActivitySourcePatch(activity, { "consumption.targets": nextTargets });
      this.#syncUsageConsumptionConfig(usageConfig, messageConfig, resourceTargetIndexes);
      return;
    }

    let changed = false;
    nextTargets = allTargets.map((target, index) => {
      const type = String(target?.type ?? "").trim();
      if (type !== "itemUses" && type !== "activityUses") {
        return consumptionTargetData(target);
      }

      resourceTargetIndexes.push(index);
      if (type !== "itemUses" || target.target !== dominanceItemId) {
        changed = true;
      }

      try {
        target.type = "itemUses";
        target.target = dominanceItemId;
      }
      catch (_error) {
        // DataModel fields are synced below through updateSource when direct assignment is unavailable.
      }

      return consumptionTargetData(target, {
        type: "itemUses",
        target: dominanceItemId
      });
    });

    if (!resourceTargetIndexes.length) {
      resourceTargetIndexes.push(nextTargets.length);
      nextTargets.push(consumptionTargetData(null, {
        type: "itemUses",
        target: dominanceItemId
      }));
      changed = true;
    }

    if (changed) {
      this.#applyActivitySourcePatch(activity, { "consumption.targets": nextTargets });
    }
    this.#syncUsageConsumptionConfig(usageConfig, messageConfig, resourceTargetIndexes);
  }

  #normalizeFighterManeuverTargeting(activity) {
    if (!this.#isFighterDominanceManeuverActivity(activity)) {
      return;
    }

    const fighterAutomation = this.#fighterManeuverAutomation(activity);
    if (!fighterAutomation?.extraDamage && !fighterAutomation?.status) {
      return;
    }

    foundry.utils.setProperty(activity, "range.units", "");
    foundry.utils.setProperty(activity, "target.affects.type", "creature");
    foundry.utils.setProperty(activity, "target.prompt", true);
  }

  #applyFirearmUtilityActivity(activity) {
    const automation = cleanText(foundry.utils.getProperty(activity, `flags.${MODULE_ID}.automation`));
    if (![FIREARM_CLEAR_JAM_AUTOMATION, FIREARM_MAINTAIN_AUTOMATION].includes(automation)) {
      return null;
    }

    const item = activity?.item ?? null;
    if (!isFirearmItem(item)) {
      return true;
    }

    const actor = activity?.actor ?? item.actor ?? null;
    if (automation === FIREARM_CLEAR_JAM_AUTOMATION) {
      this.clearFirearmJam(item).catch((error) => {
        console.error(`${MODULE_ID} | Failed to clear firearm jam from activity.`, error);
        ui.notifications?.error?.("Не удалось очистить затвор.");
      });
      return false;
    }

    this.maintainFirearm(item, null, { actor }).catch((error) => {
      console.error(`${MODULE_ID} | Failed to maintain firearm from activity.`, error);
      ui.notifications?.error?.("Не удалось привести оружие в порядок.");
    });
    return false;
  }

  applyDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const firearmUtilityResult = this.#applyFirearmUtilityActivity(activity);
    if (firearmUtilityResult !== null) {
      return firearmUtilityResult;
    }

    this.#retargetFighterDominanceConsumption(activity, usageConfig, messageConfig);
    this.#normalizeFighterManeuverTargeting(activity);

    if (!this.#isWeaponAttackActivity(activity)) {
      return true;
    }

    try {
      const item = activity.item;
      if (this.#blockJammedFirearm(item)) {
        return false;
      }

      if (!this.#ensureHeldWeaponActivity(activity)) {
        return false;
      }

      this.#applyHeldWeaponAttackMode(activity, usageConfig);

      const automation = this.#getLichAutomationState(item);
      if (automation.reachBonusFeet <= 0) {
        return true;
      }

      const attackType = String(foundry.utils.getProperty(activity, "attack.type.value") ?? "").trim().toLowerCase();
      if (attackType && attackType !== "melee") {
        return true;
      }

      const itemRangeUnits = String(foundry.utils.getProperty(item, "system.range.units") ?? "ft").trim().toLowerCase();
      const itemReachRaw = toNumber(foundry.utils.getProperty(item, "system.range.reach"), NaN);
      const baseReach = Number.isFinite(itemReachRaw)
        ? Math.max(0, itemReachRaw)
        : convertFeetToUnits(5, itemRangeUnits);
      const reachBonusInItemUnits = convertFeetToUnits(automation.reachBonusFeet, itemRangeUnits);
      const nextReach = Math.max(0, baseReach + reachBonusInItemUnits);

      foundry.utils.setProperty(activity, "range.reach", nextReach);
      if (!foundry.utils.getProperty(activity, "range.units")) {
        foundry.utils.setProperty(activity, "range.units", itemRangeUnits || "ft");
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply pre-use attack automation.`, error);
    }

    return true;
  }

  applyDnd5eAttackRollConfig(config = {}, dialog = {}, message = {}) {
    const activity = config?.subject ?? null;
    if (!this.#isWeaponAttackActivity(activity)) {
      return true;
    }

    try {
      const item = activity.item;
      if (this.#blockJammedFirearm(item)) {
        return false;
      }

      const misfire = this.#rollFirearmMisfire(activity.actor ?? item.actor ?? null, item, config);
      if (misfire.jammed) {
        return false;
      }

      const automation = this.#getLichAutomationState(item);
      const rku = Math.max(0, Math.floor(toNumber(automation.rku, 0)));
      if (rku <= 0) {
        return true;
      }

      const baseThreshold = clampInteger(toNumber(activity.criticalThreshold, 20), 2, 20);
      const rkuThreshold = clampInteger(baseThreshold - rku, 2, 20);

      // Important: do not lower `criticalSuccess` directly.
      // In dnd5e/MIDI that value can turn non-20 results into auto-hit.
      for (const rollConfig of config?.rolls ?? []) {
        rollConfig.options ??= {};
        rollConfig.options.rebreyaRkuThreshold = rkuThreshold;
      }

      this.#rememberActivityAttackOutcome(activity, {
        rku,
        rkuThreshold,
        source: "dnd5e.preRollAttack"
      });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply attack roll automation.`, error);
    }

    return true;
  }

  applyDnd5ePostAttackRoll(rolls = [], context = {}) {
    const activity = context?.subject ?? null;
    if (!this.#isWeaponAttackActivity(activity)) {
      return true;
    }

    try {
      const item = activity.item;
      const automation = this.#getLichAutomationState(item);
      const rku = Math.max(0, Math.floor(toNumber(automation.rku, 0)));
      if (rku <= 0) {
        return true;
      }

      const firstRoll = Array.isArray(rolls) ? (rolls[0] ?? null) : (rolls ?? null);
      if (!firstRoll) {
        return true;
      }

      const baseThreshold = clampInteger(toNumber(activity.criticalThreshold, 20), 2, 20);
      const rkuThreshold = clampInteger(baseThreshold - rku, 2, 20);
      const naturalRoll = extractNaturalD20Result(firstRoll);
      const targetAc = toNumber(firstRoll?.options?.target, NaN);
      const hasTargetAc = Number.isFinite(targetAc);
      const isFumble = firstRoll?.isFumble === true;
      const isHitByTarget = hasTargetAc
        ? (!isFumble && (toNumber(firstRoll?.total, -Infinity) >= targetAc))
        : null;
      const rkuCriticalOnHit = Number.isFinite(naturalRoll)
        && (naturalRoll >= rkuThreshold)
        && (isHitByTarget === true);

      this.#rememberActivityAttackOutcome(activity, {
        rku,
        rkuThreshold,
        naturalRoll,
        targetAc: hasTargetAc ? targetAc : null,
        isHitByTarget,
        rkuCriticalOnHit,
        source: "dnd5e.rollAttack"
      });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to capture post-attack roll automation state.`, error);
    }

    return true;
  }

  applyMidiHitsChecked(workflow) {
    const activity = workflow?.activity ?? null;
    if (!this.#isWeaponAttackActivity(activity)) {
      return true;
    }

    try {
      const item = activity.item;
      const automation = this.#getLichAutomationState(item);
      const attackRoll = workflow?.attackRoll ?? null;
      if (!attackRoll) {
        return true;
      }

      const deadly = Math.max(0, Math.floor(toNumber(automation.deadly, 0)));
      const sourceActorUuid = String(workflow?.actor?.uuid ?? activity?.actor?.uuid ?? "").trim();
      if (deadly > 0 && sourceActorUuid) {
        const hitTargets = new Set([
          ...(workflow?.hitTargets ?? []),
          ...(workflow?.hitTargetsEC ?? [])
        ]);
        for (const targetToken of hitTargets) {
          const targetActorUuid = String(targetToken?.actor?.uuid ?? "").trim();
          if (!targetActorUuid) {
            continue;
          }

          this.#rememberPendingDeadlyExecution(sourceActorUuid, targetActorUuid, deadly, {
            sourceItemUuid: activity?.item?.uuid,
            usesLeft: 3
          });
        }
      }

      const rku = Math.max(0, Math.floor(toNumber(automation.rku, 0)));
      if (rku <= 0) {
        return true;
      }

      const hitsCount = (workflow?.hitTargets?.size ?? 0) + (workflow?.hitTargetsEC?.size ?? 0);
      const hasAnyHit = hitsCount > 0;
      const baseThreshold = clampInteger(toNumber(activity.criticalThreshold, 20), 2, 20);
      const rkuThreshold = clampInteger(baseThreshold - rku, 2, 20);
      const naturalRoll = extractNaturalD20Result(attackRoll);
      const isFumble = workflow?.isFumble === true || attackRoll?.isFumble === true;
      const rkuCriticalOnHit = hasAnyHit && !isFumble && Number.isFinite(naturalRoll) && (naturalRoll >= rkuThreshold);

      this.#rememberActivityAttackOutcome(activity, {
        rku,
        rkuThreshold,
        naturalRoll,
        isHitByTarget: hasAnyHit,
        rkuCriticalOnHit,
        source: "midi-qol.hitsChecked"
      });

      // Apply critical only after hit resolution so expanded crit range does not force auto-hit.
      if (rkuCriticalOnHit && workflow?.isCritical !== true) {
        workflow.isCritical = true;
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply MIDI hit-check automation.`, error);
    }

    return true;
  }

  applyDnd5eApplyDamage(actor, amount, options = {}) {
    if (!(actor instanceof Actor)) {
      return true;
    }

    try {
      const safeAmount = toNumber(amount, 0);
      if (safeAmount <= 0) {
        return true;
      }

      const sourceItemUuid = String(
        options?.midi?.sourceItemUuid
        ?? options?.sourceItemUuid
        ?? ""
      ).trim();
      if (!sourceItemUuid) {
        return true;
      }

      let deadly = 0;
      const sourceItem = this.#resolveItemFromUuid(sourceItemUuid);
      if (isWeaponItem(sourceItem)) {
        const automation = this.#getLichAutomationState(sourceItem);
        deadly = Math.max(0, Math.floor(toNumber(automation.deadly, 0)));
      }

      if (deadly <= 0) {
        const sourceActorUuid = String(
          options?.midi?.sourceActorUuid
          ?? options?.sourceActorUuid
          ?? ""
        ).trim();
        if (sourceActorUuid) {
          deadly = this.#takePendingDeadlyExecution(sourceActorUuid, actor.uuid, {
            maxAgeMs: 8000,
            decrement: true
          });
        }
      }

      if (deadly <= 0) {
        return true;
      }

      const isHit = options?.midi?.isHit;
      if (isHit === false) {
        return true;
      }

      this.#applyDeadlyExecution(actor, deadly, {
        damageAmount: safeAmount
      });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply deadly execution automation.`, error);
    }

    return true;
  }

  applyMidiRollComplete(workflow) {
    const activity = workflow?.activity ?? null;
    if (!this.#isWeaponAttackActivity(activity)) {
      return true;
    }

    try {
      const item = activity.item;
      const automation = this.#getLichAutomationState(item);
      const deadly = Math.max(0, Math.floor(toNumber(automation.deadly, 0)));
      if (deadly <= 0) {
        return true;
      }

      const damageList = Array.isArray(workflow?.damageList)
        ? workflow.damageList
        : [];
      if (!damageList.length) {
        return true;
      }

      for (const damageEntry of damageList) {
        const wasHit = damageEntry?.wasHit !== false;
        const hpDamage = toNumber(damageEntry?.hpDamage, 0);
        if (!wasHit || hpDamage <= 0) {
          continue;
        }

        const targetActorUuid = String(damageEntry?.actorUuid ?? "").trim();
        if (!targetActorUuid) {
          continue;
        }

        if (this.#wasWorkflowTargetProcessed(workflow, targetActorUuid)) {
          continue;
        }

        const targetActor = this.#resolveActorFromUuid(targetActorUuid)
          ?? game.actors?.get?.(String(damageEntry?.actorId ?? "").trim())
          ?? null;
        if (!(targetActor instanceof Actor)) {
          continue;
        }

        this.#markWorkflowTargetProcessed(workflow, targetActorUuid);
        this.#applyDeadlyExecution(targetActor, deadly, {
          damageAmount: hpDamage
        });
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply MIDI roll-complete deadly automation.`, error);
    }

    return true;
  }

  applyDnd5eDamageRollConfig(config = {}, dialog = {}, message = {}) {
    const activity = config?.subject ?? null;
    if (!this.#isWeaponAttackActivity(activity)) {
      return true;
    }

    try {
      const item = activity.item;
      const automation = this.#getLichAutomationState(item);
      const mu = Math.max(0, Math.floor(toNumber(automation.mu, 0)));
      const mku = Math.max(0, Math.floor(toNumber(automation.mku, 0)));
      const rku = Math.max(0, Math.floor(toNumber(automation.rku, 0)));

      const workflowCritical = (
        config?.workflow?.isCritical === true
        || config?.midiOptions?.isCritical === true
        || config?.isCritical === true
      );
      const recentOutcome = this.#readActivityAttackOutcome(activity, { maxAgeMs: 60000 });
      const rkuCriticalOnHit = rku > 0 && (
        workflowCritical
        || recentOutcome?.rkuCriticalOnHit === true
      );

      if (mu <= 0 && mku <= 0 && !rkuCriticalOnHit) {
        return true;
      }

      if (rkuCriticalOnHit) {
        config.isCritical = true;
        for (const rollEntry of config?.rolls ?? []) {
          rollEntry.options ??= {};
          rollEntry.options.isCritical = true;
        }
      }

      const baseDamageRollConfig = (config?.rolls ?? []).find((entry) => entry?.base) ?? config?.rolls?.[0] ?? null;
      if (!baseDamageRollConfig) {
        return true;
      }

      baseDamageRollConfig.options ??= {};

      if (mku > 0) {
        const currentBonusDice = Math.max(
          0,
          Math.floor(toNumber(foundry.utils.getProperty(baseDamageRollConfig, "options.critical.bonusDice"), 0))
        );
        foundry.utils.setProperty(baseDamageRollConfig, "options.critical.bonusDice", currentBonusDice + mku);
      }

      if (mu > 0) {
        const partFormulas = Array.isArray(baseDamageRollConfig.parts)
          ? baseDamageRollConfig.parts
          : [];
        const primaryDice = partFormulas
          .map((part) => extractPrimaryDiceTerm(String(part ?? "").trim()))
          .find((entry) => Boolean(entry)) ?? null;
        if (primaryDice) {
          const extraDiceCount = Math.max(1, primaryDice.number) * mu;
          const extraFormula = `${extraDiceCount}d${primaryDice.faces}`;
          baseDamageRollConfig.parts ??= [];
          baseDamageRollConfig.parts.push(extraFormula);
        }
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply damage roll automation.`, error);
    }

    return true;
  }

  #resolveTargetAc(options = {}) {
    const directTargetAc = toNumber(options.targetAc, NaN);
    if (Number.isFinite(directTargetAc)) {
      return directTargetAc;
    }

    const targetActor = this.#resolveActor(
      options.targetActor
      ?? options.targetId
      ?? options.targetToken
      ?? null
    );
    if (!(targetActor instanceof Actor)) {
      return null;
    }

    return getActorAcValue(targetActor);
  }

  #resolveCriticalThreshold(item, options = {}) {
    const baseThreshold = clampInteger(toNumber(options.criticalThreshold, 20), 2, 20);
    const traits = this.#getAttackTraits(item, options);
    return clampInteger(baseThreshold - Math.max(0, traits.rku), 2, 20);
  }

  #buildAttackFlavor(actor, item, options = {}, breakdown = null) {
    const attackKind = String(options.attackKind ?? "weapon").trim();
    const weaponName = item?.name ?? "weapon";
    const abilityLabel = breakdown?.abilityKey?.toUpperCase?.() ?? "STR";
    const modeLabelMap = {
      normal: "normal",
      advantage: "advantage",
      disadvantage: "disadvantage",
      heroicAdvantage: "heroic advantage",
      heroicDisadvantage: "heroic disadvantage"
    };

    const parts = [
      `${actor.name}: ${attackKind} attack`,
      `${weaponName}`,
      `${abilityLabel} ${signedNumber(breakdown?.abilityMod ?? 0)}`,
      `Prof ${signedNumber(breakdown?.proficiencyBonus ?? 0)}`,
      `Bonus ${signedNumber(breakdown?.situationalBonus ?? 0)}`,
      `Mode: ${modeLabelMap[breakdown?.rollMode] ?? "normal"}`
    ];

    if (options.flavor) {
      return String(options.flavor);
    }

    return parts.join(" | ");
  }

  #findDefaultMeleeWeapon(actor) {
    if (!(actor instanceof Actor)) {
      return null;
    }

    const equippedMelee = actor.items?.contents?.find?.((item) => isMeleeWeaponItem(item) && isEquippedItem(item)) ?? null;
    if (equippedMelee instanceof Item) {
      return equippedMelee;
    }

    return actor.items?.contents?.find?.((item) => isMeleeWeaponItem(item)) ?? null;
  }

  #hasParryEquipment(actor) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    const hasMeleeWeapon = actor.items?.contents?.some?.((item) => isMeleeWeaponItem(item) && isEquippedItem(item)) ?? false;
    if (hasMeleeWeapon) {
      return true;
    }

    return actor.items?.contents?.some?.((item) => {
      if (!(item instanceof Item) || item.type !== "equipment") {
        return false;
      }

      if (!isEquippedItem(item)) {
        return false;
      }

      const typeValue = String(foundry.utils.getProperty(item, "system.type.value") ?? "").trim().toLowerCase();
      return typeValue === "shield";
    }) ?? false;
  }

  #hasInterceptionEquipment(actor) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    const hasShield = actor.items?.contents?.some?.((item) => {
      if (!(item instanceof Item) || item.type !== "equipment") {
        return false;
      }

      if (!isEquippedItem(item)) {
        return false;
      }

      const typeValue = String(foundry.utils.getProperty(item, "system.type.value") ?? "").trim().toLowerCase();
      return typeValue === "shield";
    }) ?? false;
    if (hasShield) {
      return true;
    }

    return actor.items?.contents?.some?.((item) => isSimpleOrMartialWeapon(item) && isEquippedItem(item)) ?? false;
  }

  #getHitDiceMaximum(actor) {
    const explicit = toNumber(foundry.utils.getProperty(actor, "system.attributes.hd.max"), NaN);
    if (Number.isFinite(explicit) && explicit > 0) {
      return Math.floor(explicit);
    }

    const classes = foundry.utils.getProperty(actor, "system.classes");
    if (classes && typeof classes === "object") {
      const classEntries = Object.values(classes);
      const levels = classEntries.reduce((total, classRow) => total + Math.floor(toNumber(classRow?.levels, 0)), 0);
      if (levels > 0) {
        return levels;
      }
    }

    const level = Math.floor(toNumber(foundry.utils.getProperty(actor, "system.details.level"), 0));
    return Math.max(1, level);
  }

  getReactionState(actorOrId) {
    const actor = this.#resolveActor(actorOrId);
    if (!(actor instanceof Actor)) {
      return null;
    }

    const raw = actor.getFlag(MODULE_ID, REACTION_STATE_FLAG) ?? {};
    const usesMax = Math.max(1, Math.floor(toNumber(raw.usesMax, REACTION_DEFAULT_MAX_USES)));
    const usesRemaining = clampInteger(
      Object.hasOwn(raw, "usesRemaining") ? raw.usesRemaining : usesMax,
      0,
      usesMax
    );

    return {
      actorId: actor.id,
      usesMax,
      usesRemaining,
      available: usesRemaining > 0,
      lastRefreshCombatId: String(raw.lastRefreshCombatId ?? ""),
      lastRefreshRound: Math.floor(toNumber(raw.lastRefreshRound, 0)),
      lastRefreshTurn: Math.floor(toNumber(raw.lastRefreshTurn, -1)),
      lastReactionType: String(raw.lastReactionType ?? ""),
      lastReactionAt: raw.lastReactionAt ?? null
    };
  }

  async #setReactionState(actor, patch = {}) {
    const current = this.getReactionState(actor) ?? {
      actorId: actor.id,
      usesMax: REACTION_DEFAULT_MAX_USES,
      usesRemaining: REACTION_DEFAULT_MAX_USES,
      available: true,
      lastRefreshCombatId: "",
      lastRefreshRound: 0,
      lastRefreshTurn: -1,
      lastReactionType: "",
      lastReactionAt: null
    };
    const next = {
      ...current,
      ...foundry.utils.deepClone(patch ?? {})
    };

    next.usesMax = Math.max(1, Math.floor(toNumber(next.usesMax, REACTION_DEFAULT_MAX_USES)));
    next.usesRemaining = clampInteger(next.usesRemaining, 0, next.usesMax);
    next.available = next.usesRemaining > 0;

    await actor.setFlag(MODULE_ID, REACTION_STATE_FLAG, {
      usesMax: next.usesMax,
      usesRemaining: next.usesRemaining,
      lastRefreshCombatId: String(next.lastRefreshCombatId ?? ""),
      lastRefreshRound: Math.floor(toNumber(next.lastRefreshRound, 0)),
      lastRefreshTurn: Math.floor(toNumber(next.lastRefreshTurn, -1)),
      lastReactionType: String(next.lastReactionType ?? ""),
      lastReactionAt: next.lastReactionAt ?? null
    });

    return this.getReactionState(actor);
  }

  canUseReaction(actorOrId, requiredUses = 1) {
    const state = this.getReactionState(actorOrId);
    if (!state) {
      return {
        actorId: null,
        canUse: false,
        requiredUses: Math.max(1, Math.floor(toNumber(requiredUses, 1))),
        state: null
      };
    }

    const safeRequiredUses = Math.max(1, Math.floor(toNumber(requiredUses, 1)));
    return {
      actorId: state.actorId,
      canUse: state.usesRemaining >= safeRequiredUses,
      requiredUses: safeRequiredUses,
      state
    };
  }

  async refreshReaction(actorOrId, options = {}) {
    const actor = this.#resolveActor(actorOrId);
    if (!(actor instanceof Actor)) {
      return null;
    }

    const usesMax = Math.max(1, Math.floor(toNumber(options.usesMax, REACTION_DEFAULT_MAX_USES)));
    const combat = options.combat instanceof Combat ? options.combat : game.combat;
    const round = Math.floor(toNumber(options.round, combat?.round ?? 0));
    const turn = Math.floor(toNumber(options.turn, combat?.turn ?? -1));
    const combatId = String(options.combatId ?? combat?.id ?? "");

    return this.#setReactionState(actor, {
      usesMax,
      usesRemaining: usesMax,
      lastRefreshCombatId: combatId,
      lastRefreshRound: round,
      lastRefreshTurn: turn
    });
  }

  async consumeReaction(actorOrId, options = {}) {
    const actor = this.#resolveActor(actorOrId);
    if (!(actor instanceof Actor)) {
      return {
        actorId: null,
        consumed: false,
        reason: "actorNotFound",
        state: null
      };
    }

    const safeUses = Math.max(1, Math.floor(toNumber(options.uses, 1)));
    const check = this.canUseReaction(actor, safeUses);
    if (!check.canUse) {
      return {
        actorId: actor.id,
        consumed: false,
        reason: "noReactionUses",
        state: check.state
      };
    }

    const nextState = await this.#setReactionState(actor, {
      usesRemaining: Math.max(0, (check.state?.usesRemaining ?? 0) - safeUses),
      lastReactionType: String(options.reactionType ?? ""),
      lastReactionAt: new Date().toISOString()
    });

    return {
      actorId: actor.id,
      consumed: true,
      state: nextState
    };
  }

  #resolveFirearmWeapon(actorOrItem, weaponOrId = null) {
    const weapon = actorOrItem instanceof Item
      ? actorOrItem
      : this.#resolveItem(this.#resolveActor(actorOrItem), weaponOrId);
    if (!(weapon instanceof Item)) {
      throw new Error("Failed to resolve firearm weapon.");
    }

    if (!isFirearmItem(weapon)) {
      throw new Error("Selected weapon is not classified as firearm.");
    }

    return weapon;
  }

  #resolveFirearmMaintenanceAbility(actor, options = {}) {
    const explicitAbility = cleanText(options.firearmMaintenanceAbility ?? options.ability).toLowerCase();
    if (["dex", "int"].includes(explicitAbility)) {
      return explicitAbility;
    }

    const dexModifier = toNumber(foundry.utils.getProperty(actor, "system.abilities.dex.mod"), NaN);
    const intModifier = toNumber(foundry.utils.getProperty(actor, "system.abilities.int.mod"), NaN);
    if (Number.isFinite(intModifier) && (!Number.isFinite(dexModifier) || intModifier > dexModifier)) {
      return "int";
    }

    return "dex";
  }

  async #rollFirearmMaintenanceCheck(actor, weapon, dc, options = {}) {
    const ability = this.#resolveFirearmMaintenanceAbility(actor, options);
    const explicitTotal = toNumber(options.firearmMaintenanceTotal ?? options.maintenanceTotal, NaN);
    if (Number.isFinite(explicitTotal)) {
      return {
        checked: true,
        total: Math.floor(explicitTotal),
        dc,
        toolId: "tinker",
        ability
      };
    }

    if (!actor || typeof actor.rollToolCheck !== "function") {
      return {
        checked: false,
        total: null,
        dc,
        reason: "toolRollUnavailable"
      };
    }

    const toolIds = Array.isArray(options.toolIds) && options.toolIds.length
      ? options.toolIds.map(cleanText).filter(Boolean)
      : FIREARM_MAINTENANCE_TOOL_IDS;
    for (const toolId of toolIds) {
      if (!isConfiguredDnd5eToolId(toolId)) {
        continue;
      }

      try {
        const flavor = `${weapon?.name ?? "Оружие"}: привести оружие в порядок (Сл ${dc})`;
        const rollResult = await actor.rollToolCheck({
          tool: toolId,
          ability,
          dc,
          target: dc,
          event: options.event,
          flavor
        }, {}, { flavor });
        const total = extractRollTotal(rollResult);
        if (Number.isFinite(total)) {
          return {
            checked: true,
            total: Math.floor(total),
            dc,
            toolId,
            ability,
            roll: rollResult
          };
        }
      }
      catch (_error) {
        // Try the next known tinker-tool id; dnd5e ids differ between worlds and versions.
      }
    }

    return {
      checked: false,
      total: null,
      dc,
      reason: "toolRollUnavailable"
    };
  }

  async #restoreFirearmMisfireToBase(weapon, fallback = 1) {
    const baseMisfire = this.#resolveFirearmBaseMisfireThreshold(weapon, fallback);
    const values = this.#getLichWeaponPropertyValues(weapon);
    const configuredBase = toNumber(values.misfire ?? values.firearmMisfire, NaN);
    const matchesConfiguredBase = this.#hasItemProperty(weapon, FIREARM_MISFIRE_PROPERTY)
      && Number.isFinite(configuredBase)
      && clampInteger(configuredBase, 1, 10) === baseMisfire;

    if (matchesConfiguredBase) {
      await this.#unsetItemFlag(weapon, FIREARM_CURRENT_MISFIRE_FLAG);
    }
    else {
      await this.#setItemFlag(weapon, FIREARM_CURRENT_MISFIRE_FLAG, baseMisfire);
    }
    await this.#unsetItemFlag(weapon, FIREARM_BASE_MISFIRE_FLAG);

    return baseMisfire;
  }

  async clearFirearmJam(actorOrItem, weaponOrId = null) {
    const weapon = this.#resolveFirearmWeapon(actorOrItem, weaponOrId);
    const previousMisfire = Math.max(1, this.#resolveFirearmMisfireThreshold(weapon));
    const baseMisfire = this.#resolveFirearmBaseMisfireThreshold(weapon, previousMisfire);
    const currentMisfire = clampInteger(previousMisfire + 1, 1, 10);

    await this.#setItemFlag(weapon, FIREARM_BASE_MISFIRE_FLAG, baseMisfire);
    await this.#setItemFlag(weapon, FIREARM_CURRENT_MISFIRE_FLAG, currentMisfire);
    await this.#unsetItemFlag(weapon, FIREARM_JAMMED_FLAG);
    await this.#setItemName(weapon, stripFirearmJamSuffix(weapon.name));

    ui.notifications?.info?.(`${weapon.name}: затвор очищен, осечка теперь ${currentMisfire}.`);

    return {
      weaponId: weapon.id,
      weaponName: weapon.name,
      isJammed: false,
      previousMisfire,
      currentMisfire,
      baseMisfire
    };
  }

  async maintainFirearm(actorOrItem, weaponOrId = null, options = {}) {
    const weapon = this.#resolveFirearmWeapon(actorOrItem, weaponOrId);
    const actor = options.actor instanceof Actor
      ? options.actor
      : (weapon.actor instanceof Actor ? weapon.actor : this.#resolveActor(actorOrItem));
    const previousMisfire = Math.max(1, this.#resolveFirearmMisfireThreshold(weapon));
    const dc = 10 + previousMisfire;
    const check = await this.#rollFirearmMaintenanceCheck(actor, weapon, dc, options);
    if (!check.checked) {
      ui.notifications?.warn?.("Не удалось бросить проверку инструментов жестянщика.");
      return {
        weaponId: weapon.id,
        weaponName: weapon.name,
        success: false,
        dc,
        total: null,
        previousMisfire,
        currentMisfire: previousMisfire,
        reason: check.reason ?? "checkUnavailable"
      };
    }

    const success = check.total >= dc;
    const currentMisfire = success
      ? await this.#restoreFirearmMisfireToBase(weapon, previousMisfire)
      : previousMisfire;

    if (success) {
      ui.notifications?.info?.(`${weapon.name}: осечка возвращена к ${currentMisfire}.`);
    }
    else {
      ui.notifications?.warn?.(`${weapon.name}: проверка обслуживания не удалась.`);
    }

    return {
      weaponId: weapon.id,
      weaponName: weapon.name,
      success,
      dc,
      total: check.total,
      previousMisfire,
      currentMisfire,
      toolId: check.toolId ?? "",
      ability: check.ability ?? ""
    };
  }

  async handleCombatTurnChange(combat, updateData = {}) {
    if (!game.user?.isGM) {
      return null;
    }

    if (!(combat instanceof Combat)) {
      return null;
    }

    if (!Object.hasOwn(updateData, "round") && !Object.hasOwn(updateData, "turn")) {
      return null;
    }

    const currentActor = combat.combatant?.actor ?? null;
    if (!(currentActor instanceof Actor)) {
      return null;
    }

    return this.refreshReaction(currentActor, {
      combat,
      round: updateData.round,
      turn: updateData.turn
    });
  }

  async rollWeaponAttack(actorOrId, weaponOrId, options = {}) {
    const actor = this.#resolveActor(actorOrId);
    if (!(actor instanceof Actor)) {
      throw new Error("Failed to resolve actor for attack roll.");
    }

    const weapon = this.#resolveItem(actor, weaponOrId);
    if (!(weapon instanceof Item)) {
      throw new Error("Failed to resolve weapon item for attack roll.");
    }

    if (!isWeaponItem(weapon)) {
      throw new Error("Selected item is not a weapon.");
    }

    if (isFirearmItem(weapon)) {
      if (this.#blockJammedFirearm(weapon)) {
        return {
          success: false,
          reason: "firearmJammed",
          actorId: actor.id,
          actorName: actor.name,
          weaponId: weapon.id,
          weaponName: weapon.name,
          attackKind: String(options.attackKind ?? "weapon"),
          isJammed: true
        };
      }

      const misfire = this.#rollFirearmMisfire(actor, weapon, options);
      if (misfire.jammed) {
        return {
          success: false,
          reason: "firearmMisfire",
          actorId: actor.id,
          actorName: actor.name,
          weaponId: weapon.id,
          weaponName: weapon.name,
          attackKind: String(options.attackKind ?? "weapon"),
          isJammed: true,
          misfire
        };
      }
    }

    const abilityKey = this.#resolveAttackAbilityKey(actor, weapon, options);
    const abilityMod = getActorAbilityModifier(actor, abilityKey);
    const proficiencyBonus = this.#isAttackProficient(actor, weapon, options)
      ? getActorProficiencyBonus(actor)
      : 0;
    const situationalBonus = toNumber(options.bonus, 0);
    const attackBonus = abilityMod + proficiencyBonus + situationalBonus;
    const rollMode = resolveRollMode(options);
    const d20Formula = buildD20Formula(rollMode);

    const formula = `${d20Formula} + @abilityMod + @proficiencyBonus + @situationalBonus`;
    const roll = await (new Roll(formula, {
      abilityMod,
      proficiencyBonus,
      situationalBonus
    })).evaluate({ async: true });

    const targetAc = this.#resolveTargetAc(options);
    const naturalRoll = extractNaturalD20Result(roll);
    const criticalThreshold = this.#resolveCriticalThreshold(weapon, options);
    const isCriticalHit = Number.isFinite(naturalRoll) && naturalRoll >= criticalThreshold;
    const isAutomaticMiss = Number.isFinite(naturalRoll) && naturalRoll === 1;
    const isAutomaticHit = Number.isFinite(naturalRoll) && naturalRoll === 20;
    const isHit = Number.isFinite(targetAc)
      ? (isAutomaticHit || (!isAutomaticMiss && roll.total >= targetAc))
      : null;

    const attackTraits = this.#getAttackTraits(weapon, options);
    const breakdown = {
      rollMode,
      abilityKey,
      abilityMod,
      proficiencyBonus,
      situationalBonus,
      attackBonus
    };

    if (options.createMessage !== false) {
      const flavor = this.#buildAttackFlavor(actor, weapon, options, breakdown);
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor
      });
    }

    return {
      actorId: actor.id,
      actorName: actor.name,
      weaponId: weapon.id,
      weaponName: weapon.name,
      attackKind: String(options.attackKind ?? "weapon"),
      rollMode,
      formula,
      total: roll.total,
      naturalRoll,
      criticalThreshold,
      isCriticalHit,
      isHit,
      targetAc,
      breakdown,
      attackTraits,
      roll
    };
  }

  async rollFirearmAttack(actorOrId, weaponOrId, options = {}) {
    const actor = this.#resolveActor(actorOrId);
    if (!(actor instanceof Actor)) {
      throw new Error("Failed to resolve actor for firearm attack.");
    }

    const weapon = this.#resolveItem(actor, weaponOrId);
    if (!(weapon instanceof Item)) {
      throw new Error("Failed to resolve firearm weapon.");
    }

    if (!isFirearmItem(weapon)) {
      throw new Error("Selected weapon is not classified as firearm.");
    }

    const abilityKey = this.#resolveFirearmAbilityKey(weapon, "dex");
    return this.rollWeaponAttack(actor, weapon, {
      ...options,
      attackKind: "firearm",
      abilityKey
    });
  }

  async resolveProvokedAttack(reactorOrId, targetOrId, options = {}) {
    const reactor = this.#resolveActor(reactorOrId);
    if (!(reactor instanceof Actor)) {
      throw new Error("Failed to resolve reactor actor for provoked attack.");
    }

    const target = this.#resolveActor(targetOrId);
    if (!(target instanceof Actor)) {
      throw new Error("Failed to resolve target actor for provoked attack.");
    }

    const reactionCheck = this.canUseReaction(reactor, 1);
    if (!reactionCheck.canUse) {
      return {
        success: false,
        reason: "noReactionUses",
        actorId: reactor.id,
        targetId: target.id,
        state: reactionCheck.state
      };
    }

    const explicitWeapon = this.#resolveItem(reactor, options.weaponId ?? options.weaponName ?? options.weapon ?? "");
    const weapon = explicitWeapon ?? this.#findDefaultMeleeWeapon(reactor);
    if (!(weapon instanceof Item)) {
      return {
        success: false,
        reason: "noMeleeWeapon",
        actorId: reactor.id,
        targetId: target.id,
        state: reactionCheck.state
      };
    }

    const rollResult = await this.rollWeaponAttack(reactor, weapon, {
      ...options,
      attackKind: "provoked",
      targetActor: target
    });

    const consumeResult = await this.consumeReaction(reactor, {
      reactionType: "provokedAttack"
    });

    return {
      success: true,
      actorId: reactor.id,
      targetId: target.id,
      weaponId: weapon.id,
      roll: rollResult,
      interrupted: rollResult.isHit === true,
      reaction: consumeResult
    };
  }

  async resolveParry(defenderOrId, incomingAttackTotal, options = {}) {
    const defender = this.#resolveActor(defenderOrId);
    if (!(defender instanceof Actor)) {
      throw new Error("Failed to resolve defender actor for parry.");
    }

    const attackTotal = toNumber(incomingAttackTotal, NaN);
    if (!Number.isFinite(attackTotal)) {
      throw new Error("Incoming attack total must be a number.");
    }

    const reactionCheck = this.canUseReaction(defender, 1);
    if (!reactionCheck.canUse) {
      return {
        success: false,
        reason: "noReactionUses",
        actorId: defender.id,
        state: reactionCheck.state
      };
    }

    if (!this.#hasParryEquipment(defender)) {
      return {
        success: false,
        reason: "requirementsNotMet",
        actorId: defender.id,
        state: reactionCheck.state
      };
    }

    const baseAc = Number.isFinite(Number(options.baseAc))
      ? Number(options.baseAc)
      : getActorAcValue(defender);
    if (!Number.isFinite(baseAc)) {
      throw new Error("Failed to resolve defender AC for parry.");
    }

    const proficiencyBonus = getActorProficiencyBonus(defender);
    const adjustedAc = baseAc + proficiencyBonus;
    const preventedHit = attackTotal < adjustedAc;
    const consumeResult = await this.consumeReaction(defender, {
      reactionType: "parry"
    });

    return {
      success: true,
      actorId: defender.id,
      attackTotal,
      baseAc,
      proficiencyBonus,
      adjustedAc,
      preventedHit,
      reaction: consumeResult
    };
  }

  async resolveInterception(guardianOrId, targetOrId, incomingDamage, options = {}) {
    const guardian = this.#resolveActor(guardianOrId);
    if (!(guardian instanceof Actor)) {
      throw new Error("Failed to resolve guardian actor for interception.");
    }

    const target = this.#resolveActor(targetOrId);
    if (!(target instanceof Actor)) {
      throw new Error("Failed to resolve target actor for interception.");
    }

    const safeDamage = Math.max(0, Math.floor(toNumber(incomingDamage, 0)));
    const reactionCheck = this.canUseReaction(guardian, 1);
    if (!reactionCheck.canUse) {
      return {
        success: false,
        reason: "noReactionUses",
        actorId: guardian.id,
        targetId: target.id,
        state: reactionCheck.state
      };
    }

    if (!this.#hasInterceptionEquipment(guardian)) {
      return {
        success: false,
        reason: "requirementsNotMet",
        actorId: guardian.id,
        targetId: target.id,
        state: reactionCheck.state
      };
    }

    const reduction = Math.max(0, this.#getHitDiceMaximum(guardian));
    const reducedDamage = Math.max(0, safeDamage - reduction);
    const consumeResult = await this.consumeReaction(guardian, {
      reactionType: "interception"
    });

    if (options.applyDamage === true) {
      const currentHp = toNumber(foundry.utils.getProperty(target, "system.attributes.hp.value"), NaN);
      if (Number.isFinite(currentHp)) {
        await target.update({
          "system.attributes.hp.value": Math.max(0, currentHp - reducedDamage)
        });
      }
    }

    return {
      success: true,
      actorId: guardian.id,
      targetId: target.id,
      incomingDamage: safeDamage,
      reduction,
      reducedDamage,
      reaction: consumeResult
    };
  }
}
