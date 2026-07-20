import {
  DOWNTIME_COMPENDIUM_NAME,
  FEATS_COMPENDIUM_NAME,
  GEAR_COMPENDIUM_NAME,
  HELD_ITEM_UPDATED_HOOK,
  DOWNTIME_ITEM_TYPE,
  MODULE_ID,
  REBREYA_TOOLS,
  STATES_COMPENDIUM_NAME,
  STATE_ITEM_TYPE,
  TEYVANKAL_STATE_LANGUAGE_GROUP_ID,
  TEYVANKAL_STATE_LANGUAGES
} from "../constants.js";
import { bringAppToFront } from "../ui.js";
import { createStableGearDocumentId } from "../data/gear-document-ids.js";
import {
  getRebreyaWeaponBaseItemDefinitions,
  getHeroDollSlotGroups,
  inferHeroDollSlotGroupFromSlots,
  mapSlotGroupToHeroDollSlots,
  normalizeHeroDollSlotGroup,
  normalizeHeroDollSlots
} from "../data/item-classification.js";
import {
  bindUniversalBeltSheet,
  registerUniversalBeltItemContextHook
} from "./universal-belt.js";
import {
  bindItemUpgradeInventoryRows,
  bindItemUpgradeSheet,
  createItemUpgradePanelHtml,
  hideInstalledUpgradeInventoryRows,
  isItemUpgradeHostItem,
  registerItemUpgradeFilterHook
} from "./item-upgrade-sheet.js?v=1.4.96-item-upgrade-row-root";
import {
  buildHeldItemEquipMenuActions,
  buildHeldItemReleaseHandUpdate,
  HELD_ITEM_PRESENTATIONS,
  getHeldItemDamageFormulaPresentation,
  getHeldItemEquipPresentation,
  isHeldItemEligible
} from "./held-items.js?v=1.4.96-npc-held-natural";
import { getDnd5eSheetStatusPresentation } from "./dnd5e-sheet-status-references.js";
import { registerCraftsmanArchetypeTypes } from "./craftsman-archetype-types.js";

const HERO_DOLL_TAB_ID = "heroDoll";
const HERO_DOLL_TAB_LABEL = "Кукла героя";
const HERO_DOLL_TAB_ICON = "fa-solid fa-person";
const HERO_DOLL_TEMPLATE = `modules/${MODULE_ID}/templates/hero-doll-tab.hbs`;
const CHARACTER_DOWNTIME_TAB_ID = "downtime";
const CHARACTER_DOWNTIME_TAB_LABEL = "Простой";
const CHARACTER_DOWNTIME_TAB_ICON = "fa-solid fa-hourglass-half";
const CHARACTER_DOWNTIME_TEMPLATE = `modules/${MODULE_ID}/templates/character-downtime-tab.hbs`;
const ITEM_MODS_TAB_ID = "mods";
const ITEM_MODS_TAB_LABEL = "Моды";
const ITEM_MODS_TEMPLATE = `modules/${MODULE_ID}/templates/item-mods-tab.hbs`;
const CHARACTER_SHEET_HEADER_IMAGE = `url("/modules/${MODULE_ID}/assets/ui/rebreya-character-header.webp")`;
const HERO_DOLL_PATCH_FLAG = "__rebreyaHeroDollPatched";
const ITEM_MODS_PATCH_FLAG = "__rebreyaItemModsPatched";
const HERO_DOLL_MOVE_DROP_PATCH_FLAG = "__rebreyaHeroDollMoveDropPatched";
const HERO_DOLL_PAYLOAD_PATCH_FLAG = "__rebreyaHeroDollPayloadPatched";
const HEROIC_D20_DIALOG_PATCH_FLAG = "__rebreyaHeroicD20DialogPatched";
const HEROIC_D20_ROLL_PATCH_FLAG = "__rebreyaHeroicD20RollPatched";
const HEROIC_D20_KEYBINDINGS_PATCH_FLAG = "__rebreyaHeroicD20KeybindingsPatched";
const ITEM_CHOICE_SPELL_FILTER_PATCH_FLAG = "__rebreyaItemChoiceSpellFilterPatched";
const HEROIC_ADVANTAGE_ACTION = "heroic-advantage";
const HEROIC_DISADVANTAGE_ACTION = "heroic-disadvantage";
const NATIVE_STATE_ITEM_TYPE = STATE_ITEM_TYPE;
const NATIVE_STATE_LEGACY_ITEM_TYPE = "state";
const NATIVE_STATE_ITEM_TYPES = new Set([NATIVE_STATE_ITEM_TYPE, NATIVE_STATE_LEGACY_ITEM_TYPE]);
const NATIVE_STATE_TYPE_LABEL_KEY = "TYPES.Item.state";
const NATIVE_STATE_TYPE_PLURAL_LABEL_KEY = "TYPES.Item.statePl";
const DOWNTIME_TYPE_LABEL_KEY = "TYPES.Item.rebreya-main.downtime";
const DOWNTIME_TYPE_PLURAL_LABEL_KEY = "TYPES.Item.rebreya-main.downtimePl";
const NATIVE_STATE_LABEL_KEY = "REBREYA_MAIN.NativeState.Label";
const NATIVE_STATE_ADD_LABEL_KEY = "REBREYA_MAIN.NativeState.AddButton";
const NATIVE_STATE_SELECT_TITLE_KEY = "REBREYA_MAIN.NativeState.SelectTitle";
const NATIVE_STATE_SELECT_BUTTON_KEY = "REBREYA_MAIN.NativeState.SelectButton";
const STATES_PACK_ID = `world.${STATES_COMPENDIUM_NAME}`;
const ITEM_RANK_MIN = 0;
const ITEM_RANK_MAX = 10;
const ACTIVITY_UNAVAILABLE_LABEL = "Недоступно";

function cleanText(value) {
  return String(value ?? "").trim();
}

function toPositiveInteger(value, fallback = 1) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? Math.max(1, Math.floor(numericValue)) : fallback;
}
const ITEM_SLOT_ELIGIBLE_TYPES = new Set(["weapon", "consumable", "equipment"]);
const HERO_DOLL_DROP_MIME_TYPES = ["text/plain", "text", "application/json"];
const REBREYA_FEAT_SOURCE_TYPE = "feat";
const REBREYA_MISC_FEAT_SECTION_LABEL = "Прочие черты";
const REBREYA_FEATS_PACK_ID = `world.${FEATS_COMPENDIUM_NAME}`;
const REBREYA_FEAT_SUBTYPE_LABELS = {
  minor: "Младшие черты",
  general: "Общие черты",
  major: "Старшие черты",
  multiclass: "Мультиклассовые черты",
  racial: "Расовые черты",
  fightingStyle: "Черты боевых стилей",
  fighterManeuver: "Воинские приёмы",
  cultural: "Культурные черты"
};
const REBREYA_FEAT_SUBTYPE_BY_SECTION_KEY = new Map([
  ["младшие черты", "minor"],
  ["общие черты", "general"],
  ["старшие черты", "major"],
  ["мультиклассовые черты", "multiclass"],
  ["расовые черты", "racial"],
  ["черты боевых стилей", "fightingStyle"],
  ["воинские приёмы", "fighterManeuver"],
  ["культурные черты", "cultural"],
  ["устаревшие материалы", "general"]
]);
const LEGACY_FEAT_SUBTYPE_ALIASES = new Map([
  ["origin", "cultural"],
  ["epicboon", "major"],
  ["epic-boon", "major"],
  ["fightingstyle", "fightingStyle"]
]);
const REBREYA_FEAT_SECTION_PRIORITY = new Map([
  ["младшие черты", 10],
  ["общие черты", 20],
  ["культурные черты", 30],
  ["мультиклассовые черты", 40],
  ["черты боевых стилей", 50],
  ["воинские приёмы", 55],
  ["старшие черты", 60],
  ["расовые черты", 70],
  ["устаревшие материалы", 80]
]);
const REBREYA_TOOL_LABEL_BY_ID = new Map(REBREYA_TOOLS.map((tool) => [tool.id, tool.label]));
const REBREYA_TOOL_ID_BY_TEXT = new Map(REBREYA_TOOLS.map((tool) => [normalizeLookupText(tool.label), tool.id]));
const LICH_WEAPON_PROPERTY_DEFINITIONS = Object.freeze([
  { key: "lchGrip", label: "Хват [L]" },
  { key: "lchPower", label: "Силовое [L]" },
  { key: "lchSwing", label: "Размах [L]" },
  { key: "lchBackswing", label: "О. замах [L]" },
  { key: "lchInterfere", label: "Мешающее [L]" },
  { key: "lchAim", label: "Прицел [L]" },
  { key: "lchPush", label: "Толчок [L]" },
  { key: "lchTrip", label: "Опрокид. [L]" },
  { key: "lchStrReq", label: "Мин. сила [L]" },
  { key: "lchArcShot", label: "Навес [L]" },
  { key: "lchMechanism", label: "Механизм [L]" },
  { key: "lchDash", label: "Наскок [L]" },
  { key: "lchMku", label: "МКУ [L]" },
  { key: "lchMu", label: "МУ [L]" },
  { key: "lchRku", label: "РКУ [L]" },
  { key: "lchWhirl", label: "Круговая [L]" },
  { key: "lchReach", label: "Досяг. [L]" },
  { key: "lchPowerStrike", label: "Сил. удар [L]" },
  { key: "lchMounted", label: "Верховой [L]" },
  { key: "lchDeadly", label: "Смерт. [L]" },
  { key: "lchPoison", label: "Отравл. [L]" }
]);
const FIREARM_WEAPON_PROPERTY_DEFINITIONS = Object.freeze([
  { key: "lchFirearmMisfire", label: "Осечка [О]" },
  { key: "lchFirearmAmmunition", label: "Боеприпасы [О]" },
  { key: "lchFirearmAmmoProperty", label: "Св-во боепр. [О]" },
  { key: "lchFirearmFireMode", label: "Тип стрельбы [О]" },
  { key: "lchFirearmReload", label: "Перезарядка [О]" },
  { key: "lchFirearmConstruction", label: "Разл. констр. [О]" },
  { key: "lchFirearmAutomatic", label: "Автоматическое [О]" },
  { key: "lchFirearmBoltAction", label: "Затворное [О]" },
  { key: "lchFirearmSemiAutomatic", label: "Полуавтомат. [О]" },
  { key: "lchFirearmBulky", label: "Громоздкое [О]" },
  { key: "lchFirearmScatter", label: "Разброс [О]" },
  { key: "lchFirearmExplosive", label: "Взрывное [О]" },
  { key: "lchFirearmRust", label: "Ржавчина [О]" },
  { key: "lchFirearmInaccurate", label: "Неточное [О]" },
  { key: "lchFirearmSurprise", label: "Внезапность [О]" },
  { key: "lchFirearmProneFire", label: "Лежачий огонь [О]" },
  { key: "lchFirearmWaterVulnerability", label: "Уязв. к воде [О]" },
  { key: "lchFirearmOverheat", label: "Перегрев [О]" },
  { key: "lchFirearmMachineGun", label: "Пулемёт [О]" }
]);
const FIREARM_WEAPON_TYPE_VALUES = new Set(["firearmPrimitive", "firearmAdvanced"]);
const FIREARM_WEAPON_PROPERTY_KEYS = new Set(FIREARM_WEAPON_PROPERTY_DEFINITIONS.map((definition) => definition.key));
const REBREYA_WEAPON_PROPERTY_DEFINITIONS = Object.freeze([
  ...LICH_WEAPON_PROPERTY_DEFINITIONS,
  ...FIREARM_WEAPON_PROPERTY_DEFINITIONS
]);
const LICH_WEAPON_VALUE_FIELDS = Object.freeze([
  { key: "gripModes", propertyKey: "lchGrip", label: "Хват [L]", type: "text", placeholder: "Напр.: 1к8 / 1к10" },
  { key: "minStrength", propertyKey: "lchStrReq", label: "Мин. сила [L]", type: "number", min: 0, step: 1 },
  { key: "mechanism", propertyKey: "lchMechanism", label: "Мех. [L]", type: "number", min: 0, step: 1 },
  { key: "dashDice", propertyKey: "lchDash", label: "Наскок [L]", type: "text", placeholder: "Напр.: 1к2" },
  { key: "reachBonus", propertyKey: "lchReach", label: "Досяг. [L] (фт)", type: "number", min: 0, step: 5 },
  { key: "mku", propertyKey: "lchMku", label: "МКУ [L]", type: "number", min: 0, step: 1 },
  { key: "mu", propertyKey: "lchMu", label: "МУ [L]", type: "number", min: 0, step: 1 },
  { key: "rku", propertyKey: "lchRku", label: "РКУ [L]", type: "number", min: 0, step: 1 },
  { key: "deadly", propertyKey: "lchDeadly", label: "Смерт. [L]", type: "number", min: 0, step: 1 },
  { key: "misfire", propertyKey: "lchFirearmMisfire", label: "Осечка [О]", type: "number", min: 1, step: 1 },
  { key: "automaticDamage", propertyKey: "lchFirearmAutomatic", label: "Авто. урон [О]", type: "text", placeholder: "Напр.: 6d4" },
  { key: "semiAutomaticDamage", propertyKey: "lchFirearmSemiAutomatic", label: "Полуавто. урон [О]", type: "text", placeholder: "Напр.: 2d12" },
  { key: "scatterDamage", propertyKey: "lchFirearmScatter", label: "Разброс [О]", type: "text", placeholder: "Напр.: 1d6" },
  { key: "surpriseDamage", propertyKey: "lchFirearmSurprise", label: "Внезапность [О]", type: "text", placeholder: "Напр.: 2d6" },
  { key: "overheat", propertyKey: "lchFirearmOverheat", label: "Перегрев [О]", type: "number", min: 1, step: 1 },
  { key: "reload", propertyKey: "lchFirearmReload", label: "Перезарядка [О]", type: "text", placeholder: "Напр.: Смена магазина 6" },
  { key: "ammunition", propertyKey: "lchFirearmAmmunition", label: "Боеприпасы [О]", type: "text", placeholder: "Напр.: Мушкетные" },
  { key: "ammoProperty", propertyKey: "lchFirearmAmmoProperty", label: "Св-во боепр. [О]", type: "text", placeholder: "Напр.: Разброс (1d6)" },
  { key: "fireMode", propertyKey: "lchFirearmFireMode", label: "Тип стрельбы [О]", type: "text", placeholder: "Напр.: Одиночные" }
]);
const FIREARM_ACTIVITY_ATTACK_TYPE = "firearm";
const FIREARM_MIDI_ACTION_TYPE = "fwak";
const LEGACY_REBREYA_TOOL_LABEL_ALIASES = [
  ["Воровские", "thieves"],
  ["Алхимические", "alchemy"],
  ["Кузнеца", "smith"],
  ["Каллиграфа", "calligrapher"],
  ["Поддельщика", "forgery"],
  ["Гримёра", "disguise"],
  ["Художественные", "artisan"],
  ["Исследователя", "investigator"],
  ["Жестянщика", "tinker"],
  ["Камнелома", "mason"],
  ["Каменолома", "mason"],
  ["Кожедела", "leatherworker"],
  ["Пивовара", "brewer"],
  ["Деревянщика", "woodcarver"],
  ["Повара", "cook"],
  ["Ювелира", "jeweler"]
];
REBREYA_TOOL_ID_BY_TEXT.set(normalizeLookupText("Камнелома"), "mason");
REBREYA_TOOL_ID_BY_TEXT.set(normalizeLookupText("Каменолома"), "mason");
let NativeStateDataModel = null;
let DowntimeDataModel = null;
const nativeStateWarningKeys = new Set();
const nativeStateBackgroundRepairKeys = new Set();
const TEYVANKAL_STATE_LANGUAGE_LABEL_BY_ID = new Map(
  TEYVANKAL_STATE_LANGUAGES.map((language) => [language.id, language.label])
);
for (const [legacyLabel, toolId] of LEGACY_REBREYA_TOOL_LABEL_ALIASES) {
  REBREYA_TOOL_ID_BY_TEXT.set(normalizeLookupText(legacyLabel), toolId);
}

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function getItemFlagValue(item, scope, key) {
  if (!item || !scope || !key) {
    return "";
  }

  const scopeName = String(scope ?? "").trim();
  const scopeIsKnown = scopeName === "core"
    || scopeName === game.system?.id
    || scopeName === MODULE_ID
    || Boolean(game.modules?.has(scopeName));

  if (scopeIsKnown && typeof item.getFlag === "function") {
    try {
      return item.getFlag(scopeName, key) ?? "";
    }
    catch (_error) {
      // Fallback to direct flag payload read for stale/foreign scopes.
    }
  }

  return foundry.utils.getProperty(item, `flags.${scopeName}.${key}`) ?? "";
}

function cleanFeatSectionLabel(value) {
  return String(value ?? "").trim();
}

function normalizeFeatSectionKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeFeatSubtypeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

function resolveFeatSubtypeKey(rawSubtype) {
  const normalized = normalizeFeatSubtypeKey(rawSubtype);
  if (!normalized) {
    return "";
  }

  for (const key of Object.keys(REBREYA_FEAT_SUBTYPE_LABELS)) {
    if (normalizeFeatSubtypeKey(key) === normalized) {
      return key;
    }
  }

  if (LEGACY_FEAT_SUBTYPE_ALIASES.has(normalized)) {
    return LEGACY_FEAT_SUBTYPE_ALIASES.get(normalized);
  }

  return "";
}

function resolveFeatSectionLabelFromSubtypeKey(subtypeKey) {
  if (!subtypeKey) {
    return "";
  }

  const configuredLabel = cleanFeatSectionLabel(CONFIG.DND5E?.featureTypes?.feat?.subtypes?.[subtypeKey]);
  if (configuredLabel) {
    return configuredLabel;
  }

  return cleanFeatSectionLabel(REBREYA_FEAT_SUBTYPE_LABELS[subtypeKey]);
}

let rebreyaFeatSectionLookupCache = null;
let rebreyaFeatSectionLookupPromise = null;

function createEmptyFeatSectionLookup() {
  return {
    byFeatId: new Map(),
    byName: new Map()
  };
}

async function getRebreyaFeatSectionLookup() {
  if (rebreyaFeatSectionLookupCache) {
    return rebreyaFeatSectionLookupCache;
  }

  if (rebreyaFeatSectionLookupPromise) {
    return rebreyaFeatSectionLookupPromise;
  }

  rebreyaFeatSectionLookupPromise = (async () => {
    const lookup = createEmptyFeatSectionLookup();
    const pack = game.packs?.get(REBREYA_FEATS_PACK_ID);
    if (!pack) {
      return lookup;
    }

    let index = [];
    try {
      index = await pack.getIndex({
        fields: [
          `flags.${MODULE_ID}.featId`,
          `flags.${MODULE_ID}.section`,
          "flags.teyvankal.section",
          "system.type.subtype"
        ]
      });
    }
    catch (_error) {
      index = [];
    }

    for (const row of index) {
      const section = cleanFeatSectionLabel(
        foundry.utils.getProperty(row, `flags.${MODULE_ID}.section`)
        || foundry.utils.getProperty(row, "flags.teyvankal.section")
        || resolveFeatSectionLabelFromSubtypeKey(resolveFeatSubtypeKey(foundry.utils.getProperty(row, "system.type.subtype")))
      );
      if (!section) {
        continue;
      }

      const featId = String(foundry.utils.getProperty(row, `flags.${MODULE_ID}.featId`) ?? "").trim();
      if (featId && !lookup.byFeatId.has(featId)) {
        lookup.byFeatId.set(featId, section);
      }

      const nameKey = normalizeLookupText(row?.name);
      if (nameKey && !lookup.byName.has(nameKey)) {
        lookup.byName.set(nameKey, section);
      }
    }

    if (!lookup.byName.size && !lookup.byFeatId.size) {
      try {
        const documents = await pack.getDocuments();
        for (const document of documents) {
          const section = cleanFeatSectionLabel(
            getItemFlagValue(document, MODULE_ID, "section")
            || getItemFlagValue(document, "teyvankal", "section")
            || resolveRebreyaFeatSectionFromSubtype(document)
          );
          if (!section) {
            continue;
          }

          const featId = String(getItemFlagValue(document, MODULE_ID, "featId") ?? "").trim();
          if (featId && !lookup.byFeatId.has(featId)) {
            lookup.byFeatId.set(featId, section);
          }

          const nameKey = normalizeLookupText(document?.name);
          if (nameKey && !lookup.byName.has(nameKey)) {
            lookup.byName.set(nameKey, section);
          }
        }
      }
      catch (_error) {
        // Keep empty lookup on failure; grouping will safely skip.
      }
    }

    return lookup;
  })();

  try {
    rebreyaFeatSectionLookupCache = await rebreyaFeatSectionLookupPromise;
  }
  finally {
    rebreyaFeatSectionLookupPromise = null;
  }

  return rebreyaFeatSectionLookupCache ?? createEmptyFeatSectionLookup();
}

function resolveRebreyaFeatSectionFromFlags(item) {
  return cleanFeatSectionLabel(getItemFlagValue(item, "teyvankal", "section"))
    || cleanFeatSectionLabel(getItemFlagValue(item, MODULE_ID, "section"));
}

function resolveFeatSubtypeFromItem(item) {
  const rawSubtype = String(foundry.utils.getProperty(item, "system.type.subtype") ?? "").trim();
  return resolveFeatSubtypeKey(rawSubtype);
}

function resolveRebreyaFeatSectionFromSubtype(item) {
  const subtypeKey = resolveFeatSubtypeFromItem(item);
  return resolveFeatSectionLabelFromSubtypeKey(subtypeKey);
}

function resolveRebreyaFeatSectionFromLookup(item, lookup) {
  if (!lookup || !item) {
    return "";
  }

  const featId = String(getItemFlagValue(item, MODULE_ID, "featId") ?? "").trim();
  if (featId && lookup.byFeatId instanceof Map && lookup.byFeatId.has(featId)) {
    return cleanFeatSectionLabel(lookup.byFeatId.get(featId));
  }

  const nameKey = normalizeLookupText(item.name);
  if (nameKey && lookup.byName instanceof Map && lookup.byName.has(nameKey)) {
    return cleanFeatSectionLabel(lookup.byName.get(nameKey));
  }

  return "";
}

function resolveRebreyaFeatSection(item, lookup) {
  const fromFlags = resolveRebreyaFeatSectionFromFlags(item);
  if (fromFlags) {
    const mappedSubtype = REBREYA_FEAT_SUBTYPE_BY_SECTION_KEY.get(normalizeFeatSectionKey(fromFlags));
    if (mappedSubtype) {
      return cleanFeatSectionLabel(REBREYA_FEAT_SUBTYPE_LABELS[mappedSubtype] ?? fromFlags);
    }
    return fromFlags;
  }

  const fromLookup = resolveRebreyaFeatSectionFromLookup(item, lookup);
  if (fromLookup) {
    const mappedSubtype = REBREYA_FEAT_SUBTYPE_BY_SECTION_KEY.get(normalizeFeatSectionKey(fromLookup));
    if (mappedSubtype) {
      return cleanFeatSectionLabel(REBREYA_FEAT_SUBTYPE_LABELS[mappedSubtype] ?? fromLookup);
    }
    return fromLookup;
  }

  const fromSubtype = resolveRebreyaFeatSectionFromSubtype(item);
  if (fromSubtype) {
    return fromSubtype;
  }

  return "";
}

function classifyRebreyaFeatItem(item, lookup) {
  if (!item || item.type !== "feat") {
    return null;
  }

  const sourceType = String(getItemFlagValue(item, MODULE_ID, "sourceType") ?? "")
    .trim()
    .toLowerCase();
  const resolvedSection = resolveRebreyaFeatSection(item, lookup);

  if (sourceType === REBREYA_FEAT_SOURCE_TYPE || resolvedSection) {
    return {
      item,
      section: resolvedSection || REBREYA_MISC_FEAT_SECTION_LABEL
    };
  }

  return null;
}

function sortFeatSectionEntries(entries = []) {
  return Array.from(entries).sort((left, right) => {
    const leftLabel = cleanFeatSectionLabel(left?.[0]);
    const rightLabel = cleanFeatSectionLabel(right?.[0]);
    const leftKey = normalizeFeatSectionKey(leftLabel);
    const rightKey = normalizeFeatSectionKey(rightLabel);
    const leftRank = REBREYA_FEAT_SECTION_PRIORITY.get(leftKey) ?? 9999;
    const rightRank = REBREYA_FEAT_SECTION_PRIORITY.get(rightKey) ?? 9999;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return leftLabel.localeCompare(rightLabel, "ru", { sensitivity: "base", numeric: true });
  });
}

function sortFeatItemsByName(items = []) {
  return Array.from(items).sort((left, right) => {
    const leftName = String(left?.name ?? "").trim();
    const rightName = String(right?.name ?? "").trim();
    return leftName.localeCompare(rightName, "ru", { sensitivity: "base", numeric: true });
  });
}

function buildItemContextDatasetFromGroups(groups) {
  if (!groups || typeof groups !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(groups).map(([key, value]) => [`group-${key}`, value])
  );
}

function getSectionGroupValue(section, groupKey) {
  if (!section || !groupKey) {
    return "";
  }

  const fromGroups = String(section?.groups?.[groupKey] ?? "").trim();
  if (fromGroups) {
    return fromGroups;
  }

  const fromDataset = String(section?.dataset?.[`group-${groupKey}`] ?? "").trim();
  if (fromDataset) {
    return fromDataset;
  }

  return "";
}

function resolveRebreyaFeatOriginGroup(sectionLabel, fallbackItem = null) {
  const normalizedSectionKey = normalizeFeatSectionKey(sectionLabel);
  const mappedSubtype = REBREYA_FEAT_SUBTYPE_BY_SECTION_KEY.get(normalizedSectionKey)
    || resolveFeatSubtypeFromItem(fallbackItem);
  if (mappedSubtype) {
    return `rebreya-feat-${mappedSubtype}`;
  }

  const normalizedSubtypeFallback = normalizeFeatSubtypeKey(normalizedSectionKey);
  return `rebreya-feat-${normalizedSubtypeFallback || "misc"}`;
}

function applyRebreyaFeatOriginGroupToItemContext(prepared, item, originGroup) {
  if (!prepared || !item || !originGroup) {
    return;
  }

  const itemContext = prepared.itemContext?.[item.id];
  if (!itemContext || typeof itemContext !== "object") {
    return;
  }

  itemContext.groups ??= {};
  itemContext.groups.origin = originGroup;
  itemContext.dataset = {
    ...(itemContext.dataset ?? {}),
    ...buildItemContextDatasetFromGroups(itemContext.groups)
  };
}

async function splitRebreyaFeatSectionsInContext(prepared) {
  if (!prepared || !Array.isArray(prepared.sections) || !prepared.sections.length) {
    return prepared;
  }

  const featSectionLookup = await getRebreyaFeatSectionLookup();
  const groupedFeatSections = new Map();
  const rebreyaFeatItemSet = new Set();

  for (const section of prepared.sections) {
    const items = Array.isArray(section?.items) ? section.items : [];
    for (const item of items) {
      const classified = classifyRebreyaFeatItem(item, featSectionLookup);
      if (!classified?.item) {
        continue;
      }

      const sectionLabel = cleanFeatSectionLabel(classified.section) || REBREYA_MISC_FEAT_SECTION_LABEL;
      const originGroup = resolveRebreyaFeatOriginGroup(sectionLabel, classified.item);
      if (!groupedFeatSections.has(sectionLabel)) {
        groupedFeatSections.set(sectionLabel, {
          items: [],
          originGroup
        });
      }

      const group = groupedFeatSections.get(sectionLabel);
      group.items.push(classified.item);
      rebreyaFeatItemSet.add(classified.item);
      applyRebreyaFeatOriginGroupToItemContext(prepared, classified.item, group.originGroup);
    }
  }

  if (!rebreyaFeatItemSet.size) {
    return prepared;
  }

  const sectionsWithoutFeatItems = prepared.sections.map((section) => {
    const items = Array.isArray(section?.items) ? section.items : [];
    if (!items.length) {
      return section;
    }

    return {
      ...section,
      items: items.filter((item) => !rebreyaFeatItemSet.has(item))
    };
  });

  const templateSection = sectionsWithoutFeatItems.find((section) => getSectionGroupValue(section, "origin") === "other")
    || sectionsWithoutFeatItems.find((section) => getSectionGroupValue(section, "origin"))
    || sectionsWithoutFeatItems[0];
  const baseOrder = Number.isFinite(templateSection?.order) ? templateSection.order : 3000;
  const templateGroups = (templateSection && typeof templateSection.groups === "object" && !Array.isArray(templateSection.groups))
    ? templateSection.groups
    : {};
  const templateDataset = (templateSection && typeof templateSection.dataset === "object" && !Array.isArray(templateSection.dataset))
    ? templateSection.dataset
    : {};

  const customSections = sortFeatSectionEntries(groupedFeatSections.entries()).map(([groupLabel, groupData], index) => {
    const groups = {
      ...templateGroups,
      origin: groupData.originGroup
    };
    const idSuffix = groupData.originGroup.replace(/[^a-z0-9-]+/gu, "-");
    return {
      ...(templateSection ?? {}),
      id: `rebreya-${idSuffix || index}`,
      label: groupLabel,
      order: baseOrder - 100 + index,
      groups,
      dataset: {
        ...templateDataset,
        ...buildItemContextDatasetFromGroups(groups)
      },
      items: sortFeatItemsByName(groupData.items)
    };
  });

  const otherSectionIndex = sectionsWithoutFeatItems.findIndex((section) => getSectionGroupValue(section, "origin") === "other");
  const insertIndex = otherSectionIndex >= 0 ? otherSectionIndex : sectionsWithoutFeatItems.length;
  const nextSections = [...sectionsWithoutFeatItems];
  nextSections.splice(insertIndex, 0, ...customSections);

  return {
    ...prepared,
    sections: nextSections
  };
}

