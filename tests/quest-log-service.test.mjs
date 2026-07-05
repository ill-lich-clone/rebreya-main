import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDefaultGroupState,
  normalizeGroupState,
  normalizeGroupRegistry
} from "../scripts/data/group-context-service.js";
import {
  REBREYA_QUEST_FLAGS,
  RebreyaQuestLogService,
  normalizeQuestMetadata
} from "../scripts/data/quest-log-service.js";

function createQuest(id, options = {}) {
  const {
    name = id,
    status = "inactive",
    parent = null,
    subquests = [],
    tasks = [],
    rewards = [],
    metadata = {},
    ownership = { default: 2 }
  } = options;

  const entry = {
    id,
    name,
    ownership: { ...ownership },
    flags: {
      "rebreya-main": {
        [REBREYA_QUEST_FLAGS.METADATA]: metadata
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = value;
      return value;
    },
    async update(update = {}) {
      if (update.ownership) {
        this.ownership = update.ownership;
      }
      if (update.flags) {
        for (const [scope, scopedFlags] of Object.entries(update.flags)) {
          this.flags[scope] = {
            ...(this.flags[scope] ?? {}),
            ...scopedFlags
          };
        }
      }
      return this;
    }
  };

  return {
    id,
    name,
    status,
    parent,
    subquests: [...subquests],
    tasks: [...tasks],
    rewards: [...rewards],
    entry,
    date: { create: 10, start: null, end: null },
    toJSON() {
      return {
        name: this.name,
        status: this.status,
        parent: this.parent,
        subquests: [...this.subquests],
        tasks: [...this.tasks],
        rewards: [...this.rewards],
        date: { ...this.date }
      };
    },
    async save() {
      this.entry.name = this.name;
      return this.id;
    },
    async setStatus(target) {
      this.status = target;
      return this.id;
    }
  };
}

function installOwnershipFixture(users = []) {
  const previousGame = globalThis.game;
  const previousConst = globalThis.CONST;

  globalThis.CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: {
      NONE: 0,
      LIMITED: 1,
      OBSERVER: 2,
      OWNER: 3
    }
  };
  globalThis.game = {
    users: {
      contents: users,
      get: (userId) => users.find((user) => user.id === userId) ?? null
    }
  };

  return () => {
    globalThis.game = previousGame;
    globalThis.CONST = previousConst;
  };
}

function createGroupContextService(groupContext, registry = {}) {
  let currentRegistry = normalizeGroupRegistry(registry);

  return {
    resolveForGroup(groupActorId) {
      assert.equal(groupActorId, groupContext.groupId);
      return groupContext;
    },
    resolveForCurrentUser() {
      return groupContext;
    },
    getRegistry() {
      return currentRegistry;
    },
    async setRegistry(value) {
      currentRegistry = normalizeGroupRegistry(value);
      return currentRegistry;
    }
  };
}

test("group state preserves Rebreya quest unlock state", () => {
  const state = normalizeGroupState("group-a", {
    questState: {
      unlocksByQuestId: {
        "quest-b": {
          "req-a": {
            unlockedAt: 123,
            sourceQuestId: "quest-a",
            sourceRewardId: "reward-a"
          }
        }
      }
    }
  });

  assert.deepEqual(state.questState, {
    unlocksByQuestId: {
      "quest-b": {
        "req-a": {
          unlockedAt: 123,
          sourceQuestId: "quest-a",
          sourceRewardId: "reward-a"
        }
      }
    }
  });
});

test("default group state includes an empty quest state", () => {
  assert.deepEqual(buildDefaultGroupState("group-a", { now: 111 }).questState, {
    unlocksByQuestId: {}
  });
});

