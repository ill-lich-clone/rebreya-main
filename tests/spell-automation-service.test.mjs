import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const MODULE_ID = "rebreya-main";

globalThis.foundry ??= {
  utils: {
    getProperty: (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object)
  }
};

globalThis.Actor ??= class Actor {};
globalThis.game ??= {
  user: { id: "user", active: true, isGM: false }
};

class TestActor extends Actor {
  constructor({ id, initiative = 0, items = [] } = {}) {
    super();
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.name = id;
    this.isOwner = true;
    this.initiative = initiative;
    this.items = { contents: items };
    this.system = { abilities: { int: { mod: 3 } } };
  }
}

function counterspellItem() {
  return {
    id: "counterspell",
    uuid: "Item.counterspell",
    flags: {
      [MODULE_ID]: {
        spellAutomation: { kind: "counterspell" }
      }
    },
    system: {
      level: 3,
      ability: "int"
    }
  };
}

function counterspellCandidate({
  id = "reactor",
  initiative = 0,
  visible = true,
  rangeFeet = 30,
  selectedLevel = 3
} = {}) {
  const item = counterspellItem();
  const actor = new TestActor({ id, initiative, items: [item] });
  return {
    id,
    actor,
    actorUuid: actor.uuid,
    item,
    spellLevel: selectedLevel,
    visible,
    rangeFeet,
    combatOrder: initiative
  };
}

function rootCast(overrides = {}) {
  return {
    id: "root-cast",
    actorUuid: "Actor.caster",
    activityUuid: "Activity.root",
    spellUuid: "Item.root",
    spellLevel: 3,
    rangeFeet: 0,
    components: { verbal: true, somatic: true },
    visible: true,
    targetUuids: [],
    cancelled: false,
    modifiers: {},
    ...overrides
  };
}

function reactionLedger({ available = true, events = [] } = {}) {
  return {
    canUseReaction: (actor) => ({
      actorId: actor?.id ?? null,
      canUse: available,
      state: { usesRemaining: available ? 1 : 0 }
    }),
    consumeReaction: async (actor, options) => {
      events.push(`reaction:${actor.id}:${options.reactionType}`);
      return { actorId: actor.id, consumed: available };
    }
  };
}

const { SpellAutomationService } = await import("../scripts/combat/spell-automation-service.js");

function makeService({
  candidates = [],
  available = true,
  rollTotal = 20,
  events = [],
  prompt = null,
  paySpell = null,
  useActivityPayment = false
} = {}) {
  const moduleApi = {
    combatAttackService: reactionLedger({ available, events })
  };
  const options = {
    getCounterspellCandidates: async (cast) => typeof candidates === "function" ? candidates(cast) : candidates,
    promptCounterspell: async (candidate, cast) => {
      if (prompt) {
        return prompt(candidate, cast);
      }
      return { accepted: true, spellLevel: candidate.spellLevel };
    },
    rollAbilityCheck: async () => rollTotal
  };
  if (!useActivityPayment) {
    options.paySpell = async (candidate, cast) => {
      events.push(`payment:${candidate.id}:${cast.id}`);
      return paySpell ? paySpell(candidate, cast) : true;
    };
  }
  return new SpellAutomationService(moduleApi, options);
}

test("Counterspell cancels a visible verbal cast in range", async () => {
  const service = makeService({ candidates: [counterspellCandidate()] });

  const result = await service.resolveCast(rootCast({ components: { verbal: true, somatic: false } }));

  assert.equal(result.cancelled, true);
});

test("a Counterspell on Counterspell restores the original cast", async () => {
  const first = counterspellCandidate({ id: "first", initiative: 10 });
  const second = counterspellCandidate({ id: "second", initiative: 5 });
  const service = makeService({
    candidates: (cast) => cast.parentId ? [second] : [first]
  });

  const result = await service.resolveCast(rootCast());

  assert.equal(result.cancelled, false);
  assert.equal(result.chain.length, 3);
});

test("a cast without V or S opens no Counterspell prompt", async () => {
  let promptCalls = 0;
  const service = makeService({
    candidates: [counterspellCandidate()],
    prompt: async () => {
      promptCalls += 1;
      return { accepted: true, spellLevel: 3 };
    }
  });

  await service.resolveCast(rootCast({ components: { verbal: false, somatic: false } }));

  assert.equal(promptCalls, 0);
});

