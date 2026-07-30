import test from "node:test";
import assert from "node:assert/strict";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import {
  COMMAND_REQUEST_TYPE,
  COMMAND_RESULT_TYPE,
  SocketCommandBus
} from "../scripts/infrastructure/foundry/socket-command-bus.js";
import {
  SPELL_INSTANCE_FLAG,
  SpellInstanceRuntime,
  buildSpellInstanceEffectData,
  readSpellInstance
} from "../scripts/combat/spell-instance-runtime.js";
import {
  SPELL_INSTANCE_MUTATION_COMMAND,
  isValidSpellInstanceMutationPayload,
  registerSpellInstanceSocketCommand
} from "../scripts/integrations/spell-instance-socket.js";

const MODULE_ID = "rebreya-main";

function clone(value) {
  return structuredClone(value);
}

function assignPath(target, path, value) {
  const keys = path.split(".");
  let current = target;
  for (const key of keys.slice(0, -1)) {
    current[key] ??= {};
    current = current[key];
  }
  current[keys.at(-1)] = clone(value);
}

function createEffect(actor, data = {}) {
  return {
    actor,
    flags: clone(data.flags ?? {}),
    id: data.id ?? `effect-${actor.nextEffectId++}`,
    uuid: data.uuid ?? `${actor.uuid}.ActiveEffect.${data.id ?? actor.nextEffectId - 1}`,
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(update) {
      for (const [path, value] of Object.entries(update)) {
        assignPath(this, path, value);
      }
      return this;
    }
  };
}

