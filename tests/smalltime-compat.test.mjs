import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSmallTimeDateDisplay,
  countWorldTimeDayDelta,
  handleSmallTimeWorldTimeUpdate,
  patchSmallTimeDateDisplay
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
