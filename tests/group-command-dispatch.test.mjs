import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../scripts/constants.js";
import {
  COMMAND_REQUEST_TYPE,
  COMMAND_RESULT_TYPE,
  SOCKET_CHANNEL
} from "../scripts/infrastructure/foundry/socket-command-bus.js";
import { normalizeTravelState } from "../scripts/data/travel-service.js";
import { requestSettingsUpdate } from "../scripts/legacy/settings-socket-relay.js";

const originalHooks = globalThis.Hooks;
globalThis.Hooks = { once() {}, on() {} };
const { RebreyaMainModule } = await import(`../scripts/main.js?group-command-dispatch=${Date.now()}`);
if (originalHooks === undefined) {
  delete globalThis.Hooks;
}
else {
  globalThis.Hooks = originalHooks;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createUsers(users, activeGmId) {
  const collection = new Map(users.map((user) => [String(user.id), user]));
  collection.contents = users;
  collection.activeGM = collection.get(String(activeGmId)) ?? null;
  return collection;
}

function createCharacter(id, ownerId) {
  return {
    id,
    type: "character",
    ownership: { [ownerId]: 3 }
  };
}

function createGroup(id, members = []) {
  return {
    id,
    type: "group",
    system: { members: members.map((actor) => ({ actor })) },
    getFlag(moduleId, key) {
      return moduleId === MODULE_ID && key === REBREYA_GROUP_FLAGS.MANAGED ? true : undefined;
    }
  };
}

function installFixture({ currentUserId = "gm-a" } = {}) {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  const previousUi = globalThis.ui;
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const playerA = { id: "player-a", isGM: false, active: true };
  const playerB = { id: "player-b", isGM: false, active: true };
  const memberA = createCharacter("character-a", playerA.id);
  const groupA = createGroup("group-a", [memberA]);
  const users = createUsers([gmA, gmB, playerA, playerB], gmA.id);
  const actors = [groupA, memberA];
  const emitted = [];
  const writes = [];
  const store = {
    [SETTINGS_KEYS.GROUP_STATE]: {
      version: 1,
      activeGroupActorId: groupA.id,
      groupsById: {
        [groupA.id]: {
          version: 1,
          groupActorId: groupA.id,
          calendar: { version: 1, isoDate: "1200-01-01", timeOfDaySeconds: 3600 },
          travelState: { version: 1, originCityId: "old", destinationCityId: "", mode: "land", traveledMiles: 2 },
          traderState: { retained: "yes" },
          questState: { unlocksByQuestId: { quest: true } }
        }
      }
    },
    [SETTINGS_KEYS.CALENDAR_STATE]: { version: 1, isoDate: "1300-01-01", timeOfDaySeconds: 0 },
    [SETTINGS_KEYS.COSMOLOGY_STATE]: { version: 1, mechanusEnabled: false, retained: "yes" }
  };

  globalThis.foundry = {
    utils: {
      deepClone: clone,
      mergeObject: (base, update) => ({ ...clone(base), ...clone(update) })
    }
  };
  globalThis.ui = { notifications: {} };
  globalThis.game = {
    user: users.get(currentUserId),
    users,
    actors: {
      contents: actors,
      get: (actorId) => actors.find((actor) => actor.id === actorId) ?? null
    },
    settings: {
      settings: new Map([
        [`${MODULE_ID}.${SETTINGS_KEYS.GROUP_STATE}`, { scope: "world" }],
        [`${MODULE_ID}.${SETTINGS_KEYS.COSMOLOGY_STATE}`, { scope: "world" }]
      ]),
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        return clone(store[key]);
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        writes.push({ key, value: clone(value) });
        store[key] = clone(value);
        return value;
      }
    },
    socket: {
      emit(channel, message) {
        emitted.push({ channel, message: clone(message) });
      }
    }
  };

  return {
    emitted,
    groupA,
    memberA,
    store,
    users: { gmA, gmB, playerA, playerB },
    writes,
    restore() {
      globalThis.game = previousGame;
      globalThis.foundry = previousFoundry;
      globalThis.ui = previousUi;
    }
  };
}

function commandRequest(command, senderId, payload, requestId = `${command}-request`) {
  return {
    type: COMMAND_REQUEST_TYPE,
    command,
    requestId,
    senderId,
    payload
  };
}

