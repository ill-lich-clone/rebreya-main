import test from "node:test";
import assert from "node:assert/strict";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import {
  SPELL_INSTANCE_FLAG,
  SpellInstanceRuntime,
  buildSpellInstanceEffectData,
  findSpellInstance,
  readSpellInstance
} from "../scripts/combat/spell-instance-runtime.js";

const MODULE_ID = "rebreya-main";

function clone(value) {
  return structuredClone(value);
}

function assignPath(target, path, value) {
  const keys = path.split(".");
  let current = target;
  for (const key of keys.slice(0, -1)) {
    current[key] ??= {};
    current = current[key];
  }
  current[keys.at(-1)] = clone(value);
}

function createEffect(actor, data = {}) {
  const effect = {
    actor,
    disabled: data.disabled ?? false,
    flags: clone(data.flags ?? {}),
    id: data.id ?? `effect-${actor.nextEffectId++}`,
    origin: data.origin ?? null,
    transfer: data.transfer ?? false,
    updateCalls: [],
    uuid: data.uuid ?? `${actor.uuid}.ActiveEffect.${data.id ?? `effect-${actor.nextEffectId - 1}`}`,
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(update) {
      this.updateCalls.push(clone(update));
      for (const [path, value] of Object.entries(update)) {
        assignPath(this, path, value);
      }
      return this;
    }
  };
  return effect;
}