test("group registry normalizes quest state for every group", () => {
  const registry = normalizeGroupRegistry({
    activeGroupActorId: "group-a",
    groupsById: {
      "group-a": {
        questState: {
          unlocksByQuestId: {
            "quest-b": {
              "req-a": {
                unlockedAt: 123,
                sourceQuestId: "quest-a",
                sourceRewardId: "reward-a"
              }
            }
          }
        }
      }
    }
  });

  assert.deepEqual(registry.groupsById["group-a"].questState.unlocksByQuestId["quest-b"]["req-a"], {
    unlockedAt: 123,
    sourceQuestId: "quest-a",
    sourceRewardId: "reward-a"
  });
});

test("quest metadata normalizes groups, requirements, and unlock rewards", () => {
  const metadata = normalizeQuestMetadata({
    groupActorIds: [" group-a ", "", "group-a", "group-b"],
    requirements: [
      {
        id: " req-a ",
        type: "quest",
        questId: " quest-a ",
        title: "Complete A",
        status: "completed"
      },
      { id: "", questId: "missing" }
    ],
    unlockRewards: [
      {
        id: " reward-a ",
        targetQuestId: " quest-b ",
        requirementId: " req-b ",
        title: "Open B"
      },
      { id: "", targetQuestId: "missing" }
    ]
  });

  assert.deepEqual(metadata, {
    version: 1,
    groupActorIds: ["group-a", "group-b"],
    requirements: [
      {
        id: "req-a",
        type: "quest",
        questId: "quest-a",
        title: "Complete A",
        status: "completed"
      }
    ],
    unlockRewards: [
      {
        id: "reward-a",
        targetQuestId: "quest-b",
        requirementId: "req-b",
        title: "Open B"
      }
    ]
  });
});

test("assignQuestToGroup stores group metadata and member observer ownership", async () => {
  const restore = installOwnershipFixture([
    { id: "gm", isGM: true },
    { id: "player-a", isGM: false },
    { id: "player-b", isGM: false }
  ]);
  const quest = createQuest("quest-a");
  const member = {
    id: "actor-a",
    type: "character",
    ownership: { "player-a": 3 }
  };
  const groupContextService = createGroupContextService({
    groupId: "group-a",
    groupActor: { id: "group-a", type: "group" },
    members: [member],
    memberActorIds: ["actor-a"],
    groupState: buildDefaultGroupState("group-a")
  });
  const service = new RebreyaQuestLogService({
    groupContextService,
    getFqlApi: () => ({ DB: { getQuest: () => quest } })
  });

  try {
    await service.assignQuestToGroup("quest-a", "group-a");

    assert.deepEqual(quest.entry.getFlag("rebreya-main", REBREYA_QUEST_FLAGS.METADATA).groupActorIds, ["group-a"]);
    assert.deepEqual(quest.entry.ownership, {
      default: 0,
      "player-a": 2
    });
  }
  finally {
    restore();
  }
});

test("filterQuestEntriesForGroup keeps only quests assigned to the active group", () => {
  const groupAQuest = createQuest("quest-a", { metadata: { groupActorIds: ["group-a"] } });
  const groupBQuest = createQuest("quest-b", { metadata: { groupActorIds: ["group-b"] } });
  const globalQuest = createQuest("quest-c");
  const service = new RebreyaQuestLogService({
    groupContextService: createGroupContextService({
      groupId: "group-a",
      groupActor: { id: "group-a", type: "group" },
      members: [],
      memberActorIds: [],
      groupState: buildDefaultGroupState("group-a")
    })
  });

  const result = service.filterQuestEntriesForGroup(
    [
      { id: "quest-a", quest: groupAQuest },
      { id: "quest-b", quest: groupBQuest },
      { id: "quest-c", quest: globalQuest }
    ],
    "group-a"
  );

  assert.deepEqual(result.map((entry) => entry.id), ["quest-a"]);
});

