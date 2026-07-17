import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_COMPLETED_REACTION_RESULTS,
  REACTION_PROMPT_EVENT,
  REACTION_PROMPT_RESULT_EVENT,
  ReactionQueueService
} from "../scripts/combat/reaction-queue-service.js";

function candidate(id) {
  return {
    actorUuid: `Actor.${id}`,
    tokenUuid: `Scene.scene-1.Token.${id}`,
    itemUuid: `Actor.${id}.Item.reaction`
  };
}

test("reaction queue initialization is explicit and idempotent", async () => {
  const queue = new ReactionQueueService({}, { isCoordinator: () => true });

  assert.strictEqual(await queue.initialize(), queue);
  assert.strictEqual(await queue.initialize(), queue);
});

test("standalone triggered decisions also expire after exactly ten seconds", async () => {
  const gmUser = { id: "gm", isGM: true, active: true };
  const users = [gmUser];
  users.activeGM = gmUser;
  let timeoutCallback;
  let timeoutDelay;
  const queue = new ReactionQueueService({}, {
    gameProvider: () => ({ user: gmUser, users }),
    promptRenderer: () => new Promise(() => {}),
    setTimeoutFn: (callback, delay) => {
      timeoutCallback = callback;
      timeoutDelay = delay;
      return "standalone-timeout";
    },
    clearTimeoutFn: () => undefined
  });

  const pending = queue.promptDecision({
    candidate: { ownerUserIds: [gmUser.id] },
    prompt: { title: "Fire Rune", body: "Use it?" }
  });
  await Promise.resolve();
  assert.equal(timeoutDelay, 10_000);
  timeoutCallback();
  assert.deepEqual(await pending, { accepted: false, reason: "timeout" });
});

test("reaction queue prompts candidates in current combat turn order", async () => {
  const prompted = [];
  const high = candidate("high");
  const middle = candidate("middle");
  const low = candidate("low");
  const combat = {
    started: true,
    turns: [
      { actor: { uuid: high.actorUuid }, token: { uuid: high.tokenUuid } },
      { actor: { uuid: middle.actorUuid }, token: { uuid: middle.tokenUuid } },
      { actor: { uuid: low.actorUuid }, token: { uuid: low.tokenUuid } }
    ]
  };
  const queue = new ReactionQueueService({}, {
    combatProvider: () => combat,
    isCoordinator: () => true,
    promptCandidate: async ({ candidate: current }) => {
      prompted.push(current.actorUuid);
      return { accepted: false, reason: "declined" };
    }
  });
  queue.registerType("test-reaction", {
    listCandidates: () => [low, high, middle],
    isTriggerValid: () => true,
    revalidateCandidate: () => true,
    buildPrompt: () => ({ title: "Reaction", body: "React?" })
  });

  const result = await queue.resolve({
    triggerId: "workflow-1:test-reaction",
    kind: "test-reaction",
    workflowId: "workflow-1",
    context: {}
  });

  assert.deepEqual(prompted, [high.actorUuid, middle.actorUuid, low.actorUuid]);
  assert.equal(result.status, "completed");
  assert.equal(result.accepted.length, 0);
});

test("reaction queue shuffles candidates once outside combat", async () => {
  const prompted = [];
  let randomCalls = 0;
  const candidates = [candidate("first"), candidate("second"), candidate("third")];
  const queue = new ReactionQueueService({}, {
    combatProvider: () => null,
    isCoordinator: () => true,
    random: () => {
      randomCalls += 1;
      return 0;
    },
    promptCandidate: async ({ candidate: current }) => {
      prompted.push(current.actorUuid);
      return { accepted: false };
    }
  });
  queue.registerType("test-reaction", {
    listCandidates: () => candidates,
    isTriggerValid: () => true,
    revalidateCandidate: () => true,
    buildPrompt: () => ({})
  });

  await queue.resolve({ triggerId: "outside-combat", kind: "test-reaction" });

  assert.deepEqual(prompted, [
    candidates[1].actorUuid,
    candidates[2].actorUuid,
    candidates[0].actorUuid
  ]);
  assert.equal(randomCalls, 2);
});

