import assert from "node:assert/strict";
import test from "node:test";

import {
  DOOR_ERROR_CODES,
  DoorTriggerCommandService,
  isValidDoorOpenPayload,
  isValidDoorTriggerReadPayload,
  isValidDoorTriggerResetPayload,
  isValidDoorTriggerSavePayload
} from "../scripts/application/door-trigger-command-service.js";
import { TriggerTargetCoordinator } from "../scripts/application/trigger-target-coordinator.js";
import { DoorTriggerTargetAdapter } from "../scripts/data/door-trigger-target-adapter.js";
import { DoorTriggerTargetRepository } from "../scripts/data/door-trigger-target.js";
import { StorageTriggerService, createEmptyStorageTriggerState } from "../scripts/data/storage-trigger-service.js";

globalThis.CONST = {
  WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 },
  WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 }
};

const WALL_UUID = "Scene.room.Wall.north";
const TOKEN_UUID = "Scene.room.Token.hero";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function eventDefinitions({ beforeOpen = [], afterOpen = [] } = {}) {
  const chainsByEvent = createEmptyStorageTriggerState().chainsByEvent;
  chainsByEvent.beforeOpen = beforeOpen;
  chainsByEvent.afterOpen = afterOpen;
  return { chainsByEvent };
}

function finishChain({ id = "allow", enabled = true, repeat = "always" } = {}) {
  return {
    id,
    name: id,
    enabled,
    repeat,
    entryStepId: "finish",
    steps: [{ id: "finish", type: "finish", config: {} }]
  };
}

function denyChain(message = "Нужен ключ.") {
  return {
    id: "deny",
    name: "deny",
    enabled: true,
    repeat: "always",
    entryStepId: "deny-step",
    steps: [{ id: "deny-step", type: "deny", config: { message } }]
  };
}

function macroChain(id = "trap") {
  return {
    id,
    name: id,
    enabled: true,
    repeat: "always",
    entryStepId: "macro",
    steps: [{ id: "macro", type: "macro", config: { macroUuid: "Macro.trap" } }]
  };
}

function createHarness({ ds = 0, doorType = 1, distance = 5, owner = true, hidden = false } = {}) {
  const gm = { id: "gm", isGM: true };
  const player = { id: "player", isGM: false };
  const scene = { id: "room", documentName: "Scene" };
  const actor = {
    id: "hero",
    uuid: "Actor.hero",
    documentName: "Actor",
    type: "character",
    testUserPermission(user) { return owner && [player.id, gm.id].includes(user?.id); }
  };
  const characterToken = {
    id: "hero",
    uuid: TOKEN_UUID,
    documentName: "Token",
    parent: scene,
    actor,
    hidden
  };
  const wall = {
    id: "north",
    uuid: WALL_UUID,
    documentName: "Wall",
    parent: scene,
    door: doorType,
    ds,
    flags: {},
    updates: [],
    resolveCount: 0,
    onResolve: null,
    async update(patch, options) {
      this.updates.push({ patch: clone(patch), options: clone(options) });
      if (Object.hasOwn(patch, "ds")) this.ds = patch.ds;
      if (Object.hasOwn(patch, "flags.rebreya-main.doorTriggerTarget")) {
        this.flags["rebreya-main"] ??= {};
        this.flags["rebreya-main"].doorTriggerTarget = clone(patch["flags.rebreya-main.doorTriggerTarget"]);
      }
      return this;
    }
  };
  const documents = new Map([[wall.uuid, wall], [characterToken.uuid, characterToken], [actor.uuid, actor]]);
  const repository = new DoorTriggerTargetRepository();
  const macroCalls = [];
  let macroFailure = null;
  const triggerService = new StorageTriggerService({
    executeMacro: async (context) => {
      macroCalls.push(context);
      if (macroFailure) throw macroFailure;
      return { outcome: "continue", variables: {} };
    }
  });
  const coordinator = new TriggerTargetCoordinator({
    triggerService,
    adapters: { door: new DoorTriggerTargetAdapter({ repository }) }
  });
  const warnings = [];
  const serviceDependencies = {
    coordinator,
    resolveDocument: async (uuid) => {
      const document = documents.get(uuid) ?? null;
      if (document === wall) {
        wall.resolveCount += 1;
        await wall.onResolve?.(wall.resolveCount);
      }
      return document;
    },
    measureDistance: () => distance,
    logger: { warn(...args) { warnings.push(args); } }
  };
  const createService = () => new DoorTriggerCommandService(serviceDependencies);
  const service = createService();

  return {
    gm, player, scene, actor, characterToken, wall, repository, coordinator, service,
    createService, macroCalls, warnings, documents,
    setMacroFailure(error) { macroFailure = error; }
  };
}