function normalizeRebreyaToolId(value) {
  const normalized = normalizeLookupText(value);
  if (!normalized) {
    return "";
  }

  if (REBREYA_TOOL_LABEL_BY_ID.has(normalized)) {
    return normalized;
  }

  return REBREYA_TOOL_ID_BY_TEXT.get(normalized) ?? "";
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toOptionalFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  return Math.max(0, Math.floor(toFiniteNumber(value, fallback)));
}

function getLichWeaponPropertyValues(item) {
  if (!(item instanceof Item)) {
    return {};
  }

  const source = item.getFlag(MODULE_ID, "lichWeaponPropertyValues");
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }

  return foundry.utils.deepClone(source);
}

function normalizeLichWeaponValue(field, value) {
  if (field.type === "number") {
    return normalizeNonNegativeInteger(value, 0);
  }

  return String(value ?? "").trim();
}

let activeHeroDollDragData = null;
const heroDollPanelAbortControllers = new WeakMap();
const heroDollRootAbortControllers = new WeakMap();
const handledCharacterDowntimeClickEvents = new WeakSet();
const recentCharacterDowntimeSubmitButtons = new WeakMap();
const recentCharacterDowntimeRollButtons = new WeakMap();
const recentCharacterDowntimeContinueButtons = new WeakMap();
const recentCharacterDowntimeProjectCloseButtons = new WeakMap();
const characterDowntimeSubmitAbortControllers = new WeakMap();
const characterDowntimeRollAbortControllers = new WeakMap();
const characterDowntimeLibraryAbortControllers = new WeakMap();
const characterDowntimeStateAbortControllers = new WeakMap();
const characterDowntimeFormStateByActorId = new Map();
let characterDowntimeDocumentSubmitDelegated = false;
let characterDowntimeDocumentRollDelegated = false;
let characterDowntimeDocumentEditDelegated = false;
let characterDowntimeDocumentContinueDelegated = false;
let characterDowntimeDocumentProjectCloseDelegated = false;
const CHARACTER_DOWNTIME_SUBMIT_DEBOUNCE_MS = 750;
const CHARACTER_DOWNTIME_ROLL_DEBOUNCE_MS = 750;
const CHARACTER_DOWNTIME_PROJECT_ACTION_DEBOUNCE_MS = 750;
const CHARACTER_DOWNTIME_ROLLABLE_SOURCE_TYPES = new Set(["skill", "ability", "save", "tool"]);
const CHARACTER_DOWNTIME_ABILITY_KEYS = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const HELD_ITEM_EQUIP_CONTROL_SELECTORS = [
  "[data-action='equip']",
  "[data-action='toggle-equip']",
  "[data-action='item-toggle']",
  "[data-action='itemToggle']",
  ".item-control.item-toggle",
  "[data-tooltip*='Equipped']",
  "[aria-label*='Надето']",
  "[title*='Надето']"
];
function heldItemUpdateOptions() {
  return { render: false };
}

function isDnd5eWorld() {
  return game.system?.id === "dnd5e";
}

function getCharacterActorSheetClass() {
  return game.dnd5e?.applications?.actor?.CharacterActorSheet ?? null;
}

function getSheetRoot(html) {
  if (!html) {
    return null;
  }

  if (html instanceof HTMLElement) {
    return html;
  }

  if (html[0] instanceof HTMLElement) {
    return html[0];
  }

  return null;
}

function getActorFromSheetApp(app) {
  const actor = app?.actor ?? app?.document ?? app?.object ?? null;
  return actor instanceof Actor ? actor : null;
}

function getItemFromSheetApp(app) {
  const item = app?.item ?? app?.document ?? app?.object ?? null;
  return item instanceof Item ? item : null;
}

function isActorSheetRenderApp(app) {
  const document = app?.document ?? app?.object ?? null;
  if (document instanceof Item) {
    return false;
  }

  return document instanceof Actor || app?.actor instanceof Actor;
}

function bindCharacterSheetBranding(root) {
  root?.style?.setProperty?.("--rm-character-sheet-header-image", CHARACTER_SHEET_HEADER_IMAGE);

  const leftHeader = root?.querySelector?.(".sheet-header > .left") ?? null;
  if (!leftHeader) {
    return;
  }

  const existingBrand = leftHeader.querySelector?.("[data-rebreya-character-brand='true']") ?? null;
  if (existingBrand) {
    if (typeof existingBrand.replaceChildren === "function") {
      existingBrand.replaceChildren();
    }
    else {
      existingBrand.children = [];
    }
    existingBrand.textContent = "Ребрея: Тень прогресса";
    return;
  }

  const brand = document.createElement("div");
  brand.classList.add("rm-character-sheet-brand");
  brand.dataset.rebreyaCharacterBrand = "true";
  brand.setAttribute("aria-hidden", "true");
  brand.textContent = "Ребрея: Тень прогресса";
  leftHeader.prepend(brand);
}

function removeCharacterSheetBranding(root) {
  for (const brand of Array.from(root?.querySelectorAll?.("[data-rebreya-character-brand='true']") ?? [])) {
    brand?.remove?.();
  }
  root?.style?.removeProperty?.("--rm-character-sheet-header-image");
}

function isSheetEditable(app, root = null) {
  let editableByPermission = false;
  if (typeof app?.isEditable === "boolean") {
    editableByPermission = app.isEditable;
  }
  else if (typeof app?.options?.editable === "boolean") {
    editableByPermission = app.options.editable;
  }
  else {
    const item = getItemFromSheetApp(app);
    editableByPermission = Boolean(item?.isOwner);
  }

  if (!editableByPermission) {
    return false;
  }

  const modes = app?.constructor?.MODES;
  const editMode = modes?.EDIT;
  if (editMode !== undefined && editMode !== null) {
    const currentMode = app?._mode;
    if (currentMode !== undefined && currentMode !== null) {
      return currentMode === editMode;
    }
  }

  if (root instanceof HTMLElement) {
    if (root.classList.contains("interactable")) {
      return false;
    }

    if (root.classList.contains("editable")) {
      return true;
    }
  }

  return editableByPermission;
}

function localizeWithFallback(key, fallback) {
  const value = game.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
}

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function getNativeStateTypeLabel() {
  return localizeWithFallback(NATIVE_STATE_TYPE_LABEL_KEY, "Государство");
}

function getNativeStateSubtitleLabel() {
  return localizeWithFallback(NATIVE_STATE_LABEL_KEY, "Родное государство");
}

function getNativeStateDataModel() {
  if (NativeStateDataModel) {
    return NativeStateDataModel;
  }

  const ItemDataModel = globalThis.dnd5e?.dataModels?.ItemDataModel;
  const AdvancementTemplate = globalThis.dnd5e?.dataModels?.item?.AdvancementTemplate;
  const ItemDescriptionTemplate = globalThis.dnd5e?.dataModels?.item?.ItemDescriptionTemplate;
  if (ItemDataModel?.mixin && AdvancementTemplate && ItemDescriptionTemplate) {
    NativeStateDataModel = class RebreyaStateData extends ItemDataModel.mixin(
      AdvancementTemplate,
      ItemDescriptionTemplate
    ) {
      static metadata = Object.freeze(foundry.utils.mergeObject(super.metadata, {
        singleton: true
      }, { inplace: false }));

      prepareDerivedData() {
        super.prepareDerivedData();
        this.prepareDescriptionData?.();
      }

      async getFavoriteData() {
        return {
          img: this.parent.img,
          title: this.parent.name,
          subtitle: getNativeStateSubtitleLabel()
        };
      }

      async getSheetData(context) {
        context.subtitles = [{ label: getNativeStateTypeLabel() }];
        context.singleDescription = true;
        context.parts = ["dnd5e.details-background"];
      }

      async _preCreate(data, options, user) {
        if (typeof super._preCreate === "function" && (await super._preCreate(data, options, user)) === false) {
          return false;
        }

        await this.preCreateAdvancement(data, options);
        return undefined;
      }
    };

    return NativeStateDataModel;
  }

  const BackgroundData = CONFIG.Item?.dataModels?.background;
  if (BackgroundData) {
    NativeStateDataModel = class RebreyaStateDataFallback extends BackgroundData {
      static metadata = Object.freeze(foundry.utils.mergeObject(super.metadata, {
        singleton: true
      }, { inplace: false }));

      async getFavoriteData() {
        return {
          img: this.parent.img,
          title: this.parent.name,
          subtitle: getNativeStateSubtitleLabel()
        };
      }

      async getSheetData(context) {
        if (typeof super.getSheetData === "function") {
          await super.getSheetData(context);
        }
        context.subtitles = [{ label: getNativeStateTypeLabel() }];
        context.singleDescription = true;
        context.parts = ["dnd5e.details-background"];
      }

      _onCreate() {}

      async _preDelete(options, user) {
        return undefined;
      }
    };

    return NativeStateDataModel;
  }

  if (ItemDataModel?.mixin && ItemDescriptionTemplate) {
    NativeStateDataModel = class RebreyaStateDataDescriptionOnlyFallback extends ItemDataModel.mixin(ItemDescriptionTemplate) {
      static metadata = Object.freeze(foundry.utils.mergeObject(super.metadata, {
        singleton: true
      }, { inplace: false }));

      prepareDerivedData() {
        super.prepareDerivedData();
        this.prepareDescriptionData?.();
      }

      async getFavoriteData() {
        return {
          img: this.parent.img,
          title: this.parent.name,
          subtitle: getNativeStateSubtitleLabel()
        };
      }

      async getSheetData(context) {
        context.subtitles = [{ label: getNativeStateTypeLabel() }];
        context.singleDescription = true;
        context.parts = ["dnd5e.details-background"];
      }
    };

    return NativeStateDataModel;
  }

  return NativeStateDataModel;
}

function registerNativeStateDocumentType() {
  const moduleItemTypes = game.modules?.get?.(MODULE_ID)?.documentTypes?.Item;
  if (!moduleItemTypes?.state) {
    console.warn(`${MODULE_ID} | Module manifest does not expose Item document type '${NATIVE_STATE_LEGACY_ITEM_TYPE}'.`);
  }
}

function registerNativeStateItemType() {
  registerNativeStateDocumentType();

  CONFIG.Item.dataModels ??= {};
  CONFIG.Item.typeLabels ??= {};
  CONFIG.Item.typeIcons ??= {};

  const dataModel = getNativeStateDataModel();
  if (dataModel) {
    CONFIG.Item.dataModels[NATIVE_STATE_ITEM_TYPE] = dataModel;
  }

  CONFIG.Item.typeLabels[NATIVE_STATE_ITEM_TYPE] = NATIVE_STATE_TYPE_LABEL_KEY;
  CONFIG.Item.typeLabels[`${NATIVE_STATE_ITEM_TYPE}Pl`] = NATIVE_STATE_TYPE_PLURAL_LABEL_KEY;
  CONFIG.Item.typeLabels[NATIVE_STATE_LEGACY_ITEM_TYPE] = NATIVE_STATE_TYPE_LABEL_KEY;
  CONFIG.Item.typeLabels[`${NATIVE_STATE_LEGACY_ITEM_TYPE}Pl`] = NATIVE_STATE_TYPE_PLURAL_LABEL_KEY;
  CONFIG.Item.typeIcons[NATIVE_STATE_ITEM_TYPE] ??= "fa-solid fa-city";
  CONFIG.Item.typeIcons[NATIVE_STATE_LEGACY_ITEM_TYPE] ??= "fa-solid fa-city";
}

function getDowntimeTypeLabel() {
  return game.i18n?.localize?.(DOWNTIME_TYPE_LABEL_KEY) ?? "Простой";
}

function getDowntimeDataModel() {
  if (DowntimeDataModel) {
    return DowntimeDataModel;
  }

  const BackgroundData = CONFIG.Item?.dataModels?.background;
  if (BackgroundData) {
    DowntimeDataModel = class RebreyaDowntimeData extends BackgroundData {
      static metadata = Object.freeze(foundry.utils.mergeObject(super.metadata, {
        singleton: true
      }, { inplace: false }));

      async getFavoriteData() {
        return {
          img: this.parent.img,
          title: this.parent.name,
          subtitle: getDowntimeTypeLabel()
        };
      }

      async getSheetData(context) {
        if (typeof super.getSheetData === "function") {
          await super.getSheetData(context);
        }
        context.subtitles = [{ label: getDowntimeTypeLabel() }];
        context.singleDescription = true;
        context.parts = ["dnd5e.details-background"];
      }

      _onCreate() {}

      async _preDelete(options, user) {
        return undefined;
      }
    };

    return DowntimeDataModel;
  }

  return DowntimeDataModel;
}

function registerDowntimeDocumentType() {
  const moduleItemTypes = game.modules?.get?.(MODULE_ID)?.documentTypes?.Item;
  if (!moduleItemTypes?.downtime) {
    console.warn(`${MODULE_ID} | Module manifest does not expose Item document type 'downtime'.`);
  }
}

function registerDowntimeItemType() {
  registerDowntimeDocumentType();

  CONFIG.Item.dataModels ??= {};
  CONFIG.Item.typeLabels ??= {};
  CONFIG.Item.typeIcons ??= {};

  const dataModel = getDowntimeDataModel();
  if (dataModel) {
    CONFIG.Item.dataModels[DOWNTIME_ITEM_TYPE] = dataModel;
  }

  CONFIG.Item.typeLabels[DOWNTIME_ITEM_TYPE] = DOWNTIME_TYPE_LABEL_KEY;
  CONFIG.Item.typeLabels[`${DOWNTIME_ITEM_TYPE}Pl`] = DOWNTIME_TYPE_PLURAL_LABEL_KEY;
  CONFIG.Item.typeIcons[DOWNTIME_ITEM_TYPE] ??= "fa-solid fa-hourglass-half";
}

function registerNativeStateAdvancementTypes() {
  const advancementTypes = CONFIG.DND5E?.advancementTypes ?? {};
  for (const type of ["ItemChoice", "ItemGrant", "Trait"]) {
    const validItemTypes = advancementTypes[type]?.validItemTypes;
    if (validItemTypes instanceof Set) {
      validItemTypes.add(NATIVE_STATE_ITEM_TYPE);
      validItemTypes.add(NATIVE_STATE_LEGACY_ITEM_TYPE);
    }
  }
}

function registerNativeStateLanguages() {
  const languages = CONFIG.DND5E?.languages;
  if (!languages || typeof languages !== "object") {
    return;
  }

  const group = languages[TEYVANKAL_STATE_LANGUAGE_GROUP_ID] ?? {
    label: "Языки государств Тейванкаля",
    selectable: false,
    children: {}
  };
  group.label ??= "Языки государств Тейванкаля";
  group.selectable = false;
  group.children ??= {};

  for (const [id, label] of TEYVANKAL_STATE_LANGUAGE_LABEL_BY_ID.entries()) {
    group.children[id] ??= label;
  }

  languages[TEYVANKAL_STATE_LANGUAGE_GROUP_ID] = group;
}

function findPrototypeDescriptor(prototype, propertyName) {
  let cursor = prototype;
  while (cursor) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, propertyName);
    if (descriptor) {
      return descriptor;
    }
    cursor = Object.getPrototypeOf(cursor);
  }

  return null;
}

function resolveFirearmAttackAbilityFromItem(item) {
  const weight = Number(foundry.utils.getProperty(item, "system.weight.value") ?? item?.system?.weight?.value ?? 0);
  return Number.isFinite(weight) && weight > 10 ? "str" : "dex";
}

function itemUpdateChangesWeight(updateData) {
  if (!updateData || typeof updateData !== "object") {
    return false;
  }

  if (Object.hasOwn(updateData, "system.weight.value") || Object.hasOwn(updateData, "system.weight")) {
    return true;
  }

  return foundry.utils.hasProperty?.(updateData, "system.weight.value") === true
    || foundry.utils.hasProperty?.(updateData, "system.weight") === true;
}

function getActivityEntries(activities) {
  if (!activities) {
    return [];
  }

  if (activities instanceof Map) {
    return Array.from(activities.entries());
  }

  if (typeof activities.entries === "function" && !Array.isArray(activities)) {
    return Array.from(activities.entries());
  }

  if (Array.isArray(activities)) {
    return activities.map((activity, index) => [activity?.id ?? activity?._id ?? String(index), activity]);
  }

  if (typeof activities === "object") {
    return Object.entries(activities);
  }

  return [];
}

async function syncFirearmAttackAbilityAfterWeightUpdate(item, updateData) {
  if (!isFirearmWeaponItem(item) || !itemUpdateChangesWeight(updateData)) {
    return;
  }

  const nextAbility = resolveFirearmAttackAbilityFromItem(item);
  const updates = {};
  for (const [activityId, activity] of getActivityEntries(item.system?.activities)) {
    if (!activityId || activity?.type !== "attack") {
      continue;
    }

    const attackType = cleanText(foundry.utils.getProperty(activity, "attack.type.value"));
    const classification = cleanText(foundry.utils.getProperty(activity, "attack.type.classification"));
    if (attackType !== FIREARM_ACTIVITY_ATTACK_TYPE || classification === "spell") {
      continue;
    }

    if (cleanText(foundry.utils.getProperty(activity, "attack.ability")) === nextAbility) {
      continue;
    }

    updates[`system.activities.${activityId}.attack.ability`] = nextAbility;
  }

  if (Object.keys(updates).length) {
    await item.update?.(updates, { render: false });
  }
}

function patchFirearmAttackActivityDocumentClass() {
  const AttackActivityClass = CONFIG.DND5E?.activityTypes?.attack?.documentClass;
  const prototype = AttackActivityClass?.prototype;
  if (!prototype || prototype.__rebreyaFirearmAttackTypePatched) {
    return;
  }

  const originalActionType = findPrototypeDescriptor(prototype, "actionType");
  const originalAvailableAbilities = findPrototypeDescriptor(prototype, "availableAbilities");
  Object.defineProperty(prototype, "actionType", {
    configurable: true,
    get() {
      const attackType = String(this.attack?.type?.value ?? "").trim();
      const classification = String(this.attack?.type?.classification ?? "").trim();
      if (attackType === FIREARM_ACTIVITY_ATTACK_TYPE && classification !== "spell") {
        return FIREARM_MIDI_ACTION_TYPE;
      }

      if (typeof originalActionType?.get === "function") {
        return originalActionType.get.call(this);
      }

      const type = this.attack?.type ?? {};
      return `${type.value === "ranged" ? "r" : "m"}${type.classification === "spell" ? "sak" : "wak"}`;
    }
  });

  if (typeof originalAvailableAbilities?.get === "function") {
    Object.defineProperty(prototype, "availableAbilities", {
      configurable: true,
      get() {
        const attackType = String(this.attack?.type?.value ?? "").trim();
        const classification = String(this.attack?.type?.classification ?? "").trim();
        if (attackType === FIREARM_ACTIVITY_ATTACK_TYPE && classification !== "spell") {
          return new Set([resolveFirearmAttackAbilityFromItem(this.item)]);
        }

        return originalAvailableAbilities.get.call(this);
      }
    });
  }

  Object.defineProperty(prototype, "__rebreyaFirearmAttackTypePatched", {
    configurable: false,
    enumerable: false,
    value: true
  });
}

function registerFirearmAttackType() {
  const dnd5eConfig = CONFIG.DND5E;
  if (!dnd5eConfig || typeof dnd5eConfig !== "object") {
    return;
  }

  const attackTypes = dnd5eConfig.attackTypes && typeof dnd5eConfig.attackTypes === "object"
    ? dnd5eConfig.attackTypes
    : {};
  const nextAttackTypes = {
    ...attackTypes,
    [FIREARM_ACTIVITY_ATTACK_TYPE]: {
      ...(typeof attackTypes[FIREARM_ACTIVITY_ATTACK_TYPE] === "object" ? attackTypes[FIREARM_ACTIVITY_ATTACK_TYPE] : {}),
      label: "Огнестрельная"
    }
  };
  dnd5eConfig.attackTypes = Object.isSealed(attackTypes)
    ? Object.seal(nextAttackTypes)
    : nextAttackTypes;

  dnd5eConfig.itemActionTypes ??= {};
  dnd5eConfig.itemActionTypes[FIREARM_MIDI_ACTION_TYPE] ??= "Огнестрельная атака";

  patchFirearmAttackActivityDocumentClass();
}

function isNativeStateItem(item) {
  return NATIVE_STATE_ITEM_TYPES.has(item?.type);
}

function getNativeStateItems(actor) {
  const items = actor?.items?.filter?.((item) => isNativeStateItem(item)) ?? [];
  if (items.length > 1) {
    const extraIds = items.slice(1).map((item) => item.id).filter(Boolean);
    const warningKey = `${actor.id ?? actor.uuid}:${extraIds.join(",")}`;
    if (!nativeStateWarningKeys.has(warningKey)) {
      nativeStateWarningKeys.add(warningKey);
      console.warn(
        `${MODULE_ID} | Actor "${actor.name}" has multiple native state items. `
        + `Showing the first one (${items[0].id}); extra ids: ${extraIds.join(", ")}.`
      );
    }
  }

  return items;
}

function getPrimaryNativeStateItem(actor) {
  return getNativeStateItems(actor)[0] ?? null;
}

function getNativeStateBackgroundReference(actor) {
  const background = actor?.system?.details?.background;
  return isNativeStateItem(background) ? background : null;
}

function getFirstActualBackgroundItem(actor) {
  return actor?.items?.find?.((item) => item?.type === "background") ?? null;
}

async function repairNativeStateBackgroundReference(actor) {
  const stateAsBackground = getNativeStateBackgroundReference(actor);
  if (!stateAsBackground || !actor?.isOwner) {
    return;
  }

  const repairKey = `${actor.uuid ?? actor.id}:${stateAsBackground.id}`;
  if (nativeStateBackgroundRepairKeys.has(repairKey)) {
    return;
  }

  nativeStateBackgroundRepairKeys.add(repairKey);
  const replacement = getFirstActualBackgroundItem(actor);
  try {
    await actor.update({ "system.details.background": replacement?.id ?? null });
    console.warn(
      `${MODULE_ID} | Removed native state item '${stateAsBackground.name}' from actor background slot`
      + (replacement ? ` and restored '${replacement.name}'.` : ".")
    );
  }
  catch (error) {
    nativeStateBackgroundRepairKeys.delete(repairKey);
    console.error(`${MODULE_ID} | Failed to repair native state background slot.`, error);
  }
}

function buildNativeStateName(title, subtitle = "") {
  const name = document.createElement("div");
  name.classList.add("name", "name-stacked");

  const titleElement = document.createElement("span");
  titleElement.classList.add("title");
  titleElement.textContent = title;
  name.append(titleElement);

  if (subtitle) {
    const subtitleElement = document.createElement("span");
    subtitleElement.classList.add("subtitle");
    subtitleElement.textContent = subtitle;
    name.append(subtitleElement);
  }

  return name;
}

function buildNativeStateItemCard(item) {
  const label = getNativeStateSubtitleLabel();
  const entry = document.createElement("div");
  entry.classList.add("draggable", "pill-lg", "texture", "state", "item-tooltip", "rebreya-native-state");
  entry.dataset.rebreyaNativeState = "true";
  entry.dataset.rebreyaNativeStateAction = "open";
  entry.dataset.itemId = item.id;
  entry.dataset.stateItemId = item.id;
  entry.dataset.uuid = item.uuid;
  entry.dataset.referenceTooltip = item.uuid;
  entry.role = "button";
  entry.tabIndex = 0;
  entry.setAttribute("aria-label", `${label}: ${item.name}`);

  if (item.img) {
    const image = document.createElement("img");
    image.classList.add("gold-icon");
    image.src = item.img;
    image.alt = item.name;
    entry.append(image);
  }

  entry.append(buildNativeStateName(item.name));

  return entry;
}

function buildNativeStateEmptyCard(canCreate) {
  const title = localizeWithFallback(NATIVE_STATE_ADD_LABEL_KEY, "Добавить государство");
  const entry = document.createElement("div");
  entry.classList.add("pill-lg", "empty", "roboto-upper", "rebreya-native-state");
  if (!canCreate) {
    entry.classList.add("disabled");
  }

  entry.dataset.rebreyaNativeState = "true";
  if (canCreate) {
    entry.dataset.rebreyaNativeStateAction = "select";
    entry.role = "button";
    entry.tabIndex = 0;
  }

  entry.setAttribute("aria-label", title);
  entry.textContent = title;

  return entry;
}

function getNativeStateDetailsPillContainer(root) {
  const containers = Array.from(root.querySelectorAll(".pills-lg"));
  let fallback = null;

  for (const container of containers) {
    if (!(container instanceof HTMLElement)) {
      continue;
    }

    const hasCreatureIdentityPill = container.querySelector(".pill-lg.type");
    if (!hasCreatureIdentityPill) {
      continue;
    }

    const hasCharacterIdentityPill = container.querySelector(
      ".pill-lg.race, .pill-lg.background, [data-item-type='race'], [data-item-type='background']"
    );
    if (hasCharacterIdentityPill) {
      return container;
    }

    fallback ??= container;
  }

  return fallback;
}

function findNativeStateInsertionAnchor(container) {
  if (!(container instanceof HTMLElement)) {
    return null;
  }

  return container.querySelector(".pill-lg.background, [data-item-type='background']")
    ?? container.querySelector(".pill-lg.race, [data-item-type='race']")
    ?? container.querySelector(".pill-lg.type");
}

function removeSystemRenderedNativeStateCards(root, actor) {
  if (!(root instanceof HTMLElement) || !actor) {
    return;
  }

  root.querySelectorAll("[data-item-id]").forEach((node) => {
    if (!(node instanceof HTMLElement) || node.dataset.rebreyaNativeState === "true") {
      return;
    }

    const item = actor.items.get(node.dataset.itemId);
    if (isNativeStateItem(item)) {
      node.remove();
    }
  });
}

async function openNativeStateItemSheet(item) {
  if (!item?.sheet) {
    return;
  }

  try {
    await item.sheet.render({ force: true });
  }
  catch (_error) {
    await item.sheet.render(true);
  }
  bringAppToFront(item.sheet);
}

function isNativeStateItemTypeAvailable() {
  if (game.documentTypes?.Item?.includes?.(NATIVE_STATE_ITEM_TYPE)) {
    return true;
  }

  return Boolean(game.model?.Item?.[NATIVE_STATE_ITEM_TYPE]);
}

function getNativeStatePack() {
  return game.packs?.get?.(STATES_PACK_ID) ?? null;
}

function getNativeStatePackRecordLabel(record) {
  const rank = foundry.utils.getProperty(record, `flags.${MODULE_ID}.rank`);
  const continent = foundry.utils.getProperty(record, `flags.${MODULE_ID}.continent`);
  const details = [
    Number(rank) > 0 ? `ранг ${rank}` : "",
    cleanString(continent)
  ].filter(Boolean).join(", ");

  return details ? `${record.name} (${details})` : record.name;
}

async function getNativeStatePackIndex(pack) {
  const index = await pack.getIndex({
    fields: [
      `flags.${MODULE_ID}.stateId`,
      `flags.${MODULE_ID}.rank`,
      `flags.${MODULE_ID}.continent`,
      `flags.${MODULE_ID}.culturalFeatNames`
    ]
  });

  return Array.from(index ?? [])
    .filter((record) => cleanString(record?._id ?? record?.id) && cleanString(record?.name))
    .sort((left, right) => {
      const leftRank = Number(foundry.utils.getProperty(left, `flags.${MODULE_ID}.rank`) ?? 0);
      const rightRank = Number(foundry.utils.getProperty(right, `flags.${MODULE_ID}.rank`) ?? 0);
      return (rightRank - leftRank) || String(left.name).localeCompare(String(right.name), game.i18n?.lang ?? "ru");
    });
}

function buildNativeStateSelectionContent(records) {
  const options = records.map((record) => {
    const id = cleanString(record?._id ?? record?.id);
    const culturalFeatNames = cleanString(foundry.utils.getProperty(record, `flags.${MODULE_ID}.culturalFeatNames`));
    const title = getNativeStatePackRecordLabel(record);
    const description = culturalFeatNames ? `Культурные черты: ${culturalFeatNames}` : "";
    return `<option value="${escapeHtml(id)}" title="${escapeHtml(description)}">${escapeHtml(title)}</option>`;
  });

  return `
    <form class="rebreya-native-state-picker">
      <div class="form-group">
        <label>${escapeHtml(getNativeStateSubtitleLabel())}</label>
        <select name="stateId">${options.join("")}</select>
      </div>
    </form>
  `;
}

function queryDialogElement(html, selector) {
  if (html instanceof HTMLElement) {
    return html.querySelector(selector);
  }

  const root = html?.[0] ?? html;
  if (root?.querySelector) {
    return root.querySelector(selector);
  }

  return html?.find?.(selector)?.[0] ?? null;
}

async function openNativeStatePackForManualSelection(pack) {
  if (!pack) {
    return null;
  }

  try {
    await pack.render({ force: true });
  }
  catch (_error) {
    await pack.render(true);
  }

  return null;
}

function getCompendiumBrowserClass() {
  return globalThis.dnd5e?.applications?.CompendiumBrowser ?? null;
}

function getItemChoiceFlowClass() {
  return globalThis.dnd5e?.applications?.advancement?.ItemChoiceFlow
    ?? game.dnd5e?.applications?.advancement?.ItemChoiceFlow
    ?? null;
}

