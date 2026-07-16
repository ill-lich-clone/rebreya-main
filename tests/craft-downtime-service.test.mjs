import assert from "node:assert/strict";
import test from "node:test";

import { CraftDowntimeService } from "../scripts/data/craft-downtime-service.js?v=1.4.95-craft-calendar";

function createHarness({
  quote = {
    requestId: "downtime-1",
    signature: "craft-quote-v1-a1b2c3d4"
  },
  project = {
    id: "craft-project-1",
    requestId: "downtime-1",
    hoursPerDay: 12,
    ownedWorkshop: true
  },
  workdayOutcome = null,
  failLinkOnce = false,
  linkedRequest = null
} = {}) {
  const calls = [];
  const approvedMutationIds = new Set();
  let projectCreations = 0;
  let linkFailuresRemaining = failLinkOnce ? 1 : 0;
  const craftingService = {
    async getSnapshot(options) {
      calls.push(["getSnapshot", options]);
      return { projects: [project] };
    },
    async getQuote(input) {
      calls.push(["getQuote", input]);
      return quote;
    },
    async approveRequest(input) {
      calls.push(["approveRequest", input]);
      if (!approvedMutationIds.has(input.mutationId)) {
        approvedMutationIds.add(input.mutationId);
        projectCreations += 1;
      }
      return project;
    },
    async pauseProject(projectId, options) {
      calls.push(["pauseProject", projectId, options]);
      return { ...project, operationalStatus: "paused" };
    },
    async resumeProject(projectId, options) {
      calls.push(["resumeProject", projectId, options]);
      return { ...project, operationalStatus: "active" };
    },
    async cancelProject(projectId, options) {
      calls.push(["cancelProject", projectId, options]);
      return { ...project, status: "cancelled" };
    },
    async reconcileProject(projectId, options) {
      calls.push(["reconcileProject", projectId, options]);
      return { ...project, reconciliation: { required: false } };
    },
    async processProjectWorkday(projectId, options) {
      calls.push(["processProjectWorkday", projectId, options]);
      if (workdayOutcome) {
        return workdayOutcome;
      }
      return {
        activityId: "craft",
        projectId,
        hours: project.hoursPerDay,
        status: "processed",
        result: { progressGold: 12 }
      };
    }
  };
  const downtimeService = {
    async linkCraftProject(requestId, link) {
      calls.push(["linkCraftProject", requestId, link]);
      if (linkFailuresRemaining > 0) {
        linkFailuresRemaining -= 1;
        throw new Error("lost downtime link response");
      }
      return linkedRequest ?? {
        id: requestId,
        craftProjectId: link.projectId,
        craftApprovalMutationId: link.mutationId,
        status: "approved"
      };
    }
  };

  return {
    calls,
    craftingService,
    downtimeService,
    get projectCreations() {
      return projectCreations;
    },
    service: new CraftDowntimeService({ craftingService, downtimeService })
  };
}

test("approveRequest quotes and approves craft before linking its downtime slots", async () => {
  const harness = createHarness();

  const project = await harness.service.approveRequest({
    requestId: "downtime-1",
    mutationId: "approve-craft-1"
  });

  assert.equal(project.id, "craft-project-1");
  assert.deepEqual(harness.calls, [[
    "getQuote",
    { requestId: "downtime-1" }
  ], [
    "approveRequest",
    {
      requestId: "downtime-1",
      expectedQuoteSignature: "craft-quote-v1-a1b2c3d4",
      mutationId: "approve-craft-1"
    }
  ], [
    "linkCraftProject",
    "downtime-1",
    {
      projectId: "craft-project-1",
      hoursPerDay: 12,
      ownedWorkshop: true,
      mutationId: "approve-craft-1"
    }
  ]]);
});

