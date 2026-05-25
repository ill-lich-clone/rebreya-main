import {
  CLASS_FEATURES_COMPENDIUM_LABEL,
  CLASS_FEATURES_COMPENDIUM_NAME,
  CLASSES_COMPENDIUM_LABEL,
  CLASSES_COMPENDIUM_NAME,
  FEATS_COMPENDIUM_NAME,
  MODULE_ID,
  SUBCLASSES_COMPENDIUM_LABEL,
  SUBCLASSES_COMPENDIUM_NAME
} from "../constants.js";
import {
  buildNamedIconLookup,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath,
  resolveNamedIcon
} from "./compendium-utils.js";
import { buildSlug } from "./item-classification.js";

const DND5E_SYSTEM_ID = "dnd5e";
const DEFAULT_SOURCE_LABEL = "ЗоЗТ";
const REBREYA_SOURCE_LABEL = "Ребрея";
const COMPENDIUM_SIDEBAR_FOLDER = [REBREYA_SOURCE_LABEL];
const CLASS_DATA_PATHS = [
  `modules/${MODULE_ID}/data/barbarian-rework-v012.json`,
  `modules/${MODULE_ID}/data/fighter-rework-v028.json`
];
const MODULE_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const CLASS_ICON_SEARCH_PATHS = [
  `${MODULE_ICONS_BASE_PATH}/Classes/Fighter`,
  `${MODULE_ICONS_BASE_PATH}/Classes/Barbarian`,
  `${MODULE_ICONS_BASE_PATH}/Fighter`,
  `${MODULE_ICONS_BASE_PATH}/Barbarian`,
  `${MODULE_ICONS_BASE_PATH}/Feats`,
  MODULE_ICONS_BASE_PATH
];

const FEATS_PACK_ID = `world.${FEATS_COMPENDIUM_NAME}`;
const CLASS_FEATURES_PACK_ID = `world.${CLASS_FEATURES_COMPENDIUM_NAME}`;
const SUBCLASSES_PACK_ID = `world.${SUBCLASSES_COMPENDIUM_NAME}`;
const CLASSES_PACK_ID = `world.${CLASSES_COMPENDIUM_NAME}`;

const CLASS_ROOT_FOLDER = "Классы";
const SUBCLASS_ROOT_FOLDER = "Архетипы";
const CLASS_FEATURE_ROOT_FOLDER = "Варвар (Реворк V0.12)";
const FIGHTER_CLASS_FEATURE_ROOT_FOLDER = "Воин (Реворк V0.28)";
const LEGACY_CLASS_ROOT_FOLDERS = ["Классы Rebreya"];
const LEGACY_SUBCLASS_ROOT_FOLDERS = ["Архетипы Rebreya"];
const LEGACY_CLASS_FEATURE_ROOT_FOLDERS = ["Умения варвара Rebreya (Реворк V0.12)"];

const CLASS_FEATURE_TEMPLATE_VERSION = 6;
const SUBCLASS_TEMPLATE_VERSION = 3;
const CLASS_TEMPLATE_VERSION = 3;

const DEFAULT_CLASS_ICON = "icons/svg/book.svg";
const DEFAULT_SUBCLASS_ICON = "icons/svg/book.svg";
const DEFAULT_FEATURE_ICON = "icons/svg/book.svg";

const DEFAULT_HD = "d12";
const FIGHTER_HD = "d10";
const MINOR_FEAT_LEVELS = [3, 6, 9, 12, 15, 18];
const RAGE_ACTION_PICK_LEVELS = [5, 10, 15, 20];
const SKILL_POOL = ["ath", "prc", "sur", "itm", "nat", "ani"];
const FIGHTER_SKILL_POOL = ["acr", "ath", "prc", "sur", "itm", "his", "ins", "ani"];
const ASI_LEVELS = [4, 8, 12, 16, 19];
const BATTLE_MASTER_SUBCLASS_NAME = "мастер боевых искусств";
const FIGHTING_STYLE_FEATS_SECTION = "черты боевых стилей";
const MINOR_FEATS_SECTION = "младшие черты";
const BATTLE_MASTER_MANEUVER_CHOICE_LEVELS = [3, 7, 10, 15, 18];
const EFFECT_MODE_CUSTOM = 0;
const EFFECT_MODE_ADD = 2;
const EFFECT_MODE_OVERRIDE = 5;

const OPTIONAL_CLASS_FEATURE_NAMES = new Set([
  "стальной желудок",
  "пуленепробиваемое тело"
]);

const SPECIAL_CLASS_FEATURES = {
  MINOR_FEAT: "младшая черта",
  ABILITY_SCORE_IMPROVEMENT: "увеличение характеристик",
  ABILITY_SCORE_IMPROVEMENT_ALT: "повышение характеристики"
};

const RAGE_ACTION_ACTIVITY_IMAGE = {
  utility: "systems/dnd5e/icons/svg/activity/utility.svg",
  damage: "systems/dnd5e/icons/svg/activity/damage.svg",
  heal: "systems/dnd5e/icons/svg/activity/heal.svg",
  save: "systems/dnd5e/icons/svg/activity/save.svg",
  check: "systems/dnd5e/icons/svg/activity/check.svg"
};

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function unique(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['"\u2019\u2018\u02BC\u02B9\u2032\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function buildAsciiIdentifier(value, fallbackSeed = "entry") {
  const base = String(value ?? "")
    .toLowerCase()
    .replace(/[^\x00-\x7F]+/gu, " ")
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "");

  if (base) {
    return base.slice(0, 64);
  }

  return `rb_${stableHashId(String(fallbackSeed ?? value ?? "entry"), "identifier")}`;
}

function stableHashId(seed, scope = "id") {
  const source = `${scope}:${seed}`;
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;

  for (const char of source) {
    const code = char.codePointAt(0) ?? 0;
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB + code + ((hashB << 6) >>> 0) + (hashB >>> 2), 0x85ebca6b) >>> 0;
  }

  const token = `${hashA.toString(36)}${hashB.toString(36)}`.replace(/[^a-z0-9]/gu, "");
  return token.padEnd(16, "0").slice(0, 16);
}

function compendiumItemUuid(packCollection, documentId) {
  const collection = cleanString(packCollection);
  const id = cleanString(documentId);
  return collection && id ? `Compendium.${collection}.Item.${id}` : "";
}

function featureDocumentId(featureId) {
  return stableHashId(featureId, "class-feature-document");
}

export function buildFeatureUuidMap(featureDefinitions = [], packCollection = "", documents = []) {
  const actualUuidByFeatureId = new Map();
  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.getFlag?.(MODULE_ID, "managed")) {
      continue;
    }

    const featureId = cleanString(document.getFlag(MODULE_ID, "featureId"));
    if (!featureId || !document.uuid) {
      continue;
    }

    actualUuidByFeatureId.set(featureId, document.uuid);
  }

  const featureUuidById = new Map();
  for (const feature of Array.isArray(featureDefinitions) ? featureDefinitions : []) {
    const featureId = cleanString(feature?.featureId);
    if (!featureId) {
      continue;
    }

    const actualUuid = actualUuidByFeatureId.get(featureId);
    const plannedUuid = compendiumItemUuid(packCollection, feature.documentId);
    const uuid = actualUuid || plannedUuid;
    if (uuid) {
      featureUuidById.set(featureId, uuid);
    }
  }

  return featureUuidById;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function toHtmlParagraphs(value) {
  const text = cleanString(value);
  if (!text) {
    return "";
  }

  return text
    .split(/\n{2,}/gu)
    .map((paragraph) => `<p>${formatParagraphLines(paragraph)}</p>`)
    .join("");
}

function isTextListLine(line) {
  return /^(?:[●•▪*]|\d+[.)])\s*/u.test(cleanString(line));
}

function isTextLevelLine(line) {
  return /^(?:\d+[-\s]?(?:й|го)\s+уровень|умение\s+\d)/iu.test(cleanString(line));
}

function isIndentedTextLine(line) {
  return /^\s{4,}\S/u.test(String(line ?? ""));
}

function isLikelyStandaloneHeading(line) {
  const text = cleanString(line);
  if (!text || text.length > 72) {
    return false;
  }

  return !/[.!?;:,]$/u.test(text);
}

function shouldStartHtmlLine(rawLine, line, segments) {
  if (!segments.length) {
    return true;
  }

  if (isTextListLine(line) || isTextLevelLine(line) || isIndentedTextLine(rawLine)) {
    return true;
  }

  const previous = segments.at(-1) ?? "";
  return isLikelyStandaloneHeading(previous);
}

function formatParagraphLines(paragraph) {
  const segments = [];
  for (const rawLine of String(paragraph ?? "").split(/\n/gu)) {
    const line = cleanString(rawLine);
    if (!line) {
      continue;
    }

    if (shouldStartHtmlLine(rawLine, line, segments)) {
      segments.push(line);
    }
    else {
      segments[segments.length - 1] = `${segments.at(-1)} ${line}`;
    }
  }

  return segments.map((segment) => escapeHtml(segment)).join("<br>");
}

function uniqueIdentifier(base, usedIds, fallbackSeed = "entry") {
  const seed = cleanString(base, buildAsciiIdentifier(fallbackSeed, fallbackSeed));
  let identifier = seed;
  let duplicateIndex = 2;

  while (usedIds.has(identifier)) {
    identifier = `${seed}-${duplicateIndex}`;
    duplicateIndex += 1;
  }

  usedIds.add(identifier);
  return identifier;
}

function normalizeLevelList(value, fallbackLevel = 1) {
  const levels = (Array.isArray(value) ? value : [value])
    .map((entry) => Math.floor(parseNumber(entry, fallbackLevel)))
    .filter((entry) => entry >= 1 && entry <= 20);
  if (!levels.length) {
    return [fallbackLevel];
  }

  return unique(levels).sort((left, right) => left - right);
}

function normalizeFeatureEntry(rawFeature, index, {
  scopeId = "",
  fallbackName = "Умение",
  fallbackLevel = 1,
  usedIds = new Set(),
  forceRequiredLevel = null,
  optional = false
} = {}) {
  const name = cleanString(rawFeature?.name, `${fallbackName} ${index + 1}`);
  const baseId = cleanString(
    rawFeature?.id,
    buildAsciiIdentifier(`${scopeId}-${buildSlug(name, `feature-${index + 1}`)}`, `${scopeId}::${index + 1}`)
  );
  const featureId = uniqueIdentifier(baseId, usedIds, `${scopeId}::${index + 1}`);
  const levels = normalizeLevelList(rawFeature?.levels, fallbackLevel);
  const requiredLevel = Math.max(
    0,
    Math.floor(parseNumber(forceRequiredLevel ?? rawFeature?.requiredLevel, levels[0] ?? fallbackLevel))
  );

  return {
    featureId,
    name,
    description: cleanString(rawFeature?.description),
    levels,
    requiredLevel,
    optional: optional === true
  };
}

