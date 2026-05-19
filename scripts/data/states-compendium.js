import {
  FEATS_COMPENDIUM_NAME,
  MODULE_ID,
  STATES_COMPENDIUM_LABEL,
  STATES_COMPENDIUM_NAME,
  STATE_ITEM_TYPE,
  TEYVANKAL_STATE_LANGUAGE_GROUP_ID,
  TEYVANKAL_STATE_LANGUAGES
} from "../constants.js";
import { bringAppToFront } from "../ui.js";
import {
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath
} from "./compendium-utils.js";
import { buildSlug } from "./item-classification.js";

const PACK_ID = `world.${STATES_COMPENDIUM_NAME}`;
const FEATS_PACK_ID = `world.${FEATS_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const SOURCE_LABEL = "ЗоЗТ";
const STATES_DATA_PATH = `modules/${MODULE_ID}/data/states-teyvankal-v02.json`;
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const STATES_ROOT_FOLDER = "Государства Тейванкаля";
const DEFAULT_STATE_ICON = "icons/svg/city.svg";
const STATE_TEMPLATE_VERSION = 3;
const STATE_LANGUAGE_ID_BY_LABEL = new Map(
  TEYVANKAL_STATE_LANGUAGES.map((language) => [normalizeMatchText(language.label), language.id])
);

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

function normalizeStateLanguages(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    native: cleanString(source.native),
    dominant: cleanString(source.dominant)
  };
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

function buildAsciiIdentifier(value, fallbackSeed = "state") {
  const base = String(value ?? "")
    .toLowerCase()
    .replace(/[^\x00-\x7F]+/gu, " ")
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "")
    .slice(0, 40);
  const hash = stableHashId(`${value}:${fallbackSeed}`, "identifier").slice(0, 8);

  return `${base || "rb-state"}-${hash}`;
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function normalizeState(rawState = {}, index = 0) {
  const source = isPlainObject(rawState) ? rawState : {};
  const name = cleanString(source.name, `Государство ${index + 1}`);
  const fallbackId = `state-${buildSlug(name, `state-${index + 1}`)}`;

  return {
    id: cleanString(source.id, fallbackId),
    name,
    shortName: cleanString(source.shortName),
    rank: Math.max(0, Math.floor(parseNumber(source.rank, 0))),
    continent: cleanString(source.continent),
    government: cleanString(source.government),
    techLevel: cleanString(source.techLevel),
    army: cleanString(source.army),
    magic: cleanString(source.magic),
    description: cleanString(source.description),
    details: cleanString(source.details),
    languages: normalizeStateLanguages(source.languages),
    tags: unique(Array.isArray(source.tags) ? source.tags.map((entry) => cleanString(entry)) : []),
    culturalFeatNames: unique(Array.isArray(source.culturalFeatNames) ? source.culturalFeatNames.map((entry) => cleanString(entry)) : []),
    manualNotes: unique(Array.isArray(source.manualNotes) ? source.manualNotes.map((entry) => cleanString(entry)) : [])
  };
}

function buildStateFolderPath(state) {
  return normalizeFolderPath([STATES_ROOT_FOLDER, state.continent || "Без континента"]);
}

function addDescriptionBlock(rows, title, content) {
  const safeContent = cleanString(content);
  if (!safeContent) {
    return;
  }

  rows.push(`<h3>${escapeHtml(title)}</h3>${toHtmlParagraphs(safeContent)}`);
}

function addInlineDescriptionBlock(rows, title, content) {
  const safeContent = cleanString(content);
  if (!safeContent) {
    return;
  }

  rows.push(`<p><strong>${escapeHtml(title)}.</strong> ${escapeHtml(safeContent).replace(/\n/gu, "<br>")}</p>`);
}

function buildCulturalFeatList(names = []) {
  const rows = unique(names).map((name) => `<li>${escapeHtml(name)}</li>`);
  return rows.length ? `<ul>${rows.join("")}</ul>` : "";
}

function buildStateDescription(state, culturalFeatResolution = null) {
  const rows = [];
  addDescriptionBlock(rows, "Описание", state.description);
  addDescriptionBlock(rows, "Подробности", state.details);
  addInlineDescriptionBlock(rows, "Ранг", state.rank ? String(state.rank) : "");
  addInlineDescriptionBlock(rows, "Континент", state.continent);
  addInlineDescriptionBlock(rows, "Форма правления", state.government);
  addInlineDescriptionBlock(rows, "Технологический уровень", state.techLevel);
  addInlineDescriptionBlock(rows, "Армия", state.army);
  addInlineDescriptionBlock(rows, "Волшебство", state.magic);
  addInlineDescriptionBlock(rows, "Родной язык", state.languages.native);
  addInlineDescriptionBlock(rows, "Доминирующий язык", state.languages.dominant);

  if (state.culturalFeatNames.length) {
    rows.push(`<h3>Культурные черты</h3><p>Персонаж может выбрать до двух культурных черт, связанных с этим государством.</p>${buildCulturalFeatList(state.culturalFeatNames)}`);
  }

  const missingNames = culturalFeatResolution?.missingNames ?? [];
  if (missingNames.length) {
    addDescriptionBlock(rows, "Требует проверки", `Не найдены культурные черты в компендиуме: ${missingNames.join(", ")}.`);
  }

  if (state.manualNotes.length) {
    rows.push(`<h3>Примечания импорта</h3><ul>${state.manualNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`);
  }

  return rows.join("\n");
}

function toStateLanguageTraitKey(languageName) {
  const languageId = STATE_LANGUAGE_ID_BY_LABEL.get(normalizeMatchText(languageName));
  return languageId ? `languages:${TEYVANKAL_STATE_LANGUAGE_GROUP_ID}:${languageId}` : "";
}

function buildStateLanguageAdvancement(state) {
  const languageTraitKey = toStateLanguageTraitKey(state.languages.native);
  if (!languageTraitKey) {
    if (state.languages.native) {
      console.warn(`${MODULE_ID} | Unknown native state language for '${state.name}': ${state.languages.native}`);
    }

    return null;
  }

  return {
    _id: stableHashId(`${state.id}:native-language`, "adv"),
    type: "Trait",
    title: "Родной язык",
    hint: `Выберите родной язык государства: ${state.languages.native}.`,
    level: 1,
    configuration: {
      allowReplacements: false,
      mode: "default",
      grants: [],
      choices: [
        {
          count: 1,
          pool: [languageTraitKey]
        }
      ]
    },
    value: {}
  };
}

function buildCulturalFeatChoiceAdvancement(state, culturalFeatResolution) {
  const itemUuids = unique(culturalFeatResolution?.itemUuids ?? []);
  if (!itemUuids.length) {
    return null;
  }

  const count = Math.min(2, itemUuids.length);
  return {
    _id: stableHashId(`${state.id}:cultural-feats`, "adv"),
    type: "ItemChoice",
    title: "Культурные черты",
    hint: "Выберите до двух культурных черт, связанных с родным государством персонажа.",
    level: 1,
    configuration: {
      allowDrops: false,
      choices: {
        "1": {
          count,
          replacement: false
        }
      },
      pool: itemUuids.map((uuid) => ({ uuid })),
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

function createStateSystem(state, advancement, culturalFeatResolution = null) {
  return {
    description: {
      value: buildStateDescription(state, culturalFeatResolution),
      chat: ""
    },
    source: {
      custom: SOURCE_LABEL
    },
    identifier: buildAsciiIdentifier(state.id, state.name),
    advancement: foundry.utils.deepClone(advancement)
  };
}

function buildStateSignature(entry) {
  return JSON.stringify({
    templateVersion: STATE_TEMPLATE_VERSION,
    stateId: entry.state.id,
    name: entry.state.name,
    rank: entry.state.rank,
    sourceLabel: SOURCE_LABEL,
    state: entry.state,
    culturalFeatUuids: entry.culturalFeatResolution.itemUuids,
    missingCulturalFeatNames: entry.culturalFeatResolution.missingNames,
    system: entry.system
  });
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

async function loadStatesData() {
  const data = await fetchJson(STATES_DATA_PATH);
  return (Array.isArray(data?.states) ? data.states : [])
    .map((state, index) => normalizeState(state, index))
    .filter((state) => state.name);
}

function isStateItemTypeAvailable() {
  if (game.documentTypes?.Item?.includes?.(STATE_ITEM_TYPE)) {
    return true;
  }

  return Boolean(game.model?.Item?.[STATE_ITEM_TYPE]);
}

function getDesiredPackMetadata() {
  return {
    label: STATES_COMPENDIUM_LABEL,
    type: "Item",
    name: STATES_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: SOURCE_LABEL,
        types: [STATE_ITEM_TYPE]
      }
    }
  };
}

async function ensurePack() {
  const desired = getDesiredPackMetadata();
  let pack = game.packs.get(PACK_ID);

  if (pack && pack.documentName !== desired.type) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (pack && desired.system && pack.metadata.system !== desired.system) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (!pack) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium(desired);
  }

  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign states compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
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

function shouldRebuildPack(entries, documents) {
  const managedDocuments = documents.filter((document) => document.getFlag(MODULE_ID, "managed"));
  if (managedDocuments.length !== entries.length) {
    return true;
  }

  const byId = new Map(entries.map((entry) => [entry.state.id, entry]));
  for (const document of managedDocuments) {
    const stateId = cleanString(document.getFlag(MODULE_ID, "stateId"));
    const expected = byId.get(stateId);
    if (!expected) {
      return true;
    }

    if (document.getFlag(MODULE_ID, "signature") !== expected.signature) {
      return true;
    }
  }

  return false;
}

function createStateItemData(entry, folderIdByPath) {
  const folderPath = entry.folderPath.join("/");
  const missingCulturalFeats = entry.culturalFeatResolution.missingNames;

  return {
    name: entry.state.name,
    type: STATE_ITEM_TYPE,
    img: DEFAULT_STATE_ICON,
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: foundry.utils.deepClone(entry.system),
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "state",
        stateId: entry.state.id,
        rank: entry.state.rank,
        continent: entry.state.continent,
        nativeLanguage: entry.state.languages.native,
        dominantLanguage: entry.state.languages.dominant,
        culturalFeatNames: entry.state.culturalFeatNames.join(", "),
        unresolvedCulturalFeats: missingCulturalFeats.length ? missingCulturalFeats : null,
        signature: entry.signature
      }
    }
  };
}

async function createManagedDocuments(pack, entries) {
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
    console.warn(`${MODULE_ID} | Failed to prepare compendium folders for states pack.`, error);
  }

  await Item.implementation.createDocuments(
    entries.map((entry) => createStateItemData(entry, folderIdByPath)),
    { pack: pack.collection }
  );
}

function normalizeFeatIndexRecord(record, pack) {
  const id = cleanString(record?._id ?? record?.id);
  const fallbackUuid = id ? `Compendium.${pack.collection}.Item.${id}` : "";
  return {
    id,
    uuid: cleanString(record?.uuid, fallbackUuid),
    name: cleanString(record?.name),
    normalizedName: normalizeMatchText(record?.name),
    section: normalizeMatchText(foundry.utils.getProperty(record, "flags.teyvankal.section")),
    sectionKey: normalizeMatchText(foundry.utils.getProperty(record, "flags.teyvankal.sectionKey"))
  };
}

async function buildFeatLookup() {
  const pack = game.packs.get(FEATS_PACK_ID);
  if (!pack) {
    return new Map();
  }

  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.featId`, "flags.teyvankal.section", "flags.teyvankal.sectionKey"]
  });
  const byName = new Map();

  for (const row of index) {
    const record = normalizeFeatIndexRecord(row, pack);
    if (!record.uuid || !record.normalizedName) {
      continue;
    }

    if (!byName.has(record.normalizedName)) {
      byName.set(record.normalizedName, []);
    }
    byName.get(record.normalizedName).push(record);
  }

  return byName;
}

