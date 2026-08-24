import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import { DowntimeService } from "../scripts/data/downtime-service.js?v=1.4.96-craft-calendar";
import { normalizeGroupState } from "../scripts/data/group-context-service.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createActor({
  id,
  name = id,
  type = "character",
  ownerUserId = "",
  isOwner = false
} = {}) {
  return {
    id,
    name,
    type,
    img: "icons/svg/mystery-man.svg",
    isOwner,
    ownership: ownerUserId ? { [ownerUserId]: 3 } : {},
    testUserPermission(user, permission) {
      return permission === "OWNER" && (user?.isGM || user?.id === ownerUserId || isOwner);
    }
  };
}

function createGroup(id, members = [], items = []) {
  return {
    id,
    name: "Party",
    type: "group",
    items: {
      contents: items,
      get(itemId) {
        return items.find((item) => item.id === itemId) ?? null;
      }
    },
    system: {
      members: members.map((actor) => ({ actor }))
    }
  };
}

function createRegistry(groupId, downtimeState = {}) {
  return {
    version: 1,
    activeGroupActorId: groupId,
    groupsById: {
      [groupId]: {
        version: 1,
        groupActorId: groupId,
        downtimeState
      }
    }
  };
}

function createHarness({
  user = { id: "gm", isGM: true },
  members = [],
  groupItems = [],
  downtimeState = {},
  packs = null,
  calendarIsoDate = "2026-07-16",
  queuedMutations = true
} = {}) {
  const previousGame = globalThis.game;
  const groupActor = createGroup("group-1", members, groupItems);
  let registry = createRegistry(groupActor.id, clone(downtimeState));
  let setRegistryCalls = 0;
  let mutateGroupStateCalls = 0;
  let mutationQueue = Promise.resolve();
  let nextCommitFailure = null;

  globalThis.game = {
    user,
    packs
  };

  const groupContextService = {
    resolveForCurrentUser() {
      return {
        groupActor,
        groupId: groupActor.id,
        groupState: registry.groupsById[groupActor.id],
        members,
        memberActorIds: members.map((actor) => actor.id),
        canManage: Boolean(globalThis.game?.user?.isGM)
      };
    },
    resolveForGroup(groupActorId) {
      if (groupActorId !== groupActor.id) {
        throw new Error("group not found");
      }

      return {
        groupActor,
        groupId: groupActor.id,
        groupState: registry.groupsById[groupActor.id],
        members,
        memberActorIds: members.map((actor) => actor.id),
        canManage: Boolean(globalThis.game?.user?.isGM)
      };
    },
    getRegistry() {
      return clone(registry);
    },
    async setRegistry(nextRegistry) {
      setRegistryCalls += 1;
      registry = clone(nextRegistry);
      return clone(registry);
    }
  };

  if (queuedMutations) {
    groupContextService.mutateGroupState = (groupActorId, mutator, { create = false } = {}) => {
      mutateGroupStateCalls += 1;
      const operation = mutationQueue.then(async () => {
        const workingRegistry = clone(registry);
        if (!workingRegistry.groupsById[groupActorId] && !create) {
          throw new Error(`Group state not found: ${groupActorId}`);
        }
        workingRegistry.groupsById[groupActorId] ??= {
          version: 1,
          groupActorId
        };
        const result = await mutator(workingRegistry.groupsById[groupActorId]);
        const failure = nextCommitFailure;
        nextCommitFailure = null;
        if (failure && !failure.afterCommit) {
          throw failure.error;
        }
        registry = clone(workingRegistry);
        if (failure?.afterCommit) {
          throw failure.error;
        }
        return clone(result);
      });
      mutationQueue = operation.catch(() => undefined);
      return operation;
    };
  }

  const moduleApi = {
    groupContextService,
    getCalendarSnapshot() {
      return { isoDate: calendarIsoDate };
    }
  };

  return {
    service: new DowntimeService(moduleApi),
    groupActor,
    groupContextService,
    get registry() {
      return registry;
    },
    get setRegistryCalls() {
      return setRegistryCalls;
    },
    get mutateGroupStateCalls() {
      return mutateGroupStateCalls;
    },
    mutateDowntimeState(mutator) {
      return groupContextService.mutateGroupState(groupActor.id, (groupState) => {
        const persistedState = groupState.downtimeState;
        const envelope = persistedState.history?.find((entry) => entry.id === "downtime-state-v2-envelope");
        const logicalState = envelope
          ? {
              ...persistedState,
              grants: envelope.grants,
              scheduleSlots: envelope.scheduleSlots,
              transitionJournal: envelope.transitionJournal,
              workLog: envelope.workLog
            }
          : persistedState;
        const result = mutator(logicalState);
        if (envelope) {
          for (const field of ["grants", "scheduleSlots", "transitionJournal", "workLog"]) {
            envelope[field] = clone(logicalState[field]);
            persistedState[field] = clone(logicalState[field]);
          }
        }
        return result;
      });
    },
    failNextMutationCommit({ afterCommit = false, error = new Error("persist failed") } = {}) {
      nextCommitFailure = { afterCommit, error };
      return error;
    },
    restore() {
      globalThis.game = previousGame;
    }
  };
}

function createDowntimeTemplateItem({
  id = "downtime-research",
  name = "Исследование",
  config = {}
} = {}) {
  return {
    id,
    name,
    type: "rebreya-main.downtime",
    uuid: `Actor.group-1.Item.${id}`,
    img: "icons/svg/hourglass.svg",
    getFlag(scope, key) {
      return scope === MODULE_ID && key === "downtime" ? clone(config) : undefined;
    }
  };
}

function getDowntimeState(harness) {
  return harness.registry.groupsById["group-1"].downtimeState;
}

test("v1 downtime migrates to v2 workdays once without dropping scheduler or request data", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      version: 1,
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 2,
          reservedWeeks: 1,
          spentWeeks: 1,
          totalGrantedWeeks: 4
        }
      },
      grants: [{ id: "legacy-grant", actorId: "actor-a", customGrantField: "kept" }],
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actionId: "legacy-action",
        title: "Legacy request",
        weeks: 1,
        status: "pending",
        customRequestField: "kept",
        checks: [{ id: "legacy-check", label: "Check", customCheckField: "kept" }]
      }],
      scheduleSlots: [{
        id: "legacy-slot",
        actorId: "actor-a",
        isoDate: "2026-07-20",
        status: "pending",
        grantId: "legacy-grant",
        requestId: "downtime-1",
        customSlotField: "kept"
      }],
      workLog: [{
        id: "legacy-log",
        actorId: "actor-a",
        isoDate: "2026-07-10",
        transitionId: "legacy-transition",
        customLogField: "kept"
      }],
      history: [{ id: "legacy-history", type: "legacy", customHistoryField: "kept" }],
      counter: 1
    }
  });

  try {
    const snapshot = harness.service.getSnapshot({ actorId: "actor-a" });
    assert.equal(snapshot.version, 2);
    assert.deepEqual({
      availableWorkdays: snapshot.balance.availableWorkdays,
      reservedWorkdays: snapshot.balance.reservedWorkdays,
      spentWorkdays: snapshot.balance.spentWorkdays,
      totalGrantedWorkdays: snapshot.balance.totalGrantedWorkdays
    }, {
      availableWorkdays: 10,
      reservedWorkdays: 5,
      spentWorkdays: 5,
      totalGrantedWorkdays: 20
    });
    assert.equal(snapshot.grants[0].customGrantField, "kept");
    assert.equal(snapshot.requests[0].customRequestField, "kept");
    assert.equal(snapshot.requests[0].checks[0].customCheckField, "kept");
    assert.equal(snapshot.scheduleSlots[0].customSlotField, "kept");
    assert.equal(snapshot.workLog[0].customLogField, "kept");
    assert.equal(snapshot.history[0].customHistoryField, "kept");
    assert.equal(snapshot.history.filter((entry) => entry.migrationId === "downtime-v1-to-v2").length, 1);

    await harness.service.grantWeeks({ actorIds: ["actor-a"], weeks: 1, fromIsoDate: "2026-08-03" });
    const persisted = getDowntimeState(harness);
    assert.equal(persisted.version, 2);
    assert.equal(Object.hasOwn(persisted.balancesByActorId["actor-a"], "availableWeeks"), false);
    assert.equal(persisted.history.filter((entry) => entry.migrationId === "downtime-v1-to-v2").length, 1);
    assert.equal(harness.mutateGroupStateCalls, 1);
    assert.equal(harness.setRegistryCalls, 0);
  }
  finally {
    harness.restore();
  }
});

test("downtime v2 survives the existing legacy group-state normalizer", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const writer = createHarness({ members: [actor], downtimeState: { version: 2 } });

  try {
    await writer.service.grantWeeks({ actorIds: ["actor-a"], weeks: 1 });
    const normalizedGroupState = normalizeGroupState("group-1", {
      groupActorId: "group-1",
      downtimeState: clone(getDowntimeState(writer))
    });
    const reader = createHarness({ members: [actor], downtimeState: normalizedGroupState.downtimeState });
    try {
      const snapshot = reader.service.getSnapshot({ actorId: "actor-a" });
      assert.equal(snapshot.version, 2);
      assert.equal(snapshot.grants.length, 1);
      assert.equal(snapshot.scheduleSlots.length, 5);
      assert.equal(snapshot.balance.availableWorkdays, 5);
    }
    finally {
      reader.restore();
    }
  }
  finally {
    writer.restore();
  }
});

test("grantWeeks creates five calendar slots per week from the module calendar or explicit date", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    calendarIsoDate: "2026-07-16",
    downtimeState: { version: 2 }
  });

  try {
    await harness.service.grantWeeks({ actorIds: ["actor-a"], weeks: 1, reason: "calendar grant" });
    await harness.service.grantWeeks({
      actorIds: ["actor-a"],
      weeks: 1,
      reason: "explicit grant",
      fromIsoDate: "2026-08-01"
    });

    const state = getDowntimeState(harness);
    assert.deepEqual(state.grants.map((grant) => grant.anchorMonday), ["2026-07-20", "2026-08-03"]);
    assert.deepEqual(state.scheduleSlots.map((slot) => slot.isoDate), [
      "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24",
      "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"
    ]);
    assert.equal(state.scheduleSlots.every((slot) => slot.hours === null), true);
    assert.equal(state.balancesByActorId["actor-a"].availableWorkdays, 10);
    assert.equal(state.balancesByActorId["actor-a"].totalGrantedWorkdays, 10);
    assert.equal(harness.mutateGroupStateCalls, 2);
    assert.equal(harness.setRegistryCalls, 0);
  }
  finally {
    harness.restore();
  }
});

test("grantWeeks accepts the unpadded early-year dates used by the world calendar", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    calendarIsoDate: "402-03-13",
    downtimeState: { version: 2 }
  });

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const state = getDowntimeState(harness);
    assert.deepEqual(state.scheduleSlots.map((slot) => slot.isoDate), [
      "402-03-18",
      "402-03-19",
      "402-03-20",
      "402-03-21",
      "402-03-22"
    ]);
  }
  finally {
    harness.restore();
  }
});

test("createRequest allocates pending workdays and approval propagates to its slots", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-training", name: "Training" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });

  try {
    await harness.service.grantWeeks({ actorIds: ["actor-a"], weeks: 1 });
    const request = await harness.service.createRequest({
      actorId: "actor-a",
      actionId: templateItem.uuid,
      title: "Train",
      weeks: 1
    });
    let state = getDowntimeState(harness);
    assert.equal(request.workdays, 5);
    assert.equal(state.scheduleSlots.filter((slot) => slot.requestId === request.id).length, 5);
    assert.equal(state.scheduleSlots.every((slot) => slot.status === "pending"), true);
    assert.equal(state.balancesByActorId["actor-a"].availableWorkdays, 0);
    assert.equal(state.balancesByActorId["actor-a"].reservedWorkdays, 5);

    await harness.service.setRequestStatus(request.id, "approved");
    state = getDowntimeState(harness);
    assert.equal(state.scheduleSlots.every((slot) => slot.status === "approved"), true);
    assert.equal(state.balancesByActorId["actor-a"].reservedWorkdays, 5);
    assert.equal(state.balancesByActorId["actor-a"].spentWorkdays, 0);
  }
  finally {
    harness.restore();
  }
});

test("createRequest preserves a canonical craft project and reflows owned-workshop days", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-craft",
    name: "Craft",
    config: { downtimeId: "craft" }
  });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  const craftProject = {
    outputs: [{ sourceType: "gear", sourceId: "longsword", quantity: 1 }],
    predominantMaterialId: "steel",
    hoursPerDay: 12,
    ownedWorkshop: true
  };

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 2 });
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      weeks: 2,
      craftProject
    });

    assert.deepEqual(request.craftProject, craftProject);
    assert.equal(request.ownedWorkshop, true);
    const slots = getDowntimeState(harness).scheduleSlots
      .filter((slot) => slot.requestId === request.id)
      .sort((left, right) => left.isoDate.localeCompare(right.isoDate));
    assert.equal(slots.length, 10);
    assert.deepEqual(slots.map((slot) => slot.isoDate), [
      "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24",
      "2026-07-25", "2026-07-26", "2026-07-27", "2026-07-28", "2026-07-29"
    ]);
  }
  finally {
    harness.restore();
  }
});

test("craft request reserves its exact calculated workdays instead of whole week blocks", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-craft",
    name: "Craft",
    config: { downtimeId: "craft" }
  });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 2 });
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      weeks: 2,
      craftProject: {
        outputs: [{ sourceType: "gear", sourceId: "longsword", quantity: 1 }],
        predominantMaterialId: "steel",
        hoursPerDay: 8,
        ownedWorkshop: true,
        requiredWorkdays: 7,
        requiredDowntimeWeeks: 2
      }
    });

    const state = getDowntimeState(harness);
    const slots = state.scheduleSlots.filter((slot) => slot.requestId === request.id);
    assert.equal(request.weeks, 2);
    assert.equal(request.workdays, 7);
    assert.equal(slots.length, 7);
    assert.equal(state.balancesByActorId[actor.id].availableWorkdays, 3);
    assert.equal(state.balancesByActorId[actor.id].reservedWorkdays, 7);
  }
  finally {
    harness.restore();
  }
});

test("createRequest requires craft payload only for the authoritative craft action", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const craftItem = createDowntimeTemplateItem({
    id: "downtime-craft",
    name: "Craft",
    config: { downtimeId: "craft" }
  });
  const trainingItem = createDowntimeTemplateItem({ id: "downtime-training", name: "Training" });
  const harness = createHarness({
    members: [actor],
    groupItems: [craftItem, trainingItem],
    downtimeState: { version: 2 }
  });

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 2 });
    await assert.rejects(
      harness.service.createRequest({
        actorId: actor.id,
        actionId: craftItem.uuid,
        weeks: 1,
        craftProject: {}
      }),
      /craft project payload/iu
    );
    await assert.rejects(
      harness.service.createRequest({
        actorId: actor.id,
        actionId: trainingItem.uuid,
        weeks: 1,
        craftProject: {
          outputs: [{ sourceType: "gear", sourceId: "longsword", quantity: 1 }],
          requiredWorkdays: 1
        }
      }),
      /only be attached to the craft action/iu
    );
    const state = getDowntimeState(harness);
    assert.equal(state.requests.length, 0);
    assert.equal(state.balancesByActorId[actor.id].availableWorkdays, 10);
  }
  finally {
    harness.restore();
  }
});

test("generic request status cannot approve a craft request without linking its project", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-craft",
    name: "Craft",
    config: { downtimeId: "craft" }
  });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      weeks: 1,
      craftProject: {
        outputs: [{ sourceType: "gear", sourceId: "longsword", quantity: 1 }],
        predominantMaterialId: "steel",
        hoursPerDay: 8,
        ownedWorkshop: false
      }
    });

    await assert.rejects(
      harness.service.setRequestStatus(request.id, "approved"),
      /craft project approval/iu
    );

    const state = getDowntimeState(harness);
    assert.equal(state.requests[0].status, "pending");
    assert.equal(state.requests[0].craftProjectId, undefined);
    assert.equal(state.scheduleSlots.every((slot) => slot.status === "pending"), true);
  }
  finally {
    harness.restore();
  }
});

test("linkCraftProject atomically approves the request and binds every reserved slot", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-craft",
    name: "Craft",
    config: { downtimeId: "craft" }
  });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      weeks: 1,
      craftProject: {
        outputs: [{ sourceType: "gear", sourceId: "longsword", quantity: 1 }],
        predominantMaterialId: "steel",
        hoursPerDay: 12,
        ownedWorkshop: false
      }
    });
    const link = {
      projectId: "craft-project-1",
      hoursPerDay: 12,
      ownedWorkshop: false,
      mutationId: "approve-craft-request-1"
    };

    const approved = await harness.service.linkCraftProject(request.id, link);
    const repeated = await harness.service.linkCraftProject(request.id, link);
    const state = getDowntimeState(harness);

    assert.equal(approved.status, "approved");
    assert.equal(repeated.craftProjectId, link.projectId);
    assert.equal(state.requests[0].craftProjectId, link.projectId);
    assert.equal(state.requests[0].craftApprovalMutationId, link.mutationId);
    assert.equal(state.scheduleSlots.every((slot) => (
      slot.requestId === request.id
      && slot.status === "approved"
      && slot.projectId === link.projectId
      && slot.activityId === "craft"
      && slot.hours === 12
    )), true);
    assert.equal(state.balancesByActorId[actor.id].reservedWorkdays, 5);

    await assert.rejects(
      harness.service.linkCraftProject(request.id, {
        ...link,
        projectId: "craft-project-2",
        mutationId: "approve-craft-request-2"
      }),
      /already linked/iu
    );
  }
  finally {
    harness.restore();
  }
});

test("returned rejected and cancelled requests release their unprocessed future slots", async () => {
  for (const status of ["returned", "rejected", "cancelled"]) {
    const actor = createActor({ id: "actor-a", name: "Hero A" });
    const templateItem = createDowntimeTemplateItem({ id: "downtime-training", name: "Training" });
    const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });

    try {
      await harness.service.grantWeeks({ actorIds: ["actor-a"], weeks: 1 });
      const request = await harness.service.createRequest({
        actorId: "actor-a",
        actionId: templateItem.uuid,
        weeks: 1
      });
      await harness.service.setRequestStatus(request.id, status);

      const state = getDowntimeState(harness);
      assert.equal(state.scheduleSlots.every((slot) => slot.status === "free" && slot.requestId === null), true, status);
      assert.equal(state.balancesByActorId["actor-a"].availableWorkdays, 5, status);
      assert.equal(state.balancesByActorId["actor-a"].reservedWorkdays, 0, status);
    }
    finally {
      harness.restore();
    }
  }
});

