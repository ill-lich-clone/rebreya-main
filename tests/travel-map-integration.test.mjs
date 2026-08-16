import test from "node:test";
import assert from "node:assert/strict";

test("RebreyaMainModule saves the shared travel speed multiplier and refreshes open apps", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;

  globalThis.Hooks = { once() {}, on() {} };
  globalThis.game = { user: { id: "gm", isGM: true } };
  globalThis.ui = { windows: {} };
  globalThis.foundry = { applications: { instances: new Map() } };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?travel-speed-multiplier=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    const snapshot = { speedMultiplier: 2, speedMph: 20 };
    moduleApi.travelService.setSpeedMultiplier = async (value) => {
      calls.push(["setSpeedMultiplier", value]);
      return snapshot;
    };
    moduleApi.refreshOpenApps = async () => {
      calls.push(["refreshOpenApps"]);
    };

    const result = await moduleApi.setTravelSpeedMultiplier(2);

    assert.equal(result, snapshot);
    assert.deepEqual(calls, [["setSpeedMultiplier", 2], ["refreshOpenApps"]]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.foundry = previousFoundry;
  }
});

test("RebreyaMainModule syncs the active group token after travel route changes", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;

  globalThis.Hooks = {
    once() {},
    on() {}
  };
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true
    }
  };
  globalThis.ui = {
    windows: {}
  };
  globalThis.foundry = {
    applications: {
      instances: new Map()
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?travel-map-sync=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const groupActor = {
      id: "group-a",
      name: "Рассвет порядка 1",
      img: "icons/group.webp"
    };
    const mapPosition = {
      available: true,
      sceneName: "Карта мира",
      sceneX: 120,
      sceneY: 240
    };
    const synced = [];
    moduleApi.travelService.setRoute = async () => ({
      available: true,
      mapPosition
    });
    moduleApi.groupContextService.resolveForCurrentUser = () => ({
      groupActor,
      groupId: groupActor.id
    });
    moduleApi.travelMapService = {
      async syncGroupToken(payload) {
        synced.push(payload);
        return { synced: true };
      }
    };
    let refreshCount = 0;
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };

    await moduleApi.setTravelRoute({
      originCityId: "liara-ken",
      destinationCityId: "stranbu",
      mode: "land"
    });

    assert.deepEqual(synced, [{
      groupActor,
      position: mapPosition
    }]);
    assert.equal(refreshCount, 0);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.foundry = previousFoundry;
  }
});

test("RebreyaMainModule resyncs the current travel token without changing the route", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;

  globalThis.Hooks = { once() {}, on() {} };
  globalThis.game = { user: { id: "gm", isGM: true } };
  globalThis.ui = { windows: {} };
  globalThis.foundry = { applications: { instances: new Map() } };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?travel-map-resync=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const groupActor = {
      id: "group-a",
      name: "Travel Group"
    };
    const mapPosition = {
      available: true,
      sceneName: "World Map",
      sceneX: 120,
      sceneY: 240
    };
    let setRouteCount = 0;
    const synced = [];
    moduleApi.travelService.getSnapshot = async () => ({
      available: true,
      mapPosition
    });
    moduleApi.travelService.setRoute = async () => {
      setRouteCount += 1;
      return {};
    };
    moduleApi.groupContextService.resolveForCurrentUser = () => ({
      groupActor,
      groupId: groupActor.id
    });
    moduleApi.travelMapService = {
      async syncGroupToken(payload) {
        synced.push(payload);
        return { synced: true };
      }
    };

    const result = await moduleApi.syncTravelMapToken();

    assert.equal(result.synced, true);
    assert.equal(setRouteCount, 0);
    assert.deepEqual(synced, [{ groupActor, position: mapPosition }]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.foundry = previousFoundry;
  }
});