function normalizeProgressionMap(value) {
  const progression = {};
  for (const [level, entry] of Object.entries(isPlainObject(value) ? value : {})) {
    const parsedLevel = Math.max(1, Math.floor(parseNumber(level, 0)));
    const parsedValue = Math.max(0, Math.floor(parseNumber(entry, 0)));
    if (parsedLevel >= 1 && parsedLevel <= 20 && parsedValue > 0) {
      progression[String(parsedLevel)] = parsedValue;
    }
  }

  return progression;
}

function normalizeDieProgressionMap(value) {
  const progression = {};
  for (const [level, entry] of Object.entries(isPlainObject(value) ? value : {})) {
    const parsedLevel = Math.max(1, Math.floor(parseNumber(level, 0)));
    const match = cleanString(entry).match(/^d(\d+)$/iu);
    const faces = match ? Math.floor(parseNumber(match[1], 0)) : 0;
    if (parsedLevel >= 1 && parsedLevel <= 20 && faces > 0) {
      progression[String(parsedLevel)] = `d${faces}`;
    }
  }

  return progression;
}

export function normalizeClassCompendiumData(rawData) {
  const data = isPlainObject(rawData) ? rawData : {};
  const sourceLabel = cleanString(data.source, DEFAULT_SOURCE_LABEL);

  const rawClass = isPlainObject(data.class) ? data.class : {};
  const className = cleanString(rawClass.name, "Варвар (реворк V0.12)");
  const classIdentifier = buildAsciiIdentifier(
    cleanString(rawClass.identifier, buildSlug(className, "barbarian-rework-v012")),
    className
  );
  const classFeatureRootFolder = cleanString(
    data.classFeatureRootFolder,
    classIdentifier === "fighter-rework-v028" ? FIGHTER_CLASS_FEATURE_ROOT_FOLDER : CLASS_FEATURE_ROOT_FOLDER
  );
  const hitDie = cleanString(rawClass.hitDie, classIdentifier === "fighter-rework-v028" ? FIGHTER_HD : DEFAULT_HD);
  const primaryAbility = unique(Array.isArray(rawClass.primaryAbility) ? rawClass.primaryAbility : ["str"]);
  const skillPool = unique(Array.isArray(rawClass.skillPool)
    ? rawClass.skillPool
    : classIdentifier === "fighter-rework-v028" ? FIGHTER_SKILL_POOL : SKILL_POOL);
  const saveProficiencies = unique(Array.isArray(rawClass.saveProficiencies) ? rawClass.saveProficiencies : ["str", "con"]);
  const wealth = cleanString(rawClass.wealth, classIdentifier === "fighter-rework-v028" ? "5d4*10" : "2d4*10");
  const subclassTitle = cleanString(rawClass.subclassTitle, classIdentifier === "fighter-rework-v028" ? "Воинский архетип" : "Путь дикости");
  const subclassHint = cleanString(rawClass.subclassHint, classIdentifier === "fighter-rework-v028" ? "Выберите архетип воина." : "Выберите архетип варвара.");

  const usedClassFeatureIds = new Set();
  const classFeatures = (Array.isArray(rawClass.features) ? rawClass.features : [])
    .map((feature, index) => {
      const entry = normalizeFeatureEntry(feature, index, {
        scopeId: `${classIdentifier}-feature`,
        fallbackName: "Классовое умение",
        fallbackLevel: 1,
        usedIds: usedClassFeatureIds
      });
      const normalizedName = normalizeMatchText(entry.name);
      return {
        ...entry,
        normalizedName,
        optional: OPTIONAL_CLASS_FEATURE_NAMES.has(normalizedName)
      };
    })
    .filter((feature) => feature.name);

  const subclasses = [];
  const rawSubclasses = Array.isArray(data.subclasses) ? data.subclasses : [];
  const usedSubclassIds = new Set();
  for (const [subclassIndex, rawSubclass] of rawSubclasses.entries()) {
    const subclassName = cleanString(rawSubclass?.name, `Путь ${subclassIndex + 1}`);
    const subclassBaseId = cleanString(
      rawSubclass?.identifier,
      buildAsciiIdentifier(
        `${classIdentifier}-${buildSlug(subclassName, `path-${subclassIndex + 1}`)}`,
        `${classIdentifier}::subclass::${subclassIndex + 1}`
      )
    );
    const subclassId = uniqueIdentifier(
      subclassBaseId,
      usedSubclassIds,
      `${classIdentifier}::subclass::${subclassIndex + 1}`
    );
    const subclassDescription = cleanString(rawSubclass?.description, `Архетип варвара: ${subclassName}.`);
    const usedFeatureIds = new Set();
    const features = (Array.isArray(rawSubclass?.features) ? rawSubclass.features : [])
      .map((feature, featureIndex) => normalizeFeatureEntry(feature, featureIndex, {
        scopeId: `${subclassId}-feature`,
        fallbackName: "Умение пути",
        fallbackLevel: 3,
        usedIds: usedFeatureIds
      }))
      .filter((feature) => feature.name);

    subclasses.push({
      subclassId,
      name: subclassName,
      description: subclassDescription,
      features
    });
  }

  const usedRageActionIds = new Set();
  const rageActions = (Array.isArray(data.rageActions) ? data.rageActions : [])
    .map((action, index) => normalizeFeatureEntry(action, index, {
      scopeId: `${classIdentifier}-rage-action`,
      fallbackName: "Яростное действие",
      fallbackLevel: 5,
      usedIds: usedRageActionIds,
      forceRequiredLevel: action?.requiredLevel ?? 0
    }))
    .map((action) => ({
      ...action,
      levels: [Math.max(1, action.requiredLevel || 1)]
    }))
    .filter((action) => action.name);

  const usedFightingStyleIds = new Set();
  const fightingStyles = (Array.isArray(data.fightingStyles) ? data.fightingStyles : [])
    .map((style, index) => {
      const entry = normalizeFeatureEntry(style, index, {
        scopeId: `${classIdentifier}-fighting-style`,
        fallbackName: "Боевой стиль",
        fallbackLevel: 1,
        usedIds: usedFightingStyleIds,
        forceRequiredLevel: 1
      });
      return {
        ...entry,
        levels: [1],
        maneuvers: unique(Array.isArray(style?.maneuvers) ? style.maneuvers.map((maneuver) => cleanString(maneuver)) : [])
      };
    })
    .filter((style) => style.name);

  const usedManeuverIds = new Set();
  const maneuvers = (Array.isArray(data.maneuvers) ? data.maneuvers : [])
    .map((maneuver, index) => normalizeFeatureEntry(maneuver, index, {
      scopeId: `${classIdentifier}-maneuver`,
      fallbackName: "Боевой приём",
      fallbackLevel: 1,
      usedIds: usedManeuverIds,
      forceRequiredLevel: maneuver?.requiredLevel ?? 0
    }))
    .map((maneuver) => ({
      ...maneuver,
      levels: [Math.max(1, maneuver.requiredLevel || 1)]
    }))
    .filter((maneuver) => maneuver.name);

  const rawDominanceProgression = isPlainObject(data.dominanceProgression) ? data.dominanceProgression : {};

  return {
    sourceLabel,
    classFeatureRootFolder,
    classData: {
      name: className,
      description: cleanString(rawClass.description),
      identifier: classIdentifier,
      hitDie,
      primaryAbility,
      skillPool,
      saveProficiencies,
      wealth,
      subclassTitle,
      subclassHint,
      features: classFeatures
    },
    subclasses,
    rageActions,
    rageProgression: normalizeProgressionMap(data.rageProgression),
    rageDamageProgression: normalizeProgressionMap(data.rageDamageProgression),
    fightingStyles,
    maneuvers,
    dominanceProgression: {
      dice: normalizeProgressionMap(rawDominanceProgression.dice),
      die: normalizeDieProgressionMap(rawDominanceProgression.die)
    }
  };
}

