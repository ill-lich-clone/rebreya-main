import {
  GLOSSARY_COMPENDIUM_LABEL,
  GLOSSARY_COMPENDIUM_NAME,
  MODULE_ID
} from "../constants.js?v=1.4.317";
import {
  ensureCompendiumFolders,
  ensurePackSidebarFolder
} from "./compendium-utils.js?v=1.4.327";
import { createStableGearDocumentId } from "./gear-document-ids.js";
import { syncManagedDocumentsOnActiveGm } from "./managed-compendium-sync.js?v=1.4.330";
import {
  STATUS_REFERENCE_DATA,
  renderStatusReferenceDescription
} from "./status-reference-data.js?v=1.4.317";

const PACK_ID = `world.${GLOSSARY_COMPENDIUM_NAME}`;
const CATALOG_PATH = `modules/${MODULE_ID}/data/glossary-terms.json`;
const DND5E_SYSTEM_ID = "dnd5e";
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const GLOSSARY_TEMPLATE_VERSION = 1;
const DEFAULT_ICON = "systems/dnd5e/icons/svg/items/feature.svg";
const STATUS_FOLDER = "Состояния";
let catalogPromise = null;

function cleanString(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function renderParagraphs(value) {
  return cleanString(value)
    .split(/\n{2,}/gu)
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/gu, "<br>")}</p>`)
    .join("");
}

function normalizeLookupText(value) {
  return cleanString(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/[«»„“”"'’‘]/gu, "")
    .replace(/[‐‑‒–—-]+/gu, " ")
    .replace(/\s+/gu, " ");
}

function normalizeSection(value) {
  const text = cleanString(value).replace(/\s+/gu, " ");
  if (!text) {
    return "Термины";
  }

  const lower = text.toLocaleLowerCase("ru");
  return `${lower.charAt(0).toLocaleUpperCase("ru")}${lower.slice(1)}`;
}

function normalizeAliases(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(cleanString).filter(Boolean);
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || catalog.schemaVersion !== 1 || !Array.isArray(catalog.terms)) {
    throw new TypeError("Glossary catalog must use schemaVersion 1 and contain a terms array");
  }

  for (const [index, term] of catalog.terms.entries()) {
    if (!cleanString(term?.termId) || !cleanString(term?.name) || !cleanString(term?.description)) {
      throw new TypeError(`Glossary catalog term at index ${index} is missing termId, name, or description`);
    }
    if (term.aliases != null && !Array.isArray(term.aliases)) {
      throw new TypeError(`Glossary catalog term '${term.termId}' has invalid aliases`);
    }
  }

  return catalog;
}

export async function loadGlossaryTermCatalog() {
  catalogPromise ??= (async () => {
    const response = await fetch(CATALOG_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load ${CATALOG_PATH}: ${response.status} ${response.statusText}`);
    }
    return validateCatalog(await response.json());
  })();

  return catalogPromise;
}

function statusEntries(statuses, statusLabels) {
  const labels = statusLabels instanceof Map ? statusLabels : new Map();
  return Object.entries(statuses ?? {}).map(([statusId, definition]) => {
    const name = cleanString(labels.get(statusId))
      || cleanString(definition?.canonicalName)
      || statusId;
    const aliases = normalizeAliases(definition?.aliases);
    const source = {
      kind: "status",
      statusId,
      ...(definition?.source && typeof definition.source === "object"
        ? { ...definition.source }
        : {})
    };
    const glossaryTermId = `status:${statusId}`;

    return {
      glossaryTermId,
      documentId: createStableGearDocumentId(`glossary:${glossaryTermId}`),
      name,
      aliases,
      descriptionHtml: renderStatusReferenceDescription(definition),
      folderPath: [STATUS_FOLDER],
      source
    };
  });
}

function termEntries(terms) {
  return (Array.isArray(terms) ? terms : []).map((term) => {
    const termId = cleanString(term?.termId);
    const glossaryTermId = `term:${termId}`;
    const section = normalizeSection(term?.section);
    return {
      glossaryTermId,
      documentId: createStableGearDocumentId(`glossary:${glossaryTermId}`),
      name: cleanString(term?.name),
      aliases: normalizeAliases(term?.aliases),
      descriptionHtml: renderParagraphs(term?.description),
      folderPath: [section],
      source: {
        kind: "sheet",
        termId,
        section: cleanString(term?.section),
        sourceLabel: cleanString(term?.sourceLabel)
      }
    };
  });
}

function validateUniqueLookups(entries) {
  const ownerByLookup = new Map();
  for (const entry of entries) {
    if (!entry.glossaryTermId || !entry.name || !entry.descriptionHtml) {
      throw new TypeError(`Glossary entry '${entry.glossaryTermId || "unknown"}' is incomplete`);
    }

    for (const value of [entry.name, ...entry.aliases]) {
      const normalized = normalizeLookupText(value);
      if (!normalized) {
        throw new TypeError(`Glossary entry '${entry.glossaryTermId}' has an empty normalized lookup`);
      }
      const owner = ownerByLookup.get(normalized);
      if (owner) {
        throw new Error(
          `Duplicate glossary lookup '${normalized}' for '${owner}' and '${entry.glossaryTermId}'`
        );
      }
      ownerByLookup.set(normalized, entry.glossaryTermId);
    }
  }
}

function withSignature(entry) {
  const signature = JSON.stringify({
    templateVersion: GLOSSARY_TEMPLATE_VERSION,
    name: entry.name,
    aliases: entry.aliases,
    descriptionHtml: entry.descriptionHtml,
    folderPath: entry.folderPath,
    source: entry.source
  });
  return Object.freeze({
    ...entry,
    aliases: Object.freeze([...entry.aliases]),
    folderPath: Object.freeze([...entry.folderPath]),
    source: Object.freeze({ ...entry.source }),
    signature
  });
}

