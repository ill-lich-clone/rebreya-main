import {
  CLASS_FEATURES_COMPENDIUM_LABEL,
  CLASS_FEATURES_COMPENDIUM_NAME,
  CLASSES_COMPENDIUM_LABEL,
  CLASSES_COMPENDIUM_NAME,
  CRAFTSMAN_ARCHETYPE_REGISTRY,
  CRAFTSMAN_SUBCLASS_COMPENDIUM_ID,
  FEATS_COMPENDIUM_NAME,
  MODULE_ID,
  SPELLS_COMPENDIUM_NAME,
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
import {
  fighterSecondWindUsesMax,
  getFighterIronWillAutomation,
  getFighterManeuverAutomation,
  getFighterSecondWindAutomation
} from "./fighter-automation.js";
import { getClassStartingEquipmentConfig } from "./class-starting-equipment.js";
import {
  buildCraftsmanGadgetAutomation,
  buildCraftsmanGadgetFeatureDefinitions,
  normalizeCraftsmanGadgets
} from "./craftsman-gadget-definitions.js";
import {
  CRAFTSMAN_CONSTRUCT_FEATURE_ID,
  buildCraftsmanConstructSummonAutomation
} from "./craftsman-construct-definitions.js";
import { buildSlug } from "./item-classification.js";
import { renderDescriptionMarkdown } from "./markdown-description.js";
import { syncFlaggedManagedDocuments } from "./managed-compendium-sync.js";
import {
  getRuneKnightFeatureAutomation,
  getRuneKnightRuneAutomation
} from "./rune-knight-automation.js";
import { PALADIN_OATHS } from "./paladin-dogmas.js";

const DND5E_SYSTEM_ID = "dnd5e";
const DEFAULT_SOURCE_LABEL = "ЗоЗТ";
const REBREYA_SOURCE_LABEL = "Ребрея";
const COMPENDIUM_SIDEBAR_FOLDER = [REBREYA_SOURCE_LABEL];
const CLASS_DATA_PATHS = [
  `modules/${MODULE_ID}/data/barbarian-rework-v012.json`,
  `modules/${MODULE_ID}/data/fighter-rework-v028.json`,
  `modules/${MODULE_ID}/data/paladin-rework-v01.json`,
  `modules/${MODULE_ID}/data/rogue-rework-v00.json`,
  `modules/${MODULE_ID}/data/sorcerer-rework-v011.json`,
  `modules/${MODULE_ID}/data/craftsman-v01.json`
];
const MODULE_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const CLASS_ICON_SEARCH_PATHS = [
  `${MODULE_ICONS_BASE_PATH}/Classes/Fighter`,
  `${MODULE_ICONS_BASE_PATH}/Classes/Barbarian`,
  `${MODULE_ICONS_BASE_PATH}/Classes/Paladin`,
  `${MODULE_ICONS_BASE_PATH}/Classes/Rogue`,
  `${MODULE_ICONS_BASE_PATH}/Classes/Sorcerer`,
  `${MODULE_ICONS_BASE_PATH}/Fighter`,
  `${MODULE_ICONS_BASE_PATH}/Barbarian`,
  `${MODULE_ICONS_BASE_PATH}/Rogue`,
  `${MODULE_ICONS_BASE_PATH}/Feats`,
  MODULE_ICONS_BASE_PATH
];

const FEATS_PACK_ID = `world.${FEATS_COMPENDIUM_NAME}`;
const SPELLS_PACK_ID = `world.${SPELLS_COMPENDIUM_NAME}`;
const CLASS_FEATURES_PACK_ID = `world.${CLASS_FEATURES_COMPENDIUM_NAME}`;
const SUBCLASSES_PACK_ID = CRAFTSMAN_SUBCLASS_COMPENDIUM_ID;
const CLASSES_PACK_ID = `world.${CLASSES_COMPENDIUM_NAME}`;

const CLASS_ROOT_FOLDER = "Классы";
const SUBCLASS_ROOT_FOLDER = "Архетипы";
const CRAFTSMAN_SUBCLASS_ROOT_FOLDER = "Ремесленник V0.1";
const CLASS_FEATURE_ROOT_FOLDER = "Варвар (Реворк V0.12)";
const FIGHTER_CLASS_FEATURE_ROOT_FOLDER = "Воин (Реворк V0.28)";
const PALADIN_CLASS_FEATURE_ROOT_FOLDER = "Паладин (Реворк V0.1)";
const LEGACY_CLASS_ROOT_FOLDERS = ["Классы Rebreya"];
const LEGACY_SUBCLASS_ROOT_FOLDERS = ["Архетипы Rebreya"];
const LEGACY_CLASS_FEATURE_ROOT_FOLDERS = ["Умения варвара Rebreya (Реворк V0.12)"];

const CLASS_FEATURE_TEMPLATE_VERSION = 18;
const SUBCLASS_TEMPLATE_VERSION = 3;
const CRAFTSMAN_SUBCLASS_TEMPLATE_VERSION = 1;
const CLASS_TEMPLATE_VERSION = 6;
const FIGHTER_MANEUVER_SECTION_LABEL = "Воинские приёмы";
const ROGUE_CUNNING_STRIKE_SECTION_LABEL = "Хитрые удары";

const DEFAULT_CLASS_ICON = "icons/svg/book.svg";
const DEFAULT_SUBCLASS_ICON = "icons/svg/book.svg";
const DEFAULT_FEATURE_ICON = "icons/svg/book.svg";
const PALADIN_CLASS_ICON = "icons/skills/melee/sword-winged-holy-orange.webp";

const DEFAULT_HD = "d12";
const FIGHTER_HD = "d10";
const MINOR_FEAT_LEVELS = [3, 6, 9, 12, 15, 18];
const RAGE_ACTION_PICK_LEVELS = [5, 10, 15, 20];
const SKILL_POOL = ["ath", "prc", "sur", "itm", "nat", "ani"];
const FIGHTER_SKILL_POOL = ["acr", "ath", "prc", "sur", "itm", "his", "ins", "ani"];
const FIGHTER_ARMOR_PROFICIENCIES = ["lgt", "med", "hvy", "shl"];
const FIGHTER_WEAPON_PROFICIENCIES = ["sim", "mar"];
const ASI_LEVELS = [4, 8, 12, 16, 19];
const BATTLE_MASTER_SUBCLASS_NAME = "мастер боевых искусств";
const RUNE_KNIGHT_SUBCLASS_NAME = "рунный рыцарь";
const DRACONIC_SORCERER_SUBCLASS_NAME = "наследие драконьей крови";
const DRACONIC_ANCESTOR_FEATURE_NAME = "драконий предок";
const SORCERER_EXPANDED_METAMAGIC_FEATURE_NAME = "расширенный список метамагии";
const FIGHTING_STYLE_FEATS_SECTION = "черты боевых стилей";
const MINOR_FEATS_SECTION = "младшие черты";
const BATTLE_MASTER_MANEUVER_CHOICE_LEVELS = [3, 7, 10, 15, 18];
const SORCERER_METAMAGIC_CHOICE_LEVELS = [[3, 3], [10, 1], [17, 1]];
const RUNE_KNIGHT_RUNE_CHOICE_LEVELS = [
  { level: 3, count: 2 },
  { level: 7, count: 1 },
  { level: 10, count: 1 },
  { level: 15, count: 1 }
];
const RUNE_KNIGHT_RUNE_SPECS = [
  { name: "Каменная руна", requiredLevel: 3 },
  { name: "Ледяная руна", requiredLevel: 3 },
  { name: "Облачная руна", requiredLevel: 3 },
  { name: "Огненная руна", requiredLevel: 3 },
  { name: "Холмовая руна", requiredLevel: 7 },
  { name: "Штормовая руна", requiredLevel: 7 }
];
const EFFECT_MODE_CUSTOM = 0;
const EFFECT_MODE_ADD = 2;
const EFFECT_MODE_UPGRADE = 4;
const EFFECT_MODE_OVERRIDE = 5;
const STARTING_EQUIPMENT_TYPES = new Set(["OR", "AND", "armor", "tool", "weapon", "focus", "currency", "linked"]);
const STARTING_EQUIPMENT_KEYED_TYPES = new Set(["armor", "tool", "weapon", "focus", "currency", "linked"]);
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

function stableDocumentId(seed, usedIds, scope = "document") {
  let attempt = 1;
  let id = stableHashId(seed, scope);

  while (usedIds.has(id)) {
    attempt += 1;
    id = stableHashId(`${seed}:${attempt}`, scope);
  }

  usedIds.add(id);
  return id;
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

export function buildSubclassUuidMap(subclassEntries = [], documents = []) {
  const documentsBySubclassId = new Map();
  for (const document of Array.isArray(documents) ? documents : []) {
    if (
      !document?.getFlag?.(MODULE_ID, "managed")
      || document.getFlag(MODULE_ID, "sourceType") !== "subclass"
    ) {
      continue;
    }

    const subclassId = cleanString(document.getFlag(MODULE_ID, "subclassId"));
    if (subclassId && document.uuid) {
      documentsBySubclassId.set(subclassId, document);
    }
  }

  const subclassUuidById = new Map();
  for (const entry of Array.isArray(subclassEntries) ? subclassEntries : []) {
    const subclassId = cleanString(entry?.subclassId);
    const document = documentsBySubclassId.get(subclassId);
    if (!subclassId || !document) {
      continue;
    }

    if (entry.archetypeId && (
      document.getFlag(MODULE_ID, "archetypeId") !== entry.archetypeId
      || document.getFlag(MODULE_ID, "craftsmanTrack") !== entry.axis
      || document.getFlag(MODULE_ID, "classIdentifier") !== entry.classIdentifier
      || document.getFlag(MODULE_ID, "sourceRevision") !== entry.sourceRevision
      || document.getFlag(MODULE_ID, "signature") !== entry.signature
    )) {
      continue;
    }

    subclassUuidById.set(subclassId, document.uuid);
  }
  return subclassUuidById;
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
  return renderDescriptionMarkdown(value);
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function buildLooseTextPattern(value) {
  return Array.from(String(value ?? ""))
    .map((char) => {
      if (/[\u0435\u0451\u0415\u0401]/u.test(char)) {
        return "[еёЕЁ]";
      }

      return escapeRegExp(char);
    })
    .join("");
}

function addDescriptionLinkCandidate(candidates, seen, label, uuid) {
  const text = cleanString(label);
  const targetUuid = cleanString(uuid);
  const key = normalizeMatchText(text);
  if (!text || !targetUuid || !key || seen.has(key)) {
    return;
  }

  seen.add(key);
  candidates.push({
    label: text,
    normalizedLabel: key,
    uuid: targetUuid
  });
}

function collectDescriptionLinkCandidates(feature, context = {}) {
  const featureUuidById = context.featureUuidById instanceof Map ? context.featureUuidById : new Map();
  const candidates = [];
  const seen = new Set();

  if (feature.sourceType === "fightingStyle" && Array.isArray(feature.maneuverFeatureIds)) {
    for (const [index, featureId] of feature.maneuverFeatureIds.entries()) {
      addDescriptionLinkCandidate(
        candidates,
        seen,
        feature.maneuvers?.[index] ?? "",
        featureUuidById.get(featureId)
      );
    }
  }

  const definitions = Array.isArray(context.featureDefinitions) ? context.featureDefinitions : [];
  const normalizedNameCounts = new Map();
  for (const definition of definitions) {
    if (definition?.classIdentifier !== feature.classIdentifier) {
      continue;
    }

    const key = normalizeMatchText(definition.name);
    if (key) {
      normalizedNameCounts.set(key, (normalizedNameCounts.get(key) ?? 0) + 1);
    }
  }

  for (const definition of definitions) {
    if (definition?.classIdentifier !== feature.classIdentifier || definition.featureId === feature.featureId) {
      continue;
    }

    const key = normalizeMatchText(definition.name);
    if (!key || normalizedNameCounts.get(key) !== 1) {
      continue;
    }

    addDescriptionLinkCandidate(candidates, seen, definition.name, featureUuidById.get(definition.featureId));
  }

  return candidates.sort((left, right) => right.label.length - left.label.length);
}

function linkDescriptionReferences(html, feature, context = {}) {
  let output = cleanString(html);
  if (!output) {
    return "";
  }

  for (const candidate of collectDescriptionLinkCandidates(feature, context)) {
    const pattern = buildLooseTextPattern(escapeHtml(candidate.label));
    if (!pattern) {
      continue;
    }

    const expression = new RegExp(`(^|[^\\p{L}\\p{N}_])(${pattern})(?=$|[^\\p{L}\\p{N}_])`, "giu");
    output = output.replace(expression, (match, prefix, label, offset, source) => {
      const previousText = source.slice(Math.max(0, offset - 16), offset);
      if (previousText.includes("@UUID[")) {
        return match;
      }

      return `${prefix}@UUID[${candidate.uuid}]{${label}}`;
    });
  }

  return output;
}

function createFeatureDescriptionValue(feature, context = {}) {
  return linkDescriptionReferences(toHtmlParagraphs(feature.description), feature, context);
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
    description: cleanString(rawFeature?.descriptionMarkdown ?? rawFeature?.description),
    levels,
    requiredLevel,
    optional: optional === true,
    automation: rawFeature?.automation && typeof rawFeature.automation === "object"
      ? foundry.utils.deepClone(rawFeature.automation)
      : undefined
  };
}

function normalizeMetamagicOption(rawOption, index, options = {}) {
  const entry = normalizeFeatureEntry(rawOption, index, {
    fallbackName: "Метамагия",
    fallbackLevel: 3,
    ...options
  });
  const requiredLevel = Math.max(
    1,
    Math.floor(parseNumber(rawOption?.requiredLevel ?? rawOption?.levels?.[0] ?? entry.requiredLevel, 3))
  );
  const rawCost = rawOption?.cost;
  const cost = cleanString(rawCost).toLowerCase() === "spelllevel"
    ? "spellLevel"
    : Math.max(0, Math.floor(parseNumber(rawCost, 1)));
  const rawCostMode = cleanString(rawOption?.costMode).toLowerCase();
  const costMode = rawCostMode === "variable"
    ? "variable"
    : cost === "spellLevel"
      ? "spellLevel"
      : "fixed";
  const minCost = costMode === "fixed"
    ? Math.max(0, Math.floor(parseNumber(rawOption?.minCost, cost)))
    : Math.max(1, Math.floor(parseNumber(rawOption?.minCost, 1)));
  const maxCost = cost === "spellLevel"
    ? undefined
    : Math.max(minCost, Math.floor(parseNumber(rawOption?.maxCost, cost)));
  return {
    ...entry,
    levels: [requiredLevel],
    requiredLevel,
    metamagicId: cleanString(rawOption?.metamagicId ?? rawOption?.id, entry.featureId),
    cost,
    costMode,
    minCost,
    maxCost,
    automation: cleanString(rawOption?.automation ?? rawOption?.automationId),
    stacking: cleanString(rawOption?.stacking).toLowerCase() === "additive" ? "additive" : "base"
  };
}

function normalizeCunningStrikeEntry(rawFeature, index, options = {}) {
  const entry = normalizeFeatureEntry(rawFeature, index, {
    fallbackName: "Хитрый удар",
    fallbackLevel: 2,
    ...options
  });
  return {
    ...entry,
    cunningStrikeCost: Math.max(0, Math.floor(parseNumber(rawFeature?.cost ?? rawFeature?.cunningStrikeCost, 0)))
  };
}

function extractRuneKnightRuneDescriptions(description) {
  const text = cleanString(description);
  const descriptions = new Map();
  if (!text) {
    return descriptions;
  }

  const runeNamePattern = RUNE_KNIGHT_RUNE_SPECS.map((spec) => escapeRegExp(spec.name)).join("|");
  const headingPattern = new RegExp(`(${runeNamePattern})\\s*(?:\\([^)]*\\))?\\s*\\.`, "giu");
  const headings = Array.from(text.matchAll(headingPattern));

  for (const [index, match] of headings.entries()) {
    const name = cleanString(match[1]);
    const start = match.index ?? 0;
    const end = headings[index + 1]?.index ?? text.length;
    const segment = cleanString(text.slice(start, end).replace(/\s+\./u, "."));
    if (name && segment) {
      descriptions.set(normalizeMatchText(name), segment);
    }
  }

  return descriptions;
}

function deriveRuneKnightRunes(subclasses = []) {
  const runeKnight = (Array.isArray(subclasses) ? subclasses : [])
    .find((subclass) => normalizeMatchText(subclass?.name) === RUNE_KNIGHT_SUBCLASS_NAME);
  const runeCarver = runeKnight?.features?.find((feature) => normalizeMatchText(feature?.name) === "резчик рун");
  if (!runeKnight || !runeCarver) {
    return [];
  }

  const descriptions = extractRuneKnightRuneDescriptions(runeCarver?.description);

  return RUNE_KNIGHT_RUNE_SPECS.map((spec) => ({
    id: buildAsciiIdentifier(`rune-knight-${spec.name}`, spec.name),
    name: spec.name,
    levels: [spec.requiredLevel],
    requiredLevel: spec.requiredLevel,
    description: descriptions.get(normalizeMatchText(spec.name)) ?? `${spec.name}\nРуна рунного рыцаря.`
  }));
}

function markdownTableCells(line) {
  const text = String(line ?? "").trim();
  if (!text.startsWith("|") || !text.endsWith("|")) {
    return [];
  }
  return text
    .split("|")
    .slice(1, -1)
    .map((cell) => cleanString(cell.replace(/\\([[\]])/gu, "$1")));
}

function isMarkdownSeparatorCell(value) {
  return /^:?-{2,}:?$/u.test(cleanString(value));
}

function extractDraconicAncestorRows(description) {
  const rows = [];
  let readingAncestorTable = false;

  for (const line of String(description ?? "").split(/\r?\n/u)) {
    const cells = markdownTableCells(line);
    if (cells.length < 3) {
      continue;
    }

    const firstCell = normalizeMatchText(cells[0]);
    if (firstCell === "дракон") {
      readingAncestorTable = true;
      continue;
    }
    if (!readingAncestorTable) {
      continue;
    }
    if (firstCell === "уровень чародея") {
      break;
    }
    if (cells.some(isMarkdownSeparatorCell)) {
      continue;
    }

    rows.push({
      dragon: cells[0],
      damageType: cells[1],
      savingThrow: cells[2]
    });
  }

  return rows;
}

function normalizeDraconicAncestorRow(row, index, { scopeId = "", usedIds = new Set() } = {}) {
  const dragon = cleanString(row?.dragon, `Дракон ${index + 1}`);
  const damageType = cleanString(row?.damageType);
  const savingThrow = cleanString(row?.savingThrow);
  const name = `${dragon} дракон`;
  const featureId = uniqueIdentifier(
    buildAsciiIdentifier(`${scopeId}-${buildSlug(name, `ancestor-${index + 1}`)}`, `${scopeId}::${index + 1}`),
    usedIds,
    `${scopeId}::${index + 1}`
  );

  return {
    featureId,
    name,
    description: [
      `Драконий предок: ${dragon}`,
      damageType ? `Вид урона: ${damageType}` : "",
      savingThrow ? `Спасбросок: ${savingThrow}` : ""
    ].filter(Boolean).join("\n"),
    levels: [1],
    requiredLevel: 1,
    optional: false,
    damageType,
    savingThrow
  };
}

function deriveDraconicAncestors(subclasses = []) {
  const draconicSorcerer = (Array.isArray(subclasses) ? subclasses : [])
    .find((subclass) => normalizeMatchText(subclass?.name) === DRACONIC_SORCERER_SUBCLASS_NAME);
  const ancestorFeature = draconicSorcerer?.features?.find((feature) => (
    normalizeMatchText(feature?.name) === DRACONIC_ANCESTOR_FEATURE_NAME
  ));
  if (!draconicSorcerer || !ancestorFeature) {
    return [];
  }

  const usedIds = new Set();
  return extractDraconicAncestorRows(ancestorFeature.description)
    .map((row, index) => normalizeDraconicAncestorRow(row, index, {
      scopeId: `${draconicSorcerer.subclassId}-draconic-ancestor`,
      usedIds
    }));
}

function parseExpandedMetamagicCost(description) {
  const costMatch = /(?:потратить|потратив|расходуете|расходуя)\s+(?:вплоть до\s+|до\s+)?(\d+)/iu.exec(description);
  if (costMatch) {
    return Math.max(1, Math.floor(parseNumber(costMatch[1], 1)));
  }

  if (/уровн[ьяюе]* заклинани/iu.test(description)) {
    return "spellLevel";
  }

  return 1;
}

function parseExpandedMetamagicStacking(description) {
  return /даже если вы уже использовали другой вариант метамагии/iu.test(description)
    ? "additive"
    : "base";
}

const EXPANDED_METAMAGIC_SPECS = Object.freeze(new Map([
  [normalizeMatchText("Заклинание предка"), { id: "draconic-ancestral-spell", cost: 1 }],
  [normalizeMatchText("Драконья защита"), { id: "draconic-dragon-protection", cost: 1 }],
  [normalizeMatchText("Драконье заклятье"), { id: "draconic-dragon-spell", cost: 3, costMode: "variable", minCost: 1, maxCost: 3 }],
  [normalizeMatchText("Крыло дракона"), { id: "draconic-dragon-wing", cost: 3, costMode: "variable", minCost: 1, maxCost: 3 }],
  [normalizeMatchText("Хаотическое заклинание"), { id: "wild-chaotic-spell", cost: 3, costMode: "variable", minCost: 1, maxCost: 3 }],
  [normalizeMatchText("Стремительное заклинание"), { id: "wild-swift-spell", cost: 1 }],
  [normalizeMatchText("Нелетальное заклинание"), { id: "divine-nonlethal-spell", cost: 1 }],
  [normalizeMatchText("Божественное лечение"), { id: "divine-healing-spell", cost: 1 }],
  [normalizeMatchText("Божественное правосудие"), { id: "divine-justice-spell", cost: 2 }],
  [normalizeMatchText("Божественное сияние"), { id: "divine-radiance-spell", cost: 3 }],
  [normalizeMatchText("Теневое заклинание"), { id: "shadow-shadow-spell", cost: 2 }],
  [normalizeMatchText("Стремительность тени"), { id: "shadow-swiftness-spell", cost: 1 }],
  [normalizeMatchText("Вихрь шторма"), { id: "storm-vortex-spell", cost: 3 }],
  [normalizeMatchText("Гибкая магия"), { id: "chemtech-flexible-magic", cost: 2 }],
  [normalizeMatchText("Заражение"), { id: "chemtech-infection-spell", cost: 3, costMode: "variable", minCost: 1, maxCost: 3 }]
]));

const ADVANCED_METAMAGIC_SPECS = Object.freeze(new Map([
  [normalizeMatchText("Мана-шторм"), { id: "advanced-mana-storm", cost: 2 }],
  [normalizeMatchText("Раскол заклинания"), { id: "advanced-spell-shatter", cost: 5 }]
]));

function isVariableExpandedMetamagicCost(description) {
  return /(?:вплоть до|до)\s+\d+/iu.test(description);
}

function extractExpandedMetamagicOptions(subclass, usedIds = new Set()) {
  const expandedFeature = (subclass?.features ?? []).find((feature) => (
    normalizeMatchText(feature?.name) === SORCERER_EXPANDED_METAMAGIC_FEATURE_NAME
  ));
  if (!expandedFeature?.description) {
    return [];
  }

  const matches = Array.from(expandedFeature.description.matchAll(/\*\*([^*]+)\*\*\.\s*/gu));
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? expandedFeature.description.length;
    const description = cleanString(
      expandedFeature.description
        .slice(start, end)
        .replace(/\\([[\]])/gu, "$1")
    );
    const name = cleanString(match[1], `Метамагия ${index + 1}`);
    const spec = EXPANDED_METAMAGIC_SPECS.get(normalizeMatchText(name)) ?? {};
    const parsedCost = spec.cost ?? parseExpandedMetamagicCost(description);
    const variableCost = spec.costMode === "variable" || isVariableExpandedMetamagicCost(description);

    return normalizeMetamagicOption({
      id: spec.id,
      metamagicId: spec.id,
      name,
      description,
      levels: [3],
      requiredLevel: 3,
      cost: parsedCost,
      costMode: variableCost ? "variable" : undefined,
      minCost: spec.minCost ?? 1,
      maxCost: spec.maxCost ?? (variableCost && typeof parsedCost === "number" ? parsedCost : undefined),
      automation: spec.id,
      stacking: parseExpandedMetamagicStacking(description)
    }, index, {
      scopeId: `${subclass.subclassId}-metamagic`,
      usedIds
    });
  }).filter((option) => option.name);
}

