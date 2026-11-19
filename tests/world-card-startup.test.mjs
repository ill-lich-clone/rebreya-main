import assert from "node:assert/strict";
import test from "node:test";

test("the world card setup imports cold and installs card handlers and their configuration", async (t) => {
  const names = new Set();
  const Hooks = { on(name) { names.add(name); } };
  const game = { modules: new Map([["midi-qol", { active: true }]]), users: new Map(), user: { id: "player" } };
  const originals = { Hooks: globalThis.Hooks, game: globalThis.game };
  t.after(() => Object.assign(globalThis, originals));
  Object.assign(globalThis, { Hooks, game });

  const { registerWorldCardAutomations } = await import("../scripts/integrations/world-card-automations/setup.js");
  registerWorldCardAutomations({ Hooks, game });
  assert.ok(names.has("midi-qol.postRollFinished"));
  assert.ok(names.has("midi-qol.preDamageRollComplete"));
  assert.ok(names.has("updateRegion"));

  const { getConfig } = await import("../scripts/integrations/world-card-automations/selected/lib/utilities/itemUtils.js");
  const card = { documentName: "Item", system: { source: { rules: "2024" } },
    flags: { "chris-premades": { info: { identifier: "faerieFire" } } } };
  assert.equal(getConfig(card, "color"), "blue");
});
