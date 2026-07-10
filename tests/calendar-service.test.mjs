import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../scripts/constants.js";
import { CalendarService } from "../scripts/data/calendar-service.js";
import { GroupContextService } from "../scripts/data/group-context-service.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createGroupActor(id) {
  return {
    id,
    type: "group",
    system: { members: [] },
    getFlag(moduleId, key) {
      return moduleId === MODULE_ID && key === REBREYA_GROUP_FLAGS.MANAGED ? true : undefined;
    }
  };
}

function withCalendarHarness(state, callback) {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  const groupActor = createGroupActor("group-a");

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

  return Promise.resolve()
    .then(() => callback({ calendarService, groupContextService, state }))
    .finally(() => {
      globalThis.game = previousGame;
      globalThis.foundry = previousFoundry;
    });
}

test("calendar service reads and writes the active Rebreya group calendar", async () => {
  const state = {
    [SETTINGS_KEYS.CALENDAR_STATE]: { version: 1, isoDate: "1300-01-01" },
    [SETTINGS_KEYS.GROUP_STATE]: {
      version: 1,
      activeGroupActorId: "group-a",
      groupsById: {
        "group-a": {
          version: 1,
          groupActorId: "group-a",
          calendar: { version: 1, isoDate: "1200-01-10" }
        }
      }
    }
  };

  await withCalendarHarness(state, async ({ calendarService, state: storedState }) => {
    assert.equal(calendarService.getSnapshot().isoDate, "1200-01-10");

    const result = await calendarService.setDate(1200, 2, 3);

    assert.equal(result.isoDate, "1200-02-03");
    assert.equal(storedState[SETTINGS_KEYS.GROUP_STATE].groupsById["group-a"].calendar.isoDate, "1200-02-03");
    assert.equal(storedState[SETTINGS_KEYS.CALENDAR_STATE].isoDate, "1300-01-01");
  });
});

test("calendar service can shift the active group date forward and backward", async () => {
  const state = {
    [SETTINGS_KEYS.CALENDAR_STATE]: { version: 1, isoDate: "1300-01-01" },
    [SETTINGS_KEYS.GROUP_STATE]: {
      version: 1,
      activeGroupActorId: "group-a",
      groupsById: {
        "group-a": {
          version: 1,
          groupActorId: "group-a",
          calendar: { version: 1, isoDate: "1200-01-02" }
        }
      }
    }
  };

  await withCalendarHarness(state, async ({ calendarService }) => {
    const backward = await calendarService.shiftDays(-1);
    assert.equal(backward.daysAdvanced, -1);
    assert.equal(backward.from.isoDate, "1200-01-02");
    assert.equal(backward.to.isoDate, "1200-01-01");

    const forward = await calendarService.shiftDays(1);
    assert.equal(forward.daysAdvanced, 1);
    assert.equal(forward.from.isoDate, "1200-01-01");
    assert.equal(forward.to.isoDate, "1200-01-02");
  });
});

test("calendar service stores time of day inside the active group calendar", async () => {
  const state = {
    [SETTINGS_KEYS.CALENDAR_STATE]: { version: 1, isoDate: "1300-01-01", timeOfDaySeconds: 3600 },
    [SETTINGS_KEYS.GROUP_STATE]: {
      version: 1,
      activeGroupActorId: "group-a",
      groupsById: {
        "group-a": {
          version: 1,
          groupActorId: "group-a",
          calendar: { version: 1, isoDate: "1200-01-10", timeOfDaySeconds: 49025 }
        }
      }
    }
  };

  await withCalendarHarness(state, async ({ calendarService, state: storedState }) => {
    const initial = calendarService.getSnapshot();
    assert.equal(initial.isoDate, "1200-01-10");
    assert.equal(initial.timeOfDaySeconds, 49025);
    assert.equal(initial.hour, 13);
    assert.equal(initial.minute, 37);
    assert.equal(initial.second, 5);
    assert.equal(initial.timeLabel, "13:37:05");

    const timeResult = await calendarService.setTimeOfDaySeconds(86399);
    assert.equal(timeResult.timeOfDaySeconds, 86399);
    assert.equal(timeResult.timeLabel, "23:59:59");
    assert.equal(storedState[SETTINGS_KEYS.GROUP_STATE].groupsById["group-a"].calendar.timeOfDaySeconds, 86399);
    assert.equal(storedState[SETTINGS_KEYS.CALENDAR_STATE].timeOfDaySeconds, 3600);

    const shifted = await calendarService.shiftDays(1);
    assert.equal(shifted.to.isoDate, "1200-01-11");
    assert.equal(shifted.to.timeOfDaySeconds, 86399);

    const setDate = await calendarService.setDate(1200, 2, 3);
    assert.equal(setDate.isoDate, "1200-02-03");
    assert.equal(setDate.timeOfDaySeconds, 86399);
  });
});