test("processScheduledDate spends an approved slot once and release keeps it immutable", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  let processorCalls = 0;

  try {
    await harness.service.grantWeeks({ actorIds: ["actor-a"], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: "actor-a", actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(request.id, "approved");
    const isoDate = getDowntimeState(harness).scheduleSlots[0].isoDate;
    const activityProcessor = async (slot, context) => {
      processorCalls += 1;
      assert.equal(slot.requestId, request.id);
      assert.equal(Object.isFrozen(context), true);
      assert.deepEqual(context, {
        groupId: "group-1",
        transitionId: "transition-1",
        assertExecutionContext: null,
        guard: null,
        isoDate,
        operationId: `downtime:transition-1:${slot.id}`
      });
      return { result: { progressGold: 5 }, projectId: "project-1", activityId: "craft", hours: 8 };
    };

    const first = await harness.service.processScheduledDate(isoDate, {
      transitionId: "transition-1",
      activityProcessor
    });
    const retry = await harness.service.processScheduledDate(isoDate, {
      transitionId: "transition-1",
      activityProcessor
    });
    await harness.service.processScheduledDate(isoDate, {
      transitionId: "transition-2",
      activityProcessor
    });

    let state = getDowntimeState(harness);
    assert.equal(first.processed.length, 1);
    assert.equal(retry.processed.length, 0);
    assert.equal(processorCalls, 1);
    assert.equal(state.balancesByActorId["actor-a"].reservedWorkdays, 4);
    assert.equal(state.balancesByActorId["actor-a"].spentWorkdays, 1);
    assert.equal(state.scheduleSlots[0].status, "processed");
    assert.equal(state.scheduleSlots[0].processedTransitionId, "transition-1");
    assert.equal(state.workLog.length, 1);

    await harness.service.setRequestStatus(request.id, "returned");
    state = getDowntimeState(harness);
    assert.equal(state.scheduleSlots[0].status, "processed");
    assert.equal(state.scheduleSlots.slice(1).every((slot) => slot.status === "free"), true);
    assert.equal(state.balancesByActorId["actor-a"].availableWorkdays, 4);
    assert.equal(state.balancesByActorId["actor-a"].reservedWorkdays, 0);
    assert.equal(state.balancesByActorId["actor-a"].spentWorkdays, 1);
  }
  finally {
    harness.restore();
  }
});

test("processScheduledDate records blocked slots idempotently without spending credits", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  let processorCalls = 0;

  try {
    await harness.service.grantWeeks({ actorIds: ["actor-a"], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: "actor-a", actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(request.id, "approved");
    const isoDate = getDowntimeState(harness).scheduleSlots[0].isoDate;
    const activityProcessor = async () => {
      processorCalls += 1;
      return { blocked: true, blockReason: "Missing materials" };
    };

    const first = await harness.service.processScheduledDate(isoDate, {
      transitionId: "transition-blocked",
      activityProcessor
    });
    const retry = await harness.service.processScheduledDate(isoDate, {
      transitionId: "transition-blocked",
      activityProcessor
    });

    const state = getDowntimeState(harness);
    assert.equal(first.blocked.length, 1);
    assert.equal(retry.blocked.length, 0);
    assert.equal(processorCalls, 1);
    assert.equal(state.scheduleSlots[0].status, "blocked");
    assert.equal(state.scheduleSlots[0].blockReason, "Missing materials");
    assert.equal(state.scheduleSlots[0].processedTransitionId, "transition-blocked");
    assert.equal(state.balancesByActorId["actor-a"].reservedWorkdays, 5);
    assert.equal(state.balancesByActorId["actor-a"].spentWorkdays, 0);
    assert.equal(state.workLog.length, 1);
    assert.equal(state.workLog[0].result.status, "blocked");
  }
  finally {
    harness.restore();
  }
});

test("processScheduledDate journals an empty slot snapshot and never discovers later approvals", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  let processorCalls = 0;

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
    const isoDate = getDowntimeState(harness).scheduleSlots[0].isoDate;
    const activityProcessor = async () => {
      processorCalls += 1;
      return { result: null };
    };

    await harness.service.processScheduledDate(isoDate, {
      transitionId: "transition-empty",
      activityProcessor
    });
    await harness.service.setRequestStatus(request.id, "approved");
    const retry = await harness.service.processScheduledDate(isoDate, {
      transitionId: "transition-empty",
      activityProcessor
    });

    const state = getDowntimeState(harness);
    const journal = state.transitionJournal.find((entry) => (
      entry.isoDate === isoDate && entry.transitionId === "transition-empty"
    ));
    assert.deepEqual(journal.slotIds, []);
    assert.equal(journal.status, "completed");
    assert.equal(processorCalls, 0);
    assert.deepEqual(retry.processed, []);
    assert.equal(state.scheduleSlots[0].status, "approved");
  }
  finally {
    harness.restore();
  }
});

test("processScheduledDate never invokes the processor for retained slots on released requests", async () => {
  for (const status of ["returned", "rejected", "cancelled"]) {
    const actor = createActor({ id: "actor-a", name: "Hero A" });
    const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
    const harness = createHarness({
      members: [actor],
      groupItems: [templateItem],
      calendarIsoDate: "2026-07-16",
      downtimeState: { version: 2 }
    });
    let processorCalls = 0;

    try {
      await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1, fromIsoDate: "2026-07-13" });
      const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
      await harness.service.setRequestStatus(request.id, "approved");
      await harness.service.setRequestStatus(request.id, status);

      const result = await harness.service.processScheduledDate("2026-07-16", {
        transitionId: `transition-released-${status}`,
        activityProcessor: async () => {
          processorCalls += 1;
          return { result: { progress: 1 } };
        }
      });

      const state = getDowntimeState(harness);
      assert.equal(processorCalls, 0, status);
      assert.equal(result.reconciliation.length, 1, status);
      assert.equal(result.journalStatus, "reconciliation-required", status);
      assert.equal(state.scheduleSlots.find((slot) => slot.isoDate === "2026-07-16").status, "approved", status);
      assert.equal(state.balancesByActorId[actor.id].reservedWorkdays, 4, status);
      assert.equal(state.balancesByActorId[actor.id].spentWorkdays, 0, status);
    }
    finally {
      harness.restore();
    }
  }
});

test("processScheduledDate preflights request existence and slot status before the processor", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const invalidStates = [{
    label: "missing request",
    requestId: "missing-request",
    requests: []
  }, {
    label: "pending request with approved slot",
    requestId: "downtime-1",
    requests: [{
      id: "downtime-1",
      actorId: actor.id,
      actionId: "craft",
      weeks: 1,
      workdays: 1,
      status: "pending"
    }]
  }];

  for (const invalidState of invalidStates) {
    const harness = createHarness({
      members: [actor],
      downtimeState: {
        version: 2,
        balancesByActorId: {
          [actor.id]: {
            availableWorkdays: 0,
            reservedWorkdays: 1,
            spentWorkdays: 0,
            totalGrantedWorkdays: 1
          }
        },
        requests: invalidState.requests,
        scheduleSlots: [{
          id: `slot-${invalidState.requestId}`,
          actorId: actor.id,
          isoDate: "2026-07-16",
          status: "approved",
          grantId: "grant-1",
          requestId: invalidState.requestId
        }]
      }
    });
    let processorCalls = 0;

    try {
      const result = await harness.service.processScheduledDate("2026-07-16", {
        transitionId: `transition-${invalidState.requestId}`,
        activityProcessor: async () => {
          processorCalls += 1;
          return { result: { progress: 1 } };
        }
      });

      assert.equal(processorCalls, 0, invalidState.label);
      assert.equal(result.reconciliation.length, 1, invalidState.label);
      assert.equal(result.journalStatus, "reconciliation-required", invalidState.label);
    }
    finally {
      harness.restore();
    }
  }
});

test("processScheduledDate preflights the actor reservation before the processor", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      version: 2,
      balancesByActorId: {
        [actor.id]: {
          availableWorkdays: 1,
          reservedWorkdays: 0,
          spentWorkdays: 0,
          totalGrantedWorkdays: 1
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: actor.id,
        actionId: "craft",
        weeks: 1,
        workdays: 1,
        status: "approved"
      }],
      scheduleSlots: [{
        id: "slot-unreserved",
        actorId: actor.id,
        isoDate: "2026-07-16",
        status: "approved",
        grantId: "grant-1",
        requestId: "downtime-1"
      }]
    }
  });
  let processorCalls = 0;

  try {
    const result = await harness.service.processScheduledDate("2026-07-16", {
      transitionId: "transition-unreserved",
      activityProcessor: async () => {
        processorCalls += 1;
        return { result: { progress: 1 } };
      }
    });

    assert.equal(processorCalls, 0);
    assert.equal(result.reconciliation.length, 1);
    assert.equal(result.journalStatus, "reconciliation-required");
    assert.equal(getDowntimeState(harness).balancesByActorId[actor.id].spentWorkdays, 0);
  }
  finally {
    harness.restore();
  }
});

test("processScheduledDate releases the mutation queue while the domain processor is running", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  const processorStarted = createDeferred();
  const releaseProcessor = createDeferred();
  let processorOperationId = "";

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(request.id, "approved");
    const slot = getDowntimeState(harness).scheduleSlots[0];
    const processing = harness.service.processScheduledDate(slot.isoDate, {
      transitionId: "transition-unlocked",
      activityProcessor: async (_slot, context) => {
        processorOperationId = context.operationId;
        processorStarted.resolve();
        await releaseProcessor.promise;
        return { result: { progress: 1 } };
      }
    });
    await processorStarted.promise;

    let grantSettled = false;
    const concurrentGrant = harness.service.grantWeeks({
      actorIds: [actor.id],
      weeks: 1,
      fromIsoDate: "2026-08-03"
    }).then(() => {
      grantSettled = true;
    });
    await flushTasks();
    const settledOutsideProcessor = grantSettled;
    releaseProcessor.resolve();
    await Promise.all([processing, concurrentGrant]);

    assert.equal(settledOutsideProcessor, true);
    assert.equal(processorOperationId, `downtime:transition-unlocked:${slot.id}`);
    assert.equal(getDowntimeState(harness).balancesByActorId[actor.id].spentWorkdays, 1);
  }
  finally {
    releaseProcessor.resolve();
    harness.restore();
  }
});

test("processScheduledDate freezes captured execution context and guards finalization after processor await", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  let authorityActive = true;
  const guard = () => {
    if (!authorityActive) {
      throw new Error("calendar execution context changed");
    }
  };

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(request.id, "approved");
    const slot = getDowntimeState(harness).scheduleSlots[0];

    await assert.rejects(
      harness.service.processScheduledDate(slot.isoDate, {
        transitionId: "transition-guarded-domain",
        groupId: "group-1",
        guard,
        assertExecutionContext: guard,
        activityProcessor: async (_slot, context) => {
          assert.equal(Object.isFrozen(context), true);
          assert.equal(context.groupId, "group-1");
          assert.equal(context.transitionId, "transition-guarded-domain");
          assert.equal(context.guard, guard);
          assert.equal(context.assertExecutionContext, guard);
          authorityActive = false;
          return { result: { progress: 1 } };
        }
      }),
      /calendar execution context changed/u
    );

    const state = getDowntimeState(harness);
    assert.equal(state.scheduleSlots[0].status, "approved");
    assert.equal(state.balancesByActorId[actor.id].reservedWorkdays, 5);
    assert.equal(state.balancesByActorId[actor.id].spentWorkdays, 0);
    assert.deepEqual(state.workLog, []);
  }
  finally {
    harness.restore();
  }
});

test("same transition failover never invokes an in-flight downtime processor twice", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  const processorStarted = createDeferred();
  const releaseProcessor = createDeferred();
  let processorCalls = 0;
  let oldRun = null;
  let oldOutcome = null;
  const guardForUser = (userId) => () => {
    if (globalThis.game?.user?.id !== userId) {
      throw new Error("calendar execution context changed");
    }
  };

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(request.id, "approved");
    const slot = getDowntimeState(harness).scheduleSlots[0];
    const oldGuard = guardForUser("gm-old");
    globalThis.game.user = { id: "gm-old", isGM: true };

    oldRun = harness.service.processScheduledDate(slot.isoDate, {
      transitionId: "transition-failover-in-flight",
      groupId: "group-1",
      guard: oldGuard,
      assertExecutionContext: oldGuard,
      activityProcessor: async (_slot, context) => {
        processorCalls += 1;
        assert.equal(context.operationId, `downtime:transition-failover-in-flight:${slot.id}`);
        processorStarted.resolve();
        await releaseProcessor.promise;
        return { result: { progress: 1 } };
      }
    });
    oldOutcome = oldRun.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason })
    );
    await processorStarted.promise;

    globalThis.game.user = { id: "gm-new", isGM: true };
    const newGuard = guardForUser("gm-new");
    const newRun = await harness.service.processScheduledDate(slot.isoDate, {
      transitionId: "transition-failover-in-flight",
      groupId: "group-1",
      guard: newGuard,
      assertExecutionContext: newGuard,
      activityProcessor: async () => {
        processorCalls += 1;
        return { result: { progress: 2 } };
      }
    });

    assert.equal(processorCalls, 1);
    assert.equal(newRun.journalStatus, "reconciliation-required");
    assert.equal(newRun.reconciliation.length, 1);
    assert.equal(
      newRun.reconciliation[0].operationId,
      `downtime:transition-failover-in-flight:${slot.id}`
    );

    const stillInFlight = await harness.service.processScheduledDate(slot.isoDate, {
      transitionId: "transition-failover-in-flight",
      groupId: "group-1",
      guard: newGuard,
      assertExecutionContext: newGuard,
      activityProcessor: async () => {
        processorCalls += 1;
        return { result: { progress: 3 } };
      }
    });
    assert.equal(processorCalls, 1);
    assert.equal(stillInFlight.journalStatus, "reconciliation-required");
    assert.equal(stillInFlight.reconciliation.length, 1);

    releaseProcessor.resolve();
    const interrupted = await oldOutcome;
    assert.equal(interrupted.status, "rejected");
    assert.match(interrupted.reason.message, /calendar execution context changed/u);

    const state = getDowntimeState(harness);
    assert.equal(state.scheduleSlots[0].status, "approved");
    assert.equal(state.balancesByActorId[actor.id].spentWorkdays, 0);
    assert.equal(state.transitionJournal[0].status, "reconciliation-required");

    const resumed = await harness.service.processScheduledDate(slot.isoDate, {
      transitionId: "transition-failover-in-flight",
      groupId: "group-1",
      guard: newGuard,
      assertExecutionContext: newGuard,
      activityProcessor: async (_slot, context) => {
        processorCalls += 1;
        assert.equal(context.operationId, `downtime:transition-failover-in-flight:${slot.id}`);
        return { result: { progress: 2 } };
      }
    });

    assert.equal(processorCalls, 2);
    assert.equal(resumed.journalStatus, "completed");
    assert.equal(resumed.processed.length, 1);
    assert.equal(getDowntimeState(harness).balancesByActorId[actor.id].spentWorkdays, 1);
  }
  finally {
    releaseProcessor.resolve();
    await Promise.allSettled([oldRun, oldOutcome].filter(Boolean));
    harness.restore();
  }
});

test("same transition reclaims an expired processor lease after the owning GM disappears", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  const transitionId = "transition-expired-lease";
  let processorCalls = 0;

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(request.id, "approved");
    const slot = getDowntimeState(harness).scheduleSlots[0];
    const expiredAt = Date.now() - 1;

    await harness.mutateDowntimeState((state) => {
      const claimedSlot = state.scheduleSlots.find((entry) => entry.id === slot.id);
      claimedSlot.processingTransitionId = transitionId;
      state.transitionJournal.push({
        transitionId,
        isoDate: slot.isoDate,
        slotIds: [slot.id],
        status: "processing",
        resultsBySlotId: {
          [slot.id]: {
            status: "processing",
            operationId: `downtime:${transitionId}:${slot.id}`,
            claimedActorId: actor.id,
            claimedRequestId: request.id,
            claimedStatus: "approved",
            processorLeaseId: "old-lease",
            processorOwnerUserId: "gm-old",
            processorLeaseExpiresAt: expiredAt,
            updatedAt: expiredAt - 30_000
          }
        },
        createdAt: expiredAt - 30_000,
        updatedAt: expiredAt - 30_000
      });
    });
    globalThis.game.user = { id: "gm-new", isGM: true };

    const result = await harness.service.processScheduledDate(slot.isoDate, {
      transitionId,
      groupId: "group-1",
      activityProcessor: async (_slot, context) => {
        processorCalls += 1;
        assert.equal(context.operationId, `downtime:${transitionId}:${slot.id}`);
        return { result: { progress: 1 } };
      }
    });

    assert.equal(processorCalls, 1);
    assert.equal(result.journalStatus, "completed");
    assert.equal(result.processed.length, 1);
    const state = getDowntimeState(harness);
    assert.equal(state.scheduleSlots[0].status, "processed");
    assert.equal(state.balancesByActorId[actor.id].spentWorkdays, 1);
    assert.equal(state.transitionJournal[0].resultsBySlotId[slot.id].processorOwnerUserId, "gm-new");
  }
  finally {
    harness.restore();
  }
});

test("processScheduledDate guards the final journal write after preparation commits", async () => {
  const harness = createHarness({ downtimeState: { version: 2 } });
  let authorityActive = true;
  const guard = () => {
    if (!authorityActive) {
      throw new Error("calendar execution context changed");
    }
  };
  const mutateGroupState = harness.groupContextService.mutateGroupState.bind(harness.groupContextService);
  let writes = 0;
  harness.groupContextService.mutateGroupState = async (...args) => {
    const result = await mutateGroupState(...args);
    writes += 1;
    if (writes === 1) {
      authorityActive = false;
    }
    return result;
  };

  try {
    await assert.rejects(
      harness.service.processScheduledDate("2026-07-16", {
        transitionId: "transition-guarded-empty",
        groupId: "group-1",
        guard,
        assertExecutionContext: guard
      }),
      /calendar execution context changed/u
    );

    const journal = getDowntimeState(harness).transitionJournal
      .find((entry) => entry.transitionId === "transition-guarded-empty");
    assert.equal(writes, 1);
    assert.equal(journal.status, "processing");
  }
  finally {
    harness.restore();
  }
});

test("concurrent transitions claim a scheduled slot before invoking a delayed processor", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  const firstProcessorStarted = createDeferred();
  const releaseFirstProcessor = createDeferred();
  let processorCalls = 0;

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(request.id, "approved");
    const slot = getDowntimeState(harness).scheduleSlots[0];

    const firstTransition = harness.service.processScheduledDate(slot.isoDate, {
      transitionId: "transition-claim-a",
      activityProcessor: async () => {
        processorCalls += 1;
        firstProcessorStarted.resolve();
        await releaseFirstProcessor.promise;
        return { result: { progress: 1 } };
      }
    });
    await firstProcessorStarted.promise;

    const secondTransition = await harness.service.processScheduledDate(slot.isoDate, {
      transitionId: "transition-claim-b",
      activityProcessor: async () => {
        processorCalls += 1;
        return { result: { progress: 2 } };
      }
    });
    releaseFirstProcessor.resolve();
    const firstResult = await firstTransition;

    const state = getDowntimeState(harness);
    assert.equal(processorCalls, 1);
    assert.equal(firstResult.processed.length, 1);
    assert.deepEqual(secondTransition.processed, []);
    assert.equal(state.scheduleSlots[0].status, "processed");
    assert.equal(state.scheduleSlots[0].processedTransitionId, "transition-claim-a");
    assert.equal(state.balancesByActorId[actor.id].spentWorkdays, 1);
  }
  finally {
    releaseFirstProcessor.resolve();
    harness.restore();
  }
});

test("request status mutation fails busy while a claimed slot processor is delayed", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  const processorStarted = createDeferred();
  const releaseProcessor = createDeferred();

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(request.id, "approved");
    const slot = getDowntimeState(harness).scheduleSlots[0];
    const processing = harness.service.processScheduledDate(slot.isoDate, {
      transitionId: "transition-busy",
      activityProcessor: async () => {
        processorStarted.resolve();
        await releaseProcessor.promise;
        return { result: { progress: 1 } };
      }
    });
    await processorStarted.promise;

    await assert.rejects(
      harness.service.setRequestStatus(request.id, "returned"),
      /busy.*retry/iu
    );
    let state = getDowntimeState(harness);
    assert.equal(state.requests[0].status, "approved");
    assert.equal(state.balancesByActorId[actor.id].reservedWorkdays, 5);

    releaseProcessor.resolve();
    await processing;
    state = getDowntimeState(harness);
    assert.equal(state.scheduleSlots[0].status, "processed");
    assert.equal(state.balancesByActorId[actor.id].reservedWorkdays, 4);
    assert.equal(state.balancesByActorId[actor.id].spentWorkdays, 1);
  }
  finally {
    releaseProcessor.resolve();
    harness.restore();
  }
});

test("same-status approval fails busy without mutation while a slot processor is delayed", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  const processorStarted = createDeferred();
  const releaseProcessor = createDeferred();

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(request.id, "approved", { result: "Original" });
    const slot = getDowntimeState(harness).scheduleSlots[0];
    const processing = harness.service.processScheduledDate(slot.isoDate, {
      transitionId: "transition-same-status-busy",
      activityProcessor: async () => {
        processorStarted.resolve();
        await releaseProcessor.promise;
        return { result: { progress: 1 } };
      }
    });
    await processorStarted.promise;
    const stateBeforeMutation = clone(getDowntimeState(harness));

    await assert.rejects(
      harness.service.setRequestStatus(request.id, "approved", { result: "Mutated" }),
      /busy.*retry/iu
    );
    assert.deepEqual(getDowntimeState(harness), stateBeforeMutation);

    releaseProcessor.resolve();
    await processing;
  }
  finally {
    releaseProcessor.resolve();
    harness.restore();
  }
});

