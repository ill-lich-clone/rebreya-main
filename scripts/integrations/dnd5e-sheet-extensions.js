import {
  FEATS_COMPENDIUM_NAME,
  GEAR_COMPENDIUM_NAME,
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

const HERO_DOLL_TAB_ID = "heroDoll";
const HERO_DOLL_TAB_LABEL = "Кукла героя";
const HERO_DOLL_TAB_ICON = "fa-solid fa-person";
const HERO_DOLL_TEMPLATE = `modules/${MODULE_ID}/templates/hero-doll-tab.hbs`;
const HERO_DOLL_PATCH_FLAG = "__rebreyaHeroDollPatched";
const HERO_DOLL_MOVE_DROP_PATCH_FLAG = "__rebreyaHeroDollMoveDropPatched";
const HERO_DOLL_PAYLOAD_PATCH_FLAG = "__rebreyaHeroDollPayloadPatched";
const HEROIC_D20_DIALOG_PATCH_FLAG = "__rebreyaHeroicD20DialogPatched";
const HEROIC_D20_ROLL_PATCH_FLAG = "__rebreyaHeroicD20RollPatched";
const HEROIC_D20_KEYBINDINGS_PATCH_FLAG = "__rebreyaHeroicD20KeybindingsPatched";
const HEROIC_ADVANTAGE_ACTION = "heroic-advantage";
const HEROIC_DISADVANTAGE_ACTION = "heroic-disadvantage";
const NATIVE_STATE_ITEM_TYPE = STATE_ITEM_TYPE;
const NATIVE_STATE_LEGACY_ITEM_TYPE = "state";
const NATIVE_STATE_ITEM_TYPES = new Set([NATIVE_STATE_ITEM_TYPE, NATIVE_STATE_LEGACY_ITEM_TYPE]);
const NATIVE_STATE_TYPE_LABEL_KEY = "TYPES.Item.state";
const NATIVE_STATE_TYPE_PLURAL_LABEL_KEY = "TYPES.Item.statePl";
const NATIVE_STATE_LABEL_KEY = "REBREYA_MAIN.NativeState.Label";
const NATIVE_STATE_ADD_LABEL_KEY = "REBREYA_MAIN.NativeState.AddButton";
const NATIVE_STATE_SELECT_TITLE_KEY = "REBREYA_MAIN.NativeState.SelectTitle";
const NATIVE_STATE_SELECT_BUTTON_KEY = "REBREYA_MAIN.NativeState.SelectButton";
const STATES_PACK_ID = `world.${STATES_COMPENDIUM_NAME}`;
const ITEM_RANK_MIN = 0;
const ITEM_RANK_MAX = 10;
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
const LICH_WEAPON_VALUE_FIELDS = Object.freeze([
  { key: "gripModes", propertyKey: "lchGrip", label: "Хват [L]", type: "text", placeholder: "Напр.: 1к8 / 1к10" },
  { key: "minStrength", propertyKey: "lchStrReq", label: "Мин. сила [L]", type: "number", min: 0, step: 1 },
  { key: "mechanism", propertyKey: "lchMechanism", label: "Мех. [L]", type: "number", min: 0, step: 1 },
  { key: "dashDice", propertyKey: "lchDash", label: "Наскок [L]", type: "text", placeholder: "Напр.: 1к2" },
  { key: "reachBonus", propertyKey: "lchReach", label: "Досяг. [L] (фт)", type: "number", min: 0, step: 5 },
  { key: "mku", propertyKey: "lchMku", label: "МКУ [L]", type: "number", min: 0, step: 1 },
  { key: "mu", propertyKey: "lchMu", label: "МУ [L]", type: "number", min: 0, step: 1 },
  { key: "rku", propertyKey: "lchRku", label: "РКУ [L]", type: "number", min: 0, step: 1 },
  { key: "deadly", propertyKey: "lchDeadly", label: "Смерт. [L]", type: "number", min: 0, step: 1 }
]);
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

function ensureHeroDollTabDefinition(CharacterActorSheet) {
  if (!Array.isArray(CharacterActorSheet.TABS)) {
    CharacterActorSheet.TABS = [];
  }

  if (!CharacterActorSheet.TABS.some((tab) => tab?.tab === HERO_DOLL_TAB_ID)) {
    const nextTabs = [...CharacterActorSheet.TABS];
    const insertIndex = nextTabs.findIndex((tab) => tab?.tab === "specialTraits");
    const tabEntry = {
      tab: HERO_DOLL_TAB_ID,
      label: HERO_DOLL_TAB_LABEL,
      icon: HERO_DOLL_TAB_ICON
    };

    if (insertIndex >= 0) {
      nextTabs.splice(insertIndex, 0, tabEntry);
    }
    else {
      nextTabs.push(tabEntry);
    }

    CharacterActorSheet.TABS = nextTabs;
  }

  CharacterActorSheet.PARTS = {
    ...CharacterActorSheet.PARTS,
    [HERO_DOLL_TAB_ID]: {
      classes: ["flexcol"],
      container: { classes: ["tab-body"], id: "tabs" },
      template: HERO_DOLL_TEMPLATE,
      scrollable: [""]
    }
  };
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
    if (partId !== HERO_DOLL_TAB_ID) {
      return preparedWithFeatGroups;
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

  if (!D20Roll.prototype[HEROIC_D20_ROLL_PATCH_FLAG]) {
    const originalConfigureModifiers = D20Roll.prototype.configureModifiers;

    D20Roll.prototype.configureModifiers = function (...args) {
      const result = originalConfigureModifiers.call(this, ...args);
      const heroicMode = String(this.options?.rebreyaHeroicMode ?? "").trim().toLowerCase();
      if (!this.validD20Roll || !["advantage", "disadvantage"].includes(heroicMode)) {
        return result;
      }

      const modifiers = Array.isArray(this.d20?.modifiers) ? this.d20.modifiers : null;
      if (!modifiers) {
        return result;
      }

      const existingModifierIndex = modifiers.findIndex((modifier) => ["kh", "kl"].includes(modifier));
      if (existingModifierIndex >= 0) {
        modifiers.splice(existingModifierIndex, 1);
      }

      this.d20.number = 3;
      modifiers.push(heroicMode === "advantage" ? "kh" : "kl");
      this.resetFormula();
      return result;
    };

    Object.defineProperty(D20Roll.prototype, HEROIC_D20_ROLL_PATCH_FLAG, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: true
    });
  }

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

async function rerenderActorSheet(app, moduleApi) {
  try {
    await app.render({ force: true });
  }
  catch (_error) {
    await app.render(true);
  }

  await moduleApi.refreshOpenApps();
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

function isSheetWeaponPropertyChecked(root, item, propertyKey) {
  const safePropertyKey = String(propertyKey ?? "").trim();
  if (!safePropertyKey) {
    return false;
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

function bindItemSheetEnhancements(root, app) {
  const item = getItemFromSheetApp(app);
  if (!item) {
    return;
  }

  ensureEquipmentTypeOptions(root, item);
  upsertToolBaseItemOptions(root, app);
  upsertItemRankBadge(root, item);
  upsertItemRankField(root, app);
  upsertItemSlotField(root, app);
  upsertWeaponAttackTraitsField(root, app);
}

export function buildRebreyaWeaponIdsConfig() {
  return Object.fromEntries(getRebreyaWeaponBaseItemDefinitions()
    .map((definition) => [
      definition.baseItem,
      `Compendium.world.${GEAR_COMPENDIUM_NAME}.Item.${createStableGearDocumentId(definition.gearId)}`
    ]));
}

export function registerRebreyaWeaponBaseItems() {
  if (!isDnd5eWorld() || !CONFIG.DND5E) {
    return false;
  }

  if (!game.packs?.get?.(`world.${GEAR_COMPENDIUM_NAME}`)) {
    return false;
  }

  if (!CONFIG.DND5E?.weaponIds || typeof CONFIG.DND5E.weaponIds !== "object") {
    CONFIG.DND5E.weaponIds = {};
  }

  for (const [baseItem, uuid] of Object.entries(buildRebreyaWeaponIdsConfig())) {
    CONFIG.DND5E.weaponIds[baseItem] = uuid;
  }

  return true;
}

export function extendDnd5eItemTypes() {
  if (!isDnd5eWorld() || !CONFIG.DND5E) {
    return;
  }

  registerNativeStateItemType();
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

  CONFIG.DND5E.itemProperties ??= {};
  for (const definition of LICH_WEAPON_PROPERTY_DEFINITIONS) {
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
  for (const definition of LICH_WEAPON_PROPERTY_DEFINITIONS) {
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

  const CharacterActorSheet = getCharacterActorSheetClass();
  if (CharacterActorSheet) {
    ensureHeroDollTabDefinition(CharacterActorSheet);
    patchHeroDollPartContext(CharacterActorSheet, moduleApi);
  }
  patchActorMoveDropBehavior();
  patchDnd5eDragPayloadFallback();
  patchD20HeroicRollDialog();

  const onRenderActorSheet = (app, html) => {
    const actor = getActorFromSheetApp(app);
    if (!actor || actor.type !== "character") {
      return;
    }

    const root = getSheetRoot(html);
    if (!root) {
      return;
    }

    bindHeroDollPanel(root, app, moduleApi);
    try {
      bindNativeStateCard(root, app);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to bind native state card.`, error);
    }
  };

  for (const hookName of [
    "renderActorSheet",
    "renderActorSheet5eCharacter2",
    "renderActorSheet5eCharacter",
    "renderCharacterActorSheet"
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

    try {
      bindItemSheetEnhancements(root, app);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to bind item sheet enhancements.`, error);
    }
  };

  Hooks.on("renderItemSheet", onRenderItemSheet);
  Hooks.on("renderItemSheet5e", onRenderItemSheet);

  Hooks.on("renderApplicationV2", (app, element) => {
    const root = getSheetRoot(element);
    if (!root) {
      return;
    }

    const actor = getActorFromSheetApp(app);
    if (actor?.type === "character") {
      bindHeroDollPanel(root, app, moduleApi);
      try {
        bindNativeStateCard(root, app);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind native state card on ApplicationV2 render.`, error);
      }
    }

    const item = getItemFromSheetApp(app);
    if (item) {
      try {
        bindItemSheetEnhancements(root, app);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to bind item sheet enhancements on ApplicationV2 render.`, error);
      }
    }
  });
}