test("filterQuestCollectResult reflects the active group selected for each refresh", () => {
  const groupAQuest = createQuest("quest-a", { metadata: { groupActorIds: ["group-a"] } });
  const groupBQuest = createQuest("quest-b", { metadata: { groupActorIds: ["group-b"] } });
  const service = new RebreyaQuestLogService();
  const collectResult = {
    active: [
      { id: "quest-a", quest: groupAQuest },
      { id: "quest-b", quest: groupBQuest }
    ],
    completed: []
  };

  assert.deepEqual(
    service.filterQuestCollectResult(collectResult, "group-a").active.map((entry) => entry.id),
    ["quest-a"]
  );
  assert.deepEqual(
    service.filterQuestCollectResult(collectResult, "group-b").active.map((entry) => entry.id),
    ["quest-b"]
  );
});

test("requirements are satisfied by completed source quests or group unlock state", () => {
  const sourceQuest = createQuest("quest-a", { status: "completed" });
  const lockedQuest = createQuest("quest-b", {
    metadata: {
      requirements: [
        { id: "req-complete-a", type: "quest", questId: "quest-a", title: "A", status: "completed" },
        { id: "req-reward", type: "quest", questId: "quest-c", title: "Reward gate", status: "completed" }
      ]
    }
  });
  const service = new RebreyaQuestLogService({
    groupContextService: createGroupContextService({
      groupId: "group-a",
      groupActor: { id: "group-a", type: "group" },
      members: [],
      memberActorIds: [],
      groupState: normalizeGroupState("group-a", {
        questState: {
          unlocksByQuestId: {
            "quest-b": {
              "req-reward": {
                unlockedAt: 222,
                sourceQuestId: "quest-reward",
                sourceRewardId: "reward-a"
              }
            }
          }
        }
      })
    }),
    getFqlApi: () => ({ DB: { getQuest: (questId) => questId === "quest-a" ? sourceQuest : lockedQuest } })
  });

  const evaluation = service.evaluateRequirements("quest-b", "group-a");

  assert.equal(evaluation.satisfied, true);
  assert.deepEqual(evaluation.requirements.map((requirement) => requirement.unlocked), [false, true]);
});

test("unlock rewards open a target requirement for the selected group", async () => {
  const sourceQuest = createQuest("quest-a", {
    metadata: {
      unlockRewards: [
        {
          id: "reward-a",
          targetQuestId: "quest-b",
          requirementId: "req-b",
          title: "Open B"
        }
      ]
    }
  });
  const targetQuest = createQuest("quest-b", {
    status: "inactive",
    metadata: {
      groupActorIds: ["group-a"],
      requirements: [
        { id: "req-b", type: "quest", questId: "quest-a", title: "Open B", status: "completed" }
      ]
    }
  });
  const groupState = buildDefaultGroupState("group-a", { now: 111 });
  const groupContextService = createGroupContextService(
    {
      groupId: "group-a",
      groupActor: { id: "group-a", type: "group" },
      members: [],
      memberActorIds: [],
      groupState
    },
    {
      activeGroupActorId: "group-a",
      groupsById: {
        "group-a": groupState
      }
    }
  );
  const service = new RebreyaQuestLogService({
    groupContextService,
    now: () => 555,
    getFqlApi: () => ({
      DB: {
        getQuest: (questId) => questId === "quest-a" ? sourceQuest : targetQuest
      }
    })
  });

  const result = await service.applyUnlockReward("quest-a", "reward-a", { groupActorId: "group-a" });

  assert.equal(result.targetQuestId, "quest-b");
  assert.equal(result.requirementId, "req-b");
  assert.equal(targetQuest.status, "available");
  assert.deepEqual(
    groupContextService.getRegistry().groupsById["group-a"].questState.unlocksByQuestId["quest-b"]["req-b"],
    {
      unlockedAt: 555,
      sourceQuestId: "quest-a",
      sourceRewardId: "reward-a"
    }
  );
});