function getRebreyaFlag(document, key) {
  return document?.getFlag?.(MODULE_ID, key)
    ?? document?.flags?.[MODULE_ID]?.[key];
}

function isManagedRebreyaAdvancementItem(item) {
  return getRebreyaFlag(item, "managed") === true;
}

function shouldExcludeCantripsFromAvailableSpellChoice(advancement) {
  const configuration = advancement?.configuration;
  return isManagedRebreyaAdvancementItem(advancement?.item)
    && configuration?.type === "spell"
    && cleanText(configuration?.restriction?.level) === "available";
}

function applyAvailableSpellChoiceMinimumLevel(options) {
  const levelFilter = options?.filters?.locked?.additional?.level;
  if (!levelFilter || levelFilter.min != null) {
    return;
  }

  const maxLevel = Number(levelFilter.max);
  if (Number.isFinite(maxLevel) && maxLevel >= 1) {
    levelFilter.min = 1;
  }
}

function patchItemChoiceSpellLevelFilters() {
  const ItemChoiceFlow = getItemChoiceFlowClass();
  const prototype = ItemChoiceFlow?.prototype;
  if (!prototype || prototype[ITEM_CHOICE_SPELL_FILTER_PATCH_FLAG]) {
    return;
  }

  const originalOnBrowseCompendium = prototype._onBrowseCompendium;
  if (typeof originalOnBrowseCompendium !== "function") {
    return;
  }

  prototype._onBrowseCompendium = async function (...args) {
    if (!shouldExcludeCantripsFromAvailableSpellChoice(this?.advancement)) {
      return originalOnBrowseCompendium.call(this, ...args);
    }

    const CompendiumBrowser = getCompendiumBrowserClass();
    const originalSelect = CompendiumBrowser?.select;
    if (typeof originalSelect !== "function") {
      return originalOnBrowseCompendium.call(this, ...args);
    }

    CompendiumBrowser.select = async function (options = {}, ...selectArgs) {
      applyAvailableSpellChoiceMinimumLevel(options);
      return originalSelect.call(this, options, ...selectArgs);
    };

    try {
      return await originalOnBrowseCompendium.call(this, ...args);
    }
    finally {
      CompendiumBrowser.select = originalSelect;
    }
  };

  Object.defineProperty(prototype, ITEM_CHOICE_SPELL_FILTER_PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true
  });
}

async function selectNativeStateDocumentWithBrowser() {
  const CompendiumBrowser = getCompendiumBrowserClass();
  if (!CompendiumBrowser?.selectOne) {
    return null;
  }

  const result = await CompendiumBrowser.selectOne({
    mode: CompendiumBrowser.MODES?.ADVANCED,
    tab: "items",
    filters: {
      locked: {
        documentClass: "Item",
        types: new Set([NATIVE_STATE_ITEM_TYPE])
      }
    }
  });
  if (!result) {
    return null;
  }

  const document = await fromUuid(result);
  return isNativeStateItem(document) ? document : null;
}

function getAdvancementManagerClass() {
  return globalThis.dnd5e?.applications?.advancement?.AdvancementManager ?? null;
}

function renderAdvancementManager(manager) {
  try {
    manager.render(true);
  }
  catch (_error) {
    manager.render(true, { force: true });
  }
}

async function importNativeStateDocumentToActor(actor, stateDocument) {
  const existing = getPrimaryNativeStateItem(actor);
  if (existing) {
    await repairNativeStateBackgroundReference(actor);
    return existing;
  }

  if (!stateDocument) {
    return null;
  }

  const source = foundry.utils.deepClone(stateDocument.toObject());
  delete source._id;
  delete source.folder;
  delete source.ownership;
  source.type = NATIVE_STATE_ITEM_TYPE;
  source.flags ??= {};
  source.flags[MODULE_ID] = {
    ...(source.flags[MODULE_ID] ?? {}),
    nativeState: true,
    sourceCompendiumUuid: stateDocument.uuid
  };

  const shouldRunAdvancement = actor.system?.metadata?.supportsAdvancement
    && Array.isArray(source.system?.advancement)
    && source.system.advancement.length
    && !game.settings.get("dnd5e", "disableAdvancements");
  const AdvancementManager = shouldRunAdvancement ? getAdvancementManagerClass() : null;
  const manager = AdvancementManager?.forNewItem?.(actor, source);
  if (manager?.steps?.length) {
    renderAdvancementManager(manager);
    return null;
  }

  const [created] = await actor.createEmbeddedDocuments("Item", [source], { renderSheet: false });
  await repairNativeStateBackgroundReference(actor);
  return created ?? null;
}

async function selectNativeStateForActor(actor) {
  const existing = getPrimaryNativeStateItem(actor);
  if (existing) {
    return existing;
  }

  if (!isNativeStateItemTypeAvailable()) {
    ui.notifications?.warn?.("Тип предмета «Государство» ещё не зарегистрирован. Перезапустите мир после обновления модуля.");
    return null;
  }

  const pack = getNativeStatePack();
  if (!pack) {
    ui.notifications?.warn?.("Компендиум государств Rebreya пока не найден. Если модуль только обновлён, перезапустите мир.");
    return null;
  }

  const records = await getNativeStatePackIndex(pack);
  if (!records.length) {
    await openNativeStatePackForManualSelection(pack);
    ui.notifications?.warn?.("Компендиум государств пуст или ещё не синхронизирован.");
    return null;
  }

  const selectedDocument = await selectNativeStateDocumentWithBrowser();
  if (selectedDocument) {
    return importNativeStateDocumentToActor(actor, selectedDocument);
  }

  if (getCompendiumBrowserClass()?.selectOne) {
    return null;
  }

  if (typeof Dialog !== "function") {
    await openNativeStatePackForManualSelection(pack);
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    };
    const beginAsyncFinish = () => {
      if (settled) {
        return false;
      }

      settled = true;
      return true;
    };

    const dialog = new Dialog({
      title: localizeWithFallback(NATIVE_STATE_SELECT_TITLE_KEY, "Выбор родного государства"),
      content: buildNativeStateSelectionContent(records),
      buttons: {
        select: {
          label: localizeWithFallback(NATIVE_STATE_SELECT_BUTTON_KEY, "Выбрать"),
          callback: async (html) => {
            if (!beginAsyncFinish()) {
              return;
            }

            try {
              const select = queryDialogElement(html, "select[name='stateId']");
              const stateId = cleanString(select?.value);
              const document = stateId ? await pack.getDocument(stateId) : null;
              const item = await importNativeStateDocumentToActor(actor, document);
              resolve(item);
            }
            catch (error) {
              console.error(`${MODULE_ID} | Failed to import native state item.`, error);
              ui.notifications?.error?.("Rebreya: не удалось добавить государство.");
              resolve(null);
            }
          }
        },
        cancel: {
          label: game.i18n?.localize?.("Cancel") ?? "Cancel",
          callback: () => finish(null)
        }
      },
      default: "select",
      close: () => finish(null)
    });

    dialog.render(true);
  });
}

async function handleNativeStateAction(event, app) {
  const target = event.target?.closest?.("[data-rebreya-native-state-action]");
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const actor = getActorFromSheetApp(app);
  if (!actor || actor.type !== "character") {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const action = target.dataset.rebreyaNativeStateAction;
  if (action === "open") {
    const item = actor.items.get(target.dataset.stateItemId) ?? getPrimaryNativeStateItem(actor);
    await openNativeStateItemSheet(item);
    return;
  }

  if (action === "select") {
    if (!actor.isOwner) {
      return;
    }

    try {
      const item = await selectNativeStateForActor(actor);
      if (item) {
        await openNativeStateItemSheet(item);
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to select native state item.`, error);
      ui.notifications?.error?.("Rebreya: не удалось выбрать государство.");
    }
  }
}

function bindNativeStateCard(root, app) {
  const actor = getActorFromSheetApp(app);
  if (!actor || actor.type !== "character") {
    return;
  }

  root.querySelectorAll("[data-rebreya-native-state='true']").forEach((node) => node.remove());
  removeSystemRenderedNativeStateCards(root, actor);
  void repairNativeStateBackgroundReference(actor);

  const container = getNativeStateDetailsPillContainer(root);
  if (!container) {
    return;
  }

  const item = getPrimaryNativeStateItem(actor);
  const entry = item
    ? buildNativeStateItemCard(item)
    : (actor.isOwner ? buildNativeStateEmptyCard(true) : null);
  if (!entry) {
    return;
  }

  const anchor = findNativeStateInsertionAnchor(container);
  if (anchor) {
    anchor.after(entry);
  }
  else {
    container.append(entry);
  }

  if (root.dataset.rebreyaNativeStateBound !== "true") {
    root.dataset.rebreyaNativeStateBound = "true";
    root.addEventListener("click", (event) => {
      handleNativeStateAction(event, app);
    });
    root.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) {
        return;
      }

      const target = event.target?.closest?.("[data-rebreya-native-state-action]");
      if (target instanceof HTMLElement) {
        handleNativeStateAction(event, app);
      }
    });
  }
}

function setElementClassState(element, className, active) {
  if (!(element instanceof HTMLElement) || !className) {
    return;
  }

  if (active) {
    element.classList.add(className);
  }
  else {
    element.classList.remove(className);
  }
}

function clearElementChildren(element) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  if (typeof element.replaceChildren === "function") {
    element.replaceChildren();
    return;
  }

  element.children = [];
}

function getCharacterSheetConditionsList(root) {
  const conditionsList = root?.querySelector?.(".effects-element .conditions-list") ?? null;
  return conditionsList instanceof HTMLElement ? conditionsList : null;
}

function getSheetCombatStatusDefinitions(moduleApi) {
  const definitions = typeof moduleApi?.getCombatStatusDefinitions === "function"
    ? moduleApi.getCombatStatusDefinitions()
    : moduleApi?.combatStatusService?.getStatusDefinitions?.();
  return Array.isArray(definitions) ? definitions : [];
}

function getSheetCombatStatusState(moduleApi, actor, statusId) {
  const status = typeof moduleApi?.getCombatStatus === "function"
    ? moduleApi.getCombatStatus(actor, statusId)
    : moduleApi?.combatStatusService?.getStatus?.(actor, statusId);
  return status && typeof status === "object"
    ? status
    : { active: false, value: null, meta: {}, effectId: null };
}

function canInteractWithCharacterCombatStatuses(app, actor, root = null) {
  if (actor instanceof Actor && typeof actor.isOwner === "boolean") {
    return actor.isOwner;
  }

  return isSheetEditable(app, root);
}

function createSheetCombatStatusIcon(iconPath) {
  const icon = document.createElement("div");
  icon.classList.add("icon");

  const glyph = document.createElement("dnd5e-icon");
  glyph.setAttribute("src", String(iconPath ?? ""));
  icon.append(glyph);
  return icon;
}

function applySheetConditionPresentation(entry, presentation) {
  if (!(entry instanceof HTMLElement) || !presentation) {
    return;
  }

  entry.dataset.uuid = "";
  entry.dataset.tooltip = presentation.tooltipHtml ?? "";
  entry.dataset.tooltipClass = "dnd5e2 dnd5e-tooltip item-tooltip themed theme-light";
  entry.dataset.tooltipDirection = "LEFT";
  entry.classList.remove("content-link");

  const title = entry.querySelector?.(".name-stacked .title");
  if (!(title instanceof HTMLElement)) {
    return;
  }

  title.textContent = String(presentation.label ?? "").trim();
  title.setAttribute("lang", "ru");
  setElementClassState(title, "rm-sheet-status-title--compact", presentation.compactLabel === true);
}

function createSheetCombatStatusTitle(label, presentation = null) {
  const stack = document.createElement("div");
  stack.classList.add("name-stacked");

  const title = document.createElement("span");
  title.classList.add("title");
  title.textContent = String(presentation?.label ?? label ?? "").trim();
  title.setAttribute("lang", "ru");
  setElementClassState(title, "rm-sheet-status-title--compact", presentation?.compactLabel === true);
  stack.append(title);
  return stack;
}

async function applySheetCombatStatusValue(moduleApi, actor, statusId, rawValue) {
  const numericValue = Number(rawValue ?? "");
  if (!String(rawValue ?? "").trim() || !Number.isFinite(numericValue) || numericValue <= 0) {
    if (typeof moduleApi?.clearCombatStatus === "function") {
      await moduleApi.clearCombatStatus(actor, statusId);
    }
    else {
      await moduleApi?.combatStatusService?.clearStatus?.(actor, statusId);
    }
    return;
  }

  const nextValue = Math.max(1, Math.floor(numericValue));
  if (typeof moduleApi?.setCombatStatusValue === "function") {
    await moduleApi.setCombatStatusValue(actor, statusId, nextValue);
  }
  else {
    await moduleApi?.combatStatusService?.setStatusValue?.(actor, statusId, nextValue);
  }
}

function createSheetCombatStatusValueControl(moduleApi, actor, definition, statusState, editable) {
  const wrapper = document.createElement("div");
  wrapper.classList.add("rm-sheet-status-value");

  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.step = "1";
  input.inputMode = "numeric";
  input.classList.add("rm-sheet-status-value-input");
  input.dataset.rebreyaCombatStatusInput = "true";
  input.disabled = !editable;
  input.value = statusState?.active && statusState?.value !== null && statusState?.value !== undefined
    ? String(statusState.value)
    : "";
  input.placeholder = statusState?.active ? String(statusState?.value ?? "") : "";

  input.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  input.addEventListener("change", (event) => {
    void (async () => {
      try {
        await applySheetCombatStatusValue(moduleApi, actor, definition.id, event.currentTarget?.value ?? "");
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to update character sheet combat status value.`, error);
        ui.notifications?.error("Не удалось обновить состояние на листе персонажа.");
      }
    })();
  });

  wrapper.append(input);
  return wrapper;
}

function createSheetCombatStatusToggleIndicator(active) {
  const icon = document.createElement("i");
  icon.classList.add("fa-solid", active ? "fa-toggle-on" : "fa-toggle-off");
  return icon;
}

function buildSheetCombatStatusRow(moduleApi, actor, definition, statusState, editable, row = null) {
  const entry = row instanceof HTMLElement ? row : document.createElement("li");
  const presentation = getDnd5eSheetStatusPresentation(definition?.id, {
    label: definition?.label,
    icon: definition?.icon,
    supportsValue: definition?.supportsValue === true
  });
  entry.dataset.conditionId = String(definition?.id ?? "").trim();
  entry.dataset.rebreyaCombatStatusId = String(definition?.id ?? "").trim();
  entry.dataset.action = "";
  entry.dataset.uuid = "";
  entry.dataset.tooltip = presentation?.tooltipHtml ?? "";
  entry.dataset.tooltipClass = "dnd5e2 dnd5e-tooltip item-tooltip themed theme-light";
  entry.dataset.tooltipDirection = "LEFT";

  if (!(row instanceof HTMLElement)) {
    entry.dataset.rebreyaCombatStatus = "true";
  }
  else {
    entry.dataset.rebreyaCombatStatusNative = "true";
  }

  entry.classList.add("condition", "rm-sheet-status");
  entry.classList.remove("content-link");
  setElementClassState(entry, "active", statusState?.active === true);
  setElementClassState(entry, "rm-sheet-status--valued", definition?.supportsValue === true);

  clearElementChildren(entry);
  entry.append(
    createSheetCombatStatusIcon(definition?.icon),
    createSheetCombatStatusTitle(definition?.label, presentation)
  );

  if (definition?.supportsValue) {
    entry.append(createSheetCombatStatusValueControl(moduleApi, actor, definition, statusState, editable));
    return entry;
  }

  entry.append(createSheetCombatStatusToggleIndicator(statusState?.active === true));

  if (editable) {
    entry.tabIndex = 0;
    entry.setAttribute("role", "button");
    const toggleStatus = () => {
      void (async () => {
        try {
          if (statusState?.active) {
            if (typeof moduleApi?.clearCombatStatus === "function") {
              await moduleApi.clearCombatStatus(actor, definition.id);
            }
            else {
              await moduleApi?.combatStatusService?.clearStatus?.(actor, definition.id);
            }
          }
          else if (typeof moduleApi?.setCombatStatus === "function") {
            await moduleApi.setCombatStatus(actor, definition.id, { active: true });
          }
          else {
            await moduleApi?.combatStatusService?.setStatus?.(actor, definition.id, { active: true });
          }
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to toggle character sheet combat status.`, error);
          ui.notifications?.error("Не удалось обновить состояние на листе персонажа.");
        }
      })();
    };

    entry.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleStatus();
    });
    entry.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      toggleStatus();
    });
  }

  return entry;
}

function enhanceCharacterSheetConditionRows(rows) {
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) {
      continue;
    }

    const statusId = String(row.dataset?.conditionId ?? "").trim();
    if (!statusId) {
      continue;
    }

    const title = row.querySelector?.(".name-stacked .title");
    const label = title instanceof HTMLElement ? String(title.textContent ?? "").trim() : statusId;
    const iconPath = row.querySelector?.("dnd5e-icon")?.getAttribute?.("src") ?? "";
    const presentation = getDnd5eSheetStatusPresentation(statusId, {
      label,
      icon: iconPath,
      supportsValue: row.classList?.contains?.("rm-sheet-status--valued") === true
    });
    applySheetConditionPresentation(row, presentation);
  }
}

function bindCharacterCombatStatusPanel(root, app, moduleApi) {
  const actor = getActorFromSheetApp(app);
  if (!actor || actor.type !== "character") {
    return;
  }

  const conditionsList = getCharacterSheetConditionsList(root);
  if (!conditionsList) {
    return;
  }

  root.querySelectorAll("[data-rebreya-combat-status='true']").forEach((node) => node.remove());
  const editable = canInteractWithCharacterCombatStatuses(app, actor, root);
  const definitions = getSheetCombatStatusDefinitions(moduleApi);
  if (!definitions.length) {
    enhanceCharacterSheetConditionRows(Array.from(conditionsList.children ?? []).filter((node) => node instanceof HTMLElement));
    return;
  }

  const existingRows = Array.from(conditionsList.children ?? []).filter((node) => node instanceof HTMLElement);
  for (const definition of definitions) {
    const statusId = String(definition?.id ?? "").trim();
    if (!statusId) {
      continue;
    }

    const statusState = getSheetCombatStatusState(moduleApi, actor, statusId);
    const nativeRow = existingRows.find((node) => String(node.dataset?.conditionId ?? "").trim() === statusId) ?? null;
    const row = buildSheetCombatStatusRow(moduleApi, actor, definition, statusState, editable, nativeRow);
    if (!(nativeRow instanceof HTMLElement)) {
      conditionsList.append(row);
    }
  }

  enhanceCharacterSheetConditionRows(Array.from(conditionsList.children ?? []).filter((node) => node instanceof HTMLElement));
}

function buildHeroDollTabState(app) {
  const active = app.tabGroups?.primary === HERO_DOLL_TAB_ID;
  return {
    id: HERO_DOLL_TAB_ID,
    tab: HERO_DOLL_TAB_ID,
    group: "primary",
    label: HERO_DOLL_TAB_LABEL,
    icon: HERO_DOLL_TAB_ICON,
    active,
    cssClass: active ? "active" : ""
  };
}

function buildCharacterDowntimeTabState(app) {
  const active = app.tabGroups?.primary === CHARACTER_DOWNTIME_TAB_ID;
  return {
    id: CHARACTER_DOWNTIME_TAB_ID,
    tab: CHARACTER_DOWNTIME_TAB_ID,
    group: "primary",
    label: CHARACTER_DOWNTIME_TAB_LABEL,
    icon: CHARACTER_DOWNTIME_TAB_ICON,
    active,
    cssClass: active ? "active" : ""
  };
}

function buildItemModsTabState(app) {
  const active = app.tabGroups?.primary === ITEM_MODS_TAB_ID;
  return {
    id: ITEM_MODS_TAB_ID,
    tab: ITEM_MODS_TAB_ID,
    group: "primary",
    label: ITEM_MODS_TAB_LABEL,
    active,
    cssClass: active ? "active" : ""
  };
}

function ensureHeroDollTabDefinition(CharacterActorSheet) {
  if (!Array.isArray(CharacterActorSheet.TABS)) {
    CharacterActorSheet.TABS = [];
  }

  let nextTabs = [...CharacterActorSheet.TABS];
  for (const tabEntry of [
    {
      tab: HERO_DOLL_TAB_ID,
      label: HERO_DOLL_TAB_LABEL,
      icon: HERO_DOLL_TAB_ICON
    },
    {
      tab: CHARACTER_DOWNTIME_TAB_ID,
      label: CHARACTER_DOWNTIME_TAB_LABEL,
      icon: CHARACTER_DOWNTIME_TAB_ICON
    }
  ]) {
    if (nextTabs.some((tab) => tab?.tab === tabEntry.tab)) {
      continue;
    }

    const insertIndex = nextTabs.findIndex((tab) => tab?.tab === "specialTraits");
    if (insertIndex >= 0) {
      nextTabs.splice(insertIndex, 0, tabEntry);
    }
    else {
      nextTabs.push(tabEntry);
    }
  }
  CharacterActorSheet.TABS = nextTabs;

  CharacterActorSheet.PARTS = {
    ...CharacterActorSheet.PARTS,
    [HERO_DOLL_TAB_ID]: {
      classes: ["flexcol"],
      container: { classes: ["tab-body"], id: "tabs" },
      template: HERO_DOLL_TEMPLATE,
      scrollable: [""]
    },
    [CHARACTER_DOWNTIME_TAB_ID]: {
      classes: ["flexcol"],
      container: { classes: ["tab-body"], id: "tabs" },
      template: CHARACTER_DOWNTIME_TEMPLATE,
      scrollable: [""]
    }
  };
}

function ensureItemModsTabDefinition(ItemSheet5e) {
  if (!Array.isArray(ItemSheet5e?.TABS)) {
    return;
  }

  const nextTabs = [...ItemSheet5e.TABS];
  if (!nextTabs.some((tab) => tab?.tab === ITEM_MODS_TAB_ID)) {
    const tabEntry = {
      tab: ITEM_MODS_TAB_ID,
      label: ITEM_MODS_TAB_LABEL,
      condition: (item) => isItemUpgradeHostItem(item)
    };
    const effectsIndex = nextTabs.findIndex((tab) => tab?.tab === "effects");
    const advancementIndex = nextTabs.findIndex((tab) => tab?.tab === "advancement");
    if (effectsIndex >= 0) {
      nextTabs.splice(effectsIndex + 1, 0, tabEntry);
    }
    else if (advancementIndex >= 0) {
      nextTabs.splice(advancementIndex, 0, tabEntry);
    }
    else {
      nextTabs.push(tabEntry);
    }
  }
  ItemSheet5e.TABS = nextTabs;

  ItemSheet5e.PARTS = {
    ...(ItemSheet5e.PARTS ?? {}),
    [ITEM_MODS_TAB_ID]: {
      template: ITEM_MODS_TEMPLATE,
      scrollable: [""]
    }
  };
}

function patchItemModsPartContext(ItemSheet5e) {
  if (!ItemSheet5e?.prototype || ItemSheet5e.prototype[ITEM_MODS_PATCH_FLAG]) {
    return;
  }

  const originalPreparePartContext = ItemSheet5e.prototype._preparePartContext;
  if (!(originalPreparePartContext instanceof Function)) {
    return;
  }

  ItemSheet5e.prototype._preparePartContext = async function (partId, context, options) {
    const prepared = await originalPreparePartContext.call(this, partId, context, options);
    if (partId !== ITEM_MODS_TAB_ID) {
      return prepared;
    }

    const tab = prepared.tabs?.[ITEM_MODS_TAB_ID] ?? buildItemModsTabState(this);
    return {
      ...prepared,
      tab,
      itemUpgradeTab: tab,
      itemUpgradePanelHtml: createItemUpgradePanelHtml(this.item ?? this.document)
    };
  };

  Object.defineProperty(ItemSheet5e.prototype, ITEM_MODS_PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true
  });
}

function patchHeroDollPartContext(CharacterActorSheet, moduleApi) {
  if (CharacterActorSheet.prototype[HERO_DOLL_PATCH_FLAG]) {
    return;
  }

  const originalPreparePartContext = CharacterActorSheet.prototype._preparePartContext;
  CharacterActorSheet.prototype._preparePartContext = async function (partId, context, options) {
    const prepared = await originalPreparePartContext.call(this, partId, context, options);
    const preparedWithFeatGroups = partId === "features"
      ? await splitRebreyaFeatSectionsInContext(prepared)
      : prepared;
    if (partId !== HERO_DOLL_TAB_ID && partId !== CHARACTER_DOWNTIME_TAB_ID) {
      return preparedWithFeatGroups;
    }

    if (partId === CHARACTER_DOWNTIME_TAB_ID) {
      const tab = buildCharacterDowntimeTabState(this);
      const formState = await prepareCharacterDowntimeFormState(
        this.actor,
        characterDowntimeFormStateByActorId.get(this.actor?.id) ?? {},
        moduleApi.characterDowntimeService
      );
      if (this.actor?.id) {
        characterDowntimeFormStateByActorId.set(this.actor.id, formState);
      }
      return {
        ...preparedWithFeatGroups,
        tab,
        characterDowntimeTab: tab,
        characterDowntime: moduleApi.characterDowntimeService.getActorContext(this.actor, formState)
      };
    }

    const tab = buildHeroDollTabState(this);
    return {
      ...preparedWithFeatGroups,
      tab,
      heroDollTab: tab,
      heroDoll: moduleApi.heroDollService.getActorSnapshot(this.actor)
    };
  };

  Object.defineProperty(CharacterActorSheet.prototype, HERO_DOLL_PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true
  });
}

function patchActorMoveDropBehavior() {
  const BaseActorSheet = game.dnd5e?.applications?.actor?.BaseActorSheet ?? null;
  if (!BaseActorSheet?.prototype || BaseActorSheet.prototype[HERO_DOLL_MOVE_DROP_PATCH_FLAG]) {
    return;
  }

  const originalOnDropItem = BaseActorSheet.prototype._onDropItem;
  if (typeof originalOnDropItem !== "function") {
    return;
  }

  BaseActorSheet.prototype._onDropItem = async function (event, item) {
    const sourceActor = item?.parent instanceof Actor ? item.parent : null;
    const targetActor = this.inventorySource instanceof Actor
      ? this.inventorySource
      : getActorFromSheetApp(this);

    if (
      sourceActor instanceof Actor
      && targetActor instanceof Actor
      && sourceActor.isOwner
      && targetActor.isOwner
      && event?._behavior !== "move"
    ) {
      event._behavior = "move";
    }

    return originalOnDropItem.call(this, event, item);
  };

  Object.defineProperty(BaseActorSheet.prototype, HERO_DOLL_MOVE_DROP_PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true
  });
}

function patchDnd5eDragPayloadFallback() {
  const DragDropClass = CONFIG?.ux?.DragDrop ?? null;
  if (!DragDropClass?.getPayload || DragDropClass[HERO_DOLL_PAYLOAD_PATCH_FLAG]) {
    return;
  }

  const originalGetPayload = DragDropClass.getPayload;
  DragDropClass.getPayload = function (event) {
    const payload = originalGetPayload.call(this, event);
    if (payload && typeof payload === "object") {
      return payload;
    }

    for (const mimeType of HERO_DOLL_DROP_MIME_TYPES) {
      const parsed = parseDropDataRaw(event?.dataTransfer?.getData?.(mimeType));
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }

    const uriParsed = parseDropDataRaw(event?.dataTransfer?.getData?.("text/uri-list"));
    if (uriParsed && typeof uriParsed === "object") {
      return uriParsed;
    }

    return payload;
  };

  Object.defineProperty(DragDropClass, HERO_DOLL_PAYLOAD_PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true
  });
}

function getHeroicRollButtonLabels() {
  const fallbackAdvantage = "ГЕРОИЧ. ПРЕИМУЩЕСТВО";
  const fallbackDisadvantage = "ГЕРОИЧ. ПОМЕХА";
  return {
    heroicAdvantage: game.i18n?.localize?.("REBREYA_MAIN.Combat.HeroicAdvantageButton") || fallbackAdvantage,
    heroicDisadvantage: game.i18n?.localize?.("REBREYA_MAIN.Combat.HeroicDisadvantageButton") || fallbackDisadvantage
  };
}

function applyHeroicD20RollModifiers(roll, D20Roll) {
  const heroicMode = String(roll?.options?.rebreyaHeroicMode ?? "").trim().toLowerCase();
  if (!roll?.validD20Roll || !["advantage", "disadvantage"].includes(heroicMode)) {
    return;
  }

  const modifiers = Array.isArray(roll.d20?.modifiers) ? roll.d20.modifiers : null;
  if (!modifiers) {
    return;
  }

  const existingModifierIndex = modifiers.findIndex((modifier) => ["kh", "kl"].includes(modifier));
  if (existingModifierIndex >= 0) {
    modifiers.splice(existingModifierIndex, 1);
  }

  roll.d20.number = 3;
  modifiers.push(heroicMode === "advantage" ? "kh" : "kl");
  roll.resetFormula();
}

function registerHeroicD20RollConfigureModifiersPatch(D20Roll) {
  if (D20Roll.prototype[HEROIC_D20_ROLL_PATCH_FLAG]) {
    return;
  }

  const libWrapper = globalThis.libWrapper;
  if (typeof libWrapper?.register === "function") {
    try {
      libWrapper.register(
        MODULE_ID,
        "CONFIG.Dice.D20Roll.prototype.configureModifiers",
        function configureRebreyaHeroicD20Roll(wrapped, ...args) {
          const result = wrapped(...args);
          applyHeroicD20RollModifiers(this, D20Roll);
          return result;
        },
        "WRAPPER"
      );

      Object.defineProperty(D20Roll.prototype, HEROIC_D20_ROLL_PATCH_FLAG, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: "libWrapper"
      });
      return;
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to register heroic d20 libWrapper patch; falling back to direct patch.`, error);
    }
  }

  const originalConfigureModifiers = D20Roll.prototype.configureModifiers;

  D20Roll.prototype.configureModifiers = function (...args) {
    const result = originalConfigureModifiers.call(this, ...args);
    applyHeroicD20RollModifiers(this, D20Roll);
    return result;
  };

  Object.defineProperty(D20Roll.prototype, HEROIC_D20_ROLL_PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: "direct"
  });
}

function patchD20HeroicRollDialog() {
  const D20Roll = CONFIG?.Dice?.D20Roll ?? null;
  const D20Dialog = game.dnd5e?.applications?.dice?.D20RollConfigurationDialog ?? null;
  if (!D20Roll?.prototype || !D20Dialog?.prototype) {
    return;
  }

  if (!D20Dialog.prototype[HEROIC_D20_DIALOG_PATCH_FLAG]) {
    const originalPrepareButtonsContext = D20Dialog.prototype._prepareButtonsContext;
    const originalFinalizeRolls = D20Dialog.prototype._finalizeRolls;

    D20Dialog.prototype._prepareButtonsContext = async function (context, options) {
      const preparedContext = await originalPrepareButtonsContext.call(this, context, options);
      const labels = getHeroicRollButtonLabels();

      const sourceButtons = preparedContext?.buttons ?? {};
      const advantageButton = sourceButtons.advantage ?? {
        default: false,
        label: game.i18n.localize("DND5E.Advantage")
      };
      const normalButton = sourceButtons.normal ?? {
        default: true,
        label: game.i18n.localize("DND5E.Normal")
      };
      const disadvantageButton = sourceButtons.disadvantage ?? {
        default: false,
        label: game.i18n.localize("DND5E.Disadvantage")
      };

      const buttons = {
        advantage: { ...advantageButton },
        normal: { ...normalButton },
        disadvantage: { ...disadvantageButton },
        [HEROIC_ADVANTAGE_ACTION]: {
          default: false,
          label: labels.heroicAdvantage
        },
        [HEROIC_DISADVANTAGE_ACTION]: {
          default: false,
          label: labels.heroicDisadvantage
        }
      };

      // Ensure exactly one button keeps autofocus.
      if (buttons.advantage.default || buttons.disadvantage.default || buttons.normal.default) {
        buttons[HEROIC_ADVANTAGE_ACTION].default = false;
        buttons[HEROIC_DISADVANTAGE_ACTION].default = false;
      }
      else {
        buttons.normal.default = true;
      }

      preparedContext.buttons = buttons;
      return preparedContext;
    };

    D20Dialog.prototype._finalizeRolls = function (action) {
      if (![HEROIC_ADVANTAGE_ACTION, HEROIC_DISADVANTAGE_ACTION].includes(action)) {
        for (const roll of this.rolls ?? []) {
          if (roll?.options && Object.hasOwn(roll.options, "rebreyaHeroicMode")) {
            delete roll.options.rebreyaHeroicMode;
          }
        }
        return originalFinalizeRolls.call(this, action);
      }

      const heroicMode = action === HEROIC_ADVANTAGE_ACTION ? "advantage" : "disadvantage";
      const advantageMode = heroicMode === "advantage"
        ? D20Roll.ADV_MODE.ADVANTAGE
        : D20Roll.ADV_MODE.DISADVANTAGE;

      return this.rolls.map((roll) => {
        roll.options.advantageMode = advantageMode;
        roll.options.rebreyaHeroicMode = heroicMode;
        roll.configureModifiers();
        return roll;
      });
    };

    Object.defineProperty(D20Dialog.prototype, HEROIC_D20_DIALOG_PATCH_FLAG, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: true
    });
  }

  registerHeroicD20RollConfigureModifiersPatch(D20Roll);

  if (!D20Roll[HEROIC_D20_KEYBINDINGS_PATCH_FLAG]) {
    const originalApplyKeybindings = D20Roll.applyKeybindings;

    D20Roll.applyKeybindings = function (config = {}, dialog = {}, message = {}) {
      const outcome = originalApplyKeybindings.call(this, config, dialog, message);
      const event = config?.event ?? null;
      const shift = Boolean(event?.shiftKey);
      const alt = Boolean(event?.altKey);
      const ctrlOrMeta = Boolean(event?.ctrlKey || event?.metaKey);

      let heroicMode = "";
      if (shift && alt && !ctrlOrMeta) {
        heroicMode = "advantage";
      }
      else if (shift && ctrlOrMeta && !alt) {
        heroicMode = "disadvantage";
      }

      for (const roll of config?.rolls ?? []) {
        roll.options ??= {};

        if (heroicMode === "advantage") {
          roll.options.advantageMode = D20Roll.ADV_MODE.ADVANTAGE;
          roll.options.rebreyaHeroicMode = "advantage";
        }
        else if (heroicMode === "disadvantage") {
          roll.options.advantageMode = D20Roll.ADV_MODE.DISADVANTAGE;
          roll.options.rebreyaHeroicMode = "disadvantage";
        }
        else if (Object.hasOwn(roll.options, "rebreyaHeroicMode")) {
          delete roll.options.rebreyaHeroicMode;
        }
      }

      if (heroicMode) {
        dialog.configure = false;
      }

      return outcome;
    };

    Object.defineProperty(D20Roll, HEROIC_D20_KEYBINDINGS_PATCH_FLAG, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: true
    });
  }
}

