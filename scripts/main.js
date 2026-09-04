// @rebreya-role canonical-composition-root
import { MODULE_ID, MODULE_TITLE, SETTINGS_KEYS } from "./constants.js";
import { escapeFoundryHtml } from "./shared/foundry-values.js";
import { MaterialsCompendiumService } from "./data/materials-compendium.js";
import { GearCompendiumService } from "./data/gear-compendium.js?v=1.4.145-coin-icons-storage-sound";
import { repairWorldAmmunitionCompatibility } from "./data/ammunition-compatibility.js?v=1.4.147-native-ammunition";
import { MagicItemsCompendiumService } from "./data/magic-items-compendium.js?v=1.4.192-unsupported-item-activity-repair";
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
import { PurchaseBasketService } from "./features/trading/purchase-basket-service.js";
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
  normalizeGroupTransportState,
  resolveGroupMemberActor
} from "./data/group-context-service.js";
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
  INVENTORY_DISMANTLE_COMMAND,
  INVENTORY_FOLDER_CREATE_COMMAND,
  INVENTORY_FOLDER_DELETE_COMMAND,
  INVENTORY_FOLDER_MOVE_COMMAND,
  INVENTORY_FOLDER_RENAME_COMMAND,
  INVENTORY_INGRESS_RULE_CREATE_COMMAND,
  INVENTORY_INGRESS_RULE_DELETE_COMMAND,
  INVENTORY_INGRESS_RULE_UPDATE_COMMAND,
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
} from "./data/inventory-service.js?v=1.4.220-journal-record-link";
import {
  InventoryIngressRuleCompilerCache,
  normalizeInventoryIngressRule
} from "./data/inventory-ingress-rules.js";
import {
  buildInventoryIngressDescriptor,
  resolveInventoryDismantleOutputs
} from "./data/inventory-ingress-descriptor.js?v=1.4.179-dismantle-minimum-quantity";
import {
  InventoryIngressPlanner,
  isValidSerializedInventoryIngressPlan
} from "./application/inventory-ingress-planner.js";
import { DurabilityService } from "./data/durability-service.js?v=1.4.154-corpse-storage-broken-name";
import { MapObjectTokenService } from "./data/map-object-token-service.js?v=1.4.97-map-object-token";
import { HeroDollService } from "./data/hero-doll-service.js";
import { ImplantService } from "./data/implant-service.js";
import { CraftingService } from "./data/crafting-service.js?v=1.4.96-craft-calendar";
import { CraftDowntimeService } from "./data/craft-downtime-service.js?v=1.4.96-craft-calendar";
import { ItemUpgradeService } from "./data/item-upgrade-service.js?v=1.4.96-item-upgrades";
import { GROUP_CALENDAR_PATCH_COMMAND, CalendarService } from "./data/calendar-service.js";
import { CalendarTransitionCoordinator } from "./data/calendar-transition-coordinator.js?v=1.4.96-craft-calendar";
import { PrivilegedMutationGateway } from "./application/privileged-mutation-gateway.js";
import {
  GLOBAL_EVENTS_CREATE_COMMAND,
  GLOBAL_EVENTS_DELETE_COMMAND,
  GLOBAL_EVENTS_DUPLICATE_COMMAND,
  GLOBAL_EVENTS_IMPORT_DEFAULTS_COMMAND,
  GLOBAL_EVENTS_UPDATE_COMMAND,
  isValidGlobalEventsCreatePayload,
  isValidGlobalEventsDeletePayload,
  isValidGlobalEventsDuplicatePayload,
  isValidGlobalEventsImportDefaultsPayload,
  isValidGlobalEventsUpdatePayload
} from "./application/global-events-mutation-commands.js";
import {
  ECONOMY_CITY_PRESENTATION_UPDATE_COMMAND,
  ECONOMY_CONNECTION_SET_ACTIVE_COMMAND,
  ECONOMY_REFERENCE_UPDATE_DESCRIPTION_COMMAND,
  ECONOMY_STATE_POLICY_UPDATE_COMMAND,
  ECONOMY_TRADE_ROUTE_UPDATE_METADATA_COMMAND,
  ECONOMY_WORLD_DATA_RESET_COMMAND,
  isValidEconomyCityPresentationUpdatePayload,
  isValidEconomyConnectionSetActivePayload,
  isValidEconomyReferenceUpdateDescriptionPayload,
  isValidEconomyStatePolicyUpdatePayload,
  isValidEconomyTradeRouteUpdateMetadataPayload,
  isValidEconomyWorldDataResetPayload
} from "./application/economy-mutation-commands.js";
import {
  TRADER_AUDIT_RECORD_COMMAND,
  TRADER_METADATA_UPDATE_COMMAND,
  isValidTraderAuditRecordPayload,
  isValidTraderMetadataUpdatePayload
} from "./application/trader-public-mutation-commands.js";
import {
  PURCHASE_BASKET_COMMIT_COMMAND,
  isValidPurchaseBasketPayload
} from "./application/purchase-basket-command.js";
import {
  GROUP_INVENTORY_MERGE_LEGACY_COMMAND,
  GROUP_REGISTRY_ACTIVATE_COMMAND,
  GROUP_REGISTRY_REGISTER_COMMAND,
  isValidGroupInventoryMergeLegacyPayload,
  isValidGroupRegistryActivatePayload,
  isValidGroupRegistryRegisterPayload
} from "./application/group-registry-mutation-commands.js";
import {
  DOWNTIME_HISTORY_CLEAR_COMMAND,
  DOWNTIME_PROJECT_CLOSE_COMMAND,
  DOWNTIME_PROJECT_CONTINUE_COMMAND,
  DOWNTIME_REQUEST_CREATE_COMMAND,
  DOWNTIME_REQUEST_RECORD_CHECK_COMMAND,
  DOWNTIME_REQUEST_SET_CHECKS_COMMAND,
  DOWNTIME_REQUEST_SET_STATUS_COMMAND,
  DOWNTIME_REQUEST_UPDATE_COMMAND,
  DOWNTIME_WEEKS_GRANT_COMMAND,
  DOWNTIME_WEEKS_REVOKE_COMMAND,
  isValidDowntimeHistoryClearPayload,
  isValidDowntimeProjectClosePayload,
  isValidDowntimeProjectContinuePayload,
  isValidDowntimeRequestCreatePayload,
  isValidDowntimeRequestRecordCheckPayload,
  isValidDowntimeRequestSetChecksPayload,
  isValidDowntimeRequestSetStatusPayload,
  isValidDowntimeRequestUpdatePayload,
  isValidDowntimeWeeksGrantPayload,
  isValidDowntimeWeeksRevokePayload
} from "./application/downtime-mutation-commands.js";
import { WorldMutationCoordinator } from "./application/world-mutation-coordinator.js";
import { LootClaimService } from "./application/loot-claim-service.js";
import {
  buildPublicCitySnapshot,
  buildPublicEconomySnapshot
} from "./application/public-economy-read-model.js";
import { GroupStateRepository } from "./infrastructure/foundry/group-state-repository.js";
import { TraderStateRepository } from "./infrastructure/foundry/trader-state-repository.js";
import { WorldSettingMutationRepository } from "./infrastructure/foundry/world-setting-mutation-repository.js";
import { PurchaseBasketJournalRepository } from "./infrastructure/foundry/purchase-basket-journal-repository.js";
import { PurchaseBasketFoundryOperations } from "./infrastructure/foundry/purchase-basket-operations.js";
import { getActiveGm, isActiveGmClient } from "./infrastructure/foundry/active-gm.js";
import { SocketCommandBus } from "./infrastructure/foundry/socket-command-bus.js";
import {
  GRAPPLE_DRAG_COMMAND,
  GRAPPLE_PLACE_COMMAND,
  GRAPPLE_RELEASE_AND_MOVE_COMMAND,
  GRAPPLE_TOGGLE_COMMAND,
  isValidGrappleDragPayload,
  isValidGrapplePlacePayload,
  isValidGrappleReleaseAndMovePayload,
  isValidGrappleTogglePayload
} from "./infrastructure/foundry/grapple-command-contract.js";
import { StorageTriggerPromptBroker } from "./infrastructure/foundry/storage-trigger-prompt-broker.js";
import { UiRefreshCoordinator } from "./infrastructure/ui/ui-refresh-coordinator.js";
import { GlobalEventsService } from "./data/global-events-service.js";
import { LootgenTemplateCatalog } from "./data/lootgen-template-catalog.js?v=1.4.129-lootgen-row-cap";
import {
  StorageService,
  isStorageActor,
  readStorageState,
  readStorageStateAtPath
} from "./data/storage-service.js?v=1.4.200-storage-broken-presentation";
import {
  CorpseStorageMaterializer
} from "./data/corpse-storage-materializer.js?v=1.4.195-storage-administration";
import {
  isCorpseStorageTarget,
  isDeadNpcStorageTarget,
  isMaterializedCorpseStorageState
} from "./data/storage-corpse-target.js?v=1.4.195-storage-corpse-target";
import { StorageOpenSoundService } from "./data/storage-open-sound-service.js?v=1.4.145-coin-icons-storage-sound";
import {
  isStorageTokenVisible,
  measureStoragePointDistance,
  measureStorageTokenDistance
} from "./data/storage-access.js?v=1.4.197-door-trigger-target";
import { BuiltinStorageActorService } from "./data/builtin-storage-actor-service.js?v=1.4.216-storage-token-vision";
import { StorageGroundPileService } from "./data/storage-ground-pile-service.js?v=1.4.215-container-rotation";
import { deriveGroundPilePlacement } from "./data/storage-pile-presentation.js?v=1.4.213-furniture-orientation";
import { StorageContainerItemService } from "./data/storage-container-item-service.js?v=1.4.215-container-rotation";
import { isStorageJournalRow } from "./data/storage-container-snapshot.js";
import { StorageTriggerService } from "./data/storage-trigger-service.js?v=1.4.197-door-trigger-target";
import { DoorTriggerTargetRepository, readDoorTriggerTarget } from "./data/door-trigger-target.js?v=1.4.199-door-overlay-anchor";
import { measureDoorDistanceFeet, preflightDoorAccess } from "./data/door-access.js?v=1.4.197-door-trigger-target";
import { TriggerTargetCoordinator } from "./application/trigger-target-coordinator.js?v=1.4.197-door-trigger-target";
import { StorageTriggerTargetAdapter } from "./data/storage-trigger-target-adapter.js?v=1.4.197-door-trigger-target";
import { DoorTriggerTargetAdapter } from "./data/door-trigger-target-adapter.js?v=1.4.199-door-overlay-anchor";
import {
  DoorTriggerCommandService,
  isValidDoorOpenPayload,
  isValidDoorTriggerReadPayload,
  isValidDoorTriggerResetPayload,
  isValidDoorTriggerSavePayload
} from "./application/door-trigger-command-service.js?v=1.4.197-door-trigger-target";
import { StorageTriggerDnd5eAdapter } from "./data/storage-trigger-dnd5e-adapter.js";
import {
  StorageJournalReader,
  createStorageJournalHtmlParser
} from "./data/storage-journal-reader.js";
import {
  parseStorageDepositDragData,
  resolveStorageDepositSource
} from "./data/storage-deposit-source.js?v=1.4.195-storage-administration";
import { NativeObjectDurabilityService } from "./data/native-object-durability-service.js?v=1.4.153-corpse-creature";
import {
  StorageCommandService,
  isValidStorageClaimAllPayload,
  isValidStorageClaimCoinsPayload,
  isValidStorageClaimRowPayload,
  isValidStorageCoinDropPayload,
  isValidStorageDepositPayload,
  isValidStorageDropItemPayload,
  isValidJournalRecordDropPayload,
  isValidJournalRecordReadPayload,
  isValidStorageJournalDropPayload,
  isValidStorageJournalReadPayload,
  isValidStorageJournalRecordPayload,
  isValidStorageOpenPayload,
  isValidStorageTriggerReadPayload,
  isValidStorageTriggerResetPayload,
  isValidStorageTriggerSavePayload,
  isValidStorageRestorePortablePayload,
  isValidStorageTokenCharacterPayload,
  storageCharacterTokenUuidForClaim
} from "./data/storage-command-service.js?v=1.4.222-journal-record-drop";
import { registerCombatHooks } from "./combat/hooks.js?v=1.4.191-magic-item-runtime";
import { CombatAttackService } from "./combat/attack-service.js?v=1.4.181-dual-wield-gloves";
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
import { GrappleAutomationService, GRAPPLE_LINK_FLAG } from "./combat/grapple-automation-service.js";
import { GrappleMacroService } from "./combat/grapple-macro-service.js";
import { GrapplePlacementPreview } from "./combat/grapple-placement-preview.js";
import { getActorHandReservations } from "./integrations/held-items.js";
import { CraftsmanGadgetService } from "./combat/craftsman-gadget-service.js";
import { CraftsmanGadgetZoneService } from "./combat/craftsman-gadget-zone-service.js";
import { CraftsmanVehicleService } from "./combat/craftsman-vehicle-service.js";
import { CraftsmanConstructorService } from "./combat/craftsman-constructor-service.js";
import {
  publishPanelToolApi,
  registerExternalPanelTool,
  refreshPlayerInventoryQuickButton,
  registerSceneControlsHook,
  unregisterExternalPanelTool
} from "./hooks.js?v=1.4.172-panel-owner-runtime";
import {
  extendDnd5eItemTypes,
  registerDnd5eSheetExtensions,
  registerRebreyaWeaponBaseItemsFromGearPack
} from "./integrations/dnd5e-sheet-extensions.js?v=1.4.221-journal-readonly-dialog";
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
import { patchDnd5eTooltipRaceGuard } from "./integrations/dnd5e-tooltip-compat.js?v=1.4.215-tooltip-race";
import { registerInventorySyncHooks } from "./integrations/inventory-sync.js?v=1.4.223-party-transfer";
import { runMapObjectTokenMacro } from "./integrations/map-object-token-macro.js?v=1.4.97-map-object-token";
import { refreshSmallTimeDateDisplay, registerSmallTimeIntegration, syncSmallTimeToCalendarTime } from "./integrations/smalltime-compat.js";
import { registerRationFoodConversionHook } from "./integrations/ration-food-conversion.js";
import { registerMagicWeaponTemplateHook } from "./integrations/magic-weapon-template.js?v=1.4.96";
import { registerStorageTokenHooks } from "./integrations/storage-token-hooks.js?v=1.4.197-door-trigger-target";
import { registerDoorTriggerHooks } from "./integrations/door-trigger-hooks.js?v=1.4.199-door-overlay-anchor";
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
import { registerStorageTransferDropHooks } from "./integrations/storage-transfer-drop.js?v=1.4.213-furniture-orientation";
import { registerStorageTokenDropHooks } from "./integrations/storage-token-drop.js?v=1.4.132-storage-owned-character-resolution";
import { registerStorageContainerHierarchyHooks } from "./integrations/storage-container-hierarchy.js?v=1.4.122-storage-container-cycle-repair";
import { registerTransportVehicleSheetHooks } from "./integrations/transport-vehicle-sheet.js";
import {
  parseStorageDragData,
  promptStorageTransferQuantity
} from "./ui/storage-transfer-ui.js?v=1.4.213-furniture-orientation";
import { getCraftsmanSubclasses } from "./integrations/craftsman-subclass-tracks.js";
import { patchTransformCleanupUpdateActorHook } from "./integrations/transform-cleanup-compat.js";
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
const INVENTORY_INGRESS_LOOTGEN_COMMAND = "inventory.ingress.lootgen";
const INVENTORY_INGRESS_DIRECT_COMMAND = "inventory.ingress.direct";
const SOCKET_EVENT_DOWNTIME_UPDATED = "downtime-updated";
const SOCKET_EVENT_TRAVEL_MAP_SYNC_REQUEST = "travel-map-sync-request";
const GROUP_CALENDAR_TRANSITION_COMMAND = "group.calendar.transition";
const INVENTORY_REFRESH_SETTLE_MS = 80;
const LEGACY_WORLD_MUTATION_SOCKET_TYPES = new Set([
  SOCKET_EVENT_TRAVEL_MAP_SYNC_REQUEST,
  SOCKET_EVENT_RACE_AUTOMATION,
  SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION,
  SOCKET_EVENT_INVENTORY_IMPORT_REQUEST,
  SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_REQUEST,
  SOCKET_EVENT_INVENTORY_ITEM_ACTION_REQUEST,
  SOCKET_EVENT_LOOTGEN_CLAIM_ROW,
  SOCKET_EVENT_LOOTGEN_CLAIM_COINS
]);
const MODULE_STYLE_PATH = `modules/${MODULE_ID}/styles/main.css`;
const MODULE_STYLE_VERSION = "1.4.200-storage-broken-presentation";
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const TRAVEL_DAY_HOURS = 8;
const COSMOLOGY_SET_MECHANUS_COMMAND = "cosmology.setMechanus";
const COMBAT_STATUS_SET_COMMAND = "combat.status.set";
const TRADER_PURCHASE_COMMAND = "trader.purchase";
const TRADER_SELL_COMMAND = "trader.sell";
export const STORAGE_OPEN_COMMAND = "storage.open";
export const STORAGE_JOURNAL_READ_COMMAND = "storage.journal.read";
export const STORAGE_JOURNAL_RECORD_COMMAND = "storage.journal.record";
export const STORAGE_JOURNAL_RECORD_DROP_COMMAND = "storage.journal.record-drop";
export const STORAGE_JOURNAL_READ_RECORD_COMMAND = "storage.journal.read-record";
export const STORAGE_CLAIM_ROW_COMMAND = "storage.claim-row";
export const STORAGE_CLAIM_COINS_COMMAND = "storage.claim-coins";
export const STORAGE_CLAIM_ALL_COMMAND = "storage.claim-all";
export const STORAGE_DEPOSIT_COMMAND = "storage.deposit";
export const STORAGE_COIN_DROP_COMMAND = "storage.coin.drop";
export const STORAGE_JOURNAL_DROP_COMMAND = "storage.journal.drop-to-scene";
export const STORAGE_DROP_ITEM_COMMAND = "storage.drop-item-to-scene";
export const STORAGE_RESTORE_PORTABLE_COMMAND = "storage.restore-portable";
export const STORAGE_TOKEN_CHARACTER_COMMAND = "storage.token-to-character";
export const STORAGE_TRIGGER_READ_COMMAND = "storage.triggers.read";
export const STORAGE_TRIGGER_SAVE_COMMAND = "storage.triggers.save";
export const STORAGE_TRIGGER_RESET_COMMAND = "storage.triggers.reset";
export const DOOR_OPEN_COMMAND = "door.open";
export const DOOR_TRIGGER_READ_COMMAND = "door.triggers.read";
export const DOOR_TRIGGER_SAVE_COMMAND = "door.triggers.save";
export const DOOR_TRIGGER_RESET_COMMAND = "door.triggers.reset";
export const DURABILITY_TARGET_DAMAGE_COMMAND = "durability.target.damage";
const ENVIRONMENT_COMBAT_STATUS_IDS = new Set(["rebreya-surrounded", "rebreya-open-position"]);
const ENVIRONMENT_STATUS_SOURCE = "rebreya-environment";
const ENVIRONMENT_STATUS_VERSION = "surrounded-ac-1";
const COUNTERSPELL_AUTOMATION_ENABLED = true;
let socketModuleApi = null;
const queuedSocketMessages = [];