test("snapshot and approval quote delegate to the crafting project service", async () => {
  const harness = createHarness();

  const snapshot = await harness.service.getSnapshot({
    search: "sword",
    crafterActorId: "actor-a"
  });
  const quote = await harness.service.getApprovalQuote({ requestId: "downtime-1" });

  assert.equal(snapshot.projects[0].id, "craft-project-1");
  assert.equal(quote.signature, "craft-quote-v1-a1b2c3d4");
  assert.deepEqual(harness.calls, [[
    "getSnapshot",
    { search: "sword", crafterActorId: "actor-a" }
  ], [
    "getQuote",
    { requestId: "downtime-1" }
  ]]);
});

test("processScheduledSlot uses the linked slot date and the downtime operation ID", async () => {
  const harness = createHarness();
  const slot = {
    id: "downtime-slot-1",
    requestId: "downtime-1",
    activityId: "craft",
    projectId: "craft-project-1",
    isoDate: "2026-07-20",
    hours: 12,
    ownedWorkshop: true
  };

  const receipt = await harness.service.processScheduledSlot(slot, {
    isoDate: "2026-07-20",
    transitionId: "calendar-transition-1",
    operationId: "downtime:calendar-transition-1:downtime-slot-1"
  });

  assert.deepEqual(receipt, {
    activityId: "craft",
    projectId: "craft-project-1",
    hours: 12,
    status: "processed",
    result: { progressGold: 12 }
  });
  assert.deepEqual(harness.calls, [[
    "processProjectWorkday",
    "craft-project-1",
    {
      isoDate: "2026-07-20",
      transitionId: "calendar-transition-1",
      mutationId: "downtime:calendar-transition-1:downtime-slot-1"
    }
  ]]);
});

test("processScheduledSlot accepts the unpadded early-year dates used by the world calendar", async () => {
  const harness = createHarness();

  const receipt = await harness.service.processScheduledSlot({
    id: "downtime-slot-1",
    requestId: "downtime-1",
    activityId: "craft",
    projectId: "craft-project-1",
    isoDate: "402-03-18",
    hours: 12
  }, {
    isoDate: "402-03-18",
    transitionId: "calendar-transition-early-year",
    operationId: "downtime:calendar-transition-early-year:downtime-slot-1"
  });

  assert.equal(receipt.status, "processed");
  assert.deepEqual(harness.calls.at(-1), [
    "processProjectWorkday",
    "craft-project-1",
    {
      isoDate: "402-03-18",
      transitionId: "calendar-transition-early-year",
      mutationId: "downtime:calendar-transition-early-year:downtime-slot-1"
    }
  ]);
});

test("processScheduledSlot normalizes a blocked craft workday without progress", async () => {
  const harness = createHarness({
    workdayOutcome: {
      status: "blocked",
      blocked: true,
      projectId: "craft-project-1",
      blockReason: "Craft project is paused."
    }
  });

  const receipt = await harness.service.processScheduledSlot({
    id: "downtime-slot-1",
    requestId: "downtime-1",
    activityId: "craft",
    projectId: "craft-project-1",
    isoDate: "2026-07-20",
    hours: 12
  }, {
    isoDate: "2026-07-20",
    transitionId: "calendar-transition-1",
    operationId: "downtime:calendar-transition-1:downtime-slot-1"
  });

  assert.deepEqual(receipt, {
    activityId: "craft",
    projectId: "craft-project-1",
    hours: 12,
    status: "blocked",
    result: null,
    blockReason: "Craft project is paused."
  });
});