function setItemDragData(event, itemUuid) {
  if (!itemUuid || !event?.dataTransfer) {
    return;
  }

  event.dataTransfer.effectAllowed = "all";
  const payload = JSON.stringify({
    type: "Item",
    uuid: itemUuid
  });

  for (const mimeType of [...HERO_DOLL_DROP_MIME_TYPES, "text/uri-list"]) {
    try {
      event.dataTransfer.setData(mimeType, payload);
    }
    catch (_error) {
      // ignore unsupported mime types
    }
  }

  activeHeroDollDragData = {
    type: "Item",
    uuid: itemUuid
  };
}

function resolvePreferredDropEffect(dataTransfer, preferred = "move") {
  const effectAllowed = String(dataTransfer?.effectAllowed ?? "").trim().toLowerCase();
  if (!effectAllowed || effectAllowed === "all" || effectAllowed === "uninitialized") {
    return preferred;
  }

  const allows = (effect) => effectAllowed === effect || effectAllowed.includes(effect);
  if (preferred && allows(preferred)) {
    return preferred;
  }

  if (allows("copy")) {
    return "copy";
  }

  if (allows("move")) {
    return "move";
  }

  if (allows("link")) {
    return "link";
  }

  return "none";
}

function parseDropDataRaw(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }
  catch (_error) {
    if (/^(Actor|Compendium|Item)\./u.test(String(rawValue))) {
      return {
        type: "Item",
        uuid: String(rawValue).trim()
      };
    }
  }

  return null;
}

function getHeroDollDropData(event) {
  try {
    const dragData = TextEditor.getDragEventData(event);
    if (dragData && typeof dragData === "object" && dragData.uuid) {
      return dragData;
    }
  }
  catch (_error) {
    // fallback to raw dataTransfer parsing
  }

  for (const mimeType of HERO_DOLL_DROP_MIME_TYPES) {
    const parsed = parseDropDataRaw(event?.dataTransfer?.getData?.(mimeType));
    if (parsed?.uuid) {
      return parsed;
    }
  }

  const uriParsed = parseDropDataRaw(event?.dataTransfer?.getData?.("text/uri-list"));
  if (uriParsed?.uuid) {
    return uriParsed;
  }

  return activeHeroDollDragData ? foundry.utils.deepClone(activeHeroDollDragData) : {};
}

function getCharacterDowntimeDropData(event) {
  return getHeroDollDropData(event);
}

function getItemPriceGold(item) {
  const direct = toOptionalFiniteNumber(item?.priceGold);
  if (direct !== undefined) {
    return direct;
  }

  for (const path of [
    `flags.${MODULE_ID}.priceGold`,
    `flags.${MODULE_ID}.magicItem.priceGold`,
    "system.price.value",
    "system.price"
  ]) {
    const value = foundry.utils.getProperty?.(item, path);
    const numeric = typeof value === "object" && value !== null
      ? toOptionalFiniteNumber(value.value)
      : toOptionalFiniteNumber(value);
    if (numeric !== undefined) {
      return numeric;
    }
  }

  return undefined;
}

function normalizeCharacterDowntimeLookupKey(value = "") {
  return normalizeLookupText(value)
    .replace(/ё/gu, "е")
    .replace(/[^a-zа-я0-9+-]+/giu, "");
}

const CHARACTER_DOWNTIME_BARGAINING_OPTION_ID_BY_TEXT = Object.freeze({
  [normalizeCharacterDowntimeLookupKey("Запрещённые")]: "forbidden",
  [normalizeCharacterDowntimeLookupKey("Запрещенные")]: "forbidden",
  [normalizeCharacterDowntimeLookupKey("Невозможные")]: "impossible",
  [normalizeCharacterDowntimeLookupKey("Провальные")]: "failed",
  [normalizeCharacterDowntimeLookupKey("Невыгодные")]: "bad",
  [normalizeCharacterDowntimeLookupKey("Нормальные")]: "normal",
  [normalizeCharacterDowntimeLookupKey("Выгодные")]: "favorable",
  [normalizeCharacterDowntimeLookupKey("Удачные")]: "good"
});

const CHARACTER_DOWNTIME_RARITY_KEY_BY_TEXT = Object.freeze({
  [normalizeCharacterDowntimeLookupKey("Обычный")]: "common",
  [normalizeCharacterDowntimeLookupKey("Обычная")]: "common",
  [normalizeCharacterDowntimeLookupKey("common")]: "common",
  [normalizeCharacterDowntimeLookupKey("Необычный")]: "uncommon",
  [normalizeCharacterDowntimeLookupKey("Необычная")]: "uncommon",
  [normalizeCharacterDowntimeLookupKey("uncommon")]: "uncommon",
  [normalizeCharacterDowntimeLookupKey("Редкий")]: "rare",
  [normalizeCharacterDowntimeLookupKey("Редкая")]: "rare",
  [normalizeCharacterDowntimeLookupKey("rare")]: "rare",
  [normalizeCharacterDowntimeLookupKey("Очень редкий")]: "veryRare",
  [normalizeCharacterDowntimeLookupKey("Очень редкая")]: "veryRare",
  [normalizeCharacterDowntimeLookupKey("veryRare")]: "veryRare",
  [normalizeCharacterDowntimeLookupKey("very rare")]: "veryRare",
  [normalizeCharacterDowntimeLookupKey("Легендарный")]: "legendary",
  [normalizeCharacterDowntimeLookupKey("Легендарная")]: "legendary",
  [normalizeCharacterDowntimeLookupKey("legendary")]: "legendary"
});

function parseCharacterDowntimeRebreyaSignature(value = "") {
  const text = cleanText(value);
  if (!text.startsWith("{")) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }
  catch (_error) {
    return {};
  }
}

function getCharacterDowntimeItemSignatureData(item = {}) {
  const rebreya = item?.rebreya && typeof item.rebreya === "object" && !Array.isArray(item.rebreya) ? item.rebreya : {};
  const flags = item?.documentSnapshot?.flags?.[MODULE_ID] && typeof item.documentSnapshot.flags[MODULE_ID] === "object"
    ? item.documentSnapshot.flags[MODULE_ID]
    : {};
  return {
    ...parseCharacterDowntimeRebreyaSignature(flags.signature),
    ...parseCharacterDowntimeRebreyaSignature(rebreya.signature)
  };
}

function getCharacterDowntimeItemBargaining(item = {}) {
  const rebreya = item?.rebreya && typeof item.rebreya === "object" && !Array.isArray(item.rebreya) ? item.rebreya : {};
  const signature = getCharacterDowntimeItemSignatureData(item);
  return cleanText(item.bargaining)
    || cleanText(item.itemBargaining)
    || cleanText(rebreya.bargaining)
    || cleanText(rebreya.itemBargaining)
    || cleanText(signature.bargaining);
}

function cleanCharacterDowntimeFormulaText(value = "") {
  const text = cleanText(value)
    .replace(/\s*(зм|gp)\.?\s*$/iu, "")
    .trim();
  return text && text !== "-" && text !== "—" ? text : "";
}

function getCharacterDowntimeItemCostFormula(item = {}) {
  const rebreya = item?.rebreya && typeof item.rebreya === "object" && !Array.isArray(item.rebreya) ? item.rebreya : {};
  const signature = getCharacterDowntimeItemSignatureData(item);
  return cleanCharacterDowntimeFormulaText(item.costText)
    || cleanCharacterDowntimeFormulaText(item.itemCost)
    || cleanCharacterDowntimeFormulaText(rebreya.costText)
    || cleanCharacterDowntimeFormulaText(rebreya.itemCost)
    || cleanCharacterDowntimeFormulaText(signature.costText)
    || cleanCharacterDowntimeFormulaText(signature.itemCost);
}

function getCharacterDowntimeItemRarityKey(item = {}) {
  const rebreya = item?.rebreya && typeof item.rebreya === "object" && !Array.isArray(item.rebreya) ? item.rebreya : {};
  const signature = getCharacterDowntimeItemSignatureData(item);
  const rarity = cleanText(item.rarity)
    || cleanText(rebreya.rarity)
    || cleanText(signature.rarity)
    || cleanText(item.documentSnapshot?.system?.rarity);
  return CHARACTER_DOWNTIME_RARITY_KEY_BY_TEXT[normalizeCharacterDowntimeLookupKey(rarity)] || rarity;
}

function parseCharacterDowntimeJsonObject(value) {
  const text = cleanText(value);
  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }
  catch (_error) {
    return {};
  }
}

function cloneCharacterDowntimeValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (foundry.utils?.deepClone) {
    return foundry.utils.deepClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function parseCharacterDowntimeItemSnapshot(value) {
  return parseCharacterDowntimeJsonObject(value);
}

function getCharacterDowntimeRebreyaFlags(item) {
  const flagValue = item?.getFlag?.(MODULE_ID);
  if (flagValue && typeof flagValue === "object" && !Array.isArray(flagValue)) {
    return cloneCharacterDowntimeValue(flagValue);
  }

  const flags = foundry.utils.getProperty?.(item, `flags.${MODULE_ID}`);
  return flags && typeof flags === "object" && !Array.isArray(flags)
    ? cloneCharacterDowntimeValue(flags)
    : {};
}

function buildCharacterDowntimeItemDocumentSnapshot(item) {
  const source = typeof item?.toObject === "function" ? item.toObject() : item;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }

  const snapshot = {};
  for (const key of ["_id", "id", "name", "type", "img", "system", "flags", "effects"]) {
    if (source[key] !== undefined) {
      snapshot[key] = cloneCharacterDowntimeValue(source[key]);
    }
  }
  return snapshot;
}

function normalizeCharacterDowntimeDroppedItem(item, dragData = {}) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const uuid = cleanText(item.uuid) || cleanText(dragData.uuid);
  const id = cleanText(item.id) || cleanText(item._id);
  const name = cleanText(item.name);
  if (!uuid && !id && !name) {
    return null;
  }

  const sourceType = cleanText(item.getFlag?.(MODULE_ID, "sourceType"))
    || cleanText(foundry.utils.getProperty?.(item, `flags.${MODULE_ID}.sourceType`))
    || cleanText(foundry.utils.getProperty?.(item, `flags.${MODULE_ID}.magicItem.sourceType`));
  const rarity = cleanText(foundry.utils.getProperty?.(item, `flags.${MODULE_ID}.magicItem.rarity`))
    || cleanText(foundry.utils.getProperty?.(item, `flags.${MODULE_ID}.rarity`))
    || cleanText(foundry.utils.getProperty?.(item, "system.rarity"));
  const droppedItem = {
    uuid,
    id,
    name: name || "Предмет",
    img: cleanText(item.img) || cleanText(dragData.img),
    type: cleanText(item.type) || cleanText(dragData.type),
    sourceType,
    rarity
  };
  const priceGold = getItemPriceGold(item);
  if (priceGold !== undefined) {
    droppedItem.priceGold = priceGold;
  }
  const rebreya = getCharacterDowntimeRebreyaFlags(item);
  if (Object.keys(rebreya).length) {
    droppedItem.rebreya = rebreya;
    droppedItem.sourceType ||= cleanText(rebreya.sourceType);
    droppedItem.sourceId = cleanText(rebreya.sourceId)
      || cleanText(rebreya.magicItemId)
      || cleanText(rebreya.gearId)
      || cleanText(rebreya.materialId);
    droppedItem.magicItemId = cleanText(rebreya.magicItemId);
    droppedItem.gearId = cleanText(rebreya.gearId);
    droppedItem.materialId = cleanText(rebreya.materialId);
  }
  const documentSnapshot = buildCharacterDowntimeItemDocumentSnapshot(item);
  if (Object.keys(documentSnapshot).length) {
    droppedItem.documentSnapshot = documentSnapshot;
  }
  const signature = getCharacterDowntimeItemSignatureData(droppedItem);
  const costText = cleanText(rebreya.costText)
    || cleanText(rebreya.itemCost)
    || cleanText(signature.costText)
    || cleanText(signature.itemCost);
  if (costText) {
    droppedItem.costText = costText;
    if (droppedItem.rebreya && !cleanText(droppedItem.rebreya.costText)) {
      droppedItem.rebreya.costText = costText;
    }
  }
  return droppedItem;
}

function applyCharacterDowntimeItemChoice(control, item = {}) {
  control.dataset.itemUuid = cleanText(item.uuid);
  control.dataset.itemId = cleanText(item.id);
  control.dataset.itemName = cleanText(item.name);
  control.dataset.itemType = cleanText(item.type);
  control.dataset.itemImg = cleanText(item.img);
  control.dataset.itemSourceType = cleanText(item.sourceType);
  control.dataset.itemRarity = cleanText(item.rarity);
  control.dataset.itemCostText = cleanText(item.costText);
  control.dataset.itemSnapshot = JSON.stringify(item);
  if (item.priceGold !== undefined) {
    control.dataset.itemPriceGold = String(item.priceGold);
  }
  else {
    delete control.dataset.itemPriceGold;
  }

  const label = control.querySelector?.("[data-role='character-downtime-item-choice-label']");
  if (label) {
    label.textContent = cleanText(item.name) || "Выбрать предмет";
  }
  const price = control.querySelector?.("[data-role='character-downtime-item-choice-price']");
  if (price) {
    price.textContent = item.priceGold !== undefined ? `${item.priceGold} зм` : cleanText(item.costText);
  }
  const clearButton = control.querySelector?.("[data-action='character-downtime-clear-item-choice']");
  if (clearButton) {
    clearButton.hidden = false;
  }
  control.classList?.add?.("has-item");
}

function clearCharacterDowntimeItemChoice(control) {
  for (const key of [
    "itemUuid",
    "itemId",
    "itemName",
    "itemType",
    "itemImg",
    "itemSourceType",
    "itemRarity",
    "itemPriceGold",
    "itemCostText",
    "itemSnapshot"
  ]) {
    delete control.dataset[key];
  }

  const label = control.querySelector?.("[data-role='character-downtime-item-choice-label']");
  if (label) {
    label.textContent = cleanText(control.dataset.emptyLabel) || "Перетащите предмет";
  }
  const price = control.querySelector?.("[data-role='character-downtime-item-choice-price']");
  if (price) {
    price.textContent = "";
  }
  const clearButton = control.querySelector?.("[data-action='character-downtime-clear-item-choice']");
  if (clearButton) {
    clearButton.hidden = true;
  }
  control.classList?.remove?.("has-item");
}

function getCharacterDowntimeBargainingOptionId(item = {}, select = null) {
  const bargaining = getCharacterDowntimeItemBargaining(item);
  if (!bargaining) {
    return "";
  }

  const options = Array.from(select?.options ?? []);
  const numericBargaining = toOptionalFiniteNumber(bargaining);
  if (numericBargaining !== undefined) {
    const numericOption = options.find((option) => toOptionalFiniteNumber(option?.dataset?.optionValue) === numericBargaining);
    if (numericOption?.value) {
      return cleanText(numericOption.value);
    }
  }

  const mappedId = CHARACTER_DOWNTIME_BARGAINING_OPTION_ID_BY_TEXT[normalizeCharacterDowntimeLookupKey(bargaining)];
  if (mappedId && (!options.length || options.some((option) => cleanText(option.value) === mappedId))) {
    return mappedId;
  }

  const bargainingKey = normalizeCharacterDowntimeLookupKey(bargaining);
  return cleanText(options.find((option) => normalizeCharacterDowntimeLookupKey(option?.textContent) === bargainingKey)?.value);
}

function resolveCharacterDowntimeFormulaForItem(item = {}, formulaControl = null) {
  const itemFormula = getCharacterDowntimeItemCostFormula(item);
  if (itemFormula) {
    return itemFormula;
  }

  const formulaByRarity = parseCharacterDowntimeJsonObject(formulaControl?.dataset?.formulaByRarity);
  const rarityKey = getCharacterDowntimeItemRarityKey(item);
  return cleanCharacterDowntimeFormulaText(formulaByRarity[rarityKey]);
}

function applyCharacterDowntimeDerivedItemSelections(panel, item = {}, itemControl = null) {
  const itemActionId = cleanText(itemControl?.dataset?.targetActionId);
  const formulaControls = Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-formula-input']") ?? []);
  const relatedFormulaControls = formulaControls.filter((control) => {
    const configuredItemActionId = cleanText(control?.dataset?.itemActionId);
    return !configuredItemActionId || !itemActionId || configuredItemActionId === itemActionId;
  });
  const formulaControl = relatedFormulaControls[0] ?? formulaControls[0] ?? null;
  if (formulaControl) {
    const formula = resolveCharacterDowntimeFormulaForItem(item, formulaControl);
    if (formula) {
      formulaControl.value = formula;
    }
  }

  const tradeActionId = cleanText(formulaControl?.dataset?.tradeStepActionId) || "magic-item-purchase-trade-step";
  const optionControls = Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-option-choice']") ?? []);
  const tradeControl = optionControls.find((control) => cleanText(control?.dataset?.targetActionId) === tradeActionId)
    ?? optionControls[0]
    ?? null;
  if (tradeControl) {
    const optionId = getCharacterDowntimeBargainingOptionId(item, tradeControl);
    if (optionId) {
      tradeControl.value = optionId;
    }
  }
}

function clearCharacterDowntimeDerivedItemSelections(panel, itemControl = null) {
  const itemActionId = cleanText(itemControl?.dataset?.targetActionId);
  const formulaControls = Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-formula-input']") ?? []);
  const relatedFormulaControls = formulaControls.filter((control) => {
    const configuredItemActionId = cleanText(control?.dataset?.itemActionId);
    return !configuredItemActionId || !itemActionId || configuredItemActionId === itemActionId;
  });
  const affectedFormulaControls = relatedFormulaControls.length ? relatedFormulaControls : formulaControls;
  const tradeActionIds = new Set();
  for (const control of affectedFormulaControls) {
    const tradeActionId = cleanText(control?.dataset?.tradeStepActionId);
    if (tradeActionId) {
      tradeActionIds.add(tradeActionId);
    }
    control.value = "";
  }

  if (!tradeActionIds.size) {
    tradeActionIds.add("magic-item-purchase-trade-step");
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-option-choice']") ?? [])) {
    if (tradeActionIds.has(cleanText(control?.dataset?.targetActionId))) {
      control.value = "";
    }
  }
}

async function handleCharacterDowntimeItemChoiceDrop(event, control, panel, app, moduleApi) {
  event.preventDefault?.();
  event.stopPropagation?.();

  const dragData = getCharacterDowntimeDropData(event);
  const uuid = cleanText(dragData?.uuid);
  if (!uuid || typeof fromUuid !== "function") {
    throw new Error("Перетащенный предмет не найден.");
  }

  const document = await fromUuid(uuid);
  const item = normalizeCharacterDowntimeDroppedItem(document, dragData);
  if (!item) {
    throw new Error("Можно перетащить только предмет Foundry.");
  }

  applyCharacterDowntimeItemChoice(control, item);
  applyCharacterDowntimeDerivedItemSelections(panel, item, control);
  const actor = getActorFromSheetApp(app);
  if (actor?.id) {
    updateCharacterDowntimeFormState(actor, {
      targetActionSelections: readCharacterDowntimeTargetActionSelections(panel)
    });
    await rerenderActorSheet(app, moduleApi);
  }
}

async function rerenderActorSheet(app, moduleApi) {
  try {
    await app.render({ force: true });
  }
  catch (_error) {
    await app.render(true);
  }
}

function parseAllowedSlots(value) {
  return normalizeHeroDollSlots(
    String(value ?? "")
      .split(/[,\s|;]+/u)
      .map((entry) => entry.trim())
      .filter(Boolean),
    []
  );
}

function setHeroDollDragHighlight(panel, slotIds = []) {
  const allowed = new Set(normalizeHeroDollSlots(slotIds, []));
  const hasAllowed = allowed.size > 0;

  panel.querySelectorAll("[data-hero-doll-slot='true']").forEach((slotButton) => {
    const slotId = String(slotButton.dataset.slotId ?? "").trim();
    const isAllowed = hasAllowed && allowed.has(slotId);
    slotButton.classList.toggle("is-target", isAllowed);
    slotButton.classList.toggle("is-dimmed", hasAllowed && !isAllowed);
  });
}

function clearHeroDollDragHighlight(panel) {
  panel.querySelectorAll("[data-hero-doll-slot='true']").forEach((slotButton) => {
    slotButton.classList.remove("is-target", "is-dimmed");
  });
}

function getHeroDollPanelFromEvent(root, event) {
  const candidate = event?.target?.closest?.(`.rm-hero-doll-tab[data-tab='${HERO_DOLL_TAB_ID}']`);
  if (!(candidate instanceof HTMLElement) || !root.contains(candidate)) {
    return null;
  }

  return candidate;
}

