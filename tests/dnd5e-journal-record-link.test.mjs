import test from "node:test";
import assert from "node:assert/strict";

class FakeElement {
  constructor({ dataset = {}, selectors = {}, selectorAll = {} } = {}) {
    this.dataset = dataset;
    this.selectors = selectors;
    this.selectorAll = selectorAll;
    this.listeners = {};
  }

  querySelector(selector) {
    return this.selectors[selector] ?? null;
  }

  querySelectorAll(selector) {
    return this.selectorAll[selector] ?? [];
  }

  addEventListener(type, listener) {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }
}

async function loadBinder() {
  globalThis.HTMLElement ??= FakeElement;
  globalThis.game ??= { system: { id: "dnd5e" } };
  globalThis.CONFIG ??= { DND5E: {}, ux: {}, Dice: {} };
  globalThis.ui ??= { notifications: { error() {} } };
  globalThis.foundry ??= {
    utils: {
      getProperty(source, path) {
        return String(path ?? "").split(".").reduce((value, part) => value?.[part], source);
      }
    }
  };
  return import(`../scripts/integrations/dnd5e-sheet-extensions.js?journal-record-link=${Date.now()}`);
}

function makeRecordItem(overrides = {}) {
  return {
    id: "record-item",
    uuid: "Actor.hero.Item.record-item",
    flags: {
      "rebreya-main": {
        journalRecord: {
          version: 1,
          sourceUuid: "JournalEntry.notes.JournalEntryPage.page-a",
          documentName: "JournalEntryPage"
        }
      }
    },
    ...overrides
  };
}

test("journal record inventory title opens its exact source in read-only viewer once", async () => {
  const { bindJournalRecordInventoryLinks } = await loadBinder();
  const title = new FakeElement();
  const row = new FakeElement({
    dataset: { itemId: "record-item" },
    selectors: { ".item-name .name .title": title }
  });
  const root = new FakeElement({ selectorAll: { "[data-item-id]": [row] } });
  const item = makeRecordItem();
  const actor = { items: { get: (id) => id === item.id ? item : null } };
  const calls = [];
  const moduleApi = {
    async readJournalRecord(itemUuid) {
      calls.push(["read", itemUuid]);
      return { title: "Stored note", content: "<p>Text</p>" };
    }
  };
  const openViewer = (snapshot, options) => calls.push(["viewer", snapshot, options]);

  bindJournalRecordInventoryLinks(root, { actor, moduleApi, openViewer });
  bindJournalRecordInventoryLinks(root, { actor, moduleApi, openViewer });

  assert.equal(title.listeners.click.length, 1);
  const eventCalls = [];
  await title.listeners.click[0]({
    preventDefault: () => eventCalls.push("preventDefault"),
    stopPropagation: () => eventCalls.push("stopPropagation"),
    stopImmediatePropagation: () => eventCalls.push("stopImmediatePropagation")
  });
  assert.deepEqual(eventCalls, ["preventDefault", "stopPropagation", "stopImmediatePropagation"]);
  assert.deepEqual(calls, [
    ["read", item.uuid],
    ["viewer", { title: "Stored note", content: "<p>Text</p>" }, undefined]
  ]);
});

test("ordinary and malformed items retain native inventory behavior", async () => {
  const { bindJournalRecordInventoryLinks } = await loadBinder();
  const ordinaryTitle = new FakeElement();
  const malformedTitle = new FakeElement();
  const ordinaryRow = new FakeElement({
    dataset: { itemId: "ordinary" },
    selectors: { ".item-name .name .title": ordinaryTitle }
  });
  const malformedRow = new FakeElement({
    dataset: { itemId: "malformed" },
    selectors: { ".item-name .name .title": malformedTitle }
  });
  const root = new FakeElement({ selectorAll: { "[data-item-id]": [ordinaryRow, malformedRow] } });
  const items = new Map([
    ["ordinary", { id: "ordinary", uuid: "Actor.hero.Item.ordinary", flags: {} }],
    ["malformed", makeRecordItem({
      id: "malformed",
      flags: { "rebreya-main": { journalRecord: { sourceUuid: "JournalEntry.notes" } } }
    })]
  ]);

  bindJournalRecordInventoryLinks(root, {
    actor: { items: { get: (id) => items.get(id) } },
    moduleApi: { readJournalRecord: async () => assert.fail("ordinary item must not be intercepted") },
    openViewer: () => assert.fail("ordinary item must not open journal viewer")
  });

  assert.equal(ordinaryTitle.listeners.click, undefined);
  assert.equal(malformedTitle.listeners.click, undefined);
});
