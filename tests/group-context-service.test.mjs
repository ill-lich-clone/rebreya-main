import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, REBREYA_GROUP_FLAGS } from "../scripts/constants.js";
import {
  GROUP_CONTEXT_ERRORS,
  buildDefaultGroupState,
  getGroupMemberActorIds,
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
  const originalGame = globalThis.game;
  globalThis.game = { user: { id: "player-1" } };

  try {
    const ownedCharacter = createCharacter("character-a");
    const otherCharacter = createCharacter("character-b", { ownerUserId: "player-2" });
    const unmanagedGroup = createGroup("group-unmanaged", [{ actor: ownedCharacter }], { managed: false });
    const managedGroup = createGroup("group-managed", [{ actor: ownedCharacter }, { actor: otherCharacter }]);

    assert.equal(
      resolvePlayerGroupActor([unmanagedGroup, managedGroup], { userIsGM: false }),
      managedGroup
    );
  }
  finally {
    globalThis.game = originalGame;
  }
});

test("resolvePlayerGroupActor throws when the same Foundry user owns characters in two Rebreya groups", () => {
  const originalGame = globalThis.game;
  globalThis.game = { user: { id: "player-1" } };

  try {
    const firstGroup = createGroup("group-a", [{ actor: createCharacter("character-a") }]);
    const secondGroup = createGroup("group-b", [{ actor: createCharacter("character-b") }]);

    assert.throws(
      () => resolvePlayerGroupActor([firstGroup, secondGroup], { userIsGM: false }),
      (error) => error.message === GROUP_CONTEXT_ERRORS.PLAYER_IN_MULTIPLE_GROUPS
    );
  }
  finally {
    globalThis.game = originalGame;
  }
});
