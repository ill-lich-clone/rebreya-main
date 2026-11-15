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

test("group clock projections never traverse archives or unrelated group values", () => {
  const blocked = () => { throw new Error("Archive traversal is forbidden for clock reads"); };
  const calendar = { version: 1, isoDate: "1200-01-10", timeOfDaySeconds: 49025 };
  Object.defineProperty(calendar, "transitionJournal", { enumerable: true, get: blocked });
  const group = { calendar };
  Object.defineProperty(group, "downtimeState", { enumerable: true, get: blocked });
  const groupsById = { " group-a ": group };
  Object.defineProperty(groupsById, "group-b", { enumerable: true, get: blocked });
  const repository = new GroupStateRepository({
    gameProvider: () => ({ settings: { get: () => ({ activeGroupActorId: " group-a ", groupsById }) } }),
    normalizeRegistry: blocked, normalizeGroupState: blocked, buildDefaultGroupState
  });

  assert.deepEqual(repository.readGroupIndex(), { activeGroupActorId: "group-a", groupActorIds: ["group-a", "group-b"] });
  assert.deepEqual(repository.readCalendarState("group-a"), { version: 1, isoDate: "1200-01-10", timeOfDaySeconds: 49025 });
  assert.deepEqual(repository.readCalendarState("missing"), {});
});

test("group clock projections are detached and read the latest raw registry", () => {
  let registry = { activeGroupActorId: "group-a", groupsById: {
    "group-a": { calendar: { isoDate: "1200-01-10", timeOfDaySeconds: { raw: 49025 } } },
    " group-a ": { calendar: { isoDate: "1200-01-11", timeOfDaySeconds: { raw: 50000 } } }
  } };
  const repository = new GroupStateRepository({ gameProvider: () => ({ settings: { get: () => registry } }) });
  const projected = repository.readCalendarState(" group-a ");
  assert.equal(projected.isoDate, "1200-01-11");
  projected.timeOfDaySeconds.raw = 0;
  assert.equal(registry.groupsById[" group-a "].calendar.timeOfDaySeconds.raw, 50000);
  const index = repository.readGroupIndex();
  index.groupActorIds.push("leaked");
  registry = { activeGroupActorId: "group-b", groupsById: { "group-b": { calendar: { isoDate: "1200-02-01", timeOfDaySeconds: 3600 } } } };
  assert.deepEqual(repository.readGroupIndex(), { activeGroupActorId: "group-b", groupActorIds: ["group-b"] });
  assert.deepEqual(repository.readCalendarState("group-b"), { isoDate: "1200-02-01", timeOfDaySeconds: 3600 });
});