test("requirements can be edited and removed from quest metadata", async () => {
  const sourceQuestA = createQuest("quest-a", { name: "Quest A", status: "completed" });
  const sourceQuestB = createQuest("quest-b", { name: "Quest B", status: "active" });
  const currentQuest = createQuest("quest-current", {
    metadata: {
      requirements: [
        {
          id: "req-a",
          type: "quest",
          questId: "quest-a",
          title: "Old gate",
          status: "completed"
        }
      ]
    }
  });
  const quests = {
    "quest-a": sourceQuestA,
    "quest-b": sourceQuestB,
    "quest-current": currentQuest
  };
  const service = new RebreyaQuestLogService({
    getFqlApi: () => ({ DB: { getQuest: (questId) => quests[questId] ?? null } })
  });

  const updated = await service.updateRequirement("quest-current", "req-a", {
    type: "quest",
    requiredQuestId: "quest-b",
    title: "Need B",
    status: "active"
  });

  assert.deepEqual(updated, {
    id: "req-a",
    type: "quest",
    questId: "quest-b",
    title: "Need B",
    status: "active"
  });
  assert.deepEqual(
    currentQuest.entry.getFlag("rebreya-main", REBREYA_QUEST_FLAGS.METADATA).requirements,
    [updated]
  );

  await service.removeRequirement("quest-current", "req-a");
  assert.deepEqual(
    currentQuest.entry.getFlag("rebreya-main", REBREYA_QUEST_FLAGS.METADATA).requirements,
    []
  );
});

test("unlock rewards can be removed from quest metadata", async () => {
  const currentQuest = createQuest("quest-current", {
    metadata: {
      unlockRewards: [
        {
          id: "reward-a",
          targetQuestId: "quest-target",
          requirementId: "req-target",
          title: "Open target"
        }
      ]
    }
  });
  const service = new RebreyaQuestLogService({
    getFqlApi: () => ({ DB: { getQuest: () => currentQuest } })
  });

  const removed = await service.removeUnlockReward("quest-current", "reward-a");

  assert.equal(removed.id, "reward-a");
  assert.deepEqual(
    currentQuest.entry.getFlag("rebreya-main", REBREYA_QUEST_FLAGS.METADATA).unlockRewards,
    []
  );
});

test("importQuestIntoParent clones a source quest as a grouped subquest", async () => {
  const sourceQuest = createQuest("quest-source", {
    name: "Source",
    status: "completed",
    parent: "old-parent",
    subquests: ["old-child"],
    tasks: [{ name: "Do it" }],
    rewards: [{ type: "abstract", data: { name: "Gold" } }]
  });
  const parentQuest = createQuest("quest-parent", {
    metadata: { groupActorIds: ["group-a"] }
  });
  let createQuestInput = null;
  const importedQuest = createQuest("quest-imported", {
    name: "Source",
    parent: "quest-parent"
  });
  const service = new RebreyaQuestLogService({
    groupContextService: createGroupContextService({
      groupId: "group-a",
      groupActor: { id: "group-a", type: "group" },
      members: [],
      memberActorIds: [],
      groupState: buildDefaultGroupState("group-a")
    }),
    getFqlApi: () => ({
      DB: {
        getQuest: (questId) => questId === "quest-source" ? sourceQuest : parentQuest,
        createQuest: async (input) => {
          createQuestInput = input;
          return importedQuest;
        }
      }
    })
  });

  const result = await service.importQuestIntoParent("quest-source", "quest-parent", { groupActorId: "group-a" });

  assert.equal(result.id, "quest-imported");
  assert.equal(createQuestInput.parentId, "quest-parent");
  assert.deepEqual(createQuestInput.data, {
    name: "Source",
    status: "inactive",
    parent: null,
    subquests: [],
    tasks: [{ name: "Do it" }],
    rewards: [{ type: "abstract", data: { name: "Gold" } }],
    date: { create: 10, start: null, end: null }
  });
  assert.deepEqual(importedQuest.entry.getFlag("rebreya-main", REBREYA_QUEST_FLAGS.METADATA).groupActorIds, ["group-a"]);
});