async function flushCommands() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function resultFor(fixture, requestId) {
  return fixture.emitted
    .map((entry) => entry.message)
    .find((message) => message.type === COMMAND_RESULT_TYPE && message.requestId === requestId);
}

test("RebreyaMainModule dispatches an authorized strict group.calendar.patch command", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const request = commandRequest(
      "group.calendar.patch",
      fixture.users.playerA.id,
      { groupActorId: fixture.groupA.id, patch: { isoDate: "1200-02-03" } },
      "calendar-valid"
    );

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.equal(fixture.store[SETTINGS_KEYS.GROUP_STATE].groupsById[fixture.groupA.id].calendar.isoDate, "1200-02-03");
    assert.equal(fixture.store[SETTINGS_KEYS.GROUP_STATE].groupsById[fixture.groupA.id].calendar.timeOfDaySeconds, 3600);
    assert.deepEqual(resultFor(fixture, request.requestId), {
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: fixture.users.playerA.id,
      senderId: fixture.users.gmA.id,
      ok: true,
      data: { version: 1, isoDate: "1200-02-03", timeOfDaySeconds: 3600 }
    });
  }
  finally {
    fixture.restore();
  }
});

test("group.calendar.patch accepts valid five- and six-digit calendar years", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const cases = [
      ["calendar-year-10000", "10000-02-03"],
      ["calendar-year-100000", "100000-02-03"]
    ];

    for (const [requestId, isoDate] of cases) {
      await moduleApi.handleSocketMessage(commandRequest(
        "group.calendar.patch",
        fixture.users.playerA.id,
        { groupActorId: fixture.groupA.id, patch: { isoDate } },
        requestId
      ));
    }
    await flushCommands();

    for (const [requestId, isoDate] of cases) {
      assert.equal(resultFor(fixture, requestId)?.ok, true);
      assert.equal(resultFor(fixture, requestId)?.data?.isoDate, isoDate);
    }
    assert.equal(
      fixture.store[SETTINGS_KEYS.GROUP_STATE].groupsById[fixture.groupA.id].calendar.isoDate,
      "100000-02-03"
    );
  }
  finally {
    fixture.restore();
  }
});

test("group.calendar.patch rejects invalid shapes and a sender outside the requested group", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const cases = [
      ["empty", fixture.users.playerA.id, { groupActorId: fixture.groupA.id, patch: {} }, "invalid-payload"],
      ["extra", fixture.users.playerA.id, { groupActorId: fixture.groupA.id, patch: { isoDate: "1200-02-03", extra: true } }, "invalid-payload"],
      ["date", fixture.users.playerA.id, { groupActorId: fixture.groupA.id, patch: { isoDate: "1200-02-30" } }, "invalid-payload"],
      ["time", fixture.users.playerA.id, { groupActorId: fixture.groupA.id, patch: { timeOfDaySeconds: 86400 } }, "invalid-payload"],
      ["owner", fixture.users.playerB.id, { groupActorId: fixture.groupA.id, patch: { isoDate: "1200-02-03" } }, "unauthorized"]
    ];

    for (const [requestId, senderId, payload] of cases) {
      await moduleApi.handleSocketMessage(commandRequest("group.calendar.patch", senderId, payload, requestId));
    }
    await flushCommands();

    for (const [requestId, , , errorCode] of cases) {
      assert.equal(resultFor(fixture, requestId)?.ok, false);
      assert.equal(resultFor(fixture, requestId)?.error?.code, errorCode);
    }
    assert.equal(fixture.writes.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("group.travel.replaceState normalizes input and replaces only travelState", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const travelState = {
      originCityId: " city-a ",
      destinationCityId: "city-b",
      mode: "unsupported",
      traveledMiles: -5,
      ignored: true
    };
    const request = commandRequest(
      "group.travel.replaceState",
      fixture.users.playerA.id,
      { groupActorId: fixture.groupA.id, travelState },
      "travel-valid"
    );

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    const groupState = fixture.store[SETTINGS_KEYS.GROUP_STATE].groupsById[fixture.groupA.id];
    assert.deepEqual(groupState.travelState, normalizeTravelState(travelState));
    assert.deepEqual(groupState.traderState, { retained: "yes" });
    assert.deepEqual(resultFor(fixture, request.requestId)?.data, normalizeTravelState(travelState));

    const invalid = commandRequest(
      "group.travel.replaceState",
      fixture.users.playerA.id,
      { groupActorId: fixture.groupA.id, travelState, extra: true },
      "travel-extra"
    );
    await moduleApi.handleSocketMessage(invalid);
    await flushCommands();
    assert.equal(resultFor(fixture, invalid.requestId)?.error?.code, "invalid-payload");
  }
  finally {
    fixture.restore();
  }
});