test("reaction queue stops after an accepted reaction removes the trigger", async () => {
  const first = candidate("first");
  const second = candidate("second");
  const prompted = [];
  const payments = [];
  const effects = [];
  const reactions = [];
  let triggerValid = true;
  const queue = new ReactionQueueService({
    combatAttackService: {
      consumeReaction: async (actor, options) => {
        reactions.push({ actor, options });
        return { consumed: true };
      }
    }
  }, {
    actorResolver: (uuid) => ({ uuid }),
    combatProvider: () => ({
      started: true,
      turns: [
        { actor: { uuid: first.actorUuid } },
        { actor: { uuid: second.actorUuid } }
      ]
    }),
    isCoordinator: () => true,
    promptCandidate: async ({ candidate: current }) => {
      prompted.push(current.actorUuid);
      return { accepted: true };
    }
  });
  queue.registerType("counter", {
    listCandidates: () => [first, second],
    isTriggerValid: () => triggerValid,
    revalidateCandidate: () => true,
    buildPrompt: () => ({}),
    pay: async (current) => {
      payments.push(current.actorUuid);
      return { paid: true };
    },
    apply: async (current) => {
      effects.push(current.actorUuid);
      triggerValid = false;
      return { applied: true };
    }
  });

  const result = await queue.resolve({ triggerId: "counter-chain", kind: "counter" });

  assert.deepEqual(prompted, [first.actorUuid]);
  assert.deepEqual(payments, [first.actorUuid]);
  assert.deepEqual(effects, [first.actorUuid]);
  assert.deepEqual(reactions.map((entry) => entry.actor.uuid), [first.actorUuid]);
  assert.equal(result.status, "invalidated");
  assert.equal(result.accepted.length, 1);
});

test("reaction queue coalesces duplicate in-flight trigger ids", async () => {
  const reactor = candidate("reactor");
  let promptCalls = 0;
  let releasePrompt;
  const promptResult = new Promise((resolve) => {
    releasePrompt = resolve;
  });
  const queue = new ReactionQueueService({}, {
    combatProvider: () => ({
      started: true,
      turns: [{ actor: { uuid: reactor.actorUuid } }]
    }),
    isCoordinator: () => true,
    promptCandidate: () => {
      promptCalls += 1;
      return promptResult;
    }
  });
  queue.registerType("guard", {
    listCandidates: () => [reactor],
    isTriggerValid: () => true,
    revalidateCandidate: () => true,
    buildPrompt: () => ({})
  });
  const request = { triggerId: "same-trigger", kind: "guard" };

  const first = queue.resolve(request);
  const duplicate = queue.resolve(request);

  assert.strictEqual(duplicate, first);
  releasePrompt({ accepted: false });
  await Promise.all([first, duplicate]);
  assert.equal(promptCalls, 1);
});

