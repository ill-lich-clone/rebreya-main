import assert from "node:assert/strict";
import test from "node:test";

import {
  PrivilegedMutationGateway
} from "../scripts/application/privileged-mutation-gateway.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { getActiveGm, isActiveGmClient } from "../scripts/infrastructure/foundry/active-gm.js";
import { SocketCommandBus } from "../scripts/infrastructure/foundry/socket-command-bus.js";

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

function createGateway({
  game,
  coordinator = new WorldMutationCoordinator(),
  operationId = "operation-a",
  commandBusOptions = {},
  maxTimeoutRetries = 1
}) {
  const commandBus = new SocketCommandBus({
    coordinator,
    gameProvider: () => game,
    ...commandBusOptions
  });
  const gateway = new PrivilegedMutationGateway({
    commandBus,
    coordinator,
    gameProvider: () => game,
    getActiveGm,
    isActiveGmClient,
    operationIdFactory: () => operationId,
    maxTimeoutRetries
  });
  return { commandBus, coordinator, gateway };
}

function createSocketNetwork({ users, activeGmId }) {
  const clients = new Map();
  const messages = [];

  return {
    messages,
    setActiveGm(nextActiveGmId) {
      for (const client of clients.values()) {
        client.game.users.activeGM = client.game.users.get(String(nextActiveGmId)) ?? null;
      }
    },
    createClient(currentUserId, options = {}) {
      const game = createGame({ users, currentUserId, activeGmId });
      game.socket.emit = (channel, message) => {
        messages.push({ channel, message: structuredClone(message), senderId: currentUserId });
        if (options.dropMessage?.(message) === true) {
          return;
        }
        for (const client of clients.values()) {
          client.commandBus.handleMessage(message, { transportSenderId: currentUserId });
        }
      };
      const client = { game, ...createGateway({ game, ...options }) };
      clients.set(currentUserId, client);
      return client;
    }
  };
}