export async function publishModuleVersionNotice({
  moduleEntry = globalThis.game?.modules?.get?.(MODULE_ID),
  user = globalThis.game?.user,
  fetchManifest = globalThis.fetch?.bind?.(globalThis),
  createChatMessage = globalThis.ChatMessage?.create?.bind(globalThis.ChatMessage),
  logger = console
} = {}) {
  const userId = String(user?.id ?? "").trim();
  let version = String(moduleEntry?.version ?? "").trim();

  if (typeof fetchManifest === "function") {
    try {
      const response = await fetchManifest(
        `modules/${MODULE_ID}/module.json?reload=${Date.now()}`,
        { cache: "no-store" }
      );
      if (response?.ok) {
        const manifest = await response.json();
        version = String(manifest?.version ?? "").trim() || version;
      }
    }
    catch {
      // A stale Foundry package registry is still preferable to losing the notice entirely.
    }
  }

  if (!userId || !version || typeof createChatMessage !== "function") return false;

  try {
    await createChatMessage({
      user: userId,
      whisper: [userId],
      content: `<p>${MODULE_TITLE} v${escapeFoundryHtml(version)} загружен.</p>`
    });
    return true;
  }
  catch (error) {
    logger?.warn?.(`${MODULE_ID} | Failed to publish module version notice.`, error);
    return false;
  }
}

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

function isValidInventoryDismantlePayload(payload) {
  return hasExactKeys(payload, ["inventoryActorId", "itemId", "mutationId", "quantity"])
    && [payload.inventoryActorId, payload.itemId].every(isTrimmedNonEmptyString)
    && isValidInventoryMutationId(payload.mutationId)
    && Number.isSafeInteger(payload.quantity)
    && payload.quantity > 0;
}

function isValidInventoryImportPayload(payload) {
  return hasExactKeys(payload, ["folderId", "ingressPlan", "inventoryActorId", "itemUuid", "mutationId"])
    && [payload.inventoryActorId, payload.itemUuid].every(isTrimmedNonEmptyString)
    && isValidInventoryMutationId(payload.mutationId)
    && (payload.folderId === null
      || (isTrimmedNonEmptyString(payload.folderId) && payload.folderId.length <= 160))
    && isValidSerializedInventoryIngressPlan(payload.ingressPlan)
    && payload.ingressPlan.groupActorId === payload.inventoryActorId
    && payload.ingressPlan.requestedFolderId === payload.folderId;
}

function isValidLootgenInventoryIngressPayload(payload) {
  if (!hasExactKeys(payload, [
    "batchMutationId", "groupActorId", "includeCoins", "ingressPlan", "lootId", "rowIds"
  ])
    || !isValidInventoryMutationId(payload.batchMutationId)
    || !isValidInventoryFolderIdentifier(payload.groupActorId)
    || !isValidInventoryMutationId(payload.lootId)
    || typeof payload.includeCoins !== "boolean"
    || !Array.isArray(payload.rowIds)
    || !isValidSerializedInventoryIngressPlan(payload.ingressPlan)
    || payload.ingressPlan.groupActorId !== payload.groupActorId) {
    return false;
  }
  const rowIds = payload.rowIds;
  return rowIds.length > 0
    && rowIds.every(isValidInventoryFolderIdentifier)
    && new Set(rowIds).size === rowIds.length
    && JSON.stringify(payload.ingressPlan.rows.map((row) => row.sourceKey)) === JSON.stringify(rowIds);
}