function extractAdvancedMetamagicOptions(classFeatures = [], classIdentifier = "sorcerer-rework-v011", usedIds = new Set()) {
  const advancedFeature = (Array.isArray(classFeatures) ? classFeatures : []).find((feature) => (
    normalizeMatchText(feature?.name) === "продвинутая метамагия"
  ));
  if (!advancedFeature?.description) {
    return [];
  }

  const matches = Array.from(advancedFeature.description.matchAll(/\*\*([^*]+)\*\*\.\s*/gu));
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? advancedFeature.description.length;
    const description = cleanString(
      advancedFeature.description
        .slice(start, end)
        .replace(/\\([[\]])/gu, "$1")
    );
    const name = cleanString(match[1], `Продвинутая метамагия ${index + 1}`).replace(/[⚡]/gu, "").trim();
    const spec = ADVANCED_METAMAGIC_SPECS.get(normalizeMatchText(name)) ?? {};
    const parsedCost = spec.cost ?? parseExpandedMetamagicCost(description);

    return normalizeMetamagicOption({
      id: spec.id,
      metamagicId: spec.id,
      name,
      description,
      levels: [10],
      requiredLevel: 10,
      cost: parsedCost,
      automation: spec.id,
      stacking: parseExpandedMetamagicStacking(description)
    }, index, {
      scopeId: `${classIdentifier}-advanced-metamagic`,
      usedIds
    });
  }).filter((option) => option.name);
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

function normalizeScaleAdvancements(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const usedIds = new Set();
  return entries
    .map((entry, index) => {
      const title = cleanString(entry?.title, "Масштабируемое значение");
      const identifier = uniqueIdentifier(
        buildAsciiIdentifier(cleanString(entry?.id ?? entry?.identifier, title), `${title}-${index + 1}`),
        usedIds,
        `${title}-${index + 1}`
      );
      const type = cleanString(entry?.type) === "dice" ? "dice" : "number";
      return {
        id: identifier,
        title,
        hint: cleanString(entry?.hint),
        identifier,
        type,
        level: Math.max(1, Math.floor(parseNumber(entry?.level, 1))),
        progression: type === "dice"
          ? normalizeDiceProgressionMap(entry?.progression)
          : normalizeProgressionMap(entry?.progression)
      };
    })
    .filter((entry) => Object.keys(entry.progression).length);
}

function normalizeDiceProgressionMap(value) {
  const progression = {};
  for (const [level, entry] of Object.entries(isPlainObject(value) ? value : {})) {
    const parsedLevel = Math.max(1, Math.floor(parseNumber(level, 0)));
    const match = cleanString(entry).match(/^(\d*)d(\d+)$/iu);
    const number = match?.[1] ? Math.floor(parseNumber(match[1], 0)) : 0;
    const faces = match ? Math.floor(parseNumber(match[2], 0)) : 0;
    if (parsedLevel >= 1 && parsedLevel <= 20 && number > 0 && faces > 0) {
      progression[String(parsedLevel)] = `${number}d${faces}`;
    }
  }

  return progression;
}

function normalizeStartingEquipment(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const usedIds = new Set();
  const idBySymbol = new Map();
  const rows = [];

  for (const [index, entry] of entries.entries()) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const type = cleanString(entry.type);
    if (!STARTING_EQUIPMENT_TYPES.has(type)) {
      continue;
    }

    const key = cleanString(entry.key);
    if (STARTING_EQUIPMENT_KEYED_TYPES.has(type) && !key) {
      continue;
    }

    const symbolId = cleanString(entry._id, `${type}-${index + 1}`);
    const documentId = /^[A-Za-z0-9]{16}$/u.test(symbolId) && !usedIds.has(symbolId)
      ? symbolId
      : stableDocumentId(symbolId, usedIds, "starting-equipment");

    usedIds.add(documentId);
    idBySymbol.set(symbolId, documentId);
    rows.push({ entry, index, key, type });
  }

  return rows.map(({ entry, index, key, type }) => {
    const symbolId = cleanString(entry._id, `${type}-${index + 1}`);
    const group = cleanString(entry.group);
    const count = Math.floor(parseNumber(entry.count, 0));
    return {
      _id: idBySymbol.get(symbolId),
      group: group ? idBySymbol.get(group) ?? group : null,
      sort: Math.floor(parseNumber(entry.sort, (index + 1) * 100000)),
      type,
      ...(count > 0 ? { count } : {}),
      ...(key ? { key } : {}),
      ...(Object.hasOwn(entry, "requiresProficiency") ? { requiresProficiency: entry.requiresProficiency === true } : {})
    };
  });
}

function normalizeTraitChoices(entries, prefix) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => ({
      count: Math.max(1, Math.floor(parseNumber(entry?.count, 1))),
      pool: unique((Array.isArray(entry?.pool) ? entry.pool : [])
        .map((value) => proficiencyGrant(prefix, value))
        .filter(Boolean))
    }))
    .filter((entry) => entry.pool.length);
}

function normalizeExpertiseChoices(entries, fallbackPool = SKILL_POOL) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const usedIds = new Set();
  return entries
    .map((entry, index) => {
      const title = cleanString(entry?.title ?? entry?.name, "Компетентность");
      const id = uniqueIdentifier(
        buildAsciiIdentifier(cleanString(entry?.id ?? entry?.identifier, title), `${title}-${index + 1}`),
        usedIds,
        `${title}-${index + 1}`
      );
      const rawPool = Array.isArray(entry?.pool) && entry.pool.length ? entry.pool : fallbackPool;
      return {
        id,
        title,
        hint: cleanString(entry?.hint),
        level: Math.max(1, Math.floor(parseNumber(entry?.level, 1))),
        count: Math.max(1, Math.floor(parseNumber(entry?.count, 2))),
        mode: cleanString(entry?.mode, "expertise"),
        pool: unique(rawPool.map((value) => proficiencyGrant("skills", value)).filter(Boolean))
      };
    })
    .filter((entry) => entry.pool.length);
}

function normalizeSpellcastingData(value) {
  const data = isPlainObject(value) ? value : {};
  const progression = cleanString(data.progression, "none");
  const ability = cleanString(data.ability);
  const preparation = isPlainObject(data.preparation)
    ? Object.fromEntries(
      Object.entries(data.preparation)
        .map(([key, entry]) => [key, cleanString(entry)])
        .filter(([, entry]) => entry)
    )
    : {};

  return {
    progression,
    ability,
    ...(Object.keys(preparation).length ? { preparation } : {})
  };
}

