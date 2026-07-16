import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import {
  CraftingService,
  normalizeCraftStateV2
} from "../scripts/data/crafting-service.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function installFoundryUtils() {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    utils: {
      deepClone: clone,
      getProperty: (source, path) => String(path ?? "").split(".").reduce((current, part) => current?.[part], source),
      mergeObject: (target, source) => ({ ...target, ...source }),
      setProperty: (source, path, value) => {
        const parts = String(path ?? "").split(".");
        let cursor = source;
        for (const [index, part] of parts.entries()) {
          if (index === parts.length - 1) {
            cursor[part] = value;
            return;
          }
          cursor[part] ??= {};
          cursor = cursor[part];
        }
      }
    }
  };
  return () => {
    globalThis.foundry = previousFoundry;
  };
}

function createActor(id, name = id) {
  return {
    id,
    name,
    type: "character",
    isOwner: true,
    items: { contents: [], get: () => null }
  };
}

function createCraftModel({ priceGold = 10 } = {}) {
  const predominant = {
    id: "iron",
    name: "Iron",
    priceGold: 10,
    weight: 1
  };
  const baseRaw = {
    id: "smith-base-raw",
    name: "Базовое сырье для Инструменты Кузнеца",
    priceGold: 1,
    weight: 0.1,
    applications: {
      crafting: "Создание и ремонт инструментов: Кузнеца"
    }
  };
  const gear = {
    id: "iron-gear",
    name: "Iron Gear",
    linkedTool: "Кузнеца",
    predominantMaterialId: predominant.id,
    priceGoldEquivalent: priceGold,
    weight: 0.1,
    rank: 1
  };
  return {
    materials: [predominant, baseRaw],
    materialById: new Map([
      [predominant.id, predominant],
      [baseRaw.id, baseRaw]
    ]),
    gear: [gear],
    gearById: new Map([[gear.id, gear]])
  };
}

function buildV2Project(overrides = {}) {
  return {
    id: "craft-project-1",
    groupId: "group-1",
    requestId: "request-1",
    crafterActorId: "crafter",
    status: "approved",
    operationalStatus: "paused",
    profile: "mundane",
    outputs: [{
      sourceType: "gear",
      sourceId: "iron-gear",
      name: "Iron Gear",
      quantity: 1,
      unitPriceGold: 10,
      unitWeightLb: 0.1
    }],
    targetGold: 10,
    progressGold: 0,
    hoursPerDay: 8,
    ownedWorkshop: false,
    workdaySelection: {
      hoursPerDay: 8,
      isoWeekdays: [1, 2, 3, 4, 5]
    },
    requiredRank: 1,
    requiredToolId: "smith",
    requiredToolRank: 1,
    workshopApproval: {
      confirmedByUserId: "gm",
      confirmedAt: 100
    },
    reservation: {
      predominantMaterialId: "iron",
      predominantMaterialLbReserved: 0.1,
      predominantMaterialLbSpent: 0,
      baseRawMaterialId: "smith-base-raw",
      baseRawQuantityReserved: 4,
      baseRawQuantitySpent: 0,
      baseRawWeightLbReserved: 0.4,
      baseRawWeightLbSpent: 0,
      receipts: []
    },
    processedWorkdays: [],
    revision: 1,
    audit: [],
    reconciliation: { required: false },
    createdAt: 100,
    updatedAt: 100,
    completedAt: null,
    ...clone(overrides)
  };
}

function buildSubmittedCraftRequest(overrides = {}) {
  return {
    id: "request-1",
    actorId: "crafter",
    status: "submitted",
    craftProject: {
      outputs: [{ sourceType: "gear", sourceId: "iron-gear", quantity: 1 }],
      hoursPerDay: 8,
      ownedWorkshop: false,
      predominantMaterialId: "iron"
    },
    ...clone(overrides)
  };
}