function bindHeroDollSlotListeners(panel, app, moduleApi, listenerOptions = undefined) {
  const actor = getActorFromSheetApp(app);
  if (!actor) {
    return;
  }

  panel.querySelectorAll("[data-hero-doll-slot='true']").forEach((slot) => {
    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = resolvePreferredDropEffect(event.dataTransfer, "move");
      }
      slot.classList.add("is-dragover");
    }, listenerOptions);

    slot.addEventListener("dragleave", (event) => {
      event.stopPropagation();
      slot.classList.remove("is-dragover");
    }, listenerOptions);

    slot.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      slot.classList.remove("is-dragover");
      clearHeroDollDragHighlight(panel);

      try {
        const dragData = getHeroDollDropData(event);
        await moduleApi.heroDollService.assignItemToSlot(actor, slot.dataset.slotId, dragData);
        await rerenderActorSheet(app, moduleApi);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to assign hero doll slot.`, error);
        ui.notifications?.error(error.message || "Не удалось поместить предмет в слот куклы героя.");
      }
      finally {
        activeHeroDollDragData = null;
      }
    }, listenerOptions);
  });
}

function bindHeroDollInventoryListeners(panel, app, listenerOptions = undefined) {
  const actor = getActorFromSheetApp(app);
  if (!actor) {
    return;
  }

  panel.querySelectorAll("[data-hero-doll-item-drag='true']").forEach((entry) => {
    entry.addEventListener("dragstart", (event) => {
      setItemDragData(event, event.currentTarget.dataset.itemUuid);
      setHeroDollDragHighlight(panel, parseAllowedSlots(event.currentTarget.dataset.allowedSlots));
    }, listenerOptions);

    entry.addEventListener("dragend", () => {
      clearHeroDollDragHighlight(panel);
      activeHeroDollDragData = null;
    }, listenerOptions);
  });
}

function bindHeroDollClickDelegation(panel, app, moduleApi, listenerOptions = undefined) {
  panel.addEventListener("click", async (event) => {
    const actionTarget = event.target.closest?.("[data-action]");
    if (!(actionTarget instanceof HTMLElement) || !panel.contains(actionTarget)) {
      return;
    }

    const action = String(actionTarget.dataset.action ?? "").trim();
    if (!action) {
      return;
    }

    const actor = getActorFromSheetApp(app);
    if (!actor) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    switch (action) {
      case "open-slot-item": {
        try {
          const item = await moduleApi.heroDollService.openSlotItem(actor, actionTarget.dataset.slotId);
          bringAppToFront(item?.sheet);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open hero doll item.`, error);
          ui.notifications?.error(error.message || "Не удалось открыть предмет из вкладки куклы героя.");
        }
        break;
      }

      case "clear-slot": {
        try {
          await moduleApi.heroDollService.clearSlot(actor, actionTarget.dataset.slotId);
          await rerenderActorSheet(app, moduleApi);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to clear hero doll slot.`, error);
          ui.notifications?.error(error.message || "Не удалось очистить слот куклы героя.");
        }
        break;
      }

      case "open-inventory-item": {
        try {
          const item = actor.items?.get?.(actionTarget.dataset.itemId) ?? null;
          if (!item) {
            return;
          }

          await item.sheet?.render?.(true);
          bringAppToFront(item.sheet);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open inventory item from hero doll tab.`, error);
          ui.notifications?.error("Не удалось открыть предмет персонажа.");
        }
        break;
      }

      case "open-party-inventory": {
        try {
          await moduleApi.openInventoryApp();
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open party inventory from hero doll tab.`, error);
          ui.notifications?.error("Не удалось открыть партийный склад.");
        }
        break;
      }

      default:
        break;
    }
  }, listenerOptions);
}

function bindHeroDollDelegatedListeners(root, app, moduleApi, listenerOptions = undefined) {
  root.addEventListener("dragstart", (event) => {
    const entry = event.target.closest?.("[data-hero-doll-item-drag='true']");
    const panel = entry ? getHeroDollPanelFromEvent(root, event) : null;
    if (!(entry instanceof HTMLElement) || !panel) {
      return;
    }

    setItemDragData(event, entry.dataset.itemUuid);
    setHeroDollDragHighlight(panel, parseAllowedSlots(entry.dataset.allowedSlots));
  }, listenerOptions);

  root.addEventListener("dragend", (event) => {
    const entry = event.target.closest?.("[data-hero-doll-item-drag='true']");
    const panel = entry ? getHeroDollPanelFromEvent(root, event) : null;
    if (!(entry instanceof HTMLElement) || !panel) {
      return;
    }

    clearHeroDollDragHighlight(panel);
    activeHeroDollDragData = null;
  }, listenerOptions);

  root.addEventListener("dragover", (event) => {
    const slot = event.target.closest?.("[data-hero-doll-slot='true']");
    const panel = slot ? getHeroDollPanelFromEvent(root, event) : null;
    if (!(slot instanceof HTMLElement) || !panel) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = resolvePreferredDropEffect(event.dataTransfer, "move");
    }
    slot.classList.add("is-dragover");
  }, listenerOptions);

  root.addEventListener("dragleave", (event) => {
    const slot = event.target.closest?.("[data-hero-doll-slot='true']");
    const panel = slot ? getHeroDollPanelFromEvent(root, event) : null;
    if (!(slot instanceof HTMLElement) || !panel) {
      return;
    }

    event.stopPropagation();
    slot.classList.remove("is-dragover");
  }, listenerOptions);

  root.addEventListener("drop", async (event) => {
    const slot = event.target.closest?.("[data-hero-doll-slot='true']");
    const panel = slot ? getHeroDollPanelFromEvent(root, event) : null;
    if (!(slot instanceof HTMLElement) || !panel) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    slot.classList.remove("is-dragover");
    clearHeroDollDragHighlight(panel);

    const actor = getActorFromSheetApp(app);
    if (!actor) {
      return;
    }

    try {
      const dragData = getHeroDollDropData(event);
      await moduleApi.heroDollService.assignItemToSlot(actor, slot.dataset.slotId, dragData);
      await rerenderActorSheet(app, moduleApi);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to assign hero doll slot.`, error);
      ui.notifications?.error(error.message || "Не удалось поместить предмет в слот куклы героя.");
    }
    finally {
      activeHeroDollDragData = null;
    }
  }, listenerOptions);

  root.addEventListener("click", async (event) => {
    const actionTarget = event.target.closest?.("[data-action]");
    if (!(actionTarget instanceof HTMLElement)) {
      return;
    }

    const panel = getHeroDollPanelFromEvent(root, event);
    if (!panel || !panel.contains(actionTarget)) {
      return;
    }

    const action = String(actionTarget.dataset.action ?? "").trim();
    if (!action) {
      return;
    }

    const actor = getActorFromSheetApp(app);
    if (!actor) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    switch (action) {
      case "open-slot-item": {
        try {
          const item = await moduleApi.heroDollService.openSlotItem(actor, actionTarget.dataset.slotId);
          bringAppToFront(item?.sheet);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open hero doll item.`, error);
          ui.notifications?.error(error.message || "Не удалось открыть предмет из вкладки куклы героя.");
        }
        break;
      }

      case "clear-slot": {
        try {
          await moduleApi.heroDollService.clearSlot(actor, actionTarget.dataset.slotId);
          await rerenderActorSheet(app, moduleApi);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to clear hero doll slot.`, error);
          ui.notifications?.error(error.message || "Не удалось очистить слот куклы героя.");
        }
        break;
      }

      case "open-inventory-item": {
        try {
          const item = actor.items?.get?.(actionTarget.dataset.itemId) ?? null;
          if (!item) {
            return;
          }

          await item.sheet?.render?.(true);
          bringAppToFront(item.sheet);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open inventory item from hero doll tab.`, error);
          ui.notifications?.error("Не удалось открыть предмет персонажа.");
        }
        break;
      }

      case "open-party-inventory": {
        try {
          await moduleApi.openInventoryApp();
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open party inventory from hero doll tab.`, error);
          ui.notifications?.error("Не удалось открыть партийный склад.");
        }
        break;
      }

      default:
        break;
    }
  }, listenerOptions);
}

function bindHeroDollPanel(root, app, moduleApi) {
  const panel = root.querySelector(`[data-application-part='${HERO_DOLL_TAB_ID}'] .rm-hero-doll-tab`)
    ?? root.querySelector(`.rm-hero-doll-tab[data-tab='${HERO_DOLL_TAB_ID}']`);
  if (!panel) {
    if (root.dataset.rebreyaHeroDollWatch !== "true") {
      root.dataset.rebreyaHeroDollWatch = "true";
      root.addEventListener("click", (event) => {
        const tabTrigger = event.target.closest?.(`[data-tab='${HERO_DOLL_TAB_ID}']`);
        if (!tabTrigger) {
          return;
        }

        window.setTimeout(() => bindHeroDollPanel(root, app, moduleApi), 0);
      });
      window.setTimeout(() => bindHeroDollPanel(root, app, moduleApi), 0);
    }

    return;
  }

  heroDollPanelAbortControllers.get(panel)?.abort();
  const panelAbortController = new AbortController();
  heroDollPanelAbortControllers.set(panel, panelAbortController);
  const panelListenerOptions = { signal: panelAbortController.signal };
  bindHeroDollSlotListeners(panel, app, moduleApi, panelListenerOptions);
  bindHeroDollInventoryListeners(panel, app, panelListenerOptions);

  heroDollRootAbortControllers.get(root)?.abort();
  const rootAbortController = new AbortController();
  heroDollRootAbortControllers.set(root, rootAbortController);
  const rootListenerOptions = { signal: rootAbortController.signal };
  bindHeroDollDelegatedListeners(root, app, moduleApi, rootListenerOptions);
}

async function handleCharacterDowntimeSubmit(panel, app, moduleApi) {
  const actor = getActorFromSheetApp(app);
  if (!actor) {
    return;
  }

  const formState = readCharacterDowntimeFormStateFromPanel(panel, actor);
  const targetActionSelections = readCharacterDowntimeTargetActionSelections(panel);
  const payload = {
    actionId: cleanText(panel.querySelector("[data-action='character-downtime-action']")?.value),
    weeks: toPositiveInteger(panel.querySelector("[data-action='character-downtime-weeks']")?.value, 1),
    title: cleanText(panel.querySelector("[data-action='character-downtime-title']")?.value),
    description: cleanText(panel.querySelector("[data-action='character-downtime-description']")?.value)
  };
  const editRequestId = cleanText(formState.editRequestId);
  if (editRequestId) {
    payload.requestId = editRequestId;
  }
  if (targetActionSelections.length) {
    payload.targetActionSelections = targetActionSelections;
  }

  await moduleApi.characterDowntimeService.createRequest(actor, payload);
  characterDowntimeFormStateByActorId.set(actor.id, {
    editRequestId: "",
    weeks: 1,
    targetActionSelections: []
  });
  ui.notifications?.info(editRequestId ? "Заявка на простой обновлена." : "Заявка на простой отправлена.");
  await rerenderActorSheet(app, moduleApi);
}

function getCharacterDowntimeFormState(actorId = "") {
  const safeActorId = cleanText(actorId);
  if (!safeActorId) {
    return {};
  }

  const state = characterDowntimeFormStateByActorId.get(safeActorId) ?? {};
  characterDowntimeFormStateByActorId.set(safeActorId, state);
  return state;
}

function updateCharacterDowntimeFormState(actor, patch = {}) {
  if (!actor?.id) {
    return {};
  }

  const state = {
    ...getCharacterDowntimeFormState(actor.id),
    ...patch
  };
  characterDowntimeFormStateByActorId.set(actor.id, state);
  return state;
}

export async function prepareCharacterDowntimeFormState(actor, formState = {}, characterDowntimeService = null) {
  const nextState = {
    ...formState,
    targetActionSelections: Array.isArray(formState.targetActionSelections)
      ? formState.targetActionSelections
      : []
  };
  if (typeof characterDowntimeService?.previewCraftRequest !== "function") {
    return nextState;
  }

  try {
    const craftPreview = await characterDowntimeService.previewCraftRequest(actor, {
      actionId: cleanText(nextState.actionId),
      targetActionSelections: nextState.targetActionSelections
    });
    if (craftPreview) {
      nextState.craftPreview = craftPreview;
    }
    else {
      delete nextState.craftPreview;
    }
  }
  catch (error) {
    const rawMessage = cleanText(error?.message);
    const message = /managed gear selection|выбор.*снаряж/iu.test(rawMessage)
      ? "Выберите предмет для крафта."
      : (rawMessage || "Не удалось рассчитать заявку крафта.");
    nextState.craftPreview = {
      ready: false,
      canSubmit: false,
      message,
      materials: [],
      errors: [{ code: "craft-preview-failed", message }]
    };
  }
  return nextState;
}

function readCharacterDowntimeFormStateFromPanel(panel, actor) {
  return updateCharacterDowntimeFormState(actor, {
    actionId: cleanText(panel?.querySelector("[data-action='character-downtime-action']")?.value),
    weeks: toPositiveInteger(panel?.querySelector("[data-action='character-downtime-weeks']")?.value, 1),
    targetActionSelections: readCharacterDowntimeTargetActionSelections(panel)
  });
}

