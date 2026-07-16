import test from "node:test";
import assert from "node:assert/strict";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../scripts/constants.js";
import { CalendarService } from "../scripts/data/calendar-service.js";
import { CalendarTransitionCoordinator } from "../scripts/data/calendar-transition-coordinator.js";
import { GroupContextService } from "../scripts/data/group-context-service.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createGroupActor(id = "group-a") {
  return {
    id,
    type: "group",
    system: { members: [] },
    getFlag(moduleId, key) {
      return moduleId === MODULE_ID && key === REBREYA_GROUP_FLAGS.MANAGED ? true : undefined;
    }
  };
}

function createHarness({
  isoDate = "2026-07-20",
  calendarByIsoDate = {},
  processScheduledDate = async (date, { transitionId }) => ({
    isoDate: date,
    transitionId,
    journalStatus: "completed",
    processed: [],
    blocked: [],
    reconciliation: [],
    skipped: []
  }),
  callbacks = {}
} = {}) {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  const groupActor = createGroupActor();
  const state = {
    [SETTINGS_KEYS.CALENDAR_STATE]: { version: 1, isoDate: "1300-01-01" },
    [SETTINGS_KEYS.GROUP_STATE]: {
      version: 1,
      activeGroupActorId: groupActor.id,
      groupsById: {
        [groupActor.id]: {
          version: 1,
          groupActorId: groupActor.id,
          calendar: { version: 1, isoDate }
        }
      }
    }
  };

  globalThis.foundry = {
    utils: {
      deepClone: clone,
      mergeObject: (base, update) => ({ ...clone(base), ...clone(update) })
    }
  };
  globalThis.game = {
    user: { id: "gm", isGM: true, active: true },
    actors: {
      contents: [groupActor],
      get(id) {
        return id === groupActor.id ? groupActor : null;
      }
    },
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        return clone(state[key]);
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        state[key] = clone(value);
      }
    }
  };

  const groupContextService = new GroupContextService();
  const calendarService = new CalendarService({ groupContextService });
  const downtimeService = {
    getSnapshot() {
      return {
        groupId: groupActor.id,
        calendarByIsoDate: clone(calendarByIsoDate)
      };
    },
    processScheduledDate
  };

  const createCoordinator = (overrides = {}) => new CalendarTransitionCoordinator({
    calendarService,
    downtimeService,
    groupContextService,
    refreshGlobalEvents: callbacks.refreshGlobalEvents,
    resetTraderMonth: callbacks.resetTraderMonth,
    processDayCycles: callbacks.processDayCycles,
    refreshApps: callbacks.refreshApps,
    refreshSmallTime: callbacks.refreshSmallTime,
    ...overrides
  });

  return {
    calendarService,
    createCoordinator,
    groupContextService,
    state,
    restore() {
      globalThis.game = previousGame;
      globalThis.foundry = previousFoundry;
    }
  };
}

test("preview enumerates crossed dates chronologically and summarizes affected downtime without mutation", () => {
  const harness = createHarness({
    isoDate: "2026-07-20",
    calendarByIsoDate: {
      "2026-07-21": {
        isoDate: "2026-07-21",
        total: 2,
        counts: { free: 0, pending: 1, approved: 1, processed: 0, blocked: 0 },
        slots: [
          { id: "slot-1", requestId: "request-a" },
          { id: "slot-2", requestId: "request-a" }
        ]
      },
      "2026-07-23": {
        isoDate: "2026-07-23",
        total: 1,
        counts: { free: 0, pending: 0, approved: 0, processed: 0, blocked: 1 },
        slots: [{ id: "slot-3", requestId: "request-b" }]
      }
    }
  });

  try {
    const before = clone(harness.state);
    const preview = harness.createCoordinator().preview({
      toIsoDate: "2026-07-23",
      processDowntime: true,
      processSupplies: false,
      reason: "calendar-ui"
    });

    assert.equal(preview.direction, "forward");
    assert.equal(preview.from.isoDate, "2026-07-20");
    assert.equal(preview.to.isoDate, "2026-07-23");
    assert.deepEqual(preview.crossedDates, ["2026-07-21", "2026-07-22", "2026-07-23"]);
    assert.deepEqual(preview.affectedDowntime.map((entry) => entry.isoDate), ["2026-07-21", "2026-07-23"]);
    assert.deepEqual(preview.counts, {
      crossedDates: 3,
      days: 3,
      monthBoundaries: 0,
      affectedDowntimeDates: 2,
      affectedDowntimeRequests: 2,
      affectedDowntimeSlots: 3,
      downtimeByStatus: { free: 0, pending: 1, approved: 1, processed: 0, blocked: 1 }
    });
    assert.deepEqual(harness.state, before);
  }
  finally {
    harness.restore();
  }
});

test("moveTo persists the forward date before processing every crossed downtime date", async () => {
  const calls = [];
  const harness = createHarness({
    processScheduledDate: async (isoDate, { transitionId }) => {
      calls.push({
        isoDate,
        transitionId,
        persistedIsoDate: harness.calendarService.getSnapshot().isoDate
      });
      return {
        isoDate,
        transitionId,
        journalStatus: "completed",
        processed: [{ id: `slot-${isoDate}` }],
        blocked: [],
        reconciliation: [],
        skipped: []
      };
    }
  });

  try {
    const result = await harness.createCoordinator().moveTo({
      toIsoDate: "2026-07-22",
      processDowntime: true,
      reason: "calendar-ui"
    });

    assert.equal(result.calendar.isoDate, "2026-07-22");
    assert.deepEqual(calls.map((entry) => entry.isoDate), ["2026-07-21", "2026-07-22"]);
    assert.equal(calls.every((entry) => entry.persistedIsoDate === "2026-07-22"), true);
    assert.equal(new Set(calls.map((entry) => entry.transitionId)).size, 1);
    assert.deepEqual(result.downtime.map((entry) => entry.status), ["completed", "completed"]);

    const calendarState = harness.state[SETTINGS_KEYS.GROUP_STATE].groupsById["group-a"].calendar;
    assert.equal(calendarState.transitionJournal.counter, 1);
    assert.equal(calendarState.transitionJournal.entries[0].transitionId, result.transitionId);
    assert.match(result.transitionId, /^calendar:group-a:1:2026-07-20:2026-07-22$/u);
  }
  finally {
    harness.restore();
  }
});

