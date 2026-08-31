import assert from "node:assert/strict";
import test from "node:test";

import {
  DoorTriggerOverlayController,
  doorTriggerFeedbackForError
} from "../scripts/ui/door-trigger-overlay.js";

test("door overlay renders exactly one Open action and forwards its callback", async () => {
  const calls = [];
  const overlay = {
    node: { classList: { add(value) { calls.push(["class", value]); } } },
    showActions(control, actions) { calls.push(["actions", control, actions]); return true; },
    close() { calls.push(["close"]); }
  };
  const controller = new DoorTriggerOverlayController({ overlay });
  const control = { wall: { document: { uuid: "Scene.room.Wall.north" } } };
  let opened = 0;
  assert.equal(controller.showOpen(control, { onOpen: async () => { opened += 1; } }), true);
  const actions = calls.find(([kind]) => kind === "actions")[2];
  assert.equal(actions.length, 1);
  assert.deepEqual({ id: actions[0].id, label: actions[0].label, icon: actions[0].icon }, {
    id: "open",
    label: "Открыть",
    icon: "fa-solid fa-door-open"
  });
  await actions[0].callback();
  assert.equal(opened, 1);
  assert.equal(actions[0].onError(Object.assign(new Error("far"), { code: "DOOR_DISTANCE" })), true);
});

test("door feedback maps handled errors without exposing secret details", () => {
  assert.deepEqual(doorTriggerFeedbackForError({ code: "DOOR_DISTANCE" }), { text: "Подойдите ближе", durationMs: 2000 });
  assert.deepEqual(doorTriggerFeedbackForError({ code: "DOOR_TRIGGER_DENIED", message: "Нужен ключ." }), { text: "Нужен ключ.", durationMs: 3000 });
  assert.deepEqual(doorTriggerFeedbackForError({ code: "DOOR_UNAVAILABLE", message: "secret" }), { text: "Дверь недоступна", durationMs: 2000 });
  assert.equal(doorTriggerFeedbackForError({ code: "UNKNOWN" }), null);
});

test("door overlay clears only the matching exact wall", () => {
  let closes = 0;
  const overlay = { showActions() { return true; }, close() { closes += 1; } };
  const controller = new DoorTriggerOverlayController({ overlay });
  controller.showOpen({ wall: { document: { uuid: "Scene.room.Wall.north" } } }, { onOpen() {} });
  assert.equal(controller.clear("Scene.room.Wall.south"), false);
  assert.equal(controller.clear("Scene.room.Wall.north"), true);
  assert.equal(closes, 1);
});

test("door overlay anchors feedback to the DoorControl hit area in canvas coordinates", () => {
  const calls = [];
  const overlay = {
    showFeedback(anchor, text, options) { calls.push({ anchor, text, options }); return true; }
  };
  const controller = new DoorTriggerOverlayController({ overlay });
  const control = {
    position: { x: 480, y: 280 },
    hitArea: { x: -2, y: -2, width: 44, height: 44 },
    wall: { document: { uuid: "Scene.room.Wall.north" } }
  };

  assert.equal(controller.showFeedback(control, "Нужен ключ", { durationMs: 3000 }), true);
  assert.deepEqual(calls[0].anchor.bounds, { x: 478, y: 278, width: 44, height: 44 });
  assert.equal(calls[0].text, "Нужен ключ");
});