function isValidDirectInventoryIngressPayload(payload) {
  if (!hasExactKeys(payload, [
    "batchMutationId", "coins", "groupActorId", "ingressPlan", "sourceOrigin", "sources"
  ])
    || !isValidInventoryMutationId(payload.batchMutationId)
    || !isValidInventoryFolderIdentifier(payload.groupActorId)
    || !new Set(["lootgen", "public-model"]).has(payload.sourceOrigin)
    || !Array.isArray(payload.sources)
    || !payload.coins || typeof payload.coins !== "object" || Array.isArray(payload.coins)
    || !hasExactKeys(payload.coins, ["cp", "gp", "pp", "sp"])
    || !Object.values(payload.coins).every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return false;
  }
  const sources = payload.sources;
  if (!sources.every((source) => (
    hasExactKeys(source, [
      "isBroken", "quantity", "sourceDocumentId", "sourceId", "sourceKey", "sourceType"
    ])
      && isValidInventoryFolderIdentifier(source.sourceKey)
      && isTrimmedNonEmptyString(source.sourceType)
      && isTrimmedNonEmptyString(source.sourceId)
      && typeof source.sourceDocumentId === "string"
      && source.sourceDocumentId === source.sourceDocumentId.trim()
      && typeof source.isBroken === "boolean"
      && Number.isFinite(source.quantity)
      && source.quantity > 0
  )) || new Set(sources.map((source) => source.sourceKey)).size !== sources.length) {
    return false;
  }
  if (sources.length === 0) {
    return payload.ingressPlan === null && Object.values(payload.coins).some((value) => value > 0);
  }
  return isValidSerializedInventoryIngressPlan(payload.ingressPlan)
    && payload.ingressPlan.groupActorId === payload.groupActorId
    && JSON.stringify(payload.ingressPlan.rows.map((row) => row.sourceKey))
      === JSON.stringify(sources.map((source) => source.sourceKey));
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

function isCanonicalInventoryIngressRule(value) {
  try {
    return JSON.stringify(normalizeInventoryIngressRule(value)) === JSON.stringify(value);
  }
  catch (_error) {
    return false;
  }
}

function isValidInventoryIngressRuleRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValidInventoryIngressRuleWritePayload(payload) {
  return hasExactKeys(payload, ["expectedRevision", "groupActorId", "operationId", "rule"])
    && isValidInventoryFolderIdentifier(payload.groupActorId)
    && isValidInventoryMutationId(payload.operationId)
    && isValidInventoryIngressRuleRevision(payload.expectedRevision)
    && isCanonicalInventoryIngressRule(payload.rule);
}

function isValidInventoryIngressRuleDeletePayload(payload) {
  return hasExactKeys(payload, ["expectedRevision", "groupActorId", "operationId", "ruleId"])
    && isValidInventoryFolderIdentifier(payload.groupActorId)
    && isValidInventoryMutationId(payload.operationId)
    && isValidInventoryIngressRuleRevision(payload.expectedRevision)
    && isValidInventoryFolderIdentifier(payload.ruleId);
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

function documentIsOwnedByUser(document, user) {
  if (!document || !user) return false;
  if (user.isGM === true) return true;
  if (typeof document.testUserPermission === "function") {
    return document.testUserPermission(user, "OWNER");
  }
  const actor = document.actor ?? document;
  if (typeof actor?.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER");
  }
  const ownership = actor?.ownership ?? actor?._source?.ownership ?? {};
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
    this.socketCommandBus = new SocketCommandBus({
      coordinator: this.worldMutationCoordinator,
      gameProvider: () => globalThis.game
    });
    this.privilegedMutationGateway = new PrivilegedMutationGateway({
      commandBus: this.socketCommandBus,
      coordinator: this.worldMutationCoordinator,
      gameProvider: () => globalThis.game,
      getActiveGm,
      isActiveGmClient,
      operationIdFactory: () => createSocketRequestId("privileged-mutation")
    });
    this.worldSettingMutationRepository = new WorldSettingMutationRepository({
      mutationGateway: this.privilegedMutationGateway,
      gameProvider: () => globalThis.game
    });
    this.purchaseBasketJournalRepository = new PurchaseBasketJournalRepository({
      worldSettingMutationRepository: this.worldSettingMutationRepository
    });
    this.purchaseBasketOperations = new PurchaseBasketFoundryOperations({
      gameProvider: () => globalThis.game,
      fromUuid: (uuid) => globalThis.fromUuid?.(uuid) ?? globalThis.foundry?.utils?.fromUuid?.(uuid)
    });
    this.purchaseBasketService = new PurchaseBasketService({
      journal: this.purchaseBasketJournalRepository,
      operations: this.purchaseBasketOperations
    });
    this.uiRefreshCoordinator = new UiRefreshCoordinator();
    this.inventoryRefreshActorIds = new Set();
    this.inventoryRefreshHoldCount = 0;
    this.inventoryRefreshTimer = null;
    this.inventoryRefreshWaiters = [];
    this.groupStateRepository = new GroupStateRepository({
      mutationGateway: this.privilegedMutationGateway,
      gameProvider: () => globalThis.game,
      normalizeRegistry: normalizeGroupRegistry,
      normalizeGroupState,
      buildDefaultGroupState
    });
    this.traderStateRepository = new TraderStateRepository({
      mutationGateway: this.privilegedMutationGateway,
      gameProvider: () => globalThis.game,
      normalizeState: normalizeTraderState
    });
    this.lootgenTemplateCatalog = new LootgenTemplateCatalog({
      get: () => globalThis.game?.settings?.get(MODULE_ID, SETTINGS_KEYS.LOOTGEN_TEMPLATES),
      set: (value) => globalThis.game?.settings?.set(MODULE_ID, SETTINGS_KEYS.LOOTGEN_TEMPLATES, value),
      randomId: () => globalThis.randomID?.()
    });
    this.repository = new EconomyRepository({
      worldSettingMutationRepository: this.worldSettingMutationRepository
    });
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
      groupStateRepository: this.groupStateRepository
    });
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
    this.inventoryIngressRuleCompilerCache = new InventoryIngressRuleCompilerCache();
    this.inventoryIngressPlanner = new InventoryIngressPlanner({
      readRules: (groupActorId) => this.inventoryService.getInventoryIngressRuleState({ groupActorId }),
      buildDescriptor: async (itemData) => buildInventoryIngressDescriptor(itemData, {
        model: await this.getModel()
      }),
      resolveDismantleOutputs: async (itemData, quantity) => resolveInventoryDismantleOutputs(
        itemData,
        quantity,
        { model: await this.getModel() }
      ),
      compilerCache: this.inventoryIngressRuleCompilerCache,
      confirm: async (preview) => {
        const moduleVersion = game.modules.get(MODULE_ID)?.version ?? "0";
        const { promptInventoryIngressConfirmation } = await import(
          `./ui/inventory-app.js?v=${encodeURIComponent(moduleVersion)}`
        );
        return promptInventoryIngressConfirmation(preview);
      }
    });
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
      getOrBuildDurability: (item, options) => this.durabilityService.getOrBuildDurability(item, options),
      materializeFirstOpen: ({ token }) => isDeadNpcStorageTarget(token)
        ? this.corpseStorageMaterializer.materialize(token)
        : null,
      onGeneratedOpen: ({ token }) => this.storageOpenSoundService.playForToken(token)
    });
    this.storageTriggerDnd5eAdapter = new StorageTriggerDnd5eAdapter({
      fromUuid: (uuid) => globalThis.fromUuid?.(uuid)
    });
    this.storageTriggerPromptBroker = new StorageTriggerPromptBroker({
      gameProvider: () => globalThis.game,
      showDialog: async (prompt) => {
        const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
        if (typeof DialogV2?.confirm !== "function") throw new Error("Foundry DialogV2 недоступен.");
        const escape = globalThis.foundry?.utils?.escapeHTML ?? ((value) => String(value ?? ""));
        return DialogV2.confirm({
          window: { title: cleanSocketId(prompt?.title) || "Хранилище" },
          content: `<p>${escape(cleanSocketId(prompt?.message))}</p>`,
          yes: { label: cleanSocketId(prompt?.confirmLabel) || "Продолжить" },
          no: { label: cleanSocketId(prompt?.cancelLabel) || "Отмена" }
        });
      }
    });
    this.storageTriggerService = new StorageTriggerService({
      hasItem: (...args) => this.storageTriggerDnd5eAdapter.hasItem(...args),
      rollCheck: (...args) => this.storageTriggerDnd5eAdapter.rollCheck(...args),
      consumeItem: (...args) => this.storageTriggerDnd5eAdapter.consumeItem(...args),
      applyDamage: (...args) => this.storageTriggerDnd5eAdapter.applyDamage(...args),
      showDialog: (context, config) => this.storageTriggerPromptBroker.request(context, config),
      createChatMessage: async (_context, config) => {
        const escape = globalThis.foundry?.utils?.escapeHTML ?? ((value) => String(value ?? ""));
        return globalThis.ChatMessage?.create?.({ content: `<p>${escape(cleanSocketId(config?.message))}</p>` });
      },
      notify: async (_context, config) => {
        const level = ["info", "warn", "error"].includes(cleanSocketId(config?.level))
          ? cleanSocketId(config.level)
          : "info";
        return globalThis.ui?.notifications?.[level]?.(cleanSocketId(config?.message));
      },
      executeMacro: async (macroContext, config) => {
        const macro = await globalThis.fromUuid?.(cleanSocketId(config?.macroUuid));
        if (macro?.documentName !== "Macro" || typeof macro.execute !== "function") {
          throw new Error("Макрос триггера не найден.");
        }
        return macro.execute(macroContext);
      },
      persistRuntime: (context, mutate) => this.storageService.updateTriggerRuntime(
        context.storageToken,
        mutate,
        { path: cleanStoragePath(context.path) }
      ),
      logger: console
    });
    this.doorTriggerRepository = new DoorTriggerTargetRepository();
    this.triggerTargetCoordinator = new TriggerTargetCoordinator({
      triggerService: this.storageTriggerService,
      adapters: {
        storage: new StorageTriggerTargetAdapter({ storageService: this.storageService }),
        door: new DoorTriggerTargetAdapter({ repository: this.doorTriggerRepository })
      }
    });
    this.doorTriggerCommandService = new DoorTriggerCommandService({
      coordinator: this.triggerTargetCoordinator,
      resolveDocument: (uuid) => globalThis.fromUuid?.(uuid),
      measureDistance: measureDoorDistanceFeet,
      logger: console
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
      triggerTargetCoordinator: this.triggerTargetCoordinator,
      journalReader: this.storageJournalReader,
      resolveDocument: (uuid) => globalThis.fromUuid?.(uuid),
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
    this.grapplePlacementPreview = new GrapplePlacementPreview();
    this.grappleAutomationService = new GrappleAutomationService({
      coordinator: this.worldMutationCoordinator,
      commandBus: this.socketCommandBus,
      placementPreview: this.grapplePlacementPreview,
      fromUuid: (uuid) => globalThis.fromUuid?.(uuid),
      randomId: () => globalThis.foundry?.utils?.randomID?.() ?? createSocketRequestId("grapple-link"),
      isActiveGmClient,
      gameProvider: () => globalThis.game
    });
    this.grappleMacroService = new GrappleMacroService({
      gameProvider: () => globalThis.game,
      folderProvider: () => globalThis.Folder,
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
      grantRow: async () => {
        throw new Error("Lootgen inventory rows require a serialized ingress batch plan.");
      },
      grantCoins: ({ claimId, coins }) => this.inventoryService.addCurrencyToInventoryOnce(
        coins,
        `loot-coins:${claimId}`
      ),
      grantBatch: async ({ claimId, lootId, rows, coins, includeCoins, ingressPlan, message }) => {
        if (ingressPlan == null) {
          if (rows.length > 0) {
            throw new Error("Lootgen inventory rows require a serialized ingress batch plan.");
          }
          if (includeCoins) {
            await this.inventoryService.addCurrencyToInventoryOnce(coins, `loot-coins:${claimId}`);
          }
          return {
            acceptedRowIds: [],
            coinsGranted: includeCoins,
            receipt: { batchMutationId: claimId }
          };
        }
        const groupActorId = String(ingressPlan?.groupActorId ?? "").trim();
        const buildRows = () => {
          const liveState = foundry.utils.deepClone(message.getFlag(MODULE_ID, "lootgenChat") ?? {});
          const liveById = new Map((liveState.rows ?? []).map((row) => [String(row.rowId ?? "").trim(), row]));
          return rows.map((row) => {
            const sourceKey = String(row.rowId ?? "").trim();
            const liveRow = liveById.get(sourceKey);
            if (!liveRow || liveRow.claimed === true) {
              throw new Error(`Lootgen row '${sourceKey}' is no longer available.`);
            }
            return {
              sourceKey,
              quantity: Number(liveRow.quantity ?? liveRow.itemData?.system?.quantity ?? 0),
              itemData: foundry.utils.deepClone(liveRow.itemData ?? {}),
              legacyFolderId: null,
              container: null
            };
          });
        };
        const ingressResult = await this.inventoryService.commitInventoryIngressBatch({
          groupActorId,
          batchMutationId: claimId,
          sourceOrigin: "lootgen",
          serializedPlan: ingressPlan
        }, {
          resolveRows: async () => buildRows(),
          debitRow: async () => {}
        });
        const acceptedRowIds = ingressResult.rows
          .filter((row) => row.changed)
          .map((row) => row.sourceKey);
        let coinsGranted = false;
        if (includeCoins && Number(coins?.totalCopper ?? 0) > 0) {
          await this.inventoryService.addCurrencyToInventoryOnce(
            coins,
            `loot-coins:${claimId}`,
            { groupActorId }
          );
          coinsGranted = true;
        }
        return {
          acceptedRowIds,
          coinsGranted,
          receipt: { actorId: ingressResult.actorId, batchMutationId: claimId }
        };
      },
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
      this.implantService,
      this.magicItemsCompendium
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
    this.storageTriggerEditors = new Map();
    this.doorTriggerEditors = new Map();
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

  async toggleGrapple() {
    try {
      const controlled = globalThis.canvas?.tokens?.controlled ?? [];
      const targets = Array.from(globalThis.game?.user?.targets ?? []);
      if (controlled.length !== 1 || targets.length !== 1) {
        throw Object.assign(new Error("Выберите одного захватчика и одну цель."), { code: "invalid-selection" });
      }
      const sourceTokenUuid = cleanSocketId(controlled[0]?.document?.uuid ?? controlled[0]?.uuid);
      const targetTokenUuid = cleanSocketId(targets[0]?.document?.uuid ?? targets[0]?.uuid);
      const operationId = createSocketRequestId("grapple-toggle");
      const payload = { sourceTokenUuid, targetTokenUuid, operationId };
      return await (isActiveGmClient(globalThis.game)
        ? this.grappleAutomationService.toggle(payload)
        : this.socketCommandBus.request(GRAPPLE_TOGGLE_COMMAND, payload, { requestId: operationId }));
    }
    catch (error) {
      this.#notifyGrappleError(error);
      return null;
    }
  }

  async moveGrappled() {
    try {
      const controlled = globalThis.canvas?.tokens?.controlled ?? [];
      if (controlled.length !== 1) {
        throw Object.assign(new Error("Выберите одного захватчика."), { code: "invalid-selection" });
      }
      const sourceToken = controlled[0]?.document ?? controlled[0];
      const sourceTokenUuid = cleanSocketId(sourceToken?.uuid);
      const reservations = getActorHandReservations(sourceToken?.actor)
        .filter((row) => row.kind === "grapple" && row.sourceTokenUuid === sourceTokenUuid);
      const selectedTargets = Array.from(globalThis.game?.user?.targets ?? [])
        .map((token) => token?.document ?? token);
      const selected = selectedTargets.length === 1
        ? reservations.find((row) => row.targetTokenUuid === cleanSocketId(selectedTargets[0]?.uuid))
        : null;
      const reservation = selected
        ?? (selectedTargets.length === 0 && reservations.length === 1 ? reservations[0] : null);
      if (!reservation) {
        throw Object.assign(new Error("Выберите одну удерживаемую цель."), { code: "invalid-selection" });
      }
      const targetToken = await globalThis.fromUuid?.(reservation.targetTokenUuid);
      if (!targetToken) throw Object.assign(new Error("Схваченное существо не найдено."), { code: "stale-token" });
      const preview = await this.grappleAutomationService.choosePlacement({
        sourceTokenUuid,
        targetTokenUuid: reservation.targetTokenUuid
      });
      if (preview.cancelled) return { cancelled: true };
      const operationId = createSocketRequestId("grapple-place");
      const payload = {
        sourceTokenUuid,
        targetTokenUuid: cleanSocketId(targetToken.uuid),
        x: preview.x,
        y: preview.y,
        operationId
      };
      return await (isActiveGmClient(globalThis.game)
        ? this.grappleAutomationService.place(payload)
        : this.socketCommandBus.request(GRAPPLE_PLACE_COMMAND, payload, { requestId: operationId }));
    }
    catch (error) {
      this.#notifyGrappleError(error);
      return null;
    }
  }

  #notifyGrappleError(error) {
    const messages = {
      "no-free-hand": "Захват невозможен: нет свободной руки.",
      "invalid-target": "Нельзя схватить самого себя.",
      "target-grappled-by-another-source": "Существо уже схвачено другим захватчиком.",
      "crosshairs-unavailable": "Визуальный маркер CPR недоступен.",
      "outside-reach": "Эта позиция находится вне природной досягаемости.",
      "outside-scene": "Существо нельзя поставить за границей сцены.",
      "wall-collision": "Существо нельзя переместить сквозь стену.",
      "stale-link": "Связь захвата устарела. Повторите захват.",
      "stale-token": "Один из токенов захвата больше недоступен."
    };
    const fallback = cleanSocketId(error?.message) || "Ошибка автоматики захвата.";
    globalThis.ui?.notifications?.warn?.(messages[error?.code] ?? fallback);
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
    const authorizeGlobalEvents = (_payload, { sender }) => sender?.isGM === true;
    this.privilegedMutationGateway.registerCommand(GLOBAL_EVENTS_CREATE_COMMAND, {
      validate: isValidGlobalEventsCreatePayload,
      authorize: authorizeGlobalEvents,
      execute: (payload) => this.#executeGlobalEventsMutation(
        () => this.globalEventsService.createGlobalEvent(payload.data)
      )
    });
    this.privilegedMutationGateway.registerCommand(GLOBAL_EVENTS_UPDATE_COMMAND, {
      validate: isValidGlobalEventsUpdatePayload,
      authorize: authorizeGlobalEvents,
      execute: (payload) => this.#executeGlobalEventsMutation(
        () => this.globalEventsService.updateGlobalEvent(payload.eventId, payload.patch)
      )
    });
    this.privilegedMutationGateway.registerCommand(GLOBAL_EVENTS_DELETE_COMMAND, {
      validate: isValidGlobalEventsDeletePayload,
      authorize: authorizeGlobalEvents,
      execute: (payload) => this.#executeGlobalEventsMutation(
        () => this.globalEventsService.deleteGlobalEvent(payload.eventId)
      )
    });
    this.privilegedMutationGateway.registerCommand(GLOBAL_EVENTS_DUPLICATE_COMMAND, {
      validate: isValidGlobalEventsDuplicatePayload,
      authorize: authorizeGlobalEvents,
      execute: (payload) => this.#executeGlobalEventsMutation(
        () => this.globalEventsService.duplicateGlobalEvent(payload.eventId)
      )
    });
    this.privilegedMutationGateway.registerCommand(GLOBAL_EVENTS_IMPORT_DEFAULTS_COMMAND, {
      validate: isValidGlobalEventsImportDefaultsPayload,
      authorize: authorizeGlobalEvents,
      execute: () => this.#executeGlobalEventsMutation(
        () => this.globalEventsService.importDefaultGlobalEventTemplates()
      )
    });
    const authorizeEconomy = (_payload, { sender }) => sender?.isGM === true;
    this.privilegedMutationGateway.registerCommand(ECONOMY_CITY_PRESENTATION_UPDATE_COMMAND, {
      validate: isValidEconomyCityPresentationUpdatePayload,
      authorize: authorizeEconomy,
      execute: (payload) => this.repository.updateCityPresentation(payload.cityId, payload.patch)
    });
    this.privilegedMutationGateway.registerCommand(ECONOMY_CONNECTION_SET_ACTIVE_COMMAND, {
      validate: isValidEconomyConnectionSetActivePayload,
      authorize: authorizeEconomy,
      execute: (payload) => this.repository.setConnectionActive(payload.connectionId, payload.isActive)
    });
    this.privilegedMutationGateway.registerCommand(ECONOMY_REFERENCE_UPDATE_DESCRIPTION_COMMAND, {
      validate: isValidEconomyReferenceUpdateDescriptionPayload,
      authorize: authorizeEconomy,
      execute: (payload) => this.repository.setReferenceNote(
        `${payload.entryType}::${payload.entryId}`,
        payload.description
      )
    });
    this.privilegedMutationGateway.registerCommand(ECONOMY_TRADE_ROUTE_UPDATE_METADATA_COMMAND, {
      validate: isValidEconomyTradeRouteUpdateMetadataPayload,
      authorize: authorizeEconomy,
      execute: (payload) => this.repository.setTradeRouteOverride(payload.connectionId, payload.patch)
    });
    this.privilegedMutationGateway.registerCommand(ECONOMY_STATE_POLICY_UPDATE_COMMAND, {
      validate: isValidEconomyStatePolicyUpdatePayload,
      authorize: authorizeEconomy,
      execute: (payload) => this.repository.setStatePolicy(payload.stateId, payload.patch)
    });
    this.privilegedMutationGateway.registerCommand(ECONOMY_WORLD_DATA_RESET_COMMAND, {
      validate: isValidEconomyWorldDataResetPayload,
      authorize: authorizeEconomy,
      execute: async () => {
        await this.traderService.resetState();
        return this.repository.resetWorldData();
      }
    });
    const resolveTraderActor = (actorId) => (
      globalThis.game?.actors?.get?.(actorId)
      ?? globalThis.game?.actors?.contents?.find?.((actor) => String(actor?.id) === String(actorId))
      ?? null
    );
    this.privilegedMutationGateway.registerCommand(TRADER_AUDIT_RECORD_COMMAND, {
      validate: isValidTraderAuditRecordPayload,
      authorize: (payload, { sender }) => traderActorIsOwnedByUser(
        resolveTraderActor(payload.operation.actorId),
        sender
      ),
      execute: (payload, { sender }) => this.traderService.recordTradeAudit(payload.operation, {
        senderId: sender.id
      })
    });
    this.privilegedMutationGateway.registerCommand(TRADER_METADATA_UPDATE_COMMAND, {
      validate: isValidTraderMetadataUpdatePayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload) => this.traderService.updateTraderMetadata(
        payload.cityId,
        payload.traderKey,
        payload.patch
      )
    });
    this.privilegedMutationGateway.registerCommand(GROUP_REGISTRY_REGISTER_COMMAND, {
      validate: isValidGroupRegistryRegisterPayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload, { assertActiveGm }) => this.groupContextService.registerGroup(
        payload.groupActorId,
        { guard: assertActiveGm }
      )
    });
    this.privilegedMutationGateway.registerCommand(GROUP_REGISTRY_ACTIVATE_COMMAND, {
      validate: isValidGroupRegistryActivatePayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload, { assertActiveGm }) => this.groupContextService.setActiveGroup(
        payload.groupActorId,
        { guard: assertActiveGm }
      )
    });
    this.privilegedMutationGateway.registerCommand(GROUP_INVENTORY_MERGE_LEGACY_COMMAND, {
      validate: isValidGroupInventoryMergeLegacyPayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload) => this.runInventoryMutation(
        () => this.inventoryService.mergeLegacyInventoryIntoGroup(payload.groupActorId),
        { actorIdsFromResult: () => [payload.groupActorId] }
      )
    });
    const resolveAuthorizedDowntimeGroup = (groupId) => {
      try {
        const registry = this.groupContextService.getRegistry();
        const safeGroupId = cleanSocketId(groupId);
        const isManagedGroup = this.groupContextService
          .getManagedGroupActors()
          .some((groupActor) => groupActor?.id === safeGroupId);
        if (!safeGroupId || !isManagedGroup || !registry?.groupsById?.[safeGroupId]) return null;
        return this.groupContextService.resolveForGroup(safeGroupId);
      }
      catch {
        return null;
      }
    };
    const authorizeDowntimeOwner = (payload, { sender }) => {
      try {
        const context = resolveAuthorizedDowntimeGroup(payload.groupId);
        const actor = (context.members ?? []).find((member) => member?.id === payload.actorId) ?? null;
        return Boolean(actor) && (sender?.isGM === true || traderActorIsOwnedByUser(actor, sender));
      }
      catch {
        return false;
      }
    };
    const finishDowntimeMutation = (result) => {
      this.#emitDowntimeUpdated({ actorIds: result.actorIds ?? [result.actorId], requestId: result.id });
      return result;
    };
    const authorizeDowntimeAdmin = (payload, { sender }) => {
      if (sender?.isGM !== true) return false;
      return Boolean(resolveAuthorizedDowntimeGroup(payload.groupId));
    };
    this.privilegedMutationGateway.registerCommand(DOWNTIME_WEEKS_GRANT_COMMAND, {
      validate: isValidDowntimeWeeksGrantPayload, authorize: authorizeDowntimeAdmin,
      execute: async (payload) => finishDowntimeMutation(await this.downtimeService.grantWeeks(payload))
    });
    this.privilegedMutationGateway.registerCommand(DOWNTIME_WEEKS_REVOKE_COMMAND, {
      validate: isValidDowntimeWeeksRevokePayload, authorize: authorizeDowntimeAdmin,
      execute: async (payload) => finishDowntimeMutation(await this.downtimeService.revokeWeeks(payload))
    });
    this.privilegedMutationGateway.registerCommand(DOWNTIME_HISTORY_CLEAR_COMMAND, {
      validate: isValidDowntimeHistoryClearPayload, authorize: authorizeDowntimeAdmin,
      execute: async (payload) => finishDowntimeMutation(await this.downtimeService.clearHistory(payload))
    });
    this.privilegedMutationGateway.registerCommand(DOWNTIME_REQUEST_CREATE_COMMAND, {
      validate: isValidDowntimeRequestCreatePayload, authorize: authorizeDowntimeOwner,
      execute: async (payload, { sender }) => finishDowntimeMutation(await this.downtimeService.createRequest({
        ...await this.#prepareDowntimeCraftPayload(payload), submittedByUserId: sender.id
      }))
    });
    this.privilegedMutationGateway.registerCommand(DOWNTIME_REQUEST_UPDATE_COMMAND, {
      validate: isValidDowntimeRequestUpdatePayload, authorize: authorizeDowntimeOwner,
      execute: async (payload) => finishDowntimeMutation(await this.downtimeService.updateRequest(
        await this.#prepareDowntimeCraftPayload(payload)
      ))
    });
    this.privilegedMutationGateway.registerCommand(DOWNTIME_REQUEST_SET_STATUS_COMMAND, {
      validate: isValidDowntimeRequestSetStatusPayload, authorize: authorizeDowntimeAdmin,
      execute: async (payload) => finishDowntimeMutation(await this.downtimeService.setRequestStatus(
        payload.requestId, payload.status, { groupId: payload.groupId, result: payload.result }
      ))
    });
    this.privilegedMutationGateway.registerCommand(DOWNTIME_REQUEST_SET_CHECKS_COMMAND, {
      validate: isValidDowntimeRequestSetChecksPayload, authorize: authorizeDowntimeAdmin,
      execute: async (payload) => finishDowntimeMutation(await this.downtimeService.setRequestChecks(
        payload.requestId, payload.checks, { groupId: payload.groupId }
      ))
    });
    this.privilegedMutationGateway.registerCommand(DOWNTIME_REQUEST_RECORD_CHECK_COMMAND, {
      validate: isValidDowntimeRequestRecordCheckPayload, authorize: authorizeDowntimeOwner,
      execute: async (payload, { sender }) => finishDowntimeMutation(await this.downtimeService.recordCheckResult(
        payload.requestId, payload.checkId, payload.result,
        { groupId: payload.groupId, actorId: payload.actorId, recordedByUserId: sender.id }
      ))
    });
    this.privilegedMutationGateway.registerCommand(DOWNTIME_PROJECT_CONTINUE_COMMAND, {
      validate: isValidDowntimeProjectContinuePayload, authorize: authorizeDowntimeOwner,
      execute: async (payload, { sender }) => finishDowntimeMutation(await this.downtimeService.continueProject(
        payload.requestId, { groupId: payload.groupId, actorId: payload.actorId, checkId: payload.checkId, result: payload.result, recordedByUserId: sender.id }
      ))
    });
    this.privilegedMutationGateway.registerCommand(DOWNTIME_PROJECT_CLOSE_COMMAND, {
      validate: isValidDowntimeProjectClosePayload, authorize: authorizeDowntimeOwner,
      execute: async (payload, { sender }) => finishDowntimeMutation(await this.downtimeService.closeProject(
        payload.requestId, { groupId: payload.groupId, actorId: payload.actorId, projectClosedByUserId: sender.id }
      ))
    });
    this.socketCommandBus.register(GROUP_CALENDAR_PATCH_COMMAND, {
      validate: isValidCalendarPatchPayload,
      authorize: authorizeGroup,
      execute: (payload) => this.calendarService.patchGroupCalendar(payload.groupActorId, payload.patch)
    });
    this.socketCommandBus.register(GROUP_CALENDAR_TRANSITION_COMMAND, {
      validate: isValidCalendarTransitionPayload,
      authorize: authorizeGroup,
      execute: (payload) => this.calendarTransitionCoordinator.moveToGroup(
        payload.groupActorId,
        payload.options
      )
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
    this.socketCommandBus.register(GRAPPLE_TOGGLE_COMMAND, {
      validate: isValidGrappleTogglePayload,
      authorize: (payload, { sender }) => this.#canSenderUseGrappleSource(sender, payload),
      execute: (payload) => this.grappleAutomationService.toggle(payload)
    });
    this.socketCommandBus.register(GRAPPLE_PLACE_COMMAND, {
      validate: isValidGrapplePlacePayload,
      authorize: (payload, { sender }) => this.#canSenderUseGrappleSource(sender, payload),
      execute: (payload) => this.grappleAutomationService.place(payload)
    });
    this.socketCommandBus.register(GRAPPLE_DRAG_COMMAND, {
      validate: isValidGrappleDragPayload,
      authorize: (payload, { sender }) => (
        payload.requesterUserId === cleanSocketId(sender?.id)
        && this.#canSenderUseGrappleSource(sender, payload)
      ),
      execute: (payload) => this.grappleAutomationService.drag(payload)
    });
    this.socketCommandBus.register(GRAPPLE_RELEASE_AND_MOVE_COMMAND, {
      validate: isValidGrappleReleaseAndMovePayload,
      authorize: (payload, { sender }) => this.#canSenderReleaseGrappledTarget(sender, payload),
      execute: (payload) => this.grappleAutomationService.releaseAndMove(payload)
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
    this.socketCommandBus.register(INVENTORY_DISMANTLE_COMMAND, {
      validate: isValidInventoryDismantlePayload,
      authorize: (payload, { sender }) => this.#canSenderManageGroup(sender, payload.inventoryActorId),
      execute: (payload) => this.inventoryService.executeDismantleMutation(payload)
    });
    this.socketCommandBus.register(INVENTORY_IMPORT_COMMAND, {
      validate: isValidInventoryImportPayload,
      authorize: (payload, { sender }) => this.#canSenderImportInventoryItem(sender, payload),
      execute: (payload) => this.inventoryService.executeImportMutation(payload)
    });
    this.socketCommandBus.register(INVENTORY_INGRESS_LOOTGEN_COMMAND, {
      validate: isValidLootgenInventoryIngressPayload,
      authorize: (payload, { sender }) => (
        this.#canSenderManageGroup(sender, payload.groupActorId)
        && Boolean(this.#findLootgenChatMessage(payload.lootId))
      ),
      execute: (payload) => this.runInventoryMutation(
        () => this.#executeLootgenInventoryIngress(payload),
        { actorIdsFromResult: () => [payload.groupActorId] }
      )
    });
    this.socketCommandBus.register(INVENTORY_INGRESS_DIRECT_COMMAND, {
      validate: isValidDirectInventoryIngressPayload,
      authorize: (payload, { sender }) => this.#canSenderManageGroup(sender, payload.groupActorId),
      execute: (payload) => this.runInventoryMutation(
        () => this.#executeDirectInventoryIngress(payload),
        { actorIdsFromResult: () => [payload.groupActorId] }
      )
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
    const registerInventoryOrganizationMutation = (command, validate, methodName) => {
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
            throw new Error(error?.message || "Inventory organization mutation failed.", { cause: error });
          }
        }
      });
    };
    registerInventoryOrganizationMutation(
      INVENTORY_FOLDER_CREATE_COMMAND,
      isValidInventoryFolderCreatePayload,
      "createInventoryFolder"
    );
    registerInventoryOrganizationMutation(
      INVENTORY_FOLDER_RENAME_COMMAND,
      isValidInventoryFolderRenamePayload,
      "renameInventoryFolder"
    );
    registerInventoryOrganizationMutation(
      INVENTORY_FOLDER_MOVE_COMMAND,
      isValidInventoryFolderMovePayload,
      "moveInventoryFolder"
    );
    registerInventoryOrganizationMutation(
      INVENTORY_FOLDER_DELETE_COMMAND,
      isValidInventoryFolderDeletePayload,
      "deleteInventoryFolder"
    );
    registerInventoryOrganizationMutation(
      INVENTORY_ITEM_FOLDER_MOVE_COMMAND,
      isValidInventoryItemFolderMovePayload,
      "moveInventoryItemToFolder"
    );
    registerInventoryOrganizationMutation(
      INVENTORY_INGRESS_RULE_CREATE_COMMAND,
      isValidInventoryIngressRuleWritePayload,
      "createInventoryIngressRule"
    );
    registerInventoryOrganizationMutation(
      INVENTORY_INGRESS_RULE_UPDATE_COMMAND,
      isValidInventoryIngressRuleWritePayload,
      "updateInventoryIngressRule"
    );
    registerInventoryOrganizationMutation(
      INVENTORY_INGRESS_RULE_DELETE_COMMAND,
      isValidInventoryIngressRuleDeletePayload,
      "deleteInventoryIngressRule"
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
    this.socketCommandBus.register(STORAGE_JOURNAL_RECORD_COMMAND, {
      validate: isValidStorageJournalRecordPayload,
      authorize: (_payload, { sender }) => Boolean(sender),
      execute: (payload, { sender }) => this.storageCommandService.recordJournal(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_JOURNAL_RECORD_DROP_COMMAND, {
      validate: isValidJournalRecordDropPayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload, { sender }) => this.runInventoryMutation(
        () => this.storageCommandService.recordJournalDrop(payload, { sender }),
        { actorIdsFromResult: (result) => [result?.actorId] }
      )
    });
    this.socketCommandBus.register(STORAGE_JOURNAL_READ_RECORD_COMMAND, {
      validate: isValidJournalRecordReadPayload,
      authorize: (_payload, { sender }) => Boolean(sender),
      execute: (payload, { sender }) => this.storageCommandService.readJournalRecord(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_CLAIM_ROW_COMMAND, {
      validate: isValidStorageClaimRowPayload,
      authorize: (payload, { sender }) => Boolean(sender)
        && (payload.destination !== "party"
          || this.#canSenderManageGroup(sender, payload.target.groupActorId)),
      execute: (payload, { sender }) => payload.destination === "party"
        ? this.runInventoryMutation(
          () => this.storageCommandService.claimRow(payload, { sender }),
          { actorIdsFromResult: () => [payload.target.groupActorId] }
        )
        : this.storageCommandService.claimRow(payload, { sender })
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
      execute: (payload, { sender }) => payload.destination === "party"
        ? this.runInventoryMutation(
          () => this.storageCommandService.claimAll(payload, { sender }),
          { actorIdsFromResult: () => [payload.target.groupActorId] }
        )
        : this.storageCommandService.claimAll(payload, { sender })
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
    this.socketCommandBus.register(STORAGE_JOURNAL_DROP_COMMAND, {
      validate: isValidStorageJournalDropPayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload, { sender }) => this.storageCommandService.dropJournalToScene(payload, { sender })
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
    this.socketCommandBus.register(STORAGE_TRIGGER_READ_COMMAND, {
      validate: isValidStorageTriggerReadPayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload, { sender }) => this.storageCommandService.readTriggers(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_TRIGGER_SAVE_COMMAND, {
      validate: isValidStorageTriggerSavePayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload, { sender }) => this.storageCommandService.saveTriggers(payload, { sender })
    });
    this.socketCommandBus.register(STORAGE_TRIGGER_RESET_COMMAND, {
      validate: isValidStorageTriggerResetPayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload, { sender }) => this.storageCommandService.resetTriggers(payload, { sender })
    });
    this.socketCommandBus.register(DOOR_OPEN_COMMAND, {
      validate: isValidDoorOpenPayload,
      authorize: (_payload, { sender }) => Boolean(sender),
      execute: (payload, { sender }) => this.doorTriggerCommandService.open(payload, { sender })
    });
    this.socketCommandBus.register(DOOR_TRIGGER_READ_COMMAND, {
      validate: isValidDoorTriggerReadPayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload, { sender }) => this.doorTriggerCommandService.readTriggers(payload, { sender })
    });
    this.socketCommandBus.register(DOOR_TRIGGER_SAVE_COMMAND, {
      validate: isValidDoorTriggerSavePayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload, { sender }) => this.doorTriggerCommandService.saveTriggers(payload, { sender })
    });
    this.socketCommandBus.register(DOOR_TRIGGER_RESET_COMMAND, {
      validate: isValidDoorTriggerResetPayload,
      authorize: (_payload, { sender }) => sender?.isGM === true,
      execute: (payload, { sender }) => this.doorTriggerCommandService.resetTriggers(payload, { sender })
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
    this.socketCommandBus.register(PURCHASE_BASKET_COMMIT_COMMAND, {
      validate: isValidPurchaseBasketPayload,
      authorize: authorizeTradeActor,
      execute: (payload, { sender }) => this.purchaseBasketService.commit(payload, {
        requestedByUserId: sender.id
      })
    });
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

  async #resolveActiveGrappleToken(uuid) {
    const token = await globalThis.fromUuid?.(cleanSocketId(uuid));
    if (token?.documentName !== "Token") return null;
    const activeScene = globalThis.canvas?.scene ?? globalThis.game?.scenes?.active ?? null;
    if (activeScene && cleanSocketId(token.parent?.id) !== cleanSocketId(activeScene.id)) return null;
    return token;
  }

  async #canSenderUseGrappleSource(sender, payload) {
    const source = await this.#resolveActiveGrappleToken(payload?.sourceTokenUuid);
    return documentIsOwnedByUser(source, sender);
  }

  async #canSenderReleaseGrappledTarget(sender, payload) {
    if (payload?.requesterUserId !== cleanSocketId(sender?.id)) return false;
    const target = await this.#resolveActiveGrappleToken(payload?.targetTokenUuid);
    const link = target?.getFlag?.(MODULE_ID, GRAPPLE_LINK_FLAG)
      ?? target?.flags?.[MODULE_ID]?.[GRAPPLE_LINK_FLAG];
    return cleanSocketId(link?.linkId) === cleanSocketId(payload?.linkId)
      && documentIsOwnedByUser(target, sender);
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
    if (documentIsOwnedByUser(groupActor, sender)) {
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
      && Boolean(resolveGroupMemberActor(groupActor, targetActor));
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
      && Boolean(resolveGroupMemberActor(groupActor, sourceActor));
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
    try {
      await this.grappleMacroService.syncManagedDocuments();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to sync managed grapple macros.`, error);
    }
    if (isActiveGmClient(globalThis.game) && globalThis.canvas?.scene) {
      try {
        await this.grappleAutomationService.reconcileScene(globalThis.canvas.scene);
      }
      catch (error) {
        console.warn(`${MODULE_ID} | Failed to reconcile grapple links during initialization.`, error);
      }
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

    if (await this.storageTriggerPromptBroker.handleMessage(message, senderId)) {
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
        await this.refreshInventoryViews({ actorIds: [message.actorId, message.targetActorId] });
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
            }),
            { actorIdsFromResult: (result) => [result?.actorId, result?.targetActorId] }
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
            actorId: result.actorId,
            targetActorId: result.targetActorId,
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

  #buildLootgenInventoryIngressRows(state, rowIds) {
    const rowById = new Map((state?.rows ?? []).map((row) => [String(row?.rowId ?? "").trim(), row]));
    return rowIds.map((sourceKey) => {
      const row = rowById.get(sourceKey);
      if (!row || row.claimed === true) {
        throw new Error(`Строка добычи '${sourceKey}' больше недоступна.`);
      }
      const quantity = Number(row.quantity ?? row.itemData?.system?.quantity ?? 0);
      if (!(quantity > 0)) throw new Error(`Строка добычи '${sourceKey}' имеет некорректное количество.`);
      return {
        sourceKey,
        quantity,
        itemData: foundry.utils.deepClone(row.itemData ?? {}),
        legacyFolderId: null,
        container: null
      };
    });
  }

  async #prepareLootgenInventoryIngress(lootId, rowIds, { batch }) {
    const message = this.#findLootgenChatMessage(lootId);
    if (!message) throw new Error("Сообщение с лутом не найдено.");
    const state = foundry.utils.deepClone(message.getFlag(MODULE_ID, "lootgenChat") ?? {});
    const context = this.groupContextService.resolveForCurrentUser();
    const groupActorId = String(context?.groupActor?.id ?? context?.groupId ?? "").trim();
    if (!groupActorId) throw new Error("Не удалось определить партийный инвентарь.");
    const rows = this.#buildLootgenInventoryIngressRows(state, rowIds);
    const preview = await this.inventoryIngressPlanner.preview({
      groupActorId,
      requestedFolderId: null,
      rows,
      batch
    });
    const choices = await this.inventoryIngressPlanner.collectChoices(preview);
    if (choices === null) return null;
    return {
      groupActorId,
      ingressPlan: this.inventoryIngressPlanner.serialize(preview, choices)
    };
  }

  async #executeLootgenInventoryIngress(payload) {
    const message = this.#findLootgenChatMessage(payload.lootId);
    if (!message) throw new Error("Сообщение с лутом не найдено.");
    return this.lootClaimService.claimBatch({
      messageId: message.id,
      lootId: payload.lootId,
      claimId: payload.batchMutationId,
      rowIds: payload.rowIds,
      includeCoins: payload.includeCoins,
      ingressPlan: payload.ingressPlan
    });
  }

  #normalizeDirectInventoryIngressCoins(coins = {}) {
    return Object.fromEntries(["pp", "gp", "sp", "cp"].map((key) => [
      key,
      Math.max(0, Math.trunc(Number(coins?.[key] ?? 0)) || 0)
    ]));
  }

  #normalizeDirectInventoryIngressSources(sources) {
    return (Array.isArray(sources) ? sources : []).map((source) => ({
      sourceKey: String(source?.sourceKey ?? source?.directGrantId ?? "").trim(),
      sourceType: String(source?.sourceType ?? "").trim(),
      sourceId: String(source?.sourceId ?? "").trim(),
      sourceDocumentId: String(source?.sourceDocumentId ?? "").trim(),
      isBroken: source?.isBroken === true,
      quantity: Math.max(0.01, Math.round((Number(source?.quantity ?? 1) || 1) * 100) / 100)
    }));
  }

  async #buildDirectInventoryIngressRows(sourceOrigin, sources, requestedFolderId) {
    return Promise.all(sources.map(async (source) => ({
      sourceKey: source.sourceKey,
      quantity: source.quantity,
      itemData: sourceOrigin === "lootgen"
        ? await this.inventoryService.buildLootgenItemData(source)
        : await this.inventoryService.buildModelItemData(
          source.sourceType,
          source.sourceId,
          source.quantity
        ),
      legacyFolderId: requestedFolderId,
      container: null
    })));
  }

  async #prepareDirectInventoryIngress({
    groupActorId,
    sourceOrigin,
    sources,
    requestedFolderId = null
  }) {
    if (sources.length === 0) return null;
    const rows = await this.#buildDirectInventoryIngressRows(sourceOrigin, sources, requestedFolderId);
    const preview = await this.inventoryIngressPlanner.preview({
      groupActorId,
      requestedFolderId,
      rows,
      batch: rows.length > 1
    });
    const choices = await this.inventoryIngressPlanner.collectChoices(preview);
    return choices === null ? null : this.inventoryIngressPlanner.serialize(preview, choices);
  }

  async #executeDirectInventoryIngress(payload) {
    let ingressResult = {
      actorId: payload.groupActorId,
      batchMutationId: payload.batchMutationId,
      changed: false,
      rows: []
    };
    if (payload.sources.length > 0) {
      const requestedFolderId = payload.ingressPlan.requestedFolderId ?? null;
      ingressResult = await this.inventoryService.commitInventoryIngressBatch({
        groupActorId: payload.groupActorId,
        batchMutationId: payload.batchMutationId,
        sourceOrigin: payload.sourceOrigin,
        serializedPlan: payload.ingressPlan
      }, {
        resolveRows: () => this.#buildDirectInventoryIngressRows(
          payload.sourceOrigin,
          payload.sources,
          requestedFolderId
        ),
        debitRow: async () => {}
      });
    }
    const coins = this.#normalizeDirectInventoryIngressCoins(payload.coins);
    const coinsGranted = Object.values(coins).some((value) => value > 0);
    if (coinsGranted) {
      await this.inventoryService.addCurrencyToInventoryOnce(
        coins,
        `${payload.batchMutationId}:coins`,
        { groupActorId: payload.groupActorId }
      );
    }
    return {
      ...ingressResult,
      changed: ingressResult.changed || coinsGranted,
      coinsGranted
    };
  }

  async #dispatchInventoryIngress({ command, payload, validate, execute }) {
    if (typeof validate !== "function" || !validate(payload)) {
      throw new TypeError("Inventory ingress command payload is invalid.");
    }
    const exactPayload = cloneSocketPayload(payload);
    const groupActorId = cleanSocketId(
      exactPayload.groupActorId ?? exactPayload.target?.groupActorId
    );
    if (!groupActorId) {
      throw new TypeError("Inventory ingress command requires a group Actor target.");
    }
    if (isActiveGmClient(globalThis.game)) {
      return this.runInventoryMutation(
        () => execute(exactPayload),
        { actorIdsFromResult: () => [groupActorId] }
      );
    }
    const result = await this.socketCommandBus.request(command, exactPayload);
    await this.refreshInventoryViews({ actorIds: [groupActorId] });
    return result;
  }

  async #dispatchLootgenInventoryIngress(payload) {
    const result = await this.#dispatchInventoryIngress({
      command: INVENTORY_INGRESS_LOOTGEN_COMMAND,
      payload,
      validate: isValidLootgenInventoryIngressPayload,
      execute: (exactPayload) => this.#executeLootgenInventoryIngress(exactPayload)
    });
    for (const rowId of result?.claimedRowIds ?? []) {
      this.#notifyLootgenChatClaim(payload.lootId, rowId, "row");
    }
    if (result?.claimedCoins) this.#notifyLootgenChatClaim(payload.lootId, "", "coins");
    return result;
  }

  async #dispatchDirectInventoryIngress(payload) {
    return this.#dispatchInventoryIngress({
      command: INVENTORY_INGRESS_DIRECT_COMMAND,
      payload,
      validate: isValidDirectInventoryIngressPayload,
      execute: (exactPayload) => this.#executeDirectInventoryIngress(exactPayload)
    });
  }

  async claimLootgenChatRowToInventory(lootId, rowId, {
    quiet = false,
    claimId = ""
  } = {}) {
    const safeLootId = String(lootId ?? "").trim();
    const safeRowId = String(rowId ?? "").trim();
    const safeClaimId = String(claimId ?? "").trim() || createSocketRequestId("loot-row-claim");
    if (!safeLootId || !safeRowId) {
      return false;
    }

    const prepared = await this.#prepareLootgenInventoryIngress(safeLootId, [safeRowId], { batch: false });
    if (!prepared) return false;
    const result = await this.#dispatchLootgenInventoryIngress({
      batchMutationId: safeClaimId,
      groupActorId: prepared.groupActorId,
      lootId: safeLootId,
      rowIds: [safeRowId],
      includeCoins: false,
      ingressPlan: prepared.ingressPlan
    });
    if (result.changed && !quiet) ui.notifications?.info("Добыча обработана правилами партийного склада.");
    return result.changed;
  }

  async claimLootgenChatAllToInventory(lootId, {
    quiet = false,
    claimId = ""
  } = {}) {
    const safeLootId = String(lootId ?? "").trim();
    if (!safeLootId) {
      return false;
    }

    const batchClaimId = String(claimId ?? "").trim() || createSocketRequestId("loot-all-claim");
    const message = this.#findLootgenChatMessage(safeLootId);
    const state = foundry.utils.deepClone(message?.getFlag(MODULE_ID, "lootgenChat") ?? {});
    const rowIds = (state.rows ?? [])
      .filter((row) => row?.claimed !== true)
      .map((row) => String(row.rowId ?? "").trim())
      .filter(Boolean);
    if (rowIds.length === 0) {
      return this.claimLootgenChatCoins(safeLootId, { quiet, claimId: `${batchClaimId}:coins` });
    }
    const prepared = await this.#prepareLootgenInventoryIngress(safeLootId, rowIds, { batch: true });
    if (!prepared) return false;
    const result = await this.#dispatchLootgenInventoryIngress({
      batchMutationId: batchClaimId,
      groupActorId: prepared.groupActorId,
      lootId: safeLootId,
      rowIds,
      includeCoins: state.coinsClaimed !== true,
      ingressPlan: prepared.ingressPlan
    });
    if (result.changed && !quiet) {
      ui.notifications?.info("Вся доступная добыча добавлена в партийный склад.");
    }
    return result.changed;
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
      await this.magicItemsCompendium.syncOwnedMagicItems({ reportToConsole: false });
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

  async #executeGlobalEventsMutation(operation) {
    const result = await operation();
    if (this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }
    return result;
  }

  async #dispatchGlobalEventsMutation(command, payload) {
    const result = await this.privilegedMutationGateway.mutate(command, payload);
    await this.refreshOpenApps();
    return result;
  }

  async createGlobalEvent(data = {}) {
    return this.#dispatchGlobalEventsMutation(GLOBAL_EVENTS_CREATE_COMMAND, { data });
  }

  async updateGlobalEvent(id, patch = {}) {
    return this.#dispatchGlobalEventsMutation(GLOBAL_EVENTS_UPDATE_COMMAND, {
      eventId: String(id ?? "").trim(),
      patch
    });
  }

  async deleteGlobalEvent(id) {
    return this.#dispatchGlobalEventsMutation(GLOBAL_EVENTS_DELETE_COMMAND, {
      eventId: String(id ?? "").trim()
    });
  }

  async duplicateGlobalEvent(id) {
    return this.#dispatchGlobalEventsMutation(GLOBAL_EVENTS_DUPLICATE_COMMAND, {
      eventId: String(id ?? "").trim()
    });
  }

  async importDefaultGlobalEventTemplates() {
    return this.#dispatchGlobalEventsMutation(GLOBAL_EVENTS_IMPORT_DEFAULTS_COMMAND, {});
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
    const result = await this.privilegedMutationGateway.mutate(ECONOMY_CITY_PRESENTATION_UPDATE_COMMAND, { cityId, patch });
    await this.refreshCityViews({ cityIds: [cityId] });
    return result;
  }

  async resetCityPresentation(cityId, fields = ["description", "image"]) {
    const allowed = new Set(["description", "image"]);
    const patch = Object.fromEntries((fields ?? []).filter((field) => allowed.has(field)).map((field) => [field, null]));
    if (!Object.keys(patch).length) return this.getCityPresentation(cityId);
    const result = await this.privilegedMutationGateway.mutate(ECONOMY_CITY_PRESENTATION_UPDATE_COMMAND, { cityId, patch });
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
    await this.privilegedMutationGateway.mutate(ECONOMY_CONNECTION_SET_ACTIVE_COMMAND, { connectionId, isActive });
    await this.refreshOpenApps();
    return this.repository.model;
  }

  async updateReferenceDescription(entryType, entryId, description) {
    await this.privilegedMutationGateway.mutate(ECONOMY_REFERENCE_UPDATE_DESCRIPTION_COMMAND, { entryType, entryId, description });
    await this.refreshOpenApps();
    return this.getReferenceEntrySnapshot(entryType, entryId);
  }

  async updateTradeRouteMetadata(connectionId, patch) {
    const route = await this.privilegedMutationGateway.mutate(ECONOMY_TRADE_ROUTE_UPDATE_METADATA_COMMAND, { connectionId, patch });
    await this.refreshOpenApps();
    return route;
  }

  async updateStatePolicy(stateId, patch) {
    const policy = await this.privilegedMutationGateway.mutate(ECONOMY_STATE_POLICY_UPDATE_COMMAND, { stateId, patch });
    await this.refreshOpenApps();
    return policy;
  }

  async resetWorldData({ notify = false } = {}) {
    const model = await this.privilegedMutationGateway.mutate(ECONOMY_WORLD_DATA_RESET_COMMAND, {});
    if (notify) {
      ui.notifications?.info(game.i18n.localize("REBREYA_MAIN.Notifications.DataRestored"));
    }

    await this.refreshOpenApps();
    return model;
  }

  getMaterialByGoodId(goodId) {
    return this.repository.getMaterialByGoodId(goodId);
  }

  registerPanelTool(moduleId, definition) {
    return registerExternalPanelTool(moduleId, definition);
  }

  unregisterPanelTool(moduleId, toolName) {
    return unregisterExternalPanelTool(moduleId, toolName);
  }

  async purchaseItemBasket(payload) {
    if (!isValidPurchaseBasketPayload(payload)) {
      throw new Error("Invalid purchase basket request");
    }
    if (isActiveGmClient(globalThis.game)) {
      return this.purchaseBasketService.commit(payload, {
        requestedByUserId: String(globalThis.game?.user?.id ?? "")
      });
    }
    return this.socketCommandBus.request(PURCHASE_BASKET_COMMIT_COMMAND, payload, {
      requestId: payload.transactionId
    });
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
    const record = await this.privilegedMutationGateway.mutate(TRADER_AUDIT_RECORD_COMMAND, {
      operation
    });
    await this.refreshOpenApps();
    return record;
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
    const trader = await this.privilegedMutationGateway.mutate(TRADER_METADATA_UPDATE_COMMAND, {
      cityId,
      traderKey,
      patch
    });
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
      mutationId: cleanSocketId(request.mutationId) || createSocketRequestId("storage-open"),
      ...(path.length ? { path } : {})
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.open(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_OPEN_COMMAND, payload);
  }

  getDoorTriggerPreflight(wallUuid) {
    const safeWallUuid = cleanSocketId(wallUuid);
    let wall = globalThis.fromUuidSync?.(safeWallUuid) ?? null;
    if (!wall) {
      const match = /^Scene\.([^.]+)\.Wall\.([^.]+)$/u.exec(safeWallUuid);
      if (match && String(globalThis.canvas?.scene?.id ?? "") === match[1]) {
        wall = globalThis.canvas?.scene?.walls?.get?.(match[2]) ?? null;
      }
    }
    const target = readDoorTriggerTarget(wall);
    return {
      configured: target.configured === true,
      enabled: target.enabled === true,
      ...preflightDoorAccess(wall, { game: globalThis.game, canvas: globalThis.canvas })
    };
  }

  async getDoorTriggers(wallUuid) {
    if (globalThis.game?.user?.isGM !== true) throw new Error("Настраивать триггеры может только мастер.");
    const payload = { wallUuid: cleanSocketId(wallUuid) };
    return isActiveGmClient(globalThis.game)
      ? this.doorTriggerCommandService.readTriggers(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(DOOR_TRIGGER_READ_COMMAND, payload);
  }

  async saveDoorTriggers(wallUuid, enabled, definitions, expectedRevision, operationId = "") {
    if (globalThis.game?.user?.isGM !== true) throw new Error("Настраивать триггеры может только мастер.");
    const payload = {
      wallUuid: cleanSocketId(wallUuid),
      enabled: enabled === true,
      definitions: globalThis.foundry?.utils?.deepClone?.(definitions) ?? JSON.parse(JSON.stringify(definitions)),
      expectedRevision: Number(expectedRevision),
      operationId: cleanSocketId(operationId) || createSocketRequestId("door-triggers-save")
    };
    return isActiveGmClient(globalThis.game)
      ? this.doorTriggerCommandService.saveTriggers(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(DOOR_TRIGGER_SAVE_COMMAND, payload);
  }

  async resetDoorTriggerExecutions(wallUuid, operationId = "") {
    if (globalThis.game?.user?.isGM !== true) throw new Error("Настраивать триггеры может только мастер.");
    const payload = {
      wallUuid: cleanSocketId(wallUuid),
      operationId: cleanSocketId(operationId) || createSocketRequestId("door-triggers-reset")
    };
    return isActiveGmClient(globalThis.game)
      ? this.doorTriggerCommandService.resetTriggers(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(DOOR_TRIGGER_RESET_COMMAND, payload);
  }

  async attemptDoorOpen(wallUuid, mutationId = "", request = {}) {
    const payload = {
      wallUuid: cleanSocketId(wallUuid),
      characterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
      mutationId: cleanSocketId(mutationId) || createSocketRequestId("door-open")
    };
    return isActiveGmClient(globalThis.game)
      ? this.doorTriggerCommandService.open(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(DOOR_OPEN_COMMAND, payload);
  }

  async getStorageTriggers(tokenUuid, request = {}) {
    if (globalThis.game?.user?.isGM !== true) throw new Error("Настраивать триггеры может только мастер.");
    const path = cleanStoragePath(request.path);
    const payload = {
      tokenUuid: cleanSocketId(tokenUuid),
      ...(path.length ? { path } : {})
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.readTriggers(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_TRIGGER_READ_COMMAND, payload);
  }

  async saveStorageTriggers(tokenUuid, definitions, expectedRevision, operationId = "", request = {}) {
    if (globalThis.game?.user?.isGM !== true) throw new Error("Настраивать триггеры может только мастер.");
    const path = cleanStoragePath(request.path);
    const payload = {
      tokenUuid: cleanSocketId(tokenUuid),
      definitions: foundry.utils.deepClone(definitions),
      expectedRevision: Number(expectedRevision),
      operationId: cleanSocketId(operationId) || createSocketRequestId("storage-triggers-save"),
      ...(path.length ? { path } : {})
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.saveTriggers(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_TRIGGER_SAVE_COMMAND, payload);
  }

  async resetStorageTriggerExecutions(tokenUuid, operationId = "", request = {}) {
    if (globalThis.game?.user?.isGM !== true) throw new Error("Настраивать триггеры может только мастер.");
    const path = cleanStoragePath(request.path);
    const payload = {
      tokenUuid: cleanSocketId(tokenUuid),
      operationId: cleanSocketId(operationId) || createSocketRequestId("storage-triggers-reset"),
      ...(path.length ? { path } : {})
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.resetTriggers(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_TRIGGER_RESET_COMMAND, payload);
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

  async recordStorageJournal(tokenUuid, rowId, mutationId = "", request = {}) {
    const path = cleanStoragePath(request.path);
    const groupContext = globalThis.game?.user?.isGM === true
      ? this.groupContextService.resolveForCurrentUser()
      : null;
    const payload = {
      tokenUuid: cleanSocketId(tokenUuid),
      characterTokenUuid: this.#controlledCharacterTokenUuid(request.characterTokenUuid),
      groupActorId: cleanSocketId(groupContext?.groupActor?.id ?? groupContext?.groupId),
      rowId: cleanSocketId(rowId),
      mutationId: cleanSocketId(mutationId) || createSocketRequestId("storage-journal-record"),
      ...(path.length ? { path } : {})
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.recordJournal(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_JOURNAL_RECORD_COMMAND, payload);
  }

  async readJournalRecord(itemUuid) {
    const payload = { itemUuid: cleanSocketId(itemUuid) };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.readJournalRecord(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_JOURNAL_READ_RECORD_COMMAND, payload);
  }

  #buildStorageInventoryIngressRows(snapshot, {
    rowIds = null,
    quantity = null,
    legacyFolderId = null
  } = {}) {
    const requested = rowIds === null ? null : new Set(rowIds.map(cleanSocketId));
    const rows = (snapshot?.rows ?? [])
      .filter((row) => !isStorageJournalRow(row))
      .filter((row) => requested === null || requested.has(cleanSocketId(row?.rowId)))
      .map((row) => {
        const available = Math.max(1, Math.trunc(Number(
          row?.quantity ?? row?.itemData?.system?.quantity ?? 1
        )) || 1);
        const selectedQuantity = quantity === null ? available : Number(quantity);
        const itemData = foundry.utils.deepClone(row?.itemData ?? {});
        itemData.system ??= {};
        itemData.system.quantity = selectedQuantity;
        return {
          sourceKey: cleanSocketId(row?.rowId),
          quantity: selectedQuantity,
          itemData,
          legacyFolderId,
          container: row?.rowKind === "container" ? foundry.utils.deepClone(row.container ?? null) : null
        };
      });
    if (requested && rows.length !== requested.size) {
      throw new Error("Предмет хранилища уже недоступен.");
    }
    return rows;
  }

  async #prepareStorageInventoryIngress({ tokenUuid, path, target, rowIds = null, quantity = null }) {
    const snapshot = await this.getStorageSnapshot(tokenUuid, { path });
    const rows = this.#buildStorageInventoryIngressRows(snapshot, {
      rowIds,
      quantity,
      legacyFolderId: target.folderId
    });
    const preview = await this.inventoryIngressPlanner.preview({
      groupActorId: target.groupActorId,
      requestedFolderId: target.folderId,
      rows,
      batch: rows.length > 1
    });
    const choices = await this.inventoryIngressPlanner.collectChoices(preview);
    if (choices === null) return null;
    return this.inventoryIngressPlanner.serialize(preview, choices);
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
        y: Number(request.target?.y),
        ...(request.target?.rotation !== undefined
          ? { rotation: Number(request.target.rotation) }
          : {})
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
    const quantity = request.quantity === undefined ? null : Number(request.quantity);
    const ingressPlan = safeDestination === "party"
      ? await this.#prepareStorageInventoryIngress({
        tokenUuid: safeTokenUuid,
        path,
        target,
        rowIds: [cleanSocketId(rowId)],
        quantity
      })
      : null;
    if (safeDestination === "party" && ingressPlan === null) return null;
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
      quantity,
      target,
      ingressPlan,
      mutationId: cleanSocketId(mutationId),
      ...(path.length ? { path } : {})
    };
    if (safeDestination === "party") {
      return this.#dispatchInventoryIngress({
        command: STORAGE_CLAIM_ROW_COMMAND,
        payload,
        validate: isValidStorageClaimRowPayload,
        execute: (exactPayload) => this.storageCommandService.claimRow(exactPayload, {
          sender: globalThis.game?.user
        })
      });
    }
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
    const ingressPlan = safeDestination === "party"
      ? await this.#prepareStorageInventoryIngress({
        tokenUuid: safeTokenUuid,
        path,
        target
      })
      : null;
    if (safeDestination === "party" && ingressPlan === null) return null;
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
      ingressPlan,
      mutationId: cleanSocketId(mutationId),
      ...(path.length ? { path } : {})
    };
    if (safeDestination === "party") {
      return this.#dispatchInventoryIngress({
        command: STORAGE_CLAIM_ALL_COMMAND,
        payload,
        validate: isValidStorageClaimAllPayload,
        execute: (exactPayload) => this.storageCommandService.claimAll(exactPayload, {
          sender: globalThis.game?.user
        })
      });
    }
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
      img: cleanSocketId(resolved.row?.img ?? resolved.item?.img),
      placement: deriveGroundPilePlacement(resolved.row)
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
            sourceUuid: cleanSocketId(source.sourceUuid),
            documentName: cleanSocketId(source.documentName)
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
      ...(request.administrative === true ? { administrative: true } : {}),
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
      ...(request.rotation !== undefined ? { rotation: Number(request.rotation) } : {}),
      mutationId: cleanSocketId(request.mutationId) || createSocketRequestId("storage-item-scene")
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.dropItemToScene(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_DROP_ITEM_COMMAND, payload);
  }

  async dropStorageJournalToScene(sourceUuid, request = {}) {
    const payload = {
      sourceUuid: cleanSocketId(sourceUuid),
      documentName: cleanSocketId(request.documentName) || "JournalEntry",
      sceneId: cleanSocketId(request.sceneId),
      x: Number(request.x),
      y: Number(request.y),
      mutationId: cleanSocketId(request.mutationId) || createSocketRequestId("storage-journal-scene")
    };
    return isActiveGmClient(globalThis.game)
      ? this.storageCommandService.dropJournalToScene(payload, { sender: globalThis.game?.user })
      : this.socketCommandBus.request(STORAGE_JOURNAL_DROP_COMMAND, payload);
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
      && isMaterializedCorpseStorageState(readStorageState(token));
    if (!isStorageActor(token.actor)
      && !(allowCorpse && isCorpseStorageTarget(token))
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
        mixGeneratedLoot: state.mixGeneratedLoot,
        manualRows: foundry.utils.deepClone(state.manualRows),
        manualCoins: foundry.utils.deepClone(state.manualCoins),
        textures: foundry.utils.deepClone(state.textures),
        displayMode: state.displayMode,
        triggerActiveCount: Object.values(state.triggers?.chainsByEvent ?? {})
          .flat()
          .filter((chain) => chain?.unsupported !== true && chain?.enabled === true)
          .length
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
    if (Object.prototype.hasOwnProperty.call(config, "mixGeneratedLoot")) {
      if (typeof config.mixGeneratedLoot !== "boolean") {
        throw new Error("Настройка смешивания случайного лута должна быть логическим значением.");
      }
      patch.mixGeneratedLoot = config.mixGeneratedLoot;
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
    await this.builtinStorageActorService.sync();
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

  async setStorageRowBroken(tokenUuid, rowId, broken, request = {}) {
    if (!globalThis.game?.user?.isGM) throw new Error("Изменять состояние предмета может только мастер.");
    const token = await this.#resolveStorageToken(tokenUuid, { allowMaterializedCorpse: true });
    const next = await this.storageService.setRowBroken(token, cleanSocketId(rowId), broken, {
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
      if (globalThis.game?.user?.isGM !== true) throw new Error("Настраивать хранилища может только мастер.");
      const token = await this.#resolveStorageToken(safeTokenUuid, { allowCorpse: true });
      if (!isStorageActor(token.actor)
        && isDeadNpcStorageTarget(token)
        && !isMaterializedCorpseStorageState(readStorageState(token))) {
        await this.storageService.open(token, {
          senderId: cleanSocketId(globalThis.game?.user?.id),
          path: safePath,
          administrative: true
        });
      }
    }
    else {
      await this.openStorage(safeTokenUuid, {
        path: safePath,
        characterTokenUuid: safeCharacterTokenUuid
      });
    }
    const moduleVersion = game.modules.get(MODULE_ID)?.version ?? "1.4.96";
    const { StorageApp } = await import(
      `./ui/storage-app.js?v=${encodeURIComponent(`${moduleVersion}-journal-record-drop`)}`
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

  async openStorageTriggerEditor(tokenUuid, request = {}) {
    if (globalThis.game?.user?.isGM !== true) throw new Error("Настраивать триггеры может только мастер.");
    const safeTokenUuid = cleanSocketId(tokenUuid);
    const path = cleanStoragePath(request.path);
    if (!safeTokenUuid) throw new Error("Не указан токен хранилища.");
    const snapshot = await this.getStorageSnapshot(safeTokenUuid, { path });
    const moduleVersion = game.modules.get(MODULE_ID)?.version ?? "1.4.96";
    const { StorageTriggerEditor } = await import(
      `./ui/storage-trigger-editor.js?v=${encodeURIComponent(`${moduleVersion}-storage-triggers`)}`
    );
    const key = [safeTokenUuid, ...path].join(":");
    let app = this.storageTriggerEditors.get(key);
    if (!app) {
      app = new StorageTriggerEditor(this, safeTokenUuid, { path, storageName: cleanSocketId(snapshot?.name) });
      this.storageTriggerEditors.set(key, app);
    }
    await app.render({ force: true });
    bringAppToFront(app);
    return app;
  }

  async openDoorTriggerEditor(wallUuid) {
    if (globalThis.game?.user?.isGM !== true) throw new Error("Настраивать триггеры может только мастер.");
    const safeWallUuid = cleanSocketId(wallUuid);
    if (!safeWallUuid) throw new Error("Не указана дверь.");
    const wall = await globalThis.fromUuid?.(safeWallUuid);
    const none = Number(globalThis.CONST?.WALL_DOOR_TYPES?.NONE ?? 0);
    if (wall?.documentName !== "Wall" || Number(wall?.door) === none) throw new Error("Дверь недоступна.");
    const moduleVersion = globalThis.game?.modules?.get?.(MODULE_ID)?.version ?? "1.4.197";
    const { TriggerEditor } = await import(
      `./ui/storage-trigger-editor.js?v=${encodeURIComponent(`${moduleVersion}-door-trigger-target`)}`
    );
    let app = this.doorTriggerEditors.get(safeWallUuid);
    if (!app) {
      app = new TriggerEditor(this, { kind: "door", uuid: safeWallUuid, path: [] }, {
        targetName: cleanSocketId(wall?.name) || "Дверь",
        availableEvents: ["beforeOpen", "afterOpen"],
        canToggleEnabled: false
      });
      this.doorTriggerEditors.set(safeWallUuid, app);
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
    const groupId = this.#captureDowntimeGroupId(payload.groupId);
    const result = await this.privilegedMutationGateway.mutate(DOWNTIME_WEEKS_GRANT_COMMAND, {
      groupId, actorIds: Array.isArray(payload.actorIds) ? payload.actorIds : [], weeks: Number(payload.weeks),
      reason: typeof payload.reason === "string" ? payload.reason : "", fromIsoDate: typeof payload.fromIsoDate === "string" ? payload.fromIsoDate : ""
    });
    await this.refreshDowntimeViews({ actorIds: result.actorIds });
    return result;
  }

  async revokeDowntimeWeeks(payload = {}) {
    const groupId = this.#captureDowntimeGroupId(payload.groupId);
    const result = await this.privilegedMutationGateway.mutate(DOWNTIME_WEEKS_REVOKE_COMMAND, {
      groupId, actorIds: Array.isArray(payload.actorIds) ? payload.actorIds : [], weeks: Number(payload.weeks), reason: typeof payload.reason === "string" ? payload.reason : ""
    });
    await this.refreshDowntimeViews({ actorIds: result.actorIds });
    return result;
  }

  async clearDowntimeHistory({ groupId = "" } = {}) {
    const result = await this.privilegedMutationGateway.mutate(DOWNTIME_HISTORY_CLEAR_COMMAND, {
      groupId: this.#captureDowntimeGroupId(groupId)
    });
    await this.refreshDowntimeViews({ actorIds: result.actorIds });
    return result;
  }

  async createDowntimeRequest(payload = {}, { refreshActorSheets = true } = {}) {
    const groupId = this.#captureDowntimeGroupId(payload.groupId);
    const result = await this.privilegedMutationGateway.mutate(DOWNTIME_REQUEST_CREATE_COMMAND, this.#buildDowntimeRequestPayload(payload, { groupId }));
    await this.refreshDowntimeViews({
      actorIds: refreshActorSheets ? [result.actorId] : []
    });
    return result;
  }

  async updateDowntimeRequest(payload = {}, { refreshActorSheets = true } = {}) {
    const groupId = this.#captureDowntimeGroupId(payload.groupId);
    const result = await this.privilegedMutationGateway.mutate(DOWNTIME_REQUEST_UPDATE_COMMAND, this.#buildDowntimeRequestPayload(payload, { groupId, includeRequestId: true }));
    await this.refreshDowntimeViews({
      actorIds: refreshActorSheets ? [result.actorId] : []
    });
    return result;
  }

  previewCraftDowntimeRequest(payload = {}) {
    return this.craftingService.previewRequest(payload);
  }

  #captureDowntimeGroupId(groupId = "") {
    return cleanSocketId(groupId)
      || cleanSocketId(this.groupContextService.resolveForCurrentUser()?.groupId);
  }

  #buildDowntimeRequestPayload(payload = {}, { groupId, includeRequestId = false } = {}) {
    const safePayload = cloneSocketPayload(payload);
    const request = {
      groupId,
      actorId: cleanSocketId(safePayload.actorId),
      actionId: cleanSocketId(safePayload.actionId),
      title: typeof safePayload.title === "string" ? safePayload.title : "",
      description: typeof safePayload.description === "string" ? safePayload.description : "",
      weeks: Number(safePayload.weeks ?? 1),
      craftProject: isPlainObject(safePayload.craftProject) ? safePayload.craftProject : null,
      targetActionSelections: Array.isArray(safePayload.targetActionSelections) ? safePayload.targetActionSelections : []
    };
    if (includeRequestId) request.requestId = cleanSocketId(safePayload.requestId);
    return request;
  }

  async #prepareDowntimeCraftPayload(payload = {}) {
    const safePayload = cloneSocketPayload(payload);
    const craftProject = isPlainObject(safePayload.craftProject)
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

  async #handleDowntimeUpdatedSocketMessage(message = {}) {
    await this.refreshDowntimeViews({ actorIds: message.actorIds });
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
    const result = await this.privilegedMutationGateway.mutate(DOWNTIME_REQUEST_SET_STATUS_COMMAND, {
      groupId: this.#captureDowntimeGroupId(options.groupId), requestId: cleanSocketId(requestId), status: cleanSocketId(status), result: options.result ?? ""
    });
    await this.refreshDowntimeViews({ actorIds: [result.actorId] });
    return result;
  }

  async setDowntimeRequestChecks(requestId, checks = [], options = {}) {
    const result = await this.privilegedMutationGateway.mutate(DOWNTIME_REQUEST_SET_CHECKS_COMMAND, {
      groupId: this.#captureDowntimeGroupId(options.groupId), requestId: cleanSocketId(requestId), checks: Array.isArray(checks) ? checks : []
    });
    await this.refreshDowntimeViews({ actorIds: [result.actorId] });
    return result;
  }

  async recordDowntimeCheckResult(requestId, checkId, result = {}, options = {}) {
    const updatedRequest = await this.privilegedMutationGateway.mutate(DOWNTIME_REQUEST_RECORD_CHECK_COMMAND, {
      groupId: this.#captureDowntimeGroupId(options.groupId), actorId: cleanSocketId(options.actorId), requestId: cleanSocketId(requestId), checkId: cleanSocketId(checkId), result: cloneSocketPayload(result)
    });
    await this.refreshDowntimeViews({ actorIds: [updatedRequest.actorId] });
    return updatedRequest;
  }

  async continueDowntimeProject({ requestId = "", groupId = "", actorId = "", checkId = "", result = {} } = {}) {
    const continuedRequest = await this.privilegedMutationGateway.mutate(DOWNTIME_PROJECT_CONTINUE_COMMAND, {
      groupId: this.#captureDowntimeGroupId(groupId), actorId: cleanSocketId(actorId), requestId: cleanSocketId(requestId), checkId: cleanSocketId(checkId), result: cloneSocketPayload(result)
    });
    await this.refreshDowntimeViews({ actorIds: [continuedRequest.actorId] });
    return continuedRequest;
  }

  async closeDowntimeProject({ requestId = "", groupId = "", actorId = "" } = {}) {
    const result = await this.privilegedMutationGateway.mutate(DOWNTIME_PROJECT_CLOSE_COMMAND, {
      groupId: this.#captureDowntimeGroupId(groupId), actorId: cleanSocketId(actorId), requestId: cleanSocketId(requestId)
    });
    await this.refreshDowntimeViews({ actorIds: [result.actorId] });
    return result;
  }

  getDowntimeActionCatalog() {
    return this.downtimeService.getActionCatalog();
  }

  async registerPartyGroup(groupActorId) {
    const result = await this.privilegedMutationGateway.mutate(GROUP_REGISTRY_REGISTER_COMMAND, {
      groupActorId
    });
    await this.refreshOpenApps();
    return result;
  }

  async mergeLegacyInventoryIntoGroup(groupActorId) {
    return this.privilegedMutationGateway.mutate(GROUP_INVENTORY_MERGE_LEGACY_COMMAND, {
      groupActorId
    });
  }

  async setActivePartyGroup(groupActorId) {
    const result = await this.privilegedMutationGateway.mutate(GROUP_REGISTRY_ACTIVATE_COMMAND, {
      groupActorId
    });
    await this.refreshOpenApps();
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

  async #runInventoryOrganizationMutation(command, payload, validate, methodName) {
    if (!validate(payload)) {
      throw new TypeError("Inventory organization command payload is invalid.");
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
    return this.#runInventoryOrganizationMutation(
      INVENTORY_FOLDER_CREATE_COMMAND,
      payload,
      isValidInventoryFolderCreatePayload,
      "createInventoryFolder"
    );
  }

  renameInventoryFolder(payload) {
    return this.#runInventoryOrganizationMutation(
      INVENTORY_FOLDER_RENAME_COMMAND,
      payload,
      isValidInventoryFolderRenamePayload,
      "renameInventoryFolder"
    );
  }

  moveInventoryFolder(payload) {
    return this.#runInventoryOrganizationMutation(
      INVENTORY_FOLDER_MOVE_COMMAND,
      payload,
      isValidInventoryFolderMovePayload,
      "moveInventoryFolder"
    );
  }

  deleteInventoryFolder(payload) {
    return this.#runInventoryOrganizationMutation(
      INVENTORY_FOLDER_DELETE_COMMAND,
      payload,
      isValidInventoryFolderDeletePayload,
      "deleteInventoryFolder"
    );
  }

  moveInventoryItemToFolder(payload) {
    return this.#runInventoryOrganizationMutation(
      INVENTORY_ITEM_FOLDER_MOVE_COMMAND,
      payload,
      isValidInventoryItemFolderMovePayload,
      "moveInventoryItemToFolder"
    );
  }

  getInventoryIngressRuleState(payload) {
    return this.inventoryService.getInventoryIngressRuleState(payload);
  }

  createInventoryIngressRule(payload) {
    return this.#runInventoryOrganizationMutation(
      INVENTORY_INGRESS_RULE_CREATE_COMMAND,
      payload,
      isValidInventoryIngressRuleWritePayload,
      "createInventoryIngressRule"
    );
  }

  updateInventoryIngressRule(payload) {
    return this.#runInventoryOrganizationMutation(
      INVENTORY_INGRESS_RULE_UPDATE_COMMAND,
      payload,
      isValidInventoryIngressRuleWritePayload,
      "updateInventoryIngressRule"
    );
  }

  deleteInventoryIngressRule(payload) {
    return this.#runInventoryOrganizationMutation(
      INVENTORY_INGRESS_RULE_DELETE_COMMAND,
      payload,
      isValidInventoryIngressRuleDeletePayload,
      "deleteInventoryIngressRule"
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
      return this.claimStorageRow(
        storageDrop.tokenUuid,
        storageDrop.rowId,
        "party",
        createSocketRequestId("storage-party-drop"),
        { quantity, target }
      );
    }
    const journalDrop = parseStorageDepositDragData(dropData);
    if (journalDrop?.kind === "journal") {
      const payload = {
        sourceUuid: journalDrop.sourceUuid,
        documentName: journalDrop.documentName,
        groupActorId: target.groupActorId,
        folderId: target.folderId,
        mutationId: createSocketRequestId("storage-journal-record-drop")
      };
      if (!payload.groupActorId) throw new Error("Не удалось определить группу назначения.");
      return isActiveGmClient(globalThis.game)
        ? this.runInventoryMutation(
            () => this.storageCommandService.recordJournalDrop(payload, { sender: globalThis.game?.user }),
            { actorIdsFromResult: (result) => [result?.actorId] }
          )
        : this.socketCommandBus.request(STORAGE_JOURNAL_RECORD_DROP_COMMAND, payload);
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

  async addModelItemToInventory(sourceType, sourceId, quantity = 1, options = {}) {
    const context = this.groupContextService.resolveForCurrentUser();
    const groupActorId = String(
      options.groupActorId ?? context?.groupActor?.id ?? context?.groupId ?? ""
    ).trim();
    const batchMutationId = String(options.batchMutationId ?? "").trim()
      || createSocketRequestId("inventory-model");
    const requestedFolderId = options.folderId === null || options.folderId === undefined
      ? null
      : String(options.folderId).trim();
    const sources = this.#normalizeDirectInventoryIngressSources([{
      sourceKey: "item",
      sourceType,
      sourceId,
      quantity
    }]);
    const ingressPlan = await this.#prepareDirectInventoryIngress({
      groupActorId,
      sourceOrigin: "public-model",
      sources,
      requestedFolderId
    });
    if (ingressPlan === null) {
      return { actorId: groupActorId, batchMutationId, cancelled: true, changed: false, rows: [] };
    }
    return this.#dispatchDirectInventoryIngress({
      batchMutationId,
      coins: this.#normalizeDirectInventoryIngressCoins(),
      groupActorId,
      ingressPlan,
      sourceOrigin: "public-model",
      sources
    });
  }

  async addLootgenRowToInventory(row = {}) {
    const mutationId = String(row.directGrantId ?? "").trim();
    if (!mutationId) {
      throw new Error("Для выдачи строки Lootgen нужен стабильный идентификатор.");
    }
    return this.addLootgenRowsToInventory([row], { batchMutationId: mutationId });
  }

  async addLootgenRowsToInventory(rows = [], {
    coins = {},
    batchMutationId = ""
  } = {}) {
    const context = this.groupContextService.resolveForCurrentUser();
    const groupActorId = String(context?.groupActor?.id ?? context?.groupId ?? "").trim();
    const sources = this.#normalizeDirectInventoryIngressSources(rows);
    const stableBatchMutationId = String(batchMutationId ?? "").trim();
    if (!stableBatchMutationId) {
      throw new Error("Для пакетной выдачи Lootgen нужен стабильный идентификатор.");
    }
    const normalizedCoins = this.#normalizeDirectInventoryIngressCoins(coins);
    const ingressPlan = await this.#prepareDirectInventoryIngress({
      groupActorId,
      sourceOrigin: "lootgen",
      sources,
      requestedFolderId: null
    });
    if (sources.length > 0 && ingressPlan === null) {
      return {
        actorId: groupActorId,
        batchMutationId: stableBatchMutationId,
        cancelled: true,
        changed: false,
        rows: []
      };
    }
    return this.#dispatchDirectInventoryIngress({
      batchMutationId: stableBatchMutationId,
      coins: normalizedCoins,
      groupActorId,
      ingressPlan,
      sourceOrigin: "lootgen",
      sources
    });
  }

  async addLootgenCoinsToInventory(coins = {}, mutationId = "") {
    const stableMutationId = String(mutationId ?? "").trim();
    if (!stableMutationId) {
      throw new Error("Для выдачи монет Lootgen нужен стабильный идентификатор.");
    }
    return this.addLootgenRowsToInventory([], {
      coins,
      batchMutationId: stableMutationId
    });
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

  async syncEquippedMagicItems(options = {}) {
    return this.syncOwnedMagicItems(options);
  }

  async syncOwnedMagicItems(options = {}) {
    return this.magicItemsCompendium.syncOwnedMagicItems(options);
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
    publishPanelToolApi(game.modules.get(MODULE_ID));
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to publish panel tool API.`, error);
  }

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
    patchDnd5eTooltipRaceGuard();
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to patch dnd5e tooltip race.`, error);
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
    registerDoorTriggerHooks(moduleApi, { hooks: Hooks });
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register door trigger hooks.`, error);
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
    await publishModuleVersionNotice({ moduleEntry: module, user: game.user });
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to initialize module.`, error);
    ui.notifications?.error(game.i18n.localize("REBREYA_MAIN.Notifications.InitializationFailed"));
  }
});
