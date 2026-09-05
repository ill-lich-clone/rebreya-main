import test from "node:test";
import assert from "node:assert/strict";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { getActiveGm, isActiveGmClient } from "../scripts/infrastructure/foundry/active-gm.js";
import {
  COMMAND_REQUEST_TYPE,
  COMMAND_RESULT_TYPE,
  MAX_SOCKET_ENVELOPE_BYTES,
  REQUEST_TIMEOUT_MS,
  SOCKET_CHANNEL,
  SocketCommandBus
} from "../scripts/infrastructure/foundry/socket-command-bus.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createUsers(users, activeGmId = null) {
  const collection = new Map(users.map((user) => [String(user.id), user]));
  collection.contents = users;
  collection.activeGM = activeGmId == null ? null : collection.get(String(activeGmId));
  return collection;
}

function createGame({ users, currentUserId, activeGmId = null, emitted = [] }) {
  const userCollection = createUsers(users, activeGmId);
  return {
    user: userCollection.get(String(currentUserId)),
    users: userCollection,
    socket: {
      emit(channel, message) {
        emitted.push({ channel, message });
      }
    }
  };
}

function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  const cleared = [];

  return {
    cleared,
    pending,
    clearTimeoutFn(id) {
      cleared.push(id);
      pending.delete(id);
    },
    setTimeoutFn(callback, milliseconds) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { callback, milliseconds });
      return id;
    }
  };
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("WorldMutationCoordinator serializes one key while allowing another key to proceed", async () => {
  const coordinator = new WorldMutationCoordinator();
  const firstGate = createDeferred();
  const events = [];

  const first = coordinator.run("world", async () => {
    events.push("first:start");
    await firstGate.promise;
    events.push("first:end");
    return "first";
  });
  const second = coordinator.run("world", async () => {
    events.push("second:start");
    return "second";
  });
  const independent = coordinator.run("other", async () => {
    events.push("other:start");
    return "other";
  });

  assert.equal(await independent, "other");
  assert.deepEqual(events, ["first:start", "other:start"]);

  firstGate.resolve();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(events, ["first:start", "other:start", "first:end", "second:start"]);
});

test("WorldMutationCoordinator continues a key queue after an operation rejects", async () => {
  const coordinator = new WorldMutationCoordinator();

  await assert.rejects(
    coordinator.run("world", async () => {
      throw new Error("first failed");
    }),
    /first failed/u
  );

  assert.equal(await coordinator.run("world", async () => "recovered"), "recovered");
});

test("WorldMutationCoordinator reuses in-flight and settled request results exactly once", async () => {
  const coordinator = new WorldMutationCoordinator();
  const gate = createDeferred();
  const originalResult = { revision: 7 };
  let calls = 0;

  const first = coordinator.runIdempotent("world", "request-a", async () => {
    calls += 1;
    await gate.promise;
    return originalResult;
  });
  const inFlightDuplicate = coordinator.runIdempotent("world", "request-a", async () => {
    calls += 1;
    return { revision: 999 };
  });

  gate.resolve();
  assert.strictEqual(await first, originalResult);
  assert.strictEqual(await inFlightDuplicate, originalResult);
  assert.strictEqual(
    await coordinator.runIdempotent("world", "request-a", async () => {
      calls += 1;
      return { revision: 1000 };
    }),
    originalResult
  );
  assert.equal(calls, 1);
});

test("WorldMutationCoordinator reuses a settled rejection without rerunning it", async () => {
  const coordinator = new WorldMutationCoordinator();
  const originalError = new Error("mutation failed");
  let calls = 0;

  await assert.rejects(
    coordinator.runIdempotent("world", "request-failure", async () => {
      calls += 1;
      throw originalError;
    }),
    (error) => error === originalError
  );
  await assert.rejects(
    coordinator.runIdempotent("world", "request-failure", async () => {
      calls += 1;
      return "unexpected";
    }),
    (error) => error === originalError
  );
  assert.equal(calls, 1);
});