test("moveTo forwards calendar time options to CalendarService", async () => {
  const harness = createHarness();

  try {
    const result = await harness.createCoordinator().moveTo({
      toIsoDate: "2026-07-21",
      processDowntime: false,
      refreshApps: false,
      refreshSmallTime: false,
      hour: 13,
      minute: 37,
      second: 5,
      reason: "set-date"
    });

    assert.equal(result.calendar.isoDate, "2026-07-21");
    assert.equal(result.calendar.timeLabel, "13:37:05");
  }
  finally {
    harness.restore();
  }
});

test("a completed move to the same date does not swallow a new time of day", async () => {
  const harness = createHarness();

  try {
    const coordinator = harness.createCoordinator();
    const first = await coordinator.moveTo({
      toIsoDate: "2026-07-20",
      processDowntime: false,
      refreshApps: false,
      refreshSmallTime: false,
      hour: 9,
      minute: 15,
      reason: "set-date"
    });
    const second = await coordinator.moveTo({
      toIsoDate: "2026-07-20",
      processDowntime: false,
      refreshApps: false,
      refreshSmallTime: false,
      hour: 18,
      minute: 45,
      reason: "set-date"
    });

    assert.notEqual(second.transitionId, first.transitionId);
    assert.equal(second.calendar.timeLabel, "18:45:00");
    assert.equal(harness.calendarService.getSnapshot().timeLabel, "18:45:00");
  }
  finally {
    harness.restore();
  }
});

test("moving backward persists time without running downtime or daily cycles", async () => {
  const calls = [];
  const harness = createHarness({
    isoDate: "2026-07-22",
    processScheduledDate: async (isoDate) => calls.push(["downtime", isoDate]),
    callbacks: {
      processDayCycles: async (days) => calls.push(["cycles", days])
    }
  });

  try {
    const result = await harness.createCoordinator().moveTo({
      toIsoDate: "2026-07-20",
      processDowntime: true,
      processSupplies: true,
      processDailyCycles: true,
      reason: "calendar-ui"
    });

    assert.equal(result.direction, "backward");
    assert.deepEqual(result.crossedDates, ["2026-07-20", "2026-07-21"]);
    assert.equal(result.calendar.isoDate, "2026-07-20");
    assert.deepEqual(calls, []);
    assert.deepEqual(result.downtime, []);
  }
  finally {
    harness.restore();
  }
});

test("retry reuses the persisted transition and only retries its reconciliation date", async () => {
  const calls = [];
  let failMiddleDate = true;
  const processScheduledDate = async (isoDate, { transitionId }) => {
    calls.push({ isoDate, transitionId });
    if (isoDate === "2026-07-22" && failMiddleDate) {
      failMiddleDate = false;
      throw new Error("domain acknowledgement lost");
    }
    return {
      isoDate,
      transitionId,
      journalStatus: "completed",
      processed: [{ id: `slot-${isoDate}` }],
      blocked: [],
      reconciliation: [],
      skipped: []
    };
  };
  const harness = createHarness({ processScheduledDate });

  try {
    const first = await harness.createCoordinator().moveTo({
      toIsoDate: "2026-07-23",
      processDowntime: true,
      reason: "smalltime-world-time"
    });
    const retry = await harness.createCoordinator().moveTo({
      toIsoDate: "2026-07-23",
      processDowntime: true,
      reason: "smalltime-world-time"
    });

    assert.equal(first.calendar.isoDate, "2026-07-23");
    assert.deepEqual(first.downtime.map((entry) => entry.status), [
      "completed",
      "reconciliation-required",
      "completed"
    ]);
    assert.equal(retry.transitionId, first.transitionId);
    assert.deepEqual(calls.map((entry) => entry.isoDate), [
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-22"
    ]);
    assert.equal(new Set(calls.map((entry) => entry.transitionId)).size, 1);
    assert.equal(
      harness.state[SETTINGS_KEYS.GROUP_STATE].groupsById["group-a"].calendar.transitionJournal.counter,
      1
    );
  }
  finally {
    harness.restore();
  }
});

test("resume restores a rewound calendar to the target before retrying domain work", async () => {
  const observed = [];
  let failTargetDate = true;
  const harness = createHarness({
    processScheduledDate: async (isoDate, { transitionId }) => {
      observed.push({
        isoDate,
        persistedIsoDate: harness.calendarService.getSnapshot().isoDate,
        transitionId
      });
      if (isoDate === "2026-07-22" && failTargetDate) {
        failTargetDate = false;
        throw new Error("domain acknowledgement lost");
      }
      return {
        isoDate,
        transitionId,
        journalStatus: "completed",
        processed: [{ id: `slot-${isoDate}` }],
        blocked: [],
        reconciliation: [],
        skipped: []
      };
    }
  });

  try {
    const coordinator = harness.createCoordinator();
    const first = await coordinator.moveTo({
      toIsoDate: "2026-07-22",
      processDowntime: true,
      reason: "smalltime-world-time"
    });
    await harness.calendarService.setDate(2026, 7, 20);

    const resumed = await coordinator.moveTo({
      toIsoDate: "2026-07-22",
      processDowntime: true,
      reason: "smalltime-world-time"
    });

    assert.equal(first.status, "reconciliation-required");
    assert.equal(resumed.transitionId, first.transitionId);
    assert.equal(resumed.calendar.isoDate, "2026-07-22");
    assert.equal(harness.calendarService.getSnapshot().isoDate, "2026-07-22");
    assert.deepEqual(observed.map((entry) => entry.isoDate), [
      "2026-07-21",
      "2026-07-22",
      "2026-07-22"
    ]);
    assert.equal(observed.at(-1).persistedIsoDate, "2026-07-22");
  }
  finally {
    harness.restore();
  }
});

