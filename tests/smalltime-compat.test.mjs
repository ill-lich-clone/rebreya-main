import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRebreyaCalendarTimeComponents,
  buildSmallTimeDateDisplay,
  countWorldTimeDayDelta,
  handleSmallTimeWorldTimeUpdate,
  patchSmallTimeCalendarTimeSource,
  patchSmallTimeDateDisplay,
  syncSmallTimeToCalendarTime
} from "../scripts/integrations/smalltime-compat.js";

test("smalltime date display is built from the Rebreya calendar snapshot", () => {
  assert.equal(
    buildSmallTimeDateDisplay({
      weekdayLabel: "Moonday",
      day: 5,
      monthName: "Frostfall",
      year: 1200
    }),
    "Moonday, 5 Frostfall 1200"
  );
});

test("world time day delta counts hour shifts across midnight both ways", () => {
  assert.equal(countWorldTimeDayDelta((24 * 3600), 3600), 1);
  assert.equal(countWorldTimeDayDelta((23 * 3600), -3600), -1);
  assert.equal(countWorldTimeDayDelta((13 * 3600), 3600), 0);
});

test("smalltime updateDate writes the Rebreya date into the SmallTime display", async () => {
  const previousGame = globalThis.game;
  const previousDocument = globalThis.document;
  const previousSmallTimeApp = globalThis.SmallTimeApp;
  const settingsWrites = [];
  const dateElement = { textContent: "" };

  globalThis.game = {
    ready: true,
    user: { isGM: true },
    settings: {
      async set(scope, key, value) {
        settingsWrites.push({ scope, key, value });
      }
    }
  };
  globalThis.document = {
    getElementById(id) {
      return id === "dateDisplay" ? dateElement : null;
    }
  };
  globalThis.SmallTimeApp = {
    updateDate() {
      throw new Error("Original SmallTime updateDate should be replaced.");
    }
  };

  try {
    const patched = patchSmallTimeDateDisplay({
      getCalendarSnapshot() {
        return {
          weekdayLabel: "Moonday",
          day: 5,
          monthName: "Frostfall",
          year: 1200
        };
      }
    });

    assert.equal(patched, true);
    await globalThis.SmallTimeApp.updateDate();

    assert.equal(dateElement.textContent, "Moonday, 5 Frostfall 1200");
    assert.deepEqual(settingsWrites, [{
      scope: "smalltime",
      key: "current-date",
      value: "Moonday, 5 Frostfall 1200"
    }]);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.document = previousDocument;
    globalThis.SmallTimeApp = previousSmallTimeApp;
  }
});

