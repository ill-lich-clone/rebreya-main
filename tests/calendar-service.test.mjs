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
    user: { isGM: true },
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