test("WorldMutationCoordinator bounds completed results to 256 in insertion order", async () => {
  const coordinator = new WorldMutationCoordinator();
  let calls = 0;

  for (let index = 0; index < 256; index += 1) {
    await coordinator.runIdempotent("world", `request-${index}`, async () => {
      calls += 1;
      return index;
    });
  }

  assert.equal(await coordinator.runIdempotent("world", "request-0", async () => 999), 0);
  await coordinator.runIdempotent("world", "request-256", async () => {
    calls += 1;
    return 256;
  });
  assert.equal(
    await coordinator.runIdempotent("world", "request-0", async () => {
      calls += 1;
      return "rerun";
    }),
    "rerun"
  );
  assert.equal(calls, 258);
});

test("getActiveGm prefers a valid Foundry activeGM and otherwise elects by string id", () => {
  const gmZ = { id: "z-gm", isGM: true, active: true };
  const gmA = { id: "a-gm", isGM: true, active: true };
  const invalidActiveGm = { id: "player", isGM: false, active: true };

  const preferredGame = {
    user: gmA,
    users: createUsers([gmA, gmZ], "z-gm")
  };
  assert.strictEqual(getActiveGm(preferredGame), gmZ);

  const electedUsers = createUsers([gmZ, invalidActiveGm, gmA]);
  electedUsers.activeGM = invalidActiveGm;
  const electedGame = { user: gmZ, users: electedUsers };
  assert.strictEqual(getActiveGm(electedGame), gmA);
  assert.equal(isActiveGmClient(electedGame), false);
  electedGame.user = gmA;
  assert.equal(isActiveGmClient(electedGame), true);
});

test("getActiveGm falls back to the only isolated current GM fixture", () => {
  const currentGm = { id: "fixture-gm", isGM: true, active: true };
  const game = { user: currentGm, users: { contents: [], activeGM: null } };

  assert.strictEqual(getActiveGm(game), currentGm);
  assert.equal(isActiveGmClient(game), true);
});

test("getActiveGm returns null and isActiveGmClient false when no active GM exists", () => {
  const player = { id: "player-a", isGM: false, active: true };
  const inactiveGm = { id: "gm-a", isGM: true, active: false };
  const game = { user: player, users: createUsers([player, inactiveGm]) };

  assert.equal(getActiveGm(game), null);
  assert.equal(isActiveGmClient(game), false);
});

test("SocketCommandBus correlates results by requestId, command, and forUserId", async () => {
  const emitted = [];
  const timers = createFakeTimers();
  const player = { id: "player-a", isGM: false, active: true };
  const gm = { id: "gm-a", isGM: true, active: true };
  const game = createGame({ users: [player, gm], currentUserId: player.id, activeGmId: gm.id, emitted });
  const bus = new SocketCommandBus({
    gameProvider: () => game,
    idFactory: () => "request-a",
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  });

  const pending = bus.request("group.calendar.setDate", { day: 4 });
  assert.deepEqual(emitted, [{
    channel: "module.rebreya-main",
    message: {
      type: "rebreya.command",
      command: "group.calendar.setDate",
      requestId: "request-a",
      senderId: "player-a",
      payload: { day: 4 }
    }
  }]);
  assert.equal(timers.pending.get(1).milliseconds, 10000);
  assert.equal(bus.handleMessage({ type: "unrelated" }), false);

  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  assert.equal(bus.handleMessage({
    type: COMMAND_RESULT_TYPE,
    command: "group.calendar.setTime",
    requestId: "request-a",
    forUserId: "player-a",
    senderId: "gm-a",
    ok: true,
    data: { ignored: "command" }
  }), true);
  assert.equal(bus.handleMessage({
    type: COMMAND_RESULT_TYPE,
    command: "group.calendar.setDate",
    requestId: "request-a",
    forUserId: "player-b",
    senderId: "gm-a",
    ok: true,
    data: { ignored: "user" }
  }), true);
  await flushTasks();
  assert.equal(settled, false);

  assert.equal(bus.handleMessage({
    type: COMMAND_RESULT_TYPE,
    command: "group.calendar.setDate",
    requestId: "request-a",
    forUserId: "player-a",
    senderId: "gm-a",
    ok: true,
    data: { saved: true }
  }), true);
  assert.deepEqual(await pending, { saved: true });
  assert.deepEqual(timers.cleared, [1]);
});

