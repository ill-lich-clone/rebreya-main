import assert from "node:assert/strict";
import test from "node:test";

import {
  ALCHEMY_BOMB_MUTATION_COMMAND,
  isValidAlchemyBombMutationPayload,
  registerAlchemyBombSocketCommand
} from "../scripts/integrations/alchemy-bomb-socket.js";

function placePayload(overrides = {}) {
  return {
    action: "place",
    operationId: "workflow-1",
    actorUuid: "Actor.actor1",
    sourceTokenUuid: "Scene.scene1.Token.source1",
    sceneUuid: "Scene.scene1",
    itemUuid: "Actor.actor1.Item.item1",
    activityUuid: "Actor.actor1.Item.item1.Activity.activity1",
    productId: "alchemy-154",
    name: "Алхимический огонь",
    image: "modules/rebreya-main/fire.webp",
    x: 200,
    y: 300,
    elevation: 5,
    radius: 10,
    persistent: false,
    family: "alchemical-fire",
    dc: 12,
    durationSeconds: 0,
    ...overrides
  };
}

function cleanupPayload(overrides = {}) {
  return {
    action: "cleanup",
    operationId: "workflow-1",
    actorUuid: "Actor.actor1",
    sceneUuid: "Scene.scene1",
    tokenUuid: "Scene.scene1.Token.bomb1",
    templateUuid: "Scene.scene1.MeasuredTemplate.area1",
    regionUuid: "",
    ...overrides
  };
}

function resultPayload(overrides = {}) {
  return {
    action: "apply-results", operationId: "workflow-1", actorUuid: "Actor.actor1",
    sourceTokenUuid: "Scene.scene1.Token.source1", sceneUuid: "Scene.scene1", family: "alchemical-fire",
    failedTokenUuids: ["Scene.scene1.Token.target1"], savedTokenUuids: [], effect: { amount: 2, step: 1 },
    point: { x: 200, y: 300 }, regionUuid: "", ...overrides
  };
}

test("validates exact place and cleanup bomb mutation payloads", () => {
  assert.equal(isValidAlchemyBombMutationPayload(placePayload()), true);
  assert.equal(isValidAlchemyBombMutationPayload(cleanupPayload()), true);
  assert.equal(isValidAlchemyBombMutationPayload(resultPayload()), true);
  assert.equal(isValidAlchemyBombMutationPayload(placePayload({ x: Number.NaN })), false);
  assert.equal(isValidAlchemyBombMutationPayload(placePayload({ radius: 0 })), false);
  assert.equal(isValidAlchemyBombMutationPayload(placePayload({ itemUuid: "Actor.other.Item.item1" })), false);
  assert.equal(isValidAlchemyBombMutationPayload(placePayload({ sourceTokenUuid: "Scene.other.Token.source1" })), false);
  assert.equal(isValidAlchemyBombMutationPayload(cleanupPayload({ tokenUuid: "Scene.other.Token.bomb1" })), false);
  assert.equal(isValidAlchemyBombMutationPayload({ ...placePayload(), arbitrary: true }), false);
  assert.equal(isValidAlchemyBombMutationPayload({ ...cleanupPayload(), path: "system.attributes.hp" }), false);
  assert.equal(isValidAlchemyBombMutationPayload(resultPayload({ effect: { amount: 2, step: 1, path: "actor" } })), false);
});

test("registers once and authorizes only the throwing actor owner or GM", async () => {
  const actor = {
    uuid: "Actor.actor1",
    testUserPermission: (user, permission) => user?.id === "owner" && permission === "OWNER"
  };
  const registrations = new Map();
  const moduleApi = {
    alchemyBombRuntimeService: { handleSocketMutation() {} },
    socketCommandBus: { register: (name, definition) => registrations.set(name, definition) }
  };
  const options = { fromUuid: async (uuid) => uuid === actor.uuid ? actor : null };

  assert.equal(registerAlchemyBombSocketCommand(moduleApi, options), true);
  assert.equal(registerAlchemyBombSocketCommand(moduleApi, options), true);
  assert.equal(registrations.size, 1);
  const command = registrations.get(ALCHEMY_BOMB_MUTATION_COMMAND);
  assert.equal(await command.authorize(placePayload(), { sender: { id: "viewer", isGM: false } }), false);
  assert.equal(await command.authorize(placePayload(), { sender: { id: "owner", isGM: false } }), true);
  assert.equal(await command.authorize(placePayload(), { sender: { id: "gm", isGM: true } }), true);
});

test("execute rechecks scene and source token before delegating the mutation", async () => {
  const actor = { uuid: "Actor.actor1", testUserPermission: () => true };
  const scene = {
    uuid: "Scene.scene1",
    tokens: new Map([["source1", { actor: { uuid: actor.uuid } }]])
  };
  const calls = [];
  const registrations = new Map();
  registerAlchemyBombSocketCommand({
    alchemyBombRuntimeService: { handleSocketMutation: async (payload, context) => { calls.push({ payload, context }); return { ok: true }; } },
    socketCommandBus: { register: (name, definition) => registrations.set(name, definition) }
  }, { fromUuid: async (uuid) => uuid === actor.uuid ? actor : uuid === scene.uuid ? scene : null });

  const command = registrations.get(ALCHEMY_BOMB_MUTATION_COMMAND);
  assert.deepEqual(await command.execute(placePayload(), { sender: { id: "owner" } }), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.actor, actor);
  assert.equal(calls[0].context.scene, scene);

  scene.tokens.get("source1").actor.uuid = "Actor.other";
  await assert.rejects(() => command.execute(placePayload(), { sender: { id: "owner" } }), /source token/u);
});
