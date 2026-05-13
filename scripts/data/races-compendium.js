import {
  FEATS_COMPENDIUM_NAME,
  MODULE_ID,
  RACE_FEATURES_COMPENDIUM_LABEL,
  RACE_FEATURES_COMPENDIUM_NAME,
  RACES_COMPENDIUM_LABEL,
  RACES_COMPENDIUM_NAME
} from "../constants.js";
import { ensureCompendiumFolders, normalizeFolderPath } from "./compendium-utils.js";
import { buildSlug } from "./item-classification.js";

const DND5E_SYSTEM_ID = "dnd5e";
const SOURCE_LABEL = "Расы Тейванкаля V0.1";
const RACES_DATA_PATH = `modules/${MODULE_ID}/data/races-teyvankal-v01.json`;

const RACES_PACK_ID = `world.${RACES_COMPENDIUM_NAME}`;
const RACE_FEATURES_PACK_ID = `world.${RACE_FEATURES_COMPENDIUM_NAME}`;
const FEATS_PACK_ID = `world.${FEATS_COMPENDIUM_NAME}`;

const RACE_ROOT_FOLDER = "Расы Тейванкаля V0.1";
const RACE_FEATURE_ROOT_FOLDER = "Расовые умения Тейванкаля V0.1";

const DEFAULT_RACE_ICON = "icons/svg/mystery-man.svg";
const DEFAULT_FEATURE_ICON = "icons/svg/book.svg";

const RACES_TEMPLATE_VERSION = 1;
const RACE_FEATURE_TEMPLATE_VERSION = 1;

const NORMALIZED_HUMAN_NAME = "люди";
const NORMALIZED_MINOR_FEATS_SECTION = "младшие черты";
const NORMALIZED_RACIAL_FEATS_SECTION = "расовые черты";

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
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

