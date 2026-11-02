import assert from "node:assert/strict";
import test from "node:test";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";

const path = "../scripts/data/shield-spell-item.js";
function source() {
  return { _id: "source", folder: "pack-folder", name: "Shield", type: "spell", img: "shield.webp",
    system: { identifier: "shield", level: 1, description: { value: "SRD description", chat: "custom" }, properties: ["vocal", "somatic"],
      uses: { max: "@prof + 2", spent: 1 }, activities: { cast: { _id: "cast", type: "utility",
        consumption: { spellSlot: true, targets: [{ type: "itemUses", value: "@prof" }] }, effects: [{ _id: "barrier" }] } } },
    effects: [{ _id: "barrier", transfer: false, changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "5" }],
      disabled: true, flags: { dnd5e: { riders: { statuses: [] } } } }],
    flags: { authored: { formula: "1d4 + @prof" } } };
}
function harness() {
  const gm = { id: "gm", active: true, isGM: true };
  const game = { user: gm, users: [gm], items: [] };
  const inputs = []; const resolves = [];
  const options = { game, coordinator: new WorldMutationCoordinator(),
    resolveUuid: async uuid => { resolves.push(uuid); assert.equal(uuid, "Compendium.dnd5e.spells.Item.z1mx84ONwkXKUZd7"); return { toObject: source }; },
    itemClass: { create: async data => { inputs.push(data); const item = { ...data, uuid: "Item.worldShield" }; game.items.push(item); return item; } } };
  return { options, inputs, resolves, game };
}

test("Shield world copy preserves complete native data and embedded references without mutating source", async () => {
  const { buildShieldSpellItem } = await import(path);
  const original = source(); const before = structuredClone(original);
  const result = buildShieldSpellItem(original, { description: "SRD description" });
  const expected = source(); delete expected._id; delete expected.folder;
  expected.name = "Щит";
  expected.effects[0].disabled = false;
  expected.effects[0].flags["rebreya-main"] = { shieldReaction: { version: 1 } };
  assert.match(result.system.activities.cast.useConditionText, /isDamaged/);
  expected.system.activities.cast.useConditionText = result.system.activities.cast.useConditionText;
  expected.flags["rebreya-main"] = { shieldReaction: { version: 1 } };
  assert.deepEqual(result, expected); assert.deepEqual(original, before);
  result.effects[0].changes[0].value = "999";
  assert.equal(original.effects[0].changes[0].value, "5");
  original.system.description.value = "Authored description";
  assert.equal(buildShieldSpellItem(original, { description: "fallback" }).system.description.value, "Authored description");
});

test("concurrent imports create one reusable world Item and preserve subsequent authored changes", async () => {
  const { ensureWorldShieldSpell } = await import(path); const h = harness();
  const [first, second] = await Promise.all([ensureWorldShieldSpell(h.options), ensureWorldShieldSpell(h.options)]);
  assert.equal(first, second); assert.equal(h.inputs.length, 1);
  assert.equal(first.system.description.value, "SRD description");
  first.name = "Custom name"; first.system.uses.max = "3d6";
  assert.equal(await ensureWorldShieldSpell(h.options), first);
  assert.equal(first.name, "Custom name"); assert.equal(first.system.uses.max, "3d6");
  assert.equal(h.resolves.length, 1);
});

test("world import rejects players and inactive GMs before any lookup or write", async () => {
  const { ensureWorldShieldSpell } = await import(path);
  for (const user of [{ id: "player", active: true }, { id: "other-gm", active: true, isGM: true }]) {
    const h = harness(); h.game.user = user;
    await assert.rejects(ensureWorldShieldSpell(h.options), /GM|ведущ/);
    assert.equal(h.inputs.length, 0); assert.equal(h.resolves.length, 0);
  }
});

test("world import activates the SRD Shield native v14 effect until the defender’s next turn without CPR", async () => {
  const { ensureWorldShieldSpell, hasShieldEffect } = await import(path);
  const h = harness();
  h.game.packs = new Map();
  const shield = source();
  shield.effects = [{ _id: "barrier", system: { changes: [
    { type: "add", key: "system.attributes.ac.bonus", value: "5", priority: 20, phase: "initial" }
  ] }, disabled: true, flags: {}, duration: { value: 1, units: "rounds", expiry: "turnStart" } }];
  h.options.resolveUuid = async uuid => {
    if (uuid === "Compendium.dnd5e.spells.Item.z1mx84ONwkXKUZd7") return { toObject: () => shield };
    throw new Error(`Unexpected source ${uuid}`);
  };
  const item = await ensureWorldShieldSpell(h.options);
  assert.deepEqual(item.effects[0].system, shield.effects[0].system);
  assert.equal(item.effects[0].duration.expiry, "targetStart");
  assert.equal(item.effects[0].disabled, false);
  assert.deepEqual(item.system.activities.cast.consumption, shield.system.activities.cast.consumption);
  assert.equal(item.system.description.value, "SRD description");
  assert.equal(hasShieldEffect({ effects: item.effects }), true);
  assert.equal(hasShieldEffect({ effects: [{ ...item.effects[0], disabled: true }] }), false);
});

test("missing or malformed Shield source cannot create a partial world Item", async () => {
  const { ensureWorldShieldSpell, buildShieldSpellItem } = await import(path);
  for (const data of [null, { type: "weapon" }, { ...source(), effects: [] }]) {
    assert.throws(() => buildShieldSpellItem(data), /Shield|Щит/);
    const h = harness(); h.options.resolveUuid = async () => data && ({ toObject: () => data });
    await assert.rejects(ensureWorldShieldSpell(h.options), /Shield|Щит/);
    assert.equal(h.inputs.length, 0);
  }
});
