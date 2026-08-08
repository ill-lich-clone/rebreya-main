import test from "node:test";
import assert from "node:assert/strict";

import {
  measureStoragePointDistance,
  measureStorageTokenDistance,
  preflightStorageAccess
} from "../scripts/data/storage-access.js";

function createToken({ id, uuid, actor, scene, x = 0, y = 0, visible = true }) {
  const document = { id, uuid, actor, parent: scene, x, y, width: 1, height: 1 };
  return {
    id,
    uuid,
    actor,
    document,
    center: { x: x + 50, y: y + 50 },
    visible
  };
}

test("player preflight reports distance without authorizing the storage action", () => {
  const player = { id: "player", isGM: false };
  const scene = { id: "scene" };
  const hero = createToken({
    id: "hero",
    uuid: "Scene.scene.Token.hero",
    scene,
    actor: {
      type: "character",
      testUserPermission: (user, permission) => user === player && permission === "OWNER"
    }
  });
  const storage = createToken({
    id: "chest",
    uuid: "Scene.scene.Token.chest",
    scene,
    actor: { type: "npc" },
    x: 500
  });
  const canvas = {
    grid: { measurePath: () => ({ distance: 10 }) },
    tokens: { controlled: [hero], get: () => null }
  };

  assert.deepEqual(preflightStorageAccess(storage, { game: { user: player }, canvas }), {
    allowed: false,
    reason: "distance",
    characterTokenUuid: "Scene.scene.Token.hero"
  });
});

test("GM preflight succeeds without a controlled character", () => {
  const storage = createToken({
    id: "chest",
    uuid: "Scene.scene.Token.chest",
    scene: { id: "scene" },
    actor: { type: "npc" }
  });

  assert.deepEqual(preflightStorageAccess(storage, {
    game: { user: { id: "gm", isGM: true } },
    canvas: { tokens: { controlled: [] } }
  }), {
    allowed: true,
    reason: "ok",
    characterTokenUuid: ""
  });
});

test("distance uses the nearest occupied grid spaces for large tokens", () => {
  const scene = { id: "scene" };
  const actor = { type: "character" };
  const hero = createToken({ id: "hero", uuid: "hero", actor, scene });
  hero.document.width = 2;
  hero.document.height = 2;
  hero.center = { x: 100, y: 100 };
  const chest = createToken({ id: "chest", uuid: "chest", actor: { type: "npc" }, scene, x: 200 });
  const canvas = {
    grid: {
      size: 100,
      measurePath: ([from, to]) => ({
        distance: Math.hypot(to.x - from.x, to.y - from.y) / 100 * 5
      })
    },
    tokens: { get: () => null }
  };

  assert.equal(measureStorageTokenDistance(hero, chest, { canvas }), 5);
  assert.equal(measureStoragePointDistance(hero, { x: 250, y: 50 }, { canvas }), 5);
});

test("diagonally adjacent squares are one five-foot storage step", () => {
  const scene = { id: "scene", grid: { type: 1, size: 100, distance: 5 } };
  const hero = createToken({ id: "hero", uuid: "hero", actor: { type: "character" }, scene });
  const chest = createToken({
    id: "chest",
    uuid: "chest",
    actor: { type: "npc" },
    scene,
    x: 100,
    y: 100
  });
  const canvas = {
    scene,
    grid: {
      size: 100,
      measurePath: ([from, to]) => ({
        distance: Math.hypot(to.x - from.x, to.y - from.y) / 100 * 5
      })
    },
    tokens: { get: () => null }
  };

  assert.equal(measureStorageTokenDistance(hero, chest, { canvas }), 5);
});

test("authoritative distance uses the token scene grid when the GM views another scene", () => {
  const tokenScene = { id: "token-scene", grid: { type: 1, size: 100, distance: 5 } };
  const hero = createToken({ id: "hero", uuid: "hero", actor: { type: "character" }, scene: tokenScene });
  const chest = createToken({
    id: "chest",
    uuid: "chest",
    actor: { type: "npc" },
    scene: tokenScene,
    x: 100,
    y: 100
  });
  const canvas = {
    scene: { id: "gm-scene", grid: { type: 0, size: 200, distance: 10 } },
    grid: {
      size: 200,
      measurePath: ([from, to]) => ({ distance: Math.hypot(to.x - from.x, to.y - from.y) / 20 })
    },
    tokens: { get: () => null }
  };

  assert.equal(measureStorageTokenDistance(hero, chest, { canvas }), 5);
});