test("getQuestOverlayContext builds selectable quests and unlock targets", () => {
  const currentQuest = createQuest("quest-current", {
    metadata: {
      groupActorIds: ["group-a"],
      unlockRewards: [
        {
          id: "reward-a",
          targetQuestId: "quest-target",
          requirementId: "req-target",
          title: "Open target"
        }
      ]
    }
  });
  const requiredQuest = createQuest("quest-required", { name: "Required", status: "completed" });
  const targetQuest = createQuest("quest-target", {
    name: "Target",
    metadata: {
      groupActorIds: ["group-a"],
      requirements: [
        {
          id: "req-target",
          type: "quest",
          questId: "quest-required",
          title: "Target gate",
          status: "completed"
        }
      ]
    }
  });
  const groupState = buildDefaultGroupState("group-a", { now: 111 });
  const service = new RebreyaQuestLogService({
    groupContextService: createGroupContextService({
      groupId: "group-a",
      groupActor: { id: "group-a", name: "Party A", type: "group" },
      members: [],
      memberActorIds: [],
      groupState
    }),
    getFqlApi: () => ({
      DB: {
        getAllQuests: () => [currentQuest, requiredQuest, targetQuest],
        getQuest: (questId) => ({
          "quest-current": currentQuest,
          "quest-required": requiredQuest,
          "quest-target": targetQuest
        })[questId] ?? null
      }
    })
  });

  const context = service.getQuestOverlayContext("quest-current", "group-a");

  assert.equal(context.groupName, "Party A");
  assert.equal(context.assignedToCurrentGroup, true);
  assert.deepEqual(context.questOptions.map((quest) => quest.id), ["quest-required", "quest-target"]);
  assert.deepEqual(context.unlockTargets, [
    {
      questId: "quest-target",
      questName: "Target",
      requirementId: "req-target",
      title: "Target gate"
    }
  ]);
  assert.deepEqual(context.unlockRewards, [
    {
      id: "reward-a",
      targetQuestId: "quest-target",
      requirementId: "req-target",
      title: "Open target",
      targetQuestName: "Target",
      requirementTitle: "Target gate",
      applied: false
    }
  ]);
});

test("getQuestOverlayContext exposes editable requirement type, quest, and status options", () => {
  const currentQuest = createQuest("quest-current", {
    metadata: {
      groupActorIds: ["group-a"],
      requirements: [
        {
          id: "req-current",
          type: "quest",
          questId: "quest-required",
          title: "Current gate",
          status: "failed"
        }
      ]
    }
  });
  const requiredQuest = createQuest("quest-required", { name: "Required", status: "completed" });
  const otherQuest = createQuest("quest-other", { name: "Other", status: "available" });
  const groupState = buildDefaultGroupState("group-a", { now: 111 });
  const service = new RebreyaQuestLogService({
    groupContextService: createGroupContextService({
      groupId: "group-a",
      groupActor: { id: "group-a", name: "Party A", type: "group" },
      members: [],
      memberActorIds: [],
      groupState
    }),
    getFqlApi: () => ({
      DB: {
        getAllQuests: () => [currentQuest, requiredQuest, otherQuest],
        getQuest: (questId) => ({
          "quest-current": currentQuest,
          "quest-required": requiredQuest,
          "quest-other": otherQuest
        })[questId] ?? null
      }
    })
  });

  const context = service.getQuestOverlayContext("quest-current", "group-a");
  const requirement = context.requirements[0];

  assert.equal(requirement.typeOptions.find((option) => option.value === "quest").selected, true);
  assert.equal(requirement.questOptions.find((option) => option.id === "quest-required").selected, true);
  assert.equal(requirement.statusOptions.find((option) => option.value === "failed").selected, true);
  assert.deepEqual(context.requirementTypeOptions, [
    {
      value: "quest",
      label: "Задание"
    }
  ]);
  assert.deepEqual(context.requirementStatusOptions.map((option) => option.value), [
    "completed",
    "failed",
    "available",
    "active",
    "inactive"
  ]);
});
