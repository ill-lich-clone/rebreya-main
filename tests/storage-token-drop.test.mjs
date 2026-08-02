import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { StorageTokenDropController } from "../scripts/integrations/storage-token-drop.js";

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    pending() { return timers.size; }
  };
}

function createHarness() {
  const clock = createClock();
  const token = {
    actor: {
      flags: { [MODULE_ID]: { storage: { enabled: true } } },
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
    },
    document: { uuid: "Scene.scene.Token.chest" },
    visible: true,
    hover: false,
    border: { visible: false },
    renderFlags: { calls: [], set(value) { this.calls.push(value); } }
  };
  const overlayCalls = [];
  const overlay = {
    showFeedback(actualToken, text, options) {
      overlayCalls.push({ token: actualToken, text, options });
    },
    closeCalls: 0,
    close() { this.closeCalls += 1; }
  };
  const deposits = [];
  const inspections = [];
  const moduleApi = {
    async inspectStorageDepositSource(source) {
      inspections.push(source);
      return { source, available: 3, mode: "move", name: "Стрела" };
    },
    async depositStorageItem(...args) {
      deposits.push(args);
      return { changed: true };
    }
  };
  const controller = new StorageTokenDropController(moduleApi, {
    canvasProvider: () => ({ tokens: { placeables: [token] } }),
    boundsProvider: () => ({ left: 100, top: 100, right: 200, bottom: 200 }),
    overlayController: overlay,
    promptQuantity: async () => 2,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createMutationId: () => "deposit-test"
  });
  const source = { type: "Item", uuid: "Actor.hero.Item.arrow" };
  const dataTransfer = {
    dropEffect: "none",
    getData(type) { return type === "text/plain" ? JSON.stringify(source) : ""; }
  };
  const event = {
    clientX: 150,
    clientY: 150,
    dataTransfer,
    preventions: 0,
    stops: 0,
    immediateStops: 0,
    preventDefault() { this.preventions += 1; },
    stopPropagation() { this.stops += 1; },
    stopImmediatePropagation() { this.immediateStops += 1; }
  };
  return { controller, clock, token, overlay, overlayCalls, moduleApi, deposits, inspections, event };
}

test("holding an item over storage for one second shows drop feedback and dropping deposits quantity", async () => {
  const harness = createHarness();
  harness.controller.handleDragStart(harness.event);
  assert.equal(harness.controller.handleDragOver(harness.event), true);
  assert.equal(harness.token.hover, true);
  assert.equal(harness.token.border.visible, true);
  assert.equal(harness.overlayCalls.length, 0);

  harness.clock.advance(999);
  assert.equal(harness.overlayCalls.length, 0);
  harness.clock.advance(1);
  assert.deepEqual(harness.overlayCalls[0], {
    token: harness.token,
    text: "Отпустите, чтобы добавить",
    options: { durationMs: 0, className: "rm-storage-token-feedback--drop-ready" }
  });

  const handled = await harness.controller.handleDrop(harness.event);
  assert.equal(handled, true);
  assert.equal(harness.deposits.length, 1);
  assert.equal(harness.deposits[0][0], harness.token.document.uuid);
  assert.deepEqual(harness.deposits[0][1], { kind: "item", itemUuid: "Actor.hero.Item.arrow" });
  assert.equal(harness.deposits[0][2], 2);
  assert.equal(harness.deposits[0][3], "deposit-test");
  assert.equal(harness.event.immediateStops, 1);
  assert.equal(harness.token.hover, false);
  assert.equal(harness.token.border.visible, false);
  assert.equal(harness.controller.activeToken, null);
});

test("leaving, Escape, and unsupported drags clear delayed feedback without dispatch", async () => {
  const harness = createHarness();
  harness.controller.handleDragStart(harness.event);
  harness.controller.handleDragOver(harness.event);
  assert.equal(harness.clock.pending(), 1);
  harness.controller.handleDragLeave({ clientX: 20, clientY: 20 });
  harness.clock.advance(1000);
  assert.equal(harness.overlayCalls.length, 0);
  assert.equal(harness.token.hover, false);

  harness.controller.handleDragStart(harness.event);
  harness.controller.handleDragOver(harness.event);
  harness.controller.handleKeyDown({ key: "Escape" });
  assert.equal(harness.clock.pending(), 0);
  assert.equal(harness.controller.activeToken, null);

  const unsupported = {
    ...harness.event,
    dataTransfer: { getData: () => JSON.stringify({ type: "Actor", uuid: "Actor.hero" }) }
  };
  harness.controller.handleDragStart(unsupported);
  assert.equal(harness.controller.handleDragOver(unsupported), false);
  assert.equal(await harness.controller.handleDrop(unsupported), false);
  assert.equal(harness.deposits.length, 0);
});

test("drop before the one-second ready state is consumed without creating a deposit", async () => {
  const harness = createHarness();
  harness.controller.handleDragStart(harness.event);
  harness.controller.handleDragOver(harness.event);

  const handled = await harness.controller.handleDrop(harness.event);

  assert.equal(handled, true);
  assert.equal(harness.deposits.length, 0);
  assert.equal(harness.event.immediateStops, 1);
  assert.equal(harness.controller.activeToken, null);
});