test("preview reuses an ambiguous journal transition when the calendar is already at its target", async () => {
  let failTargetDate = true;
  const harness = createHarness({
    calendarByIsoDate: {
      "2026-07-22": {
        isoDate: "2026-07-22",
        total: 2,
        counts: { free: 0, pending: 1, approved: 1, processed: 0, blocked: 0 },
        slots: [
          { id: "slot-1", requestId: "request-a" },
          { id: "slot-2", requestId: "request-b" }
        ]
      }
    },
    processScheduledDate: async (isoDate, { transitionId }) => {
      if (isoDate === "2026-07-22" && failTargetDate) {
        failTargetDate = false;
        throw new Error("domain acknowledgement lost");
      }
      return {
        isoDate,
        transitionId,
        journalStatus: "completed",
        processed: [],
        blocked: [],
        reconciliation: [],
        skipped: []
      };
    }
  });

  try {
    const coordinator = harness.createCoordinator();
    const options = {
      toIsoDate: "2026-07-22",
      processDowntime: true,
      processSupplies: false,
      reason: "smalltime-world-time"
    };
    const first = await coordinator.moveTo(options);
    const preview = coordinator.preview(options);
    const resumed = await coordinator.moveTo(options);

    assert.equal(first.status, "reconciliation-required");
    assert.equal(harness.calendarService.getSnapshot().isoDate, "2026-07-22");
    assert.equal(preview.direction, "forward");
    assert.equal(preview.fromIsoDate, "2026-07-20");
    assert.equal(preview.toIsoDate, "2026-07-22");
    assert.deepEqual(preview.crossedDates, ["2026-07-21", "2026-07-22"]);
    assert.equal(preview.counts.crossedDates, 2);
    assert.equal(preview.counts.affectedDowntimeDates, 1);
    assert.equal(preview.counts.affectedDowntimeRequests, 2);
    assert.deepEqual(
      {
        direction: resumed.direction,
        fromIsoDate: resumed.fromIsoDate,
        toIsoDate: resumed.toIsoDate,
        crossedDates: resumed.crossedDates,
        counts: resumed.counts
      },
      {
        direction: preview.direction,
        fromIsoDate: preview.fromIsoDate,
        toIsoDate: preview.toIsoDate,
        crossedDates: preview.crossedDates,
        counts: preview.counts
      }
    );
  }
  finally {
    harness.restore();
  }
});

test("concurrent moves serialize from preview through domain stages and leave the latest target", async () => {
  const firstDateWriteStarted = createDeferred();
  const allowFirstDateWrite = createDeferred();
  const calls = [];
  let first;
  let second;
  const harness = createHarness({
    processScheduledDate: async (isoDate) => {
      calls.push(["downtime", isoDate]);
      return {
        isoDate,
        journalStatus: "completed",
        processed: [],
        blocked: [],
        reconciliation: [],
        skipped: []
      };
    },
    callbacks: {
      refreshGlobalEvents: async (currentIsoDate, previousIsoDate) => {
        calls.push(["events", currentIsoDate, previousIsoDate]);
        return { changed: false };
      },
      processDayCycles: async (days) => {
        calls.push(["cycles", days]);
        return { days, supplies: [], supplyTotals: {} };
      }
    }
  });

  try {
    const coordinator = harness.createCoordinator();
    const originalSetDate = harness.calendarService.setDate.bind(harness.calendarService);
    const dateWrites = [];
    harness.calendarService.setDate = async (year, month, day, options) => {
      const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      dateWrites.push(isoDate);
      if (isoDate === "2026-07-22") {
        firstDateWriteStarted.resolve();
        await allowFirstDateWrite.promise;
      }
      return originalSetDate(year, month, day, options);
    };

    first = coordinator.moveTo({
      toIsoDate: "2026-07-22",
      processDowntime: true,
      processSupplies: true,
      processDailyCycles: true,
      reason: "advance-days"
    });
    await firstDateWriteStarted.promise;
    second = coordinator.moveTo({
      toIsoDate: "2026-07-21",
      processDowntime: true,
      processSupplies: true,
      processDailyCycles: true,
      reason: "advance-days"
    });
    await flushTasks();

    assert.deepEqual(dateWrites, ["2026-07-22"]);

    allowFirstDateWrite.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(firstResult.calendar.isoDate, "2026-07-22");
    assert.equal(secondResult.calendar.isoDate, "2026-07-21");
    assert.equal(harness.calendarService.getSnapshot().isoDate, "2026-07-21");
    assert.deepEqual(calls, [
      ["downtime", "2026-07-21"],
      ["downtime", "2026-07-22"],
      ["events", "2026-07-22", "2026-07-20"],
      ["cycles", 2],
      ["events", "2026-07-21", "2026-07-22"]
    ]);
  }
  finally {
    allowFirstDateWrite.resolve();
    await Promise.allSettled([first, second].filter(Boolean));
    harness.restore();
  }
});

test("a queued move fails closed if the active group changes before its job starts", async () => {
  const calls = [];
  const queue = new WorldMutationCoordinator();
  const releaseQueue = createDeferred();
  const harness = createHarness({
    processScheduledDate: async (isoDate) => calls.push(["downtime", isoDate]),
    callbacks: {
      refreshGlobalEvents: async () => calls.push(["events"]),
      processDayCycles: async () => calls.push(["cycles"])
    }
  });
  let queuedMove;

  try {
    const groupB = createGroupActor("group-b");
    globalThis.game.actors.contents.push(groupB);
    globalThis.game.actors.get = (id) => globalThis.game.actors.contents.find((actor) => actor.id === id) ?? null;
    const registry = harness.state[SETTINGS_KEYS.GROUP_STATE];
    registry.groupsById[groupB.id] = {
      version: 1,
      groupActorId: groupB.id,
      calendar: { version: 1, isoDate: "2030-01-01" }
    };

    const queueHead = queue.run("calendar-transition:group-a", () => releaseQueue.promise);
    await flushTasks();
    queuedMove = harness.createCoordinator({ coordinator: queue }).moveTo({
      toIsoDate: "2026-07-21",
      processDowntime: true,
      processSupplies: true,
      processDailyCycles: true,
      reason: "advance-days"
    });
    const rejection = assert.rejects(queuedMove, /active Rebreya group changed/u);

    registry.activeGroupActorId = groupB.id;
    releaseQueue.resolve();
    await queueHead;
    await rejection;

    const committedRegistry = harness.state[SETTINGS_KEYS.GROUP_STATE];
    assert.equal(committedRegistry.groupsById["group-a"].calendar.isoDate, "2026-07-20");
    assert.equal(committedRegistry.groupsById["group-b"].calendar.isoDate, "2030-01-01");
    assert.equal(committedRegistry.groupsById["group-a"].calendar.transitionJournal, undefined);
    assert.equal(committedRegistry.groupsById["group-b"].calendar.transitionJournal, undefined);
    assert.deepEqual(calls, []);
  }
  finally {
    releaseQueue.resolve();
    await Promise.allSettled([queuedMove].filter(Boolean));
    harness.restore();
  }
});

