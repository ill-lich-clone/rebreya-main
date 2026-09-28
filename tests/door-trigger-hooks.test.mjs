import assert from "node:assert/strict";
import test from "node:test";

import {
  createDoorTriggerControlClass,
  isCtrlModified,
  registerDoorTriggerHooks
} from "../scripts/integrations/door-trigger-hooks.js";

globalThis.CONST = { WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 } };

function pointer({ ctrlKey = false } = {}) {
  return {
    ctrlKey,
    stopped: 0,
    prevented: 0,
    stopPropagation() { this.stopped += 1; },
    preventDefault() { this.prevented += 1; }
  };
}

function harness({ ds = 0, configured = true, enabled = true, allowed = true, isGM = false } = {}) {
  const calls = [];
  class BaseDoorControl {
    constructor() {
      this.wall = { document: { uuid: "Scene.room.Wall.north", ds } };
    }
    async _onMouseDown(event) { calls.push(["base-left", event]); return "base-left"; }
    async _onRightDown(event) { calls.push(["base-right", event]); return "base-right"; }
  }
  const api = {
    getDoorTriggerPreflight() {
      calls.push(["preflight"]);
      return { configured, enabled, allowed, reason: allowed ? "ok" : "distance", characterTokenUuid: "Scene.room.Token.hero" };
    },
    async attemptDoorOpen(...args) { calls.push(["open", ...args]); return { opened: true }; },
    async openDoorTriggerEditor(...args) { calls.push(["editor", ...args]); }
  };
  const overlay = {
    showOpen(control, options) { calls.push(["overlay", control]); this.options = options; return true; },
    showFeedback(control, text) { calls.push(["feedback", control, text]); return true; },
    close() { calls.push(["close"]); },
    reposition() { calls.push(["reposition"]); }
  };
  const gameProvider = () => ({ user: { isGM } });
  const DoorControl = createDoorTriggerControlClass(BaseDoorControl, api, overlay, {
    gameProvider,
    mutationIdFactory: () => "mutation-1"
  });
  return { calls, api, overlay, BaseDoorControl, DoorControl, control: new DoorControl() };
}

test("configured closed and locked left-click show one overlay while native cases delegate", async () => {
  for (const ds of [0, 2]) {
    const current = harness({ ds });
    const event = pointer();
    await current.control._onMouseDown(event);
    assert.equal(current.calls.filter(([kind]) => kind === "overlay").length, 1);
    assert.equal(current.calls.some(([kind]) => kind === "base-left"), false);
    assert.equal(event.stopped, 1);
    await current.overlay.options.onOpen();
    assert.deepEqual(current.calls.find(([kind]) => kind === "open").slice(1), [
      "Scene.room.Wall.north", "mutation-1", { characterTokenUuid: "Scene.room.Token.hero" }
    ]);
  }
  assert.equal(await harness({ ds: 1 }).control._onMouseDown(pointer()), "base-left");
  assert.equal(await harness({ configured: false }).control._onMouseDown(pointer()), "base-left");
  assert.equal(await harness({ enabled: false }).control._onMouseDown(pointer()), "base-left");
});

test("failed preflight shows local feedback without a native click or global toast", async () => {
  const current = harness({ allowed: false });
  await current.control._onMouseDown(pointer());
  assert.equal(current.calls.some(([kind]) => kind === "feedback"), true);
  assert.equal(current.calls.some(([kind]) => kind === "overlay" || kind === "base-left"), false);
});

test("ordinary right-click delegates and only GM Ctrl-right-click opens the exact editor", async () => {
  const gm = harness({ isGM: true });
  assert.equal(await gm.control._onRightDown(pointer()), "base-right");
  const chord = pointer({ ctrlKey: true });
  await gm.control._onRightDown(chord);
  assert.deepEqual(gm.calls.find(([kind]) => kind === "editor"), ["editor", "Scene.room.Wall.north"]);
  assert.equal(chord.stopped, 1);

  const player = harness({ isGM: false });
  assert.equal(await player.control._onRightDown(pointer({ ctrlKey: true })), "base-right");
});

test("Ctrl modifier supports Foundry pointer and keyboard shapes", () => {
  assert.equal(isCtrlModified({ ctrlKey: true }, { keyboard: null }), true);
  assert.equal(isCtrlModified({ nativeEvent: { ctrlKey: true } }, { keyboard: null }), true);
  assert.equal(isCtrlModified({ data: { originalEvent: { ctrlKey: true } } }, { keyboard: null }), true);
  assert.equal(isCtrlModified({}, { keyboard: { isModifierActive: (key) => key === "Control" } }), true);
  assert.equal(isCtrlModified({}, { keyboard: null }), false);
});

test("registration wraps the configured base once and cleans overlay on wall/canvas hooks", () => {
  const events = new Map();
  const hooks = {
    on(name, callback) { events.set(name, callback); return name; },
    off(name) { events.delete(name); }
  };
  class ExistingDoorControl {}
  const CONFIG = { Canvas: { doorControlClass: ExistingDoorControl } };
  const overlay = { closeCalls: 0, repositionCalls: 0, close() { this.closeCalls += 1; }, reposition() { this.repositionCalls += 1; }, clear() { this.closeCalls += 1; } };
  const first = registerDoorTriggerHooks({}, { hooks, CONFIG, overlayController: overlay, gameProvider: () => ({ user: { isGM: true } }) });
  const wrapped = CONFIG.Canvas.doorControlClass;
  const second = registerDoorTriggerHooks({}, { hooks, CONFIG, overlayController: overlay, gameProvider: () => ({ user: { isGM: true } }) });
  assert.notEqual(wrapped, ExistingDoorControl);
  assert.equal(CONFIG.Canvas.doorControlClass, wrapped);
  assert.equal(second.DoorControlClass, wrapped);
  events.get("canvasPan")();
  events.get("updateWall")({ uuid: "Scene.room.Wall.north" }, { ds: 1 });
  events.get("canvasTearDown")();
  assert.equal(overlay.repositionCalls, 1);
  assert.equal(overlay.closeCalls >= 2, true);
  first.unregister();
});