test("approveRequest retry completes a failed downtime link without duplicating the craft project", async () => {
  const harness = createHarness({ failLinkOnce: true });
  const command = {
    requestId: "downtime-1",
    mutationId: "approve-craft-1"
  };

  await assert.rejects(
    harness.service.approveRequest(command),
    /lost downtime link response/u
  );
  const project = await harness.service.approveRequest(command);

  assert.equal(project.id, "craft-project-1");
  assert.equal(harness.projectCreations, 1);
  assert.equal(harness.calls.filter(([name]) => name === "approveRequest").length, 2);
  assert.equal(harness.calls.filter(([name]) => name === "linkCraftProject").length, 2);
  assert.deepEqual(
    harness.calls.filter(([name]) => name === "approveRequest").map((call) => call[1].mutationId),
    ["approve-craft-1", "approve-craft-1"]
  );
  assert.deepEqual(
    harness.calls.filter(([name]) => name === "linkCraftProject").map((call) => call[2].mutationId),
    ["approve-craft-1", "approve-craft-1"]
  );
});

test("pause resume cancel and reconcile delegate stable lifecycle commands", async () => {
  const harness = createHarness();

  const paused = await harness.service.pause("craft-project-1", {
    mutationId: "pause-craft-1",
    reason: "Waiting for materials"
  });
  const resumed = await harness.service.resume("craft-project-1", {
    mutationId: "resume-craft-1"
  });
  const cancelled = await harness.service.cancel("craft-project-1", {
    mutationId: "cancel-craft-1"
  });
  const reconciled = await harness.service.reconcile("craft-project-1", {
    mutationId: "reconcile-craft-1",
    note: "Reservation verified",
    resume: true
  });

  assert.equal(paused.operationalStatus, "paused");
  assert.equal(resumed.operationalStatus, "active");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(reconciled.reconciliation.required, false);
  assert.deepEqual(harness.calls, [[
    "pauseProject",
    "craft-project-1",
    { mutationId: "pause-craft-1", reason: "Waiting for materials" }
  ], [
    "resumeProject",
    "craft-project-1",
    { mutationId: "resume-craft-1" }
  ], [
    "cancelProject",
    "craft-project-1",
    { mutationId: "cancel-craft-1" }
  ], [
    "reconcileProject",
    "craft-project-1",
    { mutationId: "reconcile-craft-1", note: "Reservation verified", resume: true }
  ]]);
});

test("approval rejects player scheduling overrides before any mutation", async () => {
  for (const forbiddenInput of [{
    isoDate: "2026-07-20"
  }, {
    ownedWorkshop: false
  }, {
    hoursPerDay: 16
  }]) {
    const harness = createHarness();
    await assert.rejects(
      harness.service.approveRequest({
        requestId: "downtime-1",
        mutationId: "approve-craft-1",
        ...forbiddenInput
      }),
      /cannot include|unknown|unsupported/iu
    );
    assert.deepEqual(harness.calls, []);
  }
});

test("scheduled processing rejects invalid craft links without invoking crafting", async () => {
  const invalidCases = [{
    label: "non-craft activity",
    slot: { activityId: "training", projectId: "craft-project-1", isoDate: "2026-07-20" },
    context: { isoDate: "2026-07-20" },
    error: /non-craft activity link/iu
  }, {
    label: "missing project",
    slot: { activityId: "craft", projectId: "", isoDate: "2026-07-20" },
    context: { isoDate: "2026-07-20" },
    error: /project.*stable nonempty ID/iu
  }, {
    label: "mismatched date",
    slot: { activityId: "craft", projectId: "craft-project-1", isoDate: "2026-07-20" },
    context: { isoDate: "2026-07-21" },
    error: /date does not match/iu
  }];

  for (const entry of invalidCases) {
    const harness = createHarness();
    await assert.rejects(
      harness.service.processScheduledSlot({
        id: "downtime-slot-1",
        requestId: "downtime-1",
        hours: 12,
        ...entry.slot
      }, {
        transitionId: "calendar-transition-1",
        operationId: "downtime:calendar-transition-1:downtime-slot-1",
        ...entry.context
      }),
      entry.error,
      entry.label
    );
    assert.equal(
      harness.calls.some(([name]) => name === "processProjectWorkday"),
      false,
      entry.label
    );
  }
});

