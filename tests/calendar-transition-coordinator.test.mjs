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

function createDowntimeSummary(isoDate, requestId = `request-${isoDate}`) {
  return {
    isoDate,
    total: 1,
    counts: { free: 0, pending: 1, approved: 0, processed: 0, blocked: 0 },
    slots: [{ id: `slot-${isoDate}`, requestId }]
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
  const writes = [];
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
        writes.push({ key, value: clone(value) });
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
    writes,
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
    calendarByIsoDate: {
      "2026-07-21": createDowntimeSummary("2026-07-21"),
      "2026-07-22": createDowntimeSummary("2026-07-22")
    },
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

test("moveTo skips downtime processing when no crossed dates have scheduled requests", async () => {
  const calls = [];
  const harness = createHarness({
    processScheduledDate: async (isoDate) => calls.push(isoDate)
  });

  try {
    const result = await harness.createCoordinator().moveTo({
      toIsoDate: "2026-08-20",
      processDowntime: true,
      processDailyCycles: false,
      refreshApps: false,
      refreshSmallTime: false,
      reason: "calendar-ui"
    });

    assert.equal(result.calendar.isoDate, "2026-08-20");
    assert.equal(result.counts.affectedDowntimeDates, 0);
    assert.deepEqual(result.downtime, []);
    assert.deepEqual(calls, []);

    const entry = harness.state[SETTINGS_KEYS.GROUP_STATE]
      .groupsById["group-a"].calendar.transitionJournal.entries[0];
    assert.deepEqual(entry.downtimeByIsoDate, {});
  }
  finally {
    harness.restore();
  }
});

test("month transition without scheduled downtime keeps journal writes bounded", async () => {
  const harness = createHarness({
    callbacks: {
      refreshGlobalEvents: async () => ({ changed: false }),
      resetTraderMonth: async (monthResetCount, reason) => ({
        triggered: monthResetCount > 0,
        reason,
        monthResetCount,
        refreshedTraderCount: 0,
        removedTraderCount: 0
      }),
      processDayCycles: async (days) => ({ days, supplies: [], supplyTotals: {}, craft: { completed: [], completedCount: 0 } }),
      refreshApps: async () => ({ refreshed: true }),
      refreshSmallTime: async () => ({ refreshed: true })
    }
  });

  try {
    const result = await harness.createCoordinator().moveTo({
      toIsoDate: "2026-08-20",
      processDowntime: true,
      processSupplies: true,
      processDailyCycles: true,
      monthResetCount: 1,
      reason: "calendar-ui"
    });

    assert.equal(result.calendar.isoDate, "2026-08-20");
    assert.equal(result.counts.affectedDowntimeDates, 0);
    assert.deepEqual(result.downtime, []);
    assert.ok(
      harness.writes.length <= 12,
      `expected no more than 12 group calendar writes, got ${harness.writes.length}`
    );
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
  const harness = createHarness({
    calendarByIsoDate: {
      "2026-07-21": createDowntimeSummary("2026-07-21"),
      "2026-07-22": createDowntimeSummary("2026-07-22"),
      "2026-07-23": createDowntimeSummary("2026-07-23")
    },
    processScheduledDate
  });

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
    calendarByIsoDate: {
      "2026-07-21": createDowntimeSummary("2026-07-21"),
      "2026-07-22": createDowntimeSummary("2026-07-22")
    },
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
    calendarByIsoDate: {
      "2026-07-21": createDowntimeSummary("2026-07-21"),
      "2026-07-22": createDowntimeSummary("2026-07-22")
    },
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

test("moveToGroup keeps preview, queue, writes, journal, and callbacks in the captured group", async () => {
  const callbackGroups = [];
  const previewGroups = [];
  const queueKeys = [];
  const harness = createHarness();

  try {
    const groupB = createGroupActor("group-b");
    globalThis.game.actors.contents.push(groupB);
    globalThis.game.actors.get = (id) => globalThis.game.actors.contents.find((actor) => actor.id === id) ?? null;
    const registry = harness.state[SETTINGS_KEYS.GROUP_STATE];
    const groupACalendar = clone(registry.groupsById["group-a"].calendar);
    registry.groupsById[groupB.id] = {
      version: 1,
      groupActorId: groupB.id,
      calendar: { version: 1, isoDate: "2026-01-31", timeOfDaySeconds: 7200 }
    };

    const downtimeService = {
      getSnapshot(_options = {}, { groupId = "" } = {}) {
        const resolvedGroupId = groupId || registry.activeGroupActorId;
        previewGroups.push(resolvedGroupId);
        return {
          groupId: resolvedGroupId,
          calendarByIsoDate: {
            "2026-02-01": createDowntimeSummary("2026-02-01", "request-group-b")
          }
        };
      },
      async processScheduledDate(isoDate, executionContext = {}) {
        callbackGroups.push(["downtime", executionContext.groupId]);
        return {
          isoDate,
          transitionId: executionContext.transitionId,
          journalStatus: "completed",
          processed: [],
          blocked: [],
          reconciliation: [],
          skipped: []
        };
      }
    };
    const coordinator = harness.createCoordinator({
      downtimeService,
      coordinator: {
        async run(key, operation) {
          queueKeys.push(key);
          return operation();
        }
      },
      refreshGlobalEvents: async (_currentIsoDate, _previousIsoDate, executionContext = {}) => {
        callbackGroups.push(["global-events", executionContext.groupId]);
        return { changed: false };
      },
      resetTraderMonth: async (_count, _reason, executionContext = {}) => {
        callbackGroups.push(["trader-month", executionContext.groupId]);
        return { triggered: true };
      },
      processDayCycles: async (days, executionContext = {}) => {
        callbackGroups.push(["day-cycles", executionContext.groupId]);
        return { days, supplies: [], supplyTotals: {} };
      },
      refreshApps: async (executionContext = {}) => {
        callbackGroups.push(["refresh-apps", executionContext.groupId]);
      },
      refreshSmallTime: async (executionContext = {}) => {
        callbackGroups.push(["refresh-small-time", executionContext.groupId]);
      }
    });

    const result = await coordinator.moveToGroup(groupB.id, {
      toIsoDate: "2026-02-01",
      processDowntime: true,
      processSupplies: true,
      processDailyCycles: true,
      refreshApps: true,
      refreshSmallTime: true,
      reason: "group-b-calendar"
    });

    assert.equal(result.groupId, groupB.id);
    assert.equal(result.fromIsoDate, "2026-01-31");
    assert.equal(result.calendar.isoDate, "2026-02-01");
    assert.deepEqual(queueKeys, ["calendar-transition:group-b"]);
    assert.ok(previewGroups.length > 0);
    assert.equal(previewGroups.every((groupId) => groupId === groupB.id), true);
    assert.deepEqual(callbackGroups, [
      ["downtime", groupB.id],
      ["global-events", groupB.id],
      ["trader-month", groupB.id],
      ["day-cycles", groupB.id],
      ["refresh-apps", groupB.id],
      ["refresh-small-time", groupB.id]
    ]);

    const groupWrites = harness.writes.filter((write) => write.key === SETTINGS_KEYS.GROUP_STATE);
    assert.ok(groupWrites.length > 0);
    for (const write of groupWrites) {
      assert.deepEqual(write.value.groupsById["group-a"].calendar, groupACalendar);
    }
    const committedRegistry = harness.state[SETTINGS_KEYS.GROUP_STATE];
    assert.deepEqual(committedRegistry.groupsById["group-a"].calendar, groupACalendar);
    assert.equal(committedRegistry.groupsById[groupB.id].calendar.isoDate, "2026-02-01");
    assert.equal(
      committedRegistry.groupsById[groupB.id].calendar.transitionJournal.entries
        .every((entry) => entry.groupId === groupB.id),
      true
    );
  }
  finally {
    harness.restore();
  }
});

test("a queued move keeps its captured group if the active selection changes before its job starts", async () => {
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

    registry.activeGroupActorId = groupB.id;
    releaseQueue.resolve();
    await queueHead;
    const result = await queuedMove;

    const committedRegistry = harness.state[SETTINGS_KEYS.GROUP_STATE];
    assert.equal(result.groupId, "group-a");
    assert.equal(result.status, "completed");
    assert.equal(committedRegistry.groupsById["group-a"].calendar.isoDate, "2026-07-21");
    assert.equal(committedRegistry.groupsById["group-b"].calendar.isoDate, "2030-01-01");
    assert.equal(
      committedRegistry.groupsById["group-a"].calendar.transitionJournal.entries[0].groupId,
      "group-a"
    );
    assert.equal(committedRegistry.groupsById["group-b"].calendar.transitionJournal, undefined);
    assert.deepEqual(calls, [["events"], ["cycles"]]);
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
    calendarByIsoDate: {
      "2026-07-21": createDowntimeSummary("2026-07-21"),
      "2026-07-22": createDowntimeSummary("2026-07-22")
    },
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

test("callback guard retains the captured group after the active selection changes", async () => {
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
        mutatedGroupIds.push(options.groupId);
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
    const result = await interruptedMove;

    const committedRegistry = harness.state[SETTINGS_KEYS.GROUP_STATE];
    const interruptedEntry = committedRegistry.groupsById["group-a"].calendar.transitionJournal.entries[0];
    assert.equal(result.status, "completed");
    assert.deepEqual(callbackContexts, [{
      groupId: "group-a",
      transitionId: interruptedEntry.transitionId,
      sharesGuard: true
    }]);
    assert.deepEqual(mutatedGroupIds, ["group-a"]);
    assert.equal(committedRegistry.groupsById["group-b"].calendar.transitionJournal, undefined);
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
    calendarByIsoDate: {
      "2026-07-21": createDowntimeSummary("2026-07-21"),
      "2026-07-22": createDowntimeSummary("2026-07-22")
    },
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

test("calendar movement APIs route through the active GM when the current GM is not active", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  const groupActor = createGroupActor();
  const users = new Map([
    ["codex", { id: "codex", isGM: true, active: true }],
    ["gm", { id: "gm", isGM: true, active: true }]
  ]);
  users.activeGM = users.get("gm");
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
    utils: {
      deepClone: clone,
      mergeObject: (base, update) => ({ ...clone(base), ...clone(update) })
    }
  };
  globalThis.game = {
    user: users.get("codex"),
    users,
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

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?calendar-inactive-gm-route=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const requests = [];
    moduleApi.calendarService.previewDate = (year, month, day) => ({
      to: { isoDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` }
    });
    moduleApi.calendarTransitionCoordinator = {
      async moveTo() {
        throw new Error("local calendar transition should not run on inactive GM");
      }
    };
    moduleApi.socketCommandBus = {
      async request(command, payload) {
        requests.push({ command, payload: clone(payload) });
        return { calendar: { isoDate: payload.options.toIsoDate }, routed: true };
      }
    };

    const result = await moduleApi.setCalendarDate(2026, 7, 21, {
      processDowntime: false,
      processSupplies: true,
      processDailyCycles: true,
      consumeSupplies: false,
      applyEnergy: false,
      monthResetCount: 1,
      reason: "calendar-ui"
    });

    assert.equal(result.routed, true);
    assert.deepEqual(requests, [{
      command: "group.calendar.transition",
      payload: {
        groupActorId: groupActor.id,
        options: {
          applyEnergy: false,
          consumeSupplies: false,
          monthResetCount: 1,
          monthResetMode: "target-first",
          processDailyCycles: true,
          processDowntime: false,
          processSupplies: true,
          reason: "calendar-ui",
          toIsoDate: "2026-07-21"
        }
      }
    }]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.foundry = previousFoundry;
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
    moduleApi.inventoryService.consumeSuppliesDays = async (_days, options = {}) => {
      supplyContexts.push({
        groupId: options.groupId,
        transitionId: options.transitionId,
        sharesGuard: options.guard === guard && options.assertExecutionContext === guard
      });
      executionActive = false;
      return {
        days: 2,
        supplies: [{ foodSpent: 1, waterSpent: 1, foodShortage: 0, waterShortage: 0 }],
        supplyTotals: { foodSpent: 1, waterSpent: 1, foodShortage: 0, waterShortage: 0 }
      };
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

test("main trader month reset leaves shop inventories lazy until first open", async () => {
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
    moduleApi.traderService.resetAssortments = async () => {
      assert.fail("calendar month reset should not eagerly regenerate trader inventories");
    };

    const result = await moduleApi.calendarTransitionCoordinator.resetTraderMonth(
      1,
      "calendar-ui",
      executionContext
    );

    assert.deepEqual(result, {
      triggered: true,
      reason: "calendar-ui",
      monthResetCount: 1,
      refreshedTraderCount: 0,
      removedTraderCount: 0
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
    moduleApi.inventoryService.consumeSuppliesDays = async (days) => {
      supplyCalls += 1;
      return {
        days,
        supplies: Array.from({ length: days }, () => ({
          foodSpent: 1,
          waterSpent: 1,
          foodShortage: 0,
          waterShortage: 0
        })),
        supplyTotals: {
          foodSpent: days,
          waterSpent: days,
          foodShortage: 0,
          waterShortage: 0
        }
      };
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

    assert.equal(supplyCalls, 1);
    assert.equal(craftCalls, 0);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.foundry = previousFoundry;
    globalThis.ui = previousUi;
  }
});

test("calendar daily cycles use batched supply consumption when available", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  const previousUi = globalThis.ui;
  const groupActor = createGroupActor();
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
        if (key === SETTINGS_KEYS.CALENDAR_STATE) return { version: 1, isoDate: "1300-01-01" };
        if (key === SETTINGS_KEYS.GROUP_STATE) {
          return {
            version: 1,
            activeGroupActorId: groupActor.id,
            groupsById: {
              [groupActor.id]: {
                version: 1,
                groupActorId: groupActor.id,
                calendar: { version: 1, isoDate: "2026-07-20" }
              }
            }
          };
        }
        return {};
      },
      async set() {}
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?calendar-bulk-supplies=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let bulkCalls = 0;
    let oneDayCalls = 0;
    moduleApi.inventoryService.consumeSuppliesDays = async (days, options = {}) => {
      bulkCalls += 1;
      assert.equal(days, 30);
      assert.equal(options.groupId, "group-a");
      assert.equal(options.transitionId, "calendar:group-a:1:2026-07-20:2026-08-19");
      return {
        days,
        supplies: Array.from({ length: days }, () => ({
          foodSpent: 1,
          waterSpent: 1,
          foodShortage: 0,
          waterShortage: 0
        })),
        supplyTotals: {
          foodSpent: 30,
          waterSpent: 30,
          foodShortage: 0,
          waterShortage: 0
        }
      };
    };
    moduleApi.inventoryService.consumeSuppliesOneDay = async () => {
      oneDayCalls += 1;
      throw new Error("calendar should not call per-day supply consumption when bulk is available");
    };

    const result = await moduleApi.calendarTransitionCoordinator.processDayCycles(30, {
      groupId: "group-a",
      transitionId: "calendar:group-a:1:2026-07-20:2026-08-19",
      assertExecutionContext: () => undefined,
      guard: () => undefined,
      consumeSupplies: true,
      applyEnergy: true
    });

    assert.equal(bulkCalls, 1);
    assert.equal(oneDayCalls, 0);
    assert.equal(result.days, 30);
    assert.equal(result.supplies.length, 30);
    assert.deepEqual(result.supplyTotals, {
      foodSpent: 30,
      waterSpent: 30,
      foodShortage: 0,
      waterShortage: 0
    });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.foundry = previousFoundry;
    globalThis.ui = previousUi;
  }
});