test("SocketCommandBus uses an explicit request id without calling its id factory", async () => {
  const emitted = [];
  const timers = createFakeTimers();
  const player = { id: "player-a", isGM: false, active: true };
  const gm = { id: "gm-a", isGM: true, active: true };
  const game = createGame({ users: [player, gm], currentUserId: player.id, activeGmId: gm.id, emitted });
  let factoryCalls = 0;
  const bus = new SocketCommandBus({
    gameProvider: () => game,
    idFactory: () => {
      factoryCalls += 1;
      return "factory-request";
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  });

  const pending = bus.request(
    "group.calendar.setDate",
    { day: 6 },
    { requestId: "  explicit-request  " }
  );

  assert.equal(factoryCalls, 0);
  assert.equal(emitted[0]?.message?.requestId, "explicit-request");
  assert.equal(bus.handleMessage({
    type: COMMAND_RESULT_TYPE,
    command: "group.calendar.setDate",
    requestId: "explicit-request",
    forUserId: player.id,
    senderId: gm.id,
    ok: true,
    data: "saved"
  }), true);
  assert.equal(await pending, "saved");
});

test("SocketCommandBus rejects a non-string explicit request id", async () => {
  const emitted = [];
  const player = { id: "player-a", isGM: false, active: true };
  const gm = { id: "gm-a", isGM: true, active: true };
  const game = createGame({ users: [player, gm], currentUserId: player.id, activeGmId: gm.id, emitted });
  let factoryCalls = 0;
  const bus = new SocketCommandBus({
    gameProvider: () => game,
    idFactory: () => {
      factoryCalls += 1;
      return "factory-request";
    }
  });

  await assert.rejects(
    bus.request("group.calendar.setDate", { day: 6 }, { requestId: 42 }),
    (error) => error?.code === "invalid-request"
  );
  assert.equal(factoryCalls, 0);
  assert.deepEqual(emitted, []);
});

test("SocketCommandBus ignores malformed correlated errors until a valid failure arrives", async () => {
  const emitted = [];
  const timers = createFakeTimers();
  const player = { id: "player-a", isGM: false, active: true };
  const gm = { id: "gm-a", isGM: true, active: true };
  const game = createGame({ users: [player, gm], currentUserId: player.id, activeGmId: gm.id, emitted });
  const bus = new SocketCommandBus({
    gameProvider: () => game,
    idFactory: () => "malformed-result",
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  });
  const pending = bus.request("group.calendar.setDate", { day: 4 });
  let settledError;
  const observed = pending.catch((error) => {
    settledError = error;
  });
  const correlation = {
    type: COMMAND_RESULT_TYPE,
    command: "group.calendar.setDate",
    requestId: "malformed-result",
    forUserId: player.id,
    senderId: gm.id,
    ok: false
  };

  for (const error of [
    undefined,
    "failure",
    [],
    { code: "", message: "failure" },
    { code: "denied", message: " " }
  ]) {
    assert.equal(bus.handleMessage({ ...correlation, error }), true);
  }
  await flushTasks();
  assert.equal(settledError, undefined);
  assert.deepEqual(timers.cleared, []);
  assert.equal(timers.pending.has(1), true);

  assert.equal(bus.handleMessage({
    ...correlation,
    error: { code: "denied", message: "Request denied" }
  }), true);
  await observed;
  assert.equal(settledError?.code, "denied");
  assert.equal(settledError?.message, "Request denied");
  assert.deepEqual(timers.cleared, [1]);
});

test("SocketCommandBus preserves safe structured command failure details", async () => {
  const emitted = [];
  const timers = createFakeTimers();
  const player = { id: "player-a", isGM: false, active: true };
  const gm = { id: "gm-a", isGM: true, active: true };
  const game = createGame({ users: [player, gm], currentUserId: player.id, activeGmId: gm.id, emitted });
  const bus = new SocketCommandBus({
    gameProvider: () => game,
    idFactory: () => "partial-result",
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  });
  const pending = bus.request("storage.claim.all", {});

  assert.equal(bus.handleMessage({
    type: COMMAND_RESULT_TYPE,
    command: "storage.claim.all",
    requestId: "partial-result",
    forUserId: player.id,
    senderId: gm.id,
    ok: false,
    error: {
      code: "inventory-ingress-partial",
      message: "Inventory ingress stopped after a row failure.",
      details: {
        completedSourceKeys: ["row-1"],
        failedSourceKey: "row-2",
        unprocessedSourceKeys: ["row-3"]
      }
    }
  }), true);

  await assert.rejects(
    pending,
    (error) => error?.code === "inventory-ingress-partial"
      && error?.failedSourceKey === "row-2"
      && JSON.stringify(error?.completedSourceKeys) === JSON.stringify(["row-1"])
  );
});

test("SocketCommandBus times requests out after exactly 10000 ms", async () => {
  const emitted = [];
  const timers = createFakeTimers();
  const player = { id: "player-a", isGM: false, active: true };
  const gm = { id: "gm-a", isGM: true, active: true };
  const game = createGame({ users: [player, gm], currentUserId: player.id, activeGmId: gm.id, emitted });
  const bus = new SocketCommandBus({
    gameProvider: () => game,
    idFactory: () => "request-timeout",
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  });

  const pending = bus.request("group.calendar.setDate", { day: 4 });
  assert.equal(timers.pending.get(1).milliseconds, REQUEST_TIMEOUT_MS);
  timers.pending.get(1).callback();
  await assert.rejects(pending, (error) => error?.code === "request-timeout");
});

test("SocketCommandBus rejects a duplicate outbound pending key without replacing the first request", async () => {
  const emitted = [];
  const timers = createFakeTimers();
  const player = { id: "player-a", isGM: false, active: true };
  const gm = { id: "gm-a", isGM: true, active: true };
  const game = createGame({ users: [player, gm], currentUserId: player.id, activeGmId: gm.id, emitted });
  const bus = new SocketCommandBus({
    gameProvider: () => game,
    idFactory: () => "duplicate-outbound",
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  });

  const first = bus.request("group.calendar.setDate", { day: 4 });
  const duplicate = bus.request("group.calendar.setDate", { day: 5 });

  assert.equal(emitted.length, 1);
  assert.equal(timers.pending.size, 1);
  await assert.rejects(duplicate, (error) => error?.code === "duplicate-request");
  timers.pending.get(1).callback();
  await assert.rejects(first, (error) => error?.code === "request-timeout");
});

test("SocketCommandBus executes a duplicate typed request once and re-emits its settled result", async () => {
  const emitted = [];
  const gm = { id: "gm-a", isGM: true, active: true };
  const player = { id: "player-a", isGM: false, active: true };
  const game = createGame({ users: [gm, player], currentUserId: gm.id, activeGmId: gm.id, emitted });
  const bus = new SocketCommandBus({ gameProvider: () => game });
  let executions = 0;
  bus.register("group.calendar.setDate", {
    validate: (payload) => Number.isInteger(payload?.day),
    authorize: (_payload, context) => context.sender.id === player.id,
    execute: async (payload) => {
      executions += 1;
      return { savedDay: payload.day };
    }
  });
  const request = {
    type: COMMAND_REQUEST_TYPE,
    command: "group.calendar.setDate",
    requestId: "duplicate-a",
    senderId: player.id,
    payload: { day: 8 }
  };

  assert.equal(bus.handleMessage(request), true);
  await flushTasks();
  assert.equal(bus.handleMessage(request), true);
  await flushTasks();
  assert.equal(executions, 1);
  assert.equal(emitted.length, 2);
  assert.deepEqual(emitted[0], emitted[1]);
  assert.deepEqual(emitted[0], {
    channel: SOCKET_CHANNEL,
    message: {
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: player.id,
      senderId: gm.id,
      ok: true,
      data: { savedDay: 8 }
    }
  });
});

test("SocketCommandBus rejects an envelope sender that differs from the transport sender", async () => {
  const emitted = [];
  const gm = { id: "gm-a", isGM: true, active: true };
  const player = { id: "player-a", isGM: false, active: true };
  const game = createGame({ users: [gm, player], currentUserId: gm.id, activeGmId: gm.id, emitted });
  const bus = new SocketCommandBus({ gameProvider: () => game });
  let executions = 0;
  bus.register("world.gmOnlyMutation", {
    authorize: (_payload, context) => context.sender.isGM === true,
    execute: async () => {
      executions += 1;
      return { changed: true };
    }
  });
  const request = {
    type: COMMAND_REQUEST_TYPE,
    command: "world.gmOnlyMutation",
    requestId: "forged-sender-a",
    senderId: gm.id,
    payload: {}
  };

  assert.equal(bus.handleMessage(request, { transportSenderId: player.id }), true);
  await flushTasks();

  assert.equal(executions, 0);
  assert.deepEqual(emitted, [{
    channel: SOCKET_CHANNEL,
    message: {
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: gm.id,
      senderId: gm.id,
      ok: false,
      error: {
        code: "sender-mismatch",
        message: "Socket command sender does not match the authenticated transport sender"
      }
    }
  }]);
});

test("SocketCommandBus emits a correlated unknown-command error only from the active GM", async () => {
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const player = { id: "player-a", isGM: false, active: true };
  const users = [gmB, player, gmA];
  const request = {
    type: COMMAND_REQUEST_TYPE,
    command: "unknown.command",
    requestId: "unknown-a",
    senderId: player.id,
    payload: {}
  };
  const activeEmitted = [];
  const inactiveEmitted = [];
  const playerEmitted = [];
  const activeBus = new SocketCommandBus({
    gameProvider: () => createGame({ users, currentUserId: gmA.id, activeGmId: gmA.id, emitted: activeEmitted })
  });
  const inactiveBus = new SocketCommandBus({
    gameProvider: () => createGame({ users, currentUserId: gmB.id, activeGmId: gmA.id, emitted: inactiveEmitted })
  });
  const playerBus = new SocketCommandBus({
    gameProvider: () => createGame({ users, currentUserId: player.id, activeGmId: gmA.id, emitted: playerEmitted })
  });

  assert.equal(activeBus.handleMessage(request), true);
  assert.equal(inactiveBus.handleMessage(request), true);
  assert.equal(playerBus.handleMessage(request), true);
  await flushTasks();
  assert.equal(inactiveEmitted.length, 0);
  assert.equal(playerEmitted.length, 0);
  assert.deepEqual(activeEmitted, [{
    channel: SOCKET_CHANNEL,
    message: {
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: player.id,
      senderId: gmA.id,
      ok: false,
      error: {
        code: "unknown-command",
        message: "Unknown socket command: unknown.command"
      }
    }
  }]);
});

test("SocketCommandBus never executes handlers on inactive GMs or players", async () => {
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const player = { id: "player-a", isGM: false, active: true };
  const users = [gmB, player, gmA];
  const request = {
    type: COMMAND_REQUEST_TYPE,
    command: "safe.command",
    requestId: "safe-a",
    senderId: player.id,
    payload: {}
  };
  let executions = 0;
  const definition = {
    execute: async () => {
      executions += 1;
      return { ok: true };
    }
  };
  const inactiveBus = new SocketCommandBus({
    gameProvider: () => createGame({ users, currentUserId: gmB.id, activeGmId: gmA.id })
  });
  const playerBus = new SocketCommandBus({
    gameProvider: () => createGame({ users, currentUserId: player.id, activeGmId: gmA.id })
  });
  inactiveBus.register(request.command, definition);
  playerBus.register(request.command, definition);

  assert.equal(inactiveBus.handleMessage(request), true);
  assert.equal(playerBus.handleMessage(request), true);
  assert.equal(executions, 0);
});

test("SocketCommandBus accepts exactly 65536 serialized bytes and rejects larger envelopes", async () => {
  const emitted = [];
  const timers = createFakeTimers();
  const player = { id: "player-a", isGM: false, active: true };
  const gm = { id: "gm-a", isGM: true, active: true };
  const game = createGame({ users: [player, gm], currentUserId: player.id, activeGmId: gm.id, emitted });
  let requestNumber = 0;
  const bus = new SocketCommandBus({
    gameProvider: () => game,
    idFactory: () => `size-${requestNumber += 1}`,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  });
  const baseEnvelope = {
    type: COMMAND_REQUEST_TYPE,
    command: "size.command",
    requestId: "size-1",
    senderId: player.id,
    payload: { text: "" }
  };
  const baseSize = Buffer.byteLength(JSON.stringify(baseEnvelope), "utf8");
  const exactPayload = { text: "x".repeat(MAX_SOCKET_ENVELOPE_BYTES - baseSize) };

  const exactRequest = bus.request("size.command", exactPayload);
  assert.equal(Buffer.byteLength(JSON.stringify(emitted[0].message), "utf8"), 65536);
  assert.equal(bus.handleMessage({
    type: COMMAND_RESULT_TYPE,
    command: "size.command",
    requestId: "size-1",
    forUserId: player.id,
    senderId: gm.id,
    ok: true,
    data: "accepted"
  }), true);
  assert.equal(await exactRequest, "accepted");

  await assert.rejects(
    bus.request("size.command", { text: `${exactPayload.text}x` }),
    (error) => error?.code === "envelope-too-large"
  );
  assert.equal(emitted.length, 1);
});

test("SocketCommandBus rejects oversized incoming requests without executing the handler", async () => {
  const emitted = [];
  const gm = { id: "gm-a", isGM: true, active: true };
  const player = { id: "player-a", isGM: false, active: true };
  const game = createGame({ users: [player, gm], currentUserId: gm.id, activeGmId: gm.id, emitted });
  const bus = new SocketCommandBus({ gameProvider: () => game });
  let executions = 0;
  bus.register("size.command", {
    execute: async () => {
      executions += 1;
      return "unexpected";
    }
  });
  const request = {
    type: COMMAND_REQUEST_TYPE,
    command: "size.command",
    requestId: "incoming-size",
    senderId: player.id,
    payload: { text: "" }
  };
  const baseSize = Buffer.byteLength(JSON.stringify(request), "utf8");
  request.payload.text = "x".repeat((MAX_SOCKET_ENVELOPE_BYTES - baseSize) + 1);

  assert.equal(bus.handleMessage(request), true);
  assert.equal(executions, 0);
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0].message.error, {
    code: "envelope-too-large",
    message: "Socket envelope exceeds 65536 bytes"
  });
  assert.equal(emitted[0].message.requestId, request.requestId);
  assert.equal(emitted[0].message.command, request.command);
  assert.equal(emitted[0].message.forUserId, player.id);
});