function installFixture({
  craftState = {},
  legacyCraftState = {},
  downtimeRequests = [buildSubmittedCraftRequest()],
  model = createCraftModel(),
  groupId = "group-1",
  worldGroupIds = [groupId],
  sharedSettingsStore = null,
  activeGmId = "gm",
  worldMutationCoordinator = null,
  beforeLegacyClaimWrite = null,
  onGroupStatePersist = null,
  loseOutputResponseOnce = false,
  failCompletionCheckpointOnce = false,
  loseLegacyClaimResponseOnce = false,
  failCancellationPersistBeforeWriteOnce = false,
  loseReleaseResponseOnce = false,
  onInventoryOperation = null,
  materialAvailability = null
} = {}) {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const crafter = createActor("crafter", "Crafter");
  const groupActors = [...new Set(worldGroupIds)].map((id) => ({
    id,
    name: `Party ${id}`,
    type: "group"
  }));
  const groupActor = groupActors.find((actor) => actor.id === groupId)
    ?? { id: groupId, name: "Party", type: "group" };
  const settingsStore = sharedSettingsStore ?? {
    [SETTINGS_KEYS.CRAFT_STATE]: clone(legacyCraftState),
    [SETTINGS_KEYS.CRAFT_MUTATION_JOURNAL]: {}
  };
  const groupStore = {
    version: 1,
    groupActorId: groupActor.id,
    craftState: clone(craftState),
    downtimeState: {
      requests: clone(downtimeRequests),
      scheduleSlots: []
    }
  };
  const calls = {
    reserve: [],
    spend: [],
    release: [],
    output: [],
    outputEffects: 0,
    settings: []
  };
  const applied = {
    reserve: new Map(),
    spend: new Map(),
    release: new Map(),
    output: new Map()
  };
  let outputResponseLost = false;
  let completionCheckpointFailed = false;
  let legacyClaimResponseLost = false;
  let cancellationPersistFailed = false;
  let releaseResponseLost = false;
  const currentUser = { id: "gm", isGM: true, active: true };
  const activeGm = activeGmId === currentUser.id
    ? currentUser
    : { id: activeGmId, isGM: true, active: true };
  const users = {
    activeGM: activeGm,
    contents: activeGm === currentUser ? [currentUser] : [currentUser, activeGm]
  };
  let currentGroupId = groupId;

  globalThis.game = {
    user: currentUser,
    users,
    actors: {
      contents: [...groupActors, crafter],
      get: (actorId) => [...groupActors, crafter].find((actor) => actor.id === actorId) ?? null
    },
    settings: {
      get: (moduleId, key) => moduleId === MODULE_ID ? clone(settingsStore[key]) : undefined,
      set: async (moduleId, key, value) => {
        if (moduleId === MODULE_ID) {
          const legacyClaimWrite = key === SETTINGS_KEYS.CRAFT_STATE
            && value?.migrationClaim?.groupId;
          if (legacyClaimWrite && typeof beforeLegacyClaimWrite === "function") {
            await beforeLegacyClaimWrite(value);
          }
          const completionCheckpoint = key === SETTINGS_KEYS.CRAFT_MUTATION_JOURNAL
            && value?.records?.some((record) => (
              record.id === "workday-2" && record.phase === "completion-persisted"
            ));
          if (failCompletionCheckpointOnce && completionCheckpoint && !completionCheckpointFailed) {
            completionCheckpointFailed = true;
            throw new Error("craft journal unavailable");
          }
          settingsStore[key] = clone(value);
          calls.settings.push({ key, value: clone(value) });
          if (loseLegacyClaimResponseOnce && legacyClaimWrite && !legacyClaimResponseLost) {
            legacyClaimResponseLost = true;
            throw new Error("lost legacy migration claim response");
          }
        }
        return value;
      }
    }
  };

  const groupContextService = {
    resolveForCurrentUser() {
      const currentGroupActor = groupActors.find((actor) => actor.id === currentGroupId)
        ?? { id: currentGroupId, name: `Party ${currentGroupId}`, type: "group" };
      return {
        groupActor: currentGroupActor,
        groupId: currentGroupId,
        groupState: clone(groupStore),
        members: [crafter],
        memberActorIds: [crafter.id],
        canManage: true
      };
    },
    resolveForGroup(requestedGroupId) {
      if (requestedGroupId !== groupId) {
        return null;
      }
      return {
        groupActor,
        groupId,
        groupState: clone(groupStore),
        members: [crafter],
        memberActorIds: [crafter.id],
        canManage: true
      };
    },
    async mutateGroupState(groupId, mutator) {
      assert.equal(groupId, groupActor.id);
      const draft = clone(groupStore);
      const result = await mutator(draft);
      const cancellationWrite = draft.craftState?.projects?.some((project) => (
        project.status === "cancelled"
      ));
      if (
        failCancellationPersistBeforeWriteOnce
        && cancellationWrite
        && !cancellationPersistFailed
      ) {
        cancellationPersistFailed = true;
        throw new Error("craft project persistence unavailable");
      }
      Object.keys(groupStore).forEach((key) => delete groupStore[key]);
      Object.assign(groupStore, clone(draft));
      if (typeof onGroupStatePersist === "function") {
        await onGroupStatePersist({ groupStore, result });
      }
      return clone(result);
    }
  };

  function rememberOnce(kind, mutationId, value) {
    if (!applied[kind].has(mutationId)) {
      applied[kind].set(mutationId, clone(value));
    }
    return clone(applied[kind].get(mutationId));
  }

  const inventoryService = {
    canManagePartyInventory: () => true,
    resolveRebreyaToolId: (value) => value === "Кузнеца" || value === "smith" ? "smith" : "",
    getRebreyaToolLabel: (value) => value === "smith" ? "Кузнеца" : "",
    resolveMemberToolAccess: async (actorId, toolId) => (
      actorId === crafter.id && toolId === "smith"
        ? { rank: 1, source: "manual", itemUuid: "" }
        : null
    ),
    async getCraftResourceAvailability(request) {
      if (materialAvailability) {
        return clone(materialAvailability);
      }
      return {
        sufficient: true,
        inventoryActorId: groupActor.id,
        rows: [{
          sourceId: request.predominantMaterialId,
          required: request.predominantMaterialLbReserved,
          available: request.predominantMaterialLbReserved,
          sufficient: true,
          components: [{
            resource: "predominant",
            sourceId: request.predominantMaterialId,
            quantity: request.predominantMaterialLbReserved
          }]
        }, {
          sourceId: request.baseRawMaterialId,
          required: request.baseRawQuantityReserved,
          available: request.baseRawQuantityReserved,
          sufficient: true,
          components: [{
            resource: "baseRaw",
            sourceId: request.baseRawMaterialId,
            quantity: request.baseRawQuantityReserved
          }]
        }].filter((row) => row.required > 0)
      };
    },
    async reserveCraftResourcesOnce(quote, mutationId, options) {
      calls.reserve.push({ quote: clone(quote), mutationId, options });
      await onInventoryOperation?.("reserve", options);
      return rememberOnce("reserve", mutationId, [
        { resource: "predominant", sourceId: quote.predominantMaterialId, delta: quote.predominantMaterialLb },
        { resource: "baseRaw", sourceId: quote.baseRawMaterialId, delta: quote.baseRawQuantity }
      ]);
    },
    async spendCraftReservationOnce(projectId, spend, mutationId, options) {
      calls.spend.push({ projectId, spend: clone(spend), mutationId, options });
      await onInventoryOperation?.("spend", options);
      return rememberOnce("spend", mutationId, { projectId, ...clone(spend) });
    },
    async releaseCraftReservationOnce(projectId, remaining, mutationId, options) {
      calls.release.push({ projectId, remaining: clone(remaining), mutationId, options });
      await onInventoryOperation?.("release", options);
      const wasApplied = applied.release.has(mutationId);
      const result = rememberOnce("release", mutationId, [clone(remaining)]);
      if (!wasApplied) {
        calls.releaseEffects = (calls.releaseEffects ?? 0) + 1;
      }
      if (loseReleaseResponseOnce && !releaseResponseLost) {
        releaseResponseLost = true;
        throw new Error("lost release response");
      }
      return result;
    },
    async createCraftOutputsOnce(outputs, mutationId, options) {
      calls.output.push({ outputs: clone(outputs), mutationId, options });
      await onInventoryOperation?.("output", options);
      if (!applied.output.has(mutationId)) {
        applied.output.set(mutationId, [{ id: "crafted-item-1", uuid: "Actor.group-1.Item.crafted-item-1" }]);
        calls.outputEffects += 1;
      }
      if (loseOutputResponseOnce && !outputResponseLost) {
        outputResponseLost = true;
        throw new Error("lost output response");
      }
      return clone(applied.output.get(mutationId));
    }
  };

  const moduleApi = {
    groupContextService,
    inventoryService,
    ...(worldMutationCoordinator ? { worldMutationCoordinator } : {}),
    getModel: async () => model,
    getPartySnapshot: async () => ({
      members: [{
        actorId: crafter.id,
        actorName: crafter.name,
        actorImg: "",
        tools: [{ toolId: "smith", owned: true, rank: 1 }]
      }]
    }),
    resolveCraftProgressBase: async () => 5
  };

  return {
    calls,
    groupStore,
    model,
    moduleApi,
    settingsStore,
    service: new CraftingService(moduleApi),
    setActiveGmId(value) {
      const nextActiveGm = value === currentUser.id
        ? currentUser
        : { id: value, isGM: true, active: true };
      users.activeGM = nextActiveGm;
      users.contents = nextActiveGm === currentUser ? [currentUser] : [currentUser, nextActiveGm];
    },
    setCurrentGroupId(value) {
      currentGroupId = value;
    },
    restore() {
      globalThis.game = previousGame;
      restoreFoundry();
    }
  };
}

