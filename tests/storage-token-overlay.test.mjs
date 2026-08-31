import test from "node:test";
import assert from "node:assert/strict";

import {
  StorageTokenOverlayController,
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

test("persistent feedback does not schedule an automatic close and accepts a modifier class", () => {
  const timeoutCalls = [];
  const body = { nodes: [], append(node) { this.nodes.push(node); } };
  const document = {
    body,
    createElement() {
      return {
        className: "",
        dataset: {},
        style: { setProperty() {} },
        remove() {},
        getBoundingClientRect: () => ({ width: 160, height: 32 })
      };
    },
    addEventListener() {}
  };
  const controller = new StorageTokenOverlayController({
    document,
    window: { innerWidth: 800, innerHeight: 600, addEventListener() {} },
    canvasProvider: () => null,
    setTimeout: (...args) => timeoutCalls.push(args),
    clearTimeout() {}
  });

  assert.equal(controller.showFeedback({}, "Отпустите", {
    durationMs: 0,
    className: "rm-storage-token-feedback--drop-ready"
  }), true);
  assert.equal(timeoutCalls.length, 0);
  assert.equal(body.nodes[0].className, "rm-storage-token-feedback rm-storage-token-feedback--drop-ready");
});

test("action button stays disabled while its callback is pending and re-enables on a retained overlay", async () => {
  const created = [];
  const body = { append() {} };
  const document = {
    body,
    createElement(tag) {
      const node = {
        tag,
        className: "",
        dataset: {},
        style: { setProperty() {} },
        disabled: false,
        append() {},
        remove() {},
        addEventListener(name, callback) { this.listeners ??= {}; this.listeners[name] = callback; },
        getBoundingClientRect: () => ({ width: 160, height: 32 })
      };
      created.push(node);
      return node;
    },
    addEventListener() {}
  };
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const controller = new StorageTokenOverlayController({
    document,
    window: { innerWidth: 800, innerHeight: 600, addEventListener() {} },
    canvasProvider: () => null
  });
  controller.showActions({}, [{ id: "open", label: "Открыть", callback: () => pending }]);
  const button = created.find((node) => node.tag === "button");
  const click = button.listeners.click({ stopPropagation() {} });
  assert.equal(button.disabled, true);
  release(false);
  await click;
  assert.equal(button.disabled, false);
});
