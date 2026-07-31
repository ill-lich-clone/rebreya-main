import assert from "node:assert/strict";
import test from "node:test";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { MODULE_ID } from "../scripts/constants.js";
import { SpellAutomationRegistry } from "../scripts/combat/spell-automation-registry.js";
import { SUMMON_LINK_FLAG, SummonLifecycleRuntime, buildSummonLink } from "../scripts/combat/summon-lifecycle-runtime.js";
import {
  SUMMON_LIFECYCLE_MUTATION_COMMAND,
  isValidSummonLifecycleMutationPayload,
  registerSummonLifecycleSocketCommand
} from "../scripts/integrations/summon-lifecycle-socket.js";

function declaration() { return { recipe: "animate-objects", version: 1 }; }
function actor() {
  return {
    uuid: "Actor.caster",
    ownership: { owner: 3 },
    testUserPermission(user, permission) { return permission === "OWNER" && this.ownership[user?.id] === 3; }
  };
}
function scene() {
  const tokens = new Map();
  const value = {
    uuid: "Scene.main",
    tokens,
    deletes: [],
    async deleteEmbeddedDocuments(type, ids) { assert.equal(type, "Token"); this.deletes.push([...ids]); },
    isOwner: true
  };
  tokens.set("source", { id: "source", actor: { uuid: "Actor.caster" }, parent: value, scene: value });
  return value;
}
function link(operationId = "operation") {
  return buildSummonLink({
    declaration: { runtime: "summon", ...declaration() }, operationId,
    activity: { uuid: "Actor.caster.Item.spell.Activity.summon", actor: { uuid: "Actor.caster" }, item: { uuid: "Actor.caster.Item.spell" } },
    sourceToken: { uuid: "Scene.main.Token.source" }
  });
}
function token(parent, id, summonLink = link()) {
  const token = {
    id, parent, scene: parent, flags: { [MODULE_ID]: { [SUMMON_LINK_FLAG]: structuredClone(summonLink) } }, updates: [],
    async update(patch) { this.updates.push(structuredClone(patch)); }
  };
  parent.tokens.set(id, token);
  return token;
}
function payload(overrides = {}) {
  const summonLink = overrides.link ?? link();
  return {
    action: "ensure-link", actorUuid: "Actor.caster", sceneUuid: "Scene.main", tokenIds: ["one"],
    declaration: declaration(), operationId: "operation", link: summonLink, ...overrides
  };
}
function runtime(options = {}) {
  return new SummonLifecycleRuntime({ registry: new SpellAutomationRegistry(), operationIdFactory: () => "unused", coordinator: new WorldMutationCoordinator(), ...options });
}

test("registers one summon lifecycle command", () => {
  const registrations = new Map();
  const api = { summonLifecycleRuntime: { handleSocketMutation() {} }, socketCommandBus: { register(command, definition) { registrations.set(command, definition); } } };
  assert.equal(registerSummonLifecycleSocketCommand(api), true);
  assert.equal(registerSummonLifecycleSocketCommand(api), true);
  assert.equal(registrations.size, 1);
  assert.ok(registrations.has(SUMMON_LIFECYCLE_MUTATION_COMMAND));
});

test("validates exact action actor scene token declaration operation and link payload", () => {
  assert.equal(isValidSummonLifecycleMutationPayload(payload()), true);
  assert.equal(isValidSummonLifecycleMutationPayload(payload({ action: "other" })), false);
  assert.equal(isValidSummonLifecycleMutationPayload(payload({ actorUuid: "Actor.caster.extra" })), false);
  assert.equal(isValidSummonLifecycleMutationPayload(payload({ sceneUuid: "Scene.main.extra" })), false);
  assert.equal(isValidSummonLifecycleMutationPayload(payload({ tokenIds: ["one", "one"] })), false);
  assert.equal(isValidSummonLifecycleMutationPayload(payload({ link: { ...link(), operationId: "other" } })), false);
  assert.equal(isValidSummonLifecycleMutationPayload(payload({ link: { ...link(), sourceItemUuid: "Actor.other.Item.spell" } })), false);
  assert.equal(isValidSummonLifecycleMutationPayload(payload({ link: { ...link(), sourceActivityUuid: "Actor.caster.Item.other.Activity.summon" } })), false);
  assert.equal(isValidSummonLifecycleMutationPayload(payload({ link: { ...link(), sourceTokenUuid: "Scene.other.Token.source" } })), false);
});

