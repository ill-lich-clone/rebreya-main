import { DATA_SOURCE_MODES, DEFAULT_DISPLAY_PRECISION, DEFAULT_SITE_BASE_URL, MODULE_ID, SETTINGS_KEYS, SITE_CATALOG_MODES, SITE_CHARACTER_SYNC_MODES } from "./constants.js?v=1.5.90";
import { getSiteCatalogSyncAppClass } from "./ui/site-catalog-sync-app.js";
import { refreshEconomyLauncher } from "./hooks.js?v=1.5.71";
export {
  SOCKET_EVENT_SET_SETTING,
  SOCKET_EVENT_SET_SETTING_RESULT,
  handleSettingsUpdateSocketResponse,
  requestSettingsUpdate
} from "./legacy/settings-socket-relay.js";

function refreshControls() {
  if (ui?.controls?.render) {
    try {
      ui.controls.render({ reset: true });
    }
    catch (_error) {
      ui.controls.render(true);
    }
  }

  refreshEconomyLauncher();
}

function requestDataReload() {
  game.rebreyaMain?.reloadData({ notify: true, rerender: true }).catch((error) => {
    console.error(`${MODULE_ID} | Failed to reload economy data after settings change.`, error);
  });
}

function requestGlobalEventsRebuild() {
  game.rebreyaMain?.handleGlobalEventsConfigChange?.().catch((error) => {
    console.error(`${MODULE_ID} | Failed to rebuild economy after global events settings change.`, error);
  });
}