test("GM failover while claim is awaited leaves a resumable journal for the new active GM", async () => {
  const claimCommitted = createDeferred();
  const releaseClaim = createDeferred();
  const calls = [];
  const harness = createHarness({
    callbacks: {
      refreshGlobalEvents: async () => calls.push("events"),
      processDayCycles: async () => calls.push("cycles")
    }
  });
  let interruptedMove;

  try {
    const formerGm = globalThis.game.user;
    const nextGm = { id: "gm-next", isGM: true, active: true };
    const users = new Map([
      [formerGm.id, formerGm],
      [nextGm.id, nextGm]
    ]);
    users.contents = [formerGm, nextGm];
    users.activeGM = formerGm;
    globalThis.game.users = users;

    const mutateGroupState = harness.groupContextService.mutateGroupState.bind(harness.groupContextService);
    let holdClaim = true;
    harness.groupContextService.mutateGroupState = async (...args) => {
      const result = await mutateGroupState(...args);
      if (holdClaim) {
        holdClaim = false;
        claimCommitted.resolve();
        await releaseClaim.promise;
      }
      return result;
    };

    const coordinator = harness.createCoordinator();
    const options = {
      toIsoDate: "2026-07-21",
      processDowntime: false,
      processSupplies: true,
      processDailyCycles: true,
      refreshApps: false,
      refreshSmallTime: false,
      reason: "advance-days"
    };
    interruptedMove = coordinator.moveTo(options);
    await claimCommitted.promise;

    users.activeGM = nextGm;
    releaseClaim.resolve();
    await assert.rejects(interruptedMove, /active GM client/u);

    const interruptedEntry = harness.state[SETTINGS_KEYS.GROUP_STATE]
      .groupsById["group-a"].calendar.transitionJournal.entries[0];
    assert.equal(harness.calendarService.getSnapshot().isoDate, "2026-07-20");
    assert.equal(interruptedEntry.status, "processing");
    assert.equal(interruptedEntry.stages.calendar.status, "pending");
    assert.equal(interruptedEntry.completedAt, undefined);
    assert.deepEqual(calls, []);

    globalThis.game.user = nextGm;
    const resumed = await coordinator.moveTo(options);

    assert.equal(resumed.transitionId, interruptedEntry.transitionId);
    assert.equal(resumed.status, "completed");
    assert.equal(harness.calendarService.getSnapshot().isoDate, "2026-07-21");
    assert.deepEqual(calls, ["events", "cycles"]);
  }
  finally {
    releaseClaim.resolve();
    await Promise.allSettled([interruptedMove].filter(Boolean));
    harness.restore();
  }
});

test("GM failover after calendar persistence stops domain stages and resumes safely", async () => {
  const calendarCommitted = createDeferred();
  const releaseCalendar = createDeferred();
  const calls = [];
  const harness = createHarness({
    processScheduledDate: async (isoDate) => {
      calls.push(["downtime", isoDate]);
      return {
        isoDate,
        journalStatus: "completed",
        processed: [],
        blocked: [],
        reconciliation: [],
        skipped: []
      };
    },
    callbacks: {
      refreshGlobalEvents: async () => {
        calls.push(["events"]);
        return { changed: false };
      }
    }
  });
  let interruptedMove;

  try {
    const formerGm = globalThis.game.user;
    const nextGm = { id: "gm-next", isGM: true, active: true };
    const users = new Map([
      [formerGm.id, formerGm],
      [nextGm.id, nextGm]
    ]);
    users.contents = [formerGm, nextGm];
    users.activeGM = formerGm;
    globalThis.game.users = users;

    const setDate = harness.calendarService.setDate.bind(harness.calendarService);
    let holdCalendar = true;
    let calendarWrites = 0;
    harness.calendarService.setDate = async (...args) => {
      calendarWrites += 1;
      const result = await setDate(...args);
      if (holdCalendar) {
        holdCalendar = false;
        calendarCommitted.resolve();
        await releaseCalendar.promise;
      }
      return result;
    };

    const coordinator = harness.createCoordinator();
    const options = {
      toIsoDate: "2026-07-22",
      processDowntime: true,
      refreshApps: false,
      refreshSmallTime: false,
      reason: "calendar-ui"
    };
    interruptedMove = coordinator.moveTo(options);
    await calendarCommitted.promise;

    users.activeGM = nextGm;
    releaseCalendar.resolve();
    await assert.rejects(interruptedMove, /active GM client/u);

    const interruptedEntry = harness.state[SETTINGS_KEYS.GROUP_STATE]
      .groupsById["group-a"].calendar.transitionJournal.entries[0];
    assert.equal(harness.calendarService.getSnapshot().isoDate, "2026-07-22");
    assert.equal(interruptedEntry.status, "processing");
    assert.equal(interruptedEntry.stages.calendar.status, "processing");
    assert.equal(interruptedEntry.completedAt, undefined);
    assert.deepEqual(calls, []);

    globalThis.game.user = nextGm;
    const resumed = await coordinator.moveTo(options);

    assert.equal(resumed.transitionId, interruptedEntry.transitionId);
    assert.equal(resumed.status, "completed");
    assert.equal(calendarWrites, 2);
    assert.deepEqual(calls, [
      ["downtime", "2026-07-21"],
      ["downtime", "2026-07-22"],
      ["events"]
    ]);
  }
  finally {
    releaseCalendar.resolve();
    await Promise.allSettled([interruptedMove].filter(Boolean));
    harness.restore();
  }
});

