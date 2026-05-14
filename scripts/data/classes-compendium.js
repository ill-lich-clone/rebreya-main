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
import { ensureCompendiumFolders, normalizeFolderPath } from "./compendium-utils.js";
import { buildSlug } from "./item-classification.js";

const DND5E_SYSTEM_ID = "dnd5e";
const DEFAULT_SOURCE_LABEL = "Реворк Варвара V0.12";
const DATA_PATH = `modules/${MODULE_ID}/data/barbarian-rework-v012.json`;

const FEATS_PACK_ID = `world.${FEATS_COMPENDIUM_NAME}`;
const CLASS_FEATURES_PACK_ID = `world.${CLASS_FEATURES_COMPENDIUM_NAME}`;
const SUBCLASSES_PACK_ID = `world.${SUBCLASSES_COMPENDIUM_NAME}`;
const CLASSES_PACK_ID = `world.${CLASSES_COMPENDIUM_NAME}`;

const CLASS_ROOT_FOLDER = "Классы Rebreya";
const SUBCLASS_ROOT_FOLDER = "Архетипы Rebreya";
const CLASS_FEATURE_ROOT_FOLDER = "Умения варвара Rebreya (Реворк V0.12)";

const CLASS_FEATURE_TEMPLATE_VERSION = 3;
const SUBCLASS_TEMPLATE_VERSION = 1;
const CLASS_TEMPLATE_VERSION = 1;

const DEFAULT_CLASS_ICON = "icons/svg/book.svg";
const DEFAULT_SUBCLASS_ICON = "icons/svg/book.svg";
const DEFAULT_FEATURE_ICON = "icons/svg/book.svg";

const DEFAULT_HD = "d12";
const MINOR_FEAT_LEVELS = [3, 6, 9, 12, 15, 18];
const RAGE_ACTION_PICK_LEVELS = [5, 10, 15, 20];
const SKILL_POOL = ["ath", "prc", "sur", "itm", "nat", "ani"];
const ASI_LEVELS = [4, 8, 12, 16, 19];
const EFFECT_MODE_CUSTOM = 0;
const EFFECT_MODE_ADD = 2;
const EFFECT_MODE_OVERRIDE = 5;

const OPTIONAL_CLASS_FEATURE_NAMES = new Set([
  "стальной желудок",
  "пуленепробиваемое тело"
]);