function createActor({ effects = [], failCreate = null, uuid = "Actor.caster" } = {}) {
  const actor = {
    createCalls: [],
    deleteCalls: [],
    effects: [],
    failCreate,
    flags: {},
    nextEffectId: 1,
    updateCalls: [],
    uuid,
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(update) {
      this.updateCalls.push(clone(update));
      for (const [path, value] of Object.entries(update)) {
        assignPath(this, path, value);
      }
      return this;
    },
    async createEmbeddedDocuments(type, documents) {
      this.createCalls.push({ type, documents: clone(documents) });
      if (this.failCreate) {
        throw this.failCreate;
      }
      const created = documents.map((document) => createEffect(this, document));
      this.effects.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(type, ids) {
      this.deleteCalls.push({ type, ids: [...ids] });
      this.effects = this.effects.filter((effect) => !ids.includes(effect.id));
      return ids;
    }
  };
  actor.effects.push(...effects.map((effect) => createEffect(actor, effect)));
  return actor;
}

function createConcentrationEffect(actor) {
  const effect = createEffect(actor, {
    id: "concentration",
    uuid: `${actor.uuid}.ActiveEffect.concentration`
  });
  actor.effects.push(effect);
  return effect;
}

function createContext(actor, concentrationEffect, overrides = {}) {
  return {
    actor,
    activity: { uuid: `${actor.uuid}.Item.melf.Activity.cast` },
    concentrationEffect,
    declaration: { recipe: "melfs-minute-meteors", version: 1 },
    instanceId: "melf-cast-operation",
    item: { uuid: `${actor.uuid}.Item.melf` },
    operationId: "cast-operation",
    ...overrides
  };
}

function createRuntime(options = {}) {
  return new SpellInstanceRuntime({
    coordinator: new WorldMutationCoordinator(),
    linkDependency: async () => {},
    ...options
  });
}

async function createInstance(runtime, actor, options = {}) {
  const concentrationEffect = createConcentrationEffect(actor);
  const context = createContext(actor, concentrationEffect, options.context);
  const result = await runtime.createInstance(context, options.state ?? {
    remainingMeteors: 6,
    totalMeteors: 6
  });
  return { concentrationEffect, context, result };
}

test("creates one module-owned ActiveEffect after a successful cast", async () => {
  // Catches a runtime that creates duplicate state documents or skips the cast state write.
  const actor = createActor();
  const runtime = createRuntime();

  const { result } = await createInstance(runtime, actor);

  assert.equal(actor.createCalls.length, 1);
  assert.equal(actor.createCalls[0].type, "ActiveEffect");
  assert.equal(actor.effects.filter((effect) => readSpellInstance(effect)).length, 1);
  assert.equal(result.effect, actor.effects.find((effect) => readSpellInstance(effect)));
});

test("persists recipe version source uuids operation id revision and state", async () => {
  // Catches an effect builder that loses stable declaration metadata or recipe-owned fields.
  const actor = createActor();
  const runtime = createRuntime();
  const state = { remainingMeteors: 6, totalMeteors: 6, futureRecipeField: { mode: "volley" } };
  const { context, result } = await createInstance(runtime, actor, { state });

  assert.deepEqual(readSpellInstance(result.effect), {
    runtime: "instance",
    recipe: "melfs-minute-meteors",
    version: 1,
    instanceId: "melf-cast-operation",
    sourceActorUuid: actor.uuid,
    sourceItemUuid: context.item.uuid,
    sourceActivityUuid: context.activity.uuid,
    concentrationEffectUuid: context.concentrationEffect.uuid,
    createdOperationId: "cast-operation",
    revision: 0,
    state
  });
  assert.equal(result.effect.origin, context.item.uuid);
  assert.equal(result.effect.transfer, false);
  assert.equal(result.effect.disabled, false);
});

test("links the state effect to the native concentration effect", async () => {
  // Catches a cast that leaves its managed state alive after normal concentration ends.
  const actor = createActor();
  const links = [];
  const runtime = createRuntime({
    linkDependency: async (concentrationEffect, instanceEffect) => {
      links.push({ concentrationEffect, instanceEffect });
    }
  });

  const { concentrationEffect, result } = await createInstance(runtime, actor);

  assert.deepEqual(links, [{ concentrationEffect, instanceEffect: result.effect }]);
  assert.equal(concentrationEffect.updateCalls.length, 0);
});

test("reads only the current actor effects and never scans the world", () => {
  // Catches lookup code that finds a similarly named instance by scanning global collections.
  const actor = createActor();
  const foreignActor = createActor();
  const foreignEffect = createEffect(foreignActor, {
    flags: { [MODULE_ID]: { [SPELL_INSTANCE_FLAG]: {
      runtime: "instance", recipe: "melfs-minute-meteors", version: 1,
      instanceId: "foreign", revision: 0, state: {}
    } } }
  });
  foreignActor.effects.push(foreignEffect);
  const priorGame = globalThis.game;
  Object.defineProperty(globalThis, "game", {
    configurable: true,
    value: { get actors() { throw new Error("world scan"); } }
  });

  try {
    assert.equal(findSpellInstance(actor, {
      recipe: "melfs-minute-meteors", version: 1, instanceId: "foreign"
    }), null);
  }
  finally {
    if (priorGame === undefined) {
      delete globalThis.game;
    }
    else {
      globalThis.game = priorGame;
    }
  }
});

test("returns an existing instance for a repeated create operation id", async () => {
  // Catches a repeated completed-cast hook creating a second state effect.
  const actor = createActor();
  const runtime = createRuntime();
  const concentrationEffect = createConcentrationEffect(actor);
  const context = createContext(actor, concentrationEffect);

  const first = await runtime.createInstance(context, { remainingMeteors: 6 });
  const repeated = await runtime.createInstance(context, { remainingMeteors: 99 });

  assert.equal(repeated.effect, first.effect);
  assert.equal(actor.createCalls.length, 1);
  assert.equal(readSpellInstance(repeated.effect).state.remainingMeteors, 6);
});

test("serializes concurrent operations for one instance", async () => {
  // Catches per-instance actions running concurrently and observing the same mutable state.
  const actor = createActor();
  const runtime = createRuntime();
  const { context } = await createInstance(runtime, actor);
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const events = [];

  const first = runtime.runInstanceOperation({
    actor, instanceId: context.instanceId, operationId: "first-volley"
  }, async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    return "first";
  });
  const second = runtime.runInstanceOperation({
    actor, instanceId: context.instanceId, operationId: "second-volley"
  }, async () => {
    events.push("second:start");
    return "second";
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start"]);
});

test("reports active local instance mutations until they settle or reject", async () => {
  const actor = createActor();
  const runtime = createRuntime();
  const { context } = await createInstance(runtime, actor);
  let releaseOperation;
  const gate = new Promise((resolve) => { releaseOperation = resolve; });

  const pending = runtime.runInstanceOperation({
    actor, instanceId: context.instanceId, operationId: "counted-volley"
  }, async () => gate);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.activeOperationCount, 1);

  releaseOperation("done");
  assert.equal(await pending, "done");
  assert.equal(runtime.activeOperationCount, 0);

  await assert.rejects(runtime.runInstanceOperation({
    actor, instanceId: context.instanceId, operationId: "rejected-volley"
  }, async () => { throw new Error("expected failure"); }), /expected failure/u);
  assert.equal(runtime.activeOperationCount, 0);
});

test("rejects a stale expected revision without losing state", async () => {
  // Catches an outdated volley overwriting a more recent resource decrement.
  const actor = createActor();
  const runtime = createRuntime();
  const { context, result } = await createInstance(runtime, actor);

  await runtime.updateInstance({
    actor, instanceId: context.instanceId, expectedRevision: 0,
    operationId: "first-update", state: { remainingMeteors: 5, totalMeteors: 6 }
  });
  await assert.rejects(runtime.updateInstance({
    actor, instanceId: context.instanceId, expectedRevision: 0,
    operationId: "stale-update", state: { remainingMeteors: 4, totalMeteors: 6 }
  }), /stale revision/u);

  assert.deepEqual(readSpellInstance(result.effect).state, { remainingMeteors: 5, totalMeteors: 6 });
  assert.equal(readSpellInstance(result.effect).revision, 1);
  assert.equal(result.effect.updateCalls.length, 1);
});

test("increments revision exactly once per committed update", async () => {
  // Catches a successful update that double-increments the optimistic concurrency revision.
  const actor = createActor();
  const runtime = createRuntime();
  const { context, result } = await createInstance(runtime, actor);

  const updated = await runtime.updateInstance({
    actor, instanceId: context.instanceId, expectedRevision: 0,
    operationId: "decrement-once", state: { remainingMeteors: 5, totalMeteors: 6, retained: true }
  });

  assert.equal(updated.revision, 1);
  assert.equal(readSpellInstance(result.effect).revision, 1);
  assert.deepEqual(readSpellInstance(result.effect).state, {
    remainingMeteors: 5, totalMeteors: 6, retained: true
  });
  assert.equal(result.effect.updateCalls.length, 1);
});

test("deletes the effect at terminal state", async () => {
  // Catches terminal resource exhaustion retaining an activatable spell state effect.
  const actor = createActor();
  const runtime = createRuntime();
  const { context, result } = await createInstance(runtime, actor);

  const deleted = await runtime.deleteInstance({
    actor, instanceId: context.instanceId, expectedRevision: 0, operationId: "terminal-volley"
  });

  assert.equal(deleted.instanceId, context.instanceId);
  assert.deepEqual(actor.deleteCalls, [{ type: "ActiveEffect", ids: [result.effect.id] }]);
  assert.equal(actor.effects.includes(result.effect), false);
});

test("a deleted effect blocks later operations", async () => {
  // Catches a later release continuing after the state-anchor effect was removed.
  const actor = createActor();
  const runtime = createRuntime();
  const { context } = await createInstance(runtime, actor);
  await runtime.deleteInstance({
    actor, instanceId: context.instanceId, expectedRevision: 0, operationId: "terminal-volley"
  });

  await assert.rejects(runtime.runInstanceOperation({
    actor, instanceId: context.instanceId, operationId: "late-volley"
  }, async () => "unexpected"), /not found/u);
  assert.equal(actor.createCalls.length, 1);
  assert.equal(actor.deleteCalls.length, 1);
});

test("instance creation failure leaves concentration untouched", async () => {
  // Catches error cleanup that deletes or rewrites the normal DnD5e concentration effect.
  const actor = createActor({ failCreate: new Error("create failed") });
  const concentrationEffect = createConcentrationEffect(actor);
  const links = [];
  const runtime = createRuntime({ linkDependency: async (...args) => links.push(args) });

  await assert.rejects(runtime.createInstance(createContext(actor, concentrationEffect), {
    remainingMeteors: 6
  }), /create failed/u);

  assert.equal(concentrationEffect.updateCalls.length, 0);
  assert.equal(actor.effects.includes(concentrationEffect), true);
  assert.deepEqual(links, []);
});

test("rejects non-serializable or non-plain recipe state", () => {
  // Catches persisted effect flags containing values that cannot survive Foundry serialization.
  const actor = createActor();
  const concentrationEffect = createConcentrationEffect(actor);
  const context = createContext(actor, concentrationEffect);
  const declaration = context.declaration;

  assert.throws(() => buildSpellInstanceEffectData(context, declaration, new Date()), TypeError);
  assert.throws(() => buildSpellInstanceEffectData(context, declaration, { remainingMeteors: undefined }), TypeError);
  assert.throws(() => buildSpellInstanceEffectData(context, declaration, { nested: { callback() {} } }), TypeError);
});

test("rejects invalid version and revision while preserving unknown plain state fields", async () => {
  // Catches malformed persisted flags being treated as active instances or recipe fields being stripped.
  const actor = createActor();
  const malformed = createEffect(actor, {
    flags: { [MODULE_ID]: { [SPELL_INSTANCE_FLAG]: {
      runtime: "instance", recipe: "melfs-minute-meteors", version: 0,
      instanceId: "bad", revision: -1, state: {}
    } } }
  });
  actor.effects.push(malformed);
  assert.equal(readSpellInstance(malformed), null);

  const runtime = createRuntime();
  const { context, result } = await createInstance(runtime, actor, {
    state: { remainingMeteors: 6, future: { property: ["keep", 1] } }
  });
  await runtime.updateInstance({
    actor, instanceId: context.instanceId, expectedRevision: 0, operationId: "future-state",
    state: { remainingMeteors: 5, future: { property: ["keep", 1] }, addedLater: "kept" }
  });

  assert.deepEqual(readSpellInstance(result.effect).state, {
    remainingMeteors: 5, future: { property: ["keep", 1] }, addedLater: "kept"
  });
});

test("falls back to a DnD5e dependency flag on the state effect", async () => {
  // Catches installations without Midi-QOL leaving the state effect unlinked to concentration.
  const actor = createActor();
  const priorMidi = globalThis.MidiQOL;
  globalThis.MidiQOL = undefined;

  try {
    const runtime = new SpellInstanceRuntime({ coordinator: new WorldMutationCoordinator() });
    const { concentrationEffect, result } = await createInstance(runtime, actor);
    assert.equal(result.effect.flags.dnd5e.dependentOn, concentrationEffect.uuid);
    assert.equal(concentrationEffect.updateCalls.length, 0);
    assert.equal(result.effect.updateCalls.length, 1);
  }
  finally {
    globalThis.MidiQOL = priorMidi;
  }
});

test("scopes repeated operation ids to each actor and instance key", async () => {
  // Catches WorldMutationCoordinator's global request cache returning actor A's instance for actor B.
  const coordinator = new WorldMutationCoordinator();
  const runtime = createRuntime({ coordinator });
  const actorA = createActor({ uuid: "Actor.a" });
  const actorB = createActor({ uuid: "Actor.b" });
  const concentrationA = createConcentrationEffect(actorA);
  const concentrationB = createConcentrationEffect(actorB);
  const contextA = createContext(actorA, concentrationA, {
    instanceId: "instance-a", operationId: "shared-operation"
  });
  const contextB = createContext(actorB, concentrationB, {
    instanceId: "instance-b", operationId: "shared-operation"
  });

  const [first, second] = await Promise.all([
    runtime.createInstance(contextA, { remainingMeteors: 6 }),
    runtime.createInstance(contextB, { remainingMeteors: 6 })
  ]);

  assert.equal(first.sourceActorUuid, actorA.uuid);
  assert.equal(second.sourceActorUuid, actorB.uuid);
  assert.equal(actorA.createCalls.length, 1);
  assert.equal(actorB.createCalls.length, 1);
  assert.equal(readSpellInstance(first.effect).createdOperationId, "shared-operation");
  assert.equal(readSpellInstance(second.effect).createdOperationId, "shared-operation");
});

test("cleans only a newly created state effect after dependency linking fails and permits a retry", async () => {
  // Catches a failed dependency link leaving an orphan that makes later casts look successful.
  const actor = createActor();
  const concentrationEffect = createConcentrationEffect(actor);
  const linkError = new Error("dependency link rejected");
  let attempts = 0;
  const runtime = createRuntime({
    linkDependency: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw linkError;
      }
    }
  });
  const failedContext = createContext(actor, concentrationEffect, { operationId: "failed-cast" });

  await assert.rejects(runtime.createInstance(failedContext, { remainingMeteors: 6 }), (error) => error === linkError);
  assert.deepEqual(actor.deleteCalls, [{ type: "ActiveEffect", ids: ["effect-1"] }]);
  assert.deepEqual(actor.effects, [concentrationEffect]);
  assert.equal(concentrationEffect.updateCalls.length, 0);

  const retried = await runtime.createInstance(
    createContext(actor, concentrationEffect, { operationId: "retry-cast" }),
    { remainingMeteors: 6 }
  );
  assert.equal(attempts, 2);
  assert.equal(readSpellInstance(retried.effect).createdOperationId, "retry-cast");
  assert.equal(actor.createCalls.length, 2);
  assert.equal(actor.deleteCalls.length, 1);
});