function normalizeBarbarianData(rawData) {
  return normalizeClassCompendiumData(rawData);
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

async function fetchJson(path, { optional = false } = {}) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    if (optional && response.status === 404) {
      return null;
    }

    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export function buildFeatureDefinitions(normalizedData) {
  const definitions = [];
  const classId = normalizedData.classData.identifier;
  const classFeatureRootFolder = cleanString(normalizedData.classFeatureRootFolder, CLASS_FEATURE_ROOT_FOLDER);
  const className = cleanString(normalizedData.classData.name, "Класс");
  const sourceLabel = cleanString(normalizedData.sourceLabel, DEFAULT_SOURCE_LABEL);
  const maneuverFeatureIdByName = new Map(
    (normalizedData.maneuvers ?? []).map((maneuver) => [
      normalizeMatchText(maneuver.name),
      `${classId}::fighterManeuver::${maneuver.featureId}`
    ])
  );
  const allManeuverFeatureIds = Array.from(maneuverFeatureIdByName.values());

  const buildBaseFeatureDefinition = (feature, sourceType, folderPath, identifierSeed) => {
    const featureId = `${classId}::${sourceType}::${feature.featureId}`;
    return {
      featureId,
      documentId: featureDocumentId(featureId),
      sourceType,
      classIdentifier: classId,
      className,
      subclassId: null,
      subclassName: null,
      name: feature.name,
      description: feature.description,
      levels: feature.levels,
      requiredLevel: feature.requiredLevel,
      optional: feature.optional === true,
      identifier: buildAsciiIdentifier(identifierSeed, `${classId}::${sourceType}::${feature.featureId}`),
      folderPath,
      sourceLabel
    };
  };

  for (const feature of normalizedData.classData.features) {
    const featureId = `${classId}::class::${feature.featureId}`;
    definitions.push({
      featureId,
      documentId: featureDocumentId(featureId),
      sourceType: "classFeature",
      classIdentifier: classId,
      className,
      subclassId: null,
      subclassName: null,
      name: feature.name,
      description: feature.description,
      levels: feature.levels,
      requiredLevel: feature.requiredLevel,
      optional: feature.optional === true,
      identifier: buildAsciiIdentifier(`${classId}-${feature.featureId}`, `${classId}::${feature.featureId}`),
      folderPath: normalizeFolderPath([classFeatureRootFolder, "Базовые умения"]),
      sourceLabel
    });
  }

  for (const action of normalizedData.rageActions) {
    const featureId = `${classId}::rage-action::${action.featureId}`;
    definitions.push({
      featureId,
      documentId: featureDocumentId(featureId),
      sourceType: "rageAction",
      classIdentifier: classId,
      className,
      subclassId: null,
      subclassName: null,
      name: action.name,
      description: action.description,
      levels: action.levels,
      requiredLevel: action.requiredLevel,
      optional: false,
      identifier: buildAsciiIdentifier(`${classId}-rage-${action.featureId}`, `${classId}::rage::${action.featureId}`),
      folderPath: normalizeFolderPath([classFeatureRootFolder, "Яростные действия"]),
      sourceLabel
    });
  }

  for (const style of normalizedData.fightingStyles ?? []) {
    definitions.push({
      ...buildBaseFeatureDefinition(
        style,
        "fightingStyle",
        normalizeFolderPath([classFeatureRootFolder, "Боевые стили"]),
        `${classId}-style-${style.featureId}`
      ),
      name: `Боевой стиль: ${style.name}`,
      styleName: style.name,
      maneuvers: unique(style.maneuvers),
      maneuverFeatureIds: unique(style.maneuvers
        .map((maneuverName) => maneuverFeatureIdByName.get(normalizeMatchText(maneuverName)))
        .filter(Boolean)),
      allManeuverFeatureIds
    });
  }

  for (const maneuver of normalizedData.maneuvers ?? []) {
    definitions.push(buildBaseFeatureDefinition(
      maneuver,
      "fighterManeuver",
      normalizeFolderPath([classFeatureRootFolder, "Боевые приёмы"]),
      `${classId}-maneuver-${maneuver.featureId}`
    ));
  }

  for (const subclass of normalizedData.subclasses) {
    for (const feature of subclass.features) {
      const featureId = `${subclass.subclassId}::subclass::${feature.featureId}`;
      definitions.push({
        featureId,
        documentId: featureDocumentId(featureId),
        sourceType: "subclassFeature",
        classIdentifier: classId,
        className,
        subclassId: subclass.subclassId,
        subclassName: subclass.name,
        name: feature.name,
        description: feature.description,
        levels: feature.levels,
        requiredLevel: feature.requiredLevel,
        optional: false,
        identifier: buildAsciiIdentifier(
          `${subclass.subclassId}-${feature.featureId}`,
          `${subclass.subclassId}::${feature.featureId}`
        ),
        folderPath: normalizeFolderPath([classFeatureRootFolder, "Архетипы", subclass.name]),
        sourceLabel
      });
    }
  }

  return definitions;
}

function buildFeatureSignature(feature, context = {}) {
  return JSON.stringify({
    templateVersion: CLASS_FEATURE_TEMPLATE_VERSION,
    featureId: feature.featureId,
    documentId: feature.documentId,
    sourceType: feature.sourceType,
    classIdentifier: feature.classIdentifier,
    subclassId: feature.subclassId,
    subclassName: feature.subclassName,
    name: feature.name,
    styleName: feature.styleName ?? "",
    description: feature.description,
    levels: feature.levels,
    requiredLevel: feature.requiredLevel,
    optional: feature.optional,
    identifier: feature.identifier,
    maneuvers: feature.maneuvers ?? [],
    maneuverFeatureIds: feature.maneuverFeatureIds ?? [],
    allManeuverFeatureIds: feature.allManeuverFeatureIds ?? [],
    advancement: buildFeatureItemAdvancements(feature, context),
    sourceLabel: feature.sourceLabel ?? DEFAULT_SOURCE_LABEL
  });
}

function buildSubtypeRequirementsLabel(feature) {
  const level = Math.max(1, Math.floor(parseNumber(feature.requiredLevel, feature.levels?.[0] ?? 1)));
  if (feature.sourceType === "subclassFeature" && feature.subclassName) {
    return `${feature.subclassName}, ${level}-й уровень`;
  }

  if (feature.sourceType === "rageAction") {
    if (level > 1) {
      return `Яростное действие, ${level}-й уровень`;
    }
    return "Яростное действие";
  }

  if (feature.sourceType === "fightingStyle") {
    return "Боевой стиль воина";
  }

  if (feature.sourceType === "fighterManeuver") {
    return level > 1 ? `Боевой приём, ${level}-й уровень` : "Боевой приём";
  }

  return `${cleanString(feature.className, "Класс")}, ${level}-й уровень`;
}

function createEmptyFeatureAutomation() {
  return {
    activities: {},
    effects: [],
    usesRecovery: []
  };
}

function createRageFeatureAutomation(feature, classIdentifier) {
  const effectId = stableHashId(`${classIdentifier}:${feature.featureId}:rage-effect`, "effect");
  const activityId = stableHashId(`${classIdentifier}:${feature.featureId}:rage-activity`, "activity");
  const rageDamageFormula = `+@scale.${classIdentifier}.rage-damage`;

  return {
    activities: {
      [activityId]: {
        _id: activityId,
        type: "utility",
        name: "Войти в ярость",
        img: "systems/dnd5e/icons/svg/activity/utility.svg",
        sort: 0,
        activation: {
          type: "bonus",
          value: 1,
          condition: "",
          override: false
        },
        consumption: {
          scaling: {
            allowed: false,
            max: ""
          },
          spellSlot: false,
          targets: [{
            type: "itemUses",
            target: "",
            value: "1",
            scaling: {
              mode: "",
              formula: ""
            }
          }]
        },
        description: {
          chatFlavor: ""
        },
        duration: {
          value: 1,
          units: "minute",
          special: "",
          concentration: false,
          override: false
        },
        effects: [{ _id: effectId }],
        flags: {
          [MODULE_ID]: {
            managed: true,
            automation: "barbarian-rage-activity"
          }
        },
        range: {
          value: null,
          units: "self",
          special: "",
          override: false
        },
        target: {
          template: {
            count: "",
            contiguous: false,
            type: "",
            size: "",
            width: "",
            height: "",
            units: ""
          },
          affects: {
            count: "",
            type: "self",
            choice: false,
            special: ""
          },
          prompt: false,
          override: false
        },
        uses: {
          spent: 0,
          max: "",
          recovery: []
        }
      }
    },
    effects: [{
      _id: effectId,
      name: "Ярость",
      type: "base",
      img: DEFAULT_FEATURE_ICON,
      system: {},
      changes: [
        {
          key: "system.bonuses.mwak.damage",
          mode: EFFECT_MODE_ADD,
          value: rageDamageFormula,
          priority: 20
        },
        {
          key: "system.traits.dr.value",
          mode: EFFECT_MODE_ADD,
          value: "bludgeoning",
          priority: 20
        },
        {
          key: "system.traits.dr.value",
          mode: EFFECT_MODE_ADD,
          value: "piercing",
          priority: 20
        },
        {
          key: "system.traits.dr.value",
          mode: EFFECT_MODE_ADD,
          value: "slashing",
          priority: 20
        },
        {
          key: "flags.midi-qol.advantage.check.str",
          mode: EFFECT_MODE_CUSTOM,
          value: "1",
          priority: 20
        },
        {
          key: "flags.midi-qol.advantage.save.str",
          mode: EFFECT_MODE_CUSTOM,
          value: "1",
          priority: 20
        }
      ],
      disabled: false,
      duration: {
        startTime: null,
        seconds: null,
        combat: null,
        rounds: 10,
        turns: null,
        startRound: null,
        startTurn: null
      },
      description: "<p>Автоматизация ярости: бонус к урону, сопротивления и преимущества проверок/спасбросков Силы.</p>",
      origin: null,
      transfer: false,
      statuses: [],
      sort: 0,
      flags: {
        dae: {
          selfTarget: true,
          selfTargetAlways: true,
          specialDuration: ["combatEnd"]
        },
        [MODULE_ID]: {
          managed: true,
          automation: "barbarian-rage-effect"
        }
      }
    }],
    usesRecovery: [{
      period: "lr",
      type: "recoverAll",
      formula: ""
    }]
  };
}

function createUnarmoredDefenseFeatureAutomation(feature, classIdentifier) {
  const effectId = stableHashId(`${classIdentifier}:${feature.featureId}:unarmored-defense`, "effect");

  return {
    activities: {},
    effects: [{
      _id: effectId,
      name: "Защита без доспехов",
      type: "base",
      img: DEFAULT_FEATURE_ICON,
      system: {},
      changes: [{
        key: "system.attributes.ac.calc",
        mode: EFFECT_MODE_OVERRIDE,
        value: "unarmoredBarb",
        priority: 20
      }],
      disabled: false,
      duration: {
        startTime: null,
        seconds: null,
        combat: null,
        rounds: null,
        turns: null,
        startRound: null,
        startTurn: null
      },
      description: "<p>Автоматизация: КД рассчитывается как 10 + Ловкость + Телосложение, пока не надет доспех.</p>",
      origin: null,
      transfer: true,
      statuses: [],
      sort: 0,
      flags: {
        dae: {
          disableCondition: "@attributes.ac.armor > 10"
        },
        [MODULE_ID]: {
          managed: true,
          automation: "barbarian-unarmored-defense"
        }
      }
    }],
    usesRecovery: []
  };
}

function createActivityRollPart({ formula = "", types = [] } = {}) {
  const customFormula = cleanString(formula);
  return {
    number: customFormula ? null : null,
    denomination: customFormula ? null : null,
    bonus: "",
    types: Array.isArray(types) ? types : [],
    custom: {
      enabled: true,
      formula: customFormula || "0"
    },
    scaling: {
      mode: "",
      number: 1,
      formula: ""
    }
  };
}

function activationValue(activationType) {
  return ["action", "bonus", "reaction", "minute", "hour", "day"].includes(activationType) ? 1 : null;
}

function createRageActionActivity(feature, classIdentifier, activity, index = 0) {
  const activityId = stableHashId(`${classIdentifier}:${feature.featureId}:rage-action:${index}`, "activity");
  const type = cleanString(activity.type, "utility");
  const activationType = cleanString(activity.activation, "action");
  const rangeValue = Number.isFinite(Number(activity.range)) ? Number(activity.range) : null;
  const rangeUnits = cleanString(activity.rangeUnits, rangeValue === null ? "self" : "ft");

  const data = {
    _id: activityId,
    type,
    name: cleanString(activity.name, feature.name),
    img: RAGE_ACTION_ACTIVITY_IMAGE[type] ?? RAGE_ACTION_ACTIVITY_IMAGE.utility,
    sort: index * 100000,
    activation: {
      type: activationType,
      value: activationValue(activationType),
      condition: cleanString(activity.condition),
      override: false
    },
    consumption: {
      scaling: {
        allowed: false,
        max: ""
      },
      spellSlot: false,
      targets: []
    },
    description: {
      chatFlavor: cleanString(activity.chatFlavor)
    },
    duration: {
      value: "",
      units: "inst",
      special: "",
      concentration: false,
      override: false
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        automation: "barbarian-rage-action-activity",
        rageAction: normalizeMatchText(feature.name)
      }
    },
    range: {
      value: rangeValue,
      units: rangeUnits,
      special: cleanString(activity.rangeSpecial),
      override: false
    },
    target: {
      template: {
        count: "",
        contiguous: false,
        type: cleanString(activity.templateType),
        size: cleanString(activity.templateSize),
        width: "",
        height: "",
        units: cleanString(activity.templateUnits)
      },
      affects: {
        count: cleanString(activity.targetCount),
        type: cleanString(activity.targetType, rangeUnits === "self" ? "self" : ""),
        choice: false,
        special: cleanString(activity.targetSpecial)
      },
      prompt: false,
      override: false
    },
    uses: {
      spent: 0,
      max: "",
      recovery: []
    }
  };

  if (type === "damage" && isPlainObject(activity.damage)) {
    data.damage = {
      onSave: cleanString(activity.damage.onSave),
      parts: [createActivityRollPart({
        formula: activity.damage.formula,
        types: Array.isArray(activity.damage.types) ? activity.damage.types : []
      })]
    };
  }

  if (type === "heal" && isPlainObject(activity.healing)) {
    data.healing = createActivityRollPart({
      formula: activity.healing.formula,
      types: Array.isArray(activity.healing.types) ? activity.healing.types : ["healing"]
    });
  }

  if (type === "save" && isPlainObject(activity.save)) {
    data.save = {
      ability: [cleanString(activity.save.ability, "dex")],
      dc: {
        calculation: "",
        formula: cleanString(activity.save.dc, "8 + @prof + @abilities.str.mod")
      }
    };
    data.damage = {
      onSave: cleanString(activity.save.onSave, "none"),
      parts: isPlainObject(activity.save.damage) ? [createActivityRollPart({
        formula: activity.save.damage.formula,
        types: Array.isArray(activity.save.damage.types) ? activity.save.damage.types : []
      })] : []
    };
  }

  if (type === "check" && isPlainObject(activity.check)) {
    data.check = {
      ability: cleanString(activity.check.ability, "str"),
      associated: Array.isArray(activity.check.associated)
        ? activity.check.associated.filter(Boolean).map((entry) => cleanString(entry))
        : [],
      dc: {
        calculation: "",
        formula: cleanString(activity.check.dc)
      }
    };
  }

  return data;
}