test("setRequestStatus prioritizes a nonterminal slot claim over request status validation", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      version: 2,
      balancesByActorId: {
        [actor.id]: {
          availableWorkdays: 0,
          reservedWorkdays: 1,
          spentWorkdays: 0,
          totalGrantedWorkdays: 1
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: actor.id,
        actionId: "craft",
        weeks: 1,
        workdays: 1,
        status: "completed"
      }],
      scheduleSlots: [{
        id: "slot-claimed",
        actorId: actor.id,
        isoDate: "2026-07-16",
        status: "blocked",
        grantId: "grant-1",
        requestId: "downtime-1",
        processingTransitionId: "transition-completed-busy"
      }],
      transitionJournal: [{
        transitionId: "transition-completed-busy",
        isoDate: "2026-07-16",
        slotIds: ["slot-claimed"],
        status: "processing",
        resultsBySlotId: {
          "slot-claimed": {
            status: "processing",
            claimedActorId: actor.id,
            claimedRequestId: "downtime-1",
            claimedStatus: "blocked"
          }
        },
        createdAt: 1,
        updatedAt: 1
      }]
    }
  });

  try {
    const stateBeforeMutation = clone(getDowntimeState(harness));
    await assert.rejects(
      harness.service.setRequestStatus("downtime-1", "returned"),
      /busy.*retry/iu
    );
    assert.deepEqual(getDowntimeState(harness), stateBeforeMutation);
  }
  finally {
    harness.restore();
  }
});

test("updateRequest fails busy without mutation for a claimed blocked slot", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
    const slot = getDowntimeState(harness).scheduleSlots[0];
    await harness.mutateDowntimeState((state) => {
      const claimedSlot = state.scheduleSlots.find((entry) => entry.id === slot.id);
      claimedSlot.status = "blocked";
      claimedSlot.processingTransitionId = "transition-blocked-busy";
      state.transitionJournal.push({
        transitionId: "transition-blocked-busy",
        isoDate: slot.isoDate,
        slotIds: [slot.id],
        status: "processing",
        resultsBySlotId: {
          [slot.id]: {
            status: "processing",
            claimedActorId: actor.id,
            claimedRequestId: request.id,
            claimedStatus: "blocked"
          }
        },
        createdAt: 1,
        updatedAt: 1
      });
    });
    const stateBeforeMutation = clone(getDowntimeState(harness));

    await assert.rejects(
      harness.service.updateRequest({
        requestId: request.id,
        actorId: actor.id,
        actionId: templateItem.uuid,
        title: "Mutated",
        weeks: 1
      }),
      /busy.*retry/iu
    );
    assert.deepEqual(getDowntimeState(harness), stateBeforeMutation);
  }
  finally {
    harness.restore();
  }
});

test("blocked finalization never changes a concurrently processed slot back to blocked", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
  const processorStarted = createDeferred();
  const releaseProcessor = createDeferred();

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
    const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(request.id, "approved");
    const slot = getDowntimeState(harness).scheduleSlots[0];
    const processing = harness.service.processScheduledDate(slot.isoDate, {
      transitionId: "transition-stale-blocked",
      activityProcessor: async () => {
        processorStarted.resolve();
        await releaseProcessor.promise;
        return { blocked: true, blockReason: "late blocked result" };
      }
    });
    await processorStarted.promise;

    await harness.mutateDowntimeState((state) => {
      const currentSlot = state.scheduleSlots.find((entry) => entry.id === slot.id);
      currentSlot.status = "processed";
      currentSlot.processedTransitionId = "transition-winner";
      state.balancesByActorId[actor.id].reservedWorkdays -= 1;
      state.balancesByActorId[actor.id].spentWorkdays += 1;
    });
    releaseProcessor.resolve();
    const result = await processing;

    const state = getDowntimeState(harness);
    const journal = state.transitionJournal.find((entry) => entry.transitionId === "transition-stale-blocked");
    assert.equal(result.reconciliation.length, 1);
    assert.equal(journal.status, "reconciliation-required");
    assert.equal(state.scheduleSlots[0].status, "processed");
    assert.equal(state.scheduleSlots[0].processedTransitionId, "transition-winner");
    assert.equal(state.balancesByActorId[actor.id].reservedWorkdays, 4);
    assert.equal(state.balancesByActorId[actor.id].spentWorkdays, 1);
  }
  finally {
    releaseProcessor.resolve();
    harness.restore();
  }
});

test("processed finalization does not debit a reassigned request reservation", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });
  const actorB = createActor({ id: "actor-b", name: "Hero B" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: [actorA, actorB], groupItems: [templateItem], downtimeState: { version: 2 } });
  const processorStarted = createDeferred();
  const releaseProcessor = createDeferred();

  try {
    await harness.service.grantWeeks({ actorIds: [actorA.id], weeks: 1 });
    await harness.service.grantWeeks({ actorIds: [actorB.id], weeks: 1, fromIsoDate: "2026-08-03" });
    const requestA = await harness.service.createRequest({ actorId: actorA.id, actionId: templateItem.uuid, weeks: 1 });
    const requestB = await harness.service.createRequest({ actorId: actorB.id, actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(requestA.id, "approved");
    await harness.service.setRequestStatus(requestB.id, "approved");
    const slot = getDowntimeState(harness).scheduleSlots.find((entry) => entry.requestId === requestA.id);
    const processing = harness.service.processScheduledDate(slot.isoDate, {
      transitionId: "transition-request-safety",
      activityProcessor: async () => {
        processorStarted.resolve();
        await releaseProcessor.promise;
        return { result: { progress: 1 } };
      }
    });
    await processorStarted.promise;

    await harness.mutateDowntimeState((state) => {
      const currentSlot = state.scheduleSlots.find((entry) => entry.id === slot.id);
      currentSlot.actorId = actorB.id;
      currentSlot.requestId = requestB.id;
    });
    releaseProcessor.resolve();
    const result = await processing;

    const state = getDowntimeState(harness);
    const journal = state.transitionJournal.find((entry) => entry.transitionId === "transition-request-safety");
    assert.equal(result.reconciliation.length, 1);
    assert.equal(journal.status, "reconciliation-required");
    assert.equal(state.scheduleSlots.find((entry) => entry.id === slot.id).status, "approved");
    assert.equal(state.balancesByActorId[actorA.id].reservedWorkdays, 5);
    assert.equal(state.balancesByActorId[actorA.id].spentWorkdays, 0);
    assert.equal(state.balancesByActorId[actorB.id].reservedWorkdays, 5);
    assert.equal(state.balancesByActorId[actorB.id].spentWorkdays, 0);
  }
  finally {
    releaseProcessor.resolve();
    harness.restore();
  }
});

test("processScheduledDate keeps exceptions ambiguous outcomes and blocked receipts in reconciliation", async () => {
  const actors = ["actor-a", "actor-b", "actor-c"].map((id) => createActor({ id, name: id }));
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({ members: actors, groupItems: [templateItem], downtimeState: { version: 2 } });

  try {
    await harness.service.grantWeeks({ actorIds: actors.map((actor) => actor.id), weeks: 1 });
    for (const actor of actors) {
      const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
      await harness.service.setRequestStatus(request.id, "approved");
    }
    const isoDate = getDowntimeState(harness).scheduleSlots[0].isoDate;
    const operationIds = new Map();
    const first = await harness.service.processScheduledDate(isoDate, {
      transitionId: "transition-reconcile",
      activityProcessor: async (slot, context) => {
        operationIds.set(slot.id, context.operationId);
        if (slot.actorId === "actor-a") {
          throw new Error("processor crashed");
        }
        if (slot.actorId === "actor-b") {
          return {};
        }
        return {
          blocked: true,
          blockReason: "reported blocked after spend",
          result: {
            resourceReceipt: { materialSpent: 1 }
          }
        };
      }
    });

    let state = getDowntimeState(harness);
    let journal = state.transitionJournal.find((entry) => entry.transitionId === "transition-reconcile");
    assert.equal(first.reconciliation.length, 3);
    assert.equal(first.blocked.length, 0);
    assert.equal(journal.status, "reconciliation-required");
    assert.deepEqual(new Set(Object.values(journal.resultsBySlotId).map((result) => result.status)), new Set([
      "reconciliation-required"
    ]));
    assert.equal(state.scheduleSlots.filter((slot) => slot.isoDate === isoDate && slot.status === "approved").length, 3);
    assert.equal(Object.values(state.balancesByActorId).every((balance) => balance.spentWorkdays === 0), true);

    const retry = await harness.service.processScheduledDate(isoDate, {
      transitionId: "transition-reconcile",
      activityProcessor: async (slot, context) => {
        assert.equal(context.operationId, operationIds.get(slot.id));
        return { blocked: true, blockReason: "Missing materials" };
      }
    });
    state = getDowntimeState(harness);
    journal = state.transitionJournal.find((entry) => entry.transitionId === "transition-reconcile");
    assert.equal(retry.blocked.length, 3);
    assert.equal(journal.status, "completed");
    assert.equal(state.scheduleSlots.filter((slot) => slot.status === "blocked").length, 3);
    assert.equal(Object.values(state.balancesByActorId).every((balance) => balance.spentWorkdays === 0), true);
  }
  finally {
    harness.restore();
  }
});

test("processScheduledDate reconciles retries across final persistence failures with one stable operation ID", async () => {
  for (const afterCommit of [false, true]) {
    const actor = createActor({ id: "actor-a", name: "Hero A" });
    const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
    const harness = createHarness({ members: [actor], groupItems: [templateItem], downtimeState: { version: 2 } });
    const operationIds = [];

    try {
      await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 });
      const request = await harness.service.createRequest({ actorId: actor.id, actionId: templateItem.uuid, weeks: 1 });
      await harness.service.setRequestStatus(request.id, "approved");
      const slot = getDowntimeState(harness).scheduleSlots[0];
      let processorCalls = 0;
      const activityProcessor = async (_slot, context) => {
        processorCalls += 1;
        operationIds.push(context.operationId);
        if (processorCalls === 1) {
          harness.failNextMutationCommit({ afterCommit, error: new Error("finalize persist failed") });
        }
        return { result: { receipt: "durable-domain-result" } };
      };

      await assert.rejects(
        harness.service.processScheduledDate(slot.isoDate, {
          transitionId: "transition-persist",
          activityProcessor
        }),
        /finalize persist failed/u,
        afterCommit ? "lost ack" : "before store"
      );
      await harness.service.processScheduledDate(slot.isoDate, {
        transitionId: "transition-persist",
        activityProcessor
      });

      const state = getDowntimeState(harness);
      assert.equal(new Set(operationIds).size, 1, afterCommit ? "lost ack" : "before store");
      assert.equal(operationIds[0], `downtime:transition-persist:${slot.id}`);
      assert.equal(processorCalls, afterCommit ? 1 : 2);
      assert.equal(state.balancesByActorId[actor.id].spentWorkdays, 1);
      assert.equal(state.workLog.length, 1);
    }
    finally {
      harness.restore();
    }
  }
});

test("reopening reserves only the unprocessed request remainder", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      version: 2,
      balancesByActorId: {
        "actor-a": {
          availableWorkdays: 3,
          reservedWorkdays: 1,
          spentWorkdays: 1,
          totalGrantedWorkdays: 5
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actionId: "training",
        weeks: 1,
        workdays: 5,
        status: "returned"
      }],
      scheduleSlots: [
        { id: "slot-processed", actorId: "actor-a", isoDate: "2026-07-20", status: "processed", grantId: "grant-1", requestId: "downtime-1" },
        { id: "slot-reserved", actorId: "actor-a", isoDate: "2026-07-21", status: "pending", grantId: "grant-1", requestId: "downtime-1" },
        { id: "slot-free-1", actorId: "actor-a", isoDate: "2026-07-22", status: "free", grantId: "grant-1" },
        { id: "slot-free-2", actorId: "actor-a", isoDate: "2026-07-23", status: "free", grantId: "grant-1" },
        { id: "slot-free-3", actorId: "actor-a", isoDate: "2026-07-24", status: "free", grantId: "grant-1" }
      ]
    }
  });

  try {
    await harness.service.setRequestStatus("downtime-1", "pending");
    const state = getDowntimeState(harness);
    assert.equal(state.scheduleSlots.filter((slot) => slot.requestId === "downtime-1").length, 5);
    assert.equal(state.balancesByActorId[actor.id].availableWorkdays, 0);
    assert.equal(state.balancesByActorId[actor.id].reservedWorkdays, 4);
    assert.equal(state.balancesByActorId[actor.id].spentWorkdays, 1);
  }
  finally {
    harness.restore();
  }
});

test("reopening counts retained unprocessed slots on past and current dates", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    calendarIsoDate: "2026-07-16",
    downtimeState: {
      version: 2,
      balancesByActorId: {
        "actor-a": {
          availableWorkdays: 2,
          reservedWorkdays: 2,
          spentWorkdays: 1,
          totalGrantedWorkdays: 5
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actionId: "training",
        weeks: 1,
        workdays: 5,
        status: "returned"
      }],
      scheduleSlots: [
        { id: "slot-processed", actorId: "actor-a", isoDate: "2026-07-14", status: "processed", grantId: "grant-1", requestId: "downtime-1" },
        { id: "slot-past", actorId: "actor-a", isoDate: "2026-07-15", status: "pending", grantId: "grant-1", requestId: "downtime-1" },
        { id: "slot-current", actorId: "actor-a", isoDate: "2026-07-16", status: "pending", grantId: "grant-1", requestId: "downtime-1" },
        { id: "slot-free-1", actorId: "actor-a", isoDate: "2026-07-17", status: "free", grantId: "grant-1" },
        { id: "slot-free-2", actorId: "actor-a", isoDate: "2026-07-20", status: "free", grantId: "grant-1" }
      ]
    }
  });

  try {
    await harness.service.setRequestStatus("downtime-1", "pending");
    const state = getDowntimeState(harness);
    assert.equal(state.scheduleSlots.filter((slot) => slot.requestId === "downtime-1").length, 5);
    assert.equal(state.balancesByActorId[actor.id].availableWorkdays, 0);
    assert.equal(state.balancesByActorId[actor.id].reservedWorkdays, 4);
    assert.equal(state.balancesByActorId[actor.id].spentWorkdays, 1);
  }
  finally {
    harness.restore();
  }
});

test("migration detects actor balance versions independently and completes partial deterministic schedules", async () => {
  const actors = [
    createActor({ id: "actor-v2", name: "V2 Hero" }),
    createActor({ id: "actor-v1", name: "V1 Hero" })
  ];
  const harness = createHarness({
    members: actors,
    downtimeState: {
      version: 2,
      balancesByActorId: {
        "actor-v2": {
          availableWorkdays: 2,
          reservedWorkdays: 0,
          spentWorkdays: 0,
          totalGrantedWorkdays: 2
        },
        "actor-v1": {
          availableWeeks: 1,
          reservedWeeks: 1,
          spentWeeks: 1,
          totalGrantedWeeks: 3
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "actor-v1",
        actionId: "training",
        weeks: 1,
        status: "approved"
      }],
      scheduleSlots: [{
        id: "legacy-slot-kept",
        actorId: "actor-v1",
        isoDate: "2026-07-20",
        status: "approved",
        grantId: "legacy-grant",
        requestId: "downtime-1",
        customSlotField: "kept"
      }]
    }
  });

  try {
    const snapshot = harness.service.getSnapshot({ actorId: "actor-v1" });
    assert.equal(snapshot.balancesByActorId["actor-v2"].availableWorkdays, 2);
    assert.deepEqual({
      available: snapshot.balancesByActorId["actor-v1"].availableWorkdays,
      reserved: snapshot.balancesByActorId["actor-v1"].reservedWorkdays,
      spent: snapshot.balancesByActorId["actor-v1"].spentWorkdays,
      total: snapshot.balancesByActorId["actor-v1"].totalGrantedWorkdays
    }, { available: 5, reserved: 5, spent: 5, total: 15 });
    assert.equal(snapshot.scheduleSlots.find((slot) => slot.id === "legacy-slot-kept").customSlotField, "kept");
    assert.equal(snapshot.scheduleSlots.filter((slot) => slot.actorId === "actor-v1").length, 10);
    assert.equal(snapshot.scheduleSlots.filter((slot) => slot.requestId === "downtime-1").length, 5);
    assert.equal(snapshot.scheduleSlots.filter((slot) => slot.actorId === "actor-v1" && slot.status === "free").length, 5);
    assert.equal(snapshot.grants.find((grant) => grant.id === "downtime-migration-actor-v1").anchorMonday, "2026-07-27");
  }
  finally {
    harness.restore();
  }
});

test("grant anchorMonday follows the first generated slot after occupied-week skipping", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      version: 2,
      scheduleSlots: [{
        id: "occupied-slot",
        actorId: actor.id,
        isoDate: "2026-07-22",
        status: "processed",
        grantId: "old-grant"
      }]
    }
  });

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1, fromIsoDate: "2026-07-20" });
    const grant = getDowntimeState(harness).grants.find((entry) => entry.id !== "old-grant");
    assert.equal(grant.anchorMonday, "2026-07-27");
  }
  finally {
    harness.restore();
  }
});

test("downtime writes require mutateGroupState and never use the stale registry fallback", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({ members: [actor], downtimeState: { version: 2 }, queuedMutations: false });

  try {
    await assert.rejects(
      harness.service.grantWeeks({ actorIds: [actor.id], weeks: 1 }),
      /mutateGroupState/u
    );
    assert.equal(harness.setRegistryCalls, 0);
  }
  finally {
    harness.restore();
  }
});

test("getSnapshot uses native group members and excludes stale balance keys from current members", () => {
  const nativeMember = createActor({ id: "actor-a", name: "Native Member" });
  const staleMember = createActor({ id: "stale-actor", name: "Stale Member" });
  const harness = createHarness({
    members: [nativeMember],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 2,
          reservedWeeks: 1,
          spentWeeks: 0,
          totalGrantedWeeks: 3
        },
        "stale-actor": {
          availableWeeks: 99,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 99
        }
      }
    }
  });

  try {
    const snapshot = harness.service.getSnapshot();

    assert.deepEqual(snapshot.members.map((member) => member.actorId), ["actor-a"]);
    assert.equal(snapshot.members.some((member) => member.actorId === staleMember.id), false);
    assert.equal(snapshot.members[0].balance.availableWeeks, 2);
    assert.equal(snapshot.canManage, true);
  }
  finally {
    harness.restore();
  }
});

test("grantWeeks as GM grants all current native members by default", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });
  const actorB = createActor({ id: "actor-b", name: "Hero B" });
  const harness = createHarness({
    members: [actorA, actorB],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        },
        "stale-actor": {
          availableWeeks: 5,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 5
        }
      }
    }
  });

  try {
    const result = await harness.service.grantWeeks({ weeks: 2, reason: "chapter" });
    const balances = getDowntimeState(harness).balancesByActorId;

    assert.deepEqual(result.actorIds, ["actor-a", "actor-b"]);
    assert.equal(balances["actor-a"].availableWorkdays, 15);
    assert.equal(balances["actor-a"].totalGrantedWorkdays, 15);
    assert.equal(balances["actor-b"].availableWorkdays, 10);
    assert.equal(balances["actor-b"].totalGrantedWorkdays, 10);
    assert.equal(balances["stale-actor"].availableWorkdays, 25);
    assert.equal(harness.mutateGroupStateCalls, 1);
    assert.equal(harness.setRegistryCalls, 0);
  }
  finally {
    harness.restore();
  }
});

test("revokeWeeks as GM removes only available weeks from current members", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });
  const actorB = createActor({ id: "actor-b", name: "Hero B" });
  const harness = createHarness({
    members: [actorA, actorB],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 3,
          reservedWeeks: 1,
          spentWeeks: 2,
          totalGrantedWeeks: 6
        },
        "actor-b": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }
    }
  });

  try {
    const result = await harness.service.revokeWeeks({ actorIds: ["actor-a"], weeks: 2, reason: "test cleanup" });
    const balances = getDowntimeState(harness).balancesByActorId;

    assert.deepEqual(result.actorIds, ["actor-a"]);
    assert.equal(balances["actor-a"].availableWorkdays, 5);
    assert.equal(balances["actor-a"].reservedWorkdays, 5);
    assert.equal(balances["actor-a"].spentWorkdays, 10);
    assert.equal(balances["actor-a"].totalGrantedWorkdays, 20);
    assert.equal(balances["actor-b"].availableWorkdays, 5);
    assert.equal(balances["actor-b"].totalGrantedWorkdays, 5);
    assert.equal(getDowntimeState(harness).history.find((entry) => entry.type === "revoke")?.type, "revoke");

    await assert.rejects(
      () => harness.service.revokeWeeks({ actorIds: ["actor-b"], weeks: 2 }),
      /Not enough available downtime weeks/u
    );
  }
  finally {
    harness.restore();
  }
});

