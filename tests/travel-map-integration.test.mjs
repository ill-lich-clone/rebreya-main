import test from "node:test";
import assert from "node:assert/strict";

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
    moduleApi.refreshOpenApps = async () => {};

    await moduleApi.setTravelRoute({
      originCityId: "liara-ken",
      destinationCityId: "stranbu",
      mode: "land"
    });

    assert.deepEqual(synced, [{
      groupActor,
      position: mapPosition
    }]);
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
