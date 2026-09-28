import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  buildJournalRecordItemData,
  findJournalRecordItem,
  isJournalRecordItem,
  readJournalRecordFlag
} from "../scripts/data/journal-record-item.js";

function recordItem({
  sourceUuid = "JournalEntry.notes",
  documentName = "JournalEntry",
  version = 1
} = {}) {
  return {
    flags: {
      [MODULE_ID]: {
        journalRecord: { version, sourceUuid, documentName }
      }
    }
  };
}

test("Journal record Item data preserves the exact authoritative page reference", () => {
  const row = {
    sourceId: "JournalEntry.notes.JournalEntryPage.page-a",
    sourceDocumentName: "JournalEntryPage",
    name: "Полевые заметки",
    img: ""
  };

  const data = buildJournalRecordItemData(row);

  assert.deepEqual(data, {
    name: "Полевые заметки",
    type: "loot",
    img: "icons/svg/book.svg",
    system: {
      quantity: 1,
      weight: 0,
      price: { value: 0, denomination: "gp" }
    },
    flags: {
      [MODULE_ID]: {
        journalRecord: {
          version: 1,
          sourceUuid: "JournalEntry.notes.JournalEntryPage.page-a",
          documentName: "JournalEntryPage"
        }
      }
    }
  });
  assert.notEqual(data.flags[MODULE_ID].journalRecord, row);
});

test("Journal record flag accepts only the exact supported persisted contract", () => {
  assert.deepEqual(readJournalRecordFlag(recordItem()), {
    version: 1,
    sourceUuid: "JournalEntry.notes",
    documentName: "JournalEntry"
  });
  assert.equal(isJournalRecordItem(recordItem()), true);

  for (const item of [
    recordItem({ version: 2 }),
    recordItem({ sourceUuid: " JournalEntry.notes " }),
    recordItem({ sourceUuid: "" }),
    recordItem({ documentName: "Item" }),
    { flags: { [MODULE_ID]: { journalRecord: {
      version: 1,
      sourceUuid: "JournalEntry.notes",
      documentName: "JournalEntry",
      extra: true
    } } } },
    { flags: {} },
    null
  ]) {
    assert.equal(readJournalRecordFlag(item), null);
    assert.equal(isJournalRecordItem(item), false);
  }
});

test("Journal record lookup deduplicates exact source identity per Actor", () => {
  const whole = { id: "whole", ...recordItem() };
  const pageA = {
    id: "page-a",
    ...recordItem({
      sourceUuid: "JournalEntry.notes.JournalEntryPage.page-a",
      documentName: "JournalEntryPage"
    })
  };
  const actor = { items: { contents: [whole, pageA] } };

  assert.equal(findJournalRecordItem(actor, {
    sourceUuid: "JournalEntry.notes",
    documentName: "JournalEntry"
  }), whole);
  assert.equal(findJournalRecordItem(actor, {
    sourceUuid: "JournalEntry.notes.JournalEntryPage.page-a",
    documentName: "JournalEntryPage"
  }), pageA);
  assert.equal(findJournalRecordItem(actor, {
    sourceUuid: "JournalEntry.notes.JournalEntryPage.page-b",
    documentName: "JournalEntryPage"
  }), null);
  assert.equal(findJournalRecordItem(actor, {
    sourceUuid: "JournalEntry.notes",
    documentName: "JournalEntryPage"
  }), null);
});

test("Journal record Item builder rejects a non-canonical source row", () => {
  for (const row of [
    {},
    { sourceId: " JournalEntry.notes ", sourceDocumentName: "JournalEntry", name: "Notes" },
    { sourceId: "JournalEntry.notes", sourceDocumentName: "Item", name: "Notes" }
  ]) {
    assert.throws(() => buildJournalRecordItemData(row), /Journal reference/u);
  }
});
