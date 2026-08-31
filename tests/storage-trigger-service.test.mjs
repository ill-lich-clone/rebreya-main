import test from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_TRIGGER_EVENTS,
  StorageTriggerService,
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

test("execution context persistence overrides the constructor fallback", async () => {
  const state = createEmptyStorageTriggerState();
  const calls = [];
  const service = new StorageTriggerService({
    persistRuntime: async () => { calls.push("fallback"); }
  });
  await service.execute("beforeOpen", state, {
    runId: "context-persistence",
    fingerprint: "context-persistence",
    persistRuntime: async (_context, mutate) => {
      calls.push("context");
      mutate(state);
    }
  });
  assert.deepEqual(calls, ["context", "context"]);
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
  assert.deepEqual(normalizeStorageTriggerState(normalized), normalized);
  assert.equal(validateStorageTriggerDefinitions(normalized).some((issue) => issue.code === "unsupported-step"), true);
});

test("trigger runtime prunes only the oldest completed run receipts", async () => {
  const state = createEmptyStorageTriggerState();
  for (let index = 0; index < 1001; index += 1) {
    state.executionState.runs[`old-${index}`] = {
      fingerprint: `fingerprint-${index}`, event: "afterOpen", status: "complete",
      steps: {}, completedChainIds: [], result: { allowed: true, completedChainIds: [] }
    };
  }
  state.executionState.runs.pending = {
    fingerprint: "pending", event: "afterOpen", status: "pending", steps: {}, completedChainIds: []
  };
  let persisted = structuredClone(state);
  const service = new StorageTriggerService({
    persistRuntime: async (_context, mutate) => mutate(persisted)
  });

  await service.execute("afterOpen", persisted, {
    runId: "new", fingerprint: "new", tokenUuid: "Token.chest", senderId: "gm"
  });

  assert.equal(persisted.executionState.runs["old-0"], undefined);
  assert.equal(persisted.executionState.runs["old-1"], undefined);
  assert.equal(persisted.executionState.runs.pending.status, "pending");
  assert.equal(persisted.executionState.runs.new.status, "complete");
  assert.equal(Object.values(persisted.executionState.runs).filter((run) => run.status === "complete").length, 1000);
});

test("beforeOpen lock denies without a key and oncePerCharacter trap persists only terminal runs", async () => {
  const state = createEmptyStorageTriggerState();
  state.chainsByEvent.beforeOpen = [{
    id: "lock", name: "Замок", enabled: true, repeat: "always", entryStepId: "key",
    steps: [
      { id: "key", type: "conditionItem", config: { itemUuid: "Item.key" }, successStepId: "allow", failureStepId: "deny" },
      { id: "allow", type: "allow", config: {} },
      { id: "deny", type: "deny", config: { message: "Заперто." } }
    ]
  }];
  const service = new StorageTriggerService({
    hasItem: async () => false,
    persistRuntime: async (_context, mutate) => mutate(state)
  });
  const result = await service.execute("beforeOpen", state, {
    runId: "open-1", tokenUuid: "Scene.s.Token.chest", path: [], senderId: "player",
    characterActorUuid: "Actor.hero"
  });
  assert.deepEqual(result, { allowed: false, message: "Заперто.", completedChainIds: ["lock"] });
});

test("beforeOpen lock reveals the required item name only when explicitly enabled", async () => {
  const state = createEmptyStorageTriggerState();
  state.chainsByEvent.beforeOpen = [{
    id: "named-lock", name: "Замок", enabled: true, repeat: "always", entryStepId: "key",
    steps: [
      {
        id: "key", type: "conditionItem", config: { itemName: "Медный ключ", showItemName: true },
        successStepId: "allow", failureStepId: "deny"
      },
      { id: "allow", type: "allow", config: {} },
      { id: "deny", type: "deny", config: { message: "Хранилище заперто." } }
    ]
  }];
  const service = new StorageTriggerService({
    hasItem: async () => false,
    persistRuntime: async (_context, mutate) => mutate(state)
  });

  const result = await service.execute("beforeOpen", state, {
    runId: "named-open", tokenUuid: "Scene.s.Token.chest", senderId: "player",
    characterActorUuid: "Actor.hero"
  });

  assert.deepEqual(result, {
    allowed: false,
    message: "Хранилище заперто. Требуется предмет: «Медный ключ».",
    completedChainIds: ["named-lock"]
  });
});

