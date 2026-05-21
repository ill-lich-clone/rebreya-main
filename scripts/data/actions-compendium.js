import {
  ACTIONS_COMPENDIUM_LABEL,
  ACTIONS_COMPENDIUM_NAME,
  MODULE_ID
} from "../constants.js";
import {
  buildNamedIconLookup,
  deduplicateCompendiumFolders,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath,
  resolveNamedIcon
} from "./compendium-utils.js";

const PACK_ID = `world.${ACTIONS_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const REBREYA_SOURCE_LABEL = "Ребрея";
const GLOSSARY_SOURCE_LABEL = "Глоссарий БЕТА Заметки о землях Тейванкаля, 2-я редакция";
const COMPENDIUM_SIDEBAR_FOLDER = [REBREYA_SOURCE_LABEL];
const ACTION_ITEM_TYPE = "feat";
const ACTION_ROOT_FOLDER = "Действия (Глоссарий БЕТА)";
const ACTION_TEMPLATE_VERSION = 1;
const DEFAULT_ACTION_ICON = "systems/dnd5e/icons/svg/activity/utility.svg";
const MODULE_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const ACTION_ICON_SEARCH_PATHS = [
  `${MODULE_ICONS_BASE_PATH}/Actions`,
  `${MODULE_ICONS_BASE_PATH}/GlossaryActions`,
  MODULE_ICONS_BASE_PATH
];
const GLOSSARY_TEXT_RELATIVE_PATH = `modules/${MODULE_ID}/Глоссарий.txt`;

const ACTION_DEFINITIONS = [
  { key: "attack", name: "Атака", section: "Действия" },
  { key: "attack-one-available", name: "Действие за одну из доступных атак", section: "Действия" },
  { key: "attack-no-prof", name: "Атака без бонуса мастерства", section: "Действия" },
  { key: "disarm", name: "Обезоруживание", section: "Действия" },
  { key: "provoke", name: "Провоцировать", section: "Действия" },
  { key: "cleave", name: "Прорубать", section: "Действия" },
  { key: "sleight-of-hand", name: "Ловкость рук", section: "Действия" },
  { key: "steal", name: "Украсть", section: "Действия" },
  { key: "repair", name: "Ремонтировать", section: "Действия" },
  { key: "write", name: "Написать", section: "Действия" },
  { key: "draw", name: "Нарисовать", section: "Действия" },
  { key: "opportunity-attack", name: "Провоцированные атаки ⚡", section: "Реакции" },
  { key: "identify-spell", name: "Опознание заклинания ⚡", section: "Реакции" },
  { key: "grab-ledge", name: "Ухватиться за уступ ⚡", section: "Реакции" },
  { key: "catch-item", name: "Схватить предмет ⚡", section: "Реакции" },
  { key: "parry", name: "Парирование ⚡", section: "Реакции" },
  { key: "interception", name: "Перехват ⚡", section: "Реакции" }
];

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
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

function buildAsciiIdentifier(value, fallbackSeed = "action") {
  const base = String(value ?? "")
    .toLowerCase()
    .replace(/[^\x00-\x7F]+/gu, " ")
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "");

  if (base) {
    return base.slice(0, 64);
  }

  return `rb_${stableHashId(String(fallbackSeed ?? value ?? "action"), "identifier")}`;
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

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeGlossaryText(rawText) {
  return String(rawText ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\u000c/gu, "\n")
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n");
}

async function fetchText(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function loadGlossaryText() {
  const candidates = [
    GLOSSARY_TEXT_RELATIVE_PATH,
    encodeURI(GLOSSARY_TEXT_RELATIVE_PATH)
  ];
  let lastError = null;

  for (const path of candidates) {
    try {
      const text = await fetchText(path);
      if (cleanString(text)) {
        return normalizeGlossaryText(text);
      }
    }
    catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Failed to load glossary text from '${GLOSSARY_TEXT_RELATIVE_PATH}'.`);
}

