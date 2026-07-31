import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMelfsMinuteMeteorsRecipe,
  melfMeteorPool
} from "../scripts/combat/melfs-minute-meteors-recipe.js";

const MODULE_ID = "rebreya-main";
const RECIPE = "melfs-minute-meteors";

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createItem() {
  const actor = { uuid: "Actor.melf" };
  const item = { uuid: "Actor.melf.Item.melf", actor, system: { level: 3, activities: {} } };
  const cast = { _id: "melfMeteorsCast1", uuid: `${item.uuid}.Activity.melfMeteorsCast1`, item, actor };
  const release = { _id: "melfMeteorRel001", uuid: `${item.uuid}.Activity.melfMeteorRel001`, item, actor };
  const burst = { _id: "melfMeteorBurst1", uuid: `${item.uuid}.Activity.melfMeteorBurst1`, item, actor, type: "save" };
  item.system.activities = { cast, release, burst };
  return { actor, item, cast, release, burst };
}

function createRuntime({ remainingMeteors = 6 } = {}) {
  const state = {
    instanceId: "melf-instance",
    recipe: RECIPE,
    version: 1,
    revision: 0,
    state: { slotLevel: 3, remainingMeteors, totalMeteors: remainingMeteors }
  };
  const calls = { create: [], delete: [], update: [] };
  return {
    calls,
    state,
    async createInstance(context, initialState) {
      calls.create.push({ context, initialState });
      state.instanceId = context.instanceId;
      state.recipe = context.declaration.recipe;
      state.version = context.declaration.version;
      state.revision = 0;
      state.state = structuredClone(initialState);
      return { ...state, effect: { id: "melf-effect" } };
    },
    readInstance({ instanceId } = {}) {
      return state.deleted || (instanceId && instanceId !== state.instanceId) ? null : { ...state, state: structuredClone(state.state), effect: { id: "melf-effect" } };
    },
    async updateInstance({ instanceId, expectedRevision, operationId, state: next }) {
      assert.equal(instanceId, state.instanceId);
      assert.equal(expectedRevision, state.revision);
      calls.update.push({ expectedRevision, operationId, state: structuredClone(next) });
      state.revision += 1;
      state.state = structuredClone(next);
      return { ...state, state: structuredClone(state.state), effect: { id: "melf-effect" } };
    },
    async deleteInstance({ instanceId, expectedRevision, operationId }) {
      assert.equal(instanceId, state.instanceId);
      assert.equal(expectedRevision, state.revision);
      calls.delete.push({ expectedRevision, operationId });
      state.deleted = true;
      return { ...state };
    }
  };
}

function concentration(actor) {
  return { uuid: `${actor.uuid}.ActiveEffect.concentration`, actor, disabled: false };
}

function context(parts, overrides = {}) {
  return {
    action: "cast",
    activity: parts.cast,
    actor: parts.actor,
    concentrationEffect: concentration(parts.actor),
    declaration: { recipe: RECIPE, version: 1 },
    item: parts.item,
    operationId: "cast-operation",
    usageConfig: { spell: { slot: 3 } },
    workflow: { completed: true },
    ...overrides
  };
}

function recipeFixture(options = {}) {
  const parts = createItem();
  const runtime = options.runtime ?? createRuntime(options);
  const choices = [...(options.choices ?? [{ cancelled: false, count: 0 }])];
  const dialogs = [];
  const runs = [];
  const errors = [];
  const recipe = buildMelfsMinuteMeteorsRecipe({
    instanceRuntime: runtime,
    dialog: async (request) => {
      dialogs.push(request);
      return choices.shift() ?? { cancelled: true, count: 0 };
    },
    runActivity: async (activity, usageConfig) => {
      runs.push({ activity, usageConfig });
      if (typeof options.runActivity === "function") {
        return options.runActivity(activity, usageConfig);
      }
      return options.runResults?.shift?.() ?? { completed: true };
    },
    notifyError: (message) => errors.push(message),
    logger: { error() {} }
  });
  return { ...parts, runtime, recipe, dialogs, runs, errors };
}

test("builds 6 meteors at slot level 3 and 2 more per higher level", () => {
  assert.equal(melfMeteorPool(1), 6);
  assert.equal(melfMeteorPool(3), 6);
  assert.equal(melfMeteorPool(4), 8);
  assert.equal(melfMeteorPool(6), 12);
});

test("does not create an instance for canceled or counterspelled casts", async () => {
  for (const workflow of [{ completed: false, cancelled: true }, { completed: true, counterspelled: true }]) {
    const fixture = recipeFixture();
    await fixture.recipe.handlers.postUseActivity(context(fixture, { workflow }));
    assert.equal(fixture.runtime.calls.create.length, 0);
  }
});

