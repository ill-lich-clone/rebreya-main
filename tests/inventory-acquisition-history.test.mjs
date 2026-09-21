import test from "node:test";
import assert from "node:assert/strict";

import {
  INVENTORY_ACQUISITION_HISTORY_FLAG,
  INVENTORY_ACQUISITION_HISTORY_VERSION,
  MAX_INVENTORY_ACQUISITION_ENTRIES,
  appendInventoryAcquisitionEntry,
  normalizeInventoryAcquisitionEntry,
  normalizeInventoryAcquisitionHistory,
  readInventoryAcquisitionHistory,
  writeInventoryAcquisitionHistory
} from "../scripts/data/inventory-acquisition-history.js";

function entry(overrides = {}) {
  return {
    recordedAt: 1,
    worldTime: null,
    quantity: 1,
    method: "storage",
    sceneId: "scene",
    sceneName: "Сцена",
    sourceType: "token",
    sourceId: "source",
    sourceName: "Источник",
    detail: "",
    ...overrides
  };
}

test("acquisition history keeps the newest ten detached valid entries", () => {
  const raw = { version: 1, entries: Array.from({ length: 11 }, (_, index) => entry({
    recordedAt: index + 1,
    sceneName: " Сцена ",
    sourceId: String(index),
    sourceName: `Источник ${index}`
  })) };

  const result = normalizeInventoryAcquisitionHistory(raw);

  assert.equal(INVENTORY_ACQUISITION_HISTORY_FLAG, "inventoryAcquisitionHistory");
  assert.equal(INVENTORY_ACQUISITION_HISTORY_VERSION, 1);
  assert.equal(MAX_INVENTORY_ACQUISITION_ENTRIES, 10);
  assert.equal(result.entries.length, 10);
  assert.deepEqual(result.entries.map((value) => value.recordedAt), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  assert.equal(result.entries[0].sceneName, "Сцена");
  assert.equal(raw.entries[0].sceneName, " Сцена ");
  assert.notStrictEqual(result.entries[0], raw.entries[10]);
});

test("acquisition entry normalizes enum and bounded strings while preserving equal-time order", () => {
  const longDisplay = ` <Гоблин>${"я".repeat(200)}`;
  const longDetail = "д".repeat(600);
  const raw = { version: 1, entries: [
    entry({ recordedAt: 5, sourceId: "first", method: "unknown", sourceName: longDisplay, detail: longDetail }),
    entry({ recordedAt: 5, sourceId: "second" })
  ] };

  const normalized = normalizeInventoryAcquisitionHistory(raw);

  assert.deepEqual(normalized.entries.map((value) => value.sourceId), ["first", "second"]);
  assert.equal(normalized.entries[0].method, "other");
  assert.equal(normalized.entries[0].sourceName.length, 160);
  assert.equal(normalized.entries[0].detail.length, 500);
  assert.equal(normalized.entries[0].sourceName.startsWith("<Гоблин>"), true);
});

test("acquisition entry rejects invalid numbers and legacy history reads as empty", () => {
  for (const invalid of [
    entry({ recordedAt: -1 }),
    entry({ recordedAt: Number.POSITIVE_INFINITY }),
    entry({ worldTime: Number.NaN }),
    entry({ quantity: 0 }),
    entry({ quantity: Number.NaN })
  ]) assert.equal(normalizeInventoryAcquisitionEntry(invalid), null);

  assert.deepEqual(readInventoryAcquisitionHistory({}), { version: 1, entries: [] });
  assert.deepEqual(readInventoryAcquisitionHistory({ flags: { "rebreya-main": {
    inventoryAcquisitionHistory: { version: 99, entries: [entry()] }
  } } }), { version: 1, entries: [] });
  assert.deepEqual(appendInventoryAcquisitionEntry(null, { recordedAt: 1, quantity: Number.NaN }), {
    version: 1,
    entries: []
  });
});

test("append adds one normalized newest event without mutating history", () => {
  const raw = { version: 1, entries: [entry({ recordedAt: 1, sourceId: "old" })] };
  const appended = appendInventoryAcquisitionEntry(raw, entry({ recordedAt: 2, sourceId: "new" }));

  assert.deepEqual(appended.entries.map((value) => value.sourceId), ["new", "old"]);
  assert.deepEqual(raw.entries.map((value) => value.sourceId), ["old"]);
});

test("write stores normalized history on a detached ItemData clone", () => {
  const itemData = { name: "Предмет", flags: { other: { kept: true } } };
  const written = writeInventoryAcquisitionHistory(itemData, {
    version: 1,
    entries: [entry({ sourceName: " <Гоблин> " })]
  });

  assert.notStrictEqual(written, itemData);
  assert.notStrictEqual(written.flags, itemData.flags);
  assert.deepEqual(itemData, { name: "Предмет", flags: { other: { kept: true } } });
  assert.equal(written.flags.other.kept, true);
  assert.equal(written.flags["rebreya-main"].inventoryAcquisitionHistory.entries[0].sourceName, "<Гоблин>");
});
