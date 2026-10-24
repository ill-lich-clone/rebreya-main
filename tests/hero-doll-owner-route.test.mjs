import test from "node:test";
import assert from "node:assert/strict";
import { HeroDollService } from "../scripts/data/hero-doll-service.js";
import { makeInstanceDocumentsFixture } from "./helpers/item-instance-documents-fixture.mjs";

function setup(t, options = {}) {
  const fx = makeInstanceDocumentsFixture({ quantity: 1, ...options });
  t.after(() => fx.restore());
  fx.group.items.contents = [];
  fx.hero.items.contents.push(fx.source);
  fx.source.parent = fx.hero;
  const player = { id: "player", isGM: false, active: true };
  game.user.active = false;
  game.users.set(player.id, player);
  game.users.activeGM = null;
  game.user = player;
  fx.requests = [];
  for (const method of ["assignHeroDollItem", "clearHeroDollSlot", "normalizeHeroDollStack"]) {
    fx.api[method] = async payload => { fx.requests.push({ method, payload: structuredClone(payload) }); return { itemId: fx.source.id }; };
  }
  fx.service = new HeroDollService(fx.api);
  fx.assign = (slotId = "neck") => fx.service.assignItemToSlot(fx.hero, slotId, { uuid: fx.source.uuid });
  return fx;
}

function emulateFoundryUpdateArgumentMutation(item) {
  const update = item.update.bind(item);
  item.update = async data => {
    // Foundry 13 Document.update adds _id; ClientDatabaseBackend replaces the
    // caller's dotted keys with expanded data in the very same object.
    data._id = item.id;
    const flat = structuredClone(data), expanded = {};
    for (const [key, value] of Object.entries(data)) foundry.utils.setProperty(expanded, key, value);
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, expanded);
    return update(flat);
  };
}

for (const mode of ["assign", "clear"]) {
  test(`owner ${mode} survives Foundry expanding the update argument in place`, async t => {
    const fx = setup(t, { itemSystem: { equipped: mode === "clear" } });
    if (mode === "clear") fx.hero.flags["rebreya-main"].heroDoll = { version: 1, slots: { neck: { itemId: "rope" } } };
    emulateFoundryUpdateArgumentMutation(fx.source);
    if (mode === "assign") assert.equal(await fx.assign(), fx.source);
    else assert.equal(await fx.service.clearSlot(fx.hero, "neck"), true);
    assert.equal(fx.source.system.equipped, mode === "assign");
    assert.deepEqual(fx.hero.getFlag("rebreya-main", "heroDoll").slots, mode === "assign" ? { neck: { itemId: "rope" } } : {});
    assert.equal(fx.total(), 1);
    assert.equal(fx.settings.size, 0);
    assert.equal(fx.requests.length, 0);
  });

  test(`owner ${mode} compensates placement failure after native argument normalization`, async t => {
    const fx = setup(t, { itemSystem: { equipped: mode === "clear" } });
    const slots = mode === "clear" ? { neck: { itemId: "rope" } } : {};
    fx.hero.flags["rebreya-main"].heroDoll = { version: 1, slots: structuredClone(slots) };
    emulateFoundryUpdateArgumentMutation(fx.source);
    fx.failAt("placement", "after");
    await assert.rejects(mode === "assign" ? fx.assign() : fx.service.clearSlot(fx.hero, "neck"), /fault placement after/);
    assert.equal(fx.source.system.equipped, mode === "clear");
    assert.deepEqual(fx.hero.getFlag("rebreya-main", "heroDoll").slots, slots);
    assert.equal(fx.requests.length, 0);
  });
}

test("visible native item update can settle before the next queued doll action without false conflict", async t => {
  const fx = setup(t, { itemFlags: { heroDollSlots: ["ring1", "ring2"] } });
  emulateFoundryUpdateArgumentMutation(fx.source);
  const update = fx.source.update.bind(fx.source);
  let acknowledge, changed;
  const acknowledgement = new Promise(resolve => { acknowledge = resolve; });
  const visibleChange = new Promise(resolve => { changed = resolve; });
  fx.source.update = async data => { const item = await update(data); changed(); await acknowledgement; return item; };
  const first = fx.assign("ring1");
  await visibleChange;
  assert.equal(fx.source.system.equipped, true);
  const next = fx.assign("ring2");
  assert.equal(fx.calls.filter(([phase]) => phase === "placement").length, 0);
  acknowledge();
  await Promise.all([first, next]);
  assert.deepEqual(fx.hero.getFlag("rebreya-main", "heroDoll").slots, { ring2: { itemId: "rope" } });
  assert.equal(fx.calls.filter(([phase]) => phase === "equip").length, 1);
  assert.equal(fx.requests.length, 0);
});

