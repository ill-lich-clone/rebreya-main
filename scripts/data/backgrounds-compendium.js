import {
  BACKGROUNDS_COMPENDIUM_LABEL,
  BACKGROUNDS_COMPENDIUM_NAME,
  FEATS_COMPENDIUM_NAME,
  MODULE_ID
} from "../constants.js";
import { bringAppToFront } from "../ui.js";
import {
  buildNamedIconLookup,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath,
  resolveNamedIcon
} from "./compendium-utils.js";
import { buildSlug } from "./item-classification.js";

const PACK_ID = `world.${BACKGROUNDS_COMPENDIUM_NAME}`;
const FEATS_PACK_ID = `world.${FEATS_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const SOURCE_LABEL = "Предыстории V0.12";
const BACKGROUNDS_DATA_PATH = `modules/${MODULE_ID}/data/backgrounds-v012.json`;
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const BACKGROUND_ROOT_FOLDER = "Предыстории V0.12";
const DEFAULT_BACKGROUND_ICON = "systems/dnd5e/icons/svg/items/background.svg";
const MODULE_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const BACKGROUND_ICON_SEARCH_PATHS = [`${MODULE_ICONS_BASE_PATH}/Backgrounds`, MODULE_ICONS_BASE_PATH];
const BACKGROUND_TEMPLATE_VERSION = 1;
// The source level sorts backgrounds; dnd5e advancement must apply immediately when the background is added.
const BACKGROUND_ADVANCEMENT_LEVEL = 0;

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

function buildAsciiIdentifier(value, fallbackSeed = "background") {
  const base = String(value ?? "")
    .toLowerCase()
    .replace(/[^\x00-\x7F]+/gu, " ")
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "")
    .slice(0, 40);
  const hash = stableHashId(`${value}:${fallbackSeed}`, "identifier").slice(0, 8);

  return `${base || "rb-bg"}-${hash}`;
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function normalizeChoice(choice = {}) {
  return {
    count: Math.max(1, Math.floor(parseNumber(choice?.count, 1))),
    pool: unique(Array.isArray(choice?.pool) ? choice.pool.map((entry) => cleanString(entry)) : [])
  };
}

function normalizeProficiencyData(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    grants: unique(Array.isArray(source.grants) ? source.grants.map((entry) => cleanString(entry)) : []),
    choices: (Array.isArray(source.choices) ? source.choices : [])
      .map((choice) => normalizeChoice(choice))
      .filter((choice) => choice.pool.length)
  };
}

function normalizeBonusFeat(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    text: cleanString(source.text),
    names: unique(Array.isArray(source.names) ? source.names.map((entry) => cleanString(entry)) : [])
  };
}

function normalizeBackground(rawBackground = {}, index = 0) {
  const source = isPlainObject(rawBackground) ? rawBackground : {};
  const name = cleanString(source.name, `Предыстория ${index + 1}`);
  const level = Math.max(1, Math.floor(parseNumber(source.level, 1)));
  const fallbackId = `background-${level}-${buildSlug(name, `background-${index + 1}`)}`;

  return {
    id: cleanString(source.id, fallbackId),
    name,
    level,
    description: cleanString(source.description),
    skillText: cleanString(source.skillText),
    toolText: cleanString(source.toolText),
    languageText: cleanString(source.languageText),
    skillProficiencies: normalizeProficiencyData(source.skillProficiencies),
    toolProficiencies: normalizeProficiencyData(source.toolProficiencies),
    languageChoices: normalizeProficiencyData(source.languageChoices),
    equipmentText: cleanString(source.equipmentText),
    wealth: cleanString(source.wealth),
    bonusFeat: normalizeBonusFeat(source.bonusFeat),
    property: cleanString(source.property || source.assets),
    assets: cleanString(source.assets || source.property),
    family: cleanString(source.family),
    contacts: cleanString(source.contacts),
    organizations: cleanString(source.organizations),
    featureText: cleanString(source.featureText),
    rawText: cleanString(source.rawText),
    manualNotes: unique(Array.isArray(source.manualNotes) ? source.manualNotes.map((entry) => cleanString(entry)) : [])
  };
}

function levelFolderName(level) {
  return `${level}-й уровень`;
}

function buildBackgroundFolderPath(background) {
  return normalizeFolderPath([BACKGROUND_ROOT_FOLDER, levelFolderName(background.level)]);
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

function buildBackgroundDescription(background, bonusFeatResolution = null) {
  const rows = [];
  addDescriptionBlock(rows, "Описание", background.description);
  addInlineDescriptionBlock(rows, "Владение навыками", background.skillText);
  addInlineDescriptionBlock(rows, "Владение инструментами", background.toolText);
  addInlineDescriptionBlock(rows, "Языки", background.languageText);
  addDescriptionBlock(rows, "Снаряжение", background.equipmentText);
  addDescriptionBlock(rows, "Умение", background.featureText);
  addDescriptionBlock(rows, "Бонусная черта", background.bonusFeat.text);
  addDescriptionBlock(rows, "Имущество", background.property || background.assets);
  addDescriptionBlock(rows, "Семья, связи и организации", [background.family, background.contacts, background.organizations].filter(Boolean).join("\n\n"));

  const missingBonusFeats = bonusFeatResolution?.missingNames ?? [];
  if (missingBonusFeats.length) {
    addDescriptionBlock(rows, "Требует проверки", `Не найдена бонусная черта в компендиуме: ${missingBonusFeats.join(", ")}.`);
  }

  if (background.manualNotes.length) {
    rows.push(`<h3>Примечания импорта</h3><ul>${background.manualNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`);
  }

  if (!rows.length && background.rawText) {
    addDescriptionBlock(rows, "Исходный текст", background.rawText);
  }

  return rows.join("\n");
}

function toSkillTraitKey(skillId) {
  const id = cleanString(skillId);
  if (!id) {
    return "";
  }

  return id.startsWith("skills:") ? id : `skills:${id}`;
}

function normalizeTraitKeys(values, mapGrant = (value) => value) {
  return unique((Array.isArray(values) ? values : [])
    .map((value) => cleanString(mapGrant(value)))
    .filter(Boolean));
}

function normalizeTraitChoices(choices = [], mapGrant = (value) => value) {
  return (Array.isArray(choices) ? choices : [])
    .map((choice) => ({
      count: Math.max(1, Math.floor(parseNumber(choice?.count, 1))),
      pool: normalizeTraitKeys(choice?.pool, mapGrant)
    }))
    .filter((choice) => choice.pool.length);
}

function buildTraitAdvancement({ background, seed, title, hint = "", grants = [], choices = [] }) {
  const normalizedGrants = normalizeTraitKeys(grants);
  const normalizedChoices = normalizeTraitChoices(choices);
  if (!normalizedGrants.length && !normalizedChoices.length) {
    return null;
  }

  return {
    _id: stableHashId(`${background.id}:${seed}`, "adv"),
    type: "Trait",
    title: cleanString(title, "Владение"),
    hint: cleanString(hint),
    level: BACKGROUND_ADVANCEMENT_LEVEL,
    configuration: {
      allowReplacements: false,
      mode: "default",
      grants: normalizedGrants,
      choices: normalizedChoices
    },
    value: {}
  };
}

function buildItemGrantAdvancement(background, bonusFeatResolution) {
  const itemUuids = unique(bonusFeatResolution?.itemUuids ?? []);
  if (!itemUuids.length) {
    return null;
  }

  return {
    _id: stableHashId(`${background.id}:bonus-feat`, "adv"),
    type: "ItemGrant",
    title: "Бонусная черта",
    hint: cleanString(background.bonusFeat.text),
    level: BACKGROUND_ADVANCEMENT_LEVEL,
    configuration: {
      items: itemUuids.map((uuid) => ({ uuid, optional: false })),
      optional: false,
      spell: null
    },
    value: {}
  };
}

export function buildBackgroundAdvancement(background, bonusFeatResolution) {
  const advancements = [];
  const skillAdvancement = buildTraitAdvancement({
    background,
    seed: "skills",
    title: "Владение навыками",
    hint: background.skillText,
    grants: normalizeTraitKeys(background.skillProficiencies.grants, toSkillTraitKey),
    choices: normalizeTraitChoices(background.skillProficiencies.choices, toSkillTraitKey)
  });
  if (skillAdvancement) {
    advancements.push(skillAdvancement);
  }

  const toolAdvancement = buildTraitAdvancement({
    background,
    seed: "tools",
    title: "Владение инструментами",
    hint: background.toolText,
    grants: background.toolProficiencies.grants,
    choices: background.toolProficiencies.choices
  });
  if (toolAdvancement) {
    advancements.push(toolAdvancement);
  }

  const languageAdvancement = buildTraitAdvancement({
    background,
    seed: "languages",
    title: "Языки",
    hint: background.languageText,
    grants: background.languageChoices.grants,
    choices: background.languageChoices.choices
  });
  if (languageAdvancement) {
    advancements.push(languageAdvancement);
  }

  const bonusFeatAdvancement = buildItemGrantAdvancement(background, bonusFeatResolution);
  if (bonusFeatAdvancement) {
    advancements.push(bonusFeatAdvancement);
  }

  return advancements;
}

function createBackgroundSystem(background, advancement, bonusFeatResolution = null) {
  return {
    description: {
      value: buildBackgroundDescription(background, bonusFeatResolution),
      chat: ""
    },
    source: {
      custom: SOURCE_LABEL
    },
    identifier: buildAsciiIdentifier(background.id, background.name),
    startingEquipment: [],
    wealth: cleanString(background.wealth),
    advancement: foundry.utils.deepClone(advancement)
  };
}

function buildBackgroundSignature(entry) {
  return JSON.stringify({
    templateVersion: BACKGROUND_TEMPLATE_VERSION,
    backgroundId: entry.background.id,
    name: entry.background.name,
    level: entry.background.level,
    sourceLabel: SOURCE_LABEL,
    background: entry.background,
    bonusFeatUuids: entry.bonusFeatResolution.itemUuids,
    missingBonusFeatNames: entry.bonusFeatResolution.missingNames,
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

async function loadBackgroundsData() {
  const data = await fetchJson(BACKGROUNDS_DATA_PATH);
  return (Array.isArray(data?.backgrounds) ? data.backgrounds : [])
    .map((background, index) => normalizeBackground(background, index))
    .filter((background) => background.name);
}

function getDesiredPackMetadata() {
  return {
    label: BACKGROUNDS_COMPENDIUM_LABEL,
    type: "Item",
    name: BACKGROUNDS_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: SOURCE_LABEL,
        types: ["background"]
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
    console.warn(`${MODULE_ID} | Failed to assign backgrounds compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
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

  const byId = new Map(entries.map((entry) => [entry.background.id, entry]));
  for (const document of managedDocuments) {
    const backgroundId = cleanString(document.getFlag(MODULE_ID, "backgroundId"));
    const expected = byId.get(backgroundId);
    if (!expected) {
      return true;
    }

    if (document.getFlag(MODULE_ID, "signature") !== expected.signature) {
      return true;
    }
  }

  return false;
}