test("revokeWeeks for all current members skips members without available weeks", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });
  const actorB = createActor({ id: "actor-b", name: "Hero B" });
  const actorC = createActor({ id: "actor-c", name: "Hero C" });
  const harness = createHarness({
    members: [actorA, actorB, actorC],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 0,
          reservedWeeks: 0,
          spentWeeks: 1,
          totalGrantedWeeks: 1
        },
        "actor-b": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        },
        "actor-c": {
          availableWeeks: 3,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 3
        }
      }
    }
  });

  try {
    const result = await harness.service.revokeWeeks({ weeks: 2, reason: "cleanup" });
    const state = getDowntimeState(harness);
    const balances = state.balancesByActorId;

    assert.deepEqual(result.actorIds, ["actor-b", "actor-c"]);
    assert.deepEqual(result.skippedActorIds, ["actor-a"]);
    assert.equal(result.totalRevokedWeeks, 3);
    assert.equal(balances["actor-a"].availableWorkdays, 0);
    assert.equal(balances["actor-a"].totalGrantedWorkdays, 5);
    assert.equal(balances["actor-b"].availableWorkdays, 0);
    assert.equal(balances["actor-b"].totalGrantedWorkdays, 0);
    assert.equal(balances["actor-c"].availableWorkdays, 5);
    assert.equal(balances["actor-c"].totalGrantedWorkdays, 5);
    const revokeHistory = state.history.find((entry) => entry.type === "revoke");
    assert.deepEqual(revokeHistory.actorIds, ["actor-b", "actor-c"]);
    assert.deepEqual(revokeHistory.skippedActorIds, ["actor-a"]);
    assert.equal(revokeHistory.totalRevokedWeeks, 3);
  }
  finally {
    harness.restore();
  }
});

test("createRequest by player reserves weeks for an owned current member", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A", ownerUserId: "player-1" });
  const actorB = createActor({ id: "actor-b", name: "Hero B", ownerUserId: "player-2" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-training",
    name: "Training"
  });
  const harness = createHarness({
    user: { id: "player-1", isGM: false },
    members: [actorA, actorB],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 3,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 3
        }
      },
      counter: 0
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: "actor-a",
      actionId: templateItem.uuid,
      title: "Train",
      description: "Practice",
      weeks: 2
    });
    const state = getDowntimeState(harness);

    assert.equal(request.id, "downtime-1");
    assert.equal(request.actorId, "actor-a");
    assert.equal(request.actionId, templateItem.uuid);
    assert.equal(request.status, "pending");
    assert.equal(request.submittedByUserId, "player-1");
    assert.equal(state.balancesByActorId["actor-a"].availableWorkdays, 5);
    assert.equal(state.balancesByActorId["actor-a"].reservedWorkdays, 10);
  }
  finally {
    harness.restore();
  }
});

test("updateRequest edits a pending request without duplicating or losing week accounting", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A", ownerUserId: "player-1" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-project",
    name: "Project",
    config: {
      targetActions: [{
        id: "project-rank",
        label: "Project rank",
        actionType: "rankChoice",
        rankChoice: {
          min: 1,
          max: 9
        }
      }, {
        id: "project-check",
        label: "Project check",
        actionType: "check",
        configurable: true,
        sourceType: "skill",
        ability: "int",
        target: "arc",
        targetLabel: "Arcana",
        dc: 12
      }]
    }
  });
  const harness = createHarness({
    user: { id: "player-1", isGM: false },
    members: [actorA],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 3,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 3
        }
      },
      counter: 0
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: "actor-a",
      actionId: templateItem.uuid,
      title: "Old project",
      weeks: 2,
      targetActionSelections: [{
        actionId: "project-rank",
        value: 2
      }]
    });

    const updated = await harness.service.updateRequest({
      requestId: request.id,
      actorId: "actor-a",
      actionId: templateItem.uuid,
      title: "Edited project",
      weeks: 1,
      targetActionSelections: [{
        actionId: "project-rank",
        value: 5
      }, {
        actionId: "project-check",
        sourceType: "skill",
        ability: "wis",
        target: "prc",
        targetLabel: "Perception",
        dc: 18
      }]
    });

    const state = getDowntimeState(harness);
    assert.equal(state.requests.length, 1);
    assert.equal(updated.id, request.id);
    assert.equal(updated.title, "Edited project");
    assert.equal(updated.weeks, 1);
    assert.equal(updated.checks.find((check) => check.id === "project-rank").selectedRank, 5);
    assert.equal(updated.checks.find((check) => check.id === "project-check").target, "prc");
    assert.equal(updated.checks.find((check) => check.id === "project-check").dc, 18);
    assert.equal(state.balancesByActorId["actor-a"].availableWorkdays, 10);
    assert.equal(state.balancesByActorId["actor-a"].reservedWorkdays, 5);

    await harness.service.recordCheckResult(request.id, "project-check", {
      total: 20
    });
    await assert.rejects(
      () => harness.service.updateRequest({
        requestId: request.id,
        actorId: "actor-a",
        actionId: templateItem.uuid,
        weeks: 1
      }),
      /already has recorded results/u
    );
  }
  finally {
    harness.restore();
  }
});

test("updateRequest rejects shrinking below retained past and current slots without mutation", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({
    members: [actor],
    groupItems: [templateItem],
    calendarIsoDate: "2026-07-16",
    downtimeState: { version: 2 }
  });

  try {
    await harness.service.grantWeeks({ actorIds: [actor.id], weeks: 2, fromIsoDate: "2026-07-06" });
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      title: "Two weeks",
      weeks: 2
    });
    const stateBeforeMutation = clone(getDowntimeState(harness));

    await assert.rejects(
      harness.service.updateRequest({
        requestId: request.id,
        actorId: actor.id,
        actionId: templateItem.uuid,
        title: "One week",
        weeks: 1
      }),
      /retained.*past.*current/iu
    );

    assert.deepEqual(getDowntimeState(harness), stateBeforeMutation);
  }
  finally {
    harness.restore();
  }
});

test("createRequest can target an explicit group and preserve player submitter on GM client", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A", ownerUserId: "player-1" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-freeform",
    name: "Freeform downtime"
  });
  const harness = createHarness({
    user: { id: "gm", isGM: true },
    members: [actorA],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 2,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 2
        }
      },
      counter: 0
    }
  });

  try {
    const request = await harness.service.createRequest({
      groupId: "group-1",
      actorId: "actor-a",
      actionId: templateItem.uuid,
      title: "",
      weeks: 1,
      submittedByUserId: "player-1"
    });

    assert.equal(request.actorId, "actor-a");
    assert.equal(request.submittedByUserId, "player-1");
    assert.equal(getDowntimeState(harness).balancesByActorId["actor-a"].availableWorkdays, 5);
    assert.equal(getDowntimeState(harness).balancesByActorId["actor-a"].reservedWorkdays, 5);
  }
  finally {
    harness.restore();
  }
});

test("createRequest recovers counter from existing request ids in direct service state", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-recovered",
    name: "Recovered downtime"
  });
  const harness = createHarness({
    members: [actorA],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      },
      requests: [
        { id: "downtime-2" },
        { id: "downtime-9" },
        { id: "other-100" }
      ]
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: "actor-a",
      actionId: templateItem.uuid,
      title: "Recovered",
      weeks: 1
    });

    assert.equal(request.id, "downtime-10");
    assert.equal(getDowntimeState(harness).counter, 10);
  }
  finally {
    harness.restore();
  }
});

test("reject and return release reserved request weeks back to available", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });
  const baseBalance = {
    availableWeeks: 1,
    reservedWeeks: 2,
    spentWeeks: 0,
    totalGrantedWeeks: 3
  };

  for (const status of ["rejected", "returned"]) {
    const harness = createHarness({
      members: [actorA],
      downtimeState: {
        balancesByActorId: {
          "actor-a": clone(baseBalance)
        },
        requests: [{
          id: `downtime-${status}`,
          actorId: "actor-a",
          actorName: "Hero A",
          actionId: "unique",
          actionLabel: "Уникальная заявка",
          title: "Request",
          description: "",
          weeks: 2,
          status: "pending",
          checks: [],
          result: "",
          createdAt: 1,
          updatedAt: 1,
          submittedByUserId: "player-1",
          reviewedByUserId: ""
        }]
      }
    });

    try {
      const request = await harness.service.setRequestStatus(`downtime-${status}`, status, { result: "No" });
      const balance = getDowntimeState(harness).balancesByActorId["actor-a"];

      assert.equal(request.status, status);
      assert.equal(request.result, "No");
      assert.equal(balance.availableWorkdays, 15);
      assert.equal(balance.reservedWorkdays, 0);
      assert.equal(balance.spentWorkdays, 0);
    }
    finally {
      harness.restore();
    }
  }
});

test("complete spends reserved request weeks", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actorA],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 2,
          spentWeeks: 0,
          totalGrantedWeeks: 3
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "training",
        actionLabel: "Тренировка",
        title: "Train",
        description: "",
        weeks: 2,
        status: "approved",
        checks: [],
        result: "",
        createdAt: 1,
        updatedAt: 1,
        submittedByUserId: "player-1",
        reviewedByUserId: ""
      }]
    }
  });

  try {
    const request = await harness.service.setRequestStatus("downtime-1", "completed", { result: "Done" });
    const balance = getDowntimeState(harness).balancesByActorId["actor-a"];

    assert.equal(request.status, "completed");
    assert.equal(request.result, "Done");
    assert.equal(balance.availableWorkdays, 5);
    assert.equal(balance.reservedWorkdays, 0);
    assert.equal(balance.spentWorkdays, 10);
  }
  finally {
    harness.restore();
  }
});

test("completed requests are terminal", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actorA],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 0,
          reservedWeeks: 0,
          spentWeeks: 2,
          totalGrantedWeeks: 2
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "training",
        actionLabel: "Тренировка",
        title: "Train",
        description: "",
        weeks: 2,
        status: "completed",
        checks: [{
          id: "check-1",
          label: "Check",
          dc: 12,
          ability: "",
          result: null
        }],
        result: "Done",
        createdAt: 1,
        updatedAt: 1,
        submittedByUserId: "player-1",
        reviewedByUserId: "gm"
      }]
    }
  });

  try {
    await assert.rejects(
      () => harness.service.setRequestStatus("downtime-1", "returned"),
      /completed request is terminal/u
    );
    await assert.rejects(
      () => harness.service.setRequestStatus("downtime-1", "completed", { result: "Edited" }),
      /completed request is terminal/u
    );
    await assert.rejects(
      () => harness.service.setRequestChecks("downtime-1", [{ label: "New", dc: 10 }]),
      /completed request is terminal/u
    );
    await assert.rejects(
      () => harness.service.recordCheckResult("downtime-1", "check-1", { total: 15 }),
      /completed request is terminal/u
    );
  }
  finally {
    harness.restore();
  }
});

test("closeProject closes an unfinished completed project without week accounting", async () => {
  const harness = createHarness({
    members: [createActor({ id: "actor-a", name: "Hero A" })],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 0,
          reservedWeeks: 0,
          spentWeeks: 1,
          totalGrantedWeeks: 1
        }
      },
      requests: [{
        id: "downtime-project",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "long-project",
        actionLabel: "Long Project",
        title: "Tower",
        weeks: 1,
        status: "completed",
        checks: [{
          id: "long-project-counter",
          label: "Project counter",
          actionType: "projectCounter",
          projectCounter: {
            current: 2,
            max: 6
          }
        }]
      }]
    }
  });

  try {
    const request = await harness.service.closeProject("downtime-project", {
      actorId: "actor-a"
    });
    const balance = getDowntimeState(harness).balancesByActorId["actor-a"];

    assert.equal(request.projectClosed, true);
    assert.equal(request.projectClosedByUserId, "gm");
    assert.equal(balance.availableWorkdays, 0);
    assert.equal(balance.reservedWorkdays, 0);
    assert.equal(balance.spentWorkdays, 5);
  }
  finally {
    harness.restore();
  }
});

test("continueProject spends a week and records a new long project roll without reopening the request", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 1,
          totalGrantedWeeks: 2
        }
      },
      requests: [{
        id: "downtime-project",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "long-project",
        actionLabel: "Long Project",
        title: "Tower",
        weeks: 1,
        status: "completed",
        checks: [{
          id: "long-project-counter",
          label: "Project counter",
          actionType: "projectCounter",
          projectCounter: {
            current: 1,
            max: 4
          }
        }, {
          id: "long-project-check",
          label: "Progress check",
          actionType: "check",
          sourceType: "skill",
          ability: "int",
          target: "inv",
          targetLabel: "Investigation",
          dc: 14,
          outcomeMode: "dc-sum",
          result: {
            total: 20,
            dc: 14,
            success: true
          }
        }, {
          id: "long-project-result",
          label: "Counter shift",
          actionType: "downtimeResult",
          result: {
            total: 2,
            value: 2,
            progressSteps: 2,
            outputField: "progressSteps"
          }
        }, {
          id: "long-project-result-fresh",
          label: "Counter shift",
          actionType: "downtimeResult",
          resultFormula: {
            outputField: "progressSteps",
            terms: [{
              actionId: "long-project-check",
              field: "dcProgressSteps",
              operator: "+"
            }]
          }
        }]
      }]
    }
  });

  try {
    const request = await harness.service.continueProject("downtime-project", {
      actorId: actor.id,
      checkId: "long-project-check",
      result: {
        total: 23
      }
    });
    const state = getDowntimeState(harness);
    const balance = state.balancesByActorId["actor-a"];

    assert.equal(state.requests.length, 1);
    assert.equal(request.status, "completed");
    assert.equal(request.checks.find((check) => check.id === "long-project-counter").projectCounter.current, 3);
    assert.equal(request.checks.find((check) => check.id === "long-project-check").result.total, 23);
    assert.equal(request.checks.find((check) => check.id === "long-project-check").result.dc, 14);
    assert.equal(request.checks.find((check) => check.id === "long-project-result").result, null);
    assert.equal(request.checks.find((check) => check.id === "long-project-result-fresh").result.progressSteps, 2);
    assert.equal(balance.availableWorkdays, 0);
    assert.equal(balance.reservedWorkdays, 0);
    assert.equal(balance.spentWorkdays, 10);
  }
  finally {
    harness.restore();
  }
});

test("released requests cannot be completed without re-reserving weeks", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });

  for (const status of ["returned", "rejected"]) {
    const harness = createHarness({
      members: [actorA],
      downtimeState: {
        balancesByActorId: {
          "actor-a": {
            availableWeeks: 2,
            reservedWeeks: 0,
            spentWeeks: 0,
            totalGrantedWeeks: 2
          }
        },
        requests: [{
          id: `downtime-${status}`,
          actorId: "actor-a",
          actorName: "Hero A",
          actionId: "unique",
          actionLabel: "РЈРЅРёРєР°Р»СЊРЅР°СЏ Р·Р°СЏРІРєР°",
          title: "Released request",
          description: "",
          weeks: 1,
          status,
          checks: [],
          result: "",
          createdAt: 1,
          updatedAt: 1,
          submittedByUserId: "player-1",
          reviewedByUserId: "gm"
        }]
      }
    });

    try {
      await assert.rejects(
        () => harness.service.setRequestStatus(`downtime-${status}`, "completed"),
        /must be reserved before completion/u
      );

      const balance = getDowntimeState(harness).balancesByActorId["actor-a"];
      assert.equal(balance.availableWeeks, 2);
      assert.equal(balance.reservedWeeks, 0);
      assert.equal(balance.spentWeeks, 0);
      assert.equal(getDowntimeState(harness).requests[0].status, status);
    }
    finally {
      harness.restore();
    }
  }
});

test("release and complete reject inconsistent reserved balances without minting weeks", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });

  for (const nextStatus of ["rejected", "completed"]) {
    const harness = createHarness({
      members: [actorA],
      downtimeState: {
        balancesByActorId: {
          "actor-a": {
            availableWeeks: 0,
            reservedWeeks: 1,
            spentWeeks: 0,
            totalGrantedWeeks: 2
          }
        },
        requests: [{
          id: `downtime-${nextStatus}`,
          actorId: "actor-a",
          actorName: "Hero A",
          actionId: "unique",
          actionLabel: "Уникальная заявка",
          title: "Request",
          description: "",
          weeks: 2,
          status: "pending",
          checks: [],
          result: "",
          createdAt: 1,
          updatedAt: 1,
          submittedByUserId: "player-1",
          reviewedByUserId: ""
        }]
      }
    });

    try {
      await assert.rejects(
        () => harness.service.setRequestStatus(`downtime-${nextStatus}`, nextStatus),
        /Reserved downtime weeks are lower than the request cost/u
      );

      const balance = getDowntimeState(harness).balancesByActorId["actor-a"];
      assert.equal(balance.availableWeeks, 0);
      assert.equal(balance.reservedWeeks, 1);
      assert.equal(balance.spentWeeks, 0);
    }
    finally {
      harness.restore();
    }
  }
});

test("GM assigns checks and an owner records check result", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A", ownerUserId: "player-1" });
  const harness = createHarness({
    members: [actorA],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 0,
          reservedWeeks: 1,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "research",
        actionLabel: "Исследование",
        title: "Research",
        description: "",
        weeks: 1,
        status: "approved",
        checks: [],
        result: "",
        createdAt: 1,
        updatedAt: 1,
        submittedByUserId: "player-1",
        reviewedByUserId: ""
      }]
    }
  });

  try {
    const assigned = await harness.service.setRequestChecks("downtime-1", [{
      id: "arcana",
      label: "Arcana",
      dc: 15,
      ability: "int"
    }]);

    assert.deepEqual(assigned.checks, [{
      id: "arcana",
      label: "Arcana",
      dc: 15,
      ability: "int",
      result: null
    }]);

    globalThis.game.user = { id: "player-1", isGM: false };
    const updated = await harness.service.recordCheckResult("downtime-1", "arcana", {
      total: 18,
      success: true,
      note: "Good roll"
    });

    assert.deepEqual(updated.checks[0].result.total, 18);
    assert.equal(updated.checks[0].result.success, true);
    assert.equal(updated.checks[0].result.recordedByUserId, "player-1");
  }
  finally {
    harness.restore();
  }
});

test("GM assigns structured target actions without capping complex requests at five", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A", ownerUserId: "player-1" });
  const harness = createHarness({
    members: [actorA],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 0,
          reservedWeeks: 1,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "research",
        actionLabel: "Исследование",
        title: "Research",
        description: "",
        weeks: 1,
        status: "approved",
        checks: [],
        result: "",
        createdAt: 1,
        updatedAt: 1,
        submittedByUserId: "player-1",
        reviewedByUserId: ""
      }]
    }
  });

  try {
    const assigned = await harness.service.setRequestChecks("downtime-1", [
      {
        id: "trace",
        label: "Поиск следов",
        actionType: "choice",
        sourceType: "skill",
        ability: "wis",
        target: "prc",
        targetLabel: "Восприятие",
        outcomeMode: "dc",
        dc: 15,
        rollMode: "normal",
        recordMode: "total-success",
        choices: [
          { ability: "wis", target: "prc", label: "МДР (Восприятие)" },
          { ability: "wis", target: "ins", label: "МДР (Проницательность)" }
        ],
        checkEffect: {
          trigger: "success",
          adapter: "rebreya",
          template: "project-progress"
        },
        downtimeEffect: {
          trigger: "complete",
          adapter: "rebreya",
          template: "group-event"
        }
      },
      { id: "two", label: "Two" },
      { id: "three", label: "Three" },
      { id: "four", label: "Four" },
      { id: "five", label: "Five" },
      { id: "six", label: "Six" }
    ]);

    assert.equal(assigned.checks.length, 6);
    assert.equal(assigned.checks[0].actionType, "choice");
    assert.equal(assigned.checks[0].sourceType, "skill");
    assert.equal(assigned.checks[0].target, "prc");
    assert.equal(assigned.checks[0].targetLabel, "Восприятие");
    assert.equal(assigned.checks[0].outcomeMode, "dc");
    assert.deepEqual(assigned.checks[0].choices.map((choice) => choice.label), ["МДР (Восприятие)", "МДР (Проницательность)"]);
    assert.equal(assigned.checks[0].checkEffect.template, "project-progress");
    assert.equal(assigned.checks[0].downtimeEffect.template, "group-event");
    assert.deepEqual(assigned.checks.map((check) => check.id), ["trace", "two", "three", "four", "five", "six"]);
  }
  finally {
    harness.restore();
  }
});

