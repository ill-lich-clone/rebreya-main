import test from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_TRIGGER_EVENTS,
  createEmptyStorageTriggerState,
  normalizeStorageTriggerState,
  validateStorageTriggerDefinitions
} from "../scripts/data/storage-trigger-service.js";

test("storage triggers normalize legacy storage to an empty detached v1 state", () => {
  const first = normalizeStorageTriggerState(undefined);
  const second = createEmptyStorageTriggerState();
  assert.deepEqual(first, second);
  assert.equal(first.version, 1);
  assert.equal(first.revision, 0);
  assert.deepEqual(Object.keys(first.chainsByEvent), STORAGE_TRIGGER_EVENTS);
  for (const event of STORAGE_TRIGGER_EVENTS) assert.deepEqual(first.chainsByEvent[event], []);
  first.variables.changed = true;
  assert.equal(second.variables.changed, undefined);
});

test("storage trigger validation accepts ordered lock and trap examples", () => {
  const state = createEmptyStorageTriggerState();
  state.chainsByEvent.beforeOpen.push({
    id: "locked",
    name: "Замок",
    enabled: true,
    repeat: "always",
    entryStepId: "has-key",
    steps: [{
      id: "has-key", type: "conditionItem", config: { itemUuid: "Item.key" },
      successStepId: "allow", failureStepId: "deny"
    }, { id: "allow", type: "allow", config: {} }, {
      id: "deny", type: "deny", config: { message: "Хранилище заперто." }
    }]
  });
  state.chainsByEvent.afterOpen.push({
    id: "trap",
    name: "Ловушка",
    enabled: true,
    repeat: "oncePerCharacter",
    entryStepId: "save",
    steps: [{
      id: "save", type: "savingThrow", config: { ability: "dex", dc: 14 },
      successStepId: "finish", failureStepId: "damage"
    }, { id: "damage", type: "damage", config: { formula: "2d6", damageType: "piercing" }, nextStepId: "finish" },
    { id: "finish", type: "finish", config: {} }]
  });

  assert.deepEqual(validateStorageTriggerDefinitions(state), []);
});

test("storage trigger validation reports duplicate, missing, cyclic and illegal deny targets", () => {
  const state = createEmptyStorageTriggerState();
  state.chainsByEvent.afterClaim.push({
    id: "broken", name: "Broken", enabled: true, repeat: "always", entryStepId: "a",
    steps: [
      { id: "a", type: "branch", config: {}, successStepId: "b", failureStepId: "missing" },
      { id: "b", type: "deny", config: { message: "no" }, nextStepId: "a" },
      { id: "b", type: "finish", config: {} }
    ]
  });
  const codes = validateStorageTriggerDefinitions(state).map((issue) => issue.code);
  assert.equal(codes.includes("duplicate-step-id"), true);
  assert.equal(codes.includes("missing-target"), true);
  assert.equal(codes.includes("cycle"), true);
  assert.equal(codes.includes("deny-not-allowed"), true);
});

test("unsupported future chains survive normalization unchanged and are non-executable", () => {
  const opaque = {
    id: "future", name: "Future", enabled: true, repeat: "always", entryStepId: "x",
    steps: [{ id: "x", type: "futureTeleport", config: { opaque: [1, 2, 3] } }]
  };
  const normalized = normalizeStorageTriggerState({
    version: 1,
    revision: 7,
    chainsByEvent: { beforeOpen: [opaque] },
    variables: {}, executionState: {}
  });
  assert.deepEqual(normalized.chainsByEvent.beforeOpen[0].definition, opaque);
  assert.equal(normalized.chainsByEvent.beforeOpen[0].unsupported, true);
  assert.equal(validateStorageTriggerDefinitions(normalized).some((issue) => issue.code === "unsupported-step"), true);
});