function createRageActionAutomation(feature, classIdentifier) {
  const actionKey = normalizeMatchText(feature.name);
  const actionDefinitions = {
    "последний удар": [{
      type: "utility",
      activation: "action",
      rangeUnits: "self",
      targetType: "self",
      chatFlavor: "Совершите особую рукопашную атаку оружием. Доп. урон 1к2 за каждый оставшийся раунд Ярости (макс. 10). После атаки Ярость завершается."
    }],
    "нестись в бой": [{
      type: "utility",
      activation: "action",
      rangeUnits: "self",
      targetType: "self",
      chatFlavor: "Переместитесь на 10 футов в одном направлении и совершите рукопашную атаку оружием со свойством «Наскок 2к2»."
    }],
    "задорный захват": [{
      type: "damage",
      activation: "action",
      rangeUnits: "touch",
      targetType: "creature",
      chatFlavor: "Совершите проверку Захвата (досягаемость +5 футов). При успехе нанесите дробящий урон, равный модификатору Силы, и переместите цель в пределах досягаемости.",
      damage: {
        formula: "@abilities.str.mod",
        types: ["bludgeoning"]
      }
    }],
    "крик злобы": [{
      type: "heal",
      activation: "action",
      rangeUnits: "self",
      targetType: "self",
      chatFlavor: "Получите 1к6 временных хитов. Если результат куба меньше или равен дополнительному урону от Ярости, враги в 10 футах становятся Испуганными 2 до конца их следующего хода.",
      healing: {
        formula: "1d6",
        types: ["healing"]
      }
    }],
    "колотить молотить": [{
      type: "damage",
      activation: "action",
      rangeUnits: "touch",
      targetType: "creature",
      chatFlavor: "Нанесите 2к10 дробящего урона существу, удерживаемому в захвате. После урона примените свойство «Смертельное».",
      damage: {
        formula: "2d10",
        types: ["bludgeoning"]
      }
    }],
    топот: [{
      type: "utility",
      activation: "action",
      rangeUnits: "self",
      targetType: "self",
      chatFlavor: "Создайте 5-футовую эманацию труднопроходимой местности. Область можно расчистить Действием. Вы впервые покидаете её без доп. траты скорости."
    }],
    "преследующие атаки": [{
      type: "utility",
      activation: "action",
      rangeUnits: "self",
      targetType: "self",
      chatFlavor: "Используйте только после промаха рукопашной атакой: совершите рукопашную атаку со свойствами «РКУ 1» и «МУ 1»."
    }],
    "дружеский пинок": [{
      type: "utility",
      activation: "action",
      rangeUnits: "touch",
      targetType: "ally",
      chatFlavor: "Схватите союзника и бросьте его на расстояние до 30 футов, если можете его поднять."
    }],
    "далекий прыжок": [{
      type: "utility",
      activation: "action",
      rangeUnits: "self",
      targetType: "self",
      chatFlavor: "Совершите особый прыжок (длина/высота) на расстояние до удвоенного значения Силы без расхода скорости ходьбы. После падения не получаете урон и приземляетесь на ноги."
    }],
    "провоцирующий крик": [{
      type: "check",
      activation: "action",
      rangeUnits: "self",
      targetType: "self",
      chatFlavor: "Совершите действие Провокация, используя Силу (Запугивание) вместо Харизмы (Запугивание).",
      check: {
        ability: "str",
        associated: ["itm"]
      }
    }],
    "прорезающая атака": [{
      type: "utility",
      activation: "action",
      rangeUnits: "self",
      targetType: "self",
      chatFlavor: "Совершите Прорубание и примените «Смертельное» ко всем поражённым целям. Если «Смертельное» сработало, добавьте его значение к урону, переносимому на следующую цель."
    }],
    "улучшенная преследующая атака": [{
      type: "utility",
      activation: "action",
      rangeUnits: "self",
      targetType: "self",
      chatFlavor: "Совершите рукопашную атаку со свойствами «РКУ 1» и «МУ 1». После промаха рукопашной атакой значения РКУ из всех источников удваиваются для этой атаки."
    }],
    "улучшенный топот": [{
      type: "save",
      activation: "action",
      rangeUnits: "self",
      targetType: "creature",
      chatFlavor: "10-футовая эманация. Существа совершают спасбросок Ловкости: при провале 3к10 дробящего урона и цель Падает ничком. Область становится труднопроходимой местностью до расчистки.",
      save: {
        ability: "dex",
        dc: "8 + @prof + @abilities.str.mod",
        onSave: "none",
        damage: {
          formula: "3d10",
          types: ["bludgeoning"]
        }
      }
    }],
    "кровавое вращение": [{
      type: "utility",
      activation: "action",
      rangeUnits: "self",
      targetType: "self",
      chatFlavor: "Совершите Круговую атаку. Если попали хотя бы по одному существу, на 1 минуту получаете временные хиты: ваш уровень + количество атакованных существ."
    }],
    "ярость без конца": [{
      type: "utility",
      activation: "action",
      rangeUnits: "self",
      targetType: "self",
      chatFlavor: "Совершите одну рукопашную атаку оружием. При попадании можете немедленно совершить ещё одно Яростное действие. Повторно использовать до начала следующего хода нельзя."
    }],
    "взгляд на тысячу ярдов": [{
      type: "utility",
      activation: "action",
      range: 300,
      rangeUnits: "ft",
      targetType: "creature",
      targetCount: "",
      chatFlavor: "Выберите любое количество существ в пределах 300 футов. Если максимум костей хитов существа 5 или меньше — оно умирает."
    }]
  };

  const activityDefinitions = actionDefinitions[actionKey] ?? [{
    type: "utility",
    activation: "action",
    rangeUnits: "self",
    targetType: "self",
    chatFlavor: "Яростное действие."
  }];

  const activities = {};
  for (const [index, activity] of activityDefinitions.entries()) {
    const itemActivity = createRageActionActivity(feature, classIdentifier, activity, index);
    activities[itemActivity._id] = itemActivity;
  }

  return {
    activities,
    effects: [],
    usesRecovery: []
  };
}

function createDominanceManeuverAutomation(feature, classIdentifier) {
  const activityId = stableHashId(`${classIdentifier}:${feature.featureId}:dominance-maneuver`, "activity");
  const description = cleanString(feature.description, feature.name);
  const activationType = /триггер|реакци|⚡/iu.test(description)
    ? "reaction"
    : /бонусным действием/iu.test(description)
      ? "bonus"
      : "action";

  return {
    activities: {
      [activityId]: {
        _id: activityId,
        type: "utility",
        name: feature.name,
        img: RAGE_ACTION_ACTIVITY_IMAGE.utility,
        sort: 0,
        activation: {
          type: activationType,
          value: activationValue(activationType),
          condition: "",
          override: false
        },
        consumption: {
          scaling: {
            allowed: false,
            max: ""
          },
          spellSlot: false,
          targets: [{
            type: "itemUses",
            target: "fighter-dominance",
            value: "1",
            scaling: {
              mode: "",
              formula: ""
            }
          }]
        },
        description: {
          chatFlavor: `${feature.name}: используйте кость доминирования @scale.${classIdentifier}.dominance-die. ${description}`
        },
        duration: {
          value: "",
          units: "inst",
          special: "",
          concentration: false,
          override: false
        },
        effects: [],
        flags: {
          [MODULE_ID]: {
            managed: true,
            automation: "fighter-dominance-maneuver",
            maneuver: normalizeMatchText(feature.name)
          }
        },
        range: {
          value: null,
          units: "self",
          special: "",
          override: false
        },
        target: {
          template: {
            count: "",
            contiguous: false,
            type: "",
            size: "",
            width: "",
            height: "",
            units: ""
          },
          affects: {
            count: "",
            type: "self",
            choice: false,
            special: ""
          },
          prompt: false,
          override: false
        },
        uses: {
          spent: 0,
          max: "",
          recovery: []
        }
      }
    },
    effects: [],
    usesRecovery: []
  };
}

function createToggleEffect(feature, classIdentifier, { transfer = true, duration = {} } = {}) {
  const effectId = stableHashId(`${classIdentifier}:${feature.featureId}:toggle-effect`, "effect");
  return {
    _id: effectId,
    name: feature.name,
    type: "base",
    img: DEFAULT_FEATURE_ICON,
    system: {},
    changes: [],
    disabled: false,
    duration: {
      startTime: null,
      seconds: null,
      combat: null,
      rounds: duration.rounds ?? null,
      turns: duration.turns ?? null,
      startRound: null,
      startTurn: null
    },
    description: toHtmlParagraphs(feature.description),
    origin: null,
    transfer,
    statuses: [],
    sort: 0,
    flags: {
      [MODULE_ID]: {
        managed: true,
        automation: "fighter-multiattack-toggle"
      }
    }
  };
}

function createFighterMultiattackAutomation(feature, classIdentifier) {
  const normalizedName = normalizeMatchText(feature.name);
  const activityId = stableHashId(`${classIdentifier}:${feature.featureId}:multiattack-activity`, "activity");
  const isActionSurge = normalizedName.includes("всплеск действий");
  const effect = createToggleEffect(feature, classIdentifier, {
    transfer: !isActionSurge,
    duration: isActionSurge ? { turns: 1 } : {}
  });

  const activities = {
    [activityId]: {
      _id: activityId,
      type: "utility",
      name: isActionSurge ? "Активировать всплеск действий" : "Активировать",
      img: RAGE_ACTION_ACTIVITY_IMAGE.utility,
      sort: 0,
      activation: {
        type: isActionSurge ? "special" : "action",
        value: isActionSurge ? null : 1,
        condition: isActionSurge ? "В свой ход, без траты действия" : "",
        override: false
      },
      consumption: {
        scaling: {
          allowed: false,
          max: ""
        },
        spellSlot: false,
        targets: isActionSurge
          ? [{
            type: "itemUses",
            target: "",
            value: "1",
            scaling: {
              mode: "",
              formula: ""
            }
          }]
          : []
      },
      description: {
        chatFlavor: feature.description
      },
      duration: {
        value: isActionSurge ? 1 : "",
        units: isActionSurge ? "turn" : "inst",
        special: "",
        concentration: false,
        override: false
      },
      effects: [{ _id: effect._id }],
      flags: {
        [MODULE_ID]: {
          managed: true,
          automation: "fighter-multiattack"
        }
      },
      range: {
        value: null,
        units: "self",
        special: "",
        override: false
      },
      target: {
        template: {
          count: "",
          contiguous: false,
          type: "",
          size: "",
          width: "",
          height: "",
          units: ""
        },
        affects: {
          count: "",
          type: "self",
          choice: false,
          special: ""
        },
        prompt: false,
        override: false
      },
      uses: {
        spent: 0,
        max: "",
        recovery: []
      }
    }
  };

  return {
    activities,
    effects: [effect],
    usesMax: isActionSurge ? "@prof" : "",
    usesRecovery: isActionSurge
      ? [{
        period: "lr",
        type: "recoverAll",
        formula: ""
      }]
      : []
  };
}

