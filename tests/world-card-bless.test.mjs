import test from "node:test";
import assert from "node:assert/strict";
import { prepareCardEffect } from "../scripts/integrations/world-card-automations/effect-data.js";

globalThis.CONFIG = { Canvas: { darknessAnimations: {} } };
const { definitions } = await import("../scripts/integrations/world-card-automations/registry.js");
const { legacy: { bless: legacyBless }, modern: { bless: modernBless } } = definitions;

function fixture(t, generation, data) {
  const user = { id: "player" };
  const created = [];
  const previous = { DAE: globalThis.DAE, MidiQOL: globalThis.MidiQOL, foundry: globalThis.foundry, game: globalThis.game };
  t.after(() => Object.assign(globalThis, previous));
  Object.assign(globalThis, {
    game: { user, users: new Map([[user.id, user]]), release: { generation } },
    foundry: { utils: { duplicate: structuredClone, deepClone: structuredClone } },
    DAE: { convertDuration: () => ({ seconds: 60 }) },
    MidiQOL: { getConcentrationEffect: () => null }
  });
  const actor = { items: [] };
  const item = { actor, system: { source: { rules: generation === 14 ? "2024" : "2014" } },
    flags: { "chris-premades": { info: { identifier: "bless" } } } };
  const source = { uuid: "Actor.caster.Item.bless.ActiveEffect.source", toObject: () => data };
  const target = {
    testUserPermission: () => true,
    async createEmbeddedDocuments(type, docs) {
      assert.equal(type, "ActiveEffect");
      created.push(...docs);
      return docs;
    }
  };
  return {
    created,
    workflow: { actor, item, activity: { documentName: "Activity", effects: [{ effect: source }] }, targets: [{ actor: target }] }
  };
}

const visual = { key: "macro.tokenMagic", value: "bless" };
const bonuses = [
  { key: "system.bonuses.mwak.attack", value: "1d4" },
  { key: "system.bonuses.abilities.save", value: "1d4" }
];

for (const [edition, generation, bless] of [["2014", 13, legacyBless], ["2024", 14, modernBless]]) {
  test(`${edition} Bless drops the source TokenMagic visual row and retains authored bonuses`, async (t) => {
    const changes = [...bonuses, visual].map(change => generation === 14 ? { ...change, type: "add" } : { ...change, mode: 2 });
    const data = { name: "Благословение", flags: { dae: { specialDuration: [] } },
      ...(generation === 14 ? { system: { changes } } : { changes }) };
    const before = structuredClone(data);
    const { created, workflow } = fixture(t, generation, data);
    await bless.midi.item.find(entry => entry.pass === "rollFinished").macro({ workflow });
    assert.equal(created.length, 1);
    const [result] = created;
    assert.deepEqual(result.system?.changes ?? result.changes, changes.slice(0, 2));
    assert.equal(result.origin, workflow.activity.effects[0].effect.uuid);
    assert.deepEqual(result.flags.dae, data.flags.dae);
    assert.deepEqual(data, before);
  });
}

test("Bless still rejects any other executable effect change", async (t) => {
  const { created, workflow } = fixture(t, 14, { system: { changes: [visual, { key: "macro.execute", value: "doSomething" }] } });
  await assert.rejects(modernBless.midi.item.find(entry => entry.pass === "rollFinished").macro({ workflow }), /executable macro/);
  assert.deepEqual(created, []);
  assert.throws(() => prepareCardEffect({ changes: [visual] }, { generation: 14 }), /executable macro/);
});

test("another card referencing the Bless macro receives no TokenMagic exception", async (t) => {
  const { created, workflow } = fixture(t, 14, { system: { changes: [visual] } });
  workflow.item.flags["chris-premades"].info.identifier = "other";
  await assert.rejects(modernBless.midi.item.find(entry => entry.pass === "rollFinished").macro({ workflow }), /executable macro/);
  assert.deepEqual(created, []);
});