test("calls MidiQOL.addDependent with the MidiQOL receiver", async () => {
  // Catches extracting MidiQOL.addDependent and losing its required module receiver.
  const actor = createActor();
  const priorMidi = globalThis.MidiQOL;
  const midi = {
    linked: [],
    addDependent(concentrationEffect, instanceEffect) {
      this.linked.push({ concentrationEffect, instanceEffect });
    }
  };
  globalThis.MidiQOL = midi;

  try {
    const runtime = new SpellInstanceRuntime({ coordinator: new WorldMutationCoordinator() });
    const { concentrationEffect, result } = await createInstance(runtime, actor);
    assert.deepEqual(midi.linked, [{ concentrationEffect, instanceEffect: result.effect }]);
    assert.equal(result.effect.updateCalls.length, 0);
  }
  finally {
    if (priorMidi === undefined) {
      delete globalThis.MidiQOL;
    }
    else {
      globalThis.MidiQOL = priorMidi;
    }
  }
});

test("concurrent updates with one expected revision commit once and reject the stale writer", async () => {
  // Catches two queued updates with the same revision both overwriting the instance state.
  const actor = createActor();
  const runtime = createRuntime();
  const { context, result } = await createInstance(runtime, actor);

  const outcomes = await Promise.allSettled([
    runtime.updateInstance({
      actor, instanceId: context.instanceId, expectedRevision: 0,
      operationId: "race-first", state: { remainingMeteors: 5, totalMeteors: 6 }
    }),
    runtime.updateInstance({
      actor, instanceId: context.instanceId, expectedRevision: 0,
      operationId: "race-second", state: { remainingMeteors: 4, totalMeteors: 6 }
    })
  ]);

  assert.equal(outcomes[0].status, "fulfilled");
  assert.equal(outcomes[1].status, "rejected");
  assert.match(outcomes[1].reason.message, /stale revision/u);
  assert.equal(readSpellInstance(result.effect).revision, 1);
  assert.deepEqual(readSpellInstance(result.effect).state, { remainingMeteors: 5, totalMeteors: 6 });
  assert.equal(result.effect.updateCalls.length, 1);
});