test("completion uses a durable precommit and accepts a terminal write with a lost acknowledgement", async () => {
  const calls = [];
  const completionStatuses = [];
  const harness = createHarness({
    callbacks: {
      refreshGlobalEvents: async () => {
        calls.push("events");
        return { changed: false };
      },
      processDayCycles: async () => {
        calls.push("cycles");
        return { days: 1, supplies: [], supplyTotals: {} };
      }
    }
  });

  try {
    const setSetting = globalThis.game.settings.set.bind(globalThis.game.settings);
    let terminalAcknowledgementLost = false;
    globalThis.game.settings.set = async (moduleId, key, value) => {
      const entry = value?.groupsById?.["group-a"]?.calendar?.transitionJournal?.entries?.[0];
      if (entry?.status) {
        completionStatuses.push(entry.status);
      }
      const result = await setSetting(moduleId, key, value);
      if (!terminalAcknowledgementLost && entry?.status === "completed") {
        terminalAcknowledgementLost = true;
        throw new Error("terminal acknowledgement lost");
      }
      return result;
    };

    const coordinator = harness.createCoordinator();
    const options = {
      toIsoDate: "2026-07-21",
      processDowntime: false,
      processSupplies: true,
      processDailyCycles: true,
      refreshApps: false,
      refreshSmallTime: false,
      reason: "advance-days"
    };
    const result = await coordinator.moveTo(options);

    const completedEntry = harness.state[SETTINGS_KEYS.GROUP_STATE]
      .groupsById["group-a"].calendar.transitionJournal.entries[0];
    assert.equal(terminalAcknowledgementLost, true);
    assert.equal(result.status, "completed");
    assert.equal(completedEntry.status, "completed");
    assert.ok(completedEntry.completedAt > 0);
    assert.ok(
      completionStatuses.lastIndexOf("completion-pending") < completionStatuses.lastIndexOf("completed"),
      `expected completion-pending before completed, got ${completionStatuses.join(", ")}`
    );
    assert.deepEqual(calls, ["events", "cycles"]);
  }
  finally {
    harness.restore();
  }
});

test("a second active GM started before the first returns reuses terminal completion without callbacks", async () => {
  const calls = [];
  const terminalPersisted = createDeferred();
  const releaseTerminalWrite = createDeferred();
  const harness = createHarness({
    callbacks: {
      refreshGlobalEvents: async () => {
        calls.push("events");
        return { changed: false };
      },
      processDayCycles: async () => {
        calls.push("cycles");
        return { days: 1, supplies: [], supplyTotals: {} };
      }
    }
  });
  let firstMove;
  let secondMove;

  try {
    const formerGm = globalThis.game.user;
    const nextGm = { id: "gm-next", isGM: true, active: true };
    const users = new Map([
      [formerGm.id, formerGm],
      [nextGm.id, nextGm]
    ]);
    users.contents = [formerGm, nextGm];
    users.activeGM = formerGm;
    globalThis.game.users = users;

    const setSetting = globalThis.game.settings.set.bind(globalThis.game.settings);
    let heldTerminalWrite = false;
    globalThis.game.settings.set = async (moduleId, key, value) => {
      const result = await setSetting(moduleId, key, value);
      const entry = value?.groupsById?.["group-a"]?.calendar?.transitionJournal?.entries?.[0];
      if (!heldTerminalWrite && entry?.status === "completed") {
        heldTerminalWrite = true;
        terminalPersisted.resolve();
        await releaseTerminalWrite.promise;
      }
      return result;
    };

    const options = {
      toIsoDate: "2026-07-21",
      processDowntime: false,
      processSupplies: true,
      processDailyCycles: true,
      refreshApps: false,
      refreshSmallTime: false,
      reason: "advance-days"
    };
    firstMove = harness.createCoordinator({
      coordinator: new WorldMutationCoordinator()
    }).moveTo(options);
    await terminalPersisted.promise;

    users.activeGM = nextGm;
    globalThis.game.user = nextGm;
    secondMove = harness.createCoordinator({
      coordinator: new WorldMutationCoordinator()
    }).moveTo(options);
    await flushTasks();
    releaseTerminalWrite.resolve();

    const [firstResult, secondResult] = await Promise.all([firstMove, secondMove]);
    assert.equal(firstResult.status, "completed");
    assert.equal(secondResult.status, "completed");
    assert.equal(secondResult.transitionId, firstResult.transitionId);
    assert.deepEqual(calls, ["events", "cycles"]);
    assert.equal(
      harness.state[SETTINGS_KEYS.GROUP_STATE]
        .groupsById["group-a"].calendar.transitionJournal.entries.length,
      1
    );
  }
  finally {
    releaseTerminalWrite.resolve();
    await Promise.allSettled([firstMove, secondMove].filter(Boolean));
    harness.restore();
  }
});

test("a terminal write rejected before commit leaves completion pending and resumes without callbacks", async () => {
  const calls = [];
  const harness = createHarness({
    callbacks: {
      refreshGlobalEvents: async () => {
        calls.push("events");
        return { changed: false };
      }
    }
  });

  try {
    const setSetting = globalThis.game.settings.set.bind(globalThis.game.settings);
    let rejectTerminalWrite = true;
    globalThis.game.settings.set = async (moduleId, key, value) => {
      const entry = value?.groupsById?.["group-a"]?.calendar?.transitionJournal?.entries?.[0];
      if (rejectTerminalWrite && entry?.status === "completed") {
        rejectTerminalWrite = false;
        throw new Error("terminal write rejected before commit");
      }
      return setSetting(moduleId, key, value);
    };

    const coordinator = harness.createCoordinator();
    const options = {
      toIsoDate: "2026-07-21",
      processDowntime: false,
      refreshApps: false,
      refreshSmallTime: false,
      reason: "calendar-ui"
    };
    await assert.rejects(coordinator.moveTo(options), /rejected before commit/u);

    const pendingEntry = harness.state[SETTINGS_KEYS.GROUP_STATE]
      .groupsById["group-a"].calendar.transitionJournal.entries[0];
    assert.equal(pendingEntry.status, "completion-pending");
    assert.equal(pendingEntry.completedAt, undefined);
    assert.deepEqual(calls, ["events"]);

    const resumed = await coordinator.moveTo(options);
    assert.equal(resumed.transitionId, pendingEntry.transitionId);
    assert.equal(resumed.status, "completed");
    assert.deepEqual(calls, ["events"]);
  }
  finally {
    harness.restore();
  }
});