function refreshCanvasTokenEffects() {
  const tokens = Array.from(globalThis.canvas?.tokens?.placeables ?? []);
  for (const token of tokens) {
    try {
      token.renderFlags?.set?.({ refreshEffects: true, refreshState: true });
      token._refreshState?.();
      token._refreshEffects?.();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to refresh token effects after settings change.`, error);
    }
  }
}

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS_KEYS.COMBAT_AUTO_PAN, {
    name: "REBREYA_MAIN.Settings.CombatAutoPan.Name", hint: "REBREYA_MAIN.Settings.CombatAutoPan.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID,SETTINGS_KEYS.SCENE_ACTIVITY_STATE,{
    scope:"world",config:false,type:Object,
    default:{version:1,activeByGroup:{},groupRevisions:{},history:[],recentOperations:[]},
    onChange:()=>game.rebreyaMain?.refreshSceneActivityApps?.()
  });
  game.settings.register(MODULE_ID, SETTINGS_KEYS.SHOW_BUTTON, {
    name: "REBREYA_MAIN.Settings.ShowButton.Name",
    hint: "REBREYA_MAIN.Settings.ShowButton.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: refreshControls
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.DEBUG_MODE, {
    name: "REBREYA_MAIN.Settings.DebugMode.Name",
    hint: "REBREYA_MAIN.Settings.DebugMode.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => game.rebreyaMain?.refreshOpenApps?.()
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.DATA_SOURCE_MODE, {
    name: "REBREYA_MAIN.Settings.DataSourceMode.Name",
    hint: "REBREYA_MAIN.Settings.DataSourceMode.Hint",
    scope: "world",
    config: true,
    type: String,
    default: DATA_SOURCE_MODES.BUILTIN,
    choices: {
      [DATA_SOURCE_MODES.BUILTIN]: "Встроенные JSON модуля",
      [DATA_SOURCE_MODES.CUSTOM]: "Пользовательская папка JSON"
    },
    onChange: requestDataReload
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.CUSTOM_DATA_PATH, {
    name: "REBREYA_MAIN.Settings.CustomDataPath.Name",
    hint: "REBREYA_MAIN.Settings.CustomDataPath.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: requestDataReload
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.DISPLAY_PRECISION, {
    name: "REBREYA_MAIN.Settings.DisplayPrecision.Name",
    hint: "REBREYA_MAIN.Settings.DisplayPrecision.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_DISPLAY_PRECISION,
    range: {
      min: 0,
      max: 4,
      step: 1
    },
    onChange: () => game.rebreyaMain?.refreshOpenApps?.()
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.RADIAL_STATUS_EFFECTS, {
    name: "REBREYA_MAIN.Settings.RadialStatusEffects.Name",
    hint: "REBREYA_MAIN.Settings.RadialStatusEffects.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: refreshCanvasTokenEffects
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_ENABLED, {
    name: "REBREYA_MAIN.Settings.GlobalEventsEnabled.Name",
    hint: "REBREYA_MAIN.Settings.GlobalEventsEnabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: requestGlobalEventsRebuild
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_NOTIFICATIONS, {
    name: "REBREYA_MAIN.Settings.GlobalEventsNotifications.Name",
    hint: "REBREYA_MAIN.Settings.GlobalEventsNotifications.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => game.rebreyaMain?.refreshOpenApps?.()
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_AUTO_RECALC, {
    name: "REBREYA_MAIN.Settings.GlobalEventsAutoRecalc.Name",
    hint: "REBREYA_MAIN.Settings.GlobalEventsAutoRecalc.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_SHOW_PUBLIC, {
    name: "REBREYA_MAIN.Settings.GlobalEventsShowPublic.Name",
    hint: "REBREYA_MAIN.Settings.GlobalEventsShowPublic.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => game.rebreyaMain?.refreshOpenApps?.()
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_DEBUG, {
    name: "REBREYA_MAIN.Settings.GlobalEventsDebug.Name",
    hint: "REBREYA_MAIN.Settings.GlobalEventsDebug.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => game.rebreyaMain?.refreshOpenApps?.()
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.TRADER_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.PARTY_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.GROUP_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.GROUP_CLOCK_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.CRAFT_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.CRAFT_MUTATION_JOURNAL, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.PURCHASE_BASKET_JOURNAL, {
    scope: "world",
    config: false,
    type: Object,
    default: { version: 1, records: [] }
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.CALENDAR_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.CONNECTION_STATES, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.CITY_PRESENTATION_OVERRIDES, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.REFERENCE_NOTES, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.TRADE_ROUTE_OVERRIDES, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.STATE_POLICIES, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.COSMOLOGY_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: {
      version: 1,
      mechanusEnabled: false
    },
    onChange: () => game.rebreyaMain?.refreshCosmologyViews?.()
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: {
      version: 1,
      updatedAt: 0,
      events: []
    }
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_DRAFT, {
    scope: "world",
    config: false,
    type: Object,
    default: {
      updatedAt: 0,
      draft: null
    }
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.LOOTGEN_TEMPLATES, {
    scope: "world",
    config: false,
    type: Object,
    default: {
      version: 2,
      templates: []
    },
    onChange: () => game.rebreyaMain?.refreshOpenApps?.()
  });

  // --- rebreya.com site integration -------------------------------------------
  game.settings.register(MODULE_ID, SETTINGS_KEYS.SITE_INTEGRATION_ENABLED, {
    name: "REBREYA_MAIN.Settings.SiteIntegrationEnabled.Name",
    hint: "REBREYA_MAIN.Settings.SiteIntegrationEnabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => globalThis.game?.rebreyaMain?.siteAutoSync?.syncLoop?.()
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.SITE_BASE_URL, {
    name: "REBREYA_MAIN.Settings.SiteBaseUrl.Name",
    hint: "REBREYA_MAIN.Settings.SiteBaseUrl.Hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_SITE_BASE_URL
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.SITE_CATALOG_MODE, {
    name: "REBREYA_MAIN.Settings.SiteCatalogMode.Name",
    hint: "REBREYA_MAIN.Settings.SiteCatalogMode.Hint",
    scope: "world",
    config: true,
    type: String,
    default: SITE_CATALOG_MODES.HYBRID,
    choices: {
      [SITE_CATALOG_MODES.LOCAL]: "Только локальные данные модуля",
      [SITE_CATALOG_MODES.SITE_API]: "Только данные сайта",
      [SITE_CATALOG_MODES.HYBRID]: "Гибрид: локальные + обновления с сайта"
    }
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.SITE_CHARACTER_SYNC_MODE, {
    name: "REBREYA_MAIN.Settings.SiteCharacterSyncMode.Name",
    hint: "REBREYA_MAIN.Settings.SiteCharacterSyncMode.Hint",
    scope: "client",
    config: true,
    type: String,
    default: SITE_CHARACTER_SYNC_MODES.MANUAL_STATE_PUSH,
    choices: {
      [SITE_CHARACTER_SYNC_MODES.OFF]: "Выключено",
      [SITE_CHARACTER_SYNC_MODES.IMPORT_ONCE]: "Импорт с сайта один раз",
      [SITE_CHARACTER_SYNC_MODES.SITE_TO_FOUNDRY]: "Сайт → Foundry",
      [SITE_CHARACTER_SYNC_MODES.MANUAL_STATE_PUSH]: "Сайт → Foundry, состояние вручную обратно"
    }
  });

  // Client-scoped secrets: a player's site token is stored only in their own
  // client settings, never in world settings or the socket.
  game.settings.register(MODULE_ID, SETTINGS_KEYS.SITE_ACCESS_TOKEN, {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.SITE_REFRESH_TOKEN, {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });

  // Link tokens (share-code import) are per-character credentials for the
  // site. They live ONLY in this browser's client settings (localStorage):
  // Foundry sends every world- and user-scoped Setting document to every
  // connected client, and Actor flags reach everyone who can see the Actor, so
  // neither is private. Cost: a token is per device — on another browser the
  // player links again with a fresh code. Never sent over the socket.
  game.settings.register(MODULE_ID, SETTINGS_KEYS.SITE_LINK_TOKENS, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.SITE_AUTO_SYNC, {
    name: "REBREYA_MAIN.Settings.SiteAutoSync.Name",
    hint: "REBREYA_MAIN.Settings.SiteAutoSync.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
    onChange: () => globalThis.game?.rebreyaMain?.siteAutoSync?.syncLoop?.()
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.SITE_ALLOW_LOCALHOST, {
    name: "REBREYA_MAIN.Settings.SiteAllowLocalhost.Name",
    hint: "REBREYA_MAIN.Settings.SiteAllowLocalhost.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS_KEYS.SITE_LAST_CATALOG_SYNC, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // GM control to import site catalogues (spells, articles) into compendia.
  // Guarded on the ApplicationV2 API being present so registerSettings stays
  // callable outside Foundry (unit tests mock game.settings, not foundry).
  if (globalThis.foundry?.applications?.api && typeof game.settings.registerMenu === "function") {
    game.settings.registerMenu(MODULE_ID, "siteCatalogSyncMenu", {
      name: "REBREYA_MAIN.Settings.SiteCatalogSync.Name",
      label: "REBREYA_MAIN.Settings.SiteCatalogSync.Label",
      hint: "REBREYA_MAIN.Settings.SiteCatalogSync.Hint",
      icon: "fa-solid fa-cloud-arrow-down",
      type: getSiteCatalogSyncAppClass(),
      restricted: true
    });
  }
}