test("durably claims an operation without an instance and blocks a fresh runtime after effects are deleted", async () => {
  // Catches journal state being attached to a disposable ActiveEffect or held only in one runtime memory cache.
  const actor = createActor();
  const declaration = { recipe: "delayed-spell", version: 1 };
  const firstRuntime = createRuntime();

  const claimed = await firstRuntime.claimOperation({ actor, declaration, operationId: "release-1" });
  actor.effects = [];
  const freshRuntime = createRuntime();
  const repeated = await freshRuntime.claimOperation({ actor, declaration, operationId: "release-1" });

  assert.equal(claimed.status, "claimed");
  assert.equal(repeated.status, "completed");
  assert.equal(actor.updateCalls.length, 1);
});

test("authoritative claims serialize two client runtimes so exactly one may perform an effect", async () => {
  // Catches using coordinator idempotency cache, which would return claimed to both concurrent callers.
  const actor = createActor();
  const declaration = { recipe: "delayed-spell", version: 1 };
  const authority = createRuntime();
  const socketCommandBus = {
    request(_command, payload) {
      return authority.executeAuthoritativeMutation(payload, { actor });
    }
  };
  const firstClient = createRuntime({ canUpdateActor: () => false, socketCommandBus });
  const secondClient = createRuntime({ canUpdateActor: () => false, socketCommandBus });
  let externalEffects = 0;

  const outcomes = await Promise.all([
    firstClient.claimOperation({ actor, declaration, operationId: "release-1", authoritative: true }),
    secondClient.claimOperation({ actor, declaration, operationId: "release-1", authoritative: true })
  ]);
  for (const outcome of outcomes) {
    if (outcome.status === "claimed") externalEffects += 1;
  }

  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["claimed", "completed"]);
  assert.equal(externalEffects, 1);
  assert.equal(actor.updateCalls.length, 1);
});

