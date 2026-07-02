import { MODULE_ID, SETTINGS_KEYS } from "./constants.js";
import { MaterialsCompendiumService } from "./data/materials-compendium.js";
import { GearCompendiumService } from "./data/gear-compendium.js";
import { MagicItemsCompendiumService } from "./data/magic-items-compendium.js";
import { FeatsCompendiumService } from "./data/feats-compendium.js";
import { BackgroundsCompendiumService } from "./data/backgrounds-compendium.js";
import { StatesCompendiumService } from "./data/states-compendium.js";
import { RacesCompendiumService } from "./data/races-compendium.js";
import { ClassesCompendiumService } from "./data/classes-compendium.js";
import { ActionsCompendiumService } from "./data/actions-compendium.js";
import { DowntimeCompendiumService } from "./data/downtime-compendium.js";
import { FeatChoiceAutomationService, registerFeatChoiceAutomationHooks } from "./automation/feat-choice-service.js";
import { EconomyRepository } from "./data/repository.js";
import { TraderService } from "./data/trader-service.js";
import { GroupContextService } from "./data/group-context-service.js";
import { DowntimeService } from "./data/downtime-service.js";
import { CharacterDowntimeService } from "./data/character-downtime-service.js";
import { TravelService } from "./data/travel-service.js";
import { TravelMapService } from "./data/travel-map-service.js";
import {
  InventoryService,
  SOCKET_EVENT_INVENTORY_IMPORT_REQUEST,
  SOCKET_EVENT_INVENTORY_IMPORT_RESULT,
  SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_REQUEST,
  SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
  SOCKET_EVENT_INVENTORY_ITEM_ACTION_REQUEST,
  SOCKET_EVENT_INVENTORY_ITEM_ACTION_RESULT
} from "./data/inventory-service.js";
import { HeroDollService } from "./data/hero-doll-service.js";
import { CraftingService } from "./data/crafting-service.js";
import { CalendarService } from "./data/calendar-service.js";
import { GlobalEventsService } from "./data/global-events-service.js";
import { registerCombatHooks } from "./combat/hooks.js?v=1.4.81";
import { CombatAttackService } from "./combat/attack-service.js";
import { registerRadialStatusEffects } from "./combat/radial-status-effects.js";
import { CombatStatusService, registerCombatStatusConfig } from "./combat/status-service.js";
import { AttackRollBoostService } from "./combat/attack-roll-boost-service.js?v=1.4.81";
import { FighterAutomationService } from "./combat/fighter-automation-service.js?v=1.4.81";
import {
  PaladinAutomationService,
  SOCKET_EVENT_CHARACTER_CLASS_AUTOMATION
} from "./combat/paladin-automation-service.js?v=1.4.81";
import { RogueAutomationService } from "./combat/rogue-automation-service.js?v=1.4.81";
import { PerformerAutomationService } from "./combat/performer-automation-service.js?v=1.4.81";
import { RaceAutomationService, SOCKET_EVENT_RACE_AUTOMATION } from "./combat/race-automation-service.js";
import { registerSceneControlsHook } from "./hooks.js?v=1.4.81";
import {
  extendDnd5eItemTypes,
  registerDnd5eSheetExtensions,
  registerRebreyaWeaponBaseItemsFromGearPack
} from "./integrations/dnd5e-sheet-extensions.js?v=1.4.81";
import { patchEffectMacroCombatHooks } from "./integrations/effectmacro-compat.js";
import { patchSmAirshipRenderSettingsHook } from "./integrations/sm-airship-compat.js";
import { registerInventorySyncHooks } from "./integrations/inventory-sync.js";
import { refreshSmallTimeDateDisplay, registerSmallTimeIntegration, syncSmallTimeToCalendarTime } from "./integrations/smalltime-compat.js";
import { registerRationFoodConversionHook } from "./integrations/ration-food-conversion.js";
import { registerMagicWeaponTemplateHook } from "./integrations/magic-weapon-template.js?v=1.4.81";
import { patchTransformCleanupUpdateActorHook } from "./integrations/transform-cleanup-compat.js";
import {
  SOCKET_EVENT_SET_SETTING,
  SOCKET_EVENT_SET_SETTING_RESULT,
  handleSettingsUpdateSocketResponse,
  registerSettings
} from "./settings.js";
import { buildLootgenChatContent, buildLootgenStatusContent, registerLootgenChatHooks } from "./ui/lootgen-chat.js";
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
const MODULE_STYLE_PATH = `modules/${MODULE_ID}/styles/main.css`;
const MODULE_STYLE_VERSION = "1.4.81";
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const TRAVEL_DAY_HOURS = 8;
let socketModuleApi = null;
const queuedSocketMessages = [];