test("calendar service concurrent date and time patches preserve both latest fields", async () => {
  const state = {
    [SETTINGS_KEYS.CALENDAR_STATE]: { version: 1, isoDate: "1300-01-01", timeOfDaySeconds: 0 },
    [SETTINGS_KEYS.GROUP_STATE]: {
      version: 1,
      activeGroupActorId: "group-a",
      groupsById: {
        "group-a": {
          version: 1,
          groupActorId: "group-a",
          calendar: { version: 1, isoDate: "1200-01-01", timeOfDaySeconds: 3600 }
        }
      }
    }
  };

  await withCalendarHarness(state, async ({ calendarService, state: storedState }) => {
    await Promise.all([
      calendarService.setDate(1200, 2, 3),
      calendarService.setTimeOfDaySeconds(86399)
    ]);

    assert.deepEqual(
      storedState[SETTINGS_KEYS.GROUP_STATE].groupsById["group-a"].calendar,
      { version: 1, isoDate: "1200-02-03", timeOfDaySeconds: 86399 }
    );
  });
});

test("calendar service sends only changed fields and builds its snapshot from the command result", async () => {
  const previousGame = globalThis.game;
  const player = { id: "player", isGM: false, active: true };
  const gm = { id: "gm", isGM: true, active: true };
  const users = new Map([[player.id, player], [gm.id, gm]]);
  users.contents = [player, gm];
  users.activeGM = gm;
  globalThis.game = {
    user: player,
    users,
    settings: {
      get() {
        return { version: 1, isoDate: "1300-01-01", timeOfDaySeconds: 0 };
      }
    }
  };
  const requests = [];
  const commandResults = [
    { version: 1, isoDate: "1200-02-03", timeOfDaySeconds: 3600 },
    { version: 1, isoDate: "1200-01-01", timeOfDaySeconds: 86399 }
  ];
  const groupContextService = {
    resolveForCurrentUser() {
      return {
        groupId: "group-a",
        canManage: true,
        groupState: {
          calendar: { version: 1, isoDate: "1200-01-01", timeOfDaySeconds: 3600 }
        }
      };
    }
  };
  const commandBus = {
    async request(command, payload) {
      requests.push({ command, payload: clone(payload) });
      return commandResults[requests.length - 1];
    }
  };

  try {
    const service = new CalendarService({ groupContextService, commandBus });
    const dateSnapshot = await service.setDate(1200, 2, 3);
    const timeSnapshot = await service.setTimeOfDaySeconds(86399);

    assert.deepEqual(requests, [
      {
        command: "group.calendar.patch",
        payload: { groupActorId: "group-a", patch: { isoDate: "1200-02-03" } }
      },
      {
        command: "group.calendar.patch",
        payload: { groupActorId: "group-a", patch: { timeOfDaySeconds: 86399 } }
      }
    ]);
    assert.equal(dateSnapshot.isoDate, "1200-02-03");
    assert.equal(dateSnapshot.timeOfDaySeconds, 3600);
    assert.equal(timeSnapshot.isoDate, "1200-01-01");
    assert.equal(timeSnapshot.timeOfDaySeconds, 86399);
  }
  finally {
    globalThis.game = previousGame;
  }
});