test("RebreyaMainModule asks the GM client to sync the travel token for player travel changes", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;
  const emitted = [];

  globalThis.Hooks = {
    once() {},
    on() {}
  };
  globalThis.game = {
    user: {
      id: "player-1",
      isGM: false
    },
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  };
  globalThis.ui = {
    windows: {}
  };
  globalThis.foundry = {
    applications: {
      instances: new Map()
    },
    utils: {
      deepClone(value) {
        return JSON.parse(JSON.stringify(value));
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?travel-map-player-sync=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const groupActor = {
      id: "group-a",
      name: "Рассвет порядка 1",
      img: "icons/group.webp"
    };
    const mapPosition = {
      available: true,
      sceneName: "Карта мира",
      sceneX: 120,
      sceneY: 240
    };
    const directSyncs = [];
    moduleApi.travelService.advanceHours = async () => ({
      available: true,
      mapPosition
    });
    moduleApi.groupContextService.resolveForCurrentUser = () => ({
      groupActor,
      groupId: groupActor.id
    });
    moduleApi.travelMapService = {
      async syncGroupToken(payload) {
        directSyncs.push(payload);
        return { synced: true };
      }
    };
    moduleApi.refreshOpenApps = async () => {};

    await moduleApi.advanceTravelHours(8);

    assert.deepEqual(directSyncs, []);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][0], "module.rebreya-main");
    assert.deepEqual(emitted[0][1], {
      type: "travel-map-sync-request",
      senderId: "player-1",
      groupActorId: "group-a",
      position: mapPosition
    });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.foundry = previousFoundry;
  }
});

test("RebreyaMainModule advances travel without forcing inventory rerender", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;

  globalThis.Hooks = {
    once() {},
    on() {}
  };
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true
    }
  };
  globalThis.ui = {
    windows: {}
  };
  globalThis.foundry = {
    applications: {
      instances: new Map()
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?travel-map-no-refresh=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const groupActor = {
      id: "group-a",
      name: "Рассвет порядка 1",
      img: "icons/group.webp"
    };
    const mapPosition = {
      available: true,
      sceneName: "Карта мира",
      sceneX: 120,
      sceneY: 240
    };
    let refreshCount = 0;
    moduleApi.travelService.advanceHours = async () => ({
      available: true,
      canAdvance: true,
      mapPosition,
      progress: {
        percent: 12,
        remainingMiles: 88,
        remainingHours: 29.33,
        label: "12 / 100 миль"
      }
    });
    moduleApi.groupContextService.resolveForCurrentUser = () => ({
      groupActor,
      groupId: groupActor.id
    });
    moduleApi.travelMapService = {
      async syncGroupToken() {
        return { synced: true };
      }
    };
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };

    const snapshot = await moduleApi.advanceTravelHours(8);

    assert.equal(snapshot.progress.percent, 12);
    assert.equal(refreshCount, 0);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.foundry = previousFoundry;
  }
});

test("RebreyaMainModule clears travel without forcing inventory rerender", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;

  globalThis.Hooks = { once() {}, on() {} };
  globalThis.game = { user: { id: "gm", isGM: true } };
  globalThis.ui = { windows: {} };
  globalThis.foundry = { applications: { instances: new Map() } };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?travel-clear-no-refresh=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const snapshot = {
      available: true,
      originCityId: "",
      destinationCityId: "",
      plan: { available: false }
    };
    let refreshCount = 0;
    moduleApi.travelService.clearRoute = async () => snapshot;
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };

    const result = await moduleApi.clearTravelRoute();

    assert.equal(result, snapshot);
    assert.equal(refreshCount, 0);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.foundry = previousFoundry;
  }
});

