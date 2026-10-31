import { HELD_ITEM_UPDATED_HOOK, MODULE_ID } from "../constants.js";
import { captureFirearmMisfire, applyFirearmMisfireToRoll, activeFirearmMisfire } from "./firearm-misfire.js?v=1.5.38";
import { LEGACY_AMMUNITION, captureAmmunition, magazineRounds, validateMagazine, ammunitionFingerprint, getAmmunitionDamage, applyAmmunitionDamage } from "./ammunition-magazine.js?v=1.5.31";
import { applyFirearmTuning, startFirearmTuning, getFirearmTuningBonus } from "./firearm-tuning.js?v=1.5.22";
import { isCombatActorActive, combatantsOf } from "./turn-group-rules.js";
import { getFighterManeuverAutomation } from "../data/fighter-automation.js";
import { getWeaponModAmmoConfiguration, readWeaponMods, weaponModProfileSignature } from "../data/weapon-mod-rules.js?v=1.5.23";
import { resolveWeaponModActivity, getWeaponModGrenadeCandidate } from "../data/weapon-mod-activities.js?v=1.5.23";
import { evaluateWeaponModAttack, getWeaponModAimState, resolveWeaponModConditions, WEAPON_MOD_CONDITION_FIELDS, buildWeaponModTargetDecision, resolveWeaponModTargetConditions, WEAPON_MOD_TARGET_FIELDS, buildWeaponModScatterPlan, isValidWeaponModScatterDecision } from "../automation/weapon-mod-roll-modifiers.js?v=1.4.397";
import { createStableGearDocumentId } from "../data/gear-document-ids.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { measureStorageTokenDistance, storageTokenFootprintCenters, measureStorageGridDistance } from "../data/storage-access.js";
import { inferRebreyaAmmunitionSubtype, inferRebreyaWeaponAmmunitionSubtype } from "../data/ammunition-types.js";
import {
  hasActiveRepeatingShot,
  inferAmmunitionItemSubtype,
  isCompatibleAmmunition,
  resolveAmmunitionProfile
} from "../data/ammunition-compatibility.js?v=1.5.31";
import { getCharacterSizeRule } from "./size-automation-service.js?v=1.4.109-character-size";
import { getNaturalReachFeet } from "./natural-reach.js";
import { whirlwindActivityUpdates, isWhirlwindActivity, collectWhirlwindTargets, whirlwindHitTargets, whirlwindEffectTargets, markWhirlwindDamageRolls, applyWhirlwindDamage, registerWhirlwindNativeTargetOptions, routeWhirlwindConsumption } from "./whirlwind-attack.js?v=1.5.1";
import { getWeaponSizeUse } from "../data/equipment-size-rules.js?v=1.4.393";
import {
  buildHeldItemHandUpdate,
  canUseHeldItemForHandRequirement,
  getItemHeldHands,
  isNaturalWeapon,
  hasDistinctHeldItemsInDifferentHands
} from "../integrations/held-items.js?v=1.5.29";

const FIREARM_WEAPON_TYPES = new Set(["firearmPrimitive", "firearmAdvanced"]);
const WEAPON_TYPE_SIMPLE_PREFIX = "simple";
const WEAPON_TYPE_MARTIAL_PREFIX = "martial";
const FIREARM_WEIGHT_THRESHOLD_LB = 10;
const FIREARM_JAMMED_FLAG = "firearmJammed";
const FIREARM_CURRENT_MISFIRE_FLAG = "firearmMisfire";
const FIREARM_BASE_MISFIRE_FLAG = "firearmBaseMisfire";
const FIREARM_MISFIRE_PROPERTY = "lchFirearmMisfire";
const FIREARM_RUST_PROPERTY = "lchFirearmRust";
const FIREARM_RELOAD_PROPERTY = "lchFirearmReload";
const FIREARM_MISFIRE_DIE_FORMULA = "1d20";
const FIREARM_AMMO_STATE_FLAG = "firearmAmmoState";
const FIREARM_CHAT_NOTES_FLAG = "firearmChatNotes";
const FIREARM_RELOAD_CHAT_FLAG = "firearmReload";
const FIREARM_MISFIRE_CHAT_FLAG = "firearmMisfire";
const EQUIPMENT_SIZE_ATTACK_BUILDER = Symbol("rebreyaEquipmentSizeAttackBuilder");
const DND5E_AMMUNITION_PROPERTY = "amm";
const IMPLANT_RELOAD_RESERVOIR_FLAG = "implantReloadReservoir";
const IMPLANT_RELOAD_RESERVOIR_CAPACITY = 20;
const FIREARM_JAM_NAME_SUFFIX = " (клин)";
const FIREARM_CLEAR_JAM_ACTIVITY_ID = "lchClearBreech01";
const FIREARM_MAINTAIN_ACTIVITY_ID = "lchMaintainGun01";
const FIREARM_RELOAD_ACTIVITY_ID = "lchReloadGun0001";
const FIREARM_CLEAR_JAM_AUTOMATION = "firearm-clear-jam";
const FIREARM_MAINTAIN_AUTOMATION = "firearm-maintain";
const FIREARM_RELOAD_AUTOMATION = "firearm-reload";
const FIREARM_AUTOMATIC_FIRE_AUTOMATION = "firearm-automatic-fire";
const FIREARM_SEMI_AUTOMATIC_FIRE_AUTOMATION = "firearm-semi-automatic-fire";
const FIREARM_MAINTENANCE_TOOL_IDS = ["art:tinker", "tinker", "tink"];
const ACTIVITY_UNAVAILABLE_LABEL = "Недоступно";
const REACTION_STATE_FLAG = "reactionState";
const REACTION_DEFAULT_MAX_USES = 1;
const PROVOKED_ATTACK_REACTION_KIND = "provoked-attack";
const PARRY_REACTION_KIND = "parry";
const INTERCEPTION_REACTION_KIND = "interception";
const FIGHTER_DOMINANCE_TARGET = "fighter-dominance";
const DUAL_WIELD_GLOVES_MAGIC_ITEM_ID = "перчатки-двуручного-боя";
const PATCHED_USAGE_BUTTON_PROTOTYPES = new WeakSet();
function heldItemUpdateOptions() {
  return { render: false };
}

function notifyHeldItemUpdated(actor, item) {
  const safeItem = item ?? null;
  const safeActor = actor ?? safeItem?.actor ?? safeItem?.parent ?? null;
  const itemId = cleanText(safeItem?.id ?? safeItem?._id);
  const actorId = cleanText(safeActor?.id ?? safeActor?._id);
  if (!itemId) {
    return;
  }

  globalThis.Hooks?.callAll?.(HELD_ITEM_UPDATED_HOOK, {
    actor: safeActor,
    actorId,
    item: safeItem,
    itemId
  });
}

function setLocalDocumentProperty(document, path, value) {
  const safePath = cleanText(path);
  if (!document || !safePath) {
    return;
  }

  const deletionMatch = safePath.match(/^(.*)\.-=([^.]+)$/u);
  if (deletionMatch) {
    const deletePath = `${deletionMatch[1]}.${deletionMatch[2]}`;
    if (typeof globalThis.foundry?.utils?.unsetProperty === "function") {
      globalThis.foundry.utils.unsetProperty(document, deletePath);
      return;
    }

    const parts = deletePath.split(".").filter(Boolean);
    const key = parts.pop();
    const parent = parts.reduce((current, part) => (
      current && typeof current === "object" ? current[part] : undefined
    ), document);
    if (parent && typeof parent === "object" && key) {
      delete parent[key];
    }
    return;
  }

  if (typeof globalThis.foundry?.utils?.setProperty === "function") {
    globalThis.foundry.utils.setProperty(document, safePath, value);
    return;
  }

  const parts = safePath.split(".").filter(Boolean);
  const key = parts.pop();
  if (!key) {
    return;
  }

  let cursor = document;
  for (const part of parts) {
    cursor[part] ??= {};
    cursor = cursor[part];
  }
  cursor[key] = value;
}

