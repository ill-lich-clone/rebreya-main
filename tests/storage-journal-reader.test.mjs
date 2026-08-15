import test from "node:test";
import assert from "node:assert/strict";

import { StorageJournalReader } from "../scripts/data/storage-journal-reader.js";

function createJournalFixture() {
  const textPage = {
    id: "page-text",
    uuid: "JournalEntry.notes.JournalEntryPage.page-text",
    documentName: "JournalEntryPage",
    name: "Запись",
    type: "text",
    sort: 20,
    title: { show: true, level: 2 },
    text: {
      content: '<p>Открытая запись</p><section class="secret"><p>Тайный пароль</p></section>'
    },
    ownership: { default: 0, gm: 3 },
    flags: { secretModule: { raw: true } }
  };
  const imagePage = {
    id: "page-image",
    uuid: "JournalEntry.notes.JournalEntryPage.page-image",
    documentName: "JournalEntryPage",
    name: "Карта",
    type: "image",
    sort: 10,
    title: { show: false, level: 1 },
    src: "maps/camp.webp",
    image: { caption: "Лагерь" },
    ownership: { default: 0, gm: 3 },
    flags: { secretModule: { raw: true } }
  };
  const journal = {
    id: "notes",
    uuid: "JournalEntry.notes",
    documentName: "JournalEntry",
    name: "Полевые заметки",
    ownership: { default: 0, gm: 3 },
    flags: { secretModule: { raw: true } },
    pages: { contents: [textPage, imagePage] },
    updateCalls: [],
    async update(patch) {
      this.updateCalls.push(patch);
    }
  };
  return { journal, textPage };
}

test("Journal reader enriches live text without secrets or document metadata and never mutates ownership", async () => {
  const { journal, textPage } = createJournalFixture();
  const enrichCalls = [];
  const reader = new StorageJournalReader({
    fromUuid: async (uuid) => uuid === journal.uuid ? journal : null,
    enrichHtml: async (content, options) => {
      enrichCalls.push({ content, options });
      return content.replace(/<section class="secret">[\s\S]*?<\/section>/gu, "");
    }
  });
  const beforeOwnership = structuredClone(journal.ownership);

  const snapshot = await reader.read(journal.uuid);

  assert.equal(JSON.stringify(snapshot).includes("Тайный пароль"), false);
  assert.equal(JSON.stringify(snapshot).includes('section class="secret"'), false);
  assert.deepEqual(journal.ownership, beforeOwnership);
  assert.equal(journal.updateCalls.length, 0);
  assert.equal("uuid" in snapshot, false);
  assert.equal("ownership" in snapshot, false);
  assert.equal(JSON.stringify(snapshot).includes("JournalEntry.notes"), false);
  assert.equal(JSON.stringify(snapshot).includes("secretModule"), false);
  assert.deepEqual(snapshot.pages.map((page) => page.pageId), ["page-image", "page-text"]);
  assert.deepEqual(enrichCalls[0].options, {
    relativeTo: journal.pages.contents[0],
    secrets: false,
    documents: false,
    links: false,
    embeds: false,
    rolls: false,
    custom: false
  });

  textPage.text.content = "<p>Новая открытая запись</p>";
  const secondSnapshot = await reader.read(journal.uuid);
  assert.notDeepEqual(secondSnapshot, snapshot);
  assert.match(secondSnapshot.pages[1].html, /Новая открытая запись/u);
});

test("Journal reader fails closed for deleted Journals, enrichment errors, and remaining unrevealed secrets", async () => {
  const { journal } = createJournalFixture();
  const storageRow = {
    rowKind: "journal",
    rowId: "journal-row",
    sourceId: journal.uuid,
    ownership: { default: 0 }
  };
  const beforeRow = structuredClone(storageRow);
  const missingReader = new StorageJournalReader({
    fromUuid: async () => null,
    enrichHtml: async (content) => content
  });
  await assert.rejects(missingReader.read(journal.uuid), { message: "Запись журнала недоступна." });
  assert.deepEqual(storageRow, beforeRow);

  const unsafeReader = new StorageJournalReader({
    fromUuid: async () => journal,
    enrichHtml: async (content) => content
  });
  await assert.rejects(unsafeReader.read(journal.uuid), { message: "Запись журнала недоступна." });

  const failedReader = new StorageJournalReader({
    fromUuid: async () => journal,
    enrichHtml: async () => { throw new Error("raw GM failure"); }
  });
  await assert.rejects(failedReader.read(journal.uuid), (error) => {
    assert.equal(error.message, "Запись журнала недоступна.");
    assert.equal(error.message.includes("raw GM failure"), false);
    return true;
  });
});