function normalizeItemChoiceChoices(choices, level = 1, count = 1) {
  const fallbackLevel = Math.max(0, Math.floor(parseNumber(level, 1)));
  const fallbackCount = Math.max(1, Math.floor(parseNumber(count, 1)));
  if (!isPlainObject(choices)) {
    return {
      [String(fallbackLevel)]: {
        count: fallbackCount,
        replacement: false
      }
    };
  }

  const normalized = {};
  for (const [rawLevel, rawChoice] of Object.entries(choices)) {
    const choiceLevel = Math.max(0, Math.floor(parseNumber(rawLevel, fallbackLevel)));
    const choiceData = isPlainObject(rawChoice) ? rawChoice : { count: rawChoice };
    const rawCount = Object.hasOwn(choiceData, "count") ? choiceData.count : fallbackCount;
    normalized[String(choiceLevel)] = {
      count: rawCount === null ? null : Math.max(0, Math.floor(parseNumber(rawCount, fallbackCount))),
      replacement: choiceData.replacement === true
    };
  }

  return Object.keys(normalized).length
    ? normalized
    : normalizeItemChoiceChoices(null, fallbackLevel, fallbackCount);
}

function normalizeSpellChoiceData(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const restrictionData = isPlainObject(value.restriction) ? value.restriction : {};
  const restrictionList = unique(Array.isArray(restrictionData.list)
    ? restrictionData.list.map((entry) => cleanString(entry))
    : cleanString(restrictionData.list)
      ? [cleanString(restrictionData.list)]
      : []);
  const spellData = isPlainObject(value.spell) ? value.spell : {};
  const usesData = isPlainObject(spellData.uses) ? spellData.uses : {};
  const ability = unique(Array.isArray(spellData.ability)
    ? spellData.ability.map((entry) => cleanString(entry))
    : [cleanString(spellData.ability)].filter(Boolean));

  return {
    id: cleanString(value.id, "spells"),
    title: cleanString(value.title, "Заклинания"),
    hint: cleanString(value.hint, "Выберите заклинания класса."),
    level: Math.max(0, Math.floor(parseNumber(value.level, 1))),
    choices: normalizeItemChoiceChoices(value.choices, value.level, 1),
    additionalSpellIds: unique(Array.isArray(value.additionalSpellIds)
      ? value.additionalSpellIds.map((entry) => cleanString(entry))
      : [cleanString(value.additionalSpellIds)].filter(Boolean)),
    restriction: {
      level: cleanString(restrictionData.level, "available"),
      list: restrictionList,
      subtype: cleanString(restrictionData.subtype),
      type: cleanString(restrictionData.type)
    },
    spell: {
      ability,
      method: cleanString(spellData.method, "spell"),
      prepared: Math.max(0, Math.floor(parseNumber(spellData.prepared, 0))),
      uses: {
        max: cleanString(usesData.max),
        per: cleanString(usesData.per),
        requireSlot: usesData.requireSlot !== false
      }
    }
  };
}

function normalizeCraftsmanArchetypeAxis(rawEntries, {
  axis,
  classIdentifier,
  sourceRevision = ""
} = {}) {
  const fallbackLevel = axis === "research" ? 2 : 3;
  const fallbackName = axis === "research" ? "Исследование" : "Специальность";
  const usedArchetypeIds = new Set();

  return (Array.isArray(rawEntries) ? rawEntries : []).map((rawArchetype, archetypeIndex) => {
    const name = cleanString(rawArchetype?.name, `${fallbackName} ${archetypeIndex + 1}`);
    const baseId = cleanString(
      rawArchetype?.archetypeId ?? rawArchetype?.id ?? rawArchetype?.identifier,
      buildAsciiIdentifier(
        `${classIdentifier}-${axis}-${buildSlug(name, `${axis}-${archetypeIndex + 1}`)}`,
        `${classIdentifier}::${axis}::${archetypeIndex + 1}`
      )
    );
    const archetypeId = uniqueIdentifier(
      baseId,
      usedArchetypeIds,
      `${classIdentifier}::${axis}::${archetypeIndex + 1}`
    );
    const usedFeatureIds = new Set();
    const features = (Array.isArray(rawArchetype?.features) ? rawArchetype.features : [])
      .map((feature, featureIndex) => normalizeFeatureEntry(feature, featureIndex, {
        scopeId: `${classIdentifier}-${axis}-${archetypeId}-feature`,
        fallbackName: `Умение: ${fallbackName.toLowerCase()}`,
        fallbackLevel,
        usedIds: usedFeatureIds
      }))
      .filter((feature) => feature.name);

    return {
      archetypeId,
      axis,
      type: "subclass",
      name,
      description: cleanString(rawArchetype?.descriptionMarkdown ?? rawArchetype?.description),
      descriptionMarkdown: cleanString(rawArchetype?.descriptionMarkdown ?? rawArchetype?.description),
      classIdentifier,
      documentId: cleanString(
        rawArchetype?.documentId,
        stableHashId(`${classIdentifier}:${axis}:${archetypeId}`, "craftsman-archetype-document")
      ),
      sourceRevision: cleanString(rawArchetype?.sourceRevision, sourceRevision),
      spellcasting: normalizeSpellcastingData(rawArchetype?.spellcasting),
      features
    };
  });
}

export function normalizeClassCompendiumData(rawData) {
  const data = isPlainObject(rawData) ? rawData : {};
  const sourceLabel = cleanString(data.source, DEFAULT_SOURCE_LABEL);
  const sourceRevision = cleanString(data.sourceRevision);

  const rawClass = isPlainObject(data.class) ? data.class : {};
  const className = cleanString(rawClass.name, "Варвар (реворк V0.12)");
  const classIdentifier = buildAsciiIdentifier(
    cleanString(rawClass.identifier, buildSlug(className, "barbarian-rework-v012")),
    className
  );
  const classFeatureRootFolder = cleanString(
    data.classFeatureRootFolder,
    classIdentifier === "fighter-rework-v028"
      ? FIGHTER_CLASS_FEATURE_ROOT_FOLDER
      : classIdentifier === "paladin-rework-v01"
        ? PALADIN_CLASS_FEATURE_ROOT_FOLDER
        : CLASS_FEATURE_ROOT_FOLDER
  );
  const hitDie = cleanString(rawClass.hitDie, classIdentifier === "fighter-rework-v028" ? FIGHTER_HD : DEFAULT_HD);
  const primaryAbility = unique(Array.isArray(rawClass.primaryAbility) ? rawClass.primaryAbility : ["str"]);
  const skillPool = unique(Array.isArray(rawClass.skillPool)
    ? rawClass.skillPool
    : classIdentifier === "fighter-rework-v028" ? FIGHTER_SKILL_POOL : SKILL_POOL);
  const skillChoiceCount = Math.max(1, Math.floor(parseNumber(rawClass.skillChoiceCount, 2)));
  const saveProficiencies = unique(Array.isArray(rawClass.saveProficiencies) ? rawClass.saveProficiencies : ["str", "con"]);
  const armorProficiencies = unique(Array.isArray(rawClass.armorProficiencies)
    ? rawClass.armorProficiencies
    : classIdentifier === "fighter-rework-v028" ? FIGHTER_ARMOR_PROFICIENCIES : []);
  const toolProficiencies = unique(Array.isArray(rawClass.toolProficiencies) ? rawClass.toolProficiencies : []);
  const toolProficiencyChoices = normalizeTraitChoices(rawClass.toolProficiencyChoices, "tool");
  const weaponProficiencies = unique(Array.isArray(rawClass.weaponProficiencies)
    ? rawClass.weaponProficiencies
    : classIdentifier === "fighter-rework-v028" ? FIGHTER_WEAPON_PROFICIENCIES : []);
  const weaponProficiencyChoices = normalizeTraitChoices(rawClass.weaponProficiencyChoices, "weapon");
  const expertiseChoices = normalizeExpertiseChoices(rawClass.expertiseChoices, skillPool);
  const wealth = cleanString(rawClass.wealth, classIdentifier === "fighter-rework-v028" ? "5d4*10" : "2d4*10");
  const startingEquipment = normalizeStartingEquipment(rawClass.startingEquipment);
  const spellcasting = normalizeSpellcastingData(rawClass.spellcasting);
  const spellChoices = (Array.isArray(rawClass.spellChoices) ? rawClass.spellChoices : [])
    .map((entry) => normalizeSpellChoiceData(entry))
    .filter(Boolean);
  if (!spellChoices.length) {
    const legacySpellChoice = normalizeSpellChoiceData(rawClass.spellChoice);
    if (legacySpellChoice) {
      spellChoices.push(legacySpellChoice);
    }
  }
  const subclassTitle = cleanString(rawClass.subclassTitle, classIdentifier === "fighter-rework-v028" ? "Воинский архетип" : "Путь дикости");
  const subclassHint = cleanString(rawClass.subclassHint, classIdentifier === "fighter-rework-v028" ? "Выберите архетип воина." : "Выберите архетип варвара.");
  const subclassLevel = Math.max(1, Math.min(20, Math.floor(parseNumber(rawClass.subclassLevel, 3))));
  const archetypeTracks = cleanString(rawClass.archetypeTracks);
  const researchLevel = Math.max(1, Math.min(20, Math.floor(parseNumber(rawClass.researchLevel, 2))));
  const specialtyLevel = Math.max(1, Math.min(20, Math.floor(parseNumber(rawClass.specialtyLevel, 3))));

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

  const usedMetamagicIds = new Set();
  const metamagicOptions = (Array.isArray(data.metamagicOptions) ? data.metamagicOptions : [])
    .map((option, index) => normalizeMetamagicOption(option, index, {
      scopeId: `${classIdentifier}-metamagic`,
      usedIds: usedMetamagicIds
    }))
    .filter((option) => option.name);
  metamagicOptions.push(...extractAdvancedMetamagicOptions(classFeatures, classIdentifier, usedMetamagicIds));

  const usedCunningStrikeIds = new Set();
  const rawCunningStrikes = Array.isArray(rawClass.cunningStrikes)
    ? rawClass.cunningStrikes
    : Array.isArray(data.cunningStrikes)
      ? data.cunningStrikes
      : [];
  const cunningStrikes = rawCunningStrikes
    .map((strike, index) => normalizeCunningStrikeEntry(strike, index, {
      scopeId: `${classIdentifier}-cunning-strike`,
      usedIds: usedCunningStrikeIds,
      forceRequiredLevel: strike?.requiredLevel ?? strike?.levels?.[0] ?? 2
    }))
    .map((strike) => ({
      ...strike,
      levels: [Math.max(1, strike.requiredLevel || 2)]
    }))
    .filter((strike) => strike.name);

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
    const subclassSpellcasting = normalizeSpellcastingData(rawSubclass?.spellcasting);
    const usedFeatureIds = new Set();
    const features = (Array.isArray(rawSubclass?.features) ? rawSubclass.features : [])
      .map((feature, featureIndex) => normalizeFeatureEntry(feature, featureIndex, {
        scopeId: `${subclassId}-feature`,
        fallbackName: "Умение пути",
        fallbackLevel: 3,
        usedIds: usedFeatureIds
      }))
      .filter((feature) => feature.name);
    const subclassMetamagicOptions = extractExpandedMetamagicOptions({
      subclassId,
      name: subclassName,
      features
    });
    const usedSubclassCunningStrikeIds = new Set();
    const subclassCunningStrikes = (Array.isArray(rawSubclass?.cunningStrikes) ? rawSubclass.cunningStrikes : [])
      .map((strike, strikeIndex) => normalizeCunningStrikeEntry(strike, strikeIndex, {
        scopeId: `${subclassId}-cunning-strike`,
        fallbackLevel: 3,
        usedIds: usedSubclassCunningStrikeIds,
        forceRequiredLevel: strike?.requiredLevel ?? strike?.levels?.[0] ?? 3
      }))
      .map((strike) => ({
        ...strike,
        levels: [Math.max(1, strike.requiredLevel || 3)]
      }))
      .filter((strike) => strike.name);

    subclasses.push({
      subclassId,
      name: subclassName,
      description: subclassDescription,
      spellcasting: subclassSpellcasting,
      features,
      metamagicOptions: subclassMetamagicOptions,
      cunningStrikes: subclassCunningStrikes
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
      const styleLevel = Math.max(1, Math.floor(parseNumber(style?.requiredLevel ?? style?.levels?.[0], 1)));
      const entry = normalizeFeatureEntry(style, index, {
        scopeId: `${classIdentifier}-fighting-style`,
        fallbackName: "Боевой стиль",
        fallbackLevel: 1,
        usedIds: usedFightingStyleIds,
        forceRequiredLevel: styleLevel
      });
      return {
        ...entry,
        levels: [styleLevel],
        maneuvers: unique(Array.isArray(style?.maneuvers) ? style.maneuvers.map((maneuver) => cleanString(maneuver)) : []),
        chooseFighterStyle: style?.chooseFighterStyle === true,
        fightingStyleSourceClassIdentifier: cleanString(style?.fightingStyleSourceClassIdentifier, "fighter-rework-v028")
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

  const usedRuneIds = new Set();
  const runes = (Array.isArray(data.runes) ? data.runes : deriveRuneKnightRunes(subclasses))
    .map((rune, index) => normalizeFeatureEntry(rune, index, {
      scopeId: `${classIdentifier}-rune-knight-rune`,
      fallbackName: "Руна рунного рыцаря",
      fallbackLevel: 3,
      usedIds: usedRuneIds,
      forceRequiredLevel: rune?.requiredLevel ?? rune?.levels?.[0] ?? 3
    }))
    .map((rune) => ({
      ...rune,
      levels: [Math.max(1, rune.requiredLevel || 3)]
    }))
    .filter((rune) => rune.name);

  const draconicAncestors = deriveDraconicAncestors(subclasses);
  const rawDominanceProgression = isPlainObject(data.dominanceProgression) ? data.dominanceProgression : {};
  const researches = normalizeCraftsmanArchetypeAxis(data.researches, {
    axis: "research",
    classIdentifier,
    sourceRevision
  });
  const specialties = normalizeCraftsmanArchetypeAxis(data.specialties, {
    axis: "specialty",
    classIdentifier,
    sourceRevision
  });
  const craftsmanGadgets = Array.isArray(data.automation?.gadgets)
    ? normalizeCraftsmanGadgets(data)
    : [];

  return {
    sourceLabel,
    sourceRevision,
    classFeatureRootFolder,
    classData: {
      name: className,
      description: cleanString(rawClass.descriptionMarkdown ?? rawClass.description),
      identifier: classIdentifier,
      hitDie,
      primaryAbility,
      skillPool,
      skillChoiceCount,
      saveProficiencies,
      armorProficiencies,
      toolProficiencies,
      toolProficiencyChoices,
      weaponProficiencies,
      weaponProficiencyChoices,
      expertiseChoices,
      wealth,
      startingEquipment,
      spellcasting,
      spellChoices,
      scaleAdvancements: normalizeScaleAdvancements(rawClass.scaleAdvancements),
      archetypeTracks,
      researchTitle: cleanString(rawClass.researchTitle, "Направление исследований"),
      researchHint: cleanString(rawClass.researchHint, "Выберите направление исследования ремесленника."),
      researchLevel,
      specialtyTitle: cleanString(rawClass.specialtyTitle, "Специальность ремесленника"),
      specialtyHint: cleanString(rawClass.specialtyHint, "Выберите специальность ремесленника."),
      specialtyLevel,
      researches,
      specialties,
      craftsmanGadgets,
      subclassTitle,
      subclassHint,
      subclassLevel,
      cunningStrikes,
      metamagicOptions,
      features: classFeatures
    },
    researches,
    specialties,
    craftsmanGadgets,
    subclasses,
    rageActions,
    rageProgression: normalizeProgressionMap(data.rageProgression),
    rageDamageProgression: normalizeProgressionMap(data.rageDamageProgression),
    fightingStyles,
    maneuvers,
    runes,
    draconicAncestors,
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
  const runeKnightSubclass = (normalizedData.subclasses ?? [])
    .find((subclass) => normalizeMatchText(subclass.name) === RUNE_KNIGHT_SUBCLASS_NAME);
  const draconicSorcererSubclass = (normalizedData.subclasses ?? [])
    .find((subclass) => normalizeMatchText(subclass.name) === DRACONIC_SORCERER_SUBCLASS_NAME);

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
      sourceLabel,
      paladinAutomation: feature.automation && typeof feature.automation === "object"
        ? foundry.utils.deepClone(feature.automation)
        : null
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
      sourceLabel,
      paladinAutomation: feature.automation && typeof feature.automation === "object"
        ? foundry.utils.deepClone(feature.automation)
        : null
    });
  }

  for (const option of normalizedData.classData.metamagicOptions ?? []) {
    definitions.push({
      ...buildBaseFeatureDefinition(
        option,
        "sorcererMetamagic",
        normalizeFolderPath([classFeatureRootFolder, "Метамагия"]),
        `${classId}-metamagic-${option.featureId}`
      ),
      metamagicId: option.metamagicId,
      cost: option.cost,
      costMode: option.costMode,
      minCost: option.minCost,
      maxCost: option.maxCost,
      automation: option.automation,
      stacking: option.stacking
    });
  }

  const startingEquipmentConfig = getClassStartingEquipmentConfig(classId);
  if (startingEquipmentConfig) {
    for (const equipmentPackage of startingEquipmentConfig.packages) {
      const featureId = `${classId}::${startingEquipmentConfig.sourceType}::${equipmentPackage.featureId}`;
      definitions.push({
        featureId,
        documentId: featureDocumentId(featureId),
        sourceType: startingEquipmentConfig.sourceType,
        classIdentifier: classId,
        className,
        subclassId: null,
        subclassName: null,
        name: equipmentPackage.name,
        description: equipmentPackage.description,
        levels: [1],
        requiredLevel: 1,
        optional: true,
        identifier: buildAsciiIdentifier(`${classId}-${equipmentPackage.featureId}`, featureId),
        folderPath: normalizeFolderPath([classFeatureRootFolder, "Стартовое снаряжение"]),
        sourceLabel,
        startingEquipmentPackage: foundry.utils.deepClone(equipmentPackage)
      });
    }
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
      chooseFighterStyle: style.chooseFighterStyle === true,
      fightingStyleSourceClassIdentifier: style.fightingStyleSourceClassIdentifier,
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

  for (const strike of normalizedData.classData.cunningStrikes ?? []) {
    definitions.push({
      ...buildBaseFeatureDefinition(
        strike,
        "rogueCunningStrike",
        normalizeFolderPath([classFeatureRootFolder, ROGUE_CUNNING_STRIKE_SECTION_LABEL]),
        `${classId}-cunning-strike-${strike.featureId}`
      ),
      cunningStrikeCost: strike.cunningStrikeCost
    });
  }

  for (const rune of normalizedData.runes ?? []) {
    definitions.push({
      ...buildBaseFeatureDefinition(
        rune,
        "runeKnightRune",
        normalizeFolderPath([
          classFeatureRootFolder,
          "Архетипы",
          runeKnightSubclass?.name ?? "Рунный рыцарь",
          "Руны"
        ]),
        `${classId}-rune-knight-rune-${rune.featureId}`
      ),
      subclassId: runeKnightSubclass?.subclassId ?? null,
      subclassName: runeKnightSubclass?.name ?? "Рунный рыцарь"
    });
  }

  for (const ancestor of normalizedData.draconicAncestors ?? []) {
    const subclassId = draconicSorcererSubclass?.subclassId ?? classId;
    const subclassName = draconicSorcererSubclass?.name ?? "Наследие драконьей крови";
    const featureId = `${subclassId}::sorcererDraconicAncestor::${ancestor.featureId}`;
    definitions.push({
      featureId,
      documentId: featureDocumentId(featureId),
      sourceType: "sorcererDraconicAncestor",
      classIdentifier: classId,
      className,
      subclassId,
      subclassName,
      name: ancestor.name,
      description: ancestor.description,
      levels: ancestor.levels,
      requiredLevel: ancestor.requiredLevel,
      optional: false,
      identifier: buildAsciiIdentifier(`${subclassId}-draconic-ancestor-${ancestor.featureId}`, featureId),
      folderPath: normalizeFolderPath([
        classFeatureRootFolder,
        "Архетипы",
        subclassName,
        "Драконий предок"
      ]),
      sourceLabel,
      damageType: ancestor.damageType,
      savingThrow: ancestor.savingThrow
    });
  }

  for (const archetype of [
    ...(normalizedData.researches ?? []),
    ...(normalizedData.specialties ?? [])
  ]) {
    for (const feature of archetype.features ?? []) {
      const featureId = `${classId}::${archetype.axis}::${archetype.archetypeId}::${feature.featureId}`;
      definitions.push({
        featureId,
        documentId: featureDocumentId(featureId),
        sourceType: `${archetype.axis}Feature`,
        axis: archetype.axis,
        archetypeId: archetype.archetypeId,
        archetypeName: archetype.name,
        classIdentifier: classId,
        className,
        subclassId: null,
        subclassName: null,
        name: feature.name,
        description: feature.description,
        levels: feature.levels,
        requiredLevel: feature.requiredLevel,
        optional: false,
        identifier: buildAsciiIdentifier(
          `${archetype.archetypeId}-${feature.featureId}`,
          featureId
        ),
        folderPath: normalizeFolderPath([
          classFeatureRootFolder,
          "Архетипы",
          archetype.name
        ]),
        sourceLabel
      });
    }
  }

  for (const gadget of buildCraftsmanGadgetFeatureDefinitions(normalizedData.craftsmanGadgets ?? [])) {
    definitions.push({
      ...gadget,
      documentId: featureDocumentId(gadget.featureId),
      className,
      sourceLabel,
      folderPath: normalizeFolderPath([classFeatureRootFolder, "Гаджеты"])
    });
  }

  for (const subclass of normalizedData.subclasses) {
    for (const option of subclass.metamagicOptions ?? []) {
      const featureId = `${subclass.subclassId}::sorcererMetamagic::${option.featureId}`;
      definitions.push({
        featureId,
        documentId: featureDocumentId(featureId),
        sourceType: "sorcererMetamagic",
        classIdentifier: classId,
        className,
        subclassId: subclass.subclassId,
        subclassName: subclass.name,
        name: option.name,
        description: option.description,
        levels: option.levels,
        requiredLevel: option.requiredLevel,
        optional: false,
        identifier: buildAsciiIdentifier(`${subclass.subclassId}-metamagic-${option.featureId}`, featureId),
        folderPath: normalizeFolderPath([
          classFeatureRootFolder,
          "Архетипы",
          subclass.name,
          "Метамагия"
        ]),
        sourceLabel,
        metamagicId: option.metamagicId,
        cost: option.cost,
        costMode: option.costMode,
        minCost: option.minCost,
        maxCost: option.maxCost,
        automation: option.automation,
        stacking: option.stacking
      });
    }

    for (const strike of subclass.cunningStrikes ?? []) {
      const featureId = `${subclass.subclassId}::rogueCunningStrike::${strike.featureId}`;
      definitions.push({
        featureId,
        documentId: featureDocumentId(featureId),
        sourceType: "rogueCunningStrike",
        classIdentifier: classId,
        className,
        subclassId: subclass.subclassId,
        subclassName: subclass.name,
        name: strike.name,
        description: strike.description,
        levels: strike.levels,
        requiredLevel: strike.requiredLevel,
        optional: false,
        identifier: buildAsciiIdentifier(
          `${subclass.subclassId}-cunning-strike-${strike.featureId}`,
          `${subclass.subclassId}::cunning-strike::${strike.featureId}`
        ),
        folderPath: normalizeFolderPath([
          classFeatureRootFolder,
          "Архетипы",
          subclass.name,
          ROGUE_CUNNING_STRIKE_SECTION_LABEL
        ]),
        sourceLabel,
        cunningStrikeCost: strike.cunningStrikeCost
      });
    }

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
        sourceLabel,
        paladinAutomation: feature.automation && typeof feature.automation === "object"
          ? foundry.utils.deepClone(feature.automation)
          : null
      });
    }
  }

  if (classId === "paladin-rework-v01") {
    const oathDogmaLabels = {
      devotion: "Преданности",
      vengeance: "Мести",
      glory: "Подвига",
      oathbreaker: "Клятвопреступника",
      nirkadu: "Нир’Каду",
      arcana: "Арканы",
      magistrate: "Магистрата"
    };
    for (const oath of PALADIN_OATHS) {
      for (const dogma of oath.dogmas) {
        const featureId = `${classId}::paladinDogma::${dogma.id}`;
        definitions.push({
          featureId,
          documentId: featureDocumentId(featureId),
          sourceType: "paladinDogma",
          classIdentifier: classId,
          className,
          subclassId: null,
          subclassName: oath.name,
          name: `Догмат ${oathDogmaLabels[oath.id] ?? oath.name}: ${dogma.spell.nameRu}`,
          description: `${dogma.tenet}\n\n**Заклинание:** ${dogma.spell.nameRu} [${dogma.spell.nameEn}]`,
          levels: [dogma.level],
          requiredLevel: dogma.level,
          optional: true,
          identifier: dogma.id,
          folderPath: normalizeFolderPath([
            classFeatureRootFolder,
            "Архетипы",
            oath.name,
            "Догматы"
          ]),
          sourceLabel,
          paladinDogma: foundry.utils.deepClone(dogma)
        });
      }
    }
  }

  return definitions;
}

