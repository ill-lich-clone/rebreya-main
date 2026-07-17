import assert from "node:assert/strict";
import test from "node:test";

import { ReactionCapabilityIndex } from "../scripts/combat/reaction-capability-index.js";

function actor(id, items = []) {
  return {
    id,
    uuid: `Actor.${id}`,
    items
  };
}

function token(id, actorDocument) {
  return {
    id,
    uuid: `Scene.scene-1.Token.${id}`,
    actor: actorDocument
  };
}

test("reaction capability index lazily builds the active scene once", () => {
  const caster = actor("caster", [{ uuid: "Actor.caster.Item.counterspell" }]);
  const scene = { id: "scene-1", tokens: [token("caster-token", caster)] };
  let resolverCalls = 0;
  const index = new ReactionCapabilityIndex({ sceneProvider: () => scene });

  index.registerProvider("counterspell", ({ actor: indexedActor, token: indexedToken }) => {
    resolverCalls += 1;
    return indexedActor.items.map((item) => ({
      actorUuid: indexedActor.uuid,
      tokenUuid: indexedToken.uuid,
      itemUuid: item.uuid
    }));
  });

  assert.equal(resolverCalls, 0);
  assert.equal(index.has("counterspell"), true);
  assert.deepEqual(index.list("counterspell"), [{
    kind: "counterspell",
    providerId: "counterspell",
    actorUuid: "Actor.caster",
    tokenUuid: "Scene.scene-1.Token.caster-token",
    itemUuid: "Actor.caster.Item.counterspell",
    activityId: "",
    ownerUserIds: []
  }]);
  assert.equal(index.has("counterspell"), true);
  assert.equal(resolverCalls, 1);
});

test("reaction capability index refreshes only the changed actor", () => {
  const first = actor("first", [{ uuid: "Actor.first.Item.reaction" }]);
  const second = actor("second", [{ uuid: "Actor.second.Item.reaction" }]);
  const scene = {
    id: "scene-1",
    tokens: [token("first-token", first), token("second-token", second)]
  };
  const calls = new Map();
  const index = new ReactionCapabilityIndex({ sceneProvider: () => scene });
  index.registerProvider("guard", ({ actor: indexedActor, token: indexedToken }) => {
    calls.set(indexedActor.uuid, (calls.get(indexedActor.uuid) ?? 0) + 1);
    return indexedActor.items.map((item) => ({
      actorUuid: indexedActor.uuid,
      tokenUuid: indexedToken.uuid,
      itemUuid: item.uuid
    }));
  });

  assert.equal(index.list("guard").length, 2);
  first.items = [];
  index.refreshActor(first);

  assert.deepEqual(index.list("guard").map((entry) => entry.actorUuid), ["Actor.second"]);
  assert.equal(calls.get("Actor.first"), 2);
  assert.equal(calls.get("Actor.second"), 1);
});

test("reaction capability index removes only descriptors for a deleted token", () => {
  const guardian = actor("guardian", [{ uuid: "Actor.guardian.Item.interception" }]);
  const firstToken = token("first-guardian", guardian);
  const secondToken = token("second-guardian", guardian);
  const scene = { id: "scene-1", tokens: [firstToken, secondToken] };
  const index = new ReactionCapabilityIndex({ sceneProvider: () => scene });
  index.registerProvider("interception", ({ actor: indexedActor, token: indexedToken }) => [{
    actorUuid: indexedActor.uuid,
    tokenUuid: indexedToken.uuid,
    itemUuid: indexedActor.items[0].uuid
  }]);

  assert.equal(index.list("interception").length, 2);
  index.removeToken(firstToken.uuid);

  assert.deepEqual(index.list("interception").map((entry) => entry.tokenUuid), [secondToken.uuid]);
});

test("reaction capability index rebuilds lazily after the active scene is invalidated", () => {
  const watcher = actor("watcher", [{ uuid: "Actor.watcher.Item.storm" }]);
  const scene = { id: "scene-1", tokens: [token("watcher-token", watcher)] };
  const index = new ReactionCapabilityIndex({ sceneProvider: () => scene });
  index.registerProvider("storm", ({ actor: indexedActor, token: indexedToken }) => [{
    actorUuid: indexedActor.uuid,
    tokenUuid: indexedToken.uuid,
    itemUuid: indexedActor.items[0].uuid
  }]);

  assert.equal(index.has("storm"), true);
  scene.tokens = [];
  index.invalidateScene("scene-1");

  assert.equal(index.has("storm"), false);
  assert.deepEqual(index.list("storm"), []);
});

test("reaction capability index adds one new token and removes one deleted actor", () => {
  const first = actor("first", [{ uuid: "Actor.first.Item.guard" }]);
  const second = actor("second", [{ uuid: "Actor.second.Item.guard" }]);
  const firstToken = token("first-token", first);
  const secondToken = token("second-token", second);
  const scene = { id: "scene-1", tokens: [firstToken] };
  const calls = new Map();
  const index = new ReactionCapabilityIndex({ sceneProvider: () => scene });
  index.registerProvider("guard", ({ actor: indexedActor, token: indexedToken }) => {
    calls.set(indexedActor.uuid, (calls.get(indexedActor.uuid) ?? 0) + 1);
    return [{
      actorUuid: indexedActor.uuid,
      tokenUuid: indexedToken.uuid,
      itemUuid: indexedActor.items[0].uuid
    }];
  });

  assert.equal(index.list("guard").length, 1);
  scene.tokens.push(secondToken);
  index.refreshToken(secondToken);
  assert.deepEqual(index.list("guard").map((entry) => entry.actorUuid), [
    first.uuid,
    second.uuid
  ]);
  assert.equal(calls.get(first.uuid), 1);
  assert.equal(calls.get(second.uuid), 1);

  index.removeActor(first.uuid);
  assert.deepEqual(index.list("guard").map((entry) => entry.actorUuid), [second.uuid]);
});
