import test from "node:test";
import assert from "node:assert/strict";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { SpellInstanceRuntime } from "../scripts/combat/spell-instance-runtime.js";
import {
  SpellInstanceOperationLease,
  SPELL_INSTANCE_OPERATION_LEASE_STATE_KEY
} from "../scripts/combat/spell-instance-operation-lease.js";

function clone(value) {
  return structuredClone(value);
}

function createSharedCasRuntime({ state = { charges: 2 }, actorUuid = "Actor.caster", instanceId = "spell-a", instances } = {}) {
  const seeds = instances ?? [{ actorUuid, instanceId, state }];
  const rows = new Map(seeds.map((seed, index) => [`${seed.actorUuid}:${seed.instanceId}`, {
    effect: { id: `effect-${index + 1}` },
    instanceId: seed.instanceId,
    revision: 0,
    sourceActorUuid: seed.actorUuid,
    state: clone(seed.state ?? state)
  }]));
  const updates = [];
  const deletes = [];
  const mutationOperationIds = [];
  return {
    deletes,
    mutationOperationIds,
    updates,
    readInstance({ actor, instanceId: requestedId }) {
      const record = rows.get(`${actor.uuid}:${requestedId}`);
      return record ? clone(record) : null;
    },
    async updateInstance({ actor, instanceId: requestedId, expectedRevision, operationId, state: nextState }) {
      await Promise.resolve();
      const key = `${actor.uuid}:${requestedId}`;
      const record = rows.get(key);
      if (!record) throw new Error(`Spell instance not found: ${requestedId}`);
      if (record.revision !== expectedRevision) {
        throw new Error(`Spell instance has stale revision: expected ${expectedRevision}, found ${record.revision}`);
      }
      const next = { ...record, revision: record.revision + 1, state: clone(nextState) };
      rows.set(key, next);
      updates.push(clone(next));
      mutationOperationIds.push(operationId);
      return clone(next);
    },
    async deleteInstance({ actor, instanceId: requestedId, expectedRevision, operationId }) {
      const key = `${actor.uuid}:${requestedId}`;
      const record = rows.get(key);
      if (!record) throw new Error(`Spell instance not found: ${requestedId}`);
      if (record.revision !== expectedRevision) throw new Error("Spell instance has stale revision");
      rows.delete(key);
      deletes.push(clone(record));
      mutationOperationIds.push(operationId);
      return clone(record);
    }
  };
}

function createLease(runtime, { tokens = [], completedLimit } = {}) {
  let index = 0;
  return new SpellInstanceOperationLease({
    runtime,
    completedLimit,
    tokenFactory: () => tokens[index++] ?? `token-${index}`
  });
}

const actorA = { uuid: "Actor.a" };
const actorB = { uuid: "Actor.b" };

function setPath(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
  cursor[keys.at(-1)] = clone(value);
}

function createRuntimeActor() {
  const actor = {
    effects: [],
    nextId: 1,
    uuid: actorA.uuid,
    async createEmbeddedDocuments(_type, documents) {
      const created = documents.map((data) => {
        const id = `effect-${this.nextId++}`;
        return {
          actor: this,
          flags: clone(data.flags),
          id,
          uuid: `${this.uuid}.ActiveEffect.${id}`,
          getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
          async update(update) {
            for (const [path, value] of Object.entries(update)) setPath(this, path, value);
            return this;
          }
        };
      });
      this.effects.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      this.effects = this.effects.filter((effect) => !ids.includes(effect.id));
      return ids;
    }
  };
  const concentration = {
    actor,
    flags: {},
    id: "concentration",
    uuid: `${actor.uuid}.ActiveEffect.concentration`,
    getFlag() { return undefined; },
    async update() { return this; }
  };
  actor.effects.push(concentration);
  return { actor, concentration };
}

