import assert from "node:assert/strict";
import test from "node:test";

import * as geometry from "../scripts/combat/grapple-geometry.js";

const grid = { size: 100, distance: 5 };

function token(x, y = 0, width = 1, height = 1) {
  return { x, y, width, height };
}

test("twisted source movement pulls the target only by the excess beyond its radius", () => {
  assert.equal(typeof geometry.computeTwistedPullPosition, "function");
  assert.deepEqual(geometry.computeTwistedPullPosition({
    sourceToken: token(100),
    sourcePosition: { x: 300, y: 0 },
    targetToken: token(0),
    radiusFeet: 10,
    grid
  }), { x: 100, y: 0, pulledFeet: 5 });
});

test("twisted source movement leaves a target inside the radius stationary", () => {
  assert.equal(typeof geometry.computeTwistedPullPosition, "function");
  assert.deepEqual(geometry.computeTwistedPullPosition({
    sourceToken: token(100),
    sourcePosition: { x: 200, y: 0 },
    targetToken: token(0),
    radiusFeet: 10,
    grid
  }), { x: 0, y: 0, pulledFeet: 0 });
});

test("twisted radius is measured between token centers for differently sized tokens", () => {
  assert.equal(typeof geometry.twistedDistanceFeet, "function");
  assert.equal(geometry.twistedDistanceFeet(
    token(0, 0, 2, 2),
    token(300, 50, 1, 1),
    null,
    null,
    grid
  ), 12.5);
});
