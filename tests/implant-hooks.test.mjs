import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { MODULE_ID } from "../scripts/constants.js";
import {
  registerImplantDataModelPatch,
  registerImplantHooks
} from "../scripts/integrations/implant-hooks.js";

function hooksStub() {
  const handlers = new Map();
  return {
    handlers,
    on(name, handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    once(name, handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    }
  };
}

function implant(parent) {
  return {
    type: "equipment",
    parent,
    flags: {
      [MODULE_ID]: {
        implant: { kind: "mechanical" }
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

test("implant hooks reconcile changed actors once and ignore unrelated items", async () => {
  const Hooks = hooksStub();
  const actor = { id: "actor", items: [] };
  const reconciliations = [];
  const moduleApi = {
    implantService: {
      hasImplants: (candidate) => candidate === actor,
      reconcileActor: async (candidate, options) => reconciliations.push({ candidate, options })
    }
  };

  assert.equal(registerImplantHooks(moduleApi, { Hooks, game: { actors: [] }, debounceMs: 0 }), true);
  assert.equal(registerImplantHooks(moduleApi, { Hooks, game: { actors: [] }, debounceMs: 0 }), false);

  Hooks.handlers.get("updateItem")[0]({ type: "loot", parent: actor }, {}, {}, "user");
  Hooks.handlers.get("deleteItem")[0](implant(actor), {}, "user");
  Hooks.handlers.get("updateActor")[0](actor, { system: { attributes: { prof: 4 } } }, {}, "user");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(reconciliations.length, 1);
  assert.equal(reconciliations[0].candidate, actor);
  assert.match(reconciliations[0].options.reason, /deleteItem|updateActor/u);
});

test("ready reconciliation visits only actors that own implants", async () => {
  const Hooks = hooksStub();
  const withImplants = { id: "with", items: [{}] };
  const withoutImplants = { id: "without", items: [] };
  const reconciled = [];
  registerImplantHooks({
    implantService: {
      hasImplants: (actor) => actor === withImplants,
      reconcileActor: async (actor) => reconciled.push(actor.id)
    }
  }, {
    Hooks,
    game: { actors: [withImplants, withoutImplants] },
    debounceMs: 0
  });

  Hooks.handlers.get("ready")[0]();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(reconciled, ["with"]);
});

test("module composition registers implant reconciliation hooks", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  assert.match(source, /registerImplantHooks\s*\}\s*from "\.\/integrations\/implant-hooks\.js"/u);
  assert.match(source, /new ImplantAutomationService\(this\)/u);
  assert.match(source, /registerImplantHooks\(moduleApi\)/u);
  assert.match(source, /registerImplantAutomationHooks\(moduleApi\)/u);
  assert.match(source, /registerImplantDataModelPatch\(\)/u);
});

test("implant data-model patch enforces compiled ability maximums before derived values", () => {
  class CharacterData {
    prepareDerivedData() {
      this.abilities.dex.mod = Math.floor((this.abilities.dex.value - 10) / 2);
    }
  }
  const CONFIG = {
    Actor: {
      dataModels: {
        character: CharacterData
      }
    }
  };
  assert.deepEqual(registerImplantDataModelPatch({ CONFIG }), ["character"]);
  assert.deepEqual(registerImplantDataModelPatch({ CONFIG }), []);

  const model = new CharacterData();
  model.abilities = { dex: { value: 24, mod: 0 } };
  model.parent = {
    effects: [{
      flags: {
        [MODULE_ID]: {
          implantAggregate: true,
          automation: {
            actorFlags: {
              abilityMaximums: { dex: 22 }
            }
          }
        }
      }
    }]
  };
  model.prepareDerivedData();

  assert.equal(model.abilities.dex.value, 22);
  assert.equal(model.abilities.dex.mod, 6);
});

test("implant data-model patch applies reinforced-joint carrying strength without changing Strength", () => {
  class CharacterData {
    prepareDerivedData() {
      this.attributes.encumbrance = {
        value: 100,
        thresholds: { encumbered: 75, heavilyEncumbered: 150, maximum: 225 },
        max: 225,
        pct: 100 / 225 * 100,
        stops: {
          encumbered: 75 / 225 * 100,
          heavilyEncumbered: 150 / 225 * 100
        }
      };
    }
  }
  const CONFIG = { Actor: { dataModels: { character: CharacterData } } };
  registerImplantDataModelPatch({ CONFIG });
  const model = new CharacterData();
  model.abilities = { str: { value: 15, mod: 2 } };
  model.attributes = {};
  model.parent = {
    effects: [{
      flags: {
        [MODULE_ID]: {
          implantAggregate: true,
          automation: {
            actorFlags: { carryingStrengthBonus: 2 }
          }
        }
      }
    }]
  };

  model.prepareDerivedData();

  assert.equal(model.abilities.str.value, 15);
  assert.deepEqual(model.attributes.encumbrance.thresholds, {
    encumbered: 85,
    heavilyEncumbered: 170,
    maximum: 255
  });
  assert.equal(model.attributes.encumbrance.max, 255);
  assert.equal(Math.round(model.attributes.encumbrance.pct * 100) / 100, 39.22);
});

test("implant data-model patch derives condenser slot, telepathy language, and rocket flight idempotently", () => {
  class CharacterData {
    prepareDerivedData() {
      this.spells = {
        spell1: { max: 4, value: 4 },
        spell2: { max: 3, value: 3 },
        spell3: { max: 2, value: 2 },
        spell4: { max: 0, value: 0 },
        spell5: { max: 0, value: 0 }
      };
      this.traits.languages.custom = "Морзянка";
      this.attributes.movement = { walk: 30, fly: 20 };
    }
  }
  const CONFIG = { Actor: { dataModels: { character: CharacterData } } };
  registerImplantDataModelPatch({ CONFIG });
  const model = new CharacterData();
  model.abilities = {};
  model.attributes = { movement: {} };
  model.traits = { languages: { custom: "" } };
  model.spells = {};
  model.parent = {
    effects: [{
      flags: {
        [MODULE_ID]: {
          implantAggregate: true,
          automation: {
            actorFlags: {},
            capabilities: [
              { type: "spellCondenser", spentPoints: 5 },
              { type: "telepathy" },
              { type: "rocketThrust" }
            ]
          }
        }
      }
    }]
  };

  model.prepareDerivedData();

  assert.equal(model.spells.spell3.max, 3);
  assert.equal(model.spells.spell5.max, 0);
  assert.equal(model.traits.languages.custom, "Морзянка; Телепатия (60 фт.)");
  assert.equal(model.attributes.movement.fly, 30);

  model.prepareDerivedData();

  assert.equal(model.spells.spell3.max, 3);
  assert.equal(model.traits.languages.custom, "Морзянка; Телепатия (60 фт.)");
  assert.equal(model.attributes.movement.fly, 30);
});

test("implant derived data preserves stronger flight and skips condenser without native slots", () => {
  class NpcData {
    prepareDerivedData() {
      this.spells = {
        spell1: { max: 0, value: 0 },
        spell2: { max: 0, value: 0 }
      };
      this.traits.languages.custom = "";
      this.attributes.movement = { walk: 30, fly: 60 };
    }
  }
  const CONFIG = { Actor: { dataModels: { npc: NpcData } } };
  registerImplantDataModelPatch({ CONFIG });
  const model = new NpcData();
  model.abilities = {};
  model.attributes = { movement: {} };
  model.traits = { languages: { custom: "" } };
  model.spells = {};
  model.parent = {
    effects: [{
      flags: {
        [MODULE_ID]: {
          implantAggregate: true,
          automation: {
            actorFlags: {},
            capabilities: [
              { type: "spellCondenser", spentPoints: 2 },
              { type: "rocketThrust" }
            ]
          }
        }
      }
    }]
  };

  model.prepareDerivedData();

  assert.equal(model.spells.spell1.max, 0);
  assert.equal(model.spells.spell2.max, 0);
  assert.equal(model.attributes.movement.fly, 60);
});