function createFeatureAutomation(feature, classIdentifier) {
  if (feature.sourceType === "rageAction") {
    return createRageActionAutomation(feature, classIdentifier);
  }

  if (feature.sourceType === "fighterManeuver") {
    return createDominanceManeuverAutomation(feature, classIdentifier);
  }

  if (feature.sourceType !== "classFeature") {
    return createEmptyFeatureAutomation();
  }

  const normalizedName = normalizeMatchText(feature.name);
  if (classIdentifier === "fighter-rework-v028" && normalizedName.startsWith("воинская мультиатака")) {
    return createFighterMultiattackAutomation(feature, classIdentifier);
  }

  if (normalizedName === "ярость") {
    return createRageFeatureAutomation(feature, classIdentifier);
  }

  if (normalizedName === "защита без доспехов") {
    return createUnarmoredDefenseFeatureAutomation(feature, classIdentifier);
  }

  return createEmptyFeatureAutomation();
}

function createFeatureSystem(feature, classIdentifier, featureAutomation = null, context = {}) {
  const normalizedName = normalizeMatchText(feature.name);
  const isRageFeature = feature.sourceType === "classFeature" && normalizedName === "ярость";
  const isDominanceFeature = feature.sourceType === "classFeature"
    && classIdentifier === "fighter-rework-v028"
    && normalizedName === "стиль доминирования";
  const automation = featureAutomation ?? createFeatureAutomation(feature, classIdentifier);
  const rageRecovery = isRageFeature
    ? [{
      period: "lr",
      type: "recoverAll",
      formula: ""
    }]
    : [];
  const dominanceRecovery = isDominanceFeature
    ? [{
      period: "lr",
      type: "recoverAll",
      formula: ""
    }]
    : [];
  const defaultRecovery = rageRecovery.length ? rageRecovery : dominanceRecovery;
  const usesRecovery = Array.isArray(automation?.usesRecovery) && automation.usesRecovery.length
    ? foundry.utils.deepClone(automation.usesRecovery)
    : defaultRecovery;

  return {
    description: {
      value: toHtmlParagraphs(feature.description),
      chat: ""
    },
    source: {
      custom: cleanString(feature.sourceLabel, DEFAULT_SOURCE_LABEL)
    },
    identifier: buildAsciiIdentifier(feature.identifier, feature.featureId),
    type: {
      value: "class",
      subtype: ""
    },
    requirements: buildSubtypeRequirementsLabel(feature),
    prerequisites: {
      items: [],
      level: Math.max(0, Math.floor(parseNumber(feature.requiredLevel, 0))),
      repeatable: false
    },
    properties: [],
    activities: foundry.utils.deepClone(automation?.activities ?? {}),
    uses: {
      spent: 0,
      max: isRageFeature
        ? `@scale.${classIdentifier}.rage-uses`
        : isDominanceFeature
          ? `@scale.${classIdentifier}.dominance-dice`
          : cleanString(automation?.usesMax),
      recovery: usesRecovery
    },
    advancement: foundry.utils.deepClone(buildFeatureItemAdvancements(feature, context))
  };
}

function createPackMetadata({ name, label, itemTypes = [] }) {
  return {
    label,
    type: "Item",
    name,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: REBREYA_SOURCE_LABEL,
        types: itemTypes
      }
    }
  };
}

async function ensurePack(packId, metadata) {
  let pack = game.packs.get(packId);
  if (pack && pack.documentName !== metadata.type) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (pack && metadata.system && pack.metadata.system !== metadata.system) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (!pack) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium(metadata);
  }

  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign compendium '${packId}' to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

async function deleteManagedDocuments(pack, documents) {
  const managedIds = documents
    .filter((document) => document.getFlag(MODULE_ID, "managed"))
    .map((document) => document.id);

  if (!managedIds.length) {
    return;
  }

  await Item.implementation.deleteDocuments(managedIds, { pack: pack.collection });
}

async function syncManagedDocumentIcons(pack, documents, resolveIcon) {
  if (typeof resolveIcon !== "function") {
    return;
  }

  const updates = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.getFlag?.(MODULE_ID, "managed")) {
      continue;
    }

    const nextIcon = cleanString(resolveIcon(document));
    if (!nextIcon || nextIcon === cleanString(document.img)) {
      continue;
    }

    updates.push({
      _id: document.id,
      img: nextIcon
    });
  }

  if (!updates.length) {
    return;
  }

  await Item.implementation.updateDocuments(updates, { pack: pack.collection });
}

function getPackFolders(pack) {
  if (pack?.folders?.contents) {
    return Array.from(pack.folders.contents);
  }

  if (typeof pack?.folders?.values === "function") {
    return Array.from(pack.folders.values());
  }

  return [];
}

async function clearPackFolderTree(pack, rootFolderName) {
  const targetName = cleanString(rootFolderName);
  if (!targetName) {
    return;
  }

  const roots = getPackFolders(pack).filter((folder) => (
    cleanString(folder?.name) === targetName
  ));
  if (!roots.length) {
    return;
  }

  for (const root of roots) {
    try {
      await root.delete({
        deleteSubfolders: true,
        deleteContents: false,
        render: false
      });
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to clear compendium folder tree '${targetName}' in ${pack?.collection}.`, error);
    }
  }
}

function shouldRebuildManagedPack(documents, entries, sourceIdFlag) {
  const managedDocuments = documents.filter((document) => document.getFlag(MODULE_ID, "managed"));
  if (managedDocuments.length !== entries.length) {
    return true;
  }

  const expectedBySourceId = new Map(entries.map((entry) => [entry[sourceIdFlag], entry]));
  for (const document of managedDocuments) {
    const sourceId = cleanString(document.getFlag(MODULE_ID, sourceIdFlag));
    const expected = expectedBySourceId.get(sourceId);
    if (!expected) {
      return true;
    }

    if (document.getFlag(MODULE_ID, "signature") !== expected.signature) {
      return true;
    }
  }

  return false;
}

async function createManagedDocuments(pack, entries, createData) {
  if (!entries.length) {
    return;
  }

  let folderIdByPath = new Map();
  try {
    folderIdByPath = await ensureCompendiumFolders(
      pack,
      entries.map((entry) => entry.folderPath)
    );
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to prepare compendium folders for ${pack.collection}.`, error);
  }

  const documentsData = entries.map((entry) => createData(entry, folderIdByPath));
  await Item.implementation.createDocuments(documentsData, { pack: pack.collection });
}

function buildTraitAdvancement({
  classIdentifier,
  seed,
  title,
  hint = "",
  level = 1,
  grants = [],
  choices = []
}) {
  return {
    _id: stableHashId(`${classIdentifier}:${seed}`, "adv"),
    type: "Trait",
    title: cleanString(title, "Владение"),
    hint: cleanString(hint),
    level: Math.max(0, Math.floor(parseNumber(level, 1))),
    configuration: {
      allowReplacements: false,
      mode: "default",
      grants: unique(grants),
      choices: (Array.isArray(choices) ? choices : [])
        .map((choice) => ({
          count: Math.max(1, Math.floor(parseNumber(choice?.count, 1))),
          pool: unique(Array.isArray(choice?.pool) ? choice.pool : [])
        }))
    },
    value: {}
  };
}

function createAbilityFixed(initial = {}) {
  return {
    str: Math.floor(parseNumber(initial.str, 0)),
    dex: Math.floor(parseNumber(initial.dex, 0)),
    con: Math.floor(parseNumber(initial.con, 0)),
    int: Math.floor(parseNumber(initial.int, 0)),
    wis: Math.floor(parseNumber(initial.wis, 0)),
    cha: Math.floor(parseNumber(initial.cha, 0))
  };
}

function buildAsiAdvancement(classIdentifier, level) {
  return {
    _id: stableHashId(`${classIdentifier}:asi:${level}`, "adv"),
    type: "AbilityScoreImprovement",
    title: "Повышение характеристик",
    hint: "Увеличьте характеристики или выберите черту.",
    level,
    configuration: {
      cap: 2,
      fixed: createAbilityFixed(),
      locked: [],
      max: 20,
      points: 2
    },
    value: {}
  };
}

function buildHitPointsAdvancement(classIdentifier) {
  return {
    _id: stableHashId(`${classIdentifier}:hit-points`, "adv"),
    type: "HitPoints",
    configuration: {},
    value: {}
  };
}

function buildScaleValueAdvancement({
  classIdentifier,
  seed,
  title,
  hint = "",
  identifier,
  scaleEntries = {},
  level = 1,
  type = "number"
}) {
  const normalizedScale = {};
  for (const [scaleLevel, scaleValue] of Object.entries(isPlainObject(scaleEntries) ? scaleEntries : {})) {
    const parsedLevel = Math.max(1, Math.floor(parseNumber(scaleLevel, 0)));
    if (parsedLevel < 1 || parsedLevel > 20) {
      continue;
    }

    if (type === "dice") {
      const match = cleanString(scaleValue).match(/^(\d*)d(\d+)$/iu);
      const number = match?.[1] ? Math.floor(parseNumber(match[1], 0)) : null;
      const faces = match ? Math.floor(parseNumber(match[2], 0)) : 0;
      if (faces > 0) {
        normalizedScale[String(parsedLevel)] = {
          number,
          faces,
          modifiers: []
        };
      }
      continue;
    }

    const parsedValue = Math.max(0, parseNumber(scaleValue, 0));
    if (parsedValue > 0) {
      normalizedScale[String(parsedLevel)] = { value: parsedValue };
    }
  }

  return {
    _id: stableHashId(`${classIdentifier}:${seed}`, "adv"),
    type: "ScaleValue",
    title: cleanString(title, "Масштабируемое значение"),
    hint: cleanString(hint),
    level: Math.max(0, Math.floor(parseNumber(level, 1))),
    configuration: {
      identifier: buildAsciiIdentifier(identifier, `${classIdentifier}:${seed}`),
      type: type === "dice" ? "dice" : "number",
      distance: {
        units: "ft"
      },
      scale: normalizedScale
    },
    value: {}
  };
}

