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

function createOperationJournal({ limit = 128 } = {}) {
  const entriesByActor = new Map();
  return {
    async claim({ actor, declaration, operationId }) {
      const entries = entriesByActor.get(actor.uuid) ?? [];
      const duplicate = entries.some((entry) => entry.recipe === declaration.recipe
        && entry.version === declaration.version && entry.operationId === operationId);
      if (duplicate) return { status: "completed" };
      const entry = { recipe: declaration.recipe, version: declaration.version, operationId };
      entriesByActor.set(actor.uuid, [...entries, entry].slice(-limit));
      return { status: "claimed" };
    }
  };
}

function createRuntime({ remainingMeteors = 6, operationJournal = createOperationJournal() } = {}) {
  const state = {
    instanceId: "melf-instance",
    recipe: RECIPE,
    version: 1,
    revision: 0,
    state: { slotLevel: 3, remainingMeteors, totalMeteors: remainingMeteors }
  };
  const calls = { claim: [], create: [], delete: [], timeline: [], update: [] };
  return {
    calls,
    state,
    async claimOperation(input) {
      const result = await operationJournal.claim(input);
      calls.claim.push({ ...input, status: result.status });
      calls.timeline.push("claim");
      return result;
    },
    async createInstance(context, initialState) {
      calls.timeline.push("create");
      calls.create.push({ context, initialState });
      state.instanceId = context.instanceId;
      state.recipe = context.declaration.recipe;
      state.version = context.declaration.version;
      state.revision = 0;
      state.state = structuredClone(initialState);
      return { ...state, effect: { id: "melf-effect" } };
    },
    readInstance({ instanceId } = {}) {
      calls.timeline.push("read");
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

function createActorScopedRuntime({ remainingMeteors = 6, operationJournal = createOperationJournal() } = {}) {
  const states = new Map();
  const calls = { claim: [], create: [], delete: [], update: [] };
  function row(actor) {
    const existing = states.get(actor.uuid);
    if (existing) return existing;
    const state = {
      instanceId: "melf-instance",
      recipe: RECIPE,
      version: 1,
      revision: 0,
      state: { slotLevel: 3, remainingMeteors, totalMeteors: remainingMeteors }
    };
    states.set(actor.uuid, state);
    return state;
  }
  function snapshot(state) {
    return { ...state, state: structuredClone(state.state), effect: { id: "melf-effect" } };
  }
  return {
    calls,
    async claimOperation(input) {
      const result = await operationJournal.claim(input);
      calls.claim.push({ ...input, status: result.status });
      return result;
    },
    readInstance({ actor, instanceId } = {}) {
      const state = row(actor);
      return state.deleted || (instanceId && instanceId !== state.instanceId) ? null : snapshot(state);
    },
    async createInstance(context, initialState) {
      const state = row(context.actor);
      calls.create.push({ context, initialState });
      state.instanceId = context.instanceId;
      state.state = structuredClone(initialState);
      return snapshot(state);
    },
    async updateInstance({ actor, instanceId, expectedRevision, operationId, state: next }) {
      const state = row(actor);
      assert.equal(instanceId, state.instanceId);
      assert.equal(expectedRevision, state.revision);
      calls.update.push({ actorUuid: actor.uuid, operationId, state: structuredClone(next) });
      state.revision += 1;
      state.state = structuredClone(next);
      return snapshot(state);
    },
    async deleteInstance({ actor, instanceId, expectedRevision, operationId }) {
      const state = row(actor);
      assert.equal(instanceId, state.instanceId);
      assert.equal(expectedRevision, state.revision);
      calls.delete.push({ actorUuid: actor.uuid, operationId });
      state.deleted = true;
      return snapshot(state);
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

test("requires the durable spell-operation journal on its runtime", () => {
  // Catches a recipe that can create a disposable spell instance without first recording the cast operation on its Actor.
  const runtime = createRuntime();
  delete runtime.claimOperation;

  assert.throws(() => buildMelfsMinuteMeteorsRecipe({
    instanceRuntime: runtime,
    dialog: async () => ({ cancelled: true, count: 0 }),
    runActivity: async () => ({ completed: true })
  }), /claimOperation/u);
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

test("claims a successful cast authoritatively before reading, creating, prompting, or releasing meteors", async () => {
  // Catches a post-use handler creating state first, which cannot survive a later effect cleanup or client replay safely.
  const fixture = recipeFixture({ choices: [{ cancelled: false, count: 0 }] });
  const cast = context(fixture, { operationId: "journalled-cast" });

  await fixture.recipe.handlers.postUseActivity(cast);

  assert.deepEqual(fixture.runtime.calls.claim, [{
    actor: fixture.actor,
    authoritative: true,
    declaration: { recipe: RECIPE, version: 1 },
    operationId: "journalled-cast",
    status: "claimed"
  }]);
  assert.deepEqual(fixture.runtime.calls.timeline.slice(0, 3), ["claim", "read", "create"]);
  assert.equal(fixture.dialogs.length, 1);
});

test("a rejected cast journal claim fails closed before creating an instance or child effect", async () => {
  // Catches a failed Actor journal write falling through to a spell instance and allowing a replay window.
  const fixture = recipeFixture();
  fixture.runtime.claimOperation = async () => { throw new Error("journal write failed"); };

  await fixture.recipe.handlers.postUseActivity(context(fixture));

  assert.equal(fixture.runtime.calls.create.length, 0);
  assert.equal(fixture.dialogs.length, 0);
  assert.equal(fixture.runs.length, 0);
  assert.equal(fixture.errors.length, 1);
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
  assert.equal(fixture.runs[0].usageConfig[MODULE_ID].instanceId, "melf-instance");
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
  assert.equal(first.runs.filter((run) => run.activity === first.burst).length, 1);

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
  assert.equal(second.runs.filter((run) => run.activity === second.burst).length, 2);
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

test("two recipe clients reserve one persisted release before either can replay its bonus activity or burst", async () => {
  // Catches recipe-local idempotency: two Foundry clients must not both reach an external child workflow.
  const runtime = createRuntime();
  const first = recipeFixture({ runtime, choices: [{ cancelled: false, count: 1 }] });
  const second = recipeFixture({ runtime, choices: [{ cancelled: false, count: 1 }] });
  const firstRelease = context(first, {
    action: "release", activity: first.release, operationId: "shared-release"
  });
  const secondRelease = context(second, {
    action: "release", activity: second.release, operationId: "shared-release"
  });

  first.recipe.handlers.preUseActivity(firstRelease);
  second.recipe.handlers.preUseActivity(secondRelease);
  await flush();
  await flush();

  const externalChildren = [
    ...first.runs.filter((run) => run.activity === first.release || run.activity === first.burst),
    ...second.runs.filter((run) => run.activity === second.release || run.activity === second.burst)
  ];
  assert.equal(externalChildren.length, 2);
  assert.equal(externalChildren.filter((run) => run.activity._id === "melfMeteorRel001").length, 1);
  assert.equal(externalChildren.filter((run) => run.activity._id === "melfMeteorBurst1").length, 1);
  assert.equal(runtime.state.state.remainingMeteors, 5);
});

test("two recipe clients claim one initial cast before either creates, prompts, or releases a meteor", async () => {
  // Catches relying on the per-recipe in-flight map when the same cast is delivered to two clients.
  const runtime = createRuntime();
  const first = recipeFixture({ runtime, choices: [{ cancelled: false, count: 1 }] });
  const second = recipeFixture({ runtime, choices: [{ cancelled: false, count: 1 }] });
  const firstCast = context(first, { operationId: "shared-initial-cast" });
  const secondCast = context(second, { operationId: "shared-initial-cast" });

  await Promise.all([
    first.recipe.handlers.postUseActivity(firstCast),
    second.recipe.handlers.postUseActivity(secondCast)
  ]);

  assert.deepEqual(runtime.calls.claim.map((call) => call.status).sort(), ["claimed", "completed"]);
  assert.equal(runtime.calls.create.length, 1);
  assert.equal(first.dialogs.length + second.dialogs.length, 1);
  assert.equal(first.runs.length + second.runs.length, 1);
});

test("a fresh recipe ignores a redelivered cast after its final later meteor deleted the instance", async () => {
  // Catches cast idempotency stored only on the disposable Melf ActiveEffect instead of the durable Actor journal.
  const runtime = createRuntime();
  const initial = recipeFixture({ runtime, choices: [{ cancelled: false, count: 0 }, { cancelled: false, count: 1 }] });
  const originalCast = context(initial, { operationId: "deleted-instance-cast" });

  await initial.recipe.handlers.postUseActivity(originalCast);
  runtime.state.state.remainingMeteors = 1;
  initial.recipe.handlers.preUseActivity(context(initial, {
    action: "release", activity: initial.release, operationId: "last-meteor-release"
  }));
  await flush();
  assert.equal(runtime.state.deleted, true);

  const fresh = recipeFixture({ runtime, choices: [{ cancelled: false, count: 1 }] });
  await fresh.recipe.handlers.postUseActivity(context(fresh, { operationId: "deleted-instance-cast" }));

  assert.equal(runtime.calls.create.length, 1);
  assert.equal(fresh.dialogs.length, 0);
  assert.equal(fresh.runs.length, 0);
  assert.equal(runtime.state.deleted, true);
});

test("one recipe scopes equal release operation ids by actor and spell instance", async () => {
  // Catches in-flight bookkeeping keyed only by parent operation, which blocks another actor's Melf instance.
  const runtime = createActorScopedRuntime();
  const fixture = recipeFixture({
    runtime,
    choices: [{ cancelled: false, count: 1 }, { cancelled: false, count: 1 }]
  });
  const other = createItem();
  other.actor.uuid = "Actor.other-melf";
  const first = context(fixture, { action: "release", activity: fixture.release, operationId: "shared-parent" });
  const second = context(other, { action: "release", activity: other.release, operationId: "shared-parent" });

  fixture.recipe.handlers.preUseActivity(first);
  fixture.recipe.handlers.preUseActivity(second);
  await flush();
  await flush();

  assert.equal(fixture.runs.filter((run) => run.activity._id === "melfMeteorRel001").length, 2);
  assert.equal(fixture.runs.filter((run) => run.activity._id === "melfMeteorBurst1").length, 2);
  assert.equal(runtime.readInstance({ actor: fixture.actor }).state.remainingMeteors, 5);
  assert.equal(runtime.readInstance({ actor: other.actor }).state.remainingMeteors, 5);
});

test("a terminal cancellation commits its parent operation and blocks its replay after the local in-flight map is gone", async () => {
  // Catches an unbounded recipe Set replacement that forgets cancellation once its local promise completes.
  const runtime = createRuntime();
  const fixture = recipeFixture({ runtime, choices: [{ cancelled: true, count: 0 }] });
  const replayFixture = recipeFixture({ runtime, choices: [{ cancelled: false, count: 1 }] });
  const release = context(fixture, { action: "release", activity: fixture.release, operationId: "cancelled-release" });
  const replay = context(replayFixture, {
    action: "release", activity: replayFixture.release, operationId: "cancelled-release"
  });

  fixture.recipe.handlers.preUseActivity(release);
  await flush();
  replayFixture.recipe.handlers.preUseActivity(replay);
  await flush();

  assert.equal(fixture.dialogs.length, 1);
  assert.equal(replayFixture.dialogs.length, 0);
  assert.equal(fixture.runs.length + replayFixture.runs.length, 0);
  assert.equal(fixture.runtime.state.state.remainingMeteors, 6);
});

test("duplicate initial post-use reserves before the choice and releases a zero-meteor cast terminally", async () => {
  // Catches duplicate postUse invocations opening multiple initial dialogs after the persisted instance exists.
  const fixture = recipeFixture({ choices: [{ cancelled: false, count: 0 }, { cancelled: false, count: 1 }] });
  const initial = context(fixture, { operationId: "initial-zero" });

  await Promise.all([
    fixture.recipe.handlers.postUseActivity(initial),
    fixture.recipe.handlers.postUseActivity(initial)
  ]);
  await fixture.recipe.handlers.postUseActivity(initial);

  assert.equal(fixture.runtime.calls.create.length, 1);
  assert.equal(fixture.dialogs.length, 1);
  assert.equal(fixture.runs.length, 0);
  assert.equal(fixture.runtime.state.state.remainingMeteors, 6);
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
  const updateInstance = fixture.runtime.updateInstance;
  fixture.runtime.updateInstance = async (input) => {
    if (String(input.operationId).includes(":persist:")) throw failure;
    return updateInstance(input);
  };
  fixture.recipe.handlers.preUseActivity(context(fixture, { action: "release", activity: fixture.release }));
  await flush();
  assert.equal(fixture.runs.filter((run) => run.activity === fixture.burst).length, 1);
  assert.equal(fixture.errors.length, 1);
  assert.equal(typeof fixture.runtime.rollbackDamage, "undefined");
});