test("reaction queue declines after exactly ten seconds without spending anything", async () => {
  const reactor = candidate("slow-reactor");
  let timeoutCallback;
  let timeoutDelay;
  let payCalls = 0;
  let reactionCalls = 0;
  const queue = new ReactionQueueService({
    combatAttackService: {
      consumeReaction: async () => {
        reactionCalls += 1;
        return { consumed: true };
      }
    }
  }, {
    combatProvider: () => ({
      started: true,
      turns: [{ actor: { uuid: reactor.actorUuid } }]
    }),
    isCoordinator: () => true,
    setTimeoutFn: (callback, delay) => {
      timeoutCallback = callback;
      timeoutDelay = delay;
      return "reaction-timeout";
    },
    clearTimeoutFn: () => undefined,
    promptCandidate: () => new Promise(() => undefined)
  });
  queue.registerType("slow", {
    listCandidates: () => [reactor],
    isTriggerValid: () => true,
    revalidateCandidate: () => true,
    buildPrompt: () => ({}),
    pay: async () => {
      payCalls += 1;
      return { paid: true };
    }
  });

  const pending = queue.resolve({ triggerId: "slow-trigger", kind: "slow" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(timeoutDelay, 10_000);
  timeoutCallback();
  const result = await pending;
  assert.equal(result.status, "completed");
  assert.equal(result.accepted.length, 0);
  assert.equal(payCalls, 0);
  assert.equal(reactionCalls, 0);
});

test("reaction queue reuses completed trigger results only within the bounded ttl", async () => {
  const reactor = candidate("cached-reactor");
  let now = 1_000;
  let promptCalls = 0;
  const queue = new ReactionQueueService({}, {
    combatProvider: () => ({
      started: true,
      turns: [{ actor: { uuid: reactor.actorUuid } }]
    }),
    isCoordinator: () => true,
    now: () => now,
    promptCandidate: async () => {
      promptCalls += 1;
      return { accepted: false };
    }
  });
  queue.registerType("cached", {
    listCandidates: () => [reactor],
    isTriggerValid: () => true,
    revalidateCandidate: () => true,
    buildPrompt: () => ({})
  });
  const request = { triggerId: "cached-trigger", kind: "cached" };

  const first = await queue.resolve(request);
  const cached = await queue.resolve(request);
  assert.deepEqual(cached, first);
  assert.equal(promptCalls, 1);

  now += 60_001;
  await queue.resolve(request);
  assert.equal(promptCalls, 2);
});

test("reaction queue bounds and prunes completed trigger results", async () => {
  let now = 5_000;
  const queue = new ReactionQueueService({}, {
    isCoordinator: () => true,
    now: () => now
  });
  queue.registerType("empty", {
    listCandidates: () => [],
    isTriggerValid: () => true
  });

  for (let index = 0; index < MAX_COMPLETED_REACTION_RESULTS + 40; index += 1) {
    await queue.resolve({ triggerId: `bounded-${index}`, kind: "empty" });
  }
  assert.equal(queue._completed.size, MAX_COMPLETED_REACTION_RESULTS);

  now += 60_001;
  await queue.resolve({ triggerId: "after-ttl", kind: "empty" });
  assert.equal(queue._completed.size, 1);
});

test("one reaction queue keeps at most one candidate timer active", async () => {
  const candidates = [candidate("timer-a"), candidate("timer-b"), candidate("timer-c")];
  let activeTimers = 0;
  let maximumActiveTimers = 0;
  let timerSequence = 0;
  const queue = new ReactionQueueService({}, {
    isCoordinator: () => true,
    promptCandidate: async () => ({ accepted: false }),
    setTimeoutFn: () => {
      activeTimers += 1;
      maximumActiveTimers = Math.max(maximumActiveTimers, activeTimers);
      timerSequence += 1;
      return timerSequence;
    },
    clearTimeoutFn: () => {
      activeTimers -= 1;
    }
  });
  queue.registerType("timers", {
    listCandidates: () => candidates,
    isTriggerValid: () => true,
    revalidateCandidate: () => true,
    buildPrompt: () => ({})
  });

  await queue.resolve({ triggerId: "timer-trigger", kind: "timers" });

  assert.equal(maximumActiveTimers, 1);
  assert.equal(activeTimers, 0);
});

test("reaction queue releases a failed provider and advances when rollback also fails", async () => {
  const broken = candidate("broken");
  const healthy = candidate("healthy");
  const prompted = [];
  const reactions = [];
  const queue = new ReactionQueueService({
    combatAttackService: {
      consumeReaction: async (actor) => {
        reactions.push(actor.uuid);
        return { consumed: true };
      }
    }
  }, {
    actorResolver: (uuid) => ({ uuid }),
    combatProvider: () => ({
      started: true,
      turns: [
        { actor: { uuid: broken.actorUuid } },
        { actor: { uuid: healthy.actorUuid } }
      ]
    }),
    isCoordinator: () => true,
    promptCandidate: async ({ candidate: current }) => {
      prompted.push(current.actorUuid);
      return { accepted: true };
    }
  });
  queue.registerType("durable", {
    listCandidates: () => [broken, healthy],
    isTriggerValid: () => true,
    revalidateCandidate: () => true,
    buildPrompt: () => ({}),
    pay: async () => ({ paid: true }),
    apply: async (current) => {
      if (current.actorUuid === broken.actorUuid) {
        throw new Error("provider failed");
      }
      return { applied: true };
    },
    rollback: async (current) => {
      if (current.actorUuid === broken.actorUuid) {
        throw new Error("rollback failed");
      }
    }
  });

  const result = await queue.resolve({ triggerId: "durable-trigger", kind: "durable" });

  assert.deepEqual(prompted, [broken.actorUuid, healthy.actorUuid]);
  assert.deepEqual(reactions, [healthy.actorUuid]);
  assert.equal(result.status, "completed");
  assert.equal(result.accepted.length, 1);
});

test("reaction providers receive the payment transaction while applying an accepted choice", async () => {
  const reactor = candidate("transaction-aware");
  let observedPayment = null;
  const queue = new ReactionQueueService({
    combatAttackService: {
      consumeReaction: async () => ({ consumed: true })
    }
  }, {
    actorResolver: (uuid) => ({ uuid }),
    isCoordinator: () => true,
    promptCandidate: async () => ({ accepted: true })
  });
  queue.registerType("transaction-aware", {
    listCandidates: () => [reactor],
    isTriggerValid: () => true,
    revalidateCandidate: () => true,
    buildPrompt: () => ({}),
    pay: async () => ({ paid: true, marker: "paid-once" }),
    apply: async (_current, _choice, _context, transaction) => {
      observedPayment = transaction.payment;
      return { applied: true };
    }
  });

  const result = await queue.resolve({ triggerId: "transaction-trigger", kind: "transaction-aware" });

  assert.equal(result.accepted.length, 1);
  assert.equal(observedPayment?.marker, "paid-once");
});

test("active GM routes one reaction prompt to the active actor owner", async () => {
  const reactor = {
    ...candidate("owned"),
    ownerUserIds: ["owner-user"]
  };
  const gmUser = { id: "gm-user", isGM: true, active: true };
  const ownerUser = { id: "owner-user", isGM: false, active: true };
  const users = [gmUser, ownerUser];
  users.activeGM = gmUser;
  let gmQueue;
  let ownerQueue;
  const route = (message) => {
    const recipient = message.forUserId === ownerUser.id ? ownerQueue : gmQueue;
    queueMicrotask(() => recipient.handleSocketMessage(message, message.senderId));
  };
  const gameFor = (user) => ({
    user,
    users,
    socket: { emit: (_channel, message) => route(message) }
  });
  let ownerPrompts = 0;
  gmQueue = new ReactionQueueService({
    combatAttackService: {
      consumeReaction: async () => ({ consumed: true })
    }
  }, {
    actorResolver: (uuid) => ({ uuid }),
    combatProvider: () => ({
      started: true,
      turns: [{ actor: { uuid: reactor.actorUuid } }]
    }),
    gameProvider: () => gameFor(gmUser),
    idFactory: () => "prompt-request-1",
    isCoordinator: () => true
  });
  ownerQueue = new ReactionQueueService({}, {
    gameProvider: () => gameFor(ownerUser),
    isCoordinator: () => false,
    promptRenderer: async () => {
      ownerPrompts += 1;
      return { accepted: true, mode: "advantage" };
    }
  });
  gmQueue.registerType("owned-reaction", {
    listCandidates: () => [reactor],
    isTriggerValid: () => true,
    revalidateCandidate: () => true,
    buildPrompt: () => ({ title: "Owned reaction", body: "React?" }),
    pay: async () => ({ paid: true }),
    apply: async (_current, choice) => ({ applied: choice.mode === "advantage" })
  });

  const result = await gmQueue.resolve({
    triggerId: "owned-trigger",
    kind: "owned-reaction"
  });

  assert.equal(ownerPrompts, 1);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].choice.mode, "advantage");
});