test("GM failover during completion precommit lets the new GM finish the same transition", async () => {
  const calls = [];
  const pendingPersisted = createDeferred();
  const releasePendingWrite = createDeferred();
  const harness = createHarness({
    callbacks: {
      refreshGlobalEvents: async () => {
        calls.push("events");
        return { changed: false };
      },
      processDayCycles: async () => {
        calls.push("cycles");
        return { days: 1, supplies: [], supplyTotals: {} };
      }
    }
  });
  let firstMove;
  let secondMove;

  try {
    const formerGm = globalThis.game.user;
    const nextGm = { id: "gm-next", isGM: true, active: true };
    const users = new Map([
      [formerGm.id, formerGm],
      [nextGm.id, nextGm]
    ]);
    users.contents = [formerGm, nextGm];
    users.activeGM = formerGm;
    globalThis.game.users = users;

    const setSetting = globalThis.game.settings.set.bind(globalThis.game.settings);
    let heldPendingWrite = false;
    globalThis.game.settings.set = async (moduleId, key, value) => {
      const result = await setSetting(moduleId, key, value);
      const entry = value?.groupsById?.["group-a"]?.calendar?.transitionJournal?.entries?.[0];
      if (!heldPendingWrite && entry?.status === "completion-pending") {
        heldPendingWrite = true;
        pendingPersisted.resolve();
        await releasePendingWrite.promise;
      }
      return result;
    };

    const options = {
      toIsoDate: "2026-07-21",
      processDowntime: false,
      processSupplies: true,
      processDailyCycles: true,
      refreshApps: false,
      refreshSmallTime: false,
      reason: "advance-days"
    };
    firstMove = harness.createCoordinator({
      coordinator: new WorldMutationCoordinator()
    }).moveTo(options);
    const firstOutcome = firstMove.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason })
    );
    await pendingPersisted.promise;

    users.activeGM = nextGm;
    globalThis.game.user = nextGm;
    secondMove = harness.createCoordinator({
      coordinator: new WorldMutationCoordinator()
    }).moveTo(options);
    await flushTasks();
    releasePendingWrite.resolve();

    const interrupted = await firstOutcome;
    const resumed = await secondMove;
    assert.equal(interrupted.status, "rejected");
    assert.match(interrupted.reason.message, /GM client/u);
    assert.equal(resumed.status, "completed");
    assert.equal(
      resumed.transitionId,
      harness.state[SETTINGS_KEYS.GROUP_STATE]
        .groupsById["group-a"].calendar.transitionJournal.entries[0].transitionId
    );
    assert.deepEqual(calls, ["events", "cycles"]);
    assert.equal(
      harness.state[SETTINGS_KEYS.GROUP_STATE]
        .groupsById["group-a"].calendar.transitionJournal.entries.length,
      1
    );
  }
  finally {
    releasePendingWrite.resolve();
    await Promise.allSettled([firstMove, secondMove].filter(Boolean));
    harness.restore();
  }
});

test("callback guard prevents a transition from mutating a newly active group after await", async () => {
  const callbackStarted = createDeferred();
  const releaseCallback = createDeferred();
  const callbackContexts = [];
  const mutatedGroupIds = [];
  const harness = createHarness({
    callbacks: {
      processDayCycles: async (_days, options = {}) => {
        callbackContexts.push({
          groupId: options.groupId,
          transitionId: options.transitionId,
          sharesGuard: typeof options.guard === "function"
            && options.guard === options.assertExecutionContext
        });
        callbackStarted.resolve();
        await releaseCallback.promise;
        options.guard?.();
        mutatedGroupIds.push(
          harness.state[SETTINGS_KEYS.GROUP_STATE].activeGroupActorId
        );
        return { days: 1, supplies: [], supplyTotals: {} };
      }
    }
  });
  let interruptedMove;

  try {
    const groupB = createGroupActor("group-b");
    globalThis.game.actors.contents.push(groupB);
    globalThis.game.actors.get = (id) => globalThis.game.actors.contents.find((actor) => actor.id === id) ?? null;
    const registry = harness.state[SETTINGS_KEYS.GROUP_STATE];
    registry.groupsById[groupB.id] = {
      version: 1,
      groupActorId: groupB.id,
      calendar: { version: 1, isoDate: "2030-01-01" }
    };

    const coordinator = harness.createCoordinator();
    const options = {
      toIsoDate: "2026-07-21",
      processDowntime: false,
      processSupplies: true,
      processDailyCycles: true,
      refreshApps: false,
      refreshSmallTime: false,
      reason: "advance-days"
    };
    interruptedMove = coordinator.moveTo(options);
    await callbackStarted.promise;

    harness.state[SETTINGS_KEYS.GROUP_STATE].activeGroupActorId = groupB.id;
    releaseCallback.resolve();
    await assert.rejects(interruptedMove, /active Rebreya group changed/u);

    const committedRegistry = harness.state[SETTINGS_KEYS.GROUP_STATE];
    const interruptedEntry = committedRegistry.groupsById["group-a"].calendar.transitionJournal.entries[0];
    assert.deepEqual(callbackContexts, [{
      groupId: "group-a",
      transitionId: interruptedEntry.transitionId,
      sharesGuard: true
    }]);
    assert.deepEqual(mutatedGroupIds, []);
    assert.equal(committedRegistry.groupsById["group-b"].calendar.transitionJournal, undefined);

    committedRegistry.activeGroupActorId = "group-a";
    const resumed = await coordinator.moveTo(options);

    assert.equal(resumed.transitionId, interruptedEntry.transitionId);
    assert.equal(resumed.status, "reconciliation-required");
    assert.equal(callbackContexts.length, 1);
    assert.deepEqual(mutatedGroupIds, []);
  }
  finally {
    releaseCallback.resolve();
    await Promise.allSettled([interruptedMove].filter(Boolean));
    harness.restore();
  }
});