test("cross-client reserve grants one owner before either caller performs an external effect", async () => {
  // Catches two clients treating one persisted revision as two successful reservations before damage.
  const runtime = createSharedCasRuntime({ actorUuid: actorA.uuid });
  const firstClient = createLease(runtime, { tokens: ["owner-a"] });
  const secondClient = createLease(runtime, { tokens: ["owner-b"] });
  let externalEffects = 0;

  const outcomes = await Promise.all([
    firstClient.reserve({ actor: actorA, instanceId: "spell-a", operationId: "release-1" }),
    secondClient.reserve({ actor: actorA, instanceId: "spell-a", operationId: "release-1" })
  ]);
  for (const outcome of outcomes) {
    if (outcome.status === "acquired") externalEffects += 1;
  }

  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["acquired", "busy"]);
  assert.equal(externalEffects, 1);
  assert.equal(runtime.updates.length, 1);
});

test("the same parent operation scopes independently to actor and instance", async () => {
  // Catches completed or in-flight bookkeeping keyed only by the parent operation id.
  const runtime = createSharedCasRuntime({ actorUuid: actorA.uuid });
  const secondRuntime = createSharedCasRuntime({ actorUuid: actorB.uuid, instanceId: "spell-b" });
  const lease = createLease(runtime, { tokens: ["actor-a"] });
  const secondLease = createLease(secondRuntime, { tokens: ["actor-b"] });

  const [first, second] = await Promise.all([
    lease.reserve({ actor: actorA, instanceId: "spell-a", operationId: "shared-parent" }),
    secondLease.reserve({ actor: actorB, instanceId: "spell-b", operationId: "shared-parent" })
  ]);

  assert.equal(first.status, "acquired");
  assert.equal(second.status, "acquired");
  assert.notEqual(first.token, second.token);
});

test("the same actor reserves different instances independently for one parent operation", async () => {
  // Catches local in-flight bookkeeping using only actor and parent operation, suppressing a second spell instance.
  const runtime = createSharedCasRuntime({
    instances: [
      { actorUuid: actorA.uuid, instanceId: "spell-a", state: { charges: 2 } },
      { actorUuid: actorA.uuid, instanceId: "spell-b", state: { charges: 2 } }
    ]
  });
  const lease = createLease(runtime, { tokens: ["spell-a-owner", "spell-b-owner"] });

  const [first, second] = await Promise.all([
    lease.reserve({ actor: actorA, instanceId: "spell-a", operationId: "shared-parent" }),
    lease.reserve({ actor: actorA, instanceId: "spell-b", operationId: "shared-parent" })
  ]);

  assert.equal(first.status, "acquired");
  assert.equal(second.status, "acquired");
  assert.equal(runtime.updates.length, 2);
});

test("same-service duplicate reservations collapse to one persisted attempt", async () => {
  // Catches duplicate hooks issuing two owner tokens and competing CAS writes in one client.
  const runtime = createSharedCasRuntime({ actorUuid: actorA.uuid });
  const lease = createLease(runtime, { tokens: ["owner-a", "owner-b"] });

  const [first, repeated] = await Promise.all([
    lease.reserve({ actor: actorA, instanceId: "spell-a", operationId: "release-1" }),
    lease.reserve({ actor: actorA, instanceId: "spell-a", operationId: "release-1" })
  ]);

  assert.equal(first.status, "acquired");
  assert.equal(repeated.status, "acquired");
  assert.equal(first.token, "owner-a");
  assert.equal(repeated.token, "owner-a");
  assert.equal(runtime.updates.length, 1);
});

test("an active lease blocks a different parent operation on the same instance", async () => {
  // Catches a reservation that protects only duplicate parent IDs while permitting a competing volley.
  const runtime = createSharedCasRuntime({ actorUuid: actorA.uuid });
  const lease = createLease(runtime, { tokens: ["first", "second"] });
  const first = await lease.reserve({ actor: actorA, instanceId: "spell-a", operationId: "first-parent" });
  const competing = await lease.reserve({ actor: actorA, instanceId: "spell-a", operationId: "second-parent" });

  assert.equal(first.status, "acquired");
  assert.equal(competing.status, "busy");
  assert.equal(runtime.updates.length, 1);
});

