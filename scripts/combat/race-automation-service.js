import { MODULE_ID } from "../constants.js";
import {
  buildGiantTribeAdvancement,
  createAutomationActivity
} from "../data/races-compendium.js?v=1.4.110-giant-tribe-cache-fixes-2";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const SOCKET_EVENT_RACE_AUTOMATION = "race-automation";

const EFFECT_MODE_ADD = 2;
const EFFECT_MODE_UPGRADE = 4;
const EFFECT_MODE_OVERRIDE = 5;

const RACE_AUTOMATION_FLAG = "automation";
const RACE_ACTIVITY_RUNTIME_FLAG = "runtime";
const GIANT_TRIBE_ITEM_NAME = "Великанье племя";
const GIANT_TRIBE_RACE_ID = "полувеликаны";
const GIANT_TRIBE_ABILITY_ID = "полувеликаны-ability-3";
const GIANT_TRIBE_VALUES = new Set(["hill", "stone", "frost", "fire", "cloud", "storm"]);
const GIANT_TRIBE_LABELS = {
  hill: "Холмовой великан",
  stone: "Каменный великан",
  frost: "Ледяной великан",
  fire: "Огненный великан",
  cloud: "Облачный великан",
  storm: "Штормовой великан"
};

const DAMAGE_REDUCTION_FLAG = `flags.${MODULE_ID}.raceAutomation`;
const RACE_ABILITY_KEYS = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const RACE_ABILITY_LABELS = {
  str: "Сила",
  dex: "Ловкость",
  con: "Телосложение",
  int: "Интеллект",
  wis: "Мудрость",
  cha: "Харизма"
};

const SIZE_ORDER = {
  tiny: 0,
  sm: 1,
  med: 2,
  lg: 3,
  huge: 4,
  grg: 5
};

function getSocketUser(senderId) {
  const safeSenderId = cleanText(senderId);
  if (!safeSenderId) {
    return null;
  }

  return game.users?.get?.(safeSenderId)
    ?? game.users?.contents?.find?.((user) => user?.id === safeSenderId)
    ?? null;
}

function canProcessRaceAutomationSocket(senderId) {
  if (!game.user?.isGM) {
    return false;
  }

  const sender = getSocketUser(senderId);
  return sender?.isGM === true;
}

