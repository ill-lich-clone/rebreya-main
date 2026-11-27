import test from "node:test";
import assert from "node:assert/strict";
import { sandPlacementCells, completedSandMovementDistance } from "../scripts/combat/sand-child-geometry.js";

const grid = { type: 1, size: 100, distance: 5 };
const scene = { grid, dimensions: { sceneX: 0, sceneY: 0, sceneWidth: 800, sceneHeight: 800 }, tokens: new Map() };

test("includes the complete adjacent perimeter of the token", () => {
  const token = { x: 200, y: 200, width: 1, height: 1, parent: scene };
  assert.equal(sandPlacementCells(token, grid).length, 9);
  assert.deepEqual(sandPlacementCells(token, grid).find(cell => cell.underToken), { row: 2, col: 2, underToken: true });
  for (const [width, height, count] of [[2, 2, 16], [2, 3, 20]]) {
    const cells = sandPlacementCells({ ...token, width, height }, grid);
    assert.equal(cells.length, count);
    assert.equal(cells.filter(cell => cell.underToken).length, width * height);
  }
  assert.equal(sandPlacementCells({ ...token, x: 0, y: 0 }, grid).length, 4);
  assert.equal(sandPlacementCells(token, { ...grid, distance: 10 }).length, 0);
  assert.equal(sandPlacementCells(token, { ...grid, units: "м" }).length, 0);
  assert.equal(sandPlacementCells(token, { ...grid, units: "ft" }).length, 9);
});

test("counts voluntary travelled distance rather than forced or unmeasured segments", () => {
  const origin = { x: 100, y: 100 };
  const passed = { distance: 15, cost: 15, waypoints: [{ x: 400, y: 100, cost: 15, action: "walk" }] };
  assert.equal(completedSandMovementDistance({ origin, passed }, grid), 15);
  assert.equal(completedSandMovementDistance({ origin, passed: { ...passed, cost: 0 } }, grid), 0);
  assert.equal(completedSandMovementDistance({ origin, passed: { ...passed, waypoints: [{ ...passed.waypoints[0], action: "displace" }] } }, grid), 0);
  const mixed = { origin, passed: { distance: 25, cost: 5, waypoints: [
    { x: 500, y: 100, action: "teleport", cost: 0 }, { x: 600, y: 100, action: "walk", cost: 5 }
  ] } };
  assert.equal(completedSandMovementDistance(mixed, grid), 5);
});
