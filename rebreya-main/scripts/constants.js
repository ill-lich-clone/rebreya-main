export const MODULE_ID = "rebreya-main";
export const MODULE_TITLE = "Rebreya Main";

export const MATERIALS_COMPENDIUM_NAME = "rebreya-materials";
export const MATERIALS_COMPENDIUM_LABEL = "Материалы Rebreya";
export const GEAR_COMPENDIUM_NAME = "rebreya-gear";
export const GEAR_COMPENDIUM_LABEL = "Немагическое снаряжение Rebreya";
export const MAGIC_ITEMS_COMPENDIUM_NAME = "rebreya-magic-items";
export const MAGIC_ITEMS_COMPENDIUM_LABEL = "Магические предметы Rebreya";
export const ITEM_PILES_MODULE_ID = "item-piles";
export const TRADERS_FOLDER_NAME = "Торговцы Rebreya";
export const MAX_VISIBLE_CITIES = 70;
export const ENERGY_BASE_DAYS = 3;
export const ENERGY_MIN_DAYS = 1;

export const REBREYA_TOOLS = [
  { id: "thieves", label: "Воровские" },
  { id: "alchemy", label: "Алхимические" },
  { id: "smith", label: "Кузнеца" },
  { id: "calligrapher", label: "Каллиграфа" },
  { id: "forgery", label: "Поддельщика" },
  { id: "disguise", label: "Гримёра" },
  { id: "artisan", label: "Художественные" },
  { id: "investigator", label: "Исследователя" },
  { id: "tinker", label: "Жестянщика" },
  { id: "mason", label: "Камнелома" },
  { id: "leatherworker", label: "Кожедела" },
  { id: "brewer", label: "Пивовара" },
  { id: "woodcarver", label: "Деревянщика" },
  { id: "cook", label: "Повара" },
  { id: "jeweler", label: "Ювелира" }
];

export const SETTINGS_KEYS = {
  SHOW_BUTTON: "showEconomyButton",
  DEBUG_MODE: "debugMode",
  DATA_SOURCE_MODE: "dataSourceMode",
  CUSTOM_DATA_PATH: "customDataPath",
  DISPLAY_PRECISION: "displayPrecision",
  GLOBAL_EVENTS_ENABLED: "globalEventsEnabled",
  GLOBAL_EVENTS_NOTIFICATIONS: "globalEventsNotifications",
  GLOBAL_EVENTS_AUTO_RECALC: "globalEventsAutoRecalc",
  GLOBAL_EVENTS_SHOW_PUBLIC: "globalEventsShowPublic",
  GLOBAL_EVENTS_DEBUG: "globalEventsDebug",
  GLOBAL_EVENTS_DRAFT: "globalEventsDraft",
  TRADER_STATE: "traderState",
  PARTY_STATE: "partyState",
  CRAFT_STATE: "craftState",
  CALENDAR_STATE: "calendarState",
  CONNECTION_STATES: "connectionStates",
  REFERENCE_NOTES: "referenceNotes",
  TRADE_ROUTE_OVERRIDES: "tradeRouteOverrides",
  STATE_POLICIES: "statePolicies",
  GLOBAL_EVENTS_STATE: "globalEventsState"
};

export const DATA_SOURCE_MODES = {
  BUILTIN: "builtin",
  CUSTOM: "custom"
};

export const BUILTIN_DATA_PATH = `modules/${MODULE_ID}/data`;
export const DEFAULT_DISPLAY_PRECISION = 2;
export const DEFAULT_CITY_SORT = "population";
export const DEFAULT_ROUTE_SORT = "usageDesc";
export const DEFAULT_STATE_SORT = "population";

export const CITY_SORT_OPTIONS = [
  { value: "population", label: "По населению" },
  { value: "deficit", label: "По общему дефициту" },
  { value: "surplus", label: "По общему профициту" },
  { value: "selfSufficiency", label: "По самообеспечению" },
  { value: "name", label: "По названию" }
];

export const ROUTE_SORT_OPTIONS = [
  { value: "usageDesc", label: "Самые полезные" },
  { value: "usageAsc", label: "Самые бесполезные" },
  { value: "additionalPriceDesc", label: "По доп. цене: выше" },
  { value: "additionalPriceAsc", label: "По доп. цене: ниже" },
  { value: "name", label: "По названию" }
];

export const STATE_SORT_OPTIONS = [
  { value: "population", label: "По населению" },
  { value: "deficit", label: "По дефициту" },
  { value: "production", label: "По производству" },
  { value: "name", label: "По названию" }
];

export const CITY_TABS = {
  OVERVIEW: "overview",
  GOODS: "goods",
  TRADE: "trade",
  TRADERS: "traders",
  DEBUG: "debug"
};