async function configure(harness, { enabled = true, beforeOpen = [], afterOpen = [] } = {}) {
  return harness.repository.saveDefinitions(harness.wall, {
    enabled,
    definitions: eventDefinitions({ beforeOpen, afterOpen }),
    expectedRevision: 0
  });
}

function openPayload(mutationId = "open-1", characterTokenUuid = TOKEN_UUID) {
  return { wallUuid: WALL_UUID, characterTokenUuid, mutationId };
}

test("door command validators accept only exact bounded payloads", () => {
  const definitions = eventDefinitions();
  assert.equal(isValidDoorOpenPayload(openPayload()), true);
  assert.equal(isValidDoorOpenPayload({ ...openPayload(), extra: true }), false);
  assert.equal(isValidDoorOpenPayload({ ...openPayload(), mutationId: "" }), false);
  assert.equal(isValidDoorTriggerReadPayload({ wallUuid: WALL_UUID }), true);
  assert.equal(isValidDoorTriggerReadPayload({ wallUuid: WALL_UUID, path: [] }), false);
  assert.equal(isValidDoorTriggerSavePayload({
    wallUuid: WALL_UUID,
    enabled: true,
    definitions,
    expectedRevision: 0,
    operationId: "save-1"
  }), true);
  assert.equal(isValidDoorTriggerSavePayload({
    wallUuid: WALL_UUID,
    enabled: true,
    definitions: { chainsByEvent: { beforeOpen: ["x".repeat(500_001)] } },
    expectedRevision: 0,
    operationId: "save-1"
  }), false);
  assert.equal(isValidDoorTriggerResetPayload({ wallUuid: WALL_UUID, operationId: "reset-1" }), true);
  assert.equal(isValidDoorTriggerResetPayload({ wallUuid: WALL_UUID, operationId: "" }), false);
});

test("door trigger administration is GM-only, revisioned, resettable and idempotent", async () => {
  const harness = createHarness();
  await assert.rejects(harness.service.readTriggers({ wallUuid: WALL_UUID }, { sender: harness.player }), /только мастер/u);
  const initial = await harness.service.readTriggers({ wallUuid: WALL_UUID }, { sender: harness.gm });
  assert.equal(initial.enabled, false);
  assert.equal(initial.triggers.revision, 0);
  const payload = {
    wallUuid: WALL_UUID,
    enabled: true,
    definitions: eventDefinitions({ beforeOpen: [finishChain()] }),
    expectedRevision: 0,
    operationId: "save-1"
  };
  const saved = await harness.service.saveTriggers(payload, { sender: harness.gm });
  const replay = await harness.service.saveTriggers(payload, { sender: harness.gm });
  assert.deepEqual(replay, saved);
  assert.equal(saved.enabled, true);
  assert.equal(saved.triggers.revision, 1);
  assert.equal(harness.wall.updates.length, 1);
  const reset = await harness.service.resetTriggers({ wallUuid: WALL_UUID, operationId: "reset-1" }, { sender: harness.gm });
  assert.equal(reset.enabled, true);
  assert.equal(reset.triggers.chainsByEvent.beforeOpen.length, 1);
});

test("closed enabled door opens without chains while locked door requires an active chain", async () => {
  const closed = createHarness({ ds: 0 });
  await configure(closed);
  const opened = await closed.service.open(openPayload("closed"), { sender: closed.player });
  assert.deepEqual(opened, { wallUuid: WALL_UUID, state: 1, opened: true, replayed: false, postCommitWarning: false });
  assert.deepEqual(closed.wall.updates.find(({ patch }) => Object.hasOwn(patch, "ds")), {
    patch: { ds: 1 },
    options: { sound: true, rebreyaDoorTriggerBypass: true }
  });

  const locked = createHarness({ ds: 2 });
  await configure(locked);
  const lockedError = await locked.service.open(openPayload("locked-empty"), { sender: locked.player }).catch((error) => error);
  assert.equal(lockedError.code, DOOR_ERROR_CODES.LOCKED);
  assert.equal(locked.wall.ds, 2);

  const disabledChain = createHarness({ ds: 2 });
  await configure(disabledChain, { beforeOpen: [finishChain({ enabled: false })] });
  const disabledError = await disabledChain.service.open(openPayload("locked-disabled"), { sender: disabledChain.player }).catch((error) => error);
  assert.equal(disabledError.code, DOOR_ERROR_CODES.LOCKED);

  const allowed = createHarness({ ds: 2 });
  await configure(allowed, { beforeOpen: [finishChain()] });
  assert.equal((await allowed.service.open(openPayload("locked-allow"), { sender: allowed.player })).opened, true);
  assert.equal(allowed.wall.ds, 1);
});