test("GM records check result for stale existing request", async () => {
  const currentMember = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [currentMember],
    downtimeState: {
      balancesByActorId: {
        "stale-actor": {
          availableWeeks: 0,
          reservedWeeks: 1,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "stale-actor",
        actorName: "Former Hero",
        actionId: "research",
        actionLabel: "Исследование",
        title: "Old research",
        description: "",
        weeks: 1,
        status: "approved",
        checks: [{
          id: "check-1",
          label: "Arcana",
          dc: 15,
          ability: "int",
          result: null
        }],
        result: "",
        createdAt: 1,
        updatedAt: 1,
        submittedByUserId: "player-1",
        reviewedByUserId: "gm"
      }]
    }
  });

  try {
    const updated = await harness.service.recordCheckResult("downtime-1", "check-1", {
      total: 20,
      success: true
    });

    assert.equal(updated.actorId, "stale-actor");
    assert.equal(updated.checks[0].result.total, 20);
    assert.equal(updated.checks[0].result.recordedByUserId, "gm");
  }
  finally {
    harness.restore();
  }
});

test("clearHistory removes downtime requests and releases open reservations", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });
  const actorB = createActor({ id: "actor-b", name: "Hero B" });
  const harness = createHarness({
    members: [actorA, actorB],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 0,
          reservedWeeks: 2,
          spentWeeks: 1,
          totalGrantedWeeks: 3
        },
        "actor-b": {
          availableWeeks: 2,
          reservedWeeks: 0,
          spentWeeks: 1,
          totalGrantedWeeks: 3
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "training",
        actionLabel: "Training",
        title: "Open request",
        description: "",
        weeks: 2,
        status: "approved",
        checks: [],
        result: "",
        createdAt: 1,
        updatedAt: 1,
        submittedByUserId: "player-1",
        reviewedByUserId: "gm"
      }, {
        id: "downtime-2",
        actorId: "actor-b",
        actorName: "Hero B",
        actionId: "rest",
        actionLabel: "Rest",
        title: "Done request",
        description: "",
        weeks: 1,
        status: "completed",
        checks: [],
        result: "Done",
        createdAt: 1,
        updatedAt: 1,
        submittedByUserId: "player-2",
        reviewedByUserId: "gm"
      }],
      checks: [{ id: "legacy-check", label: "Legacy", dc: 10 }],
      history: [{ id: "downtime-history-1", type: "grant", weeks: 3 }],
      counter: 2
    }
  });

  try {
    const result = await harness.service.clearHistory();
    const state = getDowntimeState(harness);

    assert.deepEqual(result, {
      actorIds: ["actor-a", "actor-b"],
      removedRequests: 2,
      releasedWeeks: 2
    });
    assert.deepEqual(state.requests, []);
    assert.deepEqual(state.checks, []);
    assert.deepEqual(harness.service.getSnapshot().history, []);
    assert.equal(state.counter, 0);
    assert.equal(state.balancesByActorId["actor-a"].availableWorkdays, 10);
    assert.equal(state.balancesByActorId["actor-a"].reservedWorkdays, 0);
    assert.equal(state.balancesByActorId["actor-a"].spentWorkdays, 5);
    assert.equal(state.balancesByActorId["actor-a"].totalGrantedWorkdays, 15);
    assert.equal(state.balancesByActorId["actor-b"].availableWorkdays, 10);
    assert.equal(state.balancesByActorId["actor-b"].spentWorkdays, 5);
  }
  finally {
    harness.restore();
  }
});

test("clearHistory releases every open and released unprocessed reservation", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });
  const actorB = createActor({ id: "actor-b", name: "Hero B" });
  const templateItem = createDowntimeTemplateItem({ id: "downtime-craft", name: "Craft" });
  const harness = createHarness({
    members: [actorA, actorB],
    groupItems: [templateItem],
    calendarIsoDate: "2026-07-16",
    downtimeState: { version: 2 }
  });

  try {
    await harness.service.grantWeeks({ actorIds: [actorA.id, actorB.id], weeks: 1, fromIsoDate: "2026-07-13" });
    const openRequest = await harness.service.createRequest({ actorId: actorA.id, actionId: templateItem.uuid, weeks: 1 });
    const releasedRequest = await harness.service.createRequest({ actorId: actorB.id, actionId: templateItem.uuid, weeks: 1 });
    await harness.service.setRequestStatus(openRequest.id, "approved");
    await harness.service.setRequestStatus(releasedRequest.id, "approved");
    await harness.service.setRequestStatus(releasedRequest.id, "returned");
    await harness.mutateDowntimeState((state) => {
      state.scheduleSlots.find((slot) => slot.requestId === openRequest.id).status = "blocked";
    });

    await harness.service.clearHistory();

    const state = getDowntimeState(harness);
    assert.deepEqual(state.requests, []);
    assert.equal(state.scheduleSlots.every((slot) => slot.status === "free" && slot.requestId === null), true);
    assert.deepEqual(state.balancesByActorId[actorA.id], {
      availableWorkdays: 5,
      reservedWorkdays: 0,
      spentWorkdays: 0,
      totalGrantedWorkdays: 5
    });
    assert.deepEqual(state.balancesByActorId[actorB.id], {
      availableWorkdays: 5,
      reservedWorkdays: 0,
      spentWorkdays: 0,
      totalGrantedWorkdays: 5
    });
  }
  finally {
    harness.restore();
  }
});

test("clearHistory fails busy without mutation for every claimed request status", async () => {
  for (const status of ["approved", "returned"]) {
    const actor = createActor({ id: "actor-a", name: "Hero A" });
    const harness = createHarness({
      members: [actor],
      downtimeState: {
        version: 2,
        balancesByActorId: {
          [actor.id]: {
            availableWorkdays: 0,
            reservedWorkdays: 1,
            spentWorkdays: 0,
            totalGrantedWorkdays: 1
          }
        },
        requests: [{
          id: "downtime-1",
          actorId: actor.id,
          actionId: "craft",
          weeks: 1,
          workdays: 1,
          status
        }],
        scheduleSlots: [{
          id: "slot-claimed",
          actorId: actor.id,
          isoDate: "2026-07-16",
          status: "approved",
          grantId: "grant-1",
          requestId: "downtime-1",
          processingTransitionId: "transition-clear-busy"
        }],
        transitionJournal: [{
          transitionId: "transition-clear-busy",
          isoDate: "2026-07-16",
          slotIds: ["slot-claimed"],
          status: "processing",
          resultsBySlotId: {
            "slot-claimed": {
              status: "processing",
              claimedActorId: actor.id,
              claimedRequestId: "downtime-1",
              claimedStatus: "approved"
            }
          },
          createdAt: 1,
          updatedAt: 1
        }]
      }
    });

    try {
      const stateBeforeMutation = clone(getDowntimeState(harness));
      await assert.rejects(
        harness.service.clearHistory(),
        /busy.*retry/iu,
        status
      );
      assert.deepEqual(getDowntimeState(harness), stateBeforeMutation, status);
    }
    finally {
      harness.restore();
    }
  }
});

test("non-owner and nonmember actors are rejected for player request and result actions", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A", ownerUserId: "player-1" });
  const actorB = createActor({ id: "actor-b", name: "Hero B", ownerUserId: "player-2" });
  const harness = createHarness({
    user: { id: "player-1", isGM: false },
    members: [actorA, actorB],
    downtimeState: {
      balancesByActorId: {
        "actor-b": {
          availableWeeks: 2,
          reservedWeeks: 1,
          spentWeeks: 0,
          totalGrantedWeeks: 3
        },
        "stale-actor": {
          availableWeeks: 5,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 5
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "actor-b",
        actorName: "Hero B",
        actionId: "unique",
        actionLabel: "Уникальная заявка",
        title: "Other request",
        description: "",
        weeks: 1,
        status: "approved",
        checks: [{
          id: "check-1",
          label: "Check",
          dc: 10,
          ability: "",
          result: null
        }],
        result: "",
        createdAt: 1,
        updatedAt: 1,
        submittedByUserId: "player-2",
        reviewedByUserId: "gm"
      }]
    }
  });

  try {
    await assert.rejects(
      () => harness.service.createRequest({
        actorId: "actor-b",
        actionId: "unique",
        title: "Nope",
        weeks: 1
      }),
      /owned character/u
    );
    await assert.rejects(
      () => harness.service.createRequest({
        actorId: "stale-actor",
        actionId: "unique",
        title: "Nope",
        weeks: 1
      }),
      /current group member/u
    );
    await assert.rejects(
      () => harness.service.recordCheckResult("downtime-1", "check-1", { total: 12 }),
      /owned character/u
    );
  }
  finally {
    harness.restore();
  }
});

test("getActionCatalog only exposes downtime template items", () => {
  const harness = createHarness();

  try {
    assert.deepEqual(harness.service.getActionCatalog(), []);
  }
  finally {
    harness.restore();
  }
});

test("getActionCatalog exposes Rebreya downtime template items from the active group", () => {
  const templateItem = createDowntimeTemplateItem({
    name: "Исследование по рангу",
    config: {
      defaultWeeks: 2,
      rankMode: "required",
      descriptionHtml: "<h2>Исследование по рангу</h2><h3>Нарративная заявка</h3><p>Полный текст заявки.</p><h3>Ресурсы</h3><p>Полный текст ресурсов.</p><h3>Определение последствий</h3><p>Полный текст последствий.</p>",
      rankTable: [{ rank: 4, baseTotal: 120, stepCost: 100 }],
      targetActions: [{
        id: "check-archive",
        label: "Архив",
        actionType: "check",
        sourceType: "skill",
        ability: "int",
        target: "his",
        targetLabel: "История"
      }]
    }
  });
  const harness = createHarness({
    groupItems: [templateItem]
  });

  try {
    const action = harness.service.getActionCatalog().find((entry) => entry.id === templateItem.uuid);

    assert.deepEqual(action, {
      id: templateItem.uuid,
      label: "Исследование по рангу",
      source: "item",
      templateUuid: templateItem.uuid,
      templateItemId: templateItem.id,
      rank: "",
      duration: "",
      summary: "",
      descriptionHtml: "<h2>Исследование по рангу</h2><h3>Нарративная заявка</h3><p>Полный текст заявки.</p><h3>Ресурсы</h3><p>Полный текст ресурсов.</p><h3>Определение последствий</h3><p>Полный текст последствий.</p>",
      requirements: [],
      defaultWeeks: 2,
      rankMode: "required",
      rankTable: [{ rank: 4, baseTotal: 120, stepCost: 100 }],
      targetActions: [{
        id: "check-archive",
        label: "Архив",
        actionType: "check",
        sourceType: "skill",
        ability: "int",
        target: "his",
        targetLabel: "История"
      }]
    });
  }
  finally {
    harness.restore();
  }
});

test("createRequest links downtime requests to the selected template item and copies target actions", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const descriptionHtml = "<h2>Research</h2><h3>Narrative request</h3><p>Full narrative.</p><h3>Resources</h3><p>Full resources.</p><h3>Consequences</h3><p>Full consequences.</p>";
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-research",
    name: "Исследование по рангу",
    config: {
      descriptionHtml,
      rank: "1+",
      duration: "1 рабочая неделя.",
      summary: "Изучить вопрос.",
      requirements: ["Библиотека"],
      defaultWeeks: 2,
      rankMode: "required",
      rankTable: [{ rank: 4, baseTotal: 120, stepCost: 100 }],
      targetActions: [{
        id: "research-resources",
        label: "Стоимость исследования",
        actionType: "resources",
        resources: {
          narrative: "Базовая сумма зависит от ранга.",
          cost: {
            amount: 10,
            currency: "gp",
            payer: "character",
            timing: "submit"
          }
        }
      }, {
        id: "check-archive",
        label: "Архив",
        actionType: "check",
        sourceType: "skill",
        ability: "int",
        target: "his",
        targetLabel: "История",
        dc: 15
      }]
    }
  });
  const harness = createHarness({
    members: [actor],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 3,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 3
        }
      }
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      title: "",
      weeks: 2
    });

    assert.equal(request.actionId, templateItem.uuid);
    assert.equal(request.actionLabel, "Исследование по рангу");
    assert.equal(request.templateUuid, templateItem.uuid);
    assert.equal(request.templateItemId, templateItem.id);
    assert.equal(request.templateSource, "item");
    assert.equal(request.templateDescriptionHtml, descriptionHtml);
    assert.equal(request.templateRank, "1+");
    assert.equal(request.templateDuration, "1 рабочая неделя.");
    assert.equal(request.templateSummary, "Изучить вопрос.");
    assert.deepEqual(request.templateRequirements, ["Библиотека"]);
    assert.equal(request.title, "Исследование по рангу");
    assert.deepEqual(request.templateRankTable, [{ rank: 4, baseTotal: 120, stepCost: 100 }]);
    assert.equal(harness.service.getSnapshot().requests[0].templateDescriptionHtml, descriptionHtml);
    assert.deepEqual(request.checks, [{
      id: "research-resources",
      label: "Стоимость исследования",
      actionType: "resources",
      resources: {
        narrative: "Базовая сумма зависит от ранга.",
        cost: {
          amount: 10,
          currency: "gp",
          payer: "character",
          timing: "submit"
        }
      },
      dc: 0,
      ability: "",
      result: null
    }, {
      id: "check-archive",
      label: "Архив",
      actionType: "check",
      sourceType: "skill",
      ability: "int",
      target: "his",
      targetLabel: "История",
      dc: 15,
      result: null
    }]);
  }
  finally {
    harness.restore();
  }
});

test("createRequest applies selected resource choices from downtime templates", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-carousing",
    name: "Кутёж",
    config: {
      rank: "3+",
      duration: "1 рабочая неделя.",
      summary: "Неделя общения и развлечений.",
      targetActions: [{
        id: "carousing-resources",
        label: "Круг общения",
        actionType: "resources",
        resources: {
          narrative: "Выберите круг общения.",
          cost: {
            amount: 10,
            currency: "gp",
            payer: "character",
            timing: "submit"
          },
          choices: [{
            id: "commoners",
            label: "Простонародье",
            cost: {
              amount: 10,
              currency: "gp",
              payer: "character",
              timing: "submit"
            }
          }, {
            id: "wealthy",
            label: "Зажиточные люди",
            cost: {
              amount: 50,
              currency: "gp",
              payer: "character",
              timing: "submit"
            }
          }]
        }
      }, {
        id: "carousing-check",
        label: "Новые контакты",
        actionType: "check",
        sourceType: "skill",
        ability: "cha",
        target: "per",
        targetLabel: "Убеждение"
      }]
    }
  });
  const harness = createHarness({
    members: [actor],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      weeks: 1,
      targetActionSelections: [{
        actionId: "carousing-resources",
        choiceId: "wealthy"
      }]
    });

    assert.equal(request.checks[0].selectedChoiceId, "wealthy");
    assert.equal(request.checks[0].selectedChoiceLabel, "Зажиточные люди");
    assert.equal(request.checks[0].resources.cost.amount, 50);
    assert.equal(request.checks[0].resources.cost.currency, "gp");
    assert.equal(request.checks[1].targetLabel, "Убеждение");
  }
  finally {
    harness.restore();
  }
});

test("createRequest applies structured target action selections from downtime templates", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-magic-item-purchase",
    name: "Покупка магического предмета",
    config: {
      rank: "2+",
      duration: "1 рабочая неделя.",
      targetActions: [{
        id: "magic-item-purchase-item",
        label: "Предмет",
        actionType: "itemChoice",
        itemChoice: {
          sourceType: "magicItem"
        }
      }, {
        id: "magic-item-purchase-trade-step",
        label: "Тип торгов",
        actionType: "optionChoice",
        options: [{
          id: "normal",
          label: "Нормальные",
          value: 0
        }, {
          id: "good",
          label: "Удачные",
          value: 2
        }]
      }, {
        id: "magic-item-purchase-search-step",
        label: "Шаг поиска",
        actionType: "numericInput",
        input: {
          min: -5,
          max: 5,
          step: 1
        }
      }]
    }
  });
  const harness = createHarness({
    members: [actor],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      weeks: 1,
      targetActionSelections: [{
        actionId: "magic-item-purchase-item",
        item: {
          uuid: "Compendium.world.rebreya-magic-items.Item.wand",
          id: "wand",
          name: "Жезл огня",
          type: "loot",
          img: "icons/magic/fire/wand-fire.webp",
          sourceType: "magicItem",
          rarity: "rare",
          priceGold: 1200,
          rebreya: {
            managed: true,
            sourceType: "magicItem",
            magicItemId: "wand",
            signature: "magic:wands:wand",
            rarity: "rare",
            itemType: "wand",
            itemSubtype: "fire",
            itemSlot: "hand",
            heroDollSlots: ["mainHand", "offHand"],
            rank: 4,
            foundryType: "loot",
            foundrySubtype: "wand",
            foundrySubtypeExtra: "",
            foundryBaseItem: "",
            foundryFolder: "magic-items/wands",
            magical: true,
            attunement: "required",
            bargaining: 2,
            itemBargaining: 2,
            isConsumable: false,
            value: 1200,
            priceGold: 1200,
            source: "Rebreya"
          },
          documentSnapshot: {
            name: "Fire Wand",
            type: "loot",
            img: "icons/magic/fire/wand-fire.webp",
            system: {
              price: {
                value: 1200,
                denomination: "gp"
              }
            },
            flags: {
              "rebreya-main": {
                sourceType: "magicItem",
                magicItemId: "wand",
                signature: "magic:wands:wand"
              }
            }
          }
        }
      }, {
        actionId: "magic-item-purchase-trade-step",
        optionId: "good"
      }, {
        actionId: "magic-item-purchase-search-step",
        value: -1
      }]
    });

    assert.deepEqual(request.checks.map((check) => ({
      id: check.id,
      selectedItemName: check.selectedItem?.name,
      selectedOptionLabel: check.selectedOption?.label,
      numericValue: check.numericValue
    })), [{
      id: "magic-item-purchase-item",
      selectedItemName: "Жезл огня",
      selectedOptionLabel: undefined,
      numericValue: undefined
    }, {
      id: "magic-item-purchase-trade-step",
      selectedItemName: undefined,
      selectedOptionLabel: "Удачные",
      numericValue: undefined
    }, {
      id: "magic-item-purchase-search-step",
      selectedItemName: undefined,
      selectedOptionLabel: undefined,
      numericValue: -1
    }]);
    assert.equal(request.checks[0].selectedItem.img, "icons/magic/fire/wand-fire.webp");
    assert.equal(request.checks[0].selectedItem.rebreya.magicItemId, "wand");
    assert.deepEqual(request.checks[0].selectedItem.rebreya.heroDollSlots, ["mainHand", "offHand"]);
    assert.equal(request.checks[0].selectedItem.rebreya.foundryFolder, "magic-items/wands");
    assert.equal(request.checks[0].selectedItem.documentSnapshot.system.price.value, 1200);
    assert.equal(request.checks[0].selectedItem.documentSnapshot.flags["rebreya-main"].signature, "magic:wands:wand");
  }
  finally {
    harness.restore();
  }
});

test("createRequest derives magic item purchase bargaining and price formula from selected item", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-magic-item-purchase-derived",
    name: "Покупка магического предмета",
    config: {
      targetActions: [{
        id: "magic-item-purchase-item",
        label: "Предмет",
        actionType: "itemChoice",
        itemChoice: {
          sourceType: "magicItem"
        }
      }, {
        id: "magic-item-purchase-trade-step",
        label: "Торги",
        actionType: "optionChoice",
        options: [{
          id: "forbidden",
          label: "Запрещённые",
          value: -5
        }, {
          id: "bad",
          label: "Невыгодные",
          value: -1
        }, {
          id: "normal",
          label: "Нормальные",
          value: 0
        }]
      }, {
        id: "magic-item-purchase-price",
        label: "Цена",
        actionType: "formulaRoll",
        formulaByRarity: {
          rare: "1d6 * 1000"
        },
        tradeStepActionId: "magic-item-purchase-trade-step",
        itemActionId: "magic-item-purchase-item"
      }]
    }
  });
  const harness = createHarness({
    members: [actor],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      weeks: 1,
      targetActionSelections: [{
        actionId: "magic-item-purchase-item",
        item: {
          uuid: "Compendium.world.rebreya-magic-items.Item.belt-fire-giant",
          name: "Пояс силы огненного великана",
          sourceType: "magicItem",
          rebreya: {
            sourceType: "magicItem",
            magicItemId: "belt-fire-giant",
            rarity: "Редкий",
            bargaining: "Невыгодные",
            itemBargaining: "Невыгодные",
            signature: JSON.stringify({
              rarity: "Редкий",
              bargaining: "Невыгодные",
              costText: "2d6kh1*1000 зм"
            }),
            priceGold: 5500
          }
        }
      }]
    });

    assert.equal(request.checks[1].selectedOptionId, "bad");
    assert.equal(request.checks[1].selectedOptionLabel, "Невыгодные");
    assert.equal(request.checks[2].selectedFormula, "2d6kh1*1000");
  }
  finally {
    harness.restore();
  }
});

