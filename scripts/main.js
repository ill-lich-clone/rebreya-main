// @rebreya-role canonical-composition-root
import { MODULE_ID, SETTINGS_KEYS } from "./constants.js";
import { MaterialsCompendiumService } from "./data/materials-compendium.js";
import { GearCompendiumService } from "./data/gear-compendium.js?v=1.4.145-coin-icons-storage-sound";
import { repairWorldAmmunitionCompatibility } from "./data/ammunition-compatibility.js?v=1.4.147-native-ammunition";
import { MagicItemsCompendiumService } from "./data/magic-items-compendium.js";
import { FeatsCompendiumService } from "./data/feats-compendium.js";
import { BackgroundsCompendiumService } from "./data/backgrounds-compendium.js";
import { StatesCompendiumService } from "./data/states-compendium.js";
import { RacesCompendiumService } from "./data/races-compendium.js?v=1.4.110-giant-tribe-cache-fixes-2&implants=1";
import { ClassesCompendiumService } from "./data/classes-compendium.js";
import { CraftsmanConstructCompendiumService } from "./data/craftsman-construct-compendium.js";
import { TransportCompendiumService } from "./data/transport-compendium.js";
import {
  TRANSPORT_IMPORT_COMMAND,
  TRANSPORT_SELECT_FUEL_COMMAND,
  TRANSPORT_UPDATE_FUEL_CONSUMPTION_COMMAND,
  TRANSPORT_UPDATE_STATE_COMMAND,
  TransportInstanceService,
  registerTransportInstanceCommands
} from "./data/transport-instance-service.js";
import { TransportFuelService } from "./data/transport-fuel-service.js";
import { SpellsCompendiumService } from "./data/spells-compendium.js?v=1.4.109-counterspell-sanitize";
import { ActionsCompendiumService } from "./data/actions-compendium.js";
import { DowntimeCompendiumService } from "./data/downtime-compendium.js";
import { FeatChoiceAutomationService, registerFeatChoiceAutomationHooks } from "./automation/feat-choice-service.js";
import { EconomyRepository } from "./data/repository.js?v=1.4.128-lootgen-multiplicity";
import { TraderService, normalizeTraderState } from "./data/trader-service.js?v=1.4.109-lazy-trader-restock";
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
  normalizeGroupState,
  normalizeGroupTransportState
} from "./data/group-context-service.js";
import { RebreyaQuestLogService } from "./data/quest-log-service.js";
import { DowntimeService } from "./data/downtime-service.js?v=1.4.96-craft-calendar";
import { CharacterDowntimeService } from "./data/character-downtime-service.js";
import {
  GROUP_TRAVEL_REPLACE_STATE_COMMAND,
  TravelService,
  normalizeTravelState
} from "./data/travel-service.js";
import { TravelMapService } from "./data/travel-map-service.js?v=1.4.141-auraeffects-inactive-scene";
import {
  INVENTORY_CURRENCY_CONVERT_COMMAND,
  INVENTORY_CURRENCY_UPDATE_COMMAND,
  INVENTORY_FOLDER_CREATE_COMMAND,
  INVENTORY_FOLDER_DELETE_COMMAND,
  INVENTORY_FOLDER_MOVE_COMMAND,
  INVENTORY_FOLDER_RENAME_COMMAND,
  INVENTORY_IMPORT_COMMAND,
  INVENTORY_ITEM_FOLDER_MOVE_COMMAND,
  INVENTORY_SALE_COMMAND,
  INVENTORY_TAKE_COMMAND,
  GROUP_TRANSPORT_REPLACE_STATE_COMMAND,
  InventoryService,
  SOCKET_EVENT_INVENTORY_IMPORT_REQUEST,
  SOCKET_EVENT_INVENTORY_IMPORT_RESULT,
  SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_REQUEST,
  SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
  SOCKET_EVENT_INVENTORY_ITEM_ACTION_REQUEST,
  SOCKET_EVENT_INVENTORY_ITEM_ACTION_RESULT
} from "./data/inventory-service.js?v=1.4.156-inventory-folder-exports";
import { DurabilityService } from "./data/durability-service.js?v=1.4.154-corpse-storage-broken-name";
import { MapObjectTokenService } from "./data/map-object-token-service.js?v=1.4.97-map-object-token";
import { HeroDollService } from "./data/hero-doll-service.js";
import { ImplantService } from "./data/implant-service.js";
import { CraftingService } from "./data/crafting-service.js?v=1.4.96-craft-calendar";
import { CraftDowntimeService } from "./data/craft-downtime-service.js?v=1.4.96-craft-calendar";
import { ItemUpgradeService } from "./data/item-upgrade-service.js?v=1.4.96-item-upgrades";
import { GROUP_CALENDAR_PATCH_COMMAND, CalendarService } from "./data/calendar-service.js";
import { CalendarTransitionCoordinator } from "./data/calendar-transition-coordinator.js?v=1.4.96-craft-calendar";
import { WorldMutationCoordinator } from "./application/world-mutation-coordinator.js";
import { LootClaimService } from "./application/loot-claim-service.js";
import {
  buildPublicCitySnapshot,
  buildPublicEconomySnapshot
} from "./application/public-economy-read-model.js";
import { GroupStateRepository } from "./infrastructure/foundry/group-state-repository.js";
import { TraderStateRepository } from "./infrastructure/foundry/trader-state-repository.js";
import { getActiveGm, isActiveGmClient } from "./infrastructure/foundry/active-gm.js";
import { SocketCommandBus } from "./infrastructure/foundry/socket-command-bus.js";
import { UiRefreshCoordinator } from "./infrastructure/ui/ui-refresh-coordinator.js";
import { GlobalEventsService } from "./data/global-events-service.js";
import { LootgenTemplateCatalog } from "./data/lootgen-template-catalog.js?v=1.4.129-lootgen-row-cap";
import {
  StorageService,
  isStorageActor,
  readStorageState,
  readStorageStateAtPath
} from "./data/storage-service.js?v=1.4.152-dead-npc-looting";
import {
  CorpseStorageMaterializer,
  isDeadNpcStorageTarget
} from "./data/corpse-storage-materializer.js?v=1.4.154-corpse-storage-broken-name";
import { isMaterializedCorpseStorageState } from "./data/storage-object-kind.js?v=1.4.153-corpse-creature";
import { StorageOpenSoundService } from "./data/storage-open-sound-service.js?v=1.4.145-coin-icons-storage-sound";
import {
  isStorageTokenVisible,
  measureStoragePointDistance,
  measureStorageTokenDistance
} from "./data/storage-access.js?v=1.4.133-ground-item-polish";
import { BuiltinStorageActorService } from "./data/builtin-storage-actor-service.js";
import { StorageGroundPileService } from "./data/storage-ground-pile-service.js?v=1.4.155-journal-pile-presentation";
import { StorageContainerItemService } from "./data/storage-container-item-service.js?v=1.4.130-storage-player-fixes";
import { isStorageJournalRow } from "./data/storage-container-snapshot.js";
import {
  StorageJournalReader,
  createStorageJournalHtmlParser
} from "./data/storage-journal-reader.js";
import {
  parseStorageDepositDragData,
  resolveStorageDepositSource
} from "./data/storage-deposit-source.js?v=1.4.144-spreadsheet-coins-ground-repair";
import { NativeObjectDurabilityService } from "./data/native-object-durability-service.js?v=1.4.153-corpse-creature";
import {
  StorageCommandService,
  isValidStorageClaimAllPayload,
  isValidStorageClaimCoinsPayload,
  isValidStorageClaimRowPayload,
  isValidStorageCoinDropPayload,
  isValidStorageDepositPayload,
  isValidStorageDropItemPayload,
  isValidStorageJournalReadPayload,
  isValidStorageOpenPayload,
  isValidStorageRestorePortablePayload,
  isValidStorageTokenCharacterPayload,
  storageCharacterTokenUuidForClaim
} from "./data/storage-command-service.js?v=1.4.152-dead-npc-looting";
import { registerCombatHooks } from "./combat/hooks.js?v=1.4.147-race-damage";
import { CombatAttackService } from "./combat/attack-service.js?v=1.4.157-firearm-io-batching";
import { ImplantAutomationService } from "./combat/implant-automation-service.js";
import { SizeAutomationService } from "./combat/size-automation-service.js?v=1.4.110-character-size-authority";
import { ReactionCapabilityIndex } from "./combat/reaction-capability-index.js";
import { ReactionQueueService } from "./combat/reaction-queue-service.js";
import { LongRestPipelineService } from "./rest/long-rest-pipeline-service.js";
import { RuneKnightAutomationService } from "./combat/rune-knight-automation-service.js";
import { CurseEaterAutomationService } from "./combat/curse-eater-automation-service.js";
import { SpellAutomationService } from "./combat/spell-automation-service.js?v=1.4.109-counterspell-sanitize";
import { SpellAutomationRegistry } from "./combat/spell-automation-registry.js";
import { SpellInstanceRuntime } from "./combat/spell-instance-runtime.js";
import { SummonLifecycleRuntime } from "./combat/summon-lifecycle-runtime.js";
import { buildMelfsMinuteMeteorsRecipe } from "./combat/melfs-minute-meteors-recipe.js";
import { SpellInterceptionRuntime } from "./combat/spell-interception-runtime.js";
import { SpellAreaRuntime } from "./combat/spell-area-runtime.js";
import { SpellAutomationHookBridge } from "./combat/spell-automation-hook-bridge.js";
import { registerRadialStatusEffects } from "./combat/radial-status-effects.js";
import { CombatStatusService, registerCombatStatusConfig } from "./combat/status-service.js?v=1.4.100-hp-dead-overlay";
import { AttackRollBoostService } from "./combat/attack-roll-boost-service.js?v=1.4.96";
import { EnvironmentAutomationService } from "./combat/environment-automation-service.js?v=1.4.96-environment-stable-statuses";
import { registerMechanusRollHooks } from "./cosmology/mechanus-rolls.js?v=1.4.140-mechanus-dnd5e-activity-repair";
import { FighterAutomationService } from "./combat/fighter-automation-service.js?v=1.4.96";
import { SorcererAutomationService } from "./combat/sorcerer-automation-service.js?v=1.4.96-sorcerer-cooldown-card&cooldown-context=4";
import { ElementalAdeptAutomationService } from "./combat/elemental-adept-automation-service.js";
import {
  PaladinAutomationService,
  SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION
} from "./combat/paladin-automation-service.js?v=1.4.96";
import { PaladinDogmaAutomationService } from "./combat/paladin-dogma-automation-service.js?v=1.4.111-paladin-dogmas";
import { RogueAutomationService } from "./combat/rogue-automation-service.js?v=1.4.96-rebreya-open-position";
import {
  PERFORMER_APPLY_RESULT_COMMAND,
  PerformerAutomationService
} from "./combat/performer-automation-service.js?v=1.4.96";
import { BardicInspirationCompatService } from "./combat/bardic-inspiration-compat-service.js";
import { RaceAutomationService, SOCKET_EVENT_RACE_AUTOMATION } from "./combat/race-automation-service.js?v=1.4.147-race-damage";
import { CraftsmanGadgetService } from "./combat/craftsman-gadget-service.js";
import { CraftsmanGadgetZoneService } from "./combat/craftsman-gadget-zone-service.js";
import { CraftsmanVehicleService } from "./combat/craftsman-vehicle-service.js";
import { CraftsmanConstructorService } from "./combat/craftsman-constructor-service.js";
import {
  refreshPlayerInventoryQuickButton,
  registerSceneControlsHook
} from "./hooks.js?v=1.4.149-round-player-utilities";
import {
  extendDnd5eItemTypes,
  registerDnd5eSheetExtensions,
  registerRebreyaWeaponBaseItemsFromGearPack
} from "./integrations/dnd5e-sheet-extensions.js?v=1.4.147-native-ammunition";
import { registerHeldShieldArmorClassPatch } from "./integrations/held-shield-ac.js?v=1.4.96";
import { registerTravelMapHooks } from "./integrations/travel-map-hooks.js?v=1.4.141-auraeffects-inactive-scene";
import {
  patchDurabilityItemEffectSuppression,
  reconcileBrokenEquippedArmor,
  reconcileNativeObjectDurability,
  registerDurabilityHooks
} from "./integrations/durability-hooks.js?v=1.4.153-corpse-creature";
import { patchEffectMacroCombatHooks } from "./integrations/effectmacro-compat.js";
import { patchSmAirshipRenderSettingsHook } from "./integrations/sm-airship-compat.js";
import { registerInventorySyncHooks } from "./integrations/inventory-sync.js?v=1.4.96-durable-transfer";
import { runMapObjectTokenMacro } from "./integrations/map-object-token-macro.js?v=1.4.97-map-object-token";
import { refreshSmallTimeDateDisplay, registerSmallTimeIntegration, syncSmallTimeToCalendarTime } from "./integrations/smalltime-compat.js";
import { registerRationFoodConversionHook } from "./integrations/ration-food-conversion.js";
import { registerMagicWeaponTemplateHook } from "./integrations/magic-weapon-template.js?v=1.4.96";
import { registerStorageTokenHooks } from "./integrations/storage-token-hooks.js?v=1.4.154-corpse-storage-broken-name";
import { registerCraftsmanGadgetHooks } from "./integrations/craftsman-gadget-hooks.js";
import { registerSpellAutomationHooks } from "./integrations/spell-automation-hooks.js";
import { registerLongRestHooks } from "./integrations/long-rest-hooks.js";
import {
  registerImplantDataModelPatch,
  registerImplantHooks
} from "./integrations/implant-hooks.js";
import { registerImplantAutomationHooks } from "./integrations/implant-automation-hooks.js";
import { registerCraftsmanGadgetSocketCommand } from "./integrations/craftsman-gadget-socket.js";
import { registerSpellInstanceSocketCommand } from "./integrations/spell-instance-socket.js";
import { registerSummonLifecycleSocketCommand } from "./integrations/summon-lifecycle-socket.js";
import { registerTransportGroupDropHooks } from "./integrations/transport-group-drop.js";
import { registerStorageTransferDropHooks } from "./integrations/storage-transfer-drop.js?v=1.4.144-spreadsheet-coins-ground-repair";
import { registerStorageTokenDropHooks } from "./integrations/storage-token-drop.js?v=1.4.132-storage-owned-character-resolution";
import { registerStorageContainerHierarchyHooks } from "./integrations/storage-container-hierarchy.js?v=1.4.122-storage-container-cycle-repair";
import { registerTransportVehicleSheetHooks } from "./integrations/transport-vehicle-sheet.js";
import {
  parseStorageDragData,
  promptStorageTransferQuantity
} from "./ui/storage-transfer-ui.js";
import { getCraftsmanSubclasses } from "./integrations/craftsman-subclass-tracks.js";
import { patchTransformCleanupUpdateActorHook } from "./integrations/transform-cleanup-compat.js";
import { registerForienQuestLogIntegration, refreshForienQuestLogApps } from "./integrations/forien-quest-log.js?v=1.4.96";
import { openRebreyaQuestLog } from "./integrations/rebreya-quest-log.js";
import {
  SOCKET_EVENT_SET_SETTING,
  SOCKET_EVENT_SET_SETTING_RESULT,
  handleSettingsUpdateSocketResponse,
  registerSettings
} from "./settings.js";
import { buildLootgenChatContent, buildLootgenStatusContent, registerLootgenChatHooks } from "./ui/lootgen-chat.js?v=1.4.96-durability";
import { bringAppToFront, notifyUser, registerHandlebarsHelpers, rerenderApp } from "./ui.js";
import { promptDurabilityOutcome } from "./ui/durability-outcome-dialog.js";

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
const GROUP_CALENDAR_TRANSITION_COMMAND = "group.calendar.transition";
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
const MODULE_STYLE_VERSION = "1.4.120-storage-character-drop";
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const TRAVEL_DAY_HOURS = 8;
const COSMOLOGY_SET_MECHANUS_COMMAND = "cosmology.setMechanus";
const COMBAT_STATUS_SET_COMMAND = "combat.status.set";
const TRADER_PURCHASE_COMMAND = "trader.purchase";
const TRADER_SELL_COMMAND = "trader.sell";
export const STORAGE_OPEN_COMMAND = "storage.open";
export const STORAGE_JOURNAL_READ_COMMAND = "storage.journal.read";
export const STORAGE_CLAIM_ROW_COMMAND = "storage.claim-row";
export const STORAGE_CLAIM_COINS_COMMAND = "storage.claim-coins";
export const STORAGE_CLAIM_ALL_COMMAND = "storage.claim-all";
export const STORAGE_DEPOSIT_COMMAND = "storage.deposit";
export const STORAGE_COIN_DROP_COMMAND = "storage.coin.drop";
export const STORAGE_DROP_ITEM_COMMAND = "storage.drop-item-to-scene";
export const STORAGE_RESTORE_PORTABLE_COMMAND = "storage.restore-portable";
export const STORAGE_TOKEN_CHARACTER_COMMAND = "storage.token-to-character";
export const DURABILITY_TARGET_DAMAGE_COMMAND = "durability.target.damage";
const ENVIRONMENT_COMBAT_STATUS_IDS = new Set(["rebreya-surrounded", "rebreya-open-position"]);
const ENVIRONMENT_STATUS_SOURCE = "rebreya-environment";
const ENVIRONMENT_STATUS_VERSION = "surrounded-ac-1";
const COUNTERSPELL_AUTOMATION_ENABLED = true;
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

