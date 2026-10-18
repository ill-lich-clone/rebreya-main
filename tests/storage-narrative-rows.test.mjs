import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLootgenNarrativeCatalog } from "../scripts/data/lootgen-narrative-catalog.js";
import { prepareStorageNarrativeRows } from "../scripts/data/storage-narrative-rows.js";

const scope = "rebreya-main";
const catalog = normalizeLootgenNarrativeCatalog({ schemaVersion: 1, variants: [
  { variantId: "book-a", gearId: "book", sourceName: "Книга", title: "Летопись", description: "История города.", rank: 1 },
  { variantId: "book-b", gearId: "book", sourceName: "Книга", title: "Дневник", description: "Записки моряка.", rank: 1 }
] });
const row = (quantity = 1) => ({ rowId: "book", sourceType: "gear", sourceId: "book", name: "Книга", quantity,
  itemData: { name: "Книга", type: "loot", system: { quantity, description: { value: "generic" }, price: { value: 25, denomination: "gp" } },
    flags: { [scope]: { gearId: "book", durability: { value: 7 } }, other: { keep: true } } } });

test("personalisation creates one selected non-stacking instance per physical copy without mutating its source", () => {
  const input = row(3), before = structuredClone(input);
  let id = 0, draws = 0;
  const rows = prepareStorageNarrativeRows([input], catalog, { random: () => (++draws === 1 ? 0 : 0.999), idFactory: () => `copy-${++id}` });
  assert.equal(rows.length, 3);
  assert.equal(rows.reduce((sum, entry) => sum + entry.quantity, 0), 3);
  assert.equal(new Set(rows.map(entry => entry.rowId)).size, 3);
  assert.deepEqual(rows.map(entry => entry.itemData.name), ["Летопись", "Дневник", "Дневник"]);
  for (const entry of rows) {
    assert.equal(entry.quantity, 1); assert.equal(entry.itemData.system.quantity, 1); assert.equal(entry.stackable, false);
    assert.equal(entry.name, entry.itemData.name);
    assert.equal(entry.itemData.flags[scope].nonStackable, true);
    assert.deepEqual(entry.itemData.system.price, before.itemData.system.price);
    assert.deepEqual(entry.itemData.flags[scope].durability, { value: 7 });
  }
  assert.deepEqual(input, before);
  const again = prepareStorageNarrativeRows(rows, catalog, { random: () => assert.fail("reroll") });
  assert.deepEqual(again, rows);
});

test("stored identity and custom text survive a changed catalogue and empty names restore the same selected title", () => {
  const [selected] = prepareStorageNarrativeRows([row()], catalog, { random: () => 0 });
  selected.itemData.name = ""; selected.name = "";
  selected.itemData.system.description.value = "<p>Saved custom text</p>";
  const empty = normalizeLootgenNarrativeCatalog({ schemaVersion: 1, variants: [] });
  const [repaired] = prepareStorageNarrativeRows([selected], empty, { random: () => assert.fail("reroll") });
  assert.equal(repaired.name, "Летопись");
  assert.equal(repaired.itemData.flags[scope].narrativeVariantId, "book-a");
  assert.equal(repaired.itemData.system.description.value, "<p>Saved custom text</p>");
  repaired.itemData.name = "Моя книга";
  assert.equal(prepareStorageNarrativeRows([repaired], catalog)[0].itemData.name, "Моя книга");
});

test("claimed rows and unrelated fractional material or Journal rows remain unchanged", () => {
  const claimed = row(2);
  const material = { rowId: "dust", quantity: 0.05, itemData: { name: "Пыль", flags: { [scope]: { materialId: "dust" } }, system: { quantity: 1 } } };
  const journal = { rowKind: "journal", rowId: "notes", sourceId: "JournalEntry.notes", quantity: 1 };
  const rows = [claimed, material, journal];
  assert.deepEqual(prepareStorageNarrativeRows(rows, catalog, { claimedRowIds: ["book"], random: () => assert.fail("unexpected draw") }), rows);
});

test("nested container contents personalise without changing container identity or claimed children", () => {
  const inner = row(2);
  const container = { rowKind: "container", rowId: "bag", quantity: 1, name: "Сумка", container: {
    containerId: "stable-bag", state: { manualRows: [inner], generatedRows: [], claimedRowIds: [] }
  } };
  let id = 0;
  const [result] = prepareStorageNarrativeRows([container], catalog, { random: () => 0, idFactory: () => `nested-${++id}` });
  assert.equal(result.container.containerId, "stable-bag");
  assert.equal(result.container.state.manualRows.length, 2);
  assert.equal(result.container.state.manualRows[0].itemData.name, "Летопись");
  assert.equal(container.container.state.manualRows.length, 1);
});

test("personalised container shells retain their chosen ItemData and stable container identity", () => {
  const shell = row().itemData;
  shell.type = "container";
  const container = { rowKind: "container", rowId: "book-case", quantity: 1, container: {
    containerId: "stable-case", name: "Книга", state: { baseName: "Книга", manualRows: [], generatedRows: [] }, presentation: { itemData: shell }
  } };
  const [result] = prepareStorageNarrativeRows([container], catalog, { random: () => 0 });
  assert.equal(result.container.containerId, "stable-case");
  assert.equal(result.container.name, "Летопись");
  assert.equal(result.container.presentation.itemData.flags[scope].narrativeVariantId, "book-a");
  assert.equal(result.container.presentation.itemData.name, result.name);
});