test("createRequest snapshots rank choices and rank-priced resources", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-research",
    name: "Исследование",
    config: {
      targetActions: [{
        id: "research-rank",
        label: "Ранг вопроса",
        actionType: "rankChoice",
        rankChoice: {
          min: 1,
          max: 9,
          default: 1,
          rows: [
            { rank: 1, label: "Ранг 1", baseCost: 10, unitCost: 5 },
            { rank: 4, label: "Ранг 4", baseCost: 120, unitCost: 100 }
          ]
        }
      }, {
        id: "research-steps",
        label: "Шаги",
        actionType: "resources",
        resources: {
          resourceName: "Шаг исследования",
          dependsOnRank: true,
          rankSourceActionId: "research-rank",
          quantity: {
            min: 0,
            max: 5,
            default: 0,
            unit: "шаг."
          },
          rankCosts: [
            { rank: 1, baseCost: 10, unitCost: 5, max: 5 },
            { rank: 4, baseCost: 120, unitCost: 100, max: 5 }
          ],
          cost: {
            currency: "gp",
            payer: "character",
            timing: "manual"
          }
        }
      }]
    }
  });
  const harness = createHarness({
    members: [actor],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      weeks: 1,
      targetActionSelections: [{
        actionId: "research-rank",
        optionId: "rank-4"
      }, {
        actionId: "research-steps",
        value: 99
      }]
    });

    assert.equal(request.checks[0].actionType, "rankChoice");
    assert.equal(request.checks[0].selectedRank, 4);
    assert.equal(request.checks[0].selectedOptionLabel, "Ранг 4");
    assert.equal(request.checks[1].actionType, "resources");
    assert.equal(request.checks[1].resourceQuantity.value, 5);
    assert.equal(request.checks[1].resourceQuantity.max, 5);
    assert.equal(request.checks[1].resources.cost.amount, 620);
    assert.equal(request.checks[1].computedCost.total, 620);
    assert.equal(request.checks[1].computedCost.baseCost, 120);
    assert.equal(request.checks[1].computedCost.unitCost, 100);
  }
  finally {
    harness.restore();
  }
});

test("createRequest snapshots long project setup and rank-based counter size", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-long-project",
    name: "Long Project",
    config: {
      defaultWeeks: 1,
      targetActions: [{
        id: "long-project-rank",
        label: "Project rank",
        actionType: "rankChoice",
        rankChoice: {
          min: 1,
          max: 9,
          default: 1,
          rows: [
            { rank: 1, label: "Rank 1", counterMax: 4 },
            { rank: 5, label: "Rank 5", counterMax: 6 },
            { rank: 8, label: "Rank 8", counterMax: 8 }
          ]
        }
      }, {
        id: "long-project-counter",
        label: "Project counter",
        actionType: "projectCounter",
        projectCounter: {
          rankSourceActionId: "long-project-rank",
          current: 0,
          maxByRank: [
            { from: 1, to: 3, max: 4 },
            { from: 4, to: 6, max: 6 },
            { from: 7, to: 9, max: 8 }
          ]
        }
      }, {
        id: "long-project-resources",
        label: "Weekly investment",
        actionType: "resources",
        resources: {
          resourceName: "Gold per week",
          quantity: {
            min: 0,
            default: 0,
            step: 1,
            unit: "gp",
            unitCost: 1
          },
          cost: {
            currency: "gp",
            payer: "character",
            timing: "manual"
          }
        }
      }, {
        id: "long-project-check",
        label: "Progress check",
        actionType: "check",
        configurable: true,
        sourceType: "skill",
        ability: "int",
        target: "inv",
        targetLabel: "Investigation",
        dc: 15,
        dcByRank: {
          rankSourceActionId: "long-project-rank",
          locked: true,
          rows: [
            { rank: 1, dc: 12 },
            { rank: 2, dc: 14 },
            { rank: 3, dc: 16 },
            { rank: 4, dc: 18 },
            { rank: 5, dc: 20 },
            { rank: 6, dc: 22 },
            { rank: 7, dc: 25 },
            { rank: 8, dc: 30 },
            { rank: 9, dc: 35 }
          ]
        },
        outcomeMode: "dc-sum"
      }, {
        id: "long-project-result",
        label: "Counter shift",
        actionType: "downtimeResult",
        resultFormula: {
          outputField: "progressSteps",
          terms: [{
            actionId: "long-project-check",
            field: "dcProgressSteps",
            operator: "+"
          }]
        }
      }]
    }
  });
  const harness = createHarness({
    members: [actor],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      weeks: 1,
      targetActionSelections: [{
        actionId: "long-project-rank",
        optionId: "rank-5"
      }, {
        actionId: "long-project-counter",
        value: 2
      }, {
        actionId: "long-project-resources",
        value: 125
      }, {
        actionId: "long-project-check",
        sourceType: "skill",
        ability: "int",
        target: "arc",
        targetLabel: "Arcana",
        dc: 17
      }]
    });

    assert.equal(request.checks[0].selectedRank, 5);
    assert.equal(request.checks[1].actionType, "projectCounter");
    assert.equal(request.checks[1].projectCounter.current, 2);
    assert.equal(request.checks[1].projectCounter.max, 6);
    assert.equal(request.checks[2].computedCost.total, 125);
    assert.equal(request.checks[2].resources.cost.amount, 125);
    assert.equal(request.checks[3].sourceType, "skill");
    assert.equal(request.checks[3].ability, "int");
    assert.equal(request.checks[3].target, "arc");
    assert.equal(request.checks[3].targetLabel, "Arcana");
    assert.equal(request.checks[3].dc, 20);
    assert.equal(request.checks[3].dcLocked, true);
  }
  finally {
    harness.restore();
  }
});

test("createRequest resolves legacy downtime ids from template target actions", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "generated-template-id",
    name: "Работа над длительным проектом",
    config: {
      defaultWeeks: 1,
      targetActions: [{
        id: "long-project-counter",
        label: "Project counter",
        actionType: "projectCounter",
        projectCounter: {
          current: 0,
          max: 6
        }
      }]
    }
  });
  const harness = createHarness({
    members: [actor],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: "long-project",
      weeks: 1
    });

    assert.equal(request.actionId, templateItem.uuid);
    assert.equal(request.templateUuid, templateItem.uuid);
    assert.equal(request.checks[0].id, "long-project-counter");
  }
  finally {
    harness.restore();
  }
});

test("createRequest snapshots editable description blocks", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-long-project",
    name: "Long Project",
    config: {
      defaultWeeks: 1,
      targetActions: [{
        id: "long-project-description",
        label: "Project description",
        actionType: "descriptionBlock",
        descriptionBlock: {
          title: "",
          description: ""
        }
      }]
    }
  });
  const harness = createHarness({
    members: [actor],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      weeks: 1,
      targetActionSelections: [{
        actionId: "long-project-description",
        title: "Башня у моря",
        description: "Найти архитектора и материалы."
      }]
    });

    assert.equal(request.checks[0].actionType, "descriptionBlock");
    assert.equal(request.checks[0].descriptionBlock.title, "Башня у моря");
    assert.equal(request.checks[0].descriptionBlock.description, "Найти архитектора и материалы.");
  }
  finally {
    harness.restore();
  }
});

test("createRequest computes formula downtime results from selected numeric inputs", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const templateItem = createDowntimeTemplateItem({
    id: "downtime-craft",
    name: "Craft",
    config: {
      defaultWeeks: 1,
      targetActions: [{
        id: "craft-days",
        label: "Work days",
        actionType: "numericInput",
        input: {
          min: 1,
          max: 5,
          step: 1,
          default: 5,
          unit: "days"
        }
      }, {
        id: "craft-progress",
        label: "Progress",
        actionType: "downtimeResult",
        outcomeMode: "sum",
        recordMode: "group-sum",
        resultFormula: {
          outputField: "progressGold",
          terms: [{
            actionId: "craft-days",
            field: "quantity",
            operator: "+",
            multiplier: 5
          }]
        }
      }]
    }
  });
  const harness = createHarness({
    members: [actor],
    groupItems: [templateItem],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: templateItem.uuid,
      weeks: 1,
      targetActionSelections: [{
        actionId: "craft-days",
        value: 3
      }]
    });

    const progress = request.checks.find((check) => check.id === "craft-progress");
    assert.equal(progress.result.total, 15);
    assert.equal(progress.result.progressGold, 15);
    assert.deepEqual(progress.result.sourceActionIds, ["craft-days"]);
  }
  finally {
    harness.restore();
  }
});

test("recordCheckResult computes long project counter progress from DC margin", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "long-project",
        actionLabel: "Long Project",
        title: "Long Project",
        weeks: 1,
        status: "pending",
        checks: [{
          id: "long-project-check",
          label: "Progress check",
          actionType: "check",
          sourceType: "skill",
          ability: "int",
          target: "arc",
          dc: 17,
          outcomeMode: "dc-sum"
        }, {
          id: "long-project-result",
          label: "Counter shift",
          actionType: "downtimeResult",
          resultFormula: {
            outputField: "progressSteps",
            terms: [{
              actionId: "long-project-check",
              field: "dcProgressSteps",
              operator: "+"
            }]
          }
        }]
      }]
    }
  });

  try {
    const request = await harness.service.recordCheckResult("downtime-1", "long-project-check", {
      total: 29
    }, {
      actorId: actor.id
    });

    assert.equal(request.checks[0].result.total, 29);
    assert.equal(request.checks[0].result.dc, 17);
    assert.equal(request.checks[0].result.success, true);
    assert.equal(request.checks[1].result.progressSteps, 3);
    assert.equal(request.checks[1].result.total, 3);
  }
  finally {
    harness.restore();
  }
});

test("recordCheckResult passes threshold outcomes into downtime result actions", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "research",
        actionLabel: "Research",
        title: "Research",
        weeks: 1,
        status: "pending",
        checks: [{
          id: "research-check",
          label: "Research check",
          actionType: "check",
          sourceType: "ability",
          ability: "int",
          target: "int",
          outcomeMode: "thresholds",
          recordMode: "pass-thresholds",
          thresholds: [{
            from: 1,
            to: 10,
            label: "Failure",
            outcome: "failure"
          }, {
            from: 11,
            to: 16,
            label: "Partial",
            outcome: "partial"
          }, {
            from: 17,
            to: 25,
            label: "Success",
            outcome: "success"
          }]
        }, {
          id: "research-result",
          label: "Knowledge fragments",
          actionType: "downtimeResult",
          outcomeMode: "pass-thresholds",
          recordMode: "single-result",
          resultMapping: {
            sourceActionId: "research-check",
            sourceField: "thresholdOutcome",
            outputField: "fragments",
            rows: [{
              sourceOutcome: "failure",
              value: 0,
              label: "0 fragments"
            }, {
              sourceOutcome: "partial",
              value: 1,
              label: "1 fragment"
            }, {
              sourceOutcome: "success",
              value: 2,
              label: "2 fragments"
            }]
          }
        }]
      }]
    }
  });

  try {
    const request = await harness.service.recordCheckResult("downtime-1", "research-check", {
      total: 17
    }, {
      actorId: actor.id
    });

    assert.equal(request.checks[0].result.total, 17);
    assert.equal(request.checks[0].result.thresholdOutcome, "success");
    assert.equal(request.checks[0].result.thresholdLabel, "Success");
    assert.equal(request.checks[1].result.value, 2);
    assert.equal(request.checks[1].result.label, "2 fragments");
    assert.equal(request.checks[1].result.sourceActionId, "research-check");
    assert.equal(request.checks[1].result.sourceOutcome, "success");
    assert.equal(request.checks[1].result.outputField, "fragments");
  }
  finally {
    harness.restore();
  }
});

test("recordCheckResult computes downtime result formulas from previous action successes", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "gambling",
        actionLabel: "Gambling",
        title: "Gambling",
        weeks: 1,
        status: "pending",
        checks: [{
          id: "gambling-insight",
          label: "Insight",
          actionType: "check",
          sourceType: "skill",
          ability: "wis",
          target: "ins",
          outcomeMode: "dc",
          recordMode: "total-success",
          result: {
            total: 18,
            success: true
          }
        }, {
          id: "gambling-deception",
          label: "Deception",
          actionType: "check",
          sourceType: "skill",
          ability: "cha",
          target: "dec",
          outcomeMode: "dc",
          recordMode: "total-success",
          result: {
            total: 9,
            success: false
          }
        }, {
          id: "gambling-intimidation",
          label: "Intimidation",
          actionType: "check",
          sourceType: "skill",
          ability: "cha",
          target: "itm",
          outcomeMode: "dc",
          recordMode: "total-success",
          result: null
        }, {
          id: "gambling-result",
          label: "Stake result",
          actionType: "downtimeResult",
          outcomeMode: "thresholds",
          recordMode: "single-result",
          resultFormula: {
            outputField: "successes",
            terms: [{
              actionId: "gambling-insight",
              field: "success",
              operator: "+"
            }, {
              actionId: "gambling-deception",
              field: "success",
              operator: "+"
            }, {
              actionId: "gambling-intimidation",
              field: "success",
              operator: "+"
            }]
          },
          thresholds: [{
            from: 0,
            to: 0,
            label: "Lose stake and debt",
            outcome: "failure"
          }, {
            from: 1,
            to: 1,
            label: "Lose half stake",
            outcome: "partial"
          }, {
            from: 2,
            to: 2,
            label: "Stake plus 50%",
            outcome: "success"
          }, {
            from: 3,
            label: "Double stake",
            outcome: "great-success"
          }]
        }]
      }]
    }
  });

  try {
    const request = await harness.service.recordCheckResult("downtime-1", "gambling-intimidation", {
      total: 21,
      success: true
    }, {
      actorId: actor.id
    });

    const resultAction = request.checks.find((check) => check.id === "gambling-result");
    assert.equal(resultAction.result.total, 2);
    assert.equal(resultAction.result.successes, 2);
    assert.equal(resultAction.result.thresholdOutcome, "success");
    assert.equal(resultAction.result.thresholdLabel, "Stake plus 50%");
    assert.equal(resultAction.result.outputField, "successes");
    assert.deepEqual(resultAction.result.sourceActionIds, [
      "gambling-insight",
      "gambling-deception",
      "gambling-intimidation"
    ]);
  }
  finally {
    harness.restore();
  }
});

test("approving a request with completed roll targets archives it as completed", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 0,
          reservedWeeks: 1,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "Actor.group-1.Item.downtime-gambling",
        actionLabel: "Азартные игры",
        title: "Азартные игры",
        weeks: 1,
        status: "pending",
        checks: [{
          id: "gambling-acrobatics",
          label: "Акробатика",
          actionType: "check",
          sourceType: "skill",
          ability: "dex",
          target: "acr",
          result: {
            total: 21
          }
        }]
      }]
    }
  });

  try {
    const request = await harness.service.setRequestStatus("downtime-1", "approved");
    const balance = getDowntimeState(harness).balancesByActorId["actor-a"];

    assert.equal(request.status, "completed");
    assert.equal(balance.reservedWorkdays, 0);
    assert.equal(balance.spentWorkdays, 5);
  }
  finally {
    harness.restore();
  }
});

test("approving a request without completed roll targets keeps it active", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 0,
          reservedWeeks: 1,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      },
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Hero A",
        actionId: "Actor.group-1.Item.downtime-gambling",
        actionLabel: "Азартные игры",
        title: "Азартные игры",
        weeks: 1,
        status: "pending",
        checks: [{
          id: "gambling-acrobatics",
          label: "Акробатика",
          actionType: "check",
          sourceType: "skill",
          ability: "dex",
          target: "acr",
          result: null
        }]
      }]
    }
  });

  try {
    const request = await harness.service.setRequestStatus("downtime-1", "approved");
    const balance = getDowntimeState(harness).balancesByActorId["actor-a"];

    assert.equal(request.status, "approved");
    assert.equal(balance.reservedWorkdays, 5);
    assert.equal(balance.spentWorkdays, 0);
  }
  finally {
    harness.restore();
  }
});

test("createRequest rejects unknown downtime action ids instead of using the legacy unique fallback", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actor],
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }
    }
  });

  try {
    await assert.rejects(
      () => harness.service.createRequest({
        actorId: actor.id,
        actionId: "unique",
        weeks: 1
      }),
      /Downtime action not found/u
    );
    assert.deepEqual(getDowntimeState(harness).requests ?? [], []);
  }
  finally {
    harness.restore();
  }
});