test("owner without GM equips and clears a singleton without sockets or world writes", async t => {
  const fx = setup(t);
  assert.equal(await fx.assign(), fx.source);
  assert.equal(fx.source.system.equipped, true);
  assert.deepEqual(fx.hero.getFlag("rebreya-main", "heroDoll").slots, { neck: { itemId: "rope" } });
  assert.equal(await fx.service.clearSlot(fx.hero, "neck"), true);
  assert.equal(fx.source.system.equipped, false);
  assert.deepEqual(fx.hero.getFlag("rebreya-main", "heroDoll").slots, {});
  assert.equal(fx.source.id, "rope");
  assert.equal(fx.total(), 1);
  assert.equal(fx.settings.size, 0);
  assert.deepEqual(fx.requests, []);
});

test("owner moves the same singleton and preserves held hands and unrelated slot data", async t => {
  const fx = setup(t, { itemFlags: { heroDollSlots: ["leftHand", "rightHand"], heldHands: ["right"] }, itemSystem: { equipped: true } });
  fx.source.data.type = "weapon";
  await fx.assign("leftHand");
  fx.hero.flags["rebreya-main"].heroDoll.slots.back1 = { itemId: "unrelated", extra: "keep" };
  await fx.assign("rightHand");
  assert.deepEqual(fx.hero.getFlag("rebreya-main", "heroDoll").slots, { rightHand: { itemId: "rope" }, back1: { itemId: "unrelated", extra: "keep" } });
  await fx.service.clearSlot(fx.hero, "rightHand");
  assert.equal(fx.source.system.equipped, true);
  assert.deepEqual(fx.source.getFlag("rebreya-main", "heldHands"), ["right"]);
  assert.equal(fx.requests.length, 0);
  assert.equal(fx.total(), 1);
});

test("owner assignment clears only its ghost while preserving presets", async t => {
  const fx = setup(t);
  fx.hero.flags["rebreya-main"].heroDollPresets = { version: 1, presets: [{ id: "p", name: "Saved", slots: {} }], activePresetId: "p",
    ghosts: { neck: { name: "Missing" }, ring1: { name: "Other" } } };
  await fx.assign();
  const state = fx.hero.getFlag("rebreya-main", "heroDollPresets");
  assert.equal(state.ghosts.neck, undefined);
  assert.deepEqual(state.ghosts.ring1, { name: "Other" });
  assert.equal(state.presets[0].name, "Saved");
  assert.equal(state.activePresetId, "p");
  assert.equal(fx.requests.length, 0);
});

for (const problem of ["non-owner", "invalid-slot", "unsupported-actor"]) {
  test(`owner route rejects ${problem} before writing`, async t => {
    const fx = setup(t);
    if (problem === "non-owner") fx.hero.ownership.player = 0;
    if (problem === "unsupported-actor") fx.hero.type = "vehicle";
    await assert.rejects(fx.assign(problem === "invalid-slot" ? "leftHand" : "neck"), e => ["unauthorized", "invalid-slot"].includes(e.code));
    assert.equal(fx.calls.length, 0);
    assert.equal(fx.requests.length, 0);
  });
}

test("stack, occupied-slot swap, cross-actor source and legacy normalization retain GM route", async t => {
  const fx = setup(t, { quantity: 2 });
  await fx.assign();
  assert.equal(fx.requests[0].method, "assignHeroDollItem");
  fx.source.system.quantity = 1;
  await fx.hero.createEmbeddedDocuments("Item", [{ _id: "other", name: "Other", type: "equipment", system: { quantity: 1, equipped: true }, flags: {} }]);
  fx.hero.flags["rebreya-main"].heroDoll = { version: 1, slots: { neck: { itemId: "other" } } };
  await fx.assign();
  assert.equal(fx.requests.length, 2);
  fx.group.items.contents.push(fx.source); fx.hero.items.contents = fx.hero.items.contents.filter(item => item !== fx.source); fx.source.parent = fx.group;
  await fx.service.assignItemToSlot(fx.hero, "neck", { uuid: fx.source.uuid });
  assert.equal(fx.requests.length, 3);
  fx.source.system.quantity = 3; fx.source.parent = fx.hero; fx.hero.items.contents.push(fx.source); fx.group.items.contents = [];
  fx.hero.flags["rebreya-main"].heroDoll.slots.neck = { itemId: "rope" };
  await fx.service.normalizeLegacyStack(fx.hero, "neck");
  assert.equal(fx.requests[3].method, "normalizeHeroDollStack");
  assert.equal(fx.source.system.quantity, 3);
  assert.equal(fx.settings.size, 0);
});

test("repeated owner clicks share one pending operation and different slots keep actor order", async t => {
  const fx = setup(t, { itemFlags: { heroDollSlots: ["ring1", "ring2"] } });
  let release, writes = 0;
  const gate = new Promise(resolve => { release = resolve; }), update = fx.source.update.bind(fx.source);
  fx.source.update = async patch => { writes++; if (writes === 1) await gate; return update(patch); };
  const first = fx.assign("ring1"), duplicate = fx.assign("ring1");
  await new Promise(resolve => setImmediate(resolve));
  const next = fx.assign("ring2");
  release();
  await Promise.all([first, duplicate, next]);
  assert.deepEqual(fx.hero.getFlag("rebreya-main", "heroDoll").slots, { ring2: { itemId: "rope" } });
  assert.equal(fx.calls.filter(([phase]) => phase === "placement").length, 2);
  assert.equal(fx.requests.length, 0);
});

