import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { registerCraftsmanGadgetHooks } = await import(
  "../scripts/integrations/craftsman-gadget-hooks.js"
);

function hookHarness() {
  const listeners = new Map();
  return {
    listeners,
    Hooks: {
      on(name, listener) {
        listeners.set(name, listener);
      }
    }
  };
}

test("Craftsman gadget hooks bridge native dnd5e activity and template events", async () => {
  const { Hooks, listeners } = hookHarness();
  const calls = [];
  const activity = { id: "activity" };
  const results = { templates: [{ id: "smoke" }] };
  const templateData = {};
  const moduleApi = {
    craftsmanGadgetService: {
      applyDnd5ePreUseActivity: (...args) => {
        calls.push(["preUse", ...args]);
        return false;
      },
      applyDnd5ePostUseActivity: async (...args) => calls.push(["postUse", ...args]),
      applyDnd5ePreCreateActivityTemplate: (...args) => calls.push(["template", ...args]),
      handleRestCompleted: async (...args) => calls.push(["rest", ...args])
    }
  };

  registerCraftsmanGadgetHooks(moduleApi, { Hooks, game: {} });

  assert.equal(listeners.get("dnd5e.preUseActivity")(activity, {}, {}, {}), false);
  listeners.get("dnd5e.postUseActivity")(activity, {}, results);
  listeners.get("dnd5e.preCreateActivityTemplate")(activity, templateData);
  listeners.get("dnd5e.restCompleted")({ id: "actor" }, { longRest: true }, {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(new Set(calls.map((entry) => entry[0])), new Set(["preUse", "postUse", "template", "rest"]));
  assert.equal(calls.find((entry) => entry[0] === "postUse")[3], results);
  assert.equal(calls.find((entry) => entry[0] === "template")[2], templateData);
});

test("Craftsman gadget hooks apply native attack, damage, time, turn, and canvas automation", async () => {
  const { Hooks, listeners } = hookHarness();
  const calls = [];
  const moduleApi = {
    craftsmanGadgetService: {
      applyDnd5eAttackRollConfig: (...args) => calls.push(["preAttack", ...args]),
      applyDnd5eRollAttack: async (...args) => calls.push(["rollAttack", ...args]),
      applyDnd5ePreRollDamage: (...args) => calls.push(["preDamage", ...args]),
      handleCombatTurnChange: async (...args) => calls.push(["gadgetTurn", ...args]),
      handleWorldTime: async (...args) => calls.push(["worldTime", ...args])
    },
    craftsmanGadgetZoneService: {
      handleCombatTurn: async (...args) => calls.push(["zoneTurn", ...args]),
      registerSceneTemplates: (...args) => calls.push(["canvas", ...args])
    },
    craftsmanVehicleService: {
      handleCombatTurnChange: async (...args) => calls.push(["vehicleTurn", ...args])
    }
  };

  registerCraftsmanGadgetHooks(moduleApi, { Hooks, game: {} });
  listeners.get("dnd5e.preRollAttack")({ id: "attack-config" }, {}, {});
  listeners.get("dnd5e.rollAttack")([{ total: 17 }], { id: "attack-context" });
  listeners.get("dnd5e.preRollDamage")({ id: "damage-config" }, {}, {});
  listeners.get("combatTurnChange")({ id: "combat", round: 2, turn: 3 }, {}, {});
  listeners.get("updateWorldTime")(120, 6);
  const scene = { id: "scene" };
  listeners.get("canvasReady")({ scene });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(new Set(calls.map((entry) => entry[0])), new Set([
    "preAttack",
    "rollAttack",
    "preDamage",
    "gadgetTurn",
    "zoneTurn",
    "vehicleTurn",
    "worldTime",
    "canvas"
  ]));
  assert.equal(calls.find((entry) => entry[0] === "vehicleTurn")[1], "combat:2:3");
  assert.equal(calls.find((entry) => entry[0] === "canvas")[1], scene);
});

test("Craftsman gadget hook registration is idempotent", () => {
  const { Hooks, listeners } = hookHarness();
  const game = {};
  const moduleApi = { craftsmanGadgetService: {} };
  registerCraftsmanGadgetHooks(moduleApi, { Hooks, game });
  const count = listeners.size;
  registerCraftsmanGadgetHooks(moduleApi, { Hooks, game });
  assert.equal(listeners.size, count);
});

test("document hooks keep smoke, deleted gadgets, and temporary vehicles recoverable across clients", async () => {
  const { Hooks, listeners } = hookHarness();
  const calls = [];
  const moduleApi = {
    craftsmanGadgetService: {
      handleDeletedItem: async (item) => calls.push(["item", item])
    },
    craftsmanGadgetZoneService: {
      registerTemplate: (document) => calls.push(["register", document]),
      unregisterTemplate: (document) => calls.push(["unregister", document]),
      clearTemplates: () => calls.push(["clear"])
    },
    craftsmanVehicleService: {
      handleCombatTurnChange: async (key) => calls.push(["vehicle", key])
    }
  };
  registerCraftsmanGadgetHooks(moduleApi, { Hooks, game: {} });
  const template = { id: "smoke" };
  const item = { id: "gadget" };

  listeners.get("createMeasuredTemplate")(template, {}, "user");
  listeners.get("updateMeasuredTemplate")(template, {}, {}, "user");
  listeners.get("deleteMeasuredTemplate")(template, {}, "user");
  listeners.get("deleteItem")(item, {}, "user");
  listeners.get("deleteScene")({ id: "scene" }, {}, "user");
  listeners.get("deleteCombat")({ id: "combat" }, {}, "user");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [
    ["register", template],
    ["register", template],
    ["unregister", template],
    ["clear"],
    ["item", item],
    ["vehicle", ""]
  ]);
});

test("live module composition root constructs and registers Craftsman gadget automation", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  assert.match(source, /this\.craftsmanGadgetZoneService = new CraftsmanGadgetZoneService\(/u);
  assert.match(source, /this\.craftsmanVehicleService = new CraftsmanVehicleService\(/u);
  assert.match(source, /this\.craftsmanGadgetService = new CraftsmanGadgetService\(this,/u);
  assert.match(source, /registerCraftsmanGadgetHooks\(moduleApi\)/u);
});