test("onceGlobal lock retries denials and completes only after a successful item check", async () => {
  const state = createEmptyStorageTriggerState();
  state.chainsByEvent.beforeOpen = [{
    id: "gold-lock", name: "Золотой замок", enabled: true, repeat: "onceGlobal", entryStepId: "key",
    steps: [
      {
        id: "key", type: "conditionItem", config: { itemName: "Золотой ключ", showItemName: false },
        successStepId: "allow", failureStepId: "deny"
      },
      { id: "allow", type: "allow", config: {} },
      { id: "deny", type: "deny", config: { message: "Заперто." } }
    ]
  }];
  let hasKey = false;
  let checks = 0;
  const service = new StorageTriggerService({
    hasItem: async () => { checks += 1; return hasKey; },
    persistRuntime: async (_context, mutate) => mutate(state)
  });
  const context = { tokenUuid: "Scene.s.Token.chest", senderId: "player", characterActorUuid: "Actor.hero" };

  const denied = await service.execute("beforeOpen", state, { ...context, runId: "denied" });
  assert.equal(denied.allowed, false);
  assert.deepEqual(state.executionState.onceGlobal, {});

  hasKey = true;
  const unlocked = await service.execute("beforeOpen", state, { ...context, runId: "unlocked" });
  assert.deepEqual(unlocked.usedItemNames, ["Золотой ключ"]);
  assert.equal(state.executionState.onceGlobal["beforeOpen:gold-lock"], true);

  hasKey = false;
  const alreadyUnlocked = await service.execute("beforeOpen", state, { ...context, runId: "later" });
  assert.equal(alreadyUnlocked.allowed, true);
  assert.equal(alreadyUnlocked.usedItemNames, undefined);
  assert.equal(checks, 2);
});

test("trigger runtime branches on a dnd5e save, applies damage, and reuses a durable completed run", async () => {
  const state = createEmptyStorageTriggerState();
  state.chainsByEvent.afterOpen = [{
    id: "needle-trap", name: "Игла", enabled: true, repeat: "oncePerCharacter", entryStepId: "save",
    steps: [
      { id: "save", type: "savingThrow", config: { ability: "dex", dc: 14 }, successStepId: "finish", failureStepId: "damage" },
      { id: "damage", type: "damage", config: { formula: "2d6", damageType: "piercing" }, nextStepId: "finish" },
      { id: "finish", type: "finish", config: {} }
    ]
  }];
  let rolls = 0;
  let damage = 0;
  let persisted = structuredClone(state);
  const service = new StorageTriggerService({
    rollCheck: async (_context, config) => {
      rolls += 1;
      assert.deepEqual(config, { kind: "savingThrow", ability: "dex", dc: 14 });
      return { success: false, total: 8 };
    },
    applyDamage: async () => { damage += 1; return { applied: 7 }; },
    persistRuntime: async (_context, mutate) => {
      mutate(persisted);
      persisted = normalizeStorageTriggerState(persisted);
      return persisted;
    }
  });
  const context = {
    runId: "open-2", fingerprint: "exact-open-2", tokenUuid: "Scene.s.Token.chest", path: [],
    senderId: "player", characterActorUuid: "Actor.hero"
  };

  const first = await service.execute("afterOpen", persisted, context);
  const retry = await service.execute("afterOpen", persisted, context);

  assert.deepEqual(first, { allowed: true, completedChainIds: ["needle-trap"] });
  assert.deepEqual(retry, first);
  assert.equal(rolls, 1);
  assert.equal(damage, 1);
  assert.equal(persisted.executionState.oncePerCharacter["afterOpen:needle-trap:Actor.hero"], true);
  assert.equal(persisted.executionState.runs["open-2"].status, "complete");
});

test("trigger variables and macro returns commit atomically while run fingerprints cannot be rebound", async () => {
  const state = createEmptyStorageTriggerState();
  state.chainsByEvent.beforeOpen = [{
    id: "macro-lock", name: "Macro", enabled: true, repeat: "onceGlobal", entryStepId: "set",
    steps: [
      { id: "set", type: "setVariable", config: { name: "attempts", value: 1 }, nextStepId: "macro" },
      { id: "macro", type: "macro", config: { macroUuid: "Macro.lock" }, nextStepId: "allow" },
      { id: "allow", type: "allow", config: {} }
    ]
  }];
  let persisted = structuredClone(state);
  let frozen = false;
  const service = new StorageTriggerService({
    executeMacro: async (context) => {
      frozen = Object.isFrozen(context) && Object.isFrozen(context.variables);
      return { outcome: "continue", variables: { unlocked: true } };
    },
    persistRuntime: async (_context, mutate) => {
      mutate(persisted);
      persisted = normalizeStorageTriggerState(persisted);
    }
  });
  const context = {
    runId: "macro-1", fingerprint: "macro-fingerprint", tokenUuid: "Token.chest", path: ["bag"],
    senderId: "gm", characterActorUuid: "Actor.hero"
  };

  await service.execute("beforeOpen", persisted, context);
  assert.equal(frozen, true);
  assert.deepEqual(persisted.variables, { attempts: 1, unlocked: true });
  assert.equal(persisted.executionState.onceGlobal["beforeOpen:macro-lock"], true);
  await assert.rejects(
    service.execute("beforeOpen", persisted, { ...context, fingerprint: "other" }),
    /run|fingerprint|параметр/iu
  );
});