function buildItemGrantAdvancement({
  classIdentifier,
  seed,
  title,
  hint = "",
  level = 1,
  itemUuids = [],
  optional = false
}) {
  const items = unique(itemUuids).map((uuid) => ({
    uuid,
    optional: optional === true
  }));

  return {
    _id: stableHashId(`${classIdentifier}:${seed}`, "adv"),
    type: "ItemGrant",
    title: cleanString(title, "Умения"),
    hint: cleanString(hint),
    level: Math.max(0, Math.floor(parseNumber(level, 1))),
    configuration: {
      items,
      optional: optional === true,
      spell: null
    },
    value: {}
  };
}

function buildItemChoiceAdvancement({
  classIdentifier,
  seed,
  title,
  hint = "",
  level = 1,
  count = 1,
  pool = []
}) {
  const normalizedPool = unique(pool).map((uuid) => ({ uuid }));

  return {
    _id: stableHashId(`${classIdentifier}:${seed}`, "adv"),
    type: "ItemChoice",
    title: cleanString(title, "Выбор умения"),
    hint: cleanString(hint),
    level: Math.max(0, Math.floor(parseNumber(level, 1))),
    configuration: {
      allowDrops: false,
      choices: {
        [String(level)]: {
          count: Math.max(1, Math.floor(parseNumber(count, 1))),
          replacement: false
        }
      },
      pool: normalizedPool,
      restriction: {
        level: "",
        list: [],
        subtype: "",
        type: ""
      },
      spell: null,
      type: "feat"
    },
    value: {}
  };
}

function pickPreferredFeat(records = [], preferredSection = "") {
  const list = Array.isArray(records) ? records.filter((entry) => entry?.uuid) : [];
  if (!list.length) {
    return null;
  }

  if (preferredSection) {
    const exactSection = list.find((entry) => entry.section === preferredSection);
    if (exactSection) {
      return exactSection;
    }
  }

  return list[0] ?? null;
}

function resolveFeatByName(name, lookupByName, preferredSection = "") {
  const normalizedName = normalizeMatchText(name);
  if (!normalizedName || !(lookupByName instanceof Map)) {
    return null;
  }

  const direct = lookupByName.get(normalizedName);
  if (direct?.length) {
    return pickPreferredFeat(direct, preferredSection);
  }

  for (const [candidateName, records] of lookupByName.entries()) {
    if (candidateName.includes(normalizedName) || normalizedName.includes(candidateName)) {
      return pickPreferredFeat(records, preferredSection);
    }
  }

  return null;
}

function featureUuidsForIds(featureIds = [], context = {}) {
  const featureUuidById = context.featureUuidById instanceof Map ? context.featureUuidById : new Map();
  return unique((Array.isArray(featureIds) ? featureIds : [])
    .map((featureId) => featureUuidById.get(featureId))
    .filter(Boolean));
}

function maneuverUuidPoolFromContext(context = {}) {
  const classIdentifier = cleanString(context.classIdentifier, "fighter-rework-v028");
  const maneuverFeatureIds = Array.isArray(context.maneuverFeatureIds)
    ? context.maneuverFeatureIds
    : (Array.isArray(context.maneuverEntries) ? context.maneuverEntries : [])
      .map((entry) => `${classIdentifier}::fighterManeuver::${entry.featureId}`)
      .filter(Boolean);

  return featureUuidsForIds(maneuverFeatureIds, context);
}

function buildFeatureItemAdvancements(feature, context = {}) {
  const advancements = [];

  if (feature.sourceType !== "fightingStyle") {
    return advancements;
  }

  const classIdentifier = cleanString(feature.featureId, feature.classIdentifier);
  const styleFeat = resolveFeatByName(
    feature.styleName ?? feature.name,
    context.featLookupByName,
    FIGHTING_STYLE_FEATS_SECTION
  );
  if (styleFeat?.uuid) {
    advancements.push(buildItemGrantAdvancement({
      classIdentifier,
      seed: "style-feat",
      title: "Черта боевого стиля",
      hint: "Черта из компендиума черт, соответствующая выбранному боевому стилю.",
      level: 0,
      itemUuids: [styleFeat.uuid]
    }));
  }

  const fixedManeuverUuids = featureUuidsForIds(feature.maneuverFeatureIds, context);
  if (fixedManeuverUuids.length) {
    advancements.push(buildItemGrantAdvancement({
      classIdentifier,
      seed: "fixed-maneuvers",
      title: "Приёмы боевого стиля",
      hint: "Приёмы, которые выдаёт выбранный боевой стиль.",
      level: 0,
      itemUuids: fixedManeuverUuids
    }));
    return advancements;
  }

  const allManeuverUuids = featureUuidsForIds(feature.allManeuverFeatureIds, context);
  if (!feature.maneuvers?.length && allManeuverUuids.length) {
    advancements.push(buildItemChoiceAdvancement({
      classIdentifier,
      seed: "chosen-maneuvers",
      title: "Приёмы боевого стиля",
      hint: "Выберите три любых боевых приёма.",
      level: 0,
      count: 3,
      pool: allManeuverUuids
    }));
  }

  return advancements;
}

function buildSubclassAdvancement(classIdentifier, classData = {}) {
  return {
    _id: stableHashId(`${classIdentifier}:subclass`, "adv"),
    type: "Subclass",
    title: cleanString(classData.subclassTitle, "Архетип"),
    hint: cleanString(classData.subclassHint, "Выберите архетип."),
    level: 3,
    value: {}
  };
}

function normalizeFeatIndexRecord(record, pack) {
  const id = record?._id ?? record?.id ?? "";
  const uuid = compendiumItemUuid(pack.collection, id);
  const section = normalizeMatchText(foundry.utils.getProperty(record, "flags.teyvankal.section"));
  const choiceOption = foundry.utils.getProperty(record, `flags.${MODULE_ID}.choiceOption`);

  return {
    id,
    uuid,
    name: cleanString(record?.name),
    normalizedName: normalizeMatchText(record?.name),
    section,
    isChoiceOption: isPlainObject(choiceOption)
  };
}

async function buildFeatLookup() {
  const pack = game.packs.get(FEATS_PACK_ID);
  if (!pack) {
    return {
      minorFeatUuids: [],
      byName: new Map()
    };
  }

  const index = await pack.getIndex({
    fields: [
      "flags.teyvankal.section",
      `flags.${MODULE_ID}.choiceOption`
    ]
  });
  const minorFeatRecords = [];
  const allFeatRecords = [];
  const byName = new Map();

  for (const row of index) {
    const record = normalizeFeatIndexRecord(row, pack);
    if (!record.uuid || record.isChoiceOption) {
      continue;
    }

    if (record.normalizedName) {
      if (!byName.has(record.normalizedName)) {
        byName.set(record.normalizedName, []);
      }
      byName.get(record.normalizedName).push(record);
    }

    const sortName = cleanString(record.name, record.normalizedName || record.uuid);
    allFeatRecords.push({
      uuid: record.uuid,
      sortName
    });
    if (record.section === MINOR_FEATS_SECTION) {
      minorFeatRecords.push({
        uuid: record.uuid,
        sortName
      });
    }
  }

  const sortRecords = (records = []) => {
    const byUuid = new Map();
    for (const record of records) {
      const uuid = cleanString(record?.uuid);
      if (!uuid || byUuid.has(uuid)) {
        continue;
      }

      byUuid.set(uuid, {
        uuid,
        sortName: cleanString(record?.sortName, uuid)
      });
    }

    return Array.from(byUuid.values())
      .sort((left, right) => left.sortName.localeCompare(right.sortName, "ru", { sensitivity: "base", numeric: true }))
      .map((record) => record.uuid);
  };

  const normalizedMinor = sortRecords(minorFeatRecords);
  if (normalizedMinor.length) {
    return {
      minorFeatUuids: normalizedMinor,
      byName
    };
  }

  return {
    minorFeatUuids: sortRecords(allFeatRecords),
    byName
  };
}

export async function buildMinorFeatPool() {
  return (await buildFeatLookup()).minorFeatUuids;
}

