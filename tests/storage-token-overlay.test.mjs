import test from "node:test";
import assert from "node:assert/strict";

import {
  placeTokenOverlay,
  storageTokenViewportBounds
} from "../scripts/ui/storage-token-overlay.js";

test("token viewport bounds include canvas offset and stage transform", () => {
  const token = { bounds: { x: 100, y: 200, width: 50, height: 60 } };
  const canvas = {
    stage: { worldTransform: { apply: ({ x, y }) => ({ x: x * 2, y: y * 2 }) } },
    app: { canvas: { getBoundingClientRect: () => ({ left: 10, top: 20 }) } }
  };

  assert.deepEqual(storageTokenViewportBounds(token, { canvas }), {
    left: 210,
    top: 420,
    right: 310,
    bottom: 540,
    width: 100,
    height: 120
  });
});

test("overlay clamps horizontally and flips below a token near the top edge", () => {
  assert.deepEqual(placeTokenOverlay({
    tokenBounds: { left: 10, top: 4, right: 110, bottom: 104, width: 100, height: 100 },
    overlaySize: { width: 180, height: 40 },
    viewport: { width: 320, height: 240 },
    gap: 10,
    margin: 8
  }), {
    left: 8,
    top: 114,
    placement: "below",
    pointerLeft: 52
  });
});

test("overlay stays centered above a token when the viewport has room", () => {
  assert.deepEqual(placeTokenOverlay({
    tokenBounds: { left: 200, top: 160, right: 300, bottom: 260, width: 100, height: 100 },
    overlaySize: { width: 120, height: 40 },
    viewport: { width: 640, height: 480 },
    gap: 10,
    margin: 8
  }), {
    left: 190,
    top: 110,
    placement: "above",
    pointerLeft: 60
  });
});
