// @rebreya-role canonical-composition-root
import { MODULE_ID, SETTINGS_KEYS } from "./constants.js";
import { MaterialsCompendiumService } from "./data/materials-compendium.js";
import { GearCompendiumService } from "./data/gear-compendium.js?v=1.4.96-firearm-template-version-18";
import { MagicItemsCompendiumService } from "./data/magic-items-compendium.js";
import { FeatsCompendiumService } from "./data/feats-compendium.js";
import { BackgroundsCompendiumService } from "./data/backgrounds-compendium.js";
import { StatesCompendiumService } from "./data/states-compendium.js";
import { RacesCompendiumService } from "./data/races-compendium.js";
import { ClassesCompendiumService } from "./data/classes-compendium.js";
import { CraftsmanConstructCompendiumService } from "./data/craftsman-construct-compendium.js";
import { SpellsCompendiumService } from "./data/spells-compendium.js";
import { ActionsCompendiumService } from "./data/actions-compendium.js";
import { DowntimeCompendiumService } from "./data/downtime-compendium.js";
import { FeatChoiceAutomationService, registerFeatChoiceAutomationHooks } from "./automation/feat-choice-service.js";
import { EconomyRepository } from "./data/repository.js";
import { TraderService, normalizeTraderState } from "./data/trader-service.js?v=1.4.96-durability";
import { TradeTransactionService } from "./features/trading/trade-transaction-service.js";
import {
  createTradeTransactionId,
  isValidTradeTransactionId
} from "./features/trading/trade-transaction-model.js";
import {
  GroupContextService,
  buildDefaultGroupState,
  getGroupMemberActors,
  isManagedPartyGroup,
  normalizeGroupRegistry,
  normalizeGroupState
} from "./data/group-context-service.js";
import { RebreyaQuestLogService } from "./data/quest-log-service.js";
import { DowntimeService } from "./data/downtime-service.js?v=1.4.96-craft-calendar";
import { CharacterDowntimeService } from "./data/character-downtime-service.js";
import {
  GROUP_TRAVEL_REPLACE_STATE_COMMAND,
  TravelService,
  normalizeTravelState
} from "./data/travel-service.js";
import { TravelMapService } from "./data/travel-map-service.js";
import {
  INVENTORY_IMPORT_COMMAND,
  INVENTORY_SALE_COMMAND,
  INVENTORY_TAKE_COMMAND,
  InventoryService,
  SOCKET_EVENT_INVENTORY_IMPORT_REQUEST,
  SOCKET_EVENT_INVENTORY_IMPORT_RESULT,
  SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_REQUEST,
  SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
  SOCKET_EVENT_INVENTORY_ITEM_ACTION_REQUEST,
  SOCKET_EVENT_INVENTORY_ITEM_ACTION_RESULT
} from "./data/inventory-service.js?v=1.4.96-durable-transfer";
import { DurabilityService } from "./data/durability-service.js?v=1.4.96-durability";
import { MapObjectTokenService } from "./data/map-object-token-service.js?v=1.4.97-map-object-token";
import { HeroDollService } from "./data/hero-doll-service.js";
import { CraftingService } from "./data/crafting-service.js?v=1.4.96-craft-calendar";
import { CraftDowntimeService } from "./data/craft-downtime-service.js?v=1.4.96-craft-calendar";
import { ItemUpgradeService } from "./data/item-upgrade-service.js?v=1.4.96-item-upgrades";
import { GROUP_CALENDAR_PATCH_COMMAND, CalendarService } from "./data/calendar-service.js";
import { CalendarTransitionCoordinator } from "./data/calendar-transition-coordinator.js?v=1.4.96-craft-calendar";
import { WorldMutationCoordinator } from "./application/world-mutation-coordinator.js";
import { LootClaimService } from "./application/loot-claim-service.js";
import { GroupStateRepository } from "./infrastructure/foundry/group-state-repository.js";
import { TraderStateRepository } from "./infrastructure/foundry/trader-state-repository.js";
import { isActiveGmClient } from "./infrastructure/foundry/active-gm.js";
import { SocketCommandBus } from "./infrastructure/foundry/socket-command-bus.js";
import { UiRefreshCoordinator } from "./infrastructure/ui/ui-refresh-coordinator.js";
import { GlobalEventsService } from "./data/global-events-service.js";
import { registerCombatHooks } from "./combat/hooks.js?v=1.4.110-giant-tribe-cleanup";
import { CombatAttackService } from "./combat/attack-service.js?v=1.4.109-character-size-reach";
import { SizeAutomationService } from "./combat/size-automation-service.js?v=1.4.109-character-size";
import { ReactionCapabilityIndex } from "./combat/reaction-capability-index.js";
import { ReactionQueueService } from "./combat/reaction-queue-service.js";
import { RuneKnightAutomationService } from "./combat/rune-knight-automation-service.js";
import { SpellAutomationService } from "./combat/spell-automation-service.js";
import { registerRadialStatusEffects } from "./combat/radial-status-effects.js";
import { CombatStatusService, registerCombatStatusConfig } from "./combat/status-service.js?v=1.4.100-stale-active-effect-delete";
import { AttackRollBoostService } from "./combat/attack-roll-boost-service.js?v=1.4.96";
import { EnvironmentAutomationService } from "./combat/environment-automation-service.js?v=1.4.96-environment-stable-statuses";
import { registerMechanusRollHooks } from "./cosmology/mechanus-rolls.js?v=1.4.96-mechanus-d20-advantage-mode";
import { FighterAutomationService } from "./combat/fighter-automation-service.js?v=1.4.96";
import { SorcererAutomationService } from "./combat/sorcerer-automation-service.js?v=1.4.96-sorcerer-cooldown-card";
import { ElementalAdeptAutomationService } from "./combat/elemental-adept-automation-service.js";
import {
  PaladinAutomationService,
  SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION
} from "./combat/paladin-automation-service.js?v=1.4.96";
import { RogueAutomationService } from "./combat/rogue-automation-service.js?v=1.4.96-rebreya-open-position";
import {
  PERFORMER_APPLY_RESULT_COMMAND,
  PerformerAutomationService
} from "./combat/performer-automation-service.js?v=1.4.96";
import { BardicInspirationCompatService } from "./combat/bardic-inspiration-compat-service.js";
import { RaceAutomationService, SOCKET_EVENT_RACE_AUTOMATION } from "./combat/race-automation-service.js?v=1.4.110-giant-tribe-review-fixes";
import { CraftsmanGadgetService } from "./combat/craftsman-gadget-service.js";
import { CraftsmanGadgetZoneService } from "./combat/craftsman-gadget-zone-service.js";
import { CraftsmanVehicleService } from "./combat/craftsman-vehicle-service.js";
import { CraftsmanConstructorService } from "./combat/craftsman-constructor-service.js";
import { registerSceneControlsHook } from "./hooks.js?v=1.4.96-bg3-piles";
import {
  extendDnd5eItemTypes,
  registerDnd5eSheetExtensions,
  registerRebreyaWeaponBaseItemsFromGearPack
} from "./integrations/dnd5e-sheet-extensions.js?v=1.4.110-giant-tribe-review-fixes";
import { registerHeldShieldArmorClassPatch } from "./integrations/held-shield-ac.js?v=1.4.96";
import {
  patchDurabilityItemEffectSuppression,
  reconcileBrokenEquippedArmor,
  reconcileItemPileDurability,
  registerDurabilityHooks
} from "./integrations/durability-hooks.js?v=1.4.96-durability-piles";
import {
  ensureItemPilesDnD5eIntegration,
  registerItemPilesSimilarityRepairHook
} from "./integrations/item-piles-dnd5e.js?v=1.4.96-durability-piles";
import { patchEffectMacroCombatHooks } from "./integrations/effectmacro-compat.js";
import { patchSmAirshipRenderSettingsHook } from "./integrations/sm-airship-compat.js";
import { registerInventorySyncHooks } from "./integrations/inventory-sync.js?v=1.4.96-durable-transfer";
import { runMapObjectTokenMacro } from "./integrations/map-object-token-macro.js?v=1.4.97-map-object-token";
import { refreshSmallTimeDateDisplay, registerSmallTimeIntegration, syncSmallTimeToCalendarTime } from "./integrations/smalltime-compat.js";
import { registerRationFoodConversionHook } from "./integrations/ration-food-conversion.js";
import { registerMagicWeaponTemplateHook } from "./integrations/magic-weapon-template.js?v=1.4.96";
import { registerCraftsmanGadgetHooks } from "./integrations/craftsman-gadget-hooks.js";
import { getCraftsmanSubclasses } from "./integrations/craftsman-subclass-tracks.js";
import { patchTransformCleanupUpdateActorHook } from "./integrations/transform-cleanup-compat.js";
import { registerForienQuestLogIntegration, refreshForienQuestLogApps } from "./integrations/forien-quest-log.js?v=1.4.96";
import {
  SOCKET_EVENT_SET_SETTING,
  SOCKET_EVENT_SET_SETTING_RESULT,
  handleSettingsUpdateSocketResponse,
  registerSettings
} from "./settings.js";
import { buildLootgenChatContent, buildLootgenStatusContent, registerLootgenChatHooks } from "./ui/lootgen-chat.js?v=1.4.96-durability";
import { bringAppToFront, registerHandlebarsHelpers, rerenderApp } from "./ui.js";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const SOCKET_EVENT_LOOTGEN_SHOW = "lootgen-show-result";
const SOCKET_EVENT_LOOTGEN_CLAIM_ROW = "lootgen-claim-row";
const SOCKET_EVENT_LOOTGEN_CLAIM_COINS = "lootgen-claim-coins";
const SOCKET_EVENT_LOOTGEN_CLAIM_ROW_TO_INVENTORY = "lootgen-claim-row-to-inventory";
const SOCKET_EVENT_LOOTGEN_CLAIM_ALL_TO_INVENTORY = "lootgen-claim-all-to-inventory";
const SOCKET_EVENT_TRADER_AUDIT = "trader-audit";
const SOCKET_EVENT_DOWNTIME_CREATE_REQUEST = "downtime-create-request";
const SOCKET_EVENT_DOWNTIME_CREATE_RESULT = "downtime-create-result";
const SOCKET_EVENT_DOWNTIME_UPDATE_REQUEST = "downtime-update-request";
const SOCKET_EVENT_DOWNTIME_UPDATE_RESULT = "downtime-update-result";
const SOCKET_EVENT_DOWNTIME_CHECK_RESULT_REQUEST = "downtime-check-result-request";
const SOCKET_EVENT_DOWNTIME_CHECK_RESULT_RESULT = "downtime-check-result-result";
const SOCKET_EVENT_DOWNTIME_PROJECT_CONTINUE_REQUEST = "downtime-project-continue-request";
const SOCKET_EVENT_DOWNTIME_PROJECT_CONTINUE_RESULT = "downtime-project-continue-result";
const SOCKET_EVENT_DOWNTIME_PROJECT_CLOSE_REQUEST = "downtime-project-close-request";
const SOCKET_EVENT_DOWNTIME_PROJECT_CLOSE_RESULT = "downtime-project-close-result";
const SOCKET_EVENT_DOWNTIME_UPDATED = "downtime-updated";
const SOCKET_EVENT_TRAVEL_MAP_SYNC_REQUEST = "travel-map-sync-request";
const INVENTORY_REFRESH_SETTLE_MS = 80;
const LEGACY_WORLD_MUTATION_SOCKET_TYPES = new Set([
  SOCKET_EVENT_DOWNTIME_CREATE_REQUEST,
  SOCKET_EVENT_DOWNTIME_UPDATE_REQUEST,
  SOCKET_EVENT_DOWNTIME_CHECK_RESULT_REQUEST,
  SOCKET_EVENT_DOWNTIME_PROJECT_CONTINUE_REQUEST,
  SOCKET_EVENT_DOWNTIME_PROJECT_CLOSE_REQUEST,
  SOCKET_EVENT_TRAVEL_MAP_SYNC_REQUEST,
  SOCKET_EVENT_RACE_AUTOMATION,
  SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION,
  SOCKET_EVENT_INVENTORY_IMPORT_REQUEST,
  SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_REQUEST,
  SOCKET_EVENT_INVENTORY_ITEM_ACTION_REQUEST,
  SOCKET_EVENT_TRADER_AUDIT,
  SOCKET_EVENT_LOOTGEN_CLAIM_ROW,
  SOCKET_EVENT_LOOTGEN_CLAIM_ROW_TO_INVENTORY,
  SOCKET_EVENT_LOOTGEN_CLAIM_ALL_TO_INVENTORY,
  SOCKET_EVENT_LOOTGEN_CLAIM_COINS
]);
const MODULE_STYLE_PATH = `modules/${MODULE_ID}/styles/main.css`;
const MODULE_STYLE_VERSION = "1.4.96-item-upgrade-slots";
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const TRAVEL_DAY_HOURS = 8;
const COSMOLOGY_SET_MECHANUS_COMMAND = "cosmology.setMechanus";
const COMBAT_STATUS_SET_COMMAND = "combat.status.set";
const TRADER_PURCHASE_COMMAND = "trader.purchase";
const TRADER_SELL_COMMAND = "trader.sell";
export const ITEM_PILE_DAMAGE_COMMAND = "durability.item-pile.damage";
const ENVIRONMENT_COMBAT_STATUS_IDS = new Set(["rebreya-surrounded", "rebreya-open-position"]);
const ENVIRONMENT_STATUS_SOURCE = "rebreya-environment";
const ENVIRONMENT_STATUS_VERSION = "surrounded-ac-1";
let socketModuleApi = null;
const queuedSocketMessages = [];

function registerDurabilitySettings() {
  game.settings.register(MODULE_ID, SETTINGS_KEYS.DURABILITY_MUTATION_JOURNAL, {
    scope: "world",
    config: false,
    type: Object,
    default: {
      version: 1,
      records: []
    }
  });
}

function cloneSocketPayload(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hasEligibleActiveGm(users) {
  const eligible = (user) => Boolean(user?.isGM && user?.active && user?.id != null);
  if (eligible(users?.activeGM)) {
    return true;
  }

  const entries = Array.isArray(users?.contents)
    ? users.contents
    : (Array.isArray(users)
      ? users
      : (typeof users?.values === "function"
        ? Array.from(users.values())
        : (typeof users?.[Symbol.iterator] === "function" ? Array.from(users) : [])));
  return entries.some(eligible);
}

function isActiveLegacyMutationClient(foundryGame) {
  if (foundryGame?.users == null) {
    return Boolean(foundryGame?.user?.isGM && foundryGame.user.active !== false);
  }
  return hasEligibleActiveGm(foundryGame.users) && isActiveGmClient(foundryGame);
}

function createSocketRequestId(prefix) {
  const randomPart = globalThis.foundry?.utils?.randomID?.()
    ?? Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function cleanSocketId(value) {
  return String(value ?? "").trim();
}

function getGameUsers() {
  const users = globalThis.game?.users;
  if (!users) {
    return [];
  }

  if (Array.isArray(users.contents)) {
    return users.contents;
  }

  return Array.from(users).map((entry) => Array.isArray(entry) ? entry[1] : entry).filter(Boolean);
}

function getUserById(userId) {
  const id = cleanSocketId(userId);
  if (!id) {
    return null;
  }

  return globalThis.game?.users?.get?.(id)
    ?? getGameUsers().find((user) => user?.id === id)
    ?? null;
}

function isActorOwnedByUser(actor, user) {
  if (!actor || !user || actor.type !== "character") {
    return false;
  }

  if (user.isGM) {
    return true;
  }

  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER") === true;
  }

  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[user.id] ?? 0) >= 3 || Number(ownership.default ?? 0) >= 3;
}

function getApplicationInstances(value) {
  if (!value) {
    return [];
  }

  if (value instanceof Map) {
    return Array.from(value.values());
  }

  if (Array.isArray(value)) {
    return value;
  }

  return Object.values(value);
}

function getAppElementForState(app) {
  const element = app?.element ?? null;
  if (!element) {
    return null;
  }

  if (globalThis.HTMLElement && element instanceof HTMLElement) {
    return element;
  }

  return element[0] ?? null;
}

function isApplicationMinimized(app) {
  if (app?.minimized === true || app?._minimized === true || app?.position?.minimized === true) {
    return true;
  }

  const state = app?.state ?? app?._state;
  const renderStates = globalThis.foundry?.applications?.api?.ApplicationV2?.RENDER_STATES
    ?? globalThis.Application?.RENDER_STATES
    ?? {};
  if (
    state === "minimized"
    || (renderStates.MINIMIZED !== undefined && state === renderStates.MINIMIZED)
    || (renderStates.MINIMIZE !== undefined && state === renderStates.MINIMIZE)
  ) {
    return true;
  }

  const element = getAppElementForState(app);
  return element?.classList?.contains?.("minimized") === true;
}

function getOpenActorSheetApps() {
  const apps = [
    ...Object.values(globalThis.ui?.windows ?? {}),
    ...getApplicationInstances(globalThis.foundry?.applications?.instances)
  ];
  const seen = new Set();
  return apps.filter((app) => {
    if (!app || seen.has(app) || !app.rendered || isApplicationMinimized(app) || typeof app.render !== "function") {
      return false;
    }

    const actor = app.actor ?? app.document;
    if (!actor?.id) {
      return false;
    }

    const isActorDocument = actor.type === "character"
      || actor.documentName === "Actor"
      || actor.constructor?.documentName === "Actor"
      || Boolean(app.actor);
    if (!isActorDocument) {
      return false;
    }

    seen.add(app);
    return true;
  });
}

function dispatchSocketMessage(message, senderId) {
  const moduleApi = socketModuleApi ?? globalThis.game?.rebreyaMain ?? null;
  if (!moduleApi) {
    queuedSocketMessages.push({ message, senderId });
    return;
  }

  moduleApi.handleSocketMessage(message, senderId).catch((error) => {
    console.error(`${MODULE_ID} | Failed to handle socket message.`, error);
  });
}

function flushQueuedSocketMessages(moduleApi) {
  if (!moduleApi) {
    return;
  }

  while (queuedSocketMessages.length) {
    const queuedMessage = queuedSocketMessages.shift();
    moduleApi.handleSocketMessage(queuedMessage.message, queuedMessage.senderId).catch((error) => {
      console.error(`${MODULE_ID} | Failed to handle queued socket message.`, error);
    });
  }
}

