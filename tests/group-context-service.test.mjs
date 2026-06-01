import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../scripts/constants.js";
import {
  GROUP_CONTEXT_ERRORS,
  GroupContextService,
  buildDefaultGroupState,
  getGroupMemberActorIds,
  normalizeGroupState,
  normalizeGroupRegistry,
  resolvePlayerGroupActor
} from "../scripts/data/group-context-service.js";

function createCharacter(id, { ownerUserId = "player-1", type = "character" } = {}) {
  return {
    id,
    type,
    ownership: {
      [ownerUserId]: 3
    }
  };
}

function createGroup(id, members = [], { managed = true } = {}) {
  return {
    id,
    type: "group",
    system: {
      members
    },
    flags: {
      [MODULE_ID]: {
        [REBREYA_GROUP_FLAGS.MANAGED]: managed
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = value;
      return value;
    }
  };
}

function installGameFixture({ actors = [], user = { id: "gm", isGM: true }, registry = {} } = {}) {
  const originalGame = globalThis.game;
  const settingsStore = {
    [SETTINGS_KEYS.GROUP_STATE]: registry
  };

  globalThis.game = {
    user,
    actors: {
      contents: actors,
      get: (actorId) => actors.find((actor) => actor.id === actorId) ?? null
    },
    settings: {
      get: (moduleId, key) => moduleId === MODULE_ID ? settingsStore[key] : undefined,
      set: async (moduleId, key, value) => {
        if (moduleId === MODULE_ID) {
          settingsStore[key] = value;
        }
        return value;
      }
    }
  };

  return {
    settingsStore,
    restore: () => {
      globalThis.game = originalGame;
    }
  };
}

test("normalizeGroupRegistry preserves active group and per-group state", () => {
  const registry = normalizeGroupRegistry({
    version: 1,
    activeGroupActorId: "group-a",
    groupsById: {
      "group-a": {
        version: 1,
        groupActorId: "group-a",
        initializedAt: 123,
        calendar: { day: 17 },
        traderState: { selectedTraderId: "merchant-a" },
        tradeAudit: [{ id: "audit-a" }],
        globalEventsState: { season: "rain" },
        craftState: { queue: ["item-a"] },
        downtimeState: {
          balancesByActorId: { "actor-a": 4 },
          requests: [{ id: "request-a" }],
          checks: [{ id: "check-a" }],
          history: [{ id: "history-a" }]
        },
        migration: {
          legacyInventoryMergedAt: 456,
          legacyInventoryActorId: "legacy-party"
        }
      }
    }
  });

  assert.equal(registry.activeGroupActorId, "group-a");
  assert.deepEqual(registry.groupsById["group-a"], {
    version: 1,
    groupActorId: "group-a",
    initializedAt: 123,
    calendar: { day: 17 },
    traderState: { selectedTraderId: "merchant-a" },
    tradeAudit: [{ id: "audit-a" }],
    globalEventsState: { season: "rain" },
    craftState: { queue: ["item-a"] },
    downtimeState: {
      balancesByActorId: { "actor-a": 4 },
      requests: [{ id: "request-a" }],
      checks: [{ id: "check-a" }],
      history: [{ id: "history-a" }]
    },
    migration: {
      legacyInventoryMergedAt: 456,
      legacyInventoryActorId: "legacy-party"
    }
  });
});

test("normalizeGroupRegistry keeps outer registry key when nested groupActorId is corrupt", () => {
  const registry = normalizeGroupRegistry({
    groupsById: {
      "group-a": {
        groupActorId: "group-b",
        initializedAt: 123
      }
    }
  });

  assert.deepEqual(Object.keys(registry.groupsById), ["group-a"]);
  assert.equal(registry.groupsById["group-a"].groupActorId, "group-a");
});

test("normalizeGroupState uses deterministic initializedAt fallback", () => {
  assert.equal(normalizeGroupState("group-a", {}).initializedAt, 0);
  assert.equal(normalizeGroupState("group-a", { initializedAt: "bad" }).initializedAt, 0);
});

test("buildDefaultGroupState creates file-backed empty runtime state without legacy inventory", () => {
  const state = buildDefaultGroupState("group-a", { now: 789 });

  assert.deepEqual(state, {
    version: 1,
    groupActorId: "group-a",
    initializedAt: 789,
    calendar: {},
    traderState: {},
    tradeAudit: [],
    globalEventsState: {},
    craftState: {},
    downtimeState: {
      balancesByActorId: {},
      requests: [],
      checks: [],
      history: []
    },
    migration: {
      legacyInventoryMergedAt: 0,
      legacyInventoryActorId: ""
    }
  });
  assert.equal(Object.hasOwn(state, "inventory"), false);
  assert.equal(Object.hasOwn(state, "partyState"), false);
});

test("getGroupMemberActorIds reads only system.members actor ids", () => {
  const group = {
    system: {
      members: [
        { actor: { id: "actor-a" }, actorId: "ignored-a" },
        { actorId: "ignored-b" },
        { actor: { _id: "ignored-c" } },
        { actor: { id: "actor-b" } }
      ],
      actors: [{ id: "ignored-legacy" }]
    }
  };

  assert.deepEqual(getGroupMemberActorIds(group), ["actor-a", "actor-b"]);
});

test("resolvePlayerGroupActor returns the single managed group containing the current player's owned character", () => {
  const ownedCharacter = createCharacter("character-a");
  const otherCharacter = createCharacter("character-b", { ownerUserId: "player-2" });
  const unmanagedGroup = createGroup("group-unmanaged", [{ actor: ownedCharacter }], { managed: false });
  const managedGroup = createGroup("group-managed", [{ actor: ownedCharacter }, { actor: otherCharacter }]);

  assert.equal(
    resolvePlayerGroupActor([unmanagedGroup, managedGroup], {
      userIsGM: false,
      isOwnedCharacter: (actor) => actor.id === ownedCharacter.id
    }),
    managedGroup
  );
});

test("resolvePlayerGroupActor throws when the same Foundry user owns characters in two Rebreya groups", () => {
  const firstGroup = createGroup("group-a", [{ actor: createCharacter("character-a") }]);
  const secondGroup = createGroup("group-b", [{ actor: createCharacter("character-b") }]);

  assert.throws(
    () => resolvePlayerGroupActor([firstGroup, secondGroup], {
      userIsGM: false,
      isOwnedCharacter: (actor) => actor.type === "character"
    }),
    (error) => error.message === GROUP_CONTEXT_ERRORS.PLAYER_IN_MULTIPLE_GROUPS
  );
});

test("GroupContextService registerGroup sets managed flag, creates state, and selects first active group", async () => {
  const originalNow = Date.now;
  Date.now = () => 1000;
  const group = createGroup("group-a", [], { managed: false });
  const fixture = installGameFixture({ actors: [group], registry: {} });

  try {
    const service = new GroupContextService();
    const state = await service.registerGroup("group-a");
    const registry = fixture.settingsStore[SETTINGS_KEYS.GROUP_STATE];

    assert.equal(group.getFlag(MODULE_ID, REBREYA_GROUP_FLAGS.MANAGED), true);
    assert.equal(registry.activeGroupActorId, "group-a");
    assert.equal(registry.groupsById["group-a"].initializedAt, 1000);
    assert.deepEqual(state, registry.groupsById["group-a"]);
  }
  finally {
    Date.now = originalNow;
    fixture.restore();
  }
});

test("GroupContextService setActiveGroup sets managed flag and active id", async () => {
  const originalNow = Date.now;
  Date.now = () => 2000;
  const group = createGroup("group-b", [], { managed: false });
  const fixture = installGameFixture({ actors: [group], registry: {} });

  try {
    const service = new GroupContextService();
    const state = await service.setActiveGroup("group-b");
    const registry = fixture.settingsStore[SETTINGS_KEYS.GROUP_STATE];

    assert.equal(group.getFlag(MODULE_ID, REBREYA_GROUP_FLAGS.MANAGED), true);
    assert.equal(registry.activeGroupActorId, "group-b");
    assert.equal(state.initializedAt, 2000);
  }
  finally {
    Date.now = originalNow;
    fixture.restore();
  }
});

test("GroupContextService GM resolveForCurrentUser uses active group", () => {
  const group = createGroup("group-a");
  const fixture = installGameFixture({
    actors: [group],
    user: { id: "gm", isGM: true },
    registry: {
      activeGroupActorId: "group-a",
      groupsById: {
        "group-a": buildDefaultGroupState("group-a", { now: 333 })
      }
    }
  });

  try {
    const context = new GroupContextService().resolveForCurrentUser();

    assert.equal(context.groupActor, group);
    assert.equal(context.groupId, "group-a");
    assert.equal(context.groupState.initializedAt, 333);
    assert.equal(context.canManage, true);
  }
  finally {
    fixture.restore();
  }
});

test("GroupContextService non-GM resolveForCurrentUser uses owned-character membership", () => {
  const ownedCharacter = createCharacter("character-a", { ownerUserId: "player-1" });
  const otherCharacter = createCharacter("character-b", { ownerUserId: "player-2" });
  const playerGroup = createGroup("group-player", [{ actor: ownedCharacter }]);
  const otherGroup = createGroup("group-other", [{ actor: otherCharacter }]);
  const fixture = installGameFixture({
    actors: [playerGroup, otherGroup],
    user: { id: "player-1", isGM: false },
    registry: {
      groupsById: {
        "group-player": buildDefaultGroupState("group-player", { now: 444 })
      }
    }
  });

  try {
    const context = new GroupContextService().resolveForCurrentUser();

    assert.equal(context.groupActor, playerGroup);
    assert.deepEqual(context.memberActorIds, ["character-a"]);
    assert.equal(context.canManage, true);
  }
  finally {
    fixture.restore();
  }
});