test("beforeOpen deny returns sanitized typed failure without changing the wall", async () => {
  const harness = createHarness();
  await configure(harness, { beforeOpen: [denyChain("Нужен медный ключ.")] });
  const error = await harness.service.open(openPayload("deny"), { sender: harness.player }).catch((caught) => caught);
  assert.equal(error.code, DOOR_ERROR_CODES.TRIGGER_DENIED);
  assert.equal(error.message, "Нужен медный ключ.");
  assert.equal(harness.wall.ds, 0);
  assert.equal(harness.wall.updates.filter(({ patch }) => Object.hasOwn(patch, "ds")).length, 0);
});

test("door open revalidates ownership scene secret type distance and state", async () => {
  const unowned = createHarness({ owner: false });
  await configure(unowned);
  assert.equal((await unowned.service.open(openPayload("owner"), { sender: unowned.player }).catch((error) => error)).code, DOOR_ERROR_CODES.CHARACTER_UNAVAILABLE);

  const distant = createHarness({ distance: 10.01 });
  await configure(distant);
  assert.equal((await distant.service.open(openPayload("distance"), { sender: distant.player }).catch((error) => error)).code, DOOR_ERROR_CODES.DISTANCE);

  const secret = createHarness({ doorType: 2 });
  await configure(secret);
  assert.equal((await secret.service.open(openPayload("secret"), { sender: secret.player }).catch((error) => error)).code, DOOR_ERROR_CODES.UNAVAILABLE);

  const legacyDisabled = createHarness();
  await configure(legacyDisabled, { enabled: false });
  assert.equal((await legacyDisabled.service.open(openPayload("legacy-disabled"), { sender: legacyDisabled.player })).opened, true);

  const changed = createHarness();
  await configure(changed, { beforeOpen: [finishChain()] });
  changed.wall.onResolve = async (count) => { if (count === 3) changed.wall.ds = 1; };
  const changedError = await changed.service.open(openPayload("changed"), { sender: changed.player }).catch((error) => error);
  assert.equal(changedError.code, DOOR_ERROR_CODES.STATE_CHANGED);
});

test("double-click and cached retry update and execute afterOpen exactly once", async () => {
  const harness = createHarness();
  await configure(harness, { afterOpen: [macroChain()] });
  const payload = openPayload("double");
  const [first, joined] = await Promise.all([
    harness.service.open(payload, { sender: harness.player }),
    harness.service.open(payload, { sender: harness.player })
  ]);
  const cached = await harness.service.open(payload, { sender: harness.player });
  assert.deepEqual(joined, first);
  assert.deepEqual(cached, first);
  assert.equal(harness.wall.updates.filter(({ patch }) => Object.hasOwn(patch, "ds")).length, 1);
  assert.equal(harness.macroCalls.length, 1);
  assert.equal(Object.isFrozen(harness.macroCalls[0]), true);
  assert.equal(harness.macroCalls[0].targetKind, "door");
  assert.equal(harness.macroCalls[0].targetUuid, WALL_UUID);
  assert.equal(Object.hasOwn(harness.macroCalls[0], "storageToken"), false);
  assert.equal(Object.hasOwn(harness.macroCalls[0], "tokenUuid"), false);
  assert.equal(Object.hasOwn(harness.macroCalls[0], "path"), false);
  assert.equal(Object.hasOwn(harness.macroCalls[0], "claimSummary"), false);
});

test("mutation ID cannot be rebound and a fresh active GM service replays durable receipts", async () => {
  const harness = createHarness();
  await configure(harness, { beforeOpen: [finishChain()], afterOpen: [macroChain()] });
  const payload = openPayload("restart");
  await harness.service.open(payload, { sender: harness.player });
  const restartResult = await harness.createService().open(payload, { sender: harness.player });
  assert.equal(restartResult.replayed, true);
  assert.equal(harness.wall.updates.filter(({ patch }) => Object.hasOwn(patch, "ds")).length, 1);
  assert.equal(harness.macroCalls.length, 1);
  const rebound = await harness.service.open({ ...payload, characterTokenUuid: "Scene.room.Token.other" }, { sender: harness.player }).catch((error) => error);
  assert.match(rebound.message, /mutationId/u);
});

test("afterOpen failure is post-commit and a retry resumes without a second door update", async () => {
  const harness = createHarness();
  await configure(harness, { beforeOpen: [finishChain()], afterOpen: [macroChain()] });
  harness.setMacroFailure(new Error("macro unavailable"));
  const payload = openPayload("post-commit");
  const first = await harness.service.open(payload, { sender: harness.player });
  assert.equal(first.postCommitWarning, true);
  assert.equal(harness.wall.ds, 1);
  assert.equal(harness.warnings.length, 1);
  harness.setMacroFailure(null);
  const retry = await harness.service.open(payload, { sender: harness.player });
  assert.equal(retry.replayed, true);
  assert.equal(retry.postCommitWarning, false);
  assert.equal(harness.wall.updates.filter(({ patch }) => Object.hasOwn(patch, "ds")).length, 1);
  assert.equal(harness.macroCalls.length, 2);
});
