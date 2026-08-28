import assert from "node:assert/strict";
import test from "node:test";

import { GrapplePlacementPreview } from "../scripts/combat/grapple-placement-preview.js";

const grid = { size: 100, distance: 5 };

function token({ x = 0, y = 0, width = 1, height = 1, texture = "target.webp" } = {}) {
  return { x, y, width, height, texture: { src: texture } };
}

function previewEnvironment({ result = { cancelled: false, x: 250, y: 150 }, throws = null } = {}) {
  const calls = [];
  const overlays = [];
  const Crosshairs = {
    async showCrosshairs(config, callbacks) {
      calls.push({ config: structuredClone(config), callbacks });
      const crosshair = {
        inFlight: false,
        document: { x: result?.x, y: result?.y },
        draw() {},
        label: ""
      };
      callbacks?.show?.(crosshair);
      if (throws) throw throws;
      return result;
    }
  };
  const overlayFactory = (options) => {
    const state = { options, updates: [], destroyed: 0 };
    overlays.push(state);
    return {
      update(value) { state.updates.push(value); },
      destroy() { state.destroyed += 1; }
    };
  };
  const preview = new GrapplePlacementPreview({
    crosshairsProvider: () => Crosshairs,
    overlayFactory,
    gridProvider: () => grid,
    sceneRectProvider: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
    checkCollision: () => false,
    wait: async () => {}
  });
  return { preview, calls, overlays };
}

test("preview config uses the token image as a CPR icon instead of stretching it across the marker", async () => {
  const env = previewEnvironment({ result: { cancelled: false, x: 250, y: 150 } });
  const result = await env.preview.choose({
    sourceToken: token({ x: 0, y: 100 }),
    targetToken: token({ width: 2, height: 2, texture: "frog.webp" }),
    reachFeet: 10
  });

  assert.deepEqual(result, { cancelled: false, x: 150, y: 50 });
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].config.texture, undefined);
  assert.equal(env.calls[0].config.icon, "frog.webp");
  assert.equal(env.calls[0].config.drawIcon, true);
  assert.equal(env.calls[0].config.size, 5);
  assert.equal(env.calls[0].config.resolution, -1);
  assert.equal(env.calls[0].config.drawOutline, true);
  assert.equal(env.overlays[0].options.markerRadiusPixels, 100);
  assert.equal(env.overlays[0].updates[0].valid, true);
  assert.equal(env.overlays[0].destroyed, 1);
});

test("odd footprint uses cell-center CPR snapping", async () => {
  const env = previewEnvironment({ result: { cancelled: false, x: 150, y: 50 } });
  await env.preview.choose({ sourceToken: token(), targetToken: token(), reachFeet: 5 });
  assert.equal(env.calls[0].config.resolution, 1);
  assert.equal(env.calls[0].config.size, 2.5);
});

test("three-cell target keeps its top-left centered on the confirmed CPR marker", async () => {
  const env = previewEnvironment({ result: { cancelled: false, x: 350, y: 350 } });

  const result = await env.preview.choose({
    sourceToken: token(),
    targetToken: token({ width: 3, height: 3, texture: "giant.webp" }),
    reachFeet: 20
  });

  assert.deepEqual(result, { cancelled: false, x: 200, y: 200 });
  assert.equal(env.calls[0].config.size, 7.5);
  assert.equal(env.calls[0].config.resolution, 1);
});

test("preview cancellation is inert and always destroys the reach overlay", async () => {
  const env = previewEnvironment({ result: { cancelled: true, x: 0, y: 0 } });
  assert.deepEqual(await env.preview.choose({
    sourceToken: token(), targetToken: token(), reachFeet: 5
  }), { cancelled: true, x: null, y: null });
  assert.equal(env.overlays[0].destroyed, 1);
});

test("preview destroys its overlay when CPR throws", async () => {
  const failure = new Error("boom");
  const env = previewEnvironment({ throws: failure });
  await assert.rejects(() => env.preview.choose({
    sourceToken: token(), targetToken: token(), reachFeet: 5
  }), failure);
  assert.equal(env.overlays[0].destroyed, 1);
});

test("preview rejects a confirmed invalid marker and destroys the overlay", async () => {
  const env = previewEnvironment({ result: { cancelled: false, x: 750, y: 50 } });
  await assert.rejects(
    () => env.preview.choose({ sourceToken: token(), targetToken: token(), reachFeet: 5 }),
    (error) => error?.code === "outside-reach"
  );
  assert.equal(env.overlays[0].updates[0].valid, false);
  assert.equal(env.overlays[0].destroyed, 1);
});

test("preview reports unavailable CPR with a stable error code", async () => {
  const preview = new GrapplePlacementPreview({
    crosshairsProvider: () => null,
    gridProvider: () => grid
  });
  await assert.rejects(
    () => preview.choose({ sourceToken: token(), targetToken: token(), reachFeet: 5 }),
    (error) => error?.code === "crosshairs-unavailable"
  );
});
