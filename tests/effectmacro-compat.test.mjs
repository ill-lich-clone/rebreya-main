import test from "node:test";
import assert from "node:assert/strict";

import { patchEffectMacroCombatHooks } from "../scripts/integrations/effectmacro-compat.js";

let registeredSocketHandler = null;

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
    assert.match(emitted[0][1].requestId, /^effectmacro-/u);
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

test("effectmacro combat socket runs once on the elected active GM", async () => {
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
  const gm1 = { id: "gm-1", isGM: true, active: true };
  const gm2 = { id: "gm-2", isGM: true, active: true };
  const users = new Map([[gm1.id, gm1], [gm2.id, gm2]]);
  users.contents = [gm1, gm2];
  users.activeGM = gm1;
  const game = {
    user: gm2,
    users,
    socket: {
      on(channel, handler) {
        if (channel === "module.rebreya-main") {
          registeredSocketHandler = handler;
        }
      }
    },
    combats: new Map([["combat-1", combat]])
  };
  const restoreGame = installGameStub(game);
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
    assert.equal(typeof registeredSocketHandler, "function");

    const message = {
      type: "effectmacro-update-combat",
      requestId: "effectmacro-request-1",
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
    };

    await registeredSocketHandler(message, "player-1");
    game.user = gm1;
    await registeredSocketHandler(message, "player-1");
    await registeredSocketHandler(message, "player-1");

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

test("effectmacro combat socket rejects an envelope sender mismatch", async () => {
  const combat = {
    id: "combat-sender",
    uuid: "Combat.combat-sender"
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
  const gm = { id: "gm-sender", isGM: true, active: true };
  const users = new Map([[gm.id, gm]]);
  users.contents = [gm];
  users.activeGM = gm;
  const restoreGame = installGameStub({
    user: gm,
    users,
    socket: {
      on() {}
    },
    combats: new Map([[combat.id, combat]])
  });
  const hookEntry = {
    fn: async function updateCombat() {
      const marker = "_executeAppliedEffects";
      if (marker) calls.push(true);
    }
  };

  try {
    patchEffectMacroCombatHooks({ events: { updateCombat: [hookEntry] } });
    assert.equal(typeof registeredSocketHandler, "function");
    await registeredSocketHandler({
      type: "effectmacro-update-combat",
      requestId: "effectmacro-sender-mismatch",
      senderId: "player-claimed",
      payload: {
        combatUuid: combat.uuid,
        combatId: combat.id,
        update: {},
        options: {}
      }
    }, "player-authenticated");

    assert.deepEqual(calls, []);
  }
  finally {
    restoreGame();
    globalThis.foundry = previousFoundry;
  }
});

test("effectmacro compatibility suppresses the local hook on a non-elected GM", async () => {
  const gm1 = { id: "gm-local-1", isGM: true, active: true };
  const gm2 = { id: "gm-local-2", isGM: true, active: true };
  const users = new Map([[gm1.id, gm1], [gm2.id, gm2]]);
  users.contents = [gm1, gm2];
  users.activeGM = gm1;
  const restoreGame = installGameStub({
    user: gm2,
    users,
    socket: { on() {} }
  });
  let calls = 0;
  const hookEntry = {
    fn: async function updateCombat() {
      const marker = "_executeAppliedEffects";
      if (marker) calls += 1;
    }
  };

  try {
    assert.equal(patchEffectMacroCombatHooks({ events: { updateCombat: [hookEntry] } }), 1);
    await hookEntry.fn({ id: "combat-local" }, { turn: 1 }, {});
    assert.equal(calls, 0);
  }
  finally {
    restoreGame();
  }
});
