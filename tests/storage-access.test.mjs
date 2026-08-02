import test from "node:test";
import assert from "node:assert/strict";

import { preflightStorageAccess } from "../scripts/data/storage-access.js";

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
