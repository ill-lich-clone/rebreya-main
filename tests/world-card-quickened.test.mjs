import assert from "node:assert/strict";
import test from "node:test";
globalThis.CONFIG = { Canvas: { darknessAnimations: {} } };
const base = "../scripts/integrations/world-card-automations/selected/";
await import("../scripts/integrations/world-card-automations/registry.js");
const { useQuickened } = await import(base + "macros/2014/classFeatures/sorcerer/metamagic.js");
const { dialogUtils } = await import(base + "lib/utilities/dialogUtils.js");
const { actorUtils } = await import(base + "lib/utilities/actorUtils.js");
const { genericUtils } = await import(base + "lib/utilities/genericUtils.js");
const workflowUtils = await import(base + "lib/utilities/workflowUtils.js");
function scenario(t, { cancel, level = 1, method = "spell" } = {}) {
  const resource = {
    id: "pts",
    system: {
      identifier: "sorcerer-sorcery-points",
      uses: { value: 12, spent: 0, max: "@scale.sorcerer-rework-v011.sorcery-points" }
    }
  };
  const actor = {
    items: [{ type: "class", system: { identifier: "sorcerer-rework-v011" } }, resource],
    system: { spells: { spell2: { value: 3, max: 3, level: 2 } } }
  };
  const spell = {
    id: "testSpell",
    name: "Реальное заклинание",
    actor,
    type: "spell",
    system: { level, method, activation: { type: "action" }, activities: {} }
  };
  actor.items.push(spell);
  const workflow = {
    actor,
    item: { name: "Ускорение" },
    targets: new Set([{ document: { uuid: "Scene.map.Token.foe" } }])
  };
  const calls = [];
  t.mock.method(actorUtils, "getCastableSpells", () => [spell]);
  t.mock.method(genericUtils, "format", () => "Выбор");
  t.mock.method(genericUtils, "notify", () => undefined);
  t.mock.method(dialogUtils, "selectDocumentDialog", async () => (cancel === "spell" ? false : spell));
  t.mock.method(dialogUtils, "selectSpellSlot", async () => {
    calls.push("select-slot");
    return cancel === "slot" ? false : 2;
  });
  const old = globalThis.MidiQOL;
  t.after(() => {
    globalThis.MidiQOL = old;
  });
  globalThis.MidiQOL = {
    completeItemUse: async (...args) => {
      calls.push(args);
      return cancel === "use" ? undefined : { id: "cast" };
    }
  };
  return { workflow, resource, spell, calls };
}
for (const cancel of ["spell", "slot", "use", false])
  test("legacy Quickened normal slot route: " + (cancel || "cast"), async (t) => {
    const { workflow, resource, spell, calls } = scenario(t, { cancel });
    const result = await useQuickened({ workflow });
    assert.equal(resource.system.uses.spent, 0);
    assert.match(resource.system.uses.max, /@scale/);
    if (cancel === "spell" || cancel === "slot") {
      assert.equal(calls.filter(Array.isArray).length, 0);
      return;
    }
    const [[used, usage]] = calls.filter(Array.isArray);
    assert.equal(used, spell);
    assert.equal(usage.spell.slot, "spell2");
    assert.equal(usage.consume.spellSlot, true);
    assert.deepEqual(usage.sorcererVirtualSpellLevel.metamagic.ids, ["quickened-spell"]);
    assert.deepEqual(usage.midiOptions.targetUuids, ["Scene.map.Token.foe"]);
    assert.equal(usage.sorcererVirtualSpellLevel.castingMode, "normal");
    if (cancel === "use") assert.equal(result, undefined);
    else assert.equal(result.id, "cast");
  });
test("quickening a cantrip never offers or consumes a slot", async (t) => {
  const h = scenario(t, { level: 0 });
  await useQuickened({ workflow: h.workflow });
  assert.ok(!h.calls.includes("select-slot"));
  assert.equal(h.calls[0][1].consume.spellSlot, false);
});

test("legacy resource outside the Rebreya class uses native itemUses on a transient spell alongside authored consumption", async (t) => {
  const h = scenario(t);
  h.workflow.actor.items[0].system.identifier = "sorcerer";
  h.resource.system.identifier = "sorcery-points";
  h.resource.flags = { "chris-premades": { info: { identifier: "sorceryPoints" } } };
  const nativeTarget = { type: "attribute", target: "resources.primary.value", value: "@prof" };
  let changes;
  h.spell.system.activities = [
    {
      id: "cast",
      activation: { type: "action", override: true },
      toObject: () => ({ consumption: { targets: [nativeTarget] } })
    }
  ];
  h.spell.clone = (data, opts) => {
    assert.equal(opts.keepId, true);
    changes = data;
    return { synthetic: true };
  };
  await useQuickened({ workflow: h.workflow });
  assert.deepEqual(changes["system.activities.cast.consumption.targets"], [
    nativeTarget,
    { type: "itemUses", target: "pts", value: "2" }
  ]);
  assert.equal(changes["system.activation.type"], "bonus");
  assert.ok(h.calls.at(-1)[0].synthetic);
  assert.equal(h.calls.at(-1)[1].consume.resources, true);
  assert.equal(h.resource.system.uses.spent, 0);
});

test("a cancelled local activity and a cancelled remote item use propagate cancellation", async (t) => {
  const old = { game: globalThis.game, MidiQOL: globalThis.MidiQOL, foundry: globalThis.foundry };
  t.after(() => Object.assign(globalThis, old));
  globalThis.game = { userId: "caster" };
  globalThis.foundry = { utils: { mergeObject: (a, b) => Object.assign(a, b) } };
  globalThis.MidiQOL = { completeActivityUse: async () => undefined, completeItemUse: async () => undefined };
  assert.equal(await workflowUtils.completeActivityUse({}, { midiOptions: { asUser: "caster" } }), undefined);
  assert.equal(await workflowUtils.completeItemUse({}, {}, { asUser: "other" }), undefined);
});
