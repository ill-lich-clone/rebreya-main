import test from "node:test";
import assert from "node:assert/strict";

import { registerTravelMapHooks } from "../scripts/integrations/travel-map-hooks.js";

test("travel map canvas hook retries a deferred token sync only on the active GM", async () => {
  const listeners = new Map();
  const hooks = {
    on(name, listener) {
      listeners.set(name, listener);
    }
  };
  const activeGm = {
    id: "gm-1",
    isGM: true,
    active: true
  };
  let currentUser = {
    id: "player-1",
    isGM: false,
    active: true
  };
  const game = {
    get user() {
      return currentUser;
    },
    users: {
      activeGM: activeGm
    }
  };
  let syncCount = 0;
  const moduleApi = {
    async syncTravelMapToken() {
      syncCount += 1;
    }
  };

  const registered = registerTravelMapHooks(moduleApi, {
    Hooks: hooks,
    gameProvider: () => game
  });

  assert.equal(registered, true);
  listeners.get("canvasReady")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(syncCount, 0);

  currentUser = activeGm;
  listeners.get("canvasReady")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(syncCount, 1);
});