test("operation journal bounds completed entries and scopes recipe version operation and actor independently", async () => {
  // Catches an unbounded tombstone list or a journal key that suppresses an unrelated spell operation.
  const actor = createActor();
  const otherActor = createActor({ uuid: "Actor.other" });
  const runtime = createRuntime({ operationJournalLimit: 2 });
  const declaration = { recipe: "delayed-spell", version: 1 };

  for (const operationId of ["one", "two", "three"]) {
    assert.equal((await runtime.claimOperation({ actor, declaration, operationId })).status, "claimed");
  }
  assert.equal((await runtime.claimOperation({ actor, declaration, operationId: "one" })).status, "claimed");
  assert.equal((await runtime.claimOperation({ actor, declaration, operationId: "three" })).status, "completed");
  assert.equal((await runtime.claimOperation({
    actor, declaration: { recipe: "other-delayed-spell", version: 1 }, operationId: "three"
  })).status, "claimed");
  assert.equal((await runtime.claimOperation({
    actor, declaration: { recipe: "delayed-spell", version: 2 }, operationId: "three"
  })).status, "claimed");
  assert.equal((await runtime.claimOperation({ actor: otherActor, declaration, operationId: "three" })).status, "claimed");
});

test("operation journal rejects invalid limits and fails closed when its Actor write rejects", async () => {
  // Catches a failed durable write being remembered as claimed, or a zero retention limit silently disabling replay protection.
  assert.throws(() => createRuntime({ operationJournalLimit: 0 }), /positive integer/u);
  const actor = createActor();
  const originalUpdate = actor.update;
  actor.update = async () => { throw new Error("actor flag write failed"); };
  const runtime = createRuntime();

  await assert.rejects(runtime.claimOperation({
    actor, declaration: { recipe: "delayed-spell", version: 1 }, operationId: "release-1"
  }), /actor flag write failed/u);
  actor.update = originalUpdate;

  assert.equal((await runtime.claimOperation({
    actor, declaration: { recipe: "delayed-spell", version: 1 }, operationId: "release-1"
  })).status, "claimed");
});