test("an equal-level Counterspell succeeds without an ability check", async () => {
  let checkCalls = 0;
  const service = makeService({
    candidates: [counterspellCandidate({ selectedLevel: 3 })],
    rollTotal: 0
  });
  service._options.rollAbilityCheck = async () => {
    checkCalls += 1;
    return 0;
  };

  const result = await service.resolveCast(rootCast({ spellLevel: 3 }));

  assert.equal(result.cancelled, true);
  assert.equal(checkCalls, 0);
});

test("a failed lower-level Counterspell leaves the root cast active", async () => {
  const service = makeService({
    candidates: [counterspellCandidate({ selectedLevel: 2 })],
    rollTotal: 12
  });

  const result = await service.resolveCast(rootCast({ spellLevel: 5 }));

  assert.equal(result.cancelled, false);
  assert.equal(result.chain[1].success, false);
  assert.equal(result.chain[1].dc, 15);
});

test("an unseen reactor is not prompted", async () => {
  let promptCalls = 0;
  const service = makeService({
    candidates: [counterspellCandidate({ visible: false })],
    prompt: async () => {
      promptCalls += 1;
      return { accepted: true, spellLevel: 3 };
    }
  });

  const result = await service.resolveCast(rootCast());

  assert.equal(result.cancelled, false);
  assert.equal(promptCalls, 0);
});

test("a reactor without an available reaction is not prompted", async () => {
  let promptCalls = 0;
  const service = makeService({
    candidates: [counterspellCandidate()],
    available: false,
    prompt: async () => {
      promptCalls += 1;
      return { accepted: true, spellLevel: 3 };
    }
  });

  const result = await service.resolveCast(rootCast());

  assert.equal(result.cancelled, false);
  assert.equal(promptCalls, 0);
});