test("group mutations reuse normalized drafts and preserve journal isolation", async () => {
  const original = { groupsById: { "group-a": { calendar: {
    isoDate: "1200-01-10", custom: { retained: true }, transitionJournal: { entries: [{ status: "pending", marker: "keep" }] }
  } } } };
  let stored = original, registryNormalizations = 0, groupNormalizations = 0, guards = 0;
  const repository = new GroupStateRepository({
    gameProvider: () => ({ settings: { get: () => stored, set: async (_scope, _key, value) => { stored = value; } } }),
    mutationGateway: createMutationGateway({ assertActiveGm: () => { guards++; } }),
    normalizeRegistry(value) { registryNormalizations++; return normalizeGroupRegistry(value); },
    normalizeGroupState(id, value) { groupNormalizations++; return normalizeGroupState(id, value); },
    buildDefaultGroupState
  });
  await repository.mutateGroupState("group-a", (draft, registry) => {
    draft.calendar.timeOfDaySeconds = 49025;
    registry.groupsById["group-a"] = { calendar: { isoDate: "discarded replacement" } };
  });
  assert.equal(registryNormalizations, 2);
  assert.equal(groupNormalizations, 0);
  assert.equal(guards, 2);
  assert.equal(stored.groupsById["group-a"].calendar.timeOfDaySeconds, 49025);
  assert.deepEqual(stored.groupsById["group-a"].calendar.transitionJournal, { entries: [{ status: "pending", marker: "keep" }] });
  assert.deepEqual(stored.groupsById["group-a"].calendar.custom, { retained: true });
  stored.groupsById["group-a"].calendar.transitionJournal.entries[0].marker = "committed";
  assert.equal(original.groupsById["group-a"].calendar.transitionJournal.entries[0].marker, "keep");
  await assert.rejects(repository.mutateGroupState("group-a", draft => {
    draft.calendar.transitionJournal.entries[0].marker = "uncommitted";
    throw new Error("rejected draft");
  }), /rejected draft/u);
  assert.equal(stored.groupsById["group-a"].calendar.transitionJournal.entries[0].marker, "committed");
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test("clock mutation uses the same fresh-read queue as registry writers and isolates failed saves", async () => {
  let stored = { version: 1, activeGroupActorId: "group-a", groupsById: {
    "group-a": { calendar: { version: 1, isoDate: "1200-01-10", timeOfDaySeconds: 20 } },
    "group-b": { calendar: { version: 1, isoDate: "1200-02-04", timeOfDaySeconds: 3 } }
  } };
  let rejectWrite = false;
  let guardChecks = 0;
  const mutationGateway = createMutationGateway({ assertActiveGm: () => { guardChecks++; } });
  const repository = new GroupStateRepository({
    gameProvider: () => ({ settings: {
      get: () => stored,
      async set(_module, _key, next) {
        if (rejectWrite) throw new Error("save rejected");
        stored = next;
      }
    } }),
    mutationGateway, normalizeRegistry: normalizeGroupRegistry, normalizeGroupState, buildDefaultGroupState
  });
  const entered = createDeferred();
  const release = createDeferred();
  const first = repository.mutateGroupState("group-b", async group => {
    entered.resolve();
    await release.promise;
    group.calendar.timeOfDaySeconds = 5;
  });
  await entered.promise;
  const next = repository.mutateCalendarState("group-a", clock => ({ ...clock, timeOfDaySeconds: 26 }));
  release.resolve();
  await first;
  assert.equal((await next).timeOfDaySeconds, 26);
  assert.deepEqual(mutationGateway.commits, ["setting:groupState", "setting:groupState"]);
  assert.equal(guardChecks, 4);
  assert.equal(stored.groupsById["group-b"].calendar.timeOfDaySeconds, 5);

  const snapshot = stored;
  rejectWrite = true;
  await assert.rejects(repository.mutateCalendarState("group-a", clock => {
    clock.timeOfDaySeconds = 32;
    return clock;
  }), /save rejected/u);
  assert.equal(stored, snapshot);
  assert.equal(stored.groupsById["group-a"].calendar.timeOfDaySeconds, 26);
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMutationGateway({ assertActiveGm = () => {} } = {}) {
  const coordinator = new WorldMutationCoordinator();
  const commits = [];
  return {
    commits,
    commit(queueKey, operation) {
      commits.push(queueKey);
      return coordinator.run(queueKey, () => operation(Object.freeze({ assertActiveGm })));
    }
  };
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("quick clock writes persist without rewriting the large setting and survive a fresh repository", async () => {
  const fixture = createRepositoryFixture({ groupsById: {
    "group-a": { calendar: { isoDate: "1200-01-10", timeOfDaySeconds: 20, transitionJournal: { entries: [1] } } },
    "group-b": { calendar: { isoDate: "1200-01-11", timeOfDaySeconds: 30 } }
  } }, { groupClockSetting: true });
  const { repository } = fixture;
  const original = fixture.storedRegistry;
  const updateClock = timeOfDaySeconds => () => ({ timeOfDaySeconds });

  await repository.mutateCalendarState("group-a", updateClock(26));
  await repository.mutateCalendarState("group-b", updateClock(36));
  await repository.mutateCalendarState("group-a", updateClock(32));
  assert.equal(fixture.storedRegistry, original);
  assert.deepEqual(fixture.settingWrites, ["groupClockState", "groupClockState", "groupClockState"]);
  assert.deepEqual(fixture.newRepository().readCalendarState("group-a"), {
    isoDate: "1200-01-10", timeOfDaySeconds: 32
  });
  assert.deepEqual(fixture.newRepository().read().groupsById["group-a"].calendar, {
    isoDate: "1200-01-10", timeOfDaySeconds: 32, transitionJournal: { entries: [1] }
  });
  assert.equal(fixture.newRepository().readCalendarState("group-b").timeOfDaySeconds, 36);
  assert.deepEqual(fixture.mutationGateway.commits, Array(3).fill("setting:groupState"));
});

test("a registry commit folds in clock writes and makes old snapshots inapplicable", async () => {
  const fixture = createRepositoryFixture({ groupsById: {
    "group-a": { calendar: { isoDate: "1200-01-10", timeOfDaySeconds: 20 } },
    "group-b": { calendar: { isoDate: "1200-01-11", timeOfDaySeconds: 30 } }
  } }, { groupClockSetting: true });
  const { repository } = fixture;
  await repository.mutateCalendarState("group-a", clock => ({ timeOfDaySeconds: clock.timeOfDaySeconds + 6 }));
  await repository.mutateCalendarState("group-b", clock => ({ timeOfDaySeconds: clock.timeOfDaySeconds + 6 }));
  const entered = createDeferred();
  const release = createDeferred();
  const changeDate = repository.mutateRegistry(async registry => {
    assert.equal(registry.groupsById["group-a"].calendar.timeOfDaySeconds, 26);
    registry.groupsById["group-a"].calendar = { isoDate: "1200-01-12", timeOfDaySeconds: 0 };
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const tick = repository.mutateCalendarState("group-a", clock => ({ timeOfDaySeconds: clock.timeOfDaySeconds + 6 }));
  release.resolve();
  await changeDate;
  await tick;
  assert.deepEqual(fixture.newRepository().readCalendarState("group-a"), {
    isoDate: "1200-01-12", timeOfDaySeconds: 6
  });
  assert.equal(fixture.storedRegistry.groupsById["group-b"].calendar.timeOfDaySeconds, 36);

  await repository.mutateRegistry(registry => { delete registry.groupsById["group-a"]; });
  assert.deepEqual(repository.readCalendarState("group-a"), {});
  await repository.mutateGroupState("group-a", group => {
    group.calendar = { isoDate: "1200-01-10", timeOfDaySeconds: 20 };
  }, { create: true });
  assert.equal(fixture.newRepository().readCalendarState("group-a").timeOfDaySeconds, 20);
});

test("failed clock and registry saves preserve the previously committed clock", async () => {
  const fixture = createRepositoryFixture({ groupsById: {
    "group-a": { calendar: { isoDate: "1200-01-10", timeOfDaySeconds: 20 } }
  } }, { groupClockSetting: true });
  const { repository } = fixture;
  await repository.mutateCalendarState("group-a", () => ({ timeOfDaySeconds: 26 }));
  fixture.rejectWrites = true;
  await assert.rejects(repository.mutateCalendarState("group-a", () => ({ timeOfDaySeconds: 32 })), /rejected save/u);
  await assert.rejects(repository.mutateGroupState("group-a", group => {
    group.calendar.isoDate = "1200-01-12";
  }), /rejected save/u);
  assert.deepEqual(fixture.newRepository().readCalendarState("group-a"), {
    isoDate: "1200-01-10", timeOfDaySeconds: 26
  });
  assert.equal(fixture.storedRegistry.groupsById["group-a"].calendar.timeOfDaySeconds, 20);
});

test("legacy registry saves cannot revive a stale clock from an earlier revision", async () => {
  const fixture = createRepositoryFixture({ groupsById: {
    "group-a": { calendar: { isoDate: "1200-01-10", timeOfDaySeconds: 20 } }
  } }, { groupClockSetting: true });
  await fixture.repository.mutateCalendarState("group-a", () => ({ timeOfDaySeconds: 26 }));
  fixture.storedRegistry = { groupsById: {
    "group-a": { calendar: { isoDate: "1200-01-12", timeOfDaySeconds: 81 } }
  } };
  assert.deepEqual(fixture.newRepository().readCalendarState("group-a"), {
    isoDate: "1200-01-12", timeOfDaySeconds: 81
  });
});

function createRepositoryFixture(initialRegistry = {}, { groupClockSetting = false } = {}) {
  let storedRegistry = initialRegistry;
  let modifiedTime = 1;
  let storedClock = {};
  let rejectWrites = false;
  const reads = [];
  const writes = [];
  const settingWrites = [];
  const game = {
    settings: {
      settings: new Map(groupClockSetting ? [[`${MODULE_ID}.groupClockState`, {}]] : []),
      get(moduleId, key, options) {
        assert.equal(moduleId, MODULE_ID);
        if (key === "groupClockState" && groupClockSetting) return clone(storedClock);
        assert.equal(key, SETTINGS_KEYS.GROUP_STATE);
        reads.push(clone(storedRegistry));
        if (options?.document) return { id: "groupState", value: storedRegistry, _stats: { modifiedTime } };
        return storedRegistry;
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        if (rejectWrites) throw new Error("rejected save");
        settingWrites.push(key);
        if (key === "groupClockState" && groupClockSetting) {
          storedClock = clone(value);
          return value;
        }
        assert.equal(key, SETTINGS_KEYS.GROUP_STATE);
        storedRegistry = value;
        modifiedTime++;
        writes.push(clone(value));
        return value;
      }
    }
  };
  const mutationGateway = createMutationGateway();
  const newRepository = () => new GroupStateRepository({
    mutationGateway,
    gameProvider: () => game,
    normalizeRegistry: normalizeGroupRegistry,
    normalizeGroupState,
    buildDefaultGroupState
  });

  return {
    game,
    mutationGateway,
    reads,
    repository: newRepository(),
    newRepository,
    settingWrites,
    set rejectWrites(value) {
      rejectWrites = value;
    },
    get storedRegistry() {
      return storedRegistry;
    },
    set storedRegistry(value) {
      storedRegistry = value;
      modifiedTime++;
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

test("GroupStateRepository commits registry writes through the active-GM group setting queue", async () => {
  const expectedFailure = new Error("active GM changed");
  const commits = [];
  let writes = 0;
  const repository = new GroupStateRepository({
    mutationGateway: {
      commit(queueKey, operation) {
        commits.push(queueKey);
        return operation(Object.freeze({
          assertActiveGm() {
            throw expectedFailure;
          }
        }));
      }
    },
    gameProvider: () => ({
      settings: {
        get: () => ({ version: 1, groupsById: {} }),
        set: async () => {
          writes += 1;
        }
      }
    }),
    normalizeRegistry: normalizeGroupRegistry,
    normalizeGroupState,
    buildDefaultGroupState
  });

  await assert.rejects(repository.mutateRegistry(() => "never"), (error) => error === expectedFailure);
  assert.deepEqual(commits, ["setting:groupState"]);
  assert.equal(writes, 0);
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

test("GroupStateRepository runs afterCommit only after persistence and before releasing the mutation queue", async () => {
  const fixture = createRepositoryFixture({
    groupsById: {
      "group-a": buildDefaultGroupState("group-a", { now: 10 })
    }
  });
  const afterCommitGate = createDeferred();
  const events = [];

  const first = fixture.repository.mutateGroupState(
    "group-a",
    (groupState) => {
      events.push("mutate");
      groupState.calendar.day = 7;
      return "mutation-result";
    },
    {
      async afterCommit(result) {
        events.push(`after:${result}:${fixture.storedRegistry.groupsById["group-a"].calendar.day}`);
        await afterCommitGate.promise;
        return "after-result";
      }
    }
  );
  const second = fixture.repository.mutateGroupState("group-a", () => {
    events.push("second");
    return "second-result";
  });

  await flushTasks();
  assert.deepEqual(events, ["mutate", "after:mutation-result:7"]);
  assert.equal(fixture.writes.length, 1);

  afterCommitGate.resolve();
  assert.deepEqual(await Promise.all([first, second]), ["after-result", "second-result"]);
  assert.deepEqual(events, ["mutate", "after:mutation-result:7", "second"]);
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

test("GroupStateRepository does not expose stale whole-registry replacement", () => {
  const fixture = createRepositoryFixture({ groupsById: {} });

  assert.equal(typeof fixture.repository.replaceRegistry, "undefined");
});