async function syncManagedDocumentIcons(pack, documents, iconLookup) {
  const updates = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.getFlag?.(MODULE_ID, "managed")) {
      continue;
    }

    const currentIcon = cleanString(document.img, DEFAULT_BACKGROUND_ICON);
    const nextIcon = resolveNamedIcon(document.name, iconLookup, currentIcon);
    if (!nextIcon || nextIcon === currentIcon) {
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

function createBackgroundItemData(entry, folderIdByPath, iconLookup = null) {
  const folderPath = entry.folderPath.join("/");
  const resolvedIcon = resolveNamedIcon(entry.background.name, iconLookup, DEFAULT_BACKGROUND_ICON);
  const missingBonusFeats = entry.bonusFeatResolution.missingNames;

  return {
    name: entry.background.name,
    type: "background",
    img: resolvedIcon,
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: foundry.utils.deepClone(entry.system),
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "background",
        backgroundId: entry.background.id,
        level: entry.background.level,
        bonusFeatName: entry.background.bonusFeat.names.join(", "),
        unresolvedBonusFeat: missingBonusFeats.length ? missingBonusFeats : null,
        signature: entry.signature
      }
    }
  };
}

async function createManagedDocuments(pack, entries, iconLookup = null) {
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
    console.warn(`${MODULE_ID} | Failed to prepare compendium folders for backgrounds pack.`, error);
  }

  await Item.implementation.createDocuments(
    entries.map((entry) => createBackgroundItemData(entry, folderIdByPath, iconLookup)),
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
    normalizedName: normalizeMatchText(record?.name)
  };
}

