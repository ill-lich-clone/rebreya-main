import test from "node:test";
import assert from "node:assert/strict";

import { DowntimeService } from "../scripts/data/downtime-service.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

function createGroup(id, members = []) {
  return {
    id,
    name: "Party",
    type: "group",
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
  downtimeState = {}
} = {}) {
  const previousGame = globalThis.game;
  const groupActor = createGroup("group-1", members);
  let registry = createRegistry(groupActor.id, clone(downtimeState));
  let setRegistryCalls = 0;

  globalThis.game = {
    user
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
    getRegistry() {
      return clone(registry);
    },
    async setRegistry(nextRegistry) {
      setRegistryCalls += 1;
      registry = clone(nextRegistry);
      return clone(registry);
    }
  };

  return {
    service: new DowntimeService({ groupContextService }),
    groupActor,
    get registry() {
      return registry;
    },
    get setRegistryCalls() {
      return setRegistryCalls;
    },
    restore() {
      globalThis.game = previousGame;
    }
  };
}

function getDowntimeState(harness) {
  return harness.registry.groupsById["group-1"].downtimeState;
}

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
    assert.equal(balances["actor-a"].availableWeeks, 3);
    assert.equal(balances["actor-a"].totalGrantedWeeks, 3);
    assert.equal(balances["actor-b"].availableWeeks, 2);
    assert.equal(balances["actor-b"].totalGrantedWeeks, 2);
    assert.equal(balances["stale-actor"].availableWeeks, 5);
    assert.equal(harness.setRegistryCalls, 1);
  }
  finally {
    harness.restore();
  }
});

test("createRequest by player reserves weeks for an owned current member", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A", ownerUserId: "player-1" });
  const actorB = createActor({ id: "actor-b", name: "Hero B", ownerUserId: "player-2" });
  const harness = createHarness({
    user: { id: "player-1", isGM: false },
    members: [actorA, actorB],
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
      actionId: "training",
      title: "Train",
      description: "Practice",
      weeks: 2
    });
    const state = getDowntimeState(harness);

    assert.equal(request.id, "downtime-1");
    assert.equal(request.actorId, "actor-a");
    assert.equal(request.actionId, "training");
    assert.equal(request.status, "pending");
    assert.equal(request.submittedByUserId, "player-1");
    assert.equal(state.balancesByActorId["actor-a"].availableWeeks, 1);
    assert.equal(state.balancesByActorId["actor-a"].reservedWeeks, 2);
  }
  finally {
    harness.restore();
  }
});

test("createRequest recovers counter from existing request ids in direct service state", async () => {
  const actorA = createActor({ id: "actor-a", name: "Hero A" });
  const harness = createHarness({
    members: [actorA],
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
      actionId: "unique",
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
      assert.equal(balance.availableWeeks, 3);
      assert.equal(balance.reservedWeeks, 0);
      assert.equal(balance.spentWeeks, 0);
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
    assert.equal(balance.availableWeeks, 1);
    assert.equal(balance.reservedWeeks, 0);
    assert.equal(balance.spentWeeks, 2);
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
        checks: [],
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
  }
  finally {
    harness.restore();
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

test("getActionCatalog exposes the first downtime action slice", () => {
  const harness = createHarness();

  try {
    assert.deepEqual(
      harness.service.getActionCatalog().map((action) => action.id),
      [
        "craft",
        "firearm",
        "magicItem",
        "profession",
        "rest",
        "research",
        "training",
        "gambling",
        "tournament",
        "carouse",
        "buyMagicItem",
        "changeSubclass",
        "alchemy",
        "longProject",
        "construct",
        "unique"
      ]
    );
    assert.deepEqual(
      harness.service.getActionCatalog().map((action) => action.label),
      [
        "Крафт",
        "Огнестрельное оружие",
        "Магический предмет",
        "Профессия",
        "Отдых",
        "Исследование",
        "Тренировка",
        "Азартные игры",
        "Турнир",
        "Кутеж",
        "Покупка магического предмета",
        "Смена подкласса",
        "Алхимия",
        "Долгий проект",
        "Строительство",
        "Уникальная заявка"
      ]
    );
  }
  finally {
    harness.restore();
  }
});

test("RebreyaMainModule exposes downtime service API and refreshes after mutations", async () => {
  const previousHooks = globalThis.Hooks;
  globalThis.Hooks = {
    once() {}
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
      getActionCatalog() {
        calls.push(["getActionCatalog"]);
        return [{ id: "unique" }];
      }
    };

    let refreshCount = 0;
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };

    assert.deepEqual(moduleApi.getDowntimeSnapshot({ actorId: "actor-a" }), { options: { actorId: "actor-a" } });
    assert.deepEqual(moduleApi.getDowntimeActionCatalog(), [{ id: "unique" }]);
    assert.equal(refreshCount, 0);

    assert.deepEqual(await moduleApi.grantDowntimeWeeks({ weeks: 2 }), { granted: { weeks: 2 } });
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

    assert.equal(refreshCount, 5);
    assert.deepEqual(calls, [
      ["getSnapshot", { actorId: "actor-a" }],
      ["getActionCatalog"],
      ["grantWeeks", { weeks: 2 }],
      ["createRequest", { actorId: "actor-a" }],
      ["setRequestStatus", "downtime-1", "approved", { result: "ok" }],
      ["setRequestChecks", "downtime-1", [{ id: "check-1" }]],
      ["recordCheckResult", "downtime-1", "check-1", { total: 17 }]
    ]);
  }
  finally {
    globalThis.Hooks = previousHooks;
  }
});
