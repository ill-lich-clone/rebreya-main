import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DOOR_DISTANCE_FEET,
  measureDoorDistanceFeet,
  nearestPointOnSegment,
  preflightDoorAccess
} from "../scripts/data/door-access.js";

globalThis.CONST = {
  GRID_TYPES: { SQUARE: 1 },
  WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 }
};

function scene(id = "room") {
  return { id, grid: { type: 1, size: 100, distance: 5 } };
}

function characterToken({ id = "hero", x = 0, y = 0, width = 1, height = 1, sceneId = "room", owner = true, hidden = false } = {}) {
  const parent = scene(sceneId);
  const document = { id, uuid: `Scene.${sceneId}.Token.${id}`, x, y, width, height, hidden, parent };
  return {
    id,
    document,
    actor: {
      type: "character",
      testUserPermission: () => owner
    }
  };
}

function wall({ c = [250, 0, 250, 500], door = 1, sceneId = "room" } = {}) {
  return { documentName: "Wall", uuid: `Scene.${sceneId}.Wall.door`, c, door, parent: scene(sceneId) };
}

function canvasWith(controlled = []) {
  return {
    scene: scene(),
    dimensions: { size: 100 },
    tokens: { controlled, placeables: controlled },
    grid: {
      size: 100,
      measurePath([from, to]) {
        return { distance: Math.hypot(to.x - from.x, to.y - from.y) / 100 * 5 };
      }
    }
  };
}

const playerGame = { user: { id: "player", isGM: false } };
const gmGame = { user: { id: "gm", isGM: true } };

test("nearestPointOnSegment clamps to both ends and projects onto a diagonal", () => {
  assert.deepEqual(nearestPointOnSegment({ x: -5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), { x: 0, y: 0 });
  assert.deepEqual(nearestPointOnSegment({ x: 15, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), { x: 10, y: 0 });
  assert.deepEqual(nearestPointOnSegment({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }), { x: 5, y: 5 });
});

test("door distance uses the nearest segment point rather than its midpoint", () => {
  const token = characterToken();
  const canvas = canvasWith([token]);
  assert.equal(measureDoorDistanceFeet(token, wall({ c: [250, 0, 250, 1000] }), { canvas }), 10);
  assert.equal(measureDoorDistanceFeet(token, wall({ c: [250, 1000, 250, 2000] }), { canvas }) > 10, true);
});

test("door distance supports diagonal fractional and large token footprints", () => {
  const token = characterToken({ x: 50, y: 50, width: 1.5, height: 1.5 });
  const canvas = canvasWith([token]);
  const distance = measureDoorDistanceFeet(token, wall({ c: [300, 100, 500, 300] }), { canvas });
  assert.equal(Number.isFinite(distance), true);
  assert.equal(distance <= MAX_DOOR_DISTANCE_FEET, true);
});

test("door preflight requires a controlled owned visible character on the same scene", () => {
  const door = wall();
  assert.equal(preflightDoorAccess(door, { game: playerGame, canvas: canvasWith([]) }).reason, "character");
  const unowned = characterToken({ owner: false });
  assert.equal(preflightDoorAccess(door, { game: playerGame, canvas: canvasWith([unowned]) }).reason, "character");
  const hidden = characterToken({ hidden: true });
  assert.equal(preflightDoorAccess(door, { game: playerGame, canvas: canvasWith([hidden]) }).reason, "character");
  const elsewhere = characterToken({ sceneId: "other" });
  assert.equal(preflightDoorAccess(door, { game: playerGame, canvas: canvasWith([elsewhere]) }).reason, "scene");
});

test("door preflight accepts exact ten feet and rejects a greater distance", () => {
  const token = characterToken();
  const canvas = canvasWith([token]);
  const allowed = preflightDoorAccess(wall({ c: [250, 0, 250, 500] }), { game: playerGame, canvas });
  assert.deepEqual(allowed, {
    allowed: true,
    reason: "ok",
    characterTokenUuid: "Scene.room.Token.hero",
    distance: 10
  });
  assert.equal(preflightDoorAccess(wall({ c: [350, 0, 350, 500] }), { game: playerGame, canvas }).reason, "distance");
});

test("secret doors are hidden from players but not from a GM with a character", () => {
  const token = characterToken();
  const canvas = canvasWith([token]);
  const secret = wall({ door: 2 });
  assert.equal(preflightDoorAccess(secret, { game: playerGame, canvas }).reason, "secret");
  assert.equal(preflightDoorAccess(secret, { game: gmGame, canvas }).allowed, true);
});

test("GM gameplay route still requires a selected character and distance", () => {
  assert.equal(preflightDoorAccess(wall(), { game: gmGame, canvas: canvasWith([]) }).reason, "character");
  const token = characterToken();
  assert.equal(preflightDoorAccess(wall({ c: [450, 0, 450, 500] }), { game: gmGame, canvas: canvasWith([token]) }).reason, "distance");
});