test("cosmology.setMechanus accepts only an exact boolean payload from a GM sender", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const valid = commandRequest(
      "cosmology.setMechanus",
      fixture.users.gmB.id,
      { enabled: true },
      "mechanus-valid"
    );
    await moduleApi.handleSocketMessage(valid);
    await flushCommands();
    assert.deepEqual(fixture.store[SETTINGS_KEYS.COSMOLOGY_STATE], {
      version: 1,
      mechanusEnabled: true,
      retained: "yes"
    });
    assert.equal(resultFor(fixture, valid.requestId)?.ok, true);

    const unauthorized = commandRequest(
      "cosmology.setMechanus",
      fixture.users.playerA.id,
      { enabled: false },
      "mechanus-player"
    );
    const invalid = commandRequest(
      "cosmology.setMechanus",
      fixture.users.gmB.id,
      { enabled: false, extra: true },
      "mechanus-extra"
    );
    await moduleApi.handleSocketMessage(unauthorized);
    await moduleApi.handleSocketMessage(invalid);
    await flushCommands();
    assert.equal(resultFor(fixture, unauthorized.requestId)?.error?.code, "unauthorized");
    assert.equal(resultFor(fixture, invalid.requestId)?.error?.code, "invalid-payload");
  }
  finally {
    fixture.restore();
  }
});

test("RebreyaMainModule rejects an unknown typed command before legacy dispatch", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const request = commandRequest("unknown.command", fixture.users.playerA.id, {}, "unknown");
    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.deepEqual(resultFor(fixture, request.requestId), {
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: fixture.users.playerA.id,
      senderId: fixture.users.gmA.id,
      ok: false,
      error: {
        code: "unknown-command",
        message: "Unknown socket command: unknown.command"
      }
    });
    assert.equal(fixture.emitted.every((entry) => entry.channel === SOCKET_CHANNEL), true);
  }
  finally {
    fixture.restore();
  }
});

test("inactive clients ignore legacy setSetting messages", async () => {
  const fixture = installFixture({ currentUserId: "gm-b" });
  try {
    const moduleApi = new RebreyaMainModule();
    await moduleApi.handleSocketMessage({
      type: "setSetting",
      key: SETTINGS_KEYS.GROUP_STATE,
      data: { version: 1, groupsById: {} },
      senderId: fixture.users.playerA.id,
      requestId: "legacy-inactive"
    });

    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.emitted.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("an inactive GM routes setMechanusEnabled through the typed command result", async () => {
  const fixture = installFixture({ currentUserId: "gm-b" });
  try {
    const moduleApi = new RebreyaMainModule();
    let refreshCount = 0;
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };

    const pending = moduleApi.setMechanusEnabled(true);
    const request = fixture.emitted[0]?.message;
    assert.deepEqual(request, {
      type: COMMAND_REQUEST_TYPE,
      command: "cosmology.setMechanus",
      requestId: request?.requestId,
      senderId: fixture.users.gmB.id,
      payload: { enabled: true }
    });
    await moduleApi.handleSocketMessage({
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: fixture.users.gmB.id,
      senderId: fixture.users.gmA.id,
      ok: true,
      data: { version: 1, mechanusEnabled: true, retained: "yes" }
    });

    assert.deepEqual(await pending, { version: 1, mechanusEnabled: true, retained: "yes" });
    assert.equal(fixture.writes.length, 0);
    assert.equal(refreshCount, 1);
  }
  finally {
    fixture.restore();
  }
});

test("legacy requestSettingsUpdate rejects world writes locally for compatibility callers", async () => {
  const fixture = installFixture();
  try {
    await assert.rejects(
      requestSettingsUpdate(SETTINGS_KEYS.GROUP_STATE, { version: 1, groupsById: {} }),
      (error) => error?.code === "raw-setting-disabled" && error?.message === "raw-setting-disabled"
    );
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.emitted.length, 0);
  }
  finally {
    fixture.restore();
  }
});