test("creates the instance after a successful cast using normalized highest-priority slot data", async () => {
  const fixture = recipeFixture({ choices: [{ cancelled: false, count: 0 }] });
  await fixture.recipe.handlers.postUseActivity(context(fixture, {
    usageConfig: { spell: { slot: "5.8" } },
    workflow: { completed: true, castData: { castLevel: 8 }, itemLevel: 9 }
  }));
  assert.equal(fixture.runtime.calls.create.length, 1);
  assert.deepEqual(fixture.runtime.calls.create[0].initialState, { slotLevel: 5, remainingMeteors: 10, totalMeteors: 10 });
});

test("offers initial 0 1 or 2 only after creating the instance", async () => {
  const fixture = recipeFixture({ choices: [{ cancelled: false, count: 2 }] });
  await fixture.recipe.handlers.postUseActivity(context(fixture));
  assert.equal(fixture.runtime.calls.create.length, 1);
  assert.deepEqual(fixture.dialogs[0].counts, [0, 1, 2]);
  const bursts = fixture.runs.filter((run) => run.activity === fixture.burst);
  assert.equal(bursts.length, 2);
  assert.equal(bursts[0].usageConfig.spell, undefined);
});

test("initial zero keeps the complete pool and consumes no bonus activity", async () => {
  const fixture = recipeFixture();
  await fixture.recipe.handlers.postUseActivity(context(fixture));
  assert.equal(fixture.runtime.state.state.remainingMeteors, 6);
  assert.equal(fixture.runs.length, 0);
});

test("an instance creation error preserves concentration and skips release", async () => {
  const fixture = recipeFixture();
  const failure = new Error("create failed");
  fixture.runtime.createInstance = async () => { throw failure; };
  const normalConcentration = concentration(fixture.actor);
  await fixture.recipe.handlers.postUseActivity(context(fixture, { concentrationEffect: normalConcentration }));
  assert.equal(normalConcentration.disabled, false);
  assert.equal(fixture.runs.length, 0);
  assert.equal(fixture.errors.length, 1);
});

test("later release offers one or two then replays the stable bonus activity once", async () => {
  const fixture = recipeFixture({ choices: [{ cancelled: false, count: 2 }] });
  const releaseContext = context(fixture, { action: "release", activity: fixture.release, operationId: "release-operation" });
  assert.equal(fixture.recipe.handlers.preUseActivity(releaseContext), false);
  await flush();
  assert.deepEqual(fixture.dialogs[0].counts, [1, 2]);
  assert.equal(fixture.runs[0].activity, fixture.release);
  assert.equal(fixture.runs[0].usageConfig[MODULE_ID].spellAutomationChild, true);
  assert.equal(fixture.runs[0].usageConfig[MODULE_ID].operationId, "release-operation");
  assert.equal(fixture.runs.filter((run) => run.activity === fixture.release).length, 1);
  assert.equal(fixture.runs.filter((run) => run.activity === fixture.burst).length, 2);
});

test("canceling the later count dialog prevents its bonus-action replay", async () => {
  const fixture = recipeFixture({ choices: [{ cancelled: true, count: 0 }] });
  fixture.recipe.handlers.preUseActivity(context(fixture, { action: "release", activity: fixture.release }));
  await flush();
  assert.equal(fixture.runs.length, 0);
});

test("each meteor resolves the stable burst activity as a separate Dexterity save workflow", async () => {
  const fixture = recipeFixture({ choices: [{ cancelled: false, count: 2 }] });
  fixture.recipe.handlers.preUseActivity(context(fixture, { action: "release", activity: fixture.release }));
  await flush();
  const bursts = fixture.runs.filter((run) => run.activity === fixture.burst);
  assert.equal(bursts.length, 2);
  assert.equal(fixture.burst.type, "save");
  assert.deepEqual(bursts.map((run) => run.usageConfig[MODULE_ID].meteorIndex), [0, 1]);
});

test("every burst carries child marker, parent operation and instance id even at the same point", async () => {
  const fixture = recipeFixture({ choices: [{ cancelled: false, count: 2 }] });
  fixture.recipe.handlers.preUseActivity(context(fixture, { action: "release", activity: fixture.release, operationId: "same-point" }));
  await flush();
  const bursts = fixture.runs.filter((run) => run.activity === fixture.burst);
  assert.equal(bursts.length, 2);
  for (const burst of bursts) {
    assert.deepEqual(burst.usageConfig[MODULE_ID].spellAutomationChild, true);
    assert.equal(burst.usageConfig[MODULE_ID].operationId, "same-point");
    assert.equal(burst.usageConfig[MODULE_ID].instanceId, "melf-instance");
  }
});

