import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLootgenNarrativeVariant,
  hasLootgenNarrative,
  loadLootgenNarrativeCatalog,
  normalizeLootgenNarrativeCatalog,
  pickLootgenNarrativeFields,
  selectLootgenNarrativeVariant
} from "../scripts/data/lootgen-narrative-catalog.js";

const variant = Object.freeze({
  variantId: "book-scorched",
  gearId: "book",
  sourceName: "Книга",
  title: "Следы копоти",
  description: "Края обуглены.",
  rank: 1
});

test("catalog groups variants and applies only the description plus module flags", () => {
  const catalog = normalizeLootgenNarrativeCatalog({ schemaVersion: 1, variants: [variant] });
  const selected = selectLootgenNarrativeVariant({
    sourceType: "gear",
    sourceId: "book",
    narrativeVariants: catalog.byGearId.get("book")
  }, () => 0);
  const base = {
    name: "Книга",
    type: "loot",
    img: "book.webp",
    system: {
      description: { value: "base", chat: "keep" },
      quantity: 5,
      price: { value: 7, denomination: "gp" }
    },
    flags: { "rebreya-main": { existing: true }, other: { keep: true } }
  };

  const item = applyLootgenNarrativeVariant(base, selected);

  assert.equal(item.name, "Книга");
  assert.equal(item.type, "loot");
  assert.equal(item.img, "book.webp");
  assert.equal(item.system.quantity, 1);
  assert.deepEqual(item.system.price, base.system.price);
  assert.equal(item.system.description.chat, "keep");
  assert.match(item.system.description.value, /Следы копоти/u);
  assert.equal(item.flags["rebreya-main"].narrativeVariantId, "book-scorched");
  assert.equal(item.flags["rebreya-main"].narrativeGearId, "book");
  assert.equal(item.flags["rebreya-main"].nonStackable, true);
  assert.equal(item.flags["rebreya-main"].existing, true);
  assert.equal(hasLootgenNarrative(item), true);
  assert.equal(hasLootgenNarrative({ getFlag: (_scope, key) => key === "narrativeVariantId" ? "book-scorched" : undefined }), true);
  assert.equal(base.system.quantity, 5, "base Item data stays detached");
});

test("catalog rejects malformed schemas duplicate identities and duplicate semantic rows", () => {
  assert.throws(() => normalizeLootgenNarrativeCatalog({ schemaVersion: 2, variants: [] }), /schemaVersion/u);
  assert.throws(() => normalizeLootgenNarrativeCatalog({
    schemaVersion: 1,
    variants: [variant, { ...variant, gearId: "rope" }]
  }), /duplicate narrative variantId/u);
  assert.throws(() => normalizeLootgenNarrativeCatalog({
    schemaVersion: 1,
    variants: [variant, { ...variant, variantId: "book-scorched-copy" }]
  }), /duplicate narrative semantic row/u);
  assert.throws(() => normalizeLootgenNarrativeCatalog({
    schemaVersion: 1,
    variants: [{ ...variant, description: "" }]
  }), /description/u);
});

test("same narrative text on different gear remains distinct", () => {
  const catalog = normalizeLootgenNarrativeCatalog({
    schemaVersion: 1,
    variants: [
      variant,
      { ...variant, variantId: "rope-scorched", gearId: "rope", sourceName: "Верёвка" }
    ]
  });

  assert.equal(catalog.byVariantId.size, 2);
  assert.equal(catalog.byGearId.get("book")[0].variantId, "book-scorched");
  assert.equal(catalog.byGearId.get("rope")[0].variantId, "rope-scorched");
});

test("variant rendering escapes HTML and omits an empty title heading", () => {
  const item = applyLootgenNarrativeVariant({
    name: "Книга",
    system: { description: { value: "base" }, quantity: 3 },
    flags: {}
  }, {
    ...variant,
    title: "",
    description: "<script>bad()</script>\nA & B"
  });

  assert.doesNotMatch(item.system.description.value, /<script>/u);
  assert.doesNotMatch(item.system.description.value, /<h3><\/h3>/u);
  assert.match(item.system.description.value, /&lt;script&gt;bad\(\)&lt;\/script&gt;<br>A &amp; B/u);
});

test("selection validates RNG and narrative row projection keeps only carried fields", () => {
  const variants = [variant, { ...variant, variantId: "book-clean", title: "Чистая" }];
  assert.equal(selectLootgenNarrativeVariant({ narrativeVariants: variants }, () => 0).variantId, "book-scorched");
  assert.equal(selectLootgenNarrativeVariant({ narrativeVariants: variants }, () => 0.999999).variantId, "book-clean");
  assert.equal(selectLootgenNarrativeVariant({}, () => 0), null);
  for (const draw of [-0.1, 1, Number.NaN]) {
    assert.throws(() => selectLootgenNarrativeVariant({ narrativeVariants: variants }, () => draw), /\[0,1\)/u);
  }

  const source = {
    narrativeVariantId: "book-scorched",
    narrativeGearId: "book",
    narrativeTitle: "Следы копоти",
    narrativeDescription: "Края обуглены.",
    ignored: true
  };
  assert.deepEqual(pickLootgenNarrativeFields(source), {
    narrativeVariantId: "book-scorched",
    narrativeGearId: "book",
    narrativeTitle: "Следы копоти",
    narrativeDescription: "Края обуглены."
  });
});

test("runtime loader fetches validates and caches the local catalog", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    assert.equal(url, "modules/rebreya-main/data/lootgen-narrative-variants.json");
    return { ok: true, json: async () => ({ schemaVersion: 1, variants: [variant] }) };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const first = await loadLootgenNarrativeCatalog();
  const second = await loadLootgenNarrativeCatalog();

  assert.equal(first, second);
  assert.equal(first.byVariantId.get("book-scorched").gearId, "book");
  assert.equal(calls, 1);
});
