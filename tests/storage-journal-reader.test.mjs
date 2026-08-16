import test from "node:test";
import assert from "node:assert/strict";

import {
  StorageJournalReader,
  createStorageJournalHtmlParser
} from "../scripts/data/storage-journal-reader.js";

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

function decodeNumericCharacterReferences(value) {
  return String(value).replace(/&#(?:(x)([0-9a-f]+)|([0-9]+));?/giu, (_match, hex, hexValue, decimalValue) => {
    const codePoint = Number.parseInt(hex ? hexValue : decimalValue, hex ? 16 : 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
  });
}

function sectionStartTags(html) {
  const source = String(html);
  const lower = source.toLowerCase();
  const tags = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = lower.indexOf("<section", cursor);
    if (start < 0) break;
    const boundary = source[start + "<section".length];
    if (boundary && !/[\s/>]/u.test(boundary)) {
      cursor = start + 1;
      continue;
    }
    let quote = "";
    let end = -1;
    for (let index = start + "<section".length; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === ">") {
        end = index;
        break;
      }
    }
    if (end < 0) break;
    tags.push(source.slice(start, end + 1));
    cursor = end + 1;
  }
  return tags;
}

function classTokens(startTag) {
  const match = startTag.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu);
  if (!match) return [];
  return decodeNumericCharacterReferences(match[1] ?? match[2] ?? match[3])
    .split(/\s+/u)
    .filter(Boolean);
}

function createSemanticTemplateDocument() {
  const assignedHtml = [];
  return {
    assignedHtml,
    createElement(tagName) {
      assert.equal(tagName, "template");
      let html = "";
      const content = {
        querySelector(selector) {
          assert.equal(selector, "section.secret:not(.revealed)");
          const match = sectionStartTags(html).find((startTag) => {
            const classes = classTokens(startTag);
            return classes.includes("secret") && !classes.includes("revealed");
          });
          return match ? { tagName: "SECTION", startTag: match } : null;
        }
      };
      return {
        content,
        set innerHTML(value) {
          html = String(value);
          assignedHtml.push(html);
        },
        get innerHTML() {
          return html;
        }
      };
    }
  };
}

function createTestHtmlParser() {
  const document = createSemanticTemplateDocument();
  return { document, parseHtml: createStorageJournalHtmlParser(() => document) };
}

test("Journal reader enriches live text without secrets or document metadata and never mutates ownership", async () => {
  const { journal, textPage } = createJournalFixture();
  const enrichCalls = [];
  const { parseHtml } = createTestHtmlParser();
  const reader = new StorageJournalReader({
    fromUuid: async (uuid) => uuid === journal.uuid ? journal : null,
    enrichHtml: async (content, options) => {
      enrichCalls.push({ content, options });
      return content.replace(/<section class="secret">[\s\S]*?<\/section>/gu, "");
    },
    parseHtml
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
  const { parseHtml } = createTestHtmlParser();
  const missingReader = new StorageJournalReader({
    fromUuid: async () => null,
    enrichHtml: async (content) => content,
    parseHtml
  });
  await assert.rejects(missingReader.read(journal.uuid), { message: "Запись журнала недоступна." });
  assert.deepEqual(storageRow, beforeRow);

  const unsafeReader = new StorageJournalReader({
    fromUuid: async () => journal,
    enrichHtml: async (content) => content,
    parseHtml
  });
  await assert.rejects(unsafeReader.read(journal.uuid), { message: "Запись журнала недоступна." });

  const failedReader = new StorageJournalReader({
    fromUuid: async () => journal,
    enrichHtml: async () => { throw new Error("raw GM failure"); },
    parseHtml
  });
  await assert.rejects(failedReader.read(journal.uuid), (error) => {
    assert.equal(error.message, "Запись журнала недоступна.");
    assert.equal(error.message.includes("raw GM failure"), false);
    return true;
  });
});

test("Journal reader rejects browser-semantic secret classes that evade raw tag regexes", async () => {
  const { journal } = createJournalFixture();
  const { document, parseHtml } = createTestHtmlParser();
  const adversarialHtml = [
    '<section class="sec&#114;et"><p>Тайный пароль entity</p></section>',
    '<section data-note=">" class="secret"><p>Тайный пароль quoted</p></section>'
  ];

  for (const html of adversarialHtml) {
    const parseCalls = [];
    const reader = new StorageJournalReader({
      fromUuid: async () => journal,
      enrichHtml: async () => html,
      parseHtml: (value) => {
        parseCalls.push(value);
        return parseHtml(value);
      }
    });

    await assert.rejects(reader.read(journal.uuid), { message: "Запись журнала недоступна." });
    assert.deepEqual(parseCalls, [html]);
    assert.equal(document.assignedHtml.at(-1), html);
  }
});

test("production Journal HTML adapter exposes browser-semantic secret selectors", () => {
  const { document, parseHtml } = createTestHtmlParser();
  for (const html of [
    '<section class="sec&#114;et"><p>entity case</p></section>',
    '<section data-note=">" class="secret"><p>quoted case</p></section>'
  ]) {
    const fragment = parseHtml(html);
    assert.ok(fragment.querySelector("section.secret:not(.revealed)"));
    assert.equal(document.assignedHtml.at(-1), html);
  }

  const revealed = parseHtml('<section class="secret revealed"><p>visible case</p></section>');
  assert.equal(revealed.querySelector("section.secret:not(.revealed)"), null);
});
