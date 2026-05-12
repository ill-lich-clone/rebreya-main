import { DATA_SOURCE_MODES, DEFAULT_DISPLAY_PRECISION, MODULE_ID, SETTINGS_KEYS } from "./constants.js";
import { refreshEconomyLauncher } from "./hooks.js";

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

export function registerSettings() {
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

  game.settings.register(MODULE_ID, SETTINGS_KEYS.CRAFT_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
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
}