function pickPreferredCulturalFeat(records = []) {
  const list = Array.isArray(records) ? records.filter((entry) => entry?.uuid) : [];
  if (!list.length) {
    return null;
  }

  return list.find((entry) => entry.sectionKey === "cultural" || entry.section === "культурные черты") ?? list[0];
}

function resolveFeatByName(name, featLookupByName) {
  const normalizedName = normalizeMatchText(name);
  if (!normalizedName) {
    return null;
  }

  const direct = pickPreferredCulturalFeat(featLookupByName.get(normalizedName));
  if (direct) {
    return direct;
  }

  for (const [candidateName, records] of featLookupByName.entries()) {
    if (candidateName.includes(normalizedName) || normalizedName.includes(candidateName)) {
      return pickPreferredCulturalFeat(records);
    }
  }

  return null;
}

function resolveCulturalFeats(state, featLookupByName) {
  const names = unique(state.culturalFeatNames);
  const itemUuids = [];
  const missingNames = [];

  for (const featName of names) {
    const record = resolveFeatByName(featName, featLookupByName);
    if (record?.uuid) {
      itemUuids.push(record.uuid);
    }
    else {
      missingNames.push(featName);
    }
  }

  if (missingNames.length) {
    console.warn(`${MODULE_ID} | Missing cultural feats for state '${state.name}':`, missingNames);
  }

  return {
    names,
    itemUuids: unique(itemUuids),
    missingNames
  };
}