function buildFeatureSignature(feature, context = {}) {
  const runeKnightAutomation = getRuneKnightRuneAutomation(feature)
    ?? getRuneKnightFeatureAutomation(feature);
  return JSON.stringify({
    templateVersion: CLASS_FEATURE_TEMPLATE_VERSION,
    featureId: feature.featureId,
    documentId: feature.documentId,
    sourceType: feature.sourceType,
    axis: feature.axis ?? "",
    archetypeId: feature.archetypeId ?? "",
    archetypeName: feature.archetypeName ?? "",
    classIdentifier: feature.classIdentifier,
    subclassId: feature.subclassId,
    subclassName: feature.subclassName,
    name: feature.name,
    styleName: feature.styleName ?? "",
    chooseFighterStyle: feature.chooseFighterStyle === true,
    fightingStyleSourceClassIdentifier: feature.fightingStyleSourceClassIdentifier ?? "",
    description: feature.description,
    levels: feature.levels,
    requiredLevel: feature.requiredLevel,
    optional: feature.optional,
    identifier: feature.identifier,
    maneuvers: feature.maneuvers ?? [],
    maneuverFeatureIds: feature.maneuverFeatureIds ?? [],
    allManeuverFeatureIds: feature.allManeuverFeatureIds ?? [],
    cunningStrikeCost: feature.cunningStrikeCost ?? 0,
    metamagicId: feature.metamagicId ?? "",
    cost: feature.cost ?? 0,
    stacking: feature.stacking ?? "",
    damageType: feature.damageType ?? "",
    savingThrow: feature.savingThrow ?? "",
    craftsmanGadget: feature.craftsmanGadget ?? null,
    runeKnightAutomation: runeKnightAutomation ?? null,
    paladinAutomation: feature.paladinAutomation ?? null,
    paladinDogma: feature.paladinDogma ?? null,
    startingEquipmentPackage: feature.startingEquipmentPackage ?? null,
    descriptionHtml: createFeatureDescriptionValue(feature, context),
    advancement: buildFeatureItemAdvancements(feature, context),
    sourceLabel: feature.sourceLabel ?? DEFAULT_SOURCE_LABEL,
    sourceBook: cleanString(feature.sourceLabel, DEFAULT_SOURCE_LABEL)
  });
}

