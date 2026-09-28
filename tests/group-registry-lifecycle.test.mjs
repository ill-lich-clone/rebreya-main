import test from "node:test";
import assert from "node:assert/strict";

import {
  pruneMissingRegisteredGroups,
  registerGroupRegistryLifecycleHooks
} from "../scripts/integrations/group-registry-lifecycle.js";

function createHooks() {
  const listeners = new Map();
  return {
    listeners,
    on(name, callback) {
      listeners.set(name, callback);
      return name;
    }
  };
}

test("ready reconciliation prunes missing registered Group Actors only on the active GM", async () => {
  const calls = [];
  const groupContextService = {
    async pruneMissingGroups() {
      calls.push("prune");
      return { removedGroupActorIds: ["group-missing"] };
    }
  };

  assert.deepEqual(await pruneMissingRegisteredGroups(groupContextService, {
    gameProvider: () => ({ user: { isGM: true } }),
    isActiveGmClient: () => true
  }), { removedGroupActorIds: ["group-missing"] });
  assert.equal(await pruneMissingRegisteredGroups(groupContextService, {
    gameProvider: () => ({ user: { isGM: true } }),
    isActiveGmClient: () => false
  }), null);
  assert.deepEqual(calls, ["prune"]);
});

test("deleting a world Group Actor schedules registry reconciliation", async () => {
  const hooks = createHooks();
  const calls = [];
  const refreshes = [];
  registerGroupRegistryLifecycleHooks({
    hooks,
    groupContextService: {
      async pruneMissingGroups() {
        calls.push("prune");
        return { removedGroupActorIds: ["group-a"] };
      }
    },
    gameProvider: () => ({ user: { isGM: true } }),
    isActiveGmClient: () => true,
    schedule: operation => operation(),
    afterPrune: result => refreshes.push(result)
  });

  await hooks.listeners.get("deleteActor")({ id: "character-a", type: "character" });
  await hooks.listeners.get("deleteActor")({ id: "group-a", type: "group" });

  assert.deepEqual(calls, ["prune"]);
  assert.deepEqual(refreshes, [{ removedGroupActorIds: ["group-a"] }]);
});