function prepareStateEntries(states, featLookupByName) {
  return states.map((state) => {
    const culturalFeatResolution = resolveCulturalFeats(state, featLookupByName);
    const advancement = [
      buildStateLanguageAdvancement(state),
      buildCulturalFeatChoiceAdvancement(state, culturalFeatResolution)
    ].filter(Boolean);
    const system = createStateSystem(state, advancement, culturalFeatResolution);
    const entry = {
      state,
      culturalFeatResolution,
      system,
      folderPath: buildStateFolderPath(state),
      signature: ""
    };
    entry.signature = buildStateSignature(entry);
    return entry;
  });
}

async function findStateDocument(pack, stateId, fallbackName = "") {
  const normalizedStateId = cleanString(stateId);
  const normalizedFallbackName = normalizeMatchText(fallbackName);

  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.stateId`, `flags.${MODULE_ID}.rank`, `flags.${MODULE_ID}.continent`]
  });
  const indexEntry = index.find((entry) => {
    const entryStateId = cleanString(foundry.utils.getProperty(entry, `flags.${MODULE_ID}.stateId`));
    if (normalizedStateId && entryStateId === normalizedStateId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  });

  if (indexEntry) {
    return pack.getDocument(indexEntry._id ?? indexEntry.id);
  }

  const documents = await pack.getDocuments();
  return documents.find((entry) => {
    const entryStateId = cleanString(entry.getFlag(MODULE_ID, "stateId"));
    if (normalizedStateId && entryStateId === normalizedStateId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  }) ?? null;
}

export class StatesCompendiumService {
  async sync() {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    if (!isStateItemTypeAvailable()) {
      console.warn(`${MODULE_ID} | State item type '${STATE_ITEM_TYPE}' is not registered yet. Restart Foundry or reload the world after updating module.json.`);
      ui.notifications?.warn("Тип предмета «Государство» ещё не зарегистрирован. Перезапустите мир после обновления модуля.");
      return null;
    }

    const states = await loadStatesData();
    const featLookupByName = await buildFeatLookup();
    const entries = prepareStateEntries(states, featLookupByName);
    const pack = await ensurePack();
    const documents = await getPackDocuments(pack);

    if (!shouldRebuildPack(entries, documents)) {
      return game.packs.get(PACK_ID) ?? pack;
    }

    await deleteManagedDocuments(pack, documents);
    await createManagedDocuments(pack, entries);
    return game.packs.get(PACK_ID) ?? pack;
  }

  async getStateDocument(stateId, fallbackName = "") {
    const pack = game.packs.get(PACK_ID);
    if (!pack) {
      return null;
    }

    return findStateDocument(pack, stateId, fallbackName);
  }

  async openState(stateId, fallbackName = "") {
    const document = await this.getStateDocument(stateId, fallbackName);
    if (!document) {
      ui.notifications?.warn("Государство Rebreya не найдено.");
      return null;
    }

    await document.sheet?.render?.(true);
    bringAppToFront(document.sheet);
    window.setTimeout(() => bringAppToFront(document.sheet), 40);
    window.setTimeout(() => bringAppToFront(document.sheet), 140);
    return document;
  }
}