test("completion survives a new service and retains bounded parent operation history", async () => {
  // Catches replay after reload or an ever-growing persisted completion list.
  const runtime = createSharedCasRuntime({ actorUuid: actorA.uuid });
  const first = createLease(runtime, { tokens: ["one", "two", "three"], completedLimit: 2 });
  for (const operationId of ["one", "two", "three"]) {
    const reserved = await first.reserve({ actor: actorA, instanceId: "spell-a", operationId });
    await first.complete({ actor: actorA, instanceId: "spell-a", operationId, token: reserved.token });
  }
  const reloaded = createLease(runtime, { tokens: ["replay"] });
  const replay = await reloaded.reserve({ actor: actorA, instanceId: "spell-a", operationId: "three" });
  const persisted = runtime.readInstance({ actor: actorA, instanceId: "spell-a" });

  assert.equal(replay.status, "completed");
  assert.deepEqual(
    persisted.state[SPELL_INSTANCE_OPERATION_LEASE_STATE_KEY].completed.map((entry) => entry.operationId),
    ["two", "three"]
  );
  assert.equal(persisted.state[SPELL_INSTANCE_OPERATION_LEASE_STATE_KEY].lease, null);
});

test("wrong owner cannot persist, release, complete, or delete an active lease", async () => {
  // Catches a caller without the generated reservation token mutating a protected instance.
  const runtime = createSharedCasRuntime({ actorUuid: actorA.uuid });
  const lease = createLease(runtime, { tokens: ["owner"] });
  const reserved = await lease.reserve({ actor: actorA, instanceId: "spell-a", operationId: "release-1" });
  const input = { actor: actorA, instanceId: "spell-a", operationId: "release-1", token: "intruder" };

  await assert.rejects(lease.persist({ ...input, state: { charges: 1 } }), /does not own/u);
  await assert.rejects(lease.release(input), /does not own/u);
  await assert.rejects(lease.complete(input), /does not own/u);
  await assert.rejects(lease.delete(input), /does not own/u);
  assert.equal(reserved.status, "acquired");
  assert.equal(runtime.deletes.length, 0);
});

test("cancellation releases, successful persistence keeps ownership, and final deletion verifies it", async () => {
  // Catches cancelled work permanently blocking a spell, or terminal deletion bypassing lease ownership.
  const runtime = createSharedCasRuntime({ actorUuid: actorA.uuid });
  const lease = createLease(runtime, { tokens: ["cancel", "finish"] });
  const cancelled = await lease.reserve({ actor: actorA, instanceId: "spell-a", operationId: "cancelled" });
  await lease.release({ actor: actorA, instanceId: "spell-a", operationId: "cancelled", token: cancelled.token });
  const finishing = await lease.reserve({ actor: actorA, instanceId: "spell-a", operationId: "finished" });
  const persisted = await lease.persist({
    actor: actorA, instanceId: "spell-a", operationId: "finished", token: finishing.token, state: { charges: 1, arbitrary: { kept: true } }
  });
  await lease.delete({ actor: actorA, instanceId: "spell-a", operationId: "finished", token: finishing.token });

  assert.equal(persisted.record.state.charges, 1);
  assert.deepEqual(persisted.record.state.arbitrary, { kept: true });
  assert.equal(
    persisted.record.state[SPELL_INSTANCE_OPERATION_LEASE_STATE_KEY].lease.ownerToken,
    finishing.token
  );
  assert.equal(runtime.deletes.length, 1);
  assert.equal(runtime.readInstance({ actor: actorA, instanceId: "spell-a" }), null);
  assert.equal(new Set(runtime.mutationOperationIds).size, runtime.mutationOperationIds.length);
});