function cleanStoragePath(value) {
  return (Array.isArray(value) ? value : [])
    .map(cleanSocketId)
    .filter(Boolean)
    .slice(0, 8);
}

const CALENDAR_TRANSITION_BOOLEAN_OPTION_KEYS = new Set([
  "applyEnergy",
  "consumeSupplies",
  "processCraft",
  "processDailyCycles",
  "processDowntime",
  "processSupplies",
  "refreshApps",
  "refreshSmallTime"
]);
const CALENDAR_TRANSITION_INTEGER_OPTION_LIMITS = Object.freeze({
  hour: [0, 23],
  minute: [0, 59],
  monthResetCount: [0, 240],
  second: [0, 59],
  timeOfDaySeconds: [0, 86399]
});
const CALENDAR_TRANSITION_STRING_OPTION_KEYS = new Set([
  "expectedFromIsoDate",
  "monthResetMode",
  "reason",
  "toIsoDate"
]);
const CALENDAR_TRANSITION_OPTION_KEYS = new Set([
  ...CALENDAR_TRANSITION_BOOLEAN_OPTION_KEYS,
  ...Object.keys(CALENDAR_TRANSITION_INTEGER_OPTION_LIMITS),
  ...CALENDAR_TRANSITION_STRING_OPTION_KEYS
]);

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
  return hasExactKeys(payload, ["folderId", "inventoryActorId", "itemUuid", "mutationId"])
    && [payload.inventoryActorId, payload.itemUuid].every(isTrimmedNonEmptyString)
    && isValidInventoryMutationId(payload.mutationId)
    && (payload.folderId === null
      || (isTrimmedNonEmptyString(payload.folderId) && payload.folderId.length <= 160));
}

function isValidInventoryFolderIdentifier(value) {
  return isTrimmedNonEmptyString(value) && value.length <= 160;
}

function isValidNullableInventoryFolderIdentifier(value) {
  return value === null || isValidInventoryFolderIdentifier(value);
}

function isValidInventoryFolderName(value) {
  return isTrimmedNonEmptyString(value) && value.length <= 80;
}

function isValidInventoryFolderCreatePayload(payload) {
  return hasExactKeys(payload, ["folderId", "groupActorId", "name", "parentId"])
    && isValidInventoryFolderIdentifier(payload.groupActorId)
    && isValidInventoryFolderIdentifier(payload.folderId)
    && isValidInventoryFolderName(payload.name)
    && isValidNullableInventoryFolderIdentifier(payload.parentId);
}

function isValidInventoryFolderRenamePayload(payload) {
  return hasExactKeys(payload, ["folderId", "groupActorId", "name"])
    && isValidInventoryFolderIdentifier(payload.groupActorId)
    && isValidInventoryFolderIdentifier(payload.folderId)
    && isValidInventoryFolderName(payload.name);
}

function isValidInventoryFolderMovePayload(payload) {
  return hasExactKeys(payload, ["folderId", "groupActorId", "parentId"])
    && isValidInventoryFolderIdentifier(payload.groupActorId)
    && isValidInventoryFolderIdentifier(payload.folderId)
    && isValidNullableInventoryFolderIdentifier(payload.parentId);
}

function isValidInventoryFolderDeletePayload(payload) {
  return hasExactKeys(payload, ["folderId", "groupActorId"])
    && isValidInventoryFolderIdentifier(payload.groupActorId)
    && isValidInventoryFolderIdentifier(payload.folderId);
}

function isValidInventoryItemFolderMovePayload(payload) {
  return hasExactKeys(payload, ["folderId", "groupActorId", "itemId"])
    && isValidInventoryFolderIdentifier(payload.groupActorId)
    && isValidInventoryFolderIdentifier(payload.itemId)
    && isValidNullableInventoryFolderIdentifier(payload.folderId);
}

function isValidCurrencyInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isValidInventoryCurrencyValues(values) {
  return hasExactKeys(values, ["cp", "gp", "pp", "sp"])
    && ["cp", "gp", "pp", "sp"].every((key) => isValidCurrencyInteger(values[key]));
}

function isValidInventoryCurrencyUpdatePayload(payload) {
  return hasExactKeys(payload, ["inventoryActorId", "values"])
    && isTrimmedNonEmptyString(payload.inventoryActorId)
    && isValidInventoryCurrencyValues(payload.values);
}

function isValidInventoryCurrencyConvertPayload(payload) {
  return hasExactKeys(payload, ["inventoryActorId", "mode"])
    && isTrimmedNonEmptyString(payload.inventoryActorId)
    && ["normalized", "gp", "sp", "cp"].includes(payload.mode);
}