function ensureModuleStylesheet() {
  if (!globalThis.document?.head) {
    return;
  }

  const stylesheetAttribute = `data-${MODULE_ID}-stylesheet`;
  const stylesheetHref = `${MODULE_STYLE_PATH}?v=${encodeURIComponent(MODULE_STYLE_VERSION)}`;
  const stylesheetLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  const managedStylesheet = stylesheetLinks.find((link) => link.hasAttribute(stylesheetAttribute));
  if (managedStylesheet) {
    if (String(managedStylesheet.getAttribute("href") ?? "") !== stylesheetHref) {
      managedStylesheet.setAttribute("href", stylesheetHref);
    }

    return;
  }

  const hasCurrentModuleStylesheet = stylesheetLinks.some((link) => {
    const href = String(link.getAttribute("href") ?? "");
    return href === stylesheetHref || href.endsWith(`/${stylesheetHref}`);
  });

  if (hasCurrentModuleStylesheet) {
    return;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.setAttribute("href", stylesheetHref);
  link.setAttribute(stylesheetAttribute, "true");
  document.head.append(link);
}

try {
  ensureModuleStylesheet();
}
catch (error) {
  console.warn(`${MODULE_ID} | Failed to ensure module stylesheet.`, error);
}

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function normalizeTradeSourceType(value) {
  const compact = normalizeLookupText(value).replace(/[_\-\s]+/gu, "");
  if (["material", "materials", "материал", "материалы"].includes(compact)) {
    return "material";
  }

  if (["gear", "equipment", "loot", "снаряжение"].includes(compact)) {
    return "gear";
  }

  if (["magicitem", "magicitems", "magic", "magical", "магическийпредмет", "магия"].includes(compact)) {
    return "magicItem";
  }

  if (["feat", "feats", "черта", "черты", "умение"].includes(compact)) {
    return "feat";
  }

  if (["background", "backgrounds", "предыстория", "предыстории"].includes(compact)) {
    return "background";
  }

  if (["state", "states", "государство", "государства", "родноегосударство"].includes(compact)) {
    return "state";
  }

  return compact || "";
}

function parseCalendarIsoDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,6})-(\d{2})-(\d{2})$/u);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeTimeOfDaySeconds(seconds) {
  const safeSeconds = Math.trunc(toNumber(seconds, 0));
  return ((safeSeconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}

function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function isTrimmedNonEmptyString(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function isValidTraderPurchasePayload(payload) {
  return hasExactKeys(payload, [
    "actorId", "cityId", "itemKey", "legacy", "quantity", "traderKey", "transactionId"
  ])
    && payload.legacy === false
    && isValidTradeTransactionId(payload.transactionId)
    && [payload.actorId, payload.cityId, payload.traderKey, payload.itemKey].every(isTrimmedNonEmptyString)
    && Number.isInteger(payload.quantity)
    && payload.quantity > 0;
}

function isValidTraderSalePayload(payload) {
  return hasExactKeys(payload, [
    "actorId", "cityId", "itemUuid", "quantity", "traderKey", "transactionId"
  ])
    && isValidTradeTransactionId(payload.transactionId)
    && [payload.actorId, payload.cityId, payload.traderKey, payload.itemUuid].every(isTrimmedNonEmptyString)
    && Number.isInteger(payload.quantity)
    && payload.quantity > 0;
}

function isValidPerformerApplyResultPayload(payload) {
  return hasExactKeys(payload, [
    "sourceActorId", "sourceItemId", "targetActorId", "targetTokenUuid", "total"
  ])
    && [payload.sourceActorId, payload.sourceItemId, payload.targetActorId].every(isTrimmedNonEmptyString)
    && typeof payload.targetTokenUuid === "string"
    && payload.targetTokenUuid === payload.targetTokenUuid.trim()
    && Number.isFinite(payload.total);
}

function isValidInventoryMutationId(value) {
  return isTrimmedNonEmptyString(value) && value.length <= 160;
}

function isValidInventoryTakePayload(payload) {
  return hasExactKeys(payload, [
    "inventoryActorId", "itemId", "mutationId", "quantity", "targetActorId"
  ])
    && [payload.inventoryActorId, payload.itemId, payload.targetActorId].every(isTrimmedNonEmptyString)
    && isValidInventoryMutationId(payload.mutationId)
    && Number.isFinite(payload.quantity)
    && payload.quantity > 0;
}

function isValidInventorySalePayload(payload) {
  return hasExactKeys(payload, ["inventoryActorId", "itemId", "mutationId", "quantity"])
    && [payload.inventoryActorId, payload.itemId].every(isTrimmedNonEmptyString)
    && isValidInventoryMutationId(payload.mutationId)
    && Number.isFinite(payload.quantity)
    && payload.quantity > 0;
}

function isValidInventoryImportPayload(payload) {
  return hasExactKeys(payload, ["inventoryActorId", "itemUuid", "mutationId"])
    && [payload.inventoryActorId, payload.itemUuid].every(isTrimmedNonEmptyString)
    && isValidInventoryMutationId(payload.mutationId);
}

function isValidItemPileDamagePayload(payload) {
  return hasExactKeys(payload, ["amount", "damageType", "itemUuid", "mutationId"])
    && isTrimmedNonEmptyString(payload.itemUuid)
    && payload.itemUuid.length <= 512
    && Number.isFinite(payload.amount)
    && payload.amount > 0
    && typeof payload.damageType === "string"
    && payload.damageType === payload.damageType.trim()
    && payload.damageType.length <= 100
    && isValidInventoryMutationId(payload.mutationId);
}

function itemPilesApi() {
  return globalThis.game?.itempiles?.API
    ?? globalThis.game?.modules?.get?.("item-piles")?.api
    ?? null;
}

async function resolveItemPileDurabilityItem(itemUuid) {
  const item = typeof globalThis.fromUuid === "function"
    ? await globalThis.fromUuid(itemUuid)
    : null;
  const actor = item?.parent ?? item?.actor ?? null;
  const api = itemPilesApi();
  if (!item || !actor || !api || !item?.flags?.[MODULE_ID]?.durability) {
    return null;
  }
  const target = actor?.token?.document ?? actor?.token ?? actor;
  try {
    return api.isValidItemPile?.(target) === true || (target !== actor && api.isValidItemPile?.(actor) === true)
      ? item
      : null;
  }
  catch (_error) {
    return null;
  }
}

function traderActorIsOwnedByUser(actor, user) {
  if (!actor || !user) return false;
  if (user.isGM === true) return true;
  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER") === true;
  }
  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[user.id] ?? 0) >= 3 || Number(ownership.default ?? 0) >= 3;
}

function isValidIsoDate(value) {
  return parseCalendarIsoDate(value) != null;
}

function isValidCalendarPatchPayload(payload) {
  if (!hasExactKeys(payload, ["groupActorId", "patch"])) {
    return false;
  }
  if (typeof payload.groupActorId !== "string" || !payload.groupActorId.trim() || !isPlainObject(payload.patch)) {
    return false;
  }
  const patchKeys = Object.keys(payload.patch).sort();
  if (!patchKeys.length || patchKeys.some((key) => key !== "isoDate" && key !== "timeOfDaySeconds")) {
    return false;
  }
  if (patchKeys.includes("isoDate") && !isValidIsoDate(payload.patch.isoDate)) {
    return false;
  }
  return !patchKeys.includes("timeOfDaySeconds")
    || (Number.isInteger(payload.patch.timeOfDaySeconds)
      && payload.patch.timeOfDaySeconds >= 0
      && payload.patch.timeOfDaySeconds <= 86399);
}

function isValidTravelReplacePayload(payload) {
  return hasExactKeys(payload, ["groupActorId", "travelState"])
    && typeof payload.groupActorId === "string"
    && payload.groupActorId.trim().length > 0
    && isPlainObject(payload.travelState);
}

function isValidMechanusPayload(payload) {
  return hasExactKeys(payload, ["enabled"])
    && typeof payload.enabled === "boolean";
}

function normalizeDocumentId(documentOrId) {
  if (typeof documentOrId === "string") {
    return documentOrId.trim();
  }

  return String(documentOrId?.id ?? documentOrId?._id ?? "").trim();
}

function resolveActorById(actorId) {
  const normalizedActorId = String(actorId ?? "").trim();
  if (!normalizedActorId) {
    return null;
  }

  return globalThis.game?.actors?.get?.(normalizedActorId)
    ?? globalThis.game?.actors?.contents?.find?.((actor) => String(actor?.id) === normalizedActorId)
    ?? null;
}

function resolveActorFromUuid(uuid) {
  const text = String(uuid ?? "").trim();
  const actorId = text.match(/^Actor\.([^.]+)$/u)?.[1] ?? "";
  return actorId ? resolveActorById(actorId) : null;
}

function normalizeCombatStatusOptionsForSocket(options = {}) {
  const normalized = {};
  if (Object.hasOwn(options, "active")) {
    normalized.active = options.active !== false;
  }
  if (Object.hasOwn(options, "durationRounds")) {
    normalized.durationRounds = Math.max(0, Math.floor(toNumber(options.durationRounds, 0)));
  }
  if (Object.hasOwn(options, "value")) {
    normalized.value = options.value;
  }
  if (isPlainObject(options.meta)) {
    normalized.meta = cloneSocketPayload(options.meta);
  }
  return normalized;
}

function isEnvironmentCombatStatusOptions(statusId, options = {}) {
  if (!ENVIRONMENT_COMBAT_STATUS_IDS.has(String(statusId ?? "").trim())) {
    return false;
  }

  if (!isPlainObject(options)) {
    return false;
  }

  if (options.active === false) {
    return Object.keys(options).every((key) => key === "active");
  }

  const meta = options.meta;
  return Boolean(
    options.active === true
    && Number.isInteger(options.durationRounds)
    && options.durationRounds === 1
    && isPlainObject(meta)
    && meta.source === ENVIRONMENT_STATUS_SOURCE
    && meta.version === ENVIRONMENT_STATUS_VERSION
    && typeof meta.sourceActorUuid === "string"
    && meta.sourceActorUuid.trim().length > 0
    && hasExactKeys(meta, ["source", "sourceActorUuid", "version"])
    && Object.keys(options).every((key) => ["active", "durationRounds", "meta"].includes(key))
  );
}

function isValidCombatStatusSetPayload(payload) {
  return Boolean(
    hasExactKeys(payload, ["actorId", "options", "statusId"])
    && typeof payload.actorId === "string"
    && payload.actorId.trim().length > 0
    && typeof payload.statusId === "string"
    && payload.statusId.trim().length > 0
    && isEnvironmentCombatStatusOptions(payload.statusId, payload.options)
  );
}

function actorIsOwnedByUser(actor, user) {
  if (actor?.type !== "character" || !user) {
    return false;
  }
  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER");
  }
  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[user.id] ?? 0) >= 3 || Number(ownership.default ?? 0) >= 3;
}

function actorCanMutateLocally(actor) {
  return Boolean(globalThis.game?.user?.isGM || actor?.isOwner === true);
}

function filterVisibleGlobalEvents(events = []) {
  const rows = Array.isArray(events) ? events : [];
  if (game.user?.isGM) {
    return rows;
  }

  const showPublicEvents = game.settings.get(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_SHOW_PUBLIC) === true;
  if (!showPublicEvents) {
    return [];
  }

  return rows.filter((event) => event?.visibility?.gmOnly === false);
}

export class RebreyaMainModule {
  constructor() {
    this.worldMutationCoordinator = new WorldMutationCoordinator();
    this.uiRefreshCoordinator = new UiRefreshCoordinator();
    this.inventoryRefreshActorIds = new Set();
    this.inventoryRefreshHoldCount = 0;
    this.inventoryRefreshTimer = null;
    this.inventoryRefreshWaiters = [];
    this.groupStateRepository = new GroupStateRepository({
      coordinator: this.worldMutationCoordinator,
      gameProvider: () => globalThis.game,
      normalizeRegistry: normalizeGroupRegistry,
      normalizeGroupState,
      buildDefaultGroupState
    });
    this.socketCommandBus = new SocketCommandBus({
      coordinator: this.worldMutationCoordinator,
      gameProvider: () => globalThis.game
    });
    this.traderStateRepository = new TraderStateRepository({
      coordinator: this.worldMutationCoordinator,
      gameProvider: () => globalThis.game,
      normalizeState: normalizeTraderState
    });
    this.repository = new EconomyRepository();
    this.materialsCompendium = new MaterialsCompendiumService();
    this.gearCompendium = new GearCompendiumService();
    this.magicItemsCompendium = new MagicItemsCompendiumService();
    this.featsCompendium = new FeatsCompendiumService();
    this.backgroundsCompendium = new BackgroundsCompendiumService();
    this.statesCompendium = new StatesCompendiumService();
    this.racesCompendium = new RacesCompendiumService();
    this.spellsCompendium = new SpellsCompendiumService();
    this.craftsmanConstructCompendium = new CraftsmanConstructCompendiumService({
      gameProvider: () => globalThis.game,
      actorProvider: () => globalThis.Actor,
      isActiveGmClient
    });
    this.classesCompendium = new ClassesCompendiumService();
    this.actionsCompendium = new ActionsCompendiumService();
    this.downtimeCompendium = new DowntimeCompendiumService();
    this.traderService = new TraderService(this, {
      stateRepository: this.traderStateRepository
    });
    this.tradeTransactionService = new TradeTransactionService({
      repository: this.traderStateRepository,
      operations: this.traderService.createFoundryTradeOperations()
    });
    this.traderService.setTransactionService(this.tradeTransactionService);
    this.groupContextService = new GroupContextService({
      coordinator: this.worldMutationCoordinator,
      groupStateRepository: this.groupStateRepository
    });
    this.questLogService = new RebreyaQuestLogService({ groupContextService: this.groupContextService });
    this.downtimeService = new DowntimeService(this);
    this.characterDowntimeService = new CharacterDowntimeService(this);
    this.travelService = new TravelService({
      groupContextService: this.groupContextService,
      commandBus: this.socketCommandBus
    });
    this.travelMapService = new TravelMapService();
    this.inventoryService = new InventoryService(this);
    this.durabilityService = new DurabilityService(this);
    this.mapObjectTokenService = new MapObjectTokenService({
      gameProvider: () => globalThis.game,
      actorProvider: () => globalThis.Actor,
      macroProvider: () => globalThis.Macro,
      isActiveGmClient
    });
    this.lootClaimService = new LootClaimService({
      getMessage: ({ messageId, lootId }) => (
        (messageId ? globalThis.game?.messages?.get?.(messageId) : null)
        ?? this.#findLootgenChatMessage(lootId)
      ),
      readState: (message) => message.getFlag(MODULE_ID, "lootgenChat") ?? {},
      writeState: (message, state) => message.update({
        content: buildLootgenChatContent(state),
        [`flags.${MODULE_ID}.lootgenChat`]: state
      }),
      grantRow: ({ claimId, row }) => this.inventoryService.addLootgenChatRowToInventoryOnce(
        row,
        `loot-row:${claimId}`
      ),
      grantCoins: ({ claimId, coins }) => this.inventoryService.addCurrencyToInventoryOnce(
        coins,
        `loot-coins:${claimId}`
      ),
      coordinator: this.worldMutationCoordinator
    });
    this.heroDollService = new HeroDollService(this);
    this.craftingService = new CraftingService(this);
    this.craftDowntimeService = new CraftDowntimeService({
      craftingService: this.craftingService,
      downtimeService: this.downtimeService
    });
    this.itemUpgradeService = new ItemUpgradeService(this);
    this.calendarService = new CalendarService({
      groupContextService: this.groupContextService,
      commandBus: this.socketCommandBus
    });
    this.globalEventsService = new GlobalEventsService(this);
    this.calendarTransitionCoordinator = new CalendarTransitionCoordinator({
      calendarService: this.calendarService,
      downtimeService: this.downtimeService,
      groupContextService: this.groupContextService,
      refreshGlobalEvents: (currentIsoDate, previousIsoDate, executionContext) => (
        this.#refreshGlobalEventsByCalendarTransition(currentIsoDate, previousIsoDate, executionContext)
      ),
      resetTraderMonth: (monthResetCount, reason, executionContext) => (
        this.#applyTraderMonthlyReset(monthResetCount, reason, executionContext)
      ),
      processDayCycles: (days, options) => this.#runDayCycles(days, options),
      refreshApps: (executionContext) => this.#refreshAppsByCalendarTransition(executionContext),
      refreshSmallTime: (executionContext) => this.#refreshSmallTimeByCalendarTransition(executionContext),
      activityProcessor: (slot, executionContext) => (
        cleanSocketId(slot?.activityId) === "craft"
          ? this.craftDowntimeService.processScheduledSlot(slot, executionContext)
          : { result: null }
      )
    });
    this.reactionCapabilityIndex = new ReactionCapabilityIndex();
    this.reactionQueueService = new ReactionQueueService(this, {
      capabilityIndex: this.reactionCapabilityIndex,
      logger: console
    });
    this.runeKnightAutomationService = new RuneKnightAutomationService(this);
    this.combatStatusService = new CombatStatusService(this);
    this.combatAttackService = new CombatAttackService(this);
    this.sizeAutomationService = new SizeAutomationService(this);
    this.spellAutomationService = new SpellAutomationService(this);
    this.attackRollBoostService = new AttackRollBoostService(this);
    this.environmentAutomationService = new EnvironmentAutomationService(this);
    this.fighterAutomationService = new FighterAutomationService(this);
    this.sorcererAutomationService = new SorcererAutomationService(this);
    this.elementalAdeptAutomationService = new ElementalAdeptAutomationService(this);
    this.paladinAutomationService = new PaladinAutomationService(this);
    this.rogueAutomationService = new RogueAutomationService(this);
    this.performerAutomationService = new PerformerAutomationService(this);
    this.bardicInspirationCompatService = new BardicInspirationCompatService(this);
    this.raceAutomationService = new RaceAutomationService(this);
    this.craftsmanGadgetZoneService = new CraftsmanGadgetZoneService({
      isActiveGmClient: () => isActiveGmClient(globalThis.game)
    });
    this.craftsmanVehicleService = new CraftsmanVehicleService({
      isActiveGmClient: () => isActiveGmClient(globalThis.game)
    });
    this.craftsmanGadgetService = new CraftsmanGadgetService(this, {
      zoneService: this.craftsmanGadgetZoneService,
      vehicleService: this.craftsmanVehicleService,
      isActiveGmClient: () => isActiveGmClient(globalThis.game)
    });
    this.craftsmanConstructorService = new CraftsmanConstructorService({
      mapObjectTokenService: this.mapObjectTokenService,
      getCraftsmanSubclasses,
      sceneDocuments: () => globalThis.game?.scenes,
      isActiveGmClient: () => isActiveGmClient(globalThis.game)
    });
    this.featChoiceAutomationService = new FeatChoiceAutomationService(this);
    this.repository.setGlobalEventsService(this.globalEventsService);
    this.economyApp = null;
    this.worldTradeRoutesApp = null;
    this.statesApp = null;
    this.globalEventsApp = null;
    this.inventoryApp = null;
    this.groupsApp = null;
    this.cosmologyApp = null;
    this.lootgenApps = new Map();
    this.lootgenCounter = 0;
    this.latestLootgenResult = null;
    this.cityApps = new Map();
    this.traderV2Apps = new Map();
    this.tradeRouteApps = new Map();
    this.referenceApps = new Map();
    this.#registerTypedSocketCommands();
  }

  createMapObjectToken(options = {}) {
    return runMapObjectTokenMacro({
      service: this.mapObjectTokenService,
      ...options
    });
  }