test("approval and processing reject mismatched returned links instead of repairing them", async () => {
  const approvalHarness = createHarness({
    linkedRequest: {
      id: "downtime-1",
      craftProjectId: "craft-project-other",
      craftApprovalMutationId: "approve-craft-1"
    }
  });
  await assert.rejects(
    approvalHarness.service.approveRequest({
      requestId: "downtime-1",
      mutationId: "approve-craft-1"
    }),
    /linked craft project ID does not match/iu
  );

  const workdayHarness = createHarness({
    workdayOutcome: {
      activityId: "craft",
      projectId: "craft-project-other",
      hours: 12,
      status: "processed",
      result: { progressGold: 12 }
    }
  });
  await assert.rejects(
    workdayHarness.service.processScheduledSlot({
      id: "downtime-slot-1",
      requestId: "downtime-1",
      activityId: "craft",
      projectId: "craft-project-1",
      isoDate: "2026-07-20",
      hours: 12
    }, {
      isoDate: "2026-07-20",
      transitionId: "calendar-transition-1",
      operationId: "downtime:calendar-transition-1:downtime-slot-1"
    }),
    /workday project ID does not match/iu
  );
});

test("read and lifecycle commands reject malformed or unsupported fields", async () => {
  const quoteHarness = createHarness({
    quote: {
      requestId: "downtime-other",
      signature: "craft-quote-v1-a1b2c3d4"
    }
  });
  await assert.rejects(
    quoteHarness.service.getApprovalQuote({ requestId: "downtime-1" }),
    /quote request ID does not match/iu
  );

  const lifecycleCommands = [
    ["pause", { mutationId: "pause-craft-1", reason: "Wait", isoDate: "2026-07-20" }],
    ["resume", { mutationId: "resume-craft-1", reason: "ignored" }],
    ["cancel", { mutationId: "cancel-craft-1", resume: true }],
    ["reconcile", { mutationId: "reconcile-craft-1", note: "ok", resume: false, repair: true }]
  ];
  for (const [method, options] of lifecycleCommands) {
    const harness = createHarness();
    await assert.rejects(
      harness.service[method]("craft-project-1", options),
      /cannot include unsupported fields/iu,
      method
    );
    assert.deepEqual(harness.calls, [], method);
  }

  const snapshotHarness = createHarness();
  await assert.rejects(
    snapshotHarness.service.getSnapshot({ isoDate: "2026-07-20" }),
    /cannot include unsupported fields/iu
  );
  assert.deepEqual(snapshotHarness.calls, []);
});

test("approval requires an explicit identity receipt from downtime linking", async () => {
  const harness = createHarness({ linkedRequest: { status: "approved" } });

  await assert.rejects(
    harness.service.approveRequest({
      requestId: "downtime-1",
      mutationId: "approve-craft-1"
    }),
    /linked downtime request ID.*stable nonempty ID/iu
  );
});

test("constructor requires the complete injected service contracts", () => {
  assert.throws(
    () => new CraftDowntimeService({ craftingService: {}, downtimeService: {} }),
    /craftingService must implement getSnapshot/iu
  );
});

test("injected service receipts must carry explicit request and project identities", async () => {
  const quoteHarness = createHarness({
    quote: { signature: "craft-quote-v1-a1b2c3d4" }
  });
  await assert.rejects(
    quoteHarness.service.getApprovalQuote({ requestId: "downtime-1" }),
    /quote request ID.*stable nonempty ID/iu
  );

  const approvalHarness = createHarness({
    project: {
      id: "craft-project-1",
      hoursPerDay: 12,
      ownedWorkshop: false
    }
  });
  await assert.rejects(
    approvalHarness.service.approveRequest({
      requestId: "downtime-1",
      mutationId: "approve-craft-1"
    }),
    /project request ID.*stable nonempty ID/iu
  );
  assert.equal(
    approvalHarness.calls.some(([name]) => name === "linkCraftProject"),
    false
  );

  const workdayHarness = createHarness({
    workdayOutcome: {
      activityId: "craft",
      hours: 12,
      status: "processed",
      result: { progressGold: 12 }
    }
  });
  await assert.rejects(
    workdayHarness.service.processScheduledSlot({
      id: "downtime-slot-1",
      requestId: "downtime-1",
      activityId: "craft",
      projectId: "craft-project-1",
      isoDate: "2026-07-20",
      hours: 12
    }, {
      isoDate: "2026-07-20",
      transitionId: "calendar-transition-1",
      operationId: "downtime:calendar-transition-1:downtime-slot-1"
    }),
    /workday project ID.*stable nonempty ID/iu
  );
});

