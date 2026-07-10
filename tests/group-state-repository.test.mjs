import test from "node:test";
import assert from "node:assert/strict";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import {
  GroupStateRepository
} from "../scripts/infrastructure/foundry/group-state-repository.js";
import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import {
  buildDefaultGroupState,
  normalizeGroupRegistry,
  normalizeGroupState
} from "../scripts/data/group-context-service.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createRepositoryFixture(initialRegistry = {}) {
  let storedRegistry = initialRegistry;
  const reads = [];
  const writes = [];
  const game = {
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        assert.equal(key, SETTINGS_KEYS.GROUP_STATE);
        reads.push(clone(storedRegistry));
        return storedRegistry;
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        assert.equal(key, SETTINGS_KEYS.GROUP_STATE);
        storedRegistry = value;
        writes.push(clone(value));
        return value;
      }
    }
  };
  const repository = new GroupStateRepository({
    coordinator: new WorldMutationCoordinator(),
    gameProvider: () => game,
    normalizeRegistry: normalizeGroupRegistry,
    normalizeGroupState,
    buildDefaultGroupState
  });

  return {
    game,
    reads,
    repository,
    get storedRegistry() {
      return storedRegistry;
    },
    set storedRegistry(value) {
      storedRegistry = value;
    },
    writes
  };
}

test("GroupStateRepository read returns the normalized current world registry", () => {
  const fixture = createRepositoryFixture({
    activeGroupActorId: " group-a ",
    groupsById: {
      "group-a": {
        groupActorId: "wrong-id",
        initializedAt: "123"
      }
    }
  });

  const registry = fixture.repository.read();

  assert.equal(registry.version, 1);
  assert.equal(registry.activeGroupActorId, "group-a");
  assert.equal(registry.groupsById["group-a"].groupActorId, "group-a");
  assert.equal(registry.groupsById["group-a"].initializedAt, 123);
  assert.equal(fixture.reads.length, 1);
  assert.equal(fixture.writes.length, 0);
});

test("GroupStateRepository mutateRegistry performs each fresh read inside one complete queued transaction", async () => {
  const fixture = createRepositoryFixture({ groupsById: {} });
  const firstGate = createDeferred();
  const observedGroupIds = [];

  const first = fixture.repository.mutateRegistry(async (registry) => {
    observedGroupIds.push(Object.keys(registry.groupsById));
    registry.groupsById["group-a"] = {
      groupActorId: "corrupt-a",
      initializedAt: "101"
    };
    await firstGate.promise;
    return "first-result";
  });
  const second = fixture.repository.mutateRegistry((registry) => {
    observedGroupIds.push(Object.keys(registry.groupsById));
    registry.groupsById["group-b"] = {
      groupActorId: "corrupt-b",
      initializedAt: "202"
    };
    return "second-result";
  });

  await flushTasks();
  assert.equal(fixture.reads.length, 1);
  assert.deepEqual(observedGroupIds, [[]]);
  assert.equal(fixture.writes.length, 0);

  firstGate.resolve();
  assert.deepEqual(await Promise.all([first, second]), ["first-result", "second-result"]);
  assert.deepEqual(observedGroupIds, [[], ["group-a"]]);
  assert.equal(fixture.reads.length, 2);
  assert.equal(fixture.writes.length, 2);
  assert.deepEqual(Object.keys(fixture.storedRegistry.groupsById).sort(), ["group-a", "group-b"]);
  assert.equal(fixture.storedRegistry.version, 1);
  assert.equal(fixture.storedRegistry.groupsById["group-a"].groupActorId, "group-a");
  assert.equal(fixture.storedRegistry.groupsById["group-a"].initializedAt, 101);
  assert.equal(fixture.storedRegistry.groupsById["group-b"].groupActorId, "group-b");
  assert.equal(fixture.storedRegistry.groupsById["group-b"].initializedAt, 202);
});

