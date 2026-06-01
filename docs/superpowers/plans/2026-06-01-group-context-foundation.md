# Group Context Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working slice of the approved group-context design: Rebreya registers existing dnd5e group actors, resolves the current group for GMs and players, stores per-group state, and moves the current Rebreya inventory workflow onto the selected group actor.

**Architecture:** Add a `GroupContextService` as the only resolver for current group state. Keep dnd5e `Actor` type `group` as the source of truth for members and inventory; store Rebreya runtime state in a world registry keyed by group actor id. Update the existing inventory path to use the resolved group actor while preserving a one-time legacy inventory merge path.

**Tech Stack:** Foundry VTT v13, dnd5e 5.2.5 group actors, JavaScript ES modules, Foundry world settings, ApplicationV2/HandlebarsApplicationMixin, Node `node:test`.

---

## Scope Boundary

This plan implements the foundation required before the larger economy and downtime work:

- dnd5e group actor registration and active group selection;
- current-user group resolution;
- per-group registry state;
- Rebreya inventory operations against the dnd5e group actor inventory;
- one-time merge from the old `Инвентарь группы Rebreya` actor into the first selected group.

Separate implementation plans cover the economy partition, group-specific global-event activation, and downtime request workflow after this foundation is merged and verified.

## File Structure

- Create `scripts/data/group-context-service.js`: pure helpers plus `GroupContextService` for registry normalization, active group resolution, player group resolution, registration, and legacy-inventory migration status.
- Modify `scripts/constants.js`: add `SETTINGS_KEYS.GROUP_STATE` and `REBREYA_GROUP_FLAGS`.
- Modify `scripts/settings.js`: register hidden world setting for the group registry.
- Modify `scripts/main.js`: instantiate `GroupContextService`, expose API methods, and pass group context into inventory service.
- Modify `scripts/data/inventory-service.js`: resolve inventory actor from group context, keep legacy actor lookup for migration, and add merge helpers.
- Create `scripts/ui/groups-app.js`: GM-only group selection/registration panel.
- Create `templates/groups-app.hbs`: UI template for the Rebreya groups panel.
- Modify `scripts/hooks.js`: add a `Группы` scene-control button for GMs.
- Modify `templates/inventory-app.hbs`: show current group name and a no-group state when context is missing.
- Modify `scripts/ui/inventory-app.js`: load inventory snapshots through group context and surface group-context errors.
- Create `tests/group-context-service.test.mjs`: unit tests for registry normalization and context resolution.
- Create `tests/group-inventory-migration.test.mjs`: unit tests for group actor inventory selection and legacy merge behavior.
- Update `README.md`: document Rebreya group actors, active group selection, and legacy inventory migration.

## Task 1: Add Group Context Registry And Resolver

**Files:**
- Create: `scripts/data/group-context-service.js`
- Modify: `scripts/constants.js`
- Modify: `scripts/settings.js`
- Test: `tests/group-context-service.test.mjs`

- [ ] **Step 1: Write the failing resolver tests**

Create `tests/group-context-service.test.mjs` with these tests:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDefaultGroupState,
  normalizeGroupRegistry,
  getGroupMemberActorIds,
  resolvePlayerGroupActor,
  GROUP_CONTEXT_ERRORS
} from "../scripts/data/group-context-service.js";

function member(actor) {
  return { actor };
}

function makeActor({ id, type = "group", isOwner = false, members = [], flags = {} }) {
  return {
    id,
    type,
    isOwner,
    flags,
    system: {
      members
    },
    getFlag: (scope, key) => flags?.[scope]?.[key]
  };
}

test("normalizes group registry and preserves per-group state", () => {
  const registry = normalizeGroupRegistry({
    version: 1,
    activeGroupActorId: "group-1",
    groupsById: {
      "group-1": {
        groupActorId: "group-1",
        calendar: { isoDate: "0361-01-02" },
        downtimeState: { requests: [{ id: "request-1" }] }
      }
    }
  });

  assert.equal(registry.version, 1);
  assert.equal(registry.activeGroupActorId, "group-1");
  assert.equal(registry.groupsById["group-1"].calendar.isoDate, "0361-01-02");
  assert.equal(registry.groupsById["group-1"].downtimeState.requests[0].id, "request-1");
});

test("default group state starts from file-backed empty runtime", () => {
  const state = buildDefaultGroupState("group-2", { now: 123 });

  assert.equal(state.groupActorId, "group-2");
  assert.equal(state.initializedAt, 123);
  assert.deepEqual(state.craftState, {});
  assert.deepEqual(state.downtimeState.balancesByActorId, {});
  assert.deepEqual(state.traderState, {});
});

test("reads members from dnd5e group system members only", () => {
  const alice = makeActor({ id: "alice", type: "character" });
  const bob = makeActor({ id: "bob", type: "character" });
  const group = makeActor({
    id: "group-1",
    members: [member(alice), member(null), member(bob)]
  });

  assert.deepEqual(getGroupMemberActorIds(group), ["alice", "bob"]);
});

test("resolves a player group from owned character membership", () => {
  const alice = makeActor({ id: "alice", type: "character", isOwner: true });
  const bob = makeActor({ id: "bob", type: "character", isOwner: false });
  const group = makeActor({
    id: "group-1",
    members: [member(alice), member(bob)]
  });

  assert.equal(resolvePlayerGroupActor([group], { userIsGM: false }), group);
});