async function approveDefaultProject(fixture, overrides = {}) {
  const quote = await fixture.service.getQuote({
    requestId: "request-1"
  });
  return fixture.service.approveRequest({
    requestId: "request-1",
    expectedQuoteSignature: quote.signature,
    mutationId: overrides.mutationId ?? "approve-1"
  });
}

test("getSnapshot persists a normalized group-scoped v2 default without writing legacy craft state", async () => {
  const fixture = installFixture();
  try {
    const snapshot = await fixture.service.getSnapshot();

    assert.equal(snapshot.version, 2);
    assert.deepEqual(snapshot.projects, []);
    assert.deepEqual(fixture.groupStore.craftState, {
      version: 2,
      counter: 0,
      projects: [],
      audit: [],
      migrationAudit: []
    });
    assert.equal(
      fixture.calls.settings.some((entry) => entry.key === SETTINGS_KEYS.CRAFT_STATE),
      false
    );
  }
  finally {
    fixture.restore();
  }
});

test("v2 normalization preserves invalid overspend evidence and marks the project for reconciliation", () => {
  const fixture = installFixture();
  try {
    const state = normalizeCraftStateV2({
      version: 2,
      counter: 1,
      projects: [buildV2Project({
        reservation: {
          predominantMaterialId: "iron",
          predominantMaterialLbReserved: 1,
          predominantMaterialLbSpent: 1.5,
          baseRawMaterialId: "smith-base-raw",
          baseRawQuantityReserved: 2,
          baseRawQuantitySpent: 3,
          receipts: []
        }
      })],
      audit: [],
      migrationAudit: []
    }, { groupId: "group-1" });

    assert.equal(state.projects[0].reservation.predominantMaterialLbSpent, 1.5);
    assert.equal(state.projects[0].reservation.baseRawQuantitySpent, 3);
    assert.equal(state.projects[0].reconciliation.required, true);
    assert.equal(state.projects[0].reconciliation.reason, "reservation-spend-exceeds-reserved");
  }
  finally {
    fixture.restore();
  }
});

test("v1 queue migration creates paused approved legacy projects and preserves debited material as reservation with audit", async () => {
  const legacyState = {
    version: 1,
    counter: 3,
    queue: [{
      id: "craft-3",
      gearId: "iron-gear",
      gearName: "Iron Gear",
      quantity: 2,
      crafterActorId: "crafter",
      crafterName: "Crafter",
      requiredToolId: "smith",
      materialId: "iron",
      materialName: "Iron",
      materialSpentLb: 1.25,
      progress: 7,
      progressTarget: 20,
      progressPerDay: 5,
      createdAt: 50,
      updatedAt: 60
    }]
  };
  const fixture = installFixture({ legacyCraftState: legacyState });
  try {
    const first = await fixture.service.getSnapshot();
    const second = await fixture.service.getSnapshot();
    const [project] = first.projects;

    assert.equal(project.status, "approved");
    assert.equal(project.operationalStatus, "paused");
    assert.equal(project.profile, "legacy");
    assert.equal(project.progressGold, 7);
    assert.equal(project.targetGold, 20);
    assert.equal(project.reservation.predominantMaterialLbReserved, 1.25);
    assert.equal(project.reservation.predominantMaterialLbSpent, 0);
    assert.equal(project.reservation.receipts[0].kind, "legacy-debit");
    assert.equal(first.migrationAudit[0].sourceSnapshot.queue[0].id, "craft-3");
    assert.equal(second.projects.length, 1);
    assert.deepEqual(fixture.settingsStore[SETTINGS_KEYS.CRAFT_STATE].queue, legacyState.queue);
    assert.equal(
      fixture.settingsStore[SETTINGS_KEYS.CRAFT_STATE].migrationClaim.groupId,
      "group-1"
    );
  }
  finally {
    fixture.restore();
  }
});

