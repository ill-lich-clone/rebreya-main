import { MODULE_ID } from "../constants.js";

const JOURNAL_DOCUMENT_NAMES = new Set(["JournalEntry", "JournalEntryPage"]);
const RECORD_FLAG_KEYS = Object.freeze(["documentName", "sourceUuid", "version"]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function rawRecordFlag(item) {
  return item?.getFlag?.(MODULE_ID, "journalRecord")
    ?? item?.flags?.[MODULE_ID]?.journalRecord
    ?? null;
}

function itemCollection(actor) {
  const contents = actor?.items?.contents;
  if (Array.isArray(contents)) return contents;
  if (actor?.items && typeof actor.items[Symbol.iterator] === "function") {
    return [...actor.items];
  }
  return [];
}

export function readJournalRecordFlag(item) {
  const flag = rawRecordFlag(item);
  if (!exactKeys(flag, RECORD_FLAG_KEYS) || flag.version !== 1) return null;
  const sourceUuid = clean(flag.sourceUuid);
  const documentName = clean(flag.documentName);
  if (!sourceUuid || sourceUuid !== flag.sourceUuid || documentName !== flag.documentName
    || !JOURNAL_DOCUMENT_NAMES.has(documentName)) return null;
  return Object.freeze({ version: 1, sourceUuid, documentName });
}

export function isJournalRecordItem(item) {
  return readJournalRecordFlag(item) !== null;
}

export function findJournalRecordItem(actor, reference = {}) {
  const sourceUuid = clean(reference.sourceUuid);
  const documentName = clean(reference.documentName);
  if (!sourceUuid || sourceUuid !== reference.sourceUuid
    || !JOURNAL_DOCUMENT_NAMES.has(documentName)
    || documentName !== reference.documentName) return null;
  return itemCollection(actor).find((item) => {
    const flag = readJournalRecordFlag(item);
    return flag?.sourceUuid === sourceUuid && flag.documentName === documentName;
  }) ?? null;
}

export function buildJournalRecordItemData(row = {}) {
  const sourceUuid = clean(row.sourceId);
  const documentName = clean(row.sourceDocumentName);
  if (!sourceUuid || sourceUuid !== row.sourceId
    || !JOURNAL_DOCUMENT_NAMES.has(documentName)
    || documentName !== row.sourceDocumentName) {
    throw new TypeError("Journal reference row is not canonical.");
  }
  return {
    name: clean(row.name) || "Журнал",
    type: "loot",
    img: clean(row.img) || "icons/svg/book.svg",
    system: {
      quantity: 1,
      weight: 0,
      price: { value: 0, denomination: "gp" }
    },
    flags: {
      [MODULE_ID]: {
        journalRecord: { version: 1, sourceUuid, documentName }
      }
    }
  };
}