test("createRequest resolves managed downtime compendium ids", async () => {
  const actor = createActor({ id: "actor-a", name: "Hero A" });
  const compendiumItem = createDowntimeTemplateItem({
    id: "downtime-gambling",
    name: "Азартные игры",
    config: {
      downtimeId: "gambling",
      defaultWeeks: 1,
      targetActions: [{
        id: "gambling-acrobatics",
        label: "Акробатика",
        actionType: "check",
        sourceType: "skill",
        ability: "dex",
        target: "acr",
        targetLabel: "Акробатика",
        outcomeMode: "freeform"
      }]
    }
  });
  compendiumItem.uuid = "Compendium.world.rebreya-downtime.Item.downtime-gambling";
  const pack = {
    collection: "world.rebreya-downtime",
    async getIndex() {
      return [{
        _id: "downtime-gambling",
        id: "downtime-gambling",
        name: "Азартные игры",
        uuid: compendiumItem.uuid,
        flags: {
          [MODULE_ID]: {
            downtimeId: "gambling",
            downtime: {
              downtimeId: "gambling"
            }
          }
        }
      }];
    },
    async getDocument(documentId) {
      return documentId === "downtime-gambling" ? compendiumItem : null;
    }
  };
  const harness = createHarness({
    members: [actor],
    packs: {
      get(packId) {
        return packId === "world.rebreya-downtime" ? pack : null;
      }
    },
    downtimeState: {
      balancesByActorId: {
        "actor-a": {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }
    }
  });

  try {
    const request = await harness.service.createRequest({
      actorId: actor.id,
      actionId: "gambling",
      weeks: 1
    });

    assert.equal(request.actionId, compendiumItem.uuid);
    assert.equal(request.actionLabel, "Азартные игры");
    assert.equal(request.templateUuid, compendiumItem.uuid);
    assert.equal(request.templateItemId, "downtime-gambling");
    assert.deepEqual(request.checks, [{
      id: "gambling-acrobatics",
      label: "Акробатика",
      actionType: "check",
      sourceType: "skill",
      ability: "dex",
      target: "acr",
      targetLabel: "Акробатика",
      outcomeMode: "freeform",
      dc: 0,
      result: null
    }]);
  }
  finally {
    harness.restore();
  }
});

test("RebreyaMainModule exposes downtime service API and scopes refreshes after mutations", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {}
  };
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-api=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();

    assert.ok(moduleApi.downtimeService instanceof DowntimeService);
    assert.equal(moduleApi.downtimeService.moduleApi, moduleApi);

    const calls = [];
    moduleApi.downtimeService = {
      getSnapshot(options) {
        calls.push(["getSnapshot", options]);
        return { options };
      },
      async grantWeeks(payload) {
        calls.push(["grantWeeks", payload]);
        return { granted: payload };
      },
      async revokeWeeks(payload) {
        calls.push(["revokeWeeks", payload]);
        return { revoked: payload };
      },
      async clearHistory() {
        calls.push(["clearHistory"]);
        return { cleared: true };
      },
      async createRequest(payload) {
        calls.push(["createRequest", payload]);
        return { created: payload };
      },
      async setRequestStatus(requestId, status, options) {
        calls.push(["setRequestStatus", requestId, status, options]);
        return { requestId, status, options };
      },
      async setRequestChecks(requestId, checks) {
        calls.push(["setRequestChecks", requestId, checks]);
        return { requestId, checks };
      },
      async recordCheckResult(requestId, checkId, result) {
        calls.push(["recordCheckResult", requestId, checkId, result]);
        return { requestId, checkId, result };
      },
      async closeProject(requestId, options) {
        calls.push(["closeProject", requestId, options]);
        return { requestId, projectClosed: true, ...options };
      },
      getActionCatalog() {
        calls.push(["getActionCatalog"]);
        return [{ id: "unique" }];
      }
    };

    let refreshCount = 0;
    moduleApi.refreshDowntimeViews = async () => {
      refreshCount += 1;
    };

    assert.deepEqual(moduleApi.getDowntimeSnapshot({ actorId: "actor-a" }), { options: { actorId: "actor-a" } });
    assert.deepEqual(moduleApi.getDowntimeActionCatalog(), [{ id: "unique" }]);
    assert.equal(refreshCount, 0);

    assert.deepEqual(await moduleApi.grantDowntimeWeeks({ weeks: 2 }), { granted: { weeks: 2 } });
    assert.deepEqual(await moduleApi.revokeDowntimeWeeks({ weeks: 1 }), { revoked: { weeks: 1 } });
    assert.deepEqual(await moduleApi.clearDowntimeHistory(), { cleared: true });
    assert.deepEqual(await moduleApi.createDowntimeRequest({ actorId: "actor-a" }), { created: { actorId: "actor-a" } });
    assert.deepEqual(
      await moduleApi.setDowntimeRequestStatus("downtime-1", "approved", { result: "ok" }),
      { requestId: "downtime-1", status: "approved", options: { result: "ok" } }
    );
    assert.deepEqual(
      await moduleApi.setDowntimeRequestChecks("downtime-1", [{ id: "check-1" }]),
      { requestId: "downtime-1", checks: [{ id: "check-1" }] }
    );
    assert.deepEqual(
      await moduleApi.recordDowntimeCheckResult("downtime-1", "check-1", { total: 17 }),
      { requestId: "downtime-1", checkId: "check-1", result: { total: 17 } }
    );
    assert.deepEqual(
      await moduleApi.closeDowntimeProject({ requestId: "downtime-1", actorId: "actor-a" }),
      { requestId: "downtime-1", projectClosed: true, actorId: "actor-a" }
    );

    assert.equal(refreshCount, 8);
    assert.deepEqual(calls, [
      ["getSnapshot", { actorId: "actor-a" }],
      ["getActionCatalog"],
      ["grantWeeks", { weeks: 2 }],
      ["revokeWeeks", { weeks: 1 }],
      ["clearHistory"],
      ["createRequest", { actorId: "actor-a" }],
      ["setRequestStatus", "downtime-1", "approved", { result: "ok" }],
      ["setRequestChecks", "downtime-1", [{ id: "check-1" }]],
      ["recordCheckResult", "downtime-1", "check-1", { total: 17 }],
      ["closeProject", "downtime-1", { actorId: "actor-a" }]
    ]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule refreshes open actor sheets after downtime mutations", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;
  globalThis.Hooks = {
    once() {}
  };
  const renderCalls = [];
  const emitted = [];
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true
    },
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  };
  globalThis.ui = {
    windows: {
      sheet1: {
        rendered: true,
        actor: {
          id: "actor-a"
        },
        render() {
          renderCalls.push("sheet1");
        }
      },
      closedSheet: {
        rendered: false,
        actor: {
          id: "actor-a"
        },
        render() {
          renderCalls.push("closedSheet");
        }
      }
    }
  };
  globalThis.foundry = {
    applications: {
      instances: new Map([[
        "closedV2",
        {
          rendered: false,
          document: {
            id: "actor-a"
          },
          render() {
            renderCalls.push("closedV2");
          }
        }
      ], [
        "openV2",
        {
          rendered: true,
          document: {
            id: "actor-a",
            type: "character"
          },
          render() {
            renderCalls.push("openV2");
          }
        }
      ]])
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-local-no-sheet-render=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    moduleApi.downtimeService.grantWeeks = async () => ({ actorIds: ["actor-a"] });
    moduleApi.downtimeService.createRequest = async () => ({ id: "downtime-1", actorId: "actor-a" });
    moduleApi.downtimeService.setRequestStatus = async (requestId) => ({ id: requestId, actorId: "actor-a" });
    moduleApi.downtimeService.setRequestChecks = async (requestId) => ({ id: requestId, actorId: "actor-a" });
    moduleApi.downtimeService.recordCheckResult = async (requestId) => ({ id: requestId, actorId: "actor-a" });

    await moduleApi.grantDowntimeWeeks({ actorId: "actor-a", weeks: 1 });
    await moduleApi.createDowntimeRequest({ actorId: "actor-a", weeks: 1 });
    await moduleApi.setDowntimeRequestStatus("downtime-1", "approved");
    await moduleApi.setDowntimeRequestChecks("downtime-1", []);
    await moduleApi.recordDowntimeCheckResult("downtime-1", "check-1", { total: 20 });

    assert.deepEqual([...new Set(renderCalls)].sort(), ["openV2", "sheet1"]);
    assert.equal(renderCalls.includes("closedSheet"), false);
    assert.equal(renderCalls.includes("closedV2"), false);
    assert.equal(emitted.every(([, message]) => message.type === "downtime-updated"), true);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.foundry = previousFoundry;
  }
});

test("RebreyaMainModule rejects setSetting socket messages on the active GM client", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {}
  };
  const settingsStore = {};
  const emitted = [];
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true,
      active: true
    },
    settings: {
      async set(moduleId, key, value, options) {
        settingsStore[`${moduleId}.${key}`] = { value, options };
        return value;
      }
    },
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?set-setting=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let refreshCount = 0;
    let downtimeRefreshCount = 0;
    let coordinatorCalls = 0;
    const originalRun = moduleApi.worldMutationCoordinator.run.bind(moduleApi.worldMutationCoordinator);
    moduleApi.worldMutationCoordinator.run = (key, operation) => {
      coordinatorCalls += 1;
      return originalRun(key, operation);
    };
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };
    moduleApi.refreshDowntimeViews = async () => {
      downtimeRefreshCount += 1;
    };

    await moduleApi.handleSocketMessage({
      type: "downtime-create-result",
      requestId: "downtime-create-result-1",
      forUserId: "gm",
      senderId: "player-1",
      ok: true
    });
    await moduleApi.handleSocketMessage({
      type: "downtime-updated",
      senderId: "player-1",
      actorIds: ["actor-1"]
    });
    const refreshCountBeforeSetting = refreshCount;

    await moduleApi.handleSocketMessage({
      type: "setSetting",
      key: SETTINGS_KEYS.GROUP_STATE,
      data: {
        version: 1,
        groupsById: {}
      },
      options: {
        render: false
      },
      senderId: "player-1",
      requestId: "settings-test-1"
    });

    assert.deepEqual(settingsStore, {});
    assert.equal(refreshCountBeforeSetting, 0);
    assert.equal(refreshCount, refreshCountBeforeSetting);
    assert.equal(downtimeRefreshCount, 1);
    assert.equal(coordinatorCalls, 0);
    assert.deepEqual(emitted, [[
      `module.${MODULE_ID}`,
      {
        type: "setSettingResult",
        requestId: "settings-test-1",
        forUserId: "player-1",
        senderId: "gm",
        ok: false,
        errorCode: "raw-setting-disabled"
      }
    ]]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule registers the module socket listener during setup", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  let setupHandler = null;
  let socketRegistration = null;
  globalThis.Hooks = {
    once() {},
    on(eventName, handler) {
      if (eventName === "setup") {
        setupHandler = handler;
      }
    }
  };
  globalThis.game = {
    socket: {
      on(channel, handler) {
        socketRegistration = {
          channel,
          handler
        };
      }
    }
  };

  try {
    await import(`../scripts/main.js?setup-socket=${Date.now()}`);

    assert.equal(typeof setupHandler, "function");
    setupHandler();
    assert.equal(socketRegistration.channel, `module.${MODULE_ID}`);
    assert.equal(typeof socketRegistration.handler, "function");
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule routes character class socket automation to the paladin service", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {},
    on() {}
  };
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?character-class-socket=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let handled = null;
    moduleApi.paladinAutomationService.handleSocketMessage = async (payload, options) => {
      handled = { payload, options };
      return true;
    };

    await moduleApi.handleSocketMessage({
      type: "character-class-automation",
      payload: {
        action: "paladin.layOnHands",
        amount: 7
      },
      senderId: "player-1"
    });

    assert.deepEqual(handled, {
      payload: {
        action: "paladin.layOnHands",
        amount: 7
      },
      options: {
        senderId: "player-1"
      }
    });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule routes player inventory imports through the active GM", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {},
    on() {}
  };
  const emitted = [];
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true
    },
    socket: {
      emit(channel, message) {
        emitted.push({ channel, message });
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?inventory-import-socket=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let handled = null;
    let refreshCount = 0;
    let inventoryRefreshCount = 0;
    moduleApi.inventoryService.handleImportDroppedItemSocketRequest = async (payload, options) => {
      handled = { payload, options };
      return { id: "group-1" };
    };
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };
    moduleApi.refreshInventoryViews = async () => {
      inventoryRefreshCount += 1;
    };

    await moduleApi.handleSocketMessage({
      type: "inventory-import-request",
      payload: {
        itemUuid: "Actor.member-1.Item.item-1",
        targetActorUuid: "Actor.group-1"
      },
      senderId: "player-1"
    });

    assert.deepEqual(handled, {
      payload: {
        itemUuid: "Actor.member-1.Item.item-1",
        targetActorUuid: "Actor.group-1"
      },
      options: {
        senderId: "player-1"
      }
    });
    assert.equal(refreshCount, 0);
    assert.equal(inventoryRefreshCount, 1);
    assert.deepEqual(emitted, [{
      channel: `module.${MODULE_ID}`,
      message: {
        type: "inventory-import-result",
        forUserId: "player-1",
        senderId: "gm",
        ok: true
      }
    }]);

  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule routes party inventory source depletion through the active GM", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {},
    on() {}
  };
  const emitted = [];
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true
    },
    socket: {
      emit(channel, message) {
        emitted.push({ channel, message });
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?inventory-depletion-socket=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let handled = null;
    let refreshCount = 0;
    moduleApi.inventoryService.handlePartyInventorySourceDepletionSocketRequest = async (payload, options) => {
      handled = { payload, options };
      return { handled: true };
    };
    moduleApi.refreshInventoryViews = async () => {
      refreshCount += 1;
    };

    await moduleApi.handleSocketMessage({
      type: "inventory-source-depletion-request",
      payload: {
        transferId: "party-transfer:source-to-target",
        sourceItemUuid: "Actor.group-1.Item.item-1",
        targetItemUuid: "Actor.member-1.Item.item-1",
        targetActorUuid: "Actor.member-1"
      },
      senderId: "player-1"
    });

    assert.deepEqual(handled, {
      payload: {
        transferId: "party-transfer:source-to-target",
        sourceItemUuid: "Actor.group-1.Item.item-1",
        targetItemUuid: "Actor.member-1.Item.item-1",
        targetActorUuid: "Actor.member-1"
      },
      options: {
        senderId: "player-1"
      }
    });
    assert.equal(refreshCount, 1);
    assert.deepEqual(emitted, [{
      channel: `module.${MODULE_ID}`,
      message: {
        type: "inventory-source-depletion-result",
        forUserId: "player-1",
        senderId: "gm",
        transferId: "party-transfer:source-to-target",
        sourceItemUuid: "Actor.group-1.Item.item-1",
        targetItemUuid: "Actor.member-1.Item.item-1",
        ok: true
      }
    }]);

    moduleApi.inventoryService.handlePartyInventorySourceDepletionSocketRequest = async () => {
      throw new Error("depletion rejected");
    };
    await moduleApi.handleSocketMessage({
      type: "inventory-source-depletion-request",
      payload: {
        transferId: "party-transfer:rejected",
        sourceItemUuid: "Actor.group-1.Item.item-2",
        targetItemUuid: "Actor.member-1.Item.item-2",
        targetActorUuid: "Actor.member-1"
      },
      senderId: "player-1"
    });
    assert.deepEqual(emitted[1], {
      channel: `module.${MODULE_ID}`,
      message: {
        type: "inventory-source-depletion-result",
        forUserId: "player-1",
        senderId: "gm",
        transferId: "party-transfer:rejected",
        sourceItemUuid: "Actor.group-1.Item.item-2",
        targetItemUuid: "Actor.member-1.Item.item-2",
        ok: false,
        error: "depletion rejected"
      }
    });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule routes player downtime creation through the GM socket", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {}
  };
  const emitted = [];
  globalThis.game = {
    user: {
      id: "player-1",
      isGM: false
    },
    users: [
      { id: "player-1", isGM: false, active: true },
      { id: "gm", isGM: true, active: true }
    ],
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-player-socket=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let directCreateCalled = false;
    moduleApi.downtimeService.createRequest = async () => {
      directCreateCalled = true;
      throw new Error("direct create should not be called");
    };

    const queuedRequest = await moduleApi.createDowntimeRequest({
      groupId: "group-a",
      actorId: "actor-a",
      actionId: "unique",
      weeks: 1
    });

    assert.equal(directCreateCalled, false);
    assert.equal(queuedRequest.queued, true);
    assert.equal(queuedRequest.groupId, "group-a");
    assert.equal(queuedRequest.actorId, "actor-a");
    assert.match(queuedRequest.requestId, /^downtime-create-/u);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][0], `module.${MODULE_ID}`);
    assert.equal(emitted[0][1].type, "downtime-create-request");
    assert.equal(emitted[0][1].senderId, "player-1");
    assert.equal(emitted[0][1].payload.groupId, "group-a");
    assert.equal(emitted[0][1].payload.actorId, "actor-a");
    assert.match(emitted[0][1].requestId, /^downtime-create-/u);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule revalidates craft materials and duration before GM request creation", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = { once() {} };
  globalThis.game = {
    user: { id: "gm", isGM: true, active: true },
    users: {
      activeGM: { id: "gm", isGM: true, active: true },
      contents: [{ id: "gm", isGM: true, active: true }]
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-craft-validation=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.craftingService = {
      async previewRequest(payload) {
        calls.push(["previewRequest", payload]);
        return {
          ready: true,
          canSubmit: true,
          requiredWorkdays: 7,
          requiredDowntimeWeeks: 2,
          calendarWeeks: 1,
          dailyProgressGold: 10,
          hoursPerDay: 16,
          ownedWorkshop: true,
          materials: [],
          errors: []
        };
      }
    };
    moduleApi.downtimeService = {
      async createRequest(payload) {
        calls.push(["createRequest", payload]);
        return { id: "downtime-1", actorId: payload.actorId, ...payload };
      }
    };
    moduleApi.refreshDowntimeViews = async () => {};

    const preview = await moduleApi.previewCraftDowntimeRequest({
      groupId: "group-a",
      actorId: "actor-a",
      craftProject: { outputs: [] }
    });
    assert.equal(preview.requiredWorkdays, 7);

    await moduleApi.createDowntimeRequest({
      groupId: "group-a",
      actorId: "actor-a",
      actionId: "craft",
      weeks: 99,
      craftProject: {
        outputs: [{ sourceType: "gear", sourceId: "longsword", quantity: 1 }],
        hoursPerDay: 16,
        ownedWorkshop: true
      }
    });

    const createdPayload = calls.find((call) => call[0] === "createRequest")[1];
    assert.equal(createdPayload.weeks, 2);
    assert.equal(createdPayload.craftProject.requiredWorkdays, 7);
    assert.equal(createdPayload.craftProject.requiredDowntimeWeeks, 2);
    assert.equal(createdPayload.craftProject.dailyProgressGold, 10);

    moduleApi.craftingService.previewRequest = async () => ({
      ready: true,
      canSubmit: false,
      errors: [{ code: "insufficient-materials", message: "Not enough materials." }]
    });
    await assert.rejects(
      moduleApi.createDowntimeRequest({
        groupId: "group-a",
        actorId: "actor-a",
        actionId: "craft",
        craftProject: { outputs: [{ sourceType: "gear", sourceId: "longsword", quantity: 1 }] }
      }),
      /material/i
    );
    assert.equal(calls.filter((call) => call[0] === "createRequest").length, 1);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule routes player downtime check results through the GM socket", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {}
  };
  const emitted = [];
  globalThis.game = {
    user: {
      id: "player-1",
      isGM: false
    },
    users: [
      { id: "player-1", isGM: false, active: true },
      { id: "gm", isGM: true, active: true }
    ],
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-check-player-socket=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let directRecordCalled = false;
    moduleApi.downtimeService.recordCheckResult = async () => {
      directRecordCalled = true;
      throw new Error("direct record should not be called");
    };

    const queuedResult = await moduleApi.recordDowntimeCheckResult("downtime-1", "check-1", {
      total: 18,
      success: true
    }, {
      groupId: "group-a",
      actorId: "actor-a"
    });

    assert.equal(directRecordCalled, false);
    assert.equal(queuedResult.queued, true);
    assert.equal(queuedResult.requestId, "downtime-1");
    assert.equal(queuedResult.checkId, "check-1");
    assert.match(queuedResult.socketRequestId, /^downtime-check-result-/u);
    assert.deepEqual(emitted, [[
      `module.${MODULE_ID}`,
      {
        type: "downtime-check-result-request",
        requestId: queuedResult.socketRequestId,
        senderId: "player-1",
        payload: {
          groupId: "group-a",
          actorId: "actor-a",
          requestId: "downtime-1",
          checkId: "check-1",
          result: {
            total: 18,
            success: true
          }
        }
      }
    ]]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule refreshes open actor sheets on downtime updates", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;
  globalThis.Hooks = {
    once() {}
  };
  const renderCalls = [];
  globalThis.game = {
    user: {
      id: "player-1",
      isGM: false
    }
  };
  globalThis.ui = {
    windows: {
      openSheet: {
        rendered: true,
        actor: {
          id: "actor-a"
        },
        render(options) {
          renderCalls.push(["openSheet", options]);
        }
      },
      closedSheet: {
        rendered: false,
        actor: {
          id: "actor-a"
        },
        render() {
          renderCalls.push("closedSheet");
        }
      }
    }
  };
  globalThis.foundry = {
    applications: {
      instances: new Map([[
        "closedV2",
        {
          rendered: false,
          document: {
            id: "actor-a"
          },
          render() {
            renderCalls.push("closedV2");
          }
        }
      ], [
        "openV2",
        {
          rendered: true,
          document: {
            id: "actor-a",
            type: "character"
          },
          render(options) {
            renderCalls.push(["openV2", options]);
          }
        }
      ]])
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-quiet-actor-refresh=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();

    await moduleApi.handleSocketMessage({
      type: "downtime-updated",
      senderId: "gm",
      actorIds: ["actor-a"],
      requestId: "downtime-1"
    });

    assert.deepEqual(renderCalls.map((call) => call[0]).sort(), ["openSheet", "openV2"]);
    assert.deepEqual(renderCalls.map((call) => call[1]), [
      { force: true, focus: false },
      { force: true, focus: false }
    ]);
    assert.equal(renderCalls.some((call) => call[0] === "closedSheet"), false);
    assert.equal(renderCalls.some((call) => call[0] === "closedV2"), false);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.foundry = previousFoundry;
  }
});

test("RebreyaMainModule does not render player sheets when GM reports downtime creation", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  globalThis.Hooks = {
    once() {}
  };
  let refreshCount = 0;
  let renderCount = 0;
  globalThis.game = {
    user: {
      id: "player-1",
      isGM: false
    },
    users: [
      { id: "player-1", isGM: false, active: true },
      { id: "gm", isGM: true, active: true }
    ],
    socket: {
      emit() {}
    }
  };
  globalThis.ui = {
    windows: {
      sheet1: {
        rendered: true,
        actor: {
          id: "actor-a"
        },
        render() {
          renderCount += 1;
        }
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-player-result=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };

    await moduleApi.handleSocketMessage({
      type: "downtime-create-result",
      requestId: "downtime-create-test-result",
      forUserId: "player-1",
      senderId: "gm",
      ok: true,
      data: {
        id: "downtime-1",
        actorId: "actor-a"
      }
    });

    assert.equal(refreshCount, 0);
    assert.equal(renderCount, 0);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
  }
});

test("RebreyaMainModule renders only the affected player sheet when downtime is updated", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  globalThis.Hooks = {
    once() {}
  };
  let refreshCount = 0;
  let renderCount = 0;
  globalThis.game = {
    user: {
      id: "player-1",
      isGM: false
    },
    users: [
      { id: "player-1", isGM: false, active: true },
      { id: "gm", isGM: true, active: true }
    ],
    socket: {
      emit() {}
    }
  };
  globalThis.ui = {
    windows: {
      sheet1: {
        rendered: true,
        actor: {
          id: "actor-a"
        },
        render() {
          renderCount += 1;
        }
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-player-update=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };

    await moduleApi.handleSocketMessage({
      type: "downtime-updated",
      senderId: "gm",
      actorIds: ["actor-a"],
      requestId: "downtime-1"
    });

    assert.equal(refreshCount, 0);
    assert.equal(renderCount, 1);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
  }
});

test("RebreyaMainModule notifies players when a GM changes downtime request status", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {}
  };
  const emitted = [];
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true
    },
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-gm-update=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let refreshCount = 0;
    moduleApi.refreshDowntimeViews = async () => {
      refreshCount += 1;
    };
    moduleApi.downtimeService.setRequestStatus = async (requestId, status, options) => ({
      id: requestId,
      actorId: "actor-a",
      status,
      result: options.result
    });

    const result = await moduleApi.setDowntimeRequestStatus("downtime-1", "approved", { result: "ok" });

    assert.deepEqual(result, {
      id: "downtime-1",
      actorId: "actor-a",
      status: "approved",
      result: "ok"
    });
    assert.equal(refreshCount, 1);
    assert.deepEqual(emitted, [[
      `module.${MODULE_ID}`,
      {
        type: "downtime-updated",
        senderId: "gm",
        actorIds: ["actor-a"],
        requestId: "downtime-1"
      }
    ]]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule GM records socket downtime check results for owned actors", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {}
  };
  const emitted = [];
  const playerUser = { id: "player-1", isGM: false, active: true };
  const actor = {
    id: "actor-a",
    name: "Hero A",
    type: "character",
    testUserPermission(user, permission) {
      return permission === "OWNER" && user?.id === "player-1";
    }
  };
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true,
      active: true
    },
    users: [
      playerUser,
      { id: "gm", isGM: true, active: true }
    ],
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-check-gm-socket=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const recordCalls = [];
    moduleApi.groupContextService.resolveForGroup = (groupActorId) => {
      assert.equal(groupActorId, "group-a");
      return {
        groupId: "group-a",
        members: [actor],
        memberActorIds: ["actor-a"]
      };
    };
    moduleApi.downtimeService.recordCheckResult = async (requestId, checkId, result) => {
      recordCalls.push([requestId, checkId, result]);
      return {
        id: requestId,
        actorId: "actor-a",
        checks: [{
          id: checkId,
          result
        }]
      };
    };
    moduleApi.refreshOpenApps = async () => {
      throw new Error("socket check results should not activate inventory windows");
    };

    await moduleApi.handleSocketMessage({
      type: "downtime-check-result-request",
      requestId: "downtime-check-result-test-1",
      senderId: "player-1",
      payload: {
        groupId: "group-a",
        actorId: "actor-a",
        requestId: "downtime-1",
        checkId: "check-1",
        result: {
          total: 18,
          success: true
        }
      }
    });

    assert.deepEqual(recordCalls, [["downtime-1", "check-1", {
      total: 18,
      success: true,
      recordedByUserId: "player-1"
    }]]);
    assert.deepEqual(emitted, [[
      `module.${MODULE_ID}`,
      {
        type: "downtime-check-result-result",
        requestId: "downtime-check-result-test-1",
        forUserId: "player-1",
        senderId: "gm",
        ok: true,
        data: {
          id: "downtime-1",
          actorId: "actor-a",
          checks: [{
            id: "check-1",
            result: {
              total: 18,
              success: true,
              recordedByUserId: "player-1"
            }
          }]
        }
      }
    ], [
      `module.${MODULE_ID}`,
      {
        type: "downtime-updated",
        senderId: "gm",
        actorIds: ["actor-a"],
        requestId: "downtime-1"
      }
    ]]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule broadcasts committed socket downtime creation even when local refresh fails", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousConsoleError = console.error;
  globalThis.Hooks = {
    once() {}
  };
  console.error = () => {};
  const emitted = [];
  let renderCount = 0;
  const playerUser = { id: "player-1", isGM: false, active: true };
  const actor = {
    id: "actor-a",
    name: "Hero A",
    type: "character",
    testUserPermission(user, permission) {
      return permission === "OWNER" && user?.id === "player-1";
    }
  };
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true,
      active: true
    },
    users: [
      playerUser,
      { id: "gm", isGM: true, active: true }
    ],
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  };
  globalThis.ui = {
    windows: {
      sheet1: {
        rendered: true,
        actor: {
          id: "actor-a"
        },
        render() {
          renderCount += 1;
        }
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-gm-socket=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const createCalls = [];
    let refreshCount = 0;
    moduleApi.groupContextService.resolveForGroup = (groupActorId) => {
      assert.equal(groupActorId, "group-a");
      return {
        groupId: "group-a",
        members: [actor],
        memberActorIds: ["actor-a"]
      };
    };
    moduleApi.downtimeService.createRequest = async (payload) => {
      createCalls.push(payload);
      return {
        id: "downtime-7",
        actorId: payload.actorId,
        submittedByUserId: payload.submittedByUserId
      };
    };
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };
    moduleApi.refreshDowntimeViews = async () => {
      throw new Error("render failed");
    };

    await moduleApi.handleSocketMessage({
      type: "downtime-create-request",
      requestId: "downtime-create-test-1",
      senderId: "player-1",
      payload: {
        groupId: "group-a",
        actorId: "actor-a",
        actionId: "training",
        weeks: 1
      }
    });

    assert.equal(refreshCount, 0);
    assert.equal(renderCount, 0);
    assert.deepEqual(createCalls, [{
      groupId: "group-a",
      actorId: "actor-a",
      actionId: "training",
      weeks: 1,
      submittedByUserId: "player-1"
    }]);
    assert.deepEqual(emitted, [[
      `module.${MODULE_ID}`,
      {
        type: "downtime-create-result",
        requestId: "downtime-create-test-1",
        forUserId: "player-1",
        senderId: "gm",
        ok: true,
        data: {
          id: "downtime-7",
          actorId: "actor-a",
          submittedByUserId: "player-1"
        }
      }
    ], [
      `module.${MODULE_ID}`,
      {
        type: "downtime-updated",
        senderId: "gm",
        actorIds: ["actor-a"],
        requestId: "downtime-7"
      }
    ]]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    console.error = previousConsoleError;
  }
});