test("rejects arbitrary paths actor data foreign flags and poison keys", () => {
  assert.equal(isValidSummonLifecycleMutationPayload(payload({ path: "system.hp" })), false);
  assert.equal(isValidSummonLifecycleMutationPayload(payload({ actorData: { hp: 1 } })), false);
  assert.equal(isValidSummonLifecycleMutationPayload(payload({ link: { ...link(), flags: { foreign: true } } })), false);
  const poisoned = JSON.parse(JSON.stringify(payload()));
  poisoned.link.__proto__ = { polluted: true };
  assert.equal(isValidSummonLifecycleMutationPayload(poisoned), false);
});

test("authorizes only a source actor owner or GM", async () => {
  const source = actor();
  const registrations = new Map();
  registerSummonLifecycleSocketCommand({ summonLifecycleRuntime: { handleSocketMutation() {} }, socketCommandBus: { register(command, definition) { registrations.set(command, definition); } } }, { fromUuid: async () => source });
  const definition = registrations.get(SUMMON_LIFECYCLE_MUTATION_COMMAND);
  assert.equal(await definition.authorize(payload(), { sender: { id: "viewer", isGM: false } }), false);
  assert.equal(await definition.authorize(payload(), { sender: { id: "owner", isGM: false } }), true);
  assert.equal(await definition.authorize(payload(), { sender: { id: "gm", isGM: true } }), true);
});

test("the active GM resolves exact token ids and mutates only matching summon links", async () => {
  const source = actor();
  const world = scene();
  const matching = token(world, "one");
  const foreign = token(world, "two", { ...link(), operationId: "foreign" });
  const instance = runtime();
  const registrations = new Map();
  registerSummonLifecycleSocketCommand({ summonLifecycleRuntime: instance, socketCommandBus: { register(command, definition) { registrations.set(command, definition); } } }, {
    fromUuid: async (uuid) => uuid === source.uuid ? source : uuid === world.uuid ? world : null
  });
  const definition = registrations.get(SUMMON_LIFECYCLE_MUTATION_COMMAND);

  await definition.execute(payload({ tokenIds: ["one", "two"] }), { sender: { id: "owner", isGM: false } });

  assert.equal(matching.updates.length, 1);
  assert.equal(foreign.updates.length, 0);
});

test("a duplicate command is idempotent", async () => {
  const source = actor();
  const world = scene();
  const managed = token(world, "one");
  const instance = runtime();
  const command = payload();

  await Promise.all([
    instance.handleSocketMutation(command, { actor: source, scene: world }),
    instance.handleSocketMutation(command, { actor: source, scene: world })
  ]);

  assert.equal(managed.updates.length, 1);
});

test("remote ensure-link accepts an incomplete exact marker and corrected links are not stale-cached", async () => {
  const source = actor();
  const world = scene();
  const complete = link();
  const managed = token(world, "one", { ...complete, sourceItemUuid: "" });
  const instance = runtime();
  const corrected = { ...complete, controllingEffectUuid: "Actor.caster.ActiveEffect.concentration" };

  await instance.handleSocketMutation(payload({ link: complete }), { actor: source, scene: world });
  await instance.handleSocketMutation(payload({ link: corrected }), { actor: source, scene: world });

  assert.equal(managed.updates.length, 2);
});

test("rechecks the raw marker before every awaited remote update", async () => {
  const source = actor();
  const world = scene();
  const first = token(world, "one");
  const second = token(world, "two");
  first.update = async (patch) => { first.updates.push(patch); second.flags[MODULE_ID][SUMMON_LINK_FLAG].operationId = "foreign"; };

  await runtime().handleSocketMutation(payload({ tokenIds: ["one", "two"] }), { actor: source, scene: world });

  assert.equal(first.updates.length, 1);
  assert.equal(second.updates.length, 0);
});