export function buildClassAdvancement(classData, context = {}) {
  const {
    featureUuidById = new Map(),
    classFeatureEntries = [],
    rageActionEntries = [],
    minorFeatUuids = [],
    rageProgression = {},
    rageDamageProgression = {},
    fightingStyleEntries = [],
    dominanceProgression = {}
  } = context;
  const classIdentifier = classData.identifier;
  const advancements = [];

  advancements.push(buildHitPointsAdvancement(classIdentifier));

  advancements.push(buildTraitAdvancement({
    classIdentifier,
    seed: "saves",
    title: "Спасброски",
    hint: "Владение спасбросками класса.",
    level: 1,
    grants: (classData.saveProficiencies ?? ["str", "con"]).map((save) => `saves:${save}`)
  }));

  advancements.push(buildTraitAdvancement({
    classIdentifier,
    seed: "skills",
    title: `Навыки: ${classData.name}`,
    hint: "Выберите два навыка класса.",
    level: 1,
    choices: [{
      count: 2,
      pool: (classData.skillPool ?? SKILL_POOL).map((skill) => `skills:${skill}`)
    }]
  }));

  if (Object.keys(rageProgression).length) {
    advancements.push(buildScaleValueAdvancement({
      classIdentifier,
      seed: "rage-uses",
      title: "Ярость: использования",
      hint: "Количество использований ярости до отдыха.",
      identifier: "rage-uses",
      scaleEntries: rageProgression,
      level: 1
    }));
  }

  if (Object.keys(rageDamageProgression).length) {
    advancements.push(buildScaleValueAdvancement({
      classIdentifier,
      seed: "rage-damage",
      title: "Урон ярости",
      hint: "Дополнительный урон в ярости.",
      identifier: "rage-damage",
      scaleEntries: rageDamageProgression,
      level: 1
    }));
  }

  if (Object.keys(dominanceProgression?.dice ?? {}).length) {
    advancements.push(buildScaleValueAdvancement({
      classIdentifier,
      seed: "dominance-dice",
      title: "Кости доминирования: число",
      hint: "Количество костей доминирования до отдыха.",
      identifier: "dominance-dice",
      scaleEntries: dominanceProgression.dice,
      level: 1
    }));
  }

  if (Object.keys(dominanceProgression?.die ?? {}).length) {
    advancements.push(buildScaleValueAdvancement({
      classIdentifier,
      seed: "dominance-die",
      title: "Кость доминирования",
      hint: "Размер кости доминирования.",
      identifier: "dominance-die",
      scaleEntries: dominanceProgression.die,
      level: 1,
      type: "dice"
    }));
  }

  advancements.push(buildSubclassAdvancement(classIdentifier, classData));

  for (const level of ASI_LEVELS) {
    advancements.push(buildAsiAdvancement(classIdentifier, level));
  }

  const classFeatureByLevel = new Map();
  const optionalFeatureByLevel = new Map();
  for (const feature of classFeatureEntries) {
    const featureKey = `${classIdentifier}::class::${feature.featureId}`;
    const uuid = featureUuidById.get(featureKey);
    if (!uuid) {
      continue;
    }

    if (feature.normalizedName === SPECIAL_CLASS_FEATURES.MINOR_FEAT) {
      continue;
    }

    if (
      feature.normalizedName === SPECIAL_CLASS_FEATURES.ABILITY_SCORE_IMPROVEMENT
      || feature.normalizedName === SPECIAL_CLASS_FEATURES.ABILITY_SCORE_IMPROVEMENT_ALT
    ) {
      continue;
    }

    const level = Math.max(1, Math.floor(parseNumber(feature.requiredLevel, feature.levels?.[0] ?? 1)));
    const targetMap = feature.optional === true ? optionalFeatureByLevel : classFeatureByLevel;
    if (!targetMap.has(level)) {
      targetMap.set(level, []);
    }
    targetMap.get(level).push(uuid);
  }

  for (const [level, uuids] of Array.from(classFeatureByLevel.entries()).sort((a, b) => a[0] - b[0])) {
    advancements.push(buildItemGrantAdvancement({
      classIdentifier,
      seed: `class-grant-${level}`,
      title: `Классовые умения (${level}-й уровень)`,
      level,
      itemUuids: uuids,
      optional: false
    }));
  }

  for (const [level, uuids] of Array.from(optionalFeatureByLevel.entries()).sort((a, b) => a[0] - b[0])) {
    advancements.push(buildItemGrantAdvancement({
      classIdentifier,
      seed: `class-optional-${level}`,
      title: `Опциональное умение (${level}-й уровень)`,
      hint: "Опциональное правило из Реворка Варвара V0.12.",
      level,
      itemUuids: uuids,
      optional: true
    }));
  }

  if (minorFeatUuids.length) {
    for (const level of MINOR_FEAT_LEVELS) {
      advancements.push(buildItemChoiceAdvancement({
        classIdentifier,
        seed: `minor-feat-${level}`,
        title: `Младшая черта (${level}-й уровень)`,
        hint: "Выберите младшую черту из библиотеки модуля.",
        level,
        count: 1,
        pool: minorFeatUuids
      }));
    }
  }

  const rageActionByLevel = new Map(
    rageActionEntries
      .map((entry) => {
        const featureKey = `${classIdentifier}::rage-action::${entry.featureId}`;
        return [entry.featureId, featureUuidById.get(featureKey)];
      })
      .filter(([, uuid]) => Boolean(uuid))
  );

  for (const level of RAGE_ACTION_PICK_LEVELS) {
    const pool = rageActionEntries
      .filter((action) => Math.max(0, Math.floor(parseNumber(action.requiredLevel, 0))) <= level)
      .map((action) => rageActionByLevel.get(action.featureId))
      .filter(Boolean);

    if (!pool.length) {
      continue;
    }

    advancements.push(buildItemChoiceAdvancement({
      classIdentifier,
      seed: `rage-action-${level}`,
      title: `Яростные действия (${level}-й уровень)`,
      hint: "Изучите два варианта яростного действия.",
      level,
      count: 2,
      pool
    }));
  }

  const fightingStylePool = fightingStyleEntries
    .map((entry) => featureUuidById.get(`${classIdentifier}::fightingStyle::${entry.featureId}`))
    .filter(Boolean);

  if (fightingStylePool.length) {
    advancements.push(buildItemChoiceAdvancement({
      classIdentifier,
      seed: "fighting-style",
      title: "Боевой стиль",
      hint: "Выберите один боевой стиль воина. Приёмы, которые даёт стиль, указаны в описании выбранного айтема.",
      level: 1,
      count: 1,
      pool: fightingStylePool
    }));
  }

  return advancements;
}

export function buildSubclassAdvancements(subclass, context = {}) {
  const { featureUuidById } = context;
  const grouped = new Map();

  for (const feature of subclass.features) {
    const featureKey = `${subclass.subclassId}::subclass::${feature.featureId}`;
    const uuid = featureUuidById.get(featureKey);
    if (!uuid) {
      continue;
    }

    const level = Math.max(1, Math.floor(parseNumber(feature.requiredLevel, feature.levels?.[0] ?? 3)));
    if (!grouped.has(level)) {
      grouped.set(level, []);
    }
    grouped.get(level).push(uuid);
  }

  const advancements = [];
  for (const [level, uuids] of Array.from(grouped.entries()).sort((a, b) => a[0] - b[0])) {
    advancements.push(buildItemGrantAdvancement({
      classIdentifier: subclass.subclassId,
      seed: `grant-${level}`,
      title: `${subclass.name}: умения (${level}-й уровень)`,
      level,
      itemUuids: uuids,
      optional: false
    }));
  }

  const maneuverUuids = maneuverUuidPoolFromContext(context);
  if (normalizeMatchText(subclass.name) === BATTLE_MASTER_SUBCLASS_NAME && maneuverUuids.length) {
    for (const level of BATTLE_MASTER_MANEUVER_CHOICE_LEVELS) {
      advancements.push(buildItemChoiceAdvancement({
        classIdentifier: subclass.subclassId,
        seed: `maneuvers-${level}`,
        title: `Приёмы (${level}-й уровень)`,
        hint: "Выберите два боевых приёма мастера боевых искусств.",
        level,
        count: 2,
        pool: maneuverUuids
      }));
    }
  }

  return advancements;
}

export function createClassSystem(classData, advancement = [], sourceLabel = DEFAULT_SOURCE_LABEL) {
  return {
    description: {
      value: toHtmlParagraphs(classData.description),
      chat: ""
    },
    source: {
      custom: sourceLabel
    },
    identifier: buildAsciiIdentifier(classData.identifier, classData.name),
    levels: 1,
    hd: {
      additional: "",
      denomination: cleanString(classData.hitDie, DEFAULT_HD),
      spent: 0
    },
    primaryAbility: {
      value: unique(classData.primaryAbility ?? ["str"]),
      all: false
    },
    properties: [],
    spellcasting: {
      progression: "none",
      ability: ""
    },
    startingEquipment: [],
    wealth: cleanString(classData.wealth, "2d4*10"),
    advancement: foundry.utils.deepClone(advancement)
  };
}

function createSubclassSystem(subclass, classIdentifier, advancement = [], sourceLabel = DEFAULT_SOURCE_LABEL) {
  return {
    description: {
      value: toHtmlParagraphs(subclass.description),
      chat: ""
    },
    source: {
      custom: sourceLabel
    },
    identifier: buildAsciiIdentifier(subclass.subclassId, subclass.name),
    classIdentifier: buildAsciiIdentifier(classIdentifier, classIdentifier),
    spellcasting: {
      progression: "none",
      ability: ""
    },
    advancement: foundry.utils.deepClone(advancement)
  };
}

function buildClassSignature(classData, system, metadata = {}) {
  return JSON.stringify({
    templateVersion: CLASS_TEMPLATE_VERSION,
    classIdentifier: classData.identifier,
    name: classData.name,
    source: metadata.sourceLabel ?? DEFAULT_SOURCE_LABEL,
    featureIds: metadata.featureIds ?? [],
    system
  });
}

function buildSubclassSignature(subclass, system, metadata = {}) {
  return JSON.stringify({
    templateVersion: SUBCLASS_TEMPLATE_VERSION,
    subclassId: subclass.subclassId,
    name: subclass.name,
    classIdentifier: metadata.classIdentifier ?? "",
    source: metadata.sourceLabel ?? DEFAULT_SOURCE_LABEL,
    featureIds: metadata.featureIds ?? [],
    system
  });
}

function addIconCandidate(candidates, seenCandidates, value) {
  const text = cleanString(value);
  const key = normalizeMatchText(text);
  if (!key || seenCandidates.has(key)) {
    return;
  }

  seenCandidates.add(key);
  candidates.push(text);
}

function splitQualifiedFeatureName(featureName) {
  const [prefix, ...rest] = cleanString(featureName).split(":");
  return {
    prefix: cleanString(prefix),
    suffix: rest.join(":").trim()
  };
}

function resolveClassFeatureIcon(featureOrName, iconLookup) {
  const feature = isPlainObject(featureOrName)
    ? featureOrName
    : { name: featureOrName };
  const featureName = cleanString(feature.name);
  const sourceType = cleanString(feature.sourceType);
  const subclassName = cleanString(feature.subclassName);
  const styleName = cleanString(feature.styleName);
  const { prefix, suffix } = splitQualifiedFeatureName(featureName);
  const candidates = [];
  const seenCandidates = new Set();

  if (sourceType === "subclassFeature" && subclassName) {
    addIconCandidate(candidates, seenCandidates, `${featureName} — ${subclassName}`);
  }

  if (sourceType === "fighterManeuver") {
    addIconCandidate(candidates, seenCandidates, `${featureName} — приём`);
  }

  addIconCandidate(candidates, seenCandidates, featureName);

  if (sourceType === "fightingStyle" && styleName) {
    addIconCandidate(candidates, seenCandidates, styleName);
  }

  if (suffix) {
    addIconCandidate(candidates, seenCandidates, suffix);
    addIconCandidate(candidates, seenCandidates, prefix);
  }

  const sharedFeatureIconName = {
    "дополнительная черта": "Младшая черта",
    "увеличение характеристик": "Повышение характеристик",
    "увеличение характеристики": "Повышение характеристик"
  }[normalizeMatchText(featureName)];
  addIconCandidate(candidates, seenCandidates, sharedFeatureIconName);

  for (const candidate of candidates) {
    const icon = resolveNamedIcon(candidate, iconLookup);
    if (icon) {
      return icon;
    }
  }

  return DEFAULT_FEATURE_ICON;
}

function resolveSubclassIcon(subclassName, iconLookup) {
  return resolveNamedIcon(subclassName, iconLookup, DEFAULT_SUBCLASS_ICON);
}

function resolveClassIcon(className, iconLookup) {
  const iconByClassName = resolveNamedIcon(className, iconLookup);
  if (iconByClassName) {
    return iconByClassName;
  }

  if (normalizeMatchText(className).includes("воин")) {
    return resolveNamedIcon("Fighter", iconLookup, DEFAULT_CLASS_ICON);
  }

  return resolveNamedIcon("Barbarian", iconLookup, DEFAULT_CLASS_ICON);
}

export function createFeatureEntryData(feature, folderIdByPath, iconLookup = null, context = {}) {
  const folderPath = feature.folderPath.join("/");
  const featureAutomation = createFeatureAutomation(feature, feature.classIdentifier);
  const entryData = {
    name: feature.name,
    type: "feat",
    img: resolveClassFeatureIcon(feature, iconLookup),
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: createFeatureSystem(feature, feature.classIdentifier, featureAutomation, context),
    effects: foundry.utils.deepClone(featureAutomation.effects),
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: feature.sourceType,
        classIdentifier: feature.classIdentifier,
        subclassId: feature.subclassId,
        subclassName: feature.subclassName,
        styleName: feature.styleName,
        featureId: feature.featureId,
        requiredLevel: feature.requiredLevel,
        optional: feature.optional === true,
        maneuvers: feature.maneuvers ?? [],
        signature: buildFeatureSignature(feature, context),
        automation: feature.sourceType === "rageAction"
          ? { type: "rageAction", requiredLevel: feature.requiredLevel }
          : feature.sourceType === "fighterManeuver"
            ? { type: "fighterManeuver", requiredLevel: feature.requiredLevel }
            : undefined
      }
    }
  };

  if (feature.documentId) {
    entryData._id = feature.documentId;
  }

  return entryData;
}