test("reaction timeout closes the local Foundry dialog", async () => {
  const previousFoundry = globalThis.foundry;
  let dialogInstance;
  class FakeDialogV2 {
    constructor(options) {
      this.options = options;
      this.closed = false;
      dialogInstance = this;
    }

    render() {
      return this;
    }

    async close() {
      this.closed = true;
      this.options.close?.();
    }
  }
  globalThis.foundry = {
    applications: { api: { DialogV2: FakeDialogV2 } },
    utils: { escapeHTML: (value) => String(value) }
  };
  try {
    const reactor = candidate("local-gm");
    const gmUser = { id: "gm-user", isGM: true, active: true };
    const users = [gmUser];
    users.activeGM = gmUser;
    let timeoutCallback;
    let timeoutDelay;
    const queue = new ReactionQueueService({}, {
      combatProvider: () => ({
        started: true,
        turns: [{ actor: { uuid: reactor.actorUuid } }]
      }),
      gameProvider: () => ({ user: gmUser, users }),
      isCoordinator: () => true,
      setTimeoutFn: (callback, delay) => {
        timeoutCallback = callback;
        timeoutDelay = delay;
        return "local-timeout";
      },
      clearTimeoutFn: () => undefined
    });
    queue.registerType("local", {
      listCandidates: () => [reactor],
      isTriggerValid: () => true,
      revalidateCandidate: () => true,
      buildPrompt: () => ({ title: "Local", body: "React?" })
    });

    const pending = queue.resolve({ triggerId: "local-trigger", kind: "local" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(timeoutDelay, 10_000);
    assert.ok(dialogInstance);

    timeoutCallback();
    const result = await pending;
    assert.equal(dialogInstance.closed, true);
    assert.equal(result.accepted.length, 0);
  }
  finally {
    globalThis.foundry = previousFoundry;
  }
});

test("remote owner closes its prompt and returns decline after ten seconds", async () => {
  const previousFoundry = globalThis.foundry;
  let dialogInstance;
  class FakeDialogV2 {
    constructor(options) {
      this.options = options;
      this.closed = false;
      dialogInstance = this;
    }

    render() {
      return this;
    }

    async close() {
      this.closed = true;
      this.options.close?.();
    }
  }
  globalThis.foundry = {
    applications: { api: { DialogV2: FakeDialogV2 } },
    utils: { escapeHTML: (value) => String(value) }
  };
  try {
    const gmUser = { id: "gm-user", isGM: true, active: true };
    const ownerUser = { id: "owner-user", isGM: false, active: true };
    const users = [gmUser, ownerUser];
    users.activeGM = gmUser;
    let timeoutCallback;
    let timeoutDelay;
    const emitted = [];
    const ownerQueue = new ReactionQueueService({}, {
      gameProvider: () => ({
        user: ownerUser,
        users,
        socket: { emit: (_channel, message) => emitted.push(message) }
      }),
      isCoordinator: () => false,
      setTimeoutFn: (callback, delay) => {
        timeoutCallback = callback;
        timeoutDelay = delay;
        return "remote-owner-timeout";
      },
      clearTimeoutFn: () => undefined
    });

    const pending = ownerQueue.handleSocketMessage({
      type: REACTION_PROMPT_EVENT,
      requestId: "remote-prompt",
      senderId: gmUser.id,
      forUserId: ownerUser.id,
      prompt: { title: "Remote", body: "React?" }
    }, gmUser.id);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(timeoutDelay, 10_000);
    assert.ok(dialogInstance);
    timeoutCallback();
    await pending;
    assert.equal(dialogInstance.closed, true);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, REACTION_PROMPT_RESULT_EVENT);
    assert.equal(emitted[0].choice.accepted, false);
    assert.equal(emitted[0].choice.reason, "timeout");
  }
  finally {
    globalThis.foundry = previousFoundry;
  }
});

test("non-GM reaction triggers are coordinated and resolved by the active GM", async () => {
  const reactor = candidate("gm-coordinated");
  const gmUser = { id: "gm-user", isGM: true, active: true };
  const sourceUser = { id: "source-user", isGM: false, active: true };
  const users = [gmUser, sourceUser];
  users.activeGM = gmUser;
  let gmQueue;
  let sourceQueue;
  const route = (message) => {
    const recipient = message.forUserId === gmUser.id ? gmQueue : sourceQueue;
    queueMicrotask(() => recipient.handleSocketMessage(message, message.senderId));
  };
  const gameFor = (user) => ({
    user,
    users,
    socket: { emit: (_channel, message) => route(message) }
  });
  gmQueue = new ReactionQueueService({
    combatAttackService: {
      consumeReaction: async () => ({ consumed: true })
    }
  }, {
    actorResolver: (uuid) => ({ uuid }),
    combatProvider: () => ({
      started: true,
      turns: [{ actor: { uuid: reactor.actorUuid } }]
    }),
    gameProvider: () => gameFor(gmUser),
    isCoordinator: () => true,
    promptRenderer: async () => ({ accepted: true })
  });
  sourceQueue = new ReactionQueueService({}, {
    gameProvider: () => gameFor(sourceUser),
    idFactory: () => "remote-trigger-request",
    isCoordinator: () => false
  });
  gmQueue.registerType("gm-only", {
    listCandidates: (context) => context.candidates,
    isTriggerValid: () => true,
    revalidateCandidate: () => true,
    buildPrompt: () => ({ title: "GM coordinated", body: "React?" }),
    pay: async () => ({ paid: true }),
    apply: async () => ({ applied: true, summary: { cancelled: true } }),
    serializeEffect: (effect) => effect
  });

  const result = await sourceQueue.resolve({
    triggerId: "remote-trigger",
    kind: "gm-only",
    workflowId: "workflow-remote",
    context: { candidates: [reactor] }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].candidate.actorUuid, reactor.actorUuid);
  assert.deepEqual(result.accepted[0].effect, {
    applied: true,
    summary: { cancelled: true }
  });
});

test("reaction prompt transport is bounded and destroy releases pending requests", async () => {
  const gmUser = { id: "gm-user", isGM: true, active: true };
  const ownerUser = { id: "owner-user", isGM: false, active: true };
  const users = [gmUser, ownerUser];
  users.activeGM = gmUser;
  let sequence = 0;
  const queue = new ReactionQueueService({}, {
    gameProvider: () => ({
      user: gmUser,
      users,
      socket: { emit: () => undefined }
    }),
    idFactory: () => `bounded-${++sequence}`,
    isCoordinator: () => true,
    maxPendingRequests: 2
  });
  const request = {
    candidate: { ...candidate("bounded"), ownerUserIds: [ownerUser.id] },
    prompt: { title: "Bounded", body: "React?" }
  };
  const first = queue.promptDecision(request);
  const second = queue.promptDecision(request);

  try {
    const overflow = await Promise.race([
      queue.promptDecision(request),
      new Promise((resolve) => setImmediate(() => resolve({ reason: "stillPending" })))
    ]);
    assert.equal(overflow.reason, "queueFull");
  }
  finally {
    queue.destroy?.();
  }

  assert.deepEqual((await Promise.all([first, second])).map((entry) => entry.reason), [
    "destroyed",
    "destroyed"
  ]);
});