function applyLocalHeldItemUpdate(item, update) {
  if (!item || !isPlainObject(update)) {
    return;
  }

  if (typeof item.updateSource === "function") {
    try {
      item.updateSource(update);
      return;
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to apply local held item update source.`, error);
    }
  }

  for (const [path, value] of Object.entries(update)) {
    setLocalDocumentProperty(item, path, value);
  }
}

function refreshLocalHeldItemActivityData(item, activity) {
  let preparedItem = false;
  if (typeof item?.prepareData === "function") {
    try {
      item.prepareData();
      preparedItem = true;
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to refresh auto-held item data before use.`, error);
    }
  }

  if (typeof item?.prepareFinalAttributes === "function") {
    try {
      item.prepareFinalAttributes();
      return;
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to refresh auto-held item final data before use.`, error);
    }
  }

  const activityId = cleanText(activity?.id ?? activity?._id);
  const preparedActivity = activityId ? item?.system?.activities?.get?.(activityId) : null;
  const targetActivity = preparedActivity ?? activity;
  if (!preparedItem && typeof targetActivity?.prepareData === "function") {
    try {
      targetActivity.prepareData();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to refresh auto-held activity data before use.`, error);
      return;
    }
  }

  if (typeof targetActivity?.prepareFinalData === "function") {
    try {
      targetActivity.prepareFinalData();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to refresh auto-held activity final data before use.`, error);
    }
    return;
  }
}

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

function escapeHtml(value) {
  const text = String(value ?? "");
  if (typeof globalThis.foundry?.utils?.escapeHTML === "function") {
    return globalThis.foundry.utils.escapeHTML(text);
  }

  return text.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function damagePartFormula(part) {
  if (!part) {
    return "";
  }

  if (typeof part === "string") {
    return cleanText(part);
  }

  const directFormula = cleanText(part.formula ?? foundry.utils.getProperty(part, "custom.formula"));
  if (directFormula) {
    return directFormula;
  }

  const number = Math.max(0, Math.floor(toNumber(part.number, 0)));
  const denomination = Math.max(0, Math.floor(toNumber(part.denomination, 0)));
  if (!number || !denomination) {
    return "";
  }

  const bonus = cleanText(part.bonus);
  return bonus ? `${number}d${denomination} + ${bonus}` : `${number}d${denomination}`;
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

function hasFirearmJamSuffix(name) {
  return /\s*\((?:клин|РєР»РёРЅ)\)\s*$/iu.test(cleanText(name));
}

function stripFirearmAmmoSuffix(name) {
  const text = cleanText(name);
  return text
    .replace(/\s*\((?:(?:боезапас|пусто|пустой магазин)\s*)?\d+\s*\/\s*\d+\)\s*/giu, " ")
    .replace(/\s+/gu, " ")
    .trim() || text;
}

function withFirearmAmmoSuffix(name, current, capacity) {
  const safeCurrent = Math.max(0, Math.floor(toNumber(current, 0)));
  const safeCapacity = Math.max(0, Math.floor(toNumber(capacity, 0)));
  if (safeCapacity <= 0) {
    return cleanText(name);
  }

  const wasJammed = hasFirearmJamSuffix(name);
  const baseName = stripFirearmJamSuffix(stripFirearmAmmoSuffix(name));
  const ammoSuffix = ` (${safeCurrent}/${safeCapacity})`;
  return `${baseName}${ammoSuffix}${wasJammed ? FIREARM_JAM_NAME_SUFFIX : ""}`;
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
    const value = document.getFlag(scope, key);
    if (value !== undefined) {
      return value;
    }
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

function effectIsEnabled(effect) {
  return effect && effect.disabled !== true && effect.isSuppressed !== true;
}

function actorHasReactionSuppression(actor) {
  if (!(actor instanceof Actor)) {
    return false;
  }

  return collectionValues(actor.effects).some((effect) => {
    if (!effectIsEnabled(effect)) {
      return false;
    }

    const automation = readDocumentFlag(effect, MODULE_ID, "paladinAutomation");
    if (automation?.kind !== "magistrateEffect") {
      return false;
    }

    return automation.effect === "detentionNoReaction" || automation.effect === "lawNoReaction";
  });
}

function collectionEntries(collection) {
  if (!collection) {
    return [];
  }

  if (collection instanceof Map) {
    return Array.from(collection.entries());
  }

  if (typeof collection.entries === "function" && !Array.isArray(collection)) {
    return Array.from(collection.entries());
  }

  if (Array.isArray(collection)) {
    return collection.map((entry, index) => [entry?.id ?? entry?._id ?? String(index), entry]);
  }

  if (typeof collection === "object") {
    return Object.entries(collection);
  }

  return [];
}

function clonePlainData(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (typeof globalThis.foundry?.utils?.deepClone === "function") {
    try {
      return globalThis.foundry.utils.deepClone(value);
    }
    catch (_error) {
      // Fall through to generic cloning below.
    }
  }

  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    }
    catch (_error) {
      // DataModel documents can contain non-cloneable methods or references.
    }
  }

  try {
    return JSON.parse(JSON.stringify(value));
  }
  catch (_error) {
    if (Array.isArray(value)) {
      return value.map((entry) => clonePlainData(entry));
    }

    const data = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== "function") {
        data[key] = clonePlainData(entry);
      }
    }
    return data;
  }
}

function sourceData(document) {
  if (document === null || typeof document !== "object") {
    return {};
  }

  if (typeof document.toObject === "function") {
    try {
      return clonePlainData(document.toObject());
    }
    catch (_error) {
      // Fall back to enumerable data below.
    }
  }

  return clonePlainData(document);
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

function isWeaponAttackActivity(activity) {
  if (!activity) {
    return false;
  }

  if (!isWeaponItem(activity.item ?? null)) {
    return false;
  }

  return String(activity.type ?? "").trim().toLowerCase() === "attack";
}

function removePropertyValue(properties, propertyKey) {
  if (!properties) {
    return false;
  }

  if (properties instanceof Set) {
    return properties.delete(propertyKey);
  }

  if (Array.isArray(properties)) {
    let changed = false;
    for (let index = properties.length - 1; index >= 0; index -= 1) {
      if (properties[index] === propertyKey) {
        properties.splice(index, 1);
        changed = true;
      }
    }
    return changed;
  }

  if (isPlainObject(properties) && Object.hasOwn(properties, propertyKey)) {
    delete properties[propertyKey];
    return true;
  }

  return false;
}

function activityHasBaseWeaponDamage(activity) {
  if (!isWeaponAttackActivity(activity)) {
    return false;
  }

  if (foundry.utils.getProperty(activity, "damage.includeBase") === false) {
    return false;
  }

  const item = activity.item ?? null;
  if (foundry.utils.getProperty(item, "system.offersBaseDamage") === false) {
    return false;
  }

  return Boolean(damagePartFormula(foundry.utils.getProperty(item, "system.damage.base")));
}

function readActivityAttackMode(activity) {
  const activityId = cleanText(activity?.id ?? activity?._id);
  if (!activityId) {
    return "";
  }

  return cleanText(readDocumentFlag(activity?.item, "dnd5e", `last.${activityId}.attackMode`));
}

function ensureBaseDamageUsageButtons(activity, buttons) {
  const safeButtons = Array.from(buttons ?? []);
  if (!activityHasBaseWeaponDamage(activity)) {
    return safeButtons;
  }

  const attackMode = readActivityAttackMode(activity);
  const damageButton = safeButtons.find((button) => button?.dataset?.action === "rollDamage");
  if (damageButton) {
    damageButton.dataset ??= {};
    if (attackMode && !damageButton.dataset.attackMode) {
      damageButton.dataset.attackMode = attackMode;
    }
    return safeButtons;
  }

  const nextDamageButton = {
    label: globalThis.game?.i18n?.localize?.("DND5E.Damage") ?? "Damage",
    icon: '<i class="fa-solid fa-burst" inert></i>',
    dataset: {
      action: "rollDamage"
    }
  };
  if (attackMode) {
    nextDamageButton.dataset.attackMode = attackMode;
  }

  const attackButtonIndex = safeButtons.findIndex((button) => button?.dataset?.action === "rollAttack");
  if (attackButtonIndex >= 0) {
    safeButtons.splice(attackButtonIndex + 1, 0, nextDamageButton);
  }
  else {
    safeButtons.unshift(nextDamageButton);
  }
  return safeButtons;
}

function selectAutoHeldHandsForUse(freeHands, requiredHands) {
  const hands = Array.isArray(freeHands) ? freeHands : [];
  const heldHandCount = Math.max(1, Math.min(hands.length, requiredHands > 1 ? 1 : requiredHands));
  return hands.slice(0, heldHandCount);
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

function hasDualWieldGlovesDamageBonus(actor, currentItem) {
  if (!actor || !isMeleeWeaponItem(currentItem) || !isEquippedItem(currentItem)) {
    return false;
  }
  const hasEquippedGloves = collectionValues(actor.items).some((item) => (
    item?.getFlag?.(MODULE_ID, "magicItemId") === DUAL_WIELD_GLOVES_MAGIC_ITEM_ID
    && isEquippedItem(item)
  ));
  if (!hasEquippedGloves) {
    return false;
  }
  return hasDistinctHeldItemsInDifferentHands(actor, currentItem, {
    predicate: (item) => isMeleeWeaponItem(item) && isEquippedItem(item)
  });
}

function hasEquivalentFlatTwoPart(parts) {
  return (Array.isArray(parts) ? parts : []).some((part) => {
    const formula = String(part ?? "").replace(/\s+/gu, "");
    return formula === "+2" || formula === "2";
  });
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

function convertUnitsToFeet(value, units) {
  const safeValue = Math.max(0, toNumber(value, 0));
  const normalizedUnits = String(units ?? "").trim().toLowerCase();
  switch (normalizedUnits) {
    case "m":
      return safeValue / 0.3048;
    case "km":
      return safeValue / 0.0003048;
    case "mi":
      return safeValue * 5280;
    case "ft":
    default:
      return safeValue;
  }
}

export class CombatAttackService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
    this._activityAttackOutcomes = new Map();
    this._pendingDeadlyExecutions = new Map();
    this._processedDeadlyWorkflowTargets = new Set();
    this._reactionTriggerSequence = 0;
    this._reactionTriggerContexts = new Map();
    this._weaponModDeferred = new WeakSet();
    this._weaponModUtilityRequests=new Map();
    this._weaponModDamageWarnings=new WeakSet();
    this._ammunitionShots = new WeakMap();
    this._magazineEditors = new Map();
  }

  getWeaponModAttackConditions(activity,target,config={}) {
    const host=activity?.item,actor=host?.actor??host?.parent,combat=globalThis.game?.combat;
    const contributions=this.moduleApi.itemUpgradeAutomationService?.project?.(actor,host)?.contributions??[];
    const aim=getWeaponModAimState(host,combat,contributions),movement=actor?.getFlag?.(MODULE_ID,"weaponModMovement")??actor?.flags?.[MODULE_ID]?.weaponModMovement;
    const movingNow=Boolean(combat && isCombatActorActive(combat,actor) && movement?.combatId===combat.id && movement.round===combat.round && movement.turn===combat.turn);
    const nativeProficiency=this.moduleApi.itemUpgradeAutomationService?.getWeaponModActivityProficiency?.(activity)??host?.system?.prof?.hasProficiency,legacyProficiency=host?.system?.proficient;
    const targetUuid=target?.document?.uuid??target?.uuid??null,visibility=config.workflow?.targetVisibility?.get?.(targetUuid);
    const water=actor?.getFlag?.(MODULE_ID,"underwater")??actor?.flags?.[MODULE_ID]?.underwater??globalThis.canvas?.scene?.getFlag?.(MODULE_ID,"underwater");
    const known={movedFeet:movingNow && Number.isFinite(movement.feet)?movement.feet:aim?.movedFeet??null,
      prone:actor?.statuses?.has?actor.statuses.has("prone"):null,targetVisible:typeof visibility==="boolean"?visibility:null,
      usesProficiency:typeof nativeProficiency==="boolean"?nativeProficiency:typeof legacyProficiency==="boolean"?legacyProficiency:null,
      underwater:actor?.statuses?.has?.("underwater")?true:typeof water==="boolean"?water:null,aimMode:aim?.mode??null};
    const decision=config.rebreyaWeaponModDecisions?.find(entry=>entry.targetUuid===targetUuid);
    return decision?resolveWeaponModConditions(known,decision,{targetUuid,attackMessageId:config.rebreyaWeaponModAttackMessageId??null}):known;
  }

  getManagedWeaponModActivityDefinition(activity){
    const marker=activity?.flags?.[MODULE_ID]?.weaponModActivity??activity?.getFlag?.(MODULE_ID,"weaponModActivity");
    if(!marker)return null;
    const actor=activity?.actor??activity?.item?.actor??activity?.item?.parent,host=actor?.items?.get?.(activity?.item?.id),catalog=this.moduleApi.itemUpgradeAutomationService?.weaponModCatalog;
    if(!host || !catalog)throw new Error("Действие обвеса больше недоступно.");
    const mods=readWeaponMods(host,id=>actor.items.get(id),catalog),definition=resolveWeaponModActivity(host,mods,{childItemId:marker.childItemId,activityId:activity.id??activity._id},{sources:catalog.gearById});
    if(weaponModProfileSignature(marker)!==weaponModProfileSignature(definition.marker))throw new Error("Связь действия обвеса изменилась.");
    return {...definition,host,actor};
  }

  getWeaponModAttackContext(message,activityUuid=null){
    const uuid=message?.getFlag?.("dnd5e","activity.uuid")??message?.flags?.dnd5e?.activity?.uuid;
    const candidates=Array.from(message?.rolls??[]).filter(roll=>{
      const context=roll.options?.rebreyaWeaponModAttack;
      return context?.nonce && context.activityUuid===uuid && (!activityUuid || context.activityUuid===activityUuid) && Number.isFinite(roll.total);
    });
    return candidates.length===1?{context:candidates[0].options.rebreyaWeaponModAttack,roll:candidates[0],message}:null;
  }

  tagWeaponModAttack(config){
    const activity=config.subject,host=activity?.item,actor=activity?.actor??host?.actor??host?.parent,catalog=this.moduleApi.itemUpgradeAutomationService?.weaponModCatalog;
    if(!actor || !catalog || !isFirearmItem(host) || activity.flags?.[MODULE_ID]?.weaponModActivity || activity.attack?.type?.value==="melee")return;
    const mods=readWeaponMods(host,id=>actor.items.get(id),catalog),components=[...mods.attachments,...mods.modernizedParts].filter(mod=>mod.profile.effects.some(effect=>["silencer","nonmagical-resistance","scatter-radius","scatter-ability-modifier"].includes(effect.kind)))
      .map(mod=>({itemId:mod.itemId,sourceId:mod.sourceId,profileSignature:weaponModProfileSignature(mod.profile)}));
    if(!components.length)return;
    const tokens=Array.from(actor.getActiveTokens?.(true,true)??[]).map(token=>token.document??token),controlled=tokens.filter(token=>token.object?.controlled??token.controlled),
      source=actor.token??(tokens.length===1?tokens[0]:controlled.length===1?controlled[0]:null),ammunition=this.#resolveFirearmAmmoState(host).ammunition,
      subtype=inferRebreyaWeaponAmmunitionSubtype({lichWeaponPropertyValues:{ammunition}})||host.system.ammunition?.type||inferRebreyaWeaponAmmunitionSubtype(host),
      family=({rebreyaMusket:"musket",rebreyaPistol:"pistol",rebreyaRifle:"rifle",rebreyaShotgun:"shotgun"})[subtype]??null,
      targetUuids=Array.from(config.targets??config.workflow?.targets??globalThis.game.user?.targets??[]).map(target=>target.document?.uuid??target.uuid).filter(Boolean);
    for(const roll of config.rolls??[]){
      roll.options??={};const previous=roll.options.rebreyaWeaponModAttack;
      if(previous?.actorUuid===actor.uuid && previous.hostItemId===host.id && previous.activityUuid===activity.uuid)continue;
      roll.options.rebreyaWeaponModAttack={nonce:globalThis.crypto.randomUUID(),actorUuid:actor.uuid,hostItemId:host.id,activityUuid:activity.uuid,
        sourceTokenUuid:source?.uuid??null,ammunitionFamily:family,targetUuids,components,
        abilityModifier:Number.isFinite(roll.data?.mod)?roll.data.mod:null,scatterDamage:host.getFlag?.(MODULE_ID,"lichWeaponPropertyValues")?.scatterDamage??null};
    }
  }

  getWeaponModDamageContext(messageOrId,targetUuid,activityUuid=null){
    const message=typeof messageOrId==="string"?globalThis.game.messages?.get?.(messageOrId):messageOrId;
    const scoped=message?.getFlag?.(MODULE_ID,"weaponModDamageContext")??message?.flags?.[MODULE_ID]?.weaponModDamageContext;
    if(scoped){const attack=this.getWeaponModAttackContext(game.messages.get(scoped.attackMessageId),activityUuid??scoped.activityUuid);
      if(attack?.context.nonce===scoped.attackNonce)return {...scoped,targetUuid};}
    const candidates=[...new Map([...message?.getAssociatedRolls?.("attack")??[],message].filter(Boolean).map(message=>[message.id,message])).values()]
      .map(message=>this.getWeaponModAttackContext(message,activityUuid)).filter(Boolean);
    const distinct=new Map();
    for(const candidate of candidates.sort((a,b)=>Number(b.message.getFlag?.("dnd5e","roll.type")==="attack")-Number(a.message.getFlag?.("dnd5e","roll.type")==="attack")))if(!distinct.has(candidate.context.nonce))distinct.set(candidate.context.nonce,candidate);
    if(distinct.size!==1)return null;
    const {context,message:attack}=[...distinct.values()][0];return {attackMessageId:attack.id,attackNonce:context.nonce,activityUuid:context.activityUuid,targetUuid};
  }

  async prepareWeaponModDamageUse(activity,config={},message={}){
    if(!this.#isWeaponAttackActivity(activity) || !isFirearmItem(activity.item) || activity.flags?.[MODULE_ID]?.weaponModActivity)return null;
    const ids=[config.midiOptions?.workflow?.itemCardId,config.workflow?.itemCardId,message.data?.flags?.dnd5e?.originatingMessage,
      message.data?.["flags.dnd5e.originatingMessage"],config.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId].filter(Boolean);
    let context;for(const id of ids){context=this.getWeaponModDamageContext(id,"",activity.uuid);if(context)break;}
    if(!context)return null;
    const attack=this.getWeaponModAttackContext(game.messages.get(context.attackMessageId),activity.uuid),catalog=this.moduleApi.itemUpgradeAutomationService?.weaponModCatalog;
    for(const component of attack.context.components){
      const row=catalog?.rows.find(row=>row.sourceId===component.sourceId);
      if(!row?.profile.effects.some(effect=>effect.kind==="nonmagical-resistance"))continue;
      if(!attack.context.targetUuids.length)throw new Error("Для эффекта снаряда требуется конкретная цель подтверждённой атаки.");
      for(const targetUuid of attack.context.targetUuids){
        const id=createStableGearDocumentId(`weapon-mod-target:${attack.context.nonce}:${component.itemId}:${targetUuid}`),existing=game.messages.get(id)?.getFlag?.(MODULE_ID,"weaponModTargetReceipt");
        if(existing?.status==="resolved")continue;
        const payload={actorUuid:attack.context.actorUuid,hostItemId:attack.context.hostItemId,childItemId:component.itemId,activityId:activity.id,
          operationId:globalThis.crypto.randomUUID(),decision:{kind:"target-effects",targetUuid,attackMessageId:context.attackMessageId,targetVisible:null,canHear:null,hiddenFromTarget:null,materialTarget:null}},
          result=isActiveGmClient(game)?await this.resolveWeaponModTargetEffects(payload):await this.moduleApi.useWeaponModActivity(payload);
        if(result.cancelled)return {cancelled:true};
      }
    }
    const {targetUuid:_target,...damageContext}=context;return {damageContext};
  }

  warnWeaponModDamageLimit(actor,options){
    if(this._weaponModDamageWarnings.has(options))return;this._weaponModDamageWarnings.add(options);
    globalThis.ui?.notifications?.warn?.(`Особые сопротивления MIDI у «${actor.name??"цели"}» требуют ручного расчёта эффекта обвеса мастером.`);
  }

  getWeaponModDamageRule(actor,options={}){
    const input=options.rebreyaWeaponModDamage;if(!input?.targetUuid)return null;
    const attack=this.getWeaponModAttackContext(globalThis.game.messages?.get?.(input.attackMessageId),input.activityUuid);
    if(!attack || attack.context.nonce!==input.attackNonce)return null;
    const receipts=Array.from(globalThis.game.messages?.values?.()??globalThis.game.messages?.contents??[]).flatMap(message=>{
      const state=message.getFlag?.(MODULE_ID,"weaponModTargetReceipt")??message.flags?.[MODULE_ID]?.weaponModTargetReceipt;
      const author=message.author??game.users.get(message.user?.id??message.user);
      if(!author?.isGM || state?.status!=="resolved" || state.targetActorUuid!==actor.uuid || state.attackMessageId!==input.attackMessageId || state.attackNonce!==input.attackNonce
        || state.activityUuid!==input.activityUuid || state.actorUuid!==attack.context.actorUuid || state.hostItemId!==attack.context.hostItemId
        || !(state.targetUuid===input.targetUuid || input.targetUuid===actor.uuid))return [];
      const component=attack.context.components?.find(entry=>entry.itemId===state.childItemId);
      return component?.sourceId===state.sourceId && component.profileSignature===state.profileSignature?[state]:[];
    });
    if(new Set(receipts.map(state=>state.targetUuid)).size!==1)return null;
    const rules=receipts.map(state=>state.result?.damageRule).filter(rule=>rule?.ignoreNonmagicalResistance || rule?.treatNonmagicalImmunityAsResistance);
    return rules.length?{ignoreNonmagicalResistance:rules.some(rule=>rule.ignoreNonmagicalResistance),treatNonmagicalImmunityAsResistance:rules.some(rule=>rule.treatNonmagicalImmunityAsResistance)}:null;
  }

  getWeaponModScatterHits(attack){
    return Array.from(game.messages?.values?.()??game.messages?.contents??[]).flatMap(message=>{
      const state=message.getFlag?.(MODULE_ID,"weaponModScatterReceipt"),author=message.author??game.users.get(message.user?.id??message.user);
      if(!author?.isGM || state?.status!=="resolved" || state.attackNonce!==attack.context.nonce || state.attackMessageId!==attack.message.id
        || state.actorUuid!==attack.context.actorUuid || state.hostItemId!==attack.context.hostItemId || state.activityUuid!==attack.context.activityUuid)return [];
      const component=attack.context.components.find(component=>component.itemId===state.childItemId);
      return component?.sourceId===state.sourceId && component.profileSignature===state.profileSignature?state.result?.hits??[]:[];
    });
  }

  getWeaponModTargetConditions(actor,context,target){
    const source=actor.token?.uuid===context.sourceTokenUuid?actor.token:Array.from(actor.getActiveTokens?.(true,true)??[]).map(token=>token.document??token).find(token=>token.uuid===context.sourceTokenUuid);
    const sameScene=source?.parent?.uuid && source.parent.uuid===target?.parent?.uuid;
    const distance=sameScene?measureStorageTokenDistance(source,target):NaN;
    const position=token=>token?{uuid:token.uuid,sceneUuid:token.parent?.uuid,x:token.x,y:token.y,width:token.width,height:token.height}:null;
    return {distanceFeet:Number.isFinite(distance)?convertUnitsToFeet(distance,source.parent.grid?.units??"ft"):null,positionSignature:weaponModProfileSignature([position(source),position(target)]),
      targetVisible:null,canHear:target?.actor?.statuses?.has?.("deafened")?false:null,hiddenFromTarget:null,materialTarget:null};
  }

  async promptWeaponModTargetConditions({decision,conditions,needsDecision,target}){
    const fields=needsDecision.map(row=>row.field);
    if(fields.includes("distanceFeet"))throw new Error("Для проверки глушителя нужны точные токены стрелка и наблюдателя на одной сцене.");
    const dialog=globalThis.foundry?.applications?.api?.DialogV2;if(!dialog?.wait)throw new Error("Окно решения мастера недоступно; эффект ожидает решения.");
    const labels={canHear:"Наблюдатель может слышать стрелка",hiddenFromTarget:"Стрелок скрыт от этого наблюдателя",materialTarget:"Противник материален",targetVisible:"Цель видна"};
    const response=await dialog.wait({window:{title:"Условия эффекта обвеса"},content:fields.map(field=>`<label>${labels[field]} <select name="${field}"><option value="">Выберите</option><option value="true">Да</option><option value="false">Нет</option></select></label>`).join(""),
      buttons:[{action:"apply",label:"Подтвердить",default:true,callback:(_event,button)=>Object.fromEntries(fields.map(field=>[field,button.form.elements.namedItem(field).value]))},
        {action:"cancel",label:"Отмена",callback:()=>false}],close:()=>false});
    if(!response)return null;
    const choice={...decision};for(const field of fields){if(!["true","false"].includes(response[field]))throw new Error("Мастер должен выбрать явное решение для каждого неизвестного условия.");choice[field]=response[field]==="true";}
    return resolveWeaponModTargetConditions(conditions,choice,{targetUuid:target.uuid,attackMessageId:decision.attackMessageId,allowMaterialDecision:true});
  }

  async #writeWeaponModTargetReceipt(receipt,before,next,patch,guard,key="weaponModTargetReceipt"){
    guard();if(weaponModProfileSignature(receipt.getFlag(MODULE_ID,key))!==weaponModProfileSignature(before))throw new Error("Решение по этой атаке изменилось; нужна сверка мастера.");
    try{await receipt.update({[`flags.${MODULE_ID}.${key}`]:next,...patch});}
    catch(error){guard();if(weaponModProfileSignature(receipt.getFlag(MODULE_ID,key))!==weaponModProfileSignature(next))throw error;}
    guard();
  }

  async resolveWeaponModScatter(payload,{sender=globalThis.game.user,assertAuthority=null}={}){
    const authorityId=game.user?.id,guard=()=>{if(!isActiveGmClient(game) || game.user.id!==authorityId)throw new Error("Активный мастер изменился.");assertAuthority?.();};guard();
    if(!isValidWeaponModScatterDecision(payload.decision))throw new Error("Неверное решение о разбросе.");
    const actor=await globalThis.fromUuid(payload.actorUuid);
    if(!actor || !(sender?.isGM || actor.testUserPermission?.(sender,"OWNER")))throw new Error("Нет прав на оружие стрелка.");
    return this.moduleApi.inventoryService.mutationCoordinator.run(`inventory-organization:${actor.id}`,async()=>{
      guard();const host=actor.items.get(payload.hostItemId),message=game.messages.get(payload.decision.attackMessageId),
        activityUuid=`${host?.uuid}.Activity.${payload.activityId}`,attack=this.getWeaponModAttackContext(message,activityUuid),
        catalog=this.moduleApi.itemUpgradeAutomationService?.weaponModCatalog;
      if(!host || !isFirearmItem(host) || !attack || attack.context.actorUuid!==actor.uuid || attack.context.hostItemId!==host.id)throw new Error("Нет подтверждённой атаки для разброса.");
      const mod=readWeaponMods(host,id=>actor.items.get(id),catalog).modernizedParts.find(mod=>mod.itemId===payload.childItemId),
        snapshot=attack.context.components.find(entry=>entry.itemId===payload.childItemId);
      if(!mod?.profile.effects.some(effect=>["scatter-radius","scatter-ability-modifier"].includes(effect.kind)) || snapshot?.sourceId!==mod.sourceId
        || snapshot.profileSignature!==weaponModProfileSignature(mod.profile))throw new Error("Сверловка этой атаки изменилась.");
      const binding={actorUuid:actor.uuid,hostItemId:host.id,childItemId:mod.itemId,sourceId:mod.sourceId,profileSignature:snapshot.profileSignature,
        attackMessageId:message.id,attackNonce:attack.context.nonce,activityUuid},key="weaponModScatterReceipt",
        id=createStableGearDocumentId(`weapon-mod-scatter:${attack.context.nonce}:${mod.itemId}`);
      let receipt=game.messages.get(id),state=receipt?.getFlag?.(MODULE_ID,key);
      if(receipt){
        const author=receipt.author??game.users.get(receipt.user?.id??receipt.user);
        if(!author?.isGM || !state || Object.entries(binding).some(([key,value])=>state[key]!==value))throw new Error("Карточка разброса не совпадает с атакой.");
        if(state.status==="resolved" || state.status==="cancelled" && state.operationId===payload.operationId)return {...state.result,receiptId:id,replayed:true};
        if(state.status==="rolling")throw new Error("Бросок разброса начался без подтверждённого результата; нужна ручная сверка без повторного броска.");
      }
      const candidates=[];for(const uuid of attack.context.targetUuids??[]){const token=await globalThis.fromUuid(uuid);if(token?.actor)candidates.push(token);}
      let primaryUuid=payload.decision.primaryTargetUuid;
      if(!primaryUuid)primaryUuid=await this.promptWeaponModChoice("Исходная цель разброса",candidates.map(token=>({id:token.uuid,name:token.name??token.actor.name??token.id})));
      if(!primaryUuid)return {cancelled:true};
      const primary=candidates.find(token=>token.uuid===primaryUuid);if(!primary)throw new Error("Исходная цель отсутствует в подтверждённой атаке.");
      const points=storageTokenFootprintCenters(primary),pointKey=point=>`${point.x},${point.y}`;
      let originPoint=payload.decision.originPoint;
      if(!originPoint){
        const chosen=await this.promptWeaponModChoice("Пространство попадания (5 футов)",points.map((point,index)=>({id:pointKey(point),name:`Клетка ${index+1} (${point.x}, ${point.y})`})));
        if(!chosen)return {cancelled:true};originPoint=points.find(point=>pointKey(point)===chosen);
      }
      if(!points.some(point=>pointKey(point)===pointKey(originPoint)))throw new Error("Выбранное пространство не принадлежит исходной цели.");
      let abilityModifier=Number.isFinite(attack.roll.data?.mod)?attack.roll.data.mod:attack.context.abilityModifier;
      if(payload.decision.abilityModifier!==null){
        if(Number.isFinite(abilityModifier)?abilityModifier!==payload.decision.abilityModifier:!sender.isGM)throw new Error("Модификатор исходной атаки не подтверждён.");
        abilityModifier=payload.decision.abilityModifier;
      }
      const contributions=mod.profile.effects.map(effect=>({...effect,scope:"weapon-mod",hostItemId:host.id,sourceId:mod.sourceId})),
        scatterDamage=attack.context.scatterDamage??host.getFlag(MODULE_ID,"lichWeaponPropertyValues")?.scatterDamage,
        tokens=Array.from(primary.parent.tokens?.contents??primary.parent.tokens?.values?.()??[]).filter(token=>token.actor && token.uuid!==primary.uuid),
        positions=()=>weaponModProfileSignature([primary,...tokens].map(token=>[token.uuid,token.x,token.y,token.width,token.height,token.actor.system?.attributes?.ac?.value])),
        positionBefore=positions(),targets=tokens.map(token=>({uuid:token.uuid,actorUuid:token.actor.uuid,ac:token.actor.system?.attributes?.ac?.value,
          distanceFeet:convertUnitsToFeet(Math.min(...storageTokenFootprintCenters(token).map(point=>measureStorageGridDistance(originPoint,point,{sceneGrid:primary.parent.grid}))),primary.parent.grid.units??"ft")})),
        build=()=>buildWeaponModScatterPlan({host,attack:{total:attack.roll.total,isCritical:attack.roll.isCritical??attack.context.isCritical,
          isFumble:attack.roll.isFumble??attack.context.isFumble},scatterDamage,abilityModifier,contributions,targets});
      let plan=build();
      if(plan.needsDecision.some(row=>row.field==="abilityModifier")){
        const dialog=globalThis.foundry?.applications?.api?.DialogV2;
        if(!dialog?.wait)throw new Error("Модификатор исходной атаки должен подтвердить мастер.");
        const choice=await dialog.wait({window:{title:"Модификатор исходной атаки"},content:'<label>Фактический модификатор <input name="modifier" type="number" required></label>',
          buttons:[{action:"apply",label:"Подтвердить",callback:(_event,button)=>button.form.elements.namedItem("modifier").value},{action:"cancel",label:"Отмена",callback:()=>null}],close:()=>null});
        guard();if(choice===null)return {cancelled:true};
        if(String(choice).trim()==="" || !Number.isFinite(Number(choice)))throw new Error("Нужен числовой модификатор исходной атаки.");
        abilityModifier=Number(choice);plan=build();
      }
      if(plan.needsDecision.length)throw new Error("КД окружающих существ не определена; разброс требует ручного разрешения мастером.");
      if(positions()!==positionBefore)throw new Error("Цели разброса изменились; повторите выбор.");
      const hits=plan.targets.filter(target=>target.hit);
      if(receipt && (state.primaryTargetUuid!==primary.uuid || weaponModProfileSignature(state.originPoint)!==weaponModProfileSignature(originPoint)
        || state.abilityModifier!==abilityModifier || state.damageFormula!==plan.damageFormula))throw new Error("Условия начатого разброса изменились; нужна ручная сверка.");
      if(!receipt){
        state={version:1,...binding,status:"pending",operationId:payload.operationId,primaryTargetUuid:primary.uuid,originPoint,abilityModifier,damageFormula:plan.damageFormula,result:null};
        const whisper=Array.from(game.users.values?.()??game.users.contents??[]).filter(user=>user.isGM).map(user=>user.id);
        guard();try{receipt=await ChatMessage.create({_id:id,user:game.user.id,whisper,content:"<p>Разброс ожидает броска урона.</p>",flags:{[MODULE_ID]:{[key]:state}}},{keepId:true});}
        catch(error){guard();receipt=game.messages.get(id);if(!receipt || weaponModProfileSignature(receipt.getFlag(MODULE_ID,key))!==weaponModProfileSignature(state))throw error;}guard();
      }
      let roll=null;
      if(hits.length){
        const next={...state,status:"rolling"};await this.#writeWeaponModTargetReceipt(receipt,state,next,{},guard,key);state=next;
        const type=this.#resolveFirearmDamageType(host);roll=await new CONFIG.Dice.DamageRoll(plan.damageFormula,actor.getRollData?.()??{},
          {type,types:[type],properties:Array.from(host.system.properties??[])}).evaluate();guard();
        if(!Number.isFinite(roll.total))throw new Error("Результат разброса не подтверждён; нужна ручная сверка.");
      }
      const result={hits,damageTotal:roll?.total??0,damageFormula:plan.damageFormula,radiusFeet:plan.radiusFeet},next={...state,status:"resolved",result,nativeRollJSON:roll?.toJSON()??null},
        names=hits.map(hit=>{const token=tokens.find(token=>token.uuid===hit.uuid);return String(token?.name??token?.actor?.name??token?.id).replace(/[&<>"']/gu,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));});
      await this.#writeWeaponModTargetReceipt(receipt,state,next,{content:`<p>Разброс: ${result.damageTotal}. Попадания: ${names.join(", ")||"нет"}. Примените урон к этим целям через обычную карточку урона.</p>`,
        ...(roll?{rolls:[Roll.fromJSON(roll.toJSON())]}:{}),"flags.dnd5e.messageType":"roll","flags.dnd5e.roll.type":"damage","flags.dnd5e.activity.uuid":activityUuid,
        [`flags.${MODULE_ID}.weaponModDamageContext`]:{attackMessageId:message.id,attackNonce:attack.context.nonce,activityUuid}},guard,key);
      return {...result,receiptId:id,replayed:false};
    });
  }

  async resolveWeaponModTargetEffects(payload,{sender=globalThis.game.user,assertAuthority=null}={}){
    const authorityId=globalThis.game.user?.id,guard=()=>{if(!isActiveGmClient(globalThis.game) || game.user.id!==authorityId)throw new Error("Активный мастер изменился.");assertAuthority?.();};guard();
    const actor=await globalThis.fromUuid(payload.actorUuid);
    if(!actor || !(sender?.isGM || actor.testUserPermission?.(sender,"OWNER")))throw new Error("Нет прав на оружие стрелка.");
    return this.moduleApi.inventoryService.mutationCoordinator.run(`inventory-organization:${actor.id}`,async()=>{
      guard();const host=actor.items.get(payload.hostItemId),message=globalThis.game.messages?.get?.(payload.decision.attackMessageId),
        expectedUuid=`${host?.uuid}.Activity.${payload.activityId}`,attack=this.getWeaponModAttackContext(message,expectedUuid),catalog=this.moduleApi.itemUpgradeAutomationService?.weaponModCatalog,
        activity=host?.system.activities?.get?.(payload.activityId)??host?.system.activities?.[payload.activityId];
      if(!host || !activity || !isFirearmItem(host) || !attack || attack.context.actorUuid!==actor.uuid || attack.context.hostItemId!==host.id
        || activity.type!=="attack" || activity.attack?.type?.value==="melee")throw new Error("Нет подтверждённой огнестрельной атаки для этого эффекта.");
      const mod=readWeaponMods(host,id=>actor.items.get(id),catalog).attachments.find(mod=>mod.itemId===payload.childItemId),snapshot=attack.context.components?.find(entry=>entry.itemId===payload.childItemId);
      if(!mod || snapshot?.sourceId!==mod.sourceId || snapshot.profileSignature!==weaponModProfileSignature(mod.profile))throw new Error("Обвес этой атаки изменился; автоматическое разрешение недоступно.");
      const target=await globalThis.fromUuid(payload.decision.targetUuid);
      if(!target?.actor)throw new Error("Выберите конкретный токен наблюдателя или цели.");
      const materialOnly=mod.profile.effects.some(effect=>effect.kind==="nonmagical-resistance");
      if(materialOnly && !attack.context.targetUuids?.includes(target.uuid) && !this.getWeaponModScatterHits(attack).some(hit=>hit.uuid===target.uuid && hit.actorUuid===target.actor.uuid))throw new Error("Этот токен не относится к целям подтверждённой атаки.");
      let conditions=resolveWeaponModTargetConditions(this.getWeaponModTargetConditions(actor,attack.context,target),payload.decision,
        {targetUuid:target.uuid,attackMessageId:message.id,allowMaterialDecision:sender.isGM});
      const contributions=mod.profile.effects.map((effect,index)=>({...effect,scope:"weapon-mod",hostItemId:host.id,childItemId:mod.itemId,sourceId:mod.sourceId,effectKey:String(index)})),
        evaluate=()=>buildWeaponModTargetDecision({host:{id:host.id,isFirearm:true},attack:{type:"ranged",isFirearm:true,total:attack.roll.total,messageId:message.id,ammunitionFamily:attack.context.ammunitionFamily},
          target:{uuid:target.uuid},contributions,conditions});
      let result=evaluate();
      const id=createStableGearDocumentId(`weapon-mod-target:${attack.context.nonce}:${mod.itemId}:${target.uuid}`),binding={actorUuid:actor.uuid,hostItemId:host.id,childItemId:mod.itemId,sourceId:mod.sourceId,
        profileSignature:snapshot.profileSignature,attackMessageId:message.id,attackNonce:attack.context.nonce,activityUuid:expectedUuid,targetUuid:target.uuid,targetActorUuid:target.actor.uuid},
        existing=()=>globalThis.game.messages?.get?.(id);
      let receipt=existing(),state=receipt?.getFlag?.(MODULE_ID,"weaponModTargetReceipt");
      if(receipt){
        const author=receipt.author??game.users.get(receipt.user?.id??receipt.user);
        if(!author?.isGM || !state || Object.entries(binding).some(([key,value])=>state[key]!==value))throw new Error("Карточка решения не совпадает с атакой.");
        if(state.status==="resolved" || state.status==="cancelled" && state.operationId===payload.operationId)return {...state.result,receiptId:id,replayed:true};
        if(state.status==="rolling")throw new Error("Проверка уже началась, но её результат не подтверждён. Требуется ручная сверка; повторного броска не будет.");
      }else{
        state={version:1,...binding,operationId:payload.operationId,approvedByUserId:game.user.id,status:"pending",conditions,result:null};
        const users=Array.from(game.users?.values?.()??game.users?.contents??[]),knownTarget=attack.context.targetUuids?.includes(target.uuid),whisper=users.filter(user=>user.isGM
          || target.actor.testUserPermission?.(user,"OWNER") || knownTarget && actor.testUserPermission?.(user,"OWNER")).map(user=>user.id);
        guard();try{receipt=await globalThis.ChatMessage.create({_id:id,user:game.user.id,whisper,content:"<p>Эффект обвеса ожидает решения мастера.</p>",flags:{[MODULE_ID]:{weaponModTargetReceipt:state}}},{keepId:true});}
        catch(error){guard();receipt=existing();if(!receipt || weaponModProfileSignature(receipt.getFlag(MODULE_ID,"weaponModTargetReceipt"))!==weaponModProfileSignature(state))throw error;}guard();
      }
      if(result.needsDecision.length){
        const resolved=await this.promptWeaponModTargetConditions({decision:payload.decision,conditions,needsDecision:result.needsDecision,target});guard();
        if(!resolved){const next={...state,status:"cancelled",operationId:payload.operationId,result:{cancelled:true}};await this.#writeWeaponModTargetReceipt(receipt,state,next,{content:"<p>Решение мастера отменено; проверка не выполнялась.</p>"},guard);return {...next.result,receiptId:id};}
        const current=this.getWeaponModTargetConditions(actor,attack.context,target);
        if(current.positionSignature!==conditions.positionSignature)throw new Error("Положение стрелка или наблюдателя изменилось; повторите решение мастера.");
        conditions=resolveWeaponModTargetConditions(current,{...payload.decision,...Object.fromEntries(WEAPON_MOD_TARGET_FIELDS.map(field=>[field,resolved[field]??null]))},
          {targetUuid:target.uuid,attackMessageId:message.id,allowMaterialDecision:true});result=evaluate();
        if(result.needsDecision.length)throw new Error("Не все условия эффекта подтверждены мастером.");
      }
      let total=null,json=null;
      if(result.suppressionCheck){
        const next={...state,status:"rolling",conditions,operationId:payload.operationId};await this.#writeWeaponModTargetReceipt(receipt,state,next,{},guard);state=next;
        const rolls=await target.actor.rollSkill({skill:"prc",ability:"wis",rolls:[{options:{target:result.suppressionCheck.dc}}]}, {configure:true}, {create:false,rollMode:"gmroll"});guard();
        if(!rolls?.length){const cancelled={...state,status:"cancelled",result:{cancelled:true}};await this.#writeWeaponModTargetReceipt(receipt,state,cancelled,{content:"<p>Проверка восприятия отменена.</p>"},guard);return {...cancelled.result,receiptId:id};}
        if(rolls.length!==1 || !Number.isFinite(rolls[0].total))throw new Error("Результат проверки неоднозначен; нужна ручная сверка.");
        total=rolls[0].total;const data=rolls[0].toJSON();json=typeof data==="string"?data:JSON.stringify(data);
      }
      const outcome={damageRule:result.damageRule,dc:result.suppressionCheck?.dc??null,perceptionTotal:total,revealedToObserver:total===null?null:total>=result.suppressionCheck.dc},
        next={...state,status:"resolved",conditions,result:outcome,rollJSON:json,operationId:payload.operationId,approvedByUserId:game.user.id},
        content=total===null?"<p>Применимость эффекта обвеса подтверждена мастером.</p>":`<p>Восприятие: ${total}, Сл ${outcome.dc}. ${outcome.revealedToObserver?"Положение стрелка раскрыто этому наблюдателю.":"Положение стрелка не раскрыто этому наблюдателю."}</p>`;
      await this.#writeWeaponModTargetReceipt(receipt,state,next,{content,...(json?{rolls:[globalThis.Roll.fromJSON(json)]}:{})},guard);
      return {...outcome,receiptId:id,replayed:false};
    });
  }

  initializeWeaponModTargetIndex(){
    this._weaponModSeenAttacks=new Set(Array.from(game.messages?.values?.()??game.messages?.contents??[]).flatMap(message=>Array.from(message.rolls??[])
      .map(roll=>roll.options?.rebreyaWeaponModAttack?.nonce).filter(Boolean)));
  }
  async handleWeaponModAttackMessage(message){
    this._weaponModSeenAttacks??=new Set();
    const contexts=Array.from(message.rolls??[]).map(roll=>roll.options?.rebreyaWeaponModAttack).filter(Boolean);
    for(const context of contexts){
      if(this._weaponModSeenAttacks.has(context.nonce))continue;this._weaponModSeenAttacks.add(context.nonce);
      if(!isActiveGmClient(game) || !this.getWeaponModAttackContext(message,context.activityUuid))continue;
      const actor=await globalThis.fromUuid(context.actorUuid),host=actor?.items?.get(context.hostItemId),catalog=this.moduleApi.itemUpgradeAutomationService?.weaponModCatalog;
      if(!host || !catalog)continue;
      const mods=readWeaponMods(host,id=>actor.items.get(id),catalog),source=context.sourceTokenUuid?await globalThis.fromUuid(context.sourceTokenUuid):null;
      const ordered=[...context.components??[]].sort((a,b)=>Number(mods.modernizedParts.some(mod=>mod.itemId===b.itemId))-Number(mods.modernizedParts.some(mod=>mod.itemId===a.itemId)));
      for(const snapshot of ordered){
        const mod=[...mods.attachments,...mods.modernizedParts].find(mod=>mod.itemId===snapshot.itemId);
        if(!mod || snapshot.profileSignature!==weaponModProfileSignature(mod.profile))continue;
        if(mod.profile.effects.some(effect=>["scatter-radius","scatter-ability-modifier"].includes(effect.kind))){
          await this.resolveWeaponModScatter({actorUuid:actor.uuid,hostItemId:host.id,childItemId:mod.itemId,activityId:context.activityUuid.split(".").at(-1),
            operationId:globalThis.crypto.randomUUID(),decision:{kind:"scatter",attackMessageId:message.id,primaryTargetUuid:null,originPoint:null,abilityModifier:null}});
          continue;
        }
        const silencer=mod.profile.effects.find(effect=>effect.kind==="silencer"),projectile=mod.profile.effects.some(effect=>effect.kind==="nonmagical-resistance");
        let targets=[];
        if(silencer && silencer.ammunition.includes(context.ammunitionFamily)){
          if(source?.actor?.uuid!==actor.uuid){globalThis.ui?.notifications?.warn?.("Для проверки глушителя выберите точный токен стрелка.");continue;}
          targets=Array.from(source.parent?.tokens?.contents??source.parent?.tokens?.values?.()??[]).filter(token=>{
            if(!token.actor || token.actor.uuid===actor.uuid)return false;
            const distance=this.getWeaponModTargetConditions(actor,context,token).distanceFeet;return Number.isFinite(distance)&&distance<=silencer.radiusFeet;
          });
        }else if(projectile){
          const attack=this.getWeaponModAttackContext(message,context.activityUuid),uuids=new Set([...context.targetUuids??[],...this.getWeaponModScatterHits(attack).map(hit=>hit.uuid)]);
          for(const uuid of uuids){const token=await globalThis.fromUuid(uuid);if(token)targets.push(token);}
        }
        for(const target of targets){
          if(!isActiveGmClient(game))return;
          await this.resolveWeaponModTargetEffects({actorUuid:actor.uuid,hostItemId:host.id,childItemId:mod.itemId,activityId:context.activityUuid.split(".").at(-1),
            operationId:globalThis.crypto.randomUUID(),decision:{kind:"target-effects",targetUuid:target.uuid,attackMessageId:message.id,targetVisible:null,canHear:null,hiddenFromTarget:null,materialTarget:null}});
        }
      }
    }
  }

  async promptWeaponModChoice(title,entries){
    if(entries.length===1)return entries[0].id;
    if(!entries.length)throw new Error("Нет подходящих доступных экземпляров.");
    const dialog=globalThis.foundry?.applications?.api?.DialogV2;
    if(!dialog?.wait)throw new Error("Выберите экземпляр: окно выбора недоступно.");
    const escape=value=>String(value??"").replace(/[&<>"']/gu,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
    const result=await dialog.wait({window:{title},content:`<label>Экземпляр <select name="choice">${entries.map(entry=>`<option value="${escape(entry.id)}">${escape(entry.name)}</option>`).join("")}</select></label>`,
      buttons:[{action:"apply",label:"Выбрать",default:true,callback:(_event,button)=>button.form.elements.namedItem("choice").value},{action:"cancel",label:"Отмена",callback:()=>false}],close:()=>false});
    return typeof result==="string" && entries.some(entry=>entry.id===result)?result:null;
  }

  async promptWeaponModGrenadeRule({source}){
    if(!globalThis.game.user?.isGM)throw new Error("Недостающие правила гранаты подтверждает активный мастер.");
    const dialog=globalThis.foundry?.applications?.api?.DialogV2;
    if(!dialog?.wait)throw new Error("Окно решения мастера недоступно; граната не израсходована.");
    const escape=value=>String(value??"").replace(/[&<>"']/gu,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])),profile=source.explosive;
    return dialog.wait({window:{title:`Гранатомёт: ${source.name}`},content:`<p>Сл ${profile.saveDc}, радиус ${profile.radius} фт. ${escape(profile.propertiesText)} Задержка: ${escape(profile.delay)}.</p>
      <label>Спасбросок ${profile.saveAbility?escape(profile.saveAbility):'<select name="ability"><option value="">Выберите</option>'+["str","dex","con","int","wis","cha"].map(value=>`<option value="${value}">${value.toUpperCase()}</option>`).join("")+'</select>'}</label>
      <label>Урон при успехе <select name="onSave"><option value="">Выберите</option><option value="none">Нет урона</option><option value="half">Половина</option><option value="full">Полный</option></select></label>
      <label><input type="checkbox" name="manual"> Особые свойства, задержку и выбор целей разрешаю вручную по описанию гранаты.</label>`,
      buttons:[{action:"apply",label:"Подготовить",default:true,callback:(_event,button)=>{const elements=button.form.elements;
        return {saveAbility:profile.saveAbility??elements.namedItem("ability").value,onSave:elements.namedItem("onSave").value,manualSpecial:elements.namedItem("manual").checked};}},
      {action:"cancel",label:"Отмена",callback:()=>false}],close:()=>false});
  }

  deferWeaponModUtility(activity){
    const definition=this.getManagedWeaponModActivityDefinition(activity);
    if(!definition || ["bayonet-attack","launcher-shot"].includes(definition.marker.action))return null;
    const {actor,host,mod,marker,effect}=definition,key=`${actor.uuid}:${host.id}:${activity.id??activity._id}`;
    let state=this._weaponModUtilityRequests.get(key);
    if(state?.running)return false;
    state??={operationId:globalThis.crypto.randomUUID(),payload:null};state.running=true;this._weaponModUtilityRequests.set(key,state);
    void(async()=>{
      if(!state.payload){
        let decision=null;
        if(marker.action==="aim"){
          const known=this.getWeaponModAttackConditions(activity,null,{});
          if(known.movedFeet==null){decision=await this.promptWeaponModConditions(activity,null,known,[{field:"movedFeet"}]);if(!decision){this._weaponModUtilityRequests.delete(key);return;}}
        }else if(marker.action==="flashlight-toggle" && !mod.item.getFlag?.(MODULE_ID,"weaponModLight")?.enabled){
          const tokens=Array.from(actor.getActiveTokens?.(true,true)??[]).map(token=>token.document??token).filter(token=>token.actor?.uuid===actor.uuid);
          if(actor.token?.actor?.uuid===actor.uuid && !tokens.some(token=>token.uuid===actor.token.uuid))tokens.push(actor.token);
          const tokenUuid=await this.promptWeaponModChoice("Токен фонарика",tokens.map(token=>({id:token.uuid,name:token.name??actor.name})));
          if(!tokenUuid){this._weaponModUtilityRequests.delete(key);return;}decision={kind:"light-token",tokenUuid};
        }else if(marker.action==="launcher-fire"){
          const previous=host.getFlag?.(MODULE_ID,"weaponModShot");
          if(previous?.phase==="consumed"){
            if(previous.ownerUserId!==globalThis.game.user.id)throw new Error("Карточку предыдущего выстрела восстанавливает стрелок.");
            state.shot=previous;
          }else{
            const catalog=this.moduleApi.itemUpgradeAutomationService.weaponModCatalog,items=Array.from(actor.items?.contents??actor.items?.values?.()??[]),
              entries=items.filter(item=>item.system?.container===mod.itemId && Number(item.system.quantity)===1
                && getWeaponModGrenadeCandidate(item,{sources:catalog.gearById,allowedSourceIds:effect.grenadeSourceIds}).available).map(item=>({id:item.id,name:item.name}));
            const grenadeItemId=await this.promptWeaponModChoice("Граната для выстрела",entries);
            if(!grenadeItemId){this._weaponModUtilityRequests.delete(key);return;}decision={kind:"launcher-prepare",grenadeItemId};
          }
        }else if(marker.action==="launcher-load"){
          const catalog=this.moduleApi.itemUpgradeAutomationService.weaponModCatalog,items=Array.from(actor.items?.contents??actor.items?.values?.()??[]),
            entries=items.filter(item=>{
              const candidate=getWeaponModGrenadeCandidate(item,{sources:catalog.gearById,allowedSourceIds:effect.grenadeSourceIds}),container=actor.items.get(item.system?.container);
              return candidate.available && candidate.quantity>0 && !container?.getFlag?.(MODULE_ID,"installedWeaponMod");
            }).map(item=>({id:item.id,name:`${item.name} ×${item.system.quantity}`}));
          const grenadeItemId=await this.promptWeaponModChoice("Граната для загрузки",entries);
          if(!grenadeItemId){this._weaponModUtilityRequests.delete(key);return;}decision={kind:"launcher-load",grenadeItemId};
        }
        state.payload={actorUuid:actor.uuid,hostItemId:host.id,childItemId:mod.itemId,activityId:activity.id??activity._id,operationId:state.operationId,decision};
      }
      const result=state.shot?{shot:state.shot}:await this.moduleApi.useWeaponModActivity(state.payload);
      if(result.shot){
        const native=host.system.activities.get?.(result.shot.activityId);
        if(!native?.use)throw new Error("Действие гранаты обновляется. Повторите выстрел для продолжения без повторного расхода.");
        await native.use({rebreyaWeaponModShot:result.shot});
      }
      this._weaponModUtilityRequests.delete(key);
    })().catch(error=>{
      if(error.code==="weapon-mod-cancelled")this._weaponModUtilityRequests.delete(key);
      globalThis.ui?.notifications?.warn?.(error.message);
    }).finally(()=>state.running=false);
    return false;
  }

  hydrateWeaponModAttackConditions(config,message={}) {
    if(config.rebreyaWeaponModDecisions)return;
    const activity=config.subject,id=message.data?.flags?.dnd5e?.originatingMessage??message.data?.["flags.dnd5e.originatingMessage"]
      ??config.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId;
    const origin=globalThis.game?.messages?.get?.(id),stored=origin?.getFlag?.(MODULE_ID,"weaponModConditions");
    if(!origin || !stored || !Array.isArray(stored.decisions) || stored.decisions.length>20 || origin.getFlag?.("dnd5e","activity.uuid")!==activity?.uuid || stored.activityUuid!==activity.uuid
      || stored.actorUuid!==(activity.item?.actor??activity.item?.parent)?.uuid || stored.hostItemId!==activity.item.id)return;
    config.rebreyaWeaponModAttackMessageId=origin.id;
    config.rebreyaWeaponModDecisions=stored.decisions.map(decision=>({...decision,attackMessageId:origin.id}));
  }

  getWeaponModRangeResolution(activity,target,multiplier) {
    const item=activity?.item,actor=item?.actor??item?.parent,
      range=this.moduleApi.itemUpgradeAutomationService?.getWeaponModActivityRangeState?.(activity)??activity?.range??item?.system?.range??{};
    const normal=convertUnitsToFeet(Number(range.value),range.units??"ft")*multiplier,
      long=convertUnitsToFeet(Number(range.long||range.value),range.units??"ft")*multiplier;
    const tokens=actor?.getActiveTokens?.()??[],source=actor?.token??(tokens.length===1?tokens[0]:tokens.find(token=>token.controlled));
    const targetDocument=target?.document??target;
    const distance=source && targetDocument && [targetDocument.x,targetDocument.y].every(Number.isFinite)
      ?convertUnitsToFeet(measureStorageTokenDistance(source,target),source.parent?.grid?.units??source.document?.parent?.grid?.units??"ft"):null;
    if(!Number.isFinite(normal) || normal<=0 || !Number.isFinite(long) || !Number.isFinite(distance))return {normal,long,distanceFeet:null,allowed:true,disadvantage:false};
    return {normal,long,distanceFeet:distance,allowed:distance<=Math.max(normal,long),disadvantage:distance>normal};
  }

  getWeaponModLightConfiguration(effect,token){
    const units=token.parent?.grid?.units??"ft";
    return {bright:convertFeetToUnits(effect.bright,units),dim:convertFeetToUnits(effect.dim,units),angle:60};
  }

  async planWeaponModActivity({actor,host,definition,decision,sender}) {
    const {marker,effect}=definition,path=`flags.${MODULE_ID}.weaponModAim`,before=host.getFlag?.(MODULE_ID,"weaponModAim")??host.flags?.[MODULE_ID]?.weaponModAim??null;
    if(effect.kind==="flashlight"){
      const child=definition.mod.item,lightPath=`flags.${MODULE_ID}.weaponModLight`,previous=child.getFlag?.(MODULE_ID,"weaponModLight")??null;
      let next={enabled:false,tokenUuid:previous?.tokenUuid??null};
      if(!previous?.enabled){
        const token=decision?.kind==="light-token"?await globalThis.fromUuid?.(decision.tokenUuid):null;
        if(!token || token.actor?.uuid!==actor.uuid || !token.parent?.uuid || (!sender?.isGM && sender?.viewedScene!==token.parent.id))throw new Error("Выберите один токен владельца оружия на своей сцене.");
        next={enabled:true,tokenUuid:token.uuid};
      }
      return {placement:[{actor:"source",itemId:child.id,before:{[lightPath]:previous},after:{[lightPath]:next}}],value:{hostItemId:host.id,childItemId:child.id,action:marker.action,enabled:next.enabled}};
    }
    if(effect.kind!=="aim")throw new Error("Действие обвеса пока не поддерживается.");
    let after=null;
    if(marker.action==="aim"){
      const combat=globalThis.game?.combat;
      if(!combat || combat.started===false || !isCombatActorActive(combat,actor))throw new Error("Прицеливаться можно в своём ходу.");
      const known=this.getWeaponModAttackConditions({item:host,actor},null,{}),conditions=decision?resolveWeaponModConditions(known,decision):known;
      if(conditions.movedFeet==null)throw new Error("Уточните перемещение в этом ходу.");
      if(conditions.movedFeet>effect.maximumMovedFeet)throw new Error("Превышено допустимое перемещение для прицеливания.");
      after={actorUuid:actor.uuid,hostItemId:host.id,childItemId:marker.childItemId,mode:effect.mode,combatId:combat.id,round:combat.round,turn:combat.turn,movedFeet:conditions.movedFeet};
    }
    return {placement:[{actor:"source",itemId:host.id,before:{[path]:before},after:{[path]:after}}],value:{hostItemId:host.id,childItemId:marker.childItemId,action:marker.action}};
  }

  /** Synchronous native hook gate: unknown facts are resolved before native consumption/roll modifiers. */
  deferWeaponModAttack(activity,config={},dialog={},message={},method="use") {
    const host=activity?.item,actor=host?.actor??host?.parent;
    if(!actor)return true;
    const contributions=this.moduleApi.itemUpgradeAutomationService?.project?.(actor,host)?.contributions??[];
    if(!contributions.some(c=>c.scope==="weapon-mod" && c.hostItemId===host.id) && !isFirearmItem(host))return true;
    const targets=Array.from(config.targets??config.workflow?.targets??globalThis.game?.user?.targets??[]),rows=[];
    try{
      for(const target of targets.length?targets:[null]){
        const conditions=this.getWeaponModAttackConditions(activity,target,config),result=evaluateWeaponModAttack({host:{id:host.id,isFirearm:isFirearmItem(host)},
          attack:{type:activity.actionType==="mwak" || activity.attack?.type?.value==="melee"?"melee":"ranged"},target:{uuid:target?.document?.uuid??target?.uuid??null},contributions,conditions});
        if(!result.allowed){globalThis.ui?.notifications?.warn?.(result.diagnostics[0]?.reason??"Условия обвеса не выполнены.");return false;}
        if(!result.needsDecision.length && result.rangeMultiplier!==1 && !this.getWeaponModRangeResolution(activity,target,result.rangeMultiplier).allowed){
          globalThis.ui?.notifications?.warn?.("Цель вне дистанции оружия с выбранным обвесом.");return false;
        }
        rows.push({target,conditions,result});
      }
    }catch(error){globalThis.ui?.notifications?.warn?.(error.message);return false;}
    if(!rows.some(row=>row.result.needsDecision.length))return true;
    if(this._weaponModDeferred.has(config))return false;
    this._weaponModDeferred.add(config);
    void(async()=>{
      const decisions=[];
      for(const row of rows){
        if(!row.result.needsDecision.length)continue;
        const decision=await this.promptWeaponModConditions(activity,row.target,row.conditions,row.result.needsDecision);
        if(!decision)return;
        decision.attackMessageId=config.rebreyaWeaponModAttackMessageId??null;
        // Reread live facts after the dialog; a response cannot overwrite a changed native fact.
        resolveWeaponModConditions(this.getWeaponModAttackConditions(activity,row.target,{}),decision,{targetUuid:row.target?.document?.uuid??row.target?.uuid??null,attackMessageId:config.rebreyaWeaponModAttackMessageId??null});
        decisions.push(decision);
      }
      const resume={...config,rebreyaWeaponModDecisions:decisions};
      if(method==="rollAttack"){
        resume.rolls=config.rolls?.map(roll=>({...roll,parts:roll.parts?[...roll.parts]:undefined,options:{...roll.options}}));
        if(resume.hookNames?.slice(-2).join(",")==="attack,d20Test")resume.hookNames=resume.hookNames.slice(0,-2);
        await activity.rollAttack(resume,dialog,message);
      }else{
        const resumeMessage={...message,data:{...message.data,flags:{...message.data?.flags,[MODULE_ID]:{...message.data?.flags?.[MODULE_ID],
          weaponModConditions:{activityUuid:activity.uuid,actorUuid:actor.uuid,hostItemId:host.id,decisions}}}}};
        await activity.use(resume,dialog,resumeMessage);
      }
    })().catch(error=>globalThis.ui?.notifications?.warn?.(error.message)).finally(()=>this._weaponModDeferred.delete(config));
    return false;
  }

  async promptWeaponModConditions(activity,target,known,needed) {
    const dialog=globalThis.foundry?.applications?.api?.DialogV2;
    if(!dialog?.wait)throw new Error("Неизвестны условия атаки; окно уточнения недоступно.");
    const labels={movedFeet:"Перемещение в этом ходу (футы)",prone:"Вы лежите?",targetVisible:"Вы видите эту цель?",usesProficiency:"Атака с владением?",underwater:"Стрельба под водой?"};
    const fields=[...new Set(needed.map(entry=>entry.field))],escape=value=>String(value??"").replace(/[&<>"']/gu,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
    const content=`<p>${escape(activity.item.name)}${target?` → ${escape(target.name??target.document?.name)}`:""}</p>`+fields.map(field=>`<label>${labels[field]} ${field==="movedFeet"?`<input name="${field}" type="number" min="0" step="any" required>`:`<select name="${field}" required><option value="">Уточните</option><option value="true">Да</option><option value="false">Нет</option></select>`}</label>`).join("");
    const response=await dialog.wait({window:{title:"Условия атаки"},content,buttons:[{action:"apply",label:"Продолжить",default:true,callback:(_event,button)=>{
      const form=button.form??button.closest?.("form");if(!form?.reportValidity?.())return false;
      const decision={kind:"attack-conditions",targetUuid:target?.document?.uuid??target?.uuid??null,attackMessageId:null,...Object.fromEntries(WEAPON_MOD_CONDITION_FIELDS.map(field=>[field,known[field]??null]))};
      for(const field of fields){const value=form.elements.namedItem(field).value;decision[field]=field==="movedFeet"?Number(value):value==="true";}
      return decision;
    }},{action:"cancel",label:"Отмена",callback:()=>false}],close:()=>false});
    return response && typeof response==="object"?response:null;
  }

  async handleGroupedCombatPhase(combat, phase) {
    if (phase.kind === "each-turn") {
      const state = combat.flags?.[MODULE_ID]?.groupedCombat;
      const group = state?.groups.find(g => g.id === phase.groupId);
      return this.handleWeaponModTurnChange(combat, { activeCombatants: combatantsOf(combat).filter(c => group?.memberIds.includes(c.id)) });
    }
    if (phase.kind === "turn-start") for (const c of combatantsOf(combat).filter(c => phase.memberIds.includes(c.id))) {
      await this.refreshReaction(c.actor, { combat, round: phase.round, turn: combat.turn });
    }
  }

  async handleWeaponModTurnChange(combat,{ended=false,activeCombatants=null}={}) {
    if(!isActiveGmClient(globalThis.game))return;
    const actors=new Map(Array.from(combat?.combatants?.contents??combat?.combatants??[]).map(combatant=>[combatant.actor?.uuid,combatant.actor]));
    if(combat?.combatant?.actor)actors.set(combat.combatant.actor.uuid,combat.combatant.actor);
    const active = new Map((activeCombatants ?? [combat?.combatant]).filter(Boolean).map(c => [c.actor?.uuid, c]));
    for(const actor of actors.values()){
      if(!actor?.uuid)continue;
      await this.moduleApi.inventoryService?.mutationCoordinator.run(`inventory-organization:${actor.id}`,async()=>{
        if(!isActiveGmClient(globalThis.game))return;
        for(const host of actor.items?.contents??[]){
          const aim=host.getFlag?.(MODULE_ID,"weaponModAim");
          if(aim && (ended || aim.combatId!==combat.id || aim.round!==combat.round || aim.turn!==combat.turn || !active.has(actor.uuid))){
            if(!isActiveGmClient(globalThis.game))return;
            await host.update({[`flags.${MODULE_ID}.-=weaponModAim`]:null},{render:false});
          }
        }
        if(!ended && active.has(actor.uuid)){
          const token=active.get(actor.uuid).token,current=actor.getFlag?.(MODULE_ID,"weaponModMovement");
          if(current?.combatId===combat.id && current.round===combat.round && current.turn===combat.turn)return;
          if(!isActiveGmClient(globalThis.game))return;
          await actor.update({[`flags.${MODULE_ID}.==weaponModMovement`]:{combatId:combat.id,round:combat.round,turn:combat.turn,feet:0,
            tokenId:token?.id??null,position:token?{x:token.x,y:token.y}:null,lastMovementId:null}});
        }
      });
      await this.moduleApi.itemUpgradeAutomationService?.requestSync?.(actor);
    }
  }

  async handleWeaponModTokenMove(token,changed={}) {
    if(!isActiveGmClient(globalThis.game) || !["x","y","elevation"].some(key=>Object.hasOwn(changed,key)))return;
    const actor=token?.actor,combat=globalThis.game?.combat;
    if(!actor?.uuid || !isCombatActorActive(combat,actor))return;
    // Native v13 movement measures the entire travelled path, including intermediate waypoints.
    const movement=token.movement,passed=movement?.passed,increment=passed?.waypoints?.some(point=>point.action==="displace" || globalThis.CONFIG?.Token?.movement?.actions?.[point.action]?.teleport)
      ?null:Number.isFinite(passed?.distance)?convertUnitsToFeet(passed.distance,token.parent?.grid?.units??"ft"):null;
    await this.moduleApi.inventoryService?.mutationCoordinator.run(`inventory-organization:${actor.id}`,async()=>{
      if(!isActiveGmClient(globalThis.game))return;
      const previous=actor.getFlag?.(MODULE_ID,"weaponModMovement"),sameTurn=previous?.combatId===combat.id && previous.round===combat.round && previous.turn===combat.turn;
      if(movement?.id && sameTurn && previous.lastMovementId===movement.id)return;
      const feet=sameTurn && previous.tokenId===token.id && Number.isFinite(previous.feet) && increment!==null?previous.feet+increment:null;
      await actor.update({[`flags.${MODULE_ID}.==weaponModMovement`]:{combatId:combat.id,round:combat.round,turn:combat.turn,feet,
        tokenId:token.id,position:{x:token.x,y:token.y},lastMovementId:movement?.id??null}});
      for(const host of actor.items?.contents??[]){
        if(!host.getFlag?.(MODULE_ID,"weaponModAim"))continue;
        if(!isActiveGmClient(globalThis.game))return;
        await host.update({[`flags.${MODULE_ID}.-=weaponModAim`]:null},{render:false});
      }
    });
    await this.moduleApi.itemUpgradeAutomationService?.requestSync?.(actor);
  }

  async initialize() {
    registerWhirlwindNativeTargetOptions();
    const queue = this.moduleApi?.reactionQueueService;
    if (typeof queue?.registerType === "function") {
      queue.registerType(PROVOKED_ATTACK_REACTION_KIND, this.#attackReactionProvider(PROVOKED_ATTACK_REACTION_KIND));
      queue.registerType(PARRY_REACTION_KIND, this.#attackReactionProvider(PARRY_REACTION_KIND));
      queue.registerType(INTERCEPTION_REACTION_KIND, this.#attackReactionProvider(INTERCEPTION_REACTION_KIND));
    }
    this.refreshFirearmChatActions();
    return queue ?? null;
  }

  refreshFirearmChatActions(root=globalThis.document) {
    for(const element of root?.querySelectorAll?.("[data-message-id]")??[]){
      const message=game.messages?.get?.(element.dataset.messageId);if(message)this.renderFirearmChatActions(message,element);
    }
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

  #parseFirstPositiveInteger(value) {
    const match = String(value ?? "").match(/\d+/u);
    if (!match) {
      return 0;
    }

    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }

  #resolveFirearmReloadCapacity(item, options = {}) {
    const explicit = toNumber(options.firearmAmmoCapacity ?? options.ammoCapacity, NaN);
    if (Number.isFinite(explicit)) {
      return Math.max(0, Math.floor(explicit));
    }

    const values = this.#getLichWeaponPropertyValues(item, options);
    const fromReload = this.#parseFirstPositiveInteger(values.reload);
    if (fromReload > 0) {
      const state=readDocumentFlag(item,MODULE_ID,FIREARM_AMMO_STATE_FLAG);
      if(state?.baseCapacity===fromReload && Number.isSafeInteger(state.capacity) && state.capacity>0)return state.capacity;
      return fromReload;
    }

    const state = readDocumentFlag(item, MODULE_ID, FIREARM_AMMO_STATE_FLAG);
    const fromState = toNumber(state?.capacity, NaN);
    return Number.isFinite(fromState) ? Math.max(0, Math.floor(fromState)) : 0;
  }

  #projectMagazineState(state) {
    const {rounds,sources}=magazineRounds(state),renamed={};
    for(const [key,data] of Object.entries(sources)){
      if(data.flags?.[MODULE_ID]?.ammunition!=null || !resolveAmmunitionProfile(data,{gearById:this.moduleApi?.repository?.model?.gearById}))continue;
      const captured=this.#captureAmmunition(data);renamed[key]=captured.key;
      if(key!==captured.key)delete sources[key];sources[captured.key]=captured.data;
    }
    const remap=keys=>keys.map(key=>renamed[key]??key);
    return {schemaVersion:2,rounds:remap(rounds),sources,presets:(state.presets??[]).map(p=>({...p,rounds:remap(p.rounds)})),lastPattern:remap(state.lastPattern??[])};
  }

  #resolveFirearmAmmoState(item, options = {}) {
    const state = readDocumentFlag(item, MODULE_ID, FIREARM_AMMO_STATE_FLAG);
    const values = this.#getLichWeaponPropertyValues(item, options);
    const capacity = this.#resolveFirearmReloadCapacity(item, options);
    const explicitCurrent = toNumber(options.firearmAmmoCurrent ?? options.ammoCurrent, NaN);
    const stateCurrent = toNumber(state?.current, NaN);
    const current = Number.isFinite(explicitCurrent)
      ? explicitCurrent
      : (Number.isFinite(stateCurrent) ? stateCurrent : 0);

    const ordered=state?.schemaVersion===2?this.#projectMagazineState(state):{};
    return {
      ...ordered,
      tracked: capacity > 0,
      current: capacity > 0 ? clampInteger(current, 0, capacity) : 0,
      capacity,
      ...(Number.isSafeInteger(state?.baseCapacity)?{baseCapacity:state.baseCapacity}:{}),
      ammunition: cleanText(options.ammunition ?? state?.ammunition ?? values.ammunition),
      reload: cleanText(values.reload),
      fireMode: cleanText(values.fireMode)
    };
  }

  #resolveFirearmFireMode(item, options = {}) {
    const values = this.#getLichWeaponPropertyValues(item, options);
    const modeText = normalizeLookupText(values.fireMode);
    if (modeText.includes("полуавтомат")) {
      return "semi";
    }

    if (modeText.includes("автомат")) {
      return "automatic";
    }

    if (this.#hasItemProperty(item, "lchFirearmSemiAutomatic")) {
      return "semi";
    }

    if (this.#hasItemProperty(item, "lchFirearmAutomatic")) {
      return "automatic";
    }

    return "single";
  }

  #resolveFirearmShotAmmoCost(item, options = {}) {
    const explicit = toNumber(options.firearmAmmoCost ?? options.ammoCost, NaN);
    if (Number.isFinite(explicit)) {
      return Math.max(0, Math.floor(explicit));
    }

    const state = this.#resolveFirearmAmmoState(item, options);
    const mode = this.#resolveFirearmFireMode(item, options);
    if (mode === "semi") {
      return 3;
    }

    if (mode === "automatic") {
      return 6;
    }

    return 1;
  }

  #getFirearmAmmoShotBlock(item, options = {}) {
    if (!isFirearmItem(item)) {
      return null;
    }

    const state = this.#resolveFirearmAmmoState(item, options);
    if (!state.tracked) {
      return null;
    }

    const required = Math.max(1, this.#resolveFirearmShotAmmoCost(item, options));
    if (state.schemaVersion === 2 && new Set(state.rounds.slice(0, required)).size > 1) {
      return { reason: "firearmAmmoMixed", current: state.current, capacity: state.capacity, required, state };
    }
    if (state.current <= 0) {
      return {
        reason: "firearmAmmoEmpty",
        current: 0,
        capacity: state.capacity,
        required,
        state
      };
    }

    if (state.current < required) {
      return {
        reason: "firearmAmmoInsufficient",
        current: state.current,
        capacity: state.capacity,
        required,
        state
      };
    }

    return null;
  }

  #blockFirearmShotWithoutAmmo(item, options = {}) {
    const block = this.#getFirearmAmmoShotBlock(item, options);
    if (!block) {
      return false;
    }

    this.#setFirearmAmmoStateSync(item, block.state);
    if (block.reason === "firearmAmmoMixed") {
      ui.notifications?.warn?.("В одной очереди должны быть одинаковые патроны. Откройте перезарядку.");
      return true;
    }
    if (block.reason === "firearmAmmoInsufficient") {
      this.#notifyFirearmAmmoInsufficient(item, block.current, block.required);
    }
    else {
      this.#notifyFirearmAmmoEmpty(item);
    }
    return true;
  }

  #createFirearmChatMessage(actor, item, content, options = {}) {
    if (options.createMessage === false) {
      return;
    }

    const safeContent = cleanText(content);
    if (!safeContent) {
      return;
    }

    if (!options.firearmOwnerOnly && this.#appendFirearmChatNote(options, safeContent, options.firearmReload)) {
      return;
    }

    if (typeof ChatMessage?.create !== "function") {
      return;
    }

    const userId = String(game.user?.id ?? "").trim();
    Promise.resolve(ChatMessage.create({
      ...(userId ? { user: userId } : {}),
      ...(options.firearmOwnerOnly && userId ? {whisper:[userId]} : {}),
      speaker: ChatMessage.getSpeaker?.({ actor }) ?? {},
      ...(options.firearmReload ? {flags:{[MODULE_ID]:{[FIREARM_RELOAD_CHAT_FLAG]:options.firearmReload}}} : {}),
      content: this.#buildFirearmChatCardNotesHtml([safeContent]),
      flavor: item?.name ?? ""
    })).catch((error) => {
      console.error(`${MODULE_ID} | Failed to create firearm chat message.`, error);
    });
  }

  #appendFirearmChatNote(options = {}, content = "", reloadTarget = null) {
    const messageConfig = options?.messageConfig ?? null;
    const safeContent = cleanText(content);
    if (!safeContent || !isPlainObject(messageConfig)) {
      return false;
    }

    if (!isPlainObject(messageConfig.data)) {
      messageConfig.data = {};
    }
    if (reloadTarget) foundry.utils.setProperty(messageConfig.data, `flags.${MODULE_ID}.${FIREARM_RELOAD_CHAT_FLAG}`, reloadTarget);
    const currentFlavor = cleanText(messageConfig.data.flavor ?? messageConfig.flavor);
    messageConfig.data.flavor = [currentFlavor, this.#buildFirearmChatCardNotesHtml([safeContent])].filter(Boolean).join("<br>");
    const notes = this.#appendFirearmChatCardNote(messageConfig, safeContent);
    if(!options.deferFirearmChatSync)this.#syncFirearmChatCardNotes(options, notes);
    return true;
  }

  #appendFirearmChatCardNote(messageConfig, content) {
    const safeContent = cleanText(content);
    if (!safeContent || !isPlainObject(messageConfig)) {
      return [];
    }

    if (!isPlainObject(messageConfig.data)) {
      messageConfig.data = {};
    }

    const notesPath = `flags.${MODULE_ID}.${FIREARM_CHAT_NOTES_FLAG}`;
    const existingNotes = foundry.utils.getProperty(messageConfig.data, notesPath);
    const notes = Array.isArray(existingNotes)
      ? existingNotes.map((note) => cleanText(note)).filter(Boolean)
      : [];
    if (!notes.includes(safeContent)) {
      notes.push(safeContent);
    }
    foundry.utils.setProperty(messageConfig.data, notesPath, notes);
    return notes;
  }

  #syncFirearmChatCardNotes(options = {}, notes = []) {
    const safeNotes = Array.isArray(notes)
      ? notes.map((note) => cleanText(note)).filter(Boolean)
      : [];
    if (!safeNotes.length) {
      return false;
    }

    const message = this.#resolveFirearmOriginatingMessage(options);
    if (!message || typeof message.update !== "function") {
      return false;
    }

    const content = cleanText(message.content);
    if (!content) {
      return false;
    }

    const nextContent = this.#withFirearmChatCardNotes(content, safeNotes);
    const reloadTarget=foundry.utils.getProperty(options.messageConfig?.data,`flags.${MODULE_ID}.${FIREARM_RELOAD_CHAT_FLAG}`);
    const misfire=foundry.utils.getProperty(options.messageConfig?.data,`flags.${MODULE_ID}.${FIREARM_MISFIRE_CHAT_FLAG}`);
    const update = {
      ...(misfire?{[`flags.${MODULE_ID}.-=${FIREARM_MISFIRE_CHAT_FLAG}`]:null}:{}),
      ...(options.ammunitionPatch??{}),
      ...(reloadTarget?{[`flags.${MODULE_ID}.${FIREARM_RELOAD_CHAT_FLAG}`]:reloadTarget}:{}),
      ...(misfire?{[`flags.${MODULE_ID}.${FIREARM_MISFIRE_CHAT_FLAG}`]:misfire}:{}),
      [`flags.${MODULE_ID}.${FIREARM_CHAT_NOTES_FLAG}`]: safeNotes
    };
    if (nextContent !== content) {
      update.content = nextContent;
    }

    Promise.resolve(message.update(update)).catch((error) => {
      console.error(`${MODULE_ID} | Failed to update firearm attack chat card notes.`, error);
      if(typeof ChatMessage?.create!=="function")return;
      Promise.resolve(ChatMessage.create({
        ...(game.user?.id?{user:game.user.id}:{}),
        ...(message.speaker?{speaker:message.speaker}:{}),
        ...(safeNotes.every(note=>note.startsWith("Магазин пуст."))?{whisper:[game.user.id]}:message.whisper?{whisper:message.whisper}:{}),
        ...(message.blind?{blind:true}:{}),
        ...((reloadTarget||misfire)?{flags:{[MODULE_ID]:{...(reloadTarget?{[FIREARM_RELOAD_CHAT_FLAG]:reloadTarget}:{}),...(misfire?{[FIREARM_MISFIRE_CHAT_FLAG]:misfire}:{})}}}:{}),
        content:this.#buildFirearmChatCardNotesHtml(safeNotes)
      })).catch(fallbackError=>console.error(`${MODULE_ID} | Failed to publish firearm chat notes.`,fallbackError));
    });
    return true;
  }

  #resolveFirearmOriginatingMessage(options = {}) {
    const messageConfig = options?.messageConfig ?? null;
    const directMessage = options?.message ?? null;
    if (directMessage && typeof directMessage.update === "function") {
      return directMessage;
    }

    const itemCardUuids = [
      foundry.utils.getProperty(options, "workflow.itemCardUuid"),
      foundry.utils.getProperty(options, "midiOptions.workflow.itemCardUuid"),
      foundry.utils.getProperty(options, "midiOptions.itemCardUuid")
    ].map((value) => cleanText(value)).filter(Boolean);
    for (const itemCardUuid of itemCardUuids) {
      const message = this.#resolveFirearmMessageUuid(itemCardUuid);
      if (message) {
        return message;
      }
    }

    const itemCardIds = [
      foundry.utils.getProperty(messageConfig, "data.flags.dnd5e.originatingMessage"),
      foundry.utils.getProperty(options, "workflow.itemCardId"),
      foundry.utils.getProperty(options, "midiOptions.workflow.itemCardId"),
      options?.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId
    ].map((value) => cleanText(value)).filter(Boolean);
    for (const itemCardId of itemCardIds) {
      const message = game.messages?.get?.(itemCardId);
      if (message) {
        return message;
      }
    }

    return null;
  }

  #resolveFirearmMessageUuid(uuid) {
    const safeUuid = cleanText(uuid);
    if (!safeUuid) {
      return null;
    }

    try {
      if (typeof globalThis.fromUuidSync === "function") {
        const document = globalThis.fromUuidSync(safeUuid);
        if (document) {
          return document;
        }
      }
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to resolve firearm attack chat card UUID.`, error);
    }

    const match = safeUuid.match(/(?:^|\.)([^.]+)$/u);
    const messageId = cleanText(match?.[1]);
    return messageId ? (game.messages?.get?.(messageId) ?? null) : null;
  }

  #withFirearmChatCardNotes(content, notes = []) {
    const safeContent = String(content ?? "");
    const safeNotes = Array.isArray(notes)
      ? notes.map((note) => cleanText(note)).filter(Boolean)
      : [];
    if (!safeContent || !safeNotes.length) {
      return safeContent;
    }

    const html = this.#buildFirearmChatCardNotesHtml(safeNotes);
    const existingPattern = /<p\b[^>]*data-rebreya-firearm-chat-notes=["']true["'][\s\S]*?<\/p>/u;
    if (existingPattern.test(safeContent)) {
      return safeContent.replace(existingPattern, html);
    }

    if (/<ul\b[^>]*class=["'][^"']*\bcard-footer\b/u.test(safeContent)) {
      return safeContent.replace(/(\s*<ul\b[^>]*class=["'][^"']*\bcard-footer\b)/u, `\n${html}$1`);
    }

    if (/<\/div>\s*$/u.test(safeContent)) {
      return safeContent.replace(/<\/div>\s*$/u, `${html}\n</div>`);
    }

    return `${safeContent}\n${html}`;
  }

  #buildFirearmChatCardNotesHtml(notes = []) {
    const jammed=notes.some(note=>String(note).includes("(заклинено)"));
    const reload=notes.some(note=>String(note).includes("Магазин пуст."));
    const icon=jammed?"fa-triangle-exclamation":"fa-crosshairs";
    const badge=reload?'<span class="rm-firearm-reload-icon" data-rebreya-firearm-owner-only hidden title="Нужна перезарядка"><i class="fa-solid fa-rotate"></i></span>':"";
    const rows = notes
      .flatMap((note) => cleanText(note).split("\n"))
      .filter(Boolean)
      .map((note) => `<span${note.startsWith("Магазин пуст.") ? ' data-rebreya-firearm-owner-only hidden' : ''}>${escapeHtml(note)}</span>`)
      .join("");
    return `<p class="supplement rm-reaction-chat rebreya-firearm-chat-notes" data-rebreya-firearm-chat-notes="true"><span class="rm-reaction-chat__icon" aria-hidden="true"><i class="fa-solid ${icon}"></i>${badge}</span><span class="rm-reaction-chat__body"><span class="rm-reaction-chat__label">Огнестрел</span><span class="rm-reaction-chat__text">${rows}</span></span></p>`;
  }

  #notifyFirearmAmmoEmpty(item) {
    const weaponName = item?.name ?? "Оружие";
    ui.notifications?.warn?.(`${weaponName}: магазин пуст. Перезарядите оружие перед выстрелом.`);
  }

  #notifyFirearmAmmoInsufficient(item, current, required) {
    const weaponName = item?.name ?? "Оружие";
    ui.notifications?.warn?.(`${weaponName}: не хватает патронов в магазине (${current}/${required}).`);
  }

  #setFirearmAmmoStateSync(item, state, { persist = true } = {}) {
    const capacity = Math.max(0, Math.floor(toNumber(state?.capacity, 0)));
    const current = capacity > 0 ? clampInteger(state?.current, 0, capacity) : 0;
    const ammunition = cleanText(state?.ammunition);
    const currentState = readDocumentFlag(item, MODULE_ID, FIREARM_AMMO_STATE_FLAG);
    const nextName = withFirearmAmmoSuffix(item?.name, current, capacity);
    const stateUnchanged = toNumber(currentState?.current, NaN) === current
      && toNumber(currentState?.capacity, NaN) === capacity
      && cleanText(currentState?.ammunition) === ammunition
      && ammunitionFingerprint(currentState?.rounds) === ammunitionFingerprint(state?.rounds)
      && ammunitionFingerprint(currentState?.presets) === ammunitionFingerprint(state?.presets)
      && ammunitionFingerprint(currentState?.lastPattern) === ammunitionFingerprint(state?.lastPattern);
    if (stateUnchanged && item?.name === nextName) {
      return {
        ...(currentState?.schemaVersion === 2 ? structuredClone(currentState) : {}),
        current,
        capacity,
        ammunition,
        ...(cleanText(currentState?.updatedAt) ? { updatedAt: currentState.updatedAt } : {})
      };
    }

    const nextState = {
      ...(state?.schemaVersion === 2 ? {schemaVersion:2,rounds:structuredClone(state.rounds),sources:structuredClone(state.sources),presets:structuredClone(state.presets??[]),lastPattern:structuredClone(state.lastPattern??[])} : {}),
      current,
      capacity,
      ...(Number.isSafeInteger(state?.baseCapacity)?{baseCapacity:state.baseCapacity}:{}),
      ammunition,
      updatedAt: new Date().toISOString()
    };
    try {
      item.flags ??= {};
      item.flags[MODULE_ID] ??= {};
      item.flags[MODULE_ID][FIREARM_AMMO_STATE_FLAG] = nextState;
      item.name = nextName;
    }
    catch (_error) {
      // The combined document update below remains the persisted source of truth.
    }

    if (persist === false) {
      return nextState;
    }

    if (typeof item?.update === "function") {
      Promise.resolve(item.update({
        [`flags.${MODULE_ID}.${FIREARM_AMMO_STATE_FLAG}`]: nextState,
        name: nextName
      })).catch((error) => {
        console.error(`${MODULE_ID} | Failed to persist firearm ammunition state.`, error);
      });
    }
    else {
      this.#writeItemFlag(item, FIREARM_AMMO_STATE_FLAG, nextState);
      this.#writeItemName(item, nextName);
    }
    return nextState;
  }

  #consumeLoadedFirearmAmmo(actor, item, amount, options = {}) {
    const state = this.#resolveFirearmAmmoState(item, options);
    if (!state.tracked) {
      return {
        success: true,
        tracked: false,
        ammoSpent: 0,
        current: 0,
        capacity: 0
      };
    }

    if (state.current <= 0) {
      this.#setFirearmAmmoStateSync(item, state);
      this.#notifyFirearmAmmoEmpty(item);
      return {
        success: false,
        reason: "firearmAmmoEmpty",
        tracked: true,
        ammoSpent: 0,
        current: 0,
        capacity: state.capacity
      };
    }

    const required = options.emptyMagazine === true
      ? state.current
      : Math.max(1, Math.floor(toNumber(amount, 1)));
    if (state.current < required && options.allowPartial !== true) {
      this.#notifyFirearmAmmoInsufficient(item, state.current, required);
      return {
        success: false,
        reason: "firearmAmmoInsufficient",
        tracked: true,
        ammoSpent: 0,
        current: state.current,
        capacity: state.capacity,
        required
      };
    }

    const ammoSpent = Math.min(state.current, required);
    const ordered = magazineRounds(state);
    if (new Set(ordered.rounds.slice(0,ammoSpent)).size > 1) {
      ui.notifications?.warn?.("В одной атаке должны быть одинаковые патроны.");
      return {success:false,reason:"firearmAmmoMixed",current:state.current,capacity:state.capacity,ammoSpent:0};
    }
    const ammunitionData = ordered.sources[ordered.rounds[0]] ?? null;
    const nextState = this.#setFirearmAmmoStateSync(item, {
      ...state,
      ...(state.schemaVersion===2?{rounds:ordered.rounds.slice(ammoSpent)}:{}),
      current: state.current - ammoSpent
    });
    return {
      success: true,
      tracked: true,
      ammoSpent,
      ammunitionData,
      current: nextState.current,
      capacity: nextState.capacity
    };
  }

  #ammunitionStem(value) {
    const text = normalizeLookupText(value)
      .replace(/\b(?:патрон|патроны|патронов|патрона|пуля|пули|пуль|заряд|заряды|зарядов)\b/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    const aliases = ["винтов", "пистолет", "мушкет", "картеч", "пулев", "ракет", "топлив", "батар", "болт", "антиматер"];
    const alias = aliases.find((entry) => text.includes(entry));
    if (alias) {
      return alias;
    }

    const firstWord = text.split(" ").find(Boolean) ?? "";
    return firstWord.length > 8 ? firstWord.slice(0, 8) : firstWord;
  }

  #captureAmmunition(item) {
    return captureAmmunition(item,{gearById:this.moduleApi?.repository?.model?.gearById});
  }

  #isCompatibleAmmunition(weapon,item) {
    return isCompatibleAmmunition(weapon,item,{gearById:this.moduleApi?.repository?.model?.gearById});
  }

  #isAmmunitionItem(item) {
    if (!(item instanceof Item) || item.type !== "consumable") {
      return false;
    }

    const typeValue = normalizeLookupText(foundry.utils.getProperty(item, "system.type.value"));
    const subtype = normalizeLookupText(foundry.utils.getProperty(item, "system.type.subtype"));
    return typeValue === "ammo"
      || subtype.includes("ammo")
      || subtype.includes("firearm")
      || subtype.includes("bullet")
      || /патрон|пуля|заряд/u.test(normalizeLookupText(item.name));
  }

  #resolveActorItemByIdentifier(actor, identifier) {
    const safeIdentifier = cleanText(identifier);
    if (!actor || !safeIdentifier) {
      return null;
    }

    const direct = actor.items?.get?.(safeIdentifier);
    if (direct instanceof Item) {
      return direct;
    }

    return collectionValues(actor.items).find((item) => (
      item instanceof Item
      && [
        item.id,
        item._id,
        item.uuid,
        foundry.utils.getProperty(item, "flags.core.sourceId"),
        foundry.utils.getProperty(item, `flags.${MODULE_ID}.sourceId`),
        foundry.utils.getProperty(item, `flags.${MODULE_ID}.gearId`)
      ].some((value) => cleanText(value) === safeIdentifier)
    )) ?? null;
  }

  #resolveAmmunitionItemByIdentifier(actor, identifier) {
    const item = this.#resolveActorItemByIdentifier(actor, identifier);
    if (!this.#isAmmunitionItem(item) || this.#getItemQuantity(item) <= 0) {
      return null;
    }

    return item;
  }

  #getItemQuantity(item) {
    const direct = toNumber(foundry.utils.getProperty(item, "system.quantity"), NaN);
    if (Number.isFinite(direct)) {
      return Math.max(0, Math.floor(direct));
    }

    const value = toNumber(foundry.utils.getProperty(item, "system.quantity.value"), NaN);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  #itemQuantityUpdatePath(item) {
    const direct = foundry.utils.getProperty(item, "system.quantity");
    return direct && typeof direct === "object" ? "system.quantity.value" : "system.quantity";
  }

  #findMatchingAmmunition(actor, weapon, ammunitionLabel) {
    const directAmmunition = this.#resolveAmmunitionItemByIdentifier(actor, ammunitionLabel);
    const hasNativeSubtype=cleanText(foundry.utils.getProperty(weapon,"system.ammunition.type"));
    if (directAmmunition && (!hasNativeSubtype || this.#isCompatibleAmmunition(weapon,directAmmunition))) {
      return [directAmmunition];
    }

    const nativeSubtype = cleanText(foundry.utils.getProperty(weapon, "system.ammunition.type"));
    if (nativeSubtype) {
      return collectionValues(actor?.items)
        .filter((item) => this.#isAmmunitionItem(item))
        .filter((item) => this.#getItemQuantity(item) > 0)
        .filter((item) => this.#isCompatibleAmmunition(weapon,item));
    }

    const wantedStem = this.#ammunitionStem(ammunitionLabel);
    if (!wantedStem) {
      return [];
    }

    return collectionValues(actor?.items)
      .filter((item) => this.#isAmmunitionItem(item))
      .filter((item) => this.#getItemQuantity(item) > 0)
      .filter((item) => {
        const profile=resolveAmmunitionProfile(item,{gearById:this.moduleApi?.repository?.model?.gearById});
        if(profile?.compatibility?.length || profile?.replaces?.length)return this.#isCompatibleAmmunition(weapon,item);
        return this.#isCompatibleAmmunition(weapon,item) || this.#ammunitionStem(item.name).includes(wantedStem)
          || wantedStem.includes(this.#ammunitionStem(item.name));
      });
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

    if (this.#isImprovisedForSize(actor, item)) return actor?.getFlag?.("dnd5e", "tavernBrawlerFeat") === true;

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

  #resolveWeaponReachBonusFeet(item, options = {}) {
    const explicit = toNumber(options.weaponReachBonusFeet ?? options.reachBonusFeet, NaN);
    if (Number.isFinite(explicit)) {
      return Math.max(0, explicit);
    }
    if (this.#hasItemProperty(item, "lchReach")) {
      const values = this.#getLichWeaponPropertyValues(item, options);
      return Math.max(0, toNumber(values.reachBonus, 0));
    }

    const units = cleanText(foundry.utils.getProperty(item, "system.range.units"), "ft");
    const storedReach = toNumber(foundry.utils.getProperty(item, "system.range.reach"), NaN);
    const storedFeet = Number.isFinite(storedReach) ? convertUnitsToFeet(storedReach, units) : 5;
    return Math.max(0, storedFeet - 5);
  }

  #resolveReachBonusFeet(item, options = {}) {
    const actor = options.actor ?? item.actor ?? item.parent ?? null;
    const sizeBase = getCharacterSizeRule(actor?.system?.traits?.size).baseReachFeet;
    const naturalBonus = Math.max(0, getNaturalReachFeet(actor) - sizeBase);
    const weaponBonus = this.#resolveWeaponReachBonusFeet(item, options);

    return weaponBonus + naturalBonus;
  }

  getMeleeReachFeet(item, options = {}) {
    const actor = options.actor ?? item.actor ?? item.parent ?? null;
    const sizeBase = getCharacterSizeRule(actor?.system?.traits?.size).baseReachFeet;
    const independentBonuses = this.#resolveReachBonusFeet(item, { ...options, actor });

    return Math.max(0, sizeBase + independentBonuses);
  }

  prepareWhirlwindUse(activity, usageConfig = {}, messageConfig = {}) {
    if (!isWhirlwindActivity(activity)) return true;
    const actor = activity.actor ?? activity.item.actor;
    const scene = globalThis.canvas?.scene;
    const active = actor?.getActiveTokens?.() ?? [];
    const controlled = globalThis.canvas?.tokens?.controlled?.filter(token => token.actor === actor) ?? [];
    const source = usageConfig.workflow?.token ?? actor?.token?.object ?? actor?.token
      ?? (controlled.length === 1 ? controlled[0] : active.length === 1 ? active[0] : null);
    const sourceDocument = source?.document ?? source;
    if (!source || !scene || sourceDocument.parent !== scene) {
      globalThis.ui?.notifications?.warn?.("Для круговой атаки выберите один токен атакующего на текущей сцене.");
      return false;
    }
    const targets = collectWhirlwindTargets(source, scene.tokens, this.getMeleeReachFeet(activity.item), (from, to) => {
      const fromObject = from.object ?? from, toObject = to.object ?? to;
      const midiDistance = globalThis.MidiQOL?.computeDistance?.(fromObject, toObject, { wallsBlock: true, includeCover: false, includeElevation: true });
      const distance = midiDistance ?? measureStorageTokenDistance(from, to);
      if (distance < 0) return Infinity;
      if (midiDistance === undefined && fromObject.checkCollision?.(toObject.center, { type: "move", mode: "any" })) return Infinity;
      return convertUnitsToFeet(distance, scene.grid?.units ?? "ft");
    });
    if (!targets.length) {
      globalThis.ui?.notifications?.warn?.("В досягаемости круговой атаки нет существ.");
      return false;
    }
    const placeables = targets.map(token => token.object ?? token);
    usageConfig.midiOptions ??= {};
    usageConfig.midiOptions.targetsToUse = new Set(placeables);
    usageConfig.midiOptions.workflowOptions = { ...usageConfig.midiOptions.workflowOptions, targetConfirmation: "never" };
    usageConfig.workflow?.setTargets?.(placeables);
    const context = { sourceTokenUuid: sourceDocument.uuid, targetUuids: targets.map(token => (token.document ?? token).uuid) };
    if (usageConfig.workflow) usageConfig.workflow.rebreyaWhirlwind = context;
    messageConfig.data ??= {};
    foundry.utils.setProperty(messageConfig.data, `flags.${MODULE_ID}.whirlwindAttack`, context);
    foundry.utils.setProperty(messageConfig.data, "flags.dnd5e.targets", targets.map(token => ({
      uuid: token.actor?.uuid, tokenUuid: (token.document ?? token).uuid, name: token.name ?? token.actor?.name ?? "Существо",
      img: token.texture?.src ?? token.actor?.img, ac: token.actor?.system?.attributes?.ac?.value
    })));
    return true;
  }

  async resolveWhirlwindHits(workflow) {
    if (!isWhirlwindActivity(workflow?.activity)) return true;
    if (globalThis.MidiQOL?.configSettings?.()?.autoCheckHit === "none" && typeof workflow.checkHits === "function") await workflow.checkHits();
    return true;
  }

  async reportWhirlwindAttack(rolls, context) {
    if (!isWhirlwindActivity(context?.subject) || globalThis.game?.modules?.get?.("midi-qol")?.active) return;
    const roll = rolls?.[0];
    const targets = roll?.options?.rebreyaWhirlwindTargets;
    const message = roll?.parent;
    if (!message?.update || !targets?.length) return;
    const targetKey = target => target.tokenUuid ?? target.uuid;
    const hits = new Set(whirlwindHitTargets(targets.map(target => ({ ...target, actor: { system: { attributes: { ac: { value: target.ac } } } } })), roll).map(targetKey));
    const escape = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const content = `<section data-rebreya-whirlwind><p>Круговая атака: половина урона</p><ul>${targets.map(target => `<li>${escape(target.name)}: ${hits.has(targetKey(target)) ? "попадание" : "промах"}</li>`).join("")}</ul></section>`;
    const snapshot = { targetUuids: targets.map(targetKey), hitTokenUuids: [...hits] };
    await message.update({ content: `${String(message.content ?? "").replace(/<section data-rebreya-whirlwind>[\s\S]*?<\/section>/gu, "")}${content}`, [`flags.${MODULE_ID}.whirlwindAttack`]: snapshot });
    const originId = message.getFlag?.("dnd5e", "originatingMessage");
    const origin = originId && globalThis.game?.messages?.get?.(originId);
    if (origin?.isOwner) await origin.update({ [`flags.${MODULE_ID}.whirlwindAttack`]: snapshot });
  }

  prepareWhirlwindDamageCard(config, message) {
    const activity = config.subject;
    if (!isWhirlwindActivity(activity)) return;
    if (config.workflow) {
      const workflow = config.workflow;
      const tokens = [...(workflow.hitTargets ?? []), ...(workflow.hitTargetsEC ?? [])];
      message.data ??= {};
      foundry.utils.setProperty(message.data, `flags.${MODULE_ID}.whirlwindAttack`, workflow.rebreyaWhirlwind ?? {});
      foundry.utils.setProperty(message.data, "flags.dnd5e.targets", tokens.map(token => ({ uuid: token.actor.uuid, tokenUuid: token.document?.uuid ?? token.uuid, name: token.name ?? token.actor.name })));
      return;
    }
    const id = message.data?.flags?.dnd5e?.originatingMessage
      ?? config.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId;
    const origin = id && globalThis.game?.messages?.get?.(id);
    const snapshot = origin?.getFlag?.(MODULE_ID, "whirlwindAttack");
    if (!snapshot) {
      this.prepareWhirlwindUse(activity, { workflow: config.workflow }, message);
      return;
    }
    const tokens = (snapshot.hitTokenUuids ?? snapshot.targetUuids ?? []).map(uuid => globalThis.fromUuidSync?.(uuid)).filter(token => token?.actor);
    message.data ??= {};
    foundry.utils.setProperty(message.data, `flags.${MODULE_ID}.whirlwindAttack`, snapshot);
    foundry.utils.setProperty(message.data, "flags.dnd5e.targets", tokens.map(token => ({ uuid: token.actor.uuid, tokenUuid: token.uuid, name: token.name ?? token.actor.name })));
  }

  async chooseWhirlwindEffectTarget(workflow) {
    if (!isWhirlwindActivity(workflow?.activity)) return true;
    const hits = [...(workflow.hitTargets ?? []), ...(workflow.hitTargetsEC ?? [])];
    workflow.rebreyaWhirlwind ??= {};
    if (Object.hasOwn(workflow.rebreyaWhirlwind, "selectedTargetUuid")) return true;
    let selected = hits.length === 1 ? (hits[0].document?.uuid ?? hits[0].uuid) : null;
    if (hits.length > 1) {
      if (this.moduleApi.promptWhirlwindTarget) selected = await this.moduleApi.promptWhirlwindTarget(hits);
      else {
        const escape = text => foundry.utils.escapeHTML(String(text));
        selected = await globalThis.foundry?.applications?.api?.DialogV2?.input?.({
          window: { title: "Круговая атака: дополнительные эффекты" },
          content: `<p>Дополнительные эффекты и урон применяются только к одной поражённой цели. Их урон также делится пополам.</p><select name="target">${hits.map(token => `<option value="${escape(token.document?.uuid ?? token.uuid)}">${escape(token.name ?? token.actor?.name ?? "Существо")}</option>`).join("")}</select>`,
          ok: { label: "Выбрать", callback: (_event, button) => (button.form ?? button.closest?.("form"))?.querySelector?.('[name="target"]')?.value },
          rejectClose: false, modal: true
        });
      }
    }
    workflow.rebreyaWhirlwind.selectedTargetUuid = hits.some(token => (token.document?.uuid ?? token.uuid) === selected) ? selected : null;
    return true;
  }

  prepareWhirlwindExtraDamage(workflow, config) {
    if (isWhirlwindActivity(workflow?.activity)) markWhirlwindDamageRolls(config, workflow.rebreyaWhirlwind?.selectedTargetUuid ?? null);
    return true;
  }

  applyWhirlwindDamage(actor, damages, options) {
    return applyWhirlwindDamage(actor, damages, options);
  }

  routeWhirlwindConsumption(activity, updates) {
    return routeWhirlwindConsumption(activity, updates);
  }

  scopeWhirlwindEffects(workflow, restore = false) {
    if (!isWhirlwindActivity(workflow?.activity)) return true;
    if (restore) {
      if (workflow.rebreyaWhirlwind?.effectHits) {
        [workflow.hitTargets, workflow.hitTargetsEC] = workflow.rebreyaWhirlwind.effectHits;
        delete workflow.rebreyaWhirlwind.effectHits;
      }
    } else {
      workflow.rebreyaWhirlwind ??= {};
      workflow.rebreyaWhirlwind.effectHits ??= [workflow.hitTargets, workflow.hitTargetsEC];
      workflow.hitTargets = new Set(whirlwindEffectTargets(workflow));
      workflow.hitTargetsEC = new Set();
    }
    return true;
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

    if (!this.#hasFirearmMisfireMechanic(item)) {
      return false;
    }

    const state = readDocumentFlag(item, MODULE_ID, FIREARM_JAMMED_FLAG);
    if (state === true) {
      return true;
    }

    return state?.value === true;
  }

  #resolveCanonicalGearItem(item) {
    const gearId = cleanText(readDocumentFlag(item, MODULE_ID, "gearId") ?? readDocumentFlag(item, MODULE_ID, "sourceId"));
    if (!gearId) {
      return null;
    }

    const fromModel = this.moduleApi?.repository?.model?.gearById?.get?.(gearId);
    if (fromModel) {
      return fromModel;
    }

    const datasetGear = this.moduleApi?.repository?.dataset?.gear;
    if (Array.isArray(datasetGear)) {
      return datasetGear.find((entry) => cleanText(entry?.id ?? entry?.gearId) === gearId) ?? null;
    }

    return null;
  }

  #resolveCanonicalFirearmMisfireThreshold(item) {
    const gearItem = this.#resolveCanonicalGearItem(item);
    if (!gearItem || !isPlainObject(gearItem.weapon)) {
      return null;
    }

    const properties = Array.isArray(gearItem.weapon.properties) ? gearItem.weapon.properties : [];
    const values = isPlainObject(gearItem.weapon.lichWeaponPropertyValues)
      ? gearItem.weapon.lichWeaponPropertyValues
      : {};
    const configured = toNumber(values.misfire ?? values.firearmMisfire, NaN);

    if (properties.includes(FIREARM_MISFIRE_PROPERTY)) {
      return Number.isFinite(configured) && configured > 0
        ? clampInteger(configured, 1, 20)
        : 0;
    }

    if (properties.includes(FIREARM_RUST_PROPERTY)) {
      return 1;
    }

    return 0;
  }

  #getCanonicalFirearmPropertyValues(item) {
    const gearItem = this.#resolveCanonicalGearItem(item);
    const values = gearItem?.weapon?.lichWeaponPropertyValues;
    return isPlainObject(values) ? values : {};
  }

  #hasConfiguredFirearmMisfire(item, options = {}) {
    if (!this.#hasItemProperty(item, FIREARM_MISFIRE_PROPERTY)) {
      return false;
    }

    const values = this.#getLichWeaponPropertyValues(item, options);
    const configured = toNumber(values.misfire ?? values.firearmMisfire, NaN);
    if (Number.isFinite(configured)) {
      return configured > 0;
    }

    const canonicalThreshold = this.#resolveCanonicalFirearmMisfireThreshold(item);
    return Number.isFinite(canonicalThreshold) && canonicalThreshold > 0;
  }

  #hasFirearmMisfireMechanic(item) {
    return this.#hasConfiguredFirearmMisfire(item)
      || this.#hasItemProperty(item, FIREARM_RUST_PROPERTY);
  }

  #isFirearmReloadActivity(activityId, activity) {
    const safeActivityId = cleanText(activityId ?? activity?._id ?? activity?.id);
    return [FIREARM_RELOAD_ACTIVITY_ID,"lchUnloadGun0001"].includes(safeActivityId)
      || [FIREARM_RELOAD_AUTOMATION,"firearm-unload"].includes(cleanText(foundry.utils.getProperty(activity, `flags.${MODULE_ID}.automation`)));
  }

  #buildFirearmUtilityActivity({ activityId, name, activationType, chatFlavor, automation, sort }) {
    return {
      _id: activityId,
      type: "utility",
      name,
      sort,
      activation: { type: activationType, value: 1, condition: "", override: false },
      consumption: { scaling: { allowed: false, max: "" }, spellSlot: false, targets: [] },
      description: { chatFlavor },
      duration: { value: "", units: "inst", special: "", concentration: false, override: false },
      effects: [],
      flags: { [MODULE_ID]: { managed: true, automation } },
      range: { value: null, units: "self", special: "", override: false },
      target: {
        template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
        affects: { count: "", type: "self", choice: false, special: "" },
        prompt: false,
        override: false
      },
      uses: { spent: 0, max: "", recovery: [] }
    };
  }

  omitUnchangedFirearmPropertyOrder(item, changed = {}) {
    const before = item?._source?.system?.properties;
    const after = changed?.system?.properties;
    if (!isFirearmItem(item) || !Array.isArray(before) || !Array.isArray(after)
      || !before.every(value => typeof value === "string") || !after.every(value => typeof value === "string")) return;
    const original = new Set(before);
    const updated = new Set(after);
    if (original.size === before.length && updated.size === after.length
      && original.size === updated.size && after.every(value => original.has(value))) {
      delete changed.system.properties;
    }
  }

  async synchronizeFirearmPropertyState(item, changed = {}) {
    if (!isFirearmItem(item)) {
      return { updated: false };
    }

    const hasChangedPath = (path) => {
      if (Object.hasOwn(changed, path)) return true;
      const parts = path.split(".");
      let cursor = changed;
      for (const part of parts) {
        if (!cursor || typeof cursor !== "object" || !Object.hasOwn(cursor, part)) return false;
        cursor = cursor[part];
      }
      return true;
    };
    const nestedPropertiesChange = changed?.system?.properties;
    const propertyCollectionChanged = Object.hasOwn(changed, "system.properties")
      || Array.isArray(nestedPropertiesChange)
      || nestedPropertiesChange instanceof Set;
    const misfireChanged = propertyCollectionChanged
      || hasChangedPath(`system.properties.${FIREARM_MISFIRE_PROPERTY}`);
    const reloadChanged = propertyCollectionChanged
      || hasChangedPath(`system.properties.${FIREARM_RELOAD_PROPERTY}`);
    if (!misfireChanged && !reloadChanged) {
      return { updated: false };
    }

    const values = { ...this.#getLichWeaponPropertyValues(item) };
    const canonicalValues = this.#getCanonicalFirearmPropertyValues(item);
    const nextActivities = Object.fromEntries(collectionEntries(foundry.utils.getProperty(item, "system.activities"))
      .map(([activityId, activity]) => [cleanText(activityId ?? activity?._id ?? activity?.id), sourceData(activity)])
      .filter(([activityId]) => Boolean(activityId)));
    const update = {};
    let nextName = cleanText(item.name);

    if (misfireChanged) {
      const enabled = this.#hasItemProperty(item, FIREARM_MISFIRE_PROPERTY)
        || this.#hasItemProperty(item, FIREARM_RUST_PROPERTY);
      for (const [activityId, activity] of Object.entries(nextActivities)) {
        if (this.#isFirearmMisfireMaintenanceActivity(activityId, activity)) delete nextActivities[activityId];
      }
      nextName = stripFirearmJamSuffix(nextName);
      update[`flags.${MODULE_ID}.-=${FIREARM_JAMMED_FLAG}`] = null;
      if (enabled) {
        const canonicalThreshold = toNumber(canonicalValues.misfire ?? canonicalValues.firearmMisfire, NaN);
        const localThreshold = toNumber(values.misfire ?? values.firearmMisfire, NaN);
        const threshold = this.#hasItemProperty(item, FIREARM_RUST_PROPERTY)
          && !this.#hasItemProperty(item, FIREARM_MISFIRE_PROPERTY)
          ? 1
          : clampInteger(Number.isFinite(canonicalThreshold) && canonicalThreshold > 0
            ? canonicalThreshold
            : (Number.isFinite(localThreshold) && localThreshold > 0 ? localThreshold : 1), 1, 20);
        delete values.firearmMisfire;
        values.misfire = threshold;
        update[`flags.${MODULE_ID}.${FIREARM_BASE_MISFIRE_FLAG}`] = threshold;
        update[`flags.${MODULE_ID}.${FIREARM_CURRENT_MISFIRE_FLAG}`] = threshold;
        nextActivities[FIREARM_CLEAR_JAM_ACTIVITY_ID] = this.#buildFirearmUtilityActivity({
          activityId: FIREARM_CLEAR_JAM_ACTIVITY_ID,
          name: "Очистить затвор",
          activationType: "action",
          chatFlavor: "Очистить затворную раму: снять клин и увеличить текущий показатель осечки на 1, максимум до 10.",
          automation: FIREARM_CLEAR_JAM_AUTOMATION,
          sort: 100
        });
        nextActivities[FIREARM_MAINTAIN_ACTIVITY_ID] = this.#buildFirearmUtilityActivity({
          activityId: FIREARM_MAINTAIN_ACTIVITY_ID,
          name: "Привести оружие в порядок",
          activationType: "minute",
          chatFlavor: "Проверка Ловкости или Интеллекта (инструменты жестянщика) против Сл 10 + текущий показатель осечки. При успехе осечка возвращается к базовому значению.",
          automation: FIREARM_MAINTAIN_AUTOMATION,
          sort: 200
        });
      }
      else {
        delete values.misfire;
        delete values.firearmMisfire;
        update[`flags.${MODULE_ID}.-=${FIREARM_BASE_MISFIRE_FLAG}`] = null;
        update[`flags.${MODULE_ID}.-=${FIREARM_CURRENT_MISFIRE_FLAG}`] = null;
      }
    }

    if (reloadChanged) {
      const enabled = this.#hasItemProperty(item, FIREARM_RELOAD_PROPERTY);
      for (const [activityId, activity] of Object.entries(nextActivities)) {
        if (this.#isFirearmReloadActivity(activityId, activity)) delete nextActivities[activityId];
      }
      nextName = stripFirearmAmmoSuffix(nextName);
      if (enabled) {
        const canonicalReload = cleanText(canonicalValues.reload);
        const capacity = this.#parseFirstPositiveInteger(canonicalReload)
          || this.#parseFirstPositiveInteger(values.reload)
          || 1;
        const reload = canonicalReload || `Перезарядка ${capacity}`;
        const ammunition = cleanText(canonicalValues.ammunition ?? values.ammunition);
        values.reload = reload;
        update[`flags.${MODULE_ID}.${FIREARM_AMMO_STATE_FLAG}`] = { current: 0, capacity, ammunition };
        nextActivities.lchUnloadGun0001=this.#buildFirearmUtilityActivity({activityId:"lchUnloadGun0001",name:"Разрядить",activationType:"action",chatFlavor:"Вернуть оставшиеся патроны в инвентарь.",automation:"firearm-unload",sort:60});
        nextName = withFirearmAmmoSuffix(nextName, 0, capacity);
        nextActivities[FIREARM_RELOAD_ACTIVITY_ID] = this.#buildFirearmUtilityActivity({
          activityId: FIREARM_RELOAD_ACTIVITY_ID,
          name: "Перезарядить",
          activationType: "action",
          chatFlavor: `Перезарядить оружие: заполнить боезапас до ${capacity}, списав подходящие боеприпасы из инвентаря.`,
          automation: FIREARM_RELOAD_AUTOMATION,
          sort: 50
        });
      }
      else {
        delete values.reload;
        update[`flags.${MODULE_ID}.-=${FIREARM_AMMO_STATE_FLAG}`] = null;
      }
    }

    update.name = nextName;
    update[`flags.${MODULE_ID}.lichWeaponPropertyValues`] = values;
    update["system.activities"] = nextActivities;
    await item.update?.(update, { render: false, [MODULE_ID]: { firearmPropertySync: true } });
    return { updated: true };
  }

  #isFirearmMisfireMaintenanceActivity(activityId, activity) {
    const safeActivityId = cleanText(activityId ?? activity?._id ?? activity?.id);
    if ([FIREARM_CLEAR_JAM_ACTIVITY_ID, FIREARM_MAINTAIN_ACTIVITY_ID].includes(safeActivityId)) {
      return true;
    }

    const automation = cleanText(foundry.utils.getProperty(activity, `flags.${MODULE_ID}.automation`));
    return [FIREARM_CLEAR_JAM_AUTOMATION, FIREARM_MAINTAIN_AUTOMATION].includes(automation);
  }

  #resolveFirearmAreaFireActivityMode(item, automation) {
    const values = this.#getLichWeaponPropertyValues(item);
    const fireModeDamage = cleanText(String(values.fireMode ?? "").match(/\(([^)]+)\)/u)?.[1]);
    if (automation === FIREARM_AUTOMATIC_FIRE_AUTOMATION) {
      return {
        type: "automatic",
        name: "Автоматический огонь",
        coneFeet: 45,
        damageFormula: cleanText(values.automaticDamage ?? fireModeDamage)
      };
    }

    if (automation === FIREARM_SEMI_AUTOMATIC_FIRE_AUTOMATION) {
      return {
        type: "semi",
        name: "Полуавтоматический огонь",
        coneFeet: 30,
        damageFormula: cleanText(values.semiAutomaticDamage ?? values.automaticDamage ?? fireModeDamage)
      };
    }

    return null;
  }

  #resolveFirearmDamageType(item) {
    for (const candidate of [
      foundry.utils.getProperty(item, "system.damage.base.types"),
      foundry.utils.getProperty(item, "system.damage.parts.0.types"),
      foundry.utils.getProperty(item, "system.damage.base.type"),
      foundry.utils.getProperty(item, "system.damage.type")
    ]) {
      if (candidate instanceof Set) {
        return cleanText(Array.from(candidate)[0]);
      }

      if (Array.isArray(candidate)) {
        return cleanText(candidate[0]);
      }

      const direct = cleanText(candidate);
      if (direct) {
        return direct;
      }
    }

    return "";
  }

  #buildFirearmDamagePart(formula, damageType) {
    const safeFormula = cleanText(formula);
    const simpleFormulaMatch = safeFormula.match(/^(\d+)d(\d+)(?:\s*\+\s*(.+))?$/iu);
    const damagePart = {
      types: cleanText(damageType) ? [cleanText(damageType)] : [],
      custom: {
        enabled: Boolean(safeFormula),
        formula: safeFormula
      },
      scaling: {
        mode: "",
        number: 1,
        formula: ""
      }
    };

    if (simpleFormulaMatch) {
      damagePart.number = Number(simpleFormulaMatch[1]);
      damagePart.denomination = Number(simpleFormulaMatch[2]);
      damagePart.bonus = cleanText(simpleFormulaMatch[3]);
      damagePart.custom = {
        enabled: false,
        formula: ""
      };
    }

    if (!safeFormula) {
      damagePart.custom = {
        enabled: false,
        formula: ""
      };
    }

    return damagePart;
  }

  #needsFirearmAreaFireActivityRepair(item, activity, mode) {
    if (!mode) {
      return false;
    }

    if (cleanText(activity?.type) !== "save") {
      return true;
    }

    const expectedDcAbility = this.#resolveFirearmAbilityKey(item, "dex");
    const damageParts = foundry.utils.getProperty(activity, "damage.parts");
    return foundry.utils.getProperty(activity, "target.template.type") !== "cone"
      || toNumber(foundry.utils.getProperty(activity, "target.template.size"), 0) !== mode.coneFeet
      || foundry.utils.getProperty(activity, "target.affects.type") !== "creature"
      || foundry.utils.getProperty(activity, "target.prompt") !== true
      || !Array.isArray(damageParts)
      || (Boolean(mode.damageFormula) && damageParts.length === 0)
      || foundry.utils.getProperty(activity, "save.dc.calculation") !== expectedDcAbility;
  }

  #buildFirearmAreaFireSaveActivity(item, activity, activityId, automation, mode) {
    const safeActivityId = cleanText(activityId ?? activity?._id ?? activity?.id);
    if (!safeActivityId || !mode) {
      return null;
    }

    const damageFormula = cleanText(mode.damageFormula);
    const existingFlags = isPlainObject(activity?.flags) ? activity.flags : {};
    const existingModuleFlags = isPlainObject(existingFlags[MODULE_ID]) ? existingFlags[MODULE_ID] : {};
    return {
      _id: safeActivityId,
      type: "save",
      name: cleanText(activity?.name, mode.name),
      img: "systems/dnd5e/icons/svg/activity/save.svg",
      sort: toNumber(activity?.sort, mode.type === "automatic" ? 90 : 95),
      activation: {
        type: cleanText(foundry.utils.getProperty(activity, "activation.type"), "action"),
        value: toNumber(foundry.utils.getProperty(activity, "activation.value"), 1),
        condition: cleanText(foundry.utils.getProperty(activity, "activation.condition")),
        override: foundry.utils.getProperty(activity, "activation.override") === true
      },
      consumption: {
        scaling: {
          allowed: false,
          max: ""
        },
        spellSlot: false,
        targets: []
      },
      damage: {
        onSave: "half",
        parts: damageFormula ? [
          this.#buildFirearmDamagePart(damageFormula, this.#resolveFirearmDamageType(item))
        ] : []
      },
      description: {
        chatFlavor: cleanText(
          foundry.utils.getProperty(activity, "description.chatFlavor"),
          `${mode.name}: конус ${mode.coneFeet} фт., урон ${damageFormula || "урон оружия"}.`
        )
      },
      duration: {
        value: "",
        units: "inst",
        special: "",
        concentration: false,
        override: false
      },
      effects: [],
      flags: {
        ...existingFlags,
        [MODULE_ID]: {
          ...existingModuleFlags,
          managed: true,
          automation
        }
      },
      range: {
        value: null,
        units: "self",
        special: "",
        override: false
      },
      save: {
        ability: ["dex"],
        dc: {
          calculation: this.#resolveFirearmAbilityKey(item, "dex"),
          formula: ""
        }
      },
      target: {
        template: {
          count: "",
          contiguous: false,
          type: "cone",
          size: mode.coneFeet,
          width: "",
          height: "",
          units: "ft"
        },
        affects: {
          count: "",
          type: "creature",
          choice: false,
          special: ""
        },
        prompt: true,
        override: false
      },
      uses: {
        spent: toNumber(foundry.utils.getProperty(activity, "uses.spent"), 0),
        max: cleanText(foundry.utils.getProperty(activity, "uses.max")),
        recovery: []
      }
    };
  }

  async repairWhirlwindActivities(document) {
    let updated = 0;
    for (const item of document instanceof Actor ? collectionValues(document.items) : [document]) {
      if (item?.type !== "weapon" || item.isOwner === false) continue;
      const changes = whirlwindActivityUpdates(item);
      if (!Object.keys(changes).length) continue;
      await item.update(changes, { render: false, [MODULE_ID]: { whirlwindSync: true } });
      updated++;
    }
    return { updated };
  }

  async repairFirearmActivities(document) {
    const items = document instanceof Actor
      ? collectionValues(document.items)
      : (document instanceof Item ? [document] : []);
    if (!items.length) {
      return {
        updated: 0,
        removed: 0,
        upgraded: 0,
        items: []
      };
    }

    let updated = 0;
    let removed = 0;
    let upgraded = 0;
    const changedItems = [];
    for (const item of items) {
      if (!isFirearmItem(item)) {
        continue;
      }

      const activityEntries = collectionEntries(foundry.utils.getProperty(item, "system.activities"));
      if (!activityEntries.length) {
        continue;
      }

      const nextActivities = {};
      const removedActivityIds = [];
      const upgradedActivityIds = [];
      const hasMisfireMechanic = this.#hasFirearmMisfireMechanic(item);
      for (const [activityId, activity] of activityEntries) {
        const safeActivityId = cleanText(activityId ?? activity?._id ?? activity?.id);
        if (!hasMisfireMechanic && this.#isFirearmMisfireMaintenanceActivity(safeActivityId, activity)) {
          removedActivityIds.push(safeActivityId);
          continue;
        }

        if (safeActivityId) {
          const automation = cleanText(foundry.utils.getProperty(activity, `flags.${MODULE_ID}.automation`));
          const mode = this.#resolveFirearmAreaFireActivityMode(item, automation);
          if (this.#needsFirearmAreaFireActivityRepair(item, activity, mode)) {
            nextActivities[safeActivityId] = this.#buildFirearmAreaFireSaveActivity(
              item,
              activity,
              safeActivityId,
              automation,
              mode
            );
            upgradedActivityIds.push(safeActivityId);
          }
          else {
            nextActivities[safeActivityId] = sourceData(activity);
          }
        }
      }

      if(this.#hasItemProperty(item,FIREARM_RELOAD_PROPERTY) && !nextActivities.lchUnloadGun0001){
        nextActivities.lchUnloadGun0001=this.#buildFirearmUtilityActivity({activityId:"lchUnloadGun0001",name:"Разрядить",activationType:"action",chatFlavor:"Вернуть оставшиеся патроны в инвентарь.",automation:"firearm-unload",sort:60});
        upgradedActivityIds.push("lchUnloadGun0001");
      }
      if (!removedActivityIds.length && !upgradedActivityIds.length) {
        continue;
      }

      await item.update?.({ "system.activities": nextActivities }, { render: false });
      updated += 1;
      removed += removedActivityIds.length;
      upgraded += upgradedActivityIds.length;
      changedItems.push({
        itemId: item.id ?? "",
        itemName: item.name ?? "",
        removedActivityIds,
        upgradedActivityIds
      });
    }

    return {
      updated,
      removed,
      upgraded,
      items: changedItems
    };
  }

  #resolveFirearmMisfireThreshold(item, options = {}) {
    if (!isFirearmItem(item)) {
      return 0;
    }

    const explicit = toNumber(options.firearmMisfire ?? options.misfire, NaN);
    if (Number.isFinite(explicit)) {
      return clampInteger(explicit, 0, 20);
    }

    const hasMisfire = this.#hasItemProperty(item, FIREARM_MISFIRE_PROPERTY);
    const hasRust = this.#hasItemProperty(item, FIREARM_RUST_PROPERTY);
    if (!hasMisfire && !hasRust) {
      return 0;
    }
    if (!hasMisfire && hasRust) {
      return 1;
    }

    const canonicalThreshold = this.#resolveCanonicalFirearmMisfireThreshold(item);

    const directFlag = toNumber(readDocumentFlag(item, MODULE_ID, FIREARM_CURRENT_MISFIRE_FLAG), NaN);
    if (Number.isFinite(directFlag)) {
      return clampInteger(directFlag, 0, 20);
    }

    if (Number.isFinite(canonicalThreshold) && canonicalThreshold > 0) {
      return clampInteger(canonicalThreshold, 1, 20);
    }

    const values = this.#getLichWeaponPropertyValues(item, options);
    const fromValues = toNumber(values.misfire ?? values.firearmMisfire, NaN);
    if (this.#hasItemProperty(item, FIREARM_MISFIRE_PROPERTY)) {
      return Number.isFinite(fromValues) ? clampInteger(fromValues, 1, 20) : 0;
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
    const hasMisfire = this.#hasItemProperty(item, FIREARM_MISFIRE_PROPERTY);
    const hasRust = this.#hasItemProperty(item, FIREARM_RUST_PROPERTY);
    if (!hasMisfire && !hasRust) {
      return 0;
    }
    if (!hasMisfire && hasRust) {
      return 1;
    }

    const baseFlag = toNumber(readDocumentFlag(item, MODULE_ID, FIREARM_BASE_MISFIRE_FLAG), NaN);
    if (Number.isFinite(baseFlag)) {
      return clampInteger(baseFlag, 1, 10);
    }

    const canonicalThreshold = this.#resolveCanonicalFirearmMisfireThreshold(item);
    if (Number.isFinite(canonicalThreshold) && canonicalThreshold > 0) {
      return clampInteger(canonicalThreshold, 1, 10);
    }

    const values = this.#getLichWeaponPropertyValues(item);
    const configured = toNumber(values.misfire ?? values.firearmMisfire, NaN);
    if (this.#hasItemProperty(item, FIREARM_MISFIRE_PROPERTY) && Number.isFinite(configured)) {
      return clampInteger(configured, 1, 10);
    }

    return clampInteger(fallback, 1, 10);
  }

  #createFirearmMisfireMessage(actor, item, result, options = {}) {
    if (options.createMessage === false) {
      return;
    }

    const weaponName = item?.name ?? "Оружие";
    const threshold = Math.max(1, Math.floor(toNumber(result?.threshold, 1)));
    const rollTotal = Math.max(1, Math.floor(toNumber(result?.rollTotal, 1)));
    const outcome = result?.jammed === true ? "заклинено" : "без осечки";
    const notes = [];
    const reloadTarget=options.firearmAmmo?.tracked && options.firearmAmmo.ammoSpent>0 && options.firearmAmmo.current===0
      ? {actorUuid:actor?.uuid,weaponId:item?.id} : null;
    if (result?.checked !== false) notes.push(`${weaponName}: Осечка ${threshold}, d20 = ${rollTotal} (${outcome})`);
    if (reloadTarget) {
      notes.push("Магазин пуст. Используйте действие «Перезарядить».");
    }
    if (!notes.length) return;
    const content = notes.join("\n");
    const shot=result.shot;
    const flags={[MODULE_ID]:{[FIREARM_CHAT_NOTES_FLAG]:notes,...(reloadTarget?{[FIREARM_RELOAD_CHAT_FLAG]:reloadTarget}:{}),...(shot?{[FIREARM_MISFIRE_CHAT_FLAG]:shot}:{})}};
    if(shot && options.messageConfig)foundry.utils.setProperty(options.messageConfig,`data.flags.${MODULE_ID}.${FIREARM_MISFIRE_CHAT_FLAG}`,shot);
    // A pre-use jam can abort before an attack message exists. An actual parent
    // already exists after an attack roll and owns the complete, private status.
    if ((result?.jammed !== true || this.#resolveFirearmOriginatingMessage(options)?.content) && this.#appendFirearmChatNote(options, content, reloadTarget)) {
      return;
    }

    const flavor = result?.jammed === true
      ? `${weaponName}: Осечка ${threshold} - оружие заклинено`
      : `${weaponName}: проверка осечки ${threshold}`;

    try {
      if (result?.roll && typeof result.roll.toMessage === "function") {
        Promise.resolve(result.roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor,
          flags,
          content: this.#buildFirearmChatCardNotesHtml(notes)
        })).catch((error) => {
          console.error(`${MODULE_ID} | Failed to create firearm misfire roll message.`, error);
        });
        return;
      }

      const userId = String(game.user?.id ?? "").trim();
      if (typeof ChatMessage?.create === "function" && userId) {
        Promise.resolve(ChatMessage.create({
          user: userId,
          ...(result?.checked===false?{whisper:[userId]}:{}),
          speaker: ChatMessage.getSpeaker?.({ actor }) ?? {},
          flags,
          content: this.#buildFirearmChatCardNotesHtml(notes)
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
    const existingBaseMisfire = toNumber(
      readDocumentFlag(item, MODULE_ID, FIREARM_BASE_MISFIRE_FLAG),
      NaN
    );
    const baseMisfire = Number.isFinite(existingBaseMisfire)
      ? clampInteger(existingBaseMisfire, 1, 10)
      : this.#resolveFirearmBaseMisfireThreshold(item, result.threshold);
    const nextName = withFirearmJamSuffix(item?.name);
    const jamState = {
      value: true,
      threshold: result.threshold,
      rollTotal: result.rollTotal,
      jammedAt: new Date().toISOString()
    };
    const update = {
      [`flags.${MODULE_ID}.${FIREARM_JAMMED_FLAG}`]: jamState,
      name: nextName,
      ...(!Number.isFinite(existingBaseMisfire)
        ? { [`flags.${MODULE_ID}.${FIREARM_BASE_MISFIRE_FLAG}`]: baseMisfire }
        : {})
    };
    try {
      item.flags ??= {};
      item.flags[MODULE_ID] ??= {};
      item.flags[MODULE_ID][FIREARM_JAMMED_FLAG] = jamState;
      item.flags[MODULE_ID][FIREARM_BASE_MISFIRE_FLAG] = baseMisfire;
      item.name = nextName;
    }
    catch (_error) {
      // The combined document update below remains the persisted source of truth.
    }
    if (typeof item?.update === "function") {
      Promise.resolve(item.update(update)).catch((error) => {
        console.error(`${MODULE_ID} | Failed to persist firearm jam state.`, error);
      });
    }
    else {
      this.#writeItemFlag(item, FIREARM_JAMMED_FLAG, jamState);
      this.#writeItemFlag(item, FIREARM_BASE_MISFIRE_FLAG, baseMisfire);
      this.#writeItemName(item, nextName);
    }
    this.#notifyFirearmJammed(item);
  }

  #rollFirearmMisfire(actor, item, options = {}) {
    const threshold = this.#resolveFirearmMisfireThreshold(item, options);
    const { roll, total } = threshold>0?this.#evaluateFirearmMisfireDie(options):{roll:null,total:null};
    const result = {
      checked: threshold>0,
      jammed: threshold>0 && total <= threshold,
      threshold,
      rollTotal: total,
      ...(threshold>0?{roll}:{})
    };

    if (result.jammed) {
      this.#jamFirearm(actor, item, result, options);
    }
    if(options.firearmAttackRoll){
      result.shot=captureFirearmMisfire(options.firearmAttackRoll,result,{actorUuid:actor?.uuid,weaponId:item?.id,workflowId:options.firearmWorkflowId??null,
        jammedAt:result.jammed?readDocumentFlag(item,MODULE_ID,FIREARM_JAMMED_FLAG)?.jammedAt:null});
      if(options.firearmWorkflowId){options.firearmAttackRoll.options??={};options.firearmAttackRoll.options.rebreyaFirearmMisfire=result.shot;}
      else applyFirearmMisfireToRoll(options.firearmAttackRoll,result.shot);
    }
    this.#createFirearmMisfireMessage(actor, item, result, options);

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
    return isWeaponAttackActivity(activity);
  }

  #resolveRequiredHands(activity) {
    const explicitRequirement = readRequiredHands(activity) ?? readRequiredHands(activity?.item);
    if (explicitRequirement !== undefined && explicitRequirement !== null && explicitRequirement !== "") {
      return clampInteger(toNumber(explicitRequirement, 1), 0, 99);
    }

    return this.#hasItemProperty(activity?.item, "two") ? 2 : 1;
  }

  #hasBaseWeaponDamage(activity) {
    return activityHasBaseWeaponDamage(activity);
  }

  #ensureBaseDamageUsageButton(activity) {
    if (!this.#hasBaseWeaponDamage(activity) || typeof activity?._usageChatButtons !== "function") {
      return;
    }

    const prototype = Object.getPrototypeOf(activity);
    if (
      prototype
      && prototype !== Object.prototype
      && typeof prototype._usageChatButtons === "function"
      && !PATCHED_USAGE_BUTTON_PROTOTYPES.has(prototype)
    ) {
      const originalUsageChatButtons = prototype._usageChatButtons;
      Object.defineProperty(prototype, "_usageChatButtons", {
        value(message) {
          return ensureBaseDamageUsageButtons(this, originalUsageChatButtons.call(this, message));
        },
        configurable: true,
        writable: true
      });
      PATCHED_USAGE_BUTTON_PROTOTYPES.add(prototype);
    }

    if (Object.hasOwn(activity, "_usageChatButtons") && activity.__rebreyaBaseDamageUsageButton !== true) {
      const originalUsageChatButtons = activity._usageChatButtons.bind(activity);
      activity._usageChatButtons = (message) => ensureBaseDamageUsageButtons(activity, originalUsageChatButtons(message));
    }
    Object.defineProperty(activity, "__rebreyaBaseDamageUsageButton", {
      value: true,
      configurable: true
    });
  }

  #activityUnavailable(reason, title = "", data = {}) {
    return {
      available: false,
      label: ACTIVITY_UNAVAILABLE_LABEL,
      reason: cleanText(reason),
      title: cleanText(title),
      ...data
    };
  }

  #activityAvailable(data = {}) {
    return {
      available: true,
      label: "",
      reason: "",
      title: "",
      ...data
    };
  }

  #getHeldWeaponActivityBlock(activity) {
    const item = activity?.item ?? null;
    const actor = activity?.actor ?? item?.actor ?? item?.parent ?? null;
    const requiredHands = this.#resolveRequiredHands(activity);
    const result = canUseHeldItemForHandRequirement(actor, item, { requiredHands });
    if (result.ok) {
      return null;
    }

    const required = Math.max(1, requiredHands);
    if (result.reason === "notHeld") {
      const freeHands = Array.isArray(result.freeHands) ? result.freeHands : [];
      if (freeHands.length >= required) {
        return null;
      }

      return this.#activityUnavailable(
        "heldItemNoFreeHands",
        "Нет свободных рук для атаки.",
        { heldItem: result }
      );
    }

    if (result.reason === "insufficientAvailableHands") {
      return this.#activityUnavailable(
        "heldItemNoFreeHands",
        "Нет свободных рук для атаки.",
        { heldItem: result }
      );
    }

    return this.#activityUnavailable(
      "heldItemUnavailable",
      "Предмет нужно взять в руку.",
      { heldItem: result }
    );
  }

  #getFirearmAmmoActivityBlock(item, options = {}) {
    const block = this.#getFirearmAmmoShotBlock(item, options);
    if (!block) {
      return null;
    }

    const title = block.reason === "firearmAmmoInsufficient"
      ? "Не хватает патронов в магазине."
      : "Магазин пуст.";
    return this.#activityUnavailable(block.reason, title, {
      current: block.current,
      capacity: block.capacity,
      required: block.required
    });
  }

  #getFirearmAreaFireActivityBlock(activity) {
    const automation = cleanText(foundry.utils.getProperty(activity, `flags.${MODULE_ID}.automation`));
    if (![FIREARM_AUTOMATIC_FIRE_AUTOMATION, FIREARM_SEMI_AUTOMATIC_FIRE_AUTOMATION].includes(automation)) {
      return null;
    }

    const item = activity?.item ?? null;
    if (!isFirearmItem(item)) {
      return null;
    }

    const actor = activity?.actor ?? item.actor ?? null;
    if (!(actor instanceof Actor)) {
      return this.#activityUnavailable("firearmActorMissing", "Не найден владелец оружия.");
    }

    if (this.#isFirearmJammed(item)) {
      return this.#activityUnavailable("firearmJammed", "Оружие заклинено.");
    }

    const state = this.#resolveFirearmAmmoState(item);
    if (!state.tracked) {
      return null;
    }

    const mode = automation === FIREARM_AUTOMATIC_FIRE_AUTOMATION ? "automatic" : "semi";
    const required = mode === "automatic"
      ? state.current
      : (state.capacity > 0 ? Math.min(3, state.capacity) : 3);
    if (state.current <= 0) {
      return this.#activityUnavailable("firearmAmmoEmpty", "Магазин пуст.", {
        current: 0,
        capacity: state.capacity,
        required
      });
    }

    if (mode !== "automatic" && state.current < required) {
      return this.#activityUnavailable("firearmAmmoInsufficient", "Не хватает патронов в магазине.", {
        current: state.current,
        capacity: state.capacity,
        required
      });
    }

    return null;
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
    if (result.reason === "notHeld") {
      const required = Math.max(1, requiredHands);
      const freeHands = Array.isArray(result.freeHands) ? result.freeHands : [];
      if (freeHands.length >= required) {
        const hands = selectAutoHeldHandsForUse(freeHands, required);
        try {
          const update = buildHeldItemHandUpdate(hands, item);
          const updateResult = item.update?.(update, heldItemUpdateOptions());
          applyLocalHeldItemUpdate(item, update);
          refreshLocalHeldItemActivityData(item, activity);
          if (typeof updateResult?.then === "function") {
            updateResult.then((updatedItem) => {
              notifyHeldItemUpdated(actor, updatedItem ?? item);
            }).catch((error) => {
              console.error(`${MODULE_ID} | Failed to auto-hold weapon before use.`, error);
              ui.notifications?.error?.(`Не удалось взять "${itemName}" в руку.`);
            });
          }
          else if (updateResult) {
            notifyHeldItemUpdated(actor, updateResult);
          }
          return true;
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to auto-hold weapon before use.`, error);
          ui.notifications?.error?.(`Не удалось взять "${itemName}" в руку.`);
          return false;
        }
      }

      ui.notifications?.warn?.(`Чтобы использовать "${itemName}", нет свободных рук.`);
      return false;
    }

    if (result.reason === "insufficientAvailableHands") {
      ui.notifications?.warn?.(`Чтобы использовать "${itemName}", нет свободных рук.`);
      return false;
    }

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

  #disableActivityConsumption(activity, usageConfig = {}, messageConfig = {}) {
    this.#suppressNativeFirearmAmmunition(activity?.item);

    if (foundry.utils.getProperty(activity, "consumption.targets") !== undefined) {
      this.#applyActivitySourcePatch(activity, { "consumption.targets": [] });
    }

    if (isPlainObject(usageConfig.consume)) {
      usageConfig.consume.resources = [];
    }
    usageConfig.hasConsumption = false;
    messageConfig.hasConsumption = false;
  }

  #suppressNativeFirearmAmmunition(item) {
    if (!isFirearmItem(item)) {
      return false;
    }

    const directChanged = removePropertyValue(
      foundry.utils.getProperty(item, "system.properties"),
      DND5E_AMMUNITION_PROPERTY
    );
    const valueChanged = removePropertyValue(
      foundry.utils.getProperty(item, "system.properties.value"),
      DND5E_AMMUNITION_PROPERTY
    );

    return directChanged || valueChanged;
  }

  #actorItemById(actor, itemId) {
    const safeItemId = cleanText(itemId);
    if (!safeItemId) {
      return null;
    }

    const directItem = actor?.items?.get?.(safeItemId);
    if (directItem) {
      return directItem;
    }

    return collectionValues(actor?.items).find((item) => (
      cleanText(item?.id ?? item?._id) === safeItemId
    )) ?? null;
  }

  #isValidNativeAmmunitionOption(actor, weapon, option) {
    const value = cleanText(option?.value);
    return !value || this.#isCompatibleAmmunition(weapon, this.#actorItemById(actor, value));
  }

  #clearInvalidNativeAmmunitionSelection(activity, config = {}, dialog = {}) {
    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    const weapon = activity?.item ?? null;
    if (!actor) {
      return false;
    }

    let changed = false;
    const sanitize = (value) => {
      if (value === false) {
        return false;
      }

      const safeValue = cleanText(value);
      if (!safeValue) {
        return value === undefined ? undefined : "";
      }

      if (this.#isCompatibleAmmunition(weapon, this.#actorItemById(actor, safeValue))) {
        return value;
      }

      changed = true;
      return "";
    };

    if (Object.hasOwn(config, "ammunition")) {
      config.ammunition = sanitize(config.ammunition);
    }

    for (const rollConfig of config?.rolls ?? []) {
      if (!isPlainObject(rollConfig)) {
        continue;
      }

      if (Object.hasOwn(rollConfig, "ammunition")) {
        rollConfig.ammunition = sanitize(rollConfig.ammunition);
      }
      if (isPlainObject(rollConfig.options) && Object.hasOwn(rollConfig.options, "ammunition")) {
        rollConfig.options.ammunition = sanitize(rollConfig.options.ammunition);
      }
    }

    const options = dialog?.options?.ammunitionOptions;
    if (Array.isArray(options)) {
      const filteredOptions = options.filter((option) => this.#isValidNativeAmmunitionOption(actor, weapon, option));
      if (filteredOptions.length !== options.length) {
        dialog.options ??= {};
        dialog.options.ammunitionOptions = filteredOptions;
        changed = true;
      }
    }

    return changed;
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
    if (![
      FIREARM_CLEAR_JAM_AUTOMATION,
      FIREARM_MAINTAIN_AUTOMATION,
      FIREARM_RELOAD_AUTOMATION
      , "firearm-unload"
    ].includes(automation)) {
      return null;
    }

    const activityItem = activity?.item ?? null;
    const actor = activity?.actor ?? activityItem?.actor ?? null;
    // dnd5e Activity.use passes a temporary Item clone with the original ID.
    const item = actor?.items?.get?.(activityItem?.id) ?? activityItem;
    if (!isFirearmItem(item)) {
      return true;
    }

    if(automation==="firearm-unload"){
      this.unloadFirearm(actor,item).catch(error=>ui.notifications?.warn?.(error.message));return false;
    }
    if (automation === FIREARM_CLEAR_JAM_AUTOMATION) {
      this.clearFirearmJam(item).catch((error) => {
        console.error(`${MODULE_ID} | Failed to clear firearm jam from activity.`, error);
        ui.notifications?.error?.("Не удалось очистить затвор.");
      });
      return false;
    }

    if (automation === FIREARM_RELOAD_AUTOMATION) {
      this.openMagazineEditor(actor,item).catch((error) => {
        console.error(`${MODULE_ID} | Failed to reload firearm from activity.`, error);
        ui.notifications?.error?.("Не удалось перезарядить оружие.");
      });
      return false;
    }

    if ([FIREARM_AUTOMATIC_FIRE_AUTOMATION, FIREARM_SEMI_AUTOMATIC_FIRE_AUTOMATION].includes(automation)) {
      if (!(actor instanceof Actor)) {
        ui.notifications?.warn?.("Не удалось определить владельца огнестрела.");
        return false;
      }

      this.resolveFirearmAreaFire(actor, item, {
        mode: automation === FIREARM_AUTOMATIC_FIRE_AUTOMATION ? "automatic" : "semi"
      }).catch((error) => {
        console.error(`${MODULE_ID} | Failed to resolve firearm area fire activity.`, error);
        ui.notifications?.error?.("Не удалось выполнить огонь из оружия.");
      });
      return false;
    }

    this.maintainFirearm(item, null, { actor }).catch((error) => {
      console.error(`${MODULE_ID} | Failed to maintain firearm from activity.`, error);
      ui.notifications?.error?.("Не удалось привести оружие в порядок.");
    });
    return false;
  }

  #applyFirearmAreaFireActivity(activity, usageConfig = {}, messageConfig = {}) {
    const automation = cleanText(foundry.utils.getProperty(activity, `flags.${MODULE_ID}.automation`));
    if (![FIREARM_AUTOMATIC_FIRE_AUTOMATION, FIREARM_SEMI_AUTOMATIC_FIRE_AUTOMATION].includes(automation)) {
      return null;
    }

    const item = activity?.item ?? null;
    if (!isFirearmItem(item)) {
      return true;
    }

    const actor = activity?.actor ?? item.actor ?? null;
    if (!(actor instanceof Actor)) {
      ui.notifications?.warn?.("РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ РІР»Р°РґРµР»СЊС†Р° РѕРіРЅРµСЃС‚СЂРµР»Р°.");
      return false;
    }

    if (this.#blockJammedFirearm(item)) {
      return false;
    }

    this.#disableActivityConsumption(activity, usageConfig, messageConfig);

    const mode = automation === FIREARM_AUTOMATIC_FIRE_AUTOMATION ? "automatic" : "semi";
    const state = this.#resolveFirearmAmmoState(item);
    const ammoRequired = mode === "automatic"
      ? state.current
      : (state.capacity > 0 ? Math.min(3, state.capacity) : 3);
    const ammo = this.#consumeLoadedFirearmAmmo(actor, item, ammoRequired, {
      allowPartial: mode === "automatic",
      emptyMagazine: mode === "automatic",
      messageConfig
    });
    if (!ammo.success) {
      return false;
    }

    const shot={data:structuredClone(ammo.ammunitionData),count:ammo.ammoSpent,weaponId:item.id,spent:true};
    usageConfig.rebreyaAmmunitionShot=shot;
    foundry.utils.setProperty(messageConfig,`data.flags.${MODULE_ID}.ammunitionShot`,shot);
    const misfire = this.#rollFirearmMisfire(actor, item, { messageConfig, firearmAmmo: ammo });
    if (misfire.jammed) {
      return false;
    }

    return true;
  }

  getActivityAvailability(activity) {
    try {
      if(activity?.flags?.[MODULE_ID]?.weaponModActivity){
        try{const definition=this.getManagedWeaponModActivityDefinition(activity);
          if(definition.marker.action==="bayonet-attack")return this.#getHeldWeaponActivityBlock(activity)??this.#activityAvailable();
        }catch(error){return this.#activityUnavailable("weaponModUnavailable",error.message);}
      }
      const areaFireBlock = this.#getFirearmAreaFireActivityBlock(activity);
      if (areaFireBlock) {
        return areaFireBlock;
      }

      if (!this.#isWeaponAttackActivity(activity)) {
        return this.#activityAvailable();
      }

      const item = activity.item ?? null;
      if (this.#isFirearmJammed(item)) {
        return this.#activityUnavailable("firearmJammed", "Оружие заклинено.");
      }

      if (isFirearmItem(item)) {
        const ammoBlock = this.#getFirearmAmmoActivityBlock(item);
        if (ammoBlock) {
          return ammoBlock;
        }
      }

      const heldBlock = this.#getHeldWeaponActivityBlock(activity);
      if (heldBlock) {
        return heldBlock;
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to resolve activity availability.`, error);
      return this.#activityAvailable();
    }

    return this.#activityAvailable();
  }

  applyDnd5ePreUseActivity(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    if(activity?.flags?.[MODULE_ID]?.weaponModActivity){
      try{const utility=this.deferWeaponModUtility(activity);if(utility!==null)return utility;}
      catch(error){globalThis.ui?.notifications?.warn?.(error.message);return false;}
    }
    if(activity?.flags?.[MODULE_ID]?.weaponModActivity?.action==="bayonet-attack"){
      try{this.getManagedWeaponModActivityDefinition(activity);return this.#ensureHeldWeaponActivity(activity);}
      catch(error){globalThis.ui?.notifications?.warn?.(error.message);return false;}
    }
    if(activity?.flags?.[MODULE_ID]?.weaponModActivity?.action==="launcher-shot"){
      try{this.getManagedWeaponModActivityDefinition(activity);
        if(!usageConfig.rebreyaWeaponModShot)throw new Error("Выберите гранату через действие «Выстрелить гранатой».");
        return this.#ensureHeldWeaponActivity(activity);
      }catch(error){globalThis.ui?.notifications?.warn?.(error.message);return false;}
    }
    const firearmUtilityResult = this.#applyFirearmUtilityActivity(activity);
    if (firearmUtilityResult !== null) {
      return firearmUtilityResult;
    }

    const firearmAreaFireResult = this.#applyFirearmAreaFireActivity(activity, usageConfig, messageConfig);
    if (firearmAreaFireResult !== null) {
      return firearmAreaFireResult;
    }

    this.#retargetFighterDominanceConsumption(activity, usageConfig, messageConfig);
    this.#normalizeFighterManeuverTargeting(activity);

    if (!this.#isWeaponAttackActivity(activity)) {
      return true;
    }

    if(!this.deferWeaponModAttack(activity,usageConfig,dialogConfig,messageConfig,"use"))return false;

    try {
      const item = activity.item;
      if (this.#blockJammedFirearm(item)) {
        return false;
      }

      if (isFirearmItem(item)) {
        this.#disableActivityConsumption(activity, usageConfig, messageConfig);
        if (this.#blockFirearmShotWithoutAmmo(item)) {
          return false;
        }
      }
      if (!this.#ensureHeldWeaponActivity(activity)) {
        return false;
      }

      this.#ensureBaseDamageUsageButton(activity);

      const attackType = String(foundry.utils.getProperty(activity, "attack.type.value") ?? "").trim().toLowerCase();
      if (attackType && attackType !== "melee") {
        return true;
      }

      const itemRangeUnits = String(foundry.utils.getProperty(item, "system.range.units") ?? "ft").trim().toLowerCase();
      const activityRangeUnits = String(
        foundry.utils.getProperty(activity, "range.units") ?? itemRangeUnits ?? "ft"
      ).trim().toLowerCase() || "ft";
      if (!this.prepareWhirlwindUse(activity, usageConfig, messageConfig)) return false;
      const finalReachFeet = this.getMeleeReachFeet(item, {
        actor: activity.actor ?? item.actor ?? item.parent ?? null
      });
      const nextReach = convertFeetToUnits(finalReachFeet, activityRangeUnits);

      foundry.utils.setProperty(activity, "range.reach", nextReach);
      if (!foundry.utils.getProperty(activity, "range.units")) {
        foundry.utils.setProperty(activity, "range.units", activityRangeUnits);
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply pre-use attack automation.`, error);
    }

    return true;
  }

  #isImprovisedForSize(actor, item) {
    return item?.type === "weapon" && !isNaturalWeapon(item) && getWeaponSizeUse(actor, item).improvised;
  }

  #noteImprovisedSize(message) {
    const note = "Импровизированное оружие: размер превышает допустимый для владельца.";
    message.data ??= {};
    const previous = String(message.data.flavor ?? "");
    if (!previous.includes(note)) message.data.flavor = [previous, note].filter(Boolean).join("<br>");
  }

  #applyEquipmentSizeAttack(config, dialog, message) {
    const activity = config.subject, item = activity.item, actor = activity.actor ?? item.actor;
    if (!this.#isImprovisedForSize(actor, item)) return;
    const project = (roll, ensureTerm = true) => {
      roll.data ??= {};
      const trained = actor?.getFlag?.("dnd5e", "tavernBrawlerFeat") === true;
      roll.data.prof = trained ? item.system?.prof?.clone?.({ multiplier: 1 })?.term ?? getActorProficiencyBonus(actor) : 0;
      if (trained && ensureTerm && !(roll.parts ?? []).some(part => /@prof\b/u.test(String(part)))) {
        roll.parts ??= []; roll.parts.push("@prof");
      }
    };
    const original = dialog.options?.buildConfig;
    for (const roll of config.rolls ?? []) project(roll, typeof original !== "function");
    if (typeof original === "function" && !original[EQUIPMENT_SIZE_ATTACK_BUILDER]) {
      const wrapped = function (...args) {
        const result = original.apply(this, args);
        if (result?.then) return result.then(value => { project(args[1]); return value; });
        project(args[1]); return result;
      };
      wrapped[EQUIPMENT_SIZE_ATTACK_BUILDER] = true;
      dialog.options.buildConfig = wrapped;
    }
    this.#noteImprovisedSize(message);
  }

  #applyEquipmentSizeDamage(config, message) {
    const activity = config.subject, item = activity.item, actor = activity.actor ?? item.actor;
    if (activity.flags?.[MODULE_ID]?.weaponModActivity || !this.#isImprovisedForSize(actor, item)) return;
    const roll = (config.rolls ?? []).find(entry => entry.base) ?? config.rolls?.[0];
    if (!roll) return;
    roll.parts ??= [];
    const sourceFormula = damagePartFormula(item.system?.damage?.base);
    const primary = extractPrimaryDiceTerm(sourceFormula);
    const dice = /\b(\d*)d(\d+)\b/iu;
    const reference = sourceFormula.match(/^\s*\(*\s*(@scale\.[\w.]+)/u)?.[1];
    let index = reference ? roll.parts.findIndex(part => String(part).match(/^\s*\(*\s*(@[\w.]+)/u)?.[1] === reference) : -1;
    if (index < 0) index = primary ? roll.parts.findIndex(part => {
      const match = String(part).match(dice);
      return match && Number(match[1] || 1) === primary.number && Number(match[2]) === primary.faces;
    }) : -1;
    if (index < 0) index = roll.parts.findIndex(part => dice.test(String(part)));
    if (index < 0) index = roll.parts.findIndex(part => /^\s*\(*\s*\d+(?:\.\d+)?(?:\s*[+-]|$)/u.test(String(part)));
    if (index < 0) roll.parts.unshift("1d4");
    else if (!reference && dice.test(String(roll.parts[index]))) roll.parts[index] = String(roll.parts[index]).replace(dice, "1d4");
    else roll.parts[index] = String(roll.parts[index]).replace(/^(\s*\(*\s*)(?:\d*d\d+|\d+(?:\.\d+)?|@[\w.]+)/iu, (_match, prefix) => `${prefix}1d4`);
    this.#noteImprovisedSize(message);
  }

  applyDnd5eAttackRollConfig(config = {}, dialog = {}, message = {}) {
    const activity = config?.subject ?? null;
    if (isWhirlwindActivity(activity)) {
      if (!this.prepareWhirlwindUse(activity, { workflow: config.workflow }, message)) return false;
      config.target = undefined;
      for (const roll of config.rolls ?? []) {
        roll.options ??= {};
        roll.options.rebreyaWhirlwindTargets = message.data.flags.dnd5e.targets;
      }
    }
    if (!this.#isWeaponAttackActivity(activity)) {
      return true;
    }

    try {
      const item = activity.item;
      this.tagWeaponModAttack(config);
      if(activity.flags?.[MODULE_ID]?.weaponModActivity){
        try{this.getManagedWeaponModActivityDefinition(activity);}
        catch(error){globalThis.ui?.notifications?.warn?.(error.message);return false;}
        if(!this.deferWeaponModAttack(activity,config,dialog,message,"rollAttack"))return false;
        return this.moduleApi.itemUpgradeAutomationService?.rolls.preRollAttack(config)!==false;
      }
      this.hydrateWeaponModAttackConditions(config,message);
      this.#applyEquipmentSizeAttack(config, dialog, message);
      if(!this.deferWeaponModAttack(activity,config,dialog,message,"rollAttack"))return false;
      if (this.moduleApi.itemUpgradeAutomationService?.rolls.preRollAttack(config) === false) return false;
      if (this.#blockJammedFirearm(item)) {
        return false;
      }

      const isFirearm = isFirearmItem(item);
      if(isFirearm){
        const ordered=magazineRounds(this.#resolveFirearmAmmoState(item)),source=ordered.sources[ordered.rounds[0]],bonus=source?.system?.magicalBonus;
        for(const roll of config.rolls??[]){
          roll.options??={};
          if(config.workflow?.id)roll.options.rebreyaFirearmWorkflowId=config.workflow.id;
          if(bonus && source.system.magicAvailable!==false && !roll.options.rebreyaAmmunitionBonus){roll.parts??=[];roll.parts.push(String(bonus));roll.options.rebreyaAmmunitionBonus=true;}
        }
      }
      if (isFirearm && activity.attack?.type?.value!=="melee") applyFirearmTuning(item,config,Number(game.time?.worldTime));
      const repeatingShot = !isFirearm && hasActiveRepeatingShot(item);
      if (!isFirearm && !repeatingShot) {
        this.#clearInvalidNativeAmmunitionSelection(activity, config, dialog);
        if(this.#hasItemProperty(item,"amm")){
          const choices=collectionValues(activity.actor?.items??item.actor?.items).filter(ammo=>this.#isCompatibleAmmunition(item,ammo) && !readDocumentFlag(ammo,MODULE_ID,"installedWeaponMod")?.hostItemId);
          if(!choices.length){ui.notifications?.warn?.("Нет совместимых боеприпасов.");return false;}
          dialog.configure=true;dialog.options??={};
          dialog.options.ammunitionOptions=[{value:"",label:"Выберите боеприпас"},...choices.map(ammo=>({value:ammo.id,label:`${ammo.name} (${this.#getItemQuantity(ammo)})`}))];
        }
      }

      if (isFirearm || repeatingShot) {
        if (isFirearm) {
          this.#suppressNativeFirearmAmmunition(item);
        }
        config.ammunition = false;
        for (const rollConfig of config?.rolls ?? []) {
          rollConfig.ammunition = false;
          rollConfig.options ??= {};
          rollConfig.options.ammunition = false;
        }
        dialog.options ??= {};
        dialog.options.ammunitionOptions = [];

        if (isFirearm) {
          if (this.#getFirearmAmmoShotBlock(item)) {
            return true;
          }
        }
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

  #recordAmmunitionShot(roll,activity,data,count,{defer=false,message=roll?.parent}={}) {
    const shot={data:structuredClone(data),count,weaponId:activity.item.id,spent:true};
    this._ammunitionShots.set(roll,shot);
    const card=message;
    if(card){
      const patch={[`flags.${MODULE_ID}.ammunitionShot`]:shot};
      if(data)patch["flags.dnd5e.roll.ammunitionData"]={...structuredClone(data),system:{...structuredClone(data.system),quantity:1}};
      if(data){const rule=getAmmunitionDamage(data);if(rule.manual)patch[`flags.${MODULE_ID}.ammunitionManual`]=rule.manual;}
      for(const [key,value] of Object.entries(patch))try{foundry.utils.setProperty(card,key,value);}catch(_){}
      if(defer)return patch;
      Promise.resolve(card.update?.(patch)).catch(error=>console.error(`${MODULE_ID} | Failed to save ammunition shot context.`,error));
    }
  }

  validateAmmunitionRollConfiguration(rolls,config={}) {
    const activity=config.subject,item=activity?.item;
    if(!this.#isWeaponAttackActivity(activity) || isFirearmItem(item) || hasActiveRepeatingShot(item) || !this.#hasItemProperty(item,"amm"))return true;
    if(!rolls?.length)return true;
    for(const roll of rolls){
      const ammo=activity.actor?.items?.get?.(roll.options?.ammunition);
      if(!this.#isCompatibleAmmunition(item,ammo)){ui.notifications?.warn?.("Выберите доступный совместимый боеприпас.");return false;}
      roll.options.rebreyaAmmunitionData=this.#captureAmmunition(ammo).data;
    }
    return true;
  }

  prepareAmmunitionWorkflow(workflow) {
    const activity=workflow?.activity,item=activity?.item??workflow?.item;
    if(!item || !isFirearmItem(item) || activity?.flags?.[MODULE_ID]?.weaponModActivity)return true;
    const state=this.#resolveFirearmAmmoState(item),amount=this.#resolveFirearmShotAmmoCost(item);
    if(this.#blockFirearmShotWithoutAmmo(item))return false;
    const ordered=magazineRounds(state);
    workflow.rebreyaAmmunitionShot={data:structuredClone(ordered.sources[ordered.rounds[0]]??null),count:amount,weaponId:item.id};
    return true;
  }

  renderAmmunitionNotice(message,html) {
    const root=html?.[0]??html,shot=readDocumentFlag(message,MODULE_ID,"ammunitionShot");
    this.renderFirearmChatActions(message,root);
    if(!shot?.data || !root?.querySelector || root.querySelector(".rm-ammunition-notice"))return;
    const text=getAmmunitionDamage(shot.data).manual,notice=document.createElement("p");notice.className="rm-ammunition-notice";
    notice.textContent=`Боеприпас: ${shot.data.name}. Потрачено: ${shot.count}.${text?` Вручную: ${text}`:""}`;
    root.append(notice);
  }

  renderFirearmChatActions(message,root) {
    if(!root?.querySelector)return;
    this.#renderFirearmMisfireAction(message,root);
    root.querySelector(".rm-firearm-reload")?.remove();
    const target=readDocumentFlag(message,MODULE_ID,FIREARM_RELOAD_CHAT_FLAG);
    const authorId=message.author?.id??message.author??message.user?.id??message.user;
    for(const row of root.querySelectorAll?.("[data-rebreya-firearm-owner-only]")??[])row.hidden=authorId!==game.user?.id;
    for(const card of root.querySelectorAll?.(".rebreya-firearm-chat-notes")??[]){
      const rows=Array.from(card.querySelectorAll(".rm-reaction-chat__text>span"));
      card.hidden=rows.length>0&&rows.every(row=>row.hidden);
    }
    if(authorId!==game.user?.id || !target)return;
    const actor=this.#resolveActorFromUuid(target.actorUuid),weapon=actor?.items?.get?.(target.weaponId);
    const host=root.querySelector(".rebreya-firearm-chat-notes .rm-reaction-chat__body");
    if(!actor?.isOwner || !isFirearmItem(weapon) || !host)return;
    const button=document.createElement("button");button.type="button";button.className="rm-firearm-reload";button.textContent="Перезарядить";
    button.addEventListener("click",async event=>{
      event.preventDefault();if(button.disabled)return;button.disabled=true;
      try{
        const current=this.#resolveActorFromUuid(target.actorUuid),item=current?.items?.get?.(target.weaponId);
        if(!current?.isOwner || !isFirearmItem(item))throw new Error("Оружие недоступно.");
        await this.openMagazineEditor(current,item);
      }catch(error){ui.notifications?.warn?.(error.message);}
      finally{button.disabled=false;}
    });
    host.append(button);
  }

  #renderFirearmMisfireAction(message,root) {
    root.querySelector(".rm-firearm-cancel-misfire")?.remove?.();
    const state=readDocumentFlag(message,MODULE_ID,FIREARM_MISFIRE_CHAT_FLAG);
    if(!state?.jammed||state.cancelled)return;
    const authorId=message.author?.id??message.author??message.user?.id??message.user;
    const actor=this.#resolveActorFromUuid(state.actorUuid),weapon=actor?.items?.get?.(state.weaponId);
    if(!actor?.isOwner||!isFirearmItem(weapon)||(!game.user?.isGM&&authorId!==game.user?.id))return;
    const host=root.querySelector(".rebreya-firearm-chat-notes .rm-reaction-chat__body");if(!host)return;
    const button=document.createElement("button");button.type="button";button.className="rm-firearm-cancel-misfire";button.textContent="Отменить осечку";
    button.disabled=Boolean(state.workflowId&&!globalThis.MidiQOL?.Workflow?.getWorkflow?.(state.workflowId)?.attackRoll);
    button.title=button.disabled?"MIDI не сохранил исходную сессию броска.":"Игнорировать осечку этого выстрела";
    button.addEventListener("click",async event=>{
      event.preventDefault();if(button.disabled)return;button.disabled=true;
      try{await this.cancelFirearmMisfire(message);}
      catch(error){ui.notifications?.warn?.(error.message);}
      finally{button.disabled=false;}
    });host.append(button);
  }

  applyDnd5ePostAttackRoll(rolls = [], context = {}) {
    this.reportWhirlwindAttack(rolls, context).catch(error => console.error(`${MODULE_ID} | Whirlwind hit report failed.`, error));
    const activity = context?.subject ?? null;
    if(activity?.flags?.[MODULE_ID]?.weaponModActivity)return true;
    if (!this.#isWeaponAttackActivity(activity)) {
      return true;
    }

    try {
      const item = activity.item;
      const firstRoll = Array.isArray(rolls) ? (rolls[0] ?? null) : (rolls ?? null);
      if (!firstRoll) {
        return true;
      }
      if (this._ammunitionShots.has(firstRoll) || readDocumentFlag(firstRoll.parent,MODULE_ID,"ammunitionShot")?.spent) return true;

      if (isFirearmItem(item)) {
        const actor = activity.actor ?? item.actor ?? null;
        const midiWorkflow=globalThis.MidiQOL?.Workflow?.getWorkflow?.(firstRoll.options?.rebreyaFirearmWorkflowId);
        const message=firstRoll.parent??midiWorkflow?.chatCard??null;
        const firearmMessageOptions = {
          message,
          ...(typeof message?.update === "function" && message.content ? { messageConfig: {},deferFirearmChatSync:true } : {})
        };
        const ammo = this.#consumeLoadedFirearmAmmo(
          actor,
          item,
          this.#resolveFirearmShotAmmoCost(item),
          firearmMessageOptions
        );
        if (ammo.success) {
          firearmMessageOptions.ammunitionPatch=this.#recordAmmunitionShot(firstRoll, activity, ammo.ammunitionData, ammo.ammoSpent,{defer:firearmMessageOptions.deferFirearmChatSync,message})??{};
          if(activity.attack?.type?.value!=="melee")startFirearmTuning(item,Number(game.time?.worldTime)).catch(error=>console.error(`${MODULE_ID} | Failed to start firearm tuning.`,error));
          const misfire=this.#rollFirearmMisfire(actor, item, {...firearmMessageOptions, firearmAmmo: ammo,firearmAttackRoll:firstRoll,firearmWorkflowId:midiWorkflow?.id??null});
          if(midiWorkflow)midiWorkflow.rebreyaFirearmMisfire=misfire.shot;
          firearmMessageOptions.ammunitionPatch[`flags.${MODULE_ID}.-=${FIREARM_MISFIRE_CHAT_FLAG}`]=null;
          firearmMessageOptions.ammunitionPatch[`flags.${MODULE_ID}.${FIREARM_MISFIRE_CHAT_FLAG}`]=misfire.shot;
          if(!midiWorkflow&&message?.rolls?.includes?.(firstRoll)&&typeof firstRoll.toJSON==="function")firearmMessageOptions.ammunitionPatch.rolls=message.rolls.map(roll=>roll.toJSON());
        }
        if(firearmMessageOptions.deferFirearmChatSync){
          const synced=this.#syncFirearmChatCardNotes(firearmMessageOptions,foundry.utils.getProperty(firearmMessageOptions.messageConfig.data,`flags.${MODULE_ID}.${FIREARM_CHAT_NOTES_FLAG}`));
          if(!synced && firearmMessageOptions.ammunitionPatch)Promise.resolve(message.update(firearmMessageOptions.ammunitionPatch)).catch(error=>console.error(`${MODULE_ID} | Failed to save ammunition shot.`,error));
        }
      }
      else if (firstRoll.options?.ammunition && !hasActiveRepeatingShot(item)) {
        const source=firstRoll.options.rebreyaAmmunitionData??activity.actor?.items?.get?.(firstRoll.options.ammunition)??firstRoll.parent?.getFlag?.("dnd5e","roll.ammunitionData");
        if(source)this.#recordAmmunitionShot(firstRoll,activity,this.#captureAmmunition(source).data,1);
      }

      const automation = this.#getLichAutomationState(item);
      const rku = Math.max(0, Math.floor(toNumber(automation.rku, 0)));
      if (rku <= 0) {
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

  async applyMidiFirearmMisfire(workflow,{afterHits=false}={}) {
    const state=activeFirearmMisfire(workflow);if(!state)return false;
    if(!state.midiOriginal){
      const tracker=workflow.attackRollModifierTracker;
      state.midiOriginal={isFumble:workflow.isFumble,isCritical:workflow.isCritical,
        ...(tracker?.critical?.get?{critical:structuredClone(tracker.critical.get),fumble:structuredClone(tracker.fumble.get)}:{})};
      await workflow.chatCard?.update?.({[`flags.${MODULE_ID}.-=${FIREARM_MISFIRE_CHAT_FLAG}`]:null,[`flags.${MODULE_ID}.${FIREARM_MISFIRE_CHAT_FLAG}`]:state});
    }
    applyFirearmMisfireToRoll(workflow.attackRoll,state);
    workflow.isFumble=true;workflow.isCritical=false;
    if(afterHits){
      workflow.hitTargets=new Set();workflow.hitTargetsEC=new Set();
      for(const data of Object.values(workflow.hitDisplayData??{})){data.hitResult="miss";data.hitString="Промах: осечка";data.hitSymbol="fa-xmark";}
      await workflow.displayAttackRoll?.();
    }
    return true;
  }

  canRollFirearmDamage(workflow) {return !activeFirearmMisfire(workflow);}

  async cancelFirearmMisfire(message) {
    const state=readDocumentFlag(message,MODULE_ID,FIREARM_MISFIRE_CHAT_FLAG);
    if(!state?.jammed)throw new Error("У этого выстрела нет сохранённой осечки.");
    const actor=this.#resolveActorFromUuid(state.actorUuid),weapon=actor?.items?.get?.(state.weaponId);
    const authorId=message.author?.id??message.author??message.user?.id??message.user;
    if(!actor?.isOwner || !isFirearmItem(weapon) || (!game.user?.isGM&&authorId!==game.user?.id) || message.canUserModify?.(game.user,"update")===false)throw new Error("Нет прав отменить осечку этого выстрела.");
    if(state.cancelled)return {success:true,alreadyCancelled:true};
    const workflow=state.workflowId?globalThis.MidiQOL?.Workflow?.getWorkflow?.(state.workflowId):null;
    if(state.workflowId && !workflow?.attackRoll)throw new Error("Не удалось восстановить исходный бросок атаки.");
    const currentState=readDocumentFlag(workflow?.chatCard,MODULE_ID,FIREARM_MISFIRE_CHAT_FLAG);
    if(currentState && (currentState.jammedAt!==state.jammedAt||currentState.weaponId!==state.weaponId||currentState.actorUuid!==state.actorUuid))throw new Error("В этой карточке уже другой выстрел.");
    const next={...state,cancelled:true};
    const notes=(readDocumentFlag(message,MODULE_ID,FIREARM_CHAT_NOTES_FLAG)??[]).map(note=>note.replace("(заклинено)","(осечка отменена)").replace(/\s+\(клин\)/gu,""));
    await message.update({[`flags.${MODULE_ID}.-=${FIREARM_MISFIRE_CHAT_FLAG}`]:null,[`flags.${MODULE_ID}.${FIREARM_MISFIRE_CHAT_FLAG}`]:next,[`flags.${MODULE_ID}.${FIREARM_CHAT_NOTES_FLAG}`]:notes,content:this.#withFirearmChatCardNotes(message.content,notes)});
    if(readDocumentFlag(weapon,MODULE_ID,FIREARM_JAMMED_FLAG)?.jammedAt===state.jammedAt){
      await weapon.update({[`flags.${MODULE_ID}.-=${FIREARM_JAMMED_FLAG}`]:null,name:stripFirearmJamSuffix(weapon.name)});
    }
    if(workflow){
      workflow.rebreyaFirearmMisfire=next;applyFirearmMisfireToRoll(workflow.attackRoll,next);
      const original=state.midiOriginal??{isFumble:state.originalIsFumble,isCritical:state.originalIsCritical};
      if(original.critical&&workflow.attackRollModifierTracker?.critical?.restore){
        // Load MIDI's lazy persisted overrides before restoring this shot's state.
        void workflow.isFumble;void workflow.isCritical;
        workflow.attackRollModifierTracker.critical.restore(original.critical);workflow.attackRollModifierTracker.fumble.restore(original.fumble);
        workflow.persistFields?.({isCritical:workflow.isCritical,isFumble:workflow.isFumble});
      }else{workflow.isFumble=original.isFumble;workflow.isCritical=original.isCritical;}
      await workflow.checkHits();await workflow.displayAttackRoll();
      await workflow.callMidiHooks?.("midi-qol.hitsChecked");await workflow.displayHits?.(workflow.whisperAttackCard);
      if(workflow.damageRolls?.length)await workflow.performState(workflow.WorkflowState_ConfirmRoll,{damageRoll:workflow.damageRolls[0]});
      else if(workflow.shouldRollDamage)await workflow.performState(workflow.postAttackRollState);
    }else{
      const roll=message.rolls?.find(roll=>roll.options?.rebreyaFirearmMisfire?.jammedAt===state.jammedAt);
      if(roll){applyFirearmMisfireToRoll(roll,next);await message.update({rolls:message.rolls.map(r=>r.toJSON())});}
    }
    return {success:true,cancelled:true};
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
    if (isWhirlwindActivity(activity)) {
      markWhirlwindDamageRolls(config);
      this.prepareWhirlwindDamageCard(config, message);
    }
    const originId=config.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId??config.workflow?.itemCardId??config.workflow?.itemCardUuid?.split(".").at(-1);
    const origin=(originId?game.messages?.get?.(originId):null)??this.#resolveFirearmOriginatingMessage({messageConfig:message});
    if(activeFirearmMisfire(config.workflow??{chatCard:origin}))return false;
    const savedShot=config.rebreyaAmmunitionShot??config.workflow?.rebreyaAmmunitionShot??readDocumentFlag(origin,MODULE_ID,"ammunitionShot");
    const ammunitionData=savedShot?.data??(config.ammunition?this.#captureAmmunition(config.ammunition).data:null);
    const physicalProperties=Array.from(ammunitionData?.system?.properties??[]).filter(key=>globalThis.CONFIG?.DND5E?.itemProperties?.[key]?.isPhysical);
    const area=[FIREARM_AUTOMATIC_FIRE_AUTOMATION,FIREARM_SEMI_AUTOMATIC_FIRE_AUTOMATION].includes(activity?.flags?.[MODULE_ID]?.automation);
    if(area && isFirearmItem(activity?.item)){
      if(ammunitionData)applyAmmunitionDamage(config,ammunitionData,{nativeApplied:Boolean(config.ammunition),physicalProperties});
      return true;
    }
    if (!this.#isWeaponAttackActivity(activity)) {
      return true;
    }

    try {
      const item = activity.item;
      if(ammunitionData)applyAmmunitionDamage(config,ammunitionData,{nativeApplied:Boolean(config.ammunition),physicalProperties});
      if (this.moduleApi.itemUpgradeAutomationService?.rolls.preRollDamage(config, message) === false) return false;
      this.#applyEquipmentSizeDamage(config, message);
      const automation = this.#getLichAutomationState(item);
      const mu = Math.max(0, Math.floor(toNumber(automation.mu, 0)));
      const mku = Math.max(0, Math.floor(toNumber(automation.mku, 0)));
      const rku = Math.max(0, Math.floor(toNumber(automation.rku, 0)));
      const dualWieldGloves = hasDualWieldGlovesDamageBonus(activity.actor ?? item?.actor, item);

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

      if (mu <= 0 && mku <= 0 && !rkuCriticalOnHit && !dualWieldGloves) {
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

      if (dualWieldGloves && !hasEquivalentFlatTwoPart(baseDamageRollConfig.parts)) {
        baseDamageRollConfig.parts ??= [];
        baseDamageRollConfig.parts.push("+2");
      }

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
    if (this.#isImprovisedForSize(actor, item)) parts.push("Импровизированное оружие по размеру");

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

    const spendKeys = patch.reactionSpendKeys ?? actor.getFlag(MODULE_ID, REACTION_STATE_FLAG)?.reactionSpendKeys;

    await actor.setFlag(MODULE_ID, REACTION_STATE_FLAG, {
      usesMax: next.usesMax,
      usesRemaining: next.usesRemaining,
      lastRefreshCombatId: String(next.lastRefreshCombatId ?? ""),
      lastRefreshRound: Math.floor(toNumber(next.lastRefreshRound, 0)),
      lastRefreshTurn: Math.floor(toNumber(next.lastRefreshTurn, -1)),
      lastReactionType: String(next.lastReactionType ?? ""),
      lastReactionAt: next.lastReactionAt ?? null,
      ...(Array.isArray(spendKeys) ? { reactionSpendKeys: spendKeys.slice(-64) } : {})
    });

    return this.getReactionState(actor);
  }

  canUseReaction(actorOrId, requiredUses = 1) {
    const actor = this.#resolveActor(actorOrId);
    const state = actor instanceof Actor ? this.getReactionState(actor) : null;
    if (!state) {
      return {
        actorId: null,
        canUse: false,
        requiredUses: Math.max(1, Math.floor(toNumber(requiredUses, 1))),
        state: null
      };
    }

    const safeRequiredUses = Math.max(1, Math.floor(toNumber(requiredUses, 1)));
    if (actorHasReactionSuppression(actor) || this.moduleApi?.curseUpgradeAutomationService?.blocksReaction(actor)) {
      return {
        actorId: state.actorId,
        canUse: false,
        requiredUses: safeRequiredUses,
        reason: "reactionSuppressed",
        state
      };
    }

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

    this._reactionSpendQueue ??= new Map();
    const key = actor.uuid || actor.id;
    const previous = this._reactionSpendQueue.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => this.#consumeReactionNow(actor, options));
    this._reactionSpendQueue.set(key, pending);
    try { return await pending; }
    finally {
      if (this._reactionSpendQueue.get(key) === pending) this._reactionSpendQueue.delete(key);
    }
  }

  async #consumeReactionNow(actor, options = {}) {
    const idempotencyKey = cleanText(options.idempotencyKey);
    const spendKeys = actor.getFlag(MODULE_ID, REACTION_STATE_FLAG)?.reactionSpendKeys ?? [];
    if (idempotencyKey && spendKeys.includes(idempotencyKey)) {
      return { actorId: actor.id, consumed: true, replayed: true, state: this.getReactionState(actor) };
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
      lastReactionAt: new Date().toISOString(),
      ...(idempotencyKey ? { reactionSpendKeys: [...spendKeys, idempotencyKey].slice(-64) } : {})
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

  async openMagazineEditor(actor,weapon) {
    const key=weapon.uuid??`${actor.id}:${weapon.id}`,existing=this._magazineEditors.get(key);
    if(existing instanceof Promise)return existing;
    if(existing?.rendered){existing.bringToFront();return existing;}
    const opening=(async()=>{
      const {AmmunitionMagazineApp}=await import("../ui/ammunition-magazine-app.js?v=1.5.32");
      const app=new AmmunitionMagazineApp(this,actor,weapon);await app.render({force:true});return app;
    })();
    this._magazineEditors.set(key,opening);
    try{const app=await opening;this._magazineEditors.set(key,app);return app;}
    catch(error){this._magazineEditors.delete(key);throw error;}
  }

  getMagazineEditorData(actor, weapon) {
    const canUpdate=actor?.canUserModify?.(game.user,"update")??(actor?.isOwner!==false);
    if (!(actor instanceof Actor) || weapon?.actor !== actor || actor.items?.get?.(weapon.id) !== weapon || !canUpdate) throw new Error("Нет прав на оружие персонажа.");
    const state = this.#resolveFirearmAmmoState(weapon), ordered = magazineRounds(state), stock = [], sources = {...ordered.sources};
    for (const item of this.#findMatchingAmmunition(actor, weapon, state.ammunition)) {
      if (readDocumentFlag(item, MODULE_ID, "installedWeaponMod")?.hostItemId) continue;
      const captured=this.#captureAmmunition(item); sources[captured.key]=captured.data;
      const row=stock.find(x=>x.key===captured.key);
      if(row)row.quantity+=this.#getItemQuantity(item);
      else stock.push({...captured,quantity:this.#getItemQuantity(item)});
    }
    const reservoir=readDocumentFlag(actor,MODULE_ID,IMPLANT_RELOAD_RESERVOIR_FLAG);
    const legacyReservoirMatch=reservoir?.ammunitionIdentifier===state.ammunition || reservoir?.ammunitionItemId===state.ammunition || this.#ammunitionStem(reservoir?.ammunitionName)===this.#ammunitionStem(state.ammunition);
    const snapshotCompatible=reservoir?.ammunitionData && this.#isCompatibleAmmunition(weapon,{...reservoir.ammunitionData,system:{...reservoir.ammunitionData.system,quantity:reservoir.quantity}});
    const canUseReservoir=this.moduleApi.implantAutomationService?.hasCapability?.(actor,"reloadWithoutFreeHand") && reservoir?.quantity>0
      && (snapshotCompatible || ((!reservoir.ammunitionData || !weapon.system.ammunition?.type) && legacyReservoirMatch));
    let reservoirKey=null;
    if(canUseReservoir){
      const captured=reservoir.ammunitionData?this.#captureAmmunition(reservoir.ammunitionData):{key:LEGACY_AMMUNITION,data:null};
      reservoirKey=captured.key;if(captured.data)sources[captured.key]=captured.data;
      const row=stock.find(x=>x.key===captured.key);
      if(row)row.quantity+=reservoir.quantity;else stock.unshift({...captured,quantity:reservoir.quantity});
    }
    for(const key of new Set(ordered.rounds)) if(!stock.some(x=>x.key===key))stock.push({key,data:sources[key]??null,quantity:0});
    const revision=ammunitionFingerprint({state:readDocumentFlag(weapon,MODULE_ID,FIREARM_AMMO_STATE_FLAG),stock:stock.map(x=>[x.key,x.quantity]),reservoir});
    return {revision,capacity:state.capacity,groupSize:this.#resolveFirearmShotAmmoCost(weapon),
      ...ordered,sources,stock,reservoir:canUseReservoir?structuredClone(reservoir):null,reservoirKey,presets:structuredClone(state.presets??[]),lastPattern:structuredClone(state.lastPattern??[])};
  }

  async commitMagazine(actor, weapon, draft) {
    const current=this.getMagazineEditorData(actor,weapon);
    if(current.revision!==draft.revision)throw new Error("Запас боеприпасов изменился. Откройте перезарядку заново.");
    const rounds=structuredClone(draft.rounds);validateMagazine(rounds,current.groupSize,current.capacity);
    const sources={...current.sources},old=[...current.rounds],updates=[],creates=[],checks={};
    const eligibleIds=new Set(this.#findMatchingAmmunition(actor,weapon,this.#resolveFirearmAmmoState(weapon).ammunition).map(item=>item.id));
    if(draft.legacyResolutionKey){
      if(!game.user?.isGM || !sources[draft.legacyResolutionKey])throw new Error("Разновидность старых зарядов может указать только мастер.");
      for(let i=0;i<old.length;i++)if(old[i]===LEGACY_AMMUNITION)old[i]=draft.legacyResolutionKey;
    }
    const keys=new Set([...old,...rounds]);let loaded=0,reservoirLoaded=0;
    const reservoirBefore=readDocumentFlag(actor,MODULE_ID,IMPLANT_RELOAD_RESERVOIR_FLAG)??null;
    let reservoirAfter=structuredClone(reservoirBefore);
    for(const key of keys){
      if(key!==LEGACY_AMMUNITION && !sources[key])throw new Error("Неизвестная разновидность боеприпаса.");
      let delta=rounds.filter(x=>x===key).length-old.filter(x=>x===key).length;
      if(!delta)continue;
      if(delta<0 && key===LEGACY_AMMUNITION)throw new Error("Разновидность старых зарядов неизвестна. Мастер должен указать её перед возвратом.");
      const matches=collectionValues(actor.items).filter(item=>this.#isAmmunitionItem(item) && (delta<0 || eligibleIds.has(item.id)) && !readDocumentFlag(item,MODULE_ID,"installedWeaponMod")?.hostItemId && this.#captureAmmunition(item).key===key);
      if(delta>0){
        loaded+=delta;
        if(current.reservoirKey===key){const n=Math.min(delta,current.reservoir.quantity);delta-=n;reservoirLoaded+=n;reservoirAfter.quantity-=n;}
        for(const item of matches){
          const available=this.#getItemQuantity(item),n=Math.min(delta,available);if(!n)continue;
          updates.push({_id:item.id,[this.#itemQuantityUpdatePath(item)]:available-n});checks[item.id]={key,before:available,after:available-n};delta-=n;if(!delta)break;
        }
        if(delta)throw new Error("Не хватает выбранных патронов. Состав не изменён.");
      }else{
        const item=matches[0];
        if(item){const quantity=this.#getItemQuantity(item);updates.push({_id:item.id,[this.#itemQuantityUpdatePath(item)]:quantity-delta});checks[item.id]={key,before:quantity,after:quantity-delta};}
        else{
          const id=globalThis.foundry?.utils?.randomID?.()??globalThis.crypto.randomUUID().replaceAll("-","").slice(0,16),data=structuredClone(sources[key]);
          data._id=id;data.system.quantity=0;data.system.container=null;creates.push(data);updates.push({_id:id,"system.quantity":-delta});checks[id]={key,before:0,after:-delta};
        }
      }
    }
    const presets=structuredClone(draft.presets??current.presets);
    if(!Array.isArray(presets) || presets.length>30 || presets.some(p=>typeof p.name!=="string" || p.name.length>80 || !Array.isArray(p.rounds) || p.rounds.some(k=>k!==LEGACY_AMMUNITION && !sources[k])))throw new Error("Неверный пресет магазина.");
    for(const preset of presets)validateMagazine(preset.rounds,current.groupSize,current.capacity);
    const pattern=rounds.length?rounds:current.lastPattern;
    const usedKeys=new Set([...rounds,...pattern,...presets.flatMap(p=>p.rounds)]);
    const persistedSources=Object.fromEntries(Object.entries(sources).filter(([key])=>usedKeys.has(key)));
    const beforeState=structuredClone(readDocumentFlag(weapon,MODULE_ID,FIREARM_AMMO_STATE_FLAG)??null),beforeName=weapon.name;
    const state=this.#resolveFirearmAmmoState(weapon),afterState={...(beforeState??{}),...state,schemaVersion:2,current:rounds.length,rounds,sources:persistedSources,presets,lastPattern:pattern};delete afterState.tracked;
    const result={success:true,weaponId:weapon.id,weaponName:withFirearmAmmoSuffix(weapon.name,rounds.length,current.capacity),loaded,current:rounds.length,capacity:current.capacity,
      reservoirLoaded,inventoryLoaded:loaded-reservoirLoaded,requested:Math.max(0,current.capacity-current.rounds.length),ammunition:state.ammunition,
      ammoUpdates:updates.map(x=>({itemId:x._id,remaining:Object.values(x)[1]}))};
    const same=(a,b)=>ammunitionFingerprint(a)===ammunitionFingerprint(b);
    const createdIds=[],createdSnapshots=new Map();
    let itemWriteAttempted=false;
    const readReservoir=()=>readDocumentFlag(actor,MODULE_ID,IMPLANT_RELOAD_RESERVOIR_FLAG)??null;
    const applied=()=>same(readDocumentFlag(weapon,MODULE_ID,FIREARM_AMMO_STATE_FLAG),afterState)
      && same(readReservoir(),reservoirAfter)
      && Object.entries(checks).every(([id,c])=>this.#getItemQuantity(actor.items.get(id))===c.after);
    try {
      for(const data of creates){
        try{await actor.createEmbeddedDocuments("Item",[structuredClone(data)],{keepId:true});}
        catch(error){if(!actor.items.get(data._id))throw error;}
        const item=actor.items.get(data._id);
        if(!item || this.#captureAmmunition(item).key!==checks[data._id].key || this.#getItemQuantity(item)!==0)throw new Error("Не удалось создать стак возвращаемых боеприпасов.");
        createdIds.push(data._id);createdSnapshots.set(data._id,this.#captureAmmunition(item).data);
      }
      for(const [id,check] of Object.entries(checks)){
        const item=actor.items.get(id);
        if(!item || this.#captureAmmunition(item).key!==check.key || this.#getItemQuantity(item)!==check.before)throw new Error("Запас изменился во время зарядки.");
      }
      if(!same(readDocumentFlag(weapon,MODULE_ID,FIREARM_AMMO_STATE_FLAG)??null,beforeState))throw new Error("Состав магазина изменился.");
      if(!same(reservoirBefore,reservoirAfter)){
        if(!same(readDocumentFlag(actor,MODULE_ID,IMPLANT_RELOAD_RESERVOIR_FLAG),reservoirBefore))throw new Error("Запас импланта изменился.");
        try{await actor.setFlag(MODULE_ID,IMPLANT_RELOAD_RESERVOIR_FLAG,structuredClone(reservoirAfter));}
        catch(error){if(!same(readReservoir(),reservoirAfter))throw error;}
        if(!same(readReservoir(),reservoirAfter))throw new Error("Foundry отменил изменение запаса импланта.");
      }
      const patches=[...structuredClone(updates),{_id:weapon.id,[`flags.${MODULE_ID}.==${FIREARM_AMMO_STATE_FLAG}`]:structuredClone(afterState),name:result.weaponName}];
      itemWriteAttempted=true;
      if(typeof actor.updateEmbeddedDocuments==="function")await actor.updateEmbeddedDocuments("Item",patches);
      else for(const {_id,...patch} of patches)await actor.items.get(_id).update(patch);
      if(!applied())throw new Error("Foundry не сохранил показанный состав боеприпасов.");
    }catch(error){
      if(applied())return result; // The native write succeeded but its acknowledgement was lost.
      const actualState=readDocumentFlag(weapon,MODULE_ID,FIREARM_AMMO_STATE_FLAG)??null;
      const stateBefore=same(actualState,beforeState),stateAfter=same(actualState,afterState);
      const known=(stateBefore || stateAfter) && (stateBefore || [beforeName,result.weaponName].includes(weapon.name))
        && [reservoirBefore,reservoirAfter].some(value=>same(readReservoir(),value))
        && Object.entries(checks).every(([id,c])=>{const item=actor.items.get(id);return item && this.#captureAmmunition(item).key===c.key && [c.before,c.after].includes(this.#getItemQuantity(item));});
      if(known && itemWriteAttempted){
        const restore=[];
        for(const [id,c] of Object.entries(checks)){
          const item=actor.items.get(id);
          if(c.before!==c.after && this.#getItemQuantity(item)===c.after)restore.push({_id:id,[this.#itemQuantityUpdatePath(item)]:c.before});
        }
        if(stateAfter)restore.push({_id:weapon.id,[`flags.${MODULE_ID}.${beforeState===null?"-=":"=="}${FIREARM_AMMO_STATE_FLAG}`]:structuredClone(beforeState),name:beforeName});
        if(restore.length){
          if(typeof actor.updateEmbeddedDocuments==="function")await actor.updateEmbeddedDocuments("Item",structuredClone(restore));
          else for(const {_id,...patch}of restore)await actor.items.get(_id).update(patch);
        }
        const restored=same(readDocumentFlag(weapon,MODULE_ID,FIREARM_AMMO_STATE_FLAG)??null,beforeState)
          && Object.entries(checks).every(([id,c])=>this.#getItemQuantity(actor.items.get(id))===c.before);
        if(restored && !same(reservoirBefore,reservoirAfter) && same(readReservoir(),reservoirAfter))await actor.setFlag(MODULE_ID,IMPLANT_RELOAD_RESERVOIR_FLAG,structuredClone(reservoirBefore));
        if(restored){
          const empty=createdIds.filter(id=>{const item=actor.items.get(id);return item && this.#getItemQuantity(item)===0 && same(this.#captureAmmunition(item).data,createdSnapshots.get(id));});
          if(empty.length)await actor.deleteEmbeddedDocuments("Item",empty);
        }
      }
      if(!itemWriteAttempted){
        const empty=createdIds.filter(id=>{const item=actor.items.get(id);return item && this.#getItemQuantity(item)===0 && same(this.#captureAmmunition(item).data,createdSnapshots.get(id));});
        if(empty.length)await actor.deleteEmbeddedDocuments("Item",empty);
      }
      throw error;
    }
    return result;
  }

  async unloadFirearm(actorOrItem,weaponOrId=null,options={}) {
    const weapon=this.#resolveFirearmWeapon(actorOrItem,weaponOrId),actor=weapon.actor;
    const draft=this.getMagazineEditorData(actor,weapon);draft.rounds=[];
    if(options.legacyResolutionKey)draft.legacyResolutionKey=options.legacyResolutionKey;
    return this.commitMagazine(actor,weapon,draft);
  }

  async reloadFirearm(actorOrItem, weaponOrId = null, options = {}) {
    const weapon=this.#resolveFirearmWeapon(actorOrItem,weaponOrId),actor=weapon.actor;
    if(options.draft)return this.commitMagazine(actor,weapon,options.draft);
    const draft=this.getMagazineEditorData(actor,weapon),state=this.#resolveFirearmAmmoState(weapon,options);
    if(!state.tracked)return {success:false,reason:"firearmAmmoUntracked",loaded:0,current:state.current,capacity:state.capacity};
    if(!draft.capacity || draft.rounds.length>=draft.capacity)return {success:true,reason:"firearmMagazineFull",loaded:0,current:state.current,capacity:state.capacity};
    for(const row of [...draft.stock].sort((a,b)=>Number(b.key===draft.reservoirKey)-Number(a.key===draft.reservoirKey))){
      const n=Math.min(draft.capacity-draft.rounds.length,row.quantity);draft.rounds.push(...Array(n).fill(row.key));
    }
    if(draft.rounds.length===state.current)return {success:false,reason:"firearmAmmoUnavailable",loaded:0,current:state.current,capacity:state.capacity};
    const result=await this.commitMagazine(actor,weapon,draft);
    this.#createFirearmChatMessage(actor,weapon,`${weapon.name}: перезарядка.`,{...options,firearmOwnerOnly:true});return result;
  }

  async planWeaponAmmoReconfiguration(actor,weapon,{capacity,ammunition,modernizedParts=[]}={}) {
    const fail=()=>{const error=new Error("Не удалось достоверно определить тип возвращаемых патронов.");error.code="unknown-ammunition";throw error;};
    if(!(actor instanceof Actor) || !(weapon instanceof Item) || actor.items.get(weapon.id)!==weapon)fail();
    const values=this.#getLichWeaponPropertyValues(weapon),saved=readDocumentFlag(weapon,MODULE_ID,FIREARM_AMMO_STATE_FLAG)??null;
    const baseCapacity=this.#parseFirstPositiveInteger(values.reload);
    // Weapons without a tracked magazine do not acquire one through this planner.
    if(!baseCapacity && !saved)return {updates:[],creates:[],before:{},after:{},returned:{quantity:0,ammunition:""}};
    const desired=getWeaponModAmmoConfiguration({capacity:baseCapacity || saved?.baseCapacity || saved?.capacity || 0,
      ammunition:cleanText(values.ammunition || saved?.ammunition)},modernizedParts);
    if(capacity!==undefined)desired.capacity=capacity;
    if(ammunition!==undefined)desired.ammunition=ammunition;
    if(!Number.isSafeInteger(desired.capacity) || desired.capacity<0)fail();
    const aliases={rifle:"Винтовочный",pistol:"Пистолетный",musket:"Мушкетный",shotgun:"Картечный"};
    desired.ammunition=aliases[desired.ammunition]??desired.ammunition;
    const subtype=label=>inferRebreyaAmmunitionSubtype({id:label}) || inferRebreyaWeaponAmmunitionSubtype({lichWeaponPropertyValues:{ammunition:aliases[label]??label}});
    const previousAmmo=cleanText(saved?.ammunition || values.ammunition),oldType=subtype(previousAmmo),nextType=subtype(desired.ammunition);
    if(!oldType || !nextType)fail();
    const current=saved?.current ?? 0;
    if(!Number.isSafeInteger(current) || current<0 || (saved && (!Number.isSafeInteger(saved.capacity) || current>saved.capacity)))fail();
    const returned=oldType!==nextType?current:Math.max(0,current-desired.capacity),nextCurrent=current-returned;
    const next={...(saved??{}),current:nextCurrent,capacity:desired.capacity,baseCapacity:desired.baseCapacity,
      ammunition:oldType===nextType && inferRebreyaAmmunitionSubtype({id:previousAmmo})?previousAmmo:desired.ammunition};
    const weaponSource=weapon.toObject?.()??weapon,identity={
      [`flags.${MODULE_ID}.lichWeaponPropertyValues`]:structuredClone(weaponSource.flags?.[MODULE_ID]?.lichWeaponPropertyValues??null),
      [`flags.${MODULE_ID}.gearId`]:weaponSource.flags?.[MODULE_ID]?.gearId??null,
      "system.properties":structuredClone(weaponSource.system?.properties??null)};
    const statePath=`flags.${MODULE_ID}.${FIREARM_AMMO_STATE_FLAG}`,before={[weapon.id]:{...identity,[statePath]:saved,name:weapon.name}},
      after={[weapon.id]:{...identity,[statePath]:next,name:withFirearmAmmoSuffix(weapon.name,nextCurrent,desired.capacity)}},creates=[];
    if(saved?.schemaVersion===2){
      const ordered=this.#projectMagazineState(saved),tail=ordered.rounds.slice(nextCurrent);
      if(tail.includes(LEGACY_AMMUNITION))fail();
      Object.assign(next,{rounds:ordered.rounds.slice(0,nextCurrent),sources:ordered.sources,presets:ordered.presets,lastPattern:ordered.lastPattern});
      for(const key of new Set(tail)){
        const quantity=tail.filter(k=>k===key).length,data=ordered.sources[key];if(!data)fail();
        const target=collectionValues(actor.items).find(item=>this.#isAmmunitionItem(item) && this.#captureAmmunition(item).key===key && !readDocumentFlag(item,MODULE_ID,"installedWeaponMod")?.hostItemId);
        if(target){
          const path=this.#itemQuantityUpdatePath(target),n=this.#getItemQuantity(target),snapshot=target.toObject?.()??this.#captureAmmunition(target).data;
          const snapshotIdentity={name:snapshot.name,type:snapshot.type,flags:structuredClone(snapshot.flags??null),effects:structuredClone(snapshot.effects??null),...Object.fromEntries(Object.entries(snapshot.system??{}).filter(([k])=>k!=="quantity").map(([k,v])=>[`system.${k}`,structuredClone(v)]))};
          before[target.id]={...snapshotIdentity,[path]:n};after[target.id]={...snapshotIdentity,[path]:n+quantity};
        }else{const source=structuredClone(data);source.system.quantity=quantity;source.system.container=null;creates.push({sourceId:source.flags?.[MODULE_ID]?.gearId??key,data:source});}
      }
      return {updates:Object.entries(after).map(([itemId,patch])=>({itemId,patch})),creates,before,after,returned:{quantity:returned,ammunition:previousAmmo}};
    }
    if(returned)fail(); // Historical count/family does not prove which cartridges were loaded.
    return {updates:Object.entries(after).map(([itemId,patch])=>({itemId,patch})),creates,before,after,
      returned:{quantity:returned,ammunition:previousAmmo}};
  }

  async loadImplantReloadReservoir(actorOrId, options = {}) {
    const actor = this.#resolveActor(actorOrId);
    const implantAutomationService = this.moduleApi?.implantAutomationService;
    if (
      !(actor instanceof Actor)
      || typeof implantAutomationService?.hasCapability !== "function"
      || !implantAutomationService.hasCapability(actor, "reloadWithoutFreeHand")
    ) {
      ui.notifications?.warn?.("Механизм перезарядки не установлен.");
      return {
        success: false,
        reason: "implantReloadUnavailable",
        loaded: 0
      };
    }

    const selection = options;
    if (!cleanText(selection?.ammunitionItemId)) {
      return {
        success: false,
        reason: "cancelled",
        loaded: 0
      };
    }

    const ammunitionItem = this.#resolveAmmunitionItemByIdentifier(
      actor,
      cleanText(selection.ammunitionItemId)
    );
    if (!ammunitionItem) {
      ui.notifications?.warn?.("Выбранные боеприпасы недоступны.");
      return {
        success: false,
        reason: "implantReloadAmmunitionUnavailable",
        loaded: 0
      };
    }

    const currentSource = readDocumentFlag(actor, MODULE_ID, IMPLANT_RELOAD_RESERVOIR_FLAG);
    const current = {
      ammunitionItemId: cleanText(currentSource?.ammunitionItemId),
      ammunitionIdentifier: cleanText(currentSource?.ammunitionIdentifier),
      ammunitionName: cleanText(currentSource?.ammunitionName),
      quantity: clampInteger(currentSource?.quantity, 0, IMPLANT_RELOAD_RESERVOIR_CAPACITY),
      capacity: IMPLANT_RELOAD_RESERVOIR_CAPACITY
    };
    const ammunitionData=this.#captureAmmunition(ammunitionItem).data;
    const sameAmmunition = current.quantity <= 0 || (currentSource?.ammunitionData
      && this.#captureAmmunition(currentSource.ammunitionData).key===this.#captureAmmunition(ammunitionItem).key);
    if (!sameAmmunition) {
      ui.notifications?.warn?.("В механизме уже находятся боеприпасы другого типа.");
      return {
        success: false,
        reason: "implantReloadAmmunitionMismatch",
        loaded: 0,
        reservoir: current
      };
    }

    const remainingCapacity = Math.max(0, IMPLANT_RELOAD_RESERVOIR_CAPACITY - current.quantity);
    if (remainingCapacity <= 0) {
      return {
        success: true,
        reason: "implantReloadReservoirFull",
        loaded: 0,
        reservoir: current
      };
    }
    const available = this.#getItemQuantity(ammunitionItem);
    const requestedValue = Number(selection.amount);
    const requested = Number.isFinite(requestedValue)
      ? Math.max(0, Math.floor(requestedValue))
      : remainingCapacity;
    const loaded = Math.min(requested, remainingCapacity, available);
    if (loaded <= 0) {
      return {
        success: false,
        reason: "implantReloadAmmunitionUnavailable",
        loaded: 0,
        reservoir: current
      };
    }

    const nextQuantity = available - loaded;
    await ammunitionItem.update?.({
      [this.#itemQuantityUpdatePath(ammunitionItem)]: nextQuantity
    });
    const reservoir = {
      ammunitionData,
      ammunitionItemId: cleanText(ammunitionItem.id),
      ammunitionIdentifier: cleanText(ammunitionItem.id),
      ammunitionName: cleanText(ammunitionItem.name),
      quantity: current.quantity + loaded,
      capacity: IMPLANT_RELOAD_RESERVOIR_CAPACITY
    };
    if (typeof actor.setFlag === "function") {
      await actor.setFlag(MODULE_ID, IMPLANT_RELOAD_RESERVOIR_FLAG, reservoir);
    }
    else {
      await actor.update?.({
        [`flags.${MODULE_ID}.${IMPLANT_RELOAD_RESERVOIR_FLAG}`]: reservoir
      });
    }
    this.#createFirearmChatMessage(
      actor,
      ammunitionItem,
      `Механизм перезарядки: загружено ${loaded}, боезапас ${reservoir.quantity}/${reservoir.capacity}.`,
      {...options,firearmOwnerOnly:true}
    );
    return {
      success: true,
      loaded,
      ammunitionItemId: ammunitionItem.id,
      ammunitionName: ammunitionItem.name,
      inventoryRemaining: nextQuantity,
      reservoir
    };
  }

  async resolveFirearmAreaFire(actorOrId, weaponOrId, options = {}) {
    const actor = this.#resolveActor(actorOrId);
    if (!(actor instanceof Actor)) {
      throw new Error("Failed to resolve actor for firearm area fire.");
    }

    const weapon = this.#resolveItem(actor, weaponOrId);
    if (!(weapon instanceof Item)) {
      throw new Error("Failed to resolve firearm weapon.");
    }

    if (!isFirearmItem(weapon)) {
      throw new Error("Selected weapon is not classified as firearm.");
    }

    if (this.#blockJammedFirearm(weapon)) {
      return {
        success: false,
        reason: "firearmJammed",
        weaponId: weapon.id,
        weaponName: weapon.name
      };
    }

    const requestedMode = normalizeLookupText(options.mode);
    const mode = requestedMode.includes("semi") || requestedMode.includes("полу")
      ? "semi"
      : (requestedMode.includes("auto") || requestedMode.includes("авто") ? "automatic" : this.#resolveFirearmFireMode(weapon, options));
    if (!["automatic", "semi"].includes(mode)) {
      return {
        success: false,
        reason: "firearmAreaModeUnavailable",
        weaponId: weapon.id,
        weaponName: weapon.name,
        mode
      };
    }

    const state = this.#resolveFirearmAmmoState(weapon, options);
    const targetCount = Math.max(1, Math.floor(toNumber(
      options.targetCount ?? globalThis.game?.user?.targets?.size,
      1
    )));
    const ammoRequired = mode === "automatic" ? Math.min(state.current,state.baseCapacity??state.capacity) : targetCount;
    const ammo = this.#consumeLoadedFirearmAmmo(actor, weapon, ammoRequired, {
      ...options,
      allowPartial: mode === "automatic",
      emptyMagazine: false
    });
    if (!ammo.success) {
      return {
        success: false,
        reason: ammo.reason,
        weaponId: weapon.id,
        weaponName: weapon.name,
        mode,
        ammo
      };
    }

    const values = this.#getLichWeaponPropertyValues(weapon, options);
    const fireModeDamage = cleanText(String(values.fireMode ?? "").match(/\(([^)]+)\)/u)?.[1]);
    const damageFormula = mode === "automatic"
      ? cleanText(values.automaticDamage ?? fireModeDamage)
      : cleanText(values.semiAutomaticDamage ?? values.automaticDamage ?? fireModeDamage);
    const coneFeet = mode === "automatic" ? 45 : 30;
    const abilityKey = this.#resolveFirearmAbilityKey(weapon, "dex");
    const abilityMod = getActorAbilityModifier(actor, abilityKey);
    const proficiencyBonus = this.#isAttackProficient(actor, weapon, options)
      ? getActorProficiencyBonus(actor)
      : 0;
    const attackBonus = abilityMod + proficiencyBonus + toNumber(options.bonus, 0);
    const saveDC = 8 + attackBonus;

    await startFirearmTuning(weapon,Number(game.time?.worldTime));

    this.#createFirearmChatMessage(
      actor,
      weapon,
      `${weapon.name}: ${mode === "automatic" ? "автоматический" : "полуавтоматический"} огонь, конус ${coneFeet} фт., Сл ${saveDC} Ловкости, урон ${damageFormula || "оружия"}. Потрачено ${ammo.ammoSpent} боеприпасов.${ammo.tracked && ammo.current === 0 ? "\nМагазин пуст. Используйте действие «Перезарядить»." : ""}`,
      {...options,firearmReload:ammo.tracked&&ammo.current===0?{actorUuid:actor.uuid,weaponId:weapon.id}:null}
    );

    return {
      success: true,
      actorId: actor.id,
      actorName: actor.name,
      weaponId: weapon.id,
      weaponName: weapon.name,
      mode,
      damageFormula,
      coneFeet,
      saveDC,
      abilityKey,
      attackBonus,
      ammoSpent: ammo.ammoSpent,
      current: ammo.current,
      capacity: ammo.capacity
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

    await this.handleWeaponModTurnChange(combat);

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
    let ammunitionShot=null;
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
    }

    const abilityKey = this.#resolveAttackAbilityKey(actor, weapon, options);
    const abilityMod = getActorAbilityModifier(actor, abilityKey);
    const proficiencyBonus = this.#isAttackProficient(actor, weapon, options)
      ? getActorProficiencyBonus(actor)
      : 0;
    const nativeActivities=Array.from(weapon.system.activities?.values?.()??Object.values(weapon.system.activities??{})),
      nativeActivity=nativeActivities.find(activity=>activity.type==="attack" && !activity.flags?.[MODULE_ID]?.weaponModActivity
        && (!options.activityId || (activity.id??activity._id)===options.activityId) && (!isFirearmItem(weapon) || activity.attack?.type?.value!=="melee")),
      modTarget=options.targetToken??this.#resolveActor(options.targetActor??options.targetId??null),
      modActivity=nativeActivity?.item===weapon?nativeActivity:{...nativeActivity,item:weapon,actor,
        uuid:nativeActivity?.uuid??(nativeActivity?`${weapon.uuid}.Activity.${nativeActivity.id??nativeActivity._id}`:null),
        actionType:isFirearmItem(weapon) || weapon.system.attackType==="ranged"?"rwak":"mwak"};
    let modConfig={},upgradeModifiers=this.moduleApi.itemUpgradeAutomationService?.rolls.evaluate(weapon,{primary:false},modTarget,modActivity,modConfig);
    if(upgradeModifiers?.weaponMods?.needsDecision.length){
      const known=this.getWeaponModAttackConditions(modActivity,modTarget,modConfig),decision=await this.promptWeaponModConditions(modActivity,modTarget,known,upgradeModifiers.weaponMods.needsDecision);
      if(!decision)throw new Error("Атака отменена.");
      modConfig={rebreyaWeaponModDecisions:[decision]};
      upgradeModifiers=this.moduleApi.itemUpgradeAutomationService.rolls.evaluate(weapon,{primary:false},modTarget,modActivity,modConfig);
    }
    if(upgradeModifiers?.weaponMods && (!upgradeModifiers.weaponMods.allowed || upgradeModifiers.weaponMods.needsDecision.length))throw new Error("Условия обвеса не выполнены или цель вне дистанции.");
    if (isFirearmItem(weapon)) {
      const ammo = this.#consumeLoadedFirearmAmmo(actor, weapon, this.#resolveFirearmShotAmmoCost(weapon, options), options);
      if (!ammo.success) {
        return {
          success: false,
          reason: ammo.reason,
          actorId: actor.id,
          actorName: actor.name,
          weaponId: weapon.id,
          weaponName: weapon.name,
          attackKind: String(options.attackKind ?? "weapon"),
          ammo
        };
      }

      ammunitionShot={data:structuredClone(ammo.ammunitionData),count:ammo.ammoSpent,weaponId:weapon.id,spent:true};
      const misfire = this.#rollFirearmMisfire(actor, weapon, {...options, firearmAmmo: ammo});
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
    const situationalBonus = (ammunitionShot?.data?.system?.magicAvailable!==false ? toNumber(ammunitionShot?.data?.system?.magicalBonus,0):0) + toNumber(options.bonus, 0) + (upgradeModifiers?.attackBonus ?? 0) + getFirearmTuningBonus(weapon,Number(game.time?.worldTime));
    const attackBonus = abilityMod + proficiencyBonus + situationalBonus;
    let rollMode = resolveRollMode(options);
    if(upgradeModifiers?.weaponMods?.range?.disadvantage){
      if(["advantage","heroicAdvantage"].includes(rollMode))rollMode="normal";
      else if(rollMode==="normal")rollMode="disadvantage";
    }
    if (upgradeModifiers?.advantage) {
      if (["disadvantage", "heroicDisadvantage"].includes(rollMode)) rollMode = "normal";
      else if (rollMode === "normal") rollMode = "advantage";
    }
    const d20Formula = buildD20Formula(rollMode);

    const formula = `${d20Formula} + @abilityMod + @proficiencyBonus + @situationalBonus`;
    const roll = await (new Roll(formula, {
      mod: abilityMod,
      abilityMod,
      proficiencyBonus,
      situationalBonus
    })).evaluate({ async: true });
    if(isFirearmItem(weapon))await startFirearmTuning(weapon,Number(game.time?.worldTime));

    const targetAc = this.#resolveTargetAc(options);
    const naturalRoll = extractNaturalD20Result(roll);
    const criticalThreshold = this.#resolveCriticalThreshold(weapon, options);
    const isCriticalHit = Number.isFinite(naturalRoll) && naturalRoll >= criticalThreshold;
    const isAutomaticMiss = Number.isFinite(naturalRoll) && naturalRoll === 1;
    const isAutomaticHit = Number.isFinite(naturalRoll) && naturalRoll === 20;
    const isHit = Number.isFinite(targetAc)
      ? (isAutomaticHit || (!isAutomaticMiss && roll.total >= targetAc))
      : null;
    if(modActivity.uuid){
      const targetTokens=options.targetToken?[options.targetToken]:modTarget instanceof Actor?Array.from(modTarget.getActiveTokens?.(true,true)??[]):null;
      this.tagWeaponModAttack({subject:modActivity,rolls:[roll],...(targetTokens?{targets:targetTokens.length===1?targetTokens:[]}:{} )});
      const context=roll.options?.rebreyaWeaponModAttack;
      if(context)Object.assign(context,{isCritical:isCriticalHit,isFumble:isAutomaticMiss});
    }

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
      const flags=roll.options?.rebreyaWeaponModAttack?{dnd5e:{activity:{uuid:modActivity.uuid},roll:{type:"attack"},messageType:"roll"}}:{};
      if(ammunitionShot){flags[MODULE_ID]={ammunitionShot};flags.dnd5e??={};flags.dnd5e.roll??={type:"attack"};
        if(ammunitionShot.data)flags.dnd5e.roll.ammunitionData={...structuredClone(ammunitionShot.data),system:{...structuredClone(ammunitionShot.data.system),quantity:1}};}
      await roll.toMessage({speaker: ChatMessage.getSpeaker({ actor }),flavor,...(Object.keys(flags).length?{flags}:{})});
    }

    return {
      ammunitionShot,
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

  #attackReactionProvider(kind) {
    return {
      listCandidates: (context) => {
        const state = this.#attackReactionState(context);
        return collectionValues(state.reactors)
          .filter((reactor) => reactor instanceof Actor)
          .map((reactor) => ({
            actor: reactor,
            actorUuid: cleanText(reactor.uuid, reactor.id),
            ownerUserIds: this.#reactionOwnerUserIds(reactor),
            reactionType: kind === PROVOKED_ATTACK_REACTION_KIND ? "provokedAttack" : kind
          }));
      },
      isTriggerValid: (context) => this.#attackReactionState(context).triggerActive !== false,
      revalidateCandidate: (candidate, context) => this.#canResolveAttackReaction(
        kind,
        this.#attackReactionCandidateState(context, candidate)
      ),
      buildPrompt: (candidate, context) => this.#attackReactionPrompt(
        kind,
        this.#attackReactionCandidateState(context, candidate)
      ),
      pay: async () => ({ paid: true }),
      apply: (candidate, _choice, context) => this.#applyAttackReaction(
        kind,
        this.#attackReactionCandidateState(context, candidate)
      ),
      rollback: (candidate, transaction, context) => this.#rollbackAttackReaction(
        kind,
        transaction,
        this.#attackReactionCandidateState(context, candidate)
      ),
      serializeEffect: (effect) => this.#serializeAttackReactionEffect(effect)
    };
  }

  #attackReactionState(context = {}) {
    const triggerId = cleanText(context.triggerId);
    const local = this._reactionTriggerContexts.get(triggerId) ?? context._resolvedAttackReaction;
    if (local) {
      return local;
    }

    const reactorReferences = [
      ...collectionValues(context.reactorUuids),
      ...collectionValues(context.reactorIds)
    ];
    if (!reactorReferences.length) {
      reactorReferences.push(context.reactorUuid ?? context.reactorId);
    }
    const reactors = Array.from(new Set(reactorReferences.filter(Boolean)))
      .map((reference) => this.#resolveReactionActor(reference))
      .filter((reactor) => reactor instanceof Actor);
    const reactor = reactors[0] ?? null;
    const target = this.#resolveReactionActor(context.targetUuid ?? context.targetId);
    const state = {
      reactor,
      reactors,
      target,
      incomingAttackTotal: toNumber(context.incomingAttackTotal, NaN),
      incomingDamage: Math.max(0, Math.floor(toNumber(context.incomingDamage, 0))),
      options: context.options && typeof context.options === "object" ? context.options : {},
      triggerActive: context.triggerActive !== false,
      serializedContext: context
    };
    context._resolvedAttackReaction = state;
    return state;
  }

  #attackReactionCandidateState(context, candidate = {}) {
    const rootState = this.#attackReactionState(context);
    const reactor = candidate.actor instanceof Actor
      ? candidate.actor
      : this.#resolveReactionActor(candidate.actorUuid);
    return {
      ...rootState,
      reactor,
      rootState
    };
  }

  #resolveReactionActor(reference) {
    const direct = this.#resolveActor(reference);
    if (direct instanceof Actor) {
      return direct;
    }
    const resolved = typeof reference === "string" ? globalThis.fromUuidSync?.(reference) : null;
    return resolved instanceof Actor ? resolved : resolved?.actor instanceof Actor ? resolved.actor : null;
  }

  #reactionOwnerUserIds(actor) {
    return collectionValues(globalThis.game?.users)
      .filter((user) => {
        if (user?.active === false) {
          return false;
        }
        if (user?.isGM === true) {
          return true;
        }
        if (typeof actor?.testUserPermission === "function") {
          return actor.testUserPermission(user, "OWNER") === true;
        }
        const ownership = actor?.ownership ?? actor?._source?.ownership ?? {};
        return Number(ownership[user?.id] ?? 0) >= 3 || Number(ownership.default ?? 0) >= 3;
      })
      .sort((left, right) => Number(left?.isGM === true) - Number(right?.isGM === true)
        || cleanText(left?.id).localeCompare(cleanText(right?.id)))
      .map((user) => cleanText(user?.id))
      .filter(Boolean);
  }

  #canResolveAttackReaction(kind, state) {
    const reactor = state.reactor;
    if (!(reactor instanceof Actor) || !this.canUseReaction(reactor, 1).canUse) {
      return false;
    }

    if (kind === PROVOKED_ATTACK_REACTION_KIND) {
      if (this.moduleApi?.craftsmanGadgetService?.suppressesProvokedAttack?.(state.target)) {
        return false;
      }
      const weapon = this.#resolveItem(
        reactor,
        state.options.weaponId ?? state.options.weaponName ?? state.options.weapon ?? ""
      ) ?? this.#findDefaultMeleeWeapon(reactor);
      return state.target instanceof Actor && weapon instanceof Item;
    }
    if (kind === PARRY_REACTION_KIND) {
      return Number.isFinite(state.incomingAttackTotal) && this.#hasParryEquipment(reactor);
    }
    if (kind === INTERCEPTION_REACTION_KIND) {
      return state.target instanceof Actor && this.#hasInterceptionEquipment(reactor);
    }
    return false;
  }

  #attackReactionPrompt(kind, state) {
    if (kind === PROVOKED_ATTACK_REACTION_KIND) {
      return {
        title: "Провоцированная атака",
        body: `Атаковать ${cleanText(state.target?.name, "цель")} реакцией?`,
        acceptLabel: "Атаковать",
        declineLabel: "Пропустить"
      };
    }
    if (kind === PARRY_REACTION_KIND) {
      return {
        title: "Парирование",
        body: `Попытаться парировать атаку с результатом ${state.incomingAttackTotal}?`,
        acceptLabel: "Парировать",
        declineLabel: "Пропустить"
      };
    }
    return {
      title: "Перехват",
      body: `Уменьшить ${state.incomingDamage} урона по ${cleanText(state.target?.name, "цели")}?`,
      acceptLabel: "Перехватить",
      declineLabel: "Пропустить"
    };
  }

  async #applyAttackReaction(kind, state) {
    let effect;
    if (kind === PROVOKED_ATTACK_REACTION_KIND) {
      effect = await this.#executeProvokedAttack(state);
    }
    else if (kind === PARRY_REACTION_KIND) {
      effect = this.#executeParry(state);
    }
    else {
      effect = await this.#executeInterception(state);
    }
    if (effect?.success !== true) {
      return { applied: false, ...effect };
    }
    if (
      (kind === PARRY_REACTION_KIND && effect.preventedHit === true)
      || (kind === INTERCEPTION_REACTION_KIND && effect.reducedDamage <= 0)
    ) {
      const rootState = state.rootState ?? state;
      rootState.triggerActive = false;
      if (rootState.serializedContext) {
        rootState.serializedContext.triggerActive = false;
      }
    }
    return { applied: true, ...effect };
  }

  async #rollbackAttackReaction(kind, transaction, state) {
    if (kind !== INTERCEPTION_REACTION_KIND) {
      return;
    }
    const previousHp = Number(transaction?.effect?.previousHp);
    if (Number.isFinite(previousHp) && state.target instanceof Actor) {
      await state.target.update({ "system.attributes.hp.value": previousHp });
    }
  }

  #serializeAttackReactionEffect(effect = {}) {
    const serialized = { ...effect };
    delete serialized.previousHp;
    if (serialized.roll && typeof serialized.roll === "object") {
      serialized.roll = {
        total: toNumber(serialized.roll.total, 0),
        naturalRoll: toNumber(serialized.roll.naturalRoll, 0),
        isHit: serialized.roll.isHit === true,
        isCriticalHit: serialized.roll.isCriticalHit === true,
        targetAc: Number.isFinite(Number(serialized.roll.targetAc)) ? Number(serialized.roll.targetAc) : null
      };
    }
    return serialized;
  }

  async #executeProvokedAttack(state) {
    const reactor = state.reactor;
    const target = state.target;
    const explicitWeapon = this.#resolveItem(
      reactor,
      state.options.weaponId ?? state.options.weaponName ?? state.options.weapon ?? ""
    );
    const weapon = explicitWeapon ?? this.#findDefaultMeleeWeapon(reactor);
    if (!(weapon instanceof Item)) {
      return { success: false, reason: "noMeleeWeapon", actorId: reactor.id, targetId: target.id };
    }
    const rollResult = await this.rollWeaponAttack(reactor, weapon, {
      ...state.options,
      attackKind: "provoked",
      targetActor: target
    });
    return {
      success: true,
      actorId: reactor.id,
      targetId: target.id,
      weaponId: weapon.id,
      roll: rollResult,
      interrupted: rollResult.isHit === true
    };
  }

  #executeParry(state) {
    const defender = state.reactor;
    const baseAc = Number.isFinite(Number(state.options.baseAc))
      ? Number(state.options.baseAc)
      : getActorAcValue(defender);
    if (!Number.isFinite(baseAc)) {
      return { success: false, reason: "armorClassUnavailable", actorId: defender.id };
    }
    const proficiencyBonus = getActorProficiencyBonus(defender);
    const adjustedAc = baseAc + proficiencyBonus;
    return {
      success: true,
      actorId: defender.id,
      attackTotal: state.incomingAttackTotal,
      baseAc,
      proficiencyBonus,
      adjustedAc,
      preventedHit: state.incomingAttackTotal < adjustedAc
    };
  }

  async #executeInterception(state) {
    const guardian = state.reactor;
    const target = state.target;
    const reduction = Math.max(0, this.#getHitDiceMaximum(guardian));
    const reducedDamage = Math.max(0, state.incomingDamage - reduction);
    let previousHp = null;
    if (state.options.applyDamage === true) {
      previousHp = toNumber(foundry.utils.getProperty(target, "system.attributes.hp.value"), NaN);
      if (Number.isFinite(previousHp)) {
        await target.update({
          "system.attributes.hp.value": Math.max(0, previousHp - reducedDamage)
        });
      }
    }
    return {
      success: true,
      actorId: guardian.id,
      targetId: target.id,
      incomingDamage: state.incomingDamage,
      reduction,
      reducedDamage,
      previousHp
    };
  }

  #serializableReactionOptions(options = {}) {
    try {
      return JSON.parse(JSON.stringify({
        weaponId: cleanText(options.weaponId ?? options.weapon?.id),
        weaponName: cleanText(options.weaponName),
        rollMode: cleanText(options.rollMode),
        advantage: options.advantage === true,
        disadvantage: options.disadvantage === true,
        bonus: toNumber(options.bonus, 0),
        targetAc: Number.isFinite(Number(options.targetAc)) ? Number(options.targetAc) : null,
        baseAc: Number.isFinite(Number(options.baseAc)) ? Number(options.baseAc) : null,
        applyDamage: options.applyDamage === true,
        createMessage: options.createMessage !== false,
        flavor: cleanText(options.flavor)
      }));
    }
    catch {
      return {};
    }
  }

  async #resolveQueuedAttackReaction(kind, reactor, target, values = {}, options = {}) {
    const queue = this.moduleApi?.reactionQueueService;
    if (typeof queue?.resolve !== "function") {
      return {
        success: false,
        reason: "reactionQueueUnavailable",
        actorId: reactor?.id ?? null,
        targetId: target?.id ?? null
      };
    }
    const triggerId = cleanText(options.triggerId)
      || `${kind}:${cleanText(reactor?.id)}:${Date.now()}:${++this._reactionTriggerSequence}`;
    const context = {
      triggerId,
      reactorId: cleanText(reactor?.id),
      reactorUuid: cleanText(reactor?.uuid),
      targetId: cleanText(target?.id),
      targetUuid: cleanText(target?.uuid),
      incomingAttackTotal: values.incomingAttackTotal,
      incomingDamage: values.incomingDamage,
      options: this.#serializableReactionOptions(options),
      triggerActive: true
    };
    const state = {
      reactor,
      reactors: [reactor],
      target,
      incomingAttackTotal: toNumber(values.incomingAttackTotal, NaN),
      incomingDamage: Math.max(0, Math.floor(toNumber(values.incomingDamage, 0))),
      options,
      triggerActive: true,
      serializedContext: context
    };
    this._reactionTriggerContexts.set(triggerId, state);
    try {
      const result = await queue.resolve({ triggerId, kind, context });
      const accepted = collectionValues(result?.accepted).at(-1);
      const effect = accepted?.transaction?.effect ?? accepted?.effect;
      if (!effect || effect.applied === false) {
        return {
          success: false,
          reason: cleanText(result?.status, "declined"),
          actorId: reactor?.id ?? null,
          targetId: target?.id ?? null
        };
      }
      return {
        ...effect,
        reaction: accepted?.transaction?.reaction ?? { consumed: true }
      };
    }
    finally {
      this._reactionTriggerContexts.delete(triggerId);
    }
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
    if (this.moduleApi?.craftsmanGadgetService?.suppressesProvokedAttack?.(target)) {
      return { success: false, reason: "movementDoesNotProvoke" };
    }
    return this.#resolveQueuedAttackReaction(PROVOKED_ATTACK_REACTION_KIND, reactor, target, {}, options);
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

    return this.#resolveQueuedAttackReaction(
      PARRY_REACTION_KIND,
      defender,
      null,
      { incomingAttackTotal: attackTotal },
      options
    );
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

    return this.#resolveQueuedAttackReaction(
      INTERCEPTION_REACTION_KIND,
      guardian,
      target,
      { incomingDamage },
      options
    );
  }
}
