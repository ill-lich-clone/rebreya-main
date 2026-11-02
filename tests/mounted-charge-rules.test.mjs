import test from "node:test";
import assert from "node:assert/strict";
import { chargeMovement, mountedDamage } from "../scripts/combat/mounted-charge-rules.js";

const grid = { size: 100, distance: 5, units: "ft" };
const point = (x, y, action = "walk") => ({ x, y, elevation: 0, width: 1, height: 1, action });
function token(history, x = 200, y = 0) {
  return { x, y, width: 1, height: 1, parent: { grid: { ...grid } }, movementHistory: history,
    measureMovementPath(points) { return { distance: Math.max(Math.abs(points[1].x-points[0].x), Math.abs(points[1].y-points[0].y)) / 100 * 5 }; } };
}

test("charge needs ten feet in a straight line towards its live target", () => {
  const target = { x: 400, y: 0, width: 1, height: 1 };
  assert.equal(chargeMovement(token([point(0, 0), point(100, 0), point(200, 0)]), target), true);
  assert.equal(chargeMovement(token([point(100, 0), point(200, 0)]), target), false);
  assert.equal(chargeMovement(token([point(0, 100), point(100, 100), point(100, 0), point(200, 0)]), target), false);
  assert.equal(chargeMovement(token([point(400, 0), point(200, 0)]), target), false);
  assert.equal(chargeMovement(token([point(0, 0), point(200, 0, "displace")]), target), false);
  assert.equal(chargeMovement(token([point(0, 0), point(200, 0, "teleport")]), target), false);
  assert.equal(chargeMovement(token([point(0, 0), point(100, 0)]), target), null);
});

test("unsupported scene units do not silently become a failed charge", () => {
  const rider = token([point(0, 0), point(200, 0)]), target = { x: 400, y: 0, width: 1, height: 1, parent: rider.parent };
  rider.parent.grid.units = "unknown";
  assert.equal(chargeMovement(rider, target), null);
  rider.parent.grid.units = "ft"; delete rider.measureMovementPath;
  assert.equal(chargeMovement(rider, target), null);
});

test("mounted damage checks a live mount on the same scene and the target size", () => {
  const scene = { tokens: new Map() };
  const rider = { uuid: "Scene.s.Token.r", parent: scene, flags: { "rebreya-main": { mountedOn: "Scene.s.Token.m" } } };
  const mount = { id: "m", uuid: "Scene.s.Token.m", parent: scene, actor: { system: { traits: { size: "lg" } } } };
  const target = { parent: scene, actor: { system: { traits: { size: "med" } } } };
  scene.tokens.set("m", mount);
  assert.equal(mountedDamage(rider, target), 2);
  target.actor.system.traits.size = "lg"; assert.equal(mountedDamage(rider, target), 0);
  target.actor.system.traits.size = "med"; scene.tokens.delete("m"); assert.equal(mountedDamage(rider, target), 0);
});

test("charge handles diagonal and metric movement, but not changing height or stale target scenes", () => {
  const rider = token([point(0, 0), point(200, 200)], 200, 200);
  const target = { x: 400, y: 400, width: 1, height: 1, parent: rider.parent };
  rider.parent.grid.units = "m";
  rider.measureMovementPath = () => ({ distance: 3 });
  assert.equal(chargeMovement(rider, target), true);
  rider.movementHistory[1].elevation = 10;
  assert.equal(chargeMovement(rider, target), false);
  rider.movementHistory[1].elevation = 0;
  target.parent = { grid };
  assert.equal(chargeMovement(rider, target), false);
});

test("a nearly sideways run that gets slightly closer is not a charge towards the enemy", () => {
  const rider = token([point(0, 0), point(200, 0)]);
  const target = { x: 201, y: 10000, width: 1, height: 1, parent: rider.parent };
  assert.equal(chargeMovement(rider, target), false);
});

test("unknown mount size or a token from another scene cannot grant mounted bonus", () => {
  const scene = { tokens: new Map() }, otherScene = { tokens: new Map() };
  const rider = { uuid: "Scene.s.Token.r", parent: scene, flags: { "rebreya-main": { mountedOn: "Scene.s.Token.m" } } };
  const mount = { uuid: "Scene.s.Token.m", parent: scene, actor: { system: { traits: { size: "unknown" } } } };
  const target = { parent: scene, actor: { system: { traits: { size: "med" } } } };
  scene.tokens.set("m", mount);
  assert.equal(mountedDamage(rider, target), 0);
  mount.actor.system.traits.size = "lg"; target.parent = otherScene;
  assert.equal(mountedDamage(rider, target), 0);
});