test("RebreyaMainModule applies tracked travel time to the calendar", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;

  globalThis.Hooks = {
    once() {},
    on() {}
  };
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true
    },
    modules: {
      get() {
        return { active: false };
      }
    }
  };
  globalThis.ui = {
    windows: {}
  };
  globalThis.foundry = {
    applications: {
      instances: new Map()
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?travel-time-track=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const groupActor = {
      id: "group-a",
      name: "Рассвет порядка 1",
      img: "icons/group.webp"
    };
    const mapPosition = {
      available: true,
      sceneName: "Карта мира",
      sceneX: 120,
      sceneY: 240
    };
    const dayShifts = [];
    const timeUpdates = [];
    moduleApi.travelService.advanceHours = async (hours) => ({
      available: true,
      canAdvance: true,
      canRewind: true,
      mapPosition,
      travelChange: {
        appliedHours: hours
      },
      plan: {
        available: true
      },
      progress: {
        percent: 12,
        remainingMiles: 88,
        remainingHours: 29.33,
        remainingTravelDays: 3.67,
        label: "12 / 100 миль"
      }
    });
    moduleApi.groupContextService.resolveForCurrentUser = () => ({
      groupActor,
      groupId: groupActor.id
    });
    moduleApi.travelMapService = {
      async syncGroupToken() {
        return { synced: true };
      }
    };
    moduleApi.calendarService.getSnapshot = () => ({
      timeOfDaySeconds: 23 * 3600
    });
    moduleApi.shiftCalendarDays = async (days, options) => {
      dayShifts.push({ days, options });
      return {};
    };
    moduleApi.setCalendarTimeOfDay = async (seconds, options) => {
      timeUpdates.push({ seconds, options });
      return { timeOfDaySeconds: seconds };
    };

    await moduleApi.advanceTravelHours(8, { trackTime: true });
    await moduleApi.advanceTravelHours(1, { trackTime: true });

    assert.deepEqual(dayShifts, [{
      days: 1,
      options: {
        processDowntime: false,
        processDailyCycles: false,
        reason: "travel-time",
        refreshApps: false,
        refreshSmallTime: false
      }
    }, {
      days: 1,
      options: {
        processDowntime: false,
        processDailyCycles: false,
        reason: "travel-time",
        refreshApps: false,
        refreshSmallTime: false
      }
    }]);
    assert.deepEqual(timeUpdates, [{
      seconds: 0,
      options: {
        reason: "travel-time",
        refreshApps: false,
        refreshSmallTime: false
      }
    }]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.foundry = previousFoundry;
  }
});

test("RebreyaMainModule consumes transport fuel for the miles actually traveled", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;
  const warnings = [];

  globalThis.Hooks = { once() {}, on() {} };
  globalThis.game = {
    user: { id: "gm", isGM: true, active: true }
  };
  globalThis.ui = {
    windows: {},
    notifications: {
      warn(message) {
        warnings.push(message);
      }
    }
  };
  globalThis.foundry = {
    applications: { instances: new Map() }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?travel-fuel-gm=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    moduleApi.travelService.advanceHours = async () => ({
      available: true,
      mapPosition: { available: false },
      travelChange: {
        groupActorId: "group-a",
        appliedHours: 1,
        appliedMiles: 3
      },
      fuelChange: {
        configured: true,
        required: 3,
        consumed: 1,
        shortage: 2,
        itemName: "Жидкий уголь",
        warning: "Топлива не хватило, но путь продолжен."
      }
    });

    const result = await moduleApi.advanceTravelHours(8);

    assert.equal(result.fuelChange.shortage, 2);
    assert.deepEqual(warnings, ["Топлива не хватило, но путь продолжен."]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.foundry = previousFoundry;
  }
});

test("RebreyaMainModule never issues a separate client-controlled fuel command", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;

  globalThis.Hooks = { once() {}, on() {} };
  globalThis.game = {
    user: { id: "player-1", isGM: false, active: true }
  };
  globalThis.ui = { windows: {} };
  globalThis.foundry = {
    applications: { instances: new Map() }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?travel-fuel-player=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const requests = [];
    moduleApi.travelService.advanceHours = async () => ({
      available: true,
      mapPosition: { available: false },
      travelChange: {
        groupActorId: "group-a",
        appliedHours: 8,
        appliedMiles: 24
      },
      fuelChange: {
        configured: true,
        required: 3,
        consumed: 3,
        shortage: 0,
        itemName: "Жидкий уголь",
        warning: ""
      }
    });
    moduleApi.socketCommandBus.request = async (command, payload) => {
      requests.push({ command, payload });
      return {};
    };

    const result = await moduleApi.advanceTravelHours(8);

    assert.deepEqual(requests, []);
    assert.equal(result.fuelChange.consumed, 3);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.foundry = previousFoundry;
  }
});