  #registerTypedSocketCommands() {
    const authorizeGroup = (payload, { sender }) => this.#canSenderManageGroup(sender, payload.groupActorId);
    this.socketCommandBus.register(GROUP_CALENDAR_PATCH_COMMAND, {
      validate: isValidCalendarPatchPayload,
      authorize: authorizeGroup,
      execute: (payload) => this.calendarService.patchGroupCalendar(payload.groupActorId, payload.patch)
    });
    this.socketCommandBus.register(GROUP_TRAVEL_REPLACE_STATE_COMMAND, {
      validate: isValidTravelReplacePayload,
      authorize: authorizeGroup,
      execute: (payload) => this.travelService.replaceGroupTravelState(
        payload.groupActorId,
        normalizeTravelState(payload.travelState)
      )
    });
    this.socketCommandBus.register(COSMOLOGY_SET_MECHANUS_COMMAND, {
      validate: isValidMechanusPayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload) => this.#commitMechanusEnabled(payload.enabled)
    });
    this.socketCommandBus.register(COMBAT_STATUS_SET_COMMAND, {
      validate: isValidCombatStatusSetPayload,
      authorize: (payload, { sender }) => this.#canSenderSetCombatStatus(sender, payload),
      execute: (payload) => this.#executeCombatStatusSetCommand(payload)
    });
    this.socketCommandBus.register(PERFORMER_APPLY_RESULT_COMMAND, {
      validate: isValidPerformerApplyResultPayload,
      authorize: (payload, { sender }) => traderActorIsOwnedByUser(
        resolveActorById(payload.sourceActorId),
        sender
      ),
      execute: (payload) => this.performerAutomationService.commitActivePerformance(payload)
    });
    this.socketCommandBus.register(INVENTORY_TAKE_COMMAND, {
      validate: isValidInventoryTakePayload,
      authorize: (payload, { sender }) => this.#canSenderTakeInventoryItem(sender, payload),
      execute: (payload) => this.inventoryService.executeTakeMutation(payload)
    });
    this.socketCommandBus.register(INVENTORY_SALE_COMMAND, {
      validate: isValidInventorySalePayload,
      authorize: (payload, { sender }) => this.#canSenderManageGroup(sender, payload.inventoryActorId),
      execute: (payload) => this.inventoryService.executeSaleMutation(payload)
    });
    this.socketCommandBus.register(INVENTORY_IMPORT_COMMAND, {
      validate: isValidInventoryImportPayload,
      authorize: (payload, { sender }) => this.#canSenderImportInventoryItem(sender, payload),
      execute: (payload) => this.inventoryService.executeImportMutation(payload)
    });
    this.socketCommandBus.register(ITEM_PILE_DAMAGE_COMMAND, {
      validate: isValidItemPileDamagePayload,
      authorize: async (payload, { sender }) => {
        const item = await resolveItemPileDurabilityItem(payload.itemUuid);
        return traderActorIsOwnedByUser(item?.parent ?? item?.actor, sender);
      },
      execute: async (payload) => {
        const item = await resolveItemPileDurabilityItem(payload.itemUuid);
        if (!item) {
          throw new Error("Item Pile durability target was not found.");
        }
        return this.durabilityService.damageItem(item, {
          amount: payload.amount,
          damageType: payload.damageType,
          mutationId: payload.mutationId
        });
      }
    });
    const authorizeTradeActor = (payload, { sender }) => traderActorIsOwnedByUser(
      globalThis.game?.actors?.get?.(payload.actorId)
        ?? globalThis.game?.actors?.contents?.find?.((actor) => String(actor?.id) === payload.actorId),
      sender
    );
    this.socketCommandBus.register(TRADER_PURCHASE_COMMAND, {
      validate: isValidTraderPurchasePayload,
      authorize: authorizeTradeActor,
      execute: (payload, { sender }) => this.tradeTransactionService.purchase({
        transactionId: payload.transactionId,
        actorId: payload.actorId,
        cityId: payload.cityId,
        traderKey: payload.traderKey,
        itemKey: payload.itemKey,
        quantity: payload.quantity,
        requestedByUserId: sender.id
      }, { source: "typed-socket" })
    });
    this.socketCommandBus.register(TRADER_SELL_COMMAND, {
      validate: isValidTraderSalePayload,
      authorize: authorizeTradeActor,
      execute: (payload, { sender }) => this.tradeTransactionService.sale({
        transactionId: payload.transactionId,
        actorId: payload.actorId,
        cityId: payload.cityId,
        traderKey: payload.traderKey,
        itemUuid: payload.itemUuid,
        quantity: payload.quantity,
        requestedByUserId: sender.id
      }, { source: "typed-socket" })
    });
  }

  #canSenderSetCombatStatus(sender, payload) {
    if (sender?.isGM) {
      return true;
    }

    if (!isValidCombatStatusSetPayload(payload)) {
      return false;
    }

    if (payload.options.active === false) {
      const current = this.combatStatusService.getStatus(payload.actorId, payload.statusId);
      return current?.active === true && current?.meta?.source === ENVIRONMENT_STATUS_SOURCE;
    }

    const sourceActor = resolveActorFromUuid(payload.options.meta?.sourceActorUuid);
    return actorIsOwnedByUser(sourceActor, sender);
  }

  async #executeCombatStatusSetCommand(payload) {
    const result = await this.combatStatusService.setStatus(payload.actorId, payload.statusId, payload.options);
    await this.refreshOpenApps();
    return this.combatStatusService.getStatus(payload.actorId, payload.statusId) ?? Boolean(result);
  }

  #shouldRouteCombatStatus(actor, statusInput, options = {}) {
    if (actorCanMutateLocally(actor)) {
      return false;
    }

    const statusId = this.combatStatusService.normalizeStatusId(statusInput, String(statusInput ?? "").trim());
    const socketOptions = normalizeCombatStatusOptionsForSocket(options);
    return isEnvironmentCombatStatusOptions(statusId, socketOptions);
  }

  #combatStatusPayload(actor, statusInput, options = {}) {
    const actorId = normalizeDocumentId(actor);
    const statusId = this.combatStatusService.normalizeStatusId(statusInput, String(statusInput ?? "").trim());
    return {
      actorId,
      statusId,
      options: normalizeCombatStatusOptionsForSocket(options)
    };
  }

  async #requestCombatStatusSet(actor, statusInput, options = {}) {
    const payload = this.#combatStatusPayload(actor, statusInput, options);
    if (!isValidCombatStatusSetPayload(payload)) {
      throw new Error("Invalid combat status socket payload");
    }

    return this.socketCommandBus.request(COMBAT_STATUS_SET_COMMAND, payload);
  }

  #canSenderManageGroup(sender, groupActorId) {
    const normalizedGroupActorId = String(groupActorId ?? "").trim();
    const groupActor = globalThis.game?.actors?.get?.(normalizedGroupActorId)
      ?? globalThis.game?.actors?.contents?.find?.((actor) => String(actor?.id) === normalizedGroupActorId)
      ?? null;
    if (!isManagedPartyGroup(groupActor)) {
      return false;
    }
    const registry = this.groupContextService.getRegistry();
    if (!registry.groupsById[normalizedGroupActorId]) {
      return false;
    }
    if (sender?.isGM) {
      return true;
    }
    return getGroupMemberActors(groupActor).some((actor) => actorIsOwnedByUser(actor, sender));
  }

  #canSenderTakeInventoryItem(sender, payload) {
    if (!this.#canSenderManageGroup(sender, payload.inventoryActorId)) {
      return false;
    }
    const groupActor = resolveActorById(payload.inventoryActorId);
    const targetActor = resolveActorById(payload.targetActorId);
    return actorIsOwnedByUser(targetActor, sender)
      && getGroupMemberActors(groupActor).some((actor) => actor?.id === targetActor?.id);
  }

  async #canSenderImportInventoryItem(sender, payload) {
    if (!this.#canSenderManageGroup(sender, payload.inventoryActorId)) {
      return false;
    }
    const item = typeof globalThis.fromUuid === "function"
      ? await globalThis.fromUuid(payload.itemUuid)
      : null;
    const sourceActor = item?.parent ?? null;
    const groupActor = resolveActorById(payload.inventoryActorId);
    return traderActorIsOwnedByUser(sourceActor, sender)
      && getGroupMemberActors(groupActor).some((actor) => actor?.id === sourceActor?.id);
  }

  async initialize() {
    try {
      const calendarSnapshot = this.calendarService.getSnapshot();
      await this.globalEventsService.refreshEventActivationByDate(calendarSnapshot?.isoDate, null);
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to refresh global events activation during initialization.`, error);
    }

    const model = await this.repository.load();
    console.log(`${MODULE_ID} | Economy loaded`, {
      cities: model.cities.length,
      regions: model.regions.length,
      goods: model.goods.length,
      materials: model.materials.length,
      gear: model.gear.length,
      source: model.source
    });

    await this.#syncManagedCompendia(model);
    try {
      await this.mapObjectTokenService.syncManagedDocuments();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to sync managed map object documents.`, error);
    }
    try {
      await this.traderService.cleanupLegacyManagedTraders();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to cleanup legacy trader actors.`, error);
    }

    try {
      await this.reactionQueueService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize global reaction queue.`, error);
    }

    try {
      await this.runeKnightAutomationService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize Rune Knight automation.`, error);
    }

    try {
      await this.combatStatusService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize combat status service.`, error);
    }

    try {
      await this.combatAttackService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize combat attack service.`, error);
    }

    try {
      await this.sizeAutomationService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize character size automation.`, error);
    }

    try {
      await this.spellAutomationService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize spell reaction automation.`, error);
    }

    try {
      await this.fighterAutomationService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize fighter automation service.`, error);
    }

    try {
      await this.paladinAutomationService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize paladin automation service.`, error);
    }

    try {
      await this.rogueAutomationService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize rogue automation service.`, error);
    }

    try {
      await this.performerAutomationService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize performer automation service.`, error);
    }

    try {
      await this.raceAutomationService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize race automation service.`, error);
    }

    try {
      this.reactionCapabilityIndex.rebuildScene(globalThis.canvas?.scene);
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to build reaction capability index.`, error);
    }
  }

  async handleSocketMessage(message, senderId) {
    if (!message || typeof message !== "object") {
      return;
    }

    if (await this.reactionQueueService.handleSocketMessage(message, senderId)) {
      return;
    }

    if (this.socketCommandBus.handleMessage(message, { transportSenderId: senderId })) {
      return;
    }

    if (!LEGACY_WORLD_MUTATION_SOCKET_TYPES.has(message.type)) {
      return this.#handleLegacySocketMessage(message);
    }

    if (!isActiveLegacyMutationClient(game)) {
      return;
    }

    return this.worldMutationCoordinator.run(
      "world",
      () => this.#handleLegacySocketMessage(message)
    );
  }

  async #handleLegacySocketMessage(message) {
    if (message.type === SOCKET_EVENT_SET_SETTING_RESULT) {
      handleSettingsUpdateSocketResponse(message);
      return;
    }

    if (message.type === SOCKET_EVENT_DOWNTIME_CREATE_RESULT) {
      await this.#handleDowntimeCreateSocketResult(message);
      return;
    }

    if (message.type === SOCKET_EVENT_DOWNTIME_UPDATE_RESULT) {
      await this.#handleDowntimeUpdateSocketResult(message);
      return;
    }

    if (message.type === SOCKET_EVENT_DOWNTIME_CHECK_RESULT_RESULT) {
      await this.#handleDowntimeCheckResultSocketResult(message);
      return;
    }

    if (message.type === SOCKET_EVENT_DOWNTIME_PROJECT_CONTINUE_RESULT) {
      await this.#handleDowntimeProjectContinueSocketResult(message);
      return;
    }

    if (message.type === SOCKET_EVENT_DOWNTIME_PROJECT_CLOSE_RESULT) {
      await this.#handleDowntimeProjectCloseSocketResult(message);
      return;
    }

    if (message.type === SOCKET_EVENT_INVENTORY_IMPORT_RESULT) {
      if (message.forUserId !== game.user?.id) {
        return;
      }

      if (message.ok) {
        await this.refreshInventoryViews();
        ui.notifications?.info("Предмет перенесён в партийный склад.");
      }
      else {
        ui.notifications?.error(message.error || "Мастер отклонил перенос предмета.");
      }
      return;
    }

    if (message.type === SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT) {
      if (message.forUserId !== game.user?.id) {
        return;
      }

      if (message.ok) {
        await this.refreshInventoryViews();
      }
      else {
        ui.notifications?.error(message.error || "Мастер не смог удалить исходный предмет склада.");
      }
      return;
    }

    if (message.type === SOCKET_EVENT_INVENTORY_ITEM_ACTION_RESULT) {
      if (message.forUserId !== game.user?.id) {
        return;
      }

      if (message.ok) {
        await this.refreshInventoryViews({ actorIds: [message.actorId] });
        const action = String(message.action ?? "");
        const labels = {
          take: "Предмет забран из партийного склада.",
          sell: "Предмет продан, монеты добавлены в склад.",
          delete: "Предмет удалён из партийного склада."
        };
        ui.notifications?.info(labels[action] ?? "Действие со складом выполнено.");
      }
      else {
        ui.notifications?.error(message.error || "Мастер не смог выполнить действие со складом.");
      }
      return;
    }

    if (message.senderId && message.senderId === game.user?.id) {
      return;
    }

    if (message.type === SOCKET_EVENT_DOWNTIME_UPDATED) {
      await this.#handleDowntimeUpdatedSocketMessage(message);
      return;
    }

    if (message.type === SOCKET_EVENT_DOWNTIME_CREATE_REQUEST) {
      if (game.user?.isGM) {
        await this.#handleDowntimeCreateSocketRequest(message);
      }
      return;
    }

    if (message.type === SOCKET_EVENT_DOWNTIME_UPDATE_REQUEST) {
      if (game.user?.isGM) {
        await this.#handleDowntimeUpdateSocketRequest(message);
      }
      return;
    }

    if (message.type === SOCKET_EVENT_DOWNTIME_CHECK_RESULT_REQUEST) {
      if (game.user?.isGM) {
        await this.#handleDowntimeCheckResultSocketRequest(message);
      }
      return;
    }

    if (message.type === SOCKET_EVENT_DOWNTIME_PROJECT_CONTINUE_REQUEST) {
      if (game.user?.isGM) {
        await this.#handleDowntimeProjectContinueSocketRequest(message);
      }
      return;
    }

    if (message.type === SOCKET_EVENT_DOWNTIME_PROJECT_CLOSE_REQUEST) {
      if (game.user?.isGM) {
        await this.#handleDowntimeProjectCloseSocketRequest(message);
      }
      return;
    }

    if (message.type === SOCKET_EVENT_TRAVEL_MAP_SYNC_REQUEST) {
      if (game.user?.isGM) {
        await this.#handleTravelMapSyncSocketRequest(message);
      }
      return;
    }

    if (message.type === SOCKET_EVENT_RACE_AUTOMATION) {
      await this.raceAutomationService.handleSocketMessage(message.payload ?? {}, {
        senderId: message.senderId ?? ""
      });
      return;
    }

    if (message.type === SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION) {
      await this.paladinAutomationService.handleSocketMessage(message.payload ?? {}, {
        senderId: message.senderId ?? ""
      });
      return;
    }

    if (message.type === SOCKET_EVENT_INVENTORY_IMPORT_REQUEST) {
      if (game.user?.isGM) {
        const forUserId = String(message.senderId ?? "").trim();
        try {
          const result = await this.runInventoryMutation(
            () => this.inventoryService.handleImportDroppedItemSocketRequest(message.payload ?? {}, {
              senderId: forUserId
            })
          );
          if (!result) {
            return;
          }

          game.socket?.emit?.(SOCKET_CHANNEL, {
            type: SOCKET_EVENT_INVENTORY_IMPORT_RESULT,
            forUserId,
            senderId: game.user?.id ?? "",
            ok: true
          });
        }
        catch (error) {
          game.socket?.emit?.(SOCKET_CHANNEL, {
            type: SOCKET_EVENT_INVENTORY_IMPORT_RESULT,
            forUserId,
            senderId: game.user?.id ?? "",
            ok: false,
            error: error?.message ?? String(error)
          });
        }
      }
      return;
    }

    if (message.type === SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_REQUEST) {
      if (game.user?.isGM) {
        const forUserId = String(message.senderId ?? "").trim();
        const transferId = String(message.payload?.transferId ?? "").trim();
        const sourceItemUuid = String(message.payload?.sourceItemUuid ?? "").trim();
        const targetItemUuid = String(message.payload?.targetItemUuid ?? "").trim();
        try {
          const result = await this.runInventoryMutation(
            () => this.inventoryService.handlePartyInventorySourceDepletionSocketRequest(message.payload ?? {}, {
              senderId: forUserId
            })
          );
          if (!result) {
            return;
          }

          game.socket?.emit?.(SOCKET_CHANNEL, {
            type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
            forUserId,
            senderId: game.user?.id ?? "",
            transferId,
            sourceItemUuid,
            targetItemUuid,
            ok: true
          });
        }
        catch (error) {
          game.socket?.emit?.(SOCKET_CHANNEL, {
            type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
            forUserId,
            senderId: game.user?.id ?? "",
            transferId,
            sourceItemUuid,
            targetItemUuid,
            ok: false,
            error: error?.message ?? String(error)
          });
        }
      }
      return;
    }

    if (message.type === SOCKET_EVENT_INVENTORY_ITEM_ACTION_REQUEST) {
      if (game.user?.isGM) {
        const forUserId = String(message.senderId ?? "").trim();
        const action = String(message.payload?.action ?? "");
        try {
          const result = await this.runInventoryMutation(
            () => this.inventoryService.handleInventoryItemActionSocketRequest(message.payload ?? {}, {
              senderId: forUserId
            })
          );
          if (!result) {
            return;
          }

          game.socket?.emit?.(SOCKET_CHANNEL, {
            type: SOCKET_EVENT_INVENTORY_ITEM_ACTION_RESULT,
            forUserId,
            senderId: game.user?.id ?? "",
            action,
            ...(result.actorId ? { actorId: result.actorId } : {}),
            ok: true
          });
        }
        catch (error) {
          game.socket?.emit?.(SOCKET_CHANNEL, {
            type: SOCKET_EVENT_INVENTORY_ITEM_ACTION_RESULT,
            forUserId,
            senderId: game.user?.id ?? "",
            action,
            ok: false,
            error: error?.message ?? String(error)
          });
        }
      }
      return;
    }

    if (message.type === SOCKET_EVENT_TRADER_AUDIT) {
      if (game.user?.isGM) {
        await this.traderService.recordTradeAudit(message.payload ?? {}, {
          senderId: message.senderId ?? ""
        });
        await this.refreshOpenApps();
      }
      return;
    }

    if (message.type === SOCKET_EVENT_SET_SETTING) {
      if (isActiveGmClient(game)) {
        const requestId = String(message.requestId ?? "").trim();
        const forUserId = String(message.senderId ?? "").trim();
        if (requestId) {
          game.socket?.emit?.(SOCKET_CHANNEL, {
            type: SOCKET_EVENT_SET_SETTING_RESULT,
            requestId,
            forUserId,
            senderId: game.user?.id ?? "",
            ok: false,
            errorCode: "raw-setting-disabled"
          });
        }
      }
      return;
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_SHOW) {
      const payload = foundry.utils.deepClone(message.payload ?? {});
      this.latestLootgenResult = payload;
      const viewerApp = this.lootgenApps.get("lootgen-viewer") ?? null;
      if (viewerApp?.rendered && typeof viewerApp.setSharedResult === "function") {
        viewerApp.setSharedResult(payload);
      }
      return;
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_CLAIM_ROW && isActiveGmClient(game)) {
      await this.claimLootgenChatRow(message.payload?.lootId, message.payload?.rowId, { quiet: true, fromSocket: true });
      return;
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_CLAIM_ROW_TO_INVENTORY && isActiveGmClient(game)) {
      await this.claimLootgenChatRowToInventory(message.payload?.lootId, message.payload?.rowId, {
        quiet: true,
        fromSocket: true,
        claimId: message.payload?.claimId
      });
      return;
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_CLAIM_ALL_TO_INVENTORY && isActiveGmClient(game)) {
      await this.claimLootgenChatAllToInventory(message.payload?.lootId, {
        quiet: true,
        fromSocket: true,
        claimId: message.payload?.claimId
      });
      return;
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_CLAIM_COINS && isActiveGmClient(game)) {
      await this.claimLootgenChatCoins(message.payload?.lootId, {
        quiet: true,
        fromSocket: true,
        claimId: message.payload?.claimId
      });
    }
  }

  async shareLootgenResult(payload = {}) {
    const sharedResult = foundry.utils.deepClone(payload ?? {});
    this.latestLootgenResult = sharedResult;

    game.socket?.emit?.(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_LOOTGEN_SHOW,
      payload: sharedResult,
      senderId: game.user?.id ?? ""
    });
  }

  #findLootgenChatMessage(lootId) {
    const safeLootId = String(lootId ?? "").trim();
    if (!safeLootId) {
      return null;
    }

    return game.messages.contents.find((message) => {
      const state = message.getFlag(MODULE_ID, "lootgenChat") ?? null;
      const createdBy = String(state?.createdBy ?? "").trim();
      const messageUserId = String(
        message?.author?.id
        ?? message?.user?.id
        ?? message?.user
        ?? ""
      ).trim();
      const author = game.users?.get?.(createdBy)
        ?? Array.from(game.users?.contents ?? []).find((user) => user?.id === createdBy)
        ?? null;
      return String(state?.lootId ?? "") === safeLootId
        && Boolean(createdBy)
        && messageUserId === createdBy
        && author?.isGM === true;
    }) ?? null;
  }

  async #updateLootgenChatState(lootId, mutator) {
    const message = this.#findLootgenChatMessage(lootId);
    if (!message) {
      throw new Error("Сообщение с лутом не найдено.");
    }

    const state = foundry.utils.deepClone(message.getFlag(MODULE_ID, "lootgenChat") ?? {});
    state.lootId = String(state.lootId ?? lootId ?? "");
    state.rows = Array.isArray(state.rows) ? state.rows : [];
    state.coins = state.coins && typeof state.coins === "object" ? state.coins : {};
    const changed = await mutator(state);
    if (!changed) {
      return { message, state, changed: false };
    }

    await message.update({
      content: buildLootgenChatContent(state),
      [`flags.${MODULE_ID}.lootgenChat`]: state
    });

    return { message, state, changed: true };
  }

  #emitLootgenClaimRequest(type, payload = {}) {
    game.socket?.emit?.(SOCKET_CHANNEL, {
      type,
      payload: foundry.utils.deepClone(payload),
      senderId: game.user?.id ?? ""
    });
  }

  #notifyLootgenChatClaim(lootId, rowId, claimType) {
    for (const app of this.lootgenApps.values()) {
      app?.handleLootgenChatClaim?.(lootId, rowId, claimType);
    }
  }

  async createLootgenChatMessage(payload = {}, options = {}) {
    if (!game.user?.isGM) {
      throw new Error("Отправлять лут в чат может только ГМ.");
    }

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const lootId = randomID();
    const appKey = String(options.appKey ?? "");
    const chatRows = [];

    for (const [index, row] of rows.entries()) {
      const rowId = randomID();
      const rowIndex = Number.isFinite(Number(row.rowIndex)) ? Number(row.rowIndex) : index;
      const itemData = await this.inventoryService.buildLootgenChatItemData(row, {
        lootId,
        rowId,
        appKey,
        rowIndex
      });

      if (!itemData) {
        throw new Error(`Не удалось подготовить предмет "${row.name ?? "лут"}" для чата.`);
      }

      chatRows.push({
        rowId,
        rowIndex,
        itemId: "",
        itemUuid: "",
        itemData,
        name: itemData.name ?? row.name,
        img: itemData.img ?? row.img,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        typeLabel: row.typeLabel,
        rank: row.rank,
        quantity: row.quantity,
        value: row.value,
        totalValue: row.totalValue,
        isBroken: itemData?.flags?.[MODULE_ID]?.durability?.state === "broken",
        claimed: false
      });
    }

    const state = {
      lootId,
      appKey,
      createdBy: game.user?.id ?? "",
      generatedAt: String(payload.generatedAt ?? ""),
      rows: chatRows,
      coins: foundry.utils.deepClone(payload.coins ?? {}),
      coinsClaimed: Number(payload.coins?.totalCopper ?? 0) <= 0,
      spentValue: payload.spentValue ?? 0,
      budgetValue: payload.budgetValue ?? 0,
      totalItems: payload.totalItems ?? chatRows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0)
    };

    const message = await ChatMessage.create({
      user: game.user?.id,
      speaker: ChatMessage.getSpeaker(),
      content: buildLootgenChatContent(state),
      flags: {
        [MODULE_ID]: {
          lootgenChat: state
        }
      }
    });

    return {
      lootId,
      messageId: message?.id ?? "",
      rows: chatRows
    };
  }

  async claimLootgenChatRowToInventory(lootId, rowId, {
    quiet = false,
    fromSocket = false,
    claimId = ""
  } = {}) {
    const safeLootId = String(lootId ?? "").trim();
    const safeRowId = String(rowId ?? "").trim();
    const safeClaimId = String(claimId ?? "").trim() || createSocketRequestId("loot-row-claim");
    if (!safeLootId || !safeRowId) {
      return false;
    }

    if (!game.user?.isGM) {
      if (!fromSocket) {
        this.#emitLootgenClaimRequest(SOCKET_EVENT_LOOTGEN_CLAIM_ROW_TO_INVENTORY, {
          lootId: safeLootId,
          rowId: safeRowId,
          claimId: safeClaimId
        });
      }
      ui.notifications?.info("Запрос на добавление добычи в склад отправлен мастеру.");
      return true;
    }
    if (!isActiveGmClient(game)) {
      throw new Error("Только активный мастер может добавлять добычу в склад.");
    }

    const message = this.#findLootgenChatMessage(safeLootId);
    if (!message) {
      return false;
    }
    const state = foundry.utils.deepClone(message.getFlag(MODULE_ID, "lootgenChat") ?? {});
    const row = (state.rows ?? []).find((entry) => String(entry.rowId ?? "") === safeRowId) ?? null;
    const claimed = await this.lootClaimService.claimRow({
      messageId: message.id,
      lootId: safeLootId,
      rowId: safeRowId,
      claimId: safeClaimId
    });
    if (claimed) {
      this.#notifyLootgenChatClaim(safeLootId, safeRowId, "row");
    }
    if (claimed && !quiet) {
      ui.notifications?.info(`Лут "${row?.name ?? "предмет"}" добавлен в партийный склад.`);
    }
    return claimed;
  }

  async claimLootgenChatAllToInventory(lootId, {
    quiet = false,
    fromSocket = false,
    claimId = ""
  } = {}) {
    const safeLootId = String(lootId ?? "").trim();
    if (!safeLootId) {
      return false;
    }

    const batchClaimId = String(claimId ?? "").trim() || createSocketRequestId("loot-all-claim");
    if (!game.user?.isGM) {
      if (!fromSocket) {
        this.#emitLootgenClaimRequest(SOCKET_EVENT_LOOTGEN_CLAIM_ALL_TO_INVENTORY, {
          lootId: safeLootId,
          claimId: batchClaimId
        });
      }
      ui.notifications?.info("Запрос на добавление всей добычи в склад отправлен мастеру.");
      return true;
    }
    if (!isActiveGmClient(game)) {
      throw new Error("Только активный мастер может добавлять добычу в склад.");
    }

    const message = this.#findLootgenChatMessage(safeLootId);
    const state = foundry.utils.deepClone(message?.getFlag(MODULE_ID, "lootgenChat") ?? {});
    const rows = Array.isArray(state.rows) ? state.rows : [];
    let claimedRows = 0;
    for (const row of rows) {
      if (row?.claimed) {
        continue;
      }

      const claimed = await this.claimLootgenChatRowToInventory(safeLootId, row.rowId, {
        quiet: true,
        fromSocket: true,
        claimId: `${batchClaimId}:row:${row.rowId}`
      });
      if (claimed) {
        claimedRows += 1;
      }
    }

    const claimedCoins = await this.claimLootgenChatCoins(safeLootId, {
      quiet: true,
      fromSocket: true,
      claimId: `${batchClaimId}:coins`
    });
    const changed = claimedRows > 0 || claimedCoins;
    if (changed && !quiet) {
      ui.notifications?.info("Вся доступная добыча добавлена в партийный склад.");
    }
    return changed;
  }

  async claimLootgenChatRow(lootId, rowId, { quiet = false, fromSocket = false } = {}) {
    const safeLootId = String(lootId ?? "").trim();
    const safeRowId = String(rowId ?? "").trim();
    if (!safeLootId || !safeRowId) {
      return false;
    }

    if (!game.user?.isGM) {
      if (!fromSocket) {
        this.#emitLootgenClaimRequest(SOCKET_EVENT_LOOTGEN_CLAIM_ROW, { lootId: safeLootId, rowId: safeRowId });
      }
      return true;
    }
    if (!isActiveGmClient(game)) {
      throw new Error("Только активный мастер может изменять состояние добычи.");
    }

    let claimedRow = null;
    const result = await this.#updateLootgenChatState(safeLootId, (state) => {
      const row = state.rows.find((entry) => String(entry.rowId ?? "") === safeRowId) ?? null;
      if (!row || row.claimed) {
        return false;
      }

      row.claimed = true;
      claimedRow = row;
      return true;
    });

    if (!result.changed || !claimedRow) {
      return false;
    }

    await this.inventoryService.deleteLootgenChatItem(claimedRow.itemUuid);
    this.#notifyLootgenChatClaim(safeLootId, safeRowId, "row");
    if (!quiet) {
      ui.notifications?.info(`Лут "${claimedRow.name}" отмечен как забранный.`);
    }
    return true;
  }

  async claimLootgenChatCoins(lootId, {
    quiet = false,
    fromSocket = false,
    claimId = ""
  } = {}) {
    const safeLootId = String(lootId ?? "").trim();
    const safeClaimId = String(claimId ?? "").trim() || createSocketRequestId("loot-coins-claim");
    if (!safeLootId) {
      return false;
    }

    if (!game.user?.isGM) {
      if (!fromSocket) {
        this.#emitLootgenClaimRequest(SOCKET_EVENT_LOOTGEN_CLAIM_COINS, {
          lootId: safeLootId,
          claimId: safeClaimId
        });
      }
      ui.notifications?.info("Запрос на добавление монет отправлен мастеру.");
      return true;
    }
    if (!isActiveGmClient(game)) {
      throw new Error("Только активный мастер может добавлять монеты в склад.");
    }

    const message = this.#findLootgenChatMessage(safeLootId);
    if (!message) {
      return false;
    }
    const claimed = await this.lootClaimService.claimCoins({
      messageId: message.id,
      lootId: safeLootId,
      claimId: safeClaimId
    });
    if (claimed) {
      this.#notifyLootgenChatClaim(safeLootId, "", "coins");
    }
    if (claimed && !quiet) {
      ui.notifications?.info("Монеты из чат-лута добавлены в партийный склад.");
    }
    return claimed;
  }

  async handleLootgenChatItemCreated(item, _userId) {
    const claim = item?.getFlag?.(MODULE_ID, "lootgenChat") ?? null;
    if (!claim?.lootId || !claim?.rowId) {
      return false;
    }

    if (item.parent instanceof Actor && item.parent.getFlag(MODULE_ID, "managedLootgenChatActor")) {
      return false;
    }

    const result = await this.claimLootgenChatRow(claim.lootId, claim.rowId, { quiet: true });
    try {
      await item.unsetFlag(MODULE_ID, "lootgenChat");
    }
    catch (_error) {
      // The claim is already processed; leaving the metadata is safer than failing the drop.
    }
    return result;
  }

  async restoreLootgenClearFromChat(messageId) {
    if (!game.user?.isGM) {
      throw new Error("Восстановить лутген может только ГМ.");
    }

    const message = game.messages.get(messageId) ?? null;
    const status = foundry.utils.deepClone(message?.getFlag(MODULE_ID, "lootgenStatus") ?? {});
    if (!message || status.action !== "clear" || status.restored) {
      return false;
    }

    const appKey = String(status.appKey ?? "");
    const payload = foundry.utils.deepClone(status.payload ?? {});
    const app = this.lootgenApps.get(appKey) ?? null;
    if (!app || typeof app.restoreGeneratedResult !== "function") {
      throw new Error("Окно лутгена для восстановления не найдено.");
    }

    app.restoreGeneratedResult(payload);
    status.restored = true;
    status.message = "Очистка лутгена отменена.";
    await message.update({
      content: buildLootgenStatusContent(status),
      [`flags.${MODULE_ID}.lootgenStatus`]: status
    });
    return true;
  }

  async #syncManagedCompendia(model) {
    this.traderService.invalidatePackCache();

    try {
      await this.materialsCompendium.sync(model.materials);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync materials compendium.`, error);
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.CompendiumSyncFailed"));
    }

    try {
      await this.gearCompendium.sync(model.gear);
      await registerRebreyaWeaponBaseItemsFromGearPack();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync gear compendium.`, error);
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.GearCompendiumSyncFailed"));
    }

    try {
      await this.magicItemsCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync magic items compendium.`, error);
      ui.notifications?.warn("Не удалось синхронизировать компендиум магических предметов.");
    }

    try {
      await this.featsCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync feats compendium.`, error);
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.FeatsCompendiumSyncFailed"));
    }

    try {
      await this.statesCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync states compendium.`, error);
      ui.notifications?.warn("Не удалось синхронизировать компендиум государств.");
    }

    try {
      await this.backgroundsCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync backgrounds compendium.`, error);
      ui.notifications?.warn("Не удалось синхронизировать компендиум предысторий.");
    }

    try {
      await this.racesCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync races compendium.`, error);
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.RacesCompendiumSyncFailed"));
    }

    try {
      await this.spellsCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync spells compendium.`, error);
      ui.notifications?.warn("Не удалось синхронизировать компендиум заклинаний Rebreya.");
    }

    try {
      await this.craftsmanConstructCompendium.sync();
      await this.classesCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync classes or Craftsman construct compendium.`, error);
      ui.notifications?.warn("Не удалось синхронизировать компендиумы классов, архетипов или Конструкта.");
    }

    try {
      await this.actionsCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync actions compendium.`, error);
      ui.notifications?.warn("Не удалось синхронизировать компендиум действий.");
    }

    try {
      await this.downtimeCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync downtime compendium.`, error);
      ui.notifications?.warn("Не удалось синхронизировать компендиум простоя.");
    }
  }

  async getModel(options = {}) {
    return this.repository.load(options);
  }

  initializeItem(item, options = {}) {
    return this.durabilityService.initializeItem(item, options);
  }

  damageItem(item, options = {}) {
    return this.durabilityService.damageItem(item, options);
  }

  damageItemPile(item, options = {}) {
    if (isActiveGmClient(globalThis.game)) {
      return this.durabilityService.damageItem(item, options);
    }
    const payload = {
      itemUuid: cleanSocketId(item?.uuid),
      amount: Number(options.amount),
      damageType: cleanSocketId(options.damageType),
      mutationId: cleanSocketId(options.mutationId) || createSocketRequestId("durability-pile")
    };
    if (!isValidItemPileDamagePayload(payload)) {
      throw new Error("Invalid Item Pile durability damage request.");
    }
    return this.socketCommandBus.request(ITEM_PILE_DAMAGE_COMMAND, payload);
  }

  breakItem(item, options = {}) {
    return this.durabilityService.breakItem(item, options);
  }

  destroyItem(item, options = {}) {
    return this.durabilityService.destroyItem(item, options);
  }

  getDurability(item) {
    return this.durabilityService.getDurability(item);
  }

  isBroken(item) {
    return this.durabilityService.isBroken(item);
  }

  getCombatStatusDefinitions() {
    return this.combatStatusService.getStatusDefinitions();
  }

  normalizeCombatStatusId(statusInput, fallback = "") {
    return this.combatStatusService.normalizeStatusId(statusInput, fallback);
  }

  getCombatStatus(actorOrId, statusInput) {
    return this.combatStatusService.getStatus(actorOrId, statusInput);
  }

  async setCombatStatus(actorOrId, statusInput, options = {}) {
    const actor = typeof actorOrId === "string" ? resolveActorById(actorOrId) : actorOrId;
    if (this.#shouldRouteCombatStatus(actor, statusInput, options)) {
      const result = await this.#requestCombatStatusSet(actor, statusInput, options);
      await this.refreshOpenApps();
      return result;
    }

    const result = await this.combatStatusService.setStatus(actorOrId, statusInput, options);
    await this.refreshOpenApps();
    return result;
  }

  async clearCombatStatus(actorOrId, statusInput, options = {}) {
    const actor = typeof actorOrId === "string" ? resolveActorById(actorOrId) : actorOrId;
    const routeOptions = {
      ...options,
      active: false
    };
    if (this.#shouldRouteCombatStatus(actor, statusInput, routeOptions)) {
      const result = await this.#requestCombatStatusSet(actor, statusInput, routeOptions);
      await this.refreshOpenApps();
      return result;
    }

    const result = await this.combatStatusService.clearStatus(actorOrId, statusInput, options);
    await this.refreshOpenApps();
    return result;
  }

  async setCombatStatusValue(actorOrId, statusInput, value, meta = undefined) {
    const result = await this.combatStatusService.setStatusValue(actorOrId, statusInput, value, meta);
    await this.refreshOpenApps();
    return result;
  }

  async applyDecayingDamage(actorOrId, amount, options = {}) {
    const result = await this.combatStatusService.applyDecayingDamage(actorOrId, amount, options);
    await this.refreshOpenApps();
    return result;
  }

  async syncBloodiedStatuses() {
    const result = await this.combatStatusService.syncBloodiedForAllActors();
    await this.refreshOpenApps();
    return result;
  }

  resolveReactionTrigger(request = {}) {
    return this.reactionQueueService.resolve(request);
  }

  registerReactionType(kind, provider) {
    return this.reactionQueueService.registerType(kind, provider);
  }

  registerReactionCapability(kind, resolver, options = {}) {
    return this.reactionCapabilityIndex.registerProvider(kind, resolver, options);
  }

  invalidateReactionActor(actor) {
    return this.reactionCapabilityIndex.refreshActor(actor);
  }

  getReactionState(actorOrId) {
    return this.combatAttackService.getReactionState(actorOrId);
  }

  canUseReaction(actorOrId, requiredUses = 1) {
    return this.combatAttackService.canUseReaction(actorOrId, requiredUses);
  }

  async refreshReaction(actorOrId, options = {}) {
    const result = await this.combatAttackService.refreshReaction(actorOrId, options);
    await this.refreshOpenApps();
    return result;
  }

  async consumeReaction(actorOrId, options = {}) {
    const result = await this.combatAttackService.consumeReaction(actorOrId, options);
    await this.refreshOpenApps();
    return result;
  }

  async rollWeaponAttack(actorOrId, weaponOrId, options = {}) {
    return this.combatAttackService.rollWeaponAttack(actorOrId, weaponOrId, options);
  }

  async rollFirearmAttack(actorOrId, weaponOrId, options = {}) {
    return this.combatAttackService.rollFirearmAttack(actorOrId, weaponOrId, options);
  }

  async clearFirearmJam(actorOrItem, weaponOrId = null) {
    const result = await this.combatAttackService.clearFirearmJam(actorOrItem, weaponOrId);
    await this.refreshOpenApps();
    return result;
  }

  async maintainFirearm(actorOrItem, weaponOrId = null, options = {}) {
    const result = await this.combatAttackService.maintainFirearm(actorOrItem, weaponOrId, options);
    await this.refreshOpenApps();
    return result;
  }

  async resolveProvokedAttack(reactorOrId, targetOrId, options = {}) {
    return this.combatAttackService.resolveProvokedAttack(reactorOrId, targetOrId, options);
  }

  async resolveParry(defenderOrId, incomingAttackTotal, options = {}) {
    return this.combatAttackService.resolveParry(defenderOrId, incomingAttackTotal, options);
  }

  async resolveInterception(guardianOrId, targetOrId, incomingDamage, options = {}) {
    return this.combatAttackService.resolveInterception(guardianOrId, targetOrId, incomingDamage, options);
  }

  async handleGlobalEventsConfigChange() {
    await this.repository.rebuildModel();
    await this.refreshOpenApps();
    return this.repository.model;
  }

  getAllGlobalEvents() {
    return this.globalEventsService.getAllGlobalEvents();
  }

  getActiveGlobalEvents(currentDate = null) {
    const safeDate = currentDate ?? this.calendarService.getSnapshot()?.isoDate ?? null;
    return filterVisibleGlobalEvents(this.globalEventsService.getActiveGlobalEvents(safeDate));
  }

  getEventsAffectingCity(cityId, currentDate = null) {
    return filterVisibleGlobalEvents(
      this.globalEventsService.getEventsAffectingCity(cityId, currentDate, this.repository.dataset ?? null)
    );
  }

  getEventsAffectingCityGood(cityId, goodId, currentDate = null) {
    return filterVisibleGlobalEvents(
      this.globalEventsService.getEventsAffectingCityGood(cityId, goodId, currentDate, this.repository.dataset ?? null)
    );
  }

  getEventsAffectingRoute(fromCityId, toCityId, currentDate = null, connectionId = "") {
    return filterVisibleGlobalEvents(this.globalEventsService.getEventsAffectingRoute(
      fromCityId,
      toCityId,
      currentDate,
      this.repository.dataset ?? null,
      connectionId
    ));
  }

  getEventsAffectingState(stateId, currentDate = null) {
    return filterVisibleGlobalEvents(
      this.globalEventsService.getEventsAffectingState(stateId, currentDate, this.repository.dataset ?? null)
    );
  }

  getEffectiveStatePolicy(stateId, targetStateId = null, currentDate = null) {
    const basePolicy = this.repository.getStatePolicy(stateId);
    const effective = this.globalEventsService.getEffectiveStatePolicy(
      basePolicy,
      stateId,
      currentDate ?? this.calendarService.getSnapshot()?.isoDate ?? null,
      this.repository.dataset ?? null
    );

    if (targetStateId) {
      return {
        ...effective,
        resolvedBilateralDuty: toNumber(effective?.bilateralDuties?.[targetStateId], 0)
      };
    }

    return effective;
  }

  async createGlobalEvent(data = {}) {
    const event = await this.globalEventsService.createGlobalEvent(data);
    if (this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }
    await this.refreshOpenApps();
    return event;
  }

  async updateGlobalEvent(id, patch = {}) {
    const event = await this.globalEventsService.updateGlobalEvent(id, patch);
    if (this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }
    await this.refreshOpenApps();
    return event;
  }

  async deleteGlobalEvent(id) {
    const result = await this.globalEventsService.deleteGlobalEvent(id);
    if (this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }
    await this.refreshOpenApps();
    return result;
  }

  async duplicateGlobalEvent(id) {
    const duplicate = await this.globalEventsService.duplicateGlobalEvent(id);
    if (this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }
    await this.refreshOpenApps();
    return duplicate;
  }

  async importDefaultGlobalEventTemplates() {
    const imported = await this.globalEventsService.importDefaultGlobalEventTemplates();
    if (this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }
    await this.refreshOpenApps();
    return imported;
  }

  getCitySnapshot(cityId) {
    return this.repository.getCitySnapshot(cityId);
  }

  getTradeRouteSnapshot(connectionId) {
    return this.repository.getTradeRoute(connectionId);
  }

  getTradeRouteBaseSnapshot(connectionId) {
    return this.repository.getTradeRouteBase(connectionId);
  }

  getTradeRoutes() {
    return this.repository.getTradeRoutes();
  }

  hasTradeRouteAnalytics() {
    return this.repository.hasTradeRouteAnalytics();
  }

  async prepareTradeRouteAnalytics({ rerender = false } = {}) {
    await this.repository.prepareTradeRouteAnalytics();
    if (rerender) {
      await this.refreshOpenApps();
    }

    return this.repository.getTradeRoutes();
  }

  getReferenceEntrySnapshot(entryType, entryId) {
    return this.repository.getReferenceEntry(entryType, entryId);
  }

  getStatePolicies() {
    return this.repository.getStatePolicies();
  }

  async setConnectionActive(connectionId, isActive) {
    await this.repository.setConnectionActive(connectionId, isActive);
    await this.refreshOpenApps();
    return this.repository.model;
  }

  async updateReferenceDescription(entryType, entryId, description) {
    await this.repository.setReferenceNote(`${entryType}::${entryId}`, description);
    await this.refreshOpenApps();
    return this.getReferenceEntrySnapshot(entryType, entryId);
  }

  async updateTradeRouteMetadata(connectionId, patch) {
    const route = await this.repository.setTradeRouteOverride(connectionId, patch);
    await this.refreshOpenApps();
    return route;
  }

  async updateStatePolicy(stateId, patch) {
    const policy = await this.repository.setStatePolicy(stateId, patch);
    await this.refreshOpenApps();
    return policy;
  }

  async resetWorldData({ notify = false } = {}) {
    await this.traderService.resetState();
    const model = await this.repository.resetWorldData();
    if (notify) {
      ui.notifications?.info(game.i18n.localize("REBREYA_MAIN.Notifications.DataRestored"));
    }

    await this.refreshOpenApps();
    return model;
  }

  getMaterialByGoodId(goodId) {
    return this.repository.getMaterialByGoodId(goodId);
  }

  isTraderIntegrationAvailable() {
    return this.traderService.isAvailable();
  }

  async getCityTraderSummaries(cityId) {
    return this.traderService.getCityTraderSummaries(cityId);
  }

  async getTraderSnapshot(cityId, traderKey, options = {}) {
    return this.traderService.getTraderSnapshot(cityId, traderKey, options);
  }

  async purchaseTraderItem(cityId, traderKey, itemKey, quantity, options = {}) {
    const transactionId = options.transactionId ?? createTradeTransactionId("purchase");
    const actorId = String(options.actorId ?? "").trim();
    const payload = {
      transactionId,
      legacy: false,
      actorId,
      cityId,
      traderKey,
      itemKey,
      quantity
    };
    if (!isValidTraderPurchasePayload(payload)) {
      throw new Error("Invalid trader purchase request");
    }
    if (isActiveGmClient(globalThis.game)) {
      return this.tradeTransactionService.purchase({
        transactionId,
        actorId,
        cityId,
        traderKey,
        itemKey,
        quantity,
        requestedByUserId: String(globalThis.game?.user?.id ?? "")
      }, { source: "direct-active-gm" });
    }
    return this.socketCommandBus.request(TRADER_PURCHASE_COMMAND, payload);
  }

  async createTraderSalePreview(cityId, traderKey, dropData) {
    return this.traderService.createSalePreview(cityId, traderKey, dropData);
  }

  async sellTraderItem(cityId, traderKey, preview, quantity, options = {}) {
    const transactionId = options.transactionId ?? createTradeTransactionId("sale");
    const payload = {
      transactionId,
      actorId: String(options.actorId ?? preview?.actorId ?? "").trim(),
      cityId,
      traderKey,
      itemUuid: String(preview?.itemUuid ?? "").trim(),
      quantity
    };
    if (!isValidTraderSalePayload(payload)) {
      throw new Error("Invalid trader sale request");
    }
    if (isActiveGmClient(globalThis.game)) {
      return this.tradeTransactionService.sale({
        ...payload,
        requestedByUserId: String(globalThis.game?.user?.id ?? "")
      }, { source: "direct-active-gm" });
    }
    return this.socketCommandBus.request(TRADER_SELL_COMMAND, payload);
  }

  async recordTraderAudit(operation = {}) {
    if (game.user?.isGM) {
      const record = await this.traderService.recordTradeAudit(operation, {
        senderId: operation.senderId ?? game.user?.id ?? ""
      });
      await this.refreshOpenApps();
      return record;
    }

    game.socket?.emit?.(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_TRADER_AUDIT,
      payload: foundry.utils.deepClone(operation),
      senderId: game.user?.id ?? ""
    });
    return null;
  }

  getTradeAuditLog() {
    return this.traderService.getTradeAuditLog();
  }

  async rollbackTraderAuditEntry(entryId, options = {}) {
    if (!globalThis.game?.user?.isGM || !isActiveGmClient(globalThis.game)) {
      throw new Error("Trader rollback requires the active GM client");
    }
    const rollbackTransactionId = options.rollbackTransactionId
      ?? createTradeTransactionId("rollback");
    const result = await this.traderService.rollbackTradeAuditEntry(entryId, {
      rollbackTransactionId,
      requestedByUserId: String(globalThis.game.user.id ?? "")
    });
    await this.refreshOpenApps();
    return result;
  }

  async updateTraderMetadata(cityId, traderKey, patch) {
    const trader = await this.traderService.updateTraderMetadata(cityId, traderKey, patch);
    await this.refreshOpenApps();
    return trader;
  }

  async getInventorySnapshot(options = {}) {
    return this.inventoryService.getInventorySnapshot(options);
  }

  async getPartySnapshot(options = {}) {
    return this.inventoryService.getPartySnapshot(options);
  }

  async getTravelSnapshot() {
    return this.travelService.getSnapshot();
  }

  getGroupRegistry() {
    return this.groupContextService.getRegistry();
  }

  getGroupContext(options = {}) {
    if (options?.groupActorId) {
      return this.groupContextService.resolveForGroup(options.groupActorId);
    }
    return this.groupContextService.resolveForCurrentUser();
  }

  getDowntimeSnapshot(options = {}) {
    return this.downtimeService.getSnapshot(options);
  }

  async grantDowntimeWeeks(payload = {}) {
    const result = await this.downtimeService.grantWeeks(payload);
    this.#emitDowntimeUpdated({
      actorIds: result.actorIds
    });
    await this.refreshDowntimeViews({ actorIds: result.actorIds });
    return result;
  }

  async revokeDowntimeWeeks(payload = {}) {
    const result = await this.downtimeService.revokeWeeks(payload);
    this.#emitDowntimeUpdated({
      actorIds: result.actorIds
    });
    await this.refreshDowntimeViews({ actorIds: result.actorIds });
    return result;
  }

  async clearDowntimeHistory() {
    const result = await this.downtimeService.clearHistory();
    this.#emitDowntimeUpdated({
      actorIds: result.actorIds
    });
    await this.refreshDowntimeViews({ actorIds: result.actorIds });
    return result;
  }

  async createDowntimeRequest(payload = {}, { refreshActorSheets = true } = {}) {
    if (!game.user?.isGM) {
      return this.#requestDowntimeCreateViaGm(payload);
    }

    const validatedPayload = await this.#prepareDowntimeCraftPayload(payload);
    const result = await this.downtimeService.createRequest(validatedPayload);
    this.#emitDowntimeUpdated({
      actorIds: [result.actorId],
      requestId: result.id
    });
    await this.refreshDowntimeViews({
      actorIds: refreshActorSheets ? [result.actorId] : []
    });
    return result;
  }

  async updateDowntimeRequest(payload = {}, { refreshActorSheets = true } = {}) {
    if (!game.user?.isGM) {
      return this.#requestDowntimeUpdateViaGm(payload);
    }

    const validatedPayload = await this.#prepareDowntimeCraftPayload(payload);
    const result = await this.downtimeService.updateRequest(validatedPayload);
    this.#emitDowntimeUpdated({
      actorIds: [result.actorId],
      requestId: result.id
    });
    await this.refreshDowntimeViews({
      actorIds: refreshActorSheets ? [result.actorId] : []
    });
    return result;
  }

  previewCraftDowntimeRequest(payload = {}) {
    return this.craftingService.previewRequest(payload);
  }

  async #prepareDowntimeCraftPayload(payload = {}) {
    const safePayload = cloneSocketPayload(payload);
    const craftProject = safePayload.craftProject && typeof safePayload.craftProject === "object"
      ? safePayload.craftProject
      : null;
    if (!craftProject || Object.keys(craftProject).length === 0) {
      return safePayload;
    }

    const preview = await this.previewCraftDowntimeRequest({
      groupId: cleanSocketId(safePayload.groupId),
      actorId: cleanSocketId(safePayload.actorId),
      craftProject
    });
    if (!preview || preview.canSubmit !== true) {
      throw new Error(
        String(preview?.message ?? preview?.errors?.[0]?.message ?? "Craft request validation failed.").trim()
      );
    }
    return {
      ...safePayload,
      weeks: Math.max(1, Math.floor(Number(preview.requiredDowntimeWeeks) || 1)),
      craftProject: {
        ...craftProject,
        requiredWorkdays: Math.max(1, Math.floor(Number(preview.requiredWorkdays) || 1)),
        requiredDowntimeWeeks: Math.max(1, Math.floor(Number(preview.requiredDowntimeWeeks) || 1)),
        calendarWeeks: Math.max(1, Math.floor(Number(preview.calendarWeeks) || 1)),
        dailyProgressGold: Math.max(0, Number(preview.dailyProgressGold) || 0)
      }
    };
  }

  async #requestDowntimeCreateViaGm(payload = {}) {
    if (typeof game.socket?.emit !== "function") {
      throw new Error("Сокет Foundry недоступен для отправки заявки мастеру.");
    }

    const requestId = createSocketRequestId("downtime-create");
    const safePayload = cloneSocketPayload(payload);
    safePayload.actorId = cleanSocketId(safePayload.actorId);
    safePayload.groupId = cleanSocketId(safePayload.groupId);

    game.socket.emit(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_DOWNTIME_CREATE_REQUEST,
      requestId,
      senderId: game.user?.id ?? "",
      payload: safePayload
    });
    return {
      ...safePayload,
      requestId,
      queued: true
    };
  }

  async #requestDowntimeUpdateViaGm(payload = {}) {
    if (typeof game.socket?.emit !== "function") {
      throw new Error("Сокет Foundry недоступен для обновления заявки мастеру.");
    }

    const requestId = createSocketRequestId("downtime-update");
    const safePayload = cloneSocketPayload(payload);
    safePayload.actorId = cleanSocketId(safePayload.actorId);
    safePayload.groupId = cleanSocketId(safePayload.groupId);
    safePayload.requestId = cleanSocketId(safePayload.requestId);

    game.socket.emit(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_DOWNTIME_UPDATE_REQUEST,
      requestId,
      senderId: game.user?.id ?? "",
      payload: safePayload
    });
    return {
      ...safePayload,
      socketRequestId: requestId,
      queued: true
    };
  }

  async #handleDowntimeCreateSocketResult(message = {}) {
    const forUserId = cleanSocketId(message.forUserId);
    if (forUserId && forUserId !== cleanSocketId(game.user?.id)) {
      return;
    }

    if (message.ok === false) {
      ui.notifications?.error(String(message.error ?? "").trim() || "Мастер отклонил создание заявки простоя.");
      return;
    }

  }

  async #handleDowntimeUpdateSocketResult(message = {}) {
    const forUserId = cleanSocketId(message.forUserId);
    if (forUserId && forUserId !== cleanSocketId(game.user?.id)) {
      return;
    }

    if (message.ok === false) {
      ui.notifications?.error(String(message.error ?? "").trim() || "Мастер отклонил обновление заявки простоя.");
      return;
    }

  }

  async #handleDowntimeUpdatedSocketMessage(message = {}) {
    await this.refreshDowntimeViews({ actorIds: message.actorIds });
  }

  async #refreshDowntimeViewsSafely(options = {}) {
    try {
      await this.refreshDowntimeViews(options);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to refresh downtime views after a committed socket mutation.`, error);
    }
  }

  async #handleDowntimeCreateSocketRequest(message = {}) {
    const requestId = cleanSocketId(message.requestId);
    const forUserId = cleanSocketId(message.senderId);

    try {
      const result = await this.#createDowntimeRequestFromSocket(message.payload ?? {}, {
        senderId: forUserId
      });
      globalThis.ui?.notifications?.info?.(`Rebreya: заявка на простой от ${result.actorName ?? result.actorId ?? "игрока"}.`);

      if (requestId) {
        game.socket?.emit?.(SOCKET_CHANNEL, {
          type: SOCKET_EVENT_DOWNTIME_CREATE_RESULT,
          requestId,
          forUserId,
          senderId: game.user?.id ?? "",
          ok: true,
          data: cloneSocketPayload(result)
        });
      }

      this.#emitDowntimeUpdated({
        actorIds: [result.actorId],
        requestId: result.id
      });
      await this.#refreshDowntimeViewsSafely({ actorIds: [result.actorId] });
    }
    catch (error) {
      if (requestId) {
        game.socket?.emit?.(SOCKET_CHANNEL, {
          type: SOCKET_EVENT_DOWNTIME_CREATE_RESULT,
          requestId,
          forUserId,
          senderId: game.user?.id ?? "",
          ok: false,
          error: error?.message ?? String(error)
        });
        return;
      }

      throw error;
    }
  }

  async #handleDowntimeUpdateSocketRequest(message = {}) {
    const requestId = cleanSocketId(message.requestId);
    const forUserId = cleanSocketId(message.senderId);

    try {
      const result = await this.#updateDowntimeRequestFromSocket(message.payload ?? {}, {
        senderId: forUserId
      });

      if (requestId) {
        game.socket?.emit?.(SOCKET_CHANNEL, {
          type: SOCKET_EVENT_DOWNTIME_UPDATE_RESULT,
          requestId,
          forUserId,
          senderId: game.user?.id ?? "",
          ok: true,
          data: cloneSocketPayload(result)
        });
      }

      this.#emitDowntimeUpdated({
        actorIds: [result.actorId],
        requestId: result.id
      });
      await this.#refreshDowntimeViewsSafely({ actorIds: [result.actorId] });
    }
    catch (error) {
      if (requestId) {
        game.socket?.emit?.(SOCKET_CHANNEL, {
          type: SOCKET_EVENT_DOWNTIME_UPDATE_RESULT,
          requestId,
          forUserId,
          senderId: game.user?.id ?? "",
          ok: false,
          error: error?.message ?? String(error)
        });
        return;
      }

      throw error;
    }
  }

  async #createDowntimeRequestFromSocket(payload = {}, { senderId = "" } = {}) {
    const senderUser = getUserById(senderId);
    if (!senderUser) {
      throw new Error("Игрок для заявки простоя не найден.");
    }

    const groupId = cleanSocketId(payload.groupId);
    if (!groupId) {
      throw new Error("Группа заявки простоя не найдена.");
    }

    const context = this.groupContextService.resolveForGroup(groupId);
    const actorId = cleanSocketId(payload.actorId);
    const actor = Array.from(context.members ?? []).find((memberActor) => memberActor?.id === actorId) ?? null;
    if (!actor) {
      throw new Error("Персонаж заявки простоя не найден в группе.");
    }

    if (!isActorOwnedByUser(actor, senderUser)) {
      throw new Error("Игрок может отправлять простой только за своего персонажа.");
    }

    const validatedPayload = await this.#prepareDowntimeCraftPayload({
      ...cloneSocketPayload(payload),
      groupId,
      actorId,
      submittedByUserId: senderUser.id
    });
    const result = await this.downtimeService.createRequest(validatedPayload);
    return result;
  }

  async #updateDowntimeRequestFromSocket(payload = {}, { senderId = "" } = {}) {
    const senderUser = getUserById(senderId);
    if (!senderUser) {
      throw new Error("Игрок для обновления заявки простоя не найден.");
    }

    const groupId = cleanSocketId(payload.groupId);
    if (!groupId) {
      throw new Error("Группа заявки простоя не найдена.");
    }

    const context = this.groupContextService.resolveForGroup(groupId);
    const actorId = cleanSocketId(payload.actorId);
    const actor = Array.from(context.members ?? []).find((memberActor) => memberActor?.id === actorId) ?? null;
    if (!actor) {
      throw new Error("Персонаж заявки простоя не найден в группе.");
    }

    if (!isActorOwnedByUser(actor, senderUser)) {
      throw new Error("Игрок может обновлять простой только за своего персонажа.");
    }

    const validatedPayload = await this.#prepareDowntimeCraftPayload({
      ...cloneSocketPayload(payload),
      groupId,
      actorId
    });
    return this.downtimeService.updateRequest(validatedPayload);
  }

  async #requestDowntimeCheckResultViaGm(requestId, checkId, result = {}, options = {}) {
    if (typeof game.socket?.emit !== "function") {
      throw new Error("Сокет Foundry недоступен для записи результата простоя.");
    }

    const socketRequestId = createSocketRequestId("downtime-check-result");
    const payload = {
      groupId: cleanSocketId(options.groupId),
      actorId: cleanSocketId(options.actorId),
      requestId: cleanSocketId(requestId),
      checkId: cleanSocketId(checkId),
      result: cloneSocketPayload(result)
    };

    game.socket.emit(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_DOWNTIME_CHECK_RESULT_REQUEST,
      requestId: socketRequestId,
      senderId: game.user?.id ?? "",
      payload
    });
    return {
      requestId: payload.requestId,
      checkId: payload.checkId,
      socketRequestId,
      queued: true
    };
  }

  async #handleDowntimeCheckResultSocketResult(message = {}) {
    const forUserId = cleanSocketId(message.forUserId);
    if (forUserId && forUserId !== cleanSocketId(game.user?.id)) {
      return;
    }

    if (message.ok === false) {
      ui.notifications?.error(String(message.error ?? "").trim() || "Мастер отклонил запись результата простоя.");
      return;
    }

  }

  async #handleDowntimeCheckResultSocketRequest(message = {}) {
    const requestId = cleanSocketId(message.requestId);
    const forUserId = cleanSocketId(message.senderId);

    try {
      const result = await this.#recordDowntimeCheckResultFromSocket(message.payload ?? {}, {
        senderId: forUserId
      });

      if (requestId) {
        game.socket?.emit?.(SOCKET_CHANNEL, {
          type: SOCKET_EVENT_DOWNTIME_CHECK_RESULT_RESULT,
          requestId,
          forUserId,
          senderId: game.user?.id ?? "",
          ok: true,
          data: cloneSocketPayload(result)
        });
      }

      this.#emitDowntimeUpdated({
        actorIds: [result.actorId],
        requestId: result.id
      });
      await this.#refreshDowntimeViewsSafely({ actorIds: [result.actorId] });
    }
    catch (error) {
      if (requestId) {
        game.socket?.emit?.(SOCKET_CHANNEL, {
          type: SOCKET_EVENT_DOWNTIME_CHECK_RESULT_RESULT,
          requestId,
          forUserId,
          senderId: game.user?.id ?? "",
          ok: false,
          error: error?.message ?? String(error)
        });
        return;
      }

      throw error;
    }
  }

  async #recordDowntimeCheckResultFromSocket(payload = {}, { senderId = "" } = {}) {
    const senderUser = getUserById(senderId);
    if (!senderUser) {
      throw new Error("Игрок для результата простоя не найден.");
    }

    const groupId = cleanSocketId(payload.groupId);
    if (!groupId) {
      throw new Error("Группа результата простоя не найдена.");
    }

    const context = this.groupContextService.resolveForGroup(groupId);
    const actorId = cleanSocketId(payload.actorId);
    const actor = Array.from(context.members ?? []).find((memberActor) => memberActor?.id === actorId) ?? null;
    if (!actor) {
      throw new Error("Персонаж результата простоя не найден в группе.");
    }

    if (!isActorOwnedByUser(actor, senderUser)) {
      throw new Error("Игрок может записывать результат простоя только за своего персонажа.");
    }

    return this.downtimeService.recordCheckResult(
      cleanSocketId(payload.requestId),
      cleanSocketId(payload.checkId),
      {
        ...cloneSocketPayload(payload.result ?? {}),
        recordedByUserId: senderUser.id
      },
      {
        groupId,
        actorId
      }
    );
  }

  async continueDowntimeProject({ requestId = "", groupId = "", actorId = "", checkId = "", result = {} } = {}) {
    if (!game.user?.isGM) {
      return this.#requestDowntimeProjectContinueViaGm({ requestId, groupId, actorId, checkId, result });
    }

    const options = {
      actorId: cleanSocketId(actorId),
      checkId: cleanSocketId(checkId),
      result: cloneSocketPayload(result)
    };
    const safeGroupId = cleanSocketId(groupId);
    if (safeGroupId) {
      options.groupId = safeGroupId;
    }

    const continuedRequest = await this.downtimeService.continueProject(cleanSocketId(requestId), options);
    this.#emitDowntimeUpdated({
      actorIds: [continuedRequest.actorId],
      requestId: continuedRequest.id
    });
    await this.refreshDowntimeViews({ actorIds: [continuedRequest.actorId] });
    return continuedRequest;
  }

  async #requestDowntimeProjectContinueViaGm({ requestId = "", groupId = "", actorId = "", checkId = "", result = {} } = {}) {
    if (typeof game.socket?.emit !== "function") {
      throw new Error("Сокет Foundry недоступен для продолжения проекта.");
    }

    const socketRequestId = createSocketRequestId("downtime-project-continue");
    const payload = {
      groupId: cleanSocketId(groupId),
      actorId: cleanSocketId(actorId),
      requestId: cleanSocketId(requestId),
      checkId: cleanSocketId(checkId),
      result: cloneSocketPayload(result)
    };

    game.socket.emit(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_DOWNTIME_PROJECT_CONTINUE_REQUEST,
      requestId: socketRequestId,
      senderId: game.user?.id ?? "",
      payload
    });
    return {
      ...payload,
      socketRequestId,
      queued: true
    };
  }

  async #handleDowntimeProjectContinueSocketResult(message = {}) {
    const forUserId = cleanSocketId(message.forUserId);
    if (forUserId && forUserId !== cleanSocketId(game.user?.id)) {
      return;
    }

    if (message.ok === false) {
      ui.notifications?.error(String(message.error ?? "").trim() || "Мастер отклонил продолжение проекта.");
      return;
    }

  }

  async #handleDowntimeProjectContinueSocketRequest(message = {}) {
    const requestId = cleanSocketId(message.requestId);
    const forUserId = cleanSocketId(message.senderId);

    try {
      const result = await this.#continueDowntimeProjectFromSocket(message.payload ?? {}, {
        senderId: forUserId
      });

      if (requestId) {
        game.socket?.emit?.(SOCKET_CHANNEL, {
          type: SOCKET_EVENT_DOWNTIME_PROJECT_CONTINUE_RESULT,
          requestId,
          forUserId,
          senderId: game.user?.id ?? "",
          ok: true,
          data: cloneSocketPayload(result)
        });
      }

      this.#emitDowntimeUpdated({
        actorIds: [result.actorId],
        requestId: result.id
      });
      await this.#refreshDowntimeViewsSafely({ actorIds: [result.actorId] });
    }
    catch (error) {
      if (requestId) {
        game.socket?.emit?.(SOCKET_CHANNEL, {
          type: SOCKET_EVENT_DOWNTIME_PROJECT_CONTINUE_RESULT,
          requestId,
          forUserId,
          senderId: game.user?.id ?? "",
          ok: false,
          error: error?.message ?? String(error)
        });
        return;
      }

      throw error;
    }
  }

  async #continueDowntimeProjectFromSocket(payload = {}, { senderId = "" } = {}) {
    const senderUser = getUserById(senderId);
    if (!senderUser) {
      throw new Error("Игрок для продолжения проекта не найден.");
    }

    const groupId = cleanSocketId(payload.groupId);
    if (!groupId) {
      throw new Error("Группа проекта не найдена.");
    }

    const context = this.groupContextService.resolveForGroup(groupId);
    const actorId = cleanSocketId(payload.actorId);
    const actor = Array.from(context.members ?? []).find((memberActor) => memberActor?.id === actorId) ?? null;
    if (!actor) {
      throw new Error("Персонаж проекта не найден в группе.");
    }

    if (!isActorOwnedByUser(actor, senderUser)) {
      throw new Error("Игрок может продолжать проект только своего персонажа.");
    }

    return this.downtimeService.continueProject(cleanSocketId(payload.requestId), {
      groupId,
      actorId,
      checkId: cleanSocketId(payload.checkId),
      result: {
        ...cloneSocketPayload(payload.result ?? {}),
        recordedByUserId: senderUser.id
      }
    });
  }

  async closeDowntimeProject({ requestId = "", groupId = "", actorId = "" } = {}) {
    if (!game.user?.isGM) {
      return this.#requestDowntimeProjectCloseViaGm({ requestId, groupId, actorId });
    }

    const options = {
      actorId: cleanSocketId(actorId)
    };
    const safeGroupId = cleanSocketId(groupId);
    if (safeGroupId) {
      options.groupId = safeGroupId;
    }

    const result = await this.downtimeService.closeProject(cleanSocketId(requestId), options);
    this.#emitDowntimeUpdated({
      actorIds: [result.actorId],
      requestId: result.id
    });
    await this.refreshDowntimeViews({ actorIds: [result.actorId] });
    return result;
  }

  async #requestDowntimeProjectCloseViaGm({ requestId = "", groupId = "", actorId = "" } = {}) {
    if (typeof game.socket?.emit !== "function") {
      throw new Error("Сокет Foundry недоступен для закрытия проекта.");
    }

    const socketRequestId = createSocketRequestId("downtime-project-close");
    const payload = {
      groupId: cleanSocketId(groupId),
      actorId: cleanSocketId(actorId),
      requestId: cleanSocketId(requestId)
    };

    game.socket.emit(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_DOWNTIME_PROJECT_CLOSE_REQUEST,
      requestId: socketRequestId,
      senderId: game.user?.id ?? "",
      payload
    });
    return {
      ...payload,
      socketRequestId,
      queued: true
    };
  }

  async #handleDowntimeProjectCloseSocketResult(message = {}) {
    const forUserId = cleanSocketId(message.forUserId);
    if (forUserId && forUserId !== cleanSocketId(game.user?.id)) {
      return;
    }

    if (message.ok === false) {
      ui.notifications?.error(String(message.error ?? "").trim() || "Мастер отклонил закрытие проекта.");
      return;
    }

  }

  async #handleDowntimeProjectCloseSocketRequest(message = {}) {
    const requestId = cleanSocketId(message.requestId);
    const forUserId = cleanSocketId(message.senderId);

    try {
      const result = await this.#closeDowntimeProjectFromSocket(message.payload ?? {}, {
        senderId: forUserId
      });

      if (requestId) {
        game.socket?.emit?.(SOCKET_CHANNEL, {
          type: SOCKET_EVENT_DOWNTIME_PROJECT_CLOSE_RESULT,
          requestId,
          forUserId,
          senderId: game.user?.id ?? "",
          ok: true,
          data: cloneSocketPayload(result)
        });
      }

      this.#emitDowntimeUpdated({
        actorIds: [result.actorId],
        requestId: result.id
      });
      await this.#refreshDowntimeViewsSafely({ actorIds: [result.actorId] });
    }
    catch (error) {
      if (requestId) {
        game.socket?.emit?.(SOCKET_CHANNEL, {
          type: SOCKET_EVENT_DOWNTIME_PROJECT_CLOSE_RESULT,
          requestId,
          forUserId,
          senderId: game.user?.id ?? "",
          ok: false,
          error: error?.message ?? String(error)
        });
        return;
      }

      throw error;
    }
  }

  async #closeDowntimeProjectFromSocket(payload = {}, { senderId = "" } = {}) {
    const senderUser = getUserById(senderId);
    if (!senderUser) {
      throw new Error("Игрок для закрытия проекта не найден.");
    }

    const groupId = cleanSocketId(payload.groupId);
    if (!groupId) {
      throw new Error("Группа проекта не найдена.");
    }

    const context = this.groupContextService.resolveForGroup(groupId);
    const actorId = cleanSocketId(payload.actorId);
    const actor = Array.from(context.members ?? []).find((memberActor) => memberActor?.id === actorId) ?? null;
    if (!actor) {
      throw new Error("Персонаж проекта не найден в группе.");
    }

    if (!isActorOwnedByUser(actor, senderUser)) {
      throw new Error("Игрок может закрывать проект только своего персонажа.");
    }

    return this.downtimeService.closeProject(cleanSocketId(payload.requestId), {
      groupId,
      actorId
    });
  }

  #normalizeDowntimeActorIds(actorIds = []) {
    const ids = Array.isArray(actorIds) ? actorIds : [actorIds];
    return [...new Set(ids.map((actorId) => cleanSocketId(actorId)).filter(Boolean))];
  }

  #emitDowntimeUpdated({ actorIds = [], requestId = "" } = {}) {
    if (typeof game.socket?.emit !== "function") {
      return;
    }

    const safeActorIds = this.#normalizeDowntimeActorIds(actorIds);
    if (!safeActorIds.length) {
      return;
    }

    const message = {
      type: SOCKET_EVENT_DOWNTIME_UPDATED,
      senderId: game.user?.id ?? "",
      actorIds: safeActorIds
    };
    const safeRequestId = cleanSocketId(requestId);
    if (safeRequestId) {
      message.requestId = safeRequestId;
    }

    game.socket.emit(SOCKET_CHANNEL, message);
  }

  async setDowntimeRequestStatus(requestId, status, options = {}) {
    const result = await this.downtimeService.setRequestStatus(requestId, status, options);
    this.#emitDowntimeUpdated({
      actorIds: [result.actorId],
      requestId: result.id
    });
    await this.refreshDowntimeViews({ actorIds: [result.actorId] });
    return result;
  }

  async setDowntimeRequestChecks(requestId, checks = []) {
    const result = await this.downtimeService.setRequestChecks(requestId, checks);
    this.#emitDowntimeUpdated({
      actorIds: [result.actorId],
      requestId: result.id
    });
    await this.refreshDowntimeViews({ actorIds: [result.actorId] });
    return result;
  }

  async recordDowntimeCheckResult(requestId, checkId, result = {}, options = {}) {
    if (!game.user?.isGM) {
      return this.#requestDowntimeCheckResultViaGm(requestId, checkId, result, options);
    }

    const updatedRequest = await this.downtimeService.recordCheckResult(requestId, checkId, result, options);
    this.#emitDowntimeUpdated({
      actorIds: [updatedRequest.actorId],
      requestId: updatedRequest.id
    });
    await this.refreshDowntimeViews({ actorIds: [updatedRequest.actorId] });
    return updatedRequest;
  }

  getDowntimeActionCatalog() {
    return this.downtimeService.getActionCatalog();
  }

  async registerPartyGroup(groupActorId) {
    const result = await this.groupContextService.registerGroup(groupActorId);
    await this.refreshOpenApps();
    return result;
  }

  async mergeLegacyInventoryIntoGroup(groupActorId) {
    return this.runInventoryMutation(
      () => this.inventoryService.mergeLegacyInventoryIntoGroup(groupActorId)
    );
  }

  async setActivePartyGroup(groupActorId) {
    const result = await this.groupContextService.setActiveGroup(groupActorId);
    await this.refreshOpenApps();
    await refreshForienQuestLogApps();
    await syncSmallTimeToCalendarTime(this);
    return result;
  }

  async addPartyMember(actorId) {
    return this.runInventoryMutation(
      () => this.inventoryService.addPartyMember(actorId),
      { actorIdsFromResult: () => [actorId] }
    );
  }

  async removePartyMember(actorId) {
    return this.runInventoryMutation(
      () => this.inventoryService.removePartyMember(actorId),
      { actorIdsFromResult: () => [actorId] }
    );
  }

  async #syncTravelMapForSnapshot(snapshot = {}) {
    const position = snapshot?.mapPosition;
    if (!position?.available) {
      return null;
    }

    let context = null;
    try {
      context = this.groupContextService.resolveForCurrentUser();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to resolve group for travel map sync.`, error);
      return null;
    }

    return this.#syncTravelMapForGroup(context?.groupActor ?? null, position);
  }

  async #syncTravelMapForGroup(groupActor, position) {
    if (!groupActor?.id || !position?.available) {
      return null;
    }

    if (!game.user?.isGM) {
      game.socket?.emit?.(SOCKET_CHANNEL, {
        type: SOCKET_EVENT_TRAVEL_MAP_SYNC_REQUEST,
        senderId: game.user?.id ?? "",
        groupActorId: groupActor.id,
        position: cloneSocketPayload(position)
      });
      return {
        queued: true
      };
    }

    return this.travelMapService.syncGroupToken({
      groupActor,
      position
    });
  }

  async #handleTravelMapSyncSocketRequest(message = {}) {
    const groupActorId = cleanSocketId(message.groupActorId);
    if (!groupActorId) {
      return;
    }

    const context = this.groupContextService.resolveForGroup(groupActorId);
    await this.travelMapService.syncGroupToken({
      groupActor: context?.groupActor ?? null,
      position: message.position ?? null
    });
  }

  async setTravelRoute(payload = {}) {
    const result = await this.travelService.setRoute(payload);
    await this.#syncTravelMapForSnapshot(result).catch((error) => {
      console.warn(`${MODULE_ID} | Failed to sync travel token after route update.`, error);
      ui.notifications?.warn?.(error.message || "Не удалось синхронизировать токен группы на карте мира.");
    });
    await this.refreshOpenApps();
    return result;
  }

  async #applyTravelCalendarTime(hours = 0) {
    const safeHours = toNumber(hours, 0);
    if (Math.abs(safeHours) <= 0.001) {
      return {
        days: 0,
        timeOfDaySeconds: null
      };
    }

    const travelDayDelta = Math.trunc(safeHours / TRAVEL_DAY_HOURS);
    const clockHourDelta = safeHours - (travelDayDelta * TRAVEL_DAY_HOURS);
    let totalDayDelta = travelDayDelta;
    let timeOfDaySeconds = null;

    if (Math.abs(clockHourDelta) > 0.001) {
      const snapshot = this.calendarService.getSnapshot();
      const currentSeconds = toNumber(snapshot?.timeOfDaySeconds, 0);
      const rawSeconds = currentSeconds + (clockHourDelta * SECONDS_PER_HOUR);
      const clockDayDelta = Math.floor(rawSeconds / SECONDS_PER_DAY);
      totalDayDelta += clockDayDelta;
      timeOfDaySeconds = normalizeTimeOfDaySeconds(rawSeconds);
    }

    if (totalDayDelta !== 0) {
      await this.shiftCalendarDays(totalDayDelta, {
        processDowntime: false,
        processDailyCycles: false,
        reason: "travel-time",
        refreshApps: false,
        refreshSmallTime: false
      });
    }

    if (timeOfDaySeconds !== null) {
      await this.setCalendarTimeOfDay(timeOfDaySeconds, {
        reason: "travel-time",
        refreshApps: false,
        refreshSmallTime: false
      });
    }

    await syncSmallTimeToCalendarTime(this);
    return {
      days: totalDayDelta,
      timeOfDaySeconds
    };
  }

  async advanceTravelHours(hours = 0, options = {}) {
    const result = await this.travelService.advanceHours(hours);
    await this.#syncTravelMapForSnapshot(result).catch((error) => {
      console.warn(`${MODULE_ID} | Failed to sync travel token after travel progress.`, error);
      ui.notifications?.warn?.(error.message || "Не удалось синхронизировать токен группы на карте мира.");
    });
    if (options.trackTime === true) {
      await this.#applyTravelCalendarTime(result?.travelChange?.appliedHours ?? hours);
    }
    return result;
  }

  async clearTravelRoute() {
    const result = await this.travelService.clearRoute();
    await this.refreshOpenApps();
    return result;
  }

  async updatePartyDefaults(patch = {}) {
    return this.runInventoryMutation(
      () => this.inventoryService.updatePartyDefaults(patch)
    );
  }

  async updatePartyMember(actorId, patch = {}) {
    return this.runInventoryMutation(
      () => this.inventoryService.updatePartyMember(actorId, patch),
      { actorIdsFromResult: () => [actorId] }
    );
  }

  async updateInventoryItemQuantity(itemId, nextQuantity) {
    return this.runInventoryMutation(
      () => this.inventoryService.updateItemQuantity(itemId, nextQuantity)
    );
  }

  async deleteInventoryItem(itemId) {
    return this.runInventoryMutation(
      () => this.inventoryService.deleteItem(itemId)
    );
  }

  async takeInventoryItemToCharacter(itemId, options = {}) {
    return this.runInventoryMutation(
      () => this.inventoryService.takeInventoryItemToCharacter(itemId, options)
    );
  }

  async sellInventoryItem(itemId, quantity = 1) {
    return this.runInventoryMutation(
      () => this.inventoryService.sellInventoryItem(itemId, quantity)
    );
  }

  async addPartySupply(resourceKey, quantity) {
    return this.runInventoryMutation(
      () => this.inventoryService.addSupply(resourceKey, quantity)
    );
  }

  async consumePartySuppliesOneDay(options = {}) {
    return this.runInventoryMutation(
      () => this.inventoryService.consumeSuppliesOneDay(options)
    );
  }

  async importInventoryDrop(dropData) {
    return this.runInventoryMutation(
      () => this.inventoryService.importDroppedItem(dropData)
    );
  }

  async openPartyInventorySheet() {
    return this.inventoryService.openInventoryActorSheet();
  }

  async updatePartyCurrency(values = {}) {
    return this.runInventoryMutation(
      () => this.inventoryService.updateCurrency(values)
    );
  }

  async convertPartyCurrency(mode = "normalized") {
    return this.runInventoryMutation(
      () => this.inventoryService.convertCurrency(mode)
    );
  }

  async breakInventoryItemToMaterial(itemId, quantity = 1) {
    return this.runInventoryMutation(
      () => this.inventoryService.breakItemToMaterial(itemId, quantity)
    );
  }

  async addModelItemToInventory(sourceType, sourceId, quantity = 1) {
    return this.runInventoryMutation(
      () => this.inventoryService.addModelItemToInventory(sourceType, sourceId, quantity)
    );
  }

  async addLootgenRowToInventory(row = {}) {
    const mutationId = String(row.directGrantId ?? "").trim();
    if (!mutationId) {
      throw new Error("Для выдачи строки Lootgen нужен стабильный идентификатор.");
    }
    return this.runInventoryMutation(
      () => this.inventoryService.addLootgenRowToInventoryOnce(row, mutationId)
    );
  }

  async addLootgenCoinsToInventory(coins = {}, mutationId = "") {
    const stableMutationId = String(mutationId ?? "").trim();
    if (!stableMutationId) {
      throw new Error("Для выдачи монет Lootgen нужен стабильный идентификатор.");
    }
    if (!isActiveGmClient(game)) {
      throw new Error("Только активный мастер может добавлять монеты Lootgen.");
    }
    return this.runInventoryMutation(
      () => this.inventoryService.addCurrencyToInventoryOnce(coins, stableMutationId)
    );
  }

  getRebreyaToolCatalog() {
    return this.inventoryService.getRebreyaToolCatalog();
  }

  async updatePartyMemberTool(actorId, toolId, patch = {}) {
    return this.runInventoryMutation(
      () => this.inventoryService.updatePartyMemberTool(actorId, toolId, patch),
      { actorIdsFromResult: () => [actorId] }
    );
  }

  async setPartyMemberEnergy(actorId, currentEnergy) {
    return this.runInventoryMutation(
      () => this.inventoryService.setMemberEnergy(actorId, currentEnergy),
      { actorIdsFromResult: () => [actorId] }
    );
  }

  async restorePartyMemberEnergy(actorId, days = 1) {
    return this.runInventoryMutation(
      () => this.inventoryService.restoreMemberEnergy(actorId, days),
      { actorIdsFromResult: () => [actorId] }
    );
  }

  async getCraftSnapshot(options = {}) {
    return this.craftDowntimeService.getSnapshot(options);
  }

  async getCraftApprovalQuote(input = {}) {
    return this.craftDowntimeService.getApprovalQuote(input);
  }

  async #refreshCraftProject(project) {
    const actorId = cleanSocketId(project?.crafterActorId);
    await this.refreshDowntimeViews({ actorIds: actorId ? [actorId] : [] });
    return project;
  }

  async approveCraftDowntimeRequest(input = {}) {
    return this.#refreshCraftProject(await this.craftDowntimeService.approveRequest(input));
  }

  async pauseCraftProject(projectId, options = {}) {
    return this.#refreshCraftProject(await this.craftDowntimeService.pause(projectId, options));
  }

  async resumeCraftProject(projectId, options = {}) {
    return this.#refreshCraftProject(await this.craftDowntimeService.resume(projectId, options));
  }

  async cancelCraftProject(projectId, options = {}) {
    return this.#refreshCraftProject(await this.craftDowntimeService.cancel(projectId, options));
  }

  async reconcileCraftProject(projectId, options = {}) {
    return this.#refreshCraftProject(await this.craftDowntimeService.reconcile(projectId, options));
  }

  async queueCraftTask(payload = {}) {
    return this.runInventoryMutation(
      () => this.craftingService.queueTask(payload)
    );
  }

  async cancelCraftTask(taskId) {
    return this.runInventoryMutation(
      () => this.craftingService.cancelTask(taskId)
    );
  }

  async processCraftOneDay() {
    return this.runInventoryMutation(
      () => this.craftingService.processOneDay()
    );
  }

  async installItemUpgrade(hostItem, upgradeItem, options = {}) {
    const result = await this.itemUpgradeService.installItemUpgrade(hostItem, upgradeItem, options);
    await this.refreshOpenApps();
    return result;
  }

  async removeItemUpgrade(hostItem, upgradeItemOrId) {
    const result = await this.itemUpgradeService.removeItemUpgrade(hostItem, upgradeItemOrId);
    await this.refreshOpenApps();
    return result;
  }

  async setItemUpgradeCapacity(hostItem, capacity) {
    const result = await this.itemUpgradeService.setItemUpgradeCapacity(hostItem, capacity);
    await this.refreshOpenApps();
    return result;
  }

  getCalendarSnapshot() {
    return this.calendarService.getSnapshot();
  }

  previewCalendarTransition(options = {}) {
    return this.calendarTransitionCoordinator.preview(options);
  }

  async setCalendarTimeOfDay(seconds, options = {}) {
    const result = await this.calendarService.setTimeOfDaySeconds(seconds);
    const shouldRefreshApps = options.refreshApps !== false && options.reason !== "smalltime-world-time";
    const shouldRefreshSmallTime = options.refreshSmallTime !== false && options.reason !== "smalltime-world-time";

    if (shouldRefreshApps) {
      await this.refreshOpenApps();
    }
    if (shouldRefreshSmallTime) {
      await refreshSmallTimeDateDisplay();
    }

    return result;
  }

  async #refreshGlobalEventsByCalendarTransition(currentIsoDate, previousIsoDate, executionContext = {}) {
    const guard = executionContext.guard ?? executionContext.assertExecutionContext;
    guard?.();
    const activation = await this.globalEventsService.refreshEventActivationByDate(currentIsoDate, previousIsoDate);
    guard?.();
    if (activation.changed && this.globalEventsService.isAutoRecalculateEnabled()) {
      guard?.();
      await this.repository.rebuildModel();
      guard?.();
    }

    return activation;
  }

  async #applyTraderMonthlyReset(monthResetCount, reason = "calendar", executionContext = {}) {
    const guard = executionContext.guard ?? executionContext.assertExecutionContext;
    guard?.();
    const safeResetCount = Math.max(0, Math.floor(Number(monthResetCount ?? 0)));
    if (safeResetCount <= 0 || !game.user?.isGM) {
      return {
        triggered: false,
        reason,
        monthResetCount: safeResetCount,
        refreshedTraderCount: 0,
        removedTraderCount: 0
      };
    }

    guard?.();
    const resetResult = await this.traderService.resetAssortments(executionContext);
    guard?.();
    return {
      triggered: true,
      reason,
      monthResetCount: safeResetCount,
      refreshedTraderCount: Math.max(0, Math.floor(Number(resetResult?.refreshedTraderCount ?? 0))),
      removedTraderCount: Math.max(0, Math.floor(Number(resetResult?.removedTraderCount ?? 0)))
    };
  }

  async setCalendarDate(year, month, day, options = {}) {
    const target = this.calendarService.previewDate(year, month, day);
    const processDailyCycles = options.processDailyCycles === true;
    const result = await this.calendarTransitionCoordinator.moveTo({
      ...options,
      toIsoDate: target.to.isoDate,
      processDowntime: options.processDowntime !== false,
      processSupplies: options.processSupplies !== undefined
        ? options.processSupplies === true
        : processDailyCycles && options.consumeSupplies !== false,
      processDailyCycles,
      monthResetMode: "target-first",
      reason: options.reason ?? "set-date"
    });
    return {
      ...result.calendar,
      ...result
    };
  }

  async #runDayCycles(days, options = {}) {
    const {
      consumeSupplies = true,
      applyEnergy = true,
      groupId = "",
      transitionId = ""
    } = options;
    const guard = options.guard ?? options.assertExecutionContext;
    const executionContext = {
      groupId,
      transitionId,
      assertExecutionContext: guard,
      guard
    };
    const safeDays = Math.max(0, Math.floor(Number(days ?? 0)));
    const supplies = [];

    guard?.();
    for (let index = 0; index < safeDays; index += 1) {
      guard?.();
      if (consumeSupplies) {
        const supplyResult = await this.inventoryService.consumeSuppliesOneDay({
          applyEnergy,
          ...executionContext
        });
        guard?.();
        supplies.push(supplyResult);
      }
    }

    const supplyTotals = supplies.reduce((totals, row) => ({
      foodSpent: totals.foodSpent + Number(row.foodSpent ?? 0),
      waterSpent: totals.waterSpent + Number(row.waterSpent ?? 0),
      foodShortage: totals.foodShortage + Number(row.foodShortage ?? 0),
      waterShortage: totals.waterShortage + Number(row.waterShortage ?? 0)
    }), {
      foodSpent: 0,
      waterSpent: 0,
      foodShortage: 0,
      waterShortage: 0
    });

    return {
      days: safeDays,
      supplies,
      supplyTotals,
      craft: {
        completed: [],
        completedCount: 0
      }
    };
  }

  async #refreshAppsByCalendarTransition(executionContext = {}) {
    const guard = executionContext.guard ?? executionContext.assertExecutionContext;
    guard?.();
    const result = await this.refreshOpenApps();
    guard?.();
    return result;
  }

  async #refreshSmallTimeByCalendarTransition(executionContext = {}) {
    const guard = executionContext.guard ?? executionContext.assertExecutionContext;
    guard?.();
    const result = await refreshSmallTimeDateDisplay();
    guard?.();
    return result;
  }

  async shiftCalendarDays(days = 0, options = {}) {
    const safeDays = Math.trunc(toNumber(days, 0));
    const target = this.calendarService.previewShiftDays(safeDays);
    const processDailyCycles = options.processDailyCycles === true;
    const result = await this.calendarTransitionCoordinator.moveTo({
      ...options,
      toIsoDate: target.to.isoDate,
      processDowntime: options.processDowntime !== false,
      processSupplies: options.processSupplies !== undefined
        ? options.processSupplies === true
        : processDailyCycles && options.consumeSupplies !== false,
      processDailyCycles,
      monthResetMode: "crossed",
      reason: options.reason ?? "shift-days"
    });
    return {
      ...result.calendar,
      ...result
    };
  }

  async advanceCalendarDays(days = 1, options = {}) {
    const safeDays = Math.max(0, Math.floor(toNumber(days, 0)));
    const target = this.calendarService.previewShiftDays(safeDays);
    const processDailyCycles = options.processDailyCycles !== false;
    const result = await this.calendarTransitionCoordinator.moveTo({
      ...options,
      toIsoDate: target.to.isoDate,
      processDowntime: options.processDowntime !== false,
      processSupplies: options.processSupplies !== undefined
        ? options.processSupplies === true
        : processDailyCycles && options.consumeSupplies !== false,
      processDailyCycles,
      monthResetMode: "crossed",
      reason: options.reason ?? "advance-days"
    });
    return {
      ...result.calendar,
      ...result
    };
  }

  async advanceCalendarWeeks(weeks = 1, options = {}) {
    const safeWeeks = Math.max(0, Math.floor(Number(weeks ?? 0)));
    return this.advanceCalendarDays(safeWeeks * 7, options);
  }

  async advanceCalendarMonths(months = 1, options = {}) {
    const safeMonths = Math.max(0, Math.floor(toNumber(months, 0)));
    const target = this.calendarService.previewAdvanceMonths(safeMonths);
    const processDailyCycles = options.processDailyCycles !== false;
    const result = await this.calendarTransitionCoordinator.moveTo({
      ...options,
      toIsoDate: target.to.isoDate,
      processDowntime: options.processDowntime !== false,
      processSupplies: options.processSupplies !== undefined
        ? options.processSupplies === true
        : processDailyCycles && options.consumeSupplies !== false,
      processDailyCycles,
      monthResetMode: "crossed",
      reason: options.reason ?? "advance-months"
    });
    return {
      ...result.calendar,
      ...result
    };
  }

  unregisterLootgenApp(appKey) {
    if (!appKey) {
      return false;
    }

    return this.lootgenApps.delete(appKey);
  }

  async openLootgenApp({ newWindow = true, viewer = false, sharedResult = null } = {}) {
    try {
      if (!viewer && !game.user?.isGM) {
        throw new Error("Лутген доступен только мастеру.");
      }

      const moduleVersion = game.modules.get(MODULE_ID)?.version ?? "1.4.96";
      const { LootgenApp } = await import(`./ui/lootgen-app.js?v=${encodeURIComponent(moduleVersion)}`);
      let app = null;

      if (!viewer && !newWindow) {
        app = Array.from(this.lootgenApps.values()).find((candidate) => candidate?.rendered && !candidate.viewer) ?? null;
      }

      if (!app) {
        if (viewer) {
          const viewerAppKey = "lootgen-viewer";
          app = this.lootgenApps.get(viewerAppKey) ?? null;
          if (!app) {
            app = new LootgenApp(this, {
              appKey: viewerAppKey,
              viewer: true,
              sharedResult: sharedResult ?? this.latestLootgenResult ?? null
            });
            this.lootgenApps.set(viewerAppKey, app);
          }
        }
        else {
          this.lootgenCounter += 1;
          const appKey = `lootgen-${this.lootgenCounter}`;
          app = new LootgenApp(this, { appKey });
          this.lootgenApps.set(appKey, app);
        }
      }

      if (viewer && sharedResult && typeof app?.setSharedResult === "function") {
        app.setSharedResult(sharedResult);
      }

      await app.render({ force: true });
      bringAppToFront(app);
      return app;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open loot generator app.`, error);
      ui.notifications?.error("Не удалось открыть окно лутгена.");
      throw error;
    }
  }
  async openTrader(cityId, traderKey, options = {}) {
    return this.openTraderV2(cityId, traderKey, options);
  }

  async openTraderV2(cityId, traderKey, options = {}) {
    try {
      const { TraderAppV2 } = await import("./ui/trader-app-v2.js");
      const appKey = `${cityId}::${traderKey}`;

      let app = this.traderV2Apps.get(appKey);
      if (!app) {
        app = new TraderAppV2(this, cityId, traderKey, options);
        this.traderV2Apps.set(appKey, app);
      }
      else if (options?.actorId !== undefined) {
        app.selectedActorId = options.actorId;
      }

      await app.render({ force: true });
      bringAppToFront(app);
      return app;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open trader v2 '${cityId}:${traderKey}'.`, error);
      ui.notifications?.error("Не удалось открыть новое окно лавки.");
      throw error;
    }
  }

  async openTraderSheet(cityId, traderKey, options = {}) {
    return this.openTraderV2(cityId, traderKey, options);
  }

  async reloadData({ notify = false, rerender = true } = {}) {
    const model = await this.repository.reload();
    await this.#syncManagedCompendia(model);

    if (notify) {
      ui.notifications?.info(game.i18n.format("REBREYA_MAIN.Notifications.DataReloaded", { count: model.cities.length }));
    }

    if (rerender) {
      await this.refreshOpenApps();
    }

    return model;
  }

  #appRefreshTask(app, options = {}) {
    if (!app?.rendered || typeof app.render !== "function") {
      return null;
    }

    return {
      key: app,
      run: () => rerenderApp(app, { ...options, focus: false })
    };
  }

  #actorSheetRefreshTasks(actorIds = [], { allWhenEmpty = true } = {}) {
    const normalizedActorIds = new Set(
      Array.from(actorIds ?? [], (actorId) => String(actorId ?? "").trim()).filter(Boolean)
    );
    const refreshAllActorSheets = normalizedActorIds.size === 0;

    if (refreshAllActorSheets && !allWhenEmpty) {
      return [];
    }

    return getOpenActorSheetApps()
      .filter((app) => {
        const actorId = String(app.actor?.id ?? app.document?.id ?? "").trim();
        return refreshAllActorSheets || normalizedActorIds.has(actorId);
      })
      .map((app) => this.#appRefreshTask(app))
      .filter(Boolean);
  }

  #scheduleInventoryRefresh() {
    if (this.inventoryRefreshHoldCount > 0) {
      return;
    }

    if (this.inventoryRefreshTimer) {
      globalThis.clearTimeout(this.inventoryRefreshTimer);
    }

    this.inventoryRefreshTimer = globalThis.setTimeout(() => {
      this.inventoryRefreshTimer = null;
      void this.#flushInventoryViews();
    }, INVENTORY_REFRESH_SETTLE_MS);
  }

  async #flushInventoryViews() {
    const actorIds = Array.from(this.inventoryRefreshActorIds);
    const waiters = this.inventoryRefreshWaiters.splice(0);
    this.inventoryRefreshActorIds.clear();

    const tasks = [
      this.#appRefreshTask(this.inventoryApp, { preserveScroll: true }),
      ...this.#actorSheetRefreshTasks(actorIds, { allWhenEmpty: false })
    ].filter(Boolean);

    try {
      const result = await this.uiRefreshCoordinator.request(tasks);
      waiters.forEach(({ resolve }) => resolve(result));
    }
    catch (error) {
      waiters.forEach(({ reject }) => reject(error));
    }

    if (this.inventoryRefreshWaiters.length > 0) {
      this.#scheduleInventoryRefresh();
    }
  }

  refreshInventoryViews({ actorIds = [] } = {}) {
    for (const actorId of actorIds ?? []) {
      const normalizedActorId = String(actorId ?? "").trim();
      if (normalizedActorId) {
        this.inventoryRefreshActorIds.add(normalizedActorId);
      }
    }

    const completion = new Promise((resolve, reject) => {
      this.inventoryRefreshWaiters.push({ resolve, reject });
    });
    this.#scheduleInventoryRefresh();
    return completion;
  }

  async runInventoryMutation(operation, { actorIdsFromResult } = {}) {
    if (typeof operation !== "function") {
      throw new TypeError("Inventory mutation operation must be a function.");
    }

    if (this.inventoryRefreshTimer) {
      globalThis.clearTimeout(this.inventoryRefreshTimer);
      this.inventoryRefreshTimer = null;
    }
    this.inventoryRefreshHoldCount += 1;
    let result;
    let operationError = null;
    try {
      result = await operation();
    }
    catch (error) {
      operationError = error;
    }

    let actorIds = [];
    try {
      actorIds = typeof actorIdsFromResult === "function"
        ? actorIdsFromResult(result)
        : [result?.actorId];
    }
    catch (error) {
      operationError ??= error;
    }
    this.inventoryRefreshHoldCount = Math.max(0, this.inventoryRefreshHoldCount - 1);
    try {
      await this.refreshInventoryViews({ actorIds });
    }
    catch (refreshError) {
      if (!operationError) {
        throw refreshError;
      }
    }

    if (operationError) {
      throw operationError;
    }
    return result;
  }

  async refreshDowntimeViews({ actorIds = [] } = {}) {
    const tasks = [
      this.#appRefreshTask(this.inventoryApp, { preserveScroll: true }),
      ...this.#actorSheetRefreshTasks(actorIds, { allWhenEmpty: false })
    ].filter(Boolean);

    await this.uiRefreshCoordinator.request(tasks);
  }

  async refreshCosmologyViews() {
    const task = this.#appRefreshTask(this.cosmologyApp);
    await this.uiRefreshCoordinator.request(task ? [task] : []);
  }

  async refreshOpenApps() {
    const standardApps = [
      this.economyApp,
      this.worldTradeRoutesApp,
      this.statesApp,
      this.globalEventsApp,
      this.groupsApp,
      this.cosmologyApp,
      ...this.lootgenApps.values(),
      ...this.cityApps.values(),
      ...this.traderV2Apps.values(),
      ...this.tradeRouteApps.values(),
      ...this.referenceApps.values(),
      ...getOpenActorSheetApps()
    ];
    const tasks = standardApps
      .map((app) => this.#appRefreshTask(app))
      .filter(Boolean);
    const inventoryTask = this.#appRefreshTask(this.inventoryApp, { preserveScroll: true });
    if (inventoryTask) {
      tasks.push(inventoryTask);
    }

    await this.uiRefreshCoordinator.request(tasks);
  }

  async openEconomyApp() {
    try {
      const { EconomyApp } = await import("./ui/economy-app.js");

      if (!this.economyApp) {
        this.economyApp = new EconomyApp(this);
      }

      await this.economyApp.render({ force: true });
      return this.economyApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open economy app.`, error);
      ui.notifications?.error("Не удалось открыть окно экономики. Подробности в консоли.");
      throw error;
    }
  }

  async openCityApp(cityId) {
    try {
      const { CityEconomyApp } = await import("./ui/city-app.js");

      let app = this.cityApps.get(cityId);
      if (!app) {
        app = new CityEconomyApp(this, cityId);
        this.cityApps.set(cityId, app);
      }

      await app.render({ force: true });
      return app;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open city app '${cityId}'.`, error);
      ui.notifications?.error("Не удалось открыть окно города. Подробности в консоли.");
      throw error;
    }
  }

  async openWorldTradeRoutesApp() {
    try {
      const { WorldTradeRoutesApp } = await import("./ui/trade-routes-app.js");

      if (!this.worldTradeRoutesApp) {
        this.worldTradeRoutesApp = new WorldTradeRoutesApp(this);
      }

      await this.worldTradeRoutesApp.render({ force: true });
      return this.worldTradeRoutesApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open world trade routes app.`, error);
      ui.notifications?.error("Не удалось открыть окно мировых связей.");
      throw error;
    }
  }

  async openStatesApp() {
    try {
      const { StatesApp } = await import("./ui/states-app.js");

      if (!this.statesApp) {
        this.statesApp = new StatesApp(this);
      }

      await this.statesApp.render({ force: true });
      return this.statesApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open states app.`, error);
      ui.notifications?.error("Не удалось открыть меню государств.");
      throw error;
    }
  }

  async openGlobalEventsApp() {
    try {
      if (!game.user?.isGM) {
        throw new Error("Окно глобальных ивентов доступно только мастеру.");
      }

      const { GlobalEventsApp } = await import("./ui/global-events-app.js");

      if (!this.globalEventsApp) {
        this.globalEventsApp = new GlobalEventsApp(this);
      }

      await this.globalEventsApp.render({ force: true });
      bringAppToFront(this.globalEventsApp);
      return this.globalEventsApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open global events app.`, error);
      ui.notifications?.error("Не удалось открыть окно глобальных ивентов.");
      throw error;
    }
  }

  getCosmologyState() {
    let rawState = {};
    try {
      rawState = game.settings.get(MODULE_ID, SETTINGS_KEYS.COSMOLOGY_STATE) ?? {};
    }
    catch (_error) {
      rawState = {};
    }

    const state = rawState && typeof rawState === "object" && !Array.isArray(rawState) ? rawState : {};
    return {
      version: 1,
      ...state,
      mechanusEnabled: state.mechanusEnabled === true
    };
  }

  isMechanusEnabled() {
    return this.getCosmologyState().mechanusEnabled === true;
  }

  async setMechanusEnabled(enabled) {
    if (!game.user?.isGM) {
      throw new Error("Окно космологии доступно только мастеру.");
    }

    if (!isActiveGmClient(game)) {
      const nextState = await this.socketCommandBus.request(COSMOLOGY_SET_MECHANUS_COMMAND, {
        enabled: enabled === true
      });
      return nextState;
    }

    return this.#commitMechanusEnabled(enabled === true);
  }

  async #commitMechanusEnabled(enabled) {
    const nextState = {
      ...this.getCosmologyState(),
      version: 1,
      mechanusEnabled: enabled === true
    };

    await game.settings.set(MODULE_ID, SETTINGS_KEYS.COSMOLOGY_STATE, nextState);
    return nextState;
  }

  async openCosmologyApp() {
    try {
      if (!game.user?.isGM) {
        throw new Error("Окно космологии доступно только мастеру.");
      }

      const { CosmologyApp } = await import("./ui/cosmology-app.js?v=1.4.96-cosmology");

      if (!this.cosmologyApp) {
        this.cosmologyApp = new CosmologyApp(this);
      }

      await this.cosmologyApp.render({ force: true });
      bringAppToFront(this.cosmologyApp);
      return this.cosmologyApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open cosmology app.`, error);
      ui.notifications?.error(error?.message || "Не удалось открыть окно космологии.");
      throw error;
    }
  }

  async openInventoryApp(options = {}) {
    try {
      const moduleVersion = game.modules?.get?.(MODULE_ID)?.version ?? "1.4.67";
      const { InventoryApp } = await import(`./ui/inventory-app.js?v=${encodeURIComponent(moduleVersion)}`);

      if (!this.inventoryApp) {
        this.inventoryApp = new InventoryApp(this);
      }

      if (options?.tab && typeof this.inventoryApp.setActiveTab === "function") {
        this.inventoryApp.setActiveTab(options.tab, { render: false });
      }

      await this.inventoryService.getInventoryActor({ create: true });
      await this.inventoryApp.render({ force: true });
      bringAppToFront(this.inventoryApp);
      return this.inventoryApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open inventory app.`, error);
      ui.notifications?.error("Не удалось открыть партийный инвентарь.");
      throw error;
    }
  }

  async openGroupsApp() {
    try {
      if (!game.user?.isGM) {
        throw new Error("Окно групп доступно только мастеру.");
      }
      const { GroupsApp } = await import("./ui/groups-app.js");
      if (!this.groupsApp) this.groupsApp = new GroupsApp(this);
      await this.groupsApp.render({ force: true });
      bringAppToFront(this.groupsApp);
      return this.groupsApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open groups app.`, error);
      ui.notifications?.error("Не удалось открыть окно групп.");
      throw error;
    }
  }

  async openTradeRouteApp(connectionId) {
    try {
      const { TradeRouteApp } = await import("./ui/trade-route-app.js");

      let app = this.tradeRouteApps.get(connectionId);
      if (!app) {
        app = new TradeRouteApp(this, connectionId);
        this.tradeRouteApps.set(connectionId, app);
      }

      await app.render({ force: true });
      if (!this.hasTradeRouteAnalytics()) {
        this.prepareTradeRouteAnalytics({ rerender: false }).catch((error) => {
          console.error(`${MODULE_ID} | Failed to warm trade route analytics for '${connectionId}'.`, error);
        });
      }
      return app;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open trade route app '${connectionId}'.`, error);
      ui.notifications?.error("Не удалось открыть окно торговой связи.");
      throw error;
    }
  }

  async openReferenceInfoApp(entryType, entryId) {
    try {
      const { ReferenceInfoApp } = await import("./ui/reference-info-app.js");
      const appKey = `${entryType}::${entryId}`;

      let app = this.referenceApps.get(appKey);
      if (!app) {
        app = new ReferenceInfoApp(this, entryType, entryId);
        this.referenceApps.set(appKey, app);
      }

      await app.render({ force: true });
      return app;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open reference info '${entryType}:${entryId}'.`, error);
      ui.notifications?.error("Не удалось открыть справочную запись.");
      throw error;
    }
  }

  async openMaterialByGoodId(goodId) {
    const model = await this.getModel();
    const material = model.materialByGoodId.get(goodId);
    return this.materialsCompendium.openMaterial(material);
  }

  async openMaterialById(materialId, fallbackName = "") {
    const model = await this.getModel();
    const normalizedFallbackName = normalizeLookupText(fallbackName);
    const material = model.materialById.get(materialId)
      ?? model.materials.find((entry) => entry.id === materialId)
      ?? model.materials.find((entry) => normalizeLookupText(entry.name) === normalizedFallbackName);
    return this.materialsCompendium.openMaterial(material);
  }

  async openGearById(gearId, fallbackName = "") {
    const model = await this.getModel();
    const normalizedFallbackName = normalizeLookupText(fallbackName);
    const gearItem = model.gearById.get(gearId)
      ?? model.gear.find((entry) => entry.id === gearId)
      ?? model.gear.find((entry) => normalizeLookupText(entry.name) === normalizedFallbackName);
    return this.gearCompendium.openGear(gearItem);
  }

  async openMagicItemById(magicItemId, fallbackName = "") {
    return this.magicItemsCompendium.openMagicItem(magicItemId, fallbackName);
  }

  async syncFeatsFromWorldCompendium(options = {}) {
    const result = await this.featsCompendium.syncFromWorldCompendium(options);
    await this.refreshOpenApps();
    return result;
  }

  async openFeatById(featId, fallbackName = "") {
    return this.featsCompendium.openFeat(featId, fallbackName);
  }

  async openBackgroundById(backgroundId, fallbackName = "") {
    return this.backgroundsCompendium.openBackground(backgroundId, fallbackName);
  }

  async openStateById(stateId, fallbackName = "") {
    return this.statesCompendium.openState(stateId, fallbackName);
  }

  async openTradeEntry(sourceType, sourceId, sourceName = "") {
    const normalizedType = normalizeTradeSourceType(sourceType);

    if (normalizedType === "material") {
      return this.openMaterialById(sourceId, sourceName);
    }

    if (normalizedType === "gear") {
      return this.openGearById(sourceId, sourceName);
    }

    if (normalizedType === "magicItem") {
      return this.openMagicItemById(sourceId, sourceName);
    }

    if (normalizedType === "feat") {
      return this.openFeatById(sourceId, sourceName);
    }

    if (normalizedType === "background") {
      return this.openBackgroundById(sourceId, sourceName);
    }

    if (normalizedType === "state") {
      return this.openStateById(sourceId, sourceName);
    }

    return null;
  }
}