test("calendar move queue continues after a rejected transition", async () => {
  const harness = createHarness();

  try {
    const coordinator = harness.createCoordinator();
    const originalSetDate = harness.calendarService.setDate.bind(harness.calendarService);
    let rejectNextWrite = true;
    harness.calendarService.setDate = async (...args) => {
      if (rejectNextWrite) {
        rejectNextWrite = false;
        throw new Error("calendar write failed");
      }
      return originalSetDate(...args);
    };

    await assert.rejects(
      coordinator.moveTo({
        toIsoDate: "2026-07-21",
        processDowntime: false,
        reason: "calendar-ui"
      }),
      /calendar write failed/u
    );

    const recovered = await coordinator.moveTo({
      toIsoDate: "2026-07-22",
      processDowntime: false,
      reason: "calendar-ui"
    });

    assert.equal(recovered.calendar.isoDate, "2026-07-22");
    assert.equal(harness.calendarService.getSnapshot().isoDate, "2026-07-22");
  }
  finally {
    harness.restore();
  }
});

test("only the active GM client may execute calendar transition domain stages", async () => {
  const calls = [];
  const harness = createHarness({
    callbacks: {
      refreshGlobalEvents: async () => calls.push("events"),
      processDayCycles: async () => calls.push("cycles")
    }
  });

  try {
    const inactiveGm = globalThis.game.user;
    const activeGm = { id: "gm-active", isGM: true, active: true };
    const users = new Map([
      [inactiveGm.id, inactiveGm],
      [activeGm.id, activeGm]
    ]);
    users.contents = [inactiveGm, activeGm];
    users.activeGM = activeGm;
    globalThis.game.users = users;

    await assert.rejects(
      harness.createCoordinator().moveTo({
        toIsoDate: "2026-07-21",
        processDowntime: false,
        processSupplies: true,
        processDailyCycles: true,
        reason: "advance-days"
      }),
      /active GM client/u
    );

    assert.deepEqual(calls, []);
    assert.equal(
      harness.state[SETTINGS_KEYS.GROUP_STATE].groupsById["group-a"].calendar.transitionJournal,
      undefined
    );
  }
  finally {
    harness.restore();
  }
});

test("a blocked downtime day remains visible and does not stop later crossed dates", async () => {
  const processedDates = [];
  const harness = createHarness({
    processScheduledDate: async (isoDate, { transitionId }) => {
      processedDates.push(isoDate);
      return {
        isoDate,
        transitionId,
        journalStatus: "completed",
        processed: isoDate === "2026-07-22" ? [{ id: "slot-ok" }] : [],
        blocked: isoDate === "2026-07-21" ? [{ id: "slot-blocked", blockReason: "Missing materials" }] : [],
        reconciliation: [],
        skipped: []
      };
    }
  });

  try {
    const result = await harness.createCoordinator().moveTo({
      toIsoDate: "2026-07-22",
      processDowntime: true,
      reason: "calendar-ui"
    });

    assert.equal(result.calendar.isoDate, "2026-07-22");
    assert.deepEqual(processedDates, ["2026-07-21", "2026-07-22"]);
    assert.deepEqual(result.downtime.map((entry) => entry.status), ["blocked", "completed"]);
    assert.equal(result.downtime[0].result.blocked[0].blockReason, "Missing materials");
  }
  finally {
    harness.restore();
  }
});

test("processDowntime false excludes downtime while preserving month, supplies, and refresh stages", async () => {
  const calls = [];
  const harness = createHarness({
    isoDate: "2026-01-30",
    processScheduledDate: async (isoDate) => calls.push(["downtime", isoDate]),
    callbacks: {
      refreshGlobalEvents: async (currentIsoDate, previousIsoDate) => {
        calls.push(["events", currentIsoDate, previousIsoDate]);
        return { changed: true };
      },
      resetTraderMonth: async (count, reason) => {
        calls.push(["trader", count, reason]);
        return { triggered: count > 0, monthResetCount: count };
      },
      processDayCycles: async (days, options) => {
        calls.push(["cycles", days, options.consumeSupplies, options.applyEnergy]);
        return { days, supplies: [{ ok: true }], supplyTotals: {} };
      },
      refreshApps: async () => calls.push(["apps"]),
      refreshSmallTime: async () => calls.push(["smalltime"])
    }
  });

  try {
    const result = await harness.createCoordinator().moveTo({
      toIsoDate: "2026-02-02",
      processDowntime: false,
      processSupplies: true,
      consumeSupplies: true,
      applyEnergy: false,
      reason: "advance-days"
    });

    assert.deepEqual(result.downtime, []);
    assert.deepEqual(calls, [
      ["events", "2026-02-02", "2026-01-30"],
      ["trader", 1, "advance-days"],
      ["cycles", 3, true, false],
      ["apps"],
      ["smalltime"]
    ]);
    assert.equal(result.counts.monthBoundaries, 1);
    assert.equal(result.traderReset.monthResetCount, 1);
    assert.equal(result.cycles.days, 3);
  }
  finally {
    harness.restore();
  }
});

test("moving backward across a month boundary never resets traders", async () => {
  const traderCalls = [];
  const harness = createHarness({
    isoDate: "2026-03-02",
    callbacks: {
      resetTraderMonth: async (count, reason) => {
        traderCalls.push({ count, reason });
        return { triggered: true, monthResetCount: count };
      }
    }
  });

  try {
    const result = await harness.createCoordinator().moveTo({
      toIsoDate: "2026-02-28",
      processDowntime: true,
      processSupplies: true,
      processDailyCycles: true,
      reason: "calendar-ui"
    });

    assert.equal(result.direction, "backward");
    assert.equal(result.counts.monthBoundaries, 1);
    assert.deepEqual(traderCalls, []);
    assert.deepEqual(result.traderReset, {
      triggered: false,
      reason: "calendar-ui",
      monthResetCount: 0,
      refreshedTraderCount: 0,
      removedTraderCount: 0
    });
  }
  finally {
    harness.restore();
  }
});