function findEntryHeadings(text) {
  const foundEntries = [];

  for (const definition of ACTION_DEFINITIONS) {
    const headingRegex = new RegExp(`^${escapeRegex(definition.name)}\\s*\\[Lich\\]\\s*$`, "gmu");
    const match = headingRegex.exec(text);
    if (!match || typeof match.index !== "number") {
      console.warn(`${MODULE_ID} | Glossary action heading not found: '${definition.name} [Lich]'.`);
      continue;
    }

    const headingLength = match[0]?.length ?? 0;
    const headingEndIndex = match.index + headingLength;
    foundEntries.push({
      ...definition,
      headingIndex: match.index,
      contentStart: headingEndIndex
    });
  }

  return foundEntries
    .sort((left, right) => left.headingIndex - right.headingIndex);
}

function extractActionEntries(glossaryText) {
  const headings = findEntryHeadings(glossaryText);
  if (!headings.length) {
    return [];
  }

  const movementHeadingRegex = /^\s*Перемещение\s*$/gmu;
  const movementMatch = movementHeadingRegex.exec(glossaryText);
  const movementIndex = typeof movementMatch?.index === "number"
    ? movementMatch.index
    : glossaryText.length;

  return headings.map((entry, index) => {
    const nextHeading = headings[index + 1] ?? null;
    const contentEnd = nextHeading
      ? nextHeading.headingIndex
      : movementIndex;
    const rawBody = glossaryText.slice(entry.contentStart, contentEnd);
    const body = cleanString(rawBody);
    const actionId = buildAsciiIdentifier(`glossary-${entry.key}`, entry.name);

    return {
      actionId,
      key: entry.key,
      name: entry.name,
      section: entry.section,
      description: body
    };
  }).filter((entry) => cleanString(entry.description));
}

function buildActionFolderPath(entry) {
  return normalizeFolderPath([ACTION_ROOT_FOLDER, cleanString(entry.section, "Действия")]);
}

function buildActionSignature(entry) {
  return JSON.stringify({
    templateVersion: ACTION_TEMPLATE_VERSION,
    actionId: entry.actionId,
    key: entry.key,
    name: entry.name,
    section: entry.section,
    description: entry.description
  });
}

function createActionSystem(entry) {
  return {
    description: {
      value: toHtmlParagraphs(entry.description),
      chat: ""
    },
    source: {
      custom: GLOSSARY_SOURCE_LABEL
    },
    identifier: buildAsciiIdentifier(entry.actionId, entry.name),
    type: {
      value: "feat",
      subtype: ""
    },
    requirements: "",
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

function createActionItemData(entry, folderIdByPath, iconLookup = null) {
  const folderPath = buildActionFolderPath(entry).join("/");
  const resolvedIcon = resolveNamedIcon(entry.name, iconLookup, DEFAULT_ACTION_ICON);

  return {
    name: entry.name,
    type: ACTION_ITEM_TYPE,
    img: resolvedIcon,
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: createActionSystem(entry),
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "glossaryAction",
        actionId: entry.actionId,
        section: entry.section,
        signature: buildActionSignature(entry)
      }
    }
  };
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function getPackSourceBook(pack) {
  return cleanString(foundry.utils.getProperty(pack, "metadata.flags.dnd5e.sourceBook"));
}

function getDesiredPackMetadata() {
  return {
    label: ACTIONS_COMPENDIUM_LABEL,
    type: "Item",
    name: ACTIONS_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: REBREYA_SOURCE_LABEL,
        types: [ACTION_ITEM_TYPE]
      }
    }
  };
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
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

  if (pack && getPackSourceBook(pack) !== REBREYA_SOURCE_LABEL) {
    const documents = await getPackDocuments(pack);
    const unmanagedDocuments = documents.filter((document) => !document.getFlag(MODULE_ID, "managed"));
    if (unmanagedDocuments.length) {
      console.warn(
        `${MODULE_ID} | Actions compendium source is '${getPackSourceBook(pack)}', expected '${REBREYA_SOURCE_LABEL}', `
        + "but the pack has unmanaged documents and will not be recreated automatically."
      );
    }
    else if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
      pack = null;
    }
  }

  if (!pack) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium(desired);
  }

  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign actions compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

