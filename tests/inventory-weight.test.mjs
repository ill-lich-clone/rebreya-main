import test from "node:test";
import assert from "node:assert/strict";
import { buildActorInventoryWeightSnapshot, buildInventoryStorageProfile } from "../scripts/data/inventory-weight.js";

const item = (id, weight, parent = null) => ({ id, type: "loot", system: { container: parent, quantity: 1, weight: { value: weight, units: "lb" } } });
function container(id, weight, { parent = null, coins = {}, magical = false, capacity = null } = {}) {
  const result = item(id, weight, parent);
  result.type = "container";
  Object.assign(result.system, { currency: coins, properties: magical ? ["weightlessContents"] : [], capacity: { weight: capacity } });
  return result;
}
const actor = (items = [], currency = {}) => ({ items, system: { currency } });
const snapshot = (items = [], currency = {}) => buildActorInventoryWeightSnapshot(actor(items, currency));

test("wallet weight counts actual coins of every denomination at fifty per pound", () => {
  for (const denomination of ["cp", "sp", "ep", "gp", "pp"]) {
    assert.equal(snapshot([], { [denomination]: 50 }).weightLb, 1, denomination);
    assert.equal(snapshot([], { [denomination]: 1 }).weightLb, 0.02, denomination);
  }
  assert.equal(snapshot([], { pp: 10, gp: 15, sp: 20, cp: 5 }).weightLb, 1);
  assert.equal(snapshot([], { pp: "25", gp: "25" }).weightLb, 1);
  assert.equal(snapshot([], { pp: -50, gp: "invalid", sp: Infinity, cp: NaN, ep: null }).weightLb, 0);
  assert.equal(snapshot([], { gp: 1.9, custom: 1000 }).weightLb, 0.02);
  assert.equal(snapshot([item("rope", 10)], { gp: 50 }).weightLb, 11);
});

test("physical coin Items and wallet currency are separate holdings counted once each", () => {
  const coins = item("coin-item", 0.02); coins.system.quantity = 50;
  assert.equal(snapshot([coins], { gp: 50 }).weightLb, 2);
});

test("normal containers replace native coin weight instead of omitting or double-counting it", () => {
  for (const nativeCoins of [null, 0, 1]) {
    const bag = container("bag", 1, { coins: { gp: 50 } });
    if (nativeCoins !== null) Object.assign(bag.system, {
      totalWeightIn: () => 3 + nativeCoins, contentsWeight: 2 + nativeCoins, currencyWeight: nativeCoins
    });
    const input = actor([bag, item("book", 2, "bag")]);
    const before = JSON.stringify(input);
    assert.equal(buildActorInventoryWeightSnapshot(input).weightLb, 4, `native currency ${nativeCoins}`);
    assert.equal(JSON.stringify(input), before, "read-only projection");
  }
});

test("nested normal containers and wallet apply the fixed ratio once per actual holding", () => {
  for (const nativeEnabled of [null, false, true]) {
    const outer = container("outer", 1, { coins: { cp: 25 } });
    const inner = container("inner", 1, { parent: "outer", coins: { pp: 50 } });
    if (nativeEnabled !== null) {
      Object.assign(outer.system, { totalWeightIn: () => nativeEnabled ? 5.5 : 4, contentsWeight: nativeEnabled ? 4.5 : 3, currencyWeight: nativeEnabled ? 0.5 : 0 });
      Object.assign(inner.system, { totalWeightIn: () => nativeEnabled ? 4 : 3, contentsWeight: nativeEnabled ? 3 : 2, currencyWeight: nativeEnabled ? 1 : 0 });
    }
    assert.equal(snapshot([outer, inner, item("book", 2, "inner")], { sp: 50 }).weightLb, 6.5);
  }
});

test("fixed coin pounds correct a differing native metric contribution and preserve shell weight", () => {
  const bag = container("metric", 2, { coins: { gp: 50 } });
  Object.assign(bag.system, { weight: { value: 2, units: "kg" }, currencyWeight: 0.5, contentsWeight: 0.5, totalWeightIn: () => 6.25 });
  assert.equal(snapshot([bag]).weightLb, 6, "5 lb shell + 1 lb currency, rather than native 1.25 lb currency");
});

test("magical containers suppress carried coin weight but include it in used storage capacity", () => {
  for (const nativeCoins of [null, 0, 1]) {
    const bag = container("magic", 15, { coins: { gp: 50 }, magical: true, capacity: { value: 500, units: "lb" } });
    if (nativeCoins !== null) Object.assign(bag.system, { totalWeightIn: () => 15, contentsWeight: nativeCoins, currencyWeight: nativeCoins });
    const weight = snapshot([bag], { gp: 50 });
    assert.equal(weight.weightLb, 16);
    assert.equal(weight.magicalContainers[0].contentsWeightLb, 1);
    const storage = buildInventoryStorageProfile([weight], 100);
    assert.equal(storage.weightLb, 17); assert.equal(storage.capacityLb, 600);
  }
});

test("nested magical containers retain their separate capacity and do not propagate contained coin weight", () => {
  for (const nativeEnabled of [false, true]) {
    const outer = container("outer", 15, { coins: { cp: 25 }, magical: true, capacity: { value: 500, units: "lb" } });
    const inner = container("inner", 5, { parent: "outer", coins: { pp: 50 }, magical: true, capacity: { value: 50, units: "lb" } });
    Object.assign(outer.system, { totalWeightIn: () => 15, contentsWeight: nativeEnabled ? 5.5 : 5, currencyWeight: nativeEnabled ? 0.5 : 0 });
    Object.assign(inner.system, { totalWeightIn: () => 5, contentsWeight: nativeEnabled ? 3 : 2, currencyWeight: nativeEnabled ? 1 : 0 });
    const weight = snapshot([outer, inner, item("book", 2, "inner")], { gp: 50 });
    assert.equal(weight.weightLb, 16);
    assert.deepEqual(weight.magicalContainers.map(c => c.contentsWeightLb), [5.5, 3]);
    const storage = buildInventoryStorageProfile([weight], 100);
    assert.equal(storage.weightLb, 24.5); assert.equal(storage.capacityLb, 650);
  }
});

test("detached native promises and broken container cycles use safe fallback coin accounting", () => {
  const detached = container("detached", 1, { coins: { cp: 50 } });
  Object.assign(detached.system, { totalWeightIn: () => Promise.resolve(99), contentsWeight: Promise.resolve(98), currencyWeight: Promise.resolve(98) });
  assert.equal(snapshot([detached]).weightLb, 2);
  const a = container("a", 1, { parent: "b", coins: { gp: 50 } });
  const b = container("b", 1, { parent: "a", coins: { gp: 50 } });
  a.system.totalWeightIn = b.system.totalWeightIn = () => assert.fail("cyclic native hierarchy must not be evaluated");
  assert.equal(snapshot([a, b, item("book", 2, "a")], { pp: 50 }).weightLb, 7);
  const unknown = container("unknown", 15, { coins: { gp: 50 }, magical: true });
  const profile = buildInventoryStorageProfile([snapshot([unknown])], 100);
  assert.equal(profile.weightLb, 16); assert.equal(profile.capacityLb, 100);
});