test("throws a setup error when one player owns characters in two Rebreya groups", () => {
  const alice = makeActor({ id: "alice", type: "character", isOwner: true });
  const groupOne = makeActor({ id: "group-1", members: [member(alice)] });
  const groupTwo = makeActor({ id: "group-2", members: [member(alice)] });

  assert.throws(
    () => resolvePlayerGroupActor([groupOne, groupTwo], { userIsGM: false }),
    { message: GROUP_CONTEXT_ERRORS.PLAYER_IN_MULTIPLE_GROUPS }
  );
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `node --test tests/group-context-service.test.mjs`

Expected: FAIL with module not found for `scripts/data/group-context-service.js`.

- [ ] **Step 3: Add constants and setting key**

In `scripts/constants.js`, extend `SETTINGS_KEYS`:

```js
  GROUP_STATE: "groupState",
```

Add these exports near the existing module constants:

```js
export const REBREYA_GROUP_FLAGS = {
  MANAGED: "managedPartyGroup",
  LEGACY_INVENTORY_MERGED_AT: "legacyInventoryMergedAt",
  LEGACY_INVENTORY_ACTOR_ID: "legacyInventoryActorId"
};
```

In `scripts/settings.js`, register the hidden world setting after `PARTY_STATE`:

```js
  game.settings.register(MODULE_ID, SETTINGS_KEYS.GROUP_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
```

- [ ] **Step 4: Implement the pure resolver helpers**

Create `scripts/data/group-context-service.js`:

```js
import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../constants.js";

const DEFAULT_GROUP_REGISTRY_VERSION = 1;

export const GROUP_CONTEXT_ERRORS = Object.freeze({
  GM_NO_ACTIVE_GROUP: "ГМ не выбрал активную группу Rebreya.",
  PLAYER_NO_GROUP: "Ваш персонаж не добавлен в группу Rebreya.",
  PLAYER_IN_MULTIPLE_GROUPS: "Ваш Foundry-профиль найден в нескольких группах Rebreya.",
  GROUP_NOT_FOUND: "Группа Rebreya не найдена."
});

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return foundry.utils.deepClone(value);
  }
  return JSON.parse(JSON.stringify(value ?? null));
}

function cleanId(value) {
  return String(value ?? "").trim();
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildDefaultDowntimeState() {
  return {
    balancesByActorId: {},
    requests: [],
    checks: [],
    history: []
  };
}

export function buildDefaultGroupState(groupActorId, { now = Date.now() } = {}) {
  return {
    version: 1,
    groupActorId: cleanId(groupActorId),
    initializedAt: now,
    calendar: {},
    traderState: {},
    tradeAudit: [],
    globalEventsState: {},
    craftState: {},
    downtimeState: buildDefaultDowntimeState(),
    migration: {
      legacyInventoryMergedAt: 0,
      legacyInventoryActorId: ""
    }
  };
}

export function normalizeGroupState(groupActorId, value = {}) {
  const base = buildDefaultGroupState(groupActorId, { now: 0 });
  const source = isObject(value) ? clone(value) : {};
  const next = {
    ...base,
    ...source,
    groupActorId: cleanId(source.groupActorId) || cleanId(groupActorId),
    calendar: isObject(source.calendar) ? source.calendar : {},
    traderState: isObject(source.traderState) ? source.traderState : {},
    tradeAudit: Array.isArray(source.tradeAudit) ? source.tradeAudit : [],
    globalEventsState: isObject(source.globalEventsState) ? source.globalEventsState : {},
    craftState: isObject(source.craftState) ? source.craftState : {},
    downtimeState: {
      ...buildDefaultDowntimeState(),
      ...(isObject(source.downtimeState) ? source.downtimeState : {})
    },
    migration: {
      legacyInventoryMergedAt: Math.max(0, Number(source.migration?.legacyInventoryMergedAt ?? 0) || 0),
      legacyInventoryActorId: cleanId(source.migration?.legacyInventoryActorId)
    }
  };
  return next;
}

export function normalizeGroupRegistry(value = {}) {
  const source = isObject(value) ? clone(value) : {};
  const groupsSource = isObject(source.groupsById) ? source.groupsById : {};
  const groupsById = {};
  for (const [rawGroupId, rawState] of Object.entries(groupsSource)) {
    const groupId = cleanId(rawGroupId);
    if (!groupId) continue;
    groupsById[groupId] = normalizeGroupState(groupId, rawState);
  }

  return {
    version: DEFAULT_GROUP_REGISTRY_VERSION,
    activeGroupActorId: cleanId(source.activeGroupActorId),
    groupsById
  };
}

export function isManagedPartyGroup(actor) {
  return actor?.type === "group" && actor.getFlag?.(MODULE_ID, REBREYA_GROUP_FLAGS.MANAGED) === true;
}

export function getGroupMemberActors(groupActor) {
  const members = Array.isArray(groupActor?.system?.members) ? groupActor.system.members : [];
  return members.map((entry) => entry?.actor ?? null).filter(Boolean);
}

export function getGroupMemberActorIds(groupActor) {
  return getGroupMemberActors(groupActor)
    .map((actor) => cleanId(actor?.id))
    .filter(Boolean);
}

export function resolvePlayerGroupActor(groupActors = [], { userIsGM = false } = {}) {
  if (userIsGM) {
    return null;
  }

  const matches = groupActors.filter((groupActor) => (
    getGroupMemberActors(groupActor).some((actor) => actor?.type === "character" && actor?.isOwner === true)
  ));

  if (matches.length > 1) {
    throw new Error(GROUP_CONTEXT_ERRORS.PLAYER_IN_MULTIPLE_GROUPS);
  }

  return matches[0] ?? null;
}

export class GroupContextService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
  }

  getRegistry() {
    return normalizeGroupRegistry(game.settings.get(MODULE_ID, SETTINGS_KEYS.GROUP_STATE));
  }

  async setRegistry(registry) {
    const normalized = normalizeGroupRegistry(registry);
    await game.settings.set(MODULE_ID, SETTINGS_KEYS.GROUP_STATE, normalized);
    return normalized;
  }

  getManagedGroupActors({ includeUnregistered = false } = {}) {
    const actors = game.actors?.contents ?? [];
    return actors.filter((actor) => actor?.type === "group" && (includeUnregistered || isManagedPartyGroup(actor)));
  }

  async registerGroup(groupActorId) {
    const groupId = cleanId(groupActorId);
    const groupActor = game.actors?.get?.(groupId) ?? null;
    if (!groupActor || groupActor.type !== "group") {
      throw new Error(GROUP_CONTEXT_ERRORS.GROUP_NOT_FOUND);
    }

    if (groupActor.getFlag?.(MODULE_ID, REBREYA_GROUP_FLAGS.MANAGED) !== true) {
      await groupActor.setFlag?.(MODULE_ID, REBREYA_GROUP_FLAGS.MANAGED, true);
    }

    const registry = this.getRegistry();
    registry.groupsById[groupId] = normalizeGroupState(
      groupId,
      registry.groupsById[groupId] ?? buildDefaultGroupState(groupId)
    );
    if (!registry.activeGroupActorId) {
      registry.activeGroupActorId = groupId;
    }

    await this.setRegistry(registry);
    return this.resolveForGroup(groupId);
  }

  async setActiveGroup(groupActorId) {
    const groupId = cleanId(groupActorId);
    const groupActor = game.actors?.get?.(groupId) ?? null;
    if (!groupActor || groupActor.type !== "group") {
      throw new Error(GROUP_CONTEXT_ERRORS.GROUP_NOT_FOUND);
    }

    const registry = this.getRegistry();
    registry.activeGroupActorId = groupId;
    registry.groupsById[groupId] = normalizeGroupState(groupId, registry.groupsById[groupId] ?? {});
    await this.setRegistry(registry);
    return this.resolveForGroup(groupId);
  }

  resolveForGroup(groupActorId) {
    const groupId = cleanId(groupActorId);
    const groupActor = game.actors?.get?.(groupId) ?? null;
    if (!groupActor || groupActor.type !== "group") {
      throw new Error(GROUP_CONTEXT_ERRORS.GROUP_NOT_FOUND);
    }

    const registry = this.getRegistry();
    const groupState = normalizeGroupState(groupId, registry.groupsById[groupId] ?? {});
    return {
      groupActor,
      groupId,
      groupState,
      members: getGroupMemberActors(groupActor),
      memberActorIds: getGroupMemberActorIds(groupActor),
      canManage: game.user?.isGM === true || groupActor.isOwner === true
    };
  }

  resolveForCurrentUser() {
    if (game.user?.isGM) {
      const activeGroupActorId = this.getRegistry().activeGroupActorId;
      if (!activeGroupActorId) {
        throw new Error(GROUP_CONTEXT_ERRORS.GM_NO_ACTIVE_GROUP);
      }
      return this.resolveForGroup(activeGroupActorId);
    }

    const groupActor = resolvePlayerGroupActor(this.getManagedGroupActors(), { userIsGM: false });
    if (!groupActor) {
      throw new Error(GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP);
    }
    return this.resolveForGroup(groupActor.id);
  }
}
```

- [ ] **Step 5: Run resolver tests**

Run: `node --test tests/group-context-service.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add scripts/constants.js scripts/settings.js scripts/data/group-context-service.js tests/group-context-service.test.mjs
git commit -m "feat: add group context resolver"
```

## Task 2: Wire Group Context Into Module API

**Files:**
- Modify: `scripts/main.js`
- Test: `tests/group-context-service.test.mjs`

- [ ] **Step 1: Add failing API-oriented tests**

Append to `tests/group-context-service.test.mjs`:

```js
import { GroupContextService } from "../scripts/data/group-context-service.js";
import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";

test("registerGroup creates registry state and sets the first active group", async () => {
  const previousGame = globalThis.game;
  let settingValue = {};
  const group = makeActor({
    id: "group-1",
    flags: { [MODULE_ID]: {} }
  });
  let setFlagPayload = null;
  group.setFlag = async (scope, key, value) => {
    setFlagPayload = { scope, key, value };
    group.flags[scope][key] = value;
  };

  globalThis.game = {
    user: { isGM: true },
    actors: {
      contents: [group],
      get: (id) => id === "group-1" ? group : null
    },
    settings: {
      get: (_moduleId, key) => key === SETTINGS_KEYS.GROUP_STATE ? settingValue : {},
      set: async (_moduleId, key, value) => {
        if (key === SETTINGS_KEYS.GROUP_STATE) settingValue = value;
      }
    }
  };

  try {
    const service = new GroupContextService({});
    const context = await service.registerGroup("group-1");

    assert.equal(context.groupId, "group-1");
    assert.equal(settingValue.activeGroupActorId, "group-1");
    assert.equal(settingValue.groupsById["group-1"].groupActorId, "group-1");
    assert.deepEqual(setFlagPayload, {
      scope: MODULE_ID,
      key: "managedPartyGroup",
      value: true
    });
  }
  finally {
    globalThis.game = previousGame;
  }
});
```

- [ ] **Step 2: Run test to verify the API path passes before main wiring**

Run: `node --test tests/group-context-service.test.mjs`

Expected: PASS. This confirms the service API before `main.js` exposes it.

- [ ] **Step 3: Import and instantiate the service**

In `scripts/main.js`, add the import near the other data services:

```js
import { GroupContextService } from "./data/group-context-service.js";
```

In `RebreyaMainModule.constructor`, instantiate before `InventoryService`:

```js
    this.groupContextService = new GroupContextService(this);
```

- [ ] **Step 4: Expose API methods**

In `RebreyaMainModule`, add methods near the inventory/group API methods:

```js
  getGroupRegistry() {
    return this.groupContextService.getRegistry();
  }

  getGroupContext(options = {}) {
    if (options?.groupActorId) {
      return this.groupContextService.resolveForGroup(options.groupActorId);
    }
    return this.groupContextService.resolveForCurrentUser();
  }

  async registerPartyGroup(groupActorId) {
    const result = await this.groupContextService.registerGroup(groupActorId);
    await this.refreshOpenApps();
    return result;
  }

  async setActivePartyGroup(groupActorId) {
    const result = await this.groupContextService.setActiveGroup(groupActorId);
    await this.refreshOpenApps();
    return result;
  }
```

- [ ] **Step 5: Run all group-context tests**

Run: `node --test tests/group-context-service.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add scripts/main.js tests/group-context-service.test.mjs
git commit -m "feat: expose group context api"
```

## Task 3: Move Inventory Actor Resolution To dnd5e Group Actors

**Files:**
- Modify: `scripts/data/inventory-service.js`
- Test: `tests/group-inventory-migration.test.mjs`

- [ ] **Step 1: Write failing inventory resolution tests**

Create `tests/group-inventory-migration.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { InventoryService } from "../scripts/data/inventory-service.js";

function installFoundryUtils() {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    utils: {
      deepClone: (value) => JSON.parse(JSON.stringify(value)),
      mergeObject: (target, source) => ({ ...target, ...source }),
      getProperty: (source, path) => String(path ?? "").split(".").reduce((current, part) => current?.[part], source),
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

function makeItem({ id, name, type = "loot", quantity = 1, flags = {} }) {
  let data = {
    _id: id,
    name,
    type,
    img: "icons/svg/item-bag.svg",
    flags,
    system: {
      quantity,
      weight: { value: 1 },
      price: { value: 0, denomination: "gp" },
      type: { value: "loot", subtype: "" }
    }
  };
  return {
    id,
    name,
    type,
    flags,
    getFlag: (moduleId, key) => data.flags?.[moduleId]?.[key],
    toObject: () => foundry.utils.deepClone(data),
    update: async (patch) => {
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(data, path, value);
      }
    }
  };
}

function makeActor({ id, type = "group", items = [], currency = {}, isOwner = true }) {
  const actor = {
    id,
    type,
    isOwner,
    system: { currency },
    items: {
      contents: items,
      get: (itemId) => items.find((item) => item.id === itemId) ?? null
    },
    createEmbeddedDocuments: async (_type, documents) => {
      const created = documents.map((document, index) => makeItem({
        id: `created-${index + 1}`,
        name: document.name,
        type: document.type,
        quantity: document.system?.quantity ?? 1,
        flags: document.flags ?? {}
      }));
      items.push(...created);
      return created;
    },
    update: async (patch) => {
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(actor, path, value);
      }
    },
    getFlag: () => false
  };
  return actor;
}

test("inventory snapshot uses the current Rebreya group actor as inventory actor", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const groupActor = makeActor({
    id: "group-1",
    items: [makeItem({ id: "ration", name: "Еда", quantity: 3 })],
    currency: { gp: 4 }
  });

  globalThis.game = {
    user: { isGM: true },
    settings: { get: () => ({}), set: async () => {} },
    actors: { get: () => groupActor, contents: [groupActor] }
  };

  try {
    const service = new InventoryService({
      groupContextService: {
        resolveForCurrentUser: () => ({ groupActor, groupId: "group-1", canManage: true })
      },
      getModel: async () => ({ materials: [], gear: [] })
    });

    const snapshot = await service.getInventorySnapshot({ createActor: false });

    assert.equal(snapshot.actor.id, "group-1");
    assert.equal(snapshot.actor.name, "Партийный инвентарь");
    assert.equal(snapshot.items[0].name, "Еда");
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/group-inventory-migration.test.mjs`

Expected: FAIL because `InventoryService.getInventoryActor` still uses `partyState.inventoryActorId`.

- [ ] **Step 3: Add current group actor resolution to `InventoryService`**

In `scripts/data/inventory-service.js`, add helper methods inside `InventoryService`:

```js
  #getGroupContext(options = {}) {
    if (options?.groupActorId && this.moduleApi.groupContextService?.resolveForGroup) {
      return this.moduleApi.groupContextService.resolveForGroup(options.groupActorId);
    }

    if (this.moduleApi.groupContextService?.resolveForCurrentUser) {
      return this.moduleApi.groupContextService.resolveForCurrentUser();
    }

    return null;
  }

  #getGroupInventoryActor(options = {}) {
    const context = this.#getGroupContext(options);
    const groupActor = context?.groupActor ?? null;
    return groupActor?.type === "group" ? groupActor : null;
  }
```

At the start of `getInventoryActor({ create = false } = {})`, resolve group actor first:

```js
    const groupActor = this.#getGroupInventoryActor();
    if (groupActor) {
      return groupActor;
    }
```

Keep the existing legacy actor creation path after that block so tests and migration still have a fallback before any Rebreya group is registered.

- [ ] **Step 4: Update snapshot actor label for group actors**

In `getInventorySnapshot`, when building `actor`, use the real group name if available:

```js
        actor: actor ? {
          id: actor.id,
          name: actor.name,
          img: actor.img,
          currencyLabel: buildCurrencyLabel(actor),
          canEdit: this.canManagePartyInventory(actor),
          isGroupActor: actor.type === "group"
        } : null,
```

Keep the existing fallback fields for no actor.

- [ ] **Step 5: Run inventory test**

Run: `node --test tests/group-inventory-migration.test.mjs`

Expected: PASS.

- [ ] **Step 6: Run security inventory regression tests**

Run: `node --test tests/security.test.mjs`

Expected: PASS, including the existing legacy-party inventory tests.

- [ ] **Step 7: Commit**

Run:

```powershell
git add scripts/data/inventory-service.js tests/group-inventory-migration.test.mjs
git commit -m "feat: use group actor inventory"
```

## Task 4: Add Legacy Inventory Merge Into The First Registered Group

**Files:**
- Modify: `scripts/data/inventory-service.js`
- Modify: `scripts/main.js`
- Test: `tests/group-inventory-migration.test.mjs`

- [ ] **Step 1: Add failing merge tests**

Append to `tests/group-inventory-migration.test.mjs`:

```js
test("legacy inventory merge sums matching source items and currency into group actor", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const moduleId = "rebreya-main";
  const groupActor = makeActor({
    id: "group-1",
    items: [makeItem({
      id: "group-iron",
      name: "Железо",
      quantity: 2,
      flags: { [moduleId]: { sourceType: "material", sourceId: "iron" } }
    })],
    currency: { gp: 5, sp: 1 }
  });
  const legacyActor = makeActor({
    id: "legacy-inventory",
    type: "npc",
    items: [makeItem({
      id: "legacy-iron",
      name: "Железо",
      quantity: 3,
      flags: { [moduleId]: { sourceType: "material", sourceId: "iron" } }
    })],
    currency: { gp: 7, cp: 4 }
  });

  globalThis.game = {
    user: { isGM: true },
    settings: { get: () => ({ inventoryActorId: "legacy-inventory" }), set: async () => {} },
    actors: {
      get: (id) => id === "legacy-inventory" ? legacyActor : (id === "group-1" ? groupActor : null),
      contents: [groupActor, legacyActor]
    }
  };

  try {
    const service = new InventoryService({
      groupContextService: {
        resolveForGroup: () => ({ groupActor, groupId: "group-1", canManage: true })
      },
      getModel: async () => ({ materials: [], gear: [] })
    });

    const result = await service.mergeLegacyInventoryIntoGroup("group-1");
    const mergedItem = groupActor.items.get("group-iron");

    assert.equal(result.mergedItems, 1);
    assert.equal(mergedItem.toObject().system.quantity, 5);
    assert.equal(groupActor.system.currency.gp, 12);
    assert.equal(groupActor.system.currency.sp, 1);
    assert.equal(groupActor.system.currency.cp, 4);
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/group-inventory-migration.test.mjs`

Expected: FAIL because `mergeLegacyInventoryIntoGroup` does not exist.

- [ ] **Step 3: Add merge helpers**

In `scripts/data/inventory-service.js`, add these helpers outside the class near the existing inventory helpers:

```js
function getMergeKey(itemData) {
  const flags = foundry.utils.deepClone(itemData.flags?.[MODULE_ID] ?? {});
  const sourceType = String(flags.sourceType ?? "").trim();
  const sourceId = String(flags.sourceId ?? "").trim();
  if (sourceType && sourceId) {
    return `source:${sourceType}:${sourceId}`;
  }
  return `custom:${normalizeText(itemData.name)}:${String(itemData.type ?? "loot")}`;
}

function buildItemMergeIndex(actor) {
  const index = new Map();
  for (const item of actor?.items?.contents ?? []) {
    const itemData = item.toObject();
    const key = getMergeKey(itemData);
    if (key && !index.has(key)) {
      index.set(key, item);
    }
  }
  return index;
}
```

Add a method to `InventoryService`:

```js
  async mergeLegacyInventoryIntoGroup(groupActorId) {
    if (!game.user?.isGM) {
      throw new Error("Миграцию старого склада может запускать только ГМ.");
    }

    const context = this.moduleApi.groupContextService?.resolveForGroup?.(groupActorId);
    const groupActor = context?.groupActor ?? null;
    if (!groupActor || groupActor.type !== "group") {
      throw new Error("Группа Rebreya не найдена.");
    }

    const legacyState = this.#getState();
    const legacyActor = legacyState.inventoryActorId ? game.actors.get(legacyState.inventoryActorId) ?? null : null;
    if (!legacyActor || legacyActor.id === groupActor.id) {
      return { mergedItems: 0, createdItems: 0, mergedCurrency: false };
    }

    const index = buildItemMergeIndex(groupActor);
    let mergedItems = 0;
    let createdItems = 0;

    for (const legacyItem of legacyActor.items.contents ?? []) {
      const itemData = legacyItem.toObject();
      const quantity = getRawQuantity(itemData);
      if (quantity <= 0) continue;

      const key = getMergeKey(itemData);
      const existing = index.get(key) ?? null;
      if (existing) {
        const currentQuantity = getRawQuantity(existing.toObject());
        await existing.update({ "system.quantity": roundNumber(currentQuantity + quantity, 2) });
        mergedItems += 1;
        continue;
      }

      const [created] = await groupActor.createEmbeddedDocuments("Item", [sanitizeEmbeddedItemData(itemData)]);
      if (created) {
        index.set(key, created);
        createdItems += 1;
      }
    }

    const currentCurrency = buildCurrencySnapshot(groupActor);
    const legacyCurrency = buildCurrencySnapshot(legacyActor);
    await groupActor.update(buildCurrencyUpdatePatch({
      pp: currentCurrency.pp + legacyCurrency.pp,
      gp: currentCurrency.gp + legacyCurrency.gp,
      sp: currentCurrency.sp + legacyCurrency.sp,
      cp: currentCurrency.cp + legacyCurrency.cp
    }));

    await legacyActor.setFlag?.(MODULE_ID, "migratedToGroupActorId", groupActor.id);

    return {
      mergedItems,
      createdItems,
      mergedCurrency: true,
      legacyInventoryActorId: legacyActor.id,
      groupActorId: groupActor.id
    };
  }
```

- [ ] **Step 4: Expose migration API in `main.js`**

Add:

```js
  async mergeLegacyInventoryIntoGroup(groupActorId) {
    const result = await this.inventoryService.mergeLegacyInventoryIntoGroup(groupActorId);
    await this.refreshOpenApps();
    return result;
  }
```

- [ ] **Step 5: Run merge tests**

Run: `node --test tests/group-inventory-migration.test.mjs`

Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run: `node --test tests/*.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add scripts/data/inventory-service.js scripts/main.js tests/group-inventory-migration.test.mjs
git commit -m "feat: merge legacy inventory into group"
```

## Task 5: Add GM Groups Management Window

**Files:**
- Create: `scripts/ui/groups-app.js`
- Create: `templates/groups-app.hbs`
- Modify: `scripts/main.js`
- Modify: `scripts/hooks.js`
- Test: `tests/bg3-hotbar-compat.test.mjs`

- [ ] **Step 1: Add scene-control regression test**

In `tests/bg3-hotbar-compat.test.mjs`, extend the record and array scene-control tests to assert there is a GM-visible groups tool:

```js
const rebreyaControl = controls["rebreya-main-rebreya"];
assert.equal(rebreyaControl.tools["rebreya-main-groups"].title, "REBREYA_MAIN.Controls.OpenGroups");
assert.equal(rebreyaControl.tools["rebreya-main-groups"].visible, true);
```

For the non-GM visibility case, add a small assertion by setting `game.user.isGM = false` before building controls:

```js
assert.equal(rebreyaControl.tools["rebreya-main-groups"].visible, false);
```

- [ ] **Step 2: Run the scene-control test to verify it fails**

Run: `node --test tests/bg3-hotbar-compat.test.mjs`

Expected: FAIL because the groups scene-control tool does not exist.

- [ ] **Step 3: Create `GroupsApp`**

Create `scripts/ui/groups-app.js`:

```js
import { MODULE_ID } from "../constants.js";
import { bringAppToFront } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class GroupsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-groups-app"],
    window: {
      title: "Группы Rebreya",
      icon: "fa-solid fa-users",
      resizable: true
    },
    position: {
      width: 900,
      height: 700
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/groups-app.hbs`
    }
  };

  constructor(moduleApi, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
  }

  get id() {
    return `${MODULE_ID}-groups-app`;
  }

  async _prepareContext() {
    const registry = this.moduleApi.getGroupRegistry();
    const groupActors = game.actors.contents
      .filter((actor) => actor.type === "group")
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));

    return {
      groups: groupActors.map((actor) => {
        const state = registry.groupsById[actor.id] ?? null;
        const members = Array.isArray(actor.system?.members) ? actor.system.members : [];
        return {
          id: actor.id,
          name: actor.name,
          img: actor.img,
          isRegistered: Boolean(state),
          isActive: registry.activeGroupActorId === actor.id,
          memberCount: members.filter((entry) => entry?.actor).length,
          initializedAt: state?.initializedAt ?? 0,
          migration: state?.migration ?? null
        };
      }),
      hasGroups: groupActors.length > 0
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = this.element;

    element.querySelectorAll("[data-action='open-group-sheet']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const actor = game.actors.get(event.currentTarget.dataset.groupId);
        await actor?.sheet?.render?.({ force: true });
      });
    });

    element.querySelectorAll("[data-action='register-group']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const groupId = event.currentTarget.dataset.groupId;
        await this.moduleApi.registerPartyGroup(groupId);
        ui.notifications?.info("Группа зарегистрирована в Rebreya.");
        this.render({ force: true });
        bringAppToFront(this);
      });
    });

    element.querySelectorAll("[data-action='set-active-group']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const groupId = event.currentTarget.dataset.groupId;
        await this.moduleApi.setActivePartyGroup(groupId);
        ui.notifications?.info("Активная группа Rebreya обновлена.");
        this.render({ force: true });
        bringAppToFront(this);
      });
    });

    element.querySelectorAll("[data-action='merge-legacy-inventory']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const groupId = event.currentTarget.dataset.groupId;
        const result = await this.moduleApi.mergeLegacyInventoryIntoGroup(groupId);
        ui.notifications?.info(`Старый склад слит с группой. Обновлено: ${result.mergedItems}, создано: ${result.createdItems}.`);
        this.render({ force: true });
        bringAppToFront(this);
      });
    });
  }
}
```

- [ ] **Step 4: Create template**

Create `templates/groups-app.hbs`:

```hbs
<section class="rm-shell rm-groups-shell scrollable">
  <header class="rm-section-header">
    <div>
      <h2>Группы Rebreya</h2>
      <p class="rm-muted">Используются существующие dnd5e актёры типа «Группа».</p>
    </div>
  </header>

  {{#unless hasGroups}}
    <section class="rm-empty-state">
      <h3>Нет dnd5e групп</h3>
      <p>Создайте Actor типа «Группа» штатными средствами Foundry, затем вернитесь в это окно.</p>
    </section>
  {{/unless}}

  <div class="rm-group-list">
    {{#each groups}}
      <article class="rm-group-row {{#if isActive}}is-active{{/if}}">
        <img class="rm-group-row__image" src="{{img}}" alt="{{name}}">
        <div class="rm-group-row__main">
          <h3>{{name}}</h3>
          <p class="rm-muted">{{memberCount}} уч.{{#if isRegistered}} • Rebreya{{else}} • не зарегистрирована{{/if}}</p>
        </div>
        <div class="rm-group-row__actions">
          <button type="button" class="rm-button rm-button--small rm-button--secondary" data-action="open-group-sheet" data-group-id="{{id}}">Лист</button>
          {{#unless isRegistered}}
            <button type="button" class="rm-button rm-button--small" data-action="register-group" data-group-id="{{id}}">Зарегистрировать</button>
          {{/unless}}
          {{#if isRegistered}}
            <button type="button" class="rm-button rm-button--small rm-button--primary" data-action="set-active-group" data-group-id="{{id}}" {{#if isActive}}disabled{{/if}}>
              {{#if isActive}}Активна{{else}}Сделать активной{{/if}}
            </button>
            <button type="button" class="rm-button rm-button--small rm-button--secondary" data-action="merge-legacy-inventory" data-group-id="{{id}}">Слить старый склад</button>
          {{/if}}
        </div>
      </article>
    {{/each}}
  </div>
</section>
```

- [ ] **Step 5: Expose app open method**

In `scripts/main.js`, add `this.groupsApp = null;` in the constructor.

In `refreshOpenApps`, rerender it:

```js
    if (this.groupsApp?.rendered) {
      tasks.push(rerenderApp(this.groupsApp));
    }
```

Add:

```js
  async openGroupsApp() {
    try {
      if (!game.user?.isGM) {
        throw new Error("Окно групп доступно только мастеру.");
      }

      const { GroupsApp } = await import("./ui/groups-app.js");
      if (!this.groupsApp) {
        this.groupsApp = new GroupsApp(this);
      }

      await this.groupsApp.render({ force: true });
      bringAppToFront(this.groupsApp);
      return this.groupsApp;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open groups app.`, error);
      ui.notifications?.error("Не удалось открыть окно групп.");
      throw error;
    }
  }
```

- [ ] **Step 6: Add scene-control button**

In `scripts/hooks.js`, add a groups tool to `buildToolsRecord()` after inventory:

```js
  const groupsToolName = `${MODULE_ID}-groups`;
```

Add to the returned tools object:

```js
    [groupsToolName]: {
      name: groupsToolName,
      order: 25,
      title: game.i18n.localize("REBREYA_MAIN.Controls.OpenGroups"),
      icon: "fa-solid fa-users",
      button: true,
      visible: game.user?.isGM === true,
      onChange: createSafeAction(
        () => game.rebreyaMain?.openGroupsApp?.(),
        "Groups control click failed."
      )
    },
```

- [ ] **Step 7: Add localization key**

In `lang/ru.json`, add:

```json
"REBREYA_MAIN.Controls.OpenGroups": "Группы"
```

- [ ] **Step 8: Run focused UI/control tests**

Run: `node --test tests/bg3-hotbar-compat.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```powershell
git add scripts/ui/groups-app.js templates/groups-app.hbs scripts/main.js scripts/hooks.js lang/ru.json tests/bg3-hotbar-compat.test.mjs
git commit -m "feat: add Rebreya groups window"
```

## Task 6: Surface Group Context In Inventory UI

**Files:**
- Modify: `scripts/ui/inventory-app.js`
- Modify: `templates/inventory-app.hbs`
- Test: `tests/group-inventory-migration.test.mjs`

- [ ] **Step 1: Add missing-context snapshot test**

Append to `tests/group-inventory-migration.test.mjs`:

```js
test("inventory snapshot reports a group context error when no player group exists", async () => {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  globalThis.game = {
    user: { isGM: false },
    settings: { get: () => ({}), set: async () => {} },
    actors: { get: () => null, contents: [] }
  };

  try {
    const service = new InventoryService({
      groupContextService: {
        resolveForCurrentUser: () => {
          throw new Error("Ваш персонаж не добавлен в группу Rebreya.");
        }
      },
      getModel: async () => ({ materials: [], gear: [] })
    });

    const snapshot = await service.getInventorySnapshot({ createActor: false });

    assert.equal(snapshot.hasActor, false);
    assert.equal(snapshot.groupContextError, "Ваш персонаж не добавлен в группу Rebreya.");
  }
  finally {
    globalThis.game = previousGame;
    restoreFoundry();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/group-inventory-migration.test.mjs`

Expected: FAIL because `getInventorySnapshot` currently throws or returns the legacy empty state without `groupContextError`.

- [ ] **Step 3: Catch group-context errors in inventory service**

In `getInventoryActor`, store the most recent context error on the service instance:

```js
    this.lastGroupContextError = "";
    try {
      const groupActor = this.#getGroupInventoryActor();
      if (groupActor) {
        return groupActor;
      }
    }
    catch (error) {
      this.lastGroupContextError = error.message || "Не удалось определить группу Rebreya.";
      if (!create) {
        return null;
      }
    }
```

In the empty return of `getInventorySnapshot`, include:

```js
        groupContextError: this.lastGroupContextError || "",
```

- [ ] **Step 4: Pass group metadata in inventory app context**

In `scripts/ui/inventory-app.js`, after loading `inventorySnapshot`, get context for display:

```js
      let groupContext = null;
      let groupContextError = inventorySnapshot.groupContextError ?? "";
      try {
        groupContext = this.moduleApi.getGroupContext();
      }
      catch (error) {
        groupContextError = groupContextError || error.message || "Не удалось определить группу Rebreya.";
      }
```

In returned context add:

```js
        group: groupContext ? {
          id: groupContext.groupId,
          name: groupContext.groupActor?.name ?? "Группа Rebreya",
          memberCount: groupContext.memberActorIds?.length ?? 0
        } : null,
        groupContextError,
```

- [ ] **Step 5: Show group banner in template**

In `templates/inventory-app.hbs`, near the shell header, add:

```hbs
    {{#if group}}
      <div class="rm-inline-status rm-inline-status--info">
        Группа: {{group.name}} • {{rmNum group.memberCount precision=0}} уч.
      </div>
    {{/if}}
    {{#if groupContextError}}
      <div class="rm-inline-status rm-inline-status--warning">
        {{groupContextError}}
      </div>
    {{/if}}
```

- [ ] **Step 6: Run inventory tests**

Run: `node --test tests/group-inventory-migration.test.mjs tests/security.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add scripts/data/inventory-service.js scripts/ui/inventory-app.js templates/inventory-app.hbs tests/group-inventory-migration.test.mjs
git commit -m "feat: show active group in inventory"
```

## Task 7: Update Documentation And Run Full Verification

**Files:**
- Modify: `README.md`
- Test: all existing tests

- [ ] **Step 1: Update README group sections**

In `README.md`, update these sections:

- `5.7 Инвентарь группы`;
- `8. Партийный склад, группа, энергия`;
- `14. Настройки модуля`;
- `16.1 Полный каталог методов API`.

Add this exact API list under inventory/group:

```md
- `openGroupsApp()`
- `getGroupRegistry()`
- `getGroupContext(options?)`
- `registerPartyGroup(groupActorId)`
- `setActivePartyGroup(groupActorId)`
- `mergeLegacyInventoryIntoGroup(groupActorId)`
```

Add this behavior note:

```md
Начиная с группового контекста Rebreya использует штатный dnd5e `Actor` типа `group` как источник состава и группового inventory. Старый отдельный `Инвентарь группы Rebreya` сохраняется только как legacy-источник для одноразового слияния в первую зарегистрированную группу.
```

- [ ] **Step 2: Run full tests**

Run: `node --test tests/*.test.mjs`

Expected: PASS with all tests green.

- [ ] **Step 3: Check formatting and diff**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected:

- `git diff --check` exits 0;
- only intended files are modified;
- diff includes group context, groups app, inventory migration, tests, and README.

- [ ] **Step 4: Commit documentation**

Run:

```powershell
git add README.md
git commit -m "docs: document group context foundation"
```

- [ ] **Step 5: Push branch**

Run:

```powershell
git push origin lich_branch
```

Expected: `lich_branch -> lich_branch`.

## Self-Review

Spec coverage in this plan:

- Existing dnd5e group actors are used as the group source: Task 1 and Task 5.
- Membership comes from `groupActor.system.members`: Task 1.
- Group inventory uses the dnd5e group actor: Task 3.
- Old separate inventory actor is a migration source only: Task 4.
- GM active group and player automatic group resolution: Task 1 and Task 2.
- Baseline comes from file-backed default runtime, not old inventory: Task 1 registry defaults and Task 4 one-time migration boundary.
- Groups window exists in the Rebreya panel: Task 5.
- UI surfaces context errors and active group: Task 6.

Spec areas intentionally assigned to separate implementation plans:

- group-specific trader runtime across all trader methods;
- group-specific global-event activation;
- full downtime request workflow and character-sheet roll integration.

The plan contains concrete tasks and uses consistent names: `GroupContextService`, `groupState`, `groupsById`, `activeGroupActorId`, `managedPartyGroup`, `mergeLegacyInventoryIntoGroup`.