function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    pending,
    clearTimeoutFn(id) {
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

test("active GM executes directly with a stable operation context and cloned payload", async () => {
  const emitted = [];
  const gm = { id: "gm-a", isGM: true, active: true };
  const game = createGame({ users: [gm], currentUserId: gm.id, activeGmId: gm.id, emitted });
  const { gateway } = createGateway({ game });
  const sourcePayload = { patch: { value: 4 } };
  let executionContext;

  gateway.registerCommand("settings.patch", {
    validate: (payload) => Number.isInteger(payload?.patch?.value),
    authorize: (_payload, context) => context.sender.id === gm.id,
    execute: async (payload, context) => {
      executionContext = context;
      return { saved: payload.patch.value };
    }
  });

  const resultPromise = gateway.mutate("settings.patch", sourcePayload);
  sourcePayload.patch.value = 99;

  assert.deepEqual(await resultPromise, { saved: 4 });
  assert.deepEqual(emitted, []);
  assert.equal(executionContext.command, "settings.patch");
  assert.equal(executionContext.operationId, "operation-a");
  assert.equal(executionContext.requestId, "operation-a");
  assert.strictEqual(executionContext.sender, gm);
  assert.equal(executionContext.source, "direct-active-gm");
  assert.equal(typeof executionContext.assertActiveGm, "function");
  assert.equal(Object.isFrozen(executionContext), true);
});

test("inactive GM routes through the typed command and performs no local execution", async () => {
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const network = createSocketNetwork({ users: [gmA, gmB], activeGmId: gmA.id });
  const activeClient = network.createClient(gmA.id);
  const inactiveClient = network.createClient(gmB.id);
  const executions = { active: 0, inactive: 0 };
  let authoritativeContext;

  activeClient.gateway.registerCommand("settings.patch", {
    validate: (payload) => Number.isInteger(payload?.value),
    authorize: (_payload, context) => context.sender.isGM === true,
    execute: async (payload, context) => {
      executions.active += 1;
      authoritativeContext = context;
      return { saved: payload.value };
    }
  });
  inactiveClient.gateway.registerCommand("settings.patch", {
    validate: (payload) => Number.isInteger(payload?.value),
    authorize: (_payload, context) => context.sender.isGM === true,
    execute: async () => {
      executions.inactive += 1;
      return { saved: -1 };
    }
  });

  assert.deepEqual(
    await inactiveClient.gateway.mutate(
      "settings.patch",
      { value: 7 },
      { operationId: "inactive-operation" }
    ),
    { saved: 7 }
  );
  assert.deepEqual(executions, { active: 1, inactive: 0 });
  assert.equal(network.messages.filter(({ message }) => message.type === "rebreya.command").length, 1);
  assert.strictEqual(authoritativeContext.sender, gmB);
  assert.equal(authoritativeContext.source, "typed-command");
  assert.equal(authoritativeContext.operationId, "inactive-operation");
});

test("player is authorized from the authenticated socket sender and never executes locally", async () => {
  const gm = { id: "gm-a", isGM: true, active: true };
  const player = { id: "player-a", isGM: false, active: true };
  const network = createSocketNetwork({ users: [gm, player], activeGmId: gm.id });
  const activeClient = network.createClient(gm.id);
  const playerClient = network.createClient(player.id);
  const executions = { active: 0, player: 0 };
  const definition = (location) => ({
    validate: (payload) => typeof payload?.claimedSenderId === "string",
    authorize: (_payload, context) => context.sender.isGM === true,
    execute: async () => {
      executions[location] += 1;
      return "unexpected";
    }
  });
  activeClient.gateway.registerCommand("settings.gm-only", definition("active"));
  playerClient.gateway.registerCommand("settings.gm-only", definition("player"));

  await assert.rejects(
    playerClient.gateway.mutate(
      "settings.gm-only",
      { claimedSenderId: gm.id },
      { operationId: "player-operation" }
    ),
    (error) => error?.code === "unauthorized"
  );

  assert.deepEqual(executions, { active: 0, player: 0 });
  const result = network.messages.find(({ message }) => (
    message.type === "rebreya.command.result"
    && message.requestId === "player-operation"
  ));
  assert.equal(result?.message?.forUserId, player.id);
  assert.equal(result?.message?.error?.code, "unauthorized");
});

test("timeout retry reuses the operation id and active GM executes once", async () => {
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const timers = createFakeTimers();
  let droppedResults = 0;
  const network = createSocketNetwork({ users: [gmA, gmB], activeGmId: gmA.id });
  const activeClient = network.createClient(gmA.id, {
    dropMessage: (message) => {
      if (message.type === "rebreya.command.result" && droppedResults === 0) {
        droppedResults += 1;
        return true;
      }
      return false;
    }
  });
  const inactiveClient = network.createClient(gmB.id, {
    commandBusOptions: {
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn
    }
  });
  let executions = 0;
  const definition = {
    validate: (payload) => Number.isInteger(payload?.value),
    authorize: (_payload, context) => context.sender.isGM === true,
    execute: async (payload) => {
      executions += 1;
      return { saved: payload.value };
    }
  };
  activeClient.gateway.registerCommand("settings.retry", definition);
  inactiveClient.gateway.registerCommand("settings.retry", definition);

  const resultPromise = inactiveClient.gateway.mutate(
    "settings.retry",
    { value: 11 },
    { operationId: "stable-operation" }
  );
  await flushTasks();
  assert.equal(executions, 1);
  assert.equal(timers.pending.size, 1);

  timers.pending.values().next().value.callback();
  await flushTasks();

  assert.deepEqual(await resultPromise, { saved: 11 });
  const requests = network.messages.filter(({ message }) => message.type === "rebreya.command");
  assert.deepEqual(requests.map(({ message }) => message.requestId), [
    "stable-operation",
    "stable-operation"
  ]);
  assert.equal(executions, 1);
});

test("gateway refuses timeout retry after the elected active GM changes", async () => {
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const timers = createFakeTimers();
  const network = createSocketNetwork({ users: [gmA, gmB], activeGmId: gmA.id });
  const activeClient = network.createClient(gmA.id, {
    dropMessage: (message) => message.type === "rebreya.command.result"
  });
  const inactiveClient = network.createClient(gmB.id, {
    commandBusOptions: {
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn
    }
  });
  let executions = 0;
  const definition = {
    validate: () => true,
    authorize: (_payload, context) => context.sender.isGM === true,
    execute: async () => {
      executions += 1;
      return "committed";
    }
  };
  activeClient.gateway.registerCommand("settings.election", definition);
  inactiveClient.gateway.registerCommand("settings.election", definition);

  const resultPromise = inactiveClient.gateway.mutate(
    "settings.election",
    {},
    { operationId: "election-operation" }
  );
  await flushTasks();
  timers.pending.values().next().value.callback();
  network.setActiveGm(gmB.id);

  await assert.rejects(
    resultPromise,
    (error) => (
      error?.name === "PrivilegedMutationError"
      && error.code === "ambiguous-outcome"
      && error.command === "settings.election"
      && error.operationId === "election-operation"
    )
  );
  const requests = network.messages.filter(({ message }) => message.type === "rebreya.command");
  assert.equal(requests.length, 1);
  assert.equal(executions, 1);
});

test("typed ambiguous outcome retains the original command and operation id", async () => {
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const network = createSocketNetwork({ users: [gmA, gmB], activeGmId: gmA.id });
  const activeClient = network.createClient(gmA.id);
  const inactiveClient = network.createClient(gmB.id);
  let durableWrites = 0;
  const activeDefinition = {
    validate: () => true,
    authorize: (_payload, context) => context.sender.isGM === true,
    execute: async () => {
      durableWrites += 1;
      network.setActiveGm(gmB.id);
      return "written";
    }
  };
  const inactiveDefinition = {
    ...activeDefinition,
    execute: async () => "unexpected-local-write"
  };
  activeClient.gateway.registerCommand("settings.ambiguous", activeDefinition);
  inactiveClient.gateway.registerCommand("settings.ambiguous", inactiveDefinition);

  await assert.rejects(
    inactiveClient.gateway.mutate(
      "settings.ambiguous",
      {},
      { operationId: "ambiguous-operation" }
    ),
    (error) => (
      error?.name === "PrivilegedMutationError"
      && error.code === "ambiguous-outcome"
      && error.command === "settings.ambiguous"
      && error.operationId === "ambiguous-operation"
    )
  );
  assert.equal(durableWrites, 1);
  assert.equal(network.messages.filter(({ message }) => message.type === "rebreya.command").length, 1);
});

test("gateway configuration cannot permit more than one automatic timeout retry", () => {
  const gm = { id: "gm-a", isGM: true, active: true };
  const game = createGame({ users: [gm], currentUserId: gm.id, activeGmId: gm.id });

  assert.throws(
    () => createGateway({ game, maxTimeoutRetries: 2 }),
    /zero or one/u
  );
});

test("repository commit runs only under an inner queue with an active-GM guard", async () => {
  const gm = { id: "gm-a", isGM: true, active: true };
  const game = createGame({ users: [gm], currentUserId: gm.id, activeGmId: gm.id });
  const { gateway } = createGateway({ game });
  let operationCalls = 0;

  assert.throws(
    () => gateway.commit("world", async () => "unexpected"),
    /inner queue key/u
  );
  assert.deepEqual(
    await gateway.commit("setting:groupState", async (context) => {
      operationCalls += 1;
      assert.equal(Object.isFrozen(context), true);
      assert.equal(typeof context.assertActiveGm, "function");
      context.assertActiveGm();
      return { committed: true };
    }),
    { committed: true }
  );
  assert.equal(operationCalls, 1);
});

test("repository commit rejects inactive clients before their operation starts", async () => {
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const game = createGame({ users: [gmA, gmB], currentUserId: gmB.id, activeGmId: gmA.id });
  const { gateway } = createGateway({ game });
  let operationCalls = 0;

  assert.throws(
    () => gateway.commit("setting:groupState", async () => {
      operationCalls += 1;
    }),
    (error) => error?.code === "active-gm-changed"
  );
  assert.equal(operationCalls, 0);
});

test("repository commit keeps a first pre-write guard failure non-ambiguous", async () => {
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const game = createGame({ users: [gmA, gmB], currentUserId: gmA.id, activeGmId: gmA.id });
  const { gateway } = createGateway({ game });
  let durableWrites = 0;

  await assert.rejects(
    gateway.commit("setting:groupState", async ({ assertActiveGm }) => {
      game.users.activeGM = gmB;
      assertActiveGm();
      durableWrites += 1;
    }),
    (error) => error?.code === "active-gm-changed"
  );
  assert.equal(durableWrites, 0);
});

test("command execution preserves a repository pre-write authority failure", async () => {
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const game = createGame({ users: [gmA, gmB], currentUserId: gmA.id, activeGmId: gmA.id });
  const { gateway } = createGateway({ game });
  let durableWrites = 0;
  gateway.registerCommand("settings.pre-write", {
    validate: () => true,
    authorize: () => true,
    execute: () => gateway.commit(
      "setting:groupState",
      async ({ assertActiveGm }) => {
        game.users.activeGM = gmB;
        assertActiveGm();
        durableWrites += 1;
      }
    )
  });

  await assert.rejects(
    gateway.mutate(
      "settings.pre-write",
      {},
      { operationId: "pre-write-operation" }
    ),
    (error) => error?.code === "active-gm-changed"
  );
  assert.equal(durableWrites, 0);
});

test("repository commit maps authority loss after its operation to ambiguous outcome", async () => {
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const game = createGame({ users: [gmA, gmB], currentUserId: gmA.id, activeGmId: gmA.id });
  const { gateway } = createGateway({ game });
  let durableWrites = 0;

  await assert.rejects(
    gateway.commit("setting:groupState", async ({ assertActiveGm }) => {
      assertActiveGm();
      durableWrites += 1;
      game.users.activeGM = gmB;
      assertActiveGm();
      return "written";
    }),
    (error) => error?.name === "PrivilegedMutationError" && error.code === "ambiguous-outcome"
  );
  assert.equal(durableWrites, 1);
});

test("executor guard failure after a privileged phase maps to ambiguous outcome", async () => {
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const game = createGame({ users: [gmA, gmB], currentUserId: gmA.id, activeGmId: gmA.id });
  const { gateway } = createGateway({ game });
  let durableWrites = 0;
  gateway.registerCommand("settings.multi-phase", {
    validate: () => true,
    authorize: () => true,
    execute: async (_payload, { assertActiveGm }) => {
      durableWrites += 1;
      game.users.activeGM = gmB;
      assertActiveGm();
      return "unexpected";
    }
  });

  await assert.rejects(
    gateway.mutate(
      "settings.multi-phase",
      {},
      { operationId: "multi-phase-operation" }
    ),
    (error) => (
      error?.code === "ambiguous-outcome"
      && error.command === "settings.multi-phase"
      && error.operationId === "multi-phase-operation"
    )
  );
  assert.equal(durableWrites, 1);
});
