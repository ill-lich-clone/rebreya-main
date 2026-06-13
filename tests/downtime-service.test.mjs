import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
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
  packs = null
} = {}) {
  const previousGame = globalThis.game;
  const groupActor = createGroup("group-1", members, groupItems);
  let registry = createRegistry(groupActor.id, clone(downtimeState));
  let setRegistryCalls = 0;

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
    assert.equal(balances["actor-a"].availableWeeks, 1);
    assert.equal(balances["actor-a"].reservedWeeks, 1);
    assert.equal(balances["actor-a"].spentWeeks, 2);
    assert.equal(balances["actor-a"].totalGrantedWeeks, 4);
    assert.equal(balances["actor-b"].availableWeeks, 1);
    assert.equal(balances["actor-b"].totalGrantedWeeks, 1);
    assert.equal(getDowntimeState(harness).history[0].type, "revoke");

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
    assert.equal(balances["actor-a"].availableWeeks, 0);
    assert.equal(balances["actor-a"].totalGrantedWeeks, 1);
    assert.equal(balances["actor-b"].availableWeeks, 0);
    assert.equal(balances["actor-b"].totalGrantedWeeks, 0);
    assert.equal(balances["actor-c"].availableWeeks, 1);
    assert.equal(balances["actor-c"].totalGrantedWeeks, 1);
    assert.equal(state.history[0].type, "revoke");
    assert.deepEqual(state.history[0].actorIds, ["actor-b", "actor-c"]);
    assert.deepEqual(state.history[0].skippedActorIds, ["actor-a"]);
    assert.equal(state.history[0].totalRevokedWeeks, 3);
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
    assert.equal(state.balancesByActorId["actor-a"].availableWeeks, 1);
    assert.equal(state.balancesByActorId["actor-a"].reservedWeeks, 2);
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
    assert.equal(state.balancesByActorId["actor-a"].availableWeeks, 2);
    assert.equal(state.balancesByActorId["actor-a"].reservedWeeks, 1);

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
    assert.equal(getDowntimeState(harness).balancesByActorId["actor-a"].availableWeeks, 1);
    assert.equal(getDowntimeState(harness).balancesByActorId["actor-a"].reservedWeeks, 1);
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
    assert.equal(balance.availableWeeks, 0);
    assert.equal(balance.reservedWeeks, 0);
    assert.equal(balance.spentWeeks, 1);
  }
  finally {
    harness.restore();
  }
});

test("continueProject reopens the same long project without duplicating requests", async () => {
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
        }]
      }]
    }
  });

  try {
    const request = await harness.service.continueProject("downtime-project", {
      actorId: actor.id
    });
    const state = getDowntimeState(harness);
    const balance = state.balancesByActorId["actor-a"];

    assert.equal(state.requests.length, 1);
    assert.equal(request.status, "pending");
    assert.equal(request.checks.find((check) => check.id === "long-project-counter").projectCounter.current, 3);
    assert.equal(request.checks.find((check) => check.id === "long-project-check").result, null);
    assert.equal(request.checks.find((check) => check.id === "long-project-result").result, null);
    assert.equal(balance.availableWeeks, 0);
    assert.equal(balance.reservedWeeks, 1);
    assert.equal(balance.spentWeeks, 1);
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
    assert.deepEqual(state.history, []);
    assert.equal(state.counter, 0);
    assert.equal(state.balancesByActorId["actor-a"].availableWeeks, 2);
    assert.equal(state.balancesByActorId["actor-a"].reservedWeeks, 0);
    assert.equal(state.balancesByActorId["actor-a"].spentWeeks, 1);
    assert.equal(state.balancesByActorId["actor-a"].totalGrantedWeeks, 3);
    assert.equal(state.balancesByActorId["actor-b"].availableWeeks, 2);
    assert.equal(state.balancesByActorId["actor-b"].spentWeeks, 1);
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
    assert.equal(balance.reservedWeeks, 0);
    assert.equal(balance.spentWeeks, 1);
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
    assert.equal(balance.reservedWeeks, 1);
    assert.equal(balance.spentWeeks, 0);
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

test("RebreyaMainModule exposes downtime service API and refreshes after mutations", async () => {
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
    moduleApi.refreshOpenApps = async () => {
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

test("RebreyaMainModule applies setSetting socket messages on the GM client", async () => {
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
      isGM: true
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
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };

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

    assert.deepEqual(settingsStore[`${MODULE_ID}.${SETTINGS_KEYS.GROUP_STATE}`], {
      value: {
        version: 1,
        groupsById: {}
      },
      options: {
        render: false
      }
    });
    assert.equal(refreshCount, 1);
    assert.deepEqual(emitted, [[
      `module.${MODULE_ID}`,
      {
        type: "setSettingResult",
        requestId: "settings-test-1",
        forUserId: "player-1",
        senderId: "gm",
        ok: true,
        data: {
          version: 1,
          groupsById: {}
        }
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
        render() {
          renderCalls.push("openSheet");
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
    const { RebreyaMainModule } = await import(`../scripts/main.js?downtime-quiet-actor-refresh=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();

    await moduleApi.handleSocketMessage({
      type: "downtime-updated",
      senderId: "gm",
      actorIds: ["actor-a"],
      requestId: "downtime-1"
    });

    assert.deepEqual([...new Set(renderCalls)].sort(), ["openSheet", "openV2"]);
    assert.equal(renderCalls.includes("closedSheet"), false);
    assert.equal(renderCalls.includes("closedV2"), false);
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

    assert.equal(refreshCount, 1);
    assert.equal(renderCount, 0);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
  }
});

test("RebreyaMainModule does not render player sheets when GM updates a downtime request", async () => {
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

    assert.equal(refreshCount, 1);
    assert.equal(renderCount, 0);
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
    moduleApi.refreshOpenApps = async () => {
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
      isGM: true
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

test("RebreyaMainModule GM creates socket downtime requests without activating inventory windows", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  globalThis.Hooks = {
    once() {}
  };
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
      isGM: true
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
    ]]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
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
      isGM: true
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