test("release completes its parent operation for a fresh service while another parent can reserve", async () => {
  // Catches cancellation release clearing only the lease, which lets a reload replay an already terminal parent effect.
  const runtime = createSharedCasRuntime({ actorUuid: actorA.uuid });
  const original = createLease(runtime, { tokens: ["cancel-owner"] });
  const reserved = await original.reserve({ actor: actorA, instanceId: "spell-a", operationId: "cancelled" });
  await original.release({
    actor: actorA, instanceId: "spell-a", operationId: "cancelled", token: reserved.token
  });
  const reloaded = createLease(runtime, { tokens: ["replay-owner", "next-owner"] });
  let replayEffects = 0;
  const replay = await reloaded.reserve({ actor: actorA, instanceId: "spell-a", operationId: "cancelled" });
  if (replay.status === "acquired") replayEffects += 1;
  const next = await reloaded.reserve({ actor: actorA, instanceId: "spell-a", operationId: "next-parent" });

  assert.equal(replay.status, "completed");
  assert.equal(replayEffects, 0);
  assert.equal(next.status, "acquired");
});

test("a failed post-effect persist leaves the acquired lease fail-closed", async () => {
  // Catches a commit failure being reported as success or silently releasing the damage reservation.
  const runtime = createSharedCasRuntime({ actorUuid: actorA.uuid });
  const originalUpdate = runtime.updateInstance;
  const lease = createLease(runtime, { tokens: ["owner"] });
  const reserved = await lease.reserve({ actor: actorA, instanceId: "spell-a", operationId: "release-1" });
  runtime.updateInstance = async (input) => {
    if (input.expectedRevision === 1) throw new Error("authoritative write failed");
    return originalUpdate.call(runtime, input);
  };

  await assert.rejects(lease.persist({
    actor: actorA, instanceId: "spell-a", operationId: "release-1", token: reserved.token, state: { charges: 1 }
  }), /authoritative write failed/u);

  const persisted = runtime.readInstance({ actor: actorA, instanceId: "spell-a" });
  assert.equal(persisted.state[SPELL_INSTANCE_OPERATION_LEASE_STATE_KEY].lease.ownerToken, "owner");
});

test("lease persistence rejects non-serializable domain state without replacing the active lease", async () => {
  // Catches JSON cloning silently dropping a recipe field before its persisted state is validated.
  const runtime = createSharedCasRuntime({ actorUuid: actorA.uuid });
  const lease = createLease(runtime, { tokens: ["owner"] });
  const reserved = await lease.reserve({ actor: actorA, instanceId: "spell-a", operationId: "release-1" });

  await assert.rejects(lease.persist({
    actor: actorA, instanceId: "spell-a", operationId: "release-1", token: reserved.token,
    state: { charges: undefined }
  }), /serializable/u);

  const persisted = runtime.readInstance({ actor: actorA, instanceId: "spell-a" });
  assert.equal(persisted.state[SPELL_INSTANCE_OPERATION_LEASE_STATE_KEY].lease.ownerToken, "owner");
});

test("leases use the runtime's active-GM path before recording an acquired owner", async () => {
  // Catches a lease falling back to an owner-local mutation, which cannot provide one authoritative cross-client CAS.
  const { actor, concentration } = createRuntimeActor();
  let runtime;
  let requests = 0;
  const socketCommandBus = {
    async request(_command, payload) {
      requests += 1;
      return runtime.executeAuthoritativeMutation(payload, { actor });
    }
  };
  runtime = new SpellInstanceRuntime({
    canUpdateActor: () => true,
    coordinator: new WorldMutationCoordinator(),
    linkDependency: async () => {},
    socketCommandBus
  });
  await runtime.createInstance({
    actor,
    activity: { uuid: `${actor.uuid}.Item.spell.Activity.cast` },
    concentrationEffect: concentration,
    declaration: { recipe: "repeated-spell", version: 1 },
    instanceId: "spell-a",
    item: { uuid: `${actor.uuid}.Item.spell` },
    operationId: "cast"
  }, { charges: 2 });
  const lease = createLease(runtime, { tokens: ["owner"] });

  const reserved = await lease.reserve({ actor, instanceId: "spell-a", operationId: "release-1" });

  assert.equal(reserved.status, "acquired");
  assert.equal(requests, 1);
  assert.equal(runtime.readInstance({ actor, instanceId: "spell-a" }).revision, 1);
});
