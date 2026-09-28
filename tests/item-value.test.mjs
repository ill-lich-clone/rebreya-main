import test from "node:test";
import assert from "node:assert/strict";
import { evaluateItemValue, addItemValue, resolveLootgenItemValue } from "../scripts/data/item-value.js";
const descriptor = () => ({ version: 2, instanceKey: "h", sourceType: "gear", sourceId: "sword", quantity: 1, isBroken: false, container: null,
  upgrades: [{ instanceKey: "a", sourceId: "u1", slotIndex: 1, choices: {} }, { instanceKey: "b", sourceId: "u2", slotIndex: 2, choices: {} }] });
const reader = { resolveValueComponent: ({ sourceId }) => ({ unitValue: { sword: 1000, u1: 200, u2: 300 }[sourceId], priceKnown: true, includedUpgradeSourceIds: [] }), readContainerValueNodes: null };
test("host plus two upgrades counted once and inputs immutable", () => {
  const d = descriptor(), before = structuredClone(d);
  assert.deepEqual(evaluateItemValue(d, reader), { baseValue: 1000, upgradeValue: 500, contentsValue: 0, totalValue: 1500, diagnostics: [] });
  assert.deepEqual(d, before);
  assert.equal(evaluateItemValue({ ...d, quantity: 3, upgrades: [] }, reader).totalValue, 3000);
});
test("included upgrade IDs are a multiset, not blanket exclusion", () => {
  const d = descriptor(); d.upgrades[1].sourceId = "u1";
  const r = { ...reader, resolveValueComponent: s => ({ ...reader.resolveValueComponent(s), includedUpgradeSourceIds: s.sourceId === "sword" ? ["u1"] : [] }) };
  assert.equal(evaluateItemValue(d, r).totalValue, 1200);
});
test("safe copper arithmetic distinguishes unknown and explicit zero; legacy zero keeps fallback", () => {
  const d = { ...descriptor(), upgrades: [] };
  assert.equal(evaluateItemValue(d, { resolveValueComponent: () => ({ unitValue: 0, priceKnown: true }) }).totalValue, 0);
  for (const price of [undefined, { unitValue: 0, priceKnown: false }]) assert.throws(() => evaluateItemValue(d, { resolveValueComponent: () => price }), e => e.code === "unknown-price");
  for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => evaluateItemValue(d, { resolveValueComponent: () => ({ unitValue: value, priceKnown: true }) }), e => e.code === "overflow");
  assert.throws(() => addItemValue(Number.MAX_SAFE_INTEGER, 1), e => e.code === "overflow");
  assert.equal(addItemValue(Number.MAX_SAFE_INTEGER, 0), Number.MAX_SAFE_INTEGER);
  assert.throws(() => evaluateItemValue({ ...d, quantity: 2 }, { resolveValueComponent: () => ({ unitValue: Number.MAX_SAFE_INTEGER, priceKnown: true }) }), e => e.code === "overflow");
  assert.equal(resolveLootgenItemValue(0, 2.5), 250);
  assert.equal(resolveLootgenItemValue("12.9", 2.5), 12);
});
test("corrupt descriptors cannot silently contribute a partial price", () => {
  for (const change of [d => d.quantity = 2, d => d.quantity = 0, d => d.quantity = 1.5, d => d.version = 1,
    d => d.upgrades[1].instanceKey = "a", d => d.upgrades[0].instanceKey = "h", d => d.upgrades[1].slotIndex = 1,
    d => d.upgrades[0].slotIndex = 4, d => d.upgrades[0].choices = [], d => d.sourceId = "", d => d.upgrades = {}]) {
    const d = descriptor(); change(d);
    assert.throws(() => evaluateItemValue(d, reader), e => e.code === "invalid-descriptor");
  }
  assert.throws(() => evaluateItemValue({ ...descriptor(), container: {} }, reader), e => e.code === "unsupported-container");
  assert.throws(() => evaluateItemValue(descriptor(), { resolveValueComponent: () => ({ unitValue: 1, priceKnown: true, upgradeProfile: "corrupt" }) }), e => e.code === "invalid-descriptor");
});
