import {
  DOWNTIME_COMPENDIUM_LABEL,
  DOWNTIME_COMPENDIUM_NAME,
  DOWNTIME_ITEM_TYPE,
  MODULE_ID
} from "../constants.js";
import {
  deduplicateCompendiumFolders,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath
} from "./compendium-utils.js";
import { syncManagedDocumentsOnActiveGm } from "./managed-compendium-sync.js";
import { cloneFoundryValue as clone } from "../shared/foundry-values.js";

const PACK_ID = `world.${DOWNTIME_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const SOURCE_LABEL = "ЗоЗТ: Между приключениями";
const DOWNTIME_DATA_PATH = `modules/${MODULE_ID}/data/downtime-activities-teyvankal-v01.json`;
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const DOWNTIME_ROOT_FOLDER = "Простой";
const DEFAULT_DOWNTIME_ICON = "systems/dnd5e/icons/svg/activity/utility.svg";
const DOWNTIME_TEMPLATE_VERSION = 1;
const FALLBACK_OBSERVER_OWNERSHIP = 2;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanArray(values = []) {
  return Array.from(new Set(asArray(values)
    .map((value) => cleanString(value))
    .filter(Boolean)));
}

function toInteger(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? Math.floor(numericValue) : fallback;
}

function toOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
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

function buildAsciiIdentifier(value, fallbackSeed = "downtime") {
  const base = String(value ?? "")
    .toLowerCase()
    .replace(/[^\x00-\x7F]+/gu, " ")
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "")
    .slice(0, 40);
  const hash = stableHashId(`${value}:${fallbackSeed}`, "identifier").slice(0, 8);

  return `${base || "rb-downtime"}-${hash}`;
}

export function createStableDowntimeDocumentId(activityId) {
  return stableHashId(cleanString(activityId, "downtime"), "downtime-document");
}

function normalizeRankTable(value = []) {
  return asArray(value)
    .map((entry) => clone(asObject(entry)))
    .filter((entry) => Object.keys(entry).length > 0);
}

function normalizeThreshold(rawThreshold = {}) {
  const source = asObject(rawThreshold);
  const from = toOptionalNumber(source.from);
  const to = toOptionalNumber(source.to);
  const threshold = {
    ...clone(source),
    label: cleanString(source.label, "Порог"),
    outcome: cleanString(source.outcome, "gm")
  };

  if (from !== undefined) {
    threshold.from = from;
  }
  if (to !== undefined) {
    threshold.to = to;
  }

  return threshold;
}

function normalizeChoice(rawChoice = {}) {
  const source = asObject(rawChoice);
  return {
    ...clone(source),
    sourceType: cleanString(source.sourceType),
    ability: cleanString(source.ability),
    target: cleanString(source.target),
    targetLabel: cleanString(source.targetLabel),
    label: cleanString(source.label)
  };
}

function normalizeTargetAction(rawAction = {}, index = 0) {
  const source = asObject(rawAction);
  const action = {
    ...clone(source),
    id: cleanString(source.id, `action-${index + 1}`),
    label: cleanString(source.label, `Целевое действие ${index + 1}`),
    actionType: cleanString(source.actionType, "freeform"),
    sourceType: cleanString(source.sourceType),
    ability: cleanString(source.ability),
    target: cleanString(source.target),
    targetLabel: cleanString(source.targetLabel),
    outcomeMode: cleanString(source.outcomeMode, source.actionType === "freeform" ? "freeform" : "dc"),
    recordMode: cleanString(source.recordMode, source.actionType === "freeform" ? "gm" : "total-success")
  };
  const dc = toOptionalNumber(source.dc);
  if (dc !== undefined) {
    action.dc = dc;
  }

  if (Array.isArray(source.choices)) {
    action.choices = source.choices.map((choice) => normalizeChoice(choice));
  }

  if (Array.isArray(source.thresholds)) {
    action.thresholds = source.thresholds.map((threshold) => normalizeThreshold(threshold));
  }

  if (source.resources && typeof source.resources === "object" && !Array.isArray(source.resources)) {
    action.resources = clone(source.resources);
  }

  return action;
}

export function normalizeDowntimeActivity(rawActivity = {}, index = 0) {
  const source = asObject(rawActivity);
  const name = cleanString(source.name, `Простой ${index + 1}`);
  const id = cleanString(source.id, buildAsciiIdentifier(name, `downtime-${index + 1}`));
  const automationStatus = cleanString(source.automationStatus, "needs-work");

  return {
    id,
    name,
    rank: cleanString(source.rank),
    rankMode: cleanString(source.rankMode),
    defaultWeeks: Math.max(1, toInteger(source.defaultWeeks, 1)),
    duration: cleanString(source.duration),
    summary: cleanString(source.summary),
    descriptionHtml: cleanString(source.descriptionHtml),
    requirements: cleanArray(source.requirements),
    automationStatus,
    automationNotes: cleanArray(source.automationNotes),
    rankTable: normalizeRankTable(source.rankTable),
    targetActions: asArray(source.targetActions).map((action, actionIndex) => normalizeTargetAction(action, actionIndex)),
    tags: cleanArray(source.tags),
    folderPath: normalizeFolderPath(source.folderPath?.length ? source.folderPath : [DOWNTIME_ROOT_FOLDER]),
    img: cleanString(source.img, DEFAULT_DOWNTIME_ICON)
  };
}

export function normalizeDowntimeActivities(rawActivities = []) {
  return asArray(rawActivities)
    .map((activity, index) => normalizeDowntimeActivity(activity, index))
    .filter((activity) => activity.id && activity.name);
}

function buildDowntimeFlag(activity) {
  return {
    schemaVersion: DOWNTIME_TEMPLATE_VERSION,
    sourceDocument: "БЕТА Заметки о землях Тейванкаля, 2-я редакция (1)",
    sourceChapter: "Глава 9: Между приключениями",
    sourceSection: "Деятельность во время простоя",
    downtimeId: activity.id,
    rank: activity.rank,
    rankMode: activity.rankMode,
    defaultWeeks: activity.defaultWeeks,
    duration: activity.duration,
    summary: activity.summary,
    descriptionHtml: activity.descriptionHtml,
    requirements: clone(activity.requirements),
    automationStatus: activity.automationStatus,
    automationNotes: clone(activity.automationNotes),
    rankTable: clone(activity.rankTable),
    targetActions: clone(activity.targetActions)
  };
}

function buildDowntimeSignature(activity) {
  return JSON.stringify({
    templateVersion: DOWNTIME_TEMPLATE_VERSION,
    downtimeId: activity.id,
    activity
  });
}

function createDowntimeSystem(activity) {
  return {
    description: {
      value: activity.descriptionHtml,
      chat: ""
    },
    source: {
      custom: SOURCE_LABEL
    },
    identifier: buildAsciiIdentifier(`downtime-${activity.id}`, activity.name)
  };
}

function getObserverOwnership() {
  return globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? FALLBACK_OBSERVER_OWNERSHIP;
}

export function createDowntimeItemData(activity, folderIdByPath = new Map()) {
  const folderPath = activity.folderPath.join("/");
  const downtimeFlag = buildDowntimeFlag(activity);

  return {
    _id: createStableDowntimeDocumentId(activity.id),
    name: activity.name,
    type: DOWNTIME_ITEM_TYPE,
    img: activity.img || DEFAULT_DOWNTIME_ICON,
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: getObserverOwnership()
    },
    system: createDowntimeSystem(activity),
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "downtimeTemplate",
        downtimeId: activity.id,
        rank: activity.rank,
        automationStatus: activity.automationStatus,
        downtime: downtimeFlag,
        signature: buildDowntimeSignature(activity)
      }
    }
  };
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function isDowntimeItemTypeAvailable() {
  if (game.documentTypes?.Item?.includes?.(DOWNTIME_ITEM_TYPE)) {
    return true;
  }

  return Boolean(game.model?.Item?.[DOWNTIME_ITEM_TYPE]);
}

function getPackSourceBook(pack) {
  return cleanString(foundry.utils.getProperty(pack, "metadata.flags.dnd5e.sourceBook"));
}

function getDesiredPackMetadata() {
  return {
    label: DOWNTIME_COMPENDIUM_LABEL,
    type: "Item",
    name: DOWNTIME_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: SOURCE_LABEL,
        types: [DOWNTIME_ITEM_TYPE]
      }
    }
  };
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function loadDowntimeData() {
  const data = await fetchJson(DOWNTIME_DATA_PATH);
  return normalizeDowntimeActivities(data?.activities);
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

  if (pack && getPackSourceBook(pack) !== SOURCE_LABEL) {
    const documents = await getPackDocuments(pack);
    const unmanagedDocuments = documents.filter((document) => !document.getFlag(MODULE_ID, "managed"));

    if (unmanagedDocuments.length) {
      console.warn(
        `${MODULE_ID} | Downtime compendium source is '${getPackSourceBook(pack)}', expected '${SOURCE_LABEL}', `
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
    console.warn(`${MODULE_ID} | Failed to assign downtime compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