test("approval uses only the submitted request payload, requires its quote signature, and rejects stale selections", async () => {
  const fixture = installFixture({
    downtimeRequests: [buildSubmittedCraftRequest({
      craftProject: {
        outputs: [{ sourceType: "gear", sourceId: "iron-gear", quantity: 1 }],
        hoursPerDay: 9,
        ownedWorkshop: true,
        predominantMaterialId: "iron"
      }
    })]
  });
  try {
    const staleQuote = await fixture.service.getQuote({
      requestId: "request-1"
    });
    assert.equal(staleQuote.outputs[0].unitPriceGold, 10);
    assert.equal(staleQuote.targetGold, 10);

    await assert.rejects(
      fixture.service.approveRequest({
        requestId: "request-1",
        outputs: [{ sourceType: "gear", sourceId: "iron-gear", quantity: 99 }],
        expectedQuoteSignature: staleQuote.signature,
        mutationId: "approve-client-selection"
      }),
      (error) => error?.code === "invalid-craft-approval-command"
    );
    await assert.rejects(
      fixture.service.approveRequest({
        requestId: "request-1",
        mutationId: "approve-without-signature"
      }),
      (error) => error?.code === "craft-quote-signature-required"
    );
    assert.equal(fixture.calls.reserve.length, 0);

    fixture.model.gear[0].priceGoldEquivalent = 20;
    await assert.rejects(
      fixture.service.approveRequest({
        requestId: "request-1",
        expectedQuoteSignature: staleQuote.signature,
        mutationId: "approve-stale"
      }),
      (error) => error?.code === "stale-craft-quote"
    );
    assert.equal(fixture.calls.reserve.length, 0);

    const freshQuote = await fixture.service.getQuote({
      requestId: "request-1"
    });
    const project = await fixture.service.approveRequest({
      requestId: "request-1",
      expectedQuoteSignature: freshQuote.signature,
      mutationId: "approve-fresh"
    });

    assert.equal(project.status, "approved");
    assert.equal(project.operationalStatus, "active");
    assert.equal(project.outputs[0].quantity, 1);
    assert.equal(project.targetGold, 20);
    assert.equal(project.hoursPerDay, 9);
    assert.equal(project.ownedWorkshop, true);
    assert.deepEqual(project.workdaySelection, {
      hoursPerDay: 9,
      isoWeekdays: [1, 2, 3, 4, 5, 6, 7]
    });
    assert.equal(project.reservation.baseRawQuantitySpent, 0);
    assert.equal(fixture.calls.reserve[0].quote.projectId, project.id);
  }
  finally {
    fixture.restore();
  }
});

test("craft quote accepts the pending status persisted by DowntimeService", async () => {
  const fixture = installFixture();
  try {
    fixture.groupStore.downtimeState.requests[0].status = "pending";

    const quote = await fixture.service.getQuote({ requestId: "request-1" });

    assert.equal(quote.requestId, "request-1");
    assert.equal(quote.eligibility.valid, true);
  }
  finally {
    fixture.restore();
  }
});

test("draft craft preview calculates workdays and reports current material stocks", async () => {
  const fixture = installFixture({
    model: createCraftModel({ priceGold: 30 })
  });
  try {
    const preview = await fixture.service.previewRequest({
      actorId: "crafter",
      craftProject: {
        outputs: [{ sourceType: "gear", sourceId: "iron-gear", quantity: 1 }],
        hoursPerDay: 12,
        ownedWorkshop: true,
        predominantMaterialId: "iron"
      }
    });

    assert.equal(preview.ready, true);
    assert.equal(preview.dailyProgressGold, 7);
    assert.equal(preview.requiredWorkdays, 5);
    assert.equal(preview.requiredDowntimeWeeks, 1);
    assert.equal(preview.calendarWeeks, 1);
    assert.equal(preview.materialAvailability.sufficient, true);
    assert.equal(preview.materials.every((row) => row.required <= row.available), true);
    assert.equal(preview.canSubmit, true);
  }
  finally {
    fixture.restore();
  }
});

test("draft craft preview blocks submission when party materials are insufficient", async () => {
  const fixture = installFixture({
    materialAvailability: {
      sufficient: false,
      inventoryActorId: "group-1",
      rows: [{
        sourceId: "iron",
        required: 1,
        available: 0.25,
        sufficient: false,
        components: [{ resource: "predominant", sourceId: "iron", quantity: 1 }]
      }]
    }
  });
  try {
    const preview = await fixture.service.previewRequest({
      actorId: "crafter",
      craftProject: {
        outputs: [{ sourceType: "gear", sourceId: "iron-gear", quantity: 1 }],
        hoursPerDay: 8,
        ownedWorkshop: false,
        predominantMaterialId: "iron"
      }
    });

    assert.equal(preview.materialAvailability.sufficient, false);
    assert.equal(preview.materials[0].name, "Iron");
    assert.equal(preview.materials[0].required, 1);
    assert.equal(preview.materials[0].available, 0.25);
    assert.equal(preview.canSubmit, false);
    assert.match(preview.message, /material/i);
    assert.equal(preview.errors.some((error) => error.code === "insufficient-materials"), true);
  }
  finally {
    fixture.restore();
  }
});

test("draft craft preview reserves one workday for zero-price gear consistently", async () => {
  const fixture = installFixture({ model: createCraftModel({ priceGold: 0 }) });
  try {
    const preview = await fixture.service.previewRequest({
      actorId: "crafter",
      craftProject: {
        outputs: [{ sourceType: "gear", sourceId: "iron-gear", quantity: 1 }],
        hoursPerDay: 8,
        ownedWorkshop: false,
        predominantMaterialId: "iron"
      }
    });

    assert.equal(preview.requiredWorkdays, 1);
    assert.equal(preview.requiredDowntimeWeeks, 1);
  }
  finally {
    fixture.restore();
  }
});

test("quote revalidation rejects invalid submitted quantity and fractional work hours instead of coercing them", async () => {
  const fixture = installFixture({
    downtimeRequests: [buildSubmittedCraftRequest({
      craftProject: {
        outputs: [{ sourceType: "gear", sourceId: "iron-gear", quantity: 0 }],
        hoursPerDay: 8,
        ownedWorkshop: false,
        predominantMaterialId: "iron"
      }
    })]
  });
  try {
    await assert.rejects(
      fixture.service.getQuote({
        requestId: "request-1"
      }),
      /positive integer/u
    );
    fixture.groupStore.downtimeState.requests[0].craftProject.outputs[0].quantity = 1;
    fixture.groupStore.downtimeState.requests[0].craftProject.hoursPerDay = 8.5;
    await assert.rejects(
      fixture.service.getQuote({
        requestId: "request-1"
      }),
      /integer from 8 to 16/u
    );
  }
  finally {
    fixture.restore();
  }
});