test("all public calendar movement APIs delegate to the transition coordinator", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = { once() {}, on() {} };
  globalThis.game = { user: { id: "gm", isGM: true, active: true } };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?calendar-routing=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const moves = [];
    moduleApi.calendarService.previewDate = (year, month, day) => ({
      to: { isoDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` }
    });
    moduleApi.calendarService.previewShiftDays = (days) => ({ to: { isoDate: `shift-${days}` } });
    moduleApi.calendarService.previewAdvanceMonths = (months) => ({ to: { isoDate: `month-${months}` } });
    moduleApi.calendarTransitionCoordinator = {
      preview(options) {
        return { previewed: clone(options) };
      },
      async moveTo(options) {
        moves.push(clone(options));
        return { calendar: { isoDate: options.toIsoDate }, ...options };
      }
    };

    assert.deepEqual(moduleApi.previewCalendarTransition({
      toIsoDate: "2026-07-25",
      processDowntime: true,
      processSupplies: false,
      reason: "calendar-ui"
    }), {
      previewed: {
        toIsoDate: "2026-07-25",
        processDowntime: true,
        processSupplies: false,
        reason: "calendar-ui"
      }
    });

    await moduleApi.setCalendarDate(2026, 7, 21, { processDowntime: false });
    await moduleApi.shiftCalendarDays(-2, {
      processDailyCycles: true,
      processSupplies: false,
      refreshApps: false
    });
    await moduleApi.advanceCalendarDays(3, { applyEnergy: false });
    await moduleApi.advanceCalendarWeeks(2, { consumeSupplies: false });
    await moduleApi.advanceCalendarMonths(4, { refreshSmallTime: false });

    assert.deepEqual(moves.map((move) => move.toIsoDate), [
      "2026-07-21",
      "shift--2",
      "shift-3",
      "shift-14",
      "month-4"
    ]);
    assert.equal(moves[0].processDowntime, false);
    assert.equal(moves[1].processSupplies, false);
    assert.equal(moves[1].refreshApps, false);
    assert.equal(moves[2].applyEnergy, false);
    assert.equal(moves[3].consumeSupplies, false);
    assert.equal(moves[4].refreshSmallTime, false);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("main day-cycle callback guards every supply mutation with the captured group scope", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = { once() {}, on() {} };
  globalThis.game = { user: { id: "gm", isGM: true, active: true } };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?calendar-cycle-guard=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const supplyContexts = [];
    let executionActive = true;
    const guard = () => {
      if (!executionActive) {
        throw new Error("calendar execution context changed");
      }
    };
    moduleApi.inventoryService.consumeSuppliesOneDay = async (options = {}) => {
      supplyContexts.push({
        groupId: options.groupId,
        transitionId: options.transitionId,
        sharesGuard: options.guard === guard && options.assertExecutionContext === guard
      });
      executionActive = false;
      return { foodSpent: 1, waterSpent: 1, foodShortage: 0, waterShortage: 0 };
    };

    await assert.rejects(
      moduleApi.calendarTransitionCoordinator.processDayCycles(2, {
        groupId: "group-a",
        transitionId: "calendar:group-a:1:2026-07-20:2026-07-22",
        assertExecutionContext: guard,
        guard,
        consumeSupplies: true,
        applyEnergy: true
      }),
      /calendar execution context changed/u
    );

    assert.deepEqual(supplyContexts, [{
      groupId: "group-a",
      transitionId: "calendar:group-a:1:2026-07-20:2026-07-22",
      sharesGuard: true
    }]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("main trader reset forwards the captured group guard into the persistent service", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = { once() {}, on() {} };
  globalThis.game = { user: { id: "gm", isGM: true, active: true } };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?calendar-trader-guard=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const guard = () => undefined;
    const executionContext = Object.freeze({
      groupId: "group-a",
      transitionId: "calendar:group-a:1:2026-07-31:2026-08-01",
      assertExecutionContext: guard,
      guard
    });
    const receivedContexts = [];
    moduleApi.traderService.resetAssortments = async (options) => {
      receivedContexts.push(options);
      return { refreshedTraderCount: 2, removedTraderCount: 1 };
    };

    const result = await moduleApi.calendarTransitionCoordinator.resetTraderMonth(
      1,
      "calendar-ui",
      executionContext
    );

    assert.equal(receivedContexts.length, 1);
    assert.equal(receivedContexts[0], executionContext);
    assert.deepEqual(result, {
      triggered: true,
      reason: "calendar-ui",
      monthResetCount: 1,
      refreshedTraderCount: 2,
      removedTraderCount: 1
    });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("calendar daily cycles consume supplies without calling the legacy craft day processor", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  const previousUi = globalThis.ui;
  const groupActor = createGroupActor();
  const state = {
    [SETTINGS_KEYS.CALENDAR_STATE]: { version: 1, isoDate: "1300-01-01" },
    [SETTINGS_KEYS.GROUP_STATE]: {
      version: 1,
      activeGroupActorId: groupActor.id,
      groupsById: {
        [groupActor.id]: {
          version: 1,
          groupActorId: groupActor.id,
          calendar: { version: 1, isoDate: "2026-07-20" }
        }
      }
    }
  };
  globalThis.Hooks = { once() {}, on() {} };
  globalThis.foundry = {
    applications: { instances: new Map() },
    utils: {
      deepClone: clone,
      mergeObject: (base, update) => ({ ...clone(base), ...clone(update) })
    }
  };
  globalThis.ui = { windows: {} };
  globalThis.game = {
    user: { id: "gm", isGM: true, active: true },
    actors: {
      contents: [groupActor],
      get(id) {
        return id === groupActor.id ? groupActor : null;
      }
    },
    modules: { get: () => ({ active: false }) },
    settings: {
      get(_moduleId, key) {
        return clone(state[key]);
      },
      async set(_moduleId, key, value) {
        state[key] = clone(value);
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?calendar-no-craft=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let supplyCalls = 0;
    let craftCalls = 0;
    moduleApi.inventoryService.consumeSuppliesOneDay = async () => {
      supplyCalls += 1;
      return { foodSpent: 1, waterSpent: 1, foodShortage: 0, waterShortage: 0 };
    };
    moduleApi.craftingService.processOneDay = async () => {
      craftCalls += 1;
      return { completed: [], completedCount: 0 };
    };
    moduleApi.globalEventsService.refreshEventActivationByDate = async () => ({ changed: false });
    moduleApi.globalEventsService.isAutoRecalculateEnabled = () => false;
    moduleApi.traderService.resetAssortments = async () => ({ refreshedTraderCount: 0, removedTraderCount: 0 });

    await moduleApi.advanceCalendarDays(2, {
      processDowntime: false,
      refreshApps: false,
      refreshSmallTime: false
    });

    assert.equal(supplyCalls, 2);
    assert.equal(craftCalls, 0);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.foundry = previousFoundry;
    globalThis.ui = previousUi;
  }
});