test("smalltime world time updates shift the Rebreya calendar only on the GM client", async () => {
  const previousGame = globalThis.game;
  const calls = [];
  const moduleApi = {
    async setCalendarTimeOfDay(seconds, options) {
      calls.push({ seconds, options });
      return { timeOfDaySeconds: seconds };
    },
    async shiftCalendarDays(days, options) {
      calls.push({ days, options });
      return { daysAdvanced: days };
    }
  };

  try {
    globalThis.game = { user: { isGM: true } };
    await handleSmallTimeWorldTimeUpdate(24 * 3600, 3600, {
      moduleApi,
      refreshSmallTimeDateDisplay: () => calls.push({ refreshed: true })
    });

    globalThis.game = { user: { isGM: false } };
    await handleSmallTimeWorldTimeUpdate(48 * 3600, 3600, {
      moduleApi,
      refreshSmallTimeDateDisplay: () => calls.push({ playerRefresh: true })
    });

    assert.deepEqual(calls, [
      {
        seconds: 0,
        options: {
          reason: "smalltime-world-time"
        }
      },
      {
        days: 1,
        options: {
          processDailyCycles: false,
          reason: "smalltime-world-time"
        }
      },
      { refreshed: true },
      { playerRefresh: true }
    ]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("smalltime asks before consuming supplies when world time advances the date", async () => {
  const previousGame = globalThis.game;
  const calls = [];
  const moduleApi = {
    async setCalendarTimeOfDay(seconds, options) {
      calls.push({ seconds, options });
      return { timeOfDaySeconds: seconds };
    },
    async shiftCalendarDays(days, options) {
      calls.push({ days, options });
      return { daysAdvanced: days };
    }
  };

  try {
    globalThis.game = { user: { isGM: true } };
    const dayDelta = await handleSmallTimeWorldTimeUpdate(24 * 3600, 3600, {
      moduleApi,
      confirmSupplyConsumption: async (days) => {
        calls.push({ confirmedDays: days });
        return true;
      },
      refreshSmallTimeDateDisplay: () => calls.push({ refreshed: true })
    });

    assert.equal(dayDelta, 1);
    assert.deepEqual(calls, [
      {
        seconds: 0,
        options: {
          reason: "smalltime-world-time"
        }
      },
      { confirmedDays: 1 },
      {
        days: 1,
        options: {
          processDailyCycles: true,
          consumeSupplies: true,
          applyEnergy: true,
          processCraft: false,
          reason: "smalltime-world-time"
        }
      },
      { refreshed: true }
    ]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("smalltime world time updates store Rebreya time of day without a day change", async () => {
  const previousGame = globalThis.game;
  const calls = [];
  const moduleApi = {
    async setCalendarTimeOfDay(seconds, options) {
      calls.push({ seconds, options });
      return { timeOfDaySeconds: seconds };
    },
    async shiftCalendarDays(days, options) {
      calls.push({ days, options });
      return { daysAdvanced: days };
    }
  };

  try {
    globalThis.game = { user: { isGM: true } };
    const dayDelta = await handleSmallTimeWorldTimeUpdate((13 * 3600) + (15 * 60), 15 * 60, {
      moduleApi,
      refreshSmallTimeDateDisplay: () => calls.push({ refreshed: true })
    });

    assert.equal(dayDelta, 0);
    assert.deepEqual(calls, [
      {
        seconds: 47700,
        options: {
          reason: "smalltime-world-time"
        }
      },
      { refreshed: true }
    ]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("smalltime can sync its clock to the active Rebreya group time without shifting the Rebreya date", async () => {
  const previousGame = globalThis.game;
  const previousSmallTimeApp = globalThis.SmallTimeApp;
  const calls = [];

  globalThis.game = {
    user: { isGM: true },
    time: {
      worldTime: 23 * 3600,
      advance(deltaSeconds) {
        calls.push({ advanced: deltaSeconds });
        this.worldTime += deltaSeconds;
      }
    }
  };
  globalThis.SmallTimeApp = {
    timeTransition(timeInteger, options) {
      calls.push({ timeInteger, options });
    }
  };

  try {
    await syncSmallTimeToCalendarTime({
      getCalendarSnapshot: () => ({
        timeOfDaySeconds: 3600
      })
    }, {
      refreshSmallTimeDateDisplay: () => calls.push({ refreshed: true })
    });

    const dayDelta = await handleSmallTimeWorldTimeUpdate(3600, -22 * 3600, {
      moduleApi: {
        setCalendarTimeOfDay: async (seconds, options) => calls.push({ seconds, options }),
        shiftCalendarDays: async (days) => calls.push({ days })
      },
      refreshSmallTimeDateDisplay: () => calls.push({ updateRefreshed: true })
    });

    assert.equal(dayDelta, 0);
    assert.deepEqual(calls, [
      { advanced: -22 * 3600 },
      { timeInteger: 60, options: { persistDarkness: false } },
      { refreshed: true },
      {
        seconds: 3600,
        options: {
          reason: "smalltime-world-time"
        }
      },
      { updateRefreshed: true }
    ]);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.SmallTimeApp = previousSmallTimeApp;
  }
});

test("smalltime sync leaves world time untouched when SmallTime is inactive", async () => {
  const previousGame = globalThis.game;
  const calls = [];

  globalThis.game = {
    modules: new Map([["smalltime", { active: false }]]),
    user: { isGM: true },
    time: {
      worldTime: 23 * 3600,
      advance(deltaSeconds) {
        calls.push({ advanced: deltaSeconds });
      }
    }
  };

  try {
    const result = await syncSmallTimeToCalendarTime({
      getCalendarSnapshot: () => ({
        timeOfDaySeconds: 3600
      })
    }, {
      refreshSmallTimeDateDisplay: () => calls.push({ refreshed: true })
    });

    assert.equal(result, false);
    assert.equal(globalThis.game.time.worldTime, 23 * 3600);
    assert.deepEqual(calls, [{ refreshed: true }]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("smalltime calendar adapter maps Rebreya date and time into calendar components", () => {
  const components = buildRebreyaCalendarTimeComponents({
    isoDate: "1200-02-03",
    year: 1200,
    month: 2,
    day: 3,
    timeOfDaySeconds: 3661
  }, {
    years: { yearZero: 0 },
    timeToComponents: () => ({
      year: 999,
      month: 8,
      dayOfMonth: 9,
      hour: 20
    })
  });

  assert.equal(components.year, 1200);
  assert.equal(components.month, 1);
  assert.equal(components.day, 3);
  assert.equal(components.dayOfMonth, 3);
  assert.equal(components.hour, 1);
  assert.equal(components.minute, 1);
  assert.equal(components.second, 1);
});

test("smalltime calendar adapter lets sunrise and sunset read the Rebreya date", () => {
  const previousGame = globalThis.game;
  const calendar = {
    constructor: { name: "CalendarData" },
    years: { yearZero: 0 },
    days: {
      hoursPerDay: 24,
      minutesPerHour: 60,
      secondsPerMinute: 60
    },
    timeToComponents: () => ({
      year: 999,
      month: 0,
      dayOfMonth: 1,
      hour: 0,
      minute: 0,
      second: 0
    }),
    sunrise: (components) => components.month + 5,
    sunset: (components) => components.dayOfMonth + 12
  };

  globalThis.game = {
    time: {
      worldTime: 0,
      calendar
    }
  };

  try {
    const patched = patchSmallTimeCalendarTimeSource({
      getCalendarSnapshot: () => ({
        isoDate: "1200-02-03",
        year: 1200,
        month: 2,
        day: 3,
        timeOfDaySeconds: 3661
      })
    });

    assert.equal(patched, true);
    const components = calendar.timeToComponents(0);
    assert.equal(components.year, 1200);
    assert.equal(components.month, 1);
    assert.equal(calendar.sunrise(components), 6);
    assert.equal(calendar.sunset(components), 15);
  }
  finally {
    globalThis.game = previousGame;
  }
});