test("quote falls back to craft selections stored on the downtime request", async () => {
  const fixture = installFixture({
    downtimeRequests: [buildSubmittedCraftRequest({
      outputs: [{ sourceType: "gear", sourceId: "iron-gear", quantity: 1, unitPriceGold: 0.01 }],
      hoursPerDay: 10,
      ownedWorkshop: true,
      predominantMaterialId: "iron",
      craftProject: null
    })]
  });
  try {
    const quote = await fixture.service.getQuote({
      requestId: "request-1"
    });

    assert.equal(quote.outputs[0].unitPriceGold, 10);
    assert.equal(quote.hoursPerDay, 10);
    assert.equal(quote.ownedWorkshop, true);
    assert.deepEqual(quote.workdaySelection.isoWeekdays, [1, 2, 3, 4, 5, 6, 7]);
  }
  finally {
    fixture.restore();
  }
});

test("approval observes ambiguous group persistence and a retry never reserves or creates the project twice", async () => {
  let loseProjectWriteResponse = true;
  const fixture = installFixture({
    onGroupStatePersist({ groupStore }) {
      if (loseProjectWriteResponse && groupStore.craftState?.projects?.length === 1) {
        loseProjectWriteResponse = false;
        throw new Error("lost project persistence response");
      }
    }
  });
  try {
    const first = await approveDefaultProject(fixture, { mutationId: "approve-ambiguous" });
    const retry = await approveDefaultProject(fixture, { mutationId: "approve-ambiguous" });

    assert.equal(first.id, retry.id);
    assert.equal(fixture.groupStore.craftState.projects.length, 1);
    assert.equal(fixture.calls.reserve.length, 1);
    assert.equal(fixture.calls.reserve[0].mutationId, "approve-ambiguous:reserve");
  }
  finally {
    fixture.restore();
  }
});

test("pause resume and reconciliation lifecycle transitions are audited", async () => {
  const fixture = installFixture({
    craftState: {
      version: 2,
      counter: 1,
      projects: [buildV2Project({
        reconciliation: {
          required: true,
          operationId: "work-ambiguous",
          reason: "receipt uncertain"
        }
      })],
      audit: [],
      migrationAudit: []
    }
  });
  try {
    const reconciled = await fixture.service.reconcileProject("craft-project-1", {
      mutationId: "reconcile-1",
      note: "inventory receipt confirmed",
      resume: true
    });
    const paused = await fixture.service.pauseProject("craft-project-1", {
      mutationId: "pause-1",
      reason: "waiting for calendar"
    });
    const resumed = await fixture.service.resumeProject("craft-project-1", {
      mutationId: "resume-1"
    });

    assert.equal(reconciled.status, "approved");
    assert.equal(reconciled.operationalStatus, "active");
    assert.equal(reconciled.reconciliation.required, false);
    assert.equal(paused.status, "approved");
    assert.equal(paused.operationalStatus, "paused");
    assert.equal(resumed.status, "approved");
    assert.equal(resumed.operationalStatus, "active");
    assert.deepEqual(
      resumed.audit.slice(-3).map((entry) => entry.type),
      ["reconciled", "paused", "resumed"]
    );
  }
  finally {
    fixture.restore();
  }
});

test("cancellation releases only unspent reservation once", async () => {
  const fixture = installFixture();
  try {
    const project = await approveDefaultProject(fixture);
    await fixture.service.processProjectWorkday(project.id, {
      isoDate: "2026-07-20",
      transitionId: "transition-1",
      mutationId: "workday-1"
    });

    const cancelled = await fixture.service.cancelProject(project.id, { mutationId: "cancel-1" });
    const retry = await fixture.service.cancelProject(project.id, { mutationId: "cancel-1" });

    assert.equal(cancelled.status, "cancelled");
    assert.equal(retry.status, "cancelled");
    assert.equal(fixture.calls.release.length, 1);
    const { options: releaseOptions, ...releaseCall } = fixture.calls.release[0];
    assert.deepEqual(releaseCall, {
      projectId: project.id,
      mutationId: "cancel-1:release",
      remaining: {
        predominantMaterialId: "iron",
        predominantMaterialLb: 0.05,
        baseRawMaterialId: "smith-base-raw",
        baseRawQuantity: 2
      }
    });
    assert.ok(releaseOptions);
  }
  finally {
    fixture.restore();
  }
});

