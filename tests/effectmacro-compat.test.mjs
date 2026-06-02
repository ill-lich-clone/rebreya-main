import test from "node:test";
import assert from "node:assert/strict";

import { patchEffectMacroCombatHooks } from "../scripts/integrations/effectmacro-compat.js";

function installGameStub(game) {
  const previousGame = globalThis.game;
  globalThis.game = game;
  return () => {
    globalThis.game = previousGame;
  };
}

test("effectmacro combat hook does not leave actorless appliedEffects rejections unhandled", async () => {
  const hookEntry = {
    fn: async function updateCombat() {
      throw new TypeError("Cannot read properties of undefined (reading 'appliedEffects')");
    }
  };
  const Hooks = {
    events: {
      updateCombat: [
        hookEntry,
        { fn: () => undefined }
      ]
    }
  };

  assert.equal(patchEffectMacroCombatHooks(Hooks), 1);
  assert.equal(patchEffectMacroCombatHooks(Hooks), 0);
  await assert.doesNotReject(() => hookEntry.fn({}, {}, {}));
});

test("effectmacro combat hook delegates actorless executor failures to the GM socket", async () => {
  const emitted = [];
  const restoreGame = installGameStub({
    user: {
      id: "player-1",
      isGM: false
    },
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  });
  const combat = {
    id: "combat-1",
    uuid: "Combat.combat-1",
    scene: {
      id: "scene-1",
      uuid: "Scene.scene-1"
    }
  };
  const hookEntry = {
    fn: async function updateCombat() {
      const marker = "_executeAppliedEffects";
      if (marker) {
        throw new TypeError("Cannot read properties of undefined (reading 'testUserPermission')");
      }
    }
  };
  const Hooks = {
    events: {
      updateCombat: [hookEntry]
    }
  };

  try {
    assert.equal(patchEffectMacroCombatHooks(Hooks), 1);
    await assert.doesNotReject(() => hookEntry.fn(combat, { turn: 0 }, { "effectmacro.started": false }));

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][0], "module.rebreya-main");
    assert.equal(emitted[0][1].type, "effectmacro-update-combat");
    assert.equal(emitted[0][1].senderId, "player-1");
    assert.deepEqual(emitted[0][1].payload, {
      combatUuid: "Combat.combat-1",
      combatId: "combat-1",
      sceneUuid: "Scene.scene-1",
      sceneId: "scene-1",
      update: {
        turn: 0
      },
      options: {
        "effectmacro.started": false
      }
    });
  }
  finally {
    restoreGame();
  }
});

test("effectmacro combat socket runs the original hook on the GM client", async () => {
  let socketHandler = null;
  const combat = {
    id: "combat-1",
    uuid: "Combat.combat-1"
  };
  const calls = [];
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    utils: {
      fromUuidSync(uuid) {
        return uuid === combat.uuid ? combat : null;
      },
      deepClone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
      }
    }
  };
  const restoreGame = installGameStub({
    user: {
      id: "gm-1",
      isGM: true
    },
    socket: {
      on(channel, handler) {
        if (channel === "module.rebreya-main") {
          socketHandler = handler;
        }
      }
    },
    combats: new Map([["combat-1", combat]])
  });
  const hookEntry = {
    fn: async function updateCombat(combatArg, updateArg, optionsArg) {
      const marker = "_executeAppliedEffects";
      if (marker) {
        calls.push([combatArg, updateArg, optionsArg]);
      }
    }
  };
  const Hooks = {
    events: {
      updateCombat: [hookEntry]
    }
  };

  try {
    assert.equal(patchEffectMacroCombatHooks(Hooks), 1);
    assert.equal(typeof socketHandler, "function");

    await socketHandler({
      type: "effectmacro-update-combat",
      senderId: "player-1",
      payload: {
        combatUuid: "Combat.combat-1",
        combatId: "combat-1",
        update: {
          turn: 1
        },
        options: {
          "effectmacro.started": true
        }
      }
    });

    assert.deepEqual(calls, [[
      combat,
      {
        turn: 1
      },
      {
        "effectmacro.started": true
      }
    ]]);
  }
  finally {
    restoreGame();
    globalThis.foundry = previousFoundry;
  }
});