function readCharacterDowntimeTargetActionSelections(panel) {
  const selectionsByActionId = new Map();
  const ensureSelection = (actionId) => {
    const safeActionId = cleanText(actionId);
    if (!safeActionId) {
      return null;
    }
    if (!selectionsByActionId.has(safeActionId)) {
      selectionsByActionId.set(safeActionId, { actionId: safeActionId });
    }
    return selectionsByActionId.get(safeActionId);
  };

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-resource-choice']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    const choiceId = cleanText(control?.value);
    if (selection && choiceId) {
      selection.choiceId = choiceId;
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-item-choice']") ?? [])) {
    const actionId = cleanText(control?.dataset?.targetActionId);
    const uuid = cleanText(control?.dataset?.itemUuid);
    const id = cleanText(control?.dataset?.itemId);
    const name = cleanText(control?.dataset?.itemName);
    const snapshot = parseCharacterDowntimeItemSnapshot(control?.dataset?.itemSnapshot);
    if (!actionId || (!uuid && !id && !name && !cleanText(snapshot.uuid) && !cleanText(snapshot.id) && !cleanText(snapshot.name))) {
      continue;
    }

    const item = {
      ...snapshot
    };
    if (uuid) {
      item.uuid = uuid;
    }
    if (id) {
      item.id = id;
    }
    if (name) {
      item.name = name;
    }
    item.name ||= "Предмет";
    const type = cleanText(control?.dataset?.itemType);
    if (type) {
      item.type = type;
    }
    const img = cleanText(control?.dataset?.itemImg);
    if (img) {
      item.img = img;
    }
    const sourceType = cleanText(control?.dataset?.itemSourceType);
    if (sourceType) {
      item.sourceType = sourceType;
    }
    const rarity = cleanText(control?.dataset?.itemRarity);
    if (rarity) {
      item.rarity = rarity;
    }
    const priceGold = toOptionalFiniteNumber(control?.dataset?.itemPriceGold);
    if (priceGold !== undefined) {
      item.priceGold = priceGold;
    }
    const costText = cleanText(control?.dataset?.itemCostText);
    if (costText) {
      item.costText = costText;
    }
    const selection = ensureSelection(actionId);
    if (selection) {
      selection.item = item;
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-rank-choice']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    const optionId = cleanText(control?.value);
    if (selection && optionId) {
      selection.optionId = optionId;
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-option-choice']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    const optionId = cleanText(control?.value);
    if (selection && optionId) {
      selection.optionId = optionId;
    }
  }

  const checkboxSelections = new Map();
  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-option-checkbox']") ?? [])) {
    const actionId = cleanText(control?.dataset?.targetActionId);
    const optionId = cleanText(control?.dataset?.optionId) || cleanText(control?.value);
    if (!actionId || !optionId || control.checked !== true) {
      continue;
    }

    checkboxSelections.set(actionId, [
      ...(checkboxSelections.get(actionId) ?? []),
      optionId
    ]);
  }
  for (const [actionId, optionIds] of checkboxSelections.entries()) {
    if (optionIds.length) {
      const selection = ensureSelection(actionId);
      if (selection) {
        selection.optionIds = optionIds;
      }
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-numeric-input']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    const value = toOptionalFiniteNumber(control?.value);
    if (selection && value !== undefined) {
      selection.value = value;
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-resource-quantity']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    const value = toOptionalFiniteNumber(control?.value);
    if (selection && value !== undefined) {
      selection.value = value;
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-formula-input']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    const formula = cleanCharacterDowntimeFormulaText(control?.value);
    if (selection && formula) {
      selection.formula = formula;
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-formula-result']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    const result = toOptionalFiniteNumber(control?.value);
    if (selection && result !== undefined) {
      selection.result = result;
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-description-title']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    if (selection) {
      selection.title = cleanText(control?.value);
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-description-text']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    if (selection) {
      selection.description = cleanText(control?.value);
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-check-source']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    const sourceType = cleanText(control?.value);
    if (selection && sourceType) {
      selection.sourceType = sourceType;
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-check-ability']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    const ability = cleanText(control?.value);
    if (selection && ability) {
      selection.ability = ability;
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-check-target']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    const target = cleanText(control?.value);
    if (selection && target) {
      selection.target = target;
      const option = control?.selectedOptions?.[0] ?? control?.options?.[control.selectedIndex];
      const targetLabel = cleanText(control?.dataset?.targetLabel)
        || cleanText(option?.dataset?.targetLabel)
        || cleanText(option?.label)
        || cleanText(option?.textContent);
      if (targetLabel) {
        selection.targetLabel = targetLabel;
      }
    }
  }

  for (const control of Array.from(panel?.querySelectorAll?.("[data-action='character-downtime-check-dc']") ?? [])) {
    const selection = ensureSelection(control?.dataset?.targetActionId);
    const dc = toOptionalFiniteNumber(control?.value);
    if (selection && dc !== undefined) {
      selection.dc = dc;
    }
  }

  return [...selectionsByActionId.values()]
    .filter((entry) => entry.choiceId
      || entry.optionId
      || entry.optionIds?.length
      || entry.value !== undefined
      || entry.item
      || entry.formula
      || entry.result !== undefined
      || entry.sourceType
      || entry.ability
      || entry.target
      || entry.targetLabel
      || entry.dc !== undefined
      || entry.title !== undefined
      || entry.description !== undefined);
}

function getDowntimeLibraryPack() {
  return game.packs?.get?.(`world.${DOWNTIME_COMPENDIUM_NAME}`) ?? null;
}

async function renderDowntimeLibraryPack(pack) {
  if (!pack || typeof pack.render !== "function") {
    return;
  }

  try {
    await pack.render({ force: true });
  }
  catch (_error) {
    await pack.render(true);
  }
}

function stripHtmlText(value = "") {
  const text = String(value ?? "")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > 260 ? `${text.slice(0, 257).trim()}...` : text;
}

function normalizeDowntimeLibraryRecord(pack, row = {}) {
  const uuid = getIndexRowUuid(pack, row);
  if (!uuid) {
    return null;
  }

  const downtimeFlag = getIndexRowProperty(row, `flags.${MODULE_ID}.downtime`) ?? {};
  const targetActions = Array.isArray(downtimeFlag.targetActions) ? downtimeFlag.targetActions : [];
  const descriptionHtml = cleanText(downtimeFlag.descriptionHtml)
    || cleanText(getIndexRowProperty(row, "system.description.value"));
  return {
    uuid,
    name: cleanText(row.name) || "Простой",
    id: uuid,
    label: cleanText(row.name) || "Простой",
    rank: cleanText(downtimeFlag.rank),
    duration: cleanText(downtimeFlag.duration),
    requirements: Array.isArray(downtimeFlag.requirements) ? downtimeFlag.requirements.map((entry) => cleanText(entry)).filter(Boolean) : [],
    rankTable: Array.isArray(downtimeFlag.rankTable) ? foundry.utils.deepClone(downtimeFlag.rankTable) : [],
    targetActions: foundry.utils.deepClone(targetActions),
    descriptionHtml,
    summary: stripHtmlText(
      downtimeFlag.summary
      || descriptionHtml
      || ""
    ),
    targetActionCount: targetActions.length
  };
}

function isDowntimeTemplateItem(item) {
  return item?.type === DOWNTIME_ITEM_TYPE;
}

function normalizeDowntimeLibraryDocument(document = {}) {
  const downtimeFlag = document?.getFlag?.(MODULE_ID, "downtime")
    ?? foundry.utils.getProperty?.(document, `flags.${MODULE_ID}.downtime`)
    ?? {};
  const targetActions = Array.isArray(downtimeFlag.targetActions) ? downtimeFlag.targetActions : [];
  const descriptionHtml = cleanText(downtimeFlag.descriptionHtml)
    || cleanText(foundry.utils.getProperty?.(document, "system.description.value"));
  return {
    uuid: cleanText(document.uuid),
    name: cleanText(document.name) || "Простой",
    id: cleanText(document.uuid),
    label: cleanText(document.name) || "Простой",
    rank: cleanText(downtimeFlag.rank),
    duration: cleanText(downtimeFlag.duration),
    requirements: Array.isArray(downtimeFlag.requirements) ? downtimeFlag.requirements.map((entry) => cleanText(entry)).filter(Boolean) : [],
    rankTable: Array.isArray(downtimeFlag.rankTable) ? foundry.utils.deepClone(downtimeFlag.rankTable) : [],
    targetActions: foundry.utils.deepClone(targetActions),
    descriptionHtml,
    summary: stripHtmlText(
      downtimeFlag.summary
      || descriptionHtml
      || ""
    ),
    targetActionCount: targetActions.length
  };
}

async function getDowntimeLibraryRecords() {
  const pack = getDowntimeLibraryPack();
  if (!pack || typeof pack.getIndex !== "function") {
    return {
      pack,
      records: []
    };
  }

  const index = await pack.getIndex({
    fields: [
      `flags.${MODULE_ID}.downtime`,
      `flags.${MODULE_ID}.downtimeId`,
      "system.description.value"
    ]
  });
  const records = collectionValues(index)
    .map((row) => normalizeDowntimeLibraryRecord(pack, row))
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));

  return {
    pack,
    records
  };
}

export async function selectDowntimeTemplateDocumentWithBrowser() {
  const CompendiumBrowser = getCompendiumBrowserClass();
  if (!CompendiumBrowser?.selectOne) {
    return null;
  }

  const result = await CompendiumBrowser.selectOne({
    mode: CompendiumBrowser.MODES?.ADVANCED,
    tab: "items",
    filters: {
      locked: {
        documentClass: "Item",
        types: new Set([DOWNTIME_ITEM_TYPE])
      }
    }
  });
  if (!result) {
    return null;
  }

  const document = await fromUuid(result);
  return isDowntimeTemplateItem(document) ? document : null;
}

async function setCharacterDowntimeActionSelection(panel, record, app, moduleApi) {
  const actionInput = panel?.querySelector?.("[data-action='character-downtime-action']");
  const actionLabel = panel?.querySelector?.("[data-action='character-downtime-action-label']");
  const actionButton = panel?.querySelector?.("[data-action='character-downtime-open-library']");
  const actor = getActorFromSheetApp(app);
  if (actionInput) {
    actionInput.value = record.uuid;
  }
  if (actionLabel) {
    actionLabel.textContent = record.name;
  }
  if (actionButton) {
    actionButton.dataset.tooltip = record.summary || `Выбрано: ${record.name}`;
  }

  if (actor?.id) {
    updateCharacterDowntimeFormState(actor, {
      editRequestId: "",
      actionId: record.uuid,
      weeks: toPositiveInteger(panel?.querySelector("[data-action='character-downtime-weeks']")?.value, 1),
      targetActionSelections: [],
      selectedTemplate: {
        ...record,
        id: record.uuid,
        label: record.name
      }
    });
    await rerenderActorSheet(app, moduleApi);
  }
}

async function openCharacterDowntimeLibraryPicker(panel, app, moduleApi) {
  const { pack, records } = await getDowntimeLibraryRecords();
  if (!pack) {
    ui.notifications?.warn("Библиотека простоя Rebreya не найдена.");
    return;
  }
  if (!records.length) {
    await renderDowntimeLibraryPack(pack);
    ui.notifications?.warn("В библиотеке простоя пока нет доступных шаблонов.");
    return;
  }

  const selectedDocument = await selectDowntimeTemplateDocumentWithBrowser();
  if (selectedDocument) {
    await setCharacterDowntimeActionSelection(panel, normalizeDowntimeLibraryDocument(selectedDocument), app, moduleApi);
    return;
  }

  if (getCompendiumBrowserClass()?.selectOne) {
    return;
  }

  await renderDowntimeLibraryPack(pack);
}

function getApplicationElementCandidates(app) {
  const candidates = [];
  for (const element of [
    app?.element,
    app?._element,
    app?.window?.element,
    app?.window?._element
  ]) {
    if (element instanceof HTMLElement) {
      candidates.push(element);
    }
    else if (element?.[0] instanceof HTMLElement) {
      candidates.push(element[0]);
    }
  }

  return candidates;
}

function collectOpenApplications() {
  const applications = [];
  const windows = globalThis.ui?.windows;
  if (windows && typeof windows === "object") {
    applications.push(...Object.values(windows));
  }

  const instances = globalThis.foundry?.applications?.instances;
  if (instances?.values instanceof Function) {
    applications.push(...instances.values());
  }
  else if (instances && typeof instances === "object") {
    applications.push(...Object.values(instances));
  }

  return [...new Set(applications.filter(Boolean))];
}

function getApplicationIdFromElement(element) {
  const root = element?.closest?.("[data-appid], [data-app-id], [data-application-id], [data-applicationid], .application, .app, .window-app");
  if (!root) {
    return "";
  }

  for (const value of [
    root.dataset?.appid,
    root.dataset?.appId,
    root.dataset?.applicationId,
    root.dataset?.applicationid,
    root.getAttribute?.("data-appid"),
    root.getAttribute?.("data-app-id"),
    root.getAttribute?.("data-application-id"),
    root.getAttribute?.("data-applicationid")
  ]) {
    const id = String(value ?? "").trim();
    if (id) {
      return id;
    }
  }

  return "";
}

function getApplicationById(appId) {
  if (!appId) {
    return null;
  }

  const windows = globalThis.ui?.windows;
  if (windows?.[appId]) {
    return windows[appId];
  }

  const instances = globalThis.foundry?.applications?.instances;
  if (instances?.get instanceof Function) {
    return instances.get(appId) ?? instances.get(Number(appId)) ?? null;
  }

  return instances?.[appId] ?? null;
}

function resolveCharacterDowntimeSheetApp(submitButton, fallbackApp = null) {
  if (getActorFromSheetApp(fallbackApp)?.type === "character") {
    return fallbackApp;
  }

  const appFromId = getApplicationById(getApplicationIdFromElement(submitButton));
  if (getActorFromSheetApp(appFromId)?.type === "character") {
    return appFromId;
  }

  for (const app of collectOpenApplications()) {
    const actor = getActorFromSheetApp(app);
    if (actor?.type !== "character") {
      continue;
    }

    if (getApplicationElementCandidates(app).some((element) => element.contains(submitButton))) {
      return app;
    }
  }

  return null;
}

function getEventTargetElement(event) {
  const target = event?.target;
  if (target?.closest instanceof Function) {
    return target;
  }

  if (target?.parentElement?.closest instanceof Function) {
    return target.parentElement;
  }

  if (target?.parentNode?.closest instanceof Function) {
    return target.parentNode;
  }

  return null;
}

function normalizeDowntimeRollAbility(value = "") {
  const cleaned = cleanText(value);
  return cleaned.startsWith("save-") ? cleaned.slice(5) : cleaned;
}

function getDowntimeRollDc(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

async function rollDowntimeFormulaTotal(formula = "") {
  const safeFormula = cleanText(formula);
  if (!safeFormula) {
    return null;
  }

  if (typeof Roll === "function") {
    const roll = new Roll(safeFormula);
    if (typeof roll.evaluate === "function") {
      const evaluated = await roll.evaluate({ async: true });
      const total = getDowntimeRollTotal(evaluated ?? roll);
      return total === null ? getDowntimeRollTotal(roll) : total;
    }
  }

  const simpleFormula = safeFormula.replace(/\s+/gu, "");
  const match = /^(\d+)\+(\d+)d(\d+)$/iu.exec(simpleFormula);
  if (match) {
    const base = Number(match[1]);
    const dice = Number(match[2]);
    const faces = Number(match[3]);
    if (Number.isFinite(base) && Number.isFinite(dice) && Number.isFinite(faces)) {
      let total = base;
      for (let index = 0; index < dice; index += 1) {
        total += Math.ceil(Math.random() * faces);
      }
      return total;
    }
  }

  return null;
}

function getDowntimeRollTotal(rolls) {
  const roll = Array.isArray(rolls) ? rolls[0] : rolls;
  const total = Number(
    roll?.total
    ?? roll?._total
    ?? roll?.result?.total
    ?? roll?.terms?.find?.((term) => term?.total !== undefined)?.total
  );
  return Number.isFinite(total) ? total : null;
}

function buildDowntimeRollMessageData(button) {
  return {
    data: {
      flags: {
        [MODULE_ID]: {
          downtimeRequestId: cleanText(button.dataset.requestId),
          downtimeCheckId: cleanText(button.dataset.checkId),
          downtimeChoiceIndex: cleanText(button.dataset.choiceIndex)
        }
      }
    }
  };
}

function hasCharacterDowntimeRecordedResult(check = {}) {
  return Boolean(check?.result && typeof check.result === "object" && Object.keys(check.result).length);
}

function buildCharacterDowntimeRollDataset(request = {}, check = {}, choice = {}) {
  const sourceType = cleanText(choice.sourceType) || cleanText(check.sourceType) || "skill";
  const target = cleanText(choice.target) || cleanText(check.target);
  const targetAbility = normalizeDowntimeRollAbility(target);
  const ability = normalizeDowntimeRollAbility(choice.ability)
    || normalizeDowntimeRollAbility(check.ability)
    || targetAbility;
  const targetLabel = cleanText(choice.targetLabel)
    || cleanText(choice.label)
    || cleanText(check.targetLabel)
    || cleanText(check.label)
    || target;
  const dc = getDowntimeRollDc(check.dc);
  const dcFormula = cleanText(choice.dcFormula) || cleanText(check.dcFormula);
  const outcomeMode = cleanText(check.outcomeMode) || (dc > 0 || dcFormula ? "dc" : "freeform");
  return {
    requestId: cleanText(request.id),
    checkId: cleanText(check.id),
    groupId: cleanText(request.groupId),
    actorId: cleanText(request.actorId),
    sourceType,
    ability,
    target,
    targetLabel,
    outcomeMode,
    choiceIndex: cleanText(choice.choiceIndex),
    dc: String(dc),
    dcFormula
  };
}

function getImmediateCharacterDowntimeRollDatasets(request = {}) {
  return (Array.isArray(request.checks) ? request.checks : [])
    .filter((check) => {
      const actionType = cleanText(check?.actionType) || "check";
      return actionType === "check" && !hasCharacterDowntimeRecordedResult(check);
    })
    .flatMap((check) => {
      const choices = Array.isArray(check.choices) ? check.choices : [];
      if (choices.length > 1) {
        return [];
      }

      const choice = choices[0] ?? {};
      const sourceType = cleanText(choice.sourceType) || cleanText(check.sourceType) || "skill";
      const target = cleanText(choice.target) || cleanText(check.target);
      const ability = normalizeDowntimeRollAbility(choice.ability)
        || normalizeDowntimeRollAbility(check.ability)
        || normalizeDowntimeRollAbility(target);
      if (!CHARACTER_DOWNTIME_ROLLABLE_SOURCE_TYPES.has(sourceType)) {
        return [];
      }
      if ((sourceType === "ability" || sourceType === "save") ? !ability : !target) {
        return [];
      }

      return [buildCharacterDowntimeRollDataset(request, check, choice)];
    });
}

async function recordCharacterDowntimeRollDataset(actor, dataset, moduleApi, event = undefined) {
  const button = { dataset };
  const rolls = await rollCharacterDowntimeTarget(actor, button, event);
  const total = getDowntimeRollTotal(rolls);
  if (total === null) {
    return false;
  }

  const outcomeMode = cleanText(dataset.outcomeMode) || (cleanText(dataset.dc) ? "dc" : "freeform");
  const dcFormula = cleanText(dataset.dcFormula);
  const rolledDc = getDowntimeRollDc(dataset.dc) || getDowntimeRollDc(await rollDowntimeFormulaTotal(dcFormula));
  const result = {
    total,
    sourceType: cleanText(dataset.sourceType) || "skill",
    ability: normalizeDowntimeRollAbility(dataset.ability),
    target: cleanText(dataset.target),
    targetLabel: cleanText(dataset.targetLabel)
  };
  if (outcomeMode) {
    result.outcomeMode = outcomeMode;
  }
  if (["dc", "dc-sum"].includes(outcomeMode) && rolledDc > 0) {
    result.dc = rolledDc;
    if (dcFormula) {
      result.dcFormula = dcFormula;
    }
    result.success = total >= rolledDc;
  }
  if (cleanText(dataset.hasChoices) === "true") {
    result.choiceIndex = normalizeNonNegativeInteger(dataset.choiceIndex, 0);
  }

  await moduleApi.recordDowntimeCheckResult(dataset.requestId, dataset.checkId, result, {
    actorId: cleanText(dataset.actorId) || actor.id,
    groupId: cleanText(dataset.groupId)
  });
  return true;
}

async function rollImmediateCharacterDowntimeTargets(actor, request, moduleApi) {
  const datasets = getImmediateCharacterDowntimeRollDatasets(request);
  if (!datasets.length) {
    return;
  }

  let recorded = 0;
  for (const dataset of datasets) {
    if (await recordCharacterDowntimeRollDataset(actor, dataset, moduleApi)) {
      recorded += 1;
    }
  }
  if (recorded > 0) {
    ui.notifications?.info("Результаты проверок простоя записаны.");
  }
}

async function rollCharacterDowntimeTarget(actor, button, event) {
  const sourceType = cleanText(button.dataset.sourceType) || "skill";
  const target = cleanText(button.dataset.target);
  const targetAbility = normalizeDowntimeRollAbility(target);
  const ability = normalizeDowntimeRollAbility(button.dataset.ability) || targetAbility;
  const eventConfig = { event };

  if (!CHARACTER_DOWNTIME_ROLLABLE_SOURCE_TYPES.has(sourceType)) {
    throw new Error("Этот тип целевого действия пока нельзя бросить из чарника.");
  }

  if (sourceType === "skill") {
    if (!target || typeof actor.rollSkill !== "function") {
      throw new Error("Навык для проверки простоя не найден в листе персонажа.");
    }

    const config = ability ? { ...eventConfig, skill: target, ability } : { ...eventConfig, skill: target };
    return actor.rollSkill(config, {}, buildDowntimeRollMessageData(button));
  }

  if (sourceType === "save") {
    if (ability === "death") {
      if (typeof actor.rollDeathSave !== "function") {
        throw new Error("Спасбросок смерти для проверки простоя не найден в листе персонажа.");
      }

      return actor.rollDeathSave({ ...eventConfig, legacy: false }, {}, buildDowntimeRollMessageData(button));
    }

    if (!ability || typeof actor.rollSavingThrow !== "function") {
      throw new Error("Спасбросок для проверки простоя не найден в листе персонажа.");
    }

    return actor.rollSavingThrow({ ...eventConfig, ability }, {}, buildDowntimeRollMessageData(button));
  }

  if (sourceType === "ability") {
    if (!ability || typeof actor.rollAbilityCheck !== "function") {
      throw new Error("Характеристика для проверки простоя не найдена в листе персонажа.");
    }

    return actor.rollAbilityCheck({ ...eventConfig, ability }, {}, buildDowntimeRollMessageData(button));
  }

  if (sourceType === "tool") {
    if (!target || typeof actor.rollToolCheck !== "function") {
      throw new Error("Инструмент для проверки простоя не найден в листе персонажа.");
    }

    const config = ability && CHARACTER_DOWNTIME_ABILITY_KEYS.has(ability)
      ? { ...eventConfig, tool: target, ability }
      : { ...eventConfig, tool: target };
    return actor.rollToolCheck(config, {}, buildDowntimeRollMessageData(button));
  }

  return null;
}

async function buildCharacterDowntimeRollResult(actor, button, event) {
  const rolls = await rollCharacterDowntimeTarget(actor, button, event);
  const total = getDowntimeRollTotal(rolls);
  if (total === null) {
    return null;
  }

  const explicitOutcomeMode = cleanText(button.dataset.outcomeMode);
  const outcomeMode = explicitOutcomeMode || (cleanText(button.dataset.dc) ? "dc" : "freeform");
  const dcFormula = cleanText(button.dataset.dcFormula);
  const rolledDc = getDowntimeRollDc(button.dataset.dc) || getDowntimeRollDc(await rollDowntimeFormulaTotal(dcFormula));
  const result = {
    total,
    sourceType: cleanText(button.dataset.sourceType) || "skill",
    ability: normalizeDowntimeRollAbility(button.dataset.ability),
    target: cleanText(button.dataset.target),
    targetLabel: cleanText(button.dataset.targetLabel)
  };
  if (explicitOutcomeMode) {
    result.outcomeMode = outcomeMode;
  }
  if (["dc", "dc-sum"].includes(outcomeMode) && rolledDc > 0) {
    result.dc = rolledDc;
    if (dcFormula) {
      result.dcFormula = dcFormula;
    }
    result.success = total >= rolledDc;
  }
  if (cleanText(button.dataset.hasChoices) === "true") {
    result.choiceIndex = normalizeNonNegativeInteger(button.dataset.choiceIndex, 0);
  }

  return result;
}

async function handleCharacterDowntimeRoll(button, app, moduleApi, event) {
  const actor = getActorFromSheetApp(app);
  if (!actor) {
    return;
  }

  const requestId = cleanText(button.dataset.requestId);
  const checkId = cleanText(button.dataset.checkId);
  if (!requestId || !checkId) {
    throw new Error("Целевое действие простоя не найдено.");
  }

  const result = await buildCharacterDowntimeRollResult(actor, button, event);
  if (!result) return;

  await moduleApi.recordDowntimeCheckResult(requestId, checkId, result, {
    actorId: cleanText(button.dataset.actorId) || actor.id,
    groupId: cleanText(button.dataset.groupId)
  });
  ui.notifications?.info("Результат проверки простоя записан.");
  await rerenderActorSheet(app, moduleApi);
}

async function handleCharacterDowntimeSubmitClick(event, { root = null, app = null, moduleApi } = {}) {
  if (event?.type === "pointerup" && Number(event.button ?? 0) !== 0) {
    return false;
  }

  const submitButton = getEventTargetElement(event)?.closest?.("[data-action='character-downtime-submit']");
  if (!(submitButton instanceof HTMLElement)) {
    return false;
  }

  if (root?.contains instanceof Function && !root.contains(submitButton)) {
    return false;
  }

  if (submitButton.disabled || submitButton.getAttribute?.("aria-disabled") === "true" || submitButton.matches?.(":disabled")) {
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }

  const panel = submitButton.closest?.(".rm-character-downtime-tab")
    ?? root?.querySelector?.(`[data-application-part='${CHARACTER_DOWNTIME_TAB_ID}'] .rm-character-downtime-tab`)
    ?? root?.querySelector?.(`.rm-character-downtime-tab[data-tab='${CHARACTER_DOWNTIME_TAB_ID}']`);
  const sheetApp = resolveCharacterDowntimeSheetApp(submitButton, app);
  if (!panel || !sheetApp) {
    return false;
  }

  if (handledCharacterDowntimeClickEvents.has(event)) {
    return true;
  }

  const now = Date.now();
  const lastSubmitAt = recentCharacterDowntimeSubmitButtons.get(submitButton) ?? 0;
  if (now - lastSubmitAt < CHARACTER_DOWNTIME_SUBMIT_DEBOUNCE_MS) {
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }

  handledCharacterDowntimeClickEvents.add(event);
  recentCharacterDowntimeSubmitButtons.set(submitButton, now);
  event.preventDefault?.();
  event.stopPropagation?.();

  try {
    await handleCharacterDowntimeSubmit(panel, sheetApp, moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to submit character downtime request.`, error);
    ui.notifications?.error(error.message || "Не удалось отправить заявку на простой.");
  }

  return true;
}

async function handleCharacterDowntimeRollClick(event, { root = null, app = null, moduleApi } = {}) {
  if (event?.type === "pointerup" && Number(event.button ?? 0) !== 0) {
    return false;
  }

  const rollButton = getEventTargetElement(event)?.closest?.("[data-action='character-downtime-roll']");
  if (!(rollButton instanceof HTMLElement)) {
    return false;
  }

  if (root?.contains instanceof Function && !root.contains(rollButton)) {
    return false;
  }

  const panel = rollButton.closest?.(".rm-character-downtime-tab")
    ?? root?.querySelector?.(`[data-application-part='${CHARACTER_DOWNTIME_TAB_ID}'] .rm-character-downtime-tab`)
    ?? root?.querySelector?.(`.rm-character-downtime-tab[data-tab='${CHARACTER_DOWNTIME_TAB_ID}']`);
  const sheetApp = resolveCharacterDowntimeSheetApp(rollButton, app);
  if (!panel || !sheetApp) {
    return false;
  }

  if (handledCharacterDowntimeClickEvents.has(event)) {
    return true;
  }

  const now = Date.now();
  const lastRollAt = recentCharacterDowntimeRollButtons.get(rollButton) ?? 0;
  if (now - lastRollAt < CHARACTER_DOWNTIME_ROLL_DEBOUNCE_MS) {
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }

  handledCharacterDowntimeClickEvents.add(event);
  recentCharacterDowntimeRollButtons.set(rollButton, now);
  event.preventDefault?.();
  event.stopPropagation?.();

  const wasDisabled = Boolean(rollButton.disabled);
  rollButton.disabled = true;
  try {
    await handleCharacterDowntimeRoll(rollButton, sheetApp, moduleApi, event);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to roll character downtime target.`, error);
    ui.notifications?.error(error.message || "Не удалось выполнить проверку простоя.");
  }
  finally {
    rollButton.disabled = wasDisabled;
  }

  return true;
}

function parseCharacterDowntimeEditState(value = "") {
  const state = parseCharacterDowntimeJsonObject(value);
  const requestId = cleanText(state.requestId);
  const actionId = cleanText(state.actionId);
  if (!requestId || !actionId) {
    return null;
  }

  return {
    editRequestId: requestId,
    actionId,
    weeks: toPositiveInteger(state.weeks, 1),
    title: cleanText(state.title),
    description: cleanText(state.description),
    targetActionSelections: Array.isArray(state.targetActionSelections)
      ? state.targetActionSelections
      : [],
    selectedTemplate: null
  };
}

async function handleCharacterDowntimeEditRequestClick(event, { root = null, app = null, moduleApi } = {}) {
  if (event?.type === "pointerup" && Number(event.button ?? 0) !== 0) {
    return false;
  }

  const editButton = getEventTargetElement(event)?.closest?.("[data-action='character-downtime-edit-request']");
  if (!(editButton instanceof HTMLElement)) {
    return false;
  }

  if (root?.contains instanceof Function && !root.contains(editButton)) {
    return false;
  }

  const panel = editButton.closest?.(".rm-character-downtime-tab")
    ?? root?.querySelector?.(`[data-application-part='${CHARACTER_DOWNTIME_TAB_ID}'] .rm-character-downtime-tab`)
    ?? root?.querySelector?.(`.rm-character-downtime-tab[data-tab='${CHARACTER_DOWNTIME_TAB_ID}']`);
  const sheetApp = resolveCharacterDowntimeSheetApp(editButton, app);
  if (!panel || !sheetApp) {
    return false;
  }

  if (handledCharacterDowntimeClickEvents.has(event)) {
    return true;
  }

  handledCharacterDowntimeClickEvents.add(event);
  event.preventDefault?.();
  event.stopPropagation?.();

  const actor = getActorFromSheetApp(sheetApp);
  const editState = parseCharacterDowntimeEditState(editButton.dataset.editState);
  if (!actor?.id || !editState) {
    return true;
  }

  updateCharacterDowntimeFormState(actor, editState);
  await rerenderActorSheet(sheetApp, moduleApi);
  return true;
}

function parseCharacterDowntimeContinuationPayload(value = "") {
  const payload = parseCharacterDowntimeJsonObject(value);
  return cleanText(payload.actionId) ? payload : null;
}

async function handleCharacterDowntimeContinueClick(event, { root = null, app = null, moduleApi } = {}) {
  if (event?.type === "pointerup" && Number(event.button ?? 0) !== 0) {
    return false;
  }

  const continueButton = getEventTargetElement(event)?.closest?.("[data-action='character-downtime-continue']");
  if (!(continueButton instanceof HTMLElement)) {
    return false;
  }

  if (root?.contains instanceof Function && !root.contains(continueButton)) {
    return false;
  }

  if (continueButton.disabled || continueButton.getAttribute?.("aria-disabled") === "true" || continueButton.matches?.(":disabled")) {
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }

  const panel = continueButton.closest?.(".rm-character-downtime-tab")
    ?? root?.querySelector?.(`[data-application-part='${CHARACTER_DOWNTIME_TAB_ID}'] .rm-character-downtime-tab`)
    ?? root?.querySelector?.(`.rm-character-downtime-tab[data-tab='${CHARACTER_DOWNTIME_TAB_ID}']`);
  const sheetApp = resolveCharacterDowntimeSheetApp(continueButton, app);
  if (!panel || !sheetApp) {
    return false;
  }

  if (handledCharacterDowntimeClickEvents.has(event)) {
    return true;
  }

  handledCharacterDowntimeClickEvents.add(event);
  event.preventDefault?.();
  event.stopPropagation?.();

  const now = Date.now();
  const lastContinueAt = recentCharacterDowntimeContinueButtons.get(continueButton) ?? 0;
  if (now - lastContinueAt < CHARACTER_DOWNTIME_PROJECT_ACTION_DEBOUNCE_MS) {
    return true;
  }
  recentCharacterDowntimeContinueButtons.set(continueButton, now);

  try {
    const actor = getActorFromSheetApp(sheetApp);
    const requestId = cleanText(continueButton.dataset.requestId);
    const checkId = cleanText(continueButton.dataset.checkId);
    if (!actor || !requestId || !checkId) {
      return true;
    }
    const result = await buildCharacterDowntimeRollResult(actor, continueButton, event);
    if (!result) {
      return true;
    }
    await moduleApi.continueDowntimeProject({
      requestId,
      actorId: actor.id,
      groupId: cleanText(continueButton.dataset.groupId),
      checkId,
      result
    });
    ui.notifications?.info("Неделя проекта записана.");
    await rerenderActorSheet(sheetApp, moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to continue character downtime project.`, error);
    ui.notifications?.error(error.message || "Не удалось продолжить проект.");
  }

  return true;
}

async function handleCharacterDowntimeCloseProjectClick(event, { root = null, app = null, moduleApi } = {}) {
  if (event?.type === "pointerup" && Number(event.button ?? 0) !== 0) {
    return false;
  }

  const closeButton = getEventTargetElement(event)?.closest?.("[data-action='character-downtime-close-project']");
  if (!(closeButton instanceof HTMLElement)) {
    return false;
  }

  if (root?.contains instanceof Function && !root.contains(closeButton)) {
    return false;
  }

  if (closeButton.disabled || closeButton.getAttribute?.("aria-disabled") === "true" || closeButton.matches?.(":disabled")) {
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }

  const panel = closeButton.closest?.(".rm-character-downtime-tab")
    ?? root?.querySelector?.(`[data-application-part='${CHARACTER_DOWNTIME_TAB_ID}'] .rm-character-downtime-tab`)
    ?? root?.querySelector?.(`.rm-character-downtime-tab[data-tab='${CHARACTER_DOWNTIME_TAB_ID}']`);
  const sheetApp = resolveCharacterDowntimeSheetApp(closeButton, app);
  if (!panel || !sheetApp) {
    return false;
  }

  if (handledCharacterDowntimeClickEvents.has(event)) {
    return true;
  }

  handledCharacterDowntimeClickEvents.add(event);
  event.preventDefault?.();
  event.stopPropagation?.();

  const now = Date.now();
  const lastCloseAt = recentCharacterDowntimeProjectCloseButtons.get(closeButton) ?? 0;
  if (now - lastCloseAt < CHARACTER_DOWNTIME_PROJECT_ACTION_DEBOUNCE_MS) {
    return true;
  }
  recentCharacterDowntimeProjectCloseButtons.set(closeButton, now);

  const wasDisabled = Boolean(closeButton.disabled);
  closeButton.disabled = true;
  try {
    const actor = getActorFromSheetApp(sheetApp);
    const requestId = cleanText(closeButton.dataset.requestId);
    if (!actor || !requestId) {
      return true;
    }
    await moduleApi.closeDowntimeProject({
      requestId,
      actorId: actor.id,
      groupId: cleanText(closeButton.dataset.groupId)
    });
    ui.notifications?.info("Проект закрыт.");
    await rerenderActorSheet(sheetApp, moduleApi);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to close character downtime project.`, error);
    ui.notifications?.error(error.message || "Не удалось закрыть проект.");
  }
  finally {
    closeButton.disabled = wasDisabled;
  }

  return true;
}

function bindCharacterDowntimeSubmitDelegation(root, app, moduleApi) {
  if (root.dataset.rebreyaCharacterDowntimeSubmitDelegated === "true") {
    return;
  }

  root.dataset.rebreyaCharacterDowntimeSubmitDelegated = "true";
  const listener = async (event) => handleCharacterDowntimeSubmitClick(event, { root, app, moduleApi });
  for (const type of ["pointerup", "click"]) {
    root.addEventListener(type, listener, { capture: true });
  }
}

function bindCharacterDowntimeRollDelegation(root, app, moduleApi) {
  if (root.dataset.rebreyaCharacterDowntimeRollDelegated === "true") {
    return;
  }

  root.dataset.rebreyaCharacterDowntimeRollDelegated = "true";
  const listener = async (event) => handleCharacterDowntimeRollClick(event, { root, app, moduleApi });
  for (const type of ["pointerup", "click"]) {
    root.addEventListener(type, listener, { capture: true });
  }
}

function bindCharacterDowntimeEditDelegation(root, app, moduleApi) {
  if (root.dataset.rebreyaCharacterDowntimeEditDelegated === "true") {
    return;
  }

  root.dataset.rebreyaCharacterDowntimeEditDelegated = "true";
  const listener = async (event) => handleCharacterDowntimeEditRequestClick(event, { root, app, moduleApi });
  for (const type of ["pointerup", "click"]) {
    root.addEventListener(type, listener, { capture: true });
  }
}

function bindCharacterDowntimeContinueDelegation(root, app, moduleApi) {
  if (root.dataset.rebreyaCharacterDowntimeContinueDelegated === "true") {
    return;
  }

  root.dataset.rebreyaCharacterDowntimeContinueDelegated = "true";
  const listener = async (event) => handleCharacterDowntimeContinueClick(event, { root, app, moduleApi });
  for (const type of ["pointerup", "click"]) {
    root.addEventListener(type, listener, { capture: true });
  }
}

function bindCharacterDowntimeProjectCloseDelegation(root, app, moduleApi) {
  if (root.dataset.rebreyaCharacterDowntimeProjectCloseDelegated === "true") {
    return;
  }

  root.dataset.rebreyaCharacterDowntimeProjectCloseDelegated = "true";
  const listener = async (event) => handleCharacterDowntimeCloseProjectClick(event, { root, app, moduleApi });
  for (const type of ["pointerup", "click"]) {
    root.addEventListener(type, listener, { capture: true });
  }
}

function bindCharacterDowntimeDocumentSubmitDelegation(moduleApi) {
  if (characterDowntimeDocumentSubmitDelegated || !(globalThis.document?.addEventListener instanceof Function)) {
    return;
  }

  characterDowntimeDocumentSubmitDelegated = true;
  const listener = async (event) => {
    await handleCharacterDowntimeSubmitClick(event, { root: globalThis.document, moduleApi });
  };
  for (const type of ["pointerup", "click"]) {
    globalThis.document.addEventListener(type, listener, { capture: true });
  }
}

function bindCharacterDowntimeDocumentRollDelegation(moduleApi) {
  if (characterDowntimeDocumentRollDelegated || !(globalThis.document?.addEventListener instanceof Function)) {
    return;
  }

  characterDowntimeDocumentRollDelegated = true;
  const listener = async (event) => {
    await handleCharacterDowntimeRollClick(event, { root: globalThis.document, moduleApi });
  };
  for (const type of ["pointerup", "click"]) {
    globalThis.document.addEventListener(type, listener, { capture: true });
  }
}

function bindCharacterDowntimeDocumentEditDelegation(moduleApi) {
  if (characterDowntimeDocumentEditDelegated || !(globalThis.document?.addEventListener instanceof Function)) {
    return;
  }

  characterDowntimeDocumentEditDelegated = true;
  const listener = async (event) => {
    await handleCharacterDowntimeEditRequestClick(event, { root: globalThis.document, moduleApi });
  };
  for (const type of ["pointerup", "click"]) {
    globalThis.document.addEventListener(type, listener, { capture: true });
  }
}

function bindCharacterDowntimeDocumentContinueDelegation(moduleApi) {
  if (characterDowntimeDocumentContinueDelegated || !(globalThis.document?.addEventListener instanceof Function)) {
    return;
  }

  characterDowntimeDocumentContinueDelegated = true;
  const listener = async (event) => {
    await handleCharacterDowntimeContinueClick(event, { root: globalThis.document, moduleApi });
  };
  for (const type of ["pointerup", "click"]) {
    globalThis.document.addEventListener(type, listener, { capture: true });
  }
}

function bindCharacterDowntimeDocumentProjectCloseDelegation(moduleApi) {
  if (characterDowntimeDocumentProjectCloseDelegated || !(globalThis.document?.addEventListener instanceof Function)) {
    return;
  }

  characterDowntimeDocumentProjectCloseDelegated = true;
  const listener = async (event) => {
    await handleCharacterDowntimeCloseProjectClick(event, { root: globalThis.document, moduleApi });
  };
  for (const type of ["pointerup", "click"]) {
    globalThis.document.addEventListener(type, listener, { capture: true });
  }
}

function bindCharacterDowntimeSubmitButton(panel, app, moduleApi) {
  const submitButton = panel.querySelector("[data-action='character-downtime-submit']");
  if (!(submitButton instanceof HTMLElement)) {
    return;
  }

  submitButton.dataset.rebreyaCharacterDowntimeSubmitButtonBound = "true";
  characterDowntimeSubmitAbortControllers.get(submitButton)?.abort();
  const abortController = new AbortController();
  characterDowntimeSubmitAbortControllers.set(submitButton, abortController);
  const listener = async (event) => handleCharacterDowntimeSubmitClick(event, { app, moduleApi });
  for (const type of ["pointerup", "click"]) {
    submitButton.addEventListener(type, listener, { capture: true, signal: abortController.signal });
  }
}

function bindCharacterDowntimeRollButtons(panel, app, moduleApi) {
  const rollButtons = Array.from(panel.querySelectorAll("[data-action='character-downtime-roll']") ?? []);
  for (const rollButton of rollButtons) {
    if (!(rollButton instanceof HTMLElement)) {
      continue;
    }

    rollButton.dataset.rebreyaCharacterDowntimeRollButtonBound = "true";
    characterDowntimeRollAbortControllers.get(rollButton)?.abort();
    const abortController = new AbortController();
    characterDowntimeRollAbortControllers.set(rollButton, abortController);
    const listener = async (event) => handleCharacterDowntimeRollClick(event, { app, moduleApi });
    for (const type of ["pointerup", "click"]) {
      rollButton.addEventListener(type, listener, { capture: true, signal: abortController.signal });
    }
  }
}

function bindCharacterDowntimeStateControls(panel, app, moduleApi) {
  const actor = getActorFromSheetApp(app);
  if (!actor?.id) {
    return;
  }

  characterDowntimeStateAbortControllers.get(panel)?.abort();
  const abortController = new AbortController();
  characterDowntimeStateAbortControllers.set(panel, abortController);
  const listenerOptions = { capture: true, signal: abortController.signal };

  const weeksInput = panel.querySelector("[data-action='character-downtime-weeks']");
  if (weeksInput?.addEventListener instanceof Function) {
    weeksInput.addEventListener("change", (event) => {
      updateCharacterDowntimeFormState(actor, {
        weeks: toPositiveInteger(event.currentTarget?.value, 1)
      });
    }, listenerOptions);
  }

  const clearActionButton = panel.querySelector("[data-action='character-downtime-clear-action']");
  if (clearActionButton?.addEventListener instanceof Function) {
    clearActionButton.addEventListener("click", async (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      const actionInput = panel.querySelector("[data-action='character-downtime-action']");
      const actionLabel = panel.querySelector("[data-action='character-downtime-action-label']");
      if (actionInput) {
        actionInput.value = "";
      }
      if (actionLabel) {
        actionLabel.textContent = "Выбрать простой";
      }
      updateCharacterDowntimeFormState(actor, {
        editRequestId: "",
        actionId: "",
        weeks: toPositiveInteger(panel.querySelector("[data-action='character-downtime-weeks']")?.value, 1),
        targetActionSelections: [],
        selectedTemplate: null
      });
      await rerenderActorSheet(app, moduleApi);
    }, listenerOptions);
  }

  for (const select of Array.from(panel.querySelectorAll("[data-action='character-downtime-resource-choice']") ?? [])) {
    if (!(select instanceof HTMLElement) || !(select.addEventListener instanceof Function)) {
      continue;
    }

    select.addEventListener("change", () => {
      updateCharacterDowntimeFormState(actor, {
        targetActionSelections: readCharacterDowntimeTargetActionSelections(panel)
      });
    }, listenerOptions);
  }

  for (const control of Array.from(panel.querySelectorAll("[data-action='character-downtime-rank-choice'], [data-action='character-downtime-option-choice'], [data-action='character-downtime-option-checkbox'], [data-action='character-downtime-numeric-input'], [data-action='character-downtime-resource-quantity'], [data-action='character-downtime-formula-input'], [data-action='character-downtime-formula-result'], [data-action='character-downtime-description-title'], [data-action='character-downtime-description-text'], [data-action='character-downtime-check-source'], [data-action='character-downtime-check-ability'], [data-action='character-downtime-check-target'], [data-action='character-downtime-check-dc']") ?? [])) {
    if (!(control instanceof HTMLElement) || !(control.addEventListener instanceof Function)) {
      continue;
    }

    control.addEventListener("change", async () => {
      updateCharacterDowntimeFormState(actor, {
        targetActionSelections: readCharacterDowntimeTargetActionSelections(panel)
      });
      const action = cleanText(control?.dataset?.action);
      const targetActionId = cleanText(control?.dataset?.targetActionId);
      if (
        action === "character-downtime-check-source"
        || action === "character-downtime-rank-choice"
        || targetActionId.startsWith("craft-")
      ) {
        await rerenderActorSheet(app, moduleApi);
      }
    }, listenerOptions);
  }

  for (const control of Array.from(panel.querySelectorAll("[data-action='character-downtime-item-choice']") ?? [])) {
    if (!(control instanceof HTMLElement) || !(control.addEventListener instanceof Function)) {
      continue;
    }

    control.addEventListener("dragover", (event) => {
      event.preventDefault?.();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      control.classList?.add?.("is-dragover");
    }, listenerOptions);
    control.addEventListener("dragleave", () => {
      control.classList?.remove?.("is-dragover");
    }, listenerOptions);
    control.addEventListener("drop", async (event) => {
      try {
        control.classList?.remove?.("is-dragover");
        await handleCharacterDowntimeItemChoiceDrop(event, control, panel, app, moduleApi);
      }
      catch (error) {
        control.classList?.remove?.("is-dragover");
        console.error(`${MODULE_ID} | Failed to select downtime item.`, error);
        ui.notifications?.error(error.message || "Не удалось выбрать предмет для простоя.");
      }
    }, listenerOptions);

    const clearButton = control.querySelector?.("[data-action='character-downtime-clear-item-choice']");
    if (clearButton?.addEventListener instanceof Function) {
      clearButton.addEventListener("click", async (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        clearCharacterDowntimeItemChoice(control);
        clearCharacterDowntimeDerivedItemSelections(panel, control);
        const actor = getActorFromSheetApp(app);
        if (actor?.id) {
          updateCharacterDowntimeFormState(actor, {
            targetActionSelections: readCharacterDowntimeTargetActionSelections(panel)
          });
          await rerenderActorSheet(app, moduleApi);
        }
      }, listenerOptions);
    }
  }

  for (const button of Array.from(panel.querySelectorAll("[data-action='character-downtime-page']") ?? [])) {
    if (!(button instanceof HTMLElement)) {
      continue;
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      const target = event.currentTarget;
      const pageType = cleanText(target?.dataset?.pageType);
      const delta = cleanText(target?.dataset?.direction) === "next" ? 1 : -1;
      const state = getCharacterDowntimeFormState(actor.id);
      if (pageType === "archive") {
        updateCharacterDowntimeFormState(actor, {
          archivePage: Math.max(1, toPositiveInteger(state.archivePage, 1) + delta)
        });
      }
      else if (pageType === "currentProject") {
        updateCharacterDowntimeFormState(actor, {
          currentProjectPage: Math.max(1, toPositiveInteger(state.currentProjectPage, 1) + delta)
        });
      }
      else {
        updateCharacterDowntimeFormState(actor, {
          requestPage: Math.max(1, toPositiveInteger(state.requestPage, 1) + delta)
        });
      }
      await rerenderActorSheet(app, moduleApi);
    }, listenerOptions);
  }
}

function bindCharacterDowntimeLibraryButton(panel, app, moduleApi) {
  const button = panel.querySelector("[data-action='character-downtime-open-library']");
  if (!(button instanceof HTMLElement)) {
    return;
  }

  characterDowntimeLibraryAbortControllers.get(button)?.abort();
  const abortController = new AbortController();
  characterDowntimeLibraryAbortControllers.set(button, abortController);
  button.addEventListener("click", async (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    try {
      await openCharacterDowntimeLibraryPicker(panel, app, moduleApi);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open downtime library picker.`, error);
      ui.notifications?.error(error.message || "Не удалось открыть библиотеку простоя.");
    }
  }, { capture: true, signal: abortController.signal });
}

function bindCharacterDowntimePanel(root, app, moduleApi) {
  bindCharacterDowntimeSubmitDelegation(root, app, moduleApi);
  bindCharacterDowntimeRollDelegation(root, app, moduleApi);
  bindCharacterDowntimeEditDelegation(root, app, moduleApi);
  bindCharacterDowntimeContinueDelegation(root, app, moduleApi);
  bindCharacterDowntimeProjectCloseDelegation(root, app, moduleApi);

  const panel = root.querySelector(`[data-application-part='${CHARACTER_DOWNTIME_TAB_ID}'] .rm-character-downtime-tab`)
    ?? root.querySelector(`.rm-character-downtime-tab[data-tab='${CHARACTER_DOWNTIME_TAB_ID}']`);
  if (!panel) {
    if (root.dataset.rebreyaCharacterDowntimeWatch !== "true") {
      root.dataset.rebreyaCharacterDowntimeWatch = "true";
      const listener = (event) => {
        const tabTrigger = getEventTargetElement(event)?.closest?.(`[data-tab='${CHARACTER_DOWNTIME_TAB_ID}']`);
        if (!tabTrigger) {
          return;
        }

        window.setTimeout(() => bindCharacterDowntimePanel(root, app, moduleApi), 0);
      };
      for (const type of ["pointerup", "click"]) {
        root.addEventListener(type, listener, { capture: true });
      }
      window.setTimeout(() => bindCharacterDowntimePanel(root, app, moduleApi), 0);
    }

    return;
  }

  bindCharacterDowntimeSubmitButton(panel, app, moduleApi);
  bindCharacterDowntimeRollButtons(panel, app, moduleApi);
  bindCharacterDowntimeStateControls(panel, app, moduleApi);
  bindCharacterDowntimeLibraryButton(panel, app, moduleApi);
}

function clampItemRank(value) {
  const numericValue = Number(value ?? ITEM_RANK_MIN);
  if (!Number.isFinite(numericValue)) {
    return ITEM_RANK_MIN;
  }

  return Math.max(ITEM_RANK_MIN, Math.min(ITEM_RANK_MAX, Math.round(numericValue)));
}

function getItemRank(item) {
  if (!(item instanceof Item)) {
    return ITEM_RANK_MIN;
  }

  return clampItemRank(
    item.getFlag(MODULE_ID, "rank")
    ?? item.getFlag(MODULE_ID, "itemRank")
    ?? foundry.utils.getProperty(item, `flags.${MODULE_ID}.rank`)
    ?? ITEM_RANK_MIN
  );
}

function getItemSlotGroup(item) {
  if (!(item instanceof Item)) {
    return "";
  }

  const explicitGroup = normalizeHeroDollSlotGroup(
    item.getFlag(MODULE_ID, "itemSlot")
    ?? item.getFlag(MODULE_ID, "slot")
    ?? "",
    ""
  );
  if (explicitGroup) {
    return explicitGroup;
  }

  const explicitSlots = normalizeHeroDollSlots(
    item.getFlag(MODULE_ID, "heroDollSlots")
    ?? item.getFlag(MODULE_ID, "allowedHeroDollSlots")
    ?? foundry.utils.getProperty(item, `flags.${MODULE_ID}.heroDoll.slots`)
    ?? foundry.utils.getProperty(item, "system.heroDollSlots")
  );
  const inferredGroup = inferHeroDollSlotGroupFromSlots(explicitSlots, "");
  if (inferredGroup) {
    return inferredGroup;
  }

  const typeValue = String(foundry.utils.getProperty(item, "system.type.value") ?? "").trim().toLowerCase();
  if (item.type === "weapon") {
    return "hand";
  }

  if (item.type === "equipment") {
    if (typeValue === "ring") {
      return "ring";
    }

    if (["shield", "rod", "wand", "staff"].includes(typeValue)) {
      return "hand";
    }
  }

  if (item.type === "consumable" && typeValue === "ammo") {
    return "back";
  }

  return "";
}

function hasItemProperty(item, propertyKey) {
  if (!(item instanceof Item)) {
    return false;
  }

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

  if (Array.isArray(properties)) {
    return properties.includes(safePropertyKey);
  }

  if (properties instanceof Set) {
    return properties.has(safePropertyKey);
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

function hasMagicalProperty(item) {
  return hasItemProperty(item, "mgc");
}

function isFirearmWeaponItem(item) {
  if (!(item instanceof Item) || item.type !== "weapon") {
    return false;
  }

  const typeValue = String(foundry.utils.getProperty(item, "system.type.value") ?? "").trim();
  if (FIREARM_WEAPON_TYPE_VALUES.has(typeValue)) {
    return true;
  }

  const firearmClass = String(
    item.getFlag?.(MODULE_ID, "firearmClass")
    ?? foundry.utils.getProperty(item, `flags.${MODULE_ID}.firearmClass`)
    ?? ""
  ).trim();
  return Boolean(firearmClass);
}

function findAncestorElement(element, predicate) {
  let cursor = element?.parentElement ?? null;
  while (cursor) {
    if (predicate(cursor)) {
      return cursor;
    }
    cursor = cursor.parentElement ?? null;
  }

  return null;
}

function findSheetPropertyControl(root, propertyKey) {
  return root.querySelector(
    `dnd5e-checkbox[name='system.properties.${propertyKey}'], input[name='system.properties.${propertyKey}']`
  );
}

function findSheetPropertyControls(root, propertyKey) {
  return Array.from(root.querySelectorAll(
    `dnd5e-checkbox[name='system.properties.${propertyKey}'], input[name='system.properties.${propertyKey}']`
  ) ?? []);
}

function getSheetPropertyRow(control) {
  return control?.closest?.("label")
    ?? control?.closest?.(".form-group")
    ?? control?.parentElement
    ?? control;
}

function findSheetPropertyFieldset(control, row) {
  return control?.closest?.("fieldset")
    ?? row?.closest?.("fieldset")
    ?? findAncestorElement(row, (element) => String(element.tagName ?? "").toUpperCase() === "FIELDSET")
    ?? null;
}

function setLocalWeaponProperty(item, propertyKey, checked) {
  const properties = foundry.utils.getProperty(item, "system.properties");
  if (Array.isArray(properties)) {
    const index = properties.indexOf(propertyKey);
    if (checked && index === -1) {
      properties.push(propertyKey);
    }
    else if (!checked && index !== -1) {
      properties.splice(index, 1);
    }
    return;
  }

  if (properties instanceof Set) {
    if (checked) {
      properties.add(propertyKey);
    }
    else {
      properties.delete(propertyKey);
    }
    return;
  }

  if (properties && typeof properties === "object") {
    properties[propertyKey] = checked;
  }
}

function removeNativeFirearmPropertyRows(root) {
  for (const definition of FIREARM_WEAPON_PROPERTY_DEFINITIONS) {
    for (const control of findSheetPropertyControls(root, definition.key)) {
      if (control.dataset?.rebreyaFirearmProperty === definition.key) {
        continue;
      }

      const row = getSheetPropertyRow(control);
      row?.remove?.();
    }
  }
}

function isSheetWeaponPropertyChecked(root, item, propertyKey) {
  const safePropertyKey = String(propertyKey ?? "").trim();
  if (!safePropertyKey) {
    return false;
  }

  const customCheckbox = root.querySelector(`input[data-rebreya-firearm-property='${safePropertyKey}']`);
  if (customCheckbox) {
    return Boolean(customCheckbox.checked);
  }

  const checkbox = root.querySelector(`dnd5e-checkbox[name='system.properties.${safePropertyKey}'], input[name='system.properties.${safePropertyKey}']`);
  if (checkbox) {
    if (typeof checkbox.checked === "boolean") {
      return checkbox.checked;
    }
    return checkbox.hasAttribute("checked");
  }

  return hasItemProperty(item, safePropertyKey);
}

function ensureEquipmentTypeOptions(root, item) {
  if (!(item instanceof Item) || item.type !== "equipment") {
    return;
  }

  const typeSelect = root.querySelector("select[name='system.type.value']");
  if (!(typeSelect instanceof HTMLSelectElement)) {
    return;
  }

  const requiredOptions = [
    { value: "staff", label: "Посох" },
    { value: "wand", label: "Волшебная палочка" }
  ];

  for (const requiredOption of requiredOptions) {
    const existing = typeSelect.querySelector(`option[value='${requiredOption.value}']`);
    if (existing) {
      if (!String(existing.textContent ?? "").trim()) {
        existing.textContent = requiredOption.label;
      }
      continue;
    }

    const option = document.createElement("option");
    option.value = requiredOption.value;
    option.textContent = requiredOption.label;
    typeSelect.append(option);
  }
}

function upsertToolBaseItemOptions(root, app) {
  const item = getItemFromSheetApp(app);
  if (!(item instanceof Item) || item.type !== "tool") {
    return;
  }

  const typeSelect = root.querySelector("select[name='system.type.value']");
  const select = root.querySelector("select[name='system.type.baseItem']");
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }
  if (typeSelect instanceof HTMLSelectElement && typeSelect.dataset.rebreyaToolTypeBound !== "true") {
    typeSelect.dataset.rebreyaToolTypeBound = "true";
    typeSelect.addEventListener("change", () => {
      window.setTimeout(() => {
        upsertToolBaseItemOptions(root, app);
      }, 0);
    });
  }

  // Keep dnd5e's dynamic base-item behavior for non-artisan tools (music, game, etc.).
  const toolTypeValue = String(
    typeSelect?.value
    ?? foundry.utils.getProperty(item, "system.type.value")
    ?? ""
  ).trim().toLowerCase();
  if (toolTypeValue !== "art") {
    select.classList.remove("rm-rebreya-tool-select");
    return;
  }

  const editable = isSheetEditable(app, root);
  const currentValue = String(
    item.getFlag(MODULE_ID, "rebreyaToolId")
    ?? foundry.utils.getProperty(item, "system.type.baseItem")
    ?? select.value
    ?? ""
  ).trim();
  const normalizedCurrentValue = normalizeRebreyaToolId(currentValue);

  select.disabled = !editable;
  select.classList.add("rm-rebreya-tool-select");

  const appendOption = (value, label, selected = false) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = selected;
    select.append(option);
  };

  const currentOptionValues = Array.from(select.options).map((option) => String(option.value ?? ""));
  const isAlreadyRebreyaCatalog = currentOptionValues.length === REBREYA_TOOLS.length
    && REBREYA_TOOLS.every((tool, index) => currentOptionValues[index] === tool.id);

  if (!isAlreadyRebreyaCatalog) {
    select.innerHTML = "";
    for (const tool of REBREYA_TOOLS) {
      appendOption(tool.id, tool.label, tool.id === normalizedCurrentValue);
    }

    if (!normalizedCurrentValue && currentValue) {
      appendOption(currentValue, currentValue, true);
    }
  }

  if (normalizedCurrentValue) {
    select.value = normalizedCurrentValue;
  }
  else if (!select.value && REBREYA_TOOLS.length > 0) {
    select.value = REBREYA_TOOLS[0].id;
  }

  if (select.dataset.rebreyaToolBound !== "true") {
    select.dataset.rebreyaToolBound = "true";
    select.addEventListener("change", async (event) => {
      if (!isSheetEditable(app, root)) {
        return;
      }

      try {
        const activeToolType = String(
          typeSelect?.value
          ?? foundry.utils.getProperty(item, "system.type.value")
          ?? ""
        ).trim().toLowerCase();
        if (activeToolType !== "art") {
          return;
        }

        const selectedToolId = normalizeRebreyaToolId(event.currentTarget.value) || String(event.currentTarget.value ?? "").trim();
        const selectedToolLabel = REBREYA_TOOL_LABEL_BY_ID.get(selectedToolId) ?? selectedToolId;
        await item.update({
          "system.type.baseItem": selectedToolId || null,
          [`flags.${MODULE_ID}.rebreyaToolId`]: selectedToolId || null,
          [`flags.${MODULE_ID}.rebreyaToolLabel`]: selectedToolLabel || null
        });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to update Rebreya tool base item.`, error);
        ui.notifications?.error("Не удалось обновить базовый инструмент.");
      }
    });
  }
}

function upsertItemRankBadge(root, item) {
  const subtitles = root.querySelector(".sheet-header .subtitles");
  if (!subtitles) {
    return;
  }

  subtitles.querySelectorAll("[data-rebreya-rank-badge='true']").forEach((badge) => badge.remove());

  const rank = getItemRank(item);
  const badge = document.createElement("li");
  badge.dataset.rebreyaRankBadge = "true";
  badge.textContent = `Ранг ${rank}`;
  subtitles.append(badge);
}

function createFormGroup(labelText) {
  const group = document.createElement("div");
  group.classList.add("form-group");
  group.classList.add("rm-rebreya-item-field");

  const label = document.createElement("label");
  label.textContent = labelText;
  group.append(label);

  const fields = document.createElement("div");
  fields.classList.add("form-fields");
  group.append(fields);

  return { group, fields };
}

function getItemDetailsContainer(root) {
  return root.querySelector(".tab[data-tab='details']") ?? null;
}

function insertGroupIntoDetails(root, group, { key = "" } = {}) {
  const details = getItemDetailsContainer(root);
  if (!details) {
    return null;
  }

  if (key) {
    details.querySelectorAll(`[data-rebreya-item-field='${key}']`).forEach((node) => node.remove());
    group.dataset.rebreyaItemField = key;
  }

  const firstFieldset = details.querySelector("fieldset");
  if (firstFieldset) {
    firstFieldset.prepend(group);
  }
  else {
    details.prepend(group);
  }

  return group;
}

function upsertItemRankField(root, app) {
  const details = getItemDetailsContainer(root);
  if (!details) {
    return;
  }

  const item = getItemFromSheetApp(app);
  if (!item) {
    return;
  }

  const editable = isSheetEditable(app, root);
  const { group, fields } = createFormGroup("Ранг");
  const select = document.createElement("select");
  select.classList.add("unselect");
  select.disabled = !editable;
  for (let rank = ITEM_RANK_MIN; rank <= ITEM_RANK_MAX; rank += 1) {
    const option = document.createElement("option");
    option.value = String(rank);
    option.textContent = String(rank);
    option.selected = rank === getItemRank(item);
    select.append(option);
  }

  select.addEventListener("change", async (event) => {
    if (!editable) {
      return;
    }

    try {
      const nextRank = clampItemRank(event.currentTarget.value);
      await item.update({
        [`flags.${MODULE_ID}.rank`]: nextRank
      });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to update item rank.`, error);
      ui.notifications?.error("Не удалось обновить ранг предмета.");
    }
  });

  fields.append(select);
  insertGroupIntoDetails(root, group, { key: "rank" });
}

function upsertItemSlotField(root, app) {
  const details = getItemDetailsContainer(root);
  if (!details) {
    return;
  }

  const item = getItemFromSheetApp(app);
  if (!item) {
    return;
  }

  const editable = isSheetEditable(app, root);
  details.querySelectorAll("[data-rebreya-item-field='slot']").forEach((node) => node.remove());
  if (!ITEM_SLOT_ELIGIBLE_TYPES.has(item.type)) {
    return;
  }

  if (!hasMagicalProperty(item)) {
    return;
  }

  const slotGroups = getHeroDollSlotGroups();
  const currentGroup = getItemSlotGroup(item);
  const { group, fields } = createFormGroup("Слот");
  const select = document.createElement("select");
  select.classList.add("unselect");
  select.disabled = !editable;

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Не выбран";
  emptyOption.selected = currentGroup === "";
  select.append(emptyOption);

  for (const slotGroup of slotGroups) {
    const option = document.createElement("option");
    option.value = slotGroup.id;
    option.textContent = slotGroup.label;
    option.selected = slotGroup.id === currentGroup;
    select.append(option);
  }

  select.addEventListener("change", async (event) => {
    if (!editable) {
      return;
    }

    try {
      const nextGroup = normalizeHeroDollSlotGroup(event.currentTarget.value, "");
      const nextSlots = mapSlotGroupToHeroDollSlots(nextGroup, []);
      await item.update({
        [`flags.${MODULE_ID}.itemSlot`]: nextGroup || null,
        [`flags.${MODULE_ID}.heroDollSlots`]: nextSlots,
        [`flags.${MODULE_ID}.allowedHeroDollSlots`]: nextSlots
      });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to update item slot.`, error);
      ui.notifications?.error("Не удалось обновить слот предмета.");
    }
  });

  fields.append(select);
  insertGroupIntoDetails(root, group, { key: "slot" });
}

function upsertWeaponAttackTraitsField(root, app) {
  const details = getItemDetailsContainer(root);
  if (!details) {
    return;
  }

  details.querySelectorAll("[data-rebreya-item-field='attack-traits']").forEach((node) => node.remove());

  const item = getItemFromSheetApp(app);
  if (!(item instanceof Item) || item.type !== "weapon") {
    details.querySelectorAll("[data-rebreya-item-field='attack-traits-values']").forEach((node) => node.remove());
    return;
  }

  const currentValues = getLichWeaponPropertyValues(item);
  const editable = isSheetEditable(app, root);
  const { group, fields } = createFormGroup("Параметры свойств [L]");
  const valuesGrid = document.createElement("div");
  valuesGrid.classList.add("rm-weapon-lich-values-grid");
  const rows = [];

  for (const field of LICH_WEAPON_VALUE_FIELDS) {
    const row = document.createElement("div");
    row.classList.add("rm-weapon-lich-value-row");
    row.dataset.rebreyaLichPropertyKey = String(field.propertyKey ?? "");

    const label = document.createElement("label");
    label.textContent = field.label;
    row.append(label);

    const input = document.createElement("input");
    input.type = field.type === "number" ? "number" : "text";
    input.disabled = !editable;
    input.classList.add("untext");
    if (field.type === "number") {
      input.inputMode = "numeric";
      input.min = String(field.min ?? 0);
      input.step = String(field.step ?? 1);
    }
    if (field.placeholder) {
      input.placeholder = field.placeholder;
    }

    const currentValue = currentValues[field.key];
    input.value = currentValue === undefined || currentValue === null ? "" : String(currentValue);
    input.dataset.rebreyaLichValueKey = field.key;

    input.addEventListener("change", async (event) => {
      if (!editable) {
        return;
      }

      try {
        const nextValues = getLichWeaponPropertyValues(item);
        const rawValue = String(event.currentTarget.value ?? "").trim();

        if (!rawValue) {
          delete nextValues[field.key];
        }
        else {
          nextValues[field.key] = normalizeLichWeaponValue(field, rawValue);
        }

        const cleanedValues = Object.fromEntries(
          Object.entries(nextValues).filter(([, value]) => {
            if (value === null || value === undefined) {
              return false;
            }
            if (typeof value === "string") {
              return value.trim().length > 0;
            }
            return true;
          })
        );

        const attackTraits = {
          mku: normalizeNonNegativeInteger(cleanedValues.mku, 0),
          mu: normalizeNonNegativeInteger(cleanedValues.mu, 0),
          rku: normalizeNonNegativeInteger(cleanedValues.rku, 0)
        };
        const hasAnyAttackTrait = Object.values(attackTraits).some((value) => value > 0);

        await item.update({
          [`flags.${MODULE_ID}.lichWeaponPropertyValues`]: Object.keys(cleanedValues).length > 0 ? cleanedValues : null,
          [`flags.${MODULE_ID}.attackTraits`]: hasAnyAttackTrait ? attackTraits : null
        });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to update Lich weapon property values.`, error);
        ui.notifications?.error("Не удалось обновить параметры свойств [L].");
      }
    });

    row.append(input);
    valuesGrid.append(row);
    rows.push({ field, row });
  }

  fields.append(valuesGrid);
  insertGroupIntoDetails(root, group, { key: "attack-traits-values" });

  const syncVisibility = () => {
    let visibleRows = 0;
    for (const entry of rows) {
      const propertyKey = String(entry.field.propertyKey ?? "").trim();
      const shouldShow = propertyKey
        ? isSheetWeaponPropertyChecked(root, item, propertyKey)
        : true;
      entry.row.style.display = shouldShow ? "" : "none";
      if (shouldShow) {
        visibleRows += 1;
      }
    }

    group.style.display = visibleRows > 0 ? "" : "none";
  };

  const watchedPropertyKeys = new Set(
    rows
      .map((entry) => String(entry.field.propertyKey ?? "").trim())
      .filter(Boolean)
  );
  for (const propertyKey of watchedPropertyKeys) {
    const controls = root.querySelectorAll(
      `dnd5e-checkbox[name='system.properties.${propertyKey}'], input[name='system.properties.${propertyKey}']`
    );
    for (const control of controls) {
      control.addEventListener("change", () => {
        syncVisibility();
      });
      control.addEventListener("click", () => {
        window.setTimeout(() => syncVisibility(), 0);
      });
    }
  }

  syncVisibility();
}

function upsertFirearmWeaponPropertiesField(root, app) {
  const details = getItemDetailsContainer(root);
  if (!details) {
    return;
  }

  details.querySelectorAll("[data-rebreya-item-field='firearm-properties']").forEach((node) => node.remove());
  removeNativeFirearmPropertyRows(root);

  const item = getItemFromSheetApp(app);
  if (!isFirearmWeaponItem(item)) {
    return;
  }

  const editable = isSheetEditable(app, root);
  const fieldset = document.createElement("fieldset");
  fieldset.classList.add("rm-firearm-properties-fieldset");
  fieldset.dataset.rebreyaItemField = "firearm-properties";

  const legend = document.createElement("legend");
  legend.textContent = "Свойства огнестрела";
  fieldset.append(legend);

  const grid = document.createElement("div");
  grid.classList.add("rm-firearm-properties-grid");
  for (const definition of FIREARM_WEAPON_PROPERTY_DEFINITIONS) {
    const row = document.createElement("label");
    row.classList.add("rm-firearm-property-row");
    row.dataset.rebreyaFirearmPropertyRow = definition.key;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = `system.properties.${definition.key}`;
    input.checked = hasItemProperty(item, definition.key);
    input.disabled = !editable;
    input.dataset.rebreyaFirearmProperty = definition.key;

    const text = document.createElement("span");
    text.textContent = definition.label;

    input.addEventListener("change", async (event) => {
      if (!editable) {
        return;
      }

      const checked = Boolean(event.currentTarget.checked);
      setLocalWeaponProperty(item, definition.key, checked);
      try {
        await item.update?.({
          [`system.properties.${definition.key}`]: checked
        });
      }
      catch (error) {
        event.currentTarget.checked = !checked;
        setLocalWeaponProperty(item, definition.key, !checked);
        console.error(`${MODULE_ID} | Failed to update firearm weapon property.`, error);
        ui.notifications?.error?.("Не удалось обновить свойство огнестрела.");
      }
    });

    row.append(input, text);
    grid.append(row);
  }
  fieldset.append(grid);

  const firstFieldset = details.querySelector("fieldset");
  if (firstFieldset?.parentElement && typeof firstFieldset.after === "function") {
    firstFieldset.after(fieldset);
  }
  else {
    details.append(fieldset);
  }
}

function bindItemSheetEnhancements(root, app, moduleApi = null) {
  const item = getItemFromSheetApp(app);
  if (!item) {
    return;
  }

  ensureEquipmentTypeOptions(root, item);
  upsertToolBaseItemOptions(root, app);
  upsertItemRankBadge(root, item);
  upsertItemRankField(root, app);
  upsertItemSlotField(root, app);
  upsertFirearmWeaponPropertiesField(root, app);
  upsertWeaponAttackTraitsField(root, app);
  bindItemUpgradeSheet(root, app, moduleApi);
}

function resolveActorItem(actor, itemId) {
  const id = cleanText(itemId);
  if (!actor || !id) {
    return null;
  }

  const directItem = actor.items?.get?.(id);
  if (directItem) {
    return directItem;
  }

  const items = Array.isArray(actor.items?.contents)
    ? actor.items.contents
    : Array.isArray(actor.items)
      ? actor.items
      : [];
  return items.find((item) => cleanText(item?.id ?? item?._id) === id) ?? null;
}

function resolveItemActivity(item, activityId) {
  const id = cleanText(activityId);
  if (!item || !id) {
    return null;
  }

  for (const [entryId, activity] of getActivityEntries(item.system?.activities)) {
    if (cleanText(entryId) === id || cleanText(activity?.id ?? activity?._id) === id) {
      return activity;
    }
  }

  return null;
}

function getActorFromItem(item) {
  const actor = item?.actor ?? item?.parent ?? null;
  return actor instanceof Actor ? actor : null;
}

function resolveActivityRowItem(actor, row, fallbackItem = null) {
  if (!(row instanceof HTMLElement)) {
    return null;
  }

  const itemRow = row.closest?.("[data-item-id]")
    ?? findAncestorElement(row, (ancestor) => Boolean(cleanText(ancestor?.dataset?.itemId)));
  const itemId = cleanText(itemRow?.dataset?.itemId);
  if (!itemId) {
    return fallbackItem ?? null;
  }

  return resolveActorItem(actor, itemId)
    ?? (cleanText(fallbackItem?.id ?? fallbackItem?._id) === itemId ? fallbackItem : null);
}

function buildSheetActivityContext(activity, item, actor, activityId) {
  if (!activity || typeof activity !== "object") {
    return null;
  }

  const id = cleanText(activity.id ?? activity._id ?? activityId);
  const context = Object.create(activity);
  Object.defineProperties(context, {
    id: {
      value: id,
      configurable: true
    },
    _id: {
      value: cleanText(activity._id ?? activity.id ?? activityId),
      configurable: true
    },
    item: {
      value: activity.item ?? item,
      configurable: true
    },
    actor: {
      value: activity.actor ?? actor,
      configurable: true
    }
  });
  return context;
}

function getActivityRowNameStack(row) {
  return row.querySelector?.(".activity-name .name-stacked")
    ?? row.querySelector?.(".name.name-stacked")
    ?? row.querySelector?.(".name-stacked")
    ?? null;
}

function getActivityBadgeTarget(row) {
  const nameStack = getActivityRowNameStack(row);
  if (nameStack instanceof HTMLElement) {
    return {
      element: nameStack,
      kind: "row"
    };
  }

  const buttonName = row.querySelector?.(".name") ?? null;
  if (buttonName instanceof HTMLElement) {
    return {
      element: buttonName,
      kind: "choice"
    };
  }

  return null;
}

function removeElementAttribute(element, name) {
  if (typeof element?.removeAttribute === "function") {
    element.removeAttribute(name);
    return;
  }

  if (element?.attributes && typeof element.attributes === "object") {
    delete element.attributes[name];
  }
}

function blockUnavailableActivityChoiceEvent(event, row) {
  if (row?.dataset?.rebreyaActivityUnavailable !== "true") {
    return;
  }

  event?.preventDefault?.();
  event?.stopPropagation?.();
  event?.stopImmediatePropagation?.();
}

function resetActivityUnavailableInteraction(row) {
  row.classList.remove(
    "rm-activity-unavailable",
    "rm-activity-unavailable--row",
    "rm-activity-unavailable--choice"
  );
  delete row.dataset.rebreyaActivityUnavailable;

  if (row.dataset.rebreyaActivityChoiceGuardBound === "true") {
    row.disabled = false;
    row.tabIndex = 0;
    removeElementAttribute(row, "disabled");
    removeElementAttribute(row, "aria-disabled");
  }
}

function applyActivityUnavailableInteraction(row, target) {
  row.classList.add("rm-activity-unavailable");
  row.classList.add(`rm-activity-unavailable--${target.kind}`);
  row.dataset.rebreyaActivityUnavailable = "true";

  if (target.kind !== "choice") {
    return;
  }

  row.disabled = true;
  row.tabIndex = -1;
  row.setAttribute?.("disabled", "");
  row.setAttribute?.("aria-disabled", "true");

  if (row.dataset.rebreyaActivityChoiceGuardBound === "true") {
    return;
  }

  row.dataset.rebreyaActivityChoiceGuardBound = "true";
  for (const eventName of ["pointerdown", "click", "keydown"]) {
    row.addEventListener?.(eventName, (event) => {
      blockUnavailableActivityChoiceEvent(event, row);
    }, { capture: true });
  }
}

function bindActivityAvailabilityBadges(root, { actor = null, item = null, moduleApi } = {}) {
  const contextActor = actor instanceof Actor ? actor : getActorFromItem(item);
  const fallbackItem = item ?? null;
  if (!(root instanceof HTMLElement) || (!contextActor && !fallbackItem)) {
    return;
  }

  for (const badge of Array.from(root.querySelectorAll?.("[data-rebreya-activity-unavailable='true']") ?? [])) {
    badge?.remove?.();
  }

  const rows = Array.from(root.querySelectorAll?.("[data-activity-id]") ?? []);
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) {
      continue;
    }
    resetActivityUnavailableInteraction(row);
  }

  const service = moduleApi?.combatAttackService;
  if (typeof service?.getActivityAvailability !== "function") {
    return;
  }

  for (const row of rows) {
    if (!(row instanceof HTMLElement)) {
      continue;
    }

    const activityId = cleanText(row.dataset.activityId);
    if (!activityId) {
      continue;
    }

    const activityItem = resolveActivityRowItem(contextActor, row, fallbackItem);
    const activity = resolveItemActivity(activityItem, activityId);
    const activityActor = contextActor ?? getActorFromItem(activityItem);
    const activityContext = buildSheetActivityContext(activity, activityItem, activityActor, activityId);
    if (!activityContext) {
      continue;
    }

    let availability = null;
    try {
      availability = service.getActivityAvailability(activityContext);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to resolve sheet activity availability.`, error);
      continue;
    }

    if (availability?.available !== false) {
      continue;
    }

    const target = getActivityBadgeTarget(row);
    if (!target) {
      continue;
    }

    const badge = document.createElement("span");
    badge.classList.add("rm-activity-unavailable-badge");
    badge.dataset.rebreyaActivityUnavailable = "true";
    badge.textContent = cleanText(availability.label) || ACTIVITY_UNAVAILABLE_LABEL;
    const title = cleanText(availability.title ?? availability.tooltip);
    if (title) {
      badge.title = title;
      badge.setAttribute("data-tooltip", title);
    }

    target.element.append(badge);
    applyActivityUnavailableInteraction(row, target);
  }
}

const HELD_ITEM_SHEET_ROWS = new Map();
const HELD_ITEM_ROW_KEYS = new WeakMap();
let heldItemUpdatedHookRegistered = false;

function getHeldItemSheetRowKey(actorId, itemId) {
  const safeActorId = cleanText(actorId);
  const safeItemId = cleanText(itemId);
  return safeActorId && safeItemId ? `${safeActorId}::${safeItemId}` : "";
}

function registerHeldItemSheetRow(actor, item, row, control) {
  if (!(row instanceof HTMLElement) || !(control instanceof HTMLElement)) {
    return;
  }

  const key = getHeldItemSheetRowKey(actor?.id ?? actor?._id, item?.id ?? item?._id);
  if (!key) {
    return;
  }

  const previousKey = HELD_ITEM_ROW_KEYS.get(row);
  if (previousKey && previousKey !== key) {
    HELD_ITEM_SHEET_ROWS.get(previousKey)?.delete(row);
  }

  HELD_ITEM_ROW_KEYS.set(row, key);
  const rows = HELD_ITEM_SHEET_ROWS.get(key) ?? new Map();
  rows.set(row, {
    actor,
    control,
    itemId: cleanText(item?.id ?? item?._id)
  });
  HELD_ITEM_SHEET_ROWS.set(key, rows);
}

function refreshHeldItemSheetRows({ actor, actorId, item, itemId } = {}) {
  const safeActor = actor ?? item?.actor ?? item?.parent ?? null;
  const key = getHeldItemSheetRowKey(actorId ?? safeActor?.id ?? safeActor?._id, itemId ?? item?.id ?? item?._id);
  if (!key) {
    return;
  }

  const rows = HELD_ITEM_SHEET_ROWS.get(key);
  if (!rows) {
    return;
  }

  for (const [row, entry] of Array.from(rows.entries())) {
    const control = entry.control instanceof HTMLElement ? entry.control : findHeldItemEquipControl(row);
    if (row?.isConnected === false || control?.isConnected === false) {
      rows.delete(row);
      HELD_ITEM_ROW_KEYS.delete(row);
      continue;
    }

    const currentActor = safeActor ?? entry.actor ?? null;
    const currentItem = item ?? resolveActorItem(currentActor, entry.itemId);
    if (!currentItem || !(control instanceof HTMLElement)) {
      continue;
    }

    applyHeldItemEquipPresentation(control, getHeldItemEquipPresentation(currentItem));
    applyHeldItemDamageFormulaPresentation(row, currentItem);
  }

  if (!rows.size) {
    HELD_ITEM_SHEET_ROWS.delete(key);
  }
}

function registerHeldItemUpdatedHook() {
  if (heldItemUpdatedHookRegistered || typeof globalThis.Hooks?.on !== "function") {
    return;
  }

  globalThis.Hooks.on(HELD_ITEM_UPDATED_HOOK, refreshHeldItemSheetRows);
  heldItemUpdatedHookRegistered = true;
}

function findHeldItemEquipControl(row) {
  for (const selector of HELD_ITEM_EQUIP_CONTROL_SELECTORS) {
    const control = row.querySelector?.(selector);
    if (control instanceof HTMLElement) {
      return control;
    }
  }

  return null;
}

function getHeldItemPresentationState(presentation) {
  const icon = cleanText(presentation?.icon);
  for (const [state, knownPresentation] of Object.entries(HELD_ITEM_PRESENTATIONS)) {
    if (presentation === knownPresentation || (icon && icon === cleanText(knownPresentation?.icon))) {
      return state;
    }
  }

  return "";
}

function applyHeldItemEquipState(control, presentation) {
  const state = getHeldItemPresentationState(presentation);
  control.classList.add("rm-held-item-control");
  control.classList.remove("is-held", "is-worn", "is-unheld");
  if (state) {
    control.dataset.rebreyaHeldState = state;
  }
  else {
    delete control.dataset.rebreyaHeldState;
  }

  if (state === "left" || state === "right" || state === "both") {
    control.classList.add("is-held");
  }
  else if (state === "worn") {
    control.classList.add("is-worn");
  }
  else {
    control.classList.add("is-unheld");
  }
}

function applyHeldItemEquipPresentation(control, presentation) {
  if (!(control instanceof HTMLElement) || !presentation) {
    return;
  }

  const label = cleanText(presentation.label);
  const icon = cleanText(presentation.icon);
  if (label) {
    control.setAttribute("title", label);
    control.setAttribute("aria-label", label);
    control.setAttribute("data-tooltip", label);
    control.dataset.tooltip = label;
  }

  if (icon) {
    const iconNode = control.querySelector?.("i");
    if (iconNode instanceof HTMLElement) {
      iconNode.className = icon;
    }
  }

  applyHeldItemEquipState(control, presentation);
}

function getHeldItemFormulaNodes(row) {
  const nodes = new Set();
  for (const selector of ["[data-column-id='formula'] .formula", ".item-formula .formula"]) {
    for (const node of Array.from(row?.querySelectorAll?.(selector) ?? [])) {
      if (node instanceof HTMLElement) {
        nodes.add(node);
      }
    }
  }

  return Array.from(nodes);
}

function applyHeldItemDamageFormulaPresentation(row, item) {
  if (!(row instanceof HTMLElement) || !item) {
    return;
  }

  for (const node of getHeldItemFormulaNodes(row)) {
    const baseFormula = cleanText(node.dataset.rebreyaBaseFormula) || cleanText(node.textContent);
    const displayFormula = getHeldItemDamageFormulaPresentation(item, baseFormula);
    if (!displayFormula || displayFormula === baseFormula) {
      if (node.dataset.rebreyaBaseFormula) {
        node.textContent = node.dataset.rebreyaBaseFormula;
        delete node.dataset.rebreyaBaseFormula;
      }
      continue;
    }

    node.dataset.rebreyaBaseFormula = baseFormula;
    node.textContent = displayFormula;
  }
}

async function confirmHeldItemReplacement(item, action) {
  const replacements = Array.isArray(action?.replacements) ? action.replacements : [];
  if (!replacements.length) {
    return true;
  }

  const replacedNames = Array.from(new Set(replacements.map((entry) => cleanText(entry.itemName)).filter(Boolean)));
  const itemName = cleanText(item?.name, "предмет");
  const content = `<p>Заменить ${escapeHtml(replacedNames.join(", ") || "предмет")} на ${escapeHtml(itemName)}?</p>`;
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.confirm === "function") {
    return DialogV2.confirm({
      window: {
        title: "Заменить предмет в руке"
      },
      content,
      yes: {
        label: "Заменить"
      },
      no: {
        label: "Отмена"
      }
    });
  }

  if (typeof globalThis.Dialog?.confirm === "function") {
    return globalThis.Dialog.confirm({
      title: "Заменить предмет в руке",
      content,
      yes: () => true,
      no: () => false,
      defaultYes: true
    });
  }

  return true;
}

async function releaseHeldItemReplacementSlots(actor, action) {
  const replacements = Array.isArray(action?.replacements) ? action.replacements : [];
  const releasedItems = [];
  const slotsByItemId = new Map();
  for (const replacement of replacements) {
    const itemId = cleanText(replacement.itemId);
    const slot = cleanText(replacement.slot);
    if (!itemId || !slot) {
      continue;
    }

    const slots = slotsByItemId.get(itemId) ?? [];
    slots.push(slot);
    slotsByItemId.set(itemId, slots);
  }

  for (const [itemId, slots] of slotsByItemId) {
    const replacementItem = resolveActorItem(actor, itemId);
    if (!replacementItem) {
      continue;
    }

    await replacementItem.update?.(buildHeldItemReleaseHandUpdate(replacementItem, slots), heldItemUpdateOptions());
    releasedItems.push(replacementItem);
  }

  return releasedItems;
}

function isShieldEquipmentItem(item) {
  return item?.type === "equipment" && cleanConfigString(item?.system?.type?.value).toLowerCase() === "shield";
}

function closeHeldItemContextMenu() {
  const existing = document.querySelector?.("[data-rebreya-held-item-context-menu='true']");
  existing?.remove?.();
}

function parseZIndex(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getElementZIndex(element) {
  const inlineZIndex = parseZIndex(element?.style?.zIndex);
  if (inlineZIndex !== null) {
    return inlineZIndex;
  }

  try {
    return parseZIndex(window.getComputedStyle?.(element)?.zIndex);
  }
  catch (_error) {
    return null;
  }
}

function getTopFoundryWindowZIndex() {
  const selectors = ".window-app, .application";
  return Array.from(document.querySelectorAll?.(selectors) ?? [])
    .reduce((maxZIndex, element) => {
      const zIndex = getElementZIndex(element);
      return zIndex === null ? maxZIndex : Math.max(maxZIndex, zIndex);
    }, 110);
}

function openHeldItemContextMenu({ x = 0, y = 0, title = "", actions = [] } = {}) {
  closeHeldItemContextMenu();
  if (!Array.isArray(actions) || !actions.length || !document?.body) {
    return null;
  }

  const menuRoot = document.createElement("div");
  menuRoot.classList.add("rm-context-menu");
  menuRoot.dataset.rebreyaHeldItemContextMenu = "true";
  menuRoot.setAttribute("role", "menu");

  if (title) {
    const titleNode = document.createElement("p");
    titleNode.classList.add("rm-context-menu__title");
    titleNode.textContent = title;
    menuRoot.append(titleNode);
  }

  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("rm-context-menu__item");
    if (action.occupied === true || action.carryOnly === true || action.muted === true) {
      button.classList.add("is-muted");
    }
    if (action.carryOnly === true) {
      button.dataset.carryOnly = "true";
    }
    button.disabled = action.disabled === true;
    button.dataset.action = action.id;
    if (action.tooltip) {
      button.setAttribute("title", action.tooltip);
      button.setAttribute("data-tooltip", action.tooltip);
      button.dataset.tooltip = action.tooltip;
    }
    if (action.disabledReason) {
      button.dataset.disabledReason = action.disabledReason;
    }

    if (action.icon) {
      const iconNode = document.createElement("i");
      iconNode.className = action.icon;
      button.append(iconNode);
    }

    const labelNode = document.createElement("span");
    labelNode.textContent = action.label ?? "";
    button.append(labelNode);
    button.addEventListener("click", async (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (button.disabled) {
        return;
      }

      closeHeldItemContextMenu();
      try {
        await action.callback?.();
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to run held item context action.`, error);
        ui.notifications?.error?.(error.message || "Не удалось изменить состояние предмета.");
      }
    });

    menuRoot.append(button);
  }

  document.body.append(menuRoot);
  menuRoot.style.zIndex = String(getTopFoundryWindowZIndex() + 10);

  const bounds = typeof menuRoot.getBoundingClientRect === "function"
    ? menuRoot.getBoundingClientRect()
    : { width: 220, height: 180 };
  const maxLeft = Number.isFinite(window.innerWidth) ? window.innerWidth - bounds.width - 8 : x;
  const maxTop = Number.isFinite(window.innerHeight) ? window.innerHeight - bounds.height - 8 : y;
  const safeLeft = Math.max(8, Math.min(x, maxLeft));
  const safeTop = Math.max(8, Math.min(y, maxTop));
  menuRoot.style.left = `${safeLeft}px`;
  menuRoot.style.top = `${safeTop}px`;

  const closeOnPointerDown = (event) => {
    if (!menuRoot.contains(event.target)) {
      closeHeldItemContextMenu();
      document.removeEventListener?.("pointerdown", closeOnPointerDown, true);
      document.removeEventListener?.("keydown", closeOnKeyDown, true);
    }
  };
  const closeOnKeyDown = (event) => {
    if (event.key === "Escape") {
      closeHeldItemContextMenu();
      document.removeEventListener?.("pointerdown", closeOnPointerDown, true);
      document.removeEventListener?.("keydown", closeOnKeyDown, true);
    }
  };

  document.addEventListener?.("pointerdown", closeOnPointerDown, true);
  document.addEventListener?.("keydown", closeOnKeyDown, true);
  return menuRoot;
}

function bindHeldItemEquipContextMenu(root, { actor, app, moduleApi } = {}) {
  if (!(root instanceof HTMLElement) || !actor) {
    return;
  }

  for (const row of Array.from(root.querySelectorAll?.("[data-item-id]") ?? [])) {
    if (!(row instanceof HTMLElement)) {
      continue;
    }

    const item = resolveActorItem(actor, row.dataset.itemId);
    if (!item || !isHeldItemEligible(item)) {
      continue;
    }

    const control = findHeldItemEquipControl(row);
    if (!(control instanceof HTMLElement)) {
      continue;
    }

    applyHeldItemEquipPresentation(control, getHeldItemEquipPresentation(item));
    applyHeldItemDamageFormulaPresentation(row, item);
    registerHeldItemSheetRow(actor, item, row, control);

    if (row.dataset.rebreyaHeldItemContextBound === "true") {
      continue;
    }

    row.dataset.rebreyaHeldItemContextBound = "true";
    control.addEventListener("contextmenu", (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      const actions = buildHeldItemEquipMenuActions(actor, item).map((action) => ({
        ...action,
        callback: async () => {
          if (!await confirmHeldItemReplacement(item, action)) {
            return;
          }

          const releasedItems = await releaseHeldItemReplacementSlots(actor, action);
          const updatedItem = await item.update?.(action.update, heldItemUpdateOptions());
          const presentationItem = updatedItem ?? item;
          applyHeldItemEquipPresentation(control, action);
          applyHeldItemDamageFormulaPresentation(row, presentationItem);
          if (isShieldEquipmentItem(presentationItem) || releasedItems.some((releasedItem) => isShieldEquipmentItem(releasedItem))) {
            await rerenderActorSheet(app, moduleApi);
          }
        }
      }));
      openHeldItemContextMenu({
        x: Number(event.clientX ?? 0),
        y: Number(event.clientY ?? 0),
        title: item.name ?? "",
        actions
      });
    }, { capture: true });
  }
}

function supportsHeldItemSheetControls(actor) {
  return actor?.type === "character" || actor?.type === "npc";
}

function cleanConfigString(value) {
  return String(value ?? "").trim();
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }

  return Array.from(collection);
}

function getIndexRowProperty(row, path) {
  return foundry.utils.getProperty?.(row, path) ?? path.split(".").reduce((current, part) => (
    current && typeof current === "object" ? current[part] : undefined
  ), row);
}

function getIndexRowUuid(pack, row) {
  const rowUuid = cleanConfigString(row?.uuid);
  if (rowUuid) {
    return rowUuid;
  }

  const documentId = cleanConfigString(row?._id ?? row?.id);
  const collection = cleanConfigString(pack?.collection);
  return documentId && collection ? `Compendium.${collection}.Item.${documentId}` : "";
}

function buildGearDocumentUuidByGearId(pack, index) {
  const uuidByGearId = new Map();
  for (const row of collectionValues(index)) {
    const gearId = cleanConfigString(getIndexRowProperty(row, `flags.${MODULE_ID}.gearId`));
    if (!gearId || uuidByGearId.has(gearId)) {
      continue;
    }

    const sourceType = cleanConfigString(getIndexRowProperty(row, `flags.${MODULE_ID}.sourceType`));
    if (sourceType && sourceType !== "gear") {
      continue;
    }

    const uuid = getIndexRowUuid(pack, row);
    if (uuid) {
      uuidByGearId.set(gearId, uuid);
    }
  }

  return uuidByGearId;
}

export function buildRebreyaWeaponIdsConfig(gearDocumentUuidByGearId = new Map()) {
  return Object.fromEntries(getRebreyaWeaponBaseItemDefinitions()
    .map((definition) => [
      definition.baseItem,
      gearDocumentUuidByGearId.get(definition.gearId)
        ?? `Compendium.world.${GEAR_COMPENDIUM_NAME}.Item.${createStableGearDocumentId(definition.gearId)}`
    ]));
}

function buildRebreyaWeaponIdsConfigFromGearPackIndex(pack, index) {
  if (!pack) {
    return null;
  }

  const uuidByGearId = buildGearDocumentUuidByGearId(pack, index);
  if (!uuidByGearId.size) {
    return null;
  }

  return buildRebreyaWeaponIdsConfig(uuidByGearId);
}

async function buildRebreyaWeaponIdsConfigFromGearPack(pack) {
  const cachedConfig = buildRebreyaWeaponIdsConfigFromGearPackIndex(pack, pack?.index);
  if (cachedConfig) {
    return cachedConfig;
  }

  if (!pack) {
    return null;
  }

  const index = typeof pack.getIndex === "function"
    ? await pack.getIndex({
        fields: [
          `flags.${MODULE_ID}.gearId`,
          `flags.${MODULE_ID}.sourceType`,
          "system.type.baseItem"
        ]
      })
    : pack.index;
  return buildRebreyaWeaponIdsConfigFromGearPackIndex(pack, index);
}

export function registerRebreyaWeaponBaseItems(weaponIdsConfig = buildRebreyaWeaponIdsConfig()) {
  if (!isDnd5eWorld() || !CONFIG.DND5E) {
    return false;
  }

  if (!CONFIG.DND5E?.weaponIds || typeof CONFIG.DND5E.weaponIds !== "object") {
    CONFIG.DND5E.weaponIds = {};
  }

  for (const [baseItem, uuid] of Object.entries(weaponIdsConfig)) {
    CONFIG.DND5E.weaponIds[baseItem] = uuid;
  }

  return true;
}

export async function registerRebreyaWeaponBaseItemsFromGearPack() {
  if (!isDnd5eWorld() || !CONFIG.DND5E) {
    return false;
  }

  const pack = game.packs?.get?.(`world.${GEAR_COMPENDIUM_NAME}`) ?? null;
  const weaponIdsConfig = await buildRebreyaWeaponIdsConfigFromGearPack(pack);
  if (!weaponIdsConfig) {
    return false;
  }

  return registerRebreyaWeaponBaseItems(weaponIdsConfig);
}

export function extendDnd5eItemTypes() {
  if (!isDnd5eWorld() || !CONFIG.DND5E) {
    return false;
  }

  registerRebreyaWeaponBaseItemsFromGearPack().catch((error) => {
    console.warn(`${MODULE_ID} | Failed to register Rebreya weapon base items from gear pack.`, error);
  });

  registerNativeStateItemType();
  registerDowntimeItemType();
  registerCraftsmanArchetypeTypes();
  registerNativeStateAdvancementTypes();
  registerNativeStateLanguages();

  CONFIG.DND5E.featureTypes ??= {};
  const featTypeConfig = CONFIG.DND5E.featureTypes.feat;
  const featTypeLabel = cleanFeatSectionLabel(featTypeConfig?.label) || "DND5E.Feature.Feat.Label";
  CONFIG.DND5E.featureTypes.feat = {
    ...(typeof featTypeConfig === "object" ? featTypeConfig : {}),
    label: featTypeLabel,
    subtypes: { ...REBREYA_FEAT_SUBTYPE_LABELS }
  };
  const classTypeConfig = CONFIG.DND5E.featureTypes.class;
  if (typeof classTypeConfig === "object") {
    CONFIG.DND5E.featureTypes.class = {
      ...classTypeConfig,
      subtypes: {
        ...(classTypeConfig.subtypes ?? {}),
        fighterManeuver: REBREYA_FEAT_SUBTYPE_LABELS.fighterManeuver
      }
    };
  }

  if (!CONFIG.DND5E.weaponTypes || typeof CONFIG.DND5E.weaponTypes !== "object") {
    CONFIG.DND5E.weaponTypes = {};
  }
  const weaponTypes = CONFIG.DND5E.weaponTypes;
  weaponTypes.firearmPrimitive = weaponTypes.firearmPrimitive ?? "Примитивное огнестрельное";
  weaponTypes.firearmAdvanced = weaponTypes.firearmAdvanced ?? "Продвинутое огнестрельное";

  if (CONFIG.DND5E?.weaponProficienciesMap) {
    CONFIG.DND5E.weaponProficienciesMap.firearmPrimitive ??= "sim";
    CONFIG.DND5E.weaponProficienciesMap.firearmAdvanced ??= "mar";
  }

  if (CONFIG.DND5E?.weaponTypeMap) {
    CONFIG.DND5E.weaponTypeMap.firearmPrimitive ??= "ranged";
    CONFIG.DND5E.weaponTypeMap.firearmAdvanced ??= "ranged";
  }

  registerFirearmAttackType();

  CONFIG.DND5E.itemProperties ??= {};
  for (const definition of REBREYA_WEAPON_PROPERTY_DEFINITIONS) {
    const existing = CONFIG.DND5E.itemProperties[definition.key];
    if (existing && typeof existing === "object") {
      existing.label = definition.label;
      existing.isPhysical ??= true;
      continue;
    }

    CONFIG.DND5E.itemProperties[definition.key] = {
      label: definition.label,
      isPhysical: true
    };
  }

  CONFIG.DND5E.validProperties ??= {};
  if (!(CONFIG.DND5E.validProperties.weapon instanceof Set)) {
    const source = CONFIG.DND5E.validProperties.weapon;
    CONFIG.DND5E.validProperties.weapon = new Set(Array.isArray(source) ? source : []);
  }
  for (const definition of REBREYA_WEAPON_PROPERTY_DEFINITIONS) {
    CONFIG.DND5E.validProperties.weapon.add(definition.key);
  }

  if (!CONFIG.DND5E.equipmentTypes || typeof CONFIG.DND5E.equipmentTypes !== "object") {
    CONFIG.DND5E.equipmentTypes = {};
  }
  const equipmentTypes = CONFIG.DND5E.equipmentTypes;
  equipmentTypes.staff = equipmentTypes.staff ?? "Посох";
  equipmentTypes.wand = equipmentTypes.wand ?? "Волшебная палочка";

  if (!CONFIG.DND5E.miscEquipmentTypes || typeof CONFIG.DND5E.miscEquipmentTypes !== "object") {
    CONFIG.DND5E.miscEquipmentTypes = {};
  }
  const miscEquipmentTypes = CONFIG.DND5E.miscEquipmentTypes;
  miscEquipmentTypes.staff = miscEquipmentTypes.staff ?? equipmentTypes.staff;
  miscEquipmentTypes.wand = miscEquipmentTypes.wand ?? equipmentTypes.wand;

  CONFIG.DND5E.armorProficienciesMap ??= {};
  CONFIG.DND5E.armorProficienciesMap.staff ??= true;
  CONFIG.DND5E.armorProficienciesMap.wand ??= true;

  const lootTypes = CONFIG.DND5E?.lootTypes ?? {};
  const gearType = lootTypes.gear ?? { label: "DND5E.Loot.Gear" };
  lootTypes.gear = {
    ...(typeof gearType === "object" ? gearType : { label: gearType }),
    subtypes: {
      ...(typeof gearType === "object" ? gearType.subtypes ?? {} : {}),
      attachment: "Обвес"
    }
  };
}

export function registerDnd5eSheetExtensions(moduleApi) {
  if (!isDnd5eWorld() || !CONFIG.DND5E) {
    return;
  }

  registerHeldItemUpdatedHook();
  registerItemUpgradeFilterHook();

  const CharacterActorSheet = getCharacterActorSheetClass();
  if (CharacterActorSheet) {
    ensureHeroDollTabDefinition(CharacterActorSheet);
    patchHeroDollPartContext(CharacterActorSheet, moduleApi);
  }
  const ItemSheet5e = game.dnd5e?.applications?.item?.ItemSheet5e
    ?? globalThis.dnd5e?.applications?.item?.ItemSheet5e
    ?? null;
  if (ItemSheet5e) {
    ensureItemModsTabDefinition(ItemSheet5e);
    patchItemModsPartContext(ItemSheet5e);
  }
  patchActorMoveDropBehavior();
  patchDnd5eDragPayloadFallback();
  patchD20HeroicRollDialog();
  patchItemChoiceSpellLevelFilters();
  bindCharacterDowntimeDocumentSubmitDelegation(moduleApi);
  bindCharacterDowntimeDocumentRollDelegation(moduleApi);
  bindCharacterDowntimeDocumentEditDelegation(moduleApi);
  bindCharacterDowntimeDocumentContinueDelegation(moduleApi);
  bindCharacterDowntimeDocumentProjectCloseDelegation(moduleApi);
  registerUniversalBeltItemContextHook(moduleApi);

  const onRenderActorSheet = (app, html) => {
    const actor = getActorFromSheetApp(app);
    if (!actor) {
      return;
    }

    const root = getSheetRoot(html);
    if (!root) {
      return;
    }

    try {
      moduleApi?.sorcererAutomationService?.bindActorSheetCooldownBadges?.(root, actor);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to bind Sorcerer cooldown badges.`, error);
    }

    if (actor.type === "character") {
      bindCharacterSheetBranding(root);
      bindHeroDollPanel(root, app, moduleApi);
      bindCharacterDowntimePanel(root, app, moduleApi);
      try {
        bindUniversalBeltSheet(root, { actor, app, moduleApi, rerenderActorSheet });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind universal belt sheet controls.`, error);
      }
      try {
        hideInstalledUpgradeInventoryRows(root, actor);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to hide installed item upgrades.`, error);
      }
      try {
        bindItemUpgradeInventoryRows(root, { actor, app, moduleApi, rerenderActorSheet });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind actor sheet item upgrade drops.`, error);
      }
      try {
        bindNativeStateCard(root, app);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind native state card.`, error);
      }
      try {
        bindCharacterCombatStatusPanel(root, app, moduleApi);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind character sheet combat statuses.`, error);
      }
    }

    try {
      bindActivityAvailabilityBadges(root, { actor, moduleApi });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to bind activity availability badges.`, error);
    }

    if (supportsHeldItemSheetControls(actor)) {
      try {
        bindHeldItemEquipContextMenu(root, { actor, app, moduleApi });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind held item sheet controls.`, error);
      }
    }
  };

  for (const hookName of [
    "renderActorSheet",
    "renderActorSheet5eCharacter2",
    "renderActorSheet5eCharacter",
    "renderCharacterActorSheet",
    "renderActorSheet5eNPC2",
    "renderActorSheet5eNPC",
    "renderNPCActorSheet"
  ]) {
    Hooks.on(hookName, onRenderActorSheet);
  }

  const onRenderItemSheet = (app, html) => {
    const item = getItemFromSheetApp(app);
    if (!item) {
      return;
    }

    const root = getSheetRoot(html);
    if (!root) {
      return;
    }
    removeCharacterSheetBranding(root);

    try {
      bindItemSheetEnhancements(root, app, moduleApi);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to bind item sheet enhancements.`, error);
    }
    try {
      bindActivityAvailabilityBadges(root, { item, moduleApi });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to bind item sheet activity availability badges.`, error);
    }
  };

  Hooks.on("renderItemSheet", onRenderItemSheet);
  Hooks.on("renderItemSheet5e", onRenderItemSheet);
  Hooks.on("updateItem", (item, updateData) => {
    syncFirearmAttackAbilityAfterWeightUpdate(item, updateData).catch((error) => {
      console.error(`${MODULE_ID} | Failed to sync firearm attack ability after weight update.`, error);
    });
  });

  Hooks.on("renderApplicationV2", (app, element) => {
    const root = getSheetRoot(element);
    if (!root) {
      return;
    }

    const item = getItemFromSheetApp(app);
    if (item) {
      removeCharacterSheetBranding(root);
    }

    const actor = getActorFromSheetApp(app);
    if (actor?.type === "character" && isActorSheetRenderApp(app)) {
      bindCharacterSheetBranding(root);
      bindHeroDollPanel(root, app, moduleApi);
      bindCharacterDowntimePanel(root, app, moduleApi);
      try {
        bindUniversalBeltSheet(root, { actor, app, moduleApi, rerenderActorSheet });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind universal belt sheet controls on ApplicationV2 render.`, error);
      }
      try {
        hideInstalledUpgradeInventoryRows(root, actor);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to hide installed item upgrades on ApplicationV2 render.`, error);
      }
      try {
        bindItemUpgradeInventoryRows(root, { actor, app, moduleApi, rerenderActorSheet });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind actor sheet item upgrade drops on ApplicationV2 render.`, error);
      }
      try {
        bindNativeStateCard(root, app);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind native state card on ApplicationV2 render.`, error);
      }
      try {
        bindCharacterCombatStatusPanel(root, app, moduleApi);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind character sheet combat statuses on ApplicationV2 render.`, error);
      }
    }

    if (actor) {
      try {
        bindActivityAvailabilityBadges(root, { actor, moduleApi });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind activity availability badges on ApplicationV2 render.`, error);
      }
    }

    if (supportsHeldItemSheetControls(actor)) {
      try {
        bindHeldItemEquipContextMenu(root, { actor, app, moduleApi });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind held item sheet controls on ApplicationV2 render.`, error);
      }
    }

    if (item) {
      try {
        bindItemSheetEnhancements(root, app, moduleApi);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind item sheet enhancements on ApplicationV2 render.`, error);
      }
      try {
        bindActivityAvailabilityBadges(root, { item, moduleApi });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind item sheet activity availability badges on ApplicationV2 render.`, error);
      }
    }
  });
}
