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

function spellShatterItem() {
  return {
    id: "spell-shatter",
    uuid: "Item.spell-shatter",
    flags: {
      [MODULE_ID]: {
        spellAutomation: { kind: "spell-shatter" }
      }
    },
    system: {
      level: 0,
      ability: "cha"
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

function spellShatterCandidate({
  id = "reactor",
  initiative = 0,
  visible = true,
  rangeFeet = 30
} = {}) {
  const item = spellShatterItem();
  const actor = new TestActor({ id, initiative, items: [item] });
  actor.system.abilities.cha = { mod: 4 };
  return {
    id,
    actor,
    actorUuid: actor.uuid,
    item,
    spellLevel: 1,
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

function reactionLedger({ available = true, consumeAvailable = available, events = [] } = {}) {
  return {
    canUseReaction: (actor) => ({
      actorId: actor?.id ?? null,
      canUse: available,
      state: { usesRemaining: available ? 1 : 0 }
    }),
    consumeReaction: async (actor, options) => {
      events.push(`reaction:${actor.id}:${options.reactionType}`);
      return { actorId: actor.id, consumed: consumeAvailable };
    }
  };
}

const { SpellAutomationService } = await import("../scripts/combat/spell-automation-service.js");
const { ReactionQueueService } = await import("../scripts/combat/reaction-queue-service.js");

function makeService({
  candidates = [],
  available = true,
  consumeAvailable = available,
  rollTotal = 20,
  events = [],
  prompt = null,
  paySpell = null,
  useActivityPayment = false,
  moduleApiExtras = {}
} = {}) {
  const moduleApi = {
    combatAttackService: reactionLedger({ available, consumeAvailable, events }),
    ...moduleApiExtras
  };
  const options = {
    getCounterspellCandidates: async (cast) => typeof candidates === "function" ? candidates(cast) : candidates,
    rollAbilityCheck: async () => rollTotal
  };
  if (!useActivityPayment) {
    options.paySpell = async (candidate, cast) => {
      events.push(`payment:${candidate.id}:${cast.id}`);
      return paySpell ? paySpell(candidate, cast) : true;
    };
  }
  moduleApi.reactionCapabilityIndex = {
    registerProvider: () => undefined,
    has: () => false,
    list: () => []
  };
  moduleApi.reactionQueueService = new ReactionQueueService(moduleApi, {
    actorResolver: (uuid) => candidates.find?.((candidate) => candidate.actorUuid === uuid)?.actor ?? { uuid },
    isCoordinator: () => true,
    random: () => 0.999999,
    promptCandidate: async ({ candidate, context }) => {
      if (prompt) {
        return prompt(candidate, context.cast);
      }
      return { accepted: true, spellLevel: candidate.spellLevel };
    }
  });
  const service = new SpellAutomationService(moduleApi, options);
  void service.initialize();
  return service;
}

test("spell reactions delegate transport, timeout, and reaction spending to the global queue", async () => {
  const source = await readFile(new URL("../scripts/combat/spell-automation-service.js", import.meta.url), "utf8");

  assert.match(source, /reactionQueueService/);
  assert.match(source, /registerType\(/);
  assert.doesNotMatch(source, /COUNTERSPELL_REQUEST_EVENT|COUNTERSPELL_RESULT_EVENT|_pendingCounterspellRequests/);
  assert.doesNotMatch(source, /handleSocketMessage\(|promptCounterspell\(|DialogV2/);
});

test("spell reaction capabilities are indexed per actor without scanning the world", async () => {
  let capabilityResolver = null;
  let provider = null;
  const actor = new TestActor({ id: "indexed", items: [counterspellItem()] });
  actor.testUserPermission = (user) => user?.id === "owner";
  const previousGame = globalThis.game;
  globalThis.game = {
    user: { id: "gm", active: true, isGM: true },
    users: {
      contents: [
        { id: "gm", active: true, isGM: true },
        { id: "owner", active: true, isGM: false }
      ]
    }
  };
  const service = new SpellAutomationService({
    reactionCapabilityIndex: {
      registerProvider: (_kind, resolver) => {
        capabilityResolver = resolver;
      }
    },
    reactionQueueService: {
      registerType: (_kind, registered) => {
        provider = registered;
      }
    }
  });

  try {
    await service.initialize();
    const capabilities = capabilityResolver({
      actor,
      token: { uuid: "Scene.scene.Token.indexed" }
    });

    assert.equal(typeof provider.listCandidates, "function");
    assert.equal(capabilities.length, 1);
    assert.equal(capabilities[0].actorUuid, actor.uuid);
    assert.equal(capabilities[0].itemUuid, "Item.counterspell");
    assert.deepEqual(capabilities[0].ownerUserIds, ["owner", "gm"]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

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

test("the next reactor is prompted when a failed Counterspell leaves the spell trigger active", async () => {
  const first = counterspellCandidate({ id: "first", selectedLevel: 3 });
  const second = counterspellCandidate({ id: "second", selectedLevel: 3 });
  const prompted = [];
  const service = makeService({
    candidates: (cast) => cast.parentId ? [] : [first, second],
    rollTotal: 11,
    prompt: async (candidate) => {
      prompted.push(candidate.id);
      return { accepted: true, spellLevel: candidate.id === "first" ? 3 : 5 };
    }
  });

  const result = await service.resolveCast(rootCast({ spellLevel: 5 }));

  assert.equal(result.cancelled, true);
  assert.deepEqual(prompted, ["first", "second"]);
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

test("Spell Shatter spends Sorcery Points and cancels when the caster fails its check", async () => {
  const events = [];
  let checked = null;
  const service = makeService({
    candidates: [spellShatterCandidate()],
    events,
    useActivityPayment: true,
    moduleApiExtras: {
      sorcererAutomationService: {
        spendSorceryPoints: async (actor, amount) => {
          events.push(`spend:${actor.id}:${amount}`);
          return true;
        },
        restoreSorceryPoints: async (actor, amount) => {
          events.push(`restore:${actor.id}:${amount}`);
          return true;
        }
      }
    }
  });
  service._options.rollAbilityCheck = async (attempt, dc, parent) => {
    checked = { kind: attempt.kind, dc, caster: parent.actorUuid };
    return 13;
  };

  const result = await service.resolveCast(rootCast({ spellLevel: 4, actorUuid: "Actor.enemy-caster" }));

  assert.equal(result.cancelled, true);
  assert.equal(result.chain[1].kind, "spell-shatter");
  assert.equal(result.chain[1].dc, 14);
  assert.equal(result.chain[1].rollTotal, 13);
  assert.deepEqual(checked, { kind: "spell-shatter", dc: 14, caster: "Actor.enemy-caster" });
  assert.deepEqual(events, [
    "spend:reactor:5",
    "restore:reactor:2",
    "reaction:reactor:spell-shatter"
  ]);
});

test("Spell Shatter leaves the spell active when the caster passes its check", async () => {
  const events = [];
  const service = makeService({
    candidates: [spellShatterCandidate()],
    events,
    useActivityPayment: true,
    rollTotal: 15,
    moduleApiExtras: {
      sorcererAutomationService: {
        spendSorceryPoints: async (actor, amount) => {
          events.push(`spend:${actor.id}:${amount}`);
          return true;
        },
        restoreSorceryPoints: async (actor, amount) => {
          events.push(`restore:${actor.id}:${amount}`);
          return true;
        }
      }
    }
  });

  const result = await service.resolveCast(rootCast({ spellLevel: 4 }));

  assert.equal(result.cancelled, false);
  assert.equal(result.chain[1].kind, "spell-shatter");
  assert.equal(result.chain[1].success, false);
  assert.deepEqual(events, [
    "spend:reactor:5",
    "reaction:reactor:spell-shatter"
  ]);
});

test("Spell Shatter rolls back Sorcery Points and its refund when reaction spending fails", async () => {
  const events = [];
  const service = makeService({
    candidates: [spellShatterCandidate()],
    events,
    consumeAvailable: false,
    useActivityPayment: true,
    moduleApiExtras: {
      sorcererAutomationService: {
        spendSorceryPoints: async (actor, amount) => {
          events.push(`spend:${actor.id}:${amount}`);
          return true;
        },
        restoreSorceryPoints: async (actor, amount) => {
          events.push(`restore:${actor.id}:${amount}`);
          return true;
        }
      }
    }
  });
  service._options.rollAbilityCheck = async () => 1;

  const result = await service.resolveCast(rootCast({ spellLevel: 4 }));

  assert.equal(result.cancelled, false);
  assert.equal(result.chain.length, 1);
  assert.deepEqual(events, [
    "spend:reactor:5",
    "restore:reactor:2",
    "reaction:reactor:spell-shatter",
    "spend:reactor:2",
    "restore:reactor:5"
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

test("the global reaction prompt offers only available Counterspell slot levels", async () => {
  const candidate = counterspellCandidate({ selectedLevel: 3 });
  candidate.actor.system.spells = {
    spell3: { level: 3, value: 0 },
    spell5: { level: 5, value: 1 }
  };
  let provider = null;
  const service = new SpellAutomationService({
    reactionQueueService: {
      registerType: (_kind, registered) => {
        provider = registered;
      }
    }
  });

  await service.initialize();
  const prompt = await provider.buildPrompt(candidate, {
    triggerId: "prompt-trigger",
    cast: rootCast({ spellLevel: 5 })
  });

  assert.deepEqual(prompt.fields[0].options, [{ value: 5, label: "5" }]);
});

test("repairCounterspellItems cleans legacy owned Counterspell activities", async () => {
  const service = makeService();
  const item = counterspellItem();
  const updateCalls = [];
  item.flags.dnd5e = {
    riders: {
      activity: ["legacy-check"]
    }
  };
  item.system.activities = {
    counterspell: {
      _id: "counterspell",
      type: "check",
      activation: { type: "reaction", value: 1 },
      check: { ability: "int" },
      spell: { level: 3, scaling: { mode: "level", formula: "" } }
    },
    legacyCheck: {
      _id: "legacyCheck",
      type: "check",
      check: { ability: "int" }
    }
  };
  item.update = async (patch, options) => {
    updateCalls.push({ patch, options });
    item.system.activities = patch["system.activities"];
    item.flags.dnd5e.riders.activity = patch["flags.dnd5e.riders.activity"];
    return item;
  };
  const actor = new TestActor({ id: "reactor", items: [item] });

  assert.equal(await service.repairCounterspellItems(actor), true);
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(Object.keys(updateCalls[0].patch["system.activities"]), ["counterspell"]);
  assert.equal(updateCalls[0].patch["system.activities"].counterspell.type, "utility");
  assert.equal(updateCalls[0].patch["system.activities"].counterspell.check, undefined);
  assert.deepEqual(updateCalls[0].patch["flags.dnd5e.riders.activity"], []);
  assert.deepEqual(updateCalls[0].options, { render: false, rebreyaRepair: true });
  assert.equal(await service.repairCounterspellItems(actor), false);
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

test("pre-use activity resumes when a lower-level Counterspell ability check fails", async () => {
  const service = makeService({
    candidates: [counterspellCandidate({ selectedLevel: 3 })],
    rollTotal: 10
  });
  const activity = {
    id: "activity-root",
    uuid: "Activity.root",
    actor: { uuid: "Actor.caster" },
    item: {
      uuid: "Item.root",
      system: { level: 6, components: { vocal: true, somatic: false } }
    },
    system: { range: { value: 90, units: "ft" } }
  };
  const usageConfig = {};

  assert.equal(await service.applyDnd5ePreUseActivity(activity, usageConfig), true);
  assert.equal(usageConfig.flags?.[MODULE_ID]?.reactionCheckComplete, true);
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

test("pre-use activity honors neutral cast-context components before resolving reactions", async () => {
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
    flags: {
      [MODULE_ID]: {
        castContext: {
          components: { verbal: false, somatic: false, material: true }
        }
      }
    }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(activity, usageConfig), true);
  assert.equal(usageConfig.flags?.["rebreya-main"]?.reactionCheckComplete, true);
});

test("indexed discovery measures TokenDocument centers for an in-range reactor", async () => {
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
    user: { id: "reactor-user", active: true, isGM: false }
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
  const moduleApi = {
    combatAttackService: reactionLedger(),
    reactionCapabilityIndex: {
      registerProvider: () => undefined,
      has: () => true,
      list: () => [candidate]
    }
  };
  moduleApi.reactionQueueService = new ReactionQueueService(moduleApi, {
    actorResolver: () => candidate.actor,
    isCoordinator: () => true,
    promptCandidate: async () => ({ accepted: true, spellLevel: 3 })
  });
  const service = new SpellAutomationService(moduleApi, {
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
    await service.initialize();
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

test("MIDI workflow continues when a lower-level Counterspell ability check fails", async () => {
  const service = makeService({
    candidates: [counterspellCandidate({ selectedLevel: 3 })],
    rollTotal: 10
  });
  const workflow = {
    id: "workflow-root",
    actor: { uuid: "Actor.caster" },
    item: {
      uuid: "Item.root",
      system: { level: 6, components: { verbal: true, somatic: false } }
    },
    activity: { uuid: "Activity.root", system: { range: { value: 90, units: "ft" } } }
  };

  assert.equal(await service.applyMidiWorkflow(workflow), true);
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

test("module API gates and conditionally initializes the generic spell automation service", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

  assert.match(source, /import \{ SpellAutomationService \} from "\.\/combat\/spell-automation-service\.js/);
  assert.match(
    source,
    /this\.spellAutomationService = COUNTERSPELL_AUTOMATION_ENABLED\s*\?\s*new SpellAutomationService\(this\)\s*:\s*null;/u
  );
  assert.match(source, /await this\.spellAutomationService\.initialize\(\);/);
  assert.match(source, /function dispatchSocketMessage\(message, senderId\)/);
  assert.match(source, /queuedSocketMessages\.push\(\{ message, senderId \}\)/);
  assert.match(source, /moduleApi\.handleSocketMessage\(queuedMessage\.message, queuedMessage\.senderId\)/);
  assert.match(source, /await this\.reactionQueueService\.handleSocketMessage\(message, senderId\)/);
  assert.doesNotMatch(source, /spellAutomationService\.handleSocketMessage/);
});