test("RebreyaMainModule GM rejects socket downtime requests for unowned actors", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {}
  };
  const emitted = [];
  const actor = {
    id: "actor-a",
    name: "Hero A",
    type: "character",
    testUserPermission() {
      return false;
    }
  };
  globalThis.game = {
    user: {
      id: "gm",
      isGM: true,
      active: true
    },
    users: [
      { id: "player-1", isGM: false, active: true },
      { id: "gm", isGM: true, active: true }
    ],
    socket: {
      emit(channel, message) {
        emitted.push([channel, message]);
      }
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-gm-reject=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    moduleApi.groupContextService.resolveForGroup = () => ({
      groupId: "group-a",
      members: [actor],
      memberActorIds: ["actor-a"]
    });
    moduleApi.downtimeService.createRequest = async () => {
      throw new Error("request should not be created");
    };

    await moduleApi.handleSocketMessage({
      type: "downtime-create-request",
      requestId: "downtime-create-test-2",
      senderId: "player-1",
      payload: {
        groupId: "group-a",
        actorId: "actor-a",
        weeks: 1
      }
    });

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][0], `module.${MODULE_ID}`);
    assert.equal(emitted[0][1].type, "downtime-create-result");
    assert.equal(emitted[0][1].requestId, "downtime-create-test-2");
    assert.equal(emitted[0][1].forUserId, "player-1");
    assert.equal(emitted[0][1].ok, false);
    assert.match(emitted[0][1].error, /своего персонажа/u);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule only lets the active GM execute legacy world mutations", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {}
  };

  const electedGm = { id: "gm-a", isGM: true, active: true };
  const otherGm = { id: "gm-b", isGM: true, active: true };
  const player = { id: "player-1", isGM: false, active: true };
  const cases = [
    {
      name: "elected GM in a multi-user world",
      user: electedGm,
      users: [otherGm, player, electedGm],
      expectedCalls: 1
    },
    {
      name: "elected GM in a generic iterable users collection",
      user: electedGm,
      users: {
        *[Symbol.iterator]() {
          yield player;
          yield otherGm;
          yield electedGm;
        }
      },
      expectedCalls: 1
    },
    {
      name: "non-elected GM in a multi-user world",
      user: otherGm,
      users: [otherGm, player, electedGm],
      expectedCalls: 0
    },
    {
      name: "current active GM with an empty users collection",
      user: { id: "gm-missing", isGM: true, active: true },
      users: [],
      expectedCalls: 0
    },
    {
      name: "current active GM with only a stale inactive collection entry",
      user: { id: "gm-stale", isGM: true, active: true },
      users: [{ id: "gm-stale", isGM: true, active: false }],
      expectedCalls: 0
    },
    {
      name: "sole GM in a legacy harness without game.users",
      user: { id: "gm-only", isGM: true },
      expectedCalls: 1
    },
    {
      name: "explicitly inactive sole GM in a legacy harness",
      user: { id: "gm-inactive", isGM: true, active: false },
      expectedCalls: 0
    }
  ];

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?legacy-active-gm-gate=${Date.now()}`);
    for (const scenario of cases) {
      globalThis.game = {
        user: scenario.user,
        ...(scenario.users ? { users: scenario.users } : {}),
        socket: {
          emit() {}
        }
      };
      const moduleApi = new RebreyaMainModule();
      let calls = 0;
      let coordinatorCalls = 0;
      const originalRun = moduleApi.worldMutationCoordinator.run.bind(moduleApi.worldMutationCoordinator);
      moduleApi.worldMutationCoordinator.run = (key, operation) => {
        coordinatorCalls += 1;
        return originalRun(key, operation);
      };
      moduleApi.raceAutomationService.handleSocketMessage = async () => {
        calls += 1;
      };

      await moduleApi.handleSocketMessage({
        type: "race-automation",
        senderId: "player-1",
        payload: {}
      });

      assert.equal(calls, scenario.expectedCalls, scenario.name);
      assert.equal(coordinatorCalls, scenario.expectedCalls, `${scenario.name}: coordinator`);
    }
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule routes the exact legacy mutation allowlist through the world coordinator", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {}
  };
  const emitted = [];
  const player = { id: "player-1", isGM: false, active: true };
  const actor = {
    id: "actor-1",
    type: "character",
    testUserPermission(user, permission) {
      return permission === "OWNER" && user?.id === player.id;
    }
  };
  globalThis.game = {
    user: { id: "gm", isGM: true, active: true },
    users: [
      player,
      { id: "gm", isGM: true, active: true }
    ],
    socket: {
      emit(channel, message) {
        emitted.push({ channel, message });
      }
    }
  };

  const mutationMessages = [
    {
      type: "downtime-create-request",
      requestId: "socket-create",
      payload: { groupId: "group-1", actorId: actor.id, actionId: "training", weeks: 1 }
    },
    {
      type: "downtime-update-request",
      requestId: "socket-update",
      payload: { groupId: "group-1", actorId: actor.id, requestId: "downtime-1", weeks: 2 }
    },
    {
      type: "downtime-check-result-request",
      requestId: "socket-check",
      payload: {
        groupId: "group-1",
        actorId: actor.id,
        requestId: "downtime-1",
        checkId: "check-1",
        result: { total: 18 }
      }
    },
    {
      type: "downtime-project-continue-request",
      requestId: "socket-continue",
      payload: {
        groupId: "group-1",
        actorId: actor.id,
        requestId: "downtime-1",
        checkId: "check-1",
        result: { total: 16 }
      }
    },
    {
      type: "downtime-project-close-request",
      requestId: "socket-close",
      payload: { groupId: "group-1", actorId: actor.id, requestId: "downtime-1" }
    },
    {
      type: "travel-map-sync-request",
      groupActorId: "group-1",
      position: { available: true, x: 10, y: 20 }
    },
    { type: "race-automation", payload: { action: "race" } },
    { type: "character-class-automation", payload: { action: "class" } },
    { type: "inventory-import-request", payload: { itemUuid: "Item.source" } },
    { type: "inventory-source-depletion-request", payload: { itemUuid: "Item.source" } },
    { type: "inventory-item-action-request", payload: { action: "take", itemId: "item-1" } },
    { type: "trader-audit", payload: { action: "purchase" } },
    { type: "lootgen-claim-row", payload: { lootId: "loot-1", rowId: "row-1" } },
    { type: "lootgen-claim-coins", payload: { lootId: "loot-1" } }
  ];

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?legacy-mutation-allowlist=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const coordinatorKeys = [];
    const effects = [];
    let openRefreshes = 0;
    let inventoryRefreshes = 0;
    const originalRun = moduleApi.worldMutationCoordinator.run.bind(moduleApi.worldMutationCoordinator);
    moduleApi.worldMutationCoordinator.run = (key, operation) => {
      coordinatorKeys.push(key);
      return originalRun(key, operation);
    };
    moduleApi.groupContextService.resolveForGroup = () => ({
      groupId: "group-1",
      groupActor: { id: "group-1" },
      members: [actor],
      memberActorIds: [actor.id]
    });
    moduleApi.downtimeService.createRequest = async () => {
      effects.push("downtime-create-request");
      return { id: "downtime-created", actorId: actor.id };
    };
    moduleApi.downtimeService.updateRequest = async () => {
      effects.push("downtime-update-request");
      return { id: "downtime-updated", actorId: actor.id };
    };
    moduleApi.downtimeService.recordCheckResult = async () => {
      effects.push("downtime-check-result-request");
      return { id: "downtime-checked", actorId: actor.id };
    };
    moduleApi.downtimeService.continueProject = async () => {
      effects.push("downtime-project-continue-request");
      return { id: "downtime-continued", actorId: actor.id };
    };
    moduleApi.downtimeService.closeProject = async () => {
      effects.push("downtime-project-close-request");
      return { id: "downtime-closed", actorId: actor.id };
    };
    moduleApi.travelMapService.syncGroupToken = async () => {
      effects.push("travel-map-sync-request");
    };
    moduleApi.raceAutomationService.handleSocketMessage = async () => {
      effects.push("race-automation");
    };
    moduleApi.paladinAutomationService.handleSocketMessage = async () => {
      effects.push("character-class-automation");
    };
    moduleApi.inventoryService.handleImportDroppedItemSocketRequest = async () => {
      effects.push("inventory-import-request");
      return { id: "inventory-imported" };
    };
    moduleApi.inventoryService.handlePartyInventorySourceDepletionSocketRequest = async () => {
      effects.push("inventory-source-depletion-request");
      return { id: "inventory-depleted" };
    };
    moduleApi.inventoryService.handleInventoryItemActionSocketRequest = async () => {
      effects.push("inventory-item-action-request");
      return { id: "inventory-actioned", actorId: actor.id };
    };
    moduleApi.traderService.recordTradeAudit = async () => {
      effects.push("trader-audit");
    };
    moduleApi.claimLootgenChatRow = async () => {
      effects.push("lootgen-claim-row");
    };
    moduleApi.claimLootgenChatCoins = async () => {
      effects.push("lootgen-claim-coins");
    };
    moduleApi.refreshOpenApps = async () => {
      openRefreshes += 1;
    };
    moduleApi.refreshInventoryViews = async () => {
      inventoryRefreshes += 1;
    };

    for (const message of mutationMessages) {
      await moduleApi.handleSocketMessage({
        ...message,
        senderId: player.id
      });
    }

    const mutationTypes = mutationMessages.map(({ type }) => type);
    const responseTypes = emitted.map(({ message }) => message.type);
    assert.deepEqual(coordinatorKeys, mutationTypes.map(() => "world"));
    assert.deepEqual(effects, mutationTypes);
    assert.equal(openRefreshes, 1);
    assert.equal(inventoryRefreshes, 3);
    for (const responseType of [
      "downtime-create-result",
      "downtime-update-result",
      "downtime-check-result-result",
      "downtime-project-continue-result",
      "downtime-project-close-result",
      "inventory-import-result",
      "inventory-source-depletion-result",
      "inventory-item-action-result"
    ]) {
      assert.equal(responseTypes.includes(responseType), true, responseType);
    }
    assert.equal(responseTypes.filter((type) => type === "downtime-updated").length, 5);
    assert.equal(
      emitted.find(({ message }) => message.type === "inventory-item-action-result")?.message?.actorId,
      actor.id
    );
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule serializes concurrent legacy world mutation requests", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {}
  };
  globalThis.game = {
    user: { id: "gm", isGM: true, active: true },
    users: [
      { id: "player-1", isGM: false, active: true },
      { id: "gm", isGM: true, active: true }
    ],
    socket: {
      emit() {}
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?legacy-mutation-serialization=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const releases = [];
    const started = [];
    let inFlight = 0;
    let maxInFlight = 0;
    moduleApi.raceAutomationService.handleSocketMessage = async (payload) => {
      started.push(payload.id);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => {
        releases.push(resolve);
      });
      inFlight -= 1;
    };

    const first = moduleApi.handleSocketMessage({
      type: "race-automation",
      senderId: "player-1",
      payload: { id: "first" }
    });
    const second = moduleApi.handleSocketMessage({
      type: "race-automation",
      senderId: "player-1",
      payload: { id: "second" }
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(started, ["first"]);
    assert.equal(maxInFlight, 1);
    releases.shift()();
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ["first", "second"]);
    releases.shift()();
    await second;
    assert.equal(maxInFlight, 1);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule propagates a failed legacy mutation without poisoning the queue", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = {
    once() {}
  };
  globalThis.game = {
    user: { id: "gm", isGM: true, active: true },
    users: [
      { id: "player-1", isGM: false, active: true },
      { id: "gm", isGM: true, active: true }
    ],
    socket: {
      emit() {}
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?legacy-mutation-failure=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const expectedError = new Error("legacy mutation failed");
    let releaseFirst;
    let secondStarted = false;
    moduleApi.raceAutomationService.handleSocketMessage = async (payload) => {
      if (payload.id === "first") {
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
        throw expectedError;
      }
      secondStarted = true;
    };

    const first = moduleApi.handleSocketMessage({
      type: "race-automation",
      senderId: "player-1",
      payload: { id: "first" }
    });
    const second = moduleApi.handleSocketMessage({
      type: "race-automation",
      senderId: "player-1",
      payload: { id: "second" }
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(secondStarted, false);
    releaseFirst();
    await assert.rejects(first, (error) => error === expectedError);
    await second;
    assert.equal(secondStarted, true);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RebreyaMainModule caches lootgen socket results without opening player viewer windows", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  globalThis.Hooks = {
    once() {}
  };
  globalThis.game = {
    user: { id: "gm", isGM: true, active: true },
    users: [
      { id: "player-1", isGM: false, active: true },
      { id: "gm", isGM: true, active: true }
    ],
    socket: {
      emit() {}
    }
  };
  globalThis.foundry = {
    utils: {
      deepClone: clone
    }
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?legacy-display-bypass=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let releaseMutation;
    let displayCount = 0;
    moduleApi.raceAutomationService.handleSocketMessage = async () => {
      await new Promise((resolve) => {
        releaseMutation = resolve;
      });
    };
    moduleApi.openLootgenApp = async () => {
      displayCount += 1;
    };

    const mutation = moduleApi.handleSocketMessage({
      type: "race-automation",
      senderId: "player-1",
      payload: {}
    });
    await new Promise((resolve) => setImmediate(resolve));
    await moduleApi.handleSocketMessage({
      type: "lootgen-show-result",
      senderId: "player-1",
      payload: { rows: [], generatedAt: "now" }
    });

    assert.equal(displayCount, 0);
    assert.deepEqual(moduleApi.latestLootgenResult, { rows: [], generatedAt: "now" });
    releaseMutation();
    await mutation;
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.foundry = previousFoundry;
  }
});
