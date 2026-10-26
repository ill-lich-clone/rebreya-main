import assert from "node:assert/strict";
import test from "node:test";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";

const path = "../scripts/data/shield-spell-item.js";
function source() {
  return { _id: "source", folder: "pack-folder", name: "Shield", type: "spell", img: "shield.webp",
    system: { identifier: "shield", level: 1, description: { value: "", chat: "custom" }, properties: ["vocal", "somatic"],
      uses: { max: "@prof + 2", spent: 1 }, activities: { cast: { _id: "cast", type: "utility",
        consumption: { spellSlot: true, targets: [{ type: "itemUses", value: "@prof" }] }, effects: [{ _id: "barrier" }] } } },
    effects: [{ _id: "barrier", transfer: false, changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "5" }],
      flags: { dae: { specialDuration: ["turnStartSource"], stackable: "noneName" }, "chris-premades": { info: { identifier: "shield" } } } }],
    flags: { "chris-premades": { info: { identifier: "shield", version: "1.2.28" } }, authored: { formula: "1d4 + @prof" } } };
}
function harness() {
  const gm = { id: "gm", active: true, isGM: true };
  const game = { user: gm, users: [gm], items: [] };
  const inputs = []; const resolves = [];
  const options = { game, coordinator: new WorldMutationCoordinator(),
    resolveUuid: async uuid => { resolves.push(uuid); return { toObject: () => uuid.includes("CPRSpells") ? source() : { system: { description: { value: "SRD description" } } } }; },
    itemClass: { create: async data => { inputs.push(data); const item = { ...data, uuid: "Item.worldShield" }; game.items.push(item); return item; } } };
  return { options, inputs, resolves, game };
}

test("Shield world copy preserves complete native data and embedded references without mutating source", async () => {
  const { buildShieldSpellItem } = await import(path);
  const original = source(); const before = structuredClone(original);
  const result = buildShieldSpellItem(original, { description: "SRD description" });
  const expected = source(); delete expected._id; delete expected.folder;
  expected.name = "Щит"; expected.system.description.value = "SRD description";
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
  assert.equal(h.resolves.length, 2);
});

test("world import rejects players and inactive GMs before any lookup or write", async () => {
  const { ensureWorldShieldSpell } = await import(path);
  for (const user of [{ id: "player", active: true }, { id: "other-gm", active: true, isGM: true }]) {
    const h = harness(); h.game.user = user;
    await assert.rejects(ensureWorldShieldSpell(h.options), /GM|ведущ/);
    assert.equal(h.inputs.length, 0); assert.equal(h.resolves.length, 0);
  }
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