test("GroupStateRepository mutateGroupState serializes mutations for different groups on the global setting key", async () => {
  const fixture = createRepositoryFixture({
    groupsById: {
      "group-a": buildDefaultGroupState("group-a", { now: 10 }),
      "group-b": buildDefaultGroupState("group-b", { now: 20 })
    }
  });
  const firstGate = createDeferred();
  const events = [];

  const first = fixture.repository.mutateGroupState("group-a", async (groupState) => {
    events.push("group-a:start");
    groupState.calendar.day = 3;
    await firstGate.promise;
    events.push("group-a:end");
    return "group-a-result";
  });
  const second = fixture.repository.mutateGroupState("group-b", (groupState) => {
    events.push("group-b:start");
    groupState.travelState.routeId = "route-b";
    return "group-b-result";
  });

  await flushTasks();
  assert.deepEqual(events, ["group-a:start"]);
  assert.equal(fixture.reads.length, 1);

  firstGate.resolve();
  assert.deepEqual(await Promise.all([first, second]), ["group-a-result", "group-b-result"]);
  assert.deepEqual(events, ["group-a:start", "group-a:end", "group-b:start"]);
  assert.equal(fixture.storedRegistry.groupsById["group-a"].calendar.day, 3);
  assert.equal(fixture.storedRegistry.groupsById["group-b"].travelState.routeId, "route-b");
});

test("GroupStateRepository mutateGroupState creates a normalized state only when create is enabled", async () => {
  const fixture = createRepositoryFixture({ groupsById: {} });

  await assert.rejects(
    fixture.repository.mutateGroupState("group-a", () => "unexpected"),
    /group-a/u
  );
  assert.equal(fixture.writes.length, 0);

  const result = await fixture.repository.mutateGroupState(
    "group-a",
    (groupState) => {
      groupState.initializedAt = "404";
      groupState.calendar = { day: 8 };
      return { created: groupState.groupActorId };
    },
    { create: true }
  );

  assert.deepEqual(result, { created: "group-a" });
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.storedRegistry.groupsById["group-a"].version, 1);
  assert.equal(fixture.storedRegistry.groupsById["group-a"].groupActorId, "group-a");
  assert.equal(fixture.storedRegistry.groupsById["group-a"].initializedAt, 404);
  assert.deepEqual(fixture.storedRegistry.groupsById["group-a"].calendar, { day: 8 });
});

test("GroupStateRepository recovers its global queue after a mutation rejects", async () => {
  const fixture = createRepositoryFixture({ groupsById: {} });
  const failureGate = createDeferred();
  const events = [];

  const failed = fixture.repository.mutateRegistry(async (registry) => {
    events.push("failed:start");
    registry.activeGroupActorId = "discarded";
    await failureGate.promise;
    throw new Error("mutation failed");
  });
  const recovered = fixture.repository.mutateRegistry((registry) => {
    events.push("recovered:start");
    registry.activeGroupActorId = "group-b";
    return "recovered";
  });

  await flushTasks();
  assert.deepEqual(events, ["failed:start"]);
  failureGate.resolve();

  await assert.rejects(failed, /mutation failed/u);
  assert.equal(await recovered, "recovered");
  assert.deepEqual(events, ["failed:start", "recovered:start"]);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.storedRegistry.activeGroupActorId, "group-b");
});

test("GroupStateRepository replaceRegistry serializes only its deprecated normalized writes", async () => {
  const fixture = createRepositoryFixture({ groupsById: {} });
  const firstWriteGate = createDeferred();
  const writesStarted = [];
  fixture.game.settings.get = () => {
    throw new Error("replaceRegistry must not read");
  };
  fixture.game.settings.set = async (_moduleId, _key, value) => {
    writesStarted.push(value.activeGroupActorId);
    if (writesStarted.length === 1) {
      await firstWriteGate.promise;
    }
    fixture.storedRegistry = value;
    fixture.writes.push(clone(value));
    return value;
  };

  const first = fixture.repository.replaceRegistry({
    activeGroupActorId: " group-a ",
    groupsById: {}
  });
  const second = fixture.repository.replaceRegistry({
    activeGroupActorId: " group-b ",
    groupsById: {}
  });

  await flushTasks();
  assert.deepEqual(writesStarted, ["group-a"]);
  firstWriteGate.resolve();

  assert.equal((await first).activeGroupActorId, "group-a");
  assert.equal((await second).activeGroupActorId, "group-b");
  assert.deepEqual(writesStarted, ["group-a", "group-b"]);
  assert.equal(fixture.storedRegistry.version, 1);
  assert.equal(fixture.storedRegistry.activeGroupActorId, "group-b");
});
