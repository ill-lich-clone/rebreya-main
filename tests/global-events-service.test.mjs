import assert from "node:assert/strict";
import test from "node:test";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { GlobalEventsService } from "../scripts/data/global-events-service.js";
import { WorldSettingMutationRepository } from "../scripts/infrastructure/foundry/world-setting-mutation-repository.js";

let globalEventCommands = {};
try {
  globalEventCommands = await import("../scripts/application/global-events-mutation-commands.js");
}
catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

function clone(value) {
  return structuredClone(value);
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

function mergeObject(base, patch) {
  const target = clone(base ?? {});
  for (const [key, value] of Object.entries(patch ?? {})) {
    target[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeObject(target[key] ?? {}, value)
      : clone(value);
  }
  return target;
}

function createFixture({
  holdFirstWrite = false,
  initialValue = { version: 1, updatedAt: 0, events: [] },
  onBeforeRepositoryOperation = null
} = {}) {
  let globalEventId = 0;
  let current = clone(initialValue);
  const writes = [];
  const firstWriteStarted = deferred();
  const releaseFirstWrite = deferred();
  let writeCount = 0;
  const settings = {
    get(_moduleId, key) {
      if (key === "globalEventsState") return current;
      if (key === "globalEventsEnabled" || key === "globalEventsNotifications" || key === "globalEventsAutoRecalc") return true;
      return false;
    },
    async set(_moduleId, key, value) {
      if (key !== "globalEventsState") throw new Error(`unexpected setting write: ${key}`);
      writeCount += 1;
      if (holdFirstWrite && writeCount === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }
      current = clone(value);
      writes.push(clone(value));
    }
  };
  const gatewayCoordinator = new WorldMutationCoordinator();
  const commits = [];
  const mutationGateway = {
    commit(queueKey, operation) {
      commits.push(queueKey);
      return gatewayCoordinator.run(queueKey, () => {
        onBeforeRepositoryOperation?.({ overwrite: (value) => { current = clone(value); } });
        return operation({ assertActiveGm() {} });
      });
    }
  };
  const worldSettingMutationRepository = new WorldSettingMutationRepository({
    mutationGateway,
    gameProvider: () => ({ settings })
  });
  const restores = [
    replaceGlobal("game", { settings, user: { id: "gm-a", isGM: true } }),
    replaceGlobal("foundry", {
      utils: {
        deepClone: clone,
        mergeObject: (base, patch) => mergeObject(base, patch),
        randomID: () => `generated-event-${++globalEventId}`
      }
    }),
    replaceGlobal("ui", { notifications: { info() {} } })
  ];
  const service = new GlobalEventsService({
    repository: { dataset: null },
    worldSettingMutationRepository
  });
  return {
    commits,
    current: () => clone(current),
    firstWriteStarted,
    releaseFirstWrite,
    service,
    writes,
    restore() { restores.reverse().forEach((restore) => restore()); }
  };
}

function eventData(id, name = id) {
  return {
    id,
    name,
    scope: { world: true },
    effects: []
  };
}

test("global-event writes use one fresh queued repository mutation and preserve concurrent creates", async () => {
  const fixture = createFixture({ holdFirstWrite: true });
  try {
    const first = fixture.service.createGlobalEvent(eventData("event-a"));
    await fixture.firstWriteStarted.promise;
    const second = fixture.service.createGlobalEvent(eventData("event-b"));
    fixture.releaseFirstWrite.resolve();

    await Promise.all([first, second]);

    assert.deepEqual(
      fixture.current().events.map((event) => event.id).sort(),
      ["event-a", "event-b"]
    );
    assert.deepEqual(fixture.commits, ["setting:globalEventsState", "setting:globalEventsState"]);
    assert.deepEqual(
      fixture.service.getAllGlobalEvents().map((event) => event.id).sort(),
      ["event-a", "event-b"]
    );
  }
  finally {
    fixture.restore();
  }
});

test("global-event create, update, duplicate, delete, and import commit before their cache results", async () => {
  const fixture = createFixture();
  try {
    const created = await fixture.service.createGlobalEvent(eventData("event-a", "Original"));
    const updated = await fixture.service.updateGlobalEvent(created.id, { name: "Updated" });
    const duplicate = await fixture.service.duplicateGlobalEvent(updated.id);
    await fixture.service.deleteGlobalEvent(updated.id);
    fixture.service.getDefaultGlobalEventTemplates = () => [eventData("template-a", "Template")];
    const imported = await fixture.service.importDefaultGlobalEventTemplates();

    assert.equal(updated.name, "Updated");
    assert.notEqual(duplicate.id, updated.id);
    assert.deepEqual(imported.map((event) => event.id), ["template-a"]);
    assert.deepEqual(
      fixture.service.getAllGlobalEvents().map((event) => event.id).sort(),
      [duplicate.id, "template-a"].sort()
    );
    assert.equal(fixture.commits.length, 5);
    assert.equal(fixture.writes.length, 5);
  }
  finally {
    fixture.restore();
  }
});

test("calendar activation applies its patch to the fresh queued event state", async () => {
  const datedEvent = {
    ...eventData("event-a"),
    active: false,
    trigger: { type: "date", startDate: "2026-08-26", endDate: null },
    duration: { mode: "untilDisabled", startDate: null, endDate: null }
  };
  const fixture = createFixture({
    initialValue: { version: 1, updatedAt: 0, events: [datedEvent] },
    onBeforeRepositoryOperation: ({ overwrite }) => overwrite({
      version: 1,
      updatedAt: 1,
      events: [datedEvent, eventData("event-b")]
    })
  });
  try {
    await fixture.service.refreshEventActivationByDate("2026-08-26");

    assert.deepEqual(
      fixture.current().events.map((event) => event.id).sort(),
      ["event-a", "event-b"]
    );
  }
  finally {
    fixture.restore();
  }
});

test("global-event command validators accept only the five exact GM mutation payload contracts", () => {
  const {
    GLOBAL_EVENTS_CREATE_COMMAND,
    GLOBAL_EVENTS_DELETE_COMMAND,
    GLOBAL_EVENTS_DUPLICATE_COMMAND,
    GLOBAL_EVENTS_IMPORT_DEFAULTS_COMMAND,
    GLOBAL_EVENTS_UPDATE_COMMAND,
    isValidGlobalEventsCreatePayload,
    isValidGlobalEventsDeletePayload,
    isValidGlobalEventsDuplicatePayload,
    isValidGlobalEventsImportDefaultsPayload,
    isValidGlobalEventsUpdatePayload
  } = globalEventCommands;

  assert.deepEqual([
    GLOBAL_EVENTS_CREATE_COMMAND,
    GLOBAL_EVENTS_UPDATE_COMMAND,
    GLOBAL_EVENTS_DELETE_COMMAND,
    GLOBAL_EVENTS_DUPLICATE_COMMAND,
    GLOBAL_EVENTS_IMPORT_DEFAULTS_COMMAND
  ], [
    "global-events.create",
    "global-events.update",
    "global-events.delete",
    "global-events.duplicate",
    "global-events.import-defaults"
  ]);
  assert.equal(isValidGlobalEventsCreatePayload?.({ data: eventData("event-a") }), true);
  assert.equal(isValidGlobalEventsUpdatePayload?.({ eventId: "event-a", patch: { name: "Updated" } }), true);
  assert.equal(isValidGlobalEventsDeletePayload?.({ eventId: "event-a" }), true);
  assert.equal(isValidGlobalEventsDuplicatePayload?.({ eventId: "event-a" }), true);
  assert.equal(isValidGlobalEventsImportDefaultsPayload?.({}), true);
  assert.equal(isValidGlobalEventsCreatePayload?.({ data: eventData("event-a"), extra: true }), false);
  assert.equal(isValidGlobalEventsUpdatePayload?.({ eventId: "", patch: {} }), false);
  assert.equal(isValidGlobalEventsDeletePayload?.({ eventId: "event-a", extra: true }), false);
  assert.equal(isValidGlobalEventsImportDefaultsPayload?.({ extra: true }), false);
});