function shouldRebuildPack(entries, documents) {
  const managedDocuments = documents.filter((document) => document.getFlag(MODULE_ID, "managed"));
  if (managedDocuments.length !== entries.length) {
    return true;
  }

  const entriesById = new Map(entries.map((entry) => [entry.actionId, entry]));
  for (const document of managedDocuments) {
    const actionId = cleanString(document.getFlag(MODULE_ID, "actionId"));
    const sourceEntry = entriesById.get(actionId);
    if (!sourceEntry) {
      return true;
    }

    if (document.getFlag(MODULE_ID, "signature") !== buildActionSignature(sourceEntry)) {
      return true;
    }
  }

  return false;
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

async function syncManagedDocumentIcons(pack, documents, iconLookup) {
  const updates = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.getFlag?.(MODULE_ID, "managed")) {
      continue;
    }

    const currentIcon = cleanString(document.img, DEFAULT_ACTION_ICON);
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

async function createManagedDocuments(pack, entries, iconLookup = null) {
  if (!entries.length) {
    return;
  }

  let folderIdByPath = new Map();
  try {
    folderIdByPath = await ensureCompendiumFolders(
      pack,
      entries.map((entry) => buildActionFolderPath(entry))
    );
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to prepare compendium folders for actions pack.`, error);
  }

  await Item.implementation.createDocuments(
    entries.map((entry) => createActionItemData(entry, folderIdByPath, iconLookup)),
    { pack: pack.collection }
  );
}

async function ensureManagedIdentifiers(pack, documents) {
  const updates = [];

  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.getFlag?.(MODULE_ID, "managed")) {
      continue;
    }

    const identifier = cleanString(foundry.utils.getProperty(document, "system.identifier"));
    const normalizedIdentifier = buildAsciiIdentifier(identifier, document.name);
    if (identifier === normalizedIdentifier) {
      continue;
    }

    updates.push({
      _id: document.id,
      "system.identifier": normalizedIdentifier
    });
  }

  if (!updates.length) {
    return;
  }

  await Item.implementation.updateDocuments(updates, { pack: pack.collection });
}

export class ActionsCompendiumService {
  async sync() {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const glossaryText = await loadGlossaryText();
    const entries = extractActionEntries(glossaryText);
    const pack = await ensurePack();
    await deduplicateCompendiumFolders(pack, [ACTION_ROOT_FOLDER, "Действия", "Реакции"]);
    const documents = await getPackDocuments(pack);
    const iconLookup = await buildNamedIconLookup(ACTION_ICON_SEARCH_PATHS, { forceRefresh: true });

    if (!entries.length) {
      await ensureManagedIdentifiers(pack, documents);
      await syncManagedDocumentIcons(pack, documents, iconLookup);
      return game.packs.get(PACK_ID) ?? pack;
    }

    if (!shouldRebuildPack(entries, documents)) {
      await ensureManagedIdentifiers(pack, documents);
      await syncManagedDocumentIcons(pack, documents, iconLookup);
      return game.packs.get(PACK_ID) ?? pack;
    }

    await deleteManagedDocuments(pack, documents);
    await createManagedDocuments(pack, entries, iconLookup);
    const activePack = game.packs.get(PACK_ID) ?? pack;
    await deduplicateCompendiumFolders(activePack, [ACTION_ROOT_FOLDER, "Действия", "Реакции"]);
    const activeDocuments = await getPackDocuments(activePack);
    await ensureManagedIdentifiers(activePack, activeDocuments);
    await syncManagedDocumentIcons(activePack, activeDocuments, iconLookup);

    return activePack;
  }
}
