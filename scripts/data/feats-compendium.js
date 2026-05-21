import { FEATS_COMPENDIUM_LABEL, FEATS_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { bringAppToFront } from "../ui.js";
import {
  buildNamedIconLookup,
  deduplicateCompendiumFolders,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath,
  resolveNamedIcon
} from "./compendium-utils.js";
import { buildSlug } from "./item-classification.js";

const PACK_ID = `world.${FEATS_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const DEFAULT_FEAT_ICON = "icons/svg/book.svg";
const FEAT_TEMPLATE_VERSION = 1;
const FEAT_ROOT_FOLDER = "Черты V0.8";
const MODULE_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const FEAT_ICON_SEARCH_PATHS = [`${MODULE_ICONS_BASE_PATH}/Feats`, MODULE_ICONS_BASE_PATH];
const FEATS_BUNDLE_PATH = `modules/${MODULE_ID}/cherty-v08-foundry-2014-import-pack/cherty-v08-foundry-2014-bundle.json`;
const FEATS_ITEMS_PATH = `modules/${MODULE_ID}/cherty-v08-foundry-2014-import-pack/cherty-v08-foundry-2014-items.json`;
const DEFAULT_FEAT_SUBTYPE = "general";
const REBREYA_FEAT_SUBTYPE_BY_SECTION = new Map([
  ["\u043c\u043b\u0430\u0434\u0448\u0438\u0435 \u0447\u0435\u0440\u0442\u044b", "minor"],
  ["\u043e\u0431\u0449\u0438\u0435 \u0447\u0435\u0440\u0442\u044b", "general"],
  ["\u0441\u0442\u0430\u0440\u0448\u0438\u0435 \u0447\u0435\u0440\u0442\u044b", "major"],
  ["\u043c\u0443\u043b\u044c\u0442\u0438\u043a\u043b\u0430\u0441\u0441\u043e\u0432\u044b\u0435 \u0447\u0435\u0440\u0442\u044b", "multiclass"],
  ["\u0440\u0430\u0441\u043e\u0432\u044b\u0435 \u0447\u0435\u0440\u0442\u044b", "racial"],
  ["\u0447\u0435\u0440\u0442\u044b \u0431\u043e\u0435\u0432\u044b\u0445 \u0441\u0442\u0438\u043b\u0435\u0439", "fightingStyle"],
  ["\u043a\u0443\u043b\u044c\u0442\u0443\u0440\u043d\u044b\u0435 \u0447\u0435\u0440\u0442\u044b", "cultural"],
  ["\u0443\u0441\u0442\u0430\u0440\u0435\u0432\u0448\u0438\u0435 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u044b", "general"]
]);
const LEGACY_FEAT_SUBTYPE_ALIASES = new Map([
  ["origin", "cultural"],
  ["epicboon", "major"],
  ["epic-boon", "major"],
  ["fightingstyle", "fightingStyle"]
]);

function normalizeMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function normalizeDescription(rawDescription) {
  if (isPlainObject(rawDescription)) {
    return {
      value: cleanString(rawDescription.value),
      chat: cleanString(rawDescription.chat)
    };
  }

  return {
    value: cleanString(rawDescription),
    chat: ""
  };
}

function normalizeSubtypeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

function resolveFeatSubtype(section, rawSubtype = "") {
  const sectionKey = normalizeMatchText(section);
  const bySection = REBREYA_FEAT_SUBTYPE_BY_SECTION.get(sectionKey);
  if (bySection) {
    return bySection;
  }

  const normalizedRawSubtype = normalizeSubtypeKey(rawSubtype);
  if (normalizedRawSubtype) {
    if (LEGACY_FEAT_SUBTYPE_ALIASES.has(normalizedRawSubtype)) {
      return LEGACY_FEAT_SUBTYPE_ALIASES.get(normalizedRawSubtype);
    }

    for (const value of REBREYA_FEAT_SUBTYPE_BY_SECTION.values()) {
      if (normalizeSubtypeKey(value) === normalizedRawSubtype) {
        return value;
      }
    }
  }

  return DEFAULT_FEAT_SUBTYPE;
}

function normalizeFeatSystem(rawSystem, featId, section = "") {
  const system = isPlainObject(rawSystem) ? foundry.utils.deepClone(rawSystem) : {};
  const source = isPlainObject(system.source) ? system.source : {};
  const type = isPlainObject(system.type) ? system.type : {};
  const prerequisites = isPlainObject(system.prerequisites) ? system.prerequisites : {};
  const uses = isPlainObject(system.uses) ? system.uses : {};

  return {
    ...system,
    description: normalizeDescription(system.description),
    source: {
      ...source,
      custom: cleanString(source.custom)
    },
    identifier: cleanString(system.identifier, featId),
    type: {
      value: "feat",
      subtype: resolveFeatSubtype(section, cleanString(type.subtype))
    },
    requirements: cleanString(system.requirements) || null,
    prerequisites: {
      items: Array.isArray(prerequisites.items) ? foundry.utils.deepClone(prerequisites.items) : [],
      level: Number.isFinite(Number(prerequisites.level)) ? Number(prerequisites.level) : 0,
      repeatable: prerequisites.repeatable === true
    },
    properties: Array.isArray(system.properties) ? foundry.utils.deepClone(system.properties) : [],
    activities: isPlainObject(system.activities) ? foundry.utils.deepClone(system.activities) : {},
    uses: {
      spent: Number.isFinite(Number(uses.spent)) ? Number(uses.spent) : 0,
      max: cleanString(uses.max),
      recovery: Array.isArray(uses.recovery) ? foundry.utils.deepClone(uses.recovery) : []
    },
    advancement: isPlainObject(system.advancement) ? foundry.utils.deepClone(system.advancement) : {}
  };
}

function normalizeFeatFlags(rawFlags) {
  const flags = isPlainObject(rawFlags) ? foundry.utils.deepClone(rawFlags) : {};
  const teyvankal = isPlainObject(flags.teyvankal) ? flags.teyvankal : {};
  const section = cleanString(teyvankal.section, "Без раздела");
  const subsection = cleanString(teyvankal.subsection);

  flags.teyvankal = {
    ...teyvankal,
    section,
    subsection: subsection || null
  };

  return {
    flags,
    section,
    subsection: subsection || null
  };
}

function buildFeatId(rawItem, index, usedIds) {
  const fallbackId = `feat-${index + 1}`;
  const sourceIdentifier = cleanString(rawItem?.system?.identifier);
  const sourceName = cleanString(rawItem?.name, fallbackId);
  const baseId = cleanString(sourceIdentifier, buildSlug(sourceName, fallbackId));
  let featId = baseId;
  let duplicateIndex = 2;

  while (usedIds.has(featId)) {
    featId = `${baseId}-${duplicateIndex}`;
    duplicateIndex += 1;
  }

  usedIds.add(featId);
  return featId;
}

function normalizeFeatItem(rawItem, index, usedIds) {
  const safeItem = isPlainObject(rawItem) ? rawItem : {};
  const featId = buildFeatId(safeItem, index, usedIds);
  const name = cleanString(safeItem.name, `Черта ${index + 1}`);
  const { flags, section, subsection } = normalizeFeatFlags(safeItem.flags);

  return {
    featId,
    name,
    type: "feat",
    img: cleanString(safeItem.img, DEFAULT_FEAT_ICON),
    system: normalizeFeatSystem(safeItem.system, featId, section),
    effects: Array.isArray(safeItem.effects) ? foundry.utils.deepClone(safeItem.effects) : [],
    flags,
    section,
    subsection
  };
}

function normalizeFeatItems(rawItems = []) {
  const usedIds = new Set();
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item, index) => normalizeFeatItem(item, index, usedIds))
    .filter((item) => item.name);
}

function buildFeatFolderPath(feat) {
  const path = [FEAT_ROOT_FOLDER, cleanString(feat.section, "Без раздела")];
  const subsection = cleanString(feat.subsection);
  if (subsection) {
    path.push(subsection);
  }

  return normalizeFolderPath(path);
}

function buildFeatSignature(feat) {
  return JSON.stringify({
    templateVersion: FEAT_TEMPLATE_VERSION,
    featId: feat.featId,
    name: feat.name,
    type: feat.type,
    img: feat.img,
    section: feat.section,
    subsection: feat.subsection ?? null,
    system: feat.system,
    effects: feat.effects,
    teyvankal: feat.flags?.teyvankal ?? null,
    automation: feat.flags?.[MODULE_ID]?.automation ?? null
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

async function loadRawFeatItems() {
  const bundle = await fetchJson(FEATS_BUNDLE_PATH, { optional: true });
  if (Array.isArray(bundle?.items)) {
    return bundle.items;
  }

  const items = await fetchJson(FEATS_ITEMS_PATH, { optional: true });
  if (Array.isArray(items)) {
    return items;
  }

  throw new Error(
    `Failed to resolve feat import files. Expected '${FEATS_BUNDLE_PATH}' or '${FEATS_ITEMS_PATH}'.`
  );
}

function createFeatItemData(feat, folderIdByPath, iconLookup = null) {
  const folderPath = buildFeatFolderPath(feat).join("/");
  const moduleFlags = isPlainObject(feat.flags?.[MODULE_ID])
    ? foundry.utils.deepClone(feat.flags[MODULE_ID])
    : {}
  const resolvedIcon = resolveNamedIcon(feat.name, iconLookup, feat.img || DEFAULT_FEAT_ICON);

  return {
    name: feat.name,
    type: "feat",
    img: resolvedIcon,
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: foundry.utils.deepClone(feat.system),
    effects: foundry.utils.deepClone(feat.effects),
    flags: {
      ...foundry.utils.deepClone(feat.flags),
      [MODULE_ID]: {
        ...moduleFlags,
        managed: true,
        sourceType: "feat",
        featId: feat.featId,
        section: feat.section,
        subsection: feat.subsection ?? null,
        signature: buildFeatSignature(feat)
      }
    }
  };
}

function getDesiredPackMetadata() {
  return {
    label: FEATS_COMPENDIUM_LABEL,
    type: "Item",
    name: FEATS_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: "Rebreya",
        types: ["feat"]
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
    console.warn(`${MODULE_ID} | Failed to assign feats compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

function shouldRebuildPack(feats, documents) {
  const managedDocuments = documents.filter((document) => document.getFlag(MODULE_ID, "managed"));
  if (managedDocuments.length !== feats.length) {
    return true;
  }

  const byId = new Map(feats.map((feat) => [feat.featId, feat]));
  for (const document of managedDocuments) {
    const featId = document.getFlag(MODULE_ID, "featId");
    const feat = byId.get(featId);
    if (!feat) {
      return true;
    }

    if (document.getFlag(MODULE_ID, "signature") !== buildFeatSignature(feat)) {
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

    const currentIcon = cleanString(document.img, DEFAULT_FEAT_ICON);
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

async function createManagedDocuments(pack, feats, iconLookup = null) {
  if (!feats.length) {
    return;
  }

  let folderIdByPath = new Map();
  try {
    folderIdByPath = await ensureCompendiumFolders(
      pack,
      feats.map((feat) => buildFeatFolderPath(feat))
    );
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to prepare compendium folders for feats pack.`, error);
  }

  await Item.implementation.createDocuments(
    feats.map((feat) => createFeatItemData(feat, folderIdByPath, iconLookup)),
    { pack: pack.collection }
  );
}

async function findFeatDocument(pack, featId, fallbackName = "") {
  const normalizedFeatId = cleanString(featId);
  const normalizedFallbackName = normalizeMatchText(fallbackName);

  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.featId`]
  });
  const indexEntry = index.find((entry) => {
    const entryFeatId = cleanString(foundry.utils.getProperty(entry, `flags.${MODULE_ID}.featId`));
    if (normalizedFeatId && entryFeatId === normalizedFeatId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  });

  if (indexEntry) {
    return pack.getDocument(indexEntry._id ?? indexEntry.id);
  }

  const documents = await pack.getDocuments();
  return documents.find((entry) => {
    const entryFeatId = cleanString(entry.getFlag(MODULE_ID, "featId"));
    if (normalizedFeatId && entryFeatId === normalizedFeatId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  }) ?? null;
}

export class FeatsCompendiumService {
  async sync(items = null) {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const rawItems = Array.isArray(items) ? items : await loadRawFeatItems();
    const feats = normalizeFeatItems(rawItems);
    const pack = await ensurePack();
    await deduplicateCompendiumFolders(pack);
    const documents = await getPackDocuments(pack);
    const iconLookup = await buildNamedIconLookup(FEAT_ICON_SEARCH_PATHS, { forceRefresh: true });
    if (!shouldRebuildPack(feats, documents)) {
      await syncManagedDocumentIcons(pack, documents, iconLookup);
      return game.packs.get(PACK_ID) ?? pack;
    }

    await deleteManagedDocuments(pack, documents);
    await createManagedDocuments(pack, feats, iconLookup);
    const activePack = game.packs.get(PACK_ID) ?? pack;
    const activeDocuments = await getPackDocuments(activePack);
    await syncManagedDocumentIcons(activePack, activeDocuments, iconLookup);

    return activePack;
  }

  async getFeatDocument(featId, fallbackName = "") {
    const pack = game.packs.get(PACK_ID);
    if (!pack) {
      return null;
    }

    return findFeatDocument(pack, featId, fallbackName);
  }

  async openFeat(featId, fallbackName = "") {
    const document = await this.getFeatDocument(featId, fallbackName);
    if (!document) {
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.FeatEntryNotFound"));
      return null;
    }

    await document.sheet?.render?.(true);
    bringAppToFront(document.sheet);
    window.setTimeout(() => bringAppToFront(document.sheet), 40);
    window.setTimeout(() => bringAppToFront(document.sheet), 140);
    return document;
  }
}
