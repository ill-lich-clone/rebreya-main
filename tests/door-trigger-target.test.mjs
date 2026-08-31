import assert from "node:assert/strict";
import test from "node:test";

import {
  DOOR_TRIGGER_EVENTS,
  DoorTriggerTargetRepository,
  createEmptyDoorTriggerTargetState,
  normalizeDoorTriggerTargetState,
  readDoorTriggerTarget
} from "../scripts/data/door-trigger-target.js";
import { createEmptyStorageTriggerState } from "../scripts/data/storage-trigger-service.js";

const FLAG_PATH = "flags.rebreya-main.doorTriggerTarget";

function chain(id = "chain") {
  return {
    id,
    name: id,
    enabled: true,
    repeat: "always",
    entryStepId: "finish",
    steps: [{ id: "finish", type: "finish", config: {} }]
  };
}

function wallWith(flag) {
  const wall = {
    documentName: "Wall",
    uuid: "Scene.room.Wall.door",
    flags: flag === undefined ? {} : { "rebreya-main": { doorTriggerTarget: structuredClone(flag) } },
    updates: [],
    async update(patch) {
      this.updates.push(structuredClone(patch));
      if (Object.hasOwn(patch, FLAG_PATH)) {
        this.flags["rebreya-main"] ??= {};
        this.flags["rebreya-main"].doorTriggerTarget = structuredClone(patch[FLAG_PATH]);
      }
      return this;
    }
  };
  return wall;
}

test("door trigger target defaults are detached and do not configure the wall", () => {
  const wall = wallWith();
  const first = readDoorTriggerTarget(wall);
  const second = readDoorTriggerTarget(wall);
  assert.deepEqual(DOOR_TRIGGER_EVENTS, ["beforeOpen", "afterOpen"]);
  assert.equal(first.configured, false);
  assert.equal(first.enabled, false);
  assert.deepEqual(first, { configured: false, unsupported: false, ...createEmptyDoorTriggerTargetState() });
  first.triggers.chainsByEvent.beforeOpen.push(chain());
  assert.equal(second.triggers.chainsByEvent.beforeOpen.length, 0);
  assert.deepEqual(wall.updates, []);
});

test("door target normalization keeps forbidden event buckets empty", () => {
  const source = createEmptyStorageTriggerState();
  source.chainsByEvent.beforeOpen.push(chain("lock"));
  source.chainsByEvent.afterClaim.push(chain("claim"));
  const normalized = normalizeDoorTriggerTargetState({ version: 1, enabled: true, triggers: source });
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.triggers.chainsByEvent.beforeOpen.length, 1);
  assert.deepEqual(normalized.triggers.chainsByEvent.afterClaim, []);
  assert.deepEqual(normalized.triggers.chainsByEvent.emptied, []);
});

test("a configured supported door target is active without a separate enabled switch", () => {
  const snapshot = readDoorTriggerTarget(wallWith({
    version: 1,
    enabled: false,
    triggers: createEmptyStorageTriggerState()
  }));

  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.enabled, true);
});

test("door repository saves enabled and definitions with revision checking", async () => {
  const wall = wallWith();
  const repository = new DoorTriggerTargetRepository();
  const definitions = createEmptyStorageTriggerState().chainsByEvent;
  definitions.beforeOpen.push(chain("lock"));

  const saved = await repository.saveDefinitions(wall, {
    enabled: true,
    definitions: { chainsByEvent: definitions },
    expectedRevision: 0
  });

  assert.equal(saved.enabled, true);
  assert.equal(saved.triggers.revision, 1);
  assert.equal(saved.triggers.chainsByEvent.beforeOpen[0].id, "lock");
  assert.equal(wall.updates.length, 1);
  assert.equal(wall.updates[0][FLAG_PATH].version, 1);
  await assert.rejects(repository.saveDefinitions(wall, {
    enabled: false,
    definitions: { chainsByEvent: definitions },
    expectedRevision: 0
  }), /revision conflict/u);
});

test("door repository rejects nonempty storage-only event definitions", async () => {
  const wall = wallWith();
  const repository = new DoorTriggerTargetRepository();
  const definitions = createEmptyStorageTriggerState().chainsByEvent;
  definitions.afterClaim.push(chain("claim"));
  const error = await repository.saveDefinitions(wall, {
    enabled: true,
    definitions: { chainsByEvent: definitions },
    expectedRevision: 0
  }).catch((caught) => caught);
  assert.equal(error.code, "DOOR_TRIGGER_VALIDATION");
  assert.deepEqual(error.issues, [{ code: "event-not-allowed", event: "afterClaim" }]);
  assert.deepEqual(wall.updates, []);
});

test("door runtime update and reset preserve enabled definitions revision and variables", async () => {
  const initial = createEmptyDoorTriggerTargetState();
  initial.enabled = true;
  initial.triggers.revision = 4;
  initial.triggers.chainsByEvent.afterOpen.push(chain("trap"));
  initial.triggers.variables.key = "value";
  initial.triggers.executionState.onceGlobal.done = true;
  initial.triggers.executionState.runs.run = { status: "complete" };
  const wall = wallWith(initial);
  const repository = new DoorTriggerTargetRepository();

  await repository.updateRuntime(wall, (draft) => {
    draft.variables.count = 2;
    draft.chainsByEvent.afterOpen = [];
    draft.revision = 99;
  });
  const updated = readDoorTriggerTarget(wall);
  assert.equal(updated.triggers.revision, 4);
  assert.equal(updated.triggers.chainsByEvent.afterOpen[0].id, "trap");
  assert.equal(updated.triggers.variables.count, 2);

  await repository.resetExecutions(wall);
  const reset = readDoorTriggerTarget(wall);
  assert.equal(reset.enabled, true);
  assert.equal(reset.triggers.revision, 4);
  assert.equal(reset.triggers.variables.key, "value");
  assert.equal(reset.triggers.variables.count, 2);
  assert.deepEqual(reset.triggers.executionState, { onceGlobal: {}, oncePerCharacter: {}, runs: {} });
});

test("future door target versions remain configured and read-only", async () => {
  const wall = wallWith({ version: 99, enabled: true, future: { value: 1 } });
  const repository = new DoorTriggerTargetRepository();
  const snapshot = readDoorTriggerTarget(wall);
  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.unsupported, true);
  assert.equal(snapshot.enabled, false);
  await assert.rejects(repository.saveDefinitions(wall, {
    enabled: true,
    definitions: { chainsByEvent: createEmptyStorageTriggerState().chainsByEvent },
    expectedRevision: 0
  }), /новой версией/u);
  assert.deepEqual(wall.updates, []);
});