test("a canceled first template spends no meteors and a canceled second retains the first commit", async () => {
  const first = recipeFixture({
    choices: [{ cancelled: false, count: 2 }],
    runActivity: (activity) => activity._id === "melfMeteorRel001" ? { completed: true } : { cancelled: true }
  });
  first.recipe.handlers.preUseActivity(context(first, { action: "release", activity: first.release }));
  await flush();
  assert.equal(first.runtime.state.state.remainingMeteors, 6);
  assert.equal(first.runtime.calls.update.length, 0);

  let burstCount = 0;
  const second = recipeFixture({
    choices: [{ cancelled: false, count: 2 }],
    runActivity: (activity) => {
      if (activity._id === "melfMeteorRel001") return { completed: true };
      burstCount += 1;
      return burstCount === 1 ? { completed: true } : { cancelled: true };
    }
  });
  second.recipe.handlers.preUseActivity(context(second, { action: "release", activity: second.release }));
  await flush();
  assert.equal(second.runtime.state.state.remainingMeteors, 5);
  assert.equal(second.runtime.calls.update.length, 1);
});

test("the last completed meteor deletes the instance effect", async () => {
  const fixture = recipeFixture({ remainingMeteors: 1, choices: [{ cancelled: false, count: 1 }] });
  fixture.recipe.handlers.preUseActivity(context(fixture, { action: "release", activity: fixture.release }));
  await flush();
  assert.equal(fixture.runtime.calls.delete.length, 1);
  assert.equal(fixture.runtime.state.deleted, true);
});

test("lost concentration blocks later release and child activities neither recurse nor consume a slot", async () => {
  const fixture = recipeFixture();
  fixture.runtime.state.deleted = true;
  fixture.recipe.handlers.preUseActivity(context(fixture, { action: "release", activity: fixture.release }));
  await flush();
  assert.equal(fixture.runs.length, 0);

  assert.equal(fixture.recipe.handlers.preUseActivity(context(fixture, {
    action: "release", activity: fixture.release, isChildInvocation: true
  })), true);
  await fixture.recipe.handlers.postUseActivity(context(fixture, {
    isChildInvocation: true, usageConfig: { spell: { slot: 9 } }
  }));
  assert.equal(fixture.runtime.calls.create.length, 0);
});

test("concurrent and repeated release operation ids cannot apply a second volley", async () => {
  const fixture = recipeFixture({ choices: [{ cancelled: false, count: 1 }, { cancelled: false, count: 1 }] });
  const release = context(fixture, { action: "release", activity: fixture.release, operationId: "one-operation" });
  fixture.recipe.handlers.preUseActivity(release);
  fixture.recipe.handlers.preUseActivity(release);
  await flush();
  await flush();
  assert.equal(fixture.runtime.state.state.remainingMeteors, 5);
  assert.equal(fixture.runs.filter((run) => run.activity === fixture.release).length, 1);
  assert.equal(fixture.runs.filter((run) => run.activity === fixture.burst).length, 1);
});

test("concurrent distinct releases cannot spend more meteors than the persisted pool", async () => {
  const fixture = recipeFixture({
    remainingMeteors: 1,
    choices: [{ cancelled: false, count: 1 }, { cancelled: false, count: 1 }]
  });
  fixture.recipe.handlers.preUseActivity(context(fixture, {
    action: "release", activity: fixture.release, operationId: "first-release"
  }));
  fixture.recipe.handlers.preUseActivity(context(fixture, {
    action: "release", activity: fixture.release, operationId: "second-release"
  }));
  await flush();
  await flush();
  assert.equal(fixture.runs.filter((run) => run.activity === fixture.burst).length, 1);
  assert.equal(fixture.runtime.calls.delete.length, 1);
});

test("a post-damage failure stops the volley, reports it, and never rolls back Midi damage", async () => {
  const failure = new Error("persist failed after damage");
  const fixture = recipeFixture({ choices: [{ cancelled: false, count: 2 }] });
  fixture.runtime.updateInstance = async () => { throw failure; };
  fixture.recipe.handlers.preUseActivity(context(fixture, { action: "release", activity: fixture.release }));
  await flush();
  assert.equal(fixture.runs.filter((run) => run.activity === fixture.burst).length, 1);
  assert.equal(fixture.errors.length, 1);
  assert.equal(typeof fixture.runtime.rollbackDamage, "undefined");
});