test("a remote owner can resolve Counterspell for an actor they own", async () => {
  const candidate = counterspellCandidate({ id: "remote-reactor" });
  candidate.actor.isOwner = false;
  const previousGame = globalThis.game;
  const emitted = [];
  const service = makeService({ candidates: [candidate] });
  globalThis.game = {
    user: { id: "caster-user", active: true, isGM: false },
    users: {
      contents: [
        { id: "caster-user", active: true, isGM: false },
        { id: "reactor-user", active: true, isGM: false }
      ]
    },
    socket: {
      emit: (_channel, message) => {
        emitted.push(message);
        queueMicrotask(() => {
          void service.handleSocketMessage({
            type: "rebreya-main.spellAutomation.counterspellResult",
            requestId: message.requestId,
            forUserId: "caster-user",
            senderId: "reactor-user",
            actorId: candidate.actor.id,
            itemId: candidate.item.id,
            result: {
              accepted: true,
              spellLevel: 3,
              reaction: { consumed: true },
              paid: true,
              success: true,
              dc: null,
              rollTotal: null
            }
          }, "reactor-user");
        });
      }
    }
  };
  candidate.actor.testUserPermission = (user) => user?.id === "reactor-user";

  try {
    const result = await service.resolveCast(rootCast({
      sourceToken: {
        uuid: "Scene.scene.Token.caster",
        center: { x: 0, y: 0 },
        visible: true,
        isVisible: true
      }
    }));
    assert.equal(result.cancelled, true);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].forUserId, "reactor-user");
    assert.deepEqual(emitted[0].cast.sourceToken, {
      uuid: "Scene.scene.Token.caster",
      center: { x: 0, y: 0 },
      visible: true
    });
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("a forged Counterspell result with a spoofed payload sender cannot cancel the root cast", async () => {
  const candidate = counterspellCandidate({ id: "remote-reactor" });
  candidate.actor.isOwner = false;
  candidate.actor.testUserPermission = (user) => user?.id === "reactor-user";
  const previousGame = globalThis.game;
  const service = makeService({ candidates: [candidate] });
  globalThis.game = {
    user: { id: "caster-user", active: true, isGM: false },
    users: {
      contents: [
        { id: "caster-user", active: true, isGM: false },
        { id: "reactor-user", active: true, isGM: false }
      ]
    },
    socket: {
      emit: (_channel, request) => {
        queueMicrotask(() => {
          void service.handleSocketMessage({
            type: "rebreya-main.spellAutomation.counterspellResult",
            requestId: request.requestId,
            forUserId: "caster-user",
            senderId: "reactor-user",
            actorId: candidate.actor.id,
            itemId: candidate.item.id,
            result: {
              accepted: true,
              spellLevel: 3,
              reaction: { consumed: true },
              paid: true,
              success: true,
              dc: null,
              rollTotal: null
            }
          }, "attacker-user");
          queueMicrotask(() => {
            void service.handleSocketMessage({
              type: "rebreya-main.spellAutomation.counterspellResult",
              requestId: request.requestId,
              forUserId: "caster-user",
              senderId: "reactor-user",
              actorId: candidate.actor.id,
              itemId: candidate.item.id,
              result: { accepted: false, reason: "declined" }
            }, "reactor-user");
          });
        });
      }
    }
  };

  try {
    const result = await service.resolveCast(rootCast());
    assert.equal(result.cancelled, false);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("an active GM routes a player-owned Counterspell prompt to that player", async () => {
  const candidate = counterspellCandidate({ id: "player-reactor" });
  candidate.actor.isOwner = true;
  candidate.actor.testUserPermission = (user) => user?.id === "reactor-user";
  const previousGame = globalThis.game;
  const emitted = [];
  const service = makeService({ candidates: [candidate] });
  globalThis.game = {
    user: { id: "gm-user", active: true, isGM: true },
    users: {
      contents: [
        { id: "gm-user", active: true, isGM: true },
        { id: "reactor-user", active: true, isGM: false }
      ]
    },
    socket: {
      emit: (_channel, message) => {
        emitted.push(message);
        queueMicrotask(() => {
          void service.handleSocketMessage({
            type: "rebreya-main.spellAutomation.counterspellResult",
            requestId: message.requestId,
            forUserId: "gm-user",
            senderId: "reactor-user",
            actorId: candidate.actor.id,
            itemId: candidate.item.id,
            result: {
              accepted: true,
              spellLevel: 3,
              reaction: { consumed: true },
              paid: true,
              success: true,
              dc: null,
              rollTotal: null
            }
          }, "reactor-user");
        });
      }
    }
  };

  try {
    const result = await service.resolveCast(rootCast());
    assert.equal(result.cancelled, true);
    assert.equal(emitted[0].forUserId, "reactor-user");
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("remote owner visibility is not filtered by the caster client", async () => {
  const candidate = counterspellCandidate({ id: "remote-visibility-reactor" });
  candidate.actor.isOwner = false;
  candidate.actor.testUserPermission = (user) => user?.id === "reactor-user";
  candidate.actor.getActiveTokens = () => [{ visible: true, isVisible: false }];
  const previousGame = globalThis.game;
  const emitted = [];
  const service = makeService({ candidates: [candidate] });
  globalThis.game = {
    user: { id: "caster-user", active: true, isGM: false },
    users: {
      contents: [
        { id: "caster-user", active: true, isGM: false },
        { id: "reactor-user", active: true, isGM: false }
      ]
    },
    socket: {
      emit: (_channel, message) => {
        emitted.push(message);
        queueMicrotask(() => {
          void service.handleSocketMessage({
            type: "rebreya-main.spellAutomation.counterspellResult",
            requestId: message.requestId,
            forUserId: "caster-user",
            senderId: "reactor-user",
            actorId: candidate.actor.id,
            itemId: candidate.item.id,
            result: {
              accepted: true,
              spellLevel: 3,
              reaction: { consumed: true },
              paid: true,
              success: true,
              dc: null,
              rollTotal: null
            }
          }, "reactor-user");
        });
      }
    }
  };

  try {
    const result = await service.resolveCast(rootCast());
    assert.equal(result.cancelled, true);
    assert.equal(emitted[0].forUserId, "reactor-user");
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("a reactor without a local or active remote owner is skipped", async () => {
  const candidate = counterspellCandidate({ id: "unowned-reactor" });
  candidate.actor.isOwner = false;
  candidate.actor.testUserPermission = () => false;
  const previousGame = globalThis.game;
  globalThis.game = {
    user: { id: "caster-user", active: true, isGM: false },
    users: { contents: [{ id: "caster-user", active: true, isGM: false }] }
  };
  const service = makeService({ candidates: [candidate] });

  try {
    const result = await service.resolveCast(rootCast());
    assert.equal(result.cancelled, false);
    assert.equal(result.chain.length, 1);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("the targeted owner validates and returns a local Counterspell outcome", async () => {
  const candidate = counterspellCandidate({ id: "owned-reactor" });
  candidate.actor.isOwner = true;
  candidate.actor.testUserPermission = (user) => user?.id === "reactor-user";
  const previousGame = globalThis.game;
  const emitted = [];
  globalThis.game = {
    user: { id: "reactor-user", active: true, isGM: false },
    actors: {
      get: (actorId) => actorId === candidate.actor.id ? candidate.actor : null
    },
    socket: {
      emit: (_channel, message) => emitted.push(message)
    }
  };
  const service = makeService({ candidates: [candidate] });
  service._options.distanceFeet = () => 30;

  try {
    const handled = await service.handleSocketMessage({
      type: "rebreya-main.spellAutomation.counterspellRequest",
      requestId: "request-1",
      senderId: "caster-user",
      forUserId: "reactor-user",
      actorId: candidate.actor.id,
      itemId: candidate.item.id,
      cast: rootCast({ sourceToken: { center: { x: 0, y: 0 } } })
    }, "caster-user");
    assert.equal(handled, true);
    assert.deepEqual(emitted, [{
      type: "rebreya-main.spellAutomation.counterspellResult",
      requestId: "request-1",
      forUserId: "caster-user",
      senderId: "reactor-user",
      actorId: candidate.actor.id,
      itemId: candidate.item.id,
      result: {
        accepted: true,
        spellLevel: 3,
        reaction: { actorId: candidate.actor.id, consumed: true },
        paid: true,
        success: true,
        dc: null,
        rollTotal: null
      }
    }]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("a Counterspell result targets the authenticated request sender", async () => {
  const candidate = counterspellCandidate({ id: "owned-reactor" });
  candidate.actor.isOwner = true;
  candidate.actor.testUserPermission = (user) => user?.id === "reactor-user";
  const previousGame = globalThis.game;
  const emitted = [];
  globalThis.game = {
    user: { id: "reactor-user", active: true, isGM: false },
    actors: { get: (actorId) => actorId === candidate.actor.id ? candidate.actor : null },
    socket: { emit: (_channel, message) => emitted.push(message) }
  };
  const service = makeService({ candidates: [candidate] });
  service._options.distanceFeet = () => 30;

  try {
    await service.handleSocketMessage({
      type: "rebreya-main.spellAutomation.counterspellRequest",
      requestId: "request-transport-sender",
      senderId: "forged-caster-user",
      forUserId: "reactor-user",
      actorId: candidate.actor.id,
      itemId: candidate.item.id,
      cast: rootCast({ sourceToken: { center: { x: 0, y: 0 } } })
    }, "caster-user");
    assert.equal(emitted[0].forUserId, "caster-user");
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("the targeted owner checks reaction availability before prompting", async () => {
  const candidate = counterspellCandidate({ id: "spent-reactor" });
  candidate.actor.isOwner = true;
  candidate.actor.testUserPermission = (user) => user?.id === "reactor-user";
  const previousGame = globalThis.game;
  const emitted = [];
  let promptCalls = 0;
  globalThis.game = {
    user: { id: "reactor-user", active: true, isGM: false },
    actors: { get: (actorId) => actorId === candidate.actor.id ? candidate.actor : null },
    socket: { emit: (_channel, message) => emitted.push(message) }
  };
  const service = makeService({
    candidates: [candidate],
    available: false,
    prompt: async () => {
      promptCalls += 1;
      return { accepted: true, spellLevel: 3 };
    }
  });
  service._options.distanceFeet = () => 30;

  try {
    await service.handleSocketMessage({
      type: "rebreya-main.spellAutomation.counterspellRequest",
      requestId: "request-spent",
      senderId: "caster-user",
      forUserId: "reactor-user",
      actorId: candidate.actor.id,
      itemId: candidate.item.id,
      cast: rootCast({ sourceToken: { center: { x: 0, y: 0 } } })
    }, "caster-user");
    assert.equal(promptCalls, 0);
    assert.equal(emitted[0].result.accepted, false);
    assert.equal(emitted[0].result.reason, "noReaction");
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("the targeted owner rechecks visible Counterspell range before prompting", async () => {
  const candidate = counterspellCandidate({ id: "distant-reactor" });
  candidate.actor.isOwner = true;
  candidate.actor.testUserPermission = (user) => user?.id === "reactor-user";
  candidate.actor.getActiveTokens = () => [{
    getCenterPoint: () => ({ x: 65, y: 0 }),
    visible: true,
    isVisible: true
  }];
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const emitted = [];
  let promptCalls = 0;
  globalThis.game = {
    user: { id: "reactor-user", active: true, isGM: false },
    actors: { get: (actorId) => actorId === candidate.actor.id ? candidate.actor : null },
    socket: { emit: (_channel, message) => emitted.push(message) }
  };
  globalThis.canvas = {
    grid: { measurePath: () => ({ distance: 65 }) },
    scene: { grid: { units: "ft" } }
  };
  const service = makeService({
    candidates: [candidate],
    prompt: async () => {
      promptCalls += 1;
      return { accepted: true, spellLevel: 3 };
    }
  });

  try {
    await service.handleSocketMessage({
      type: "rebreya-main.spellAutomation.counterspellRequest",
      requestId: "request-distant",
      senderId: "caster-user",
      forUserId: "reactor-user",
      actorId: candidate.actor.id,
      itemId: candidate.item.id,
      cast: rootCast({
        sourceToken: {
          center: { x: 0, y: 0 },
          visible: true,
          isVisible: true
        }
      })
    }, "caster-user");
    assert.equal(promptCalls, 0);
    assert.equal(emitted[0].result.reason, "notEligible");
  }
  finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});

test("an unlinked source token beyond Counterspell range does not prompt a remote owner", async () => {
  const sourceToken = {
    uuid: "Scene.scene.Token.caster",
    getCenterPoint: () => ({ x: 0, y: 0 }),
    visible: true,
    isVisible: true
  };
  const candidate = counterspellCandidate({ id: "remote-reactor" });
  candidate.actor.isOwner = false;
  candidate.actor.testUserPermission = (user) => user?.id === "reactor-user";
  candidate.actor.getActiveTokens = () => [{
    getCenterPoint: () => ({ x: 1000, y: 0 }),
    visible: true,
    isVisible: true
  }];
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  let promptCalls = 0;
  let request = null;
  const sourceService = makeService({ candidates: [candidate] });
  const remoteService = makeService({
    prompt: async () => {
      promptCalls += 1;
      return { accepted: true, spellLevel: 3 };
    }
  });
  const sourceGame = {
    user: { id: "caster-user", active: true, isGM: false },
    users: {
      contents: [
        { id: "caster-user", active: true, isGM: false },
        { id: "reactor-user", active: true, isGM: false }
      ]
    },
    socket: {
      emit: (_channel, message) => {
        request = message;
        queueMicrotask(() => {
          globalThis.game = remoteGame;
          void remoteService.handleSocketMessage(message, "caster-user");
        });
      }
    }
  };
  const remoteGame = {
    user: { id: "reactor-user", active: true, isGM: false },
    actors: { get: (actorId) => actorId === candidate.actor.id ? candidate.actor : null },
    socket: {
      emit: (_channel, message) => {
        globalThis.game = sourceGame;
        void sourceService.handleSocketMessage(message, "reactor-user");
      }
    }
  };
  const sourceActor = {
    uuid: "Actor.caster",
    getActiveTokens: (linked) => linked === false ? [sourceToken] : []
  };
  globalThis.game = sourceGame;
  globalThis.canvas = {
    grid: { measurePath: () => ({ distance: 1000 }) },
    scene: { grid: { units: "ft" } }
  };
  const activity = {
    id: "activity-root",
    uuid: "Activity.root",
    actor: sourceActor,
    item: {
      uuid: "Item.root",
      system: { level: 3, components: { verbal: true, somatic: false } }
    },
    system: { range: { value: 90, units: "ft" } }
  };

  try {
    assert.equal(await sourceService.applyDnd5ePreUseActivity(activity, {}), true);
    assert.deepEqual(request.cast.sourceToken.center, { x: 0, y: 0 });
    assert.equal(promptCalls, 0);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});

test("a missing source fails closed before a 1000-foot remote Counterspell prompt", async () => {
  const candidate = counterspellCandidate({ id: "missing-source-reactor" });
  candidate.actor.isOwner = true;
  candidate.actor.testUserPermission = (user) => user?.id === "reactor-user";
  const previousGame = globalThis.game;
  const emitted = [];
  let promptCalls = 0;
  let distanceChecks = 0;
  globalThis.game = {
    user: { id: "reactor-user", active: true, isGM: false },
    actors: { get: (actorId) => actorId === candidate.actor.id ? candidate.actor : null },
    socket: { emit: (_channel, message) => emitted.push(message) }
  };
  const service = makeService({
    prompt: async () => {
      promptCalls += 1;
      return { accepted: true, spellLevel: 3 };
    }
  });
  service._options.distanceFeet = () => {
    distanceChecks += 1;
    return 1000;
  };

  try {
    await service.handleSocketMessage({
      type: "rebreya-main.spellAutomation.counterspellRequest",
      requestId: "request-missing-source",
      senderId: "caster-user",
      forUserId: "reactor-user",
      actorId: candidate.actor.id,
      itemId: candidate.item.id,
      cast: rootCast({ sourceToken: null })
    }, "caster-user");
    assert.equal(promptCalls, 0);
    assert.equal(distanceChecks, 0);
    assert.equal(emitted[0].result.reason, "notEligible");
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("a selected Counterspell spends reaction and spell payment before resolving", async () => {
  const events = [];
  const service = makeService({
    candidates: [counterspellCandidate()],
    events
  });

  const result = await service.resolveCast(rootCast());

  assert.equal(result.cancelled, true);
  assert.deepEqual(events, [
    "payment:reactor:root-cast",
    "reaction:reactor:counterspell"
  ]);
});

test("a selected Counterspell pays with its selected spell-slot level", async () => {
  const candidate = counterspellCandidate({ selectedLevel: 5 });
  const paymentConfigs = [];
  candidate.activity = {
    item: candidate.item,
    use: async (...args) => {
      paymentConfigs.push(args);
      return { updates: [] };
    }
  };
  const service = makeService({
    candidates: [candidate],
    useActivityPayment: true
  });

  const result = await service.resolveCast(rootCast({ spellLevel: 5 }));

  assert.equal(result.cancelled, true);
  assert.equal(paymentConfigs[0][0].spell.slot, "spell5");
  assert.equal(paymentConfigs[0][0].scaling, 2);
  assert.equal(paymentConfigs[0][0].configure, undefined);
  assert.deepEqual(paymentConfigs[0][1], { configure: false });
});

test("a Counterspell with failed native payment cannot cancel the root cast", async () => {
  const candidate = counterspellCandidate();
  candidate.activity = {
    item: candidate.item,
    use: async () => undefined
  };
  const service = makeService({
    candidates: [candidate],
    useActivityPayment: true
  });

  const result = await service.resolveCast(rootCast());

  assert.equal(result.cancelled, false);
  assert.equal(result.chain.length, 1);
});

test("a declined or failed native Counterspell payment keeps the reaction available", async () => {
  const declinedEvents = [];
  const declined = makeService({
    candidates: [counterspellCandidate()],
    events: declinedEvents,
    prompt: async () => ({ accepted: false })
  });
  const failedPaymentEvents = [];
  const failedPaymentCandidate = counterspellCandidate();
  failedPaymentCandidate.activity = {
    item: failedPaymentCandidate.item,
    use: async () => undefined
  };
  const failedPayment = makeService({
    candidates: [failedPaymentCandidate],
    events: failedPaymentEvents,
    useActivityPayment: true
  });

  assert.equal((await declined.resolveCast(rootCast())).cancelled, false);
  assert.deepEqual(declinedEvents, []);
  assert.equal((await failedPayment.resolveCast(rootCast())).cancelled, false);
  assert.deepEqual(failedPaymentEvents, []);
});

test("the default Counterspell prompt returns the selected available slot level", async () => {
  const candidate = counterspellCandidate({ selectedLevel: 3 });
  candidate.actor.system.spells = {
    spell3: { level: 3, value: 0 },
    spell5: { level: 5, value: 1 }
  };
  const previousApplications = globalThis.foundry.applications;
  globalThis.foundry.applications = {
    api: {
      DialogV2: {
        wait: async (config) => {
          assert.doesNotMatch(config.content, /value="3"/);
          return config.buttons[0].callback(null, {
            form: { elements: { spellLevel: { value: "5" } } }
          });
        }
      }
    }
  };
  const service = new SpellAutomationService({});

  try {
    const choice = await service.promptCounterspell(candidate, rootCast({ spellLevel: 5 }));
    assert.deepEqual(choice, { accepted: true, spellLevel: 5 });
  }
  finally {
    globalThis.foundry.applications = previousApplications;
  }
});

test("pre-use activity returns false only when the root spell is cancelled", async () => {
  const service = makeService({ candidates: [counterspellCandidate()] });
  const activity = {
    id: "activity-root",
    uuid: "Activity.root",
    actor: { uuid: "Actor.caster" },
    item: {
      uuid: "Item.root",
      system: { level: 3, components: { vocal: true, somatic: false } }
    },
    system: { range: { value: 90, units: "ft" } }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {}), false);
});

test("pre-use activity recognizes dnd5e vocal and somatic properties", async () => {
  const service = makeService({ candidates: [counterspellCandidate()] });
  const activity = {
    id: "activity-root",
    uuid: "Activity.root",
    actor: { uuid: "Actor.caster" },
    item: {
      uuid: "Item.root",
      system: {
        level: 3,
        properties: { value: new Set(["vocal"]) }
      }
    },
    system: { range: { value: 90, units: "ft" } }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {}), false);
});

test("pre-use activity honors neutral shared spellCast components before resolving reactions", async () => {
  const service = makeService({ candidates: [counterspellCandidate()] });
  const activity = {
    id: "activity-root",
    uuid: "Activity.root",
    actor: { uuid: "Actor.caster" },
    item: {
      uuid: "Item.root",
      system: { level: 3, components: { vocal: true, somatic: true } }
    },
    system: { range: { value: 90, units: "ft" } }
  };
  const usageConfig = {
    spellCast: {
      components: { verbal: false, somatic: false, material: true }
    }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(activity, usageConfig), true);
  assert.equal(usageConfig.flags?.["rebreya-main"]?.reactionCheckComplete, true);
});

test("default discovery measures TokenDocument centers for an in-range reactor", async () => {
  const candidate = counterspellCandidate();
  candidate.actor.isOwner = true;
  candidate.actor.getActiveTokens = () => [{
    getCenterPoint: () => ({ x: 60, y: 0 }),
    visible: true,
    isVisible: true
  }];
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  globalThis.game = {
    user: { id: "reactor-user", active: true, isGM: false },
    actors: { contents: [candidate.actor] }
  };
  globalThis.canvas = {
    grid: {
      measurePath: (points) => {
        assert.deepEqual(points, [{ x: 60, y: 0 }, { x: 0, y: 0 }]);
        return { distance: 30 };
      }
    },
    scene: { grid: { units: "ft" } }
  };
  const service = new SpellAutomationService({
    combatAttackService: reactionLedger()
  }, {
    promptCounterspell: async () => ({ accepted: true, spellLevel: 3 }),
    paySpell: async () => true
  });
  const activity = {
    id: "activity-root",
    uuid: "Activity.root",
    actor: { uuid: "Actor.caster" },
    token: {
      getCenterPoint: () => ({ x: 0, y: 0 }),
      visible: true,
      isVisible: true
    },
    item: {
      uuid: "Item.root",
      system: { level: 3, components: { verbal: true, somatic: false } }
    },
    system: { range: { value: 90, units: "ft" } }
  };

  try {
    assert.equal(await service.applyDnd5ePreUseActivity(activity, {}), false);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});

test("MIDI workflow returns false only when the root spell is cancelled", async () => {
  const service = makeService({ candidates: [counterspellCandidate()] });
  const workflow = {
    id: "workflow-root",
    actor: { uuid: "Actor.caster" },
    item: {
      uuid: "Item.root",
      system: { level: 3, components: { verbal: true, somatic: false } }
    },
    activity: { uuid: "Activity.root", system: { range: { value: 90, units: "ft" } } }
  };

  assert.equal(await service.applyMidiWorkflow(workflow), false);
});

test("deferred dnd5e pre-use resumes an active root cast with a bypass marker", async () => {
  const service = makeService({
    candidates: [counterspellCandidate()],
    prompt: async () => false
  });
  const useCalls = [];
  const activity = {
    id: "activity-root",
    uuid: "Activity.root",
    actor: { uuid: "Actor.caster" },
    item: {
      uuid: "Item.root",
      system: { level: 3, components: { verbal: true, somatic: false } }
    },
    system: { range: { value: 90, units: "ft" } },
    use: async (...args) => {
      useCalls.push(args);
      return { updates: [] };
    }
  };

  assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(useCalls.length, 1);
  assert.equal(useCalls[0][0][MODULE_ID].spellAutomationBypass, true);
});

test("deferred dnd5e pre-use resumes the cast when reaction resolution errors", async () => {
  const service = makeService({
    candidates: [counterspellCandidate()],
    prompt: async () => {
      throw new Error("prompt failed");
    }
  });
  const useCalls = [];
  const previousConsoleError = console.error;
  console.error = () => {};
  const activity = {
    id: "activity-root",
    uuid: "Activity.root",
    actor: { uuid: "Actor.caster" },
    item: {
      uuid: "Item.root",
      system: { level: 3, components: { verbal: true, somatic: false } }
    },
    system: { range: { value: 90, units: "ft" } },
    use: async (...args) => {
      useCalls.push(args);
      return { updates: [] };
    }
  };

  try {
    assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(useCalls.length, 1);
    assert.equal(useCalls[0][0][MODULE_ID].spellAutomationBypass, true);
  }
  finally {
    console.error = previousConsoleError;
  }
});

test("combat hooks route dnd5e and MIDI pre-use events through spell automation", async () => {
  const handlers = new Map();
  globalThis.Hooks = {
    on: (name, callback) => {
      const callbacks = handlers.get(name) ?? [];
      callbacks.push(callback);
      handlers.set(name, callbacks);
    }
  };
  globalThis.game = {};
  const { registerCombatHooks } = await import("../scripts/combat/hooks.js");
  const calls = [];
  const moduleApi = {
    spellAutomationService: {
      deferDnd5ePreUseActivity: () => {
        calls.push("dnd5e");
        return false;
      },
      applyMidiWorkflow: async () => {
        calls.push("midi");
        return false;
      }
    }
  };

  registerCombatHooks(moduleApi);

  const dnd5eResult = handlers.get("dnd5e.preUseActivity")?.[0]({}, {}, {}, {});
  const midiResult = await handlers.get("midi-qol.preItemRoll")?.[0]({});
  assert.equal(dnd5eResult, false);
  assert.equal(midiResult, false);
  assert.deepEqual(calls, ["dnd5e", "midi"]);
});

test("module API constructs and initializes the generic spell automation service", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

  assert.match(source, /import \{ SpellAutomationService \} from "\.\/combat\/spell-automation-service\.js/);
  assert.match(source, /this\.spellAutomationService = new SpellAutomationService\(this\);/);
  assert.match(source, /await this\.spellAutomationService\.initialize\(\);/);
  assert.match(source, /function dispatchSocketMessage\(message, senderId\)/);
  assert.match(source, /queuedSocketMessages\.push\(\{ message, senderId \}\)/);
  assert.match(source, /moduleApi\.handleSocketMessage\(queuedMessage\.message, queuedMessage\.senderId\)/);
  assert.match(source, /await this\.spellAutomationService\.handleSocketMessage\(message, senderId\)/);
});