function normalizeSize(value) {
  const token = normalizeMatchText(value);
  if (["tiny", "sm", "med", "lg", "huge", "grg"].includes(token)) {
    return token;
  }

  if (["маленький", "small"].includes(token)) {
    return "sm";
  }

  if (["большой", "large"].includes(token)) {
    return "lg";
  }

  return "med";
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function normalizeFields(rawFields) {
  if (!isPlainObject(rawFields)) {
    return {};
  }

  const fields = {};
  for (const [key, value] of Object.entries(rawFields)) {
    const normalizedKey = cleanString(key);
    const normalizedValue = cleanString(value);
    if (normalizedKey && normalizedValue) {
      fields[normalizedKey] = normalizedValue;
    }
  }

  return fields;
}

function uniqueIdentifier(base, usedIds, fallback) {
  const seed = cleanString(base, fallback);
  let identifier = seed;
  let duplicateIndex = 2;

  while (usedIds.has(identifier)) {
    identifier = `${seed}-${duplicateIndex}`;
    duplicateIndex += 1;
  }

  usedIds.add(identifier);
  return identifier;
}

function normalizeAbilityOption(rawOption, optionIndex, raceId, abilityId, usedOptionIds) {
  const optionName = cleanString(rawOption?.name, `Вариант ${optionIndex + 1}`);
  const optionBaseId = cleanString(rawOption?.id, buildSlug(optionName, `${abilityId}-option-${optionIndex + 1}`));
  const optionId = uniqueIdentifier(optionBaseId, usedOptionIds, `${abilityId}-option-${optionIndex + 1}`);

  return {
    id: optionId,
    name: optionName,
    description: cleanString(rawOption?.description),
    featureId: `${raceId}::${abilityId}::${optionId}`
  };
}

function normalizeAbility(rawAbility, abilityIndex, race, usedAbilityIds) {
  const abilityName = cleanString(rawAbility?.name, `Умение ${abilityIndex + 1}`);
  const abilityBaseId = cleanString(rawAbility?.id, buildSlug(abilityName, `${race.id}-ability-${abilityIndex + 1}`));
  const abilityId = uniqueIdentifier(abilityBaseId, usedAbilityIds, `${race.id}-ability-${abilityIndex + 1}`);
  const usedOptionIds = new Set();

  const options = (Array.isArray(rawAbility?.options) ? rawAbility.options : [])
    .map((option, optionIndex) => normalizeAbilityOption(option, optionIndex, race.id, abilityId, usedOptionIds))
    .filter((option) => option.name);

  return {
    id: abilityId,
    name: abilityName,
    description: cleanString(rawAbility?.description),
    kind: cleanString(rawAbility?.kind, "minor"),
    options,
    featureId: `${race.id}::${abilityId}`
  };
}

function normalizeRace(rawRace, raceIndex, usedRaceIds) {
  const raceName = cleanString(rawRace?.name, `Раса ${raceIndex + 1}`);
  const raceBaseId = cleanString(rawRace?.id, buildSlug(raceName, `race-${raceIndex + 1}`));
  const raceId = uniqueIdentifier(raceBaseId, usedRaceIds, `race-${raceIndex + 1}`);
  const usedAbilityIds = new Set();
  const abilities = (Array.isArray(rawRace?.abilities) ? rawRace.abilities : [])
    .map((ability, abilityIndex) => normalizeAbility(ability, abilityIndex, { id: raceId }, usedAbilityIds))
    .filter((ability) => ability.name);

  const raceFeatNames = unique((Array.isArray(rawRace?.raceFeatNames) ? rawRace.raceFeatNames : [])
    .map((name) => cleanString(name))
    .filter(Boolean));

  return {
    id: raceId,
    name: raceName,
    group: cleanString(rawRace?.group, "Без группы"),
    size: normalizeSize(rawRace?.size),
    speed: Math.max(0, Math.floor(parseNumber(rawRace?.speed, 30))),
    darkvision: Math.max(0, Math.floor(parseNumber(rawRace?.darkvision, 0))),
    fields: normalizeFields(rawRace?.fields),
    abilities,
    raceFeatNames
  };
}

function normalizeRaces(rawRaces = []) {
  const usedRaceIds = new Set();
  return (Array.isArray(rawRaces) ? rawRaces : [])
    .map((race, index) => normalizeRace(race, index, usedRaceIds))
    .filter((race) => race.name);
}

function buildRaceDescription(race) {
  const sections = [];
  sections.push("<h2>Особенности расы</h2>");

  const fieldLabels = new Map([
    ["age", "Возраст"],
    ["size", "Размер"],
    ["weight", "Вес"],
    ["abilityIncrease", "Повышение характеристик"],
    ["speed", "Скорость"],
    ["languages", "Языки"],
    ["raceFeat", "Расовые черты"]
  ]);

  for (const [key, label] of fieldLabels.entries()) {
    const value = race.fields?.[key];
    if (!value) {
      continue;
    }

    sections.push(`<h3>${escapeHtml(label)}</h3>`);
    sections.push(toHtmlParagraphs(value));
  }

  if (race.abilities.length) {
    const abilityRows = race.abilities.map((ability) => {
      const optionList = ability.options.length
        ? `<ul>${ability.options.map((option) => (
          `<li><strong>${escapeHtml(option.name)}.</strong> ${escapeHtml(option.description)}</li>`
        )).join("")}</ul>`
        : "";

      return `<li><strong>${escapeHtml(ability.name)}.</strong> ${escapeHtml(ability.description)}${optionList}</li>`;
    }).join("");

    sections.push("<h3>Умения</h3>");
    sections.push(`<ul>${abilityRows}</ul>`);
  }

  return sections.join("\n");
}

function buildFeatureDescription(race, ability, option = null) {
  if (option) {
    const rows = [
      `<p><strong>${escapeHtml(ability.name)}</strong></p>`,
      toHtmlParagraphs(option.description || ability.description)
    ];
    return rows.join("\n");
  }

  const rows = [];
  if (ability.description) {
    rows.push(toHtmlParagraphs(ability.description));
  }

  if (ability.options.length) {
    rows.push("<p><strong>Доступные варианты:</strong></p>");
    rows.push(`<ul>${ability.options.map((entry) => `<li>${escapeHtml(entry.name)}</li>`).join("")}</ul>`);
  }

  return rows.join("\n");
}

function buildFeatureDefinitions(races) {
  const definitions = [];

  for (const race of races) {
    for (const ability of race.abilities) {
      definitions.push({
        featureId: ability.featureId,
        raceId: race.id,
        raceName: race.name,
        group: race.group,
        abilityId: ability.id,
        optionId: null,
        name: ability.name,
        description: buildFeatureDescription(race, ability),
        identifier: buildAsciiIdentifier(
          `${race.id}-${ability.id}-${ability.name}`,
          `${race.id}::${ability.id}`
        ),
        folderPath: normalizeFolderPath([RACE_FEATURE_ROOT_FOLDER, race.group, race.name])
      });

      for (const option of ability.options) {
        definitions.push({
          featureId: option.featureId,
          raceId: race.id,
          raceName: race.name,
          group: race.group,
          abilityId: ability.id,
          optionId: option.id,
          name: option.name,
          description: buildFeatureDescription(race, ability, option),
          identifier: buildAsciiIdentifier(
            `${race.id}-${ability.id}-${option.id}-${option.name}`,
            `${race.id}::${ability.id}::${option.id}`
          ),
          folderPath: normalizeFolderPath([RACE_FEATURE_ROOT_FOLDER, race.group, race.name])
        });
      }
    }
  }

  return definitions;
}

function buildFeatureSignature(feature) {
  return JSON.stringify({
    templateVersion: RACE_FEATURE_TEMPLATE_VERSION,
    featureId: feature.featureId,
    raceId: feature.raceId,
    raceName: feature.raceName,
    group: feature.group,
    abilityId: feature.abilityId,
    optionId: feature.optionId,
    name: feature.name,
    description: feature.description,
    identifier: feature.identifier
  });
}

function buildRaceSignature(race, system) {
  return JSON.stringify({
    templateVersion: RACES_TEMPLATE_VERSION,
    raceId: race.id,
    name: race.name,
    group: race.group,
    size: race.size,
    speed: race.speed,
    darkvision: race.darkvision,
    fields: race.fields,
    raceFeatNames: race.raceFeatNames,
    abilities: race.abilities,
    system
  });
}

function createFeatureSystem(feature) {
  return {
    description: {
      value: cleanString(feature.description),
      chat: ""
    },
    source: {
      custom: SOURCE_LABEL
    },
    identifier: buildAsciiIdentifier(feature.identifier, feature.featureId),
    type: {
      value: "feat",
      subtype: ""
    },
    requirements: null,
    prerequisites: {
      items: [],
      level: 0,
      repeatable: false
    },
    properties: [],
    activities: {},
    uses: {
      spent: 0,
      max: "",
      recovery: []
    },
    advancement: []
  };
}

function createRaceSystem(race, advancement = []) {
  const senses = {};
  if (race.darkvision > 0) {
    senses.darkvision = race.darkvision;
  }

  return {
    description: {
      value: buildRaceDescription(race),
      chat: ""
    },
    source: {
      custom: SOURCE_LABEL
    },
    movement: {
      walk: Math.max(0, race.speed)
    },
    senses,
    type: {
      value: normalizeMatchText(race.name) === "големы" ? "construct" : "humanoid"
    },
    advancement: foundry.utils.deepClone(advancement)
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
        sourceBook: SOURCE_LABEL,
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

function buildAdvancementSize(race) {
  return {
    _id: stableHashId(`${race.id}:size`, "adv"),
    type: "Size",
    title: "Размер",
    hint: "Выберите размер персонажа, если раса допускает несколько вариантов.",
    level: 0,
    configuration: {
      sizes: [race.size]
    },
    value: {}
  };
}

function buildAdvancementItemGrant(race, itemUuids = []) {
  const items = unique(itemUuids).map((uuid) => ({ uuid, optional: false }));
  return {
    _id: stableHashId(`${race.id}:grant-base`, "adv"),
    type: "ItemGrant",
    title: "Расовые умения",
    hint: "Базовые расовые умения, получаемые автоматически.",
    level: 0,
    configuration: {
      items,
      optional: false,
      spell: null
    },
    value: {}
  };
}

function buildAdvancementItemChoice({
  race,
  seed,
  title,
  hint,
  level = 0,
  count = 1,
  pool = []
}) {
  const normalizedPool = unique(pool).map((uuid) => ({ uuid }));
  return {
    _id: stableHashId(`${race.id}:${seed}`, "adv"),
    type: "ItemChoice",
    title: cleanString(title, "Выбор умения"),
    hint: cleanString(hint),
    configuration: {
      allowDrops: false,
      choices: {
        [String(level)]: {
          count: Math.max(0, Math.floor(parseNumber(count, 1))),
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
  if (!normalizedName) {
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

function isHumanRace(race) {
  return normalizeMatchText(race.id) === NORMALIZED_HUMAN_NAME
    || normalizeMatchText(race.name) === NORMALIZED_HUMAN_NAME;
}

function buildRaceFeatHint(race, missing = []) {
  const available = race.raceFeatNames.filter((name) => !missing.includes(name));
  const rows = [];
  if (available.length) {
    rows.push(`Доступны следующие расовые черты: ${available.join(", ")}.`);
  }

  if (missing.length) {
    rows.push(`Не найдены в компендиуме черт: ${missing.join(", ")}.`);
  }

  return rows.join(" ");
}

function buildRaceAdvancement(race, {
  featureUuidById = new Map(),
  minorFeatUuids = [],
  featLookupByName = new Map()
} = {}) {
  const advancement = [buildAdvancementSize(race)];

  const baseFeatureUuids = race.abilities
    .map((ability) => featureUuidById.get(ability.featureId))
    .filter(Boolean);
  if (baseFeatureUuids.length) {
    advancement.push(buildAdvancementItemGrant(race, baseFeatureUuids));
  }

  for (const ability of race.abilities) {
    if (!ability.options.length) {
      continue;
    }

    const optionUuids = ability.options
      .map((option) => featureUuidById.get(option.featureId))
      .filter(Boolean);
    if (!optionUuids.length) {
      continue;
    }

    advancement.push(buildAdvancementItemChoice({
      race,
      seed: `choice:${ability.id}`,
      title: ability.name,
      hint: ability.description,
      level: 0,
      count: 1,
      pool: optionUuids
    }));
  }

  if (isHumanRace(race) && minorFeatUuids.length) {
    advancement.push(buildAdvancementItemChoice({
      race,
      seed: "human-level-1-feat",
      title: "Черта 1-го уровня",
      hint: "Выберите одну младшую черту из внутренней библиотеки черт модуля.",
      level: 1,
      count: 1,
      pool: minorFeatUuids
    }));
  }

  if (race.raceFeatNames.length) {
    const resolvedUuids = [];
    const missing = [];

    for (const featName of race.raceFeatNames) {
      const match = resolveFeatByName(featName, featLookupByName, NORMALIZED_RACIAL_FEATS_SECTION);
      if (match?.uuid) {
        resolvedUuids.push(match.uuid);
      }
      else {
        missing.push(featName);
      }
    }

    const uniqueRaceFeatUuids = unique(resolvedUuids);
    if (uniqueRaceFeatUuids.length) {
      advancement.push(buildAdvancementItemChoice({
        race,
        seed: "racial-feat-level-6",
        title: "Расовая черта (6-й уровень)",
        hint: buildRaceFeatHint(race, missing),
        level: 6,
        count: 1,
        pool: uniqueRaceFeatUuids
      }));
    }

    if (missing.length) {
      console.warn(`${MODULE_ID} | Missing racial feats for '${race.name}':`, missing);
    }
  }

  return advancement;
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
    fields: ["flags.teyvankal.section"]
  });
  const byName = new Map();
  const minorFeatUuids = [];

  for (const row of index) {
    const record = normalizeFeatIndexRecord(row, pack);
    if (!record.uuid || !record.normalizedName) {
      continue;
    }

    if (!byName.has(record.normalizedName)) {
      byName.set(record.normalizedName, []);
    }
    byName.get(record.normalizedName).push(record);

    if (record.section === NORMALIZED_MINOR_FEATS_SECTION) {
      minorFeatUuids.push(record.uuid);
    }
  }

  const normalizedMinorFeatUuids = unique(minorFeatUuids);
  if (!normalizedMinorFeatUuids.length) {
    return {
      minorFeatUuids: unique(Array.from(byName.values()).flat().map((entry) => entry.uuid)),
      byName
    };
  }

  return {
    minorFeatUuids: normalizedMinorFeatUuids,
    byName
  };
}

function createFeatureEntryData(feature, folderIdByPath) {
  const folderPath = feature.folderPath.join("/");
  return {
    name: feature.name,
    type: "feat",
    img: DEFAULT_FEATURE_ICON,
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: createFeatureSystem(feature),
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "raceFeature",
        raceId: feature.raceId,
        abilityId: feature.abilityId,
        optionId: feature.optionId,
        featureId: feature.featureId,
        signature: buildFeatureSignature(feature)
      }
    }
  };
}

function createRaceEntryData(entry, folderIdByPath) {
  const folderPath = entry.folderPath.join("/");
  return {
    name: entry.race.name,
    type: "race",
    img: DEFAULT_RACE_ICON,
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: foundry.utils.deepClone(entry.system),
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "race",
        raceId: entry.race.id,
        signature: entry.signature
      }
    }
  };
}

async function loadRacesData() {
  const rawData = await fetchJson(RACES_DATA_PATH);
  return normalizeRaces(rawData?.races ?? []);
}

async function syncRaceFeaturePack(featureDefinitions) {
  const pack = await ensurePack(RACE_FEATURES_PACK_ID, createPackMetadata({
    name: RACE_FEATURES_COMPENDIUM_NAME,
    label: RACE_FEATURES_COMPENDIUM_LABEL,
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

  const activePack = game.packs.get(RACE_FEATURES_PACK_ID) ?? pack;
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

async function syncRacesPack(races, context) {
  const pack = await ensurePack(RACES_PACK_ID, createPackMetadata({
    name: RACES_COMPENDIUM_NAME,
    label: RACES_COMPENDIUM_LABEL,
    itemTypes: ["race"]
  }));

  const raceEntries = races.map((race) => {
    const advancement = buildRaceAdvancement(race, context);
    const system = createRaceSystem(race, advancement);
    return {
      race,
      system,
      signature: buildRaceSignature(race, system),
      folderPath: normalizeFolderPath([RACE_ROOT_FOLDER, race.group])
    };
  });

  const documents = await getPackDocuments(pack);
  const entriesForComparison = raceEntries.map((entry) => ({
    raceId: entry.race.id,
    signature: entry.signature
  }));

  if (shouldRebuildManagedPack(documents, entriesForComparison, "raceId")) {
    await deleteManagedDocuments(pack, documents);
    await createManagedDocuments(pack, raceEntries, createRaceEntryData);
  }

  return game.packs.get(RACES_PACK_ID) ?? pack;
}

export class RacesCompendiumService {
  async sync() {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const races = await loadRacesData();
    const featureDefinitions = buildFeatureDefinitions(races);
    const { pack: featuresPack, featureUuidById } = await syncRaceFeaturePack(featureDefinitions);
    const featLookup = await buildFeatLookup();
    const racesPack = await syncRacesPack(races, {
      featureUuidById,
      minorFeatUuids: featLookup.minorFeatUuids,
      featLookupByName: featLookup.byName
    });

    return {
      racesPack,
      featuresPack
    };
  }
}
