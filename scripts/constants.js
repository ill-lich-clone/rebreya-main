export const MODULE_ID = "rebreya-main";
export const MODULE_TITLE = "Rebreya Main";
export const HELD_ITEM_UPDATED_HOOK = `${MODULE_ID}.heldItemUpdated`;
export const DURABILITY_UPDATED_HOOK = `${MODULE_ID}.durabilityUpdated`;

export const MATERIALS_COMPENDIUM_NAME = "rebreya-materials";
export const MATERIALS_COMPENDIUM_LABEL = "Материалы Rebreya";
export const GEAR_COMPENDIUM_NAME = "rebreya-gear";
export const GEAR_COMPENDIUM_LABEL = "Немагическое снаряжение Rebreya";
export const MAGIC_ITEMS_COMPENDIUM_NAME = "rebreya-magic-items";
export const MAGIC_ITEMS_COMPENDIUM_LABEL = "Магические предметы Rebreya";
export const FEATS_COMPENDIUM_NAME = "rebreya-feats";
export const FEATS_COMPENDIUM_LABEL = "Черты Rebreya (D&D 5e 2014)";
export const BACKGROUNDS_COMPENDIUM_NAME = "rebreya-backgrounds";
export const BACKGROUNDS_COMPENDIUM_LABEL = "Предыстории Rebreya (D&D 5e 2014)";
export const STATES_COMPENDIUM_NAME = "rebreya-states";
export const STATES_COMPENDIUM_LABEL = "Государства Тейванкаля Rebreya";
export const STATE_ITEM_TYPE = `${MODULE_ID}.state`;
export const DOWNTIME_ITEM_TYPE = `${MODULE_ID}.downtime`;
export const RESEARCH_ITEM_TYPE = `${MODULE_ID}.research`;
export const SPECIALTY_ITEM_TYPE = `${MODULE_ID}.specialty`;
export const CRAFTSMAN_CLASS_IDENTIFIER = "craftsman-v01";
export const CRAFTSMAN_TRACK_FLAG = "craftsmanTrack";
export const CRAFTSMAN_ARCHETYPE_ID_FLAG = "archetypeId";
export const CRAFTSMAN_TRACKS = Object.freeze({
  RESEARCH: "research",
  SPECIALTY: "specialty"
});
export const DOWNTIME_COMPENDIUM_NAME = "rebreya-downtime";
export const DOWNTIME_COMPENDIUM_LABEL = "Простой Rebreya";
export const LEGACY_CRAFTSMAN_ARCHETYPES_COMPENDIUM_NAME = "rebreya-craftsman-archetypes";
export const LEGACY_CRAFTSMAN_ARCHETYPES_COMPENDIUM_LABEL = "Ремесленник: архетипы";
export const TEYVANKAL_STATE_LANGUAGE_GROUP_ID = "teyvankal";
export const TEYVANKAL_STATE_LANGUAGES = Object.freeze([
  { id: "umeliluan", label: "Умелилуанский" },
  { id: "zomar", label: "Зомарский" },
  { id: "azadran", label: "Азадранский" },
  { id: "nirian", label: "Нирианский" },
  { id: "ilduin", label: "Илдуинский" },
  { id: "khurat", label: "Хуратский" },
  { id: "tsefarian", label: "Цефарийский" },
  { id: "eshar", label: "Эшарский" },
  { id: "krangar", label: "Крангарский" },
  { id: "kurovian", label: "Куровийский" },
  { id: "shnadar", label: "Шнадарский" },
  { id: "azelian", label: "Азелийский" }
]);
export const RACE_FEATURES_COMPENDIUM_NAME = "rebreya-race-features";
export const RACE_FEATURES_COMPENDIUM_LABEL = "Расовые умения Тейванкаля Rebreya";
export const RACES_COMPENDIUM_NAME = "rebreya-races";
export const RACES_COMPENDIUM_LABEL = "Расы Тейванкаля Rebreya (D&D 5e 2014)";
export const CLASS_FEATURES_COMPENDIUM_NAME = "rebreya-class-features";
export const CLASS_FEATURES_COMPENDIUM_LABEL = "Умения классов Rebreya";
export const SUBCLASSES_COMPENDIUM_NAME = "rebreya-subclasses";
export const SUBCLASSES_COMPENDIUM_LABEL = "Архетипы Rebreya (D&D 5e 2014)";
export const CRAFTSMAN_SUBCLASS_COMPENDIUM_ID = `world.${SUBCLASSES_COMPENDIUM_NAME}`;
export const CRAFTSMAN_ARCHETYPE_REGISTRY = Object.freeze({
  "craftsman-research-weaponsmith": Object.freeze({
    track: CRAFTSMAN_TRACKS.RESEARCH,
    documentId: "fjf9y91usmmvo000",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.fjf9y91usmmvo000`
  }),
  "craftsman-research-armorer": Object.freeze({
    track: CRAFTSMAN_TRACKS.RESEARCH,
    documentId: "18cjg6m14nk7hb00",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.18cjg6m14nk7hb00`
  }),
  "craftsman-research-alchemist": Object.freeze({
    track: CRAFTSMAN_TRACKS.RESEARCH,
    documentId: "9vn2lec3950y0000",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.9vn2lec3950y0000`
  }),
  "craftsman-research-artificer": Object.freeze({
    track: CRAFTSMAN_TRACKS.RESEARCH,
    documentId: "1my4r33ufb9eb000",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.1my4r33ufb9eb000`
  }),
  "craftsman-research-occultist": Object.freeze({
    track: CRAFTSMAN_TRACKS.RESEARCH,
    documentId: "15zlg081ybp89o00",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.15zlg081ybp89o00`
  }),
  "craftsman-research-healer": Object.freeze({
    track: CRAFTSMAN_TRACKS.RESEARCH,
    documentId: "1jneoaf1wzh47000",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.1jneoaf1wzh47000`
  }),
  "craftsman-research-mechanic": Object.freeze({
    track: CRAFTSMAN_TRACKS.RESEARCH,
    documentId: "a028poqh8xfm0000",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.a028poqh8xfm0000`
  }),
  "craftsman-specialty-assault": Object.freeze({
    track: CRAFTSMAN_TRACKS.SPECIALTY,
    documentId: "1xaf4xz14cr1zo00",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.1xaf4xz14cr1zo00`
  }),
  "craftsman-specialty-defender": Object.freeze({
    track: CRAFTSMAN_TRACKS.SPECIALTY,
    documentId: "jej063u8aytv0000",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.jej063u8aytv0000`
  }),
  "craftsman-specialty-constructor": Object.freeze({
    track: CRAFTSMAN_TRACKS.SPECIALTY,
    documentId: "1xoogq41lnvp5q00",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.1xoogq41lnvp5q00`
  }),
  "craftsman-specialty-artillerist": Object.freeze({
    track: CRAFTSMAN_TRACKS.SPECIALTY,
    documentId: "1dct6o91ps9ye900",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.1dct6o91ps9ye900`
  }),
  "craftsman-specialty-tactician": Object.freeze({
    track: CRAFTSMAN_TRACKS.SPECIALTY,
    documentId: "4488d4505bp50000",
    uuid: `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.4488d4505bp50000`
  })
});
export const CLASSES_COMPENDIUM_NAME = "rebreya-classes";
export const CLASSES_COMPENDIUM_LABEL = "Классы Rebreya (D&D 5e 2014)";
export const SPELLS_COMPENDIUM_NAME = "rebreya-spells";
export const SPELLS_COMPENDIUM_LABEL = "Заклинания Rebreya (D&D 5e 2014)";
export const ACTIONS_COMPENDIUM_NAME = "rebreya-actions";
export const ACTIONS_COMPENDIUM_LABEL = "Действия";
export const ITEM_PILES_MODULE_ID = "item-piles";
export const TRADERS_FOLDER_NAME = "Торговцы Rebreya";
export const MAX_VISIBLE_CITIES = 70;
export const ENERGY_BASE_DAYS = 3;
export const ENERGY_MIN_DAYS = 1;

export const REBREYA_GROUP_FLAGS = {
  MANAGED: "managedPartyGroup",
  LEGACY_INVENTORY_MERGED_AT: "legacyInventoryMergedAt",
  LEGACY_INVENTORY_ACTOR_ID: "legacyInventoryActorId"
};

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
  RADIAL_STATUS_EFFECTS: "radialStatusEffects",
  GLOBAL_EVENTS_ENABLED: "globalEventsEnabled",
  GLOBAL_EVENTS_NOTIFICATIONS: "globalEventsNotifications",
  GLOBAL_EVENTS_AUTO_RECALC: "globalEventsAutoRecalc",
  GLOBAL_EVENTS_SHOW_PUBLIC: "globalEventsShowPublic",
  GLOBAL_EVENTS_DEBUG: "globalEventsDebug",
  GLOBAL_EVENTS_DRAFT: "globalEventsDraft",
  TRADER_STATE: "traderState",
  PARTY_STATE: "partyState",
  GROUP_STATE: "groupState",
  CRAFT_STATE: "craftState",
  CRAFT_MUTATION_JOURNAL: "craftMutationJournal",
  INVENTORY_MUTATION_JOURNAL: "inventoryMutationJournal",
  DURABILITY_MUTATION_JOURNAL: "durabilityMutationJournal",
  CALENDAR_STATE: "calendarState",
  CONNECTION_STATES: "connectionStates",
  REFERENCE_NOTES: "referenceNotes",
  TRADE_ROUTE_OVERRIDES: "tradeRouteOverrides",
  STATE_POLICIES: "statePolicies",
  COSMOLOGY_STATE: "cosmologyState",
  GLOBAL_EVENTS_STATE: "globalEventsState",
  CRAFTSMAN_SUBCLASS_MIGRATION_VERSION: "craftsmanSubclassMigrationVersion"
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