for (const phase of ["equip", "placement"]) for (const timing of ["before", "after"]) {
  test(`owner ${phase} write failing ${timing} restores only its own state`, async t => {
    const fx = setup(t);
    fx.failAt(phase, timing);
    await assert.rejects(fx.assign());
    assert.equal(fx.source.system.equipped, false);
    assert.equal(fx.hero.getFlag("rebreya-main", "heroDoll")?.slots?.neck, undefined);
    assert.equal(fx.total(), 1);
    assert.equal(fx.settings.size, 0);
    assert.equal(fx.requests.length, 0);
    await fx.assign();
    assert.equal(fx.source.system.equipped, true);
  });
}

test("owner route does not overwrite a concurrent slot edit after item write", async t => {
  const fx = setup(t), update = fx.source.update.bind(fx.source);
  fx.source.update = async patch => {
    const result = await update(patch);
    fx.hero.flags["rebreya-main"].heroDoll = { version: 1, slots: { neck: { itemId: "newer" } } };
    return result;
  };
  await assert.rejects(fx.assign(), e => ["stale-slot", "ambiguous-outcome"].includes(e.code));
  assert.deepEqual(fx.hero.getFlag("rebreya-main", "heroDoll").slots.neck, { itemId: "newer" });
  assert.equal(fx.source.system.equipped, false, "restore this item's flag when only the target slot changed");
  assert.equal(fx.calls.filter(([phase]) => phase === "placement").length, 0);
});

test("owner route rejects a disappeared Item rather than confirming a dangling slot", async t => {
  const fx = setup(t), update = fx.source.update.bind(fx.source);
  fx.source.update = async patch => { const result = await update(patch); fx.hero.items.contents = []; return result; };
  await assert.rejects(fx.assign(), e => ["stale-slot", "ambiguous-outcome"].includes(e.code));
  assert.equal(fx.hero.getFlag("rebreya-main", "heroDoll")?.slots?.neck, undefined);
  assert.equal(fx.requests.length, 0);
});

test("owner compensation preserves a newer assignment arriving during restoration", async t => {
  const fx = setup(t), update = fx.hero.update.bind(fx.hero);
  fx.failAt("placement", "after");
  fx.hero.update = async patch => {
    const result = await update(patch);
    fx.hero.flags["rebreya-main"].heroDoll.slots.ring1 = { itemId: "rope" };
    return result;
  };
  await assert.rejects(fx.assign(), e => e.code === "ambiguous-outcome");
  assert.equal(fx.source.system.equipped, true);
  assert.deepEqual(fx.hero.getFlag("rebreya-main", "heroDoll").slots.ring1, { itemId: "rope" });
});

test("owner route rejects changed quantity and a native update cancelled by a hook", async t => {
  const fx = setup(t), update = fx.source.update.bind(fx.source);
  fx.source.update = async () => fx.source;
  await assert.rejects(fx.assign(), e => e.code === "stale-slot");
  assert.equal(fx.hero.getFlag("rebreya-main", "heroDoll")?.slots?.neck, undefined);
  fx.source.update = async patch => { await update(patch); fx.source.system.quantity = 2; return fx.source; };
  await assert.rejects(fx.assign(), e => e.code === "ambiguous-outcome");
  assert.equal(fx.source.system.quantity, 2);
  assert.equal(fx.hero.getFlag("rebreya-main", "heroDoll")?.slots?.neck, undefined);
});

test("a new service reads persisted owner state and clears it without a receipt", async t => {
  const fx = setup(t);
  await fx.assign();
  const reloaded = new HeroDollService(fx.api);
  assert.equal(await reloaded.clearSlot(fx.hero, "neck"), true);
  assert.equal(fx.source.system.equipped, false);
  assert.deepEqual(fx.hero.getFlag("rebreya-main", "heroDoll").slots, {});
  assert.equal(fx.settings.size, 0);
});

test("an unknown GM outcome retains its intent even after the source becomes a singleton", async t => {
  const fx = setup(t, { quantity: 2 });
  fx.api.assignHeroDollItem = async payload => {
    fx.requests.push(structuredClone(payload));
    throw Object.assign(Error("Still pending"), { code: "operation-timeout" });
  };
  await assert.rejects(fx.assign());
  fx.source.system.quantity = 1;
  await assert.rejects(fx.assign());
  assert.equal(fx.requests.length, 2);
  assert.equal(fx.requests[1].operationId, fx.requests[0].operationId);
  assert.equal(fx.calls.length, 0);
});

test("a confirmed GM rejection releases the intent for a corrected retry", async t => {
  const fx = setup(t, { quantity: 2 });
  fx.api.assignHeroDollItem = async () => { throw Object.assign(Error("Denied"), { code: "unauthorized" }); };
  await assert.rejects(fx.assign());
  assert.equal(fx.service.pendingAssignments.size, 0);
  fx.source.system.quantity = 1;
  await fx.assign();
  assert.equal(fx.source.system.equipped, true);
});
