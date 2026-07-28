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
  assert.match(source, /registerImplantHooks\(moduleApi\)/u);
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