function getDialogRoot(html) {
  if (html instanceof HTMLElement) {
    return html;
  }

  if (html?.[0] instanceof HTMLElement) {
    return html[0];
  }

  return null;
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getProperty(source, path, fallback = undefined) {
  const value = foundry.utils.getProperty(source, path);
  return value === undefined ? fallback : value;
}

function setProperty(source, path, value) {
  foundry.utils.setProperty(source, path, value);
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(cleanText(value));
}

function actorProficiency(actor) {
  return toNumber(actor?.system?.attributes?.prof, 0);
}

function actorLevel(actor) {
  const classes = Object.values(actor?.system?.classes ?? {});
  const classLevels = classes.reduce((sum, cls) => sum + toNumber(cls?.levels, 0), 0);
  return Math.max(1, toNumber(actor?.system?.details?.level, classLevels || 1));
}

function featureAutomation(item) {
  return item?.getFlag?.(MODULE_ID, RACE_AUTOMATION_FLAG) ?? null;
}

function activityRuntime(activity) {
  return activity?.getFlag?.(MODULE_ID, RACE_ACTIVITY_RUNTIME_FLAG)
    ?? activity?.flags?.[MODULE_ID]?.[RACE_ACTIVITY_RUNTIME_FLAG]
    ?? getProperty(activity, `flags.${MODULE_ID}.${RACE_ACTIVITY_RUNTIME_FLAG}`, null);
}

function isRaceFeatureItem(item) {
  const automation = featureAutomation(item);
  return item?.type === "feat" && automation && typeof automation === "object";
}

function hasMechanic(item, mechanic) {
  const mechanics = featureAutomation(item)?.mechanics ?? [];
  return Array.isArray(mechanics) && mechanics.includes(mechanic);
}

function createFormulaRoll(formula, actor) {
  return new Roll(cleanText(formula) || "0", actor?.getRollData?.() ?? {});
}

function extractD20(rolls) {
  const roll = Array.isArray(rolls) ? rolls[0] : rolls;
  const die = roll?.dice?.find((entry) => Number(entry.faces) === 20);
  const active = die?.results?.find((result) => result.active !== false);
  return {
    roll,
    result: Number(active?.result ?? NaN)
  };
}

function isRangedWeaponItem(item) {
  if (!item || item.type !== "weapon") {
    return false;
  }

  const actionType = cleanText(item.system?.actionType);
  if (["rwak", "rsak"].includes(actionType)) {
    return true;
  }

  const type = cleanText(item.system?.type?.value).toLowerCase();
  const classification = cleanText(item.system?.type?.subtype).toLowerCase();
  return type.includes("ranged") || type.includes("firearm") || classification.includes("firearm");
}

function damageTypesFromOptions(options = {}) {
  const types = new Set();
  const addType = (value) => {
    const text = cleanText(value).toLowerCase();
    if (text) {
      types.add(text);
    }
  };

  addType(options.type);
  addType(options.damageType);
  addType(options.midi?.damageType);

  for (const part of options.damage ?? []) {
    addType(part?.type);
    for (const type of part?.types ?? []) {
      addType(type);
    }
  }

  for (const detail of options.midi?.damageDetail ?? []) {
    addType(detail?.type);
    for (const type of detail?.types ?? []) {
      addType(type);
    }
  }

  return types;
}

function resolveUuidSync(uuid) {
  if (!uuid) {
    return null;
  }

  try {
    return fromUuidSync(uuid);
  }
  catch (error) {
    return null;
  }
}

function resolveActorFromTarget(target) {
  if (target instanceof Actor) {
    return target;
  }

  return target?.actor ?? target?.document?.actor ?? null;
}

function resolveTokenFromActor(actor) {
  return actor?.getActiveTokens?.(true, true)?.[0] ?? actor?.getActiveTokens?.()[0] ?? null;
}

function normalizeCollection(collection) {
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

function isCurrentUserHook(userId) {
  const currentUserId = cleanText(globalThis.game?.user?.id);
  const hookUserId = cleanText(userId);
  return !hookUserId || !currentUserId || hookUserId === currentUserId;
}

function actorOwnerLevel() {
  return Number(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
}

function userOwnsActor(actor, user) {
  if (!actor || !user?.id) {
    return false;
  }
  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER") === true;
  }
  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[user.id] ?? ownership.default ?? 0) >= actorOwnerLevel();
}

function hasActivePlayerOwner(actor) {
  return normalizeCollection(globalThis.game?.users)
    .some((user) => user?.isGM !== true && user?.active !== false && userOwnsActor(actor, user));
}

function canConfigureOwnedRaceActor(actor) {
  const currentUser = globalThis.game?.user;
  if (!currentUser) {
    return actor?.isOwner === true;
  }
  if (currentUser.isGM === true) {
    return !hasActivePlayerOwner(actor);
  }
  return actor?.isOwner === true || userOwnsActor(actor, currentUser);
}

function actorFromOwnedItem(item) {
  return item?.parent ?? item?.actor ?? null;
}

function abilityPenaltyChoice(item) {
  const raw = item?.getFlag?.(MODULE_ID, "abilityPenaltyChoice")
    ?? getProperty(item, `flags.${MODULE_ID}.abilityPenaltyChoice`, null);
  const amount = Math.max(0, Math.floor(toNumber(raw?.amount, 0)));
  const allowed = Array.from(new Set((Array.isArray(raw?.allowed) ? raw.allowed : [])
    .map((ability) => cleanText(ability).toLowerCase())
    .filter((ability) => RACE_ABILITY_KEYS.has(ability))));
  return amount > 0 && allowed.length > 0 ? { amount, allowed } : null;
}

function savedAbilityPenalty(item) {
  return item?.getFlag?.(MODULE_ID, "abilityPenalty")
    ?? getProperty(item, `flags.${MODULE_ID}.abilityPenalty`, null);
}

function isOwnedRacePenaltyItem(item) {
  const actor = actorFromOwnedItem(item);
  return Boolean(
    item
    && !item.pack
    && item.type === "race"
    && actor?.type === "character"
    && abilityPenaltyChoice(item)
  );
}

function isOwnedHalfGiantRace(item) {
  const actor = actorFromOwnedItem(item);
  const flags = item?.flags?.[MODULE_ID] ?? {};
  return Boolean(
    item
    && !item.pack
    && item.type === "race"
    && actor?.type === "character"
    && flags.sourceType === "race"
    && flags.raceId === GIANT_TRIBE_RACE_ID
  );
}

function racePenaltyUpdateOptions() {
  return { [MODULE_ID]: { skipRaceItemConfiguration: true } };
}

function managedRacePenaltyEffects(item) {
  return normalizeCollection(item?.effects).filter((effect) => (
    effect?.flags?.[MODULE_ID]?.raceAbilityPenalty?.managed === true
  ));
}

function buildRaceAbilityPenaltyEffect(ability, amount) {
  const label = RACE_ABILITY_LABELS[ability] ?? ability;
  return {
    name: `Расовый штраф: ${label} -${amount}`,
    type: "base",
    img: "icons/svg/downgrade.svg",
    disabled: false,
    transfer: true,
    changes: [{
      key: `system.abilities.${ability}.value`,
      mode: EFFECT_MODE_ADD,
      value: String(-amount),
      priority: 20
    }],
    flags: {
      [MODULE_ID]: {
        raceAbilityPenalty: { managed: true, ability, amount }
      }
    }
  };
}

function racePenaltyEffectMatches(effect, desired) {
  const normalized = (entry) => ({
    name: cleanText(entry?.name),
    type: cleanText(entry?.type, "base"),
    img: cleanText(entry?.img),
    disabled: entry?.disabled === true,
    transfer: entry?.transfer === true,
    changes: normalizeCollection(entry?.changes).map((change) => ({
      key: cleanText(change?.key),
      mode: Number(change?.mode ?? 0),
      value: cleanText(change?.value),
      priority: Number(change?.priority ?? 0)
    })),
    managed: entry?.flags?.[MODULE_ID]?.raceAbilityPenalty ?? null
  });
  return JSON.stringify(normalized(effect)) === JSON.stringify(normalized(desired));
}

function giantTribeFlag(item) {
  return item?.getFlag?.(MODULE_ID, "raceAutomation")?.giantTribe
    ?? getProperty(item, `flags.${MODULE_ID}.raceAutomation.giantTribe`, null);
}

export function isGiantTribeFeature(item) {
  const flags = item?.flags?.[MODULE_ID] ?? {};
  return Boolean(
    item
    && item.type === "feat"
    && flags.sourceType === "raceFeature"
    && flags.raceId === GIANT_TRIBE_RACE_ID
    && (
      flags.abilityId === GIANT_TRIBE_ABILITY_ID
      || flags.featureId === `${GIANT_TRIBE_RACE_ID}::${GIANT_TRIBE_ABILITY_ID}`
    )
  );
}

function isOwnedGiantTribeItem(item) {
  const actor = actorFromOwnedItem(item);
  return Boolean(isGiantTribeFeature(item) && !item.pack && actor?.type === "character");
}

function giantTribeEffect(name, tribe, changes) {
  return {
    name,
    type: "base",
    img: "icons/svg/aura.svg",
    disabled: false,
    transfer: true,
    changes: changes.map((change) => ({ ...change, priority: 20 })),
    flags: {
      [MODULE_ID]: {
        giantTribe: { managed: true, tribe }
      }
    }
  };
}

function giantTribeActivity(spec, index, tribe) {
  const activity = createAutomationActivity({
    featureId: `${GIANT_TRIBE_RACE_ID}::${GIANT_TRIBE_ABILITY_ID}::configured`,
    name: GIANT_TRIBE_ITEM_NAME
  }, spec, index, []);
  activity.flags[MODULE_ID].giantTribe = { managed: true, tribe };
  return activity;
}

export function buildGiantTribeConfiguration(value) {
  const tribe = cleanText(value).toLowerCase();
  if (!GIANT_TRIBE_VALUES.has(tribe)) {
    return null;
  }

  const effects = [];
  if (tribe === "hill") {
    effects.push(giantTribeEffect("Холмовой великан: Выживание", tribe, [{
      key: "system.skills.sur.roll.mode",
      mode: EFFECT_MODE_ADD,
      value: "1"
    }]));
  }
  else if (tribe === "frost") {
    effects.push(giantTribeEffect("Ледяной великан: сопротивление холоду", tribe, [{
      key: "system.traits.dr.value",
      mode: EFFECT_MODE_ADD,
      value: "cold"
    }]));
  }
  else if (tribe === "fire") {
    effects.push(giantTribeEffect("Огненный великан: инструменты кузнеца", tribe, [{
      key: "system.tools.smith.value",
      mode: EFFECT_MODE_UPGRADE,
      value: "1"
    }]));
  }
  else if (tribe === "cloud") {
    effects.push(
      giantTribeEffect("Облачный великан: Обман", tribe, [{
        key: "system.skills.dec.bonuses.check",
        mode: EFFECT_MODE_ADD,
        value: "2"
      }]),
      giantTribeEffect("Облачный великан: Убеждение", tribe, [{
        key: "system.skills.per.bonuses.check",
        mode: EFFECT_MODE_ADD,
        value: "2"
      }])
    );
  }

  const activities = [];

  if (tribe === "storm") {
    activities.push(giantTribeActivity({
      type: "damage",
      name: "Штормовой великан: касание",
      activation: "special",
      condition: "Цель поддерживает с вами прямой контакт.",
      range: null,
      rangeUnits: "touch",
      targetType: "creature",
      targetCount: "1",
      prompt: true,
      damage: {
        formula: "1d4",
        types: ["lightning"]
      },
      note: "Цель при прямом контакте получает 1к4 урона электричеством."
    }, 0, tribe));
  }

  return {
    tribe,
    label: GIANT_TRIBE_LABELS[tribe],
    effects,
    activities
  };
}

function effectComparable(effect) {
  return {
    name: cleanText(effect?.name),
    type: cleanText(effect?.type, "base"),
    img: cleanText(effect?.img),
    disabled: effect?.disabled === true,
    transfer: effect?.transfer === true,
    changes: normalizeCollection(effect?.changes).map((change) => ({
      key: cleanText(change?.key),
      mode: Number(change?.mode ?? 0),
      value: cleanText(change?.value),
      priority: Number(change?.priority ?? 0)
    })),
    giantTribe: effect?.flags?.[MODULE_ID]?.giantTribe ?? null
  };
}

function activityData(activity) {
  if (typeof activity?.toObject === "function") {
    return activity.toObject();
  }
  return foundry.utils.deepClone(activity);
}

function ownedItemActivities(item) {
  const activities = item?.system?.activities;
  if (!activities) {
    return [];
  }
  if (Array.isArray(activities)) {
    return activities;
  }
  if (Array.isArray(activities.contents)) {
    return activities.contents;
  }
  if (typeof activities.values === "function") {
    return Array.from(activities.values());
  }
  return Object.values(activities);
}

function isManagedGiantTribeEffect(effect) {
  const flags = effect?.flags?.[MODULE_ID] ?? {};
  return flags.giantTribe?.managed === true || flags.automation === "race-feature-effect";
}

function isManagedGiantTribeActivity(activity) {
  const flags = activity?.flags?.[MODULE_ID] ?? {};
  const runtimeAction = cleanText(flags.runtime?.action);
  return flags.giantTribe?.managed === true
    || flags.automation === "race-feature-activity"
    || runtimeAction === "chooseGiantTribe"
    || (runtimeAction === "promptCustomEffect" && cleanText(activity?.name) === "Применить остаток механики")
    || cleanText(activity?.name) === "Штормовой великан: касание";
}

export function configureGiantTribeItemData(itemData, value) {
  const configuration = buildGiantTribeConfiguration(value);
  if (!configuration) {
    throw new Error("Не выбрано допустимое великанье племя.");
  }

  const source = typeof itemData?.toObject === "function"
    ? itemData.toObject()
    : foundry.utils.deepClone(itemData);
  if (!isGiantTribeFeature(source)) {
    throw new Error("Не найдена черта «Великанье племя».");
  }

  const preservedEffects = normalizeCollection(source.effects)
    .filter((effect) => !isManagedGiantTribeEffect(effect));
  const preservedActivities = ownedItemActivities(source)
    .filter((activity) => !isManagedGiantTribeActivity(activity));
  const activities = [...preservedActivities, ...foundry.utils.deepClone(configuration.activities)];

  source.name = `${GIANT_TRIBE_ITEM_NAME} (${configuration.label})`;
  setProperty(source, `flags.${MODULE_ID}.raceAutomation.giantTribe`, configuration.tribe);
  source.effects = [
    ...foundry.utils.deepClone(preservedEffects),
    ...foundry.utils.deepClone(configuration.effects)
  ];
  source.system ??= {};
  source.system.activities = Object.fromEntries(activities.map((activity, index) => {
    const id = cleanText(activity?._id ?? activity?.id, `giant-tribe-activity-${index}`);
    return [id, activity];
  }));
  return source;
}

export function clearGiantTribeItemData(itemData) {
  const source = typeof itemData?.toObject === "function"
    ? itemData.toObject()
    : foundry.utils.deepClone(itemData);
  if (!isGiantTribeFeature(source)) {
    throw new Error("Не найдена черта «Великанье племя».");
  }

  const configuredNames = new Set(Object.values(GIANT_TRIBE_LABELS)
    .map((label) => `${GIANT_TRIBE_ITEM_NAME} (${label})`));
  if (configuredNames.has(cleanText(source.name))) source.name = GIANT_TRIBE_ITEM_NAME;

  const raceAutomation = source.flags?.[MODULE_ID]?.raceAutomation;
  if (raceAutomation && typeof raceAutomation === "object") {
    delete raceAutomation.giantTribe;
  }
  source.effects = foundry.utils.deepClone(
    normalizeCollection(source.effects).filter((effect) => !isManagedGiantTribeEffect(effect))
  );
  source.system ??= {};
  source.system.activities = Object.fromEntries(
    ownedItemActivities(source)
      .filter((activity) => !isManagedGiantTribeActivity(activity))
      .map((activity, index) => {
        const id = cleanText(activity?._id ?? activity?.id, `giant-tribe-activity-${index}`);
        return [id, foundry.utils.deepClone(activity)];
      })
  );
  return source;
}

function resolveTokenFromTarget(target) {
  if (!target) {
    return null;
  }

  if (target instanceof Actor) {
    return resolveTokenFromActor(target);
  }

  return target.object
    ?? target.document?.object
    ?? target.token
    ?? (target.actor || target.document?.actor ? target : null)
    ?? resolveTokenFromActor(resolveActorFromTarget(target));
}

function resolveSourceTokenFromWorkflow(workflow, actor) {
  return workflow?.token?.object
    ?? workflow?.token
    ?? workflow?.tokenDocument?.object
    ?? workflow?.tokenDocument
    ?? resolveTokenFromActor(actor);
}

function speakerForActor(actor) {
  return ChatMessage.getSpeaker({ actor });
}

function targetListFromWorkflow(workflow) {
  const targets = Array.from(workflow?.hitTargets ?? workflow?.targets ?? []);
  if (targets.length) {
    return targets;
  }

  return Array.from(game.user?.targets ?? []);
}

function defaultDamageTypeFromWorkflow(workflow, fallback = "") {
  const parts = workflow?.damageDetail ?? workflow?.damageRolls?.flatMap((roll) => roll?.terms ?? []) ?? [];
  for (const part of parts) {
    const type = cleanText(part?.options?.flavor ?? part?.options?.type).toLowerCase();
    if (type) {
      return type;
    }
  }

  return fallback;
}

function isActorLarger(targetActor, sourceActor) {
  const targetSize = SIZE_ORDER[targetActor?.system?.traits?.size] ?? 2;
  const sourceSize = SIZE_ORDER[sourceActor?.system?.traits?.size] ?? 2;
  return targetSize > sourceSize;
}

function isTargetUnactedThisCombat(target) {
  const combat = game.combat;
  const tokenId = target?.id ?? target?.document?.id;
  if (!combat || !tokenId) {
    return true;
  }

  const combatant = combat.combatants.find((entry) => entry.tokenId === tokenId || entry.token?.id === tokenId);
  if (!combatant) {
    return true;
  }

  const currentIndex = combat.turn ?? 0;
  const targetIndex = combat.turns.findIndex((entry) => entry.id === combatant.id);
  return combat.round <= 1 && (targetIndex < 0 || targetIndex > currentIndex);
}

function tokenDistanceFeet(left, right) {
  if (!left || !right) {
    return Infinity;
  }

  try {
    if (canvas?.grid?.measureDistance) {
      return canvas.grid.measureDistance(left, right);
    }
  }
  catch (error) {
    // Fallback below.
  }

  const size = canvas?.dimensions?.size || 100;
  const distance = canvas?.dimensions?.distance || 5;
  const dx = (left.center?.x ?? left.x ?? 0) - (right.center?.x ?? right.x ?? 0);
  const dy = (left.center?.y ?? left.y ?? 0) - (right.center?.y ?? right.y ?? 0);
  return (Math.hypot(dx, dy) / size) * distance;
}

function tokenDisposition(token) {
  return token?.document?.disposition ?? token?.disposition ?? 0;
}

function isHostile(left, right) {
  const leftDisposition = tokenDisposition(left);
  const rightDisposition = tokenDisposition(right);
  if (!leftDisposition || !rightDisposition) {
    return false;
  }

  return leftDisposition !== rightDisposition;
}

function isHealingWorkflow(workflow) {
  const typeHints = [
    workflow?.activity?.type,
    workflow?.activity?.actionType,
    workflow?.activity?.system?.actionType,
    workflow?.item?.system?.actionType,
    workflow?.damageType,
    workflow?.defaultDamageType
  ].map((entry) => cleanText(entry).toLowerCase());
  if (typeHints.some((entry) => entry === "heal" || entry === "healing")) {
    return true;
  }

  const healingRollCount = workflow?.healingRolls?.length ?? workflow?.healingRolls?.size ?? 0;
  if (workflow?.healingRoll || healingRollCount > 0) {
    return true;
  }

  const detailRows = [
    ...(Array.isArray(workflow?.damageDetail) ? workflow.damageDetail : []),
    ...(Array.isArray(workflow?.damageList) ? workflow.damageList : [])
  ];
  return detailRows.some((row) => {
    const type = cleanText(row?.type ?? row?.damageType).toLowerCase();
    if (type === "healing") {
      return true;
    }

    const types = Array.isArray(row?.types) ? row.types : [row?.types];
    return types.some((entry) => cleanText(entry).toLowerCase() === "healing");
  });
}

function activeEffectData(name, changes = [], options = {}) {
  const statusId = cleanText(options.statusId);
  const flags = {
    [MODULE_ID]: {
      managed: true,
      automation: "race-runtime-effect",
      source: cleanText(options.source)
    }
  };

  if (statusId) {
    flags.core = { statusId };
  }

  if (options.specialDuration) {
    flags.dae = {
      specialDuration: Array.isArray(options.specialDuration) ? options.specialDuration : [options.specialDuration]
    };
  }

  return {
    name,
    type: "base",
    img: cleanText(options.img, "icons/svg/aura.svg"),
    origin: cleanText(options.origin),
    disabled: false,
    duration: {
      seconds: options.seconds ?? null,
      rounds: options.rounds ?? null,
      turns: options.turns ?? null,
      startRound: null,
      startTurn: null,
      combat: null,
      startTime: null
    },
    transfer: options.transfer === true,
    statuses: statusId ? [statusId] : [],
    changes,
    flags,
    description: cleanText(options.description)
  };
}

export class RaceAutomationService {
  constructor(moduleApi, { promptChoice = null } = {}) {
    this.moduleApi = moduleApi;
    this._promptChoice = typeof promptChoice === "function" ? promptChoice : null;
    this._turnDamageKeys = new Set();
    this._pendingItemConfigurations = new Set();
  }

  async initialize() {
    return true;
  }

  async handleCreatedItem(item, options = {}, userId = "") {
    if (
      !isCurrentUserHook(userId)
      || options?.[MODULE_ID]?.skipRaceItemConfiguration === true
    ) {
      return false;
    }
    if (isOwnedRacePenaltyItem(item)) {
      return this.#configureRaceAbilityPenalty(item);
    }
    if (isOwnedGiantTribeItem(item)) {
      return false;
    }
    return false;
  }

  async repairActor(actor) {
    if (actor?.type !== "character" || !canConfigureOwnedRaceActor(actor)) {
      return false;
    }
    let changed = false;
    const items = normalizeCollection(actor.items);
    const giantTribeFeature = items.find(isOwnedGiantTribeItem);
    for (const item of items) {
      if (isOwnedRacePenaltyItem(item)) {
        changed = (await this.#configureRaceAbilityPenalty(item)) || changed;
      }
      if (isOwnedHalfGiantRace(item)) {
        changed = (await this.#ensureGiantTribeAdvancement(item, giantTribeFeature)) || changed;
      }
      else if (isOwnedGiantTribeItem(item)) {
        changed = (await this.#configureGiantTribe(item)) || changed;
      }
    }
    return changed;
  }

  async #ensureGiantTribeAdvancement(race, feature) {
    const source = typeof race?.toObject === "function" ? race.toObject() : race;
    const advancements = foundry.utils.deepClone(
      Array.isArray(source?.system?.advancement) ? source.system.advancement : []
    );
    const index = advancements.findIndex((advancement) => advancement?.type === "GiantTribe");
    const tribe = cleanText(giantTribeFlag(feature)).toLowerCase();
    const savedTribe = GIANT_TRIBE_VALUES.has(tribe) ? tribe : "";
    let changed = false;

    if (index < 0) {
      const advancement = buildGiantTribeAdvancement({ id: GIANT_TRIBE_RACE_ID });
      if (savedTribe) advancement.value = { size: savedTribe };
      advancements.push(advancement);
      changed = true;
    }
    else if (savedTribe && cleanText(advancements[index]?.value?.size).toLowerCase() !== savedTribe) {
      advancements[index].value = { ...(advancements[index].value ?? {}), size: savedTribe };
      changed = true;
    }

    if (changed) {
      await race.update({ "system.advancement": advancements }, racePenaltyUpdateOptions());
    }
    return changed;
  }

  async #configureRaceAbilityPenalty(item) {
    const actor = actorFromOwnedItem(item);
    if (!isOwnedRacePenaltyItem(item) || !canConfigureOwnedRaceActor(actor)) {
      return false;
    }

    const itemKey = cleanText(item.uuid ?? item.id ?? item._id);
    if (!itemKey || this._pendingItemConfigurations.has(itemKey)) {
      return false;
    }
    this._pendingItemConfigurations.add(itemKey);

    try {
      const choiceConfig = abilityPenaltyChoice(item);
      let saved = savedAbilityPenalty(item);
      const savedAbility = cleanText(saved?.ability).toLowerCase();
      const savedAmount = Math.max(0, Math.floor(toNumber(saved?.amount, 0)));
      let changed = false;

      if (!choiceConfig.allowed.includes(savedAbility) || savedAmount !== choiceConfig.amount) {
        if (saved) {
          await item.update({ [`flags.${MODULE_ID}.abilityPenalty`]: null }, racePenaltyUpdateOptions());
          changed = true;
        }
        changed = (await this.#syncRacePenaltyEffect(item, null)) || changed;

        const choices = choiceConfig.allowed.map((ability) => ({
          value: ability,
          label: cleanText(
            globalThis.CONFIG?.DND5E?.abilities?.[ability]?.label
              ?? globalThis.CONFIG?.DND5E?.abilities?.[ability],
            RACE_ABILITY_LABELS[ability] ?? ability
          )
        }));
        const ability = cleanText(
          this._promptChoice
            ? await this._promptChoice({ actor, item, title: "Выберите расовый штраф", choices })
            : await this.#choice(actor, "Выберите расовый штраф", choices)
        ).toLowerCase();
        if (!choiceConfig.allowed.includes(ability)) {
          return changed;
        }

        saved = { ability, amount: choiceConfig.amount };
        await item.update({ [`flags.${MODULE_ID}.abilityPenalty`]: saved }, racePenaltyUpdateOptions());
        changed = true;
      }

      return (await this.#syncRacePenaltyEffect(item, saved)) || changed;
    }
    finally {
      this._pendingItemConfigurations.delete(itemKey);
    }
  }

  async #syncRacePenaltyEffect(item, selected) {
    const managed = managedRacePenaltyEffects(item);
    const ability = cleanText(selected?.ability).toLowerCase();
    const amount = Math.max(0, Math.floor(toNumber(selected?.amount, 0)));
    const desired = RACE_ABILITY_KEYS.has(ability) && amount > 0
      ? buildRaceAbilityPenaltyEffect(ability, amount)
      : null;
    const options = racePenaltyUpdateOptions();

    if (!desired) {
      const ids = managed.map((effect) => effect.id ?? effect._id).filter(Boolean);
      if (ids.length > 0) {
        await item.deleteEmbeddedDocuments("ActiveEffect", ids, options);
      }
      return ids.length > 0;
    }

    const [primary, ...duplicates] = managed;
    let changed = false;
    if (!primary) {
      await item.createEmbeddedDocuments("ActiveEffect", [desired], options);
      changed = true;
    }
    else if (!racePenaltyEffectMatches(primary, desired)) {
      await item.updateEmbeddedDocuments("ActiveEffect", [{
        _id: primary.id ?? primary._id,
        ...desired
      }], options);
      changed = true;
    }

    const duplicateIds = duplicates.map((effect) => effect.id ?? effect._id).filter(Boolean);
    if (duplicateIds.length > 0) {
      await item.deleteEmbeddedDocuments("ActiveEffect", duplicateIds, options);
      changed = true;
    }
    return changed;
  }

  async #configureGiantTribe(item) {
    const actor = actorFromOwnedItem(item);
    if (!isOwnedGiantTribeItem(item) || !canConfigureOwnedRaceActor(actor)) {
      return false;
    }

    const itemKey = cleanText(item.uuid ?? item.id ?? item._id);
    if (!itemKey || this._pendingItemConfigurations.has(itemKey)) {
      return false;
    }
    this._pendingItemConfigurations.add(itemKey);

    try {
      const tribe = cleanText(giantTribeFlag(item)).toLowerCase();
      if (!GIANT_TRIBE_VALUES.has(tribe)) {
        let changed = false;
        changed = (await this.#syncGiantTribeEffects(item, { effects: [] })) || changed;
        changed = (await this.#syncGiantTribeActivities(item, { activities: [] })) || changed;
        return changed;
      }

      const configuration = buildGiantTribeConfiguration(tribe);
      let changed = false;
      changed = (await this.#syncGiantTribeEffects(item, configuration)) || changed;
      changed = (await this.#syncGiantTribeActivities(item, configuration)) || changed;

      const desiredName = `${GIANT_TRIBE_ITEM_NAME} (${configuration.label})`;
      if (cleanText(item.name) !== desiredName || cleanText(giantTribeFlag(item)).toLowerCase() !== tribe) {
        await item.update({
          name: desiredName,
          [`flags.${MODULE_ID}.raceAutomation.giantTribe`]: tribe
        }, racePenaltyUpdateOptions());
        changed = true;
      }
      return changed;
    }
    finally {
      this._pendingItemConfigurations.delete(itemKey);
    }
  }

  async #syncGiantTribeEffects(item, configuration) {
    const managed = normalizeCollection(item?.effects).filter(isManagedGiantTribeEffect);
    const desired = configuration.effects;
    const matches = managed.length === desired.length
      && managed.every((effect, index) => (
        JSON.stringify(effectComparable(effect)) === JSON.stringify(effectComparable(desired[index]))
      ));
    if (matches) {
      return false;
    }

    const ids = managed.map((effect) => effect.id ?? effect._id).filter(Boolean);
    if (ids.length > 0) {
      await item.deleteEmbeddedDocuments("ActiveEffect", ids, racePenaltyUpdateOptions());
    }
    if (desired.length > 0) {
      await item.createEmbeddedDocuments(
        "ActiveEffect",
        foundry.utils.deepClone(desired),
        racePenaltyUpdateOptions()
      );
    }
    return ids.length > 0 || desired.length > 0;
  }

  async #syncGiantTribeActivities(item, configuration) {
    const current = ownedItemActivities(item);
    const managed = current.filter(isManagedGiantTribeActivity).map(activityData);
    const desired = configuration.activities;
    if (JSON.stringify(managed) === JSON.stringify(desired)) {
      return false;
    }

    const removalPatch = {};
    for (const activity of current.filter(isManagedGiantTribeActivity)) {
      const id = cleanText(activity?._id ?? activity?.id);
      if (id) {
        removalPatch[`system.activities.-=${id}`] = null;
      }
    }
    if (Object.keys(removalPatch).length > 0) {
      await item.update(removalPatch, racePenaltyUpdateOptions());
    }

    const creationPatch = {};
    for (const activity of desired) {
      const id = cleanText(activity?._id ?? activity?.id);
      if (id) {
        creationPatch[`system.activities.${id}`] = activity;
      }
    }
    if (Object.keys(creationPatch).length > 0) {
      await item.update(creationPatch, racePenaltyUpdateOptions());
    }
    return true;
  }

  async handleSocketMessage(payload = {}, { senderId = "" } = {}) {
    if (!canProcessRaceAutomationSocket(senderId)) {
      return false;
    }

    const action = cleanText(payload.action);
    if (action === "applyTargetDamage") {
      const actor = resolveUuidSync(payload.actorUuid);
      const sourceActor = resolveUuidSync(payload.sourceActorUuid);
      await this.#applyDamage(actor, payload.formula, payload.damageType, {
        sourceActor,
        sourceItemUuid: payload.sourceItemUuid,
        label: payload.label
      });
      return true;
    }

    if (action === "createActorEffect") {
      const actor = resolveUuidSync(payload.actorUuid);
      if (actor instanceof Actor && payload.effect) {
        await this.#createEffect(actor, payload.effect);
      }
      return true;
    }

    if (action === "healActor") {
      const actor = resolveUuidSync(payload.actorUuid);
      await this.#healActor(actor, payload.formula, { label: payload.label });
      return true;
    }

    return false;
  }

  applyDnd5eAttackRollConfig(rollConfig, dialogConfig, messageConfig) {
    const activity = rollConfig?.subject;
    const actor = activity?.actor ?? activity?.item?.actor ?? rollConfig?.actor;
    if (!(actor instanceof Actor) || !this.#hasMechanic(actor, "conditional-attack-advantage")) {
      return true;
    }

    const target = Array.from(game.user?.targets ?? [])[0];
    if (!target || !this.#targetHasAdjacentAlly(actor, target)) {
      return true;
    }

    for (const roll of rollConfig.rolls ?? [rollConfig]) {
      roll.advantage = true;
      roll.options ??= {};
      roll.options.advantage = true;
    }

    const note = "Тактика стаи: цель имеет союзника атакующего в 5 футах, атака получает преимущество.";
    messageConfig.data ??= {};
    messageConfig.data.flavor = [messageConfig.data.flavor, note].filter(Boolean).join("<br>");
    return true;
  }

  async applyDnd5ePostUseActivity(activity, usageConfig, results) {
    const actor = activity?.actor ?? activity?.item?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const runtime = activityRuntime(activity) ?? {};
    const action = cleanText(runtime.action);

    if (action === "applyItemEffects") {
      await this.#applyLinkedActivityEffects(activity, actor);
      return true;
    }

    if (action === "promptCustomEffect") {
      await this.#promptAndApplyCustomEffect(actor, activity?.item, runtime);
      return true;
    }

    if (action === "chooseElementalAwakening") {
      await this.#chooseElementalAwakening(actor, activity?.item);
      return true;
    }

    if (action === "chooseDemonicSpellcasting") {
      await this.#chooseDemonicSpellcasting(actor, activity?.item);
      return true;
    }

    if (action === "ignoreHostileSpaces") {
      await this.#createEffect(actor, activeEffectData("Ловкие движения", [{
        key: `${DAMAGE_REDUCTION_FLAG}.ignoreHostileMovementBlocks`,
        mode: EFFECT_MODE_OVERRIDE,
        value: "1",
        priority: 20
      }], {
        origin: activity?.item?.uuid,
        rounds: 1,
        specialDuration: "turnEndSource",
        description: "До конца хода вражеские пространства не блокируют перемещение."
      }));
      return true;
    }

    const effectCount = activity?.effects?.size ?? activity?.effects?.length ?? 0;
    if (activity?.item && isRaceFeatureItem(activity.item) && activity.type === "utility" && effectCount) {
      await this.#applyLinkedActivityEffects(activity, actor);
    }

    return true;
  }

  applyDnd5ePreApplyDamage(actor, amount, updates, options = {}) {
    if (!(actor instanceof Actor) || amount <= 0) {
      return true;
    }

    const reduction = this.#damageReduction(actor, amount, options);
    if (reduction <= 0) {
      return true;
    }

    const hp = actor.system?.attributes?.hp;
    if (!hp) {
      return true;
    }

    const finalAmount = Math.max(0, amount - reduction);
    const deltaTemp = finalAmount > 0 ? Math.min(toNumber(hp.temp, 0), finalAmount) : 0;
    const deltaHP = clamp(finalAmount - deltaTemp, -toNumber(hp.damage, 0), toNumber(hp.value, 0));
    updates["system.attributes.hp.temp"] = toNumber(hp.temp, 0) - deltaTemp;
    updates["system.attributes.hp.value"] = toNumber(hp.value, 0) - deltaHP;

    this.#postChat(actor, "Расовое уменьшение урона", `${actor.name}: входящий урон уменьшен на ${reduction}.`);
    return true;
  }

  async applyDnd5eApplyDamage(actor, amount, options = {}) {
    if (!(actor instanceof Actor) || amount <= 0) {
      return true;
    }

    await this.#handleRelentlessEndurance(actor);
    return true;
  }

  async handleSkillRoll(rolls, context) {
    await this.#handleRollAftermath(rolls, context, "skill");
  }

  async handleToolRoll(rolls, context) {
    await this.#handleRollAftermath(rolls, context, "tool");
  }

  async handleAbilityCheckRoll(rolls, context) {
    await this.#handleRollAftermath(rolls, context, "ability");
  }

  async handleSavingThrowRoll(rolls, context) {
    await this.#handleRollAftermath(rolls, context, "save");
  }

  async handleRestCompleted(actor, result, config) {
    if (!(actor instanceof Actor) || result?.type !== "long") {
      return true;
    }

    if (this.#hasMechanic(actor, "proficiency-swap")) {
      await this.#promptSkillProficiencySwap(actor);
    }

    if (this.#hasMechanic(actor, "spell-slot-scaling")) {
      await this.#restoreHighElfSpellSlot(actor);
    }

    return true;
  }

  applyDnd5ePreLongRest(actor, config) {
    if (!(actor instanceof Actor)) {
      return true;
    }

    if (this.#hasMechanic(actor, "rest-rules")) {
      if (this.#hasRuntimeFlag(actor, "tranceRest")) {
        config.duration = Math.min(toNumber(config.duration, 480), 240);
      }
      if (this.#hasRuntimeFlag(actor, "sentryRest")) {
        config.duration = Math.min(toNumber(config.duration, 480), 360);
      }
    }

    return true;
  }

  async applyMidiRollComplete(workflow) {
    const actor = workflow?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const hitTargets = targetListFromWorkflow(workflow);
    if (!hitTargets.length) {
      return true;
    }

    await this.#handleKeenEye(actor, workflow, hitTargets);
    await this.#handleFuryOfTheSmall(actor, workflow, hitTargets);
    await this.#handleSurpriseAttack(actor, workflow, hitTargets);
    await this.#handleCelestialDamage(actor, workflow, hitTargets);
    return true;
  }

  handleMovementBlocking(gridSpace, token, options, found) {
    const actor = token?.actor;
    if (!(actor instanceof Actor)) {
      return;
    }

    if (!this.#hasRuntimeFlag(actor, "ignoreHostileMovementBlocks")) {
      return;
    }

    for (const blocker of Array.from(found ?? [])) {
      if (isHostile(token, blocker)) {
        found.delete(blocker);
      }
    }
  }

  handleCombatTurnChange(combat) {
    const round = combat?.round ?? 0;
    const turn = combat?.turn ?? 0;
    this._turnDamageKeys = new Set(Array.from(this._turnDamageKeys).filter((key) => key.startsWith(`${round}:${turn}:`)));
  }

  async #handleRollAftermath(rolls, context, kind) {
    const actor = context?.subject ?? context?.actor;
    if (!(actor instanceof Actor)) {
      return;
    }

    await this.#maybePostLuckyReroll(actor, rolls, kind);
  }

  async #maybePostLuckyReroll(actor, rolls, kind) {
    if (!this.#hasMechanic(actor, "d20-reroll")) {
      return false;
    }

    const { roll, result } = extractD20(rolls);
    if (result !== 1 || !roll || !this.#canPrompt(actor)) {
      return false;
    }

    const confirmed = await this.#confirm(actor, "Везучий", "На d20 выпала 1. Перебросить по расовой черте?");
    if (!confirmed) {
      return false;
    }

    const modifier = toNumber(roll.total, result) - result;
    const reroll = await new Roll(`1d20 + ${modifier}`, actor.getRollData?.() ?? {}).evaluate();
    await reroll.toMessage({
      speaker: speakerForActor(actor),
      flavor: `Везучий: переброс d20 (${kind})`
    });
    return true;
  }

  async #handleRelentlessEndurance(actor) {
    if (toNumber(actor.system?.attributes?.hp?.value, 0) > 0) {
      return false;
    }

    const feature = this.#findFeature(actor, "zero-hp-recovery");
    if (!feature || !this.#canPrompt(actor)) {
      return false;
    }

    const confirmed = await this.#confirm(
      actor,
      "Непоколебимая стойкость",
      "Персонаж упал до 0 хитов. Использовать расовую черту и восстановить хиты?"
    );
    if (!confirmed) {
      return false;
    }

    const consumed = await this.#consumeFeatureUse(feature);
    if (!consumed) {
      return false;
    }

    const healAmount = Math.max(1, actorLevel(actor) * 2);
    await actor.update({ "system.attributes.hp.value": healAmount });
    await this.#postChat(actor, "Непоколебимая стойкость", `${actor.name} восстанавливает ${healAmount} хитов.`);
    return true;
  }

  async #handleKeenEye(actor, workflow, hitTargets) {
    if (!this.#hasMechanic(actor, "keen-eye-damage")) {
      return false;
    }

    if (!this.#workflowIsRangedAttack(workflow)) {
      return false;
    }

    const key = this.#turnKey(actor, "keen-eye");
    if (this._turnDamageKeys.has(key) || !this.#canPrompt(actor)) {
      return false;
    }

    const feature = this.#findFeature(actor, "keen-eye-damage");
    if (!feature) {
      return false;
    }

    const confirmed = await this.#confirm(actor, "Зоркий глаз", "Добавить расовый урон к попаданию дальнобойной атакой?");
    if (!confirmed || !(await this.#consumeFeatureUse(feature))) {
      return false;
    }

    this._turnDamageKeys.add(key);
    const target = resolveActorFromTarget(hitTargets[0]);
    await this.#applyDamage(target, "@prof", defaultDamageTypeFromWorkflow(workflow), {
      sourceActor: actor,
      sourceItemUuid: feature.uuid,
      label: "Зоркий глаз"
    });
    return true;
  }

  async #handleFuryOfTheSmall(actor, workflow, hitTargets) {
    if (!this.#hasMechanic(actor, "fury-small")) {
      return false;
    }

    if (isHealingWorkflow(workflow)) {
      return false;
    }

    const sourceToken = resolveSourceTokenFromWorkflow(workflow, actor);
    const targetToken = hitTargets.find((entry) => (
      isActorLarger(resolveActorFromTarget(entry), actor)
      && isHostile(sourceToken, resolveTokenFromTarget(entry))
    ));
    const target = resolveActorFromTarget(targetToken);
    if (!(target instanceof Actor)) {
      return false;
    }

    const key = this.#turnKey(actor, "fury-small");
    if (this._turnDamageKeys.has(key) || !this.#canPrompt(actor)) {
      return false;
    }

    const feature = this.#findFeature(actor, "fury-small");
    const confirmed = await this.#confirm(actor, "Ярость мелкого", `Добавить ${actorProficiency(actor) * 2} урона цели большего размера?`);
    if (!confirmed || !(await this.#consumeFeatureUse(feature))) {
      return false;
    }

    this._turnDamageKeys.add(key);
    await this.#applyDamage(target, "2 * @prof", defaultDamageTypeFromWorkflow(workflow), {
      sourceActor: actor,
      sourceItemUuid: feature?.uuid,
      label: "Ярость мелкого"
    });
    return true;
  }

  async #handleSurpriseAttack(actor, workflow, hitTargets) {
    if (!this.#hasMechanic(actor, "surprise-attack")) {
      return false;
    }

    const targetToken = hitTargets.find((entry) => isTargetUnactedThisCombat(entry));
    const target = resolveActorFromTarget(targetToken);
    if (!(target instanceof Actor) || this.#targetHasSurpriseImmunity(target, actor)) {
      return false;
    }

    const key = this.#turnKey(actor, "surprise-attack");
    if (this._turnDamageKeys.has(key) || !this.#canPrompt(actor)) {
      return false;
    }

    const confirmed = await this.#confirm(actor, "Внезапность", "Цель ещё не ходила в этом бою. Добавить 2d6 урона и выдать иммунитет на 1 минуту?");
    if (!confirmed) {
      return false;
    }

    this._turnDamageKeys.add(key);
    await this.#applyDamage(target, "2d6", defaultDamageTypeFromWorkflow(workflow), {
      sourceActor: actor,
      label: "Внезапность"
    });
    await this.#createEffect(target, activeEffectData("Иммунитет к Внезапности", [{
      key: `${DAMAGE_REDUCTION_FLAG}.surpriseAttackImmunity.${actor.id}`,
      mode: EFFECT_MODE_OVERRIDE,
      value: "1",
      priority: 20
    }], {
      seconds: 60,
      description: `Иммунитет к Внезапности от ${actor.name} на 1 минуту.`
    }));
    return true;
  }

  async #handleCelestialDamage(actor, workflow, hitTargets) {
    if (!this.#hasRuntimeFlag(actor, "celestialRevelationDamage")) {
      return false;
    }

    const key = this.#turnKey(actor, "celestial-revelation");
    if (this._turnDamageKeys.has(key) || !this.#canPrompt(actor)) {
      return false;
    }

    const confirmed = await this.#confirm(actor, "Небесное откровение", `Добавить ${actorLevel(actor)} урона излучением к попаданию?`);
    if (!confirmed) {
      return false;
    }

    this._turnDamageKeys.add(key);
    await this.#applyDamage(resolveActorFromTarget(hitTargets[0]), "@details.level", "radiant", {
      sourceActor: actor,
      label: "Небесное откровение"
    });
    return true;
  }

  #damageReduction(actor, amount, options) {
    let reduction = 0;

    if (this.#hasMechanic(actor, "damage-reduction")) {
      reduction += actorProficiency(actor);
    }

    if (this.#hasMechanic(actor, "conditional-damage-reduction") && this.#isStoneSkinDamage(options)) {
      reduction += actorProficiency(actor);
    }

    return Math.min(amount, reduction);
  }

  #isStoneSkinDamage(options = {}) {
    const sourceItem = resolveUuidSync(options.sourceItemUuid ?? options.itemUuid ?? options.midi?.itemUuid);
    const types = damageTypesFromOptions(options);
    const isPhysical = !types.size || types.has("piercing") || types.has("slashing");
    return isPhysical && isRangedWeaponItem(sourceItem);
  }

  #workflowIsRangedAttack(workflow) {
    const item = workflow?.item;
    if (isRangedWeaponItem(item)) {
      return true;
    }

    const actionType = cleanText(workflow?.activity?.actionType ?? workflow?.activity?.system?.actionType);
    return ["rwak", "rsak"].includes(actionType);
  }

  #targetHasAdjacentAlly(actor, target) {
    const targetToken = target?.object ?? target;
    const sourceToken = resolveTokenFromActor(actor);
    if (!sourceToken || !targetToken || !canvas?.tokens?.placeables?.length) {
      return false;
    }

    const sourceDisposition = tokenDisposition(sourceToken);
    return canvas.tokens.placeables.some((token) => {
      if (token === sourceToken || token === targetToken || !token.actor) {
        return false;
      }

      if (tokenDisposition(token) !== sourceDisposition) {
        return false;
      }

      return tokenDistanceFeet(token, targetToken) <= 5;
    });
  }

  #targetHasSurpriseImmunity(target, sourceActor) {
    return Boolean(getProperty(target, `${DAMAGE_REDUCTION_FLAG}.surpriseAttackImmunity.${sourceActor.id}`));
  }

  #turnKey(actor, key) {
    const combat = game.combat;
    return `${combat?.round ?? 0}:${combat?.turn ?? 0}:${actor.id}:${key}`;
  }

  #getRaceFeatures(actor) {
    return Array.from(actor?.items ?? []).filter(isRaceFeatureItem);
  }

  #findFeature(actor, mechanic) {
    return this.#getRaceFeatures(actor).find((item) => hasMechanic(item, mechanic)) ?? null;
  }

  #hasMechanic(actor, mechanic) {
    return Boolean(this.#findFeature(actor, mechanic));
  }

  #hasRuntimeFlag(actor, flag) {
    return Boolean(getProperty(actor, `${DAMAGE_REDUCTION_FLAG}.${flag}`));
  }

  #canPrompt(actor) {
    return Boolean(game.user?.isGM || actor?.isOwner);
  }

  async #confirm(actor, title, content) {
    if (!this.#canPrompt(actor)) {
      return false;
    }

    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (typeof DialogV2?.confirm === "function") {
      return DialogV2.confirm({
        window: { title },
        content: `<p>${escapeHtml(content)}</p>`
      });
    }

    return Dialog.confirm({
      title,
      content: `<p>${escapeHtml(content)}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
  }

  async #choice(actor, title, choices) {
    if (!this.#canPrompt(actor) || !choices.length) {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const options = choices.map((choice) => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`).join("");
      const dialog = new Dialog({
        title,
        content: `
          <form>
            <div class="form-group">
              <label>${escapeHtml(title)}</label>
              <select data-choice>${options}</select>
            </div>
          </form>
        `,
        buttons: {
          confirm: {
            label: "Применить",
            callback: (html) => {
              const root = getDialogRoot(html);
              settled = true;
              resolve(root?.querySelector("[data-choice]")?.value ?? choices[0].value);
            }
          },
          cancel: {
            label: "Отмена",
            callback: () => {
              settled = true;
              resolve(null);
            }
          }
        },
        default: "confirm",
        close: () => {
          if (!settled) {
            resolve(null);
          }
        }
      });
      dialog.render(true);
    });
  }

  async #promptText(actor, title, fields) {
    if (!this.#canPrompt(actor)) {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const content = fields.map((field) => `
        <div class="form-group">
          <label>${escapeHtml(field.label)}</label>
          <input type="text" data-field="${escapeHtml(field.name)}" value="${escapeHtml(field.value ?? "")}">
        </div>
      `).join("");

      const dialog = new Dialog({
        title,
        content: `<form>${content}</form>`,
        buttons: {
          confirm: {
            label: "Применить",
            callback: (html) => {
              const root = getDialogRoot(html);
              const result = {};
              for (const field of fields) {
                result[field.name] = root?.querySelector(`[data-field="${CSS.escape(field.name)}"]`)?.value ?? "";
              }
              settled = true;
              resolve(result);
            }
          },
          cancel: {
            label: "Отмена",
            callback: () => {
              settled = true;
              resolve(null);
            }
          }
        },
        default: "confirm",
        close: () => {
          if (!settled) {
            resolve(null);
          }
        }
      });
      dialog.render(true);
    });
  }

  async #promptSkillProficiencySwap(actor) {
    if (!this.#canPrompt(actor)) {
      return false;
    }

    const skills = Object.entries(CONFIG.DND5E.skills ?? {}).map(([value, config]) => ({
      value,
      label: config.label ?? value
    }));
    const oldSkill = await this.#choice(actor, "Людская натура: убрать владение", skills);
    if (!oldSkill) {
      return false;
    }

    const newSkill = await this.#choice(actor, "Людская натура: добавить владение", skills.filter((entry) => entry.value !== oldSkill));
    if (!newSkill) {
      return false;
    }

    await actor.update({
      [`system.skills.${oldSkill}.value`]: 0,
      [`system.skills.${newSkill}.value`]: Math.max(1, toNumber(actor.system?.skills?.[newSkill]?.value, 0))
    });
    await this.#postChat(actor, "Людская натура", `${actor.name}: владение навыком заменено после длительного отдыха.`);
    return true;
  }

  async #restoreHighElfSpellSlot(actor) {
    const slots = [];
    for (let level = 1; level <= 9; level += 1) {
      const path = `system.spells.spell${level}`;
      const data = getProperty(actor, path);
      if (toNumber(data?.max, 0) > 0) {
        slots.push({ level, value: toNumber(data.value, 0), max: toNumber(data.max, 0) });
      }
    }

    const highest = slots.at(-1);
    if (!highest || highest.level <= 1) {
      return false;
    }

    const targetLevel = highest.level - 1;
    const target = getProperty(actor, `system.spells.spell${targetLevel}`);
    if (!target || toNumber(target.value, 0) >= toNumber(target.max, 0)) {
      return false;
    }

    await actor.update({ [`system.spells.spell${targetLevel}.value`]: toNumber(target.value, 0) + 1 });
    await this.#postChat(actor, "Эльфийская магия", `${actor.name}: восстановлена 1 ячейка ${targetLevel} уровня.`);
    return true;
  }

  async #chooseElementalAwakening(actor, item) {
    const choice = await this.#choice(actor, "Стихийное пробуждение", [
      { value: "acid", label: "Кислота" },
      { value: "cold", label: "Холод" },
      { value: "fire", label: "Огонь" },
      { value: "lightning", label: "Молния" },
      { value: "thunder", label: "Звук" },
      { value: "poison", label: "Яд" }
    ]);
    if (!choice) {
      return false;
    }

    await this.#createEffect(actor, activeEffectData("Стихийное пробуждение", [{
      key: "system.traits.dr.value",
      mode: EFFECT_MODE_ADD,
      value: choice,
      priority: null
    }, {
      key: `${DAMAGE_REDUCTION_FLAG}.elementalAwakening`,
      mode: EFFECT_MODE_OVERRIDE,
      value: choice,
      priority: 20
    }], {
      origin: item?.uuid,
      description: "Выбранная стихия сохранена и добавлена как сопротивление."
    }));
    return true;
  }

  async #chooseDemonicSpellcasting(actor, item) {
    const data = await this.#promptText(actor, "Демоническое колдовство", [
      { name: "cantrip", label: "Заговор" },
      { name: "ability", label: "Заклинательная характеристика", value: "cha" }
    ]);
    if (!data) {
      return false;
    }

    await actor.setFlag(MODULE_ID, "raceAutomation.demonicSpellcasting", {
      cantrip: cleanText(data.cantrip),
      ability: cleanText(data.ability)
    });
    await this.#postChat(actor, "Демоническое колдовство", `${actor.name}: выбор заговора сохранён во flags.${MODULE_ID}.raceAutomation.demonicSpellcasting.`);
    return true;
  }

  async #promptAndApplyCustomEffect(actor, item, runtime = {}) {
    const confirmed = await this.#confirm(
      actor,
      cleanText(runtime.title, item?.name ?? "Расовая автоматизация"),
      cleanText(runtime.prompt, "Применить эффект этой расовой особенности сейчас?")
    );
    if (!confirmed) {
      return false;
    }

    const data = await this.#promptText(actor, "Параметры эффекта", [
      { name: "label", label: "Название эффекта", value: item?.name ?? "Расовый эффект" },
      { name: "key", label: "Active Effect key", value: `${DAMAGE_REDUCTION_FLAG}.custom` },
      { name: "value", label: "Value", value: "1" },
      { name: "rounds", label: "Rounds", value: "" }
    ]);
    if (!data) {
      return false;
    }

    const rounds = toNumber(data.rounds, 0);
    await this.#createEffect(actor, activeEffectData(cleanText(data.label, item?.name ?? "Расовый эффект"), [{
      key: cleanText(data.key),
      mode: EFFECT_MODE_OVERRIDE,
      value: cleanText(data.value),
      priority: 20
    }], {
      origin: item?.uuid,
      rounds: rounds > 0 ? rounds : null,
      description: "Эффект создан runtime-автоматизацией rebreya-main."
    }));
    return true;
  }

  async #applyLinkedActivityEffects(activity, actor) {
    const refs = Array.isArray(activity.effects)
      ? activity.effects
      : Array.from(activity.effects?.values?.() ?? activity.effects ?? []);
    for (const ref of refs) {
      const effectId = cleanText(ref?._id ?? ref?.id ?? ref);
      const effect = activity.item?.effects?.get(effectId);
      if (!effect) {
        continue;
      }

      const targetActors = this.#activityTargetActors(activity, actor);
      for (const target of targetActors) {
        const data = effect.toObject();
        data.origin = activity.item.uuid;
        data.transfer = false;
        delete data._id;
        await this.#createEffect(target, data);
      }
    }
  }

  #activityTargetActors(activity, actor) {
    if (activity?.target?.affects?.type && activity.target.affects.type !== "self") {
      const targets = Array.from(game.user?.targets ?? []).map(resolveActorFromTarget).filter(Boolean);
      if (targets.length) {
        return targets;
      }
    }

    return [actor];
  }

  async #consumeFeatureUse(item) {
    if (!item) {
      return true;
    }

    const uses = item.system?.uses;
    if (!uses) {
      return true;
    }

    const max = await this.#evaluateFormula(uses.max, item.actor);
    if (!max) {
      return true;
    }

    const spent = toNumber(uses.spent, 0);
    if (spent >= max) {
      ui.notifications.warn(`${item.name}: нет доступных использований.`);
      return false;
    }

    await item.update({ "system.uses.spent": spent + 1 });
    return true;
  }

  async #evaluateFormula(formula, actor) {
    const text = cleanText(formula);
    if (!text) {
      return 0;
    }

    const roll = createFormulaRoll(text, actor);
    await roll.evaluate();
    return toNumber(roll.total, 0);
  }

  async #applyDamage(actor, formula, damageType = "", options = {}) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    if (!this.#canUpdate(actor)) {
      await this.#emitAsGM("applyTargetDamage", {
        actorUuid: actor.uuid,
        formula,
        damageType,
        sourceActorUuid: options.sourceActor?.uuid,
        sourceItemUuid: options.sourceItemUuid,
        label: options.label
      });
      return true;
    }

    const roll = createFormulaRoll(formula, options.sourceActor ?? actor);
    await roll.evaluate();
    const damage = {
      value: Math.max(0, toNumber(roll.total, 0)),
      type: cleanText(damageType)
    };
    await actor.applyDamage([damage], {
      sourceActorUuid: options.sourceActor?.uuid,
      sourceItemUuid: options.sourceItemUuid
    });
    await roll.toMessage({
      speaker: speakerForActor(options.sourceActor ?? actor),
      flavor: cleanText(options.label, "Расовый урон")
    });
    return true;
  }

  async #healActor(actor, formula, options = {}) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    if (!this.#canUpdate(actor)) {
      await this.#emitAsGM("healActor", {
        actorUuid: actor.uuid,
        formula,
        label: options.label
      });
      return true;
    }

    const roll = createFormulaRoll(formula, actor);
    await roll.evaluate();
    const hp = actor.system?.attributes?.hp;
    const value = Math.min(toNumber(hp?.max, 0), toNumber(hp?.value, 0) + Math.max(0, toNumber(roll.total, 0)));
    await actor.update({ "system.attributes.hp.value": value });
    await roll.toMessage({
      speaker: speakerForActor(actor),
      flavor: cleanText(options.label, "Расовое исцеление")
    });
    return true;
  }

  async #createEffect(actor, effectData) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    if (!this.#canUpdate(actor)) {
      await this.#emitAsGM("createActorEffect", {
        actorUuid: actor.uuid,
        effect: effectData
      });
      return true;
    }

    const data = foundry.utils.deepClone(effectData);
    delete data._id;
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    return true;
  }

  #canUpdate(document) {
    return Boolean(game.user?.isGM || document?.isOwner);
  }

  async #emitAsGM(action, payload = {}) {
    if (!game.user?.isGM) {
      return false;
    }

    game.socket?.emit?.(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_RACE_AUTOMATION,
      payload: {
        ...payload,
        action
      },
      senderId: game.user?.id ?? ""
    });
    return true;
  }

  async #postChat(actor, title, content) {
    return ChatMessage.create({
      speaker: speakerForActor(actor),
      flavor: title,
      content: `<p>${escapeHtml(content)}</p>`
    });
  }
}

export { SOCKET_EVENT_RACE_AUTOMATION };