export function normalizeGlossaryEntries({
  terms = [],
  statuses = {},
  statusLabels = new Map()
} = {}) {
  const entries = [
    ...termEntries(terms),
    ...statusEntries(statuses, statusLabels)
  ];
  validateUniqueLookups(entries);
  return Object.freeze(entries.map(withSignature));
}

function localizedStatusLabel(status) {
  const raw = cleanString(status?.name ?? status?.label);
  if (!raw) {
    return "";
  }
  return cleanString(globalThis.game?.i18n?.localize?.(raw) ?? raw);
}

function buildStatusLabels() {
  const labels = new Map();
  for (const status of globalThis.CONFIG?.statusEffects ?? []) {
    const statusId = cleanString(status?.id ?? status?._id);
    const canonicalStatusId = cleanString(status?.flags?.[MODULE_ID]?.statusId);
    const label = localizedStatusLabel(status);
    if (statusId && label) {
      labels.set(statusId, label);
    }
    if (canonicalStatusId && label) {
      labels.set(canonicalStatusId, label);
    }
  }
  labels.set("prone", "Сбитый с ног");
  labels.set("bloodied", "Окровавленный");
  return labels;
}

export async function loadGlossaryReferenceDefinitions({
  loadCatalog = loadGlossaryTermCatalog,
  statuses = STATUS_REFERENCE_DATA,
  statusLabels = buildStatusLabels()
} = {}) {
  const catalog = validateCatalog(await loadCatalog());
  return Object.freeze(normalizeGlossaryEntries({
    terms: catalog.terms,
    statuses,
    statusLabels
  }).map((entry) => Object.freeze({
    sourceId: entry.glossaryTermId,
    canonicalName: entry.name,
    aliases: Object.freeze([...entry.aliases]),
    kind: "term"
  })));
}

function buildItemData(entry, folderIdByPath) {
  return {
    _id: entry.documentId,
    name: entry.name,
    type: "feat",
    img: DEFAULT_ICON,
    folder: folderIdByPath.get(entry.folderPath.join("/")) ?? null,
    ownership: {
      default: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2
    },
    system: {
      description: {
        value: entry.descriptionHtml,
        chat: ""
      },
      activities: {}
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        glossaryTermId: entry.glossaryTermId,
        aliases: [...entry.aliases],
        source: { ...entry.source },
        signature: entry.signature
      }
    }
  };
}

function glossaryDocumentHasNoAutomation(document) {
  const activities = document?.system?.activities;
  const activityCount = activities instanceof Map
    ? activities.size
    : Object.keys(activities ?? {}).length;
  const effectCount = Array.isArray(document?.effects)
    ? document.effects.length
    : Number(document?.effects?.size ?? 0);
  return activityCount === 0 && effectCount === 0;
}

function desiredPackMetadata() {
  return {
    label: GLOSSARY_COMPENDIUM_LABEL,
    type: "Item",
    name: GLOSSARY_COMPENDIUM_NAME,
    system: globalThis.game.system.id,
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
  const desired = desiredPackMetadata();
  let pack = globalThis.game.packs.get(PACK_ID);
  if (pack && (pack.documentName !== desired.type || pack.metadata?.system !== desired.system)) {
    await pack.deleteCompendium?.();
    pack = null;
  }
  if (!pack) {
    pack = await globalThis.foundry.documents.collections.CompendiumCollection.createCompendium(desired);
  }

  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign glossary compendium to its sidebar folder.`, error);
  }
  return pack;
}

export class GlossaryCompendiumService {
  constructor({
    loadCatalog = loadGlossaryTermCatalog,
    statuses = STATUS_REFERENCE_DATA
  } = {}) {
    this.loadCatalog = loadCatalog;
    this.statuses = statuses;
  }

  async sync() {
    if (!globalThis.game?.user?.isGM || globalThis.game?.system?.id !== DND5E_SYSTEM_ID) {
      return null;
    }

    const catalog = validateCatalog(await this.loadCatalog());
    const entries = normalizeGlossaryEntries({
      terms: catalog.terms,
      statuses: this.statuses,
      statusLabels: buildStatusLabels()
    });
    const pack = await ensurePack();
    const documents = await pack.getDocuments();
    let folderIdByPath = new Map();

    await syncManagedDocumentsOnActiveGm(globalThis.game, {
      pack,
      entries,
      documents: Array.isArray(documents) ? documents : [],
      sourceIdOfEntry: (entry) => entry.glossaryTermId,
      sourceIdOfDocument: (document) => document.getFlag?.(MODULE_ID, "managed")
        ? document.getFlag(MODULE_ID, "glossaryTermId")
        : "",
      signatureOfEntry: (entry) => entry.signature,
      signatureOfDocument: (document) => document.getFlag?.(MODULE_ID, "signature"),
      documentIdOfEntry: (entry) => entry.documentId,
      documentMatchesEntry: (document) => glossaryDocumentHasNoAutomation(document),
      prepareFolders: async () => {
        folderIdByPath = await ensureCompendiumFolders(pack, entries.map((entry) => entry.folderPath));
      },
      createData: (entry) => buildItemData(entry, folderIdByPath),
      updateData: (_document, entry) => {
        const data = buildItemData(entry, folderIdByPath);
        delete data._id;
        return data;
      }
    });

    return globalThis.game.packs.get(PACK_ID) ?? pack;
  }
}
