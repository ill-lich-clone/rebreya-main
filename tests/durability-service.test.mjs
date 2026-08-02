import test from "node:test";
import assert from "node:assert/strict";

import { DurableMutationJournal } from "../scripts/application/durable-mutation-journal.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { MODULE_ID } from "../scripts/constants.js";
import { DurabilityService } from "../scripts/data/durability-service.js";
import { buildInitialDurability, resolveDurabilityProfile } from "../scripts/data/durability-rules.js";

const FIXED_NOW = "2026-07-16T10:00:00.000Z";

function createDeferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createFakeClock(initial = FIXED_NOW) {
  let current = Date.parse(initial);
  return {
    now: () => new Date(current).toISOString(),
    advance(milliseconds) {
      current += milliseconds;
    }
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let current = target;
  while (parts.length > 1) {
    const part = parts.shift();
    current[part] ??= {};
    current = current[part];
  }
  current[parts[0]] = clone(value);
}

function createItem({
  id = "sword-item",
  uuid = `Actor.hero.Item.${id}`,
  type = "weapon",
  system = { equipped: true, attuned: true },
  moduleFlags = { sourceType: "gear", gearId: "sword" },
  updateAckFailures = 0,
  deleteFailures = 0,
  deleteAckFailures = 0,
  exists = true,
  events = [],
  beforePersistUpdate = null,
  afterPersistUpdate = null,
  beforePersistDelete = null
} = {}) {
  let persisted = {
    _id: id,
    id,
    uuid,
    type,
    system: clone(system),
    flags: {
      [MODULE_ID]: clone(moduleFlags)
    }
  };
  let remainingDeleteFailures = deleteFailures;
  let remainingDeleteAckFailures = deleteAckFailures;
  let remainingUpdateAckFailures = updateAckFailures;
  const updates = [];
  const updateOptions = [];
  const deleteOptions = [];
  let deleteCalls = 0;
  let present = exists;

  const item = {
    id,
    uuid,
    type,
    system: deepFreeze(clone(system)),
    flags: deepFreeze({ [MODULE_ID]: clone(moduleFlags) }),
    _source: deepFreeze(clone(persisted)),
    get exists() {
      return present;
    },
    get updates() {
      return clone(updates);
    },
    get deleteCalls() {
      return deleteCalls;
    },
    get updateOptions() {
      return clone(updateOptions);
    },
    get deleteOptions() {
      return clone(deleteOptions);
    },
    get persistedData() {
      return clone(persisted);
    },
    toObject() {
      return clone(persisted);
    },
    getFlag(scope, key) {
      return clone(persisted.flags?.[scope]?.[key]);
    },
    async update(payload, options = {}) {
      const plainPayload = clone(payload);
      const plainOptions = clone(options);
      updates.push(plainPayload);
      updateOptions.push(plainOptions);
      events.push(`update:${plainPayload[`flags.${MODULE_ID}.durability`]?.state ?? "unknown"}`);
      await beforePersistUpdate?.(item, plainPayload, plainOptions);
      for (const [path, value] of Object.entries(plainPayload)) {
        setPath(persisted, path, value);
      }
      await afterPersistUpdate?.(item, plainPayload, plainOptions);
      if (remainingUpdateAckFailures > 0) {
        remainingUpdateAckFailures -= 1;
        throw new Error("update acknowledgement lost");
      }
      return item;
    },
    async delete(options = {}) {
      deleteCalls += 1;
      const plainOptions = clone(options);
      deleteOptions.push(plainOptions);
      events.push("delete");
      await beforePersistDelete?.(item, plainOptions);
      if (remainingDeleteFailures > 0) {
        remainingDeleteFailures -= 1;
        throw new Error("delete failed");
      }
      present = false;
      if (remainingDeleteAckFailures > 0) {
        remainingDeleteAckFailures -= 1;
        throw new Error("delete acknowledgement lost");
      }
      return item;
    }
  };

  return Object.freeze(item);
}

function createJournal(events = []) {
  let state = { version: 1, records: [] };
  return {
    journal: new DurableMutationJournal({
      readState: async () => clone(state),
      writeState: async (nextState) => {
        state = clone(nextState);
        const record = state.records.at(-1);
        events.push(`journal:${record?.phase ?? "missing"}${record?.terminal ? ":terminal" : ""}`);
      },
      normalizeState: (value) => ({
        version: 1,
        records: Array.isArray(value?.records) ? clone(value.records) : []
      })
    }),
    get state() {
      return clone(state);
    }
  };
}

function createModel() {
  const material = {
    id: "refined-steel",
    name: "Refined Steel",
    durabilityProfile: "steel"
  };
  const gear = {
    id: "sword",
    name: "Sword",
    predominantMaterialId: material.id,
    durability: {
      construction: "sturdy",
      size: "small"
    }
  };
  return {
    gear: [gear],
    gearById: new Map([[gear.id, gear]]),
    materials: [material],
    materialById: new Map([[material.id, material]]),
    materialByGoodId: new Map()
  };
}

function createService({
  item,
  model = createModel(),
  events = [],
  isActiveGm = true,
  ownerId = "active-gm",
  now = () => FIXED_NOW,
  store = null
} = {}) {
  store ??= createJournal(events);
  const hookCalls = [];
  const coordinator = new WorldMutationCoordinator();
  const moduleApi = {
    worldMutationCoordinator: coordinator,
    async getModel() {
      return model;
    }
  };
  const service = new DurabilityService(moduleApi, {
    coordinator,
    journal: store.journal,
    resolveItem: async () => item?.exists ? item : null,
    isActiveGm: typeof isActiveGm === "function" ? isActiveGm : () => isActiveGm,
    ownerId: typeof ownerId === "function" ? ownerId : () => ownerId,
    now,
    hooks: {
      callAll(...args) {
        hookCalls.push(args);
        events.push(`hook:${args[2]?.outcome ?? "update"}`);
      }
    }
  });
  return { service, store, hookCalls };
}

function durabilityFlag({ state = "intact", breakStage = 0, hpValue = 15 } = {}) {
  return {
    ...buildInitialDurability(resolveDurabilityProfile({
      material: { durabilityProfile: "steel" }
    })),
    state,
    breakStage,
    hp: { value: hpValue, max: 15 },
    initializedFrom: { sourceType: "gear", sourceId: "sword" },
    updatedAt: "2026-07-15T10:00:00.000Z"
  };
}

test("initializeItem resolves model gear and material once with a complete plain update", async () => {
  const item = createItem();
  const { service, hookCalls } = createService({ item });
  const frozenSystem = item.system;
  const frozenFlags = item.flags;

  const initialized = await service.initializeItem(item);
  const duplicate = await service.initializeItem(item);

  assert.equal(item.updates.length, 1);
  assert.deepEqual(duplicate, initialized);
  assert.equal(initialized.materialProfile, "steel");
  assert.deepEqual(initialized.initializedFrom, { sourceType: "gear", sourceId: "sword" });
  assert.equal(initialized.updatedAt, FIXED_NOW);
  assert.deepEqual(item.updates[0], {
    [`flags.${MODULE_ID}.durability`]: initialized
  });
  assert.equal(Object.getPrototypeOf(item.updates[0]), Object.prototype);
  assert.equal(Object.getPrototypeOf(initialized), Object.prototype);
  assert.equal(item.system, frozenSystem);
  assert.equal(item.flags, frozenFlags);
  assert.equal(hookCalls.length, 1);
});

test("initializeItem only replaces existing durability when force is true", async () => {
  const item = createItem({
    moduleFlags: {
      sourceType: "gear",
      gearId: "sword",
      durability: durabilityFlag({ hpValue: 3 })
    }
  });
  const timestamps = ["2026-07-16T11:00:00.000Z"];
  const { service } = createService({ item, now: () => timestamps.shift() });

  const existing = await service.initializeItem(item);
  const forced = await service.initializeItem(item, { force: true });

  assert.equal(existing.hp.value, 3);
  assert.equal(forced.hp.value, forced.hp.max);
  assert.equal(forced.updatedAt, "2026-07-16T11:00:00.000Z");
  assert.equal(item.updates.length, 1);
});

test("initializeItem leaves magic and noneligible items untouched", async () => {
  const magicItem = createItem({
    system: { rarity: "rare", equipped: false }
  });
  const { service: magicService } = createService({ item: magicItem });
  const materialStack = createItem({
    type: "loot",
    moduleFlags: { sourceType: "material", materialId: "refined-steel" }
  });
  const { service: materialService } = createService({ item: materialStack });

  assert.equal(await magicService.initializeItem(magicItem), null);
  assert.equal(await materialService.initializeItem(materialStack), null);
  assert.equal(magicItem.updates.length, 0);
  assert.equal(materialStack.updates.length, 0);
});

test("damageItem ignores a magic item even when it carries a stale durability flag", async () => {
  const magicItem = createItem({
    system: { rarity: "rare", equipped: true },
    moduleFlags: {
      sourceType: "magicItem",
      magicItemId: "enchanted-sword",
      magical: true,
      durability: durabilityFlag()
    }
  });
  const { service, store } = createService({ item: magicItem });

  const result = await service.damageItem(magicItem, {
    amount: 99,
    damageType: "slashing",
    mutationId: "magic-damage"
  });

  assert.deepEqual(result, {
    outcome: "ignored",
    nextFlag: null,
    appliedDamage: 0
  });
  assert.equal(magicItem.updates.length, 0);
  assert.equal(magicItem.deleteCalls, 0);
  assert.deepEqual(store.state.records, []);
});

test("damageItem applies one pure transition update and emits the hook afterwards", async () => {
  const events = [];
  const originalFlag = deepFreeze(durabilityFlag());
  const item = createItem({
    events,
    moduleFlags: {
      sourceType: "gear",
      gearId: "sword",
      durability: originalFlag
    }
  });
  const { service, hookCalls } = createService({ item, events });
  const snapshot = clone(originalFlag);

  const transition = await service.damageItem(item, { amount: 8, damageType: "slashing" });

  assert.equal(transition.outcome, "damaged");
  assert.equal(transition.nextFlag.hp.value, 7);
  assert.equal(transition.nextFlag.updatedAt, FIXED_NOW);
  assert.equal(item.updates.length, 1);
  assert.deepEqual(Object.keys(item.updates[0]), [`flags.${MODULE_ID}.durability`]);
  assert.deepEqual(originalFlag, snapshot);
  assert.deepEqual(events, ["update:intact", "hook:damaged"]);
  assert.deepEqual(hookCalls[0], [
    `${MODULE_ID}.durabilityUpdated`,
    item,
    transition
  ]);
});

test("breakItem clears equipped and supported attunement fields but preserves held state", async () => {
  const item = createItem({
    system: {
      equipped: true,
      attuned: true,
      attunement: 2
    },
    moduleFlags: {
      sourceType: "gear",
      gearId: "sword",
      heldHands: ["left"],
      durability: durabilityFlag({ hpValue: 4 })
    }
  });
  const { service } = createService({ item });

  const transition = await service.breakItem(item);

  assert.equal(transition.outcome, "broken");
  assert.deepEqual(transition.nextFlag.hp, { value: 0, max: 15 });
  assert.deepEqual(item.updates[0], {
    [`flags.${MODULE_ID}.durability`]: transition.nextFlag,
    "system.equipped": false,
    "system.attuned": false,
    "system.attunement": 0
  });
  assert.deepEqual(item.persistedData.flags[MODULE_ID].heldHands, ["left"]);
  assert.deepEqual(item.flags[MODULE_ID].heldHands, ["left"]);
});

test("destroyItem journals the UUID before delete and is durably idempotent", async () => {
  const events = [];
  const item = createItem({
    events,
    moduleFlags: {
      sourceType: "gear",
      gearId: "sword",
      durability: durabilityFlag({ state: "broken", breakStage: 1 })
    }
  });
  const { service, store } = createService({ item, events });

  const first = await service.destroyItem(item, { mutationId: "destroy-sword" });
  const duplicate = await service.destroyItem(item, { mutationId: "destroy-sword" });

  assert.equal(first.outcome, "destroyed");
  assert.deepEqual(duplicate, first);
  assert.equal(item.updates.length, 1);
  assert.equal(item.deleteCalls, 1);
  assert.deepEqual(events, [
    "journal:prepared",
    "journal:update-pending",
    "update:destroyed",
    "hook:destroyed",
    "journal:visible-destroyed",
    "journal:delete-pending",
    "delete",
    "journal:deleted",
    "journal:deleted:terminal"
  ]);
  assert.equal(store.state.records.length, 1);
  assert.equal(store.state.records[0].itemUuid, item.uuid);
  assert.equal(store.state.records[0].phase, "deleted");
  assert.equal(store.state.records[0].terminal, true);
});

test("failed deletion leaves a visible destroyed item and retry completes without another update", async () => {
  const item = createItem({
    deleteFailures: 1,
    moduleFlags: {
      sourceType: "gear",
      gearId: "sword",
      heldHands: ["right"],
      durability: durabilityFlag({ state: "broken", breakStage: 1 })
    }
  });
  const { service, store } = createService({ item });

  await assert.rejects(
    service.destroyItem(item, { mutationId: "retry-delete" }),
    /delete failed/u
  );

  assert.equal(item.persistedData.flags[MODULE_ID].durability.state, "destroyed");
  assert.deepEqual(item.persistedData.flags[MODULE_ID].heldHands, ["right"]);
  assert.equal(store.state.records[0].phase, "visible-destroyed");
  assert.equal(store.state.records[0].terminal, false);

  const result = await service.destroyItem(item, { mutationId: "retry-delete" });

  assert.equal(result.outcome, "destroyed");
  assert.equal(item.updates.length, 1);
  assert.equal(item.deleteCalls, 2);
  assert.equal(store.state.records[0].terminal, true);
});

test("destroy retry emits the refresh hook after an acknowledged-lost destroyed update", async () => {
  const item = createItem({
    updateAckFailures: 1,
    deleteFailures: 1,
    moduleFlags: {
      sourceType: "gear",
      gearId: "sword",
      durability: durabilityFlag({ state: "broken", breakStage: 1 })
    }
  });
  const { service, store, hookCalls } = createService({ item });

  await assert.rejects(
    service.destroyItem(item, { mutationId: "lost-update-ack" }),
    /acknowledgement lost/u
  );
  assert.equal(item.updates.length, 1);
  assert.equal(item.persistedData.flags[MODULE_ID].durability.state, "destroyed");
  assert.equal(store.state.records[0].phase, "visible-destroyed");
  assert.equal(hookCalls.length, 0);

  await assert.rejects(
    service.destroyItem(item, { mutationId: "lost-update-ack" }),
    /delete failed/u
  );
  assert.equal(store.state.records[0].phase, "visible-destroyed");
  assert.equal(hookCalls.length, 1);
  assert.equal(hookCalls[0][2].outcome, "destroyed");
});

test("destroyItem observes a lost delete acknowledgement without repeating delete", async () => {
  const item = createItem({
    deleteAckFailures: 1,
    moduleFlags: {
      sourceType: "gear",
      gearId: "sword",
      durability: durabilityFlag({ state: "broken", breakStage: 1 })
    }
  });
  const { service, store } = createService({ item });

  const first = await service.destroyItem(item, { mutationId: "lost-delete-ack" });
  const duplicate = await service.destroyItem(item, { mutationId: "lost-delete-ack" });

  assert.equal(first.outcome, "destroyed");
  assert.deepEqual(duplicate, first);
  assert.equal(item.deleteCalls, 1);
  assert.equal(store.state.records[0].phase, "deleted");
  assert.equal(store.state.records[0].terminal, true);
});

test("destroyItem treats an already missing document as committed", async () => {
  const item = createItem({
    exists: false,
    moduleFlags: {
      sourceType: "gear",
      gearId: "sword",
      durability: durabilityFlag({ state: "broken", breakStage: 1 })
    }
  });
  const { service, store } = createService({ item });

  const result = await service.destroyItem(item, { mutationId: "already-missing" });

  assert.equal(result.outcome, "destroyed");
  assert.equal(item.updates.length, 0);
  assert.equal(item.deleteCalls, 0);
  assert.equal(store.state.records[0].phase, "deleted");
  assert.equal(store.state.records[0].terminal, true);
});

test("damageItem persists depletion at zero without deleting the item", async () => {
  const item = createItem({
    moduleFlags: {
      sourceType: "gear",
      gearId: "sword",
      durability: durabilityFlag({ state: "intact", breakStage: 0, hpValue: 5 })
    }
  });
  const { service } = createService({ item });

  const result = await service.damageItem(item, {
    amount: 12,
    damageType: "bludgeoning",
    mutationId: "second-zero"
  });

  assert.equal(result.outcome, "depleted");
  assert.equal(result.nextFlag.state, "intact");
  assert.deepEqual(result.nextFlag.hp, { value: 0, max: 15 });
  assert.equal(item.updates.length, 1);
  assert.equal(item.deleteCalls, 0);
});

test("destroyItem rejects inactive-GM mutation ownership before journaling", async () => {
  const item = createItem({
    moduleFlags: {
      durability: durabilityFlag({ state: "broken", breakStage: 1 })
    }
  });
  const { service, store } = createService({ item, isActiveGm: false });

  await assert.rejects(
    service.destroyItem(item, { mutationId: "player-delete" }),
    (error) => error?.code === "gm-required"
  );
  assert.deepEqual(store.state.records, []);
  assert.equal(item.updates.length, 0);
  assert.equal(item.deleteCalls, 0);
});

test("destroyItem stops the old GM after failover and the new GM resumes exactly once", async () => {
  let releaseUpdate;
  let updatePersistedResolve;
  const updatePersisted = new Promise((resolve) => {
    updatePersistedResolve = resolve;
  });
  const updateGate = new Promise((resolve) => {
    releaseUpdate = resolve;
  });
  const events = [];
  const item = createItem({
    events,
    moduleFlags: {
      durability: durabilityFlag({ state: "broken", breakStage: 1 })
    },
    async afterPersistUpdate() {
      updatePersistedResolve();
      await updateGate;
    }
  });
  const store = createJournal(events);
  let activeGm = "old";
  const oldService = createService({
    item,
    events,
    store,
    isActiveGm: () => activeGm === "old"
  }).service;
  const newService = createService({
    item,
    events,
    store,
    isActiveGm: () => activeGm === "new"
  }).service;

  const oldAttempt = oldService.destroyItem(item, { mutationId: "gm-failover" });
  const oldRejected = assert.rejects(oldAttempt, (error) => error?.code === "gm-required");
  await updatePersisted;
  activeGm = "new";
  const newAttempt = newService.destroyItem(item, { mutationId: "gm-failover" });
  releaseUpdate();

  await oldRejected;
  const result = await newAttempt;

  assert.equal(result.outcome, "destroyed");
  assert.equal(item.updates.length, 1);
  assert.equal(item.deleteCalls, 1);
  assert.equal(store.state.records[0].phase, "deleted");
  assert.equal(store.state.records[0].terminal, true);
});

test("destroyItem does not repeat an unresolved update after active-GM failover", async () => {
  let releaseUpdate;
  let updateStartedResolve;
  const updateStarted = new Promise((resolve) => {
    updateStartedResolve = resolve;
  });
  const updateGate = new Promise((resolve) => {
    releaseUpdate = resolve;
  });
  const item = createItem({
    moduleFlags: {
      durability: durabilityFlag({ state: "broken", breakStage: 1 })
    },
    async beforePersistUpdate() {
      updateStartedResolve();
      await updateGate;
    }
  });
  const store = createJournal();
  let activeGm = "old";
  const oldService = createService({
    item,
    store,
    isActiveGm: () => activeGm === "old"
  }).service;
  const newService = createService({
    item,
    store,
    isActiveGm: () => activeGm === "new"
  }).service;

  const oldAttempt = oldService.destroyItem(item, { mutationId: "deferred-update" });
  await updateStarted;
  activeGm = "new";
  const newAttempt = newService.destroyItem(item, { mutationId: "deferred-update" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.state.records[0].phase, "update-pending");
  assert.equal(store.state.records[0].sideEffect.kind, "update");
  assert.equal(store.state.records[0].sideEffect.ownerId, "active-gm");
  assert.equal(store.state.records[0].sideEffect.leaseExpiresAt, "2026-07-16T10:00:30.000Z");
  releaseUpdate();
  const [oldSettled, newSettled] = await Promise.allSettled([oldAttempt, newAttempt]);
  assert.equal(oldSettled.reason?.code, "gm-required");
  assert.equal(newSettled.reason?.code, "durability-side-effect-pending");

  const result = await newService.destroyItem(item, { mutationId: "deferred-update" });

  assert.equal(result.outcome, "destroyed");
  assert.equal(item.updates.length, 1);
  assert.equal(item.deleteCalls, 1);
});

test("destroyItem does not repeat an unresolved delete after active-GM failover", async () => {
  let releaseDelete;
  let deleteStartedResolve;
  const deleteStarted = new Promise((resolve) => {
    deleteStartedResolve = resolve;
  });
  const deleteGate = new Promise((resolve) => {
    releaseDelete = resolve;
  });
  const item = createItem({
    moduleFlags: {
      durability: durabilityFlag({ state: "broken", breakStage: 1 })
    },
    async beforePersistDelete() {
      deleteStartedResolve();
      await deleteGate;
    }
  });
  const store = createJournal();
  let activeGm = "old";
  const oldService = createService({
    item,
    store,
    isActiveGm: () => activeGm === "old"
  }).service;
  const newService = createService({
    item,
    store,
    isActiveGm: () => activeGm === "new"
  }).service;

  const oldAttempt = oldService.destroyItem(item, { mutationId: "deferred-delete" });
  await deleteStarted;
  activeGm = "new";
  const newAttempt = newService.destroyItem(item, { mutationId: "deferred-delete" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.state.records[0].phase, "delete-pending");
  assert.equal(store.state.records[0].sideEffect.kind, "delete");
  assert.equal(store.state.records[0].sideEffect.ownerId, "active-gm");
  assert.equal(store.state.records[0].sideEffect.leaseExpiresAt, "2026-07-16T10:00:30.000Z");
  releaseDelete();
  const [oldSettled, newSettled] = await Promise.allSettled([oldAttempt, newAttempt]);
  assert.equal(oldSettled.reason?.code, "gm-required");
  assert.equal(newSettled.reason?.code, "durability-side-effect-pending");

  const result = await newService.destroyItem(item, { mutationId: "deferred-delete" });

  assert.equal(result.outcome, "destroyed");
  assert.equal(item.updates.length, 1);
  assert.equal(item.deleteCalls, 1);
});

test("an expired update lease is conditionally taken over and fences the stale GM", async () => {
  const clock = createFakeClock();
  const updateStarted = [createDeferred(), createDeferred()];
  const updateGates = [createDeferred(), createDeferred()];
  let updateIndex = 0;
  const item = createItem({
    moduleFlags: {
      durability: durabilityFlag({ state: "broken", breakStage: 1 })
    },
    async beforePersistUpdate() {
      const index = updateIndex;
      updateIndex += 1;
      updateStarted[index]?.resolve();
      await updateGates[index]?.promise;
    }
  });
  const store = createJournal();
  let activeGm = "old";
  const oldHarness = createService({
    item,
    store,
    isActiveGm: () => activeGm === "old",
    ownerId: "old-gm",
    now: clock.now
  });
  const newHarness = createService({
    item,
    store,
    isActiveGm: () => activeGm === "new",
    ownerId: "new-gm",
    now: clock.now
  });

  const oldAttempt = oldHarness.service.destroyItem(item, { mutationId: "expired-update" });
  await updateStarted[0].promise;
  const originalRecord = store.state.records[0];
  clock.advance(30_001);
  activeGm = "new";
  const newAttempt = newHarness.service.destroyItem(item, { mutationId: "expired-update" });
  const takeoverStarted = await Promise.race([
    updateStarted[1].promise.then(() => true),
    newAttempt.then(() => false, () => false)
  ]);
  if (!takeoverStarted) {
    updateGates[0].resolve();
    updateGates[1].resolve();
    await Promise.allSettled([oldAttempt, newAttempt]);
  }
  assert.equal(takeoverStarted, true);

  const takeoverRecord = store.state.records[0];
  assert.notEqual(takeoverRecord.phase, originalRecord.phase);
  assert.equal(takeoverRecord.sideEffect.ownerId, "new-gm");
  assert.equal(takeoverRecord.sideEffect.leaseExpiresAt, "2026-07-16T10:01:00.001Z");
  assert.deepEqual(
    {
      mutationId: takeoverRecord.sideEffect.mutationId,
      mutationGroup: takeoverRecord.sideEffect.mutationGroup,
      itemUuid: takeoverRecord.sideEffect.itemUuid
    },
    {
      mutationId: originalRecord.sideEffect.mutationId,
      mutationGroup: originalRecord.sideEffect.mutationGroup,
      itemUuid: item.uuid
    }
  );

  activeGm = "old";
  updateGates[0].resolve();
  await assert.rejects(
    oldAttempt,
    (error) => error?.code === "durability-side-effect-fenced"
  );
  assert.equal(oldHarness.hookCalls.length, 0);
  assert.equal(store.state.records[0].phase, takeoverRecord.phase);

  activeGm = "new";
  updateGates[1].resolve();
  const result = await newAttempt;

  const expectedContext = {
    mutationId: "durability-destroy:expired-update:update",
    mutationGroup: "durability-destroy:expired-update",
    itemUuid: item.uuid
  };
  assert.equal(result.outcome, "destroyed");
  assert.equal(item.updates.length, 2);
  assert.equal(item.deleteCalls, 1);
  assert.deepEqual(
    item.updateOptions.map((options) => options[MODULE_ID]),
    [expectedContext, expectedContext]
  );
  assert.equal(newHarness.hookCalls.length, 1);
  assert.equal(store.state.records[0].terminal, true);
});

test("an expired delete lease is conditionally taken over and fences the stale GM", async () => {
  const clock = createFakeClock();
  const deleteStarted = [createDeferred(), createDeferred()];
  const deleteGates = [createDeferred(), createDeferred()];
  let deleteIndex = 0;
  const item = createItem({
    moduleFlags: {
      durability: durabilityFlag({ state: "broken", breakStage: 1 })
    },
    async beforePersistDelete() {
      const index = deleteIndex;
      deleteIndex += 1;
      deleteStarted[index]?.resolve();
      await deleteGates[index]?.promise;
    }
  });
  const store = createJournal();
  let activeGm = "old";
  const oldHarness = createService({
    item,
    store,
    isActiveGm: () => activeGm === "old",
    ownerId: "old-gm",
    now: clock.now
  });
  const newHarness = createService({
    item,
    store,
    isActiveGm: () => activeGm === "new",
    ownerId: "new-gm",
    now: clock.now
  });

  const oldAttempt = oldHarness.service.destroyItem(item, { mutationId: "expired-delete" });
  await deleteStarted[0].promise;
  const originalRecord = store.state.records[0];
  clock.advance(30_001);
  activeGm = "new";
  const newAttempt = newHarness.service.destroyItem(item, { mutationId: "expired-delete" });
  const takeoverStarted = await Promise.race([
    deleteStarted[1].promise.then(() => true),
    newAttempt.then(() => false, () => false)
  ]);
  if (!takeoverStarted) {
    deleteGates[0].resolve();
    deleteGates[1].resolve();
    await Promise.allSettled([oldAttempt, newAttempt]);
  }
  assert.equal(takeoverStarted, true);

  const takeoverRecord = store.state.records[0];
  assert.notEqual(takeoverRecord.phase, originalRecord.phase);
  assert.equal(takeoverRecord.sideEffect.ownerId, "new-gm");
  assert.equal(takeoverRecord.sideEffect.leaseExpiresAt, "2026-07-16T10:01:00.001Z");
  assert.deepEqual(
    {
      mutationId: takeoverRecord.sideEffect.mutationId,
      mutationGroup: takeoverRecord.sideEffect.mutationGroup,
      itemUuid: takeoverRecord.sideEffect.itemUuid
    },
    {
      mutationId: originalRecord.sideEffect.mutationId,
      mutationGroup: originalRecord.sideEffect.mutationGroup,
      itemUuid: item.uuid
    }
  );

  activeGm = "old";
  deleteGates[0].resolve();
  await assert.rejects(
    oldAttempt,
    (error) => error?.code === "durability-side-effect-fenced"
  );
  assert.equal(store.state.records[0].phase, takeoverRecord.phase);

  activeGm = "new";
  deleteGates[1].resolve();
  const result = await newAttempt;

  const expectedContext = {
    mutationId: "durability-destroy:expired-delete:delete",
    mutationGroup: "durability-destroy:expired-delete",
    itemUuid: item.uuid
  };
  assert.equal(result.outcome, "destroyed");
  assert.equal(item.updates.length, 1);
  assert.equal(item.deleteCalls, 2);
  assert.deepEqual(
    item.deleteOptions.map((options) => options[MODULE_ID]),
    [expectedContext, expectedContext]
  );
  assert.equal(store.state.records[0].terminal, true);
});