function createActor({ ownerIds = ["owner"], uuid = "Actor.caster" } = {}) {
  const actor = {
    createCalls: [],
    deleteCalls: [],
    effects: [],
    nextEffectId: 1,
    ownership: Object.fromEntries(ownerIds.map((id) => [id, 3])),
    uuid,
    testUserPermission(user, permission) {
      return permission === "OWNER" && Number(this.ownership[user?.id] ?? 0) >= 3;
    },
    async createEmbeddedDocuments(type, documents) {
      this.createCalls.push({ type, documents: clone(documents) });
      const created = documents.map((document) => createEffect(this, document));
      this.effects.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(type, ids) {
      this.deleteCalls.push({ type, ids: [...ids] });
      this.effects = this.effects.filter((effect) => !ids.includes(effect.id));
      return ids;
    }
  };
  return actor;
}

function createContext(actor, overrides = {}) {
  const concentrationEffect = createEffect(actor, {
    id: "concentration",
    uuid: `${actor.uuid}.ActiveEffect.concentration`
  });
  actor.effects.push(concentrationEffect);
  return {
    actor,
    activity: { uuid: `${actor.uuid}.Item.melf.Activity.cast` },
    concentrationEffect,
    declaration: { recipe: "melfs-minute-meteors", version: 1 },
    instanceId: "melf-instance",
    item: { uuid: `${actor.uuid}.Item.melf` },
    operationId: "cast-operation",
    ...overrides
  };
}

function createRuntime(options = {}) {
  return new SpellInstanceRuntime({
    coordinator: new WorldMutationCoordinator(),
    linkDependency: async () => {},
    ...options
  });
}

function createPayload(overrides = {}) {
  return {
    action: "create",
    actorUuid: "Actor.caster",
    concentrationEffectUuid: "Actor.caster.ActiveEffect.concentration",
    declaration: { recipe: "melfs-minute-meteors", version: 1 },
    expectedRevision: 0,
    instanceId: "melf-instance",
    operationId: "cast-operation",
    sourceActivityUuid: "Actor.caster.Item.melf.Activity.cast",
    sourceItemUuid: "Actor.caster.Item.melf",
    state: { remainingMeteors: 6 },
    ...overrides
  };
}

function createReplacePayload(overrides = {}) {
  return {
    action: "replace-state",
    actorUuid: "Actor.caster",
    declaration: { recipe: "melfs-minute-meteors", version: 1 },
    expectedRevision: 0,
    instanceId: "melf-instance",
    operationId: "replace-operation",
    state: { remainingMeteors: 5 },
    ...overrides
  };
}

function createDeletePayload(overrides = {}) {
  return {
    action: "delete",
    actorUuid: "Actor.caster",
    declaration: { recipe: "melfs-minute-meteors", version: 1 },
    expectedRevision: 0,
    instanceId: "melf-instance",
    operationId: "delete-operation",
    ...overrides
  };
}

function createModuleApi(runtime) {
  const registrations = new Map();
  return {
    registrations,
    spellInstanceRuntime: runtime,
    socketCommandBus: {
      register(command, definition) {
        registrations.set(command, definition);
      }
    }
  };
}

function createBusHarness({ actor = createActor(), ownerIds = ["owner"] } = {}) {
  actor.ownership = Object.fromEntries(ownerIds.map((id) => [id, 3]));
  const emitted = [];
  const activeGm = { active: true, id: "gm", isGM: true };
  const owner = { active: true, id: "owner", isGM: false };
  const viewer = { active: true, id: "viewer", isGM: false };
  const game = {
    socket: { emit: (...args) => emitted.push(args) },
    user: activeGm,
    users: { contents: [activeGm, owner, viewer] }
  };
  const bus = new SocketCommandBus({ gameProvider: () => game });
  registerSpellInstanceSocketCommand({ socketCommandBus: bus, spellInstanceRuntime: createRuntime() }, {
    fromUuid: async (uuid) => uuid === actor.uuid ? actor : null
  });
  return { actor, bus, emitted };
}

async function dispatch(bus, payload, { requestId = "request-one", senderId = "owner" } = {}) {
  bus.handleMessage({
    type: COMMAND_REQUEST_TYPE,
    command: SPELL_INSTANCE_MUTATION_COMMAND,
    requestId,
    senderId,
    payload
  }, { transportSenderId: senderId });
  await new Promise((resolve) => setImmediate(resolve));
}

test("an owner performs the mutation locally", async () => {
  // Catches routing an actor owner's normal cast through the GM socket.
  const actor = createActor();
  const socketCommandBus = { request() { throw new Error("socket should not be used"); } };
  const runtime = createRuntime({ canUpdateActor: () => true, socketCommandBus });

  const result = await runtime.createInstance(createContext(actor), { remainingMeteors: 6 });

  assert.equal(actor.createCalls.length, 1);
  assert.equal(result.state.remainingMeteors, 6);
});

test("a non-owner requests the active GM once", async () => {
  // Catches a non-owner updating a local Actor document or emitting multiple requests.
  const actor = createActor({ ownerIds: [] });
  const context = createContext(actor);
  const data = buildSpellInstanceEffectData(context, context.declaration, { remainingMeteors: 6 });
  actor.effects.push(createEffect(actor, data));
  const requests = [];
  const runtime = createRuntime({
    canUpdateActor: () => false,
    socketCommandBus: { async request(command, payload) {
      requests.push({ command, payload: clone(payload) });
      return { instanceId: payload.instanceId, revision: 1, state: payload.state };
    } }
  });

  const result = await runtime.updateInstance({
    actor, instanceId: context.instanceId, expectedRevision: 0,
    operationId: "volley-one", state: { remainingMeteors: 5 }
  });

  assert.deepEqual(result, { instanceId: "melf-instance", revision: 1, state: { remainingMeteors: 5 } });
  assert.equal(actor.effects.at(-1).updateCalls?.length ?? 0, 0);
  assert.deepEqual(requests, [{
    command: SPELL_INSTANCE_MUTATION_COMMAND,
    payload: {
      action: "replace-state", actorUuid: "Actor.caster",
      declaration: { recipe: "melfs-minute-meteors", version: 1 },
      expectedRevision: 0, instanceId: "melf-instance", operationId: "volley-one",
      state: { remainingMeteors: 5 }
    }
  }]);
});

test("validates the serialized action actor instance revision and operation id", () => {
  // Catches protocol messages that omit concurrency identity or carry executable state.
  assert.equal(isValidSpellInstanceMutationPayload(createPayload()), true);
  assert.equal(isValidSpellInstanceMutationPayload(createPayload({ action: "launch" })), false);
  assert.equal(isValidSpellInstanceMutationPayload(createPayload({ actorUuid: "" })), false);
  assert.equal(isValidSpellInstanceMutationPayload(createPayload({ instanceId: "" })), false);
  assert.equal(isValidSpellInstanceMutationPayload(createPayload({ expectedRevision: -1 })), false);
  assert.equal(isValidSpellInstanceMutationPayload(createPayload({ operationId: "" })), false);
  assert.equal(isValidSpellInstanceMutationPayload(createPayload({ state: { callback() {} } })), false);
});

test("authorizes only a sender who owns the source actor or is GM", async () => {
  // Catches accepting a viewer's request for another player's actor.
  const actor = createActor({ ownerIds: ["owner"] });
  const runtime = createRuntime();
  const moduleApi = createModuleApi(runtime);
  registerSpellInstanceSocketCommand(moduleApi, { fromUuid: async () => actor });
  const definition = moduleApi.registrations.get(SPELL_INSTANCE_MUTATION_COMMAND);
  const payload = createPayload();

  assert.equal(await definition.authorize(payload, { sender: { id: "viewer", isGM: false } }), false);
  assert.equal(await definition.authorize(payload, { sender: { id: "owner", isGM: false } }), true);
  assert.equal(await definition.authorize(payload, { sender: { id: "gm", isGM: true } }), true);
});

test("the active GM resolves only the payload actor uuid", async () => {
  // Catches the authoritative handler resolving caller-controlled source UUIDs.
  const actor = createActor();
  const context = createContext(actor);
  const runtime = createRuntime();
  const moduleApi = createModuleApi(runtime);
  const resolved = [];
  registerSpellInstanceSocketCommand(moduleApi, {
    fromUuid: async (uuid) => {
      resolved.push(uuid);
      return uuid === actor.uuid ? actor : null;
    }
  });
  const definition = moduleApi.registrations.get(SPELL_INSTANCE_MUTATION_COMMAND);
  const payload = createPayload();

  const result = await definition.execute(payload, { sender: { id: "owner", isGM: false } });

  assert.deepEqual(resolved, ["Actor.caster"]);
  assert.equal(result.sourceItemUuid, context.item.uuid);
  assert.equal(actor.createCalls.length, 1);
});

test("a duplicate socket request is idempotent", async () => {
  // Catches a retried network request creating a second spell-instance effect.
  const actor = createActor();
  createContext(actor);
  const runtime = createRuntime();
  const moduleApi = createModuleApi(runtime);
  registerSpellInstanceSocketCommand(moduleApi, { fromUuid: async () => actor });
  const execute = moduleApi.registrations.get(SPELL_INSTANCE_MUTATION_COMMAND).execute;
  const payload = createPayload();

  const [first, repeated] = await Promise.all([
    execute(payload, { sender: { id: "owner", isGM: false } }),
    execute(payload, { sender: { id: "owner", isGM: false } })
  ]);

  assert.equal(actor.createCalls.length, 1);
  assert.equal(first.instanceId, repeated.instanceId);
});

test("rejects arbitrary update paths and foreign actor uuids", async () => {
  // Catches the protocol becoming a generic document-update capability.
  const actor = createActor({ uuid: "Actor.other" });
  const runtime = createRuntime();
  const moduleApi = createModuleApi(runtime);
  registerSpellInstanceSocketCommand(moduleApi, { fromUuid: async () => actor });
  const definition = moduleApi.registrations.get(SPELL_INSTANCE_MUTATION_COMMAND);

  assert.equal(isValidSpellInstanceMutationPayload(createPayload({ path: "system.hp.value" })), false);
  assert.equal(isValidSpellInstanceMutationPayload(createPayload({
    sourceItemUuid: "Actor.foreign.Item.staff"
  })), false);
  assert.equal(isValidSpellInstanceMutationPayload(createPayload({
    sourceItemUuid: "Actor.caster.JournalEntry.unrelated"
  })), false);
  assert.equal(await definition.authorize(createPayload(), { sender: { id: "owner", isGM: false } }), false);
});

test("only the active GM executes a received mutation", async () => {
  // Catches a standby GM performing the mutation after the bus selects another active GM.
  const actor = createActor();
  createContext(actor);
  const runtime = createRuntime();
  const emitted = [];
  const activeGm = { active: true, id: "a-gm", isGM: true };
  const standbyGm = { active: true, id: "z-gm", isGM: true };
  const owner = { active: true, id: "owner", isGM: false };
  const game = {
    socket: { emit: (...args) => emitted.push(args) },
    user: standbyGm,
    users: { contents: [activeGm, standbyGm, owner] }
  };
  const bus = new SocketCommandBus({ gameProvider: () => game });
  registerSpellInstanceSocketCommand({ socketCommandBus: bus, spellInstanceRuntime: runtime }, {
    fromUuid: async () => actor
  });

  bus.handleMessage({
    type: COMMAND_REQUEST_TYPE,
    command: SPELL_INSTANCE_MUTATION_COMMAND,
    requestId: "request-one",
    senderId: "owner",
    payload: createPayload()
  }, { transportSenderId: "owner" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(actor.createCalls.length, 0);
  assert.deepEqual(emitted, []);
});

test("propagates an active-GM socket error to the non-owner", async () => {
  // Catches a rejected authoritative mutation being turned into a false local success.
  const actor = createActor({ ownerIds: [] });
  const context = createContext(actor);
  const data = buildSpellInstanceEffectData(context, context.declaration, { remainingMeteors: 6 });
  actor.effects.push(createEffect(actor, data));
  const runtime = createRuntime({
    canUpdateActor: () => false,
    socketCommandBus: { request: async () => { throw new Error("active GM rejected mutation"); } }
  });

  await assert.rejects(runtime.deleteInstance({
    actor, instanceId: context.instanceId, expectedRevision: 0, operationId: "delete-one"
  }), /active GM rejected mutation/u);
  assert.equal(actor.deleteCalls.length, 0);
});

test("rejects own poison keys in serialized state without mutating or polluting prototypes", async () => {
  // Catches JSON-originated own __proto__ keys reaching a mutation or a clone operation.
  const { actor, bus, emitted } = createBusHarness();
  createContext(actor);
  const payload = JSON.parse(JSON.stringify(createPayload()));
  payload.state = JSON.parse('{"batches":[{"nested":{"__proto__":{"polluted":true}}}]}');

  await dispatch(bus, payload);

  assert.equal(actor.createCalls.length, 0);
  assert.equal({}.polluted, undefined);
  assert.equal(emitted.at(-1)[1].type, COMMAND_RESULT_TYPE);
  assert.deepEqual(emitted.at(-1)[1].error, {
    code: "invalid-payload", message: "Socket command payload is invalid"
  });
});

test("rejects own constructor and prototype keys at every serialized depth", () => {
  // Catches poison keys hidden in array members or declaration objects.
  const constructorPayload = JSON.parse(JSON.stringify(createPayload({
    state: { entries: [{ constructor: { poisoned: true } }] }
  })));
  const prototypePayload = JSON.parse(JSON.stringify(createPayload({
    state: { entries: [{ deeply: { prototype: { poisoned: true } } }] }
  })));
  const declarationPayload = JSON.parse(JSON.stringify(createPayload()));
  declarationPayload.declaration = JSON.parse(
    '{"recipe":"melfs-minute-meteors","version":1,"__proto__":{"poisoned":true}}'
  );

  assert.equal(isValidSpellInstanceMutationPayload(constructorPayload), false);
  assert.equal(isValidSpellInstanceMutationPayload(prototypePayload), false);
  assert.equal(isValidSpellInstanceMutationPayload(declarationPayload), false);
});

test("accepts only exact world or synthetic actor UUID document chains", () => {
  // Catches prefix/trailing-segment UUIDs crossing actor, item, activity, or effect boundaries.
  const malformed = [
    createPayload({ actorUuid: "Actor." }),
    createPayload({ sourceItemUuid: "Actor.caster.Item." }),
    createPayload({ sourceItemUuid: "Actor.caster.Item.melf.extra" }),
    createPayload({ sourceActivityUuid: "Actor.caster.Item.melf.Activity.cast.extra" }),
    createPayload({ concentrationEffectUuid: "Actor.caster.ActiveEffect.concentration.extra" }),
    createPayload({ sourceActivityUuid: "Actor.other.Item.melf.Activity.cast" }),
    createPayload({ sourceActivityUuid: "Actor.caster.Item.other.Activity.cast" })
  ];
  const synthetic = createPayload({
    actorUuid: "Scene.scene.Token.token.Actor.delta",
    concentrationEffectUuid: "Scene.scene.Token.token.Actor.delta.ActiveEffect.concentration",
    sourceActivityUuid: "Scene.scene.Token.token.Actor.delta.Item.melf.Activity.cast",
    sourceItemUuid: "Scene.scene.Token.token.Actor.delta.Item.melf"
  });

  assert.deepEqual(malformed.map(isValidSpellInstanceMutationPayload), [false, false, false, false, false, false, false]);
  assert.equal(isValidSpellInstanceMutationPayload(synthetic), true);
});

test("replace-state and delete reject malformed actor UUID roots", () => {
  // Catches non-create actions bypassing the strict actor-root parser.
  const malformedActorUuids = [
    "JournalEntry.any",
    "Actor.",
    "Scene.scene.Token.token.Actor.",
    "Actor.caster.extra"
  ];

  for (const actorUuid of malformedActorUuids) {
    assert.equal(isValidSpellInstanceMutationPayload(createReplacePayload({ actorUuid })), false);
    assert.equal(isValidSpellInstanceMutationPayload(createDeletePayload({ actorUuid })), false);
  }
});

test("replace-state and delete retain exact world and synthetic actor roots", () => {
  // Catches hardening that blocks valid documented actor identities for non-create actions.
  const actorUuids = ["Actor.caster", "Scene.scene.Token.token.Actor.delta"];

  for (const actorUuid of actorUuids) {
    assert.equal(isValidSpellInstanceMutationPayload(createReplacePayload({ actorUuid })), true);
    assert.equal(isValidSpellInstanceMutationPayload(createDeletePayload({ actorUuid })), true);
  }
});

test("the real command bus executes a valid owner mutation end to end", async () => {
  // Catches registration that only works when handlers are invoked manually.
  const { actor, bus, emitted } = createBusHarness();
  createContext(actor);

  await dispatch(bus, createPayload());

  assert.equal(actor.createCalls.length, 1);
  assert.equal(emitted.at(-1)[1].ok, true);
  assert.equal(emitted.at(-1)[1].data.instanceId, "melf-instance");
});

test("the real command bus denies a non-owner without mutation", async () => {
  // Catches authorization being bypassed by an envelope that reaches the active GM.
  const { actor, bus, emitted } = createBusHarness({ ownerIds: ["owner"] });
  createContext(actor);

  await dispatch(bus, createPayload(), { senderId: "viewer" });

  assert.equal(actor.createCalls.length, 0);
  assert.deepEqual(emitted.at(-1)[1].error, {
    code: "unauthorized", message: "Socket command is not authorized"
  });
});

test("the real command bus rejects malformed payloads before authorization or mutation", async () => {
  // Catches a closed protocol accepting an arbitrary document-update path in an envelope.
  const { actor, bus, emitted } = createBusHarness();
  createContext(actor);

  await dispatch(bus, createPayload({ path: "system.attributes.hp.value" }));

  assert.equal(actor.createCalls.length, 0);
  assert.deepEqual(emitted.at(-1)[1].error, {
    code: "invalid-payload", message: "Socket command payload is invalid"
  });
});

test("the real command bus executes duplicate request envelopes once", async () => {
  // Catches retries bypassing the bus request-id cache and duplicating the effect.
  const { actor, bus, emitted } = createBusHarness();
  createContext(actor);
  const payload = createPayload();

  await dispatch(bus, payload, { requestId: "duplicate-request" });
  await dispatch(bus, payload, { requestId: "duplicate-request" });

  assert.equal(actor.createCalls.length, 1);
  assert.equal(emitted.filter(([, message]) => message.ok).length, 2);
});