const SPECIAL_CLASS_FEATURES = {
  MINOR_FEAT: "младшая черта",
  ABILITY_SCORE_IMPROVEMENT: "увеличение характеристик"
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
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/gu, "<br>")}</p>`)
    .join("");
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

function normalizeBarbarianData(rawData) {
  const data = isPlainObject(rawData) ? rawData : {};
  const sourceLabel = cleanString(data.source, DEFAULT_SOURCE_LABEL);

  const rawClass = isPlainObject(data.class) ? data.class : {};
  const className = cleanString(rawClass.name, "Варвар (реворк V0.12)");
  const classIdentifier = buildAsciiIdentifier(
    cleanString(rawClass.identifier, buildSlug(className, "barbarian-rework-v012")),
    className
  );
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

  const rageProgression = {};
  for (const [level, value] of Object.entries(isPlainObject(data.rageProgression) ? data.rageProgression : {})) {
    const parsedLevel = Math.max(1, Math.floor(parseNumber(level, 0)));
    const parsedValue = Math.max(0, Math.floor(parseNumber(value, 0)));
    if (parsedLevel >= 1 && parsedLevel <= 20 && parsedValue > 0) {
      rageProgression[String(parsedLevel)] = parsedValue;
    }
  }

  const rageDamageProgression = {};
  for (const [level, value] of Object.entries(isPlainObject(data.rageDamageProgression) ? data.rageDamageProgression : {})) {
    const parsedLevel = Math.max(1, Math.floor(parseNumber(level, 0)));
    const parsedValue = Math.max(0, Math.floor(parseNumber(value, 0)));
    if (parsedLevel >= 1 && parsedLevel <= 20 && parsedValue > 0) {
      rageDamageProgression[String(parsedLevel)] = parsedValue;
    }
  }

  return {
    sourceLabel,
    classData: {
      name: className,
      description: cleanString(rawClass.description),
      identifier: classIdentifier,
      features: classFeatures
    },
    subclasses,
    rageActions,
    rageProgression,
    rageDamageProgression
  };
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

function buildFeatureDefinitions(normalizedData) {
  const definitions = [];
  const classId = normalizedData.classData.identifier;

  for (const feature of normalizedData.classData.features) {
    definitions.push({
      featureId: `${classId}::class::${feature.featureId}`,
      sourceType: "classFeature",
      classIdentifier: classId,
      subclassId: null,
      subclassName: null,
      name: feature.name,
      description: feature.description,
      levels: feature.levels,
      requiredLevel: feature.requiredLevel,
      optional: feature.optional === true,
      identifier: buildAsciiIdentifier(`${classId}-${feature.featureId}`, `${classId}::${feature.featureId}`),
      folderPath: normalizeFolderPath([CLASS_FEATURE_ROOT_FOLDER, "Базовые умения"])
    });
  }

  for (const action of normalizedData.rageActions) {
    definitions.push({
      featureId: `${classId}::rage-action::${action.featureId}`,
      sourceType: "rageAction",
      classIdentifier: classId,
      subclassId: null,
      subclassName: null,
      name: action.name,
      description: action.description,
      levels: action.levels,
      requiredLevel: action.requiredLevel,
      optional: false,
      identifier: buildAsciiIdentifier(`${classId}-rage-${action.featureId}`, `${classId}::rage::${action.featureId}`),
      folderPath: normalizeFolderPath([CLASS_FEATURE_ROOT_FOLDER, "Яростные действия"])
    });
  }

  for (const subclass of normalizedData.subclasses) {
    for (const feature of subclass.features) {
      definitions.push({
        featureId: `${subclass.subclassId}::subclass::${feature.featureId}`,
        sourceType: "subclassFeature",
        classIdentifier: classId,
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
        folderPath: normalizeFolderPath([CLASS_FEATURE_ROOT_FOLDER, "Архетипы", subclass.name])
      });
    }
  }

  return definitions;
}

function buildFeatureSignature(feature) {
  return JSON.stringify({
    templateVersion: CLASS_FEATURE_TEMPLATE_VERSION,
    featureId: feature.featureId,
    sourceType: feature.sourceType,
    classIdentifier: feature.classIdentifier,
    subclassId: feature.subclassId,
    subclassName: feature.subclassName,
    name: feature.name,
    description: feature.description,
    levels: feature.levels,
    requiredLevel: feature.requiredLevel,
    optional: feature.optional,
    identifier: feature.identifier
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

  return `Варвар, ${level}-й уровень`;
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

function createFeatureAutomation(feature, classIdentifier) {
  if (feature.sourceType !== "classFeature") {
    return createEmptyFeatureAutomation();
  }

  const normalizedName = normalizeMatchText(feature.name);
  if (normalizedName === "ярость") {
    return createRageFeatureAutomation(feature, classIdentifier);
  }

  if (normalizedName === "защита без доспехов") {
    return createUnarmoredDefenseFeatureAutomation(feature, classIdentifier);
  }

  return createEmptyFeatureAutomation();
}

function createFeatureSystem(feature, classIdentifier, featureAutomation = null) {
  const normalizedName = normalizeMatchText(feature.name);
  const isRageFeature = feature.sourceType === "classFeature" && normalizedName === "ярость";
  const automation = featureAutomation ?? createFeatureAutomation(feature, classIdentifier);
  const rageRecovery = isRageFeature
    ? [{
      period: "lr",
      type: "recoverAll",
      formula: ""
    }]
    : [];
  const usesRecovery = Array.isArray(automation?.usesRecovery) && automation.usesRecovery.length
    ? foundry.utils.deepClone(automation.usesRecovery)
    : rageRecovery;

  return {
    description: {
      value: toHtmlParagraphs(feature.description),
      chat: ""
    },
    source: {
      custom: DEFAULT_SOURCE_LABEL
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
      max: isRageFeature ? `@scale.${classIdentifier}.rage-uses` : "",
      recovery: usesRecovery
    },
    advancement: []
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
        sourceBook: DEFAULT_SOURCE_LABEL,
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

  if (pack) {
    return pack;
  }

  return foundry.documents.collections.CompendiumCollection.createCompendium(metadata);
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
  level = 1
}) {
  const normalizedScale = {};
  for (const [scaleLevel, scaleValue] of Object.entries(isPlainObject(scaleEntries) ? scaleEntries : {})) {
    const parsedLevel = Math.max(1, Math.floor(parseNumber(scaleLevel, 0)));
    const parsedValue = Math.max(0, parseNumber(scaleValue, 0));
    if (parsedLevel >= 1 && parsedLevel <= 20) {
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
      type: "number",
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

function buildSubclassAdvancement(classIdentifier) {
  return {
    _id: stableHashId(`${classIdentifier}:subclass`, "adv"),
    type: "Subclass",
    title: "Путь дикости",
    hint: "Выберите архетип варвара.",
    level: 3,
    value: {}
  };
}

function normalizeFeatIndexRecord(record, pack) {
  const id = record?._id ?? record?.id ?? "";
  const uuid = id ? `Compendium.${pack.collection}.${id}` : "";
  const section = normalizeMatchText(foundry.utils.getProperty(record, "flags.teyvankal.section"));

  return {
    id,
    uuid,
    name: cleanString(record?.name),
    normalizedName: normalizeMatchText(record?.name),
    section
  };
}

async function buildMinorFeatPool() {
  const pack = game.packs.get(FEATS_PACK_ID);
  if (!pack) {
    return [];
  }

  const index = await pack.getIndex({
    fields: ["flags.teyvankal.section"]
  });
  const minorFeatUuids = [];
  const allFeatUuids = [];

  for (const row of index) {
    const record = normalizeFeatIndexRecord(row, pack);
    if (!record.uuid) {
      continue;
    }

    allFeatUuids.push(record.uuid);
    if (record.section === normalizeMatchText("младшие черты")) {
      minorFeatUuids.push(record.uuid);
    }
  }

  const normalizedMinor = unique(minorFeatUuids);
  if (normalizedMinor.length) {
    return normalizedMinor;
  }

  return unique(allFeatUuids);
}

function buildClassAdvancement(classData, context) {
  const { featureUuidById, classFeatureEntries, rageActionEntries, minorFeatUuids, rageProgression, rageDamageProgression } = context;
  const classIdentifier = classData.identifier;
  const advancements = [];

  advancements.push(buildHitPointsAdvancement(classIdentifier));

  advancements.push(buildTraitAdvancement({
    classIdentifier,
    seed: "saves",
    title: "Спасброски",
    hint: "Владение спасбросками Силы и Телосложения.",
    level: 1,
    grants: ["saves:str", "saves:con"]
  }));

  advancements.push(buildTraitAdvancement({
    classIdentifier,
    seed: "skills",
    title: "Навыки варвара",
    hint: "Выберите два навыка варвара.",
    level: 1,
    choices: [{
      count: 2,
      pool: SKILL_POOL.map((skill) => `skills:${skill}`)
    }]
  }));

  advancements.push(buildScaleValueAdvancement({
    classIdentifier,
    seed: "rage-uses",
    title: "Ярость: использования",
    hint: "Количество использований ярости до отдыха.",
    identifier: "rage-uses",
    scaleEntries: rageProgression,
    level: 1
  }));

  advancements.push(buildScaleValueAdvancement({
    classIdentifier,
    seed: "rage-damage",
    title: "Урон ярости",
    hint: "Дополнительный урон в ярости.",
    identifier: "rage-damage",
    scaleEntries: rageDamageProgression,
    level: 1
  }));

  advancements.push(buildSubclassAdvancement(classIdentifier));

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

    if (feature.normalizedName === SPECIAL_CLASS_FEATURES.ABILITY_SCORE_IMPROVEMENT) {
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

  return advancements;
}

function buildSubclassAdvancements(subclass, context) {
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

  return advancements;
}

function createClassSystem(classData, advancement = [], sourceLabel = DEFAULT_SOURCE_LABEL) {
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
      denomination: DEFAULT_HD,
      spent: 0
    },
    primaryAbility: {
      value: ["str"],
      all: false
    },
    properties: [],
    spellcasting: {
      progression: "none",
      ability: ""
    },
    startingEquipment: [],
    wealth: "2d4*10",
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

function createFeatureEntryData(feature, folderIdByPath) {
  const folderPath = feature.folderPath.join("/");
  const featureAutomation = createFeatureAutomation(feature, feature.classIdentifier);
  return {
    name: feature.name,
    type: "feat",
    img: DEFAULT_FEATURE_ICON,
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: createFeatureSystem(feature, feature.classIdentifier, featureAutomation),
    effects: foundry.utils.deepClone(featureAutomation.effects),
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: feature.sourceType,
        classIdentifier: feature.classIdentifier,
        subclassId: feature.subclassId,
        featureId: feature.featureId,
        requiredLevel: feature.requiredLevel,
        optional: feature.optional === true,
        signature: buildFeatureSignature(feature),
        automation: feature.sourceType === "rageAction"
          ? { type: "rageAction", requiredLevel: feature.requiredLevel }
          : undefined
      }
    }
  };
}

function createSubclassEntryData(entry, folderIdByPath) {
  const folderPath = entry.folderPath.join("/");
  return {
    name: entry.subclass.name,
    type: "subclass",
    img: DEFAULT_SUBCLASS_ICON,
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

function createClassEntryData(entry, folderIdByPath) {
  const folderPath = entry.folderPath.join("/");
  return {
    name: entry.classData.name,
    type: "class",
    img: DEFAULT_CLASS_ICON,
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

async function syncClassFeaturePack(featureDefinitions) {
  const pack = await ensurePack(CLASS_FEATURES_PACK_ID, createPackMetadata({
    name: CLASS_FEATURES_COMPENDIUM_NAME,
    label: CLASS_FEATURES_COMPENDIUM_LABEL,
    itemTypes: ["feat"]
  }));

  const features = featureDefinitions.map((feature) => ({
    ...feature,
    signature: buildFeatureSignature(feature)
  }));
  const documents = await getPackDocuments(pack);
  if (shouldRebuildManagedPack(documents, features, "featureId")) {
    await deleteManagedDocuments(pack, documents);
    await createManagedDocuments(pack, features, createFeatureEntryData);
  }

  const activePack = game.packs.get(CLASS_FEATURES_PACK_ID) ?? pack;
  const featureDocuments = await getPackDocuments(activePack);
  const featureUuidById = new Map();

  for (const document of featureDocuments) {
    if (!document.getFlag(MODULE_ID, "managed")) {
      continue;
    }

    const featureId = cleanString(document.getFlag(MODULE_ID, "featureId"));
    if (!featureId) {
      continue;
    }

    featureUuidById.set(featureId, document.uuid);
  }

  return {
    pack: activePack,
    featureUuidById
  };
}

async function syncSubclassesPack(normalizedData, context) {
  const pack = await ensurePack(SUBCLASSES_PACK_ID, createPackMetadata({
    name: SUBCLASSES_COMPENDIUM_NAME,
    label: SUBCLASSES_COMPENDIUM_LABEL,
    itemTypes: ["subclass"]
  }));

  const classIdentifier = normalizedData.classData.identifier;
  const subclassEntries = normalizedData.subclasses.map((subclass) => {
    const advancement = buildSubclassAdvancements(subclass, context);
    const system = createSubclassSystem(subclass, classIdentifier, advancement, normalizedData.sourceLabel);
    return {
      subclass,
      classIdentifier,
      system,
      signature: buildSubclassSignature(subclass, system, {
        classIdentifier,
        sourceLabel: normalizedData.sourceLabel,
        featureIds: subclass.features.map((feature) => feature.featureId)
      }),
      folderPath: normalizeFolderPath([SUBCLASS_ROOT_FOLDER, normalizedData.classData.name])
    };
  });

  const documents = await getPackDocuments(pack);
  const entriesForComparison = subclassEntries.map((entry) => ({
    subclassId: entry.subclass.subclassId,
    signature: entry.signature
  }));

  if (shouldRebuildManagedPack(documents, entriesForComparison, "subclassId")) {
    await deleteManagedDocuments(pack, documents);
    await createManagedDocuments(pack, subclassEntries, createSubclassEntryData);
  }

  return game.packs.get(SUBCLASSES_PACK_ID) ?? pack;
}

async function syncClassesPack(normalizedData, context) {
  const pack = await ensurePack(CLASSES_PACK_ID, createPackMetadata({
    name: CLASSES_COMPENDIUM_NAME,
    label: CLASSES_COMPENDIUM_LABEL,
    itemTypes: ["class"]
  }));

  const classFeatures = normalizedData.classData.features;
  const rageActions = normalizedData.rageActions;
  const classAdvancement = buildClassAdvancement(normalizedData.classData, {
    featureUuidById: context.featureUuidById,
    classFeatureEntries: classFeatures,
    rageActionEntries: rageActions,
    minorFeatUuids: context.minorFeatUuids,
    rageProgression: normalizedData.rageProgression,
    rageDamageProgression: normalizedData.rageDamageProgression
  });
  const classSystem = createClassSystem(normalizedData.classData, classAdvancement, normalizedData.sourceLabel);
  const classEntry = {
    classData: normalizedData.classData,
    system: classSystem,
    signature: buildClassSignature(normalizedData.classData, classSystem, {
      sourceLabel: normalizedData.sourceLabel,
      featureIds: classFeatures.map((feature) => feature.featureId)
    }),
    folderPath: normalizeFolderPath([CLASS_ROOT_FOLDER])
  };

  const documents = await getPackDocuments(pack);
  const entriesForComparison = [{
    classIdentifier: normalizedData.classData.identifier,
    signature: classEntry.signature
  }];
  if (shouldRebuildManagedPack(documents, entriesForComparison, "classIdentifier")) {
    await deleteManagedDocuments(pack, documents);
    await createManagedDocuments(pack, [classEntry], createClassEntryData);
  }

  return game.packs.get(CLASSES_PACK_ID) ?? pack;
}

async function loadData() {
  const rawData = await fetchJson(DATA_PATH);
  return normalizeBarbarianData(rawData);
}

export class ClassesCompendiumService {
  async sync() {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const normalizedData = await loadData();
    const featureDefinitions = buildFeatureDefinitions(normalizedData);
    const { pack: featuresPack, featureUuidById } = await syncClassFeaturePack(featureDefinitions);
    const minorFeatUuids = await buildMinorFeatPool();
    const subclassesPack = await syncSubclassesPack(normalizedData, {
      featureUuidById
    });
    const classesPack = await syncClassesPack(normalizedData, {
      featureUuidById,
      minorFeatUuids
    });

    return {
      classesPack,
      subclassesPack,
      featuresPack
    }
  }
}