function createSubclassEntryData(entry, folderIdByPath, iconLookup = null) {
  const folderPath = entry.folderPath.join("/");
  return {
    name: entry.subclass.name,
    type: "subclass",
    img: resolveSubclassIcon(entry.subclass.name, iconLookup),
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: foundry.utils.deepClone(entry.system),
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "subclass",
        subclassId: entry.subclass.subclassId,
        classIdentifier: entry.classIdentifier,
        signature: entry.signature
      }
    }
  };
}

function createClassEntryData(entry, folderIdByPath, iconLookup = null) {
  const folderPath = entry.folderPath.join("/");
  return {
    name: entry.classData.name,
    type: "class",
    img: resolveClassIcon(entry.classData.name, iconLookup),
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: foundry.utils.deepClone(entry.system),
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "class",
        classIdentifier: entry.classData.identifier,
        signature: entry.signature
      }
    }
  };
}

async function syncFeatureDocumentAdvancements(pack, documents, featureDefinitions, context = {}) {
  const definitionByFeatureId = new Map(
    (Array.isArray(featureDefinitions) ? featureDefinitions : [])
      .map((feature) => [feature.featureId, feature])
  );
  const updates = [];

  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.getFlag?.(MODULE_ID, "managed")) {
      continue;
    }

    const featureId = cleanString(document.getFlag(MODULE_ID, "featureId"));
    const feature = definitionByFeatureId.get(featureId);
    if (feature?.sourceType !== "fightingStyle") {
      continue;
    }

    const advancement = buildFeatureItemAdvancements(feature, context);
    const signature = buildFeatureSignature(feature, context);
    if (
      JSON.stringify(document.system?.advancement ?? []) === JSON.stringify(advancement)
      && document.getFlag(MODULE_ID, "signature") === signature
    ) {
      continue;
    }

    updates.push({
      _id: document.id ?? document._id,
      "system.advancement": advancement,
      [`flags.${MODULE_ID}.signature`]: signature
    });
  }

  if (updates.length) {
    await Item.implementation.updateDocuments(updates, { pack: pack.collection });
  }
}

async function syncClassFeaturePack(featureDefinitions, context = {}) {
  const pack = await ensurePack(CLASS_FEATURES_PACK_ID, createPackMetadata({
    name: CLASS_FEATURES_COMPENDIUM_NAME,
    label: CLASS_FEATURES_COMPENDIUM_LABEL,
    itemTypes: ["feat"]
  }));

  const documents = await getPackDocuments(pack);
  const comparisonFeatureContext = {
    ...context,
    featureUuidById: buildFeatureUuidMap(featureDefinitions, pack.collection, documents)
  };
  const features = featureDefinitions.map((feature) => ({
    ...feature,
    signature: buildFeatureSignature(feature, comparisonFeatureContext)
  }));
  if (shouldRebuildManagedPack(documents, features, "featureId")) {
    const creationFeatureContext = {
      ...context,
      featureUuidById: buildFeatureUuidMap(featureDefinitions, pack.collection)
    };
    const creationFeatures = featureDefinitions.map((feature) => ({
      ...feature,
      signature: buildFeatureSignature(feature, creationFeatureContext)
    }));

    await deleteManagedDocuments(pack, documents);
    for (const legacyRoot of LEGACY_CLASS_FEATURE_ROOT_FOLDERS) {
      await clearPackFolderTree(pack, legacyRoot);
    }
    const rootFolders = unique([
      CLASS_FEATURE_ROOT_FOLDER,
      FIGHTER_CLASS_FEATURE_ROOT_FOLDER,
      ...(Array.isArray(context.rootFolders) ? context.rootFolders : [])
    ]);
    for (const rootFolder of rootFolders) {
      await clearPackFolderTree(pack, rootFolder);
    }
    await createManagedDocuments(
      pack,
      creationFeatures,
      (entry, folderIdByPath) => createFeatureEntryData(entry, folderIdByPath, context.iconLookup, creationFeatureContext)
    );
  }

  const activePack = game.packs.get(CLASS_FEATURES_PACK_ID) ?? pack;
  const featureDocuments = await getPackDocuments(activePack);
  const featureUuidById = buildFeatureUuidMap(featureDefinitions, activePack.collection, featureDocuments);
  const featureDefinitionById = new Map(featureDefinitions.map((feature) => [feature.featureId, feature]));
  await syncFeatureDocumentAdvancements(activePack, featureDocuments, featureDefinitions, {
    ...context,
    featureUuidById
  });
  await syncManagedDocumentIcons(
    activePack,
    featureDocuments,
    (document) => {
      const featureId = cleanString(document.getFlag(MODULE_ID, "featureId"));
      return resolveClassFeatureIcon(featureDefinitionById.get(featureId) ?? document.name, context.iconLookup);
    }
  );

  return {
    pack: activePack,
    featureUuidById
  };
}

async function syncSubclassesPack(normalizedDataList, context) {
  const pack = await ensurePack(SUBCLASSES_PACK_ID, createPackMetadata({
    name: SUBCLASSES_COMPENDIUM_NAME,
    label: SUBCLASSES_COMPENDIUM_LABEL,
    itemTypes: ["subclass"]
  }));

  const subclassEntries = [];
  for (const normalizedData of Array.isArray(normalizedDataList) ? normalizedDataList : [normalizedDataList]) {
    const classIdentifier = normalizedData.classData.identifier;
    for (const subclass of normalizedData.subclasses) {
      const advancement = buildSubclassAdvancements(subclass, {
        ...context,
        classIdentifier,
        maneuverEntries: normalizedData.maneuvers
      });
      const system = createSubclassSystem(subclass, classIdentifier, advancement, normalizedData.sourceLabel);
      subclassEntries.push({
        subclass,
        classIdentifier,
        system,
        signature: buildSubclassSignature(subclass, system, {
          classIdentifier,
          sourceLabel: normalizedData.sourceLabel,
          featureIds: subclass.features.map((feature) => feature.featureId)
        }),
        folderPath: normalizeFolderPath([SUBCLASS_ROOT_FOLDER, normalizedData.classData.name])
      });
    }
  }

  const documents = await getPackDocuments(pack);
  const entriesForComparison = subclassEntries.map((entry) => ({
    subclassId: entry.subclass.subclassId,
    signature: entry.signature
  }));

  if (shouldRebuildManagedPack(documents, entriesForComparison, "subclassId")) {
    await deleteManagedDocuments(pack, documents);
    for (const legacyRoot of LEGACY_SUBCLASS_ROOT_FOLDERS) {
      await clearPackFolderTree(pack, legacyRoot);
    }
    await clearPackFolderTree(pack, SUBCLASS_ROOT_FOLDER);
    await createManagedDocuments(
      pack,
      subclassEntries,
      (entry, folderIdByPath) => createSubclassEntryData(entry, folderIdByPath, context.iconLookup)
    );
  }

  const activePack = game.packs.get(SUBCLASSES_PACK_ID) ?? pack;
  const activeDocuments = await getPackDocuments(activePack);
  await syncManagedDocumentIcons(
    activePack,
    activeDocuments,
    (document) => resolveSubclassIcon(document.name, context.iconLookup)
  );

  return activePack;
}

async function syncClassesPack(normalizedDataList, context) {
  const pack = await ensurePack(CLASSES_PACK_ID, createPackMetadata({
    name: CLASSES_COMPENDIUM_NAME,
    label: CLASSES_COMPENDIUM_LABEL,
    itemTypes: ["class"]
  }));

  const classEntries = [];
  for (const normalizedData of Array.isArray(normalizedDataList) ? normalizedDataList : [normalizedDataList]) {
    const classFeatures = normalizedData.classData.features;
    const classAdvancement = buildClassAdvancement(normalizedData.classData, {
      featureUuidById: context.featureUuidById,
      classFeatureEntries: classFeatures,
      rageActionEntries: normalizedData.rageActions,
      minorFeatUuids: context.minorFeatUuids,
      rageProgression: normalizedData.rageProgression,
      rageDamageProgression: normalizedData.rageDamageProgression,
      fightingStyleEntries: normalizedData.fightingStyles,
      dominanceProgression: normalizedData.dominanceProgression
    });
    const classSystem = createClassSystem(normalizedData.classData, classAdvancement, normalizedData.sourceLabel);
    classEntries.push({
      classData: normalizedData.classData,
      system: classSystem,
      signature: buildClassSignature(normalizedData.classData, classSystem, {
        sourceLabel: normalizedData.sourceLabel,
        featureIds: classFeatures.map((feature) => feature.featureId)
      }),
      folderPath: normalizeFolderPath([CLASS_ROOT_FOLDER])
    });
  }

  const documents = await getPackDocuments(pack);
  const entriesForComparison = classEntries.map((entry) => ({
    classIdentifier: entry.classData.identifier,
    signature: entry.signature
  }));
  if (shouldRebuildManagedPack(documents, entriesForComparison, "classIdentifier")) {
    await deleteManagedDocuments(pack, documents);
    for (const legacyRoot of LEGACY_CLASS_ROOT_FOLDERS) {
      await clearPackFolderTree(pack, legacyRoot);
    }
    await clearPackFolderTree(pack, CLASS_ROOT_FOLDER);
    await createManagedDocuments(
      pack,
      classEntries,
      (entry, folderIdByPath) => createClassEntryData(entry, folderIdByPath, context.iconLookup)
    );
  }

  const activePack = game.packs.get(CLASSES_PACK_ID) ?? pack;
  const activeDocuments = await getPackDocuments(activePack);
  await syncManagedDocumentIcons(
    activePack,
    activeDocuments,
    (document) => resolveClassIcon(document.name, context.iconLookup)
  );

  return activePack;
}

async function loadData() {
  const normalized = [];
  for (const path of CLASS_DATA_PATHS) {
    const rawData = await fetchJson(path);
    normalized.push(normalizeBarbarianData(rawData));
  }

  return normalized;
}

export class ClassesCompendiumService {
  async sync() {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const iconLookup = await buildNamedIconLookup(CLASS_ICON_SEARCH_PATHS, { forceRefresh: true });
    const normalizedData = await loadData();
    const featureDefinitions = normalizedData.flatMap((classData) => buildFeatureDefinitions(classData));
    const featLookup = await buildFeatLookup();
    const { pack: featuresPack, featureUuidById } = await syncClassFeaturePack(featureDefinitions, {
      iconLookup,
      featLookupByName: featLookup.byName,
      rootFolders: normalizedData.map((classData) => classData.classFeatureRootFolder)
    });
    const subclassesPack = await syncSubclassesPack(normalizedData, {
      featureUuidById,
      iconLookup
    });
    const classesPack = await syncClassesPack(normalizedData, {
      featureUuidById,
      minorFeatUuids: featLookup.minorFeatUuids,
      iconLookup
    });

    return {
      classesPack,
      subclassesPack,
      featuresPack
    }
  }
}