function buildSubtypeRequirementsLabel(feature) {
  const level = Math.max(1, Math.floor(parseNumber(feature.requiredLevel, feature.levels?.[0] ?? 1)));
  if (["researchFeature", "specialtyFeature"].includes(feature.sourceType) && feature.archetypeName) {
    return `${feature.archetypeName}, ${level}-й уровень`;
  }

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

  if (feature.sourceType === "rogueCunningStrike") {
    return level > 1 ? `Хитрый удар, ${level}-й уровень` : "Хитрый удар";
  }

  if (feature.sourceType === "runeKnightRune") {
    return `${cleanString(feature.subclassName, "Рунный рыцарь")}, ${level}-й уровень`;
  }

  if (feature.sourceType === "sorcererDraconicAncestor") {
    return `${cleanString(feature.subclassName, "Наследие драконьей крови")}, ${level}-й уровень`;
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

function createSourceData(sourceLabel = DEFAULT_SOURCE_LABEL) {
  const source = cleanString(sourceLabel, DEFAULT_SOURCE_LABEL);
  return {
    book: source,
    custom: source
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

function passiveFeatureEffect({
  id,
  name,
  description = "",
  changes = [],
  transfer = true,
  flags = {},
  img = DEFAULT_FEATURE_ICON
}) {
  return {
    _id: id,
    name,
    type: "base",
    img,
    system: {},
    changes,
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
    description: toHtmlParagraphs(description),
    origin: null,
    transfer,
    statuses: [],
    sort: 0,
    flags
  };
}

function createRuneKnightActivity(feature, classIdentifier, runeKnightAutomation) {
  const activityId = stableHashId(
    `${classIdentifier}:${feature.featureId}:rune-knight:${runeKnightAutomation.id}`,
    "activity"
  );
  const activationType = cleanString(runeKnightAutomation.activation, "special");
  const rangeValue = runeKnightAutomation.range !== null
    && runeKnightAutomation.range !== undefined
    && Number.isFinite(Number(runeKnightAutomation.range))
    ? Number(runeKnightAutomation.range)
    : null;
  const targetsCreature = rangeValue !== null || ["stone", "cloud", "fire", "runic-shield"].includes(runeKnightAutomation.id);
  const duration = runeKnightAutomation.duration ?? {};

  return {
    _id: activityId,
    type: "utility",
    name: feature.name,
    img: RAGE_ACTION_ACTIVITY_IMAGE.utility,
    sort: 0,
    activation: {
      type: activationType,
      value: activationValue(activationType),
      condition: cleanString(runeKnightAutomation.trigger),
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
      chatFlavor: cleanString(feature.description)
    },
    duration: {
      value: duration.value ?? "",
      units: cleanString(duration.units, "inst"),
      special: "",
      concentration: false,
      override: false
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        runeKnightAutomation: foundry.utils.deepClone(runeKnightAutomation)
      }
    },
    range: {
      value: rangeValue,
      units: rangeValue === null ? "self" : "ft",
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
        count: targetsCreature ? "1" : "",
        type: targetsCreature ? "creature" : "self",
        choice: targetsCreature,
        special: ""
      },
      prompt: targetsCreature,
      override: false
    },
    uses: {
      spent: 0,
      max: "",
      recovery: []
    }
  };
}

function createRuneKnightAutomation(feature, classIdentifier, runeKnightAutomation) {
  const activities = {};
  if (runeKnightAutomation.activation) {
    const activity = createRuneKnightActivity(feature, classIdentifier, runeKnightAutomation);
    activities[activity._id] = activity;
  }

  const effects = [];
  if (runeKnightAutomation.kind === "rune") {
    const effectId = stableHashId(
      `${classIdentifier}:${feature.featureId}:rune-knight-passive:${runeKnightAutomation.id}`,
      "effect"
    );
    effects.push(passiveFeatureEffect({
      id: effectId,
      name: `${feature.name}: постоянная сила`,
      description: feature.description,
      changes: [
        ...foundry.utils.deepClone(runeKnightAutomation.passive?.changes ?? []),
        {
          key: `flags.${MODULE_ID}.runeKnight.passive.${runeKnightAutomation.id}`,
          mode: EFFECT_MODE_OVERRIDE,
          value: "1",
          priority: 20
        }
      ],
      flags: {
        dae: {
          transfer: true,
          stackable: "noneName"
        },
        [MODULE_ID]: {
          managed: true,
          runeKnightAutomation: foundry.utils.deepClone(runeKnightAutomation)
        }
      }
    }));
  }

  return {
    activities,
    effects,
    usesMax: cleanString(runeKnightAutomation.usesMax),
    usesRecovery: foundry.utils.deepClone(runeKnightAutomation.recovery ?? [])
  };
}

function createSorcererMagicSenseAutomation(feature, classIdentifier) {
  const effectId = stableHashId(`${classIdentifier}:${feature.featureId}:magic-sense`, "effect");
  return {
    activities: {},
    effects: [passiveFeatureEffect({
      id: effectId,
      name: feature.name,
      description: feature.description,
      changes: [{
        key: "system.skills.arc.bonuses.check",
        mode: EFFECT_MODE_ADD,
        value: "+@abilities.cha.mod",
        priority: 20
      }],
      flags: {
        dae: {
          transfer: true,
          stackable: "noneName"
        },
        [MODULE_ID]: {
          managed: true,
          automation: "sorcerer-magic-sense"
        }
      }
    })],
    usesRecovery: []
  };
}

function createDraconicResilienceAutomation(feature, classIdentifier) {
  const hpEffectId = stableHashId(`${classIdentifier}:${feature.featureId}:draconic-resilience-hp`, "effect");
  const acEffectId = stableHashId(`${classIdentifier}:${feature.featureId}:draconic-resilience-ac`, "effect");
  return {
    activities: {},
    effects: [
      passiveFeatureEffect({
        id: hpEffectId,
        name: `${feature.name}: хиты`,
        description: feature.description,
        changes: [{
          key: "system.attributes.hp.bonuses.overall",
          mode: EFFECT_MODE_ADD,
          value: `+@classes.${classIdentifier}.levels`,
          priority: 20
        }],
        flags: {
          dae: {
            transfer: true,
            stackable: "noneName"
          },
          [MODULE_ID]: {
            managed: true,
            automation: "sorcerer-draconic-resilience-hp"
          }
        }
      }),
      passiveFeatureEffect({
        id: acEffectId,
        name: `${feature.name}: чешуя`,
        description: feature.description,
        changes: [{
          key: "system.attributes.ac.bonus",
          mode: EFFECT_MODE_ADD,
          value: "3",
          priority: 20
        }],
        flags: {
          dae: {
            disableCondition: "@attributes.ac.armor > 10",
            transfer: true,
            stackable: "noneName"
          },
          [MODULE_ID]: {
            managed: true,
            automation: "sorcerer-draconic-resilience-ac"
          }
        }
      })
    ],
    usesRecovery: []
  };
}

function createDraconicWingsAutomation(feature, classIdentifier) {
  const effectId = stableHashId(`${classIdentifier}:${feature.featureId}:draconic-wings`, "effect");
  const activityId = stableHashId(`${classIdentifier}:${feature.featureId}:draconic-wings-activity`, "activity");
  return {
    activities: {
      [activityId]: {
        _id: activityId,
        type: "utility",
        name: feature.name,
        img: RAGE_ACTION_ACTIVITY_IMAGE.utility,
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
          targets: []
        },
        description: {
          chatFlavor: cleanString(feature.description)
        },
        duration: {
          value: "",
          units: "inst",
          special: "",
          concentration: false,
          override: false
        },
        effects: [{ _id: effectId }],
        flags: {
          [MODULE_ID]: {
            managed: true,
            automation: "sorcerer-draconic-wings"
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
    effects: [passiveFeatureEffect({
      id: effectId,
      name: feature.name,
      description: feature.description,
      transfer: false,
      changes: [{
        key: "system.attributes.movement.fly",
        mode: EFFECT_MODE_UPGRADE,
        value: "@attributes.movement.walk",
        priority: 20
      }],
      flags: {
        dae: {
          stackable: "noneName"
        },
        [MODULE_ID]: {
          managed: true,
          automation: "sorcerer-draconic-wings-effect"
        }
      }
    })],
    usesRecovery: []
  };
}

function createDominanceManeuverAutomation(feature, classIdentifier) {
  const activityId = stableHashId(`${classIdentifier}:${feature.featureId}:dominance-maneuver`, "activity");
  const description = cleanString(feature.description, feature.name);
  const fighterAutomation = getFighterManeuverAutomation(feature.name, classIdentifier);
  const targetsCreature = Boolean(fighterAutomation.extraDamage || fighterAutomation.status);
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
            maneuver: normalizeMatchText(feature.name),
            fighterAutomation
          }
        },
        range: {
          value: null,
          units: targetsCreature ? "" : "self",
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
            type: targetsCreature ? "creature" : "self",
            choice: false,
            special: ""
          },
          prompt: targetsCreature,
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

function createSecondWindAutomation(feature, classIdentifier) {
  const activityId = stableHashId(`${classIdentifier}:${feature.featureId}:second-wind`, "activity");
  return {
    activities: {
      [activityId]: {
        _id: activityId,
        type: "utility",
        name: feature.name,
        img: RAGE_ACTION_ACTIVITY_IMAGE.heal,
        sort: 0,
        activation: {
          type: "bonus",
          value: 1,
          condition: "Также можно использовать вместо одной из атак.",
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
          chatFlavor: cleanString(feature.description)
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
            automation: "fighter-second-wind",
            fighterAutomation: getFighterSecondWindAutomation()
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
    usesMax: fighterSecondWindUsesMax(classIdentifier),
    usesRecovery: [{
      period: "lr",
      type: "recoverAll",
      formula: ""
    }]
  };
}

function itemUseConsumptionTarget(value = "1") {
  return {
    type: "itemUses",
    target: "",
    value,
    scaling: {
      mode: "",
      formula: ""
    }
  };
}

function longRestRecovery() {
  return [{
    period: "lr",
    type: "recoverAll",
    formula: ""
  }];
}

function createPaladinDivineSenseAutomation(feature) {
  const activityId = stableHashId(`${feature.classIdentifier}:${feature.featureId}:divine-sense`, "activity");
  return {
    activities: {
      [activityId]: {
        _id: activityId,
        type: "utility",
        name: feature.name,
        img: RAGE_ACTION_ACTIVITY_IMAGE.utility,
        sort: 0,
        activation: {
          type: "action",
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
          targets: [itemUseConsumptionTarget()]
        },
        description: {
          chatFlavor: cleanString(feature.description)
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
            automation: "paladin-divine-sense"
          }
        },
        range: {
          value: 60,
          units: "ft",
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
    usesMax: "@abilities.cha.mod + 1",
    usesRecovery: longRestRecovery()
  };
}

function createPaladinLayOnHandsAutomation(feature) {
  const activityId = stableHashId(`${feature.classIdentifier}:${feature.featureId}:lay-on-hands`, "activity");
  return {
    activities: {
      [activityId]: {
        _id: activityId,
        type: "utility",
        name: feature.name,
        img: RAGE_ACTION_ACTIVITY_IMAGE.heal,
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
          targets: []
        },
        description: {
          chatFlavor: cleanString(feature.description)
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
            automation: "paladin-lay-on-hands"
          }
        },
        range: {
          value: 5,
          units: "ft",
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
            count: "1",
            type: "creature",
            choice: false,
            special: ""
          },
          prompt: true,
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
    usesMax: "@details.level * 5",
    usesRecovery: longRestRecovery()
  };
}

function createPaladinSovereignJurisdictionAutomation(feature) {
  const activityId = stableHashId(`${feature.classIdentifier}:${feature.featureId}:magistrate-jurisdiction`, "activity");
  return {
    activities: {
      [activityId]: {
        _id: activityId,
        type: "utility",
        name: feature.name,
        img: RAGE_ACTION_ACTIVITY_IMAGE.utility,
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
          targets: []
        },
        description: {
          chatFlavor: cleanString(feature.description)
        },
        duration: {
          value: "1",
          units: "minute",
          special: "",
          concentration: false,
          override: false
        },
        effects: [],
        flags: {
          [MODULE_ID]: {
            managed: true,
            automation: "paladin-magistrate-jurisdiction"
          }
        },
        range: {
          value: 60,
          units: "ft",
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
            count: "1",
            type: "creature",
            choice: false,
            special: ""
          },
          prompt: true,
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

function createPaladinAuraOfProtectionAutomation(feature) {
  const effectId = stableHashId(`${feature.classIdentifier}:${feature.featureId}:aura-of-protection`, "effect");
  return {
    activities: {},
    effects: [{
      _id: effectId,
      name: feature.name,
      type: "base",
      img: DEFAULT_FEATURE_ICON,
      system: {},
      changes: [{
        key: "system.bonuses.abilities.save",
        mode: EFFECT_MODE_ADD,
        value: "+@abilities.cha.mod",
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
      description: toHtmlParagraphs(feature.description),
      origin: null,
      transfer: true,
      statuses: [],
      sort: 0,
      flags: {
        ActiveAuras: {
          aura: "Allies",
          radius: "10",
          isAura: true,
          inactive: false,
          hidden: false,
          ignoreSelf: false,
          height: false,
          alignment: "",
          type: "",
          save: "",
          savedc: null,
          hostile: false,
          onlyOnce: false,
          time: "None",
          displayTemp: true,
          nameOverride: "",
          customCheck: "",
          wallsBlock: "system"
        },
        dae: {
          stackable: "noneName",
          durationExpression: "",
          macroRepeat: "none",
          specialDuration: [],
          transfer: true,
          showIcon: true
        },
        [MODULE_ID]: {
          managed: true,
          automation: "paladin-aura-of-protection"
        }
      }
    }],
    usesRecovery: []
  };
}

function createIronWillAutomation(feature, classIdentifier) {
  const effectId = stableHashId(`${classIdentifier}:${feature.featureId}:iron-will`, "effect");
  return {
    activities: {},
    effects: [{
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
        rounds: null,
        turns: null,
        startRound: null,
        startTurn: null
      },
      description: "<p>Автоматизация: отслеживает лечение и начало хода для эффектов Железной воли.</p>",
      origin: null,
      transfer: true,
      statuses: [],
      sort: 0,
      flags: {
        dae: {
          specialDuration: ["combatEnd"]
        },
        [MODULE_ID]: {
          managed: true,
          automation: "fighter-iron-will",
          fighterAutomation: getFighterIronWillAutomation()
        }
      }
    }],
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
  if (feature.featureId === CRAFTSMAN_CONSTRUCT_FEATURE_ID) {
    return buildCraftsmanConstructSummonAutomation(feature);
  }
  if (feature.sourceType === "craftsmanGadget") {
    return buildCraftsmanGadgetAutomation(feature.craftsmanGadget);
  }

  if (feature.sourceType === "rageAction") {
    return createRageActionAutomation(feature, classIdentifier);
  }

  if (feature.sourceType === "fighterManeuver") {
    return createDominanceManeuverAutomation(feature, classIdentifier);
  }

  const runeKnightAutomation = getRuneKnightRuneAutomation(feature)
    ?? getRuneKnightFeatureAutomation(feature);
  if (runeKnightAutomation) {
    return createRuneKnightAutomation(feature, classIdentifier, runeKnightAutomation);
  }

  const normalizedName = normalizeMatchText(feature.name);
  if (classIdentifier === "sorcerer-rework-v011") {
    if (feature.sourceType === "classFeature" && normalizedName === "чувство магии") {
      return createSorcererMagicSenseAutomation(feature, classIdentifier);
    }

    if (feature.sourceType === "subclassFeature" && normalizedName === "драконья устойчивость") {
      return createDraconicResilienceAutomation(feature, classIdentifier);
    }

    if (feature.sourceType === "subclassFeature" && normalizedName === "крылья дракона") {
      return createDraconicWingsAutomation(feature, classIdentifier);
    }
  }

  if (classIdentifier === "paladin-rework-v01" && feature.paladinAutomation?.kind === "magistrateJurisdiction") {
    return createPaladinSovereignJurisdictionAutomation(feature);
  }

  if (feature.sourceType !== "classFeature") {
    return createEmptyFeatureAutomation();
  }

  if (classIdentifier === "sorcerer-rework-v011" && feature.featureId.endsWith("::sorcerer-sorcery-points")) {
    return {
      activities: {},
      effects: [],
      usesMax: `@scale.${classIdentifier}.sorcery-points`,
      usesRecovery: [{
        period: "lr",
        type: "recoverAll",
        formula: ""
      }]
    };
  }

  if (classIdentifier === "fighter-rework-v028" && normalizedName.startsWith("воинская мультиатака")) {
    return createFighterMultiattackAutomation(feature, classIdentifier);
  }

  if (classIdentifier === "fighter-rework-v028" && normalizedName === "второе дыхание") {
    return createSecondWindAutomation(feature, classIdentifier);
  }

  if (classIdentifier === "fighter-rework-v028" && normalizedName === "железная воля") {
    return createIronWillAutomation(feature, classIdentifier);
  }

  if (classIdentifier === "paladin-rework-v01" && normalizedName === "божественное чувство") {
    return createPaladinDivineSenseAutomation(feature);
  }

  if (classIdentifier === "paladin-rework-v01" && normalizedName === "наложение рук") {
    return createPaladinLayOnHandsAutomation(feature);
  }

  if (classIdentifier === "paladin-rework-v01" && normalizedName === "аура защиты") {
    return createPaladinAuraOfProtectionAutomation(feature);
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
  const isSorceryPointsFeature = feature.sourceType === "classFeature"
    && classIdentifier === "sorcerer-rework-v011"
    && feature.featureId.endsWith("::sorcerer-sorcery-points");
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
  const prerequisitesLevel = feature.sourceType === "fightingStyle"
    ? 0
    : Math.max(0, Math.floor(parseNumber(feature.requiredLevel, 0)));

  return {
    description: {
      value: createFeatureDescriptionValue(feature, context),
      chat: ""
    },
    source: createSourceData(feature.sourceLabel),
    identifier: isSorceryPointsFeature
      ? "sorcerer-sorcery-points"
      : buildAsciiIdentifier(feature.identifier, feature.featureId),
    type: {
      value: ["fighterManeuver", "rogueCunningStrike", "sorcererMetamagic"].includes(feature.sourceType) ? "feat" : "class",
      subtype: feature.sourceType === "fighterManeuver"
        ? "fighterManeuver"
        : feature.sourceType === "rogueCunningStrike"
          ? "rogueCunningStrike"
          : ""
    },
    requirements: buildSubtypeRequirementsLabel(feature),
    prerequisites: {
      items: [],
      level: prerequisitesLevel,
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

export function createPackMetadata({ name, label, itemTypes = [] }) {
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
        sourceBook: DEFAULT_SOURCE_LABEL,
        types: itemTypes
      }
    }
  };
}

async function syncPackMetadata(pack, metadata) {
  if (!pack || typeof pack.configure !== "function") {
    return;
  }

  const desiredDnd5eFlags = metadata.flags?.dnd5e ?? {};
  const currentSourceBook = cleanString(foundry.utils.getProperty(pack, "metadata.flags.dnd5e.sourceBook"));
  const desiredSourceBook = cleanString(desiredDnd5eFlags.sourceBook);
  const currentTypes = foundry.utils.getProperty(pack, "metadata.flags.dnd5e.types") ?? [];
  const desiredTypes = Array.isArray(desiredDnd5eFlags.types) ? desiredDnd5eFlags.types : [];
  if (
    currentSourceBook === desiredSourceBook
    && JSON.stringify(currentTypes) === JSON.stringify(desiredTypes)
  ) {
    return;
  }

  try {
    await pack.configure({
      flags: {
        ...(pack.metadata?.flags ?? {}),
        dnd5e: {
          ...(pack.metadata?.flags?.dnd5e ?? {}),
          ...desiredDnd5eFlags
        }
      }
    });
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to update compendium '${pack.collection ?? metadata.name}' metadata.`, error);
  }
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
  else {
    await syncPackMetadata(pack, metadata);
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

export function getManagedDocumentCreateOptions(pack) {
  return {
    pack: pack.collection,
    keepId: true
  };
}

function buildTraitAdvancement({
  classIdentifier,
  seed,
  title,
  hint = "",
  level = 1,
  mode = "default",
  allowReplacements = false,
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
      allowReplacements: allowReplacements === true,
      mode: cleanString(mode, "default"),
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

function weaponChoiceAdvancementLabel(choice, index = 0) {
  const pool = Array.isArray(choice?.pool) ? choice.pool : [];
  const count = Math.max(1, Math.floor(parseNumber(choice?.count, 1)));
  const isSimple = pool.some((entry) => cleanString(entry).startsWith("weapon:sim:"));
  const isMartial = pool.some((entry) => cleanString(entry).startsWith("weapon:mar:"));
  if (isSimple && !isMartial) {
    return {
      seed: `simple-weapon-proficiencies-${index + 1}`,
      title: "Владение простым оружием",
      hint: count === 1
        ? "Выберите одно простое оружие класса."
        : `Выберите простые оружия класса: ${count}.`
    };
  }

  if (isMartial && !isSimple) {
    return {
      seed: `martial-weapon-proficiencies-${index + 1}`,
      title: "Владение воинским оружием",
      hint: count === 1
        ? "Выберите одно воинское оружие класса."
        : `Выберите воинские оружия класса: ${count}.`
    };
  }

  return {
    seed: `weapon-proficiencies-${index + 1}`,
    title: "Владение оружием",
    hint: "Владение оружием класса."
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
  choices = null,
  pool = [],
  allowDrops = false,
  restriction = {},
  spell = null,
  type = "feat"
}) {
  const normalizedPool = unique(pool).map((uuid) => ({ uuid }));
  const normalizedChoices = normalizeItemChoiceChoices(choices, level, count);
  const restrictionData = isPlainObject(restriction) ? restriction : {};
  const spellData = isPlainObject(spell) ? spell : null;
  const spellUses = isPlainObject(spellData?.uses) ? spellData.uses : {};

  return {
    _id: stableHashId(`${classIdentifier}:${seed}`, "adv"),
    type: "ItemChoice",
    title: cleanString(title, "Выбор умения"),
    hint: cleanString(hint),
    level: Math.max(0, Math.floor(parseNumber(level, 1))),
    configuration: {
      allowDrops: allowDrops === true,
      choices: normalizedChoices,
      pool: normalizedPool,
      restriction: {
        level: cleanString(restrictionData.level),
        list: unique(Array.isArray(restrictionData.list)
          ? restrictionData.list.map((entry) => cleanString(entry))
          : cleanString(restrictionData.list)
            ? [cleanString(restrictionData.list)]
            : []),
        subtype: cleanString(restrictionData.subtype),
        type: cleanString(restrictionData.type)
      },
      spell: spellData
        ? {
          ability: unique(Array.isArray(spellData.ability)
            ? spellData.ability.map((entry) => cleanString(entry))
            : [cleanString(spellData.ability)].filter(Boolean)),
          method: cleanString(spellData.method),
          prepared: Math.max(0, Math.floor(parseNumber(spellData.prepared, 0))),
          uses: {
            max: cleanString(spellUses.max),
            per: cleanString(spellUses.per),
            requireSlot: spellUses.requireSlot !== false
          }
        }
        : null,
      type
    },
    value: {
      added: {},
      replaced: {}
    }
  };
}

function proficiencyGrant(prefix, value) {
  const key = cleanString(value);
  if (!key) {
    return "";
  }

  return key.includes(":") ? key : `${prefix}:${key}`;
}

function buildStartingEquipmentChoiceAdvancements(classData, context = {}) {
  const startingEquipmentConfig = getClassStartingEquipmentConfig(classData.identifier);
  if (!startingEquipmentConfig) {
    return [];
  }

  const featureUuidById = context.featureUuidById instanceof Map ? context.featureUuidById : new Map();
  const pool = startingEquipmentConfig.packages
    .map((equipmentPackage) => featureUuidById.get(
      `${classData.identifier}::${startingEquipmentConfig.sourceType}::${equipmentPackage.featureId}`
    ))
    .filter(Boolean);
  if (!pool.length) {
    return [];
  }

  const advancement = buildItemChoiceAdvancement({
    classIdentifier: classData.identifier,
    seed: "starting-equipment-package",
    title: "Стартовое снаряжение",
    hint: [
      startingEquipmentConfig.choiceHint,
      ...startingEquipmentConfig.packages.map((equipmentPackage) => equipmentPackage.label)
    ].join("\n"),
    level: 1,
    count: 1,
    pool,
    allowDrops: false,
    type: null
  });
  advancement.value.added[String(advancement.level)] ??= {};

  return [advancement];
}

function buildSpellChoiceAdvancements(classData, context = {}) {
  const spellChoices = Array.isArray(classData.spellChoices)
    ? classData.spellChoices
    : isPlainObject(classData.spellChoice)
      ? [classData.spellChoice]
      : [];

  const spellUuidById = context.spellUuidById instanceof Map ? context.spellUuidById : new Map();
  return spellChoices.map((spellChoice, index) => buildItemChoiceAdvancement({
    classIdentifier: classData.identifier,
    seed: cleanString(spellChoice.id, index ? `spells-${index + 1}` : "spells"),
    title: spellChoice.title,
    hint: spellChoice.hint,
    level: spellChoice.level,
    choices: spellChoice.choices,
    pool: (spellChoice.additionalSpellIds ?? [])
      .map((spellId) => spellUuidById.get(spellId))
      .filter(Boolean),
    allowDrops: true,
    restriction: spellChoice.restriction,
    spell: spellChoice.spell,
    type: "spell"
  }));
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

function runeUuidPoolFromContext(context = {}, maxRequiredLevel = 20) {
  const classIdentifier = cleanString(context.classIdentifier, "fighter-rework-v028");
  const runeFeatureIds = Array.isArray(context.runeFeatureIds)
    ? context.runeFeatureIds
    : (Array.isArray(context.runeEntries) ? context.runeEntries : [])
      .filter((entry) => Math.max(1, Math.floor(parseNumber(entry?.requiredLevel, entry?.levels?.[0] ?? 3))) <= maxRequiredLevel)
      .map((entry) => `${classIdentifier}::runeKnightRune::${entry.featureId}`)
      .filter(Boolean);

  return featureUuidsForIds(runeFeatureIds, context);
}

function sorcererMetamagicUuidPoolFromContext(context = {}, subclass = null, maxRequiredLevel = 20) {
  const classIdentifier = cleanString(context.classIdentifier, "sorcerer-rework-v011");
  const maxLevel = Math.max(1, Math.floor(parseNumber(maxRequiredLevel, 20)));
  const baseFeatureIds = (Array.isArray(context.metamagicEntries) ? context.metamagicEntries : [])
    .filter((entry) => Math.max(1, Math.floor(parseNumber(entry?.requiredLevel, entry?.levels?.[0] ?? 3))) <= maxLevel)
    .map((entry) => `${classIdentifier}::sorcererMetamagic::${entry.featureId}`)
    .filter(Boolean);
  const subclassFeatureIds = (Array.isArray(subclass?.metamagicOptions) ? subclass.metamagicOptions : [])
    .filter((entry) => Math.max(1, Math.floor(parseNumber(entry?.requiredLevel, entry?.levels?.[0] ?? 3))) <= maxLevel)
    .map((entry) => `${subclass.subclassId}::sorcererMetamagic::${entry.featureId}`)
    .filter(Boolean);

  return featureUuidsForIds([...baseFeatureIds, ...subclassFeatureIds], context);
}

function draconicAncestorUuidPoolFromContext(context = {}, subclass = null) {
  const subclassId = cleanString(subclass?.subclassId);
  if (!subclassId) {
    return [];
  }

  const ancestorFeatureIds = (Array.isArray(context.draconicAncestorEntries) ? context.draconicAncestorEntries : [])
    .map((entry) => `${subclassId}::sorcererDraconicAncestor::${entry.featureId}`)
    .filter(Boolean);

  return featureUuidsForIds(ancestorFeatureIds, context);
}

function spellIdentifierFromEnglishName(value) {
  const identifier = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/gu, "")
    .toLowerCase()
    .replace(/['`]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-|-$/gu, "");
  return new Map([
    ["dissonant-whisper", "dissonant-whispers"]
  ]).get(identifier) ?? identifier;
}

function extractSpellIdentifiersFromCell(cell) {
  const text = String(cell ?? "");
  const identifiers = [];
  const bracketPattern = /\\?\[([A-Za-z][A-Za-z0-9'`’\s/-]+)\\?\]/gu;
  for (const match of text.matchAll(bracketPattern)) {
    const identifier = spellIdentifierFromEnglishName(match[1]);
    if (identifier) {
      identifiers.push(identifier);
    }
  }

  return unique(identifiers);
}

function spellGrantLevel(value) {
  const match = cleanString(value).match(/\d+/u);
  if (!match) {
    return 0;
  }

  return Math.max(1, Math.min(20, Math.floor(parseNumber(match[0], 0))));
}

function subclassSpellGrantUuidsByLevel(subclass, spellUuidById = new Map()) {
  if (!(spellUuidById instanceof Map) || !spellUuidById.size) {
    return new Map();
  }

  const byLevel = new Map();
  for (const feature of subclass?.features ?? []) {
    let readingSpellTable = false;
    for (const line of String(feature?.description ?? "").split(/\r?\n/u)) {
      const cells = markdownTableCells(line);
      if (cells.length < 2) {
        readingSpellTable = false;
        continue;
      }

      const firstCell = normalizeMatchText(cells[0]);
      if (firstCell.includes("уровень") && cells.slice(1).some((cell) => (
        normalizeMatchText(cell).includes("заклин")
          || extractSpellIdentifiersFromCell(cell).length > 0
      ))) {
        readingSpellTable = true;
        continue;
      }
      if (!readingSpellTable || cells.some(isMarkdownSeparatorCell)) {
        continue;
      }

      const level = spellGrantLevel(cells[0]);
      if (!level) {
        continue;
      }

      const uuids = cells
        .slice(1)
        .flatMap(extractSpellIdentifiersFromCell)
        .map((identifier) => spellUuidById.get(identifier))
        .filter(Boolean);
      if (!uuids.length) {
        continue;
      }

      byLevel.set(level, unique([...(byLevel.get(level) ?? []), ...uuids]));
    }
  }

  return byLevel;
}

function buildSubclassSpellGrantAdvancements(subclass, context = {}) {
  const spellUuidById = context.spellUuidById instanceof Map ? context.spellUuidById : new Map();
  const byLevel = subclassSpellGrantUuidsByLevel(subclass, spellUuidById);
  return Array.from(byLevel.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([level, itemUuids]) => buildItemGrantAdvancement({
      classIdentifier: subclass.subclassId,
      seed: `origin-spells-${level}`,
      title: `${subclass.name}: заклинания происхождения (${level}-й уровень)`,
      hint: "Заклинания, которые происхождение чародея добавляет по мере прокачки.",
      level,
      itemUuids,
      optional: false
    }));
}

function buildFeatureItemAdvancements(feature, context = {}) {
  const advancements = [];

  const runeKnightAutomation = getRuneKnightFeatureAutomation(feature);
  if (runeKnightAutomation?.id === "bonus-proficiencies") {
    advancements.push(buildTraitAdvancement({
      classIdentifier: cleanString(feature.featureId, feature.classIdentifier),
      seed: "rune-knight-bonus-proficiencies",
      title: "Бонусные владения Рунного рыцаря",
      hint: "Владение инструментами кузнеца и Великаньим языком.",
      level: 0,
      grants: ["tool:art:smith", "languages:standard:giant"]
    }));
    return advancements;
  }

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

  if (feature.chooseFighterStyle === true) {
    const sourceClassIdentifier = cleanString(feature.fightingStyleSourceClassIdentifier, "fighter-rework-v028");
    const commonStyleFeatureIds = (Array.isArray(context.featureDefinitions) ? context.featureDefinitions : [])
      .filter((definition) => (
        definition?.sourceType === "fightingStyle"
        && definition.classIdentifier === sourceClassIdentifier
      ))
      .map((definition) => definition.featureId);
    const commonStyleUuids = featureUuidsForIds(commonStyleFeatureIds, context);
    if (commonStyleUuids.length) {
      advancements.push(buildItemChoiceAdvancement({
        classIdentifier,
        seed: "common-fighting-style",
        title: "Обычный боевой стиль",
        hint: "Выберите один общий боевой стиль.",
        level: 0,
        count: 1,
        pool: commonStyleUuids
      }));
    }
    return advancements;
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
    level: Math.max(1, Math.min(20, Math.floor(parseNumber(classData.subclassLevel, 3)))),
    configuration: {},
    value: {
      document: null,
      uuid: null
    }
  };
}

export function buildCraftsmanSubclassAdvancements(classData) {
  if (cleanString(classData?.archetypeTracks) !== "research-specialty") {
    return [];
  }

  for (const [field, expected] of [["researchLevel", 2], ["specialtyLevel", 3]]) {
    if (classData?.[field] !== expected) {
      throw new Error(`Invalid craftsman ${field}: expected ${expected}, received ${String(classData?.[field])}`);
    }
  }

  const specs = [
    {
      level: 2,
      type: "ResearchSubclass",
      seed: "research-choice",
      title: cleanString(classData.researchTitle, "Направление исследований"),
      hint: cleanString(classData.researchHint, "Выберите направление исследования ремесленника.")
    },
    {
      level: 3,
      type: "SpecialtySubclass",
      seed: "specialty-choice",
      title: cleanString(classData.specialtyTitle, "Специальность ремесленника"),
      hint: cleanString(classData.specialtyHint, "Выберите специальность ремесленника.")
    }
  ];

  return specs.map((spec) => ({
    _id: stableHashId(`${classData.identifier}:${spec.seed}`, "adv"),
    type: spec.type,
    title: spec.title,
    hint: spec.hint,
    level: spec.level,
    configuration: {},
    value: {
      document: null,
      uuid: null
    }
  }));
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
      fightingStyleFeatUuids: [],
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
  const fightingStyleFeatRecords = [];
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
    if (record.section === FIGHTING_STYLE_FEATS_SECTION) {
      fightingStyleFeatRecords.push({
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
      fightingStyleFeatUuids: sortRecords(fightingStyleFeatRecords),
      byName
    };
  }

  return {
    minorFeatUuids: sortRecords(allFeatRecords),
    fightingStyleFeatUuids: sortRecords(fightingStyleFeatRecords),
    byName
  };
}

async function buildSpellUuidMap() {
  const spellUuidById = new Map();

  for (const packId of [SPELLS_PACK_ID, "dnd5e.spells"]) {
    const pack = game.packs.get(packId);
    if (!pack) {
      continue;
    }

    const index = await pack.getIndex({
      fields: [
        "system.identifier",
        `flags.${MODULE_ID}.spellId`
      ]
    });
    for (const entry of index) {
      const spellId = cleanString(foundry.utils.getProperty(entry, `flags.${MODULE_ID}.spellId`),
        cleanString(foundry.utils.getProperty(entry, "system.identifier")));
      const uuid = compendiumItemUuid(pack.collection, entry._id ?? entry.id);
      if (spellId && uuid && !spellUuidById.has(spellId)) {
        spellUuidById.set(spellId, uuid);
      }
    }
  }

  return spellUuidById;
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
    fightingStyleFeatUuids = [],
    rageProgression = {},
    rageDamageProgression = {},
    fightingStyleEntries = [],
    dominanceProgression = {},
    spellUuidById = new Map()
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
    hint: classData.skillChoiceCount === 2
      ? "Выберите два навыка класса."
      : "Выберите навыки класса.",
    level: 1,
    choices: [{
      count: Math.max(1, Math.floor(parseNumber(classData.skillChoiceCount, 2))),
      pool: (classData.skillPool ?? SKILL_POOL).map((skill) => `skills:${skill}`)
    }]
  }));

  for (const expertiseChoice of classData.expertiseChoices ?? []) {
    advancements.push(buildTraitAdvancement({
      classIdentifier,
      seed: `expertise-${expertiseChoice.id}`,
      title: expertiseChoice.title,
      hint: expertiseChoice.hint || "Выберите навыки, которыми уже владеете, чтобы получить компетентность.",
      level: expertiseChoice.level,
      mode: expertiseChoice.mode,
      choices: [{
        count: expertiseChoice.count,
        pool: expertiseChoice.pool
      }]
    }));
  }

  const armorProficiencyGrants = (classData.armorProficiencies ?? [])
    .map((proficiency) => proficiencyGrant("armor", proficiency));
  if (armorProficiencyGrants.length) {
    advancements.push(buildTraitAdvancement({
      classIdentifier,
      seed: "armor-proficiencies",
      title: "Владение доспехами",
      hint: "Владение доспехами и щитами класса.",
      level: 1,
      grants: armorProficiencyGrants
    }));
  }

  const toolProficiencyGrants = (classData.toolProficiencies ?? [])
    .map((proficiency) => proficiencyGrant("tool", proficiency));
  const toolProficiencyChoices = Array.isArray(classData.toolProficiencyChoices)
    ? classData.toolProficiencyChoices
    : [];
  if (toolProficiencyGrants.length || toolProficiencyChoices.length) {
    advancements.push(buildTraitAdvancement({
      classIdentifier,
      seed: "tool-proficiencies",
      title: "Владение инструментами",
      hint: "Владение инструментами класса.",
      level: 1,
      grants: toolProficiencyGrants,
      choices: toolProficiencyChoices
    }));
  }

  const weaponProficiencyGrants = (classData.weaponProficiencies ?? [])
    .map((proficiency) => proficiencyGrant("weapon", proficiency));
  const weaponProficiencyChoices = Array.isArray(classData.weaponProficiencyChoices)
    ? classData.weaponProficiencyChoices
    : [];
  if (!weaponProficiencyGrants.length && weaponProficiencyChoices.length) {
    weaponProficiencyChoices.forEach((choice, index) => {
      const label = weaponChoiceAdvancementLabel(choice, index);
      advancements.push(buildTraitAdvancement({
        classIdentifier,
        seed: label.seed,
        title: label.title,
        hint: label.hint,
        level: 1,
        choices: [choice]
      }));
    });
  }
  else if (weaponProficiencyGrants.length || weaponProficiencyChoices.length) {
    advancements.push(buildTraitAdvancement({
      classIdentifier,
      seed: "weapon-proficiencies",
      title: "Владение оружием",
      hint: "Владение оружием класса.",
      level: 1,
      grants: weaponProficiencyGrants,
      choices: weaponProficiencyChoices
    }));
  }

  advancements.push(...buildStartingEquipmentChoiceAdvancements(classData, context));

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

  for (const scale of Array.isArray(classData.scaleAdvancements) ? classData.scaleAdvancements : []) {
    advancements.push(buildScaleValueAdvancement({
      classIdentifier,
      seed: `scale-${scale.identifier}`,
      title: scale.title,
      hint: scale.hint,
      identifier: scale.identifier,
      scaleEntries: scale.progression,
      level: scale.level,
      type: scale.type
    }));
  }

  if (cleanString(classData.archetypeTracks) === "research-specialty") {
    advancements.push(...buildCraftsmanSubclassAdvancements(classData));
  }
  else {
    advancements.push(buildSubclassAdvancement(classIdentifier, classData));
  }

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

  const cunningStrikeByLevel = new Map();
  for (const strike of classData.cunningStrikes ?? []) {
    const featureKey = `${classIdentifier}::rogueCunningStrike::${strike.featureId}`;
    const uuid = featureUuidById.get(featureKey);
    if (!uuid) {
      continue;
    }

    const level = Math.max(1, Math.floor(parseNumber(strike.requiredLevel, strike.levels?.[0] ?? 2)));
    if (!cunningStrikeByLevel.has(level)) {
      cunningStrikeByLevel.set(level, []);
    }
    cunningStrikeByLevel.get(level).push(uuid);
  }

  for (const [level, uuids] of Array.from(cunningStrikeByLevel.entries()).sort((a, b) => a[0] - b[0])) {
    advancements.push(buildItemGrantAdvancement({
      classIdentifier,
      seed: `cunning-strike-${level}`,
      title: `${ROGUE_CUNNING_STRIKE_SECTION_LABEL} (${level}-й уровень)`,
      hint: "Варианты Хитрого удара плута.",
      level,
      itemUuids: uuids,
      optional: false
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

  advancements.push(...buildSpellChoiceAdvancements(classData, { spellUuidById }));

  const fightingStyleFeaturePool = fightingStyleEntries
    .map((entry) => featureUuidById.get(`${classIdentifier}::fightingStyle::${entry.featureId}`))
    .filter(Boolean);
  const fightingStylePool = classIdentifier === "paladin-rework-v01"
    ? [
      ...unique(fightingStyleFeatUuids),
      ...fightingStyleEntries
        .filter((entry) => normalizeMatchText(entry.name) === "стиль паладина")
        .map((entry) => featureUuidById.get(`${classIdentifier}::fightingStyle::${entry.featureId}`))
        .filter(Boolean)
    ]
    : fightingStyleFeaturePool;

  if (fightingStylePool.length) {
    const fightingStyleLevel = Math.min(...fightingStyleEntries
      .map((entry) => Math.max(1, Math.floor(parseNumber(entry.requiredLevel, entry.levels?.[0] ?? 1))))
      .filter((level) => level > 0));
    advancements.push(buildItemChoiceAdvancement({
      classIdentifier,
      seed: "fighting-style",
      title: "Боевой стиль",
      hint: classIdentifier === "fighter-rework-v028"
        ? "Выберите один боевой стиль воина. Приёмы, которые даёт стиль, указаны в описании выбранного айтема."
        : "Выберите один боевой стиль класса.",
      level: Number.isFinite(fightingStyleLevel) ? fightingStyleLevel : 1,
      count: 1,
      pool: fightingStylePool
    }));
  }

  return advancements;
}

export function buildSubclassAdvancements(subclass, context = {}) {
  const { featureUuidById } = context;
  const grouped = new Map();
  const cunningStrikeGrouped = new Map();

  for (const strike of subclass.cunningStrikes ?? []) {
    const featureKey = `${subclass.subclassId}::rogueCunningStrike::${strike.featureId}`;
    const uuid = featureUuidById.get(featureKey);
    if (!uuid) {
      continue;
    }

    const level = Math.max(1, Math.floor(parseNumber(strike.requiredLevel, strike.levels?.[0] ?? 3)));
    if (!cunningStrikeGrouped.has(level)) {
      cunningStrikeGrouped.set(level, []);
    }
    cunningStrikeGrouped.get(level).push(uuid);
  }

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

  for (const [level, uuids] of Array.from(cunningStrikeGrouped.entries()).sort((a, b) => a[0] - b[0])) {
    advancements.push(buildItemGrantAdvancement({
      classIdentifier: subclass.subclassId,
      seed: `cunning-strike-${level}`,
      title: `${subclass.name}: ${ROGUE_CUNNING_STRIKE_SECTION_LABEL} (${level}-й уровень)`,
      hint: "Варианты Хитрого удара плута.",
      level,
      itemUuids: uuids,
      optional: false
    }));
  }

  advancements.push(...buildSubclassSpellGrantAdvancements(subclass, context));

  if (cleanString(context.classIdentifier) === "sorcerer-rework-v011") {
    if (normalizeMatchText(subclass.name) === DRACONIC_SORCERER_SUBCLASS_NAME) {
      const ancestorUuids = draconicAncestorUuidPoolFromContext(context, subclass);
      if (ancestorUuids.length) {
        advancements.push(buildItemChoiceAdvancement({
          classIdentifier: subclass.subclassId,
          seed: "draconic-ancestor",
          title: "Драконий предок",
          hint: "Выберите вид вашего драконьего предка.",
          level: 1,
          count: 1,
          pool: ancestorUuids,
          type: null
        }));
      }
    }

    for (const [level, count] of SORCERER_METAMAGIC_CHOICE_LEVELS) {
      const metamagicUuids = sorcererMetamagicUuidPoolFromContext(context, subclass, level);
      if (metamagicUuids.length) {
        advancements.push(buildItemChoiceAdvancement({
          classIdentifier: subclass.subclassId,
          seed: `metamagic-${level}`,
          title: "Метамагия",
          hint: "Выберите доступные варианты Метамагии чародея.",
          level,
          count,
          pool: metamagicUuids
        }));
      }
    }

    const levelTwentyMetamagicUuids = sorcererMetamagicUuidPoolFromContext(context, subclass, 20);
    const originMetamagicUuids = featureUuidsForIds(
      (Array.isArray(subclass?.metamagicOptions) ? subclass.metamagicOptions : [])
        .map((entry) => `${subclass.subclassId}::sorcererMetamagic::${entry.featureId}`),
      context
    );
    if (originMetamagicUuids.length) {
      advancements.push(buildItemGrantAdvancement({
        classIdentifier: subclass.subclassId,
        seed: "transcendence-origin-metamagic",
        title: `${subclass.name}: трансцендентность - расширенная метамагия`,
        hint: "На 20-м уровне вы изучаете все варианты метамагии из расширенного списка происхождения.",
        level: 20,
        itemUuids: originMetamagicUuids,
        optional: false
      }));
    }
    if (levelTwentyMetamagicUuids.length) {
      const knownMetamagicCount = SORCERER_METAMAGIC_CHOICE_LEVELS
        .reduce((total, [, count]) => total + count, 0);
      advancements.push(buildItemChoiceAdvancement({
        classIdentifier: subclass.subclassId,
        seed: "transcendence-metamagic-replacement",
        title: "Трансцендентность: замена метамагии",
        hint: "Можете заменить все известные варианты метамагии.",
        level: 20,
        count: knownMetamagicCount,
        choices: {
          20: { count: knownMetamagicCount, replacement: true }
        },
        pool: levelTwentyMetamagicUuids
      }));
      advancements.push(buildItemChoiceAdvancement({
        classIdentifier: subclass.subclassId,
        seed: "transcendence-metamagic-discount",
        title: "Трансцендентность: сниженная стоимость",
        hint: "Выберите 4 известных варианта метамагии; их стоимость уменьшается на 1, минимум до 1, и они совместимы с другим вариантом.",
        level: 20,
        count: 4,
        pool: levelTwentyMetamagicUuids
      }));
    }
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

  if (normalizeMatchText(subclass.name) === RUNE_KNIGHT_SUBCLASS_NAME) {
    for (const { level, count } of RUNE_KNIGHT_RUNE_CHOICE_LEVELS) {
      const runeUuids = runeUuidPoolFromContext(context, level);
      if (!runeUuids.length) {
        continue;
      }

      advancements.push(buildItemChoiceAdvancement({
        classIdentifier: subclass.subclassId,
        seed: `runes-${level}`,
        title: `Руны (${level}-й уровень)`,
        hint: "Выберите руны, изучаемые умением «Резчик Рун».",
        level,
        count,
        pool: runeUuids
      }));
    }
  }

  return advancements;
}

export function buildCraftsmanArchetypeAdvancements(archetype, context = {}) {
  const featureUuidById = context.featureUuidById instanceof Map
    ? context.featureUuidById
    : new Map();

  return (archetype.features ?? []).map((feature) => {
    const featureKey = `${archetype.classIdentifier}::${archetype.axis}::${archetype.archetypeId}::${feature.featureId}`;
    const uuid = featureUuidById.get(featureKey);
    if (!uuid) {
      throw new Error(`Missing craftsman archetype feature UUID: ${feature.featureId}`);
    }

    const advancement = buildItemGrantAdvancement({
      classIdentifier: archetype.archetypeId,
      seed: `grant-${feature.featureId}`,
      title: `${archetype.name}: ${feature.name}`,
      hint: `Умение архетипа «${archetype.name}».`,
      level: feature.requiredLevel,
      itemUuids: [uuid],
      optional: false
    });
    advancement.value = { added: {} };
    return advancement;
  });
}

function buildCraftsmanSubclassSignature(archetype, system, sourceLabel) {
  return JSON.stringify({
    templateVersion: CRAFTSMAN_SUBCLASS_TEMPLATE_VERSION,
    archetypeId: archetype.archetypeId,
    axis: archetype.axis,
    type: archetype.type,
    name: archetype.name,
    classIdentifier: archetype.classIdentifier,
    source: sourceLabel,
    sourceRevision: archetype.sourceRevision,
    featureIds: (archetype.features ?? []).map((feature) => feature.featureId),
    system
  });
}

export function buildCraftsmanSubclassDefinitions(normalizedData, context = {}) {
  const archetypes = [
    ...(normalizedData?.researches ?? []),
    ...(normalizedData?.specialties ?? [])
  ];

  return archetypes.map((archetype) => {
    const advancement = buildCraftsmanArchetypeAdvancements(archetype, context);
    const system = createSubclassSystem(
      {
        ...archetype,
        subclassId: archetype.archetypeId
      },
      archetype.classIdentifier,
      advancement,
      normalizedData.sourceLabel
    );
    return {
      ...archetype,
      subclassId: archetype.archetypeId,
      system,
      signature: buildCraftsmanSubclassSignature(archetype, system, normalizedData.sourceLabel),
      folderPath: normalizeFolderPath([
        SUBCLASS_ROOT_FOLDER,
        CRAFTSMAN_SUBCLASS_ROOT_FOLDER,
        archetype.axis === "research" ? "Исследования" : "Специальности"
      ])
    };
  });
}

export function createClassSystem(classData, advancement = [], sourceLabel = DEFAULT_SOURCE_LABEL) {
  const spellcasting = normalizeSpellcastingData(classData.spellcasting);
  return {
    description: {
      value: toHtmlParagraphs(classData.description),
      chat: ""
    },
    source: createSourceData(sourceLabel),
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
    spellcasting,
    startingEquipment: getClassStartingEquipmentConfig(classData.identifier)
      ? []
      : foundry.utils.deepClone(classData.startingEquipment ?? []),
    wealth: cleanString(classData.wealth, "2d4*10"),
    advancement: foundry.utils.deepClone(advancement)
  };
}

export function createSubclassSystem(subclass, classIdentifier, advancement = [], sourceLabel = DEFAULT_SOURCE_LABEL) {
  const spellcasting = normalizeSpellcastingData(subclass.spellcasting);
  return {
    description: {
      value: toHtmlParagraphs(subclass.description),
      chat: ""
    },
    source: createSourceData(sourceLabel),
    identifier: buildAsciiIdentifier(subclass.subclassId, subclass.name),
    classIdentifier: buildAsciiIdentifier(classIdentifier, classIdentifier),
    spellcasting,
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

  if (sourceType === "runeKnightRune") {
    addIconCandidate(candidates, seenCandidates, `${featureName} — Рунный рыцарь`);
  }

  addIconCandidate(candidates, seenCandidates, featureName);

  if (sourceType === "runeKnightRune") {
    addIconCandidate(candidates, seenCandidates, "Резчик рун");
  }

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

const SUBCLASS_ICON_ALIASES_BY_CLASS = Object.freeze({
  [normalizeMatchText("sorcerer-rework-v011")]: Object.freeze({
    [normalizeMatchText("Наследие драконьей крови")]: ["Драконий предок"],
    [normalizeMatchText("Дикая магия")]: ["Волна дикой магии"],
    [normalizeMatchText("Божественная душа")]: ["Божественная магия"],
    [normalizeMatchText("Теневая магия")]: ["Мрачная форма"],
    [normalizeMatchText("Штормовое колдовство")]: ["Штормовое сердце", "Шёпот ветров"],
    [normalizeMatchText("Аберрантный разум")]: ["Телепатическая речь"],
    [normalizeMatchText("Заводная душа")]: ["Заводная магия"],
    [normalizeMatchText("Лунное чародейство")]: ["Лунное воплощение"],
    [normalizeMatchText("Дитя песков")]: ["Песчаный покров"]
  }),
  [normalizeMatchText("rogue-rework-v00")]: Object.freeze({
    [normalizeMatchText("Вор")]: ["Мастер подготовки"],
    [normalizeMatchText("Мистический ловкач")]: ["Мистическая подготовка"]
  })
});

export function resolveSubclassIcon(subclassName, iconLookup, classIdentifier = "") {
  const direct = resolveNamedIcon(subclassName, iconLookup);
  if (direct) {
    return direct;
  }

  const aliases = SUBCLASS_ICON_ALIASES_BY_CLASS[normalizeMatchText(classIdentifier)]
    ?.[normalizeMatchText(subclassName)] ?? [];
  for (const alias of aliases) {
    const icon = resolveNamedIcon(alias, iconLookup);
    if (icon) {
      return icon;
    }
  }

  return DEFAULT_SUBCLASS_ICON;
}

function resolveClassIcon(className, iconLookup) {
  const iconByClassName = resolveNamedIcon(className, iconLookup);
  if (iconByClassName) {
    return iconByClassName;
  }

  if (normalizeMatchText(className).includes("воин")) {
    return resolveNamedIcon("Fighter", iconLookup, DEFAULT_CLASS_ICON);
  }

  if (normalizeMatchText(className).includes("паладин")) {
    return resolveNamedIcon("Paladin", iconLookup, PALADIN_CLASS_ICON);
  }

  if (normalizeMatchText(className).includes("плут")) {
    return resolveNamedIcon("Rogue", iconLookup, DEFAULT_CLASS_ICON);
  }

  return resolveNamedIcon("Barbarian", iconLookup, DEFAULT_CLASS_ICON);
}

export function createFeatureEntryData(feature, folderIdByPath, iconLookup = null, context = {}) {
  const folderPath = feature.folderPath.join("/");
  const featureAutomation = createFeatureAutomation(feature, feature.classIdentifier);
  const runeKnightAutomation = getRuneKnightRuneAutomation(feature)
    ?? getRuneKnightFeatureAutomation(feature);
  const moduleFlags = {
    managed: true,
    sourceType: feature.sourceType,
    axis: feature.axis,
    archetypeId: feature.archetypeId,
    archetypeName: feature.archetypeName,
    classIdentifier: feature.classIdentifier,
    subclassId: feature.subclassId,
    subclassName: feature.subclassName,
    styleName: feature.styleName,
    featureId: feature.featureId,
    requiredLevel: feature.requiredLevel,
    optional: feature.optional === true,
    maneuvers: feature.maneuvers ?? [],
    cunningStrikeCost: feature.cunningStrikeCost ?? 0,
    startingEquipmentPackageId: feature.startingEquipmentPackage?.id,
    startingEquipmentPackage: feature.startingEquipmentPackage
      ? foundry.utils.deepClone(feature.startingEquipmentPackage)
      : undefined,
    metamagicId: feature.metamagicId,
    cost: feature.cost,
    costMode: feature.costMode,
    minCost: feature.minCost,
    maxCost: feature.maxCost,
    metamagicAutomation: feature.automation,
    spellAutomation: feature.automation === "advanced-spell-shatter"
      ? { kind: "spell-shatter" }
      : undefined,
    paladinAutomation: feature.paladinAutomation
      ? foundry.utils.deepClone(feature.paladinAutomation)
      : undefined,
    paladinDogma: feature.paladinDogma
      ? foundry.utils.deepClone(feature.paladinDogma)
      : undefined,
    stacking: feature.stacking,
    damageType: feature.damageType,
    savingThrow: feature.savingThrow,
    craftsmanGadgetTemplate: feature.sourceType === "craftsmanGadget"
      ? {
        gadgetId: feature.craftsmanGadget?.id,
        availability: feature.craftsmanGadget?.availability,
        requiredLevel: feature.craftsmanGadget?.requiredLevel,
        attachment: feature.craftsmanGadget?.attachment ?? ""
      }
      : undefined,
    runeKnightAutomation: runeKnightAutomation
      ? foundry.utils.deepClone(runeKnightAutomation)
      : undefined,
    signature: buildFeatureSignature(feature, context),
    automation: feature.sourceType === "rageAction"
      ? { type: "rageAction", requiredLevel: feature.requiredLevel }
      : feature.sourceType === "fighterManeuver"
        ? { type: "fighterManeuver", requiredLevel: feature.requiredLevel }
        : undefined
  };
  if (feature.sourceType === "fighterManeuver") {
    moduleFlags.section = FIGHTER_MANEUVER_SECTION_LABEL;
    const fighterAutomation = getFighterManeuverAutomation(feature.name, feature.classIdentifier);
    if (fighterAutomation.attackRollBoost) {
      moduleFlags.attackRollBoosts = [foundry.utils.deepClone(fighterAutomation.attackRollBoost)];
    }
  }
  else if (feature.sourceType === "rogueCunningStrike") {
    moduleFlags.section = ROGUE_CUNNING_STRIKE_SECTION_LABEL;
  }

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
      [MODULE_ID]: moduleFlags,
      ...(feature.sourceType === "fighterManeuver"
        ? {
          teyvankal: {
            section: FIGHTER_MANEUVER_SECTION_LABEL,
            subsection: null
          }
        }
        : feature.sourceType === "rogueCunningStrike"
          ? {
            teyvankal: {
              section: ROGUE_CUNNING_STRIKE_SECTION_LABEL,
              subsection: null
            }
          }
          : {})
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
    img: resolveSubclassIcon(entry.subclass.name, iconLookup, entry.classIdentifier),
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

function createCraftsmanSubclassEntryData(entry, folderIdByPath, iconLookup = null) {
  const folderPath = entry.folderPath.join("/");
  return {
    _id: entry.documentId,
    name: entry.name,
    type: entry.type,
    img: resolveSubclassIcon(entry.name, iconLookup, entry.classIdentifier),
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
        subclassId: entry.archetypeId,
        archetypeId: entry.archetypeId,
        craftsmanTrack: entry.axis,
        classIdentifier: entry.classIdentifier,
        sourceRevision: entry.sourceRevision,
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
    const descriptionValue = createFeatureDescriptionValue(feature, context);
    const signature = buildFeatureSignature(feature, context);
    if (
      JSON.stringify(document.system?.advancement ?? []) === JSON.stringify(advancement)
      && cleanString(document.system?.description?.value) === descriptionValue
      && document.getFlag(MODULE_ID, "signature") === signature
    ) {
      continue;
    }

    updates.push({
      _id: document.id ?? document._id,
      "system.advancement": advancement,
      "system.description.value": descriptionValue,
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
  const stableFeatureContext = {
    ...context,
    featureDefinitions,
    featureUuidById: buildFeatureUuidMap(featureDefinitions, pack.collection)
  };
  const features = featureDefinitions.map((feature) => ({
    ...feature,
    signature: buildFeatureSignature(feature, stableFeatureContext)
  }));

  for (const legacyRoot of LEGACY_CLASS_FEATURE_ROOT_FOLDERS) {
    await clearPackFolderTree(pack, legacyRoot);
  }
  await syncFlaggedManagedDocuments({
    pack,
    entries: features,
    documents,
    moduleId: MODULE_ID,
    sourceIdFlag: "featureId",
    prepareFolders: async (entries) => {
      try {
        return await ensureCompendiumFolders(pack, entries.map((entry) => entry.folderPath));
      }
      catch (error) {
        console.warn(`${MODULE_ID} | Failed to prepare compendium folders for ${pack.collection}.`, error);
        return new Map();
      }
    },
    buildData: (entry, folderIdByPath) => (
      createFeatureEntryData(entry, folderIdByPath, context.iconLookup, stableFeatureContext)
    )
  });

  const activePack = game.packs.get(CLASS_FEATURES_PACK_ID) ?? pack;
  const featureDocuments = await getPackDocuments(activePack);
  const featureUuidById = buildFeatureUuidMap(featureDefinitions, activePack.collection, featureDocuments);
  const featureDefinitionById = new Map(featureDefinitions.map((feature) => [feature.featureId, feature]));
  await syncFeatureDocumentAdvancements(activePack, featureDocuments, featureDefinitions, {
    ...context,
    featureDefinitions,
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

export async function syncSubclassesPack(normalizedDataList, context = {}) {
  const normalized = Array.isArray(normalizedDataList) ? normalizedDataList : [normalizedDataList];
  const pack = await ensurePack(SUBCLASSES_PACK_ID, createPackMetadata({
    name: SUBCLASSES_COMPENDIUM_NAME,
    label: SUBCLASSES_COMPENDIUM_LABEL,
    itemTypes: ["subclass"]
  }));

  const subclassEntries = [];
  for (const normalizedData of normalized) {
    const classIdentifier = normalizedData.classData.identifier;
    for (const subclass of normalizedData.subclasses) {
      const advancement = buildSubclassAdvancements(subclass, {
        ...context,
        classIdentifier,
        maneuverEntries: normalizedData.maneuvers,
        runeEntries: normalizedData.runes,
        metamagicEntries: normalizedData.classData.metamagicOptions,
        draconicAncestorEntries: normalizedData.draconicAncestors
      });
      const system = createSubclassSystem(subclass, classIdentifier, advancement, normalizedData.sourceLabel);
      subclassEntries.push({
        subclass,
        subclassId: subclass.subclassId,
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

    for (const craftsmanSubclass of buildCraftsmanSubclassDefinitions(normalizedData, context)) {
      subclassEntries.push({
        ...craftsmanSubclass,
        isCraftsmanSubclass: true
      });
    }
  }

  const documents = await getPackDocuments(pack);
  for (const legacyRoot of LEGACY_SUBCLASS_ROOT_FOLDERS) {
    await clearPackFolderTree(pack, legacyRoot);
  }
  await syncFlaggedManagedDocuments({
    pack,
    entries: subclassEntries,
    documents,
    moduleId: MODULE_ID,
    sourceIdFlag: "subclassId",
    prepareFolders: async (entries) => {
      try {
        return await ensureCompendiumFolders(pack, entries.map((entry) => entry.folderPath));
      }
      catch (error) {
        console.warn(`${MODULE_ID} | Failed to prepare compendium folders for ${pack.collection}.`, error);
        return new Map();
      }
    },
    buildData: (entry, folderIdByPath) => (
      entry.isCraftsmanSubclass
        ? createCraftsmanSubclassEntryData(entry, folderIdByPath, context.iconLookup)
        : createSubclassEntryData(entry, folderIdByPath, context.iconLookup)
    )
  });

  const activePack = game.packs.get(SUBCLASSES_PACK_ID) ?? pack;
  const activeDocuments = await getPackDocuments(activePack);
  await syncManagedDocumentIcons(
    activePack,
    activeDocuments,
    (document) => resolveSubclassIcon(
      document.name,
      context.iconLookup,
      document.getFlag?.(MODULE_ID, "classIdentifier")
        ?? foundry.utils.getProperty(document, `flags.${MODULE_ID}.classIdentifier`, "")
    )
  );

  return {
    pack: activePack,
    subclassUuidById: buildSubclassUuidMap(subclassEntries, activeDocuments)
  };
}

function validateCraftsmanSubclassUuidMap(normalizedDataList, subclassUuidById) {
  const uuidById = subclassUuidById instanceof Map ? subclassUuidById : new Map();
  for (const normalizedData of normalizedDataList) {
    if (cleanString(normalizedData?.classData?.archetypeTracks) !== "research-specialty") {
      continue;
    }

    for (const subclass of [
      ...(normalizedData.researches ?? []),
      ...(normalizedData.specialties ?? [])
    ]) {
      const expected = CRAFTSMAN_ARCHETYPE_REGISTRY[subclass.archetypeId];
      if (
        !expected
        || subclass.axis !== expected.track
        || subclass.documentId !== expected.documentId
        || uuidById.get(subclass.archetypeId) !== expected.uuid
      ) {
        throw new Error(`Missing craftsman subclass UUID: ${subclass.archetypeId}`);
      }
    }
  }
}

export async function syncClassesPack(normalizedDataList, context = {}) {
  const normalized = Array.isArray(normalizedDataList) ? normalizedDataList : [normalizedDataList];
  validateCraftsmanSubclassUuidMap(normalized, context.subclassUuidById);

  const pack = await ensurePack(CLASSES_PACK_ID, createPackMetadata({
    name: CLASSES_COMPENDIUM_NAME,
    label: CLASSES_COMPENDIUM_LABEL,
    itemTypes: ["class"]
  }));

  const classEntries = [];
  for (const normalizedData of normalized) {
    const classFeatures = normalizedData.classData.features;
    const classAdvancement = buildClassAdvancement(normalizedData.classData, {
      featureUuidById: context.featureUuidById,
      classFeatureEntries: classFeatures,
      rageActionEntries: normalizedData.rageActions,
      minorFeatUuids: context.minorFeatUuids,
      rageProgression: normalizedData.rageProgression,
      rageDamageProgression: normalizedData.rageDamageProgression,
      fightingStyleEntries: normalizedData.fightingStyles,
      fightingStyleFeatUuids: context.fightingStyleFeatUuids,
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
  for (const legacyRoot of LEGACY_CLASS_ROOT_FOLDERS) {
    await clearPackFolderTree(pack, legacyRoot);
  }
  await syncFlaggedManagedDocuments({
    pack,
    entries: classEntries.map((entry) => ({
      ...entry,
      classIdentifier: entry.classData.identifier
    })),
    documents,
    moduleId: MODULE_ID,
    sourceIdFlag: "classIdentifier",
    prepareFolders: async (entries) => {
      try {
        return await ensureCompendiumFolders(pack, entries.map((entry) => entry.folderPath));
      }
      catch (error) {
        console.warn(`${MODULE_ID} | Failed to prepare compendium folders for ${pack.collection}.`, error);
        return new Map();
      }
    },
    buildData: (entry, folderIdByPath) => createClassEntryData(entry, folderIdByPath, context.iconLookup)
  });

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
    const spellUuidById = await buildSpellUuidMap();
    const { pack: featuresPack, featureUuidById } = await syncClassFeaturePack(featureDefinitions, {
      iconLookup,
      featLookupByName: featLookup.byName,
      rootFolders: normalizedData.map((classData) => classData.classFeatureRootFolder)
    });
    const {
      pack: subclassesPack,
      subclassUuidById
    } = await syncSubclassesPack(normalizedData, {
      featureUuidById,
      iconLookup,
      spellUuidById
    });
    validateCraftsmanSubclassUuidMap(normalizedData, subclassUuidById);
    const classesPack = await syncClassesPack(normalizedData, {
      featureUuidById,
      subclassUuidById,
      minorFeatUuids: featLookup.minorFeatUuids,
      fightingStyleFeatUuids: featLookup.fightingStyleFeatUuids,
      spellUuidById,
      iconLookup
    });
    return {
      classesPack,
      subclassesPack,
      featuresPack
    }
  }
}
