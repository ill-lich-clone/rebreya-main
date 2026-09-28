import test from "node:test";
import assert from "node:assert/strict";

import {
  isStorageTokenVisible,
  measureStoragePointDistance,
  measureStorageTokenDistance,
  preflightStorageAccess
} from "../scripts/data/storage-access.js";

function createToken({ id, uuid, actor, scene, x = 0, y = 0, visible = true, hidden = false }) {
  const document = { id, uuid, actor, parent: scene, x, y, width: 1, height: 1, hidden };
  return {
    id,
    uuid,
    actor,
    document,
    center: { x: x + 50, y: y + 50 },
    visible
  };
}

test("authoritative storage visibility ignores transient Token.object.visible from the active GM canvas", () => {
  const storage = createToken({
    id: "chest",
    uuid: "Scene.scene.Token.chest",
    scene: { id: "scene" },
    actor: { type: "npc" },
    visible: false
  });
  const canvas = {
    tokens: {
      get: () => ({ visible: false })
    }
  };

  assert.equal(isStorageTokenVisible(storage, { canvas }), true);
});

test("authoritative storage visibility rejects a hidden TokenDocument", () => {
  const storage = createToken({
    id: "chest",
    uuid: "Scene.scene.Token.chest",
    scene: { id: "scene" },
    actor: { type: "npc" },
    hidden: true
  });

  assert.equal(isStorageTokenVisible(storage), false);
});

test("player preflight allows storage interaction at exactly ten feet", () => {
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
    tokens: { controlled: [hero], placeables: [hero, storage], get: () => null }
  };

  assert.deepEqual(preflightStorageAccess(storage, { game: { user: player }, canvas }), {
    allowed: true,
    reason: "ok",
    characterTokenUuid: "Scene.scene.Token.hero"
  });
});

test("player preflight rejects storage interaction beyond ten feet", () => {
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
    grid: { measurePath: () => ({ distance: 11 }) },
    tokens: { controlled: [hero], placeables: [hero, storage], get: () => null }
  };

  assert.deepEqual(preflightStorageAccess(storage, { game: { user: player }, canvas }), {
    allowed: false,
    reason: "distance",
    characterTokenUuid: "Scene.scene.Token.hero"
  });
});

test("player preflight ignores a controlled map object and selects the nearest owned character", () => {
  const player = { id: "player", isGM: false };
  const scene = { id: "scene" };
  const ownedActor = {
    type: "character",
    testUserPermission: (user, permission) => user === player && permission === "OWNER"
  };
  const calendar = createToken({
    id: "calendar",
    uuid: "Scene.scene.Token.calendar",
    scene,
    actor: { type: "loot" },
    x: 200
  });
  const farHero = createToken({
    id: "far-hero",
    uuid: "Scene.scene.Token.far",
    scene,
    actor: ownedActor,
    x: 0
  });
  const nearHero = createToken({
    id: "near-hero",
    uuid: "Scene.scene.Token.near",
    scene,
    actor: ownedActor,
    x: 100
  });
  const storage = createToken({
    id: "chest",
    uuid: "Scene.scene.Token.chest",
    scene,
    actor: { type: "npc" },
    x: 200
  });
  const canvas = {
    grid: {
      measurePath: ([from, to]) => ({ distance: Math.abs(to.x - from.x) / 100 * 5 })
    },
    tokens: {
      controlled: [calendar],
      placeables: [calendar, farHero, nearHero, storage],
      get: () => null
    }
  };

  assert.deepEqual(preflightStorageAccess(storage, { game: { user: player }, canvas }), {
    allowed: true,
    reason: "ok",
    characterTokenUuid: nearHero.document.uuid
  });
});

test("an owned controlled character wins an equal-distance tie", () => {
  const player = { id: "player", isGM: false };
  const scene = { id: "scene" };
  const actor = {
    type: "character",
    testUserPermission: () => true
  };
  const first = createToken({ id: "a", uuid: "Scene.scene.Token.a", scene, actor, x: 0 });
  const controlled = createToken({ id: "z", uuid: "Scene.scene.Token.z", scene, actor, x: 200 });
  const storage = createToken({ id: "chest", uuid: "chest", scene, actor: { type: "npc" }, x: 100 });
  const canvas = {
    grid: { measurePath: () => ({ distance: 5 }) },
    tokens: { controlled: [controlled], placeables: [first, controlled, storage], get: () => null }
  };

  assert.equal(
    preflightStorageAccess(storage, { game: { user: player }, canvas }).characterTokenUuid,
    controlled.document.uuid
  );
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

test("fractional off-grid token footprints use their nearest occupied grid spaces", () => {
  const scene = { id: "scene", grid: { type: 1, size: 100, distance: 5 } };
  const hero = createToken({
    id: "hero",
    uuid: "Scene.scene.Token.hero",
    actor: { type: "character" },
    scene,
    x: 10,
    y: 10
  });
  hero.document.width = 1.5;
  hero.center = { x: 85, y: 60 };
  const barrel = createToken({
    id: "barrel",
    uuid: "Scene.scene.Token.barrel",
    actor: { type: "npc" },
    scene,
    x: 200,
    y: 110
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

  assert.equal(measureStorageTokenDistance(hero, barrel, { canvas }), 5);
  assert.equal(measureStoragePointDistance(hero, { x: 250, y: 150 }, { canvas }), 5);
});

test("every point inside an adjacent square is within five feet for a ground drop", () => {
  const scene = { id: "scene", grid: { type: 1, size: 100, distance: 5 } };
  const hero = createToken({
    id: "hero",
    uuid: "Scene.scene.Token.hero",
    scene,
    actor: { type: "character" }
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

  assert.equal(measureStoragePointDistance(hero, { x: 199, y: 199 }, { canvas }), 5);
  assert.equal(measureStoragePointDistance(hero, { x: 101, y: 199 }, { canvas }), 5);
  assert.equal(measureStoragePointDistance(hero, { x: 200, y: 50 }, { canvas }), 10);
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