function isValidDurabilityTargetDamagePayload(payload) {
  return hasExactKeys(payload, ["amount", "damageType", "mutationId", "targetUuid"])
    && Number.isFinite(payload.amount)
    && payload.amount > 0
    && typeof payload.damageType === "string"
    && payload.damageType === payload.damageType.trim()
    && isValidInventoryMutationId(payload.mutationId)
    && isTrimmedNonEmptyString(payload.targetUuid);
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

function isCompendiumItemDocument(item) {
  return Boolean(
    item
    && (
      String(item.uuid ?? "").startsWith("Compendium.")
      || String(item.pack ?? "").trim()
    )
  );
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

function normalizeCalendarTransitionOptionsForSocket(options = {}) {
  const source = isPlainObject(options) ? options : {};
  const normalized = {};

  for (const key of CALENDAR_TRANSITION_BOOLEAN_OPTION_KEYS) {
    if (Object.hasOwn(source, key) && typeof source[key] === "boolean") {
      normalized[key] = source[key];
    }
  }

  for (const [key, [minimum, maximum]] of Object.entries(CALENDAR_TRANSITION_INTEGER_OPTION_LIMITS)) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }

    const value = Math.floor(Number(source[key]));
    if (Number.isInteger(value) && value >= minimum && value <= maximum) {
      normalized[key] = value;
    }
  }

  if (Object.hasOwn(source, "toIsoDate")) {
    normalized.toIsoDate = cleanSocketId(source.toIsoDate);
  }
  if (Object.hasOwn(source, "expectedFromIsoDate")) {
    normalized.expectedFromIsoDate = cleanSocketId(source.expectedFromIsoDate);
  }
  if (Object.hasOwn(source, "reason")) {
    const reason = cleanSocketId(source.reason).slice(0, 120);
    if (reason) {
      normalized.reason = reason;
    }
  }
  if (Object.hasOwn(source, "monthResetMode")) {
    const monthResetMode = cleanSocketId(source.monthResetMode);
    if (["crossed", "target-first"].includes(monthResetMode)) {
      normalized.monthResetMode = monthResetMode;
    }
  }

  return normalized;
}

function isValidCalendarTransitionOptions(options) {
  if (!isPlainObject(options) || !isValidIsoDate(options.toIsoDate)) {
    return false;
  }
  if (Object.keys(options).some((key) => !CALENDAR_TRANSITION_OPTION_KEYS.has(key))) {
    return false;
  }
  for (const key of CALENDAR_TRANSITION_BOOLEAN_OPTION_KEYS) {
    if (Object.hasOwn(options, key) && typeof options[key] !== "boolean") {
      return false;
    }
  }
  for (const [key, [minimum, maximum]] of Object.entries(CALENDAR_TRANSITION_INTEGER_OPTION_LIMITS)) {
    if (Object.hasOwn(options, key)
      && (!Number.isInteger(options[key]) || options[key] < minimum || options[key] > maximum)) {
      return false;
    }
  }
  if (Object.hasOwn(options, "expectedFromIsoDate") && !isValidIsoDate(options.expectedFromIsoDate)) {
    return false;
  }
  if (Object.hasOwn(options, "reason")
    && (!isTrimmedNonEmptyString(options.reason) || options.reason.length > 120)) {
    return false;
  }
  return !Object.hasOwn(options, "monthResetMode")
    || ["crossed", "target-first"].includes(options.monthResetMode);
}

function isValidCalendarTransitionPayload(payload) {
  return hasExactKeys(payload, ["groupActorId", "options"])
    && isTrimmedNonEmptyString(payload.groupActorId)
    && isValidCalendarTransitionOptions(payload.options);
}

function isValidTravelReplacePayload(payload) {
  return hasExactKeys(payload, ["groupActorId", "travelState"])
    && typeof payload.groupActorId === "string"
    && payload.groupActorId.trim().length > 0
    && isPlainObject(payload.travelState);
}

