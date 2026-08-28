import assert from "node:assert/strict";
import test from "node:test";

import {
  grapplePlacementDistanceFeet,
  tokenFootprint,
  validateGrapplePlacement
} from "../scripts/combat/grapple-geometry.js";

const grid = { size: 100, distance: 5 };

function token({ x = 0, y = 0, width = 1, height = 1 } = {}) {
  return { x, y, width, height };
}

test("token footprint preserves rectangular and fractional grid dimensions", () => {
  assert.deepEqual(tokenFootprint(token({ x: 25, y: 50, width: 1.5, height: 2.5 })), {
    x: 25,
    y: 50,
    width: 1.5,
    height: 2.5
  });
});

test("placement distance measures from source center to the nearest target edge", () => {
  const source = token({ x: 0, y: 0 });

  assert.equal(grapplePlacementDistanceFeet(source, token(), { x: 150, y: 0 }, grid), 5);
  assert.equal(grapplePlacementDistanceFeet(source, token({ width: 2, height: 2 }), { x: 150, y: -50 }, grid), 5);
  assert.equal(grapplePlacementDistanceFeet(source, token({ width: 2, height: 1 }), { x: 150, y: 0 }, grid), 5);
  assert.equal(grapplePlacementDistanceFeet(source, token({ width: 0.5, height: 0.5 }), { x: 150, y: 25 }, grid), 5);
});

test("large target center may be beyond reach when its nearest footprint edge is reachable", () => {
  const result = validateGrapplePlacement({
    sourceToken: token({ x: 0, y: 0 }),
    targetToken: token({ width: 2, height: 2 }),
    position: { x: 150, y: -50 },
    grid,
    reachFeet: 5,
    sceneRect: { x: -500, y: -500, width: 2000, height: 2000 }
  });

  assert.deepEqual(result, { valid: true, reason: null, x: 150, y: -50 });
});

test("placement rejects reach, scene bounds, and walls independently", () => {
  const base = {
    sourceToken: token({ x: 0, y: 0 }),
    targetToken: token(),
    grid,
    reachFeet: 5,
    sceneRect: { x: 0, y: 0, width: 500, height: 500 }
  };

  assert.deepEqual(validateGrapplePlacement({ ...base, position: { x: 250, y: 0 } }), {
    valid: false, reason: "outside-reach", x: 250, y: 0
  });
  assert.deepEqual(validateGrapplePlacement({ ...base, position: { x: -1, y: 0 }, reachFeet: 100 }), {
    valid: false, reason: "outside-scene", x: -1, y: 0
  });
  assert.deepEqual(validateGrapplePlacement({
    ...base,
    position: { x: 100, y: 0 },
    checkCollision: () => true
  }), {
    valid: false, reason: "wall-collision", x: 100, y: 0
  });
});

test("other token overlap is not part of placement validation", () => {
  const result = validateGrapplePlacement({
    sourceToken: token({ x: 0, y: 0 }),
    targetToken: token({ width: 2, height: 2 }),
    position: { x: 0, y: 0 },
    grid,
    reachFeet: 5,
    sceneRect: { x: 0, y: 0, width: 500, height: 500 },
    occupiedTokens: [token({ x: 0, y: 0, width: 3, height: 3 })]
  });
  assert.equal(result.valid, true);
});