test("SocketCommandBus never emits an oversized fallback result with long correlation fields", async () => {
  const emitted = [];
  const gm = { id: "gm-a", isGM: true, active: true };
  const player = { id: "player-a", isGM: false, active: true };
  const game = createGame({ users: [player, gm], currentUserId: gm.id, activeGmId: gm.id, emitted });
  const bus = new SocketCommandBus({ gameProvider: () => game });
  const request = {
    type: COMMAND_REQUEST_TYPE,
    command: "",
    requestId: "long-correlation",
    senderId: player.id,
    payload: {}
  };
  const baseSize = Buffer.byteLength(JSON.stringify(request), "utf8");
  request.command = "c".repeat(MAX_SOCKET_ENVELOPE_BYTES - baseSize);
  assert.equal(Buffer.byteLength(JSON.stringify(request), "utf8"), MAX_SOCKET_ENVELOPE_BYTES);
  bus.register(request.command, {
    execute: async () => ({ text: "x".repeat(MAX_SOCKET_ENVELOPE_BYTES) })
  });

  assert.equal(bus.handleMessage(request), true);
  await flushTasks();

  assert.ok(emitted.every(({ message }) => (
    Buffer.byteLength(JSON.stringify(message), "utf8") <= MAX_SOCKET_ENVELOPE_BYTES
  )));
});