function isValidTransportReplacePayload(payload) {
  return hasExactKeys(payload, ["groupActorId", "transportState"])
    && typeof payload.groupActorId === "string"
    && payload.groupActorId.trim().length > 0
    && isPlainObject(payload.transportState);
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

function isValidActorUuid(uuid) {
  const parts = String(uuid ?? "").trim().split(".");
  if (parts.length === 2 && parts[0] === "Actor") {
    return parts.every(Boolean);
  }
  return parts.length === 6
    && parts[0] === "Scene"
    && parts[2] === "Token"
    && parts[4] === "Actor"
    && parts.every(Boolean);
}

async function resolveActorByUuid(uuid) {
  const normalizedUuid = String(uuid ?? "").trim();
  if (!isValidActorUuid(normalizedUuid)) {
    return null;
  }

  const worldActor = resolveActorFromUuid(normalizedUuid);
  if (worldActor) {
    return worldActor;
  }

  const resolver = globalThis.fromUuid;
  if (typeof resolver !== "function") {
    return null;
  }

  const actor = await resolver(normalizedUuid);
  return actor?.uuid === normalizedUuid ? actor : null;
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
  const hasActorId = typeof payload?.actorId === "string" && payload.actorId.trim().length > 0;
  const hasActorUuid = typeof payload?.actorUuid === "string" && isValidActorUuid(payload.actorUuid);
  const targetKeys = hasActorId && !hasActorUuid
    ? ["actorId", "options", "statusId"]
    : (hasActorUuid && !hasActorId ? ["actorUuid", "options", "statusId"] : null);
  return Boolean(
    targetKeys
    && hasExactKeys(payload, targetKeys)
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
    this.lootgenTemplateCatalog = new LootgenTemplateCatalog({
      get: () => globalThis.game?.settings?.get(MODULE_ID, SETTINGS_KEYS.LOOTGEN_TEMPLATES),
      set: (value) => globalThis.game?.settings?.set(MODULE_ID, SETTINGS_KEYS.LOOTGEN_TEMPLATES, value),
      randomId: () => globalThis.randomID?.()
    });
    this.repository = new EconomyRepository();
    this.materialsCompendium = new MaterialsCompendiumService();
    this.gearCompendium = new GearCompendiumService();
    this.magicItemsCompendium = new MagicItemsCompendiumService();
    this.featsCompendium = new FeatsCompendiumService();
    this.backgroundsCompendium = new BackgroundsCompendiumService();
    this.statesCompendium = new StatesCompendiumService();
    this.racesCompendium = new RacesCompendiumService();
    this.spellsCompendium = COUNTERSPELL_AUTOMATION_ENABLED
      ? new SpellsCompendiumService()
      : null;
    this.craftsmanConstructCompendium = new CraftsmanConstructCompendiumService({
      gameProvider: () => globalThis.game,
      actorProvider: () => globalThis.Actor,
      isActiveGmClient
    });
    this.transportCompendium = new TransportCompendiumService({
      gameProvider: () => globalThis.game,
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
    this.transportFuelService = new TransportFuelService({
      groupContextService: this.groupContextService
    });
    this.travelService = new TravelService({
      groupContextService: this.groupContextService,
      commandBus: this.socketCommandBus,
      fuelService: this.transportFuelService
    });
    this.travelMapService = new TravelMapService();
    this.inventoryService = new InventoryService(this);
    this.durabilityService = new DurabilityService(this);
    this.corpseStorageMaterializer = new CorpseStorageMaterializer({
      inventoryService: this.inventoryService,
      durabilityService: this.durabilityService
    });
    this.storageOpenSoundService = new StorageOpenSoundService({
      gameProvider: () => globalThis.game,
      isActiveGm: isActiveGmClient
    });
    this.storageService = new StorageService({
      generate: (form, context) => this.generateStorageLoot(form, context),
      materializeFirstOpen: ({ token }) => isDeadNpcStorageTarget(token)
        ? this.corpseStorageMaterializer.materialize(token)
        : null,
      onGeneratedOpen: ({ token }) => this.storageOpenSoundService.playForToken(token)
    });
    this.builtinStorageActorService = new BuiltinStorageActorService({
      gameProvider: () => globalThis.game,
      folderProvider: () => globalThis.Folder,
      actorProvider: () => globalThis.Actor,
      isActiveGm: isActiveGmClient
    });
    this.storageGroundPileService = new StorageGroundPileService({
      gameProvider: () => globalThis.game,
      isActiveGm: isActiveGmClient
    });
    this.storageContainerItemService = new StorageContainerItemService();
    this.storageJournalReader = new StorageJournalReader({
      fromUuid: (uuid) => globalThis.fromUuid?.(uuid),
      enrichHtml: (content, options) => (
        globalThis.CONFIG?.ux?.TextEditor?.implementation?.enrichHTML?.(content, options)
      ),
      parseHtml: createStorageJournalHtmlParser(() => globalThis.document)
    });
    this.nativeObjectDurabilityService = new NativeObjectDurabilityService({
      durabilityService: this.durabilityService,
      storageService: this.storageService,
      groundPileService: this.storageGroundPileService,
      mutationCoordinator: this.worldMutationCoordinator,
      isActiveGm: () => isActiveGmClient(globalThis.game),
      resolveUuid: (uuid) => globalThis.fromUuid?.(uuid)
    });
    this.promptDurabilityOutcome = promptDurabilityOutcome;
    this.durabilityOutcomeTasks = new Map();
    this.storageCommandService = new StorageCommandService({
      storageService: this.storageService,
      inventoryService: this.inventoryService,
      resolveToken: (uuid) => globalThis.fromUuid?.(uuid),
      measureDistance: measureStorageTokenDistance,
      measurePointDistance: measureStoragePointDistance,
      groundPileService: this.storageGroundPileService,
      containerItemService: this.storageContainerItemService,
      durabilityService: this.durabilityService,
      journalReader: this.storageJournalReader,
      isVisibleTo: (storageToken) => isStorageTokenVisible(storageToken),
      createChatMessage: (data) => globalThis.ChatMessage?.create?.(data)
    });
    this.transportInstanceService = new TransportInstanceService(this, {
      gameProvider: () => globalThis.game,
      actorProvider: () => globalThis.Actor,
      fromUuid: (uuid) => globalThis.fromUuid(uuid)
    });
    this.travelService.setSpeedProvider((context) => this.inventoryService.getActiveTransportSpeedMeta({ context }));
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
    this.implantService = new ImplantService(this);
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
    this.longRestPipelineService = new LongRestPipelineService({
      logger: console,
      notifyError: (message) => globalThis.ui?.notifications?.error?.(message)
    });
    this.runeKnightAutomationService = new RuneKnightAutomationService(this);
    this.curseEaterAutomationService = new CurseEaterAutomationService();
    this.combatStatusService = new CombatStatusService(this);
    this.implantAutomationService = new ImplantAutomationService(this);
    this.combatAttackService = new CombatAttackService(this);
    this.sizeAutomationService = new SizeAutomationService(this);
    this.spellAutomationRegistry = new SpellAutomationRegistry();
    this.spellInstanceRuntime = new SpellInstanceRuntime({
      registry: this.spellAutomationRegistry,
      coordinator: this.worldMutationCoordinator,
      socketCommandBus: this.socketCommandBus
    });
    this.summonLifecycleRuntime = new SummonLifecycleRuntime({
      registry: this.spellAutomationRegistry,
      coordinator: this.worldMutationCoordinator,
      socketCommandBus: this.socketCommandBus,
      operationIdFactory: () => createSocketRequestId("summon")
    });
    this.melfsMinuteMeteorsRecipe = buildMelfsMinuteMeteorsRecipe({
      instanceRuntime: this.spellInstanceRuntime
    });
    this.melfsMinuteMeteorsRecipe = this.spellInstanceRuntime.registerRecipe(this.melfsMinuteMeteorsRecipe);
    this.spellInterceptionRuntime = new SpellInterceptionRuntime({
      registry: this.spellAutomationRegistry
    });
    this.spellAreaRuntime = new SpellAreaRuntime({
      registry: this.spellAutomationRegistry
    });
    this.spellAutomationHookBridge = new SpellAutomationHookBridge({
      registry: this.spellAutomationRegistry
    });
    this.spellAutomationService = COUNTERSPELL_AUTOMATION_ENABLED
      ? new SpellAutomationService(this)
      : null;
    this.attackRollBoostService = new AttackRollBoostService(this);
    this.environmentAutomationService = new EnvironmentAutomationService(this);
    this.fighterAutomationService = new FighterAutomationService(this);
    this.sorcererAutomationService = new SorcererAutomationService(this);
    this.elementalAdeptAutomationService = new ElementalAdeptAutomationService(this);
    this.paladinAutomationService = new PaladinAutomationService(this);
    this.paladinDogmaAutomationService = new PaladinDogmaAutomationService(this);
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
      isActiveGmClient: () => isActiveGmClient(globalThis.game),
      hasActiveGm: () => Boolean(getActiveGm(globalThis.game))
    });
    this.craftsmanConstructorService = new CraftsmanConstructorService({
      mapObjectTokenService: this.mapObjectTokenService,
      getCraftsmanSubclasses,
      sceneDocuments: () => globalThis.game?.scenes,
      isActiveGmClient: () => isActiveGmClient(globalThis.game)
    });
    for (const service of [
      this.runeKnightAutomationService,
      this.performerAutomationService,
      this.fighterAutomationService,
      this.sorcererAutomationService,
      this.raceAutomationService,
      this.paladinAutomationService,
      this.craftsmanGadgetService,
      this.craftsmanConstructorService,
      this.implantService
    ]) {
      service.registerLongRestSteps?.(this.longRestPipelineService);
    }
    this.featChoiceAutomationService = new FeatChoiceAutomationService(this);
    this.repository.setGlobalEventsService(this.globalEventsService);
    this.economyApp = null;
    this.worldTradeRoutesApp = null;
    this.statesApp = null;
    this.globalEventsApp = null;
    this.inventoryApp = null;
    this.inventoryFolderApps = new Map();
    this.groupsApp = null;
    this.cosmologyApp = null;
    this.lootgenApps = new Map();
    this.lootgenCounter = 0;
    this.latestLootgenResult = null;
    this.storageApps = new Map();
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

  getSpellAutomationDiagnostics() {
    return Object.freeze({
      recipes: this.spellAutomationRegistry.listKeys(),
      activeOperations: this.spellInstanceRuntime.activeOperationCount,
      pendingSummonClaims: this.summonLifecycleRuntime.pendingClaimCount
    });
  }

  registerSummonProvider(provider) {
    return this.summonLifecycleRuntime.registerProvider(provider);
  }

  #registerTypedSocketCommands() {
    registerCraftsmanGadgetSocketCommand(this);
    registerSpellInstanceSocketCommand(this);
    registerSummonLifecycleSocketCommand(this);
    registerTransportInstanceCommands(this.socketCommandBus, this.transportInstanceService);
    const authorizeGroup = (payload, { sender }) => this.#canSenderManageGroup(sender, payload.groupActorId);
    this.socketCommandBus.register(GROUP_CALENDAR_PATCH_COMMAND, {
      validate: isValidCalendarPatchPayload,
      authorize: authorizeGroup,
      execute: (payload) => this.calendarService.patchGroupCalendar(payload.groupActorId, payload.patch)
    });
    this.socketCommandBus.register(GROUP_CALENDAR_TRANSITION_COMMAND, {
      validate: isValidCalendarTransitionPayload,
      authorize: authorizeGroup,
      execute: (payload) => this.calendarTransitionCoordinator.moveTo(payload.options)
    });
    this.socketCommandBus.register(GROUP_TRAVEL_REPLACE_STATE_COMMAND, {
      validate: isValidTravelReplacePayload,
      authorize: authorizeGroup,
      execute: (payload) => this.travelService.replaceGroupTravelState(
        payload.groupActorId,
        normalizeTravelState(payload.travelState)
      )
    });
    this.socketCommandBus.register(GROUP_TRANSPORT_REPLACE_STATE_COMMAND, {
      validate: isValidTransportReplacePayload,
      authorize: authorizeGroup,
      execute: (payload) => this.inventoryService.replaceGroupTransportState(
        payload.groupActorId,
        normalizeGroupTransportState(payload.transportState)
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
    this.socketCommandBus.register(INVENTORY_CURRENCY_UPDATE_COMMAND, {
      validate: isValidInventoryCurrencyUpdatePayload,
      authorize: (payload, { sender }) => this.#canSenderManageGroup(sender, payload.inventoryActorId),
      execute: (payload) => this.inventoryService.executeCurrencyUpdateMutation(payload)
    });
    this.socketCommandBus.register(INVENTORY_CURRENCY_CONVERT_COMMAND, {
      validate: isValidInventoryCurrencyConvertPayload,
      authorize: (payload, { sender }) => this.#canSenderManageGroup(sender, payload.inventoryActorId),
      execute: (payload) => this.inventoryService.executeCurrencyConvertMutation(payload)
    });
    const registerInventoryFolderMutation = (command, validate, methodName) => {
      this.socketCommandBus.register(command, {
        validate,
        authorize: authorizeGroup,
        execute: async (payload) => {
          try {
            return await this.runInventoryMutation(
              () => this.inventoryService[methodName](payload),
              { actorIdsFromResult: (result) => [result?.actorId] }
            );
          }
          catch (error) {
            throw new Error(error?.message || "Inventory folder mutation failed.", { cause: error });
          }
        }
      });
    };
    registerInventoryFolderMutation(
      INVENTORY_FOLDER_CREATE_COMMAND,
      isValidInventoryFolderCreatePayload,
      "createInventoryFolder"
    );
    registerInventoryFolderMutation(
      INVENTORY_FOLDER_RENAME_COMMAND,
      isValidInventoryFolderRenamePayload,
      "renameInventoryFolder"
    );
    registerInventoryFolderMutation(
      INVENTORY_FOLDER_MOVE_COMMAND,
      isValidInventoryFolderMovePayload,
      "moveInventoryFolder"
    );
    registerInventoryFolderMutation(
      INVENTORY_FOLDER_DELETE_COMMAND,
      isValidInventoryFolderDeletePayload,
      "deleteInventoryFolder"
    );
    registerInventoryFolderMutation(
      INVENTORY_ITEM_FOLDER_MOVE_COMMAND,
      isValidInventoryItemFolderMovePayload,
      "moveInventoryItemToFolder"
    );
    this.socketCommandBus.register(STORAGE_OPEN_COMMAND, {
      validate: isValidStorageOpenPayload,
      authorize: (_payload, { sender }) => Boolean(sender),
      execute: (payload, { sender }) => this.storageCommandService.open(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_JOURNAL_READ_COMMAND, {
      validate: isValidStorageJournalReadPayload,
      authorize: (_payload, { sender }) => Boolean(sender),
      execute: (payload, { sender }) => this.storageCommandService.readJournal(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_CLAIM_ROW_COMMAND, {
      validate: isValidStorageClaimRowPayload,
      authorize: (payload, { sender }) => Boolean(sender)
        && (payload.destination !== "party"
          || this.#canSenderManageGroup(sender, payload.target.groupActorId)),
      execute: (payload, { sender }) => this.storageCommandService.claimRow(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_CLAIM_COINS_COMMAND, {
      validate: isValidStorageClaimCoinsPayload,
      authorize: (_payload, { sender }) => Boolean(sender),
      execute: (payload, { sender }) => this.storageCommandService.claimCoins(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_CLAIM_ALL_COMMAND, {
      validate: isValidStorageClaimAllPayload,
      authorize: (payload, { sender }) => Boolean(sender)
        && (payload.destination !== "party"
          || this.#canSenderManageGroup(sender, payload.target.groupActorId)),
      execute: (payload, { sender }) => this.storageCommandService.claimAll(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_DEPOSIT_COMMAND, {
      validate: isValidStorageDepositPayload,
      authorize: (_payload, { sender }) => Boolean(sender),
      execute: (payload, { sender }) => this.storageCommandService.deposit(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_COIN_DROP_COMMAND, {
      validate: isValidStorageCoinDropPayload,
      authorize: (_payload, { sender }) => Boolean(sender),
      execute: (payload, { sender }) => this.storageCommandService.dropCoinsToScene(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_DROP_ITEM_COMMAND, {
      validate: isValidStorageDropItemPayload,
      authorize: (_payload, { sender }) => Boolean(sender),
      execute: (payload, { sender }) => this.storageCommandService.dropItemToScene(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_RESTORE_PORTABLE_COMMAND, {
      validate: isValidStorageRestorePortablePayload,
      authorize: (_payload, { sender }) => Boolean(sender),
      execute: (payload, { sender }) => this.storageCommandService.restorePortableItem(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_TOKEN_CHARACTER_COMMAND, {
      validate: isValidStorageTokenCharacterPayload,
      authorize: (_payload, { sender }) => Boolean(sender),
      execute: (payload, { sender }) => this.storageCommandService.moveStorageTokenToCharacter(payload, { sender })
    });
    this.socketCommandBus.register(DURABILITY_TARGET_DAMAGE_COMMAND, {
      validate: isValidDurabilityTargetDamagePayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload) => this.#damageDurabilityTargetOnActiveGm(payload.targetUuid, payload)
    });
    const authorizeTradeActor = (payload, { sender }) => traderActorIsOwnedByUser(
      globalThis.game?.actors?.get?.(payload.actorId)
        ?? globalThis.game?.actors?.contents?.find?.((actor) => String(actor?.id) === payload.actorId),
      sender
    );
    this.socketCommandBus.register(TRADER_PURCHASE_COMMAND, {
      validate: isValidTraderPurchasePayload,
      authorize: authorizeTradeActor,
      execute: async (payload, { sender }) => {
        await this.traderService.ensureTraderState(payload.cityId, payload.traderKey);
        return this.tradeTransactionService.purchase({
          transactionId: payload.transactionId,
          actorId: payload.actorId,
          cityId: payload.cityId,
          traderKey: payload.traderKey,
          itemKey: payload.itemKey,
          quantity: payload.quantity,
          requestedByUserId: sender.id
        }, { source: "typed-socket" });
      }
    });
    this.socketCommandBus.register(TRADER_SELL_COMMAND, {
      validate: isValidTraderSalePayload,
      authorize: authorizeTradeActor,
      execute: async (payload, { sender }) => {
        await this.traderService.ensureTraderState(payload.cityId, payload.traderKey);
        return this.tradeTransactionService.sale({
          transactionId: payload.transactionId,
          actorId: payload.actorId,
          cityId: payload.cityId,
          traderKey: payload.traderKey,
          itemUuid: payload.itemUuid,
          quantity: payload.quantity,
          requestedByUserId: sender.id
        }, { source: "typed-socket" });
      }
    });
  }

  async #canSenderSetCombatStatus(sender, payload) {
    if (sender?.isGM) {
      return true;
    }

    if (!isValidCombatStatusSetPayload(payload)) {
      return false;
    }

    if (payload.options.active === false) {
      const targetActor = payload.actorUuid
        ? await resolveActorByUuid(payload.actorUuid)
        : resolveActorById(payload.actorId);
      const current = this.combatStatusService.getStatus(targetActor, payload.statusId);
      return current?.active === true && current?.meta?.source === ENVIRONMENT_STATUS_SOURCE;
    }

    const sourceActor = await resolveActorByUuid(payload.options.meta?.sourceActorUuid);
    return actorIsOwnedByUser(sourceActor, sender);
  }

  async #executeCombatStatusSetCommand(payload) {
    const actor = payload.actorUuid
      ? await resolveActorByUuid(payload.actorUuid)
      : resolveActorById(payload.actorId);
    const result = await this.combatStatusService.setStatus(actor, payload.statusId, payload.options);
    await this.refreshOpenApps();
    return this.combatStatusService.getStatus(actor, payload.statusId) ?? Boolean(result);
  }

  #shouldRouteCombatStatus(actor, statusInput, options = {}) {
    if (globalThis.game?.user?.isGM) {
      return false;
    }

    const statusId = this.combatStatusService.normalizeStatusId(statusInput, String(statusInput ?? "").trim());
    const socketOptions = normalizeCombatStatusOptionsForSocket(options);
    return isEnvironmentCombatStatusOptions(statusId, socketOptions);
  }

  #combatStatusPayload(actor, statusInput, options = {}) {
    const actorId = normalizeDocumentId(actor);
    const actorUuid = String(actor?.uuid ?? "").trim();
    const statusId = this.combatStatusService.normalizeStatusId(statusInput, String(statusInput ?? "").trim());
    return {
      ...(isValidActorUuid(actorUuid) && !/^Actor\.[^.]+$/u.test(actorUuid)
        ? { actorUuid }
        : { actorId }),
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
    if (!sourceActor) {
      return isCompendiumItemDocument(item);
    }
    return traderActorIsOwnedByUser(sourceActor, sender)
      && getGroupMemberActors(groupActor).some((actor) => actor?.id === sourceActor?.id);
  }

  async restoreBuiltinStorageActors() {
    try {
      return await this.builtinStorageActorService.sync();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to restore built-in storage actors.`, error);
      return null;
    }
  }

  async initialize() {
    if (globalThis.game?.user?.isGM === true) {
      try {
        await this.lootgenTemplateCatalog.migrate();
      }
      catch (error) {
        console.warn(`${MODULE_ID} | Failed to migrate Lootgen templates.`, error);
      }
    }

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
      const ammunitionRepair = await repairWorldAmmunitionCompatibility(globalThis.game);
      if (!ammunitionRepair.skipped && (
        ammunitionRepair.updatedWeapons > 0
        || ammunitionRepair.updatedAmmunition > 0
        || ammunitionRepair.failedActors > 0
      )) {
        console.log(`${MODULE_ID} | Ammunition compatibility repaired`, ammunitionRepair);
      }
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to repair native ammunition compatibility.`, error);
    }
    try {
      await this.mapObjectTokenService.syncManagedDocuments();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to sync managed map object documents.`, error);
    }
    await this.restoreBuiltinStorageActors();
    if (isActiveGmClient(globalThis.game)) {
      try {
        await this.storageGroundPileService.repairLegacyCoinRows();
      }
      catch (error) {
        console.warn(`${MODULE_ID} | Failed to repair legacy ground coin rows.`, error);
      }
    }
    try {
      await this.storageOpenSoundService.cleanupStale(globalThis.canvas?.scene);
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to clean stale storage sounds.`, error);
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
      await this.curseEaterAutomationService.initialize();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to initialize Curse Eater automation.`, error);
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

    if (this.spellAutomationService) {
      try {
        await this.spellAutomationService.initialize();
      }
      catch (error) {
        console.warn(`${MODULE_ID} | Failed to initialize spell reaction automation.`, error);
      }
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

    if (this.spellsCompendium) {
      try {
        await this.spellsCompendium.sync();
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to sync spells compendium.`, error);
        ui.notifications?.warn("Не удалось синхронизировать компендиум заклинаний Rebreya.");
      }
    }

    try {
      await this.transportCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync transport compendium.`, error);
      ui.notifications?.warn("Не удалось синхронизировать компендиум транспорта Ребреи.");
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
    return this.damageDurabilityTarget(item, options);
  }

  async damageDurabilityTarget(target, options = {}) {
    const amount = Number(options?.amount);
    const damageType = String(options?.damageType ?? "").trim();
    const mutationId = String(options?.mutationId ?? "").trim()
      || createSocketRequestId("durability-target");
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Урон прочности должен быть положительным числом.");
    }
    if (isActiveGmClient(globalThis.game)) {
      return this.#damageDurabilityTargetOnActiveGm(target, { amount, damageType, mutationId });
    }
    const resolved = await this.nativeObjectDurabilityService.resolve(target);
    const targetUuid = String(resolved?.item?.uuid ?? resolved?.token?.uuid ?? resolved?.uuid ?? "").trim();
    if (!targetUuid) return { outcome: "ignored", nextFlag: null, appliedDamage: 0 };
    return this.socketCommandBus.request(DURABILITY_TARGET_DAMAGE_COMMAND, {
      amount,
      damageType,
      mutationId,
      targetUuid
    });
  }

  async #damageDurabilityTargetOnActiveGm(target, options = {}) {
    const resolved = await this.nativeObjectDurabilityService.resolve(target);
    if (!resolved) return { outcome: "ignored", nextFlag: null, appliedDamage: 0 };
    const transition = await this.nativeObjectDurabilityService.damage(target, options);
    if (transition?.outcome !== "depleted") return transition;
    const key = String(resolved.uuid ?? resolved.item?.uuid ?? resolved.token?.uuid ?? "").trim();
    const previous = this.durabilityOutcomeTasks.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      const current = await this.nativeObjectDurabilityService.resolve(target);
      const state = String(
        current?.durability?.state
        ?? current?.item?.flags?.[MODULE_ID]?.durability?.state
        ?? current?.token?.flags?.[MODULE_ID]?.objectDurability?.state
        ?? "intact"
      ).trim();
      if (["broken", "destroyed"].includes(state)) return transition;
      const name = String(current?.row?.name ?? current?.item?.name ?? current?.token?.name ?? "Предмет").trim();
      const choice = await this.promptDurabilityOutcome({ name });
      if (!choice) return transition;
      return this.nativeObjectDurabilityService.resolveDepletion(target, choice, {
        mutationId: options.mutationId
      });
    });
    this.durabilityOutcomeTasks.set(key, task);
    try {
      return await task;
    }
    finally {
      if (this.durabilityOutcomeTasks.get(key) === task) this.durabilityOutcomeTasks.delete(key);
    }
  }

  resolveDurabilityOutcome(target, choice, options = {}) {
    return this.nativeObjectDurabilityService.resolveDepletion(target, choice, options);
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

  resolveCraftProgressBase(actorOrContext) {
    const actorId = typeof actorOrContext === "string"
      ? actorOrContext
      : String(actorOrContext?.actorId ?? "").trim();
    const actor = actorId
      ? resolveActorById(actorId)
      : actorOrContext;
    return this.implantAutomationService.resolveCraftProgressBase(actor, {
      baseGold: 5,
      construct: false
    });
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

  registerLongRestStep(definition) {
    return this.longRestPipelineService.registerStep(definition);
  }

  runLongRestPipeline(actor, result = {}, config = {}) {
    return this.longRestPipelineService.enqueue(actor, result, config);
  }

  getRecentLongRestRuns() {
    return this.longRestPipelineService.getRecentRuns();
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

  async getPublicCitySnapshot(cityId) {
    const model = await this.getModel();
    const city = this.getCitySnapshot(cityId);
    if (!city) return null;
    let traders = [];
    let tradersError = "";
    try {
      traders = await this.getCityTraderSummaries(cityId);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to load public traders for '${cityId}'.`, error);
      tradersError = "Не удалось загрузить торговцев города.";
    }
    return buildPublicCitySnapshot({
      model,
      city,
      presentation: this.repository.getCityPresentation(cityId),
      traders,
      tradersError
    });
  }

  async getPublicEconomySnapshot() {
    const model = await this.getModel();
    return buildPublicEconomySnapshot(model, this.repository.getCityPresentations());
  }

  getCityPresentation(cityId) {
    return this.repository.getCityPresentation(cityId);
  }

  async updateCityPresentation(cityId, patch = {}) {
    if (game.user?.isGM !== true) throw new Error("City presentation updates require a GM");
    const result = await this.repository.updateCityPresentation(cityId, patch);
    await this.refreshCityViews({ cityIds: [cityId] });
    return result;
  }

  async resetCityPresentation(cityId, fields = ["description", "image"]) {
    if (game.user?.isGM !== true) throw new Error("City presentation updates require a GM");
    const allowed = new Set(["description", "image"]);
    const patch = Object.fromEntries((fields ?? []).filter((field) => allowed.has(field)).map((field) => [field, null]));
    if (!Object.keys(patch).length) return this.getCityPresentation(cityId);
    const result = await this.repository.updateCityPresentation(cityId, patch);
    await this.refreshCityViews({ cityIds: [cityId] });
    return result;
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
      await this.traderService.ensureTraderState(cityId, traderKey);
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
      await this.traderService.ensureTraderState(cityId, traderKey);
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

  async getTransportSnapshot(options = {}) {
    return this.inventoryService.getTransportSnapshot(options);
  }

  #controlledCharacterTokenUuid(explicitUuid = "") {
    const requested = cleanSocketId(explicitUuid);
    if (requested) return requested;
    const token = (globalThis.canvas?.tokens?.controlled ?? [])
      .find((candidate) => candidate?.actor?.type === "character");
    return cleanSocketId(token?.document?.uuid ?? token?.uuid);
  }

  async openStorage(tokenUuid, request = {}) {
    const path = cleanStoragePath(request.path);
    const payload = {
      tokenUuid: cleanSocketId(tokenUuid),
      characterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
      ...(path.length ? { path } : {})
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.open(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_OPEN_COMMAND, payload);
  }

  async readStorageJournal(tokenUuid, rowId, request = {}) {
    const path = cleanStoragePath(request.path);
    const payload = {
      tokenUuid: cleanSocketId(tokenUuid),
      characterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
      rowId: cleanSocketId(rowId),
      ...(path.length ? { path } : {})
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.readJournal(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_JOURNAL_READ_COMMAND, payload);
  }

  async claimStorageRow(tokenUuid, rowId, destination, mutationId, request = {}) {
    const safeTokenUuid = cleanSocketId(tokenUuid);
    const safeDestination = cleanSocketId(destination);
    const path = cleanStoragePath(request.path);
    let target = null;
    if (safeDestination === "character") {
      target = { actorUuid: cleanSocketId(request.target?.actorUuid) };
    }
    else if (safeDestination === "scene") {
      target = {
        sceneId: cleanSocketId(request.target?.sceneId),
        x: Number(request.target?.x),
        y: Number(request.target?.y)
      };
    }
    else if (safeDestination === "party") {
      const requestedGroupActorId = cleanSocketId(request.target?.groupActorId);
      const groupActor = await this.inventoryService.getInventoryActor({
        create: false,
        groupActorId: requestedGroupActorId
      });
      if (!groupActor || groupActor.type !== "group") {
        throw new Error("Не удалось разрешить групповой инвентарь для переноса.");
      }
      target = {
        groupActorId: cleanSocketId(groupActor.id),
        folderId: request.target?.folderId === null || request.target?.folderId === undefined
          ? null
          : cleanSocketId(request.target.folderId)
      };
    }
    const payload = {
      tokenUuid: safeTokenUuid,
      characterTokenUuid: storageCharacterTokenUuidForClaim({
        controlledCharacterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
        storageTokenUuid: safeTokenUuid,
        destination: safeDestination,
        isGM: globalThis.game?.user?.isGM === true
      }),
      rowId: cleanSocketId(rowId),
      destination: safeDestination,
      quantity: request.quantity === undefined ? null : Number(request.quantity),
      target,
      mutationId: cleanSocketId(mutationId),
      ...(path.length ? { path } : {})
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.claimRow(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_CLAIM_ROW_COMMAND, payload);
  }

  async claimStorageCoins(tokenUuid, destination, mutationId, request = {}) {
    const safeTokenUuid = cleanSocketId(tokenUuid);
    const safeDestination = cleanSocketId(destination);
    const path = cleanStoragePath(request.path);
    const payload = {
      tokenUuid: safeTokenUuid,
      characterTokenUuid: storageCharacterTokenUuidForClaim({
        controlledCharacterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
        storageTokenUuid: safeTokenUuid,
        destination: safeDestination,
        isGM: globalThis.game?.user?.isGM === true
      }),
      destination: safeDestination,
      mutationId: cleanSocketId(mutationId),
      ...(path.length ? { path } : {})
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.claimCoins(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_CLAIM_COINS_COMMAND, payload);
  }

  async claimStorageAll(tokenUuid, destination, mutationId, request = {}) {
    const safeTokenUuid = cleanSocketId(tokenUuid);
    const safeDestination = cleanSocketId(destination);
    const path = cleanStoragePath(request.path);
    let target = null;
    if (safeDestination === "party") {
      const requestedGroupActorId = cleanSocketId(request.target?.groupActorId);
      const groupActor = await this.inventoryService.getInventoryActor({
        create: false,
        groupActorId: requestedGroupActorId
      });
      if (!groupActor || groupActor.type !== "group") {
        throw new Error("Не удалось разрешить групповой инвентарь для массового переноса.");
      }
      target = {
        groupActorId: cleanSocketId(groupActor.id),
        folderId: request.target?.folderId === null || request.target?.folderId === undefined
          ? null
          : cleanSocketId(request.target.folderId)
      };
    }
    const payload = {
      tokenUuid: safeTokenUuid,
      characterTokenUuid: storageCharacterTokenUuidForClaim({
        controlledCharacterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
        storageTokenUuid: safeTokenUuid,
        destination: safeDestination,
        isGM: globalThis.game?.user?.isGM === true
      }),
      destination: safeDestination,
      target,
      mutationId: cleanSocketId(mutationId),
      ...(path.length ? { path } : {})
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.claimAll(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_CLAIM_ALL_COMMAND, payload);
  }

  async inspectStorageDepositSource(dragData) {
    const source = parseStorageDepositDragData(dragData);
    if (!source) throw new Error("Перетащите предмет или строку другого хранилища.");
    const resolved = await resolveStorageDepositSource(source, {
      fromUuid: (uuid) => globalThis.fromUuid?.(uuid),
      resolveToken: (uuid) => globalThis.fromUuid?.(uuid),
      storageService: this.storageService,
      containerItemService: this.storageContainerItemService
    });
    return {
      source,
      kind: resolved.kind,
      denomination: resolved.denomination,
      available: resolved.available,
      mode: resolved.mode,
      name: cleanSocketId(resolved.row?.name ?? resolved.item?.name),
      img: cleanSocketId(resolved.row?.img ?? resolved.item?.img)
    };
  }

  async depositStorageItem(tokenUuid, source, quantity, mutationId, request = {}) {
    const safeSource = source?.kind === "storage-row"
      ? {
          kind: "storage-row",
          tokenUuid: cleanSocketId(source.tokenUuid),
          rowId: cleanSocketId(source.rowId),
          quantity: Number(source.quantity),
          ...(cleanStoragePath(source.path).length ? { path: cleanStoragePath(source.path) } : {})
        }
      : source?.kind === "storage-token"
        ? {
            kind: "storage-token",
            tokenUuid: cleanSocketId(source.tokenUuid)
          }
      : source?.kind === "journal"
        ? {
            kind: "journal",
            journalUuid: cleanSocketId(source.journalUuid)
          }
      : {
          kind: "item",
          itemUuid: cleanSocketId(source?.itemUuid)
        };
    const path = cleanStoragePath(request.path);
    const payload = {
      tokenUuid: cleanSocketId(tokenUuid),
      characterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
      source: safeSource,
      quantity: Number(quantity),
      mutationId: cleanSocketId(mutationId),
      ...(path.length ? { path } : {})
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.deposit(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_DEPOSIT_COMMAND, payload);
  }

  async dropPortableStorageItemToScene(itemUuid, request = {}) {
    const payload = {
      itemUuid: cleanSocketId(itemUuid),
      characterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
      sceneId: cleanSocketId(request.sceneId),
      x: Number(request.x),
      y: Number(request.y),
      mutationId: cleanSocketId(request.mutationId) || createSocketRequestId("storage-portable-scene")
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.restorePortableItem(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_RESTORE_PORTABLE_COMMAND, payload);
  }

  async dropStorageItemToScene(itemUuid, request = {}) {
    const payload = {
      itemUuid: cleanSocketId(itemUuid),
      characterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
      sceneId: cleanSocketId(request.sceneId),
      x: Number(request.x),
      y: Number(request.y),
      quantity: Number(request.quantity),
      mutationId: cleanSocketId(request.mutationId) || createSocketRequestId("storage-item-scene")
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.dropItemToScene(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_DROP_ITEM_COMMAND, payload);
  }

  async dropStorageCoinsToScene(itemUuid, denomination, request = {}) {
    const payload = {
      itemUuid: cleanSocketId(itemUuid),
      denomination: cleanSocketId(denomination),
      characterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
      sceneId: cleanSocketId(request.sceneId),
      x: Number(request.x),
      y: Number(request.y),
      quantity: Number(request.quantity),
      mutationId: cleanSocketId(request.mutationId) || createSocketRequestId("storage-coin-scene")
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.dropCoinsToScene(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_COIN_DROP_COMMAND, payload);
  }

  async moveStorageTokenToCharacter(tokenUuid, actorUuid, mutationId, request = {}) {
    const payload = {
      tokenUuid: cleanSocketId(tokenUuid),
      characterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
      actorUuid: cleanSocketId(actorUuid),
      mutationId: cleanSocketId(mutationId) || createSocketRequestId("storage-token-character")
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.moveStorageTokenToCharacter(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_TOKEN_CHARACTER_COMMAND, payload);
  }

  async #resolveStorageToken(tokenUuid, {
    allowCorpse = false,
    allowMaterializedCorpse = false
  } = {}) {
    const document = await globalThis.fromUuid?.(cleanSocketId(tokenUuid));
    const token = document?.document ?? document;
    if (!token?.actor) throw new Error("Токен хранилища не найден.");
    const materializedCorpse = allowMaterializedCorpse
      && isDeadNpcStorageTarget(token)
      && isMaterializedCorpseStorageState(readStorageState(token));
    if (!isStorageActor(token.actor)
      && !(allowCorpse && isDeadNpcStorageTarget(token))
      && !materializedCorpse) {
      throw new Error("Токен не отмечен как хранилище Rebreya.");
    }
    return token;
  }

  async getStorageSnapshot(tokenUuid, request = {}) {
    const token = await this.#resolveStorageToken(tokenUuid, { allowCorpse: true });
    const path = cleanStoragePath(request.path);
    const state = readStorageStateAtPath(token, path);
    const combinedRows = [...state.manualRows, ...state.generatedRows];
    const canManage = globalThis.game?.user?.isGM === true;
    const rows = combinedRows
      .map((row, index) => {
        const next = { ...foundry.utils.deepClone(row), rowId: cleanSocketId(row.rowId ?? index) };
        next.journalRead = next.rowKind === "journal" && state.readJournalRowIds.includes(next.rowId);
        if (next.rowKind === "container" && next.container) {
          next.container = {
            containerId: cleanSocketId(next.container.containerId),
            storageKind: cleanSocketId(next.container.storageKind),
            name: cleanSocketId(next.container.name),
            img: cleanSocketId(next.container.img),
            state: cleanSocketId(next.container.state?.state)
          };
        }
        if (!canManage && isStorageJournalRow(next)) delete next.sourceId;
        return next;
      })
      .filter((row) => !state.claimedRowIds.includes(row.rowId));
    const coins = Object.fromEntries(["pp", "gp", "sp", "cp"].map((key) => [
      key,
      state.coinsClaimed
        ? 0
        : Math.max(0, Math.trunc(Number(state.manualCoins?.[key] ?? 0) + Number(state.generatedCoins?.[key] ?? 0)))
    ]));
    return {
      tokenUuid: cleanSocketId(token.uuid ?? tokenUuid),
      path,
      name: path.length ? state.baseName : cleanSocketId(token.name),
      state: state.state,
      rows,
      coins,
      ...(canManage ? {
        baseName: state.baseName,
        template: foundry.utils.deepClone(state.template),
        manualRows: foundry.utils.deepClone(state.manualRows),
        manualCoins: foundry.utils.deepClone(state.manualCoins),
        textures: foundry.utils.deepClone(state.textures),
        displayMode: state.displayMode
      } : {})
    };
  }

  async configureStorageToken(tokenUuid, config = {}, request = {}) {
    if (!globalThis.game?.user?.isGM) {
      throw new Error("Настраивать хранилища может только мастер.");
    }
    const token = await this.#resolveStorageToken(tokenUuid, { allowMaterializedCorpse: true });
    const path = cleanStoragePath(request.path);
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(config, "baseName")) {
      patch.baseName = cleanSocketId(config.baseName) || cleanSocketId(token.name) || "Хранилище";
    }
    if (Object.prototype.hasOwnProperty.call(config, "templateId")) {
      const templateId = cleanSocketId(config.templateId);
      const template = templateId ? this.lootgenTemplateCatalog.get(templateId) : null;
      if (templateId && !template) throw new Error("Шаблон Lootgen не найден.");
      patch.template = template ? { name: template.name, form: template.form } : null;
    }
    return this.storageService.configure(token, patch, { path });
  }

  async markStorageActor(actorUuid) {
    if (!globalThis.game?.user?.isGM) throw new Error("Создавать хранилища может только мастер.");
    const actor = await globalThis.fromUuid?.(cleanSocketId(actorUuid));
    if (!actor || actor.type !== "npc") {
      throw new Error("Хранилищем можно сделать только NPC-актёра.");
    }
    if (typeof actor.setFlag === "function") {
      await actor.setFlag(MODULE_ID, "storage", { enabled: true });
    }
    else {
      await actor.update({ [`flags.${MODULE_ID}.storage`]: { enabled: true } });
    }
    globalThis.ui?.notifications?.info(`Актёр «${actor.name}» отмечен как хранилище.`);
    return actor;
  }

  async addManualStorageItem(tokenUuid, itemUuid, request = {}) {
    if (!globalThis.game?.user?.isGM) throw new Error("Добавлять предметы может только мастер.");
    const [token, item] = await Promise.all([
      this.#resolveStorageToken(tokenUuid, { allowMaterializedCorpse: true }),
      globalThis.fromUuid?.(cleanSocketId(itemUuid))
    ]);
    if (!item || item.documentName !== "Item" && !(globalThis.Item && item instanceof globalThis.Item)) {
      throw new Error("Перетащенный предмет не найден.");
    }
    const path = cleanStoragePath(request.path);
    const state = readStorageStateAtPath(token, path);
    const itemData = foundry.utils.deepClone(item.toObject());
    delete itemData._id;
    delete itemData.folder;
    delete itemData.sort;
    delete itemData.ownership;
    delete itemData._stats;
    const quantity = Math.max(1, Number(foundry.utils.getProperty(itemData, "system.quantity") ?? 1));
    const row = {
      rowId: createSocketRequestId("storage-manual"),
      name: cleanSocketId(itemData.name) || "Предмет",
      img: cleanSocketId(itemData.img),
      typeLabel: cleanSocketId(itemData.type) || "Предмет",
      sourceType: "manual",
      sourceId: cleanSocketId(item.uuid),
      quantity,
      itemData
    };
    const next = await this.storageService.configure(token, {
      manualRows: [...state.manualRows, row],
      state: state.state === "empty" ? "opened" : state.state,
      displayMode: state.state === "empty" ? "opened" : state.displayMode
    }, { path });
    await this.storageGroundPileService.refreshAfterStorageMutation(token, readStorageState(token));
    return next;
  }

  async removeManualStorageItem(tokenUuid, rowId, request = {}) {
    if (!globalThis.game?.user?.isGM) throw new Error("Удалять предметы может только мастер.");
    return this.deleteStorageRow(tokenUuid, rowId, request);
  }

  async updateStorageRowQuantity(tokenUuid, rowId, quantity, request = {}) {
    if (!globalThis.game?.user?.isGM) throw new Error("Изменять предметы может только мастер.");
    const token = await this.#resolveStorageToken(tokenUuid, { allowMaterializedCorpse: true });
    const next = await this.storageService.updateRowQuantity(token, cleanSocketId(rowId), quantity, {
      path: cleanStoragePath(request.path)
    });
    await this.storageGroundPileService.refreshAfterStorageMutation(token, readStorageState(token));
    return next;
  }

  async deleteStorageRow(tokenUuid, rowId, request = {}) {
    if (!globalThis.game?.user?.isGM) throw new Error("Удалять предметы может только мастер.");
    const token = await this.#resolveStorageToken(tokenUuid, { allowMaterializedCorpse: true });
    const next = await this.storageService.deleteRow(token, cleanSocketId(rowId), {
      path: cleanStoragePath(request.path)
    });
    await this.storageGroundPileService.refreshAfterStorageMutation(token, readStorageState(token));
    return next;
  }

  async resetStorageToken(tokenUuid, request = {}) {
    if (!globalThis.game?.user?.isGM) throw new Error("Сбрасывать хранилища может только мастер.");
    const token = await this.#resolveStorageToken(tokenUuid, { allowMaterializedCorpse: true });
    const path = cleanStoragePath(request.path);
    const corpse = !path.length && isMaterializedCorpseStorageState(readStorageState(token));
    return this.storageService.configure(token, {
      generatedRows: [],
      generatedCoins: {},
      claimedRowIds: [],
      coinsClaimed: false,
      state: corpse ? "empty" : "unopened",
      displayMode: corpse ? "empty" : "unopened"
    }, { path });
  }

  async setStorageTextureMode(tokenUuid, mode, request = {}) {
    if (!globalThis.game?.user?.isGM) {
      throw new Error("Менять текстуру хранилища может только мастер.");
    }
    const token = await this.#resolveStorageToken(tokenUuid, { allowMaterializedCorpse: true });
    return this.storageService.setTextureMode(token, mode, { path: cleanStoragePath(request.path) });
  }

  async openStorageApp({
    tokenUuid,
    configure = false,
    anchorToToken = false,
    path = [],
    characterTokenUuid = ""
  } = {}) {
    const safeTokenUuid = cleanSocketId(tokenUuid);
    const safePath = cleanStoragePath(path);
    const safeCharacterTokenUuid = cleanSocketId(characterTokenUuid);
    if (!safeTokenUuid) throw new Error("Не указан токен хранилища.");
    if (configure) {
      await this.configureStorageToken(safeTokenUuid, {}, { path: safePath });
    }
    else {
      await this.openStorage(safeTokenUuid, {
        path: safePath,
        characterTokenUuid: safeCharacterTokenUuid
      });
    }
    const moduleVersion = game.modules.get(MODULE_ID)?.version ?? "1.4.96";
    const { StorageApp } = await import(
      `./ui/storage-app.js?v=${encodeURIComponent(`${moduleVersion}-storage-window-drops`)}`
    );
    const key = `${safeTokenUuid}:${configure ? "configure" : "open"}`;
    let app = this.storageApps.get(key);
    if (!app) {
      app = new StorageApp(this, safeTokenUuid, {
        configure,
        anchorToToken,
        path: safePath,
        characterTokenUuid: safeCharacterTokenUuid
      });
      this.storageApps.set(key, app);
    }
    else {
      app.characterTokenUuid = safeCharacterTokenUuid;
      if (anchorToToken) app.requestTokenAnchor?.();
    }
    await app.render({ force: true });
    bringAppToFront(app);
    return app;
  }

  async importTransportIntoGroup(payload) {
    const result = isActiveGmClient(globalThis.game)
      ? await this.transportInstanceService.importIntoGroup(payload, {
          sender: globalThis.game?.user
        })
      : await this.socketCommandBus.request(TRANSPORT_IMPORT_COMMAND, payload);
    await this.refreshOpenApps();
    return result;
  }

  async updateTransportInstanceState(payload) {
    const result = isActiveGmClient(globalThis.game)
      ? await this.transportInstanceService.updateInstanceState(payload, {
          sender: globalThis.game?.user
        })
      : await this.socketCommandBus.request(TRANSPORT_UPDATE_STATE_COMMAND, payload);
    await this.refreshOpenApps();
    return result;
  }

  async selectTransportFuel(payload) {
    const result = isActiveGmClient(globalThis.game)
      ? await this.transportInstanceService.selectFuel(payload, {
          sender: globalThis.game?.user
        })
      : await this.socketCommandBus.request(TRANSPORT_SELECT_FUEL_COMMAND, payload);
    await this.refreshOpenApps();
    return result;
  }

  async updateTransportFuelConsumption(payload) {
    const result = isActiveGmClient(globalThis.game)
      ? await this.transportInstanceService.updateFuelConsumption(payload, {
          sender: globalThis.game?.user
        })
      : await this.socketCommandBus.request(TRANSPORT_UPDATE_FUEL_CONSUMPTION_COMMAND, payload);
    await this.refreshOpenApps();
    return result;
  }

  async setActiveTransport(activeTransportId = "") {
    const context = this.groupContextService.resolveForCurrentUser();
    const groupActorId = cleanSocketId(context?.groupId ?? context?.groupActor?.id);
    if (!groupActorId) {
      throw new Error("Группа для транспорта не выбрана.");
    }

    const nextState = normalizeGroupTransportState({ activeTransportId });
    const currentSnapshot = await this.inventoryService.getTransportSnapshot({
      context,
      transportState: nextState
    });
    if (nextState.activeTransportId && !currentSnapshot.vehicles.some((vehicle) => vehicle.id === nextState.activeTransportId)) {
      throw new Error("Транспорт не найден в группе или складе.");
    }

    const committedState = isActiveGmClient(globalThis.game)
      ? await this.inventoryService.replaceGroupTransportState(groupActorId, nextState)
      : await this.socketCommandBus.request(GROUP_TRANSPORT_REPLACE_STATE_COMMAND, {
        groupActorId,
        transportState: nextState
      });
    const snapshot = await this.inventoryService.getTransportSnapshot({
      context,
      transportState: committedState
    });
    await this.refreshOpenApps();
    return snapshot;
  }

  async getTravelSnapshot() {
    return this.travelService.getSnapshot();
  }

  async syncTravelMapToken() {
    const snapshot = await this.travelService.getSnapshot();
    return this.#syncTravelMapForSnapshot(snapshot);
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
    return result;
  }

  async setTravelSpeedMultiplier(speedMultiplier = 1) {
    const result = await this.travelService.setSpeedMultiplier(speedMultiplier);
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
    if (result?.fuelChange?.warning) {
      ui.notifications?.warn?.(result.fuelChange.warning);
    }
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

  async #runInventoryFolderMutation(command, payload, validate, methodName) {
    if (!validate(payload)) {
      throw new TypeError("Inventory folder command payload is invalid.");
    }
    const exactPayload = cloneSocketPayload(payload);
    if (!isActiveGmClient(globalThis.game)) {
      const result = await this.socketCommandBus.request(command, exactPayload);
      await this.refreshInventoryViews({ actorIds: [exactPayload.groupActorId] });
      return result;
    }
    return this.runInventoryMutation(
      () => this.inventoryService[methodName](exactPayload),
      { actorIdsFromResult: (result) => [result?.actorId] }
    );
  }

  createInventoryFolder(payload) {
    return this.#runInventoryFolderMutation(
      INVENTORY_FOLDER_CREATE_COMMAND,
      payload,
      isValidInventoryFolderCreatePayload,
      "createInventoryFolder"
    );
  }

  renameInventoryFolder(payload) {
    return this.#runInventoryFolderMutation(
      INVENTORY_FOLDER_RENAME_COMMAND,
      payload,
      isValidInventoryFolderRenamePayload,
      "renameInventoryFolder"
    );
  }

  moveInventoryFolder(payload) {
    return this.#runInventoryFolderMutation(
      INVENTORY_FOLDER_MOVE_COMMAND,
      payload,
      isValidInventoryFolderMovePayload,
      "moveInventoryFolder"
    );
  }

  deleteInventoryFolder(payload) {
    return this.#runInventoryFolderMutation(
      INVENTORY_FOLDER_DELETE_COMMAND,
      payload,
      isValidInventoryFolderDeletePayload,
      "deleteInventoryFolder"
    );
  }

  moveInventoryItemToFolder(payload) {
    return this.#runInventoryFolderMutation(
      INVENTORY_ITEM_FOLDER_MOVE_COMMAND,
      payload,
      isValidInventoryItemFolderMovePayload,
      "moveInventoryItemToFolder"
    );
  }

  getInventoryFolderUiState(groupActorId, folderIds = []) {
    return this.inventoryService.getInventoryFolderUiState(groupActorId, folderIds);
  }

  setInventoryFolderExpanded(groupActorId, folderId, expanded) {
    return this.inventoryService.setInventoryFolderExpanded(groupActorId, folderId, expanded);
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

  async importInventoryDrop(dropData, { groupActorId = "", folderId = null } = {}) {
    const target = {
      groupActorId: cleanSocketId(groupActorId),
      folderId: folderId === null ? null : cleanSocketId(folderId)
    };
    const storageDrop = parseStorageDragData(dropData);
    if (storageDrop) {
      const quantity = await promptStorageTransferQuantity(storageDrop.quantity);
      if (quantity === null) return { cancelled: true };
      return this.runInventoryMutation(() => this.claimStorageRow(
        storageDrop.tokenUuid,
        storageDrop.rowId,
        "party",
        createSocketRequestId("storage-party-drop"),
        { quantity, target }
      ));
    }
    return this.runInventoryMutation(
      () => this.inventoryService.importDroppedItem(dropData, target)
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

  #buildCalendarTransitionPayload(options = {}) {
    const context = this.groupContextService.resolveForCurrentUser();
    const groupActorId = cleanSocketId(context?.groupId ?? context?.groupActor?.id);
    const payload = {
      groupActorId,
      options: normalizeCalendarTransitionOptionsForSocket(options)
    };
    if (!isValidCalendarTransitionPayload(payload)) {
      throw new Error("Invalid calendar transition socket payload.");
    }
    return payload;
  }

  async #runCalendarTransition(options = {}) {
    const transitionOptions = normalizeCalendarTransitionOptionsForSocket(options);
    if (isActiveGmClient(globalThis.game)) {
      return this.calendarTransitionCoordinator.moveTo(transitionOptions);
    }

    return this.socketCommandBus.request(
      GROUP_CALENDAR_TRANSITION_COMMAND,
      this.#buildCalendarTransitionPayload(transitionOptions)
    );
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
    return {
      triggered: true,
      reason,
      monthResetCount: safeResetCount,
      refreshedTraderCount: 0,
      removedTraderCount: 0
    };
  }

  async setCalendarDate(year, month, day, options = {}) {
    const target = this.calendarService.previewDate(year, month, day);
    const processDailyCycles = options.processDailyCycles === true;
    const result = await this.#runCalendarTransition({
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
    if (consumeSupplies && typeof this.inventoryService.consumeSuppliesDays === "function") {
      const supplyBatch = await this.inventoryService.consumeSuppliesDays(safeDays, {
        applyEnergy,
        ...executionContext
      });
      guard?.();
      supplies.push(...(Array.isArray(supplyBatch?.supplies) ? supplyBatch.supplies : []));
    }
    else {
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
    const result = await this.#runCalendarTransition({
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
    const result = await this.#runCalendarTransition({
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
    const result = await this.#runCalendarTransition({
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

  listLootgenTemplates() {
    if (!game.user?.isGM) {
      throw new Error("Шаблоны Lootgen доступны только мастеру.");
    }
    return this.lootgenTemplateCatalog.list();
  }

  getLootgenTemplate(templateId) {
    if (!game.user?.isGM) {
      throw new Error("Шаблоны Lootgen доступны только мастеру.");
    }
    return this.lootgenTemplateCatalog.get(templateId);
  }

  async saveLootgenTemplate(payload = {}) {
    if (!game.user?.isGM) {
      throw new Error("Сохранять шаблоны Lootgen может только мастер.");
    }
    return this.lootgenTemplateCatalog.save(payload);
  }

  async removeLootgenTemplate(templateId) {
    if (!game.user?.isGM) {
      throw new Error("Удалять шаблоны Lootgen может только мастер.");
    }
    return this.lootgenTemplateCatalog.remove(templateId);
  }

  async generateStorageLoot(form = {}) {
    if (!isActiveGmClient(globalThis.game)) {
      throw new Error("Содержимое хранилища может генерировать только активный мастер.");
    }
    const moduleVersion = game.modules.get(MODULE_ID)?.version ?? "1.4.96";
    const { LootgenApp } = await import(`./ui/lootgen-app.js?v=${encodeURIComponent(moduleVersion)}`);
    const generator = new LootgenApp(this, { appKey: `storage-generator-${createSocketRequestId("loot")}` });
    const generated = await generator.generateFromForm(form);
    const rows = [];
    for (const [index, row] of (generated.rows ?? []).entries()) {
      rows.push({
        ...foundry.utils.deepClone(row),
        rowId: createSocketRequestId(`storage-row-${index}`),
        itemData: await this.inventoryService.buildLootgenItemData(row)
      });
    }
    return {
      rows,
      coins: foundry.utils.deepClone(generated.coins ?? {})
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
    const {
      refreshInventorySnapshot = false,
      ...renderOptions
    } = options;
    const canRefreshInventorySnapshot = refreshInventorySnapshot
      && typeof app?.refreshInventorySnapshot === "function";
    if (!app?.rendered || isApplicationMinimized(app) || (!canRefreshInventorySnapshot && typeof app.render !== "function")) {
      return null;
    }

    return {
      key: app,
      run: () => canRefreshInventorySnapshot
        ? app.refreshInventorySnapshot(renderOptions)
        : rerenderApp(app, { ...renderOptions, focus: false })
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

    const targetActorIds = new Set(actorIds);
    const inventoryViews = [
      this.inventoryApp,
      ...this.inventoryFolderApps.values()
    ].filter((app, index, apps) => app && apps.indexOf(app) === index);
    const tasks = [
      ...inventoryViews
        .filter((app) => {
          const inventoryActorId = String(app.inventoryActorId ?? app.groupActorId ?? "").trim();
          return targetActorIds.size === 0 || !inventoryActorId || targetActorIds.has(inventoryActorId);
        })
        .map((app) => this.#appRefreshTask(app, {
          preserveScroll: true,
          refreshInventorySnapshot: true
        })),
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

  async refreshCityViews({ cityIds = [] } = {}) {
    const requested = new Set((cityIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean));
    const apps = requested.size
      ? [...requested].map((id) => this.cityApps.get(id)).filter(Boolean)
      : [...this.cityApps.values()];
    const tasks = apps.map((app) => this.#appRefreshTask(app)).filter(Boolean);
    await this.uiRefreshCoordinator.request(tasks);
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

  async openQuestLogApp(options = {}) {
    try {
      return await openRebreyaQuestLog({ options });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open Rebreya quest log.`, error);
      ui.notifications?.error(error.message || "Не удалось открыть журнал заданий Rebreya.");
      throw error;
    }
  }

  async openCityApp(cityId) {
    try {
      const { CityEconomyApp } = await import("./ui/city-app.js?v=1.4.136-public-city-background");

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
      notifyUser("error", "Не удалось открыть партийный инвентарь.");
      throw error;
    }
  }

  async openInventoryFolderPopout(groupActorId, folderId) {
    const normalizedGroupActorId = String(groupActorId ?? "").trim();
    const normalizedFolderId = String(folderId ?? "").trim();
    if (!normalizedGroupActorId || !normalizedFolderId) {
      throw new TypeError("Inventory folder popout requires groupActorId and folderId.");
    }

    const inventoryViewKey = `${normalizedGroupActorId}:${normalizedFolderId}`;
    const existingApp = this.inventoryFolderApps.get(inventoryViewKey);
    if (existingApp) {
      await existingApp.render({ force: true });
      bringAppToFront(existingApp);
      return existingApp;
    }

    const snapshot = await this.getInventorySnapshot({
      createActor: false,
      groupActorId: normalizedGroupActorId
    });
    const folder = (snapshot?.folders ?? []).find((entry) => String(entry?.id ?? "").trim() === normalizedFolderId);
    if (!folder) {
      throw new Error("Папка инвентаря не найдена.");
    }

    const moduleVersion = game.modules?.get?.(MODULE_ID)?.version ?? "1.4.67";
    const { InventoryApp } = await import(`./ui/inventory-app.js?v=${encodeURIComponent(moduleVersion)}`);
    const app = new InventoryApp(this, {
      groupActorId: normalizedGroupActorId,
      rootFolderId: normalizedFolderId,
      inventoryViewKey,
      window: { title: String(folder.name ?? "Папка инвентаря") }
    });
    this.inventoryFolderApps.set(inventoryViewKey, app);
    try {
      await app.render({ force: true });
    }
    catch (error) {
      this.unregisterInventoryFolderPopout(inventoryViewKey, app);
      throw error;
    }
    bringAppToFront(app);
    return app;
  }

  unregisterInventoryFolderPopout(inventoryViewKey, app) {
    const normalizedViewKey = String(inventoryViewKey ?? "").trim();
    if (!normalizedViewKey || this.inventoryFolderApps.get(normalizedViewKey) !== app) {
      return false;
    }

    this.inventoryFolderApps.delete(normalizedViewKey);
    return true;
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
  refreshPlayerInventoryQuickButton(moduleApi);
  socketModuleApi = moduleApi;
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = moduleApi;
  }
  flushQueuedSocketMessages(moduleApi);

  try {
    registerTransportGroupDropHooks(moduleApi, { Hooks });
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register party transport drop hook.`, error);
  }

  try {
    registerStorageTransferDropHooks(moduleApi, { Hooks });
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register storage transfer drop hooks.`, error);
  }

  try {
    registerStorageTokenDropHooks(moduleApi, { hooks: Hooks });
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register storage token drop hooks.`, error);
  }

  try {
    await registerStorageContainerHierarchyHooks({ Hooks });
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register storage container hierarchy hooks.`, error);
  }

  try {
    registerTransportVehicleSheetHooks(moduleApi, { Hooks });
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register transport vehicle sheet hook.`, error);
  }

  try {
    await registerForienQuestLogIntegration(moduleApi);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to register Forien Quest Log integration.`, error);
  }

  try {
    registerDurabilityHooks(moduleApi);
    await Promise.all([
      reconcileBrokenEquippedArmor(),
      reconcileNativeObjectDurability()
    ]);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register durability hooks.`, error);
  }

  try {
    registerLongRestHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register long-rest hooks.`, error);
  }

  try {
    registerImplantDataModelPatch();
    registerImplantHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register implant hooks.`, error);
  }

  try {
    registerCombatHooks(moduleApi);
    registerImplantAutomationHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register combat hooks.`, error);
  }

  try {
    registerSpellAutomationHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register spell automation hooks.`, error);
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
    registerStorageTokenHooks(moduleApi, { hooks: Hooks });
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register storage token hooks.`, error);
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
    registerTravelMapHooks(moduleApi, { Hooks });
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register travel map hooks.`, error);
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