export class DowntimeCompendiumService {
  async sync() {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    if (!isDowntimeItemTypeAvailable()) {
      console.warn(`${MODULE_ID} | Downtime item type '${DOWNTIME_ITEM_TYPE}' is not registered yet. Restart Foundry or reload the world after updating module.json.`);
      ui.notifications?.warn("Тип предмета «Простой» ещё не зарегистрирован. Перезапустите мир после обновления модуля.");
      return null;
    }

    const activities = await loadDowntimeData();
    const pack = await ensurePack();
    await deduplicateCompendiumFolders(pack, [DOWNTIME_ROOT_FOLDER]);
    const documents = await getPackDocuments(pack);

    let folderIdByPath = new Map();
    await syncManagedDocumentsOnActiveGm(game, {
      pack,
      entries: activities,
      documents,
      sourceIdOfEntry: (activity) => activity.id,
      sourceIdOfDocument: (document) => document.getFlag(MODULE_ID, "managed")
        ? document.getFlag(MODULE_ID, "downtimeId")
        : "",
      signatureOfEntry: buildDowntimeSignature,
      signatureOfDocument: (document) => document.getFlag(MODULE_ID, "signature"),
      prepareFolders: async () => {
        try {
          folderIdByPath = await ensureCompendiumFolders(pack, activities.map((activity) => activity.folderPath));
        }
        catch (error) {
          console.warn(`${MODULE_ID} | Failed to prepare compendium folders for downtime pack.`, error);
        }
      },
      createData: (activity) => createDowntimeItemData(activity, folderIdByPath),
      updateData: (_document, activity) => createDowntimeItemData(activity, folderIdByPath)
    });
    const activePack = game.packs.get(PACK_ID) ?? pack;
    await deduplicateCompendiumFolders(activePack, [DOWNTIME_ROOT_FOLDER]);
    return activePack;
  }
}