test("RebreyaMainModule wires craft projects into calendar processing and lifecycle APIs", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  globalThis.Hooks = { once() {} };
  globalThis.game = { user: { id: "gm", isGM: true } };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?craft-downtime-wiring=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();

    assert.ok(moduleApi.craftDowntimeService instanceof CraftDowntimeService);
    assert.equal(typeof moduleApi.calendarTransitionCoordinator.activityProcessor, "function");

    const calls = [];
    moduleApi.craftDowntimeService = {
      getSnapshot(options) {
        calls.push(["getSnapshot", options]);
        return { projects: [] };
      },
      getApprovalQuote(input) {
        calls.push(["getApprovalQuote", input]);
        return { requestId: input.requestId, signature: "quote-1" };
      },
      async approveRequest(input) {
        calls.push(["approveRequest", input]);
        return { id: "craft-project-1", crafterActorId: "actor-a" };
      },
      async pause(projectId, options) {
        calls.push(["pause", projectId, options]);
        return { id: projectId, crafterActorId: "actor-a" };
      },
      async resume(projectId, options) {
        calls.push(["resume", projectId, options]);
        return { id: projectId, crafterActorId: "actor-a" };
      },
      async cancel(projectId, options) {
        calls.push(["cancel", projectId, options]);
        return { id: projectId, crafterActorId: "actor-a" };
      },
      async reconcile(projectId, options) {
        calls.push(["reconcile", projectId, options]);
        return { id: projectId, crafterActorId: "actor-a" };
      },
      async processScheduledSlot(slot, context) {
        calls.push(["processScheduledSlot", slot, context]);
        return { projectId: slot.projectId, status: "processed" };
      }
    };
    const refreshes = [];
    moduleApi.refreshDowntimeViews = async (options) => refreshes.push(options);

    assert.deepEqual(await moduleApi.getCraftSnapshot({ search: "sword" }), { projects: [] });
    assert.equal((await moduleApi.getCraftApprovalQuote({ requestId: "downtime-1" })).signature, "quote-1");
    await moduleApi.approveCraftDowntimeRequest({ requestId: "downtime-1", mutationId: "approve-1" });
    await moduleApi.pauseCraftProject("craft-project-1", { mutationId: "pause-1", reason: "wait" });
    await moduleApi.resumeCraftProject("craft-project-1", { mutationId: "resume-1" });
    await moduleApi.cancelCraftProject("craft-project-1", { mutationId: "cancel-1" });
    await moduleApi.reconcileCraftProject("craft-project-1", { mutationId: "reconcile-1", resume: true });
    await moduleApi.calendarTransitionCoordinator.activityProcessor(
      { activityId: "craft", projectId: "craft-project-1" },
      { operationId: "workday-1" }
    );

    assert.deepEqual(calls.map(([name]) => name), [
      "getSnapshot",
      "getApprovalQuote",
      "approveRequest",
      "pause",
      "resume",
      "cancel",
      "reconcile",
      "processScheduledSlot"
    ]);
    assert.deepEqual(refreshes, [
      { actorIds: ["actor-a"] },
      { actorIds: ["actor-a"] },
      { actorIds: ["actor-a"] },
      { actorIds: ["actor-a"] },
      { actorIds: ["actor-a"] }
    ]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});