Hooks.once("init", () => {
  try {
    ensureModuleStylesheet();
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to ensure module stylesheet.`, error);
  }

  try {
    registerSettings();
    registerDurabilitySettings();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register settings.`, error);
  }

  try {
    registerHandlebarsHelpers();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register Handlebars helpers.`, error);
  }

  try {
    registerSceneControlsHook();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register scene controls hook.`, error);
  }

  try {
    extendDnd5eItemTypes();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to extend dnd5e item types.`, error);
  }

  try {
    registerCombatStatusConfig();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register combat status config.`, error);
  }

  try {
    registerRadialStatusEffects();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register radial status effects.`, error);
  }

  try {
    registerHeldShieldArmorClassPatch();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register held shield armor class patch.`, error);
  }

  try {
    patchDurabilityItemEffectSuppression();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to patch broken-item effect suppression.`, error);
  }

  try {
    registerItemPilesSimilarityRepairHook({ Hooks });
    void ensureItemPilesDnD5eIntegration().catch((error) => {
      console.warn(`${MODULE_ID} | Failed to initialize Item Piles integration.`, error);
    });
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to initialize Item Piles integration.`, error);
  }

  try {
    patchSmAirshipRenderSettingsHook();
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to patch sm-airship settings hook.`, error);
  }
});

if (Hooks.on instanceof Function) {
  Hooks.on("setup", () => {
    game.socket?.on?.(SOCKET_CHANNEL, dispatchSocketMessage);
  });
}

Hooks.once("ready", async () => {
  try {
    await ensureItemPilesDnD5eIntegration();
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to finalize Item Piles integration.`, error);
  }

  try {
    patchEffectMacroCombatHooks();
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to patch effectmacro combat hook.`, error);
  }

  try {
    patchTransformCleanupUpdateActorHook();
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to patch transform-cleanup actor update hook.`, error);
  }

  let moduleApi;
  try {
    moduleApi = new RebreyaMainModule();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to construct module API.`, error);
    ui.notifications?.error("Rebreya: не удалось запустить модульный API.");
    return;
  }

  game.rebreyaMain = moduleApi;
  socketModuleApi = moduleApi;
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = moduleApi;
  }
  flushQueuedSocketMessages(moduleApi);

  try {
    await registerForienQuestLogIntegration(moduleApi);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to register Forien Quest Log integration.`, error);
  }

  try {
    registerDurabilityHooks(moduleApi);
    await reconcileBrokenEquippedArmor();
    await reconcileItemPileDurability();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register durability hooks.`, error);
  }

  try {
    registerCombatHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register combat hooks.`, error);
  }

  try {
    registerCraftsmanGadgetHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register Craftsman gadget hooks.`, error);
  }

  try {
    registerMechanusRollHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register Mechanus roll hooks.`, error);
  }

  try {
    registerSmallTimeIntegration(moduleApi);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to register SmallTime integration.`, error);
  }

  try {
    registerFeatChoiceAutomationHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register feat choice automation hooks.`, error);
  }

  try {
    registerDnd5eSheetExtensions(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register dnd5e sheet extensions.`, error);
    ui.notifications?.warn("Rebreya: расширения листов dnd5e отключены из-за ошибки.");
  }

  try {
    registerLootgenChatHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register lootgen chat hooks.`, error);
  }

  try {
    registerRationFoodConversionHook(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register ration food conversion hook.`, error);
  }

  try {
    registerInventorySyncHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register inventory sync hooks.`, error);
  }

  try {
    registerMagicWeaponTemplateHook(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register magic weapon template hook.`, error);
  }

  try {
    await moduleApi.initialize();
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to initialize module.`, error);
    ui.notifications?.error(game.i18n.localize("REBREYA_MAIN.Notifications.InitializationFailed"));
  }
});
