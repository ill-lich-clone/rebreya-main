import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeInventoryAddSearchText,
  resolveInventoryAddAttempt,
  resolveInventoryAddDialogHeight,
  searchInventoryAddCatalog,
  validateManualInventoryEntry
} from "../scripts/ui/inventory-item-add-dialog.js";

const catalog = Object.freeze([
  Object.freeze({ id: "gear:rope", sourceType: "gear", sourceId: "rope", name: "Верёвка 50 футов" }),
  Object.freeze({ id: "gear:rope-alt", sourceType: "gear", sourceId: "rope-alt", name: "Веревка 50 футов" }),
  Object.freeze({ id: "material:oak", sourceType: "material", sourceId: "oak", name: "Дуб" }),
  Object.freeze({ id: "magic:glass", sourceType: "magicItem", sourceId: "glass", name: "«Стеклянный» ключ" })
]);

test("inventory add search normalizes whitespace, case and accepted quote variants without dropping numbers", () => {
  assert.equal(normalizeInventoryAddSearchText("  ВЕРЁВКА   50  футов "), "верёвка 50 футов");
  assert.equal(normalizeInventoryAddSearchText("“Стеклянный” ключ"), '"стеклянный" ключ');
  assert.notEqual(normalizeInventoryAddSearchText("Верёвка 5 футов"), normalizeInventoryAddSearchText("Верёвка 50 футов"));
});

test("inventory add search auto-selects only one exact match", () => {
  const unique = searchInventoryAddCatalog(catalog, "Дуб");
  assert.deepEqual(unique.exactMatches.map((entry) => entry.sourceId), ["oak"]);
  assert.equal(unique.autoSelectedId, "material:oak");

  const ambiguousCatalog = [
    { id: "gear:a", sourceType: "gear", sourceId: "a", name: "Факел" },
    { id: "gear:b", sourceType: "gear", sourceId: "b", name: "Факел" }
  ];
  const ambiguous = searchInventoryAddCatalog(ambiguousCatalog, "факел");
  assert.equal(ambiguous.exactMatches.length, 2);
  assert.equal(ambiguous.autoSelectedId, "");
});

test("inventory add search ranks similar matches but never auto-selects them", () => {
  const result = searchInventoryAddCatalog(catalog, "верёвка 50");
  assert.equal(result.exactMatches.length, 0);
  assert.equal(result.similarMatches[0].sourceId, "rope");
  assert.equal(result.autoSelectedId, "");
  assert.equal(result.canAddManual, true);
});

test("manual inventory entry validates decimal commas and computes per-unit and total values", () => {
  const result = validateManualInventoryEntry({
    name: "  Дорожный набор  ",
    quantity: "3",
    unitWeight: "2,5",
    unitPriceValue: "4",
    unitPriceDenomination: "gp",
    itemType: "",
    material: "  Ткань  "
  });

  assert.deepEqual(result, {
    name: "Дорожный набор",
    quantity: 3,
    unitWeight: 2.5,
    totalWeight: 7.5,
    unitPriceValue: 4,
    unitPriceDenomination: "gp",
    unitPriceCopper: 400,
    totalPriceCopper: 1200,
    itemType: "Прочее",
    material: "Ткань"
  });
  assert.throws(() => validateManualInventoryEntry({ name: "", quantity: 1 }), /название/u);
  assert.throws(() => validateManualInventoryEntry({ name: "A", quantity: "1.5" }), /целым/u);
  assert.throws(() => validateManualInventoryEntry({ name: "A", quantity: 1, unitWeight: "-1" }), /вес/iu);
});

test("inventory add retries keep one operation identity until the submitted form changes", () => {
  let id = 0;
  const factory = (prefix) => `${prefix}-${++id}`;
  const first = resolveInventoryAddAttempt(null, "same-form", factory);
  const retry = resolveInventoryAddAttempt(first, "same-form", factory);
  const changed = resolveInventoryAddAttempt(retry, "changed-form", factory);

  assert.equal(retry, first);
  assert.equal(retry.batchMutationId, "inventory-add-1");
  assert.equal(retry.manualEntryId, "manual-entry-2");
  assert.notEqual(changed.batchMutationId, first.batchMutationId);
  assert.notEqual(changed.manualEntryId, first.manualEntryId);
});

test("inventory add dialog reserves usable height without escaping the viewport", () => {
  assert.equal(resolveInventoryAddDialogHeight(920), 720);
  assert.equal(resolveInventoryAddDialogHeight(600), 520);
  assert.equal(resolveInventoryAddDialogHeight(480), 400);
});

test("inventory add catalog rows override Foundry button height for two-line descriptions", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  const rule = css.match(/\.rm-inventory-item-add-result\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
  assert.match(rule, /height:\s*auto/u);
  assert.match(rule, /min-height:\s*56px/u);
  assert.match(rule, /line-height:\s*1\.25/u);
  assert.match(css, /@media \(max-width: 700px\), \(max-height: 700px\)[\s\S]*?\.rm-inventory-item-add-dialog__results\s*\{[\s\S]*?max-height:\s*140px/u);
});