test("a cancelled project returns an explicit no-receipt block for scheduled work", async () => {
  const fixture = installFixture({
    craftState: {
      version: 2,
      counter: 1,
      projects: [buildV2Project({ status: "cancelled" })],
      audit: [],
      migrationAudit: []
    }
  });
  try {
    const result = await fixture.service.processProjectWorkday("craft-project-1", {
      isoDate: "2026-07-20",
      transitionId: "cancelled-transition",
      mutationId: "cancelled-workday"
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.blocked, true);
    assert.match(result.blockReason, /cancelled/u);
    assert.equal(fixture.calls.spend.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("workday retry spends each dated transition once and creates completed output once after ambiguous responses", async () => {
  const fixture = installFixture({
    loseOutputResponseOnce: true,
    failCompletionCheckpointOnce: true
  });
  try {
    const project = await approveDefaultProject(fixture);
    const firstDay = await fixture.service.processProjectWorkday(project.id, {
      isoDate: "2026-07-20",
      transitionId: "transition-1",
      mutationId: "workday-1"
    });
    const firstDayRetry = await fixture.service.processProjectWorkday(project.id, {
      isoDate: "2026-07-20",
      transitionId: "transition-1",
      mutationId: "workday-1"
    });

    assert.equal(firstDay.result.progressGold, 5);
    assert.equal(firstDayRetry.result.progressGold, 5);
    assert.equal(fixture.calls.spend.length, 1);

    await assert.rejects(
      fixture.service.processProjectWorkday(project.id, {
        isoDate: "2026-07-21",
        transitionId: "transition-2",
        mutationId: "workday-2"
      }),
      /lost output response/u
    );
    await assert.rejects(
      fixture.service.processProjectWorkday(project.id, {
        isoDate: "2026-07-21",
        transitionId: "transition-2",
        mutationId: "workday-2"
      }),
      /craft journal unavailable/u
    );
    const completion = await fixture.service.processProjectWorkday(project.id, {
      isoDate: "2026-07-21",
      transitionId: "transition-2",
      mutationId: "workday-2"
    });
    const repeatedDate = await fixture.service.processProjectWorkday(project.id, {
      isoDate: "2026-07-21",
      transitionId: "transition-2-retry",
      mutationId: "workday-2-new-root"
    });

    assert.equal(completion.result.status, "completed");
    assert.equal(repeatedDate.result.alreadyCompleted, true);
    assert.equal(fixture.calls.spend.length, 2);
    assert.equal(fixture.calls.outputEffects, 1);
    assert.equal(fixture.calls.output[0].mutationId, "workday-2:outputs");
    assert.equal(fixture.groupStore.craftState.projects[0].completion.outputStatus, "created");
    assert.deepEqual(fixture.groupStore.craftState.projects[0].completion.outputItemIds, ["crafted-item-1"]);
    assert.equal(
      fixture.groupStore.craftState.projects[0].audit.filter((entry) => entry.type === "outputs-created").length,
      1
    );
  }
  finally {
    fixture.restore();
  }
});

test("world legacy migration is claimed by one group and an ambiguous claim cannot duplicate its queue", async () => {
  const legacyState = {
    version: 1,
    counter: 1,
    queue: [{
      id: "legacy-task",
      gearId: "iron-gear",
      gearName: "Iron Gear",
      quantity: 1,
      crafterActorId: "crafter",
      requiredToolId: "smith",
      materialId: "iron",
      materialSpentLb: 0.1,
      progress: 0,
      progressTarget: 10
    }]
  };
  const sharedSettingsStore = {
    [SETTINGS_KEYS.CRAFT_STATE]: clone(legacyState),
    [SETTINGS_KEYS.CRAFT_MUTATION_JOURNAL]: {}
  };
  const firstGroup = installFixture({
    groupId: "group-1",
    sharedSettingsStore,
    loseLegacyClaimResponseOnce: true
  });
  try {
    const snapshot = await firstGroup.service.getSnapshot();
    assert.equal(snapshot.projects.length, 1);
    assert.equal(sharedSettingsStore[SETTINGS_KEYS.CRAFT_STATE].migrationClaim.groupId, "group-1");
  }
  finally {
    firstGroup.restore();
  }

  const secondGroup = installFixture({
    groupId: "group-2",
    sharedSettingsStore
  });
  try {
    const snapshot = await secondGroup.service.getSnapshot();
    assert.deepEqual(snapshot.projects, []);
    assert.equal(sharedSettingsStore[SETTINGS_KEYS.CRAFT_STATE].migrationClaim.groupId, "group-1");
  }
  finally {
    secondGroup.restore();
  }
});

test("concurrent legacy migration claims with independent coordinators select one deterministic group", async () => {
  const sharedSettingsStore = {
    [SETTINGS_KEYS.CRAFT_STATE]: {
      version: 1,
      counter: 1,
      queue: [{
        id: "legacy-race",
        gearId: "iron-gear",
        gearName: "Iron Gear",
        quantity: 1,
        crafterActorId: "crafter",
        requiredToolId: "smith",
        materialId: "iron",
        materialSpentLb: 0.1,
        progress: 0,
        progressTarget: 10
      }]
    },
    [SETTINGS_KEYS.CRAFT_MUTATION_JOURNAL]: {}
  };
  const firstCoordinator = new WorldMutationCoordinator();
  const secondCoordinator = new WorldMutationCoordinator();
  assert.notEqual(firstCoordinator, secondCoordinator);
  let releaseFirstClaim;
  const firstClaimMayFinish = new Promise((resolve) => {
    releaseFirstClaim = resolve;
  });
  let announceFirstClaim;
  const firstClaimStarted = new Promise((resolve) => {
    announceFirstClaim = resolve;
  });
  let claimWrites = 0;
  const beforeLegacyClaimWrite = async () => {
    claimWrites += 1;
    if (claimWrites === 1) {
      announceFirstClaim();
      await firstClaimMayFinish;
    }
  };
  const firstGroup = installFixture({
    groupId: "group-1",
    worldGroupIds: ["group-2", "group-1"],
    sharedSettingsStore,
    worldMutationCoordinator: firstCoordinator
  });
  const secondGroup = installFixture({
    groupId: "group-2",
    worldGroupIds: ["group-2", "group-1"],
    sharedSettingsStore,
    worldMutationCoordinator: secondCoordinator,
    beforeLegacyClaimWrite
  });
  try {
    const firstSnapshotPromise = firstGroup.service.getSnapshot();
    await firstClaimStarted;
    const secondSnapshotPromise = secondGroup.service.getSnapshot();
    await new Promise((resolve) => setImmediate(resolve));
    releaseFirstClaim();
    const [firstSnapshot, secondSnapshot] = await Promise.all([
      firstSnapshotPromise,
      secondSnapshotPromise
    ]);

    assert.equal(firstSnapshot.projects.length + secondSnapshot.projects.length, 1);
    assert.equal(claimWrites, 1);
    assert.equal(sharedSettingsStore[SETTINGS_KEYS.CRAFT_STATE].migrationClaim.groupId, "group-1");
  }
  finally {
    secondGroup.restore();
    firstGroup.restore();
  }
});

test("every craft mutation rejects an inactive GM before journal, group, or inventory writes", async () => {
  const operations = [
    (service) => service.approveRequest({
      requestId: "request-1",
      expectedQuoteSignature: "unused",
      mutationId: "inactive-approve"
    }),
    (service) => service.pauseProject("craft-project-1", { mutationId: "inactive-pause" }),
    (service) => service.resumeProject("craft-project-1", { mutationId: "inactive-resume" }),
    (service) => service.reconcileProject("craft-project-1", { mutationId: "inactive-reconcile" }),
    (service) => service.cancelProject("craft-project-1", { mutationId: "inactive-cancel" }),
    (service) => service.processProjectWorkday("craft-project-1", {
      isoDate: "2026-07-20",
      transitionId: "inactive-transition",
      mutationId: "inactive-workday"
    })
  ];

  for (const operation of operations) {
    const fixture = installFixture({
      activeGmId: "primary-gm",
      craftState: {
        version: 2,
        counter: 1,
        projects: [buildV2Project({
          operationalStatus: "active",
          reconciliation: { required: true, reason: "test" }
        })],
        audit: [],
        migrationAudit: []
      }
    });
    const before = clone(fixture.groupStore);
    try {
      await assert.rejects(operation(fixture.service), /active GM/u);
      assert.deepEqual(fixture.groupStore, before);
      assert.equal(fixture.calls.reserve.length, 0);
      assert.equal(fixture.calls.spend.length, 0);
      assert.equal(fixture.calls.release.length, 0);
      assert.equal(fixture.calls.settings.length, 0);
    }
    finally {
      fixture.restore();
    }
  }
});

test("approval and cancellation require a caller-stable nonempty economic mutation ID", async () => {
  const fixture = installFixture();
  try {
    const quote = await fixture.service.getQuote({ requestId: "request-1" });
    for (const mutationId of [undefined, "", "   "]) {
      await assert.rejects(
        fixture.service.approveRequest({
          requestId: "request-1",
          expectedQuoteSignature: quote.signature,
          mutationId
        }),
        /stable nonempty mutation ID/u
      );
    }
    assert.equal(fixture.calls.reserve.length, 0);

    const project = await fixture.service.approveRequest({
      requestId: "request-1",
      expectedQuoteSignature: quote.signature,
      mutationId: "approve-stable"
    });
    for (const mutationId of [undefined, "", "   "]) {
      await assert.rejects(
        fixture.service.cancelProject(project.id, { mutationId }),
        /stable nonempty mutation ID/u
      );
    }
    assert.equal(fixture.calls.release.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("every craft inventory mutation receives one frozen captured group execution context", async () => {
  const completedFixture = installFixture();
  try {
    const quote = await completedFixture.service.getQuote({ requestId: "request-1" });
    const project = await completedFixture.service.approveRequest({
      requestId: "request-1",
      expectedQuoteSignature: quote.signature,
      mutationId: "approve-context"
    });
    await completedFixture.service.processProjectWorkday(project.id, {
      isoDate: "2026-07-20",
      transitionId: "context-day-1",
      mutationId: "context-workday-1"
    });
    await completedFixture.service.processProjectWorkday(project.id, {
      isoDate: "2026-07-21",
      transitionId: "context-day-2",
      mutationId: "context-workday-2"
    });

    const entries = [
      ...completedFixture.calls.reserve,
      ...completedFixture.calls.spend,
      ...completedFixture.calls.output
    ];
    assert.ok(entries.length >= 4);
    for (const entry of entries) {
      assert.equal(entry.options.groupId, "group-1");
      assert.equal(Object.isFrozen(entry.options), true);
      assert.equal(typeof entry.options.guard, "function");
      assert.equal(entry.options.guard, entry.options.assertExecutionContext);
      assert.doesNotThrow(() => entry.options.assertExecutionContext());
    }
  }
  finally {
    completedFixture.restore();
  }

  const cancelledFixture = installFixture();
  try {
    const quote = await cancelledFixture.service.getQuote({ requestId: "request-1" });
    const project = await cancelledFixture.service.approveRequest({
      requestId: "request-1",
      expectedQuoteSignature: quote.signature,
      mutationId: "approve-release-context"
    });
    await cancelledFixture.service.cancelProject(project.id, { mutationId: "cancel-context" });
    assert.equal(cancelledFixture.calls.release.length, 1);
    const { options } = cancelledFixture.calls.release[0];
    assert.equal(options.groupId, "group-1");
    assert.equal(Object.isFrozen(options), true);
    assert.equal(options.guard, options.assertExecutionContext);
    assert.doesNotThrow(() => options.guard());
  }
  finally {
    cancelledFixture.restore();
  }
});

test("craft approval aborts after inventory await when the active group changes", async () => {
  let fixture;
  fixture = installFixture({
    worldGroupIds: ["group-1", "group-2"],
    onInventoryOperation: async (kind) => {
      if (kind === "reserve") {
        fixture.setCurrentGroupId("group-2");
      }
    }
  });
  try {
    const quote = await fixture.service.getQuote({ requestId: "request-1" });
    await assert.rejects(
      fixture.service.approveRequest({
        requestId: "request-1",
        expectedQuoteSignature: quote.signature,
        mutationId: "approve-group-switch"
      }),
      (error) => error?.code === "reconciliation-required"
    );
    assert.equal(fixture.calls.reserve.length, 1);
    assert.deepEqual(fixture.groupStore.craftState.projects, []);
  }
  finally {
    fixture.restore();
  }
});

test("craft approval aborts after inventory await when active GM authority changes", async () => {
  let fixture;
  fixture = installFixture({
    onInventoryOperation: async (kind) => {
      if (kind === "reserve") {
        fixture.setActiveGmId("replacement-gm");
      }
    }
  });
  try {
    const quote = await fixture.service.getQuote({ requestId: "request-1" });
    await assert.rejects(
      fixture.service.approveRequest({
        requestId: "request-1",
        expectedQuoteSignature: quote.signature,
        mutationId: "approve-gm-failover"
      }),
      /active GM|authority changed/u
    );
    assert.equal(fixture.calls.reserve.length, 1);
    assert.deepEqual(fixture.groupStore.craftState.projects, []);
  }
  finally {
    fixture.restore();
  }
});

test("pause resume and reconcile require stable IDs and retry without duplicate audit", async () => {
  const cases = [
    {
      type: "paused",
      project: buildV2Project({ operationalStatus: "active" }),
      invoke: (service, mutationId) => service.pauseProject("craft-project-1", { mutationId })
    },
    {
      type: "resumed",
      project: buildV2Project({ operationalStatus: "paused" }),
      invoke: (service, mutationId) => service.resumeProject("craft-project-1", { mutationId })
    },
    {
      type: "reconciled",
      project: buildV2Project({
        operationalStatus: "blocked",
        reconciliation: { required: true, reason: "test" }
      }),
      invoke: (service, mutationId) => service.reconcileProject("craft-project-1", { mutationId })
    }
  ];

  for (const entry of cases) {
    const fixture = installFixture({
      craftState: {
        version: 2,
        counter: 1,
        projects: [entry.project],
        audit: [],
        migrationAudit: []
      }
    });
    try {
      for (const mutationId of [undefined, "", "   "]) {
        await assert.rejects(
          entry.invoke(fixture.service, mutationId),
          /stable nonempty mutation ID/u
        );
      }
      const mutationId = `lifecycle-${entry.type}`;
      await entry.invoke(fixture.service, mutationId);
      await entry.invoke(fixture.service, mutationId);
      const project = fixture.groupStore.craftState.projects[0];
      assert.equal(
        project.audit.filter((audit) => audit.type === entry.type && audit.mutationId === mutationId).length,
        1
      );
    }
    finally {
      fixture.restore();
    }
  }
});

test("cancellation persists an inactive project before release and ambiguous retries release exactly once", async () => {
  const fixture = installFixture({
    craftState: {
      version: 2,
      counter: 1,
      projects: [buildV2Project({ operationalStatus: "active" })],
      audit: [],
      migrationAudit: []
    },
    failCancellationPersistBeforeWriteOnce: true,
    loseReleaseResponseOnce: true
  });
  try {
    await assert.rejects(
      fixture.service.cancelProject("craft-project-1", { mutationId: "cancel-durable" }),
      /persistence unavailable/u
    );
    assert.equal(fixture.groupStore.craftState.projects[0].status, "approved");
    assert.equal(fixture.groupStore.craftState.projects[0].operationalStatus, "active");
    assert.equal(fixture.calls.releaseEffects ?? 0, 0);

    await assert.rejects(
      fixture.service.cancelProject("craft-project-1", { mutationId: "cancel-durable" }),
      /lost release response/u
    );
    assert.equal(fixture.groupStore.craftState.projects[0].status, "cancelled");
    assert.equal(fixture.groupStore.craftState.projects[0].operationalStatus, "inactive");
    assert.equal(fixture.groupStore.craftState.projects[0].cancellation.releaseStatus, "pending");
    assert.equal(fixture.calls.releaseEffects, 1);

    await assert.rejects(
      fixture.service.cancelProject("craft-project-1", { mutationId: "cancel-wrong-retry" }),
      (error) => error?.code === "reconciliation-required"
    );

    const cancelled = await fixture.service.cancelProject("craft-project-1", {
      mutationId: "cancel-durable"
    });
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.cancellation.releaseStatus, "released");
    assert.equal(fixture.calls.releaseEffects, 1);
    assert.deepEqual(
      new Set(fixture.calls.release.map((entry) => entry.mutationId)),
      new Set(["cancel-durable:release"])
    );
  }
  finally {
    fixture.restore();
  }
});

test("normalization forces every project into its enclosing group", () => {
  const fixture = installFixture();
  try {
    const state = normalizeCraftStateV2({
      version: 2,
      counter: 1,
      projects: [buildV2Project({ groupId: "other-group" })],
      audit: [],
      migrationAudit: []
    }, { groupId: "group-1" });

    assert.equal(state.projects[0].groupId, "group-1");
  }
  finally {
    fixture.restore();
  }
});

test("project lifecycle preserves required states while pause and block remain operational", async () => {
  const fixture = installFixture();
  try {
    const normalized = normalizeCraftStateV2({
      version: 2,
      projects: [
        buildV2Project({ id: "draft", status: "draft" }),
        buildV2Project({ id: "submitted", status: "submitted" }),
        buildV2Project({ id: "approved", status: "approved" }),
        buildV2Project({ id: "in-progress", status: "in-progress" }),
        buildV2Project({ id: "completed", status: "completed" }),
        buildV2Project({ id: "cancelled", status: "cancelled" }),
        buildV2Project({
          id: "legacy-active",
          status: "active",
          operationalStatus: undefined,
          progressGold: 5,
          processedWorkdays: []
        }),
        buildV2Project({
          id: "legacy-blocked",
          status: "blocked",
          operationalStatus: undefined,
          progressGold: 0,
          processedWorkdays: []
        })
      ],
      audit: [],
      migrationAudit: []
    }, { groupId: "group-1" });
    assert.deepEqual(
      normalized.projects.map((project) => project.status),
      [
        "draft",
        "submitted",
        "approved",
        "in-progress",
        "completed",
        "cancelled",
        "in-progress",
        "approved"
      ]
    );
    assert.equal(normalized.projects.at(-2).operationalStatus, "active");
    assert.equal(normalized.projects.at(-1).operationalStatus, "blocked");

    const project = await approveDefaultProject(fixture, { mutationId: "approve-lifecycle" });
    assert.equal(project.status, "approved");
    assert.equal(project.operationalStatus, "active");

    const firstDay = await fixture.service.processProjectWorkday(project.id, {
      isoDate: "2026-07-20",
      transitionId: "lifecycle-1",
      mutationId: "lifecycle-workday-1"
    });
    assert.equal(firstDay.result.status, "in-progress");

    const paused = await fixture.service.pauseProject(project.id, { mutationId: "lifecycle-pause" });
    assert.equal(paused.status, "in-progress");
    assert.equal(paused.operationalStatus, "paused");
    const resumed = await fixture.service.resumeProject(project.id, { mutationId: "lifecycle-resume" });
    assert.equal(resumed.status, "in-progress");
    assert.equal(resumed.operationalStatus, "active");

    const completed = await fixture.service.processProjectWorkday(project.id, {
      isoDate: "2026-07-21",
      transitionId: "lifecycle-2",
      mutationId: "lifecycle-workday-2"
    });
    assert.equal(completed.result.status, "completed");
  }
  finally {
    fixture.restore();
  }
});

test("legacy queue mutation methods reject and never run old processOneDay", async () => {
  const fixture = installFixture();
  try {
    for (const operation of [
      () => fixture.service.queueTask({ gearId: "iron-gear" }),
      () => fixture.service.cancelTask("craft-1"),
      () => fixture.service.processOneDay()
    ]) {
      await assert.rejects(operation(), (error) => error?.code === "deprecated-craft-queue");
    }
    assert.equal(fixture.calls.reserve.length, 0);
    assert.equal(fixture.calls.spend.length, 0);
    assert.equal(fixture.calls.output.length, 0);
  }
  finally {
    fixture.restore();
  }
});