async function buildFeatLookup() {
  const pack = game.packs.get(FEATS_PACK_ID);
  if (!pack) {
    return new Map();
  }

  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.featId`, "flags.teyvankal.section"]
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

function resolveFeatByName(name, featLookupByName) {
  const normalizedName = normalizeMatchText(name);
  if (!normalizedName) {
    return null;
  }

  const direct = featLookupByName.get(normalizedName);
  if (direct?.length) {
    return direct[0] ?? null;
  }

  for (const [candidateName, records] of featLookupByName.entries()) {
    if (candidateName.includes(normalizedName) || normalizedName.includes(candidateName)) {
      return records[0] ?? null;
    }
  }

  return null;
}

function resolveBonusFeat(background, featLookupByName) {
  const names = unique(background.bonusFeat.names);
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
    console.warn(`${MODULE_ID} | Missing bonus feat for background '${background.name}':`, missingNames);
  }

  return {
    names,
    itemUuids: unique(itemUuids),
    missingNames
  };
}

function prepareBackgroundEntries(backgrounds, featLookupByName) {
  return backgrounds.map((background) => {
    const bonusFeatResolution = resolveBonusFeat(background, featLookupByName);
    const advancement = buildBackgroundAdvancement(background, bonusFeatResolution);
    const system = createBackgroundSystem(background, advancement, bonusFeatResolution);
    const entry = {
      background,
      bonusFeatResolution,
      system,
      folderPath: buildBackgroundFolderPath(background),
      signature: ""
    };
    entry.signature = buildBackgroundSignature(entry);
    return entry;
  });
}

async function findBackgroundDocument(pack, backgroundId, fallbackName = "") {
  const normalizedBackgroundId = cleanString(backgroundId);
  const normalizedFallbackName = normalizeMatchText(fallbackName);

  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.backgroundId`]
  });
  const indexEntry = index.find((entry) => {
    const entryBackgroundId = cleanString(foundry.utils.getProperty(entry, `flags.${MODULE_ID}.backgroundId`));
    if (normalizedBackgroundId && entryBackgroundId === normalizedBackgroundId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  });

  if (indexEntry) {
    return pack.getDocument(indexEntry._id ?? indexEntry.id);
  }

  const documents = await pack.getDocuments();
  return documents.find((entry) => {
    const entryBackgroundId = cleanString(entry.getFlag(MODULE_ID, "backgroundId"));
    if (normalizedBackgroundId && entryBackgroundId === normalizedBackgroundId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  }) ?? null;
}

export class BackgroundsCompendiumService {
  async sync() {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const backgrounds = await loadBackgroundsData();
    const featLookupByName = await buildFeatLookup();
    const entries = prepareBackgroundEntries(backgrounds, featLookupByName);
    const pack = await ensurePack();
    const documents = await getPackDocuments(pack);
    const iconLookup = await buildNamedIconLookup(BACKGROUND_ICON_SEARCH_PATHS, { forceRefresh: true });

    if (!shouldRebuildPack(entries, documents)) {
      await syncManagedDocumentIcons(pack, documents, iconLookup);
      return game.packs.get(PACK_ID) ?? pack;
    }

    await deleteManagedDocuments(pack, documents);
    await createManagedDocuments(pack, entries, iconLookup);
    const activePack = game.packs.get(PACK_ID) ?? pack;
    const activeDocuments = await getPackDocuments(activePack);
    await syncManagedDocumentIcons(activePack, activeDocuments, iconLookup);

    return activePack;
  }

  async getBackgroundDocument(backgroundId, fallbackName = "") {
    const pack = game.packs.get(PACK_ID);
    if (!pack) {
      return null;
    }

    return findBackgroundDocument(pack, backgroundId, fallbackName);
  }

  async openBackground(backgroundId, fallbackName = "") {
    const document = await this.getBackgroundDocument(backgroundId, fallbackName);
    if (!document) {
      ui.notifications?.warn("Предыстория Rebreya не найдена.");
      return null;
    }

    await document.sheet?.render?.(true);
    bringAppToFront(document.sheet);
    window.setTimeout(() => bringAppToFront(document.sheet), 40);
    window.setTimeout(() => bringAppToFront(document.sheet), 140);
    return document;
  }
}
