import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  BardicInspirationCompatService,
  LAARU_BARDIC_INSPIRATION_SOURCE_UUID,
  isBardicInspirationRestoreItem
} from "../scripts/combat/bardic-inspiration-compat-service.js";

globalThis.foundry ??= {
  utils: {
    getProperty: (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object),
    setProperty: (object, path, value) => {
      const keys = String(path ?? "").split(".").filter(Boolean);
      let cursor = object;
      while (keys.length > 1) {
        const key = keys.shift();
        cursor[key] ??= {};
        cursor = cursor[key];
      }
      cursor[keys[0]] = value;
      return true;
    }
  }
};

function makeCollection(items) {
  return {
    contents: items,
    values: () => items.values(),
    [Symbol.iterator]: function* iterator() {
      yield* items;
    }
  };
}

function makeLaaruBardicInspiration({ spent = 2 } = {}) {
  return {
    id: "bardic-inspiration",
    name: "Бардовское вдохновение",
    flags: {
      core: {
        sourceId: LAARU_BARDIC_INSPIRATION_SOURCE_UUID
      }
    },
    system: {
      uses: {
        spent,
        max: "4"
      }
    },
    updates: [],
    async update(patch) {
      this.updates.push(patch);
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
}

function makeActor(items) {
  return {
    id: "bard",
    items: makeCollection(items)
  };
}

function makeDrum(flags = {}) {
  return {
    name: "Барабан задающего ритм +2",
    flags,
    system: {
      description: {
        value: "Действием вы можете сыграть на барабане, чтобы восстановить одну кость бардовского вдохновения."
      }
    }
  };
}

test("bardic inspiration compat recognizes Rebreya rhythm-maker drums", () => {
  assert.equal(isBardicInspirationRestoreItem(makeDrum()), true);
  assert.equal(isBardicInspirationRestoreItem({
    name: "Посох лечения",
    system: { description: { value: "Восстанавливает заряды на рассвете." } }
  }), false);
});

test("using a Rebreya bardic restoration item restores one Laaru bardic inspiration use", async () => {
  const bardicInspiration = makeLaaruBardicInspiration({ spent: 2 });
  const actor = makeActor([bardicInspiration]);
  const drum = makeDrum({
    [MODULE_ID]: {
      restoreBardicInspiration: true
    }
  });
  const service = new BardicInspirationCompatService({});

  await service.applyDnd5ePostUseActivity({
    actor,
    item: drum
  });

  assert.equal(bardicInspiration.system.uses.spent, 1);
  assert.deepEqual(bardicInspiration.updates, [{ "system.uses.spent": 1 }]);
});

test("bardic inspiration compat does not overfill an already full Laaru resource", async () => {
  const bardicInspiration = makeLaaruBardicInspiration({ spent: 0 });
  const actor = makeActor([bardicInspiration]);
  const service = new BardicInspirationCompatService({});

  const result = await service.restoreBardicInspiration(actor);

  assert.equal(result.restored, false);
  assert.equal(result.reason, "already-full");
  assert.equal(bardicInspiration.system.uses.spent, 0);
  assert.deepEqual(bardicInspiration.updates, []);
});

test("combat hooks register bardic inspiration compatibility on post-use activity", async () => {
  const previousGame = globalThis.game;
  const previousHooks = globalThis.Hooks;
  const callbacks = [];
  globalThis.game = {};
  globalThis.Hooks = {
    on(name, callback) {
      callbacks.push({ name, callback });
    }
  };
  const { registerCombatHooks } = await import(`../scripts/combat/hooks.js?bardic-compat=${Date.now()}`);

  try {
    registerCombatHooks({
      bardicInspirationCompatService: {
        applyDnd5ePostUseActivity: async () => true
      }
    });

    assert.ok(callbacks.some((entry) => entry.name === "dnd5e.postUseActivity"));
  }
  finally {
    globalThis.game = previousGame;
    globalThis.Hooks = previousHooks;
  }
});
