import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../scripts/constants.js";
import { CalendarService } from "../scripts/data/calendar-service.js";
import { CalendarTransitionCoordinator } from "../scripts/data/calendar-transition-coordinator.js";
import { GroupContextService } from "../scripts/data/group-context-service.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
