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

function startTagRecords(html) {
  const source = String(html);
  const records = [];
  const pattern = /<([a-z][\w:-]*)(\s[^<>]*?)?\s*\/?>/giu;
  for (const match of source.matchAll(pattern)) {
    const attributes = new Map();
    const attributeSource = match[2] ?? "";
    const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu;
    for (const attribute of attributeSource.matchAll(attributePattern)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    records.push({
      start: match.index,
      end: match.index + match[0].length,
      tagName: match[1].toUpperCase(),
      attributes,
      selfClosing: /\/>$/u.test(match[0])
    });
  }
  return records;
}

function serializeStartTagRecords(html, records) {
  let cursor = 0;
  let result = "";
  for (const record of records) {
    result += html.slice(cursor, record.start);
    const attributes = Array.from(record.attributes, ([name, value]) => (
      value === "" ? name : `${name}="${value}"`
    ));
    result += `<${record.tagName.toLowerCase()}${attributes.length ? ` ${attributes.join(" ")}` : ""}${record.selfClosing ? "/" : ""}>`;
    cursor = record.end;
  }
  return result + html.slice(cursor);
}

function createSemanticTemplateDocument() {
  const assignedHtml = [];
  return {
    assignedHtml,
    createElement(tagName) {
      assert.equal(tagName, "template");
      let html = "";
      let records = [];
      const elements = () => records.map((record) => ({
        tagName: record.tagName,
        get attributes() {
          return Array.from(record.attributes, ([name, value]) => ({ name, value }));
        },
        getAttribute(name) {
          return record.attributes.get(String(name).toLowerCase()) ?? null;
        },
        setAttribute(name, value) {
          record.attributes.set(String(name).toLowerCase(), String(value));
        },
        removeAttribute(name) {
          record.attributes.delete(String(name).toLowerCase());
        }
      }));
      const content = {
        querySelector(selector) {
          assert.equal(selector, "section.secret:not(.revealed)");
          const serialized = serializeStartTagRecords(html, records);
          const match = sectionStartTags(serialized).find((startTag) => {
            const classes = classTokens(startTag);
            return classes.includes("secret") && !classes.includes("revealed");
          });
          return match ? { tagName: "SECTION", startTag: match } : null;
        },
        querySelectorAll(selector) {
          assert.equal(selector, "*");
          return elements();
        }
      };
      return {
        content,
        set innerHTML(value) {
          html = String(value);
          records = startTagRecords(html);
          assignedHtml.push(html);
        },
        get innerHTML() {
          return serializeStartTagRecords(html, records);
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

test("Journal reader removes enriched document-link metadata and affordances while preserving readable text", async () => {
  const { journal } = createJournalFixture();
  const { parseHtml } = createTestHtmlParser();
  const enriched = [
    '<p>Маршрут ведёт к ',
    '<a class="content-link document-link draggable" draggable="true" href="#" ',
    'data-uuid="JournalEntry.secret-map" data-document-id="secret-map" data-id="legacy-secret" ',
    'data-action="openDocument"><i class="fas fa-book-open"></i>Старой карте</a>.',
    '</p>'
  ].join("");
  const reader = new StorageJournalReader({
    fromUuid: async () => journal,
    enrichHtml: async () => enriched,
    parseHtml
  });

  const snapshot = await reader.read(journal.uuid);
  const html = snapshot.pages.find((page) => page.type === "text").html;

  assert.match(html, /Старой карте/u);
  assert.match(html, /Маршрут ведёт/u);
  assert.equal(html.includes("JournalEntry.secret-map"), false);
  assert.equal(html.includes("secret-map"), false);
  assert.equal(html.includes("legacy-secret"), false);
  assert.doesNotMatch(html, /\b(?:content-link|document-link|draggable)\b/u);
  assert.doesNotMatch(html, /\b(?:data-[\w-]+|draggable|href)\s*=/u);
});

test("Journal reader fails closed when parsed HTML cannot be queried or serialized", async () => {
  const { journal } = createJournalFixture();
  for (const parseHtml of [
    () => ({ querySelector() { return null; } }),
    () => ({ querySelector() { return null; }, querySelectorAll() { return []; }, serialize() { throw new Error("serialize failure"); } })
  ]) {
    const reader = new StorageJournalReader({
      fromUuid: async () => journal,
      enrichHtml: async () => "<p>Открытый текст</p>",
      parseHtml
    });

    await assert.rejects(reader.read(journal.uuid), { message: "Запись журнала недоступна." });
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