function cloneSocketPayload(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
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

function getOpenActorSheetApps() {
  const apps = [
    ...Object.values(globalThis.ui?.windows ?? {}),
    ...getApplicationInstances(globalThis.foundry?.applications?.instances)
  ];
  const seen = new Set();
  return apps.filter((app) => {
    if (!app || seen.has(app) || !app.rendered || typeof app.render !== "function") {
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

function dispatchSocketMessage(message) {
  const moduleApi = socketModuleApi ?? globalThis.game?.rebreyaMain ?? null;
  if (!moduleApi) {
    queuedSocketMessages.push(message);
    return;
  }

  moduleApi.handleSocketMessage(message).catch((error) => {
    console.error(`${MODULE_ID} | Failed to handle socket message.`, error);
  });
}

function flushQueuedSocketMessages(moduleApi) {
  if (!moduleApi) {
    return;
  }

  while (queuedSocketMessages.length) {
    const message = queuedSocketMessages.shift();
    moduleApi.handleSocketMessage(message).catch((error) => {
      console.error(`${MODULE_ID} | Failed to handle queued socket message.`, error);
    });
  }
}

function ensureModuleStylesheet() {
  if (!globalThis.document?.head) {
    return;
  }

  const module = globalThis.game?.modules?.get?.(MODULE_ID) ?? null;
  const moduleVersion = String(module?.version ?? module?.manifest?.version ?? module?.data?.version ?? MODULE_STYLE_VERSION);
  const stylesheetAttribute = `data-${MODULE_ID}-stylesheet`;
  const stylesheetHref = `${MODULE_STYLE_PATH}?v=${encodeURIComponent(moduleVersion)}`;
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

function countMonthStartBoundaries(fromIsoDate, toIsoDate) {
  const fromDate = parseCalendarIsoDate(fromIsoDate);
  const toDate = parseCalendarIsoDate(toIsoDate);
  if (!fromDate || !toDate || toDate.getTime() <= fromDate.getTime()) {
    return 0;
  }

  let count = 0;
  const cursor = new Date(fromDate.getTime());
  while (cursor.getTime() < toDate.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getUTCDate() === 1) {
      count += 1;
    }
  }

  return count;
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeTimeOfDaySeconds(seconds) {
  const safeSeconds = Math.trunc(toNumber(seconds, 0));
  return ((safeSeconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
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
    this.repository = new EconomyRepository();
    this.materialsCompendium = new MaterialsCompendiumService();
    this.gearCompendium = new GearCompendiumService();
    this.magicItemsCompendium = new MagicItemsCompendiumService();
    this.featsCompendium = new FeatsCompendiumService();
    this.backgroundsCompendium = new BackgroundsCompendiumService();
    this.statesCompendium = new StatesCompendiumService();
    this.racesCompendium = new RacesCompendiumService();
    this.classesCompendium = new ClassesCompendiumService();
    this.actionsCompendium = new ActionsCompendiumService();
    this.downtimeCompendium = new DowntimeCompendiumService();
    this.traderService = new TraderService(this);
    this.groupContextService = new GroupContextService(this);
    this.downtimeService = new DowntimeService(this);
    this.characterDowntimeService = new CharacterDowntimeService(this);
    this.travelService = new TravelService({ groupContextService: this.groupContextService });
    this.travelMapService = new TravelMapService();
    this.inventoryService = new InventoryService(this);
    this.heroDollService = new HeroDollService(this);
    this.craftingService = new CraftingService(this);
    this.calendarService = new CalendarService({ groupContextService: this.groupContextService });
    this.globalEventsService = new GlobalEventsService(this);
    this.combatStatusService = new CombatStatusService(this);
    this.combatAttackService = new CombatAttackService(this);
    this.attackRollBoostService = new AttackRollBoostService(this);
    this.fighterAutomationService = new FighterAutomationService(this);
    this.paladinAutomationService = new PaladinAutomationService(this);
    this.rogueAutomationService = new RogueAutomationService(this);
    this.performerAutomationService = new PerformerAutomationService(this);
    this.raceAutomationService = new RaceAutomationService(this);
    this.featChoiceAutomationService = new FeatChoiceAutomationService(this);
    this.repository.setGlobalEventsService(this.globalEventsService);
    this.economyApp = null;
    this.worldTradeRoutesApp = null;
    this.statesApp = null;
    this.globalEventsApp = null;
    this.inventoryApp = null;
    this.groupsApp = null;
    this.lootgenApps = new Map();
    this.lootgenCounter = 0;
    this.latestLootgenResult = null;
    this.cityApps = new Map();
    this.traderApps = new Map();
    this.traderV2Apps = new Map();
    this.tradeRouteApps = new Map();
    this.referenceApps = new Map();
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
      await this.traderService.cleanupLegacyManagedTraders();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to cleanup legacy trader actors.`, error);
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
  }

  async handleSocketMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

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
        await this.refreshOpenApps();
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
        await this.refreshOpenApps();
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
          const result = await this.inventoryService.handleImportDroppedItemSocketRequest(message.payload ?? {}, {
            senderId: forUserId
          });
          if (!result) {
            return;
          }

          await this.refreshOpenApps();
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
        try {
          const result = await this.inventoryService.handlePartyInventorySourceDepletionSocketRequest(message.payload ?? {}, {
            senderId: forUserId
          });
          if (!result) {
            return;
          }

          await this.refreshInventoryViews();
          game.socket?.emit?.(SOCKET_CHANNEL, {
            type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
            forUserId,
            senderId: game.user?.id ?? "",
            ok: true
          });
        }
        catch (error) {
          game.socket?.emit?.(SOCKET_CHANNEL, {
            type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
            forUserId,
            senderId: game.user?.id ?? "",
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
          const result = await this.inventoryService.handleInventoryItemActionSocketRequest(message.payload ?? {}, {
            senderId: forUserId
          });
          if (!result) {
            return;
          }

          await this.refreshOpenApps();
          game.socket?.emit?.(SOCKET_CHANNEL, {
            type: SOCKET_EVENT_INVENTORY_ITEM_ACTION_RESULT,
            forUserId,
            senderId: game.user?.id ?? "",
            action,
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
      if (game.user?.isGM) {
        const requestId = String(message.requestId ?? "").trim();
        const forUserId = String(message.senderId ?? "").trim();
        try {
          await game.settings.set(MODULE_ID, String(message.key ?? ""), message.data, message.options ?? {});
          await this.refreshOpenApps();
          if (requestId) {
            game.socket?.emit?.(SOCKET_CHANNEL, {
              type: SOCKET_EVENT_SET_SETTING_RESULT,
              requestId,
              forUserId,
              senderId: game.user?.id ?? "",
              ok: true,
              data: cloneSocketPayload(message.data)
            });
          }
        }
        catch (error) {
          if (requestId) {
            game.socket?.emit?.(SOCKET_CHANNEL, {
              type: SOCKET_EVENT_SET_SETTING_RESULT,
              requestId,
              forUserId,
              senderId: game.user?.id ?? "",
              ok: false,
              error: error?.message ?? String(error)
            });
          }
          else {
            throw error;
          }
        }
      }
      return;
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_SHOW) {
      const payload = foundry.utils.deepClone(message.payload ?? {});
      this.latestLootgenResult = payload;
      await this.openLootgenApp({
        newWindow: false,
        viewer: true,
        sharedResult: payload
      });
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_CLAIM_ROW && game.user?.isGM) {
      await this.claimLootgenChatRow(message.payload?.lootId, message.payload?.rowId, { quiet: true, fromSocket: true });
      return;
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_CLAIM_ROW_TO_INVENTORY && game.user?.isGM) {
      await this.claimLootgenChatRowToInventory(message.payload?.lootId, message.payload?.rowId, { quiet: true, fromSocket: true });
      return;
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_CLAIM_ALL_TO_INVENTORY && game.user?.isGM) {
      await this.claimLootgenChatAllToInventory(message.payload?.lootId, { quiet: true, fromSocket: true });
      return;
    }

    if (message.type === SOCKET_EVENT_LOOTGEN_CLAIM_COINS && game.user?.isGM) {
      await this.claimLootgenChatCoins(message.payload?.lootId, { quiet: true, fromSocket: true });
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
      return String(state?.lootId ?? "") === safeLootId;
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

  async claimLootgenChatRowToInventory(lootId, rowId, { quiet = false, fromSocket = false } = {}) {
    const safeLootId = String(lootId ?? "").trim();
    const safeRowId = String(rowId ?? "").trim();
    if (!safeLootId || !safeRowId) {
      return false;
    }

    if (!game.user?.isGM) {
      if (!fromSocket) {
        this.#emitLootgenClaimRequest(SOCKET_EVENT_LOOTGEN_CLAIM_ROW_TO_INVENTORY, { lootId: safeLootId, rowId: safeRowId });
      }
      ui.notifications?.info("Запрос на добавление добычи в склад отправлен мастеру.");
      return true;
    }

    const message = this.#findLootgenChatMessage(safeLootId);
    const state = foundry.utils.deepClone(message?.getFlag(MODULE_ID, "lootgenChat") ?? {});
    const rows = Array.isArray(state.rows) ? state.rows : [];
    const row = rows.find((entry) => String(entry.rowId ?? "") === safeRowId) ?? null;
    if (!message || !row || row.claimed) {
      return false;
    }

    await this.addModelItemToInventory(row.sourceType, row.sourceId, row.quantity);
    const claimed = await this.claimLootgenChatRow(safeLootId, safeRowId, { quiet: true });
    if (claimed && !quiet) {
      ui.notifications?.info(`Лут "${row.name ?? "предмет"}" добавлен в партийный склад.`);
    }
    return claimed;
  }

  async claimLootgenChatAllToInventory(lootId, { quiet = false, fromSocket = false } = {}) {
    const safeLootId = String(lootId ?? "").trim();
    if (!safeLootId) {
      return false;
    }

    if (!game.user?.isGM) {
      if (!fromSocket) {
        this.#emitLootgenClaimRequest(SOCKET_EVENT_LOOTGEN_CLAIM_ALL_TO_INVENTORY, { lootId: safeLootId });
      }
      ui.notifications?.info("Запрос на добавление всей добычи в склад отправлен мастеру.");
      return true;
    }

    const message = this.#findLootgenChatMessage(safeLootId);
    const state = foundry.utils.deepClone(message?.getFlag(MODULE_ID, "lootgenChat") ?? {});
    const rows = Array.isArray(state.rows) ? state.rows : [];
    let claimedRows = 0;
    for (const row of rows) {
      if (row?.claimed) {
        continue;
      }

      const claimed = await this.claimLootgenChatRowToInventory(safeLootId, row.rowId, { quiet: true, fromSocket: true });
      if (claimed) {
        claimedRows += 1;
      }
    }

    const claimedCoins = await this.claimLootgenChatCoins(safeLootId, { quiet: true, fromSocket: true });
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

  async #addLootgenCoinsToInventory(coins = {}) {
    const inventory = await this.getInventorySnapshot({ createActor: true });
    const current = inventory?.summary?.currency ?? {
      pp: 0,
      gp: 0,
      sp: 0,
      cp: 0
    };

    await this.updatePartyCurrency({
      pp: toNumber(current.pp, 0) + toNumber(coins.pp, 0),
      gp: toNumber(current.gp, 0) + toNumber(coins.gp, 0),
      sp: toNumber(current.sp, 0) + toNumber(coins.sp, 0),
      cp: toNumber(current.cp, 0) + toNumber(coins.cp, 0)
    });
  }

  async claimLootgenChatCoins(lootId, { quiet = false, fromSocket = false } = {}) {
    const safeLootId = String(lootId ?? "").trim();
    if (!safeLootId) {
      return false;
    }

    if (!game.user?.isGM) {
      if (!fromSocket) {
        this.#emitLootgenClaimRequest(SOCKET_EVENT_LOOTGEN_CLAIM_COINS, { lootId: safeLootId });
      }
      ui.notifications?.info("Запрос на добавление монет отправлен мастеру.");
      return true;
    }

    const message = this.#findLootgenChatMessage(safeLootId);
    const state = foundry.utils.deepClone(message?.getFlag(MODULE_ID, "lootgenChat") ?? {});
    if (!message || state.coinsClaimed) {
      return false;
    }

    const claimedCoins = foundry.utils.deepClone(state.coins ?? {});
    await this.#addLootgenCoinsToInventory(claimedCoins);
    state.coinsClaimed = true;
    await message.update({
      content: buildLootgenChatContent(state),
      [`flags.${MODULE_ID}.lootgenChat`]: state
    });

    this.#notifyLootgenChatClaim(safeLootId, "", "coins");
    if (!quiet) {
      ui.notifications?.info("Монеты из чат-лута добавлены в партийный склад.");
    }
    return true;
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
      await this.classesCompendium.sync();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to sync classes compendium.`, error);
      ui.notifications?.warn("Не удалось синхронизировать компендиумы классов и архетипов.");
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
    const result = await this.combatStatusService.setStatus(actorOrId, statusInput, options);
    await this.refreshOpenApps();
    return result;
  }

  async clearCombatStatus(actorOrId, statusInput, options = {}) {
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
    return this.traderService.purchaseItem(cityId, traderKey, itemKey, quantity, options);
  }

  async createTraderSalePreview(cityId, traderKey, dropData) {
    return this.traderService.createSalePreview(cityId, traderKey, dropData);
  }

  async sellTraderItem(cityId, traderKey, preview, quantity) {
    return this.traderService.sellItem(cityId, traderKey, preview, quantity);
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

  async rollbackTraderAuditEntry(entryId) {
    const result = await this.traderService.rollbackTradeAuditEntry(entryId);
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
    await this.refreshOpenApps();
    this.#emitDowntimeUpdated({
      actorIds: result.actorIds
    });
    return result;
  }

  async revokeDowntimeWeeks(payload = {}) {
    const result = await this.downtimeService.revokeWeeks(payload);
    await this.refreshOpenApps();
    this.#emitDowntimeUpdated({
      actorIds: result.actorIds
    });
    return result;
  }

  async clearDowntimeHistory() {
    const result = await this.downtimeService.clearHistory();
    await this.refreshOpenApps();
    this.#emitDowntimeUpdated({
      actorIds: result.actorIds
    });
    return result;
  }

  async createDowntimeRequest(payload = {}) {
    if (!game.user?.isGM) {
      return this.#requestDowntimeCreateViaGm(payload);
    }

    const result = await this.downtimeService.createRequest(payload);
    await this.refreshOpenApps();
    this.#emitDowntimeUpdated({
      actorIds: [result.actorId],
      requestId: result.id
    });
    return result;
  }

  async updateDowntimeRequest(payload = {}) {
    if (!game.user?.isGM) {
      return this.#requestDowntimeUpdateViaGm(payload);
    }

    const result = await this.downtimeService.updateRequest(payload);
    await this.refreshOpenApps();
    this.#emitDowntimeUpdated({
      actorIds: [result.actorId],
      requestId: result.id
    });
    return result;
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

    await this.refreshOpenApps();
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

    await this.refreshOpenApps();
  }

  async #handleDowntimeUpdatedSocketMessage(_message = {}) {
    await this.refreshOpenApps();
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

    const result = await this.downtimeService.createRequest({
      ...cloneSocketPayload(payload),
      groupId,
      actorId,
      submittedByUserId: senderUser.id
    });
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

    return this.downtimeService.updateRequest({
      ...cloneSocketPayload(payload),
      groupId,
      actorId
    });
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

    await this.refreshOpenApps();
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
    await this.refreshOpenApps();
    this.#emitDowntimeUpdated({
      actorIds: [continuedRequest.actorId],
      requestId: continuedRequest.id
    });
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

    await this.refreshOpenApps();
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
    await this.refreshOpenApps();
    this.#emitDowntimeUpdated({
      actorIds: [result.actorId],
      requestId: result.id
    });
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

    await this.refreshOpenApps();
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
    await this.refreshOpenApps();
    this.#emitDowntimeUpdated({
      actorIds: [result.actorId],
      requestId: result.id
    });
    return result;
  }

  async setDowntimeRequestChecks(requestId, checks = []) {
    const result = await this.downtimeService.setRequestChecks(requestId, checks);
    await this.refreshOpenApps();
    this.#emitDowntimeUpdated({
      actorIds: [result.actorId],
      requestId: result.id
    });
    return result;
  }

  async recordDowntimeCheckResult(requestId, checkId, result = {}, options = {}) {
    if (!game.user?.isGM) {
      return this.#requestDowntimeCheckResultViaGm(requestId, checkId, result, options);
    }

    const updatedRequest = await this.downtimeService.recordCheckResult(requestId, checkId, result, options);
    await this.refreshOpenApps();
    this.#emitDowntimeUpdated({
      actorIds: [updatedRequest.actorId],
      requestId: updatedRequest.id
    });
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
    const result = await this.inventoryService.mergeLegacyInventoryIntoGroup(groupActorId);
    await this.refreshOpenApps();
    return result;
  }

  async setActivePartyGroup(groupActorId) {
    const result = await this.groupContextService.setActiveGroup(groupActorId);
    await this.refreshOpenApps();
    await syncSmallTimeToCalendarTime(this);
    return result;
  }

  async addPartyMember(actorId) {
    const result = await this.inventoryService.addPartyMember(actorId);
    await this.refreshOpenApps();
    return result;
  }

  async removePartyMember(actorId) {
    const result = await this.inventoryService.removePartyMember(actorId);
    await this.refreshOpenApps();
    return result;
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
    const result = await this.inventoryService.updatePartyDefaults(patch);
    await this.refreshOpenApps();
    return result;
  }

  async updatePartyMember(actorId, patch = {}) {
    const result = await this.inventoryService.updatePartyMember(actorId, patch);
    await this.refreshOpenApps();
    return result;
  }

  async updateInventoryItemQuantity(itemId, nextQuantity) {
    const result = await this.inventoryService.updateItemQuantity(itemId, nextQuantity);
    await this.refreshOpenApps();
    return result;
  }

  async deleteInventoryItem(itemId) {
    const result = await this.inventoryService.deleteItem(itemId);
    await this.refreshOpenApps();
    return result;
  }

  async takeInventoryItemToCharacter(itemId, options = {}) {
    const result = await this.inventoryService.takeInventoryItemToCharacter(itemId, options);
    await this.refreshOpenApps();
    return result;
  }

  async sellInventoryItem(itemId, quantity = 1) {
    const result = await this.inventoryService.sellInventoryItem(itemId, quantity);
    await this.refreshOpenApps();
    return result;
  }

  async addPartySupply(resourceKey, quantity) {
    const result = await this.inventoryService.addSupply(resourceKey, quantity);
    await this.refreshOpenApps();
    return result;
  }

  async consumePartySuppliesOneDay(options = {}) {
    const result = await this.inventoryService.consumeSuppliesOneDay(options);
    await this.refreshOpenApps();
    return result;
  }

  async importInventoryDrop(dropData) {
    const result = await this.inventoryService.importDroppedItem(dropData);
    await this.refreshOpenApps();
    return result;
  }

  async openPartyInventorySheet() {
    return this.inventoryService.openInventoryActorSheet();
  }

  async updatePartyCurrency(values = {}) {
    const result = await this.inventoryService.updateCurrency(values);
    await this.refreshOpenApps();
    return result;
  }

  async convertPartyCurrency(mode = "normalized") {
    const result = await this.inventoryService.convertCurrency(mode);
    await this.refreshOpenApps();
    return result;
  }

  async breakInventoryItemToMaterial(itemId, quantity = 1) {
    const result = await this.inventoryService.breakItemToMaterial(itemId, quantity);
    await this.refreshOpenApps();
    return result;
  }

  async addModelItemToInventory(sourceType, sourceId, quantity = 1) {
    const result = await this.inventoryService.addModelItemToInventory(sourceType, sourceId, quantity);
    await this.refreshOpenApps();
    return result;
  }

  getRebreyaToolCatalog() {
    return this.inventoryService.getRebreyaToolCatalog();
  }

  async updatePartyMemberTool(actorId, toolId, patch = {}) {
    const result = await this.inventoryService.updatePartyMemberTool(actorId, toolId, patch);
    await this.refreshOpenApps();
    return result;
  }

  async setPartyMemberEnergy(actorId, currentEnergy) {
    const result = await this.inventoryService.setMemberEnergy(actorId, currentEnergy);
    await this.refreshOpenApps();
    return result;
  }

  async restorePartyMemberEnergy(actorId, days = 1) {
    const result = await this.inventoryService.restoreMemberEnergy(actorId, days);
    await this.refreshOpenApps();
    return result;
  }

  async getCraftSnapshot(options = {}) {
    return this.craftingService.getSnapshot(options);
  }

  async queueCraftTask(payload = {}) {
    const result = await this.craftingService.queueTask(payload);
    await this.refreshOpenApps();
    return result;
  }

  async cancelCraftTask(taskId) {
    const result = await this.craftingService.cancelTask(taskId);
    await this.refreshOpenApps();
    return result;
  }

  async processCraftOneDay() {
    const result = await this.craftingService.processOneDay();
    await this.refreshOpenApps();
    return result;
  }

  getCalendarSnapshot() {
    return this.calendarService.getSnapshot();
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

  async #refreshGlobalEventsByCalendarTransition(currentIsoDate, previousIsoDate) {
    const activation = await this.globalEventsService.refreshEventActivationByDate(currentIsoDate, previousIsoDate);
    if (activation.changed && this.globalEventsService.isAutoRecalculateEnabled()) {
      await this.repository.rebuildModel();
    }

    return activation;
  }

  async #applyTraderMonthlyReset(monthResetCount, reason = "calendar") {
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

    const resetResult = await this.traderService.resetAssortments();
    return {
      triggered: true,
      reason,
      monthResetCount: safeResetCount,
      refreshedTraderCount: Math.max(0, Math.floor(Number(resetResult?.refreshedTraderCount ?? 0))),
      removedTraderCount: Math.max(0, Math.floor(Number(resetResult?.removedTraderCount ?? 0)))
    };
  }

  async setCalendarDate(year, month, day, options = {}) {
    const previousSnapshot = this.calendarService.getSnapshot();
    const result = await this.calendarService.setDate(year, month, day, options);
    const eventActivation = await this.#refreshGlobalEventsByCalendarTransition(result?.isoDate, previousSnapshot?.isoDate);
    const monthResetCount = (
      previousSnapshot?.isoDate !== result?.isoDate
      && Number(result?.day ?? 0) === 1
    ) ? 1 : 0;
    const traderReset = await this.#applyTraderMonthlyReset(monthResetCount, "set-date");
    await this.refreshOpenApps();
    await refreshSmallTimeDateDisplay();
    return {
      ...result,
      eventActivation,
      traderReset
    };
  }

  async #runDayCycles(days, { consumeSupplies = true, applyEnergy = true, processCraft = true } = {}) {
    const safeDays = Math.max(0, Math.floor(Number(days ?? 0)));
    const supplies = [];
    let craftCompleted = [];
    let craftCompletedCount = 0;

    for (let index = 0; index < safeDays; index += 1) {
      if (consumeSupplies) {
        const supplyResult = await this.inventoryService.consumeSuppliesOneDay({ applyEnergy });
        supplies.push(supplyResult);
      }

      if (processCraft) {
        const craftResult = await this.craftingService.processOneDay();
        craftCompleted = craftCompleted.concat(craftResult.completed ?? []);
        craftCompletedCount += Number(craftResult.completedCount ?? 0);
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
        completed: craftCompleted,
        completedCount: craftCompletedCount
      }
    };
  }

  async shiftCalendarDays(days = 0, options = {}) {
    const safeDays = Math.trunc(Number(days ?? 0));
    const advance = await this.calendarService.shiftDays(safeDays);
    const eventActivation = await this.#refreshGlobalEventsByCalendarTransition(advance?.to?.isoDate, advance?.from?.isoDate);
    const monthResetCount = safeDays > 0
      ? countMonthStartBoundaries(advance?.from?.isoDate, advance?.to?.isoDate)
      : 0;
    const traderReset = await this.#applyTraderMonthlyReset(monthResetCount, options.reason ?? "shift-days");
    const cycles = options.processDailyCycles === true && safeDays > 0
      ? await this.#runDayCycles(safeDays, options)
      : {
        days: 0,
        supplies: [],
        supplyTotals: {
          foodSpent: 0,
          waterSpent: 0,
          foodShortage: 0,
          waterShortage: 0
        },
        craft: {
          completed: [],
          completedCount: 0
        }
      };

    if (options.refreshApps !== false) {
      await this.refreshOpenApps();
    }
    if (options.refreshSmallTime !== false) {
      await refreshSmallTimeDateDisplay();
    }
    return {
      ...advance,
      eventActivation,
      cycles,
      traderReset
    };
  }

  async advanceCalendarDays(days = 1, options = {}) {
    const safeDays = Math.max(0, Math.floor(Number(days ?? 0)));
    const advance = await this.calendarService.advanceDays(safeDays);
    const eventActivation = await this.#refreshGlobalEventsByCalendarTransition(advance?.to?.isoDate, advance?.from?.isoDate);
    const monthResetCount = countMonthStartBoundaries(advance?.from?.isoDate, advance?.to?.isoDate);
    const traderReset = await this.#applyTraderMonthlyReset(monthResetCount, "advance-days");
    const cycles = await this.#runDayCycles(safeDays, options);
    await this.refreshOpenApps();
    await refreshSmallTimeDateDisplay();
    return {
      ...advance,
      eventActivation,
      cycles,
      traderReset
    };
  }

  async advanceCalendarWeeks(weeks = 1, options = {}) {
    const safeWeeks = Math.max(0, Math.floor(Number(weeks ?? 0)));
    return this.advanceCalendarDays(safeWeeks * 7, options);
  }

  async advanceCalendarMonths(months = 1, options = {}) {
    const advance = await this.calendarService.advanceMonths(months);
    const eventActivation = await this.#refreshGlobalEventsByCalendarTransition(advance?.to?.isoDate, advance?.from?.isoDate);
    const monthResetCount = countMonthStartBoundaries(advance?.from?.isoDate, advance?.to?.isoDate);
    const traderReset = await this.#applyTraderMonthlyReset(monthResetCount, "advance-months");
    const cycles = await this.#runDayCycles(advance.daysAdvanced, options);
    await this.refreshOpenApps();
    await refreshSmallTimeDateDisplay();
    return {
      ...advance,
      eventActivation,
      cycles,
      traderReset
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

      const { LootgenApp } = await import("./ui/lootgen-app.js");
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
    try {
      const { TraderApp } = await import("./ui/trader-app.js");
      const appKey = `${cityId}::${traderKey}`;

      let app = this.traderApps.get(appKey);
      if (!app) {
        app = new TraderApp(this, cityId, traderKey, options);
        this.traderApps.set(appKey, app);
      }
      else if (options?.actorId !== undefined) {
        app.selectedActorId = options.actorId;
      }

      await app.render({ force: true });
      bringAppToFront(app);
      return app;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open trader '${cityId}:${traderKey}'.`, error);
      ui.notifications?.error("Не удалось открыть окно лавки.");
      throw error;
    }
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
    return this.openTrader(cityId, traderKey, options);
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

  async refreshInventoryViews() {
    const tasks = [];
    if (this.inventoryApp?.rendered) {
      tasks.push(rerenderApp(this.inventoryApp, { preserveScroll: true, focus: false }));
    }

    await Promise.allSettled(tasks);
  }

  async refreshOpenApps() {
    const tasks = [];

    if (this.economyApp?.rendered) {
      tasks.push(rerenderApp(this.economyApp));
    }

    if (this.worldTradeRoutesApp?.rendered) {
      tasks.push(rerenderApp(this.worldTradeRoutesApp));
    }

    if (this.statesApp?.rendered) {
      tasks.push(rerenderApp(this.statesApp));
    }

    if (this.globalEventsApp?.rendered) {
      tasks.push(rerenderApp(this.globalEventsApp));
    }

    if (this.inventoryApp?.rendered) {
      tasks.push(rerenderApp(this.inventoryApp, { preserveScroll: true }));
    }

    if (this.groupsApp?.rendered) {
      tasks.push(rerenderApp(this.groupsApp));
    }

    for (const app of this.lootgenApps.values()) {
      if (app?.rendered) {
        tasks.push(rerenderApp(app));
      }
    }

    for (const app of this.cityApps.values()) {
      if (app?.rendered) {
        tasks.push(rerenderApp(app));
      }
    }

    for (const app of this.traderApps.values()) {
      if (app?.rendered) {
        tasks.push(rerenderApp(app));
      }
    }

    for (const app of this.traderV2Apps.values()) {
      if (app?.rendered) {
        tasks.push(rerenderApp(app));
      }
    }

    for (const app of this.tradeRouteApps.values()) {
      if (app?.rendered) {
        tasks.push(rerenderApp(app));
      }
    }

    for (const app of this.referenceApps.values()) {
      if (app?.rendered) {
        tasks.push(rerenderApp(app));
      }
    }

    for (const app of getOpenActorSheetApps()) {
      tasks.push(rerenderApp(app, { focus: false }));
    }

    await Promise.allSettled(tasks);
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
  socketModuleApi = moduleApi;
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = moduleApi;
  }
  flushQueuedSocketMessages(moduleApi);

  try {
    registerCombatHooks(moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to register combat hooks.`, error);
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
