import assert from "node:assert/strict";
import test from "node:test";

import {
  TriggerTargetCoordinator,
  createTriggerTargetRef
} from "../scripts/application/trigger-target-coordinator.js";
import { DoorTriggerTargetAdapter } from "../scripts/data/door-trigger-target-adapter.js";
import { StorageTriggerTargetAdapter } from "../scripts/data/storage-trigger-target-adapter.js";
import { buildStorageTokenState } from "../scripts/data/storage-service.js";

function tokenWithStorage() {
  return { flags: { "rebreya-main": { storage: buildStorageTokenState() } } };
}

test("trigger target refs are frozen normalized descriptors", () => {
  const storage = createTriggerTargetRef("storage", " Scene.room.Token.chest ", { path: [" bag "] });
  assert.deepEqual(storage, { kind: "storage", uuid: "Scene.room.Token.chest", path: ["bag"] });
  assert.equal(Object.isFrozen(storage), true);
  assert.equal(Object.isFrozen(storage.path), true);
  assert.throws(() => createTriggerTargetRef("door", "Scene.room.Wall.door", { path: ["bag"] }), /path/u);
  assert.throws(() => createTriggerTargetRef("unknown", "x"), /kind/u);
});

test("coordinator dispatches execution by kind and injects target persistence", async () => {
  const updates = [];
  const adapter = {
    allowedEvents: ["beforeOpen", "afterOpen"],
    async read() { return { enabled: true, triggers: { marker: "state" }, document: { uuid: "wall" } }; },
    async updateRuntime(ref, mutate) { updates.push(ref.uuid); await mutate({}); }
  };
  const triggerService = {
    async execute(event, state, context) {
      assert.equal(event, "beforeOpen");
      assert.deepEqual(state, { marker: "state" });
      assert.equal(context.targetKind, "door");
      assert.equal(context.targetUuid, "Scene.room.Wall.door");
      await context.persistRuntime(context, (draft) => { draft.done = true; });
      return { allowed: true };
    }
  };
  const coordinator = new TriggerTargetCoordinator({ triggerService, adapters: { door: adapter } });
  const result = await coordinator.execute(createTriggerTargetRef("door", "Scene.room.Wall.door"), "beforeOpen", { runId: "run" });
  assert.deepEqual(result, { allowed: true });
  assert.deepEqual(updates, ["Scene.room.Wall.door"]);
});

test("coordinator skips disabled targets and rejects events outside adapter contract", async () => {
  let executions = 0;
  const coordinator = new TriggerTargetCoordinator({
    triggerService: { async execute() { executions += 1; } },
    adapters: {
      door: {
        allowedEvents: ["beforeOpen", "afterOpen"],
        async read() { return { enabled: false, triggers: {} }; }
      }
    }
  });
  const ref = createTriggerTargetRef("door", "Scene.room.Wall.door");
  assert.deepEqual(await coordinator.execute(ref, "beforeOpen"), { allowed: true, completedChainIds: [] });
  await assert.rejects(coordinator.execute(ref, "afterClaim"), /событие/u);
  assert.equal(executions, 0);
});

test("storage adapter delegates writes to StorageService with exact nested path", async () => {
  const calls = [];
  const storageService = {
    async saveTriggerDefinitions(document, definitions, expectedRevision, options) {
      calls.push(["save", document, definitions, expectedRevision, options]);
      return { triggers: { revision: 2 } };
    },
    async updateTriggerRuntime(document, mutate, options) {
      const draft = {};
      await mutate(draft);
      calls.push(["runtime", document, draft, options]);
      return { triggers: draft };
    },
    async resetTriggerExecutions(document, options) {
      calls.push(["reset", document, options]);
      return { triggers: { reset: true } };
    }
  };
  const adapter = new StorageTriggerTargetAdapter({ storageService });
  const token = tokenWithStorage();
  const ref = createTriggerTargetRef("storage", "Scene.room.Token.chest", { path: ["bag"] });
  await adapter.saveDefinitions(ref, { definitions: { chainsByEvent: {} }, expectedRevision: 1 }, { document: token });
  await adapter.updateRuntime(ref, (draft) => { draft.done = true; }, { document: token });
  await adapter.resetExecutions(ref, { document: token });
  assert.deepEqual(calls.map((entry) => [entry[0], entry.at(-1)]), [
    ["save", { path: ["bag"] }],
    ["runtime", { path: ["bag"] }],
    ["reset", { path: ["bag"] }]
  ]);
});

test("door adapter delegates only to the wall repository", async () => {
  const calls = [];
  const repository = {
    read(wall) { calls.push(["read", wall]); return { enabled: true, triggers: { revision: 0 } }; },
    async saveDefinitions(wall, input) { calls.push(["save", wall, input]); return { enabled: input.enabled, triggers: { revision: 1 } }; },
    async updateRuntime(wall, mutate) { calls.push(["runtime", wall, mutate]); return { enabled: true, triggers: {} }; },
    async resetExecutions(wall) { calls.push(["reset", wall]); return { enabled: true, triggers: {} }; }
  };
  const adapter = new DoorTriggerTargetAdapter({ repository });
  const ref = createTriggerTargetRef("door", "Scene.room.Wall.door");
  const wall = { uuid: ref.uuid };
  assert.equal((await adapter.read(ref, { document: wall })).enabled, true);
  await adapter.saveDefinitions(ref, { enabled: false, definitions: {}, expectedRevision: 0 }, { document: wall });
  await adapter.updateRuntime(ref, () => {}, { document: wall });
  await adapter.resetExecutions(ref, { document: wall });
  assert.deepEqual(calls.map(([name]) => name), ["read", "save", "runtime", "reset"]);
});
